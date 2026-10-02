// @fx-when: main .frame img
// @fx-order: 60
// Lightbox for content figures (the .frame markup of lib.mjs frame(), on any page).
//
// Every figure gets a real <button> over its image (keyboard reachable, named after the alt
// text) — except figures inside a [data-no-zoom] element (the attribute may sit on the figure or
// on any ancestor): a page opts out there when enlarging adds nothing or the figure has its own
// interaction. It opens the full-size image — the plain `src`, not the 800px variant — in a modal
// dialog: focus is trapped and restored, the page behind is inert and cannot scroll, Escape /
// the close button / the backdrop close it, arrow keys / buttons / a horizontal swipe step
// through the page's figures (a swipe down closes), and the page scrolls along underneath so
// closing always lands on the figure being viewed. On touch screens the browser's own pinch-zoom
// stays available for a closer look at a dense plot; swipes are ignored while zoomed in.
//
// Open and close are a FLIP zoom from / to the thumbnail, transform only: the frame is scaled
// to the thumbnail's box while the image inside is counter-scaled, so a cropped photo grows out
// of its crop without distortion. With effects off it simply appears. The dialog sits above the
// cursor rocket and the HUD (z-index --z-modal) and is excluded from the rocket's lock-on.
//
// State other code may read: html.lightbox-open; bus events 'lightbox:open' { index } and
// 'lightbox:close'.

import { core } from '../core.js';

const { clamp, qs, qsa } = core.utils;
const root = document.documentElement;

