(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { RATE } = window.BRX.config;
  const { requireUser } = window.BRX.state;
  const { refs, showError, showToast } = window.BRX.ui;
  const { format } = window.BRX.utils;
  const { kycBanner } = window.BRX.components;
  const marketplace = window.BRX.marketplaceService;

  let marketMode = "buy";
  let selectedOffer = null;
  let lastOffers = [];
  let amountFilter = "";
  let paymentFilter = "";
  let activeFilter = "";

  function renderMarket() {
    const user = requireUser();
    if (!user) return;

    refs.app.innerHTML = `
      <section class="exchange-app">
        ${kycBanner()}
        <div class="market-head">
          <div class="segmented app-tabs" role="tablist">
            <button class="${marketMode === "buy" ? "active" : ""}" type="button" data-market-mode="buy">Buy</button>
            <button class="${marketMode === "sell" ? "active" : ""}" type="button" data-market-mode="sell">Sell</button>
          </div>
          <div class="market-rate"><strong>${format(RATE)}</strong><span>KES / USDT index</span></div>
        </div>
        <div id="marketContent">
          <section class="empty-panel compact market-empty"><span class="mini-icon">...</span><h3>Loading market</h3></section>
        </div>
      </section>
    `;

    document.querySelectorAll("[data-market-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        marketMode = button.dataset.marketMode;
        selectedOffer = null;
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
        <section class="warning-card"><h3>Market API unavailable</h3><p>${escapeHtml(error.message || "Start the BRX backend and reload the market.")}</p></section>
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
      ? "Adjust the KES amount or payment method."
      : "Create the first ad from My Ads.";

    content.innerHTML = `
      <div class="filter-row ${hasFilters ? "has-clear" : ""}">
        <button class="filter-chip active" type="button" data-clear-filters>USDT</button>
        ${amountControl()}
        ${paymentControl(methods)}
        ${hasFilters ? `<button class="filter-chip clear" type="button" data-clear-filters>Clear</button>` : ""}
      </div>

      ${selectedOffer ? tradeTicket(selectedOffer, action) : ""}

      <p class="app-muted market-count">${filteredOffers.length} active ${marketMode === "buy" ? "sell" : "buy"} ads</p>
      ${
        filteredOffers.length
          ? `<div class="app-table">
              <div class="table-row table-head"><span>Advertiser</span><span>Price</span><span>Available - Limit</span><span>Payment</span><span></span></div>
              ${filteredOffers.map((offer) => marketRow(offer, action)).join("")}
            </div>`
          : `<section class="empty-panel compact market-empty"><span class="mini-icon">Ad</span><h3>${emptyTitle}</h3><p>${emptyCopy}</p>${lastOffers.length ? `<button class="app-button" type="button" data-clear-filters>Clear filters</button>` : `<a class="app-button" href="#/ads">Post an Ad</a>`}</section>`
      }
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
        activeFilter = "";
        renderMarketContent();
        document.querySelector("#tradeTicket")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });

    const form = document.querySelector("#tradeTicketForm");
    if (form) {
      const amount = document.querySelector("#tradeAmount");
      amount.addEventListener("input", updateTradePreview);
      updateTradePreview();
      form.addEventListener("submit", handleOpenTrade);
    }
  }

  function amountControl() {
    if (activeFilter === "amount") {
      return `
        <form class="filter-chip filter-input-chip ${amountFilter ? "has-value" : ""}" id="amountFilterForm">
          <input id="amountFilterInput" inputmode="decimal" placeholder="KES amount" value="${escapeHtml(amountFilter)}" aria-label="KES amount" />
          <button type="submit">Apply</button>
        </form>
      `;
    }

    return `<button class="filter-chip ${amountFilter ? "has-value" : ""}" type="button" data-filter-toggle="amount" aria-expanded="false">${amountFilter ? `${format(Number(amountFilter))} KES` : "KES amount"}</button>`;
  }

  function paymentControl(methods) {
    if (activeFilter === "payment" && methods.length) {
      return `
        <form class="filter-chip filter-input-chip wide">
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
      return renderMarketContent();
    }

    const value = Number(cleaned);
    if (!Number.isFinite(value) || value <= 0) {
      return showToast("Enter a valid KES amount.");
    }

    amountFilter = String(value);
    activeFilter = "";
    selectedOffer = null;
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
        <div><strong>${format(available)} USDT</strong><small>${format(Number(offer.minFiat))}-${format(Number(offer.maxFiat))} KES</small><small>Max ${format(maxUsdt)} USDT</small></div>
        <div class="chips">${offer.paymentMethods.map((method) => `<span>${escapeHtml(method)}</span>`).join("")}</div>
        <button class="app-button ${action.toLowerCase()}-button" type="button" data-select-offer="${offer.id}">${action}</button>
      </div>
    `;
  }

  function tradeTicket(offer, action) {
    return `
      <section class="trade-ticket" id="tradeTicket">
        <div>
          <p class="app-label blue">${action} USDT</p>
          <h3>${escapeHtml(offer.advertiser)} at ${format(Number(offer.price))} KES</h3>
          <p class="app-muted">Limit ${format(Number(offer.minFiat))}-${format(Number(offer.maxFiat))} KES. Payment: ${offer.paymentMethods.map(escapeHtml).join(", ")}.</p>
        </div>
        <form class="trade-ticket-form" id="tradeTicketForm">
          <label class="form-field"><span>USDT amount</span><input id="tradeAmount" inputmode="decimal" placeholder="0.00" /></label>
          <div class="trade-preview"><span>You pay / receive</span><strong id="tradeKesPreview">0.00 KES</strong></div>
          <div class="form-error" id="formError"></div>
          <button class="app-button ${action.toLowerCase()}-button" type="submit">Open ${action.toLowerCase()} trade</button>
        </form>
      </section>
    `;
  }

  async function handleOpenTrade(event) {
    event.preventDefault();
    showError("");
    const amount = Number(document.querySelector("#tradeAmount").value);
    if (!selectedOffer || !Number.isFinite(amount) || amount <= 0) return showError("Enter a valid USDT amount.");

    try {
      await marketplace.openTrade(selectedOffer.id, amount);
      await window.BRX.profileService.hydrateSession();
      showToast("Trade opened. Continue from My Trades.");
      location.hash = "#/trades";
    } catch (error) {
      showError(error.message || "Could not open trade.");
    }
  }

  function updateTradePreview() {
    const amount = Number(document.querySelector("#tradeAmount").value || "0");
    const kes = selectedOffer ? amount * Number(selectedOffer.price) : 0;
    document.querySelector("#tradeKesPreview").textContent = `${format(kes)} KES`;
  }

  function filteredMarketOffers() {
    const requestedKes = Number(amountFilter);
    const normalizedPayment = paymentFilter.toLowerCase();

    return lastOffers.filter((offer) => {
      if (amountFilter) {
        const min = Number(offer.minFiat);
        const max = Number(offer.maxFiat);
        if (!Number.isFinite(requestedKes) || requestedKes < min || requestedKes > max) return false;
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
