(function () {
  window.BRX = window.BRX || {};
  const { RATE, SELL_RATE } = window.BRX.config;

  function normalizeEmail(email) {
    return email.trim().toLowerCase();
  }

  function displayName(user) {
    return user.email.split("@")[0] || "trader";
  }

  async function hashPassword(password) {
    if (window.crypto && crypto.subtle) {
      const bytes = new TextEncoder().encode(password);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    let hash = 0;
    for (let i = 0; i < password.length; i += 1) {
      hash = ((hash << 5) - hash + password.charCodeAt(i)) | 0;
    }
    return `fallback-${hash}`;
  }

  function format(value, digits = 2) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function toNumber(value) {
    const parsed = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function currentRate(side) {
    return side === "sell" ? SELL_RATE : RATE;
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Morning";
    if (hour < 18) return "Afternoon";
    return "Evening";
  }

  window.BRX.utils = { normalizeEmail, displayName, hashPassword, format, toNumber, currentRate, greeting };
})();
