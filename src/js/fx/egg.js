// Launch sequence — the hidden full "launch" show.
//
// Triggers: the bus event 'launch' (the HUD emits it), typing l-a-u-n-c-h anywhere, or the Konami
// code. For ~6 s a mission-control dialog counts 3 · 2 · 1 while the subsystems call GO, then
// LIFTOFF: one flash, the page shakes with decaying amplitude, the cursor rocket — which waited
// on the pad at the bottom of the screen — climbs out through the top, and fireworks ('burst') go
// off across the viewport. Escape or the Abort button skips it at any moment, and either way
// everything is left exactly as it was: the page transform and the focus are restored, and the
// scroll position never moves (the dialog swallows every scroll input).
// Not available while effects are off, nor on top of another modal surface (the figure viewer,
// the full-screen menu).
//
// Bus: listens to 'launch'; emits 'launch:pad' (the count begins), 'launch:liftoff' (T0) and
// 'launch:end' (over or aborted) for fx/rocket.js, and 'burst' for the fireworks. While the show
// runs, html.egg-live hides the HUD (egg.css): the dialog has its own clock.

import { core } from '../core.js';

const SECRETS = [
  ['l', 'a', 'u', 'n', 'c', 'h'],
  ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'],
];
const LONGEST_SECRET = Math.max(...SECRETS.map((secret) => secret.length));
// The three subsystems every Aurora rocket page documents (content/site.json → projects[].sections).
const SYSTEMS = ['Propulsion', 'Recovery', 'Electronics'];
const T0 = 3.5;             // liftoff, in seconds after the dialog opens; the count starts at T0 − 3
const SHAKE_S = 2.5;        // how long the page shakes after T0
const FADE_AT = 6.5;
const END_AT = 7;
const ABORT_FADE_MS = 450;  // .egg.is-out fades in 420 ms (egg.css)
const SHELLS = 10;          // fireworks: the first one bursts once the rocket has cleared the screen…
const FIRST_SHELL = 0.95;   // …this long after T0, then one every SHELL_GAP seconds
const SHELL_GAP = 0.2;
const CRACKLE_AFTER = 0.16; // each shell is followed by a ring of small bursts
const BURST_COLORS = ['--c-coral', '--c-amber', '--c-ink', '--c-sky', '--c-coral', '--c-amber', '--c-aurora'];
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

const DIAL =
  '<svg class="egg__dial" viewBox="0 0 200 200">' +
    '<circle cx="100" cy="100" r="99"/><circle cx="100" cy="100" r="62"/><path d="M100 0V200M0 100H200"/>' +
    '<circle class="egg__ticks" cx="100" cy="100" r="92" pathLength="360" stroke-dasharray="0.5 5.5" stroke-dashoffset="0.25"/>' +
    '<circle class="egg__ticks egg__ticks--major" cx="100" cy="100" r="90" pathLength="360" stroke-dasharray="0.8 29.2" stroke-dashoffset="0.4"/>' +
    '<line class="egg__hand" x1="100" y1="100" x2="100" y2="1"/>' +
  '</svg>';

const root = document.documentElement;
const recent = [];          // the last keys typed, to match against SECRETS
let run = null;             // the sequence in flight, or null

// ── the script of the show: [seconds, action], in chronological order ──────
const CUES = [];
for (let n = 3; n >= 1; n--) {
  CUES.push([T0 - n, () => { showCount(String(n)); say(String(n)); }]);
  CUES.push([T0 - n + 0.55, () => callGo(3 - n)]);
}
CUES.push([T0, liftoff]);
for (let i = 0; i < SHELLS; i++) {
  const at = T0 + FIRST_SHELL + i * SHELL_GAP;
  CUES.push([at, () => shell(i)], [at + CRACKLE_AFTER, () => crackle(i)]);
}
CUES.push([FADE_AT, () => run.el.classList.add('is-out')]);
CUES.push([END_AT, () => close({ fade: false })]);
CUES.sort((a, b) => a[0] - b[0]);

function showCount(text) {
  const span = document.createElement('span');   // a fresh node restarts the CSS punch-in
  span.textContent = text;
  run.count.replaceChildren(span);
}

function say(text) {
  run.live.textContent = text;
}

function callGo(i) {
  run.checks[i].classList.add('is-go');
  say(`${SYSTEMS[i]} go`);
}

function liftoff() {
  run.el.dataset.phase = 'liftoff';
  showCount('Liftoff');
  say('Liftoff');
  core.emit('launch:liftoff');
}

