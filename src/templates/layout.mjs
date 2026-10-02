// The document shell shared by every page. The <body> skeleton is the global DOM contract
// described in docs/ARCHITECTURE.md §3 — FX modules mount into #fx-sky, #fx-hud and #fx-overlay.

import { esc, url, absolute, version, script, modules } from './lib.mjs';
import { header } from './partials/header.mjs';
import { footer } from './partials/footer.mjs';

/**
 * Runs before the stylesheet, so its classes are in place for the very first paint. Keep it in
 * step with src/js/core.js (FX_KEY and the default) and src/js/fx/transition.js (FLAG).
 *
 *   js           replaces no-js at once (no flash of the no-JS navigation while main.js loads)
 *   is-entering  the previous page left through the transition curtain: start covered. The flag
 *                is consumed here, so a page that never runs transition.js cannot leave it behind
 *   fx-boot      effects are going to run: content that animates in is not painted first in its
 *                final state (reveal.css). main.js removes the class once the effect modules have
 *                started; the timer removes it if they never do, so nothing stays hidden
 */
const BOOT = `(function(r,w){var s=null,m=w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches,n=0;`
  + `try{s=localStorage.getItem('aurora:fx')}catch(e){}`
  + `try{if(sessionStorage.getItem('aurora:nav')){sessionStorage.removeItem('aurora:nav');n=1}}catch(e){}`
  + `r.className=r.className.replace('no-js','js');`
  + `if(s===null?!m:s==='1'){r.classList.add('fx-boot');if(n)r.classList.add('is-entering');`
  + `setTimeout(function(){r.classList.remove('fx-boot')},2500)}})(document.documentElement,window)`;

/** <link rel="preload"> for a first-paint image the preload scanner cannot see (a <video poster>). */
const preloadImage = (src) => (src ? `\n<link rel="preload" as="image" href="${url(src)}" fetchpriority="high">` : '');

const preloadFont = (file) => `<link rel="preload" as="font" type="font/woff2" href="${url(`/fonts/${file}`)}" crossorigin>`;

// ── scripts ────────────────────────────────────────────────────────────────
/**
 * Import map: every script of the site → the same path plus its content hash. The modules import
 * each other by plain relative paths ('../core.js'); the browser resolves those and then looks
 * the result up here, so the whole module graph is fetched by hashed URLs without a bundler
 * rewriting the sources — and core.js is still one module instance. Scripts can therefore be
 * cached for good: a deploy changes the URL of exactly the files that changed. (A browser without
 * import maps simply requests the plain paths.) Must come before the first modulepreload.
 */
function importMap() {
  const imports = {};
  for (const file of Object.keys(version().js)) imports[url(`/assets/js/${file}`)] = script(file);
  return `<script type="importmap">${JSON.stringify({ imports })}</script>`;
}

/** Opening tags of an HTML string as [{ tag, attrs: { name: value } }]. */
function tagsOf(html) {
  return Array.from(html.matchAll(/<([a-z][a-z0-9-]*)((?:\s[^<>]*)?)>/gi), ([, tag, rest]) => {
    const attrs = {};
    for (const [, name, value = ''] of rest.matchAll(/([^\s=/"]+)(?:="([^"]*)")?/g)) attrs[name.toLowerCase()] = value;
    return { tag: tag.toLowerCase(), attrs };
  });
}

/**
 * Build-time stand-in for `document.querySelector(selector) !== null`, for the selectors modules
 * declare in "@fx-when": lists of tags, classes, ids, [attr] and [attr="value"], with descendant
 * combinators (only checked for presence, not for nesting). Anything fancier counts as "no":
 * a preload is an optimisation — main.js still decides at run time what a page loads.
 */
function inMarkup(selector, tags) {
  const compound = /^([a-z][a-z0-9-]*|\*)?((?:[.#][\w-]+|\[[\w-]+(?:=(?:"[^"]*"|'[^']*'|[\w-]+))?\])*)$/i;
  const present = (part) => {
    const m = compound.exec(part);
    if (!m) return false;
    const tests = Array.from(m[2].matchAll(/([.#])([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g), ([, kind, name, attr, value]) => {
      if (kind === '.') return (a) => (a.class || '').split(/\s+/).includes(name);
      if (kind === '#') return (a) => a.id === name;
      return (a) => attr in a && (value === undefined || a[attr] === value);
    });
    const tag = m[1] && m[1] !== '*' ? m[1].toLowerCase() : null;
    return tags.some((t) => (!tag || t.tag === tag) && tests.every((test) => test(t.attrs)));
  };
  return selector.split(',').some((list) => list.trim().split(/\s+/).every(present));
}

/**
 * <link rel="modulepreload"> for the module graph of this page: main.js, what it imports, and the
 * FX modules whose "@fx-when" selector matches the markup. Without them the browser discovers the
 * graph one level at a time (main → core → registry → modules), each a network round trip, while
 * html.fx-boot keeps the animated content unpainted.
 */
function preloadScripts(body) {
  const tags = tagsOf(body);
  const fx = modules().filter((m) => !m.when || inMarkup(m.when, tags)).map((m) => `fx/${m.name}.js`);
  return ['main.js', 'core.js', 'fx-registry.js', ...fx].map((file) => `<link rel="modulepreload" href="${script(file)}">`).join('\n');
}

/**
 * page: { url, id, slug?, title?, description?, preload?, noindex?, main }
 *   preload  URL of an image to preload (home: the hero video poster)
 *   url   output path ("/projects/nemesis/"), or null for 404.html
 *   id    value of <body data-page>
 *   title page name; omitted on the home page, whose title is the site name alone
 */
export function layout(site, page) {
  const title = page.title ? `${page.title} — ${site.name}` : site.name;
  const description = page.description || site.description;
  const canonical = page.url ? absolute(site, page.url) : '';
  const ogImage = absolute(site, site.ogImage);

  const body = `<body data-page="${esc(page.id)}"${page.slug ? ` data-slug="${esc(page.slug)}"` : ''}>
  <a class="skip-link" href="#main" data-no-transition>Skip to content</a>
  <div id="fx-sky" aria-hidden="true"></div>
  ${header(site, page)}
  <main id="main" class="page">
${page.main}
  </main>
  ${footer(site)}
  <div id="fx-hud"></div>
  <div id="fx-overlay" aria-hidden="true"></div>
  <script type="module" src="${script('main.js')}" onerror="document.documentElement.className='no-js'"></script>
  <script nomodule>document.documentElement.className='no-js'</script>
</body>`;

  return `<!doctype html>
<html lang="${esc(site.lang)}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">${page.noindex ? '\n<meta name="robots" content="noindex">' : ''}${canonical ? `\n<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta name="theme-color" content="#03040a">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">${canonical ? `\n<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="icon" type="image/png" href="${url('/favicon.png')}">
<link rel="apple-touch-icon" href="${url('/apple-touch-icon.png')}">
${['archivo-latin.woff2', 'space-grotesk-latin.woff2', 'jetbrains-mono-latin.woff2'].map(preloadFont).join('\n')}${preloadImage(page.preload)}
<script>${BOOT}</script>
${importMap()}
<link rel="stylesheet" href="${url('/assets/css/site.css')}?v=${version().css}">
${preloadScripts(body)}
</head>
${body}
</html>
`;
}
