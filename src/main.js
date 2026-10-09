import {
  countries,
  cities,
  allCities,
  extraCities,
  customPlaces,
  countryById,
  cityByKey,
  countedTotal,
  CONTINENTS,
  normalize,
  nearestCity,
  countryAtLonLat,
  regions,
  regionById,
  regionsByCountry,
  regionOfCity,
  regionUnit,
  regionZoom,
} from "./data.js";
import {
  state,
  subscribe,
  commit,
  toggleCountry,
  toggleRegion,
  toggleCity,
  toggleBody,
  setCountryColor,
  file,
  isDirty,
  loadFileData,
  newFile,
  pendingDraft,
  persistLocal,
  discardDraft,
  tidyUnsavedPhotos,
  addTrip,
  activeTrip,
  deleteTrip,
  addStop,
  tripDistanceKm,
  legDistanceKm,
  tripDates,
  stats,
  sampleData,
  firstVisitByCountry,
  toFileData,
  importTrips,
  ACCENTS,
  MODES,
  FLIGHT_NUMBER,
  editStops,
  visitYears,
  asOfYear,
  photoPaths,
  addPlace,
  updatePlace,
  deletePlace,
  PLACE_NAME_MAX,
} from "./state.js";
import { MapView } from "./map.js";
import { drawMap, countryColor, CONTINENT_COLORS, yearLegend, THEMES } from "./render.js";
import { buildTimeline, drawHud, formatDate, formatKm } from "./animation.js";
import { exportVideo, download, supportedFormat } from "./export.js";
import { openFile, saveFile, readFile, pickFile } from "./datafile.js";
import { readTable, parseFlights, cityForAirport, buildTrips, isImportFile, hasCjk, IMPORT_EXTENSIONS } from "./flights.js";
import { airports } from "./airports.js";
import { flagImage as flag } from "./flags.js";
import { ADDABLE, bodyById, SPACE_MIN_K } from "./space.js";
import { photoFromFile, photoUrl, photoFailed, photoBlob, dropPhoto, preloadPhotos, prunePhotos, drawMemory, restoreUnsavedPhotos, PHOTOS_PER_STOP, NOTE_MAX } from "./photos.js";
import { drawPoster, POSTER_SIZES, POSTER_TITLE_MAX } from "./poster.js";
import { renderMusic, prepareMusic, readMusicFile, MusicPlayer, MUSIC_CHOICES } from "./music.js";

// ---- Helpers ---------------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "onactivate") {
      // Clickable non-button element: also reachable and usable from the keyboard.
      el.addEventListener("click", v);
      el.tabIndex = 0;
      el.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === el) (e.preventDefault(), v(e));
      });
    } else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const $ = (sel) => document.querySelector(sel);
const ICON_CHECK = '<svg viewBox="0 0 12 12" width="11" height="11"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m10.6 10.6 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_PIN = '<svg viewBox="0 0 16 16" width="12" height="12"><circle cx="8" cy="8" r="3.2" fill="currentColor"/></svg>';
// The user's own places are diamonds, on the map and in lists.
const ICON_PLACE = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3.6 12.4 8 8 12.4 3.6 8z" fill="currentColor"/></svg>';
const ICON_ZOOM_IN = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.6"/><path d="m10.4 10.4 3.6 3.6M7 5v4M5 7h4"/></svg>';
const ICON_MOVE = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8v12.4M1.8 8h12.4M6 3.8l2-2 2 2M6 12.2l2 2 2-2M3.8 6l-2 2 2 2M12.2 6l2 2-2 2"/></svg>';
const ICON_UP = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_X = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4.5 3v10l8.5-5z" fill="currentColor"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 12 12" width="11" height="11"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const MODE_ICONS = {
  flight: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1.4c.6 0 1 .5 1 1.3v3.5l5 3v1.5l-5-1.4v2.9l1.5 1.1v1.2L8 13.8l-2.5.7v-1.2L7 12.2V9.3l-5 1.4V9.2l5-3V2.7c0-.8.4-1.3 1-1.3z" fill="currentColor"/></svg>',
  train: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="1.6" width="9" height="10" rx="2.2"/><path d="M3.5 7h9M5.6 11.6 4 14.4m6.4-2.8 1.6 2.8"/><circle cx="6" cy="9.3" r=".5" fill="currentColor"/><circle cx="10" cy="9.3" r=".5" fill="currentColor"/></svg>',
  car: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.4 11.2V8.6l1.5-3.7c.2-.6.8-1 1.4-1h5.4c.6 0 1.2.4 1.4 1l1.5 3.7v2.6zM2.4 8.6h11.2M4.2 11.2v1.6m7.6-1.6v1.6"/><circle cx="5" cy="10" r=".4" fill="currentColor"/><circle cx="11" cy="10" r=".4" fill="currentColor"/></svg>',
  ship: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 9.4h12.4l-1.7 3.6H3.5zM4.4 9.4V6.4h7.2v3M7 6.4V3.4h2.4v3"/></svg>',
};
const MODE_NAMES = { flight: "By plane", train: "By train", car: "By car", ship: "By ship" };
const ICON_PHOTO = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="1.8" y="3.2" width="12.4" height="9.6" rx="2"/><path d="m2.4 11.6 3.4-3.4 2.6 2.4 1.8-1.6 3.4 2.8" stroke-linecap="round"/><circle cx="10.6" cy="6.2" r="1.1"/></svg>';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Two-step button: the first click arms it, a second click within 3 s runs the action.
function confirmButton(label, armedLabel, action, attrs = {}) {
  let timer;
  const btn = h("button", {
    ...attrs,
    onclick: () => {
      if (btn.dataset.armed) {
        clearTimeout(timer);
        action();
        return;
      }
      btn.dataset.armed = "1";
      btn.textContent = armedLabel;
      timer = setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = label;
      }, 3000);
    },
  }, label);
  return btn;
}

const isoById = new Map();

let toastTimer;
// Short status message; `action` ({ label, run }) adds a button such as Undo.
function toast(msg, action) {
  const t = $("#toast");
  t.replaceChildren(h("span", {}, msg));
  if (action)
    t.append(
      h(
        "button",
        {
          onclick: () => {
            t.classList.remove("show", "actionable");
            action.run();
          },
        },
        action.label
      )
    );
  t.classList.toggle("actionable", !!action);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show", "actionable"), action ? 5000 : 2200);
}

// Runs a removal and offers to undo it. `fn` changes the travel data and returns the message.
function withUndo(fn) {
  const snap = JSON.stringify({ countries: state.countries, regions: state.regions, cities: state.cities, places: state.places, bodies: state.bodies, trips: state.trips, activeTrip: state.activeTrip });
  const msg = fn();
  toast(msg, {
    label: "Undo",
    run: () => {
      Object.assign(state, JSON.parse(snap));
      commit();
    },
  });
}

function setCountry(c, on) {
  if (on) {
    toggleCountry(c.id, true);
    toast(`Added ${c.name}`);
    return;
  }
  withUndo(() => {
    const n = toggleCountry(c.id, false);
    return `Removed ${c.name}${n ? ` and ${n} ${n === 1 ? "city" : "cities"}` : ""}`;
  });
}

// "the Moon", "the Sun", "Mars"
const theName = (b) => (["moon", "sun", "earth"].includes(b.id) ? `the ${b.name}` : b.name);

function setBody(b, on) {
  if (on) {
    toggleBody(b.id, true);
    toast(`Added ${theName(b)}`);
    return;
  }
  withUndo(() => (toggleBody(b.id, false), `Removed ${theName(b)}`));
}

function setCity(c, on) {
  if (on) {
    const country = state.countries[c.cc] ? null : countryById.get(c.cc);
    toggleCity(c.key, true);
    toast(country ? `Added ${c.name}, ${country.name}` : `Added ${c.name}`);
    return;
  }
  withUndo(() => (toggleCity(c.key, false), `Removed ${c.name}`));
}

