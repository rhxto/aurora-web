// @fx-order: 20
// Cursor rocket — the headline effect. A small Nemesis flies after the pointer on a full-viewport
// 2D canvas inside #fx-overlay, steering with a limited turn rate and thrust along its nose, and
// leaves flame, sparks and smoke that stay anchored to the page while it scrolls.
//
//   fine pointers   the native cursor is replaced by an exact DOM reticle (html.rocket-cursor);
//                   the rocket orbits the resting pointer, then throttles down and hovers in free
//                   space beside it (never on the text being read); it locks on to
//                   links/buttons/[data-lock] (HUD brackets + one lap, then it hovers beside the
//                   element) and lights its afterburner on click.
//   keyboard        the element that receives :focus-visible focus gets the same lock-on (once
//                   the browser has scrolled it into view, if it was outside).
//   touch           autopilot: it flies a figure-eight while the page scrolls, darts to a tap, and
//                   keeps station at rest — on a spot along the edge where it covers no text, no
//                   picture and no control, or below the screen when there is none.
//   bus             consumes 'burst' { x, y, power, color }, 'boost' { power 0–2, duration },
//                   'navigate:start' / 'navigate:cancel' and the launch show's 'launch:pad',
//                   'launch:liftoff', 'launch:end' (fx/egg.js); emits 'lock'; writes core.rocket.

import { core } from '../core.js';

const { clamp, lerp, damp, mapClamp, smoothstep, rand, angleDiff, TAU, cssVar, createCanvas } = core.utils;
const root = document.documentElement;

const LOCK_SELECTOR = 'a[href], button, [data-lock]';
// What the hovering rocket must not sit on: media and running text (plus anything lockable and
// any element with text of its own — see isFree()).
const BUSY_SELECTOR = 'img, picture, video, canvas, svg, input, textarea, select, label, h1, h2, h3, h4, p, dt, dd, blockquote, figcaption';
const CHROME_SELECTOR = '#fx-hud, [data-header]';
// The touch station is stricter about controls and pictures, and exact about text: blocks of
// copy are tested line by line (see isClear()).
const MEDIA_SELECTOR = 'img, picture, video, canvas, svg, input, textarea, select';
const COPY_SELECTOR = 'label, h1, h2, h3, h4, p, li, dt, dd, blockquote, figcaption';
// Elements that keep the native I-beam: the reticle steps aside so text can be placed precisely.
const TEXT_SELECTOR = 'textarea, [contenteditable]:not([contenteditable="false"]), input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="image"])';

/** Flight model, in CSS px and seconds. */
const FLIGHT = {
  maxSpeed: 2600,   // cruise ceiling; the afterburner raises thrust, not this
  minSpeed: 46,     // a rocket never stops in mid-air (hovering is a separate controller)
  accel: 9500,      // full thrust
  brake: 7500,      // air-brake — weaker than the arrival law asks for, hence the slight overshoot
  arrive: 8,        // desired speed = distance × arrive
  turnSlow: 19,     // rad/s at low speed; must exceed 2 × arrive or the rocket circles its goal forever
  turnFast: 8.5,    // rad/s at maxSpeed → wide, banked arcs
  gripSlow: 17,     // how fast sideslip bleeds off at low speed: tight, tidy orbits
  gripFast: 6,      // … and at maxSpeed: the rocket drifts wide through fast curves
  orbitRadius: 40,  // rest orbit around the pointer: keeps the rocket off the click point
  orbitSpeed: 80,
  restAfter: 2,     // seconds of pointer stillness before the orbit calms down into a hover
};

// Candidate hover stations around a resting pointer, as unit offsets tried at growing distances:
// below right first — where an arrow cursor's tail would be.
const REST_DIRS = [[0.7, 0.75], [0.85, -0.5], [-0.8, 0.65], [-0.8, -0.55], [1, 0.1], [-1, 0.1], [0, 1], [0, -1]];
const REST_REACH = [50, 100, 160];
// …and when the pointer rests deep inside a block of text: sideways sweeps (px from the pointer:
// first, last, step) along these rows (px below it) for the nearest gutter or column gap.
const REST_SWEEP = [200, 520, 40];
const REST_ROWS = [30, -40, 110];
const WATCH_S = 0.4;           // after a pointer move / scroll the locked box is re-measured for this long
const STATION_STEP = 64;       // touch station: rocket units between the candidate spots along a screen edge
const STATION_CHECK_S = 1;     // …and how often the spot in use is checked again (images load, menus open)
const PAD_LIFT = 96;           // the launch pad of the launch show: px above the bottom edge
const RELEASE_S = 0.35;        // launch show: ignition burns this long on the pad before the rocket lets go

const LOCK_PAD = 6;            // px between the element and its HUD brackets
const NOZZLE = 25;             // nozzle exit, in rocket units behind the centre (rocket = 48 units long)
const FLAME = 0, SPARK = 1, SMOKE = 2;
const FLAME_STEPS = 8;         // colour ramp resolution, white-hot → amber → coral → ember
const TRAIL_POINTS = 64;
const TRAIL_LIFE = 0.45;       // seconds the light streak behind the rocket lingers
const LETTERING_DASH = [0.5, 0.62];
const AIM_DASH = [2, 7];
const SOLID = [];

// ── colour helpers ─────────────────────────────────────────────────────────
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgba = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/** Brand colours from tokens.css (the --rgb-* triplets), plus the shades the canvas derives from them. */
function readPalette() {
  const token = (name, fallback) => {
    const c = cssVar(name).split(',').map(Number);
    return c.length === 3 && c.every(Number.isFinite) ? c : fallback;
  };
  const coral = token('--rgb-coral', [255, 81, 81]);
  const navy = token('--rgb-navy', [29, 44, 96]);
  const sky = token('--rgb-sky', [107, 150, 237]);
  const amber = token('--rgb-amber', [255, 178, 87]);
  return { coral, navy, sky, amber, hot: mix(amber, WHITE, 0.84), font: cssVar('--font-mono') || 'monospace' };
}

/** Soft round blob, pre-rendered once; particles are drawn as scaled copies of these. */
function blobSprite(color, peak) {
  const size = 64, r = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, rgba(color, peak));
  grad.addColorStop(0.3, rgba(color, peak * 0.55));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return canvas;
}

function createSprites(pal) {
  const flame = [];
  for (let i = 0; i < FLAME_STEPS; i++) {
    const t = i / (FLAME_STEPS - 1);
    const color = t < 0.3 ? mix(pal.hot, pal.amber, t / 0.3)
      : t < 0.7 ? mix(pal.amber, pal.coral, (t - 0.3) / 0.4)
        : mix(pal.coral, pal.navy, (t - 0.7) / 0.75);
    flame.push(blobSprite(color, 1));
  }
  return { flame, smoke: blobSprite(mix(pal.sky, WHITE, 0.5), 0.55), halo: blobSprite(pal.sky, 0.5) };
}

// ── particles ──────────────────────────────────────────────────────────────
/**
 * Fixed-size pool in struct-of-arrays form. Positions are in PAGE space, so the exhaust scrolls
 * with the content. When the pool is full the oldest slot is recycled (ring buffer): spawning
 * never searches and never allocates.
 */
