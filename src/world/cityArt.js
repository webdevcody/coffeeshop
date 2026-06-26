// Procedural canvas art for the city: billboards, murals, neon signs, posters,
// shop signs and skateboard-deck graphics. Everything is drawn to a <canvas> and
// wrapped in a THREE.CanvasTexture — no external files required, so it always
// renders (dev, prod, headless). Matches the app's existing procedural-texture
// approach (see world/textures.js).
//
// FORWARD-COMPATIBLE with real AI images: `artMaterial()` shows the procedural
// texture immediately but also tries to load /img/city/<name>.png; if that file
// exists it swaps in seamlessly. So dropping AI-generated PNGs into
// public/img/city/ later "just works" with no code changes.
//
// VARIETY: every generator picks layout templates, colour palettes, fake brands
// and accent treatments from curated pools using a deterministic per-panel seed,
// so two billboards/murals/etc. rarely look alike — yet a given panel always
// renders the same texture across builds. Explicit opts (a/b/accent/title/sky/…)
// always win, so existing callers are byte-for-byte unaffected. Everything is
// drawn ONCE to a canvas (no per-frame allocation, materials still reused).
//
// RICHNESS: each style layers multi-stop gradients, radial blooms, drop shadows,
// faux-typography, subtle film grain / vignette / sheen, halftone on posters,
// scanlines + tube-glow on neon, riso-style colour offsets and harmonised
// accents derived from each palette. FPS is irrelevant — this draws once.

import * as THREE from "three";

function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d") };
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shrink the font until the text fits a max width.
function fitFont(ctx, text, maxW, startPx, weight = "bold", family = "sans-serif", floor = 14) {
  let px = startPx;
  ctx.font = `${weight} ${px}px ${family}`;
  while (ctx.measureText(text).width > maxW && px > floor) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  return px;
}

