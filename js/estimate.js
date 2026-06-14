// Live-Schaetzung "wann kann ich aufhoeren zu schauen".
// Drei umschaltbare Varianten. Alle arbeiten auf den gueltigen Ausflug-Events.
//
// Ereignis-Schema: { t: epoch_ms, typ: "out"|"in", gueltig: bool, voidT: ms|null }
//  - "out" = Ausflug (+1), "in" = Wieder-Einflug (-1, biologisch)
//  - Korrektur (Fehlzaehlung) = letztes gueltiges Event auf gueltig=false setzen.

function validEvents(events) {
  return (events || []).filter((e) => e.gueltig).sort((a, b) => a.t - b.t);
}

function exitTimes(events) {
  return validEvents(events).filter((e) => e.typ === "out").map((e) => e.t);
}

function netSaldo(events) {
  let s = 0;
  for (const e of validEvents(events)) s += e.typ === "out" ? 1 : -1;
  return s;
}

// Kumulative Netto-Reihe (Schritt fuer Schritt): [{t, saldo}]
function netSeries(events) {
  let s = 0;
  const out = [];
  for (const e of validEvents(events)) {
    s += e.typ === "out" ? 1 : -1;
    out.push({ t: e.t, saldo: s });
  }
  return out;
}

// Ausfluege je Minute (Bins) ab Startzeit. [{minute, anzahl}]
function exitsPerMinute(events, startMs, endMs) {
  const xs = exitTimes(events);
  if (xs.length === 0) return [];
  const t0 = startMs || xs[0];
  const tEnd = endMs || xs[xs.length - 1];
  const nBins = Math.max(1, Math.ceil((tEnd - t0) / 60000) + 1);
  const bins = new Array(nBins).fill(0);
  for (const t of xs) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.floor((t - t0) / 60000)));
    bins[idx] += 1;
  }
  return bins.map((anzahl, minute) => ({ minute, anzahl }));
}

