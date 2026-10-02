// @fx-order: 5
// THE SKY — the living background of every page, mounted in #fx-sky (core.layers.sky).
//
//   .sky-aurora  WebGL1 canvas, rendered at a fraction of the CSS resolution and stretched by CSS:
//                an aurora borealis seen from the ground. The curtains are vertical sheets
//                standing on noise-warped arcs; each view ray is marched through them, so
//                perspective turns their striations into rays and their folds into hems.
//   .sky-stars   2D canvas at device resolution: three parallax depth layers, twinkle, a few
//                bright stars with diffraction spikes, the occasional shooting star.
//
// Modes
//   animated  fx on + WebGL        → shader + stars every frame (core.tick)
//   css       fx on, no WebGL      → stars every frame over the CSS aurora of sky.css
//   static    fx off / reduced motion → ONE still frame, then no per-frame work at all
// On a page nobody is touching (core.time.idle) the animated modes draw every other frame: the
// sky drifts slowly enough for 30 fps, and it is the most expensive thing on screen. A warp, a
// burst or a shooting star brings the full rate back for as long as it lasts.
//
// Legibility: the shader caps the aurora's relative luminance (WCAG definition) so that
// --c-ink text passes AA even over the brightest ray. The aurora is at full strength only behind
// the page's hero (the element matching HERO, above its bottom edge — the "fold") and at the top
// of the page; behind the content below the fold, and everywhere once the page is scrolled past
// the first viewport, it stays at CALM intensity (then --c-mute text passes too).

import { core } from '../core.js';

const { clamp, damp, lerp, smoothstep, rand, cssVar, createCanvas } = core.utils;

const QUALITY_SCALES = [0.45, 0.36, 0.28, 0.2]; // aurora buffer size relative to CSS pixels
const MAX_PIXELS = 300000;                    // …and never more than this many (large monitors)
const QUALITY_KEY = 'aurora:sky-q';           // sessionStorage: quality never climbs back up in a session
const EPOCH_KEY = 'aurora:sky-t0';            // sessionStorage: the sky keeps evolving across page loads
const SLOW_FRAME_MS = 20;                     // average frame time that counts as a slow window…
const SAMPLE_FRAMES = 90;                     // …of this many frames; two slow windows in a row step quality down
const WARMUP_FRAMES = 45;                     // ignored after start / a quality change (shader compile, page load)
const CALM = 0.14;                            // aurora intensity (linear light) once past the first viewport
const CALM_OPACITY = Math.pow(CALM, 1 / 2.2); // the same dimming expressed as a CSS opacity (gamma space)
const STILL_TIME = 424;                       // shader clock of the still frame / of a session's first frame
const WARP_MS = 600;
const MAX_BURSTS = 4;                         // keep in sync with uBurst[4] in the shader
const HERO = '[data-sky-vivid], .subhero, [data-fx="hero"]'; // the aurora is vivid behind this element only

// ── aurora shader ──────────────────────────────────────────────────────────
const VERT = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