// ── Deterministic seeding ──────────────────────────────────────────────────
// A tiny string hash (FNV-1a-ish) so the same panel always seeds the same way.
// When a panel carries no identifying opt, we fall back to an auto-incrementing
// counter so successive panels still differ from one another.
let _autoSeed = 0x9e3779b1 >>> 0;
function hashStr(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
// Build a deterministic RNG for an opts object. Prefers stable identifiers
// (file / title / tag / text / lines / top) so a panel is reproducible; else
// advances a module counter so distinct anonymous panels still vary.
function seedFor(opts, salt) {
  let key = opts.seed != null ? String(opts.seed)
    : opts.file || opts.title || opts.tag || opts.top
    || (opts.lines && opts.lines.join("|")) || opts.text || opts.sub || "";
  if (!key) { _autoSeed = (Math.imul(_autoSeed, 0x6c078965) + 0x9e3779b1) >>> 0; key = "auto" + _autoSeed; }
  return mulberry32(hashStr(key + "::" + (salt || "")));
}
// Small fast PRNG returning [0,1).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[(rng() * arr.length) | 0];
const chance = (rng, p) => rng() < p;

// ── Colour helpers (harmonised tints derived from a palette) ────────────────
function isHex(s) { return typeof s === "string" && /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s); }
function hexToRgb(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Lighten (amt>0, toward white) or darken (amt<0, toward black) a hex colour.
// Non-hex colours (e.g. named/rgba) pass through untouched so callers are safe.
function shade(hex, amt) {
  if (!isHex(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function withAlpha(hex, a) {
  if (!isHex(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function mix(a, b, t) {
  if (!isHex(a) || !isHex(b)) return t < 0.5 ? a : b;
  const A = hexToRgb(a), B = hexToRgb(b);
  const f = (i) => Math.round(A[i] + (B[i] - A[i]) * t);
  return `rgb(${f(0)},${f(1)},${f(2)})`;
}

// ── Shared accent treatments (all draw once) ───────────────────────────────
function setShadow(ctx, color, blur, ox = 0, oy = 0) {
  ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetX = ox; ctx.shadowOffsetY = oy;
}
function clearShadow(ctx) {
  ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
}
function halftone(ctx, w, h, color, step, rad, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, 6.283);
      ctx.fill();
    }
  }
  ctx.restore();
}
function grunge(ctx, w, h, rng, count, color, maxAlpha) {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = rng() * maxAlpha;
    const x = rng() * w, y = rng() * h;
    const r = 1 + rng() * 3;
    ctx.fillRect(x, y, r, r);
  }
  ctx.restore();
}
// Fine black/white photographic grain — subtler than grunge.
function filmGrain(ctx, w, h, rng, count, alpha) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const v = rng() < 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${rng() * alpha})`;
    ctx.fillRect(rng() * w, rng() * h, 1, 1);
  }
  ctx.restore();
}
function scanlines(ctx, w, h, step, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000";
  for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, 1);
  ctx.restore();
}
// A soft top-down highlight sheen (glass/gloss feel).
function sheen(ctx, w, h, alpha) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.16, `rgba(255,255,255,${alpha * 0.4})`);
  g.addColorStop(0.45, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
// Scattered starfield (upper region only when maxY given).
function stars(ctx, w, h, rng, count, maxY) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rng() * w, y = rng() * (maxY || h);
    const r = rng() * 1.4 + 0.3;
    ctx.globalAlpha = 0.25 + rng() * 0.7;
    ctx.fillStyle = rng() < 0.18 ? "#ffe9a8" : "#ffffff";
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
  }
  ctx.restore();
}
function vignette(ctx, w, h, alpha) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.62);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
function rays(ctx, cx, cy, r, n, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 6.283;
    const a1 = a0 + 6.283 / n / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
function starburst(ctx, cx, cy, rOuter, rInner, points, color) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rInner : rOuter;
    const a = (i / (points * 2)) * 6.283 - Math.PI / 2;
    const fn = i === 0 ? "moveTo" : "lineTo";
    ctx[fn](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
// Linear gradient from a list of stops [[t,color],…].
function grad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}
// Radial gradient from a list of stops [[t,color],…].
function radial(ctx, cx, cy, r0, r1, stops) {
  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

// ── Curated content pools ──────────────────────────────────────────────────
const GLYPHS = ["★", "☆", "✦", "◆", "●", "▲", "✺", "❖", "✸", "♦", "➤", "⚡", "✚", "☼", "◉", "✪", "✷", "❂", "♬", "◈"];
const BRANDS = [
  "NOVA", "ZENITH", "PULSE", "VOLT", "ORBIT", "FLUX", "ECHO", "APEX",
  "HALO", "DRIFT", "NEON", "QUARTZ", "VAPOR", "COBALT", "EMBER", "LUMEN",
  "CIRRUS", "ONYX", "RIFT", "AZTEC", "KRONOS", "HELIX", "PRISM", "SOLSTICE",
  "VERTEX", "ZEPHYR", "ATLAS", "NEXUS", "SABLE", "MIRAGE", "AURUM", "TEMPO",
];
const TAGLINES = [
  "FEEL THE FUTURE", "GO FURTHER", "PURE ENERGY", "TASTE THE CITY",
  "ALWAYS ON", "MADE FOR YOU", "RIDE THE WAVE", "LEVEL UP",
  "NIGHT & DAY", "BEYOND LIMITS", "STAY CHARGED", "OWN THE NIGHT",
  "NEW SEASON", "DROPS FRIDAY", "LIMITED RUN", "JOIN THE CLUB",
  "TASTE TOMORROW", "BUILT DIFFERENT", "STAY GOLDEN", "RUN THE CITY",
  "THE FUTURE IS NOW", "NO LIMITS", "FRESH DAILY", "TURN IT UP",
  "DREAM LOUDER", "PURE & SIMPLE",
];
const PRODUCTS = ["COLA", "JEANS", "PHONES", "SNEAKERS", "COFFEE", "GAMES", "WATCH", "FRAGRANCE", "SODA", "RECORDS", "VINYL", "KICKS", "SHADES", "CAMERAS"];

// ── Palette pools (used only when caller didn't pass colours) ──────────────
const BILLBOARD_PALETTES = [
  { a: "#1b3a6b", b: "#0c1830", accent: "#ffcf3f" }, // original default (kept first)
  { a: "#d81e5b", b: "#2b0a2e", accent: "#ffe066" },
  { a: "#0f7173", b: "#04282b", accent: "#ffd6a5" },
  { a: "#3a0ca3", b: "#10002b", accent: "#4cc9f0" },
  { a: "#ff7b00", b: "#3a0d0d", accent: "#fff3b0" },
  { a: "#06303a", b: "#011016", accent: "#39ff9a" },
  { a: "#5a189a", b: "#1a0633", accent: "#ff8fab" },
  { a: "#1d4e89", b: "#091a2e", accent: "#f5b700" },
  { a: "#b91372", b: "#1b0a1f", accent: "#84e3ff" },
  { a: "#264653", b: "#0b1d24", accent: "#e9c46a" },
  { a: "#11324d", b: "#04101c", accent: "#5ef0c4" },
  { a: "#7a1f3d", b: "#240814", accent: "#ffc6d9" },
  { a: "#27123f", b: "#0a0418", accent: "#c8a6ff" },
];
const NEON_PALETTES = [
  ["#ff4fa3", "#4fd2ff"], ["#39ff14", "#ff206e"], ["#ffd300", "#ff5e00"],
  ["#00f5d4", "#f15bb5"], ["#7b2ff7", "#f72585"], ["#00b4d8", "#caf0f8"],
  ["#ff9e00", "#ff0054"], ["#b5fffc", "#ff6ec7"], ["#c1ff9b", "#4dffff"],
  ["#ff3cac", "#784ba0"], ["#00ffd5", "#ff8a00"], ["#f6ff00", "#ff00a8"],
];
const SIGN_PALETTES = [
  { bg: "#c4302b", fg: "#ffffff" }, { bg: "#1a73e8", fg: "#fff8e1" },
  { bg: "#0b6e4f", fg: "#f7fff7" }, { bg: "#222831", fg: "#ffd369" },
  { bg: "#f4a261", fg: "#2b2118" }, { bg: "#5f0f40", fg: "#ffd6e0" },
  { bg: "#003049", fg: "#fcbf49" }, { bg: "#8d0801", fg: "#fff3b0" },
  { bg: "#2d6a4f", fg: "#d8f3dc" }, { bg: "#3d348b", fg: "#f7b801" },
  { bg: "#16425b", fg: "#d9f0ff" }, { bg: "#7b2d26", fg: "#ffe8c2" },
  { bg: "#1b3a2b", fg: "#ffd166" },
];
const POSTER_PALETTES = [
  { bg: "#e9e2cf", ink: "#1c1c24", accent: "#b8402f" },
  { bg: "#101030", ink: "#46d6ff", accent: "#ff3fae" },
  { bg: "#f1e8d4", ink: "#2b2118", accent: "#2b7a78" },
  { bg: "#11151c", ink: "#ffd23f", accent: "#ee4266" },
  { bg: "#f7ede2", ink: "#6d2e46", accent: "#e58c8a" },
  { bg: "#1b1b2f", ink: "#e6e6e6", accent: "#e94560" },
  { bg: "#fdf0d5", ink: "#003049", accent: "#c1121f" },
  { bg: "#e7d8c9", ink: "#33272a", accent: "#9a031e" },
  { bg: "#0b132b", ink: "#5bc0be", accent: "#ffba08" },
];
const MURAL_SKIES = [
  ["#3a1f5d", "#b5417a", "#f4a04b"], ["#1f3f5d", "#2bb7a3", "#f4e04b"],
  ["#3a1f5d", "#e0568a", "#f4a04b"], ["#0d1b2a", "#415a77", "#e0aaff"],
  ["#240046", "#9d4edd", "#ffba08"], ["#03071e", "#d00000", "#ffba08"],
  ["#012a4a", "#468faf", "#a9d6e5"], ["#2b2d42", "#ef476f", "#ffd166"],
  ["#10002b", "#5a189a", "#ffba08"], ["#0b1d36", "#2c7da0", "#ffd6a5"],
];
const DECK_PALETTES = [
  { a: "#111118", b: "#2a0d14", accent: "#ff6a2b" },
  { a: "#0b132b", b: "#1c2541", accent: "#5bc0be" },
  { a: "#1a0633", b: "#3a0ca3", accent: "#f72585" },
  { a: "#1d1d1d", b: "#3d0000", accent: "#ffd000" },
  { a: "#06120f", b: "#003322", accent: "#39ff9a" },
  { a: "#22011c", b: "#5a189a", accent: "#ff9e00" },
  { a: "#1a1423", b: "#3c2a4d", accent: "#f7b801" },
  { a: "#0d0d0d", b: "#1f0a3d", accent: "#00f0ff" },
];

// Apply a palette object's keys to opts ONLY where the caller left them blank.
function withDefaults(opts, defaults) {
  const out = {};
  for (const k in defaults) out[k] = opts[k] != null ? opts[k] : defaults[k];
  return out;
}

// ── BILLBOARD: a bold landscape advert (drawn at 768×512). ──
// Templates: 0 striped+emblem (classic), 1 split-panel, 2 sunburst hero,
// 3 big-product price tag, 4 diagonal swoosh.
export function billboardCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(768, 512);
  const rng = seedFor(opts, "billboard");
  const pal = withDefaults(opts, pick(rng, BILLBOARD_PALETTES));
  const a = pal.a, b = pal.b, accent = pal.accent;
  const title = opts.title || pick(rng, BRANDS);
  const sub = opts.sub != null ? opts.sub : (chance(rng, 0.7) ? pick(rng, TAGLINES) : "");
  const glyph = opts.glyph || pick(rng, GLYPHS);
  const tpl = opts.template != null ? opts.template : (rng() * 5) | 0;

  // richer base wash: 3-stop diagonal + an off-centre radial accent bloom
  const angle = pick(rng, [[0, 0, 768, 512], [0, 0, 0, 512], [0, 0, 768, 0], [768, 0, 0, 512]]);
  ctx.fillStyle = grad(ctx, angle[0], angle[1], angle[2], angle[3], [[0, shade(a, 0.18)], [0.5, a], [1, b]]);
  ctx.fillRect(0, 0, 768, 512);
  const bx = 180 + rng() * 408, by = 110 + rng() * 200;
  ctx.fillStyle = radial(ctx, bx, by, 20, 540, [[0, withAlpha(accent, 0.22)], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(0, 0, 768, 512);

  if (tpl === 1) {
    // split panel: gradient accent block on one side + seam shadow
    const left = chance(rng, 0.5);
    const px0 = left ? 0 : 470;
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = grad(ctx, px0, 0, px0 + 298, 512, [[0, shade(accent, 0.12)], [1, accent]]);
    ctx.fillRect(px0, 0, 298, 512);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(left ? 298 : 462, 0, 8, 512);
    halftone(ctx, 768, 512, "#000", 14, 2, 0.05);
    setShadow(ctx, "rgba(0,0,0,0.35)", 12, 0, 6);
    ctx.fillStyle = b;
    ctx.font = "900 132px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, left ? 149 : 619, 256);
    clearShadow(ctx);
    ctx.fillStyle = "#fff";
    ctx.textAlign = left ? "left" : "right";
    const tx = left ? 320 : 448;
    fitFont(ctx, title, 360, 92, "900");
    setShadow(ctx, "rgba(0,0,0,0.4)", 8, 0, 4);
    ctx.fillText(title, tx, sub ? 220 : 256);
    clearShadow(ctx);
    if (sub) { ctx.fillStyle = accent; fitFont(ctx, sub, 360, 40, "700"); ctx.fillText(sub, tx, 300); }
  } else if (tpl === 2) {
    // sunburst hero behind centred title with a glowing disc
    rays(ctx, 384, 250, 600, 32, accent, 0.16);
    setShadow(ctx, withAlpha(accent, 0.8), 30);
    ctx.fillStyle = radial(ctx, 384, 250, 8, 130, [[0, shade(accent, 0.3)], [1, accent]]);
    ctx.beginPath(); ctx.arc(384, 250, 120, 0, 6.283); ctx.fill();
    clearShadow(ctx);
    ctx.fillStyle = b;
    ctx.font = "900 96px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(glyph, 384, 252);
    ctx.fillStyle = accent;
    ctx.textBaseline = "middle";
    fitFont(ctx, title, 660, 84, "900");
    setShadow(ctx, "rgba(0,0,0,0.55)", 12, 0, 6);
    ctx.fillText(title, 384, 420);
    clearShadow(ctx);
    if (sub) { ctx.fillStyle = "#fff"; fitFont(ctx, sub, 620, 38, "700"); ctx.fillText(sub, 384, 472); }
  } else if (tpl === 3) {
    // big product + price-tag starburst
    const product = opts.product || pick(rng, PRODUCTS);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    setShadow(ctx, "rgba(0,0,0,0.4)", 8, 0, 4);
    ctx.fillStyle = "#fff";
    fitFont(ctx, title, 440, 96, "900");
    ctx.fillText(title, 54, 150);
    clearShadow(ctx);
    ctx.fillStyle = accent;
    fitFont(ctx, product, 440, 70, "800");
    ctx.fillText(product, 54, 230);
    ctx.fillStyle = withAlpha(accent, 0.8); ctx.fillRect(54, 250, 360, 5);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    fitFont(ctx, sub || "NOW IN STORE", 440, 34, "600");
    ctx.fillText(sub || "NOW IN STORE", 54, 296);
    // price burst with depth + inner ring
    const burst = pick(rng, ["#e63946", "#ff006e", accent, "#06d6a0", "#ffbe0b"]);
    setShadow(ctx, "rgba(0,0,0,0.4)", 14, 0, 6);
    starburst(ctx, 600, 300, 130, 92, 16, burst);
    clearShadow(ctx);
    starburst(ctx, 600, 300, 104, 74, 16, withAlpha("#ffffff", 0.14));
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "900 64px sans-serif";
    ctx.fillText(pick(rng, ["50%", "2for1", "NEW", "SALE", "FREE"]), 600, 290);
    ctx.font = "800 26px sans-serif";
    ctx.fillText(pick(rng, ["OFF", "DEAL", "TODAY", "ONLY"]), 600, 336);
  } else {
    // tpl 0 (classic) and 4 (diagonal swoosh) share the framed-title layout
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.16;
    if (tpl === 4) {
      ctx.save();
      ctx.translate(384, 256); ctx.rotate(-0.4);
      for (let i = -700; i < 700; i += 100) ctx.fillRect(i, -700, 44, 1400);
      ctx.restore();
    } else {
      for (let i = -512; i < 768; i += 90) ctx.fillRect(i, 0, 38, 512);
    }
    ctx.globalAlpha = 1;
    // double frame: bold accent + thin inner highlight
    ctx.strokeStyle = accent; ctx.lineWidth = 12;
    ctx.strokeRect(26, 26, 768 - 52, 512 - 52);
    ctx.strokeStyle = withAlpha("#ffffff", 0.25); ctx.lineWidth = 3;
    ctx.strokeRect(40, 40, 768 - 80, 512 - 80);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = accent;
    fitFont(ctx, title, 660, 96, "900");
    setShadow(ctx, "rgba(0,0,0,0.55)", 14, 0, 7);
    ctx.fillText(title, 384, sub ? 210 : 256);
    clearShadow(ctx);
    if (sub) { ctx.fillStyle = "#f2f6ff"; fitFont(ctx, sub, 620, 44, "600"); ctx.fillText(sub, 384, 300); }
    ctx.fillStyle = radial(ctx, 384, 410, 2, 32, [[0, shade(accent, 0.3)], [1, accent]]);
    ctx.beginPath(); ctx.arc(384, 410, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = b;
    ctx.font = "900 34px sans-serif";
    ctx.fillText(glyph, 384, 412);
  }

  if (chance(rng, 0.5)) grunge(ctx, 768, 512, rng, 220, "#000", 0.08);
  sheen(ctx, 768, 512, 0.10);
  filmGrain(ctx, 768, 512, rng, 1400, 0.05);
  vignette(ctx, 768, 512, 0.24);
  return canvas;
}

// ── MURAL: graffiti / skyline wall art (drawn at 768×512). ──
// Templates: 0 skyline+tag (classic), 1 mountains/sun, 2 wave bands.
export function muralCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(768, 512);
  const rng = seedFor(opts, "mural");
  const sky = opts.sky || pick(rng, MURAL_SKIES);
  const tpl = opts.template != null ? opts.template : (rng() * 3) | 0;
  ctx.fillStyle = grad(ctx, 0, 0, 0, 512, [[0, sky[0]], [0.55, sky[1]], [1, sky[2]]]);
  ctx.fillRect(0, 0, 768, 512);

  // starfield high in the sky
  if (chance(rng, 0.85)) stars(ctx, 768, 512, seedFor(opts, "stars"), 80, 240);

  // sun / moon disc with a soft glow halo (sometimes a ringed planet)
  const sunX = 120 + rng() * 528, sunY = 110 + rng() * 110, sunR = 50 + rng() * 40;
  const sunCol = pick(rng, [["#fff4c2", "#ffcf7a"], ["#ffd9d9", "#ff9aa0"], ["#dff0ff", "#a9d6ff"], ["#ffe0bd", "#ff8e72"]]);
  ctx.fillStyle = radial(ctx, sunX, sunY, sunR * 0.4, sunR * 2.8, [[0, withAlpha(sunCol[0], 0.45)], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(0, 0, 768, 512);
  ctx.fillStyle = grad(ctx, sunX, sunY - sunR, sunX, sunY + sunR, [[0, sunCol[0]], [1, sunCol[1]]]);
  ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();
  if (chance(rng, 0.35)) {
    ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 6;
    ctx.save(); ctx.translate(sunX, sunY); ctx.rotate(-0.3); ctx.scale(1, 0.32);
    ctx.beginPath(); ctx.arc(0, 0, sunR * 1.7, 0, 6.283); ctx.stroke(); ctx.restore();
  }

  if (tpl === 1) {
    // layered mountain ranges with atmospheric (distance) tinting
    const ranges = [["#2a1742", 300], ["#1d1030", 360], ["#120a20", 420]];
    for (let ri = 0; ri < ranges.length; ri++) {
      const col = ranges[ri][0], baseY = ranges[ri][1];
      ctx.fillStyle = mix(col, sky[1], 0.18 * (2 - ri));
      ctx.beginPath();
      ctx.moveTo(0, 512);
      let x = 0, y = baseY;
      ctx.lineTo(0, y);
      while (x < 768) {
        x += 60 + rng() * 90;
        y = baseY - (40 + rng() * 120);
        ctx.lineTo(x, y);
        y = baseY + rng() * 30;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(768, 512); ctx.closePath(); ctx.fill();
    }
  } else if (tpl === 2) {
    // flowing wave bands with crest highlights
    const bands = pick(rng, [
      ["#1d1030", "#46237a", "#3da5d9", "#73bfb8"],
      ["#2b0a3d", "#7b2cbf", "#ff5d8f", "#ffc371"],
      ["#03045e", "#0077b6", "#00b4d8", "#90e0ef"],
      ["#1a0b2e", "#3c096c", "#9d4edd", "#e0aaff"],
    ]);
    for (let bi = 0; bi < bands.length; bi++) {
      ctx.fillStyle = bands[bi];
      const baseY = 230 + bi * 70;
      ctx.beginPath();
      ctx.moveTo(0, 512);
      ctx.lineTo(0, baseY);
      for (let x = 0; x <= 768; x += 48) {
        ctx.lineTo(x, baseY + Math.sin(x * 0.012 + bi * 1.3) * 24);
      }
      ctx.lineTo(768, 512); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = withAlpha("#ffffff", 0.12); ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= 768; x += 48) {
        const yy = baseY + Math.sin(x * 0.012 + bi * 1.3) * 24;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  } else {
    // tpl 0: classic skyline with warmly lit windows
    const layers = [["#2a1742", 360], ["#1d1030", 410]];
    for (const [col, baseY] of layers) {
      const wcol = pick(rng, ["rgba(255,220,120,0.62)", "rgba(255,200,150,0.6)", "rgba(180,220,255,0.55)"]);
      const buildings = [];
      ctx.fillStyle = col;
      let x = 0;
      while (x < 768) {
        const w = 40 + rng() * 70;
        const h = 60 + rng() * 160;
        ctx.fillRect(x, baseY - h, w, h + 120);
        buildings.push([x, w, h]);
        x += w + 6;
      }
      ctx.fillStyle = wcol;
      for (const [bx, bw, bh] of buildings) {
        for (let wy = baseY - bh + 12; wy < baseY; wy += 22) {
          for (let wx = bx + 8; wx < bx + bw - 8; wx += 16) {
            if (rng() > 0.4) ctx.fillRect(wx, wy, 7, 11);
          }
        }
      }
    }
  }

  // atmospheric haze near the horizon
  ctx.fillStyle = grad(ctx, 0, 300, 0, 460, [[0, "rgba(255,255,255,0)"], [1, withAlpha(sky[2], 0.18)]]);
  ctx.fillRect(0, 300, 768, 160);

  // graffiti tag (spray-paint splatter + outlined glowing letters)
  const tag = opts.tag;
  if (tag) {
    const tagColor = opts.tagColor || pick(rng, ["#37e0c2", "#ffd24a", "#ff5d8f", "#7cf03f", "#4dd2ff", "#ff8c42"]);
    if (chance(rng, 0.6)) grunge(ctx, 768, 512, seedFor(opts, "spray"), 140, tagColor, 0.12);
    ctx.save();
    ctx.translate(384, 130 + rng() * 60);
    ctx.rotate(-0.12 + rng() * 0.14);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const px = fitFont(ctx, tag, 700, 100, "900");
    setShadow(ctx, withAlpha(tagColor, 0.6), 18);
    ctx.lineWidth = 16; ctx.strokeStyle = "#0c0c16"; ctx.strokeText(tag, 0, 0);
    clearShadow(ctx);
    if (chance(rng, 0.5)) {
      ctx.fillStyle = grad(ctx, -px, -px, px, px, [[0, tagColor], [0.5, shade(tagColor, 0.3)], [1, "#ffffff"]]);
    } else {
      ctx.fillStyle = tagColor;
    }
    ctx.fillText(tag, 0, 0);
    // drip
    ctx.strokeStyle = tagColor; ctx.lineWidth = 4;
    for (let d = 0; d < 4; d++) {
      const dx = -px * 0.4 + rng() * px * 0.8;
      ctx.beginPath(); ctx.moveTo(dx, px * 0.18); ctx.lineTo(dx, px * 0.18 + 18 + rng() * 30); ctx.stroke();
    }
    ctx.restore();
  }
  filmGrain(ctx, 768, 512, rng, 900, 0.04);
  vignette(ctx, 768, 512, 0.18);
  return canvas;
}

// ── MURAL2: bold flat-poster style street art (drawn at 768×512). ──
// A complementary mural look — big abstract shapes + portrait/pop motif rather
// than skyline. Shares the "mural" opts (sky/tag/tagColor) so it's drop-in.
export function mural2Canvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(768, 512);
  const rng = seedFor(opts, "mural2");
  const sky = opts.sky || pick(rng, MURAL_SKIES);
  ctx.fillStyle = grad(ctx, 0, 0, 768, 512, [[0, sky[0]], [0.5, sky[1]], [1, sky[2]]]);
  ctx.fillRect(0, 0, 768, 512);
  // big overlapping translucent geometric shapes
  const shapeCols = [sky[1], sky[2], pick(rng, ["#ffffff", "#ffd166", "#06d6a0", "#ef476f", "#118ab2", "#8338ec"])];
  for (let i = 0; i < 6; i++) {
    ctx.globalAlpha = 0.26 + rng() * 0.26;
    ctx.fillStyle = pick(rng, shapeCols);
    const kind = (rng() * 3) | 0;
    if (kind === 0) {
      ctx.beginPath(); ctx.arc(rng() * 768, rng() * 512, 60 + rng() * 130, 0, 6.283); ctx.fill();
    } else if (kind === 1) {
      ctx.save(); ctx.translate(rng() * 768, rng() * 512); ctx.rotate(rng() * 6.283);
      ctx.fillRect(-90, -90, 180, 180); ctx.restore();
    } else {
      const cx = rng() * 768, cy = rng() * 512, r = 80 + rng() * 120;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const an = k * 2.094 + rng();
        ctx[k ? "lineTo" : "moveTo"](cx + Math.cos(an) * r, cy + Math.sin(an) * r);
      }
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  halftone(ctx, 768, 512, "#000", 16, 2.4, 0.06);
  // bold word with a riso-style colour-offset ghost
  const tag = opts.tag || pick(rng, ["CREATE", "DREAM", "RISE", "UNITY", "BLOOM", "WANDER", "VIVID", "SHINE", "REBEL", "ORIGIN"]);
  const tagColor = opts.tagColor || pick(rng, ["#ffffff", "#fff3b0", "#0b132b", "#2b2d42"]);
  const ghost = pick(rng, ["#ef476f", "#ffd166", "#06d6a0", "#4cc9f0"]);
  ctx.save();
  ctx.translate(384, 270);
  ctx.rotate(-0.04 + rng() * 0.08);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  fitFont(ctx, tag, 700, 150, "900");
  ctx.fillStyle = withAlpha(ghost, 0.7); ctx.fillText(tag, 7, 7);
  ctx.lineWidth = 12; ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.strokeText(tag, 0, 0);
  ctx.fillStyle = tagColor; ctx.fillText(tag, 0, 0);
  ctx.restore();
  filmGrain(ctx, 768, 512, rng, 1000, 0.04);
  vignette(ctx, 768, 512, 0.2);
  return canvas;
}

// ── NEON: glowing tube sign on near-black (drawn at 512×512). ──
// Templates: 0 stacked words (classic), 1 word in glowing frame, 2 word+icon.
export function neonCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(512, 512);
  const rng = seedFor(opts, "neon");
  // dark base + faint central glow so the wall isn't dead flat
  const base = pick(rng, ["#07070d", "#0a0610", "#050a0a", "#0d0508", "#080a12"]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = radial(ctx, 256, 244, 40, 360, [[0, "rgba(255,255,255,0.05)"], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(0, 0, 512, 512);
  // faint brick courses
  if (chance(rng, 0.55)) {
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let y = 0; y < 512; y += 26) ctx.fillRect(0, y, 512, 13);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < 512; y += 26) ctx.fillRect(0, y + 12, 512, 2);
  }
  const palette = opts.color ? [opts.color, opts.color2 || pick(rng, NEON_PALETTES)[1]] : pick(rng, NEON_PALETTES);
  const color = palette[0], color2 = palette[1];
  const lines = opts.lines || [pick(rng, BRANDS), pick(rng, ["LOUNGE", "BAR", "CLUB", "ARCADE", "DINER", "MOTEL", "OPEN", "24HRS", "TATTOO", "KARAOKE"])];
  const tpl = opts.template != null ? opts.template : (rng() * 3) | 0;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  // layered tube glow: wide bloom → tight bloom → bright core + white rim
  const drawGlow = (t, cx, cy, c, sizeMax) => {
    fitFont(ctx, t, 440, sizeMax, "800");
    setShadow(ctx, c, 42); ctx.fillStyle = c; ctx.fillText(t, cx, cy);
    setShadow(ctx, c, 20); ctx.fillText(t, cx, cy);
    clearShadow(ctx);
    ctx.globalAlpha = 0.4; ctx.fillStyle = "#ffffff"; ctx.fillText(t, cx, cy); ctx.globalAlpha = 1;
    ctx.lineWidth = 2; ctx.strokeStyle = withAlpha("#ffffff", 0.55); ctx.strokeText(t, cx, cy);
  };

  if (tpl === 1) {
    // single line inside a glowing rounded frame
    setShadow(ctx, color, 28);
    ctx.strokeStyle = color; ctx.lineWidth = 10;
    roundRect(ctx, 60, 150, 392, 212, 26); ctx.stroke();
    clearShadow(ctx);
    ctx.strokeStyle = withAlpha("#ffffff", 0.5); ctx.lineWidth = 2;
    roundRect(ctx, 60, 150, 392, 212, 26); ctx.stroke();
    drawGlow(lines[0], 256, 230, color, 92);
    if (lines[1]) drawGlow(lines[1], 256, 312, color2, 56);
  } else if (tpl === 2) {
    // icon above word (e.g. cocktail/arrow/heart via glyph)
    const glyph = opts.glyph || pick(rng, ["✦", "♥", "➤", "♪", "☕", "✸", "◆", "♠", "✺", "♛"]);
    drawGlow(glyph, 256, 180, color2, 130);
    drawGlow(lines[0], 256, 320, color, 92);
    if (lines[1]) drawGlow(lines[1], 256, 400, color, 50);
  } else {
    // classic stacked words, alternating colours
    let y = 256 - (lines.length - 1) * 70;
    for (let i = 0; i < lines.length; i++) {
      drawGlow(lines[i], 256, y, i % 2 === 0 ? color : color2, 96);
      y += 140;
    }
  }
  // coloured glow "puddle" near the floor + CRT scanlines
  ctx.fillStyle = radial(ctx, 256, 470, 10, 240, [[0, withAlpha(color, 0.1)], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(0, 360, 512, 152);
  scanlines(ctx, 512, 512, 4, 0.1);
  return canvas;
}

// ── POSTER: portrait distressed poster (drawn at 512×768). ──
// Templates: 0 emblem block (classic), 1 big-glyph hero, 2 gig/event flyer.
export function posterCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(512, 768);
  const rng = seedFor(opts, "poster");
  const pal = withDefaults(opts, pick(rng, POSTER_PALETTES));
  const bg = pal.bg, ink = pal.ink, accent = pal.accent;
  const top = opts.top || pick(rng, ["WANTED", "LIVE", "TONIGHT", "GALAXY", "REVOLT", "ENCORE", "MIDNIGHT", "VOLT", "RIOT", "FUTURE", "UPROAR"]);
  const glyph = opts.glyph || pick(rng, ["★", "◐", "❖", "$", "♪", "▲", "☼", "✺", "♛", "◑"]);
  const tpl = opts.template != null ? opts.template : (rng() * 3) | 0;

  // paper with a subtle tonal gradient + a corner accent wash (riso feel)
  ctx.fillStyle = grad(ctx, 0, 0, 0, 768, [[0, shade(bg, 0.06)], [1, shade(bg, -0.08)]]);
  ctx.fillRect(0, 0, 512, 768);
  ctx.fillStyle = radial(ctx, 420, 90, 10, 380, [[0, withAlpha(accent, 0.18)], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(0, 0, 512, 768);
  const htDark = pick(rng, ["rgba(0,0,0,0.06)", "rgba(0,0,0,0.09)", "rgba(0,0,0,0.07)"]);
  halftone(ctx, 512, 768, htDark, 12, 2, 1);
  if (chance(rng, 0.6)) grunge(ctx, 512, 768, seedFor(opts, "wear"), 360, ink, 0.05);

  ctx.strokeStyle = ink; ctx.lineWidth = 8;
  ctx.strokeRect(22, 22, 512 - 44, 768 - 44);
  ctx.strokeStyle = withAlpha(accent, 0.6); ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, 512 - 64, 768 - 64);
  ctx.textAlign = "center";
  // riso-offset headline: accent ghost behind the ink
  fitFont(ctx, top, 440, 110, "900");
  ctx.fillStyle = withAlpha(accent, 0.85); ctx.fillText(top, 256 + 4, 130 + 4);
  ctx.fillStyle = ink; ctx.fillText(top, 256, 130);

  if (tpl === 1) {
    // big-glyph hero ring
    rays(ctx, 256, 400, 240, 24, accent, 0.18);
    ctx.fillStyle = radial(ctx, 256, 400, 8, 150, [[0, shade(accent, 0.22)], [1, accent]]);
    ctx.beginPath(); ctx.arc(256, 400, 150, 0, 6.283); ctx.fill();
    ctx.strokeStyle = withAlpha(bg, 0.5); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(256, 400, 134, 0, 6.283); ctx.stroke();
    ctx.fillStyle = bg;
    ctx.font = "900 180px sans-serif"; ctx.textBaseline = "middle";
    ctx.fillText(glyph, 256, 404);
    ctx.textBaseline = "alphabetic"; ctx.fillStyle = ink;
  } else if (tpl === 2) {
    // gig flyer: stacked billing lines
    ctx.fillStyle = accent;
    roundRect(ctx, 60, 210, 392, 70, 10); ctx.fill();
    const billing = opts.bottom || pick(rng, BRANDS);
    ctx.fillStyle = bg; fitFont(ctx, billing, 360, 52, "900");
    ctx.fillText(billing, 256, 256);
    ctx.fillStyle = ink;
    const acts = ["+ " + pick(rng, BRANDS), "& " + pick(rng, BRANDS), pick(rng, ["DOORS 8PM", "ALL AGES", "FREE ENTRY", "$15 ADV"])];
    let yy = 340;
    for (const act of acts) { fitFont(ctx, act, 420, 40, "700"); ctx.fillText(act, 256, yy); yy += 56; }
    ctx.fillStyle = accent;
    starburst(ctx, 256, 560, 70, 48, 12, accent);
    ctx.fillStyle = bg; ctx.font = "900 30px sans-serif"; ctx.textBaseline = "middle";
    ctx.fillText(pick(rng, ["FRI", "SAT", "NEW", "1NT"]), 256, 560);
    ctx.textBaseline = "alphabetic"; ctx.fillStyle = ink;
  } else {
    // classic central emblem block
    setShadow(ctx, "rgba(0,0,0,0.25)", 14, 0, 8);
    ctx.fillStyle = grad(ctx, 96, 220, 416, 520, [[0, shade(accent, 0.12)], [1, accent]]);
    roundRect(ctx, 96, 220, 320, 300, 18); ctx.fill();
    clearShadow(ctx);
    ctx.fillStyle = "#f6efe0";
    ctx.font = "900 150px sans-serif";
    ctx.fillText(glyph, 256, 390);
    ctx.fillStyle = ink;
    const bottom = opts.bottom != null ? opts.bottom : (chance(rng, 0.6) ? pick(rng, TAGLINES) : "");
    if (bottom) { fitFont(ctx, bottom, 440, 50, "700"); ctx.fillText(bottom, 256, 600); }
  }

  if (opts.foot) { ctx.fillStyle = ink; fitFont(ctx, opts.foot, 440, 34, "600"); ctx.fillText(opts.foot, 256, 680); }
  // torn-corner / tape accents
  if (chance(rng, 0.5)) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.save(); ctx.translate(chance(rng, 0.5) ? 70 : 442, 40); ctx.rotate(-0.5 + rng()); ctx.fillRect(-40, -10, 80, 20); ctx.restore();
  }
  filmGrain(ctx, 512, 768, rng, 900, 0.04);
  vignette(ctx, 512, 768, 0.16);
  return canvas;
}

// ── SIGN: simple bright shop sign (drawn at 512×512). ──
// Templates: 0 banner stripe (classic), 1 badge/roundel, 2 boxed letters.
export function signCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(512, 512);
  const rng = seedFor(opts, "sign");
  const pal = withDefaults(opts, pick(rng, SIGN_PALETTES));
  const bg = pal.bg, fg = pal.fg;
  const tpl = opts.template != null ? opts.template : (rng() * 3) | 0;
  const lines = (opts.text || pick(rng, BRANDS)).split(" ");

  // background — gradient solid, vignetted gradient or stripes
  const bgKind = (rng() * 3) | 0;
  if (bgKind === 0) {
    ctx.fillStyle = grad(ctx, 0, 0, 0, 512, [[0, shade(bg, 0.14)], [1, shade(bg, -0.12)]]);
    ctx.fillRect(0, 0, 512, 512);
  } else if (bgKind === 1) {
    ctx.fillStyle = grad(ctx, 0, 0, 512, 512, [[0, shade(bg, 0.1)], [0.5, bg], [1, "#000000"]]);
    ctx.fillRect(0, 0, 512, 512);
    ctx.globalAlpha = 0.4; ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 512); ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let i = -512; i < 512; i += 64) { ctx.save(); ctx.translate(i, 0); ctx.transform(1, 0, 0.5, 1, 0, 0); ctx.fillRect(0, 0, 30, 512); ctx.restore(); }
  }
  sheen(ctx, 512, 512, 0.1);

  // a small mounting bolt
  const screw = (cx, cy) => {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 6.283); ctx.fill();
    ctx.fillStyle = shade(fg, -0.1);
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 6.283); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy); ctx.stroke();
    ctx.restore();
  };

  if (tpl === 1) {
    // badge / roundel with bevel ring
    setShadow(ctx, "rgba(0,0,0,0.4)", 16, 0, 6);
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(256, 256, 200, 0, 6.283); ctx.fill();
    clearShadow(ctx);
    ctx.fillStyle = grad(ctx, 0, 56, 0, 456, [[0, shade(bg, 0.12)], [1, shade(bg, -0.1)]]);
    ctx.beginPath(); ctx.arc(256, 256, 180, 0, 6.283); ctx.fill();
    ctx.strokeStyle = withAlpha(fg, 0.5); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(256, 256, 168, 0, 6.283); ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let y = 256 - (lines.length - 1) * 56;
    for (const ln of lines) {
      fitFont(ctx, ln, 320, 88, "900");
      setShadow(ctx, "rgba(0,0,0,0.3)", 4, 0, 2); ctx.fillText(ln, 256, y); clearShadow(ctx);
      y += 112;
    }
  } else if (tpl === 2) {
    // boxed letters / framed with corner bolts
    ctx.strokeStyle = fg; ctx.lineWidth = 14;
    ctx.strokeRect(36, 36, 440, 440);
    ctx.strokeStyle = withAlpha(fg, 0.35); ctx.lineWidth = 4;
    ctx.strokeRect(52, 52, 408, 408);
    screw(60, 60); screw(452, 60); screw(60, 452); screw(452, 452);
    ctx.fillStyle = fg;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let y = 256 - (lines.length - 1) * 64;
    for (const ln of lines) {
      fitFont(ctx, ln, 400, 110, "900");
      setShadow(ctx, "rgba(0,0,0,0.35)", 6, 0, 3); ctx.fillText(ln, 256, y); clearShadow(ctx);
      y += 128;
    }
  } else {
    // classic top banner stripe + stacked words
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(0, 0, 512, 120);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 118, 512, 4);
    ctx.fillStyle = fg;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let y = 256 - (lines.length - 1) * 64;
    for (const ln of lines) {
      fitFont(ctx, ln, 440, 110, "900");
      setShadow(ctx, "rgba(0,0,0,0.35)", 6, 0, 3); ctx.fillText(ln, 256, y); clearShadow(ctx);
      y += 128;
    }
  }
  vignette(ctx, 512, 512, 0.14);
  return canvas;
}

// ── AD: clean magazine/transit ad (landscape 768×512) — a lighter, photo-poster
// counterpart to "billboard" for variety. Shares billboard-ish opts.
export function adCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(768, 512);
  const rng = seedFor(opts, "ad");
  const pal = withDefaults(opts, pick(rng, BILLBOARD_PALETTES));
  const accent = pal.accent;
  const title = opts.title || pick(rng, BRANDS);
  const sub = opts.sub != null ? opts.sub : pick(rng, TAGLINES);
  const glyph = opts.glyph || pick(rng, GLYPHS);

  // bright duotone field
  const light = pick(rng, ["#f6f4ef", "#eef2f7", "#fdf2e9", "#f0fff4", "#fff0f6", "#f4f0fb"]);
  ctx.fillStyle = grad(ctx, 0, 0, 768, 512, [[0, light], [1, "#ffffff"]]);
  ctx.fillRect(0, 0, 768, 512);
  // soft accent shape floating on the light side
  ctx.fillStyle = withAlpha(accent, 0.1);
  ctx.beginPath(); ctx.arc(700, 90, 150, 0, 6.283); ctx.fill();
  // colour block (left third) gradient with brand mark
  ctx.fillStyle = grad(ctx, 0, 0, 256, 512, [[0, shade(pal.a, 0.12)], [1, pal.a]]);
  ctx.fillRect(0, 0, 256, 512);
  halftone(ctx, 256, 512, "#fff", 16, 2, 0.08);
  ctx.fillStyle = withAlpha(accent, 0.9); ctx.fillRect(256, 0, 6, 512);
  setShadow(ctx, "rgba(0,0,0,0.3)", 16);
  ctx.fillStyle = accent;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "900 150px sans-serif";
  ctx.fillText(glyph, 128, 256);
  clearShadow(ctx);
  // headline on the light side
  ctx.fillStyle = pal.b;
  ctx.textAlign = "left";
  fitFont(ctx, title, 440, 88, "900");
  ctx.fillText(title, 300, 200);
  ctx.fillStyle = accent;
  ctx.fillRect(300, 232, 200, 8);
  ctx.fillStyle = "#3a3a44";
  fitFont(ctx, sub, 430, 40, "600");
  ctx.fillText(sub, 300, 300);
  // call-to-action pill with depth
  const cta = opts.cta || pick(rng, ["LEARN MORE", "SHOP NOW", "GET YOURS", "DISCOVER", "EXPLORE", "TRY IT FREE", "JOIN NOW"]);
  setShadow(ctx, "rgba(0,0,0,0.25)", 12, 0, 6);
  ctx.fillStyle = grad(ctx, 300, 360, 550, 424, [[0, shade(pal.a, 0.12)], [1, pal.a]]);
  roundRect(ctx, 300, 360, 250, 64, 32); ctx.fill();
  clearShadow(ctx);
  ctx.fillStyle = light;
  ctx.textAlign = "center";
  fitFont(ctx, cta, 220, 34, "800");
  ctx.fillText(cta, 425, 393);
  sheen(ctx, 768, 512, 0.06);
  vignette(ctx, 768, 512, 0.12);
  return canvas;
}

// ── DECK: skateboard-deck top graphic (drawn at 256×1024). ──
// Templates: 0 diagonal slashes+emblem (classic), 1 flames, 2 stacked logo.
export function deckCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(256, 1024);
  const rng = seedFor(opts, "deck");
  const pal = withDefaults(opts, pick(rng, DECK_PALETTES));
  const a = pal.a, b = pal.b, accent = pal.accent;
  const glyph = opts.glyph || pick(rng, ["☠", "★", "♠", "✦", "◉", "⚡", "♣", "✸", "☢", "✦"]);
  const tpl = opts.template != null ? opts.template : (rng() * 3) | 0;
  ctx.fillStyle = grad(ctx, 0, 0, 256, 1024, [[0, shade(a, 0.1)], [0.5, a], [1, b]]);
  ctx.fillRect(0, 0, 256, 1024);
  // pinstripe border tracing the deck outline
  ctx.strokeStyle = withAlpha(accent, 0.5); ctx.lineWidth = 4;
  roundRect(ctx, 16, 16, 224, 992, 110); ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";

  if (tpl === 1) {
    // flame tongues from the tail (gradient body + hot core)
    ctx.fillStyle = grad(ctx, 0, 1024, 0, 560, [[0, accent], [1, shade(accent, 0.4)]]);
    for (let f = 0; f < 7; f++) {
      const cx = 32 + f * 32;
      ctx.beginPath();
      ctx.moveTo(cx - 26, 1024);
      ctx.quadraticCurveTo(cx, 700 - rng() * 160, cx + 4, 600 - rng() * 120);
      ctx.quadraticCurveTo(cx + 8, 720, cx + 26, 1024);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 0.55; ctx.fillStyle = "#ffec99";
    for (let f = 0; f < 5; f++) {
      const cx = 50 + f * 40;
      ctx.beginPath();
      ctx.moveTo(cx - 14, 1024);
      ctx.quadraticCurveTo(cx, 800, cx + 2, 720);
      ctx.quadraticCurveTo(cx + 6, 840, cx + 14, 1024);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (tpl === 2) {
    // vertical stacked brand letters + bars
    const word = (opts.title || pick(rng, BRANDS)).slice(0, 6).split("");
    ctx.fillStyle = accent;
    ctx.fillRect(40, 120, 176, 14);
    ctx.fillRect(40, 904, 176, 14);
    ctx.font = "900 130px sans-serif";
    let y = 230, idx = 0;
    for (const ch of word) {
      ctx.fillStyle = idx % 2 ? "#ffffff" : accent;
      setShadow(ctx, "rgba(0,0,0,0.4)", 6, 0, 3); ctx.fillText(ch, 128, y); clearShadow(ctx);
      y += 120; idx++;
    }
  } else {
    // classic diagonal slashes + emblem
    ctx.strokeStyle = accent; ctx.lineWidth = 18;
    for (let i = -1024; i < 1024; i += 120) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i + 256); ctx.stroke();
    }
    setShadow(ctx, "rgba(0,0,0,0.45)", 14, 0, 6);
    ctx.fillStyle = radial(ctx, 128, 512, 4, 86, [[0, shade(accent, 0.3)], [1, accent]]);
    ctx.beginPath(); ctx.arc(128, 512, 78, 0, Math.PI * 2); ctx.fill();
    clearShadow(ctx);
    ctx.strokeStyle = withAlpha("#ffffff", 0.4); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(128, 512, 68, 0, 6.283); ctx.stroke();
    ctx.fillStyle = "#0b0b12";
    ctx.font = "900 96px sans-serif";
    ctx.fillText(glyph, 128, 520);
  }
  filmGrain(ctx, 256, 1024, rng, 700, 0.05);
  return canvas;
}

const STYLES = {
  billboard: billboardCanvas,
  mural: muralCanvas,
  mural2: mural2Canvas,
  neon: neonCanvas,
  poster: posterCanvas,
  sign: signCanvas,
  ad: adCanvas,
  deck: deckCanvas,
};

// Build a CanvasTexture from a named style + options.
export function artTexture(style, opts = {}) {
  const fn = STYLES[style] || billboardCanvas;
  return toTexture(fn(opts));
}

// A MeshstandardMaterial whose map is the procedural art immediately, but which
// async-upgrades to public/img/city/<file> if that PNG exists. Emissive-tinted so
// signs/billboards read well day or night.
export function artMaterial(style, opts = {}) {
  const tex = artTexture(style, opts);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.7,
    metalness: 0.05,
    emissive: new THREE.Color(opts.emissive || "#222228"),
    emissiveMap: tex,
    emissiveIntensity: opts.emissiveIntensity ?? 0.35,
  });
  // Optional PNG drop-in upgrade. OFF by default: those files don't ship, so
  // attempting them spammed the console with hundreds of 404s. To use real PNG art
  // later, drop files into public/img/city/ and set window.__cityArtImages = true
  // before the city builds — then the procedural texture upgrades to the PNG.
  if (opts.file && typeof window !== "undefined" && window.__cityArtImages) {
    new THREE.TextureLoader().load(
      `/img/city/${opts.file}`,
      (png) => {
        png.colorSpace = THREE.SRGBColorSpace;
        png.anisotropy = 4;
        mat.map = png;
        mat.emissiveMap = png;
        mat.needsUpdate = true;
      },
      undefined,
      () => { /* no PNG yet — keep the procedural texture */ }
    );
  }
  return mat;
}

// Convenience: a flat billboard panel mesh (double-sided) facing +Z by default.
export function artPanel(w, h, style, opts = {}) {
  const mat = artMaterial(style, opts);
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return mesh;
}
