(function () {
  window.BRX = window.BRX || {};
  const { requestJson } = window.BRX.api;
  let audioContext = null;

  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function decodeKey(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  }

  async function registration() {
    if (!supported()) throw new Error("Push notifications are not supported on this device.");
    return navigator.serviceWorker.ready;
  }

  async function status() {
    if (!supported()) return { supported: false, subscribed: false, permission: "unsupported", configured: false };
    const config = await requestJson("/notifications/push/config");
    const subscription = await (await registration()).pushManager.getSubscription();
    return { supported: true, configured: Boolean(config.enabled), subscribed: Boolean(subscription), permission: Notification.permission };
  }

  async function enable() {
    if (!supported()) throw new Error("Push notifications are not supported on this device.");
    const config = await requestJson("/notifications/push/config");
    if (!config.enabled || !config.publicKey) throw new Error("Push notifications are temporarily unavailable.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notification permission was not allowed.");
    const serviceWorker = await registration();
    let subscription = await serviceWorker.pushManager.getSubscription();
    if (!subscription) subscription = await serviceWorker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.publicKey) });
    await requestJson("/notifications/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ ...subscription.toJSON(), userAgent: navigator.userAgent }),
    });
    playChime();
    return { subscribed: true };
  }

  async function disable() {
    if (!supported()) return { subscribed: false };
    const subscription = await (await registration()).pushManager.getSubscription();
    if (subscription) {
      await requestJson("/notifications/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
      await subscription.unsubscribe();
    }
    return { subscribed: false };
  }

  function playChime() {
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context || document.visibilityState !== "visible") return;
      audioContext ||= new Context();
      const now = audioContext.currentTime;
      [659.25, 880].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * .11);
        gain.gain.exponentialRampToValueAtTime(.07, now + index * .11 + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, now + index * .11 + .16);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(now + index * .11);
        oscillator.stop(now + index * .11 + .18);
      });
    } catch (_) {}
  }

  function init() {
    if (!supported()) return;
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "BRX_PUSH_RECEIVED") playChime();
    });
  }

  window.BRX.pushService = { supported, status, enable, disable, playChime, init };
})();