function setRegion(r, on) {
  if (on) {
    const country = state.countries[r.cc] ? null : countryById.get(r.cc);
    toggleRegion(r.id, true);
    toast(country ? `Added ${r.name}, ${country.name}` : `Added ${r.name}`);
    return;
  }
  withUndo(() => {
    const n = toggleRegion(r.id, false);
    return `Removed ${r.name}${n ? ` and ${n} ${n === 1 ? "city" : "cities"}` : ""}`;
  });
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// "State · United States"
const regionMeta = (r) => `${capitalize(regionUnit(r.cc, 1))} · ${countryById.get(r.cc).name}`;
// "3/51 states" for a country with visited regions, or "".
function regionCount(cc) {
  const list = regionsByCountry.get(cc);
  const n = list ? list.filter((r) => state.regions[r.id]).length : 0;
  return n ? `${n}/${list.length} ${regionUnit(cc)}` : "";
}

// Add/remove toggle used in search results and the place card.
function addButton(on, name, onToggle, big = false) {
  return h(
    "button",
    {
      class: `add-pill${big ? " big" : ""}${on ? " on" : ""}`,
      "aria-pressed": String(on),
      "aria-label": on ? `Remove ${name}` : `Add ${name}`,
      title: on ? `Remove ${name} from your map` : `Add ${name} to your map`,
      onclick: (e) => {
        e.stopPropagation();
        onToggle(!on);
      },
    },
    h("span", { class: "i", html: on ? ICON_CHECK : ICON_PLUS }),
    h("span", { class: "lbl", "data-on": "Added", "data-off": "Add" })
  );
}

function fmtPop(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

// ---- Theme -----------------------------------------------------------------

const media = window.matchMedia("(prefers-color-scheme: dark)");
// A host page (e.g. the claude.ai viewer) may set its own theme before we run; "Auto" follows it.
const hostTheme = document.documentElement.dataset.theme;
function applyTheme() {
  const t = state.settings.theme;
  const auto = hostTheme ? hostTheme === "dark" : media.matches;
  const dark = t === "dark" || (t === "auto" && auto);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.setProperty("--accent", state.settings.accent);
  map?.invalidate();
}
media.addEventListener?.("change", applyTheme);

// ---- Map -------------------------------------------------------------------

let ui = { tab: "places", query: "", kbd: 0, results: [], selected: null, cardQuery: "", cardList: "cities", keepCard: null, placeMark: null, memo: null, poster: { format: "landscape", title: "My travels" } };

// Clicking the map selects a place and opens its card; clicking empty ocean closes it.
const map = new MapView($("#map"), {
  getState: () => shownState(),
  onClick: (hit, e) => {
    if (picking) {
      if (hit.lonlat) placePicked(hit.lonlat);
      else toast("Click a spot on the map");
      return;
    }
    if (hit.body) selectPlace({ body: hit.body.id });
    else if (hit.city) selectPlace({ city: hit.city.key });
    // `spot`: the card can offer to add a place of the user's own where they clicked.
    else if (hit.region) selectPlace({ region: hit.region.id, anchor: hit.lonlat, spot: !!hit.lonlat });
    else if (hit.country) selectPlace({ country: hit.country.id, anchor: hit.lonlat, spot: !!hit.lonlat });
    else selectPlace(null);
    // After a tap, the browser sends a click to the same spot, where the new card may now be
    // (on phones the sheet is still sliding away while the card is placed). It must not land there.
    if (e?.pointerType === "touch") shieldCard();
  },
  onDraw: () => {
    // The Earth's card is for the Earth as one of the planets: zoomed back in, its places take over.
    if (ui.selected?.body === "earth" && !map.spaceHits.some((p) => p.body.id === "earth")) selectPlace(null);
    positionCard();
    placePickMark();
  },
  onHover: (hover, e) => {
    const tip = $("#tooltip");
    const sel = ui.selected;
    const isSelected = sel && (hover.body ? sel.body === hover.body.id : hover.city ? sel.city === hover.city.key : hover.region ? sel.region === hover.region.id : sel.country === hover.country?.id);
    if ((!hover.country && !hover.city && !hover.body) || isSelected || picking) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = "";
    if (hover.body) {
      const b = hover.body;
      tip.append(h("b", {}, b.name), h("small", {}, `${b.kind}${state.bodies[b.id] ? " · Added" : ""}`));
    } else if (hover.city) {
      const c = hover.city;
      const country = countryById.get(c.cc);
      const facts = c.custom ? [country?.name, "Your place"] : [country?.name, c.capital && "Capital", `${fmtPop(c.pop)} people`];
      if (state.cities[c.key]) facts.push("Added");
      tip.append(h("b", {}, c.name), h("small", {}, facts.filter(Boolean).join(" · ")));
    } else if (hover.region) {
      const r = hover.region;
      tip.append(h("b", {}, flag(isoById.get(r.cc)), r.name), h("small", {}, `${regionMeta(r)}${state.regions[r.id] ? " · Added" : ""}`));
    } else {
      const c = hover.country;
      tip.append(h("b", {}, flag(isoById.get(c.id)), c.name), h("small", {}, `${c.region}${state.countries[c.id] ? " · Added" : ""}`));
    }
    tip.hidden = false;
    if (e) {
      const x = Math.min(e.clientX, window.innerWidth - tip.offsetWidth - 24);
      tip.style.left = `${x}px`;
      tip.style.top = `${e.clientY}px`;
    }
  },
});

// ---- Place card ------------------------------------------------------------

// All cities per country (major and smaller places), largest first, for the country card.
// Sorted the first time a card needs them rather than while the page starts.
let byCountry = null;
function citiesOfCountry(cc) {
  if (!byCountry) {
    byCountry = new Map();
    for (const c of [...allCities].sort((a, b) => b.pop - a.pop)) {
      if (!byCountry.has(c.cc)) byCountry.set(c.cc, []);
      byCountry.get(c.cc).push(c);
    }
  }
  return byCountry.get(cc) || [];
}
const CARD_CITIES = 18;

/**
 * How well a normalized name matches a typed query: 0 the name starts with it, 1 a word in
 * the name starts with it ("iguacu" finds "Foz do Iguaçu"), 2 it appears inside the name
 * (only for three letters or more), -1 no match.
 */
function matchRank(name, q) {
  if (name.startsWith(q)) return 0;
  if (name.split(/[\s\-'’().,/]+/).some((w) => w.startsWith(q))) return 1;
  return q.length >= 3 && name.includes(q) ? 2 : -1;
}

// The place a selection is about: a city or place, a province or state, a country, or the Moon,
// the Sun or a planet.
const placeOf = (sel) => (sel.body ? bodyById.get(sel.body) : sel.city ? cityByKey.get(sel.city) : sel.region ? regionById.get(sel.region) : countryById.get(sel.country));

/**
 * Selects a place ({ country: id }, { region: id } or { city: key }, optional anchor lon/lat)
 * and shows its card.
 */
function selectPlace(sel, { fly = false } = {}) {
  if (sel && !placeOf(sel)) sel = null;
  if (sel && !sel.anchor && !sel.body) {
    const c = placeOf(sel);
    sel.anchor = sel.city ? [c.lon, c.lat] : c.label;
  }
  if (ui.selected?.country !== sel?.country || ui.selected?.region !== sel?.region || sel?.city) {
    ui.cardQuery = "";
    ui.cardList = "cities";
  }
  if (sel?.city !== ui.placeMark?.key) ui.placeMark = null;
  ui.selected = sel;
  map.selected = sel ? (sel.body ? { body: sel.body } : sel.city ? { city: sel.city } : sel.region ? { region: sel.region } : { country: sel.country }) : null;
  map.stopSpin();
  // On phones the panel is a bottom sheet; tuck it away so the place and its card are visible.
  if (sel && window.innerWidth <= 760 && !$("#panel").classList.contains("collapsed")) {
    document.activeElement?.blur();
    $("#panel").classList.add("collapsed");
    updateInset();
  }
  if (fly && sel) {
    if (sel.body) {
      // Far enough out to see it: the Moon next to the Earth, the rest with the whole solar system.
      if (map.view.morph > 0) {
        state.settings.view = "globe";
        renderViewToggle();
      }
      map.showSpace(sel.body === "moon" ? Math.min(map.view.k, 0.24) : SPACE_MIN_K);
    } else if (sel.city) map.flyTo(sel.anchor, Math.max(map.view.k, 4));
    else if (sel.region) {
      const r = regionById.get(sel.region);
      // Close enough to see the regions around it.
      map.flyTo(sel.anchor, Math.max(zoomFor(r), regionZoom(countryById.get(r.cc))));
    } else map.flyTo(sel.anchor, zoomFor(countryById.get(sel.country)));
  }
  $("#tooltip").hidden = true;
  renderCard();
  markSelectedRows();
  map.invalidate();
}

let shieldTimer = null;
function shieldCard() {
  const card = $("#place-card");
  card.style.pointerEvents = "none";
  clearTimeout(shieldTimer);
  shieldTimer = setTimeout(() => (card.style.pointerEvents = ""), 450);
}

function renderCard() {
  const card = $("#place-card");
  const sel = ui.selected;
  // A rename shows in the name field already; rebuilding the card would lose the keyboard focus
  // that Tab is moving to the next field.
  if (ui.keepCard && ui.keepCard === sel?.city) return void card.setAttribute("aria-label", cityByKey.get(sel.city)?.name || "");
  // As with the panel, rebuilding the card under a pressed pointer would swallow its click
  // (for example on Delete right after renaming the place). Removing a focused field while
  // rebuilding can commit it and ask for another rebuild, which waits for this one.
  if (pointerDown || cardBusy) return void (cardPending = true);
  cardPending = false;
  cardBusy = true;
  try {
    buildCard(card, sel);
  } finally {
    cardBusy = false;
  }
  if (cardPending && !pointerDown) renderCard();
}

function buildCard(card, sel) {
  if (!sel || player) {
    card.hidden = true;
    return;
  }
  const place = placeOf(sel);
  if (!place) {
    // The place was deleted (for example by Undo).
    ui.selected = map.selected = null;
    card.hidden = true;
    return;
  }
  // Keep typing in a text field of the card across the rebuild.
  const active = document.activeElement;
  const focused = card.contains(active) && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const scroll = card.querySelector(".chips")?.scrollTop || 0;
  card.replaceChildren(
    h("button", { class: "icon-btn card-close", "aria-label": "Close", title: "Close (Esc)", html: ICON_X, onclick: () => selectPlace(null) }),
    ...(sel.body ? bodyCard(place) : place.custom ? placeCard(place) : sel.city ? cityCard(place) : sel.region ? regionCard(place) : countryCard(place)).filter(Boolean),
    h("span", { class: "card-arrow", "aria-hidden": "true" })
  );
  card.setAttribute("aria-label", place.name);
  card.hidden = false;
  const chips = card.querySelector(".chips");
  if (chips) chips.scrollTop = scroll;
  const input = focused && document.getElementById(focused.id);
  if (input && card.contains(input)) {
    input.focus();
    if (focused.start != null && input.setSelectionRange) input.setSelectionRange(focused.start, focused.end);
  }
  positionCard();
}

// Cities for a card (of a country or a region): the largest ones, or those matching what was typed.
function cardCities(all) {
  const q = normalize((ui.cardQuery || "").trim());
  if (!q) return all.slice(0, CARD_CITIES);
  const hits = [];
  for (const c of all) {
    const r = matchRank(c.norm, q);
    if (r >= 0) hits.push([r, c]);
  }
  return hits
    .sort((a, b) => a[0] - b[0] || b[1].pop - a[1].pop)
    .slice(0, 40)
    .map(([, c]) => c);
}

// A country's provinces or states for its card: all of them, or those matching what was typed.
function cardRegions(cc) {
  const all = regionsByCountry.get(cc) || [];
  const q = normalize((ui.cardQuery || "").trim());
  if (!q) return all;
  return all
    .map((r) => [matchRank(r.norm, q), r])
    .filter(([m]) => m >= 0)
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .map(([, r]) => r);
}

// The cities in a region, largest first; worked out when its card first opens.
const citiesByRegion = new Map();
function regionCities(r) {
  if (!citiesByRegion.has(r.id)) {
    // Cities are placed in a region up to 40 km outside its outline; a degree of margin covers that.
    const [[x0, y0], [x1, y1]] = r.bounds;
    const near = (c) => c.lat >= y0 - 1 && c.lat <= y1 + 1 && (x0 <= x1 ? c.lon >= x0 - 1 && c.lon <= x1 + 1 : c.lon >= x0 - 1 || c.lon <= x1 + 1);
    citiesByRegion.set(r.id, citiesOfCountry(r.cc).filter((c) => near(c) && regionOfCity(c) === r));
  }
  return citiesByRegion.get(r.id);
}

function countryMeta(c) {
  return c.pop > 0 ? `${c.region} · ${fmtPop(c.pop)} people` : c.region;
}

const cityChip = (ci) => {
  const on = !!state.cities[ci.key];
  return h(
    "button",
    { class: `chip${on ? " on" : ""}`, "aria-pressed": String(on), title: `${on ? "Remove" : "Add"} ${ci.name} · ${fmtPop(ci.pop)} people`, onclick: () => setCity(ci, !on) },
    h("span", { class: "i", html: on ? ICON_CHECK : ICON_PLUS }),
    ci.name
  );
};

const regionChip = (r) => {
  const on = !!state.regions[r.id];
  return h(
    "button",
    { class: `chip${on ? " on" : ""}`, "aria-pressed": String(on), title: `${on ? "Remove" : "Add"} ${r.name}`, onclick: () => setRegion(r, !on) },
    h("span", { class: "i", html: on ? ICON_CHECK : ICON_PLUS }),
    r.name
  );
};

/**
 * The pick list at the bottom of a card: chips to add with one click, a field to narrow them
 * down (Enter adds the first one not added yet), and optionally a switch between lists.
 */
function cardPicker({ heading, switcher, total, items, chip, isOn, add, placeholder, empty }) {
  return h(
    "div",
    { class: "card-cities" },
    switcher || null,
    h("small", {}, heading),
    total > 6
      ? h(
          "div",
          { class: "search card-search" },
          h("span", { html: ICON_SEARCH }),
          h("input", {
            id: "card-city-search",
            type: "search",
            placeholder,
            "aria-label": placeholder.replace(/^Type to find/, "Find"),
            autocomplete: "off",
            spellcheck: "false",
            value: ui.cardQuery || "",
            oninput: (e) => {
              ui.cardQuery = e.target.value;
              renderCard();
            },
            onkeydown: (e) => {
              if (e.key === "Enter") {
                const first = items.find((x) => !isOn(x));
                if (first) add(first);
              } else if (e.key === "Escape") {
                if (!ui.cardQuery) return selectPlace(null);
                ui.cardQuery = "";
                renderCard();
              }
            },
          })
        )
      : null,
    items.length ? h("div", { class: "chips" }, items.map(chip)) : h("p", { class: "card-facts" }, empty)
  );
}

// The country card's pick list: its cities, or its provinces or states.
function countryPicker(c) {
  const units = regionUnit(c.id);
  const regionList = regionsByCountry.get(c.id);
  const showRegions = !!regionList && ui.cardList === "regions";
  const switcher = regionList
    ? h(
        "div",
        { class: "segmented card-switch", role: "group", "aria-label": "List" },
        [
          ["cities", "Cities"],
          ["regions", capitalize(units)],
        ].map(([v, label]) =>
          h(
            "button",
            {
              class: ui.cardList === v ? "active" : null,
              "aria-pressed": String(ui.cardList === v),
              onclick: () => {
                if (ui.cardList === v) return;
                ui.cardList = v;
                ui.cardQuery = "";
                renderCard();
              },
            },
            label
          )
        )
      )
    : null;
  const q = (ui.cardQuery || "").trim();
  if (showRegions) {
    const n = regionList.filter((r) => state.regions[r.id]).length;
    return cardPicker({
      heading: q ? `${capitalize(units)} matching “${q}”` : n ? `${n} of ${regionList.length} added` : `${regionList.length} in all`,
      switcher,
      total: regionList.length,
      items: cardRegions(c.id),
      chip: regionChip,
      isOn: (r) => state.regions[r.id],
      add: (r) => setRegion(r, true),
      placeholder: `Type to find a ${regionUnit(c.id, 1)} in ${c.name}`,
      empty: "Nothing by that name. Try another spelling.",
    });
  }
  const all = citiesOfCountry(c.id);
  if (!all.length) return switcher;
  const top = cardCities(all);
  return cardPicker({
    heading: q ? `Cities matching “${q}”` : all.length > top.length ? `Largest cities · ${all.length.toLocaleString("en-US")} in all` : "Cities",
    switcher,
    total: all.length,
    items: top,
    chip: cityChip,
    isOn: (ci) => state.cities[ci.key],
    add: (ci) => setCity(ci, true),
    placeholder: `Type to find a city in ${c.name}`,
    empty: "No city by that name. Try another spelling.",
  });
}

const spotLink = () =>
  ui.selected?.spot
    ? h(
        "button",
        { class: "link card-spot", title: "Mark this spot as a place of your own, such as a park, a beach or a home", onclick: () => createPlaceAt(ui.selected.anchor) },
        h("span", { class: "i", html: ICON_PLACE }),
        "Add a place of your own here"
      )
    : null;

function countryCard(c) {
  const on = !!state.countries[c.id];
  const facts = [];
  const first = firstVisitByCountry().get(c.id);
  if (on && first) facts.push(`First visit ${formatDate(first)}`);
  const regionsAdded = regionCount(c.id);
  if (regionsAdded) facts.push(regionsAdded);
  const added = Object.keys(state.cities).filter((k) => cityByKey.get(k).cc === c.id).length;
  if (added) facts.push(`${added} ${added === 1 ? "city" : "cities"} added`);
  const color = countryColor(c.id, state, firstVisitByCountry());
  return [
    h("div", { class: "card-head" }, h("span", { class: "card-flag" }, flag(isoById.get(c.id)) || h("span", { html: ICON_PIN })), h("div", { class: "card-title" }, h("b", {}, c.name), h("small", {}, countryMeta(c)))),
    facts.length ? h("p", { class: "card-facts" }, facts.join(" · ")) : null,
    h(
      "div",
      { class: "card-actions" },
      addButton(on, c.name, (v) => setCountry(c, v), true),
      on
        ? h(
            "label",
            { class: "card-color", title: "Choose a color for this country" },
            h("span", { class: "color-dot", style: { background: color } }, h("input", { type: "color", value: toHex(color), onchange: (e) => setCountryColor(c.id, e.target.value) })),
            "Color"
          )
        : null
    ),
    countryPicker(c),
    spotLink(),
  ];
}

// The Moon, the Sun or a planet. The Moon and Mars can be added; the Earth's card sums up the
// map and leads back to it.
function bodyCard(b) {
  const on = !!state.bodies[b.id];
  const earth = b.id === "earth";
  const s = earth ? stats(shownState()) : null;
  const yours = s && [s.countries && `${s.countries} ${s.countries === 1 ? "country or region" : "countries and regions"}`, s.cities && `${s.cities} ${s.cities === 1 ? "city" : "cities"}`].filter(Boolean);
  return [
    h("div", { class: "card-head" }, h("span", { class: "card-flag" }, bodyDot(b)), h("div", { class: "card-title" }, h("b", {}, b.name), h("small", {}, earth ? "Planet · Home" : b.kind))),
    h("p", { class: "card-facts" }, b.fact),
    yours?.length ? h("p", { class: "card-facts" }, `You have been to ${yours.join(" and ")}`) : null,
    b.addable ? h("div", { class: "card-actions" }, addButton(on, theName(b), (v) => setBody(b, v), true)) : null,
    earth
      ? h(
          "div",
          { class: "card-actions" },
          h("button", {
            class: "btn primary",
            title: "Zoom back in to the Earth",
            onclick: () => {
              selectPlace(null);
              map.showSpace(1);
            },
            html: `${ICON_ZOOM_IN} <span>Back to the Earth</span>`,
          })
        )
      : null,
  ];
}

// A small disc in a body's color, in place of a flag.
const bodyDot = (b) => h("span", { class: "body-dot", style: { backgroundColor: b.color }, "aria-hidden": "true" });

function regionCard(r) {
  const on = !!state.regions[r.id];
  const country = countryById.get(r.cc);
  const inRegion = (key) => regionOfCity(cityByKey.get(key)) === r;
  const facts = [];
  const dates = state.trips.flatMap((t) => t.stops.filter((s) => s.date && cityByKey.get(s.city).cc === r.cc && inRegion(s.city)).map((s) => s.date)).sort();
  if (on && dates.length) facts.push(`First visit ${formatDate(dates[0])}`);
  const added = Object.keys(state.cities).filter((k) => cityByKey.get(k).cc === r.cc && inRegion(k)).length;
  if (added) facts.push(`${added} ${added === 1 ? "city" : "cities"} added`);
  const all = regionCities(r);
  const top = cardCities(all);
  const q = (ui.cardQuery || "").trim();
  return [
    h(
      "div",
      { class: "card-head" },
      h("span", { class: "card-flag" }, flag(isoById.get(r.cc)) || h("span", { html: ICON_PIN })),
      h(
        "div",
        { class: "card-title" },
        h("b", {}, r.name),
        h("small", {}, h("button", { class: "link", title: `Show ${country.name}`, onclick: () => selectPlace({ country: r.cc }, { fly: true }) }, country.name), ` · ${capitalize(regionUnit(r.cc, 1))}`)
      )
    ),
    facts.length ? h("p", { class: "card-facts" }, facts.join(" · ")) : null,
    h("div", { class: "card-actions" }, addButton(on, r.name, (v) => setRegion(r, v), true)),
    all.length
      ? cardPicker({
          heading: q ? `Cities matching “${q}”` : all.length > top.length ? `Largest cities · ${all.length.toLocaleString("en-US")} in all` : "Cities",
          total: all.length,
          items: top,
          chip: cityChip,
          isOn: (ci) => state.cities[ci.key],
          add: (ci) => setCity(ci, true),
          placeholder: `Type to find a city in ${r.name}`,
          empty: "No city by that name. Try another spelling.",
        })
      : null,
    spotLink(),
  ];
}

// ---- The user's own places -------------------------------------------------

const countriesByName = [...countries].sort((a, b) => a.name.localeCompare(b.name));
const fmtCoord = ([lon, lat]) => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;

// A name to start from for a place added by clicking the map; the card asks for a better one.
function defaultPlaceName(lonlat) {
  const near = nearestCity(lonlat);
  if (near && near.km < 40) return `Near ${near.city.name}`;
  const country = countryAtLonLat(lonlat);
  return country ? `Place in ${country.name}` : "New place";
}

function createPlaceAt(lonlat) {
  const key = addPlace(defaultPlaceName(lonlat), lonlat);
  if (!key) return;
  selectPlace({ city: key });
  const input = $("#card-place-name");
  input?.focus();
  input?.select();
}

// Choosing a spot on the map: the next click there adds a place (or moves one, with `key`).
let picking = null; // { name, key?, onDone? }

function startPicking(opts) {
  if (player) return;
  picking = opts;
  selectPlace(null);
  // Escape then cancels, wherever the keyboard focus was.
  document.activeElement?.blur();
  document.body.classList.add("picking");
  // On phones the panel covers most of the map: tuck it away.
  if (window.innerWidth <= 760 && !$("#panel").classList.contains("collapsed")) {
    document.activeElement?.blur();
    $("#panel").classList.add("collapsed");
    updateInset();
  }
  const bar = $("#pick-bar");
  bar.replaceChildren(
    h("span", { html: ICON_PLACE, class: "i" }),
    h(
      "span",
      { class: "msg" },
      opts.key ? `Click the map where ${opts.name} should go` : `Click the map where ${opts.name} is`,
      h("span", { class: "keys" }, ", or move the map with the arrow keys and press Enter")
    ),
    h("button", { class: "btn", onclick: stopPicking }, "Cancel")
  );
  // Below the stats, and over the map, not the panel.
  bar.style.top = `${Math.round($("#stats").getBoundingClientRect().bottom + 12)}px`;
  bar.hidden = false;
  map.invalidate();
}

// Keyboard picking: the arrow keys move the map, + and - zoom, and Enter picks the spot under
// the mark at the center of the map.
function pickCenter() {
  return [map.width / 2 + map.view.ox, map.height / 2 + map.view.oy];
}

function placePickMark() {
  const mark = $("#pick-mark");
  const on = !!picking && document.body.classList.contains("picking-keys");
  mark.hidden = !on;
  if (!on) return;
  const [x, y] = pickCenter();
  mark.style.transform = `translate(${x}px, ${y}px)`;
}

function pickKey(e) {
  const [cx, cy] = pickCenter();
  const step = Math.min(map.width, map.height) / 8;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const zoom = { "+": 1.6, "=": 1.6, "-": 1 / 1.6, _: 1 / 1.6 }[e.key];
  if (!moves[e.key] && !zoom && e.key !== "Enter" && e.key !== " ") return false;
  // Enter on the Cancel button (or any other button) still presses it.
  if ((e.key === "Enter" || e.key === " ") && e.target.closest?.("button, a")) return false;
  e.preventDefault();
  document.body.classList.add("picking-keys");
  if (e.key === "Enter" || e.key === " ") {
    const ll = map.lonlatAt(cx, cy);
    if (ll) placePicked(ll);
    else toast("Move the map so that the mark is on the globe");
    return true;
  }
  const center = map.lonlatAt(cx, cy) || [-map.view.lambda, -map.view.phi];
  if (zoom) map.flyTo(center, Math.max(1, Math.min(40, map.view.k * zoom)), 200);
  else {
    const [dx, dy] = moves[e.key];
    const next = map.lonlatAt(cx + dx, cy + dy);
    if (next) map.flyTo(next, map.view.k, 200);
  }
  map.invalidate();
  return true;
}

function stopPicking() {
  if (!picking) return;
  picking = null;
  document.body.classList.remove("picking", "picking-keys");
  placePickMark();
  $("#pick-bar").hidden = true;
  // A card opened while picking was hidden, so it could not be placed.
  if (ui.selected) renderCard();
}

function placePicked(lonlat) {
  const p = picking;
  stopPicking();
  if (p.key) {
    if (!state.places[p.key]) return toast(`${p.name} was deleted`);
    updatePlace(p.key, { lonlat });
    toast(`Moved ${p.name}`);
    selectPlace({ city: p.key });
    return;
  }
  const key = addPlace(p.name, lonlat);
  if (!key) return;
  p.onDone?.(cityByKey.get(key));
  toast(`Added ${p.name}`);
  selectPlace({ city: key });
}

// Choosing a country for a visited place marks that country visited. Arrow keys on the select
// choose each country they pass, so a country marked this way is unmarked again when another
// one is chosen, unless something else in it is visited.
function setPlaceCountry(pl, cc) {
  const marked = ui.placeMark?.key === pl.key ? ui.placeMark.cc : null;
  if (marked && marked !== cc && !Object.keys(state.cities).some((k) => k !== pl.key && cityByKey.get(k)?.cc === marked)) delete state.countries[marked];
  ui.placeMark = state.cities[pl.key] && cc && (!state.countries[cc] || marked === cc) ? { key: pl.key, cc } : null;
  updatePlace(pl.key, { cc });
}

function placeCard(pl) {
  const on = !!state.cities[pl.key];
  const trip = ui.tab === "trips" ? activeTrip() : null;
  const inTrips = state.trips.filter((t) => t.stops.some((s) => s.city === pl.key));
  const name = h("input", {
    id: "card-place-name",
    class: "place-name",
    value: pl.name,
    maxlength: String(PLACE_NAME_MAX),
    "aria-label": "Name of this place",
    title: "Rename this place",
    autocomplete: "off",
    spellcheck: "false",
    // Renaming shows on the map as you type; the change is saved when you leave the field.
    oninput: (e) => {
      if (e.target.value.trim()) {
        pl.name = e.target.value.trim();
        map.invalidate();
      }
    },
    onchange: (e) => {
      ui.keepCard = pl.key;
      try {
        updatePlace(pl.key, { name: e.target.value });
      } finally {
        ui.keepCard = null;
      }
    },
    onblur: (e) => {
      if (!e.target.value.trim()) e.target.value = state.places[pl.key]?.name || "";
    },
    onkeydown: (e) => {
      if (e.key === "Enter") e.target.blur();
      else if (e.key === "Escape") {
        e.stopPropagation();
        e.target.value = state.places[pl.key]?.name || "";
        pl.name = e.target.value;
        e.target.blur();
        map.invalidate();
      }
    },
  });
  const country = h(
    "select",
    { id: "card-place-country", class: "place-country", "aria-label": "Country of this place", title: "Change the country", onchange: (e) => setPlaceCountry(pl, e.target.value) },
    h("option", { value: "" }, "No country"),
    countriesByName.map((c) => h("option", { value: c.id, selected: c.id === pl.cc }, c.name))
  );
  return [
    h("div", { class: "card-head" }, h("span", { class: "card-flag place", html: ICON_PLACE }), h("div", { class: "card-title" }, name, h("small", {}, `Your place · ${fmtCoord([pl.lon, pl.lat])}`))),
    h("label", { class: "card-field" }, h("span", {}, "Country"), country),
    inTrips.length ? h("p", { class: "card-facts" }, `In ${inTrips.map((t) => t.name).join(", ")}`) : null,
    h(
      "div",
      { class: "card-actions" },
      trip
        ? h("button", {
            class: "btn primary",
            onclick: () => {
              addStop(trip, pl.key);
              toast(`Added ${pl.name} to ${trip.name}`);
            },
            html: `${ICON_PLUS} <span>Add to ${escapeHtml(trip.name)}</span>`,
          })
        : null,
      addButton(on, pl.name, (v) => setCity(pl, v), !trip),
      h("button", { class: "btn quiet", title: "Choose a new spot on the map", onclick: () => startPicking({ name: pl.name, key: pl.key }), html: `${ICON_MOVE} <span>Move</span>` }),
      h(
        "button",
        {
          class: "btn quiet danger",
          title: "Delete this place",
          onclick: () => removePlace(pl),
        },
        "Delete"
      )
    ),
  ];
}

function cityCard(ci) {
  const on = !!state.cities[ci.key];
  const country = countryById.get(ci.cc);
  const trip = ui.tab === "trips" ? activeTrip() : null;
  const inTrips = state.trips.filter((t) => t.stops.some((s) => s.city === ci.key));
  const facts = inTrips.length ? `In ${inTrips.map((t) => t.name).join(", ")}` : "";
  return [
    h(
      "div",
      { class: "card-head" },
      h("span", { class: "card-flag" }, flag(isoById.get(ci.cc)) || h("span", { html: ICON_PIN })),
      h(
        "div",
        { class: "card-title" },
        h("b", {}, ci.name),
        h(
          "small",
          {},
          h("button", { class: "link", title: `Show ${country.name}`, onclick: () => selectPlace({ country: ci.cc }, { fly: true }) }, country.name),
          `${ci.capital ? " · Capital" : ""} · ${fmtPop(ci.pop)} people`
        )
      )
    ),
    facts ? h("p", { class: "card-facts" }, facts) : null,
    h(
      "div",
      { class: "card-actions" },
      trip
        ? h(
            "button",
            {
              class: "btn primary",
              onclick: () => {
                addStop(trip, ci.key);
                toast(`Added ${ci.name} to ${trip.name}`);
              },
              html: `${ICON_PLUS} <span>Add to ${escapeHtml(trip.name)}</span>`,
            }
          )
        : null,
      addButton(on, ci.name, (v) => setCity(ci, v), !trip)
    ),
  ];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// Keeps the card next to its place as the map moves; hides it while the place is out of view.
function positionCard() {
  const card = $("#place-card");
  const sel = ui.selected;
  if (!sel || card.hidden) return;
  const p = sel.body ? map.bodyPoint(sel.body) : map.project(sel.anchor);
  card.classList.toggle("away", !p);
  if (!p) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const phone = W <= 760;
  const panel = $("#panel");
  const pr = panel.getBoundingClientRect();
  const open = !panel.classList.contains("collapsed");
  const minX = !phone && open ? pr.right + 12 : 12;
  const minY = $(".topbar").getBoundingClientRect().bottom + 10;
  const maxBottom = (phone ? pr.top : H - 64) - 10;
  const gap = 16;
  let below = p[1] - ch - gap < minY;
  let top = below ? p[1] + gap : p[1] - ch - gap;
  top = clamp(top, minY, Math.max(minY, maxBottom - ch));
  const left = clamp(p[0] - cw / 2, minX, Math.max(minX, W - 12 - cw));
  card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  const ax = p[0] - left;
  // The arrow points at the place only when the card sits right next to it.
  const attached = ax > 14 && ax < cw - 14 && (below ? Math.abs(top - p[1] - gap) < 2 : Math.abs(top + ch + gap - p[1]) < 2);
  card.dataset.side = below ? "below" : "above";
  card.dataset.arrow = attached ? "on" : "off";
  card.style.setProperty("--ax", `${Math.round(ax)}px`);
}

function markSelectedRows() {
  const sel = ui.selected;
  const key = sel ? (sel.body ? `b:${sel.body}` : sel.city ? `t:${sel.city}` : sel.region ? `r:${sel.region}` : `c:${sel.country}`) : "";
  for (const li of document.querySelectorAll("#place-results li.item")) li.classList.toggle("selected", li.dataset.key === key);
}

// ---- Timeline --------------------------------------------------------------

// With the timeline open, the map and the stats show the travels as they stood at the end of
// the chosen year; playing it steps through the years and newly visited countries fade in.
const ICON_PAUSE = '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="3.5" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9.5" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>';
const YEAR_STEP_MS = 1100;
const FADE_MS = 700;
let yearTimer = null;

function shownState() {
  return ui.timeline ? asOfYear(ui.timeline.year) : state;
}

function yearRange() {
  const years = [...visitYears().cities.values()];
  return years.length ? [Math.min(...years), Math.max(...years)] : null;
}

function openTimeline() {
  const range = yearRange();
  if (!range) return;
  ui.timeline = { year: range[1], changedAt: 0, playing: false };
  renderTimeline();
  playYears(true);
}

function closeTimeline() {
  clearTimeout(yearTimer);
  ui.timeline = null;
  renderTimeline();
  renderStats();
  if (ui.tab === "export") renderExport();
  map.invalidate();
}

function setYear(year) {
  const tl = ui.timeline;
  if (!tl || year === tl.year) return;
  tl.changedAt = year > tl.year ? performance.now() : 0;
  tl.year = year;
  updateTimeline();
  renderStats();
  if (ui.tab === "export") renderExport();
  map.invalidate();
}

function playYears(play = !ui.timeline?.playing) {
  const tl = ui.timeline;
  clearTimeout(yearTimer);
  if (!tl) return;
  const [lo, hi] = yearRange();
  tl.playing = play && hi > lo;
  if (tl.playing) {
    if (tl.year >= hi) setYear(lo);
    const step = () => {
      if (!ui.timeline?.playing) return;
      if (ui.timeline.year >= hi) {
        ui.timeline.playing = false;
        return updateTimeline();
      }
      setYear(ui.timeline.year + 1);
      yearTimer = setTimeout(step, YEAR_STEP_MS);
    };
    yearTimer = setTimeout(step, YEAR_STEP_MS);
  }
  updateTimeline();
}

// Countries first visited in the year just reached fade in.
map.extra = () => {
  const tl = ui.timeline;
  const t = tl && (performance.now() - tl.changedAt) / FADE_MS;
  if (!tl || !(t < 1)) return null;
  const shown = shownState();
  const first = visitYears();
  const a = 1 - Math.pow(1 - t, 3);
  const alpha = new Map();
  for (const id of Object.keys(shown.countries)) if (first.countries.get(id) === tl.year) alpha.set(id, a);
  const regionAlpha = new Map(Object.keys(shown.regions).map((id) => [id, first.regions.get(id) === tl.year ? a : 1]));
  return { reveal: new Set(Object.keys(shown.countries)), revealAlpha: alpha, revealRegions: regionAlpha };
};
map.animating = () => !!ui.timeline && performance.now() - ui.timeline.changedAt < FADE_MS;

function renderTimeline() {
  const bar = $("#timeline");
  const btn = $("#timeline-toggle");
  const range = yearRange();
  btn.disabled = !range;
  btn.title = range ? "See your travels year by year" : "Add trips with dates to see them year by year";
  btn.setAttribute("aria-pressed", String(!!ui.timeline));
  if (ui.timeline && !range) {
    clearTimeout(yearTimer);
    ui.timeline = null;
  }
  document.body.classList.toggle("timeline-on", !!ui.timeline);
  if (!ui.timeline) {
    bar.hidden = true;
    bar.replaceChildren();
    return;
  }
  const [lo, hi] = range;
  ui.timeline.year = clamp(ui.timeline.year, lo, hi);
  if (bar.dataset.range !== `${lo}-${hi}` || !bar.children.length) {
    bar.dataset.range = `${lo}-${hi}`;
    bar.replaceChildren(
      h("button", { class: "tl-play", onclick: () => playYears() }),
      h("b", { class: "tl-year", "aria-live": "polite" }),
      h(
        "div",
        { class: "tl-track" },
        h("input", { type: "range", min: String(lo), max: String(hi), step: "1", "aria-label": "Year", disabled: lo === hi, oninput: (e) => {
            const year = +e.target.value;
            playYears(false);
            setYear(year);
          },
        }),
        h("div", { class: "tl-ends", "aria-hidden": "true" }, h("span", {}, String(lo)), h("span", {}, String(hi)))
      ),
      h("small", { class: "tl-note" }),
      h("button", { class: "icon-btn tl-close", "aria-label": "Close the timeline", title: "Show all years", html: ICON_X, onclick: closeTimeline })
    );
  }
  bar.hidden = false;
  updateTimeline();
}

function updateTimeline() {
  const bar = $("#timeline");
  const tl = ui.timeline;
  if (!tl || bar.hidden) return;
  const play = bar.querySelector(".tl-play");
  play.innerHTML = tl.playing ? ICON_PAUSE : ICON_PLAY;
  play.setAttribute("aria-label", tl.playing ? "Pause" : "Play the years");
  play.title = tl.playing ? "Pause" : "Play the years";
  bar.querySelector(".tl-year").textContent = String(tl.year);
  const input = bar.querySelector("input");
  if (+input.value !== tl.year) input.value = String(tl.year);
  // Places added without a dated trip have no year, so the timeline leaves them out.
  const years = visitYears();
  const undated = Object.keys(state.countries).filter((id) => !years.countries.has(id)).length + Object.keys(state.cities).filter((k) => !years.cities.has(k)).length;
  const note = bar.querySelector(".tl-note");
  note.textContent = undated ? `${undated} without dates not shown` : "";
  note.hidden = !undated;
}

$("#timeline-toggle").onclick = () => (ui.timeline ? closeTimeline() : openTimeline());

// ---- Stats -----------------------------------------------------------------

function renderStats() {
  const s = stats(shownState());
  const pct = Math.round((s.states / countedTotal) * 100);
  const items = [
    ["Countries & regions", s.countries, ""],
    ["Cities", s.cities, ""],
    ["Continents", s.continents, "/7"],
    ["Of the world", pct, "%"],
    ["Flown", Math.round(s.km).toLocaleString("en-US"), " km"],
  ];
  if (s.beyond) items.push(["Beyond the Earth", s.beyond, `/${ADDABLE.length}`]);
  $("#stats").replaceChildren(...items.map(([label, value, suffix]) => h("div", {}, h("dt", {}, label), h("dd", {}, String(value), suffix ? h("small", {}, suffix) : null))));
  fitStats();
}

// Leaves out the numbers that do not fit next to the file bar, the last ones first.
function fitStats() {
  const el = $("#stats");
  const items = [...el.children];
  for (const d of items) d.style.display = "";
  for (let i = items.length - 1; i > 0 && el.scrollWidth > el.clientWidth + 1; i--) items[i].style.display = "none";
}
window.addEventListener("resize", fitStats);

function renderLegend() {
  const el = $("#legend");
  const mode = state.settings.colorMode;
  el.replaceChildren();
  if (mode === "continent") {
    const used = new Set(countries.filter((c) => state.countries[c.id]).map((c) => c.continent));
    for (const name of CONTINENTS) if (used.has(name)) el.append(h("div", {}, h("span", { style: { background: CONTINENT_COLORS[name] } }), name));
  } else if (mode === "year") {
    for (const [y, color] of yearLegend(state, firstVisitByCountry())) el.append(h("div", {}, h("span", { style: { background: color } }), String(y)));
    if (!el.children.length) el.append(h("div", {}, "Add dated trips to color by year"));
  }
  el.hidden = !el.children.length;
}

// ---- Places pane -----------------------------------------------------------

function searchAll(q, limit = 60) {
  const nq = normalize(q.trim());
  if (!nq) return [];
  const out = [];
  for (const c of countries) {
    const r = matchRank(normalize(c.name), nq);
    if (r >= 0) out.push({ kind: "country", item: c, score: r + c.rank / 100 });
  }
  // The Moon and Mars, when their whole name is typed or starts it.
  for (const b of ADDABLE) {
    const r = matchRank(normalize(b.name), nq);
    if (r === 0) out.push({ kind: "body", item: b, score: b.name.length === nq.length ? -1 : 0.2 });
  }
  // Names that start with the query first; then the user's own places, provinces and states,
  // major cities, and smaller places, larger first.
  for (const r of regions) {
    const m = matchRank(r.norm, nq);
    if (m >= 0) out.push({ kind: "region", item: r, score: m + 0.55 + (r.norm === nq ? -0.4 : 0) });
  }
  for (const c of customPlaces.values()) {
    const r = matchRank(c.norm, nq);
    if (r >= 0) out.push({ kind: "city", item: c, score: r + 0.3 + (c.norm === nq ? -0.4 : 0) });
  }
  for (const c of allCities) {
    const r = matchRank(c.norm, nq);
    if (r < 0) continue;
    out.push({ kind: "city", item: c, score: r + 0.5 + (c.major ? 0 : 0.6) + (c.norm === nq ? -0.4 : 0) - Math.log10(c.pop + 1) / 100 });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

// The last search result: a place of the user's own by the name typed, placed on the map next.
function newPlaceRow(name) {
  return h(
    "li",
    { class: "item new-place", "data-key": "new", onactivate: () => startPicking({ name }) },
    h("span", { class: "pin place", html: ICON_PLACE }),
    h("span", { class: "name" }, `Add “${name}” as your own place`, h("span", { class: "meta" }, "Then click the map where it is"))
  );
}

// A row selects its place (map flies there and opens the card). In search results the
// row ends with an Add toggle; in the list of added places it ends with a remove button.
function rowEnd(on, name, toggle, inSearch) {
  if (inSearch) return addButton(on, name, toggle);
  return h("button", { class: "icon-btn row-remove", "aria-label": `Remove ${name}`, title: `Remove ${name}`, html: ICON_X, onclick: (e) => (e.stopPropagation(), toggle(false)) });
}

function countryRow(c, inSearch = false) {
  const on = !!state.countries[c.id];
  const color = countryColor(c.id, state, firstVisitByCountry());
  const sel = ui.selected && !ui.selected.city && ui.selected.country === c.id;
  return h(
    "li",
    { class: `item${on ? " on" : ""}${sel ? " selected" : ""}`, "data-key": `c:${c.id}`, style: on ? { "--c": color } : null, onactivate: () => selectPlace({ country: c.id }, { fly: true }) },
    h("span", { class: "flag" }, flag(isoById.get(c.id)) || h("span", { class: "pin", html: ICON_PIN })),
    h("span", { class: "name" }, c.name, h("span", { class: "meta" }, [c.region, regionCount(c.id)].filter(Boolean).join(" · "))),
    on && !inSearch
      ? h(
          "label",
          { class: "color-dot", title: "Custom color", style: { background: color }, onclick: (e) => e.stopPropagation() },
          h("input", { type: "color", value: toHex(color), onchange: (e) => setCountryColor(c.id, e.target.value) })
        )
      : null,
    rowEnd(on, c.name, (v) => setCountry(c, v), inSearch)
  );
}

function regionRow(r, inSearch = false) {
  const on = !!state.regions[r.id];
  const sel = ui.selected?.region === r.id;
  return h(
    "li",
    { class: `item${on ? " on" : ""}${sel ? " selected" : ""}`, "data-key": `r:${r.id}`, onactivate: () => selectPlace({ region: r.id }, { fly: true }) },
    h("span", { class: "flag" }, flag(isoById.get(r.cc)) || h("span", { class: "pin", html: ICON_PIN })),
    h("span", { class: "name" }, r.name, h("span", { class: "meta" }, regionMeta(r))),
    rowEnd(on, r.name, (v) => setRegion(r, v), inSearch)
  );
}

function cityRow(c, inSearch = false) {
  const on = !!state.cities[c.key];
  const country = countryById.get(c.cc);
  const sel = ui.selected?.city === c.key;
  const meta = c.custom ? ["Your place", country?.name] : [country?.name || c.cc, c.capital && "Capital", fmtPop(c.pop)];
  return h(
    "li",
    { class: `item${on ? " on" : ""}${sel ? " selected" : ""}`, "data-key": `t:${c.key}`, onactivate: () => selectPlace({ city: c.key }, { fly: true }) },
    h("span", { class: `pin${c.custom ? " place" : ""}`, html: c.custom ? ICON_PLACE : ICON_PIN }),
    h("span", { class: "name" }, c.name, h("span", { class: "meta" }, meta.filter(Boolean).join(" · "))),
    // In the list of your places, the row's button deletes the place.
    c.custom && !inSearch ? h("button", { class: "icon-btn row-remove", "aria-label": `Delete ${c.name}`, title: `Delete ${c.name}`, html: ICON_X, onclick: (e) => (e.stopPropagation(), removePlace(c)) }) : rowEnd(on, c.name, (v) => setCity(c, v), inSearch)
  );
}

function bodyRow(b, inSearch = false) {
  const on = !!state.bodies[b.id];
  const sel = ui.selected?.body === b.id;
  return h(
    "li",
    { class: `item${on ? " on" : ""}${sel ? " selected" : ""}`, "data-key": `b:${b.id}`, onactivate: () => selectPlace({ body: b.id }, { fly: true }) },
    h("span", { class: "flag" }, bodyDot(b)),
    h("span", { class: "name" }, b.name, h("span", { class: "meta" }, b.kind)),
    rowEnd(on, theName(b), (v) => setBody(b, v), inSearch)
  );
}

function removePlace(c) {
  if (picking?.key === c.key) stopPicking();
  withUndo(() => {
    const n = deletePlace(c.key);
    return `Deleted ${c.name}${n ? ` and ${n} trip ${n === 1 ? "stop" : "stops"}` : ""}`;
  });
}

function zoomFor(c) {
  const [[x0, y0], [x1, y1]] = c.bounds;
  const span = Math.max(x1 >= x0 ? x1 - x0 : 360 + x1 - x0, (y1 - y0) * 1.6);
  return Math.max(1.2, Math.min(9, 110 / Math.max(span, 4)));
}

function toHex(color) {
  if (color.startsWith("#")) return color;
  const m = color.match(/\d+/g).map(Number);
  return `#${m
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function renderPlaces() {
  const pane = $('[data-pane="places"]');
  const focused = document.activeElement?.id === "place-search";
  const input = h("input", {
    id: "place-search",
    type: "search",
    placeholder: "Search countries, states and cities",
    "aria-label": "Search countries, states and cities",
    value: ui.query,
    autocomplete: "off",
    spellcheck: "false",
    oninput: (e) => {
      ui.query = e.target.value;
      ui.kbd = 0;
      renderPlaceResults();
    },
    onkeydown: (e) => {
      const n = ui.results.length;
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) {
        ui.kbd = clamp(ui.kbd + (e.key === "ArrowDown" ? 1 : -1), 0, n - 1);
        markKbdRow(true);
        e.preventDefault();
      } else if (e.key === "Enter" && n) {
        // Enter adds the highlighted place; if it is already added, it shows the place instead.
        e.preventDefault();
        const r = ui.results[ui.kbd];
        if (r.kind === "new") startPicking({ name: r.name });
        else if (r.kind === "body") state.bodies[r.item.id] ? selectPlace({ body: r.item.id }, { fly: true }) : setBody(r.item, true);
        else if (r.kind === "country") state.countries[r.item.id] ? selectPlace({ country: r.item.id }, { fly: true }) : setCountry(r.item, true);
        else if (r.kind === "region") state.regions[r.item.id] ? selectPlace({ region: r.item.id }, { fly: true }) : setRegion(r.item, true);
        else state.cities[r.item.key] ? selectPlace({ city: r.item.key }, { fly: true }) : setCity(r.item, true);
      } else if (e.key === "Escape") {
        if (ui.query) {
          ui.query = "";
          input.value = "";
          renderPlaceResults();
        } else input.blur();
      }
    },
  });
  pane.replaceChildren(h("div", { class: "search" }, h("span", { html: ICON_SEARCH }), input), h("div", { id: "place-results" }));
  if (focused) {
    input.focus();
    input.setSelectionRange(ui.query.length, ui.query.length);
  }
  renderPlaceResults();
}

function renderPlaceResults() {
  const box = $("#place-results");
  if (!box) return;
  box.replaceChildren();
  if (ui.query.trim()) {
    const res = searchAll(ui.query);
    const found = res.length;
    const name = ui.query.trim().replace(/\s+/g, " ").slice(0, PLACE_NAME_MAX);
    const rows = res.map((r) => (r.kind === "body" ? bodyRow(r.item, true) : r.kind === "country" ? countryRow(r.item, true) : r.kind === "region" ? regionRow(r.item, true) : cityRow(r.item, true)));
    // Anything not found (or found but meant as another spot) can be added as your own place.
    if (name.length >= 2) {
      res.push({ kind: "new", name });
      rows.push(newPlaceRow(name));
    }
    ui.results = res;
    ui.kbd = Math.min(ui.kbd, Math.max(0, res.length - 1));
    if (!found) box.append(h("p", { class: "note" }, "No matches. Try another spelling, or the name in English."));
    else box.append(h("p", { class: "note kbd-hint" }, h("span", { class: "kbd" }, "↑"), " ", h("span", { class: "kbd" }, "↓"), " to choose, ", h("span", { class: "kbd" }, "Enter"), " to add"));
    box.append(h("ul", { class: "list" }, rows));
    markKbdRow(false);
    return;
  }
  ui.results = [];
  const visited = countries.filter((c) => state.countries[c.id]);
  const vCities = Object.keys(state.cities)
    .map((k) => cityByKey.get(k))
    .filter((c) => !c.custom)
    .sort((a, b) => a.name.localeCompare(b.name));
  const places = [...customPlaces.values()].sort((a, b) => a.name.localeCompare(b.name));
  const beyond = ADDABLE.filter((b) => state.bodies[b.id]);
  if (!visited.length && !vCities.length && !places.length && !beyond.length) {
    box.append(
      h(
        "div",
        { class: "empty" },
        h("strong", {}, "Where have you been?"),
        "Click a country or city on the map, or search above.",
        h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: doOpen }, "Open travel file"), h("button", { class: "btn", onclick: loadSample }, "Try an example"))
      )
    );
    return;
  }
  // Continent breakdown and countries (none yet when only the Moon or Mars was added).
  if (visited.length) renderCountryLists(box, visited);
  // Provinces and states, by country.
  const vRegions = Object.keys(state.regions)
    .map((id) => regionById.get(id))
    .sort((a, b) => countryById.get(a.cc).name.localeCompare(countryById.get(b.cc).name) || a.name.localeCompare(b.name));
  if (vRegions.length) {
    box.append(h("h3", {}, "Provinces and states", h("span", { class: "count" }, String(vRegions.length))));
    box.append(h("ul", { class: "list" }, vRegions.map((r) => regionRow(r))));
  }
  if (vCities.length) {
    box.append(h("h3", {}, "Cities", h("span", { class: "count" }, String(vCities.length))));
    box.append(h("ul", { class: "list" }, vCities.map((c) => cityRow(c))));
  }
  if (places.length) {
    box.append(h("h3", {}, "Your places", h("span", { class: "count" }, String(places.length))));
    box.append(h("ul", { class: "list" }, places.map((c) => cityRow(c))));
  }
  if (beyond.length) {
    box.append(h("h3", {}, "Beyond the Earth", h("span", { class: "count" }, String(beyond.length))));
    box.append(h("ul", { class: "list" }, beyond.map((b) => bodyRow(b))));
  }
}

function renderCountryLists(box, visited) {
  box.append(h("h3", {}, "By continent"));
  const bars = h("div", { class: "continent-bars" });
  for (const name of CONTINENTS) {
    if (name === "Antarctica" && !state.countries.ATA) continue;
    const all = countries.filter((c) => c.continent === name && (c.counted || c.id === "ATA"));
    const n = all.filter((c) => state.countries[c.id]).length;
    const pct = all.length ? n / all.length : 0;
    bars.append(
      h(
        "div",
        { class: "bar" },
        h("span", {}, name),
        h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${pct * 100}%`, background: state.settings.colorMode === "continent" ? CONTINENT_COLORS[name] : null } })),
        h("span", { class: "num" }, `${n}/${all.length}`)
      )
    );
  }
  box.append(bars);
  box.append(h("h3", {}, "Countries & regions", h("span", { class: "count" }, String(visited.length))));
  box.append(h("ul", { class: "list" }, visited.sort((a, b) => a.name.localeCompare(b.name)).map((c) => countryRow(c))));
}

// Highlights the search result that Enter acts on.
function markKbdRow(scroll) {
  const rows = document.querySelectorAll("#place-results li.item");
  rows.forEach((li, i) => li.classList.toggle("kbd-sel", i === ui.kbd));
  if (scroll) rows[ui.kbd]?.scrollIntoView({ block: "nearest" });
}

function loadSample() {
  stopPicking();
  loadFileData(sampleData());
  file.saved = ""; // an example is new, unsaved data
  commit();
  toast("Example loaded. Save it to keep a copy.");
}

// ---- Trips pane ------------------------------------------------------------

// Type-ahead for cities and the user's own places. With allowNew, the last suggestion adds a
// place of your own by the name typed (then clicked on the map).
function citySuggest({ placeholder, onPick, id = "stop-search", allowNew = false }) {
  let sel = 0;
  let results = [];
  const list = h("ul", { hidden: true });
  const input = h("input", {
    class: "text",
    type: "search",
    placeholder,
    autocomplete: "off",
    oninput: () => {
      const q = normalize(input.value.trim());
      results = q
        ? [...customPlaces.values(), ...allCities]
            .map((c) => [matchRank(c.norm, q), c])
            .filter(([r]) => r >= 0)
            .sort(([ra, a], [rb, b]) => (b.norm === q) - (a.norm === q) || ra - rb || !!b.custom - !!a.custom || b.major - a.major || b.pop - a.pop)
            .slice(0, 8)
            .map(([, c]) => c)
        : [];
      const name = input.value.trim().replace(/\s+/g, " ").slice(0, PLACE_NAME_MAX);
      if (allowNew && name.length >= 2) results.push({ newPlace: name });
      sel = 0;
      draw();
    },
    onkeydown: (e) => {
      if (e.key === "ArrowDown") (sel = Math.min(results.length - 1, sel + 1)), draw(), e.preventDefault();
      else if (e.key === "ArrowUp") (sel = Math.max(0, sel - 1)), draw(), e.preventDefault();
      else if (e.key === "Enter" && results[sel]) pick(results[sel]);
      else if (e.key === "Escape") (results = []), draw();
    },
    onblur: () => setTimeout(() => ((results = []), draw()), 150),
  });
  function pick(c) {
    if (c.newPlace) {
      input.value = "";
      results = [];
      draw();
      startPicking({ name: c.newPlace, onDone: onPick });
      return;
    }
    onPick(c);
    input.value = "";
    results = [];
    draw();
    requestAnimationFrame(() => document.getElementById(input.id)?.focus());
  }
  input.id = id;
  function draw() {
    list.hidden = !results.length;
    list.replaceChildren(
      ...results.map((c, i) =>
        h(
          "li",
          { class: `${i === sel ? "sel" : ""}${c.newPlace || c.custom ? " own" : ""}` || null, onmousedown: (e) => (e.preventDefault(), pick(c)) },
          c.newPlace ? `Add “${c.newPlace}” as your own place…` : c.name,
          h("small", {}, c.newPlace ? "Then click the map" : [c.custom && "Your place", countryById.get(c.cc)?.name].filter(Boolean).join(" · "))
        )
      )
    );
  }
  return h("div", { class: "suggest" }, input, list);
}

function renderTrips() {
  const pane = $('[data-pane="trips"]');
  pane.replaceChildren();
  const trip = activeTrip();

  pane.append(h("h3", {}, "Trips", h("span", { class: "count" }, String(state.trips.length))));
  if (!state.trips.length) {
    pane.append(
      h(
        "div",
        { class: "empty" },
        h("strong", {}, "No trips yet"),
        "A trip is a list of cities with dates, reached by plane, train, car or ship.",
        h("br"),
        h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: () => addTrip("My trip") }, "New trip"), h("button", { class: "btn", onclick: doImport }, "Import flights…")),
        h("p", { class: "note" }, "Import a flight history from an English .xls, .xlsx or .csv table with date, from and to columns. ", h("button", { class: "link", onclick: loadSample }, "Or try an example."))
      )
    );
    return;
  }
  for (const t of state.trips) {
    const d = tripDates(t);
    pane.append(
      h(
        "div",
        { class: `trip-card${t === trip ? " active" : ""}`, onactivate: () => ((state.activeTrip = t.id), commit(), focusTrip(t)) },
        h("div", { class: "t-name" }, t.name || "Untitled trip"),
        h("div", { class: "t-meta" }, [d ? dateRange(d[0], d[1]) : "No dates", `${t.stops.length} stops`, formatKm(tripDistanceKm(t))].join(" · "))
      )
    );
  }
  pane.append(
    h(
      "div",
      { class: "btn-row" },
      h("button", { class: "btn", onclick: () => addTrip(`Trip ${state.trips.length + 1}`) }, "+ New trip"),
      h("button", { class: "btn", title: "Import a flight history (.xls, .xlsx, .csv)", onclick: doImport }, "Import flights…")
    )
  );

  if (!trip) return;
  pane.append(h("h3", {}, "Edit trip"));
  pane.append(
    h("input", {
      class: "text",
      value: trip.name,
      placeholder: "Trip name",
      "data-focus": "trip-name",
      onchange: (e) => {
        trip.name = e.target.value.trim() || "Untitled trip";
        commit();
      },
    })
  );
  const ol = h("ol", { class: "stops" });
  trip.stops.forEach((s, i) => {
    const c = cityByKey.get(s.city);
    if (i > 0) ol.append(legRow(trip, i));
    const move = (d) => {
      const j = i + d;
      if (j < 0 || j >= trip.stops.length) return;
      editStops(trip, () => ([trip.stops[i], trip.stops[j]] = [trip.stops[j], trip.stops[i]]));
      commit();
    };
    ol.append(
      h(
        "li",
        { class: "stop" },
        h("span", { class: "dot" }),
        h("button", { class: "s-name", title: `Show ${c.name} on the map`, "data-focus": `name-${i}`, onclick: () => selectPlace({ city: c.key }, { fly: true }) }, c.name, h("small", {}, countryById.get(c.cc)?.name || (c.custom ? "Your place" : ""))),
        h("input", {
          type: "date",
          value: s.date || "",
          "aria-label": `Date in ${c.name}`,
          "data-focus": `date-${i}`,
          onchange: (e) => {
            s.date = e.target.value;
            commit();
          },
        }),
        h(
          "span",
          { class: "tools" },
          h(
            "button",
            {
              class: `icon-btn memo-btn${s.note || s.photos?.length ? " has" : ""}${ui.memo === s ? " open" : ""}`,
              title: "Photos and a note for this stop",
              "aria-label": `Photos and note for ${c.name}`,
              "aria-expanded": String(ui.memo === s),
              "data-focus": `memo-${i}`,
              onclick: () => {
                ui.memo = ui.memo === s ? null : s;
                renderPane();
                if (ui.memo) document.querySelector(`[data-focus="note-${i}"]`)?.focus();
              },
            },
            h("span", { html: ICON_PHOTO }),
            s.photos?.length ? h("b", {}, String(s.photos.length)) : null
          ),
          h("button", { class: "icon-btn", title: "Move up", "aria-label": "Move up", "data-focus": `up-${i}`, disabled: i === 0, html: ICON_UP, onclick: () => move(-1) }),
          h("button", { class: "icon-btn", title: "Move down", "aria-label": "Move down", "data-focus": `down-${i}`, disabled: i === trip.stops.length - 1, html: ICON_DOWN, onclick: () => move(1) }),
          h("button", {
            class: "icon-btn",
            title: "Remove",
            "aria-label": `Remove ${c.name}`,
            "data-focus": `remove-${i}`,
            html: ICON_X,
            onclick: () => withUndo(() => (editStops(trip, () => trip.stops.splice(i, 1)), commit(), `Removed ${c.name} from ${trip.name}`)),
          })
        )
      )
    );
    if (ui.memo === s) ol.append(memoRow(s, i, trip.stops[i + 1]));
  });
  pane.append(ol);
  pane.append(h("div", { style: { marginTop: "10px" } }, citySuggest({
        placeholder: "Add a city or place…",
        allowNew: true,
        // A new place is picked on the map first, and Undo may have replaced the trip by then.
        onPick: (c) => {
          const t = state.trips.find((x) => x.id === trip.id);
          if (t) addStop(t, c.key);
        },
      })));
  pane.append(h("p", { class: "note" }, "Or click a city on the map and choose Add to trip."));
  pane.append(
    h(
      "div",
      { class: "btn-row" },
      h("button", { class: "btn primary", disabled: trip.stops.length < 2, onclick: () => play([trip]), html: `${ICON_PLAY} Play` }),
      h("button", { class: "btn", disabled: trip.stops.length < 2, onclick: () => switchTab("export") }, "Export video")
    )
  );
  pane.append(h("button", { class: "btn danger block", style: { marginTop: "8px" }, onclick: () => withUndo(() => (deleteTrip(trip.id), `Deleted ${trip.name}`)) }, "Delete trip"));
}

