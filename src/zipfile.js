// Travel data with photos is saved as a .zip: the data file (JSON) at the top, and the photos,
// as they were added, in a "photos" folder next to it. The data refers to each photo by its
// path in the .zip.
import { Zip, ZipDeflate, ZipPassThrough, unzipSync, strToU8, strFromU8 } from "fflate";

/** Whether bytes start like a .zip file. */
export function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// The .zip is written without ZIP64 records, so it must stay under 4 GiB and 65,535 files.
const ZIP_MAX_BYTES = 0xffffffff;
const ZIP_MAX_FILES = 0xffff;

/**
 * About how large the .zip of a data file and its photos will be, in bytes, from their sizes and
 * names, erring on the large side; Infinity when it has more files than a .zip can hold.
 * `photos`: a list of [path, size].
 */
export function zipSize(jsonName, jsonBytes, photos) {
  if (photos.length + 1 > ZIP_MAX_FILES) return Infinity;
  // Each file has a local header and a central directory entry, both with its name.
  const entry = (name, size) => size + 30 + 46 + 2 * new TextEncoder().encode(name).length;
  // Compression can make some data slightly larger.
  let total = entry(jsonName, Math.ceil(jsonBytes * 1.001) + 64) + 22;
  for (const [path, size] of photos) total += entry(path, size);
  return total;
}

/** Whether a .zip of that size can be written. */
export const zipFits = (bytes) => bytes <= ZIP_MAX_BYTES;

/**
 * Packs the data file and its photos. `photos` is a list of [path, bytes]. The data is
 * compressed; photos are stored as they are, since they are compressed already.
 * Returns the parts of the .zip, ready for a Blob.
 */
export function packTravelZip(jsonName, json, photos) {
  const parts = [];
  let failed = null;
  const zip = new Zip((err, chunk) => {
    if (err) failed = err;
    else parts.push(chunk);
  });
  const data = new ZipDeflate(jsonName, { level: 6 });
  zip.add(data);
  data.push(strToU8(json), true);
  for (const [path, bytes] of photos) {
    const f = new ZipPassThrough(path);
    zip.add(f);
    f.push(bytes, true);
  }
  zip.end();
  if (failed) throw failed;
  return parts;
}

// Files a computer adds when it zips a folder: macOS resource forks and Finder settings.
const JUNK = /(^|\/)(__MACOSX\/|\._|\.DS_Store$)/;
// Some tools (older Windows ones) write "photos\a.jpg" for "photos/a.jpg", or start with "./".
const entryName = (name) => name.replace(/\\/g, "/").replace(/^(\.?\/)+/, "");

/**
 * Reads a travel .zip: finds the data file (at the top or in one folder, as when the .zip was
 * unpacked and packed again), and reads the files it refers to. `wanted(data)` lists the paths
 * the data refers to, relative to the data file. Returns { data, name, files: Map(path -> bytes) }.
 */
export function unpackTravelZip(bytes, wanted) {
  let jsons;
  try {
    jsons = unzipSync(bytes, { filter: (f) => /\.json$/i.test(f.name) && !JUNK.test(entryName(f.name)) });
  } catch {
    throw new Error("This .zip file is damaged or uses a format that cannot be read.");
  }
  // The data file nearest the top wins; one of another kind (such as a stray settings file) is
  // passed over.
  jsons = Object.fromEntries(Object.entries(jsons).map(([name, b]) => [entryName(name), b]));
  const names = Object.keys(jsons).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  let found = null;
  for (const name of names) {
    let data;
    try {
      data = JSON.parse(strFromU8(jsons[name]));
    } catch {
      continue;
    }
    if (data && typeof data === "object" && (data.format === "travel-atlas" || Array.isArray(data.trips) || Array.isArray(data.countries))) {
      found = { name, data };
      break;
    }
  }
  if (!found) throw new Error("This .zip file has no Travel Atlas data in it.");
  const dir = found.name.includes("/") ? found.name.slice(0, found.name.lastIndexOf("/") + 1) : "";
  const want = new Set([...wanted(found.data)].map((p) => dir + p));
  let raw = {};
  if (want.size) {
    try {
      raw = unzipSync(bytes, { filter: (f) => want.has(entryName(f.name)) });
    } catch {
      throw new Error("This .zip file is damaged or uses a format that cannot be read.");
    }
  }
  const files = new Map(Object.entries(raw).map(([name, b]) => [entryName(name).slice(dir.length), b]));
  return { data: found.data, name: found.name.slice(dir.length), files };
}
