(function () {
  window.BRX = window.BRX || {};
  const { API_BASES } = window.BRX.config;
  const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

  function connectionErrorMessage() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "No internet connection. Check your connection and try again.";
    }
    return "We could not connect to BRX. Check your internet connection and try again.";
  }

  function statusErrorMessage(status) {
    if (status === 400 || status === 422) return "Please check the information you entered and try again.";
    if (status === 401) return "Your session has expired. Sign in and try again.";
    if (status === 403) return "You do not have permission to complete this action.";
    if (status === 404) return "The requested information is no longer available.";
    if (status === 409) return "This action conflicts with a recent update. Refresh and try again.";
    if (status === 413) return "The selected file is too large. Choose a smaller file and try again.";
    if (status === 429) return "Too many attempts. Please wait a moment and try again.";
    if (status >= 500) return "BRX is temporarily unavailable. Please try again shortly.";
    return "We could not complete your request. Please try again.";
  }

  function safeServerMessage(message, status) {
    const text = String(message || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 240 || status >= 500) return "";
    const technicalPattern = /(?:internal server|stack trace|exception|localhost|127\.0\.0\.1|backend|\bapi\b|npm\s|node_modules|docker|postgres|database|sqlstate|econn|enotfound|failed to fetch|access token|authorization code|private key|file path|secret state|push subscription|cannot\s+(?:get|post|put|patch|delete)|\/api\/)/i;
    return technicalPattern.test(text) ? "" : text;
  }

  async function requestJson(path, options = {}) {
    let lastError;

    for (const base of API_BASES) {
      let timeoutId;
      let requestTimedOut = false;
      try {
        const { headers = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...requestOptions } = options;
        const controller = new AbortController();
        timeoutId = window.setTimeout(() => {
          requestTimedOut = true;
          controller.abort();
        }, Math.max(1000, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS));
        const authToken = window.BRX.state?.accessToken?.() || "";
        const response = await fetch(`${base}${path}`, {
          ...requestOptions,
          signal: controller.signal,
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
          lastError = new Error("We could not connect to BRX. Please try again.");
          continue;
        }
        if (!response.ok && path === "/auth/me" && response.status === 401 && isLocalDirectApi && API_BASES.length > 1 && String(message || "").toLowerCase().includes("missing access token")) {
          lastError = new Error(message || "Missing access token.");
          continue;
        }
        if (!response.ok) {
          const error = new Error(safeServerMessage(message, response.status) || statusErrorMessage(response.status));
          error.code = typeof responseMessage === "object" ? responseMessage.code : payload?.code;
          error.status = response.status;
          throw error;
        }
        return payload;
      } catch (error) {
        if (requestTimedOut) {
          lastError = new Error("BRX took too long to respond. Please try again.");
          lastError.code = "REQUEST_TIMEOUT";
          continue;
        }
        const isNetworkError = error instanceof TypeError || error?.message === "Failed to fetch";
        if (!isNetworkError) throw error;
        lastError = error;
      } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
      }
    }

    if (lastError?.message === "Failed to fetch" || lastError instanceof TypeError) {
      const error = new Error(connectionErrorMessage());
      error.code = "CONNECTION_UNAVAILABLE";
      throw error;
    }

    throw lastError || new Error("We could not complete your request. Please try again.");
  }

  window.BRX.api = { requestJson, connectionErrorMessage };
})();
