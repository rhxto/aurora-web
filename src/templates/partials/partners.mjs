// Partner tiers, composed as a launch stack: the main sponsor is the big first-stage plate, the
// tiers below use smaller and smaller plates, and a thin trajectory line with one marker per tier
// ties them together (fx/partners.js draws it while the page scrolls).
//
// Every logo sits on a "decal plate" whose background suits its artwork — plate "light" for logos
// drawn for white paper, "dark" for white or transparent artwork — and is sized so that wide and
// tall logos carry the same visual weight (see fit()).
// Styles: src/css/components/partners.css; effect styles: src/css/fx/partners.css.

import { esc, img, stepTitle, pad2, icon, corners } from '../lib.mjs';

/** Nominal plate proportions (width / height) and the share of the plate a logo's artwork covers. */
const PLATE = {
  main: { ratio: 3, area: 0.25, sizes: '(min-width: 900px) 34rem, 80vw' },
  default: { ratio: 1.72, area: 0.2, sizes: '(min-width: 1000px) 16rem, 40vw' },
};
const MAX_W = 0.76;   // the artwork never spans more than this share of the plate's width …
const MAX_H = 0.56;   // … or of its height

/**
 * Optical corrections, keyed by file name.
 *   box    where the artwork sits inside the image file [x0, y0, x1, y1] (0–1) when the file has
 *          built-in margins — sizes and centring are computed on the artwork, not on the file
 *   weight < 1 for dense, solid artwork that looks heavy; > 1 for thin outlines that look light
 */
const OPTICAL = {
  'for-fittings': { box: [0.045, 0.036, 0.949, 0.945] },
  'regione-emilia-romagna': { box: [0.123, 0.372, 0.902, 0.729], weight: 1.1 },
  'ansys': { box: [0.181, 0.216, 0.667, 0.689], weight: 0.72 },
  'solidworks': { box: [0.088, 0.222, 0.878, 0.653] },
  'cofert': { box: [0.005, 0, 0.974, 0.828] },
  'nuova-andrea': { box: [0.101, 0.079, 0.948, 0.982] },
  'bandini-cuscinetti': { weight: 0.82 },
  'wd40': { weight: 0.95 },
  'basso-pb': { weight: 1.1 },
  'emmetre': { weight: 1.1 },
};

const num = (v) => String(Math.round(v * 100) / 100);

/**
 * Equal-area fit: the artwork of every logo covers about the same share of its plate, capped by
 * MAX_W / MAX_H. Returns the custom properties the stylesheet turns into a size:
 *   --w   image width, in % of the plate's width      --h  image height cap, in % of the plate's height
 *   --ar  image proportions                           --tx / --ty  offset that centres the artwork
 */
function fit(item, plate) {
  const key = item.src.slice(item.src.lastIndexOf('/') + 1).replace(/\.\w+$/, '');
  const { box = [0, 0, 1, 1], weight = 1 } = OPTICAL[key] || {};
  const [x0, y0, x1, y1] = box;
  const ratio = item.w / item.h;
  const artRatio = (ratio * (x1 - x0)) / (y1 - y0);
  const artW = Math.min(Math.sqrt((plate.area * weight * artRatio) / plate.ratio), MAX_W, (MAX_H * artRatio) / plate.ratio);
  return [
    `--w:${num((artW / (x1 - x0)) * 100)}`,
    `--h:${num((MAX_H / (y1 - y0)) * 100)}`,
    `--ar:${num(ratio)}`,
    `--tx:${num((0.5 - (x0 + x1) / 2) * 100)}%`,
    `--ty:${num((0.5 - (y0 + y1) / 2) * 100)}%`,
  ].join(';');
}

/** "Emmetre – Torneria automatica e artigianale": the descriptor after the dash is set quieter. */
function nameHtml(name) {
  const cut = name.indexOf(' – ');
  return cut < 0 ? esc(name) : `${esc(name.slice(0, cut))}<span class="partner__desc">${esc(name.slice(cut))}</span>`;
}

function partner(item, tier, index) {
  if (item.plate !== 'light' && item.plate !== 'dark') throw new Error(`Partner "${item.name}": plate must be "light" or "dark"`);
  const plate = PLATE[tier.id] || PLATE.default;
  // A partner may still lack a logo file (the name is set as a wordmark) or a website (no link).
  const face = item.src
    ? img(item, { sizes: plate.sizes, cls: 'decal__logo', attrs: `style="${fit(item, plate)}"` })
    : `<span class="decal__word">${esc(item.name.split(' – ')[0])}</span>`;
  const tag = item.href ? 'a' : 'div';
  const attrs = item.href ? ` href="${esc(item.href)}" target="_blank" rel="noopener" aria-label="${esc(item.name)}"` : '';
  return `<li class="tier__item" data-reveal="custom">
      <${tag} class="partner${item.href ? '' : ' partner--static'}"${attrs}>
        <span class="decal decal--${item.plate}" data-tilt data-tilt-max="7" data-tilt-glare>
          <span class="decal__face">${face}</span>
          ${corners}
        </span>
        <span class="partner__meta"${item.href ? ' aria-hidden="true"' : ''}>
          <span class="partner__idx" aria-hidden="true">${pad2(index)}</span>
          <span class="partner__name">${nameHtml(item.name)}</span>
          ${item.href ? `<span class="partner__open"><span class="partner__open-text">OPEN</span>${icon('external')}</span>` : ''}
        </span>
      </${tag}>
    </li>`;
}

/** One marker on the trajectory: a node and a tag such as "STAGE 02 / 04". */
const marker = (label, total = '') => `<p class="tier__marker" aria-hidden="true"><span class="tier__node"></span><span class="tier__tag"><span class="tier__tag-text">${label}</span>${total}</span></p>`;

export function partners(data) {
  const { tiers } = data;
  let index = 0;
  // Ids are prefixed: a bare tier id ("main") would collide with the page's <main id="main">.
  const stack = tiers.map((tier, i) => `<section class="tier tier--${esc(tier.id)}" id="tier-${esc(tier.id)}" aria-labelledby="tier-${esc(tier.id)}-title">
  ${marker(`STAGE ${pad2(i + 1)}`, `<span class="tier__of"> / ${pad2(tiers.length)}</span>`)}
  ${stepTitle(tier.title, { id: `tier-${tier.id}-title` })}
  <span class="tier__path" aria-hidden="true"></span>
  <ul class="tier__list container" data-reveal-group>
    ${tier.items.map((item) => partner(item, tier, ++index)).join('\n    ')}
  </ul>
</section>`).join('\n');

  // Decorative closing band: the short names once more, as a slow ticker in outlined type.
  const names = tiers.flatMap((tier) => tier.items.map((item) => `<span class="pband__name">${esc(item.name.split(' – ')[0])}</span>`)).join('');

  return `<div class="tiers" data-fx="partners">
${stack}
<div class="tiers__end">${marker('ALL STAGES GO')}</div>
</div>
<div class="pband" aria-hidden="true" data-marquee="46">${names}</div>`;
}
