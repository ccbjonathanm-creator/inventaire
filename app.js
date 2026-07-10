"use strict";

/* ============================================================
   Inventaire - appli locale (PC Windows 10/11, Chrome/Edge)
   100% local : rien n'est envoyé, sauf la voix (transcription
   navigateur) au moment ou l'on dicte.
   ============================================================ */

const STORE_KEY = "inventaire_session_v1";

const state = {
  fileName: "",
  headers: [],          // en-tetes d'origine
  rows: [],             // lignes d'origine (objets {header: valeur})
  map: {                // role -> nom de colonne (ou "")
    ref: "", des: "", theo: "", loc: ""
  },
  items: [],            // { i, ref, des, loc, theo, count(null|number) }
  filter: "all",
  search: "",
  activeIndex: -1       // index (dans items) de la piece ciblee par la voix
};

/* ---------- Détection auto des colonnes ---------- */
// Normalise un en-tete pour comparaison (minuscule, sans accent, sans ponctuation)
function norm(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// mots-cles par role, du plus fort au plus faible
const ROLE_HINTS = {
  ref:  ["reference", "ref", "code article", "code", "sku", "article", "part number", "no piece", "numero", "id", "designation code"],
  des:  ["designation", "designation article", "libelle", "libelle article", "description", "nom", "intitule", "produit", "article"],
  theo: ["quantite", "quantite theorique", "qte", "qte theorique", "qte stock", "stock", "stock theorique", "theorique", "quantite stock", "qte systeme", "quantite systeme", "en stock", "qtt"],
  loc:  ["emplacement", "localisation", "location", "lieu", "zone", "rayon", "allee", "casier", "bin", "magasin", "entrepot", "stockage"]
};

// Score de correspondance entre un en-tete et une liste d'indices
function scoreHeader(header, hints) {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  hints.forEach((hint, idx) => {
    const weight = hints.length - idx; // les premiers hints comptent plus
    if (h === hint) best = Math.max(best, 1000 + weight);
    else if (h.split(" ").includes(hint)) best = Math.max(best, 500 + weight);
    else if (h.includes(hint)) best = Math.max(best, 200 + weight);
    else if (hint.includes(h) && h.length >= 2) best = Math.max(best, 120 + weight);
  });
  return best;
}

// Devine si une colonne est plutot numerique (pour aider a reperer la quantite)
function numericScore(header, rows) {
  let num = 0, seen = 0;
  for (let k = 0; k < rows.length && seen < 25; k++) {
    const v = rows[k][header];
    if (v === "" || v == null) continue;
    seen++;
    if (typeof v === "number" || /^-?\d+([.,]\d+)?$/.test(String(v).trim())) num++;
  }
  return seen ? num / seen : 0;
}

function autoDetect() {
  const used = new Set();
  const roles = ["ref", "des", "theo", "loc"];
  // 1) attribution par mots-cles (meilleur score d'abord, tous roles confondus)
  const candidates = [];
  roles.forEach(role => {
    state.headers.forEach(h => {
      const s = scoreHeader(h, ROLE_HINTS[role]);
      if (s > 0) candidates.push({ role, header: h, score: s });
    });
  });
  candidates.sort((a, b) => b.score - a.score);
  const map = { ref: "", des: "", theo: "", loc: "" };
  candidates.forEach(c => {
    if (!map[c.role] && !used.has(c.header)) { map[c.role] = c.header; used.add(c.header); }
  });
  // 2) repli pour la quantite theorique : colonne la plus numerique restante
  if (!map.theo) {
    let bestH = "", bestN = 0;
    state.headers.forEach(h => {
      if (used.has(h)) return;
      const n = numericScore(h, state.rows);
      if (n > bestN) { bestN = n; bestH = h; }
    });
    if (bestN >= 0.6) { map.theo = bestH; used.add(bestH); }
  }
  // 3) repli pour la designation : 1re colonne texte non utilisee
  if (!map.des) {
    for (const h of state.headers) {
      if (used.has(h)) continue;
      if (numericScore(h, state.rows) < 0.5) { map.des = h; used.add(h); break; }
    }
  }
  // 4) repli pour la reference : 1re colonne non utilisee
  if (!map.ref) {
    for (const h of state.headers) {
      if (!used.has(h)) { map.ref = h; used.add(h); break; }
    }
  }
  state.map = map;
}

/* ---------- Lecture du fichier ---------- */
function readFile(file) {
  state.fileName = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // defval "" pour garder les cellules vides ; raw true garde les nombres
      const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
      if (!json.length) { toast("Le fichier semble vide.", "err"); return; }
      state.rows = json;
      state.headers = Object.keys(json[0]);
      autoDetect();
      renderMapping();
      showScreen("screenMapping");
    } catch (err) {
      console.error(err);
      toast("Impossible de lire ce fichier. Est-ce bien un Excel ou CSV ?", "err");
    }
  };
  reader.onerror = () => toast("Erreur de lecture du fichier.", "err");
  reader.readAsArrayBuffer(file);
}

