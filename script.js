// == Firebase CONFIG ==
const firebaseConfig = {
  apiKey: "AIzaSyB9cbmspJZLQ76Arm_-3Zmb7-hmoRTkZz8"
  authDomain: "marijs-afwerking.firebaseapp.com",
  projectId: "marijs-afwerking",
  storageBucket: "marijs-afwerking.appspot.com",
  messagingSenderId: "626287320904",
  appId: "1:626287320904:web:6258025a253d5c9d849d7d",
  measurementId: "G-ND4T9807HG"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// == USERS ==
const managers = ["Sjaak", "Jos", "Jacco", "Nanda"];
const allUsers = [...managers, "Pieter", "Thijs", "Hilko", "Roel", "Benji"];
let currentUser = null;
let projects = [];
let currentFilter = "";
let currentLightboxIndex = 0;
let currentLightboxItems = [];
 
// == DOMContentLoaded ==
document.addEventListener("DOMContentLoaded", () => {
  const observeInputs = () => {
    const observer = new MutationObserver(() => saveWeekbriefLocally());
    const config = { childList: true, subtree: true };
    const form = document.getElementById("weekbriefForm");
    if (!form) return;

    observer.observe(form, config);

    const inputs = form.querySelectorAll("input, textarea");
    inputs.forEach(inp => {
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
      const storedWeek = localStorage.getItem("currentWeek");
document.getElementById("wbWeeknummer").value = storedWeek || getCurrentWeekNumber(); 
      renderWeekbriefTable();
      loadWeekbriefLocally(); // Ładuje dane po renderowaniu
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
  window.addEventListener("load", () => {
  const storedWeek = localStorage.getItem("currentWeek");
  if (storedWeek && parseInt(storedWeek) >= 1 && parseInt(storedWeek) <= 53) {
    document.getElementById("wbWeeknummer").value = storedWeek;
  } else {
    const currentWeek = getCurrentWeekNumber();
    document.getElementById("wbWeeknummer").value = currentWeek;
    localStorage.setItem("currentWeek", currentWeek);
  }
}); 
// 👇 Zamknięcie lightboxa tekstowego
  const closeBtn = document.querySelector(".close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      document.getElementById("lightbox").style.display = "none";
    });
  }

}); 
function getCurrentWeekNumber() {
  const now = new Date();
  const oneJan = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = ((now - oneJan + 86400000) / 86400000);
  return Math.ceil((dayOfYear + oneJan.getDay()) / 7);
}

function renderWeekbriefTable() {
  const dagen = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
  const container = document.getElementById("weekbriefTable");
  container.innerHTML = "";

  dagen.forEach(dag => {
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
    saveWeekbriefLocally(); // zapisz dane po zmianie
  };

  const projectInput = document.createElement("input");
  projectInput.type = "text";
  projectInput.placeholder = "Projectnaam";
  projectInput.className = "projectInput";
  projectInput.oninput = saveWeekbriefLocally; // dodaj zapis także tutaj

  row.appendChild(urenInput);
  row.appendChild(projectInput);

  container.appendChild(row);

  // 🆕 zapisz natychmiast po dodaniu wiersza
  saveWeekbriefLocally();
  updateWeekTotaal();
} 

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
      if (!entriesDiv || !data.dagen[dag]) return;

      // WAŻNE: wyczyść wszystkie istniejące wiersze przed wczytaniem
      entriesDiv.innerHTML = "";

      data.dagen[dag].forEach((item) => {
        addEntryRow(dag, entriesDiv);
        const lastEntry = entriesDiv.lastChild;
        lastEntry.querySelector(".urenInput").value = item.uren;
        lastEntry.querySelector(".projectInput").value = item.project;
      });
    });

    updateWeekTotaal();
  } catch (err) {
    console.error("Błąd podczas ładowania zapisanego Weekbrief:", err);
  }
} 

