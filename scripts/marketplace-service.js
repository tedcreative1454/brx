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

  function updateOfferStatus(offerId, status) {
    return requestJson(`/offers/${offerId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  function openTrade(offerId, assetAmount) {
    return requestJson("/trades", {
      method: "POST",
      body: JSON.stringify({ offerId, assetAmount }),
    });
  }

  function myTrades() {
    return requestJson("/trades/my");
  }

  function markPaymentSent(tradeId) {
    return requestJson(`/trades/${tradeId}/payment-sent`, { method: "POST" });
  }

  function releaseTrade(tradeId) {
    return requestJson(`/trades/${tradeId}/release`, { method: "POST" });
  }

  function cancelTrade(tradeId) {
    return requestJson(`/trades/${tradeId}/cancel`, { method: "POST" });
  }

  function disputeTrade(tradeId, reason) {
    return requestJson(`/trades/${tradeId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  window.BRX.marketplaceService = {
    listOffers,
    myOffers,
    createOffer,
    updateOfferStatus,
    openTrade,
    myTrades,
    markPaymentSent,
    releaseTrade,
    cancelTrade,
    disputeTrade,
  };
})();
