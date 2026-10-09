// Builds the compact datasets embedded in the page from Natural Earth sources.
// Usage: npm run fetch-data, then npm run data (reads data/raw, writes data/build).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const RAW = "data/raw";
const OUT = "data/build";
mkdirSync(OUT, { recursive: true });

// Short-form names used by the US Department of State where Natural Earth differs.
const US_NAMES = {
  "People's Republic of China": "China",
  "United States of America": "United States",
  "Czech Republic": "Czechia",
  Turkey: "Türkiye",
  Myanmar: "Burma",
  "Cape Verde": "Cabo Verde",
  "Ivory Coast": "Côte d'Ivoire",
  "East Timor": "Timor-Leste",
  "Federated States of Micronesia": "Micronesia",
  Palestine: "West Bank and Gaza",
};

// Countries: USA point-of-view edition. Breakaway regions the US does not recognize
// (e.g. Abkhazia, South Ossetia) are merged into their sovereign state.
const KEEP = ["ADM0_A3", "ISO_A2_EH", "NAME_EN", "NAME_LONG", "CONTINENT", "SUBREGION", "TYPE", "SOVEREIGNT", "POP_EST", "LABEL_X", "LABEL_Y", "LABELRANK"];
const src = JSON.parse(readFileSync(`${RAW}/ne_10m_admin_0_countries_usa.geojson`, "utf8"));
const byA3 = new Map(src.features.map((f) => [f.properties.ADM0_A3, f.properties]));
for (const f of src.features) {
  const p = f.properties;
  if (p.TYPE === "Breakaway" && byA3.has(p.SOV_A3)) f.properties = { ...byA3.get(p.SOV_A3) };
  f.properties = Object.fromEntries(KEEP.map((k) => [k, f.properties[k]]));
  const name = US_NAMES[f.properties.NAME_EN];
  if (name) f.properties.NAME_EN = f.properties.NAME_LONG = name;
}
writeFileSync(`${OUT}/_countries.geojson`, JSON.stringify(src));
execSync(
  `npx mapshaper ${OUT}/_countries.geojson -dissolve2 ADM0_A3 copy-fields=${KEEP.slice(1).join(",")} ` +
    `-rename-fields id=ADM0_A3,iso2=ISO_A2_EH,name=NAME_EN,long=NAME_LONG,continent=CONTINENT,region=SUBREGION,type=TYPE,sov=SOVEREIGNT,pop=POP_EST,lx=LABEL_X,ly=LABEL_Y,rank=LABELRANK ` +
    `-simplify 8% keep-shapes -filter-slivers -rename-layers countries ` +
    `-o format=topojson quantization=1e5 ${OUT}/countries.topo.json`,
  { stdio: "inherit" }
);
rmSync(`${OUT}/_countries.geojson`);

