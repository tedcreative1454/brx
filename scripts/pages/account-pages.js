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
  let offerRequirementsLoading = false;
  let adStatusFilter = "all";
  let lastMyOffers = [];
  let tradeCountdownTimer = null;
  let tradeChatTimer = null;
  let tradeChatLoading = false;
  let tradeChatSignature = "";
  let tradeStatusFilter = "all";
  let lastMyTrades = [];

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
        <div id="tradesContent"><section class="professional-loading-card"><span></span><div><strong>Loading ${tradeId ? "trade room" : "your trades"}</strong><small>Syncing with BRX escrow...</small></div></section></div>
      </section>
    `;
    if (tradeId) void loadTradeDetail(tradeId);
    else void loadMyTrades();
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
              ` : `<div class="offer-missing-method">${icon("info")}<div><strong>Payment method required</strong><span>Add Telebirr, M-Pesa, or CBE Birr before publishing an ad.</span></div><a href="#/settings?tab=payments">Add method</a></div>`}
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

  function tradeFilterButton(key, label, count) {
    return `<button class="${tradeStatusFilter === key ? "active" : ""}" type="button" data-trade-filter="${key}"><span>${label}</span><b>${count}</b></button>`;
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
    const counterparty = escapeHtml(trade.counterpartyEmail || "BRX user");
    const tone = trade.status === "released" ? "success" : trade.status === "disputed" ? "warning" : ["cancelled", "expired"].includes(trade.status) ? "danger" : "active";
    const nextStep = trade.status === "opened" && isBuyer ? "Payment required" : trade.status === "payment_sent" && trade.role === "seller" ? "Confirm payment" : statusLabel(trade.status);
    return `
      <article class="professional-trade-row ${tone}">
        <button class="trade-row-main" type="button" data-trade-open="${escapeAttr(trade.id)}">
          <span class="trade-direction ${isBuyer ? "buy" : "sell"}">${icon(isBuyer ? "buyArrow" : "sellArrow")}</span>
          <span class="trade-counterparty"><small>${roleText} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· #${shortTradeId(trade.id)}</small><strong>${counterparty}</strong><em>${dateTime(trade.createdAt)}</em></span>
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
              <p class="app-muted">${format(Number(trade.fiatAmount))} ETB ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${format(Number(trade.offerPrice || Number(trade.fiatAmount) / Number(trade.assetAmount)))} ETB/USDT</p>
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
    return `
      <section class="app-card dispute-panel">
        <div class="trade-detail-head">
          <div>
            <p class="app-label blue">${isOpen ? "Dispute evidence" : "Open dispute"}</p>
            <h3>${isOpen ? "Add supporting evidence" : "Report a problem"}</h3>
          </div>
          ${isOpen ? `<span class="status-pill warning">Admin review</span>` : ""}
        </div>
        ${evidenceList(trade.evidence || [])}
        <form class="evidence-form" id="evidenceForm">
          <label class="form-field wide"><span>${isOpen ? "Evidence note" : "Dispute reason"}</span><textarea id="evidenceNote" rows="4" placeholder="Explain what happened, payment reference, time, and any useful details."></textarea></label>
          <label class="form-field"><span>Payment reference</span><input id="evidenceReference" placeholder="M-Pesa code, bank ref, or note" /></label>
          <label class="form-field"><span>Screenshot or document</span><input id="evidenceFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" /></label>
          <div class="form-error" id="evidenceError"></div>
          <button class="${isOpen ? "app-button" : "danger-button"}" type="submit">${isOpen ? "Add evidence" : "Open dispute"}</button>
        </form>
      </section>
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
    const counterparty = trade.counterpartyEmail || (trade.role === "buyer" ? trade.sellerEmail : trade.buyerEmail) || "BRX user";
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
    return ["opened", "payment_sent"].includes(trade.status) && ["buyer", "seller"].includes(trade.role);
  }

  function disputeUnlockAt(trade) {
    const openedAt = trade.createdAt || trade.openedAt || trade.created_at;
    const openedMs = new Date(openedAt).getTime();
    const baseMs = Number.isFinite(openedMs) ? openedMs : Date.now();
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
            <strong>Appeal unlocks in <span id="appealCountdown">${timeLeft(disputeUnlockAt(trade))}</span></strong>
            <small>The dispute button appears after the payment window has had time to resolve normally.</small>
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
    const counterpartyEmail = String(trade.counterpartyEmail || "");
    const showCounterpartyEmail = counterpartyEmail && counterpartyEmail.toLowerCase() !== String(counterparty).toLowerCase();
    return `
      <section class="escrow-workspace">
        <header class="trade-room-header">
          <div class="trade-room-heading">
            <button class="trade-back-button" type="button" data-back-to-trades aria-label="Back to trades">&larr;</button>
            <div><span>Trade #${shortTradeId(trade.id)}</span><h2>${isBuyer ? "Buy" : "Sell"} USDT</h2></div>
          </div>
          <span class="status-pill trade-status ${trade.status === "disputed" ? "warning" : trade.status === "released" ? "success" : ""}">${statusLabel(trade.status)}</span>
        </header>

        <section class="escrow-grid">
          <article class="escrow-main">
            <section class="trade-amount-summary">
              <div class="trade-asset-total">
                <p class="app-label blue">${isBuyer ? "You are buying" : "You are selling"}</p>
                <h3>${format(Number(trade.assetAmount))} <span>USDT</span></h3>
              </div>
              <div class="trade-summary-metrics">
                <div><span>ETB total</span><strong>${format(Number(trade.fiatAmount))} ETB</strong></div>
                <div><span>Price</span><strong>${format(price)} ETB/USDT</strong></div>
              </div>
            </section>

            ${escrowStepper(trade)}
            ${isBuyer ? buyerPaymentBlock(trade, sellerMethods) : sellerPaymentBlock(trade)}
            ${countdownBlock(trade)}
            <div class="trade-actions-panel">${tradeActions(trade)}</div>
            ${tradeSafetyNote(trade)}
          </article>

          <aside class="escrow-side">
            <div class="counterparty-card">
              <div class="avatar small">${displayInitial(counterparty)}</div>
              <div><small>${isBuyer ? "Seller" : "Buyer"}</small><strong>${escapeHtml(counterparty)}</strong>${showCounterpartyEmail ? `<span>${escapeHtml(counterpartyEmail)}</span>` : ""}</div>
            </div>
            ${isBuyer ? "" : buyerPaymentSummary(trade)}
            ${tradeChatPanel(trade)}
          </aside>
        </section>
      </section>

      ${disputeAccessPanel(trade)}
    `;
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

    return `
      <section class="payment-instructions">
        <div>
          <p class="app-label">Pay seller outside BRX</p>
          <h4>${format(Number(trade.fiatAmount))} ETB</h4>
          <p class="app-muted">Use only the payment details shown here. BRX holds the seller USDT in escrow, but does not handle the ETB payment.</p>
        </div>
        <ol class="instruction-list">
          <li>Transfer exactly <strong>${format(Number(trade.fiatAmount))} ETB</strong> to the seller account below.</li>
          <li>Save a screenshot or receipt from your bank or mobile money app.</li>
          <li>Click <strong>Payment sent</strong> and upload the receipt or payment reference.</li>
          <li>Wait for the seller to confirm and release your USDT.</li>
        </ol>
        <div class="payment-method-list compact">
          ${sellerMethods.length ? sellerMethods.map(paymentMethodCard).join("") : `<div class="payment-method-card"><strong>Payment method pending</strong><small>Ask the seller to add a payment method before paying.</small></div>`}
        </div>
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
        <button class="copy-chip" type="button" data-copy-value="${escapeAttr(value)}">Copy</button>
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
            <textarea id="tradeChatInput" rows="2" maxlength="1000" placeholder="Message the ${trade.role === "buyer" ? "seller" : "buyer"}..." required></textarea>
            <button class="app-button" id="tradeChatSend" type="submit" aria-label="Send message">${icon("send")}<span>Send</span></button>
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
      const signature = messages.map((message) => `${message.id}:${message.isRead ? 1 : 0}`).join("|");
      if (signature !== tradeChatSignature) {
        tradeChatSignature = signature;
        container.innerHTML = messages.length
          ? messages.map(tradeChatMessage).join("")
          : `<div class="trade-chat-empty"><span>${icon("mail")}</span><strong>No messages yet</strong><small>Use this chat to coordinate payment safely.</small></div>`;
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
    const body = escapeHtml(message.body).replace(/\n/g, "<br>");
    return `
      <div class="trade-chat-message ${message.isMine ? "mine" : "theirs"}">
        <div class="trade-chat-bubble"><p>${body}</p></div>
        <small>${chatTime(message.createdAt)}${message.isMine && message.isRead ? " ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· Read" : ""}</small>
      </div>
    `;
  }

  async function handleTradeChatSubmit(event, trade) {
    event.preventDefault();
    const input = document.querySelector("#tradeChatInput");
    const button = document.querySelector("#tradeChatSend");
    const errorNode = document.querySelector("#tradeChatError");
    const body = input?.value.trim() || "";
    if (!body) return;

    if (errorNode) errorNode.textContent = "";
    if (button) button.disabled = true;
    try {
      await marketplace.sendTradeMessage(trade.id, body);
      input.value = "";
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
      return `<button class="app-button trade-primary-action" type="button" data-trade-id="${trade.id}" data-trade-action="payment-sent">I have paid ${format(Number(trade.fiatAmount))} ETB</button><button class="app-ghost-button trade-secondary-action" type="button" data-trade-id="${trade.id}" data-trade-action="cancel">Cancel trade</button>`;
    }
    if (trade.status === "payment_sent" && trade.role === "seller") {
      return `<button class="app-button trade-primary-action release" type="button" data-trade-id="${trade.id}" data-trade-action="release">Payment received &mdash; Release ${format(Number(trade.assetAmount))} USDT</button>${disputeButton}`;
    }
    if (trade.status === "payment_sent" && trade.role === "buyer") {
      return `<span class="trade-waiting-status">Payment submitted. Waiting for seller confirmation.</span>${disputeButton}`;
    }
    if (trade.status === "opened") {
      return `<button class="app-ghost-button trade-secondary-action" type="button" data-trade-id="${trade.id}" data-trade-action="cancel">Cancel trade</button>${disputeButton}`;
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
    const chatForm = document.querySelector("#tradeChatForm");
    const chatInput = document.querySelector("#tradeChatInput");
    chatForm?.addEventListener("submit", (event) => handleTradeChatSubmit(event, trade));
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
        <p class="app-muted">Submit your payment reference or receipt. False confirmations can lead to account suspension.</p>
        <label class="form-field"><span>Payment reference</span><input id="paymentReference" placeholder="Bank ref, mobile money code, or note" /></label>
        <label class="receipt-drop"><input id="paymentProofFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" /><strong>Upload receipt</strong><small>PNG, JPG, WEBP, or PDF up to 8 MB</small></label>
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
    const reference = form.querySelector("#paymentReference").value.trim();
    const selectedFile = form.querySelector("#paymentProofFile")?.files?.[0];
    errorNode.textContent = "";
    if (!reference && !selectedFile) {
      errorNode.textContent = "Add a payment reference or upload a receipt.";
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
      closeTradeModal();
      showToast("Payment proof submitted. The seller has been notified.");
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
    return trade.counterpartyName || trade.counterpartyEmail || "BRX user";
  }

  async function handleEvidenceSubmit(event, trade) {
    event.preventDefault();
    const errorBox = document.querySelector("#evidenceError");
    if (errorBox) errorBox.textContent = "";
    const note = document.querySelector("#evidenceNote").value.trim();
    const reference = document.querySelector("#evidenceReference").value.trim();
    const file = await filePayload("evidenceFile");
    const combinedNote = [note, reference ? `Payment reference: ${reference}` : ""].filter(Boolean).join("\n\n");

    if (!combinedNote && !file) {
      if (errorBox) errorBox.textContent = "Add a note, payment reference, or screenshot.";
      return;
    }

    try {
      if (trade.status === "disputed") {
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
    }
  }

  function startTradeCountdown(trade) {
    if (trade.status !== "opened" || !trade.expiresAt) return;
    const target = document.querySelector("#tradeCountdown");
    if (!target) return;
    const tick = () => {
      target.textContent = timeLeft(trade.expiresAt);
      if (new Date(trade.expiresAt).getTime() <= Date.now()) {
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

    const depositAddress = user.depositAddress || "";
    const balance = user.balance || window.BRX.profileService.emptyBalance();
    const available = Number(balance.available) || 0;
    const locked = Number(balance.locked) || 0;
    const pendingDeposit = Number(balance.pendingDeposit) || 0;
    const pendingWithdrawal = Number(balance.pendingWithdrawal) || 0;
    const total = available + locked + pendingDeposit + pendingWithdrawal;

    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow professional-wallet-page">

        <section class="professional-wallet-summary">
          <div class="wallet-total-block">
            <span class="wallet-summary-icon">${icon("wallet")}</span>
            <div><p>Total balance</p><h2>${format(total)} <span>USDT</span></h2><small>Available and escrow-held BRX funds</small></div>
          </div>
          <div class="professional-balance-grid">
            <div class="available"><span>Available</span><strong>${format(available)} <small>USDT</small></strong></div>
            <div class="locked"><span>In escrow</span><strong>${format(locked)} <small>USDT</small></strong></div>
            ${pendingDeposit > 0 ? `<div class="pending"><span>Pending deposit</span><strong>${format(pendingDeposit)} <small>USDT</small></strong></div>` : ""}
            ${pendingWithdrawal > 0 ? `<div class="pending"><span>Pending withdrawal</span><strong>${format(pendingWithdrawal)} <small>USDT</small></strong></div>` : ""}
          </div>
        </section>

        <nav class="professional-wallet-tabs" aria-label="Wallet action">
          <button class="${activeWalletMode === "deposit" ? "active" : ""}" type="button" data-wallet-mode="deposit">${icon("download")}<span><strong>Deposit</strong><small>Receive USDT</small></span></button>
          <button class="${activeWalletMode === "withdraw" ? "active" : ""}" type="button" data-wallet-mode="withdraw">${icon("upload")}<span><strong>Withdraw</strong><small>Send on-chain</small></span></button>
          <button class="${activeWalletMode === "transfer" ? "active" : ""}" type="button" data-wallet-mode="transfer">${icon("send")}<span><strong>Transfer</strong><small>BRX user transfer</small></span></button>
        </nav>

        <div class="professional-wallet-workspace">
          <div class="wallet-operation-panel">${walletModePanel(activeWalletMode, depositAddress, user)}</div>
          <aside class="wallet-activity-panel">
            <div class="wallet-activity-head"><div><p class="app-label">Recent activity</p><h3>Transactions</h3></div><span>${icon("activity")}</span></div>
            <div class="wallet-activity-empty">${icon("database")}<strong>No wallet activity yet</strong><p>Your confirmed deposits and withdrawals will appear here.</p></div>
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
      document.querySelector("#withdrawForm")?.addEventListener("submit", handleWithdrawalSubmit);
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
    return `
      <section class="wallet-panel deposit-network-sheet">
          <div class="sheet-head">
            <div>
              <p class="app-label blue">Deposit network</p>
              <h2>Choose Network</h2>
            </div>
            <span class="sheet-badge">USDT</span>
          </div>

          ${networkSelector("deposit", selectedNetwork)}
          ${selected && selected.status !== "available" ? `<p class="deposit-note">${escapeHtml(selected.name)} deposits are not enabled yet. Choose BNB Smart Chain for live deposits.</p>` : ""}
          ${selectedNetwork === "BEP20" ? `
            <section class="deposit-address-card deposit-address-detail ${depositAddress ? "" : "pending"}">
              <div class="deposit-qr-card" aria-label="BEP20 deposit address QR code">
                ${depositAddress ? qrCodeSvg(depositAddress) : `<span class="qr-placeholder">QR</span>`}
              </div>
              <div class="deposit-address-main">
                <span>BNB Smart Chain deposit address</span>
                <strong>${escapeHtml(addressLabel)}</strong>
                <small>Network: USDT BEP20. Do not send TRC20, ERC20, or any other network to this address.</small>
              </div>
              <button class="app-button small" id="copyDepositAddress" type="button" ${depositAddress ? "" : "disabled"}>${depositAddress ? "Copy" : "Pending"}</button>
            </section>

            <p class="deposit-note">Send USDT on BNB Smart Chain BEP20 to your assigned address. Deposits are credited to your internal BRX balance after confirmations.</p>
          ` : ""}
      </section>
    `;
  }

  function withdrawPanel(user) {
    const selectedNetwork = selectedWalletNetwork.withdraw;
    const selected = NETWORKS.find((network) => network.id === selectedNetwork);
    const addresses = selectedNetwork
      ? (user.withdrawalAddresses || []).filter((address) => address.isActive !== false && address.network === selectedNetwork)
      : [];
    const defaultAddress = addresses.find((address) => address.isDefault) || addresses[0];
    return `
      <section class="wallet-panel wallet-form-panel">
        <div class="sheet-head">
          <div>
            <p class="app-label blue">Withdraw USDT</p>
            <h2>Choose Network</h2>
          </div>
          <span class="sheet-badge">USDT</span>
        </div>
        ${networkSelector("withdraw", selectedNetwork)}
        ${!selected ? `<p class="network-helper">Choose BNB Smart Chain for BEP20 withdrawals. TRON withdrawals will be added later.</p>` : ""}
        ${selected && selected.status !== "available" ? `<p class="deposit-note">${escapeHtml(selected.name)} withdrawals are not enabled yet. Choose BNB Smart Chain for live withdrawals.</p>` : ""}
        ${selectedNetwork === "BEP20" ? `
          <form class="wallet-action-form" id="withdrawForm">
            ${addresses.length ? `
              <label class="form-field"><span>Saved BEP20 address</span><select id="withdrawAddressId" required>
                ${addresses.map((address) => `<option value="${escapeAttr(address.id)}" ${defaultAddress?.id === address.id ? "selected" : ""}>${escapeHtml(address.label || "BEP20 wallet")} - ${escapeHtml(shortAddress(address.address))}</option>`).join("")}
              </select></label>
            ` : `
              <section class="deposit-address-card pending"><div><span>No saved withdrawal address</span><strong>Add a BEP20 address first</strong><small>Open Settings > Addresses and save a wallet you control.</small></div><a class="app-button small" href="#/settings?tab=addresses">Add address</a></section>
            `}
            <label class="form-field"><span>Amount</span><input id="withdrawAmount" inputmode="decimal" placeholder="0.00" required /></label>
            <label class="form-field"><span>Authenticator code</span><input id="withdrawTwoFactor" inputmode="numeric" maxlength="6" placeholder="123456" required /></label>
            <p class="deposit-note">Only available balance can be withdrawn. Escrow-locked funds stay locked. Withdrawals require 2FA and are paused for 24 hours after a password change.</p>
            <button class="app-button" type="submit" ${addresses.length ? "" : "disabled"}>Request withdrawal</button>
          </form>
        ` : ""}
      </section>
    `;
  }

  function transferPanel() {
    return `
      <section class="wallet-panel wallet-form-panel internal-transfer-panel">
        <div class="sheet-head">
          <div><p class="app-label blue">Internal transfer</p><h2>Send BRX to BRX</h2></div>
          <span class="sheet-badge">USDT</span>
        </div>
        <div class="wallet-feature-preview">
          <span>${icon("send")}</span>
          <div><h3>Move USDT through the BRX ledger</h3><p>Send available USDT to another BRX user by email or username. Internal transfers are instant and do not use the blockchain network.</p></div>
        </div>
        <form class="wallet-action-form" id="internalTransferForm">
          <label class="form-field"><span>Recipient email or username</span><input id="transferRecipient" autocomplete="off" placeholder="trader@example.com" required /></label>
          <label class="form-field"><span>Amount</span><input id="transferAmount" inputmode="decimal" placeholder="0.00" required /></label>
          <label class="form-field"><span>Note optional</span><input id="transferNote" maxlength="180" placeholder="Payment note" /></label>
          <p class="deposit-note">Only available USDT can be transferred. Escrow, pending deposits, and pending withdrawals are not spendable.</p>
          <button class="app-button" type="submit">Send internal transfer</button>
        </form>
      </section>
    `;
  }

  function networkSelector(mode, selectedNetwork) {
    return `
      <div class="network-choice-list wallet-network-grid">
        ${NETWORKS.map((network) => `
          <button class="deposit-network-card wallet-network-card ${selectedNetwork === network.id ? "active" : ""} ${network.status === "available" ? "" : "muted"}" type="button" data-network-select="${network.id}">
            <span class="network-mark ${network.id === "BEP20" ? "bsc" : "tron"}">${network.mark}</span>
            <div>
              <strong>${network.name}</strong>
              <small>${network.id === "BEP20" ? "Live network for BRX deposits and withdrawals" : "Future network - not active yet"}</small>
              <small>${network.token}</small>
              <small>${network.confirmations}</small>
              <small>${network.minDeposit}</small>
              <small>${network.arrival}</small>
            </div>
            <span class="network-status ${network.status === "available" ? "live" : "soon"}">${selectedNetwork === network.id ? "Selected" : network.status === "available" ? "Choose BNB" : "Coming soon"}</span>
          </button>
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
      showToast(`Sent ${format(Number(result.transfer?.amount || 0))} USDT to ${result.transfer?.recipientEmail || "BRX user"}.`);
      renderWallet();
    } catch (error) {
      showToast(error.message || "Could not send internal transfer.");
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  }

  async function handleWithdrawalSubmit(event) {
    event.preventDefault();
    const withdrawalAddressId = document.querySelector("#withdrawAddressId")?.value;
    const amount = document.querySelector("#withdrawAmount")?.value;
    const twoFactorCode = document.querySelector("#withdrawTwoFactor")?.value;
    if (!withdrawalAddressId) return showToast("Save a BEP20 withdrawal address first.");
    try {
      const result = await accountService.requestWithdrawal({ withdrawalAddressId, amount, twoFactorCode, network: "BEP20", asset: "USDT" });
      const user = currentUser();
      if (user && result.balance) {
        saveUsers(users().map((item) => item.id === user.id ? { ...item, balance: result.balance } : item));
      }
      showToast("Withdrawal approved and queued for BEP20 broadcast.");
      renderWallet();
    } catch (error) {
      showToast(error.message || "Could not request withdrawal.");
    }
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
    refs.app.innerHTML = `
      <section class="exchange-app app-page-wide profile-page professional-profile-page">
        <section class="profile-summary-card settings-identity profile-view-identity">
          <div class="settings-avatar-wrap profile-summary-avatar">
            ${profileAvatarMarkup(user, "settings-avatar", user.email)}
          </div>
          <div class="profile-summary-main">
            <p class="app-label blue">Profile</p>
            <h1>${escapeHtml(accountDisplayName(user))}</h1>
            <div class="profile-summary-meta">
              <span>${escapeHtml(user.email)}</span>
              <span>${brxId(user)}</span>
              <span>${kycLabel(user.kycStatus)}</span>
            </div>
          </div>
          <a class="app-button" href="#/settings?tab=profile">Edit profile ${icon("external")}</a>
        </section>

        <section class="settings-card settings-card-flat profile-view-card">
          ${settingsRow("mail", "Email", escapeHtml(user.email), user.emailVerified ? statusBadge("Verified", "success") : statusBadge("Not verified", "warning"))}
          ${settingsRow("user", "Trader username", escapeHtml(user.username || displayName(user)), "")}
          ${settingsRow("phone", "Phone number", escapeHtml(user.phone || "Not added"), "")}
          ${settingsRow("shield", "KYC status", kycLabel(user.kycStatus), statusBadge(kycTier(user), "neutral"))}
          ${settingsRow("calendar", "Member since", memberSince(user), "")}
        </section>
      </section>
    `;
  }
  function renderSettings() {
    const user = requireUser();
    if (!user) return;
    const activeTab = validSettingsTab(window.BRX.router.routeParams().get("tab"));
    const tabTitle = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);
    refs.app.innerHTML = `
      <section class="exchange-app app-page-wide settings-page professional-settings-page">
        <header class="professional-settings-head">
          <div class="professional-settings-person">
            ${profileAvatarMarkup(user, "settings-head-avatar", user.email)}
            <div><p class="app-label blue">Account center</p><h1>Settings</h1><small>${escapeHtml(accountDisplayName(user))} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${escapeHtml(user.email)}</small></div>
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
    return ["profile", "security", "payments", "addresses", "account", "notifications", "trades"].includes(tab) ? tab : "profile";
  }

  function settingsTabs(activeTab) {
    const tabs = [
      ["profile", "user", "Profile", "Personal details"],
      ["security", "shield", "Security", "2FA and sessions"],
      ["payments", "card", "Payments", "ETB receiving accounts"],
      ["addresses", "mapPin", "Addresses", "Withdrawal destinations"],
      ["account", "settings", "Account", "Status and access"],
      ["notifications", "bell", "Notifications", "Alert preferences"],
      ["trades", "trades", "Trading", "P2P preferences"],
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
    if (tab === "trades") return settingsTrades(user);
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
          <h3>${escapeHtml(accountDisplayName(user))}</h3>
          <small>${escapeHtml(user.email)}</small>
          <span class="settings-muted">${brxId(user)} <button class="inline-icon-button settings-copy-id" type="button" title="Copy BRX ID">${icon("copy")}</button></span>
          <input id="settingsAvatarUrl" type="hidden" value="${escapeAttr(user.avatarUrl || "")}" />
          <div class="settings-avatar-actions">
            <label class="settings-avatar-upload" for="settingsAvatarInput">${icon("camera")}<span>Upload photo</span><input id="settingsAvatarInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
            ${user.avatarUrl ? `<button class="settings-avatar-remove" id="settingsAvatarRemove" type="button">Remove</button>` : ""}
          </div>
          <small class="settings-avatar-help">PNG, JPG, WebP, or GIF up to 512 KB. Uploads save automatically.</small>
        </div>
      </section>

      <section class="settings-card settings-card-flat settings-profile-facts">
        ${settingsRow("mail", "Email", escapeHtml(user.email), user.emailVerified ? statusBadge("Verified", "success") : statusBadge("Not verified", "warning"))}
        ${settingsRow("user", "Trader username", escapeHtml(user.username || displayName(user)), "")}
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
        ${setup ? twoFactorSetupBlock(setup) : twoFactor.enabled ? twoFactorEnabledBlock() : twoFactorDisabledBlock()}
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
                <option value="">Select mobile money method</option>
                <option value="telebirr">Telebirr</option>
                <option value="mpesa">M-Pesa</option>
                <option value="cbe_birr">CBE Birr</option>
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
              <span>Add a mobile money account (Telebirr, M-Pesa, or CBE Birr) to start trading.</span>
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
            <label class="form-field"><span>Authenticator code</span><input id="withdrawalAddressTwoFactor" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456" required /></label>
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
        ${settingsRow("trades", "Escrow network", "BRX internal ledger ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· BEP20 wallet settlement", "")}
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
            <label class="form-field"><span>Preferred payment rails</span><input id="preferredPaymentRails" value="${escapeAttr(rails.join(", "))}" placeholder="Telebirr, M-Pesa, CBE Birr" /></label>
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
    document.querySelector("#confirmTwoFactor")?.addEventListener("click", handleConfirmTwoFactor);
    document.querySelector("#disableTwoFactor")?.addEventListener("click", handleDisableTwoFactor);
    document.querySelector("#revokeOtherSessions")?.addEventListener("click", handleRevokeOtherSessions);

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

    document.querySelector(".settings-copy-id")?.addEventListener("click", async () => {
      const user = currentUser();
      if (!user) return;
      await navigator.clipboard?.writeText(brxId(user));
      showToast("BRX ID copied.");
    });
  }

  async function handleSettingsProfileSubmit(event) {
    event.preventDefault();
    try {
      await accountService.saveProfile({
        fullName: document.querySelector("#settingsFullName").value,
        phone: document.querySelector("#settingsPhone").value,
        username: document.querySelector("#settingsUsername").value,
        avatarUrl: document.querySelector("#settingsAvatarUrl")?.value || "",
      });
      showToast("Profile saved.");
      renderSettings();
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
    if (file.size > 512 * 1024) return Promise.reject(new Error("Profile image must be 512 KB or smaller."));
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
    const placeholders = {
      telebirr: "+251 9XX XXX XXX",
      mpesa: "+251 7XX XXX XXX",
      cbe_birr: "+251 9XX XXX XXX",
    };
    phoneInput.placeholder = placeholders[type] || "+251 9XX XXX XXX";
  }

  async function handlePaymentMethodSubmit(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const type = document.querySelector("#paymentType")?.value || "";
    if (!type) return showToast("Select Telebirr, M-Pesa, or CBE Birr.");
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
        phoneNumber: document.querySelector("#paymentPhone").value,
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

  function twoFactorDisabledBlock() {
    return `
      <div class="settings-security-block">
        <p class="app-muted">Add 2FA before launch so sign-ins and withdrawals can require an authenticator code.</p>
        <button class="settings-action success" type="button" id="startTwoFactorSetup">Set up 2FA</button>
      </div>
    `;
  }

  function twoFactorEnabledBlock() {
    return `
      <div class="settings-security-block">
        <p class="app-muted">2FA is active on this account. New sign-ins require a six-digit authenticator code.</p>
        <label class="form-field compact"><span>Authenticator code</span><input id="disableTwoFactorCode" inputmode="numeric" maxlength="6" placeholder="123456" /></label>
        <button class="settings-action danger" type="button" id="disableTwoFactor">Disable 2FA</button>
      </div>
    `;
  }

  function twoFactorSetupBlock(setup) {
    return `
      <div class="settings-security-block">
        <p class="app-muted">Add this secret to your authenticator app, then enter the six-digit code it shows.</p>
        <code class="secret-code">${escapeHtml(setup.secret || "")}</code>
        <small class="app-muted">Manual setup URI: ${escapeHtml(setup.otpauthUri || "")}</small>
        <div class="settings-form-grid compact-grid">
          <label class="form-field"><span>Authenticator code</span><input id="confirmTwoFactorCode" inputmode="numeric" maxlength="6" placeholder="123456" /></label>
          <div class="settings-form-actions"><button class="app-button" type="button" id="confirmTwoFactor">Enable 2FA</button></div>
        </div>
      </div>
    `;
  }

  function sessionRow(session) {
    const title = session.current ? "This device" : deviceLabel(session.userAgent);
    const state = session.active ? (session.current ? "Current" : "Active") : "Revoked";
    return `
      <div class="settings-row session-row">
        <span class="settings-row-icon">${icon("activity")}</span>
        <span class="settings-row-main"><strong>${escapeHtml(title)}</strong><small>Last seen ${dateTime(session.lastSeenAt)} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· Created ${dateTime(session.createdAt)}</small></span>
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
        <span class="settings-row-main"><strong>${escapeHtml(address.label)}</strong><small>${escapeHtml(address.network)} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${escapeHtml(shortAddress(address.address))}</small></span>
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
    try {
      await accountService.createWithdrawalAddress({
        network: document.querySelector("#withdrawalNetwork").value,
        label: document.querySelector("#withdrawalLabel").value,
        address: document.querySelector("#withdrawalAddress").value,
        twoFactorCode: document.querySelector("#withdrawalAddressTwoFactor").value.trim(),
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
    const twoFactorCode = prompt("Enter your six-digit authenticator code to change the default withdrawal address.");
    if (!twoFactorCode) return;
    try {
      await accountService.updateWithdrawalAddress(addressId, { isDefault: true, twoFactorCode: twoFactorCode.trim() });
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

  async function handleStartTwoFactorSetup() {
    try {
      await securityService.startTwoFactorSetup();
      showToast("2FA setup started.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not start 2FA setup.");
    }
  }

  async function handleConfirmTwoFactor() {
    try {
      await securityService.confirmTwoFactor(document.querySelector("#confirmTwoFactorCode").value);
      showToast("2FA enabled.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not enable 2FA.");
    }
  }

  async function handleDisableTwoFactor() {
    if (!confirm("Disable two-factor authentication?")) return;
    try {
      await securityService.disableTwoFactor(document.querySelector("#disableTwoFactorCode").value);
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
    const providerMark = method.type === "cbe_birr" ? "CBE" : typeLabel.slice(0, 1).toUpperCase();
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
  function paymentTypeLabel(type) {
    if (type === "telebirr") return "Telebirr";
    if (type === "mpesa") return "M-Pesa";
    if (type === "cbe_birr") return "CBE Birr";
    if (type === "airtel_money") return "Airtel Money";
    if (type === "bank") return "Bank transfer";
    return "Other";
  }
  function paymentMethodDetail(method) {
    if (method.type === "bank") return `${method.bankName || "Bank"} - ${method.accountNumber || "account"} - ${method.accountName}`;
    return `${paymentTypeLabel(method.type)} - ${method.phoneNumber || "phone not set"} - ${method.accountName}`;
  }

  function accountDisplayName(user) {
    return user.fullName || user.username || displayName(user);
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
    return `BRX-${String(user.backendUserId || user.id || "000000").replace(/-/g, "").slice(0, 6).toUpperCase().padEnd(6, "0")}`;
  }

  function kycLabel(status) {
    if (status === "approved") return "Approved";
    if (status === "pending") return "Pending review";
    if (status === "rejected") return "Rejected";
    return "Not submitted";
  }

  function kycTier(user) {
    return user.kycStatus === "approved" ? "Tier 1" : "Tier 0";
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




















