(function () {
  window.BRX = window.BRX || {};

  const { refs } = window.BRX.ui;
  const { renderHeader } = window.BRX.header;
  const pages = window.BRX.pages;

  function routePath() {
    return location.hash.replace(/^#\/?/, "") || "home";
  }

  function routeName() {
    return routePath().split("?")[0] || "home";
  }

  function routeParams() {
    const query = routePath().split("?")[1] || "";
    return new URLSearchParams(query);
  }

  function routeTitle(route) {
    const titles = {
      dashboard: "Dashboard",
      market: "P2P Market",
      order: "P2P Order",
      "p2p-chat": "P2P Chat",
      ads: "My Ads",
      trades: "Trades",
      wallet: "Wallet",
      kyc: "Identity Verification",
      profile: "Profile",
      settings: "Settings",
      notifications: "Notifications",
      referrals: "Refer & Earn",
      admin: "Admin Console",
      login: "Login",
      register: "Create Account",
    };
    return `${titles[route] || "Buy & Sell USDT with ETB"} · BRX`;
  }

  async function render() {
    const route = routeName();
    const requiresAppSession = window.BRX.config.APP_ROUTES.includes(route);
    document.body.classList.remove("payment-proof-open", "dispute-flow-open");
    document.body.dataset.route = route;
    document.title = routeTitle(route);
    refs.app.setAttribute("aria-busy", "true");

    if (requiresAppSession) {
      const hydratedUser = await window.BRX.profileService.hydrateSession();
      if (!hydratedUser) {
        refs.app.setAttribute("aria-busy", "false");
        location.hash = "#/login";
        return;
      }
    }



    if (route === "register") pages.renderRegister();
    else if (route === "login") pages.renderLogin();
    else if (route === "oauth") pages.renderOAuthCallback();
    else if (route === "verify") pages.renderVerify();
    else if (route === "dashboard") pages.renderDashboard();
    else if (route === "market") pages.renderMarket();
    else if (route === "order") pages.renderMarketOrder();
    else if (route === "p2p-chat") pages.renderP2pChat();
    else if (route === "ads") pages.renderAds();
    else if (route === "trades") pages.renderTrades();
    else if (route === "wallet") pages.renderWallet();
    else if (route === "kyc") pages.renderKyc();
    else if (route === "profile") pages.renderProfile();
    else if (route === "settings") pages.renderSettings();
    else if (route === "notifications") pages.renderNotifications();
    else if (route === "referrals") pages.renderReferrals();
    else if (route === "admin") pages.renderAdmin();
    else if (route === "features") pages.renderLanding("features");
    else if (route === "how-it-works") pages.renderLanding("how-it-works");
    else pages.renderLanding();

    renderHeader();
    refs.app.setAttribute("aria-busy", "false");
    refs.app.focus({ preventScroll: true });
  }

  function start() {
    window.addEventListener("hashchange", render);
    void render();
  }

  window.BRX.router = { routeName, routeParams, render, start };
})();

