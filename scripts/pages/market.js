(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { RATE } = window.BRX.config;
  const { requireUser } = window.BRX.state;
  const { refs, showError, showToast } = window.BRX.ui;
  const { format } = window.BRX.utils;
  const marketplace = window.BRX.marketplaceService;

  let marketMode = "buy";
  let selectedOffer = null;
  let lastOffers = [];
  let amountFilter = "";
  let paymentFilter = "";
  let activeFilter = "";
  let selectedPaymentMethod = "";

  function renderMarket() {
    const user = requireUser();
    if (!user) return;

    refs.app.innerHTML = `
      <section class="exchange-app market-app app-page-wide">
        <div class="market-head">
          <div class="segmented app-tabs market-tabs ${marketMode}" role="tablist">
            <button class="${marketMode === "buy" ? "active" : ""}" type="button" data-market-mode="buy">Buy</button>
            <button class="${marketMode === "sell" ? "active" : ""}" type="button" data-market-mode="sell">Sell</button>
          </div>
          <div class="market-rate"><strong>${format(RATE)}</strong><span>ETB / USDT index</span></div>
        </div>
        <div id="marketContent">
          <section class="market-empty-state"><span class="mini-icon">...</span><h3>Loading market</h3></section>
        </div>
      </section>
    `;

    document.querySelectorAll("[data-market-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        marketMode = button.dataset.marketMode;
        selectedOffer = null;
        selectedPaymentMethod = "";
        activeFilter = "";
        renderMarket();
      });
    });

    void loadMarketOffers();
  }

  async function loadMarketOffers() {
    try {
      const offerSide = marketMode === "buy" ? "sell" : "buy";
      const result = await marketplace.listOffers(offerSide);
      lastOffers = result.offers || [];
      renderMarketContent();
    } catch (error) {
      document.querySelector("#marketContent").innerHTML = `
        <section class="warning-card market-warning"><h3>Market API unavailable</h3><p>${escapeHtml(error.message || "Start the BRX backend and reload the market.")}</p></section>
      `;
    }
  }

  function renderMarketContent() {
    const content = document.querySelector("#marketContent");
    const action = marketMode === "buy" ? "Buy" : "Sell";
    const filteredOffers = filteredMarketOffers();
    const methods = paymentMethods();
    const hasFilters = Boolean(amountFilter || paymentFilter);
    const emptyTitle = lastOffers.length && !filteredOffers.length
      ? "No offers match your filters"
      : `No active ${marketMode} offers`;
    const emptyCopy = lastOffers.length && !filteredOffers.length
      ? "Adjust the ETB amount or payment method."
      : "Create the first ad from My Ads.";

    content.innerHTML = `
      <div class="filter-row market-filter-row ${hasFilters ? "has-clear" : ""}">
        <button class="filter-chip active" type="button" data-clear-filters>USDT</button>
        ${amountControl()}
        ${paymentControl(methods)}
        ${hasFilters ? `<button class="filter-chip clear" type="button" data-clear-filters>Clear</button>` : ""}
      </div>

      <p class="app-muted market-count">${filteredOffers.length} active ${marketMode === "buy" ? "sell" : "buy"} ads</p>
      ${
        filteredOffers.length
          ? `<div class="app-table">
              <div class="table-row table-head"><span>Advertiser</span><span>Price</span><span>Available - Limit</span><span>Payment</span><span></span></div>
              ${filteredOffers.map((offer) => marketRow(offer, action)).join("")}
            </div>`
          : `<section class="market-empty-state"><span class="mini-icon">Ad</span><h3>${emptyTitle}</h3><p>${emptyCopy}</p>${lastOffers.length ? `<button class="app-button small" type="button" data-clear-filters>Clear filters</button>` : `<a class="app-button small" href="#/ads">Post an Ad</a>`}</section>`
      }
      ${selectedOffer ? orderModal(selectedOffer, action) : ""}
    `;

    document.querySelectorAll("[data-filter-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.filterToggle === "payment" && !methods.length) {
          return showToast("No payment methods available yet.");
        }
        activeFilter = activeFilter === button.dataset.filterToggle ? "" : button.dataset.filterToggle;
        renderMarketContent();
      });
    });

    document.querySelectorAll("[data-clear-filters]").forEach((button) => {
      button.addEventListener("click", () => {
        amountFilter = "";
        paymentFilter = "";
        activeFilter = "";
        selectedOffer = null;
        selectedPaymentMethod = "";
        renderMarketContent();
      });
    });

    const amountForm = document.querySelector("#amountFilterForm");
    if (amountForm) {
      const input = document.querySelector("#amountFilterInput");
      input.focus();
      input.select();
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          activeFilter = "";
          renderMarketContent();
        }
      });
      amountForm.addEventListener("submit", handleAmountFilter);
    }

    const paymentSelect = document.querySelector("#paymentFilterSelect");
    if (paymentSelect) {
      paymentSelect.focus();
      paymentSelect.addEventListener("change", () => {
        paymentFilter = paymentSelect.value;
        activeFilter = "";
        selectedOffer = null;
        selectedPaymentMethod = "";
        renderMarketContent();
      });
      paymentSelect.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          activeFilter = "";
          renderMarketContent();
        }
      });
    }

    document.querySelectorAll("[data-select-offer]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedOffer = filteredOffers.find((offer) => offer.id === button.dataset.selectOffer);
        selectedPaymentMethod = selectedOffer?.paymentMethods?.[0] || "";
        activeFilter = "";
        renderMarketContent();
      });
    });

    if (selectedOffer) bindOrderModal(selectedOffer, action);
  }

  function amountControl() {
    if (activeFilter === "amount") {
      return `
        <form class="filter-chip filter-input-chip amount-filter ${amountFilter ? "has-value" : ""}" id="amountFilterForm">
          <input id="amountFilterInput" inputmode="decimal" placeholder="ETB amount" value="${escapeHtml(amountFilter)}" aria-label="ETB amount" />
          <button type="submit">OK</button>
        </form>
      `;
    }

    return `<button class="filter-chip ${amountFilter ? "has-value" : ""}" type="button" data-filter-toggle="amount" aria-expanded="false">${amountFilter ? `${format(Number(amountFilter))} ETB` : "ETB amount"}</button>`;
  }

  function paymentControl(methods) {
    if (activeFilter === "payment" && methods.length) {
      return `
        <form class="filter-chip filter-input-chip wide payment-filter">
          <select id="paymentFilterSelect" aria-label="Payment method">
            <option value="">Payment method</option>
            ${methods.map((method) => `<option value="${escapeHtml(method)}" ${paymentFilter === method ? "selected" : ""}>${escapeHtml(method)}</option>`).join("")}
          </select>
        </form>
      `;
    }

    return `<button class="filter-chip wide ${paymentFilter ? "has-value" : ""}" type="button" data-filter-toggle="payment" aria-expanded="false">${paymentFilter || "Payment method"}</button>`;
  }

  function handleAmountFilter(event) {
    event.preventDefault();
    const input = document.querySelector("#amountFilterInput");
    const cleaned = input.value.trim().replace(/,/g, "");

    if (!cleaned) {
      amountFilter = "";
      activeFilter = "";
      selectedOffer = null;
      selectedPaymentMethod = "";
      return renderMarketContent();
    }

    const value = Number(cleaned);
    if (!Number.isFinite(value) || value <= 0) {
      return showToast("Enter a valid ETB amount.");
    }

    amountFilter = String(value);
    activeFilter = "";
    selectedOffer = null;
    selectedPaymentMethod = "";
    renderMarketContent();
  }

  function marketRow(offer, action) {
    const available = Number(offer.availableAmount);
    const price = Number(offer.price);
    const maxUsdt = Math.min(available, Number(offer.maxFiat) / price);
    return `
      <div class="table-row">
        <div class="trader-cell"><span>${initials(offer.advertiser)}</span><div><strong>${escapeHtml(offer.advertiser)}</strong><small>${offer.completedTrades || 0} completed trades</small></div></div>
        <strong class="table-price ${action === "Sell" ? "sell-price" : ""}">${format(price)}</strong>
        <div><strong>${format(available)} USDT</strong><small>${format(Number(offer.minFiat))}-${format(Number(offer.maxFiat))} ETB</small><small>Max ${format(maxUsdt)} USDT</small></div>
        <div class="chips">${offer.paymentMethods.map((method) => `<span>${escapeHtml(method)}</span>`).join("")}</div>
        <button class="app-button ${action.toLowerCase()}-button" type="button" data-select-offer="${offer.id}">${action}</button>
      </div>
    `;
  }

  function orderModal(offer, action) {
    const price = Number(offer.price);
    const min = Number(offer.minFiat);
    const max = Number(offer.maxFiat);
    const available = Number(offer.availableAmount);
    const maxByAvailable = Math.min(max, available * price);
    const paymentMethods = offer.paymentMethods || [];
    if (!selectedPaymentMethod && paymentMethods.length) selectedPaymentMethod = paymentMethods[0];
    const defaultFiat = amountFilter ? Number(amountFilter) : min;
    const safeFiat = Math.min(Math.max(Number.isFinite(defaultFiat) ? defaultFiat : min, min), maxByAvailable);
    const side = action.toLowerCase();
    const traderRole = action === "Buy" ? "Seller" : "Buyer";
    const completion = Number(offer.completionRate || offer.completion || 100);

    return `
      <section class="order-modal-backdrop" id="orderModalBackdrop" role="dialog" aria-modal="true" aria-labelledby="orderModalTitle">
        <article class="order-modal order-ticket-modal ${side}">
          <header class="order-modal-head">
            <div>
              <h3 id="orderModalTitle">${action} USDT</h3>
              <p><strong>${format(price)}</strong> ETB / USDT</p>
            </div>
            <button class="icon-button" type="button" data-close-order aria-label="Close order">&times;</button>
          </header>

          <div class="order-ticket-summary">
            <div>
              <span>Available</span>
              <strong>${format(available)} USDT</strong>
            </div>
            <div>
              <span>Order limit</span>
              <strong>${format(min)}-${format(maxByAvailable)} ETB</strong>
            </div>
          </div>

          <div class="order-modal-body">
            <div class="order-trader">
              <span class="trader-avatar">${initials(offer.advertiser)}</span>
              <div>
                <strong>${escapeHtml(offer.advertiser)}</strong>
                <small>${escapeHtml(traderRole)} &middot; ${format(completion)}% completion &middot; ${offer.completedTrades || 0} trades</small>
              </div>
            </div>

            <div class="order-section">
              <span class="order-label">Payment method</span>
              ${
                paymentMethods.length
                  ? `<div class="order-methods selectable">${paymentMethods.map((method) => `<button class="${selectedPaymentMethod === method ? "active" : ""}" type="button" data-order-method="${escapeHtml(method)}"><span></span>${escapeHtml(method)}</button>`).join("")}</div>`
                  : `<div class="order-warning">This advertiser has no active payment method. Choose another offer.</div>`
              }
            </div>

            <form id="orderForm" class="order-form">
              <label class="order-input-label" for="orderFiatAmount">
                <span>${action === "Buy" ? "You pay" : "You receive"} (ETB)</span>
                <small>Limit ${format(min)}-${format(maxByAvailable)} ETB</small>
              </label>
              <div class="order-input-row">
                <input id="orderFiatAmount" inputmode="decimal" value="${format(safeFiat).replace(/,/g, "")}" />
                <span>ETB</span>
                <button type="button" data-order-max>Max</button>
              </div>
              <div class="order-quote">
                <div><span>${action === "Buy" ? "You pay" : "Buyer pays"}</span><strong id="orderFiatPreview">${format(safeFiat)} ETB</strong></div>
                <span class="order-arrow">-></span>
                <div><span>${action === "Buy" ? "You get" : "You sell"}</span><strong id="orderUsdtPreview">${format(safeFiat / price)} USDT</strong></div>
              </div>
              <div class="order-escrow-note">
                <strong>Escrow protected</strong>
                <span>BRX locks seller USDT before the trade opens. ETB is paid directly to the seller, then USDT releases after confirmation.</span>
              </div>
              <div class="form-error" id="orderError"></div>
            </form>
          </div>
          <footer class="order-modal-footer">
            <button class="app-button ${action.toLowerCase()}-button" id="orderSubmit" type="submit" form="orderForm" ${paymentMethods.length ? "" : "disabled"}>Confirm ${action}</button>
          </footer>
        </article>
      </section>
    `;
  }

  function bindOrderModal(offer, action) {
    const modal = document.querySelector("#orderModalBackdrop");
    const input = document.querySelector("#orderFiatAmount");
    const maxButton = document.querySelector("[data-order-max]");
    const form = document.querySelector("#orderForm");
    const close = () => {
      selectedOffer = null;
      selectedPaymentMethod = "";
      renderMarketContent();
    };

    document.querySelectorAll("[data-close-order]").forEach((button) => button.addEventListener("click", close));
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
    document.addEventListener("keydown", function onEscape(event) {
      if (event.key !== "Escape") return;
      document.removeEventListener("keydown", onEscape);
      if (selectedOffer) close();
    });
    maxButton?.addEventListener("click", () => {
      const price = Number(offer.price);
      const max = Math.min(Number(offer.maxFiat), Number(offer.availableAmount) * price);
      input.value = String(Math.floor(max * 100) / 100);
      updateOrderPreview(offer);
    });
    document.querySelectorAll("[data-order-method]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedPaymentMethod = button.dataset.orderMethod || "";
        renderMarketContent();
      });
    });
    input?.addEventListener("input", () => updateOrderPreview(offer));
    form?.addEventListener("submit", (event) => handleOrderSubmit(event, offer, action));
    input?.focus();
    input?.select();
    updateOrderPreview(offer);
  }

  async function handleOrderSubmit(event, offer, action) {
    event.preventDefault();
    const errorBox = document.querySelector("#orderError");
    if (errorBox) errorBox.textContent = "";
    const price = Number(offer.price);
    const fiat = Number(String(document.querySelector("#orderFiatAmount")?.value || "").replace(/,/g, ""));
    const min = Number(offer.minFiat);
    const max = Math.min(Number(offer.maxFiat), Number(offer.availableAmount) * price);

    if (!Number.isFinite(fiat) || fiat <= 0) return setOrderError("Enter a valid ETB amount.");
    if (fiat < min || fiat > max) return setOrderError(`Amount must be between ${format(min)} and ${format(max)} ETB.`);
    if (!offer.paymentMethods?.length) return setOrderError("This advertiser has no payment method. Choose another offer.");
    if (!selectedPaymentMethod) return setOrderError("Choose a payment method.");

    try {
      const result = await marketplace.openTrade(offer.id, fiat / price);
      await window.BRX.profileService.hydrateSession();
      showToast(`${action} trade opened. Seller USDT is locked in escrow.`);
      selectedOffer = null;
      selectedPaymentMethod = "";
      location.hash = `#/trades?id=${encodeURIComponent(result.trade.id)}`;
    } catch (error) {
      setOrderError(error.message || "Could not open trade.");
    }
  }

  function updateOrderPreview(offer) {
    const price = Number(offer.price);
    const fiat = Number(String(document.querySelector("#orderFiatAmount")?.value || "0").replace(/,/g, ""));
    const safeFiat = Number.isFinite(fiat) ? fiat : 0;
    const usdt = price > 0 ? safeFiat / price : 0;
    const fiatPreview = document.querySelector("#orderFiatPreview");
    const usdtPreview = document.querySelector("#orderUsdtPreview");
    if (fiatPreview) fiatPreview.textContent = `${format(safeFiat)} ETB`;
    if (usdtPreview) usdtPreview.textContent = `${format(usdt)} USDT`;
  }

  function setOrderError(message) {
    const errorBox = document.querySelector("#orderError");
    if (errorBox) errorBox.textContent = message;
    else showError(message);
  }

  function filteredMarketOffers() {
    const requestedEtb = Number(amountFilter);
    const normalizedPayment = paymentFilter.toLowerCase();

    return lastOffers.filter((offer) => {
      if (amountFilter) {
        const min = Number(offer.minFiat);
        const max = Number(offer.maxFiat);
        if (!Number.isFinite(requestedEtb) || requestedEtb < min || requestedEtb > max) return false;
      }

      if (paymentFilter) {
        const methods = offer.paymentMethods || [];
        if (!methods.some((method) => String(method).toLowerCase() === normalizedPayment)) return false;
      }

      return true;
    });
  }

  function paymentMethods() {
    return [...new Set(lastOffers.flatMap((offer) => offer.paymentMethods || []))]
      .map(String)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  function initials(value) {
    return String(value || "BRX").slice(0, 2).toUpperCase();
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

  window.BRX.pages.renderMarket = renderMarket;
})();
