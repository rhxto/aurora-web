// @fx-when: [data-reveal], [data-split], [data-scramble], [data-count], [data-parallax], [data-marquee]
// @fx-order: 5
// Scroll choreography driven by data attributes (docs/ARCHITECTURE.md §3 "Declarative hooks"):
//
//   [data-reveal]    adds .is-inview once when the element enters the viewport (animations: reveal.css)
//   [data-split]     kinetic type: text wrapped in .word / .char spans that rise from a masked baseline
//   [data-scramble]  decode effect: glyphs cycle and resolve left to right into the real text
//   [data-count]     counts up from 0 to the server-rendered number
//   [data-parallax]  drifts on Y with the distance from the viewport centre
//   [data-marquee]   seamless horizontal ticker
//
// Everything hidden for a later animation is scoped under html.reveal-ready.fx-on (and, before
// this module runs, under html.fx-boot with its 2.5 s failsafe — see reveal.css), so the page is
// fully readable without JS, with effects off, or if this module never loads. With effects off
// the classes are still toggled as elements are seen, so switching effects on never replays them.
//
// Text effects never reach assistive tech: while a decode or a count rewrites an element, its
// moving text sits in an aria-hidden wrapper next to a visually hidden copy of the real text
// (see cloak()).
//
// Exports: splitText(el, mode), scramble(el, options), refresh(). scramble() works on its own:
// other modules may call it on pages where this module was never initialised.

import { core } from '../core.js';

const { clamp, damp, qsa, inView, ease } = core.utils;
const root = document.documentElement;

const STAGGER_CAP = 8;            // highest --reveal-i handed out (reveal.css multiplies it by the step)
const LATE_BOOT_MS = 500;         // booting this long after first paint: never hide what is already being read
const CURTAIN_LEAD_MS = 400;      // head start for the page-transition wall before the first reveals play
const CURTAIN_FAILSAFE_MS = 1600; // …and never wait for it longer than this
const COUNT_S = 1.6;
const SHUFFLE_S = 0.045;          // scramble glyphs change ~22 times a second, not every frame
const PARALLAX_MIN_W = 768;
const MEDIA = 'img, video, canvas, iframe, svg, picture'; // boxes that cannot host an injected child
const NAMEABLE = 'h1, h2, h3, h4, h5, h6, a, button, [role]'; // roles on which aria-label is announced

const known = new WeakSet();      // elements already wired (scan() is idempotent)
const waiting = new Map();        // element → what to do the first time it shows up
const startAt = new WeakMap();    // revealed element → performance.now() at which its animation starts
const disposers = [];
let unobserved = [];              // freshly recorded elements, not handed to an observer yet
let queue = [];                   // [element, instant] pairs collected from one observer callback
let flushQueued = false;
let covered = false;              // the page-transition wall still hides the page
let sweptY = core.scroll.y;       // scroll position at the previous scroll event

// ── kinetic type ───────────────────────────────────────────────────────────

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s));

function piece(className, text, i) {
  const span = document.createElement('span');
  span.className = className;
  if (text !== undefined) span.textContent = text;
  if (i !== undefined) span.style.setProperty('--i', i);
  return span;
}

/**
 * Hand the contents of `el` over to a text effect without a screen reader noticing: `nodes` (what
 * the effect animates) go into an aria-hidden wrapper, preceded by a visually hidden copy of the
 * element's real text. Returns the original child nodes; `el.replaceChildren(...them)` undoes it.
 */
function cloak(el, nodes = Array.from(el.childNodes)) {
  const original = Array.from(el.childNodes);
  const text = el.textContent;
  const live = piece('reveal-live');
  live.setAttribute('aria-hidden', 'true');
  live.append(...nodes);
  el.replaceChildren(piece('sr-only', text), live);
  return original;
}

/**
 * Wrap the text of `el` in spans, keeping nested inline elements and every whitespace character
 * (so textContent is unchanged and lines still break only between words).
 *   'chars' → <span class="word"><span class="char" style="--i:0">A</span>…</span>
 *   'words' → <span class="word" style="--i:0">Aurora</span>
 * Returns { words, chars }. Safe to call twice.
 */
