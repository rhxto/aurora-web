// Project "blueprint": the rocket on a drafting sheet with its subsystem zones as real links,
// plus the legend that lists the subsystems. Styles: src/css/components/blueprint.css.
// Everything here works as plain HTML + CSS; fx/blueprint.js adds the scroll-synced highlight.
//
// Static contract (fx/blueprint.js builds on it via [data-fx="blueprint"]):
//   .blueprint[data-zones]      JSON [{ id, label, from, to }] — fractions along the rocket box,
//                               0 = nose end, 1 = tail end (image margins already accounted for)
//   .blueprint__sheet           the drafting sheet (grid, header, title block)
//   .blueprint__rocket          box that wraps the rocket image exactly as displayed: nose UP in
//                               the sticky rail (--blueprint-axis: y), nose RIGHT in the strip (x)
//   .blueprint__art             holds the picture (the effect adds a second, "lit" copy beside it)
//   .blueprint__hot[data-zone]  hotspot over one zone → #<section id>, with its .blueprint__note label
//   .blueprint__link[data-zone] legend entry → #<section id>
//   .blueprint__state           status word in the sheet header (rewritten by the effect)
//
// The hotspots are a pointer shortcut (tabindex -1): the legend is the keyboard path to the same
// anchors, so a keyboard user does not tab through every subsystem twice.
//
// Also exports rocketImage(), the rocket picture turned to any heading (used by the projects
// index), and keyFilter, the SVG filter both rely on for renders with a white background.

import { esc, url, pad2, sentence, corners } from '../lib.mjs';

/**
 * Empty margin between the edge of a source image and the rocket inside it, as fractions of the
 * image length. Zones in the content file are fractions of the ROCKET, so they are mapped
 * through this before they are laid over the picture. Images not listed fill their frame.
 */
const MARGIN = {
  '/img/rockets/atlas-render.png': { nose: 0.0162, tail: 0.0185 },
};

/** Heading of the nose in degrees, clockwise from "pointing right". */
const HEADING = { right: 0, down: 90, left: 180, up: -90 };

/**
 * How to turn a rocket image so that its nose points to `target`: the rotation, and whether
 * the picture ends up lying across its box (its own width runs along the box height).
 * Rotation only — never a mirror, which would flip the lettering on the airframe.
 */
function turn(rocket, target) {
  const native = rocket.orientation === 'vertical' ? HEADING.up : HEADING[rocket.nose];
  const deg = ((HEADING[target] - native + 540) % 360) - 180;
  return { deg, across: Math.abs(deg) === 90 };
}

/**
 * Renders on an opaque white background are keyed to transparent: alpha falls to zero as a
 * pixel approaches white. The filter region is inset a little so the resampled image border
 * (never pure white) is cut off. One copy per page, referenced from inline styles — a
 * fragment-only url() inside an external stylesheet is resolved differently across browsers.
 */
export const keyFilter = '<svg class="craft-key" width="0" height="0" aria-hidden="true" focusable="false"><filter id="craft-key" color-interpolation-filters="sRGB" x="0.004" y="0.012" width="0.992" height="0.976"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -4 -4 -4 0 12"/></filter></svg>';

const imgTag = (rocket, cls, { eager = false } = {}) => `<img class="${cls}" src="${url(rocket.src)}" width="${rocket.w}" height="${rocket.h}" alt="${esc(rocket.alt)}" decoding="async" loading="${eager ? 'eager' : 'lazy'}"${rocket.opaque ? ' style="filter:url(#craft-key) var(--craft-glow, drop-shadow(0 0 0 transparent))"' : ''}>`;

/**
 * The rocket picture lying in a box of the rocket's own proportions, nose pointing to `point`
 * ('right' | 'left'). The box is the element to size and move; the image fills it.
 */
export function rocketImage(rocket, { point = 'right', cls = '', eager = false } = {}) {
  const t = turn(rocket, point);
  const length = Math.max(rocket.w, rocket.h);
  const width = Math.min(rocket.w, rocket.h);
  return `<div class="craft${t.across ? ' craft--across' : ''}${cls ? ` ${cls}` : ''}" style="--rl:${length};--rw:${width};--turn:${t.deg}deg">${imgTag(rocket, 'craft__img', { eager })}</div>`;
}

