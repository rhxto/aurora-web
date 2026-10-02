// HUD — the flight display mounted in #fx-hud (docs/ARCHITECTURE.md §8).
//
//   · status bar  docked to the bottom edge of the viewport (--hud-bar-h tall, full width). Left:
//                 status, mission clock and the cursor rocket's speed, heading and lock target.
//                 Right: altitude (while the ruler is compact), LAUNCH (emits 'launch' for
//                 fx/egg.js) and the FX switch. With effects off the bar stays, on standby, so
//                 the switch is always there. The bar is the last stop of the tab order, so the
//                 switch has a twin at the very start of it: a button next to the skip link,
//                 shown when it takes focus.
//   · altimeter   right edge. The page scroll (0 → 1) is flown as altitude (0 → 3000 m, the target
//                 apogee of Nemesis). It is a real vertical slider: click, drag or use the keyboard.
//                 The full ruler is shown only when the margin beside the content column can hold
//                 it; otherwise it is a 3 px strip in the gutter.
//
// The bar reserves its own space: html.has-hud makes the footer taller by the bar's height
// (base.css), so nothing at the end of the page is hidden behind it. The altimeter fades out
// while an element marked [data-hud-clear] is under it.
//
// Per-frame work is three transform writes at most (none once the marker has settled); read-outs
// are refreshed at 10 Hz and a text node is only written when its value actually changed.

import { core } from '../core.js';

const { clamp, damp, garble, qs, qsa, cssVar, inView, TAU } = core.utils;
const root = document.documentElement;

const APOGEE_M = 3000;       // full scroll = the 3000 m target apogee quoted in content/site.json
const STEPS = 30;            // ruler divisions, 100 m each
const MAJOR = 5;             // every 5th division carries a number (500 m)
const ALT_COLUMN = 92;       // px of free margin the full ruler needs beside the content column
const ALT_MIN_H = 480;       // px — shorter viewports get the strip
const TEXT_INTERVAL = 0.1;   // s between read-out refreshes
const VEL_SCALE = 0.15;      // cursor-rocket px/s → playful "m/s" (its top speed reads about Mach 1)
const BOOST_HOLD = 0.7;      // s the status keeps saying BOOST so it can be read
const NEAR = 96;             // px — the pointer within this distance brightens a HUD group
const ALT_PAD = 44;          // px the altimeter occupies beyond its ruler: cap above, exhaust below
const NAME_MAX = 22;         // characters of a lock-target name
const NO_TARGET = '—';
const DECODE_S = 0.3;        // duration of the decode flicker
const DECODE_FRAMES = 8;     // text writes per decode
const GLYPHS = 'ABCDEFGHKLMNPRSTUVXYZ0123456789';
const CLEAR_OF = '[data-hud-clear]';
const CONTENT = 'main .container, .site-footer .container';
const STATUS = { nominal: 'GNC NOMINAL', boost: 'BOOST', off: 'STANDBY' };

const KEY_STEPS = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: MAJOR, PageDown: -MAJOR };