/** Where shell i of the salvo bursts: spread over the upper viewport with two irrational strides. */
function shellAt(i) {
  const { w, h } = core.viewport;
  return {
    x: w * (0.08 + 0.84 * ((i * 0.618 + 0.3) % 1)),
    y: h * (0.14 + 0.42 * ((i * 0.381 + 0.15) % 1)),
    color: BURST_COLORS[i % BURST_COLORS.length],
  };
}

/** The big burst of shell i. Only every other one lights up the sky: no fast flashing of large areas. */
function shell(i) {
  core.emit('burst', { ...shellAt(i), power: 2.2 + (i % 3) * 0.5, light: i % 2 === 0 });
}

/** …and its crackle: three small bursts on a ring around it. */
function crackle(i) {
  const { x, y, color } = shellAt(i);
  const reach = Math.min(core.viewport.w, core.viewport.h) * 0.11;
  for (let j = 0; j < 3; j++) {
    const a = i * 2.4 + j * 2.09;
    core.emit('burst', { x: x + Math.cos(a) * reach, y: y + Math.sin(a) * reach, power: 0.6, color, light: false });
  }
}

// ── per-frame: cues, mission clock, dial, page shake ───────────────────────
function frame(dt) {
  run.t += dt;
  while (run && run.cue < CUES.length && CUES[run.cue][0] <= run.t) CUES[run.cue++][1]();
  if (!run) return;                                   // the last cue ended the show

  const rel = run.t - T0;                             // mission time: negative before liftoff
  const abs = Math.min(3, Math.abs(rel));             // the clock holds at T−3 until the count starts
  const cs = Math.floor(abs * 100);
  run.clock.textContent = `T${rel < 0 ? '−' : '+'}00:0${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
  if (rel < 0) run.stage.style.setProperty('--p', (rel > -3 ? (rel + 3) % 1 : 0).toFixed(3));
  else if (!run.spent) trackPlume();

  if (!run.page || rel < 0) return;
  if (rel >= SHAKE_S) { restorePage(run); return; }   // settled: hand the page back early
  // Decaying rumble: a few incommensurate sines (smooth per frame, never periodic to the eye).
  const amp = run.amp * Math.exp(-1.7 * rel) * (1 - rel / SHAKE_S);
  const x = amp * (Math.sin(rel * 83) + 0.5 * Math.sin(rel * 131 + 1));
  const y = amp * (Math.cos(rel * 97) + 0.5 * Math.sin(rel * 151 + 2));
  const r = (amp / run.amp) * 0.22 * Math.sin(rel * 61);
  run.page.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${r.toFixed(3)}deg)`;
}

/**
 * The exhaust column stands on the bottom edge and reaches up to the cursor rocket as it climbs
 * (fx/rocket.js flies it; without that module the column simply shoots up). Once the rocket is
 * out of the top, the column is spent: egg.css widens and fades it.
 */
function trackPlume() {
  const { rocket, viewport } = core;
  const flying = rocket.visible && core.modules.rocket;
  const reach = flying ? 1 - rocket.y / viewport.h : 1;
  run.trail.style.transform = `scaleY(${Math.min(1, Math.max(0, reach)).toFixed(4)})`;
  if (!flying || reach >= 1) {
    run.spent = true;
    run.trail.style.transform = '';
    run.trail.classList.add('is-spent');
  }
}

/** Put the shaken .page back exactly as it was, down to a style attribute it never had. */
function restorePage(show) {
  const { page } = show;
  if (!page) return;
  page.style.transform = show.pageTransform;
  if (!show.pageStyled && !page.getAttribute('style')) page.removeAttribute('style');
  show.page = null;
}

