// App-Controller: Navigation, Setup, Zaehlen, Resultat, Einstellungen.
// Voll offline, Zustand in IndexedDB (crash-sicher: jede Aktion wird gespeichert).

let settings = loadSettings();
let current = null;       // aktuell laufende/angezeigte Session
let tickTimer = null;     // 1-Sekunden-Takt im Zaehl-Screen

// Ab so vielen gueltigen Ausfluegen werden die Live-Charts beim Zaehlen gezeigt.
const LIVE_CHART_MIN = 3;

// --- Hilfen ---------------------------------------------------------------
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

function show(viewId) {
  qsa(".view").forEach((v) => v.classList.toggle("active", v.id === viewId));
  window.scrollTo(0, 0);
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", settings.theme);
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

function todayYMD() {
  const d = new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

function ymdToInput(ymd) {
  if (!ymd || ymd.length !== 8) return new Date().toISOString().slice(0, 10);
  return ymd.slice(0, 4) + "-" + ymd.slice(4, 6) + "-" + ymd.slice(6, 8);
}

function inputToYmd(v) { return (v || "").replace(/-/g, ""); }

function fillSelect(sel, items, placeholder) {
  sel.innerHTML = "";
  if (placeholder) {
    const o = document.createElement("option");
    o.value = ""; o.textContent = placeholder; o.disabled = true; o.selected = true;
    sel.appendChild(o);
  }
  for (const it of items) {
    const o = document.createElement("option");
    o.value = it; o.textContent = it;
    sel.appendChild(o);
  }
}

// --- Startansicht ---------------------------------------------------------
async function renderStart() {
  const list = await getAllSessions();
  const cont = qs("#session-list");
  cont.innerHTML = "";
  const running = list.find((s) => s.status === "running");
  qs("#resume-banner").style.display = running ? "flex" : "none";
  if (running) {
    qs("#resume-info").textContent = running.art + " - " + running.ort;
    qs("#btn-resume").onclick = () => openCount(running);
  }

  if (list.length === 0) {
    cont.innerHTML = '<p class="muted center">Noch keine Zählungen. Tippe auf "Neue Zählung".</p>';
    return;
  }
  for (const s of list) {
    const valid = validEvents(s.events);
    const netto = valid.filter((e) => e.typ === "out").length - valid.filter((e) => e.typ === "in").length;
    const card = document.createElement("div");
    card.className = "card session-card";
    card.innerHTML =
      '<div class="sc-main">' +
        '<div class="sc-title">' + esc(s.art) + '</div>' +
        '<div class="muted">' + esc(s.ort) + ' &middot; ' + esc(s.datum) + ' &middot; ' + esc(s.beobachter) + '</div>' +
        '<div class="sc-stat">Netto <b>' + netto + '</b> Tiere' +
          (s.status === "running" ? ' <span class="badge-run">läuft</span>' : '') + '</div>' +
      '</div>' +
      '<div class="sc-actions">' +
        '<button class="icon-btn" data-act="open" title="Öffnen">&#9654;</button>' +
        '<button class="icon-btn" data-act="xls" title="Excel">&#8675;</button>' +
        '<button class="icon-btn danger" data-act="del" title="Löschen">&#128465;</button>' +
      '</div>';
    card.querySelector('[data-act="open"]').onclick = () =>
      s.status === "running" ? openCount(s) : openResult(s);
    card.querySelector('[data-act="xls"]').onclick = () => exportSessions([s]);
    card.querySelector('[data-act="del"]').onclick = async () => {
      if (confirm("Diese Zählung löschen?")) { await deleteSession(s.id); renderStart(); }
    };
    cont.appendChild(card);
  }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// --- Setup ----------------------------------------------------------------
function openSetup() {
  fillSelect(qs("#in-ort"), ORTE, "Ort wählen");
  fillSelect(qs("#in-art"), ARTEN, "Art wählen");
  fillSelect(qs("#in-beob"), BEOBACHTER, "Beobachter/-in wählen");
  if (ORTE.length === 1) qs("#in-ort").value = ORTE[0];
  if (BEOBACHTER.length === 1) qs("#in-beob").value = BEOBACHTER[0];
  qs("#in-datum").value = ymdToInput(todayYMD());
  show("view-setup");
}

function startCounting() {
  const ort = qs("#in-ort").value;
  const art = qs("#in-art").value;
  const beob = qs("#in-beob").value;
  const datum = inputToYmd(qs("#in-datum").value);
  if (!ort || !art || !beob || !datum) { alert("Bitte Ort, Art, Datum und Beobachter wählen."); return; }
  current = {
    id: crypto.randomUUID(),
    ort, art, beobachter: beob, datum,
    startMs: Date.now(),
    endMs: null,
    events: [],
    notiz: "",
    estimatorUsed: settings.estimator,
    status: "running"
  };
  saveSession(current);
  openCount(current);
}

// --- Zaehlen --------------------------------------------------------------
function openCount(session) {
  current = session;
  current.status = "running";
  qs("#count-ort").textContent = current.ort;
  qs("#count-art").textContent = current.art;
  show("view-count");
  updateCountUI();
  renderLiveCharts();
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(updateCountUI, 1000);
}

function addEvent(typ) {
  current.events.push({ t: Date.now(), typ, gueltig: true, voidT: null });
  saveSession(current);
  updateCountUI();
  renderLiveCharts();
  flash(typ === "out" ? "#btn-out" : "#btn-in");
}

function undoLast() {
  // Letztes gueltiges Event als korrigiert markieren (Fehlzaehlung).
  for (let i = current.events.length - 1; i >= 0; i--) {
    if (current.events[i].gueltig) {
      current.events[i].gueltig = false;
      current.events[i].voidT = Date.now();
      saveSession(current);
      updateCountUI();
      renderLiveCharts();
      flash("#btn-undo");
      return;
    }
  }
}

function flash(sel) {
  const el = qs(sel);
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 150);
}

function updateCountUI() {
  const saldo = netSaldo(current.events);
  qs("#saldo").textContent = saldo;
  const valid = validEvents(current.events);
  qs("#stat-out").textContent = valid.filter((e) => e.typ === "out").length;
  qs("#stat-in").textContent = valid.filter((e) => e.typ === "in").length;
  qs("#stat-korr").textContent = current.events.filter((e) => !e.gueltig).length;

  const elapsed = (Date.now() - current.startMs) / 1000;
  qs("#elapsed").textContent = fmtMMSS(elapsed);

  const est = runEstimator(current.events, Date.now(), current.startMs, settings);
  const panel = qs("#estimate");
  panel.className = "estimate " + (est.status === "stoppen" ? "ok" : est.status === "warten" ? "wait" : "");
  qs("#est-titel").textContent = est.titel;
  qs("#est-detail").textContent = est.detail;
  qs("#est-variante").textContent = "Variante: " + ESTIMATOR_LABEL[settings.estimator];
}

// Live-Charts waehrend des Zaehlens. Erst ab LIVE_CHART_MIN Ausfluegen sichtbar.
function renderLiveCharts() {
  const box = qs("#live-charts");
  const nOut = validEvents(current.events).filter((e) => e.typ === "out").length;
  if (nOut < LIVE_CHART_MIN) { box.style.display = "none"; return; }
  box.style.display = "grid";
  renderCumulative(qs("#live-chart-cum"), netSeries(current.events), current.startMs, 130);
  renderHistogram(qs("#live-chart-hist"), exitsPerMinute(current.events, current.startMs, Date.now()), 120);
}

function finishCounting() {
  if (!confirm("Zählung beenden?")) return;
  current.endMs = Date.now();
  current.status = "finished";
  current.estimatorUsed = settings.estimator;
  saveSession(current);
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  openResult(current);
}

// --- Resultat -------------------------------------------------------------
function openResult(session) {
  current = session;
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  const valid = validEvents(current.events);
  const nOut = valid.filter((e) => e.typ === "out").length;
  const nIn = valid.filter((e) => e.typ === "in").length;
  qs("#res-title").textContent = current.art;
  qs("#res-sub").textContent = current.ort + " · " + current.datum + " · " + current.beobachter;
  qs("#res-netto").textContent = nOut - nIn;
  qs("#res-out").textContent = nOut;
  qs("#res-in").textContent = nIn;
  qs("#res-korr").textContent = current.events.filter((e) => !e.gueltig).length;

  qs("#res-start").value = current.startMs ? toTimeInput(current.startMs) : "";
  qs("#res-end").value = current.endMs ? toTimeInput(current.endMs) : "";
  qs("#res-notiz").value = current.notiz || "";

  renderResultCharts();
  show("view-result");
}

function toTimeInput(ms) {
  const d = new Date(ms);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function timeInputToMs(baseMs, val) {
  if (!val) return baseMs;
  const parts = val.split(":").map(Number);
  const d = new Date(baseMs);
  d.setHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);
  return d.getTime();
}

function renderResultCharts() {
  renderCumulative(qs("#chart-cum"), netSeries(current.events), current.startMs);
  renderHistogram(qs("#chart-hist"), exitsPerMinute(current.events, current.startMs, current.endMs));
}

function saveResult() {
  current.startMs = timeInputToMs(current.startMs, qs("#res-start").value);
  current.endMs = timeInputToMs(current.endMs || current.startMs, qs("#res-end").value);
  current.notiz = qs("#res-notiz").value;
  saveSession(current);
  renderStart();
  show("view-start");
}

// --- Einstellungen --------------------------------------------------------
function openSettings() {
  qs("#set-theme").value = settings.theme;
  qs("#set-estimator").value = settings.estimator;
  qs("#set-stille").value = settings.stilleMinuten;
  qs("#set-rate-fenster").value = settings.rateFenster;
  qs("#set-rate-anteil").value = settings.rateAnteil;
  qs("#set-fit").value = settings.fitProzent;
  qs("#set-poisson-rest").value = settings.poissonRest;
  qs("#set-tail-fenster").value = settings.tailFenster;
  qs("#set-tail-rest").value = settings.tailRest;
  updateSettingsVisibility();
  show("view-settings");
}

function updateSettingsVisibility() {
  const v = qs("#set-estimator").value;
  qs("#grp-stille").style.display = v === "stille" ? "block" : "none";
  qs("#grp-rate").style.display = v === "rate" ? "block" : "none";
  qs("#grp-fit").style.display = v === "fit" ? "block" : "none";
  qs("#grp-poisson").style.display = v === "poisson" ? "block" : "none";
  qs("#grp-tail").style.display = v === "tail" ? "block" : "none";
}

function saveSettingsView() {
  settings.theme = qs("#set-theme").value;
  settings.estimator = qs("#set-estimator").value;
  settings.stilleMinuten = Number(qs("#set-stille").value) || 5;
  settings.rateFenster = Number(qs("#set-rate-fenster").value) || 5;
  settings.rateAnteil = Number(qs("#set-rate-anteil").value) || 10;
  settings.fitProzent = Number(qs("#set-fit").value) || 99;
  settings.poissonRest = Number(qs("#set-poisson-rest").value) || 0.5;
  settings.tailFenster = Number(qs("#set-tail-fenster").value) || 5;
  settings.tailRest = Number(qs("#set-tail-rest").value) || 0.5;
  saveSettings(settings);
  applyTheme();
  show("view-start");
}

// --- Verdrahtung ----------------------------------------------------------
function wire() {
  qs("#btn-new").onclick = openSetup;
  qs("#btn-settings").onclick = openSettings;
  qs("#btn-export-all").onclick = async () => exportSessions(await getAllSessions());

  qs("#btn-setup-back").onclick = () => show("view-start");
  qs("#btn-start").onclick = startCounting;

  qs("#btn-out").onclick = () => addEvent("out");
  qs("#btn-in").onclick = () => addEvent("in");
  qs("#btn-undo").onclick = undoLast;
  qs("#btn-finish").onclick = finishCounting;
  qs("#btn-count-min").onclick = () => { saveSession(current); renderStart().then(() => show("view-start")); };

  qs("#btn-res-export").onclick = () => exportSessions([current]);
  qs("#btn-res-save").onclick = saveResult;
  qs("#res-start").onchange = () => {
    current.startMs = timeInputToMs(current.startMs, qs("#res-start").value);
    renderResultCharts();
  };
  qs("#res-end").onchange = () => {
    current.endMs = timeInputToMs(current.endMs || current.startMs, qs("#res-end").value);
    renderResultCharts();
  };

  qs("#set-estimator").onchange = updateSettingsVisibility;
  qs("#set-theme").onchange = () => { settings.theme = qs("#set-theme").value; applyTheme(); };
  qs("#btn-set-save").onclick = saveSettingsView;
  qs("#btn-set-back").onclick = () => { settings = loadSettings(); applyTheme(); show("view-start"); };

  window.addEventListener("resize", () => {
    if (!current) return;
    if (qs("#view-result").classList.contains("active")) renderResultCharts();
    else if (qs("#view-count").classList.contains("active")) renderLiveCharts();
  });
}

async function init() {
  applyTheme();
  wire();
  await renderStart();
  show("view-start");
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
