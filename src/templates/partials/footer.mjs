// Site footer: full logo, navigation, social links and the copyright line.

import { esc, url, icon, brand } from '../lib.mjs';

export function footer(site) {
  const nav = site.nav.map((item) => `<li><a class="site-footer__link" href="${url(item.href)}">${esc(item.label)}</a></li>`).join('\n        ');

  return `<footer class="site-footer">
    <div class="container site-footer__grid">
      <a class="site-footer__logo" href="${url('/')}" aria-label="${esc(site.name)} — home">${brand().full}</a>
      <nav class="site-footer__nav" aria-label="Footer">
        <ul>
        ${nav}
        </ul>
      </nav>
      <ul class="social" aria-label="Social media">
        <li><a class="social__link" href="${esc(site.social.instagram)}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a></li>
        <li><a class="social__link" href="${esc(site.social.linkedin)}" target="_blank" rel="noopener" aria-label="LinkedIn">${icon('linkedin')}</a></li>
      </ul>
    </div>
    <div class="container site-footer__base">
      <p class="site-footer__copy">${esc(site.copyright)}</p>
      <a class="site-footer__top" href="#main" data-no-transition>BACK TO TOP</a>
    </div>
  </footer>`;
}