/* ---------- Écran mapping ---------- */
const ROLE_LABELS = {
  ref: { name: "Référence", req: true, hint: "Le code unique de la pièce" },
  des: { name: "Désignation", req: false, hint: "Le nom / la description" },
  theo: { name: "Quantité théorique", req: false, hint: "Le stock attendu (pour l'écart)" },
  loc: { name: "Emplacement", req: false, hint: "Où se trouve la pièce" }
};

function renderMapping() {
  const grid = document.getElementById("mapGrid");
  grid.innerHTML = "";
  Object.keys(ROLE_LABELS).forEach(role => {
    const info = ROLE_LABELS[role];
    const field = document.createElement("div");
    field.className = "map-field" + (info.req ? " req" : "");
    const opts = ['<option value="">— aucune —</option>']
      .concat(state.headers.map(h =>
        `<option value="${escAttr(h)}" ${state.map[role] === h ? "selected" : ""}>${escHtml(h)}</option>`
      )).join("");
    field.innerHTML = `
      <label><span class="role">${info.name}</span><br><small>${info.hint}</small></label>
      <select data-role="${role}">${opts}</select>`;
    grid.appendChild(field);
  });
  grid.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", () => {
      state.map[sel.dataset.role] = sel.value;
    });
  });
  renderPreview();
}

function renderPreview() {
  const t = document.getElementById("previewTable");
  const cols = state.headers;
  const head = "<thead><tr>" + cols.map(c => `<th>${escHtml(c)}</th>`).join("") + "</tr></thead>";
  const body = "<tbody>" + state.rows.slice(0, 5).map(r =>
    "<tr>" + cols.map(c => `<td>${escHtml(r[c])}</td>`).join("") + "</tr>"
  ).join("") + "</tbody>";
  t.innerHTML = head + body;
}

/* ---------- Construire les items ---------- */
function buildItems() {
  const m = state.map;
  state.items = state.rows.map((r, i) => ({
    i,
    ref: m.ref ? String(r[m.ref] ?? "").trim() : "",
    des: m.des ? String(r[m.des] ?? "").trim() : "",
    loc: m.loc ? String(r[m.loc] ?? "").trim() : "",
    theo: m.theo ? toNum(r[m.theo]) : null,
    count: null
  }));
}