function createParticles(cap, sprites, sparkColor) {
  const x = new Float32Array(cap), y = new Float32Array(cap);
  const vx = new Float32Array(cap), vy = new Float32Array(cap);
  const age = new Float32Array(cap), life = new Float32Array(cap);
  const size = new Float32Array(cap), seed = new Float32Array(cap);
  const kind = new Uint8Array(cap), tint = new Uint8Array(cap);
  const tints = [sparkColor];   // spark colours; index 0 is the default, the rest come from 'burst' events
  let head = 0;
  let alive = 0;
  let tintSlot = 0;

  function spawn(k, px, py, pvx, pvy, plife, psize, ptint = 0) {
    const i = head;
    head = (head + 1) % cap;
    kind[i] = k; x[i] = px; y[i] = py; vx[i] = pvx; vy[i] = pvy;
    age[i] = 0; life[i] = plife; size[i] = psize; tint[i] = ptint;
    seed[i] = Math.random() * TAU;
  }

  /** Slot for a custom spark colour: seven custom slots, reused in rotation. */
  function tintIndex(color) {
    if (!color) return 0;
    let i = tints.indexOf(color);
    if (i < 0) {
      tintSlot = 1 + (tintSlot % 7);
      i = tintSlot;
      tints[i] = color;
    }
    return i;
  }

  function update(dt, now) {
    const dragFlame = Math.exp(-3.4 * dt), dragSpark = Math.exp(-1.9 * dt), dragSmoke = Math.exp(-2.4 * dt);
    alive = 0;
    for (let i = 0; i < cap; i++) {
      if (age[i] >= life[i]) continue;
      age[i] += dt;
      if (age[i] >= life[i]) continue;
      alive++;
      const k = kind[i];
      if (k === SPARK) {
        vx[i] *= dragSpark; vy[i] = vy[i] * dragSpark + 320 * dt;       // sparks fall
      } else if (k === SMOKE) {
        // cheap curl: two out-of-phase sines of position and time make the trail meander
        const phase = seed[i] + now * 1.5;
        vx[i] = vx[i] * dragSmoke + Math.sin(y[i] * 0.034 + phase) * 52 * dt;
        vy[i] = vy[i] * dragSmoke + (Math.cos(x[i] * 0.029 + phase * 1.3) * 52 - 16) * dt;
      } else {
        vx[i] *= dragFlame; vy[i] *= dragFlame;
      }
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
    }
  }

  /** Smoke goes under everything with normal blending: faint enough to read text through. */
  function drawSmoke(ctx, top, bottom) {
    for (let i = 0; i < cap; i++) {
      if (kind[i] !== SMOKE || age[i] >= life[i] || y[i] < top || y[i] > bottom) continue;
      const t = age[i] / life[i];
      const r = size[i] * (1 + 2.6 * t);
      ctx.globalAlpha = 0.3 * (1 - t) * (1 - t) * Math.min(1, t * 10);
      ctx.drawImage(sprites.smoke, x[i] - r, y[i] - r, r * 2, r * 2);
    }
  }

  /** Flame blobs and spark streaks, additive (caller sets globalCompositeOperation = 'lighter'). */
  function drawFire(ctx, top, bottom) {
    for (let i = 0; i < cap; i++) {
      if (kind[i] !== FLAME || age[i] >= life[i] || y[i] < top || y[i] > bottom) continue;
      const t = age[i] / life[i];
      const r = size[i] * (0.75 + 0.9 * t);
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.drawImage(sprites.flame[Math.min(FLAME_STEPS - 1, (t * FLAME_STEPS) | 0)], x[i] - r, y[i] - r, r * 2, r * 2);
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < cap; i++) {
      if (kind[i] !== SPARK || age[i] >= life[i] || y[i] < top || y[i] > bottom) continue;
      const t = age[i] / life[i];
      ctx.globalAlpha = (1 - t) * (1 - t);
      ctx.lineWidth = size[i] * (1 - 0.6 * t);
      ctx.strokeStyle = tints[tint[i]];
      ctx.beginPath();
      ctx.moveTo(x[i], y[i]);
      ctx.lineTo(x[i] - vx[i] * 0.026, y[i] - vy[i] * 0.026);   // streak along the velocity
      ctx.stroke();
    }
  }

  return {
    spawn, tintIndex, update, drawSmoke, drawFire,
    clear() { life.fill(0); age.fill(0); alive = 0; },
    get alive() { return alive; },
  };
}

// ── the rocket itself ──────────────────────────────────────────────────────
/**
 * Vector artwork of the Nemesis in local units: 48 long, nose at +24 on the x axis, body radius 4.
 * Livery from public/img/rockets/nemesis.svg — coral ogive nose with the navy shoulder sweeping
 * into it, navy tube with the light payload band, black boat-tail and three coral-edged fins.
 * The fins are projected from a roll angle, so the rocket visibly spins about its axis.
 */
function createShipArt(ctx, pal, sprites) {
  const R = 4;
  const FIN_SPAN = 7.4;
  const hull = new Path2D(`M-23.6 -2.64L-19.6 -${R}H8C15 -${R} 20.5 -1.7 24 0C20.5 1.7 15 ${R} 8 ${R}H-19.6L-23.6 2.64Z`);
  const nose = new Path2D(`M7 -${R}H8C15 -${R} 20.5 -1.7 24 0C20.5 1.7 15 ${R} 8 ${R}H7Z`);
  const tip = new Path2D('M20.6 -1.62C22.1 -0.95 23.2 -0.42 24 0C23.2 0.42 22.1 0.95 20.6 1.62Z');
  const body = new Path2D(`M-19.6 -${R}H8.4Q12.8 -3.1 14.8 0Q12.8 3.1 8.4 ${R}H-19.6Z`);
  const band = new Path2D(`M-4.8 -${R}H1.2V${R}H-4.8Z`);
  const tail = new Path2D(`M-19.6 -${R}L-23.6 -2.64V2.64L-19.6 ${R}Z`);
  const nozzle = new Path2D('M-23.6 -1.9H-25.2V1.9H-23.6Z');
  const emblem = new Path2D('M16.3 -1.25L18.2 0L16.3 1.25');
  const plume = new Path2D('M0 -0.72C-0.1 -1.08 -0.36 -0.86 -1 0C-0.36 0.86 -0.1 1.08 0 0.72Z');   // unit teardrop

  // cylinder shading across the tube: dark rims, a highlight just above the centre line
  const tube = (color, shade, shine) => {
    const g = ctx.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, rgba(mix(color, BLACK, shade)));
    g.addColorStop(0.34, rgba(mix(color, WHITE, shine)));
    g.addColorStop(0.6, rgba(color));
    g.addColorStop(1, rgba(mix(color, BLACK, shade + 0.12)));
    return g;
  };
  // the plume is drawn as a unit shape under ctx.scale(), so one gradient serves every length
  const fade = (color, a0, a1) => {
    const g = ctx.createLinearGradient(0, 0, -1, 0);
    g.addColorStop(0, rgba(color, a0));
    g.addColorStop(0.5, rgba(color, a1));
    g.addColorStop(1, rgba(color, 0));
    return g;
  };
  const paint = {
    body: tube(pal.navy, 0.3, 0.3),
    nose: tube(pal.coral, 0.26, 0.3),
    band: tube(mix(WHITE, pal.coral, 0.1), 0.24, 1),
    tail: rgba(mix(pal.navy, BLACK, 0.78)),
    nozzle: rgba(mix(pal.navy, WHITE, 0.3)),
    finNear: rgba(mix(pal.navy, BLACK, 0.5)),
    finFar: rgba(mix(pal.navy, BLACK, 0.74)),
    edge: rgba(pal.coral),
    tip: rgba(mix(pal.coral, WHITE, 0.34), 0.9),
    ink: rgba(WHITE, 0.9),
    shine: rgba(WHITE, 0.34),
    plumeOuter: fade(pal.coral, 0.62, 0.3),
    plumeMid: fade(pal.amber, 0.92, 0.5),
    plumeCore: fade(pal.hot, 1, 0.6),
  };

  /** One of the three fins, `a` = its angle around the body axis (0 = pointing at the viewer). */
  function fin(a) {
    const side = Math.sin(a);
    const y0 = R * side, y1 = (R + FIN_SPAN) * side;
    ctx.beginPath();
    ctx.moveTo(-10.4, y0);
    ctx.lineTo(-18.4, y1);
    ctx.lineTo(-23.9, y1);
    ctx.lineTo(-21.4, y0);
    ctx.closePath();
    ctx.fillStyle = Math.cos(a) > 0 ? paint.finNear : paint.finFar;
    ctx.fill();
    ctx.stroke();
  }

  function fins(roll, front) {
    ctx.strokeStyle = paint.edge;
    ctx.lineWidth = 0.8;
    ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const a = roll + (i * TAU) / 3;
      if (Math.cos(a) > 0 === front) fin(a);
    }
  }

  function layer(length, width, fill) {
    ctx.save();
    ctx.scale(length, width);
    ctx.fillStyle = fill;
    ctx.fill(plume);
    ctx.restore();
  }

  /** Exhaust plume behind the nozzle. power: 0.2 idle … 1 full thrust … 3 afterburner. */
  function drawPlume(power, now, sway) {
    const flicker = 0.86 + 0.1 * Math.sin(now * 67) * Math.sin(now * 41 + 1.7) + (Math.random() - 0.5) * 0.14;
    const length = (8 + 27 * power) * flicker;
    const width = 2.3 + 1.3 * Math.min(1.6, power);
    ctx.save();
    ctx.translate(-NOZZLE, 0);
    ctx.rotate(sway);                       // the flame lags behind when the rocket turns
    // the body of the flame is painted normally, then the same shapes are added as light, so the
    // layers burn out to white where they overlap
    layer(length, width * 1.3, paint.plumeOuter);
    layer(length * 0.74, width, paint.plumeMid);
    ctx.globalCompositeOperation = 'lighter';
    const glow = 7 + 5 * power;
    ctx.globalAlpha = Math.min(0.75, 0.3 + 0.2 * power);
    ctx.drawImage(sprites.flame[2], -glow * 1.25, -glow, glow * 2, glow * 2);
    ctx.globalAlpha = 1;
    layer(length, width * 1.45, paint.plumeOuter);
    layer(length * 0.74, width, paint.plumeMid);
    layer(length * 0.44, width * 0.56, paint.plumeCore);
    if (power > 1.15) {
      // shock diamonds in the afterburner
      const k = Math.min(1, power - 1.15);
      for (let i = 1; i <= 3; i++) {
        const r = width * (1.1 - i * 0.2);
        ctx.globalAlpha = k * (1 - i * 0.24);
        ctx.drawImage(sprites.flame[0], -length * 0.17 * i - r, -r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }

  function drawHull(roll) {
    fins(roll, false);
    ctx.fillStyle = paint.nose; ctx.fill(nose);
    ctx.fillStyle = paint.tip; ctx.fill(tip);
    ctx.fillStyle = paint.body; ctx.fill(body);
    ctx.fillStyle = paint.band; ctx.fill(band);
    ctx.fillStyle = paint.tail; ctx.fill(tail);
    ctx.fillStyle = paint.nozzle; ctx.fill(nozzle);
    // markings: the white emblem on the nose and a dotted hint of the NEMESIS lettering
    ctx.strokeStyle = paint.ink;
    ctx.lineWidth = 0.62;
    ctx.lineCap = 'butt';
    ctx.stroke(emblem);
    ctx.setLineDash(LETTERING_DASH);
    ctx.beginPath(); ctx.moveTo(2.6, 0); ctx.lineTo(9.2, 0); ctx.stroke();
    ctx.setLineDash(SOLID);
    // specular streak along the tube
    ctx.strokeStyle = paint.shine;
    ctx.lineWidth = 0.7;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-18.5, -1.7); ctx.lineTo(13.5, -1.7); ctx.stroke();
    // coral hairline around the silhouette (as in the team's drawing): keeps navy readable on black
    ctx.strokeStyle = paint.edge;
    ctx.lineWidth = 0.66;
    ctx.stroke(hull);
    fins(roll, true);
  }

  /** Draws at the current transform (caller has translated / rotated / scaled to the rocket). */
  return function drawShip(roll, power, now, sway) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22;
    ctx.drawImage(sprites.halo, -46, -46, 92, 92);   // soft blue halo: lifts it off dark backgrounds
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawPlume(power, now, sway);
    drawHull(roll);
  };
}

