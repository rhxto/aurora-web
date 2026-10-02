// @fx-when: [data-tilt], [data-magnetic]
// Hover physics (docs/ARCHITECTURE.md §3 "Declarative hooks"):
//
//   [data-tilt]      3D tilt toward the pointer. Sets --rx / --ry (deg), --mx / --my (0–1 pointer
//                    position inside the element) and --tilt (0–1 intensity) plus .is-tilting.
//                    data-tilt-max="10"   maximum angle in degrees
//                    data-tilt-glare      injects .tilt__glare, a soft specular highlight
//                    data-tilt-holo       injects .tilt__holo, an iridescent sheen masked to the
//                                         first <img> inside (="hex": clipped to a hexagon instead)
//                    [data-tilt-depth="40"] on direct children: they float at that translateZ (px)
//   [data-magnetic]  the element is pulled toward a nearby pointer and springs back (value =
//                    strength, default 0.35); its label ([data-magnetic-label] or the first
//                    child) travels a little further.
//
// Both are fine-pointer effects. A ticker is registered only while something is hovered or still
// settling, so idle cards and buttons cost nothing per frame.

import { core } from '../core.js';

const { clamp, damp, qsa, inView, smoothstep } = core.utils;

const MEDIA = 'img, video, canvas, iframe, svg, picture';   // boxes that cannot host an injected layer
const TILT_VARS = ['--rx', '--ry', '--mx', '--my', '--tilt'];
const MAGNET_CAP = 14;            // px: the pull never moves an element further than this
const MAGNET_LABEL = 0.35;        // the label travels this much further than its button
const SPRING_K = 200;             // stiffness / damping of the magnetic spring (under-damped: a small overshoot)
const SPRING_C = 13;
const RECT_TTL_MS = 250;          // magnet boxes are re-read at most this often while the pointer moves

const tilts = new Map();          // element → tilt state
const magnets = new Map();        // element → magnet state
const tilting = new Set();        // tilt states that are hovered or settling back
const pulled = new Set();         // magnet states that are displaced or moving
const disposers = [];
let stopTilt = null;              // ticker unsubscribes; present only while the sets above are non-empty
let stopPull = null;
let rectsAt = -Infinity;          // performance.now() of the last magnet measurement
let ready = false;

// ── tilt ───────────────────────────────────────────────────────────────────

