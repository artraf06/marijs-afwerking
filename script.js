// === Firebase config & init ===
const firebaseConfig = {
  apiKey: "AIzaSyB9cbmspJZLQ76Arm_-3Zmb7-hmoRTkZz8",
  authDomain: "marijs-afwerking.firebaseapp.com",
  projectId: "marijs-afwerking",
  storageBucket: "marijs-afwerking.appspot.com",
  messagingSenderId: "626287320904",
  appId: "1:626287320904:web:6258025a253d5c9d849d7d",
  measurementId: "G-ND4T9807HG"
};
(() => {
  const origFetch = window.fetch;
  window.fetch = new Proxy(origFetch, {
    apply(target, thisArg, args) {
      const url = String(args?.[0] || "");
      if (url.includes("cloudfunctions.net/sendPushNotification")) {
        console.error("⚠️ Legacy fetch do sendPushNotification — powinno być httpsCallable!");
        console.trace();
        return Promise.reject(new Error("Blocked legacy fetch"));
      }
      return Reflect.apply(target, thisArg, args);
    }
  });
})();


// --- Firebase init ---
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
// ✅ Upewnij się, że Service Worker jest zarejestrowany od razu po starcie
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then(() => console.log('✅ Service Worker registered'))
    .catch(err => console.warn('⚠️ SW register error:', err));
}

// --- FCM (Web Push) ---
let messaging = null;
let swReg = null;
const VAPID_KEY =
  "BDryhrsLXA7-POE6nDoPPN9qnLphATTjUIhEjTcx46pz5KB_fLxO19F8ub5RYGZL-5bAwkpy6lwzfQkjiUfA8ww";
/** Init messaging – używa już zarejestrowanego sw.js */

/* ========== INIT MESSAGING (foreground) ========== */
async function initMessaging() {
  try {
    if (!("serviceWorker" in navigator)) return null;

    // 1) czekamy aż /sw.js będzie aktywny i kontrolował stronę
    swReg = await navigator.serviceWorker.ready;

    // 2) upewniamy się, że messaging istnieje
    if (!firebase.messaging) {
      console.warn("⚠️ Brak firebase.messaging – sprawdź <script> w index.html.");
      return null;
    }
    if (!messaging) messaging = firebase.messaging();

    // 3) (KLUCZOWE) powiedz FCM-owi, żeby używał TEGO service workera
    if (typeof messaging.useServiceWorker === "function") {
      try { messaging.useServiceWorker(swReg); } catch(_) {}
    }

    // 4) zbindowanie onMessage – tylko raz
    if (!initMessaging._onMessageBound) {
      messaging.onMessage((payload) => {
        const data = payload?.data || {};
        const notif = payload?.notification || {};
        const iconMap = { werknemers:"👷", materialen:"🧱", media:"📷", omschrijving:"📝", naam:"🆕", locatie:"🌍", uren:"⏱️", extra:"📌", weekbrief:"📄" };

        const field = data.field || "";
        const icon = iconMap[field] || "🔔";
        const proj = data.projectName || notif.title || "Powiadomienie";
        const act = notif.body || data.action || (data.body || "");
        const msg = `${icon} ${proj}${act ? ": " + act : ""}${field ? " – " + field : ""}`;
        const ts = Number(data.ts || data.timestamp || Date.now());

        // (opcjonalnie) pokaż też systemową notyfikację w foregroundzie
        (async () => {
          try {
            const reg = swReg || (await navigator.serviceWorker.getRegistration());
            if (reg && Notification.permission === "granted") {
              await reg.showNotification(notif.title || data.title || proj, {
                body: act,
                icon: notif.icon || data.icon || "/logo-192.png",
                badge: "/logo-192.png",
                data
              });
              reg.active?.postMessage?.({ type: "INC_BADGE" });
            }
          } catch (e) {
            console.warn("showNotification (foreground) failed:", e);
          }
        })();

        // Twój UI
        const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : !!window.currentUser;
        if (!loggedIn) {
          showBell(ts, msg);
          showPushBanner?.();
        } else {
          renderUpdateBanner?.();
        }
      });

      initMessaging._onMessageBound = true;
    }

    return messaging;
  } catch (err) {
    console.error("❌ initMessaging error:", err);
    return null;
  }
}

/* ========= BADGE / LICZNIK ========= */
const BADGE_KEY = "unreadCount";
let unreadCount = Number(localStorage.getItem(BADGE_KEY) || 0);

// elementy z UI (masz już dzwonek i badge w HTML)
const ringIcon = document.getElementById("ringIcon");
const ringBadge = document.getElementById("ringBadge");

// ujednolicenie: pokaż/ukryj dzwonek i liczby
function paintBadge() {
  // liczba na ikonce dzwonka
  if (ringBadge) {
    if (unreadCount > 0) {
      ringBadge.style.display = "inline-block";
      ringBadge.textContent = String(unreadCount);
      ringIcon?.classList?.remove("hidden");
    } else {
      ringBadge.style.display = "none";
    }
  }

  // App Badging API (jeśli PWA zainstalowana)
  if (navigator.setAppBadge) {
    if (unreadCount > 0) navigator.setAppBadge(unreadCount).catch(()=>{});
    else navigator.clearAppBadge?.().catch(()=>{});
  }

  // „kropka”/licznik w tytule karty jako fallback
  const baseTitle = (paintBadge._baseTitle ||= document.title.replace(/^\(\d+\)\s+|\•\s+/,''));
  if (unreadCount > 0) {
    document.title = `(${unreadCount}) ${baseTitle}`;
  } else {
    document.title = baseTitle;
  }
}

function setUnread(n) {
  unreadCount = Math.max(0, Number(n) || 0);
  localStorage.setItem(BADGE_KEY, String(unreadCount));
  paintBadge();
}

function incUnread(by = 1) {
  setUnread(unreadCount + by);
}

function clearUnread() {
  setUnread(0);
}

// klik w dzwonek = wejście w listę/odczyt → wyzeruj
ringIcon?.addEventListener?.("click", clearUnread);

// gdy wracamy do karty – możesz wyzerować (lub zostawić, jak wolisz)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    // tu decydujesz: clearUnread();
    paintBadge();
  }
});

// startowe odmalowanie
paintBadge();

/* ==== Odbiór wiadomości z Service Workera ==== */
navigator.serviceWorker?.addEventListener?.("message", (e) => {
  const t = e.data?.type;

  if (t === "SET_BADGE") {
    // 🔹 Gdy SW wyśle dokładną liczbę powiadomień (np. po starcie)
    setUnread(e.data?.count || 0);
  } else if (t === "INC_BADGE") {
    // 🔹 Gdy przychodzi nowe powiadomienie — zwiększ licznik
    incUnread(1);

    // 🔔 Dźwięk tylko, gdy aplikacja w tle
    try {
      if (document.hidden) {
        document.getElementById("notificationSound")?.play?.().catch(()=>{});
      }
    } catch {}
  } else if (t === "FOCUSED_FROM_NOTIFICATION") {
    // 🔹 Gdy użytkownik kliknie powiadomienie i wróci do apki
    clearUnread();
  }
});




async function enablePushForUser(username) {
  try {
    if (!('serviceWorker' in navigator)) return;

    // 1) poczekaj na SW (masz rejestrację w HTML)
    await navigator.serviceWorker.ready;

    // 2) zainicjuj messaging JEDNYM miejscem (ustawi globalne `messaging`)
    const inst = await initMessaging();
    if (!inst) {
      console.warn("enablePushForUser: messaging not ready");
      return;
    }

    // 3) poproś o uprawnienie do notyfikacji
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return;

    // 4) pobierz token (używa naszego swReg z initMessaging)
    const token = await messaging.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg || await navigator.serviceWorker.ready,
    });
    if (!token) return;

    // 5) zapisz token
    await saveUserToken(username, token);
    console.log("✅ Token zapisany:", username);
  } catch (err) {
    console.warn("enablePushForUser warn:", err); // nie blokujemy logowania
  }
}

/** Zapis tokenu: users/{username}/tokens/{token} */
async function saveUserToken(username, token) {
  const tokenRef = db
    .collection("users")
    .doc(username)
    .collection("tokens")
    .doc(token);
  await tokenRef.set(
    {
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      ua: navigator.userAgent || "",
      active: true,
    },
    { merge: true }
  );
}

/** (Opcjonalnie) Deaktywacja tokenu przy wylogowaniu */
async function disablePushForUser(username) {
  try {
    if (!messaging) return;
    const token = await messaging.getToken({
      serviceWorkerRegistration: swReg,
      vapidKey: VAPID_KEY,
    });
    if (!token) return;

    await db
      .collection("users")
      .doc(username)
      .collection("tokens")
      .doc(token)
      .set(
        {
          active: false,
          deactivatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    // ewentualnie:
    // await messaging.deleteToken(token);
  } catch (e) {
    console.warn("⚠️ disablePushForUser:", e);
  }
}

// ✅ Funkcja sprawdzająca, czy użytkownik jest zalogowany
function isLoggedIn() {
  const main = document.getElementById("mainContent");
  const login = document.getElementById("loginSection");
  return !!currentUser && !!main &&
    (main.classList.contains("visible") || main.classList.contains("show") || main.classList.contains("active") || main.style.display !== "none") &&
    (!!login ? (login.style.display === "none") : true);
}

// == DOMContentLoaded ==
document.addEventListener("DOMContentLoaded", () => {
  const observeInputs = () => {
    const observer = new MutationObserver(() => saveWeekbriefLocally());
    const config = { childList: true, subtree: true };
    const form = document.getElementById("weekbriefForm");
    if (!form) return;

    observer.observe(form, config);

    const inputs = form.querySelectorAll("input, textarea");
    inputs.forEach((inp) => {
      inp.addEventListener("input", () => saveWeekbriefLocally());
    });
  };

  observeInputs();

  const loginForm = document.getElementById("loginForm");
  const logoutBtn = document.getElementById("logoutBtn");
  const filterInput = document.getElementById("filterInput");
  const clearBtn = document.getElementById("clearFilterBtn");
  const openWeekbriefBtn = document.getElementById("openWeekbriefBtn");
  const closeWeekbriefBtn = document.getElementById("closeWeekbriefBtn");

  if (loginForm) loginForm.addEventListener("submit", handleLogin);
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  if (filterInput) {
    filterInput.addEventListener("input", (e) => {
      currentFilter = e.target.value.toLowerCase();
      renderProjects(currentFilter);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      currentFilter = "";
      if (filterInput) filterInput.value = "";
      renderProjects();
    });
  }

  if (openWeekbriefBtn) {
  openWeekbriefBtn.addEventListener("click", () => {
    document.getElementById("weekbriefSection").style.display = "block";
    ensureWeekUpToDate();
    renderWeekbriefTable();
    loadWeekbriefLocally(); 
    mountManualWeekControls(); // ⬅️ to MUSI być
  });
}

  if (closeWeekbriefBtn) {
    closeWeekbriefBtn.addEventListener("click", () => {
      document.getElementById("weekbriefSection").style.display = "none";
    });
  }

  const form = document.getElementById("weekbriefForm");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      exportWeekbriefToPDF();
    });
  }

  if (sessionStorage.getItem("loggedInUser")) {
    currentUser = sessionStorage.getItem("loggedInUser");
    updateUI();
  }

  const projectForm = document.getElementById("projectForm");
  if (projectForm) {
    projectForm.addEventListener("submit", saveProject);
  }

  // 🔁 przy starcie ustaw właściwy tydzień i zaplanuj auto-przeskok
  ensureWeekUpToDate();
  scheduleMidnightRefresh();
  

  // close lightbox tekstowy
  const closeBtn = document.querySelector(".close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      document.getElementById("lightbox").style.display = "none";
    });
  }
});

// 🔔 czyszczenie badga przy powrocie + odświeżenie tygodnia
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    ensureWeekUpToDate(); // ⬅️ DODANE
    if (navigator.clearAppBadge) {
      navigator.clearAppBadge().catch(()=>{});
    }
  }
});

// opcjonalnie odbiór wiadomości z SW po kliknięciu notyfikacji
navigator.serviceWorker?.addEventListener?.("message", (e) => {
  if (e.data?.type === "FOCUSED_FROM_NOTIFICATION") {
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(()=>{});
  }
});




// ===== ISO week + storage helpers (NOWE) =====
function getISOWeekInfo(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7; // 1..7 (pon=1)
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { year, week, label: `${year}-W${String(week).padStart(2,'0')}` };
}

// Zgodność z Twoim kodem – zwraca 1..53
function getCurrentWeekNumber() {
  return getISOWeekInfo().week;
}

const WEEK_STORAGE_WEEK = 'currentWeek'; // zostawiamy nazwę klucza
const WEEK_STORAGE_YEAR = 'currentWeekYear';

function readStoredWeek() {
  const w = parseInt(localStorage.getItem(WEEK_STORAGE_WEEK) || '', 10);
  const y = parseInt(localStorage.getItem(WEEK_STORAGE_YEAR) || '', 10);
  return { week: isNaN(w) ? null : w, year: isNaN(y) ? null : y };
}
function writeStoredWeek(week, year) {
  localStorage.setItem(WEEK_STORAGE_WEEK, String(week));
  localStorage.setItem(WEEK_STORAGE_YEAR, String(year));
}

function ensureWeekUpToDate(force = false) {
  const input = document.getElementById('wbWeeknummer');
  if (!input) return;

  const nowInfo = getISOWeekInfo(); // { year, week }
  const stored = readStoredWeek(); // { year, week }
  const manual = readManualFlag(); // true / false

  const noStored = stored.week == null || stored.year == null;
  const changed = stored.week !== nowInfo.week || stored.year !== nowInfo.year;

  // Nowy tydzień/rok lub wymuszenie → wracamy do automatu i wyłączamy manual
  if (force || noStored || changed) {
    input.value = String(nowInfo.week);
    writeStoredWeek(nowInfo.week, nowInfo.year);
    writeManualFlag(false); // reset manuala przy nowym tygodniu
    return;
  }

  // Ten sam tydzień:
  if (manual) {
    // zostaw ręcznie ustawioną wartość; jeśli pole puste, wstaw zapisany tydzień
    if (!input.value) input.value = String(stored.week);
  } else {
    // brak manuala — trzymaj się zapisu (jeśli pole puste)
    if (!input.value) input.value = String(stored.week);
  }
}
function mountManualWeekControls() {
  const display = document.getElementById('wbWeeknummer');
  const manualInput = document.getElementById('manualWeek');
  const setBtn = document.getElementById('setWeekBtn');
  if (!display || !manualInput || !setBtn) return;

  // Nie dubluj listenerów przy kolejnym otwarciu
  if (setBtn.dataset.bound === '1') return;
  setBtn.dataset.bound = '1';

  const applyManual = () => {
    const val = parseInt((manualInput.value || '').trim(), 10);
    if (!Number.isFinite(val) || val < 1 || val > 53) {
      alert('Podaj tydzień 1–53');
      manualInput.focus();
      return;
    }
    const nowInfo = getISOWeekInfo(); // bieżący rok
    writeStoredWeek(val, nowInfo.year); // zapisz ręczną wartość
    writeManualFlag(true); // manual aktywny do końca tego tygodnia

    // USTAW wyświetlacz natychmiast
    display.value = String(val);

    // „Stabilizacja” na wypadek asynch. nadpisania
    setTimeout(() => {
      const d = document.getElementById('wbWeeknummer');
      if (d) d.value = String(val);
    }, 0);
  };

  setBtn.addEventListener('click', applyManual);
  manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyManual(); }
  });
}

