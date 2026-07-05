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
            ...(requestOptions.body !== undefined && requestOptions.body !== null
              ? { "content-type": "application/json" }
              : {}),
            ...(window.BRX.state.accessToken() ? { authorization: `Bearer ${window.BRX.state.accessToken()}` } : {}),
            ...headers,
          },
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const responseMessage = payload?.message;
          const message = Array.isArray(responseMessage)
            ? responseMessage.join(" ")
            : typeof responseMessage === "object"
              ? responseMessage.message
              : responseMessage;
          const fallbackMessage =
            response.status >= 500
              ? "BRX backend is running, but the database service is not responding. Start Docker Desktop, then run docker compose up -d from the BRX folder."
              : `BRX API request failed: ${response.status}`;
          const error = new Error(message === "Internal server error" ? fallbackMessage : message || fallbackMessage);
          error.code = typeof responseMessage === "object" ? responseMessage.code : payload?.code;
          error.status = response.status;
          throw error;
        }
        return payload;
      } catch (error) {
        const isNetworkError = error instanceof TypeError || error?.message === "Failed to fetch";
        if (!isNetworkError) throw error;
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