function layer(className) {
  const el = document.createElement('span');
  el.className = className;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function setupTilt(el) {
  const max = parseFloat(el.dataset.tiltMax);
  const s = {
    el,
    max: Number.isFinite(max) ? max : 10,
    layers: [],                    // injected glare / holo nodes
    holo: null, img: null,         // holo layer and the image it is masked to
    cx: 0, cy: 0, w: 1, h: 1,      // box centre (client px) and flat size
    hover: false, stale: true,
    mx: 0.5, my: 0.5, k: 0,        // smoothed pointer position inside the box, intensity
    enter: null, leave: null, unwatch: null,
  };
  tilts.set(el, s);

  if (!el.matches(MEDIA)) {
    if (el.hasAttribute('data-tilt-glare')) s.layers.push(el.appendChild(layer('tilt__glare')));
    if (el.hasAttribute('data-tilt-holo')) {
      const hex = el.dataset.tiltHolo === 'hex';
      s.holo = el.appendChild(layer(hex ? 'tilt__holo tilt__holo--hex' : 'tilt__holo'));
      s.layers.push(s.holo);
      s.img = hex ? null : el.querySelector('img');
      if (s.img) {
        // Mask the sheen with the artwork itself: nothing is painted outside its silhouette.
        const fit = getComputedStyle(s.img).objectFit;
        s.holo.style.setProperty('--holo-mask', `url("${s.img.currentSrc || s.img.src}")`);
        if (fit === 'contain' || fit === 'cover') s.holo.style.setProperty('--holo-fit', fit);
      }
    }
  }
  const floaters = qsa('[data-tilt-depth]', el);
  for (const child of floaters) child.style.setProperty('--tilt-depth', `${parseFloat(child.dataset.tiltDepth) || 0}px`);
  el.classList.toggle('tilt-3d', floaters.length > 0);

  if (core.env.fine) {
    s.enter = (e) => {
      if (e.pointerType === 'touch' || !core.fx.enabled) return;
      s.hover = true;
      s.stale = true;
      tilting.add(s);
      stopTilt ||= core.tick(stepTilt);
    };
    s.leave = () => { s.hover = false; };
    el.addEventListener('pointerenter', s.enter);
    el.addEventListener('pointerleave', s.leave);
  } else if (s.holo) {
    // No hover on touch screens: the patch sways gently by itself while it is on screen (tilt.css).
    s.unwatch = inView(el, (visible) => {
      if (visible) fitHolo(s, el.getBoundingClientRect());   // read before the sway transforms the box
      el.classList.toggle('is-floating', visible);
    }, { rootMargin: '0px' });
  }
}

/** Lay the holo layer exactly over the image it is masked to (percentages survive resizes). */
function fitHolo(s, box) {
  const { clientWidth: w, clientHeight: h, clientLeft, clientTop } = s.el;
  if (!s.img || !w || !h) return;
  const r = s.img.getBoundingClientRect();
  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  Object.assign(s.holo.style, {
    left: pct((r.left - box.left - clientLeft) / w),
    top: pct((r.top - box.top - clientTop) / h),
    width: pct(r.width / w),
    height: pct(r.height / h),
  });
}

function measureTilt(s) {
  const r = s.el.getBoundingClientRect();
  s.cx = r.left + r.width / 2;
  s.cy = r.top + r.height / 2;
  if (!s.el.classList.contains('is-tilting')) {   // still flat: the box has its true size
    s.w = r.width || 1;
    s.h = r.height || 1;
    if (s.holo) fitHolo(s, r);
    s.el.classList.add('is-tilting');
  }
  s.stale = false;
}

function stepTilt(dt) {
  const { x, y } = core.pointer;
  for (const s of tilting) {
    if (s.stale) measureTilt(s);
    const rate = s.hover ? 9 : 5;
    s.mx = damp(s.mx, s.hover ? clamp((x - s.cx) / s.w + 0.5) : 0.5, rate, dt);
    s.my = damp(s.my, s.hover ? clamp((y - s.cy) / s.h + 0.5) : 0.5, rate, dt);
    s.k = damp(s.k, s.hover ? 1 : 0, rate, dt);
    if (!s.hover && s.k < 0.004) { resetTilt(s); continue; }
    // The side under the pointer lifts toward the viewer. Angles derive from the smoothed
    // position, so the tilt and the highlight can never drift apart.
    const st = s.el.style;
    st.setProperty('--rx', `${((s.my - 0.5) * 2 * s.max).toFixed(2)}deg`);
    st.setProperty('--ry', `${((0.5 - s.mx) * 2 * s.max).toFixed(2)}deg`);
    st.setProperty('--mx', s.mx.toFixed(3));
    st.setProperty('--my', s.my.toFixed(3));
    st.setProperty('--tilt', s.k.toFixed(3));
  }
  if (!tilting.size) { stopTilt(); stopTilt = null; }
}

function resetTilt(s) {
  tilting.delete(s);
  s.hover = false;
  s.mx = s.my = 0.5;
  s.k = 0;
  s.el.classList.remove('is-tilting');
  for (const name of TILT_VARS) s.el.style.removeProperty(name);
}

function dropTilt(s) {
  resetTilt(s);
  s.unwatch?.();
  for (const node of s.layers) node.remove();
  s.el.classList.remove('tilt-3d', 'is-floating');
  if (s.enter) {
    s.el.removeEventListener('pointerenter', s.enter);
    s.el.removeEventListener('pointerleave', s.leave);
  }
  tilts.delete(s.el);
}

// ── magnetic ───────────────────────────────────────────────────────────────

function setupMagnet(el) {
  const strength = parseFloat(el.dataset.magnetic);
  const label = el.querySelector('[data-magnetic-label]') || el.firstElementChild;
  // `translate` does nothing on inline boxes: those (and only those) become inline-block (tilt.css).
  for (const node of [el, label]) if (node && getComputedStyle(node).display === 'inline') node.classList.add('tilt-magnetic-inline');
  magnets.set(el, {
    el, label,
    strength: Number.isFinite(strength) ? strength : 0.35,
    cx: 0, cy: 0, w: 0, h: 0,      // resting box (client px), without our own offset
    x: 0, y: 0, vx: 0, vy: 0,      // spring state
    tx: 0, ty: 0,                  // where the pointer is pulling it
  });
}

function measureMagnets() {
  for (const m of magnets.values()) {
    const r = m.el.getBoundingClientRect();
    m.w = r.width;
    m.h = r.height;
    m.cx = r.left + r.width / 2 - m.x;
    m.cy = r.top + r.height / 2 - m.y;
  }
  rectsAt = performance.now();
}

/**
 * Offset for a pointer `d` px from the centre of a box with half-size `half`: the classic
 * distance × strength for small elements, flattening toward the cap on large ones so that a wide
 * button glides instead of snapping from side to side.
 */
function pullOf(d, half, strength) {
  const a = Math.abs(d);
  return Math.sign(d) * Math.min(a * strength, MAGNET_CAP * Math.tanh((a / half) * (strength / 0.35)));
}

/** Recompute where every magnet is being pulled to; wakes the ticker when one starts to move. */
function aim() {
  if (!core.fx.enabled || !magnets.size) return;
  if (performance.now() - rectsAt > RECT_TTL_MS) measureMagnets();
  const { x, y, inside, type } = core.pointer;
  const present = inside && type !== 'touch';
  for (const m of magnets.values()) {
    m.tx = m.ty = 0;
    if (!present || !m.w) continue;
    const dx = x - m.cx;
    const dy = y - m.cy;
    // The field reaches a little beyond the box (≈1.4× its size); 0 = on the element, 1 = field edge.
    const reach = clamp(Math.max(m.w, m.h) * 0.2, 14, 40);
    const out = Math.max(Math.abs(dx) - m.w / 2, Math.abs(dy) - m.h / 2, 0) / reach;
    if (out >= 1) continue;
    const field = 1 - smoothstep(0, 1, out);
    m.tx = field * pullOf(dx, m.w / 2, m.strength);
    m.ty = field * pullOf(dy, m.h / 2, m.strength);
    pulled.add(m);
  }
  if (pulled.size) stopPull ||= core.tick(stepPull);
}

function stepPull(dt) {
  for (const m of pulled) {
    m.vx += ((m.tx - m.x) * SPRING_K - m.vx * SPRING_C) * dt;
    m.vy += ((m.ty - m.y) * SPRING_K - m.vy * SPRING_C) * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    const still = Math.abs(m.x) + Math.abs(m.y) < 0.05 && Math.abs(m.vx) + Math.abs(m.vy) < 1;
    if (still && !m.tx && !m.ty) { releaseMagnet(m); continue; }
    // `translate` (not `transform`) so the pull composes with whatever transform the button has.
    m.el.style.translate = `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px`;
    if (m.label) m.label.style.translate = `${(m.x * MAGNET_LABEL).toFixed(2)}px ${(m.y * MAGNET_LABEL).toFixed(2)}px`;
  }
  if (!pulled.size) { stopPull(); stopPull = null; }
}

function releaseMagnet(m) {
  pulled.delete(m);
  m.x = m.y = m.vx = m.vy = m.tx = m.ty = 0;
  m.el.style.translate = '';
  if (m.label) m.label.style.translate = '';
}

function dropMagnet(m) {
  releaseMagnet(m);
  for (const node of [m.el, m.label]) node?.classList.remove('tilt-magnetic-inline');
  magnets.delete(m.el);
}

// ── wiring ─────────────────────────────────────────────────────────────────

/** Everything back to its flat, resting state (effects turned off). */
function rest() {
  for (const s of Array.from(tilting)) resetTilt(s);
  for (const m of Array.from(pulled)) releaseMagnet(m);
  stopTilt?.();
  stopPull?.();
  stopTilt = stopPull = null;
}

/** Wire [data-tilt] / [data-magnetic] elements added after init and forget removed ones (idempotent). */
export function refresh() {
  if (!ready) return;
  for (const s of Array.from(tilts.values())) if (!s.el.isConnected) dropTilt(s);
  for (const m of Array.from(magnets.values())) if (!m.el.isConnected) dropMagnet(m);
  for (const el of qsa('[data-tilt]')) if (!tilts.has(el)) setupTilt(el);
  if (core.env.fine) for (const el of qsa('[data-magnetic]')) if (!magnets.has(el)) setupMagnet(el);
  rectsAt = -Infinity;
}

export default function init() {
  ready = true;
  refresh();
  disposers.push(
    core.on('pointermove', aim),
    core.on('pointerleave', aim),
    // Scrolling or resizing moves the boxes under a resting pointer.
    core.on('scroll', invalidate),
    core.on('resize', invalidate),
    core.on('fx:change', (enabled) => { if (!enabled) rest(); }),
  );

  function invalidate() {
    for (const s of tilting) s.stale = true;
    rectsAt = -Infinity;
    if (pulled.size) aim();
  }

  return {
    destroy() {
      rest();
      for (const s of Array.from(tilts.values())) dropTilt(s);
      for (const m of Array.from(magnets.values())) dropMagnet(m);
      for (const dispose of disposers.splice(0)) dispose();
      ready = false;
    },
  };
}