const ZOOM_MS = 520;
const CLOSE_MS = 380;
const FLIP_STEPS = 24;        // keyframes of the zoom (the counter-scale needs them)
const MAX_UPSCALE = 1.25;     // small images are never blown up beyond this
const SWIPE_PX = 48;
const BACKGROUND = 'main, .site-header, .site-footer, #fx-hud, .dept-rail';   // everything interactive behind the dialog
const SCROLL_KEYS = new Set([' ', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

const ICONS = {
  expand: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9.5 1.5h5v5M14.5 1.5l-5 5M6.5 14.5h-5v-5M1.5 14.5l5-5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  prev: '<svg viewBox="0 0 24 12" aria-hidden="true" focusable="false"><path d="M24 6H2M7 1 2 6l5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  next: '<svg viewBox="0 0 24 12" aria-hidden="true" focusable="false"><path d="M0 6h22M17 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  close: '<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M1 1l12 12M13 1 1 13" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};

const pad2 = (n) => String(n).padStart(2, '0');
const outQuart = (t) => 1 - (1 - t) ** 4;
const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export default function init() {
  const items = qsa('main .frame').map((frame) => {
    if (frame.closest('[data-no-zoom]')) return null;
    const media = qs('.frame__media', frame);
    const img = media && qs('img', media);
    const w = img ? Number(img.getAttribute('width')) : 0;
    const h = img ? Number(img.getAttribute('height')) : 0;
    if (!img || !(w > 0) || !(h > 0)) return null;
    return { frame, media, img, w, h, src: img.getAttribute('src'), text: img.alt, tag: qs('.frame__tag', frame)?.textContent.trim() || '', button: null };
  }).filter(Boolean);
  if (!items.length) return;

  // ── triggers ─────────────────────────────────────────────────────────────
  for (const [i, item] of items.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lightbox-trigger';
    button.setAttribute('aria-label', `Enlarge image: ${item.text}`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('data-no-lock', '');
    button.innerHTML = `<span class="lightbox-trigger__icon">${ICONS.expand}</span>`;
    button.addEventListener('click', () => open(i));
    item.media.append(button);
    item.button = button;
  }

  // ── dialog (built on first use) ──────────────────────────────────────────
  let ui = null;
  let index = -1;
  let isOpen = false;
  let closing = false;
  let finishClose = null;          // while the close animation runs: ends it at once
  let zoom = null;                 // running FLIP animations [outer, inner]
  let loadToken = 0;
  let inerted = [];
  let swipe = null;                // { x, y } while a single finger is down outside the controls

  function build() {
    const el = document.createElement('div');
    el.className = 'lightbox';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Image viewer');
    el.setAttribute('data-no-lock', '');
    el.innerHTML = `<div class="lightbox__backdrop"></div>
<div class="lightbox__frame"><img class="lightbox__img" alt="" decoding="async" draggable="false"></div>
<span class="corners lightbox__corners" aria-hidden="true"></span>
<p class="lightbox__status" role="status"></p>
<p class="lightbox__count" aria-hidden="true"></p>
<p class="lightbox__caption" aria-hidden="true"><span class="lightbox__tag"></span><span class="lightbox__text"></span></p>
<button type="button" class="lightbox__btn lightbox__btn--prev" aria-label="Previous image">${ICONS.prev}</button>
<button type="button" class="lightbox__btn lightbox__btn--next" aria-label="Next image">${ICONS.next}</button>
<button type="button" class="lightbox__btn lightbox__btn--close" aria-label="Close image viewer">${ICONS.close}</button>`;
    document.body.append(el);
    ui = {
      el,
      backdrop: qs('.lightbox__backdrop', el),
      frame: qs('.lightbox__frame', el),
      img: qs('.lightbox__img', el),
      status: qs('.lightbox__status', el),
      count: qs('.lightbox__count', el),
      caption: qs('.lightbox__caption', el),
      tag: qs('.lightbox__tag', el),
      text: qs('.lightbox__text', el),
      prev: qs('.lightbox__btn--prev', el),
      next: qs('.lightbox__btn--next', el),
      close: qs('.lightbox__btn--close', el),
    };
    el.classList.toggle('lightbox--single', items.length < 2);
    ui.backdrop.addEventListener('click', close);
    ui.close.addEventListener('click', close);
    ui.prev.addEventListener('click', () => step(-1));
    ui.next.addEventListener('click', () => step(1));
    el.addEventListener('keydown', onKey);
    // Scroll lock without touching the layout: nothing under the dialog may scroll.
    el.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', () => { swipe = null; }, { passive: true });
  }

  // ── geometry ─────────────────────────────────────────────────────────────
  /** Where the image rests: as large as the viewport allows, clear of the caption and controls. */
  function restBox(item) {
    const { w: vw, h: vh } = core.viewport;
    const wide = vw >= 720;
    const padX = wide ? 88 : 12;
    const padTop = wide ? 64 : 60;
    const padBottom = wide ? 92 : 132;
    const scale = Math.min((vw - 2 * padX) / item.w, (vh - padTop - padBottom) / item.h, MAX_UPSCALE);
    const w = Math.round(item.w * scale), h = Math.round(item.h * scale);
    return { x: Math.round((vw - w) / 2), y: Math.round(padTop + (vh - padTop - padBottom - h) / 2), w, h };
  }

  function layout(item) {
    const box = restBox(item);
    const s = ui.el.style;
    s.setProperty('--lb-x', `${box.x}px`);
    s.setProperty('--lb-y', `${box.y}px`);
    s.setProperty('--lb-w', `${box.w}px`);
    s.setProperty('--lb-h', `${box.h}px`);
    return box;
  }

  /** The thumbnail's box if any of it is on screen, else null. */
  function thumbBox(item) {
    const r = item.img.getBoundingClientRect();
    const { w, h } = core.viewport;
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  // ── content ──────────────────────────────────────────────────────────────
  function show(i) {
    const item = items[i];
    if (index >= 0) items[index].frame.classList.remove('is-lightbox-origin');
    index = i;
    item.frame.classList.add('is-lightbox-origin');
    // The picture carries the description; the visible count and caption repeat it for the eye,
    // and the status line announces each step to assistive tech.
    ui.img.alt = item.text;
    ui.status.textContent = `Image ${i + 1} of ${items.length}: ${item.text}`;
    ui.count.textContent = `${pad2(i + 1)} / ${pad2(items.length)}`;
    ui.tag.textContent = item.tag;
    ui.text.textContent = item.text;

    // The thumbnail's file is already decoded: show it at once, then swap in the full image.
    const token = ++loadToken;
    const full = new URL(item.src, location.href).href;
    const thumb = item.img.currentSrc;
    if (!thumb || thumb === full) {
      ui.img.src = item.src;
      ui.frame.classList.remove('is-loading');
    } else {
      ui.img.src = thumb;
      ui.frame.classList.add('is-loading');
      const loader = new Image();
      loader.src = item.src;
      const done = () => {
        if (token !== loadToken) return;
        ui.img.src = item.src;
        ui.frame.classList.remove('is-loading');
      };
      (loader.decode ? loader.decode() : Promise.reject()).then(done, () => { loader.onload = done; if (loader.complete && loader.naturalWidth) done(); });
    }
    return layout(item);
  }

  // ── FLIP zoom ────────────────────────────────────────────────────────────
  function stopZoom() {
    if (!zoom) return;
    for (const a of zoom) a.cancel();
    zoom = null;
  }

  /**
   * Animate the frame between the thumbnail's box and its resting box (`opening` = toward rest).
   * The frame is scaled non-uniformly to the thumbnail's proportions; the image inside is
   * counter-scaled so it always "covers" the frame undistorted, exactly like the cropped thumbnail.
   */
  function flip(thumb, rest, opening, duration) {
    const outer = [], inner = [];
    const sx0 = thumb.w / rest.w, sy0 = thumb.h / rest.h;
    const curve = opening ? outQuart : inOutCubic;
    for (let i = 0; i <= FLIP_STEPS; i++) {
      const t = i / FLIP_STEPS;
      const e = opening ? curve(t) : 1 - curve(t);
      const sx = sx0 + (1 - sx0) * e, sy = sy0 + (1 - sy0) * e;
      const cover = Math.max(sx, sy);
      outer.push({ transform: `translate(${((thumb.x - rest.x) * (1 - e)).toFixed(2)}px, ${((thumb.y - rest.y) * (1 - e)).toFixed(2)}px) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})` });
      inner.push({ transform: `scale(${(cover / sx).toFixed(5)}, ${(cover / sy).toFixed(5)})` });
    }
    stopZoom();
    const timing = { duration, easing: 'linear', fill: 'both' };
    zoom = [ui.frame.animate(outer, timing), ui.img.animate(inner, timing)];
    return zoom[0].finished.catch(() => {});
  }

  // ── open / step / close ──────────────────────────────────────────────────
  function lock(on) {
    root.classList.toggle('lightbox-open', on);
    // With overlay scrollbars the page can simply stop scrolling; a classic scrollbar would make
    // the layout jump, so there the dialog only swallows wheel / touch / key scrolling.
    root.classList.toggle('lightbox-lock', on && window.innerWidth - root.clientWidth < 1);
    if (on) {
      inerted = qsa(BACKGROUND).filter((el) => !el.inert);
      for (const el of inerted) el.inert = true;
    } else {
      for (const el of inerted) el.inert = false;
      inerted = [];
    }
  }

  function open(i) {
    if (closing) finishClose();        // re-opened while still zooming out: no need to wait
    if (isOpen) return;
    if (!ui) build();
    isOpen = true;
    closing = false;
    const item = items[i];
    const thumb = thumbBox(item);      // read before anything moves
    ui.el.hidden = false;
    const rest = show(i);
    lock(true);
    void ui.el.offsetWidth;            // let the backdrop and controls transition in
    ui.el.classList.add('is-open');
    ui.close.focus({ preventScroll: true });
    if (core.fx.enabled && thumb && ui.frame.animate) {
      flip(thumb, rest, true, ZOOM_MS).then(() => { if (isOpen && !closing) stopZoom(); });
    }
    core.emit('lightbox:open', { index: i });
  }

  function step(dir) {
    if (!isOpen || closing || items.length < 2) return;
    stopZoom();
    const i = (index + dir + items.length) % items.length;
    show(i);
    // Bring the figure on screen underneath, so the page is where the viewer is.
    items[i].frame.scrollIntoView({ block: 'center', behavior: 'instant' });
    ui.el.style.setProperty('--lb-dir', dir);
    ui.el.classList.remove('is-stepping');
    void ui.el.offsetWidth;
    ui.el.classList.add('is-stepping');
  }

  function close() {
    if (!isOpen || closing) return;
    closing = true;
    const item = items[index];
    const done = () => {
      if (finishClose !== done) return;  // already finished by a re-open
      finishClose = null;
      stopZoom();
      ui.el.hidden = true;
      ui.el.classList.remove('is-open', 'is-closing', 'is-stepping');
      item.frame.classList.remove('is-lightbox-origin');
      ui.img.removeAttribute('src');
      loadToken++;
      index = -1;
      isOpen = closing = false;
    };
    finishClose = done;
    lock(false);
    item.button.focus({ preventScroll: true });
    ui.el.classList.remove('is-open');
    core.emit('lightbox:close');
    const thumb = core.fx.enabled && ui.frame.animate ? thumbBox(item) : null;
    if (thumb) {
      flip(thumb, restBox(item), false, CLOSE_MS).then(done);
    } else if (core.fx.enabled) {
      ui.el.classList.add('is-closing');   // no thumbnail to fly back to: fade out
      setTimeout(done, 260);
    } else {
      done();
    }
  }

  // ── input ────────────────────────────────────────────────────────────────
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); return; }
    if (SCROLL_KEYS.has(e.key) && !(e.key === ' ' && e.target instanceof HTMLButtonElement)) { e.preventDefault(); return; }
    if (e.key !== 'Tab') return;
    // focus trap: cycle through the controls that are shown
    const stops = [ui.prev, ui.next, ui.close].filter((b) => b.getClientRects().length);
    const at = stops.indexOf(document.activeElement);
    e.preventDefault();
    stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
  }

  /** The visitor has pinch-zoomed the page: one finger now pans the zoomed view. */
  const zoomedIn = () => !!window.visualViewport && window.visualViewport.scale > 1.05;

  function onTouchStart(e) {
    // one finger, not on a control; a second finger means a pinch, not a swipe
    const single = e.touches.length === 1 && !e.target.closest('button');
    swipe = single ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }

  function onTouchMove(e) {
    // nothing under the dialog may scroll; pinching and panning a zoomed view stay native
    if (e.touches.length === 1 && !zoomedIn() && e.cancelable) e.preventDefault();
  }

  function onTouchEnd(e) {
    if (!swipe || e.touches.length) return;
    const dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y;
    swipe = null;
    if (zoomedIn()) return;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    else if (dy > SWIPE_PX * 1.6 && dy > Math.abs(dx) * 1.5) close();
  }

  const offs = [
    core.on('resize', () => { if (isOpen && !closing) { stopZoom(); layout(items[index]); } }),
    // Effects switched off mid-zoom: jump to the end state.
    core.on('fx:change', (enabled) => { if (!enabled && isOpen && !closing) stopZoom(); }),
  ];

  return {
    open: (i) => open(clamp(i, 0, items.length - 1)),
    close,
    destroy() {
      if (isOpen) { closing = false; finishClose = null; lock(false); }
      for (const off of offs) off();
      for (const item of items) { item.button.remove(); item.frame.classList.remove('is-lightbox-origin'); }
      ui?.el.remove();
    },
  };
}
