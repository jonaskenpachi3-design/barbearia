/**
 * Service Worker — Barbearia Andrade
 * Comprehensive PWA support with offline-first strategies
 *
 * CACHING STRATEGIES:
 * 1. Static assets (CSS, JS, images, fonts, icons) — Cache First with long TTL
 * 2. HTML pages — Network First with fallback to cache (for fresh content)
 * 3. API responses for barbeiro panel — Stale While Revalidate (offline-first for reads)
 * 4. Background sync for failed POST/PUT requests (queue when offline, send when online)
 * 5. Offline fallback page — for when network fails and no cache
 *
 * FEATURES:
 * - Precache all static assets on install
 * - Background sync for failed mutations
 * - Push notification support skeleton (for future Fase 4)
 * - Version-based cache management (auto-clean old caches)
 * - Skip waiting / clients.claim for instant updates
 * - Proper CORS handling for external resources (Google Fonts, Mercado Pago)
 */

'use strict';

const SW_VERSION = '1.0.1';
const CACHE_PREFIX = 'barbearia';
const CACHE_STATIC = `${CACHE_PREFIX}-static-v${SW_VERSION}`;
const CACHE_API = `${CACHE_PREFIX}-api-v${SW_VERSION}`;
const CACHE_FONTS = `${CACHE_PREFIX}-fonts-v${SW_VERSION}`;
const CACHE_OFFLINE = `${CACHE_PREFIX}-offline-v${SW_VERSION}`;
const CACHE_ALL = [CACHE_STATIC, CACHE_API, CACHE_FONTS, CACHE_OFFLINE];

// ============================================================
// STATIC ASSETS TO PRECACHE
// ============================================================
const STATIC_ASSETS = [
  // HTML Pages
  '/',
  '/index.html',
  '/admin.html',
  '/barbeiro.html',
  '/cliente.html',
  '/agendar.html',

  // CSS
  '/css/app.css',
  '/css/cliente-booking.css',
  '/css/admin-barber-modal.css',

  // JavaScript
  '/js/app.js',
  '/js/admin.js',
  '/js/barbeiro.js',
  '/js/cliente.js',
  '/js/login.js',
  '/js/agendar.js',
  '/js/idb.js',
  '/js/date-picker.js',

  // Icons & Manifest
  '/favicon.svg',
  '/site.webmanifest',
  '/icons/icons.svg',

  // Offline fallback
  '/offline.html',
];

// API endpoints to cache for offline support (barbeiro panel priority)
const API_CACHE_PATTERNS = [
  /^\/api\/meu-barbeiro$/,
  /^\/api\/agenda-barbeiro/,
  /^\/api\/clientes\/[^/]+\/historico$/,
  /^\/api\/servicos$/,
  /^\/api\/comissoes/,
  /^\/api\/vendas\?status=concluida$/,
  /^\/api\/auth\/me$/,
];

// API endpoints that are mutations (POST/PUT/DELETE) - queue for background sync
const MUTATION_ENDPOINTS = [
  /^\/api\/agendamentos\/[^/]+\/confirmar$/,
  /^\/api\/agendamentos\/[^/]+\/concluir$/,
  /^\/api\/agendamentos\/[^/]+\/cancelar$/,
  /^\/api\/clientes\/[^/]+\/observacoes$/,
  /^\/api\/caixa\//,
  /^\/api\/vendas$/,
  /^\/api\/produtos\//,
  /^\/api\/servicos\//,
  /^\/api\/barbeiros\//,
  /^\/api\/bloqueios\//,
];

// External origins that need CORS handling
const EXTERNAL_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://api.mercadopago.com',
  'https://www.mercadopago.com.br',
];

// ============================================================
// INSTALL — Precache static assets
// ============================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', SW_VERSION);

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);

      // Precache all static assets
      await cache.addAll(STATIC_ASSETS.map((url) => new Request(url, { credentials: 'same-origin' })));

      // Also cache fonts from Google Fonts (CSS and font files)
      const fontCache = await caches.open(CACHE_FONTS);
      await cacheGoogleFonts(fontCache);

      // Create offline fallback page
      await createOfflinePage();

      console.log('[SW] Static assets precached');
    })()
  );

  // Force immediate activation (skip waiting)
  self.skipWaiting();
});

