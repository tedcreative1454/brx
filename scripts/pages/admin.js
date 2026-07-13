(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { requireUser } = window.BRX.state;
  const { refs, showToast } = window.BRX.ui;
  const { icon } = window.BRX.icons;
  const { format } = window.BRX.utils;
  const adminService = window.BRX.adminService;
  const components = window.BRX.components;

  let adminState = { stats: null, treasury: null, platformSettings: null, submissions: [], selected: null, limits: [], disputes: [], users: [], deposits: [], withdrawals: [], trades: [], auditLogs: [] };
  let adminUserSearch = "";
  let adminUserStatusFilter = "all";

  function renderAdmin() {
    const user = requireUser();
    if (!user) return;
    if (user.role !== "admin") {
      refs.app.innerHTML = `
        <section class="exchange-app app-page-narrow admin-access-denied">
          <section class="warning-card">${icon("shield")}<div><h3>Admin access required</h3><p>This operations area is restricted to authorized BRX administrators.</p></div><a class="app-ghost-button small" href="#/dashboard">Return to dashboard</a></section>
        </section>
      `;
      return;
    }

    refs.app.innerHTML = `
      <section class="exchange-app app-page-wide admin-page admin-console-page">
        <header id="adminOverview" class="admin-console-hero">
          <div class="admin-console-title">
            <span class="admin-console-mark">${icon("shield")}</span>
            <div><p class="app-label blue">Restricted operations</p><h1>BRX Admin Console</h1><p>Monitor platform health, review identities, protect escrow, and control operational risk.</p></div>
          </div>
          <div class="admin-console-actions">
            <span class="admin-access-badge"><i></i>Administrator</span>
            <button class="admin-refresh-button" id="refreshAdmin" type="button">${icon("activity")} Refresh data</button>
          </div>
        </header>

        <section class="admin-console-section admin-metrics-section">
          <div class="admin-console-section-head"><div><p class="app-label">Platform overview</p><h2>Live operations</h2></div><span>Database-backed metrics</span></div>
          <div id="adminStats" class="admin-stats-grid professional-admin-stats">${loadingBlock("Loading platform statistics")}</div>
        </section>

        <section id="adminUsers" class="admin-console-section admin-users-section">
          <div class="admin-console-section-head">
            <div><p class="app-label blue">User management</p><h2>Accounts</h2><small>Search users, review verification state, and freeze suspicious accounts quickly.</small></div>
            <span class="admin-section-badge">${icon("user")} Manage users</span>
          </div>
          <div id="adminUsersBody">${loadingBlock("Loading users")}</div>
        </section>

        <section id="adminKyc" class="admin-console-section admin-review-section">
          <div class="admin-console-section-head">
            <div><p class="app-label blue">Identity operations</p><h2>KYC review center</h2><small>Inspect submitted documents before changing account limits.</small></div>
            <span class="admin-section-badge">${icon("shield")} Manual decision</span>
          </div>
          <div class="admin-grid professional-admin-review-grid">
            <section class="admin-console-panel admin-queue">
              <div class="admin-panel-head"><div><span>${icon("activity")}</span><div><h3>Review queue</h3><p>Newest submissions appear first.</p></div></div></div>
              <div id="kycQueue">${loadingBlock("Loading KYC submissions")}</div>
            </section>
            <section class="admin-console-panel admin-detail">
              <div class="admin-panel-head"><div><span>${icon("user")}</span><div><h3>Submission details</h3><p>Select a user to inspect their files.</p></div></div></div>
              <div id="kycDetail">${emptyBlock("No submission selected", "Choose a KYC submission from the review queue.")}</div>
            </section>
          </div>
        </section>

        <section id="adminDisputes" class="admin-console-section admin-disputes-card">
          <div class="admin-console-section-head"><div><p class="app-label blue">Escrow protection</p><h2>Trade disputes</h2><small>Review evidence before releasing or returning locked USDT.</small></div><span class="admin-section-badge warning">${icon("trades")} Decision required</span></div>
          <div id="disputeQueue">${loadingBlock("Loading disputes")}</div>
        </section>

        <section id="adminOps" class="admin-console-section admin-ops-card">
          <div class="admin-console-section-head"><div><p class="app-label blue">Operations feed</p><h2>Platform activity</h2><small>Users, deposits, withdrawals, trades, and immutable audit events.</small></div><div class="admin-console-actions"><button class="admin-process-button" type="button" id="retryDepositSweeps">${icon("download")} Retry deposit sweeps</button><button class="admin-process-button" type="button" id="processWithdrawals">${icon("upload")} Process withdrawals</button></div></div>
          <div id="adminOpsBody">${loadingBlock("Loading operations")}</div>
        </section>

        <div class="admin-console-bottom-grid">
          <section id="adminLimits" class="admin-console-section admin-limits-card">
            <div class="admin-console-section-head"><div><p class="app-label blue">Risk controls</p><h2>Level limits</h2><small>Enforced by PostgreSQL risk checks.</small></div>${icon("lock")}</div>
            <div id="limitEditor">${loadingBlock("Loading level limits")}</div>
          </section>

          <section id="adminSettings" class="admin-console-section admin-settings-card">
            <div class="admin-console-section-head"><div><p class="app-label blue">System profile</p><h2>Launch configuration</h2><small>Read-only summary of production services.</small></div>${icon("settings")}</div>
            <div class="admin-settings-grid">${adminSettingsTiles()}</div>
          </section>
        </div>
      </section>
    `;

    document.querySelector("#refreshAdmin")?.addEventListener("click", (event) => refreshAdminConsole(event.currentTarget));
    document.querySelector("#retryDepositSweeps")?.addEventListener("click", (event) => retryDepositSweeps(event.currentTarget));
    void loadAdminData();
  }

  async function retryDepositSweeps(button) {
    button.disabled = true;
    try {
      const result = await adminService.retryDepositSweeps();
      showToast(`Sweep retry finished: ${result.broadcast || 0} broadcast, ${result.gasFunded || 0} gas funded, ${result.failed || 0} failed.`);
      await loadAdminData();
    } catch (error) {
      showToast(error.message || "Could not retry deposit sweeps.");
    } finally {
      button.disabled = false;
    }
  }

  async function refreshAdminConsole(button) {
    if (button) {
      button.disabled = true;
      button.textContent = "Refreshing...";
    }
    try {
      await loadAdminData();
      showToast("Admin data refreshed.");
    } catch (error) {
      showToast(error.message || "Could not refresh admin data.");
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = `${icon("activity")} Refresh data`;
      }
    }
  }

  async function loadAdminData() {
    const jobs = {
      stats: adminService.stats(),
      treasury: adminService.treasury(),
      platformSettings: adminService.platformSettings(),
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
    adminState.treasury = result.treasury.ok ? result.treasury.value.treasury || null : null;
    adminState.platformSettings = result.platformSettings.ok ? result.platformSettings.value.settings || null : null;
    adminState.submissions = result.kyc.ok ? result.kyc.value.submissions || [] : [];
    adminState.limits = result.limits.ok ? result.limits.value.limits || [] : [];
    adminState.disputes = result.disputes.ok ? result.disputes.value.disputes || [] : [];
    adminState.users = result.users.ok ? result.users.value.users || [] : [];
    adminState.deposits = result.deposits.ok ? result.deposits.value.deposits || [] : [];
    adminState.withdrawals = result.withdrawals.ok ? result.withdrawals.value.withdrawals || [] : [];
    adminState.trades = result.trades.ok ? result.trades.value.trades || [] : [];
    adminState.auditLogs = result.auditLogs.ok ? result.auditLogs.value.auditLogs || [] : [];

    renderStats();
    renderAdminUsers();
    renderKycQueue();
    renderDisputes();
    renderLimitEditor();
    renderOperations();
    renderAdminSettings();

    if (!result.platformSettings.ok) showToast(adminError(result.platformSettings.error, "Could not load platform settings."));
    if (!result.stats.ok) document.querySelector("#adminStats").innerHTML = errorBlock(adminError(result.stats.error, "Could not load platform statistics."));
    if (!result.users.ok) document.querySelector("#adminUsersBody").innerHTML = errorBlock(adminError(result.users.error, "Could not load users."));
    if (!result.kyc.ok) document.querySelector("#kycQueue").innerHTML = errorBlock(adminError(result.kyc.error, "Could not load KYC submissions."));
    if (!result.disputes.ok) document.querySelector("#disputeQueue").innerHTML = errorBlock(adminError(result.disputes.error, "Could not load disputes."));
    if (!result.limits.ok) document.querySelector("#limitEditor").innerHTML = errorBlock(adminError(result.limits.error, "Could not load level limits."));
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
      ${statCard("Completed transactions", number(stats.operations?.completedTransactions), "Trades, deposits and withdrawals", "check")}
      ${statCard("P2P volume", `$${money(stats.volume?.completedTradeUsdt)} / ${money(stats.volume?.completedTradeEtb)} ETB`, "Completed trade volume", "trades")}
      ${statCard("Deposit volume", `$${money(stats.volume?.creditedDepositUsdt)}`, "Credited on-chain deposits", "download")}
      ${statCard("Withdrawal volume", `$${money(stats.volume?.confirmedWithdrawalUsdt)}`, `$${money(stats.volume?.deliveredWithdrawalUsdt)} delivered`, "upload")}
      ${statCard("Fee revenue", `$${money(stats.volume?.feeRevenueUsdt)}`, "Confirmed platform fees", "wallet")}
      ${statCard("Locked escrow", `${money(stats.balances?.lockedUsdt)} USDT`, "Seller funds currently locked", "lock")}
      ${statCard("Pending withdrawals", number(stats.operations?.pendingWithdrawals), "Auto-approved queue", "upload")}
      ${statCard("Broadcasting", number(stats.operations?.broadcastWithdrawals), "Waiting on-chain confirmation", "wallet")}
      ${statCard("Suspended users", number(stats.users?.suspended), "Frozen accounts", "shield")}
    `;
  }

  function statCard(label, value, detail, iconName) {
    return `
      <article class="admin-stat-card ${escapeAttr(iconName)}">
        <span class="admin-stat-icon">${icon(iconName)}</span>
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>
      </article>
    `;
  }

  function renderAdminUsers() {
    const body = document.querySelector("#adminUsersBody");
    if (!body) return;
    const users = filteredAdminUsers();
    const activeCount = adminState.users.filter((user) => user.status === "active").length;
    const suspendedCount = adminState.users.filter((user) => user.status === "suspended").length;
    const pendingKycCount = adminState.users.filter((user) => user.kycStatus === "pending").length;

    body.innerHTML = `
      <div class="admin-user-toolbar">
        <label class="admin-user-search">${icon("user")}<input id="adminUserSearch" value="${escapeAttr(adminUserSearch)}" placeholder="Search by email, role, or status" /></label>
        <div class="admin-user-filters" role="tablist" aria-label="Filter users">
          ${userFilterButton("all", "All", adminState.users.length)}
          ${userFilterButton("active", "Active", activeCount)}
          ${userFilterButton("suspended", "Suspended", suspendedCount)}
          ${userFilterButton("pending", "Pending KYC", pendingKycCount)}
        </div>
      </div>
      ${users.length ? `
        <div class="admin-user-table" role="table" aria-label="BRX users">
          <div class="admin-user-row admin-user-head" role="row"><span>User</span><span>Label</span><span>KYC</span><span>Status</span><span>Role</span><span>Joined</span><span></span></div>
          ${users.map(adminUserRow).join("")}
        </div>
      ` : emptyBlock("No users found", "Adjust search or filters to see more accounts.")}
    `;

    document.querySelector("#adminUserSearch")?.addEventListener("input", (event) => {
      adminUserSearch = event.currentTarget.value;
      renderAdminUsers();
    });
    document.querySelectorAll("[data-admin-user-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        adminUserStatusFilter = button.dataset.adminUserFilter || "all";
        renderAdminUsers();
      });
    });
    bindUserStatusButtons();
    bindUserLabelButtons();
  }

  function filteredAdminUsers() {
    const query = adminUserSearch.trim().toLowerCase();
    return adminState.users.filter((user) => {
      const status = String(user.status || "active").toLowerCase();
      const kyc = String(user.kycStatus || "unsubmitted").toLowerCase();
      if (adminUserStatusFilter === "active" && status !== "active") return false;
      if (adminUserStatusFilter === "suspended" && status !== "suspended") return false;
      if (adminUserStatusFilter === "pending" && kyc !== "pending") return false;
      if (!query) return true;
      return [user.email, user.role, status, kyc].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }

  function userFilterButton(key, label, count) {
    return `<button class="${adminUserStatusFilter === key ? "active" : ""}" type="button" data-admin-user-filter="${key}"><span>${escapeHtml(label)}</span><strong>${number(count)}</strong></button>`;
  }

  function adminUserRow(user) {
    const status = String(user.status || "active");
    const kyc = String(user.kycStatus || "unsubmitted");
    const frozen = status === "suspended";
    return `
      <div class="admin-user-row" role="row">
        <span class="admin-user-main"><strong>${escapeHtml(user.email)}</strong><small>${escapeHtml(user.id || "")}</small></span>
        <span><em class="admin-pill trader-label ${user.traderLabel ? "active" : "neutral"}">${escapeHtml(user.traderLabel || "None")}</em></span>
        <span><em class="admin-pill ${escapeAttr(kyc)}">${escapeHtml(kycLabel(kyc))}</em></span>
        <span><em class="admin-pill ${escapeAttr(status)}">${escapeHtml(statusLabel(status))}</em></span>
        <span>${escapeHtml(user.role || "user")}</span>
        <span>${adminDate(user.createdAt)}</span>
        <span class="admin-user-actions"><button class="outline-button tiny" type="button" data-user-id="${escapeAttr(user.id)}" data-user-label="${escapeAttr(user.traderLabel || "")}">Label</button><button class="outline-button tiny" type="button" data-user-id="${escapeAttr(user.id)}" data-user-status="${frozen ? "active" : "suspended"}">${frozen ? "Unfreeze" : "Freeze"}</button></span>
      </div>
    `;
  }

  function bindUserStatusButtons() {
    document.querySelectorAll("[data-user-status]").forEach((button) => {
      button.addEventListener("click", () => changeUserStatus(button.dataset.userId, button.dataset.userStatus));
    });
  }

  function bindUserLabelButtons() {
    document.querySelectorAll("[data-user-label]").forEach((button) => {
      button.addEventListener("click", () => changeUserLabel(button.dataset.userId, button.dataset.userLabel || ""));
    });
  }

  async function changeUserLabel(userId, currentLabel) {
    const traderLabel = prompt("Trader label shown on P2P offers. Leave blank to remove.", currentLabel || "");
    if (traderLabel === null) return;
    const reason = prompt("Reason for label change?") || "Admin trader label update";
    try {
      await adminService.updateUserLabel(userId, traderLabel, reason);
      showToast(traderLabel.trim() ? "Trader label updated." : "Trader label removed.");
      const [users, auditLogs] = await Promise.all([adminService.listUsers(), adminService.listAuditLogs()]);
      adminState.users = users.users || [];
      adminState.auditLogs = auditLogs.auditLogs || [];
      renderAdminUsers();
      renderOperations();
    } catch (error) {
      showToast(error.message || "Could not update trader label.");
    }
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
          <strong>${format(Number(trade.assetAmount))} USDT - ${format(Number(trade.fiatAmount))} ETB</strong>
          <small>Buyer: ${escapeHtml(trade.buyerName || "BRX trader")}</small>
          <small>Seller: ${escapeHtml(trade.sellerName || "BRX trader")}</small>
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

    bindUserStatusButtons();
    bindUserLabelButtons();
    bindWithdrawalReviewButtons();
    const processButton = document.querySelector("#processWithdrawals");
    if (processButton) processButton.onclick = processWithdrawals;
  }

  function operationPanel(title, content) {
    return `<article class="admin-operation-panel ${escapeAttr(title.toLowerCase().replace(/\s+/g, "-"))}"><div class="admin-operation-head"><h4>${escapeHtml(title)}</h4><span>${icon(operationIcon(title))}</span></div><div class="admin-mini-list">${content}</div></article>`;
  }

  function operationIcon(title) {
    if (title === "Users") return "user";
    if (title === "Withdrawals") return "upload";
    if (title === "Deposits") return "download";
    if (title === "Trades") return "trades";
    return "activity";
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
    const needsReview = item.status === "requested";
    const receive = Math.max(0, Number(item.amount || 0) - Number(item.fee || 0));
    return `<div class="admin-mini-row"><span><strong>$${money(item.amount)} total</strong><small>${escapeHtml(item.email)} · ${escapeHtml(item.status)} · $${money(receive)} delivered · $${money(item.fee)} fee${item.txHash ? ` · ${escapeHtml(item.txHash.slice(0, 12))}...` : ""}</small></span>${needsReview ? `<span class="admin-actions inline"><button class="outline-button tiny" type="button" data-withdrawal-approve="${escapeAttr(item.id)}">Approve</button><button class="danger-button tiny" type="button" data-withdrawal-reject="${escapeAttr(item.id)}">Reject</button></span>` : ""}</div>`;
  }

  function depositRow(item) {
    return `<div class="admin-mini-row"><span><strong>${money(item.amount)} USDT</strong><small>${escapeHtml(item.email)} - ${escapeHtml(item.status)} - ${Number(item.confirmations || 0)} conf</small></span></div>`;
  }

  function tradeRow(item) {
    return `<div class="admin-mini-row"><span><strong>${money(item.assetAmount)} USDT</strong><small>${escapeHtml(item.status)} - ${escapeHtml(item.buyerName || "buyer")} / ${escapeHtml(item.sellerName || "seller")}</small></span></div>`;
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
      renderAdminUsers();
      renderOperations();
    } catch (error) {
      showToast(error.message || "Could not update user.");
    }
  }

  function bindWithdrawalReviewButtons() {
    document.querySelectorAll("[data-withdrawal-approve]").forEach((button) => {
      button.addEventListener("click", () => reviewWithdrawal(button.dataset.withdrawalApprove, "approve"));
    });
    document.querySelectorAll("[data-withdrawal-reject]").forEach((button) => {
      button.addEventListener("click", () => reviewWithdrawal(button.dataset.withdrawalReject, "reject"));
    });
  }

  async function reviewWithdrawal(withdrawalId, action) {
    const note = prompt(action === "approve" ? "Approval note?" : "Reject reason?") || (action === "approve" ? "Approved for broadcast." : "Rejected by admin.");
    try {
      if (action === "approve") await adminService.approveWithdrawal(withdrawalId, note);
      else await adminService.rejectWithdrawal(withdrawalId, note);
      showToast(action === "approve" ? "Withdrawal approved." : "Withdrawal rejected and balance returned.");
      const [stats, withdrawals, auditLogs] = await Promise.all([adminService.stats(), adminService.listWithdrawals(), adminService.listAuditLogs()]);
      adminState.stats = stats.stats || null;
      adminState.withdrawals = withdrawals.withdrawals || [];
      adminState.auditLogs = auditLogs.auditLogs || [];
      renderStats();
      renderOperations();
    } catch (error) {
      showToast(error.message || "Could not review withdrawal.");
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
      renderAdminUsers();
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
      showToast("Level limits saved.");
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

  function kycLabel(status) {
    if (status === "approved") return "Approved";
    if (status === "pending") return "Pending";
    if (status === "rejected") return "Rejected";
    return "Unsubmitted";
  }

  function statusLabel(status) {
    if (status === "suspended") return "Suspended";
    if (status === "closed") return "Closed";
    return "Active";
  }

  function adminDate(value) {
    if (!value) return "--";
    return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }


  function renderAdminSettings() {
    const grid = document.querySelector("#adminSettings .admin-settings-grid");
    if (grid) grid.innerHTML = adminSettingsTiles();
    document.querySelector("#platformSettingsForm")?.addEventListener("submit", handlePlatformSettingsSave);
  }

  function adminSettingsTiles() {
    return `
      ${settingTile("Domain", "brxp2p.com", "Production domain reserved for launch.")}
      ${treasurySummaryTile()}
      ${settingTile("Network", "USDT BEP20", "BNB Smart Chain wallet settlement.")}
      ${settingTile("Email", "Resend", "Verification and security messages.")}
      ${settingTile("KYC", "Manual review", "Admin approval raises account limits.")}
      ${settingTile("Escrow", "Internal ledger", "P2P trades remain off-chain.")}
      ${platformSettingsForm()}
    `;
  }
  function platformSettingsForm() {
    const settings = adminState.platformSettings || {};
    const enabled = new Set(settings.enabledPaymentMethodTypes || []);
    const methods = ["telebirr", "mpesa", "cbe_birr", "cbe_bank", "bank_of_abyssinia", "awash_bank", "airtel_money", "bank", "other"];
    return `
      <form id="platformSettingsForm" class="admin-setting-tile platform-settings-form">
        <span>Admin settings</span>
        <label class="form-field"><span>Withdrawal fee USDT</span><input id="platformWithdrawalFee" inputmode="decimal" value="${escapeAttr(settings.withdrawalFeeUsdt || "0")}" /></label>
        <label class="form-field"><span>Basic taker fee %</span><input id="platformP2pBasicFee" inputmode="decimal" value="${escapeAttr(settings.p2pTakerFeeBasicPercent ?? "0.5")}" /></label>
        <label class="form-field"><span>Verified taker fee %</span><input id="platformP2pVerifiedFee" inputmode="decimal" value="${escapeAttr(settings.p2pTakerFeeVerifiedPercent ?? "0.35")}" /></label>
        <label class="form-field"><span>Merchant taker fee %</span><input id="platformP2pMerchantFee" inputmode="decimal" value="${escapeAttr(settings.p2pTakerFeeMerchantPercent ?? "0.15")}" /></label>
        <label class="form-field"><span>Auto approve up to USDT</span><input id="platformAutoApprove" inputmode="decimal" value="${escapeAttr(settings.withdrawalAutoApproveLimitUsdt ?? "50")}" /></label>
        <label class="form-field"><span>Daily withdrawal cap USDT</span><input id="platformDailyCap" inputmode="decimal" value="${escapeAttr(settings.withdrawalDailyPlatformLimitUsdt ?? "1000")}" /></label>
        <label class="form-field"><span>Sweep minimum USDT</span><input id="platformSweepMin" inputmode="decimal" value="${escapeAttr(settings.bscSweepMinUsdt ?? "1")}" /></label>
        <label class="admin-checkbox-line"><input id="platformSweepEnabled" type="checkbox" ${settings.bscSweepEnabled ? "checked" : ""} /> Auto sweep deposits</label>
        <div class="admin-payment-checkboxes">
          <strong>Enabled payment methods</strong>
          ${methods.map((type) => `<label><input type="checkbox" value="${escapeAttr(type)}" ${enabled.has(type) ? "checked" : ""} /> ${escapeHtml(paymentMethodLabel(type))}</label>`).join("")}
        </div>
        <button class="app-button small" type="submit">Save settings</button>
      </form>
    `;
  }

  async function handlePlatformSettingsSave(event) {
    event.preventDefault();
    const enabledPaymentMethodTypes = [...document.querySelectorAll("#platformSettingsForm .admin-payment-checkboxes input:checked")].map((input) => input.value);
    try {
      const result = await adminService.updatePlatformSettings({
        withdrawalFeeUsdt: document.querySelector("#platformWithdrawalFee").value,
        p2pTakerFeeBasicPercent: document.querySelector("#platformP2pBasicFee").value,
        p2pTakerFeeVerifiedPercent: document.querySelector("#platformP2pVerifiedFee").value,
        p2pTakerFeeMerchantPercent: document.querySelector("#platformP2pMerchantFee").value,
        withdrawalAutoApproveLimitUsdt: document.querySelector("#platformAutoApprove").value,
        withdrawalDailyPlatformLimitUsdt: document.querySelector("#platformDailyCap").value,
        bscSweepEnabled: document.querySelector("#platformSweepEnabled").checked,
        bscSweepMinUsdt: document.querySelector("#platformSweepMin").value,
        enabledPaymentMethodTypes,
      });
      adminState.platformSettings = result.settings || null;
      const treasury = await adminService.treasury();
      adminState.treasury = treasury.treasury || null;
      renderAdminSettings();
      showToast("Platform settings saved.");
    } catch (error) {
      showToast(error.message || "Could not save platform settings.");
    }
  }

  function paymentMethodLabel(type) {
    if (type === "telebirr") return "Telebirr";
    if (type === "mpesa") return "M-Pesa";
    if (type === "cbe_birr") return "CBE Birr";
    if (type === "cbe_bank") return "CBE";
    if (type === "bank_of_abyssinia") return "Bank of Abyssinia";
    if (type === "awash_bank") return "Awash Bank";
    if (type === "airtel_money") return "Airtel Money";
    if (type === "bank") return "Bank transfer";
    return "Other";
  }
  function treasurySummaryTile() {
    const treasury = adminState.treasury;
    if (!treasury) return settingTile("Custody", "Loading", "Treasury balances are loading.");
    const hot = (treasury.wallets || []).find((wallet) => wallet.role === "hot") || {};
    const gas = (treasury.wallets || []).find((wallet) => wallet.role === "gas") || {};
    const hotSigner = treasury.hotWalletSignerConfigured ? "hot signer ready" : "hot signer missing";
    const gasSigner = treasury.gasWalletSignerConfigured ? "gas signer ready" : "gas signer missing";
    const sweep = treasury.sweepEnabled ? "auto sweep on" : "auto sweep off";
    return `
      <div class="admin-setting-tile treasury-tile">
        <span>Custody</span>
        <strong>${escapeHtml(sweep)}</strong>
        <small>Hot: ${money(hot.usdtBalance)} USDT / ${money(hot.bnbBalance)} BNB</small>
        <small>Gas: ${money(gas.bnbBalance)} BNB</small>
        <small>${escapeHtml(hotSigner)} / ${escapeHtml(gasSigner)}</small>
        <small>Liability: ${money(treasury.liabilities?.confirmedUserLiabilityUsdt)} USDT</small>
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
    return components.loadingState(text, "Syncing the latest BRX data.", "admin-loading-state");
  }

  function emptyBlock(title, detail) {
    return components.emptyState({ iconName: "info", title, detail, className: "admin-empty-state" });
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




