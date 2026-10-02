// @fx-when: [data-fx="flight"]
// Home — the projects as a flight path (markup: templates/home.mjs, section #projects).
//
// The three missions are waypoints on one trajectory. This module measures where the medallions
// really are and plots the curve through them — an ascent from left to right on wide screens,
// a path that winds down the left side on narrow ones. With effects on, a solid "burn" is drawn
// along the dashed plan as the section scrolls through the viewport, a marker rides its tip and
// each waypoint lights up (.is-reached) when the marker gets there. With effects off the whole
// path is simply drawn.
//
// Layout is read only when it changes (init, resize, late images); a frame costs one transform,
// a table lookup and — when the tip of the burn has moved by a whole pixel — one dash offset,
// and nothing at all while the section is off screen or the marker has settled. The drawing is
// a layer of its own, no larger than the path (home.css): redrawing the burn repaints nothing
// else of the page.

import { core } from '../core.js';

const { clamp, damp, lerp, qs, qsa, inView } = core.utils;

const SAMPLES = 180;          // points of the path kept for the marker (position + heading)
const HALO = 1.1;             // the halo ring's radius, in medallion radii
const RAIL = 0.2;             // narrow screens: where the path runs, as a share of the list's indent (home.css --rail / --indent)
const FOLLOW = 5.5;           // how eagerly the marker follows the scroll
const MARGIN = 4;             // px around the path inside its drawing: room for the stroke and its round cap

/**
 * Smooth curve through the points (Catmull-Rom → cubic Béziers). A copy of curve() in
 * templates/home.mjs, which draws the path the page is served with; the build checks that the
 * two are identical.
 */
