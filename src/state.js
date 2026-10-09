import { geoDistance } from "d3-geo";
import { countryById, cityByKey, countries, cities, customPlaces, countryAtLonLat, normalize, CONTINENTS, regionById, regionOfCity } from "./data.js";
import { ADDABLE, bodyById } from "./space.js";
import { isPhoto, isPhotoPath, photoFromDataUrl, photoBlob, forgetPhotos, keepUnsavedPhotos, PHOTOS_PER_STOP, NOTE_MAX } from "./photos.js";

const uid = () => Math.random().toString(36).slice(2, 9);

const PREFS_KEY = "travel-atlas:prefs"; // per-device display preferences
// Unsaved travel data is kept in the browser in case the page closes, one draft per tab
// ("travel-atlas:draft:<tab>"), so that tabs open at the same time neither overwrite nor clear
// each other's. A draft whose tab is gone is offered back on the next visit. Older versions kept
// a single draft under the bare prefix.
const DRAFT_PREFIX = "travel-atlas:draft";
const TAB = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const DRAFT_KEY = `${DRAFT_PREFIX}:${TAB}`;
// Each tab holds a lock named after it while it is open, which tells other tabs that its draft is
// in use. Where locks are not available, every other tab's draft counts as left over.
const TAB_LOCK = "travel-atlas:tab:";
try {
  if (typeof navigator !== "undefined") navigator.locks?.request(TAB_LOCK + TAB, () => new Promise(() => {}));
} catch {}
const EARTH_RADIUS_KM = 6371;

export const ACCENTS = ["#e4572e", "#2f6fde", "#17a589", "#d4a017", "#8e44ad", "#1f2937"];

// How a stop was reached from the previous one. Stops without a mode were reached by air.
export const MODES = ["flight", "train", "car", "ship"];
// Flight numbers: a two-character (IATA, at least one letter) or three-letter (ICAO) airline
// code, then 1 to 4 digits.
export const FLIGHT_NUMBER = /^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])\d{1,4}[A-Z]?$/;

// The page holds two kinds of state:
// - travel data (places, trips, colors), which lives in a separate file the user opens and saves;
// - display preferences (theme, labels, video options), which stay in this browser.
// Every visit starts with empty travel data.
function defaults() {
  return {
    countries: {}, // id -> { color?: string }
    regions: {}, // provinces and states, id ("US-CA") -> {}
    cities: {}, // key -> {}
    places: {}, // key ("p:…") -> { name, cc, lon, lat }: the user's own places
    bodies: {}, // places beyond the Earth (the Moon and Mars), id ("moon") -> {}
    trips: [], // { id, name, stops: [{ city: key, date: "YYYY-MM-DD", mode?, flight?, note?, photos? }] }
    activeTrip: null,
    settings: {
      theme: "auto",
      view: "globe",
      colorMode: "single",
      accent: ACCENTS[0],
      labels: { countries: true, cities: true, water: true },
      graticule: true,
      showRegions: true, // color provinces and states
      video: { aspect: "16:9", quality: "1080", pace: "normal", scope: "trip", music: "calm" },
    },
  };
}

function readStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Returns whether the value was stored.
function writeStorage(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Storage unavailable (private mode, quota): the page keeps working in memory.
    if (value != null) {
      try {
        localStorage.removeItem(key); // never leave an older draft in place of this one
      } catch {}
    }
    return false;
  }
}

function withSettings(base, settings = {}) {
  const out = { ...base.settings, ...settings };
  out.labels = { ...base.settings.labels, ...(settings.labels || {}) };
  out.video = { ...base.settings.video, ...(settings.video || {}) };
  return out;
}

export const state = defaults();
state.settings = withSettings(state, readStorage(PREFS_KEY) || {});

// ---- Travel data file ------------------------------------------------------

export const FILE_FORMAT = "travel-atlas";
// `loads` counts the files opened (and new maps started), so that a save finishing after another
// file was opened does not mark that one as saved.
export const file = { name: null, handle: null, saved: "", loads: 0 };

/**
 * Serializes the travel data in the file format (readable, stable ids plus names). Photos are
 * their paths in the .zip the data is saved in (see datafile.js).
 */
