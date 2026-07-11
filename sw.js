const BRX_CACHE = "brx-pwa-shell-v2";
const BRX_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/styles/design-system.css",
  "/styles/features.css",
  "/styles/app-pages.css",
  "/styles/light-theme.css",
  "/styles/mobile.css",
  "/assets/brx-logo-transparent.png",
  "/assets/brx-icon-192.png",
  "/assets/brx-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(BRX_CACHE)
      .then((cache) => cache.addAll(BRX_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== BRX_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(BRX_CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && url.origin === self.location.origin) {
        const copy = response.clone();
        caches.open(BRX_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || "BRX notification";
  const options = {
    body: payload.body || "You have a new BRX update.",
    icon: "/assets/brx-icon-192.png",
    badge: "/assets/brx-icon-192.png",
    tag: payload.tag || "brx-update",
    renotify: true,
    data: { actionUrl: payload.actionUrl || "#/notifications" },
    vibrate: [120, 70, 120],
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: "BRX_PUSH_RECEIVED" }));
    }),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.actionUrl || "#/notifications", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "focus" in client);
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
