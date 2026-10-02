#!/usr/bin/env node
// Zero-dependency static site generator for the Aurora Rocketry website.
//
//   node build.mjs                     build into dist/
//   node build.mjs --out <dir>         build somewhere else
//   node build.mjs --base /sub         prefix every internal URL (hosting under a sub-path)
//   node build.mjs --serve [--port N]  build, then serve the output (default port 5173)
//   node build.mjs --serve --watch     … and rebuild when src/, content/ or public/ change
//
// Pipeline: clean → copy public/ → concatenate + strip CSS → copy JS + write the FX registry →
// hash every asset → render pages → verify every local reference → sitemap.xml, robots.txt.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const WATCHED = ['src', 'content', 'public'];
/** Written into every output folder: only a folder that is empty or a previous build is ever emptied. */
const MARKER = '.aurora-build';
const isBuildOutput = (dir) => fs.existsSync(path.join(dir, MARKER));

// ── CLI ────────────────────────────────────────────────────────────────────
/** A mistake on the command line: reported without a stack trace. */
class UsageError extends Error {}

function parseArgs(argv) {
  const opt = { out: 'dist', base: '', port: 5173, serve: false, watch: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--serve') opt.serve = true;
    else if (a === '--watch') opt.watch = true;
    else if (a === '--out' || a === '--base' || a === '--port') {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      opt[a.slice(2)] = a === '--port' ? Number(v) : v;
    } else throw new UsageError(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(opt.port) || opt.port < 0 || opt.port > 65535) throw new UsageError('--port must be a number between 0 and 65535');
  // "/sub/" and "sub" both become "/sub"; "/" becomes "".
  opt.base = opt.base.replace(/^\/*|\/*$/g, '');
  if (opt.base) opt.base = '/' + opt.base;
  opt.out = path.resolve(ROOT, opt.out);
  // The output folder is emptied on every build: keep it away from anything precious.
  if (isInside(ROOT, opt.out)) throw new UsageError('--out must not be the repository itself or one of its parents');
  if (WATCHED.some((d) => isInside(opt.out, path.join(ROOT, d)))) throw new UsageError('--out must not be inside src/, content/ or public/');
  if (fs.existsSync(opt.out) && fs.readdirSync(opt.out).length && !isBuildOutput(opt.out)) {
    throw new UsageError(`--out ${opt.out} is not empty and was not created by this build — refusing to empty it`);
  }
  return opt;
}

/** True when `child` is `parent` itself or lies below it. */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ── small fs helpers ───────────────────────────────────────────────────────
const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, 'utf8');
const hash = (data) => crypto.createHash('sha1').update(data).digest('hex').slice(0, 8);
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}
/** Files directly inside `dir` with the given extension, sorted by name ([] when the folder is missing). */
function list(dir, ext) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ext) && !f.startsWith('.')).sort().map((f) => path.join(dir, f));
}
/** Every file below `dir`, depth-first. */
function walk(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const notJunk = (src) => path.basename(src) !== '.DS_Store';

// ── CSS ────────────────────────────────────────────────────────────────────
/**
 * Drops comments, indentation and empty lines (about 40% of the stylesheet, which blocks the first
 * paint). Quoted strings and unquoted url(…) values are copied untouched; line breaks are kept, so
 * the output still reads and debugs like the sources.
 */
function stripCss(css) {
  const rawUrl = /url\(\s*[^'")\s][^)]*\)/y;
  let out = '';
  for (let i = 0; i < css.length;) {
    const ch = css[i];
    rawUrl.lastIndex = i;
    const url = ch === 'u' ? rawUrl.exec(css) : null;
    if (url) {
      out += url[0];
      i += url[0].length;
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out.split('\n').map((line) => line.trim()).filter(Boolean).join('\n') + '\n';
}

function buildCss(base) {
  const css = path.join(SRC, 'css');
  const files = [
    ...['tokens.css', 'fonts.css', 'base.css', 'pages.css'].map((f) => path.join(css, f)).filter(exists),
    ...list(path.join(css, 'components'), '.css'),
    ...list(path.join(css, 'fx'), '.css'),
  ];
  const out = stripCss(files.map(read).join('\n'));
  // Root-absolute url(/…) references (fonts, images) must follow the --base prefix too.
  return base ? out.replace(/url\(\s*(['"]?)\/(?!\/)/g, `url($1${base}/`) : out;
}

// ── JS + FX registry ───────────────────────────────────────────────────────
/** Reads the optional "// @fx-when: <selector>" and "// @fx-order: <n>" header comments of a module. */
function fxMeta(file) {
  const head = read(file).split('\n').slice(0, 30).join('\n');
  const when = /^\s*\/\/\s*@fx-when:\s*(.+?)\s*$/m.exec(head);
  const order = /^\s*\/\/\s*@fx-order:\s*(-?\d+(?:\.\d+)?)\s*$/m.exec(head);
  return { name: path.basename(file, '.js'), when: when ? when[1] : null, order: order ? Number(order[1]) : 50 };
}
/**
 * Copies src/js as it is and writes the FX registry next to it. Returns the registry and the
 * content hash of every script ({ 'fx/hud.js': 'a1b2c3d4', … }): pages address each module by
 * its hash (import map in layout.mjs), so a deploy can never pair new code with a cached module.
 */
function buildJs(out) {
  const src = path.join(SRC, 'js');
  const dest = path.join(out, 'assets', 'js');
  if (exists(src)) fs.cpSync(src, dest, { recursive: true, filter: notJunk });
  const modules = list(path.join(src, 'fx'), '.js').map(fxMeta)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const registry = '// Generated by build.mjs from src/js/fx/*.js — do not edit.\n'
    + `export default ${JSON.stringify(modules, null, 2)};\n`;
  write(path.join(dest, 'fx-registry.js'), registry);
  const hashes = {};
  for (const file of walk(dest).sort()) hashes[path.relative(dest, file).split(path.sep).join('/')] = hash(fs.readFileSync(file));
  return { modules, hashes };
}

// ── images ─────────────────────────────────────────────────────────────────
/** True when a raster file cannot contain transparency (JPEG, or PNG without alpha / tRNS). */
function isOpaqueImage(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return true;
  if (ext !== '.png') return false;
  const buf = fs.readFileSync(file);
  const colorType = buf[25]; // IHDR: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA
  if (colorType === 4 || colorType === 6) return false;
  return !buf.includes(Buffer.from('tRNS'));
}

// ── reference check ────────────────────────────────────────────────────────
/** Local (root-absolute) URLs referenced by a page: href, src, poster, data-src, srcset, imagesrcset. */
function localRefs(html) {
  const refs = new Set();
  for (const m of html.matchAll(/\s(?:href|src|poster|data-src)="([^"]*)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/\s(?:srcset|imagesrcset)="([^"]*)"/g)) {
    for (const part of m[1].split(',')) refs.add(part.trim().split(/\s+/)[0]);
  }
  return [...refs].filter((r) => r.startsWith('/') && !r.startsWith('//'));
}
function checkRefs(pages, out, base) {
  const problems = [];
  for (const page of pages) {
    for (const ref of localRefs(page.html)) {
      const clean = decodeURI(ref.replace(/[?#].*$/, ''));
      if (base && clean !== base && !clean.startsWith(base + '/')) { problems.push(`${page.file}: "${ref}" ignores the base prefix "${base}"`); continue; }
      let file = path.join(out, clean.slice(base.length));
      if (exists(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!exists(file)) problems.push(`${page.file}: "${ref}" does not exist in the output`);
    }
  }
  if (problems.length) throw new Error(`Broken references:\n  ${problems.join('\n  ')}`);
}

// ── build ──────────────────────────────────────────────────────────────────
async function build({ out, base }) {
  const t0 = performance.now();
  fs.rmSync(out, { recursive: true, force: true });
  write(path.join(out, MARKER), 'Output of build.mjs — this folder is emptied on every build.\n');
  fs.cpSync(path.join(ROOT, 'public'), out, { recursive: true, dereference: true, filter: notJunk });

  const css = buildCss(base);
  write(path.join(out, 'assets', 'css', 'site.css'), css);
  const { modules, hashes } = buildJs(out);
  const version = { css: hash(css), js: hashes };

  const data = JSON.parse(read(path.join(ROOT, 'content', 'site.json')));
  for (const project of data.projects.items) {
    project.rocket.opaque = isOpaqueImage(path.join(ROOT, 'public', project.rocket.src));
  }

  const { renderSite } = await import(pathToFileURL(path.join(SRC, 'templates', 'index.mjs')).href);
  const pages = renderSite(data, { base, version, modules, root: ROOT });
  const seen = new Set();
  for (const page of pages) {
    if (typeof page.html !== 'string' || /\bundefined\b|\[object Object\]|\bNaN\b/.test(page.html.replace(/<script[\s\S]*?<\/script>/g, ''))) {
      throw new Error(`Template for ${page.file} produced "undefined", "NaN" or "[object Object]"`);
    }
    if (seen.has(page.file)) throw new Error(`Two pages write to ${page.file}`);
    seen.add(page.file);
    write(path.join(out, page.file), page.html);
  }
  checkRefs(pages, out, base);

  const origin = data.site.url.replace(/\/$/, '');
  const urls = pages.filter((p) => p.url).map((p) => `  <url><loc>${origin}${base}${p.url}</loc></url>`).join('\n');
  write(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  write(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}${base}/sitemap.xml\n`);

  const ms = Math.round(performance.now() - t0);
  console.log(`Built ${pages.length} pages → ${path.relative(ROOT, out) || out}${base ? ` (base ${base})` : ''} in ${ms} ms`);
  for (const page of pages) console.log(`  ${page.file.padEnd(40)} ${(Buffer.byteLength(page.html) / 1024).toFixed(1).padStart(6)} kB`);
  console.log(`  css ${(Buffer.byteLength(css) / 1024).toFixed(1)} kB · fx modules: ${modules.map((m) => m.name).join(', ') || 'none'}`);
}

// ── dev server ─────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
};

function serve({ out, base, port }) {
  const resolve = (pathname) => {
    if (base) {
      if (pathname !== base && !pathname.startsWith(base + '/')) return null;
      pathname = pathname.slice(base.length) || '/';
    }
    let file = path.join(out, path.normalize(pathname));
    if (file !== out && !file.startsWith(out + path.sep)) return null; // path traversal
    if (exists(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    return exists(file) && fs.statSync(file).isFile() ? file : null;
  };

  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end('Bad request'); return; }
    let status = 200;
    let file = resolve(pathname);
    if (!file) {
      status = 404;
      file = path.join(out, '404.html');
      if (!exists(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 — not found'); return; }
    }
    const size = fs.statSync(file).size;
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    // Range requests: browsers need them to seek/loop <video>.
    const range = status === 200 && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(status, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });

  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use — pass --port <n>.` : err);
    process.exit(1);
  });
  server.listen(port, () => console.log(`\nServing ${path.relative(ROOT, out) || out} at http://localhost:${server.address().port}${base}/`));
}

// ── watch ──────────────────────────────────────────────────────────────────
/**
 * Rebuilds in a child process on every change: a fresh process is the only reliable way to
 * reload the whole template module graph (ESM imports are cached per process).
 */
function watch(opt) {
  let timer = null;
  let running = false;
  let queued = false;
  const rebuild = () => {
    if (running) { queued = true; return; }
    running = true;
    const args = [fileURLToPath(import.meta.url), '--out', opt.out, ...(opt.base ? ['--base', opt.base] : [])];
    spawn(process.execPath, args, { stdio: 'inherit' }).on('exit', (code) => {
      running = false;
      if (code) console.error('Build failed — still serving the previous output where possible.');
      if (queued) { queued = false; rebuild(); }
    });
  };
  const onChange = (_event, file) => {
    if (file && path.basename(String(file)) === '.DS_Store') return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 120);
  };
  for (const dir of WATCHED.map((d) => path.join(ROOT, d)).filter(exists)) {
    try {
      fs.watch(dir, { recursive: true }, onChange);
    } catch {
      // Recursive watching is unavailable (Linux with Node < 20): watch every folder individually.
      const dirs = (d) => [d, ...fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => dirs(path.join(d, e.name)))];
      for (const d of dirs(dir)) fs.watch(d, onChange);
    }
  }
  console.log(`Watching ${WATCHED.join('/, ')}/ for changes…`);
}

// ── main ───────────────────────────────────────────────────────────────────
try {
  const opt = parseArgs(process.argv.slice(2));
  await build(opt);
  if (opt.serve) serve(opt);
  if (opt.watch) watch(opt);
} catch (err) {
  console.error(`\nBuild failed: ${err instanceof UsageError ? err.message : err.stack || err}`);
  process.exit(1);
}