// ============================================================
// ACTIVATE — Clean old caches, claim clients
// ============================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', SW_VERSION);

  event.waitUntil(
    (async () => {
      // Delete old caches
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith(CACHE_PREFIX) && !CACHE_ALL.includes(name))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );

      // Claim all clients immediately
      await self.clients.claim();

      console.log('[SW] Activated and claimed clients');
    })()
  );
});

// ============================================================
// FETCH — Handle requests with appropriate strategies
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests for caching strategies (handle mutations separately)
  if (request.method !== 'GET') {
    return handleMutation(event);
  }

  // Skip chrome-extension, data:, blob: URLs
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // External resources (Google Fonts, Mercado Pago) - handle CORS
  if (EXTERNAL_ORIGINS.some((origin) => url.origin === origin)) {
    event.respondWith(handleExternalResource(request));
    return;
  }

  // API requests - Stale While Revalidate for barbeiro endpoints, Network First for others
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // HTML pages - Network First with cache fallback
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(handleHtmlRequest(request));
    return;
  }

  // Static assets (CSS, JS, images, fonts, icons) - Cache First
  event.respondWith(handleStaticAsset(request));
});

// ============================================================
// STATIC ASSETS — Cache First Strategy
// ============================================================
async function handleStaticAsset(request) {
  const cache = await caches.open(CACHE_STATIC);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // Serve from cache, update in background
    eventWaitUntil(updateCacheInBackground(cache, request));
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Clone response before caching
      const responseToCache = networkResponse.clone();
      await cache.put(request, responseToCache);
    }

    return networkResponse;
  } catch (error) {
    console.log('[SW] Static asset fetch failed:', request.url, error);
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function updateCacheInBackground(cache, request) {
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
}

// ============================================================
// HTML PAGES — Network First Strategy
// ============================================================
async function handleHtmlRequest(request) {
  const cache = await caches.open(CACHE_STATIC);

  try {
    // Try network first
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache the fresh response
      const responseToCache = networkResponse.clone();
      await cache.put(request, responseToCache);
      return networkResponse;
    }

    // Network responded but not OK, fall through to cache
    throw new Error(`HTTP ${networkResponse.status}`);
  } catch (error) {
    console.log('[SW] Network failed for HTML, trying cache:', request.url);

    // Fallback to cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Ultimate fallback - offline page
    return getOfflinePage();
  }
}

