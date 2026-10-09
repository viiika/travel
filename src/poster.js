// Share poster: a large image of the map with the travel numbers, in landscape or portrait.
import { drawMap, FONT } from "./render.js";
import { countries, countedTotal, CONTINENTS, cityByKey } from "./data.js";
import { stats } from "./state.js";
import { ADDABLE } from "./space.js";

export const POSTER_SIZES = { landscape: [3840, 2160], portrait: [2160, 3840] };
export const POSTER_TITLE_MAX = 60;

/** The poster's numbers, in reading order. */
export function posterItems(data) {
  const s = stats(data);
  const items = [
    [s.countries, "", s.countries === 1 ? "Country or region" : "Countries & regions"],
    [s.cities, "", s.cities === 1 ? "City" : "Cities"],
    [s.continents, "/7", s.continents === 1 ? "Continent" : "Continents"],
    [Math.round((s.states / countedTotal) * 100), "%", "Of the world"],
    [Math.round(s.km).toLocaleString("en-US"), " km", "Flown"],
  ];
  // The Moon and Mars.
  if (s.beyond) items.push([s.beyond, `/${ADDABLE.length}`, "Beyond the Earth"]);
  return items;
}

/** "2019 – 2026 · 4 trips": the years of the dated stops and the number of trips. */
export function posterSubtitle(data) {
  const years = data.trips.flatMap((t) => t.stops.filter((s) => s.date).map((s) => +s.date.slice(0, 4)));
  const parts = [];
  if (years.length) {
    const a = Math.min(...years);
    const b = Math.max(...years);
    parts.push(a === b ? String(a) : `${a} – ${b}`);
  }
  const trips = data.trips.filter((t) => t.stops.length).length;
  if (trips) parts.push(`${trips} ${trips === 1 ? "trip" : "trips"}`);
  return parts.join("  ·  ");
}

// Visited countries per continent, as on the Places tab.
function continentCounts(data) {
  return CONTINENTS.filter((name) => name !== "Antarctica" || data.countries.ATA).map((name) => {
    const all = countries.filter((c) => c.continent === name && (c.counted || c.id === "ATA"));
    return [name, all.filter((c) => data.countries[c.id]).length, all.length];
  });
}

// All trips, drawn as finished routes.
function allRoutes(data) {
  const legs = [];
  for (const t of data.trips) {
    const pts = t.stops.map((s) => cityByKey.get(s.city)).filter(Boolean).map((c) => [c.lon, c.lat]);
    for (let i = 1; i < pts.length; i++) legs.push({ from: pts[i - 1], to: pts[i], progress: 1, fade: 0.55, mode: t.stops[i].mode || "flight" });
  }
  return legs.length ? { legs, stops: [] } : null;
}

