// Zoomed out past the globe's usual size, space opens up around it: the Moon, the Sun and the
// planets. A tribute drawn for looks rather than to scale. The planets sit where they are on
// today's date, on circular orbits spaced by a root of their distance from the Sun, and sizes are
// evened out so that each one can be seen. Zooming out shows the Moon first, then the Sun and the
// planets, and the view moves from the Earth to the Sun until the whole solar system is in sight.

// Globe zoom at which the whole solar system is in view. Below the usual smallest zoom (0.6) the
// Moon comes into view, then the Sun and the planets, while the view moves toward the Sun.
export const SPACE_MIN_K = 0.012;
const MOON_FROM = 0.6;
const MOON_FULL = 0.42;
const SYSTEM_FROM = 0.15;
const SYSTEM_FULL = 0.075;
const SHIFT_FROM = 0.15;
const SHIFT_TO = 0.02;

// Distances and sizes in Earth radii (the globe's radius on screen).
const ORBIT = 22.5; // the Earth's orbit; others go by their distance in AU to the power 0.4
const MOON_DISTANCE = 3.4;
const SUN_RADIUS = 4.2;

// a: distance from the Sun (AU); L0: mean longitude at J2000 (degrees), n: degrees per day.
export const BODIES = [
  { id: "sun", name: "Sun", kind: "Star", r: SUN_RADIUS, color: "#ffb347", fact: "The star at the center of the solar system" },
  { id: "mercury", name: "Mercury", kind: "Planet", a: 0.387, L0: 252.25, n: 4.092334, r: 0.42, color: "#b9b1a6", fact: "The smallest planet, nearest the Sun" },
  { id: "venus", name: "Venus", kind: "Planet", a: 0.723, L0: 181.98, n: 1.602130, r: 0.8, color: "#e6cc98", fact: "The hottest planet, under thick clouds" },
  { id: "earth", name: "Earth", kind: "Planet", a: 1, L0: 100.46, n: 0.985647, color: "#4f86d9", fact: "The third planet from the Sun, and the only one known to have life" },
  { id: "moon", name: "Moon", kind: "The Earth's moon", r: 0.3, color: "#cfd1d4", fact: "384,400 km from the Earth · 12 people have walked on it", addable: true },
  { id: "mars", name: "Mars", kind: "Planet", a: 1.524, L0: 355.43, n: 0.524021, r: 0.6, color: "#d2643f", fact: "The red planet · 1.5 times as far from the Sun as the Earth", addable: true },
  { id: "jupiter", name: "Jupiter", kind: "Planet", a: 5.203, L0: 34.35, n: 0.083085, r: 2.1, color: "#d8b48c", band: "#b98a62", fact: "The largest planet" },
  { id: "saturn", name: "Saturn", kind: "Planet", a: 9.537, L0: 50.08, n: 0.033444, r: 1.8, color: "#e2c891", ring: "#cdb47e", fact: "The ringed planet" },
  { id: "uranus", name: "Uranus", kind: "Planet", a: 19.19, L0: 314.06, n: 0.011733, r: 1.25, color: "#9fd5db", fact: "An ice giant, tipped on its side" },
  { id: "neptune", name: "Neptune", kind: "Planet", a: 30.07, L0: 304.35, n: 0.005981, r: 1.2, color: "#5b7fd6", fact: "The farthest planet from the Sun" },
];
export const bodyById = new Map(BODIES.map((b) => [b.id, b]));
/** The places beyond the Earth that can be added. */
export const ADDABLE = BODIES.filter((b) => b.addable);

const DAYS = (Date.now() - Date.UTC(2000, 0, 1, 12)) / 864e5;
const orbitRadius = (b) => ORBIT * b.a ** 0.4;
const rad = (d) => (d * Math.PI) / 180;
// Where a planet is, in Earth radii from the Sun, with y pointing down the screen (north up).
function orbitPoint(b) {
  const L = rad(b.L0 + b.n * DAYS);
  const d = orbitRadius(b);
  return [d * Math.cos(L), -d * Math.sin(L)];
}
const EARTH = orbitPoint(bodyById.get("earth"));
// The Moon goes round the Earth (its mean longitude today).
const MOON_ANGLE = rad(218.316 + 13.176396 * DAYS);

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const between = (k, from, to) => smooth(Math.log(from / k) / Math.log(from / to));

/** How much of space shows at a globe zoom (0 to 1): the Moon, and the Sun and the planets. */
export function spaceAmount(k, morph = 0) {
  const globe = morph >= 1 ? 0 : 1 - morph;
  return { moon: between(k, MOON_FROM, MOON_FULL) * globe, system: between(k, SYSTEM_FROM, SYSTEM_FULL) * globe };
}