function markup() {
  let nums = '';
  for (let i = 0; i <= STEPS / MAJOR; i++) {
    nums += `<span class="hud-alt__num" style="--i:${i}">${APOGEE_M - i * (APOGEE_M / STEPS) * MAJOR}</span>`;
  }
  return `
    <div class="hud-bar">
      <div class="hud-bar__group hud-bar__group--tlm" aria-hidden="true">
        <span class="hud-cell hud-cell--status"><i class="hud-dot"></i><span class="hud-cell__text" data-hud="status">${STATUS.nominal}</span></span>
        <span class="hud-cell hud-cell--clock"><span class="hud-k">T+</span><span class="hud-v" data-hud="clock">00:00.0</span></span>
        <span class="hud-cell hud-cell--vel"><span class="hud-k">VEL</span><span class="hud-v"><span data-hud="vel">000</span><span class="hud-u">m/s</span></span></span>
        <span class="hud-cell hud-cell--hdg"><span class="hud-k">HDG</span><span class="hud-v"><span data-hud="hdg">000</span><span class="hud-u">°</span></span></span>
        <span class="hud-cell hud-cell--tgt"><span class="hud-k">TGT</span><span class="hud-v" data-hud="tgt">${NO_TARGET}</span></span>
      </div>
      <div class="hud-bar__group hud-bar__group--ctl">
        <span class="hud-cell hud-cell--alt" aria-hidden="true"><span class="hud-k">ALT</span><span class="hud-v"><span data-hud="alt">0</span><span class="hud-u">m</span></span></span>
        <button class="hud-cell hud-launch" type="button" title="Run the launch sequence">Launch<i class="hud-launch__mark"></i></button>
        <button class="hud-cell hud-fx" type="button" aria-label="FX, visual effects" title="Visual effects" aria-pressed="true">
          <i class="hud-dot hud-fx__led"></i><span>FX</span><span class="hud-fx__state" data-hud="fx">ON</span>
        </button>
      </div>
    </div>
    <div class="hud-alt">
      <span class="hud-alt__cap" aria-hidden="true">Apogee</span>
      <div class="hud-alt__track" role="slider" tabindex="0" aria-orientation="vertical"
           aria-label="Page scroll position, shown as altitude" aria-valuemin="0" aria-valuemax="${APOGEE_M}" aria-valuenow="0">
        <div class="hud-alt__scale" aria-hidden="true">
          ${nums}
          <i class="hud-alt__trail"></i>
          <div class="hud-alt__rider">
            <i class="hud-alt__exhaust"></i>
            <svg class="hud-alt__rocket" viewBox="0 0 11 21" width="11" height="21" focusable="false">
              <path class="hud-alt__rocket-body" d="M3 7.5h5V18H3z"/>
              <path class="hud-alt__rocket-trim" d="M5.5.5C7.4 2.6 8 5 8 7.5H3C3 5 3.6 2.6 5.5.5ZM3 13.5.5 20 3 18.5ZM8 13.5 10.5 20 8 18.5Z"/>
            </svg>
            <span class="hud-alt__tag"><span class="hud-k">ALT</span><span class="hud-alt__tag-v"><span data-hud="alt">0</span><span class="hud-u">m</span></span></span>
          </div>
        </div>
      </div>
    </div>`;
}

/** Seconds → "mm:ss.s" (saturates at 99:59.9). */
function formatClock(seconds) {
  const tenths = Math.min(59999, Math.floor(seconds * 10));
  const mm = String(Math.floor(tenths / 600)).padStart(2, '0');
  const ss = String(Math.floor((tenths % 600) / 10)).padStart(2, '0');
  return `${mm}:${ss}.${tenths % 10}`;
}

/** Metres → "1 240" (no-break space as thousands separator). */
const formatAltitude = (m) => (m < 1000 ? String(m) : `${Math.floor(m / 1000)} ${String(m % 1000).padStart(3, '0')}`);

/** Non-negative integer → three digits, saturating at 999. */
const pad3 = (n) => String(Math.min(999, n)).padStart(3, '0');

/** core.rocket is written by another module: never let a NaN reach a read-out. */
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * The text of `el` as it is read out: aria-hidden parts left out, a space between pieces that
 * sit in different boxes (a label above a name) — but none inside a run of inline text, however
 * the markup slices it ("info@" + <wbr> + "aurorarocketry.eu" is one word).
 */
function spokenText(el) {
  const inline = (box) => box === el || getComputedStyle(box).display === 'inline';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let out = '';
  let last = null;                 // parent of the previous piece
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent.closest('[aria-hidden="true"]')) continue;
    if (last && last !== parent && !(inline(last) && inline(parent))) out += ' ';
    out += walker.currentNode.data;
    last = parent;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Short uppercase name for the element the cursor rocket locked on. */
function targetName(el) {
  const raw = el.getAttribute('aria-label') || spokenText(el) || qs('img[alt]', el)?.alt || el.getAttribute('title') || el.textContent;
  const name = raw.replace(/\s+/g, ' ').trim().toUpperCase() || (el.matches('a') ? 'LINK' : 'CONTROL');
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
}

/** A rect grown by `x` / `y` px on each side. */
const grow = (r, x, y) => ({ left: r.left - x, right: r.right + x, top: r.top - y, bottom: r.bottom + y });
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Decode-style text change for values that switch category (target name, status): characters
 * resolve left to right out of random glyphs. step() only touches the DOM DECODE_FRAMES times.
 */
