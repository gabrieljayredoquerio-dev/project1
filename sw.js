const CACHE_NAME = "allowancesaver-static-v4";
const APP_FILES = [
  "./",
  "./index.html",
  "./login.html",
  "./privacy.html",
  "./terms.html",
  "./styles.css?v=18",
  "./auth.js?v=3",
  "./app.js?v=14",
  "./site.js",
  "./manifest.webmanifest",
  "./app-icon.svg",
  "./app-icon-192.png",
  "./app-icon-512.png",
  "./apple-touch-icon.png",
  "./motorbike.png",
  "./restaurant.png",
  "./school.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("allowancesaver-static-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin
    || !requestUrl.href.startsWith(self.registration.scope)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(async () => {
        const cachedPage = await caches.match(request, { ignoreSearch: true });
        if (cachedPage) return cachedPage;
        const fallback = await caches.match(new URL("./login.html", self.registration.scope).href);
        if (fallback) return fallback;
        return Response.error();
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request))
  );
});