// --- MANUAL OVERRIDE (ręczna zmiana tygodnia) ---
const WEEK_STORAGE_MANUAL = 'currentWeekManual'; // 'true' / 'false'

function readManualFlag() {
  return localStorage.getItem(WEEK_STORAGE_MANUAL) === 'true';
}
function writeManualFlag(v) {
  localStorage.setItem(WEEK_STORAGE_MANUAL, v ? 'true' : 'false');
}


// auto-przeskok po północy
function scheduleMidnightRefresh() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(0, 0, 5, 0); // 00:00:05
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    ensureWeekUpToDate(true);
    scheduleMidnightRefresh();
  }, next - now);
}


// (Twoje) pomocnicze + reszta Weekbrief

function renderWeekbriefTable() {
  const dagen = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
  const container = document.getElementById("weekbriefTable");
  container.innerHTML = "";

  dagen.forEach((dag) => {
    const dayDiv = document.createElement("div");
    dayDiv.className = "day-block";

    const header = document.createElement("h4");
    header.textContent = dag;
    dayDiv.appendChild(header);

    const entriesDiv = document.createElement("div");
    entriesDiv.className = "entries";
    entriesDiv.id = `${dag}-entries`;

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+ Voeg taak toe";
    addBtn.onclick = () => addEntryRow(dag, entriesDiv);

    dayDiv.appendChild(entriesDiv);
    dayDiv.appendChild(addBtn);

    container.appendChild(dayDiv);
  });
}

// Dodaj jeden wiersz z zadaniem do wskazanego dnia
function addEntryRow(dag, container) {
  const row = document.createElement("div");
  row.className = "entry-row";
  row.dataset.day = dag;

  const urenInput = document.createElement("input");
  urenInput.type = "number";
  urenInput.step = "0.1";
  urenInput.placeholder = "Uren";
  urenInput.className = "urenInput";
  urenInput.oninput = () => {
    updateWeekTotaal();
    saveWeekbriefLocally();
  };

  const projectInput = document.createElement("input");
  projectInput.type = "text";
  projectInput.placeholder = "Projectnaam";
  projectInput.className = "projectInput";
  projectInput.oninput = saveWeekbriefLocally;

  row.appendChild(urenInput);
  row.appendChild(projectInput);

  container.appendChild(row);

  // od razu zapis i przeliczenie
  saveWeekbriefLocally();
  updateWeekTotaal();
}

// Przelicz łączną liczbę godzin w tygodniu
function updateWeekTotaal() {
  let totaal = 0;
  const dagen = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];

  dagen.forEach(dag => {
    const entries = document.querySelectorAll(`.entry-row[data-day="${dag}"]`);
    entries.forEach(entry => {
      const val = parseFloat(entry.querySelector(".urenInput")?.value || 0);
      if (!isNaN(val)) totaal += val;
    });
  });

  const totaalField = document.getElementById("wbTotaal");
  if (totaalField) totaalField.value = totaal.toFixed(1);
}

// Zapis szkicu Weekbrief do localStorage (per użytkownik)
function saveWeekbriefLocally() {
  if (!currentUser) return;
  const data = {
    naam: document.getElementById("wbNaam")?.value || "",
    handtekening: document.getElementById("wbHandtekening")?.value || "",
    dagen: {}
  };

  const dagen = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
  dagen.forEach(dag => {
    const entries = document.querySelectorAll(`.entry-row[data-day="${dag}"]`);
    data.dagen[dag] = Array.from(entries).map(entry => ({
      uren: entry.querySelector(".urenInput")?.value || "",
      project: entry.querySelector(".projectInput")?.value || ""
    }));
  });

  localStorage.setItem(`weekbrief_${currentUser}`, JSON.stringify(data));
}

// Wczytaj szkic Weekbrief z localStorage
function loadWeekbriefLocally() {
  if (!currentUser) return;
  const saved = localStorage.getItem(`weekbrief_${currentUser}`);
  if (!saved) return;

  try {
    const data = JSON.parse(saved);
    if (data.naam) document.getElementById("wbNaam").value = data.naam;
    if (data.handtekening) document.getElementById("wbHandtekening").value = data.handtekening;

    const dagen = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
    dagen.forEach(dag => {
      const entriesDiv = document.getElementById(`${dag}-entries`);
      if (!entriesDiv) return;

      // wyczyść istniejące wiersze przed odtworzeniem
      entriesDiv.innerHTML = "";

      (data.dagen[dag] || []).forEach((item) => {
        addEntryRow(dag, entriesDiv);
        const lastEntry = entriesDiv.lastChild;
        lastEntry.querySelector(".urenInput").value = item.uren || "";
        lastEntry.querySelector(".projectInput").value = item.project || "";
      });
    });

    updateWeekTotaal();
  } catch (err) {
    console.error("Błąd podczas ładowania zapisanego Weekbrief:", err);
  }
}

