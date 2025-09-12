const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

exports.sendPushNotification = functions.https.onCall(async (data, context) => {
  const { message, token } = data;

  try {
    const response = await admin.messaging().send({
      token: token,
      notification: {
        title: "Nieuw bericht",
        body: message,
      },
    });

    console.log("✅ Push notification sent:", response);
    return { success: true };
  } catch (error) {
    console.error("❌ Error sending push notification:", error);
    throw new functions.https.HttpsError("internal", "Notification failed");
  }
}); 
