(function () {
  window.BRX = window.BRX || {};

  const { APP_ROUTES, THEME_KEY } = window.BRX.config;
  const { currentUser, clearSession } = window.BRX.state;
  const { displayName } = window.BRX.utils;
  const { refs, showToast } = window.BRX.ui;
  const { icon } = window.BRX.icons;

  function signOut() {
    clearSession();
    showToast("Signed out");
    location.hash = "#/";
  }

  function appNav(activeRoute) {
    const items = [
      ["dashboard", "Dashboard", "grid"],
      ["market", "Market", "market"],
      ["ads", "My Ads", "ads"],
      ["trades", "Trades", "trades"],
      ["wallet", "Wallet", "wallet"],
    ];

    return items.map(([route, label, iconName]) => `<a class="${activeRoute === route ? "active" : ""}" href="#/${route}">${icon(iconName)}${label}</a>`).join("");
  }

  function adminNav() {
    const items = [
      ["adminOverview", "Overview", "grid"],
      ["adminKyc", "KYC", "shield"],
      ["adminDisputes", "Disputes", "trades"],
      ["adminLimits", "Limits", "lock"],
      ["adminSettings", "Settings", "settings"],
    ];

    return items.map(([target, label, iconName], index) => `<button class="${index === 0 ? "active" : ""}" type="button" data-admin-scroll="${target}">${icon(iconName)}${label}</button>`).join("");
  }

  function currentTheme() {
    return localStorage.getItem(THEME_KEY) || "dark";
  }

  function applyTheme(theme = currentTheme()) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }

  function toggleTheme() {
    const nextTheme = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    renderHeader();
    showToast(`${nextTheme === "dark" ? "Dark" : "Light"} mode enabled`);
  }

  function bindAdminNav() {
    document.querySelectorAll("[data-admin-scroll]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = document.querySelector(`#${button.dataset.adminScroll}`);
        if (!target) return;
        document.querySelectorAll("[data-admin-scroll]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function renderHeader() {
    const user = currentUser();
    const route = window.BRX.router.routeName();
    const inApp = Boolean(user && APP_ROUTES.includes(route));
    const adminMode = Boolean(inApp && route === "admin" && user.role === "admin");

    refs.siteHeader.classList.toggle("app-header", inApp);
    refs.siteHeader.classList.toggle("admin-header", adminMode);
    refs.brandLink.href = adminMode ? "#/admin" : inApp ? "#/dashboard" : "#/";
    refs.brandLink.setAttribute("aria-label", adminMode ? "BRX admin" : inApp ? "BRX dashboard" : "BRX home");

    if (inApp) {
      const theme = currentTheme();
      refs.nav.innerHTML = adminMode ? adminNav() : appNav(route);
      refs.headerActions.innerHTML = `
        <button class="header-icon" id="themeToggle" type="button" aria-label="Toggle ${theme === "dark" ? "light" : "dark"} mode">${icon(theme === "dark" ? "sun" : "moon")}</button>
        <button class="header-icon notification-button" id="notificationButton" type="button" aria-label="Notifications">${icon("bell")}<span class="notification-dot"></span></button>
        <button class="menu-button" id="accountMenuButton" type="button" aria-label="Account menu">${icon("menu")}</button>
        <div class="notification-menu" id="notificationMenu">
          <strong>Notifications</strong>
          <p>No new alerts. KYC decisions, disputes, deposit events, and withdrawal reviews will appear here.</p>
        </div>
        <div class="account-menu" id="accountMenu">
          <strong>${displayName(user)}</strong>
          <small>${user.email}</small>
          ${adminMode ? adminMenu() : userMenu(user)}
          <button type="button" id="signOutButton">${icon("logOut")}Sign out</button>
        </div>
      `;

      document.querySelector("#themeToggle").addEventListener("click", toggleTheme);
      document.querySelector("#notificationButton").addEventListener("click", () => {
        document.querySelector("#notificationMenu").classList.toggle("open");
        document.querySelector("#accountMenu").classList.remove("open");
      });
      document.querySelector("#accountMenuButton").addEventListener("click", () => {
        document.querySelector("#accountMenu").classList.toggle("open");
        document.querySelector("#notificationMenu").classList.remove("open");
      });
      document.querySelector("#signOutButton").addEventListener("click", signOut);
      if (adminMode) bindAdminNav();
      return;
    }

    refs.siteHeader.classList.remove("admin-header");
    refs.nav.innerHTML = `
      <a href="#/features">Features</a>
      <a href="#/how-it-works">How it works</a>
    `;

    if (user) {
      refs.headerActions.innerHTML = `
        <a class="text-button" href="#/dashboard">Dashboard</a>
        <button class="secondary-button small" type="button" id="signOutButton">Sign out</button>
      `;
      document.querySelector("#signOutButton").addEventListener("click", signOut);
      return;
    }

    refs.headerActions.innerHTML = `
      <a class="text-button" href="#/login">Sign in</a>
      <a class="primary-button small" href="#/register">Get started</a>
    `;
  }

  function adminMenu() {
    return `
      <a href="#/admin">${icon("grid")}Admin overview</a>
      <a href="#/admin" data-admin-scroll="adminKyc">${icon("shield")}KYC queue</a>
      <a href="#/admin" data-admin-scroll="adminDisputes">${icon("trades")}Disputes</a>
      <a href="#/admin" data-admin-scroll="adminLimits">${icon("lock")}Tier limits</a>
      <a href="#/admin" data-admin-scroll="adminSettings">${icon("settings")}Admin settings</a>
    `;
  }

  function userMenu(user) {
    const adminMenuLink = user.role === "admin" ? `<a href="#/admin">${icon("shield")}Admin Console</a>` : "";
    return `
      <a href="#/profile">${icon("user")}View Profile</a>
      <a href="#/ads">${icon("ads")}My Ads</a>
      <a href="#/settings">${icon("settings")}Account Settings</a>
      ${adminMenuLink}
      <a href="#/referrals">${icon("gift")}Refer & Earn</a>
      <a href="#/dashboard">${icon("grid")}Dashboard</a>
      <a href="#/wallet">${icon("wallet")}Wallet</a>
    `;
  }

  applyTheme();

  window.BRX.header = { renderHeader, signOut, applyTheme };
})();
