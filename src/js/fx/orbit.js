// @fx-when: [data-fx="orbit"]
// Orbital map of the departments (markup: src/templates/partials/orbit.mjs).
//
// The list of department links becomes a small planetary system: the Aurora mark is the core
// and every link is a satellite on one of three rings. The rings live in 3D (each on its own
// slightly different plane), are projected with a mild perspective and lean toward the pointer.
//
//   linework     one canvas under the links: orbits (far half dimmer), tick marks that turn
//                with their ring, satellite wakes, the core bezel, signal pulses travelling
//                between the core and the satellites, and the leader line
//   satellites   the real <a> elements of the list, moved with a transform only — they stay
//                keyboard-reachable in list order and readable by assistive tech
//   selection    hover / keyboard focus / tap: the system eases to a stop, the satellite's ring
//                lights up and a leader line runs to an info card (name, opening of the
//                overview, how to open it). Arrow keys step through the satellites.
//   touch        the first tap selects (the card then carries a link), a second tap opens;
//                where satellites overlap, the one whose centre is nearest to the finger wins
//   effects off  the same diagram, frozen: drawn once, selection still works
//
// The box of the map (stage height, the read-out under it, side / stack layout) is defined in
// src/css/components/orbit.css and reserved there before this module runs: going live must not
// change the height of the document.
//
// Per frame (only while on screen): nine transform/opacity writes and one canvas redraw; no
// layout reads — boxes are measured on resize and when the selection changes.

import { core } from '../core.js';

const { clamp, damp, TAU, qs, qsa, createCanvas, inView, cssVar, ease } = core.utils;

const DEG = Math.PI / 180;
const PERIODS = [72, 116, 168];            // seconds per revolution, inner ring → outer ring
const PLANES = [[9, 30], [-6, 140], [4, 250]]; // per ring: [inclination, direction of the line of nodes] in degrees
const FOCAL = 6;                           // camera distance in outer radii (mild perspective)
const LEAN = { pitch: 6, yaw: 11 };        // degrees the system leans toward the pointer
const SAMPLES = 96;                        // segments per orbit line
const TICK_DEG = 5;                        // spacing of the tick marks
const TICK_MAJOR = 6;                      // every 6th tick (30°) is longer
const WAKE = 0.58;                         // radians of wake behind a satellite at full speed
const WAKE_STEPS = 10;
const BEZEL = 0.2;                         // radius of the graduated ring around the core
const CORNER_FIT = 0.34;                   // side layout: the outer radius never exceeds this share of the stage width
const STACK_INCLINE = 50;                  // stacked stages see the system more face-on, so it fills their height …
const WIDE_STAGE = 2;                      // … unless they are this many times wider than tall (a phone held sideways)
const DEPLOY_S = 2.2;                      // intro: the rings expand from the core
const PULSES = 6;                          // pool of signal pulses between the core and the satellites
const PULSE_S = 1.1;                       // travel time of one pulse
const LEAVE_MS = 90;                       // grace before a hover selection is dropped
const LINK_S = 0.32;                       // leader line draw-in
const ARROW = '<svg class="icon icon--arrow" viewBox="0 0 24 12" aria-hidden="true" focusable="false"><path d="M0 6h22M17 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

const DASHED = [2, 6];                     // the selected satellite's link to the core
const SOLID = [];
const COS = new Float32Array(SAMPLES + 1);
const SIN = new Float32Array(SAMPLES + 1);
for (let i = 0; i <= SAMPLES; i++) { COS[i] = Math.cos((i / SAMPLES) * TAU); SIN[i] = Math.sin((i / SAMPLES) * TAU); }