// Photos and a note for a stop, shown on arrival in playback and in videos.
function memoRow(s, i, next) {
  const c = cityByKey.get(s.city);
  const photos = s.photos || [];
  const picker = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: (e) => addPhotos(s, [...e.target.files]) });
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  return h(
    "li",
    {
      class: `memo${next ? "" : " last"}`,
      "data-mode": next?.mode || "flight",
      // Photos dropped here belong to this stop (elsewhere a dropped file opens as travel data).
      ondragover: (e) => hasFiles(e) && (e.preventDefault(), e.stopPropagation(), e.currentTarget.classList.add("over")),
      ondragleave: (e) => e.currentTarget.classList.remove("over"),
      ondrop: (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove("over");
        addPhotos(s, [...e.dataTransfer.files]);
      },
    },
    h(
      "textarea",
      {
        class: "text",
        rows: "3",
        maxlength: String(NOTE_MAX),
        placeholder: `A note about ${c.name}, shown in the video`,
        "aria-label": `Note for ${c.name}`,
        "data-focus": `note-${i}`,
        onchange: (e) => {
          const note = e.target.value.trim();
          if (note) s.note = note;
          else delete s.note;
          // Only the stop's photo button shows the note: keep the panel (and the focus) as it is.
          document.querySelector(`[data-focus="memo-${i}"]`)?.classList.toggle("has", !!(note || s.photos?.length));
          ui.keepPane = true;
          commit();
        },
      },
      s.note || ""
    ),
    h(
      "div",
      { class: "memo-photos" },
      photos.map((path, j) =>
        h(
          "div",
          { class: "thumb" },
          thumbImage(path, `Photo ${j + 1} of ${c.name}`),
          h("button", {
            class: "thumb-x",
            title: "Remove this photo",
            "aria-label": `Remove photo ${j + 1}`,
            "data-focus": `photo-x-${i}-${j}`,
            html: ICON_X,
            onclick: () =>
              withUndo(() => {
                s.photos.splice(j, 1);
                if (!s.photos.length) delete s.photos;
                commit();
                return "Removed a photo";
              }),
          })
        )
      ),
      photos.length < PHOTOS_PER_STOP
        ? h("button", { class: "thumb add", title: "Add photos (or drop them here)", "data-focus": `photo-add-${i}`, onclick: () => picker.click() }, h("span", { html: ICON_PLUS }), "Photos")
        : null,
      picker
    ),
    h("p", { class: "note" }, `Up to ${PHOTOS_PER_STOP} photos. Saving keeps them as they are, in a .zip with your travels.`)
  );
}