// Eksport Weekbrief do PDF + (asynchronicznie) upload do Storage/Firestore
function exportWeekbriefToPDF() {
  const naam = document.getElementById("wbNaam").value.trim();
  const weeknummer = document.getElementById("wbWeeknummer").value;
  const handtekening = document.getElementById("wbHandtekening").value;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Data i godzina (NL)
  const now = new Date();
  const dateStr = now.toLocaleDateString("nl-NL");
  const timeStr = now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

  const logo = new Image();
  logo.src = "logo-192.png";

  logo.onload = () => {
    // nagłówek
    doc.addImage(logo, "PNG", 10, 10, 20, 20);
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text("Weekbrief", 105, 20, null, null, "center");

    // prawa część nagłówka
    doc.setFontSize(12);
    doc.text(`Naam: ${naam}`, 140, 20);
    doc.text(`Weeknummer: ${weeknummer}`, 140, 28);
    doc.text(`Datum: ${dateStr}`, 140, 36);
    doc.text(`Tijd: ${timeStr}`, 140, 44);

    let y = 40;

    const dagenLijst = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
    dagenLijst.forEach((dag) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text(dag, 12, y + 6);

      doc.setDrawColor(200);
      doc.setLineWidth(0.2);
      doc.line(10, y + 10, 200, y + 10);

      y += 14;

      const entries = document.querySelectorAll(`.entry-row[data-day="${dag}"]`);
      let dagTotaal = 0;

      entries.forEach((entry) => {
        const uren = parseFloat(entry.querySelector(".urenInput")?.value) || 0;
        const project = entry.querySelector(".projectInput")?.value || "";
        dagTotaal += uren;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(`Project: ${project} – ${uren} uur`, 15, y);
        y += 6;
      });

      doc.setFont("helvetica", "italic");
      doc.setFontSize(11);
      doc.text(`Totaal ${dag.toLowerCase()}: ${dagTotaal.toFixed(1)} uur`, 150, y - 2);
      y += 10;
    });

    const totaal = document.getElementById("wbTotaal").value || "0";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Weektotaal: ${totaal} uur`, 20, y + 10);
    doc.text(`Handtekening: ${handtekening}`, 20, y + 20);

    // nazwa pliku
    const filename = `Weekbrief_${naam || "gebruiker"}_week${weeknummer}.pdf`;

    // 1) zapis lokalny
    doc.save(filename);

    // 2) upload do Storage + zapis meta w Firestore + PUSH + odśwież archiwum (asynchronicznie)
    (async () => {
      try {
        const blob = doc.output("blob");
        await saveWeekbriefPDFToStorage(blob, filename, {
          user: currentUser || "onbekend",
          week: weeknummer || ""
        });

        try {
          const f = firebase.app().functions("us-central1");
          const callSendPush = f.httpsCallable("sendPushNotification");
          await callSendPush({
            title: "📄 Weekbrief",
            body: `Weekbrief opgeslagen — ${currentUser || "onbekend"} (week ${weeknummer || "?"})`,
            projectName: "Weekbrief",
            field: "weekbrief",
            clickAction: window.location.origin
          });
        } catch (e) {
          console.warn("push (callable) failed:", e);
        }

        try {
          await notifyWeekbriefSaved({ week: weeknummer, year: now.getFullYear() });
        } catch (e) {
          console.warn("notifyWeekbriefSaved:", e);
        }

        if (typeof loadWeekbriefArchive === "function") {
          await loadWeekbriefArchive();
        }
      } catch (e) {
        console.warn("⚠️ Nie udało się wysłać PDF do Storage/Firestore:", e);
      }
    })();

    // posprzątaj formularz i draft po eksporcie
    localStorage.removeItem(`weekbrief_${currentUser}`);
    document.getElementById("weekbriefForm").reset();

    // ⬇️ WAŻNE: szanuje ręczny numer w tym samym tygodniu;
    // przy nowym tygodniu i tak wróci auto (bo ensureWeekUpToDate wykryje zmianę).
    ensureWeekUpToDate(); // ← bez "true"

    const dagenLijst2 = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
    dagenLijst2.forEach(dag => {
      const c = document.getElementById(`${dag}-entries`);
      if (c) c.innerHTML = "";
    });
    updateWeekTotaal();
  };
}

/** 🔼 Upload Weekbrief PDF do Storage + wpis do Firestore (kolekcja: weekbriefArchive) */
async function saveWeekbriefPDFToStorage(blob, filename, meta = {}) {
  const storage = firebase.app().storage("marijs-afwerking.firebasestorage.app");
  const storageRef = storage.ref();

  // Porządek w ścieżkach: weekbriefs/{rok}/week-{nr}/{user}/{plik}
  const year = new Date().getFullYear();
  const safeUser = (meta.user || "onbekend").replace(/[^\w.-]/g, "_");
  const safeWeek = (meta.week || "").toString().replace(/[^\w.-]/g, "_");
  const path = `weekbriefs/${year}/week-${safeWeek}/${safeUser}/${filename}`;

  const fileRef = storageRef.child(path);
  await fileRef.put(blob, {
    contentType: "application/pdf",
    customMetadata: {
      user: meta.user || "onbekend",
      week: meta.week || "",
      filename
    }
  });

  const url = await fileRef.getDownloadURL();

  // 1) zapis w Firestore (archiwum)
  const docRef = await db.collection("weekbriefArchive").add({
    user: meta.user || "onbekend",
    week: meta.week || "",
    filename,
    url,
    path, // ← ważne dla usuwania
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // ⇩⇩ NOWE: odkliknij ewentualne „skasowane” dla (user, week, filename)
  _wbClearRemovedFor({ filename, user: meta.user || "", week: meta.week || "" });

  // 2) LOG do updatesLog + PUSH + NATYCHMIAST pokaż na banerze
  try {
    await db.collection("updatesLog").add({
      timestamp: new Date(), // natychmiastowy time
      projectName: "Weekbrief", // ⬅️ spójna nazwa dla banera
      field: "weekbrief",
      action: "Weekbrief opgeslagen",
      user: meta.user || "onbekend",
      filename, // ⬅️ dodane – do dopasowania/usuwania
      week: meta.week || "", // ⬅️ dodane – do dopasowania/usuwania
      value: filename || "", // (zgodność wstecz)
      _wbDocId: docRef.id // ⬅️ twarde powiązanie z archiwum
    });

    // opcjonalny push
    try {
      await sendPushNotificationToAllUsers(
        "📄 Weekbrief",
        `Weekbrief opgeslagen — ${meta.user || "onbekend"} (week ${meta.week || "?"})`,
        "Weekbrief",
        "weekbrief"
      );
    } catch {}

    // pokaż na banerze tu i teraz
    try {
      await renderUpdateBanner();
      const b = document.getElementById("projectUpdateBanner");
      if (b) b.style.display = "block";
    } catch {}
  } catch (e) {
    console.warn("Weekbrief: log/push nieudany:", e);
  }

  return { url, path };
}

const f = firebase.app().functions("us-central1");

async function notifyWeekbriefSaved({ week, year }) {
  try {
    await f.httpsCallable("sendPushNotification")({
      title: "📄 Weekbrief",
      body: `Nowy PDF dla tygodnia ${week}/${year}`,
      projectName: "Weekbrief",
      field: "weekbrief",
      clickAction: window.location.origin
    });
    console.log("✅ Push wysłany po zapisie Weekbrief");
  } catch (e) {
    console.warn("❌ Błąd wysyłki push:", e);
  }
}

async function deleteWeekbriefFromArchive(id, encPath = "", encUrl = "") {
  if (!confirm("Weet je zeker dat je dit PDF-bestand wilt verwijderen?")) return;

  const extractPathFromUrl = (fileUrl) => {
    try {
      const u = new URL(fileUrl);
      const m = u.pathname.match(/\/o\/([^?]+)$/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch { return ""; }
  };

  let path = decodeURIComponent(encPath || "");
  const url = decodeURIComponent(encUrl || "");
  if (!path && url) path = extractPathFromUrl(url);

  try {
    // 0) meta zanim usuniesz dokument
    const docRef = db.collection("weekbriefArchive").doc(id);
    const snap = await docRef.get().catch(()=>null);
    let metaUser = "", metaWeek = "", metaFilename = "";
    if (snap && snap.exists) {
      const d = snap.data() || {};
      metaUser = d.user || "";
      metaWeek = d.week || "";
      metaFilename = d.filename || "";
    }

    // 1) Usuń plik ze Storage
    if (path) {
      const storage = firebase.app().storage("marijs-afwerking.firebasestorage.app");
      await storage.ref().child(path).delete().catch(e => {
        if (e?.code !== "storage/object-not-found") throw e;
      });
    }

    // 2) Usuń dokument Firestore
    await docRef.delete();

    // 3) NATYCHMIAST ukryj na banerze (DOM)
    removeWeekbriefBannerItem({ filename: metaFilename, user: metaUser, week: metaWeek });

    // 4) Dopisz do sesyjnego cache — by nic nie „wróciło” między cyklami odświeżenia
    _wbKeyFromParts({ filename: metaFilename, user: metaUser, week: metaWeek })
      .forEach(k => window._wbRemovedSession.add(k));

    // 5) Usuń odpowiadające logi (po docId + po polach)
    try {
      await pruneWeekbriefLogsByDocOrName(id, "Weekbrief");
      await removeWeekbriefLogsFromUpdatesLog({ filename: metaFilename, user: metaUser, week: metaWeek });
    } catch {}

    console.log("✅ PDF usunięty z archiwum:", id);
    loadWeekbriefArchive(); // odśwież kafelki
    setTimeout(() => { try { renderUpdateBanner?.(); } catch {} }, 150);

  } catch (e) {
    console.error("❌ Błąd usuwania PDF:", e);
    alert("Kon niet verwijderen: " + (e?.message || e));
  }
}

/** 🧹 Usuń powiązane wpisy 'weekbrief' z updatesLog (po filename / user / week) */
async function removeWeekbriefLogsFromUpdatesLog({ filename = "", user = "", week = "" } = {}) {
  const qs = await db.collection("updatesLog")
    .where("field", "==", "weekbrief")
    .orderBy("timestamp", "desc")
    .limit(100)
    .get();

  const norm = s => String(s || "").trim().toLowerCase();
  const fn = norm(filename), u = norm(user), w = norm(week);

  const toDelete = [];
  qs.forEach(doc => {
    const d = doc.data() || {};
    const dFn = norm(d.filename || d.value || "");
    const dU = norm(d.user || "");
    const dW = norm(String(d.week || ""));

    if ((fn && dFn && dFn === fn) || ((u && dU === u) && (w && dW === w))) {
      toDelete.push(doc.ref);
    }
  });

  if (toDelete.length) {
    const batch = db.batch();
    toDelete.forEach(ref => batch.delete(ref));
    await batch.commit();
    console.log(`🧹 updatesLog: usunięto ${toDelete.length} wpis(ów) Weekbrief.`);
  }
}

/** Usuń z banera KONKRETNY wpis Weekbrief dopasowując po filename/user/week (case-insensitive) */
function removeWeekbriefBannerItem({ filename = "", user = "", week = "" } = {}) {
  const banner = document.getElementById("projectUpdateBanner");
  if (!banner) return;

  const fn = (filename || "").trim().toLowerCase();
  const u = (user || "").trim().toLowerCase();
  const w = String(week || "").trim().toLowerCase();

  const items = banner.querySelectorAll('.update-item[data-field="weekbrief"]');
  let removed = 0;

  items.forEach(li => {
    const dFn = (li.getAttribute("data-filename") || "").trim().toLowerCase();
    const dU = (li.getAttribute("data-user") || "").trim().toLowerCase();
    const dW = (li.getAttribute("data-week") || "").trim().toLowerCase();

    const matchByFilename = fn && dFn && dFn === fn;
    const matchByUserWeek = u && w && dU === u && dW === w;

    if (matchByFilename || matchByUserWeek) {
      li.remove();
      removed++;
    }
  });

  if (removed) {
    const ul = banner.querySelector("ul");
    if (ul && !ul.querySelector(".update-item")) banner.style.display = "none";
    console.log(`🧹 Baner: zdjęto ${removed} wpis(ów) Weekbrief.`);
  }
}

/** 🔧 helper — usuwa elementy z banera po data-project */
function removeBannerItemsByNames(names = []) {
  const banner = document.getElementById("projectUpdateBanner");
  if (!banner || !names.length) return;

  const nameSet = new Set(names.map(n => String(n).toLowerCase().trim()).filter(Boolean));
  const items = banner.querySelectorAll(".update-item");

  items.forEach(li => {
    let key = (li.dataset.project || "").toLowerCase().trim();
    if (!key) {
      const b = li.querySelector("b");
      if (b && b.textContent) key = b.textContent.toLowerCase().trim();
    }
    if (key && nameSet.has(key)) li.remove();
  });

  const ul = banner.querySelector("ul");
  if (ul && !ul.querySelector(".update-item")) banner.style.display = "none";
}

// ==== WEEKBRIEF: usuń powiązane logi z updatesLog (po docId i/lub nazwie) ====
async function pruneWeekbriefLogsByDocOrName(wbDocId, wbName) {
  try {
    const batch = db.batch();

    if (wbDocId) {
      const q1 = await db.collection("updatesLog")
        .where("_wbDocId", "==", wbDocId).get();
      q1.forEach(d => batch.delete(d.ref));
    }

    if (wbName) {
      const q2 = await db.collection("updatesLog")
        .where("projectName", "==", wbName)
        .where("field", "==", "weekbrief").get();
      q2.forEach(d => batch.delete(d.ref));
    }

    await batch.commit();
  } catch (e) {
    console.warn("pruneWeekbriefLogsByDocOrName:", e);
  }
}

/** 🔁 Odświeżenie listy PDF-ów (kafelki do #wbGrid) + kasowanie */
async function loadWeekbriefArchive() {
  const grid = document.getElementById("wbGrid");
  if (!grid) return;

  grid.innerHTML = '<div class="wb-placeholder">Ładowanie…</div>';

  try {
    const qs = await db.collection("weekbriefArchive")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    if (qs.empty) {
      grid.innerHTML = '<div class="wb-placeholder">Brak plików w archiwum.</div>';
      return;
    }

    const cards = qs.docs.map(doc => {
      const i = doc.data();
      const when = i.createdAt?.toDate?.()?.toLocaleString("nl-NL") || "";
      const title = (i.filename || "Weekbrief.pdf").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const id = doc.id;
      const path = encodeURIComponent(i.path || "");
      const url = encodeURIComponent(i.url || "");

      return `
        <div class="wb-card">
          <a class="wb-card-link" href="${i.url}" target="_blank" rel="noopener">
            <div class="wb-card-icon">📄</div>
            <div class="wb-card-body">
              <div class="wb-card-title">${title}</div>
              <div class="wb-card-meta">
                ${i.user || "onbekend"} • week ${i.week || "?"}${when ? " • " + when : ""}
              </div>
            </div>
          </a>
          <button class="wb-delete-btn" title="Verwijder"
                  data-id="${id}" data-path="${path}" data-url="${url}">❌</button>
        </div>
      `;
    }).join("");

    grid.innerHTML = cards;

    grid.querySelectorAll(".wb-delete-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        deleteWeekbriefFromArchive(btn.dataset.id, btn.dataset.path, btn.dataset.url);
      });
    });

  } catch (e) {
    console.error("Nie udało się załadować archiwum:", e);
    grid.innerHTML = '<div class="wb-placeholder">Błąd ładowania archiwum.</div>';
  }
}

// ▶️ Jednorazowe wczytanie po starcie
document.getElementById("refreshWbArchiveBtn")?.addEventListener("click", (e) => {
  e.preventDefault();
  loadWeekbriefArchive();
});
document.addEventListener("DOMContentLoaded", () => {
  loadWeekbriefArchive();
});

// --- Role / stan użytkownika ---
const managers = ["Sjaak", "Jos", "Jacco", "Nanda"];
const allUsers = [...managers, "Pieter", "Thijs", "Hilko", "Roel", "Benji"];
let currentUser = null;
let currentUserRole = "";
let projects = [];
let currentFilter = "";
let currentLightboxIndex = 0;
let currentLightboxItems = [];
const deletedProjectNamesSession = new Set(); // nazwy projektów skasowanych w TEJ sesji

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  const ok =
    (managers.includes(username) && password === "nl25") ||
    (!managers.includes(username) && allUsers.includes(username) && password === "ma25");

  if (!ok) {
    alert("Ongeldige inloggegevens");
    return;
  }

  currentUser = username;
  sessionStorage.setItem("loggedInUser", currentUser);

  // UI -> część po zalogowaniu
  updateUI();
  clearUnread?.();

  // Housekeeping: zgaś pre-login dzwonek/żółty pasek i ustaw „last seen”
  try { afterSuccessfulLoginHousekeeping?.(); } catch {}

  // Web Push dla zalogowanego usera
  try {  await enablePushForUser(username); } catch (e) { console.warn("enablePushForUser:", e); }

  // Duży baner z update’ów – pokaż, jeśli w tej sesji nie był zamknięty
  const closedKey = `updateBannerClosed_${currentUser}`;
  if (!sessionStorage.getItem(closedKey)) {
    try { await renderUpdateBanner(); } catch (e) { console.warn("renderUpdateBanner:", e); }
  }
}

async function handleLogout() {
  const user = currentUser;

  // (opcjonalnie) wyłącz / oznacz token jako nieaktywny
  if (user) {
    try { await disablePushForUser(user); } catch (e) { console.warn("disablePushForUser:", e); }
  }

  currentUser = null;
  sessionStorage.removeItem("loggedInUser");

  // UI -> ekran logowania
  updateUI();

  // Po wylogowaniu nie ruszamy LAST_SEEN_UPDATE_KEY — dzwonek pokaże się tylko,
  // gdy faktycznie są NOWE wpisy; sprawdź to od razu:
  try { typeof checkForRecentUpdates === "function" && setTimeout(checkForRecentUpdates, 0); } catch {}
}

// (delegacja na przycisk wylogowania – zostaje)
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "logoutBtn") handleLogout();
});

function updateUI() {
  const loggedIn  = !!currentUser;
  const isManager = managers.includes(currentUser);

  // Widoki
  document.getElementById("loginSection").style.display  = loggedIn ? "none"  : "block";
  document.getElementById("mainContent").style.display   = loggedIn ? "block" : "none";
  document.getElementById("logoutSection").style.display = loggedIn ? "block" : "none";
  document.getElementById("welcomeUser").textContent     = loggedIn ? `Welkome ${currentUser} 😊` : "";
  document.getElementById("projectForm").style.display   = isManager ? "block" : "none";

  // Dane
  renderCheckboxes();
  loadProjects();
  if (loggedIn) loadWeekbriefArchive?.();

  // 🔔 Dzwonek i mały żółty baner:
  const ring = document.getElementById("ringIcon");
  const tinyBanner = document.getElementById("updateBanner"); // mały pre-login „toaster”

  if (loggedIn) {
    // po zalogowaniu zawsze chowamy oba (dzwonek i mały baner)
    ring?.classList.add("hidden");
    tinyBanner?.classList.add("hidden");
  } else {
    // ⛔ Nie odsłaniamy dzwonka na siłę.
    // checkForRecentUpdates() sam zdecyduje, czy pokazać dzwonek + dymek + dźwięk.
    if (typeof checkForRecentUpdates === "function") {
      setTimeout(checkForRecentUpdates, 0);
    }
  }
} 
function renderCheckboxes() {
  const container = document.getElementById("werknemerCheckboxes");
  if (!container) return;
  container.innerHTML = "";
  allUsers.forEach(name => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" name="werknemers" value="${name}"> ${name}`;
    container.appendChild(label);
  });
}

async function saveProject(e) {
  e.preventDefault();

  const name = document.getElementById("projectName").value.trim();
  const omschrijving = document.getElementById("omschrijving").value.trim();
  const locatie = document.getElementById("locatie").value.trim();
  const uren = document.getElementById("uren").value.trim();
  const materialen = document.getElementById("materialen").value.trim();
  const extra = document.getElementById("extraWerk").value.trim();
  const werknemers = Array.from(document.querySelectorAll('input[name="werknemers"]:checked')).map(cb => cb.value);
  const tijd = new Date().toLocaleString();

  const mediaFiles = Array.from(document.getElementById("media").files || []);
  const mediaURLs = [];

  try {
    // Uploady (sekwencyjnie – jak chcesz szybciej, przerób na Promise.all)
    const storage = firebase.app().storage("marijs-afwerking.firebasestorage.app");
    const storageRef = storage.ref();

    for (const file of mediaFiles) {
      const filePath = `media/${Date.now()}_${file.name}`;
      const fileRef = storageRef.child(filePath);
      await fileRef.put(file);
      const downloadURL = await fileRef.getDownloadURL();

      const type = file.type?.startsWith("image") ? "img"
                : file.type?.startsWith("video") ? "video"
                : "file";

      mediaURLs.push({ name: file.name, type, url: downloadURL, refPath: filePath });
    }

    const project = {
      name, omschrijving, locatie, uren, materialen, extra, werknemers,
      tijd, media: mediaURLs, kosten: [], totalen: {}, werkzaamhedenData: {}
    };

    // Zapis projektu
    const docRef = await db.collection("projects").add(project);

    // prosty log (zostawiam, jak masz)
    await db.collection("updates").doc("latest").set({
      tijd: new Date().toISOString(),
      projectName: name,
      field: "nieuw project"
    });

    // log do updatesLog (pod baner/dzwonek)
    try {
      const voorTekst = werknemers.length ? ` voor: ${werknemers.join(", ")}` : "";
      await db.collection("updatesLog").add({
        timestamp: new Date(),
        projectName: name || "onbekend",
        field: "naam", // ← spójne z mapą ikon (👆 "naam")
        action: `Nieuw project toegevoegd veld: naam${voorTekst}`,
        user: typeof currentUser === "string" ? currentUser : "onbekend",
        projectId: docRef.id
      });
    } catch (err) {
      console.error("❌ Błąd przy logowaniu update:", err);
    }

    // UI odświeżenie
    await loadProjects();
    e.target?.reset?.();
    renderCheckboxes?.();

    // 🔔 PUSH – dopiero po sukcesie zapisu
    await sendPushNotificationToAllUsers(
      "📊 Nieuw project",
      `Project ${name} is toegevoegd door ${currentUser || "onbekend"}`,
      name, // projectName → trafi do payloadu (wykorzystasz w SW/kliknięciu)
      "naam", // field → spójne z Twoją mapą ikon (👷, 🧱, 📷, ...); "naam" da 🔔/🆕
      window.location.origin // clickAction → po kliknięciu otworzy Twoją aplikację
    );

  } catch (err) {
    console.error("saveProject error:", err);
    alert("Kon project niet opslaan: " + (err?.message || err));
  }
}

async function loadProjects() {
  const snapshot = await db.collection("projects").get();
  projects = snapshot.docs.map(doc => ({ ...doc.data(), docId: doc.id }));
  projects.sort((a, b) => a.name.localeCompare(b.name));

  const updatesSnapshot = await db.collection("updatesLog")
    .orderBy("timestamp", "desc")
    .limit(50)
    .get();
  const updatesLog = updatesSnapshot.docs.map(doc => doc.data());

  await renderUpdateBanner(updatesLog, projects);
  renderProjects(currentFilter);
}



