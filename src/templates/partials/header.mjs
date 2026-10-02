// Fixed site header: logo mark, desktop navigation, and the full-screen mobile menu.
// The menu behaviour (aria-expanded, focus, Escape, scroll lock) lives in src/js/main.js.

import { esc, url, pad2, icon, brand } from '../lib.mjs';

/** aria-current for a nav entry: "page" on the page itself, "true" on its children. */
function current(href, pageUrl) {
  if (pageUrl === href) return ' aria-current="page"';
  return pageUrl && pageUrl.startsWith(href) ? ' aria-current="true"' : '';
}

export function header(site, page) {
  const desktop = site.nav.map((item) => `<a class="site-nav__link" href="${url(item.href)}"${current(item.href, page.url)} data-magnetic="0.25">${esc(item.label)}</a>`).join('\n      ');
  const mobile = site.nav.map((item, i) => `<li><a class="site-menu__link" href="${url(item.href)}"${current(item.href, page.url)}><span class="site-menu__idx" aria-hidden="true">${pad2(i + 1)}</span>${esc(item.label)}</a></li>`).join('\n        ');

  return `<header class="site-header" data-header>
    <a class="site-logo" href="${url('/')}" aria-label="${esc(site.name)} — home"${page.url === '/' ? ' aria-current="page"' : ''}>${brand().mark}</a>
    <nav class="site-nav" aria-label="Primary">
      ${desktop}
    </nav>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-menu" aria-label="Open menu" data-menu-toggle>
      <span class="nav-toggle__bars" aria-hidden="true"><i></i><i></i></span>
    </button>
    <nav class="site-menu" id="site-menu" aria-label="Menu" data-menu>
      <ul class="site-menu__list">
        ${mobile}
      </ul>
      <div class="site-menu__foot">
        <a class="site-menu__mail" href="mailto:${esc(site.email)}">${esc(site.email)}</a>
        <span class="site-menu__social">
          <a class="social__link" href="${esc(site.social.instagram)}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>
          <a class="social__link" href="${esc(site.social.linkedin)}" target="_blank" rel="noopener" aria-label="LinkedIn">${icon('linkedin')}</a>
        </span>
      </div>
    </nav>
  </header>`;
}
