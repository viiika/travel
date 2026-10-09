import { geoInterpolate, geoDistance } from "d3-geo";
import { cityByKey, countryById, regionOfCity } from "./data.js";
import { makeProjection, FONT, withAlpha } from "./render.js";
import { photoBlob, photoFailed } from "./photos.js";

const EARTH_RADIUS_KM = 6371;
const PACE = { relaxed: 1.45, normal: 1, fast: 0.65 };
// Seconds each photo of a stop is on screen, and a note on its own.
const PHOTO_TIME = 2.2;
const NOTE_TIME = 3;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Builds a deterministic timeline for a list of trips.
 * Returns { duration, frame(t, width, height, morph) }.
 */
export function buildTimeline(trips, { pace = "normal", title } = {}) {
  const m = PACE[pace] || 1;
  // Flatten stops; between trips the camera "jumps" without drawing a flight.
  const stops = [];
  trips.forEach((trip, ti) =>
    trip.stops.forEach((s, si) => {
      const c = cityByKey.get(s.city);
      // mode and flight describe how this stop was reached from the previous one.
      stops.push({
        city: c,
        region: regionOfCity(c)?.id || null,
        lonlat: [c.lon, c.lat],
        date: s.date,
        trip: trip.name,
        newTrip: si === 0 && ti > 0,
        mode: s.mode || "flight",
        flight: s.flight || "",
        note: s.note || "",
        // Photos that are not here (the data was opened without its .zip), or that this browser
        // cannot show, are left out.
        photos: (s.photos || []).filter((p) => photoBlob(p) && !photoFailed(p)),
      });
    })
  );
  if (stops.length === 0) return null;

  const segments = [];
  let t = 0;
  const INTRO = 1.6 * m;
  segments.push({ kind: "intro", t0: 0, t1: INTRO, to: 0 });
  t = INTRO;
  // A stop with photos or a note holds longer while they are shown.
  const memoryTime = (s) => (s.photos.length ? s.photos.length * PHOTO_TIME + (s.note ? 0.8 : 0) : s.note ? NOTE_TIME : 0);
  const holdAt = (i) => {
    const mem = memoryTime(stops[i]) * m;
    const hold = mem ? mem + 0.5 * m : 0.75 * m;
    segments.push({ kind: "hold", t0: t, t1: t + hold, to: i, memory: mem ? { t0: t + 0.25 * m, t1: t + 0.25 * m + mem } : null });
    t += hold;
  };
  if (memoryTime(stops[0])) holdAt(0);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    const km = geoDistance(a.lonlat, b.lonlat) * EARTH_RADIUS_KM;
    const jump = b.newTrip;
    // Ground and sea legs are shorter but slower, and the camera moves in close on them.
    const dur = (jump ? 1.4 : b.mode === "flight" ? clamp(1.5 + km / 5000, 1.6, 4.6) : clamp(2 + km / 2500, 2.2, 4.6)) * m;
    segments.push({ kind: jump ? "jump" : "leg", t0: t, t1: t + dur, from: i - 1, to: i, km, mode: b.mode });
    t += dur;
    holdAt(i);
  }
  const OUTRO = 3 * m;
  segments.push({ kind: "outro", t0: t, t1: t + OUTRO, to: stops.length - 1 });
  const duration = t + OUTRO;

  // Zoom level to use when parked at each stop, based on adjacent leg lengths.
  const stopZoom = stops.map((s, i) => {
    const adj = [];
    if (i > 0) adj.push(geoDistance(stops[i - 1].lonlat, s.lonlat));
    if (i < stops.length - 1) adj.push(geoDistance(s.lonlat, stops[i + 1].lonlat));
    const km = (adj.length ? Math.max(...adj) : 0) * EARTH_RADIUS_KM;
    return clamp(2.9 - km / 3200, 1.15, 2.9);
  });

  // Overview camera: centroid of all stops, zoom to fit their spread.
  const overview = overviewCamera(stops.map((s) => s.lonlat));

  // Distance shown in the HUD: kilometers flown, or traveled when some legs are by land or sea.
  const onlyFlights = segments.every((s) => s.kind !== "leg" || s.mode === "flight");
  const counts = (seg) => seg.kind === "leg" && (!onlyFlights || seg.mode === "flight");

  // Cumulative stats at each stop.
  const cum = [];
  {
    const seenC = new Set();
    const seenCity = new Set();
    let km = 0;
    stops.forEach((s, i) => {
      const seg = segments.find((x) => x.to === i && (x.kind === "leg" || x.kind === "jump"));
      if (seg && counts(seg)) km += seg.km;
      if (s.city.cc) seenC.add(s.city.cc); // a place at sea is in no country
      seenCity.add(s.city.key);
      cum.push({ countries: new Set(seenC), cities: seenCity.size, km });
    });
  }
  const arrival = stops.map((_, i) => (i === 0 ? INTRO * 0.6 : segments.find((s) => s.kind === "hold" && s.to === i).t0));

  // Photos and note of the stop being visited: the card fades in, steps through the photos,
  // and fades out before the next leg.
  function memoryAt(seg, tt) {
    const mem = seg.kind === "hold" && seg.memory;
    if (!mem || tt < mem.t0 || tt > mem.t1) return null;
    const s = stops[seg.to];
    const fade = Math.min(0.35 * m, (mem.t1 - mem.t0) / 4);
    const alpha = easeOut(clamp(Math.min(tt - mem.t0, mem.t1 - tt) / fade, 0, 1));
    const n = s.photos.length;
    const per = n ? (mem.t1 - mem.t0) / n : 1;
    const index = n ? clamp(Math.floor((tt - mem.t0) / per), 0, n - 1) : 0;
    const since = tt - mem.t0 - index * per;
    const mix = index > 0 ? clamp(since / (0.4 * m), 0, 1) : 1;
    return { photos: s.photos, note: s.note, alpha, index, mix };
  }

  function frame(time, width, height, morph = 0) {
    const tt = clamp(time, 0, duration);
    const seg = segments.find((s) => tt >= s.t0 && tt < s.t1) || segments[segments.length - 1];
    const u = clamp((tt - seg.t0) / (seg.t1 - seg.t0), 0, 1);
    let center;
    let k;
    let vehicle = null;
    let current = seg.to;
    let legProgress = 0;
    let date = stops[seg.to].date;

    if (seg.kind === "intro") {
      const e = easeInOut(u);
      center = stops[0].lonlat;
      const from = Math.min(overview.k, 0.95);
      k = lerp(from, stopZoom[0], e);
      center = geoInterpolate(overview.center, stops[0].lonlat)(e);
    } else if (seg.kind === "leg" || seg.kind === "jump") {
      const a = stops[seg.from];
      const b = stops[seg.to];
      const e = easeInOut(u);
      const interp = geoInterpolate(a.lonlat, b.lonlat);
      center = interp(e);
      const base = lerp(stopZoom[seg.from], stopZoom[seg.to], e);
      if (seg.kind === "leg" && seg.mode !== "flight") {
        // Close enough for the leg to span about a quarter of the frame, so its line shows.
        const close = clamp(3800 / Math.max(seg.km, 1), base, 8);
        k = base + (close - base) * Math.sin(Math.PI * e);
      } else {
        const dip = seg.kind === "jump" ? 0.5 : Math.min(0.5, seg.km / 14000);
        k = base * (1 - dip * Math.sin(Math.PI * u));
      }
      current = seg.from;
      legProgress = e;
      if (seg.kind === "leg") vehicle = { lonlat: interp(e), ahead: interp(Math.min(1, e + 0.01)), size: 1, mode: seg.mode };
      date = interpolateDate(a.date, b.date, u);
    } else if (seg.kind === "hold") {
      center = stops[seg.to].lonlat;
      k = stopZoom[seg.to];
    } else {
      const e = easeInOut(u);
      center = geoInterpolate(stops[seg.to].lonlat, overview.center)(e);
      k = lerp(stopZoom[seg.to], overview.k, e);
    }

    const view = cameraToView(center, k, morph, width, height);

    // Route: completed legs, plus the active one.
    const legs = [];
    for (const s of segments) {
      if (s.kind !== "leg") continue;
      let progress = 0;
      if (tt >= s.t1) progress = 1;
      else if (tt >= s.t0) progress = easeInOut((tt - s.t0) / (s.t1 - s.t0));
      if (progress > 0) legs.push({ from: stops[s.from].lonlat, to: stops[s.to].lonlat, progress, fade: 0.55, mode: s.mode });
    }
    const arrived = [];
    stops.forEach((s, i) => {
      if (tt >= arrival[i]) arrived.push({ lonlat: s.lonlat, scale: easeOut(clamp((tt - arrival[i]) / 0.35, 0, 1)) });
    });

    // Countries, and provinces or states, fade in on arrival.
    const reveal = new Set();
    const revealAlpha = new Map();
    const revealRegions = new Map();
    stops.forEach((s, i) => {
      if (tt < arrival[i]) return;
      const a = clamp((tt - arrival[i]) / 0.6, 0, 1);
      reveal.add(s.city.cc);
      revealAlpha.set(s.city.cc, Math.max(revealAlpha.get(s.city.cc) || 0, a));
      if (s.region) revealRegions.set(s.region, Math.max(revealRegions.get(s.region) || 0, a));
    });
    const lastArrived = arrival.reduce((acc, at, i) => (tt >= at ? i : acc), 0);
    const stat = cum[lastArrived];
    const arrivedKeys = new Set(stops.filter((_, i) => tt >= arrival[i]).map((s) => s.city.key));

    return {
      view,
      memory: memoryAt(seg, tt),
      route: { legs, stops: arrived, vehicle },
      reveal,
      revealAlpha,
      revealRegions,
      cityFilter: (c) => arrivedKeys.has(c.key),
      hud: {
        title: title || stops[current].trip,
        trip: stops[current].trip,
        date,
        from: seg.kind === "leg" || seg.kind === "jump" ? stops[seg.from].city.name : null,
        to: stops[seg.to].city.name,
        country: countryById.get(stops[seg.to].city.cc)?.name,
        legKm: seg.kind === "leg" ? seg.km * legProgress : null,
        mode: seg.kind === "leg" ? seg.mode : null,
        flight: seg.kind === "leg" && seg.mode === "flight" ? stops[seg.to].flight : "",
        kmLabel: onlyFlights ? "km flown" : "km traveled",
        countries: stat.countries.size,
        cities: stat.cities,
        km: stat.km + (counts(seg) ? seg.km * legProgress : 0),
        progress: tt / duration,
        outro: seg.kind === "outro" ? easeOut(u) : 0,
        intro: seg.kind === "intro" ? u : 1,
      },
    };
  }

  return { duration, frame, stops };
}

