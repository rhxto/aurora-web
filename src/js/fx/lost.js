// @fx-when: [data-fx="lost"]
// 404 — "LOST IN SPACE" (markup: templates/pages.mjs → notFound()).
//
// The three numerals and the derelict rocket ([data-lost-float] = depth) hang in zero-g: each
// drifts on its own slow Lissajous path and rocks about its centre, the rocket tumbles end over
// end, and the whole scene shifts against the pointer by depth (parallax). Touch screens get
// the drift alone. The "SIGNAL LOST" read-out (aria-hidden in the markup) re-scrambles every few
// seconds.
// With effects off the bodies rest in the composition lost.css gives them.

import { core } from '../core.js';
import { scramble } from './reveal.js';

const { damp, qs, qsa } = core.utils;
const root = document.documentElement;

const PARALLAX = 46;        // px a body of depth 1 moves when the pointer reaches the viewport edge
const DRIFT = 20;           // px amplitude of the idle drift at depth 1
const SIGNAL_EVERY = 3.4;   // seconds between two scrambles of the label

export default function init() {
  const stage = qs('[data-fx="lost"]');
  if (!stage) return null;

  const bodies = qsa('[data-lost-float]', stage).map((el, i) => {
    const depth = parseFloat(el.dataset.lostFloat) || 1;
    const tumbles = el.matches('svg');
    // The resting angle lost.css composed (--r on the numerals, a fixed tilt on the rocket).
    const rest = tumbles ? -24 : parseFloat(getComputedStyle(el).getPropertyValue('--r')) || 0;
    return {
      el, depth, rest, tumbles,
      phase: i * 1.7,
      rate: 0.16 + (i % 3) * 0.045,     // rad/s — every body keeps its own time
      x: 0, y: 0,                       // smoothed parallax offset
    };
  });
  const signal = qs('[data-lost-signal]', stage);
  let nextSignal = SIGNAL_EVERY;
  let t = 0;

  function frame(dt) {
    t += dt;
    const ptr = core.pointer;
    const follow = core.env.fine && ptr.active && ptr.inside;
    for (const b of bodies) {
      b.x = damp(b.x, follow ? -ptr.nx * PARALLAX * b.depth : 0, 3, dt);
      b.y = damp(b.y, follow ? -ptr.ny * PARALLAX * 0.7 * b.depth : 0, 3, dt);
      const a = t * b.rate + b.phase;
      const x = b.x + Math.sin(a) * DRIFT * b.depth;
      const y = b.y + Math.cos(a * 0.8) * DRIFT * 0.8 * b.depth;
      const angle = b.tumbles ? b.rest + ((t * 9) % 360) : b.rest + Math.sin(a * 0.9) * 7;
      b.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${angle.toFixed(2)}deg)`;
    }
    if (signal && (nextSignal -= dt) <= 0) {
      nextSignal = SIGNAL_EVERY;
      scramble(signal, { quick: true });
    }
  }

  const rest = () => { for (const b of bodies) { b.el.style.transform = ''; b.x = b.y = 0; } };

  root.classList.add('lost-ready');
  const disposers = [
    core.tick(frame),
    core.on('fx:change', (enabled) => { if (!enabled) rest(); }),
  ];

  return {
    destroy() {
      for (const dispose of disposers) dispose();
      rest();
      root.classList.remove('lost-ready');
    },
  };
}
