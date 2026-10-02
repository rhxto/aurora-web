# Aurora Rocketry — website

A static, dependency-free rebuild of <https://aurorarocketry.eu> (Aurora Rocketry, the University
of Bologna student rocketry team): the same content as the original site, with a layer of
interactive visual effects on top — an aurora sky, a rocket that follows the pointer, a flight
display, scroll choreography, page transitions and a showpiece effect on every page.

There is no framework and no bundler. `build.mjs` turns `content/site.json` and the templates in
`src/templates/` into plain HTML, concatenates the CSS and copies the JavaScript (native ES
modules) as it is. Node 18 or newer is all you need.

## Build, develop, preview

```bash
node build.mjs                    # build into dist/
node build.mjs --serve --watch    # dev: build, serve http://localhost:5173, rebuild on change
node build.mjs --serve            # preview the build (use --port 8080 for another port)
```

The same commands are available as `npm run build`, `npm run dev` and `npm run preview`.

| Flag | Default | Meaning |
|---|---|---|
| `--out <dir>` | `dist` | output folder (emptied on every build) |
| `--base <prefix>` | none | prefix for every internal URL, for hosting under a sub-path |
| `--serve` | off | serve the output after building (directories → `index.html`, unknown paths → `404.html`, Range requests for the video) |
| `--port <n>` | `5173` | port for `--serve` |
| `--watch` | off | rebuild when anything in `src/`, `content/` or `public/` changes |

The build stops with a non-zero exit code when a template throws, when the content file lacks a
field a template needs, or when a page references a local file (image, page, script) that does
not exist in the output.

## Deploy

`dist/` is a complete static site: upload it to any static host (Netlify, Cloudflare Pages,
GitHub Pages, S3, a plain web server). Nothing runs on the server.

- **At the root of a domain**: `node build.mjs`, publish `dist/`.
- **Under a sub-path** (for example `https://example.org/aurora/`):
  `node build.mjs --base /aurora`, then publish `dist/` so that it is reachable at `/aurora/`.
  Every link, asset URL and `url()` in the CSS gets the prefix; the scripts find it by themselves
  (`core.env.base`).
- Configure the host to serve `404.html` for unknown paths (most static hosts do it by default).
- `sitemap.xml`, `robots.txt` and the canonical / Open Graph URLs are built from `site.url` in
  `content/site.json` — change it there if the site moves to another domain.
- `site.css` and `main.js` are referenced with a content hash (`?v=…`), so they can be cached
  for a long time; HTML should be served with a short cache lifetime.

## Where things live

```
content/site.json        ALL copy and image references — edit text here, nowhere else
content/images.json      image manifest (source of the w/h/src800 values used in site.json)
public/                  copied verbatim to the site root: img/, video/, fonts/, favicon.png …
src/templates/           page templates (plain JS template literals → HTML)
  index.mjs              route table: which pages exist and where they are written
  layout.mjs             <head> (incl. the inline boot snippet) and the <body> skeleton of every page
  lib.mjs                helpers: esc(), url(), img(), button(), stepTitle(), frame(), feature() …
  home.mjs, projects.mjs, departments.mjs, pages.mjs     one file per page family
  partials/              header, footer, hero, subhero, blueprint, orbit, partners, comm
src/css/tokens.css       design tokens (colours, type, spacing, motion, layers)
src/css/base.css         reset, typography, header, footer, buttons, shared components
src/css/pages.css        shared page layout
src/css/components/      one file per template partial / page area
src/css/fx/              one file per effect module
src/js/core.js           shared runtime: state, the single animation loop, event bus, helpers
src/js/main.js           site chrome (menu, header, hero video) + effect loader
src/js/fx/               one effect per file
dev/                     standalone harness pages for the global effects (not shipped)
tools/shot.mjs           headless screenshots + console capture (development only)
docs/ARCHITECTURE.md     art direction and the contracts between markup, CSS and effects
docs/CONTENT-NOTES.md    how the copy was taken from the original site
```

### Editing content

Change `content/site.json` and rebuild. Text is HTML-escaped automatically; only
`contact.paragraphs[].html` is inserted as HTML. To add an image, put the file in `public/img/…`
and reference it as `{ "src", "w", "h", "alt" }` (plus `src800` when an 800px-wide variant
exists). To add a project or a department, add an item to the corresponding list — its page, the
navigation between pages and the sitemap follow automatically (`href` must be
`/projects/<slug>/` or `/departments/<slug>/`).

## Effects

Every effect is a self-contained module that enhances markup which already works without it.
The site is fully readable and navigable with JavaScript disabled, with effects switched off and
with `prefers-reduced-motion`.

