// Sub-page hero: the team photo double-exposed with the aurora behind it, a breadcrumb and the
// two-tone page title ("DISCOVER OUR" in white + "PROJECTS" in coral, as on the original site).
// Styles: src/css/components/subhero.css. The sky keeps the aurora vivid behind this section
// only (fx/sky.js looks for .subhero) and calm behind the content that follows.

import { esc, url, img, sentence, titleCase, corners } from '../lib.mjs';

/**
 * hero   { pre, accent } from the content file
 * trail  breadcrumb entries after HOME: [{ label, href? }] — the last one is the current page
 *
 * The photo is a backdrop (empty alt) and, being the largest thing in the first viewport, it is
 * painted at once: it only settles from a slight zoom (subhero.css), it is never faded in.
 * Detail pages share their section's title ("MEET THE TEAM"), so the accessible name of the h1
 * adds the page itself: "Meet the team: Aerodynamics".
 */
export function subhero(site, hero, trail) {
  const crumbs = [{ label: 'HOME', href: '/' }, ...trail].map((c, i, all) => (i < all.length - 1
    ? `<li><a href="${url(c.href)}">${esc(c.label)}</a></li>`
    : `<li aria-current="page">${esc(c.label)}</li>`)).join('');
  const title = sentence(`${hero.pre} ${hero.accent}`);
  const label = trail.length > 1 ? `${title}: ${titleCase(trail[trail.length - 1].label)}` : title;

  return `<section class="subhero">
  <div class="subhero__media">
    ${img({ ...site.subpageHero, alt: '' }, { sizes: '100vw', eager: true, attrs: 'data-parallax="0.12"' })}
  </div>
  <div class="subhero__inner container">
    <nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs}</ol></nav>
    <h1 class="subhero__title" aria-label="${esc(label)}"><span class="subhero__pre" aria-hidden="true" data-split="chars">${esc(hero.pre)}</span> <span class="subhero__accent" aria-hidden="true" data-split="chars">${esc(hero.accent)}</span></h1>
  </div>
  ${corners}
</section>`;
}
