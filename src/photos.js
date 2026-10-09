// Photos and notes on trip stops: keeping the photos as they were added, the copies used to
// draw them, and the card that shows them during playback and in videos.
import { FONT } from "./render.js";

// Photos are kept as the original files. Saving puts them in a .zip next to the travel data
// (see datafile.js), which refers to each by its path in the .zip, "photos/<hash>.<type>": the
// same picture always gets the same path. For thumbnails, playback and videos, each photo is
// decoded once into a copy at most PHOTO_MAX_EDGE pixels across.
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_MAX_BYTES = 50 * 1024 * 1024;
export const PHOTOS_PER_STOP = 8;
export const NOTE_MAX = 500;

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/heic": "heic", "image/heif": "heif", "image/bmp": "bmp" };
const TYPE_OF_EXT = { ...Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t])), jpeg: "image/jpeg" };
const PHOTO_PATH = new RegExp(`^photos/[0-9a-f]{16}\\.(?:${Object.values(EXT).join("|")})$`);
// Travel files saved before photos moved to the .zip have them embedded as data URLs.
const EMBEDDED = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Whether a value names a photo: its path in the .zip. */
export const isPhotoPath = (src) => typeof src === "string" && PHOTO_PATH.test(src);

/** Whether a value from a travel file is a photo: a path, or a photo embedded in an older file. */
export function isPhoto(src) {
  return isPhotoPath(src) || (typeof src === "string" && src.length < 20e6 && EMBEDDED.test(src));
}

/** The image type of a file name's extension ("IMG_1.JPG" -> "image/jpeg"), or "". */
export function typeOfName(name) {
  return TYPE_OF_EXT[String(name).split(".").pop().toLowerCase()] || "";
}

/** The image type the bytes of a file start with, or "". */
export function sniffType(b) {
  const at = (i, s) => [...s].every((ch, j) => b[i + j] === ch.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && at(1, "PNG")) return "image/png";
  if (at(0, "GIF8")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (at(0, "BM")) return "image/bmp";
  if (at(4, "ftyp")) {
    const brand = String.fromCharCode(...b.subarray(8, 12));
    if (/^avi[fs]$/.test(brand)) return "image/avif";
    if (/^(hei[cmsx]|hev[cmsx]|mif1|msf1)$/.test(brand)) return "image/heic";
  }
  return "";
}

// A 64-bit fingerprint of the bytes (two 32-bit halves), seeded with their length.
function fingerprint(bytes) {
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    const ch = bytes[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

// The original of each photo, by path.
const originals = new Map();

/** Keeps a photo's bytes and returns its path, or "" when they are not an image this page keeps. */
export function addPhotoBytes(bytes, type = sniffType(bytes)) {
  const ext = EXT[type];
  if (!ext) return "";
  const path = `photos/${fingerprint(bytes)}.${ext}`;
  if (!originals.has(path)) originals.set(path, new Blob([bytes], { type }));
  return path;
}

/** A photo embedded in an older travel file, kept like an added one. Returns its path or "". */
export function photoFromDataUrl(src) {
  const m = typeof src === "string" && EMBEDDED.exec(src);
  if (!m) return "";
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return addPhotoBytes(bytes, sniffType(bytes) || m[1]);
}

/** The original file of a photo, or null when it is not here (a data file opened without its .zip). */
export function photoBlob(path) {
  return originals.get(path) || null;
}

/** The paths of the photos whose originals are here. */
export function photosHere() {
  return [...originals.keys()];
}

/** Forgets the originals of photos no longer in the travel data. */
export function forgetPhotos(keep) {
  for (const path of originals.keys()) if (!keep.has(path)) originals.delete(path);
  prunePhotos(keep);
}

/**
 * Reads an image file the user chose and keeps it as it is. Returns { path, found }: `found`
 * when its original was not here before (a new photo, or one the data refers to but that was
 * missing). Fails for files that are not images, are too large, or that this browser cannot show.
 */
export async function photoFromFile(file) {
  if (file.size > PHOTO_MAX_BYTES) throw new Error(`${file.name} is larger than ${PHOTO_MAX_BYTES / 1024 / 1024} MB`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes) || (EXT[file.type] ? file.type : typeOfName(file.name));
  const before = new Set(originals.keys());
  const path = addPhotoBytes(bytes, type);
  if (!path) throw new Error(`${file.name} is not a photo this page can keep`);
  // Making its copy now tells whether this browser can show it.
  if (!(await entry(path, true).promise)) {
    if (!before.has(path)) {
      originals.delete(path);
      copies.delete(path);
    }
    throw new Error(`${file.name} could not be read in this browser`);
  }
  return { path, found: !before.has(path) };
}

/** Lets go of a photo that was read but is not used after all. */
export function dropPhoto(path) {
  originals.delete(path);
  const e = copies.get(path);
  if (e?.url) URL.revokeObjectURL(e.url);
  copies.delete(path);
}

// Copies are made a few at a time: decoding many full-size photos at once can run a phone out
// of memory.
const DECODES_AT_ONCE = 3;
let decoding = 0;
const waiting = [];
function queued(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      decoding++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          decoding--;
          waiting.shift()?.();
        });
    };
    if (decoding < DECODES_AT_ONCE) run();
    else waiting.push(run);
  });
}

