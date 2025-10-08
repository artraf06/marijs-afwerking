// placeholder – korzystamy z /sw.js; to tylko ucisza błąd 404 od FCM
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