function fmtMMSS(sek) {
  sek = Math.max(0, Math.round(sek));
  const m = Math.floor(sek / 60);
  const s = sek % 60;
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

// --- Variante 1: Stille-Regel ---------------------------------------------
// Stoppen, wenn seit dem letzten Ausflug X Minuten ohne Ausflug vergangen sind.
function estimateStille(events, nowMs, settings) {
  const xs = exitTimes(events);
  const schwelleSek = (settings.stilleMinuten || 5) * 60;
  if (xs.length === 0) {
    return { status: "warten", titel: "Noch kein Ausflug", detail: "Warten auf ersten Ausflug." };
  }
  const seitLetztem = (nowMs - xs[xs.length - 1]) / 1000;
  const rest = schwelleSek - seitLetztem;
  if (rest <= 0) {
    return {
      status: "stoppen",
      titel: "Kann aufhoeren",
      detail: "Seit " + fmtMMSS(seitLetztem) + " kein Ausflug (Schwelle " +
        settings.stilleMinuten + " Min erreicht)."
    };
  }
  return {
    status: "warten",
    titel: "Weiter schauen",
    detail: "Letzter Ausflug vor " + fmtMMSS(seitLetztem) + ". Noch " +
      fmtMMSS(rest) + " bis Empfehlung Stopp.",
    restSek: rest
  };
}

// --- Variante 2: Raten-basiert --------------------------------------------
// Stoppen, wenn die aktuelle Ausflugrate (gleitendes Fenster) unter einen
// Anteil der bisherigen Spitzenrate faellt.
function estimateRate(events, nowMs, startMs, settings) {
  const xs = exitTimes(events);
  const fensterMs = (settings.rateFenster || 5) * 60000;
  const anteil = (settings.rateAnteil || 10) / 100;
  if (xs.length < 5) {
    return { status: "warten", titel: "Zu wenig Daten", detail: "Mind. 5 Ausfluege noetig." };
  }
  // Spitzenrate: max. Anzahl Ausfluege in einem gleitenden Fenster ueber den Verlauf.
  let peak = 0;
  for (const t of xs) {
    const c = xs.filter((u) => u > t - fensterMs && u <= t).length;
    if (c > peak) peak = c;
  }
  const aktuell = xs.filter((u) => u > nowMs - fensterMs && u <= nowMs).length;
  const schwelle = Math.max(1, peak * anteil);
  const proMin = aktuell / (settings.rateFenster || 5);
  if (aktuell <= schwelle) {
    return {
      status: "stoppen",
      titel: "Kann aufhoeren",
      detail: "Rate " + proMin.toFixed(1) + "/Min liegt unter " +
        settings.rateAnteil + "% der Spitze (" + (peak / (settings.rateFenster || 5)).toFixed(1) + "/Min)."
    };
  }
  return {
    status: "warten",
    titel: "Weiter schauen",
    detail: "Aktuell " + proMin.toFixed(1) + "/Min (Spitze " +
      (peak / (settings.rateFenster || 5)).toFixed(1) + "/Min). Stopp bei <= " +
      (schwelle / (settings.rateFenster || 5)).toFixed(1) + "/Min."
  };
}

// --- Variante 3: Live-Kurven-Fit ------------------------------------------
// Logistische Saettigungskurve N(t)=A/(1+exp(-k*(t-t0))) per Grid-Search an
// die kumulative Netto-Reihe fitten, Restzeit bis fitProzent*A schaetzen.
function estimateFit(events, nowMs, startMs, settings) {
  const ser = netSeries(events).filter((p) => p.saldo > 0);
  if (ser.length < 8) {
    return { status: "warten", titel: "Zu wenig Daten", detail: "Mind. 8 Ausfluege fuer Kurven-Fit." };
  }
  const t0 = startMs || ser[0].t;
  const pts = ser.map((p) => ({ x: (p.t - t0) / 60000, y: p.saldo })); // x in Minuten
  const maxY = pts[pts.length - 1].y;
  const maxX = pts[pts.length - 1].x;

  function sse(A, k, m) {
    let s = 0;
    for (const p of pts) {
      const pred = A / (1 + Math.exp(-k * (p.x - m)));
      s += (pred - p.y) * (pred - p.y);
    }
    return s;
  }

  // Grid-Search grob -> fein.
  let best = { A: maxY, k: 0.3, m: maxX / 2, sse: Infinity };
  const As = [];
  for (let f = 1.0; f <= 2.5; f += 0.1) As.push(maxY * f);
  const ks = [];
  for (let k = 0.05; k <= 1.5; k += 0.05) ks.push(k);
  const ms = [];
  for (let m = 0; m <= maxX * 1.5 + 1; m += Math.max(0.5, maxX / 20)) ms.push(m);
  for (const A of As) for (const k of ks) for (const m of ms) {
    const e = sse(A, k, m);
    if (e < best.sse) best = { A, k, m, sse: e };
  }

  const frac = (settings.fitProzent || 99) / 100;
  // Zeitpunkt, an dem N = frac*A: t = m + ln(frac/(1-frac))/k
  const tEndMin = best.m + Math.log(frac / (1 - frac)) / best.k;
  const nowMin = (nowMs - t0) / 60000;
  const restMin = tEndMin - nowMin;
  const geschaetztTotal = Math.round(best.A);

  if (restMin <= 0) {
    return {
      status: "stoppen",
      titel: "Kann aufhoeren",
      detail: "Geschaetzte Koloniegroesse ~" + geschaetztTotal + ". " +
        (settings.fitProzent || 99) + "% sind ausgeflogen."
    };
  }
  return {
    status: "warten",
    titel: "Weiter schauen",
    detail: "Geschaetzt ~" + geschaetztTotal + " Tiere. Noch ca. " +
      fmtMMSS(restMin * 60) + " bis " + (settings.fitProzent || 99) + "% ausgeflogen.",
    restSek: restMin * 60,
    fit: best
  };
}

function runEstimator(events, nowMs, startMs, settings) {
  switch (settings.estimator) {
    case "rate": return estimateRate(events, nowMs, startMs, settings);
    case "fit": return estimateFit(events, nowMs, startMs, settings);
    case "stille":
    default: return estimateStille(events, nowMs, settings);
  }
}