function showUpdateNotice() {
  const banner = document.getElementById("updateNotification");
  if (banner) {
    banner.classList.remove("hidden");
  }
}

function closeUpdateNotice() {
  const banner = document.getElementById("updateNotification");
  if (banner) {
    banner.classList.add("hidden");
  }
}

function renderProjects(filter = currentFilter) {
  currentFilter = filter;
  const filteredProjects = filter
    ? projects.filter((p) => p.name?.toLowerCase().startsWith(filter.toLowerCase()))
    : projects;

  const container = document.getElementById("projectenTabelBody");
  container.innerHTML = "";

  // policz kolumny (dla colSpan paska scrolla)
  const colCount =
    document.querySelectorAll("table.project-table thead th").length || 10;

  filteredProjects.forEach((project) => {
    const row = document.createElement("tr");

    // ✅ identyfikatory wiersza do przewijania / podświetlania
    if (project.docId) {
      row.setAttribute("data-doc-id", project.docId);
      row.id = `proj-${project.docId}`;
    }

    // --- NAAM ---
    const nameCell = document.createElement("td");
    nameCell.textContent = project.name || "";
    row.appendChild(nameCell);

    // --- OMSCHRIJVING (lightbox -> zapis + push w logProjectUpdate) ---
    const omsCell = document.createElement("td");
    const omsDiv = document.createElement("div");
    omsDiv.className = "clickable-description";
    omsDiv.textContent = project.omschrijving?.length
      ? project.omschrijving.substring(0, 100) + (project.omschrijving.length > 100 ? "..." : "")
      : "➕ Voeg omschrijving toe";
    omsDiv.onclick = () => openTextLightbox("Omschrijving", project.omschrijving || "", async (newText) => {
      if ((project.omschrijving || "") === newText) return; // brak realnej zmiany
      project.omschrijving = newText;
      await db.collection("projects").doc(project.docId).update({ omschrijving: newText });
      await logProjectUpdate(project.name, "omschrijving", "Omschrijving gewijzigd", currentUser);
      renderProjects(currentFilter);
    });
    omsCell.appendChild(omsDiv);
    omsCell.appendChild(document.createTextNode(" 📖"));
    row.appendChild(omsCell);

    // --- LOCATIE (contentEditable -> push tylko na blur i gdy się zmieniło) ---
    const locCell = document.createElement("td");
    locCell.contentEditable = true;
    locCell.setAttribute("spellcheck", "false");
    locCell.textContent = project.locatie || "";
    const origLoc = project.locatie || "";
    locCell.addEventListener("blur", async () => {
      const newVal = locCell.textContent.trim();
      if (newVal === origLoc) return; // brak realnej zmiany
      project.locatie = newVal;
      await db.collection("projects").doc(project.docId).update({ locatie: project.locatie });
      await logProjectUpdate(project.name, "locatie", "Locatie gewijzigd", currentUser);
    });
    row.appendChild(locCell);

    // --- UREN (contentEditable -> push na blur i gdy zmienione) ---
    const urenCell = document.createElement("td");
    urenCell.contentEditable = true;
    urenCell.setAttribute("spellcheck", "false");
    urenCell.textContent = project.uren || "";
    const origUren = project.uren || "";
    urenCell.addEventListener("blur", async () => {
      const newVal = urenCell.textContent.trim();
      if (newVal === origUren) return; // brak realnej zmiany
      project.uren = newVal;
      await db.collection("projects").doc(project.docId).update({ uren: project.uren });
      await logProjectUpdate(project.name, "uren", "Uren gewijzigd", currentUser);
    });
    row.appendChild(urenCell);

    // --- MATERIALEN (lightbox -> zapis + push w logProjectUpdate) ---
    const matCell = document.createElement("td");
    const matDiv = document.createElement("div");
    matDiv.className = "clickable-description";
    matDiv.textContent = project.materialen?.length
      ? project.materialen.substring(0, 100) + (project.materialen.length > 100 ? "..." : "")
      : "➕ Voeg materialen toe";
    matDiv.onclick = () => openTextLightbox("Materialen", project.materialen || "", async (newText) => {
      if ((project.materialen || "") === newText) return; // brak realnej zmiany
      project.materialen = newText;
      await db.collection("projects").doc(project.docId).update({ materialen: newText });
      await logProjectUpdate(project.name, "materialen", "Materialen gewijzigd", currentUser);
      renderProjects(currentFilter);
    });
    matCell.appendChild(matDiv);
    matCell.appendChild(document.createTextNode(" 📖"));
    row.appendChild(matCell);

    // --- EXTRA WERK (lightbox -> zapis + push w logProjectUpdate) ---
    const extraCell = document.createElement("td");
    const extraDiv = document.createElement("div");
    extraDiv.className = "clickable-description";
    extraDiv.textContent = project.extra?.length
      ? project.extra.substring(0, 100) + (project.extra.length > 100 ? "..." : "")
      : "➕ Voeg extra werk toe";
    extraDiv.onclick = () => openTextLightbox("Extra werk", project.extra || "", async (newText) => {
      if ((project.extra || "") === newText) return; // brak realnej zmiany
      project.extra = newText;
      await db.collection("projects").doc(project.docId).update({ extra: newText });
      await logProjectUpdate(project.name, "extra", "Extra werk gewijzigd", currentUser);
      renderProjects(currentFilter);
    });
    extraCell.appendChild(extraDiv);
    extraCell.appendChild(document.createTextNode(" 📖"));
    row.appendChild(extraCell);

    // --- DATUM/TIJD ---
    const tijdCell = document.createElement("td");
    tijdCell.textContent = project.tijd || "";
    row.appendChild(tijdCell);

    // --- WERKNEMERS (contentEditable -> push na blur i gdy zmienione) ---
    const werkerCell = document.createElement("td");
    werkerCell.contentEditable = true;
    werkerCell.setAttribute("spellcheck", "false");
    werkerCell.textContent = (project.werknemers || []).join(", ");
    const origWerknemers = (project.werknemers || []).join(", ");
    werkerCell.addEventListener("blur", async () => {
      const newVal = werkerCell.textContent;
      if (newVal.trim() === origWerknemers.trim()) return; // brak realnej zmiany
      project.werknemers = newVal.split(",").map(w => w.trim()).filter(Boolean);
      await db.collection("projects").doc(project.docId).update({ werknemers: project.werknemers });
      await logProjectUpdate(project.name, "werknemers", "Werknemers gewijzigd", currentUser);
    });
    row.appendChild(werkerCell);

    // --- MEDIA ---
    const mediaCell = document.createElement("td");
    mediaCell.className = "media-cell";
    const mediaPreview = document.createElement("div");
    mediaPreview.className = "media-preview";

    (project.media || []).forEach((m, index) => {
      const wrapper = document.createElement("div");
      let el;

      if (m.type === "img") {
        el = document.createElement("img");
        el.src = m.url;
        el.className = "lightbox-item";
        el.onclick = () => openLightbox(
          project.media.filter(x => x.type === "img" || x.type === "video").map(x => x.url),
          project.media.filter(x => x.type === "img" || x.type === "video").indexOf(m)
        );
      } else if (m.type === "video") {
        el = document.createElement("video");
        el.src = m.url;
        el.controls = true;
        el.className = "lightbox-item";
        el.onclick = () => openLightbox(
          project.media.filter(x => x.type === "img" || x.type === "video").map(x => x.url),
          project.media.filter(x => x.type === "img" || x.type === "video").indexOf(m)
        );
      } else {
        el = document.createElement("button");
        el.textContent = `📥 ${m.name}`;
        el.title = `Download: ${m.name}`;
        el.className = "download-pdf-btn";
        el.onclick = () => window.open(m.url, "_blank");
      }

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "X";
      removeBtn.className = "remove-media-btn";
      removeBtn.onclick = async () => {
        // ❗ Usunięcie mediów: aktualizujemy projekt, ale NIE logujemy (brak wpisu/push)
        project.media.splice(index, 1);
        await db.collection("projects").doc(project.docId).update({ media: project.media });
        renderProjects(currentFilter);
        // (opcjonalnie) możesz tu też odświeżyć baner, ale nie ma czego dopisywać:
        // await renderUpdateBanner();
      };

      wrapper.appendChild(el);
      wrapper.appendChild(removeBtn);
      mediaPreview.appendChild(wrapper);
    });

    const lightboxItems = (project.media || []).filter(x => x.type === "img" || x.type === "video");
    if (lightboxItems.length > 2) {
      const moreBtn = document.createElement("button");
      moreBtn.textContent = `+${lightboxItems.length - 2}`;
      moreBtn.className = "more-media-btn";
      moreBtn.onclick = () => openLightbox(lightboxItems.map(x => x.url), 2);
      mediaPreview.appendChild(moreBtn);
    }

    const addInput = document.createElement("input");
    addInput.type = "file";
    addInput.multiple = true;
    addInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files);
      const uploads = [];
      for (const file of files) {
        const filePath = `media/${Date.now()}_${file.name}`;
        const ref = firebase.app().storage("marijs-afwerking.firebasestorage.app").ref().child(filePath);
        await ref.put(file);
        const url = await ref.getDownloadURL();
        const type = file.type.startsWith("image") ? "img" : file.type.startsWith("video") ? "video" : "file";
        uploads.push({ name: file.name, url, refPath: filePath, type });
      }
      if (uploads.length === 0) return;
      project.media = [...(project.media || []), ...uploads];
      await db.collection("projects").doc(project.docId).update({ media: project.media });
      await logProjectUpdate(project.name, "media", "Nieuwe media toegevoegd", currentUser);
      renderProjects(currentFilter);
    });

    mediaCell.appendChild(mediaPreview);
    mediaCell.appendChild(addInput);
    row.appendChild(mediaCell);

    // --- VERWIJDER (tylko manager) ---
    const deleteCell = document.createElement("td");
    if (managers.includes(currentUser)) {
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Verwijder";
      deleteBtn.className = "remove-media-btn";
      deleteBtn.onclick = () => {
  if (confirm("Weet je zeker dat je dit project wilt verwijderen?")) {
    db.collection("projects").doc(project.docId).delete().then(async () => {
      await loadProjects();          // odśwież tabelę
      await renderUpdateBanner();    // ⬅️ od razu odśwież baner zmian
    });
  }
}; 
      deleteCell.appendChild(deleteBtn);
    }
    row.appendChild(deleteCell);

    // ➕ wiersz projektu
    container.appendChild(row);

    // --- CALCULATIE (tylko manager) ---
    if (managers.includes(currentUser)) {
      const calcRow = document.createElement("tr");
      const calcCell = document.createElement("td");
      calcCell.colSpan = colCount;
      const calcBtn = document.createElement("button");
      calcBtn.textContent = "📊 Bekijk calculatie";
      calcBtn.className = "kosten-btn";
      calcBtn.onclick = () => openCostSection(project);
      calcCell.appendChild(calcBtn);
      calcRow.appendChild(calcCell);
      container.appendChild(calcRow);
    }

    // 🔻 Pasek przewijania pod TYM projektem
    const scRow = document.createElement("tr");
    const scCell = document.createElement("td");
    scCell.colSpan = colCount;
    scCell.className = "row-scrollbar-cell";

    const scDiv = document.createElement("div");
    scDiv.className = "row-hscroll";
    scDiv.innerHTML = '<div class="row-hscroll-spacer" style="height:1px;"></div>';

    scCell.appendChild(scDiv);
    scRow.appendChild(scCell);
    container.appendChild(scRow);
  });

  // Po zrenderowaniu – zsynchronizuj paski
  setupRowScrollbars?.();
}

function setupRowScrollbars() {
  const wrapper = document.getElementById("projectTableWrapper");
  const table   = document.querySelector("table.project-table");
  if (!wrapper || !table) return;

  // szerokość całej tabeli i okna
  const total    = table.scrollWidth;       // całkowita szerokość do przewinięcia
  const viewport = wrapper.clientWidth;     // widoczna szerokość

  // ustaw szerokość "spacerów" tak, żeby zasięg scrolla był identyczny jak w wrapperze
  document.querySelectorAll(".row-hscroll").forEach(div => {
    let inner = div.querySelector(".row-hscroll-spacer");
    if (!inner) {
      inner = document.createElement("div");
      inner.className = "row-hscroll-spacer";
      div.appendChild(inner);
    }
    inner.style.height = "1px";
    // WAŻNE: ustawiamy pełną szerokość tabeli (nie różnicę!)
    inner.style.width = `${Math.max(total, viewport)}px`;
    // startowa pozycja = tak jak główny wrapper
    div.scrollLeft = wrapper.scrollLeft;
  });

  // dwustronna synchronizacja (bez pętli)
  let lock = false;

  const syncFromWrapper = () => {
    if (lock) return;
    lock = true;
    const wMax = wrapper.scrollWidth - wrapper.clientWidth;
    const wPos = wMax > 0 ? wrapper.scrollLeft / wMax : 0;
    document.querySelectorAll(".row-hscroll").forEach(div => {
      const dMax = div.scrollWidth - div.clientWidth;
      div.scrollLeft = dMax * wPos;
    });
    lock = false;
  };

  const syncFromRow = (e) => {
    if (lock) return;
    const div = e.currentTarget;
    lock = true;
    const dMax = div.scrollWidth - div.clientWidth;
    const dPos = dMax > 0 ? div.scrollLeft / dMax : 0;
    const wMax = wrapper.scrollWidth - wrapper.clientWidth;
    wrapper.scrollLeft = wMax * dPos;
    lock = false;
  };

  // podpinamy nasłuchy
  wrapper.removeEventListener("scroll", syncFromWrapper);
  wrapper.addEventListener("scroll", syncFromWrapper, { passive: true });

  document.querySelectorAll(".row-hscroll").forEach(div => {
    div.removeEventListener("scroll", syncFromRow);
    div.addEventListener("scroll", syncFromRow, { passive: true });
  });

  // przy zmianie rozmiaru przelicz szerokości
  window.removeEventListener("resize", setupRowScrollbars);
  window.addEventListener("resize", setupRowScrollbars);
} 