// Provinces and states (admin-1) of the countries where people often count them. France, Italy
// and Spain are grouped into their regions or autonomous communities, the United Kingdom into its
// four nations. Ids are ISO 3166-2 codes; names are in English.
const REGION_COUNTRIES = (process.env.REGION_COUNTRIES || "USA CHN CAN AUS BRA IND RUS MEX JPN DEU FRA ITA ESP GBR ARG IDN ZAF KOR TUR THA MYS AUT CHE POL CHL NZL").split(/\s+/);
const GROUPS = {
  // Natural Earth region code -> [ISO 3166-2, English name]
  FRA: {
    "FR-ARA": ["FR-ARA", "Auvergne-Rhône-Alpes"], "FR-BFC": ["FR-BFC", "Bourgogne-Franche-Comté"], "FR-BRE": ["FR-BRE", "Brittany"],
    "FR-CVL": ["FR-CVL", "Centre-Val de Loire"], "FR-COR": ["FR-20R", "Corsica"], "FR-GES": ["FR-GES", "Grand Est"],
    "FR-HDF": ["FR-HDF", "Hauts-de-France"], "FR-IDF": ["FR-IDF", "Île-de-France"], "FR-NOR": ["FR-NOR", "Normandy"],
    "FR-NAQ": ["FR-NAQ", "Nouvelle-Aquitaine"], "FR-OCC": ["FR-OCC", "Occitania"], "FR-PDL": ["FR-PDL", "Pays de la Loire"],
    "FR-PAC": ["FR-PAC", "Provence-Alpes-Côte d'Azur"], "FR-GUA": ["FR-971", "Guadeloupe"], "FR-MTQ": ["FR-972", "Martinique"],
    "FR-GUF": ["FR-973", "French Guiana"], "FR-LRE": ["FR-974", "Réunion"], "FR-MAY": ["FR-976", "Mayotte"],
  },
  ITA: {
    "IT-21": ["IT-21", "Piedmont"], "IT-23": ["IT-23", "Aosta Valley"], "IT-25": ["IT-25", "Lombardy"], "IT-32": ["IT-32", "Trentino-South Tyrol"],
    "IT-34": ["IT-34", "Veneto"], "IT-36": ["IT-36", "Friuli-Venezia Giulia"], "IT-42": ["IT-42", "Liguria"], "IT-45": ["IT-45", "Emilia-Romagna"],
    "IT-52": ["IT-52", "Tuscany"], "IT-55": ["IT-55", "Umbria"], "IT-57": ["IT-57", "Marche"], "IT-62": ["IT-62", "Lazio"],
    "IT-65": ["IT-65", "Abruzzo"], "IT-67": ["IT-67", "Molise"], "IT-72": ["IT-72", "Campania"], "IT-75": ["IT-75", "Apulia"],
    "IT-77": ["IT-77", "Basilicata"], "IT-78": ["IT-78", "Calabria"], "IT-82": ["IT-82", "Sicily"], "IT-88": ["IT-88", "Sardinia"],
  },
  // Spain: keyed by the Natural Earth region name (its codes put Ceuta and Melilla together).
  ESP: {
    Andalucía: ["ES-AN", "Andalusia"], Aragón: ["ES-AR", "Aragon"], Asturias: ["ES-AS", "Asturias"], "Islas Baleares": ["ES-IB", "Balearic Islands"],
    "País Vasco": ["ES-PV", "Basque Country"], "Canary Is.": ["ES-CN", "Canary Islands"], Cantabria: ["ES-CB", "Cantabria"],
    "Castilla y León": ["ES-CL", "Castile and León"], "Castilla-La Mancha": ["ES-CM", "Castilla-La Mancha"], Cataluña: ["ES-CT", "Catalonia"],
    Ceuta: ["ES-CE", "Ceuta"], Extremadura: ["ES-EX", "Extremadura"], Galicia: ["ES-GA", "Galicia"], "La Rioja": ["ES-RI", "La Rioja"],
    Madrid: ["ES-MD", "Madrid"], Melilla: ["ES-ML", "Melilla"], Murcia: ["ES-MC", "Murcia"], "Foral de Navarra": ["ES-NC", "Navarre"],
    Valenciana: ["ES-VC", "Valencian Community"],
  },
  GBR: { England: ["GB-ENG", "England"], Scotland: ["GB-SCT", "Scotland"], Wales: ["GB-WLS", "Wales"], "Northern Ireland": ["GB-NIR", "Northern Ireland"] },
};
const groupKey = { FRA: (p) => p.region_cod.trim(), ITA: (p) => p.region_cod.trim(), ESP: (p) => p.region, GBR: (p) => p.geonunit };
// Russia: Natural Earth swaps the codes of Moscow and Moscow Oblast; oblasts are named as such.
const RU_NAMES = { "RU-ALT": "Altai Krai", "RU-YEV": "Jewish Autonomous Oblast" };
// Names where Natural Earth's English name is ambiguous or not the usual one. Mexico City keeps
// its current code (Natural Earth still has MX-DIF).
const REGION_FIX = {
  "US-DC": ["US-DC", "District of Columbia"],
  "BR-DF": ["BR-DF", "Federal District"],
  "MX-DIF": ["MX-CMX", "Mexico City"],
  "AR-B": ["AR-B", "Buenos Aires Province"],
  "AR-C": ["AR-C", "Buenos Aires City"],
  "DE-HB": ["DE-HB", "Bremen"],
  "CL-RM": ["CL-RM", "Santiago Metropolitan"],
};
const plain = (s) => s.normalize("NFD").replace(/[̄̂]/g, "").normalize("NFC"); // Ōsaka -> Osaka
function regionOf(p) {
  const cc = p.adm0_a3;
  if (GROUPS[cc]) {
    const g = GROUPS[cc][groupKey[cc](p)];
    if (!g) throw new Error(`No region group for ${cc} ${p.name} (${groupKey[cc](p)})`);
    return { id: g[0], name: g[1], cc };
  }
  let id = p.iso_3166_2;
  // Units of other countries (Crimea is listed under Russia) and Natural Earth's own codes
  // for small outlying islands ("~") are left out.
  if (!id.startsWith(`${p.iso_a2}-`) || id.includes("~")) return null;
  if (REGION_FIX[id]) return { id: REGION_FIX[id][0], name: REGION_FIX[id][1], cc };
  let name = p.name_en || p.name;
  if (cc === "JPN") name = plain(name.replace(/ Prefecture$/, ""));
  if (cc === "RUS") {
    if (p.type_en === "Federal City" && id === "RU-MOS") id = "RU-MOW";
    else if (p.type_en === "Region" && id === "RU-MOW") id = "RU-MOS";
    name = RU_NAMES[id] || (p.type_en === "Region" && !/Krai$/.test(name) ? `${name} Oblast` : name);
  }
  return { id, name, cc };
}
let regionSource; // the regions before simplifying, to place cities exactly
{
  const src = JSON.parse(readFileSync(`${RAW}/ne_10m_admin_1_states_provinces.geojson`, "utf8"));
  const want = new Set(REGION_COUNTRIES);
  const features = (regionSource = []);
  for (const f of src.features) {
    if (!want.has(f.properties.adm0_a3)) continue;
    const r = regionOf(f.properties);
    if (r) features.push({ type: "Feature", properties: r, geometry: f.geometry });
  }
  writeFileSync(`${OUT}/_regions.geojson`, JSON.stringify({ type: "FeatureCollection", features }));
  execSync(
    `npx mapshaper ${OUT}/_regions.geojson -dissolve id copy-fields=name,cc ` +
      // A point inside each region, for its card.
      `-each 'lx=+this.innerX.toFixed(3), ly=+this.innerY.toFixed(3)' ` +
      `-simplify 8% keep-shapes -rename-layers regions ` +
      `-o format=topojson quantization=1e5 ${OUT}/regions.topo.json`,
    { stdio: "inherit" }
  );
  rmSync(`${OUT}/_regions.geojson`);
  const n = new Set(features.map((f) => f.properties.id)).size;
  console.log(`regions: ${n} in ${want.size} countries`);
}

