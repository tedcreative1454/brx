(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { NETWORKS } = window.BRX.config;
  const { requireUser, currentUser, users, saveUsers } = window.BRX.state;
  const { refs, showError, showToast } = window.BRX.ui;
  const { format, displayName } = window.BRX.utils;
  const { requestJson } = window.BRX.api;
  const { syncBackendWallet, copyDepositAddress } = window.BRX.walletService;
  const { icon } = window.BRX.icons;
  const marketplace = window.BRX.marketplaceService;
  const accountService = window.BRX.accountService;
  const securityService = window.BRX.securityService;
  const notificationService = window.BRX.notificationService;

  let activeWalletMode = "deposit";
  const selectedWalletNetwork = { deposit: "", withdraw: "" };
  let showOfferForm = false;
  let showPaymentMethodForm = false;
  let showTraderNameEditor = false;
  let showDisableTwoFactorForm = false;
  let showTwoFactorSetupDetails = false;
  let offerRequirementsLoading = false;
  let adStatusFilter = "all";
  let lastMyOffers = [];
  let tradeCountdownTimer = null;
  let tradeChatTimer = null;
  let tradeChatLoading = false;
  let tradeChatSignature = "";
  let tradeStatusFilter = "all";
  let lastMyTrades = [];
  let walletActivityState = { loaded: false, loading: false, deposits: [], withdrawals: [], error: "" };

  function renderAds() {
    const user = requireUser();
    if (!user) return;
    refs.app.innerHTML = `
      <section class="exchange-app app-page-wide ads-page professional-ads-page ${showOfferForm ? "ad-composer-page" : ""}">
        <div class="ads-page-tools">
          <div class="ads-page-product"><strong>${showOfferForm ? "Create ad" : "Ad Center"}</strong><small>USDT / ETB marketplace</small></div>
          <button class="${showOfferForm ? "app-ghost-button" : "app-button"}" id="toggleOfferForm" type="button">${showOfferForm ? "Back to ads" : "+ New Ad"}</button>
        </div>

        ${showOfferForm ? offerForm(user) : `<div id="adsContent"><section class="professional-loading-card"><span></span><div><strong>Loading ads</strong><small>Syncing marketplace inventory...</small></div></section></div>`}
      </section>
    `;
    document.querySelector("#toggleOfferForm").addEventListener("click", () => {
      showOfferForm = !showOfferForm;
      renderAds();
    });

    if (showOfferForm) {
      document.querySelector("#offerForm")?.addEventListener("submit", handleCreateOffer);
      document.querySelectorAll("[data-offer-side]").forEach((button) => {
        button.addEventListener("click", () => {
          document.querySelector("#offerSide").value = button.dataset.offerSide;
          updateOfferEligibility();
        });
      });
      ["offerAmount", "offerPrice", "offerMin", "offerMax"].forEach((id) => {
        document.querySelector(`#${id}`)?.addEventListener("input", updateOfferEligibility);
      });
      document.querySelectorAll(".offer-method-grid input").forEach((input) => input.addEventListener("change", updateOfferEligibility));
      document.querySelector("[data-use-max]")?.addEventListener("click", () => {
        const amount = document.querySelector("#offerAmount");
        if (amount) amount.value = String(Number(currentUser()?.balance?.available || 0));
        updateOfferEligibility();
      });
      updateOfferEligibility();
      if (!user.accountSettingsLoaded) void loadOfferRequirements();
    } else {
      void loadMyAds();
    }
  }
  function renderTrades() {
    const user = requireUser();
    if (!user) return;
    const tradeId = window.BRX.router.routeParams().get("id");
    if (tradeCountdownTimer) {
      clearInterval(tradeCountdownTimer);
      tradeCountdownTimer = null;
    }
    if (tradeChatTimer) {
      clearInterval(tradeChatTimer);
      tradeChatTimer = null;
    }
    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow professional-trades-page ${tradeId ? "trade-detail-page" : "trade-list-page"}">
        <div id="tradesContent">${tradeId ? `<section class="professional-loading-card"><span></span><div><strong>Loading trade room</strong><small>Syncing with BRX escrow...</small></div></section>` : tradeListShell()}</div>
      </section>
    `;
    if (tradeId) void loadTradeDetail(tradeId);
    else void loadMyTrades();
  }
  function tradeListShell() {
    return `
      <section class="trade-list-smooth-shell" aria-busy="true">
        <nav class="trade-list-filters smooth-placeholder" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </nav>
        <div class="professional-trade-list smooth-placeholder-list" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      </section>
    `;
  }
  function offerForm(user) {
    const methods = user.paymentMethods || [];
    const available = Number(user.balance?.available || 0);
    const settingsReady = Boolean(user.accountSettingsLoaded);
    const disabled = !settingsReady || !methods.length || available <= 0;
    return `
      <form class="offer-composer" id="offerForm">
        <input id="offerSide" type="hidden" value="sell" />
        <div class="offer-composer-layout">
          <div class="offer-composer-main">
            <section class="offer-composer-section">
              <div class="offer-section-head"><span>1</span><div><h3>Choose ad direction</h3><p>Decide whether traders buy USDT from you or sell USDT to you.</p></div></div>
              <div class="offer-side-switch" role="group" aria-label="Ad direction">
                <button class="active sell" type="button" data-offer-side="sell" aria-pressed="true"><strong>Sell USDT</strong><small>Receive ETB from buyers</small></button>
                <button class="buy" type="button" data-offer-side="buy" aria-pressed="false"><strong>Buy USDT</strong><small>Pay ETB to sellers</small></button>
              </div>
            </section>

            <section class="offer-composer-section">
              <div class="offer-section-head"><span>2</span><div><h3>Set inventory and price</h3><p>Enter the amount available and your fixed ETB price.</p></div></div>
              <div class="offer-field-grid">
                <label class="offer-input-field"><span>USDT amount</span><div><input id="offerAmount" inputmode="decimal" autocomplete="off" placeholder="100.00" required /><b>USDT</b></div></label>
                <label class="offer-input-field"><span>Price per USDT</span><div><input id="offerPrice" inputmode="decimal" autocomplete="off" placeholder="185.00" required /><b>ETB</b></div></label>
              </div>
            </section>

            <section class="offer-composer-section">
              <div class="offer-section-head"><span>3</span><div><h3>Set order limits</h3><p>Define the smallest and largest ETB order a trader can open.</p></div></div>
              <div class="offer-field-grid">
                <label class="offer-input-field"><span>Minimum order</span><div><input id="offerMin" inputmode="decimal" autocomplete="off" placeholder="500.00" required /><b>ETB</b></div></label>
                <label class="offer-input-field"><span>Maximum order</span><div><input id="offerMax" inputmode="decimal" autocomplete="off" placeholder="5,000.00" required /><b>ETB</b></div></label>
              </div>
            </section>

            <section class="offer-composer-section payment-section">
              <div class="offer-section-head"><span>4</span><div><h3>Payment methods</h3><p id="offerPaymentCopy">Choose where buyers will send ETB.</p></div><a href="#/settings?tab=payments">Manage</a></div>
              ${methods.length ? `
                <div class="offer-method-grid payment-methods">
                  ${methods.map((method, index) => `
                    <label class="offer-method-option">
                      <input type="checkbox" value="${escapeAttr(method.label)}" ${index === 0 ? "checked" : ""} />
                      <span class="offer-method-mark">${escapeHtml(String(method.label || "P").slice(0, method.type === "cbe_birr" ? 3 : 1).toUpperCase())}</span>
                      <span><strong>${escapeHtml(method.label)}</strong><small>${escapeHtml(method.phoneNumber || method.accountNumber || "Account linked")}</small></span>
                      <i>${icon("check")}</i>
                    </label>
                  `).join("")}
                </div>
              ` : `<div class="offer-missing-method">${icon("info")}<div><strong>Payment method required</strong><span>Add Telebirr, M-Pesa, CBE, Bank of Abyssinia, or Awash Bank before publishing an ad.</span></div><a href="#/settings?tab=payments">Add method</a></div>`}
            </section>
          </div>

          <aside class="offer-summary-panel">
            <div class="offer-summary-head"><span>Ad preview</span><strong id="offerPreviewSide">Sell USDT</strong></div>
            <div class="offer-balance-card" data-sell-requirement>
              <div><span>Available to sell</span><strong>${format(available)} USDT</strong></div>
              <button type="button" data-use-max>Use max</button>
            </div>
            <div class="offer-summary-rows">
              <div><span>Inventory</span><strong id="offerPreviewAmount">-- USDT</strong></div>
              <div><span>Fixed price</span><strong id="offerPreviewPrice">-- ETB</strong></div>
              <div><span>Total ad value</span><strong id="offerPreviewTotal">-- ETB</strong></div>
              <div><span>Order limits</span><strong id="offerPreviewLimits">-- ETB</strong></div>
              <div><span>Payment methods</span><strong id="offerPreviewMethods">1 selected</strong></div>
            </div>
            <div class="offer-eligibility" id="offerEligibilityBox"><span></span><p id="offerEligibilityMessage">Complete the ad details to continue.</p></div>
            <div class="form-error" id="formError"></div>
            <button class="app-button offer-publish-button" id="postOfferButton" type="submit" ${disabled ? "disabled" : ""}>Publish sell ad</button>
            <small class="offer-publish-note">Your ad becomes visible on the marketplace immediately after publishing.</small>
          </aside>
        </div>
      </form>
    `;
  }
  async function loadOfferRequirements() {
    if (offerRequirementsLoading || !accountService) return;
    offerRequirementsLoading = true;
    try {
      await accountService.loadSettings();
      if (window.BRX.router.routeName() === "ads" && showOfferForm) renderAds();
    } catch (error) {
      showError(error.message || "Could not load your wallet and payment methods.");
    } finally {
      offerRequirementsLoading = false;
    }
  }

  function updateOfferEligibility() {
    const side = document.querySelector("#offerSide")?.value || "sell";
    const user = currentUser();
    if (!user) return;

    const amount = Number(String(document.querySelector("#offerAmount")?.value || "0").replace(/,/g, ""));
    const price = Number(String(document.querySelector("#offerPrice")?.value || "0").replace(/,/g, ""));
    const minFiat = Number(String(document.querySelector("#offerMin")?.value || "0").replace(/,/g, ""));
    const maxFiat = Number(String(document.querySelector("#offerMax")?.value || "0").replace(/,/g, ""));
    const totalFiat = amount > 0 && price > 0 ? amount * price : 0;
    const methods = user.paymentMethods || [];
    const selectedMethods = [...document.querySelectorAll(".offer-method-grid input:checked")];
    const available = Number(user.balance?.available || 0);
    const sellRequirement = document.querySelector("[data-sell-requirement]");
    const message = document.querySelector("#offerEligibilityMessage");
    const eligibilityBox = document.querySelector("#offerEligibilityBox");
    const button = document.querySelector("#postOfferButton");
    const formError = document.querySelector("#formError");

    document.querySelectorAll("[data-offer-side]").forEach((sideButton) => {
      const active = sideButton.dataset.offerSide === side;
      sideButton.classList.toggle("active", active);
      sideButton.setAttribute("aria-pressed", String(active));
    });
    sellRequirement?.classList.toggle("hidden", side !== "sell");

    const previewSide = document.querySelector("#offerPreviewSide");
    const previewAmount = document.querySelector("#offerPreviewAmount");
    const previewPrice = document.querySelector("#offerPreviewPrice");
    const previewTotal = document.querySelector("#offerPreviewTotal");
    const previewLimits = document.querySelector("#offerPreviewLimits");
    const previewMethods = document.querySelector("#offerPreviewMethods");
    const paymentCopy = document.querySelector("#offerPaymentCopy");
    if (previewSide) previewSide.textContent = side === "sell" ? "Sell USDT" : "Buy USDT";
    if (previewAmount) previewAmount.textContent = amount > 0 ? `${format(amount)} USDT` : "-- USDT";
    if (previewPrice) previewPrice.textContent = price > 0 ? `${format(price)} ETB` : "-- ETB";
    if (previewTotal) previewTotal.textContent = totalFiat > 0 ? `${format(totalFiat)} ETB` : "-- ETB";
    if (previewLimits) previewLimits.textContent = minFiat > 0 && maxFiat > 0 ? `${format(minFiat)} - ${format(maxFiat)} ETB` : "-- ETB";
    if (previewMethods) previewMethods.textContent = `${selectedMethods.length} selected`;
    if (paymentCopy) paymentCopy.textContent = side === "sell" ? "Choose where buyers will send ETB." : "Choose the ETB payment option shown to sellers.";
    if (formError) formError.textContent = "";

    let status = "ready";
    let statusMessage = "Ad details are valid and ready to publish.";
    if (!user.accountSettingsLoaded) {
      status = "loading";
      statusMessage = "Checking your wallet and linked payment methods...";
    } else if (!methods.length || !selectedMethods.length) {
      status = "error";
      statusMessage = "Select at least one linked payment method.";
    } else if (!(amount > 0 && price > 0 && minFiat > 0 && maxFiat > 0)) {
      status = "pending";
      statusMessage = "Complete the amount, price, and order limits.";
    } else if (maxFiat < minFiat) {
      status = "error";
      statusMessage = "Maximum order must be higher than the minimum order.";
    } else if (maxFiat > totalFiat) {
      status = "error";
      statusMessage = "Maximum order cannot exceed the total ad value.";
    } else if (side === "sell" && (available <= 0 || amount > available)) {
      status = "error";
      statusMessage = "You don't have enough available USDT for this sell ad.";
    }

    if (message) message.textContent = statusMessage;
    if (eligibilityBox) eligibilityBox.className = `offer-eligibility ${status}`;
    if (button) {
      button.disabled = status !== "ready";
      button.textContent = side === "sell" ? "Publish sell ad" : "Publish buy ad";
    }
  }
  async function loadMyAds() {
    const content = document.querySelector("#adsContent");
    if (!content) return;
    try {
      const result = await marketplace.myOffers();
      lastMyOffers = result.offers || [];
      renderAdsManager(content);
    } catch (error) {
      content.innerHTML = `<section class="warning-card"><h3>Could not load ads</h3><p>${escapeHtml(error.message || "Start the BRX backend and reload.")}</p></section>`;
    }
  }

  function renderAdsManager(content = document.querySelector("#adsContent")) {
    if (!content) return;
    const counts = adStatusCounts(lastMyOffers);
    const tabs = [
      ["all", "All ads", "Full history"],
      ["active", "Active", "Visible on P2P"],
      ["paused", "Paused", "Hidden ads"],
      ["cancelled", "Cancelled", "Closed ads"],
    ];
    const filtered = adStatusFilter === "all" ? lastMyOffers : lastMyOffers.filter((offer) => offer.status === adStatusFilter);

    if (!lastMyOffers.length) {
      content.innerHTML = `
        <section class="ads-empty-desk">
          <span>${icon("send")}</span>
          <div><p class="app-label blue">BRX ad engine</p><h2>No ads yet</h2><p>Publish a sell or buy ad to appear on the P2P marketplace with your price, order limits, and payment methods.</p></div>
          <button class="app-button" id="emptyPostAd" type="button">+ New Ad</button>
        </section>
      `;
      document.querySelector("#emptyPostAd")?.addEventListener("click", () => {
        showOfferForm = true;
        renderAds();
      });
      return;
    }

    content.innerHTML = `
      <section class="ads-control-panel">
        <div class="ad-status-switch" role="tablist" aria-label="Filter ads by status">
          ${tabs.map(([status, label, copy]) => `<button class="${adStatusFilter === status ? "active" : ""}" type="button" role="tab" aria-selected="${adStatusFilter === status}" data-ad-filter="${status}"><strong>${label}</strong><small>${copy}</small><b>${counts[status]}</b></button>`).join("")}
        </div>
        <div class="ads-control-note"><strong>${filtered.length}</strong><span>${adStatusFilter === "all" ? "ads shown" : `${statusLabel(adStatusFilter)} ads shown`}</span></div>
      </section>

      ${filtered.length
        ? `<div class="ad-management-table ads-exchange-table"><div class="my-ad-row my-ad-header"><span>Ad</span><span>Price</span><span>Inventory / Limits</span><span>Payment</span><span>Actions</span></div>${filtered.map(myOfferRow).join("")}</div>`
        : `<section class="empty-panel compact"><span class="mini-icon">${adStatusFilter.slice(0, 2)}</span><h3>No ${escapeHtml(adStatusFilter)} ads</h3><p>Ads with this status will appear here.</p></section>`}
    `;

    content.querySelectorAll("[data-ad-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        adStatusFilter = button.dataset.adFilter || "all";
        renderAdsManager(content);
      });
    });
    content.querySelectorAll("[data-offer-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const offer = lastMyOffers.find((item) => item.id === button.dataset.offerEdit);
        if (offer) void openEditOfferModal(offer);
      });
    });
    content.querySelectorAll("[data-offer-status]").forEach((button) => {
      button.addEventListener("click", () => handleOfferStatus(button.dataset.offerId, button.dataset.offerStatus, button));
    });
  }

  function adStatusCounts(offers) {
    return offers.reduce((counts, offer) => {
      counts.all += 1;
      counts[offer.status] = (counts[offer.status] || 0) + 1;
      return counts;
    }, { all: 0, active: 0, paused: 0, cancelled: 0 });
  }

  function titleCaseStatus(status) {
    return statusLabel(status).replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  function myOfferRow(offer) {
    const action = offer.side === "sell" ? "Sell" : "Buy";
    const statusClass = offer.status === "active" ? "success" : offer.status === "paused" ? "warning" : "neutral";
    const priceClass = offer.side === "buy" ? "buy" : "sell";
    const maxFiat = Math.min(Number(offer.maxFiat || 0), Number(offer.availableAmount || 0) * Number(offer.price || 0));
    return `
      <div class="my-ad-row ads-exchange-row ${offer.status}">
        <div class="ad-cell-main">
          <span class="ad-side-mark ${offer.side}">${offer.side === "sell" ? "S" : "B"}</span>
          <div><strong>${action} USDT</strong><small>${offer.side === "sell" ? "Receive ETB from buyers" : "Pay ETB to sellers"}</small><span class="status-pill ${statusClass}">${titleCaseStatus(offer.status)}</span></div>
        </div>
        <div class="ad-price-cell"><strong class="${priceClass}">${format(Number(offer.price))}</strong><small>ETB / USDT</small></div>
        <div class="ad-inventory-cell"><strong>${format(Number(offer.availableAmount))} USDT</strong><small>${format(Number(offer.minFiat))} ETB - ${format(maxFiat || Number(offer.maxFiat))} ETB</small></div>
        <div class="chips ad-payment-cell">${(offer.paymentMethods || []).length ? offer.paymentMethods.map((method) => `<span>${escapeHtml(method)}</span>`).join("") : `<small>No method</small>`}</div>
        <div class="row-actions ad-row-actions">
          ${offer.status !== "cancelled" ? `<button class="app-ghost-button small" type="button" data-offer-edit="${escapeAttr(offer.id)}">Edit</button>` : ""}
          ${offer.status === "active" ? `<button class="app-ghost-button small" type="button" data-offer-id="${escapeAttr(offer.id)}" data-offer-status="paused">Pause</button>` : ""}
          ${offer.status === "paused" ? `<button class="app-button small" type="button" data-offer-id="${escapeAttr(offer.id)}" data-offer-status="active">Resume</button>` : ""}
          ${offer.status !== "cancelled" ? `<button class="danger-button small" type="button" data-offer-id="${escapeAttr(offer.id)}" data-offer-status="cancelled">Cancel</button>` : `<span class="app-muted">Closed</span>`}
        </div>
      </div>
    `;
  }
  async function handleCreateOffer(event) {
    event.preventDefault();
    showError("");
    const side = document.querySelector("#offerSide").value;
    const amount = Number(String(document.querySelector("#offerAmount").value || "0").replace(/,/g, ""));
    const price = Number(String(document.querySelector("#offerPrice").value || "0").replace(/,/g, ""));
    const minFiat = Number(String(document.querySelector("#offerMin").value || "0").replace(/,/g, ""));
    const maxFiat = Number(String(document.querySelector("#offerMax").value || "0").replace(/,/g, ""));
    const available = Number(currentUser()?.balance?.available || 0);
    const paymentMethods = [...document.querySelectorAll(".offer-method-grid input:checked")].map((input) => input.value);
    const button = document.querySelector("#postOfferButton");
    const originalText = button?.textContent;

    if (!(amount > 0 && price > 0 && minFiat > 0 && maxFiat > 0)) return showError("Complete all pricing and order fields.");
    if (maxFiat < minFiat) return showError("Maximum order must be higher than minimum order.");
    if (maxFiat > amount * price) return showError("Maximum order cannot exceed the total ad value.");
    if (side === "sell" && amount > available) return showError("You don't have enough USDT to sell.");
    if (!paymentMethods.length) return showError("Select at least one linked payment method.");

    if (button) {
      button.disabled = true;
      button.textContent = "Publishing ad...";
    }
    try {
      await marketplace.createOffer({ side, amount, price, minFiat, maxFiat, paymentMethods });
      showToast(`${side === "sell" ? "Sell" : "Buy"} ad published.`);
      showOfferForm = false;
      adStatusFilter = "all";
      await window.BRX.profileService.hydrateSession();
      renderAds();
    } catch (error) {
      showError(error.message || "Could not post ad.");
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }
  async function handleOfferStatus(offerId, status, button) {
    const offer = lastMyOffers.find((item) => item.id === offerId);
    if (!offer) return;
    if (status === "paused" && !confirm("Pause this ad? It will be hidden from the marketplace until you resume it.")) return;
    if (status === "cancelled" && !confirm("Cancel this ad permanently? A cancelled ad cannot be reactivated.")) return;

    const originalText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = status === "active" ? "Resuming..." : status === "paused" ? "Pausing..." : "Cancelling...";
    }
    try {
      await marketplace.updateOfferStatus(offerId, status);
      showToast(status === "active" ? "Ad resumed." : status === "paused" ? "Ad paused." : "Ad cancelled.");
      await loadMyAds();
    } catch (error) {
      showToast(error.message || "Could not update ad.");
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function openEditOfferModal(offer) {
    try {
      if (!currentUser()?.accountSettingsLoaded) await accountService.loadSettings();
    } catch (error) {
      return showToast(error.message || "Could not load payment methods.");
    }
    const methods = currentUser()?.paymentMethods || [];
    const selected = new Set((offer.paymentMethods || []).map((method) => String(method).toLowerCase()));
    const modal = document.createElement("div");
    modal.className = "trade-modal-backdrop";
    modal.innerHTML = `
      <form class="trade-confirm-modal edit-offer-modal" id="editOfferForm">
        <button class="modal-x" type="button" data-close-edit-offer aria-label="Close">x</button>
        <div><p class="app-label blue">Manage ad</p><h3>Edit ${offer.side === "sell" ? "Sell" : "Buy"} USDT ad</h3><p class="app-muted">Update the remaining amount, price, limits, or payment methods.</p></div>
        <div class="settings-form-grid">
          <label class="form-field"><span>Available USDT amount</span><input id="editOfferAmount" inputmode="decimal" value="${escapeAttr(offer.availableAmount)}" required /></label>
          <label class="form-field"><span>Price per USDT (ETB)</span><input id="editOfferPrice" inputmode="decimal" value="${escapeAttr(offer.price)}" required /></label>
          <label class="form-field"><span>Minimum ETB order</span><input id="editOfferMin" inputmode="decimal" value="${escapeAttr(offer.minFiat)}" required /></label>
          <label class="form-field"><span>Maximum ETB order</span><input id="editOfferMax" inputmode="decimal" value="${escapeAttr(offer.maxFiat)}" required /></label>
        </div>
        <div class="offer-payment-head"><div><strong>Payment methods</strong><small>Select at least one linked receiving account.</small></div><a href="#/settings?tab=payments">Manage</a></div>
        <div class="payment-methods edit-offer-methods">
          ${methods.map((method, index) => {
            const checked = selected.has(String(method.label).toLowerCase()) || (!selected.size && index === 0);
            return `<label><input type="checkbox" value="${escapeAttr(method.label)}" ${checked ? "checked" : ""} /> ${escapeHtml(method.label)}</label>`;
          }).join("")}
        </div>
        ${methods.length ? "" : `<div class="deposit-note warning">Add a payment method before editing this ad.</div>`}
        <div class="form-error" id="editOfferError"></div>
        <div class="edit-offer-actions"><button class="app-ghost-button" type="button" data-close-edit-offer>Close</button><button class="app-button" id="saveOfferEdit" type="submit" ${methods.length ? "" : "disabled"}>Save changes</button></div>
      </form>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelectorAll("[data-close-edit-offer]").forEach((button) => button.addEventListener("click", close));
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    modal.querySelector("#editOfferForm").addEventListener("submit", (event) => handleEditOfferSubmit(event, offer, modal));
  }

  async function handleEditOfferSubmit(event, offer, modal) {
    event.preventDefault();
    const errorNode = modal.querySelector("#editOfferError");
    const saveButton = modal.querySelector("#saveOfferEdit");
    const paymentMethods = [...modal.querySelectorAll(".edit-offer-methods input:checked")].map((input) => input.value);
    if (!paymentMethods.length) {
      errorNode.textContent = "Select at least one linked payment method.";
      return;
    }
    errorNode.textContent = "";
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
    try {
      await marketplace.updateOffer(offer.id, {
        amount: modal.querySelector("#editOfferAmount").value,
        price: modal.querySelector("#editOfferPrice").value,
        minFiat: modal.querySelector("#editOfferMin").value,
        maxFiat: modal.querySelector("#editOfferMax").value,
        paymentMethods,
      });
      modal.remove();
      showToast("Ad changes saved.");
      await loadMyAds();
    } catch (error) {
      errorNode.textContent = error.message || "Could not save this ad.";
      saveButton.disabled = false;
      saveButton.textContent = "Save changes";
    }
  }
  async function loadMyTrades() {
    const content = document.querySelector("#tradesContent");
    try {
      const result = await marketplace.myTrades();
      lastMyTrades = result.trades || [];
      renderTradeCollection();
    } catch (error) {
      content.innerHTML = `<section class="professional-error-card">${icon("info")}<div><h3>Could not load trades</h3><p>${escapeHtml(error.message || "Check the BRX backend connection and try again.")}</p></div><button class="app-ghost-button small" id="retryTrades" type="button">Try again</button></section>`;
      document.querySelector("#retryTrades")?.addEventListener("click", () => void loadMyTrades());
    }
  }

  function renderTradeCollection() {
    const content = document.querySelector("#tradesContent");
    if (!content) return;
    const groups = {
      active: lastMyTrades.filter((trade) => ["opened", "payment_sent", "disputed"].includes(trade.status)),
      completed: lastMyTrades.filter((trade) => trade.status === "released"),
      cancelled: lastMyTrades.filter((trade) => ["cancelled", "expired"].includes(trade.status)),
    };
    const filtered = tradeStatusFilter === "all" ? lastMyTrades : groups[tradeStatusFilter] || [];

    content.innerHTML = `<section class="professional-trade-list-card">
        <nav class="trade-list-filters" aria-label="Filter trades">
          ${tradeFilterButton("all", "All", lastMyTrades.length)}
          ${tradeFilterButton("active", "Active", groups.active.length)}
          ${tradeFilterButton("completed", "Completed", groups.completed.length)}
          ${tradeFilterButton("cancelled", "Cancelled", groups.cancelled.length)}
        </nav>
        <div class="professional-trade-list">
          ${filtered.length ? filtered.map(tradeRow).join("") : `
            <div class="professional-trade-empty">${icon("trades")}<h3>${lastMyTrades.length ? "No trades in this category" : "No trades yet"}</h3><p>${lastMyTrades.length ? "Choose another status to see your orders." : "Browse verified P2P offers and open your first escrow trade."}</p>${lastMyTrades.length ? "" : `<a class="app-button small" href="#/market">Browse market</a>`}</div>
          `}
        </div>
      </section>
    `;
    bindTradeListEvents();
  }

  function tradeFilterButton(key, label) {
    return `<button class="${tradeStatusFilter === key ? "active" : ""}" type="button" data-trade-filter="${key}"><span>${label}</span></button>`;
  }

  function bindTradeListEvents() {
    document.querySelectorAll("[data-trade-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        tradeStatusFilter = button.dataset.tradeFilter;
        renderTradeCollection();
      });
    });
    document.querySelectorAll("[data-trade-action]").forEach((button) => {
      button.addEventListener("click", () => handleTradeAction(button.dataset.tradeId, button.dataset.tradeAction));
    });
    document.querySelectorAll("[data-trade-open]").forEach((button) => {
      button.addEventListener("click", () => {
        location.hash = `#/trades?id=${encodeURIComponent(button.dataset.tradeOpen)}`;
      });
    });
  }

  async function loadTradeDetail(tradeId) {
    const content = document.querySelector("#tradesContent");
    document.body.classList.remove("payment-proof-open");
    document.body.classList.remove("dispute-flow-open");
    try {
      const result = await marketplace.getTrade(tradeId);
      const trade = result.trade;
      content.innerHTML = tradeDetail(trade);
      bindTradeDetail(trade);
      startTradeCountdown(trade);
      startTradeChat(trade);
    } catch (error) {
      content.innerHTML = `<section class="warning-card"><h3>Could not load trade</h3><p>${escapeHtml(error.message || "Start the BRX backend and reload.")}</p></section>`;
    }
  }

  function tradeRow(trade) {
    const isBuyer = trade.role === "buyer";
    const roleText = isBuyer ? "Buy USDT" : "Sell USDT";
    const counterparty = escapeHtml(counterpartyName(trade));
    const tone = trade.status === "released" ? "success" : trade.status === "disputed" ? "warning" : ["cancelled", "expired"].includes(trade.status) ? "danger" : "active";
    const nextStep = trade.status === "opened" && isBuyer ? "Payment required" : trade.status === "payment_sent" && trade.role === "seller" ? "Confirm payment" : statusLabel(trade.status);
    return `
      <article class="professional-trade-row ${tone}">
        <button class="trade-row-main" type="button" data-trade-open="${escapeAttr(trade.id)}">
          <span class="trade-direction ${isBuyer ? "buy" : "sell"}">${icon(isBuyer ? "buyArrow" : "sellArrow")}</span>
          <span class="trade-counterparty"><small>${roleText} - #${shortTradeId(trade.id)}</small><strong>${counterparty}</strong><em>${dateTime(trade.createdAt)}</em></span>
          <span class="trade-row-amount"><strong>${format(Number(trade.assetAmount))} USDT</strong><small>${format(Number(trade.fiatAmount))} ETB</small></span>
          <span class="trade-row-state"><b class="${tone}">${escapeHtml(nextStep)}</b><small>${format(Number(trade.offerPrice || Number(trade.fiatAmount) / Number(trade.assetAmount)))} ETB/USDT</small></span>
          <span class="trade-row-open">${icon("external")}</span>
        </button>
        <div class="trade-row-actions">${tradeListAction(trade)}</div>
      </article>
    `;
  }

  function tradeListAction(trade) {
    if (trade.status === "released") return `<span class="trade-list-result success">${icon("check")} Completed</span>`;
    if (["cancelled", "expired"].includes(trade.status)) return `<span class="trade-list-result closed">Closed</span>`;
    if (trade.status === "disputed") return `<span class="trade-list-result warning">Admin review</span>`;
    return tradeActions(trade);
  }

  function tradeDetail(trade) {
    const sellerMethods = trade.sellerPaymentMethods || [];
    return `
      <section class="trade-detail-grid">
        <article class="app-card trade-detail-main">
          <div class="trade-detail-head">
            <div>
              <p class="app-label blue">${trade.role === "buyer" ? "Buy USDT" : "Sell USDT"}</p>
              <h3>${format(Number(trade.assetAmount))} USDT</h3>
              <p class="app-muted">${format(Number(trade.fiatAmount))} ETB - ${format(Number(trade.offerPrice || Number(trade.fiatAmount) / Number(trade.assetAmount)))} ETB/USDT</p>
            </div>
            <span class="status-pill ${trade.status === "disputed" ? "warning" : ""}">${statusLabel(trade.status)}</span>
          </div>

          ${trade.status === "opened" ? countdownBlock(trade) : ""}
          ${trade.role === "buyer" ? buyerPaymentBlock(trade, sellerMethods) : sellerPaymentBlock(trade)}

          <div class="trade-actions-panel">${tradeActions(trade)}</div>
        </article>

        <aside class="app-card trade-side-panel">
          ${tradeLifecyclePanel(trade)}
        </aside>
      </section>

      ${disputeAccessPanel(trade)}
    `;
  }

  function countdownBlock(trade) {
    return `
      <section class="trade-countdown-card">
        <span>Payment window</span>
        <strong id="tradeCountdown">${timeLeft(trade.expiresAt)}</strong>
        <small>Buyer must mark payment sent before this timer ends.</small>
      </section>
    `;
  }

  function buyerPaymentBlock(trade, sellerMethods) {
    if (["cancelled", "expired", "released"].includes(trade.status)) {
      return `<p class="deposit-note">This trade is ${statusLabel(trade.status)}. No payment action is required.</p>`;
    }

    const price = Number(trade.offerPrice || Number(trade.fiatAmount) / Number(trade.assetAmount));
    return `
      <section class="payment-instructions">
        <div>
          <p class="app-label">Pay seller outside BRX</p>
          <h4>${format(Number(trade.fiatAmount))} ETB</h4>
          <p class="app-muted">Send ETB using one of the seller payment methods below. BRX never handles the ETB payment.</p>
        </div>
        <div class="payment-method-list">
          ${sellerMethods.length ? sellerMethods.map(paymentMethodCard).join("") : `<div class="payment-method-card"><strong>Payment method pending</strong><small>Ask the seller to add a payment method before paying.</small></div>`}
        </div>
      </section>
    `;
  }

  function sellerPaymentBlock(trade) {
    if (trade.status === "opened") {
      return `<p class="deposit-note">Your USDT is locked in escrow. Wait for the buyer to pay in ETB and mark payment sent.</p>`;
    }
    if (trade.status === "payment_sent") {
      return `<p class="deposit-note">Check your ETB account carefully. Release USDT only after you confirm payment is received.</p>`;
    }
    if (trade.status === "disputed") {
      return `<p class="deposit-note">This trade is under admin review. Add evidence below if needed.</p>`;
    }
    return `<p class="deposit-note">This trade is ${statusLabel(trade.status)}.</p>`;
  }

  function paymentMethodCard(method) {
    const details = [
      method.accountName,
      method.phoneNumber,
      method.bankName,
      method.accountNumber,
      method.instructions,
    ].filter(Boolean);
    return `
      <div class="payment-method-card">
        <strong>${escapeHtml(method.label || paymentTypeLabel(method.type))}</strong>
        ${details.map((item) => `<small>${escapeHtml(item)}</small>`).join("")}
      </div>
    `;
  }

  function disputePanel(trade) {
    const isOpen = trade.status === "disputed";
    const counterparty = counterpartyName(trade);
    const shellClass = isOpen ? "dispute-review-shell" : "dispute-flow-backdrop";
    return `
      <div class="${shellClass}" ${isOpen ? "" : "data-dispute-backdrop"}>
        <section class="dispute-center ${isOpen ? "review" : "create"}" role="${isOpen ? "region" : "dialog"}" ${isOpen ? "" : 'aria-modal="true"'} aria-labelledby="disputeTitle">
          <header class="dispute-center-head">
            <div class="dispute-center-mark">!</div>
            <div>
              <span>${isOpen ? "Case in review" : "BRX dispute center"}</span>
              <h2 id="disputeTitle">${isOpen ? "Dispute under review" : "Open a dispute"}</h2>
              <p>${isOpen ? "Add information while BRX reviews the escrow." : "Escrow stays locked while BRX reviews both sides."}</p>
            </div>
            ${isOpen ? `<span class="dispute-review-status">In review</span>` : `<button class="dispute-close" type="button" data-close-dispute aria-label="Close dispute">&times;</button>`}
          </header>

          <div class="dispute-order-strip">
            <div><span>Order</span><strong>#${shortTradeId(trade.id)}</strong></div>
            <div><span>Amount</span><strong>${format(Number(trade.assetAmount))} USDT</strong></div>
            <div><span>Trader</span><strong>${escapeHtml(counterparty)}</strong></div>
          </div>

          ${isOpen ? evidenceList(trade.evidence || []) : `
            <div class="dispute-safety-note">
              <div><strong>Before you submit</strong><p>Check trade chat and your payment account first. Use a dispute only when payment or release is still unresolved.</p></div>
              <a href="#/p2p-chat?id=${encodeURIComponent(trade.id)}">Open trade chat</a>
            </div>
          `}

          <form class="evidence-form dispute-form" id="evidenceForm">
            ${isOpen ? "" : `
              <label class="dispute-field wide">
                <span>What went wrong?</span>
                <select id="evidenceCategory" required>
                  <option value="">Select a reason</option>
                  <option value="Payment sent but USDT was not released">Payment sent, USDT not released</option>
                  <option value="Payment was not received">Payment not received</option>
                  <option value="Payment details are incorrect">Incorrect payment details</option>
                  <option value="Counterparty is not responding">Trader is not responding</option>
                  <option value="Other trade issue">Other issue</option>
                </select>
              </label>
            `}
            <label class="dispute-field wide">
              <span>${isOpen ? "Add a note" : "Tell us what happened"}</span>
              <textarea id="evidenceNote" rows="4" maxlength="1000" placeholder="${isOpen ? "Share new information for the reviewer." : "Add only the details BRX needs to verify this trade."}"></textarea>
              <small>Do not include passwords, PINs, or verification codes.</small>
            </label>
            <div class="dispute-support-grid">
              <label class="dispute-field">
                <span>Payment reference <em>Optional</em></span>
                <input id="evidenceReference" maxlength="160" placeholder="Bank or mobile-money reference" />
              </label>
              <label class="dispute-upload" for="evidenceFile">
                <input id="evidenceFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" />
                <span>+</span>
                <div><strong id="evidenceFileLabel">Add evidence</strong><small>Image or PDF, max 8 MB</small></div>
              </label>
            </div>
            ${isOpen ? "" : `
              <label class="dispute-confirm"><input id="disputeConfirm" type="checkbox" /><span>I confirm the information is accurate and understand that false claims may restrict my account.</span></label>
            `}
            <div class="form-error" id="evidenceError"></div>
            <footer class="dispute-form-footer">
              ${isOpen ? "" : `<button class="dispute-cancel" type="button" data-close-dispute>Cancel</button>`}
              <button class="dispute-submit" type="submit">${isOpen ? "Add to case" : "Submit dispute"}</button>
            </footer>
          </form>
        </section>
      </div>
    `;
  }

  function evidenceList(evidence) {
    if (!evidence.length) return `<div class="evidence-list empty">No evidence submitted yet.</div>`;
    return `
      <div class="evidence-list">
        ${evidence.map((item) => `
          <div class="evidence-item">
            <strong>${escapeHtml(item.fileName || "Evidence note")}</strong>
            ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
            <small>${dateTime(item.createdAt)}</small>
          </div>
        `).join("")}
      </div>
    `;
  }

  function tradeLifecyclePanel(trade) {
    const meta = tradeLifecycleMeta(trade);
    const counterparty = counterpartyName(trade);
    return `
      <section class="trade-counterparty-card">
        <p class="app-label">Counterparty</p>
        <strong>${escapeHtml(counterparty)}</strong>
        <small>${escapeHtml(statusLabel(trade.status))} trade #${shortTradeId(trade.id)}</small>
      </section>
      <section class="trade-lifecycle-card">
        <div class="trade-lifecycle-head">
          <div>
            <p class="app-label blue">Trade lifecycle</p>
            <h3>${escapeHtml(meta.title)}</h3>
            <small>${escapeHtml(meta.copy)}</small>
          </div>
          <span>${meta.percent}%</span>
        </div>
        <div class="trade-progress-track" aria-hidden="true"><i style="width:${meta.percent}%"></i></div>
        <div class="trade-timeline">${tradeTimeline(trade)}</div>
      </section>
      <section class="trade-audit-card">
        <div class="trade-audit-head">
          <div>
            <p class="app-label">Audit trail</p>
            <h3>Trade record</h3>
          </div>
          <span>${tradeAuditEvents(trade).length} events</span>
        </div>
        <div class="trade-audit-list">${tradeAuditEvents(trade).map(tradeAuditItem).join("")}</div>
      </section>
    `;
  }

  function tradeLifecycleMeta(trade) {
    const status = trade.status;
    if (status === "released") return { title: "Trade completed", copy: "USDT has been released and this order is closed.", percent: 100 };
    if (status === "disputed") return { title: "Admin review in progress", copy: "Both sides can add evidence while BRX reviews the dispute.", percent: 78 };
    if (status === "payment_sent") return { title: "Seller reviewing payment", copy: "The buyer marked ETB as sent. Seller should verify before release.", percent: 66 };
    if (status === "cancelled") return { title: "Trade cancelled", copy: "Escrow was returned according to the trade close reason.", percent: 100 };
    if (status === "expired") return { title: "Trade expired", copy: "The payment window ended before the trade progressed.", percent: 100 };
    return trade.role === "buyer"
      ? { title: "Waiting for payment", copy: "Send ETB to the seller, then mark payment sent before the timer ends.", percent: 38 }
      : { title: "Waiting for buyer", copy: "Your USDT is locked while the buyer completes ETB payment.", percent: 38 };
  }

  function tradeTimeline(trade) {
    const steps = tradeLifecycleSteps(trade);
    return steps.map((step) => `
      <div class="timeline-step ${step.state}">
        <span></span>
        <div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.time)}</small><em>${escapeHtml(step.detail)}</em></div>
      </div>
    `).join("");
  }

  function tradeLifecycleSteps(trade) {
    const paymentDone = Boolean(trade.paymentSentAt) || ["payment_sent", "released", "disputed"].includes(trade.status);
    const released = trade.status === "released" || Boolean(trade.releasedAt);
    const disputed = trade.status === "disputed" || Boolean(trade.disputedAt);
    const closed = ["cancelled", "expired"].includes(trade.status) || Boolean(trade.resolvedAt);
    const finalLabel = disputed ? "Admin review" : closed ? "Trade closed" : "Release USDT";
    const finalAt = disputed ? trade.disputedAt : trade.releasedAt || trade.cancelledAt || trade.resolvedAt || (trade.status === "expired" ? trade.expiresAt : "");
    const finalState = released ? "complete" : disputed ? "warning" : closed ? "closed" : paymentDone ? "current" : "pending";
    const finalDetail = disputed
      ? "Dispute evidence is available for BRX review."
      : closed
        ? closeReason(trade)
        : "Seller confirms ETB received and releases escrow.";

    return [
      { label: "Order opened", detail: "Trade room created", time: tradeTimeLabel(trade.createdAt), state: "complete" },
      { label: "USDT locked", detail: "Seller funds secured in BRX escrow", time: tradeTimeLabel(trade.createdAt), state: "complete" },
      { label: "Payment sent", detail: "Buyer marks ETB payment complete", time: tradeTimeLabel(trade.paymentSentAt), state: paymentDone ? "complete" : "current" },
      { label: finalLabel, detail: finalDetail, time: tradeTimeLabel(finalAt), state: finalState },
    ];
  }

  function tradeAuditEvents(trade) {
    const events = [
      { label: "Order opened", actor: "BRX", time: trade.createdAt, detail: `${format(Number(trade.assetAmount))} USDT order opened at ${format(Number(trade.offerPrice || Number(trade.fiatAmount) / Number(trade.assetAmount)))} ETB/USDT.` },
      { label: "Escrow locked", actor: "Ledger", time: trade.createdAt, detail: "Seller USDT was reserved for this trade." },
    ];
    if (trade.paymentSentAt) {
      events.push({ label: "Payment marked sent", actor: "Buyer", time: trade.paymentSentAt, detail: trade.paymentReference ? `Reference: ${trade.paymentReference}` : "Buyer confirmed the ETB payment was sent." });
    }
    if (trade.paymentProofName) {
      events.push({ label: "Receipt attached", actor: "Buyer", time: trade.paymentSentAt || trade.createdAt, detail: trade.paymentProofName });
    }
    if (trade.disputedAt) {
      events.push({ label: "Dispute opened", actor: "Trader", time: trade.disputedAt, detail: trade.disputeReason || "Trade moved to admin review." });
    }
    if (trade.releasedAt) {
      events.push({ label: "USDT released", actor: "Seller", time: trade.releasedAt, detail: "Escrow released to the buyer." });
    }
    if (["cancelled", "expired"].includes(trade.status)) {
      events.push({ label: trade.status === "expired" ? "Trade expired" : "Trade cancelled", actor: "System", time: trade.cancelledAt || trade.resolvedAt || trade.expiresAt, detail: closeReason(trade) });
    }
    if (trade.resolvedAt && !["cancelled", "expired"].includes(trade.status)) {
      events.push({ label: "Review resolved", actor: "Admin", time: trade.resolvedAt, detail: "Admin review was resolved." });
    }
    return events.filter((event) => event.time || event.label);
  }

  function tradeAuditItem(event) {
    return `
      <div class="trade-audit-item">
        <span>${escapeHtml(event.actor || "BRX")}</span>
        <div>
          <strong>${escapeHtml(event.label)}</strong>
          <small>${escapeHtml(tradeTimeLabel(event.time))}</small>
          <p>${escapeHtml(event.detail || "Recorded on the BRX trade ledger.")}</p>
        </div>
      </div>
    `;
  }

  function tradeTimeLabel(value) {
    if (!value) return "Pending";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Pending";
    return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function closeReason(trade) {
    if (trade.cancelledReason) return trade.cancelledReason;
    if (trade.status === "expired") return "Payment window expired.";
    if (trade.status === "cancelled") return "Trade was cancelled and escrow returned.";
    return "Trade closed.";
  }

  function tradeActions(trade) {
    const disputeButton = canDispute(trade) && disputeUnlocked(trade)
      ? `<button class="danger-button small" type="button" data-trade-id="${escapeAttr(trade.id)}" data-trade-action="dispute">Open dispute</button>`
      : "";

    if (trade.status === "opened" && trade.role === "buyer") {
      return `<button class="app-button small" type="button" data-trade-id="${trade.id}" data-trade-action="payment-sent">Payment Sent</button><button class="app-ghost-button small" type="button" data-trade-id="${trade.id}" data-trade-action="cancel">Cancel</button>`;
    }
    if (trade.status === "payment_sent" && trade.role === "seller") {
      return `<button class="app-button small" type="button" data-trade-id="${trade.id}" data-trade-action="release">Release USDT</button>${disputeButton}`;
    }
    if (trade.status === "payment_sent" && trade.role === "buyer") {
      return `<span class="app-muted">Waiting for seller</span>${disputeButton}`;
    }
    if (trade.status === "opened") {
      return `<button class="app-ghost-button small" type="button" data-trade-id="${trade.id}" data-trade-action="cancel">Cancel</button>${disputeButton}`;
    }
    if (trade.status === "disputed") {
      return `<span class="status-pill warning">Admin review</span>`;
    }
    return `<span class="app-muted">No action</span>`;
  }

  function canDispute(trade) {
    return trade.status === "payment_sent" && ["buyer", "seller"].includes(trade.role);
  }

  function disputeUnlockAt(trade) {
    const paymentSentAt = trade.paymentSentAt || trade.updatedAt || trade.createdAt;
    const paymentSentMs = new Date(paymentSentAt).getTime();
    const baseMs = Number.isFinite(paymentSentMs) ? paymentSentMs : Date.now();
    return new Date(baseMs + 15 * 60 * 1000).toISOString();
  }

  function disputeUnlocked(trade) {
    return Date.now() >= new Date(disputeUnlockAt(trade)).getTime();
  }

  function disputeAccessPanel(trade) {
    if (trade.status === "disputed") return disputePanel(trade);
    if (!canDispute(trade)) return "";

    const wantsDispute = window.BRX.router.routeParams().get("dispute") === "1";
    if (disputeUnlocked(trade) && wantsDispute) return disputePanel(trade);

    if (disputeUnlocked(trade)) {
      return `
        <section class="appeal-card unlocked">
          <div class="appeal-copy">
            <span class="appeal-icon">!</span>
            <div>
              <strong>Need admin help?</strong>
              <small>Open a dispute only if payment or release cannot be resolved with the other trader.</small>
            </div>
          </div>
          <button class="danger-button small" type="button" data-trade-id="${escapeAttr(trade.id)}" data-trade-action="dispute">Open dispute</button>
        </section>
      `;
    }

    return `
      <section class="appeal-card locked">
        <div class="appeal-copy">
          <span class="appeal-icon">ID</span>
          <div>
            <strong>Appeal available in <span id="appealCountdown">${timeLeft(disputeUnlockAt(trade))}</span></strong>
            <small>Appeals become available only after payment proof has been submitted.</small>
          </div>
        </div>
      </section>
    `;
  }

  function bindAppealCountdown(trade) {
    const target = document.querySelector("#appealCountdown");
    if (!target || !canDispute(trade) || disputeUnlocked(trade)) return;
    const unlockAt = disputeUnlockAt(trade);
    const timer = window.setInterval(async () => {
      target.textContent = timeLeft(unlockAt);
      if (disputeUnlocked(trade)) {
        window.clearInterval(timer);
        await loadTradeDetail(trade.id);
      }
    }, 1000);
  }

  async function handleTradeAction(tradeId, action) {
    try {
      if (action === "payment-sent") await marketplace.markPaymentSent(tradeId);
      if (action === "release") await marketplace.releaseTrade(tradeId);
      if (action === "cancel") {
        if (!confirm("Cancel this trade and return locked USDT to the seller?")) return;
        await marketplace.cancelTrade(tradeId);
      }
      if (action === "dispute") {
        location.hash = `#/trades?id=${encodeURIComponent(tradeId)}&dispute=1`;
        return;
      }
      await window.BRX.profileService.hydrateSession();
      showToast("Trade updated.");
      if (window.BRX.router.routeParams().get("id")) await loadTradeDetail(tradeId);
      else await loadMyTrades();
    } catch (error) {
      showToast(error.message || "Could not update trade.");
    }
  }

  function bindTradeDetail(trade) {
    document.querySelectorAll("[data-trade-action]").forEach((button) => {
      button.addEventListener("click", () => handleTradeAction(button.dataset.tradeId, button.dataset.tradeAction));
    });
    bindAppealCountdown(trade);
    document.querySelector("#evidenceForm")?.addEventListener("submit", (event) => handleEvidenceSubmit(event, trade));
  }

  function tradeDetail(trade) {
    const sellerMethods = trade.sellerPaymentMethods || [];
    const isBuyer = trade.role === "buyer";
    const price = Number(trade.offerPrice || Number(trade.fiatAmount) / Number(trade.assetAmount));
    const counterparty = counterpartyName(trade);
    return `
      <section class="p2p-settlement-page">
        <header class="binance-payment-head">
          <div class="binance-payment-nav">
            <button class="trade-back-button" type="button" data-back-to-trades aria-label="Back to orders">&larr;</button>
            ${trade.status === "opened" ? `<button class="binance-cancel-order" type="button" data-trade-id="${escapeAttr(trade.id)}" data-trade-action="cancel">Cancel the Order</button>` : `<span class="status-pill trade-status ${trade.status === "disputed" ? "warning" : trade.status === "released" ? "success" : ""}">${statusLabel(trade.status)}</span>`}
          </div>
          <h1>${settlementTitle(trade, isBuyer)}</h1>
          ${["opened", "payment_sent"].includes(trade.status) ? `<p class="settlement-deadline"><span>${trade.status === "opened" ? `Pay with ${escapeHtml(trade.paymentMethod || "seller method")}` : "Seller confirmation in progress"}</span><strong id="tradeCountdown">${timeLeft(trade.expiresAt)}</strong></p>` : ""}
        </header>

        <section class="binance-counterparty">
          <span class="avatar small">${displayInitial(counterparty)}</span>
          <div><strong>${escapeHtml(counterparty)}</strong><small>Verified BRX trader</small></div>
          <a href="#/p2p-chat?id=${encodeURIComponent(trade.id)}">Chat</a>
        </section>

        <section class="settlement-layout">
          <main class="settlement-main">
            ${isBuyer ? buyerPaymentBlock(trade, sellerMethods) : sellerPaymentBlock(trade)}
            <div class="settlement-actions">${tradeActions(trade)}</div>
            ${tradeSafetyNote(trade)}
          </main>

          <aside class="settlement-chat" id="tradeChatPanel">
            ${isBuyer ? "" : buyerPaymentSummary(trade)}
            ${tradeChatPanel(trade)}
          </aside>
        </section>
        ${isBuyer && trade.status === "opened" ? `<button class="mobile-proof-cta" type="button" data-show-payment-proof>Upload Payment Proof</button>` : ""}
        ${!isBuyer && trade.status === "payment_sent" ? `<div class="seller-mobile-action">${tradeActions(trade)}</div>` : ""}
        ${disputeAccessPanel(trade)}
      </section>
    `;
  }
  function settlementTitle(trade, isBuyer) {
    if (trade.status === "payment_sent") return isBuyer ? "Payment submitted" : `Confirm ${format(Number(trade.fiatAmount))} ETB`;
    if (trade.status === "released") return "Order completed";
    if (trade.status === "disputed") return "Order under review";
    if (["cancelled", "expired"].includes(trade.status)) return "Order closed";
    return isBuyer ? `Pay ${format(Number(trade.fiatAmount))} ETB` : "Waiting for buyer payment";
  }
  function escrowStepper(trade) {
    const stage = tradeStage(trade);
    const steps = [
      ["Order placed", 1],
      ["Funds locked", 2],
      ["Payment sent", 3],
      ["Completed", 4],
    ];
    return `
      <section class="escrow-stepper" aria-label="Trade progress">
        ${steps.map(([label, number]) => `
          <div class="escrow-step ${stage > number ? "done" : ""} ${stage === number ? "active" : ""}">
            <span>${stage > number ? icon("check") : number}</span>
            <strong>${label}</strong>
          </div>
        `).join("")}
      </section>
    `;
  }
  function tradeStage(trade) {
    if (trade.status === "released") return 4;
    if (trade.status === "payment_sent" || trade.status === "disputed") return 3;
    if (trade.status === "opened") return 2;
    return 1;
  }

  function countdownBlock(trade) {
    if (!["opened", "payment_sent"].includes(trade.status)) return "";
    return `
      <section class="trade-countdown-card">
        <span>${trade.status === "payment_sent" ? "Seller review window" : "Payment window"}</span>
        <strong id="tradeCountdown">${timeLeft(trade.expiresAt)}</strong>
        <small>${trade.status === "payment_sent" ? "Seller should confirm payment or dispute before this timer ends." : "Buyer must pay and submit proof before this timer ends."}</small>
      </section>
    `;
  }

  function buyerPaymentBlock(trade, sellerMethods) {
    if (["cancelled", "expired", "released"].includes(trade.status)) {
      return `<p class="deposit-note">This trade is ${statusLabel(trade.status)}. No payment action is required.</p>`;
    }

    const price = Number(trade.offerPrice || Number(trade.fiatAmount) / Number(trade.assetAmount));

    return `
      <section class="settlement-transfer">
        <div class="binance-step-one"><span><b>1</b></span><div><small>PAYMENT</small><h2>Send with ${escapeHtml(trade.paymentMethod || "seller payment method")}</h2></div></div>
        <div class="binance-pay-amount"><small>Exact amount</small><strong>${format(Number(trade.fiatAmount))} ETB</strong><button class="copy-transfer" type="button" data-copy-value="${escapeAttr(String(trade.fiatAmount))}" aria-label="Copy payment amount" title="Copy amount">${icon("copy")}</button></div>
        <div class="payment-method-list compact">
          ${sellerMethods.length ? sellerMethods.map(paymentMethodCard).join("") : `<div class="payment-method-card"><strong>Payment method pending</strong><small>Ask the seller to add a payment method before paying.</small></div>`}
        </div>
        <details class="binance-order-details">
          <summary>Order details</summary>
          <dl><div><dt>Price</dt><dd>${format(price)} ETB/USDT</dd></div><div><dt>You receive</dt><dd>${format(Number(trade.buyerReceiveAmount || trade.assetAmount), 4)} USDT</dd></div><div><dt>Fee</dt><dd>${format(Number(trade.feeAmount || 0), 4)} USDT</dd></div></dl>
        </details>
        ${trade.status === "opened" ? `
          <div class="binance-step-two"><span><b>2</b></span><div><small>RECEIPT</small><strong>Upload proof and notify the seller</strong></div></div>
          <div class="payment-proof-sheet-backdrop" data-close-payment-proof>
            <form class="payment-proof-sheet" id="paymentSentForm">
              <div class="payment-sheet-handle"></div>
              <header><h2>Payment Confirmation</h2><button type="button" data-close-payment-proof aria-label="Close">&times;</button></header>
              <div><strong>Upload Payment Proof</strong><p>Save an image of the payment receipt and upload at least one proof for the seller.</p></div>
              <label class="receipt-drop"><input id="paymentProofFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" /><span>${icon("external")}</span><strong>Upload receipt</strong><small>JPG, PNG, WEBP, or PDF &middot; max 8 MB</small></label>
              <label class="payment-owner-check"><input id="paymentOwnerConfirm" type="checkbox" /><span>I made the transfer from my own verified payment account.</span></label>
              <div class="form-error" id="paymentSentError"></div>
              <button class="app-button" type="submit">Transferred, Notify Seller</button>
            </form>
          </div>
        ` : `<div class="binance-step-two complete"><span>${icon("check")}</span><div><small>RECEIPT SENT</small><strong>Waiting for seller confirmation</strong></div></div><div class="payment-submitted-note">Your receipt is in trade chat and the seller has been notified.</div>`}
      </section>
    `;
  }

  function sellerPaymentBlock(trade) {
    if (trade.status === "opened") {
      return `
        <section class="payment-instructions seller-waiting-card">
          <div><p class="app-label">Waiting for buyer</p><h4>${format(Number(trade.assetAmount))} USDT secured</h4></div>
          <p class="app-muted">Your USDT is locked in escrow. The buyer must pay and submit proof before the payment window closes.</p>
        </section>
      `;
    }
    if (trade.status === "payment_sent") {
      return `
        <section class="payment-instructions seller-review-card">
          <div><p class="app-label">Payment marked as sent</p><h4>Verify ${format(Number(trade.fiatAmount))} ETB</h4></div>
          <p class="app-muted">Open the buyer receipt on the right and check your actual receiving account. Release USDT only after the full ETB amount is visible in your account.</p>
        </section>
      `;
    }
    if (trade.status === "disputed") return `<p class="deposit-note warning">This trade is under admin review. Add evidence below if needed.</p>`;
    return `<p class="deposit-note">This trade is ${statusLabel(trade.status)}.</p>`;
  }
  function paymentMethodCard(method) {
    const rows = [
      ["Name", method.accountName],
      ["Phone", method.phoneNumber],
      ["Bank", method.bankName],
      ["Account", method.accountNumber],
      ["Note", method.instructions],
    ].filter(([, value]) => Boolean(value));
    return `
      <div class="payment-method-card highlighted">
        <div class="method-head"><strong>${escapeHtml(method.label || paymentTypeLabel(method.type))}</strong><span>${escapeHtml(paymentTypeLabel(method.type))}</span></div>
        ${rows.map(([label, value]) => paymentDetailRow(label, value)).join("")}
      </div>
    `;
  }

  function paymentDetailRow(label, value) {
    return `
      <div class="payment-detail-row">
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}</strong>
        <button class="copy-chip" type="button" data-copy-value="${escapeAttr(value)}" aria-label="Copy ${escapeAttr(label)}" title="Copy ${escapeAttr(label)}">${icon("copy")}</button>
      </div>
    `;
  }

  function tradeChatPanel(trade) {
    const canSend = ["opened", "payment_sent", "disputed"].includes(trade.status);
    return `
      <section class="trade-chat-panel">
        <div class="trade-chat-head">
          <div><strong>Trade chat</strong><small>Buyer and seller only</small></div>
          <span class="trade-chat-live"><i></i> Online</span>
        </div>
        <div class="trade-chat-messages" id="tradeChatMessages" aria-live="polite">
          <div class="trade-chat-empty"><span>${icon("mail")}</span><strong>No messages yet</strong><small>Use this chat to coordinate payment safely.</small></div>
        </div>
        ${canSend ? `
          <form class="trade-chat-form" id="tradeChatForm">
            <label class="trade-chat-attach" for="tradeChatFile" aria-label="Attach image">+<input id="tradeChatFile" type="file" accept="image/png,image/jpeg,image/webp" /></label>
            <textarea id="tradeChatInput" rows="2" maxlength="1000" placeholder="Message the ${trade.role === "buyer" ? "seller" : "buyer"}..."></textarea>
            <button class="app-button" id="tradeChatSend" type="submit" aria-label="Send message">${icon("send")}<span>Send</span></button>
            <small class="trade-chat-file-name" id="tradeChatFileName"></small>
            <div class="trade-chat-error" id="tradeChatError"></div>
          </form>
        ` : `<p class="trade-chat-closed">This trade is closed. Chat history remains available.</p>`}
      </section>
    `;
  }

  function startTradeChat(trade) {
    if (tradeChatTimer) clearInterval(tradeChatTimer);
    tradeChatTimer = null;
    tradeChatSignature = "";
    void loadTradeMessages(trade, true);
    tradeChatTimer = setInterval(() => {
      const activeTradeId = window.BRX.router.routeParams().get("id");
      if (window.BRX.router.routeName() !== "trades" || activeTradeId !== trade.id) {
        clearInterval(tradeChatTimer);
        tradeChatTimer = null;
        return;
      }
      void loadTradeMessages(trade, false);
    }, 3000);
  }

  async function loadTradeMessages(trade, forceScroll) {
    if (tradeChatLoading) return;
    const container = document.querySelector("#tradeChatMessages");
    if (!container) return;
    tradeChatLoading = true;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 56;
    try {
      const result = await marketplace.tradeMessages(trade.id);
      const messages = result.messages || [];
      const signature = messages.map((message) => `${message.id}:${message.isRead ? 1 : 0}:${message.hasAttachment ? 1 : 0}`).join("|");
      if (signature !== tradeChatSignature) {
        tradeChatSignature = signature;
        container.innerHTML = messages.length
          ? messages.map(tradeChatMessage).join("")
          : `<div class="trade-chat-empty"><span>${icon("mail")}</span><strong>No messages yet</strong><small>Use this chat to coordinate payment safely.</small></div>`;
        void loadChatAttachments(trade.id);
        if (forceScroll || nearBottom) container.scrollTop = container.scrollHeight;
      }
    } catch (error) {
      if (forceScroll) {
        container.innerHTML = `<div class="trade-chat-empty"><strong>Chat unavailable</strong><small>${escapeHtml(error.message || "Could not load messages.")}</small></div>`;
      }
    } finally {
      tradeChatLoading = false;
    }
  }

  function tradeChatMessage(message) {
    const body = escapeHtml(message.body || "").replace(/\n/g, "<br>");
    return `
      <div class="trade-chat-message ${message.isMine ? "mine" : "theirs"}">
        <div class="trade-chat-bubble">${message.hasAttachment ? `<button class="chat-image-placeholder" type="button" data-chat-attachment="${escapeAttr(message.id)}"><span>Loading image...</span></button>` : ""}${body ? `<p>${body}</p>` : ""}</div>
        <small>${chatTime(message.createdAt)}${message.isMine && message.isRead ? " - Read" : ""}</small>
      </div>
    `;
  }

  async function loadChatAttachments(tradeId) {
    document.querySelectorAll("[data-chat-attachment]").forEach(async (target) => {
      if (target.dataset.loaded) return;
      target.dataset.loaded = "1";
      try {
        const result = await marketplace.messageAttachment(tradeId, target.dataset.chatAttachment);
        const attachment = result.attachment;
        target.innerHTML = String(attachment.mimeType || "").startsWith("image/")
          ? `<img src="${attachment.dataUrl}" alt="Chat attachment" />`
          : `<span>${icon("external")} Open payment receipt</span>`;
        target.addEventListener("click", () => openPaymentProofViewer(attachment));
      } catch (error) {
        target.innerHTML = `<span>${escapeHtml(error.message || "Image unavailable")}</span>`;
      }
    });
  }

  async function handleTradeChatSubmit(event, trade) {
    event.preventDefault();
    const input = document.querySelector("#tradeChatInput");
    const button = document.querySelector("#tradeChatSend");
    const errorNode = document.querySelector("#tradeChatError");
    const body = input?.value.trim() || "";
    const selectedFile = document.querySelector("#tradeChatFile")?.files?.[0];
    if (!body && !selectedFile) return;

    if (errorNode) errorNode.textContent = "";
    if (button) button.disabled = true;
    try {
      const file = await filePayload("tradeChatFile", 8 * 1024 * 1024);
      await marketplace.sendTradeMessage(trade.id, { body, file });
      input.value = "";
      const fileInput = document.querySelector("#tradeChatFile");
      if (fileInput) fileInput.value = "";
      const fileName = document.querySelector("#tradeChatFileName");
      if (fileName) fileName.textContent = "";
      await loadTradeMessages(trade, true);
      input.focus();
    } catch (error) {
      if (errorNode) errorNode.textContent = error.message || "Could not send message.";
    } finally {
      if (button) button.disabled = false;
    }
  }

  function chatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function sellerPaymentSummary(trade, sellerMethods) {
    return `
      <section class="side-section">
        <p class="app-label">Seller receiving account</p>
        ${sellerMethods.length ? sellerMethods.slice(0, 1).map(paymentMethodCard).join("") : `<div class="payment-method-card"><strong>No payment method</strong><small>Ask seller to add a receiving account before paying.</small></div>`}
      </section>
    `;
  }

  function buyerPaymentSummary(trade) {
    return `
      <section class="side-section">
        <p class="app-label">Buyer payment proof</p>
        ${paymentProofBlock(trade)}
      </section>
    `;
  }

  function paymentProofBlock(trade) {
    if (!trade.paymentReference && !trade.paymentProofName) {
      return `<div class="proof-card empty"><strong>No payment proof yet</strong><small>The buyer receipt appears here after payment is marked sent.</small></div>`;
    }
    return `
      <div class="proof-card ${trade.paymentProofName ? "has-file" : ""}">
        ${trade.paymentReference ? `<div class="proof-reference"><small>Payment reference</small><strong>${escapeHtml(trade.paymentReference)}</strong></div>` : ""}
        ${trade.paymentProofName ? `
          <div class="proof-file-head"><div><small>Buyer receipt</small><strong>${escapeHtml(trade.paymentProofName)}</strong></div><span>Secure</span></div>
          <div class="payment-proof-preview" data-payment-proof-preview="${escapeAttr(trade.id)}"><span>Loading receipt preview...</span></div>
        ` : ""}
      </div>
    `;
  }

  async function loadPaymentProof(trade) {
    const previews = [...document.querySelectorAll(`[data-payment-proof-preview="${CSS.escape(trade.id)}"]`)];
    if (!previews.length || !trade.paymentProofName) return;
    try {
      const result = await marketplace.paymentProof(trade.id);
      const proof = result.proof;
      const isImage = String(proof.mimeType || "").startsWith("image/");
      previews.forEach((preview) => {
        preview.innerHTML = isImage
          ? `<button class="proof-preview-button" type="button" data-open-payment-proof><img src="${proof.dataUrl}" alt="Buyer payment receipt" /><span>View full receipt</span></button>`
          : `<button class="proof-document-button" type="button" data-open-payment-proof>${icon("external")}<span>Open PDF receipt</span></button>`;
        preview.querySelector("[data-open-payment-proof]")?.addEventListener("click", () => openPaymentProofViewer(proof));
      });
    } catch (error) {
      previews.forEach((preview) => {
        preview.innerHTML = `<div class="proof-preview-error">${escapeHtml(error.message || "Could not load receipt.")}</div>`;
      });
    }
  }

  function openPaymentProofViewer(proof) {
    const modal = document.createElement("div");
    const isImage = String(proof.mimeType || "").startsWith("image/");
    modal.className = "proof-viewer-backdrop";
    modal.innerHTML = `
      <section class="proof-viewer" role="dialog" aria-modal="true" aria-label="Payment receipt">
        <header><div><span>Buyer payment receipt</span><strong>${escapeHtml(proof.fileName || "Receipt")}</strong></div><button type="button" data-close-proof aria-label="Close receipt">&times;</button></header>
        <div class="proof-viewer-content">${isImage ? `<img src="${proof.dataUrl}" alt="Buyer payment receipt" />` : `<iframe src="${proof.dataUrl}" title="Buyer payment receipt"></iframe>`}</div>
      </section>
    `;
    const close = () => modal.remove();
    modal.querySelector("[data-close-proof]").addEventListener("click", close);
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    document.body.appendChild(modal);
  }
  function tradeSafetyNote(trade) {
    if (trade.status === "released") {
      return `<div class="deposit-note success">Trade completed. USDT has been released to the buyer.</div>`;
    }
    if (trade.status === "disputed") {
      return `<div class="deposit-note warning">This trade is under admin review. Do not continue payment outside the agreed details.</div>`;
    }
    return `<div class="deposit-note">Only use the payment details shown on this trade. If anything looks wrong, open a dispute before confirming.</div>`;
  }

  function tradeActions(trade) {
    const disputeButton = canDispute(trade) && disputeUnlocked(trade)
      ? `<button class="danger-button trade-secondary-action" type="button" data-trade-id="${escapeAttr(trade.id)}" data-trade-action="dispute">Open dispute</button>`
      : "";

    if (trade.status === "opened" && trade.role === "buyer") {
      return "";
    }
    if (trade.status === "payment_sent" && trade.role === "seller") {
      return `<button class="app-button trade-primary-action release" type="button" data-trade-id="${trade.id}" data-trade-action="release">Payment received &mdash; Release ${format(Number(trade.assetAmount))} USDT</button>${disputeButton}`;
    }
    if (trade.status === "payment_sent" && trade.role === "buyer") {
      return `<span class="trade-waiting-status">Payment submitted. Waiting for seller confirmation.</span>${disputeButton}`;
    }
    if (trade.status === "opened") {
      return disputeButton;
    }
    if (trade.status === "disputed") return `<span class="status-pill warning">Admin review in progress</span>`;
    if (trade.status === "released") return `<span class="trade-complete-status">${icon("check")} Trade completed successfully</span>`;
    return `<span class="app-muted">This trade is closed.</span>`;
  }
  async function handleTradeAction(tradeId, action) {
    try {
      if (action === "payment-sent") {
        const { trade } = await marketplace.getTrade(tradeId);
        openPaymentSentModal(trade);
        return;
      }
      if (action === "release") {
        const { trade } = await marketplace.getTrade(tradeId);
        openReleaseModal(trade);
        return;
      }
      if (action === "cancel") {
        if (!confirm("Cancel this trade and return locked USDT to the seller?")) return;
        await marketplace.cancelTrade(tradeId);
      }
      if (action === "dispute") {
        location.hash = `#/trades?id=${encodeURIComponent(tradeId)}&dispute=1`;
        return;
      }
      await window.BRX.profileService.hydrateSession();
      showToast("Trade updated.");
      if (window.BRX.router.routeParams().get("id")) await loadTradeDetail(tradeId);
      else await loadMyTrades();
    } catch (error) {
      showToast(error.message || "Could not update trade.");
    }
  }

  function bindTradeDetail(trade) {
    document.querySelector("[data-back-to-trades]")?.addEventListener("click", () => {
      location.hash = "#/trades";
    });
    document.querySelectorAll("[data-trade-action]").forEach((button) => {
      button.addEventListener("click", () => handleTradeAction(button.dataset.tradeId, button.dataset.tradeAction));
    });
    document.querySelectorAll("[data-copy-value]").forEach((button) => {
      button.addEventListener("click", async () => {
        await navigator.clipboard?.writeText(button.dataset.copyValue || "");
        showToast("Copied.");
      });
    });
    bindAppealCountdown(trade);
    if (trade.paymentProofName) void loadPaymentProof(trade);
    document.querySelector("#evidenceForm")?.addEventListener("submit", (event) => handleEvidenceSubmit(event, trade));
    const disputeBackdrop = document.querySelector("[data-dispute-backdrop]");
    const closeDispute = () => {
      document.body.classList.remove("dispute-flow-open");
      location.hash = `#/trades?id=${encodeURIComponent(trade.id)}`;
    };
    if (disputeBackdrop) document.body.classList.add("dispute-flow-open");
    document.querySelectorAll("[data-close-dispute]").forEach((button) => button.addEventListener("click", closeDispute));
    disputeBackdrop?.addEventListener("click", (event) => {
      if (event.target === disputeBackdrop) closeDispute();
    });
    document.querySelector("#evidenceFile")?.addEventListener("change", (event) => {
      const selected = event.currentTarget.files?.[0];
      const label = document.querySelector("#evidenceFileLabel");
      if (label) label.textContent = selected?.name || "Add evidence";
      event.currentTarget.closest(".dispute-upload")?.classList.toggle("selected", Boolean(selected));
    });
    const chatForm = document.querySelector("#tradeChatForm");
    const chatInput = document.querySelector("#tradeChatInput");
    chatForm?.addEventListener("submit", (event) => handleTradeChatSubmit(event, trade));
    document.querySelector("#tradeChatFile")?.addEventListener("change", (event) => {
      const name = event.currentTarget.files?.[0]?.name || "";
      const target = document.querySelector("#tradeChatFileName");
      if (target) target.textContent = name ? `Attached: ${name}` : "";
    });
    document.querySelector("#paymentSentForm")?.addEventListener("submit", (event) => handlePaymentSentSubmit(event, trade));
    const proofSheet = document.querySelector(".payment-proof-sheet-backdrop");
    document.querySelectorAll("[data-show-payment-proof]").forEach((button) => button.addEventListener("click", () => {
      proofSheet?.classList.add("open");
      document.body.classList.add("payment-proof-open");
    }));
    document.querySelectorAll("[data-close-payment-proof]").forEach((element) => element.addEventListener("click", (event) => {
      if (event.currentTarget !== event.target && !event.currentTarget.matches("button")) return;
      proofSheet?.classList.remove("open");
      document.body.classList.remove("payment-proof-open");
    }));
    document.querySelector("#paymentProofFile")?.addEventListener("change", (event) => {
      const selected = event.currentTarget.files?.[0];
      const label = event.currentTarget.closest(".receipt-drop");
      const title = label?.querySelector("strong");
      if (title) title.textContent = selected?.name || "Choose payment receipt";
    });
    chatInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chatForm?.requestSubmit();
      }
    });
  }

  function openPaymentSentModal(trade) {
    const modal = document.createElement("div");
    modal.className = "trade-modal-backdrop";
    modal.innerHTML = `
      <form class="trade-confirm-modal" id="paymentSentForm">
        <button class="modal-x" type="button" data-close-modal aria-label="Close">x</button>
        <p class="app-label blue">Confirm payment sent</p>
        <h3>${format(Number(trade.fiatAmount))} ETB</h3>
        <p class="app-muted">Upload the payment receipt. False confirmations can lead to account suspension.</p>
        <label class="receipt-drop"><input id="paymentProofFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" /><strong>Upload receipt</strong><small>PNG, JPG, WEBP, or PDF up to 8 MB</small></label>
        <label class="payment-owner-check"><input id="paymentOwnerConfirm" type="checkbox" /><span>I paid from my own verified payment account.</span></label>
        <div class="form-error" id="paymentSentError"></div>
        <button class="app-button" type="submit">Yes, I paid the seller</button>
      </form>
    `;
    document.body.appendChild(modal);
    modal.querySelector("[data-close-modal]").addEventListener("click", closeTradeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeTradeModal();
    });
    modal.querySelector("#paymentSentForm").addEventListener("submit", (event) => handlePaymentSentSubmit(event, trade));
  }

  async function handlePaymentSentSubmit(event, trade) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorNode = form.querySelector("#paymentSentError");
    const submit = form.querySelector('button[type="submit"]');
    const reference = form.querySelector("#paymentReference")?.value.trim() || "";
    const selectedFile = form.querySelector("#paymentProofFile")?.files?.[0];
    errorNode.textContent = "";
    if (!selectedFile) {
      errorNode.textContent = "Upload a payment receipt before notifying the seller.";
      return;
    }
    if (!form.querySelector("#paymentOwnerConfirm")?.checked) {
      errorNode.textContent = "Confirm that you paid from your own verified account.";
      return;
    }
    const originalText = submit?.textContent;
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Submitting payment proof...";
    }
    try {
      const file = await filePayload("paymentProofFile", 8 * 1024 * 1024);
      await marketplace.markPaymentSent(trade.id, { reference, file });
      showToast("Payment proof submitted. The seller has been notified.");
      document.body.classList.remove("payment-proof-open");
      await loadTradeDetail(trade.id);
    } catch (error) {
      errorNode.textContent = error.message || "Could not submit payment proof.";
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  }
  function openReleaseModal(trade) {
    const modal = document.createElement("div");
    modal.className = "trade-modal-backdrop";
    modal.innerHTML = `
      <form class="trade-confirm-modal" id="releaseTradeForm">
        <button class="modal-x" type="button" data-close-modal aria-label="Close">x</button>
        <p class="app-label blue">Release escrow</p>
        <h3>${format(Number(trade.assetAmount))} USDT</h3>
        <p class="app-muted">Only release after the ETB payment is fully received in your account.</p>
        ${paymentProofBlock(trade)}
        <div class="form-error" id="releaseError"></div>
        <button class="app-button" type="submit">Release USDT to buyer</button>
      </form>
    `;
    document.body.appendChild(modal);
    if (trade.paymentProofName) void loadPaymentProof(trade);
    modal.querySelector("[data-close-modal]").addEventListener("click", closeTradeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeTradeModal();
    });
    modal.querySelector("#releaseTradeForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorNode = document.querySelector("#releaseError");
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      const originalText = submit?.textContent;
      errorNode.textContent = "";
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Releasing USDT...";
      }
      try {
        await marketplace.releaseTrade(trade.id);
        closeTradeModal();
        showToast("USDT released to the buyer.");
        await loadTradeDetail(trade.id);
      } catch (error) {
        errorNode.textContent = error.message || "Could not release trade.";
        if (submit) {
          submit.disabled = false;
          submit.textContent = originalText;
        }
      }
    });
  }

  function closeTradeModal() {
    document.querySelector(".trade-modal-backdrop")?.remove();
  }

  function shortTradeId(value) {
    return String(value || "").slice(0, 8).toUpperCase();
  }

  function counterpartyName(trade) {
    const name = String(trade.counterpartyName || "").trim();
    return name && !name.includes("@") ? name : "BRX trader";
  }

  async function handleEvidenceSubmit(event, trade) {
    event.preventDefault();
    const errorBox = document.querySelector("#evidenceError");
    if (errorBox) errorBox.textContent = "";
    const isOpen = trade.status === "disputed";
    const category = document.querySelector("#evidenceCategory")?.value.trim() || "";
    const note = document.querySelector("#evidenceNote").value.trim();
    const reference = document.querySelector("#evidenceReference").value.trim();
    let file = null;
    try {
      file = await filePayload("evidenceFile", 8 * 1024 * 1024);
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message || "Could not read the evidence file.";
      return;
    }
    const combinedNote = [category ? `Issue: ${category}` : "", note, reference ? `Payment reference: ${reference}` : ""].filter(Boolean).join("\n\n");

    if (!isOpen && !category) {
      if (errorBox) errorBox.textContent = "Select the issue that best matches this dispute.";
      return;
    }
    if (!isOpen && !document.querySelector("#disputeConfirm")?.checked) {
      if (errorBox) errorBox.textContent = "Confirm that the dispute information is accurate.";
      return;
    }
    if (isOpen && !combinedNote && !file) {
      if (errorBox) errorBox.textContent = "Add a note, reference, or evidence file.";
      return;
    }

    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const originalText = submit?.textContent;
    if (submit) {
      submit.disabled = true;
      submit.textContent = isOpen ? "Adding to case..." : "Submitting dispute...";
    }
    try {
      if (isOpen) {
        await marketplace.addTradeEvidence(trade.id, { note: combinedNote, file });
        showToast("Evidence added.");
      } else {
        await marketplace.disputeTrade(trade.id, { reason: combinedNote || "Dispute evidence attached.", evidence: { note: combinedNote, file } });
        showToast("Dispute opened for admin review.");
      }
      await loadTradeDetail(trade.id);
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message || "Could not submit evidence.";
      else showToast(error.message || "Could not submit evidence.");
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  }

  function startTradeCountdown(trade) {
    if (tradeCountdownTimer) {
      clearInterval(tradeCountdownTimer);
      tradeCountdownTimer = null;
    }
    if (!["opened", "payment_sent"].includes(trade.status)) return;
    const deadline = trade.status === "payment_sent" ? disputeUnlockAt(trade) : trade.expiresAt;
    if (!deadline) return;
    const target = document.querySelector("#tradeCountdown");
    if (!target) return;
    const tick = () => {
      target.textContent = timeLeft(deadline);
      if (new Date(deadline).getTime() <= Date.now()) {
        clearInterval(tradeCountdownTimer);
        tradeCountdownTimer = null;
      }
    };
    tick();
    tradeCountdownTimer = setInterval(tick, 1000);
  }

  function timeLeft(value) {
    const ms = new Date(value).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return "Expired";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function statusLabel(status) {
    return String(status).replace(/_/g, " ");
  }
  function renderWallet() {
    const user = requireUser();
    if (!user) return;
    const modeFromUrl = window.BRX.router.routeParams().get("mode");
    if (["deposit", "withdraw", "transfer"].includes(modeFromUrl)) activeWalletMode = modeFromUrl;

    if (!user.accountSettingsLoaded && accountService) {
      void accountService.loadSettings().then(() => renderWallet()).catch((error) => console.error(error));
    }
    if (activeWalletMode === "withdraw" && securityService && !user.securityLoaded) {
      void securityService.loadSecurity().then(() => renderWallet()).catch((error) => console.error(error));
    }

    if (accountService && !walletActivityState.loaded && !walletActivityState.loading) {
      void loadWalletActivity();
    }

    const depositAddress = user.depositAddress || "";
    const balance = user.balance || window.BRX.profileService.emptyBalance();
    const available = Number(balance.available) || 0;
    const locked = Number(balance.locked) || 0;
    const pendingDeposit = Number(balance.pendingDeposit) || 0;
    const pendingWithdrawal = Number(balance.pendingWithdrawal) || 0;
    const total = available + locked + pendingDeposit + pendingWithdrawal;
    const activityCount = walletActivityItems().length;

    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow professional-wallet-page wallet-v3">

        <section class="professional-wallet-summary wallet-original-summary">
          <div class="wallet-total-block">
            <span class="wallet-summary-icon">${icon("wallet")}</span>
            <div><p>Total balance</p><h2>$${format(total)}</h2><small>Available and escrow-held BRX funds</small></div>
          </div>
          <div class="professional-balance-grid">
            <div class="available"><span>Available</span><strong>$${format(available)}</strong></div>
            <div class="locked"><span>In escrow</span><strong>$${format(locked)}</strong></div>
            ${pendingDeposit > 0 ? `<div class="pending"><span>Pending deposit</span><strong>$${format(pendingDeposit)}</strong></div>` : ""}
            ${pendingWithdrawal > 0 ? `<div class="pending"><span>Pending withdrawal</span><strong>$${format(pendingWithdrawal)}</strong></div>` : ""}
          </div>
        </section>

        <nav class="professional-wallet-tabs" aria-label="Wallet action">
          <button class="${activeWalletMode === "deposit" ? "active" : ""}" type="button" data-wallet-mode="deposit">${icon("download")}<span><strong>Deposit</strong><small>Receive on-chain</small></span></button>
          <button class="${activeWalletMode === "withdraw" ? "active" : ""}" type="button" data-wallet-mode="withdraw">${icon("upload")}<span><strong>Withdraw</strong><small>Send to wallet</small></span></button>
          <button class="${activeWalletMode === "transfer" ? "active" : ""}" type="button" data-wallet-mode="transfer">${icon("send")}<span><strong>Transfer</strong><small>Instant BRX transfer</small></span></button>
        </nav>

        <div class="professional-wallet-workspace">
          <div class="wallet-operation-panel">${walletModePanel(activeWalletMode, depositAddress, user)}</div>
          <aside class="wallet-activity-panel">
            <div class="wallet-activity-head"><div><p class="app-label">Wallet history</p><h3>Recent transactions</h3></div><span class="wallet-activity-count">${activityCount}</span></div>
            ${walletActivityPanel()}
            <a href="#/trades">View P2P trade activity ${icon("external")}</a>
          </aside>
        </div>
      </section>
    `;

    document.querySelectorAll("[data-wallet-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        activeWalletMode = button.dataset.walletMode;
        location.hash = `#/wallet?mode=${activeWalletMode}`;
      });
    });

    document.querySelectorAll("[data-network-select]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedWalletNetwork[activeWalletMode] = button.dataset.networkSelect;
        renderWallet();
      });
    });

    const selectedNetwork = selectedWalletNetwork[activeWalletMode];
    if (activeWalletMode === "deposit" && selectedNetwork === "BEP20" && depositAddress) {
      document.querySelector("#copyDepositAddress")?.addEventListener("click", () => copyDepositAddress(depositAddress));
      return;
    }
    if (activeWalletMode === "withdraw") {
      const amountInput = document.querySelector("#withdrawAmount");
      const updateReceive = () => {
        const fee = Number(currentUser()?.platformSettings?.withdrawalFeeUsdt || 0);
        const receive = Math.max(0, Number(amountInput?.value || 0) - fee);
        const output = document.querySelector("[data-withdraw-receive]");
        if (output) output.textContent = format(receive) + " USDT";
      };
      document.querySelector("#withdrawForm")?.addEventListener("submit", handleWithdrawalSubmit);
      amountInput?.addEventListener("input", updateReceive);
      document.querySelector("[data-withdraw-max]")?.addEventListener("click", () => {
        if (amountInput) amountInput.value = String(Math.max(0, Number(currentUser()?.balance?.available || 0)));
        updateReceive();
      });
      return;
    }
    if (activeWalletMode === "transfer") {
      document.querySelector("#internalTransferForm")?.addEventListener("submit", handleInternalTransferSubmit);
      return;
    }
    if (activeWalletMode === "deposit" && selectedNetwork === "BEP20" && !depositAddress) {
      void syncBackendWallet(user).then(() => renderWallet()).catch((error) => {
        console.error(error);
        showToast("Could not load your deposit address. Check the backend connection.");
      });
    }
  }

  function walletModePanel(mode, depositAddress, user) {
    if (mode === "withdraw") return withdrawPanel(user);
    if (mode === "transfer") return transferPanel();
    return depositPanel(depositAddress);
  }

  function depositPanel(depositAddress) {
    const selectedNetwork = selectedWalletNetwork.deposit;
    const selected = NETWORKS.find((network) => network.id === selectedNetwork);
    const addressLabel = depositAddress || "Address assigned by wallet service";
    const depositAddressMarkup = selectedNetwork === "BEP20" ? `
      <section class="deposit-address-card deposit-address-detail ${depositAddress ? "" : "pending"}">
        <div class="wallet-address-label"><b>2</b><span><strong>Your deposit address</strong><small>Only send USDT using BEP20</small></span></div>
        <div class="deposit-qr-card" aria-label="BEP20 deposit address QR code">
          ${depositAddress ? qrCodeSvg(depositAddress) : `<span class="qr-placeholder">QR</span>`}
        </div>
        <div class="deposit-address-main">
          <span>USDT deposit address</span>
          <strong>${escapeHtml(addressLabel)}</strong>
          <small>Deposits are credited after 15 block confirmations. Sending another asset or network may result in permanent loss.</small>
        </div>
        <button class="wallet-copy-address" id="copyDepositAddress" type="button" ${depositAddress ? "" : "disabled"}>${depositAddress ? "Copy address" : "Generating..."}</button>
      </section>
    ` : "";
    return `
      <section class="wallet-panel deposit-network-sheet">
          <div class="sheet-head">
            <div>
              <p class="app-label blue">On-chain deposit</p>
              <h2>Deposit USDT</h2>
              <small>Choose the network that matches the sending wallet.</small>
            </div>
            <span class="sheet-badge">USDT</span>
          </div>

          <div class="wallet-flow-label"><b>1</b><span>Select network</span></div>
          ${networkSelector("deposit", selectedNetwork, "BEP20", depositAddressMarkup)}
          ${selected && selected.status !== "available" ? `<p class="deposit-note">${escapeHtml(selected.name)} deposits are not enabled yet. Choose BNB Smart Chain for live deposits.</p>` : ""}
          ${selectedNetwork === "BEP20" ? `<div class="wallet-risk-note">${icon("info")}<span>Confirm both the asset and network before sending. Blockchain deposits cannot be reversed.</span></div>` : ""}
      </section>
    `;
  }
  function withdrawPanel(user) {
    const selectedNetwork = selectedWalletNetwork.withdraw;
    const selected = NETWORKS.find((network) => network.id === selectedNetwork);
    const available = Number(user.balance?.available || 0);
    const fee = Number(user.platformSettings?.withdrawalFeeUsdt || 0);
    const twoFactorGate = selectedNetwork === "BEP20" ? withdrawTwoFactorGate(user) : "";
    return `
      <section class="wallet-panel wallet-form-panel">
        <div class="sheet-head">
          <div>
            <p class="app-label blue">On-chain withdrawal</p>
            <h2>Withdraw USDT</h2>
            <small>Send USDT to an external BEP20 wallet.</small>
          </div>
          <span class="sheet-badge">USDT</span>
        </div>
        ${selectedNetwork !== "BEP20" ? networkSelector("withdraw", selectedNetwork) : `
          <div class="withdraw-network-field">
            <span>Network</span>
            <div>
              <span class="network-mark bsc">BNB</span>
              <span class="withdraw-network-copy">
                <small class="withdraw-network-name">BNB Smart Chain (BEP20)</small>
                <small>Fee ${format(fee)} USDT · Arrival ~1-3 min</small>
              </span>
              <b>Active</b>
            </div>
          </div>
        `}
        ${!selected ? `<p class="network-helper">Choose BNB Smart Chain for BEP20 withdrawals. TRON withdrawals will be added later.</p>` : ""}
        ${selected && selected.status !== "available" ? `<p class="deposit-note">${escapeHtml(selected.name)} withdrawals are not enabled yet. Choose BNB Smart Chain for live withdrawals.</p>` : ""}
        ${selectedNetwork === "BEP20" ? twoFactorGate || `
          <form class="wallet-action-form" id="withdrawForm">
            <label class='form-field withdraw-address-field'><span>Destination address</span><input id='withdrawAddress' autocomplete='off' spellcheck='false' placeholder='Paste BEP20 address (0x...)' required /></label>
            <label class="form-field withdraw-amount-field"><span>Amount</span><div><input id="withdrawAmount" inputmode="decimal" placeholder="0.00" required /><b>USDT</b><button type="button" data-withdraw-max>Max</button></div></label>
            <div class="withdraw-available"><span>Available balance</span><strong>${format(available)} USDT</strong></div>
            <div class="withdraw-summary"><span>You receive <strong data-withdraw-receive>0.00 USDT</strong></span><span>Network fee <strong>${format(fee)} USDT</strong></span></div>
            <div class="wallet-risk-note">${icon("info")}<span>Verify the destination and network carefully. On-chain withdrawals cannot be cancelled.</span></div>
            <button class="withdrawal-flow-primary" type="submit">Review withdrawal</button>
          </form>
        ` : ""}
      </section>
    `;
  }

  function withdrawTwoFactorGate(user) {
    if (!user.securityLoaded) {
      return `<section class="deposit-address-card pending"><div><span>Security check</span><strong>Loading 2FA status</strong><small>BRX is checking whether this account can withdraw.</small></div></section>`;
    }
    if (user.security?.twoFactor?.enabled) return "";
    return `<section class="deposit-address-card pending"><div><span>2FA required</span><strong>Set up authenticator first</strong><small>Withdrawals require Google Authenticator or another TOTP app before a code can be entered.</small></div><a class="app-button small" href="#/settings?tab=security">Set up 2FA</a></section>`;
  }

  function withdrawalNote(user) {
    const fee = Number(user.platformSettings?.withdrawalFeeUsdt || 0);
    const feeText = fee > 0 ? ` Withdrawal fee: ${format(fee)} USDT.` : "";
    return `Withdrawals are sent on BNB Smart Chain. Confirm the saved address carefully; approved withdrawals cannot be reversed on-chain.${feeText}`;
  }

  async function loadWalletActivity() {
    if (!accountService || walletActivityState.loading) return;
    walletActivityState = { ...walletActivityState, loading: true, error: "" };
    const [depositResult, withdrawalResult] = await Promise.allSettled([
      accountService.listDeposits(),
      accountService.listWithdrawals(),
    ]);
    const deposits = depositResult.status === "fulfilled" ? (depositResult.value.deposits || []) : walletActivityState.deposits;
    const withdrawals = withdrawalResult.status === "fulfilled" ? (withdrawalResult.value.withdrawals || []) : walletActivityState.withdrawals;
    const errors = [depositResult, withdrawalResult]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || "Wallet history request failed.");
    walletActivityState = {
      loaded: true,
      loading: false,
      deposits,
      withdrawals,
      error: errors.length ? errors.join(" ") : "",
    };
    if (window.BRX.router.routeName() === "wallet") renderWallet();
  }

  function refreshWalletActivity() {
    walletActivityState = { ...walletActivityState, loaded: false, error: "" };
    if (accountService) void loadWalletActivity();
  }

  function walletActivityPanel() {
    const items = walletActivityItems();
    setTimeout(bindWalletActivityRows, 0);
    if (walletActivityState.loading && !walletActivityState.loaded && !items.length) {
      return `<div class="wallet-activity-empty">${icon("activity")}<strong>Loading wallet activity</strong><p>Checking deposits and withdrawals.</p></div>`;
    }
    if (walletActivityState.error && !items.length) {
      return `<div class="wallet-activity-empty">${icon("info")}<strong>Activity unavailable</strong><p>${escapeHtml(walletActivityState.error)}</p></div>`;
    }
    if (!items.length) {
      return `<div class="wallet-activity-empty">${icon("database")}<strong>No wallet activity yet</strong><p>Your deposits, processing withdrawals, failed withdrawals, and completed withdrawals will appear here.</p></div>`;
    }
    return `<div class="wallet-activity-list">${items.map(walletActivityRow).join("")}</div>`;
  }

  function walletActivityItems() {
    const deposits = (walletActivityState.deposits || []).map((deposit) => ({
      type: "deposit",
      id: deposit.id,
      status: deposit.status || "detected",
      amount: Number(deposit.amount || 0),
      title: deposit.status === "credited" ? "Deposit credited" : `Deposit ${statusLabel(deposit.status || "detected")}`,
      detail: deposit.txHash ? shortHash(deposit.txHash) : `${deposit.confirmations || 0} confirmations`,
      date: deposit.creditedAt || deposit.updatedAt || deposit.createdAt,
      txHash: deposit.txHash,
    }));
    const withdrawals = (walletActivityState.withdrawals || []).map((withdrawal) => ({
      type: "withdrawal",
      id: withdrawal.id,
      status: withdrawal.status || "requested",
      amount: Number(withdrawal.amount || 0),
      fee: Number(withdrawal.fee || 0),
      title: withdrawalActivityTitle(withdrawal.status),
      detail: withdrawal.failedReason || withdrawal.reviewReason || (withdrawal.txHash ? shortHash(withdrawal.txHash) : shortAddress(withdrawal.address || "")),
      date: withdrawal.confirmedAt || withdrawal.broadcastAt || withdrawal.updatedAt || withdrawal.createdAt,
      txHash: withdrawal.txHash,
    }));
    return deposits.concat(withdrawals)
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 12);
  }

  function walletActivityRow(item) {
    const failed = item.status === "failed" || item.status === "rejected";
    const sign = item.type === "deposit" ? "+" : "-";
    const completed = item.type === "withdrawal" && item.status === "confirmed";
    const tone = item.type === "deposit" ? "deposit" : failed ? "failed" : completed ? "withdrawal completed" : "withdrawal processing";
    const fee = item.type === "withdrawal" && item.fee > 0 ? `<small>Fee ${format(item.fee)} USDT</small>` : "";
    return `
      <article class="wallet-activity-row ${tone}">
        <span class="wallet-activity-mark">${icon(item.type === "deposit" ? "download" : failed ? "info" : "upload")}</span>
        <span class="wallet-activity-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail || "BRX wallet")}</small>${fee}</span>
        <span class="wallet-activity-side"><strong>${sign}${format(item.amount)} USDT</strong><small>${escapeHtml(dateTime(item.date))}</small></span>
      </article>
    `;
  }

  function transactionDetailsMarkup(item) {
    const direction = item.type === 'deposit' ? 'Received' : 'Sent';
    const fee = item.fee > 0 ? `<div><dt>Fee</dt><dd>` + format(item.fee) + ` USDT</dd></div>` : '';
    const hash = item.txHash ? `<div><dt>Transaction hash</dt><dd class='withdrawal-reference'>` + escapeHtml(item.txHash) + `</dd></div>` : '';
    return `<section class='withdrawal-success-modal transaction-detail-modal' role='dialog'><div class='withdrawal-success-heading'><p class='app-label'>Transaction details</p><h2>` + escapeHtml(item.title) + `</h2></div><div class='withdrawal-success-amount'><span>` + direction + `</span><strong>` + format(item.amount) + ` <small>USDT</small></strong></div><dl class='withdrawal-success-details'><div><dt>Status</dt><dd>` + escapeHtml(statusLabel(item.status)) + `</dd></div><div><dt>Date</dt><dd>` + escapeHtml(dateTime(item.date)) + `</dd></div><div><dt>Reference</dt><dd class='withdrawal-reference'>` + escapeHtml(item.id || '') + `</dd></div>` + fee + hash + `</dl><div class='withdrawal-success-actions'><button class='app-button' type='button' data-close-transaction>Done</button></div></section>`;
  }

  function showTransactionDetails(item) {
    const modal = document.createElement('div');
    modal.className = 'withdrawal-success-backdrop';
    modal.innerHTML = transactionDetailsMarkup(item);
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('[data-close-transaction]')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  }

  function bindWalletActivityRows() {
    const items = walletActivityItems();
    document.querySelectorAll('.wallet-activity-row').forEach((row, index) => {
      const item = items[index];
      if (!item) return;
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', 'View ' + item.title + ' details');
      const open = () => showTransactionDetails(item);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
  }

  function withdrawalActivityTitle(status) {
    if (status === "confirmed") return "Withdrawal completed";
    if (status === "broadcast") return "Withdrawal processing";
    if (status === "approved") return "Withdrawal processing";
    if (status === "failed") return "Withdrawal failed";
    if (status === "rejected") return "Withdrawal rejected";
    return "Withdrawal processing";
  }

  function shortHash(value) {
    const text = String(value || "");
    return text.length > 16 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
  }
  function transferPanel() {
    return `
      <section class="wallet-panel wallet-form-panel internal-transfer-panel">
        <div class="sheet-head">
          <div><p class="app-label blue">Internal transfer</p><h2>Transfer USDT</h2><small>Move funds instantly between BRX accounts.</small></div>
          <span class="sheet-badge">USDT</span>
        </div>
        <div class="wallet-feature-preview">
          <span>${icon("send")}</span>
          <div><h3>Instant and fee-free</h3><p>Internal transfers settle immediately and do not use the blockchain network.</p></div>
        </div>
        <form class="wallet-action-form" id="internalTransferForm">
          <label class="form-field"><span>Recipient email or username</span><input id="transferRecipient" autocomplete="off" placeholder="trader@example.com" required /></label>
          <label class="form-field"><span>Amount</span><input id="transferAmount" inputmode="decimal" placeholder="0.00" required /></label>
          <label class="form-field"><span>Note optional</span><input id="transferNote" maxlength="180" placeholder="Payment note" /></label>
          <p class="deposit-note">Only available USDT can be transferred. Escrow, pending deposits, and pending withdrawals are not spendable.</p>
          <button class="withdrawal-flow-primary" type="submit">Review transfer</button>
        </form>
      </section>
    `;
  }

  function networkSelector(mode, selectedNetwork, insertAfterNetworkId = "", insertMarkup = "") {
    const withdrawalFee = Number(currentUser()?.platformSettings?.withdrawalFeeUsdt || 0);
    return `
      <div class="network-choice-list wallet-network-grid">
        ${NETWORKS.filter((network) => mode !== 'withdraw' || network.id === 'BEP20').map((network) => `
          <button class="deposit-network-card wallet-network-card ${selectedNetwork === network.id ? "active" : ""} ${network.status === "available" ? "" : "muted"}" type="button" data-network-select="${network.id}">
            <span class="network-mark ${network.id === "BEP20" ? "bsc" : "tron"}">${network.mark}</span>
            <div class="wallet-network-copy">
              <strong>${network.name}<small>${network.id}</small></strong>
              <div class="wallet-network-meta">
                <span>${network.confirmations}</span>
                <span>${network.arrival}</span>
                ${mode === "withdraw" ? `<span>Fee ${format(withdrawalFee)} USDT</span>` : `<span>${network.minDeposit}</span>`}
              </div>
            </div>
            <span class="network-status ${network.status === "available" ? "live" : "soon"}">${selectedNetwork === network.id ? "Selected" : network.status === "available" ? "Available" : "Coming soon"}</span>
          </button>
          ${insertMarkup && insertAfterNetworkId === network.id ? `<div class="wallet-network-inset">${insertMarkup}</div>` : ""}
        `).join("")}
      </div>
    `;
  }
  function qrCodeSvg(value) {
    if (!value || typeof qrcode !== "function") return `<span class="qr-placeholder">QR</span>`;
    try {
      const qr = qrcode(0, "M");
      qr.addData(value);
      qr.make();
      return qr.createSvgTag({ cellSize: 3, margin: 2, alt: "BEP20 deposit address QR code", title: "BEP20 deposit address" });
    } catch (error) {
      console.error(error);
      return `<span class="qr-placeholder">QR</span>`;
    }
  }

  async function handleInternalTransferSubmit(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("button[type=submit]");
    const originalText = submit?.textContent;
    try {
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Sending transfer...";
      }
      const result = await accountService.internalTransfer({
        recipient: document.querySelector("#transferRecipient").value,
        amount: document.querySelector("#transferAmount").value,
        note: document.querySelector("#transferNote").value,
      });
      showToast(`Sent ${format(Number(result.transfer?.amount || 0))} USDT to ${result.transfer?.recipientUsername || "BRX trader"}.`);
      renderWallet();
    } catch (error) {
      showToast(error.message || "Could not send internal transfer.");
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  }


  function requestAuthenticatorCode(message) {
    const code = prompt(message || "Enter your six-digit authenticator code.");
    if (code === null) return "";
    const normalized = code.trim().replace(/\s+/g, "");
    if (!/^\d{6}$/.test(normalized)) {
      showToast("Enter the current six-digit authenticator code.");
      return "";
    }
    return normalized;
  }
  function withdrawalSuccessMarkup(withdrawal, isQueued) {
    const state = isQueued ? 'Processing' : 'Under review';
    const amount = escapeHtml(format(Number(withdrawal.amount || 0)));
    const head = `<section class='withdrawal-success-modal' role='dialog'><div class='withdrawal-success-mark'>` + icon('check') + `</div><div class='withdrawal-success-heading'><p class='app-label'>Request received</p><h2>Withdrawal submitted successfully</h2><p>Your request is now ` + state.toLowerCase() + `. Follow every update in transaction history.</p></div>`;
    const amountCard = `<div class='withdrawal-success-amount'><span>Amount</span><strong>` + amount + ` <small>USDT</small></strong></div>`;
    const status = `<p class='withdrawal-success-note'>BNB Smart Chain (BEP20) - ` + state + `</p>`;
    const actions = `<div class='withdrawal-success-actions'><button class='app-button' type='button' data-view-withdrawal-history>View History</button><button class='app-ghost-button' type='button' data-close-withdrawal-success>Done</button></div></section>`;
    return head + amountCard + status + actions;
  }

  function showWithdrawalSuccess(result) {
    const withdrawal = result && result.withdrawal ? result.withdrawal : {};
    const isQueued = String(withdrawal.status || 'requested').toLowerCase() === 'approved';
    const modal = document.createElement('div');
    modal.className = 'withdrawal-success-backdrop';
    modal.innerHTML = withdrawalSuccessMarkup(withdrawal, isQueued);
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelectorAll('[data-close-withdrawal-success]').forEach((button) => button.addEventListener('click', close));
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    modal.querySelector('[data-view-withdrawal-history]')?.addEventListener('click', () => {
      close();
      document.querySelector('.wallet-activity-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function showWithdrawalProcessing(modal, result) {
    const withdrawal = result?.withdrawal || {};
    const state = withdrawal.status === 'approved' ? 'Processing' : 'Under review';
    modal.innerHTML = `<section class='withdrawal-flow-card processing-step' role='dialog' aria-modal='true'><div class='processing-icon'>` + icon('clock') + `</div><h1>Withdrawal ` + state + `</h1><strong>` + format(Number(withdrawal.amount || 0)) + ` USDT</strong><p>Your request was submitted successfully. BRX will notify you when its status changes.</p><div class='processing-status'>` + state + ` on BNB Smart Chain (BEP20)</div><button class='withdrawal-flow-primary' type='button' data-processing-history>View History</button></section>`;
    modal.querySelector('[data-processing-history]')?.addEventListener('click', () => {
      modal.remove();
      document.querySelector('.wallet-activity-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function submitVerifiedWithdrawal(event, modal, data) {
    event.preventDefault();
    const code = modal.querySelector('#withdrawalAuthenticatorCode')?.value.trim() || '';
    const errorNode = modal.querySelector('#withdrawalAuthError');
    const submit = event.currentTarget.querySelector('button[type=submit]');
    if (!/^\d{6}$/.test(code)) { errorNode.textContent = 'Enter the current 6-digit authenticator code.'; return; }
    submit.disabled = true;
    submit.textContent = 'Verifying...';
    try {
      const result = await accountService.requestWithdrawal({ address: data.address, amount: data.amount, twoFactorCode: code, network: 'BEP20', asset: 'USDT' });
      const user = currentUser();
      if (user && result.balance) saveUsers(users().map((item) => item.id === user.id ? { ...item, balance: result.balance } : item));
      refreshWalletActivity();
      renderWallet();
      showWithdrawalProcessing(modal, result);
    } catch (error) {
      errorNode.textContent = error.message || 'Could not request withdrawal.';
      submit.disabled = false;
      submit.textContent = 'Submit';
    }
  }

  function showWithdrawalAuthenticator(modal, data) {
    modal.innerHTML = withdrawalAuthenticatorMarkup();
    const input = modal.querySelector('#withdrawalAuthenticatorCode');
    modal.querySelector('[data-auth-back]')?.addEventListener('click', () => { modal.remove(); showWithdrawalConfirmation(data); });
    modal.querySelector('[data-auth-close]')?.addEventListener('click', () => modal.remove());
    modal.querySelector('[data-paste-auth]')?.addEventListener('click', async () => {
      try { input.value = (await navigator.clipboard.readText()).replace(/\D/g, '').slice(0, 6); } catch { input.focus(); }
    });
    modal.querySelector('#withdrawalAuthenticatorForm')?.addEventListener('submit', (event) => submitVerifiedWithdrawal(event, modal, data));
    input?.focus();
  }

  function withdrawalAuthenticatorMarkup() {
    return `<section class='withdrawal-flow-card authenticator-step' role='dialog' aria-modal='true'><header><button type='button' data-auth-back aria-label='Back'>` + icon('back') + `</button><h2>Security verification</h2><button type='button' data-auth-close aria-label='Close'>` + icon('x') + `</button></header><div class='withdrawal-auth-copy'><h1>Authenticator App Verification</h1><p>Enter the 6-digit code generated by your authenticator app.</p></div><form id='withdrawalAuthenticatorForm'><label><span>Authenticator App</span><div><input id='withdrawalAuthenticatorCode' inputmode='numeric' autocomplete='one-time-code' maxlength='6' required /><button type='button' data-paste-auth>Paste</button></div></label><p class='form-error' id='withdrawalAuthError'></p><button class='withdrawal-flow-primary' type='submit'>Submit</button></form></section>`;
  }

  function showWithdrawalConfirmation(data) {
    const modal = document.createElement('div');
    modal.className = 'withdrawal-flow-backdrop';
    modal.innerHTML = withdrawalConfirmationMarkup(data);
    document.body.appendChild(modal);
    modal.querySelector('[data-withdraw-back]')?.addEventListener('click', () => modal.remove());
    modal.querySelector('[data-confirm-withdrawal]')?.addEventListener('click', () => showWithdrawalAuthenticator(modal, data));
  }

  function withdrawalConfirmationMarkup(data) {
    const receive = Math.max(0, data.amount - data.fee);
    return `<section class='withdrawal-flow-card' role='dialog' aria-modal='true'><header><button type='button' data-withdraw-back aria-label='Back'>` + icon('back') + `</button><h2>Confirm order</h2><span></span></header><div class='withdrawal-flow-receive'><span>You'll receive</span><strong>` + format(receive) + ` USDT</strong></div><dl class='withdrawal-flow-details'><div><dt>Network</dt><dd>BNB Smart Chain (BEP20)</dd></div><div><dt>Address</dt><dd class='withdrawal-flow-address'>` + escapeHtml(data.address) + `</dd></div><div><dt>Withdrawal amount</dt><dd>` + format(data.amount) + ` USDT</dd></div><div><dt>Network fee</dt><dd>` + format(data.fee) + ` USDT</dd></div><div><dt>Wallet</dt><dd>BRX Wallet</dd></div></dl><div class='withdrawal-flow-warning'>` + icon('info') + `<span>Ensure that the address is correct and on the same network. Transactions cannot be cancelled.</span></div><button class='withdrawal-flow-primary' type='button' data-confirm-withdrawal>Confirm</button></section>`;
  }

  async function startWithdrawalFlow() {
    const address = document.querySelector('#withdrawAddress')?.value.trim() || '';
    const amount = Number(document.querySelector('#withdrawAmount')?.value);
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return showToast('Enter a valid BEP20 withdrawal address.');
    if (!Number.isFinite(amount) || amount <= 0) return showToast('Enter a valid withdrawal amount.');
    const user = currentUser();
    if (!user?.securityLoaded && securityService) await securityService.loadSecurity();
    if (!currentUser()?.security?.twoFactor?.enabled) {
      showToast('Set up 2FA before withdrawing.');
      location.hash = '#/settings?tab=security';
      return;
    }
    const fee = Number(currentUser()?.platformSettings?.withdrawalFeeUsdt || 0);
    const available = Number(currentUser()?.balance?.available || 0);
    if (amount > available) return showToast(`Insufficient available balance. You need ${format(amount)} USDT.`);
    if (amount <= fee) return showToast(`Withdrawal amount must be greater than the $${format(fee)} fee.`);
    showWithdrawalConfirmation({ address, amount, fee });
  }

  async function handleWithdrawalSubmit(event) {
    event.preventDefault();
    await startWithdrawalFlow();
  }
  function renderKyc() {
    const user = requireUser();
    if (!user) return;
    const submitted = user.kycStatus === "pending";

    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow">
        <div class="page-title"><div><p class="app-label blue">Manual KYC</p><h2>Verify your identity</h2><p class="app-muted">Upload clear photos for admin review. BRX checks these manually before raising limits.</p></div><a class="app-ghost-button" href="#/dashboard">Back</a></div>
        ${submitted ? `<section class="review-card"><span class="mini-icon">ok</span><div><h3>KYC submitted for review</h3><p>Your documents were received. Admin review status: pending.</p></div></section>` : ""}
        <form class="kyc-form" id="kycForm" novalidate>
          <div class="kyc-form-grid">
            <label class="form-field"><span>Legal full name</span><input id="kycName" placeholder="Name as shown on ID" required /></label>
            <label class="form-field"><span>Phone number</span><input id="kycPhone" placeholder="+251..." required /></label>
            <label class="form-field"><span>ID type</span><input id="kycIdType" placeholder="National ID or Passport" required /></label>
            <label class="form-field"><span>ID number</span><input id="kycIdNumber" placeholder="Document number" required /></label>
          </div>

          <div class="file-grid">
            ${uploadField("kycFront", "Front of ID", true)}
            ${uploadField("kycBack", "Back of ID", true)}
            ${uploadField("kycSelfie", "Selfie photo", true)}
            ${uploadField("kycPayment", "Payment method proof", false)}
          </div>

          <label class="check-row"><input id="kycConfirm" type="checkbox" /><span>I confirm these documents are mine and the information is accurate.</span></label>
          <div class="form-error" id="formError"></div>
          <button class="app-button" type="submit">Submit for manual review</button>
        </form>
      </section>
    `;
    document.querySelector("#kycForm").addEventListener("submit", handleKycSubmit);
  }

  function renderNotifications() {
    const user = requireUser();
    if (!user) return;
    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow notifications-page">
        <div class="page-title">
          <div><p class="app-label blue">Activity center</p><h2>Notifications</h2></div>
          <button class="app-ghost-button" id="notificationsReadAll" type="button">Mark all as read</button>
        </div>
        <p class="app-muted notifications-intro">New orders and every important P2P step appear here. Select an alert to open the related trade.</p>
        <div id="notificationsContent"><section class="empty-panel compact"><span class="mini-icon">...</span><h3>Loading notifications</h3></section></div>
      </section>
    `;
    document.querySelector("#notificationsReadAll")?.addEventListener("click", async () => {
      try {
        await notificationService.markAllRead();
        await loadNotificationsPage();
        window.BRX.header.renderHeader();
      } catch (error) {
        showToast(error.message || "Could not update notifications.");
      }
    });
    void loadNotificationsPage();
  }

  async function loadNotificationsPage() {
    const content = document.querySelector("#notificationsContent");
    if (!content || !notificationService) return;
    try {
      const result = await notificationService.list(50);
      const notifications = result.notifications || [];
      content.innerHTML = notifications.length
        ? `<section class="notification-feed">${notifications.map(notificationPageItem).join("")}</section>`
        : `<section class="empty-panel"><span class="mini-icon">${icon("bell")}</span><h3>No notifications yet</h3><p>New P2P orders and trade updates will appear here.</p></section>`;
      content.querySelectorAll("[data-open-notification]").forEach((button) => {
        button.addEventListener("click", async () => {
          const notificationId = button.dataset.openNotification;
          try {
            await notificationService.markRead(notificationId);
          } catch (error) {
            console.error(error);
          }
          location.hash = button.dataset.notificationUrl || "#/trades";
        });
      });
    } catch (error) {
      content.innerHTML = `<section class="warning-card"><h3>Could not load notifications</h3><p>${escapeHtml(error.message || "Start the BRX backend and run migrations.")}</p></section>`;
    }
  }

  function notificationPageItem(notification) {
    const typeLabel = String(notification.type || "trade.update").split(".").pop().replace(/_/g, " ");
    return `
      <button class="notification-feed-item ${notification.isRead ? "" : "unread"}" type="button"
        data-open-notification="${escapeAttr(notification.id)}"
        data-notification-url="${escapeAttr(notificationService.actionUrl(notification))}">
        <span class="notification-feed-icon">${icon(notificationPageIcon(notification.type))}</span>
        <span class="notification-feed-copy">
          <span class="notification-feed-meta"><small>${escapeHtml(typeLabel)}</small><time>${escapeHtml(notificationService.relativeTime(notification.createdAt))}</time></span>
          <strong>${escapeHtml(notification.title)}</strong>
          <span>${escapeHtml(notification.message)}</span>
        </span>
        <span class="notification-unread-marker" aria-hidden="true"></span>
      </button>
    `;
  }

  function notificationPageIcon(type) {
    if (type === "trade.message") return "mail";
    if (type === "trade.payment_sent") return "card";
    if (type === "trade.released") return "wallet";
    if (type === "trade.disputed" || type === "trade.resolved") return "shield";
    if (type === "trade.expired" || type === "trade.cancelled") return "info";
    return "trades";
  }
  function renderProfile() {
    const user = requireUser();
    if (!user) return;
    if (!user.accountSettingsLoaded && accountService) {
      void accountService.loadSettings().then(() => renderProfile()).catch((error) => console.error(error));
    }
    const traderName = traderDisplayName(user);
    refs.app.innerHTML = `
      <section class="exchange-app app-page-wide profile-page professional-profile-page">
        <section class="profile-summary-card settings-identity profile-view-identity">
          <div class="settings-avatar-wrap profile-summary-avatar">
            ${profileAvatarMarkup(user, "settings-avatar", user.email)}
          </div>
          <div class="profile-summary-main">
            <p class="app-label blue">Trader profile</p>
            <div class="trader-name-line"><h1>${escapeHtml(traderName)}</h1><a class="trader-name-edit" href="#/settings?tab=profile&edit=trader-name" aria-label="Edit trader name">${icon("edit")}</a></div>
            <div class="profile-summary-meta">
              <span>${escapeHtml(user.email)}</span>
              <span>${brxId(user)}</span>
              <span>${kycLabel(user.kycStatus)}</span>
            </div>
          </div>
          <a class="app-button" href="#/settings?tab=profile&edit=trader-name">Edit profile ${icon("external")}</a>
        </section>

        <section class="settings-card settings-card-flat profile-view-card">
          ${settingsRow("mail", "Email", escapeHtml(user.email), user.emailVerified ? statusBadge("Verified", "success") : statusBadge("Not verified", "warning"))}
          ${settingsRow("user", "Trader name", escapeHtml(traderName), `<a class="settings-action" href="#/settings?tab=profile&edit=trader-name">Edit</a>`)}
          ${settingsRow("phone", "Phone number", escapeHtml(user.phone || "Not added"), "")}
          ${settingsRow("shield", "KYC status", kycLabel(user.kycStatus), statusBadge(kycTier(user), "neutral"))}
          ${settingsRow("calendar", "Member since", memberSince(user), "")}
        </section>
      </section>
    `;
    renderProfileTradingStats(user);
  }
  function renderProfileTradingStats(user) {
    const stats = user.tradingStats || {};
    const panel = document.createElement('section');
    panel.className = 'profile-trading-stats';
    panel.innerHTML = `<div class='profile-stat-head'><div><p class='app-label blue'>Trading performance</p><h2>Trading statistics</h2></div><small>Based on completed and closed BRX orders</small></div><div class='profile-stat-grid'><div class='primary'><span>Completion rate</span><strong>` + format(Number(stats.completionRate ?? 100)) + `%</strong></div><div><span>Total trades</span><strong>` + Number(stats.totalTrades || 0).toLocaleString() + `</strong></div><div><span>Completed</span><strong>` + Number(stats.completedTrades || 0).toLocaleString() + `</strong></div><div><span>Buy / Sell</span><strong>` + Number(stats.buyTrades || 0).toLocaleString() + ` / ` + Number(stats.sellTrades || 0).toLocaleString() + `</strong></div></div>`;
    document.querySelector('.profile-view-card')?.before(panel);
  }

  function renderSettings() {
    const user = requireUser();
    if (!user) return;
    const activeTab = validSettingsTab(window.BRX.router.routeParams().get("tab"));
    if (activeTab !== "profile") showTraderNameEditor = false;
    if (activeTab === "profile" && window.BRX.router.routeParams().get("edit") === "trader-name") showTraderNameEditor = true;
    const tabTitle = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);
    refs.app.innerHTML = `
      <section class="exchange-app app-page-wide settings-page professional-settings-page">
        <header class="professional-settings-head">
          <div class="professional-settings-person">
            ${profileAvatarMarkup(user, "settings-head-avatar", user.email)}
            <div><p class="app-label blue">Account center</p><h1>Settings</h1><small>${escapeHtml(user.email)}</small></div>
          </div>
          <div class="professional-settings-state">${icon("shield")}<span><strong>${kycTier(user)}</strong><small>${kycLabel(user.kycStatus)}</small></span></div>
        </header>
        <div class="professional-settings-layout">
          ${settingsTabs(activeTab)}
          <main class="settings-content">
            <header class="settings-content-head"><div><p class="app-label">Account settings</p><h2>${tabTitle}</h2></div><a href="#/dashboard">Back to dashboard ${icon("external")}</a></header>
            ${settingsContent(activeTab, user)}
          </main>
        </div>
      </section>
    `;
    bindSettingsEvents();
    if (["security", "account"].includes(activeTab) && securityService && !user.securityLoaded) {
      void securityService.loadSecurity().then(() => {
        if (window.BRX.router.routeName() === "settings") renderSettings();
      }).catch((error) => {
        console.error(error);
        showToast("Could not load security settings. Check the BRX backend connection.");
      });
    }
    if (!user.accountSettingsLoaded && accountService) {
      void accountService.loadSettings().then(() => {
        if (window.BRX.router.routeName() === "settings") renderSettings();
      }).catch((error) => {
        console.error(error);
        showToast("Could not load account settings. Check the BRX backend connection.");
      });
    }
  }

  function validSettingsTab(tab) {
    return ["profile", "security", "payments", "addresses", "account", "notifications"].includes(tab) ? tab : "profile";
  }

  function settingsTabs(activeTab) {
    const tabs = [
      ["profile", "user", "Profile", "Personal details"],
      ["security", "shield", "Security", "2FA and sessions"],
      ["payments", "card", "Payments", "ETB receiving accounts"],
      ["addresses", "mapPin", "Addresses", "Withdrawal destinations"],
      ["account", "settings", "Account", "Status and access"],
      ["notifications", "bell", "Notifications", "Alert preferences"],
    ];

    return `
      <nav class="settings-tabs professional-settings-nav" aria-label="Account settings">
        <span class="settings-nav-label">Preferences</span>
        ${tabs.map(([key, iconName, label, detail]) => `
          <button class="settings-tab ${activeTab === key ? "active" : ""}" type="button" data-settings-tab="${key}">
            ${icon(iconName)}<span><strong>${label}</strong><small>${detail}</small></span>${icon("external")}
          </button>
        `).join("")}
      </nav>
    `;
  }

  function settingsContent(tab, user) {
    if (tab === "security") return settingsSecurity(user);
    if (tab === "payments") return settingsPayments(user);
    if (tab === "addresses") return settingsAddresses(user);
    if (tab === "account") return settingsAccount(user);
    if (tab === "notifications") return settingsNotifications(user);
    return settingsProfile(user);
  }

  function settingsProfile(user) {
    return `
      <section class="settings-identity settings-profile-card">
        <div class="settings-avatar-wrap">
          ${profileAvatarMarkup(user, "settings-avatar", user.email)}
        </div>
        <div class="settings-id-main settings-profile-main">
          <p class="app-label blue">Profile</p>
          <div class="trader-name-line settings-trader-name"><h3>${escapeHtml(traderDisplayName(user))}</h3><button class="trader-name-edit" type="button" data-edit-trader-name aria-label="Edit trader name">${icon("edit")}</button></div>
          ${showTraderNameEditor ? `
            <form id="settingsProfileForm" class="settings-trader-editor">
              <input id="settingsFullName" type="hidden" value="${escapeAttr(user.fullName || "")}" />
              <input id="settingsPhone" type="hidden" value="${escapeAttr(user.phone || "")}" />
              <label class="trader-name-field"><span>Trader name</span><input id="settingsUsername" value="${escapeAttr(traderDisplayName(user))}" autocomplete="nickname" placeholder="habeshatic1454" required /></label>
              <button class="settings-action trader-name-save" type="submit">Save</button>
            </form>
          ` : ""}
          <small>${escapeHtml(user.email)}</small>
          <span class="settings-muted">${brxId(user)} <button class="inline-icon-button settings-copy-id" type="button" title="Copy BRX ID">${icon("copy")}</button></span>
          <input id="settingsAvatarUrl" type="hidden" value="${escapeAttr(user.avatarUrl || "")}" />
          <div class="settings-avatar-actions">
            <label class="settings-avatar-upload" for="settingsAvatarInput">${icon("camera")}<span>Upload photo</span><input id="settingsAvatarInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
            ${user.avatarUrl ? `<button class="settings-avatar-remove" id="settingsAvatarRemove" type="button">Remove</button>` : ""}
          </div>
          <small class="settings-avatar-help">PNG, JPG, WebP, or GIF up to 2 MB. Uploads save automatically.</small>
        </div>
      </section>

      <section class="settings-card settings-card-flat settings-profile-facts">
        ${settingsRow("mail", "Email", escapeHtml(user.email), user.emailVerified ? statusBadge("Verified", "success") : statusBadge("Not verified", "warning"))}
        ${settingsRow("user", "Trader name", escapeHtml(traderDisplayName(user)), `<button class="settings-action" type="button" data-edit-trader-name>Edit</button>`)}
        ${settingsRow("phone", "Phone number", escapeHtml(user.phone || "Not added"), "")}
        ${settingsRow("shield", "KYC Status", kycLabel(user.kycStatus), statusBadge(kycTier(user), "neutral"))}
        ${settingsRow("calendar", "Member Since", memberSince(user), "")}
      </section>

    `;
  }
  function settingsSecurity(user) {
    const security = user.security || {};
    const sessions = security.sessions || [];
    const twoFactor = security.twoFactor || { enabled: false, pending: false };
    const setup = security.twoFactorSetup;
    return `
      <div class="settings-note">${icon("shield")}<span>Review active sessions, rotate your password, and require authenticator codes before sign-in.</span></div>

      <section class="settings-card settings-form-card">
        <div class="settings-card-head">
          <div><h3>${icon("key")} Change Password</h3><p>Changing your password revokes every other active session.</p></div>
        </div>
        <form id="passwordChangeForm" class="settings-form-grid">
          <label class="form-field"><span>Current password</span><input id="currentPassword" type="password" autocomplete="current-password" required /></label>
          <label class="form-field"><span>New password</span><input id="newPassword" type="password" autocomplete="new-password" required /></label>
          <label class="form-field"><span>Confirm new password</span><input id="confirmPassword" type="password" autocomplete="new-password" required /></label>
          <div class="settings-form-actions full"><button class="app-button" type="submit">Update password</button></div>
        </form>
      </section>

      <section class="settings-card settings-card-flat">
        <div class="settings-card-head">
          <div><h3>${icon("shield")} Two-Factor Authentication</h3><p>Use Google Authenticator, Authy, 1Password, or any TOTP app.</p></div>
          ${statusBadge(twoFactor.enabled ? "Enabled" : setup ? "Setup pending" : "Disabled", twoFactor.enabled ? "success" : "neutral")}
        </div>
        ${setup && showTwoFactorSetupDetails ? twoFactorSetupBlock(setup) : twoFactor.enabled ? twoFactorEnabledBlock() : twoFactorDisabledBlock(Boolean(setup))}
      </section>

      <section class="settings-card settings-card-flat">
        <div class="settings-card-head">
          <div><h3>${icon("activity")} Active Sessions</h3><p>Devices currently signed in to this account.</p></div>
          <button class="settings-action warning" type="button" id="revokeOtherSessions">Revoke others</button>
        </div>
        ${sessions.length ? sessions.map(sessionRow).join("") : settingsEmpty("activity", "No sessions loaded", "Start the backend, run migrations, and refresh this page.")}
      </section>
    `;
  }

  function settingsPayments(user) {
    const methods = user.paymentMethods || [];
    return `
      <section class="settings-card settings-payment-card">
        <div class="settings-card-head payment-card-head">
          <div><h3>${icon("card")} Payment Methods</h3><p>Your ETB receiving accounts used in P2P trades.</p></div>
          ${showPaymentMethodForm ? "" : `<button class="payment-add-button" id="togglePaymentMethodForm" type="button"><span aria-hidden="true">+</span> Add</button>`}
        </div>

        ${showPaymentMethodForm ? `
          <form id="paymentMethodForm" class="payment-method-editor">
            <h4>Add New Payment Method</h4>
            <label class="form-field wide"><span>Payment Type</span>
              <select id="paymentType" required>
                <option value="">Select payment method</option>
                ${paymentTypeOptions(user)}
              </select>
            </label>
            <label class="form-field wide"><span>Account Holder Name</span><input id="paymentAccountName" autocomplete="name" placeholder="Full name on the account" required /></label>
            <label class="form-field wide" id="paymentPhoneField" hidden><span>Phone Number</span><input id="paymentPhone" inputmode="tel" autocomplete="tel" placeholder="+251 9XX XXX XXX" /></label>
            <div class="payment-editor-actions">
              <button class="app-button" type="submit"><span aria-hidden="true">+</span> Add Payment Method</button>
              <button class="payment-cancel-button" id="cancelPaymentMethodForm" type="button">Cancel</button>
            </div>
          </form>
        ` : ""}

        <div class="payment-method-list">
          ${methods.length ? methods.map(paymentMethodRow).join("") : `
            <div class="payment-method-empty">
              ${icon("card")}
              <strong>No payment methods yet</strong>
              <span>Add Telebirr, M-Pesa, CBE, Bank of Abyssinia, or Awash Bank to start trading.</span>
            </div>
          `}
        </div>
      </section>
    `;
  }
  function settingsAddresses(user) {
    const addresses = user.withdrawalAddresses || [];
    return `
      <section class="settings-card settings-form-card">
        <div class="settings-card-head">
          <div><h3>${icon("mapPin")} Save Withdrawal Address</h3><p>Only save addresses you control. Withdrawal requests require two-factor authentication.</p></div>
        </div>
        <form id="withdrawalAddressForm">
          <div class="settings-form-grid">
            <label class="form-field"><span>Network</span><select id="withdrawalNetwork"><option value="BEP20">BNB Smart Chain - BEP20</option></select></label>
            <label class="form-field"><span>Label</span><input id="withdrawalLabel" placeholder="My Binance wallet" required /></label>
            <label class="form-field wide"><span>BEP20 address</span><input id="withdrawalAddress" placeholder="0x..." required /></label>
          </div>
          <label class="check-row settings-default-check"><input id="withdrawalDefault" type="checkbox" ${addresses.length ? "" : "checked"} /><span>Make this my default withdrawal address</span></label>
          <div class="settings-form-actions"><button class="app-button" type="submit">Save address</button></div>
        </form>
      </section>

      <section class="settings-card settings-card-flat">
        <div class="settings-card-head">
          <div><h3>${icon("wallet")} Withdrawal Address Book</h3><p>Saved USDT destinations for future withdrawal requests.</p></div>
          ${statusBadge(`${addresses.length} saved`, "neutral")}
        </div>
        ${addresses.length ? addresses.map(withdrawalAddressRow).join("") : settingsEmpty("wallet", "No saved addresses yet", "Add a BEP20 address before using the withdrawal flow.")}
      </section>
    `;
  }

  function settingsAccount(user) {
    const twoFactor = user.security?.twoFactor;
    const twoFactorText = user.securityLoaded ? (twoFactor?.enabled ? "Enabled" : "Disabled") : "Open Security to review";
    const twoFactorTone = twoFactor?.enabled ? "success" : "neutral";
    const methodCount = (user.paymentMethods || []).length;
    return `
      <section class="settings-card settings-card-flat account-readiness-card">
        <div class="settings-card-head"><div><h3>${icon("user")} Account overview</h3><p>Your BRX identity, access level, and configured trading tools.</p></div>${statusBadge(kycTier(user), user.kycStatus === "approved" ? "success" : "neutral")}</div>
        ${settingsRow("user", "Account name", escapeHtml(accountDisplayName(user)), "")}
        ${settingsRow("mail", "Email", escapeHtml(user.email), user.emailVerified ? statusBadge("Verified", "success") : statusBadge("Verification needed", "warning"))}
        ${settingsRow("calendar", "Member since", memberSince(user), "")}
        ${settingsRow("shield", "KYC status", kycLabel(user.kycStatus), `<a class="settings-action" href="#/kyc">${user.kycStatus === "approved" ? "View" : "Verify"}</a>`)}
        ${settingsRow("fingerprint", "Two-factor authentication", twoFactorText, `<a class="settings-action ${twoFactorTone}" href="#/settings?tab=security">Manage</a>`)}
      </section>

      <section class="settings-card settings-card-flat">
        <div class="settings-card-head"><div><h3>${icon("activity")} Trading readiness</h3><p>Complete these essentials before opening larger P2P orders.</p></div></div>
        ${settingsRow("card", "Payment methods", `${methodCount} saved`, `<a class="settings-action" href="#/settings?tab=payments">Manage</a>`)}
        ${settingsRow("mapPin", "Withdrawal addresses", `${(user.withdrawalAddresses || []).length} saved`, `<a class="settings-action" href="#/settings?tab=addresses">Manage</a>`)}
        ${settingsRow("info", "Current trade limit", user.kycStatus === "approved" ? "5,000 USDT" : "1,000 USDT", "")}
      </section>

      <section class="settings-card settings-card-flat account-session-card">
        <div class="settings-card-head"><div><h3>${icon("logOut")} Session controls</h3><p>Keep this browser signed in and revoke access from every other device.</p></div></div>
        ${settingsRow("activity", "Other signed-in devices", "Revoke all active sessions except this one.", `<button class="settings-action warning" type="button" id="revokeOtherSessions">Revoke others</button>`)}
      </section>
    `;
  }

  function settingsNotifications(user) {
    const prefs = { ...accountService.defaultNotifications(), ...(user.notificationPreferences || {}) };
    const rows = [
      ["emailVerification", "Email verification", "Receive account verification messages."],
      ["tradeUpdates", "Trade updates", "Payment sent, release, dispute, and cancellation alerts."],
      ["depositAlerts", "Deposit alerts", "Deposit detected and credited notifications."],
      ["withdrawalAlerts", "Withdrawal alerts", "Withdrawal request and completion messages."],
      ["marketing", "Marketing", "Product updates and promotions."],
    ];

    return `
      <section class="settings-card settings-card-flat">
        <div class="settings-card-head"><div><h3>${icon("bell")} Notifications</h3><p>Choose which BRX alerts you want to receive.</p></div></div>
        <div class="push-notification-card">
          <span class="push-notification-icon">${icon("bell")}</span>
          <span><strong>Phone push notifications</strong><small>Receive trade, deposit, and withdrawal alerts when BRX is closed. Your device controls background notification sound.</small><em id="pushNotificationStatus">Checking this device...</em></span>
          <button class="settings-action" id="pushNotificationsButton" type="button">Enable</button>
        </div>
        ${rows.map(([key, title, detail]) => `
          <label class="settings-row settings-toggle-row">
            <span class="settings-row-icon">${icon("bell")}</span>
            <span class="settings-row-main"><strong>${title}</strong><small>${detail}</small></span>
            <input class="settings-toggle" type="checkbox" data-notification-key="${key}" ${prefs[key] ? "checked" : ""} />
          </label>
        `).join("")}
      </section>
    `;
  }

  function settingsTrades(user) {
    const tradePreferences = { ...accountService.defaultTradePreferences(), ...(user.tradePreferences || {}) };
    const rails = tradePreferences.preferredPaymentRails || [];
    return `
      <section class="settings-card settings-form-card">
        <div class="settings-card-head"><div><h3>${icon("trades")} Trade Preferences</h3><p>Default settings used when browsing and posting P2P ads.</p></div></div>
        <form id="tradePreferencesForm">
          <div class="settings-form-grid">
            <label class="form-field"><span>Market</span><input value="ETB / USDT" disabled /></label>
            <label class="form-field"><span>Preferred payment rails</span><input id="preferredPaymentRails" value="${escapeAttr(rails.join(", "))}" placeholder="Telebirr, M-Pesa, CBE, Bank of Abyssinia, Awash Bank" /></label>
          </div>
          <div class="settings-form-actions"><button class="app-button" type="submit">Save trade preferences</button></div>
        </form>
      </section>
      <section class="settings-card settings-card-flat">
        ${settingsRow("shield", "Escrow rule", "Database escrow only. No blockchain transaction during trades.", "")}
        ${settingsRow("info", "Unverified trade limit", "1,000 USDT", "")}
        ${settingsRow("check", "Verified trade limit", "5,000 USDT", "")}
      </section>
    `;
  }

  function settingsRow(iconName, label, value, aside = "", tone = "") {
    return `
      <div class="settings-row ${tone ? `settings-row-${tone}` : ""}">
        <span class="settings-row-icon">${icon(iconName)}</span>
        <span class="settings-row-main"><strong>${label}</strong><small>${value}</small></span>
        ${aside ? `<span class="settings-row-aside">${aside}</span>` : ""}
      </div>
    `;
  }

  function statusBadge(text, tone = "neutral") {
    return `<span class="settings-badge ${tone}">${tone === "success" ? icon("check") : ""}${escapeHtml(text)}</span>`;
  }

  function actionButton(label, toast, tone = "") {
    return `<button class="settings-action ${tone}" type="button" data-toast="${escapeHtml(toast)}">${escapeHtml(label)}</button>`;
  }

  function bindSettingsEvents() {
    document.querySelectorAll("[data-settings-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        location.hash = `#/settings?tab=${button.dataset.settingsTab}`;
      });
    });

    document.querySelector("#settingsProfileForm")?.addEventListener("submit", handleSettingsProfileSubmit);
    document.querySelector("#settingsAvatarInput")?.addEventListener("change", handleSettingsAvatarChange);
    document.querySelector("#settingsAvatarRemove")?.addEventListener("click", handleSettingsAvatarRemove);
    document.querySelector("#paymentMethodForm")?.addEventListener("submit", handlePaymentMethodSubmit);
    document.querySelector("#togglePaymentMethodForm")?.addEventListener("click", () => {
      showPaymentMethodForm = true;
      renderSettings();
    });
    document.querySelector("#cancelPaymentMethodForm")?.addEventListener("click", () => {
      showPaymentMethodForm = false;
      renderSettings();
    });
    document.querySelector("#paymentType")?.addEventListener("change", updatePaymentMethodFields);
    updatePaymentMethodFields();
    document.querySelector("#tradePreferencesForm")?.addEventListener("submit", handleTradePreferencesSubmit);
    document.querySelector("#passwordChangeForm")?.addEventListener("submit", handlePasswordChange);
    document.querySelector("#withdrawalAddressForm")?.addEventListener("submit", handleWithdrawalAddressSubmit);
    document.querySelector("#startTwoFactorSetup")?.addEventListener("click", handleStartTwoFactorSetup);
    document.querySelector("#restartTwoFactorSetup")?.addEventListener("click", handleRestartTwoFactorSetup);
    document.querySelector("#copyTwoFactorSecret")?.addEventListener("click", handleCopyTwoFactorSecret);
    document.querySelector("#confirmTwoFactor")?.addEventListener("click", handleConfirmTwoFactor);
    document.querySelector("#showDisableTwoFactorForm")?.addEventListener("click", handleShowDisableTwoFactorForm);
    document.querySelector("#cancelDisableTwoFactor")?.addEventListener("click", handleCancelDisableTwoFactor);
    document.querySelector("#disableTwoFactor")?.addEventListener("click", handleDisableTwoFactor);
    document.querySelector("#revokeOtherSessions")?.addEventListener("click", handleRevokeOtherSessions);
    document.querySelector("#pushNotificationsButton")?.addEventListener("click", handlePushNotifications);
    if (document.querySelector("#pushNotificationsButton")) void refreshPushNotificationStatus();

    document.querySelectorAll("[data-payment-delete]").forEach((button) => {
      button.addEventListener("click", () => handlePaymentDelete(button.dataset.paymentDelete, button));
    });

    document.querySelectorAll("[data-payment-default]").forEach((button) => {
      button.addEventListener("click", () => handlePaymentDefault(button.dataset.paymentDefault));
    });

    document.querySelectorAll("[data-session-revoke]").forEach((button) => {
      button.addEventListener("click", () => handleRevokeSession(button.dataset.sessionRevoke));
    });

    document.querySelectorAll("[data-withdrawal-delete]").forEach((button) => {
      button.addEventListener("click", () => handleWithdrawalDelete(button.dataset.withdrawalDelete));
    });

    document.querySelectorAll("[data-withdrawal-default]").forEach((button) => {
      button.addEventListener("click", () => handleWithdrawalDefault(button.dataset.withdrawalDefault));
    });

    document.querySelectorAll(".settings-action[data-toast], .settings-toast-action").forEach((button) => {
      button.addEventListener("click", () => showToast(button.dataset.toast || "Saved."));
    });

    document.querySelectorAll(".settings-toggle").forEach((input) => {
      input.addEventListener("change", handleNotificationChange);
    });

    document.querySelectorAll("[data-edit-trader-name]").forEach((button) => {
      button.addEventListener("click", () => {
        showTraderNameEditor = true;
        renderSettings();
        setTimeout(focusTraderNameField, 0);
      });
    });

    if (showTraderNameEditor) setTimeout(focusTraderNameField, 0);

    document.querySelector(".settings-copy-id")?.addEventListener("click", async () => {
      const user = currentUser();
      if (!user) return;
      await navigator.clipboard?.writeText(brxId(user));
      showToast("BRX ID copied.");
    });
  }

  function focusTraderNameField() {
    const field = document.querySelector("#settingsUsername");
    if (!field) return;
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus({ preventScroll: true });
    field.select?.();
  }

  async function refreshPushNotificationStatus() {
    const button = document.querySelector("#pushNotificationsButton");
    const label = document.querySelector("#pushNotificationStatus");
    if (!button || !label || !window.BRX.pushService) return;
    try {
      const state = await window.BRX.pushService.status();
      if (!state.supported) {
        label.textContent = "Not supported by this browser.";
        button.hidden = true;
      } else if (!state.configured) {
        label.textContent = "Waiting for BRX server configuration.";
        button.disabled = true;
      } else if (state.permission === "denied") {
        label.textContent = "Blocked in browser settings.";
        button.textContent = "Blocked";
        button.disabled = true;
      } else {
        label.textContent = state.subscribed ? "Enabled on this device." : "Off on this device.";
        button.textContent = state.subscribed ? "Disable" : "Enable";
        button.dataset.subscribed = String(state.subscribed);
      }
    } catch (error) {
      label.textContent = error.message || "Could not check push notifications.";
    }
  }

  async function handlePushNotifications(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (button.dataset.subscribed === "true") {
        await window.BRX.pushService.disable();
        showToast("Push notifications disabled on this device.");
      } else {
        await window.BRX.pushService.enable();
        showToast("BRX push notifications enabled.");
      }
    } catch (error) {
      showToast(error.message || "Could not update push notifications.");
    } finally {
      button.disabled = false;
      await refreshPushNotificationStatus();
    }
  }
  async function handleSettingsProfileSubmit(event) {
    event.preventDefault();
    try {
      const user = currentUser();
      const enteredTraderName = document.querySelector("#settingsUsername").value.trim();
      await accountService.saveProfile({
        fullName: document.querySelector("#settingsFullName").value,
        phone: document.querySelector("#settingsPhone").value,
        username: user && enteredTraderName === brxId(user) ? "" : enteredTraderName,
        avatarUrl: document.querySelector("#settingsAvatarUrl")?.value || "",
      });
      showTraderNameEditor = false;
      showToast("Profile saved.");
      if (window.BRX.router.routeParams().get("edit") === "trader-name") location.hash = "#/settings?tab=profile";
      else renderSettings();
    } catch (error) {
      showToast(error.message || "Could not save profile.");
    }
  }

  async function handleSettingsAvatarChange(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readAvatarDataUrl(file);
      const hidden = document.querySelector("#settingsAvatarUrl");
      if (hidden) hidden.value = dataUrl;
      updateAvatarPreview(dataUrl);
      await saveSettingsAvatar(dataUrl, "Profile photo saved.");
    } catch (error) {
      event.currentTarget.value = "";
      showToast(error.message || "Could not save profile photo.");
      renderSettings();
    }
  }

  async function handleSettingsAvatarRemove() {
    const hidden = document.querySelector("#settingsAvatarUrl");
    const input = document.querySelector("#settingsAvatarInput");
    if (hidden) hidden.value = "";
    if (input) input.value = "";
    updateAvatarPreview("");
    try {
      await saveSettingsAvatar("", "Profile photo removed.");
    } catch (error) {
      showToast(error.message || "Could not remove profile photo.");
      renderSettings();
    }
  }

  async function saveSettingsAvatar(avatarUrl, message) {
    const user = currentUser();
    if (!user) return;
    await accountService.saveProfile({
      fullName: user.fullName || user.kycSubmission?.name || "",
      phone: user.phone || "",
      username: user.username || "",
      avatarUrl,
    });
    showToast(message);
    renderSettings();
  }

  function readAvatarDataUrl(file) {
    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) return Promise.reject(new Error("Upload a PNG, JPG, WebP, or GIF image."));
    if (file.size > 2 * 1024 * 1024) return Promise.reject(new Error("Profile image must be 2 MB or smaller."));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  function updateAvatarPreview(dataUrl) {
    document.querySelectorAll("[data-avatar-preview]").forEach((avatar) => {
      if (dataUrl) {
        avatar.classList.add("has-image");
        avatar.innerHTML = `<img src="${escapeAttr(dataUrl)}" alt="" />`;
      } else {
        avatar.classList.remove("has-image");
        avatar.textContent = avatar.dataset.avatarInitial || "B";
      }
    });
  }

  function updatePaymentMethodFields() {
    const type = document.querySelector("#paymentType")?.value || "";
    const phoneField = document.querySelector("#paymentPhoneField");
    const phoneInput = document.querySelector("#paymentPhone");
    if (!phoneField || !phoneInput) return;
    phoneField.hidden = !type;
    phoneInput.required = Boolean(type);
    const bankTypes = ["cbe_bank", "bank_of_abyssinia", "awash_bank"];
    const placeholders = {
      telebirr: "+251 9XX XXX XXX",
      mpesa: "+251 7XX XXX XXX",
      cbe_birr: "+251 9XX XXX XXX",
      cbe_bank: "CBE account number",
      bank_of_abyssinia: "Abyssinia account number",
      awash_bank: "Awash account number",
    };
    phoneInput.placeholder = placeholders[type] || "+251 9XX XXX XXX";
    const label = document.querySelector("#paymentPhoneField span");
    if (label) label.textContent = bankTypes.includes(type) ? "Account Number" : "Phone Number";
  }

  async function handlePaymentMethodSubmit(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const type = document.querySelector("#paymentType")?.value || "";
    if (!type) return showToast("Select a payment method.");
    const originalText = submit?.textContent;
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Adding...";
    }
    try {
      await accountService.createPaymentMethod({
        type,
        label: paymentTypeLabel(type),
        accountName: document.querySelector("#paymentAccountName").value,
        phoneNumber: ["cbe_bank", "bank_of_abyssinia", "awash_bank"].includes(type) ? "" : document.querySelector("#paymentPhone").value,
        accountNumber: ["cbe_bank", "bank_of_abyssinia", "awash_bank"].includes(type) ? document.querySelector("#paymentPhone").value : "",
        bankName: bankNameForPaymentType(type),
        isDefault: !(currentUser()?.paymentMethods || []).length,
      });
      showPaymentMethodForm = false;
      showToast("Payment method saved.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not save payment method.");
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  }
  async function handlePaymentDelete(paymentMethodId, button) {
    if (!paymentMethodId || !confirm("Remove this payment method?")) return;
    const originalText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Removing...";
    }
    try {
      await accountService.deletePaymentMethod(paymentMethodId);
      showToast("Payment method removed.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not remove payment method.");
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }
  async function handlePaymentDefault(paymentMethodId) {
    if (!paymentMethodId) return;
    try {
      await accountService.updatePaymentMethod(paymentMethodId, { isDefault: true });
      showToast("Default payment method updated.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not update payment method.");
    }
  }

  async function handleNotificationChange() {
    const prefs = {};
    document.querySelectorAll("[data-notification-key]").forEach((input) => {
      prefs[input.dataset.notificationKey] = input.checked;
    });
    try {
      await accountService.saveNotifications(prefs);
      showToast("Notification preference saved.");
    } catch (error) {
      showToast(error.message || "Could not save notification preference.");
    }
  }

  async function handleTradePreferencesSubmit(event) {
    event.preventDefault();
    const rails = document.querySelector("#preferredPaymentRails").value.split(",").map((item) => item.trim()).filter(Boolean);
    try {
      await accountService.saveTradePreferences({ preferredPaymentRails: rails });
      showToast("Trade preferences saved.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not save trade preferences.");
    }
  }

  function twoFactorDisabledBlock(hasPendingSetup = false) {
    return `
      <div class="settings-security-block">
        <p class="app-muted">${hasPendingSetup ? "Finish your pending 2FA setup when you are ready." : "Require an authenticator code for sign-ins, withdrawals, and sensitive account changes."}</p>
        <button class="settings-action success" type="button" id="startTwoFactorSetup">Enable 2FA</button>
      </div>
    `;
  }

  function twoFactorEnabledBlock() {
    return `
      <div class="settings-security-block">
        <p class="app-muted">2FA is active on this account. New sign-ins require a six-digit authenticator code.</p>
        ${showDisableTwoFactorForm ? `
          <div class="two-factor-disable-confirm">
            <label class="form-field compact"><span>Authenticator App</span><input id="disableTwoFactorCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="code" autofocus /></label>
            <div class="two-factor-secret-actions">
              <button class="settings-action danger" type="button" id="disableTwoFactor">Confirm disable</button>
              <button class="settings-action" type="button" id="cancelDisableTwoFactor">Cancel</button>
            </div>
          </div>
        ` : `<button class="settings-action danger" type="button" id="showDisableTwoFactorForm">Disable 2FA</button>`}
      </div>
    `;
  }

  function twoFactorSetupBlock(setup) {
    return `
      <div class="settings-security-block two-factor-setup-block">
        <p class="app-muted">Scan the QR code with your authenticator app, then enter the six-digit code it shows.</p>
        <div class="two-factor-setup-grid">
          <div class="two-factor-qr-card" aria-label="Authenticator setup QR code">
            ${twoFactorQrCodeSvg(setup.otpauthUri || "")}
          </div>
          <div class="two-factor-secret-panel">
            <span>Setup key</span>
            <code class="secret-code">${escapeHtml(setup.secret || "")}</code>
            <div class="two-factor-secret-actions">
              <button class="settings-action" type="button" id="copyTwoFactorSecret" data-secret="${escapeAttr(setup.secret || "")}">Copy key</button>
              <button class="settings-action warning" type="button" id="restartTwoFactorSetup">New key</button>
            </div>
          </div>
        </div>
        <div class="settings-form-grid compact-grid two-factor-confirm-grid">
          <label class="form-field"><span>Authenticator App</span><input id="confirmTwoFactorCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="code" /></label>
          <div class="settings-form-actions"><button class="app-button" type="button" id="confirmTwoFactor">Enable 2FA</button></div>
        </div>
      </div>
    `;
  }

  function twoFactorQrCodeSvg(value) {
    if (!value || typeof qrcode !== "function") return `<span class="qr-placeholder">QR</span>`;
    try {
      const qr = qrcode(0, "M");
      qr.addData(value);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 2, alt: "Authenticator setup QR code", title: "BRX 2FA setup" });
    } catch (error) {
      return `<span class="qr-placeholder">QR</span>`;
    }
  }

  function sessionRow(session) {
    const title = session.current ? "This device" : deviceLabel(session.userAgent);
    const state = session.active ? (session.current ? "Current" : "Active") : "Revoked";
    return `
      <div class="settings-row session-row">
        <span class="settings-row-icon">${icon("activity")}</span>
        <span class="settings-row-main"><strong>${escapeHtml(title)}</strong><small>Last seen ${dateTime(session.lastSeenAt)} - Created ${dateTime(session.createdAt)}</small></span>
        <span class="settings-row-aside session-actions">
          ${statusBadge(state, session.active ? "success" : "neutral")}
          ${!session.current && session.active ? `<button class="settings-action danger" type="button" data-session-revoke="${escapeAttr(session.id)}">Revoke</button>` : ""}
        </span>
      </div>
    `;
  }

  function withdrawalAddressRow(address) {
    return `
      <div class="settings-row withdrawal-address-row">
        <span class="settings-row-icon">${icon("wallet")}</span>
        <span class="settings-row-main"><strong>${escapeHtml(address.label)}</strong><small>${escapeHtml(address.network)} - ${escapeHtml(shortAddress(address.address))}</small></span>
        <span class="settings-row-aside payment-actions">
          ${address.isDefault ? statusBadge("Default", "success") : `<button class="settings-action" type="button" data-withdrawal-default="${escapeAttr(address.id)}">Make default</button>`}
          <button class="settings-action danger" type="button" data-withdrawal-delete="${escapeAttr(address.id)}">Remove</button>
        </span>
      </div>
    `;
  }

  function deviceLabel(userAgent) {
    const text = String(userAgent || "Unknown device");
    if (text.includes("Chrome")) return "Chrome browser";
    if (text.includes("Firefox")) return "Firefox browser";
    if (text.includes("Safari")) return "Safari browser";
    return text.slice(0, 80);
  }

  function dateTime(value) {
    if (!value) return "unknown";
    return new Date(value).toLocaleString();
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    const currentPassword = document.querySelector("#currentPassword").value;
    const newPassword = document.querySelector("#newPassword").value;
    const confirmPassword = document.querySelector("#confirmPassword").value;
    if (newPassword !== confirmPassword) return showToast("New passwords do not match.");
    try {
      await securityService.changePassword(currentPassword, newPassword);
      showToast("Password updated. Other sessions were revoked.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not update password.");
    }
  }

  async function handleWithdrawalAddressSubmit(event) {
    event.preventDefault();
    const twoFactorCode = requestAuthenticatorCode("Enter your authenticator code to save this withdrawal address.");
    if (!twoFactorCode) return;
    try {
      await accountService.createWithdrawalAddress({
        network: document.querySelector("#withdrawalNetwork").value,
        label: document.querySelector("#withdrawalLabel").value,
        address: document.querySelector("#withdrawalAddress").value,
        twoFactorCode,
        asset: "USDT",
        isDefault: document.querySelector("#withdrawalDefault").checked,
      });
      showToast("Withdrawal address saved.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not save withdrawal address.");
    }
  }

  async function handleWithdrawalDelete(addressId) {
    if (!addressId || !confirm("Remove this withdrawal address?")) return;
    try {
      await accountService.deleteWithdrawalAddress(addressId);
      showToast("Withdrawal address removed.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not remove withdrawal address.");
    }
  }

  async function handleWithdrawalDefault(addressId) {
    if (!addressId) return;
    const twoFactorCode = requestAuthenticatorCode("Enter your authenticator code to change the default withdrawal address.");
    if (!twoFactorCode) return;
    try {
      await accountService.updateWithdrawalAddress(addressId, { isDefault: true, twoFactorCode });
      showToast("Default withdrawal address updated.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not update withdrawal address.");
    }
  }

  async function handleRevokeSession(sessionId) {
    if (!sessionId || !confirm("Revoke this session?")) return;
    try {
      await securityService.revokeSession(sessionId);
      showToast("Session revoked.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not revoke session.");
    }
  }

  async function handleRevokeOtherSessions() {
    if (!confirm("Sign out all other devices?")) return;
    try {
      await securityService.revokeOtherSessions();
      showToast("Other sessions revoked.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not revoke sessions.");
    }
  }

  function handleShowDisableTwoFactorForm() {
    showDisableTwoFactorForm = true;
    renderSettings();
    setTimeout(() => document.querySelector("#disableTwoFactorCode")?.focus(), 0);
  }

  function handleCancelDisableTwoFactor() {
    showDisableTwoFactorForm = false;
    renderSettings();
  }

  async function handleStartTwoFactorSetup() {
    try {
      showDisableTwoFactorForm = false;
      const existingSetup = currentUser()?.security?.twoFactorSetup;
      if (existingSetup) {
        showTwoFactorSetupDetails = true;
        renderSettings();
        return;
      }
      showTwoFactorSetupDetails = true;
      await securityService.startTwoFactorSetup();
      showToast("Scan the QR code to finish enabling 2FA.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not start 2FA setup.");
    }
  }

  async function handleRestartTwoFactorSetup() {
    try {
      showDisableTwoFactorForm = false;
      showTwoFactorSetupDetails = true;
      await securityService.startTwoFactorSetup();
      showToast("New 2FA setup key created.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not create a new 2FA key.");
    }
  }

  async function handleCopyTwoFactorSecret(event) {
    const secret = event.currentTarget.dataset.secret || "";
    if (!secret) return showToast("No setup key to copy.");
    try {
      await navigator.clipboard?.writeText(secret);
      showToast("2FA setup key copied.");
    } catch (error) {
      showToast("Could not copy setup key.");
    }
  }

  async function handleConfirmTwoFactor() {
    try {
      await securityService.confirmTwoFactor(document.querySelector("#confirmTwoFactorCode").value);
      showDisableTwoFactorForm = false;
      showToast("2FA enabled.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not enable 2FA.");
    }
  }

  async function handleDisableTwoFactor() {
    try {
      const code = document.querySelector("#disableTwoFactorCode")?.value?.trim() || "";
      if (!/^\d{6}$/.test(code)) return showToast("Enter the six-digit authenticator code.");
      await securityService.disableTwoFactor(code);
      showDisableTwoFactorForm = false;
      showToast("2FA disabled.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not disable 2FA.");
    }
  }
  function settingsEmpty(iconName, title, detail) {
    return `<div class="settings-empty">${icon(iconName)}<strong>${title}</strong><span>${detail}</span></div>`;
  }

  function paymentMethodRow(method) {
    const typeLabel = paymentTypeLabel(method.type);
    const providerMark = ["cbe_birr", "cbe_bank"].includes(method.type) ? "CBE" : typeLabel.slice(0, 1).toUpperCase();
    return `
      <div class="payment-method-entry">
        <span class="payment-provider-mark ${escapeAttr(method.type)}">${escapeHtml(providerMark)}</span>
        <span class="settings-row-main"><strong>${escapeHtml(typeLabel)}</strong><small>${escapeHtml(method.phoneNumber || method.accountNumber || "Account details saved")}</small><small>${escapeHtml(method.accountName)}</small></span>
        <span class="settings-row-aside payment-actions">
          ${method.isDefault ? statusBadge("Default", "success") : `<button class="settings-action" type="button" data-payment-default="${escapeAttr(method.id)}">Make default</button>`}
          <button class="settings-action danger" type="button" data-payment-delete="${escapeAttr(method.id)}">Remove</button>
        </span>
      </div>
    `;
  }
  function enabledPaymentTypes(user) {
    const configured = user.platformSettings?.enabledPaymentMethodTypes;
    return Array.isArray(configured) && configured.length
      ? configured
      : ["telebirr", "mpesa", "cbe_birr", "cbe_bank", "bank_of_abyssinia", "awash_bank"];
  }

  function paymentTypeOptions(user) {
    return enabledPaymentTypes(user).map((type) => `<option value="${escapeAttr(type)}">${escapeHtml(paymentTypeLabel(type))}</option>`).join("");
  }
  function paymentTypeLabel(type) {
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
  function paymentMethodDetail(method) {
    if (["bank", "cbe_bank", "bank_of_abyssinia", "awash_bank"].includes(method.type)) return `${method.bankName || paymentTypeLabel(method.type)} - ${method.accountNumber || "account"} - ${method.accountName}`;
    return `${paymentTypeLabel(method.type)} - ${method.phoneNumber || "phone not set"} - ${method.accountName}`;
  }

  function bankNameForPaymentType(type) {
    if (type === "cbe_bank") return "CBE";
    if (type === "bank_of_abyssinia") return "Bank of Abyssinia";
    if (type === "awash_bank") return "Awash Bank";
    return "";
  }

  function accountDisplayName(user) {
    return user.fullName || user.username || displayName(user);
  }

  function traderDisplayName(user) {
    return user.username || brxId(user);
  }


  function profileAvatarMarkup(user, className, fallbackValue) {
    const initial = displayInitial(fallbackValue || accountDisplayName(user) || user?.email);
    const avatarUrl = String(user?.avatarUrl || "").trim();
    const baseAttrs = `data-avatar-preview data-avatar-initial="${escapeAttr(initial)}"`;
    if (avatarUrl) {
      return `<span class="${className} has-image" ${baseAttrs}><img src="${escapeAttr(avatarUrl)}" alt="" /></span>`;
    }
    return `<span class="${className}" ${baseAttrs}>${escapeHtml(initial)}</span>`;
  }
  function brxId(user) {
    const raw = String(user.backendUserId || user.id || user.email || "000000");
    let hash = 0;
    for (let index = 0; index < raw.length; index += 1) hash = ((hash * 31) + raw.charCodeAt(index)) >>> 0;
    return `Trader #${String(hash % 1000000).padStart(6, "0")}`;
  }

  function kycLabel(status) {
    if (status === "approved") return "Approved";
    if (status === "pending") return "Pending review";
    if (status === "rejected") return "Rejected";
    return "Not submitted";
  }

  function kycTier(user) {
    return user.kycStatus === "approved" ? "Level 1" : "Level 0";
  }

  function memberSince(user) {
    const date = user.createdAt ? new Date(user.createdAt) : new Date();
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function shortAddress(address) {
    return address.length > 14 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address;
  }

  function renderReferrals() {
    const user = requireUser();
    if (!user) return;
    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow">
        <div class="page-title"><div><p class="app-label blue">Refer & Earn</p><h2>Invite trusted traders</h2><p class="app-muted">Referral rewards can be connected after the launch reward rules are finalized.</p></div></div>
        <section class="app-card referral-card">
          <div>
            <span>Your referral code</span>
            <strong>BRX-${user.id.slice(0, 8).toUpperCase()}</strong>
          </div>
          <button class="app-button" type="button" id="copyReferralCode">Copy code</button>
        </section>
      </section>
    `;
    document.querySelector("#copyReferralCode").addEventListener("click", async () => {
      await navigator.clipboard?.writeText(`BRX-${user.id.slice(0, 8).toUpperCase()}`);
      showToast("Referral code copied.");
    });
  }

  function uploadField(id, label, required) {
    return `
      <label class="upload-field">
        <span>${label}</span>
        <input id="${id}" type="file" accept="image/*" ${required ? "required" : ""} />
        <small>${required ? "Required photo upload" : "Optional supporting image"}</small>
      </label>
    `;
  }

  function fileName(id) {
    const input = document.querySelector(`#${id}`);
    return input?.files?.[0]?.name || "";
  }

  async function handleKycSubmit(event) {
    event.preventDefault();
    showError("");
    const user = currentUser();
    if (!user) return;

    const name = document.querySelector("#kycName").value.trim();
    const phone = document.querySelector("#kycPhone").value.trim();
    const idType = document.querySelector("#kycIdType").value.trim();
    const idNumber = document.querySelector("#kycIdNumber").value.trim();
    const confirmed = document.querySelector("#kycConfirm").checked;

    if (!name || !phone || !idType || !idNumber) return showError("Fill in all identity details.");
    if (!fileName("kycFront") || !fileName("kycBack") || !fileName("kycSelfie")) return showError("Upload front ID, back ID, and selfie photos.");
    if (!confirmed) return showError("Confirm that the documents belong to you.");

    let result;
    try {
      result = await requestJson("/kyc/submissions", {
        method: "POST",
        body: JSON.stringify({
          fullName: name,
          phone,
          idType,
          idNumber,
          files: {
            documentFront: await filePayload("kycFront"),
            documentBack: await filePayload("kycBack"),
            selfie: await filePayload("kycSelfie"),
            paymentProof: await filePayload("kycPayment"),
          },
        }),
      });
    } catch (error) {
      return showError(error.message || "Could not submit KYC documents.");
    }

    const nextUsers = users();
    const userIndex = nextUsers.findIndex((item) => item.id === user.id);
    if (userIndex < 0) return showError("Session expired. Sign in again.");

    nextUsers[userIndex].kycStatus = result.user?.kycStatus || "pending";
    nextUsers[userIndex].kycSubmission = {
      name,
      phone,
      idType,
      idNumber,
      files: {
        frontId: result.submission?.documentFrontUrl || fileName("kycFront"),
        backId: result.submission?.documentBackUrl || fileName("kycBack"),
        selfie: result.submission?.selfieUrl || fileName("kycSelfie"),
        paymentProof: result.submission?.paymentProofUrl || fileName("kycPayment"),
      },
      submittedAt: new Date().toISOString(),
    };
    saveUsers(nextUsers);
    showToast("KYC submitted for manual review.");
    location.hash = "#/dashboard";
  }

  function filePayload(id, maxBytes = null) {
    const input = document.querySelector(`#${id}`);
    const file = input?.files?.[0];
    if (!file) return Promise.resolve(null);
    if (maxBytes && file.size > maxBytes) {
      return Promise.reject(new Error(`File must be under ${Math.floor(maxBytes / (1024 * 1024))} MB.`));
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        resolve({
          fileName: file.name,
          mimeType: file.type,
          dataBase64: dataUrl.split(",")[1] || "",
        });
      };
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
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

  function displayInitial(value) {
    return String(value || "B").slice(0, 1).toUpperCase();
  }

  window.BRX.pages.renderAds = renderAds;
  window.BRX.pages.renderTrades = renderTrades;
  window.BRX.pages.renderWallet = renderWallet;
  window.BRX.pages.renderKyc = renderKyc;
  window.BRX.pages.renderProfile = renderProfile;
  window.BRX.pages.renderNotifications = renderNotifications;
  window.BRX.pages.renderSettings = renderSettings;
  window.BRX.pages.renderReferrals = renderReferrals;
})();




