function openCostSection(project) {
  const container = document.createElement("div");
  container.className = "costs-section";

  const title = document.createElement("h3");
  title.textContent = `Kosten voor project: ${project.name}`;
  container.appendChild(title);

  // === Materiały ===
  const table = document.createElement("table");
  table.className = "cost-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Materiaal</th><th>Aantal</th><th>Prijs (€)</th><th>BTW (%)</th><th></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  project.kosten = project.kosten || [];

  const renderRows = () => {
    tbody.innerHTML = "";
    project.kosten.forEach((item, index) => {
      const row = document.createElement("tr");

      ["materiaal", "aantal", "prijs", "btw"].forEach((key) => {
        const cell = document.createElement("td");
        const input = document.createElement("input");
        input.type = (key === "prijs" || key === "btw") ? "number" : "text";
        if (input.type === "number") input.step = "0.01";
        input.value = item[key] ?? "";
        input.placeholder = key;

        let lastVal = input.value;

        const commit = async () => {
          // zapisuj tylko gdy realna zmiana
          if (input.value === lastVal) return;
          item[key] = input.value;
          try {
            await db.collection("projects").doc(project.docId).update({ kosten: project.kosten });
            lastVal = input.value;
          } catch (e) {
            console.warn("Kosten update failed:", e);
          }
        };

        input.addEventListener("blur", commit);
        input.addEventListener("change", commit);

        cell.appendChild(input);
        row.appendChild(cell);
      });

      const delCell = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.textContent = "X";
      delBtn.onclick = async () => {
        project.kosten.splice(index, 1);
        try {
          await db.collection("projects").doc(project.docId).update({ kosten: project.kosten });
        } catch (e) {
          console.warn("Kosten delete failed:", e);
        }
        renderRows();
      };
      delCell.appendChild(delBtn);
      row.appendChild(delCell);

      tbody.appendChild(row);
    });
  };

  container.appendChild(table);

  const addBtn = document.createElement("button");
  addBtn.textContent = "+ Materiaal toevoegen";
  addBtn.onclick = async () => {
    project.kosten.push({ materiaal: "", aantal: "", prijs: "", btw: "" });
    try {
      await db.collection("projects").doc(project.docId).update({ kosten: project.kosten });
    } catch (e) {
      console.warn("Kosten add failed:", e);
    }
    renderRows();
  };
  container.appendChild(addBtn);

  container.appendChild(document.createElement("hr"));

  // === Wykonane prace ===
  const workTypes = ["Schilderen", "Behangen", "Stuckwerk"];
  const workDiv = document.createElement("div");
  workDiv.innerHTML = "<h4>Uitgevoerde werkzaamheden:</h4>";
  project.werkzaamhedenData = project.werkzaamhedenData || {};

  workTypes.forEach((type) => {
    const row = document.createElement("div");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!project.werkzaamhedenData[type]?.enabled;
    row.appendChild(cb);

    const label = document.createElement("label");
    label.textContent = ` ${type} `;
    row.appendChild(label);

    const m2Input = document.createElement("input");
    m2Input.type = "number"; m2Input.placeholder = "m²"; m2Input.style.width = "50px";
    m2Input.value = project.werkzaamhedenData[type]?.m2 ?? "";

    const m2Price = document.createElement("input");
    m2Price.type = "number"; m2Price.placeholder = "€/m²"; m2Price.style.width = "60px";
    m2Price.value = project.werkzaamhedenData[type]?.m2Prijs ?? "";

    const hourInput = document.createElement("input");
    hourInput.type = "number"; hourInput.placeholder = "uren"; hourInput.style.width = "50px";
    hourInput.value = project.werkzaamhedenData[type]?.uren ?? "";

    const hourPrice = document.createElement("input");
    hourPrice.type = "number"; hourPrice.placeholder = "€/u"; hourPrice.style.width = "60px";
    hourPrice.value = project.werkzaamhedenData[type]?.uurPrijs ?? "";

    [m2Input, m2Price, hourInput, hourPrice].forEach((el) => row.appendChild(el));

    const updateData = async () => {
      project.werkzaamhedenData[type] = {
        enabled: cb.checked,
        m2: parseFloat(m2Input.value) || 0,
        m2Prijs: parseFloat(m2Price.value) || 0,
        uren: parseFloat(hourInput.value) || 0,
        uurPrijs: parseFloat(hourPrice.value) || 0,
      };
      try {
        await db.collection("projects").doc(project.docId).update({ werkzaamhedenData: project.werkzaamhedenData });
      } catch (e) {
        console.warn("Werkzaamheden update failed:", e);
      }
    };

    cb.addEventListener("change", updateData);
    [m2Input, m2Price, hourInput, hourPrice].forEach((el) => {
      el.addEventListener("blur", updateData);
      el.addEventListener("change", updateData);
    });

    workDiv.appendChild(row);
  });

  container.appendChild(workDiv);
  container.appendChild(document.createElement("hr"));

  // === VAT toggle ===
  const vatDiv = document.createElement("div");
  vatDiv.innerHTML = `
    <label><input type="radio" name="vatMode" value="excl" checked> Prijs excl. BTW</label>
    <label><input type="radio" name="vatMode" value="incl"> Prijs incl. BTW</label>
  `;
  container.appendChild(vatDiv);

  const totalDiv = document.createElement("div");
  totalDiv.style.marginTop = "10px";
  container.appendChild(totalDiv);

  // === Popup ===
  const popup = window.open("", "_blank", "width=900,height=700,scrollbars=yes");
  popup.document.write(`<html><head><title>Kosten</title><style>body{font-family:sans-serif;padding:20px;}</style></head><body></body></html>`);
  popup.document.body.appendChild(container);

  // === Akcje ===
  const calcBtn = document.createElement("button");
  calcBtn.textContent = "Bereken totaal";
  calcBtn.onclick = async () => {
    let materialenSom = 0;
    (project.kosten || []).forEach((item) => {
      const aantal = parseFloat(item.aantal) || 0;
      const prijs = parseFloat(item.prijs) || 0;
      const btw = parseFloat(item.btw) || 0;
      const netto = aantal * prijs;
      const bruto = netto + netto * (btw / 100);
      materialenSom += bruto;
    });

    let werkSom = 0;
    for (const [, data] of Object.entries(project.werkzaamhedenData || {})) {
      if (!data.enabled) continue;
      const m2Sum = (data.m2 || 0) * (data.m2Prijs || 0);
      const uurSum = (data.uren || 0) * (data.uurPrijs || 0);
      werkSom += m2Sum + uurSum;
    }

    const totaal = materialenSom + werkSom;
    const vatMode = popup.document.querySelector('input[name="vatMode"]:checked')?.value || "excl";

    project.totalen = {
      materialen: materialenSom,
      werkzaamheden: werkSom,
      totaal,
      vatMode,
    };
    try {
      await db.collection("projects").doc(project.docId).update({ totalen: project.totalen });
    } catch (e) {
      console.warn("Totalen update failed:", e);
    }

    totalDiv.textContent = `Totale kosten: €${totaal.toFixed(2)} (${vatMode === "excl" ? "excl. btw" : "incl. btw"})`;
  };
  container.appendChild(calcBtn);

  const pdfBtn = document.createElement("button");
  pdfBtn.textContent = "Exporteer PDF";
  pdfBtn.onclick = () => {
    exportProjectCostToPDF(project);
    alert("PDF is opgeslagen. U kunt het venster sluiten wanneer u klaar bent.");
  };
  container.appendChild(pdfBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Sluit venster";
  closeBtn.onclick = () => popup.close();
  container.appendChild(closeBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Annuleren";
  cancelBtn.onclick = () => popup.close();
  container.appendChild(cancelBtn);

  renderRows();
}

function exportProjectCostToPDF(project) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "A4" });
  const logo = new Image();
  logo.src = "logo-192.png";

  logo.onload = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("nl-NL");

    doc.addImage(logo, "PNG", 10, 10, 20, 20);
    doc.setFontSize(16);
    doc.text(`Kostenoverzicht – ${project.name}`, 35, 20);
    doc.setFontSize(10);
    doc.text(`Datum: ${dateStr}`, 180, 20, { align: "right" });

    let y = 35;

    if (project.locatie) {
      doc.setFontSize(11);
      doc.text(`Locatie: ${project.locatie}`, 10, y);
      y += 8;
    }

    // Materiały
    doc.setFontSize(13);
    doc.text("Materialen:", 10, y); y += 6;
    doc.setFontSize(11);
    if (project.kosten?.length) {
      project.kosten.forEach((item) => {
        const naam = item.materiaal || "-";
        const aantal = parseFloat(item.aantal) || 0;
        doc.text(`- ${naam} (${aantal} stuks)`, 12, y);
        y += 5;
      });
    } else {
      doc.text("Geen materialen toegevoegd.", 12, y);
      y += 5;
    }
    doc.text(`Subtotaal materiales: €${(project.totalen?.materialen || 0).toFixed(2)}`, 12, y);
    y += 10;

    // Prace
    doc.setFontSize(13);
    doc.text("Uitgevoerde werkzaamheden:", 10, y); y += 6;
    doc.setFontSize(11);
    const data = project.werkzaamhedenData || {};
    Object.entries(data).forEach(([type, values]) => {
      if (!values.enabled) return;
      if ((values.m2 || 0) > 0)
        { doc.text(`- ${type} – ${values.m2} m² × €${values.m2Prijs} = €${(values.m2 * values.m2Prijs).toFixed(2)}`, 12, y); y += 5; }
      if ((values.uren || 0) > 0)
        { doc.text(`- ${type} – ${values.uren} uur × €${values.uurPrijs} = €${(values.uren * values.uurPrijs).toFixed(2)}`, 12, y); y += 5; }
    });

    y += 6; doc.setLineWidth(0.5); doc.line(10, y, 200, y); y += 8;

    const totaal = project.totalen?.totaal || 0;
    const btwText = project.totalen?.vatMode === "incl" ? "incl. btw" : "excl. btw";
    doc.setFontSize(14);
    doc.text("Totale kosten:", 10, y);
    doc.text(`€${totaal.toFixed(2)} (${btwText})`, 180, y, { align: "right" });

    y += 20;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("Voor vragen, contacteer:", 10, y); y += 5;
    doc.text("info@marijsafwerking.nl", 10, y);

    doc.save(`kosten_${project.name}.pdf`);
  };
} 


let lightboxMedia = [];
let lightboxIndex = 0;

/* ===========================
   🔍 ZOOM ENGINE (desktop & touch)
   =========================== */
const LB_ZOOM = {
  el: null, scale: 1, min: 1, max: 5, step: 0.2,
  x: 0, y: 0, dragging: false, startX: 0, startY: 0
};

function lbApply() {
  if (!LB_ZOOM.el) return;
  LB_ZOOM.el.style.transform = `translate(${LB_ZOOM.x}px, ${LB_ZOOM.y}px) scale(${LB_ZOOM.scale})`;
  LB_ZOOM.el.style.transformOrigin = 'center center';
  LB_ZOOM.el.style.willChange = 'transform';
  LB_ZOOM.el.style.cursor = LB_ZOOM.scale > 1 ? 'grab' : 'default';
}

function lbReset() {
  LB_ZOOM.scale = 1;
  LB_ZOOM.x = 0;
  LB_ZOOM.y = 0;
  lbApply();
}

function lbAttachTo(el) {
  if (LB_ZOOM.el && LB_ZOOM.el !== el) {
    LB_ZOOM.el.style.transform = '';
    LB_ZOOM.el.style.cursor = '';
  }
  LB_ZOOM.el = el || null;
  lbReset();
}

const lbClampScale = (s) => Math.max(LB_ZOOM.min, Math.min(LB_ZOOM.max, s));

function lbZoomBy(delta, clientX, clientY) {
  if (!LB_ZOOM.el) return;

  const prevScale = LB_ZOOM.scale;
  const nextScale = lbClampScale(prevScale + delta);
  if (nextScale === prevScale) return;

  if (typeof clientX === 'number' && typeof clientY === 'number') {
    const rect = LB_ZOOM.el.getBoundingClientRect();
    const cx = clientX - (rect.left + rect.width / 2) - LB_ZOOM.x;
    const cy = clientY - (rect.top + rect.height / 2) - LB_ZOOM.y;
    const k = nextScale / prevScale - 1;
    LB_ZOOM.x -= cx * k;
    LB_ZOOM.y -= cy * k;
  }

  LB_ZOOM.scale = nextScale;
  lbApply();
}

// Drag (mysz)
document.addEventListener('mousedown', (e) => {
  if (!LB_ZOOM.el || LB_ZOOM.scale <= 1 || e.target !== LB_ZOOM.el) return;
  LB_ZOOM.dragging = true;
  LB_ZOOM.el.style.cursor = 'grabbing';
  LB_ZOOM.startX = e.clientX - LB_ZOOM.x;
  LB_ZOOM.startY = e.clientY - LB_ZOOM.y;
});
document.addEventListener('mousemove', (e) => {
  if (!LB_ZOOM.dragging || !LB_ZOOM.el) return;
  LB_ZOOM.x = e.clientX - LB_ZOOM.startX;
  LB_ZOOM.y = e.clientY - LB_ZOOM.startY;
  lbApply();
});
document.addEventListener('mouseup', () => {
  if (!LB_ZOOM.el) return;
  LB_ZOOM.dragging = false;
  LB_ZOOM.el.style.cursor = LB_ZOOM.scale > 1 ? 'grab' : 'default';
});

// Touch (pan + pinch)
let pinchStartDist = null, pinchStartScale = 1;
const touchDistance = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
const touchCenter   = (t1, t2) => ({ x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 });

document.addEventListener('touchstart', (e) => {
  if (!LB_ZOOM.el) return;
  if (e.touches.length === 1) {
    if (LB_ZOOM.scale > 1 && e.target === LB_ZOOM.el) {
      LB_ZOOM.dragging = true;
      LB_ZOOM.startX = e.touches[0].clientX - LB_ZOOM.x;
      LB_ZOOM.startY = e.touches[0].clientY - LB_ZOOM.y;
    }
  } else if (e.touches.length === 2) {
    pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
    pinchStartScale = LB_ZOOM.scale;
  }
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!LB_ZOOM.el) return;
  if (e.touches.length === 1 && LB_ZOOM.dragging) {
    LB_ZOOM.x = e.touches[0].clientX - LB_ZOOM.startX;
    LB_ZOOM.y = e.touches[0].clientY - LB_ZOOM.startY;
    lbApply();
  } else if (e.touches.length === 2 && pinchStartDist) {
    const dist = touchDistance(e.touches[0], e.touches[1]);
    const ratio = dist / pinchStartDist;
    const targetScale = lbClampScale(pinchStartScale * ratio);
    const delta = targetScale - LB_ZOOM.scale;
    const center = touchCenter(e.touches[0], e.touches[1]);
    lbZoomBy(delta, center.x, center.y);
  }
}, { passive: false });

document.addEventListener('touchend', () => {
  LB_ZOOM.dragging = false;
  pinchStartDist = null;
}, { passive: true });

