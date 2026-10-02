// @fx-when: [data-fx="hero"]
// @fx-order: 30
// Home hero — the opening of the site (markup: templates/partials/hero.mjs).
//
//   wordmark   kinetic variable type. Each letter of AURORA / ROCKETRY sits in a fixed box and
//              reacts to the cursor rocket (core.rocket; the bare pointer when there is no rocket)
//              like a force field: near it a glyph slims along the font's width/weight axes,
//              lifts and leans away, on a damped spring coupled to its neighbours — flying across
//              the title sends a ripple through it. At rest no inline style is left on a letter.
//   intro      first page view of a session, effects on (html.hero-intro, set before first paint
//              by the inline gate in hero.mjs): the letters rise from behind their baseline while
//              condensing from narrow-light to wide-black, outwards from the launch column; the
//              horizon line draws, kicker and slogan decode, the rocket lifts off through the
//              title ('boost' + two 'burst' events). Ends with core.emit('intro:done') — which is
//              also emitted, right away, on every view that skips the sequence.
//   feed       the footage is a camera feed. Over the hero's scroll runway (html.hero-live) the
//              full-bleed picture clips down into a framed monitor window above the kicker, the
//              corner marks ride its corners and the wordmark parts and fades. The inline gate in
//              hero.mjs reserves the runway before first paint (html.hero-boot), so the page does
//              not change height when this module starts: a scroll position restored by the
//              browser, or an anchor it aimed at, stays where it is.
//   read-outs  REC / STBY tally, timecode and progress bar from the video's own clock.
//
// With effects off the hero is the static composition of components/hero.css.
// Classes: html.hero-live (taking over html.hero-boot), html.hero-wait, html.hero-intro-run,
// .hero.is-rec, .hero.is-away (off screen), .hero__title.is-awake (letters in motion).

import { core } from '../core.js';
import { scramble } from './reveal.js';

const { clamp, lerp, damp, smoothstep, qs, qsa, cssVar, inView, ease } = core.utils;
const root = document.documentElement;

const SESSION_KEY = 'aurora:intro';   // sessionStorage: the opening sequence has played (see the gate in hero.mjs)
const FONT_WAIT_MS = 900;             // longest the module waits for the web fonts before starting

// Wordmark. A letter's shape is one number s: 0 = rest (REST), 1 = THIN.
const REST = { wdth: 125, wght: 900 };
const THIN = { wdth: 62, wght: 200 };
const SHAPE_STEPS = 32;               // s is quantised: every step is one instance of the variable font (see warm())
const RESHAPES_PER_FRAME = 3;         // glyphs that may change shape in one frame (each one is re-rasterised)
const FIELD_DEPTH = 0.56;             // deepest s the force field reaches
const FIELD_RADIUS = 0.52;            // gaussian sigma, in em of the wordmark
const FIELD_LIFT = 0.075;             // em a letter rises at full strength
const FIELD_PUSH = 0.04;              // em it is pushed away sideways
const FIELD_TILT = 5;                 // degrees it leans away
const SPRING = 150;                   // stiffness, damping (under-damped: one soft overshoot) and
const DRAG = 11.5;                    // the pull between neighbouring letters that carries the ripple
const COUPLING = 60;
const REST_EPS = 0.002;               // below this a letter counts as at rest
const POSE_EPS = 0.0008;              // a letter is rewritten only when its response moved by this much

// Scroll transformation.
const MIN_WINDOW_H = 150;             // layouts that leave less room for the monitor keep the static hero
const WINDOW_RADIUS = 10;             // px (--radius-m)
const MARK_INSET = 12;                // px between the monitor edge and its corner marks
const FEED_ZOOM = 0.1;                // the footage is this much larger while full-bleed
const SHADE_LIFT = 0.66;              // share of the colour grade that is gone once the monitor is framed
const PART = 0.17;                    // the words drift apart by this share of the stage width