export function splitText(el, mode = 'chars') {
  if (el.classList.contains('is-split')) return { words: qsa('.word', el), chars: qsa('.char', el) };
  const byChar = mode !== 'words';
  const label = el.textContent.replace(/\s+/g, ' ').trim();
  const words = [];
  const chars = [];
  const texts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) texts.push(walker.currentNode);

  for (const node of texts) {
    const frag = document.createDocumentFragment();
    // Split on breakable whitespace only: a no-break space stays inside its "word".
    for (const token of node.data.split(/([ \t\n\r\f]+)/)) {
      if (!token) continue;
      if (/^[ \t\n\r\f]/.test(token)) { frag.append(token); continue; }
      const word = byChar ? piece('word') : piece('word', token, words.length);
      if (byChar) for (const g of graphemes(token)) chars.push(word.appendChild(piece('char', g, chars.length)));
      words.push(word);
      frag.append(word);
    }
    node.replaceWith(frag);
  }

  // Assistive tech gets the sentence, not a string of letters. aria-label is only announced on
  // elements with a nameable role, so letter-split generic containers become role="img", and
  // word-split ones are left alone (whole words read fine as they are). Nothing to do when the
  // markup already hides the element and names an ancestor itself.
  const nameable = el.matches(NAMEABLE);
  if ((nameable || byChar) && !el.closest('[aria-hidden="true"]')) {
    if (!nameable) el.setAttribute('role', 'img');
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', label);
    for (const word of words) word.setAttribute('aria-hidden', 'true');
  }
  el.classList.add('is-split');
  return { words, chars };
}

function setupSplit(el) {
  const mode = el.dataset.split === 'words' ? 'words' : 'chars';
  const { words, chars } = splitText(el, mode);
  // Short step for letters, longer for words; long texts are compressed so the whole wave stays brief.
  const n = mode === 'words' ? words.length : chars.length;
  const step = mode === 'words' ? Math.min(55, 620 / n) : Math.min(28, 520 / n);
  el.style.setProperty('--split-step', `${step.toFixed(1)}ms`);
  // The letters start with the [data-reveal] that contains the text, or on their own when there is none.
  const host = el.closest('[data-reveal]');
  if (!host && el.dataset.revealDelay) el.style.setProperty('--reveal-delay', `${parseFloat(el.dataset.revealDelay) || 0}ms`);
  record(host || el).splits.push(el);
}

// ── reveal on enter ────────────────────────────────────────────────────────

function record(el) {
  let rec = waiting.get(el);
  if (!rec) {
    rec = { reveal: false, splits: [], scramble: false, count: null };
    waiting.set(el, rec);
    unobserved.push(el);
  }
  return rec;
}

function setupReveal(el) {
  el.style.setProperty('--reveal-delay', `${parseFloat(el.dataset.revealDelay) || 0}ms`);
  record(el).reveal = true;
}

function onIntersect(visible, entry) {
  if (!entry) {                    // no IntersectionObserver: show everything, now
    for (const el of waiting.keys()) queue.push([el, true]);
  } else if (waiting.has(entry.target)) {
    // Already scrolled past (page restored mid-way) or not rendered: it must not animate in later.
    const passed = !visible && entry.boundingClientRect.bottom <= 0;
    if (visible || passed) queue.push([entry.target, passed]);
  }
  if (!flushQueued) { flushQueued = true; queueMicrotask(flush); }
}

/** Queue every waiting element that is on screen right now. */
function queueOnScreen(instant) {
  for (const el of waiting.keys()) {
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < core.viewport.h) queue.push([el, instant]);
  }
}

/** Seconds until the reveal animation hosting `el` starts (0 when it is not waiting on one). */
function leadOf(el) {
  const at = startAt.get(el.closest('[data-reveal]'));
  return at ? Math.max(0, (at - performance.now()) / 1000) : 0;
}

const isOurs = (a) => (a.animationName || '').startsWith('reveal-') || (!!a.transitionProperty && !!a.effect?.target?.closest('.is-split-in'));