function exportWeekbriefToPDF() {
  const naam = document.getElementById("wbNaam").value.trim();
  const weeknummer = document.getElementById("wbWeeknummer").value;
  const handtekening = document.getElementById("wbHandtekening").value;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const logo = new Image();
  logo.src = "logo-192.png";

  logo.onload = () => {
    doc.addImage(logo, "PNG", 10, 10, 20, 20);
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text("Weekbrief", 105, 20, null, null, "center");

    doc.setFontSize(12);
    doc.text(`Naam: ${naam}`, 140, 20);
    doc.text(`Weeknummer: ${weeknummer}`, 140, 28);

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

    doc.save(`Weekbrief_${naam || "gebruiker"}_week${weeknummer}.pdf`);

    // 🧹 Czyść dane użytkownika dopiero po wysłaniu PDF
    localStorage.removeItem(`weekbrief_${currentUser}`);
    document.getElementById("weekbriefForm").reset();
    document.getElementById("wbWeeknummer").value = getCurrentWeekNumber();

    // Usuń dynamiczne pola (dzień, zadania)
    dagenLijst.forEach(dag => {
      const container = document.getElementById(`${dag}-entries`);
      if (container) container.innerHTML = "";
    });

    updateWeekTotaal();
  };
} 


function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  if (
    (managers.includes(username) && password === "nl25") ||
    (!managers.includes(username) && allUsers.includes(username) && password === "ma25")
  ) {
    currentUser = username;
    sessionStorage.setItem("loggedInUser", currentUser);
    updateUI();
  } else {
    alert("Ongeldige inloggegevens");
  }
}

function handleLogout() {
  currentUser = null;
  sessionStorage.removeItem("loggedInUser");
  updateUI();
}

function updateUI() {
  const loggedIn = !!currentUser;
  const isManager = managers.includes(currentUser);
  document.getElementById("loginSection").style.display = loggedIn ? "none" : "block";
  document.getElementById("mainContent").style.display = loggedIn ? "block" : "none";
  document.getElementById("logoutSection").style.display = loggedIn ? "block" : "none";
  document.getElementById("welcomeUser").textContent = loggedIn ? `Welkome ${currentUser} 😊` : "";
  document.getElementById("projectForm").style.display = isManager ? "block" : "none";
  renderCheckboxes();
  loadProjects();
}

function renderCheckboxes() {
  const container = document.getElementById("werknemerCheckboxes");
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

  const mediaFiles = Array.from(document.getElementById("media").files);
  const mediaURLs = [];

  const storage = firebase.app().storage("marijs-afwerking.firebasestorage.app");
  const storageRef = storage.ref();

  for (const file of mediaFiles) {
    const filePath = `media/${Date.now()}_${file.name}`;
    const fileRef = storageRef.child(filePath);
    await fileRef.put(file);
    const downloadURL = await fileRef.getDownloadURL();

    const type = file.type.startsWith("image")
      ? "img"
      : file.type.startsWith("video")
      ? "video"
      : "file";

    mediaURLs.push({
      name: file.name,
      type,
      url: downloadURL,
      refPath: filePath
    });
  }

  const project = {
    name,
    omschrijving,
    locatie,
    uren,
    materialen,
    extra,
    werknemers,
    tijd,
    media: mediaURLs,
    kosten: [],
    totalen: {},
    werkzaamhedenData: {}
  };

  await db.collection("projects").add(project);
  await loadProjects();
  e.target.reset();
  renderCheckboxes();
} 

async function loadProjects() {
  const snapshot = await db.collection("projects").get();
  projects = snapshot.docs.map(doc => ({
    ...doc.data(),
    docId: doc.id
  }));
  projects.sort((a, b) => a.name.localeCompare(b.name));
  renderProjects(currentFilter);
} 
function renderProjects(filter = currentFilter) { currentFilter = filter; const filteredProjects = filter ? projects.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase())) : projects;

const container = document.getElementById("projectenTabelBody"); container.innerHTML = "";

