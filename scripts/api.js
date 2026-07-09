(function () {
  window.BRX = window.BRX || {};
  const { API_BASES } = window.BRX.config;

  async function requestJson(path, options = {}) {
    let lastError;

    for (const base of API_BASES) {
      try {
        const { headers = {}, ...requestOptions } = options;
        const authToken = window.BRX.state?.accessToken?.() || "";
        const response = await fetch(`${base}${path}`, {
          ...requestOptions,
          credentials: "include",
          headers: {
            ...(requestOptions.body !== undefined && requestOptions.body !== null
              ? { "content-type": "application/json" }
              : {}),
            ...(authToken && !headers.authorization ? { authorization: `Bearer ${authToken}` } : {}),
            ...headers,
          },
        });

        const payload = await response.json().catch(() => null);
        const responseMessage = payload?.message;
        const message = Array.isArray(responseMessage)
          ? responseMessage.join(" ")
          : typeof responseMessage === "object"
            ? responseMessage.message
            : responseMessage;
        const isSameOriginApi = base === `${window.location.origin}/api`;
        const isLocalDirectApi = /^https?:\/\/(localhost|127\.0\.0\.1):3000\/api$/.test(base);

        if (!response.ok && isSameOriginApi && API_BASES.length > 1 && [404, 405, 501].includes(response.status)) {
          lastError = new Error("Local /api proxy is not available.");
          continue;
        }
        if (!response.ok && path === "/auth/me" && response.status === 401 && isLocalDirectApi && API_BASES.length > 1 && String(message || "").toLowerCase().includes("missing access token")) {
          lastError = new Error(message || "Missing access token.");
          continue;
        }
        if (!response.ok) {
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