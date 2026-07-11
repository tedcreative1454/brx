(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { RATE, SELL_RATE } = window.BRX.config;
  const { requireUser, currentUser } = window.BRX.state;
  const { refs } = window.BRX.ui;
  const { displayName, format, greeting } = window.BRX.utils;
  const { icon } = window.BRX.icons;
  const BALANCE_VISIBILITY_KEY = "brx.balanceHidden";

  function renderDashboard() {
    const user = requireUser();
    if (!user) return;

    const rawName = displayName(user);
    const name = escapeHtml(rawName);
    const status = kycMeta(user);

    refs.app.innerHTML = `
      <section class="exchange-app dashboard-page">
        <header class="dashboard-welcome">
          <div>
            <p class="dashboard-eyebrow">Account overview</p>
            <h1>${greeting()}, ${name}</h1>
          </div>
          <a class="dashboard-profile-status" href="#/settings?tab=profile" aria-label="Open account settings">
            ${profileAvatar(user, rawName)}
            <span class="dashboard-profile-copy"><small>Signed in as</small><strong>${name}</strong><em><i class="${status.tone}"></i>${status.label}</em></span>
            <span class="dashboard-profile-open">${icon("external")}</span>
          </a>
        </header>

        <div class="dashboard-primary-grid">
          ${walletSummaryCard()}
          ${rateCard()}
        </div>

        <section class="dashboard-quick-section" aria-labelledby="quickActionsTitle">
          <div class="dashboard-section-heading">
            <div><p class="dashboard-eyebrow">Workspace</p><h2 id="quickActionsTitle">Quick access</h2></div>
            <a href="#/wallet">View wallet ${icon("external")}</a>
          </div>
          <div class="dashboard-shortcuts">
            ${shortcutCard("Post an ad", "Create a P2P buy or sell offer", "ads", "#/ads")}
            ${shortcutCard("Transfer USDT", "Send funds to another BRX user", "send", "#/wallet?mode=transfer")}
            ${shortcutCard("Trade history", "Track active and completed orders", "trades", "#/trades")}
            ${shortcutCard("Refer & earn", "Invite friends to join BRX", "gift", "#/referrals")}
          </div>
        </section>

        <div class="dashboard-account-grid">
          ${kycBanner()}
          ${securityCard()}
        </div>
      </section>
    `;
    bindDashboardEvents();
  }

  function walletSummaryCard() {
    const balance = normalizedBalance(currentUser());
    const available = Number(balance.available) || 0;
    const locked = Number(balance.locked) || 0;
    const pendingDeposit = Number(balance.pendingDeposit) || 0;
    const pendingWithdrawal = Number(balance.pendingWithdrawal) || 0;
    const pending = pendingDeposit + pendingWithdrawal;
    const total = available + locked + pending;
    const hidden = isBalanceHidden();

    return `
      <section class="dashboard-balance-card ${hidden ? "is-hidden" : ""}">
        <div class="dashboard-card-head">
          <div><span class="dashboard-card-icon">${icon("wallet")}</span><div><h2>Total balance</h2></div></div>
          <button class="dashboard-balance-toggle" id="dashboardBalanceToggle" type="button" aria-pressed="${hidden}" aria-label="${hidden ? "Show balance" : "Hide balance"}" title="${hidden ? "Show balance" : "Hide balance"}">${icon(hidden ? "eye" : "eyeOff")}</button>
        </div>

        <div class="dashboard-balance-value">
          <strong>${hidden ? hiddenAmount() : `$${format(total)}`}</strong>
          <small>${hidden ? "Balance hidden" : `&asymp; ${format(total * RATE)} ETB at the reference rate`}</small>
        </div>

        <div class="dashboard-balance-breakdown">
          ${balanceItem("Available", available, "available", hidden)}
          ${pending > 0 ? balanceItem("Pending", pending, "pending", hidden) : ""}
        </div>

        <div class="dashboard-wallet-actions">
          ${walletAction("Buy", "buyArrow", "buy", "#/market")}
          ${walletAction("Sell", "sellArrow", "sell", "#/market")}
          ${walletAction("Deposit", "download", "neutral", "#/wallet?mode=deposit")}
          ${walletAction("Withdraw", "upload", "neutral", "#/wallet?mode=withdraw")}
        </div>
      </section>
    `;
  }

  function rateCard() {
    return `
      <section class="dashboard-market-card">
        <div class="dashboard-card-head">
          <div><span class="dashboard-card-icon market">${icon("activity")}</span><div><p class="dashboard-eyebrow">P2P market</p><h2>Reference rate</h2></div></div>
          <span class="dashboard-live"><i></i>Live</span>
        </div>

        <div class="dashboard-rate-value"><strong>${format(RATE)}</strong><span>ETB / USDT</span></div>

        <div class="dashboard-rate-range">
          <div><span>Sell reference</span><strong class="sell">${format(SELL_RATE)}</strong></div>
          <div><span>Buy reference</span><strong>${format(RATE)}</strong></div>
        </div>

        <p class="dashboard-escrow-note">${icon("shield")} Seller funds are secured in BRX escrow during every trade.</p>
        <a class="dashboard-market-link" href="#/market">Open P2P market ${icon("external")}</a>
      </section>
    `;
  }

  function walletAction(label, iconName, tone, href) {
    return `<a class="dashboard-wallet-action ${tone}" href="${href}"><span>${icon(iconName)}</span><strong>${label}</strong></a>`;
  }

  function balanceItem(label, value, tone, hidden = false) {
    return `<div class="${tone}"><span>${label}</span><strong>${hidden ? hiddenAmount() : `$${format(value)}`}</strong></div>`;
  }


  function bindDashboardEvents() {
    document.querySelector("#dashboardBalanceToggle")?.addEventListener("click", () => {
      setBalanceHidden(!isBalanceHidden());
      renderDashboard();
    });
  }

  function isBalanceHidden() {
    try {
      return localStorage.getItem(BALANCE_VISIBILITY_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function setBalanceHidden(hidden) {
    try {
      localStorage.setItem(BALANCE_VISIBILITY_KEY, hidden ? "1" : "0");
    } catch (error) {
      console.error(error);
    }
  }

  function hiddenAmount() {
    return "****";
  }
  function kycBanner() {
    const meta = kycMeta(currentUser());
    return `
      <a class="dashboard-status-card kyc" href="#/kyc">
        <div class="dashboard-status-icon">${icon("shield")}</div>
        <div class="dashboard-status-copy">
          <div><p class="dashboard-eyebrow">Identity verification</p><span class="dashboard-status-badge ${meta.tone}">${meta.label}</span></div>
          <h3>${meta.title}</h3>
          <p>${meta.copy}</p>
          <div class="dashboard-status-progress"><span style="width:${meta.progress}%"></span></div>
          <small>${meta.limit}</small>
        </div>
        <span class="dashboard-status-arrow">${icon("external")}</span>
      </a>
    `;
  }

  function securityCard() {
    return `
      <a class="dashboard-status-card security" href="#/settings?tab=security">
        <div class="dashboard-status-icon">${icon("fingerprint")}</div>
        <div class="dashboard-status-copy">
          <div><p class="dashboard-eyebrow">Account security</p><span class="dashboard-status-badge neutral">Review</span></div>
          <h3>Protect your BRX account</h3>
          <p>Manage two-factor authentication, active sessions, and your sign-in password.</p>
          <ul><li>${icon("check")} Authenticator protection</li><li>${icon("check")} Session controls</li></ul>
        </div>
        <span class="dashboard-status-arrow">${icon("external")}</span>
      </a>
    `;
  }

  function shortcutCard(title, text, iconName, href) {
    return `
      <a class="dashboard-shortcut" href="${href}">
        <span class="dashboard-shortcut-icon">${icon(iconName)}</span>
        <div><h3>${title}</h3><p>${text}</p></div>
        <span class="dashboard-shortcut-arrow">${icon("external")}</span>
      </a>
    `;
  }

  function kycMeta(user) {
    const status = String(user?.kycStatus || "unsubmitted").toLowerCase();
    if (status === "approved") {
      return { label: "Verified", tone: "success", title: "Identity verified", copy: "Your account has increased limits and full verified access.", limit: "Current account limit: 5,000 USDT", progress: 100 };
    }
    if (status === "pending") {
      return { label: "In review", tone: "pending", title: "Verification is being reviewed", copy: "Your documents are with the BRX review team. You can check their status anytime.", limit: "Current account limit: 1,000 USDT", progress: 66 };
    }
    if (status === "rejected") {
      return { label: "Action needed", tone: "danger", title: "Update your verification", copy: "Review the feedback and submit clear, current identity documents.", limit: "Current account limit: 1,000 USDT", progress: 28 };
    }
    return { label: "Unverified", tone: "neutral", title: "Unlock higher trading limits", copy: "Verify your identity to increase your account limit and build trust with traders.", limit: "1,000 USDT now · 5,000 USDT after verification", progress: 32 };
  }

  function profileAvatar(user, fallbackName) {
    const avatarUrl = String(user?.avatarUrl || "").trim();
    if (avatarUrl) {
      return `<span class="dashboard-avatar has-image" aria-hidden="true"><img src="${escapeAttr(avatarUrl)}" alt="" /></span>`;
    }
    return `<span class="dashboard-avatar" aria-hidden="true">${initials(fallbackName)}</span>`;
  }

  function initials(name) {
    return String(name).split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "BR";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[character]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function normalizedBalance(user) {
    return user?.balance || window.BRX.profileService.emptyBalance();
  }

  window.BRX.components = { ...(window.BRX.components || {}), kycBanner };
  window.BRX.pages.renderDashboard = renderDashboard;
})();

