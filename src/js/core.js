// Shared runtime for every FX module: environment flags, pointer/scroll/viewport state,
// one requestAnimationFrame ticker, a tiny event bus and math/DOM helpers.
//
// Contract (see docs/ARCHITECTURE.md §4): modules import { core } and never register their own
// rAF loop, scroll or pointermove listeners — they read core.pointer / core.scroll and use
// core.tick() / core.on() instead. That keeps the whole site on one frame loop.

const doc = document;
const root = doc.documentElement;
const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });

const FX_KEY = 'aurora:fx';
const IDLE_AFTER = 3;           // seconds without input before core.time.idle turns true

// ── math helpers ───────────────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent smoothing: move `a` toward `b`; higher lambda = snappier. */
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const map = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
const mapClamp = (v, a, b, c, d) => c + clamp((v - a) / (b - a)) * (d - c);
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
/**
 * One frame of a decode effect: `text` with every character from index `solved` on replaced by
 * a random one of `glyphs` (characters listed in `keep` stay, so the shape of the text holds).
 */
function garble(text, solved, glyphs, keep = ' ') {
  let out = text.slice(0, solved);
  for (let i = solved; i < text.length; i++) out += keep.includes(text[i]) ? text[i] : pick(glyphs);
  return out;
}
const TAU = Math.PI * 2;
/** Shortest signed angular difference b - a, in (-PI, PI]. */
const angleDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d <= -Math.PI) d += TAU; return d; };
const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

// ── DOM helpers ────────────────────────────────────────────────────────────
const qs = (sel, el = doc) => el.querySelector(sel);
const qsa = (sel, el = doc) => Array.from(el.querySelectorAll(sel));

/** Read a CSS custom property from :root (trimmed string). */
const cssVar = (name, el = root) => getComputedStyle(el).getPropertyValue(name).trim();

/**
 * Create a <canvas> sized to its parent (or the viewport) with a capped device pixel ratio.
 * Returns { canvas, ctx, w, h, dpr, resize() }. `w`/`h` are CSS pixels; the 2D context is
 * pre-scaled so you draw in CSS pixels. Pass { context: 'webgl' } to get a raw GL context
 * (no scaling; use canvas.width/height for the viewport).
 */
function createCanvas(parent, { className = '', maxDpr = 2, context = '2d', contextAttributes, fill = 'viewport' } = {}) {
  const canvas = doc.createElement('canvas');
  if (className) canvas.className = className;
  canvas.setAttribute('aria-hidden', 'true');
  parent.appendChild(canvas);
  const ctx = canvas.getContext(context, contextAttributes) || (context === 'webgl' ? canvas.getContext('experimental-webgl', contextAttributes) : null);
  const out = { canvas, ctx, w: 0, h: 0, dpr: 1, resize };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = fill === 'viewport' ? window.innerWidth : parent.clientWidth;
    const h = fill === 'viewport' ? window.innerHeight : parent.clientHeight;
    out.w = w; out.h = h; out.dpr = dpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (ctx && context === '2d') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  return out;
}

/**
 * IntersectionObserver sugar. cb(entry.isIntersecting, entry). Returns a disconnect function.
 * { once: true } stops observing after the first time the element enters.
 */
function inView(el, cb, { rootMargin = '0px 0px -12% 0px', threshold = 0, once = false } = {}) {
  if (!('IntersectionObserver' in window)) { cb(true, null); return () => {}; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      cb(e.isIntersecting, e);
      if (once && e.isIntersecting) io.unobserve(e.target);
    }
  }, { rootMargin, threshold });
  (Array.isArray(el) ? el : [el]).forEach((n) => io.observe(n));
  return () => io.disconnect();
}

