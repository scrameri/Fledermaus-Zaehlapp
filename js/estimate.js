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

// --- Statistik-Helfer ------------------------------------------------------
// Standardnormal-CDF via erf-Approximation (Abramowitz-Stegun 7.1.26,
// Fehler < 1.5e-7). Kein externes Paket noetig, reine Arithmetik.
function normCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// Log-Normal-CDF mit Lage 0: F(x)=Phi((ln x - mu)/sigma). x in Minuten ab t0.
function logNormCdf(xMin, mu, sigma) {
  if (xMin <= 0) return 0;
  return normCdf((Math.log(xMin) - mu) / sigma);
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
      titel: "Kann aufhören",
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
    return { status: "warten", titel: "Zu wenig Daten", detail: "Mind. 5 Ausflüge nötig." };
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
      titel: "Kann aufhören",
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
    return { status: "warten", titel: "Zu wenig Daten", detail: "Mind. 8 Ausflüge für Kurven-Fit." };
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
      titel: "Kann aufhören",
      detail: "Geschätzte Koloniegrösse ~" + geschaetztTotal + ". " +
        (settings.fitProzent || 99) + "% sind ausgeflogen."
    };
  }
  return {
    status: "warten",
    titel: "Weiter schauen",
    detail: "Geschätzt ~" + geschaetztTotal + " Tiere. Noch ca. " +
      fmtMMSS(restMin * 60) + " bis " + (settings.fitProzent || 99) + "% ausgeflogen.",
    restSek: restMin * 60,
    fit: best
  };
}

// --- Variante 4: Poisson-Prozess mit Log-Normal-Rate ----------------------
// Ausfluege als inhomogener Poisson-Prozess, Intensitaet lambda(t)=N*f(t) mit
// rechtsschiefer Log-Normal-Dichte f (2 Parameter mu, sigma). N (Gesamtzahl)
// faellt aus der zensierten MLE geschlossen heraus: N = n / F(jetzt). Das noch
// ausstehende Stueck ist Poisson mit Mittel mu_rest = N*(1 - F(jetzt));
// P(kein weiterer Ausflug) = exp(-mu_rest). Im Gegensatz zur symmetrischen
// Logistik (estimateFit) hat der Schwanz hier realistisches Gewicht, daher
// laengere und ehrlichere Restzeiten.
function estimatePoisson(events, nowMs, startMs, settings) {
  const xs = exitTimes(events);
  if (xs.length < 8) {
    return { status: "warten", titel: "Zu wenig Daten", detail: "Mind. 8 Ausflüge für Poisson-Schätzung." };
  }
  const t0 = startMs || xs[0];
  const nowMin = (nowMs - t0) / 60000;
  if (nowMin <= 0) {
    return { status: "warten", titel: "Warten", detail: "Noch keine verwertbare Zeitspanne." };
  }
  // ln(Ausflugzeit) in Minuten ab Start; gegen 0 absichern (log undefiniert).
  const Ls = xs.map((t) => Math.log(Math.max(1e-4, (t - t0) / 60000)));
  const n = Ls.length;
  const Lbar = Ls.reduce((a, b) => a + b, 0) / n;
  let varL = 0;
  for (const L of Ls) varL += (L - Lbar) * (L - Lbar);
  const Lsd = Math.max(0.1, Math.sqrt(varL / n));

  // Zensierte Profil-Log-Likelihood (N herausprofiliert):
  //   G(mu,sigma) = -n*ln(sigma) - SS/(2 sigma^2) - n*ln F(jetzt),  SS=sum (L-mu)^2.
  // Grid grob, an die Datenstreuung skaliert. sigma-Obergrenze grosszuegig,
  // da Zensierung die beobachtete Streuung nach unten verzerrt.
  let best = { mu: Lbar, sigma: Lsd, g: -Infinity };
  const muLo = Lbar - 1.0 * Lsd, muHi = Lbar + 5.0 * Lsd;
  const sgLo = Math.max(0.08, 0.3 * Lsd), sgHi = 4.0 * Lsd + 0.2;
  const MU = 50, SG = 30;
  for (let i = 0; i <= MU; i++) {
    const mu = muLo + (muHi - muLo) * (i / MU);
    let ss = 0;
    for (const L of Ls) ss += (L - mu) * (L - mu);
    for (let j = 0; j <= SG; j++) {
      const sigma = sgLo + (sgHi - sgLo) * (j / SG);
      const Fnow = logNormCdf(nowMin, mu, sigma);
      if (Fnow <= 1e-6) continue;
      const g = -n * Math.log(sigma) - ss / (2 * sigma * sigma) - n * Math.log(Fnow);
      if (g > best.g) best = { mu, sigma, g };
    }
  }

  const Fnow = Math.max(1e-3, logNormCdf(nowMin, best.mu, best.sigma));
  const Ntot = n / Fnow;             // geschaetzte Gesamt-Ausfluege (~Koloniegroesse)
  const muRest = Ntot * (1 - Fnow);  // erwartete noch ausstehende Ausfluege
  const pDone = Math.exp(-muRest);   // P(kein weiterer Ausflug)
  const schwelle = settings.poissonRest || 0.5;
  const Nround = Math.round(Ntot);
  const pTxt = pDone < 0.005 ? "<1%" : Math.round(pDone * 100) + "%";

  if (muRest <= schwelle) {
    return {
      status: "stoppen",
      titel: "Kann aufhören",
      detail: "Geschätzt ~" + Nround + " Tiere, erwartet noch <" + schwelle.toFixed(1) +
        " (P(fertig) " + pTxt + ")."
    };
  }
  // Restzeit: kleinster Zeitpunkt mit N*(1 - F(t)) <= Schwelle.
  const Ftarget = 1 - schwelle / Ntot;
  let restMin = -1;
  for (let dt = 0; dt <= 180; dt += 0.25) {
    if (logNormCdf(nowMin + dt, best.mu, best.sigma) >= Ftarget) { restMin = dt; break; }
  }
  return {
    status: "warten",
    titel: "Weiter schauen",
    detail: "Geschätzt ~" + Nround + " Tiere, erwartet noch ~" + muRest.toFixed(1) +
      " (P(fertig) " + pTxt + "). Noch ca. " + (restMin < 0 ? ">180:00" : fmtMMSS(restMin * 60)) + ".",
    restSek: restMin < 0 ? null : restMin * 60,
    fit: best
  };
}