filteredProjects.forEach((project) => { const row = document.createElement("tr");

// Nazwa projektu
const nameCell = document.createElement("td");
nameCell.textContent = project.name || "";
row.appendChild(nameCell); 
// Omschrijving z lightboxem
const omsCell = document.createElement("td");
const omsDiv = document.createElement("div");
omsDiv.className = "clickable-description";
omsDiv.textContent = (project.omschrijving || "").substring(0, 100) + (project.omschrijving?.length > 100 ? "..." : "");
omsDiv.onclick = () => openTextLightbox("Omschrijving", project.omschrijving || "", async (newText) => {
  project.omschrijving = newText;
  await db.collection("projects").doc(project.docId).update({ omschrijving: newText });
  renderProjects(currentFilter);
});
omsCell.appendChild(omsDiv);
omsCell.appendChild(document.createTextNode(" 📖"));
row.appendChild(omsCell);

const locCell = document.createElement("td");
locCell.contentEditable = true;
locCell.setAttribute("spellcheck", "false");
locCell.textContent = project.locatie || "";
locCell.addEventListener("input", async () => {
  project.locatie = locCell.textContent.trim();
  await db.collection("projects").doc(project.docId).update({ locatie: project.locatie });
});
row.appendChild(locCell); 


// Uren
const urenCell = document.createElement("td");
urenCell.contentEditable = true;
urenCell.setAttribute("spellcheck", "false");
urenCell.textContent = project.uren || "";
urenCell.addEventListener("input", async () => {
  project.uren = urenCell.textContent.trim();
  await db.collection("projects").doc(project.docId).update({ uren: project.uren });
});
row.appendChild(urenCell); 

// Materialen z lightboxem
const matCell = document.createElement("td");
const matDiv = document.createElement("div");
matDiv.className = "clickable-description";
matDiv.textContent = (project.materialen || "").substring(0, 100) + (project.materialen?.length > 100 ? "..." : "");
matDiv.onclick = () => openTextLightbox("Materialen", project.materialen || "", async (newText) => {
  project.materialen = newText;
  await db.collection("projects").doc(project.docId).update({ materialen: newText });
  renderProjects(currentFilter);
});
matCell.appendChild(matDiv);
matCell.appendChild(document.createTextNode(" 📖"));
row.appendChild(matCell);

// Extra werk z lightboxem
const extraCell = document.createElement("td");
const extraDiv = document.createElement("div");
extraDiv.className = "clickable-description";
extraDiv.textContent = (project.extra || "").substring(0, 100) + (project.extra?.length > 100 ? "..." : "");
extraDiv.onclick = () => openTextLightbox("Extra werk", project.extra || "", async (newText) => {
  project.extra = newText;
  await db.collection("projects").doc(project.docId).update({ extra: newText });
  renderProjects(currentFilter);
});
extraCell.appendChild(extraDiv);
extraCell.appendChild(document.createTextNode(" 📖"));
row.appendChild(extraCell); 
// Tijd
const tijdCell = document.createElement("td");
tijdCell.textContent = project.tijd || "";
row.appendChild(tijdCell);

// Werknemers (edytowalne)
const werkerCell = document.createElement("td");
werkerCell.contentEditable = true;
werkerCell.setAttribute("spellcheck", "false"); // ← TO DODAJ
werkerCell.textContent = (project.werknemers || []).join(", ");
werkerCell.addEventListener("input", async () => {
  project.werknemers = werkerCell.textContent.split(",").map(w => w.trim());
  await db.collection("projects").doc(project.docId).update({ werknemers: project.werknemers });
});
row.appendChild(werkerCell); 

// Media
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
    el.onclick = () => openLightbox((project.media || []).filter((x) => x.type === "img" || x.type === "video").map((x) => x.url), (project.media || []).filter((x) => x.type === "img" || x.type === "video").indexOf(m));
  } else if (m.type === "video") {
    el = document.createElement("video");
    el.src = m.url;
    el.controls = true;
    el.className = "lightbox-item";
    el.onclick = () => openLightbox((project.media || []).filter((x) => x.type === "img" || x.type === "video").map((x) => x.url), (project.media || []).filter((x) => x.type === "img" || x.type === "video").indexOf(m));
  } else {
    el = document.createElement("a");
    el.href = m.url;
    el.textContent = `📄 ${m.name}`;
    el.target = "_blank";
  }

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "X";
  removeBtn.className = "remove-media-btn";
  removeBtn.onclick = async () => {
    project.media.splice(index, 1);
    await db.collection("projects").doc(project.docId).update({ media: project.media });
    renderProjects(currentFilter);
  };

  wrapper.appendChild(el);
  wrapper.appendChild(removeBtn);
  mediaPreview.appendChild(wrapper);
});

