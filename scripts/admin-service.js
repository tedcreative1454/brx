(function () {
  window.BRX = window.BRX || {};

  const { requestJson } = window.BRX.api;

  function queryString(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, String(value));
    });
    const value = query.toString();
    return value ? `?${value}` : "";
  }

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

  function listUsers(params) {
    return requestJson(`/admin/users${queryString(params)}`);
  }

  function getUser(userId) {
    return requestJson(`/admin/users/${encodeURIComponent(userId)}`);
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

  function listDeposits(params) {
    return requestJson(`/admin/deposits${queryString(params)}`);
  }

  function listWithdrawals(params) {
    return requestJson(`/admin/withdrawals${queryString(params)}`);
  }

  function processWithdrawals(note) {
    return requestJson("/withdrawals/process", { method: "POST", body: JSON.stringify({ note }) });
  }

  function retryDepositSweeps(note) {
    return requestJson("/deposits/sweep", { method: "POST", body: JSON.stringify({ note }) });
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

  function listTrades(params) {
    return requestJson(`/admin/trades${queryString(params)}`);
  }

  function listAuditLogs(params) {
    return requestJson(`/admin/audit-logs${queryString(params)}`);
  }

  function stats() {
    return requestJson("/admin/stats");
  }

  function listKyc(params) {
    return requestJson(`/admin/kyc/submissions${queryString(params)}`);
  }

  function getKyc(id) {
    return requestJson(`/admin/kyc/submissions/${id}`);
  }

  function kycFile(id, kind) {
    return requestJson(`/admin/kyc/submissions/${encodeURIComponent(id)}/files/${encodeURIComponent(kind)}`);
  }

  function approveKyc(id, note) {
    return requestJson(`/admin/kyc/submissions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
  }

  function rejectKyc(id, reason) {
    return requestJson(`/admin/kyc/submissions/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  function listDisputes(params) {
    return requestJson(`/admin/disputes${queryString(params)}`);
  }

  function disputePaymentProof(tradeId) {
    return requestJson(`/admin/disputes/${encodeURIComponent(tradeId)}/payment-proof`);
  }

  function disputeEvidence(tradeId, evidenceId) {
    return requestJson(`/admin/disputes/${encodeURIComponent(tradeId)}/evidence/${encodeURIComponent(evidenceId)}`);
  }

  function disputeMessageAttachment(tradeId, messageId) {
    return requestJson(`/admin/disputes/${encodeURIComponent(tradeId)}/messages/${encodeURIComponent(messageId)}/attachment`);
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

  function updateLimits(updates, reason) {
    return requestJson("/admin/account-limits", {
      method: "PATCH",
      body: JSON.stringify({ updates, reason }),
    });
  }

  window.BRX.adminService = {
    stats,
    treasury,
    platformSettings,
    updatePlatformSettings,
    listUsers,
    getUser,
    updateUserStatus,
    updateUserLabel,
    listDeposits,
    listWithdrawals,
    processWithdrawals,
    retryDepositSweeps,
    approveWithdrawal,
    rejectWithdrawal,
    listTrades,
    listAuditLogs,
    listKyc,
    getKyc,
    kycFile,
    approveKyc,
    rejectKyc,
    listDisputes,
    disputePaymentProof,
    disputeEvidence,
    disputeMessageAttachment,
    resolveDispute,
    limits,
    updateLimit,
    updateLimits,
  };
})();