// Opening sequence, seconds.
const INTRO_S = 1.95;
const LETTER_S = 1;
const LETTER_RISE = 0.86;             // em below the baseline the letters start from
const IGNITION_BY = 0.55;             // latest moment of the first burst if no rocket crossed the horizon
const SEPARATION_AT = 1.2;            // second burst: the wordmark has locked in

const READOUT_S = 0.08;               // read-outs refresh at ~12 Hz
const BAR_STEPS = 56;

const span = (className) => {
  const el = document.createElement('span');
  el.className = className;
  return el;
};
const two = (n) => String(n).padStart(2, '0');
/** Seconds → "HH:MM:SS:CC" (hundredths), the footage's own clock. */
function timecode(t) {
  const s = Math.floor(t);
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}:${two(Math.floor((t - s) * 100))}`;
}
/** font-variation-settings for a quantised shape (0 = rest: no inline value at all). */
function axes(q) {
  if (!q) return '';
  const s = q / SHAPE_STEPS;
  return `'wdth' ${lerp(REST.wdth, THIN.wdth, s).toFixed(1)}, 'wght' ${Math.round(lerp(REST.wght, THIN.wght, s))}`;
}

export default function init() {
  const hero = qs('[data-fx="hero"]');
  const stage = hero && qs('.hero__stage', hero);
  const feed = hero && qs('.hero__feed', hero);
  const inner = hero && qs('.hero__inner', hero);
  const horizon = hero && qs('.hero__horizon', hero);
  const video = hero && qs('.hero__video', hero);
  const title = hero && qs('.hero__title', hero);
  if (!stage || !feed || !inner || !horizon || !video || !title) return;

  const shade = qs('.hero__shade', hero);
  const outline = qs('.hero__outline', hero);
  const cue = qs('.hero__cue', hero);
  // dir: which way the word drifts when the wordmark parts; x, y: its place on the stage at rest
  const words = qsa('.hero__word', hero).map((el, i) => ({ el, text: el.textContent, dir: i % 2 ? 1 : -1, x: 0, y: 0, shift: 0 }));
  const marks = ['tl', 'tr', 'bl', 'br'].map((corner) => ({ el: qs(`.hero__mark--${corner}`, hero), corner, dx: 0, dy: 0 })).filter((m) => m.el);
  const readout = {
    state: qs('[data-hero="state"]', hero),
    timecode: qs('[data-hero="timecode"]', hero),
    progress: qs('[data-hero="progress"]', hero),
    rec: false, bar: -1, next: 0,
  };

  // Viewports shorter than this keep the static hero. The template owns the number: its inline
  // gate applies it before first paint (without the attribute the hero simply stays static).
  const minStageH = Number(hero.dataset.minStage);
  const letters = [];        // see splitWord()
  const geo = {
    w: 0, h: 0,              // stage size
    column: 0,               // width of the content column (= of the wordmark)
    top: 0,                  // page Y of the hero
    runway: 1,               // scroll distance of the transformation
    fs: 16,                  // font size of the wordmark, px
    horizon: 0,              // stage Y of the horizon line
    win: { t: 0, r: 0, b: 0, l: 0 },   // the monitor window, as insets of the stage
  };
  let built = false;         // the wordmark has been split into letters
  let live = false;          // the scroll transformation is armed (html.hero-live)
  let onScreen = true;
  let asleep = true;         // every letter is at rest and nothing is near
  let p = 0;                 // damped scroll progress, 0 → 1
  let shown = -1;            // the progress last rendered
  let intro = null;          // { t, ignited, separated } while the opening sequence plays (t: seconds in)
  const disposers = [];

  // ── wordmark: letters ────────────────────────────────────────────────────

  /**
   * Split one word into fixed-width letter boxes. The boxes reproduce the advances of the
   * unsplit text (kerning and letter-spacing included, read per character with a Range), in em,
   * so the line is identical at rest and scales with the font size without re-measuring.
   */
  function splitWord(word, index) {
    const node = word.el.firstChild;
    if (word.el.childNodes.length !== 1 || node.nodeType !== Node.TEXT_NODE) return;
    const text = node.data;
    if (!text.trim() || /[\ud800-\udfff]/.test(text)) return;
    const fs = parseFloat(getComputedStyle(word.el).fontSize) || 16;
    const range = document.createRange();
    const edges = [];
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      edges.push(r.left);
      if (i === text.length - 1) edges.push(r.right);
    }
    const frag = document.createDocumentFragment();
    let prev = null;
    for (let i = 0; i < text.length; i++) {
      const box = span('hero__char');
      const glyph = box.appendChild(span('hero__glyph'));
      glyph.textContent = text[i];
      box.style.width = `${((edges[i + 1] - edges[i]) / fs).toFixed(5)}em`;
      frag.append(box);
      const letter = {
        glyph, word: index,
        mid: ((edges[i] + edges[i + 1]) / 2 - edges[0]) / fs,   // centre, em from the word's left edge
        w: [0, 0, 0],                                            // glyph advance at s = 0, 0.5, 1 (em)
        prev, next: null,
        v: 0, vel: 0,                                            // field response and its velocity
        delay: 0,                                                // start of its rise in the intro, s
        q: 0, tf: '',                                            // shape and transform written on the glyph
        want: 0,                                                 // shape it should have (applied within a few frames)
        x: 0, y: 0, r: 0, posed: 0,                              // offset (em), lean (deg), and the v they were computed for
      };
      if (prev) prev.next = letter;
      prev = letter;
      letters.push(letter);
    }
    word.el.replaceChildren(frag);
    word.el.classList.add('is-kinetic');
  }

  /** Split both words and learn how wide each glyph is along the REST → THIN axis. */
  function build() {
    if (built) return;
    built = true;
    words.forEach(splitWord);
    if (!letters.length) return;
    const fs = parseFloat(getComputedStyle(title).fontSize) || 16;
    [0, SHAPE_STEPS / 2, SHAPE_STEPS].forEach((q, k) => {
      for (const l of letters) l.glyph.style.fontVariationSettings = axes(q);
      for (const l of letters) l.w[k] = l.glyph.getBoundingClientRect().width / fs;
    });
    for (const l of letters) l.glyph.style.fontVariationSettings = '';
    warm();
  }

  /**
   * Instancing a variable font is the expensive part of restyling a glyph. A hidden line of the
   * wordmark's letters, set once in every step of the shape axis, makes the browser build each
   * instance up front and keeps it alive — a letter then only ever switches between ready fonts.
   */
  function warm() {
    const chars = Array.from(new Set(letters.map((l) => l.glyph.textContent))).join('');
    const rack = span('hero__warm');
    rack.setAttribute('aria-hidden', 'true');
    for (let q = 1; q <= SHAPE_STEPS; q++) {
      const sample = rack.appendChild(document.createElement('span'));
      sample.textContent = chars;
      sample.style.fontVariationSettings = axes(q);
    }
    title.append(rack);
  }

  /** The font arrived after the letters were measured: put the words back and split them again. */
  function rebuild() {
    if (!built) return;
    for (const w of words) {
      w.el.textContent = w.text;
      w.el.classList.remove('is-kinetic');
    }
    qs('.hero__warm', title)?.remove();
    letters.length = 0;
    built = false;
    setAwake(false);
    if (core.fx.enabled) arm();
  }

  /** Give a letter the shape it wants (a new font instance: the glyph is rasterised again). */
  function reshape(l) {
    l.q = l.want;
    l.glyph.style.fontVariationSettings = axes(l.q);
  }

  /** Write a letter's transform: its offset and lean, plus what keeps a narrower glyph centred in its box. */
  function place(l) {
    const s = l.q / SHAPE_STEPS;
    const width = s < 0.5 ? lerp(l.w[0], l.w[1], s * 2) : lerp(l.w[1], l.w[2], s * 2 - 1);
    const x = l.x + (l.w[0] - width) / 2;
    const still = Math.abs(x) < 0.0015 && Math.abs(l.y) < 0.0015 && Math.abs(l.r) < 0.02;
    const tf = still ? '' : `translate(${x.toFixed(3)}em,${l.y.toFixed(3)}em) rotate(${l.r.toFixed(2)}deg)`;
    if (tf !== l.tf) {
      l.tf = tf;
      l.glyph.style.transform = tf;
    }
  }

  /** While letters move, each glyph is a compositor layer; at rest the title is plain text again. */
  function setAwake(on) {
    asleep = !on;
    title.classList.toggle('is-awake', on);
  }

  function restLetters() {
    for (const l of letters) {
      l.v = l.vel = l.posed = l.want = l.x = l.y = l.r = 0;
      if (l.q) reshape(l);
      place(l);
    }
    setAwake(false);
  }

  /** Client Y of the stage: it is stuck to the viewport top along the runway, then scrolls away. */
  const stageTop = () => {
    const y = core.scroll.y - geo.top;
    return live ? clamp(y, 0, geo.runway) - y : -y;
  };

  function stepLetters(dt, t) {
    const { fs } = geo;
    const top = stageTop();
    // The rocket is the source of the field; without one (module not loaded, effects just
    // switched on) a mouse pointer is.
    const rocket = core.rocket;
    const pointer = core.pointer;
    const src = rocket.visible ? rocket
      : core.env.fine && pointer.active && pointer.inside && pointer.type !== 'touch' ? pointer : null;
    // A fast pass dents the title fully, a hovering rocket only gently; the field fades with the scroll.
    const speed = src && Number.isFinite(src.speed) ? src.speed : 0;
    const gain = src ? (0.55 + 0.45 * clamp(speed / 700)) * (1 - smoothstep(0.08, 0.5, p)) : 0;
    const sigma = FIELD_RADIUS * fs;

    if (asleep && !intro) {
      // nothing moves: wake only when the source comes within reach of the wordmark
      if (!gain) return;
      const reach = sigma * 3;
      const a = words[0], b = words[words.length - 1];
      if (src.y < top + a.y - reach || src.y > top + b.y + fs + reach || src.x < a.x - reach || src.x > a.x + geo.column + reach) return;
      setAwake(true);
    }

    let moving = false;
    for (const l of letters) {
      const word = words[l.word];
      let f = 0, lean = 0;
      if (gain) {
        const dx = word.x + word.shift + l.mid * fs - src.x;
        const dy = top + word.y + 0.42 * fs - src.y;
        f = gain * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        lean = clamp(dx / sigma, -1, 1);
      }
      const pull = (l.prev ? l.prev.v : l.v) + (l.next ? l.next.v : l.v) - 2 * l.v;
      l.vel += ((f - l.v) * SPRING + pull * COUPLING - l.vel * DRAG) * dt;
      l.v += l.vel * dt;
      if (f > REST_EPS || Math.abs(l.v) > REST_EPS || Math.abs(l.vel) > REST_EPS * 8) moving = true;

      // the intro holds the letter thin and below the baseline until its turn, then lets go
      const k = intro ? 1 - ease.outExpo(clamp((t - l.delay) / LETTER_S)) : 0;
      const v = l.v;
      if (!intro && Math.abs(v - l.posed) < POSE_EPS) continue;   // held steady by a hovering rocket: nothing new
      l.posed = v;
      l.want = Math.round(clamp(k + (1 - k) * clamp(v) * FIELD_DEPTH) * SHAPE_STEPS);
      l.x = v * lean * FIELD_PUSH;
      l.y = k * LETTER_RISE - v * FIELD_LIFT;
      l.r = v * lean * FIELD_TILT;
    }

    // Shapes: only the few glyphs that are furthest from the shape they want change in this frame
    // (the rest catch up in the next ones); transforms are free and follow every frame.
    let pending = 0;
    for (let n = 0; n < RESHAPES_PER_FRAME; n++) {
      let pick = null, gap = 0;
      for (const l of letters) {
        const d = Math.abs(l.want - l.q);
        if (d > gap) { gap = d; pick = l; }
      }
      if (!pick) break;
      reshape(pick);
    }
    for (const l of letters) {
      if (l.want !== l.q) pending++;
      place(l);
    }
    if (!moving && !pending && !intro) restLetters();
  }

  // ── geometry ─────────────────────────────────────────────────────────────

  /** Read the layout at rest. Called on init, resize and whenever the hero changes mode. */
  function measure() {
    for (const w of words) w.el.style.transform = '';
    for (const m of marks) m.el.style.transform = '';

    const sr = stage.getBoundingClientRect();
    const ir = inner.getBoundingClientRect();
    geo.w = sr.width;
    geo.h = sr.height;
    geo.column = ir.width;
    geo.top = hero.getBoundingClientRect().top + window.scrollY;
    geo.runway = Math.max(1, hero.offsetHeight - stage.offsetHeight);
    geo.fs = parseFloat(getComputedStyle(title).fontSize) || 16;
    geo.horizon = horizon.getBoundingClientRect().top - sr.top;
    for (const w of words) {
      const r = w.el.getBoundingClientRect();
      w.x = r.left - sr.left;
      w.y = r.top - sr.top;
      w.shift = 0;
    }

    // The monitor: as wide as the content column, from under the header down to the horizon line.
    const gap = clamp(geo.h * 0.028, 14, 28);
    const win = geo.win;
    win.l = ir.left - sr.left;
    win.r = sr.right - ir.right;
    win.t = (parseFloat(cssVar('--header-h')) || 68) + gap;
    win.b = geo.h - geo.horizon + gap;
    if (outline) outline.style.inset = `${win.t.toFixed(1)}px ${win.r.toFixed(1)}px ${win.b.toFixed(1)}px ${win.l.toFixed(1)}px`;
    video.style.transformOrigin = `${((win.l + geo.w - win.r) / 2).toFixed(1)}px ${((win.t + geo.h - win.b) / 2).toFixed(1)}px`;

    // each corner mark travels from its place on the full-bleed picture to its corner of the monitor
    for (const m of marks) {
      const r = m.el.getBoundingClientRect();
      const left = m.corner[1] === 'l', upper = m.corner[0] === 't';
      m.dx = left ? win.l + MARK_INSET - (r.left - sr.left) : geo.w - win.r - MARK_INSET - (r.right - sr.left);
      m.dy = upper ? win.t + MARK_INSET - (r.top - sr.top) : geo.h - win.b - MARK_INSET - (r.bottom - sr.top);
    }
    shown = -1;
  }

  const roomForMonitor = () => core.viewport.h >= minStageH && geo.h - geo.win.t - geo.win.b >= MIN_WINDOW_H;

  /**
   * Arm or disarm the scroll transformation. The runway makes the hero taller, so the page is
   * scrolled by the same amount: whatever the visitor is looking at stays in place.
   */
  function setLive(on) {
    if (on === live) return;
    const y = window.scrollY;
    const runway = hero.offsetHeight - stage.offsetHeight;   // of the layout being left (0: static)
    live = on;
    root.classList.toggle('hero-live', on);
    measure();
    if (on && !roomForMonitor()) {            // only known once the sticky layout is in place
      live = false;
      root.classList.remove('hero-live');
      measure();
      return;
    }
    const shift = on ? (y > geo.top ? geo.runway : 0) : -Math.min(runway, Math.max(0, y - geo.top));
    if (shift) window.scrollTo({ top: y + shift, behavior: 'instant' });
  }

  // ── scroll transformation ────────────────────────────────────────────────

  /** Paint progress p. Everything written here is a transform, an opacity or the clip of the feed. */
  function render() {
    shown = p;
    const e = smoothstep(0, 1, p);
    const { win } = geo;
    feed.style.clipPath = e ? `inset(${(win.t * e).toFixed(1)}px ${(win.r * e).toFixed(1)}px ${(win.b * e).toFixed(1)}px ${(win.l * e).toFixed(1)}px round ${(WINDOW_RADIUS * e).toFixed(1)}px)` : '';
    video.style.transform = live ? `scale(${(1 + FEED_ZOOM * (1 - e)).toFixed(4)})` : '';
    // the grade lifts off the picture, the frame of the monitor comes up, the cue bows out
    if (shade) shade.style.opacity = e ? (1 - SHADE_LIFT * e).toFixed(3) : '';
    if (outline) outline.style.opacity = p ? clamp((p - 0.5) * 2).toFixed(3) : '';
    if (cue) cue.style.opacity = p ? clamp(1 - p * 7).toFixed(3) : '';
    const fade = 1 - smoothstep(0.06, 0.6, p);
    for (const w of words) {
      w.shift = w.dir * PART * geo.w * e;
      w.el.style.transform = e ? `translate3d(${w.shift.toFixed(1)}px,0,0)` : '';
      w.el.style.opacity = e ? fade.toFixed(3) : '';
    }
    // the lower marks cross the kicker on their way up to the monitor: they drop out and re-acquire
    const blink = Math.max(1 - p * 6, p * 6 - 5, 0);
    for (const m of marks) {
      m.el.style.transform = e ? `translate3d(${(m.dx * e).toFixed(1)}px,${(m.dy * e).toFixed(1)}px,0)` : '';
      if (m.corner[0] === 'b') m.el.style.opacity = p ? blink.toFixed(3) : '';
    }
  }

  const progress = () => (live ? clamp((core.scroll.y - geo.top) / geo.runway) : 0);

  function stepScroll(dt) {
    const target = progress();
    p = Math.abs(target - p) < 0.0004 ? target : damp(p, target, 10, dt);
    if (p !== shown) render();
  }

  // ── read-outs ────────────────────────────────────────────────────────────

  function setTally(rec) {
    if (rec === readout.rec) return;
    readout.rec = rec;
    hero.classList.toggle('is-rec', rec);
    if (readout.state) readout.state.textContent = rec ? 'REC' : 'STBY';
  }

  function stepReadouts(now) {
    if (now < readout.next) return;
    readout.next = now + READOUT_S;
    setTally(!video.paused && !video.ended && video.readyState > 2);
    const t = video.currentTime || 0;
    const text = timecode(t);
    if (readout.timecode && readout.timecode.textContent !== text) readout.timecode.textContent = text;
    const bar = video.duration > 0 ? Math.round((t / video.duration) * BAR_STEPS) : 0;
    if (readout.progress && bar !== readout.bar) {
      readout.bar = bar;
      readout.progress.style.transform = `scaleX(${(bar / BAR_STEPS).toFixed(4)})`;
    }
  }

  // ── opening sequence ─────────────────────────────────────────────────────

  function startIntro() {
    intro = { t: 0, ignited: false, separated: false };
    root.classList.replace('hero-intro', 'hero-intro-run');
    // the wave runs outwards from the launch column (the rocket lifts off at the bottom centre),
    // the lower word first
    const half = geo.w / 2;
    for (const l of letters) {
      const word = words[l.word];
      const away = Math.abs(word.x + l.mid * geo.fs - half) / half;
      l.delay = 0.1 + away * 0.42 + (words.length - 1 - l.word) * 0.12;
    }
    setAwake(true);
    stepLetters(0, 0);              // start pose, before the hero is painted for the first time
    for (const l of letters) {      // … every letter in its starting shape at once: nothing is on screen yet
      if (l.want !== l.q) reshape(l);
      place(l);
    }
    scramble(qs('.hero__kicker', hero), { wait: 0.72 });
    scramble(qs('.hero__slogan', hero), { wait: 0.9 });
    core.emit('boost', { power: 1, duration: 1.1 });
  }

  function stepIntro(t) {
    const rocket = core.rocket;
    const line = stageTop() + geo.horizon;
    if (!intro.ignited && ((rocket.visible && rocket.y < line) || t > IGNITION_BY)) {
      // ignition: the rocket punches through the horizon line
      intro.ignited = true;
      core.emit('burst', { x: rocket.visible ? rocket.x : geo.w / 2, y: line, power: 1, color: '--c-coral' });
    }
    if (!intro.separated && t > SEPARATION_AT) {
      // the wordmark has locked in: a second, cooler pop where the rocket is now
      intro.separated = true;
      if (rocket.visible) {
        core.emit('burst', { x: rocket.x, y: rocket.y, power: 0.55, color: '--c-sky' });
        core.emit('boost', { power: 0.7, duration: 0.5 });
      }
    }
    if (t >= INTRO_S) endIntro();
  }

  function endIntro() {
    if (intro) {
      intro = null;
      root.classList.remove('hero-intro-run');
    }
    root.classList.remove('hero-intro');
    core.emit('intro:done');
  }

  // ── wiring ───────────────────────────────────────────────────────────────

  function frame(dt, now) {
    if (!onScreen) return;
    stepScroll(dt);
    // The sequence runs on the ticker's clock (dt is capped), so a slow frame while the page is
    // still loading stretches it a little instead of skipping a part of it.
    if (intro) intro.t += dt;
    if (letters.length) stepLetters(dt, intro ? intro.t : 0);
    if (intro) stepIntro(intro.t);
    stepReadouts(now);
  }

  /** Effects switched on (or the module starting with effects on). */
  function arm() {
    build();
    measure();
    setLive(roomForMonitor());
    p = progress();                 // a page restored mid-scroll starts where it is
    render();
  }

  /** Effects switched off: back to the static composition, nothing of ours left inline. */
  function disarm() {
    if (intro) endIntro();
    setLive(false);
    p = 0;
    render();
    video.style.transformOrigin = '';
    if (outline) outline.style.inset = '';
    restLetters();
    setTally(false);
  }

  function start(wantsIntro) {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* storage blocked: the sequence plays on every direct landing */ }

    if (core.fx.enabled) arm();
    else setLive(false);            // effects were switched off before the module could start
    disposers.push(
      core.tick(frame),
      core.on('resize', () => {
        if (!core.fx.enabled) return;
        measure();
        setLive(roomForMonitor());
      }),
      core.on('fx:change', (enabled) => { if (enabled) arm(); else disarm(); }),
      inView(hero, (visible) => {
        onScreen = visible;
        hero.classList.toggle('is-away', !visible);
      }, { rootMargin: '0px' }),
    );

    if (wantsIntro && core.fx.enabled && letters.length) startIntro();
    else setTimeout(endIntro, 0);   // after every module has initialised, so late subscribers hear it
  }

  // The opening sequence is only played over a hero that has never been painted: the gate asked
  // for it and html.fx-boot still holds (it is gone if this module arrives very late). The
  // letters are measured in the real font; while it loads, html.hero-wait keeps holding the hero —
  // for FONT_WAIT_MS at most: after that the module starts anyway and splits the wordmark again
  // once the font is there.
  let destroyed = false;
  let started = false;
  // The runway the gate reserved (html.hero-boot) is still in the layout: the armed layout is all
  // the visitor — and the browser's scroll restoration — has ever seen, and is taken over as it
  // is. Without it (a short viewport, the ?fx= switch, a module that arrives after the gate gave
  // up) the page is the static one, and arm() adds the runway under whatever is on screen.
  live = root.classList.contains('hero-boot');
  root.classList.toggle('hero-live', live);
  root.classList.remove('hero-boot');
  const gated = root.classList.contains('hero-intro') && root.classList.contains('fx-boot') && core.fx.enabled;
  root.classList.toggle('hero-intro', gated);
  root.classList.toggle('hero-wait', gated);
  const begin = () => {
    if (destroyed || started) return;
    started = true;
    start(gated);
    root.classList.remove('hero-wait');
  };
  const fonts = document.fonts;
  if (!fonts || fonts.status === 'loaded') begin();
  else {
    const timer = setTimeout(begin, FONT_WAIT_MS);
    fonts.ready.then(() => {
      clearTimeout(timer);
      if (started && !destroyed) rebuild(); else begin();
    });
  }

  return {
    destroy() {
      destroyed = true;
      for (const dispose of disposers.splice(0)) dispose();
      disarm();
      hero.classList.remove('is-away');
    },
  };
}