function toNum(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/* ---------- Écran inventaire ---------- */
function startInventory() {
  if (!state.map.ref) { toast("Choisis au moins la colonne Référence.", "err"); return; }
  buildItems();
  state.activeIndex = -1;
  document.getElementById("btnExport").classList.remove("hidden");
  document.getElementById("btnReset").classList.remove("hidden");
  document.getElementById("fileName").textContent = state.fileName;
  showScreen("screenInventory");
  renderInventory();
  saveSession();
}

function filteredItems() {
  const q = norm(state.search);
  return state.items.filter(it => {
    if (state.filter === "todo" && it.count != null) return false;
    if (state.filter === "done" && it.count == null) return false;
    if (state.filter === "ecart") {
      if (it.count == null || it.theo == null) return false;
      if (it.count === it.theo) return false;
    }
    if (q) {
      const hay = norm(it.ref + " " + it.des + " " + it.loc);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderInventory() {
  const body = document.getElementById("invBody");
  const list = filteredItems();
  body.innerHTML = "";
  const frag = document.createDocumentFragment();
  list.forEach(it => {
    const tr = document.createElement("tr");
    tr.dataset.idx = it.i;
    if (it.count != null) tr.classList.add("done");
    if (it.i === state.activeIndex) tr.classList.add("active-row");
    const ecart = ecartOf(it);
    tr.innerHTML = `
      <td class="col-ref">${escHtml(it.ref)}</td>
      <td class="col-des">${escHtml(it.des)}</td>
      <td class="col-loc">${escHtml(it.loc)}</td>
      <td class="col-theo">${it.theo == null ? "—" : fmt(it.theo)}</td>
      <td class="col-count">
        <div class="count-cell">
          <input type="number" class="count-input" inputmode="numeric" step="1"
                 value="${it.count == null ? "" : it.count}" data-idx="${it.i}" />
          <button class="row-mic" data-idx="${it.i}" title="Dicter">🎤</button>
        </div>
      </td>
      <td class="col-ecart">${ecart.html}</td>`;
    frag.appendChild(tr);
  });
  body.appendChild(frag);
  document.getElementById("emptyList").classList.toggle("hidden", list.length > 0);
  wireInventoryRows();
  updateStats();
}

function wireInventoryRows() {
  document.querySelectorAll(".count-input").forEach(inp => {
    inp.addEventListener("input", () => {
      const idx = +inp.dataset.idx;
      const v = inp.value.trim();
      state.items.find(x => x.i === idx).count = v === "" ? null : Number(v);
      updateRow(idx);
      updateStats();
      saveSessionDebounced();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); focusNextInput(inp); }
    });
    inp.addEventListener("focus", () => {
      const idx = +inp.dataset.idx;
      setActive(idx, false);
    });
  });
  document.querySelectorAll(".row-mic").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = +btn.dataset.idx;
      setActive(idx, true);
      startListening();
    });
  });
}

function focusNextInput(currentInput) {
  const inputs = Array.from(document.querySelectorAll(".count-input"));
  const pos = inputs.indexOf(currentInput);
  if (pos >= 0 && pos < inputs.length - 1) inputs[pos + 1].focus();
  else currentInput.blur();
}

// Met a jour une seule ligne (ecart + classe done) sans tout re-rendre
function updateRow(idx) {
  const it = state.items.find(x => x.i === idx);
  const tr = document.querySelector(`#invBody tr[data-idx="${idx}"]`);
  if (!tr) return;
  tr.classList.toggle("done", it.count != null);
  tr.querySelector(".col-ecart").innerHTML = ecartOf(it).html;
  const inp = tr.querySelector(".count-input");
  if (inp && String(it.count == null ? "" : it.count) !== inp.value) {
    inp.value = it.count == null ? "" : it.count;
  }
}

function ecartOf(it) {
  if (it.count == null || it.theo == null) return { val: null, html: `<span class="ecart-badge ecart-empty">—</span>` };
  const d = it.count - it.theo;
  const cls = d === 0 ? "ecart-zero" : (d > 0 ? "ecart-pos" : "ecart-neg");
  const sign = d > 0 ? "+" : "";
  const label = d === 0 ? "OK" : sign + fmt(d);
  return { val: d, html: `<span class="ecart-badge ${cls}">${label}</span>` };
}

function updateStats() {
  const total = state.items.length;
  const done = state.items.filter(it => it.count != null).length;
  const ecarts = state.items.filter(it => {
    const e = ecartOf(it);
    return e.val != null && e.val !== 0;
  }).length;
  document.getElementById("statCount").textContent = `${done} / ${total} comptées`;
  const se = document.getElementById("statEcart");
  se.textContent = ecarts ? `⚠ ${ecarts} écart${ecarts > 1 ? "s" : ""}` : "";
  document.getElementById("progressFill").style.width = total ? (done / total * 100) + "%" : "0%";
}

