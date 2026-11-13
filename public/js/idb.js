/**
 * IndexedDB Wrapper for Barbearia Offline Mutations
 * Lightweight wrapper for queuing offline mutations (POST/PUT/DELETE)
 * Used by the client to queue mutations when offline, synced via Background Sync
 */
(function () {
  'use strict';

  const DB_NAME = 'BarbeariaOffline';
  const DB_VERSION = 1;
  const STORE_NAME = 'mutations';
  const SYNC_TAG = 'pending-mutations';

  let dbPromise = null;

  /**
   * Opens the IndexedDB database
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp');
          store.createIndex('url', 'url');
          store.createIndex('status', 'status');
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  /**
   * Adds a mutation to the queue
   * @param {Object} mutation - Mutation object
   * @param {string} mutation.url - Full URL of the request
   * @param {string} mutation.method - HTTP method (POST, PUT, DELETE, PATCH)
   * @param {Object} mutation.headers - Request headers
   * @param {string|Object} mutation.body - Request body
   * @param {Object} [mutation.metadata] - Additional metadata (e.g., appointment ID, client ID)
   * @returns {Promise<number>} - The ID of the queued mutation
   */
  async function queueMutation(mutation) {
    const db = await openDB();
    const timestamp = Date.now();

    const mutationRecord = {
      url: mutation.url,
      method: mutation.method.toUpperCase(),
      headers: mutation.headers || {},
      body: typeof mutation.body === 'string' ? mutation.body : JSON.stringify(mutation.body || {}),
      timestamp,
      status: 'pending',
      retries: 0,
      metadata: mutation.metadata || {},
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.add(mutationRecord);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);

      tx.oncomplete = () => {
        // Register for background sync
        registerBackgroundSync();
      };
    });
  }

  /**
   * Gets all pending mutations from the queue
   * @returns {Promise<Array>} - Array of mutation records
   */
  async function getPendingMutations() {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.openCursor();

      const mutations = [];
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.status === 'pending') {
            mutations.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(mutations);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Gets the count of pending mutations
   * @returns {Promise<number>}
   */
  async function getPendingCount() {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('status');
      const request = index.count('pending');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Updates a mutation record (e.g., after retry, or marking as failed)
   * @param {number} id - Mutation ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async function updateMutation(id, updates) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const mutation = getRequest.result;
        if (!mutation) {
          reject(new Error('Mutation not found'));
          return;
        }

        const updated = { ...mutation, ...updates };
        const putRequest = store.put(updated);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Removes a mutation from the queue (after successful sync)
   * @param {number} id - Mutation ID
   * @returns {Promise<void>}
   */
  async function removeMutation(id) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clears all mutations (useful for debugging or reset)
   * @returns {Promise<void>}
   */
  async function clearAllMutations() {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Registers for background sync with the service worker
   * @returns {Promise<void>}
   */
  async function registerBackgroundSync() {
    if (!('serviceWorker' in navigator) || !('sync' in window.ServiceWorkerRegistration.prototype)) {
      console.log('[IDB] Background Sync not supported');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register(SYNC_TAG);
      console.log('[IDB] Background sync registered:', SYNC_TAG);
    } catch (error) {
      console.warn('[IDB] Background sync registration failed:', error);
    }
  }

  /**
   * Checks if we're currently online
   * @returns {boolean}
   */
  function isOnline() {
    return navigator.onLine;
  }

  /**
   * Listens for online/offline events and triggers sync when coming online
   * @param {Function} onOnline - Callback when coming online
   */
  function onNetworkChange(onOnline) {
    window.addEventListener('online', () => {
      console.log('[IDB] Network: online');
      registerBackgroundSync();
      onOnline?.();
    });

    window.addEventListener('offline', () => {
      console.log('[IDB] Network: offline');
    });
  }

  /**
   * High-level API client that queues mutations when offline
   * @param {string} method - HTTP method
   * @param {string} url - Request URL
   * @param {Object} [body] - Request body
   * @param {Object} [options] - Additional options
   * @returns {Promise<any>} - Response data
   */
  async function offlineAwareFetch(method, url, body, options = {}) {
    const { metadata = {}, retryOnFailure = true } = options;

    // If online, try direct fetch first
    if (isOnline()) {
      try {
        const response = await fetch(url, {
          method: method.toUpperCase(),
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...options.headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        // Success - return response
        if (response.ok || response.status === 401 || response.status === 403) {
          const text = await response.text();
          return text ? JSON.parse(text) : null;
        }

        // Server error - queue if retry enabled
        if (retryOnFailure) {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        // Network error - queue if retry enabled
        if (retryOnFailure) {
          console.log('[IDB] Fetch failed, queueing mutation:', error.message);
        } else {
          throw error;
        }
      }
    }

    // Offline or failed - queue the mutation
    const mutationId = await queueMutation({
      url,
      method,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body,
      metadata,
    });

    // Return a special response indicating queued
    return {
      queued: true,
      mutationId,
      message: 'Operação enfileirada para sincronização quando online',
    };
  }

  // Expose the API
  window.IDB = {
    openDB,
    queueMutation,
    getPendingMutations,
    getPendingCount,
    updateMutation,
    removeMutation,
    clearAllMutations,
    registerBackgroundSync,
    isOnline,
    onNetworkChange,
    offlineAwareFetch,
    SYNC_TAG,
    STORE_NAME,
  };
})();