// A photo's thumbnail, shown once its copy is made. A photo whose file is not here (the travel
// data was opened without its .zip), or that this browser cannot show, says so.
function thumbImage(path, alt) {
  const img = h("img", { alt });
  photoUrl(path).then((url) => {
    if (url) img.src = url;
    else if (photoFailed(path))
      img.replaceWith(h("span", { class: "thumb-missing", title: "This browser cannot show this photo (for example a HEIC photo outside Safari). It is kept, and saved with your travels." }, "Can't show"));
    else img.replaceWith(h("span", { class: "thumb-missing", title: "This photo is in the .zip your travels were saved in. Open the .zip to see it, or add the photo again." }, "Not here"));
  });
  return img;
}

const isImageFile = (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|bmp|heic|heif)$/i.test(f.name);

async function addPhotos(stop, files) {
  const images = files.filter(isImageFile);
  if (!images.length) return toast("Choose photos, such as JPEG or PNG files");
  const have = stop.photos || [];
  // Photos the stop lists but that are not here can be added again without taking room.
  const missing = have.filter((p) => !photoBlob(p)).length;
  const room = PHOTOS_PER_STOP - have.length;
  if (room <= 0 && !missing) return toast(`A stop holds up to ${PHOTOS_PER_STOP} photos`);
  const take = images.slice(0, Math.max(0, room) + missing);
  toast(take.length === 1 ? "Adding the photo…" : `Adding ${take.length} photos…`);
  const added = [];
  const failed = [];
  let again = 0;
  let found = 0;
  let over = images.length - take.length;
  for (const f of take) {
    try {
      const { path, found: arrived } = await photoFromFile(f);
      // The same photo twice is kept once; one the stop was missing is back.
      if (have.includes(path)) arrived ? found++ : again++;
      else if (added.includes(path)) again++;
      else if (have.length + added.length < PHOTOS_PER_STOP) added.push(path);
      else {
        over++;
        if (arrived && !photoPaths().includes(path)) dropPhoto(path);
      }
    } catch (e) {
      failed.push(e.message);
    }
  }
  if (added.length) stop.photos = [...have, ...added];
  if (added.length || found) commit();
  const parts = [];
  if (added.length) parts.push(`Added ${added.length} ${added.length === 1 ? "photo" : "photos"}`);
  if (found) parts.push(found === 1 ? "Found a missing photo" : `Found ${found} missing photos`);
  if (again) parts.push(again === 1 ? "That photo is here already" : `${again} of the photos are here already`);
  if (failed.length) parts.push(failed.length === 1 ? failed[0] : `${failed.length} files could not be added; try JPEG or PNG photos`);
  if (over) parts.push(`${over} did not fit (up to ${PHOTOS_PER_STOP} per stop)`);
  toast(parts.join(". "));
}