const lightboxItems = (project.media || []).filter((x) => x.type === "img" || x.type === "video");
if (lightboxItems.length > 2) {
  const moreBtn = document.createElement("button");
  moreBtn.textContent = `+${lightboxItems.length - 2}`;
  moreBtn.className = "more-media-btn";
  moreBtn.onclick = () => openLightbox(lightboxItems.map((x) => x.url), 2);
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
  project.media = [...(project.media || []), ...uploads];
  await db.collection("projects").doc(project.docId).update({ media: project.media });
  renderProjects(currentFilter);
});

mediaCell.appendChild(mediaPreview);
mediaCell.appendChild(addInput);
row.appendChild(mediaCell);

// Usuń projekt
const deleteCell = document.createElement("td");
if (managers.includes(currentUser)) {
  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Verwijder";
  deleteBtn.className = "remove-media-btn";
  deleteBtn.onclick = () => {
    if (confirm("Weet je zeker dat je dit project wilt verwijderen?")) {
      db.collection("projects").doc(project.docId).delete().then(() => {
        loadProjects();
      });
    }
  };
  deleteCell.appendChild(deleteBtn);
}
row.appendChild(deleteCell);
container.appendChild(row);

// Kalkulacja kosztów
if (managers.includes(currentUser)) {
  const calcRow = document.createElement("tr");
  const calcCell = document.createElement("td");
  calcCell.colSpan = 10;
  const calcBtn = document.createElement("button");
  calcBtn.textContent = "📊 Bekijk calculatie";
  calcBtn.className = "kosten-btn";
  calcBtn.onclick = () => openCostSection(project);
  calcCell.appendChild(calcBtn);
  calcRow.appendChild(calcCell);
  container.appendChild(calcRow);
}

}); }

