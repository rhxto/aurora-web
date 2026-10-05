// /projects/ (the three missions, rolled out in chronological order) and /projects/<slug>/
// (one rocket in detail: the blueprint explorer beside its subsystem sections).
// Styles: src/css/components/projects.css (+ blueprint.css); effects: fx/projects.js, fx/blueprint.js.

import { esc, url, pad2, sentence, titleCase, excerpt, paragraphs, titleHtml, split, img, icon, button, stepTitle, frame, indexLabel, corners } from './lib.mjs';
import { subhero } from './partials/subhero.mjs';
import { blueprint, rocketImage, keyFilter } from './partials/blueprint.mjs';

const navLabel = (site, href) => site.nav.find((n) => n.href === href).label;

/**
 * A mission patch as a medallion: it tilts under the pointer with a glare and a holographic sheen
 * (fx/tilt.js). `link` = { href, label } lays a pointer-only link over it: the picture keeps its
 * own description, and the page keeps one tab stop per destination (the button beside it).
 */
const medallion = (image, { sizes, eager = false, link = null }) => `<span class="patch"><span class="patch__tilt" style="--patch-mask:url('${url(image.src)}')" data-tilt data-tilt-max="14" data-tilt-glare data-tilt-holo>${img(image, { sizes, eager })}${link ? `<a class="patch__link" href="${esc(url(link.href))}" tabindex="-1" aria-label="${esc(link.label)}"></a>` : ''}</span></span>`;

/**
 * "01 / 03 — 2024": position in the collection and the mission badge. The spaces around the
 * separator are real text, so the two parts are not read as one word ("01 / 032024").
 */
const missionLabel = (i, total, badge) => `<p class="label feature__index" data-reveal><span data-scramble>${pad2(i + 1)} / ${pad2(total)}</span> <span class="label__sep" aria-hidden="true"></span> <span>${esc(badge)}</span></p>`;

// ── /projects/ ─────────────────────────────────────────────────────────────

/**
 * One mission per row. The rows are joined by a single stepped line that runs along each
 * rocket's lane and turns down the side to the next one, so the rockets alternate direction:
 * odd rows roll out to the right, even rows to the left.
 */
export function projectsIndex({ site, projects }) {
  const label = navLabel(site, '/projects/');
  const total = projects.items.length;
  const rows = projects.items.map((p, i) => {
    const rtl = i % 2 === 1;
    return `    <article class="fleet__row${rtl ? ' fleet__row--rtl' : ''}" id="${esc(p.slug)}" data-fleet-row>
      <span class="fleet__drop" aria-hidden="true"></span>
      <span class="fleet__glow" aria-hidden="true"><i class="fleet__spot"></i><i class="fleet__sweep"></i></span>
      ${corners}
      <div class="fleet__card">
        <div class="fleet__text" data-reveal-group>
          <span class="fleet__num" aria-hidden="true">${pad2(i + 1)}</span>
          ${missionLabel(i, total, p.badge)}
          <h2 class="fleet__title"${split.label(p.name)}>${split.html(p.name)}</h2>
          <div class="prose" data-reveal>
            ${paragraphs(p.overview)}
          </div>
          <p class="fleet__cta" data-reveal>${button({ href: p.href, label: p.cta })}</p>
        </div>
        <div class="fleet__patch" data-reveal="scale">${medallion(p.patch, { sizes: '(min-width: 900px) 22rem, 60vw', eager: i === 0, link: { href: p.href, label: sentence(p.name) } })}</div>
      </div>
      <div class="fleet__lane" data-fleet-lane>
        <span class="fleet__rail" aria-hidden="true"></span>
        ${rocketImage(p.rocket, { point: rtl ? 'left' : 'right', cls: 'fleet__rocket' })}
      </div>
    </article>`;
  }).join('\n');

  return {
    url: '/projects/',
    id: 'projects',
    title: titleCase(label),
    main: `${subhero(site, projects.hero, [{ label }])}

<section class="section" aria-label="${esc(titleCase(label))}">
  ${projects.items.some((p) => p.rocket.opaque) ? keyFilter : ''}
  <div class="fleet container" data-fx="projects">
${rows}
  </div>
</section>`,
  };
}

// ── /projects/<slug>/ ──────────────────────────────────────────────────────

/**
 * The figure of a subsystem section. A section illustrated by the rocket render itself gets the
 * render laid on a drawing panel (nose right, white background keyed out); photos use frame().
 * That panel opts out of the figure lightbox (data-no-zoom): the viewer shows the source file as
 * it is — unturned, on its own background — and the same render is the blueprint of the page.
 */
