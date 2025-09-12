
/* functions/index.js
* Push do wszystkich zapisanych tokenów z kolekcji `pushTokens`
* Front wywołuje: firebase.app().functions("us-central1").httpsCallable("sendPushNotification")
*/

const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Inicjalizacja Admin SDK (czyta config projektu z środowiska Functions)
admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

/** Pomocniczo: tnij tablice na paczki N (FCM zaleca ≤1000) */
function chunk(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
* sendPushNotification (callable)
* data: { title, body, projectName?, field?, clickAction? }
*/
exports.sendPushNotification = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    try {
      const title = String(data?.title ?? "").trim();
      const body  = String(data?.body ?? "").trim();
      if (!title || !body) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Brak title/body."
        );
      }

      const projectName = String(data?.projectName ?? "");
      const field       = String(data?.field ?? "");
      const clickAction =
        String(data?.clickAction ?? process.env.APP_CLICK_ACTION ?? "https://example.com");

      // Pobierz tokeny z Firestore (każdy dokument w `pushTokens` ma id = token)
      const snap = await db.collection("pushTokens").get();
      const tokens = snap.docs.map(d => d.id).filter(Boolean);

      if (tokens.length === 0) {
        return { success: false, message: "Brak zarejestrowanych tokenów." };
      }

      // Payload FCM (notification + data)
      const basePayload = {
        notification: {
          title,
          body,
        },
        data: {
          projectName,
          field,
          click_action: clickAction, // dla SW/kliknięcia
        },
        android: {
          priority: "high",
          notification: { click_action: clickAction },
        },
        webpush: {
          fcmOptions: { link: clickAction },
          headers: { Urgency: "high" },
        },
        apns: {
          payload: { aps: { sound: "default", badge: 1 } },
        },
      };

      // Wyślij w paczkach
      const batches = chunk(tokens, 500);
      const results = [];

      for (const pack of batches) {
        // Uwaga: sendEachForMulticast zwraca szczegóły sukcesów/błędów per token
        const resp = await messaging.sendEachForMulticast({
          tokens: pack,
          ...basePayload,
        });

        // Usuń nieprawidłowe/wyrejestrowane tokeny
        const toDelete = [];
        resp.responses.forEach((r, idx) => {
          if (!r.success) {
            const code = r.error?.code || "";
            if (
              code === "messaging/registration-token-not-registered" ||
              code === "messaging/invalid-registration-token"
            ) {
              toDelete.push(pack[idx]);
            }
          }
        });
        if (toDelete.length) {
          const batch = db.batch();
          toDelete.forEach(tok =>
            batch.delete(db.collection("pushTokens").doc(tok))
          );
          await batch.commit();
        }

        results.push({
          successCount: resp.successCount,
          failureCount: resp.failureCount,
          deletedTokens: toDelete.length,
        });
      }

      return { success: true, totalTokens: tokens.length, results };
    } catch (err) {
      console.error("sendPushNotification error:", err);
      // Zwrot czytelnego błędu do frontu
      throw new functions.https.HttpsError(
        "internal",
        err?.message || "Nie udało się wysłać powiadomień."
      );
    }
  }); 