const FRAG = `
precision highp float;      // required: the noise hash falls apart in mediump (checked before compiling)

uniform vec2 uRes;          // drawing buffer size
uniform float uTime;        // seconds
uniform float uVivid;       // 1 at the top of the page → 0 (calm) further down
uniform float uFold;        // uv.y of the hero's bottom edge: the content below it gets a calm sky
uniform float uClimb;       // 0..1 scroll progress: the camera gains altitude
uniform float uDrift;       // phase offset driven by pointer x
uniform float uWarp;        // 0..1 page-transition surge
uniform vec3 uPointer;      // xy = position (uv, y up), z = influence
uniform vec3 uRocket;       // xy = position (uv, y up), z = light strength
uniform vec4 uBurst[4];     // xy = position, z = age 0..1, w = power
uniform vec3 uGreen, uBlue, uCoral, uNavy, uNight, uVoid; // linear RGB brand colours

const int STEPS = 18;                       // altitude slices through the curtains
const float BASE = 1.0;                     // altitude of the curtains' lower edge
const float TOP = 2.4;                      // altitude where the rays die out
const float ARCS = 0.55;                    // arcs per unit of distance
const float SKIRT = 0.06;                   // the march starts this far below the lower edge
const float SHEET = 0.03;                   // half-thickness of a curtain, in arc spacings
const float HALO = 0.22;                    // half-thickness of the glow around it
const float CAP = 0.135;                    // max relative luminance of the aurora (AA for --c-ink text)
const float CALM = ${CALM.toFixed(2)};                    // intensity once the page is scrolled
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash(vec2 p) {
  p = mod(p, 289.0);                        // periodic lattice keeps sin() arguments small
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float noise1(float x) {
  float i = floor(x), f = fract(x);
  return mix(hash(vec2(i, 7.0)), hash(vec2(i + 1.0, 7.0)), f * f * (3.0 - 2.0 * f));
}

// The curtains' footprint seen from above: parallel east–west arcs (integer steps of this
// coordinate) swept sideways by slow noise, then meandered and folded by sines whose phase
// rides on that noise (irregular, but one noise lookup per sample). The folds argument
// (x: coarse, y: fine) fades the hem ripples out where the march would step over them.
float arcCoord(vec2 p, float t, vec2 folds) {
  float sweep = noise(p * vec2(0.25, 0.3) + vec2(0.0, t * 0.03));
  return p.y * ARCS
    + 1.3 * sweep
    + 0.17 * sin(p.x * 1.3 + p.y * 0.9 + sweep * 7.0 + t * 0.07)
    + 0.1 * folds.x * sin(p.x * 4.1 + sweep * 11.0 + t * 0.3)
    + 0.035 * folds.y * sin(p.x * 11.3 - sweep * 17.0 - t * 0.45);
}

// Altitude of slice i: slices are denser near the sharp lower edge of the curtains.
float sliceAlt(float i) {
  float f = i / float(STEPS);
  return mix(BASE - SKIRT, TOP, f * (0.35 + 0.65 * f));
}

// Smooth 0→1 step across x = −1..1 (stands in for erf when integrating a sheet's cross-section).
float ramp(float x) {
  float s = clamp(0.5 + 0.5 * x, 0.0, 1.0);
  return s * s * (3.0 - 2.0 * s);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 s0 = (uv - 0.5) * asp;               // screen position, y in −0.5..0.5
  vec2 s = s0;

  // The pointer parts the curtains like a lens and lights them up.
  vec2 dp = s0 - (uPointer.xy - 0.5) * asp;
  float pointerGlow = uPointer.z * exp(-dot(dp, dp) * 9.0);
  s -= dp * pointerGlow * 0.3;

  // The cursor rocket is a travelling light source.
  vec2 dr = s0 - (uRocket.xy - 0.5) * asp;
  float rocketGlow = uRocket.z * exp(-dot(dr, dr) * 12.0);

  // Bursts: a soft flash that widens as it fades, and a shock ring that ripples the curtains.
  float burstGlow = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 db = s0 - (uBurst[i].xy - 0.5) * asp;
    float age = uBurst[i].z;
    float fade = uBurst[i].w * (1.0 - age) * (1.0 - age);
    float radius = 0.07 + age * 0.3;
    float dist = length(db);
    float ring = (dist - age * 0.6) / 0.08;
    burstGlow += fade * exp(-dist * dist / (radius * radius));
    s += db / max(dist, 1e-3) * fade * 0.03 * exp(-ring * ring);
  }

  s.y *= 1.0 - 0.3 * uWarp;                 // warp: the whole sky stretches upwards

  // Camera: on the ground looking up at the top of the page, pitching up as we climb.
  float pitch = 0.62 + 0.14 * uClimb;
  float focal = 1.0 * min(1.0, 0.62 + 0.38 * asp.x);   // wider field of view on portrait screens
  vec3 rd = normalize(vec3(s, focal));
  float cp = cos(pitch), sp = sin(pitch);
  rd = vec3(rd.x, rd.y * cp + rd.z * sp, rd.z * cp - rd.y * sp);

  float elev = rd.y;
  float horizon = smoothstep(0.14, 0.5, elev);          // the curtains sink into haze near the horizon

  vec3 aur = vec3(0.0);
  float activity = 0.0;
  if (horizon > 0.0) {
    vec2 dir = rd.xz / max(elev, 0.05);     // where the view ray crosses a plane, per unit altitude
    float t = uTime;
    vec2 flow = vec2(uDrift + t * 0.016, uClimb * 1.2 + t * 0.006);

    // Slow fields, sampled once per pixel: where the sky is active and the green ↔ blue balance.
    vec2 pm = dir * 1.6 + flow;
    activity = smoothstep(0.2, 0.75, noise(pm * vec2(0.13, 0.22) + vec2(t * 0.012, 7.3)));
    float hue = noise(pm * vec2(0.21, 0.37) + vec2(13.1, t * 0.009));

    // March the arc coordinate n(h) up the view ray. Curtains are the sheets n = k + 0.5; the
    // light of a sheet is integrated analytically over each interval B→C (n taken as linear),
    // which keeps hems crisp and fold edges smooth with few samples. A and D are the
    // neighbouring samples: they give a slope that is continuous from one interval to the next.
    float hB = sliceAlt(0.0), hC = sliceAlt(1.0);
    vec2 folds = 1.0 / (1.0 + dir.x * dir.x * vec2(0.08, 0.5));
    float nB = arcCoord(dir * hB + flow, t, folds), nC = arcCoord(dir * hC + flow, t, folds);
    float hA = hB, nA = nB;
    for (int i = 2; i <= STEPS; i++) {
      float hD = sliceAlt(float(i));
      float nD = arcCoord(dir * hD + flow, t, folds);

      float dh = hC - hB, dn = nC - nB;
      float k0 = floor(nB - 0.5), k1 = floor(nC - 0.5);
      float crossed = abs(k1 - k0);
      // the sheet this interval crosses, or else the one nearest to either end
      float lb = floor(nB) + 0.5, lc = floor(nC) + 0.5;
      float level = crossed > 0.0 ? max(k0, k1) + 0.5 : (abs(nB - lb) < abs(nC - lc) ? lb : lc);
      float a = abs(dn) > 1e-5 ? clamp((level - nB) / dn, 0.0, 1.0) : 0.5;
      // Slope of n along the ray. Where the interval steps right through a sheet, use the
      // neighbour-smoothed slope (no banding between intervals); where the sheet is resolved
      // (ray almost tangent to it), the interval's own slope is the consistent one.
      float steep = abs(dn) / dh;
      float through = smoothstep(SHEET, 3.0 * SHEET, abs(dn));
      float slope = max(abs(mix((nC - nA) / (hC - hA), (nD - nB) / (hD - hB), a)), 0.6 * steep);
      slope = max(mix(steep, slope, through), 1e-4);

      // crisp sheet (a sheet seen edge-on is a longer path through light: folds flare up)
      float cover = abs(ramp((nC - level) / SHEET) - ramp((nB - level) / SHEET)) + max(crossed - 1.0, 0.0);
      if (cover > 0.002) {
        float hc = mix(hB, hC, a);
        float gc = (hc - BASE) / (TOP - BASE);
        float x = dir.x * hc + flow.x;
        float id = level - 0.5;
        // Three octaves of rays. Along a sheet seen edge-on the march travels far in x between
        // samples: fade the octaves it would alias (all of them where sheets pile up in one step).
        vec3 octave = vec3(5.0, 14.0, 37.0);
        vec3 fine = octave * abs(dir.x) * dh * 2.0;
        vec3 weight = vec3(0.45, 0.3, 0.25) / (1.0 + (1.0 - through) * fine * fine + 50.0 * step(1.5, crossed));
        float rays = smoothstep(0.15, 0.85, 0.5 + dot(weight, vec3(
          noise1(x * octave.x + id * 7.3 + t * 0.22),
          noise1(x * octave.y - id * 3.1 - t * 0.37),
          noise1(x * octave.z + id * 1.7 + t * 0.55)) - 0.5));
        // long stretches of an arc go quiet
        float patch = 0.15 + 0.85 * smoothstep(0.25, 0.7, noise1(x * 0.6 + id * 11.0 + t * 0.03));
        float sheet = min(cover / slope, 0.75 * dh / SHEET);
        float profile = smoothstep(-0.03, 0.012, gc) * exp(-max(gc, 0.0) * mix(8.0, 2.0, rays)) * (1.0 - smoothstep(0.65, 0.9, gc));
        profile *= 0.6 + 0.9 * exp(-max(gc, 0.0) * 16.0);   // the hem is the brightest line
        float shift = gc + (hue - 0.5) * 0.4;
        vec3 c = mix(uGreen, uBlue, smoothstep(0.05, 0.5, shift));
        c = mix(c, mix(uCoral, uBlue, 0.25) * 1.2, 0.8 * smoothstep(0.5, 1.0, gc));
        aur += c * sheet * profile * patch * (0.12 + 0.88 * rays) * (0.4 + 0.6 * hash(vec2(id, 3.0)));
      }

      // wide, faint halo around every sheet: the curtains glow
      float gm = (0.5 * (hB + hC) - BASE) / (TOP - BASE);
      float halo = abs(ramp((nC - level) / HALO) - ramp((nB - level) / HALO));
      halo = min(halo / max(steep, 1e-4), 0.75 * dh / HALO) * smoothstep(-0.04, 0.05, gm) * exp(-max(gm, 0.0) * 4.0);
      aur += mix(uGreen, uBlue, smoothstep(0.05, 0.5, gm)) * halo * 0.06;

      hA = hB; nA = nB;
      hB = hC; nB = nC;
      hC = hD; nC = nD;
    }
    aur *= horizon * (0.35 + 0.65 * activity) * 0.62;
  }

  // Full strength behind the hero only; the band eases in over the last stretch above the fold.
  float vivid = mix(CALM, 1.0, uVivid * smoothstep(uFold - 0.04, uFold + 0.14, uv.y));
  aur *= vivid * (1.0 + 1.2 * pointerGlow + 1.6 * rocketGlow + 2.5 * burstGlow + 1.5 * uWarp);

  // Hue-preserving shoulder: the aurora's luminance never exceeds the cap (transients lift it).
  float cap = CAP * vivid * (1.0 + 1.2 * uWarp + min(burstGlow, 1.5));
  float lum = dot(aur, LUMA);
  aur *= cap * (1.0 - exp(-lum / cap)) / max(lum, 1e-5);

  // Night sky: void above, navy haze on the horizon that drops away as we climb.
  vec3 sky = mix(uNight, uVoid, smoothstep(-0.1, 0.75, uv.y));
  sky += uNavy * 0.22 * exp(-max(elev, 0.0) * 7.0) * (1.0 - 0.75 * uClimb);
  sky += uGreen * 0.003 * activity * horizon * vivid;    // the aurora tints the air around it

  vec3 col = sky + aur;
  col += mix(uGreen, uBlue, 0.5) * (0.012 * pointerGlow + 0.016 * rocketGlow);
  col += mix(uBlue, uGreen, 0.35) * 0.13 * min(burstGlow, 2.0);

  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;   // dither the dark gradient
  gl_FragColor = vec4(col, 1.0);
}`;

