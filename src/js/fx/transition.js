// @fx-order: 1
// Page transitions — the "ignition curtain" that turns the 17 static pages into one flight.
//
// EXIT   a click on a same-origin page link is intercepted: a dark wall rises behind a blazing
//        plume front, a read-out names the destination, then the browser navigates for real.
// ENTER  the next page is born covered (html.is-entering, pure CSS in transition.css, set by the
//        inline head snippet) and this module lifts the wall off the top.
//
// The motion itself is CSS keyframes on transform/opacity (see transition.css): they run on the
// compositor, so the curtain stays smooth while the main thread unloads one page and boots the
// next. This file only drives the state machine: idle → exit → (navigation) → enter → idle.
//
// A link clicked while the wall is still lifting is queued: the lift is hurried along and the
// exit starts the moment the page is uncovered, so every navigation gets its curtain.
//
// State other code may read: html.is-leaving (exit running / waiting for the next page),
// html.is-entering (page still covered), html.is-entering.transition-live (the wall is lifting).
// Bus: emits 'navigate:start' { href } when an exit begins and 'navigate:cancel' when the page
// is still (or again) here afterwards — a stalled navigation, or a return through the
// back/forward cache — so the rocket and the sky can come back from their exit.

import { core } from '../core.js';

const FLAG = 'aurora:nav';        // sessionStorage: "the next page load arrives through the curtain";
                                  // read and removed by the inline head snippet (layout.mjs)
const EXIT_FAILSAFE_MS = 550;     // exit keyframes last 460 ms; navigate anyway after this
const ENTER_FAILSAFE_MS = 900;    // enter keyframes last 620 ms; clean up anyway after this
const CSS_FAILSAFE_MS = 1200;     // the pure-CSS failsafe (transition.css) waits this long …
const CSS_FAILSAFE_SLIDE_MS = 520; // … then slides the cover away in this time
const STALL_MS = 6000;            // the navigation never happened (download, 204, cancelled): uncover
const HURRY = 2.4;                // playback rate of the lift while a navigation is queued behind it
const SPARKS = 18;
const GLYPHS = 'ABCDEFGHKLMNPRSTUVXYZ0123456789-';

const root = document.documentElement;
const { rand, pick, clamp, garble } = core.utils;

let layer = null;                 // built lazily: most page views never need it
let rig, dest;
let state = 'idle';               // 'idle' | 'exit' | 'enter'
let pendingHref = '';             // where the running exit is heading
let queued = null;                // URL clicked while the wall was lifting: leave once it is gone
let timer = 0;                    // the one failsafe timer of the current state
let stopScramble = null;

// ── eligibility ────────────────────────────────────────────────────────────

const samePage = (url) => url.pathname === location.pathname && url.search === location.search;

/**
 * The URL to animate to, or null when the browser must handle the navigation natively:
 * other origins and schemes (mailto:, tel:), in-page anchors, and files that are not pages.
 */
function pageUrl(href) {
  let url;
  try { url = new URL(href, location.href); } catch { return null; }
  if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return null;
  if (samePage(url) && String(href).includes('#')) return null;     // "#top", "/here/#team", bare "#"
  if (/\.(?!html?$)\w+$/i.test(url.pathname)) return null;          // .pdf, .jpg, .xml … not a page
  return url;
}

/** Same as pageUrl() for an anchor element, honouring target / download / data-no-transition. */
function linkUrl(a) {
  if (!(a instanceof HTMLAnchorElement)) return null;
  if ((a.target && a.target !== '_self') || a.hasAttribute('download') || a.closest('[data-no-transition]')) return null;
  return pageUrl(a.getAttribute('href'));
}

const anchorOf = (e) => (e.target instanceof Element ? e.target.closest('a[href]') : null);

// ── the layer ──────────────────────────────────────────────────────────────

