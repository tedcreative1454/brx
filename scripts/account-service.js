(function () {
  window.BRX = window.BRX || {};

  const { requestJson } = window.BRX.api;
  const { currentUser, setSession, upsertUser } = window.BRX.state;

  function mergeSettings(payload) {
    const existing = currentUser() || {};
    const backendUser = payload.user || {};
    const nextUser = {
      ...existing,
      id: existing.id || backendUser.id,
      backendUserId: backendUser.id || existing.backendUserId,
      email: backendUser.email || existing.email,
      username: backendUser.username ?? existing.username ?? "",
      fullName: backendUser.fullName ?? existing.fullName ?? "",
      phone: backendUser.phone ?? existing.phone ?? "",
      avatarUrl: backendUser.avatarUrl ?? existing.avatarUrl ?? "",
      emailVerified: Boolean(backendUser.emailVerified ?? existing.emailVerified),
      kycStatus: backendUser.kycStatus || existing.kycStatus || "unsubmitted",
      status: backendUser.status || existing.status || "active",
      role: backendUser.role || existing.role || "user",
      createdAt: backendUser.createdAt || existing.createdAt || new Date().toISOString(),
      notificationPreferences: backendUser.notificationPreferences || existing.notificationPreferences || defaultNotifications(),
      tradePreferences: backendUser.tradePreferences || existing.tradePreferences || defaultTradePreferences(),
      paymentMethods: payload.paymentMethods || existing.paymentMethods || [],
      withdrawalAddresses: payload.withdrawalAddresses || existing.withdrawalAddresses || [],
      platformSettings: payload.platformSettings || existing.platformSettings || {},
      accountSettingsLoaded: true,
    };
    const saved = upsertUser(nextUser);
    setSession(saved.id);
    return saved;
  }

  async function loadSettings() {
    return mergeSettings(await requestJson("/account/settings"));
  }

  async function saveProfile(profile) {
    return mergeSettings(await requestJson("/account/profile", {
      method: "PATCH",
      body: JSON.stringify(profile),
    }));
  }

  async function saveNotifications(notificationPreferences) {
    return mergeSettings(await requestJson("/account/notifications", {
      method: "PATCH",
      body: JSON.stringify(notificationPreferences),
    }));
  }

  async function saveTradePreferences(tradePreferences) {
    return mergeSettings(await requestJson("/account/trade-preferences", {
      method: "PATCH",
      body: JSON.stringify(tradePreferences),
    }));
  }

  async function createPaymentMethod(paymentMethod) {
    await requestJson("/account/payment-methods", {
      method: "POST",
      body: JSON.stringify(paymentMethod),
    });
    return loadSettings();
  }

  async function updatePaymentMethod(id, paymentMethod) {
    await requestJson(`/account/payment-methods/${id}`, {
      method: "PATCH",
      body: JSON.stringify(paymentMethod),
    });
    return loadSettings();
  }

  async function deletePaymentMethod(id) {
    await requestJson(`/account/payment-methods/${id}`, { method: "DELETE" });
    return loadSettings();
  }

  async function createWithdrawalAddress(address) {
    await requestJson("/account/withdrawal-addresses", {
      method: "POST",
      body: JSON.stringify(address),
    });
    return loadSettings();
  }

  async function updateWithdrawalAddress(id, address) {
    await requestJson(`/account/withdrawal-addresses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(address),
    });
    return loadSettings();
  }

  async function deleteWithdrawalAddress(id) {
    await requestJson(`/account/withdrawal-addresses/${id}`, { method: "DELETE" });
    return loadSettings();
  }

  async function internalTransfer(transfer) {
    const result = await requestJson("/account/transfers", {
      method: "POST",
      body: JSON.stringify(transfer),
    });
    const existing = currentUser();
    if (existing && result.balance) {
      upsertUser({ ...existing, balance: result.balance });
    }
    return result;
  }

  async function requestWithdrawal(withdrawal) {
    const result = await requestJson("/withdrawals", {
      method: "POST",
      body: JSON.stringify(withdrawal),
    });
    const existing = currentUser();
    if (existing && result.balance) {
      upsertUser({ ...existing, balance: result.balance });
    }
    return result;
  }

  async function listWithdrawals() {
    return requestJson("/withdrawals/my");
  }
  function defaultNotifications() {
    return {
      emailVerification: true,
      tradeUpdates: true,
      depositAlerts: true,
      withdrawalAlerts: true,
      marketing: false,
    };
  }

  function defaultTradePreferences() {
    return {
      market: "ETB/USDT",
      preferredPaymentRails: ["Telebirr", "M-Pesa", "CBE Birr", "CBE", "Bank of Abyssinia", "Awash Bank"],
    };
  }

  window.BRX.accountService = {
    loadSettings,
    saveProfile,
    saveNotifications,
    saveTradePreferences,
    createPaymentMethod,
    updatePaymentMethod,
    deletePaymentMethod,
    createWithdrawalAddress,
    updateWithdrawalAddress,
    deleteWithdrawalAddress,
    internalTransfer,
    requestWithdrawal,
    listWithdrawals,
    defaultNotifications,
    defaultTradePreferences,
  };
})();