// ── environment ────────────────────────────────────────────────────────────
const coarse = mq('(pointer: coarse)').matches;
const saveData = !!(navigator.connection && navigator.connection.saveData);
// Hardware hints are just that: Safari and Firefox expose no deviceMemory, and Brave randomises
// both numbers on every site. A desktop is therefore only called low-power when BOTH say so; on
// touch devices either one is enough. Modules use the flag to scale budgets (particles, stars,
// canvas resolution) — never for correctness.
const cores = navigator.hardwareConcurrency || 8;
const memory = navigator.deviceMemory || 8;
const env = {
  reducedMotion: mq('(prefers-reduced-motion: reduce)').matches,
  coarse,                                            // primary input is touch
  fine: mq('(hover: hover) and (pointer: fine)').matches, // real mouse/trackpad
  touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  saveData,
  lowPower: saveData || (cores <= 2 && memory <= 2) || (coarse && (cores <= 4 || memory <= 2)),
  /** The --base prefix the site was built with ("" at the root of a domain, "/sub" otherwise). */
  base: new URL('../..', import.meta.url).pathname.replace(/\/$/, ''),
};

function storedFx() {
  try { const v = localStorage.getItem(FX_KEY); return v === null ? null : v === '1'; } catch { return null; }
}

// ── event bus ──────────────────────────────────────────────────────────────
const listeners = new Map();
function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}
function emit(name, detail) {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(detail); } catch (err) { console.error(`[core] listener for "${name}" failed`, err); }
  }
}

// ── state ──────────────────────────────────────────────────────────────────
const viewport = { w: window.innerWidth, h: window.innerHeight };
const pointer = {
  x: viewport.w / 2, y: viewport.h * 0.6,   // client coordinates (CSS px)
  nx: 0, ny: 0,                              // normalised −1..1 from viewport centre
  vx: 0, vy: 0, speed: 0,                    // px/s, smoothed
  active: false,                             // true once the user has moved a pointer
  inside: true,                              // pointer currently inside the window
  down: false,
  type: 'mouse',                             // 'mouse' | 'touch' | 'pen'
  lastMove: 0,                               // seconds (core.time.now) of the last movement
  target: null,                              // element under the pointer (event target)
};
const scroll = { y: window.scrollY || 0, max: 1, progress: 0, velocity: 0, direction: 1 };
// Written by fx/rocket.js every frame; other modules may read it (e.g. sky uses it as a light).
const rocket = { x: viewport.w / 2, y: viewport.h + 80, vx: 0, vy: 0, angle: -Math.PI / 2, speed: 0, boost: 0, visible: false, locked: null };
// `idle`: nobody has moved a pointer, scrolled, typed or resized for IDLE_AFTER seconds. Ambient
// effects (the sky, the hovering rocket) then draw every other frame, which halves what an
// untouched page costs; the first input brings the full rate back.
const time = { now: 0, dt: 0.016, frame: 0, idle: false };
const fx = { enabled: true };

// ── ticker ─────────────────────────────────────────────────────────────────
let tickers = [];
let rafId = 0;
let last = 0;
let px = pointer.x, py = pointer.y;
let lastInput = 0;              // time.now of the latest input

/** Any input ends the idle state at once (not at the next frame: handlers may read it). */
function wake() { lastInput = time.now; time.idle = false; }

/**
 * Register a per-frame callback fn(dt, now) — dt/now in seconds, dt clamped to 1–50 ms.
 * Callbacks run only while the tab is visible AND effects are enabled, unless { always: true }.
 * Lower `order` runs first (state/physics < 0, drawing ≥ 0). Returns an unsubscribe function.
 * Safe to call (and to unsubscribe) from inside a callback: the list is never mutated in place.
 */
function tick(fn, { order = 0, always = false } = {}) {
  const entry = { fn, order, always };
  tickers = [...tickers, entry].sort((a, b) => a.order - b.order);
  start();
  return () => { tickers = tickers.filter((t) => t !== entry); };
}

/** Something has per-frame work to do right now. */
const wanted = () => (fx.enabled ? tickers.length > 0 : tickers.some((t) => t.always));

