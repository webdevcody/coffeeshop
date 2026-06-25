// Small procedural canvas textures so the room has surface detail without
// shipping image assets. Each returns a THREE.CanvasTexture, drawn once at
// build time (no per-frame work) so they stay cheap.

import * as THREE from "three";

function canvas(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

// --- tiny deterministic-ish noise helpers -----------------------------------
// Cheap value noise so grain looks coherent (clumps) instead of pure static.
// We hash integer lattice points and bilerp; this is plenty for canvas detail.
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c0 = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = smooth(xf);
  const v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c0 * (1 - u) * v + d * u * v;
}

// Fractal (a few octaves) — returns 0..1.
function fbm(x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Sprinkle a soft monochrome grain layer over the whole canvas. Used by a few
// builders to break up flat fills. `strength` is the max alpha of a speck.
function speckle(ctx, size, count, strength, dark = true) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * strength;
    ctx.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
}

export function woodFloorTexture() {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#7a4a25";
  ctx.fillRect(0, 0, size, size);

  const plankH = 64;
  let row = 0;
  for (let y = 0; y < size; y += plankH, row++) {
    // Alternating plank tone plus a small per-plank random hue jitter so no two
    // planks read identically.
    const base = 100 + (row % 2) * 14 + (Math.random() * 10 - 5);
    const r = Math.round(base + 24);
    const g = Math.round(base - 18);
    const b = Math.round(base - 60);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, y + 1, size, plankH - 2);

    // Soft fbm wash across the plank for blotchy tonal variation.
    for (let x = 0; x < size; x += 4) {
      const n = fbm(x / 70, (y + 17 * row) / 70, 4);
      const shade = (n - 0.5) * 38;
      ctx.fillStyle = `rgba(${shade > 0 ? 255 : 0},${shade > 0 ? 235 : 0},${
        shade > 0 ? 200 : 0
      },${Math.min(0.22, Math.abs(shade) / 100)})`;
      ctx.fillRect(x, y + 1, 4, plankH - 2);
    }

    // Long flowing grain streaks — more of them, with varying darkness.
    const streaks = 34;
    for (let i = 0; i < streaks; i++) {
      const dark = 0.04 + Math.random() * 0.14;
      ctx.strokeStyle = `rgba(${50 + Math.random() * 20 | 0},${
        30 + Math.random() * 14 | 0
      },${12 + Math.random() * 10 | 0},${dark})`;
      ctx.lineWidth = Math.random() < 0.25 ? 1.6 : 1;
      const gy = y + 4 + Math.random() * (plankH - 8);
      const w1 = Math.random() * 8 - 4;
      const w2 = Math.random() * 8 - 4;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + w1, 340, gy + w2, size, gy + (Math.random() * 4 - 2));
      ctx.stroke();
    }

    // A few occasional knots for character.
    if (Math.random() < 0.6) {
      const kx = 30 + Math.random() * (size - 60);
      const ky = y + 12 + Math.random() * (plankH - 24);
      const kr = 3 + Math.random() * 4;
      const grad = ctx.createRadialGradient(kx, ky, 0.5, kx, ky, kr * 2.4);
      grad.addColorStop(0, "rgba(40,22,8,0.55)");
      grad.addColorStop(0.5, "rgba(60,36,16,0.30)");
      grad.addColorStop(1, "rgba(60,36,16,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr, kr * 1.5, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Plank seam with a subtle highlight on the lower edge (bevel feel).
    ctx.fillStyle = "rgba(30,18,8,0.6)";
    ctx.fillRect(0, y, size, 2);
    ctx.fillStyle = "rgba(255,235,200,0.06)";
    ctx.fillRect(0, y + 2, size, 1);

    // Staggered vertical butt-joints between boards along the plank.
    const joints = 1 + (Math.random() * 2 | 0);
    for (let j = 0; j < joints; j++) {
      const jx = ((row % 2) * 128 + 160 + j * 170 + Math.random() * 40) % size;
      ctx.fillStyle = "rgba(28,16,8,0.45)";
      ctx.fillRect(jx, y + 2, 1.5, plankH - 4);
    }
  }

  // Fine overall grain.
  speckle(ctx, size, 2600, 0.05, true);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function plasterTexture(color = "#efe2cf") {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  // Cloudy fbm mottling — gives the wall a hand-troweled, uneven look instead
  // of a flat fill with random dust. Two passes (light + dark) at different
  // scales build up depth.
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const n = fbm(x / 38, y / 38, 4);
      const n2 = fbm((x + 99) / 14, (y + 71) / 14, 3);
      const v = (n * 0.7 + n2 * 0.3 - 0.5) * 2; // -1..1
      if (v >= 0) {
        ctx.fillStyle = `rgba(255,250,240,${Math.min(0.12, v * 0.12)})`;
      } else {
        ctx.fillStyle = `rgba(70,55,38,${Math.min(0.12, -v * 0.12)})`;
      }
      ctx.fillRect(x, y, 2, 2);
    }
  }

  // Sparse trowel scratches / hairline cracks for surface tooth.
  for (let i = 0; i < 22; i++) {
    ctx.strokeStyle = `rgba(60,48,34,${0.04 + Math.random() * 0.06})`;
    ctx.lineWidth = Math.random() < 0.3 ? 1 : 0.6;
    const x0 = Math.random() * size;
    const y0 = Math.random() * size;
    const len = 20 + Math.random() * 60;
    const ang = Math.random() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
    ctx.stroke();
  }

  // Fine pitting in both directions so it reads as plaster up close.
  speckle(ctx, size, 1400, 0.05, true);
  speckle(ctx, size, 700, 0.05, false);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function chalkboardMenuTexture() {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext("2d");

  // Slate base with a faint vignette + cloudy dust so it isn't a flat green.
  ctx.fillStyle = "#20302b";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 3) {
    for (let x = 0; x < size; x += 3) {
      const n = fbm(x / 60, y / 60, 3) - 0.5;
      ctx.fillStyle = `rgba(${n > 0 ? 200 : 0},${n > 0 ? 220 : 0},${
        n > 0 ? 210 : 0
      },${Math.min(0.06, Math.abs(n) * 0.1)})`;
      ctx.fillRect(x, y, 3, 3);
    }
  }
  // Chalk dust haze (used-eraser smears) toward the edges.
  const vig = ctx.createRadialGradient(256, 256, 120, 256, 256, 360);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5; i++) {
    const sx = 40 + Math.random() * (size - 80);
    const sy = 40 + Math.random() * (size - 80);
    const sr = 40 + Math.random() * 70;
    const sm = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sm.addColorStop(0, "rgba(220,225,215,0.05)");
    sm.addColorStop(1, "rgba(220,225,215,0)");
    ctx.fillStyle = sm;
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  // Chalk speckle so writing sits on a textured surface.
  speckle(ctx, size, 900, 0.05, false);

  ctx.textAlign = "center";
  ctx.fillStyle = "#f6efe0";
  ctx.font = "bold 52px Georgia, serif";
  ctx.fillText("MENU", 256, 70);
  ctx.strokeStyle = "rgba(246,239,224,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(150, 88);
  ctx.lineTo(362, 88);
  ctx.stroke();
  // Hand-drawn double underline for chalk flavor.
  ctx.strokeStyle = "rgba(246,239,224,0.25)";
  ctx.beginPath();
  ctx.moveTo(158, 92);
  ctx.lineTo(356, 92);
  ctx.stroke();

  const items = [
    ["Espresso", "3"],
    ["Cappuccino", "4"],
    ["Latte", "4.5"],
    ["Cold Brew", "5"],
    ["Mocha", "5"],
    ["Croissant", "3.5"],
    ["Matcha", "5"],
  ];
  ctx.font = "28px Georgia, serif";
  let y = 140;
  for (const [name, price] of items) {
    // Tiny per-line jitter so it reads as handwritten chalk, not print.
    const jitter = Math.random() * 2 - 1;
    ctx.fillStyle = "#f6efe0";
    ctx.textAlign = "left";
    ctx.fillText(name, 70, y + jitter);
    ctx.textAlign = "right";
    ctx.fillText("$" + price, 442, y + jitter);
    // Faint dotted leader between name and price.
    ctx.strokeStyle = "rgba(246,239,224,0.18)";
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(70 + ctx.measureText(name).width + 80, y - 6);
    ctx.lineTo(360, y - 6);
    ctx.stroke();
    ctx.setLineDash([]);
    y += 46;
  }
  ctx.textAlign = "center";
  ctx.font = "italic 22px Georgia, serif";
  ctx.fillStyle = "#d8c79e";
  ctx.fillText("~ welcome, friend ~", 256, y + 18);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Additional opt-in builders. Nothing imports these yet; they're here so other
// modules (props, walls, counters) can adopt them without touching this file.
// All follow the same pattern: draw once, return a CanvasTexture.
// ---------------------------------------------------------------------------

// Running-bond brick wall. Good for an accent wall or fireplace surround.
export function brickTexture(brickColor = "#9c5a43", mortarColor = "#cdbfa6") {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = mortarColor;
  ctx.fillRect(0, 0, size, size);

  const bw = 64;
  const bh = 28;
  const mortar = 4;
  let row = 0;
  for (let y = 0; y < size; y += bh + mortar, row++) {
    const offset = (row % 2) * (bw / 2);
    for (let x = -bw; x < size; x += bw + mortar) {
      const bx = x + offset;
      // Per-brick tonal jitter.
      const j = Math.random() * 28 - 14;
      const base = parseInt(brickColor.slice(1), 16);
      let r = ((base >> 16) & 255) + j;
      let g = ((base >> 8) & 255) + j;
      let b = (base & 255) + j;
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(bx, y, bw, bh);

      // Weathering: mottle each brick with a little fbm-driven shadow.
      for (let py = 0; py < bh; py += 3) {
        for (let px = 0; px < bw; px += 3) {
          const n = fbm((bx + px) / 18, (y + py) / 18, 3) - 0.5;
          if (n > 0.08) {
            ctx.fillStyle = `rgba(40,20,12,${Math.min(0.18, n * 0.3)})`;
            ctx.fillRect(bx + px, y + py, 3, 3);
          }
        }
      }
      // Bottom/right shadow + top/left highlight for a touch of relief.
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(bx, y + bh - 2, bw, 2);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(bx, y, bw, 1);
    }
  }
  speckle(ctx, size, 1200, 0.05, true);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Woven fabric — for cushions, upholstery, curtains. Two-tone warp/weft.
export function fabricTexture(color = "#7d8a6b") {
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  const base = parseInt(color.slice(1), 16);
  const br = (base >> 16) & 255;
  const bg = (base >> 8) & 255;
  const bb = base & 255;
  const thread = 4;
  // Over/under weave: alternate which direction is "on top" per cell.
  for (let y = 0; y < size; y += thread) {
    for (let x = 0; x < size; x += thread) {
      const cell = ((x / thread) + (y / thread)) % 2 === 0;
      const shade = cell ? 18 : -16;
      const n = (fbm(x / 10, y / 10, 2) - 0.5) * 20;
      const r = Math.max(0, Math.min(255, br + shade + n));
      const g = Math.max(0, Math.min(255, bg + shade + n));
      const b = Math.max(0, Math.min(255, bb + shade + n));
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x, y, thread, thread);
      // Thread sheen on one edge.
      ctx.fillStyle = cell ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
      ctx.fillRect(x, y, thread, 1);
    }
  }
  speckle(ctx, size, 500, 0.04, true);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ceramic floor/wall tile with grout lines. Good for a kitchen/counter splash.
export function tiledTexture(tileColor = "#e9e4d8", groutColor = "#9a9384") {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, size, size);

  const tiles = 4;
  const grout = 6;
  const ts = (size - grout * (tiles + 1)) / tiles;
  const base = parseInt(tileColor.slice(1), 16);
  const br = (base >> 16) & 255;
  const bg = (base >> 8) & 255;
  const bb = base & 255;
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const x = grout + tx * (ts + grout);
      const y = grout + ty * (ts + grout);
      const j = Math.random() * 12 - 6;
      ctx.fillStyle = `rgb(${(br + j) | 0},${(bg + j) | 0},${(bb + j) | 0})`;
      ctx.fillRect(x, y, ts, ts);
      // Soft glaze gradient for a ceramic sheen.
      const g = ctx.createLinearGradient(x, y, x + ts, y + ts);
      g.addColorStop(0, "rgba(255,255,255,0.10)");
      g.addColorStop(0.5, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(0,0,0,0.06)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, ts, ts);
      // Beveled edge shading.
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(x, y, ts, 1);
      ctx.fillStyle = "rgba(0,0,0,0.10)";
      ctx.fillRect(x, y + ts - 1, ts, 1);
    }
  }
  // Speckle the grout subtly.
  speckle(ctx, size, 800, 0.04, true);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Brushed metal — for appliances, the espresso machine, fixtures. The grain
// runs horizontally; rotate UVs or swap repeat if a vertical brush is wanted.
export function metalTexture(color = "#b8bcc2") {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  // Broad vertical lighting bands so it reads as a curved-ish brushed panel.
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, "rgba(255,255,255,0.14)");
  grad.addColorStop(0.25, "rgba(0,0,0,0.10)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.10)");
  grad.addColorStop(0.75, "rgba(0,0,0,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0.08)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Fine horizontal brush lines.
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * size;
    const a = Math.random() * 0.08;
    ctx.strokeStyle =
      Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.lineWidth = Math.random() < 0.2 ? 1 : 0.5;
    const x0 = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + 40 + Math.random() * 180, y + (Math.random() * 2 - 1));
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