/* ---------- Pièce active (voix) ---------- */
function setActive(idx, scroll) {
  state.activeIndex = idx;
  document.querySelectorAll("#invBody tr.active-row").forEach(tr => tr.classList.remove("active-row"));
  const tr = document.querySelector(`#invBody tr[data-idx="${idx}"]`);
  if (tr) {
    tr.classList.add("active-row");
    if (scroll) tr.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const it = state.items.find(x => x.i === idx);
  document.getElementById("voiceBar").classList.remove("hidden");
  document.getElementById("voiceRef").textContent = it ? (it.ref || "(sans réf)") : "—";
  document.getElementById("voiceDes").textContent = it ? it.des : "";
  document.getElementById("voiceHeard").textContent = "";
}

/* ---------- Reconnaissance vocale ---------- */
let recognition = null;
let listening = false;
let VOICE_LANG = localStorage.getItem("inventaire_voice_lang") || "fr-FR";

function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = VOICE_LANG;
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.continuous = false;
  rec.onresult = (ev) => {
    let interim = "", finalT = "";
    for (let k = ev.resultIndex; k < ev.results.length; k++) {
      const res = ev.results[k];
      if (res.isFinal) finalT += res[0].transcript;
      else interim += res[0].transcript;
    }
    document.getElementById("voiceHeard").textContent = (finalT || interim).trim();
    if (finalT) applySpokenNumber(finalT, ev.results);
  };
  rec.onerror = (e) => {
    listening = false;
    setMicUI(false);
    if (e.error === "not-allowed" || e.error === "service-not-allowed")
      toast("Micro refusé. Autorise le micro (HTTPS requis).", "err");
    else if (e.error === "no-speech")
      toast("Rien entendu, réessaie.", "err");
    else if (e.error === "network")
      toast("La transcription vocale a besoin d'internet.", "err");
  };
  rec.onend = () => { listening = false; setMicUI(false); };
  return rec;
}

function startListening() {
  if (state.activeIndex < 0) { toast("Choisis d'abord une pièce (clic sur 🎤 d'une ligne).", "err"); return; }
  if (!recognition) recognition = initRecognition();
  if (!recognition) { toast("Ce navigateur ne gère pas la voix. Utilise Chrome ou Edge.", "err"); return; }
  if (listening) { recognition.stop(); return; }
  try {
    recognition.lang = VOICE_LANG;   // (re)force la langue juste avant l'écoute
    listening = true;
    setMicUI(true);
    document.getElementById("voiceHeard").textContent = "…";
    console.log("[Inventaire] écoute en langue:", recognition.lang);
    recognition.start();
  } catch (err) {
    listening = false; setMicUI(false);
  }
}

function setMicUI(on) {
  document.getElementById("btnMic").classList.toggle("listening", on);
  document.getElementById("voiceBar").classList.toggle("listening", on);
  document.querySelectorAll(".row-mic").forEach(b => b.classList.toggle("listening", on));
}

// Convertit une phrase dictee en nombre et l'applique a la piece active
function applySpokenNumber(transcript, results) {
  let n = parseSpokenNumber(transcript);
  // essaie toutes les alternatives si la 1re ne donne rien
  const alts = [];
  if (n == null && results) {
    const last = results[results.length - 1];
    for (let a = 0; a < last.length; a++) {
      alts.push(last[a].transcript);
      if (n == null) n = parseSpokenNumber(last[a].transcript);
    }
  }
  console.log("[Inventaire] entendu:", JSON.stringify(transcript), "| alternatives:", alts, "| nombre:", n);
  if (n == null) { toast(`Entendu "${transcript.trim()}" : pas reconnu comme un nombre.`, "err"); return; }
  const it = state.items.find(x => x.i === state.activeIndex);
  if (!it) return;
  it.count = n;
  updateRow(state.activeIndex);
  updateStats();
  saveSession();
  document.getElementById("voiceHeard").textContent = String(n);
  toast(`${it.ref || "Pièce"} : ${n} ✓`, "ok");
  advanceActive();
}

// Passe a la piece suivante non comptee (dans la vue filtree)
function advanceActive() {
  const list = filteredItems();
  const pos = list.findIndex(x => x.i === state.activeIndex);
  let next = null;
  for (let k = pos + 1; k < list.length; k++) { if (list[k].count == null) { next = list[k]; break; } }
  if (!next) for (let k = 0; k < list.length; k++) { if (list[k].count == null) { next = list[k]; break; } }
  if (next) setActive(next.i, true);
}