function decoder(node) {
  let text = node.textContent;
  let t = 1;         // 0 → 1 progress of the current decode
  let drawn = -1;
  return {
    set(next) {
      if (next === text) return;
      text = next; t = 0; drawn = -1;
    },
    /** Write the text at once (the ticker is not running while effects are off). */
    force(next) {
      text = next; t = 1;
      node.textContent = next;
    },
    step(dt) {
      if (t >= 1) return;
      t = Math.min(1, t + dt / DECODE_S);
      const frame = Math.floor(t * DECODE_FRAMES);
      if (frame === drawn) return;
      drawn = frame;
      node.textContent = garble(text, Math.floor(t * text.length), GLYPHS);
    },
  };
}

export default function init() {
  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.setAttribute('role', 'group');
  hud.setAttribute('aria-label', 'Flight display');
  hud.innerHTML = markup();
  if (core.fx.enabled) hud.classList.add('hud--intro');   // the bar slides up once, with the page
  core.layers.hud.append(hud);
  root.classList.add('has-hud');

  // The switch again, as the second stop of the page (after "Skip to content"): whoever needs
  // the motion to stop must not have to tab through the whole page first. Styled as a skip link.
  const early = document.createElement('button');
  early.type = 'button';
  early.className = 'skip-link hud-skip';
  early.addEventListener('click', () => core.toggleFx());
  (qs('.skip-link') || core.layers.sky).after(early);

  const bar = qs('.hud-bar', hud);
  const alt = qs('.hud-alt', hud);
  const track = qs('.hud-alt__track', hud);
  const scale = qs('.hud-alt__scale', hud);
  const rider = qs('.hud-alt__rider', hud);
  const trail = qs('.hud-alt__trail', hud);
  const exhaust = qs('.hud-alt__exhaust', hud);
  const button = qs('.hud-fx', hud);
  const nums = qsa('.hud-alt__num', hud).map((el, i) => ({ el, at: 1 - i / (STEPS / MAJOR), near: false }));
  const columns = qsa(CONTENT);   // the page's content columns: the ruler must fit beside the widest

  // ── read-outs: write a text node only when its value changed ─────────────
  const outputs = {};
  for (const node of qsa('[data-hud]', hud)) (outputs[node.dataset.hud] ||= []).push(node);
  const written = {};
  function write(key, value) {
    if (written[key] === value) return;
    written[key] = value;
    for (const node of outputs[key]) node.textContent = value;
  }
  const target = decoder(outputs.tgt[0]);
  const status = decoder(outputs.status[0]);

  // ── state ────────────────────────────────────────────────────────────────
  const headerH = parseFloat(cssVar('--header-h')) || 0;
  const inSight = new Set();            // CLEAR_OF elements currently in the viewport
  let compact = false;
  let trackH = 0;                       // ruler height in px (multiple of STEPS)
  let altZone = null;                   // cached footprint (viewport px) of the altimeter
  let barTop = 0;                       // top edge of the status bar (viewport px)
  let shown = core.scroll.progress;     // eased scroll progress the marker is drawn at
  let thrust = 0;                       // 0–1 exhaust length, follows scroll velocity
  let drawnY = NaN, drawnThrust = NaN;
  let textClock = TEXT_INTERVAL;        // accumulates dt; ≥ interval → refresh read-outs
  let boostUntil = 0;
  let drag = null;                      // { top, startY, moved } while the slider is dragged
  let keyTarget = 0, keyTime = -Infinity;

  /** Free margin (px) between the widest content column and the edge of the viewport. */
  function sideMargin() {
    let widest = 0;
    // offsetWidth: the laid-out width, whatever transform an entrance animation applies right now
    for (const el of columns) widest = Math.max(widest, el.offsetWidth);
    return (hud.clientWidth - widest) / 2;
  }

  /** The full ruler needs a mouse, a tall enough window and room beside the content. */
  const fitsRuler = () => core.env.fine && core.viewport.h >= ALT_MIN_H && sideMargin() >= ALT_COLUMN;

  function measure() {
    const { h } = core.viewport;
    compact = !fitsRuler();
    hud.classList.toggle('hud--compact', compact);
    barTop = h - bar.offsetHeight;
    // Whole-pixel geometry: a ruler height divisible by its steps and an integer top offset keep
    // every tick on the pixel grid. The ruler is centred between the header and the status bar,
    // unless a short window squeezes it.
    const top = headerH + ALT_PAD;
    const bottom = barTop - ALT_PAD - 8;
    trackH = Math.max(3, Math.min(Math.round((h * 0.56) / STEPS), Math.floor((bottom - top) / STEPS))) * STEPS;
    hud.style.setProperty('--hud-alt-h', `${trackH}px`);
    hud.style.setProperty('--hud-alt-top', `${Math.round(clamp((h - trackH) / 2, top, Math.max(top, bottom - trackH)))}px`);
    // footprint: includes the cap, the marker's exhaust and the tag
    altZone = grow(alt.getBoundingClientRect(), 16, ALT_PAD);
    drawnY = NaN;
    textClock = TEXT_INTERVAL;
    standClear();
  }

  // Runs on scroll while a CLEAR_OF element is on screen (never from the ticker).
  function standClear() {
    let over = false;
    for (const el of inSight) over ||= overlaps(el.getBoundingClientRect(), altZone);
    hud.classList.toggle('is-alt-out', over);
  }

  const isNear = (zone, p) => p.x > zone.left - NEAR && p.x < zone.right + NEAR && p.y > zone.top - NEAR && p.y < zone.bottom + NEAR;

  // ── altimeter as a slider ────────────────────────────────────────────────
  function seek(progress, smooth) {
    window.scrollTo({ top: Math.round(clamp(progress) * core.scroll.max), behavior: smooth && core.fx.enabled && !core.env.reducedMotion ? 'smooth' : 'instant' });
  }
  const progressAt = (clientY) => 1 - (clientY - drag.top) / trackH;

  /** Next ruler division `n` steps away from progress `p` (so arrows land exactly on ticks). */
  function stepFrom(p, n) {
    const units = p * STEPS;
    const slack = (1.5 * STEPS) / core.scroll.max; // scroll offsets are whole pixels
    return clamp(((n > 0 ? Math.floor(units + slack) : Math.ceil(units - slack)) + n) / STEPS);
  }

  function onTrackDown(e) {
    if (e.button !== 0) return;
    drag = { top: scale.getBoundingClientRect().top, startY: e.clientY, moved: false };
    track.setPointerCapture(e.pointerId); // keeps the drag alive (and ends it) outside the window
    hud.classList.add('is-dragging');
    seek(progressAt(e.clientY), true);
  }

  function onTrackKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const now = performance.now();
    // Quick successive presses chain from the previous destination while a smooth scroll is under way.
    const from = now - keyTime < 700 ? keyTarget : core.scroll.progress;
    let to;
    if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = 1;
    else if (e.key in KEY_STEPS) to = stepFrom(from, KEY_STEPS[e.key]);
    else return;
    e.preventDefault();
    keyTarget = to; keyTime = now;
    seek(to, true);
  }

  bar.addEventListener('animationend', () => hud.classList.remove('hud--intro'), { once: true });
  track.addEventListener('pointerdown', onTrackDown);
  track.addEventListener('keydown', onTrackKey);
  button.addEventListener('click', () => core.toggleFx());
  qs('.hud-launch', hud).addEventListener('click', () => core.emit('launch'));

  // ── read-outs (10 Hz) ────────────────────────────────────────────────────
  function refresh(now) {
    const { scroll, rocket } = core;
    hud.classList.toggle('is-flat', scroll.max < 48); // nothing to scroll → no altimeter

    const metres = Math.round(shown * APOGEE_M);
    const altitude = formatAltitude(metres);
    if (written.alt !== altitude) {
      write('alt', altitude);
      hud.classList.toggle('is-apogee', metres >= APOGEE_M);
      // ruler numbers step aside for the live tag riding the marker
      for (const n of nums) {
        const dy = (n.at - shown) * trackH; // px above the marker; the tag is taller above it than below
        const near = dy > -22 && dy < 28;
        if (near !== n.near) { n.near = near; n.el.classList.toggle('is-near', near); }
      }
    }
    // the slider reports where the page is, not the eased marker
    const value = String(Math.round(scroll.progress * APOGEE_M));
    if (written.aria !== value) {
      written.aria = value;
      track.setAttribute('aria-valuenow', value);
      track.setAttribute('aria-valuetext', `${value} metres, ${Math.round(scroll.progress * 100)}% of the page`);
    }

    write('clock', formatClock(now));
    write('vel', pad3(Math.round(finite(rocket.speed, 0) * VEL_SCALE)));
    // rocket.angle: screen-space radians, −π/2 = up → compass heading, 000 = up, clockwise
    const turn = (finite(rocket.angle, -TAU / 4) + TAU / 4) / TAU;
    write('hdg', pad3(Math.round((turn - Math.floor(turn)) * 360) % 360));
    if (rocket.boost > 0.5) boostUntil = now + BOOST_HOLD;
    const boosting = now < boostUntil;
    status.set(boosting ? STATUS.boost : STATUS.nominal);
    hud.classList.toggle('is-boost', boosting);
  }

  // ── per-frame: ease the marker, stretch the exhaust (transforms only) ─────
  function frame(dt, now) {
    const { scroll } = core;
    shown = Math.abs(scroll.progress - shown) < 0.0004 ? scroll.progress : damp(shown, scroll.progress, drag ? 26 : 9, dt);
    thrust = damp(thrust, clamp(Math.abs(scroll.velocity) / 2600), 10, dt);

    const y = Math.round(shown * trackH * core.env.dpr) / core.env.dpr; // snap to device pixels
    if (y !== drawnY) {
      drawnY = y;
      rider.style.transform = `translate3d(0,${-y}px,0)`;
      trail.style.transform = `scaleY(${y / trackH})`;
    }
    const t = Math.round(thrust * 50) / 50;
    if (t !== drawnThrust) {
      drawnThrust = t;
      exhaust.style.transform = `scaleY(${0.2 + 0.8 * t})`;
    }

    textClock += dt;
    if (textClock >= TEXT_INTERVAL) { textClock %= TEXT_INTERVAL; refresh(now); }
    target.step(dt);
    status.step(dt);
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  function onFx(enabled) {
    button.setAttribute('aria-pressed', String(enabled));
    write('fx', enabled ? 'ON' : 'OFF');
    early.textContent = `Turn visual effects ${enabled ? 'off' : 'on'}`;
    if (enabled) {
      shown = core.scroll.progress;   // resume in place, no catch-up sweep
      textClock = TEXT_INTERVAL;
      status.set(STATUS.nominal);
    } else {
      // the ticker stops with the effects: leave the bar in a clean standby state
      status.force(STATUS.off);
      target.force(NO_TARGET);
      hud.classList.remove('hud--intro', 'is-boost', 'is-locked', 'is-near-bar', 'is-near-alt');
      boostUntil = 0;
    }
  }

  const offs = [
    core.tick(frame),
    core.on('resize', measure),
    core.on('fx:change', onFx),
    core.on('scroll', () => { if (inSight.size) standClear(); }),
    core.on('lock', (detail) => {
      const el = detail && detail.el;
      target.set(el ? targetName(el) : NO_TARGET);
      hud.classList.toggle('is-locked', !!el);
    }),
    core.on('pointermove', (p) => {
      if (drag) {
        drag.moved ||= Math.abs(p.y - drag.startY) > 3; // a plain click keeps its smooth scroll
        if (drag.moved) seek(progressAt(p.y), false);
      }
      if (!core.fx.enabled || p.type === 'touch') return;
      hud.classList.toggle('is-near-bar', p.y > barTop - NEAR);
      hud.classList.toggle('is-near-alt', !compact && isNear(altZone, p));
    }),
    core.on('pointerup', () => {
      if (!drag) return;
      drag = null;
      hud.classList.remove('is-dragging');
    }),
  ];

  const keepClear = qsa(CLEAR_OF);
  if (keepClear.length && 'IntersectionObserver' in window) {
    offs.push(inView(keepClear, (visible, entry) => {
      if (visible) inSight.add(entry.target); else inSight.delete(entry.target);
      standClear();
    }, { rootMargin: '0px' }));
  }
  // Content columns change width with the layout (fonts, late styles): re-fit the ruler then too.
  if ('ResizeObserver' in window && columns.length) {
    const ro = new ResizeObserver(() => { if (compact === fitsRuler()) measure(); });
    ro.observe(columns[0]);
    offs.push(() => ro.disconnect());
  }

  measure();
  onFx(core.fx.enabled);

  return {
    destroy() {
      offs.forEach((off) => off());
      root.classList.remove('has-hud');
      hud.remove();
      early.remove();
    },
  };
}