// ── open / close ───────────────────────────────────────────────────────────
function start() {
  if (run || !core.fx.enabled) return;
  // One modal at a time: two dialogs would fight over focus, Escape and the screen.
  if (root.classList.contains('lightbox-open') || root.classList.contains('menu-open')) return;

  const el = document.createElement('div');
  el.className = 'egg';
  el.dataset.phase = 'count';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Launch sequence');
  el.innerHTML =
    '<div class="egg__scrim"></div><div class="egg__trail"></div><div class="egg__flash"></div>' +
    '<div class="egg__frame"><i></i><i></i><i></i><i></i></div>' +
    '<p class="egg__title" aria-hidden="true">Launch sequence</p>' +
    '<button class="egg__close" type="button" aria-label="Abort launch sequence">Abort <kbd>Esc</kbd></button>' +
    `<div class="egg__stage" aria-hidden="true"><div class="egg__sweep"></div>${DIAL}<div class="egg__band"></div><div class="egg__count"></div></div>` +
    `<ul class="egg__checks" aria-hidden="true">${SYSTEMS.map((name) => `<li>${name}<b>Go</b></li>`).join('')}</ul>` +
    '<p class="egg__clock" aria-hidden="true"></p>' +
    '<p class="egg__live" aria-live="assertive"></p>';

  const page = document.querySelector('.page');
  const closeBtn = el.querySelector('.egg__close');
  run = {
    el, closeBtn,
    stage: el.querySelector('.egg__stage'),
    count: el.querySelector('.egg__count'),
    clock: el.querySelector('.egg__clock'),
    live: el.querySelector('.egg__live'),
    checks: el.querySelectorAll('.egg__checks li'),
    trail: el.querySelector('.egg__trail'),
    t: 0, cue: 0, spent: false,
    amp: core.env.coarse ? 7 : 14,                    // px; gentler on small touch screens
    // everything that must be put back
    page, pageTransform: page ? page.style.transform : '', pageStyled: !!page?.hasAttribute('style'),
    focus: document.activeElement,
    stop: null,
  };

  closeBtn.addEventListener('click', () => close({ fade: true }));
  // It is a modal: the page behind it cannot be scrolled (wheel, touch, and scroll keys in
  // onKeydown), so the scroll position needs no restoring; backdrop clicks keep the focus.
  const block = (e) => e.preventDefault();
  el.addEventListener('wheel', block, { passive: false });
  el.addEventListener('touchmove', block, { passive: false });
  el.addEventListener('mousedown', (e) => { if (e.target !== closeBtn) e.preventDefault(); });

  document.body.append(el);
  root.classList.add('egg-live');
  closeBtn.focus({ preventScroll: true });
  run.stop = core.tick(frame);
  core.emit('launch:pad');
}

function close({ fade }) {
  if (!run) return;
  const show = run;
  const { el, focus } = show;
  run = null;
  show.stop();
  restorePage(show);
  root.classList.remove('egg-live');
  core.emit('launch:end');

  // (The HUD is visible again as soon as html.egg-live is gone — egg.css — so this also works
  // when the show was started from its LAUNCH button.)
  if (focus instanceof HTMLElement && focus.isConnected && focus !== document.body) focus.focus({ preventScroll: true });
  else show.closeBtn.blur();

  if (fade && core.fx.enabled) {
    el.setAttribute('aria-hidden', 'true');
    el.classList.add('is-out');                       // CSS fades it and stops it catching input
    setTimeout(() => el.remove(), ABORT_FADE_MS);
  } else {
    el.remove();
  }
}

// ── keyboard ───────────────────────────────────────────────────────────────
const isEditable = (node) => node instanceof HTMLElement && (node.isContentEditable || !!node.closest('input, textarea, select'));

function onKeydown(e) {
  if (run) {
    if (e.key === 'Escape') { e.preventDefault(); close({ fade: true }); return; }
    // Trap focus on the only control and keep scroll keys away from the page (Space/Enter on the
    // button itself still press it).
    if (e.key === 'Tab' || (SCROLL_KEYS.has(e.key) && !(e.key === ' ' && e.target === run.closeBtn))) {
      e.preventDefault();
      run.closeBtn.focus({ preventScroll: true });
    }
    return;
  }
  // Typing somewhere, a shortcut, or a key-less event (autofill): not a secret in the making.
  if (!e.key || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || isEditable(e.target)) { recent.length = 0; return; }
  recent.push(e.key.toLowerCase());
  if (recent.length > LONGEST_SECRET) recent.shift();
  if (SECRETS.some((secret) => secret.every((key, i) => recent[recent.length - secret.length + i] === key))) {
    recent.length = 0;
    if (core.fx.enabled) core.emit('launch');
  }
}

export default function init() {
  document.addEventListener('keydown', onKeydown);
  const offs = [
    core.on('launch', start),
    core.on('fx:change', (enabled) => { if (!enabled) close({ fade: false }); }),
  ];

  return {
    destroy() {
      document.removeEventListener('keydown', onKeydown);
      for (const off of offs) off();
      close({ fade: false });
      recent.length = 0;
    },
  };
}
