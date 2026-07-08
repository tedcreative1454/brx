(function () {
  window.BRX = window.BRX || {};

  const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const sameOriginApi = window.location.protocol.startsWith("http") ? [`${window.location.origin}/api`] : [];
  const localDirectApi = isLocalHost ? [`${window.location.protocol}//${window.location.hostname}:3000/api`] : [];
  const localTurnstileSiteKey = "1x00000000000000000000AA";
  const productionTurnstileSiteKey = "0x4AAAAAADxQ6xyoUkEdZUyL";

  window.BRX.config = Object.freeze({
    RATE: 185,
    SELL_RATE: 184,
    USERS_KEY: "brx_users_v1",
    SESSION_KEY: "brx_session_v1",
    PENDING_KEY: "brx_pending_email_v1",
    THEME_KEY: "brx_theme_v1",
    API_BASES: [...sameOriginApi, ...localDirectApi],
    // Use Cloudflare test keys locally; use the real widget on brxp2p.com.
    TURNSTILE_SITE_KEY: isLocalHost ? localTurnstileSiteKey : productionTurnstileSiteKey,
    APP_ROUTES: ["dashboard", "market", "p2p-chat", "ads", "trades", "wallet", "kyc", "profile", "settings", "notifications", "referrals", "admin"],
    NETWORKS: Object.freeze([
      Object.freeze({
        id: "BEP20",
        name: "BNB Smart Chain",
        token: "USDT BEP20",
        mark: "BNB",
        confirmations: "15 block confirmations",
        minDeposit: "Min. deposit > 1 USDT",
        arrival: "Est. arrival ~1-3 min",
        status: "available",
      }),
      Object.freeze({
        id: "TRC20",
        name: "TRON",
        token: "USDT TRC20",
        mark: "TRX",
        confirmations: "Coming soon",
        minDeposit: "Not enabled yet",
        arrival: "Planned network",
        status: "planned",
      }),
    ]),
    DEPOSIT_NETWORK: Object.freeze({
      name: "BNB Smart Chain",
      token: "USDT BEP20",
      confirmations: "15 block confirmations",
      minDeposit: "Min. deposit > 1 USDT",
      arrival: "Est. arrival ~1-3 min",
    }),
  });
})();
