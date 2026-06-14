// Lokale Persistenz via IndexedDB. Kein Server, voll offline.
// Eine Object-Store "sessions", Key = session.id.

const DB_NAME = "fledermaus-zaehlapp";
const DB_VERSION = 1;
const STORE = "sessions";

let _dbPromise = null;

function dbOpen() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function dbTx(mode) {
  const db = await dbOpen();
  return db.transaction(STORE, mode).objectStore(STORE);
}

async function saveSession(session) {
  const store = await dbTx("readwrite");
  return new Promise((resolve, reject) => {
    const r = store.put(session);
    r.onsuccess = () => resolve(session);
    r.onerror = () => reject(r.error);
  });
}

async function getSession(id) {
  const store = await dbTx("readonly");
  return new Promise((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function getAllSessions() {
  const store = await dbTx("readonly");
  return new Promise((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => {
      const list = r.result || [];
      // Neueste zuerst (nach Startzeit)
      list.sort((a, b) => (b.startzeit || "").localeCompare(a.startzeit || ""));
      resolve(list);
    };
    r.onerror = () => reject(r.error);
  });
}

async function deleteSession(id) {
  const store = await dbTx("readwrite");
  return new Promise((resolve, reject) => {
    const r = store.delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// Einstellungen einfach via localStorage (klein, synchron).
const SETTINGS_KEY = "fz-settings";
const DEFAULT_SETTINGS = {
  theme: "dunkel",            // dunkel | nacht | hell
  estimator: "poisson",      // stille | rate | fit | poisson | tail (Standard: Poisson)
  stilleMinuten: 5,           // Schwelle Stille-Regel
  rateFenster: 5,             // Fensterbreite Minuten (Raten-Regel)
  rateAnteil: 10,             // Prozent der Spitzenrate (Raten-Regel)
  fitProzent: 99,             // Saettigungs-Prozent fuer Kurven-Fit
  poissonRest: 0.5,           // Poisson: erwartete Resttiere bis Stopp
  tailFenster: 5,             // Schwanz-Rate: Fensterbreite Minuten
  tailRest: 0.5              // Schwanz-Rate: erwartete Resttiere bis Stopp
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return Object.assign({}, DEFAULT_SETTINGS, s);
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
