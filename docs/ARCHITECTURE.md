# Aurora Rocketry — site architecture & contracts

A static, dependency-free rebuild of <https://aurorarocketry.eu> with the **same informational
content** and a strong layer of interactive visual effects. This document is the contract every
file in the repo follows.

## 1. Art direction — "Night launch under the aurora"

The visitor is in mission control during a night launch; the page is the sky.

- **Mood**: deep space black/navy, aurora ribbons in the brand colours, precise HUD linework,
  telemetry in monospace. Cinematic but engineering-grade: nothing cartoonish, no emoji, no stock
  gradients-on-white. Density of an aerospace dashboard, calm of a night sky.
- **Palette** (all in `src/css/tokens.css`): coral `#FF5151` (primary accent, logo red), navy
  `#1D2C60`, blue `#6B96ED`, aurora green `#2EE6A6` (sparingly), amber `#FFB257` (exhaust).
  Backgrounds `--c-void` / `--c-night`. Text `--c-ink`, secondary `--c-mute`.
- **Type**: `--font-display` Archivo variable, always expanded + black (`font-stretch: 125%`,
  weight 800–900), uppercase — it stands in for the original's Integral CF. `--font-body` Space
  Grotesk. `--font-mono` JetBrains Mono for labels, HUD, numbers, small caps captions.
- **Signature motifs**
  - the **stepped red line** that flanks section titles on the original site (`.step-title`);
  - **HUD corner brackets** `⌜ ⌟` around interactive/visual elements;
  - **telemetry labels** (`ALT`, `VEL`, `T+`), coordinates, section indices like `01 / 05`;
  - the three hexagonal **mission patches** (Borealis 2024, Nemesis EUROC 2025, Atlas EUROC 2026);
  - the **Nemesis livery** (navy body, coral nose, coral-edged fins) for the cursor rocket.
- **Copy**: all body text comes verbatim from `content/site.json`. UI micro-copy added by effects
  (HUD labels, "SCROLL", "LOCK", "FX ON") must be short, uppercase, English, and must not invent
  facts about the team (no made-up numbers, dates, names).

## 2. Repository layout

```
build.mjs               zero-dependency static generator (+ --serve / --watch / --out / --base)
content/site.json       ALL copy + image references (source of truth; generated from the live site)
content/images.json     image manifest (src, w, h, optional src800)
public/                 copied verbatim to the site root: img/, video/, fonts/, favicon.png …
src/templates/*.mjs     page templates (plain JS template literals → HTML strings)
src/templates/partials/ component partials (hero, blueprint, orbit, …)
src/css/tokens.css      design tokens            (do not put rules here)
src/css/fonts.css       @font-face (self-hosted)
src/css/base.css        reset, typography, layout, header, footer, buttons, shared components
src/css/pages.css       page-specific layout
src/css/components/<name>.css   styles of one template partial (hero, blueprint, orbit, comm, partners…)
src/css/fx/<name>.css   styles owned by the FX module of the same name
src/js/core.js          shared runtime (state, ticker, bus, helpers)  ← read this file
src/js/main.js          bootstrap: imports core, site chrome (mobile menu, header state), loads FX modules
src/js/fx/<name>.js     one effect per file (auto-discovered by the build, see §4)
dev/<name>.html         standalone test harness for an FX module (not shipped)
tools/shot.mjs          headless screenshots + console capture (see §7)
docs/                   this file, CONTENT-NOTES.md
dist/                   build output (git-ignored)
```

### Output URLs (keep the original site's paths)

