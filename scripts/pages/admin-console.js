(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { requireUser } = window.BRX.state;
  const { refs, showToast } = window.BRX.ui;
  const { icon } = window.BRX.icons;
  const admin = window.BRX.adminService;

  const views = {
    overview: { label: "Command Center", eyebrow: "Live operations", title: "Command Center", detail: "Platform health, financial exposure, and queues requiring attention.", icon: "grid" },
    users: { label: "Users", eyebrow: "Account operations", title: "Users", detail: "Search every account, inspect balances and activity, and apply reviewed restrictions.", icon: "user" },
    kyc: { label: "KYC", eyebrow: "Compliance queue", title: "Identity Reviews", detail: "Review identity submissions in a focused master-detail workspace.", icon: "shield" },
    p2p: { label: "P2P Cases", eyebrow: "Escrow operations", title: "P2P & Disputes", detail: "Triage open cases, inspect evidence and chat, and resolve locked escrow safely.", icon: "trades" },
    finance: { label: "Funds", eyebrow: "Treasury operations", title: "Funds & Treasury", detail: "Monitor liabilities, wallets, deposits, withdrawals, and processing queues.", icon: "wallet" },
    risk: { label: "Risk", eyebrow: "Policy controls", title: "Risk Controls", detail: "Control account tiers and review current platform exposure.", icon: "lock" },
    audit: { label: "Audit Log", eyebrow: "Immutable history", title: "Audit Log", detail: "Search administrative and system activity with actor and entity context.", icon: "database" },
    settings: { label: "Settings", eyebrow: "Platform configuration", title: "Platform Settings", detail: "Manage fees, withdrawal policy, sweeps, and supported payment rails.", icon: "settings" },
  };

  const state = {
    view: "overview", epoch: 0, root: null,
    stats: null, treasury: null, settings: null, limits: [],
    disputes: [], disputePagination: null, selectedDisputeId: "",
    kyc: [], kycPagination: null, selectedKyc: null,
    users: [], userPagination: null,
    withdrawals: [], withdrawalPagination: null,
    deposits: [], depositPagination: null,
    trades: [], tradePagination: null,
    auditLogs: [], auditPagination: null,
    filters: {
      users: { page: 1, pageSize: 25, search: "", status: "all", kyc: "all" },
      kyc: { page: 1, pageSize: 25, search: "", status: "pending" },
      disputes: { page: 1, pageSize: 20 },
      withdrawals: { page: 1, pageSize: 25, search: "", status: "all" },
      deposits: { page: 1, pageSize: 25, search: "", status: "all" },
      trades: { page: 1, pageSize: 25, search: "", status: "all" },
      audit: { page: 1, pageSize: 25, search: "", action: "" },
    },
    errors: {}, lastUpdated: null, pendingAction: null, returnFocus: null,
  };

  function renderAdminConsole() {
    const user = requireUser();
    if (!user) return;
    if (user.role !== "admin") {
      refs.app.innerHTML = `<section class="exchange-app app-page-narrow ops-access-denied"><div>${icon("shield")}<h1>Restricted area</h1><p>This console is available only to authorized BRX administrators.</p><a href="#/dashboard">Return to dashboard</a></div></section>`;
      return;
    }
    const requested = window.BRX.router?.routeParams?.().get("view");
    state.view = views[requested] ? requested : "overview";
    state.epoch += 1;
    refs.app.innerHTML = `
      <section class="ops-admin-shell" aria-label="BRX administration console">
        <aside class="ops-sidebar">
          <div class="ops-sidebar-brand"><span>${icon("shield")}</span><div><strong>BRX</strong><small>Operations Console</small></div></div>
          <nav class="ops-sidebar-nav" aria-label="Admin workspaces">${Object.entries(views).map(([key, item]) => navButton(key, item)).join("")}</nav>
          <div class="ops-sidebar-foot"><span><i></i>Production controls</span><small>All decisions are recorded</small></div>
        </aside>
        <div class="ops-admin-main">
          <header class="ops-topbar"><div><p id="opsEyebrow"></p><h1 id="opsTitle"></h1><span id="opsDetail"></span></div><div class="ops-topbar-actions"><span class="ops-live-pill"><i></i>Live</span><span class="ops-updated" id="opsUpdated">Not refreshed</span><button class="ops-icon-button" type="button" data-ops-refresh aria-label="Refresh current workspace">${icon("activity")}</button></div></header>
          <main class="ops-workspace" id="opsWorkspace" tabindex="-1"></main>
        </div>
        <div id="opsOverlayRoot"></div>
      </section>`;
    state.root = refs.app.querySelector(".ops-admin-shell");
    state.root.addEventListener("click", handleClick);
    state.root.addEventListener("submit", handleSubmit);
    state.root.addEventListener("change", handleChange);
    document.removeEventListener("keydown", handleOverlayKeydown);
    document.addEventListener("keydown", handleOverlayKeydown);
    updateViewHeader();
    void loadView(state.view);
  }

  function navButton(key, item) {
    return `<button class="${state.view === key ? "active" : ""}" type="button" data-ops-view="${key}">${icon(item.icon)}<span>${escapeHtml(item.label)}</span>${navCount(key)}</button>`;
  }

  function navCount(key) {
    const counts = { kyc: state.stats?.users?.kycPending, p2p: state.stats?.marketplace?.openDisputes, finance: state.stats?.operations?.pendingWithdrawals };
    return Number(counts[key] || 0) > 0 ? `<em>${integer(counts[key])}</em>` : "";
  }

  async function loadView(view) {
    const epoch = ++state.epoch;
    setLoading(views[view].title);
    if (view === "overview") await loadOverview(epoch);
    else if (view === "users") await loadUsers(epoch);
    else if (view === "kyc") await loadKyc(epoch);
    else if (view === "p2p") await loadP2p(epoch);
    else if (view === "finance") await loadFinance(epoch);
    else if (view === "risk") await loadRisk(epoch);
    else if (view === "audit") await loadAudit(epoch);
    else if (view === "settings") await loadSettings(epoch);
    if (epoch !== state.epoch || !state.root?.isConnected) return;
    state.lastUpdated = new Date();
    updateTimestamp();
    refreshNav();
  }

  function setLoading(label) {
    const workspace = workspaceNode();
    if (workspace) workspace.innerHTML = `<div class="ops-loading"><span></span><strong>Loading ${escapeHtml(label)}</strong><small>Synchronizing the latest operational data.</small></div>`;
  }

  async function loadOverview(epoch) {
    const [stats, treasury, disputes, kyc, withdrawals, trades, auditLogs] = await Promise.all([
      settle("stats", admin.stats()), settle("treasury", admin.treasury()),
      settle("disputes", admin.listDisputes({ page: 1, pageSize: 10 })),
      settle("kyc", admin.listKyc({ page: 1, pageSize: 10, status: "pending" })),
      settle("withdrawals", admin.listWithdrawals({ page: 1, pageSize: 10, status: "requested" })),
      settle("trades", admin.listTrades({ page: 1, pageSize: 10 })),
      settle("audit", admin.listAuditLogs({ page: 1, pageSize: 10 })),
    ]);
    if (epoch !== state.epoch || !state.root?.isConnected) return;
    state.stats = stats?.stats || null;
    state.treasury = treasury?.treasury || null;
    state.disputes = disputes?.disputes || [];
    state.kyc = kyc?.submissions || [];
    state.withdrawals = withdrawals?.withdrawals || [];
    state.trades = trades?.trades || [];
    state.auditLogs = auditLogs?.auditLogs || [];
    renderOverview();
  }

  function renderOverview() {
    const target = workspaceNode();
    const s = state.stats;
    if (!s) return renderFatal(target, state.errors.stats, "Platform metrics are unavailable.");
    const t = state.treasury;
    const attention = Number(s.marketplace.openDisputes || 0) + Number(s.users.kycPending || 0) + Number(s.operations.pendingWithdrawals || 0);
    target.innerHTML = `
      ${partialErrors(["treasury", "disputes", "kyc", "withdrawals", "trades", "audit"])}
      <section class="ops-kpi-grid">
        ${kpi("Total users", integer(s.users.total), `${integer(s.users.active)} active`, "user", "blue")}
        ${kpi("User liabilities", `${money(sumLiabilities(s))} USDT`, `${money(s.balances.lockedUsdt)} locked`, "wallet", "cyan")}
        ${kpi("Open P2P orders", integer(s.marketplace.openTrades), `${integer(s.marketplace.activeOffers)} active ads`, "trades", "violet")}
        ${kpi("Fee revenue", `${money(s.volume.feeRevenueUsdt)} USDT`, "Recorded platform fees", "activity", "green")}
        ${kpi("Action queue", integer(attention), "Disputes, KYC, withdrawals", "shield", attention ? "amber" : "green")}
        ${kpi("Completed operations", integer(s.operations.completedTransactions), `${money(s.volume.completedTradeUsdt)} USDT traded`, "check", "slate")}
      </section>
      <section class="ops-overview-grid">
        <article class="ops-panel ops-priority-panel">${panelHead("Priority queues", "Work oldest and highest-risk items first", "activity")}<div class="ops-priority-list">
          ${priorityRow("Open disputes", s.marketplace.openDisputes, "Escrow decisions waiting for review", "p2p", "critical")}
          ${priorityRow("Pending withdrawals", s.operations.pendingWithdrawals, "Manual approval queue", "finance", "warning")}
          ${priorityRow("Pending KYC", s.users.kycPending, "Identity decisions waiting", "kyc", "info")}
          ${priorityRow("Pending deposits", s.operations.pendingDeposits, "Confirmations or sweep attention", "finance", "neutral")}
        </div></article>
        <article class="ops-panel ops-health-panel">${panelHead("Platform health", "Configuration and custody readiness", "shield")}<div class="ops-health-list">
          ${healthRow("API & database", true, "Metrics responding")}
          ${healthRow("Hot-wallet signer", Boolean(t?.hotWalletSignerConfigured), t?.hotWalletSignerConfigured ? "Configured" : "Signer missing")}
          ${healthRow("Gas-wallet signer", Boolean(t?.gasWalletSignerConfigured), t?.gasWalletSignerConfigured ? "Configured" : "Signer missing")}
          ${healthRow("Deposit sweeps", Boolean(t?.sweepEnabled), t?.sweepEnabled ? `Enabled above ${money(t?.sweepMinUsdt)} USDT` : "Automatic sweeps disabled")}
        </div></article>
      </section>
      <section class="ops-panel ops-money-panel">${panelHead("Money flow", "Confirmed volumes and current balance buckets", "wallet")}<div class="ops-money-grid">
        ${moneyMetric("Available", s.balances.availableUsdt, "User funds ready to use")}${moneyMetric("Locked escrow", s.balances.lockedUsdt, "Reserved in active P2P")}${moneyMetric("Pending deposits", s.balances.pendingDepositUsdt, "Detected, not yet available")}${moneyMetric("Pending withdrawals", s.balances.pendingWithdrawalUsdt, "Reserved for payout")}${moneyMetric("Credited deposits", s.volume.creditedDepositUsdt, "Lifetime confirmed deposits")}${moneyMetric("Confirmed withdrawals", s.volume.confirmedWithdrawalUsdt, "Lifetime processed withdrawals")}
      </div></section>
      <section class="ops-overview-grid ops-overview-feed">
        <article class="ops-panel">${panelHead("Recent P2P orders", "Latest marketplace activity", "trades")}<div class="ops-compact-list">${state.trades.length ? state.trades.slice(0, 6).map(compactTrade).join("") : emptyRow("No recent trades")}</div><button class="ops-text-button" type="button" data-ops-view="p2p">Open P2P workspace ${icon("external")}</button></article>
        <article class="ops-panel">${panelHead("Recent control activity", "Administrative and system events", "database")}<div class="ops-compact-list">${state.auditLogs.length ? state.auditLogs.slice(0, 6).map(compactAudit).join("") : emptyRow("No audit activity")}</div><button class="ops-text-button" type="button" data-ops-view="audit">Open audit log ${icon("external")}</button></article>
      </section>`;
  }

  async function loadUsers(epoch) {
    const result = await settle("users", admin.listUsers(state.filters.users));
    if (epoch !== state.epoch || !state.root?.isConnected) return;
    state.users = result?.users || [];
    state.userPagination = result?.pagination || null;
    renderUsers();
  }

  function renderUsers() {
    const f = state.filters.users;
    workspaceNode().innerHTML = `${partialErrors(["users"])}<section class="ops-panel ops-table-panel">
      <div class="ops-toolbar"><form id="opsUserFilters" class="ops-filter-form"><label class="ops-search">${icon("search")}<input name="search" value="${escapeAttr(f.search)}" placeholder="Search email, trader name, label, or user ID" /></label><select name="status" aria-label="Account status"><option value="all">All statuses</option>${options(["active", "suspended", "closed"], f.status)}</select><select name="kyc" aria-label="KYC status"><option value="all">All KYC</option>${options(["unsubmitted", "pending", "approved", "rejected"], f.kyc)}</select><button type="submit">Apply filters</button></form><span>${integer(state.userPagination?.total)} accounts</span></div>
      <div class="ops-data-table ops-users-table" role="table" aria-label="User accounts"><div class="ops-table-row ops-table-head" role="row"><span>User</span><span>Balance</span><span>KYC</span><span>Status</span><span>Role</span><span>Joined</span><span></span></div>${state.users.length ? state.users.map(userRow).join("") : emptyTable("No accounts match these filters.")}</div>${pager("users", state.userPagination)}
    </section>`;
  }

  function userRow(user) {
    const available = Number(user.availableBalance || 0);
    const locked = Number(user.lockedBalance || 0);
    const pending = Number(user.pendingDeposit || 0) + Number(user.pendingWithdrawal || 0);
    return `<div class="ops-table-row" role="row"><span data-label="User" class="ops-primary-cell"><strong>${escapeHtml(user.email)}</strong><small>${escapeHtml(user.traderLabel || user.username || shortId(user.id))}</small></span><span data-label="Balance"><strong>${money(available + locked + pending)} USDT</strong><small>${money(available)} available · ${money(locked)} locked</small></span><span data-label="KYC">${statusPill(user.kycStatus)}</span><span data-label="Status">${statusPill(user.status)}</span><span data-label="Role"><strong>${escapeHtml(user.role || "user")}</strong></span><span data-label="Joined"><strong>${date(user.createdAt)}</strong></span><span class="ops-row-action"><button type="button" data-manage-user="${escapeAttr(user.id)}">Manage</button></span></div>`;
  }

  async function openUserDrawer(userId) {
    openDrawer(`<div class="ops-drawer-loading"><span></span><strong>Loading account</strong></div>`);
    try { const result = await admin.getUser(userId); if (overlayNode()) renderUserDrawer(result); }
    catch (error) { if (state.root?.isConnected) openDrawer(`<div class="ops-drawer-head"><div><small>Account operations</small><h2>Could not load user</h2></div><button type="button" data-close-overlay aria-label="Close">×</button></div><div class="ops-drawer-error">${escapeHtml(error.message || "Try again.")}</div>`); }
  }

  function renderUserDrawer(result) {
    const user = result.user || {};
    const available = Number(user.availableBalance || 0);
    const locked = Number(user.lockedBalance || 0);
    const pending = Number(user.pendingDeposit || 0) + Number(user.pendingWithdrawal || 0);
    openDrawer(`<div class="ops-drawer-head"><div><small>Account operations</small><h2>${escapeHtml(user.traderLabel || user.username || "BRX user")}</h2><p>${escapeHtml(user.email || "")}</p></div><button type="button" data-close-overlay aria-label="Close">×</button></div>
      <div class="ops-drawer-status">${statusPill(user.status)}${statusPill(user.kycStatus)}<span>${integer(user.activeSessionCount)} active sessions</span></div>
      <section class="ops-drawer-balance"><span>Total USDT balance</span><strong>${money(available + locked + pending)}</strong><div><small>Available<b>${money(available)}</b></small><small>Escrow<b>${money(locked)}</b></small><small>Pending<b>${money(pending)}</b></small></div></section>
      <dl class="ops-detail-list"><div><dt>User ID</dt><dd>${escapeHtml(user.id || "—")}</dd></div><div><dt>Last seen</dt><dd>${dateTime(user.lastSeenAt)}</dd></div><div><dt>Orders</dt><dd>${integer(user.tradeCount)}</dd></div><div><dt>Disputes</dt><dd>${integer(user.disputeCount)}</dd></div><div><dt>Offers</dt><dd>${integer(user.offerCount)}</dd></div><div><dt>Email verified</dt><dd>${user.emailVerifiedAt ? "Yes" : "No"}</dd></div></dl>
      <section class="ops-drawer-section"><header><h3>Trader identity</h3><small>Public P2P label</small></header><form id="opsUserLabelForm"><input type="hidden" name="userId" value="${escapeAttr(user.id)}" /><label><span>Trader label</span><input name="traderLabel" maxlength="18" value="${escapeAttr(user.traderLabel || "")}" placeholder="Optional merchant label" /></label><label><span>Change reason</span><textarea name="reason" rows="2" required minlength="5" placeholder="Why is this label changing?"></textarea></label><button type="submit">Save label</button></form></section>
      <section class="ops-drawer-section"><header><h3>Account controls</h3><small>Restrictions revoke active sessions</small></header><div class="ops-account-actions">${user.status !== "active" ? `<button type="button" data-user-status-action="active" data-user-id="${escapeAttr(user.id)}">Reactivate account</button>` : `<button type="button" class="warning" data-user-status-action="suspended" data-user-id="${escapeAttr(user.id)}">Suspend account</button>`}<button type="button" class="danger" data-user-status-action="closed" data-user-id="${escapeAttr(user.id)}">Close account</button></div></section>
      <section class="ops-drawer-section"><header><h3>Recent orders</h3><small>Last five P2P records</small></header><div class="ops-compact-list">${(result.recentTrades || []).length ? result.recentTrades.map(compactTrade).join("") : emptyRow("No orders")}</div></section>
      <section class="ops-drawer-section"><header><h3>Recent withdrawals</h3><small>Last five requests</small></header><div class="ops-compact-list">${(result.recentWithdrawals || []).length ? result.recentWithdrawals.map(compactWithdrawal).join("") : emptyRow("No withdrawals")}</div></section>`);
  }

  async function loadKyc(epoch) {
    const result = await settle("kyc", admin.listKyc(state.filters.kyc));
    if (epoch !== state.epoch || !state.root?.isConnected) return;
    state.kyc = result?.submissions || [];
    state.kycPagination = result?.pagination || null;
    if (!state.kyc.some((item) => item.id === state.selectedKyc?.submission?.id)) state.selectedKyc = null;
    renderKyc();
  }

  function renderKyc() {
    const f = state.filters.kyc;
    const selected = state.selectedKyc;
    workspaceNode().innerHTML = `${partialErrors(["kyc"])}<section class="ops-master-detail ops-kyc-workspace">
      <aside class="ops-queue-panel"><form id="opsKycFilters" class="ops-queue-filters"><label>${icon("search")}<input name="search" value="${escapeAttr(f.search)}" placeholder="Search applicant or ID" /></label><select name="status"><option value="all">All reviews</option>${options(["pending", "approved", "rejected"], f.status)}</select><button type="submit">Filter</button></form><header><span>${integer(state.kycPagination?.total)} submissions</span><small>Oldest pending first</small></header><div class="ops-case-queue">${state.kyc.length ? state.kyc.map(kycQueueRow).join("") : emptyRow("No KYC submissions match this view")}</div>${pager("kyc", state.kycPagination)}</aside>
      <article class="ops-detail-panel" id="opsKycDetail">${selected ? kycDetail(selected) : emptyDetail("Select an identity review", "Choose an applicant from the queue to inspect submitted documents and make a decision.")}</article>
    </section>`;
  }

  function kycQueueRow(item) {
    const active = state.selectedKyc?.submission?.id === item.id;
    return `<button class="ops-case-row ${active ? "active" : ""}" type="button" data-kyc-case="${escapeAttr(item.id)}"><span class="ops-case-avatar">${escapeHtml(initials(item.fullName || item.email))}</span><span><strong>${escapeHtml(item.fullName || "Unknown applicant")}</strong><small>${escapeHtml(item.email || "")} · ${escapeHtml(item.idType || "ID")}</small><em>${dateTime(item.createdAt)}</em></span>${statusPill(item.status)}</button>`;
  }

  async function selectKyc(id) {
    const detail = document.querySelector("#opsKycDetail");
    if (detail) detail.innerHTML = `<div class="ops-loading compact"><span></span><strong>Opening submission</strong></div>`;
    try { state.selectedKyc = await admin.getKyc(id); if (state.view === "kyc") renderKyc(); }
    catch (error) { if (detail) renderFatal(detail, error, "Could not load this submission."); }
  }

  function kycDetail(result) {
    const item = result.submission || {};
    const files = result.files || {};
    return `<div class="ops-detail-head"><div><small>Identity case ${escapeHtml(shortId(item.id))}</small><h2>${escapeHtml(item.fullName || "Applicant")}</h2><p>${escapeHtml(item.email || "")}</p></div>${statusPill(item.status)}</div>
      <dl class="ops-case-facts"><div><dt>Phone</dt><dd>${escapeHtml(item.phone || "—")}</dd></div><div><dt>ID type</dt><dd>${escapeHtml(item.idType || "—")}</dd></div><div><dt>ID number</dt><dd>${escapeHtml(item.idNumber || "—")}</dd></div><div><dt>Submitted</dt><dd>${dateTime(item.createdAt)}</dd></div></dl>
      <section class="ops-document-grid">${kycDocument(item.id, "ID front", files.documentFront)}${kycDocument(item.id, "ID back", files.documentBack)}${kycDocument(item.id, "Selfie", files.selfie)}${files.paymentProof?.available ? kycDocument(item.id, "Payment proof", files.paymentProof) : ""}</section>
      ${item.rejectionReason ? `<div class="ops-review-note"><strong>Previous rejection</strong><p>${escapeHtml(item.rejectionReason)}</p></div>` : ""}
      ${item.status === "pending" ? `<footer class="ops-sticky-actions"><div><strong>Decision required</strong><small>Inspect every document before continuing.</small></div><button type="button" class="danger" data-kyc-decision="reject" data-kyc-id="${escapeAttr(item.id)}">Reject</button><button type="button" class="primary" data-kyc-decision="approve" data-kyc-id="${escapeAttr(item.id)}">Approve identity</button></footer>` : ""}`;
  }

  function kycDocument(submissionId, label, file) {
    if (!file?.available || !file.kind) return `<figure class="ops-document missing"><div>${icon("info")}</div><figcaption>${escapeHtml(label)} unavailable</figcaption></figure>`;
    return `<figure class="ops-document secure"><button type="button" data-kyc-file="${escapeAttr(file.kind)}" data-kyc-id="${escapeAttr(submissionId)}" aria-label="Open ${escapeAttr(label)} securely"><span>${icon("shield")}</span><strong>${escapeHtml(label)}</strong><small>Authenticated preview</small></button><figcaption>${escapeHtml(label)}<span>Click to inspect</span></figcaption></figure>`;
  }

  async function loadP2p(epoch) {
    const [stats, disputes, trades] = await Promise.all([
      settle("stats", admin.stats()), settle("disputes", admin.listDisputes(state.filters.disputes)), settle("trades", admin.listTrades(state.filters.trades)),
    ]);
    if (epoch !== state.epoch || !state.root?.isConnected) return;
    state.stats = stats?.stats || state.stats;
    state.disputes = disputes?.disputes || [];
    state.disputePagination = disputes?.pagination || null;
    state.trades = trades?.trades || [];
    state.tradePagination = trades?.pagination || null;
    if (!state.disputes.some((item) => item.id === state.selectedDisputeId)) state.selectedDisputeId = state.disputes[0]?.id || "";
    renderP2p();
  }

  function renderP2p() {
    const selected = state.disputes.find((item) => item.id === state.selectedDisputeId);
    workspaceNode().innerHTML = `${partialErrors(["stats", "disputes", "trades"])}
      <section class="ops-p2p-summary">${summaryChip("Open disputes", state.disputePagination?.total, "critical")}${summaryChip("Open orders", state.stats?.marketplace?.openTrades ?? 0, "info")}${summaryChip("Locked escrow", `${money(state.stats?.balances?.lockedUsdt || 0)} USDT`, "warning")}</section>
      <section class="ops-master-detail ops-dispute-workspace"><aside class="ops-queue-panel"><header><span>${integer(state.disputePagination?.total)} open cases</span><small>Oldest cases first</small></header><div class="ops-case-queue">${state.disputes.length ? state.disputes.map(disputeQueueRow).join("") : emptyRow("No open disputes")}</div>${pager("disputes", state.disputePagination)}</aside><article class="ops-detail-panel">${selected ? disputeDetail(selected) : emptyDetail("No active dispute", "All escrow cases are currently clear.")}</article></section>
      <section class="ops-panel ops-table-panel ops-recent-orders">${panelHead("Recent P2P orders", "Server-paginated marketplace history", "trades")}<form id="opsTradeFilters" class="ops-inline-filters"><input name="search" value="${escapeAttr(state.filters.trades.search)}" placeholder="Search order ID or participant" /><select name="status"><option value="all">All statuses</option>${options(["opened", "payment_sent", "released", "cancelled", "disputed", "expired"], state.filters.trades.status)}</select><button type="submit">Filter</button></form><div class="ops-data-table ops-orders-table"><div class="ops-table-row ops-table-head"><span>Order</span><span>Buyer / Seller</span><span>Amount</span><span>Status</span><span>Opened</span></div>${state.trades.length ? state.trades.map(tradeTableRow).join("") : emptyTable("No orders match these filters.")}</div>${pager("trades", state.tradePagination)}</section>`;
  }

  function disputeQueueRow(item) {
    const active = item.id === state.selectedDisputeId;
    return `<button class="ops-case-row ${active ? "active" : ""}" type="button" data-dispute-case="${escapeAttr(item.id)}"><span class="ops-case-avatar critical">${icon("trades")}</span><span><strong>${money(item.escrowAmount || item.assetAmount)} USDT</strong><small>${escapeHtml(item.buyerName || "Buyer")} ↔ ${escapeHtml(item.sellerName || "Seller")}</small><em>${age(item.disputeCreatedAt || item.disputedAt)} open</em></span><b class="ops-priority-dot"></b></button>`;
  }

  function disputeDetail(item) {
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    const messages = Array.isArray(item.messages) ? item.messages : [];
    return `<div class="ops-detail-head"><div><small>Case ${escapeHtml(shortId(item.disputeId || item.id))} · ${age(item.disputeCreatedAt || item.disputedAt)} open</small><h2>${money(item.escrowAmount || item.assetAmount)} USDT escrow review</h2><p>${money(item.fiatAmount)} ETB via ${escapeHtml(item.paymentMethod ? paymentLabel(item.paymentMethod) : "Unspecified method")}</p></div>${statusPill("disputed")}</div>
      <div class="ops-party-grid"><article><span>Buyer</span><strong>${escapeHtml(item.buyerName || "Buyer")}</strong><small>${item.buyerLastSeenAt ? `Last active ${age(item.buyerLastSeenAt)} ago` : "Activity unavailable"}</small></article><article><span>Seller</span><strong>${escapeHtml(item.sellerName || "Seller")}</strong><small>${item.sellerLastSeenAt ? `Last active ${age(item.sellerLastSeenAt)} ago` : "Activity unavailable"}</small></article></div>
      <section class="ops-case-section"><header><h3>Reported issue</h3><span>${escapeHtml(item.openedByName || "Trader")}</span></header><p class="ops-case-reason">${escapeHtml(item.disputeReason || "No reason supplied.")}</p>${item.paymentReference ? `<dl class="ops-detail-list"><div><dt>Payment reference</dt><dd>${escapeHtml(item.paymentReference)}</dd></div></dl>` : ""}${item.paymentProofName ? `<button class="ops-attachment-button" type="button" data-payment-proof="${escapeAttr(item.id)}">${icon("eye")} View buyer receipt · ${escapeHtml(item.paymentProofName)}</button>` : ""}</section>
      <section class="ops-case-section"><header><h3>Order timeline</h3></header><ol class="ops-case-timeline"><li class="done"><i></i><span><strong>Order opened</strong><small>${dateTime(item.createdAt)}</small></span></li><li class="${item.paymentSentAt ? "done" : ""}"><i></i><span><strong>Payment marked sent</strong><small>${item.paymentSentAt ? dateTime(item.paymentSentAt) : "Not completed"}</small></span></li><li class="done warning"><i></i><span><strong>Dispute opened</strong><small>${dateTime(item.disputeCreatedAt || item.disputedAt)}</small></span></li></ol></section>
      <section class="ops-case-section"><header><h3>Order conversation</h3><span>${integer(messages.length)} messages</span></header><div class="ops-case-chat">${messages.length ? messages.map((message) => disputeMessage(item, message)).join("") : emptyRow("No messages in this order")}</div></section>
      <section class="ops-case-section"><header><h3>Evidence</h3><span>${integer(evidence.length)} submissions</span></header><div class="ops-evidence-list">${evidence.length ? evidence.map((file, index) => evidenceRow(item, file, index)).join("") : emptyRow("No supporting evidence submitted")}</div></section>
      <footer class="ops-sticky-actions dispute"><div><strong>Escrow decision</strong><small>A rationale and typed confirmation are required.</small></div><button type="button" class="danger" data-dispute-decision="seller" data-trade-id="${escapeAttr(item.id)}">Return to seller</button><button type="button" class="primary" data-dispute-decision="buyer" data-trade-id="${escapeAttr(item.id)}">Release to buyer</button></footer>`;
  }

  function disputeMessage(trade, message) {
    const buyer = message.senderId === trade.buyerId;
    const name = buyer ? trade.buyerName : trade.sellerName;
    return `<article class="ops-chat-message ${buyer ? "buyer" : "seller"}"><span>${buyer ? "Buyer" : "Seller"}</span><div><strong>${escapeHtml(name || "Trader")}</strong>${message.body ? `<p>${escapeHtml(message.body).replace(/\n/g, "<br>")}</p>` : ""}${message.hasAttachment ? `<button type="button" data-message-attachment="${escapeAttr(message.id)}" data-trade-id="${escapeAttr(trade.id)}">${icon("eye")} ${escapeHtml(message.attachmentName || "Attachment")}</button>` : ""}<small>${dateTime(message.createdAt)}</small></div></article>`;
  }

  function evidenceRow(trade, file, index) {
    const party = file.submittedBy === trade.buyerId ? "Buyer" : file.submittedBy === trade.sellerId ? "Seller" : "Reviewer";
    return `<article><span>${index + 1}</span><div><strong>${party} evidence</strong><p>${escapeHtml(file.note || "No note supplied.")}</p><small>${dateTime(file.createdAt)}</small></div>${file.fileUrl ? `<button type="button" data-evidence-file="${escapeAttr(file.id)}" data-trade-id="${escapeAttr(trade.id)}">View file</button>` : ""}</article>`;
  }

  async function loadFinance(epoch) {
    const [stats, treasury, withdrawals, deposits] = await Promise.all([
      settle("stats", admin.stats()), settle("treasury", admin.treasury()), settle("withdrawals", admin.listWithdrawals(state.filters.withdrawals)), settle("deposits", admin.listDeposits(state.filters.deposits)),
    ]);
    if (epoch !== state.epoch || !state.root?.isConnected) return;
    state.stats = stats?.stats || state.stats;
    state.treasury = treasury?.treasury || null;
    state.withdrawals = withdrawals?.withdrawals || [];
    state.withdrawalPagination = withdrawals?.pagination || null;
    state.deposits = deposits?.deposits || [];
    state.depositPagination = deposits?.pagination || null;
    renderFinance();
  }

  function renderFinance() {
    const t = state.treasury;
    const s = state.stats;
    workspaceNode().innerHTML = `${partialErrors(["stats", "treasury", "withdrawals", "deposits"])}
      <section class="ops-treasury-strip">${treasuryMetric("Confirmed liabilities", t?.liabilities?.confirmedUserLiabilityUsdt, "USDT owed to users", "wallet")}${treasuryMetric("Hot wallet", walletBalance("hot", "usdtBalance"), walletStatus("hot"), "activity")}${treasuryMetric("Gas wallet", walletBalance("gas", "bnbBalance"), "BNB available for transactions", "upload", "BNB")}${treasuryMetric("Withdrawal queue", state.withdrawalPagination?.total, `${money(s?.balances?.pendingWithdrawalUsdt)} USDT reserved`, "clock", "requests")}</section>
      <section class="ops-panel ops-treasury-control">${panelHead("Treasury controls", "Run workers only after reviewing the active queue", "shield")}<div><span>${healthRowInline("Hot signer", Boolean(t?.hotWalletSignerConfigured))}${healthRowInline("Gas signer", Boolean(t?.gasWalletSignerConfigured))}${healthRowInline("Auto sweep", Boolean(t?.sweepEnabled))}</span><span><button type="button" data-finance-job="sweeps">${icon("download")} Retry deposit sweeps</button><button type="button" data-finance-job="withdrawals" class="primary">${icon("upload")} Process withdrawal queue</button></span></div></section>
      <section class="ops-panel ops-table-panel">${panelHead("Withdrawal review", "Approve or reject requests after risk and address review", "upload")}${financeFilter("withdrawals", state.filters.withdrawals, ["requested", "approved", "broadcast", "confirmed", "failed", "rejected"])}<div class="ops-data-table ops-withdrawal-table"><div class="ops-table-row ops-table-head"><span>User</span><span>Amount</span><span>Destination</span><span>Risk</span><span>Status</span><span>Requested</span><span></span></div>${state.withdrawals.length ? state.withdrawals.map(withdrawalTableRow).join("") : emptyTable("No withdrawals match these filters.")}</div>${pager("withdrawals", state.withdrawalPagination)}</section>
      <section class="ops-panel ops-table-panel">${panelHead("Deposit ledger", "On-chain deposits and confirmation state", "download")}${financeFilter("deposits", state.filters.deposits, ["detected", "confirming", "credited", "failed"])}<div class="ops-data-table ops-deposit-table"><div class="ops-table-row ops-table-head"><span>User</span><span>Amount</span><span>Transaction</span><span>Confirmations</span><span>Status</span><span>Detected</span></div>${state.deposits.length ? state.deposits.map(depositTableRow).join("") : emptyTable("No deposits match these filters.")}</div>${pager("deposits", state.depositPagination)}</section>`;
  }

  async function loadRisk(epoch) {
    const [stats, limits, settings] = await Promise.all([settle("stats", admin.stats()), settle("limits", admin.limits()), settle("settings", admin.platformSettings())]);
    if (epoch !== state.epoch || !state.root?.isConnected) return;
    state.stats = stats?.stats || state.stats;
    state.limits = limits?.limits || [];
    state.settings = settings?.settings || state.settings;
    renderRisk();
  }

  function renderRisk() {
    const s = state.stats;
    workspaceNode().innerHTML = `${partialErrors(["stats", "limits", "settings"])}<section class="ops-risk-grid">${kpi("Locked escrow", `${money(s?.balances?.lockedUsdt)} USDT`, `${integer(s?.marketplace?.openTrades)} open orders`, "lock", "amber")}${kpi("Open disputes", integer(s?.marketplace?.openDisputes), "Manual escrow decisions", "shield", "red")}${kpi("Suspended users", integer(s?.users?.suspended), "Restricted accounts", "user", "violet")}${kpi("Auto-approval ceiling", `${money(state.settings?.withdrawalAutoApproveLimitUsdt)} USDT`, "Withdrawals above require review", "upload", "blue")}</section><section class="ops-panel ops-limit-panel">${panelHead("Account tier limits", "Changes affect eligibility checks immediately and are audit logged", "lock")}<form id="opsLimitsForm"><div class="ops-limit-grid">${state.limits.map(limitEditor).join("")}</div><footer><span>${icon("info")} Use exact limits approved by your risk policy.</span><button type="submit">Review limit changes</button></footer></form></section>`;
  }

  async function loadAudit(epoch) {
    const result = await settle("audit", admin.listAuditLogs(state.filters.audit));
    if (epoch !== state.epoch || !state.root?.isConnected) return;
    state.auditLogs = result?.auditLogs || [];
    state.auditPagination = result?.pagination || null;
    renderAudit();
  }

  function renderAudit() {
    const f = state.filters.audit;
    workspaceNode().innerHTML = `${partialErrors(["audit"])}<section class="ops-panel ops-table-panel"><div class="ops-toolbar"><form id="opsAuditFilters" class="ops-filter-form"><label class="ops-search">${icon("search")}<input name="search" value="${escapeAttr(f.search)}" placeholder="Search action, actor, entity, or reference" /></label><input name="action" value="${escapeAttr(f.action)}" placeholder="Exact action (optional)" /><button type="submit">Search log</button></form><span>${integer(state.auditPagination?.total)} events</span></div><div class="ops-data-table ops-audit-table"><div class="ops-table-row ops-table-head"><span>Timestamp</span><span>Action</span><span>Actor</span><span>Entity</span><span>Context</span></div>${state.auditLogs.length ? state.auditLogs.map(auditTableRow).join("") : emptyTable("No audit events match this search.")}</div>${pager("audit", state.auditPagination)}</section>`;
  }

  async function loadSettings(epoch) {
    const [settings, treasury] = await Promise.all([settle("settings", admin.platformSettings()), settle("treasury", admin.treasury())]);
    if (epoch !== state.epoch || !state.root?.isConnected) return;
    state.settings = settings?.settings || null;
    state.treasury = treasury?.treasury || state.treasury;
    renderSettings();
  }

  function renderSettings() {
    const s = state.settings;
    if (!s) return renderFatal(workspaceNode(), state.errors.settings, "Platform settings are unavailable.");
    const enabled = new Set(s.enabledPaymentMethodTypes || []);
    const rails = ["telebirr", "mpesa", "cbe_birr", "cbe_bank", "bank_of_abyssinia", "awash_bank", "airtel_money", "bank", "other"];
    workspaceNode().innerHTML = `${partialErrors(["settings", "treasury"])}<form id="opsSettingsForm" class="ops-settings-form">
      <section class="ops-panel"><header class="ops-setting-head"><div>${icon("activity")}<span><h2>P2P fees</h2><p>Percentage charged to the taker by verification tier.</p></span></div><em>Revenue policy</em></header><div class="ops-form-grid three"><label><span>Basic taker fee</span><div><input name="p2pTakerFeeBasicPercent" type="number" min="0" max="100" step="0.01" value="${escapeAttr(decimal(s.p2pTakerFeeBasicPercent))}" /><b>%</b></div></label><label><span>Verified taker fee</span><div><input name="p2pTakerFeeVerifiedPercent" type="number" min="0" max="100" step="0.01" value="${escapeAttr(decimal(s.p2pTakerFeeVerifiedPercent))}" /><b>%</b></div></label><label><span>Merchant taker fee</span><div><input name="p2pTakerFeeMerchantPercent" type="number" min="0" max="100" step="0.01" value="${escapeAttr(decimal(s.p2pTakerFeeMerchantPercent))}" /><b>%</b></div></label></div></section>
      <section class="ops-panel"><header class="ops-setting-head"><div>${icon("upload")}<span><h2>Withdrawal policy</h2><p>Fee, automated review boundary, and daily platform cap.</p></span></div><em>BEP20 · USDT</em></header><div class="ops-form-grid three"><label><span>Withdrawal fee</span><div><input name="withdrawalFeeUsdt" type="number" min="0" step="0.00000001" value="${escapeAttr(decimal(s.withdrawalFeeUsdt))}" /><b>USDT</b></div></label><label><span>Auto-approve up to</span><div><input name="withdrawalAutoApproveLimitUsdt" type="number" min="0" step="0.01" value="${escapeAttr(decimal(s.withdrawalAutoApproveLimitUsdt))}" /><b>USDT</b></div></label><label><span>Daily platform cap</span><div><input name="withdrawalDailyPlatformLimitUsdt" type="number" min="0" step="0.01" value="${escapeAttr(decimal(s.withdrawalDailyPlatformLimitUsdt))}" /><b>USDT</b></div></label></div></section>
      <section class="ops-panel"><header class="ops-setting-head"><div>${icon("download")}<span><h2>Deposit sweeping</h2><p>Move user deposits to the configured hot wallet after confirmation.</p></span></div>${healthRowInline("Signer", Boolean(state.treasury?.gasWalletSignerConfigured))}</header><div class="ops-form-grid two"><label><span>Minimum sweep amount</span><div><input name="bscSweepMinUsdt" type="number" min="0" step="0.01" value="${escapeAttr(decimal(s.bscSweepMinUsdt))}" /><b>USDT</b></div></label><label class="ops-toggle-field"><span>Automatic sweeps</span><input name="bscSweepEnabled" type="checkbox" ${s.bscSweepEnabled ? "checked" : ""} /><i></i><small>${s.bscSweepEnabled ? "Enabled" : "Disabled"}</small></label></div></section>
      <section class="ops-panel"><header class="ops-setting-head"><div>${icon("card")}<span><h2>Payment rails</h2><p>Methods available when users add payment accounts or publish P2P ads.</p></span></div><em>${integer(enabled.size)} enabled</em></header><div class="ops-rail-grid">${rails.map((rail) => `<label><input type="checkbox" name="enabledPaymentMethodTypes" value="${rail}" ${enabled.has(rail) ? "checked" : ""} /><span><i style="--rail:${paymentColor(rail)}"></i><strong>${paymentLabel(rail)}</strong></span></label>`).join("")}</div></section>
      <section class="ops-settings-review"><div>${icon("shield")}<span><strong>Configuration changes are live</strong><small>A written change reason and typed confirmation are required. Every save is audit logged.</small></span></div><button type="submit">Review and save changes</button></section>
    </form>`;
  }

  async function handleClick(event) {
    if (event.target.classList?.contains("ops-overlay")) return closeOverlay();
    const button = event.target.closest("button, [data-preview-url]");
    if (!button) return;
    if (button.dataset.opsView) return switchView(button.dataset.opsView);
    if (button.hasAttribute("data-ops-refresh")) return void refreshCurrent(button);
    if (button.hasAttribute("data-close-overlay")) return closeOverlay();
    if (button.hasAttribute("data-modal-confirm")) return void confirmModal(button);
    if (button.dataset.opsPage) return void changePage(button.dataset.opsPage, Number(button.dataset.page));
    if (button.dataset.manageUser) return void openUserDrawer(button.dataset.manageUser);
    if (button.dataset.userStatusAction) return reviewUserStatus(button.dataset.userId, button.dataset.userStatusAction);
    if (button.dataset.kycCase) return void selectKyc(button.dataset.kycCase);
    if (button.dataset.kycDecision) return reviewKyc(button.dataset.kycId, button.dataset.kycDecision);
    if (button.dataset.disputeCase) { state.selectedDisputeId = button.dataset.disputeCase; return renderP2p(); }
    if (button.dataset.disputeDecision) return reviewDispute(button.dataset.tradeId, button.dataset.disputeDecision);
    if (button.dataset.withdrawalDecision) return reviewWithdrawal(button.dataset.withdrawalId, button.dataset.withdrawalDecision);
    if (button.dataset.financeJob) return reviewFinanceJob(button.dataset.financeJob);
    if (button.dataset.kycFile) return void openAttachment(() => admin.kycFile(button.dataset.kycId, button.dataset.kycFile));
    if (button.dataset.previewUrl) return previewData(button.dataset.previewUrl, button.dataset.previewLabel || "Document");
    if (button.dataset.paymentProof) return void openAttachment(() => admin.disputePaymentProof(button.dataset.paymentProof));
    if (button.dataset.evidenceFile) return void openAttachment(() => admin.disputeEvidence(button.dataset.tradeId, button.dataset.evidenceFile));
    if (button.dataset.messageAttachment) return void openAttachment(() => admin.disputeMessageAttachment(button.dataset.tradeId, button.dataset.messageAttachment));
  }

  function handleChange(event) {
    if (event.target.name === "bscSweepEnabled") {
      const label = event.target.closest("label")?.querySelector("small");
      if (label) label.textContent = event.target.checked ? "Enabled" : "Disabled";
    }
  }

  function handleOverlayKeydown(event) {
    const overlay = overlayNode();
    if (!overlay || !state.root?.isConnected) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = overlay.querySelector('[role="dialog"]');
    const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    if (form.id === "opsUserFilters") {
      Object.assign(state.filters.users, { page: 1, search: textValue(data, "search"), status: textValue(data, "status") || "all", kyc: textValue(data, "kyc") || "all" });
      return void loadView("users");
    }
    if (form.id === "opsKycFilters") {
      Object.assign(state.filters.kyc, { page: 1, search: textValue(data, "search"), status: textValue(data, "status") || "all" });
      state.selectedKyc = null;
      return void loadView("kyc");
    }
    if (form.id === "opsTradeFilters") {
      Object.assign(state.filters.trades, { page: 1, search: textValue(data, "search"), status: textValue(data, "status") || "all" });
      return void loadView("p2p");
    }
    if (form.id === "opsWithdrawalsFilters" || form.id === "opsDepositsFilters") {
      const key = form.id === "opsWithdrawalsFilters" ? "withdrawals" : "deposits";
      Object.assign(state.filters[key], { page: 1, search: textValue(data, "search"), status: textValue(data, "status") || "all" });
      return void loadView("finance");
    }
    if (form.id === "opsAuditFilters") {
      Object.assign(state.filters.audit, { page: 1, search: textValue(data, "search"), action: textValue(data, "action") });
      return void loadView("audit");
    }
    if (form.id === "opsUserLabelForm") return void saveUserLabel(form, data);
    if (form.id === "opsLimitsForm") return reviewLimitChanges(data);
    if (form.id === "opsSettingsForm") return reviewSettings(form, data);
  }

  async function refreshCurrent(button) {
    button.disabled = true;
    button.classList.add("loading");
    try { await loadView(state.view); showToast(`${views[state.view].label} refreshed.`); }
    finally { button.disabled = false; button.classList.remove("loading"); }
  }

  async function changePage(resource, page) {
    const map = { users: "users", kyc: "kyc", disputes: "disputes", trades: "trades", withdrawals: "withdrawals", deposits: "deposits", audit: "audit" };
    const key = map[resource];
    if (!key || page < 1) return;
    state.filters[key].page = page;
    await loadView(state.view);
  }

  async function saveUserLabel(form, data) {
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try { await admin.updateUserLabel(textValue(data, "userId"), textValue(data, "traderLabel"), textValue(data, "reason")); showToast("Trader label updated and audit logged."); closeOverlay(); await loadView("users"); }
    catch (error) { showToast(error.message || "Could not update the trader label."); }
    finally { button.disabled = false; }
  }

  function reviewUserStatus(userId, status) {
    const closed = status === "closed";
    openActionModal({ eyebrow: "Account control", title: status === "active" ? "Reactivate this account?" : closed ? "Permanently close this account?" : "Suspend this account?", detail: status === "active" ? "The user will be able to sign in and trade again." : "Active sessions will be revoked immediately. Existing financial records remain intact.", confirmLabel: status === "active" ? "Reactivate account" : closed ? "Close account" : "Suspend account", tone: status === "active" ? "primary" : "danger", phrase: closed ? "CLOSE" : "", reasonLabel: "Decision reason", onConfirm: async ({ reason }) => { await admin.updateUserStatus(userId, status, reason); showToast(status === "active" ? "Account reactivated." : status === "suspended" ? "Account suspended and sessions revoked." : "Account closed."); closeOverlay(); await loadView("users"); } });
  }

  function reviewKyc(id, decision) {
    openActionModal({ eyebrow: "Compliance decision", title: decision === "approve" ? "Approve this identity?" : "Reject this identity?", detail: decision === "approve" ? "The user will receive verified limits immediately." : "The user will see the rejection reason and can submit corrected documents.", confirmLabel: decision === "approve" ? "Approve identity" : "Reject submission", tone: decision === "approve" ? "primary" : "danger", reasonLabel: decision === "approve" ? "Approval note" : "Rejection reason", onConfirm: async ({ reason }) => { if (decision === "approve") await admin.approveKyc(id, reason); else await admin.rejectKyc(id, reason); state.selectedKyc = null; showToast(decision === "approve" ? "Identity approved." : "Identity rejected."); closeOverlay(); await loadView("kyc"); } });
  }

  function reviewDispute(tradeId, resolution) {
    const buyer = resolution === "buyer";
    openActionModal({ eyebrow: "Irreversible escrow decision", title: buyer ? "Release escrow to the buyer?" : "Return escrow to the seller?", detail: buyer ? "Locked USDT will be credited to the buyer. Verify the payment receipt, chat, and supporting evidence first." : "Locked USDT will be returned to the seller and the order will be closed.", confirmLabel: buyer ? "Release USDT" : "Return USDT", tone: buyer ? "primary" : "danger", phrase: buyer ? "RELEASE" : "RETURN", reasonLabel: "Resolution rationale", minReason: 10, onConfirm: async ({ reason }) => { await admin.resolveDispute(tradeId, resolution, reason); state.selectedDisputeId = ""; showToast("Dispute resolved and ledger updated."); closeOverlay(); await loadView("p2p"); } });
  }

  function reviewWithdrawal(id, decision) {
    openActionModal({ eyebrow: "Withdrawal review", title: decision === "approve" ? "Approve for broadcast?" : "Reject and return funds?", detail: decision === "approve" ? "The withdrawal worker may broadcast this request to the configured BEP20 address." : "Pending funds will be returned to the user's available balance exactly once.", confirmLabel: decision === "approve" ? "Approve withdrawal" : "Reject withdrawal", tone: decision === "approve" ? "primary" : "danger", phrase: decision === "reject" ? "REJECT" : "", reasonLabel: decision === "approve" ? "Approval note" : "Rejection reason", onConfirm: async ({ reason }) => { if (decision === "approve") await admin.approveWithdrawal(id, reason); else await admin.rejectWithdrawal(id, reason); showToast(decision === "approve" ? "Withdrawal approved for broadcast." : "Withdrawal rejected and funds returned."); closeOverlay(); await loadView("finance"); } });
  }

  function reviewFinanceJob(job) {
    const withdrawals = job === "withdrawals";
    openActionModal({ eyebrow: "Operations job", title: withdrawals ? "Process the withdrawal queue?" : "Retry eligible deposit sweeps?", detail: withdrawals ? "The worker will broadcast approved requests and reconcile broadcast transactions." : "The worker will retry gas funding and sweeping for eligible confirmed deposits.", confirmLabel: withdrawals ? "Run withdrawal worker" : "Run sweep worker", tone: "primary", phrase: withdrawals ? "PROCESS" : "", reasonLabel: "Run note", onConfirm: async ({ reason }) => { const result = withdrawals ? await admin.processWithdrawals(reason) : await admin.retryDepositSweeps(reason); showToast(withdrawals ? `Withdrawal worker finished: ${integer(result.broadcasted)} broadcast.` : `Sweep worker finished: ${integer(result.broadcast)} broadcast, ${integer(result.failed)} failed.`); closeOverlay(); await loadView("finance"); } });
  }

  function reviewLimitChanges(data) {
    const changes = state.limits.map((limit) => ({ tier: limit.tier, dailyTradeLimitUsd: textValue(data, `${limit.tier}Daily`), withdrawalLimitUsd: textValue(data, `${limit.tier}Withdrawal`) }));
    openActionModal({ eyebrow: "Risk policy change", title: "Apply new account limits?", detail: "These values are enforced immediately for all users in each tier.", confirmLabel: "Update risk limits", tone: "primary", phrase: "UPDATE", reasonLabel: "Policy change reason", onConfirm: async ({ reason }) => { await admin.updateLimits(changes, reason); showToast("Account limits updated atomically and audit logged."); closeOverlay(); await loadView("risk"); } });
  }

  function reviewSettings(form, data) {
    const payload = { withdrawalFeeUsdt: textValue(data, "withdrawalFeeUsdt"), p2pTakerFeeBasicPercent: textValue(data, "p2pTakerFeeBasicPercent"), p2pTakerFeeVerifiedPercent: textValue(data, "p2pTakerFeeVerifiedPercent"), p2pTakerFeeMerchantPercent: textValue(data, "p2pTakerFeeMerchantPercent"), withdrawalAutoApproveLimitUsdt: textValue(data, "withdrawalAutoApproveLimitUsdt"), withdrawalDailyPlatformLimitUsdt: textValue(data, "withdrawalDailyPlatformLimitUsdt"), bscSweepMinUsdt: textValue(data, "bscSweepMinUsdt"), bscSweepEnabled: form.elements.bscSweepEnabled.checked, enabledPaymentMethodTypes: data.getAll("enabledPaymentMethodTypes").map(String) };
    openActionModal({ eyebrow: "Live configuration", title: "Save platform settings?", detail: "Fees, risk thresholds, sweep behavior, and available payment rails will change immediately.", confirmLabel: "Save configuration", tone: "primary", phrase: "SAVE", reasonLabel: "Change reason", onConfirm: async ({ reason }) => { await admin.updatePlatformSettings({ ...payload, changeReason: reason }); showToast("Platform settings saved and audit logged."); closeOverlay(); await loadView("settings"); } });
  }

  function openActionModal(config) {
    if (!overlayRoot()) return;
    state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.pendingAction = config;
    overlayRoot().innerHTML = `<div class="ops-overlay" role="presentation"><section class="ops-action-modal" role="dialog" aria-modal="true" aria-labelledby="opsModalTitle"><header><span class="${config.tone || ""}">${icon(config.tone === "danger" ? "shield" : "check")}</span><div><small>${escapeHtml(config.eyebrow || "Reviewed action")}</small><h2 id="opsModalTitle">${escapeHtml(config.title)}</h2></div><button type="button" data-close-overlay aria-label="Close">×</button></header><p>${escapeHtml(config.detail || "")}</p><label><span>${escapeHtml(config.reasonLabel || "Action reason")}</span><textarea id="opsActionReason" rows="4" minlength="${config.minReason || 5}" placeholder="Add clear operational context for the audit log"></textarea></label>${config.phrase ? `<label><span>Type <strong>${escapeHtml(config.phrase)}</strong> to confirm</span><input id="opsActionPhrase" autocomplete="off" /></label>` : ""}<div class="ops-modal-error" id="opsModalError"></div><footer><button type="button" data-close-overlay>Cancel</button><button type="button" class="${config.tone || "primary"}" data-modal-confirm>${escapeHtml(config.confirmLabel || "Confirm")}</button></footer></section></div>`;
    document.querySelector("#opsActionReason")?.focus();
  }

  async function confirmModal(button) {
    const action = state.pendingAction;
    if (!action) return;
    const reason = document.querySelector("#opsActionReason")?.value.trim() || "";
    const phrase = document.querySelector("#opsActionPhrase")?.value.trim() || "";
    const error = document.querySelector("#opsModalError");
    if (reason.length < (action.minReason || 5)) { error.textContent = `Add a reason of at least ${action.minReason || 5} characters.`; return; }
    if (action.phrase && phrase !== action.phrase) { error.textContent = `Type ${action.phrase} exactly to continue.`; return; }
    button.disabled = true;
    button.textContent = "Working…";
    try { await action.onConfirm({ reason, phrase }); }
    catch (err) { error.textContent = err.message || "The action could not be completed."; button.disabled = false; button.textContent = action.confirmLabel || "Confirm"; }
  }

  async function openAttachment(loader) {
    openDrawer(`<div class="ops-drawer-loading"><span></span><strong>Opening secure attachment</strong></div>`, "wide");
    try { const result = await loader(); if (!state.root?.isConnected) return; const file = result.attachment || {}; previewData(file.dataUrl, file.fileName || "Case attachment"); }
    catch (error) { if (state.root?.isConnected) openDrawer(`<div class="ops-drawer-head"><div><small>Secure attachment</small><h2>Could not open file</h2></div><button type="button" data-close-overlay>×</button></div><div class="ops-drawer-error">${escapeHtml(error.message || "Try again.")}</div>`); }
  }

  function previewData(url, label) {
    const image = String(url || "").startsWith("data:image/");
    openDrawer(`<div class="ops-drawer-head"><div><small>Secure preview</small><h2>${escapeHtml(label)}</h2></div><button type="button" data-close-overlay aria-label="Close">×</button></div><div class="ops-file-preview">${image ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(label)}" />` : `<iframe src="${escapeAttr(url)}" title="${escapeAttr(label)}"></iframe>`}</div>`, "wide");
  }

  function openDrawer(content, size = "") {
    if (!overlayRoot()) return;
    if (!overlayNode()) state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlayRoot().innerHTML = `<div class="ops-overlay drawer" role="presentation"><aside class="ops-drawer ${size}" role="dialog" aria-modal="true">${content}</aside></div>`;
    overlayRoot()?.querySelector("button, [tabindex]")?.focus();
  }

  function partialErrors(keys) {
    const failed = keys.filter((key) => state.errors[key]);
    return failed.length ? `<div class="ops-partial-error">${icon("info")}<span><strong>Some data could not be refreshed</strong><small>${escapeHtml(failed.map((key) => state.errors[key]?.message || key).join(" · "))}</small></span></div>` : "";
  }

  function renderFatal(target, error, fallback) {
    if (target) target.innerHTML = `<div class="ops-fatal">${icon("info")}<h2>${escapeHtml(fallback)}</h2><p>${escapeHtml(error?.message || "Refresh the workspace and try again.")}</p><button type="button" data-ops-refresh>Try again</button></div>`;
  }

  function kpi(label, value, detail, iconName, tone) { return `<article class="ops-kpi ${tone}"><span>${icon(iconName)}</span><div><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value ?? "0"))}</strong><p>${escapeHtml(detail)}</p></div></article>`; }
  function panelHead(title, detail, iconName) { return `<header class="ops-panel-head"><div><span>${icon(iconName)}</span><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p></div></div></header>`; }
  function priorityRow(label, count, detail, view, tone) { return `<button type="button" data-ops-view="${view}"><i class="${tone}"></i><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span><b>${integer(count)}</b>${icon("external")}</button>`; }
  function healthRow(label, healthy, detail) { return `<div><i class="${healthy ? "healthy" : "warning"}"></i><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span><em>${healthy ? "Operational" : "Attention"}</em></div>`; }
  function healthRowInline(label, healthy) { return `<em class="ops-inline-health ${healthy ? "healthy" : "warning"}"><i></i>${escapeHtml(label)}</em>`; }
  function moneyMetric(label, value, detail) { return `<article><span>${escapeHtml(label)}</span><strong>${money(value)} <small>USDT</small></strong><p>${escapeHtml(detail)}</p></article>`; }
  function summaryChip(label, value, tone) { return `<article class="${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? 0))}</strong></article>`; }
  function treasuryMetric(label, value, detail, iconName, unit = "USDT") { return `<article><span>${icon(iconName)}</span><div><small>${escapeHtml(label)}</small><strong>${typeof value === "number" ? integer(value) : money(value)} <em>${escapeHtml(unit)}</em></strong><p>${escapeHtml(detail || "")}</p></div></article>`; }
  function compactTrade(item) { return `<div class="ops-compact-row"><span class="ops-compact-icon">${icon("trades")}</span><span><strong>${money(item.assetAmount)} USDT</strong><small>${escapeHtml(statusLabel(item.status))} · ${dateTime(item.createdAt)}</small></span>${statusPill(item.status)}</div>`; }
  function compactAudit(item) { return `<div class="ops-compact-row"><span class="ops-compact-icon">${icon("database")}</span><span><strong>${escapeHtml(actionLabel(item.action))}</strong><small>${escapeHtml(item.actorEmail || "System")} · ${dateTime(item.createdAt)}</small></span></div>`; }
  function compactWithdrawal(item) { return `<div class="ops-compact-row"><span class="ops-compact-icon">${icon("upload")}</span><span><strong>${money(item.amount)} USDT</strong><small>${escapeHtml(statusLabel(item.status))} · ${dateTime(item.createdAt)}</small></span>${statusPill(item.status)}</div>`; }

  function tradeTableRow(item) {
    return `<div class="ops-table-row"><span data-label="Order" class="ops-primary-cell"><strong>#${escapeHtml(shortId(item.id))}</strong><small>${escapeHtml(item.offerSide || "P2P")}</small></span><span data-label="Buyer / Seller"><strong>${escapeHtml(item.buyerTraderLabel || item.buyerUsername || maskEmail(item.buyerEmail))}</strong><small>${escapeHtml(item.sellerTraderLabel || item.sellerUsername || maskEmail(item.sellerEmail))}</small></span><span data-label="Amount"><strong>${money(item.assetAmount)} USDT</strong><small>${money(item.fiatAmount)} ETB</small></span><span data-label="Status">${statusPill(item.status)}</span><span data-label="Opened"><strong>${dateTime(item.createdAt)}</strong></span></div>`;
  }

  function withdrawalTableRow(item) {
    const review = item.status === "requested";
    return `<div class="ops-table-row"><span data-label="User" class="ops-primary-cell"><strong>${escapeHtml(item.email)}</strong><small>#${escapeHtml(shortId(item.id))}</small></span><span data-label="Amount"><strong>${money(item.amount)} USDT</strong><small>${money(item.fee)} fee</small></span><span data-label="Destination"><strong>${escapeHtml(shortAddress(item.address))}</strong><small>${escapeHtml(item.network || "BEP20")}</small></span><span data-label="Risk"><strong>${escapeHtml(statusLabel(item.riskDecision || "manual_review"))}</strong><small>${escapeHtml(item.reviewReason || "No review note")}</small></span><span data-label="Status">${statusPill(item.status)}</span><span data-label="Requested"><strong>${dateTime(item.createdAt)}</strong></span><span class="ops-row-action">${review ? `<button type="button" class="danger" data-withdrawal-decision="reject" data-withdrawal-id="${escapeAttr(item.id)}">Reject</button><button type="button" data-withdrawal-decision="approve" data-withdrawal-id="${escapeAttr(item.id)}">Approve</button>` : ""}</span></div>`;
  }

  function depositTableRow(item) {
    return `<div class="ops-table-row"><span data-label="User" class="ops-primary-cell"><strong>${escapeHtml(item.email)}</strong><small>#${escapeHtml(shortId(item.id))}</small></span><span data-label="Amount"><strong>${money(item.amount)} USDT</strong><small>${escapeHtml(item.network || "BEP20")}</small></span><span data-label="Transaction"><strong>${escapeHtml(shortHash(item.txHash))}</strong><small>Block ${escapeHtml(String(item.blockNumber || "pending"))}</small></span><span data-label="Confirmations"><strong>${integer(item.confirmations)}</strong></span><span data-label="Status">${statusPill(item.status)}</span><span data-label="Detected"><strong>${dateTime(item.createdAt)}</strong></span></div>`;
  }

  function auditTableRow(item) {
    return `<div class="ops-table-row"><span data-label="Timestamp"><strong>${dateTime(item.createdAt)}</strong></span><span data-label="Action" class="ops-primary-cell"><strong>${escapeHtml(actionLabel(item.action))}</strong><small>${escapeHtml(item.action || "")}</small></span><span data-label="Actor"><strong>${escapeHtml(item.actorEmail || "System")}</strong></span><span data-label="Entity"><strong>${escapeHtml(item.entityType || "—")}</strong><small>${escapeHtml(shortId(item.entityId))}</small></span><span data-label="Context"><code>${escapeHtml(metadataSummary(item.metadata))}</code></span></div>`;
  }

  function limitEditor(limit) {
    const name = String(limit.tier || "");
    return `<article><header><span>${icon(name === "merchant" ? "shield" : "user")}</span><div><strong>${escapeHtml(titleCase(name))}</strong><small>Updated ${dateTime(limit.updatedAt)}</small></div></header><label><span>Daily P2P limit</span><div><input name="${escapeAttr(name)}Daily" type="number" min="1" step="0.01" value="${escapeAttr(decimal(limit.dailyTradeLimitUsd))}" /><b>USD</b></div></label><label><span>Daily withdrawal limit</span><div><input name="${escapeAttr(name)}Withdrawal" type="number" min="1" step="0.01" value="${escapeAttr(decimal(limit.withdrawalLimitUsd))}" /><b>USD</b></div></label></article>`;
  }

  function financeFilter(resource, filter, statuses) {
    return `<form id="ops${titleCase(resource)}Filters" class="ops-inline-filters"><input name="search" value="${escapeAttr(filter.search)}" placeholder="Search user, ID, address, or transaction" /><select name="status"><option value="all">All statuses</option>${options(statuses, filter.status)}</select><button type="submit">Filter</button></form>`;
  }

  function pager(resource, page) {
    if (!page || page.totalPages <= 1) return "";
    return `<nav class="ops-pager" aria-label="Pagination"><button type="button" data-ops-page="${resource}" data-page="${page.page - 1}" ${page.page <= 1 ? "disabled" : ""}>Previous</button><span>Page <strong>${integer(page.page)}</strong> of ${integer(page.totalPages)} · ${integer(page.total)} records</span><button type="button" data-ops-page="${resource}" data-page="${page.page + 1}" ${page.page >= page.totalPages ? "disabled" : ""}>Next</button></nav>`;
  }

  function options(items, selected) { return items.map((item) => `<option value="${escapeAttr(item)}" ${item === selected ? "selected" : ""}>${escapeHtml(statusLabel(item))}</option>`).join(""); }
  function statusPill(value) { const status = String(value || "unknown").toLowerCase(); return `<em class="ops-status ${escapeAttr(status.replace(/[^a-z0-9_-]/g, "-"))}"><i></i>${escapeHtml(statusLabel(status))}</em>`; }
  function emptyTable(text) { return `<div class="ops-empty-table">${icon("info")}<strong>${escapeHtml(text)}</strong></div>`; }
  function emptyRow(text) { return `<div class="ops-empty-row">${icon("info")}<span>${escapeHtml(text)}</span></div>`; }
  function emptyDetail(title, detail) { return `<div class="ops-empty-detail">${icon("shield")}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p></div>`; }
  function textValue(data, key) { return String(data.get(key) || "").trim(); }

  function sumLiabilities(stats) { return Number(stats.balances.availableUsdt || 0) + Number(stats.balances.lockedUsdt || 0) + Number(stats.balances.pendingWithdrawalUsdt || 0); }
  function wallet(role) { return (state.treasury?.wallets || []).find((item) => item.role === role) || {}; }
  function walletBalance(role, key) { return wallet(role)[key] || 0; }
  function walletStatus(role) { const item = wallet(role); return item.error ? "RPC unavailable" : item.configured ? "On-chain balance" : "Not configured"; }

  function statusLabel(value) {
    const labels = { active: "Active", suspended: "Suspended", closed: "Closed", unsubmitted: "Not submitted", pending: "Pending", approved: "Approved", rejected: "Rejected", detected: "Detected", confirming: "Confirming", credited: "Credited", broadcast: "Broadcast", confirmed: "Confirmed", failed: "Failed", opened: "Open", payment_sent: "Payment sent", released: "Released", cancelled: "Cancelled", disputed: "Disputed", expired: "Expired", manual_review: "Manual review", admin_approved: "Admin approved", admin_rejected: "Admin rejected" };
    return labels[String(value || "").toLowerCase()] || titleCase(String(value || "Unknown").replace(/_/g, " "));
  }
  function actionLabel(value) { return titleCase(String(value || "System event").replace(/[._]/g, " ")); }
  function metadataSummary(value) { if (!value || (typeof value === "object" && !Object.keys(value).length)) return "No additional context"; const text = typeof value === "string" ? value : JSON.stringify(value); return text.length > 140 ? `${text.slice(0, 137)}…` : text; }
  function paymentLabel(value) { const labels = { telebirr: "Telebirr", mpesa: "M-Pesa", cbe_birr: "CBE Birr", cbe_bank: "CBE", bank_of_abyssinia: "Bank of Abyssinia", awash_bank: "Awash Bank", airtel_money: "Airtel Money", bank: "Other bank", other: "Other method" }; return labels[value] || titleCase(value); }
  function paymentColor(value) { return ({ telebirr: "#f4c430", mpesa: "#00a651", cbe_birr: "#00a89c", cbe_bank: "#7c3aad", bank_of_abyssinia: "#e11d48", awash_bank: "#1e88e5", airtel_money: "#ef4444", bank: "#3b82f6", other: "#94a3b8" })[value] || "#3b82f6"; }

  function money(value) { const number = Number(value || 0); return Number.isFinite(number) ? number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"; }
  function integer(value) { const number = Number(value || 0); return Number.isFinite(number) ? Math.round(number).toLocaleString() : "0"; }
  function decimal(value) { const number = Number(value || 0); return Number.isFinite(number) ? String(number) : "0"; }
  function date(value) { const item = value ? new Date(value) : null; return item && !Number.isNaN(item.getTime()) ? item.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"; }
  function dateTime(value) { const item = value ? new Date(value) : null; return item && !Number.isNaN(item.getTime()) ? item.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
  function age(value) { const date = value ? new Date(value) : null; if (!date || Number.isNaN(date.getTime())) return "unknown"; const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000)); if (seconds < 60) return `${seconds}s`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86400)}d`; }
  function initials(value) { return String(value || "BRX").split(/\s+|@/).filter(Boolean).slice(0, 2).map((item) => item[0]).join("").toUpperCase(); }
  function shortId(value) { const text = String(value || ""); return text ? text.slice(0, 8).toUpperCase() : "—"; }
  function shortHash(value) { const text = String(value || ""); return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text || "—"; }
  function shortAddress(value) { const text = String(value || ""); return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text || "—"; }
  function maskEmail(value) { const [name, domain] = String(value || "").split("@"); return domain ? `${name.slice(0, 2)}***@${domain}` : "Trader"; }
  function titleCase(value) { return String(value || "").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
  function escapeAttr(value) { return escapeHtml(value); }

  async function settle(key, promise) {
    try { const value = await promise; state.errors[key] = null; return value; }
    catch (error) { state.errors[key] = error; return null; }
  }

  function switchView(view) {
    if (!views[view] || view === state.view) return;
    closeOverlay();
    state.view = view;
    history.replaceState(null, "", `#/admin?view=${encodeURIComponent(view)}`);
    updateViewHeader();
    refreshNav();
    window.scrollTo({ top: 0, behavior: "smooth" });
    void loadView(view);
  }

  function updateViewHeader() {
    const meta = views[state.view];
    const eyebrow = state.root?.querySelector("#opsEyebrow");
    const title = state.root?.querySelector("#opsTitle");
    const detail = state.root?.querySelector("#opsDetail");
    if (eyebrow) eyebrow.textContent = meta.eyebrow;
    if (title) title.textContent = meta.title;
    if (detail) detail.textContent = meta.detail;
  }

  function refreshNav() {
    state.root?.querySelectorAll("[data-ops-view]").forEach((item) => item.classList.toggle("active", item.dataset.opsView === state.view));
    document.querySelectorAll("[data-admin-view]").forEach((item) => item.classList.toggle("active", item.dataset.adminView === state.view));
  }

  function updateTimestamp() {
    const item = state.root?.querySelector("#opsUpdated");
    if (item && state.lastUpdated) item.textContent = `Updated ${state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  function workspaceNode() { return state.root?.querySelector("#opsWorkspace"); }
  function overlayRoot() { return state.root?.querySelector("#opsOverlayRoot"); }
  function overlayNode() { return overlayRoot()?.firstElementChild; }
  function closeOverlay() {
    const root = overlayRoot();
    if (root) root.innerHTML = "";
    state.pendingAction = null;
    const focus = state.returnFocus;
    state.returnFocus = null;
    if (focus?.isConnected) focus.focus();
  }

  window.BRX.pages.renderAdmin = renderAdminConsole;
})();