export function toFileData() {
  return {
    format: FILE_FORMAT,
    version: 1,
    savedAt: new Date().toISOString(),
    style: { colorMode: state.settings.colorMode, accent: state.settings.accent },
    ...(Object.keys(state.places).length
      ? {
          places: Object.entries(state.places)
            .map(([id, p]) => ({ id, name: p.name, country: p.cc || null, lat: p.lat, lon: p.lon }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }
      : {}),
    countries: Object.entries(state.countries)
      .map(([id, v]) => ({ id, name: countryById.get(id).name, ...(v.color ? { color: v.color } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    regions: Object.keys(state.regions)
      .map((id) => {
        const r = regionById.get(id);
        return { id, name: r.name, country: r.cc };
      })
      .sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name)),
    cities: Object.keys(state.cities)
      .map((key) => {
        const c = cityByKey.get(key);
        return { id: key, name: c.name, country: c.cc || null };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    ...(Object.keys(state.bodies).length ? { beyond: ADDABLE.filter((b) => state.bodies[b.id]).map((b) => ({ id: b.id, name: b.name })) } : {}),
    trips: state.trips.map((t) => ({
      name: t.name,
      stops: t.stops.map((s, i) => ({
        city: s.city,
        name: cityByKey.get(s.city).name,
        date: s.date || null,
        // How the stop was reached; the first stop of a trip has no leg into it.
        ...(i && s.mode ? { mode: s.mode } : {}),
        ...(i && s.flight ? { flight: s.flight } : {}),
        ...(s.note ? { note: s.note } : {}),
        ...(s.photos?.length ? { photos: [...s.photos] } : {}),
      })),
    })),
  };
}

/** The paths of the photos of some trips (all of them by default), each once. */
export function photoPaths(trips = state.trips) {
  return [...new Set(trips.flatMap((t) => t.stops.flatMap((s) => s.photos || [])))];
}

/** What tells saved data from changed data: the data as written, without the time of saving. */
export function dataFingerprint(data) {
  const { savedAt, ...rest } = data;
  return JSON.stringify(rest);
}

const fingerprint = () => dataFingerprint(toFileData());

export function isDirty() {
  return fingerprint() !== file.saved;
}

/**
 * Marks the data as saved. `saved`: the fingerprint of the data written, when that was taken
 * before the write: changes made while a save was being written are not in the file, and stay
 * unsaved.
 */
export function markSaved(name, handle, saved = fingerprint()) {
  if (name) file.name = name;
  if (handle !== undefined) file.handle = handle;
  file.saved = saved;
  if (!isDirty()) writeStorage(DRAFT_KEY, null);
  notify();
}

/**
 * Loads travel data from a parsed file. Accepts the file format and the older
 * whole-state export. Unknown places are skipped and counted. Returns { skipped, missingPhotos }.
 */
export function loadFileData(data, name = null, handle = null) {
  if (!data || typeof data !== "object") throw new Error("This file has no travel data.");
  if (data.format && data.format !== FILE_FORMAT) throw new Error("This file is not a Travel Atlas data file.");
  let skipped = 0;
  // Entries are objects; a bare string is taken as an id (a city id for stops). Anything else
  // is skipped.
  const list = (x, field = "id") =>
    (Array.isArray(x) ? x : []).flatMap((v) => (v && typeof v === "object" ? [v] : typeof v === "string" ? [{ [field]: v }] : (skipped++, [])));
  // The user's own places come first, so that cities and stops can refer to them.
  const placesOut = {};
  const placeIds = new Map(); // id in the file -> id used here
  const builtIn = (id) => cityByKey.has(id) && !cityByKey.get(id).custom;
  for (const p of list(data.places)) {
    const place = cleanPlace(p);
    if (!place) {
      skipped++;
      continue;
    }
    const id = typeof p.id === "string" && PLACE_ID.test(p.id) && !placesOut[p.id] ? p.id : `p:${uid()}`;
    // References to the place by its old id follow it, unless that id names one of our cities.
    if (typeof p.id === "string" && !placeIds.has(p.id) && !builtIn(p.id)) placeIds.set(p.id, id);
    placesOut[id] = place;
  }
  const placeId = (id) => placeIds.get(id) || id;
  const known = (id) => typeof id === "string" && (Object.hasOwn(placesOut, id) || builtIn(id));
  const countriesIn = Array.isArray(data.countries)
    ? list(data.countries)
    : Object.entries(data.countries || {}).map(([id, v]) => ({ id, ...v }));
  const citiesIn = Array.isArray(data.cities) ? list(data.cities) : Object.keys(data.cities || {}).map((id) => ({ id }));
  const countriesOut = {};
  for (const c of countriesIn) {
    if (countryById.has(c.id)) countriesOut[c.id] = typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color) ? { color: c.color } : {};
    else skipped++;
  }
  const regionsOut = {};
  for (const r of list(data.regions)) {
    if (typeof r.id === "string" && regionById.has(r.id)) regionsOut[r.id] = {};
    else skipped++;
  }
  const bodiesOut = {};
  for (const b of list(data.beyond)) {
    if (typeof b.id === "string" && bodyById.get(b.id)?.addable) bodiesOut[b.id] = {};
    else skipped++;
  }
  const citiesOut = {};
  for (const c of citiesIn) {
    const id = placeId(c.id);
    if (known(id)) citiesOut[id] = {};
    else skipped++;
  }
  const tripsOut = list(data.trips).map((t) => ({
    id: uid(),
    name: typeof t.name === "string" && t.name.trim() ? t.name : "Untitled trip",
    stops: list(t.stops, "city")
      .map((s) => ({ ...s, city: placeId(s.city) }))
      .filter((s) => known(s.city) || (skipped++, false))
      .map(cleanStop),
  }));
  // Every visited place counts its country as visited, and each region its country.
  for (const id of Object.keys(citiesOut)) {
    const cc = Object.hasOwn(placesOut, id) ? placesOut[id].cc : cityByKey.get(id).cc;
    if (cc && !countriesOut[cc]) countriesOut[cc] = {};
  }
  for (const id of Object.keys(regionsOut)) countriesOut[regionById.get(id).cc] ||= {};
  // Nothing above changes the current data, so a file that fails to load leaves it as it was.
  state.places = placesOut;
  syncPlaces();
  state.countries = countriesOut;
  state.cities = citiesOut;
  // The region of every visited place counts as visited (files from before regions have none).
  state.regions = regionsOut;
  for (const key of Object.keys(citiesOut)) markRegion(cityByKey.get(key));
  state.bodies = bodiesOut;
  state.trips = tripsOut;
  state.activeTrip = tripsOut[0]?.id || null;
  const style = data.style || data.settings || {};
  if (["single", "continent", "year"].includes(style.colorMode)) state.settings.colorMode = style.colorMode;
  if (typeof style.accent === "string" && /^#[0-9a-f]{6}$/i.test(style.accent)) state.settings.accent = style.accent;
  file.name = name;
  file.handle = handle;
  file.loads++;
  markSaved();
  // The photos of the data before are let go; those the file refers to but did not bring (a
  // data file opened without its .zip) are kept as references and counted.
  const paths = photoPaths();
  forgetPhotos(new Set(paths));
  return { skipped, missingPhotos: paths.filter((p) => !photoBlob(p)).length };
}

// The user's own places: "p:" and a short id.
const PLACE_ID = /^p:[\w-]{1,40}$/;
export const PLACE_NAME_MAX = 80;
const round5 = (x) => Math.round(x * 1e5) / 1e5;

// A place as stored, or null when it has no name or no valid position. A missing or unknown
// country is looked up from the position; `country: null` means none (a place at sea).
function cleanPlace(p) {
  if (!p || typeof p !== "object") return null;
  const name = typeof p.name === "string" ? p.name.trim().slice(0, PLACE_NAME_MAX) : "";
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!name || p.lat == null || p.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const cc = p.country === null ? "" : typeof p.country === "string" && countryById.has(p.country) ? p.country : countryAtLonLat([lon, lat])?.id || "";
  return { name, cc, lon: round5(lon), lat: round5(lat) };
}

/** Brings the place registry (cityByKey, customPlaces) in line with state.places. */
export function syncPlaces() {
  for (const key of [...customPlaces.keys()])
    if (!state.places[key]) {
      customPlaces.delete(key);
      cityByKey.delete(key);
    }
  for (const [key, p] of Object.entries(state.places)) {
    let c = customPlaces.get(key);
    if (!c) {
      // The same object stays registered for a place's whole life, so edits show up everywhere.
      c = { key, pop: 0, capital: false, major: false, custom: true };
      customPlaces.set(key, c);
      cityByKey.set(key, c);
    }
    Object.assign(c, { name: p.name, cc: p.cc || "", lon: p.lon, lat: p.lat, norm: normalize(p.name) });
  }
}

// A stop as stored: flights carry no mode, and the first stop of a trip has no leg into it.
// A note and photos belong to the stop itself.
function cleanStop(s, i) {
  const out = { city: s.city, date: typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : "" };
  const note = typeof s.note === "string" ? s.note.trim().slice(0, NOTE_MAX) : "";
  if (note) out.note = note;
  // Photos embedded in older files are kept like added ones, by path.
  const paths = Array.isArray(s.photos) ? s.photos.filter(isPhoto).map((p) => (isPhotoPath(p) ? p : photoFromDataUrl(p))) : [];
  const photos = [...new Set(paths.filter(Boolean))].slice(0, PHOTOS_PER_STOP);
  if (photos.length) out.photos = photos;
  if (i === 0) return out;
  const mode = typeof s.mode === "string" ? s.mode.trim().toLowerCase() : "";
  if (MODES.includes(mode) && mode !== "flight") out.mode = mode;
  const flight = typeof s.flight === "string" ? s.flight.replace(/\s+/g, "").toUpperCase() : "";
  if (FLIGHT_NUMBER.test(flight) && !out.mode) out.flight = flight;
  return out;
}

/**
 * Runs fn, which reorders or removes stops of the trip, then resets the way of travel of each
 * stop now reached from a different city, since its old mode and flight number described
 * another leg. Those legs become flights.
 */
export function editStops(trip, fn) {
  const from = new Map(trip.stops.map((s, i) => [s, trip.stops[i - 1]?.city]));
  const out = fn();
  trip.stops.forEach((s, i) => {
    if (from.get(s) === trip.stops[i - 1]?.city) return;
    delete s.mode;
    delete s.flight;
  });
  return out;
}

const tripSignature = (t) => t.stops.map((s) => `${s.city}@${s.date}`).join(">");

/**
 * Adds imported trips (and their places). With replace, the current travel data is cleared
 * first. Trips identical to an existing one are skipped. Returns { added, duplicates }.
 */
export function importTrips(trips, { replace = false } = {}) {
  if (replace) {
    // Your own places stay where an imported trip uses them (an airport can be placed at one).
    const used = new Set(trips.flatMap((t) => t.stops.map((s) => s.city)));
    state.places = Object.fromEntries(Object.entries(state.places).filter(([key]) => used.has(key)));
    syncPlaces();
    state.countries = {};
    state.regions = {};
    state.cities = {};
    state.bodies = {};
    state.trips = [];
  }
  const seen = new Set(state.trips.map(tripSignature));
  let added = 0;
  let duplicates = 0;
  for (const t of trips) {
    const trip = { id: uid(), name: t.name || "Imported trip", stops: t.stops.filter((s) => cityByKey.has(s.city)).map(cleanStop) };
    if (trip.stops.length < 2) continue;
    if (seen.has(tripSignature(trip))) {
      duplicates++;
      continue;
    }
    seen.add(tripSignature(trip));
    state.trips.push(trip);
    markStopsVisited(trip);
    added++;
  }
  state.trips.sort((a, b) => (a.stops[0]?.date || "").localeCompare(b.stops[0]?.date || ""));
  state.activeTrip = state.trips[state.trips.length - 1]?.id || null;
  commit();
  return { added, duplicates };
}

export function newFile() {
  const d = defaults();
  state.countries = d.countries;
  state.regions = d.regions;
  state.cities = d.cities;
  state.places = d.places;
  state.bodies = d.bodies;
  state.trips = d.trips;
  state.activeTrip = null;
  file.name = null;
  file.handle = null;
  file.loads++;
  markSaved();
  forgetPhotos(new Set());
}

file.saved = fingerprint();

function draftKeys() {
  try {
    return Object.keys(localStorage).filter((k) => k === DRAFT_PREFIX || k.startsWith(`${DRAFT_PREFIX}:`));
  } catch {
    return [];
  }
}

const hasTravels = (d) => !!(d && (d.countries?.length || d.regions?.length || d.cities?.length || d.places?.length || d.beyond?.length || d.trips?.length));
const listOf = (x) => (Array.isArray(x) ? x : []);

/**
 * Unsaved data left over from a tab that is no longer open, the latest first, as { key, data },
 * or null.
 */
export async function pendingDraft() {
  let open = null;
  try {
    const locks = await navigator.locks?.query();
    if (locks) open = new Set(locks.held.map((l) => l.name));
  } catch {}
  const left = [];
  for (const key of draftKeys()) {
    if (key === DRAFT_KEY || open?.has(TAB_LOCK + key.slice(DRAFT_PREFIX.length + 1))) continue;
    const data = readStorage(key);
    if (hasTravels(data)) left.push({ key, data });
    else writeStorage(key, null);
  }
  left.sort((a, b) => String(b.data.savedAt || "").localeCompare(String(a.data.savedAt || "")));
  return left[0] || null;
}

/** Lets go of a draft left over from another visit, and of the photos only it needed. */
export function discardDraft(key) {
  writeStorage(key, null);
  tidyUnsavedPhotos();
}

/**
 * Brings the photos kept in the browser in line with the drafts: this tab's unsaved photos are
 * kept, and photos no draft refers to (of any tab, open or not) are let go.
 */
export function tidyUnsavedPhotos() {
  const keep = new Set();
  for (const key of draftKeys())
    for (const t of listOf(readStorage(key)?.trips)) for (const s of listOf(t?.stops)) for (const p of listOf(s?.photos)) if (typeof p === "string") keep.add(p);
  return keepUnsavedPhotos(isDirty() ? photoPaths() : [], keep);
}

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  syncPlaces();
  for (const fn of listeners) fn(state);
}

let saveTimer;
export function commit() {
  notify();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistLocal, 300);
}

/**
 * Writes preferences and any unsaved travel data to browser storage. The data refers to its
 * photos by path; the photos themselves go to the browser's database (see photos.js).
 */
export function persistLocal() {
  clearTimeout(saveTimer);
  const { colorMode, accent, ...prefs } = state.settings;
  writeStorage(PREFS_KEY, prefs);
  writeStorage(DRAFT_KEY, isDirty() ? toFileData() : null);
  tidyUnsavedPhotos();
}

/**
 * Adds or removes a country. Removing a country also removes its regions and cities; returns
 * how many cities.
 */
export function toggleCountry(id, on = !state.countries[id]) {
  let removedCities = 0;
  if (on) state.countries[id] = state.countries[id] || {};
  else {
    delete state.countries[id];
    for (const rid of Object.keys(state.regions)) if (regionById.get(rid).cc === id) delete state.regions[rid];
    for (const key of Object.keys(state.cities))
      if (cityByKey.get(key).cc === id) {
        delete state.cities[key];
        removedCities++;
      }
  }
  commit();
  return removedCities;
}

/**
 * Adds or removes a province or state. Adding one adds its country; removing one also removes
 * the cities in it (they would light it up again). Returns how many cities were removed.
 */
export function toggleRegion(id, on = !state.regions[id]) {
  const r = regionById.get(id);
  if (!r) return 0;
  let removedCities = 0;
  if (on) {
    state.regions[id] = {};
    state.countries[r.cc] ||= {};
  } else {
    delete state.regions[id];
    for (const key of Object.keys(state.cities))
      if (regionOfCity(cityByKey.get(key)) === r) {
        delete state.cities[key];
        removedCities++;
      }
  }
  commit();
  return removedCities;
}

/** Adds or removes the Moon or Mars. */
export function toggleBody(id, on = !state.bodies[id]) {
  if (!bodyById.get(id)?.addable) return;
  if (on) state.bodies[id] = {};
  else delete state.bodies[id];
  commit();
}

// A visited place lights up its region.
function markRegion(c) {
  const r = regionOfCity(c);
  if (r) state.regions[r.id] = state.regions[r.id] || {};
}

export function toggleCity(key, on = !state.cities[key]) {
  if (on) {
    state.cities[key] = {};
    const c = cityByKey.get(key);
    if (c.cc && !state.countries[c.cc]) state.countries[c.cc] = {};
    markRegion(c);
  } else delete state.cities[key];
  commit();
}

// ---- The user's own places -------------------------------------------------

/** Adds a place of the user's own at a lon/lat point and marks it visited. Returns its key. */
export function addPlace(name, [lon, lat]) {
  const place = cleanPlace({ name: name || "New place", lon, lat });
  if (!place) return null;
  const key = `p:${uid()}`;
  state.places[key] = place;
  state.cities[key] = {};
  const cc = place.cc;
  if (cc && !state.countries[cc]) state.countries[cc] = {};
  syncPlaces();
  markRegion(cityByKey.get(key));
  commit();
  return key;
}

/** Changes a place's name, country ("" for none) or position ({ lonlat }). */
export function updatePlace(key, { name, cc, lonlat }) {
  const p = state.places[key];
  if (!p) return;
  if (name != null) p.name = name.trim().slice(0, PLACE_NAME_MAX) || p.name;
  if (lonlat) Object.assign(p, cleanPlace({ name: p.name, lon: lonlat[0], lat: lonlat[1] }));
  if (cc != null) p.cc = countryById.has(cc) ? cc : "";
  if (state.cities[key] && p.cc && !state.countries[p.cc]) state.countries[p.cc] = {};
  if (state.cities[key]) {
    syncPlaces();
    markRegion(cityByKey.get(key));
  }
  commit();
}

/** Deletes a place and the trip stops at it. Returns how many stops were removed. */
export function deletePlace(key) {
  let removed = 0;
  for (const t of state.trips) {
    const n = t.stops.length;
    editStops(t, () => (t.stops = t.stops.filter((s) => s.city !== key)));
    removed += n - t.stops.length;
  }
  delete state.places[key];
  delete state.cities[key];
  commit();
  return removed;
}

export function setCountryColor(id, color) {
  if (!state.countries[id]) state.countries[id] = {};
  if (color) state.countries[id].color = color;
  else delete state.countries[id].color;
  commit();
}

// ---- Trips -----------------------------------------------------------------


export function addTrip(name = "New trip") {
  const trip = { id: uid(), name, stops: [] };
  state.trips.push(trip);
  state.activeTrip = trip.id;
  commit();
  return trip;
}

export function activeTrip() {
  return state.trips.find((t) => t.id === state.activeTrip) || null;
}

export function deleteTrip(id) {
  state.trips = state.trips.filter((t) => t.id !== id);
  if (state.activeTrip === id) state.activeTrip = state.trips[0]?.id || null;
  commit();
}

export function addStop(trip, cityKey, date) {
  const last = trip.stops[trip.stops.length - 1];
  trip.stops.push({ city: cityKey, date: date || last?.date || today() });
  markStopsVisited(trip);
  commit();
}

export function markStopsVisited(trip) {
  for (const s of trip.stops) {
    state.cities[s.city] = state.cities[s.city] || {};
    const c = cityByKey.get(s.city);
    if (c.cc) state.countries[c.cc] = state.countries[c.cc] || {};
    markRegion(c);
  }
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function legDistanceKm(a, b) {
  return geoDistance([a.lon, a.lat], [b.lon, b.lat]) * EARTH_RADIUS_KM;
}

/** Length of a trip in km; with `mode`, only the legs traveled that way. */
export function tripDistanceKm(trip, mode) {
  let km = 0;
  for (let i = 1; i < trip.stops.length; i++) {
    if (mode && (trip.stops[i].mode || "flight") !== mode) continue;
    km += legDistanceKm(cityByKey.get(trip.stops[i - 1].city), cityByKey.get(trip.stops[i].city));
  }
  return km;
}

export function tripDates(trip) {
  const ds = trip.stops.map((s) => s.date).filter(Boolean).sort();
  return ds.length ? [ds[0], ds[ds.length - 1]] : null;
}

// Earliest dated visit per country, from trip stops.
export function firstVisitByCountry() {
  const out = new Map();
  for (const t of state.trips)
    for (const s of t.stops) {
      if (!s.date) continue;
      const cc = cityByKey.get(s.city).cc;
      if (cc && (!out.has(cc) || s.date < out.get(cc))) out.set(cc, s.date);
    }
  return out;
}

// ---- Stats -----------------------------------------------------------------

/** Totals for the travel data, or for a view of it such as the map at the end of a year. */
export function stats(data = state) {
  const visited = countries.filter((c) => data.countries[c.id]);
  const continents = new Set(visited.map((c) => c.continent).filter((c) => CONTINENTS.includes(c)));
  const km = data.trips.reduce((sum, t) => sum + tripDistanceKm(t, "flight"), 0);
  return {
    // Countries and regions alike (Taiwan, Hong Kong, Greenland...); `states` are the ones the
    // share of the world is counted from.
    countries: visited.length,
    states: visited.filter((c) => c.counted).length,
    regions: Object.keys(data.regions || {}).length,
    cities: Object.keys(data.cities).length,
    beyond: Object.keys(data.bodies || {}).length,
    continents: continents.size,
    km,
  };
}

/** The year of the first dated visit to each country, region, and city or place. */
export function visitYears() {
  const countries = new Map();
  const regions = new Map();
  const cities = new Map();
  for (const t of state.trips)
    for (const s of t.stops) {
      if (!s.date) continue;
      const y = +s.date.slice(0, 4);
      if (!(cities.get(s.city) <= y)) cities.set(s.city, y);
      const c = cityByKey.get(s.city);
      if (c.cc && !(countries.get(c.cc) <= y)) countries.set(c.cc, y);
      const r = regionOfCity(c);
      if (r && !(regions.get(r.id) <= y)) regions.set(r.id, y);
    }
  return { countries, regions, cities };
}

/**
 * The travel data as it stood at the end of a year: places count from their first dated visit,
 * and trips keep the stops reached by then. Places without a dated visit are left out.
 */
export function asOfYear(year, years = visitYears()) {
  const keep = (obj, seen) => Object.fromEntries(Object.entries(obj).filter(([k]) => seen.get(k) <= year));
  const end = `${year}-12-31`;
  return {
    ...state,
    countries: keep(state.countries, years.countries),
    regions: keep(state.regions, years.regions),
    cities: keep(state.cities, years.cities),
    // The Moon and Mars have no dated visits.
    bodies: {},
    trips: state.trips.map((t) => ({ ...t, stops: t.stops.filter((s) => s.date && s.date <= end) })),
  };
}

export function sampleData() {
  const place = { id: "p:iguazu", name: "Iguazu Falls", country: "ARG", lat: -25.6953, lon: -54.4367 };
  const key = (name) => (name === place.name ? place.id : cities.find((c) => c.name === name)?.key);
  const trip = (name, stops) => ({ name, stops: stops.map(([c, date, mode]) => ({ city: key(c), date, ...(mode ? { mode } : {}) })).filter((s) => s.city) });
  const data = {
    trips: [
      trip("Around the world", [
        ["Shanghai", "2025-03-02"],
        ["Tokyo", "2025-03-06"],
        ["San Francisco", "2025-03-12"],
        ["New York", "2025-03-18"],
        ["London", "2025-03-24"],
        ["Paris", "2025-03-28", "train"],
        ["Istanbul", "2025-04-02"],
        ["Dubai", "2025-04-06"],
        ["Singapore", "2025-04-10"],
        ["Shanghai", "2025-04-14"],
      ]),
      trip("Southern summer", [
        ["Beijing", "2026-01-10"],
        ["Sydney", "2026-01-12"],
        ["Auckland", "2026-01-20"],
        ["Santiago", "2026-01-26"],
        ["Iguazu Falls", "2026-01-29"],
        ["Buenos Aires", "2026-02-01"],
        ["Rio de Janeiro", "2026-02-06"],
        ["Cape Town", "2026-02-12"],
        ["Beijing", "2026-02-20"],
      ]),
    ],
  };
  const keys = new Set(data.trips.flatMap((t) => t.stops.map((s) => s.city)));
  data.format = FILE_FORMAT;
  data.places = [place];
  data.cities = [...keys].map((id) => ({ id }));
  data.countries = [...new Set([...keys].map((k) => (k === place.id ? place.country : cityByKey.get(k).cc)))].map((id) => ({ id }));
  return data;
}