// Below this radius on screen the Earth is too small to point at its places.
const EARTH_PLACES_RADIUS = 70;

/**
 * Whether the Earth is shown as one planet among the others, named and picked as a whole rather
 * than by its places: once the Sun and the planets come into view, or once it is too small.
 */
export function earthAsPlanet(k, radius, morph = 0) {
  const { moon, system } = spaceAmount(k, morph);
  return moon > 0 && (system > 0 || radius < EARTH_PLACES_RADIUS);
}

/**
 * How far the Earth is moved from the middle of the view, in pixels, so that zoomed all the way
 * out the Sun is in the middle. `radius`: the globe's radius on screen.
 */
export function spaceShift(k, radius, morph = 0) {
  const s = morph >= 1 ? 0 : between(k, SHIFT_FROM, SHIFT_TO) * (1 - morph);
  return s ? [EARTH[0] * radius * s, EARTH[1] * radius * s] : [0, 0];
}

// Where each body is on screen, for a globe of `radius` pixels centered at (cx, cy).
function layout(cx, cy, radius) {
  const sun = [cx - EARTH[0] * radius, cy - EARTH[1] * radius];
  return BODIES.filter((b) => b.id !== "earth").map((b) => {
    let x;
    let y;
    if (b.id === "sun") [x, y] = sun;
    else if (b.id === "moon") [x, y] = [cx + Math.cos(MOON_ANGLE) * MOON_DISTANCE * radius, cy - Math.sin(MOON_ANGLE) * MOON_DISTANCE * radius];
    else {
      const [px, py] = orbitPoint(b);
      [x, y] = [sun[0] + px * radius, sun[1] + py * radius];
    }
    return { body: b, x, y, r: Math.max(b.r * radius, b.id === "sun" ? 6 : 2.2) };
  });
}

// Deterministic stars for the dark theme, in fractions of the view.
const STARS = (() => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 260 }, () => [rand(), rand(), 0.35 + rand() * 0.9, 0.25 + rand() * 0.6]);
})();

/**
 * Draws space behind the globe and returns where each body is ({ body, x, y, r }), for pointing
 * at them. Draws nothing and returns [] while the globe is at its usual size.
 * opts: { theme, accent, visited (Set of ids), hover (id), selected (id), dark, uiScale }
 */