// ── module ─────────────────────────────────────────────────────────────────
export default function init() {
  const overlay = core.layers.overlay;
  const lite = core.env.coarse || core.env.lowPower;
  const stage = createCanvas(overlay, { className: 'rocket-canvas', maxDpr: core.env.lowPower ? 1.5 : 2 });
  const ctx = stage.ctx;
  if (!ctx) { stage.canvas.remove(); return undefined; }

  const pal = readPalette();
  const sprites = createSprites(pal);
  const cap = lite ? 250 : 700;                   // particle budget
  const particles = createParticles(cap, sprites, rgba(mix(pal.amber, WHITE, 0.45)));
  const drawShipArt = createShipArt(ctx, pal, sprites);
  const density = lite ? 0.5 : 1;                 // exhaust emission scale
  const coralInk = rgba(pal.coral);
  const amberInk = rgba(pal.amber);
  const hotInk = rgba(pal.hot);
  const plateInk = cssVar('--c-void') || '#000';
  const skyInk = rgba(pal.sky);
  const tagFont = `500 9px ${pal.font}`;

  // exact, lag-free pointer: a DOM dot + ring moved straight from the pointer event
  const reticle = document.createElement('div');
  reticle.className = 'rocket-reticle';
  reticle.innerHTML = '<i class="rocket-reticle__ring"></i><i class="rocket-reticle__dot"></i>';
  overlay.appendChild(reticle);

  // ── state ────────────────────────────────────────────────────────────────
  const ship = { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, turn: 0, roll: 0, thrust: 0, boost: 0 };
  const goal = { x: 0, y: 0, speed: 0, d: 1 };    // scratch output of orbit()
  const lock = {
    el: null,
    x: 0, y: 0, w: 0, h: 0,                        // padded box, client px (cached)
    cx: 0, cy: 0, a: 1, b: 1, lapSpeed: 0,         // the ellipse the rocket laps
    huge: false,                                   // too big to lap: keep orbiting the pointer
    theta: null, lap: 0, since: 0,                 // lap progress
    spot: null,                                    // { dx, dy } hover station relative to the centre, once the lap is done
    watchUntil: 0,                                 // re-measure the box every frame until then
  };
  const hud = { x: 0, y: 0, w: 0, h: 0, alpha: 0, flash: 0, tag: 0 };
  const rings = Array.from({ length: 8 }, () => ({ x: 0, y: 0, age: 1, life: 1, from: 0, to: 0, color: coralInk }));
  const trail = { x: new Float32Array(TRAIL_POINTS), y: new Float32Array(TRAIL_POINTS), t: new Float64Array(TRAIL_POINTS), k: new Float32Array(TRAIL_POINTS), head: 0 };

  let scale = 1;               // rocket size factor (smaller on phones)
  let throttle = 0;            // 0..1 engine command of the current frame
  let orbitDir = 1;            // sense of rotation around the current orbit centre
  let autoPhase = rand(TAU);   // position on the autopilot figure-eight
  let launchT = 0;             // seconds left of the straight-up launch burn
  let departUntil = 0;         // 'navigate:start': climb out until this time
  let parked = false;          // off-screen and idle
  let away = null;             // { x, y } exit point after the pointer left the window
  let dart = null;             // touch tap: { x, pageY, arrived, until }
  let tap = null;              // touch tap candidate: { x, y, t, fireAt }
  let boostTimer = 0, boostPower = 1;
  let hoverNode = null;        // element currently under the pointer
  let overText = false;
  let reticleOn = false;
  let scrolled = false;
  let lastScrollY = core.scroll.y;
  let nozzleX = 0, nozzleY = 0;                   // previous nozzle position (page space) for gap-free emission
  let flameDebt = 0, sparkDebt = 0, smokeDebt = 0, ringSlot = 0;
  let painted = false;
  let ringsLive = false;
  let aim = 0;                 // opacity of the dotted flight-path line (long chases only)
  let calm = 0;                // 0..1 — 1 while it hovers idle: the engine throttles down, the exhaust thins out
  let mode = '';               // flight mode of the current frame (see pickMode)
  let restSpot = null;         // { dx, dy } hover station relative to the resting pointer
  let restStale = false;       // the page moved under the station: pick again once the scroll has settled
  let focusLock = null;        // element that holds keyboard focus: locked, or about to be once it has scrolled into view
                               // (the pointer takes over when it moves)
  let cruiseUntil = 0;         // touch autopilot: fly the figure-eight until then, keep station afterwards
  let station = null;          // touch autopilot: { x, y } (client px) where the rocket waits while the page is at rest
  let stationCheckAt = 0;      // …and when that spot is validated next
  let show = null;             // launch show (fx/egg.js): { phase: 'pad' | 'ascent', t }

  // the HUD status bar (fx/hud) is docked to the bottom edge: stations stay above it
  const barH = parseFloat(cssVar('--hud-bar-h')) || 0;
  const headerH = parseFloat(cssVar('--header-h')) || 0;

  const piloted = () => core.pointer.active && core.pointer.type !== 'touch';

  function fitScale() {
    scale = !core.env.coarse ? 1 : core.viewport.w < 640 ? 0.74 : 0.86;
  }

  // ── cursor & reticle ─────────────────────────────────────────────────────
  function syncCursor() {
    const on = core.fx.enabled && piloted();
    reticleOn = on && core.pointer.inside && !overText;
    // the native cursor is only ever hidden for a real mouse, with effects on
    root.classList.toggle('rocket-cursor', on && core.env.fine);
    reticle.classList.toggle('is-visible', reticleOn);
    reticle.classList.toggle('is-locked', !!lock.el);
  }

  function lockableFrom(node) {
    if (!(node instanceof Element)) return null;
    const el = node.closest(LOCK_SELECTOR);
    if (!el || el.closest('[data-no-lock]')) return null;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
    return el;
  }

  /** The pointer is over `node` now: update the I-beam exception and the lock target. */
  function retarget(node) {
    if (node === hoverNode) return;
    hoverNode = node;
    overText = node instanceof Element && !!node.closest(TEXT_SELECTOR);
    if (!focusLock) setLock(lockableFrom(node));
    syncCursor();
  }

  /** Effects are (back) on, or the page came back: pick up the pointer and the focus where they are. */
  function reacquire() {
    const p = core.pointer;
    hoverNode = null;
    if (piloted() && p.inside) {
      reticle.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
      retarget(document.elementFromPoint(p.x, p.y));
    }
    lockFocus(document.activeElement);
    syncCursor();
  }

  // ── lock-on ──────────────────────────────────────────────────────────────
  function setLock(el) {
    if (el === lock.el) return;
    const was = lock.el;
    lock.el = el;
    // Nothing to bracket (hidden, or outside the viewport). A focused element stays in focusLock:
    // the browser is about to scroll it into view, and trackLock() tries again as the page moves.
    if (el && !measureLock(false)) lock.el = null;
    if (lock.el === was) return;
    if (lock.el) {
      lock.theta = null; lock.lap = 0; lock.spot = null;
      lock.since = core.time.now;
      lock.watchUntil = core.time.now + WATCH_S;
      if (hud.alpha < 0.05) {
        // brackets start as a small box around the pointer and snap out to the element
        // (keyboard focus: they close in on the element from just outside it)
        if (el === focusLock) { hud.x = lock.x - 12; hud.y = lock.y - 12; hud.w = lock.w + 24; hud.h = lock.h + 24; }
        else { hud.x = core.pointer.x - 9; hud.y = core.pointer.y - 9; hud.w = hud.h = 18; }
      }
      hud.flash = 1;
      hud.tag = 0;
    }
    core.rocket.locked = lock.el;
    core.emit('lock', lock.el ? { el: lock.el } : null);
  }

  /** Give up a lock whose element is gone, hidden or out of the viewport. */
  function dropLock() {
    hoverNode = null;
    focusLock = null;
    setLock(null);
    syncCursor();
  }

  // ── keyboard focus ───────────────────────────────────────────────────────
  function focusVisible(el) {
    try { return el.matches(':focus-visible'); } catch { return false; }   // selector unsupported: no keyboard lock
  }

  /** Lock on to `el` if it holds keyboard focus (same brackets a hovered element gets). */
  function lockFocus(el) {
    if (!core.fx.enabled || show || !(el instanceof Element) || !focusVisible(el)) return;
    const target = lockableFrom(el);
    if (!target) return;
    focusLock = target;
    setLock(target);
    syncCursor();
  }

  function onFocusIn(e) { lockFocus(e.target); }

  function onFocusOut() {
    if (!focusLock) return;
    focusLock = null;
    // back to whatever the pointer is over (nothing, for a keyboard-only visitor)
    setLock(piloted() && core.pointer.inside ? lockableFrom(hoverNode) : null);
    syncCursor();
  }

  /**
   * Cache the locked element's box (the only layout read; see trackLock for when it runs).
   * `follow`: the element was already locked, so move the brackets rigidly by however much it
   * moved (scroll, magnetic pull) instead of letting them ease after it.
   */
  function measureLock(follow) {
    const p = core.pointer;
    const ox = lock.x, oy = lock.y, ow = lock.w, oh = lock.h;
    let r = lock.el.getBoundingClientRect();
    const lines = lock.el === focusLock ? [] : lock.el.getClientRects();
    if (lines.length > 1) {
      // an inline link wrapped over several lines: bracket the line under the pointer
      for (const q of lines) {
        if (p.x >= q.left - 2 && p.x <= q.right + 2 && p.y >= q.top - 2 && p.y <= q.bottom + 2) { r = q; break; }
      }
    }
    const { w, h } = core.viewport;
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) return false;
    // clamp to the viewport so the brackets of a very large target stay on screen
    const x0 = Math.max(4, r.left - LOCK_PAD), y0 = Math.max(4, r.top - LOCK_PAD);
    const x1 = Math.min(w - 4, r.right + LOCK_PAD), y1 = Math.min(h - 4, r.bottom + LOCK_PAD);
    lock.x = x0; lock.y = y0; lock.w = Math.max(8, x1 - x0); lock.h = Math.max(8, y1 - y0);
    lock.cx = x0 + lock.w / 2; lock.cy = y0 + lock.h / 2;
    lock.a = lock.w * 0.56 + 24 * scale; lock.b = lock.h * 0.56 + 24 * scale;
    lock.huge = lock.a > w * 0.3 || lock.b > h * 0.3;
    const lapLength = TAU * Math.sqrt((lock.a * lock.a + lock.b * lock.b) / 2);
    lock.lapSpeed = clamp(lapLength / 1.1, 300, 1300);
    if (follow) { hud.x += lock.x - ox; hud.y += lock.y - oy; hud.w += lock.w - ow; hud.h += lock.h - oh; }
    return true;
  }

  /**
   * Keeps the lock honest without constant layout reads. After a scroll the element under a
   * resting pointer may have changed: one hit test (trackLock, in the physics pass). And for a
   * short while after any pointer move / scroll / resize the cached box is re-measured, because
   * targets move too (magnetic buttons, hover transitions): followLock runs in the drawing pass,
   * after tilt.js has moved a magnetic target for this frame, so the brackets never trail it —
   * and it keeps watching for as long as the box is still moving.
   */
  function trackLock() {
    if (!scrolled) return;
    scrolled = false;
    restStale = true;
    if (focusLock && !lock.el) setLock(focusLock);   // focused while outside the viewport: is it in view yet?
    if (piloted() && core.pointer.inside) retarget(document.elementFromPoint(core.pointer.x, core.pointer.y));
  }

  function followLock(now) {
    if (!lock.el || now >= lock.watchUntil) return;
    const { x, y, w, h } = lock;
    if (!(lock.el.isConnected && measureLock(true))) { dropLock(); return; }
    const moved = Math.abs(lock.x - x) + Math.abs(lock.y - y) + Math.abs(lock.w - w) + Math.abs(lock.h - h);
    if (moved > 0.05) lock.watchUntil = Math.max(lock.watchUntil, now + 0.25);
  }

  // ── free space ───────────────────────────────────────────────────────────
  /** True when nothing worth reading or clicking is painted at this client point. */
  function isFree(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || lockableFrom(el) || el.closest(BUSY_SELECTOR) || el.closest(CHROME_SELECTOR)) return false;
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.data.trim()) return false;
    return true;
  }

  /** Room for the hovering rocket (nose up) at this point: its nose, its body and its flame are clear. */
  function roomAt(x, y) {
    const { w, h } = core.viewport;
    if (x < 24 || x > w - 24 || y < headerH + 30 || y > h - barH - 44) return false;
    return isFree(x, y - 20 * scale) && isFree(x, y) && isFree(x, y + 26 * scale);
  }

  /** Where to wait beside a resting pointer: the nearest free spot, so it never sits on what is being read. */
  function pickRestSpot() {
    const p = core.pointer;
    for (const reach of REST_REACH) {
      for (const [ux, uy] of REST_DIRS) {
        const dx = ux * reach * scale, dy = uy * reach * scale;
        if (roomAt(p.x + dx, p.y + dy)) return { dx, dy };
      }
    }
    for (let d = REST_SWEEP[0]; d <= REST_SWEEP[1]; d += REST_SWEEP[2]) {
      for (const dy of REST_ROWS) {
        if (roomAt(p.x + d, p.y + dy)) return { dx: d, dy };
        if (roomAt(p.x - d, p.y + dy)) return { dx: -d, dy };
      }
    }
    return { dx: 34 * scale, dy: 36 * scale };   // nowhere free: where an arrow cursor's tail would be
  }

  /**
   * Where to hover once the lap is done: beside, below or above the element — in free space if
   * there is any, else at least off the other controls. Every candidate is first pulled into the
   * band the rocket may hover in (inside the window, clear of the header and of the HUD bar), so
   * a control at the very edge — the switches in the HUD bar — gets a station above it, never one
   * off screen or on top of its neighbour.
   */
  function pickHoverSpot() {
    const { w, h } = core.viewport;
    const gap = 26 * scale;
    const dx = lock.w / 2 + gap, dy = lock.h / 2 + gap + 8 * scale;
    const spots = [[dx, 0], [-dx, 0], [0, dy], [0, -dy]].map(([ox, oy]) => ({
      dx: clamp(lock.cx + ox, 24, w - 24) - lock.cx,
      dy: clamp(lock.cy + oy, headerH + 30, h - barH - 44) - lock.cy,
    }));
    const free = (spot) => roomAt(lock.cx + spot.dx, lock.cy + spot.dy);
    const offControls = (spot) => {
      for (let k = -18; k <= 18; k += 18) {
        if (lockableFrom(document.elementFromPoint(lock.cx + spot.dx, lock.cy + spot.dy + k * scale))) return false;
      }
      return true;
    };
    const reach = (spot) => Math.abs(spot.dx) + Math.abs(spot.dy);
    // nowhere to go: the candidate that ends up furthest from the element covers the least of it
    return spots.find(free) || spots.find(offControls) || spots.reduce((a, b) => (reach(b) > reach(a) ? b : a));
  }

  // ── touch station ────────────────────────────────────────────────────────
  const inkRange = document.createRange();

  /** True when a line of the text inside `block` is painted within the box (client px). */
  function inkIn(block, left, top, right, bottom) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.data.trim()) continue;
      inkRange.selectNodeContents(walker.currentNode);
      for (const r of inkRange.getClientRects()) {
        if (r.width > 0 && r.right > left && r.left < right && r.bottom > top && r.top < bottom) return true;
      }
    }
    return false;
  }

  /**
   * Room for the waiting rocket at this point of a touch screen, where no pointer leads it away
   * again: its hull, fins and idle flame — and a few pixels around them — cover no control, no
   * picture and no text. Copy is tested line by line: a paragraph's box is as wide as its column,
   * its last words are not.
   */
  function isClear(x, y) {
    const left = x - 14 * scale, right = x + 14 * scale, top = y - 27 * scale, bottom = y + 34 * scale;
    const tested = new Set();
    for (let row = 0; row <= 3; row++) {
      for (let col = 0; col <= 2; col++) {
        const el = document.elementFromPoint(lerp(left, right, col / 2), lerp(top, bottom, row / 3));
        if (!el || el.closest(LOCK_SELECTOR) || el.closest(MEDIA_SELECTOR) || el.closest(CHROME_SELECTOR)) return false;
        if (tested.has(el)) continue;
        tested.add(el);
        if (inkIn(el.closest(COPY_SELECTOR) || el, left, top, right, bottom)) return false;
      }
    }
    return true;
  }

  /** The lowest clear spot along the right edge, else along the left one; with none, below the screen. */
  function pickStation() {
    const { w, h } = core.viewport;
    const inset = 34 * scale + 6;
    for (const x of [w - inset, inset]) {
      for (let y = h - barH - 62 * scale; y > headerH + 40 * scale; y -= STATION_STEP * scale) {
        if (isClear(x, y)) return { x, y };
      }
    }
    return { x: w - inset, y: h + 90 * scale };
  }

  /**
   * Touch autopilot, page at rest: check that the station still covers nothing (once the scroll
   * has settled, then every STATION_CHECK_S: content moves without a scroll too) and pick another
   * when it does — or when the rocket is waiting below the screen for a place to come free.
   */
  function watchStation(now) {
    if (now < stationCheckAt || Math.abs(core.scroll.velocity) > 60) return;
    stationCheckAt = now + STATION_CHECK_S;
    if (!station || station.y > core.viewport.h || !isClear(station.x, station.y)) station = pickStation();
  }

  // ── flight ───────────────────────────────────────────────────────────────
  /**
   * Fly toward (tx, ty), aiming for speed `want`: turn the nose at a limited rate, thrust along
   * it, and let the fins bleed off sideslip. The velocity vector lags the heading, so the rocket
   * drifts through curves and overshoots when it arrives hot.
   */
  function steer(tx, ty, want, dt) {
    const speed = Math.hypot(ship.vx, ship.vy);
    const err = angleDiff(ship.angle, Math.atan2(ty - ship.y, tx - ship.x));
    const turnMax = mapClamp(speed, 300, FLIGHT.maxSpeed, FLIGHT.turnSlow, FLIGHT.turnFast);
    const rate = clamp(err * 14, -turnMax, turnMax);
    ship.angle += rate * dt;
    ship.turn = damp(ship.turn, rate, 12, dt);

    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    let forward = ship.vx * c + ship.vy * s;
    const grip = mapClamp(speed, 300, FLIGHT.maxSpeed, FLIGHT.gripSlow, FLIGHT.gripFast);
    const slip = (ship.vy * c - ship.vx * s) * Math.exp(-grip * dt);
    // throttle back while the nose points away from the goal: turn first, then burn
    const facing = Math.max(0, Math.cos(err));
    const target = Math.max(FLIGHT.minSpeed, want * facing * facing);
    const push = clamp((target - forward) * 12, -FLIGHT.brake, FLIGHT.accel * (1 + ship.boost * 0.8));
    forward += push * dt;
    ship.vx = c * forward - s * slip;
    ship.vy = s * forward + c * slip;
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    throttle = clamp(push / FLIGHT.accel);
  }

  /**
   * Carrot on an ellipse (semi-axes a, b) around (cx, cy), written to `goal`. From far away the
   * carrot is the tangent point, so the rocket slides into the orbit instead of flying through
   * the centre; on the ellipse it leads the rocket along it at `cruise` px/s.
   * Returns the rocket's angular position (normalised frame) for lap counting.
   */
  function orbit(cx, cy, a, b, cruise) {
    const ux = (ship.x - cx) / a, uy = (ship.y - cy) / b;
    const d = Math.hypot(ux, uy) || 1e-3;
    const theta = Math.atan2(uy, ux);
    // keep circling the way the rocket already swings round the centre (with hysteresis)
    const swing = (ux * ship.vy / b - uy * ship.vx / a) / d;
    if (swing * orbitDir < -1.5) orbitDir = -orbitDir;
    // tangent point when outside the ellipse, plus a lead along it that grows as the rocket closes in
    const lead = Math.acos(Math.min(1, 1 / d)) + clamp(26 / Math.min(a, b), 0.25, 0.7) / Math.max(1, d * d);
    const at = theta + orbitDir * lead;
    goal.x = cx + a * Math.cos(at);
    goal.y = cy + b * Math.sin(at);
    goal.speed = Math.min(FLIGHT.maxSpeed, cruise + Math.max(0, d - 1) * Math.min(a, b) * FLIGHT.arrive);
    goal.d = d;
    return theta;
  }

  /** Station-keeping on the exhaust, nose up, like a hopper: a damped spring plus a lean into the motion. */
  function hover(hx, hy, dt, now) {
    hx += Math.sin(now * 1.3) * 2.5 * scale;
    hy += Math.sin(now * 2.1) * 3 * scale;
    const ax = clamp((hx - ship.x) * 70 - ship.vx * 15, -7000, 7000);
    const ay = clamp((hy - ship.y) * 70 - ship.vy * 15, -7000, 7000);
    ship.vx += ax * dt; ship.vy += ay * dt;
    ship.x += ship.vx * dt; ship.y += ship.vy * dt;
    const upright = -Math.PI / 2 + clamp(ship.vx * 0.0022, -0.6, 0.6) + Math.sin(now * 1.7) * 0.05;
    const rate = clamp(angleDiff(ship.angle, upright) * 9, -11, 11);
    ship.angle += rate * dt;
    ship.turn = damp(ship.turn, rate, 12, dt);
    throttle = clamp(0.1 - ay / 5000 + Math.abs(ax) / 9000);
  }

  /** The launch pad of the launch show: bottom centre — just below the edge on narrow screens, where the dialog needs the room. */
  const padY = () => (core.viewport.w < 640 ? core.viewport.h + 40 * scale : core.viewport.h - PAD_LIFT * scale);

  /** No pointer to follow (the page scrolls under a finger, or the mouse has not moved yet): a slow figure-eight, lower right. */
  function autopilot(dt) {
    const { w, h } = core.viewport;
    const sv = core.scroll.velocity;
    const phone = w < 640;
    autoPhase += dt * (0.24 + Math.min(1.4, Math.abs(sv) / 1500));
    const tx = w * (phone ? 0.74 : 0.84) + w * (phone ? 0.16 : 0.09) * Math.sin(autoPhase);
    // the page drags the carrot along while it scrolls, so the rocket banks into the scroll
    const ty = h * (phone ? 0.78 : 0.72) + h * (phone ? 0.1 : 0.16) * Math.sin(autoPhase * 2) - clamp(sv * 0.12, -h * 0.3, h * 0.3);
    const dist = Math.hypot(tx - ship.x, ty - ship.y);
    steer(tx, ty, clamp(50 + (dist - 30) * 3, 50, 1500), dt);
  }

  function offscreen(margin) {
    const { w, h } = core.viewport;
    return ship.x < -margin || ship.x > w + margin || ship.y < -margin || ship.y > h + margin;
  }

  function pickMode(now) {
    if (now < departUntil) return 'depart';
    if (show) return show.phase;
    if (launchT > 0) return 'launch';
    if (lock.el && !lock.huge) return lock.spot ? 'hover' : 'circle';
    if (dart) return 'dart';
    const p = core.pointer;
    if (!piloted()) return station && now > cruiseUntil ? 'station' : 'auto';
    if (!p.inside) return 'away';
    // a pointer left alone for a while (someone is reading): stop circling and hover beside it
    const still = !p.down && now - p.lastMove > FLIGHT.restAfter;
    return still && (mode === 'rest' || Math.hypot(p.x - ship.x, p.y - ship.y) < 120 * scale) ? 'rest' : 'pilot';
  }

  function fly(dt, now) {
    const p = core.pointer;
    const { w, h } = core.viewport;
    switch (mode) {
      case 'launch':
        launchT -= dt;
        steer(ship.x, -h, 1500, dt);
        break;
      case 'pilot': {
        // lead the pointer slightly; the orbit radius breathes so it never looks mechanical
        const r = FLIGHT.orbitRadius * scale * (1 + 0.12 * Math.sin(now * 0.7));
        orbit(p.x + clamp(p.vx * 0.05, -80, 80), p.y + clamp(p.vy * 0.05, -80, 80), r, r, FLIGHT.orbitSpeed * (1 + 3 * ship.boost));
        steer(goal.x, goal.y, goal.speed, dt);
        break;
      }
      case 'rest':
        if (!restSpot || (restStale && Math.abs(core.scroll.velocity) < 60)) { restSpot = pickRestSpot(); restStale = false; }
        hover(p.x + restSpot.dx, p.y + restSpot.dy, dt, now);
        break;
      case 'circle': {
        const theta = orbit(lock.cx, lock.cy, lock.a, lock.b, lock.lapSpeed);
        if (goal.d < 1.7) {
          if (lock.theta !== null) lock.lap += angleDiff(lock.theta, theta);
          lock.theta = theta;
        }
        steer(goal.x, goal.y, goal.speed, dt);
        // one full lap (or a time-out if the target keeps running away), then settle beside it
        if (Math.abs(lock.lap) >= TAU || now - lock.since > 3.2) lock.spot = pickHoverSpot();
        break;
      }
      case 'hover':
        hover(lock.cx + lock.spot.dx, lock.cy + lock.spot.dy, dt, now);
        break;
      case 'dart': {
        const ty = dart.pageY - core.scroll.y;
        orbit(dart.x, ty, 26 * scale, 26 * scale, dart.arrived ? 170 : 420);
        steer(goal.x, goal.y, goal.speed, dt);
        if (!dart.arrived && (goal.d < 1.9 || now > dart.until)) {
          dart.arrived = true;
          dart.until = now + 1.5;
          burst(dart.x, ty, 0.9);
        } else if (dart.arrived && now > dart.until) dart = null;
        break;
      }
      case 'auto':
        autopilot(dt);
        break;
      case 'station':
        hover(station.x, station.y, dt, now);
        break;
      case 'pad':
        // launch show, counting down: on the pad at the bottom centre, nose up
        hover(w / 2, padY(), dt, now);
        break;
      case 'ascent': {
        // launch show, liftoff: the engine burns on the pad for a moment, then the rocket lets go —
        // slow off the pad and accelerating all the way out of the top of the screen
        show.t += dt;
        const k = show.t - RELEASE_S;
        if (k < 0) {
          hover(w / 2, padY(), dt, now);
          throttle = 1;
        } else {
          steer(w / 2, -h, 160 + 2600 * k * k, dt);
          parked = ship.y < -90 * scale;
        }
        break;
      }
      case 'away':
        steer(away.x, away.y, 1100, dt);
        parked = offscreen(70 * scale);
        break;
      default: // 'depart': punch straight up and out
        steer(ship.x, -h * 2, 3600, dt);
        parked = ship.y < -80 * scale;
    }
  }

  // ── exhaust, bursts, rings ───────────────────────────────────────────────
  /**
   * Spawn `count` exhaust particles of one kind. Each leaves the nozzle at a random moment of the
   * frame: it starts somewhere on the stretch the nozzle travelled and has already flown for the
   * rest of the frame — so the stream is continuous at any speed and frame rate, never one clump
   * per frame. `carry` = share of the rocket's velocity it inherits, `fan` = half-angle (rad).
   */
  function emit(kind, count, dt, nx, ny, carry, jetMin, jetMax, fan, lifeMin, lifeMax, sizeMin, sizeMax) {
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    for (let i = 0; i < count; i++) {
      const f = (i + Math.random()) / count;
      const jet = rand(jetMin, jetMax), off = rand(-fan, fan);
      const pvx = ship.vx * carry - (c - s * off) * jet;
      const pvy = ship.vy * carry - (s + c * off) * jet;
      const flown = (1 - f) * dt;
      particles.spawn(kind, lerp(nozzleX, nx, f) + pvx * flown, lerp(nozzleY, ny, f) + pvy * flown, pvx, pvy,
        rand(lifeMin, lifeMax), rand(sizeMin, sizeMax) * scale);
    }
  }

  function exhaust(dt, power, idle) {
    const nx = ship.x - Math.cos(ship.angle) * NOZZLE * scale;
    const ny = ship.y - Math.sin(ship.angle) * NOZZLE * scale + core.scroll.y;
    // after a jump (relaunch, scroll jump) there is no stretch to fill in
    if (Math.hypot(nx - nozzleX, ny - nozzleY) > 240) { nozzleX = nx; nozzleY = ny; }
    const heat = Math.min(2, power);
    const speed = Math.hypot(ship.vx, ship.vy);

    // a fast rocket strings its flame out over a longer path: emit more so it stays a flame, not beads
    // (hovering idle, the flame thins out and the smoke all but stops: nothing drifts over the page)
    flameDebt += (60 + 150 * power) * (1 + speed / 900) * (1 - 0.6 * idle) * density * dt;
    sparkDebt += 40 * Math.max(0, power - 0.35) * density * dt;
    smokeDebt += (10 + 34 * Math.min(1.5, power)) * (1 - 0.94 * idle) * density * dt;
    let n = flameDebt | 0; flameDebt -= n;
    emit(FLAME, n, dt, nx, ny, 0.45, 100 + 50 * heat, 190 + 120 * heat, 0.22, 0.12 + 0.03 * heat, 0.3 + 0.08 * heat, 2.8 + 0.7 * heat, 4.8 + 1.2 * heat);
    n = sparkDebt | 0; sparkDebt -= n;
    emit(SPARK, n, dt, nx, ny, 0.3, 240, 620, 0.42, 0.22, 0.6, 0.8, 1.5);
    n = smokeDebt | 0; smokeDebt -= n;
    emit(SMOKE, n, dt, nx, ny, 0.1, 30, 90, 0.5, 0.7, 1.3, 4.5, 8);
    nozzleX = nx; nozzleY = ny;

    // light streak: one sample per frame, brighter the faster the rocket flies
    const head = (trail.head + 1) % TRAIL_POINTS;
    trail.head = head;
    trail.x[head] = nx; trail.y[head] = ny; trail.t[head] = core.time.now;
    trail.k[head] = smoothstep(90, 900, speed) * 0.8 + ship.boost * 0.2;
  }

  function ring(x, pageY, from, to, life, color) {
    const r = rings[ringSlot];
    ringSlot = (ringSlot + 1) % rings.length;
    r.x = x; r.y = pageY; r.age = 0; r.life = life; r.from = from; r.to = to; r.color = color;
  }

  /**
   * Spark burst + flash + shockwave at a client-space point. `color`: any canvas colour, or a
   * custom property name such as '--c-aurora'. From power 1.5 up it is a firework shell: most
   * sparks leave at the same speed (a sphere, not a splash), burn longer and droop as they fade.
   */
  function burst(x, y, power = 1, color) {
    if (!core.fx.enabled || !Number.isFinite(x + y)) return;
    const ink = typeof color !== 'string' ? '' : color.startsWith('--') ? cssVar(color) : color;
    const tint = particles.tintIndex(ink);
    const py = y + core.scroll.y;
    const force = Math.sqrt(clamp(power, 0.2, 4));
    const shell = power >= 1.5;
    const count = Math.round(clamp(26 * power, 8, shell ? 84 : 60) * (lite ? 0.5 : 1));
    for (let i = 0; i < count; i++) {
      const a = rand(TAU);
      const v = (shell && i % 4 ? rand(300, 400) : rand(140, 620)) * force;
      particles.spawn(SPARK, x, py, Math.cos(a) * v, Math.sin(a) * v - 60,
        shell ? rand(0.75, 1.35) : rand(0.3, 0.8), shell ? rand(1.5, 2.6) : rand(0.9, 1.9), tint);
    }
    for (let i = 0; i < 6; i++) {
      const a = rand(TAU), v = rand(30, 130) * force;
      particles.spawn(FLAME, x, py, Math.cos(a) * v, Math.sin(a) * v, rand(0.16, 0.34), rand(5, 9) * force);
    }
    particles.spawn(FLAME, x, py, 0, 0, 0.2, 22 * force);                    // flash
    if (power < 0.8) return;                                                 // small crackles: sparks only
    ring(x, py, 4, 46 * force, 0.5, ink || coralInk);
    if (!shell) ring(x, py, 2, 82 * force, 0.8, ink || amberInk);
  }

  // ── per-frame update (physics; runs before the drawing tickers) ──────────
  function update(dt, now) {
    if (!(dt > 0)) return;
    const p = core.pointer;
    const scrolledBy = core.scroll.y - lastScrollY;
    const scrollStep = clamp(scrolledBy, -240, 240);
    lastScrollY = core.scroll.y;
    // the streak lives in page space: a scroll jump (wheel notch without smooth scrolling, anchor
    // link, Home/End) would stretch it across the whole jump, so drop it instead
    if (Math.abs(scrolledBy) > 48) trail.t.fill(0);

    trackLock();
    if (Math.abs(core.scroll.velocity) > 250) cruiseUntil = now + 1.2;
    if (core.env.coarse && !piloted()) watchStation(now);
    if (tap && tap.fireAt && now >= tap.fireAt) {
      // a touch tap that did not turn into a scroll: dart there
      dart = { x: tap.x, pageY: tap.y + core.scroll.y, arrived: false, until: now + 1.1 };
      ring(tap.x, dart.pageY, 3, 30, 0.45, coralInk);
      boostTimer = 0.5; boostPower = 1;
      tap = null;
    }

    mode = pickMode(now);
    if (mode !== 'away' && mode !== 'depart' && mode !== 'ascent') parked = false;
    if (mode !== 'rest') restSpot = null;

    // afterburner: click / hold, 'boost' events, the climb-out, and scroll speed on autopilot
    boostTimer -= dt;
    let burn = mode === 'depart' ? 1 : mode === 'ascent' ? 2 : mode === 'pad' ? 0 : (p.down && p.type !== 'touch') || boostTimer > 0 ? boostPower : 0;
    if (mode === 'auto') burn = Math.max(burn, clamp(Math.abs(core.scroll.velocity) / 3000, 0, 0.8));
    ship.boost = damp(ship.boost, burn, burn > ship.boost ? 26 : 5, dt);

    throttle = 0;
    if (parked) {
      ship.vx = ship.vy = 0;
    } else {
      // the page drags the rocket a little as it scrolls (the hover spring pulls it straight back)
      ship.vy -= scrollStep * 3;
      fly(dt, now);
      ship.roll += (1.5 + ship.turn * 0.22 + ship.boost * 5) * dt;
      ship.angle = angleDiff(0, ship.angle);                    // keep the heading in (−π, π]
      if (!Number.isFinite(ship.x + ship.y + ship.vx + ship.vy + ship.angle)) launch();   // safety net
    }
    const speed = Math.hypot(ship.vx, ship.vy);
    // what the engine looks like it is doing: idle flicker, plus throttle, plus a share for sheer speed
    ship.thrust = damp(ship.thrust, parked ? 0 : clamp(0.2 + throttle * 0.6 + (speed / FLIGHT.maxSpeed) * 0.7), 10, dt);

    // idling (hovering with nothing to do): throttle down so the rocket sits lightly on the page
    const idling = (mode === 'rest' || mode === 'hover' || mode === 'station' || mode === 'pad') && burn === 0;
    calm = damp(calm, idling ? 1 : 0, idling ? 2 : 9, dt);

    const visible = !parked && !offscreen(70 * scale);
    if (visible) exhaust(dt, ship.thrust + ship.boost * 2, calm);
    particles.update(dt, now);
    ringsLive = false;
    for (const r of rings) { r.age += dt; if (r.age < r.life) ringsLive = true; }

    // HUD brackets ease from the pointer to the locked box (and back, fading, on release)
    const k = 1 - Math.exp(-(lock.el ? 22 : 16) * dt);
    hud.x = lerp(hud.x, lock.el ? lock.x : p.x - 9, k);
    hud.y = lerp(hud.y, lock.el ? lock.y : p.y - 9, k);
    hud.w = lerp(hud.w, lock.el ? lock.w : 18, k);
    hud.h = lerp(hud.h, lock.el ? lock.h : 18, k);
    hud.alpha = damp(hud.alpha, lock.el ? 1 : 0, lock.el ? 20 : 14, dt);
    hud.flash = damp(hud.flash, 0, 7, dt);
    hud.tag = lock.el ? Math.min(1, hud.tag + dt * 5) : 0;

    // dotted flight path to the pointer, only while there is a long way to go
    const far = mode === 'pilot' && visible ? smoothstep(260, 560, Math.hypot(p.x - ship.x, p.y - ship.y)) : 0;
    aim = damp(aim, far, far > aim ? 9 : 5, dt);

    const out = core.rocket;
    out.x = ship.x; out.y = ship.y; out.vx = ship.vx; out.vy = ship.vy;
    out.angle = ship.angle; out.speed = speed; out.boost = ship.boost;
    out.visible = visible; out.locked = lock.el;
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  /**
   * One layer of the light streak behind the rocket: a strip of quads along the flown path that
   * narrows and fades with age. Quads share their edges, so under additive blending the strip is
   * seamless however tight the curve.
   */
  function ribbon(now, life, thin, wide, alpha, ink) {
    const N = TRAIL_POINTS;
    ctx.fillStyle = ink;
    let i = trail.head;
    let ax = 0, ay = 0, bx = 0, by = 0, px = 0, py = 1;
    for (let n = 0; n < N - 1; n++) {
      const fresh = 1 - (now - trail.t[i]) / life;
      if (!trail.t[i] || fresh <= 0) break;
      const older = (i + N - 1) % N;
      const from = trail.t[older] ? older : i, to = n ? (i + 1) % N : i;
      const tx = trail.x[to] - trail.x[from], ty = trail.y[to] - trail.y[from];
      const len = Math.hypot(tx, ty);
      if (len > 0.01) { px = -ty / len; py = tx / len; }      // unit normal of the path here
      const half = (thin + (wide - thin) * fresh) * scale;
      const cx = trail.x[i] + px * half, cy = trail.y[i] + py * half;
      const dx = trail.x[i] - px * half, dy = trail.y[i] - py * half;
      if (n) {
        ctx.globalAlpha = alpha * fresh * trail.k[i];
        ctx.beginPath();
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(dx, dy); ctx.lineTo(cx, cy);
        ctx.fill();
      }
      ax = cx; ay = cy; bx = dx; by = dy;
      i = older;
    }
  }

  function drawRings() {
    for (const r of rings) {
      if (r.age >= r.life) continue;
      const t = r.age / r.life;
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      ctx.globalAlpha = (1 - t) * (1 - t) * 0.9;
      ctx.lineWidth = lerp(2.4, 0.4, t);
      ctx.strokeStyle = r.color;
      ctx.beginPath();
      ctx.arc(r.x, r.y, lerp(r.from, r.to, eased), 0, TAU);
      ctx.stroke();
    }
  }

  /** Predicted path: leaves along the nose and bends to the pointer (a quadratic is close enough). */
  function drawAim() {
    if (aim < 0.02) return;
    const p = core.pointer;
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    const reach = Math.hypot(p.x - ship.x, p.y - ship.y) * 0.5;
    ctx.globalAlpha = aim * 0.4;
    ctx.strokeStyle = skyInk;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.setLineDash(AIM_DASH);
    ctx.beginPath();
    ctx.moveTo(ship.x + c * 34 * scale, ship.y + s * 34 * scale);
    ctx.quadraticCurveTo(ship.x + c * reach, ship.y + s * reach, p.x, p.y);
    ctx.stroke();
    ctx.setLineDash(SOLID);
  }

  function corner(x, y, sx, sy, arm, r) {
    ctx.moveTo(x, y + sy * arm);
    ctx.lineTo(x, y + sy * r);
    ctx.quadraticCurveTo(x, y, x + sx * r, y);
    ctx.lineTo(x + sx * arm, y);
  }

  function drawHud(now) {
    if (hud.alpha < 0.01) return;
    const { x, y, w, h } = hud;
    const arm = clamp(Math.min(w, h) * 0.34, 4, 13), r = Math.min(3, arm * 0.5);
    ctx.beginPath();
    corner(x, y, 1, 1, arm, r);
    corner(x + w, y, -1, 1, arm, r);
    corner(x + w, y + h, -1, -1, arm, r);
    corner(x, y + h, 1, -1, arm, r);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = coralInk;
    ctx.globalAlpha = hud.alpha * 0.2;      // soft glow under the crisp stroke
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.globalAlpha = hud.alpha;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (hud.flash > 0.02) {                 // white-hot flash at the moment of lock
      ctx.globalAlpha = hud.flash * hud.alpha;
      ctx.strokeStyle = hotInk;
      ctx.stroke();
    }
    if (hud.tag > 0) {
      const ty = y > 22 ? y - 10 : y + h + 10;                  // above the box, or below it at the top edge
      // dark plate so the tag stays legible when it lands on a line of text
      ctx.globalAlpha = hud.alpha * hud.tag * 0.82;
      ctx.fillStyle = plateInk;
      ctx.fillRect(x - 2, ty - 6.5, 46, 13);
      ctx.globalAlpha = hud.alpha * hud.tag;
      ctx.fillStyle = coralInk;
      if (now % 0.9 < 0.6) ctx.fillRect(x + 2, ty - 2, 4, 4);     // blinking status light
      ctx.font = tagFont;
      ctx.letterSpacing = '0.18em';
      ctx.textBaseline = 'middle';
      ctx.fillText('LOCK', x + 10, ty);
    }
  }

  function draw(dt, now) {
    followLock(now);
    const blank = !core.rocket.visible && !particles.alive && !ringsLive && hud.alpha < 0.01;
    if (blank && !painted) return;
    // Hovering with nothing to do on a page nobody is touching: every other frame is enough.
    if (core.time.idle && calm > 0.98 && core.time.frame % 2) return;
    ctx.clearRect(0, 0, stage.w, stage.h);
    painted = !blank;
    if (blank) return;

    const top = core.scroll.y - 60, bottom = core.scroll.y + stage.h + 60;
    ctx.save();
    ctx.translate(0, -core.scroll.y);       // page space: the exhaust scrolls with the content
    particles.drawSmoke(ctx, top, bottom);
    ctx.globalCompositeOperation = 'lighter';
    ribbon(now, TRAIL_LIFE, 0.6, 6, 0.2, coralInk);          // wide glow
    ribbon(now, TRAIL_LIFE * 0.7, 0.2, 1.9, 0.75, amberInk);   // bright core
    ribbon(now, TRAIL_LIFE * 0.3, 0.1, 1.2, 0.9, hotInk);      // white-hot right behind the nozzle
    particles.drawFire(ctx, top, bottom);
    drawRings();
    ctx.restore();

    drawAim();
    if (core.rocket.visible) {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.angle);
      ctx.scale(scale, scale);
      drawShipArt(ship.roll, (ship.thrust + ship.boost * 2) * (1 - 0.4 * calm), now, clamp(-ship.turn * 0.02, -0.3, 0.3));
      ctx.restore();
    }
    drawHud(now);
    ctx.globalAlpha = 1;
  }

  // ── life cycle ───────────────────────────────────────────────────────────
  /** Lift off from below the bottom centre of the screen. */
  function launch() {
    const { w, h } = core.viewport;
    fitScale();
    ship.x = w / 2; ship.y = h + 34 * scale;
    ship.vx = 0; ship.vy = -500;
    ship.angle = -Math.PI / 2; ship.turn = 0; ship.thrust = 1; ship.boost = 1;
    launchT = 0.42; departUntil = 0; parked = false; dart = null; tap = null; restSpot = null; calm = 0;
    boostTimer = 0.6; boostPower = 1;
    lastScrollY = core.scroll.y;
    trail.t.fill(0);                                // no streak from wherever it was before
    nozzleX = ship.x; nozzleY = ship.y + NOZZLE * scale + core.scroll.y;
    if (!core.pointer.inside) setAway();
  }

  function setAway() {
    // leave through the edge closest to where the pointer went out
    const p = core.pointer, { w, h } = core.viewport;
    const out = 180;
    const nearest = Math.min(p.x, w - p.x, p.y, h - p.y);
    away = nearest === p.x ? { x: -out, y: p.y }
      : nearest === w - p.x ? { x: w + out, y: p.y }
        : nearest === p.y ? { x: p.x, y: -out }
          : { x: p.x, y: h + out };
  }

  function shutdown() {
    hoverNode = null;
    focusLock = null;
    show = null;
    overText = false;
    setLock(null);
    syncCursor();
    particles.clear();
    for (const r of rings) r.age = r.life;
    trail.t.fill(0);
    hud.alpha = 0;
    aim = 0;
    ctx.clearRect(0, 0, stage.w, stage.h);
    painted = false;
    core.rocket.visible = false;
    core.rocket.boost = 0;
  }

  const off = [
    core.on('pointermove', (p) => {
      if (!core.fx.enabled) return;
      if (p.type === 'touch') {
        if (tap && Math.hypot(p.x - tap.x, p.y - tap.y) > 12) tap = null;   // a drag, not a tap
        if (reticleOn) syncCursor();          // a finger took over from the mouse
        return;
      }
      reticle.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
      lock.watchUntil = core.time.now + WATCH_S;
      if (focusLock) { focusLock = null; hoverNode = null; }   // the pointer takes over from the keyboard
      if (p.target !== hoverNode) retarget(p.target);
      else if (!reticleOn) syncCursor();      // first mouse move, or back from touch
    }),
    core.on('pointerdown', (p) => {
      if (!core.fx.enabled) return;
      if (p.type === 'touch') { tap = { x: p.x, y: p.y, t: core.time.now, fireAt: 0 }; return; }
      reticle.classList.add('is-down');
      reticle.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
      boostTimer = 0.45; boostPower = 1;
      if (!parked) {
        // afterburner kick: an instant shove along the nose, and a heat ring off the nozzle
        const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
        ship.vx += c * 420; ship.vy += s * 420;
        ring(ship.x - c * NOZZLE * scale, ship.y - s * NOZZLE * scale + core.scroll.y, 3, 22, 0.35, amberInk);
      }
      burst(p.x, p.y, 1);
    }),
    core.on('pointerup', () => {
      reticle.classList.remove('is-down');
      // core also reports pointercancel as 'pointerup'; a scroll gesture is weeded out by waiting
      // a moment for the scroll event that would clear the candidate
      if (tap) { if (core.time.now - tap.t < 0.35) tap.fireAt = core.time.now + 0.09; else tap = null; }
    }),
    core.on('pointerleave', () => { setAway(); hoverNode = null; overText = false; if (!focusLock) setLock(null); syncCursor(); }),
    core.on('pointerenter', syncCursor),
    core.on('scroll', () => { scrolled = true; tap = null; stationCheckAt = 0; lock.watchUntil = core.time.now + WATCH_S; }),
    core.on('resize', () => { stage.resize(); fitScale(); painted = true; restStale = true; station = null; stationCheckAt = 0; lock.watchUntil = core.time.now + WATCH_S; }),
    core.on('burst', (d) => { if (d) burst(d.x, d.y, d.power, d.color); }),
    core.on('boost', (d) => {
      boostPower = clamp(d?.power ?? 1, 0, 2);
      boostTimer = d?.duration ?? 0.6;
    }),
    core.on('navigate:start', () => {
      // climb out; if the page is still here afterwards (cancelled, bfcache) the rocket flies back in
      departUntil = core.time.now + 2.6;
      hoverNode = null;
      focusLock = null;
      setLock(null);
      syncCursor();
    }),
    // the navigation did not happen, or the page came back from the back/forward cache
    core.on('navigate:cancel', () => { launch(); reacquire(); }),
    // launch show (fx/egg.js): wait on the pad during the count, lift off, come back when it is over
    core.on('launch:pad', () => {
      show = { phase: 'pad', t: 0 };
      hoverNode = null;
      focusLock = null;
      setLock(null);
      syncCursor();
    }),
    core.on('launch:liftoff', () => { if (show) { show.phase = 'ascent'; show.t = 0; } }),
    core.on('launch:end', () => {
      if (!show) return;
      const flown = show.phase === 'ascent';
      show = null;
      if (flown) launch();                    // back in from below, as on a page load
      reacquire();
    }),
    core.on('fx:change', (on) => { if (on) { launch(); reacquire(); } else shutdown(); }),
    core.tick(update, { order: -10 }),
    core.tick(draw, { order: 20 }),
  ];
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);

  launch();
  syncCursor();

  return {
    /** Live particle count and pool size (used by the dev harness to measure the worst case). */
    stats: () => ({ particles: particles.alive, cap }),
    /** Flight mode and the lock-on brackets as drawn in the last frame (headless tests). */
    debug: () => ({ mode, calm, parked, station, brackets: { x: hud.x, y: hud.y, w: hud.w, h: hud.h, alpha: hud.alpha }, pad: LOCK_PAD, focus: !!focusLock }),
    destroy() {
      off.forEach((fn) => fn());
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      shutdown();
      root.classList.remove('rocket-cursor');
      reticle.remove();
      stage.canvas.remove();
    },
  };
}