/* ---------- Parsing des nombres parlés (français) ---------- */
// petits nombres (0-16, plus les composés dix-sept..dix-neuf gérés en additif)
const FR_SMALL = {
  "zero": 0, "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5,
  "six": 6, "sept": 7, "huit": 8, "neuf": 9, "dix": 10, "onze": 11, "douze": 12,
  "treize": 13, "quatorze": 14, "quinze": 15, "seize": 16
};
const FR_TENS = { "vingt": 20, "trente": 30, "quarante": 40, "cinquante": 50, "soixante": 60 };

// Secours anglais (si Chrome transcrit en en-US : "twelve" au lieu de "douze")
const EN_SMALL = {
  "zero": 0, "oh": 0, "one": 1, "two": 2, "to": 2, "too": 2, "three": 3, "four": 4, "for": 4,
  "five": 5, "six": 6, "seven": 7, "eight": 8, "ate": 8, "nine": 9, "ten": 10, "eleven": 11,
  "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
  "eighteen": 18, "nineteen": 19
};
const EN_TENS = { "twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90 };

function parseSpokenNumber(text) {
  const raw = String(text == null ? "" : text).toLowerCase().replace(/,/g, ".");
  let t = norm(text);
  if (!t) return null;
  // "aucun / rien / zero"
  if (/\b(aucun|aucune|rien|vide|neant|nothing|none|empty)\b/.test(t)) return 0;
  // chiffres directs, décimale comprise (ex "12", "3.5", "007")
  const digits = raw.replace(/[^0-9.\-]/g, " ").trim().split(/\s+/).filter(Boolean);
  for (const d of digits) {
    const m = d.match(/^-?\d+(\.\d+)?$/);
    if (m) { const v = parseFloat(d); if (!isNaN(v)) return v; }
  }
  // nombres en toutes lettres : essaie le français, puis l'anglais en secours
  const words = t.split(/\s+/).filter(Boolean);
  const fr = parseFrWords(words);
  if (fr != null) return fr;
  return parseEnWords(words);
}

function parseFrWords(words) {
  let total = 0, current = 0, matched = false;
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    if (w === "et") continue;
    if (w === "cent" || w === "cents") { current = (current === 0 ? 1 : current) * 100; matched = true; continue; }
    if (w === "mille" || w === "milles") { total += (current === 0 ? 1 : current) * 1000; current = 0; matched = true; continue; }
    if (w === "quatre" && (words[i + 1] === "vingt" || words[i + 1] === "vingts")) {
      current += 80; matched = true; i++; continue;
    }
    if (w in FR_SMALL) { current += FR_SMALL[w]; matched = true; continue; }
    if (w in FR_TENS) { current += FR_TENS[w]; matched = true; continue; }
    if (w.endsWith("s")) {
      const w2 = w.slice(0, -1);
      if (w2 in FR_SMALL) { current += FR_SMALL[w2]; matched = true; continue; }
      if (w2 in FR_TENS) { current += FR_TENS[w2]; matched = true; continue; }
    }
  }
  total += current;
  return matched ? total : null;
}

function parseEnWords(words) {
  let total = 0, current = 0, matched = false;
  for (let w of words) {
    if (w === "and") continue;
    if (w === "hundred") { current = (current === 0 ? 1 : current) * 100; matched = true; continue; }
    if (w === "thousand") { total += (current === 0 ? 1 : current) * 1000; current = 0; matched = true; continue; }
    if (w in EN_SMALL) { current += EN_SMALL[w]; matched = true; continue; }
    if (w in EN_TENS) { current += EN_TENS[w]; matched = true; continue; }
  }
  total += current;
  return matched ? total : null;
}

