// Country flags, drawn from small SVG pictures (country-flag-icons, MIT) rather than flag emoji:
// Windows shows flag emoji as two letters, and Apple devices set to mainland China leave out
// Taiwan's.
import * as FLAGS from "country-flag-icons/string/3x2";

const urls = new Map();

/** An image of the flag for an ISO 3166-1 alpha-2 code ("TW"), or null when there is none. */
export function flagImage(iso2) {
  const code = typeof iso2 === "string" ? iso2.toUpperCase() : "";
  const svg = /^[A-Z]{2}$/.test(code) ? FLAGS[code] : null;
  if (!svg) return null;
  if (!urls.has(code)) urls.set(code, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const img = document.createElement("img");
  img.className = "flag-img";
  img.src = urls.get(code);
  img.alt = "";
  img.draggable = false;
  return img;
}