// "Mar 2 – Apr 14, 2025", or with both years when they differ.
function dateRange(a, b) {
  if (a === b) return formatDate(a);
  return a.slice(0, 4) === b.slice(0, 4) ? `${formatDate(a).replace(/, \d{4}$/, "")} – ${formatDate(b)}` : `${formatDate(a)} – ${formatDate(b)}`;
}

// How a stop was reached from the one before: plane, train, car or ship, the distance, and
// for flights an optional flight number.
function legRow(trip, i) {
  const s = trip.stops[i];
  const a = cityByKey.get(trip.stops[i - 1].city);
  const b = cityByKey.get(s.city);
  const mode = s.mode || "flight";
  const setMode = (m) => {
    if (m === mode) return;
    if (m === "flight") delete s.mode;
    else (s.mode = m), delete s.flight;
    delete s.inferred;
    commit();
  };
  return h(
    "li",
    { class: "leg", "data-mode": mode },
    h(
      "span",
      { class: "modes", role: "group", "aria-label": `${a.name} to ${b.name}` },
      MODES.map((m) =>
        h("button", {
          class: `icon-btn mode${m === mode ? " on" : ""}`,
          title: MODE_NAMES[m],
          "aria-label": MODE_NAMES[m],
          "aria-pressed": String(m === mode),
          "data-focus": `leg-${i}-${m}`,
          html: MODE_ICONS[m],
          onclick: () => setMode(m),
        })
      )
    ),
    h("span", { class: "leg-km" }, formatKm(legDistanceKm(a, b))),
    mode === "flight"
      ? h("input", {
          class: "leg-flight",
          value: s.flight || "",
          placeholder: "Flight no.",
          maxlength: "9",
          spellcheck: "false",
          "aria-label": `Flight number from ${a.name} to ${b.name}`,
          "data-focus": `flight-${i}`,
          onchange: (e) => {
            const v = e.target.value.replace(/\s+/g, "").toUpperCase();
            if (v && !FLIGHT_NUMBER.test(v)) {
              e.target.value = s.flight || "";
              return toast("That does not look like a flight number, such as MU523 or BA178");
            }
            e.target.value = v;
            if (v) s.flight = v;
            else delete s.flight;
            // Nothing else in the panel shows the number: keep the panel as it is.
            ui.keepPane = true;
            commit();
          },
        })
      : null
  );
}