// Cities: every national capital plus the most populous places, up to CITY_LIMIT.
const CITY_LIMIT = Number(process.env.CITY_LIMIT || 1000);
const places = JSON.parse(readFileSync(`${RAW}/ne_10m_populated_places_simple.geojson`, "utf8")).features.map((f) => f.properties);
const isCapital = (p) => p.adm0cap === 1 || /capital/i.test(p.featurecla) && !/Admin-1/.test(p.featurecla);
const picked = new Map();
for (const p of places.filter(isCapital)) picked.set(p.ne_id, p);
for (const p of [...places].sort((a, b) => b.pop_max - a.pop_max)) {
  if (picked.size >= CITY_LIMIT) break;
  picked.set(p.ne_id, p);
}
// Places whose admin-0 code differs from the USA point-of-view country layer.
const COUNTRY_FIX = { SSD: "SDS", SOL: "SOM", SJM: "NOR" };
// Prefer the plain conventional spelling when Natural Earth uses macrons (e.g. Osaka).
// Spelling errors in the Natural Earth source.
const NAME_FIX = { Shenyeng: "Shenyang" };
const displayName = (p) => NAME_FIX[p.name] || (/[\u0100-\u017f]/.test(p.name) && !/[\u0100-\u017f]/.test(p.nameascii) && /[ōūāīē]/i.test(p.name) ? p.nameascii : p.name);
const round = (x) => Math.round(x * 1000) / 1000;
const cities = [...picked.values()]
  .sort((a, b) => b.pop_max - a.pop_max)
  .map((p) => [displayName(p), COUNTRY_FIX[p.adm0_a3] || p.adm0_a3, round(p.longitude), round(p.latitude), p.pop_max, isCapital(p) ? 1 : 0, p.scalerank]);
writeFileSync(`${OUT}/cities.json`, JSON.stringify(cities));
console.log(`cities: ${cities.length}`);

