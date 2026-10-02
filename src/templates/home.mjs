// Home page: hero, the three team figures as instruments, "about the team" with framed mission
// photographs, and the projects as waypoints on a flight path.
// Styles: src/css/components/home.css; motion: src/css/fx/home.css + src/js/fx/home.js.

import fs from 'node:fs';
import { esc, url, pad2, paragraphs, button, stepTitle, feature, indexLabel, img, corners } from './lib.mjs';
import { hero } from './partials/hero.mjs';

// ── figures ────────────────────────────────────────────────────────────────

/**
 * One figure on a dial: a tick ring, a sweep that closes while the number counts up (reveal.js
 * [data-count]; the timing is matched in CSS) and the caption with its coral marker.
 * The final number is server-rendered; the count must end on this exact text.
 */
function gauge(item, i) {
  return `<li class="gauge" data-reveal>
      <div class="gauge__dial">
        <svg class="gauge__ring" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
          <g class="gauge__bezel"><circle class="gauge__ticks" cx="100" cy="100" r="95"/><circle class="gauge__majors" cx="100" cy="100" r="93.5"/></g>
          <circle class="gauge__track" cx="100" cy="100" r="84"/>
          <circle class="gauge__sweep" cx="100" cy="100" r="84"/>
          <g class="gauge__needle"><path d="M100 10v9"/><circle cx="100" cy="16" r="2.4"/></g>
        </svg>
        <span class="gauge__index" aria-hidden="true">${pad2(i + 1)}</span>
        <span class="gauge__value" data-count="${item.value}" data-suffix="${esc(item.suffix)}">${item.value}${item.suffix ? `<span class="gauge__suffix">${esc(item.suffix)}</span>` : ''}</span>
      </div>
      <p class="gauge__label"><strong>${esc(item.strong)}</strong> ${esc(item.rest)}</p>
    </li>`;
}

// ── about ──────────────────────────────────────────────────────────────────

/**
 * A photograph mounted as a mission plate: the print with its data strip, a ghost outline behind
 * it and HUD brackets in front. The three layers drift at different rates ([data-parallax]),
 * which gives the plate its depth. The caption repeats the alt text, so it is hidden from
 * assistive tech.
 */
function plate(image, i, total) {
  const ratio = Math.min(1.6, Math.max(1.2, image.w / image.h));   // prints are cropped to a calm range of proportions
  return `<figure class="plate">
  <span class="plate__ghost" aria-hidden="true" data-parallax="0.07"></span>
  <div class="plate__print" data-reveal="clip" data-parallax="0.025">
    <div class="plate__tilt" data-tilt data-tilt-max="5" data-tilt-glare>
      <div class="plate__photo" style="--ar:${ratio.toFixed(3)}">${img(image, { sizes: '(min-width: 900px) 46vw, 92vw' })}</div>
      <div class="plate__strip" aria-hidden="true">
        <span class="plate__tag">FIG. ${pad2(i + 1)}</span>
        <span class="plate__text">${esc(image.alt)}</span>
        <span class="plate__count">${pad2(i + 1)}/${pad2(total)}</span>
      </div>
    </div>
  </div>
  <span class="plate__hud" aria-hidden="true" data-parallax="-0.035">${corners}</span>
</figure>`;
}

// ── projects ───────────────────────────────────────────────────────────────

// The trajectory is plotted twice: here, for the page as it is served, and by fx/home.js through
// the medallions it measures in the browser. Neither file can import the other (this one runs in
// Node, that one in the page), so the two share the numbers below through data attributes on the
// field, and curve() exists in both — the build stops if the two copies ever differ.
const LIFTOFF = 1.8;   // slope of the leg that comes in from the left edge, in slopes of the first leg between waypoints
const COAST = 0.7;     // slope of the leg that leaves by the right edge, in slopes of the last one