export function drawSpace(ctx, projection, width, height, k, opts) {
  const { moon: moonAmount, system: amount } = spaceAmount(k, projection.morph);
  if (moonAmount <= 0) return [];
  const th = opts.theme;
  const u = opts.uiScale || 1;
  const [cx, cy] = projection.translate();
  const radius = projection.scale();
  const bodies = layout(cx, cy, radius);
  const sun = bodies[0];
  // Each body shows as much as its stage: the Moon first, then the Sun and the planets.
  const shown = (id) => (id === "moon" ? moonAmount : amount);
  ctx.save();

  if (opts.dark) {
    ctx.fillStyle = "#dfe7f5";
    for (const [x, y, r, a] of STARS) {
      ctx.globalAlpha = moonAmount * a;
      ctx.beginPath();
      ctx.arc(x * width, y * height, r * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Orbits: the Moon's around the Earth, the planets' around the Sun.
  ctx.strokeStyle = th.orbit;
  ctx.lineWidth = 1 * u;
  ctx.globalAlpha = moonAmount;
  ctx.setLineDash([2 * u, 4 * u]);
  ctx.beginPath();
  ctx.arc(cx, cy, MOON_DISTANCE * radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = amount;
  if (amount > 0)
    for (const b of BODIES) {
      if (!b.a) continue;
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, orbitRadius(b) * radius, 0, Math.PI * 2);
      ctx.stroke();
    }

  // The Sun: a warm disc in a soft glow.
  const glowR = sun.r * 2.8;
  if (amount > 0 && onScreen(sun.x, sun.y, glowR, width, height)) {
    const glow = ctx.createRadialGradient(sun.x, sun.y, sun.r * 0.6, sun.x, sun.y, glowR);
    glow.addColorStop(0, "rgba(255, 176, 70, 0.55)");
    glow.addColorStop(0.45, "rgba(255, 150, 60, 0.16)");
    glow.addColorStop(1, "rgba(255, 140, 60, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, glowR, 0, Math.PI * 2);
    ctx.fill();
    const disc = ctx.createRadialGradient(sun.x - sun.r * 0.3, sun.y - sun.r * 0.3, sun.r * 0.1, sun.x, sun.y, sun.r);
    disc.addColorStop(0, "#fff1b8");
    disc.addColorStop(0.55, "#ffc45c");
    disc.addColorStop(1, "#ff9a3c");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of bodies.slice(1)) {
    ctx.globalAlpha = shown(p.body.id);
    if (!ctx.globalAlpha || !onScreen(p.x, p.y, p.r * 2, width, height)) continue;
    drawBody(ctx, p, [sun.x - p.x, sun.y - p.y]);
  }

  // Rings for the bodies pointed at, selected or added, and names.
  ctx.font = `500 ${11 * u}px ${opts.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const p of bodies) {
    const a = shown(p.body.id);
    if (!a || !onScreen(p.x, p.y, p.r + 40 * u, width, height)) continue;
    const id = p.body.id;
    const on = opts.visited?.has(id);
    const ring = id === opts.selected ? 1 : id === opts.hover ? 0.6 : on ? 0.9 : 0;
    if (ring) {
      ctx.globalAlpha = a * ring;
      ctx.strokeStyle = on || id === opts.selected ? opts.accent : th.label;
      ctx.lineWidth = 1.6 * u;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 4 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Zoomed all the way out the Moon is too close to the Earth to name.
    if (id === "moon" && MOON_DISTANCE * radius < 34 * u) continue;
    ctx.globalAlpha = a;
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = th.halo;
    ctx.fillStyle = on ? opts.accent : th.labelMuted;
    const ty = p.y + p.r + (ring ? 8 : 5) * u;
    ctx.strokeText(p.body.name, p.x, ty);
    ctx.fillText(p.body.name, p.x, ty);
  }
  ctx.restore();
  return bodies.filter((p) => shown(p.body.id) > 0.3);
}

const onScreen = (x, y, r, w, h) => x + r > 0 && y + r > 0 && x - r < w && y - r < h;

// A planet or the Moon: a disc in its color, lit from the Sun.
function drawBody(ctx, { body: b, x, y, r }, toSun) {
  const len = Math.hypot(toSun[0], toSun[1]) || 1;
  const [lx, ly] = [toSun[0] / len, toSun[1] / len];
  if (b.ring) {
    // The back half of Saturn's rings, then the planet, then the front half.
    ringHalf(ctx, b, x, y, r, Math.PI, 2 * Math.PI);
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = b.color;
  ctx.fill();
  ctx.clip();
  if (b.band) {
    ctx.fillStyle = b.band;
    for (const [f, hgt] of [[-0.45, 0.14], [-0.12, 0.1], [0.2, 0.16], [0.52, 0.08]]) ctx.fillRect(x - r, y + f * r, 2 * r, hgt * r);
  }
  if (b.id === "moon" && r > 5) {
    ctx.fillStyle = "rgba(120, 125, 135, 0.35)";
    for (const [dx, dy, s] of [[-0.35, -0.2, 0.22], [0.25, 0.3, 0.16], [0.1, -0.45, 0.12], [-0.1, 0.25, 0.1]]) {
      ctx.beginPath();
      ctx.arc(x + dx * r, y + dy * r, s * r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const shade = ctx.createRadialGradient(x + lx * r * 0.45, y + ly * r * 0.45, r * 0.1, x, y, r * 1.15);
  shade.addColorStop(0, "rgba(255, 255, 255, 0.3)");
  shade.addColorStop(0.55, "rgba(255, 255, 255, 0)");
  shade.addColorStop(1, "rgba(10, 15, 30, 0.5)");
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
  if (b.ring) ringHalf(ctx, b, x, y, r, 0, Math.PI);
}

function ringHalf(ctx, b, x, y, r, from, to) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.42);
  ctx.scale(1, 0.32);
  ctx.strokeStyle = b.ring;
  for (const [f, w, a] of [[1.55, 0.32, 0.9], [1.95, 0.22, 0.6]]) {
    ctx.globalAlpha *= a;
    ctx.lineWidth = w * r;
    ctx.beginPath();
    ctx.arc(0, 0, f * r, from, to);
    ctx.stroke();
    ctx.globalAlpha /= a;
  }
  ctx.restore();
}

/** The body under a screen point, from what drawSpace returned, or null. */
export function bodyAt(bodies, x, y, radius = 8) {
  let best = null;
  let bestD = Infinity;
  for (const p of bodies) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < Math.max(p.r + radius / 2, radius + 4) && d < bestD) [best, bestD] = [p.body, d];
  }
  return best;
}
