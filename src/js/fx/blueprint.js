// @fx-when: [data-fx="blueprint"]
// Blueprint explorer — the project page's rocket follows the reader (docs/ARCHITECTURE.md §3).
//
// The markup (templates/partials/blueprint.mjs) is a rocket picture with one real link per
// subsystem zone and a legend. This module adds:
//   · scroll sync   the section crossing the focus line becomes the active one: a bracket band
//                   glides along the rocket to span its zone, the rest of the rocket dims, a
//                   scan line sweeps the zone and a call-out names it ("02 / 05 RECOVERY")
//   · preview       hovering or focusing a zone (or a legend entry) moves the band there, in blue
//   · legend        aria-current on the active entry, a meter that fills as its section goes by
//   · plot          the drawing is wiped in from nose to tail the first time the sheet is seen
//
// Classes: .blueprint.is-live (module running), .has-zone, .is-preview, .is-plotting / .is-plotted,
// .is-visible; .is-active on the active legend link, hotspot and section (the page section also
// gets .is-past once read). Bus: emits 'blueprint:zone' { id, index } | null when the active
// section changes, and 'burst' at the pointer when a zone is clicked.
//
// Geometry is measured on load / resize / content resize only. Per frame the module reads
// core.scroll and writes a handful of transforms, nothing that repaints the picture — and only
// while something is moving. With effects off there is no frame work at all: the highlight snaps
// on scroll events instead.

import { core } from '../core.js';

const { clamp, damp, qs, qsa, inView } = core.utils;
const root = document.documentElement;

const FOCUS = 0.42;          // the section crossing this fraction of the viewport height is "active"…
const LANDED = 8;            // …or, in a short window, this many px below where an anchor jump parks a section
const GLIDE = 8.5;           // damping of the band (higher = snappier)
const SETTLED = 0.0004;      // fraction of the rocket length below which the band stops gliding
const SCAN_S = 2.4;          // seconds for one sweep of the scan line…
const SCAN_REST = 0.35;      // …plus this fraction of a sweep as a pause before the next one
const SCAN_TAIL = 26;        // px, length of the glow behind the scan line (blueprint.css)
const DECODE_S = 0.32;       // duration of the call-out's decode flicker
const PLOT_FAILSAFE_MS = 2400;
const CURTAIN_FAILSAFE_MS = 1600;
const GLYPHS = 'ABCDEFGHKLMNPRSTUVXYZ0123456789';
const IDLE = 'SELECT A SUBSYSTEM';

const pad2 = (n) => String(n).padStart(2, '0');

function make(className, parent, tag = 'span') {
  const node = document.createElement(tag);
  node.className = className;
  node.setAttribute('aria-hidden', 'true');
  parent.append(node);
  return node;
}

/** Run `fn` once the page-transition curtain (fx/transition.js) has started to lift. */
function afterCurtain(fn) {
  const cl = root.classList;
  const covered = () => cl.contains('is-entering') && !cl.contains('transition-live');
  if (!covered()) { fn(); return; }
  const done = () => { mo.disconnect(); clearTimeout(timer); fn(); };
  const mo = new MutationObserver(() => { if (!covered()) done(); });
  const timer = setTimeout(done, CURTAIN_FAILSAFE_MS);
  mo.observe(root, { attributes: true, attributeFilter: ['class'] });
}