function interpolateDate(a, b, u) {
  if (!a || !b) return a || b;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return new Date(ta + (tb - ta) * u).toISOString().slice(0, 10);
}

function overviewCamera(points) {
  // Mean of unit vectors gives a reasonable center on the sphere.
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lon, lat] of points) {
    const l = (lon * Math.PI) / 180;
    const p = (lat * Math.PI) / 180;
    x += Math.cos(p) * Math.cos(l);
    y += Math.cos(p) * Math.sin(l);
    z += Math.sin(p);
  }
  const n = Math.hypot(x, y, z);
  const center = n < 1e-6 ? points[0] : [(Math.atan2(y, x) * 180) / Math.PI, (Math.asin(z / n) * 180) / Math.PI];
  const spread = Math.max(...points.map((p) => geoDistance(p, center)));
  const k = clamp(1.25 / Math.max(0.35, Math.sin(Math.min(spread, Math.PI / 2)) * 1.25), 0.9, 2.6);
  return { center, k: spread > Math.PI / 2 ? 0.9 : k };
}

export function cameraToView([lon, lat], k, morph, width, height) {
  const view = { lambda: -lon, phi: clamp(-lat, -70, 70), k, ty: 0, morph };
  if (morph > 0) {
    const p = makeProjection({ ...view, phi: 0, morph: 1 }, width, height);
    const pt = p([lon, lat]);
    if (pt) view.ty = height / 2 - pt[1];
  }
  return view;
}

