// firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyB9cbmspJZLQ76Arm_-3Zmb7-hmoRTkZz8",
  authDomain: "marijs-afwerking.firebaseapp.com",
  projectId: "marijs-afwerking",
  messagingSenderId: "626287320904",
  appId: "1:626287320904:web:6258025a253d5c9d849d7d",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  console.log("🔕 Push w tle:", payload);
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: "/logo-192.png"
  });
}); 
