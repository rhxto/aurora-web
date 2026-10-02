// @fx-when: [data-sections], [data-scope]
// @fx-order: 40
// Department pages (markup: src/templates/departments.mjs).
//
//   section rail   [data-sections] — a fixed index in the left margin: one tick per section,
//                  the active one highlighted, a progress line that follows the reading
//                  position. Scroll-spy from cached offsets (re-measured when the layout
//                  changes); works with effects off; hidden by CSS when there is no margin.
//                  It is mounted next to <main>, not inside it: position: fixed must keep
//                  meaning "the viewport" when an effect transforms the page (the launch show
//                  shakes main). fx/lightbox.js makes it inert with the rest of the background.
//   plot scope     [data-scope] figures (plots, CAD renders) — on fine pointers a crosshair
//                  follows the pointer over the image with a read-out of its normalised position
//                  (0.00–1.00 from the bottom-left corner: a cursor read-out, not data values)
//                  and corner brackets that tighten. These figures give up the 3D tilt of
//                  fx/tilt.js (this module starts first), so the crosshair stays exact.

import { core } from '../core.js';

const { clamp, qs, qsa } = core.utils;

const PROBE = 0.42;          // the reading line, as a fraction of the viewport height
const pad2 = (n) => String(n).padStart(2, '0');

function make(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── section rail ───────────────────────────────────────────────────────────
function initRail() {
  const host = qs('[data-sections]');
  const sections = host ? qsa(':scope > [id]', host) : [];
  if (sections.length < 2) return null;

  const nav = make('nav', 'dept-rail');
  nav.setAttribute('aria-label', 'Sections');
  const fill = make('span', 'dept-rail__fill');
  const track = make('span', 'dept-rail__track');
  track.setAttribute('aria-hidden', 'true');
  track.append(fill);
  const list = make('ol', 'dept-rail__list');
  const links = sections.map((section, i) => {
    const link = make('a', 'dept-rail__link');
    link.href = `#${section.id}`;
    link.setAttribute('data-no-transition', '');
    // The number is decoration; the label names the link (it is only faded out at rest, see
    // fx/departments.css, so assistive tech always has it).
    const idx = make('span', 'dept-rail__idx', pad2(i + 1));
    idx.setAttribute('aria-hidden', 'true');
    link.append(idx, make('span', 'dept-rail__label', (qs('.feature__title', section)?.textContent || section.id).replace(/\s+/g, ' ').trim()));
    const li = document.createElement('li');
    li.append(link);
    list.append(li);
    return link;
  });
  nav.append(track, list);
  nav.style.setProperty('--n', sections.length);
  (host.closest('main') || host).before(nav);

  let tops = [];
  let end = 0;
  let active = -1;
  let shown = null;
  let drawn = -1;

  function measure() {
    const y = core.scroll.y;
    tops = sections.map((s) => s.getBoundingClientRect().top + y);
    end = sections[sections.length - 1].getBoundingClientRect().bottom + y;
    update();
  }

  function update() {
    const { h } = core.viewport;
    const probe = core.scroll.y + h * PROBE;
    let i = 0;
    while (i < tops.length - 1 && tops[i + 1] <= probe) i++;
    if (i !== active) {
      if (active >= 0) links[active].removeAttribute('aria-current');
      links[i].setAttribute('aria-current', 'true');
      active = i;
    }
    // progress along the rail: evenly spaced ticks, each section mapped onto its own span
    const next = i < tops.length - 1 ? tops[i + 1] : end;
    const along = clamp((i + clamp((probe - tops[i]) / Math.max(1, next - tops[i]))) / (tops.length - 1));
    if (Math.abs(along - drawn) > 0.002) {
      drawn = along;
      fill.style.transform = `scaleY(${along.toFixed(4)})`;
    }
    const show = probe > tops[0] - h * 0.3 && core.scroll.y + h * 0.5 < end;
    if (show !== shown) { shown = show; nav.classList.toggle('is-shown', show); }
  }

  measure();
  const offs = [core.on('scroll', update), core.on('resize', measure)];
  // Lazy images and late fonts move the sections: keep the cached offsets honest.
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    offs.push(() => ro.disconnect());
  }
  return () => { for (const off of offs) off(); nav.remove(); };
}