function figure(project, section, i) {
  const tag = `FIG. ${pad2(i + 1)}`;
  if (section.image.src !== project.rocket.src) {
    return frame(section.image, { tag, sizes: '(min-width: 1100px) 32vw, 92vw' });
  }
  return `<figure class="frame frame--panel frame--profile" data-reveal="clip" data-no-zoom>
  <div class="frame__box">
    <div class="frame__media">
      ${rocketImage({ ...project.rocket, alt: section.image.alt }, { point: 'right' })}
    </div>
  </div>
  <figcaption class="frame__caption" aria-hidden="true"><span class="frame__tag">${tag}</span></figcaption>
</figure>`;
}

/**
 * Previous / next project, each with its mission patch (wraps around the collection). It closes
 * the copy column, so the last section and this bar together fill the height of the sticky
 * blueprint — which therefore stays in place while the last section is read.
 */
function missionPager(items, index) {
  const link = (item, dir) => `<a class="pager__link pager__link--${dir}" href="${url(item.href)}" rel="${dir}">
    <span class="pager__patch" aria-hidden="true">${img({ ...item.patch, alt: '' }, { sizes: '5rem' })}</span>
    <span class="label pager__label">${dir === 'prev' ? 'PREVIOUS' : 'NEXT'} PROJECT</span>
    <span class="pager__name">${esc(item.name)}</span>
    ${icon('arrow')}
  </a>`;
  return `<nav class="pager pager--missions" aria-label="More projects" data-reveal>
  ${link(items[(index - 1 + items.length) % items.length], 'prev')}
  ${link(items[(index + 1) % items.length], 'next')}
</nav>`;
}

export function project({ site, projects }, index) {
  const p = projects.items[index];
  const total = p.sections.length;

  const specs = p.specs.map((s) => `<div class="specs__item" data-reveal="custom">
          <dt class="specs__label">${esc(s.label)}</dt>
          <dd class="specs__value"><span data-scramble>${esc(s.value)}</span></dd>
        </div>`).join('\n        ');

  // --from / --to place the section's zone on the small axis under its title (nose to the right,
  // like the strip that follows the page on narrow screens).
  const sections = p.sections.map((s, i) => {
    const [from, to] = s.zone;
    return `<article class="subsys" id="${esc(s.id)}" data-part="${esc(s.id)}" style="--from:${from};--to:${to}">
          <div class="subsys__text" data-reveal-group>
            ${indexLabel(i, total)}
            <h3 class="subsys__title" data-reveal>${titleHtml(s.title)}</h3>
            <span class="subsys__zone" aria-hidden="true" data-reveal></span>
            <div class="prose" data-reveal>
              ${paragraphs(s.text)}
            </div>
          </div>
          <div class="subsys__media">
            ${figure(p, s, i)}
          </div>
        </article>`;
  });

  return {
    url: p.href,
    id: 'project',
    slug: p.slug,
    title: titleCase(p.name),
    description: excerpt(p.overview[0]),
    main: `${subhero(site, projects.hero, [{ label: navLabel(site, '/projects/'), href: '/projects/' }, { label: p.name }])}

<section class="section project" aria-labelledby="project-title">
  ${stepTitle(p.name, { id: 'project-title' })}
  <div class="project__layout container">
    <aside class="project__rail" aria-label="${esc(titleCase(p.name))} rocket profile">
      ${blueprint(p, { index, total: projects.items.length })}
    </aside>
    <div class="project__body">
      <div class="overview overview--project">
        <div class="overview__text" data-reveal-group>
          <p class="label overview__label" data-reveal><span data-scramble>${esc(p.badge)}</span></p>
          <h3 class="overview__title" data-reveal>OVERVIEW</h3>
          <div class="prose prose--lead" data-reveal>
            ${paragraphs(p.overview)}
          </div>
        </div>
        <div class="overview__patch" data-reveal="scale">${medallion(p.patch, { sizes: '(min-width: 900px) 15rem, 50vw' })}</div>
      </div>
      <dl class="specs" data-reveal-group>
        ${specs}
      </dl>
      <div class="subsystems">
        ${sections.slice(0, -1).join('\n        ')}
      </div>
      <div class="project__end">
        <div class="subsystems">
        ${sections[sections.length - 1]}
        </div>
        ${missionPager(projects.items, index)}
      </div>
    </div>
  </div>
</section>`,
  };
}
