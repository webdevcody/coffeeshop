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

// ── BILLBOARD: a bold landscape advert (1536×1024-ish, drawn at 768×512). ──
export function billboardCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(768, 512);
  const a = opts.a || "#1b3a6b";
  const b = opts.b || "#0c1830";
  const accent = opts.accent || "#ffcf3f";
  const title = opts.title || "BILLBOARD";
  const sub = opts.sub || "";
  const g = ctx.createLinearGradient(0, 0, 768, 512);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 768, 512);
  // accent stripes
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.16;
  for (let i = -512; i < 768; i += 90) ctx.fillRect(i, 0, 38, 512);
  ctx.globalAlpha = 1;
  // inner frame
  ctx.strokeStyle = accent;
  ctx.lineWidth = 12;
  ctx.strokeRect(26, 26, 768 - 52, 512 - 52);
  // title
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = accent;
  const px = fitFont(ctx, title, 660, 96, "900");
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  ctx.fillText(title, 384, sub ? 210 : 256);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (sub) {
    ctx.fillStyle = "#f2f6ff";
    fitFont(ctx, sub, 620, 44, "600");
    ctx.fillText(sub, 384, 300);
  }
  // a simple emblem
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(384, 410, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = b;
  ctx.font = "900 34px sans-serif";
  ctx.fillText(opts.glyph || "★", 384, 412);
  return canvas;
}

// ── MURAL: graffiti / skyline wall art (square-ish, drawn at 768×512). ──
export function muralCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(768, 512);
  const sky = opts.sky || ["#3a1f5d", "#b5417a", "#f4a04b"];
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, sky[0]);
  g.addColorStop(0.6, sky[1]);
  g.addColorStop(1, sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 768, 512);
  // sun
  ctx.fillStyle = "rgba(255,240,180,0.9)";
  ctx.beginPath();
  ctx.arc(560, 200, 70, 0, Math.PI * 2);
  ctx.fill();
  // layered skyline silhouettes
  const layers = [["#2a1742", 360], ["#1d1030", 410]];
  for (const [col, baseY] of layers) {
    ctx.fillStyle = col;
    let x = 0;
    while (x < 768) {
      const w = 40 + Math.random() * 70;
      const h = 60 + Math.random() * 160;
      ctx.fillRect(x, baseY - h, w, h + 120);
      // windows
      ctx.fillStyle = "rgba(255,220,120,0.5)";
      for (let wy = baseY - h + 12; wy < baseY; wy += 22) {
        for (let wx = x + 8; wx < x + w - 8; wx += 16) {
          if (Math.random() > 0.4) ctx.fillRect(wx, wy, 7, 11);
        }
      }
      ctx.fillStyle = col;
      x += w + 6;
    }
  }
  // graffiti tag
  if (opts.tag) {
    ctx.save();
    ctx.translate(384, 150);
    ctx.rotate(-0.05);
    ctx.textAlign = "center";
    ctx.font = "900 90px sans-serif";
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#0c0c16";
    ctx.strokeText(opts.tag, 0, 0);
    ctx.fillStyle = opts.tagColor || "#37e0c2";
    ctx.fillText(opts.tag, 0, 0);
    ctx.restore();
  }
  return canvas;
}

// ── NEON: glowing tube sign on near-black (square, drawn at 512×512). ──
export function neonCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(512, 512);
  ctx.fillStyle = "#07070d";
  ctx.fillRect(0, 0, 512, 512);
  const color = opts.color || "#ff4fa3";
  const color2 = opts.color2 || "#4fd2ff";
  const lines = opts.lines || ["NEON", "LOUNGE"];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let y = 256 - (lines.length - 1) * 70;
  for (let i = 0; i < lines.length; i++) {
    const c = i % 2 === 0 ? color : color2;
    const t = lines[i];
    fitFont(ctx, t, 440, 96, "800");
    ctx.shadowColor = c;
    ctx.shadowBlur = 32;
    ctx.fillStyle = c;
    ctx.fillText(t, 256, y);
    ctx.shadowBlur = 16;
    ctx.fillText(t, 256, y); // double pass = brighter glow
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.5;
    ctx.font = `800 ${Math.min(96, 96)}px sans-serif`;
    ctx.globalAlpha = 1;
    y += 140;
  }
  return canvas;
}

// ── POSTER: portrait distressed poster (drawn at 512×768). ──
export function posterCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(512, 768);
  ctx.fillStyle = opts.bg || "#e9e2cf";
  ctx.fillRect(0, 0, 512, 768);
  // halftone dots
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let y = 0; y < 768; y += 12) for (let x = 0; x < 512; x += 12) { ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.28); ctx.fill(); }
  ctx.strokeStyle = opts.ink || "#1c1c24";
  ctx.lineWidth = 8;
  ctx.strokeRect(22, 22, 512 - 44, 768 - 44);
  ctx.fillStyle = opts.ink || "#1c1c24";
  ctx.textAlign = "center";
  const top = opts.top || "WANTED";
  fitFont(ctx, top, 440, 110, "900");
  ctx.fillText(top, 256, 130);
  // central emblem block
  ctx.fillStyle = opts.accent || "#b8402f";
  roundRect(ctx, 96, 220, 320, 300, 18);
  ctx.fill();
  ctx.fillStyle = "#f6efe0";
  ctx.font = "900 150px sans-serif";
  ctx.fillText(opts.glyph || "$", 256, 390);
  ctx.fillStyle = opts.ink || "#1c1c24";
  const bottom = opts.bottom || "";
  if (bottom) {
    fitFont(ctx, bottom, 440, 50, "700");
    ctx.fillText(bottom, 256, 600);
  }
  if (opts.foot) {
    fitFont(ctx, opts.foot, 440, 34, "600");
    ctx.fillText(opts.foot, 256, 680);
  }
  return canvas;
}

// ── SIGN: simple bright shop sign (square, drawn at 512×512). ──
export function signCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(512, 512);
  ctx.fillStyle = opts.bg || "#c4302b";
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 0, 512, 120);
  ctx.fillStyle = opts.fg || "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = (opts.text || "SHOP").split(" ");
  let y = 256 - (lines.length - 1) * 64;
  for (const ln of lines) {
    fitFont(ctx, ln, 440, 110, "900");
    ctx.fillText(ln, 256, y);
    y += 128;
  }
  return canvas;
}

// ── DECK: skateboard-deck top graphic (tall, drawn at 256×1024). ──
export function deckCanvas(opts = {}) {
  const { canvas, ctx } = makeCanvas(256, 1024);
  const g = ctx.createLinearGradient(0, 0, 0, 1024);
  g.addColorStop(0, opts.a || "#111118");
  g.addColorStop(1, opts.b || "#2a0d14");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1024);
  // bold diagonal slashes
  ctx.strokeStyle = opts.accent || "#ff6a2b";
  ctx.lineWidth = 18;
  for (let i = -1024; i < 1024; i += 120) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i + 256);
    ctx.stroke();
  }
  // emblem
  ctx.fillStyle = opts.accent || "#ff6a2b";
  ctx.beginPath();
  ctx.arc(128, 512, 78, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0b0b12";
  ctx.font = "900 96px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(opts.glyph || "☠", 128, 520);
  return canvas;
}

const STYLES = {
  billboard: billboardCanvas,
  mural: muralCanvas,
  neon: neonCanvas,
  poster: posterCanvas,
  sign: signCanvas,
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
  if (opts.file) {
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
