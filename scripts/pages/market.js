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

  let selectedPaymentMethod = "";
  let marketSort = "best";
  let mobileFilterSheet = "";
  let mobileAmountDraft = "";
  let mobilePaymentDraft = "";

  function renderMarket() {
    const user = requireUser();
    if (!user) return;

    refs.app.innerHTML = `
      <section class="exchange-app market-app app-page-wide professional-market">

        <div class="market-mode-bar">
          <div class="market-intent-tabs ${marketMode}" role="tablist" aria-label="Trade direction">
            <button class="${marketMode === "buy" ? "active" : ""}" type="button" data-market-mode="buy"><span>Buy USDT</span><small>Pay with ETB</small></button>
            <button class="${marketMode === "sell" ? "active" : ""}" type="button" data-market-mode="sell"><span>Sell USDT</span><small>Receive ETB</small></button>
          </div>
          <div class="market-mobile-index" aria-label="ETB per USDT market index">
            <div><strong>${format(RATE)}</strong><button type="button" id="mobileRefreshMarket" aria-label="Refresh market">&#8635;</button></div>
            <span>ETB / USDT</span>
          </div>
          <a class="market-post-ad" href="#/ads"><span aria-hidden="true">+</span> Post an ad</a>
        </div>

        <div id="marketContent">
          <section class="market-loading-state">
            <div></div><div></div><div></div>
            <p>Loading live offers...</p>
          </section>
        </div>
      </section>
    `;

    document.querySelectorAll("[data-market-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        marketMode = button.dataset.marketMode;
        selectedOffer = null;
        selectedPaymentMethod = "";
        amountFilter = "";
        paymentFilter = "";
        marketSort = "best";
        mobileFilterSheet = "";
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
      const content = document.querySelector("#marketContent");
      if (!content) return;
      content.innerHTML = `
        <section class="market-api-state">
          <span>!</span>
          <div><h3>Could not load the P2P market</h3><p>${escapeHtml(error.message || "Check the BRX backend connection and try again.")}</p></div>
          <button class="app-button small" id="retryMarket" type="button">Try again</button>
        </section>
      `;
      document.querySelector("#retryMarket")?.addEventListener("click", () => {
        content.innerHTML = `<section class="market-loading-state"><div></div><div></div><div></div><p>Refreshing offers...</p></section>`;
        void loadMarketOffers();
      });
    }
  }
  function renderMarketContent() {
    const content = document.querySelector("#marketContent");
    if (!content) return;
    const action = marketMode === "buy" ? "Buy" : "Sell";
    const filteredOffers = sortedMarketOffers();
    const methods = paymentMethods();
    const hasFilters = Boolean(amountFilter || paymentFilter);

    const counterpartyLabel = marketMode === "buy" ? "sellers" : "buyers";
    const emptyTitle = hasFilters && lastOffers.length ? "No offers match these filters" : `No ${counterpartyLabel} available right now`;
    const emptyCopy = hasFilters && lastOffers.length
      ? "Try a different ETB amount or payment method."
      : `No active offers are available right now. Refresh to check again.`;

    content.innerHTML = `
      <form class="market-filter-panel" id="marketFilterForm">
        <label class="market-filter-field asset"><span>Asset</span><strong>USDT</strong></label>
        <label class="market-filter-field amount"><span>Amount</span><input id="marketAmountFilter" inputmode="decimal" autocomplete="off" placeholder="Any amount" value="${escapeHtml(amountFilter)}" /></label>
        <label class="market-filter-field payment"><span>Payment</span><select id="marketPaymentFilter"><option value="">All methods</option>${methods.map((method) => `<option value="${escapeHtml(method)}" ${paymentFilter === method ? "selected" : ""}>${escapeHtml(method)}</option>`).join("")}</select></label>
        <label class="market-filter-field sort"><span>Sort offers</span><select id="marketSort"><option value="best" ${marketSort === "best" ? "selected" : ""}>Best for me</option><option value="price_low" ${marketSort === "price_low" ? "selected" : ""}>Lowest price</option><option value="price_high" ${marketSort === "price_high" ? "selected" : ""}>Highest price</option><option value="available_high" ${marketSort === "available_high" ? "selected" : ""}>Most available</option><option value="trades_high" ${marketSort === "trades_high" ? "selected" : ""}>Most trades</option></select></label>
        <button class="market-filter-submit" type="submit">Apply</button>
        ${hasFilters ? `<button class="market-filter-clear" type="button" data-clear-market-filters>Clear</button>` : ""}
      </form>
      <div class="market-mobile-filters" aria-label="Market filters">
        <span class="market-mobile-filter asset"><strong>USDT</strong></span>
        <button class="${amountFilter ? "active" : ""}" type="button" data-mobile-filter="amount"><strong>${amountFilter ? `${format(Number(amountFilter))} ETB` : "Amount"}</strong><span>&#8801;</span></button>
        <button class="${paymentFilter ? "active" : ""}" type="button" data-mobile-filter="payment"><strong>${escapeHtml(paymentFilter || "Payment method")}</strong><span>&#8801;</span></button>
      </div>
      ${mobileMarketFilterSheet(methods)}

      <section class="market-results-panel">
        <div class="market-results-head">
          <div><h3>${marketMode === "buy" ? "Available sellers" : "Available buyers"}</h3><p>${filteredOffers.length} ${filteredOffers.length === 1 ? "offer" : "offers"}${hasFilters ? " matching your filters" : ""}</p></div>
          <button class="market-refresh-button" type="button" id="refreshMarket"><span aria-hidden="true">&#8635;</span> Refresh</button>
        </div>
        ${filteredOffers.length ? `
          <div class="market-offer-table">
            <div class="market-offer-row market-offer-header"><span>Advertiser</span><span>Price</span><span>Available / Limits</span><span>Payment</span><span></span></div>
            ${filteredOffers.map((offer) => marketRow(offer, action)).join("")}
          </div>
        ` : `
          <div class="professional-market-empty">
            <span>BRX</span><h3>${emptyTitle}</h3><p>${emptyCopy}</p>
            <div>${hasFilters ? `<button class="app-ghost-button small" type="button" data-clear-market-filters>Clear filters</button>` : ""}<a class="app-button small" href="#/ads">Post an ad</a></div>
          </div>
        `}
      </section>
      ${selectedOffer ? orderModal(selectedOffer, action) : ""}
    `;

    document.querySelector("#marketFilterForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      applyMarketFilters();
    });
    document.querySelector("#marketAmountFilter")?.addEventListener("change", applyMarketFilters);

    document.querySelector("#marketPaymentFilter")?.addEventListener("change", (event) => {
      paymentFilter = event.currentTarget.value;
      selectedOffer = null;
      selectedPaymentMethod = "";
      renderMarketContent();
    });
    document.querySelector("#marketSort")?.addEventListener("change", (event) => {
      marketSort = event.currentTarget.value;
      renderMarketContent();
    });
    document.querySelectorAll("[data-clear-market-filters]").forEach((button) => {
      button.addEventListener("click", () => {
        amountFilter = "";
        paymentFilter = "";
        selectedOffer = null;
        selectedPaymentMethod = "";
        renderMarketContent();
      });
    });
    document.querySelectorAll("#refreshMarket, #mobileRefreshMarket").forEach((button) => {
      button.onclick = () => {
        content.innerHTML = `<section class="market-loading-state"><div></div><div></div><div></div><p>Refreshing live offers...</p></section>`;
        void loadMarketOffers();
      };
    });
    bindMobileMarketFilters(methods);
    document.querySelectorAll("[data-select-offer]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedOffer = filteredOffers.find((offer) => offer.id === button.dataset.selectOffer);
        selectedPaymentMethod = selectedOffer?.paymentMethods?.[0] || "";
        renderMarketContent();
      });
    });
    if (selectedOffer) bindOrderModal(selectedOffer, action);
  }

  function applyMarketFilters() {
    const rawAmount = String(document.querySelector("#marketAmountFilter")?.value || "").replace(/,/g, "").trim();
    if (rawAmount) {
      const value = Number(rawAmount);
      if (!Number.isFinite(value) || value <= 0) return showToast("Enter a valid ETB amount.");
      amountFilter = String(value);
    } else {
      amountFilter = "";
    }
    paymentFilter = document.querySelector("#marketPaymentFilter")?.value || "";
    marketSort = document.querySelector("#marketSort")?.value || "best";
    selectedOffer = null;
    selectedPaymentMethod = "";
    renderMarketContent();
  }
  function mobileMarketFilterSheet(methods) {
    if (!mobileFilterSheet) return "";
    const amountSheet = mobileFilterSheet === "amount";
    const quickAmounts = [500, 1000, 5000, 10000, 20000];
    return `
      <div class="market-filter-sheet-backdrop" data-close-mobile-filter>
        <section class="market-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="mobileFilterTitle">
          <span class="market-filter-sheet-handle"></span>
          <header><h3 id="mobileFilterTitle">${amountSheet ? "I want to trade" : "Pay with"}</h3><button type="button" data-close-mobile-filter aria-label="Close">&times;</button></header>
          ${amountSheet ? `
            <label class="market-filter-sheet-input"><input id="mobileAmountDraft" inputmode="decimal" autocomplete="off" placeholder="Enter total amount" value="${escapeHtml(mobileAmountDraft)}" /><span>ETB</span></label>
            <div class="market-quick-amounts">${quickAmounts.map((value) => `<button class="${Number(mobileAmountDraft) === value ? "active" : ""}" type="button" data-quick-market-amount="${value}">${value >= 1000 ? `${value / 1000}K` : value}</button>`).join("")}</div>
          ` : `
            <div class="market-payment-options">
              ${["", ...methods].map((method) => `<button class="${mobilePaymentDraft === method ? "active" : ""}" type="button" data-mobile-payment="${escapeHtml(method)}">${escapeHtml(method || "All methods")}</button>`).join("")}
            </div>
          `}
          <footer><button class="market-sheet-reset" type="button" data-reset-mobile-filter>Reset</button><button class="market-sheet-confirm" type="button" data-confirm-mobile-filter>Confirm</button></footer>
        </section>
      </div>
    `;
  }

  function bindMobileMarketFilters(methods) {
    document.querySelectorAll("[data-mobile-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        mobileFilterSheet = button.dataset.mobileFilter || "";
        mobileAmountDraft = amountFilter;
        mobilePaymentDraft = paymentFilter;
        renderMarketContent();
      });
    });
    const closeSheet = () => {
      mobileFilterSheet = "";
      renderMarketContent();
    };
    document.querySelectorAll("[data-close-mobile-filter]").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (event.currentTarget === event.target || event.currentTarget.matches("button")) closeSheet();
      });
    });
    document.querySelectorAll("[data-quick-market-amount]").forEach((button) => {
      button.addEventListener("click", () => {
        mobileAmountDraft = button.dataset.quickMarketAmount || "";
        const input = document.querySelector("#mobileAmountDraft");
        if (input) input.value = mobileAmountDraft;
        document.querySelectorAll("[data-quick-market-amount]").forEach((item) => item.classList.toggle("active", item === button));
      });
    });
    document.querySelector("#mobileAmountDraft")?.addEventListener("input", (event) => {
      mobileAmountDraft = event.currentTarget.value;
    });
    document.querySelectorAll("[data-mobile-payment]").forEach((button) => {
      button.addEventListener("click", () => {
        mobilePaymentDraft = button.dataset.mobilePayment || "";
        document.querySelectorAll("[data-mobile-payment]").forEach((item) => item.classList.toggle("active", item === button));
      });
    });
    document.querySelector("[data-reset-mobile-filter]")?.addEventListener("click", () => {
      if (mobileFilterSheet === "amount") amountFilter = "";
      else paymentFilter = "";
      mobileFilterSheet = "";
      renderMarketContent();
    });
    document.querySelector("[data-confirm-mobile-filter]")?.addEventListener("click", () => {
      if (mobileFilterSheet === "amount") {
        const raw = String(mobileAmountDraft || "").replace(/,/g, "").trim();
        if (raw && (!Number.isFinite(Number(raw)) || Number(raw) <= 0)) return showToast("Enter a valid ETB amount.");
        amountFilter = raw ? String(Number(raw)) : "";
      } else {
        paymentFilter = methods.includes(mobilePaymentDraft) ? mobilePaymentDraft : "";
      }
      mobileFilterSheet = "";
      selectedOffer = null;
      selectedPaymentMethod = "";
      renderMarketContent();
    });
  }
  function sortedMarketOffers() {
    const offers = [...filteredMarketOffers()];
    return offers.sort((a, b) => {
      const priceA = Number(a.price || 0);
      const priceB = Number(b.price || 0);
      if (marketSort === "price_low") return priceA - priceB;
      if (marketSort === "price_high") return priceB - priceA;
      if (marketSort === "available_high") return Number(b.availableAmount || 0) - Number(a.availableAmount || 0);
      if (marketSort === "trades_high") return Number(b.completedTrades || 0) - Number(a.completedTrades || 0);
      return marketMode === "buy" ? priceA - priceB : priceB - priceA;
    });
  }
  function marketRow(offer, action) {
    const available = Number(offer.availableAmount);
    const price = Number(offer.price);
    const minFiat = Number(offer.minFiat);
    const maxFiat = Math.min(Number(offer.maxFiat), available * price);
    const maxUsdt = price > 0 ? Math.min(available, maxFiat / price) : 0;
    const methods = offer.paymentMethods || [];
    return `
      <div class="market-offer-row">
        <div class="market-trader-cell">
          <span class="market-trader-avatar">${initials(offer.advertiser)}</span>
          <div><strong>${escapeHtml(offer.advertiser)}</strong><small><i></i> BRX trader &middot; ${offer.completedTrades || 0} completed</small></div>
        </div>
        <div class="market-price-cell"><strong class="${action === "Sell" ? "sell-price" : ""}">${format(price)}</strong><small>ETB / USDT</small></div>
        <div class="market-liquidity-cell"><strong>${format(available)} USDT</strong><small>Limit ${format(minFiat)} - ${format(maxFiat)} ETB</small><small>Up to ${format(maxUsdt)} USDT per order</small></div>
        <div class="market-payment-cell">${methods.length ? methods.map((method) => `<span>${escapeHtml(method)}</span>`).join("") : `<small>No method</small>`}</div>
        <div class="market-action-cell"><button class="app-button market-trade-button ${action.toLowerCase()}-button" type="button" data-select-offer="${escapeHtml(offer.id)}">${action} USDT</button><small>Escrow protected</small></div>
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
    if (paymentMethods.length && !paymentMethods.includes(selectedPaymentMethod)) selectedPaymentMethod = paymentMethods[0];
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
                  ? `<div class="order-methods selectable">${paymentMethods.map((method) => `<button class="${selectedPaymentMethod === method ? "active" : ""}" type="button" data-order-method="${escapeHtml(method)}" aria-pressed="${selectedPaymentMethod === method ? "true" : "false"}"><span></span>${escapeHtml(method)}</button>`).join("")}</div>`
                  : `<div class="order-warning">This advertiser has no active payment method. Choose another offer.</div>`
              }
            </div>

            <form id="orderForm" class="order-form">
              <label class="order-input-label" for="orderFiatAmount">
                <span>${action === "Buy" ? "You pay" : "You receive"} (ETB)</span>
                <small>Limit ${format(min)}-${format(maxByAvailable)} ETB</small>
              </label>
              <div class="order-input-row">
                <input id="orderFiatAmount" inputmode="decimal" autocomplete="off" placeholder="${format(min)} - ${format(maxByAvailable)}" />
                <span>ETB</span>
                <button type="button" data-order-max>Max</button>
              </div>
              <div class="order-quote">
                <div><span>${action === "Buy" ? "You pay" : "Buyer pays"}</span><strong id="orderFiatPreview">-- ETB</strong></div>

                <div><span>${action === "Buy" ? "You get" : "You sell"}</span><strong id="orderUsdtPreview">-- USDT</strong></div>
              </div>
              <div class="order-escrow-note">
                <strong>Escrow protected</strong>
                <span>BRX locks seller USDT before the trade opens. ETB is paid directly to the seller, then USDT releases after confirmation.</span>
              </div>
              <div class="form-error" id="orderError"></div>
            </form>
          </div>
          <footer class="order-modal-footer">
            <button class="app-button ${action.toLowerCase()}-button" id="orderSubmit" type="submit" form="orderForm" disabled>Confirm ${action}</button>
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
    const onEscape = (event) => {
      if (event.key === "Escape") close();
    };
    const close = () => {
      document.removeEventListener("keydown", onEscape);
      selectedOffer = null;
      selectedPaymentMethod = "";
      renderMarketContent();
    };

    document.querySelectorAll("[data-close-order]").forEach((button) => button.addEventListener("click", close));
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
    document.addEventListener("keydown", onEscape);
    maxButton?.addEventListener("click", () => {
      const price = Number(offer.price);
      const max = Math.min(Number(offer.maxFiat), Number(offer.availableAmount) * price);
      input.value = String(Math.floor(max * 100) / 100);
      updateOrderPreview(offer);
    });
    document.querySelectorAll("[data-order-method]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedPaymentMethod = button.dataset.orderMethod || "";
        document.querySelectorAll("[data-order-method]").forEach((methodButton) => {
          const active = methodButton === button;
          methodButton.classList.toggle("active", active);
          methodButton.setAttribute("aria-pressed", String(active));
        });
        updateOrderPreview(offer);
      });
    });
    input?.addEventListener("input", () => updateOrderPreview(offer));
    form?.addEventListener("submit", (event) => handleOrderSubmit(event, offer, action));
    input?.focus();
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

    const submit = document.querySelector("#orderSubmit");
    const originalText = submit?.textContent;
    if (submit) {
      submit.disabled = true;
      submit.textContent = `Opening ${action.toLowerCase()} trade...`;
    }
    try {
      const result = await marketplace.openTrade(offer.id, fiat / price, selectedPaymentMethod);
      await window.BRX.profileService.hydrateSession();
      showToast(`${action} trade opened. Seller USDT is locked in escrow.`);
      selectedOffer = null;
      selectedPaymentMethod = "";
      location.hash = `#/trades?id=${encodeURIComponent(result.trade.id)}`;
    } catch (error) {
      setOrderError(error.message || "Could not open trade.");
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  }
  function updateOrderPreview(offer) {
    const price = Number(offer.price);
    const input = document.querySelector("#orderFiatAmount");
    const rawAmount = String(input?.value || "").replace(/,/g, "").trim();
    const fiat = Number(rawAmount);
    const min = Number(offer.minFiat);
    const max = Math.min(Number(offer.maxFiat), Number(offer.availableAmount) * price);
    const hasAmount = rawAmount !== "" && Number.isFinite(fiat) && fiat > 0;
    const usdt = hasAmount && price > 0 ? fiat / price : 0;
    const fiatPreview = document.querySelector("#orderFiatPreview");
    const usdtPreview = document.querySelector("#orderUsdtPreview");
    const submit = document.querySelector("#orderSubmit");
    if (fiatPreview) fiatPreview.textContent = hasAmount ? `${format(fiat)} ETB` : "-- ETB";
    if (usdtPreview) usdtPreview.textContent = hasAmount ? `${format(usdt)} USDT` : "-- USDT";
    if (submit) {
      const validAmount = hasAmount && fiat >= min && fiat <= max;
      submit.disabled = !validAmount || !offer.paymentMethods?.length || !selectedPaymentMethod;
    }
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