`/`, `/projects/`, `/projects/{borealis,nemesis,atlas}/`, `/departments/`,
`/departments/{aerodinamica,propulsione,gnc,software,structure,msa,elettronica,recovery,pr}/`,
`/partners/`, `/contact/`, `/404.html`, plus `sitemap.xml`, `robots.txt`.
Each page is `dist/<path>/index.html`. Assets: `/assets/css/site.css` (all CSS concatenated in the
order tokens → fonts → base → pages → components/* → fx/*, each folder alphabetical) and `/assets/js/**` (a 1:1 copy of
`src/js/**`, native ES modules, no bundler). Everything under `public/` is served from `/`.
All internal URLs are root-absolute and pass through a `BASE` prefix (`--base /sub`) in templates.

## 3. Page skeleton & global DOM contract

```html
<html lang="en" class="no-js">           <!-- core.js swaps to .js and adds .fx-on|.fx-off, .pointer-fine|.pointer-coarse, .reduced-motion -->
<body data-page="home|projects|project|departments|department|partners|contact|404" data-slug="nemesis">
  <a class="skip-link" href="#main">Skip to content</a>
  <div id="fx-sky" aria-hidden="true"></div>        <!-- fixed, z: --z-sky; sky.js mounts here -->
  <header class="site-header" data-header> … <nav class="site-nav"> <a class="site-nav__link" aria-current="page"> … </header>
  <main id="main" class="page"> … </main>             <!-- position: relative; z: --z-content -->
  <footer class="site-footer"> … </footer>
  <div id="fx-hud"></div>                            <!-- fixed, z: --z-hud; hud.js mounts here (NOT aria-hidden: it holds the FX toggle button) -->
  <div id="fx-overlay" aria-hidden="true"></div>     <!-- fixed, z: --z-overlay, pointer-events: none; rocket.js mounts here -->
  <script type="module" src="/assets/js/main.js"></script>
</body>
```

The `<head>` contains this inline snippet **before** the stylesheet link, so the page-transition
curtain can cover the page before first paint (styles for `html.is-entering` live in
`src/css/fx/transition.css`):

```html
<script>/* see src/templates/layout.mjs for the exact text */</script>
```

The snippet (1) swaps `no-js` → `js` immediately, (2) mirrors core.js's decision on whether
effects will be on (localStorage `aurora:fx`, else not `prefers-reduced-motion`) and, if so, adds
`html.fx-boot` — content that animates in (`[data-reveal]`, `[data-split]`) is hidden under that
class before first paint; `main.js` removes it once the modules have started and a 2.5 s timer is
the failsafe — and (3) consumes the sessionStorage flag `aurora:nav` and adds `html.is-entering`
when the page was reached through the transition curtain. Other state classes on `<html>`:
`has-hud` (HUD mounted; the footer adds bottom padding), `egg-live` (launch show running).

**Progressive enhancement is mandatory.** With JS disabled, with `html.fx-off`, or with
`prefers-reduced-motion`, every page must show all content, fully readable and navigable.
Any CSS that hides content for a later animation must be scoped under `html.js.fx-on`.

### Declarative hooks (markup ↔ FX modules)

| Hook | Owner module | Behaviour |
|---|---|---|
| `[data-reveal]` = `up` (default) \| `fade` \| `left` \| `right` \| `scale` \| `clip` \| `custom`; optional `data-reveal-delay="120"` (ms) | `reveal.js` | adds `.is-inview` once when the element enters the viewport. `custom` = class toggle only, no built-in animation (the component styles its own `.is-inview` state). Hidden initial states apply only under `html.reveal-ready` (class added by reveal.js at init) so content never stays invisible if the module fails |
| `[data-reveal-group]` on a parent | `reveal.js` | staggers its `[data-reveal]` children (sets `--reveal-i`) |
| `[data-split]` = `chars` \| `words` | `reveal.js` | wraps text in `.char` / `.word` spans with `--i`; keeps accessible text via `aria-label` + `aria-hidden` pieces |
| `[data-scramble]` (optional value `hover`) | `reveal.js` | decode/scramble text effect on enter (and on hover) |
| `[data-count="90"]` + `data-suffix="+"` | `reveal.js` | counts up from 0 when in view; final text must equal the server-rendered text |
| `[data-parallax="0.15"]` | `reveal.js` | translateY proportional to scroll |
| `.step-title[data-reveal="custom"]` | base.css | section title flanked by the stepped red lines; lines draw in (stroke-dashoffset) when `.is-inview` |
| `[data-tilt]` (opt. `data-tilt-max="10"`, `data-tilt-glare`) | `tilt.js` | 3D tilt following the pointer; sets `--rx --ry --mx --my` (deg / 0–1) |
| `[data-magnetic]` (opt. strength `0.35`) | `tilt.js` | element is attracted to the pointer |
| `a[href]`, `button`, `[data-lock]` | `rocket.js` | the cursor rocket "locks on" (reticle brackets snap to the element) |
| `[data-no-lock]` | `rocket.js` | exclude an element (or subtree) from lock-on |
| same-origin `a[href]` without `target`, `download`, `data-no-transition` | `transition.js` | animated page transition |
| `[data-fx="hero"]` | `hero.js` | home hero |
| `[data-fx="blueprint"]` | `blueprint.js` | project-detail rocket explorer |
| `[data-fx="orbit"]` | `orbit.js` | departments orbital map |
| `[data-fx="comm"]` | `comm.js` | contact "comm link" console |
| `[data-fx="projects"]` | `projects.js` | projects index (roll-out lanes, trajectory) |
| `[data-sky-vivid]` (also `.subhero`, `[data-fx="hero"]`) | `sky.js` | the aurora is vivid only above the bottom edge of the first matching element and calm below it |
| `main figure` (`.frame` from `lib.mjs`) | `lightbox.js` | click / Enter enlarges the figure in an accessible dialog |

Server-rendered text is always the real, final text (effects may scramble it and must restore it).

## 4. `src/js/core.js` — shared runtime (already written; read it)

```js
import { core } from '../core.js';          // from src/js/fx/*.js
core.env      // { reducedMotion, coarse, fine, touch, dpr, saveData, lowPower }
core.fx       // { enabled }  — false when the user turned effects off or prefers reduced motion (default)
core.viewport // { w, h }
core.pointer  // { x, y, nx, ny, vx, vy, speed, active, inside, down, type, lastMove, target }
core.scroll   // { y, max, progress, velocity, direction }
core.rocket   // { x, y, vx, vy, angle, speed, boost, visible, locked } — written by rocket.js, read by others
core.time     // { now, dt, frame }
core.layers   // { sky, overlay, hud }  → the fixed containers above
core.tick(fn(dt, now), { order, always })   // the ONE rAF loop. Paused when tab hidden or fx disabled (unless always)
core.on(name, fn) / core.emit(name, detail) // returns unsubscribe
core.setFx(bool) / core.toggleFx()
core.env.base  // the --base prefix ('' or '/sub')
core.modules   // { name: whatever that module's init() returned } — handy for debugging
core.utils    // clamp lerp damp map mapClamp smoothstep rand randInt pick angleDiff TAU ease qs qsa cssVar createCanvas inView
```

Bus events: `pointermove`, `pointerdown`, `pointerup`, `pointerleave`, `pointerenter`, `scroll`,
`resize`, `visibility` (bool), `fx:change` (bool), and module events:

| Event | Emitted by | Detail | Consumers |
|---|---|---|---|
| `burst` | anyone | `{ x, y, power = 1, color?, light? }` (client px; `color` may be a token name like `'--c-aurora'`; power ≥ 1.5 = firework shell; `light: false` = no sky flash) | `rocket.js` spawns a particle burst there, `sky.js` flashes |
| `lock` | `rocket.js` | `{ el }` or `null` | `hud.js` (shows target name) |
| `boost` | anyone | `{ power = 1 (0–2), duration = 0.6 }` | `rocket.js` afterburner |
| `navigate:start` | `transition.js` | `{ href }` | `rocket.js` (fly away), `sky.js` (warp) |
| `intro:done` | `hero.js` | – | others may wait for it |
| `navigate:cancel` | `transition.js` | – | page is still/again here after an exit (stall, bfcache restore): rocket relaunches, sky clears the warp |
| `launch:pad` / `launch:liftoff` / `launch:end` | `egg.js` | – | rocket goes to the pad, ascends, returns |
| `blueprint:zone` | `blueprint.js` | active subsystem | project pages |
| `launch` | `egg.js` / hud | – | full-screen launch easter egg |

### Module discovery

`build.mjs` scans `src/js/fx/*.js` and writes `/assets/js/fx-registry.js`
(`export default [{ name, when }]`). `main.js` imports every listed module with dynamic
`import()` (`Promise.allSettled`, one failing module never breaks the others) and calls its
default export. A module may declare, in a comment on its first lines, when it is needed:

```js
// @fx-when: [data-fx="hero"]      ← CSS selector; the module is only fetched on pages that match
// @fx-order: 10                   ← optional load/init order (lower first; default 50)
```

So adding an effect = adding `src/js/fx/<name>.js` (+ `src/css/fx/<name>.css`); nobody edits
`main.js`. Debug switches handled by `main.js`: `?fx=none` loads no FX modules,
`?fx=sky,rocket` loads only those.

### Module shape

```js
// src/js/fx/<name>.js
import { core } from '../core.js';
export default function init() {
  // feature-detect, bail out silently if the hook element is missing
  // return optional { destroy() }
}
```

Rules for every FX module:

1. **One loop**: use `core.tick`; never call `requestAnimationFrame` in a loop yourself, never add
   your own `scroll`/`pointermove`/`resize` listeners (use `core.on`). Element-level listeners
   (`pointerenter` on a card, `click`) are fine.
2. **Respect `core.fx.enabled`**: when false, render a tasteful static state (or nothing) and do no
   per-frame work. React to `fx:change` so the HUD toggle works live, both directions.
3. **Never block input**: canvases and overlays are `pointer-events: none` and `aria-hidden`.
4. **Performance budget**: 60 fps on a 2020 laptop with all global effects running. Cap canvas DPR
   (`createCanvas` does, default 2; use 1.5 or lower for full-screen shaders), pool particles (no
   per-frame allocations in hot loops), avoid layout reads in `tick` (cache rects; refresh on
   `resize`/`scroll`), animate only `transform`/`opacity`/custom properties on DOM nodes.
5. **Touch / coarse pointers**: there is no hover. Provide a meaningful touch behaviour or degrade
   to the static state; never hide the native cursor on coarse pointers.
6. **Self-contained styles** in `src/css/fx/<name>.css`, using tokens only. Class prefix = module
   name (`.rocket-…`, `.hud-…`) to avoid collisions.
7. **No external requests, no dependencies**, no `eval`, no console noise (errors only).
8. **Fail soft**: wrap risky setup (WebGL) in try/catch and fall back.

## 5. Layering

`#fx-sky` (0) < `.page`/header/footer content (1) < header (50) < `#fx-hud` (60) <
`#fx-overlay` rocket canvas (80) < transition curtain (90) < modal/countdown (100).
The body background is `--c-void`; sections are transparent by default so the sky shows through.

## 6. Content model (`content/site.json`)

`site` (name, description, nav, email, social, copyright, subpageHero), `home` (hero, stats,
about[], projectsTitle), `projects.items[]` (slug, name, badge, patch, rocket, overview[], specs[],
sections[] with id/title/text[]/image/zone), `departments.items[]` (slug, name, title, cta,
overview[], indexImage, sections[] with optional `list`), `partners.tiers[]` (items with name, href,
logo src/w/h, `plate`: `light` | `dark` = the background the logo needs), `contact`.
Images: `{ src, w, h, alt, src800? }` → always output `width`/`height`, `loading="lazy"` (except
above the fold), `decoding="async"`, and `srcset` when `src800` exists.

## 7. Testing with `tools/shot.mjs`

Headless Chromium (Brave) driver; prints console errors, uncaught errors, failed requests.

```bash
# built site
node build.mjs --out .tmp/dist-mine
node tools/shot.mjs --root .tmp/dist-mine --path /projects/nemesis/ --out /tmp/x.png
# full page / mobile / reduced motion
node tools/shot.mjs --root .tmp/dist-mine --path / --full --out /tmp/home-full.png
node tools/shot.mjs --root .tmp/dist-mine --path / --mobile --out /tmp/home-mobile.png
node tools/shot.mjs --root .tmp/dist-mine --path / --reduced-motion --out /tmp/home-rm.png
# standalone harness for one module, served straight from the repo (public/ overlaid for /fonts, /img)
node tools/shot.mjs --root .,public --path /dev/rocket.html --out /tmp/r.png \
  --steps '[{"move":[200,200]},{"path":[[900,300],[1200,700],[300,600]],"steps":30},{"wait":400},{"shot":"/tmp/r1.png"},{"click":[600,400]},{"wait":120},{"eval":"window.__aurora.rocket"}]'
```

Safari check: add `--browser webkit` (Playwright's WebKit build is installed; `firefox` is wired
but may fail to launch on this machine). Run the key pages in WebKit too before calling a job done.

Steps: `move`, `path`, `click`, `down`/`up`, `hover`, `clickSel`, `scroll`, `scrollBy`, `scrollTo`,
`wheel`, `key`, `type`, `wait`, `eval`, `shot`, `goto` (see the header of the tool).
Look at your screenshots (they are PNG files you can open) — judging the visual result is part
of the job. When several agents work at once, **always build into your own `--out` directory**
and write screenshots to your own temp folder; never build into `dist/` concurrently.

## 8. Reserved screen zones (HUD)

The HUD (`fx/hud.js`) owns: a thin status bar docked to the bottom edge of the viewport
(`--hud-bar-h`, 30 px, full width; fixed/sticky page UI must stay above it; `[data-hud-clear]` on an
element makes the altimeter fade while that element is under it) and the altimeter on the right edge (≈ 92 px wide column, vertically centred;
a 3 px strip on small screens). Page components must keep their own fixed/sticky UI and the
important first-viewport content out of those zones (e.g. hero bottom rows end ≥ 48 px above the
viewport bottom; nothing important in the rightmost 92 px on desktop).

## 9. Ownership after stage 1 (who may edit what)

| Area | Files |
|---|---|
| Integration / global | `build.mjs`, `src/js/core.js`, `src/js/main.js`, `src/templates/{index,layout,lib}.mjs`, `partials/{header,footer,subhero}.mjs`, `src/css/{base,pages}.css`, `components/subhero.css`, global FX `fx/{sky,rocket,hud,reveal,tilt,transition,egg}.{js,css}` |
| Home | `src/templates/home.mjs`, `partials/hero.mjs`, `components/{hero,home}.css`, `fx/hero.{js,css}`, `fx/home.{js,css}` |
| Projects | `src/templates/projects.mjs`, `partials/blueprint.mjs`, `components/{blueprint,projects}.css`, `fx/blueprint.{js,css}`, `fx/projects.{js,css}` |
| Departments | `src/templates/departments.mjs`, `partials/orbit.mjs`, `components/{orbit,departments}.css`, `fx/orbit.{js,css}`, `fx/lightbox.{js,css}` |
| Partners / contact / 404 | `src/templates/pages.mjs`, `partials/{partners,comm}.mjs`, `components/{partners,comm,lost}.css`, `fx/{partners,comm,lost}.{js,css}` |

Page areas override shared styles from their own `components/*.css` (loaded after `pages.css`),
never by editing `base.css` / `pages.css`. `lib.mjs` helpers keep a backward-compatible API.
