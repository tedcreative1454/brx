(function () {
  window.BRX = window.BRX || {};

  const threshold = 76;
  let startY = 0;
  let startX = 0;
  let distance = 0;
  let tracking = false;
  let refreshing = false;
  let indicator;

  function isMobileAppRoute() {
    const route = window.BRX.router?.routeName?.();
    return window.matchMedia("(max-width: 820px)").matches
      && Boolean(window.BRX.state?.currentUser?.())
      && window.BRX.config.APP_ROUTES.includes(route)
      && !document.querySelector(".withdrawal-flow-backdrop, .withdrawal-success-backdrop, [aria-modal='true']");
  }

  function ensureIndicator() {
    if (indicator?.isConnected) return indicator;
    indicator = document.createElement("div");
    indicator.className = "pull-refresh-indicator";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-label", "Pull to refresh");
    indicator.innerHTML = '<span><img src="./assets/brx-icon-192.png" alt="" /></span>';
    document.body.appendChild(indicator);
    return indicator;
  }

  function resetIndicator() {
    distance = 0;
    tracking = false;
    if (!indicator || refreshing) return;
    indicator.classList.remove("visible", "ready", "error");
    indicator.style.setProperty("--pull-distance", "0px");
    indicator.setAttribute("aria-label", "Pull to refresh");
  }

  async function refreshCurrentRoute() {
    if (refreshing) return;
    refreshing = true;
    const node = ensureIndicator();
    node.classList.add("visible", "refreshing");
    node.classList.remove("ready");
    node.style.setProperty("--pull-distance", "58px");
    node.setAttribute("aria-label", "Refreshing");

    try {
      await window.BRX.router.render();
      node.setAttribute("aria-label", "Updated");
    } catch (error) {
      console.error(error);
      node.classList.add("error");
      node.setAttribute("aria-label", "Could not refresh");
      window.BRX.ui.showToast("Could not refresh. Try again.");
    } finally {
      window.setTimeout(() => {
        refreshing = false;
        node.classList.remove("visible", "ready", "refreshing", "error");
        node.style.setProperty("--pull-distance", "0px");
      }, 650);
    }
  }

  function onTouchStart(event) {
    if (refreshing || event.touches.length !== 1 || window.scrollY > 0 || !isMobileAppRoute()) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], .p2p-chat-room-messages")) return;
    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
    distance = 0;
    tracking = true;
  }

  function onTouchMove(event) {
    if (!tracking || event.touches.length !== 1) return;
    const deltaY = event.touches[0].clientY - startY;
    const deltaX = Math.abs(event.touches[0].clientX - startX);
    if (deltaY <= 0 || deltaX > deltaY) return resetIndicator();

    distance = Math.min(112, deltaY * 0.55);
    if (distance < 8) return;
    event.preventDefault();

    const node = ensureIndicator();
    node.classList.add("visible");
    node.classList.toggle("ready", distance >= threshold);
    node.style.setProperty("--pull-distance", distance + "px");
    node.setAttribute("aria-label", distance >= threshold ? "Release to refresh" : "Pull to refresh");
  }

  function onTouchEnd() {
    if (!tracking) return;
    const shouldRefresh = distance >= threshold;
    tracking = false;
    if (shouldRefresh) void refreshCurrentRoute();
    else resetIndicator();
  }

  function init() {
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", resetIndicator, { passive: true });
  }

  window.BRX.pullRefresh = { init, refresh: refreshCurrentRoute };
})();