(function () {
  window.BRX = window.BRX || {};

  const { APP_ROUTES, THEME_KEY } = window.BRX.config;
  const { currentUser, clearSession } = window.BRX.state;
  const { displayName } = window.BRX.utils;
  const { refs, showToast } = window.BRX.ui;
  const { icon } = window.BRX.icons;
  const notificationService = window.BRX.notificationService;
  let notificationPollTimer = null;

  async function signOut() {
    document.removeEventListener("click", closeFloatingMenusOnOutsideClick);
    if (notificationPollTimer) clearInterval(notificationPollTimer);
    notificationPollTimer = null;
    try {
      await window.BRX.api.requestJson("/auth/logout", { method: "POST" });
    } catch (error) {
      console.error(error);
    }
    clearSession();
    showToast("Signed out");
    location.hash = "#/";
  }

  function appNav(activeRoute) {
    const items = [
      ["dashboard", "Dashboard", "grid"],
      ["market", "P2P", "p2p", ["market", "p2p-chat"]],
      ["ads", "My Ads", "ads"],
      ["trades", "Trades", "trades"],
      ["wallet", "Wallet", "wallet"],
    ];

    return items.map(([route, label, iconName, aliases]) => `<a class="${(aliases || [route]).includes(activeRoute) ? "active" : ""}" href="#/${route}">${icon(iconName)}${label}</a>`).join("");
  }

  function mobileBottomNav(activeRoute) {
    const items = [
      ["dashboard", "Home", "grid", ["dashboard"]],
      ["market", "P2P", "p2p", ["market", "p2p-chat", "ads"]],
      ["trades", "Trades", "trades", ["trades"]],
      ["wallet", "Wallet", "wallet", ["wallet"]],
      ["settings", "Profile", "user", ["settings", "profile", "kyc", "notifications", "referrals"]],
    ];

    return `
      <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
        ${items.map(([route, label, iconName, activeRoutes]) => `
          <a class="${activeRoutes.includes(activeRoute) ? "active" : ""}" href="#/${route}" ${activeRoutes.includes(activeRoute) ? 'aria-current="page"' : ""}>
            ${icon(iconName)}
            <span>${label}</span>
          </a>
        `).join("")}
      </nav>
    `;
  }
  function adminNav() {
    const items = [
      ["adminOverview", "Overview", "grid"],
      ["adminUsers", "Users", "user"],
      ["adminKyc", "KYC", "shield"],
      ["adminDisputes", "Disputes", "trades"],
      ["adminOps", "Operations", "activity"],
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
    document.removeEventListener("click", closeFloatingMenusOnOutsideClick);
    const user = currentUser();
    const route = window.BRX.router.routeName();
    const inApp = Boolean(user && APP_ROUTES.includes(route));
    const adminMode = Boolean(inApp && route === "admin" && user.role === "admin");

    document.querySelectorAll(".mobile-bottom-nav").forEach((nav) => nav.remove());

    refs.siteHeader.classList.toggle("app-header", inApp);
    refs.siteHeader.classList.toggle("admin-header", adminMode);
    refs.brandLink.href = adminMode ? "#/admin" : inApp ? "#/dashboard" : "#/";
    refs.brandLink.setAttribute("aria-label", adminMode ? "BRX admin" : inApp ? "BRX dashboard" : "BRX home");

    if (inApp) {
      const theme = currentTheme();
      refs.nav.innerHTML = adminMode ? adminNav() : appNav(route);
      refs.headerActions.innerHTML = `
        <button class="header-icon" id="themeToggle" type="button" aria-label="Toggle ${theme === "dark" ? "light" : "dark"} mode">${icon(theme === "dark" ? "sun" : "moon")}</button>
        <button class="header-icon notification-button" id="notificationButton" type="button" aria-label="Notifications">${icon("bell")}<span class="notification-dot" id="notificationDot" hidden></span></button>
        <button class="menu-button" id="accountMenuButton" type="button" aria-label="Account menu">${icon("menu")}</button>
        <div class="notification-menu" id="notificationMenu">
          <div class="notification-menu-head"><strong>Notifications</strong><button type="button" id="markAllNotificationsRead">Mark all read</button></div>
          <div class="notification-menu-content" id="notificationMenuContent"><p>Loading alerts...</p></div>
          <a class="notification-view-all" href="#/notifications">View all notifications</a>
        </div>
        <div class="account-menu" id="accountMenu">
          <strong>${displayName(user)}</strong>
          <small>${user.email}</small>
          ${adminMode ? adminMenu() : userMenu(user)}
          <button type="button" id="signOutButton">${icon("logOut")}Sign out</button>
        </div>
      `;

      if (!adminMode) refs.siteHeader.insertAdjacentHTML("afterend", mobileBottomNav(route));

      document.querySelector("#themeToggle").addEventListener("click", toggleTheme);
      document.querySelector("#notificationButton").addEventListener("click", () => {
        document.querySelector("#notificationMenu").classList.toggle("open");
        document.querySelector("#accountMenu").classList.remove("open");
        void refreshNotificationMenu();
      });
      document.querySelector("#accountMenuButton").addEventListener("click", () => {
        document.querySelector("#accountMenu").classList.toggle("open");
        document.querySelector("#notificationMenu").classList.remove("open");
      });
      document.querySelector("#signOutButton").addEventListener("click", signOut);
      document.querySelector("#markAllNotificationsRead")?.addEventListener("click", async () => {
        try {
          await notificationService.markAllRead();
          await refreshNotificationMenu();
        } catch (error) {
          showToast(error.message || "Could not update notifications.");
        }
      });
      startNotificationPolling();
      void refreshNotificationMenu();
      document.addEventListener("click", closeFloatingMenusOnOutsideClick);
      if (adminMode) bindAdminNav();
      return;
    }

    document.removeEventListener("click", closeFloatingMenusOnOutsideClick);
    if (notificationPollTimer) clearInterval(notificationPollTimer);
    notificationPollTimer = null;
    refs.siteHeader.classList.remove("admin-header");
    refs.nav.innerHTML = `
      <a href="#/features">Security</a>
      <a href="#/how-it-works">Trading guide</a>
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
      <a class="text-button" href="#/login">Login</a>
      <a class="primary-button small" href="#/register">Get started</a>
    `;
  }

  function startNotificationPolling() {
    document.removeEventListener("click", closeFloatingMenusOnOutsideClick);
    if (notificationPollTimer) clearInterval(notificationPollTimer);
    notificationPollTimer = setInterval(() => void refreshNotificationMenu(), 30000);
  }

  async function refreshNotificationMenu() {
    const dot = document.querySelector("#notificationDot");
    const content = document.querySelector("#notificationMenuContent");
    if (!dot || !content || !notificationService) return;

    try {
      const result = await notificationService.list(6);
      const items = result.notifications || [];
      const unreadCount = Number(result.unreadCount || 0);
      dot.hidden = unreadCount === 0;
      dot.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      content.innerHTML = items.length
        ? items.map(notificationMenuItem).join("")
        : `<p class="notification-empty">No P2P alerts yet.</p>`;
      bindNotificationLinks(content);
    } catch (error) {
      content.innerHTML = `<p class="notification-empty">Could not load alerts.</p>`;
    }
  }

  function notificationMenuItem(notification) {
    return `
      <button class="notification-menu-item ${notification.isRead ? "" : "unread"}" type="button"
        data-notification-id="${escapeAttr(notification.id)}"
        data-notification-url="${escapeAttr(notificationService.actionUrl(notification))}">
        <span class="notification-menu-icon">${icon(notificationIcon(notification.type))}</span>
        <span><strong>${escapeHtml(notification.title)}</strong><small>${escapeHtml(notification.message)}</small><time>${escapeHtml(notificationService.relativeTime(notification.createdAt))}</time></span>
      </button>
    `;
  }

  function bindNotificationLinks(root) {
    root.querySelectorAll("[data-notification-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await notificationService.markRead(button.dataset.notificationId);
        } catch (error) {
          console.error(error);
        }
        location.hash = button.dataset.notificationUrl || "#/notifications";
      });
    });
  }

  function notificationIcon(type) {
    if (type === "trade.message") return "mail";
    if (type === "trade.payment_sent") return "card";
    if (type === "trade.released") return "wallet";
    if (type === "trade.disputed" || type === "trade.resolved") return "shield";
    if (type === "trade.expired" || type === "trade.cancelled") return "info";
    return "trades";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }
  function adminMenu() {
    return `
      <a href="#/admin">${icon("grid")}Admin overview</a>
      <a href="#/admin" data-admin-scroll="adminKyc">${icon("shield")}KYC queue</a>
      <a href="#/admin" data-admin-scroll="adminDisputes">${icon("trades")}Disputes</a>
      <a href="#/admin" data-admin-scroll="adminOps">${icon("activity")}Operations</a>
      <a href="#/admin" data-admin-scroll="adminLimits">${icon("lock")}Level limits</a>
      <a href="#/admin" data-admin-scroll="adminSettings">${icon("settings")}Admin settings</a>
    `;
  }

  function closeFloatingMenusOnOutsideClick(event) {
    const target = event.target;
    const accountMenu = document.querySelector("#accountMenu");
    const notificationMenu = document.querySelector("#notificationMenu");
    const accountButton = document.querySelector("#accountMenuButton");
    const notificationButton = document.querySelector("#notificationButton");
    const insideAccount = Boolean(accountMenu?.contains(target) || accountButton?.contains(target));
    const insideNotifications = Boolean(notificationMenu?.contains(target) || notificationButton?.contains(target));
    if (!insideAccount) accountMenu?.classList.remove("open");
    if (!insideNotifications) notificationMenu?.classList.remove("open");
  }

  function userMenu(user) {
    const adminMenuLink = user.role === "admin" ? `<a href="#/admin">${icon("shield")}Admin Console</a>` : "";
    return `
      <a href="#/profile">${icon("user")}View Profile</a>
      <a href="#/ads">${icon("market")}My ads</a>
      <a href="#/settings">${icon("settings")}Settings</a>
      ${adminMenuLink}
      <a href="#/referrals">${icon("gift")}Refer & Earn</a>
      <a href="#/wallet">${icon("wallet")}Wallet</a>
    `;
  }

  applyTheme();

  window.BRX.header = { renderHeader, signOut, applyTheme };
})();