// Text helpers. Sizes are in units of 1/1080 of the poster's shorter side.
function text(ctx, str, x, y, { size, weight = 400, color, align = "left", tracking = 0, u }) {
  ctx.font = `${weight} ${size * u}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${tracking * u}px`;
  ctx.fillText(str, x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

function fit(ctx, str, maxWidth) {
  if (ctx.measureText(str).width <= maxWidth) return str;
  let t = str;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// A number with its small suffix ("23/195", "12%"); returns its width.
function figure(ctx, [value, suffix], x, y, size, th, u, align = "left") {
  ctx.font = `600 ${size * u}px ${FONT}`;
  const nw = ctx.measureText(String(value)).width;
  ctx.font = `400 ${size * 0.42 * u}px ${FONT}`;
  const sw = suffix ? ctx.measureText(suffix).width + 3 * u : 0;
  const left = align === "right" ? x - nw - sw : x;
  text(ctx, String(value), left, y, { size, weight: 600, color: th.label, u });
  if (suffix) text(ctx, suffix, left + nw + 3 * u, y, { size: size * 0.42, color: th.labelMuted, u });
  return nw + sw;
}

/**
 * Draws the poster.
 * opts: { data (the travel data to show), firstVisits, theme, view (the map view: globe or flat,
 * and where it is turned), title }
 */
export function drawPoster(ctx, W, H, { data, firstVisits, theme: th, view, title }) {
  const u = Math.min(W, H) / 1080;
  const portrait = H > W;
  const flat = view.morph >= 0.5;
  const mapView = { lambda: view.lambda, phi: flat ? 0 : view.phi, k: 1, morph: flat ? 1 : 0, ox: 0, oy: 0, ty: 0 };
  // The map shows visited places and routes only: no labels, no other cities.
  const mapState = { ...data, settings: { ...data.settings, labels: { countries: false, cities: false, water: false } } };
  const drawMapIn = (x, y, w, h) => {
    ctx.save();
    ctx.translate(x, y);
    drawMap(ctx, { width: w, height: h, view: mapView, theme: th, state: mapState, firstVisits, route: allRoutes(data), hideUnvisitedCities: true, uiScale: u * 1.1 });
    ctx.restore();
  };
  const items = posterItems(data);
  const subtitle = posterSubtitle(data);
  const heading = (title || "").trim() || "My travels";

  ctx.save();
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  if (!portrait) {
    // Landscape: the map above, title and numbers in a band along the bottom.
    const pad = 72 * u;
    const band = 150 * u;
    drawMapIn(0, pad * 0.5, W, H - pad * 1.5 - band);
    const base = H - pad;
    // Numbers, right-aligned, from the right edge.
    let x = W - pad;
    const gap = 64 * u;
    for (let i = items.length - 1; i >= 0; i--) {
      const [value, suffix, label] = items[i];
      ctx.font = `600 ${56 * u}px ${FONT}`;
      const fw = ctx.measureText(String(value)).width + (suffix ? (ctx.measureText(suffix).width * 0.42) + 3 * u : 0);
      ctx.font = `500 ${19 * u}px ${FONT}`;
      const lw = ctx.measureText(label.toUpperCase()).width + label.length * 2 * u;
      const w = Math.max(fw, lw);
      figure(ctx, [value, suffix], x - w, base - 40 * u, 56, th, u);
      text(ctx, label.toUpperCase(), x - w, base, { size: 19, weight: 500, color: th.labelMuted, tracking: 2, u });
      x -= w + gap;
    }
    const titleMax = x - pad;
    ctx.font = `600 ${52 * u}px ${FONT}`;
    text(ctx, fit(ctx, heading, titleMax), pad, base - 40 * u, { size: 52, weight: 600, color: th.label, u });
    if (subtitle) {
      ctx.font = `400 ${24 * u}px ${FONT}`;
      text(ctx, fit(ctx, subtitle, titleMax), pad, base, { size: 24, color: th.labelMuted, u });
    }
  } else {
    // Portrait: the title at the top, the numbers and the continents at the bottom, and the map
    // in the space between them.
    const pad = 80 * u;
    ctx.font = `600 ${64 * u}px ${FONT}`;
    text(ctx, fit(ctx, heading, W - 2 * pad), pad, pad + 56 * u, { size: 64, weight: 600, color: th.label, u });
    if (subtitle) {
      ctx.font = `400 ${28 * u}px ${FONT}`;
      text(ctx, fit(ctx, subtitle, W - 2 * pad), pad, pad + 104 * u, { size: 28, color: th.labelMuted, u });
    }
    const colW = (W - 2 * pad) / 2;
    const rowH = 168 * u;
    const lineH = 64 * u;
    const rows = continentCounts(data);
    const half = Math.ceil(rows.length / 2);
    const barsTop = H - pad - half * lineH + 12 * u;
    const gridTop = barsTop - 56 * u - Math.ceil(items.length / 2) * rowH;
    const mapTop = pad + 150 * u;
    drawMapIn(0, mapTop, W, gridTop - 30 * u - mapTop);

    items.forEach(([value, suffix, label], i) => {
      const cx = pad + (i % 2) * colW;
      const cy = gridTop + Math.floor(i / 2) * rowH;
      figure(ctx, [value, suffix], cx, cy + 84 * u, 88, th, u);
      text(ctx, label.toUpperCase(), cx, cy + 122 * u, { size: 22, weight: 500, color: th.labelMuted, tracking: 2, u });
    });

    // Continents: name, count and a bar, in two columns.
    const accent = data.settings.accent;
    rows.forEach(([name, n, total], i) => {
      const cx = pad + Math.floor(i / half) * colW;
      const cy = barsTop + (i % half) * lineH;
      const barW = colW - 64 * u;
      text(ctx, name, cx, cy + 22 * u, { size: 24, color: th.label, u });
      text(ctx, `${n}/${total}`, cx + barW, cy + 22 * u, { size: 22, color: th.labelMuted, align: "right", u });
      ctx.fillStyle = th.hover;
      ctx.fillRect(cx, cy + 36 * u, barW, 6 * u);
      if (n) {
        ctx.fillStyle = accent;
        ctx.fillRect(cx, cy + 36 * u, Math.max(6 * u, (barW * n) / total), 6 * u);
      }
    });
  }
  ctx.restore();
}