function focusTrip(t) {
  const c = t.stops[0] && cityByKey.get(t.stops[0].city);
  if (c) map.flyTo([c.lon, c.lat], 1.6);
}

// Static route of the active trip, drawn while editing.
function updateRoute() {
  const trip = ui.tab === "trips" ? activeTrip() : null;
  if (!trip || !trip.stops.length) {
    map.route = null;
  } else {
    const pts = trip.stops.map((s) => cityByKey.get(s.city)).map((c) => [c.lon, c.lat]);
    map.route = {
      legs: pts.slice(1).map((p, i) => ({ from: pts[i], to: p, progress: 1, fade: 0.9, mode: trip.stops[i + 1].mode || "flight" })),
      stops: pts.map((lonlat) => ({ lonlat })),
      legIcons: true,
    };
  }
  map.invalidate();
}

// ---- Style pane ------------------------------------------------------------

function segmented(options, value, onChange) {
  return h(
    "div",
    { class: "segmented" },
    options.map(([v, label]) => h("button", { class: v === value ? "active" : null, onclick: () => onChange(v) }, label))
  );
}

function toggle(checked, onChange) {
  return h("label", { class: "switch" }, h("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) }), h("span"));
}

function renderStyle() {
  const s = state.settings;
  const set = (fn) => (fn(), commit());
  const pane = $('[data-pane="style"]');
  pane.replaceChildren(
    h("h3", {}, "Appearance"),
    h("div", { class: "row" }, h("label", {}, "Theme"), segmented([["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]], s.theme, (v) => set(() => (s.theme = v)))),
    h("div", { class: "row" }, h("label", {}, "Color by"), segmented([["single", "Single"], ["continent", "Continent"], ["year", "Year"]], s.colorMode, (v) => set(() => (s.colorMode = v)))),
    h(
      "div",
      { class: "row" },
      h("label", { title: "Color the provinces and states you have been to, and pick them on the map once their country is selected" }, "Provinces and states"),
      toggle(s.showRegions !== false, (v) => set(() => (s.showRegions = v)))
    ),
    h(
      "div",
      { class: "row" },
      h("label", {}, "Accent"),
      h(
        "div",
        { class: "swatches" },
        ACCENTS.map((c) => h("button", { class: `swatch${s.accent === c ? " active" : ""}`, style: { background: c }, title: c, onclick: () => set(() => (s.accent = c)) })),
        h("label", { class: `swatch swatch-custom${ACCENTS.includes(s.accent) ? "" : " active"}`, title: "Custom color" }, h("input", { type: "color", value: toHex(s.accent), onchange: (e) => set(() => (s.accent = e.target.value)) }))
      )
    ),
    h("h3", {}, "Labels"),
    h("div", { class: "row" }, h("label", {}, "Country names"), toggle(s.labels.countries, (v) => set(() => (s.labels.countries = v)))),
    h("div", { class: "row" }, h("label", {}, "Cities"), toggle(s.labels.cities, (v) => set(() => (s.labels.cities = v)))),
    h("div", { class: "row" }, h("label", {}, "Oceans and seas"), toggle(s.labels.water, (v) => set(() => (s.labels.water = v)))),
    h("div", { class: "row" }, h("label", {}, "Graticule"), toggle(s.graticule, (v) => set(() => (s.graticule = v)))),
    h("h3", {}, "Map data"),
    h(
      "p",
      { class: "note" },
      "Boundaries follow the U.S. Department of State point of view (Natural Earth USA edition). Names follow U.S. Board on Geographic Names conventions, e.g. Gulf of America. ",
      `${countries.length} countries and regions; the share of the world is counted from the ${countedTotal} independent states the United States recognizes. ${cities.length.toLocaleString("en-US")} major cities are shown on the map; ${extraCities.length.toLocaleString("en-US")} smaller places (GeoNames, 5,000+ people) can be found by search and appear once added. ` +
        `${regions.length} provinces and states in ${regionsByCountry.size} countries (Natural Earth); France, Italy and Spain by region, the United Kingdom by nation.`
    )
  );
}

// ---- Export pane -----------------------------------------------------------

const SIZES = {
  "16:9": { 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] },
  "9:16": { 720: [720, 1280], 1080: [1080, 1920], 2160: [2160, 3840] },
  "1:1": { 720: [720, 720], 1080: [1080, 1080], 2160: [2160, 2160] },
};
let exporting = null;
let videoFormat = "";
supportedFormat().then((f) => {
  videoFormat = f;
  if (ui.tab === "export") renderExport();
});

function videoTrips() {
  const v = state.settings.video;
  if (v.scope === "all") {
    return [...state.trips].filter((t) => t.stops.length).sort((a, b) => (tripDates(a)?.[0] || "").localeCompare(tripDates(b)?.[0] || ""));
  }
  const t = activeTrip();
  return t && t.stops.length ? [t] : [];
}

function renderExport() {
  const v = state.settings.video;
  prepareMusic(musicChoice());
  const set = (fn) => (fn(), commit());
  const pane = $('[data-pane="export"]');
  const trips = videoTrips();
  const tl = trips.length && trips.reduce((n, t) => n + t.stops.length, 0) >= 2 ? buildTimeline(trips, { pace: v.pace }) : null;
  const [w, hgt] = SIZES[v.aspect][v.quality];

  const progress = h("div", { class: "progress", hidden: !exporting }, h("div", { id: "export-bar" }));
  pane.replaceChildren(
    h("h3", {}, "Flight video"),
    h("div", { class: "row" }, h("label", {}, "Content"), segmented([["trip", "Selected trip"], ["all", "All trips"]], v.scope, (x) => set(() => (v.scope = x)))),
    h("div", { class: "row" }, h("label", {}, "Format"), segmented([["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"]], v.aspect, (x) => set(() => (v.aspect = x)))),
    h("div", { class: "row" }, h("label", {}, "Quality"), segmented([["720", "720p"], ["1080", "1080p"], ["2160", "4K"]], v.quality, (x) => set(() => (v.quality = x)))),
    h("div", { class: "row" }, h("label", {}, "Pace"), segmented([["relaxed", "Relaxed"], ["normal", "Normal"], ["fast", "Fast"]], v.pace, (x) => set(() => (v.pace = x)))),
    h("div", { class: "row" }, h("label", {}, "Music"), segmented(MUSIC_CHOICES, musicChoice(), (x) => (x === "file" && !userMusic ? pickMusicFile() : set(() => (v.music = x))))),
    musicNote(),
    h(
      "p",
      { class: "note" },
      tl
        ? `${trips.map((t) => t.name).join(", ")} · ${Math.round(tl.duration)} s · ${w}×${hgt} · ${videoFormat} · ${map.view.morph >= 1 ? "flat map" : "globe"}`
        : "Select a trip with at least two stops in the Trips tab."
    ),
    h(
      "div",
      { class: "btn-row" },
      h("button", { class: "btn", disabled: !tl || !!exporting, onclick: () => play(trips), html: `${ICON_PLAY} Preview` }),
      exporting
        ? h("button", { class: "btn", onclick: () => exporting.abort() }, "Cancel")
        : h("button", { class: "btn primary", disabled: !tl, onclick: () => runExport(trips) }, "Export video")
    ),
    progress,
    ...posterSection(),
    h("h3", {}, "Image"),
    h("p", { class: "note" }, "The map as it is on screen."),
    h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: exportPng }, "Download PNG")),
    h("h3", {}, "Travel data"),
    h("p", { class: "note" }, "Your places and trips live in a separate file. Open it on any device with this map."),
    h(
      "div",
      { class: "btn-row" },
      h("button", { class: "btn", onclick: doOpen }, "Open…"),
      h("button", { class: "btn", onclick: () => doSave() }, "Save"),
      h("button", { class: "btn", onclick: () => doSave(true) }, "Save as…")
    ),
    h("button", { class: "btn block", style: { marginTop: "8px" }, onclick: doImport }, "Import flights from .xls, .xlsx or .csv…"),
    confirmButton(
      "New empty map",
      isDirty() ? "Unsaved changes will be lost. Click again" : "Click again to clear the map",
      () => (stopPicking(), newFile(), toast("Started a new map")),
      { class: "btn danger block", style: { marginTop: "8px" } }
    )
  );
}

// ---- Music -------------------------------------------------------------------

// A music file of the user's own is kept for this visit only: it is not saved in the travel file.
let userMusic = null; // { id, name, buffer }
let musicPlayer = null;

// The music in use: "file" counts only once a file has been chosen in this visit.
function musicChoice() {
  const m = state.settings.video.music || "none";
  return m === "file" && !userMusic ? "none" : m;
}

function musicNote() {
  const m = musicChoice();
  if (m === "none") return null;
  if (m === "file")
    return h("p", { class: "note" }, `${userMusic.name}, looped or cut to the video's length and faded out. It is used for this visit only. `, h("button", { class: "link", onclick: pickMusicFile }, "Change…"));
  return h("p", { class: "note" }, "Made in your browser for each video, so it is free to use anywhere.");
}

async function pickMusicFile() {
  const file = await pickFile("audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac");
  if (!file) return;
  try {
    userMusic = await readMusicFile(file);
    state.settings.video.music = "file";
    commit();
    toast(`Music: ${userMusic.name}`);
  } catch (e) {
    toast(e.message);
  }
}

// Music for the in-page playback. The audio output is set up during the click that starts the
// playback, which browsers require; the music itself is ready a moment later.
function startMusic(duration) {
  musicPlayer?.close();
  musicPlayer = null;
  const choice = musicChoice();
  if (choice === "none") return;
  const mp = (musicPlayer = new MusicPlayer());
  renderMusic(choice, duration, userMusic)
    .then((buffer) => {
      if (musicPlayer !== mp) return;
      mp.buffer = buffer;
      if (player && !player.paused) mp.play(player.t);
    })
    .catch((e) => console.error(e));
}

async function runExport(trips) {
  const v = state.settings.video;
  const [w, hgt] = SIZES[v.aspect][v.quality];
  let tl = buildTimeline(trips, { pace: v.pace });
  const morph = map.view.morph >= 1 ? 1 : 0;
  const th = map.theme;
  const ctrl = new AbortController();
  exporting = ctrl;
  renderExport();
  const s = Math.min(w, hgt) / 900;
  try {
    // Every frame must show its photos, so they are decoded before recording starts; those this
    // browser cannot show are then left out.
    await preloadPhotos(photoPaths(trips));
    tl = buildTimeline(trips, { pace: v.pace });
    const music = await renderMusic(musicChoice(), tl.duration, userMusic).catch(() => null);
    const { blob, ext, audio } = await exportVideo({
      width: w,
      height: hgt,
      fps: 30,
      duration: tl.duration,
      audio: music,
      signal: ctrl.signal,
      draw: (ctx, t) => drawPlayback(ctx, w, hgt, th, tl.frame(t, w, hgt, morph), s),
      onProgress: (p) => {
        const bar = $("#export-bar");
        if (bar) bar.style.width = `${Math.round(p * 100)}%`;
      },
    });
    const name = (trips.length === 1 ? trips[0].name : "travel-atlas").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const silent = musicChoice() !== "none" && !audio ? ". This browser could not add the music" : "";
    if (await download(blob, `${name}.${ext}`)) toast(`Video saved (${(blob.size / 1e6).toFixed(1)} MB)${silent}`);
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      toast(`Export failed: ${e.message}`);
    }
  } finally {
    exporting = null;
    renderExport();
  }
}

function drawPlayback(ctx, w, hgt, th, f, uiScale = 1) {
  drawMap(ctx, {
    width: w,
    height: hgt,
    view: f.view,
    theme: th,
    state,
    firstVisits: firstVisitByCountry(),
    route: f.route,
    reveal: f.reveal,
    revealAlpha: f.revealAlpha,
    revealRegions: f.revealRegions,
    cityFilter: f.cityFilter,
    hideUnvisitedCities: true,
    uiScale,
  });
  drawHud(ctx, w, hgt, f.hud, th, state.settings.accent);
  drawMemory(ctx, w, hgt, f.memory, th);
}


// ---- Poster ------------------------------------------------------------------

const posterOptions = () => ({ data: shownState(), firstVisits: firstVisitByCountry(), theme: map.theme, view: map.view, title: ui.poster.title });

function posterSection() {
  const p = ui.poster;
  const [w, hgt] = POSTER_SIZES[p.format];
  // The preview is the poster drawn small: 640 px on its longer side.
  const scale = 640 / Math.max(w, hgt);
  const preview = h("canvas", { class: `poster-preview ${p.format}`, width: Math.round(w * scale), height: Math.round(hgt * scale), role: "img", "aria-label": "Poster preview" });
  const draw = () => drawPoster(preview.getContext("2d"), preview.width, preview.height, posterOptions());
  draw();
  return [
    h("h3", {}, "Poster"),
    h("p", { class: "note" }, `Your map and numbers in one picture to share, ${w}×${hgt}.${ui.timeline ? ` As of ${ui.timeline.year}, like the map.` : ""}`),
    h("div", { class: "row" }, h("label", {}, "Format"), segmented([["landscape", "Landscape"], ["portrait", "Portrait"]], p.format, (x) => ((p.format = x), renderExport()))),
    h(
      "div",
      { class: "row" },
      h("label", { for: "poster-title" }, "Title"),
      h("input", {
        id: "poster-title",
        class: "text",
        "data-focus": "poster-title",
        value: p.title,
        maxlength: String(POSTER_TITLE_MAX),
        placeholder: "My travels",
        autocomplete: "off",
        oninput: (e) => {
          p.title = e.target.value;
          draw();
        },
      })
    ),
    preview,
    h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: exportPoster }, "Download poster")),
  ];
}

