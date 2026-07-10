(function () {
  window.BRX = window.BRX || {};

  const { requestJson } = window.BRX.api;

  function treasury() {
    return requestJson("/admin/treasury");
  }

  function platformSettings() {
    return requestJson("/admin/platform-settings");
  }

  function updatePlatformSettings(settings) {
    return requestJson("/admin/platform-settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  }

  function listUsers() {
    return requestJson("/admin/users");
  }

  function updateUserStatus(userId, status, reason) {
    return requestJson(`/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  }

  function updateUserLabel(userId, traderLabel, reason) {
    return requestJson(`/admin/users/${userId}/label`, {
      method: "PATCH",
      body: JSON.stringify({ traderLabel, reason }),
    });
  }

  function listDeposits() {
    return requestJson("/admin/deposits");
  }

  function listWithdrawals() {
    return requestJson("/admin/withdrawals");
  }

  function processWithdrawals() {
    return requestJson("/withdrawals/process", { method: "POST" });
  }

  function approveWithdrawal(id, note) {
    return requestJson(`/admin/withdrawals/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
  }

  function rejectWithdrawal(id, reason) {
    return requestJson(`/admin/withdrawals/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  function listTrades() {
    return requestJson("/admin/trades");
  }

  function listAuditLogs() {
    return requestJson("/admin/audit-logs");
  }

  function stats() {
    return requestJson("/admin/stats");
  }

  function listKyc() {
    return requestJson("/admin/kyc/submissions");
  }

  function getKyc(id) {
    return requestJson(`/admin/kyc/submissions/${id}`);
  }

  function approveKyc(id) {
    return requestJson(`/admin/kyc/submissions/${id}/approve`, { method: "POST" });
  }

  function rejectKyc(id, reason) {
    return requestJson(`/admin/kyc/submissions/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  function listDisputes() {
    return requestJson("/admin/disputes");
  }

  function resolveDispute(tradeId, resolution, note) {
    return requestJson(`/admin/disputes/${tradeId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution, note }),
    });
  }

  function limits() {
    return requestJson("/admin/account-limits");
  }

  function updateLimit(tier, body) {
    return requestJson(`/admin/account-limits/${tier}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  window.BRX.adminService = {
    stats,
    treasury,
    platformSettings,
    updatePlatformSettings,
    listUsers,
    updateUserStatus,
    updateUserLabel,
    listDeposits,
    listWithdrawals,
    processWithdrawals,
    approveWithdrawal,
    rejectWithdrawal,
    listTrades,
    listAuditLogs,
    listKyc,
    getKyc,
    approveKyc,
    rejectKyc,
    listDisputes,
    resolveDispute,
    limits,
    updateLimit,
  };
})();