// ── plot scope ─────────────────────────────────────────────────────────────
function initScopes() {
  const figures = qsa('[data-scope]').map((wrap) => {
    const media = qs('.frame__media', wrap);
    const img = media && qs('img', media);
    if (!img) return null;
    // An instrument does not wobble: no 3D tilt on these (see the header).
    for (const name of ['data-tilt', 'data-tilt-max', 'data-tilt-glare']) media.removeAttribute(name);
    return { media, img };
  }).filter(Boolean);
  if (!figures.length || !core.env.fine) return null;

  // One overlay, moved into whichever figure the pointer is over.
  const layer = make('span', 'dept-scope');
  layer.setAttribute('aria-hidden', 'true');
  const lineV = make('i', 'dept-scope__line dept-scope__line--v');
  const lineH = make('i', 'dept-scope__line dept-scope__line--h');
  const read = make('span', 'dept-scope__read');
  const readText = document.createTextNode('');
  read.append(readText);
  layer.append(make('span', 'corners dept-scope__corners'), lineV, lineH, read);

  let current = null;          // figure under the pointer
  let box = null;              // its image box in client px
  let stale = true;
  let stop = null;
  let text = '';
  let wasInside = false;

  function measure() {
    const r = current.img.getBoundingClientRect();
    box = { left: r.left, top: r.top, w: r.width, h: r.height };
    stale = false;
  }

  function frame() {
    if (!current) return;
    if (stale) measure();
    const p = core.pointer;
    const nx = (p.x - box.left) / box.w, ny = (p.y - box.top) / box.h;
    const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
    if (inside !== wasInside) { wasInside = inside; layer.classList.toggle('is-tracking', inside); }
    if (!inside) return;
    const x = nx * box.w, y = ny * box.h;
    lineV.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    lineH.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`;
    // the read-out sits beside the crossing, on whichever side has room
    read.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(${nx > 0.72 ? 'calc(-100% - 10px)' : '10px'},${ny > 0.82 ? 'calc(-100% - 8px)' : '8px'})`;
    const next = `X ${nx.toFixed(2)}  Y ${(1 - ny).toFixed(2)}`;
    if (next !== text) { text = next; readText.data = next; }
  }

  function enter(figure, e) {
    if (e.pointerType === 'touch' || !core.fx.enabled) return;
    current = figure;
    // cover the image exactly (it is smaller than the padded panel around it)
    const { img } = figure;
    layer.style.left = `${img.offsetLeft}px`;
    layer.style.top = `${img.offsetTop}px`;
    layer.style.width = `${img.offsetWidth}px`;
    layer.style.height = `${img.offsetHeight}px`;
    figure.media.append(layer);
    stale = true;
    wasInside = false;
    layer.classList.remove('is-tracking');
    void layer.offsetWidth;                 // the brackets tighten from their resting size
    layer.classList.add('is-on');
    stop ||= core.tick(frame);
  }

  function leave(figure) {
    if (current !== figure) return;
    current = null;
    layer.classList.remove('is-on', 'is-tracking');
    stop?.();
    stop = null;
  }

  const offs = [
    core.on('scroll', () => { stale = true; }),
    core.on('resize', () => { stale = true; }),
    core.on('fx:change', (enabled) => { if (!enabled && current) leave(current); }),
  ];
  for (const figure of figures) {
    const onEnter = (e) => enter(figure, e);
    const onLeave = () => leave(figure);
    figure.media.addEventListener('pointerenter', onEnter);
    figure.media.addEventListener('pointerleave', onLeave);
    offs.push(() => { figure.media.removeEventListener('pointerenter', onEnter); figure.media.removeEventListener('pointerleave', onLeave); });
  }
  return () => { for (const off of offs) off(); stop?.(); layer.remove(); };
}

export default function init() {
  const disposers = [initRail(), initScopes()].filter(Boolean);
  return { destroy() { for (const dispose of disposers) dispose(); } };
}
