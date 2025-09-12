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
  const icon  = iconMap[field] || "🔔";
  const proj  = data.projectName || notif.title || "Project";
  const act   = data.action || notif.body || "Update";

  const title   = notif.title || `${icon} ${proj}`;
  const body    = notif.body  || `${act}${field ? " – " + field : ""}`;
  const iconUrl = notif.icon  || "/logo-192.png";

  // Tag per projekt / nazwa / timestamp (żeby nie nadpisywać wszystkich jednym)
  const tagBase =
    (data.projectId   && `project-update-${data.projectId}`)   ||
    (data.projectName && `project-update-${data.projectName}`) ||
    `project-update-${Date.now()}`;

  const click_action = data.click_action || data.url || "/";

  return {
    title,
    options: {
      body,
      icon: iconUrl,
      badge: "/logo-192.png",
      vibrate: [120, 60, 120],
      tag: tagBase,
      renotify: true,
      data: {
        ...data,
        click_action,
      },
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
    // Jeśli backend nie trzyma się FCM-owego kształtu, ujednolicamy
    const shaped = {
      notification: p.notification || { title: p.title, body: p.body, icon: p.icon },
      data: p.data || p, // czasem całość siedzi w root
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
        // Możesz też wysłać wiadomość do okna:
        // client.postMessage({ type: "FROM_NOTIFICATION", data: event.notification.data });
        return;
      }
    }
    await self.clients.openWindow(clickUrl);
  })());
});

/* ==== Cache ==== */
const APP_VERSION   = "v41";             // ⬅️ podbij przy deployu
const STATIC_CACHE  = `marijs-static-${APP_VERSION}`;
const DYNAMIC_CACHE = `marijs-dynamic-${APP_VERSION}`;

const STATIC_ASSETS = [
  "/",                 // ważne na Netlify
  "/index.html",
  "/styles.css",
  "/script.js",
  "/manifest.json",
  "/logo-192.png",
  "/logo-512.png",
  "/ding.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) =>
          (k === STATIC_CACHE || k === DYNAMIC_CACHE) ? null : caches.delete(k)
        )
      )
    )
  );
  self.clients.claim();
});

/* Odbiór komendy z appki (auto-update) */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/* ==== Fetch: cache-first dla naszych assetów, network-first dla nawigacji ==== */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;

  // Omijaj Firebase/FCM/Storage – nie cache’ujemy
  const isFirebase =
    /firebaseio\.com|googleapis\.com|firebasestorage\.googleapis\.com/.test(url.host);
  if (isFirebase) return;

  // Nawigacje: spróbuj sieć, a w razie czego index.html
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cachedIndex = await caches.match("/index.html");
        return cachedIndex || new Response("Offline.");
      }
    })());
    return;
  }

  // Assety z naszej domeny: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const resp = await fetch(req);
        if (resp && resp.ok && (resp.type === "basic" || resp.type === "cors")) {
          const dyn = await caches.open(DYNAMIC_CACHE);
          dyn.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      } catch {
        return cached || new Response("Offline.");
      }
    })());
  }
}); 
