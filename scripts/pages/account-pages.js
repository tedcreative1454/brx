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

  let activeWalletMode = "deposit";
  const selectedWalletNetwork = { deposit: "", withdraw: "" };
  let showOfferForm = false;
  let tradeCountdownTimer = null;

  function renderAds() {
    const user = requireUser();
    if (!user) return;
    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow">
        <div class="page-title"><h2>Your Ads</h2><button class="app-button" id="toggleOfferForm" type="button">${showOfferForm ? "Close" : "+ New Ad"}</button></div>
        ${showOfferForm ? offerForm() : ""}
        <div id="adsContent"><section class="empty-panel compact"><span class="mini-icon">...</span><h3>Loading ads</h3></section></div>
      </section>
    `;
    document.querySelector("#toggleOfferForm").addEventListener("click", () => {
      showOfferForm = !showOfferForm;
      renderAds();
    });
    document.querySelector("#offerForm")?.addEventListener("submit", handleCreateOffer);
    void loadMyAds();
  }

  function renderTrades() {
    const user = requireUser();
    if (!user) return;
    const tradeId = window.BRX.router.routeParams().get("id");
    if (tradeCountdownTimer) {
      clearInterval(tradeCountdownTimer);
      tradeCountdownTimer = null;
    }
    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow">
        <div class="page-title">
          <div>
            <p class="app-label blue">${tradeId ? "Trade detail" : "P2P trades"}</p>
            <h2>${tradeId ? "Escrow trade" : "My Trades"}</h2>
          </div>
          <a class="app-button" href="${tradeId ? "#/trades" : "#/market"}">${tradeId ? "Back to trades" : "Trade"}</a>
        </div>
        <div id="tradesContent"><section class="empty-panel compact"><span class="mini-icon">...</span><h3>Loading trades</h3></section></div>
      </section>
    `;
    if (tradeId) void loadTradeDetail(tradeId);
    else void loadMyTrades();
  }

  function offerForm() {
    return `
      <form class="offer-form" id="offerForm">
        <div class="kyc-form-grid">
          <label class="form-field"><span>Ad type</span><select id="offerSide" required><option value="sell">Sell USDT</option><option value="buy">Buy USDT</option></select></label>
          <label class="form-field"><span>USDT amount</span><input id="offerAmount" inputmode="decimal" placeholder="100.00" required /></label>
          <label class="form-field"><span>Price per USDT in ETB</span><input id="offerPrice" inputmode="decimal" placeholder="185.00" required /></label>
          <label class="form-field"><span>Minimum ETB order</span><input id="offerMin" inputmode="decimal" placeholder="1000" required /></label>
          <label class="form-field"><span>Maximum ETB order</span><input id="offerMax" inputmode="decimal" placeholder="10000" required /></label>
        </div>
        <div class="payment-methods">
          <label><input type="checkbox" value="M-Pesa" checked /> M-Pesa</label>
          <label><input type="checkbox" value="Bank" /> Bank</label>
          <label><input type="checkbox" value="Airtel Money" /> Airtel Money</label>
        </div>
        <div class="form-error" id="formError"></div>
        <button class="app-button" type="submit">Post Ad</button>
      </form>
    `;
  }

  async function loadMyAds() {
    const content = document.querySelector("#adsContent");
    try {
      const result = await marketplace.myOffers();
      const offers = result.offers || [];
      content.innerHTML = offers.length ? `
        <div class="tabs-bar"><button class="active">All</button><button>Active</button><button>Paused</button><button>Cancelled</button></div>
        <div class="app-table">${offers.map(myOfferRow).join("")}</div>
      ` : `<section class="empty-panel"><span class="mini-icon">Ad</span><h3>No ads yet</h3><p>Post your first P2P trade offer.</p><button class="app-button" id="emptyPostAd" type="button">+ Post an Ad</button></section>`;

      document.querySelector("#emptyPostAd")?.addEventListener("click", () => {
        showOfferForm = true;
        renderAds();
      });
      document.querySelectorAll("[data-offer-status]").forEach((button) => {
        button.addEventListener("click", () => handleOfferStatus(button.dataset.offerId, button.dataset.offerStatus));
      });
    } catch (error) {
      content.innerHTML = `<section class="warning-card"><h3>Could not load ads</h3><p>${escapeHtml(error.message || "Start the BRX backend and reload.")}</p></section>`;
    }
  }

  function myOfferRow(offer) {
    const action = offer.side === "sell" ? "Sell" : "Buy";
    return `
      <div class="table-row my-ad-row">
        <div><strong>${action} USDT</strong><small>${offer.status}</small></div>
        <strong class="table-price ${offer.side === "buy" ? "" : "sell-price"}">${format(Number(offer.price))}</strong>
        <div><strong>${format(Number(offer.availableAmount))} USDT</strong><small>${format(Number(offer.minFiat))}-${format(Number(offer.maxFiat))} ETB</small></div>
        <div class="chips">${offer.paymentMethods.map((method) => `<span>${escapeHtml(method)}</span>`).join("")}</div>
        <div class="row-actions">
          ${offer.status === "active" ? `<button class="app-ghost-button small" type="button" data-offer-id="${offer.id}" data-offer-status="paused">Pause</button>` : ""}
          ${offer.status === "paused" ? `<button class="app-button small" type="button" data-offer-id="${offer.id}" data-offer-status="active">Resume</button>` : ""}
          ${offer.status !== "cancelled" ? `<button class="danger-button small" type="button" data-offer-id="${offer.id}" data-offer-status="cancelled">Cancel</button>` : ""}
        </div>
      </div>
    `;
  }

  async function handleCreateOffer(event) {
    event.preventDefault();
    showError("");
    const paymentMethods = [...document.querySelectorAll(".payment-methods input:checked")].map((input) => input.value);
    try {
      await marketplace.createOffer({
        side: document.querySelector("#offerSide").value,
        amount: document.querySelector("#offerAmount").value,
        price: document.querySelector("#offerPrice").value,
        minFiat: document.querySelector("#offerMin").value,
        maxFiat: document.querySelector("#offerMax").value,
        paymentMethods,
      });
      showToast("Ad posted.");
      showOfferForm = false;
      renderAds();
    } catch (error) {
      showError(error.message || "Could not post ad.");
    }
  }

  async function handleOfferStatus(offerId, status) {
    try {
      await marketplace.updateOfferStatus(offerId, status);
      showToast("Ad updated.");
      await loadMyAds();
    } catch (error) {
      showToast(error.message || "Could not update ad.");
    }
  }

  async function loadMyTrades() {
    const content = document.querySelector("#tradesContent");
    try {
      const result = await marketplace.myTrades();
      const trades = result.trades || [];
      content.innerHTML = trades.length
        ? `<div class="app-table">${trades.map(tradeRow).join("")}</div>`
        : `<section class="empty-panel"><span class="mini-icon">Trade</span><h3>No trades yet</h3><p>Start trading on the marketplace.</p><a class="app-button" href="#/market">Browse Marketplace</a></section>`;

      document.querySelectorAll("[data-trade-action]").forEach((button) => {
        button.addEventListener("click", () => handleTradeAction(button.dataset.tradeId, button.dataset.tradeAction));
      });
      document.querySelectorAll("[data-trade-open]").forEach((button) => {
        button.addEventListener("click", () => {
          location.hash = `#/trades?id=${encodeURIComponent(button.dataset.tradeOpen)}`;
        });
      });
    } catch (error) {
      content.innerHTML = `<section class="warning-card"><h3>Could not load trades</h3><p>${escapeHtml(error.message || "Start the BRX backend and reload.")}</p></section>`;
    }
  }

  async function loadTradeDetail(tradeId) {
    const content = document.querySelector("#tradesContent");
    try {
      const result = await marketplace.getTrade(tradeId);
      const trade = result.trade;
      content.innerHTML = tradeDetail(trade);
      bindTradeDetail(trade);
      startTradeCountdown(trade);
    } catch (error) {
      content.innerHTML = `<section class="warning-card"><h3>Could not load trade</h3><p>${escapeHtml(error.message || "Start the BRX backend and reload.")}</p></section>`;
    }
  }

  function tradeRow(trade) {
    const roleText = trade.role === "buyer" ? "You buy USDT" : "You sell USDT";
    const deadline = trade.status === "opened" && trade.expiresAt ? `<small>Pay before ${dateTime(trade.expiresAt)}</small>` : "";
    const payment = trade.paymentSentAt ? `<small>Payment sent ${dateTime(trade.paymentSentAt)}</small>` : "";
    const reason = trade.cancelledReason || trade.disputeReason || "";
    return `
      <div class="table-row trade-row">
        <div><strong>${roleText}</strong><small>Counterparty: ${escapeHtml(trade.counterpartyEmail || "BRX user")}</small>${deadline}${payment}</div>
        <div><strong>${format(Number(trade.assetAmount))} USDT</strong><small>${format(Number(trade.fiatAmount))} ETB</small></div>
        <div><strong>${statusLabel(trade.status)}</strong><small>${dateTime(trade.createdAt)}</small>${reason ? `<small>${escapeHtml(reason)}</small>` : ""}</div>
        <div class="row-actions"><button class="app-ghost-button small" type="button" data-trade-open="${escapeAttr(trade.id)}">View</button>${tradeActions(trade)}</div>
      </div>
    `;
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
              <p class="app-muted">${format(Number(trade.fiatAmount))} ETB · ${format(Number(trade.offerPrice || Number(trade.fiatAmount) / Number(trade.assetAmount)))} ETB/USDT</p>
            </div>
            <span class="status-pill ${trade.status === "disputed" ? "warning" : ""}">${statusLabel(trade.status)}</span>
          </div>

          ${trade.status === "opened" ? countdownBlock(trade) : ""}
          ${trade.role === "buyer" ? buyerPaymentBlock(trade, sellerMethods) : sellerPaymentBlock(trade)}

          <div class="trade-actions-panel">${tradeActions(trade)}</div>
        </article>

        <aside class="app-card trade-side-panel">
          <p class="app-label">Counterparty</p>
          <strong>${escapeHtml(trade.counterpartyEmail || "BRX user")}</strong>
          <div class="trade-timeline">${tradeTimeline(trade)}</div>
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

  function tradeTimeline(trade) {
    const steps = [
      ["Opened", trade.createdAt, true],
      ["Payment sent", trade.paymentSentAt, Boolean(trade.paymentSentAt)],
      ["Released", trade.releasedAt, trade.status === "released"],
      ["Disputed", trade.disputedAt, trade.status === "disputed"],
      ["Closed", trade.cancelledAt || trade.resolvedAt, ["cancelled", "expired"].includes(trade.status) || Boolean(trade.resolvedAt)],
    ];
    return steps.map(([label, value, active]) => `
      <div class="timeline-step ${active ? "active" : ""}">
        <span></span>
        <div><strong>${label}</strong><small>${value ? dateTime(value) : "Pending"}</small></div>
      </div>
    `).join("");
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
    return `
      <section class="escrow-workspace">
        <div class="escrow-topline">
          <button class="icon-link" type="button" data-back-to-trades>&larr; My Trades</button>
          <span>Trade #${shortTradeId(trade.id)}</span>
          <span class="status-pill ${trade.status === "disputed" ? "warning" : ""}">${statusLabel(trade.status)}</span>
        </div>
        <section class="escrow-grid">
          <article class="escrow-main">
            <div class="trade-detail-head">
              <div>
                <p class="app-label blue">${isBuyer ? "Buy USDT" : "Sell USDT"}</p>
                <h3>${format(Number(trade.assetAmount))} USDT</h3>
                <p class="app-muted">${format(Number(trade.fiatAmount))} ETB at ${format(Number(trade.offerPrice || Number(trade.fiatAmount) / Number(trade.assetAmount)))} ETB/USDT</p>
              </div>
            </div>
            ${escrowStepper(trade)}
            ${isBuyer ? buyerPaymentBlock(trade, sellerMethods) : sellerPaymentBlock(trade)}
            ${countdownBlock(trade)}
            ${tradeSafetyNote(trade)}
            <div class="trade-actions-panel">${tradeActions(trade)}</div>
          </article>

          <aside class="escrow-side">
            <div class="counterparty-card">
              <div class="avatar small">${displayInitial(counterpartyName(trade))}</div>
              <div>
                <strong>${escapeHtml(counterpartyName(trade))}</strong>
                <small>${escapeHtml(trade.counterpartyEmail || "BRX user")}</small>
              </div>
            </div>
            ${isBuyer ? sellerPaymentSummary(trade, sellerMethods) : buyerPaymentSummary(trade)}
            <div class="trade-chat-box">
              <div class="mini-icon">MSG</div>
              <strong>No messages yet</strong>
              <small>Trade chat will appear here.</small>
            </div>
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
      <section class="escrow-stepper">
        ${steps.map(([label, number]) => `
          <div class="escrow-step ${stage > number ? "done" : ""} ${stage === number ? "active" : ""}">
            <span>${stage > number ? "OK" : number}</span>
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
        <section class="payment-instructions">
          <p class="app-label">Waiting for buyer</p>
          <h4>${format(Number(trade.assetAmount))} USDT locked</h4>
          <p class="app-muted">Your USDT is locked in escrow. Wait for the buyer to send ETB and submit payment proof.</p>
        </section>
      `;
    }
    if (trade.status === "payment_sent") {
      return `
        <section class="payment-instructions">
          <p class="app-label">Buyer marked payment sent</p>
          <h4>Confirm ${format(Number(trade.fiatAmount))} ETB</h4>
          <p class="app-muted">Check your receiving account carefully. Release USDT only after the ETB payment is fully received.</p>
          ${paymentProofBlock(trade)}
        </section>
      `;
    }
    if (trade.status === "disputed") {
      return `<p class="deposit-note">This trade is under admin review. Add evidence below if needed.</p>`;
    }
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
      return `<div class="proof-card empty"><strong>No payment proof yet</strong><small>Proof appears here after the buyer marks payment sent.</small></div>`;
    }
    return `
      <div class="proof-card">
        ${trade.paymentReference ? `<div><small>Reference</small><strong>${escapeHtml(trade.paymentReference)}</strong></div>` : ""}
        ${trade.paymentProofName ? `<div><small>Receipt</small><strong>${escapeHtml(trade.paymentProofName)}</strong></div>` : ""}
      </div>
    `;
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
      ? `<button class="danger-button small" type="button" data-trade-id="${escapeAttr(trade.id)}" data-trade-action="dispute">Open dispute</button>`
      : "";

    if (trade.status === "opened" && trade.role === "buyer") {
      return `<button class="app-button small" type="button" data-trade-id="${trade.id}" data-trade-action="payment-sent">Payment sent</button><button class="app-ghost-button small" type="button" data-trade-id="${trade.id}" data-trade-action="cancel">Cancel</button>`;
    }
    if (trade.status === "payment_sent" && trade.role === "seller") {
      return `<button class="app-button small" type="button" data-trade-id="${trade.id}" data-trade-action="release">Release USDT</button>${disputeButton}`;
    }
    if (trade.status === "payment_sent" && trade.role === "buyer") {
      return `<span class="app-muted">Waiting for seller to release</span>${disputeButton}`;
    }
    if (trade.status === "opened") {
      return `<button class="app-ghost-button small" type="button" data-trade-id="${trade.id}" data-trade-action="cancel">Cancel</button>${disputeButton}`;
    }
    if (trade.status === "disputed") {
      return `<span class="status-pill warning">Admin review</span>`;
    }
    return `<span class="app-muted">No action</span>`;
  }

  async function handleTradeAction(tradeId, action) {
    try {
      if (action === "payment-sent") {
        const trade = await marketplace.tradeDetail(tradeId);
        openPaymentSentModal(trade);
        return;
      }
      if (action === "release") {
        const trade = await marketplace.tradeDetail(tradeId);
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
    document.querySelector("#evidenceForm")?.addEventListener("submit", (event) => handleEvidenceSubmit(event, trade));
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
    const errorNode = document.querySelector("#paymentSentError");
    errorNode.textContent = "";
    try {
      const reference = document.querySelector("#paymentReference").value.trim();
      const file = await filePayload("paymentProofFile");
      await marketplace.markPaymentSent(trade.id, { reference, file });
      closeTradeModal();
      showToast("Payment proof submitted.");
      await loadTradeDetail(trade.id);
    } catch (error) {
      errorNode.textContent = error.message || "Could not submit payment proof.";
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
    modal.querySelector("[data-close-modal]").addEventListener("click", closeTradeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeTradeModal();
    });
    modal.querySelector("#releaseTradeForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorNode = document.querySelector("#releaseError");
      errorNode.textContent = "";
      try {
        await marketplace.releaseTrade(trade.id);
        closeTradeModal();
        showToast("USDT released.");
        await loadTradeDetail(trade.id);
      } catch (error) {
        errorNode.textContent = error.message || "Could not release trade.";
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
    const total = Number(balance.available) + Number(balance.locked) + Number(balance.pendingDeposit) + Number(balance.pendingWithdrawal);

    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow">
        <section class="app-card wallet-page-card">
          <p class="app-label">USDT balance</p>
          <h2>${format(total)} <span>USDT</span></h2>
          <p class="app-muted">Deposit USDT to start trading.</p>
          <div class="balance-breakdown">
            <div><span>Available</span><strong>${format(Number(balance.available))} USDT</strong></div>
            <div><span>Locked</span><strong>${format(Number(balance.locked))} USDT</strong></div>
            <div><span>Pending deposit</span><strong>${format(Number(balance.pendingDeposit))} USDT</strong></div>
            <div><span>Pending withdrawal</span><strong>${format(Number(balance.pendingWithdrawal))} USDT</strong></div>
          </div>
          <div class="wallet-mode-tabs">
            <button class="${activeWalletMode === "deposit" ? "active" : ""}" type="button" data-wallet-mode="deposit">${icon("download")}Deposit</button>
            <button class="${activeWalletMode === "withdraw" ? "active" : ""}" type="button" data-wallet-mode="withdraw">${icon("upload")}Withdraw</button>
            <button class="${activeWalletMode === "transfer" ? "active" : ""}" type="button" data-wallet-mode="transfer">${icon("send")}Transfer</button>
          </div>
        </section>

        ${walletModePanel(activeWalletMode, depositAddress, user)}

        <section class="empty-panel compact"><span class="mini-icon">tx</span><h3>No transactions yet</h3></section>
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
      document.querySelector("#transferForm").addEventListener("submit", handleUnavailableWalletAction);
      return;
    }

    if (activeWalletMode === "deposit" && selectedNetwork === "BEP20" && !depositAddress) {
      void syncBackendWallet(user).then(() => renderWallet()).catch((error) => {
        console.error(error);
        showToast("Backend wallet request failed. Check Console for details.");
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
          ${!selected ? `<p class="network-helper">Choose BNB Smart Chain for BEP20 deposits. TRON is shown only as a future network.</p>` : ""}
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
      <section class="wallet-panel wallet-form-panel">
        <div class="sheet-head">
          <div>
            <p class="app-label blue">Internal transfer</p>
            <h2>Send to BRX user</h2>
          </div>
          <span class="sheet-badge">Instant</span>
        </div>
        <form class="wallet-action-form" id="transferForm">
          <label class="form-field"><span>Recipient email or BRX ID</span><input id="transferRecipient" placeholder="user@example.com" /></label>
          <label class="form-field"><span>Amount</span><input id="transferAmount" inputmode="decimal" placeholder="0.00" /></label>
          <p class="deposit-note">Internal transfers will move funds in the database ledger with no blockchain transaction. The backend transfer endpoint is the next wallet feature.</p>
          <button class="app-button" type="submit">Continue transfer</button>
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
  function handleUnavailableWalletAction(event) {
    event.preventDefault();
    showToast("This flow needs the next backend wallet endpoint before real funds can move.");
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
            <label class="form-field"><span>Phone number</span><input id="kycPhone" placeholder="+254..." required /></label>
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

  function renderProfile() {
    const user = requireUser();
    if (!user) return;
    refs.app.innerHTML = `
      <section class="exchange-app app-page-narrow">
        <div class="page-title"><div><p class="app-label blue">Profile</p><h2>View Profile</h2></div></div>
        <section class="app-card account-detail-card">
          <span class="mini-icon">${displayInitial(user.email)}</span>
          <div>
            <h3>${escapeHtml(user.email.split("@")[0])}</h3>
            <p class="app-muted">${escapeHtml(user.email)}</p>
            <p class="app-muted">KYC status: ${escapeHtml(user.kycStatus || "unsubmitted")}</p>
          </div>
        </section>
      </section>
    `;
  }

  function renderSettings() {
    const user = requireUser();
    if (!user) return;
    const activeTab = validSettingsTab(window.BRX.router.routeParams().get("tab"));
    refs.app.innerHTML = `
      <section class="exchange-app app-page-wide settings-page">
        <div class="settings-head">
          <h2>Account Settings</h2>
          <p>Manage your profile, security, payment details, and trading preferences.</p>
        </div>
        ${settingsTabs(activeTab)}
        <div class="settings-content">${settingsContent(activeTab, user)}</div>
      </section>
    `;
    bindSettingsEvents();
    if (activeTab === "security" && securityService && !user.securityLoaded) {
      void securityService.loadSecurity().then(() => {
        if (window.BRX.router.routeName() === "settings") renderSettings();
      }).catch((error) => {
        console.error(error);
        showToast("Start the BRX backend and run migrations to load security settings.");
      });
    }
    if (!user.accountSettingsLoaded && accountService) {
      void accountService.loadSettings().then(() => {
        if (window.BRX.router.routeName() === "settings") renderSettings();
      }).catch((error) => {
        console.error(error);
        showToast("Start the BRX backend and run migrations to load account settings.");
      });
    }
  }

  function validSettingsTab(tab) {
    return ["profile", "security", "payments", "addresses", "account", "notifications", "trades"].includes(tab) ? tab : "profile";
  }

  function settingsTabs(activeTab) {
    const tabs = [
      ["profile", "user", "Profile"],
      ["security", "shield", "Security"],
      ["payments", "card", "Payments"],
      ["addresses", "mapPin", "Addresses"],
      ["account", "settings", "Account"],
      ["notifications", "bell", "Notifications"],
      ["trades", "trades", "Trades"],
    ];

    return `
      <nav class="settings-tabs" aria-label="Account settings">
        ${tabs.map(([key, iconName, label]) => `
          <button class="settings-tab ${activeTab === key ? "active" : ""}" type="button" data-settings-tab="${key}">
            ${icon(iconName)}<span>${label}</span>
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
      <section class="settings-identity">
        <div class="settings-avatar-wrap">
          <span class="settings-avatar">${displayInitial(user.email)}</span>
          <button class="settings-camera settings-toast-action" type="button" data-toast="Profile photo upload will be connected to storage next.">${icon("camera")}</button>
        </div>
        <div class="settings-id-main">
          <span class="settings-muted">${brxId(user)} <button class="inline-icon-button settings-copy-id" type="button" title="Copy BRX ID">${icon("copy")}</button></span>
          <h3>${escapeHtml(accountDisplayName(user))}</h3>
        </div>
      </section>

      <form class="settings-card settings-form-card" id="settingsProfileForm">
        <div class="settings-card-head"><div><h3>${icon("user")} Profile Details</h3><p>These details are stored in PostgreSQL and used on BRX account pages.</p></div></div>
        <div class="settings-form-grid">
          <label class="form-field"><span>Full name</span><input id="settingsFullName" value="${escapeAttr(user.fullName || user.kycSubmission?.name || "")}" placeholder="Your legal or display name" /></label>
          <label class="form-field"><span>Phone number</span><input id="settingsPhone" value="${escapeAttr(user.phone || "")}" placeholder="+254..." /></label>
          <label class="form-field"><span>Trader username</span><input id="settingsUsername" value="${escapeAttr(user.username || "")}" placeholder="habeshahit1454" /></label>
        </div>
        <div class="settings-form-actions"><button class="app-button" type="submit">Save profile</button></div>
      </form>

      <section class="settings-card settings-card-flat">
        ${settingsRow("mail", "Email", escapeHtml(user.email), user.emailVerified ? statusBadge("Verified", "success") : statusBadge("Not verified", "warning"))}
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
      <section class="settings-card settings-form-card">
        <div class="settings-card-head">
          <div><h3>${icon("card")} Add Payment Method</h3><p>Add ETB receiving details for P2P trades. Sellers will show these after a buyer opens a trade.</p></div>
        </div>
        <form id="paymentMethodForm" class="settings-payment-form">
          <div class="settings-form-grid payment-grid">
            <label class="form-field"><span>Type</span><select id="paymentType"><option value="mpesa">M-Pesa</option><option value="airtel_money">Airtel Money</option><option value="bank">Bank transfer</option><option value="other">Other</option></select></label>
            <label class="form-field"><span>Label</span><input id="paymentLabel" placeholder="My M-Pesa" /></label>
            <label class="form-field"><span>Account name</span><input id="paymentAccountName" placeholder="Name on account" required /></label>
            <label class="form-field"><span>Phone number</span><input id="paymentPhone" placeholder="+254..." /></label>
            <label class="form-field"><span>Bank name</span><input id="paymentBank" placeholder="Bank name" /></label>
            <label class="form-field"><span>Account number</span><input id="paymentAccountNumber" placeholder="Bank account number" /></label>
          </div>
          <label class="check-row settings-default-check"><input id="paymentDefault" type="checkbox" ${methods.length ? "" : "checked"} /><span>Make this my default payment method</span></label>
          <div class="settings-form-actions"><button class="app-button" type="submit">Save payment method</button></div>
        </form>
      </section>

      <section class="settings-card settings-card-flat">
        <div class="settings-card-head">
          <div><h3>${icon("card")} Payment Methods</h3><p>Your active ETB receiving accounts.</p></div>
          ${statusBadge(`${methods.length} saved`, "neutral")}
        </div>
        ${methods.length ? methods.map(paymentMethodRow).join("") : settingsEmpty("card", "No payment methods yet", "Add M-Pesa, bank, or mobile money details before posting sell ads.")}
      </section>
    `;
  }

  function settingsAddresses(user) {
    const addresses = user.withdrawalAddresses || [];
    return `
      <section class="settings-card settings-form-card">
        <div class="settings-card-head">
          <div><h3>${icon("mapPin")} Save Withdrawal Address</h3><p>Only save addresses you control. Withdrawals will later require email and 2FA confirmation.</p></div>
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
    return `
      <section class="settings-card settings-card-flat">
        <div class="settings-card-head"><div><h3>${icon("user")} Account Overview</h3><p>Your identity and verification status on BRX.</p></div></div>
        ${settingsRow("user", "Full Name", escapeHtml(accountDisplayName(user)), "")}
        ${settingsRow("mail", "Email", escapeHtml(user.email), "")}
        ${settingsRow("calendar", "Member Since", memberSince(user), "")}
        ${settingsRow("shield", "KYC Status", kycLabel(user.kycStatus), statusBadge(kycTier(user), "neutral"))}
        ${settingsRow("lock", "Two-Factor Auth", "Disabled", statusBadge("Disabled", "neutral"))}
      </section>

      <section class="settings-card settings-card-flat">
        <div class="settings-card-head"><div><h3>${icon("market")} Merchant Application</h3><p>Request higher limits when your KYC and payment methods are ready.</p></div>${statusBadge("Placeholder", "warning")}</div>
        ${settingsRow("shield", "Unverified limit", "1,000 USDT", "")}
        ${settingsRow("check", "Verified limit", "5,000 USDT", "")}
        ${settingsRow("market", "Merchant limit", "Up to 100,000 USDT", "")}
      </section>

      <div class="danger-divider"><span>${icon("info")} Danger Zone</span></div>
      <section class="settings-card settings-card-flat">
        ${settingsRow("logOut", "Sign Out All Other Devices", "Revoke active sessions except this one.", actionButton("Revoke Sessions", "Session revocation will be connected to backend sessions next.", "warning"))}
        ${settingsRow("database", "Request Data Export", "Download profile, trade history, and KYC records.", actionButton("Export My Data", "Data export request placeholder saved.", "success"))}
        ${settingsRow("user", "Close Account", "A 14-day grace period should apply before deletion.", actionButton("Close Account", "Account closure requires backend approval flow.", "danger"), "danger")}
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
            <label class="form-field"><span>Preferred payment rails</span><input id="preferredPaymentRails" value="${escapeAttr(rails.join(", "))}" placeholder="M-Pesa, Bank transfer" /></label>
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
    document.querySelector("#paymentMethodForm")?.addEventListener("submit", handlePaymentMethodSubmit);
    document.querySelector("#tradePreferencesForm")?.addEventListener("submit", handleTradePreferencesSubmit);
    document.querySelector("#passwordChangeForm")?.addEventListener("submit", handlePasswordChange);
    document.querySelector("#withdrawalAddressForm")?.addEventListener("submit", handleWithdrawalAddressSubmit);
    document.querySelector("#startTwoFactorSetup")?.addEventListener("click", handleStartTwoFactorSetup);
    document.querySelector("#confirmTwoFactor")?.addEventListener("click", handleConfirmTwoFactor);
    document.querySelector("#disableTwoFactor")?.addEventListener("click", handleDisableTwoFactor);
    document.querySelector("#revokeOtherSessions")?.addEventListener("click", handleRevokeOtherSessions);

    document.querySelectorAll("[data-payment-delete]").forEach((button) => {
      button.addEventListener("click", () => handlePaymentDelete(button.dataset.paymentDelete));
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
      });
      showToast("Profile saved.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not save profile.");
    }
  }

  async function handlePaymentMethodSubmit(event) {
    event.preventDefault();
    try {
      await accountService.createPaymentMethod({
        type: document.querySelector("#paymentType").value,
        label: document.querySelector("#paymentLabel").value,
        accountName: document.querySelector("#paymentAccountName").value,
        phoneNumber: document.querySelector("#paymentPhone").value,
        bankName: document.querySelector("#paymentBank").value,
        accountNumber: document.querySelector("#paymentAccountNumber").value,
        isDefault: document.querySelector("#paymentDefault").checked,
      });
      showToast("Payment method saved.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not save payment method.");
    }
  }

  async function handlePaymentDelete(paymentMethodId) {
    if (!paymentMethodId || !confirm("Remove this payment method?")) return;
    try {
      await accountService.deletePaymentMethod(paymentMethodId);
      showToast("Payment method removed.");
      renderSettings();
    } catch (error) {
      showToast(error.message || "Could not remove payment method.");
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
        <span class="settings-row-main"><strong>${escapeHtml(title)}</strong><small>Last seen ${dateTime(session.lastSeenAt)} · Created ${dateTime(session.createdAt)}</small></span>
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
        <span class="settings-row-main"><strong>${escapeHtml(address.label)}</strong><small>${escapeHtml(address.network)} · ${escapeHtml(shortAddress(address.address))}</small></span>
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
    try {
      await accountService.updateWithdrawalAddress(addressId, { isDefault: true });
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
    return `
      <div class="settings-row payment-method-row">
        <span class="settings-row-icon">${icon(method.type === "bank" ? "card" : "phone")}</span>
        <span class="settings-row-main"><strong>${escapeHtml(method.label || paymentTypeLabel(method.type))}</strong><small>${escapeHtml(paymentMethodDetail(method))}</small></span>
        <span class="settings-row-aside payment-actions">
          ${method.isDefault ? statusBadge("Default", "success") : `<button class="settings-action" type="button" data-payment-default="${escapeAttr(method.id)}">Make default</button>`}
          <button class="settings-action danger" type="button" data-payment-delete="${escapeAttr(method.id)}">Remove</button>
        </span>
      </div>
    `;
  }

  function paymentTypeLabel(type) {
    if (type === "mpesa") return "M-Pesa";
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

  function filePayload(id) {
    const input = document.querySelector(`#${id}`);
    const file = input?.files?.[0];
    if (!file) return Promise.resolve(null);

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
  window.BRX.pages.renderSettings = renderSettings;
  window.BRX.pages.renderReferrals = renderReferrals;
})();













