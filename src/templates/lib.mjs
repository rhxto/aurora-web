// Shared template helpers: escaping, URL prefixing, images and the small components
// (button, step title, media frame, feature row, pager) reused across pages.

import fs from 'node:fs';
import path from 'node:path';

const config = { base: '', version: { css: '', js: {} }, modules: [], brand: { mark: '', full: '' } };

/**
 * Called once by renderSite() before any template runs.
 *   version  { css: hash of site.css, js: { 'fx/hud.js': hash, … } }
 *   modules  the FX registry: [{ name, when, order }]
 */
export function configure({ base = '', version, modules = [], root }) {
  config.base = base;
  config.version = version;
  config.modules = modules;
  const brand = (file) => fs.readFileSync(path.join(root, 'public', 'img', 'brand', file), 'utf8');
  config.brand.mark = inlineSvg(brand('logo-mark.svg'), 'logo logo--mark');
  config.brand.full = inlineSvg(brand('logo-full.svg'), 'logo logo--full');
}

/** Prepares a brand SVG for inlining: no fixed size/id, colours driven by CSS. */
function inlineSvg(svg, cls) {
  const end = svg.indexOf('>');
  const open = svg.slice(0, end)
    .replace(/\s(?:width|height|id)="[^"]*"/g, '')
    .replace('<svg', `<svg class="${cls}" aria-hidden="true" focusable="false"`);
  return (open + svg.slice(end).trim())
    .replace(/fill="white"/gi, 'fill="currentColor"')
    .replace(/fill="#FF5151"/gi, 'class="logo__accent"');
}

export const brand = () => config.brand;
export const version = () => config.version;
export const modules = () => config.modules;

// ── strings ────────────────────────────────────────────────────────────────
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/**
 * HTML-escape a content string (text nodes and attribute values). A missing value is a content
 * or template mistake, so it stops the build instead of rendering an empty element.
 */
export function esc(value) {
  if (value === undefined || value === null) throw new Error('esc(): missing value — a field the template needs is absent from content/site.json');
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Prefix a root-absolute internal URL with the --base path; leave everything else alone. */
export const url = (href) => (href.startsWith('/') && !href.startsWith('//') ? config.base + href : href);

/** Cache-safe URL of a script below assets/js/ ("fx/hud.js"): the path plus its content hash. */
export function script(file) {
  const hash = config.version.js[file];
  if (!hash) throw new Error(`script(): assets/js/${file} is not part of the build`);
  return `${url(`/assets/js/${file}`)}?v=${hash}`;
}

/** Absolute production URL of a root-absolute path (canonical, Open Graph, sitemap-style). */
export const absolute = (site, href) => site.url.replace(/\/$/, '') + config.base + href;

export const pad2 = (n) => String(n).padStart(2, '0');
/** "DISCOVER OUR PROJECTS" → "Discover our projects" (for aria-labels and page titles). */
export const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
/** "MISSION ANALYSIS" → "Mission Analysis"; short acronyms such as GNC stay as they are. */
export const titleCase = (text) => (text.length <= 3 ? text : text.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase()));
/** Cut a paragraph at a word boundary for the meta description. */
export function excerpt(text, max = 160) {
  if (text.length <= max) return text;
  return text.slice(0, text.lastIndexOf(' ', max - 1)).replace(/[,;:.\s]+$/, '') + '…';
}
/**
 * Section titles in the content file mix capitals with a lowercase "and" ("GUIDANCE and CONTROL").
 * The lowercase words are wrapped so CSS can set them as a quiet connective.
 */
export const titleHtml = (text) => esc(text).replace(/(^|\s)([a-z]+)(?=\s|$)/g, '$1<span class="t-and">$2</span>');

export const paragraphs = (list) => list.map((p) => `<p>${esc(p)}</p>`).join('\n');

/**
 * Display heading whose letters animate in (reveal.js [data-split]). The heading itself carries
 * the accessible name, so whatever the effect does to the letters never reaches a screen reader:
 *   `<h2${split.label(text)}>${split.html(text)}</h2>`
 */
export const split = {
  label: (text) => ` aria-label="${esc(sentence(text))}"`,
  html: (text) => `<span aria-hidden="true" data-split="chars">${esc(text)}</span>`,
};

