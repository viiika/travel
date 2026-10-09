// Importing flight history exported by other apps (any English .xls, .xlsx or .csv table
// with date, from and to columns) and turning it into trips. Files in other languages,
// such as Umetrip exports in Chinese, are converted to English with an AI assistant first.
import { geoDistance } from "d3-geo";
import { allCities, cityByKey, normalize } from "./data.js";
import { airports } from "./airports.js";
import { readXls, isXls } from "./xls.js";

const EARTH_RADIUS_KM = 6371;

// ---- Reading tables -------------------------------------------------------

export const IMPORT_EXTENSIONS = [".xls", ".xlsx", ".csv", ".tsv", ".txt"];

export function isImportFile(name) {
  return IMPORT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

/** Reads a spreadsheet or CSV file into rows of cell values (first sheet that has data). */
export async function readTable(file) {
  const buf = await file.arrayBuffer();
  if (isXls(buf)) return pickSheet(readXls(buf));
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (head[0] === 0x50 && head[1] === 0x4b) return pickSheet(await readXlsx(buf));
  return parseDelimited(decodeText(buf));
}

function pickSheet(sheets) {
  // The first sheet that looks like a flight table, else the first with data.
  return (sheets.find((s) => findHeader(s.rows)) || sheets.find((s) => s.rows.length) || { rows: [] }).rows;
}

// Text files: UTF-16 or UTF-8 by their byte order mark, else UTF-8 when valid. Other files
// are Windows-1252 (Western European Excel exports), or GB18030 when their non-ASCII bytes
// come in pairs, as Chinese text does; decoding those properly lets the page tell that the
// file is not in English.
export function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^\ufeff/, "");
  } catch {
    let pairs = 0;
    let single = 0;
    for (let i = 0; i < b.length; i++) {
      if (b[i] < 0x80) continue;
      if (b[i + 1] >= 0x40 && b[i + 1] !== 0x7f && b[i + 1] < 0xff && (b[i + 1] >= 0x80 || pairs > single)) (pairs++, i++);
      else single++;
    }
    return new TextDecoder(pairs > single ? "gb18030" : "windows-1252").decode(b);
  }
}

const DELIMITERS = [",", "\t", ";", "|"];

export function parseDelimited(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  // A Markdown table, as chat assistants often reply: | a | b |, with a |---| rule.
  const piped = lines.filter((l) => /^\s*\|.*\|\s*$/.test(l));
  if (piped.length >= 2) {
    return piped
      .filter((l) => !/^\s*\|[\s|:-]+\|\s*$/.test(l))
      .map((l) => l.trim().slice(1, -1).split("|").map((c) => c.trim()));
  }
  // The delimiter that splits most of the first lines into three or more cells.
  const head = lines.slice(0, 12);
  const score = (d) => head.filter((l) => l.split(d).length >= 3).length;
  const delim = DELIMITERS.slice(0, 3).reduce((best, d) => (score(d) > score(best) ? d : best));
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === "") (quoted = true), (field = "");
    else if (ch === delim) row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

// .xlsx is a zip of XML parts; read the shared strings and each worksheet.
async function readXlsx(buf) {
  const files = await unzip(buf, (name) => /^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml)$/.test(name));
  const xml = (name) => (files[name] ? new DOMParser().parseFromString(files[name], "application/xml") : null);
  const text = (el) => [...el.getElementsByTagName("t")].map((t) => t.textContent).join("");
  const shared = [...(xml("xl/sharedStrings.xml")?.getElementsByTagName("si") || [])].map(text);
  const names = [...(xml("xl/workbook.xml")?.getElementsByTagName("sheet") || [])].map((s) => s.getAttribute("name"));
  const sheets = [];
  const sheetFiles = Object.keys(files)
    .filter((n) => n.startsWith("xl/worksheets/"))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  sheetFiles.forEach((n, i) => {
    const rows = [];
    for (const c of xml(n).getElementsByTagName("c")) {
      const ref = c.getAttribute("r") || "";
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      const col = [...m[1]].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const row = +m[2] - 1;
      const t = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const value = t === "s" ? shared[+v] ?? "" : t === "inlineStr" ? text(c) : t === "str" || t === "b" ? v : v === "" ? "" : Number(v);
      while (rows.length <= row) rows.push([]);
      while (rows[row].length < col) rows[row].push("");
      rows[row][col] = value;
    }
    sheets.push({ name: names[i] || n, rows });
  });
  return sheets;
}

