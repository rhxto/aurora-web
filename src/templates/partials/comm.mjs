// Contact block, staged as a comm link with mission control: "JOIN US", a console in which the
// three paragraphs arrive as numbered transmissions, a signal scope beside it, and the e-mail
// address as the hero of the page with a copy button and the social buttons.
// Statically this is a complete, calm page; fx/comm.js brings [data-fx="comm"] to life.
// Styles: src/css/components/comm.css; effect styles: src/css/fx/comm.css.
//
// contact.paragraphs[].html is trusted HTML from the content file (links, <strong>).

import { esc, button, split, corners, pad2 } from '../lib.mjs';

const COPY_ICON = '<svg class="icon icon--copy" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M4.5 4.5V1.5h8v8h-3M1.5 4.5h8v8h-8z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

/** The three ways to reach the team, as contacts on the scope: bearing (deg, 0 = east, clockwise) and range (0–1). */
const CONTACTS = [
  { id: 'mail', label: 'MAIL', bearing: -52, range: 0.6 },
  { id: 'instagram', label: 'INSTAGRAM', bearing: 148, range: 0.74 },
  { id: 'linkedin', label: 'LINKEDIN', bearing: 62, range: 0.46 },
];

const RINGS = [0.25, 0.5, 0.75, 1];
const R = 180;                    // dish radius in the 400 × 400 viewBox
const rad = (deg) => (deg * Math.PI) / 180;
const pt = (deg, r) => `${(Math.cos(rad(deg)) * r).toFixed(1)} ${(Math.sin(rad(deg)) * r).toFixed(1)}`;

/** Static dish: range rings, cross-hair, bearing ticks and — until the canvas takes over — a resting beam. */
function dish() {
  const ticks = Array.from({ length: 72 }, (_, i) => `M${pt(i * 5, R)}L${pt(i * 5, R + (i % 6 === 0 ? 9 : 4))}`).join('');
  // The beam's afterglow: thin sectors, fainter the further they trail behind the leading edge.
  const beam = Array.from({ length: 9 }, (_, i) => {
    const a0 = -30 - i * 6;
    return `<path d="M0 0L${pt(a0, R)}A${R} ${R} 0 0 0 ${pt(a0 - 6, R)}Z" opacity="${(0.3 * (1 - i / 9) ** 1.6).toFixed(3)}"/>`;
  }).join('');
  return `<svg class="comm__dish" viewBox="-200 -200 400 400" aria-hidden="true" focusable="false">
        ${RINGS.map((k) => `<circle class="comm__ring" r="${R * k}"/>`).join('')}
        <path class="comm__cross" d="M${-R} 0H${R}M0 ${-R}V${R}"/>
        <path class="comm__ticks" d="${ticks}"/>
        <g class="comm__rest"><g class="comm__beam">${beam}</g><path class="comm__edge" d="M0 0L${pt(-30, R)}"/></g>
        <circle class="comm__core" r="4"/>
      </svg>`;
}

function blip({ id, label, bearing, range }) {
  const x = 50 + Math.cos(rad(bearing)) * range * 45;   // the dish spans 90% of the scope box
  const y = 50 + Math.sin(rad(bearing)) * range * 45;
  return `<span class="comm__blip" data-comm-blip="${id}" data-bearing="${bearing}" data-range="${range}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%"><i></i>${label}</span>`;
}

function transmission(p, i, total) {
  return `<div class="comm__tx">
          <p class="comm__tx-head" aria-hidden="true"><span class="comm__tx-idx">${pad2(i + 1)}</span><span class="comm__tx-rule"></span><span class="comm__tx-state">RECEIVED ${pad2(i + 1)}/${pad2(total)}</span></p>
          <p class="comm__tx-body">${p.html}</p>
        </div>`;
}

export function comm(contact, site) {
  const [user, domain] = site.email.split('@');
  const total = contact.paragraphs.length;
  return `<section class="comm container" data-fx="comm">
  <header class="comm__head" data-reveal-group>
    <p class="label comm__kicker" data-reveal aria-hidden="true"><i class="comm__led"></i><span data-scramble>COMM LINK</span><span class="label__sep"></span><span>CHANNEL OPEN</span></p>
    <h2 class="comm__title"${split.label(contact.title)}>${split.html(contact.title)}</h2>
    <p class="comm__subtitle" data-reveal>${esc(contact.subtitle)}</p>
  </header>

  <div class="comm__deck">
    <div class="comm__console" data-reveal>
      <p class="comm__bar" aria-hidden="true"><span><i class="comm__led"></i>MISSION CONTROL</span><span>RX ${pad2(total)} TRANSMISSIONS</span></p>
      <p class="comm__lead">${esc(contact.lead)}</p>
      <div class="prose comm__log">
        ${contact.paragraphs.map((p, i) => transmission(p, i, total)).join('\n        ')}
      </div>
      ${corners}
    </div>

    <div class="comm__scope" aria-hidden="true" data-reveal="fade">
      <div class="comm__screen">
        ${dish()}
        ${CONTACTS.map(blip).join('\n        ')}
        <span class="comm__deg comm__deg--n">000</span><span class="comm__deg comm__deg--e">090</span><span class="comm__deg comm__deg--s">180</span><span class="comm__deg comm__deg--w">270</span>
      </div>
      <p class="comm__readout"><span>SIG <b data-comm-out="sig">––</b></span><span>BRG <b data-comm-out="brg">–––</b></span><span>LINK <b data-comm-out="link">STANDBY</b></span></p>
    </div>
  </div>

  <div class="comm__channel" data-reveal>
    <p class="comm__mail">
      <span class="label comm__mail-label">${esc(contact.emailLabel)}</span>
      <a class="comm__email" href="mailto:${esc(site.email)}" data-comm-channel="mail"><span class="comm__email-text">${esc(user)}@<wbr>${esc(domain)}</span></a>
    </p>
    <div class="comm__wave" aria-hidden="true"></div>
    <div class="comm__actions">
      <button class="btn comm__copy" type="button" data-comm-copy data-copy-text="${esc(site.email)}" hidden><span class="btn__label" data-comm-copy-label>COPY ADDRESS</span>${COPY_ICON}</button>
      <ul class="comm__social">
        <li data-comm-channel="instagram">${button({ href: site.social.instagram, label: 'Instagram', external: true })}</li>
        <li data-comm-channel="linkedin">${button({ href: site.social.linkedin, label: 'LinkedIn', external: true })}</li>
      </ul>
      <p class="comm__status" role="status" aria-live="polite" data-comm-status></p>
    </div>
  </div>
</section>`;
}