// ---- HUD -------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso) {
  if (!iso) return "";
  const [y, mo, d] = iso.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${d}, ${y}`;
}

// Shown next to the distance of a leg that is not a flight.
const MODE_WORDS = { train: "By train", car: "By car", ship: "By ship" };

export function formatKm(km) {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/** Draws the playback overlay. s = scale relative to a 1080px-tall frame. */
// Shortens text with "…" to fit maxWidth in the current font.
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// "From  →  To" in maxWidth: a short name keeps its length and the other one gives way.
function legLine(ctx, from, to, maxWidth) {
  if (!from) return fit(ctx, to, maxWidth);
  const full = `${from}  →  ${to}`;
  if (ctx.measureText(full).width <= maxWidth) return full;
  const room = maxWidth - ctx.measureText("  →  ").width;
  const fw = ctx.measureText(from).width;
  const tw = ctx.measureText(to).width;
  const a = fit(ctx, from, fw < room / 2 ? fw : tw < room / 2 ? room - tw : room / 2);
  return `${a}  →  ${fit(ctx, to, room - ctx.measureText(a).width)}`;
}

export function drawHud(ctx, width, height, hud, th, accent) {
  const s = Math.min(width, height) / 1080;
  const pad = 64 * s;
  const portrait = height > width;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = clamp(hud.intro * 3, 0, 1);

  // Top-left: trip name and date.
  ctx.fillStyle = th.labelMuted;
  ctx.font = `600 ${20 * s}px ${FONT}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${3 * s}px`;
  ctx.fillText(fit(ctx, (hud.trip || "").toUpperCase(), width - 2 * pad), pad, pad + 20 * s);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.fillStyle = th.label;
  ctx.font = `300 ${64 * s}px ${FONT}`;
  ctx.fillText(formatDate(hud.date), pad - 3 * s, pad + 92 * s);

  // Stats: bottom-right (landscape) or below the leg (portrait).
  const items = [
    [String(hud.countries), hud.countries === 1 ? "country" : "countries"],
    [String(hud.cities), hud.cities === 1 ? "city" : "cities"],
    [Math.round(hud.km).toLocaleString("en-US"), hud.kmLabel || "km flown"],
  ].map(([num, label]) => {
    ctx.font = `400 ${22 * s}px ${FONT}`;
    const lw = ctx.measureText(label).width;
    ctx.font = `600 ${40 * s}px ${FONT}`;
    return [num, label, Math.max(lw, ctx.measureText(num).width)];
  });
  const statsW = items.reduce((sum, it) => sum + it[2], 0) + 48 * s * (items.length - 1);

  // Bottom-left: current leg, shortened to keep clear of the stats.
  const by = height - pad - (portrait ? 160 * s : 0);
  const legMax = portrait ? width - 2 * pad : width - 2 * pad - statsW - 56 * s;
  ctx.font = `600 ${40 * s}px ${FONT}`;
  ctx.fillStyle = th.label;
  ctx.fillText(legLine(ctx, hud.from, hud.to, legMax), pad, by - 34 * s);
  ctx.font = `400 ${24 * s}px ${FONT}`;
  ctx.fillStyle = th.labelMuted;
  const sub = hud.legKm != null ? [hud.flight || MODE_WORDS[hud.mode], formatKm(hud.legKm)].filter(Boolean).join("  ·  ") : hud.country || "";
  ctx.fillText(fit(ctx, sub, legMax), pad, by + 4 * s);

  ctx.textAlign = portrait ? "left" : "right";
  let x = portrait ? pad : width - pad;
  const sy = portrait ? height - pad + 6 * s : by + 4 * s;
  const order = portrait ? items : [...items].reverse();
  for (const [num, label, w] of order) {
    ctx.font = `600 ${40 * s}px ${FONT}`;
    ctx.fillStyle = th.label;
    if (portrait) {
      ctx.fillText(num, x, sy - 34 * s);
      ctx.font = `400 ${22 * s}px ${FONT}`;
      ctx.fillStyle = th.labelMuted;
      ctx.fillText(label, x, sy);
      x += w + 48 * s;
    } else {
      ctx.fillText(num, x, sy - 38 * s);
      ctx.font = `400 ${22 * s}px ${FONT}`;
      ctx.fillStyle = th.labelMuted;
      ctx.fillText(label, x, sy);
      x -= w + 48 * s;
    }
  }
  ctx.textAlign = "left";

  // Progress line.
  ctx.globalAlpha = 1;
  ctx.fillStyle = withAlpha(accent, 0.18);
  ctx.fillRect(0, height - 4 * s, width, 4 * s);
  ctx.fillStyle = accent;
  ctx.fillRect(0, height - 4 * s, width * hud.progress, 4 * s);
  ctx.restore();
}