async function unzip(buf, want) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("This file is not a valid .xlsx workbook.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = new Uint8Array(buf, start, size);
    const bytes = method === 0 ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    out[name] = new TextDecoder().decode(bytes);
  }
  return out;
}

// ---- Recognizing flight tables -------------------------------------------

// Chinese, Japanese or Korean text: kana, ideographs, hangul, CJK punctuation and halfwidth
// forms (fullwidth Latin letters and punctuation, which English files sometimes use, are not
// counted). Such files are converted to English before importing.
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff61-\uffdc]/;
export const hasCjk = (s) => CJK.test(String(s));

// Header names per column (lowercase, without spaces and punctuation). Ticket numbers
// are never read.
const COLUMNS = {
  date: ["date", "flightdate", "departuredate", "depdate", "traveldate"],
  flight: ["flight", "flightno", "flightnumber", "flightnum"],
  airline: ["airline", "carrier"],
  from: ["from", "origin", "departure", "departureairport", "departurecity", "fromairport", "fromcity", "originairport", "dep"],
  to: ["to", "destination", "arrival", "arrivalairport", "arrivalcity", "toairport", "tocity", "destinationairport", "arr"],
  depTime: ["departuretime", "deptime", "std"],
  arrTime: ["arrivaltime", "arrtime", "sta"],
  arrDate: ["arrivaldate", "arrdate"],
  status: ["status", "ticketstatus"],
};
// Header text without notes in parentheses ("Departure time (local)"), spaces and punctuation.
const key = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[\s_\-.():#*]/g, "");

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cols = {};
    rows[i].forEach((cell, j) => {
      const k = key(cell);
      for (const [name, aliases] of Object.entries(COLUMNS)) if (cols[name] == null && aliases.includes(k)) cols[name] = j;
    });
    if (cols.date != null && cols.from != null && cols.to != null) return { index: i, cols };
  }
  return null;
}

// Statuses of tickets that were not flown.
const NOT_FLOWN = /cancel|refund|unused|void/i;

/**
 * Turns table rows into flights: { date, arrDate, depTime, arrTime, flight, airline, from, to,
 * fromName, toName } with airport IATA codes (null when the airport is not recognized).
 */
export function parseFlights(rows) {
  const header = findHeader(rows);
  if (!header) throw new Error("No flight table found. The file needs columns for the date, departure and arrival.");
  const { cols } = header;
  const flights = [];
  let skipped = 0;
  for (const r of rows.slice(header.index + 1)) {
    const get = (c) => (cols[c] == null ? "" : String(r[cols[c]] ?? "").trim());
    if (cols.status != null && NOT_FLOWN.test(get("status"))) {
      skipped++;
      continue;
    }
    const date = parseDate(r[cols.date]);
    const fromName = get("from");
    const toName = get("to");
    if (!date || !fromName || !toName) {
      // Rows that look like flights count as skipped; notes or code fences around a table do not.
      if (r.filter((c) => String(c).trim()).length >= 3) skipped++;
      continue;
    }
    const depTime = parseTime(get("depTime")) || parseTime(String(r[cols.date] ?? ""));
    const arrTime = parseTime(get("arrTime"));
    // The arrival date: from its column, from a "+1" after the arrival time, or the next day
    // when the arrival time is earlier than the departure.
    const plusDays = get("arrTime").match(/\+\s*(\d)/);
    const arrDate =
      parseDate(r[cols.arrDate]) ||
      (plusDays ? addDays(date, +plusDays[1]) : depTime && arrTime && arrTime < depTime ? addDays(date, 1) : date);
    flights.push({
      date,
      arrDate,
      depTime,
      arrTime,
      flight: get("flight").replace(/\s+/g, "").toUpperCase(),
      airline: get("airline"),
      fromName,
      toName,
      from: airportCode(fromName),
      to: airportCode(toName),
    });
  }
  flights.sort((a, b) => (a.date + (a.depTime || "")).localeCompare(b.date + (b.depTime || "")));
  return { flights, skipped };
}

