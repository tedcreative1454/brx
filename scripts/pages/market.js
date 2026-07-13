(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { requireUser } = window.BRX.state;
  const { refs, showError, showToast } = window.BRX.ui;
  const { format } = window.BRX.utils;
  const { icon } = window.BRX.icons;
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
  let orderAmountMode = "fiat";

  function renderMarket() {
    const user = requireUser();
    if (!user) return;

    refs.app.innerHTML = `
      <section class="exchange-app market-app app-page-wide professional-market brx-p2p-market">
        <div class="p2p-market-topline" aria-label="P2P quick actions">
          <div class="p2p-market-title"><span class="p2p-market-icon">${icon("p2p")}</span><strong>P2P</strong><small>USDT / ETB marketplace</small></div>
          <nav>
            <a href="#/trades">Orders</a>
            <a href="#/p2p-chat">Chat</a>
            <a class="market-post-ad" href="#/ads"><span aria-hidden="true">+</span> Post ad</a>
          </nav>
        </div>

        <div class="market-mode-bar p2p-trade-toolbar">
          <div class="market-intent-tabs ${marketMode}" role="tablist" aria-label="Trade direction">
            <button class="${marketMode === "buy" ? "active" : ""}" type="button" data-market-mode="buy"><span>Buy</span><small>Buy USDT with ETB</small></button>
            <button class="${marketMode === "sell" ? "active" : ""}" type="button" data-market-mode="sell"><span>Sell</span><small>Sell USDT for ETB</small></button>
          </div>

        </div>

        <div id="marketContent">
          <section class="market-loading-state">
            <div></div><div></div><div></div>
            <p>Loading live P2P offers...</p>
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
      await window.BRX.accountService.loadSettings();
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
      <form class="market-filter-panel p2p-filter-panel" id="marketFilterForm">
        <label class="market-filter-field amount"><span>Transaction amount</span><div class="market-field-combo"><input id="marketAmountFilter" inputmode="decimal" autocomplete="off" placeholder="Enter amount" value="${escapeHtml(amountFilter)}" /><b>ETB</b></div></label>
        <label class="market-filter-field payment"><span>Payment method</span><select id="marketPaymentFilter"><option value="">All payment methods</option>${methods.map((method) => `<option value="${escapeHtml(method)}" ${paymentFilter === method ? "selected" : ""}>${escapeHtml(method)}</option>`).join("")}</select></label>
        <label class="market-filter-field sort"><span>Sort By</span><select id="marketSort"><option value="best" ${marketSort === "best" ? "selected" : ""}>Best price</option><option value="price_low" ${marketSort === "price_low" ? "selected" : ""}>Lowest price</option><option value="price_high" ${marketSort === "price_high" ? "selected" : ""}>Highest price</option><option value="available_high" ${marketSort === "available_high" ? "selected" : ""}>Most available</option><option value="trades_high" ${marketSort === "trades_high" ? "selected" : ""}>Most orders</option></select></label>
        ${hasFilters ? `<button class="market-filter-clear" type="button" data-clear-market-filters>Clear</button>` : ""}
      </form>
      <div class="market-mobile-filters" aria-label="Market filters">
        <span class="market-mobile-filter asset"><strong>USDT</strong></span>
        <button class="${amountFilter ? "active" : ""}" type="button" data-mobile-filter="amount"><strong>${amountFilter ? `${format(Number(amountFilter))} ETB` : "Amount"}</strong><span>&#8801;</span></button>
        <button class="${paymentFilter ? "active" : ""}" type="button" data-mobile-filter="payment"><strong>${escapeHtml(paymentFilter || "Payment method")}</strong><span>&#8801;</span></button>
      </div>
      ${mobileMarketFilterSheet(methods)}

      <section class="market-results-panel">

        ${filteredOffers.length ? `
          <div class="market-offer-table">
            <div class="market-offer-row market-offer-header"><span>Advertisers</span><span>Price</span><span>Available/Order Limit</span><span>Payment</span><span>Trade</span></div>
            ${filteredOffers.map((offer) => marketRow(offer, action)).join("")}
          </div>
        ` : `
          <div class="professional-market-empty">
            <span>BRX</span><h3>${emptyTitle}</h3><p>${emptyCopy}</p>
            <div>${hasFilters ? `<button class="app-ghost-button small" type="button" data-clear-market-filters>Clear filters</button>` : ""}<a class="app-button small" href="#/ads">Post an ad</a></div>
          </div>
        `}
      </section>
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
        location.hash = `#/order?id=${encodeURIComponent(button.dataset.selectOffer)}&side=${encodeURIComponent(marketMode)}`;
      });
    });
  }

  async function renderMarketOrder() {
    const user = requireUser();
    if (!user) return;
    const params = window.BRX.router.routeParams();
    const offerId = params.get("id") || "";
    marketMode = params.get("side") === "sell" ? "sell" : "buy";
    orderAmountMode = "fiat";
    const action = marketMode === "buy" ? "Buy" : "Sell";
    refs.app.innerHTML = `<section class="exchange-app app-page-wide p2p-order-page"><div class="order-page-loading"><span></span><strong>Loading order</strong><small>Checking live price and availability...</small></div></section>`;
    try {
      await window.BRX.accountService.loadSettings();
      const result = await marketplace.listOffers(marketMode === "buy" ? "sell" : "buy");
      const offer = (result.offers || []).find((item) => item.id === offerId);
      if (!offer) throw new Error("This offer is no longer available.");
      selectedOffer = offer;
      selectedPaymentMethod = offer.paymentMethods?.[0] || "";
      refs.app.innerHTML = `<section class="exchange-app app-page-wide p2p-order-page">${orderModal(offer, action)}</section>`;
      bindOrderModal(offer, action);
    } catch (error) {
      refs.app.innerHTML = `<section class="exchange-app app-page-wide p2p-order-page"><div class="order-page-error"><strong>Order unavailable</strong><p>${escapeHtml(error.message || "Could not load this offer.")}</p><a class="app-button" href="#/market">Back to P2P market</a></div></section>`;
    }
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
    const methods = offer.paymentMethods || [];
    const completion = Number(offer.completionRate ?? offer.completion ?? 100);
    const orders = Math.max(0, Math.trunc(Number(offer.completedTrades || 0)));
    const releaseMinutes = 15;
    const presence = presenceMeta(offer.advertiserLastSeenAt || offer.lastSeenAt);
    const sideClass = action.toLowerCase();
    const avatar = traderAvatarMarkup(offer.advertiser, offerAvatarUrl(offer), presence.tone);
    return `
      <div class="market-offer-row p2p-offer-row">
        <div class="market-trader-cell p2p-advertiser-cell">
          ${avatar}
          <div>
            <strong>${escapeHtml(offer.advertiser)}${offer.traderLabel ? ` <em>${escapeHtml(offer.traderLabel)}</em>` : ""}</strong>
            <small>${orders.toLocaleString()} orders <b></b> ${format(completion)}% completion</small>
            <small class="p2p-trust-row"><span>${releaseMinutes} min</span></small>
          </div>
        </div>
        <div class="market-price-cell"><strong class="${action === "Sell" ? "sell-price" : ""}">${format(price)}</strong></div>
        <div class="market-liquidity-cell"><strong>${format(available)} USDT</strong><small>${format(minFiat)} ETB - ${format(maxFiat)} ETB</small></div>
        <div class="market-payment-cell p2p-payment-list">${methods.length ? methods.slice(0, 3).map((method, index) => `<span><i style="--dot:${paymentColor(index)}"></i>${escapeHtml(method)}</span>`).join("") : `<small>No payment method</small>`}</div>
        <div class="market-action-cell"><button class="app-button market-trade-button ${sideClass}-button" type="button" data-select-offer="${escapeHtml(offer.id)}">${action} USDT</button></div>
      </div>
    `;
  }



  function offerAvatarUrl(offer) {
    const url = String(offer.avatarUrl || "").trim();
    if (url) return url;
    const user = window.BRX.state.currentUser?.();
    if (!user) return "";
    const sameBackendUser = offer.userId && user.backendUserId && String(offer.userId) === String(user.backendUserId);
    const sameLocalUser = offer.userId && user.id && String(offer.userId) === String(user.id);
    const sameUsername = user.username && offer.advertiser && String(user.username).toLowerCase() === String(offer.advertiser).toLowerCase();
    const sameEmailName = user.email && offer.advertiser && String(user.email).split("@")[0].toLowerCase() === String(offer.advertiser).toLowerCase();
    return sameBackendUser || sameLocalUser || sameUsername || sameEmailName ? String(user.avatarUrl || "").trim() : "";
  }
  function traderAvatarMarkup(name, avatarUrl, presenceTone = "offline") {
    const url = String(avatarUrl || "").trim();
    if (url) {
      return `<span class="market-trader-avatar presence-avatar has-image ${presenceTone}"><img src="${escapeAttr(url)}" alt="" /><i></i></span>`;
    }
    return `<span class="market-trader-avatar presence-avatar ${presenceTone}">${initials(name)}<i></i></span>`;
  }
  function presenceMeta(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return { tone: "offline", label: "Offline" };
    const hours = (Date.now() - date.getTime()) / 36e5;
    if (hours <= 1) return { tone: "online", label: "Online" };
    if (hours <= 3) return { tone: "away", label: "Recently active" };
    return { tone: "offline", label: "Offline" };
  }
  function paymentColor(index) {
    return ["#f0b90b", "#f6465d", "#1e9bff", "#00c087"][index % 4];
  }
  function orderModal(offer, action) {
    const price = Number(offer.price);
    const min = Number(offer.minFiat);
    const max = Number(offer.maxFiat);
    const available = Number(offer.availableAmount);
    const maxByAvailable = Math.min(max, available * price);
    const paymentMethods = offer.paymentMethods || [];
    if (paymentMethods.length && !paymentMethods.includes(selectedPaymentMethod)) selectedPaymentMethod = paymentMethods[0];
    const completion = Number(offer.completionRate ?? offer.completion ?? 100);
    const isBuy = action === "Buy";

    return `
      <section class="binance-order-page ${action.toLowerCase()}" id="orderModalBackdrop" aria-labelledby="orderModalTitle">
        <header class="binance-order-head">
          <a href="#/market" aria-label="Back to P2P market">&larr;</a>
          <div><span class="usdt-mark">T</span><h1 id="orderModalTitle">${action} USDT</h1></div>
        </header>
        <div class="binance-order-price">Price <strong>${format(price)} ETB</strong><span>Fixed</span></div>

        <form id="orderForm" class="binance-amount-card">
          <div class="binance-amount-tabs" role="tablist" aria-label="Amount currency">
            <button class="${orderAmountMode === "fiat" ? "active" : ""}" type="button" data-order-mode="fiat">By ETB</button>
            <button class="${orderAmountMode === "asset" ? "active" : ""}" type="button" data-order-mode="asset">By USDT</button>
          </div>
          <div class="binance-amount-input">
            <input id="orderAmount" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Order amount" />
            <strong id="orderCurrency">${orderAmountMode === "fiat" ? "ETB" : "USDT"}</strong>
            <button type="button" data-order-max>Max</button>
          </div>
          <div class="binance-order-limit">Limit ${format(min)} - ${format(maxByAvailable)} ETB</div>
          <div class="binance-order-receive"><span id="orderReceiveLabel">${isBuy ? "You receive" : "You sell"}</span><strong id="orderFinalPreview">0 USDT</strong></div>
          <div class="binance-order-fee"><span>Fee ${format(takerFeePercent())}%</span><strong id="orderFeePreview">0 USDT</strong></div>
          <div class="form-error" id="orderError"></div>
        </form>

        <section class="binance-payment-card" aria-label="Payment method">
          <span></span><strong>Pay with &middot; <b id="orderPaymentLabel">${escapeHtml(selectedPaymentMethod || paymentMethods[0] || "Unavailable")}</b></strong>
          ${paymentMethods.length > 1 ? `<div class="order-methods selectable">${paymentMethods.map((method) => `<button class="${selectedPaymentMethod === method ? "active" : ""}" type="button" data-order-method="${escapeHtml(method)}" aria-pressed="${selectedPaymentMethod === method}">${escapeHtml(method)}</button>`).join("")}</div>` : ""}
        </section>

        <section class="binance-advertiser-card">
          <span class="trader-avatar">${initials(offer.advertiser)}</span>
          <div><strong>${escapeHtml(offer.advertiser)}</strong><small>${format(completion)}% completion &middot; ${offer.completedTrades || 0} orders</small></div>
          <em>${format(available)} USDT available</em>
        </section>

        <footer class="binance-order-footer">
          <button class="app-button" id="orderSubmit" type="submit" form="orderForm" disabled>Place Order</button>
        </footer>
      </section>
    `;
  }

  function bindOrderModal(offer, action) {
    const input = document.querySelector("#orderAmount");
    const maxButton = document.querySelector("[data-order-max]");
    const form = document.querySelector("#orderForm");
    const close = () => {
      selectedOffer = null;
      selectedPaymentMethod = "";
      location.hash = "#/market";
    };

    document.querySelectorAll("[data-close-order]").forEach((button) => button.addEventListener("click", close));
    document.querySelectorAll("[data-order-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        orderAmountMode = button.dataset.orderMode === "asset" ? "asset" : "fiat";
        input.value = "";
        document.querySelectorAll("[data-order-mode]").forEach((item) => item.classList.toggle("active", item === button));
        document.querySelector("#orderCurrency").textContent = orderAmountMode === "fiat" ? "ETB" : "USDT";
        updateOrderPreview(offer);
      });
    });
    maxButton?.addEventListener("click", () => {
      const price = Number(offer.price);
      const max = Math.min(Number(offer.maxFiat), Number(offer.availableAmount) * price);
      input.value = orderAmountMode === "fiat" ? String(Math.floor(max * 100) / 100) : String(Math.floor(max / price * 1e8) / 1e8);
      updateOrderPreview(offer);
    });
    document.querySelectorAll("[data-order-method]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedPaymentMethod = button.dataset.orderMethod || "";
        const paymentLabel = document.querySelector("#orderPaymentLabel");
        if (paymentLabel) paymentLabel.textContent = selectedPaymentMethod;
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
    if (window.matchMedia?.("(pointer: fine)").matches) input?.focus();
    updateOrderPreview(offer);
  }
  async function handleOrderSubmit(event, offer, action) {
    event.preventDefault();
    const errorBox = document.querySelector("#orderError");
    if (errorBox) errorBox.textContent = "";
    const price = Number(offer.price);
    const entered = Number(String(document.querySelector("#orderAmount")?.value || "").replace(/,/g, ""));
    const fiat = orderAmountMode === "fiat" ? entered : entered * price;
    const min = Number(offer.minFiat);
    const max = Math.min(Number(offer.maxFiat), Number(offer.availableAmount) * price);

    if (!Number.isFinite(fiat) || fiat <= 0) return setOrderError(`Enter a valid ${orderAmountMode === "fiat" ? "ETB" : "USDT"} amount.`);
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
    const input = document.querySelector("#orderAmount");
    const rawAmount = String(input?.value || "").replace(/,/g, "").trim();
    const entered = Number(rawAmount);
    const fiat = orderAmountMode === "fiat" ? entered : entered * price;
    const min = Number(offer.minFiat);
    const max = Math.min(Number(offer.maxFiat), Number(offer.availableAmount) * price);
    const hasAmount = rawAmount !== "" && Number.isFinite(entered) && entered > 0 && Number.isFinite(fiat) && fiat > 0;
    const usdt = hasAmount && price > 0 ? fiat / price : 0;
    const feePreview = document.querySelector("#orderFeePreview");
    const finalPreview = document.querySelector("#orderFinalPreview");
    const submit = document.querySelector("#orderSubmit");
    const fee = usdt * takerFeePercent() / 100;
    if (feePreview) feePreview.textContent = hasAmount ? `${format(fee, 4)} USDT` : "0 USDT";
    if (finalPreview) finalPreview.textContent = hasAmount ? `${format(offer.side === "sell" ? usdt - fee : usdt + fee, 4)} USDT` : "0 USDT";
    if (submit) {
      const validAmount = hasAmount && fiat >= min && fiat <= max;
      submit.disabled = !validAmount || !offer.paymentMethods?.length || !selectedPaymentMethod;
    }
  }
  function takerFeePercent() {
    const user = window.BRX.state.currentUser?.() || {};
    const settings = user.platformSettings || {};
    if (user.role === "merchant") return Number(settings.p2pTakerFeeMerchantPercent ?? 0.15);
    if (user.kycStatus === "approved") return Number(settings.p2pTakerFeeVerifiedPercent ?? 0.35);
    return Number(settings.p2pTakerFeeBasicPercent ?? 0.5);
  }
  function setOrderError(message) {
    const errorBox = document.querySelector("#orderError");
    if (errorBox) errorBox.textContent = message;
    else showError(message);
  }


  async function renderP2pChat() {
    const user = requireUser();
    if (!user) return;
    const selectedId = window.BRX.router.routeParams().get("id") || "";
    refs.app.innerHTML = `
      <section class="exchange-app app-page-wide p2p-chat-page">
        <div class="p2p-chat-shell ${selectedId ? "has-selected" : ""}">
          <aside class="p2p-chat-sidebar">
            ${p2pChatProfile(user)}
          </aside>
          <section class="p2p-chat-list-panel">
            <header><div><h2>Chats</h2><p>P2P trade conversations</p></div><a href="#/market">P2P</a></header>
            <label class="p2p-chat-search"><span>${icon("search")}</span><input id="p2pChatSearch" placeholder="Search" autocomplete="off" /></label>
            <div class="p2p-chat-tabs"><button class="active" type="button">All</button></div>
            <div class="p2p-chat-contacts" id="p2pChatContacts"><div class="p2p-chat-loading">Loading chats...</div></div>
          </section>
          <section class="p2p-chat-room" id="p2pChatRoom">
            <div class="p2p-chat-welcome">${icon("mail")}<strong>Welcome to BRX Chat</strong><span>Select a contact to start chatting.</span></div>
          </section>
        </div>
      </section>
    `;
    try {
      const result = await marketplace.myTrades();
      const trades = result.trades || [];
      renderP2pChatContacts(trades, selectedId);
      const selected = trades.find((trade) => trade.id === selectedId);
      if (selected) await renderP2pChatRoom(selected);
      else document.querySelector(".p2p-chat-shell")?.classList.remove("has-selected");
      bindP2pChatSearch(trades, selectedId);
    } catch (error) {
      document.querySelector(".p2p-chat-shell")?.classList.remove("has-selected");
      document.querySelector("#p2pChatContacts").innerHTML = `<div class="p2p-chat-loading error">${escapeHtml(error.message || "Could not load chats.")}</div>`;
    }
  }

  function renderP2pChatContacts(trades, selectedId, query = "") {
    const list = document.querySelector("#p2pChatContacts");
    if (!list) return;
    const normalized = query.trim().toLowerCase();
    const filtered = trades.filter((trade) => !normalized || p2pCounterparty(trade).toLowerCase().includes(normalized) || shortId(trade.id).toLowerCase().includes(normalized));
    list.innerHTML = filtered.length ? filtered.map((trade) => {
      const name = p2pCounterparty(trade);
      const active = trade.id === selectedId;
      const presence = presenceMeta(trade.counterpartyLastSeenAt);
      return `<a class="p2p-chat-contact ${active ? "active" : ""}" href="#/p2p-chat?id=${encodeURIComponent(trade.id)}"><span class="presence-avatar ${presence.tone}">${displayInitial(name)}<i></i></span><div><strong>${escapeHtml(name)}</strong><small><span class="presence-inline ${presence.tone}"><i></i>${presence.label}</span> &middot; ${escapeHtml(chatPreview(trade))}</small></div><em>${chatDate(trade.updatedAt || trade.createdAt)}</em></a>`;
    }).join("") : `<div class="p2p-chat-loading">No chats yet.</div>`;
  }

  async function renderP2pChatRoom(trade, focusComposer = false) {
    const room = document.querySelector("#p2pChatRoom");
    if (!room) return;
    room.innerHTML = `<div class="p2p-chat-room-loading">Loading conversation...</div>`;
    const canSend = ["opened", "payment_sent", "disputed"].includes(trade.status);
    let messages = [];
    try {
      const result = await marketplace.tradeMessages(trade.id);
      messages = result.messages || [];
    } catch (error) {
      room.innerHTML = `<div class="p2p-chat-welcome"><strong>Chat unavailable</strong><span>${escapeHtml(error.message || "Could not load messages.")}</span></div>`;
      return;
    }
    const presence = presenceMeta(trade.counterpartyLastSeenAt);
    room.innerHTML = `
      <header class="p2p-chat-room-head"><div><a class="p2p-chat-back" href="#/p2p-chat" aria-label="Back to chats">${icon("back")}</a><span class="presence-avatar ${presence.tone}">${displayInitial(p2pCounterparty(trade))}<i></i></span><div><strong>${escapeHtml(p2pCounterparty(trade))}</strong><small>#${shortId(trade.id)} &middot; ${escapeHtml(statusText(trade.status))} &middot; ${presence.label}</small></div></div><a href="#/trades?id=${encodeURIComponent(trade.id)}">Open order</a></header>
      <div class="p2p-chat-room-messages" id="p2pChatRoomMessages" role="log" aria-live="polite">${messages.length ? messages.map(p2pChatMessage).join("") : `<div class="p2p-chat-welcome compact">${icon("mail")}<strong>No messages yet</strong><span>Use this chat to coordinate payment safely.</span></div>`}</div>
      ${canSend ? `<form class="p2p-chat-compose" id="p2pChatCompose"><label class="trade-chat-attach" for="p2pChatFile" aria-label="Attach image">+<input id="p2pChatFile" type="file" accept="image/png,image/jpeg,image/webp" /></label><textarea id="p2pChatInput" rows="1" maxlength="1000" placeholder="Type a message..."></textarea><button class="app-button" type="submit" aria-label="Send message">${icon("send")}</button><small id="p2pChatFileName"></small><div id="p2pChatError"></div></form>` : `<p class="p2p-chat-closed">This order is closed. Chat history remains available.</p>`}
    `;
    const messagesNode = document.querySelector("#p2pChatRoomMessages");
    if (messagesNode) messagesNode.scrollTop = messagesNode.scrollHeight;
    void loadP2pChatAttachments(trade.id);
    document.querySelector("#p2pChatCompose")?.addEventListener("submit", (event) => handleP2pChatSubmit(event, trade));
    document.querySelector("#p2pChatFile")?.addEventListener("change", (event) => {
      const target = document.querySelector("#p2pChatFileName");
      const fileName = event.currentTarget.files?.[0]?.name || "";
      if (target) target.textContent = fileName ? `Ready to send: ${fileName}` : "";
    });
    const chatInput = document.querySelector("#p2pChatInput");
    chatInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        document.querySelector("#p2pChatCompose")?.requestSubmit();
      }
    });
    if (focusComposer) chatInput?.focus();
  }

  async function handleP2pChatSubmit(event, trade) {
    event.preventDefault();
    const input = document.querySelector("#p2pChatInput");
    const error = document.querySelector("#p2pChatError");
    const button = event.currentTarget.querySelector("button");
    const body = input?.value.trim() || "";
    const selectedFile = document.querySelector("#p2pChatFile")?.files?.[0];
    if (!body && !selectedFile) return;
    if (error) error.textContent = "";
    if (button) button.disabled = true;
    try {
      const file = selectedFile ? await chatFilePayload(selectedFile) : undefined;
      await marketplace.sendTradeMessage(trade.id, { body, file });
      input.value = "";
      await renderP2pChatRoom(trade, true);
    } catch (err) {
      if (error) error.textContent = err.message || "Could not send message.";
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindP2pChatSearch(trades, selectedId) {
    document.querySelector("#p2pChatSearch")?.addEventListener("input", (event) => renderP2pChatContacts(trades, selectedId, event.currentTarget.value));
  }

  function p2pChatMessage(message) {
    const body = escapeHtml(message.body || "").replace(/\n/g, "<br>");
    return `<div class="p2p-chat-message ${message.isMine ? "mine" : "theirs"} ${message.hasAttachment ? "has-attachment" : ""}">${message.hasAttachment ? `<button class="chat-image-placeholder" type="button" data-p2p-chat-attachment="${escapeAttr(message.id)}"><span>Loading image...</span></button>` : ""}${body ? `<p>${body}</p>` : ""}<small>${chatDate(message.createdAt, true)}${message.isMine && message.isRead ? " &middot; Read" : ""}</small></div>`;
  }

  async function loadP2pChatAttachments(tradeId) {
    document.querySelectorAll("[data-p2p-chat-attachment]").forEach(async (target) => {
      try {
        const result = await marketplace.messageAttachment(tradeId, target.dataset.p2pChatAttachment);
        target.innerHTML = String(result.attachment.mimeType || "").startsWith("image/")
          ? `<img src="${result.attachment.dataUrl}" alt="Chat attachment" loading="lazy" decoding="async" />`
          : `<span>Open payment receipt</span>`;
        target.addEventListener("click", () => openChatImage(result.attachment));
      } catch (error) {
        target.innerHTML = `<span>${escapeHtml(error.message || "Image unavailable")}</span>`;
      }
    });
  }

  function chatFilePayload(file) {
    if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error("Chat image must be under 8 MB."));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ fileName: file.name, mimeType: file.type, dataBase64: String(reader.result || "").split(",")[1] || "" });
      reader.onerror = () => reject(new Error("Could not read the selected image."));
      reader.readAsDataURL(file);
    });
  }

  function openChatImage(attachment) {
    const viewer = document.createElement("div");
    viewer.className = "proof-viewer-backdrop";
    const isImage = String(attachment.mimeType || "").startsWith("image/");
    viewer.innerHTML = `<section class="proof-viewer"><header><strong>${escapeHtml(attachment.fileName || "Chat attachment")}</strong><button type="button" aria-label="Close">&times;</button></header><div class="proof-viewer-content">${isImage ? `<img src="${attachment.dataUrl}" alt="Chat attachment" />` : `<iframe src="${attachment.dataUrl}" title="Payment receipt"></iframe>`}</div></section>`;
    viewer.querySelector("button").addEventListener("click", () => viewer.remove());
    viewer.addEventListener("click", (event) => { if (event.target === viewer) viewer.remove(); });
    document.body.appendChild(viewer);
  }


  function p2pChatProfile(user) {
    const name = user.username || user.email || "BRX";
    const avatarUrl = String(user.avatarUrl || "").trim();
    const avatar = avatarUrl
      ? `<span class="has-image"><img src="${escapeAttr(avatarUrl)}" alt="" /></span>`
      : `<span>${displayInitial(name)}</span>`;
    return `<div class="p2p-chat-account">${avatar}<strong>${escapeHtml(name)}</strong><small>BRX account</small></div>`;
  }
  function p2pCounterparty(trade) {
    return trade.counterpartyName || trade.counterpartyEmail || "BRX user";
  }

  function chatPreview(trade) {
    if (trade.paymentMethod) return `${trade.paymentMethod} &middot; ${statusText(trade.status)}`;
    return statusText(trade.status);
  }

  function statusText(status) {
    return String(status || "open").replace(/_/g, " ");
  }

  function chatDate(value, timeOnly = false) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return timeOnly ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
  }

  function shortId(value) {
    return String(value || "").slice(0, 8).toUpperCase();
  }

  function displayInitial(value) {
    return String(value || "B").trim().slice(0, 1).toUpperCase() || "B";
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
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
  window.BRX.pages.renderMarketOrder = renderMarketOrder;
  window.BRX.pages.renderP2pChat = renderP2pChat;
})();
