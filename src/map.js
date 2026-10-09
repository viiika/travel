import { geoInterpolate, geoDistance } from "d3-geo";
import { drawMap, countryAt, cityAt, THEMES, makeProjection, isVisible } from "./render.js";
import { firstVisitByCountry } from "./state.js";
import { regionsByCountry, regionAtLonLat, regionById, cityByKey, countryById } from "./data.js";
import { SPACE_MIN_K, bodyAt } from "./space.js";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Interactive map bound to a canvas. Owns the camera and pointer handling;
 * reads application state through getState().
 */
export class MapView {
  constructor(canvas, { getState, onClick, onHover, onDraw }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.getState = getState;
    this.onClick = onClick;
    this.onHover = onHover;
    this.onDraw = onDraw;
    this.selected = null; // { country: id }, { region: id }, { city: key } or { body: id }, highlighted on the map
    this.view = { lambda: -100, phi: -25, k: 1, ty: 0, morph: 0, ox: 0, oy: 0 };
    // Offsets that keep the map clear of the panel (side panel on desktop, bottom sheet on phones).
    this.targetOx = 0;
    this.targetOy = 0;
    this.hover = { country: null, region: null, city: null, body: null };
    this.cityHits = [];
    this.spaceHits = [];
    this.projection = null;
    this.overlay = null; // playback frame provider: (w, h) => frame
    this.extra = null; // () => extra drawing options, such as countries fading in
    this.animating = null; // () => whether to keep redrawing every frame
    this.anim = null;
    this.spin = { v: 0.012 }; // idle rotation speed (deg per ms), stops on interaction
    this.dirty = true;
    this.pointers = new Map();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.bindPointer();
    const loop = (now) => {
      this.tick(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get theme() {
    return THEMES[document.documentElement.dataset.theme === "dark" ? "dark" : "light"];
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dirty = true;
  }

  invalidate() {
    this.dirty = true;
  }

  tick(now) {
    const dt = this.last ? Math.min(64, now - this.last) : 16;
    this.last = now;
    if (this.anim) {
      const u = clamp((now - this.anim.start) / this.anim.duration, 0, 1);
      this.anim.step(easeInOut(u));
      if (u >= 1) {
        const done = this.anim.done;
        this.anim = null;
        done?.();
      }
      this.dirty = true;
    } else if (this.spin.v && !this.overlay && this.view.morph === 0 && this.pointers.size === 0) {
      this.view.lambda += this.spin.v * dt;
      this.dirty = true;
    } else if (this.inertia && this.pointers.size === 0) {
      this.applyDrag(this.inertia.dx * dt, this.inertia.dy * dt);
      this.inertia.dx *= 0.92;
      this.inertia.dy *= 0.92;
      if (Math.hypot(this.inertia.dx, this.inertia.dy) < 0.005) this.inertia = null;
      this.dirty = true;
    }
    for (const [key, target] of [["ox", this.targetOx], ["oy", this.targetOy]]) {
      if (Math.abs(this.view[key] - target) > 0.5) {
        this.view[key] += (target - this.view[key]) * Math.min(1, dt / 90);
        this.dirty = true;
      } else this.view[key] = target;
    }
    if (this.overlay || this.animating?.()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  }

  draw() {
    const { ctx, width, height, dpr } = this;
    const state = this.getState();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.overlay) {
      this.overlay.draw(ctx, width, height, this.theme);
      return;
    }
    const res = drawMap(ctx, {
      width,
      height,
      view: this.view,
      theme: this.theme,
      state,
      firstVisits: firstVisitByCountry(),
      hoverId: this.hover.city || this.hover.region ? null : this.hover.country?.id,
      hoverRegion: this.hover.city ? null : this.hover.region?.id,
      hoverCity: this.hover.city?.key,
      hoverBody: this.hover.body?.id,
      selectedBody: this.selected?.body,
      selectedId: this.selected?.country,
      selectedRegion: this.selected?.region,
      selectedCity: this.selected?.city,
      regionsOf: this.selectedCountry(),
      route: this.route,
      ...this.extra?.(),
    });
    this.projection = res.projection;
    this.cityHits = res.cityHits;
    this.spaceHits = res.space;
    this.onDraw?.();
  }

  /** Screen position of a lon/lat point, or null when it is behind the globe or off screen. */
  project(lonlat) {
    const p = this.projection;
    if (!p || !isVisible(p, lonlat, 0.02)) return null;
    const pt = p(lonlat);
    if (!pt || pt[0] < 0 || pt[1] < 0 || pt[0] > this.width || pt[1] > this.height) return null;
    return pt;
  }

  // ---- Camera ----------------------------------------------------------

  stopSpin() {
    this.spin.v = 0;
  }

  setView(mode) {
    const target = mode === "flat" ? 1 : 0;
    if (this.view.morph === target) return;
    this.stopSpin();
    const from = { ...this.view };
    const to = { ...this.view, morph: target, k: target ? 1 : Math.max(0.9, Math.min(from.k, 1.6)), ty: 0 };
    this.animate(from, to, 900);
  }

  animate(from, to, duration, done) {
    this.anim = {
      start: performance.now(),
      duration,
      done,
      step: (e) => {
        for (const key of Object.keys(to)) this.view[key] = from[key] + (to[key] - from[key]) * e;
      },
    };
  }

  flyTo([lon, lat], k = 2.5, duration = 1100) {
    this.stopSpin();
    const from = { ...this.view };
    const center0 = [-from.lambda, from.morph >= 1 ? lat : -from.phi];
    const interp = geoInterpolate(center0, [lon, lat]);
    const dist = geoDistance(center0, [lon, lat]);
    const dip = Math.min(0.45, dist / 3);
    const flat = from.morph >= 1;
    const tyTarget = flat ? this.tyFor(lat, k) : 0;
    this.anim = {
      start: performance.now(),
      duration: duration + dist * 250,
      step: (e) => {
        const c = interp(e);
        this.view.lambda = -c[0];
        if (!flat) this.view.phi = clamp(-c[1], -89, 89);
        const kk = from.k + (k - from.k) * e;
        this.view.k = kk * (1 - dip * Math.sin(Math.PI * e));
        if (flat) this.view.ty = from.ty + (tyTarget - from.ty) * e;
      },
    };
  }

  // Vertical offset that puts latitude `lat` at the canvas center in flat mode.
  tyFor(lat, k) {
    const p = makeProjection({ lambda: 0, phi: 0, k, ty: 0, morph: 1, ox: this.view.ox, oy: this.view.oy }, this.width, this.height);
    return this.height / 2 + this.view.oy - p([0, lat])[1];
  }

  zoomBy(f, at) {
    this.stopSpin();
    const v = this.view;
    const minK = v.morph >= 1 ? 1 : SPACE_MIN_K;
    const k1 = clamp(v.k * f, minK, 14);
    if (v.morph >= 1 && at) {
      // Keep the point under the cursor fixed.
      const before = this.projection.invert(at);
      v.k = k1;
      const p = makeProjection(v, this.width, this.height);
      const after = p(before);
      if (after) {
        this.applyFlatPan(at[0] - after[0], at[1] - after[1]);
      }
    } else {
      v.k = k1;
    }
    this.clampFlat();
    this.dirty = true;
  }

  /** Zooms out on the globe to `k`, where space shows (switching from the flat map if needed). */
  showSpace(k, duration = 1100) {
    this.stopSpin();
    const from = { ...this.view };
    this.animate(from, { ...from, morph: 0, k, ty: 0 }, duration);
  }

  resetView() {
    const from = { ...this.view };
    const flat = from.morph >= 1;
    this.animate(from, { ...from, k: 1, ty: 0, phi: flat ? from.phi : -20 }, 700);
  }

  applyDrag(dx, dy) {
    const v = this.view;
    if (v.morph >= 1) {
      this.applyFlatPan(dx, dy);
    } else {
      const s = 57 / (this.projection ? this.projection.scale() : 300);
      v.lambda += dx * s;
      v.phi = clamp(v.phi - dy * s, -89, 89);
    }
    this.clampFlat();
    this.dirty = true;
  }

  applyFlatPan(dx, dy) {
    const v = this.view;
    const p = makeProjection(v, this.width, this.height);
    // Equal Earth x-scale near the equator is ~1.34 * scale per radian.
    v.lambda += ((dx / (p.scale() * 1.34)) * 180) / Math.PI;
    v.ty += dy;
  }

  clampFlat() {
    const v = this.view;
    if (v.morph < 1) return;
    const p = makeProjection({ ...v, ty: 0 }, this.width, this.height);
    const halfH = p.scale() * 1.3173;
    const limit = Math.max(0, halfH - this.height / 2 + 40);
    v.ty = clamp(v.ty, -limit, limit);
  }

  // ---- Pointer ---------------------------------------------------------

  bindPointer() {
    const c = this.canvas;
    let start = null;
    let lastMove = null;
    let pinch = null;

    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (this.overlay) return;
      this.inertia = null;
      this.anim = null;
      if (this.pointers.size === 1) {
        start = { x: e.offsetX, y: e.offsetY, moved: false };
        lastMove = { x: e.offsetX, y: e.offsetY, t: performance.now(), dx: 0, dy: 0 };
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: this.view.k };
        start = null;
      }
    });

    c.addEventListener("pointermove", (e) => {
      if (this.overlay) return;
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomBy((pinch.k * (d / pinch.d)) / this.view.k);
        return;
      }
      if (start && this.pointers.size === 1) {
        const dx = e.offsetX - lastMove.x;
        const dy = e.offsetY - lastMove.y;
        if (!start.moved && Math.hypot(e.offsetX - start.x, e.offsetY - start.y) > 4) {
          start.moved = true;
          this.stopSpin();
          c.classList.add("dragging");
          this.setHover({}, e);
        }
        if (start.moved) {
          this.applyDrag(dx, dy);
          const now = performance.now();
          const dt = Math.max(1, now - lastMove.t);
          lastMove = { x: e.offsetX, y: e.offsetY, t: now, dx: dx / dt, dy: dy / dt };
        }
        return;
      }
      this.updateHover(e);
    });