// ============================================================
// API REQUESTS — Stale While Revalidate for barbeiro endpoints
// ============================================================
async function handleApiRequest(request) {
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_API);

  // Check if this is a barbeiro-priority endpoint (offline-first)
  const isBarbeiroEndpoint = API_CACHE_PATTERNS.some((pattern) => pattern.test(url.pathname));

  if (isBarbeiroEndpoint) {
    return staleWhileRevalidate(cache, request);
  }

  // Other API endpoints - Network First with short cache
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache successful GET responses briefly (5 min)
      const responseToCache = networkResponse.clone();
      const headers = new Headers(responseToCache.headers);
      headers.set('sw-cached-at', Date.now().toString());
      headers.set('sw-max-age', '300000'); // 5 minutes

      const cachedResponse = new Response(await responseToCache.blob(), {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers,
      });

      await cache.put(request, cachedResponse);
    }

    return networkResponse;
  } catch (error) {
    console.log('[SW] API network failed, trying cache:', request.url);

    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      // Check if cached response is stale (> 5 min)
      const cachedAt = parseInt(cachedResponse.headers.get('sw-cached-at') || '0');
      const maxAge = parseInt(cachedResponse.headers.get('sw-max-age') || '300000');
      if (Date.now() - cachedAt < maxAge) {
        // Add header to indicate stale response
        const headers = new Headers(cachedResponse.headers);
        headers.set('x-sw-stale', 'true');
        return new Response(await cachedResponse.blob(), {
          status: cachedResponse.status,
          statusText: cachedResponse.statusText,
          headers,
        });
      }
    }

    // No valid cache - return offline response for barbeiro endpoints
    if (isBarbeiroEndpoint) {
      return new Response(
        JSON.stringify({ erro: 'Offline - dados não disponíveis', offline: true }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw error;
  }
}

// ============================================================
// EXTERNAL RESOURCES — Handle CORS for Google Fonts, Mercado Pago
// ============================================================
async function handleExternalResource(request) {
  const url = new URL(request.url);

  // For Google Fonts CSS - cache the CSS and rewrite font URLs to go through SW
  if (url.origin === 'https://fonts.googleapis.com' && url.pathname.includes('.css')) {
    return handleGoogleFontsCss(request);
  }

  // For Google Fonts font files (woff2, etc.) - Cache First
  if (url.origin === 'https://fonts.gstatic.com') {
    const cache = await caches.open(CACHE_FONTS);
    return cacheFirst(cache, request);
  }

  // Mercado Pago - Network only (don't cache payment APIs)
  if (url.origin.includes('mercadopago')) {
    try {
      return await fetch(request);
    } catch (error) {
      return new Response(
        JSON.stringify({ erro: 'Serviço de pagamento indisponível offline' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Default: network first
  return fetch(request);
}

// ============================================================
// GOOGLE FONTS CSS — Cache and rewrite font URLs
// ============================================================
async function handleGoogleFontsCss(request) {
  const cache = await caches.open(CACHE_FONTS);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (!response.ok) throw new Error('Font CSS fetch failed');

    const cssText = await response.text();

    // Rewrite font URLs to go through our origin (or keep as-is for direct caching)
    // We'll cache the font files directly when they're requested
    const modifiedCss = cssText.replace(
      /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g,
      (match, fontUrl) => `url(${fontUrl})`
    );

    const modifiedResponse = new Response(modifiedCss, {
      status: response.status,
      statusText: response.statusText,
      headers: { 'Content-Type': 'text/css' },
    });

    await cache.put(request, modifiedResponse.clone());
    return modifiedResponse;
  } catch (error) {
    console.log('[SW] Google Fonts CSS failed:', error);
    return new Response('/* Fonts unavailable offline */', { status: 503 });
  }
}

// ============================================================
// CACHE STRATEGIES HELPERS
// ============================================================
async function cacheFirst(cache, request) {
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(cache, request) {
  const cached = await cache.match(request);

  // Fetch fresh in background
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // Return cached immediately if available
  if (cached) {
    // Trigger background update
    eventWaitUntil(fetchPromise);
    return cached;
  }

  // No cache - wait for network
  try {
    const response = await fetchPromise;
    return response || new Response(JSON.stringify({ erro: 'Offline', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ erro: 'Offline', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ============================================================
// MUTATIONS — Background Sync for failed POST/PUT/DELETE
// ============================================================
function handleMutation(event) {
  const { request } = event;
  const url = new URL(request.url);

  // Check if this is a mutation we should queue for background sync
  const isMutation = MUTATION_ENDPOINTS.some((pattern) => pattern.test(url.pathname));

  if (!isMutation) {
    // Not a mutation we handle - just pass through
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // Try network first
        const response = await fetch(request.clone());

        // If successful, return response
        if (response.ok || response.status === 401 || response.status === 403) {
          return response;
        }

        // Server error - might be temporary, queue for retry
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        console.log('[SW] Mutation failed, queueing for background sync:', request.url);

        // Queue for background sync
        await queueMutation(request);

        // Register for background sync
        try {
          await self.registration.sync.register('barbearia-mutations');
        } catch (syncError) {
          console.log('[SW] Background sync registration failed:', syncError);
        }

        // Return a response indicating queued
        return new Response(
          JSON.stringify({
            queued: true,
            message: 'Operação enfileirada para sincronização quando online',
          }),
          {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    })()
  );
}

// Queue a failed mutation for later retry
async function queueMutation(request) {
  const db = await openMutationQueue();
  const body = await request.clone().text();

  const mutation = {
    id: Date.now() + Math.random(),
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    timestamp: Date.now(),
    retries: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.add(mutation);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Open IndexedDB for mutation queue
function openMutationQueue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('BarbeariaSW', 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('mutations')) {
        const store = db.createObjectStore('mutations', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ============================================================
// BACKGROUND SYNC — Process queued mutations
// ============================================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'barbearia-mutations') {
    event.waitUntil(processMutationQueue());
  }
});

async function processMutationQueue() {
  const db = await openMutationQueue();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const index = store.index('timestamp');
    const request = index.openCursor();

    request.onsuccess = async (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve();
        return;
      }

      const mutation = cursor.value;

      try {
        // Replay the mutation
        const response = await fetch(mutation.url, {
          method: mutation.method,
          headers: mutation.headers,
          body: mutation.body,
          credentials: 'same-origin',
        });

        if (response.ok || response.status === 401 || response.status === 403) {
          // Success or auth error (don't retry auth errors)
          await deleteMutation(db, cursor.primaryKey);
          notifyClients('mutation-success', { id: mutation.id, url: mutation.url });
        } else {
          // Server error - increment retry count
          await retryMutation(db, cursor.primaryKey, mutation);
        }
      } catch (error) {
        // Network error - increment retry count
        await retryMutation(db, cursor.primaryKey, mutation);
      }

      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

async function deleteMutation(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function retryMutation(db, id, mutation) {
  const maxRetries = 5;
  const newRetries = mutation.retries + 1;

  if (newRetries >= maxRetries) {
    // Max retries exceeded - notify client and remove
    notifyClients('mutation-failed', {
      id: mutation.id,
      url: mutation.url,
      error: 'Max retries exceeded',
    });
    await deleteMutation(db, id);
    return;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.put({ ...mutation, retries: newRetries });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function notifyClients(type, data) {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type, data });
    });
  });
}

// ============================================================
// PUSH NOTIFICATIONS — Skeleton for Fase 4
// ============================================================
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();

    const options = {
      body: data.body || 'Nova notificação da Barbearia Andrade',
      icon: '/favicon-192.png',
      badge: '/favicon-192.png',
      vibrate: [200, 100, 200],
      data: data.data || {},
      actions: data.actions || [],
      requireInteraction: data.requireInteraction || false,
      tag: data.tag || 'barbearia-notification',
      renotify: true,
    };

    event.waitUntil(self.registration.showNotification(data.title || 'Barbearia Andrade', options));
  } catch (error) {
    console.error('[SW] Push notification error:', error);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const url = data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      // Try to focus existing window
      for (const client of clients) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('notificationclose', (event) => {
  // Track notification dismissal if needed
  console.log('[SW] Notification closed:', event.notification.tag);
});

// ============================================================
// MESSAGE HANDLING — Communication with clients
// ============================================================
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      event.ports[0]?.postMessage({ version: SW_VERSION });
      break;

    case 'CLEAR_CACHE':
      clearAllCaches().then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    case 'QUEUE_MUTATION':
      queueMutation(payload.request).then((id) => {
        event.ports[0]?.postMessage({ success: true, id });
      });
      break;

    case 'GET_QUEUE_STATUS':
      getQueueStatus().then((status) => {
        event.ports[0]?.postMessage({ status });
      });
      break;

    default:
      console.log('[SW] Unknown message type:', type);
  }
});

async function getQueueStatus() {
  const db = await openMutationQueue();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const store = tx.objectStore('mutations');
    const req = store.count();
    req.onsuccess = () => resolve({ pending: req.result });
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// OFFLINE FALLBACK PAGE
// ============================================================
async function createOfflinePage() {
  const cache = await caches.open(CACHE_OFFLINE);
  const offlineHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Offline — Barbearia Andrade</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="theme-color" content="#D4A843">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: #faf8f3;
      color: #1a1f2e;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 400px;
      background: white;
      border-radius: 16px;
      padding: 40px 30px;
      box-shadow: 0 4px 20px rgba(26,31,46,0.1);
      border: 1px solid #e8e4df;
    }
    .icon {
      width: 80px; height: 80px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #fdf0f1, #fef9e7);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #f5c6ca;
    }
    .icon svg { width: 40px; height: 40px; color: #c41e3a; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 12px; color: #1a1f2e; }
    p { color: #5c5242; line-height: 1.6; margin-bottom: 24px; }
    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 24px;
      background: linear-gradient(135deg, #c41e3a, #e8455d);
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(196,30,58,0.3); }
    .btn:active { transform: translateY(0); }
    .btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(196,30,58,0.25); }
    .details { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e8e4df; font-size: 0.875rem; color: #7d7262; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 1l22 22"></path>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
        <path d="M1.42 9a16 16 0 0 1 11.84-3.95"></path>
      </svg>
    </div>
    <h1>Você está offline</h1>
    <p>Não foi possível conectar ao servidor. Algumas funcionalidades podem não estar disponíveis.</p>
    <button class="btn" onclick="window.location.reload()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </svg>
      Tentar novamente
    </button>
    <div class="details">
      <p>Os dados do painel do barbeiro (agenda de hoje, histórico de clientes) ficam disponíveis offline após o primeiro carregamento.</p>
      <p>Operações como "Concluir agendamento" e "Adicionar observação" serão sincronizadas automaticamente quando a conexão voltar.</p>
    </div>
  </div>
  <script>
    // Auto-retry when online
    window.addEventListener('online', () => window.location.reload());
  </script>
</body>
</html>`;

  await cache.put('/offline.html', new Response(offlineHtml, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));
}

async function getOfflinePage() {
  const cache = await caches.open(CACHE_OFFLINE);
  const cached = await cache.match('/offline.html');
  if (cached) return cached;

  // Fallback if offline page not cached
  return new Response(
    '<h1>Offline</h1><p>Não foi possível carregar a página. Verifique sua conexão.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// ============================================================
// CACHE GOOGLE FONTS ON INSTALL
// ============================================================
async function cacheGoogleFonts(fontCache) {
  const fontCssUrl = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&display=swap';

  try {
    const response = await fetch(fontCssUrl);
    if (response.ok) {
      const cssText = await response.text();

      // Extract font URLs from CSS
      const fontUrls = cssText.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g) || [];

      // Cache the CSS
      await fontCache.put(fontCssUrl, new Response(cssText, { headers: { 'Content-Type': 'text/css' } }));

      // Cache font files
      await Promise.all(
        fontUrls.map(async (match) => {
          const fontUrl = match.slice(4, -1); // Remove url() wrapper
          try {
            const fontResponse = await fetch(fontUrl);
            if (fontResponse.ok) {
              await fontCache.put(fontUrl, fontResponse);
            }
          } catch (e) {
            console.log('[SW] Failed to cache font:', fontUrl, e);
          }
        })
      );
    }
  } catch (error) {
    console.log('[SW] Google Fonts precache failed:', error);
  }
}

// ============================================================
// HELPER: event.waitUntil wrapper
// ============================================================
function eventWaitUntil(promise) {
  // This is called from within event handlers that have waitUntil available
  // We can't directly call it here, so we use a trick:
  // The fetch handler can call this, but for other places we need to ensure
  // the promise is awaited properly.
  // For background updates from cached responses, we just fire and forget
  // but log errors.
  promise.catch((err) => console.log('[SW] Background update failed:', err));
}

// ============================================================
// CLEAR ALL CACHES (for development/debugging)
// ============================================================
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => caches.delete(name)));
  console.log('[SW] All caches cleared');
}

// ============================================================
// PERIODIC CACHE CLEANUP (optional - run on activate)
// ============================================================
async function cleanupOldApiCache() {
  const cache = await caches.open(CACHE_API);
  const requests = await cache.keys();
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

  for (const request of requests) {
    const response = await cache.match(request);
    if (response) {
      const cachedAt = parseInt(response.headers.get('sw-cached-at') || '0');
      if (now - cachedAt > maxAge) {
        await cache.delete(request);
      }
    }
  }
}

// Run cleanup on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(cleanupOldApiCache());
});

console.log('[SW] Service Worker loaded:', SW_VERSION);