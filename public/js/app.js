'use strict';
// Utilitários compartilhados pelas páginas. Todo texto vai por textContent (sem innerHTML).
(function () {
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]; // semana começando na segunda

  async function req(metodo, url, corpo) {
    const resp = await fetch(url, {
      method: metodo,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resp.text();
    let dados = null;
    if (texto) {
      try { dados = JSON.parse(texto); } catch { /* resposta sem JSON */ }
    }
    if (!resp.ok) {
      const erro = new Error((dados && dados.erro) || 'Algo deu errado. Tente novamente.');
      erro.status = resp.status;
      throw erro;
    }
    return dados;
  }

  const api = {
    get: (url) => req('GET', url),
    post: (url, corpo = {}) => req('POST', url, corpo),
    put: (url, corpo = {}) => req('PUT', url, corpo),
    delete: (url) => req('DELETE', url),
  };

  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

  // el('div', { class: 'x', text: 'oi', onclick: fn }, filho1, 'texto', ...)
  function el(tag, props = {}, ...filhos) {
    const no = tag === 'svg' || tag === 'use'
      ? document.createElementNS(SVG_NAMESPACE, tag)
      : document.createElement(tag);
    for (const [chave, valor] of Object.entries(props)) {
      if (valor === undefined || valor === null || valor === false) continue;
      if (chave === 'class') no.setAttribute('class', valor);
      else if (chave === 'text') no.textContent = valor;
      else if (chave.startsWith('on')) no.addEventListener(chave.slice(2), valor);
      else if (valor === true) no.setAttribute(chave, '');
      else no.setAttribute(chave, valor);
    }
    for (const filho of filhos.flat()) {
      if (filho === undefined || filho === null || filho === false) continue;
      no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
    }
    return no;
  }

  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl = (centavos) => moeda.format(centavos / 100);

  function iniciais(nome) {
    const partes = String(nome).trim().split(/\s+/);
    const a = partes[0] ? partes[0][0] : '';
    const b = partes.length > 1 ? partes[partes.length - 1][0] : (partes[0] || '')[1] || '';
    return (a + b).toUpperCase();
  }

  let temporizador;
  function toast(mensagem, erro = false) {
    let no = document.getElementById('toast');
    if (!no) {
      no = el('div', { id: 'toast', class: 'toast', role: 'status' });
      document.body.append(no);
    }
    no.className = 'toast' + (erro ? ' erro-toast' : '');
    no.textContent = mensagem;
    no.hidden = false;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { no.hidden = true; }, 3500);
  }

  const HOME = { cliente: 'cliente.html', barbeiro: 'barbeiro.html', admin: 'admin.html' };

  // Garante login e papel; redireciona quem não deve estar na página.
  async function exigir(...papeis) {
    try {
      const { usuario } = await api.get('/api/auth/me');
      if (!papeis.includes(usuario.papel)) {
        location.replace(HOME[usuario.papel]);
        return new Promise(() => {});
      }
      return usuario;
    } catch (erro) {
      if (erro.status === 401) {
        location.replace('index.html');
        return new Promise(() => {});
      }
      throw erro;
    }
  }

  async function sair() {
    try { await api.post('/api/auth/logout'); } finally { location.replace('index.html'); }
  }

  // Agrupa horários por dia para exibição.
  function turnosPorDia(horarios) {
    const mapa = new Map(ORDEM_DIAS.map((d) => [d, []]));
    for (const h of horarios) mapa.get(h.dia_semana).push(h);
    return mapa;
  }

  window.App = { api, el, brl, iniciais, toast, exigir, sair, DIAS, ORDEM_DIAS, HOME, turnosPorDia };
})();

// ============================================================
// SERVICE WORKER REGISTRATION
// ============================================================
(function () {
  if ('serviceWorker' in navigator) {
    const SW_URL = '/sw.js';

    async function registerSW() {
      try {
        const registration = await navigator.serviceWorker.register(SW_URL, {
          scope: '/',
        });

        console.log('[SW] Registered:', registration.scope);

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available - notify user
              if (confirm('Nova versão disponível. Atualizar agora?')) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              }
            }
          });
        });

        // Listen for messages from SW
        navigator.serviceWorker.addEventListener('message', (event) => {
          const { type, data } = event.data || {};

          switch (type) {
            case 'mutation-success':
              console.log('[SW] Mutation synced:', data);
              // Optionally show toast
              break;
            case 'mutation-failed':
              console.warn('[SW] Mutation failed after retries:', data);
              window.App.toast?.('Falha ao sincronizar operação offline', true);
              break;
          }
        });

        // Check for updates periodically
        setInterval(() => {
          registration.update().catch(() => {});
        }, 30 * 60 * 1000); // Every 30 minutes

        // Handle controller change (new SW activated)
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });

      } catch (error) {
        console.error('[SW] Registration failed:', error);
      }
    }

    // Register when page loads
    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW);
    }
  }
})();

