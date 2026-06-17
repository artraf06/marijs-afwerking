/* sw.js — PWA + FCM + cache + licznik (badge) */

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

/* ---------- budowa treści notyfikacji ---------- */
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
  const act = data.action || data.body || notif.body || "Update";

  const title = notif.title || data.title || `${icon} ${proj}`;
  const body = notif.body || data.body || `${act}${field ? " – " + field : ""}`;

  const iconUrl = notif.icon || data.icon || "/logo-192.png";
  const click_action = data.click_action || data.url || "/";

  // TAG OPARTY NA TREŚCI:
  // - różne powiadomienia → różne tagi → zostają OSOBNO (user widzi wszystkie nowe)
  // - identyczne (duplikat) → ten sam tag → drugi tylko odświeża, bez dublowania
  const tagBron = `${data.projectName || ""}|${data.field || ""}|${body}`;
  const tag = "marijs-" + tagBron.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);

  return {
    title,
    options: {
      body,
      icon: iconUrl,
      badge: "/logo-192.png",
      vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,   // zostaje aż user zrobi swipe/klik
      tag,                        // tag z treści = różne osobno, duplikaty łączone
      renotify: true,             // dźwięk/wibracja przy każdym nowym
      data: { ...data, click_action },
    },
  };
}

/* ===== funkcja do zliczania powiadomień i aktualizacji badge ===== */
async function updateBadge() {
  try {
    const list = await self.registration.getNotifications({ includeTriggered: true });
    const count = Array.isArray(list) ? list.length : 0;

    // ustaw licznik na ikonie aplikacji
    if (self.registration.setAppBadge) {
      if (count > 0) await self.registration.setAppBadge(count);
      else await self.registration.clearAppBadge?.();
    }

    // powiadom otwarte okna
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clientsList.forEach(c => c.postMessage({ type: "SET_BADGE", count }));
  } catch (e) {
    console.warn("Badge update error:", e);
  }
}

/* ====================================================================
   ⚠️ ZABEZPIECZENIE PRZED PODWÓJNĄ NOTYFIKACJĄ
   Przy data-only message FCM odpala onBackgroundMessage ORAZ push.
   Używamy flagi z message_id żeby pokazać tylko JEDNĄ notyfikację.
   ==================================================================== */
const _shownMessages = new Set();
function _alreadyShown(id) {
  if (!id) return false;
  if (_shownMessages.has(id)) return true;
  _shownMessages.add(id);
  // czyść po 60s żeby Set nie rósł w nieskończoność
  setTimeout(() => _shownMessages.delete(id), 60000);
  return false;
}

/* ==== Background FCM ==== */
messaging.onBackgroundMessage((payload) => {
  try {
    // klucz deduplikacji — BEZ timestampu (ten sam push = jeden raz, niezależnie kiedy dotarł)
    const dedupeKey = `${payload?.data?.projectName || ""}-${payload?.data?.field || ""}-${payload?.data?.body || ""}`;
    if (_alreadyShown(dedupeKey)) return;

    const { title, options } = buildNotificationFromPayload(payload);
    const p = self.registration.showNotification(title, options);
    p.then(updateBadge);
    return p;
  } catch (e) {}
});

/* ==== Ogólny handler push (fallback gdy onBackgroundMessage nie zadziała) ==== */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  event.waitUntil((async () => {
    let p = {};
    try { p = event.data.json(); } catch {}

    const d = p?.data || p;

    // odfiltruj wewnętrzne wiadomości FCM
    if (
      p?.from === "google.com/iid" ||
      d?.["google.c.a.e"] != null ||
      d?.["gcm.message_id"] != null ||
      d?.["google.message_id"] != null ||
      d?.["firebase-messaging-msg-id"] != null
    ) return;

    // deduplikacja — żeby nie dublować z onBackgroundMessage (BEZ timestampu)
    const dedupeKey = `${d?.projectName || ""}-${d?.field || ""}-${d?.body || ""}`;
    if (_alreadyShown(dedupeKey)) return;

    const shaped = {
      notification: p.notification || { title: p.title, body: p.body, icon: p.icon },
      data: d
    };

    const { title, options } = buildNotificationFromPayload(shaped);
    await self.registration.showNotification(title, options);
    await updateBadge();
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
    await updateBadge();

    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      const u = new URL(client.url);
      if (u.origin === self.location.origin) {
        await client.focus();
        try { client.postMessage({ type: "FOCUSED_FROM_NOTIFICATION" }); } catch {}
        return;
      }
    }
    await self.clients.openWindow(clickUrl);
  })());
});

/* ==== Zamknięcie notyfikacji (bez kliknięcia) ==== */
self.addEventListener("notificationclose", (event) => {
  event.waitUntil(updateBadge());
});

/* ==== Licznik powiadomień (badge sync) ==== */
let badgeCount = 0;

// Odbiór komend od strony (appki)
self.addEventListener("message", (event) => {
  const t = event.data?.type;

  if (t === "INC_BADGE") {
    badgeCount++;
    broadcastBadge();
  } else if (t === "SET_BADGE") {
    badgeCount = Number(event.data?.count || 0);
    broadcastBadge();
  } else if (t === "CLEAR_BADGE") {
    badgeCount = 0;
    broadcastBadge();
  } else if (t === "REQUEST_BADGE") {
    broadcastBadge();
  } else if (t === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Funkcja pomocnicza – rozsyła stan badge do wszystkich otwartych kart
async function broadcastBadge() {
  try {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clientsList) {
      c.postMessage({ type: "SET_BADGE", count: badgeCount });
    }
    if (self.registration.setAppBadge) {
      if (badgeCount > 0) await self.registration.setAppBadge(badgeCount);
      else await self.registration.clearAppBadge?.();
    }
  } catch (e) {
    console.warn("broadcastBadge error:", e);
  }
}

/* ==== Cache ==== */
const APP_VERSION = "v70"; // ⬅️ podbij przy deployu
const STATIC_CACHE = `marijs-static-${APP_VERSION}`;
const DYNAMIC_CACHE = `marijs-dynamic-${APP_VERSION}`;

const STATIC_ASSETS = [
  "/",
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
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS)).catch(()=>{}));
  self.skipWaiting();
});

/* ==== Activate ==== */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === STATIC_CACHE || k === DYNAMIC_CACHE) ? null : caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
  })());
});

/* ==== Fetch ==== */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;

  if (/firebaseio\.com|googleapis\.com|firebasestorage\.googleapis\.com/.test(url.host)) return;

  const isHTML = req.mode === "navigate" || req.destination === "document";

  if (isHTML) {
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

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const resp = await fetch(req);
        if (resp && resp.ok && (resp.type === "basic" || resp.type === "cors")) {
          const dyn = await caches.open(DYNAMIC_CACHE);
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