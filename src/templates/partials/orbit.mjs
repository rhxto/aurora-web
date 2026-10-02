// Departments as an orbital system: one satellite per department on three rings around the
// Aurora mark. The markup is a plain list of links (statically a neat grid of chips);
// fx/orbit.js lays the same anchors out on tilted orbits and animates them.
// Styles: src/css/components/orbit.css (static), src/css/fx/orbit.css (live map).
//
// This file is the single source of the ring layout: the map reads it from data attributes and
// orbitGlyph() draws the same layout as a small inline diagram for row headers.

import { esc, url, pad2, titleCase, brand } from '../lib.mjs';

/**
 * Rings from the core outwards: radius (1 = outermost), share of the satellites, angle of the
 * first one (turns). The phases are the start that keeps the nine satellites furthest apart on
 * a phone-sized map for the first twenty seconds (the rings turn at different speeds, so no
 * start lasts forever): a finger needs room, and the map stops as soon as one is selected.
 */
const RINGS = [
  { radius: 0.42, share: 2, phase: 0.06 },
  { radius: 0.71, share: 3, phase: 0.19 },
  { radius: 1, share: 4, phase: 0 },
];
/** How the diagram is seen: the orbital plane leans back by `incline` and is rolled by `roll` (degrees). */
const VIEW = { incline: 60, roll: -12 };

/** Ring and angle (turns, clockwise from 3 o'clock) of every satellite, in content order. */
function slots(total) {
  const shares = RINGS.reduce((sum, r) => sum + r.share, 0);
  const sizes = RINGS.map((r) => Math.round((total * r.share) / shares));
  sizes[sizes.length - 1] += total - sizes.reduce((a, b) => a + b, 0);
  return sizes.flatMap((size, ring) => Array.from({ length: size }, (_, k) => ({ ring, angle: (RINGS[ring].phase + k / size) % 1 })));
}

/**
 * The opening of a paragraph, cut at a sentence boundary: the first sentence, plus the
 * following ones while the whole stays within `max` characters. Never rewrites the copy.
 */
export function lead(text, max = 200) {
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [text];
  let out = sentences[0].trim();
  for (const s of sentences.slice(1)) {
    if (out.length + s.length > max) break;
    out += s;
  }
  return out;
}

/**
 * Small inline diagram of the system with one satellite highlighted — the department's
 * "address" on the map, used in row headers and on the department pages. Decorative.
 */
export function orbitGlyph(index, total) {
  const R = 27;
  const squash = Math.cos((VIEW.incline * Math.PI) / 180);
  const all = slots(total);
  const point = ({ ring, angle }) => {
    const a = angle * Math.PI * 2;
    const r = R * RINGS[ring].radius;
    return `cx="${(r * Math.cos(a)).toFixed(1)}" cy="${(r * Math.sin(a) * squash).toFixed(1)}"`;
  };
  const rings = RINGS.map((ring, i) => `<ellipse class="orbit-glyph__ring${i === all[index].ring ? ' is-own' : ''}" rx="${(R * ring.radius).toFixed(1)}" ry="${(R * ring.radius * squash).toFixed(1)}"/>`).join('');
  const others = all.map((s, i) => (i === index ? '' : `<circle class="orbit-glyph__dot" ${point(s)} r="1"/>`)).join('');
  return `<svg class="orbit-glyph" viewBox="-32 -20 64 40" aria-hidden="true" focusable="false"><g transform="rotate(${VIEW.roll})">${rings}<circle class="orbit-glyph__core" r="2.2"/>${others}<circle class="orbit-glyph__halo" ${point(all[index])} r="5"/><circle class="orbit-glyph__sat" ${point(all[index])} r="2.4"/></g></svg>`;
}

export function orbit(departments) {
  const items = departments.items;
  const all = slots(items.length);
  const nodes = items.map((d, i) => `<li><a class="orbit__node" href="${url(d.href)}" aria-label="${esc(titleCase(d.name))}" data-ring="${all[i].ring}" data-angle="${all[i].angle.toFixed(4)}" data-index="${pad2(i + 1)}" data-short="${esc(d.short)}" data-name="${esc(d.name)}" data-lead="${esc(lead(d.overview[0]))}"><span class="orbit__idx" aria-hidden="true">${pad2(i + 1)}</span><span class="orbit__sat" aria-hidden="true"></span><span class="orbit__short" aria-hidden="true">${esc(d.short)}</span><span class="orbit__name" aria-hidden="true">${esc(d.name)}</span></a></li>`).join('\n      ');

  return `<div class="orbit" data-fx="orbit" data-rings="${RINGS.map((r) => r.radius).join(',')}" data-incline="${VIEW.incline}" data-roll="${VIEW.roll}" data-total="${pad2(items.length)}">
  <div class="orbit__stage">
    <div class="orbit__core" aria-hidden="true">${brand().mark}</div>
    <ul class="orbit__list" aria-label="Departments">
      ${nodes}
    </ul>
  </div>
</div>`;
}