function frame(ms) {
  // With effects off and no { always } callback the loop stops altogether; setFx() restarts it.
  if (!wanted()) { rafId = 0; return; }
  rafId = requestAnimationFrame(frame);
  const now = ms / 1000;
  // Two frames can share a timestamp (dt = 0): clamp so velocities derived from 1/dt stay finite.
  const dt = Math.min(0.05, Math.max(0.001, last ? now - last : 0.016));
  last = now;
  time.now = now; time.dt = dt; time.frame++;
  time.idle = now - lastInput > IDLE_AFTER;

  // derived pointer velocity (smoothed)
  const ivx = (pointer.x - px) / dt, ivy = (pointer.y - py) / dt;
  px = pointer.x; py = pointer.y;
  pointer.vx = damp(pointer.vx, ivx, 12, dt);
  pointer.vy = damp(pointer.vy, ivy, 12, dt);
  pointer.speed = Math.hypot(pointer.vx, pointer.vy);
  // scroll velocity decays between scroll events
  scroll.velocity = damp(scroll.velocity, 0, 6, dt);

  const run = tickers; // a snapshot: callbacks may subscribe / unsubscribe while it is walked
  for (let i = 0; i < run.length; i++) {
    const t = run[i];
    if ((!fx.enabled && !t.always) || (run !== tickers && !tickers.includes(t))) continue;
    try { t.fn(dt, now); } catch (err) {
      console.error('[core] ticker failed and was removed', err);
      tickers = tickers.filter((entry) => entry !== t);
    }
  }
}
function start() {
  if (rafId || doc.hidden || !wanted()) return;
  last = 0;
  lastInput = performance.now() / 1000;   // back from a hidden tab or from effects off: not idle
  time.idle = false;
  px = pointer.x; py = pointer.y; // no velocity spike from whatever moved while the loop was idle
  rafId = requestAnimationFrame(frame);
}
function stop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

// ── input wiring (the only global listeners on the site) ───────────────────
function setPointer(e) {
  pointer.x = e.clientX; pointer.y = e.clientY;
  pointer.nx = (e.clientX / viewport.w) * 2 - 1;
  pointer.ny = (e.clientY / viewport.h) * 2 - 1;
  pointer.type = e.pointerType || 'mouse';
  pointer.active = true; pointer.inside = true;
  pointer.lastMove = time.now;
  pointer.target = e.target;
  wake();
}
window.addEventListener('pointermove', (e) => { setPointer(e); emit('pointermove', pointer); }, { passive: true });
window.addEventListener('pointerdown', (e) => { setPointer(e); pointer.down = true; emit('pointerdown', pointer); }, { passive: true });
window.addEventListener('pointerup', (e) => { pointer.down = false; emit('pointerup', pointer); }, { passive: true });
window.addEventListener('pointercancel', () => { pointer.down = false; emit('pointerup', pointer); }, { passive: true });
// Leaving / re-entering the window. On the root element: Safari fires neither event on `document`.
root.addEventListener('pointerleave', () => { pointer.inside = false; emit('pointerleave', pointer); });
root.addEventListener('pointerenter', () => { pointer.inside = true; emit('pointerenter', pointer); });
window.addEventListener('keydown', wake, { passive: true });

let lastScrollY = scroll.y, lastScrollT = performance.now();
/** Scroll events only read window.scrollY: the page height (a layout read) is measured apart. */
function readScroll() {
  const y = window.scrollY || root.scrollTop || 0;
  const t = performance.now();
  const dtMs = Math.max(1, t - lastScrollT);
  const v = ((y - lastScrollY) / dtMs) * 1000;
  scroll.velocity = lerp(scroll.velocity, v, 0.5);
  if (y !== lastScrollY) { scroll.direction = y > lastScrollY ? 1 : -1; wake(); }
  lastScrollY = y; lastScrollT = t;
  scroll.y = y;
  scroll.progress = clamp(y / scroll.max);
}
/** The scrollable distance changes with the viewport and with the page height — not with scrolling. */
function measureScroll() {
  scroll.max = Math.max(1, root.scrollHeight - viewport.h);
  readScroll();
}
window.addEventListener('scroll', () => { readScroll(); emit('scroll', scroll); }, { passive: true });