function make(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Unit vectors spanning a ring's own plane: the system plane tilted by `incline` about a line at `node`. */
function planeBasis([incline, node]) {
  const ci = Math.cos(incline * DEG), si = Math.sin(incline * DEG);
  const cn = Math.cos(node * DEG), sn = Math.sin(node * DEG);
  return {
    u: [cn * cn + sn * sn * ci, sn * cn * (1 - ci), -sn * si],
    v: [sn * cn * (1 - ci), sn * sn + cn * cn * ci, cn * si],
  };
}

export default function init() {
  const root = qs('[data-fx="orbit"]');
  const stage = root && qs('.orbit__stage', root);
  const list = stage && qs('.orbit__list', stage);
  const radii = root ? (root.dataset.rings || '').split(',').map(Number).filter((r) => r > 0) : [];
  const nodes = list ? qsa('.orbit__node', list) : [];
  if (!nodes.length || !radii.length) return;

  const rgb = { ink: cssVar('--c-ink'), sky: `rgb(${cssVar('--rgb-sky')})`, coral: `rgb(${cssVar('--rgb-coral')})` };
  const incline = Number(root.dataset.incline) || 60;
  const view = { pitch: incline * DEG, roll: (Number(root.dataset.roll) || 0) * DEG };
  const total = root.dataset.total || String(nodes.length);

  // ── model ────────────────────────────────────────────────────────────────
  const rings = radii.map((radius, k) => {
    const basis = planeBasis(PLANES[k % PLANES.length]);
    return {
      radius, ...basis,
      omega: TAU / PERIODS[Math.min(k, PERIODS.length - 1)],
      spin: 0,                                   // radians travelled since load
      glow: 0,                                   // 0–1 highlight (the selected satellite's ring)
      grow: 1,                                   // 0–1 intro: the ring expands from the core
      ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,  // the plane's basis in view space, in px
      sx: new Float32Array(SAMPLES + 1), sy: new Float32Array(SAMPLES + 1), sz: new Float32Array(SAMPLES + 1),
    };
  });
  const bezel = { radius: BEZEL, u: [1, 0, 0], v: [0, 1, 0], spin: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, sx: new Float32Array(SAMPLES + 1), sy: new Float32Array(SAMPLES + 1), sz: new Float32Array(SAMPLES + 1) };
  const sats = nodes.map((el) => ({
    el,
    ring: rings[clamp(Math.round(Number(el.dataset.ring) || 0), 0, rings.length - 1)],
    base: (Number(el.dataset.angle) || 0) * TAU,
    x: 0, y: 0, depth: 1, front: null, shown: -1, dim: 1,
  }));

  // ── DOM ──────────────────────────────────────────────────────────────────
  const cv = createCanvas(stage, { className: 'orbit__canvas', fill: 'parent' });
  const ctx = cv.ctx;
  if (!ctx) return;

  const legend = make('p', 'orbit__legend label');
  legend.setAttribute('aria-hidden', 'true');
  legend.append(make('span', 'orbit__legend-title', 'ORBITAL MAP'), make('span', '', `${total} DEPARTMENTS`), make('span', '', `${String(rings.length).padStart(2, '0')} ORBITS`));
  stage.append(legend);

  const dock = make('div', 'orbit__dock');
  dock.setAttribute('aria-hidden', 'true');
  const hint = make('p', 'orbit__hint label', core.env.fine ? 'HOVER OVER A SATELLITE' : 'TAP A SATELLITE');
  const card = make('div', 'orbit__card');
  const cardIdx = make('span', 'orbit__card-idx');
  const cardShort = make('span', 'orbit__card-short');
  const cardMeta = make('p', 'orbit__card-meta label');
  cardMeta.append(cardIdx, cardShort);
  const cardName = make('p', 'orbit__card-name');
  const cardLead = make('p', 'orbit__card-lead');
  // last line: a link while the card is pinned by a tap, otherwise how to open (fx/orbit.css)
  const cardOpen = make('a', 'orbit__card-open label');
  cardOpen.tabIndex = -1;
  cardOpen.innerHTML = `<span>OPEN DEPARTMENT</span>${ARROW}`;
  const cardHow = make('p', 'orbit__card-how label');
  card.append(make('span', 'corners'), cardMeta, cardName, cardLead, cardOpen, cardHow);
  dock.append(hint);                // the card joins the dock with its first content, see fill()

  // ── state ────────────────────────────────────────────────────────────────
  let W = 0, H = 0, cx = 0, cy = 0, R = 0, focal = 1;
  let side = false;                 // card docked in a corner (wide) or stacked under the map
  let roomy = false;                // stacked: the dock has been given the height of the tallest card
  let visible = false;
  let deploy = core.fx.enabled ? 0 : 1; // 0 → 1 intro progress
  let deploying = false;
  let flow = 1;                     // 1 = orbiting at full speed, 0 = stopped
  let pitch = 0, yaw = 0;           // lean toward the pointer (radians), smoothed
  let hovered = null, focused = null, pinned = null, selected = null;
  let leaveTimer = 0;
  let touchDown = false;            // the click being handled came from a finger
  let link = 0;                     // 0 → 1 leader line progress
  const pulses = Array.from({ length: PULSES }, () => ({ sat: null, t: 1, out: true }));
  let pulseIn = 1.5;                // seconds until the next pulse leaves
  let ax = 0, ay = 0;               // where the leader line meets the card (stage px)

  // ── geometry ─────────────────────────────────────────────────────────────
  /** Rotate a plane basis into view space (pitch about X, yaw about Y, roll about Z) and scale it. */
  function orient(ring, sp, cp, sy, cyw, sr, cr, scale) {
    const m00 = cr * cyw, m01 = cr * sy * sp - sr * cp, m02 = cr * sy * cp + sr * sp;
    const m10 = sr * cyw, m11 = sr * sy * sp + cr * cp, m12 = sr * sy * cp - cr * sp;
    const m20 = -sy, m21 = cyw * sp, m22 = cyw * cp;
    const { u, v } = ring;
    const s = ring.radius * scale;
    ring.ax = (m00 * u[0] + m01 * u[1] + m02 * u[2]) * s;
    ring.ay = (m10 * u[0] + m11 * u[1] + m12 * u[2]) * s;
    ring.az = (m20 * u[0] + m21 * u[1] + m22 * u[2]) * s;
    ring.bx = (m00 * v[0] + m01 * v[1] + m02 * v[2]) * s;
    ring.by = (m10 * v[0] + m11 * v[1] + m12 * v[2]) * s;
    ring.bz = (m20 * v[0] + m21 * v[1] + m22 * v[2]) * s;
  }

  function sample(ring) {
    for (let i = 0; i <= SAMPLES; i++) {
      const c = COS[i], s = SIN[i];
      const z = ring.az * c + ring.bz * s;
      const k = focal / (focal - z);
      ring.sx[i] = cx + (ring.ax * c + ring.bx * s) * k;
      ring.sy[i] = cy + (ring.ay * c + ring.by * s) * k;
      ring.sz[i] = z;
    }
  }

  /** Radius (px) of the outer ring that fits the stage, found by projecting it at unit size. */
  function fit() {
    const sp = Math.sin(view.pitch), cp = Math.cos(view.pitch);
    const sr = Math.sin(view.roll), cr = Math.cos(view.roll);
    let ex = 0, ey = 0;
    for (const ring of rings) {
      orient(ring, sp, cp, 0, 1, sr, cr, 1);
      for (let i = 0; i < SAMPLES; i++) {
        const z = ring.az * COS[i] + ring.bz * SIN[i];
        const k = FOCAL / (FOCAL - z);
        ex = Math.max(ex, Math.abs(ring.ax * COS[i] + ring.bx * SIN[i]) * k);
        ey = Math.max(ey, Math.abs(ring.ay * COS[i] + ring.by * SIN[i]) * k);
      }
    }
    // room for the labels under the satellites and for the lean toward the pointer; on a wide
    // stage the system also leaves the corners free for the docked card
    const r = Math.min((W / 2 - 34) / ex, (H / 2 - 44) / ey) * 0.95;
    return Math.max(60, side ? Math.min(r, W * CORNER_FIT) : r);
  }

  /** Side or stack: the stylesheet decides (a container query, components/orbit.css). */
  function arrange() {
    side = getComputedStyle(stage).getPropertyValue('--orbit-layout').trim() === 'side';
    root.dataset.layout = side ? 'side' : 'stack';
  }

  function measure() {
    cv.resize();
    W = cv.w; H = cv.h;
    view.pitch = (side || W > H * WIDE_STAGE ? incline : Math.min(incline, STACK_INCLINE)) * DEG;
    cx = W / 2; cy = H / 2 - 4;
    R = fit();
    focal = FOCAL * R;
    root.style.setProperty('--orbit-core', `${Math.round(clamp(R * 0.21, 46, 96))}px`);
    if (roomy) {                    // the cards wrap differently at the new width
      dock.style.minHeight = '';
      roomy = false;
      if (!side) makeRoom();
    }
    if (selected) { fill(selected); attach(); }
  }

  // ── info card ────────────────────────────────────────────────────────────
  function fill(sat) {
    const d = sat.el.dataset;
    cardIdx.textContent = `${d.index} / ${total}`;
    cardShort.textContent = d.short;
    cardName.textContent = d.name;
    cardLead.textContent = d.lead;
    cardOpen.href = sat.el.href;
    cardHow.textContent = sat === focused && sat !== hovered ? 'PRESS ENTER TO OPEN' : 'CLICK THE SATELLITE TO OPEN';
    // Until now the dock held the hint alone, at the resting height the stylesheet reserves.
    if (!card.isConnected) dock.append(card);
  }

  /**
   * Stacked, with a pointer that hovers: give the dock the height of the tallest card, so moving
   * across the satellites does not move the page. From the first selection on — at rest the dock
   * keeps the height the page reserved for it. (A tap opens the card in place, like a disclosure.)
   */
  function makeRoom() {
    let tallest = 0;
    for (const sat of sats) { fill(sat); tallest = Math.max(tallest, card.offsetHeight); }
    dock.style.minHeight = `${tallest}px`;
    roomy = true;
  }

  /** Dock the card in the free corner nearest to the selected satellite and find the leader's end. */
  function attach() {
    if (side) {
      const w = card.offsetWidth;
      // top-left corner anchor vs bottom-right corner anchor (the card's corner facing the system)
      const dTl = Math.hypot(selected.x - w, selected.y - card.offsetHeight);
      const dBr = Math.hypot(selected.x - (W - w), selected.y - (H - card.offsetHeight));
      const tl = dTl <= dBr;
      root.dataset.dock = tl ? 'tl' : 'br';
      ax = tl ? w : W - w;
      ay = tl ? card.offsetHeight : H - card.offsetHeight;
    } else {
      root.dataset.dock = 'below';
      ax = clamp(selected.x, 12, W - 12);
      ay = H;
    }
  }

  function sync() {
    const next = hovered || pinned || focused;
    if (next === selected) return;
    if (selected) selected.el.classList.remove('is-selected');
    selected = next;
    card.classList.remove('is-open');
    if (selected) {
      selected.el.classList.add('is-selected');
      if (!roomy && !side && core.env.fine) makeRoom();
      fill(selected);
      attach();
      void card.offsetWidth;        // restart the card's entrance when stepping between satellites
      card.classList.add('is-open');
      link = 0;
    }
    card.classList.toggle('is-pinned', !!selected && selected === pinned);
    root.classList.toggle('has-selection', !!selected);
    if (!core.fx.enabled) still();
  }

  // ── frame ────────────────────────────────────────────────────────────────
  /** The page-transition wall is still up (fx/transition.js): the intro waits for it. */
  const covered = () => document.documentElement.classList.contains('is-entering');

  /** Project every ring and satellite for the current pose and write the satellites' transforms. */
  function place(dt) {
    const p = view.pitch + pitch, sp = Math.sin(p), cp = Math.cos(p);
    const sy = Math.sin(yaw), cyw = Math.cos(yaw);
    const sr = Math.sin(view.roll), cr = Math.cos(view.roll);
    for (let k = 0; k < rings.length; k++) {
      const ring = rings[k];
      // intro: each ring expands from the core, the inner one first
      const grow = ease.outQuint(clamp(deploy * 1.6 - k * 0.3));
      orient(ring, sp, cp, sy, cyw, sr, cr, R * grow);
      sample(ring);
      ring.grow = grow;
      ring.glow = damp(ring.glow, selected && selected.ring === ring ? 1 : 0, 9, dt);
    }
    orient(bezel, sp, cp, sy, cyw, sr, cr, R * ease.outQuint(clamp(deploy * 2.4)));
    sample(bezel);

    for (const sat of sats) {
      const ring = sat.ring;
      const a = sat.base + ring.spin;
      const c = Math.cos(a), s = Math.sin(a);
      const z = ring.az * c + ring.bz * s;
      const k = focal / (focal - z);
      sat.x = cx + (ring.ax * c + ring.bx * s) * k;
      sat.y = cy + (ring.ay * c + ring.by * s) * k;
      sat.depth = clamp(0.5 + z / (1.7 * R));
      const front = z >= 0;
      if (front !== sat.front) { sat.front = front; sat.el.style.zIndex = front ? '3' : '1'; }
      sat.dim = damp(sat.dim, !selected || sat === selected ? 1 : 0.6, 8, dt);
      const alpha = sat === selected ? 1 : (0.62 + 0.38 * sat.depth) * sat.dim * clamp(ring.grow * 2 - 1);
      sat.el.style.transform = `translate3d(${sat.x.toFixed(2)}px,${sat.y.toFixed(2)}px,0) scale(${(0.8 + 0.2 * sat.depth).toFixed(3)})`;
      if (Math.abs(alpha - sat.shown) > 0.004) { sat.shown = alpha; sat.el.style.opacity = alpha.toFixed(3); }
    }
  }

  function stroke(ring, front) {
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < SAMPLES; i++) {
      if ((ring.sz[i] + ring.sz[i + 1] >= 0) === front) {
        if (!pen) { ctx.moveTo(ring.sx[i], ring.sy[i]); pen = true; }
        ctx.lineTo(ring.sx[i + 1], ring.sy[i + 1]);
      } else pen = false;
    }
    ctx.stroke();
  }

  /** Radial tick marks in the ring's plane, turning with it. `len`/`major` are fractions of its radius. */
  function ticks(ring, len, major, step) {
    ctx.beginPath();
    const n = Math.round(360 / step);
    for (let j = 0; j < n; j++) {
      const a = ring.spin + j * step * DEG;
      const c = Math.cos(a), s = Math.sin(a);
      const x = ring.ax * c + ring.bx * s, y = ring.ay * c + ring.by * s, z = ring.az * c + ring.bz * s;
      const f = 1 + (j % TICK_MAJOR === 0 ? major : len);
      const k0 = focal / (focal - z), k1 = focal / (focal - z * f);
      ctx.moveTo(cx + x * k0, cy + y * k0);
      ctx.lineTo(cx + x * f * k1, cy + y * f * k1);
    }
    ctx.stroke();
  }

  function wake(sat) {
    const ring = sat.ring;
    const span = WAKE * flow * (0.62 / ring.radius + 0.38); // similar length in px on every ring
    if (span < 0.01) return;
    const head = sat.base + ring.spin;
    let c = Math.cos(head), s = Math.sin(head);
    let k = focal / (focal - (ring.az * c + ring.bz * s));
    let x0 = cx + (ring.ax * c + ring.bx * s) * k, y0 = cy + (ring.ay * c + ring.by * s) * k;
    for (let i = 1; i <= WAKE_STEPS; i++) {
      const a = head - (i / WAKE_STEPS) * span;
      c = Math.cos(a); s = Math.sin(a);
      k = focal / (focal - (ring.az * c + ring.bz * s));
      const x1 = cx + (ring.ax * c + ring.bx * s) * k, y1 = cy + (ring.ay * c + ring.by * s) * k;
      ctx.globalAlpha = 0.85 * (1 - i / (WAKE_STEPS + 1)) ** 2 * (0.45 + 0.55 * sat.depth) * sat.dim * ring.grow;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      x0 = x1; y0 = y1;
    }
  }

  /** Signal pulses: a short dash running along the straight line between the core and a satellite. */
  function signals() {
    ctx.strokeStyle = rgb.coral;
    ctx.lineWidth = 1.5;
    for (const p of pulses) {
      if (p.t >= 1) continue;
      const u = 0.16 + 0.76 * (p.out ? ease.inOutCubic(p.t) : 1 - ease.inOutCubic(p.t));
      const tail = u + (p.out ? -0.07 : 0.07);
      const dx = p.sat.x - cx, dy = p.sat.y - cy;
      ctx.globalAlpha = Math.sin(p.t * Math.PI) * 0.9 * p.sat.dim;
      ctx.beginPath();
      ctx.moveTo(cx + dx * tail, cy + dy * tail);
      ctx.lineTo(cx + dx * u, cy + dy * u);
      ctx.stroke();
    }
  }

  /** Leader line: leaves the satellite on a diagonal, then runs straight into the card's corner. */
  function leader() {
    const sx = selected.x, sy = selected.y;
    let mx, my, x0, y0;
    if (side) {
      const dx = ax - sx, dy = ay - sy;
      const d = Math.min(Math.abs(dx), Math.abs(dy));
      mx = sx + Math.sign(dx) * d; my = sy + Math.sign(dy) * d;
      const gap = Math.min(14, d);                      // start clear of the glyph
      x0 = sx + Math.sign(dx) * gap; y0 = sy + Math.sign(dy) * gap;
    } else {
      mx = sx; my = sy + 38;                             // straight down, starting below the label
      x0 = sx; y0 = my;
    }
    const l1 = Math.hypot(mx - x0, my - y0), l2 = Math.hypot(ax - mx, ay - my);
    const run = ease.outCubic(link) * (l1 + l2);
    ctx.strokeStyle = rgb.coral;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    const t1 = l1 > 0 ? Math.min(1, run / l1) : 1;
    ctx.lineTo(x0 + (mx - x0) * t1, y0 + (my - y0) * t1);
    if (run > l1 && l2 > 0) {
      const t2 = Math.min(1, (run - l1) / l2);
      ctx.lineTo(mx + (ax - mx) * t2, my + (ay - my) * t2);
    }
    ctx.stroke();
    if (link >= 1) { ctx.fillStyle = rgb.coral; ctx.fillRect(ax - 2.5, ay - 2.5, 5, 5); }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';

    // core bezel: a fine graduated ring that turns against the orbits
    ctx.strokeStyle = rgb.ink;
    ctx.globalAlpha = 0.2;
    stroke(bezel, true); stroke(bezel, false);
    ctx.globalAlpha = 0.34;
    ticks(bezel, 0.1, 0.22, 10);

    for (const ring of rings) {
      ctx.strokeStyle = rgb.ink;
      ctx.globalAlpha = 0.16 * ring.grow;
      stroke(ring, false);
      ctx.globalAlpha = 0.4 * ring.grow;
      stroke(ring, true);
      ctx.globalAlpha = 0.24 * ring.grow;
      ticks(ring, 0.012 / ring.radius, 0.028 / ring.radius, TICK_DEG);
      if (ring.glow > 0.01) {
        ctx.strokeStyle = rgb.coral;
        ctx.globalAlpha = 0.34 * ring.glow;
        stroke(ring, false);
        ctx.globalAlpha = 0.85 * ring.glow;
        stroke(ring, true);
        ctx.globalAlpha = 0.5 * ring.glow;
        ticks(ring, 0.012 / ring.radius, 0.028 / ring.radius, TICK_DEG);
      }
    }

    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgb.sky;
    for (const sat of sats) wake(sat);

    signals();
    if (selected && link > 0) {
      // the selected satellite's link to the core, then its leader to the card
      ctx.strokeStyle = rgb.coral;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.32 * link;
      ctx.setLineDash(DASHED);
      ctx.beginPath();
      ctx.moveTo(cx + (selected.x - cx) * 0.16, cy + (selected.y - cy) * 0.16);
      ctx.lineTo(cx + (selected.x - cx) * 0.92, cy + (selected.y - cy) * 0.92);
      ctx.stroke();
      ctx.setLineDash(SOLID);
      leader();
    }
    ctx.globalAlpha = 1;
  }

  function frame(dt, now) {
    if (!visible) return;
    if (deploying && !covered()) {
      if (deploy === 0) root.classList.add('is-awake');
      deploy = Math.min(1, deploy + dt / DEPLOY_S);
      if (deploy >= 1) { deploying = false; root.classList.add('is-deployed'); }
    }
    flow = damp(flow, selected ? 0 : 1, selected ? 6 : 2.2, dt);
    for (const ring of rings) ring.spin += ring.omega * flow * dt;
    bezel.spin -= 0.05 * flow * dt;
    // Lean toward the pointer (a slow sway on touch screens); held still while a satellite is
    // selected so it does not slide out from under the pointer.
    if (!selected) {
      const p = core.pointer;
      const steer = core.env.fine && p.active;
      const tp = steer ? -p.ny * LEAN.pitch * DEG : Math.sin(now * 0.31) * 3 * DEG;
      const ty = steer ? p.nx * LEAN.yaw * DEG : Math.sin(now * 0.23) * 6 * DEG;
      pitch = damp(pitch, tp, 2.4, dt);
      yaw = damp(yaw, ty, 2.4, dt);
    }
    if (selected && link < 1) link = Math.min(1, link + dt / LINK_S);
    // signal pulses: at random while idle, a steady downlink from the selected satellite
    pulseIn -= dt;
    for (const p of pulses) {
      if (p.t < 1) p.t = Math.min(1, p.t + dt / PULSE_S);
      else if (pulseIn <= 0 && deploy >= 1) {
        pulseIn = selected ? 0.45 : 0.7 + Math.random() * 1.6;
        p.sat = selected || sats[Math.floor(Math.random() * sats.length)];
        p.out = !selected && Math.random() < 0.5;
        p.t = 0;
      }
    }
    place(dt);
    draw();
  }

  /** Effects off: the diagram as it stands, drawn once. */
  function still() {
    deploy = 1; deploying = false; flow = 0; link = 1;
    for (const p of pulses) p.t = 1;
    root.classList.add('is-awake', 'is-deployed');
    place(1);                       // a long step settles every eased value
    if (selected) attach();
    draw();
  }

  // ── interaction ──────────────────────────────────────────────────────────
  const wiring = new AbortController();   // removes every element listener on destroy
  const { signal } = wiring;
  const satOf = (target) => {
    const el = target instanceof Element ? target.closest('.orbit__node') : null;
    return el ? sats.find((s) => s.el === el) : null;
  };
  /** The satellite whose centre is nearest to a tap: on a small map their boxes overlap. */
  const nearest = (e) => {
    const box = stage.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    let best = null, least = Infinity;
    for (const sat of sats) {
      const d = (sat.x - x) ** 2 + (sat.y - y) ** 2;
      if (d < least) { least = d; best = sat; }
    }
    return best;
  };

  for (const sat of sats) {
    sat.el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      clearTimeout(leaveTimer);
      hovered = sat;
      sync();
    }, { signal });
    sat.el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => { hovered = null; sync(); }, LEAVE_MS);
    }, { signal });
  }
  list.addEventListener('focusin', (e) => {
    const sat = satOf(e.target);
    // keyboard focus only: a tapped or clicked link is handled by the pointer paths
    focused = sat && sat.el.matches(':focus-visible') ? sat : null;
    sync();
  }, { signal });
  list.addEventListener('focusout', () => { focused = null; sync(); }, { signal });
  list.addEventListener('keydown', (e) => {
    const sat = satOf(e.target);
    if (!sat || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = sats.indexOf(sat);
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % sats.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + sats.length) % sats.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = sats.length - 1;
    else if (e.key === 'Escape' && pinned) { pinned = null; sync(); return; }
    if (to < 0) return;
    e.preventDefault();
    sats[to].el.focus();
  }, { signal });
  list.addEventListener('pointerdown', (e) => { touchDown = e.pointerType === 'touch'; }, { passive: true, signal });
  list.addEventListener('click', (e) => {
    const hit = satOf(e.target);
    const byTouch = touchDown && e.detail > 0;   // (a keyboard "click" has no position)
    touchDown = false;
    if (!hit) return;
    const sat = byTouch ? nearest(e) : hit;
    if (byTouch && pinned !== sat) {
      // first tap: select and show the card (which carries the link); a second tap opens
      e.preventDefault();
      pinned = sat;
      sync();
      if (!side) dock.scrollIntoView({ block: 'nearest', behavior: core.fx.enabled ? 'smooth' : 'instant' });
    } else if (sat !== hit) {
      // second tap on the pinned satellite, caught by a neighbour's box: open the one meant
      e.preventDefault();
      sat.el.click();
    } else if (core.fx.enabled && !e.defaultPrevented) {
      const box = stage.getBoundingClientRect();
      core.emit('burst', { x: box.left + sat.x, y: box.top + sat.y, power: 0.8 });
    }
  }, { signal });
  // a tap on the map's background lets the system go again
  stage.addEventListener('click', (e) => {
    if (pinned && !satOf(e.target)) { pinned = null; sync(); }
  }, { signal });

  // ── lifecycle ────────────────────────────────────────────────────────────
  // Going live is a single step for the layout engine: the layout is read while the static grid
  // still stands, then the class, the layout and the dock change together with no read in
  // between — the document is never laid out at another height (scroll anchoring would follow it).
  arrange();
  root.classList.add('orbit--live');
  root.append(dock);
  measure();
  place(1);
  draw();
  if (!core.fx.enabled) still();

  const offs = [
    core.tick(frame),
    core.on('resize', () => { arrange(); measure(); if (core.fx.enabled) { place(0.016); draw(); } else still(); }),
    core.on('fx:change', (enabled) => {
      if (enabled) { flow = 0; if (deploy < 1) deploying = visible; }
      else still();
    }),
    inView(stage, (v) => {
      visible = v;
      if (v && deploy < 1 && core.fx.enabled) deploying = true;
    }, { rootMargin: '60px 0px 60px 0px' }),
  ];

  return {
    destroy() {
      for (const off of offs) off();
      wiring.abort();
      clearTimeout(leaveTimer);
      root.classList.remove('orbit--live', 'is-awake', 'is-deployed', 'has-selection');
      delete root.dataset.layout;
      delete root.dataset.dock;
      root.style.removeProperty('--orbit-core');
      for (const sat of sats) { sat.el.removeAttribute('style'); sat.el.classList.remove('is-selected'); }
      cv.canvas.remove(); legend.remove(); dock.remove();
    },
  };
}
