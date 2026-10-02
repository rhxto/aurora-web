// @fx-when: [data-fx="projects"]
// Projects index — the roll-out (docs/ARCHITECTURE.md §3).
//
// The page lists the missions in rows joined by one stepped line (templates/projects.mjs,
// components/projects.css). Without this module the line is fully drawn and every rocket stands
// in its lane. With it:
//   · the line draws with the scroll: down the side into a row, then along the lane
//   · each rocket rolls in from off-screen, nose first, as its lane comes into view
//   · the row under the pointer gets a soft spotlight (a scan line crosses it on entry — CSS)
//
// Class: .fleet.is-live (module running). Geometry is measured on load / resize; per frame the
// module reads core.scroll / core.pointer and writes transforms only when a value changed.

import { core } from '../core.js';

const { clamp, damp, qs, qsa, ease } = core.utils;

const ENTER = 0.08;          // a lane starts drawing once its top is this far (× viewport height) above the fold
const SPAN = 0.5;            // …and its rocket has arrived after this much more scrolling
const MIN_SPAN = 0.25;       // shortest roll-out when the end of the page cuts the schedule short
const ROLL = 9;              // damping of the rockets (smooths wheel steps)
const CLEAR = 32;            // px beyond the viewport edge a waiting rocket is parked
const FETCH_AHEAD = 1;       // a rocket's picture is requested this many viewport heights before its row starts

export default function init() {
  const el = qs('[data-fx="projects"]');
  if (!el) return null;
  const rows = qsa('[data-fleet-row]', el).map((node) => ({
    el: node,
    lane: qs('[data-fleet-lane]', node),
    drop: qs('.fleet__drop', node),
    rail: qs('.fleet__rail', node),
    rocket: qs('.fleet__rocket', node),
    lazy: qs('.fleet__rocket img[loading="lazy"]', node),   // picture not requested yet (see frame())
    spot: qs('.fleet__spot', node),
    dir: node.classList.contains('fleet__row--rtl') ? -1 : 1,   // +1: rolls out to the right
    from: 0, start: 0, end: 0,   // scroll schedule (page-space y of the fold): side line, then lane + rocket
    travel: 0,                   // px from parked off-screen to at rest
    left: 0, top: 0,             // page-space origin of the row (for the spotlight)
    x: 0, drawn: -1, dropped: -1, // last written values
  })).filter((r) => r.lane && r.drop && r.rail && r.rocket);
  if (!rows.length) return null;

  let hovered = null;

  function measure() {
    const y = window.scrollY;
    const { w: vw, h: vh } = core.viewport;
    // The fold can never go below the end of the page: the last lane finishes before it.
    const pageEnd = document.documentElement.scrollHeight - 4;
    let done = el.getBoundingClientRect().top + y + ENTER * vh;
    for (const r of rows) {
      const laneTop = r.lane.getBoundingClientRect().top + y;
      r.from = done;
      r.end = Math.min(laneTop + (ENTER + SPAN) * vh, pageEnd);
      r.start = Math.min(laneTop + ENTER * vh, r.end - MIN_SPAN * vh);
      done = r.end;
      const box = r.el.getBoundingClientRect();
      r.left = box.left; r.top = box.top + y;
      const fig = r.rocket.getBoundingClientRect();
      const rest = fig.left - r.x;                       // where the rocket stands without our offset
      r.travel = (r.dir > 0 ? rest + fig.width : vw - rest) + CLEAR;
    }
  }

  const scale = (node, axis, v) => { node.style.transform = `scale${axis}(${v.toFixed(4)})`; };

  function frame(dt) {
    const fold = core.scroll.y + core.viewport.h;        // page-space y of the bottom of the viewport
    for (const r of rows) {
      // The pictures are lazy, and a rocket parked off-screen sideways does not count as near
      // the viewport (WebKit would only fetch it once it rolls in): ask for it ahead of its row.
      if (r.lazy && fold > r.from - FETCH_AHEAD * core.viewport.h) { r.lazy.loading = 'eager'; r.lazy = null; }
      const drop = clamp((fold - r.from) / Math.max(1, r.start - r.from));
      const draw = clamp((fold - r.start) / Math.max(1, r.end - r.start));
      if (drop !== r.dropped) { r.dropped = drop; scale(r.drop, 'Y', drop); }
      if (draw !== r.drawn) { r.drawn = draw; scale(r.rail, 'X', draw); }
      const target = -r.dir * (1 - ease.outCubic(draw)) * r.travel;
      // A rocket that is far off-screen jumps to its place; one in view glides.
      const x = Math.abs(target - r.x) < 0.2 || draw === 0 ? target : damp(r.x, target, ROLL, dt);
      if (x !== r.x) { r.x = x; r.rocket.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`; }
    }
    if (hovered) {
      const { x, y } = core.pointer;
      hovered.spot.style.transform = `translate3d(${(x - hovered.left).toFixed(1)}px,${(y - hovered.top + core.scroll.y).toFixed(1)}px,0)`;
    }
  }

  /** Effects off: back to the stylesheet's static state (line drawn, rockets at rest). */
  function rest() {
    for (const r of rows) {
      r.x = 0; r.drawn = -1; r.dropped = -1;
      r.rocket.style.transform = r.drop.style.transform = r.rail.style.transform = '';
    }
  }

  const disposers = [];
  if (core.env.fine) {
    for (const r of rows) {
      if (!r.spot) continue;
      const enter = (e) => { if (e.pointerType !== 'touch') hovered = r; };
      const leave = () => { if (hovered === r) hovered = null; };
      r.el.addEventListener('pointerenter', enter);
      r.el.addEventListener('pointerleave', leave);
      disposers.push(() => { r.el.removeEventListener('pointerenter', enter); r.el.removeEventListener('pointerleave', leave); });
    }
  }

  el.classList.add('is-live');
  measure();
  disposers.push(
    core.on('resize', measure),
    core.on('fx:change', (enabled) => { if (enabled) measure(); else rest(); }),
    core.tick(frame),
  );
  // Fonts and images settle after init and move the lanes: the page changes height.
  if ('ResizeObserver' in window) {
    let queued = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(queued); queued = requestAnimationFrame(measure); });
    ro.observe(document.body);
    disposers.push(() => { ro.disconnect(); cancelAnimationFrame(queued); });
  }

  return { destroy() { for (const off of disposers) off(); rest(); } };
}