let resizeRaf = 0;
function onResize() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    viewport.w = window.innerWidth; viewport.h = window.innerHeight;
    env.dpr = Math.min(window.devicePixelRatio || 1, 2);
    measureScroll();
    wake();
    emit('resize', viewport);
  });
}
window.addEventListener('resize', onResize, { passive: true });
window.addEventListener('orientationchange', onResize, { passive: true });
// content height changes (images, fonts, effects switching layouts) alter scroll.max
if ('ResizeObserver' in window) new ResizeObserver(measureScroll).observe(doc.body || root);

doc.addEventListener('visibilitychange', () => {
  if (doc.hidden) stop(); else start();
  emit('visibility', !doc.hidden);
});

// ── effects on/off ─────────────────────────────────────────────────────────
function applyFxClass() {
  root.classList.toggle('fx-on', fx.enabled);
  root.classList.toggle('fx-off', !fx.enabled);
}
/** Turn all effects on/off (persists the choice). Emits 'fx:change' with the new boolean. */
function setFx(enabled, { persist = true } = {}) {
  enabled = !!enabled;
  if (persist) { try { localStorage.setItem(FX_KEY, enabled ? '1' : '0'); } catch { /* private mode */ } }
  if (fx.enabled === enabled) { applyFxClass(); return; }
  fx.enabled = enabled;
  applyFxClass();
  emit('fx:change', enabled);
  start();
}

// ── fixed layers ───────────────────────────────────────────────────────────
function layer(id) {
  let el = doc.getElementById(id);
  if (!el) {
    el = doc.createElement('div');
    el.id = id;
    if (id !== 'fx-hud') el.setAttribute('aria-hidden', 'true'); // the HUD holds real controls
    if (id === 'fx-sky') doc.body.prepend(el); else doc.body.append(el);
  }
  return el;
}
const layers = {
  /** Fixed, behind the page (z-index: var(--z-sky)). The sky module mounts its canvas here. */
  get sky() { return layer('fx-sky'); },
  /** Fixed, above the page, pointer-events: none (z-index: var(--z-overlay)). Rocket, reticle, bursts. */
  get overlay() { return layer('fx-overlay'); },
  /** Fixed HUD container (z-index: var(--z-hud)), pointer-events: none; children opt back in. Not aria-hidden. */
  get hud() { return layer('fx-hud'); },
};

// ── boot ───────────────────────────────────────────────────────────────────
const stored = storedFx();
fx.enabled = stored === null ? !env.reducedMotion : stored;
root.classList.remove('no-js');
root.classList.add('js');
root.classList.toggle('pointer-fine', env.fine);
root.classList.toggle('pointer-coarse', !env.fine);
root.classList.toggle('reduced-motion', env.reducedMotion);
applyFxClass();
measureScroll();

/** What each started FX module's init() returned, by module name (filled by main.js; for debugging and tests). */
const modules = {};

export const core = {
  env, fx, viewport, pointer, scroll, rocket, time, layers, modules,
  on, emit, tick, setFx,
  toggleFx: () => setFx(!fx.enabled),
  utils: { clamp, lerp, damp, map, mapClamp, smoothstep, rand, randInt, pick, garble, angleDiff, TAU, ease, qs, qsa, cssVar, createCanvas, inView },
};

// Handy for debugging in the console and for the headless tests (tools/shot.mjs --steps eval).
window.__aurora = core;

export { clamp, lerp, damp, map, mapClamp, smoothstep, rand, randInt, pick, garble, angleDiff, TAU, ease, qs, qsa, cssVar, createCanvas, inView };
export default core;