/** Reveal everything that showed up in the same observer callback as one staggered batch. */
function flush() {
  flushQueued = false;
  if (covered || !waiting.size) return;
  // The observer only fires above the bottom band of the viewport. At the very end of the page
  // (or on a page too short to scroll) nothing can rise any higher: take what is on screen.
  if (core.scroll.max - core.scroll.y < 2) queueOnScreen(false);
  if (!queue.length) return;
  const batch = [];
  for (const [el, instant] of queue) {
    const rec = waiting.get(el);
    if (!rec) continue;
    waiting.delete(el);
    batch.push({ el, rec, play: core.fx.enabled && !instant });
  }
  queue = [];
  const groupSize = new Map();

  // 1. class toggles
  for (const { el, rec, play } of batch) {
    if (rec.reveal) {
      const group = el.parentElement?.closest('[data-reveal-group]');
      const i = (group && groupSize.get(group)) || 0;
      if (group) groupSize.set(group, i + 1);
      el.style.setProperty('--reveal-i', play ? Math.min(i, STAGGER_CAP) : 0);
      if (play && el.dataset.reveal === 'clip' && !el.matches(MEDIA)) {
        const scan = piece('reveal-scan');
        scan.setAttribute('aria-hidden', 'true');
        el.append(scan);
      }
      el.classList.add('is-inview');
    }
    for (const split of rec.splits) split.classList.add('is-split-in');
    if (!play) settle(el, rec);
  }

  // 2. timing: read the animations the classes just started (one style flush for the whole batch)
  for (const { el, rec, play } of batch) {
    if (!play) continue;
    const anims = (el.getAnimations?.({ subtree: true }) || []).filter(isOurs);
    const own = anims.find((a) => a.effect.target === el);
    startAt.set(el, performance.now() + (own ? own.effect.getComputedTiming().delay : 0));
    Promise.allSettled(anims.map((a) => a.finished)).then(() => settle(el, rec));
  }

  // 3. text effects start together with the reveal that uncovers them
  for (const { el, rec, play } of batch) {
    if (rec.scramble && play) scramble(el, { wait: leadOf(el) });
    if (rec.count) { if (play) startCount(rec.count, leadOf(el)); else finishCount(rec.count); }
  }
}

/** The entrance is over: drop every temporary rule so nothing of ours lingers on the element. */
function settle(el, rec) {
  if (rec.reveal) {
    el.classList.add('is-revealed');
    for (const scan of qsa(':scope > .reveal-scan', el)) scan.remove();
  }
  for (const split of rec.splits) split.classList.add('is-split-done');
}

/** Hold the first reveals while the page-transition wall (transition.js) still covers the page. */
function awaitCurtain() {
  const cl = root.classList;
  if (!cl.contains('is-entering')) return;
  covered = true;
  let timer = setTimeout(release, CURTAIN_FAILSAFE_MS);
  const mo = new MutationObserver(check);
  mo.observe(root, { attributes: true, attributeFilter: ['class'] });
  check();

  function check() {
    if (!cl.contains('is-entering')) release();
    else if (cl.contains('transition-live')) {   // the wall has started to lift
      mo.disconnect();
      clearTimeout(timer);
      timer = setTimeout(release, CURTAIN_LEAD_MS);
    }
  }
  function release() {
    mo.disconnect();
    clearTimeout(timer);
    covered = false;
    flush();
  }
}

/**
 * A jump (anchor link, End key) can carry elements from below the viewport to above it without
 * ever intersecting. They are shown as-is, so scrolling back up never replays entrances.
 */
function onScroll() {
  const jump = Math.abs(core.scroll.y - sweptY);
  sweptY = core.scroll.y;
  if (jump > core.viewport.h * 0.75) {
    for (const el of waiting.keys()) if (el.getBoundingClientRect().bottom <= 0) queue.push([el, true]);
  }
  flush();
}

/**
 * Mark whatever is on screen right now as seen, without animating it. Used when hiding it first
 * would make content blink: effects switched on mid-visit, or a boot long after first paint.
 */
function keepOnScreen() {
  queueOnScreen(true);
  flush();
}

function bootedLate() {
  const fcp = performance.getEntriesByName?.('first-contentful-paint')[0];
  return !!fcp && performance.now() - fcp.startTime > LATE_BOOT_MS;
}

// ── scramble ───────────────────────────────────────────────────────────────

const GLYPHS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789<>/+=#',
  lower: 'abcdefghijkmnopqrstuvwxyz0123456789<>/+=#',
  digit: '0123456789',
};
const scrambles = new Map();      // element → running job
let scrambleOff = null;           // unsubscribes of the decode ticker + fx listener, while jobs are running

