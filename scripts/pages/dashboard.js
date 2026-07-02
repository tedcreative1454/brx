(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { RATE } = window.BRX.config;
  const { requireUser, currentUser } = window.BRX.state;
  const { refs } = window.BRX.ui;
  const { displayName, format, greeting } = window.BRX.utils;
  const { icon } = window.BRX.icons;

  function renderDashboard() {
    const user = requireUser();
    if (!user) return;

    refs.app.innerHTML = `
      <section class="exchange-app">
        <p class="app-greeting">${greeting()}, <strong>${displayName(user)}</strong></p>
        <div class="app-overview-grid">
          ${walletSummaryCard()}
          ${rateCard()}
        </div>
        ${kycBanner()}
        <div class="shortcut-row">
          ${shortcutCard("Post a New Ad", "Create custom sell or buy orders", "Ad", "#/ads")}
          ${shortcutCard("Transfer USDT", "Send instant funds to BRX users", "USDT", "#/wallet?mode=transfer")}
          ${shortcutCard("Refer & Earn", "Invite friends, earn USDT", "Refer", "#/dashboard")}
        </div>
        <section class="security-strip">
          <span class="mini-icon">2FA</span>
          <div><h3>Enable 2FA</h3><p>Protect your account with an authenticator app before withdrawals.</p></div>
          <button class="app-ghost-button" type="button">Enable</button>
        </section>
      </section>
    `;
  }

  function walletSummaryCard() {
    const balance = normalizedBalance(currentUser());
    const total = Number(balance.available) + Number(balance.locked) + Number(balance.pendingDeposit) + Number(balance.pendingWithdrawal);
    return `
      <section class="app-card wallet-summary dashboard-wallet-compact">
        <div>
          <p class="app-label">Total balance</p>
          <h2>${format(total)} <span>USDT</span></h2>
          <p class="app-muted">Deposit USDT to get started</p>
        </div>
        <div class="wallet-actions">
          ${roundAction("Buy", "buy", "#/market")}
          ${roundAction("Sell", "sell", "#/market")}
          ${roundAction("Deposit", "deposit", "#/wallet?mode=deposit")}
          ${roundAction("Withdraw", "withdraw", "#/wallet?mode=withdraw")}
        </div>
      </section>
    `;
  }

  function rateCard() {
    return `
      <section class="app-card rate-card">
        <div class="rate-head"><p class="app-label blue">Live Rate</p><a class="app-button small" href="#/market">Trade ${icon("market")}</a></div>
        <h2>${format(RATE)} <span>ETB</span></h2>
        <p class="app-muted">Per USDT</p>
        <div class="best-rates"><div><strong>184.00</strong><span>Best buy</span></div><div><strong>186.00</strong><span>Best sell</span></div></div>
      </section>
    `;
  }

  function roundAction(label, tone, href) {
    return `<a class="round-action ${tone}" href="${href}"><strong>${label}</strong></a>`;
  }

  function kycBanner() {
    const user = currentUser();
    const pending = user?.kycStatus === "pending";
    return `
      <a class="kyc-banner" href="#/kyc">
        <div class="kyc-top"><span class="mini-icon">ID</span><div><h3>${pending ? "Identity review pending" : "Verify your identity - unlock 5,000 USDT limits"}</h3><p>${pending ? "Your uploaded documents are waiting for manual admin review." : "Unverified limit is 1,000 USDT. Upload your ID photos and selfie for manual admin review."}</p></div><span class="kyc-open">${pending ? "View" : "Open"}</span></div>
        <div class="kyc-limits">
          <div><span>Unverified</span><strong>1,000 USDT</strong></div>
          <div><span>Verified</span><strong>5,000 USDT</strong></div>
          <div><span>Merchant</span><strong>100,000 USDT</strong></div>
          <div><span>Network</span><strong>BEP20</strong></div>
        </div>
      </a>
    `;
  }

  function shortcutCard(title, text, icon, href) {
    return `<a class="shortcut-card" href="${href}"><span class="mini-icon">${icon}</span><div><h3>${title}</h3><p>${text}</p></div><span class="chevron">></span></a>`;
  }

  function normalizedBalance(user) {
    return user?.balance || window.BRX.profileService.emptyBalance();
  }

  window.BRX.components = { kycBanner };
  window.BRX.pages.renderDashboard = renderDashboard;
})();