// Decodes a photo and scales it down for drawing. Transparent areas become white, as in a print.
async function makeCopy(blob) {
  let source;
  try {
    source = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => (URL.revokeObjectURL(url), resolve(img));
      img.onerror = () => (URL.revokeObjectURL(url), reject(new Error("unreadable")));
      img.src = url;
    });
  }
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  if (!sw || !sh) throw new Error("unreadable");
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const copy = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!copy) throw new Error("unreadable");
  const url = URL.createObjectURL(copy);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { img, url };
}

// Copies by path. Drawing never waits: a photo whose copy is still being made is skipped, and
// video export calls preloadPhotos first.
const copies = new Map();

// `retry`: try again to make a copy that could not be made (decoding can fail when memory is
// short). Drawing does not retry, as it asks for each photo on every frame.
function entry(path, retry = false) {
  let e = copies.get(path);
  // A photo that was missing may have arrived since (added again, or from the browser's database).
  if (!e || (e.missing && originals.has(path)) || (retry && e.failed)) {
    const blob = originals.get(path);
    e = { img: null, url: "", ready: false, missing: !blob, failed: false };
    e.promise = (blob ? queued(() => makeCopy(blob)) : Promise.reject(new Error("missing"))).then(
      ({ img, url }) => {
        // Forgotten meanwhile: let the copy go.
        if (copies.get(path) !== e) URL.revokeObjectURL(url);
        else Object.assign(e, { img, url, ready: true });
        return img;
      },
      () => {
        // Here but not shown: a kind of picture this browser cannot read (such as HEIC outside
        // Safari), or a damaged file.
        if (blob) e.failed = true;
        return null;
      }
    );
    copies.set(path, e);
  }
  return e;
}

/** Whether a photo is here but this browser could not show it (known once its copy was tried). */
export function photoFailed(path) {
  return !!copies.get(path)?.failed;
}

/** The decoded copy of a photo, or null while it is being made (or when it cannot be). */
export function photoImage(path) {
  const e = entry(path);
  return e.ready ? e.img : null;
}

/** A URL of a photo's copy, for an <img>, once made: resolves "" when it cannot be shown. */
export function photoUrl(path) {
  const e = entry(path);
  return e.ready ? Promise.resolve(e.url) : e.promise.then(() => e.url);
}

/** Makes the copies of photos ahead of drawing them. */
export function preloadPhotos(paths) {
  return Promise.all(paths.map((path) => entry(path, true).promise));
}

