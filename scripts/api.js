(function () {
  window.BRX = window.BRX || {};
  const { API_BASES } = window.BRX.config;

  async function requestJson(path, options = {}) {
    let lastError;

    for (const base of API_BASES) {
      try {
        const { headers = {}, ...requestOptions } = options;
        const response = await fetch(`${base}${path}`, {
          ...requestOptions,
          headers: {
            "content-type": "application/json",
            ...(window.BRX.state.accessToken() ? { authorization: `Bearer ${window.BRX.state.accessToken()}` } : {}),
            ...headers,
          },
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = Array.isArray(payload?.message) ? payload.message.join(" ") : payload?.message;
          throw new Error(message || `BRX API request failed: ${response.status}`);
        }
        return payload;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError?.message === "Failed to fetch" || lastError instanceof TypeError) {
      throw new Error("BRX backend is offline. In backend folder run npm install, then npm run start:dev.");
    }

    throw lastError;
  }

  window.BRX.api = { requestJson };
})();