export function parseDate(v) {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel serial date (days since 1899-12-30).
    return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?![\d])/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/); // month/day/year, or day/month/year when the first is over 12
  if (m) return +m[1] > 12 ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  // Written-out dates such as "Mar 5, 2022" or "5 March 2022".
  if (!/^(\d{1,2}\s+)?[A-Za-z]{3,9}\.?\s+\d/.test(s) || !/\d{4}/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(+d) ? null : iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function iso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseTime(s) {
  const m = String(s).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\b/i);
  if (!m) return "";
  let hour = +m[1];
  // 12-hour clock: 12 AM is midnight, 1 PM is 13:00.
  if (m[3]) hour = (hour % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5;
}

// ---- Airports to cities ---------------------------------------------------

// Lowercase, without accents, punctuation and words like "International Airport".
const simple = (s) =>
  normalize(String(s))
    .replace(/\b(international|intl|airport|air base|aeroporto|aeropuerto|aeroport)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const byNormName = new Map();
for (const a of airports.values()) {
  const n = simple(a.name);
  if (!byNormName.has(n) || a.large) byNormName.set(n, a.iata);
}

// IATA codes for cities with several airports, read as the main one.
const METRO = { BJS: "PEK", TYO: "HND", OSA: "KIX", SEL: "ICN", LON: "LHR", NYC: "JFK", PAR: "CDG", MIL: "MXP", ROM: "FCO", CHI: "ORD", WAS: "IAD", MOW: "SVO", STO: "ARN", BUE: "EZE", SAO: "GRU", RIO: "GIG", YTO: "YYZ", YMQ: "YUL", JKT: "CGK", REK: "KEF" };

/** IATA code for an airport as written in an export: a code, an airport name or a city name. */
export function airportCode(text) {
  const s = String(text).trim();
  const code = s.match(/(?:^|[^A-Za-z])([A-Z]{3})(?:$|[^A-Za-z])/);
  if (code && airports.has(code[1])) return code[1];
  if (code && METRO[code[1]]) return METRO[code[1]];
  const n = simple(s);
  if (!n) return null;
  if (byNormName.has(n)) return byNormName.get(n);
  // A city name alone means its largest airport.
  let best = null;
  for (const a of airports.values()) if (simple((a.city || "").split(/[(,/]/)[0]) === n && (!best || a.large > best.large)) best = a;
  return (best || cityThenAirport(n))?.iata || null;
}

let citiesByName = null;

// "Bangkok Suvarnabhumi", "Tokyo Narita": a city, then the airport's name or town, for an
// airport within 100 km of that city.
function cityThenAirport(n) {
  if (!citiesByName) {
    citiesByName = new Map();
    for (const c of allCities) {
      const k = simple(c.name);
      if (!citiesByName.has(k)) citiesByName.set(k, []);
      citiesByName.get(k).push(c);
    }
  }
  const words = n.split(" ");
  let best = null;
  for (let k = 1; k < words.length; k++) {
    const near = citiesByName.get(words.slice(0, k).join(" "));
    if (!near) continue;
    const tail = ` ${words.slice(k).join(" ")} `;
    for (const a of airports.values()) {
      if (!` ${simple(a.name)} `.includes(tail) && ` ${simple((a.city || "").split(/[(,/]/)[0])} ` !== tail) continue;
      if (!near.some((c) => geoDistance([c.lon, c.lat], [a.lon, a.lat]) * EARTH_RADIUS_KM < 100)) continue;
      if (!best || a.large > best.large) best = a;
    }
  }
  return best;
}

const cityCache = new Map();
// Airports better known by a city other than the one the data points to.
const SERVES = { TPE: "TWN:Taipei" };

/**
 * The city an airport serves: a nearby city, weighing size, distance, whether the airport's
 * name or municipality names it, and whether it is one of the major cities.
 */
export function cityForAirport(iata) {
  if (cityCache.has(iata)) return cityCache.get(iata);
  const a = airports.get(iata);
  let best = SERVES[iata] || null;
  if (a && !best) {
    const muni = simple((a.city || "").split(/[(,/]/)[0]);
    const name = ` ${simple(a.name)} `;
    for (const radius of [120, 350]) {
      let bestScore = -Infinity;
      for (const c of allCities) {
        if (Math.abs(c.lat - a.lat) > radius / 100) continue;
        const km = geoDistance([c.lon, c.lat], [a.lon, a.lat]) * EARTH_RADIUS_KM;
        if (km > radius) continue;
        const n = simple(c.name);
        const score =
          Math.log10(c.pop + 1) - km / 35 + (n === muni ? 0.8 : 0) + (n.length > 2 && name.includes(` ${n} `) ? 1 : 0) + (c.major ? 1 : 0) + (c.cc === a.cc ? 0 : -2);
        if (score > bestScore) (bestScore = score), (best = c.key);
      }
      if (best) break;
    }
  }
  cityCache.set(iata, best);
  return best;
}

// ---- Flights to trips ------------------------------------------------------

const MAX_GAP_DAYS = 21;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Chains flights into trips. A trip continues while the next flight leaves from where the
 * last one landed, within three weeks, and ends once it is back where it started.
 * cityOf(iata) gives the city key used for each airport.
 */
export function buildTrips(flights, cityOf) {
  const trips = [];
  let cur = null;
  for (const f of flights) {
    const from = cityOf(f.from);
    const to = cityOf(f.to);
    if (!from || !to) continue;
    const stop = { city: to, date: f.arrDate, ...(f.flight ? { flight: f.flight } : {}) };
    const last = cur && cur.stops[cur.stops.length - 1];
    const open = cur && cur.stops[0].city !== last.city && daysBetween(last.date, f.date) <= MAX_GAP_DAYS;
    if (open && last.city === from) {
      cur.stops.push(stop);
    } else if (open && nearbyKm(last.city, from) <= GROUND_KM) {
      // The next flight leaves from a nearby city: the traveler went there over land.
      cur.stops.push({ city: from, date: f.date, mode: "train", inferred: true }, stop);
    } else {
      cur = { stops: [{ city: from, date: f.date }, stop] };
      trips.push(cur);
    }
  }
  for (const t of trips) t.name = tripName(t);
  return trips;
}

// Flights from a different city this close to the last arrival continue the same trip.
const GROUND_KM = 400;

function nearbyKm(a, b) {
  const ca = cityByKey.get(a);
  const cb = cityByKey.get(b);
  return ca.cc === cb.cc ? geoDistance([ca.lon, ca.lat], [cb.lon, cb.lat]) * EARTH_RADIUS_KM : Infinity;
}

function tripName(t) {
  const origin = cityByKey.get(t.stops[0].city);
  const last = cityByKey.get(t.stops[t.stops.length - 1].city);
  const [y, m] = t.stops[0].date.split("-");
  const when = `${MONTHS[+m - 1]} ${y}`;
  if (t.stops.length === 2) return `${origin.name} to ${last.name}, ${when}`;
  // Longer trips are named after the stop farthest from where they started.
  let far = last;
  let farKm = -1;
  for (const s of t.stops) {
    const c = cityByKey.get(s.city);
    const km = geoDistance([c.lon, c.lat], [origin.lon, origin.lat]);
    if (km > farKm) (farKm = km), (far = c);
  }
  return `${far.name}, ${when}`;
}