// --- Variante 5: Schwanz-Rate (robust) ------------------------------------
// Modelliert nur den abklingenden Schwanz statt der ganzen Kurve: nach dem Peak
// lambda(t) ~ lambda_jetzt*exp(-(t-jetzt)/tau). tau aus dem Verhaeltnis zweier
// benachbarter Fenster (r0 davor, r1 zuletzt): tau = W / ln(r0/r1). Erwartete
// Resttiere mu_rest = lambda_jetzt*tau = r1 / ln(r0/r1). Keine wacklige globale
// Asymptote; Annahme ist ein exponentieller Schwanz.
function estimateTail(events, nowMs, startMs, settings) {
  const xs = exitTimes(events);
  const Wmin = settings.tailFenster || 5;
  const W = Wmin * 60000;
  const schwelle = settings.tailRest || 0.5;
  if (xs.length < 8) {
    return { status: "warten", titel: "Zu wenig Daten", detail: "Mind. 8 Ausflüge für Schwanz-Schätzung." };
  }
  const t0 = startMs || xs[0];
  if (nowMs - t0 < 2 * W) {
    return { status: "warten", titel: "Sammle Daten", detail: "Erst nach " + (2 * Wmin) + " Min Verlauf möglich." };
  }
  const r1 = xs.filter((t) => t > nowMs - W && t <= nowMs).length;          // letztes Fenster
  const r0 = xs.filter((t) => t > nowMs - 2 * W && t <= nowMs - W).length;  // vorheriges Fenster

  if (r1 === 0) {
    return {
      status: "stoppen",
      titel: "Kann aufhören",
      detail: "Seit " + Wmin + " Min kein Ausflug. Erwartete Resttiere ~0."
    };
  }
  // Nur bei klarem Rueckgang extrapolieren. Nahe am Peak ist die Rate flach
  // (Verhaeltnis ~1), dann ist tau instabil und der Schwanz noch nicht erreicht.
  const ratio = r0 / r1;
  const MIN_RATIO = 1.25;
  if (ratio < MIN_RATIO) {
    return {
      status: "warten",
      titel: "Weiter schauen",
      detail: "Rate nicht klar fallend (" + (r0 / Wmin).toFixed(1) + " → " + (r1 / Wmin).toFixed(1) +
        "/Min). Weiter beobachten."
    };
  }
  // Klar fallend: exponentiellen Schwanz extrapolieren.
  const tauMin = Wmin / Math.log(ratio);    // Zeitkonstante (Min)
  const halbwert = tauMin * Math.LN2;        // Halbwertszeit
  // mu_rest = lambda_jetzt * tau; gegen Schaetzrauschen auf bisher Gezaehltes deckeln.
  const muRest = Math.min(xs.length, r1 / Math.log(ratio));
  const lamNow = r1 / Wmin;                  // pro Minute

  if (muRest <= schwelle) {
    return {
      status: "stoppen",
      titel: "Kann aufhören",
      detail: "Erwartet noch ~" + muRest.toFixed(1) + " Tiere (< " + schwelle.toFixed(1) +
        "). Rate " + lamNow.toFixed(1) + "/Min, Halbwertszeit ~" + halbwert.toFixed(1) + " Min."
    };
  }
  const restMin = tauMin * Math.log(muRest / schwelle);
  return {
    status: "warten",
    titel: "Weiter schauen",
    detail: "Rate fällt (Halbwertszeit ~" + halbwert.toFixed(1) + " Min). Erwartet noch ~" +
      muRest.toFixed(1) + " Tiere. Noch ca. " + (restMin > 180 ? ">180:00" : fmtMMSS(restMin * 60)) + ".",
    restSek: restMin > 180 ? null : restMin * 60
  };
}

function runEstimator(events, nowMs, startMs, settings) {
  switch (settings.estimator) {
    case "rate": return estimateRate(events, nowMs, startMs, settings);
    case "fit": return estimateFit(events, nowMs, startMs, settings);
    case "poisson": return estimatePoisson(events, nowMs, startMs, settings);
    case "tail": return estimateTail(events, nowMs, startMs, settings);
    case "stille":
    default: return estimateStille(events, nowMs, settings);
  }
}
