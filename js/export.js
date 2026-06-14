// Excel-Export via SheetJS (lib/xlsx.full.min.js, offline vendored).
// Zwei Blaetter: "Zaehlungen" (Metadaten + Resultat je Session) und
// "Ereignisse" (eine Zeile je Klick, sekundengenauer Zeitstempel).
// Grundlage fuer die manuelle Eingabe in die nationale Datenbank +
// fuer die statistische Modellierung.

function pad2(n) { return (n < 10 ? "0" : "") + n; }

function isoSeconds(ms) {
  if (ms == null) return "";
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function hms(ms) {
  if (ms == null) return "";
  const d = new Date(ms);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

const ESTIMATOR_LABEL = { stille: "Stille-Regel", rate: "Raten-basiert", fit: "Kurven-Fit" };

function buildWorkbook(sessions) {
  const meta = [];
  const ereignisse = [];

  for (const s of sessions) {
    const valid = validEvents(s.events);
    const nOut = valid.filter((e) => e.typ === "out").length;
    const nIn = valid.filter((e) => e.typ === "in").length;
    const nKorr = (s.events || []).filter((e) => !e.gueltig).length;
    const netto = nOut - nIn;
    const startMs = s.startMs || (valid[0] && valid[0].t) || null;
    const endMs = s.endMs || null;
    const dauerMin = startMs && endMs ? Math.round((endMs - startMs) / 60000) : "";

    meta.push({
      SessionID: s.id,
      Ort: s.ort,
      Art: s.art,
      Datum: s.datum,
      Beobachter: s.beobachter,
      Startzeit: isoSeconds(startMs),
      Endzeit: isoSeconds(endMs),
      Dauer_Min: dauerMin,
      Total_Ausfluege: nOut,
      Total_Einfluege: nIn,
      Korrekturen: nKorr,
      Netto_Koloniegroesse: netto,
      Schaetzvariante: ESTIMATOR_LABEL[s.estimatorUsed] || "",
      Notiz: s.notiz || ""
    });

    // Ereignisse in Zeitreihenfolge (inkl. korrigierte, mit Gueltig-Flag).
    const all = (s.events || []).slice().sort((a, b) => a.t - b.t);
    let saldo = 0;
    let lfd = 0;
    for (const e of all) {
      lfd += 1;
      let saldoCol = "";
      if (e.gueltig) {
        saldo += e.typ === "out" ? 1 : -1;
        saldoCol = saldo;
      }
      ereignisse.push({
        SessionID: s.id,
        Ort: s.ort,
        Art: s.art,
        Datum: s.datum,
        Beobachter: s.beobachter,
        Lfd_Nr: lfd,
        Zeitstempel: isoSeconds(e.t),
        Uhrzeit: hms(e.t),
        Sek_seit_Start: startMs ? Math.round((e.t - startMs) / 1000) : "",
        Typ: e.typ === "out" ? "Ausflug" : "Einflug",
        Gueltig: e.gueltig ? "ja" : "nein",
        Laufender_Saldo: saldoCol
      });
    }
  }

  const wb = XLSX.utils.book_new();
  const wsMeta = XLSX.utils.json_to_sheet(meta);
  const wsEv = XLSX.utils.json_to_sheet(ereignisse);
  // Spaltenbreiten grob setzen
  wsMeta["!cols"] = Object.keys(meta[0] || { a: 1 }).map(() => ({ wch: 16 }));
  wsEv["!cols"] = Object.keys(ereignisse[0] || { a: 1 }).map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, wsMeta, "Zaehlungen");
  XLSX.utils.book_append_sheet(wb, wsEv, "Ereignisse");
  return wb;
}

function exportFilename(sessions) {
  if (sessions.length === 1) {
    const s = sessions[0];
    const ort = (s.ort || "Ort").replace(/[^A-Za-z0-9]+/g, "_");
    return "Fledermaus_" + ort + "_" + (s.datum || "") + ".xlsx";
  }
  const stamp = isoSeconds(Date.now()).replace(/[: ]/g, "").replace(/-/g, "");
  return "Fledermaus_Export_" + stamp + ".xlsx";
}

function exportSessions(sessions) {
  if (!sessions || sessions.length === 0) { alert("Keine Daten zum Exportieren."); return; }
  const wb = buildWorkbook(sessions);
  XLSX.writeFile(wb, exportFilename(sessions));
}
