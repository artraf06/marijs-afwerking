/* sw.js — PWA + FCM + cache dla Netlify (z badge sygnałem do appki) */

importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js");

/* ==== Firebase (jak w appce) ==== */
firebase.initializeApp({
  apiKey: "AIzaSyB9cbmspJZLQ76Arm_-3Zmb7-hmoRTkZz8",
  authDomain: "marijs-afwerking.firebaseapp.com",
  projectId: "marijs-afwerking",
  storageBucket: "marijs-afwerking.appspot.com",
  messagingSenderId: "626287320904",
  appId: "1:626287320904:web:6258025a253d5c9d849d7d",
});

const messaging = firebase.messaging();

/* ---------- wspólne: budowa treści notyfikacji ---------- */
function buildNotificationFromPayload(p) {
  const data = p?.data || {};
  const notif = p?.notification || {};

  const iconMap = {
    werknemers: "👷",
    materialen: "🧱",
    media: "📷",
    omschrijving: "📝",
    naam: "🆕",
    locatie: "🌍",
    uren: "⏱️",
    extra: "📌",
    weekbrief: "📄",
  };

  const field = data.field || "";
  const icon = iconMap[field] || "🔔";
  const proj = data.projectName || notif.title || "Project";
  const act = data.action || notif.body || "Update";

  const title = notif.title || `${icon} ${proj}`;
  const body = notif.body || `${act}${field ? " – " + field : ""}`;

  const iconUrl = notif.icon || data.icon || "/logo-192.png";
  const click_action = data.click_action || data.url || "/";

  // unikalny tag (ważne dla niektórych launcherów/badge)
  const base = (data.projectId && `project-${data.projectId}`) ||
               (data.projectName && `project-${data.projectName}`) ||
               "project-update";
  const tag = `${base}-${Date.now()}`;

  return {
    title,
    options: {
      body,
      icon: iconUrl,
      badge: "/logo-192.png",
      vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,
      tag, // ⬅️ poprawka (było: tagBase)
      renotify: true,
      data: { ...data, click_action },
    },
  };
}

/* ==== Background FCM (notification payload lub data-only) ==== */
messaging.onBackgroundMessage((payload) => {
  try {
    const { title, options } = buildNotificationFromPayload(payload);
    const p = self.registration.showNotification(title, options);

    // ➕ po wyświetleniu notyfikacji podbij badge w oknach
    p.then(async () => {
      try {
        const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        clientsList.forEach(c => c.postMessage({ type: "INC_BADGE" }));
      } catch {}
    });

    return p;
  } catch (e) {
    // cicho: lepiej nie wywalać SW
  }
});

/* ==== Ogólny handler push (np. gdy backend wyśle inny format) ==== */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  event.waitUntil((async () => {
    let p = {};
    try { p = event.data.json(); } catch {}

    // ❗️Anti-dupe: jeśli to FCM, pozwól obsłużyć firebase-messaging (onBackgroundMessage)
    const d = p?.data || p;
    if (
      p?.from === "google.com/iid" ||
      d?.["google.c.a.e"] != null ||
      d?.["gcm.message_id"] != null ||
      d?.["google.message_id"] != null ||
      d?.["firebase-messaging-msg-id"] != null
    ) {
      return; // FCM przejmie to sam
    }

    // Normalizacja dla niestandardowych pushy
    const shaped = {
      notification: p.notification || { title: p.title, body: p.body, icon: p.icon },
      data: d
    };

    const { title, options } = buildNotificationFromPayload(shaped);

    // Pokaż notyfikację
    await self.registration.showNotification(title, options);

    // ➕ po notyfikacji: sygnał do okien → badge++
    try {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clientsList.forEach(c => c.postMessage({ type: "INC_BADGE" }));
    } catch {}
  })());
});

/* ==== Klik w notyfikację ==== */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const clickUrl =
    event.notification.data?.click_action ||
    event.notification.data?.url ||
    "/";

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of allClients) {
      const u = new URL(client.url);
      if (u.origin === self.location.origin) {
        await client.focus();
        // sygnał do strony — wyczyść badge/dymek itp.
        try { client.postMessage({ type: "FOCUSED_FROM_NOTIFICATION" }); } catch {}
        return;
      }
    }
    await self.clients.openWindow(clickUrl);
  })());
});
/* ==== Cache ==== */
const APP_VERSION = "v58"; // ⬅️ podbij przy deployu, żeby oczyścić stary cache
const STATIC_CACHE = `marijs-static-${APP_VERSION}`;
const DYNAMIC_CACHE = `marijs-dynamic-${APP_VERSION}`;

const STATIC_ASSETS = [
  "/", // ważne na Netlify
  "/index.html",
  "/styles.css",
  "/script.js",
  "/manifest.json",
  "/logo-192.png",
  "/logo-512.png",
  "/ding.mp3"
];

/* ==== Install ==== */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

/* ==== Activate ==== */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // usuń stare cache
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) =>
        (k === STATIC_CACHE || k === DYNAMIC_CACHE) ? null : caches.delete(k)
      )
    );
    // przyspiesz HTML online
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
  })());
});

/* ==== Odbiór komendy z appki (auto-update) ==== */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data === "SKIP_WAITING" || (data && data.type === "SKIP_WAITING")) {
    self.skipWaiting();
  }
});

/* ==== Fetch: HTML network-first, assety cache-first ==== */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;

  // Omijaj Firebase/FCM/Storage – nie cache’ujemy
  if (/firebaseio\.com|googleapis\.com|firebasestorage\.googleapis\.com/.test(url.host)) {
    return;
  }

  const isHTML = req.mode === "navigate" || req.destination === "document";

  if (isHTML) {
    // HTML: network-first z no-store + preload; fallback do cache'owanego index.html
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;

        const fresh = await fetch(req, { cache: "no-store" });
        return fresh;
      } catch {
        const cachedIndex = await caches.match("/index.html", { ignoreSearch: true });
        return cachedIndex || new Response("Offline.", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  // Statyczne assety naszej domeny: cache-first (z dogrywką do dynamic cache)
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const resp = await fetch(req);
        if (resp && resp.ok && (resp.type === "basic" || resp.type === "cors")) {
          const dyn = await caches.open(DYNAMIC_CACHE);
          // klucz bez query, by uniknąć duplikatów
          const cacheKey = new Request(req.url.split("?")[0], { method: "GET" });
          dyn.put(cacheKey, resp.clone()).catch(() => {});
        }
        return resp;
      } catch {
        return cached || new Response("Offline.", { status: 503, statusText: "Offline" });
      }
    })());
  }
});