function exportPoster() {
  const [w, hgt] = POSTER_SIZES[ui.poster.format];
  const canvas = h("canvas", { width: w, height: hgt });
  drawPoster(canvas.getContext("2d"), w, hgt, posterOptions());
  canvas.toBlob((b) => download(b, `travel-atlas-poster-${ui.poster.format}.png`).catch((e) => toast(e.message)), "image/png");
}

function exportPng() {
  const w = map.width * 2;
  const hgt = map.height * 2;
  const canvas = h("canvas", { width: w, height: hgt });
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  drawMap(ctx, { width: map.width, height: map.height, view: map.view, theme: map.theme, state: shownState(), firstVisits: firstVisitByCountry() });
  canvas.toBlob((b) => download(b, "travel-atlas.png").catch((e) => toast(e.message)), "image/png");
}

// ---- Travel data file ------------------------------------------------------

// In-page confirmation (system dialogs are unavailable in some hosts).
function ask(message, confirmLabel, cancelLabel = "Cancel") {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.remove();
      resolve(v);
    };
    const overlay = h(
      "div",
      { class: "modal-backdrop", onclick: (e) => e.target === overlay && close(false) },
      h(
        "div",
        { class: "modal", role: "dialog", "aria-modal": "true" },
        h("p", {}, message),
        h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => close(false) }, cancelLabel), h("button", { class: "btn primary", onclick: () => close(true) }, confirmLabel))
      )
    );
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(false);
    });
    document.body.append(overlay);
    overlay.querySelector(".btn.primary").focus();
  });
}

async function confirmDiscard() {
  return !isDirty() || ask("You have unsaved changes. Opening another file replaces them.", "Discard and open");
}

function afterLoad({ name, skipped, missingPhotos }) {
  stopPicking();
  commit();
  const notes = [`Opened ${name}`];
  if (skipped) notes.push(`${skipped} unknown ${skipped === 1 ? "place was" : "places were"} skipped`);
  if (missingPhotos) notes.push(`${missingPhotos} ${missingPhotos === 1 ? "photo is" : "photos are"} not in this file; open the .zip your travels were saved in to see them`);
  toast(notes.join(". "));
  const first = Object.keys(state.countries)[0];
  if (first) map.flyTo(countryById.get(first).label, 1.2);
}

async function doOpen() {
  if (!(await confirmDiscard())) return;
  try {
    const res = await openFile();
    if (res) afterLoad(res);
  } catch (e) {
    toast(e.message || "That file could not be opened");
  }
}

// Commits the text field being typed in (its change event), so that saving includes it.
function commitTyping() {
  const el = document.activeElement;
  if (!el?.matches?.("input:not([type=file]):not([type=range]), textarea")) return;
  const { id } = el;
  const key = el.dataset.focus;
  el.blur();
  const again = (id && document.getElementById(id)) || (key && document.querySelector(`[data-focus="${key}"]`)) || el;
  if (again.isConnected) again.focus();
}

async function doSave(saveAs = false) {
  commitTyping();
  try {
    const out = await saveFile({
      saveAs,
      confirmMissing: (n) =>
        ask(`${n === 1 ? "A photo of these travels is" : `${n} photos of these travels are`} not here, so the .zip you save will not have ${n === 1 ? "it" : "them"}. To keep ${n === 1 ? "it" : "them"}, open the .zip your travels were saved in instead.`, "Save without them"),
    });
    if (!out) return;
    const photos = out.photos ? ` with ${out.photos} ${out.photos === 1 ? "photo" : "photos"}` : "";
    toast(out.missing ? `Saved ${out.name}${photos}. ${out.missing} ${out.missing === 1 ? "photo was" : "photos were"} not here to save` : `Saved ${out.name}${photos}`);
  } catch (e) {
    toast(`Could not save: ${e.message}`);
  }
}

function renderFileBar() {
  const dirty = isDirty();
  const empty = !Object.keys(state.countries).length && !state.trips.length;
  $("#file-name").textContent = file.name || (empty && !dirty ? "No file open" : "Untitled");
  $("#file-bar").classList.toggle("dirty", dirty);
  $("#file-state").textContent = dirty ? "Unsaved changes" : file.name ? "Saved" : "";
}

$("#file-open").onclick = doOpen;
$("#file-save").onclick = () => doSave();

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    doSave(e.shiftKey);
  } else if (mod && e.key.toLowerCase() === "o") {
    e.preventDefault();
    doOpen();
  }
});

// Drop a data file anywhere on the page to open it.
window.addEventListener("dragover", (e) => {
  if ([...(e.dataTransfer?.types || [])].includes("Files")) {
    e.preventDefault();
    document.body.classList.add("dropping");
  }
});
window.addEventListener("dragleave", (e) => e.relatedTarget == null && document.body.classList.remove("dropping"));
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  document.body.classList.remove("dropping");
  const f = e.dataTransfer?.files?.[0];
  if (f && isImportFile(f.name)) return startImport(f);
  if (f && isImageFile(f)) {
    // Photos go to the stop whose photos are open; they are never travel data.
    if (ui.tab === "trips" && ui.memo && activeTrip()?.stops.includes(ui.memo)) return addPhotos(ui.memo, [...e.dataTransfer.files]);
    return toast("To add photos, open Trips and click the photo button next to a stop");
  }
  if (!f || !(await confirmDiscard())) return;
  try {
    afterLoad(await readFile(f));
  } catch (err) {
    toast(err.message || "That file could not be opened");
  }
});

window.addEventListener("pagehide", persistLocal);
window.addEventListener("beforeunload", (e) => {
  persistLocal();
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// Offer back unsaved work from a previous visit (the map itself always starts empty). Unsaved
// work of another tab that is still open is left to that tab.
async function offerDraft() {
  const left = await pendingDraft();
  // Photos kept for unsaved data that is gone are let go.
  if (!left) return tidyUnsavedPhotos();
  const { key, data: draft } = left;
  const count = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : "");
  const what = [
    count(draft.countries?.length || 0, "country", "countries"),
    count(draft.cities?.length || 0, "place", "places"),
    count(draft.trips?.length || 0, "trip", "trips"),
  ].filter(Boolean);
  const banner = $("#restore");
  banner.replaceChildren(
    h("span", {}, `You have unsaved travels from your last visit${what.length ? ` (${what.join(", ")})` : ""}.`),
    h(
      "button",
      {
        class: "btn primary",
        onclick: async () => {
          banner.hidden = true;
          // Photos come back from the browser's database before the data that refers to them.
          await restoreUnsavedPhotos(photoPaths(Array.isArray(draft.trips) ? draft.trips.filter((t) => Array.isArray(t?.stops)) : []));
          stopPicking();
          const { missingPhotos } = loadFileData(draft);
          file.saved = "";
          // It becomes this tab's unsaved data, kept under this tab's name.
          persistLocal();
          discardDraft(key);
          commit();
          // This message also takes the place of any Undo offered before, which would bring
          // back the travels from before the restore.
          toast(missingPhotos || draft.photosLeftOut ? "Restored your travels. Some photos could not be kept in the browser. Add them again, or open the file you saved them in." : "Restored your travels");
        },
      },
      "Restore"
    ),
    h(
      "button",
      {
        class: "btn",
        onclick: () => {
          discardDraft(key);
          banner.hidden = true;
        },
      },
      "Discard"
    )
  );
  banner.hidden = false;
}

// ---- Importing flights ----------------------------------------------------

async function doImport() {
  const f = await pickFile(IMPORT_EXTENSIONS.join(","));
  if (f) startImport(f);
}

// A prompt people can give an AI assistant to turn any flight history, in any language,
// into a table this page reads reliably.
const TRANSLATE_PROMPT = `Convert the attached flight history into a CSV table in English with exactly these columns:
Date,Flight,From,To,Departure time,Arrival time,Arrival date

- Date: departure date as YYYY-MM-DD
- Flight: flight number, e.g. MU5101
- From, To: 3-letter IATA airport codes, e.g. PVG for Shanghai Pudong
- Departure time, Arrival time: local 24-hour HH:MM as in the file
- Arrival date: YYYY-MM-DD (the next day for overnight flights)
- Leave out refunded, cancelled, unused or changed tickets that were not flown
- Do not include ticket numbers or any other personal details

Reply with the CSV text only, with no code block and nothing before or after it, so I can save it as flights.csv.`;

function translateHelp(lead) {
  return h(
    "div",
    { class: "translate-help" },
    h("p", {}, lead),
    h(
      "div",
      { class: "btn-row" },
      h(
        "button",
        {
          class: "btn",
          onclick: async (e) => {
            const btn = e.currentTarget;
            try {
              await navigator.clipboard.writeText(TRANSLATE_PROMPT);
              btn.textContent = "Prompt copied";
            } catch {
              btn.closest(".translate-help").querySelector("details").open = true;
              toast("Copy the prompt from the box below");
            }
          },
        },
        "Copy prompt"
      )
    ),
    h("details", {}, h("summary", {}, "Show the prompt"), h("pre", {}, TRANSLATE_PROMPT)),
    h("p", { class: "fine" }, "The file goes to the assistant you choose. You can delete columns with names or ID numbers before attaching it.")
  );
}

// Shown when a file cannot be read as a flight table, or is not in English.
function importProblem(fileName, message, cjk) {
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  // On the document, so Escape still works after clicking into the prompt text.
  const onKey = (e) => e.key === "Escape" && close();
  const overlay = h("div", { class: "modal-backdrop", onclick: (e) => e.target === overlay && close() });
  overlay.append(
    h(
      "div",
      { class: "modal import", role: "dialog", "aria-modal": "true", "aria-label": "Import flights" },
      h("h2", {}, "Import flights"),
      h("p", { class: "note" }, cjk ? `${fileName} is not in English. This page imports flight lists in English, so convert it first.` : `${fileName}: ${message}`),
      h(
        "div",
        { class: "import-body plain" },
        translateHelp(
          cjk
            ? "Ask an AI assistant such as ChatGPT to convert it: attach the file, paste this prompt, save the reply as a .csv file and import that."
            : "An AI assistant such as ChatGPT can convert most flight lists into a table this page reads: attach the file, paste this prompt, save the reply as a .csv file and import that."
        )
      ),
      h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: close }, "Close"))
    )
  );
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  overlay.querySelector(".btn.primary").focus();
}