/** Lets go of the copies of photos that are no longer shown. */
export function prunePhotos(inUse) {
  for (const [path, e] of copies)
    if (!inUse.has(path)) {
      if (e.url) URL.revokeObjectURL(e.url);
      copies.delete(path);
    }
}

// ---- Unsaved photos --------------------------------------------------------

// Unsaved travel data is kept in the browser (state.js) in case the page closes. Its photos are
// too large for that storage, so they go to the browser's database. Where that is unavailable
// (private windows, some embedded frames), unsaved photos are not kept. The database is shared
// by every tab of the page, so it is read each time rather than remembered.
const DB_NAME = "travel-atlas";
const DB_STORE = "unsaved-photos";
let dbPromise = null;
let syncing = Promise.resolve(); // one change to the database at a time

function db() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  return dbPromise;
}

function request(mode, fn) {
  return db().then(
    (d) =>
      d &&
      new Promise((resolve) => {
        try {
          const tx = d.transaction(DB_STORE, mode);
          const req = fn(tx.objectStore(DB_STORE));
          tx.oncomplete = () => resolve(req?.result ?? true);
          tx.onerror = tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

/**
 * Keeps the originals of these photos (of unsaved travel data) in the browser's database, and lets
 * go of those kept before that are not in `keep` (the photos of every tab's unsaved data).
 * Resolves once the database is up to date.
 */
export function keepUnsavedPhotos(paths, keep = new Set(paths)) {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  const want = new Set(paths);
  syncing = syncing
    .then(async () => {
      const keys = await request("readonly", (s) => s.getAllKeys());
      if (!Array.isArray(keys)) return;
      const extra = keys.filter((k) => !keep.has(k) && !want.has(k));
      if (extra.length) await request("readwrite", (s) => extra.forEach((k) => s.delete(k)));
      const have = new Set(keys);
      for (const path of want) {
        const blob = originals.get(path);
        if (blob && !have.has(path)) await request("readwrite", (s) => s.put(blob, path));
      }
    })
    .catch(() => {});
  return syncing;
}

/** Brings back the photos kept for unsaved travel data. Resolves how many were found. */
export async function restoreUnsavedPhotos(paths) {
  if (typeof indexedDB === "undefined") return 0;
  let found = 0;
  for (const path of paths) {
    if (originals.has(path)) {
      found++;
      continue;
    }
    const blob = await request("readonly", (s) => s.get(path));
    if (blob instanceof Blob) {
      originals.set(path, blob);
      found++;
    }
  }
  return found;
}

/** Drops the photos kept for unsaved travel data. */
export function dropUnsavedPhotos() {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  syncing = syncing.then(() => request("readwrite", (s) => s.clear())).catch(() => {});
  return syncing;
}

// ---- Playback card ---------------------------------------------------------

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Splits text into at most maxLines lines that fit maxWidth, ending with "…" when cut.
function wrap(ctx, text, maxWidth, maxLines) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines) {
      line = "";
      break;
    }
  }
  if (line) lines.push(line);
  const cut = lines.length > maxLines || words.join(" ") !== lines.join(" ");
  const out = lines.slice(0, maxLines);
  if (cut && out.length) {
    let last = out[out.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    out[out.length - 1] = `${last.trimEnd()}…`;
  }
  // A single word wider than the card is shortened too.
  return out.map((l) => {
    if (ctx.measureText(l).width <= maxWidth) return l;
    let s = l;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws the photos and note of the stop the playback is at.
 * memory: { photos, note, alpha, index, mix } from the timeline; the stop sits at the center
 * of the frame, so the card goes to the right (landscape, square) or above it (portrait).
 */
export function drawMemory(ctx, width, height, memory, th) {
  if (!memory || memory.alpha <= 0) return;
  const s = Math.min(width, height) / 1080;
  const pad = 64 * s;
  const portrait = height > width * 1.2;
  const inner = 14 * s;
  const w = portrait ? Math.min(width - 2 * pad, 760 * s) : Math.min(width / 2 - pad - 90 * s, 600 * s);
  const top = portrait ? pad + 150 * s : pad + 130 * s;
  const bottom = portrait ? height / 2 - 70 * s : height - pad - 170 * s;
  const x = portrait ? (width - w) / 2 : width - pad - w;

  ctx.save();
  ctx.font = `400 ${26 * s}px ${FONT}`;
  const noteLines = memory.note ? wrap(ctx, memory.note, w - 2 * inner - 8 * s, memory.photos.length ? 3 : 7) : [];
  const lineH = 36 * s;
  const noteH = noteLines.length ? noteLines.length * lineH + 22 * s : 0;

  // The photo frame takes the proportions of the stop's first photo (within 3:4 to 16:9), and
  // every photo is shown whole inside it.
  const img = memory.photos.length ? photoImage(memory.photos[memory.index]) : null;
  const prev = memory.mix < 1 && memory.index > 0 ? photoImage(memory.photos[memory.index - 1]) : null;
  const first = memory.photos.length ? photoImage(memory.photos[0]) : null;
  let photoW = 0;
  let photoH = 0;
  if (memory.photos.length) {
    const ratio = clamp(first ? first.naturalWidth / first.naturalHeight : 4 / 3, 3 / 4, 16 / 9);
    photoW = w - 2 * inner;
    photoH = Math.min(photoW / ratio, Math.max(80 * s, bottom - top - noteH - 2 * inner));
  }
  const h = photoH ? inner + photoH + (noteH || inner) : 2 * inner + noteH;
  const y = clamp(portrait ? top : (top + bottom) / 2 - h / 2, top, Math.max(top, bottom - h));

  // Card rises slightly as it fades in.
  ctx.globalAlpha = memory.alpha;
  ctx.translate(0, (1 - memory.alpha) * 18 * s);
  ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
  ctx.shadowBlur = 40 * s;
  ctx.shadowOffsetY = 12 * s;
  roundRect(ctx, x, y, w, h, 20 * s);
  ctx.fillStyle = th.card;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = th.cardLine;
  ctx.lineWidth = 1 * s;
  ctx.stroke();

  if (photoH) {
    const px = x + inner;
    const py = y + inner;
    ctx.save();
    roundRect(ctx, px, py, photoW, photoH, 10 * s);
    ctx.clip();
    ctx.fillStyle = th.ocean;
    ctx.fillRect(px, py, photoW, photoH);
    const drawWhole = (im, a) => {
      if (!im) return;
      const r = Math.min(photoW / im.naturalWidth, photoH / im.naturalHeight);
      const dw = im.naturalWidth * r;
      const dh = im.naturalHeight * r;
      ctx.globalAlpha = memory.alpha * a;
      ctx.drawImage(im, px + (photoW - dw) / 2, py + (photoH - dh) / 2, dw, dh);
    };
    drawWhole(prev, 1 - memory.mix);
    drawWhole(img, prev ? memory.mix : 1);
    ctx.restore();
    // Several photos: dots show which one is on screen.
    if (memory.photos.length > 1) {
      const n = memory.photos.length;
      const gap = 14 * s;
      let dx = px + photoW / 2 - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++, dx += gap) {
        ctx.beginPath();
        ctx.arc(dx, py + photoH - 16 * s, (i === memory.index ? 4 : 3) * s, 0, Math.PI * 2);
        ctx.fillStyle = i === memory.index ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)";
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1 * s;
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  if (noteLines.length) {
    ctx.globalAlpha = memory.alpha;
    ctx.fillStyle = th.label;
    ctx.font = `400 ${26 * s}px ${FONT}`;
    ctx.textBaseline = "alphabetic";
    let ty = y + (photoH ? photoH + inner : inner) + 8 * s + 26 * s;
    for (const line of noteLines) {
      ctx.fillText(line, x + inner + 4 * s, ty);
      ty += lineH;
    }
  }
  ctx.restore();
}
