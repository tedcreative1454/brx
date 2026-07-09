const BRX_CACHE = "brx-pwa-shell-v1";
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