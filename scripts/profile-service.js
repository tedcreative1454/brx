(function () {
  window.BRX = window.BRX || {};

  const { requestJson } = window.BRX.api;
  const { accessToken, clearSession, currentUser, setSession, upsertUser } = window.BRX.state;

  let hydrationPromise = null;

  function fromBackendUser(backendUser) {
    const existing = currentUser();
    return {
      ...(existing || {}),
      id: existing?.id || backendUser.id,
      backendUserId: backendUser.id,
      email: backendUser.email,
      emailVerified: Boolean(backendUser.emailVerified),
      kycStatus: backendUser.kycStatus || "unsubmitted",
      role: backendUser.role || existing?.role || "user",
      status: backendUser.status || existing?.status || "active",
      depositAddress: backendUser.depositAddress || "",
      network: backendUser.network || "BEP20",
      balance: backendUser.balance || emptyBalance(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
  }

  function emptyBalance() {
    return {
      available: "0",
      locked: "0",
      pendingDeposit: "0",
      pendingWithdrawal: "0",
    };
  }

  function hydrateSession() {
    if (!accessToken()) return Promise.resolve(null);
    if (hydrationPromise) return hydrationPromise;

    hydrationPromise = requestJson("/auth/me")
      .then((result) => {
        const user = upsertUser(fromBackendUser(result.user));
        setSession(user.id);
        return user;
      })
      .catch((error) => {
        console.error(error);
        clearSession();
        return null;
      })
      .finally(() => {
        hydrationPromise = null;
      });

    return hydrationPromise;
  }

  window.BRX.profileService = { hydrateSession, emptyBalance };
})();
