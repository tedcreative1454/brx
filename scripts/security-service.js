(function () {
  window.BRX = window.BRX || {};

  const { requestJson } = window.BRX.api;
  const { currentUser, setSession, upsertUser } = window.BRX.state;

  function mergeSecurity(payload) {
    const existing = currentUser();
    if (!existing) return null;
    const next = upsertUser({
      ...existing,
      security: {
        ...(existing.security || {}),
        ...payload,
      },
      securityLoaded: true,
    });
    setSession(next.id);
    return next;
  }

  async function loadSecurity() {
    const [sessions, twoFactor] = await Promise.all([
      requestJson("/security/sessions"),
      requestJson("/security/2fa"),
    ]);
    return mergeSecurity({ sessions: sessions.sessions || [], twoFactor });
  }

  async function changePassword(currentPassword, newPassword) {
    await requestJson("/security/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return loadSecurity();
  }

  async function revokeSession(id) {
    await requestJson(`/security/sessions/${id}`, { method: "DELETE" });
    return loadSecurity();
  }

  async function revokeOtherSessions() {
    await requestJson("/security/sessions/revoke-others", { method: "POST" });
    return loadSecurity();
  }

  async function startTwoFactorSetup() {
    const setup = await requestJson("/security/2fa/setup", { method: "POST" });
    return mergeSecurity({ twoFactorSetup: setup, twoFactor: { enabled: false, pending: true } });
  }

  async function confirmTwoFactor(code) {
    const twoFactor = await requestJson("/security/2fa/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    return mergeSecurity({ twoFactor, twoFactorSetup: null });
  }

  async function disableTwoFactor(code) {
    const twoFactor = await requestJson("/security/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    return mergeSecurity({ twoFactor, twoFactorSetup: null });
  }

  window.BRX.securityService = {
    loadSecurity,
    changePassword,
    revokeSession,
    revokeOtherSessions,
    startTwoFactorSetup,
    confirmTwoFactor,
    disableTwoFactor,
  };
})();