function openCostSection(project) {
  const container = document.createElement("div");
  container.className = "costs-section";

  const title = document.createElement("h3");
  title.textContent = `Kosten voor project: ${project.name}`;
  container.appendChild(title);

  // Materiały
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

      ["materiaal", "aantal", "prijs", "btw"].forEach(key => {
        const cell = document.createElement("td");
        const input = document.createElement("input");
        input.type = key === "prijs" || key === "btw" ? "number" : "text";
        input.step = "0.01";
        input.value = item[key] || "";
        input.placeholder = key;
        input.addEventListener("input", async () => {
          item[key] = input.value;
          await db.collection("projects").doc(project.docId).update({ kosten: project.kosten });
        });
        cell.appendChild(input);
        row.appendChild(cell);
      });

      const delCell = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.textContent = "X";
      delBtn.onclick = async () => {
        project.kosten.splice(index, 1);
        await db.collection("projects").doc(project.docId).update({ kosten: project.kosten });
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
    await db.collection("projects").doc(project.docId).update({ kosten: project.kosten });
    renderRows();
  };
  container.appendChild(addBtn);

  container.appendChild(document.createElement("hr"));

  // 🧱 Wykonane prace
  const workTypes = ["Schilderen", "Behangen", "Stuckwerk"];
  const workDiv = document.createElement("div");
  workDiv.innerHTML = "<h4>Uitgevoerde werkzaamheden:</h4>";
  project.werkzaamhedenData = project.werkzaamhedenData || {};

  workTypes.forEach(type => {
    const row = document.createElement("div");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = project.werkzaamhedenData[type]?.enabled || false;
    row.appendChild(cb);

    const label = document.createElement("label");
    label.textContent = ` ${type} `;
    row.appendChild(label);

    const m2Input = document.createElement("input");
    m2Input.type = "number";
    m2Input.placeholder = "m²";
    m2Input.style.width = "50px";
    m2Input.value = project.werkzaamhedenData[type]?.m2 || "";

    const m2Price = document.createElement("input");
    m2Price.type = "number";
    m2Price.placeholder = "€/m²";
    m2Price.style.width = "60px";
    m2Price.value = project.werkzaamhedenData[type]?.m2Prijs || "";

    const hourInput = document.createElement("input");
    hourInput.type = "number";
    hourInput.placeholder = "uren";
    hourInput.style.width = "50px";
    hourInput.value = project.werkzaamhedenData[type]?.uren || "";

    const hourPrice = document.createElement("input");
    hourPrice.type = "number";
    hourPrice.placeholder = "€/u";
    hourPrice.style.width = "60px";
    hourPrice.value = project.werkzaamhedenData[type]?.uurPrijs || "";

    [m2Input, m2Price, hourInput, hourPrice].forEach(el => row.appendChild(el));

    const updateData = async () => {
      project.werkzaamhedenData[type] = {
        enabled: cb.checked,
        m2: parseFloat(m2Input.value) || 0,
        m2Prijs: parseFloat(m2Price.value) || 0,
        uren: parseFloat(hourInput.value) || 0,
        uurPrijs: parseFloat(hourPrice.value) || 0
      };
      await db.collection("projects").doc(project.docId).update({ werkzaamhedenData: project.werkzaamhedenData });
    };

    [cb, m2Input, m2Price, hourInput, hourPrice].forEach(el => el.addEventListener("input", updateData));

    workDiv.appendChild(row);
  });

  container.appendChild(workDiv);
  container.appendChild(document.createElement("hr"));

  // 💰 VAT toggle
  const vatDiv = document.createElement("div");
  vatDiv.innerHTML = `
    <label><input type="radio" name="vatMode" value="excl" checked> Prijs excl. BTW</label>
    <label><input type="radio" name="vatMode" value="incl"> Prijs incl. BTW</label>
  `;
  container.appendChild(vatDiv);

  const totalDiv = document.createElement("div");
  totalDiv.style.marginTop = "10px";
  container.appendChild(totalDiv);

  const popup = window.open("", "_blank", "width=900,height=700,scrollbars=yes");
  popup.document.write(`<html><head><title>Kosten</title><style>body{font-family:sans-serif;padding:20px;}</style></head><body></body></html>`);
  popup.document.body.appendChild(container);

  const calcBtn = document.createElement("button");
  calcBtn.textContent = "Bereken totaal";
  calcBtn.onclick = async () => {
    let materialenSom = 0;
    project.kosten.forEach(item => {
      const aantal = parseFloat(item.aantal) || 0;
      const prijs = parseFloat(item.prijs) || 0;
      const btw = parseFloat(item.btw) || 0;
      let netto = aantal * prijs;
      let bruto = netto + netto * (btw / 100);
      materialenSom += bruto;
    });

    let werkSom = 0;
    for (const [type, data] of Object.entries(project.werkzaamhedenData || {})) {
      if (!data.enabled) continue;
      const werkM2 = (data.m2 || 0) * (data.m2Prijs || 0);
      const werkUur = (data.uren || 0) * (data.uurPrijs || 0);
      werkSom += werkM2 + werkUur;
    }

    const totaal = materialenSom + werkSom;
    const vatMode = popup.document.querySelector('input[name="vatMode"]:checked')?.value || "excl";

    project.totalen = {
      materialen: materialenSom,
      werkzaamheden: werkSom,
      totaal,
      vatMode
    };

    await db.collection("projects").doc(project.docId).update({ totalen: project.totalen });

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
function exportProjectCostToPDF(project) { const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "A4" }); const logo = new Image(); logo.src = "logo-192.png";

logo.onload = () => { const now = new Date(); const dateStr = now.toLocaleDateString("nl-NL");

doc.addImage(logo, "PNG", 10, 10, 20, 20);
doc.setFontSize(16);
doc.text(`Kostenoverzicht – ${project.name}`, 35, 20);
doc.setFontSize(10);
doc.text(`Datum: ${dateStr}`, 180, 20, { align: "right" });

let y = 35;

// Locatie
if (project.locatie) {
  doc.setFontSize(11);
  doc.text(`Locatie: ${project.locatie}`, 10, y);
  y += 8;
}

// Materialen
doc.setFontSize(13);
doc.text("Materialen:", 10, y);
y += 6;
doc.setFontSize(11);
if (project.kosten?.length) {
  project.kosten.forEach(item => {
    const naam = item.materiaal || "-";
    const aantal = parseFloat(item.aantal) || 0;
    doc.text(`- ${naam} (${aantal} stuks)`, 12, y);
    y += 5;
  });
} else {
  doc.text("Geen materialen toegevoegd.", 12, y);
  y += 5;
}

doc.text(`Subtotaal materialen: €${(project.totalen?.materialen || 0).toFixed(2)}`, 12, y);
y += 10;

// Werkzaamheden
doc.setFontSize(13);
doc.text("Uitgevoerde werkzaamheden:", 10, y);
y += 6;
doc.setFontSize(11);
const data = project.werkzaamhedenData || {};
Object.entries(data).forEach(([type, values]) => {
  if (!values.enabled) return;
  const m2line = values.m2 > 0 ? `${type} – ${values.m2} m² × €${values.m2Prijs} = €${(values.m2 * values.m2Prijs).toFixed(2)}` : null;
  const uurline = values.uren > 0 ? `${type} – ${values.uren} uur × €${values.uurPrijs} = €${(values.uren * values.uurPrijs).toFixed(2)}` : null;
  if (m2line) { doc.text(`- ${m2line}`, 12, y); y += 5; }
  if (uurline) { doc.text(`- ${uurline}`, 12, y); y += 5; }
});

y += 6;
doc.setLineWidth(0.5);
doc.line(10, y, 200, y);
y += 8;

const totaal = project.totalen?.totaal || 0;
const btwText = project.totalen?.vatMode === "incl" ? "incl. btw" : "excl. btw";
doc.setFontSize(14);
doc.text("Totale kosten:", 10, y);
doc.text(`€${totaal.toFixed(2)} (${btwText})`, 180, y, { align: "right" });

y += 20;
doc.setFontSize(10);
doc.setTextColor(100);
doc.text("Voor vragen, contacteer:", 10, y);
y += 5;
doc.text("info@marijsafwerking.nl", 10, y);

doc.save(`kosten_${project.name}.pdf`);
}; }
let lightboxMedia = [];
let lightboxIndex = 0;