    const end = (e) => {
      this.pointers.delete(e.pointerId);
      c.classList.remove("dragging");
      if (this.pointers.size < 2) pinch = null;
      if (this.overlay) return;
      if (start && !start.moved && e.type === "pointerup") {
        // The second click of a double click zooms in (see dblclick). It does not pick again,
        // which would go on from the country the first click picked to the place under it.
        const now = performance.now();
        const again = this.lastClick && now - this.lastClick.t < 500 && Math.hypot(e.offsetX - this.lastClick.x, e.offsetY - this.lastClick.y) < 8;
        this.lastClick = again ? null : { t: now, x: e.offsetX, y: e.offsetY };
        // Fingers are less precise than a mouse, so touch gets a larger target around city dots.
        if (!again) this.onClick(this.hitTest(e.offsetX, e.offsetY, e.pointerType === "touch" ? 16 : 8), e);
      } else if (start && start.moved && performance.now() - lastMove.t < 60) {
        this.inertia = { dx: lastMove.dx, dy: lastMove.dy };
      }
      start = null;
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => this.pointers.size === 0 && this.setHover({}));

    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.overlay) return;
        this.anim = null;
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
        this.zoomBy(f, [e.offsetX, e.offsetY]);
      },
      { passive: false }
    );

    c.addEventListener("dblclick", (e) => {
      if (this.overlay || !this.projection?.invert) return;
      const ll = this.projection.invert([e.offsetX, e.offsetY]);
      if (ll && !Number.isNaN(ll[0])) this.flyTo(ll, Math.min(14, this.view.k * 2), 600);
    });
  }

  /** The country the selection is in: the selected country, or that of the selected province, state, city or place. */
  selectedCountry() {
    const s = this.selected;
    if (!s) return null;
    return s.country || (s.region ? regionById.get(s.region)?.cc : cityByKey.get(s.city)?.cc) || null;
  }

  hitTest(x, y, radius = 7) {
    if (!this.projection) return {};
    const lonlat = this.lonlatAt(x, y);
    // Zoomed far out: the Moon, the Sun and the planets. The Earth's places come first, until
    // it is small enough to be one of the planets (then it is among the bodies).
    const asPlanet = this.spaceHits.some((p) => p.body.id === "earth");
    const body = (asPlanet || !lonlat) && bodyAt(this.spaceHits, x, y, radius);
    if (body) return { body };
    // The map points at a country first. Once the country, or a place in it, is selected, it
    // points at the country's cities, provinces and states. Places of the user's own are
    // pointed at straight away.
    const inside = this.selectedCountry();
    const city = cityAt(this.cityHits, x, y, radius);
    if (city && (city.custom || !countryById.has(city.cc) || city.cc === inside)) return { city, lonlat };
    // A city dot over the sea stands for its country.
    const country = countryAt(this.projection, x, y) || (city && countryById.get(city.cc)) || null;
    let region = null;
    if (country && country.id === inside && lonlat && regionsByCountry.has(country.id) && this.getState().settings.showRegions !== false)
      region = regionAtLonLat(lonlat, country.id, 10);
    return { country, region, lonlat };
  }

  /** The lon/lat point under a screen point, or null off the globe or the map. */
  lonlatAt(x, y) {
    const p = this.projection;
    if (!p?.invert) return null;
    const ll = p.invert([x, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
    // Outside the map's outline the inverse wraps around; projecting back does not land here.
    const back = p(ll);
    if (!back || Math.hypot(back[0] - x, back[1] - y) > 1 || !isVisible(p, ll, 0)) return null;
    return ll;
  }

  updateHover(e) {
    this.setHover(this.hitTest(e.offsetX, e.offsetY), e);
  }

  /** Where a body of space is on screen, or null when it is not in view. */
  bodyPoint(id) {
    const p = this.spaceHits.find((b) => b.body.id === id);
    return p && p.x >= 0 && p.y >= 0 && p.x <= this.width && p.y <= this.height ? [p.x, p.y] : null;
  }

  setHover({ country = null, region = null, city = null, body = null }, e) {
    const changed = this.hover.country !== country || this.hover.region !== region || this.hover.city !== city || this.hover.body !== body;
    this.hover = { country, region, city, body };
    this.canvas.classList.toggle("pointing", !!(country || city || body));
    if (changed) this.dirty = true;
    this.onHover(this.hover, e);
  }
}
