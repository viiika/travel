// Finding the province or state at a point. Shared by the page and the data build, which must
// agree on it (see tools/build-data.mjs).
import { geoContains } from "d3-geo";

const inBounds = ([[x0, y0], [x1, y1]], [lon, lat]) => lat >= y0 && lat <= y1 && (x0 <= x1 ? lon >= x0 && lon <= x1 : lon >= x0 || lon <= x1);

/**
 * The region in `list` ({ feature, bounds }) containing a lon/lat point. Region and country
 * outlines are simplified separately, so a point on the coast may fall just outside every
 * region; with `near`, the region within about that many km is taken instead.
 */
export function findRegion(list, [lon, lat], near = 0) {
  const find = (p) => list.find((r) => inBounds(r.bounds, p) && geoContains(r.feature, p)) || null;
  const hit = find([lon, lat]);
  if (hit || !near) return hit;
  // Look around the point in widening rings.
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  for (const km of [2, 5, 10, 20, 40].filter((d) => d <= near)) {
    const dLat = km / 111;
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * 2 * Math.PI;
      const r = find([lon + (Math.cos(t) * dLat) / cosLat, lat + Math.sin(t) * dLat]);
      if (r) return r;
    }
  }
  return null;
}

// How far from a city its region is looked for.
export const CITY_NEAR_KM = 40;
