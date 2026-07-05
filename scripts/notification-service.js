(function () {
  window.BRX = window.BRX || {};

  const { requestJson } = window.BRX.api;

  function list(limit = 20) {
    return requestJson(`/notifications?limit=${encodeURIComponent(limit)}`);
  }

  function markRead(notificationId) {
    return requestJson(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH" });
  }

  function markAllRead() {
    return requestJson("/notifications/read-all", { method: "POST" });
  }

  function actionUrl(notification) {
    if (notification.actionUrl) return notification.actionUrl;
    if (notification.entityType === "trade" && notification.entityId) {
      return `#/trades?id=${encodeURIComponent(notification.entityId)}`;
    }
    return "#/notifications";
  }

  function relativeTime(value) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "";
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  window.BRX.notificationService = { list, markRead, markAllRead, actionUrl, relativeTime };
})();