function curve(points) {
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  const xy = (p) => `${+p[0].toFixed(1)} ${+p[1].toFixed(1)}`;
  let d = `M${xy(points[0])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += ` C${xy([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${xy([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${xy(p2)}`;
  }
  return d;
}

/** Layout position of `el` inside `ancestor` (an offset parent of it), blind to transforms and reveal offsets. */
function offsetIn(el, ancestor) {
  let x = 0, y = 0;
  for (let node = el; node && node !== ancestor; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

export default function init() {
  const field = qs('[data-fx="flight"]');
  const svg = field && qs('.flight__path', field);
  const plan = field && qs('.flight__plan', field);
  const burn = field && qs('.flight__burn', field);
  const marker = field && qs('.flight__marker', field);
  const list = field && qs('.flight__list', field);
  const stops = field ? qsa('.waypoint', field).map((el) => ({ el, medal: qs('.waypoint__medal', el), x: 0, y: 0, at: 0, reached: null })) : [];
  if (!svg || !plan || !burn || !marker || !list || stops.length < 2 || stops.some((s) => !s.medal)) return;

  const authored = { viewBox: svg.getAttribute('viewBox'), d: plan.getAttribute('d') };   // the no-JS path, put back by destroy()
  // shape of the two end legs on wide screens, shared with the template's own plot (home.mjs)
  const liftoff = Number(field.dataset.liftoff) || 1;
  const coast = Number(field.dataset.coast) || 1;
  const track = new Float32Array((SAMPLES + 1) * 3);   // x, y, heading (rad) along the path
  const geo = { top: 0, w: 0, h: 0, length: 0, row: true };
  let t = 0;                 // drawn share of the path, 0 → 1 (damped)
  let shown = -1;
  let dash = -1;             // the dash offset on the burn, whole px (-1: not ours)
  let visible = false;
  const disposers = [];

  // ── geometry ─────────────────────────────────────────────────────────────

  /** Measure the medallions and plot the path through them. */
  function plot() {
    const fr = field.getBoundingClientRect();
    if (!fr.width || !fr.height) return;
    geo.top = fr.top + window.scrollY;
    geo.w = fr.width;
    geo.h = fr.height;
    const radius = stops[0].medal.offsetWidth / 2;
    for (const s of stops) {
      const at = offsetIn(s.medal, field);
      s.x = at.x + s.medal.offsetWidth / 2;
      s.y = at.y + s.medal.offsetHeight / 2;
    }
    const first = stops[0], second = stops[1], last = stops[stops.length - 1], before = stops[stops.length - 2];
    geo.row = Math.abs(second.x - first.x) > Math.abs(second.y - first.y);

    const points = [];
    if (geo.row) {
      // lift-off at the left edge, steeper than the first leg; a flatter coast to the right edge
      points.push([0, first.y + (first.y - second.y) * (first.x / (second.x - first.x)) * liftoff]);
      for (const s of stops) points.push([s.x, s.y]);
      points.push([geo.w, last.y - (before.y - last.y) * ((geo.w - last.x) / (last.x - before.x)) * coast]);
    } else {
      // down the rail, swinging in to touch each medallion's halo
      const rail = offsetIn(stops[0].el, field).x * RAIL;
      points.push([rail, 0]);
      stops.forEach((s, i) => {
        if (i) points.push([rail, (stops[i - 1].y + s.y) / 2]);
        points.push([s.x - radius * HALO, s.y]);
      });
      points.push([rail, geo.h]);
    }

    const d = curve(points);
    plan.setAttribute('d', d);
    burn.setAttribute('d', d);
    field.classList.add('is-plotted');

    geo.length = burn.getTotalLength();
    burn.style.strokeDasharray = `${geo.length.toFixed(1)} ${geo.length.toFixed(1)}`;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i <= SAMPLES; i++) {
      const pt = burn.getPointAtLength((i / SAMPLES) * geo.length);
      track[i * 3] = pt.x;
      track[i * 3 + 1] = pt.y;
      x0 = Math.min(x0, pt.x); x1 = Math.max(x1, pt.x);
      y0 = Math.min(y0, pt.y); y1 = Math.max(y1, pt.y);
    }
    // The drawing covers the path and nothing more, one unit to the pixel, in field coordinates.
    const box = { x: Math.floor(x0 - MARGIN), y: Math.floor(y0 - MARGIN), w: Math.ceil(x1 - x0 + MARGIN * 2) + 1, h: Math.ceil(y1 - y0 + MARGIN * 2) + 1 };
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    Object.assign(svg.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    for (let i = 0; i <= SAMPLES; i++) {
      const a = Math.max(0, i - 1) * 3, b = Math.min(SAMPLES, i + 1) * 3;
      track[i * 3 + 2] = Math.atan2(track[b + 1] - track[a + 1], track[b] - track[a]);
    }
    // where along the path each waypoint lies: the sample closest to the point the curve was led through
    stops.forEach((s, k) => {
      const [px, py] = points[geo.row ? k + 1 : k * 2 + 1];
      let best = Infinity;
      for (let i = 0; i <= SAMPLES; i++) {
        const dist = Math.hypot(track[i * 3] - px, track[i * 3 + 1] - py);
        if (dist < best) { best = dist; s.at = i / SAMPLES; }
      }
    });
    shown = dash = -1;
  }

  // ── flight ───────────────────────────────────────────────────────────────

  /** Share of the path that should be drawn at the current scroll position. */
  function target() {
    const top = geo.top - core.scroll.y;         // client Y of the field
    const vh = core.viewport.h;
    if (geo.row) {
      // from the moment the first medallion comes up, until the field sits in the viewport
      const from = vh * 0.9 - stops[0].y;
      const to = Math.min(from - 160, Math.max(96, (vh - geo.h) / 2));
      return clamp((from - top) / (from - to));
    }
    // the marker keeps to a line a little below the middle of the viewport
    const y = vh * 0.6 - top;
    let lo = 0, hi = SAMPLES;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (track[mid * 3 + 1] < y) lo = mid + 1; else hi = mid;
    }
    return lo / SAMPLES;
  }

  /** Draw the burn up to share `to` of the path. Redrawing it is a repaint: only when a whole pixel is gained or lost. */
  function burnTo(to) {
    const offset = Math.round(geo.length * (1 - to));
    if (offset === dash) return;
    dash = offset;
    burn.style.strokeDashoffset = offset;
  }

  function draw() {
    shown = t;
    burnTo(t);
    const f = t * SAMPLES;
    const i = Math.min(SAMPLES - 1, Math.floor(f));
    const k = f - i;
    const a = i * 3, b = a + 3;
    const x = lerp(track[a], track[b], k), y = lerp(track[a + 1], track[b + 1], k);
    marker.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${track[(k < 0.5 ? a : b) + 2].toFixed(3)}rad)`;
    marker.style.opacity = clamp(t * 40) * clamp((1 - t) * 40);   // it appears at lift-off and leaves at the end
    for (const s of stops) {
      const reached = t >= s.at - 0.004;
      if (reached !== s.reached) {
        s.reached = reached;
        s.el.classList.toggle('is-reached', reached);
      }
    }
  }

  function frame(dt) {
    if (!visible || !geo.length) return;
    const goal = target();
    t = Math.abs(goal - t) < 0.0006 ? goal : damp(t, goal, FOLLOW, dt);
    if (t !== shown) draw();
  }

  /** Effects off: the whole trajectory, drawn; no marker. */
  function still() {
    field.classList.remove('is-flying');
    burnTo(1);
    marker.style.transform = marker.style.opacity = '';
    for (const s of stops) {
      s.reached = null;
      s.el.classList.remove('is-reached');
    }
  }

  function sync() {
    if (!geo.length) return;
    if (!core.fx.enabled) { still(); return; }
    field.classList.add('is-flying');
    t = target();               // start where the scroll already is: nothing replays on load or resize
    draw();
  }

  // ── wiring ───────────────────────────────────────────────────────────────

  const replot = () => { plot(); sync(); };
  replot();
  disposers.push(
    core.tick(frame),
    core.on('resize', replot),
    core.on('fx:change', sync),
    inView(field, (on) => {
      visible = on;
      field.classList.toggle('is-live', on);
    }, { rootMargin: '15% 0px' }),
  );
  if ('ResizeObserver' in window) {
    // late fonts and images resize the list; anything above it that changes height (the hero's
    // scroll runway coming and going) moves it, and shows as a change of the body's height
    const ro = new ResizeObserver(replot);
    ro.observe(list);
    ro.observe(document.body);
    disposers.push(() => ro.disconnect());
  }

  return {
    destroy() {
      for (const dispose of disposers.splice(0)) dispose();
      still();
      field.classList.remove('is-plotted', 'is-live');
      burn.style.strokeDasharray = burn.style.strokeDashoffset = '';
      svg.style.left = svg.style.top = svg.style.width = svg.style.height = '';
      svg.setAttribute('viewBox', authored.viewBox);
      plan.setAttribute('d', authored.d);
      burn.setAttribute('d', authored.d);
    },
  };
}
