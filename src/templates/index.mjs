// Route table: turns content/site.json into the list of pages build.mjs writes to disk.

import { configure } from './lib.mjs';
import { layout } from './layout.mjs';
import { home } from './home.mjs';
import { projectsIndex, project } from './projects.mjs';
import { departmentsIndex, department } from './departments.mjs';
import { partnersPage, contactPage, notFound } from './pages.mjs';

/** Detail pages are written where the content file says they live — reject anything unexpected. */
function assertHrefs(items, prefix) {
  for (const item of items) {
    if (item.href !== `${prefix}${item.slug}/`) throw new Error(`"${item.name}": href ${item.href} does not match ${prefix}${item.slug}/`);
  }
}

/**
 * @param data  parsed content/site.json
 * @param ctx   { base, version: { css, js: { file: hash } }, modules, root }
 * @returns     [{ url, file, html }] — `url` is null for pages left out of the sitemap (404)
 */
export function renderSite(data, ctx) {
  configure(ctx);
  assertHrefs(data.projects.items, '/projects/');
  assertHrefs(data.departments.items, '/departments/');

  const pages = [
    home(data),
    projectsIndex(data),
    ...data.projects.items.map((_, i) => project(data, i)),
    departmentsIndex(data),
    ...data.departments.items.map((_, i) => department(data, i)),
    partnersPage(data),
    contactPage(data),
    notFound(),
  ];

  return pages.map((page) => ({
    url: page.url,
    file: page.url ? `${page.url.slice(1)}index.html` : '404.html',
    html: layout(data.site, page),
  }));
}