| Module | Runs on | What it does |
|---|---|---|
| `sky` | every page | WebGL aurora + starfield behind the page; vivid behind the hero, calm behind the content |
| `rocket` | every page | the cursor rocket: follows the pointer, locks on to links and buttons (also on keyboard focus), bursts on click |
| `hud` | every page | flight display: status bar at the bottom edge (telemetry, LAUNCH, the FX switch) and the scroll altimeter |
| `reveal` | every page | scroll reveals, kinetic titles, decode text, counters, parallax |
| `tilt` | every page | 3D tilt and magnetic hover |
| `transition` | every page | the curtain between pages |
| `egg` | every page | the launch sequence (LAUNCH in the status bar, or type `launch`) |
| `hero`, `home` | home | hero intro and home sections |
| `projects`, `blueprint` | projects | mission index and the rocket explorer |
| `departments`, `orbit`, `lightbox` | departments | index, orbital map, figure viewer |
| `partners`, `comm`, `lost` | partners, contact, 404 | their showpieces |

### Add an effect

1. Create `src/js/fx/<name>.js`:

   ```js
   // @fx-when: [data-fx="hero"]     (optional) CSS selector — load only on pages that match
   // @fx-order: 20                  (optional) lower starts first; default 50
   import { core } from '../core.js';

   export default function init() {
     const el = document.querySelector('[data-fx="hero"]');
     if (!el) return;
     core.tick((dt, now) => { /* per-frame work, paused when effects are off */ });
     core.on('fx:change', (enabled) => { /* switch between live and static state */ });
   }
   ```

2. Put its styles in `src/css/fx/<name>.css` (tokens only, class prefix = module name).
3. Rebuild. The build lists the modules in `assets/js/fx-registry.js`; `main.js` imports the
   ones the page needs and calls their default export. Nobody edits `main.js`.

Read `docs/ARCHITECTURE.md` before writing one: it describes the markup hooks (`data-reveal`,
`data-tilt`, `data-fx="…"` …), the shared runtime and the rules every module follows (one
animation loop, no global listeners, graceful fallbacks, the screen zones reserved for the HUD).

Two things worth knowing when an effect hides content to animate it in:

- Scope the hidden state under `html.js.fx-on` plus a class your module adds once it runs.
- The inline snippet in `<head>` adds `html.fx-boot` before first paint when effects are going to
  run, and `main.js` removes it as soon as the modules have started (or a timer does after 2.5 s
  if they never start). Hide the same content under `html.fx-boot` and it will not flash in its
  final state before your module takes over. `[data-reveal]` and `[data-split]` elements get this
  for free.

### Turn effects off

- **Visitors**: the `FX` switch at the right end of the status bar (the choice is remembered in
  `localStorage`; the bar stays, on standby, so the switch is always there). Effects also start
  switched off when the system asks for reduced motion.
- **While developing**: add `?fx=none` to any URL to load no effect module at all, or
  `?fx=sky,rocket` to load only the ones named.
- **Remove one for good**: delete its `src/js/fx/<name>.js` and `src/css/fx/<name>.css`, rebuild.
- **From code**: `core.setFx(false)` (also available in the console as `__aurora.setFx(false)`).

In the console, `__aurora` is the shared runtime and `__aurora.modules.<name>` is whatever a
module's `init()` returned (for example `__aurora.modules.rocket.debug()`).

## Checking a change

```bash
node build.mjs --out .tmp/check
node tools/shot.mjs --root .tmp/check --path /projects/nemesis/ --full --out .tmp/nemesis.png
node tools/shot.mjs --root .tmp/check --path / --mobile --out .tmp/home-mobile.png
node tools/shot.mjs --root .tmp/check --path / --reduced-motion --out .tmp/home-rm.png
node tools/shot.mjs --root .tmp/check --path /contact/ --browser webkit --out .tmp/contact-safari.png
# script an interaction and read values back
node tools/shot.mjs --root .tmp/check --path / --out .tmp/hover.png \
  --steps '[{"move":[400,300]},{"hover":".btn"},{"wait":600},{"eval":"__aurora.rocket.locked?.textContent"}]'
# a single effect in its harness, straight from the sources
node tools/shot.mjs --root .,public --path /dev/rocket.html --out .tmp/rocket.png
```

`tools/shot.mjs` drives a locally installed Chromium-based browser through `playwright-core`
(the only dev dependency: `npm install`), prints console errors and failed requests, and can
script pointer moves, scrolling, clicks and key presses — see the header of the file.
`--browser webkit` runs the same check in Playwright's WebKit build, the closest thing to Safari
(`npx playwright-core install webkit` once).
