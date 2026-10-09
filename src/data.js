import { feature, mesh, merge } from "topojson-client";
import { geoBounds, geoCentroid, geoContains, geoDistance } from "d3-geo";
import topo from "../data/build/countries.topo.json";
import cityRows from "../data/build/cities.json";
import extraRows from "../data/build/cities-extra.json";
import regionTopo from "../data/build/regions.topo.json";
import regionFixes from "../data/build/region-fixes.json";
import { findRegion, CITY_NEAR_KM } from "./regionlookup.js";

const obj = topo.objects.countries;

export const countries = feature(topo, obj).features.map((f) => {
  const p = f.properties;
  return {
    id: p.id,
    name: p.name,
    continent: p.continent === "Seven seas (open ocean)" ? "Oceania" : p.continent,
    region: p.region,
    type: p.type,
    pop: p.pop,
    rank: p.rank,
    label: [p.lx, p.ly],
    feature: f,
    bounds: geoBounds(f),
    centroid: geoCentroid(f),
  };
});

export const countryById = new Map(countries.map((c) => [c.id, c]));

// Land outline and internal borders, used for drawing only.
export const land = merge(topo, obj.geometries);
export const borders = mesh(topo, obj, (a, b) => a !== b);

// Countries counted toward "% of the world": independent states as recognized by the
// United States. Territories and disputed areas are listed and counted with them as
// countries and regions, but left out of the share of the world.
const STATE_TYPES = new Set(["Sovereign country", "Country", "Sovereignty"]);
const NOT_STATES = new Set(["SXM", "HKG", "GRL", "CUW", "ABW", "JEY", "GGY", "IMN", "ALD", "MAC", "TWN"]);
const EXTRA_STATES = new Set(["ISR", "KOS"]);
for (const c of countries) c.counted = (STATE_TYPES.has(c.type) && !NOT_STATES.has(c.id)) || EXTRA_STATES.has(c.id);
export const countedTotal = countries.filter((c) => c.counted).length;

export const CONTINENTS = ["Africa", "Antarctica", "Asia", "Europe", "North America", "Oceania", "South America"];

// Major cities (all capitals plus the most populous) are drawn on the map by default.
export const cities = cityRows.map(([name, cc, lon, lat, pop, capital, rank]) => ({
  key: `${cc}:${name}`,
  name,
  cc,
  lon,
  lat,
  pop,
  capital: !!capital,
  rank,
  major: true,
}));

// Smaller places (GeoNames, 5,000+ people) are searchable and appear only once added.
export const extraCities = extraRows.map(([id, name, cc, lon, lat, pop]) => ({
  key: `g${id}`,
  name,
  cc,
  lon,
  lat,
  pop,
  capital: false,
  major: false,
}));

export const allCities = cities.concat(extraCities);
for (const c of allCities) c.norm = normalize(c.name);
export const cityByKey = new Map(allCities.map((c) => [c.key, c]));

// Places the user put on the map themselves (keys "p:…"). They behave like cities and are also
// registered in cityByKey; state.js keeps both in step with the travel data.
export const customPlaces = new Map();

/** The country containing a lon/lat point, or null at sea. */
export function countryAtLonLat([lon, lat]) {
  for (const c of countries) {
    const [[x0, y0], [x1, y1]] = c.bounds;
    if (lat < y0 || lat > y1) continue;
    if (x0 <= x1 ? lon < x0 || lon > x1 : lon < x0 && lon > x1) continue;
    if (geoContains(c.feature, [lon, lat])) return c;
  }
  return null;
}

// ---- Provinces and states ---------------------------------------------------

// Provinces, states and the like for the countries where people often count them. Ids are
// ISO 3166-2 codes ("US-CA"). REGION_UNITS names them for each country (singular, plural);
// territories and cities at the same level go by the same word.
export const REGION_UNITS = {
  USA: ["state", "states"],
  CHN: ["province", "provinces"],
  CAN: ["province", "provinces"],
  AUS: ["state", "states"],
  BRA: ["state", "states"],
  IND: ["state", "states"],
  RUS: ["region", "regions"],
  MEX: ["state", "states"],
  JPN: ["prefecture", "prefectures"],
  DEU: ["state", "states"],
  FRA: ["region", "regions"],
  ITA: ["region", "regions"],
  ESP: ["community", "communities"],
  GBR: ["nation", "nations"],
  ARG: ["province", "provinces"],
  IDN: ["province", "provinces"],
  ZAF: ["province", "provinces"],
  KOR: ["province", "provinces"],
  TUR: ["province", "provinces"],
  THA: ["province", "provinces"],
  MYS: ["state", "states"],
  AUT: ["state", "states"],
  CHE: ["canton", "cantons"],
  POL: ["voivodeship", "voivodeships"],
  CHL: ["region", "regions"],
  NZL: ["region", "regions"],
};

export const regions = feature(regionTopo, regionTopo.objects.regions)
  .features.map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    cc: f.properties.cc,
    label: [f.properties.lx, f.properties.ly],
    feature: f,
    bounds: geoBounds(f),
    norm: normalize(f.properties.name),
  }))
  .filter((r) => countryById.has(r.cc))
  .sort((a, b) => a.name.localeCompare(b.name));
