// @fx-when: [data-fx="comm"]
// Contact page — the comm link (markup: templates/partials/comm.mjs).
//
//   copy button    always wired, effects or not: copies the address (Clipboard API, then the
//                  legacy command, then selecting the text), confirms on the button and in the
//                  aria-live status line. With effects on it also fires a 'burst' at the button
//                  and sends a strong pulse through the scope and the waveform.
//   scope          a canvas over the static SVG dish: signal rings leave the antenna, a beam
//                  sweeps, the three contacts (mail, Instagram, LinkedIn) flash as it passes, and
//                  hovering or focusing a matching control or link makes the beam lock on to its contact.
//                  A bearing line follows the pointer; the closer it is, the stronger the signal.
//   waveform       the carrier under the address: amplitude follows the signal strength, a swell
//                  follows the pointer along the strip.
//   transmissions  the three paragraphs arrive one after the other, word by word behind a moving
//                  print head. The words are only ever faded (never rewritten or removed), so
//                  assistive tech reads the full text at any moment.
//
// Adds html.comm-ready while it runs; every hidden or animated state in comm.css is scoped to it
// (and to html.fx-on), so the static page stays intact with effects off or if this never loads.

import { core } from '../core.js';
import { splitText, scramble } from './reveal.js';

const { clamp, damp, lerp, smoothstep, angleDiff, TAU, qs, qsa, cssVar, createCanvas, inView } = core.utils;
const root = document.documentElement;

const OVERSCAN = 0.22;        // the scope canvas extends this far beyond the dish box on every side (comm.css)
const DISH = 0.45;            // dish radius as a fraction of the dish box (comm.mjs / comm.css)
const SWEEP = 0.85;           // rad/s of the free-running beam
const TRAIL = 30;             // sectors in the beam's afterglow …
const TRAIL_STEP = 0.036;     // … each this wide (rad)
const PULSES = 10;
const PULSE_SPEED = 0.42;     // dish radii per second
const COPY_HOLD_MS = 2400;    // how long the confirmation stays
const READOUT_S = 0.12;       // seconds between read-out refreshes
const WAVE_STEP = 3;          // px between waveform samples
const TX_LAST = 'comm-flash'; // keyframes on each word's print-head flash (comm.css)

/** "r, g, b" token → canvas colour string. */
const rgb = (name) => `rgb(${cssVar(name) || '255, 255, 255'})`;

// ── clipboard ──────────────────────────────────────────────────────────────

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* command not available */ }
  area.remove();
  return ok;
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* denied or insecure context: try the old way */ }
  }
  return legacyCopy(text);
}

function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

// ── module ─────────────────────────────────────────────────────────────────

