// Schlanke SVG-Charts (keine externe Lib -> voll offline, volle Stil-Kontrolle).
// Zwei Diagramme: kumulative Ausflugkurve + Ausfluege je Minute.
// Farben kommen ueber CSS-Variablen, damit sie dem Theme folgen.

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// Kumulative Netto-Ausflugkurve. series = [{t, saldo}], startMs.
function renderCumulative(container, series, startMs) {
  container.innerHTML = "";
  const W = container.clientWidth || 320;
  const H = 220;
  const padL = 38, padR = 12, padT = 14, padB = 30;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" });

  const accent = cssVar("--accent", "#ffb347");
  const grid = cssVar("--grid", "#3a3a3a");
  const fg = cssVar("--muted", "#aaa");

  if (!series || series.length === 0) {
    const t = svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", fill: fg, "font-size": 13 });
    t.textContent = "Keine Ausflugdaten";
    svg.appendChild(t);
    container.appendChild(svg);
    return;
  }

  const t0 = startMs || series[0].t;
  const data = [{ x: 0, y: 0 }].concat(series.map((p) => ({ x: (p.t - t0) / 60000, y: p.saldo })));
  const maxX = Math.max(1, data[data.length - 1].x);
  const maxY = Math.max(1, Math.max.apply(null, data.map((d) => d.y)));

  const sx = (x) => padL + (x / maxX) * (W - padL - padR);
  const sy = (y) => H - padB - (y / maxY) * (H - padT - padB);

  // Gitter + Y-Achsenbeschriftung
  const yTicks = niceTicks(maxY, 4);
  for (const yt of yTicks) {
    svg.appendChild(svgEl("line", { x1: padL, y1: sy(yt), x2: W - padR, y2: sy(yt), stroke: grid, "stroke-width": 1 }));
    const lbl = svgEl("text", { x: padL - 5, y: sy(yt) + 4, "text-anchor": "end", fill: fg, "font-size": 10 });
    lbl.textContent = yt;
    svg.appendChild(lbl);
  }
  // X-Achsenbeschriftung (Minuten)
  const xTicks = niceTicks(maxX, 5);
  for (const xt of xTicks) {
    const lbl = svgEl("text", { x: sx(xt), y: H - padB + 16, "text-anchor": "middle", fill: fg, "font-size": 10 });
    lbl.textContent = xt;
    svg.appendChild(lbl);
  }
  const xlab = svgEl("text", { x: (W + padL) / 2, y: H - 2, "text-anchor": "middle", fill: fg, "font-size": 10 });
  xlab.textContent = "Minuten seit Start";
  svg.appendChild(xlab);

  // Linie (Treppe)
  let d = "";
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    if (i === 0) d += `M ${sx(p.x)} ${sy(p.y)}`;
    else d += ` L ${sx(data[i].x)} ${sy(data[i - 1].y)} L ${sx(p.x)} ${sy(p.y)}`;
  }
  // Flaeche unter Kurve
  const area = d + ` L ${sx(data[data.length - 1].x)} ${sy(0)} L ${sx(0)} ${sy(0)} Z`;
  svg.appendChild(svgEl("path", { d: area, fill: accent, "fill-opacity": 0.15, stroke: "none" }));
  svg.appendChild(svgEl("path", { d, fill: "none", stroke: accent, "stroke-width": 2.5, "stroke-linejoin": "round" }));

  container.appendChild(svg);
}

// Ausfluege je Minute. bins = [{minute, anzahl}]
function renderHistogram(container, bins) {
  container.innerHTML = "";
  const W = container.clientWidth || 320;
  const H = 200;
  const padL = 38, padR = 12, padT = 14, padB = 30;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" });

  const accent2 = cssVar("--accent2", "#6fb3ff");
  const grid = cssVar("--grid", "#3a3a3a");
  const fg = cssVar("--muted", "#aaa");

  if (!bins || bins.length === 0) {
    const t = svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", fill: fg, "font-size": 13 });
    t.textContent = "Keine Ausflugdaten";
    svg.appendChild(t);
    container.appendChild(svg);
    return;
  }

  const maxY = Math.max(1, Math.max.apply(null, bins.map((b) => b.anzahl)));
  const n = bins.length;
  const plotW = W - padL - padR;
  const bw = plotW / n;
  const sy = (y) => H - padB - (y / maxY) * (H - padT - padB);

  const yTicks = niceTicks(maxY, 4);
  for (const yt of yTicks) {
    svg.appendChild(svgEl("line", { x1: padL, y1: sy(yt), x2: W - padR, y2: sy(yt), stroke: grid, "stroke-width": 1 }));
    const lbl = svgEl("text", { x: padL - 5, y: sy(yt) + 4, "text-anchor": "end", fill: fg, "font-size": 10 });
    lbl.textContent = yt;
    svg.appendChild(lbl);
  }

  for (let i = 0; i < n; i++) {
    const b = bins[i];
    const x = padL + i * bw;
    const h = (b.anzahl / maxY) * (H - padT - padB);
    if (b.anzahl > 0) {
      svg.appendChild(svgEl("rect", {
        x: x + bw * 0.12, y: sy(b.anzahl), width: bw * 0.76, height: h,
        fill: accent2, rx: 2
      }));
    }
    if (n <= 30 && (i % Math.ceil(n / 12 || 1) === 0)) {
      const lbl = svgEl("text", { x: x + bw / 2, y: H - padB + 16, "text-anchor": "middle", fill: fg, "font-size": 10 });
      lbl.textContent = b.minute;
      svg.appendChild(lbl);
    }
  }
  const xlab = svgEl("text", { x: (W + padL) / 2, y: H - 2, "text-anchor": "middle", fill: fg, "font-size": 10 });
  xlab.textContent = "Minute seit Start";
  svg.appendChild(xlab);

  container.appendChild(svg);
}

function niceTicks(max, count) {
  const step = Math.max(1, Math.ceil(max / count));
  const ticks = [];
  for (let v = 0; v <= max + 0.0001; v += step) ticks.push(v);
  return ticks;
}
