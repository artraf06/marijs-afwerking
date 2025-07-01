const STATIC_CACHE = "marijs-static-v28";
const DYNAMIC_CACHE = "marijs-dynamic-v1";
const STATIC_ASSETS = [
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.json",
  "./logo-192.png",
  "./logo-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
            .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(DYNAMIC_CACHE);

      if (event.request.mode === "navigate") {
        const cachedIndex = await caches.match("./index.html");
        return cachedIndex || fetch("./index.html");
      }

      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;

      try {
        const networkResponse = await fetch(event.request);
        cache.put(event.request, networkResponse.clone());
        return networkResponse;
      } catch (error) {
        return new Response("⚠️ Offline – geen cache beschikbaar.");
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
}); 