/** A glyph of the same class as the real one (keeps the width profile close); spaces and punctuation stay. */
function noiseFor(ch) {
  const set = /\d/.test(ch) ? GLYPHS.digit : ch.toLowerCase() === ch.toUpperCase() ? '' : ch === ch.toLowerCase() ? GLYPHS.lower : GLYPHS.upper;
  return set ? set[Math.floor(Math.random() * set.length)] : ch;
}

/** Freeze the width of an element whose text is about to be rewritten. Returns the undo. */
function lockBox(el) {
  const cs = getComputedStyle(el);
  const inline = cs.display === 'inline';
  if (inline && el.getClientRects().length !== 1) return () => {};   // wraps over several lines: leave it
  const frame = cs.boxSizing === 'border-box' ? 0
    : parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  const { display, minWidth, whiteSpace } = el.style;
  el.style.minWidth = `${el.getBoundingClientRect().width - frame}px`;
  if (inline) { el.style.display = 'inline-block'; el.style.whiteSpace = 'nowrap'; }
  return () => Object.assign(el.style, { display, minWidth, whiteSpace });
}

/**
 * Play the decode effect on `el` now (or after `wait` seconds). The original child nodes are put
 * back untouched at the end. No-op while effects are off or while the element is already decoding.
 */
export function scramble(el, { wait = 0, quick = false } = {}) {
  if (!core.fx.enabled || scrambles.has(el)) return;
  const chars = graphemes(el.textContent);
  if (!chars.length) return;
  const noise = piece('reveal-noise');
  scrambles.set(el, {
    el, chars, noise,
    head: document.createTextNode(''),
    nodes: null,                   // the original children, held while the effect runs
    unlock: null,
    t: -wait,
    lead: quick ? 0 : 0.16,        // noise-only beat before the first character resolves
    dur: clamp(0.25 + chars.length * 0.022, 0.4, 0.9) * (quick ? 0.7 : 1),
    shown: -1,
    shuffleAt: 0,
  });
  // The decode drives itself (and stops on effects off) for as long as there are jobs.
  scrambleOff ||= [
    core.tick(stepScrambles),
    core.on('fx:change', (enabled) => { if (!enabled) stopScrambles(); }),
  ];
}

/** Put the real text back everywhere, at once. */
function stopScrambles() {
  for (const job of Array.from(scrambles.values())) endScramble(job);
}

function stepScrambles(dt) {
  for (const job of scrambles.values()) {
    job.t += dt;
    if (job.t < 0) continue;
    if (!job.nodes) {
      job.unlock = lockBox(job.el);
      job.nodes = cloak(job.el, [job.head, job.noise]);
    }
    const p = (job.t - job.lead) / job.dur;
    if (p >= 1) { endScramble(job); continue; }
    const count = Math.floor(clamp(p) * job.chars.length);
    const shuffle = job.t >= job.shuffleAt;
    if (!shuffle && count === job.shown) continue;
    if (shuffle) job.shuffleAt = job.t + SHUFFLE_S;
    if (count !== job.shown) job.head.data = job.chars.slice(0, count).join('');
    job.shown = count;
    job.noise.textContent = job.chars.slice(count).map(noiseFor).join('');
  }
}

function endScramble(job) {
  scrambles.delete(job.el);
  if (job.nodes) {                 // else it never got to start
    job.el.replaceChildren(...job.nodes);
    job.unlock();
  }
  if (!scrambles.size && scrambleOff) {
    for (const off of scrambleOff) off();
    scrambleOff = null;
  }
}

function setupScramble(el) {
  record(el).scramble = true;
  if (el.dataset.scramble === 'hover') {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') scramble(el, { quick: true }); });
  }
}

// ── count up ───────────────────────────────────────────────────────────────

