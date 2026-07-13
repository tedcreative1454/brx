(function () {
  window.BRX = window.BRX || {};

  const { requestJson } = window.BRX.api;

  function listOffers(side) {
    return requestJson(`/offers${side ? `?side=${encodeURIComponent(side)}` : ""}`);
  }

  function myOffers() {
    return requestJson("/offers/my");
  }

  function createOffer(input) {
    return requestJson("/offers", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  function updateOffer(offerId, input) {
    return requestJson(`/offers/${encodeURIComponent(offerId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }
  function updateOfferStatus(offerId, status) {
    return requestJson(`/offers/${offerId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  function openTrade(offerId, assetAmount, paymentMethod) {
    return requestJson("/trades", {
      method: "POST",
      body: JSON.stringify({ offerId, assetAmount, paymentMethod }),
    });
  }

  function myTrades() {
    return requestJson("/trades/my");
  }

  function getTrade(tradeId) {
    return requestJson(`/trades/${tradeId}`);
  }

  function paymentProof(tradeId) {
    return requestJson(`/trades/${encodeURIComponent(tradeId)}/payment-proof`);
  }
  function tradeMessages(tradeId) {
    return requestJson(`/trades/${encodeURIComponent(tradeId)}/messages`);
  }

  function sendTradeMessage(tradeId, input) {
    return requestJson(`/trades/${encodeURIComponent(tradeId)}/messages`, {
      method: "POST",
      body: JSON.stringify(typeof input === "string" ? { body: input } : input),
    });
  }
  function messageAttachment(tradeId, messageId) {
    return requestJson(`/trades/${encodeURIComponent(tradeId)}/messages/${encodeURIComponent(messageId)}/attachment`);
  }
  function markPaymentSent(tradeId, input = {}) {
    return requestJson(`/trades/${tradeId}/payment-sent`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  function releaseTrade(tradeId) {
    return requestJson(`/trades/${tradeId}/release`, { method: "POST" });
  }

  function cancelTrade(tradeId) {
    return requestJson(`/trades/${tradeId}/cancel`, { method: "POST" });
  }

  function disputeTrade(tradeId, input) {
    const body = typeof input === "string" ? { reason: input } : input;
    return requestJson(`/trades/${tradeId}/dispute`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  function addTradeEvidence(tradeId, input) {
    return requestJson(`/trades/${tradeId}/evidence`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  window.BRX.marketplaceService = {
    listOffers,
    myOffers,
    createOffer,
    updateOffer,
    updateOfferStatus,
    openTrade,
    myTrades,
    getTrade,
    paymentProof,
    tradeMessages,
    sendTradeMessage,
    messageAttachment,
    markPaymentSent,
    releaseTrade,
    cancelTrade,
    disputeTrade,
    addTradeEvidence,
  };
})();