async function startImport(f) {
  let rows;
  let flights;
  let skipped;
  try {
    rows = await readTable(f);
    ({ flights, skipped } = parseFlights(rows));
  } catch (e) {
    // Headers in another language are not recognized: say so rather than "no table found".
    importProblem(f.name, e.message || "the file could not be read.", !!rows && rows.slice(0, 10).flat().some(hasCjk));
    return;
  }
  // Any Chinese, Japanese or Korean text (airports, dates, ticket statuses) means the file
  // needs converting to English first.
  if (rows.some((r) => r.some(hasCjk))) return importProblem(f.name, "", true);
  if (!flights.length) return importProblem(f.name, "no flights were found.", rows.slice(0, 10).flat().some(hasCjk));
  importDialog(f.name, flights, skipped);
}

// Review before importing: each airport with the city it maps to (changeable, and required
// for airports that were not recognized), the trips that will be created, and merge/replace.
function importDialog(fileName, flights, skipped) {
  const choice = new Map(); // airport id (IATA or the name in the file) -> city key
  const idOf = (code, name) => code || `?${name}`;
  const ids = [];
  const nameOf = new Map();
  for (const f of flights)
    for (const [code, name] of [[f.from, f.fromName], [f.to, f.toName]]) {
      const id = idOf(code, name);
      if (!nameOf.has(id)) {
        nameOf.set(id, name);
        ids.push(id);
        const city = code && cityForAirport(code);
        if (city) choice.set(id, city);
      }
    }
  // Airports that need a city go first.
  ids.sort((a, b) => choice.has(a) - choice.has(b));
  const empty = !Object.keys(state.countries).length && !state.trips.length;
  let replace = false;
  let editing = null;

  const overlay = h("div", { class: "modal-backdrop", onclick: (e) => e.target === overlay && close() });
  const box = h("div", { class: "modal import", role: "dialog", "aria-modal": "true", "aria-label": "Import flights" });
  overlay.append(box);
  overlay.addEventListener("keydown", (e) => e.key === "Escape" && !e.target.matches("input") && close());
  function close() {
    overlay.remove();
  }

  const tripsNow = () => {
    const usable = flights.map((f) => ({ ...f, from: idOf(f.from, f.fromName), to: idOf(f.to, f.toName) }));
    return buildTrips(usable, (id) => choice.get(id) || null);
  };

  function draw() {
    const trips = tripsNow();
    const missing = ids.filter((id) => !choice.has(id));
    const dates = flights.map((f) => f.date);
    const range = dateRange(dates[0], dates[dates.length - 1]);
    const overland = trips.flatMap((t) => t.stops.map((s, i) => (s.inferred ? `${cityByKey.get(t.stops[i - 1].city).name} → ${cityByKey.get(s.city).name}` : null)).filter(Boolean));
    const parts = [
      h("h2", {}, "Import flights"),
      h("p", { class: "note" }, `${fileName} · ${flights.length} ${flights.length === 1 ? "flight" : "flights"} · ${range}${skipped ? ` · ${skipped} ${skipped === 1 ? "row" : "rows"} skipped (cancelled or incomplete)` : ""}`),
      h("div", { class: "import-body" },
        h("h3", {}, "Airports", h("span", { class: "count" }, String(ids.length))),
        missing.length ? h("p", { class: "note warn" }, `${missing.length} ${missing.length === 1 ? "airport was" : "airports were"} not recognized. Choose a city for ${missing.length === 1 ? "it" : "each"}, or its flights are left out.`) : null,
        h(
          "ul",
          { class: "list import-airports" },
          ids.map((id) => {
            const city = choice.has(id) ? cityByKey.get(choice.get(id)) : null;
            const code = id.startsWith("?") ? "" : id;
            return h(
              "li",
              { class: `item${city ? "" : " missing"}` },
              h("span", { class: "name" }, nameOf.get(id), h("span", { class: "meta" }, code ? `${code} · ${airports.get(code).name}` : "Not recognized")),
              editing === id
                ? citySuggest({
                    id: "import-city",
                    placeholder: "City…",
                    onPick: (c) => {
                      choice.set(id, c.key);
                      editing = null;
                      draw();
                    },
                  })
                : h(
                    "button",
                    { class: city ? "link import-city" : "btn import-city", title: "Choose another city", onclick: () => ((editing = id), draw(), box.querySelector("#import-city")?.focus()) },
                    city ? [city.name, countryById.get(city.cc)?.name].filter(Boolean).join(", ") : "Choose city"
                  )
            );
          })
        ),
        h("h3", {}, "Trips", h("span", { class: "count" }, String(trips.length))),
        h(
          "ul",
          { class: "list import-trips" },
          trips.map((t) =>
            h("li", { class: "item" }, h("span", { class: "name" }, t.name, h("span", { class: "meta" }, `${formatDate(t.stops[0].date)} · ${t.stops.map((s) => cityByKey.get(s.city).name).join(" → ")}`)))
          )
        ),
        overland.length ? h("p", { class: "note" }, `Where a flight leaves from a different nearby city, the trip continues over land, shown as train: ${overland.join(", ")}. You can change this in the trip.`) : null
      ),
      empty
        ? null
        : h(
            "div",
            { class: "row" },
            h("label", {}, "Your map"),
            segmented([["merge", "Add to it"], ["replace", "Replace it"]], replace ? "replace" : "merge", (v) => ((replace = v === "replace"), draw()))
          ),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn", onclick: close }, "Cancel"),
        h(
          "button",
          {
            class: "btn primary",
            disabled: !trips.length,
            onclick: () => {
              const { added, duplicates } = importTrips(trips, { replace });
              close();
              switchTab("trips");
              if (!added) toast("These trips are already on your map");
              else toast(`Imported ${added} ${added === 1 ? "trip" : "trips"}${duplicates ? `. ${duplicates} were already on your map` : ""}`);
              map.resetView();
            },
          },
          `Import ${trips.length} ${trips.length === 1 ? "trip" : "trips"}`
        )
      ),
    ];
    box.replaceChildren(...parts.filter(Boolean));
  }
  draw();
  document.body.append(overlay);
  box.querySelector(".btn.primary")?.focus();
}

// ---- Playback --------------------------------------------------------------

let player = null;

function play(trips) {
  const tl = buildTimeline(trips, { pace: state.settings.video.pace });
  if (!tl) return;
  preloadPhotos(photoPaths(trips));
  stopPicking();
  if (ui.timeline) playYears(false);
  selectPlace(null);
  const morph = map.view.morph >= 1 ? 1 : 0;
  map.stopSpin();
  player = { tl, t: 0, paused: false, last: performance.now() };
  startMusic(tl.duration);
  document.body.classList.add("playing");
  $("#player").hidden = false;
  $("#player").classList.remove("paused");
  $("#tooltip").hidden = true;
  map.overlay = {
    draw: (ctx, w, hgt, th) => {
      const now = performance.now();
      if (!player.paused) player.t = Math.min(tl.duration, player.t + (now - player.last) / 1000);
      player.last = now;
      if (player.t >= tl.duration && !player.paused) setPaused(true);
      drawPlayback(ctx, w, hgt, th, tl.frame(player.t, w, hgt, morph), Math.max(0.85, Math.min(w, hgt) / 900));
      $("#player-scrub").value = String(Math.round((player.t / tl.duration) * 1000));
      $("#player-time").textContent = `${Math.floor(player.t / 60)}:${String(Math.floor(player.t % 60)).padStart(2, "0")}`;
    },
  };
}

function setPaused(p) {
  if (!player) return;
  if (!p && player.t >= player.tl.duration) player.t = 0;
  player.paused = p;
  player.last = performance.now();
  if (p) musicPlayer?.stop();
  else musicPlayer?.play(player.t);
  $("#player").classList.toggle("paused", p);
}

function stopPlayback() {
  musicPlayer?.close();
  musicPlayer = null;
  player = null;
  map.overlay = null;
  document.body.classList.remove("playing");
  $("#player").hidden = true;
  map.invalidate();
}

$("#player-toggle").onclick = () => setPaused(!player?.paused);
$("#player-close").onclick = stopPlayback;
$("#player-scrub").oninput = (e) => {
  if (!player) return;
  player.t = (e.target.value / 1000) * player.tl.duration;
  setPaused(true);
};
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select") || document.querySelector(".modal-backdrop")) return;
  if (picking && e.key === "Escape") return stopPicking();
  if (picking && !e.metaKey && !e.ctrlKey && !e.altKey && pickKey(e)) return;
  if (player) {
    if (e.key === "Escape") stopPlayback();
    else if (e.key === " ") (setPaused(!player.paused), e.preventDefault());
    return;
  }
  if (e.key === "Escape" && ui.selected) selectPlace(null);
  else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    // "/" jumps to search, as on many sites.
    e.preventDefault();
    switchTab("places");
    $("#place-search")?.focus();
  }
});

// ---- Shell -----------------------------------------------------------------

function switchTab(tab) {
  ui.tab = tab;
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const s of document.querySelectorAll("[data-pane]")) s.classList.toggle("active", s.dataset.pane === tab);
  renderPane();
  updateRoute();
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  const hint = $("#hint");
  hint.hidden = !(tab === "trips" && activeTrip());
  hint.textContent = "Click a city on the map, then Add to trip";
  if (window.innerWidth <= 760 && $("#panel").classList.contains("collapsed")) {
    $("#panel").classList.remove("collapsed");
    if (ui.selected) selectPlace(null);
    updateInset();
  }
  renderCard();
}

// Rebuilding the panel while a pointer is down would swallow the click that follows (for
// example a click right after editing a field, whose change event commits first): wait for
// the pointer to come up.
let pointerDown = false;
let panePending = false;
let cardPending = false;
let cardBusy = false;
window.addEventListener("pointerdown", () => (pointerDown = true), true);
for (const type of ["pointerup", "pointercancel"])
  window.addEventListener(
    type,
    () => {
      pointerDown = false;
      if (panePending) setTimeout(() => panePending && renderPane(), 0);
      if (cardPending) setTimeout(() => cardPending && renderCard(), 0);
    },
    true
  );

function renderPane() {
  if (pointerDown) return void (panePending = true);
  panePending = false;
  // Keep keyboard focus on the same control across the rebuild.
  const active = document.activeElement;
  const key = active?.closest?.(".panel") && active.dataset.focus;
  ({ places: renderPlaces, trips: renderTrips, style: renderStyle, export: renderExport })[ui.tab]();
  if (key) document.querySelector(`.panel [data-focus="${key}"]`)?.focus();
}

for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => switchTab(b.dataset.tab);
function updateInset() {
  const open = !$("#panel").classList.contains("collapsed");
  const phone = window.innerWidth <= 760;
  // The timeline bar sits between the panel and the map controls when there is room.
  const left = open && !phone ? $("#panel").getBoundingClientRect().right : 0;
  const controls = $(".controls").offsetWidth;
  document.documentElement.style.setProperty("--map-left", `${Math.round(left)}px`);
  document.documentElement.style.setProperty("--controls-w", `${controls}px`);
  document.body.classList.toggle("tl-raised", window.innerWidth - left - controls - 60 < 380);
  map.targetOx = open && !phone ? 180 : 0;
  // On phones the panel is a bottom sheet; center the map in the space above it.
  const top = phone ? $(".topbar").getBoundingClientRect().bottom : 0;
  const sheet = phone ? (open ? window.innerHeight - $("#panel").getBoundingClientRect().top : 52) : 0;
  map.targetOy = phone ? (top - sheet) / 2 : 0;
}
$("#panel-toggle").onclick = $("#sheet-handle").onclick = () => {
  const panel = $("#panel");
  panel.classList.toggle("collapsed");
  // On phones the open sheet covers most of the map, so the place card closes with it.
  if (window.innerWidth <= 760 && !panel.classList.contains("collapsed")) selectPlace(null);
  updateInset();
};
window.addEventListener("resize", updateInset);
updateInset();
// The phone sheet is short, so there the footer scrolls in at the end of the panel body.
const phoneLayout = window.matchMedia("(max-width: 760px)");
const placeFooter = () => (phoneLayout.matches ? $(".panel-body").append($(".panel-foot")) : $(".panel-body").after($(".panel-foot")));
phoneLayout.addEventListener("change", placeFooter);
placeFooter();
map.view.ox = map.targetOx;
map.view.oy = map.targetOy;
$("#zoom-in").onclick = () => map.zoomBy(1.5);
$("#zoom-out").onclick = () => map.zoomBy(1 / 1.5);
$("#zoom-reset").onclick = () => map.resetView();
for (const b of document.querySelectorAll("#view-toggle button"))
  b.onclick = () => {
    state.settings.view = b.dataset.view;
    map.setView(b.dataset.view);
    commit();
  };

function renderViewToggle() {
  for (const b of document.querySelectorAll("#view-toggle button")) b.classList.toggle("active", b.dataset.view === state.settings.view);
}

for (const c of countries) isoById.set(c.id, c.feature.properties.iso2);

subscribe(() => {
  applyTheme();
  renderFileBar();
  renderStats();
  renderLegend();
  renderViewToggle();
  renderTimeline();
  if (ui.keepPane) ui.keepPane = false;
  else renderPane();
  renderCard();
  updateRoute();
  $("#hint").hidden = !(ui.tab === "trips" && activeTrip());
  prunePhotos(new Set(photoPaths()));
  map.invalidate();
});

// Initial view.
if (state.settings.view === "flat") {
  map.view.morph = 1;
  map.view.k = 1;
  map.view.phi = 0;
}
applyTheme();
renderStats();
renderLegend();
renderViewToggle();
renderFileBar();
renderTimeline();
switchTab("places");
offerDraft();

// Debug/automation hook (used by tests).
window.__travelAtlas = { renderMusic, toFileData, state, file, map, play, buildTimeline, loadSample, drawPlayback, THEMES, stopPlayback, isDirty };
