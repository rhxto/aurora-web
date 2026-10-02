// /departments/ (the orbital map + the nine departments) and /departments/<slug>/ (one
// department in detail). Styles: src/css/components/{orbit,departments}.css; behaviour:
// fx/orbit.js (map), fx/departments.js (section rail, plot read-outs), fx/lightbox.js (figures).

import { esc, pad2, titleCase, titleHtml, excerpt, paragraphs, button, stepTitle, frame, feature, indexLabel, pager } from './lib.mjs';
import { subhero } from './partials/subhero.mjs';
import { orbit, orbitGlyph } from './partials/orbit.mjs';

const navLabel = (site, href) => site.nav.find((n) => n.href === href).label;

/**
 * A content figure, tagged with what it shows: plots and CAD renders get the "instrument"
 * hover (fx/departments.js), photos a restrained zoom. Plots and renders are shown uncropped,
 * so their box depends on the file: --fig-w (its pixel width) lets the stylesheet size that box
 * before the lazy image has loaded (components/departments.css).
 */
function figure(image, tag) {
  const kind = image.src.startsWith('/img/plots/') ? 'plot' : image.src.startsWith('/img/renders/') ? 'render' : 'photo';
  return `<div class="dept-fig dept-fig--${kind}"${kind === 'photo' ? '' : ` data-scope style="--fig-w:${image.w}px"`}>
      ${frame(image, { tag })}
    </div>`;
}

/** "01 / 09 — AERO" plus the department's position on the orbital map. */
const address = (index, total, text) => `<p class="label feature__index dept-address" data-reveal><span data-scramble>${pad2(index + 1)} / ${pad2(total)}</span><span class="label__sep" aria-hidden="true"></span><span>${esc(text)}</span>${orbitGlyph(index, total)}</p>`;

export function departmentsIndex({ site, departments }) {
  const label = navLabel(site, '/departments/');
  const rows = departments.items.map((d, i, all) => feature({
    id: d.slug,
    level: 2,
    title: d.name,
    label: address(i, all.length, d.short),
    body: paragraphs(d.overview),
    cta: button({ href: d.href, label: d.cta }),
    media: figure(d.indexImage, `FIG. ${pad2(i + 1)}`),
    flip: i % 2 === 1,
    cls: 'dept-row',
  })).join('\n');

  return {
    url: '/departments/',
    id: 'departments',
    title: titleCase(label),
    main: `${subhero(site, departments.hero, [{ label }])}

<section class="section orbit-section" aria-label="Map of the departments">
  <div class="container">
    ${orbit(departments)}
  </div>
</section>

<section class="section" aria-label="${esc(titleCase(label))}">
  <div class="features container">
${rows}
  </div>
</section>`,
  };
}

export function department({ site, departments }, index) {
  const d = departments.items[index];
  const all = departments.items.length;
  const total = d.sections.length;

  const body = (s) => [
    paragraphs(s.text),
    s.list ? `<ul class="ticks">\n${s.list.map((item) => `<li>${esc(item)}</li>`).join('\n')}\n</ul>` : '',
  ].filter(Boolean).join('\n');

  // A section without copy (title + image only) becomes a centred "plate" instead of a half-empty row.
  const sections = d.sections.map((s, i) => feature({
    id: s.id,
    part: s.id,
    title: s.title,
    label: indexLabel(i, total),
    body: body(s),
    media: figure(s.image, `FIG. ${pad2(i + 1)}`),
    flip: i % 2 === 1,
    cls: s.text.length || s.list ? 'dept-section' : 'dept-section dept-section--plate',
  })).join('\n');

  const toc = d.sections.map((s, i) => `<li><a class="toc__link" href="#${esc(s.id)}" data-no-transition><span class="toc__idx" aria-hidden="true">${pad2(i + 1)}</span><span>${titleHtml(s.title)}</span></a></li>`).join('\n          ');

  return {
    url: d.href,
    id: 'department',
    slug: d.slug,
    title: titleCase(d.name),
    description: excerpt(d.overview[0]),
    main: `${subhero(site, departments.hero, [{ label: navLabel(site, '/departments/'), href: '/departments/' }, { label: d.name }])}

<section class="section department" aria-labelledby="department-title">
  ${stepTitle(d.title, { id: 'department-title' })}
  <div class="dept-lead container">
    <div class="dept-lead__aside" data-reveal-group>
      ${address(index, all, 'DEPARTMENT')}
      <p class="dept-lead__code" style="--n:${d.short.length}" aria-hidden="true" data-reveal="clip"><span>${esc(d.short)}</span></p>
      <nav class="toc" aria-label="On this page" data-reveal>
        <ol>
          ${toc}
        </ol>
      </nav>
    </div>
    <div class="dept-lead__body" data-reveal-group>
      <h3 class="overview__title" data-reveal>OVERVIEW</h3>
      <div class="prose prose--lead" data-reveal>
        ${paragraphs(d.overview)}
      </div>
    </div>
  </div>
  <div class="features container" data-sections>
${sections}
  </div>
</section>

${pager(departments.items, index, 'DEPARTMENT')}`,
  };
}