const NUMBER = /\d(?:[\d.,'\u00a0\u202f]*\d)?/;   // digits with optional decimal mark / thousands separators
const counts = new Set();

/** Formatter that mimics the server-rendered token: same decimals, decimal mark and grouping. */
function formatterFor(token, decimals) {
  const whole = decimals ? token.slice(0, -(decimals + 1)) : token;
  const mark = decimals ? token.charAt(whole.length) : '';
  const group = (/\D/.exec(whole) || [''])[0];
  return (v) => {
    const [int, frac] = v.toFixed(decimals).split('.');
    return (group ? int.replace(/\B(?=(\d{3})+$)/g, group) : int) + (frac ? mark + frac : '');
  };
}

function setupCount(el) {
  const target = parseFloat(el.dataset.count);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = null;
  while (!node && walker.nextNode()) if (NUMBER.test(walker.currentNode.data)) node = walker.currentNode;
  if (!node || !Number.isFinite(target)) return;

  // Only the number inside its own text node is animated: prefix, suffix and markup stay as rendered.
  const final = node.data;
  const m = NUMBER.exec(final);
  const number = formatterFor(m[0], (el.dataset.count.split('.')[1] || '').length);
  const count = {
    el, node, final, target,
    format: (v) => final.slice(0, m.index) + number(v) + final.slice(m.index + m[0].length),
    state: 'waiting',              // 'waiting' | 'running' | 'done'
    t: 0,
    nodes: null,                   // the element's own children while the zero / the running count is shown
    unlock: null,
  };
  if (core.fx.enabled) zeroCount(count);
  counts.add(count);
  record(el).count = count;
}

/** Show the counter at zero (it is waiting to come into view, or about to run). */
function zeroCount(count) {
  count.nodes ||= cloak(count.el);
  count.node.data = count.format(0);
}

/** Back to the server-rendered number and markup. */
function restoreCount(count) {
  count.node.data = count.final;
  if (count.nodes) count.el.replaceChildren(...count.nodes);
  count.nodes = null;
}

function startCount(count, wait) {
  restoreCount(count);             // measure the final width, then hold it for the whole run
  count.unlock = lockBox(count.el);
  zeroCount(count);
  count.t = -wait;
  count.state = 'running';
}

function finishCount(count) {
  restoreCount(count);
  count.unlock?.();
  count.unlock = null;
  count.state = 'done';
}

function stepCounts(dt) {
  for (const count of counts) {
    if (count.state !== 'running') continue;
    count.t += dt;
    if (count.t < 0) continue;
    const p = count.t / COUNT_S;
    if (p >= 1) { finishCount(count); continue; }
    const text = count.format(count.target * ease.outCubic(p));
    if (text !== count.node.data) count.node.data = text;
  }
}

// ── parallax ───────────────────────────────────────────────────────────────

const layers = [];                // { el, factor, mid, half, y, live }
let parallaxOn = false;
let measuredMax = -1;             // core.scroll.max at the last measurement (changes when the page grows)

function setupParallax(el) {
  const factor = parseFloat(el.dataset.parallax);
  layers.push({ el, factor: Number.isFinite(factor) ? factor : 0.15, mid: 0, half: 0, y: 0, live: false });
  measuredMax = -1;
}

function syncParallax(on = core.fx.enabled && core.env.fine && core.viewport.w >= PARALLAX_MIN_W) {
  if (parallaxOn && !on) for (const l of layers) { l.y = 0; l.live = false; l.el.style.translate = ''; }
  parallaxOn = on;
  measuredMax = -1;
}

function stepParallax(dt) {
  if (!parallaxOn || !layers.length) return;
  if (measuredMax !== core.scroll.max) {     // resize, late images, new content: re-read the offsets once
    measuredMax = core.scroll.max;
    for (const l of layers) {
      const r = l.el.getBoundingClientRect();
      l.half = r.height / 2;
      l.mid = r.top + core.scroll.y + l.half - l.y;   // page-space centre, without our own offset
    }
  }
  const reach = core.viewport.h / 2;
  const centre = core.scroll.y + reach;
  for (const l of layers) {
    const d = l.mid - centre;
    const live = Math.abs(d) < reach + l.half + 240;
    const wasLive = l.live;
    l.live = live;
    if (!live) continue;
    // Positive factor: the element lags behind the scroll (reads as further away); negative: it leads.
    const target = -d * l.factor;
    const y = !wasLive || Math.abs(target - l.y) < 0.05 ? target : damp(l.y, target, 16, dt);
    if (y === l.y) continue;
    l.y = y;
    l.el.style.translate = `0 ${y.toFixed(2)}px`;
  }
}

// ── marquee ────────────────────────────────────────────────────────────────

const marquees = [];              // { el, track, set, speed, x, period, pace, visible }

function setupMarquee(el) {
  const speed = parseFloat(el.dataset.marquee);
  const set = document.createElement('div');
  set.className = 'reveal-marquee__set';
  set.append(...el.childNodes);
  const track = document.createElement('div');
  track.className = 'reveal-marquee__track';
  track.append(set);
  el.classList.add('reveal-marquee');
  el.append(track);
  const m = { el, track, set, speed: Number.isFinite(speed) ? speed : 60, x: 0, period: 0, pace: 1, visible: false };
  marquees.push(m);
  fillMarquee(m);
  disposers.push(inView(el, (visible) => { m.visible = visible; }, { rootMargin: '0px' }));
  if ('ResizeObserver' in window) {          // logos and fonts load late and change the loop length
    const ro = new ResizeObserver(() => fillMarquee(m));
    ro.observe(set);
    disposers.push(() => ro.disconnect());
  }
}

/** Keep enough inert copies of the content to cover the box while one copy scrolls out. */
function fillMarquee(m) {
  m.period = m.set.offsetWidth;
  if (!m.period) return;
  const needed = Math.min(Math.ceil(m.el.clientWidth / m.period) + 1, 12);
  while (m.track.children.length < needed) {
    const copy = m.set.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    copy.inert = true;
    m.track.append(copy);
  }
}

function stepMarquees(dt) {
  if (!marquees.length) return;
  const rush = 1 + Math.min(Math.abs(core.scroll.velocity) / 900, 2);   // scrolling pushes the tape along
  for (const m of marquees) {
    if (!m.visible || !m.period) continue;
    m.pace = damp(m.pace, rush, 5, dt);
    m.x = (((m.x + m.speed * m.pace * dt) % m.period) + m.period) % m.period;
    m.track.style.transform = `translate3d(${(-m.x).toFixed(2)}px, 0, 0)`;
  }
}

// ── wiring ─────────────────────────────────────────────────────────────────

const HOOKS = '[data-reveal], [data-split], [data-scramble], [data-count], [data-parallax], [data-marquee]';

function scan() {
  for (const el of qsa(HOOKS)) {
    if (known.has(el)) continue;
    known.add(el);
    if (el.hasAttribute('data-marquee')) setupMarquee(el);
    if (el.hasAttribute('data-split')) setupSplit(el);
    if (el.hasAttribute('data-reveal')) setupReveal(el);
    if (el.hasAttribute('data-scramble')) setupScramble(el);
    if (el.hasAttribute('data-count')) setupCount(el);
    if (el.hasAttribute('data-parallax')) setupParallax(el);
  }
  if (unobserved.length) {
    disposers.push(inView(unobserved, onIntersect, { once: true }));
    unobserved = [];
  }
}

/** Wire hook elements added to the DOM after init (idempotent). */
export function refresh() {
  if (root.classList.contains('reveal-ready')) scan();
}

function onFxChange(enabled) {
  if (enabled) {
    keepOnScreen();
    for (const count of counts) if (count.state === 'waiting') zeroCount(count);
  } else {
    for (const count of counts) {
      if (count.state === 'running') finishCount(count);
      else if (count.state === 'waiting') restoreCount(count);
    }
    for (const m of marquees) m.track.style.transform = '';
  }
  syncParallax();
}

export default function init() {
  awaitCurtain();
  scan();
  // html.fx-boot (inline head snippet) has kept the content unpainted until now; without it the
  // page may have been on screen for a while already.
  if (!covered && !root.classList.contains('fx-boot') && bootedLate()) keepOnScreen();
  root.classList.add('reveal-ready');
  syncParallax();

  disposers.push(
    core.tick((dt) => { stepCounts(dt); stepParallax(dt); stepMarquees(dt); }),
    core.on('fx:change', onFxChange),
    core.on('scroll', onScroll),
    core.on('resize', () => { syncParallax(); marquees.forEach(fillMarquee); flush(); }),
  );

  return {
    destroy() {
      onFxChange(false);
      stopScrambles();
      syncParallax(false);
      for (const dispose of disposers.splice(0)) dispose();
      root.classList.remove('reveal-ready');
    },
  };
}
