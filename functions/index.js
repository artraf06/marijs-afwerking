/**
 * functions/index.js
 * Callable: sendPushNotification
 * Zbiera tokeny z:
 * - users/{username}/tokens/{token} (active == true)
 * - (opcjonalnie) pushTokens/{token}
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

function chunk(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

exports.sendPushNotification = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    try {
      const title = String(data?.title ?? "").trim();
      const body = String(data?.body ?? "").trim();
      if (!title || !body) {
        throw new functions.https.HttpsError("invalid-argument", "Brak title/body");
      }

      const projectName = String(data?.projectName ?? "");
      const field = String(data?.field ?? "");
      const clickAction = String(
        data?.clickAction ?? process.env.APP_CLICK_ACTION ?? "/"
      );

      // === 1) ZBIERZ TOKENY Z users/*/tokens (active == true)
      const usersSnap = await db.collection("users").get();
      const userTokens = [];
      for (const u of usersSnap.docs) {
        const tSnap = await u.ref.collection("tokens").where("active","==",true).get();
        tSnap.forEach(t => userTokens.push({ token: t.id, where: { type: "users", userRef: u.ref } }));
      }

      // === 2) (OPCJONALNIE) ZBIERZ TOKENY Z pushTokens/*
      const pushSnap = await db.collection("pushTokens").get().catch(() => ({ docs: [] }));
      const legacyTokens = pushSnap.docs.map(d => ({ token: d.id, where: { type: "pushTokens", docRef: d.ref } }));

      // połącz, usuń duplikaty
      const all = [...userTokens, ...legacyTokens];
      const seen = new Set();
      const tokensMeta = [];
      for (const t of all) {
        if (!t.token || seen.has(t.token)) continue;
        seen.add(t.token);
        tokensMeta.push(t);
      }

      const tokens = tokensMeta.map(t => t.token);
      if (!tokens.length) return { success: true, totalTokens: 0, results: [] };

      // payload FCM
      const basePayload = {
        notification: { title, body, icon: "/logo-192.png" },
        data: { projectName, field, click_action: clickAction, title, body },
        android: { priority: "high", notification: { click_action: clickAction } },
        webpush: { fcmOptions: { link: clickAction }, headers: { Urgency: "high" } },
        apns: { payload: { aps: { sound: "default" } } },
      };

      const batches = chunk(tokens, 500);
      const results = [];
      let deletedFromUsers = 0, deletedFromLegacy = 0;

      for (const pack of batches) {
        const resp = await messaging.sendEachForMulticast({ tokens: pack, ...basePayload });

        // oczyść nieważne tokeny
        const toDeleteIdx = [];
        resp.responses.forEach((r, idx) => {
          if (!r.success) {
            const code = r.error?.code || "";
            if (
              code === "messaging/registration-token-not-registered" ||
              code === "messaging/invalid-registration-token"
            ) toDeleteIdx.push(idx);
          }
        });

        if (toDeleteIdx.length) {
          const batch = db.batch();
          for (const i of toDeleteIdx) {
            const badToken = pack[i];
            const meta = tokensMeta.find(t => t.token === badToken);
            if (meta?.where?.type === "users") {
              // w users/*/tokens/<token> ustaw inactive lub usuń – wybieram inactive (bezpieczniej)
              const tRef = meta.where.userRef.collection("tokens").doc(badToken);
              batch.set(tRef, { active: false, deactivatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
              deletedFromUsers++;
            } else if (meta?.where?.type === "pushTokens" && meta.where.docRef) {
              batch.delete(meta.where.docRef);
              deletedFromLegacy++;
            }
          }
          await batch.commit();
        }

        results.push({
          successCount: resp.successCount,
          failureCount: resp.failureCount,
          cleanedUsers: deletedFromUsers,
          cleanedLegacy: deletedFromLegacy,
        });
      }

      return { success: true, totalTokens: tokens.length, results };
    } catch (err) {
      console.error("sendPushNotification error:", err);
      throw new functions.https.HttpsError("internal", err?.message || "Nie udało się wysłać powiadomień.");
    }
  });
