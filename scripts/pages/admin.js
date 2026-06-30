(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { requireUser } = window.BRX.state;
  const { refs, showToast } = window.BRX.ui;
  const { icon } = window.BRX.icons;
  const { format } = window.BRX.utils;
  const adminService = window.BRX.adminService;

  let adminState = { stats: null, submissions: [], selected: null, limits: [], disputes: [], users: [], deposits: [], withdrawals: [], trades: [], auditLogs: [] };

  function renderAdmin() {
    const user = requireUser();
    if (!user) return;
    if (user.role !== "admin") {
      refs.app.innerHTML = `
        <section class="exchange-app app-page-narrow">
          <section class="warning-card"><h3>Admin access required</h3><p>This area is only available to BRX admins.</p></section>
        </section>
      `;
      return;
    }

    refs.app.innerHTML = `
      <section class="exchange-app app-page-wide admin-page">
        <section id="adminOverview" class="admin-hero">
          <div class="settings-head">
            <p class="app-label blue">Admin</p>
            <h2>BRX Operations Dashboard</h2>
            <p>Monitor users, KYC reviews, escrow disputes, marketplace activity, and risk limits.</p>
          </div>
          <div id="adminStats" class="admin-stats-grid">${loadingBlock("Loading platform statistics")}</div>
        </section>

        <section id="adminKyc" class="admin-section">
          <div class="admin-section-head">
            <div><p class="app-label blue">Identity</p><h3>KYC Review Queue</h3></div>
            <span class="settings-badge neutral">Manual review</span>
          </div>
          <div class="admin-grid">
            <section class="settings-card settings-card-flat admin-queue">
              <div class="settings-card-head"><div><h3>${icon("shield")} Pending Submissions</h3><p>Newest pending documents appear first.</p></div></div>
              <div id="kycQueue">${loadingBlock("Loading KYC submissions")}</div>
            </section>

            <section class="settings-card settings-card-flat admin-detail">
              <div class="settings-card-head"><div><h3>${icon("user")} Submission Detail</h3><p>Open an item to inspect uploaded ID and selfie files.</p></div></div>
              <div id="kycDetail">${emptyBlock("No submission selected", "Choose a KYC submission from the queue.")}</div>
            </section>
          </div>
        </section>

        <section id="adminDisputes" class="settings-card settings-card-flat admin-disputes-card">
          <div class="settings-card-head"><div><h3>${icon("trades")} Trade Disputes</h3><p>Resolve locked escrow to buyer or seller after reviewing evidence.</p></div></div>
          <div id="disputeQueue">${loadingBlock("Loading disputes")}</div>
        </section>

        <section id="adminOps" class="settings-card settings-card-flat admin-ops-card">
          <div class="settings-card-head"><div><h3>${icon("activity")} Operations</h3><p>Users, wallet operations, trade activity, and audit logs.</p></div><button class="app-button small" type="button" id="processWithdrawals">Process withdrawals</button></div>
          <div id="adminOpsBody">${loadingBlock("Loading operations")}</div>
        </section>

        <section id="adminLimits" class="settings-card settings-form-card admin-limits-card">
          <div class="settings-card-head"><div><h3>${icon("lock")} Tier Limits</h3><p>Limits are stored in PostgreSQL and used by risk checks.</p></div></div>
          <div id="limitEditor">${loadingBlock("Loading tier limits")}</div>
        </section>

        <section id="adminSettings" class="settings-card settings-card-flat admin-settings-card">
          <div class="settings-card-head"><div><h3>${icon("settings")} Admin Settings</h3><p>Launch configuration and operator-only controls.</p></div></div>
          <div class="admin-settings-grid">
            ${settingTile("Domain", "brxp2p.com", "Production domain reserved for launch.")}
            ${settingTile("Custody model", "Platform controlled", "Deposits and withdrawals use platform wallets.")}
            ${settingTile("Primary network", "USDT BEP20", "BNB Smart Chain through the wallet service.")}
            ${settingTile("Email provider", "Resend", "Verification and security emails.")}
            ${settingTile("Manual KYC", "Enabled", "Admins approve, reject, and set higher limits.")}
            ${settingTile("Escrow ledger", "Database only", "P2P trades do not broadcast blockchain transactions.")}
          </div>
        </section>
      </section>
    `;

    void loadAdminData();
  }

  async function loadAdminData() {
    const jobs = {
      stats: adminService.stats(),
      kyc: adminService.listKyc(),
      limits: adminService.limits(),
      disputes: adminService.listDisputes(),
      users: adminService.listUsers(),
      deposits: adminService.listDeposits(),
      withdrawals: adminService.listWithdrawals(),
      trades: adminService.listTrades(),
      auditLogs: adminService.listAuditLogs(),
    };

    const entries = await Promise.all(
      Object.entries(jobs).map(async ([key, promise]) => {
        try {
          return [key, { ok: true, value: await promise }];
        } catch (error) {
          return [key, { ok: false, error }];
        }
      }),
    );
    const result = Object.fromEntries(entries);

    adminState.stats = result.stats.ok ? result.stats.value.stats || null : null;
    adminState.submissions = result.kyc.ok ? result.kyc.value.submissions || [] : [];
    adminState.limits = result.limits.ok ? result.limits.value.limits || [] : [];
    adminState.disputes = result.disputes.ok ? result.disputes.value.disputes || [] : [];
    adminState.users = result.users.ok ? result.users.value.users || [] : [];
    adminState.deposits = result.deposits.ok ? result.deposits.value.deposits || [] : [];
    adminState.withdrawals = result.withdrawals.ok ? result.withdrawals.value.withdrawals || [] : [];
    adminState.trades = result.trades.ok ? result.trades.value.trades || [] : [];
    adminState.auditLogs = result.auditLogs.ok ? result.auditLogs.value.auditLogs || [] : [];

    renderStats();
    renderKycQueue();
    renderDisputes();
    renderLimitEditor();
    renderOperations();

    if (!result.stats.ok) document.querySelector("#adminStats").innerHTML = errorBlock(adminError(result.stats.error, "Could not load platform statistics."));
    if (!result.kyc.ok) document.querySelector("#kycQueue").innerHTML = errorBlock(adminError(result.kyc.error, "Could not load KYC submissions."));
    if (!result.disputes.ok) document.querySelector("#disputeQueue").innerHTML = errorBlock(adminError(result.disputes.error, "Could not load disputes."));
    if (!result.limits.ok) document.querySelector("#limitEditor").innerHTML = errorBlock(adminError(result.limits.error, "Could not load tier limits."));
    if (![result.users, result.deposits, result.withdrawals, result.trades, result.auditLogs].every((item) => item.ok)) {
      const failed = [result.users, result.deposits, result.withdrawals, result.trades, result.auditLogs].find((item) => !item.ok);
      document.querySelector("#adminOpsBody").innerHTML = errorBlock(adminError(failed?.error, "Could not load operations."));
    }
  }

  function adminError(error, fallback) {
    return error?.message || fallback;
  }

  function renderStats() {
    const stats = adminState.stats;
    const target = document.querySelector("#adminStats");
    if (!stats) {
      target.innerHTML = emptyBlock("No stats loaded", "Backend statistics are unavailable.");
      return;
    }

    target.innerHTML = `
      ${statCard("Total users", number(stats.users?.total), "Registered BRX accounts", "user")}
      ${statCard("Email verified", number(stats.users?.emailVerified), "Accounts ready to sign in", "mail")}
      ${statCard("Pending KYC", number(stats.users?.kycPending), "Waiting for admin review", "shield")}
      ${statCard("Open disputes", number(stats.marketplace?.openDisputes), "Needs admin decision", "trades")}
      ${statCard("Active offers", number(stats.marketplace?.activeOffers), "Visible in marketplace", "market")}
      ${statCard("Open trades", number(stats.marketplace?.openTrades), "Payment or escrow active", "activity")}
      ${statCard("Locked escrow", `${money(stats.balances?.lockedUsdt)} USDT`, "Seller funds currently locked", "lock")}
      ${statCard("Pending withdrawals", number(stats.operations?.pendingWithdrawals), "Auto-approved queue", "upload")}
      ${statCard("Broadcasting", number(stats.operations?.broadcastWithdrawals), "Waiting on-chain confirmation", "wallet")}
      ${statCard("Suspended users", number(stats.users?.suspended), "Frozen accounts", "shield")}
    `;
  }

  function statCard(label, value, detail, iconName) {
    return `
      <article class="admin-stat-card">
        <span class="admin-stat-icon">${icon(iconName)}</span>
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>
      </article>
    `;
  }

  function renderKycQueue() {
    const queue = document.querySelector("#kycQueue");
    queue.innerHTML = adminState.submissions.length
      ? `<div class="admin-list">${adminState.submissions.map(queueRow).join("")}</div>`
      : emptyBlock("No KYC submissions", "Submitted ID/selfie uploads will appear here.");

    document.querySelectorAll("[data-kyc-open]").forEach((button) => {
      button.addEventListener("click", () => loadKycDetail(button.dataset.kycOpen));
    });
  }

  async function loadKycDetail(id) {
    const detail = document.querySelector("#kycDetail");
    detail.innerHTML = loadingBlock("Loading documents");
    try {
      adminState.selected = await adminService.getKyc(id);
      renderKycDetail();
    } catch (error) {
      detail.innerHTML = errorBlock(error.message || "Could not load KYC detail.");
    }
  }

  function renderKycDetail() {
    const detail = document.querySelector("#kycDetail");
    const selected = adminState.selected;
    if (!selected?.submission) {
      detail.innerHTML = emptyBlock("No submission selected", "Choose a KYC submission from the queue.");
      return;
    }
    const submission = selected.submission;
    detail.innerHTML = `
      <div class="admin-submission-summary">
        <div><span>Email</span><strong>${escapeHtml(submission.email || "")}</strong></div>
        <div><span>Name</span><strong>${escapeHtml(submission.fullName)}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(submission.phone)}</strong></div>
        <div><span>ID</span><strong>${escapeHtml(submission.idType)} - ${escapeHtml(submission.idNumber)}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(submission.status)}</strong></div>
      </div>
      <div class="kyc-image-grid">
        ${kycImage("Front ID", selected.files?.documentFront)}
        ${kycImage("Back ID", selected.files?.documentBack)}
        ${kycImage("Selfie", selected.files?.selfie)}
        ${kycImage("Payment proof", selected.files?.paymentProof)}
      </div>
      <div class="admin-actions">
        <button class="app-button" type="button" id="approveKyc">Approve</button>
        <button class="danger-button" type="button" id="rejectKyc">Reject</button>
      </div>
    `;
    document.querySelector("#approveKyc").addEventListener("click", () => approveKyc(submission.id));
    document.querySelector("#rejectKyc").addEventListener("click", () => rejectKyc(submission.id));
  }

  function renderDisputes() {
    const queue = document.querySelector("#disputeQueue");
    queue.innerHTML = adminState.disputes.length
      ? `<div class="admin-list dispute-list">${adminState.disputes.map(disputeRow).join("")}</div>`
      : emptyBlock("No open disputes", "Disputed trades with locked escrow will appear here.");

    document.querySelectorAll("[data-resolve-dispute]").forEach((button) => {
      button.addEventListener("click", () => resolveDispute(button.dataset.resolveDispute, button.dataset.resolution));
    });
  }

  function disputeRow(trade) {
    return `
      <div class="admin-queue-row admin-dispute-row">
        <span>
          <strong>${format(Number(trade.assetAmount))} USDT - ${format(Number(trade.fiatAmount))} KES</strong>
          <small>Buyer: ${escapeHtml(trade.buyerEmail || "")}</small>
          <small>Seller: ${escapeHtml(trade.sellerEmail || "")}</small>
          <small>Reason: ${escapeHtml(trade.disputeReason || "No reason saved")}</small>
          ${evidenceLinks(trade.evidence)}
        </span>
        <span class="admin-actions inline">
          <button class="app-button small" type="button" data-resolve-dispute="${escapeAttr(trade.id)}" data-resolution="buyer">Release to buyer</button>
          <button class="danger-button small" type="button" data-resolve-dispute="${escapeAttr(trade.id)}" data-resolution="seller">Return to seller</button>
        </span>
      </div>
    `;
  }

  function evidenceLinks(evidence) {
    const items = Array.isArray(evidence) ? evidence : [];
    if (!items.length) return `<small>No evidence files attached</small>`;
    return `<small>${items.map((item, index) => item.fileUrl ? `<a href="${escapeAttr(item.fileUrl)}" target="_blank" rel="noreferrer">Evidence ${index + 1}</a>` : `Note ${index + 1}: ${escapeHtml(item.note || "")}`).join(" - ")}</small>`;
  }
  async function resolveDispute(tradeId, resolution) {
    const note = prompt(`Resolution note for ${resolution}?`);
    try {
      await adminService.resolveDispute(tradeId, resolution, note || "Admin resolved dispute.");
      showToast("Dispute resolved.");
      const [stats, disputes] = await Promise.all([adminService.stats(), adminService.listDisputes()]);
      adminState.stats = stats.stats || null;
      adminState.disputes = disputes.disputes || [];
      renderStats();
      renderDisputes();
    } catch (error) {
      showToast(error.message || "Could not resolve dispute.");
    }
  }

  async function approveKyc(id) {
    try {
      await adminService.approveKyc(id);
      showToast("KYC approved.");
      adminState.selected = null;
      await loadAdminData();
      document.querySelector("#kycDetail").innerHTML = emptyBlock("Submission updated", "Choose another item from the queue.");
    } catch (error) {
      showToast(error.message || "Could not approve KYC.");
    }
  }

  async function rejectKyc(id) {
    const reason = prompt("Why is this KYC being rejected?");
    if (!reason) return;
    try {
      await adminService.rejectKyc(id, reason);
      showToast("KYC rejected.");
      adminState.selected = null;
      await loadAdminData();
      document.querySelector("#kycDetail").innerHTML = emptyBlock("Submission updated", "Choose another item from the queue.");
    } catch (error) {
      showToast(error.message || "Could not reject KYC.");
    }
  }

  function renderOperations() {
    const body = document.querySelector("#adminOpsBody");
    if (!body) return;
    body.innerHTML = `
      <div class="admin-ops-grid">
        ${operationPanel("Users", adminState.users.slice(0, 8).map(userRow).join("") || emptyInline("No users yet"))}
        ${operationPanel("Withdrawals", adminState.withdrawals.slice(0, 8).map(withdrawalRow).join("") || emptyInline("No withdrawals yet"))}
        ${operationPanel("Deposits", adminState.deposits.slice(0, 8).map(depositRow).join("") || emptyInline("No deposits yet"))}
        ${operationPanel("Trades", adminState.trades.slice(0, 8).map(tradeRow).join("") || emptyInline("No trades yet"))}
        ${operationPanel("Audit logs", adminState.auditLogs.slice(0, 10).map(auditRow).join("") || emptyInline("No audit logs yet"))}
      </div>
    `;

    document.querySelectorAll("[data-user-status]").forEach((button) => {
      button.addEventListener("click", () => changeUserStatus(button.dataset.userId, button.dataset.userStatus));
    });
    document.querySelector("#processWithdrawals")?.addEventListener("click", processWithdrawals);
  }

  function operationPanel(title, content) {
    return `<article class="admin-operation-panel"><h4>${escapeHtml(title)}</h4><div class="admin-mini-list">${content}</div></article>`;
  }

  function userRow(user) {
    const frozen = user.status === "suspended";
    return `
      <div class="admin-mini-row">
        <span><strong>${escapeHtml(user.email)}</strong><small>${escapeHtml(user.role || "user")} - ${escapeHtml(user.kycStatus || "unsubmitted")} - ${escapeHtml(user.status)}</small></span>
        <button class="outline-button tiny" type="button" data-user-id="${escapeAttr(user.id)}" data-user-status="${frozen ? "active" : "suspended"}">${frozen ? "Unfreeze" : "Freeze"}</button>
      </div>
    `;
  }

  function withdrawalRow(item) {
    return `<div class="admin-mini-row"><span><strong>${money(item.amount)} USDT</strong><small>${escapeHtml(item.email)} - ${escapeHtml(item.status)}${item.txHash ? ` - ${escapeHtml(item.txHash.slice(0, 12))}...` : ""}</small></span></div>`;
  }

  function depositRow(item) {
    return `<div class="admin-mini-row"><span><strong>${money(item.amount)} USDT</strong><small>${escapeHtml(item.email)} - ${escapeHtml(item.status)} - ${Number(item.confirmations || 0)} conf</small></span></div>`;
  }

  function tradeRow(item) {
    return `<div class="admin-mini-row"><span><strong>${money(item.assetAmount)} USDT</strong><small>${escapeHtml(item.status)} - ${escapeHtml(item.buyerEmail || "buyer")} / ${escapeHtml(item.sellerEmail || "seller")}</small></span></div>`;
  }

  function auditRow(item) {
    return `<div class="admin-mini-row"><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.actorEmail || "system")} - ${escapeHtml(item.entityType)}</small></span></div>`;
  }

  function emptyInline(text) {
    return `<div class="admin-mini-row muted"><span>${escapeHtml(text)}</span></div>`;
  }

  async function changeUserStatus(userId, status) {
    const reason = prompt(`${status === "suspended" ? "Freeze" : "Unfreeze"} reason?`) || "Admin status change";
    try {
      await adminService.updateUserStatus(userId, status, reason);
      showToast(status === "suspended" ? "User frozen." : "User reactivated.");
      const [stats, users, auditLogs] = await Promise.all([adminService.stats(), adminService.listUsers(), adminService.listAuditLogs()]);
      adminState.stats = stats.stats || null;
      adminState.users = users.users || [];
      adminState.auditLogs = auditLogs.auditLogs || [];
      renderStats();
      renderOperations();
    } catch (error) {
      showToast(error.message || "Could not update user.");
    }
  }

  async function processWithdrawals() {
    try {
      const result = await adminService.processWithdrawals();
      showToast(`Withdrawal worker: ${Number(result.broadcasted || 0)} broadcasted, ${Number(result.withdrawalConfirmed || 0)} confirmed.`);
      const [stats, withdrawals, auditLogs] = await Promise.all([adminService.stats(), adminService.listWithdrawals(), adminService.listAuditLogs()]);
      adminState.stats = stats.stats || null;
      adminState.withdrawals = withdrawals.withdrawals || [];
      adminState.auditLogs = auditLogs.auditLogs || [];
      renderStats();
      renderOperations();
    } catch (error) {
      showToast(error.message || "Could not process withdrawals.");
    }
  }
  function renderLimitEditor() {
    const editor = document.querySelector("#limitEditor");
    editor.innerHTML = adminState.limits.length
      ? `<form id="limitsForm" class="limit-editor">${adminState.limits.map(limitRow).join("")}<button class="app-button" type="submit">Save limits</button></form>`
      : emptyBlock("No limits loaded", "Run migrations to create account_limits.");
    document.querySelector("#limitsForm")?.addEventListener("submit", handleLimitSave);
  }

  async function handleLimitSave(event) {
    event.preventDefault();
    try {
      const updates = adminState.limits.map((limit) => adminService.updateLimit(limit.tier, {
        dailyTradeLimitUsd: document.querySelector(`#daily-${limit.tier}`).value,
        withdrawalLimitUsd: document.querySelector(`#withdrawal-${limit.tier}`).value,
      }));
      await Promise.all(updates);
      showToast("Tier limits saved.");
      const limits = await adminService.limits();
      adminState.limits = limits.limits || [];
      renderLimitEditor();
      renderOperations();
    } catch (error) {
      showToast(error.message || "Could not save limits.");
    }
  }

  function queueRow(submission) {
    return `
      <button class="admin-queue-row" type="button" data-kyc-open="${escapeAttr(submission.id)}">
        <span><strong>${escapeHtml(submission.fullName)}</strong><small>${escapeHtml(submission.email || "")}</small></span>
        <span class="settings-badge ${submission.status === "approved" ? "success" : submission.status === "rejected" ? "warning" : "neutral"}">${escapeHtml(submission.status)}</span>
      </button>
    `;
  }

  function limitRow(limit) {
    const title = limit.tier.charAt(0).toUpperCase() + limit.tier.slice(1);
    return `
      <div class="limit-row">
        <strong>${title}</strong>
        <label class="form-field"><span>Daily trade USD</span><input id="daily-${escapeAttr(limit.tier)}" inputmode="decimal" value="${escapeAttr(limit.dailyTradeLimitUsd)}" /></label>
        <label class="form-field"><span>Withdrawal USD</span><input id="withdrawal-${escapeAttr(limit.tier)}" inputmode="decimal" value="${escapeAttr(limit.withdrawalLimitUsd)}" /></label>
      </div>
    `;
  }

  function settingTile(label, value, detail) {
    return `
      <div class="admin-setting-tile">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(detail)}</small>
      </div>
    `;
  }

  function kycImage(label, file) {
    if (!file?.dataUrl) return `<div class="kyc-image-card empty"><strong>${label}</strong><span>No file</span></div>`;
    return `<figure class="kyc-image-card"><img src="${file.dataUrl}" alt="${escapeAttr(label)}" /><figcaption>${label}</figcaption></figure>`;
  }

  function loadingBlock(text) {
    return `<div class="settings-empty"><span class="mini-icon">...</span><strong>${escapeHtml(text)}</strong></div>`;
  }

  function emptyBlock(title, detail) {
    return `<div class="settings-empty"><span class="mini-icon">ID</span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
  }

  function errorBlock(message) {
    return `<div class="warning-card"><h3>Admin error</h3><p>${escapeHtml(message)}</p></div>`;
  }

  function number(value) {
    return String(Number(value || 0).toLocaleString());
  }

  function money(value) {
    return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  window.BRX.pages.renderAdmin = renderAdmin;
})();