// ── small helpers ──────────────────────────────────────────────────────────
function sessionGet(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function sessionSet(key, value) { try { sessionStorage.setItem(key, value); } catch { /* private mode */ } }

/** "r, g, b" token (0–255) → [r, g, b] 0–1, or the fallback when the stylesheet is missing. */
function tokenRgb(name, fallback) {
  const parts = cssVar(name).split(',').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts.map((v) => v / 255) : fallback;
}
/** "#rrggbb" token → [r, g, b] 0–1. */
function tokenHex(name, fallback) {
  const m = /^#([0-9a-f]{6})$/i.exec(cssVar(name));
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
const toLinear = (rgb) => rgb.map((v) => Math.pow(v, 2.2));
/** CSS colour of `a` mixed toward `b` by t (both [r, g, b] 0–1). */
const mixCss = (a, b, t, alpha = 1) => `rgba(${a.map((v, i) => Math.round(lerp(v, b[i], t) * 255)).join(',')},${alpha})`;
const wrap = (v, m) => ((v % m) + m) % m;

/** Deterministic PRNG so every page of the site shows the same constellation. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readPalette() {
  return {
    green: tokenRgb('--rgb-aurora', [0.18, 0.9, 0.65]),
    blue: tokenRgb('--rgb-sky', [0.42, 0.59, 0.93]),
    coral: tokenRgb('--rgb-coral', [1, 0.32, 0.32]),
    amber: tokenRgb('--rgb-amber', [1, 0.7, 0.34]),
    navy: tokenRgb('--rgb-navy', [0.11, 0.17, 0.38]),
    night: tokenHex('--c-night', [0.027, 0.043, 0.11]),
    void: tokenHex('--c-void', [0.012, 0.016, 0.039]),
  };
}

// ── aurora (WebGL) ─────────────────────────────────────────────────────────
/**
 * Returns { ready, resize(scale), render(state), destroy() } or null when WebGL is
 * unavailable. `ready` turns false while the context is lost; onChange() is called both ways.
 */
function createAurora(host, palette, onChange) {
  const canvas = document.createElement('canvas');
  canvas.className = 'sky-aurora';
  canvas.setAttribute('aria-hidden', 'true');
  const attrs = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true };
  let gl = null;
  try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch { gl = null; }
  if (!gl) return null;
  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  if (!highp || highp.precision === 0) return null;

  const api = { ready: false, resize, render, destroy };
  let uniforms = null;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
    return shader;
  }

  function build() {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
    gl.useProgram(program);

    // one oversized triangle covers the viewport
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    uniforms = {};
    for (const name of ['uRes', 'uTime', 'uVivid', 'uFold', 'uClimb', 'uDrift', 'uWarp', 'uPointer', 'uRocket', 'uBurst']) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    const colours = { uGreen: palette.green, uBlue: palette.blue, uCoral: palette.coral, uNavy: palette.navy, uNight: palette.night, uVoid: palette.void };
    for (const [name, rgb] of Object.entries(colours)) gl.uniform3fv(gl.getUniformLocation(program, name), toLinear(rgb));
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  /** Size the drawing buffer to `scale` × the viewport (CSS px), within the pixel budget. */
  function resize(scale) {
    const { w, h } = core.viewport;
    const capped = Math.min(scale, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
    canvas.width = Math.max(2, Math.round(w * capped));
    canvas.height = Math.max(2, Math.round(h * capped));
    if (api.ready) gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render(s) {
    if (!api.ready) return;
    gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
    gl.uniform1f(uniforms.uTime, s.time);
    gl.uniform1f(uniforms.uVivid, s.vivid);
    gl.uniform1f(uniforms.uFold, s.fold);
    gl.uniform1f(uniforms.uClimb, s.climb);
    gl.uniform1f(uniforms.uDrift, s.drift);
    gl.uniform1f(uniforms.uWarp, s.warp);
    gl.uniform3f(uniforms.uPointer, s.pointerX, s.pointerY, s.pointerGlow);
    gl.uniform3f(uniforms.uRocket, s.rocketX, s.rocketY, s.rocketGlow);
    gl.uniform4fv(uniforms.uBurst, s.bursts);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function onLost(e) {
    e.preventDefault();                      // allows the browser to restore the context later
    api.ready = false;
    onChange();
  }
  function onRestored() {
    try { build(); api.ready = true; gl.viewport(0, 0, canvas.width, canvas.height); } catch (err) { console.error('[sky] aurora shader failed after context restore', err); }
    onChange();
  }
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  function destroy() {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    canvas.remove();
  }

  try { build(); } catch (err) {
    console.error('[sky] aurora shader failed, using the CSS aurora', err);
    return null;
  }
  api.ready = true;
  host.appendChild(canvas);
  return api;
}

// ── stars (2D canvas) ──────────────────────────────────────────────────────
// Depth layers, far → near. `share` of the star count, size (CSS px), base alpha, parallax
// travel for a full pointer sweep (px), fraction of the page scroll they follow, streak gain.
const STAR_LAYERS = [
  { share: 0.56, size: [0.6, 1.1], alpha: [0.28, 0.62], pointer: 5, scroll: 0.03, streak: 0.35 },
  { share: 0.3, size: [0.9, 1.5], alpha: [0.45, 0.85], pointer: 11, scroll: 0.07, streak: 0.65 },
  { share: 0.14, size: [1.2, 2.0], alpha: [0.7, 1], pointer: 20, scroll: 0.13, streak: 1 },
];
const STAR_AREA = 2600;      // CSS px² of sky per star
const ROUND_FROM = 1.2;      // CSS px: smaller stars are plain crisp rects
const STAR_PAD = 40;         // off-screen margin so wrapping stars never pop in view
const BRIGHT_STARS = 11;
const SPRITE = 48;           // bright-star sprite size in CSS px
const WHITE = [1, 1, 1];
const TAIL_SEGMENTS = 14;

function createStars(host, palette) {
  const layer = createCanvas(host, { className: 'sky-stars', maxDpr: 2 });
  const { ctx } = layer;
  const tintRgb = [[WHITE, 0], [palette.blue, 0.45], [palette.amber, 0.4], [palette.green, 0.4]];
  const tints = tintRgb.map(([rgb, t]) => mixCss(WHITE, rgb, t));
  // Stars from ROUND_FROM px up are stamped from a soft round dot (a square would show).
  const dots = tintRgb.map(([rgb, t]) => makeDot(rgb, t));

  // Star data lives in flat typed arrays sorted by layer, then tint (few fillStyle switches).
  let count = 0;
  let sx, sy, size, alpha, twinkle, speed, phase, tint;
  const layerEnd = [0, 0, 0];
  const bright = new Float32Array(BRIGHT_STARS * 6);   // x, y, size, alpha, twinkle speed, phase
  const sprite = makeSprite();
  const shooter = { active: false, x: 0, y: 0, dx: 0, dy: 0, speed: 0, length: 0, age: 0, life: 1, next: rand(4, 9) };

  function makeDot(rgb, t) {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d');
    const gradient = g.createRadialGradient(12, 12, 0, 12, 12, 12);
    gradient.addColorStop(0, mixCss(WHITE, rgb, t, 1));
    gradient.addColorStop(0.4, mixCss(WHITE, rgb, t, 0.85));
    gradient.addColorStop(1, mixCss(WHITE, rgb, t, 0));
    g.fillStyle = gradient;
    g.fillRect(0, 0, 24, 24);
    return c;
  }

  /** Glow + four tapered diffraction spikes, drawn once and stamped for every bright star. */
  function makeSprite() {
    const c = document.createElement('canvas');
    const px = SPRITE * 2;                               // 2× so it stays crisp on retina
    c.width = c.height = px;
    const g = c.getContext('2d');
    const mid = px / 2;
    const fade = (alpha) => {
      const gradient = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
      gradient.addColorStop(0, mixCss(WHITE, palette.blue, 0, alpha));
      gradient.addColorStop(0.5, mixCss(WHITE, palette.blue, 0.5, alpha * 0.25));
      gradient.addColorStop(1, mixCss(WHITE, palette.blue, 0.8, 0));
      return gradient;
    };
    const halo = g.createRadialGradient(mid, mid, 0, mid, mid, mid * 0.55);
    halo.addColorStop(0, mixCss(WHITE, palette.blue, 0, 1));
    halo.addColorStop(0.1, mixCss(WHITE, palette.blue, 0.1, 0.9));
    halo.addColorStop(0.24, mixCss(WHITE, palette.blue, 0.6, 0.22));
    halo.addColorStop(1, mixCss(WHITE, palette.blue, 0.8, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, px, px);
    // spikes: thin diamonds, long vertical pair and a shorter horizontal pair
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = fade(0.9);
    const thick = px * 0.022;
    for (const [lx, ly] of [[thick, mid], [mid * 0.72, thick]]) {
      g.beginPath();
      g.moveTo(mid - lx, mid); g.lineTo(mid, mid - ly); g.lineTo(mid + lx, mid); g.lineTo(mid, mid + ly);
      g.closePath();
      g.fill();
    }
    return c;
  }

  function seed() {
    const random = mulberry32(0xa0507a);
    const between = (range) => range[0] + random() * (range[1] - range[0]);
    const lowPower = core.env.lowPower || core.env.saveData;
    count = Math.round(clamp((layer.w * layer.h) / STAR_AREA, 140, lowPower ? 420 : 900));
    sx = new Float32Array(count); sy = new Float32Array(count);
    size = new Float32Array(count); alpha = new Float32Array(count);
    twinkle = new Float32Array(count); speed = new Float32Array(count); phase = new Float32Array(count);
    tint = new Uint8Array(count);

    let i = 0;
    STAR_LAYERS.forEach((spec, li) => {
      const end = li === STAR_LAYERS.length - 1 ? count : Math.min(count, i + Math.round(count * spec.share));
      const start = i;
      for (; i < end; i++) {
        sx[i] = random(); sy[i] = random();
        size[i] = between(spec.size);
        alpha[i] = between(spec.alpha);
        twinkle[i] = random() < 0.4 ? 0.25 + random() * 0.5 : 0.08;   // some stars scintillate, most barely do
        speed[i] = 0.6 + random() * 2.6;
        phase[i] = random() * Math.PI * 2;
        const r = random();
        tint[i] = r < 0.58 ? 0 : r < 0.82 ? 1 : r < 0.94 ? 2 : 3;
      }
      // group equal tints inside the layer
      const order = Array.from({ length: end - start }, (_, k) => start + k).sort((a, b) => tint[a] - tint[b]);
      for (const arr of [sx, sy, size, alpha, twinkle, speed, phase, tint]) {
        const copy = arr.slice(start, end);
        order.forEach((from, k) => { arr[start + k] = copy[from - start]; });
      }
      layerEnd[li] = end;
    });

    for (let b = 0; b < BRIGHT_STARS; b++) {
      const o = b * 6;
      bright[o] = random(); bright[o + 1] = random();
      bright[o + 2] = 16 + random() * random() * 32;   // sprite size, CSS px (few big ones)
      bright[o + 3] = 0.5 + random() * 0.5;
      bright[o + 4] = 0.5 + random() * 1.4;
      bright[o + 5] = random() * Math.PI * 2;
    }
  }

  function launchShooter() {
    const leftward = rand() < 0.5;
    const angle = rand(0.28, 0.62);                       // radians below the horizontal
    shooter.active = true;
    shooter.age = 0;
    shooter.life = rand(0.7, 1.1);
    shooter.speed = rand(700, 1150);
    shooter.length = rand(140, 260);
    shooter.dx = Math.cos(angle) * (leftward ? -1 : 1);
    shooter.dy = Math.sin(angle);
    shooter.x = layer.w * (leftward ? rand(0.45, 1) : rand(0, 0.55));
    shooter.y = layer.h * rand(0.04, 0.42);
  }

  function drawShooter(dt) {
    if (!shooter.active) {
      shooter.next -= dt;
      if (shooter.next <= 0) { launchShooter(); shooter.next = rand(7, 16); }
      return;
    }
    shooter.age += dt;
    const k = shooter.age / shooter.life;
    if (k >= 1) { shooter.active = false; return; }
    shooter.x += shooter.dx * shooter.speed * dt;
    shooter.y += shooter.dy * shooter.speed * dt;
    const envelope = Math.sin(Math.PI * k);
    const length = shooter.length * Math.min(1, k * 4);
    ctx.strokeStyle = tints[1];
    ctx.lineCap = 'round';
    for (let j = 0; j < TAIL_SEGMENTS; j++) {
      const a = j / TAIL_SEGMENTS, b = (j + 1) / TAIL_SEGMENTS;
      ctx.globalAlpha = envelope * (1 - a) * (1 - a) * 0.9;
      ctx.lineWidth = 0.4 + 1.5 * (1 - a);
      ctx.beginPath();
      ctx.moveTo(shooter.x - shooter.dx * length * a, shooter.y - shooter.dy * length * a);
      ctx.lineTo(shooter.x - shooter.dx * length * b, shooter.y - shooter.dy * length * b);
      ctx.stroke();
    }
    ctx.globalAlpha = envelope * 0.9;
    ctx.drawImage(sprite, shooter.x - 9, shooter.y - 9, 18, 18);
  }

  /**
   * view: { time, parX, parY (−1..1 smoothed pointer), scrollY, travel (px flown during warps),
   * streak (px of vertical stretch for the nearest layer) }. dt = 0 draws a still (no shooting star).
   */
  function draw(view, dt) {
    const { w, h } = layer;
    const tileW = w + STAR_PAD * 2, tileH = h + STAR_PAD * 2;
    ctx.clearRect(0, 0, w, h);

    let i = 0;
    let currentTint = -1;
    for (let li = 0; li < STAR_LAYERS.length; li++) {
      const spec = STAR_LAYERS[li];
      const offX = -view.parX * spec.pointer;
      const offY = -view.parY * spec.pointer * 0.6 - view.scrollY * spec.scroll + view.travel * spec.streak;
      const stretch = view.streak * spec.streak;
      const dim = 1 / (1 + stretch * 0.06);              // a streak spreads the same light over more pixels
      for (const end = layerEnd[li]; i < end; i++) {
        const x = wrap(sx[i] * tileW + offX, tileW) - STAR_PAD;
        const y = wrap(sy[i] * tileH + offY, tileH) - STAR_PAD;
        const s = size[i];
        if (tint[i] !== currentTint) { currentTint = tint[i]; ctx.fillStyle = tints[currentTint]; }
        ctx.globalAlpha = alpha[i] * dim * (1 - twinkle[i] * (0.5 + 0.5 * Math.sin(view.time * speed[i] + phase[i])));
        if (s < ROUND_FROM) ctx.fillRect(x - s / 2, y - s / 2 - stretch / 2, s, s + stretch);
        else ctx.drawImage(dots[currentTint], x - s, y - s - stretch / 2, s * 2, s * 2 + stretch);
      }
    }

    // bright stars ride with the nearest layer
    const near = STAR_LAYERS[STAR_LAYERS.length - 1];
    const offX = -view.parX * near.pointer;
    const offY = -view.parY * near.pointer * 0.6 - view.scrollY * near.scroll + view.travel * near.streak;
    const tall = view.streak * 2.2;
    for (let b = 0; b < BRIGHT_STARS; b++) {
      const o = b * 6;
      const x = wrap(bright[o] * tileW + offX, tileW) - STAR_PAD;
      const y = wrap(bright[o + 1] * tileH + offY, tileH) - STAR_PAD;
      const pulse = 0.5 + 0.5 * Math.sin(view.time * bright[o + 4] + bright[o + 5]);
      const d = bright[o + 2] * (0.88 + 0.12 * pulse);
      ctx.globalAlpha = bright[o + 3] * (0.7 + 0.3 * pulse);
      ctx.drawImage(sprite, x - d / 2, y - d / 2 - tall / 2, d, d + tall);
    }

    if (dt > 0) drawShooter(dt);
    ctx.globalAlpha = 1;
  }

  function resize() { layer.resize(); seed(); }
  seed();
  return { draw, resize, destroy: () => layer.canvas.remove(), get shooting() { return shooter.active; } };
}

// ── module ─────────────────────────────────────────────────────────────────
export default function init() {
  const host = core.layers.sky;
  if (!host || host.classList.contains('sky')) return undefined;
  host.classList.add('sky');

  const palette = readPalette();
  const lowPower = core.env.lowPower || core.env.saveData || core.env.coarse;
  let quality = clamp(Number(sessionGet(QUALITY_KEY)) || (lowPower ? 1 : 0), 0, QUALITY_SCALES.length - 1);

  // The shader clock continues across page loads of the same session, so the sky is one sky
  // (wrapped hourly to keep float precision in the shader).
  let epoch = Number(sessionGet(EPOCH_KEY));
  if (!epoch) { epoch = Date.now(); sessionSet(EPOCH_KEY, String(epoch)); }
  const sessionClock = () => STILL_TIME + ((Date.now() - epoch) / 1000) % 3600;

  const state = {
    time: sessionClock(),
    vivid: 1, fold: -1, climb: 0, drift: 0, warp: 0,
    pointerX: 0.5, pointerY: 0.4, pointerGlow: 0,
    rocketX: 0.5, rocketY: -0.2, rocketGlow: 0,
    bursts: new Float32Array(MAX_BURSTS * 4),
  };
  const view = { time: state.time, parX: 0, parY: 0, scrollY: core.scroll.y, travel: 0, streak: 0 };
  let warpStart = -1;          // performance.now() of the running warp, −1 when idle
  let burstSlot = 0;
  let burstsLive = false;      // a burst is still fading
  let owed = 0;                // seconds of the frames skipped while the page is idle
  let cssVivid = -1;           // last value written to --sky-vivid

  const aurora = createAurora(host, palette, syncMode);
  const stars = createStars(host, palette);
  if (aurora) aurora.resize(QUALITY_SCALES[quality]);

  /** 1 at the top of the page, easing to 0 (calm) by the end of the first viewport. */
  const vividTarget = () => 1 - smoothstep(core.viewport.h * 0.12, core.viewport.h, core.scroll.y);
  const glLive = () => !!aurora && aurora.ready;

  // The fold: bottom edge of the hero in page px (−1: no hero, the whole first viewport is vivid).
  // Measured on load / resize / when the page height changes — never per frame.
  const hero = document.querySelector(HERO);
  let foldPage = -1;
  let foldMax = -1;                                      // core.scroll.max at the last measurement
  function measureFold() {
    foldMax = core.scroll.max;
    foldPage = hero ? hero.getBoundingClientRect().bottom + core.scroll.y : -1;
  }
  /** The fold as the shader wants it: uv.y (0 = bottom of the viewport), −1 when there is none. */
  function foldUv() {
    if (foldMax !== core.scroll.max) measureFold();
    return foldPage < 0 ? -1 : 1 - (foldPage - core.scroll.y) / core.viewport.h;
  }

  /** The canvas/CSS aurora opacity. Only the modes without a per-frame shader fade this way. */
  function setCssVivid(vivid) {
    const rounded = Math.round(lerp(CALM_OPACITY, 1, vivid) * 100) / 100;
    if (rounded === cssVivid) return;
    cssVivid = rounded;
    host.style.setProperty('--sky-vivid', String(rounded));
  }

  /** Reflect which aurora is showing (WebGL canvas or the CSS veils) and redraw stills. */
  function syncMode() {
    host.classList.toggle('sky--gl', glLive());
    host.classList.toggle('sky--css', !glLive());
    if (!core.fx.enabled) renderStill();
    else if (glLive()) setCssVivid(1);
  }

  // ── adaptive quality: the aurora buffer shrinks when frames run long, and never grows back ──
  let lastFrameMs = 0, frameAcc = 0, slowWindows = 0;
  let frameCount = -WARMUP_FRAMES;                       // negative = warm-up frames to ignore
  function measure() {
    const ms = performance.now();
    const elapsed = ms - lastFrameMs;
    lastFrameMs = ms;
    if (elapsed > 100) return;                           // tab switch, first frame, debugger…
    if (++frameCount <= 0) return;
    frameAcc += elapsed;
    if (frameCount < SAMPLE_FRAMES) return;
    slowWindows = frameAcc / frameCount > SLOW_FRAME_MS ? slowWindows + 1 : 0;
    frameAcc = 0; frameCount = 0;
    if (slowWindows >= 2 && quality < QUALITY_SCALES.length - 1) {
      quality++;
      sessionSet(QUALITY_KEY, String(quality));
      aurora.resize(QUALITY_SCALES[quality]);
      slowWindows = 0;
      frameCount = -WARMUP_FRAMES;
    }
  }

  // ── per-frame update ──
  function update(dt) {
    const { pointer, scroll, rocket, viewport } = core;

    if (warpStart >= 0) {
      const k = (performance.now() - warpStart) / WARP_MS;
      // fast attack, then a slow release in case the navigation never happens
      state.warp = k < 1 ? Math.sin(Math.min(k * 1.6, 1) * Math.PI * 0.5) : Math.max(0, 1 - (k - 1) * 0.8);
      if (k > 1 && state.warp === 0) warpStart = -1;
    }

    const speed = clamp(Math.abs(scroll.velocity) / 4000);
    state.time += dt * (1 + 9 * state.warp + 2 * speed);
    state.vivid = damp(state.vivid, vividTarget(), 5, dt);
    state.fold = foldUv();
    state.climb = damp(state.climb, scroll.progress, 3, dt);
    state.drift = damp(state.drift, pointer.active ? pointer.nx * 0.35 : 0, 1.5, dt);

    // Pointer light: a mouse keeps a soft glow while it is inside the window and flares when it
    // moves; a finger only glows while it is touching/moving.
    const touching = pointer.type === 'touch' ? pointer.down || core.time.now - pointer.lastMove < 1.2 : pointer.inside;
    const energy = pointer.active && touching ? 0.45 + 0.55 * clamp(pointer.speed / 900) : 0;
    state.pointerX = damp(state.pointerX, pointer.x / viewport.w, 6, dt);
    state.pointerY = damp(state.pointerY, 1 - pointer.y / viewport.h, 6, dt);

    state.rocketX = rocket.x / viewport.w;
    state.rocketY = 1 - rocket.y / viewport.h;
    state.rocketGlow = damp(state.rocketGlow, rocket.visible ? 0.55 + 0.45 * clamp(rocket.boost) : 0, 6, dt);
    // the rocket flies at the pointer: do not light the same spot twice
    state.pointerGlow = damp(state.pointerGlow, energy * (1 - 0.6 * state.rocketGlow), 4, dt);

    burstsLive = false;
    for (let b = 0; b < MAX_BURSTS; b++) {
      const o = b * 4;
      if (state.bursts[o + 3] === 0) continue;
      state.bursts[o + 2] += dt / 0.9;
      if (state.bursts[o + 2] >= 1) state.bursts[o + 3] = 0; else burstsLive = true;
    }

    view.time = state.time;
    view.parX = damp(view.parX, pointer.active ? pointer.nx : 0, 3, dt);
    view.parY = damp(view.parY, pointer.active ? pointer.ny : 0, 3, dt);
    view.scrollY = scroll.y;
    view.travel += state.warp * 2400 * dt;
    view.streak = damp(view.streak, speed * 14 + state.warp * 150, 10, dt);
  }

  function frame(dt) {
    if (glLive()) measure();                             // frame pacing: every tick, drawn or not
    owed += dt;
    const eventful = warpStart >= 0 || burstsLive || stars.shooting;
    if (core.time.idle && !eventful && core.time.frame % 2) return;
    const step = owed;
    owed = 0;
    update(step);
    if (glLive()) aurora.render(state); else setCssVivid(state.vivid);
    stars.draw(view, step);
  }

  /**
   * One beautiful frame for effects-off / reduced motion: a fixed moment, no transients. The
   * aurora's level still follows the page (fold, calm past the first viewport), so `starsToo`
   * is false when only the scroll position changed.
   */
  function renderStill(starsToo = true) {
    state.time = STILL_TIME;
    state.vivid = vividTarget(); state.warp = 0; state.drift = 0;
    state.fold = foldUv();
    state.climb = 0;
    state.pointerGlow = 0; state.rocketGlow = 0;
    state.bursts.fill(0);
    burstsLive = false;
    warpStart = -1;
    if (glLive()) { aurora.render(state); setCssVivid(1); } else setCssVivid(state.vivid);
    if (!starsToo) return;
    view.time = STILL_TIME; view.parX = 0; view.parY = 0; view.scrollY = 0; view.travel = 0; view.streak = 0;
    stars.draw(view, 0);
  }

  // ── wiring ──
  const off = [
    core.tick(frame, { order: 5 }),
    core.on('resize', () => {
      if (aurora) aurora.resize(QUALITY_SCALES[quality]);
      stars.resize();
      measureFold();
      if (!core.fx.enabled) renderStill();
    }),
    // effects off: the still frame follows the page (fold and calm level) — one draw per scroll event
    core.on('scroll', () => { if (!core.fx.enabled) renderStill(false); }),
    core.on('visibility', (visible) => { if (visible && !core.fx.enabled) renderStill(); }),
    core.on('fx:change', (enabled) => {
      if (enabled) {
        state.time = sessionClock();
        state.vivid = vividTarget();
        state.climb = core.scroll.progress;
        frameAcc = 0; slowWindows = 0; frameCount = -WARMUP_FRAMES;
        owed = 0;
        if (glLive()) setCssVivid(1);
      } else {
        renderStill();
      }
    }),
    core.on('navigate:start', () => { if (core.fx.enabled) warpStart = performance.now(); }),
    // the page is still (or again) here: no warp left over from the exit
    core.on('navigate:cancel', () => { warpStart = -1; state.warp = 0; view.streak = 0; }),
    core.on('burst', (detail) => {
      // { light: false } bursts are sparks only: they do not light up the sky
      if (!core.fx.enabled || !detail || detail.light === false || !Number.isFinite(detail.x) || !Number.isFinite(detail.y)) return;
      const o = burstSlot * 4;
      burstSlot = (burstSlot + 1) % MAX_BURSTS;
      state.bursts[o] = detail.x / core.viewport.w;
      state.bursts[o + 1] = 1 - detail.y / core.viewport.h;
      state.bursts[o + 2] = 0;
      state.bursts[o + 3] = clamp(detail.power ?? 1, 0.2, 2);
      burstsLive = true;
    }),
  ];

  state.vivid = vividTarget();
  state.climb = core.scroll.progress;
  syncMode();

  return {
    destroy() {
      off.forEach((unsubscribe) => unsubscribe());
      if (aurora) aurora.destroy();
      stars.destroy();
      host.classList.remove('sky', 'sky--gl', 'sky--css');
      host.style.removeProperty('--sky-vivid');
    },
  };
}
