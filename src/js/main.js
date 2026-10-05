// Bootstrap: site chrome (header state, mobile menu, hero video) and the FX module loader.
// Effects live in ./fx/<name>.js and are discovered through ./fx-registry.js (written by
// build.mjs) — nothing in this file knows about any particular effect.

import { core } from './core.js';

const { qs, qsa, inView } = core.utils;
const root = document.documentElement;

// ── header ─────────────────────────────────────────────────────────────────
/** The header turns into a blurred bar once the page has scrolled under it. */
function initHeader() {
  const header = qs('[data-header]');
  if (!header) return;
  const update = () => header.classList.toggle('is-scrolled', core.scroll.y > 12);
  core.on('scroll', update);
  update();
}

// ── mobile menu ────────────────────────────────────────────────────────────
/**
 * Full-screen menu behind the toggle button: aria-expanded, Escape to close, focus kept inside
 * the header while open, page scroll locked (html.menu-open) and the rest of the page inert.
 */
function initMenu() {
  const toggle = qs('[data-menu-toggle]');
  const menu = qs('[data-menu]');
  const header = qs('[data-header]');
  if (!toggle || !menu || !header) return;

  const outside = qsa('main, .site-footer, #fx-hud');
  const isOpen = () => root.classList.contains('menu-open');
  const visible = (el) => el.getClientRects().length > 0;
  const focusables = () => qsa('a[href], button', header).filter(visible);

  function setOpen(open, { focus = true } = {}) {
    if (open === isOpen()) return;
    root.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    for (const el of outside) el.inert = open;
    if (focus) (open ? qs('a[href]', menu) : toggle)?.focus();
  }

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false, { focus: false }); });

  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key !== 'Tab') return;
    // Wrap focus around the header controls (logo, toggle, menu links).
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // The toggle only exists on narrow screens: never leave the menu open behind a desktop layout,
  // nor when the page is restored from the back/forward cache.
  window.matchMedia('(min-width: 861px)').addEventListener('change', (e) => { if (e.matches) setOpen(false, { focus: false }); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) setOpen(false, { focus: false }); });
}

// ── carousels ─────────────────────────────────────────────────────────────
/** Previous/next buttons for horizontal strips ([data-carousel] > [data-carousel-track]). */
function initCarousels() {
  for (const box of qsa('[data-carousel]')) {
    const track = qs('[data-carousel-track]', box);
    const prev = qs('[data-carousel-prev]', box);
    const next = qs('[data-carousel-next]', box);
    if (!track || !prev || !next) continue;
    const step = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: core.fx.enabled ? 'smooth' : 'auto' });
    const sync = () => {
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    track.addEventListener('scroll', sync, { passive: true });
    core.on('resize', sync);
    sync();
  }
}

// ── hero video ─────────────────────────────────────────────────────────────
/**
 * The hero <video> ships with data-src only. It is fetched and played when motion is welcome
 * (effects on, no reduced-motion preference, no Save-Data) and paused while off screen;
 * otherwise the poster image stays. Started after the effect modules: a 7 MB download must not
 * compete with the scripts the first screen is waiting for.
 */
function initHeroVideo() {
  const video = qs('.hero__video[data-src]');
  if (!video) return;
  let onScreen = false;
  const allowed = () => core.fx.enabled && !core.env.reducedMotion && !core.env.saveData;
  const sync = () => {
    if (allowed() && onScreen) {
      if (!video.getAttribute('src')) video.src = video.dataset.src;
      // Autoplay can be refused (e.g. low-power mode): the poster simply stays.
      video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  };
  inView(video, (visible) => { onScreen = visible; sync(); }, { rootMargin: '0px' });
  core.on('fx:change', sync);
}

// ── FX modules ─────────────────────────────────────────────────────────────
/** Debug switch: ?fx=none loads no effect module, ?fx=sky,rocket loads only those. */
function fxFilter() {
  const param = new URLSearchParams(location.search).get('fx');
  if (param === null) return () => true;
  const names = new Set(param.split(',').map((n) => n.trim()).filter(Boolean));
  return (name) => !names.has('none') && names.has(name);
}

function matches(selector) {
  if (!selector) return true;
  try { return document.querySelector(selector) !== null; } catch { return true; } // invalid selector: load anyway
}

/**
 * Imports every registered module this page needs (in parallel) and runs their default export
 * in registry order. A missing registry, a module that fails to load or one that throws is
 * reported and skipped — it never takes the page or the other effects down.
 */
async function loadFx() {
  const wanted = fxFilter();
  let registry;
  try {
    registry = (await import('./fx-registry.js')).default;
  } catch {
    return; // no registry: the site simply runs without effects
  }
  const modules = registry
    .filter((m) => wanted(m.name) && matches(m.when))
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  const loaded = await Promise.allSettled(modules.map((m) => import(`./fx/${m.name}.js`)));
  loaded.forEach((result, i) => {
    const { name } = modules[i];
    if (result.status === 'rejected') {
      console.error(`[fx] "${name}" failed to load`, result.reason);
      return;
    }
    const fail = (err) => console.error(`[fx] "${name}" failed to start`, err);
    try {
      const started = typeof result.value.default === 'function' ? result.value.default() : null;
      if (started && typeof started.catch === 'function') started.catch(fail); // async init
      core.modules[name] = started || {};
    } catch (err) {
      fail(err);
    }
  });
}

initHeader();
initMenu();
initCarousels();
// html.fx-boot (inline head snippet) kept animated content unpainted until now: every module has
// taken over its own initial states in this same task, so the hand-over is never visible.
loadFx().finally(() => {
  root.classList.remove('fx-boot');
  initHeroVideo();
});
