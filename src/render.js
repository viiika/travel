import {
  geoPath,
  geoProjection,
  geoOrthographicRaw,
  geoEqualEarthRaw,
  geoGraticule10,
  geoDistance,
  geoInterpolate,
} from "d3-geo";
import { countries, land, borders, cities, cityByKey, customPlaces, countryAtLonLat, waterLabels, countryById, regionById, regionsByCountry, regionMesh, regionZoom } from "./data.js";
import { drawSpace, spaceShift, earthAsPlanet, bodyById } from "./space.js";

const EE_HALF_WIDTH = 2.7066; // x extent of the raw Equal Earth projection at lambda = pi
const EE_HALF_HEIGHT = 1.3173;

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const THEMES = {
  light: {
    bg: "#f4f3ef",
    ocean: "#dde6ee",
    oceanEdge: "#cfdae5",
    land: "#fbfaf7",
    border: "rgba(80, 90, 105, 0.28)",
    regionBorder: "rgba(80, 90, 105, 0.2)",
    coast: "rgba(80, 95, 115, 0.45)",
    graticule: "rgba(60, 80, 110, 0.07)",
    label: "#3d434c",
    labelMuted: "#8a919b",
    halo: "rgba(251, 250, 247, 0.9)",
    water: "#7f98ae",
    city: "#7b828c",
    shade: "rgba(30, 50, 80, 0.10)",
    glow: "rgba(120, 150, 190, 0.18)",
    hover: "rgba(30, 40, 60, 0.10)",
    route: "#1f2937",
    card: "#ffffff",
    cardLine: "rgba(30, 40, 60, 0.08)",
    orbit: "rgba(60, 80, 110, 0.13)",
  },
  dark: {
    bg: "#0b0f15",
    ocean: "#0f1823",
    oceanEdge: "#142130",
    land: "#1e2631",
    border: "rgba(160, 175, 195, 0.18)",
    regionBorder: "rgba(160, 175, 195, 0.14)",
    coast: "rgba(160, 180, 205, 0.28)",
    graticule: "rgba(170, 200, 255, 0.05)",
    label: "#d5dbe3",
    labelMuted: "#7d8794",
    halo: "rgba(11, 15, 21, 0.85)",
    water: "#4d6a86",
    city: "#8b96a5",
    shade: "rgba(0, 0, 0, 0.28)",
    glow: "rgba(90, 140, 220, 0.22)",
    hover: "rgba(255, 255, 255, 0.10)",
    route: "#f3f4f6",
    card: "#2a3442",
    cardLine: "rgba(255, 255, 255, 0.10)",
    orbit: "rgba(170, 200, 255, 0.12)",
    stars: true,
  },
};

const CONTINENT_COLORS = {
  Africa: "#d98c3f",
  Asia: "#d9534f",
  Europe: "#4a7fd4",
  "North America": "#2fa37d",
  "South America": "#8bb33b",
  Oceania: "#16a2b8",
  Antarctica: "#9aa5b1",
};

// ---- Camera / projection ---------------------------------------------------

// view: { lambda, phi, k, ty, morph }  morph 0 = globe, 1 = flat
export function makeProjection(view, width, height) {
  const t = Math.max(0, Math.min(1, view.morph));
  const raw = t <= 0 ? geoOrthographicRaw : t >= 1 ? geoEqualEarthRaw : blendRaw(t);
  const w = width - 2 * Math.abs(view.ox || 0);
  const hgt = height - 2 * Math.abs(view.oy || 0);
  const globeScale = Math.min(w, hgt) * 0.42;
  const flatScale = Math.min((w * 0.96) / (2 * EE_HALF_WIDTH), (hgt * 0.94) / (2 * EE_HALF_HEIGHT));
  const scale = (globeScale + (flatScale - globeScale) * t) * view.k;
  // Zoomed far out, the Earth moves aside so that the Sun comes into the middle (see space.js).
  const [sx, sy] = spaceShift(view.k, scale, t);
  const p = geoProjection(raw)
    .scale(scale)
    .translate([width / 2 + (view.ox || 0) + sx, height / 2 + (view.oy || 0) + (view.ty || 0) * t + sy])
    .rotate([view.lambda, view.phi * (1 - t), 0])
    .precision(0.4);
  if (t < 1) p.clipAngle(90 + 89.9 * t * t * t);
  p.isGlobe = t < 0.5;
  p.morph = t;
  return p;
}