/** Smooth curve through the points (Catmull-Rom → cubic Béziers). */
function curve(points) {
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  const xy = (p) => `${+p[0].toFixed(1)} ${+p[1].toFixed(1)}`;
  let d = `M${xy(points[0])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += ` C${xy([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${xy([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${xy(p2)}`;
  }
  return d;
}

/** Build-time check: the copy of curve() in fx/home.js is this one, character for character. */
function assertCurveInStep() {
  const twin = /^function curve\(points\) \{\n[\s\S]*?\n\}$/m.exec(fs.readFileSync(new URL('../js/fx/home.js', import.meta.url), 'utf8'));
  if (twin?.[0] !== curve.toString()) throw new Error('home.mjs: curve() differs from its copy in src/js/fx/home.js — the two must change together');
}

/**
 * The ascent on wide screens: every waypoint sits higher than the one before, on a curve that
 * flattens towards the latest mission. `lift` is how many steps (home.css --step) a waypoint is
 * pushed down; the same numbers place the path that is drawn without JS, in a viewBox where a
 * column is 200 units wide and a step 100 units tall (the box is laid out to match by home.css).
 * fx/home.js then replaces it with a path measured from the real layout, and draws the vertical
 * one on narrow screens.
 */
function ascent(count) {
  const top = count - 1;
  const lifts = Array.from({ length: count }, (_, i) => +(top * (1 - (top ? i / top : 0) ** 0.62)).toFixed(2));
  const nodes = lifts.map((lift, i) => [100 + 200 * i, 75 + 100 * lift]);
  // both end legs span half a column (the edge to the nearest waypoint), the legs between waypoints a whole one
  const start = [0, nodes[0][1] + (count > 1 ? (nodes[0][1] - nodes[1][1]) * 0.5 * LIFTOFF : 100)];
  const end = [200 * count, nodes[top][1] - (count > 1 ? (nodes[top - 1][1] - nodes[top][1]) * 0.5 * COAST : 30)];
  const path = curve([start, ...nodes, end]);
  return { lifts, path, viewBox: `0 0 ${200 * count} ${100 * (lifts[0] + 2)}` };
}

/**
 * One mission on the flight path. Its button is the link for keyboards and screen readers. The
 * medallion is a second way in for pointers only: an empty link laid over the patch (inside the
 * tilting layer, so it tilts along), out of the tab order and of the accessibility tree — the
 * patch keeps its description, and nobody meets the same destination twice in a row. The label
 * is what the HUD shows when the cursor rocket locks on to it.
 */
function waypoint(project, i, total, lift) {
  return `<li class="waypoint" style="--i:${i};--lift:${lift}" data-reveal>
        <div class="waypoint__medal">
          <span class="waypoint__halo" aria-hidden="true"><i class="waypoint__ping"></i></span>
          <span class="waypoint__float"><span class="waypoint__tilt" data-tilt data-tilt-max="14" data-tilt-holo>${img(project.patch, { sizes: '(min-width: 980px) 18rem, 58vw' })}<a class="waypoint__link" href="${url(project.href)}" tabindex="-1" aria-hidden="true" aria-label="${esc(project.cta)}"></a></span></span>
        </div>
        <p class="waypoint__meta"><span class="label waypoint__index" data-scramble>${pad2(i + 1)} / ${pad2(total)}</span><span class="badge">${esc(project.badge)}</span></p>
        <h3 class="waypoint__name">${esc(project.name)}</h3>
        ${button({ href: project.href, label: project.cta })}
      </li>`;
}

export function home({ site, home: page, projects }) {
  const about = page.about.map((block, i, all) => feature({
    id: block.id,
    title: block.title,
    splitTitle: true,
    label: indexLabel(i, all.length),
    body: paragraphs(block.text),
    cta: button({ href: block.cta.href, label: block.cta.label }),
    media: plate(block.image, i, all.length),
    flip: i % 2 === 1,
  })).join('\n');

  assertCurveInStep();
  const flight = ascent(projects.items.length);

  return {
    url: '/',
    id: 'home',
    preload: page.hero.poster,
    main: `${hero(page, site)}

<section class="section gauges" id="stats" aria-label="The team in numbers">
  <ul class="gauges__list container" role="list" data-reveal-group>
    ${page.stats.map(gauge).join('\n    ')}
  </ul>
</section>

<section class="section" id="about" aria-labelledby="about-title">
  ${stepTitle(page.aboutTitle, { id: 'about-title' })}
  <div class="features container">
${about}
  </div>
</section>

<section class="section" id="projects" aria-labelledby="projects-title">
  ${stepTitle(page.projectsTitle, { id: 'projects-title' })}
  <div class="flight__field container" data-fx="flight" data-liftoff="${LIFTOFF}" data-coast="${COAST}" style="--count:${flight.lifts.length};--rise:${flight.lifts[0]}">
    <svg class="flight__path" viewBox="${flight.viewBox}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path class="flight__plan" d="${flight.path}"/>
      <path class="flight__burn" d="${flight.path}"/>
    </svg>
    <span class="flight__marker" aria-hidden="true"><svg viewBox="-10 -10 20 20" focusable="false"><path d="M9 0-6-6-2.5 0-6 6Z"/></svg></span>
    <ol class="flight__list" role="list" data-reveal-group>
      ${projects.items.map((p, i, all) => waypoint(p, i, all.length, flight.lifts[i])).join('\n      ')}
    </ol>
  </div>
</section>`,
  };
}