/* ---------- Export Excel ---------- */
function exportExcel() {
  if (!state.items.length) return;
  const m = state.map;
  const out = state.rows.map((r, i) => {
    const it = state.items[i];
    const row = {};
    state.headers.forEach(h => { row[h] = r[h]; });   // colonnes d'origine intactes
    row["Compté"] = it.count == null ? "" : it.count;
    if (m.theo) {
      const e = (it.count == null || it.theo == null) ? "" : (it.count - it.theo);
      row["Écart"] = e;
      row["Statut"] = it.count == null ? "Non compté"
        : (it.theo == null ? "Compté"
        : (it.count === it.theo ? "OK" : (it.count > it.theo ? "Surplus" : "Manquant")));
    } else {
      row["Statut"] = it.count == null ? "Non compté" : "Compté";
    }
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(out);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventaire");
  const base = state.fileName.replace(/\.(xlsx|xls|csv)$/i, "");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  XLSX.writeFile(wb, `${base}_inventaire_${stamp}.xlsx`);
  toast("Fichier Excel exporté ✓", "ok");
}

/* ---------- Sauvegarde locale (reprise) ---------- */
let saveTimer = null;
function saveSessionDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 400);
}
function saveSession() {
  try {
    const payload = {
      fileName: state.fileName, headers: state.headers, rows: state.rows,
      map: state.map, counts: state.items.map(it => it.count), ts: Date.now()
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
  } catch (e) { /* quota : on ignore */ }
}
function loadSessionInfo() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function resumeSession(data) {
  state.fileName = data.fileName; state.headers = data.headers; state.rows = data.rows; state.map = data.map;
  buildItems();
  (data.counts || []).forEach((c, i) => { if (state.items[i]) state.items[i].count = c; });
  document.getElementById("btnExport").classList.remove("hidden");
  document.getElementById("btnReset").classList.remove("hidden");
  document.getElementById("fileName").textContent = state.fileName;
  showScreen("screenInventory");
  renderInventory();
}

/* ---------- Utils ---------- */
function fmt(n) { return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100); }
function pad(n) { return String(n).padStart(2, "0"); }
function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escAttr(s) { return escHtml(s); }
function showScreen(id) {
  ["screenImport", "screenMapping", "screenInventory"].forEach(s =>
    document.getElementById(s).classList.toggle("hidden", s !== id));
  document.getElementById("voiceBar").classList.toggle("hidden", id !== "screenInventory" || state.activeIndex < 0);
}
let toastTimer = null;
function toast(msg, kind) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (kind ? " " + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

/* ---------- Câblage global ---------- */
function wireGlobal() {
  const fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", e => { if (e.target.files[0]) readFile(e.target.files[0]); });

  const dz = document.getElementById("dropzone");
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });

  document.getElementById("btnStart").addEventListener("click", startInventory);
  document.getElementById("btnBackImport").addEventListener("click", () => showScreen("screenImport"));
  document.getElementById("btnExport").addEventListener("click", exportExcel);
  document.getElementById("btnReset").addEventListener("click", () => {
    if (confirm("Recommencer ? Le comptage en cours sera effacé (pense à exporter avant).")) {
      localStorage.removeItem(STORE_KEY);
      location.reload();
    }
  });

  const search = document.getElementById("searchInput");
  search.addEventListener("input", () => { state.search = search.value; renderInventory(); });

  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("chip-active"));
      chip.classList.add("chip-active");
      state.filter = chip.dataset.filter;
      renderInventory();
    });
  });

  document.getElementById("btnMic").addEventListener("click", startListening);
  document.getElementById("btnVoiceClose").addEventListener("click", () => {
    document.getElementById("voiceBar").classList.add("hidden");
    state.activeIndex = -1;
    document.querySelectorAll("#invBody tr.active-row").forEach(tr => tr.classList.remove("active-row"));
  });

  // Barre espace = dicter, quand on n'est pas dans un champ texte
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !document.getElementById("screenInventory").classList.contains("hidden")) {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea" && tag !== "select") {
        e.preventDefault();
        startListening();
      }
    }
  });

  // Reprise de session
  const info = loadSessionInfo();
  if (info && info.rows && info.rows.length) {
    const box = document.getElementById("resumeBox");
    const done = (info.counts || []).filter(c => c != null).length;
    document.getElementById("resumeInfo").textContent =
      `${info.fileName} · ${done}/${info.rows.length} comptées`;
    box.classList.remove("hidden");
    document.getElementById("btnResume").addEventListener("click", () => resumeSession(info));
    document.getElementById("btnDiscard").addEventListener("click", () => {
      localStorage.removeItem(STORE_KEY); box.classList.add("hidden");
    });
  }
}

document.addEventListener("DOMContentLoaded", wireGlobal);

// Hook de vérification (inoffensif) : permet de tester la logique sans manipuler le dialogue fichier
window.INV = { state, autoDetect, parseSpokenNumber, buildItems, toNum, norm, scoreHeader, ecartOf, exportExcel };

