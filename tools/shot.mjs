#!/usr/bin/env node
// Headless screenshot + console-capture helper (dev tool, not shipped).
//
//   node tools/shot.mjs --root dist --path /projects/nemesis/ --out /tmp/a.png
//   node tools/shot.mjs --url https://example.com --out /tmp/b.png --full
//
// Flags
//   --root <dir[,dir]>  serve <dir> on an ephemeral port (default: dist); several
//                       comma-separated dirs are overlaid, first match wins (e.g. ".,public")
//   --path <path>       path to open on that server (default: /)
//   --url <url>         open an absolute URL instead of --root/--path
//   --out <file.png>    final screenshot (optional)
//   --browser <name>    chromium (default, installed Brave/Chrome), webkit (≈ Safari) or firefox
//   --viewport WxH      default 1440x900
//   --dpr <n>           device scale factor (default 1)
//   --mobile            390x844, touch, dpr 2 (overridable by --viewport)
//   --full              full-page screenshot
//   --wait <ms>         settle time after load (default 1200)
//   --reduced-motion    emulate prefers-reduced-motion: reduce
//   --steps '<json>'    array of actions run after --wait, in order:
//        {"move":[x,y],"steps":25}   mouse move (interpolated)
//        {"path":[[x,y],[x,y]],"steps":15}  several moves
//        {"click":[x,y]}  {"down":[x,y]}  {"up":true}
//        {"hover":"css selector"}  {"clickSel":"css selector"}
//        {"scroll":1200}  absolute scrollY   {"scrollBy":400}   {"scrollTo":"css selector"}
//        {"wheel":600}    real wheel event at current mouse position
//        {"key":"Escape"} {"type":"text"}
//        {"wait":500}
//        {"eval":"js expression"}   result is printed as JSON
//        {"shot":"/tmp/x.png","full":false}  intermediate screenshot
//        {"goto":"/other/path"}     navigate (same origin when using --root)
//
// Prints console errors/warnings, uncaught page errors and failed requests.
// Exit code: 0 ok, 1 if uncaught page errors or console errors occurred, 2 usage/launch failure.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, firefox } from 'playwright-core';

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) opt[k] = true;
  else { opt[k] = next; i++; }
}

const BROWSERS = [
  process.env.BROWSER_PATH,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
// --browser webkit|firefox uses Playwright's own builds (npx playwright-core install webkit firefox);
// the default drives an installed Chromium-based browser.
const engine = opt.browser === 'webkit' ? webkit : opt.browser === 'firefox' ? firefox : chromium;
const executablePath = engine === chromium ? BROWSERS.find((p) => fs.existsSync(p)) : undefined;
if (engine === chromium && !executablePath) {
  console.error('No Chromium-based browser found. Set BROWSER_PATH.');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

// `root` may be a comma-separated list: the first directory containing the file wins
// (e.g. --root .,public serves /src/js/core.js from the repo and /fonts/x.woff2 from public/).
function resolveFile(roots, p) {
  for (const abs of roots) {
    let file = path.join(abs, p);
    if (!file.startsWith(abs)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    else if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

function serve(root) {
  const roots = String(root).split(',').map((r) => path.resolve(r.trim()));
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      const file = resolveFile(roots, p);
      if (!file && p === '/favicon.ico') { res.writeHead(204).end(); return; } // browsers always ask for it
      if (!file) throw new Error('not found');
      const stat = fs.statSync(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : stat.size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

let server = null;
let origin = '';
let target = opt.url;
if (!target) {
  const s = await serve(opt.root || 'dist');
  server = s.server; origin = s.origin;
  target = origin + (opt.path || '/');
}

const mobile = !!opt.mobile;
const [vw, vh] = String(opt.viewport || (mobile ? '390x844' : '1440x900')).split('x').map(Number);
const dpr = Number(opt.dpr || (mobile ? 2 : 1));

let code = 0;
const browser = await engine.launch(engine === chromium ? {
  executablePath,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=metal', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
} : { headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: dpr,
    hasTouch: mobile,
    ...(engine === firefox ? {} : { isMobile: mobile }), // Firefox has no isMobile emulation
    reducedMotion: opt['reduced-motion'] ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  let errors = 0;
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') {
      if (t === 'error') errors++;
      console.log(`[console.${t}] ${m.text()}`);
    } else if (opt.verbose) console.log(`[console.${t}] ${m.text()}`);
  });
  page.on('pageerror', (e) => { errors++; console.log(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`); });
  page.on('requestfailed', (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText || '')) console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`); });

  await page.goto(target, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(Number(opt.wait ?? 1200));

  let mouse = [vw / 2, vh / 2];
  const steps = opt.steps ? JSON.parse(opt.steps) : [];
  for (const s of steps) {
    if (s.move) { await page.mouse.move(s.move[0], s.move[1], { steps: s.steps ?? 25 }); mouse = s.move; }
    else if (s.path) { for (const pt of s.path) { await page.mouse.move(pt[0], pt[1], { steps: s.steps ?? 15 }); mouse = pt; } }
    else if (s.click) { await page.mouse.click(s.click[0], s.click[1]); mouse = s.click; }
    else if (s.down) { await page.mouse.move(s.down[0], s.down[1]); await page.mouse.down(); mouse = s.down; }
    else if (s.up) { await page.mouse.up(); }
    else if (s.hover) { await page.hover(s.hover, { timeout: 5000 }); }
    else if (s.clickSel) { await page.click(s.clickSel, { timeout: 5000 }); }
    else if (s.scroll !== undefined) { await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), s.scroll); }
    else if (s.scrollBy !== undefined) { await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'instant' }), s.scrollBy); }
    else if (s.scrollTo) { await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'instant' }), s.scrollTo); }
    else if (s.wheel !== undefined) { await page.mouse.wheel(0, s.wheel); }
    else if (s.key) { await page.keyboard.press(s.key); }
    else if (s.type) { await page.keyboard.type(s.type); }
    else if (s.wait !== undefined) { await page.waitForTimeout(s.wait); }
    else if (s.eval) { const r = await page.evaluate(s.eval); console.log(`[eval] ${JSON.stringify(r)}`); }
    else if (s.shot) { await page.screenshot({ path: s.shot, fullPage: !!s.full }); console.log(`[shot] ${s.shot}`); }
    else if (s.goto) { await page.goto(s.goto.startsWith('http') ? s.goto : origin + s.goto, { waitUntil: 'load' }); }
  }

  if (opt.out) {
    await page.screenshot({ path: opt.out, fullPage: !!opt.full });
    console.log(`[shot] ${opt.out}`);
  }
  console.log(`[done] ${target} errors=${errors}`);
  if (errors) code = 1;
} catch (e) {
  console.log(`[fatal] ${e.message}`);
  code = 2;
} finally {
  await browser.close();
  server?.close();
}
process.exit(code);
