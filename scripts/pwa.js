(function () {
  window.BRX = window.BRX || {};

  const DISMISS_UNTIL_KEY = "brx_pwa_install_dismissed_until";
  const INSTALLED_KEY = "brx_pwa_installed";
  const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
  const PROMPT_DELAY_MS = 1800;
  const INSTALL_SKIP_ROUTES = new Set(["oauth", "verify"]);

  let deferredInstallPrompt = null;
  let promptTimer = 0;

  function initPwaInstall() {
    registerServiceWorker();

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      scheduleInstallPrompt();
    });

    window.addEventListener("appinstalled", () => {
      markInstalled();
      closeInstallPrompt();
    });

    window.addEventListener("hashchange", scheduleInstallPrompt);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleInstallPrompt();
    });
    window.setTimeout(scheduleInstallPrompt, PROMPT_DELAY_MS);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("BRX service worker registration failed", error));
    });
  }

  function scheduleInstallPrompt() {
    window.clearTimeout(promptTimer);
    if (!shouldOfferInstall()) return;
    promptTimer = window.setTimeout(showInstallPrompt, PROMPT_DELAY_MS);
  }

  function shouldOfferInstall() {
    if (document.querySelector(".pwa-install-backdrop")) return false;
    if (!isMobileDevice()) return false;
    if (isStandalone()) return false;
    if (localStorage.getItem(INSTALLED_KEY) === "1") return false;
    if (Number(localStorage.getItem(DISMISS_UNTIL_KEY) || 0) > Date.now()) return false;
    if (INSTALL_SKIP_ROUTES.has(routeName())) return false;
    return Boolean(deferredInstallPrompt || isIosSafari() || isAndroid());
  }

  function showInstallPrompt() {
    if (!shouldOfferInstall()) return;
    const sheet = document.createElement("div");
    sheet.className = "pwa-install-backdrop";
    sheet.innerHTML = promptMarkup();
    document.body.appendChild(sheet);

    sheet.querySelector("[data-pwa-close]")?.addEventListener("click", dismissInstallPrompt);
    sheet.querySelector("[data-pwa-later]")?.addEventListener("click", dismissInstallPrompt);
    sheet.querySelector("[data-pwa-install]")?.addEventListener("click", handleInstallClick);
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) dismissInstallPrompt();
    });
  }

  function promptMarkup() {
    const canInstall = Boolean(deferredInstallPrompt);
    const ios = isIosSafari();
    const title = canInstall ? "Install BRX" : "Add BRX to Home Screen";
    const copy = canInstall ? "Open BRX like an app and keep P2P trading one tap away." : "Install BRX from your browser menu for a full-screen app feel.";
    return `
      <section class="pwa-install-sheet" role="dialog" aria-modal="true" aria-labelledby="pwaInstallTitle">
        <span class="pwa-install-handle" aria-hidden="true"></span>
        <button class="pwa-install-close" type="button" data-pwa-close aria-label="Close install prompt">x</button>
        <div class="pwa-install-head">
          <span class="pwa-install-icon"><img src="./assets/brx-icon-192.png" alt="" /></span>
          <div><h2 id="pwaInstallTitle">${title}</h2><p>${copy}</p></div>
        </div>
        <div class="pwa-install-benefits" aria-label="BRX app benefits">
          <span>Fast launch</span><span>Live trades</span><span>Secure escrow</span>
        </div>
        ${canInstall ? installActionMarkup() : instructionMarkup(ios)}
      </section>
    `;
  }

  function installActionMarkup() {
    return `
      <div class="pwa-install-actions">
        <button class="app-button" type="button" data-pwa-install>Install app</button>
        <button class="app-ghost-button" type="button" data-pwa-later>Maybe later</button>
      </div>
    `;
  }

  function instructionMarkup(ios) {
    const firstStep = ios ? "Tap the Share button in Safari." : "Open the browser menu.";
    return `
      <ol class="pwa-install-steps">
        <li><span>1</span><p>${firstStep}</p></li>
        <li><span>2</span><p>Choose <strong>Add to Home Screen</strong>.</p></li>
        <li><span>3</span><p>Tap <strong>Add</strong> to confirm.</p></li>
      </ol>
      <button class="app-ghost-button pwa-install-later" type="button" data-pwa-later>Got it, maybe later</button>
    `;
  }

  async function handleInstallClick() {
    if (!deferredInstallPrompt) return dismissInstallPrompt();
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
    if (choice.outcome === "accepted") markInstalled();
    else dismissInstallPrompt();
    closeInstallPrompt();
  }

  function dismissInstallPrompt() {
    localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_MS));
    closeInstallPrompt();
  }

  function closeInstallPrompt() {
    document.querySelector(".pwa-install-backdrop")?.remove();
  }

  function markInstalled() {
    localStorage.setItem(INSTALLED_KEY, "1");
    localStorage.removeItem(DISMISS_UNTIL_KEY);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function isMobileDevice() {
    return window.matchMedia("(max-width: 820px)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  function isIosSafari() {
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod/i.test(ua) && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function routeName() {
    return location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
  }

  window.BRX.pwaInstall = { init: initPwaInstall, show: showInstallPrompt };
})();