function openLightbox(urls, index) {
  const lightbox = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  const video = document.getElementById("lightboxVideo");
  const text = document.getElementById("lightboxText");

  lightboxMedia = urls;
  lightboxIndex = index;

  const currentUrl = lightboxMedia[lightboxIndex];
  const isVideo = currentUrl.endsWith(".mp4") || currentUrl.endsWith(".webm");

  if (isVideo) {
    video.src = currentUrl;
    video.style.display = "block";
    img.style.display = "none";
    if (text) text.style.display = "none";
  } else {
    img.src = currentUrl;
    img.style.display = "block";
    video.style.display = "none";
    if (text) text.style.display = "none";
  }

  lightbox.classList.remove("hidden");
  lightbox.style.display = "flex";
}

function navigateLightbox(direction) {
  if (!lightboxMedia.length) return;

  lightboxIndex += direction;
  if (lightboxIndex < 0) lightboxIndex = lightboxMedia.length - 1;
  if (lightboxIndex >= lightboxMedia.length) lightboxIndex = 0;

  const currentUrl = lightboxMedia[lightboxIndex];
  const isVideo = currentUrl.endsWith(".mp4") || currentUrl.endsWith(".webm");

  const img = document.getElementById("lightboxImg");
  const video = document.getElementById("lightboxVideo");

  if (isVideo) {
    video.src = currentUrl;
    video.style.display = "block";
    img.style.display = "none";
  } else {
    img.src = currentUrl;
    img.style.display = "block";
    video.style.display = "none";
  }
}

