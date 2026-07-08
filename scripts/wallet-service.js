(function () {
  window.BRX = window.BRX || {};
  const { requestJson } = window.BRX.api;
  const { saveUser } = window.BRX.state;
  const { showToast } = window.BRX.ui;

  async function syncBackendWallet(user) {
    const wallet = await requestJson("/wallets/me/deposit-address", { method: "POST" });
    const nextUser = {
      ...user,
      backendUserId: user.backendUserId || user.id,
      depositAddress: wallet.deposit_address,
    };
    saveUser(nextUser);
    return nextUser;
  }

  function copyDepositAddress(address) {
    if (!address) {
      showToast("Deposit address has not been assigned yet.");
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(address).then(() => showToast("Deposit address copied.")).catch(() => showToast("Copy unavailable. Please select the address manually."));
      return;
    }

    showToast("Copy unavailable. Please select the address manually.");
  }

  window.BRX.walletService = { syncBackendWallet, copyDepositAddress };
})();