export default function init() {
  const el = qs('[data-fx="blueprint"]');
  if (!el) return null;
  let zones;
  try { zones = JSON.parse(el.dataset.zones); } catch { return null; }
  const field = qs('.blueprint__field', el);
  const rocket = qs('.blueprint__rocket', el);
  const art = qs('.blueprint__art', el);
  const stateEl = qs('.blueprint__state', el);
  const sections = zones.map((z) => document.getElementById(z.id));
  const hots = zones.map((z) => qs(`.blueprint__hot[data-zone="${z.id}"]`, el));
  const links = zones.map((z) => qs(`.blueprint__link[data-zone="${z.id}"]`, el));
  if (!field || !rocket || !art || !zones.length || [...sections, ...hots, ...links].some((n) => !n)) return null;
  const meters = links.map((a) => ({ bar: qs('.blueprint__meter i', a), p: -1 }));
  const total = zones.length;

  // ── injected layers ──────────────────────────────────────────────────────
  // A second copy of the picture, shown only over the active zone, stays bright while the
  // original dims. It sits behind two nested clipping windows that render() moves with
  // transforms: gliding never repaints the picture (a clip-path on it would, every frame).
  const lit = make('blueprint__lit', rocket, 'div');
  const litInner = make('blueprint__lit-inner', lit, 'div');
  const litArt = make('blueprint__lit-art', litInner, 'div');
  for (const img of qsa('img', art)) {
    const copy = img.cloneNode(false);
    copy.alt = '';
    copy.loading = 'eager';
    litArt.append(copy);
  }
  const band = make('blueprint__band', rocket, 'div');
  const fill = make('blueprint__fill', band);
  const capA = make('blueprint__cap blueprint__cap--a', band);
  const capB = make('blueprint__cap blueprint__cap--b', band);
  const scan = make('blueprint__scan', band);
  make('blueprint__plot', rocket);
  const callout = make('blueprint__callout', rocket, 'div');
  const tag = make('blueprint__tag', callout);
  const readout = make('blueprint__readout', el, 'p');
  // The index and the name are shown twice: beside the rocket (sheet) and above it (strip).
  const idxEls = [make('blueprint__tag-idx', tag), make('blueprint__readout-idx', readout)];
  const nameEls = [make('blueprint__tag-name', tag), make('blueprint__readout-name', readout)];
  const writeName = (text) => { for (const n of nameEls) n.textContent = text; };

  // ── state ────────────────────────────────────────────────────────────────
  const s = {
    axis: 'x', len: 0,           // layout (see blueprint.css) and rocket length in px along it
    tops: [], end: 0,            // page-space top of every section, bottom of the last one
    land: 0,                     // px from the viewport top at which an anchor jump parks a section
    active: -1,                  // section being read
    hover: -1, hoverByKey: false, // zone under the pointer / keyboard focus
    target: -1,                  // zone the band is heading to (hover wins over active)
    a: 0, b: 1, ta: 0, tb: 1,    // band extent as fractions of the rocket (current / target)
    start: 0, stop: 0,           // the same in px along the layout axis, as last rendered
    visible: false, plotted: false, dirty: true,
    scanT: 0, lastY: -1,
    name: IDLE, decodeT: 1,
  };

  // ── drawing ──────────────────────────────────────────────────────────────
  function render() {
    const y = s.axis === 'y';
    const L = s.len;
    // Along x the nose points right, so the axis is mirrored: fraction 0 sits at the far end.
    const start = (y ? s.a : 1 - s.b) * L;
    const stop = (y ? s.b : 1 - s.a) * L;
    const move = (v) => (y ? `translate3d(0,${v.toFixed(2)}px,0)` : `translate3d(${v.toFixed(2)}px,0,0)`);
    const k = (Math.max(stop - start, 1) / Math.max(L, 1)).toFixed(4);
    capA.style.transform = move(start);
    capB.style.transform = move(stop);
    fill.style.transform = `${move(start)} scale${y ? 'Y' : 'X'}(${k})`;
    // Outer window: its leading edge sits at `start`. Inner window: its trailing edge sits at
    // `stop`. The picture is moved back by the sum (of the rounded values, so it stays exactly
    // over the original).
    const cut = Math.round(start * 100) / 100;
    const keep = Math.round((stop - L - start) * 100) / 100;
    lit.style.transform = move(cut);
    litInner.style.transform = move(keep);
    litArt.style.transform = move(-(cut + keep));
    if (y) callout.style.transform = move(clamp((start + stop) / 2, 18, L - 18));
    s.start = start; s.stop = stop; s.dirty = false;
  }

  /** One frame of the scan line: it leaves the nose end of the zone and fades out at the other. */
  function sweep(dt) {
    s.scanT = (s.scanT + dt / SCAN_S) % (1 + SCAN_REST);
    const p = Math.min(s.scanT, 1);
    const y = s.axis === 'y';
    const span = s.stop - s.start;
    const pos = y ? s.start + span * p : s.stop - span * p;
    const tail = clamp((span * p) / SCAN_TAIL, 0.04, 1).toFixed(3);
    scan.style.transform = y ? `translate3d(0,${pos.toFixed(1)}px,0) scaleY(${tail})` : `translate3d(${pos.toFixed(1)}px,0,0) scaleX(${tail})`;
    scan.style.opacity = Math.min(1, p * 8, (1 - p) * 6).toFixed(2);
  }

  function stepDecode(dt) {
    s.decodeT = Math.min(1, s.decodeT + dt / DECODE_S);
    const shown = Math.floor(s.decodeT * s.name.length);
    let noise = '';
    for (let i = shown; i < s.name.length; i++) noise += s.name[i] === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    writeName(s.name.slice(0, shown) + noise);
  }

  // ── which zone ───────────────────────────────────────────────────────────
  /** Point the band at the hovered zone, else at the active one; update every label. */
  function retarget() {
    const t = s.hover >= 0 ? s.hover : s.active;
    const shown = t >= 0 && s.plotted;
    const appeared = shown && !el.classList.contains('has-zone');
    el.classList.toggle('has-zone', shown);
    el.classList.toggle('is-preview', shown && t !== s.active);
    if (stateEl) stateEl.textContent = t < 0 ? IDLE : t === s.active ? 'TRACKING' : 'PREVIEW';
    if (t !== s.target) {
      s.target = t;
      const idx = t < 0 ? '' : `${pad2(t + 1)} / ${pad2(total)}`;
      for (const n of idxEls) n.textContent = idx;
      s.name = t < 0 ? IDLE : zones[t].label;
      s.decodeT = core.fx.enabled && t >= 0 ? 0 : 1;
      if (s.decodeT === 1) writeName(s.name);
    }
    if (t < 0) return;
    s.ta = zones[t].from; s.tb = zones[t].to;
    // Nothing to glide from when the band was hidden; nothing glides with effects off.
    if (appeared || !core.fx.enabled) { s.a = s.ta; s.b = s.tb; s.scanT = 0; render(); }
  }

  function setActive(i) {
    s.active = i;
    zones.forEach((z, k) => {
      const on = k === i;
      links[k].classList.toggle('is-active', on);
      links[k].classList.toggle('is-past', k < i);
      if (on) links[k].setAttribute('aria-current', 'true'); else links[k].removeAttribute('aria-current');
      hots[k].classList.toggle('is-active', on);
      sections[k].classList.toggle('is-active', on);
      sections[k].classList.toggle('is-past', k < i);
    });
    // A zone that only has the keyboard focus must not hold the band once the page moves on.
    if (s.hoverByKey) s.hover = -1;
    retarget();
    core.emit('blueprint:zone', i < 0 ? null : { id: zones[i].id, index: i });
  }

  /** Active section and legend meters from the scroll position (arithmetic only, no layout). */
  function locate() {
    // At the very end of the page the focus line drops to the bottom edge, so a last section
    // too short to reach the line still becomes the active one.
    const atEnd = core.scroll.y >= core.scroll.max - 2;
    // The line never sits above the spot an anchor jump parks a section at: in a short window
    // the section just jumped to (chip, hotspot, legend, #hash) must be the active one.
    const line = atEnd ? core.viewport.h : Math.max(core.viewport.h * FOCUS, s.land + LANDED);
    const focus = core.scroll.y + line;
    let active = -1;
    for (let k = 0; k < total; k++) {
      const from = s.tops[k];
      const to = k + 1 < total ? s.tops[k + 1] : s.end;
      if (focus >= from) active = k;
      const p = clamp((focus - from) / Math.max(1, to - from));
      const m = meters[k];
      if (m.bar && Math.abs(p - m.p) > 0.002) { m.p = p; m.bar.style.transform = `scaleX(${p.toFixed(3)})`; }
    }
    if (active !== s.active) setActive(active);
  }

  function preview(i, byKey = false) {
    if (s.hover === i) return;
    s.hover = i;
    s.hoverByKey = byKey && i >= 0;
    retarget();
  }

  // ── geometry ─────────────────────────────────────────────────────────────
  function measure() {
    s.axis = getComputedStyle(el).getPropertyValue('--blueprint-axis').trim() === 'y' ? 'y' : 'x';
    s.len = s.axis === 'y' ? rocket.offsetHeight : rocket.offsetWidth;
    const y = window.scrollY;
    s.tops = sections.map((sec) => sec.getBoundingClientRect().top + y);
    s.end = sections[total - 1].getBoundingClientRect().bottom + y;
    // Page scroll-padding (fixed header) + the section's scroll-margin (pinned strip).
    s.land = (parseFloat(getComputedStyle(root).scrollPaddingTop) || 0) + (parseFloat(getComputedStyle(sections[0]).scrollMarginTop) || 0);
    // Room for the annotations between the rocket and the edge of the sheet.
    if (s.axis === 'y') {
      const room = field.getBoundingClientRect().right - rocket.getBoundingClientRect().right;
      rocket.style.setProperty('--note-w', `${Math.max(96, Math.floor(room - 20))}px`);
    }
    s.dirty = true;
    s.lastY = core.scroll.y;
    locate();
    if (!core.fx.enabled) render();
  }

  // ── plot (first appearance) ──────────────────────────────────────────────
  function plotted() {
    if (s.plotted) return;
    s.plotted = true;
    el.classList.remove('is-plotting');
    el.classList.add('is-plotted');
    retarget();
  }
  function plot() {
    if (!core.fx.enabled) { plotted(); return; }
    afterCurtain(() => {
      el.classList.add('is-plotting');
      art.addEventListener('animationend', plotted, { once: true });
      setTimeout(plotted, PLOT_FAILSAFE_MS);
    });
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  const disposers = [];
  const listen = (node, type, fn) => { node.addEventListener(type, fn); disposers.push(() => node.removeEventListener(type, fn)); };

  zones.forEach((z, i) => {
    for (const node of [hots[i], links[i]]) {
      listen(node, 'pointerenter', (e) => { if (e.pointerType !== 'touch') preview(i); });
      listen(node, 'pointerleave', () => preview(-1));
      listen(node, 'focus', () => { if (node.matches(':focus-visible')) preview(i, true); });
      listen(node, 'blur', () => preview(-1));
    }
    // detail > 0: a real pointer click (keyboard activation has no position to burst from)
    listen(hots[i], 'click', (e) => { if (e.detail > 0) core.emit('burst', { x: e.clientX, y: e.clientY, power: 0.6 }); });
  });

  el.classList.add('is-live');
  writeName(s.name);
  measure();
  render();

  disposers.push(
    core.on('resize', measure),
    // Effects off: no frame loop — follow the page from scroll events and snap.
    core.on('scroll', () => { if (!core.fx.enabled) locate(); }),
    core.on('fx:change', (enabled) => {
      if (enabled) { s.dirty = true; return; }
      if (!s.plotted) plotted();
      s.a = s.ta; s.b = s.tb; s.decodeT = 1;
      writeName(s.name);
      scan.style.opacity = '0';
      locate();
      render();
    }),
    // The field is a real box in both layouts (the sheet is display: contents on the strip).
    inView(field, (visible) => { s.visible = visible; el.classList.toggle('is-visible', visible); }, { rootMargin: '0px' }),
    inView(field, (visible) => { if (visible) plot(); }, { rootMargin: '0px', threshold: 0.35, once: true }),
    core.tick((dt) => {
      if (core.scroll.y !== s.lastY) { s.lastY = core.scroll.y; locate(); }
      if (s.decodeT < 1) stepDecode(dt);
      if (!s.visible || s.target < 0 || !s.plotted) return;
      const a = Math.abs(s.ta - s.a) < SETTLED ? s.ta : damp(s.a, s.ta, GLIDE, dt);
      const b = Math.abs(s.tb - s.b) < SETTLED ? s.tb : damp(s.b, s.tb, GLIDE, dt);
      if (a !== s.a || b !== s.b || s.dirty) { s.a = a; s.b = b; render(); }
      sweep(dt);
    }),
  );
  // Late layout changes (fonts, images, the reader resizing text) move the sections: any of
  // them changes the height of the page.
  if ('ResizeObserver' in window) {
    let queued = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(queued); queued = requestAnimationFrame(measure); });
    ro.observe(document.body);
    ro.observe(rocket);
    disposers.push(() => { ro.disconnect(); cancelAnimationFrame(queued); });
  }

  return { destroy() { for (const off of disposers) off(); } };
}
