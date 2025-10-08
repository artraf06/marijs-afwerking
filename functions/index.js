'use strict';

/**
 * Gen1 ONLY (https.onCall + https.onRequest z CORS)
 * Zbiera tokeny z:
 * - users/{username}/tokens/{token} (active == true)
 * - (opcjonalnie) pushTokens/{token}
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

function chunk(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function collectActiveTokens() {
  // 1) users/*/tokens (active == true)
  const usersSnap = await db.collection('users').get();
  const userTokens = [];
  for (const u of usersSnap.docs) {
    const tSnap = await u.ref.collection('tokens').where('active', '==', true).get();
    tSnap.forEach(t => userTokens.push({ token: t.id, where: { type: 'users', userRef: u.ref } }));
  }

  // 2) (opcjonalnie) pushTokens/*
  const pushSnap = await db.collection('pushTokens').get().catch(() => ({ docs: [] }));
  const legacyTokens = pushSnap.docs.map(d => ({ token: d.id, where: { type: 'pushTokens', docRef: d.ref } }));

  // 3) deduplikacja
  const all = [...userTokens, ...legacyTokens];
  const seen = new Set();
  const tokensMeta = [];
  for (const t of all) {
    if (!t.token || seen.has(t.token)) continue;
    seen.add(t.token);
    tokensMeta.push(t);
  }
  return tokensMeta;
}

function buildBasePayload({ title, body, projectName = '', field = '', clickAction = '/' }) {
  return {
    notification: { title, body, icon: '/logo-192.png' },
    data: { projectName, field, click_action: clickAction, title, body },
    android: { priority: 'high', notification: { click_action: clickAction } },
    webpush: { fcmOptions: { link: clickAction }, headers: { Urgency: 'high' } },
    apns: { payload: { aps: { sound: 'default' } } },
  };
}

async function sendMulticast(tokensMeta, payload) {
  const tokens = tokensMeta.map(t => t.token);
  if (!tokens.length) return { totalTokens: 0, results: [] };

  const batches = chunk(tokens, 500);
  const results = [];
  let cleanedUsers = 0, cleanedLegacy = 0;

  for (const pack of batches) {
    const resp = await messaging.sendEachForMulticast({ tokens: pack, ...payload });

    // czyszczenie nieważnych tokenów
    const toDeleteIdx = [];
    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          toDeleteIdx.push(idx);
        }
      }
    });

    if (toDeleteIdx.length) {
      const batch = db.batch();
      for (const i of toDeleteIdx) {
        const badToken = pack[i];
        const meta = tokensMeta.find(t => t.token === badToken);
        if (meta?.where?.type === 'users') {
          const tRef = meta.where.userRef.collection('tokens').doc(badToken);
          batch.set(
            tRef,
            { active: false, deactivatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          cleanedUsers++;
        } else if (meta?.where?.type === 'pushTokens' && meta.where.docRef) {
          batch.delete(meta.where.docRef);
          cleanedLegacy++;
        }
      }
      await batch.commit();
    }

    results.push({
      successCount: resp.successCount,
      failureCount: resp.failureCount,
      cleanedUsers,
      cleanedLegacy,
    });
  }

  return { totalTokens: tokens.length, results };
}

/* =============== Callable (Gen1) =============== */
exports.sendPushNotification = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    try {
      const title = String(data?.title ?? '').trim();
      const body = String(data?.body ?? '').trim();
      if (!title || !body) {
        throw new functions.https.HttpsError('invalid-argument', 'Brak title/body');
      }

      const projectName = String(data?.projectName ?? '');
      const field = String(data?.field ?? '');
      const clickAction = String(data?.clickAction ?? process.env.APP_CLICK_ACTION ?? '/');

      const tokensMeta = await collectActiveTokens();
      const payload = buildBasePayload({ title, body, projectName, field, clickAction });
      const sendRes = await sendMulticast(tokensMeta, payload);

      return { success: true, ...sendRes };
    } catch (err) {
      console.error('sendPushNotification error:', err);
      throw new functions.https.HttpsError('internal', err?.message || 'Nie udało się wysłać powiadomień.');
    }
  });

/* =============== HTTP + CORS (Gen1) =============== */
exports.sendPushNotificationHttp = functions
  .region("us-central1")
  .https.onRequest((req, res) => {
    // ✅ Obsługa preflight (CORS)
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(204).send(""); // bez treści
    }

    // ✅ Główna logika
    return cors(req, res, async () => {
      try {
        res.set("Access-Control-Allow-Origin", "*"); // zezwól wszystkim domenom
        res.status(200).json({ success: true, message: "HTTP endpoint działa ✅" });
      } catch (err) {
        console.error("sendPushNotificationHttp error:", err);
        res.status(500).json({ success: false, error: err?.message || "Internal error" });
      }
    });
  });