export default function init() {
  const stage = qs('[data-fx="comm"]');
  if (!stage) return null;

  const disposers = [];
  const listen = (target, type, fn) => { target.addEventListener(type, fn); disposers.push(() => target.removeEventListener(type, fn)); };

  // live state shared by the scope, the waveform and the read-outs
  const sig = { level: 0.5, kick: 0 };           // signal strength 0–1; kick = decaying extra after a copy
  const pulses = Array.from({ length: PULSES }, () => ({ live: false, r: 0, gain: 0, width: 1, hot: false }));
  const burstWave = { live: false, x: 0, age: 0 }; // the packet a copy sends along the waveform
  let active = null;                              // the contact whose control is hovered / focused

  function emitPulse(gain = 0.5, hot = false) {
    const p = pulses.find((q) => !q.live);
    if (!p) return;
    p.live = true; p.r = 0.02; p.gain = gain; p.hot = hot; p.width = hot ? 2 : 1;
  }

  // ── copy button ──────────────────────────────────────────────────────────
  const copyBtn = qs('[data-comm-copy]', stage);
  const copyLabel = qs('[data-comm-copy-label]', stage);
  const status = qs('[data-comm-status]', stage);
  const address = qs('.comm__email-text', stage);
  if (copyBtn && copyLabel && status) {
    const idle = copyLabel.textContent;
    let timer = 0;
    const restore = () => {
      copyLabel.textContent = idle;
      status.textContent = '';
      copyBtn.classList.remove('is-done');
    };
    listen(copyBtn, 'click', async () => {
      const text = copyBtn.dataset.copyText;
      const ok = await writeClipboard(text);
      if (!ok && address) selectText(address);
      copyLabel.textContent = ok ? 'COPIED' : 'SELECTED';
      status.textContent = ok ? `Copied to clipboard: ${text}` : 'Address selected: press Ctrl / Cmd + C to copy';
      copyBtn.classList.add('is-done');
      clearTimeout(timer);
      timer = setTimeout(restore, COPY_HOLD_MS);
      if (!core.fx.enabled) return;
      scramble(copyLabel, { quick: true });
      const r = copyBtn.getBoundingClientRect();
      core.emit('burst', { x: r.left + r.width / 2, y: r.top + r.height / 2, power: 1.1, color: '--c-coral' });
      sig.kick = 1;
      emitPulse(1, true);
      setTimeout(() => emitPulse(0.7, true), 160);
      setTimeout(() => emitPulse(0.45, true), 320);
      burstWave.live = true; burstWave.age = 0; burstWave.x = r.left + r.width / 2;
    });
    copyBtn.hidden = false;
    disposers.push(() => { clearTimeout(timer); restore(); copyBtn.hidden = true; });
  }

  // ── scope + waveform ─────────────────────────────────────────────────────
  const screen = qs('.comm__screen', stage);
  const waveHost = qs('.comm__wave', stage);
  const out = Object.fromEntries(qsa('[data-comm-out]', stage).map((node) => [node.dataset.commOut, { node, rest: node.textContent, text: node.textContent }]));
  const write = (key, text) => { const o = out[key]; if (o && o.text !== text) { o.text = text; o.node.textContent = text; } };

  let scope = null;
  let wave = null;
  try {
    if (screen && waveHost) {
      const box = document.createElement('div');
      box.className = 'comm-scope';
      box.setAttribute('aria-hidden', 'true');
      screen.append(box);
      scope = createCanvas(box, { maxDpr: 1.5, fill: 'parent' });
      wave = createCanvas(waveHost, { className: 'comm-wave', maxDpr: 2, fill: 'parent' });
      if (!scope.ctx || !wave.ctx) throw new Error('2d canvas unavailable');
    }
  } catch {
    scope?.canvas.parentElement.remove();
    wave?.canvas.remove();
    scope = wave = null;
  }

  if (scope) {
    const color = { coral: rgb('--rgb-coral'), sky: rgb('--rgb-sky'), ink: cssVar('--c-ink'), amber: rgb('--rgb-amber') };
    const contacts = qsa('[data-comm-blip]', stage).map((node) => ({
      id: node.dataset.commBlip,
      node,
      angle: (parseFloat(node.dataset.bearing) * Math.PI) / 180,
      range: parseFloat(node.dataset.range),
      flash: 0,
    }));
    const geo = { cx: 0, cy: 0, r: 1, wx: 0, wy: 0, ww: 1, wh: 1, max: -1 };   // page-space centre of the dish; waveform box
    const beam = { angle: -Math.PI / 2, lock: 0 };
    let deckVisible = false;
    let waveVisible = false;
    let nextPulse = 0.6;
    let readoutAt = 0;
    let pointerNear = 0;        // 0–1: how much the pointer bearing line shows
    const aim = { dx: 0, dy: 0 };   // pointer position relative to the antenna (px)

    /** The only layout reads: where the dish and the waveform sit on the page. */
    function measure() {
      geo.max = core.scroll.max;
      const s = screen.getBoundingClientRect();
      geo.cx = s.left + s.width / 2;
      geo.cy = s.top + s.height / 2 + core.scroll.y;
      geo.r = s.width * DISH;
      const w = waveHost.getBoundingClientRect();
      geo.wx = w.left; geo.wy = w.top + core.scroll.y; geo.ww = w.width; geo.wh = w.height;
    }

    function resize() {
      scope.resize();
      wave.resize();
      geo.max = -1;
    }

    function setActive(id) {
      const next = contacts.find((c) => c.id === id) || null;
      if (next === active) return;
      active?.node.classList.remove('is-locked');
      active = next;
      active?.node.classList.add('is-locked');
    }
    // A control locks its contact while hovered or focused: the address, the social buttons, and
    // the links inside the transmissions that lead to the same places.
    const channelOf = new Map();
    for (const control of qsa('[data-comm-channel]', stage)) {
      const id = control.dataset.commChannel;
      channelOf.set(control, id);
      const link = control.matches('a') ? control : qs('a[href]', control);
      for (const twin of link ? qsa('.comm__log a[href]', stage) : []) if (twin.href === link.href) channelOf.set(twin, id);
    }
    for (const [control, id] of channelOf) {
      listen(control, 'pointerenter', () => setActive(id));
      listen(control, 'pointerleave', () => { if (!control.contains(document.activeElement)) setActive(null); });
      listen(control, 'focusin', () => setActive(id));
      listen(control, 'focusout', () => setActive(null));
    }

    // ── per-frame state ────────────────────────────────────────────────────
    function update(dt, now) {
      const ptr = core.pointer;
      const dx = aim.dx = ptr.x - geo.cx;
      const dy = aim.dy = ptr.y + core.scroll.y - geo.cy;
      const tracking = core.env.fine && ptr.active && ptr.inside;

      // signal strength: distance of the pointer from the antenna; a slow swell on touch screens
      const reach = Math.hypot(core.viewport.w, core.viewport.h) * 0.7;
      const target = tracking ? 1 - smoothstep(geo.r * 0.4, reach, Math.hypot(dx, dy)) : 0.55 + 0.25 * Math.sin(now * 0.7);
      sig.level = damp(sig.level, clamp(target + (active ? 0.25 : 0)), 4, dt);
      sig.kick = damp(sig.kick, 0, 1.6, dt);
      pointerNear = damp(pointerNear, tracking ? 1 : 0, 6, dt);

      // beam: free sweep, or eased on to the active contact and held there with a slight hunt
      const prev = beam.angle;
      beam.lock = damp(beam.lock, active ? 1 : 0, 5, dt);
      if (active) beam.angle += angleDiff(beam.angle, active.angle + Math.sin(now * 5) * 0.03) * (1 - Math.exp(-7 * dt));
      else beam.angle += SWEEP * (1 + sig.kick * 2.5) * dt;
      for (const c of contacts) {
        const before = angleDiff(prev, c.angle);
        if (before > 0 && before <= angleDiff(prev, beam.angle) + 1e-4) c.flash = 1;
        c.flash = c === active ? 1 : damp(c.flash, 0, 1.3, dt);
      }

      // rings: more often as the signal gets stronger
      nextPulse -= dt;
      if (nextPulse <= 0) { emitPulse(0.34 + sig.level * 0.3); nextPulse = lerp(2.3, 0.85, sig.level); }
      for (const p of pulses) {
        if (!p.live) continue;
        p.r += PULSE_SPEED * (p.hot ? 1.9 : 1) * dt;
        if (p.r >= 1 + OVERSCAN * 2) p.live = false;
      }
      if (burstWave.live && (burstWave.age += dt) > 1.6) burstWave.live = false;

      if (now >= readoutAt) {
        readoutAt = now + READOUT_S;
        const brg = (Math.round((Math.atan2(dy, dx) * 360) / TAU) + 450) % 360;
        write('sig', `${String(Math.round(clamp(sig.level + sig.kick * 0.3) * 100)).padStart(2, '0')}%`);
        write('brg', tracking ? `${String(brg).padStart(3, '0')}°` : out.brg?.rest);
        write('link', sig.kick > 0.25 ? 'TX' : active ? 'LOCK' : 'NOMINAL');
      }
    }

    // ── drawing ────────────────────────────────────────────────────────────
    function drawScope() {
      const { ctx, w, h } = scope;
      const { dx, dy } = aim;
      const c = w / 2;
      const R = (w / (1 + OVERSCAN * 2)) * DISH;
      ctx.clearRect(0, 0, w, h);

      // signal rings
      for (const p of pulses) {
        if (!p.live) continue;
        const k = p.r / (1 + OVERSCAN * 2);
        ctx.globalAlpha = p.gain * (1 - k) ** 1.5;
        ctx.strokeStyle = p.hot ? color.coral : color.sky;
        ctx.lineWidth = p.width;
        ctx.beginPath();
        ctx.arc(c, c, p.r * R, 0, TAU);
        ctx.stroke();
      }

      // beam: afterglow sectors behind the leading edge
      ctx.fillStyle = beam.lock > 0.5 ? color.coral : color.sky;
      for (let i = 0; i < TRAIL; i++) {
        const a1 = beam.angle - i * TRAIL_STEP;
        ctx.globalAlpha = 0.24 * (1 - i / TRAIL) ** 1.8 * (1 - beam.lock * 0.55);
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, R, a1 - TRAIL_STEP - 0.002, a1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = beam.lock > 0.5 ? color.coral : color.sky;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(beam.angle) * R, c + Math.sin(beam.angle) * R);
      ctx.stroke();

      // pointer bearing: a dashed line toward the pointer and a marker where it meets the rim
      if (pointerNear > 0.02) {
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const len = Math.min(d, R);
        ctx.globalAlpha = 0.5 * pointerNear;
        ctx.strokeStyle = color.ink;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + ux * len, c + uy * len);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.9 * pointerNear;
        ctx.strokeStyle = color.coral;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c + ux * (R - 7), c + uy * (R - 7));
        ctx.lineTo(c + ux * (R + 11), c + uy * (R + 11));
        ctx.stroke();
      }

      // contacts: an echo ring when the beam passes, brackets while locked
      for (const k of contacts) {
        if (k.flash < 0.02) continue;
        const x = c + Math.cos(k.angle) * k.range * R;
        const y = c + Math.sin(k.angle) * k.range * R;
        ctx.globalAlpha = k.flash * 0.9;
        ctx.strokeStyle = color.coral;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 7 + (1 - k.flash) * 16, 0, TAU);
        ctx.stroke();
        if (k !== active) continue;
        const b = 13;
        ctx.globalAlpha = beam.lock;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          ctx.moveTo(x + sx * b, y + sy * (b - 5));
          ctx.lineTo(x + sx * b, y + sy * b);
          ctx.lineTo(x + sx * (b - 5), y + sy * b);
        }
        ctx.stroke();
      }

      // antenna
      ctx.globalAlpha = 0.35 + sig.level * 0.35 + sig.kick * 0.3;
      ctx.fillStyle = color.coral;
      ctx.beginPath();
      ctx.arc(c, c, 7 + sig.kick * 9, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function drawWave(now) {
      const { ctx, w, h } = wave;
      const mid = h / 2;
      const ptr = core.pointer;
      const px = ptr.x - geo.wx;
      // how close the pointer is to the strip, vertically: the swell fades out with distance
      const prox = pointerNear * (1 - smoothstep(0, core.viewport.h * 0.5, Math.abs(ptr.y + core.scroll.y - geo.wy - geo.wh / 2)));
      const amp = h * (0.07 + 0.13 * Math.max(sig.level, prox) + 0.1 * sig.kick);
      const bx = burstWave.x - geo.wx;
      const spread = burstWave.age * 900;
      const decay = burstWave.live ? (1 - burstWave.age / 1.6) ** 2 : 0;
      const t = now;

      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      for (let x = 0; x <= w + WAVE_STEP; x += WAVE_STEP) {
        const g = (x - px) / 150;
        const env = 0.45 + 0.85 * prox * Math.exp(-g * g);
        let y = env * amp * (Math.sin(x * 0.034 - t * 3.1) + 0.55 * Math.sin(x * 0.081 + t * 4.3) + 0.22 * Math.sin(x * 0.19 - t * 7.7));
        if (decay > 0) {
          const d = (Math.abs(x - bx) - spread) / 70;
          y += h * 0.36 * decay * Math.exp(-d * d) * Math.sin((x - bx) * 0.21 - t * 26);
        }
        if (x === 0) ctx.moveTo(x, mid + y); else ctx.lineTo(x, mid + y);
      }
      ctx.strokeStyle = color.coral;
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function frame(dt, now) {
      if (!deckVisible && !waveVisible) return;
      if (geo.max !== core.scroll.max) measure();   // resize, late fonts or images: the page moved
      update(dt, now);
      if (deckVisible) drawScope();
      if (waveVisible) drawWave(now);
    }

    function rest() {
      scope.ctx.clearRect(0, 0, scope.w, scope.h);
      wave.ctx.clearRect(0, 0, wave.w, wave.h);
      for (const p of pulses) p.live = false;
      for (const key of Object.keys(out)) write(key, out[key].rest);
      sig.kick = 0;
      burstWave.live = false;
    }

    disposers.push(
      core.tick(frame),
      core.on('resize', resize),
      core.on('fx:change', (enabled) => { if (enabled) geo.max = -1; else rest(); }),
      inView(screen, (visible) => { deckVisible = visible; }, { rootMargin: '10% 0px 10% 0px' }),
      inView(waveHost, (visible) => { waveVisible = visible; }, { rootMargin: '10% 0px 10% 0px' }),
      () => { rest(); setActive(null); scope.canvas.parentElement.remove(); wave.canvas.remove(); },
    );
  }

  // ── transmissions ────────────────────────────────────────────────────────
  const txs = qsa('.comm__tx', stage);
  const finishAll = () => { for (const tx of txs) { tx.classList.remove('is-receiving'); tx.classList.add('is-received'); } };
  if (core.fx.enabled && txs.length) {
    const lastWord = new Map();
    for (const tx of txs) {
      const { words } = splitText(qs('.comm__tx-body', tx), 'words');
      tx.style.setProperty('--comm-words', words.length);
      lastWord.set(words[words.length - 1], tx);
    }
    const receive = (i) => {
      const tx = txs[i];
      if (!tx || tx.classList.contains('is-received')) return;
      tx.classList.add('is-receiving');
      emitPulse(0.6);
    };
    listen(stage, 'animationend', (e) => {
      const tx = e.animationName === TX_LAST ? lastWord.get(e.target) : null;
      if (!tx || !tx.classList.contains('is-receiving')) return;
      tx.classList.remove('is-receiving');
      tx.classList.add('is-received');
      const state = qs('.comm__tx-state', tx);
      if (state) scramble(state, { quick: true });
      receive(txs.indexOf(tx) + 1);
    });
    disposers.push(inView(qs('.comm__log', stage) || stage, (visible) => { if (visible) receive(0); }, { once: true, rootMargin: '0px 0px -18% 0px' }));
  } else {
    finishAll();
  }
  disposers.push(core.on('fx:change', finishAll));   // either way: never replay, never leave words hidden

  root.classList.add('comm-ready');

  return {
    destroy() {
      for (const dispose of disposers) dispose();
      finishAll();
      root.classList.remove('comm-ready');
    },
  };
}
