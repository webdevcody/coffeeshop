// Faithful vanilla-JS (ESM) port of the original TypeScript `shipTextures.ts`.
//
// Reproduces — pixel-for-pixel, given the same canvas backend — the procedural
// CanvasTextures the original ship renderer painted onto its hulls, decks and
// flight deck, plus the tiling roughness/metalness break-up map and the
// V-channel panel-line normal map. No simplification: every gradient, strake,
// rivet, weather streak, draft mark and deck marking is ported verbatim.
//
// The only differences from the .ts source are TypeScript-only artefacts
// (type annotations, `interface HullPaint`, the `Texture` return type), which
// have no runtime effect. Caching behaviour matches the original exactly:
// `makeMetalRough()` and `panelNormal()` cache their single texture; the albedo
// builders mint a fresh texture per call as the original does.

import * as THREE from "three";

/** Small deterministic RNG so weathering is stable across reloads. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

/**
 * @typedef {Object} HullPaint
 * @property {number} hull
 * @property {number} deck
 * @property {string} accent
 */

const hex = (n) => "#" + n.toString(16).padStart(6, "0");
function shade(color, f) {
  const r = Math.min(255, ((color >> 16) & 255) * f);
  const g = Math.min(255, ((color >> 8) & 255) * f);
  const b = Math.min(255, (color & 255) * f);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/**
 * Hull side albedo: haze-gray paint with plate strakes, riveted butt seams, a
 * boot-topping stripe, a drop-shadowed hull number, weather streaks and draft
 * marks. High-res so detail survives the perimeter-UV stretch at distance.
 */
export function makeHullAlbedo(paint, hullNumber, seed = 7) {
  const W = 2048;
  const H = 384;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);

  // Vertical tonal structure: bright deck-edge band → mid → grimy low side.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, shade(paint.hull, 1.22));
  g.addColorStop(0.06, shade(paint.hull, 1.1));
  g.addColorStop(0.45, hex(paint.hull));
  g.addColorStop(0.8, shade(paint.hull, 0.88));
  g.addColorStop(1.0, shade(paint.hull, 0.74));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(232,238,242,0.55)";
  ctx.fillRect(0, 2, W, 2); // sheer line
  ctx.fillStyle = "rgba(8,12,16,0.3)";
  ctx.fillRect(0, 6, W, 2); // gunwale shadow

  const bootTop = H * 0.84;

  // Horizontal strake plating (dark groove + thin light upper lip).
  ctx.lineWidth = 1;
  for (let y = 24; y < bootTop; y += 30) {
    const wob = Math.sin(y * 0.6) * 1.2;
    ctx.strokeStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath();
    ctx.moveTo(0, y + wob);
    ctx.lineTo(W, y - wob);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.moveTo(0, y + wob - 1.5);
    ctx.lineTo(W, y - wob - 1.5);
    ctx.stroke();
  }

  // Vertical butt seams with rivet dots.
  for (let x = 48; x < W; x += 64) {
    const jx = x + (r() - 0.5) * 4;
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.moveTo(jx, 8);
    ctx.lineTo(jx, bootTop);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(jx + 1.5, 8);
    ctx.lineTo(jx + 1.5, bootTop);
    ctx.stroke();
    for (let y = 28; y < bootTop; y += 14) {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(jx - 1, y, 2, 2);
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fillRect(jx - 1, y - 1, 2, 1);
    }
  }

  // Weathering: rust (warm, low) + salt/grime (cool), plus deck-edge water trails.
  for (let i = 0; i < 180; i++) {
    const x = r() * W;
    const top = 8 + r() * bootTop * 0.6;
    const len = 18 + r() * 120;
    const low = top > bootTop * 0.5;
    const rust = low ? r() < 0.55 : r() < 0.25;
    const a = 0.1 + r() * 0.12;
    const col = rust
      ? `${(110 + r() * 40) | 0},${(60 + r() * 25) | 0},${(34 + r() * 18) | 0}`
      : `18,22,26`;
    const wg = ctx.createLinearGradient(0, top, 0, top + len);
    wg.addColorStop(0, `rgba(${col},0)`);
    wg.addColorStop(0.15, `rgba(${col},${a})`);
    wg.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = wg;
    ctx.fillRect(x, top, 1.5 + r() * 1.2, len);
  }
  for (let i = 0; i < 24; i++) {
    const x = r() * W;
    const len = bootTop * (0.5 + r() * 0.4);
    const wg = ctx.createLinearGradient(0, 8, 0, 8 + len);
    wg.addColorStop(0, "rgba(10,14,18,0.18)");
    wg.addColorStop(1, "rgba(10,14,18,0)");
    ctx.fillStyle = wg;
    ctx.fillRect(x, 8, 2 + r() * 1.5, len);
  }

  // Boot-topping stripe + below-waterline (drawn clean over the weathering).
  ctx.fillStyle = shade(paint.hull, 0.5);
  ctx.fillRect(0, bootTop + 10, W, H - bootTop - 10);
  ctx.fillStyle = "rgba(210,214,218,0.18)";
  ctx.fillRect(0, bootTop - 2, W, 2);
  ctx.fillStyle = paint.accent;
  ctx.fillRect(0, bootTop, W, 10);

  // Hull number with drop shadow + outline.
  const drawNum = (text, x, y, size, alpha) => {
    ctx.font = `bold ${size}px Arial`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(8,12,16,${alpha * 0.6})`;
    ctx.fillText(text, x + 3, y + 3);
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(20,26,30,${alpha * 0.5})`;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = `rgba(238,242,244,${alpha})`;
    ctx.fillText(text, x, y);
  };
  drawNum(hullNumber, W * 0.8, H * 0.4, 110, 0.95);
  drawNum(hullNumber, W * 0.04, H * 0.42, 70, 0.55);

  // Draft marks fore & aft.
  const drawDraft = (cx) => {
    ctx.textAlign = "center";
    for (let i = 0; i < 7; i++) {
      const y = bootTop - 6 - i * 18;
      const n = String(2 + i * 2);
      ctx.font = "bold 20px Arial";
      ctx.fillStyle = "rgba(8,12,16,0.5)";
      ctx.fillText(n, cx + 1, y + 1);
      ctx.fillStyle = "rgba(238,242,244,0.85)";
      ctx.fillText(n, cx, y);
      ctx.fillStyle = "rgba(238,242,244,0.7)";
      ctx.fillRect(cx + 14, y - 1, 6, 2);
    }
  };
  drawDraft(W * 0.92);
  drawDraft(W * 0.06);
  ctx.textAlign = "left";

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Tiling grayscale roughness/metalness break-up — the key "not flat clay" map. */
let cachedRough = null;
export function makeMetalRough() {
  if (cachedRough) return cachedRough;
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const r = rng(53);
  ctx.fillStyle = "rgb(150,150,150)"; // base ~0.6 roughness
  ctx.fillRect(0, 0, S, S);
  for (let x = 18; x < S; x += 44) {
    const grd = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(0.5, "rgba(40,40,40,0.45)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x - 14, 0, 28, S);
  }
  ctx.strokeStyle = "rgba(225,225,225,0.5)";
  ctx.lineWidth = 2;
  for (let y = 24; y < S; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
  }
  for (let x = 36; x < S; x += 44) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, S);
    ctx.stroke();
  }
  for (let i = 0; i < 140; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 6 + r() * 26;
    const rough = r() < 0.65;
    const a = 0.1 + r() * 0.22;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, rough ? `rgba(235,235,235,${a})` : `rgba(30,30,30,${a})`);
    grd.addColorStop(1, "rgba(150,150,150,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = `rgba(220,220,220,${0.05 + r() * 0.12})`;
    ctx.fillRect(r() * S, r() * S, 1, 14 + r() * 60);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cachedRough = tex;
  return tex;
}

/** Deck albedo: weathered non-skid grey with painted deck lines and fittings. */
export function makeDeckAlbedo(paint, opts = {}, seed = 11) {
  const W = 512;
  const H = 1024;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  ctx.fillStyle = shade(paint.deck, 0.92);
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    const v = 0.5 + r() * 0.5;
    ctx.fillStyle = `rgba(${30 * v},${34 * v},${38 * v},${r() * 0.25})`;
    ctx.fillRect(r() * W, r() * H, 1, 1);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(225,228,230,0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W * 0.5, 0);
  ctx.lineTo(W * 0.5, H);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.strokeRect(W * 0.12, H * 0.04, W * 0.76, H * 0.92);
  if (opts.helo) {
    ctx.strokeStyle = "rgba(240,240,240,0.7)";
    ctx.lineWidth = 5;
    const cx = W / 2;
    const cy = H * 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(240,240,240,0.7)";
    ctx.font = "bold 70px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("H", cx, cy);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Carrier flight-deck markings: runway centreline, landing area, deck numbers. */
export function makeFlightDeck(seed = 5) {
  const W = 512;
  const H = 1280;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  ctx.fillStyle = "#3a3f44";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 16000; i++) {
    const v = r();
    ctx.fillStyle = `rgba(0,0,0,${v * 0.18})`;
    ctx.fillRect(r() * W, r() * H, 1, 1);
  }
  ctx.save();
  ctx.translate(W * 0.42, H * 0.5);
  ctx.rotate(-0.13);
  ctx.fillStyle = "rgba(245,245,245,0.85)";
  for (let y = -H * 0.45; y < H * 0.45; y += 46) ctx.fillRect(-4, y, 8, 26);
  // bold landing-area box + touchdown bar + port drop-line ticks
  ctx.strokeStyle = "rgba(245,245,245,0.85)";
  ctx.lineWidth = 6;
  ctx.strokeRect(-W * 0.16, -H * 0.32, W * 0.32, H * 0.5);
  ctx.fillRect(-W * 0.16, -H * 0.02, W * 0.32, 10);
  for (let i = 0; i < 5; i++) ctx.fillRect(-W * 0.16 - 14, -H * 0.32 + i * H * 0.1, 8, 30);
  ctx.restore();
  ctx.fillStyle = "rgba(245,245,245,0.85)";
  ctx.fillRect(W * 0.28, H * 0.05, 9, H * 0.4);
  ctx.fillRect(W * 0.52, H * 0.03, 9, H * 0.36);
  ctx.font = "bold 120px Arial";
  ctx.textAlign = "center";
  ctx.fillText("72", W / 2, H * 0.95);
  ctx.fillStyle = "rgba(220,180,40,0.6)";
  for (let i = 0; i < 6; i++) ctx.fillRect(W * 0.15 + i * 30, H * 0.01, 16, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Crisp V-channel panel-line + brushed-grain normal map. */
let cachedNormal = null;
export function panelNormal() {
  if (cachedNormal) return cachedNormal;
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const r = rng(91);
  ctx.fillStyle = "rgb(128,128,255)";
  ctx.fillRect(0, 0, S, S);
  const groove = (x0, y0, x1, y1, horiz, str) => {
    const lo = 128 - str;
    const hi = 128 + str;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = horiz ? `rgb(128,${hi},235)` : `rgb(${hi},128,235)`;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = horiz ? `rgb(128,${lo},235)` : `rgb(${lo},128,235)`;
    ctx.beginPath();
    ctx.moveTo(x0 + (horiz ? 0 : 1.5), y0 + (horiz ? 1.5 : 0));
    ctx.lineTo(x1 + (horiz ? 0 : 1.5), y1 + (horiz ? 1.5 : 0));
    ctx.stroke();
  };
  for (let y = 24; y < S; y += 40) groove(0, y, S, y, true, 34);
  for (let x = 36; x < S; x += 44) groove(x, 0, x, S, false, 28);
  for (let i = 0; i < 260; i++) {
    const x = r() * S;
    const top = r() * S;
    const len = 20 + r() * 120;
    const tone = 118 + r() * 20;
    ctx.strokeStyle = `rgb(${tone | 0},128,250)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + (r() - 0.5) * 2, top + len);
    ctx.stroke();
  }
  for (let i = 0; i < 90; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 1 + r() * 2.5;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, "rgb(150,150,255)");
    grd.addColorStop(1, "rgba(128,128,255,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cachedNormal = tex;
  return tex;
}
