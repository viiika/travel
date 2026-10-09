import { toFileData, loadFileData, markSaved, file, photoPaths, dataFingerprint } from "./state.js";
import { download } from "./export.js";
import { addPhotoBytes, photoBlob, sniffType, typeOfName, photosHere, forgetPhotos } from "./photos.js";
import { isZip, packTravelZip, unpackTravelZip, zipSize, zipFits } from "./zipfile.js";

// Travel data lives in its own file, separate from the map page: a .json file, or, once it has
// photos, a .zip holding the .json and the photos as they were added (see zipfile.js).
// Where the browser allows it (Chrome, Edge), Save writes back to the file that was
// opened. Elsewhere, and inside sandboxed frames, Open uses a file input and Save
// downloads a copy.

const JSON_TYPE = { description: "Travel Atlas data", accept: { "application/json": [".json"] } };
const ZIP_TYPE = { description: "Travel Atlas data with photos", accept: { "application/zip": [".zip"] } };
const OPEN_TYPES = [{ description: "Travel Atlas data", accept: { "application/json": [".json"], "application/zip": [".zip"] } }];
const OPEN_ACCEPT = "application/json,.json,application/zip,.zip";
const DEFAULT_BASE = "my-travels";

const isZipName = (name) => /\.zip$/i.test(name || "");
// "Trip 2025.json" -> "Trip 2025"
const baseName = (name) => (name || "").replace(/\.(json|zip)$/i, "").trim() || DEFAULT_BASE;

function canUsePickers() {
  try {
    return "showOpenFilePicker" in window && window.self === window.top;
  } catch {
    return false;
  }
}

/** Asks the user for a file with a file input. Resolves the File, or null when cancelled. */
export function pickFile(accept) {
  return pickWithInput(accept);
}

function pickWithInput(accept = OPEN_ACCEPT) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files[0] || null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

// The photo references of each stop in a parsed data file, as written.
function photoRefs(data) {
  const trips = Array.isArray(data?.trips) ? data.trips : [];
  return trips.flatMap((t) => (Array.isArray(t?.stops) ? t.stops : [])).flatMap((s) => (Array.isArray(s?.photos) ? s.photos.filter((p) => typeof p === "string") : []));
}

// "./photos/a.jpg" and "photos\a.jpg" name the same file in the .zip as "photos/a.jpg".
const zipPath = (ref) => ref.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

/**
 * Reads the travel data and photos of a .zip. Photos are kept by the path their content gives
 * them, and the data's references are changed to match.
 */
function readZip(bytes) {
  const { data, files } = unpackTravelZip(bytes, (d) => photoRefs(d).filter((r) => !r.startsWith("data:")).map(zipPath));
  const paths = new Map();
  for (const [name, b] of files) {
    const path = addPhotoBytes(b, sniffType(b) || typeOfName(name));
    if (path) paths.set(name, path);
  }
  for (const t of Array.isArray(data.trips) ? data.trips : [])
    for (const s of Array.isArray(t?.stops) ? t.stops : [])
      if (Array.isArray(s?.photos)) s.photos = s.photos.map((r) => (typeof r === "string" && paths.get(zipPath(r))) || r);
  return data;
}

/** Reads a File (from a picker, input or drop). Returns { name, skipped, missingPhotos }. */
export async function readFile(f, handle = null) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const had = photosHere();
  try {
    let data;
    if (isZip(bytes)) data = readZip(bytes);
    else {
      try {
        data = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Error(`${f.name} is not a travel data file (.json or .zip).`);
      }
    }
    const { skipped, missingPhotos } = loadFileData(data, f.name, handle);
    return { name: f.name, skipped, missingPhotos };
  } catch (e) {
    // A file that does not load leaves the travels as they were, without its photos.
    forgetPhotos(new Set([...had, ...photoPaths()]));
    throw e;
  }
}

/** Asks for a data file and loads it. Resolves null when the user cancels. */
export async function openFile() {
  if (canUsePickers()) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: OPEN_TYPES });
      return readFile(await handle.getFile(), handle);
    } catch (e) {
      if (e.name === "AbortError") return null;
      if (e.name !== "SecurityError") throw e;
    }
  }
  const f = await pickWithInput();
  return f ? readFile(f) : null;
}

/**
 * What to save: the data as JSON, or, once it has photos here, a .zip of the data and the
 * photos. A file that is a .zip stays one. Photos the data refers to but that are not here (it
 * was opened without its .zip) stay referred to, and are counted in `missing`.
 */
function planFile() {
  const data = toFileData();
  const paths = photoPaths(data.trips);
  const here = paths.filter((p) => photoBlob(p));
  const zip = here.length > 0 || isZipName(file.name);
  const base = baseName(file.name);
  const json = JSON.stringify(data, null, 2);
  if (zip) {
    const bytes = zipSize(`${base}.json`, new TextEncoder().encode(json).length, here.map((p) => [p, photoBlob(p).size]));
    if (!zipFits(bytes))
      throw new Error(
        bytes === Infinity
          ? "these travels have more photos than a .zip file can hold. Remove some photos and save again."
          : `these travels and their photos come to ${(bytes / 1024 ** 3).toFixed(1)} GB, more than a .zip file can hold (4 GB). Remove some photos and save again.`
      );
  }
  return { data, json, base, here, zip, name: `${base}.${zip ? "zip" : "json"}`, photos: here.length, missing: paths.length - here.length };
}

async function packFile(plan) {
  if (!plan.zip) return new Blob([plan.json], { type: "application/json" });
  const photos = [];
  for (const path of plan.here) photos.push([path, new Uint8Array(await photoBlob(path).arrayBuffer())]);
  return new Blob(packTravelZip(`${plan.base}.json`, plan.json, photos), { type: "application/zip" });
}

/** The file to save: { blob, name, zip, photos, missing } (see planFile). */
export async function travelFile() {
  const { name, zip, photos, missing, ...plan } = planFile();
  return { blob: await packFile({ zip, ...plan }), name, zip, photos, missing };
}

/**
 * Saves the travel data. Resolves to { name, zip, photos, missing }, or null when cancelled.
 * Saving photos for the first time into a .json file makes a .zip next to it. Before a new .zip
 * is made without some of the photos, `confirmMissing(count)` is asked whether to go on: the
 * .zip they are in could be replaced by one without them.
 */
export async function saveFile({ saveAs = false, confirmMissing = null } = {}) {
  const plan = planFile();
  const loads = file.loads;
  // What is marked as saved is the data written: changes made while it is being written (which
  // can take a while with many photos) stay unsaved.
  const saved = dataFingerprint(plan.data);
  if (plan.missing && plan.zip && !isZipName(file.name) && confirmMissing && !(await confirmMissing(plan.missing))) return null;
  const { name, zip, photos, missing } = plan;
  const out = { name, zip, photos, missing };
  let handle = saveAs ? null : file.handle;
  if (handle && isZipName(handle.name) !== out.zip) handle = null;
  if (!handle && canUsePickers() && "showSaveFilePicker" in window) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName: out.name, types: [out.zip ? ZIP_TYPE : JSON_TYPE] });
    } catch (e) {
      if (e.name === "AbortError") return null;
      handle = null;
    }
  }
  // The file is packed once the picker has been answered, which must follow the click at once.
  const blob = await packFile(plan);
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    // Another file was opened meanwhile: the save is done, and that file is not marked.
    if (file.loads === loads) markSaved(handle.name, handle, saved);
    return { ...out, name: handle.name };
  }
  if (!(await download(blob, out.name))) return null;
  if (file.loads === loads) markSaved(out.name, null, saved);
  return out;
}
