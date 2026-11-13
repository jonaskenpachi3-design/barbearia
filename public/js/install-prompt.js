/**
 * Install Prompt Component — Navalha Barbearia PWA
 * Handles beforeinstallprompt event, shows custom install button/banner
 * Provides a native-like install experience
 */

'use strict';

(function () {
  'use strict';

  let deferredPrompt = null;
  let installButton = null;
  let installBanner = null;
  let isInstalled = false;

  // Check if app is already installed
  function checkIfInstalled() {
    // Check for standalone mode (PWA installed)
    if (window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true) {
      isInstalled = true;
      return true;
    }

    // Check for installed PWA via localStorage flag
    if (localStorage.getItem('pwa_installed') === 'true') {
      isInstalled = true;
      return true;
    }

    return false;
  }

  // Create install button element
  function createInstallButton() {
    if (installButton) return installButton;

    installButton = document.createElement('button');
    installButton.id = 'pwa-install-btn';
    installButton.type = 'button';
    installButton.className = 'pwa-install-btn';
    installButton.setAttribute('aria-label', 'Instalar aplicativo');
    installButton.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Instalar App</span>
    `;
    installButton.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: linear-gradient(135deg, #D4A843, #B8860B);
      color: #111111;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(212, 168, 67, 0.3);
      font-family: inherit;
    `;

    installButton.addEventListener('mouseenter', () => {
      installButton.style.transform = 'translateY(-1px)';
      installButton.style.boxShadow = '0 4px 16px rgba(212, 168, 67, 0.4)';
    });

    installButton.addEventListener('mouseleave', () => {
      installButton.style.transform = 'translateY(0)';
      installButton.style.boxShadow = '0 2px 8px rgba(212, 168, 67, 0.3)';
    });

    installButton.addEventListener('click', handleInstallClick);

    return installButton;
  }

  // Create install banner element
  function createInstallBanner() {
    if (installBanner) return installBanner;

    installBanner = document.createElement('div');
    installBanner.id = 'pwa-install-banner';
    installBanner.className = 'pwa-install-banner';
    installBanner.setAttribute('role', 'banner');
    installBanner.innerHTML = `
      <div class="banner-content">
        <div class="banner-icon" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </div>
        <div class="banner-text">
          <strong>Instale a Navalha Barbearia</strong>
          <span>Acesse mais rápido, trabalhe offline e receba notificações</span>
        </div>
      </div>
      <div class="banner-actions">
        <button type="button" class="btn-install" id="banner-install-btn">Instalar</button>
        <button type="button" class="btn-dismiss" id="banner-dismiss-btn" aria-label="Dispensar">✕</button>
      </div>
    `;

    installBanner.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      right: 20px;
      max-width: 480px;
      margin: 0 auto;
      background: #171717;
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      border: 1px solid #353535;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: slideUp 0.3s ease;
      font-family: 'Inter', system-ui, sans-serif;
    `;

    // Add styles for banner elements
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .pwa-install-banner .banner-content {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }
      .pwa-install-banner .banner-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: rgba(212, 168, 67, 0.12);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #f0d98a;
        flex-shrink: 0;
      }
      .pwa-install-banner .banner-text {
        flex: 1;
        min-width: 0;
      }
      .pwa-install-banner .banner-text strong {
        display: block;
        font-size: 15px;
        color: #f4eedf;
        margin-bottom: 4px;
      }
      .pwa-install-banner .banner-text span {
        display: block;
        font-size: 13px;
        color: #c6beaf;
        line-height: 1.4;
      }
      .pwa-install-banner .banner-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
      }
      .pwa-install-banner .btn-install {
        padding: 10px 20px;
        background: linear-gradient(135deg, #D4A843, #B8860B);
        color: #111111;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .pwa-install-banner .btn-install:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(212, 168, 67, 0.4);
      }
      .pwa-install-banner .btn-dismiss {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        border: 1px solid #353535;
        background: #141414;
        color: #aaa394;
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .pwa-install-banner .btn-dismiss:hover {
        background: #202020;
        color: #f0d98a;
        border-color: rgba(212, 168, 67, 0.36);
      }
      @media (max-width: 480px) {
        .pwa-install-banner {
          left: 12px !important;
          right: 12px !important;
          bottom: 12px !important;
          border-radius: 12px;
        }
      }
    `;
    document.head.appendChild(style);

    // Event listeners
    installBanner.querySelector('#banner-install-btn').addEventListener('click', handleInstallClick);
    installBanner.querySelector('#banner-dismiss-btn').addEventListener('click', dismissBanner);

    return installBanner;
  }

  // Handle install button click
  async function handleInstallClick() {
    if (!deferredPrompt) {
      // Fallback: show instructions for manual install
      showManualInstallInstructions();
      return;
    }

    // Show the native install prompt
    deferredPrompt.prompt();

    // Wait for user response
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      console.log('[InstallPrompt] User accepted install');
      markAsInstalled();
      hideInstallUI();
    } else {
      console.log('[InstallPrompt] User dismissed install');
    }

    // Clear the deferred prompt (can only be used once)
    deferredPrompt = null;
  }

  // Show manual install instructions for browsers that don't support beforeinstallprompt
  function showManualInstallInstructions() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    let message = '';
    if (isIOS) {
      message = 'Para instalar: toque no botão Compartilhar (quadrado com seta) e selecione "Adicionar à Tela de Início"';
    } else if (isAndroid) {
      message = 'Para instalar: toque no menu do navegador (⋮) e selecione "Instalar aplicativo" ou "Adicionar à tela inicial"';
    } else {
      message = 'Para instalar: clique no ícone de instalação na barra de endereços ou use o menu do navegador';
    }

    if (window.App && window.App.toast) {
      window.App.toast(message, false);
    } else {
      alert(message);
    }
  }

  // Mark app as installed
  function markAsInstalled() {
    isInstalled = true;
    localStorage.setItem('pwa_installed', 'true');
  }

  // Hide install UI
  function hideInstallUI() {
    if (installButton) {
      installButton.style.display = 'none';
    }
    if (installBanner) {
      installBanner.style.display = 'none';
    }
  }

  // Dismiss banner (don't show again for a while)
  function dismissBanner() {
    if (installBanner) {
      installBanner.style.display = 'none';
    }
    // Don't show banner again for 7 days
    localStorage.setItem('pwa_banner_dismissed', Date.now().toString());
  }

  // Check if banner was recently dismissed
  function wasBannerDismissed() {
    const dismissed = localStorage.getItem('pwa_banner_dismissed');
    if (!dismissed) return false;

    const dismissedTime = parseInt(dismissed, 10);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    return (Date.now() - dismissedTime) < sevenDays;
  }

  // Add install button to a container
  function addInstallButtonTo(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const btn = createInstallButton();
    container.appendChild(btn);
  }

  // Show install banner
  function showInstallBanner() {
    if (isInstalled || wasBannerDismissed()) return;

    // Don't show on login/index/agendar pages
    const isPublicPage = location.pathname.endsWith('index.html') ||
                         location.pathname === '/' ||
                         location.pathname.endsWith('agendar.html');
    if (isPublicPage) return;

    // Only show after user has interacted with the app (heuristic)
    const hasInteracted = sessionStorage.getItem('pwa_user_interacted') === 'true';
    if (!hasInteracted) return;

    const banner = createInstallBanner();
    document.body.appendChild(banner);
  }

  // Track user interaction
  function trackUserInteraction() {
    sessionStorage.setItem('pwa_user_interacted', 'true');

    // Show banner after some delay if conditions are met
    setTimeout(() => {
      if (!isInstalled && deferredPrompt && !wasBannerDismissed()) {
        showInstallBanner();
      }
    }, 30000); // 30 seconds after interaction
  }

  // Initialize install prompt handling
  function init() {
    // Check if already installed
    if (checkIfInstalled()) {
      markAsInstalled();
      return;
    }

    // Listen for beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (event) => {
      // Prevent the mini-infobar from appearing on mobile
      event.preventDefault();

      // Stash the event so it can be triggered later
      deferredPrompt = event;

      console.log('[InstallPrompt] beforeinstallprompt fired, prompt deferred');

      // Show install button in header if there's a designated spot
      const installContainer = document.querySelector('[data-install-button]');
      if (installContainer) {
        addInstallButtonTo('[data-install-button]');
      }

      // Track user interaction to show banner later
      document.addEventListener('click', trackUserInteraction, { once: true, passive: true });
      document.addEventListener('keydown', trackUserInteraction, { once: true, passive: true });
    });

    // Listen for appinstalled event
    window.addEventListener('appinstalled', () => {
      console.log('[InstallPrompt] App installed successfully');
      markAsInstalled();
      hideInstallUI();
    });

    // Also check on load in case it was installed in another tab
    window.addEventListener('focus', () => {
      if (checkIfInstalled()) {
        hideInstallUI();
      }
    });

    // Expose API
    window.InstallPrompt = {
      showBanner: showInstallBanner,
      addButton: addInstallButtonTo,
      isInstalled: () => isInstalled,
      canInstall: () => !!deferredPrompt,
    };
  }

  // Initialize when DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();