// ============================================================
// NETWORK STATUS INDICATOR
// ============================================================
(function () {
  'use strict';

  let networkIndicator = null;
  let isOnline = navigator.onLine;
  let pendingCount = 0;
  let checkPendingTimer = null;

  /**
   * Creates the network status indicator element
   */
  function createIndicator() {
    if (networkIndicator) return networkIndicator;

    networkIndicator = document.createElement('div');
    networkIndicator.id = 'network-indicator';
    networkIndicator.setAttribute('role', 'status');
    networkIndicator.setAttribute('aria-live', 'polite');
    networkIndicator.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 900;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.3s ease;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      backdrop-filter: blur(8px);
    `;

    updateIndicator();
    document.body.appendChild(networkIndicator);

    return networkIndicator;
  }

  /**
   * Updates the indicator based on online/offline status
   */
  function updateIndicator() {
    if (!networkIndicator) createIndicator();

    if (isOnline) {
      networkIndicator.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M1 1l22 22"></path>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
          <path d="M1.42 9a16 16 0 0 1 11.84-3.95"></path>
        </svg>
        <span>Online</span>
      `;
      networkIndicator.style.background = 'rgba(26, 127, 55, 0.9)';
      networkIndicator.style.color = 'white';
      networkIndicator.style.border = '1px solid rgba(26, 127, 55, 0.3)';

      if (pendingCount > 0) {
        networkIndicator.innerHTML += `
          <span style="background: #f0d98a; color: #111111; padding: 2px 6px; border-radius: 10px; font-size: 11px;">
            ${pendingCount} pendente${pendingCount > 1 ? 's' : ''}
          </span>
        `;
      }
    } else {
      networkIndicator.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M1 1l22 22"></path>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
          <path d="M1.42 9a16 16 0 0 1 11.84-3.95"></path>
        </svg>
        <span>Offline</span>
      `;
      networkIndicator.style.background = 'rgba(196, 30, 58, 0.9)';
      networkIndicator.style.color = 'white';
      networkIndicator.style.border = '1px solid rgba(196, 30, 58, 0.3)';

      if (pendingCount > 0) {
        networkIndicator.innerHTML += `
          <span style="background: #f0d98a; color: #111111; padding: 2px 6px; border-radius: 10px; font-size: 11px;">
            ${pendingCount} em fila
          </span>
        `;
      }
    }
  }

  /**
   * Checks pending mutations count from IndexedDB
   */
  async function checkPendingCount() {
    if (!('indexedDB' in window)) return;

    try {
      const db = await openMutationDB();
      const count = await getPendingCount(db);
      pendingCount = count;
      updateIndicator();
    } catch (e) {
      console.log('[Network] Could not check pending count:', e);
    }
  }

  /**
   * Opens the mutation queue database (shared with SW)
   */
  function openMutationDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('BarbeariaSW', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getPendingCount(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('mutations', 'readonly');
      const store = tx.objectStore('mutations');
      const index = store.index('timestamp');
      const request = index.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Handles online event
   */
  function handleOnline() {
    console.log('[Network] Online');
    isOnline = true;
    updateIndicator();

    // Trigger background sync if supported
    if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
      navigator.serviceWorker.ready.then(registration => {
        registration.sync.register('barbearia-mutations').catch(() => {});
      });
    }

    // Check pending count after sync
    setTimeout(checkPendingCount, 2000);
  }

  /**
   * Handles offline event
   */
  function handleOffline() {
    console.log('[Network] Offline');
    isOnline = false;
    updateIndicator();
  }

  /**
   * Initializes the network status indicator
   */
  function init() {
    // Only show on authenticated pages (not login/index)
    const isAuthPage = !location.pathname.endsWith('index.html') &&
                       !location.pathname.endsWith('/') &&
                       !location.pathname.endsWith('agendar.html');

    if (!isAuthPage) return;

    createIndicator();
    updateIndicator();

    // Listen for network changes
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic check for pending mutations (every 30 seconds)
    checkPendingTimer = setInterval(checkPendingCount, 30000);
    checkPendingCount(); // Initial check

    // Listen for messages from SW about mutation status
    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type, data } = event.data || {};
      if (type === 'mutation-success' || type === 'mutation-failed') {
        checkPendingCount();
      }
    });

    // Expose for debugging
    window.NetworkStatus = {
      isOnline: () => isOnline,
      checkPending: checkPendingCount,
      getPendingCount: () => pendingCount,
    };
  }

  // Initialize when DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();

// ============================================================
// OFFLINE-AWARE API CLIENT (extends window.App.api)
// ============================================================
(function () {
  'use strict';

  const MUTATION_ENDPOINTS = [
    '/api/agendamentos/',
    '/api/clientes/',
    '/api/caixa/',
    '/api/vendas',
    '/api/produtos/',
    '/api/servicos/',
    '/api/barbeiros/',
    '/api/bloqueios/',
  ];

  /**
   * Checks if a URL is a mutation endpoint
   */
  function isMutation(url) {
    return MUTATION_ENDPOINTS.some(endpoint => url.includes(endpoint));
  }

  /**
   * Determines HTTP method from URL pattern for mutations
   */
  function getMutationMethod(url, originalMethod) {
    if (originalMethod !== 'GET') return originalMethod;

    // For barbeiro actions that are actually PUTs
    if (url.includes('/confirmar') || url.includes('/concluir') || url.includes('/cancelar')) {
      return 'PUT';
    }
    if (url.includes('/observacoes')) {
      return 'POST';
    }
    return 'POST';
  }

  /**
   * Original fetch wrapper
   */
  async function originalFetch(method, url, body) {
    const resp = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const texto = await resp.text();
    let dados = null;
    if (texto) {
      try { dados = JSON.parse(texto); } catch { /* resposta sem JSON */ }
    }
    if (!resp.ok) {
      const erro = new Error((dados && dados.erro) || 'Algo deu errado. Tente novamente.');
      erro.status = resp.status;
      throw erro;
    }
    return dados;
  }

  /**
   * Queues a mutation in IndexedDB
   */
  async function queueMutation(mutation) {
    if (!('indexedDB' in window)) {
      throw new Error('IndexedDB não disponível');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open('BarbeariaSW', 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('mutations')) {
          const store = db.createObjectStore('mutations', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const body = typeof mutation.body === 'string' ? mutation.body : JSON.stringify(mutation.body || {});

        const mutationRecord = {
          id: Date.now() + Math.random(),
          url: mutation.url,
          method: mutation.method,
          headers: mutation.headers,
          body,
          timestamp: Date.now(),
          retries: 0,
        };

        const tx = db.transaction('mutations', 'readwrite');
        const store = tx.objectStore('mutations');
        const addRequest = store.add(mutationRecord);
        addRequest.onsuccess = () => resolve(addRequest.result);
        addRequest.onerror = () => reject(addRequest.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Registers background sync
   */
  async function registerBackgroundSync() {
    if (!('serviceWorker' in navigator) || !('sync' in window.ServiceWorkerRegistration.prototype)) {
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('barbearia-mutations');
    } catch (error) {
      console.warn('[API] Background sync registration failed:', error);
    }
  }

  /**
   * Offline-aware API methods
   */
  const offlineApi = {
    get: async (url) => {
      // GET requests always try network first, cache handles offline reads
      return originalFetch('GET', url);
    },

    post: async (url, body = {}) => {
      return offlineAwareFetch('POST', url, body);
    },

    put: async (url, body = {}) => {
      return offlineAwareFetch('PUT', url, body);
    },

    delete: async (url) => {
      return offlineAwareFetch('DELETE', url);
    },
  };

  /**
   * Core offline-aware fetch function
   */
  async function offlineAwareFetch(method, url, body) {
    // If online, try direct fetch first
    if (navigator.onLine) {
      try {
        const result = await originalFetch(method, url, body);
        // If the response indicates it was queued by SW, treat as success
        if (result && result.queued) {
          window.App.toast?.('Operação enfileirada para sincronização', false);
          return result;
        }
        return result;
      } catch (error) {
        // If it's an auth error, don't queue - rethrow
        if (error.status === 401 || error.status === 403) {
          throw error;
        }
        // Network or server error - fall through to queue
        console.log('[API] Fetch failed, queueing:', error.message);
      }
    }

    // Offline or failed - queue the mutation
    const mutationMethod = getMutationMethod(url, method);
    try {
      await queueMutation({
        url,
        method: mutationMethod,
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      // Register for background sync
      await registerBackgroundSync();

      // Show user-friendly message
      window.App.toast?.('Operação salva offline. Será sincronizada quando conectar.', false);

      return {
        queued: true,
        message: 'Operação enfileirada para sincronização quando online',
      };
    } catch (queueError) {
      console.error('[API] Failed to queue mutation:', queueError);
      throw new Error('Não foi possível salvar a operação offline. Tente novamente.');
    }
  }

  // Replace the original api with offline-aware version
  window.App.api = offlineApi;

  // Expose for debugging
  window.App.offlineApi = {
    isOnline: () => navigator.onLine,
    queueMutation,
    registerBackgroundSync,
  };
})();