/* ===========================
   📸 LIGHTBOX
   =========================== */
function openLightbox(urls = [], index = 0) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  const video = document.getElementById('lightboxVideo');
  const text = document.getElementById('lightboxText');

  lightboxMedia = Array.isArray(urls) ? urls : [];
  if (!lightboxMedia.length) return;

  lightboxIndex = Math.max(0, Math.min(index, lightboxMedia.length - 1));
  const currentUrl = lightboxMedia[lightboxIndex];

  const isVideo = /\.(mp4|webm|ogg)$/i.test(currentUrl);

  if (isVideo) {
    if (video) {
      video.src = currentUrl;
      video.style.display = 'block';
    }
    if (img) img.style.display = 'none';
    if (text) text.style.display = 'none';
    lbAttachTo(video);
  } else {
    if (img) {
      img.src = currentUrl;
      img.style.display = 'block';
    }
    if (video) video.style.display = 'none';
    if (text) text.style.display = 'none';
    lbAttachTo(img);
  }

  if (lightbox) {
    lightbox.classList.remove('hidden');
    lightbox.style.display = 'flex';
  }

  // wyczyść ewentualne HUD-y
  document.querySelectorAll('.lb-hud, #lbHud').forEach(el => el.remove());

  // blokuj zoom przeglądarki TYLKO w LB
  if (typeof enableNoBrowserZoom === 'function') {
    enableNoBrowserZoom();
  }
}

function navigateLightbox(direction) {
  if (!lightboxMedia.length) return;
  lightboxIndex += direction;
  if (lightboxIndex < 0) lightboxIndex = lightboxMedia.length - 1;
  if (lightboxIndex >= lightboxMedia.length) lightboxIndex = 0;

  const currentUrl = lightboxMedia[lightboxIndex];
  const isVideo = /\.(mp4|webm|ogg)$/i.test(currentUrl);
  const img = document.getElementById('lightboxImg');
  const video = document.getElementById('lightboxVideo');

  if (isVideo) {
    if (video) {
      video.src = currentUrl;
      video.style.display = 'block';
    }
    if (img) img.style.display = 'none';
    lbAttachTo(video);
  } else {
    if (img) {
      img.src = currentUrl;
      img.style.display = 'block';
    }
    if (video) video.style.display = 'none';
    lbAttachTo(img);
  }
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  const video = document.getElementById('lightboxVideo');
  const text = document.getElementById('lightboxText');
  const textContent = document.getElementById('lightboxTextContent');
  const leftArrow = document.querySelector('.left-arrow');
  const rightArrow = document.querySelector('.right-arrow');

  if (lightbox) {
    lightbox.classList.add('hidden');
    lightbox.style.display = 'none';
  }

  lbAttachTo(null);

  if (img) { img.style.display = 'none'; img.src = ''; img.style.transform = ''; img.style.cursor = ''; }
  if (video) { video.style.display = 'none'; video.src = ''; video.style.transform = ''; video.style.cursor = ''; }
  if (text) text.style.display = 'none';
  if (textContent) textContent.innerHTML = '';
  if (leftArrow) leftArrow.style.display = 'block';
  if (rightArrow) rightArrow.style.display = 'block';

  if (typeof disableNoBrowserZoom === 'function') {
    disableNoBrowserZoom();
  }
}

/* ===========================
   🚫 Blokada zoomu przeglądarki w LB (bez duplikatów)
   =========================== */
if (typeof _preventBrowserZoom !== 'function') {
  function _preventBrowserZoom(e) {
    if (e.ctrlKey || e.type === 'gesturestart') e.preventDefault();
  }
}
if (typeof enableNoBrowserZoom !== 'function') {
  function enableNoBrowserZoom() {
    window.addEventListener('wheel', _preventBrowserZoom, { passive: false });
    window.addEventListener('gesturestart', _preventBrowserZoom, { passive: false });
  }
}
if (typeof disableNoBrowserZoom !== 'function') {
  function disableNoBrowserZoom() {
    window.removeEventListener('wheel', _preventBrowserZoom, { passive: false });
    window.removeEventListener('gesturestart', _preventBrowserZoom, { passive: false });
  }
}

// Rolką myszy zoomujemy w obrębie LB (i tylko gdy LB_ZOOM.el jest podpięty)
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('lightbox');
  if (container) {
    container.addEventListener('wheel', (e) => {
      if (!LB_ZOOM.el) return;
      const delta = e.deltaY < 0 ? LB_ZOOM.step : -LB_ZOOM.step;
      lbZoomBy(delta, e.clientX, e.clientY);
      e.preventDefault();
    }, { passive: false });
  }
}); 

// 🔁 Update-checker
// Mały baner „nowa wersja / reload”
function showUpdateNotice() {
  const notification = document.getElementById("updateNotification");
  if (notification) {
    notification.style.display = "block";
    notification.addEventListener("click", () => window.location.reload());
  }
}

// 🕒 Aktualna data/godzina (nagłówek)
function updateDateTime() {
  const dt = document.getElementById("datetime");
  if (!dt) return;
  const now = new Date();
  dt.textContent = now.toLocaleString();
}
setInterval(updateDateTime, 10000);
updateDateTime();

// 🔢 Numer tygodnia (guard – nie nadpisuj, jeśli już jest)
if (typeof getCurrentWeekNumber !== "function") {
  function getCurrentWeekNumber() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    now.setDate(now.getDate() + 3 - ((now.getDay() + 6) % 7));
    const week1 = new Date(now.getFullYear(), 0, 4);
    return 1 + Math.round(((now - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }
}

// Czyszczenie lokalnych danych tygodnia
function clearWeeklyData() {
  localStorage.removeItem("weekbriefData");
  document.querySelectorAll(".weekbrief-dag input[type='number']").forEach(inp => inp.value = "");
  const wt = document.getElementById("weektotaal");
  if (wt) wt.value = "";
}

// Ręczne ustawienie tygodnia
function setWeekManually(event) {
  event.preventDefault();
  const manualWeek = parseInt(document.getElementById("manualWeek").value, 10);
  if (manualWeek >= 1 && manualWeek <= 53) {
    localStorage.setItem("currentWeek", manualWeek);
    const wb = document.getElementById("wbWeeknummer");
    if (wb) wb.value = manualWeek;
    document.getElementById("manualWeek").value = "";
  } else {
    alert("Voer een weeknummer in tussen 1 en 53.");
  }
}

// ✅ Jedna rejestracja Service Workera + natychmiastowy auto-reload po aktualizacji
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js"); // lepiej ze slash'em

      // 🔄 Wymuś sprawdzenie aktualizacji od razu oraz okresowo
      registration.update();
      setInterval(() => registration.update(), 60 * 60 * 1000); // co godzinę

      // 🪧 Pokaż baner + natychmiast przełącz na nowy SW
      const askToReload = () => {
        console.log("[APP] Nowa wersja dostępna!");
        document.getElementById("updateNotification")?.classList.remove("hidden");

        const versionBanner = document.getElementById("appVersion");
        if (versionBanner) {
          versionBanner.classList.remove("hide");
          setTimeout(() => versionBanner.classList.add("hide"), 5000);
        }
      };

      // Jeśli nowy SW już czeka (strona otwarta podczas deployu)
      if (registration.waiting) {
        askToReload();
        registration.waiting.postMessage("SKIP_WAITING");
      }

      // Wykryj nową instalację
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            // Mamy świeżą wersję
            askToReload();
            // ⚡️ Nie czekaj 5s – przełącz od razu
            newWorker.postMessage("SKIP_WAITING");
          }
        });
      });

      // Po przejęciu kontroli przez nowy SW – przeładuj 1x
      let refreshed = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshed) return;
        refreshed = true;
        window.location.reload();
      });

      // Dodatkowo: gdy wrócisz do karty, sprawdź update
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") registration.update();
      });
    } catch (err) {
      console.error("❌ Service Worker register error", err);
    }
  });
}