export const regionById = new Map(regions.map((r) => [r.id, r]));
// Regions per country, by name. Lookups go through them in id order, as the data build does.
export const regionsByCountry = new Map();
const lookupByCountry = new Map();
for (const r of regions) {
  if (!regionsByCountry.has(r.cc)) regionsByCountry.set(r.cc, []);
  regionsByCountry.get(r.cc).push(r);
}
for (const [cc, list] of regionsByCountry) lookupByCountry.set(cc, [...list].sort((a, b) => (a.id < b.id ? -1 : 1)));
// Borders between the regions of a country, for drawing; made when first needed.
const regionMeshes = new Map();
export function regionMesh(cc) {
  if (!regionMeshes.has(cc)) regionMeshes.set(cc, mesh(regionTopo, regionTopo.objects.regions, (a, b) => a !== b && a.properties.cc === cc && b.properties.cc === cc));
  return regionMeshes.get(cc);
}

/**
 * The zoom from which a country's regions can be picked on the map: once the country fills
 * much of the view, and never at the whole-world view.
 */
export function regionZoom(c) {
  if (c.regionZoom == null) {
    const [[x0, y0], [x1, y1]] = c.bounds;
    const span = Math.max(x1 >= x0 ? x1 - x0 : 360 + x1 - x0, (y1 - y0) * 1.6);
    c.regionZoom = Math.max(1.5, Math.min(2.5, 110 / Math.max(span, 4)));
  }
  return c.regionZoom;
}

/** "state" / "states" and so on for a country's regions. */
export function regionUnit(cc, n = 2) {
  const u = REGION_UNITS[cc] || ["region", "regions"];
  return n === 1 ? u[0] : u[1];
}

/** The region of country `cc` containing a lon/lat point (see findRegion). */
export function regionAtLonLat(lonlat, cc, near = 0) {
  const list = lookupByCountry.get(cc);
  return list ? findRegion(list, lonlat, near) : null;
}

// The region of each city, worked out when first needed (most cities are never asked about).
// The outlines are simplified, so the data build lists the cities they would place wrongly.
const regionOfCityCache = new Map();
/** The region of a city or place, or null where its country has no regions. */
export function regionOfCity(c) {
  if (!c || !regionsByCountry.has(c.cc)) return null;
  if (!c.custom && Object.hasOwn(regionFixes, c.key)) return regionById.get(regionFixes[c.key]) || null;
  const key = `${c.key}@${c.lon},${c.lat}`;
  if (!regionOfCityCache.has(key)) regionOfCityCache.set(key, regionAtLonLat([c.lon, c.lat], c.cc, CITY_NEAR_KM));
  return regionOfCityCache.get(key);
}

/** The closest city (major or smaller place) to a lon/lat point and its distance in km. */
export function nearestCity([lon, lat]) {
  let best = null;
  let bestD = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const c of allCities) {
    // Cheap flat-earth distance to pick candidates, exact distance for the winner.
    const dx = (((c.lon - lon + 540) % 360) - 180) * cosLat;
    const dy = c.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best && { city: best, km: geoDistance([lon, lat], [best.lon, best.lat]) * 6371 };
}

// Ocean and sea labels, named per the US Board on Geographic Names.
// `min` is the zoom level at which the label appears.
export const waterLabels = [
  ["Pacific Ocean", -140, 8, 0],
  ["Pacific Ocean", 170, 18, 0],
  ["Atlantic Ocean", -40, 28, 0],
  ["Atlantic Ocean", -18, -22, 0],
  ["Indian Ocean", 78, -22, 0],
  ["Arctic Ocean", 10, 84, 0],
  ["Southern Ocean", 60, -62, 0],
  ["Gulf of America", -90.5, 25.3, 1.4],
  ["Caribbean Sea", -75, 14.5, 1.4],
  ["Mediterranean Sea", 18, 34.2, 1.4],
  ["Arabian Sea", 64, 15, 1.4],
  ["Bay of Bengal", 89, 15, 1.4],
  ["South China Sea", 114, 13, 1.4],
  ["Philippine Sea", 133, 20, 1.6],
  ["East China Sea", 126.5, 29, 2.2],
  ["Sea of Japan", 134.5, 40.5, 2],
  ["Yellow Sea", 123, 36, 2.6],
  ["Sea of Okhotsk", 149, 54, 1.8],
  ["Bering Sea", -178, 58, 1.6],
  ["Gulf of Alaska", -145, 56.5, 1.8],
  ["Hudson Bay", -85.5, 59.5, 1.6],
  ["Coral Sea", 155, -16, 1.6],
  ["Tasman Sea", 162, -38, 1.6],
  ["Persian Gulf", 51.5, 27, 2.6],
  ["Red Sea", 38.3, 20.5, 2.4],
  ["Black Sea", 34, 43.2, 2],
  ["Caspian Sea", 50.5, 42, 2.4],
  ["Baltic Sea", 19, 56.8, 2.4],
  ["North Sea", 3.5, 56, 2.2],
  ["Norwegian Sea", 2, 68, 1.8],
  ["Barents Sea", 40, 74, 1.8],
  ["Gulf of Guinea", 3, 1.5, 1.8],
  ["Mozambique Channel", 41, -18, 2.4],
].map(([name, lon, lat, min]) => ({ name, lon, lat, min }));

export function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