function blendRaw(t) {
  const f = (x, y) => {
    const a = geoOrthographicRaw(x, y);
    const b = geoEqualEarthRaw(x, y);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  return f;
}

export function viewCenter(view) {
  return [-view.lambda, -view.phi];
}

// Whether a lon/lat point is on the visible side of the globe.
// `margin` (radians) hides points close to the limb, e.g. for labels.
export function isVisible(projection, lonlat, margin = 0.03) {
  if (projection.morph >= 1) return true;
  const r = projection.rotate();
  const limit = ((90 + 89.9 * projection.morph ** 3) * Math.PI) / 180;
  return geoDistance(lonlat, [-r[0], -r[1]]) < limit - margin;
}

// ---- Colors ----------------------------------------------------------------

export function countryColor(id, state, firstVisits) {
  const entry = state.countries[id];
  if (!entry) return null;
  if (entry.color) return entry.color;
  const mode = state.settings.colorMode;
  if (mode === "continent") return CONTINENT_COLORS[countryById.get(id).continent] || state.settings.accent;
  if (mode === "year") {
    const d = firstVisits.get(id);
    if (!d) return mix(state.settings.accent, "#9aa5b1", 0.6);
    const years = [...firstVisits.values()].map((v) => +v.slice(0, 4));
    const lo = Math.min(...years);
    const hi = Math.max(...years);
    const f = hi === lo ? 1 : (+d.slice(0, 4) - lo) / (hi - lo);
    return mix("#f2d6a2", state.settings.accent, 0.25 + 0.75 * f);
  }
  return state.settings.accent;
}

export function yearLegend(state, firstVisits) {
  const years = [...new Set([...firstVisits.values()].map((v) => +v.slice(0, 4)))].sort();
  if (!years.length) return [];
  const lo = years[0];
  const hi = years[years.length - 1];
  return years.map((y) => [y, mix("#f2d6a2", state.settings.accent, 0.25 + 0.75 * (hi === lo ? 1 : (y - lo) / (hi - lo)))]);
}

export { CONTINENT_COLORS };

export function mix(a, b, t) {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function hex(h) {
  if (h.startsWith("rgb")) return h.match(/\d+/g).slice(0, 3).map(Number);
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

export function withAlpha(color, a) {
  const [r, g, b] = hex(color);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---- Drawing ---------------------------------------------------------------

const graticule = geoGraticule10();
// Tiny disputed or administrative areas that would only clutter the map unless visited.
const NO_LABEL = new Set(["BRI", "BRT", "SCR", "ESB", "WSB", "USG", "PGA", "CLP", "CSI", "ATC", "KAS"]);
const SPHERE = { type: "Sphere" };
// Opacity of a visited country with visited regions, relative to a fully visited one.
const REGION_TINT = 0.3;

// Draws with the canvas clipped to a country's outline.
function withinCountry(ctx, path, cc, draw) {
  ctx.save();
  ctx.beginPath();
  path(countryById.get(cc).feature);
  ctx.clip();
  draw();
  ctx.restore();
}

/**
 * Draws the full map into ctx (already scaled to CSS pixels).
 * opts: { width, height, view, theme, state, firstVisits, hoverId, hoverRegion, hoverCity, selectedId,
 *         selectedRegion, selectedCity, regionsOf, route, reveal, revealAlpha, revealRegions, ui }
 *   regionsOf: optional id of a country whose region borders are drawn (the selection is in it).
 *   reveal: optional Set of country ids to color (used by playback); otherwise all visited.
 *   revealRegions: optional Map of region ids to color, to their opacity; otherwise all visited.
 *   route:  optional { legs: [{ from, to, progress, mode }], vehicle: { lonlat, ahead, mode } }
 * Returns { projection, cityHits, space } for hit testing.
 */
export function drawMap(ctx, opts) {
  const { width, height, view, theme: th, state, firstVisits } = opts;
  const scaleUI = opts.uiScale || 1;
  const projection = makeProjection(view, width, height);
  const path = geoPath(projection, ctx);
  const isFlat = projection.morph >= 1;

  ctx.save();
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, width, height);

  // Zoomed far out: the Moon, the Sun and the planets.
  const space = drawSpace(ctx, projection, width, height, view.k, {
    theme: th,
    accent: state.settings.accent,
    visited: new Set(Object.keys(state.bodies || {})),
    hover: opts.hoverBody,
    selected: opts.selectedBody,
    dark: !!th.stars,
    uiScale: scaleUI,
    font: FONT,
  });

  // Atmosphere glow behind the globe.
  if (!isFlat) {
    const [cx, cy] = projection.translate();
    const r = projection.scale();
    const glow = ctx.createRadialGradient(cx, cy, r * 0.98, cx, cy, r * 1.18);
    glow.addColorStop(0, withAlphaRaw(th.glow, 1));
    glow.addColorStop(1, withAlphaRaw(th.glow, 0));
    ctx.globalAlpha = 1 - projection.morph;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Ocean.
  ctx.beginPath();
  path(SPHERE);
  ctx.fillStyle = th.ocean;
  ctx.fill();

  if (state.settings.graticule) {
    ctx.beginPath();
    path(graticule);
    ctx.strokeStyle = th.graticule;
    ctx.lineWidth = 0.6 * scaleUI;
    ctx.stroke();
  }

  // Land.
  ctx.beginPath();
  path(land);
  ctx.fillStyle = th.land;
  ctx.fill();

  // Visited provinces and states, by country. `revealRegions` (id -> opacity) limits them to
  // those reached so far.
  const showRegions = state.settings.showRegions !== false;
  const regionFill = new Map();
  if (showRegions)
    for (const id of Object.keys(state.regions || {})) {
      const r = regionById.get(id);
      if (!r || (opts.revealRegions && !opts.revealRegions.has(id))) continue;
      if (!regionFill.has(r.cc)) regionFill.set(r.cc, []);
      regionFill.get(r.cc).push(r);
    }

  // Visited countries. A country with visited regions is tinted, and those regions are colored.
  const reveal = opts.reveal;
  for (const c of countries) {
    if (!state.countries[c.id]) continue;
    if (reveal && !reveal.has(c.id)) continue;
    const color = countryColor(c.id, state, firstVisits);
    const alpha = reveal && opts.revealAlpha ? opts.revealAlpha.get(c.id) ?? 1 : 1;
    const parts = regionFill.get(c.id);
    ctx.beginPath();
    path(c.feature);
    ctx.globalAlpha = 0.82 * alpha * (parts ? REGION_TINT : 1);
    ctx.fillStyle = color;
    ctx.fill();
    if (parts) {
      // Region and country outlines are simplified separately; the country's outline wins.
      ctx.save();
      ctx.clip();
      for (const r of parts) {
        ctx.beginPath();
        path(r.feature);
        ctx.globalAlpha = 0.82 * (opts.revealRegions?.get(r.id) ?? alpha);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Hover.
  if (opts.hoverId) {
    const c = countryById.get(opts.hoverId);
    ctx.beginPath();
    path(c.feature);
    ctx.fillStyle = th.hover;
    ctx.fill();
  }
  const hoverRegion = opts.hoverRegion && regionById.get(opts.hoverRegion);
  if (hoverRegion) {
    withinCountry(ctx, path, hoverRegion.cc, () => {
      ctx.beginPath();
      path(hoverRegion.feature);
      ctx.fillStyle = th.hover;
      ctx.fill();
    });
  }

  // Borders between regions: in countries with visited regions, in the country the selection is
  // in (whose regions the map points at), and in the others once zoomed in far enough.
  if (showRegions) {
    ctx.beginPath();
    for (const [cc] of regionsByCountry)
      if (regionFill.has(cc) || (!opts.hideUnvisitedCities && (cc === opts.regionsOf || view.k >= regionZoom(countryById.get(cc))))) path(regionMesh(cc));
    ctx.strokeStyle = th.regionBorder;
    ctx.lineWidth = 0.5 * scaleUI;
    ctx.stroke();
  }

  // Borders and coastlines.
  ctx.beginPath();
  path(borders);
  ctx.strokeStyle = th.border;
  ctx.lineWidth = 0.6 * scaleUI;
  ctx.stroke();
  ctx.beginPath();
  path(land);
  ctx.strokeStyle = th.coast;
  ctx.lineWidth = 0.7 * scaleUI;
  ctx.stroke();

  if (opts.hoverId) {
    ctx.beginPath();
    path(countryById.get(opts.hoverId).feature);
    ctx.strokeStyle = th.label;
    ctx.lineWidth = 1 * scaleUI;
    ctx.stroke();
  }

  if (hoverRegion) {
    withinCountry(ctx, path, hoverRegion.cc, () => {
      ctx.beginPath();
      path(hoverRegion.feature);
      ctx.strokeStyle = th.label;
      ctx.lineWidth = 1 * scaleUI;
      ctx.stroke();
    });
  }

  // Selected region (shown with the place card).
  const selRegion = opts.selectedRegion && regionById.get(opts.selectedRegion);
  if (selRegion) {
    withinCountry(ctx, path, selRegion.cc, () => {
      ctx.beginPath();
      path(selRegion.feature);
      ctx.fillStyle = th.hover;
      ctx.fill();
      ctx.strokeStyle = state.settings.accent;
      ctx.lineWidth = 1.6 * scaleUI;
      ctx.lineJoin = "round";
      ctx.stroke();
    });
  }

  // Selected country (shown with the place card).
  if (opts.selectedId) {
    ctx.beginPath();
    path(countryById.get(opts.selectedId).feature);
    ctx.fillStyle = th.hover;
    ctx.fill();
    ctx.strokeStyle = state.settings.accent;
    ctx.lineWidth = 1.6 * scaleUI;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // Globe shading: soft light from the upper left, darker limb.
  if (!isFlat) {
    const [cx, cy] = projection.translate();
    const r = projection.scale();
    const shade = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    shade.addColorStop(0, "rgba(255,255,255,0.07)");
    shade.addColorStop(0.7, "rgba(255,255,255,0)");
    shade.addColorStop(1, th.shade);
    ctx.globalAlpha = 1 - projection.morph;
    ctx.beginPath();
    path(SPHERE);
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  path(SPHERE);
  ctx.strokeStyle = th.oceanEdge;
  ctx.lineWidth = 1 * scaleUI;
  ctx.stroke();

  // Routes. Their vehicle icons are drawn last, above the labels.
  const icons = [];
  if (opts.route) drawRoute(ctx, path, projection, opts.route, th, state, scaleUI, icons);

  // Zoomed far out, the Earth is one of the planets: it is named and picked as a whole instead
  // of by its places.
  if (!isFlat && space.length && earthAsPlanet(view.k, projection.scale(), projection.morph)) {
    const [cx, cy] = projection.translate();
    const r = projection.scale();
    // A blue planet, lit from the Sun like the others.
    const sun = space.find((p) => p.body.id === "sun");
    const len = sun ? Math.hypot(sun.x - cx, sun.y - cy) || 1 : 1;
    const [lx, ly] = sun ? [(sun.x - cx) / len, (sun.y - cy) / len] : [-0.6, -0.6];
    const shade = ctx.createRadialGradient(cx + lx * r * 0.45, cy + ly * r * 0.45, r * 0.1, cx, cy, r * 1.15);
    shade.addColorStop(0, th.stars ? "rgba(120, 175, 255, 0.55)" : "rgba(255, 255, 255, 0.35)");
    shade.addColorStop(0.55, th.stars ? "rgba(70, 130, 230, 0.35)" : "rgba(90, 140, 210, 0.12)");
    shade.addColorStop(1, "rgba(10, 15, 30, 0.45)");
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = shade;
    ctx.fill();
    // A ring when it is pointed at or selected, as for the other planets.
    const ring = opts.selectedBody === "earth" ? 1 : opts.hoverBody === "earth" ? 0.6 : 0;
    if (ring) {
      ctx.globalAlpha = ring;
      ctx.strokeStyle = opts.selectedBody === "earth" ? state.settings.accent : th.label;
      ctx.lineWidth = 1.6 * scaleUI;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4 * scaleUI, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.font = `500 ${11 * scaleUI}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3 * scaleUI;
    ctx.strokeStyle = th.halo;
    ctx.fillStyle = th.label;
    const ty = cy + r + (ring ? 8 : 5) * scaleUI;
    ctx.strokeText("Earth", cx, ty);
    ctx.fillText("Earth", cx, ty);
    ctx.restore();
    return { projection, cityHits: [], space: [...space, { body: bodyById.get("earth"), x: cx, y: cy, r }] };
  }

  // Labels and cities.
  const labels = new LabelLayer(scaleUI);
  const cityHits = [];
  const k = view.k;
  const labelsOn = state.settings.labels;
  const visitedCities = state.cities;
  const showCity = opts.cityFilter;

  // City dots: visited cities always, others depending on zoom.
  const maxOthers = opts.hideUnvisitedCities ? 0 : Math.round(25 * k * k);
  const cityCandidates = [];
  let shown = 0;
  // Smaller places are drawn only once the user has added them.
  const added = Object.keys(visitedCities)
    .map((key) => cityByKey.get(key))
    .filter((c) => c && !c.major);
  // A selected place is drawn even when it is a small place or the map is zoomed out.
  const selected = (opts.selectedCity && cityByKey.get(opts.selectedCity)) || null;
  const extra = selected && !visitedCities[selected.key] ? [selected] : [];
  const seen = new Set();
  // The user's own places are always drawn, like the cities they have added.
  for (const c of extra.concat(added, [...customPlaces.values()], cities)) {
    if (seen.has(c)) continue;
    seen.add(c);
    const visited = !!visitedCities[c.key];
    const isSel = c === selected;
    if (showCity && !showCity(c)) continue;
    if (!visited && !isSel && (c.custom ? opts.hideUnvisitedCities : (shown >= maxOthers || !labelsOn.cities))) continue;
    const ll = [c.lon, c.lat];
    if (!isVisible(projection, ll)) continue;
    const pt = projection(ll);
    if (!pt || pt[0] < -20 || pt[1] < -20 || pt[0] > width + 20 || pt[1] > height + 20) continue;
    if (!visited && !isSel && !c.custom) shown++;
    cityCandidates.push({ c, pt, visited });
  }

  // Draw dots (unvisited first so visited sit on top, and the user's own places above cities).
  cityCandidates.sort((a, b) => a.visited - b.visited || !!a.c.custom - !!b.c.custom);
  for (const { c, pt, visited } of cityCandidates) {
    const r = (visited ? 3.2 : c.custom ? 2.4 : c.capital ? 2.1 : 1.6) * scaleUI;
    ctx.beginPath();
    cityMark(ctx, pt, r, c.custom);
    if (visited) {
      const col = countryColor(c.cc, state, firstVisits) || state.settings.accent;
      ctx.fillStyle = th.halo;
      ctx.fill();
      ctx.beginPath();
      cityMark(ctx, pt, r * 0.72, c.custom);
      ctx.fillStyle = darken(col);
      ctx.fill();
    } else {
      ctx.fillStyle = th.city;
      ctx.fill();
    }
    cityHits.push({ c, x: pt[0], y: pt[1], visited });
    if (opts.hoverCity === c.key || opts.selectedCity === c.key) {
      const sel = opts.selectedCity === c.key;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], r + (sel ? 4 : 3) * scaleUI, 0, Math.PI * 2);
      ctx.strokeStyle = sel ? state.settings.accent : th.label;
      ctx.lineWidth = (sel ? 1.8 : 1) * scaleUI;
      ctx.stroke();
    }
  }

  // Label priorities: visited cities > country names > other cities > water.
  ctx.textBaseline = "middle";
  if (selected) {
    const sel = cityCandidates.find((x) => x.c === selected);
    if (sel) labels.place(ctx, shortName(selected.name), sel.pt[0] + 8 * scaleUI, sel.pt[1], { size: 12, weight: 650, color: th.label, halo: th.halo, align: "left" });
  }
  if (labelsOn.cities) {
    for (const { c, pt } of cityCandidates.filter((x) => x.visited && x.c !== selected).sort((a, b) => !!b.c.custom - !!a.c.custom)) {
      labels.place(ctx, shortName(c.name), pt[0] + 6 * scaleUI, pt[1], { size: 11.5, weight: 600, color: th.label, halo: th.halo, align: "left" });
    }
  }
  if (labelsOn.countries) {
    const maxRank = 1.5 + k * 2.2;
    const list = countries
      .filter((c) => !NO_LABEL.has(c.id) || state.countries[c.id])
      .filter((c) => (c.rank <= maxRank && (c.counted || c.rank <= 2 || k > 3)) || (state.countries[c.id] && c.rank <= maxRank + 2))
      .sort((a, b) => !!state.countries[b.id] - !!state.countries[a.id] || a.rank - b.rank || b.pop - a.pop);
    for (const c of list) {
      if (!isVisible(projection, c.label, 0.22)) continue;
      const pt = projection(c.label);
      if (!pt) continue;
      const visited = !!state.countries[c.id];
      const size = c.rank <= 2 ? 11 : c.rank <= 4 ? 10 : 9;
      labels.place(ctx, c.name.toUpperCase(), pt[0], pt[1], {
        size,
        weight: visited ? 650 : 500,
        color: visited ? th.label : th.labelMuted,
        halo: th.halo,
        align: "center",
        tracking: 0.08,
      });
    }
  }
  if (labelsOn.cities) {
    for (const { c, pt } of cityCandidates.filter((x) => !x.visited).sort((a, b) => !!b.c.custom - !!a.c.custom || b.c.pop - a.c.pop)) {
      labels.place(ctx, shortName(c.name), pt[0] + 5 * scaleUI, pt[1], { size: 10.5, weight: 400, color: th.labelMuted, halo: th.halo, align: "left" });
    }
  }
  if (labelsOn.water) {
    for (const w of waterLabels) {
      if (k < w.min) continue;
      if (!isVisible(projection, [w.lon, w.lat], 0.22)) continue;
      const pt = projection([w.lon, w.lat]);
      if (!pt) continue;
      labels.place(ctx, w.name, pt[0], pt[1], { size: w.min === 0 ? 12 : 10, weight: 400, color: th.water, italic: true, align: "center", tracking: w.min === 0 ? 0.18 : 0.06 });
    }
  }
  for (const draw of icons) draw();

  ctx.restore();
  return { projection, cityHits, space };
}

// A city is a dot; a place of the user's own is a diamond.
function cityMark(ctx, [x, y], r, custom) {
  if (!custom) return ctx.arc(x, y, r, 0, Math.PI * 2);
  const d = r * 1.3;
  ctx.moveTo(x, y - d);
  ctx.lineTo(x + d, y);
  ctx.lineTo(x, y + d);
  ctx.lineTo(x - d, y);
  ctx.closePath();
}

function darken(color) {
  return mix(color, "#000000", 0.18);
}

function withAlphaRaw(rgba, a) {
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) return rgba;
  const [r, g, b, a0 = 1] = m[1].split(",").map((s) => parseFloat(s));
  return `rgba(${r}, ${g}, ${b}, ${a0 * a})`;
}

// Greedy label placement with simple rectangle collision.
class LabelLayer {
  constructor(scale) {
    this.boxes = [];
    this.scale = scale;
  }
  place(ctx, text, x, y, o) {
    const s = this.scale;
    const size = o.size * s;
    ctx.font = `${o.italic ? "italic " : ""}${o.weight} ${size}px ${FONT}`;
    const tracking = (o.tracking || 0) * size;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${tracking}px`;
    const w = ctx.measureText(text).width;
    const h = size * 1.2;
    let x0 = o.align === "center" ? x - w / 2 : x;
    const box = [x0 - 2 * s, y - h / 2, x0 + w + 2 * s, y + h / 2];
    for (const b of this.boxes) if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) return false;
    this.boxes.push(box);
    ctx.textAlign = "left";
    if (o.halo) {
      ctx.strokeStyle = o.halo;
      ctx.lineWidth = 3 * s;
      ctx.lineJoin = "round";
      ctx.strokeText(text, x0, y);
    }
    ctx.fillStyle = o.color;
    ctx.fillText(text, x0, y);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    return true;
  }
}

// ---- Routes ----------------------------------------------------------------

function arcCoords(a, b, upto = 1) {
  const interp = geoInterpolate(a, b);
  const n = Math.max(2, Math.ceil(64 * upto));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(interp((i / n) * upto));
  return pts;
}

// Line style per way of travel: flights solid, trains as railway lines (a line with cross
// ties), car trips dashed, ship crossings dotted. Ground and sea legs sit on a light casing,
// which keeps them readable over countries filled with the same color.
function strokeLeg(ctx, mode, color, width, th, s, casing) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (mode && mode !== "flight") {
    ctx.strokeStyle = withAlphaRaw(th.halo, casing);
    ctx.lineWidth = width + (mode === "train" ? 4.6 : 2.6) * s;
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  if (mode === "train") {
    ctx.lineCap = "butt";
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.setLineDash([1.3 * s, 4.2 * s]);
    ctx.lineWidth = width + 3.6 * s;
    ctx.stroke();
  } else if (mode === "car") {
    ctx.setLineDash([6 * s, 4.5 * s]);
    ctx.lineWidth = width;
    ctx.stroke();
  } else if (mode === "ship") {
    ctx.setLineDash([0.1, 5 * s]);
    ctx.lineWidth = width + 1 * s;
    ctx.stroke();
  } else {
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawRoute(ctx, path, projection, route, th, state, s, icons) {
  const accent = state.settings.accent;
  const color = route.color || accent;
  for (const leg of route.legs) {
    if (leg.progress <= 0) continue;
    const coords = arcCoords(leg.from, leg.to, Math.min(1, leg.progress));
    const done = leg.progress >= 1;
    ctx.beginPath();
    path({ type: "LineString", coordinates: coords });
    strokeLeg(ctx, leg.mode, done ? withAlpha(color, leg.fade ?? 0.75) : color, (done ? 1.6 : 2.4) * s, th, s, done ? 0.5 : 0.8);
  }
  // Ground and sea legs carry a small icon at their middle when there is room for it.
  if (route.legIcons) {
    for (const leg of route.legs) {
      if (!leg.mode || leg.mode === "flight") continue;
      const mid = geoInterpolate(leg.from, leg.to)(0.5);
      if (!isVisible(projection, mid)) continue;
      const a = projection(leg.from);
      const b = projection(leg.to);
      const m = projection(mid);
      if (!a || !b || !m || Math.hypot(b[0] - a[0], b[1] - a[1]) < 70 * s) continue;
      icons.push(() => drawVehicle(ctx, m, Math.atan2(b[1] - a[1], b[0] - a[0]), leg.mode, th, color, s * 0.75));
    }
  }
  // Stop markers.
  for (const st of route.stops || []) {
    if (!isVisible(projection, st.lonlat)) continue;
    const p = projection(st.lonlat);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 4.2 * s * (st.scale ?? 1), 0, Math.PI * 2);
    ctx.fillStyle = th.halo;
    ctx.fill();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = route.color || accent;
    ctx.stroke();
  }
  const v = route.vehicle;
  if (v && isVisible(projection, v.lonlat)) {
    const p = projection(v.lonlat);
    const q = projection(v.ahead);
    if (p && q) icons.push(() => drawVehicle(ctx, p, Math.atan2(q[1] - p[1], q[0] - p[0]), v.mode, th, color, s * (v.size || 1)));
  }
}

// Plane silhouette pointing right (+x), unit size ~ 1.
const PLANE = new Path2D(
  "M10 0 C10 -0.9 9.2 -1.3 8.4 -1.3 L3 -1.3 L-2.2 -8.6 L-4.1 -8.6 L-1.2 -1.3 L-6 -1.3 L-7.8 -3.6 L-9.2 -3.6 L-8.1 0 L-9.2 3.6 L-7.8 3.6 L-6 1.3 L-1.2 1.3 L-4.1 8.6 L-2.2 8.6 L3 1.3 L8.4 1.3 C9.2 1.3 10 0.9 10 0 Z"
);

// Side views facing right (+x), about 20 units long, standing on y = 0..4.
const TRAIN = new Path2D(
  "M-10 3.2 L-10 -3.6 C-10 -4.4 -9.4 -5 -8.6 -5 L3.2 -5 C6.6 -5 9.3 -2.6 10 0.6 C10.2 1.5 10.2 2.4 10 3.2 Z M-7.6 -3.2 L-7.6 -1 L-4.6 -1 L-4.6 -3.2 Z M-3 -3.2 L-3 -1 L0 -1 L0 -3.2 Z M1.6 -3.2 L1.6 -1 L4.2 -1 C5.4 -1 6.6 -0.6 7.4 0 C7 -1.8 5.4 -3.2 3.2 -3.2 Z M-9 4.2 L9 4.2 L9 5 L-9 5 Z"
);
const CAR = new Path2D(
  "M-10 2.6 L-10 -0.4 C-10 -1.2 -9.5 -1.6 -8.8 -1.8 L-5.6 -2.4 L-3 -5.2 C-2.6 -5.6 -2.1 -5.8 -1.6 -5.8 L3.6 -5.8 C4.2 -5.8 4.7 -5.5 5 -5 L6.8 -2.4 L8.8 -1.9 C9.5 -1.7 10 -1.1 10 -0.4 L10 2.6 Z M-4.2 -2.4 L-0.6 -2.4 L-0.6 -4.4 L-2.2 -4.4 Z M0.8 -2.4 L5.2 -2.4 L3.8 -4.4 L0.8 -4.4 Z"
);
const WHEELS = new Path2D("M-3 4 A2.5 2.5 0 1 0 -8 4 A2.5 2.5 0 1 0 -3 4 Z M8 4 A2.5 2.5 0 1 0 3 4 A2.5 2.5 0 1 0 8 4 Z");
const SHIP = new Path2D(
  "M-10 0.4 L10 0.4 L7.4 4.8 L-7.8 4.8 Z M-6 0.4 L-6 -2.8 L5 -2.8 L5 0.4 Z M-4.4 -2.8 L-4.4 -4.6 L3.6 -4.6 L3.6 -2.8 Z M0 -4.6 L0 -8 L2.4 -8 L2.4 -4.6 Z"
);
const SIDE_VIEWS = { train: [TRAIN], car: [CAR, WHEELS], ship: [SHIP] };

/** Draws the moving plane, train, car or ship at p, heading at `angle` (radians). */
function drawVehicle(ctx, p, angle, mode, th, color, s) {
  ctx.save();
  ctx.translate(p[0], p[1]);
  const side = SIDE_VIEWS[mode];
  if (side) {
    // Ground vehicles stay upright: mirror when heading left, tilt gently with the route.
    const left = Math.cos(angle) < 0;
    const tilt = Math.max(-0.35, Math.min(0.35, left ? Math.atan2(-Math.sin(angle), -Math.cos(angle)) : angle));
    ctx.rotate(tilt);
    ctx.scale((left ? -1 : 1) * 1.6 * s, 1.6 * s);
    ctx.translate(0, -1);
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = th.halo;
    for (const part of side) ctx.stroke(part);
    ctx.fillStyle = th.route;
    for (const part of side) ctx.fill(part, "evenodd");
  } else {
    ctx.rotate(angle);
    ctx.scale(1.5 * s, 1.5 * s);
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 6 * s;
    ctx.shadowOffsetY = 2 * s;
    ctx.fillStyle = th.route;
    ctx.fill(PLANE);
  }
  ctx.restore();
}

// ---- Hit testing -----------------------------------------------------------

export function countryAt(projection, x, y) {
  if (!projection.invert) return null;
  const ll = projection.invert([x, y]);
  if (!ll || Number.isNaN(ll[0])) return null;
  if (projection.morph < 1) {
    const [cx, cy] = projection.translate();
    if (Math.hypot(x - cx, y - cy) > projection.scale()) return null;
  }
  return countryAtLonLat(ll);
}

// Map labels of the user's own places (up to 80 characters) are shortened.
const LABEL_MAX = 32;
const shortName = (name) => (name.length > LABEL_MAX ? `${name.slice(0, LABEL_MAX - 1).trimEnd()}…` : name);

export function cityAt(cityHits, x, y, radius = 7) {
  let best = null;
  let bestD = radius;
  // Hits are in drawing order: of two marks at the same spot, the one drawn on top wins.
  for (const h of cityHits) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d <= bestD) {
      bestD = d;
      best = h.c;
    }
  }
  return best;
}