// Searchable cities: GeoNames places with at least EXTRA_MIN_POP people (via the
// all-the-cities package, CC BY 4.0). They are hidden on the map until the user adds one.
const EXTRA_MIN_POP = Number(process.env.EXTRA_MIN_POP || 5000);
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const { feature } = require("topojson-client");
const { geoContains, geoBounds, geoDistance } = require("d3-geo");
const topo = JSON.parse(readFileSync(`${OUT}/countries.topo.json`, "utf8"));
const shapes = feature(topo, topo.objects.countries).features.map((f) => ({ f, id: f.properties.id, iso2: f.properties.iso2, pop: f.properties.pop, b: geoBounds(f) }));
const byIso2 = new Map();
for (const s of [...shapes].sort((a, b) => a.pop - b.pop)) if (/^[A-Z]{2}$/.test(s.iso2)) byIso2.set(s.iso2, s.id);
const countryAt = ([lon, lat]) => {
  for (const s of shapes) {
    const [[x0, y0], [x1, y1]] = s.b;
    if (lat < y0 || lat > y1) continue;
    if (x0 <= x1 ? lon < x0 || lon > x1 : lon < x0 && lon > x1) continue;
    if (geoContains(s.f, [lon, lat])) return s.id;
  }
  return null;
};
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const majors = cities.map(([name, cc, lon, lat]) => ({ norm: norm(name), cc, ll: [lon, lat] }));
const extra = [];
let dropped = 0;
for (const c of require("all-the-cities")) {
  if (c.population < EXTRA_MIN_POP) continue;
  const ll = c.loc.coordinates.map((x) => Math.round(x * 100) / 100); // ~1 km
  const cc = byIso2.get(c.country) || countryAt(ll);
  if (!cc) {
    dropped++;
    continue;
  }
  // Skip places already in the major-city list: same name within 80 km, or any name within 12 km.
  const n = norm(c.name);
  if (majors.some((m) => m.cc === cc && geoDistance(m.ll, ll) < (m.norm === n ? 80 : 12) / 6371)) continue;
  extra.push([c.cityId, c.name, cc, ll[0], ll[1], c.population]);
}
extra.sort((a, b) => b[5] - a[5]);
writeFileSync(`${OUT}/cities-extra.json`, JSON.stringify(extra));
console.log(`extra cities: ${extra.length} (dropped ${dropped} without a country)`);

// The page finds a city's region from the simplified outlines, which put some cities near a
// border or on a small island in the wrong region or none. Those cities are listed with the
// region the full outlines give.
{
  const { findRegion, CITY_NEAR_KM } = await import("../src/regionlookup.js");
  const byCc = (features) => {
    const out = new Map();
    for (const f of features) {
      const r = { id: f.properties.id, feature: f, bounds: geoBounds(f) };
      if (!out.has(f.properties.cc)) out.set(f.properties.cc, []);
      out.get(f.properties.cc).push(r);
    }
    for (const list of out.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
    return out;
  };
  const exact = byCc(regionSource);
  const rt = JSON.parse(readFileSync(`${OUT}/regions.topo.json`, "utf8"));
  const shipped = byCc(feature(rt, rt.objects.regions).features);
  const fixes = {};
  const all = cities.map(([name, cc, lon, lat]) => [`${cc}:${name}`, cc, lon, lat]).concat(extra.map(([id, , cc, lon, lat]) => [`g${id}`, cc, lon, lat]));
  for (const [key, cc, lon, lat] of all) {
    if (!exact.has(cc)) continue;
    const want = findRegion(exact.get(cc), [lon, lat], CITY_NEAR_KM)?.id || "";
    const got = findRegion(shipped.get(cc) || [], [lon, lat], CITY_NEAR_KM)?.id || "";
    if (want !== got) fixes[key] = want;
  }
  writeFileSync(`${OUT}/region-fixes.json`, JSON.stringify(fixes));
  console.log(`region fixes: ${Object.keys(fixes).length}`);
}

// Airports with an IATA code and scheduled service (OurAirports, public domain), used
// to place imported flights.
{
  const text = readFileSync(`${RAW}/airports.csv`, "utf8");
  const rows = parseCsv(text);
  const head = rows.shift();
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const out = [];
  for (const r of rows) {
    const iata = r[col.iata_code];
    const type = r[col.type];
    if (!/^[A-Z]{3}$/.test(iata)) continue;
    if (!(type === "large_airport" || type === "medium_airport" || (type === "small_airport" && r[col.scheduled_service] === "yes"))) continue;
    const ll = [Math.round(+r[col.longitude_deg] * 1000) / 1000, Math.round(+r[col.latitude_deg] * 1000) / 1000];
    const cc = byIso2.get(r[col.iso_country]) || countryAt(ll);
    if (!cc) continue;
    out.push([iata, r[col.name], r[col.municipality], cc, ll[0], ll[1], type === "large_airport" ? 1 : 0]);
  }
  writeFileSync(`${OUT}/airports.json`, JSON.stringify(out));
  console.log(`airports: ${out.length}`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') (field += '"'), i++;
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n") row.push(field), rows.push(row), (row = []), (field = "");
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}
