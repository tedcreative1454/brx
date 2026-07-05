(function () {
  window.BRX = window.BRX || {};
  const { icon } = window.BRX.icons;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[character]));
  }

  function pageHeader({ eyebrow = "", title, description = "", actionHtml = "", className = "" }) {
    return `
      <header class="ui-page-header ${escapeHtml(className)}">
        <div>${eyebrow ? `<p class="ui-eyebrow">${escapeHtml(eyebrow)}</p>` : ""}<h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>
        ${actionHtml}
      </header>
    `;
  }

  function status(text, tone = "neutral", className = "") {
    return `<span class="ui-status ${escapeHtml(tone)} ${escapeHtml(className)}">${escapeHtml(text)}</span>`;
  }

  function loadingState(label, detail = "Please wait while BRX loads the latest data.", className = "") {
    return `
      <div class="ui-loading-state ${escapeHtml(className)}" role="status" aria-live="polite">
        <span class="ui-loading-spinner" aria-hidden="true"></span>
        <strong>${escapeHtml(label)}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
      </div>
    `;
  }

  function emptyState({ iconName = "info", title, detail = "", actionHtml = "", className = "" }) {
    return `
      <div class="ui-empty-state ${escapeHtml(className)}">
        ${icon(iconName)}
        <h3>${escapeHtml(title)}</h3>
        ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
        ${actionHtml}
      </div>
    `;
  }

  function errorState(message, title = "Something went wrong", actionHtml = "", className = "") {
    return `
      <div class="ui-error-state ${escapeHtml(className)}" role="alert">
        ${icon("info")}
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${actionHtml}
      </div>
    `;
  }

  window.BRX.components = {
    ...(window.BRX.components || {}),
    pageHeader,
    status,
    loadingState,
    emptyState,
    errorState,
  };
})();