function mount() {
  if (layer) return;
  let sparks = '';
  for (let i = 0; i < SPARKS; i++) {
    sparks += `<i style="--x:${rand(1, 99).toFixed(1)}%;--w:${pick([1, 2, 2])}px;--h:${rand(18, 90) | 0}px;` +
      `--rise:${rand(8, 30) | 0}vh;--d:${rand(260, 420) | 0}ms;--delay:${rand(0, 180) | 0}ms"></i>`;
  }
  layer = document.createElement('div');
  layer.className = 'transition';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML =
    '<div class="transition__rig">' +
      `<div class="transition__front"><div class="transition__sparks">${sparks}</div></div>` +
      '<div class="transition__wall">' +
        '<div class="transition__lines"></div><div class="transition__streaks"></div><div class="transition__heat"></div>' +
        '<div class="transition__readout"><span>Vectoring</span><span class="transition__arrow">→</span><span class="transition__dest"></span></div>' +
      '</div>' +
      '<div class="transition__exhaust"></div>' +
    '</div>';
  rig = layer.querySelector('.transition__rig');
  dest = layer.querySelector('.transition__dest');
  // The last keyframe of each phase advances the state machine (timers are only failsafes).
  layer.addEventListener('animationend', (e) => {
    if (e.target !== rig) return;
    if (e.animationName === 'transition-rise') navigate();
    else if (e.animationName === 'transition-leave') settle();
  });
  document.body.append(layer);
}

function setState(next) {
  state = next;
  if (layer) layer.dataset.state = next;
  root.classList.toggle('is-leaving', next === 'exit');
}

function clearFlag() {
  try { sessionStorage.removeItem(FLAG); } catch { /* storage blocked: there was no flag either */ }
}

// ── read-out ───────────────────────────────────────────────────────────────

/** "/projects/nemesis/" → "/PROJECTS/NEMESIS", without the --base prefix (the home page reads "/HOME"). */
function destinationLabel(url) {
  const { base } = core.env;
  const local = base && (url.pathname === base || url.pathname.startsWith(`${base}/`)) ? url.pathname.slice(base.length) : url.pathname;
  const path = local.replace(/(\/index)?\.html?$/, '').replace(/\/$/, '');
  return (path || '/home').toUpperCase();
}

/** Decode `text` into `el` left to right, telemetry style. Returns a function that stops it. */
function scramble(el, text, delay, duration) {
  let t = -delay;
  let shown = -1;
  const stop = core.tick((dt) => {
    t += dt;
    const step = Math.floor(t / 0.035);              // new glyphs every 35 ms, not every frame
    if (t < 0 || step === shown) return;
    shown = step;
    const fixed = Math.floor(clamp(t / duration) * text.length);
    el.textContent = garble(text, fixed, GLYPHS, '/');
    if (fixed === text.length) stop();
  });
  return stop;
}

// ── exit ───────────────────────────────────────────────────────────────────

/** Start the exit toward `url` — or queue it behind a lift that is still running. */
function leave(url) {
  if (state === 'exit') return;
  if (state === 'enter') {
    queued = url;
    for (const anim of layer.getAnimations?.({ subtree: true }) || []) anim.playbackRate = HURRY;
    return;
  }
  mount();
  clearTimeout(timer);
  pendingHref = url.href;
  core.emit('navigate:start', { href: pendingHref });
  dest.textContent = '';
  stopScramble?.();
  stopScramble = scramble(dest, destinationLabel(url), 0.16, 0.24);
  setState('exit');
  timer = setTimeout(navigate, EXIT_FAILSAFE_MS);
}

function navigate() {
  if (!pendingHref) return;
  const href = pendingHref;
  pendingHref = '';
  clearTimeout(timer);
  try { sessionStorage.setItem(FLAG, '1'); } catch { /* the next page simply appears uncovered */ }
  location.assign(href);
  timer = setTimeout(stalled, STALL_MS);   // still here after all this time: give the page back
}

/** The navigation never happened (download, 204, cancelled): uncover the page we are still on. */
function stalled() {
  core.emit('navigate:cancel');
  reveal();
}

// ── enter ──────────────────────────────────────────────────────────────────

