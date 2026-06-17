'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const OpenAI = require('openai').default;
const cors = require('cors')({ origin: true });

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

/* ======== UTILS ======== */
function chunk(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function collectActiveTokens() {
  const userTokens = [];

  // Lista wszystkich użytkowników (na sztywno — pewne że zadziała mimo ghost documents)
  const allUsernames = ["Sjaak", "Jos", "Jacco", "Nanda", "Pieter", "Thijs", "Hilko", "Roel", "Benji"];

  for (const username of allUsernames) {
    const userRef = db.collection('users').doc(username);
    const tSnap = await userRef.collection('tokens').where('active', '==', true).get();
    tSnap.forEach(t => userTokens.push({ 
      token: t.id, 
      where: { type: 'users', userRef } 
    }));
  }

  const pushSnap = await db.collection('pushTokens').get().catch(() => ({ docs: [] }));
  const legacyTokens = pushSnap.docs.map(d => ({ token: d.id, where: { type: 'pushTokens', docRef: d.ref } }));

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
    // BEZ bloku notification — tylko data!
    data: {
      title,
      body,
      projectName,
      field,
      click_action: clickAction,
      icon: '/logo-192.png',
    },
    android: { 
      priority: 'high',
    },
    webpush: { 
      headers: { Urgency: 'high', TTL: '86400' },
      fcmOptions: { link: clickAction },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { 'content-available': 1 } },
    },
  };
}

async function sendMulticast(tokensMeta, payload) {
  const tokens = tokensMeta.map(t => t.token);
  if (!tokens.length) return { totalTokens: 0, results: [] };

  const batches = chunk(tokens, 500);
  const results = [];
  let cleanedUsers = 0;
  let cleanedLegacy = 0;

  for (const pack of batches) {
    const resp = await messaging.sendEachForMulticast({ tokens: pack, ...payload });
    const toDeleteIdx = [];

    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
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
          batch.set(tRef, { active: false, deactivatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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

/* ======== PUSH NOTIFICATIONS ======== */
exports.sendPushNotification = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    try {
      const title = String(data?.title ?? '').trim();
      const body = String(data?.body ?? '').trim();
      if (!title || !body) throw new functions.https.HttpsError('invalid-argument', 'Brak title/body');

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

exports.sendPushNotificationHttp = functions
  .region('us-central1')
  .https.onRequest((req, res) => {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }

    return cors(req, res, async () => {
      try {
        res.set('Access-Control-Allow-Origin', '*');
        res.status(200).json({ success: true, message: 'HTTP endpoint działa ✅' });
      } catch (err) {
        console.error('sendPushNotificationHttp error:', err);
        res.status(500).json({ success: false, error: err?.message || 'Internal error' });
      }
    });
  });

/* ======== AI CHAT BACKEND ======== */
exports.aiMarijsAdvanced = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    try {
      const text = String(data?.text ?? '').trim();
      const mode = String(data?.mode ?? 'general');
      const projectContext = String(data?.projectContext ?? '');

      if (!text) throw new functions.https.HttpsError('invalid-argument', 'Brak tekstu wejściowego');

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      let systemPrompt = `
Jesteś profesjonalnym asystentem firmy budowlano-wykończeniowej Marijs Afwerking.
Odpowiadasz rzeczowo, konkretnie i profesjonalnie.
Tworzysz odpowiedzi w języku ${data.language ?? 'polskim'}.
`;

      let userPrompt = '';
      switch (mode) {
        case 'summary':
          userPrompt = `KONTEKST PROJEKTU:\n${projectContext}\nZADANIE:\nStwórz profesjonalne podsumowanie projektu:\n${text}`;
          break;
        case 'materials':
          userPrompt = `KONTEKST PROJEKTU:\n${projectContext}\nZADANIE:\nWygeneruj szczegółową listę materiałów:\n${text}`;
          break;
        case 'tasks':
          userPrompt = `KONTEKST PROJEKTU:\n${projectContext}\nZADANIE:\nRozpisz szczegółowe zadania krok po kroku:\n${text}`;
          break;
        default:
          userPrompt = `KONTEKST PROJEKTU:\n${projectContext}\nOPIS:\n${text}\nWygeneruj profesjonalną analizę.`;
      }

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.4,
        max_tokens: 600
      });

      return { success: true, result: completion.choices[0].message.content };
    } catch (err) {
      console.error('AI error:', err);
      throw new functions.https.HttpsError('internal', err?.message || 'Błąd AI');
    }
  });
  /* ======== CLAUDE AI PROXY ======== */
const { defineSecret } = require('firebase-functions/params');
const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

exports.claudeProxy = functions
  .region('us-central1')
  .runWith({ secrets: ['ANTHROPIC_API_KEY'] })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
      const { messages, system, max_tokens } = req.body;
      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: 'Missing messages' }); return;
      }

      const apiKey = anthropicKey.value();
      if (!apiKey) {
        res.status(500).json({ error: 'API key not configured' }); return;
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'pdfs-2024-09-25',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: max_tokens || 2000,
          system:     system || '',
          messages,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        res.status(response.status).json({ error: data?.error?.message || 'API error' }); return;
      }
      res.status(200).json(data);

    } catch (err) {
      console.error('claudeProxy error:', err);
      res.status(500).json({ error: err.message || 'Internal error' });
    }
  });