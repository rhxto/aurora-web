// @fx-when: [data-fx="partners"]
// Partners page — the launch stack (markup: templates/partials/partners.mjs).
//
//   spotlight    one light follows the pointer across the whole plate grid: every plate near it
//                shows a glowing stretch of border and a faint pool of light. Each of the two is
//                a gradient sheet inside a clipping frame (partners.css); the sheets are moved
//                and faded with their own transform / opacity, so a frame of the light restyles
//                two leaf nodes per plate and nothing else, and the frames of the plates out of
//                reach are not rendered at all. One ticker, cached boxes, no listener per plate.
//                Touch screens have no pointer to follow: the light sweeps slowly across the
//                middle of the viewport instead.
//   trajectory   each tier's line segment is drawn by the scroll (a fill moved with a transform)
//                and the tier markers light up — and decode their tag — as the line reaches them.
//                Reaching the last marker ("ALL STAGES GO") fires a 'burst' there and a 'boost'
//                for the cursor rocket: the stack is complete, the rocket is lifted.
//   plates       assemble as they enter (CSS, on the .is-inview class reveal.js sets); the name
//                in the caption decodes as it arrives and again on hover and focus.
//
// Adds html.partners-ready while it runs; every hidden or animated state in partners.css is
// scoped to it, so the static page stays intact if this file never loads.

import { core } from '../core.js';
import { scramble } from './reveal.js';

const { clamp, damp, smoothstep, qs, qsa, inView } = core.utils;
const root = document.documentElement;

const REACH = 300;          // px from a plate's edge at which the spotlight starts to show on it
const DRAW_AT = 0.6;        // the trajectory is drawn down to this fraction of the viewport height
const HEAD_PAD = 14;        // px the spark at the tip of the line travels beyond each end of a segment
const TOUCH_SWEEP = 0.45;   // rad/s of the unattended sweep on touch screens
const LAST_PIECE = 'partners-meta';   // keyframes of the piece that lands last (partners.css)