/** Lift the wall off whatever is covered right now (a fresh page, or this one after a stall). */
function reveal() {
  clearFlag();
  clearTimeout(timer);
  mount();
  setState('enter');
  root.classList.add('transition-live');           // swaps the CSS-only cover for the real layer
  timer = setTimeout(settle, ENTER_FAILSAFE_MS);
}

/** Back to idle: nothing covers the page. A navigation queued behind the lift starts now. */
function settle() {
  clearTimeout(timer);
  pendingHref = '';
  stopScramble?.();
  stopScramble = null;
  setState('idle');
  root.classList.remove('is-entering', 'transition-live');
  if (queued) {
    const url = queued;
    queued = null;
    leave(url);
  }
}

/** settle() without honouring the queue (effects went off, or the page came back from history). */
function reset() {
  queued = null;
  settle();
}

/** True once the pure-CSS failsafe has begun sliding the cover away by itself (we booted late). */
function cssFailsafeStarted() {
  const anim = document.getAnimations?.().find((a) => a.animationName === 'transition-failsafe');
  return anim ? anim.currentTime >= CSS_FAILSAFE_MS : performance.now() > CSS_FAILSAFE_MS;
}

function arrive() {
  clearFlag();   // normally gone already (the head snippet consumes it); harnesses may lack the snippet
  if (!root.classList.contains('is-entering')) return;
  if (!core.fx.enabled) settle();
  else if (cssFailsafeStarted()) timer = setTimeout(settle, CSS_FAILSAFE_SLIDE_MS + 80);   // let it finish, then tidy up
  else reveal();
}

// ── prefetch ───────────────────────────────────────────────────────────────

const pageKey = (url) => url.origin + url.pathname + url.search;
const prefetched = new Set([pageKey(location)]);

function prefetch(e) {
  const url = linkUrl(anchorOf(e));
  if (!url || prefetched.has(pageKey(url))) return;
  prefetched.add(pageKey(url));
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = pageKey(url);
  document.head.append(link);
}

// ── wiring ─────────────────────────────────────────────────────────────────

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!core.fx.enabled) return;                        // plain navigation
  const url = linkUrl(anchorOf(e));
  if (!url) return;
  e.preventDefault();
  // A link to the page we are on (its own nav entry, the logo on the home page): the destination
  // is the top of this page — no curtain and no reload to end up where we already are.
  if (samePage(url)) window.scrollTo({ top: 0 });
  else leave(url);
}

/** Navigate to `href` through the curtain (plain navigation when the transition does not apply). */
export function go(href) {
  const url = core.fx.enabled ? pageUrl(href) : null;
  if (url) leave(url);
  else location.assign(href);
}

/**
 * Back/forward cache: the page comes back exactly as it was left — covered, its rocket gone.
 * Uncover it at once and tell the other modules the exit is off.
 */
function onPageShow(e) {
  if (!e.persisted) return;
  clearFlag();
  reset();
  core.emit('navigate:cancel');
}

export default function init() {
  document.addEventListener('click', onClick);
  if (!core.env.saveData) {
    document.addEventListener('pointerover', prefetch, { passive: true });
    document.addEventListener('touchstart', prefetch, { passive: true });
    document.addEventListener('focusin', prefetch);
  }
  window.addEventListener('pageshow', onPageShow);
  // Effects switched off mid-flight: drop the curtain, but never drop the navigation itself.
  const offFx = core.on('fx:change', (enabled) => {
    if (enabled) return;
    const href = pendingHref || (queued ? queued.href : '');
    reset();
    if (href) location.assign(href);
  });
  arrive();

  return {
    destroy() {
      document.removeEventListener('click', onClick);
      document.removeEventListener('pointerover', prefetch);
      document.removeEventListener('touchstart', prefetch);
      document.removeEventListener('focusin', prefetch);
      window.removeEventListener('pageshow', onPageShow);
      offFx();
      reset();
      layer?.remove();
      layer = null;
    },
  };
}