const attrJson = (value) => JSON.stringify(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
const round = (n) => Math.round(n * 1e4) / 1e4;

/**
 * project  one item of projects.items
 * sheet    { index, total } position of the project in the collection ("SHEET 02 / 03")
 */
export function blueprint(project, { index, total }) {
  const rocket = project.rocket;
  const margin = MARGIN[rocket.src] || { nose: 0, tail: 0 };
  const onImage = (t) => round(margin.nose + t * (1 - margin.nose - margin.tail));
  const zones = project.sections.map((s) => {
    const [from, to] = s.zone;
    return {
      id: s.id,
      label: s.title,
      from: onImage(from),
      to: onImage(to),
      // A zone that covers the whole airframe cannot sit on top of the others: it gets the
      // dimension lane beside the rocket instead.
      span: from <= 0 && to >= 1,
    };
  });
  const length = Math.max(rocket.w, rocket.h);
  const width = Math.min(rocket.w, rocket.h);
  const x = turn(rocket, 'right');
  const y = turn(rocket, 'up');
  const across = [x.across ? 'x' : '', y.across ? 'y' : ''].join(' ').trim();

  // Each hotspot carries its own annotation (index + name on a leader line), so the drawing is
  // labelled — and every label is a link — before any script runs.
  const hotspots = zones.map((z, i) => `<a class="blueprint__hot${z.span ? ' blueprint__hot--span' : ''}" href="#${esc(z.id)}" data-zone="${esc(z.id)}" tabindex="-1" aria-label="${esc(sentence(z.label))} — jump to section" style="--from:${z.from};--to:${z.to}" data-no-transition><span class="blueprint__note" aria-hidden="true"><span class="blueprint__idx">${pad2(i + 1)}</span> ${esc(z.label)}</span></a>`).join('');
  const links = zones.map((z, i) => `<li><a class="blueprint__link" href="#${esc(z.id)}" data-zone="${esc(z.id)}" data-no-transition><span class="blueprint__idx" aria-hidden="true">${pad2(i + 1)}</span><span class="blueprint__name">${esc(z.label)}</span><span class="blueprint__meter" aria-hidden="true"><i></i></span></a></li>`).join('\n    ');

  return `<div class="blueprint" data-fx="blueprint" data-zones='${attrJson(zones.map(({ id, label, from, to }) => ({ id, label, from, to })))}'>
  ${rocket.opaque ? keyFilter : ''}
  <div class="blueprint__sheet">
    <p class="blueprint__head" aria-hidden="true"><span>PROFILE</span><span class="blueprint__state">SELECT A SUBSYSTEM</span></p>
    <div class="blueprint__field">
      <div class="blueprint__rocket" style="--rl:${length};--rw:${width};--turn-x:${x.deg}deg;--turn-y:${y.deg}deg"${across ? ` data-across="${across}"` : ''}>
        <span class="blueprint__ruler" aria-hidden="true"></span>
        <div class="blueprint__art">${imgTag(rocket, 'blueprint__img', { eager: true })}</div>
        <div class="blueprint__hots" role="group" aria-label="${esc(sentence(project.name))} subsystems on the rocket">${hotspots}</div>
      </div>
    </div>
    <p class="blueprint__block" aria-hidden="true">
      <span class="blueprint__cell"><span class="blueprint__k">PROJECT</span><span class="blueprint__v">${esc(project.name)}</span></span>
      <span class="blueprint__cell"><span class="blueprint__k">REF</span><span class="blueprint__v">${esc(project.badge)}</span></span>
      <span class="blueprint__cell"><span class="blueprint__k">SHEET</span><span class="blueprint__v">${pad2(index + 1)} / ${pad2(total)}</span></span>
    </p>
    ${corners}
  </div>
  <ol class="blueprint__list" aria-label="${esc(sentence(project.name))} subsystems">
    ${links}
  </ol>
</div>`;
}