function layer(className) {
  const el = document.createElement('span');
  el.className = className;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** One light of a plate: a clipping frame, hidden until the plate is lit, and the sheet that moves inside it. */
function lamp(className) {
  const frame = layer(className);
  frame.hidden = true;
  frame.appendChild(document.createElement('span')).className = 'partners-sheet';
  return frame;
}

export default function init() {
  const stage = qs('[data-fx="partners"]');
  if (!stage) return null;

  // The pool of light lies on the plate, under the logo; sweep and ring go on top.
  const plates = qsa('.decal', stage).map((el) => {
    const lamps = [lamp('partners-glow'), lamp('partners-spot')];
    qs('.decal__face', el)?.prepend(lamps[0]);
    el.append(layer('partners-sweep'), lamps[1]);
    // sx / sy / k: what the sheets currently show — the light's position inside the plate and its strength.
    return { el, lamps, sheets: lamps.map((frame) => frame.firstChild), x: 0, y: 0, w: 0, h: 0, lit: false, sx: NaN, sy: NaN, k: NaN };
  });
  const segments = qsa('.tier__path', stage).map((el) => ({ fill: el.appendChild(layer('partners-fill')), top: 0, h: 1, p: -1 }));
  const markers = qsa('.tier, .tiers__end', stage).map((el) => ({
    el,
    tag: qs('.tier__tag-text', el),
    node: qs('.tier__node', el),
    last: el.matches('.tiers__end'),
    x: 0, y: 0,
    reached: false,
  }));
  const light = { x: 0, y: 0, gain: 0, primed: false };

  let measuredMax = -1;       // core.scroll.max at the last measurement; -1 forces one
  let onScreen = false;
  let reach = 0;              // page-space y the scroll has carried the trajectory to (never decreases)
  let draw = 0;               // … and where its tip is right now, easing toward `reach`

  /** Page-space boxes of everything the frame loop needs — the only layout reads of the module. */
  function measure() {
    measuredMax = core.scroll.max;
    const sy = core.scroll.y;
    for (const p of plates) {
      const r = p.el.getBoundingClientRect();
      p.x = r.left; p.y = r.top + sy; p.w = r.width; p.h = r.height;
    }
    for (const s of segments) {
      const r = s.fill.parentElement.getBoundingClientRect();
      s.top = r.top + sy; s.h = Math.max(1, r.height);
    }
    for (const m of markers) {
      const r = m.node.getBoundingClientRect();
      m.x = r.left + r.width / 2; m.y = r.top + sy;
    }
  }

  // ── trajectory ───────────────────────────────────────────────────────────
  function stepTrajectory(dt) {
    const { y, max } = core.scroll;
    const { h } = core.viewport;
    // Near the end of the page the draw line slides to the bottom edge, so the last segment
    // completes even when its end can never climb to DRAW_AT. What has been drawn stays drawn:
    // scrolling back up never erases the line.
    reach = Math.max(reach, y + h * (DRAW_AT + (1 - DRAW_AT) * smoothstep(max - h * 0.6, max, y)));
    draw = reach - draw > h * 1.5 ? reach : damp(draw, reach, 9, dt);
    for (const s of segments) {
      const p = Math.round(clamp((draw - s.top) / s.h) * 2000) / 2000;
      if (p === s.p) continue;
      s.p = p;
      // The spark at the tip starts just above the segment and ends just below it (both clipped).
      s.fill.style.transform = `translate3d(0, calc(${((p - 1) * 100).toFixed(2)}% + ${((p * 2 - 1) * HEAD_PAD).toFixed(1)}px), 0)`;
    }
    for (const m of markers) {
      if (m.reached || draw < m.y) continue;
      m.reached = true;
      m.el.classList.add('is-reached');
      if (m.tag) scramble(m.tag);
      const top = m.y - y;
      if (m.last && top > 0 && top < h) {   // the stack is complete: lift-off
        core.emit('burst', { x: m.x, y: top, power: 0.9, color: '--c-coral' });
        core.emit('boost', { power: 1.2, duration: 1.2 });
      }
    }
  }

  // ── spotlight ────────────────────────────────────────────────────────────
  function setLit(p, lit) {
    p.lit = lit;
    for (const frame of p.lamps) frame.hidden = !lit;
  }

  function stepSpotlight(dt, now) {
    const ptr = core.pointer;
    let tx, ty, on;
    if (core.env.fine) {
      tx = ptr.x; ty = ptr.y + core.scroll.y;
      on = ptr.active && ptr.inside;
    } else {
      tx = core.viewport.w * (0.5 + 0.42 * Math.sin(now * TOUCH_SWEEP));
      ty = core.scroll.y + core.viewport.h * (0.46 + 0.12 * Math.sin(now * TOUCH_SWEEP * 0.63));
      on = true;
    }
    if (!light.primed) { light.x = tx; light.y = ty; light.primed = true; }
    light.x = damp(light.x, tx, 14, dt);
    light.y = damp(light.y, ty, 14, dt);
    light.gain = damp(light.gain, on ? 1 : 0, 6, dt);

    for (const p of plates) {
      const dx = Math.max(p.x - light.x, 0, light.x - p.x - p.w);
      const dy = Math.max(p.y - light.y, 0, light.y - p.y - p.h);
      const k = light.gain * (1 - smoothstep(0, REACH, Math.hypot(dx, dy)));
      if (k < 0.01) {
        if (p.lit) setLit(p, false);
        continue;
      }
      if (!p.lit) setLit(p, true);
      // Half-pixel and 1 % steps: a light that has settled writes nothing.
      const sx = Math.round((light.x - p.x) * 2) / 2;
      const sy = Math.round((light.y - p.y) * 2) / 2;
      const strength = Math.round(k * 100) / 100;
      const moved = sx !== p.sx || sy !== p.sy;
      const faded = strength !== p.k;
      if (!moved && !faded) continue;
      p.sx = sx; p.sy = sy; p.k = strength;
      for (const sheet of p.sheets) {
        if (moved) sheet.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
        if (faded) sheet.style.opacity = strength;
      }
    }
  }

  function frame(dt, now) {
    if (!onScreen) return;
    if (measuredMax !== core.scroll.max) measure();   // resize, late images or fonts: the page grew
    stepTrajectory(dt);
    stepSpotlight(dt, now);
  }

  // ── plates ───────────────────────────────────────────────────────────────
  /** Decode the caption name of the plate `node` belongs to. */
  function decode(node, options) {
    const name = qs('.partner__name', node.closest('.partner'));
    if (name) scramble(name, options);
  }

  /** Entrances that will never get to play (seen with effects off) must not replay later. */
  const settleSeen = () => { for (const item of qsa('.tier__item.is-inview', stage)) item.classList.add('is-assembled'); };

  /** The caption is the last piece of a plate: its name decodes as it arrives, then the plate is done. */
  function onPiece(e) {
    if (e.animationName !== LAST_PIECE) return;
    if (e.type === 'animationstart') decode(e.target);
    else e.target.closest('.tier__item')?.classList.add('is-assembled');
  }
  function decodeName(e) {
    if (e.pointerType !== 'touch') decode(e.currentTarget, { quick: true });
  }
  const links = qsa('.partner', stage);
  for (const link of links) {
    link.addEventListener('pointerenter', decodeName);
    link.addEventListener('focus', decodeName);
  }
  stage.addEventListener('animationstart', onPiece);
  stage.addEventListener('animationend', onPiece);

  // ── effects on / off ─────────────────────────────────────────────────────
  function rest() {
    for (const p of plates) {
      setLit(p, false);
      p.sx = p.sy = p.k = NaN;
      for (const sheet of p.sheets) sheet.removeAttribute('style');
    }
    for (const s of segments) { s.p = -1; s.fill.style.transform = ''; }
    light.gain = 0; light.primed = false;
  }
  function onFxChange(enabled) {
    settleSeen();
    if (enabled) measuredMax = -1; else rest();
  }

  if (!core.fx.enabled) settleSeen();
  root.classList.add('partners-ready');

  const disposers = [
    core.tick(frame),
    core.on('fx:change', onFxChange),
    core.on('resize', () => { measuredMax = -1; }),
    inView(stage, (visible) => { onScreen = visible; }, { rootMargin: '25% 0px 25% 0px' }),
  ];

  return {
    destroy() {
      for (const dispose of disposers) dispose();
      stage.removeEventListener('animationstart', onPiece);
      stage.removeEventListener('animationend', onPiece);
      for (const link of links) {
        link.removeEventListener('pointerenter', decodeName);
        link.removeEventListener('focus', decodeName);
      }
      rest();
      for (const node of qsa('.partners-glow, .partners-sweep, .partners-spot, .partners-fill', stage)) node.remove();
      root.classList.remove('partners-ready');
    },
  };
}