function closeLightbox() {
  const lightbox = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  const video = document.getElementById("lightboxVideo");
  const text = document.getElementById("lightboxText");
  const textContent = document.getElementById("lightboxTextContent");
  const leftArrow = document.querySelector(".left-arrow");
  const rightArrow = document.querySelector(".right-arrow");

  // Ukryj lightbox
  lightbox.classList.add("hidden");
  lightbox.style.display = "none";

  // Ukryj i wyczyść media
  if (img) {
    img.style.display = "none";
    img.src = "";
  }
  if (video) {
    video.style.display = "none";
    video.src = "";
  }

  // Ukryj i wyczyść tekst
  if (text) {
    text.style.display = "none";
  }
  if (textContent) {
    textContent.innerHTML = "";
  }

  // Przywróć strzałki
  if (leftArrow) leftArrow.style.display = "block";
  if (rightArrow) rightArrow.style.display = "block";
} 


// 🔁 Update-checker
function showUpdateNotice() {
  const notification = document.getElementById("updateNotification");
  if (notification) {
    notification.style.display = "block";
    notification.addEventListener("click", () => window.location.reload());
  }
}

// 🕒 Aktualna data/godzina
function updateDateTime() {
  const dt = document.getElementById("datetime");
  if (!dt) return;
  const now = new Date();
  dt.textContent = now.toLocaleString();
}
setInterval(updateDateTime, 10000);
updateDateTime(); 
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => console.log("✅ Service Worker registered", reg))
      .catch((err) => console.error("❌ Service Worker error", err));
  });
} 
// 🔢 Funkcja: aktualny numer tygodnia
function getCurrentWeekNumber() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() + 3 - ((now.getDay() + 6) % 7));
  const week1 = new Date(now.getFullYear(), 0, 4);
  return 1 + Math.round(((now - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function clearWeeklyData() {
  localStorage.removeItem("weekbriefData");
  document.querySelectorAll(".weekbrief-dag input[type='number']").forEach(input => input.value = "");
  document.getElementById("weektotaal").value = "";
}


function setWeekManually(event) {
  event.preventDefault();
  const manualWeek = document.getElementById("manualWeek").value;
  if (manualWeek >= 1 && manualWeek <= 53) {
    localStorage.setItem("currentWeek", manualWeek);
    document.getElementById("wbWeeknummer").value = manualWeek;
    console.log("✅ Weeknummer handmatig ingesteld:", manualWeek);
    document.getElementById("manualWeek").value = ""; // ⬅️ TUTAJ
  } else {
    alert("Voer een weeknummer in tussen 1 en 53.");
  }
} 
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(registration => {
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log("[APP] Nowa wersja dostępna!");

          const banner = document.getElementById('updateNotification');
          banner?.classList.remove('hidden');

          const versionBanner = document.getElementById("appVersion");
          if (versionBanner) {
            versionBanner.classList.remove("hide");
            setTimeout(() => versionBanner.classList.add("hide"), 5000);
          }

          // Wysyłamy wiadomość do SW
          setTimeout(() => {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }, 5000);
        }
      });
    });
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      window.location.reload();
      refreshing = true;
    }
  });
} 

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
