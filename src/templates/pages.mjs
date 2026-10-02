// The single-block pages: /partners/, /contact/ and 404.html.

import { titleCase, button, split } from './lib.mjs';
import { subhero } from './partials/subhero.mjs';
import { partners } from './partials/partners.mjs';
import { comm } from './partials/comm.mjs';

const navLabel = (site, href) => site.nav.find((n) => n.href === href).label;

export function partnersPage({ site, partners: data }) {
  const label = navLabel(site, '/partners/');
  return {
    url: '/partners/',
    id: 'partners',
    title: titleCase(label),
    main: `${subhero(site, data.hero, [{ label }])}

<div class="section stack">
${partners(data)}
</div>`,
  };
}

export function contactPage({ site, contact }) {
  const label = navLabel(site, '/contact/');
  return {
    url: '/contact/',
    id: 'contact',
    title: titleCase(label),
    description: contact.lead,
    main: `${subhero(site, contact.hero, [{ label }])}

<div class="section contact">
${comm(contact, site)}
</div>`,
  };
}

// 404: "ERROR 404" is the label assistive technology reads; the "SIGNAL LOST" read-out beside it
// is decoration that fx/lost.js keeps re-scrambling, so it stays out of the accessibility tree.

/** Faint outline of a rocket adrift, nose to the right (decorative). */
const DERELICT = '<svg class="lost__rocket" data-lost-float="1.5" viewBox="0 0 260 64" aria-hidden="true" focusable="false"><path d="M40 22H200C226 22 246 28 256 32C246 36 226 42 200 42H40ZM66 22 38 3H24L42 22ZM66 42 38 61H24L42 42ZM40 26 30 24V40L40 38M182 22V42M96 22V42"/></svg>';

export function notFound() {
  const title = 'LOST IN SPACE';
  return {
    url: null,
    id: '404',
    title: 'Page not found',
    noindex: true,
    main: `<section class="lost container" data-fx="lost">
  <div class="lost__void" aria-hidden="true">
    <span class="lost__digit" data-lost-float="0.55">4</span><span class="lost__digit lost__digit--zero" data-lost-float="1">0</span><span class="lost__digit" data-lost-float="0.75">4</span>
    ${DERELICT}
  </div>
  <p class="label lost__label"><span data-scramble>ERROR 404</span><span class="label__sep" aria-hidden="true"></span><span class="lost__signal" aria-hidden="true"><i class="lost__led"></i><span data-lost-signal>SIGNAL LOST</span></span></p>
  <h1 class="lost__title"${split.label(title)}>${split.html(title)}</h1>
  <p class="lost__text">This page drifted out of range. Let’s get you back to the launch pad.</p>
  <p class="lost__cta">${button({ href: '/', label: 'BACK TO HOME' })}</p>
</section>`,
  };
}