// ── icons ──────────────────────────────────────────────────────────────────
const ICONS = {
  arrow: '<svg class="icon icon--arrow" viewBox="0 0 24 12" aria-hidden="true" focusable="false"><path d="M0 6h22M17 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  external: '<svg class="icon icon--external" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 1h8v8M11 1 1 11" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  instagram: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg>',
  linkedin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.4 10.2v6.6M7.4 7.2v.4M11.2 16.8v-6.6M11.2 13.2c0-1.8 1-3 2.7-3s2.7 1.2 2.7 3v3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
export const icon = (name) => ICONS[name];

// ── images ─────────────────────────────────────────────────────────────────
/**
 * <img> with intrinsic size, lazy loading and a responsive srcset when an 800px variant exists.
 * `eager` is for above-the-fold imagery only.
 */
export function img(image, { sizes = '100vw', eager = false, cls = '', attrs = '' } = {}) {
  if (!image || !image.src || !image.w || !image.h) throw new Error(`img(): incomplete image ${JSON.stringify(image)}`);
  if (typeof image.alt !== 'string') throw new Error(`img(): missing alt text for ${image.src}`);
  const out = [`src="${url(image.src)}"`];
  if (image.src800) out.push(`srcset="${url(image.src800)} 800w, ${url(image.src)} ${image.w}w"`, `sizes="${sizes}"`);
  out.push(`width="${image.w}"`, `height="${image.h}"`, `alt="${esc(image.alt)}"`, 'decoding="async"');
  out.push(eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"');
  if (cls) out.unshift(`class="${cls}"`);
  if (attrs) out.push(attrs);
  return `<img ${out.join(' ')}>`;
}

/** Four HUD corner brackets; the parent must be position: relative. */
export const corners = '<span class="corners" aria-hidden="true"></span>';

/**
 * A figure around a content image. Photos get HUD corner brackets; plots, CAD renders and
 * rocket profiles (often on white) sit in an "instrument panel" so they look intentional on
 * the dark page. The caption repeats the alt text visually, so it is hidden from assistive tech.
 */
export function frame(image, { tag = '', sizes = '(min-width: 900px) 46vw, 92vw' } = {}) {
  const panel = !image.src.startsWith('/img/photos/');
  const ratio = image.w / image.h;
  // Photos are cropped to a calm range of proportions; panels never crop their content.
  const ar = panel ? ratio : Math.min(1.6, Math.max(0.8, ratio));
  const shape = ratio < 0.95 ? ' frame--tall' : ratio > 2.2 ? ' frame--wide' : '';
  return `<figure class="frame ${panel ? 'frame--panel' : 'frame--photo'}${shape}" data-reveal="clip">
  <div class="frame__box">
    <div class="frame__media" style="--ar:${ar.toFixed(3)}" data-tilt data-tilt-max="${panel ? 4 : 6}" data-tilt-glare>
      ${img(image, { sizes })}
    </div>
    ${panel ? '' : corners}
  </div>
  <figcaption class="frame__caption" aria-hidden="true">${tag ? `<span class="frame__tag">${esc(tag)}</span>` : ''}<span class="frame__text">${esc(image.alt)}</span></figcaption>
</figure>`;
}

// ── components ─────────────────────────────────────────────────────────────
/** Coral outlined pill button with an arrow and a fill sweep on hover. */
export function button({ href, label, external = false }) {
  const target = external ? ' target="_blank" rel="noopener"' : '';
  return `<a class="btn" href="${esc(url(href))}"${target} data-magnetic><span class="btn__label">${esc(label)}</span>${icon(external ? 'external' : 'arrow')}</a>`;
}

/** The site's signature heading: a title flanked by the stepped red lines (styles in base.css). */
export function stepTitle(text, { id = '' } = {}) {
  return `<div class="step-title" data-reveal="custom"><svg class="step-title__line step-title__line--l" viewBox="0 0 420 48" preserveAspectRatio="none" aria-hidden="true"><path d="M0 4 H388 V44 H420" pathLength="1"/></svg><h2 class="step-title__text"${id ? ` id="${id}"` : ''}>${titleHtml(text)}</h2><svg class="step-title__line step-title__line--r" viewBox="0 0 420 48" preserveAspectRatio="none" aria-hidden="true"><path d="M0 4 H32 V44 H420" pathLength="1"/></svg></div>`;
}

/** Small mono label such as "01 / 05" that decodes on reveal. */
export const indexLabel = (i, total, extra = '') => `<p class="label feature__index" data-reveal><span data-scramble>${pad2(i + 1)} / ${pad2(total)}</span>${extra ? `<span class="label__sep" aria-hidden="true"></span><span>${esc(extra)}</span>` : ''}</p>`;

/**
 * Text + media row; rows alternate sides (`flip`). `media` is ready-made HTML (usually frame()).
 * A row may have no paragraphs at all (title + image only).
 */
export function feature({ id = '', part = '', level = 3, title, splitTitle = false, label = '', body = '', cta = '', media, flip = false, cls = '' }) {
  const heading = splitTitle
    ? `<h${level} class="feature__title"${split.label(title)}>${split.html(title)}</h${level}>`
    : `<h${level} class="feature__title" data-reveal>${titleHtml(title)}</h${level}>`;
  return `<article class="feature${flip ? ' feature--flip' : ''}${cls ? ` ${cls}` : ''}"${id ? ` id="${esc(id)}"` : ''}${part ? ` data-part="${esc(part)}"` : ''}>
  <div class="feature__text" data-reveal-group>
    ${label}
    ${heading}
    ${body ? `<div class="prose" data-reveal>\n${body}\n</div>` : ''}
    ${cta ? `<p class="feature__cta" data-reveal>${cta}</p>` : ''}
  </div>
  <div class="feature__media">
    ${media}
  </div>
</article>`;
}

/** Previous / next links at the bottom of a detail page (wraps around the collection). */
export function pager(items, index, kind) {
  const prev = items[(index - 1 + items.length) % items.length];
  const next = items[(index + 1) % items.length];
  const link = (item, dir) => `<a class="pager__link pager__link--${dir}" href="${url(item.href)}" rel="${dir}">
    <span class="label pager__label">${dir === 'prev' ? 'PREVIOUS' : 'NEXT'} ${esc(kind)}</span>
    <span class="pager__name">${esc(item.name)}</span>
    ${icon('arrow')}
  </a>`;
  return `<nav class="pager container" aria-label="More ${esc(kind.toLowerCase())}s" data-reveal>
  ${link(prev, 'prev')}
  ${link(next, 'next')}
</nav>`;
}