// Lightbox do edycji dłuższych tekstów
function openTextLightbox(title, content, onSave = null) {
  const overlay = document.createElement("div");
  overlay.id = "textLightboxOverlay";
  overlay.className = "lightboxOverlay";

  const box = document.createElement("div");
  box.className = "lightboxTextBox";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.className = "lightboxTextarea";

  const buttonContainer = document.createElement("div");
  buttonContainer.className = "lightboxButtons";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Opslaan";
  saveBtn.className = "lightboxSaveBtn";
  saveBtn.onclick = async () => {
    const newText = textarea.value.trim();
    if (onSave) await onSave(newText);
    document.body.removeChild(overlay);
  };

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Sluiten";
  closeBtn.className = "lightboxCloseBtn";
  closeBtn.onclick = () => document.body.removeChild(overlay);

  buttonContainer.appendChild(saveBtn);
  buttonContainer.appendChild(closeBtn);

  box.appendChild(heading);
  box.appendChild(textarea);
  box.appendChild(buttonContainer);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

/* ──────────────────────────────────────────────────────────────
   🧹 Helper do wykrywania „usunięć” (żeby NIE logować ich na baner/push)
   ────────────────────────────────────────────────────────────── */
if (typeof isDeletionAction !== "function") {
  function isDeletionAction(field = "", action = "") {
    const f = String(field).toLowerCase();
    const a = String(action).toLowerCase();
    return (
      a.includes("verwijder") || a.includes("verwijderd") ||
      a.includes("usun")      || a.includes("usunię")     ||
      a.includes("remove")    || a.includes("removed")    ||
      f === "delete"          || f === "removed"
    );
  }
}

/* ──────────────────────────────────────────────────────────────
   ✅ Centralny logger zmian (projekty)
   - pomija „usunięcia”
   - dopina value przy 'werknemers'
   - po zapisie: odświeża baner
   - push nie leci dla 'kosten'
   ────────────────────────────────────────────────────────────── */
async function logProjectUpdate(projectName, field, action, user) {
  const f = String(field || "").toLowerCase();
  const a = String(action || "").toLowerCase();
  if (isDeletionAction(f, a)) return;

  const update = {
    timestamp: new Date(),
    projectName: projectName || "onbekend",
    field,
    action,
    user: user || "onbekend"
  };

  // dopnij listę pracowników
  if (f === "werknemers") {
    const pr = (Array.isArray(projects) ? projects : []).find(p => p?.name === projectName);
    if (pr && Array.isArray(pr.werknemers)) {
      update.value = pr.werknemers.join(", ");
    }
  }

  try {
    await db.collection("updatesLog").add(update);
    try { await renderUpdateBanner(); } catch {}

    if (f !== "kosten") {
      await sendPushNotificationToAllUsers(
        "📢 Update",
        `${action} – project: ${projectName}`,
        projectName,
        field
      );
    }
  } catch (err) {
    console.error("❌ Błąd przy zapisie update:", err);
  }
}

/* ──────────────────────────────────────────────────────────────
   ✅ Logger Weekbriefa (NA BANER + PUSH)
   - dodaje wpis 'weekbrief' do updatesLog
   - wysyła push z dymkiem/dźwiękiem
   - NIE jest filtrowany po istniejących projektach (specjalny przypadek)
   ────────────────────────────────────────────────────────────── */
async function logWeekbriefUpload({ user = "onbekend", week = "", filename = "" } = {}) {
  try {
    await db.collection("updatesLog").add({
      timestamp: new Date(),
      projectName: "Weekbrief",        // ⬅️ spójnie
      field: "weekbrief",
      action: "Weekbrief geüpload",
      user,
      filename,                        // ⬅️ dodane
      week,                            // ⬅️ dodane
      value: filename || ""            // zgodność wstecz
    });

    try { await renderUpdateBanner(); } catch {}

    await sendPushNotificationToAllUsers(
      "📄 Weekbrief",
      `${user} – week ${week || "?"} is geüpload`,
      "Weekbrief",
      "weekbrief"
    );
  } catch (e) {
    console.error("❌ logWeekbriefUpload:", e);
  }
}

// ==== WEEKBRIEF: wspólna nazwa (może zostać, jeśli gdzieś jeszcze używasz) ====
function buildWeekbriefBannerName(user, week) {
  const u = String(user || "onbekend").trim();
  const w = String(week || "?").trim();
  return `[WB] ${u} (week ${w})`;
}
// 🔒 Sesyjny cache skasowanych Weekbriefów (po filename i/lub user|week)
window._wbRemovedSession = window._wbRemovedSession || new Set();
function _wbKeyFromParts({filename="", user="", week=""}) {
  const fn = String(filename||"").trim().toLowerCase();
  const u  = String(user||"").trim().toLowerCase();
  const w  = String(week||"").trim().toLowerCase();
  // dwa klucze: po nazwie pliku i po (user|week)
  const keys = [];
  if (fn) keys.push(`fn|${fn}`);
  if (u && w) keys.push(`uw|${u}|${w}`);
  return keys;
} 

function _wbClearRemovedFor({ filename = "", user = "", week = "" } = {}) {
  _wbKeyFromParts({ filename, user, week })
    .forEach(k => window._wbRemovedSession.delete(k));
} 


/* ──────────────────────────────────────────────────────────────
   🗑️ Usuwanie projektu
   ────────────────────────────────────────────────────────────── */
async function deleteProject(projectId) {
  if (!confirm("Weet je zeker dat je dit project wilt verwijderen?")) return;

  try {
    let projectName = "";
    try {
      const snap = await db.collection("projects").doc(projectId).get();
      if (snap.exists) projectName = snap.data()?.name || "";
    } catch (e) {
      console.warn("⚠️ Nie pobrałem nazwy przed usunięciem:", e);
    }

    await db.collection("projects").doc(projectId).delete();

    if (Array.isArray(projects)) {
      projects = projects.filter(p => p?.docId !== projectId);
    }

    const keyName = String(projectName || "").toLowerCase().trim();
    if (keyName) deletedProjectNamesSession.add(keyName);

    renderProjects(currentFilter);

    if (keyName) removeBannerItemsByNames([keyName]);

    setTimeout(async () => {
      await renderUpdateBanner();
      if (keyName) removeBannerItemsByNames([keyName]);
    }, 150);

  } catch (error) {
    console.error("Fout bij verwijderen:", error);
    alert("Verwijderen mislukt.");
  }
}

/* ──────────────────────────────────────────────────────────────
   🧹 Czyszczenie updatesLog dla nieistniejących projektów
   ────────────────────────────────────────────────────────────── */
async function cleanUpdatesLog() {
  try {
    const projectsSnap = await db.collection("projects").get();
    const activeProjects = projectsSnap.docs.map(doc =>
      (doc.data().name || "").toLowerCase().replace(/\s+/g, "")
    );

    const updatesSnap = await db.collection("updatesLog")
      .orderBy("timestamp", "desc")
      .get();

    const updatesByProject = {};
    updatesSnap.forEach(d => {
      const data = d.data();
      const key = (data.projectName || "").toLowerCase().replace(/\s+/g, "");
      if (!updatesByProject[key]) updatesByProject[key] = [];
      updatesByProject[key].push({ id: d.id, ref: d.ref, ...data });
    });

    const batch = db.batch();
    let count = 0;

    for (const [projectKey, updates] of Object.entries(updatesByProject)) {
      // Weekbrief nie jest projektem – pomiń
      if (projectKey === "weekbrief") continue;

      if (activeProjects.includes(projectKey)) continue;

      let keptDeletedFlag = false;
      for (const u of updates) {
        if (!keptDeletedFlag && String(u.action || "").toLowerCase().includes("verwijder")) {
          keptDeletedFlag = true;
          continue;
        }
        batch.delete(u.ref);
        count++;
      }
    }

    if (count > 0) {
      await batch.commit();
      console.log(`🧹 Usunięto ${count} zbędnych logów (dla nieistniejących projektów).`);
    } else {
      console.log("✅ Brak zbędnych logów.");
    }
  } catch (e) {
    console.error("❌ Błąd cleanUpdatesLog:", e);
  }
}

function afterSuccessfulLoginHousekeeping() {
  localStorage.setItem(LAST_SEEN_UPDATE_KEY, String(Date.now()));
  document.getElementById("ringIcon")?.classList.add("hidden");
  document.getElementById("updateBanner")?.classList.add("hidden");
}

/* 🔎 Skok do projektu + podświetlenie */
function focusProjectRowByName(projectName) {
  if (!projectName) return;

  if (!document.getElementById("updateBannerHelperCSS")) {
    const s = document.createElement("style");
    s.id = "updateBannerHelperCSS";
    s.textContent = `
      .pulse-highlight {
        outline: 2px solid #66ccff;
        background: rgba(102, 204, 255, 0.12);
        transition: background .25s ease;
      }
    `;
    document.head.appendChild(s);
  }

  const rows = document.querySelectorAll("#projectenTabelBody tr");
  let target = null;
  const wanted = String(projectName).trim().toLowerCase();

  for (const r of rows) {
    const td0 = r.firstElementChild;
    if (!td0) continue;
    if (td0.colSpan && td0.colSpan > 1) continue;
    const nameText = (td0.textContent || "").trim().toLowerCase();
    if (nameText === wanted) { target = r; break; }
  }
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("pulse-highlight");
  setTimeout(() => target.classList.remove("pulse-highlight"), 2000);
}

/* ==== AWARYJNY BANER: renderUpdateBanner (drop-in) ==== */
async function renderUpdateBanner() {
  try {
    // 1) ostatnie logi
    const snap = await db.collection("updatesLog")
      .orderBy("timestamp", "desc")
      .limit(200)
      .get();
    const updates = snap.docs.map(d => d.data());

    // 2) istniejące projekty (FS + DOM)
    const projSnap = await db.collection("projects").get();
    const existingNamesFS = new Set(
      projSnap.docs.map(doc => (doc.data().name || "").toLowerCase().trim()).filter(Boolean)
    );
    const existingNamesDOM = new Set();
    document.querySelectorAll("#projectenTabelBody tr").forEach(r => {
      const td0 = r.firstElementChild;
      if (!td0 || (td0.colSpan && td0.colSpan > 1)) return;
      const t = (td0.textContent || "").trim().toLowerCase();
      if (t) existingNamesDOM.add(t);
    });
    const existingNames = new Set([...existingNamesFS, ...existingNamesDOM]);

    // 3) creation-floor
    const creationFloorMsByName = new Map();
    for (const u of updates) {
      const name = (u.projectName || "").toLowerCase().trim();
      const t = u.timestamp?.toDate?.();
      if (!name || !t) continue;
      const isCreation = /nieuw\s+project/i.test(String(u.action || "")) &&
                         String(u.field || "").toLowerCase() === "naam";
      if (isCreation) {
        const ms = t.getTime();
        if (ms > (creationFloorMsByName.get(name) || 0)) {
          creationFloorMsByName.set(name, ms);
        }
      }
    }

    // 4) 🔎 Zbuduj zestaw „istniejących” Weekbriefów z archiwum
    //    (filtrujemy po tym, by nie pokazywać skasowanych)
    const wbSnap = await db.collection("weekbriefArchive")
      .orderBy("createdAt", "desc")
      .limit(150)
      .get();
    const existingWBKeys = new Set();
    wbSnap.docs.forEach(doc => {
      const d = doc.data() || {};
      _wbKeyFromParts({ filename: d.filename, user: d.user, week: d.week })
        .forEach(k => existingWBKeys.add(k));
    });

    // 5) filtr świeżych + reguły Weekbrief
    const now = Date.now();
    const recent = updates.filter(u => {
      const t = u.timestamp?.toDate?.();
      if (!t) return false;
      const ms = t.getTime();
      const fresh = (now - ms) < (7.5 * 60 * 60 * 1000);
      if (!fresh) return false;

      const fieldKey = String(u.field || "").toLowerCase();
      const nameKey  = (u.projectName || "").toLowerCase().trim();

      if (fieldKey === "weekbrief") {
        // klucze dla tego wpisu:
        const keys = _wbKeyFromParts({
          filename: u.filename || u.value || "",
          user: u.user || "",
          week: String(u.week || "")
        });

        // 5a) jeśli w sesyjnym cache skasowanych → nie pokazuj
        if (keys.some(k => window._wbRemovedSession.has(k))) return false;

        // 5b) jeśli NIE istnieje w archiwum → nie pokazuj
        if (!keys.some(k => existingWBKeys.has(k))) return false;

        return true; // OK, istnieje w archiwum
      }

      // pozostałe tylko dla istniejących projektów
      if (!existingNames.has(nameKey)) return false;

      const floor = creationFloorMsByName.get(nameKey);
      if (floor && ms < floor) return false;

      return true;
    });

    // brak danych albo brak zalogowanego → schowaj
    if (!currentUser || recent.length === 0) {
      const hideEl = document.getElementById("projectUpdateBanner");
      if (hideEl) hideEl.style.display = "none";
      return;
    }

    // 6) grupowanie
    const grouped = new Map();
    recent.forEach(u => {
      const key = `${u.projectName}|${u.field}|${u.action}|${u.user}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(u);
    });

    // 7) render
    const icons = {
      werknemers:"👷", materialen:"🧱", media:"📷", omschrijving:"📝",
      naam:"🆕", locatie:"🌍", uren:"⏱️", extra:"📌", weekbrief:"📄"
    };
    const enc = s => String(s ?? "").replace(/"/g, "&quot;");
    const html = [...grouped.entries()].map(([key, list]) => {
      const [projectName, field, action, user] = key.split("|");
      const last = list[0];
      const time = last.timestamp?.toDate?.()?.toLocaleString("nl-NL") || "";
      const icon = icons[field] || "🔹";

      const extra =
        (field === "werknemers" && last.value) ? ` voor <b>${last.value}</b>` :
        (field === "weekbrief" && (last.filename || last.value)) ? ` — <i>${String(last.filename || last.value).replace(/</g,"&lt;")}</i>` :
        "";

      const color =
        field === "weekbrief" ? "#e7f1ff" :
        (/nieuw/i.test(action) ? "#d1e7dd" : "#fff3cd");

      const dataProject = (field === "weekbrief")
        ? "__weekbrief__"
        : String(projectName || "").toLowerCase().trim();

      const safeProj = String(projectName).replace(/'/g, "\\'");
      const onclick  = (field === "weekbrief") ? "" : `onclick="focusProjectRowByName('${safeProj}')"`;

      return `
        <li class="update-item"
            data-project="${dataProject}"
            ${field === "weekbrief"
              ? `data-field="weekbrief"
                 data-filename="${enc(last.filename || last.value || "")}"
                 data-user="${enc(last.user || user || "")}"
                 data-week="${enc(String(last.week || ""))}"`
              : ""
            }
            style="background:${color}; padding:6px; border-radius:8px; margin-bottom:5px; cursor:${field==="weekbrief"?"default":"pointer"};"
            ${onclick}>
          ${
            field === "weekbrief"
              ? `📄 <b>Weekbrief</b> — ${user}${last.week ? ` (week ${last.week})` : ""}${extra} — ${time}`
              : `${icon} <b>${projectName}</b>: ${action} veld <b>${field}</b>${extra} — ${user}, ${time}`
          }
        </li>`;
    }).join("");

    let el = document.getElementById("projectUpdateBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "projectUpdateBanner";
      el.className = "update-banner";
      el.innerHTML = `
        <div style="font-weight:bold; font-size:18px; margin-bottom:6px;">🔔 Laatste projectupdates</div>
        <ul style="list-style:none; padding:0; margin:0;">${html}</ul>
        <button onclick="closeProjectUpdateBanner()" class="sluit-btn">Sluiten</button>
      `;
      document.body.prepend(el);
    } else {
      const ul = el.querySelector("ul");
      if (ul) ul.innerHTML = html; else el.innerHTML = `
        <div style="font-weight:bold; font-size:18px; margin-bottom:6px;">🔔 Laatste projectupdates</div>
        <ul style="list-style:none; padding:0; margin:0;">${html}</ul>
        <button onclick="closeProjectUpdateBanner()" class="sluit-btn">Sluiten</button>`;
      el.style.display = "block";
    }
  } catch (e) {
    console.error("❌ Fout bij renderUpdateBanner:", e);
  }
} 


function closeProjectUpdateBanner() {
  const el = document.getElementById("projectUpdateBanner");
  if (el) el.style.display = "none";
  if (currentUser) sessionStorage.setItem(`updateBannerClosed_${currentUser}`, "true");
} 

/* 🔧 Czyść baner wg pamięci i wymuszeń */
function pruneUpdateBannerAgainstCurrentProjects(forceRemoveNames = []) {
  const banner = document.getElementById("projectUpdateBanner");
  if (!banner) return;

  const forceSet = new Set(
    (forceRemoveNames || []).map(n => String(n || "").toLowerCase().trim()).filter(Boolean)
  );
  const currentNames = new Set(
    (Array.isArray(projects) ? projects : []).map(p => (p?.name || "").toLowerCase().trim())
  );

  const items = banner.querySelectorAll(".update-item");
  let removed = 0;

  items.forEach(li => {
    const key = (li.dataset.project || "").toLowerCase().trim();

    
    if (key === "__weekbrief__") return;

    if (!key) return;
    if (!currentNames.has(key) || forceSet.has(key)) {
      li.remove();
      removed++;
    }
  });

  const ul = banner.querySelector("ul");
  if (ul && !ul.querySelector(".update-item")) {
    banner.style.display = "none";
  }
  if (removed) console.log(`🧹 Baner: usunięto ${removed} wpis(ów) (prune)`);
}




/* 🔘 Przycisk 'Sluiten' */
function closeProjectUpdateBanner() {
  const el = document.getElementById("projectUpdateBanner");
  if (el) el.style.display = "none";
  if (currentUser) {
    sessionStorage.setItem(`updateBannerClosed_${currentUser}`, "true");
  }
}

console.log("✅ Start app");
window.addEventListener("load", () => {
  console.log("✅ window loaded");
});

/* (legacy) Usuwanie wpisów z banera dla jednej nazwy */
function removeUpdateBannerEntries(projectName) {
  const key = String(projectName || "").trim().toLowerCase();
  if (!key) return;

  const banner = document.getElementById("projectUpdateBanner");
  if (!banner) return;

  banner.querySelectorAll('.update-item').forEach(li => {
    if ((li.dataset.project || "").toLowerCase() === key) li.remove();
  });

  const ul = banner.querySelector("ul");
  if (ul && !ul.querySelector(".update-item")) {
    banner.style.display = "none";
  }
  console.log(`🧹 Usunięto wpisy z banera dla projektu: ${projectName}`);
} 
function focusProjectRowByName(projectName) {
  if (!projectName) return;

  // jednorazowo wstrzykujemy styl do podświetlenia
  if (!document.getElementById("updateBannerHelperCSS")) {
    const s = document.createElement("style");
    s.id = "updateBannerHelperCSS";
    s.textContent = `
      .pulse-highlight {
        outline: 2px solid #66ccff;
        background: rgba(102, 204, 255, 0.12);
        transition: background .25s ease;
      }
    `;
    document.head.appendChild(s);
  }

  const rows = document.querySelectorAll("#projectenTabelBody tr");
  let target = null;
  const wanted = String(projectName).trim().toLowerCase();

  for (const r of rows) {
    const td0 = r.firstElementChild;
    if (!td0) continue;
    if (td0.colSpan && td0.colSpan > 1) continue; // pomiń wiersze kalkulacyjne
    const nameText = (td0.textContent || "").trim().toLowerCase();
    if (nameText === wanted) { target = r; break; }
  }
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("pulse-highlight");
  setTimeout(() => target.classList.remove("pulse-highlight"), 2000);
} 



function showPushBanner() {
  if (typeof isLoggedIn === "function" && isLoggedIn()) return;
  const el = document.getElementById("updateBanner");
  if (!el) return;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
} 


async function sendPushNotificationToAllUsers(
  title, body, projectName = "", field = "", clickAction = window.location.origin
) {
  try {
    const f = firebase.app().functions("us-central1");
    const call = f.httpsCallable("sendPushNotification");
    const res = await call({ title, body, projectName, field, clickAction });
    console.log("📤 Push OK:", res.data);
    return res.data; // { success, ... }
  } catch (error) {
    console.warn("❌ Push callable failed:", error?.code, error?.message || error);
    // NIE wyrzucamy wyjątku dalej – push nie psuje logiki zapisu
    return { success: false, error: String(error?.message || error) };
  }
}
/* =========================================================
   🔔 DZWONEK + DYMKI + AUDIO + PRE-LOGIN POLLING (SCALONE)
   ========================================================= */

/* ——— 0) CSS do dzwonka i dymka (wstrzyknięty 1x) ——— */
(function injectBellCSSOnce(){
  if (document.getElementById('bellForceCSS')) return;
  const s = document.createElement('style');
  s.id = 'bellForceCSS';
  s.textContent = `
    #ringIcon{
      cursor: pointer !important;
      pointer-events: auto !important;
      z-index: 2147483647 !important;
    }
    #bellHint{
      position: absolute;
      z-index: 2147483646;
      max-width: 260px;
      background: #222;
      color: #fff;
      padding: 10px 12px;
      border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0,0,0,.25);
      font-size: 14px;
      line-height: 1.3;
      display: none;
    }
  `;
  document.head.appendChild(s);
})();

/* ——— 1) Klucze i preferencje ——— */
const LAST_SEEN_UPDATE_KEY = "lastSeenUpdateTs";     // gate anty-pętli
const LAST_PLAYED_TS_KEY = "lastPlayedPushTs";
const BELL_HINT_PREF       = "bellHintEnabled";      // 1 = pokazuj dymki

function isBellHintEnabled(){ return localStorage.getItem(BELL_HINT_PREF) !== "0"; }
function setBellHintEnabled(on){ localStorage.setItem(BELL_HINT_PREF, on ? "1" : "0"); }

/* ——— 2) AUDIO — bezpieczne odtwarzanie + priming ——— */
const AUDIO_ID = "notificationSound"; // <audio id="notificationSound" src="ding.mp3" preload="auto">
window.audioPrimed = !!window.audioPrimed;

function playNotificationSound() {
  const a = document.getElementById(AUDIO_ID);
  if (!a) return;
  try { a.currentTime = 0; } catch {}
  const p = a.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {
      try { sessionStorage.setItem("pendingSound", "1"); } catch {}
    });
  }
}
function primeAudioOnce() {
  if (window.audioPrimed) return;
  const a = document.getElementById(AUDIO_ID);
  if (!a) return;
  a.play().then(() => {
    a.pause(); a.currentTime = 0;
    window.audioPrimed = true;
    if (sessionStorage.getItem("pendingSound") === "1") {
      sessionStorage.removeItem("pendingSound");
      playNotificationSound();
    }
  }).catch(()=>{});
}
document.addEventListener("pointerdown", primeAudioOnce, { once:true, passive:true });
document.addEventListener("keydown",      primeAudioOnce, { once:true, passive:true });

/* ——— 3) Dymek przy dzwonku (stały, z krzyżykiem) ——— */
function _positionBellHint(el, hintEl){
  const ring = el || document.getElementById("ringIcon");
  const hint = hintEl || document.getElementById("bellHint");
  if (!ring || !hint) return;
  const r = ring.getBoundingClientRect();
  const top  = Math.max(8, r.top  + window.scrollY - hint.offsetHeight - 10);
  const left = Math.min(window.scrollX + window.innerWidth - hint.offsetWidth - 8,
                        r.left + window.scrollX + r.width + 8);
  hint.style.top  = `${top}px`;
  hint.style.left = `${left}px`;
}
/* TRWAŁY dymek – pokazuj OD RAZU obok dzwonka (bez hovera, bez auto-hide) */
function showBellHintPersistent(text) {
  if (!isBellHintEnabled()) return;
  const ring = document.getElementById("ringIcon");
  if (!ring || !text) return;

  // Usuń stare instancje (jeśli jakieś zostały)
  const old = document.getElementById("bellHint");
  if (old) old.remove();

  // Utwórz dymek
  const hint = document.createElement("div");
  hint.id = "bellHint";
  hint.className = "bell-hint";

  // Style inline — na twardo, żeby nie blokowały nas globalne CSS
  Object.assign(hint.style, {
    position: "fixed",               // ważne: nie będzie przycinany przez overflow
    zIndex: "2147483646",
    maxWidth: "260px",
    background: "#222",
    color: "#fff",
    padding: "10px 12px",
    borderRadius: "8px",
    boxShadow: "0 6px 20px rgba(0,0,0,.25)",
    fontSize: "14px",
    lineHeight: "1.3",
    pointerEvents: "auto",
    opacity: "1",                    // pokaż natychmiast
    display: "block",                // pokaż natychmiast (bez klas .show itp.)
  });

  // Treść
  const body = document.createElement("div");
  body.className = "bell-hint-body";
  body.textContent = text;

  // Pasek akcji: przełącznik + X
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "8px",
  });

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = isBellHintEnabled() ? "Nie pokazuj dymków" : "Pokazuj dymki";
  Object.assign(toggle.style, {
    fontSize:"12px", padding:"4px 8px", borderRadius:"6px",
    border:"1px solid #444", background:"#333", color:"#fff", cursor:"pointer"
  });
  toggle.onclick = () => {
    const next = !isBellHintEnabled();
    setBellHintEnabled(next);
    toggle.textContent = next ? "Nie pokazuj dymków" : "Pokazuj dymki";
    if (!next) closeBellHint();
  };

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Zamknij");
  Object.assign(close.style, {
    marginLeft:"auto", fontSize:"16px", width:"26px", height:"26px",
    lineHeight:"24px", textAlign:"center", borderRadius:"50%",
    border:"1px solid #444", background:"#333", color:"#fff", cursor:"pointer"
  });
  close.onclick = closeBellHint;

  bar.appendChild(toggle);
  bar.appendChild(close);

  hint.appendChild(body);
  hint.appendChild(bar);
  document.body.appendChild(hint);

  // Pozycjonowanie (obok dzwonka, u góry po prawej)
  const place = () => {
    const r = ring.getBoundingClientRect();
    const top  = Math.max(8, r.top  - hint.offsetHeight - 10);
    // przy prawej krawędzi dzwonka, ale w granicach okna
    const left = Math.min(
      window.innerWidth - hint.offsetWidth - 8,
      r.left + r.width + 8
    );
    hint.style.top  = `${Math.max(8, top)}px`;
    hint.style.left = `${Math.max(8, left)}px`;
  };
  // najpierw pokaż (już jest display:block), potem policz pozycję
  place();

  // Jednorazowe repozycjonowanie przy resize/scroll
  const _repos = () => place();
  window.addEventListener("resize", _repos, { passive: true, once: true });
  window.addEventListener("scroll",  _repos, { passive: true, once: true });
} 
function closeBellHint(){ document.getElementById("bellHint")?.style && (document.getElementById("bellHint").style.display = "none"); }
function showBellHint(text){ showBellHintPersistent(text); } // zgodność
function setBellHoverText(text){
  const ring = document.getElementById("ringIcon");
  if (!ring) return;
  ring.title = text;
  ring.setAttribute("aria-label", text);
}

/* ——— 4) Dzwonek: centralne show/hide ——— */
function showBellUI() {
  const ringIcon = document.getElementById("ringIcon");
  if (!ringIcon) return;
  ringIcon.classList.remove("hidden");
  ringIcon.style.pointerEvents = "auto";
  ringIcon.style.cursor = "pointer";
}
function ensureBellClickable() {
  const ring = document.getElementById("ringIcon");
  if (!ring) return;
  ring.style.pointerEvents = "auto";
  ring.style.cursor = "pointer";
  ring.setAttribute("role", "button");
  ring.setAttribute("tabindex", "0");
  ring.title = ring.title || "Kliknij, aby przejść do logowania";
  const z = Number(getComputedStyle(ring).zIndex || 0);
  if (z < 99999) ring.style.zIndex = 99999;
}
function hideBell() {
  document.getElementById("ringIcon")?.classList.add("hidden");
  try { closeBellHint?.(); } catch {}
}
/** JEDYNA funkcja do pokazywania dzwonka (używaj jej wszędzie):
*  - zapisuje TS (anty-pętla),
*  - pokazuje dzwonek (i upewnia klikalność),
*  - pokazuje dymek (trwały) + ustawia hover,
*  - gra dźwięk (z primingiem).
*/
// nowa stała – anty-duplikacja dźwięku dla tego samego push-a


/* ZAMIANA całej funkcji showBell(...) na tę wersję */
function showBell(ts, message) {
  // 1) zapamiętaj TS jako „widziany” — unikamy zapętlania pokazywania dzwonka
  try { localStorage.setItem(LAST_SEEN_UPDATE_KEY, String(ts)); } catch {}

  // 2) pokaż dzwonek i upewnij się, że jest natychmiast klikalny (bez martwego stanu)
  const ringIcon = document.getElementById("ringIcon");
  if (ringIcon) {
    ringIcon.classList.remove("hidden");
    ringIcon.style.pointerEvents = "auto";
    ringIcon.style.cursor = "pointer";
    ringIcon.setAttribute("role", "button");
    ringIcon.setAttribute("tabindex", "0");
    if ((+getComputedStyle(ringIcon).zIndex || 0) < 99999) {
      ringIcon.style.zIndex = 99999;
    }
  }

  // 3) dymek pokazujemy OD RAZU (bez hovera), wersja trwała
  if (localStorage.getItem("bellHintEnabled") === null) {
    localStorage.setItem("bellHintEnabled", "1"); // domyślnie włączone
  }
  if (typeof showBellHintPersistent === "function") {
    showBellHintPersistent(message);
  } else if (typeof showBellHint === "function") {
    showBellHint(message);
  }
  if (typeof setBellHoverText === "function") setBellHoverText(message);

  // 4) dźwięk: gra PRZY KAŻDYM NOWYM pushu (ten sam ts nie gra ponownie)
  try {
    const lastPlayed = Number(localStorage.getItem(LAST_PLAYED_TS_KEY) || 0);
    if (ts > lastPlayed) {
      try { playNotificationSound(); } catch {}
      localStorage.setItem(LAST_PLAYED_TS_KEY, String(ts));
    }
  } catch {}

  // jeżeli audio nie jest „zprimowane”, zapamiętaj, by zagrać po pierwszym geście
  if (!window.audioPrimed) {
    try { sessionStorage.setItem("pendingSound", "1"); } catch {}
  }
} 


/* ——— 5) Klik w dzwonek — przypnij RAZ ——— */
document.addEventListener("DOMContentLoaded", () => {
  if (window._ringBound) return;
  window._ringBound = true;

  const ring = document.getElementById("ringIcon");
  if (!ring) return;

  ring.addEventListener("click", () => {
    try { localStorage.setItem(LAST_SEEN_UPDATE_KEY, String(Date.now())); } catch {}
    hideBell();
    const loginSection  = document.getElementById("loginSection");
    const usernameInput = document.getElementById("username");
    if (loginSection && usernameInput) {
      loginSection.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => usernameInput.focus(), 300);
    }
  });
});

/* ——— 6) Pre-login: wykrywaj świeże zmiany i pokazuj dzwonek ——— */
async function checkForRecentUpdates() {
  // dzwonek / żółty pasek TYLKO PRZED logowaniem
  const mainVisible = document.getElementById("mainContent")?.style.display === "block";
  const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : mainVisible;
  if (loggedIn) { hideBell(); return; }

  try {
    const snap = await db.collection("updatesLog").orderBy("timestamp","desc").limit(1).get();
    if (snap.empty) { hideBell(); return; }

    const latest = snap.docs[0].data();
    const ts = latest.timestamp?.toDate?.()?.getTime?.() || 0;
    const fresh    = (Date.now() - ts) < (10 * 60 * 1000); // 10 min
    const lastSeen = Number(localStorage.getItem(LAST_SEEN_UPDATE_KEY) || 0);

    if (fresh && ts > lastSeen) {
      const iconMap = { werknemers:"👷", materialen:"🧱", media:"📷", omschrijving:"📝", naam:"🆕", locatie:"🌍", uren:"⏱️", extra:"📌",weekbrief:"📄" };
      const icon = iconMap[latest.field] || "🔔";
      const msg  = `${icon} ${latest.projectName || "Project"}: ${latest.action || "Update"}${latest.field ? " – " + latest.field : ""}`;
      showBell(ts, msg);
      showPushBanner?.();
    } else {
      hideBell();
    }
  } catch (e) {
    console.warn("checkForRecentUpdates:", e);
  }
}

/* ——— 7) Pre-login polling + priming audio (raz) ——— */
document.addEventListener("DOMContentLoaded", () => {
  try { primeAudioOnce?.(); } catch {}
  if (window._preloginPollBound) return;
  window._preloginPollBound = true;

  const mainVisible = document.getElementById("mainContent")?.style.display === "block";
  if (!mainVisible) {
    checkForRecentUpdates();
    window._preloginPollId = setInterval(() => {
      const loggedInNow = document.getElementById("mainContent")?.style.display === "block";
      if (!loggedInNow) checkForRecentUpdates();
    }, 60_000);
  }
});

/* ——— 8) Mały żółty “toaster” (pre-login only) ——— */
function showPushBanner() {
  if (typeof isLoggedIn === "function" && isLoggedIn()) return;
  const el = document.getElementById("updateBanner");
  if (!el) return;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
}

/* ——— 9) Po zalogowaniu – sprzątnij (wywołaj w handleLogin po updateUI) ——— */
function afterSuccessfulLoginHousekeeping() {
  try { localStorage.setItem(LAST_SEEN_UPDATE_KEY, String(Date.now())); } catch {}
  document.getElementById("ringIcon")?.classList.add("hidden");
  document.getElementById("updateBanner")?.classList.add("hidden");
  try { closeBellHint?.(); } catch {}
}
/* ===========================
   📣 Weekbrief → log + push
   =========================== */

/** prosty throttle, żeby uniknąć dubletów przy szybkim kliku */
let _lastWeekbriefPushTs = 0;

/**
* Wołaj PO UDANYM zapisie Weekbrief (do Storage/Firestore).
* @param {{week:number|string, year?:number|string}} param0
*/
async function notifyWeekbriefSaved({ week, year }) {
  try {
    const now = Date.now();
    if (now - _lastWeekbriefPushTs < 4000) return; // 4s przerwy
    _lastWeekbriefPushTs = now;

    const wk   = String(week ?? "").padStart(2, "0");
    const naam = `Weekbrief wk ${wk}${year ? " / " + year : ""}`;
    const user = (typeof currentUser !== "undefined" && currentUser) ? currentUser : "onbekend";

    // 1) dopisz do updatesLog – żeby pre-login dzwonek/baner złapał zmianę
    await db.collection("updatesLog").add({
      timestamp: new Date(),
      projectName: naam,                 // etykieta
      field: "weekbrief",                // 🔑 nowy typ (ikona 📄)
      action: "Nieuw weekbrief opgeslagen",
      user
    });

    // 2) wyślij push do wszystkich
    await sendPushNotificationToAllUsers(
      "📄 Weekbrief",
      `${naam} door ${user}`,
      naam,
      "weekbrief"
    );
  } catch (e) {
    console.warn("notifyWeekbriefSaved:", e);
  }
} 
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event?.data?.type === "PLAY_DING") {
      try { playNotificationSound(); } catch {}
    }
  });
} 


// 🔁 Po starcie strony poproś SW o aktualny stan licznika
(async () => {
  try {
    const reg = await navigator.serviceWorker?.ready;
    reg?.active?.postMessage({ type: "REQUEST_BADGE" });
  } catch {}
})();


