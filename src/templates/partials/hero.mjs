// Home hero: the drone footage as a full-bleed "camera feed" (grain, scanlines, corner marks and
// a timecode), the giant two-line wordmark, kicker + slogan and a scroll cue.
// Styles: src/css/components/hero.css (static) and src/css/fx/hero.css (motion, fx/hero.js).
//
// The <video> ships without a src: main.js copies data-src → src and plays it only when effects
// are enabled, the user did not ask for reduced motion and Save-Data is off. Otherwise (and
// without JS) the poster stays and the feed reads "STBY".

import { esc, url } from '../lib.mjs';

/** Viewports shorter than this keep the static hero: no scroll runway (fx/hero.js reads it from data-min-stage). */
const MIN_STAGE_H = 480;
/** How long after the load event the runway stays reserved for a hero module that has not started yet. */
const RUNWAY_HOLD_MS = 4000;

/**
 * Runs before the hero is painted, when effects are going to run (html.fx-boot, set by the head
 * snippet).
 *
 *   hero-boot   reserves the scroll runway of the hero (fx/hero.css), so the page has its final
 *               height from the first layout: the position the browser restores on a reload or a
 *               history jump, and the anchor it aims at, are right without any correction.
 *               fx/hero.js takes the class over when it starts. If it has not by RUNWAY_HOLD_MS
 *               after the load event it is not coming (it failed to load), and the hero goes back
 *               to the static composition. With the ?fx= debug switch of main.js, which may leave
 *               the module out, nothing is reserved at all
 *   hero-intro  the opening sequence plays once per session, on a direct landing — never behind
 *               the page transition curtain. The class keeps the hero unpainted while html.fx-boot
 *               lasts (main.js drops it once the effect modules have started, the head snippet
 *               after 2.5 s at the latest); fx/hero.js takes over from there. Keep the storage
 *               key in step with fx/hero.js
 */
const GATE = `(function(c,w){if(!c.contains('fx-boot'))return;`
  + `if(w.innerHeight>=${MIN_STAGE_H}&&!/[?&]fx=/.test(w.location.search)){c.add('hero-boot');`
  + `w.addEventListener('load',function(){setTimeout(function(){c.remove('hero-boot')},${RUNWAY_HOLD_MS})})}`
  + `try{if(!c.contains('is-entering')&&!sessionStorage.getItem('aurora:intro'))c.add('hero-intro')}catch(e){}`
  + `})(document.documentElement.classList,window)`;

export function hero(home, site) {
  const h = home.hero;
  return `<script>${GATE}</script>
<section class="hero" data-fx="hero" data-min-stage="${MIN_STAGE_H}">
  <div class="hero__stage">
    <div class="hero__feed">
      <video class="hero__video" muted loop playsinline preload="none" poster="${url(h.poster)}" data-src="${url(h.video)}" aria-label="${esc(h.videoAlt)}"></video>
      <span class="hero__grain" aria-hidden="true"></span>
      <span class="hero__shade" aria-hidden="true"></span>
    </div>
    <div class="hero__osd" aria-hidden="true">
      <span class="hero__outline"></span>
      <span class="hero__mark hero__mark--tl"><span class="hero__tag">CAM 01</span></span>
      <span class="hero__mark hero__mark--tr"><span class="hero__tag"><i class="hero__led"></i><span data-hero="state">STBY</span></span></span>
      <span class="hero__mark hero__mark--bl"><span class="hero__tag" data-hero="timecode">00:00:00:00</span></span>
      <span class="hero__mark hero__mark--br"><span class="hero__tag hero__tag--bar"><i data-hero="progress"></i></span></span>
    </div>
    <div class="hero__inner container">
      <h1 class="hero__title" aria-label="${esc(site.name)}"><span class="hero__word hero__word--a" aria-hidden="true">${esc(h.titleA)}</span><span class="hero__word hero__word--b" aria-hidden="true">${esc(h.titleB)}</span></h1>
      <div class="hero__meta">
        <span class="hero__horizon" aria-hidden="true"></span>
        <p class="hero__kicker">${esc(h.kicker)}</p>
        <p class="hero__slogan">${esc(h.slogan)}</p>
      </div>
    </div>
    <a class="hero__cue" href="#stats" data-no-transition aria-label="Scroll to the team in numbers">
      <span class="hero__cue-label" aria-hidden="true">SCROLL</span>
      <span class="hero__cue-line" aria-hidden="true"></span>
    </a>
  </div>
</section>`;
}
