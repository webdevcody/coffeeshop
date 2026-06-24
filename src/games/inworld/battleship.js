// Battleship — in-world 3D table game module (createGame contract).
//
// CANDIDATE VARIATION #0 — "labelled control pillars, hover crosshair reticle,
// canvas fleet-panel placards."
//
// A COMPLETE, self-contained ES module implementing createGame(ctx) → GameInstance
// per ./createGame.js. The framework (board.js → InWorldBoard) owns the café table,
// the per-room `net` relay, role/turn gating and spectator read-only mode. THIS
// module owns the rules, the 3D geometry (meshes parented to the table group) and
// per-cell hit-testing.
//
// WHAT THIS VARIATION DOES DIFFERENTLY (distinct UX/impl from sibling candidates,
// while satisfying the identical contract):
//
//   (A) The original DOM iframe's controls read as labelled buttons ("Rotate",
//       "Randomize", "Clear", "Ready ▸"). Here each in-world control is a raised
//       PILLAR whose top face carries a canvas-textured LABEL, so the player sees
//       the same words on the table — not a blank coloured box. Ready is greyed
//       (disabled tint + "Ready ▸" → kept dim) until all 5 ships are placed, exactly
//       as the original gates its READY control.
//
//   (B) Instead of bobbing target rings on every un-fired enemy cell, this variation
//       uses a single HOVER CROSSHAIR RETICLE that follows the pointer over enemy
//       waters via the framework's setHover() routing — closer to the original's
//       "aimed cell" affordance ("Pick a target on enemy waters"). The reticle turns
//       red/locked over already-fired cells. A faint live tint still marks the whole
//       enemy grid as "active" on your turn.
//
//   (C) The fleet-status panels are CANVAS PLACARDS (one per side) drawn to mimic the
//       original's .fleet-panel / .ship-row / .pips look: each of the 5 ships listed
//       by name with live/sunk pips, the row struck through + dimmed when SUNK. The
//       spectator sees both panels; a seated player sees the enemy panel (ships they
//       must sink) prominently and their own losses.
//
// Everything else follows the spec's exact flow + the createGame contract:
// orientPolicy:"self" self-orientation (each seat's own −Z ocean nearest), hidden-
// info safety (only shots/results on the wire, layout revealed cosmetically post-
// game), public-only snapshots for spectators, strict single-shot alternation,
// host-only start, turn derived purely from public shot counts on resync.
//
// SCOPE — DELIBERATE TABLETOP REINTERPRETATION, NOT AN ENVIRONMENT PORT:
// The original DOM build renders a moody open-sea dusk: a stock three Water plane
// (20000×20000), a stock Sky at dusk, and scene.fog = FogExp2(0x16243a, 0.0034).
// THIS module is, BY DESIGN, a tabletop reinterpretation: two metal "console
// platforms" carrying glassy dark-teal water inlays + glowing cyan grids, parented
// to the shared café table. It deliberately does NOT port the original's scene-
// level environment (Sky / Water / FogExp2 / PMREM env-map).
//
// This is an ARCHITECTURAL CEILING, not an oversight. The createGame(ctx) contract
// (see ./createGame.js and board.js) exposes only { THREE, table, anchorY, role,
// seatRy, seatIndex, seatCount, net, isLocalTurnAllowed, onGameOver, ...ctxExtra }.
// There is NO ctx.scene, ctx.renderer, ctx.camera, or ctx.environment. The module
// can only append geometry to a local THREE.Group parented under ctx.table; it
// physically cannot set scene.fog, add a 20000-unit Water/Sky, or build a PMREM
// environment map. Reproducing the original's open-sea mood would require a
// framework change to board.js (passing scene/renderer into ctx) and is OUT OF
// SCOPE for this module. The water-body hue (0x051a27) and grid palette are kept
// for silhouette fidelity, but the surrounding dusk environment is intentionally
// not reproduced. See PAL below for which constants are actually rendered.
//
// CANONICAL CONVENTION (createGame.js): row 0 / y 0 is the −Z edge = NEAREST the
// local seat after orientation. YOUR OCEAN sits at −Z (near); ENEMY WATERS at +Z
// (far). You place ships in front of you and fire across the table.
//
// WIRE FORMAT (only shot coordinates + outcomes ever leave the device):
//   { type:"place",  ready:true }                                  // I placed all ships
//   { type:"start",  first:"host"|"guest" }                        // host-only, once both ready
//   { type:"fire",   x, y }                                        // a shot at enemy cell (x,y)
//   { type:"result", x, y, outcome:"miss"|"hit"|"sunk", sunk? }    // defender's reply
//   { type:"reveal", layout }                                      // END-OF-GAME ONLY
//
// PUBLIC SNAPSHOT (publicState / applyState — spectator + opponent safe):
//   { phase, turn, first, winner, ready:{host,guest},
//     shots:{ host:[{x,y,outcome,sunk?}...], guest:[...] },
//     sunk:{ host:[shipId...], guest:[shipId...] } }
//   No occupancy, no hull, no placement anywhere — by design.

import { GameDesync, orientFor } from "./createGame.js";

// ===========================================================================
// PURE RULES — transport-free, self-contained.
// 10×10 grid, classic 5-ship fleet (17 cells), allowTouching = true.
// ===========================================================================
export const GRID = 10;
export const FLEET = [
  { id: "carrier", name: "Carrier", length: 5 },
  { id: "battleship", name: "Battleship", length: 4 },
  { id: "cruiser", name: "Cruiser", length: 3 },
  { id: "submarine", name: "Submarine", length: 3 },
  { id: "destroyer", name: "Destroyer", length: 2 },
];
export const FLEET_CELLS = 17;
const SHIP_BY_ID = new Map(FLEET.map((s) => [s.id, s]));
const SHIP_IDS = new Set(FLEET.map((s) => s.id));

export const inGrid = (x, y) => x >= 0 && x < GRID && y >= 0 && y < GRID;
const idx = (x, y) => y * GRID + x;

export function shipCells(ship) {
  const out = [];
  const spec = SHIP_BY_ID.get(ship.id);
  const len = spec ? spec.length : ship.length;
  for (let n = 0; n < len; n++) {
    out.push(
      ship.orientation === "vertical"
        ? { x: ship.x, y: ship.y + n }
        : { x: ship.x + n, y: ship.y }
    );
  }
  return out;
}

export function occupancyOf(placements) {
  const occ = new Array(GRID * GRID).fill(null);
  for (const ship of placements) {
    for (const cell of shipCells(ship)) {
      if (inGrid(cell.x, cell.y)) occ[idx(cell.x, cell.y)] = ship.id;
    }
  }
  return occ;
}

// canPlace — reject a duplicate id, any off-grid cell, or overlap. allowTouching
// is true, so adjacency is NOT checked.
export function canPlace(placements, ship) {
  if (placements.some((p) => p.id === ship.id)) return false;
  const occ = occupancyOf(placements);
  for (const cell of shipCells(ship)) {
    if (!inGrid(cell.x, cell.y)) return false;
    if (occ[idx(cell.x, cell.y)] != null) return false;
  }
  return true;
}

export const isComplete = (placements) => placements.length === FLEET.length;

export function randomFleet(rng = Math.random) {
  const placements = [];
  for (const spec of FLEET) {
    let placed = false;
    for (let attempt = 0; attempt < 1000 && !placed; attempt++) {
      const orientation = rng() < 0.5 ? "horizontal" : "vertical";
      const maxX = orientation === "horizontal" ? GRID - spec.length : GRID - 1;
      const maxY = orientation === "vertical" ? GRID - spec.length : GRID - 1;
      const x = Math.floor(rng() * (maxX + 1));
      const y = Math.floor(rng() * (maxY + 1));
      const ship = { id: spec.id, name: spec.name, length: spec.length, x, y, orientation };
      if (canPlace(placements, ship)) {
        placements.push(ship);
        placed = true;
      }
    }
    if (!placed) return null;
  }
  return placements;
}

// receiveFire — the DEFENDER resolves a shot against its OWN private grid. The
// ONLY function that reads ship positions; runs only on the owning client.
export function receiveFire(state, x, y) {
  if (!inGrid(x, y)) return null;
  const i = idx(x, y);
  if (state.firedAt[i]) return null; // already fired here
  state.firedAt[i] = true;
  const shipId = state.occ[i];
  if (shipId == null) return { outcome: "miss", allSunk: false };
  state.hitCount[shipId] = (state.hitCount[shipId] || 0) + 1;
  const spec = SHIP_BY_ID.get(shipId);
  if (state.hitCount[shipId] >= spec.length) {
    const allSunk = FLEET.every((s) => (state.hitCount[s.id] || 0) >= s.length);
    return { outcome: "sunk", sunk: shipId, allSunk };
  }
  return { outcome: "hit", allSunk: false };
}

export function validResult(msg) {
  if (!msg || !inGrid(msg.x, msg.y)) return false;
  if (msg.outcome !== "miss" && msg.outcome !== "hit" && msg.outcome !== "sunk") return false;
  if (msg.outcome === "sunk" && !SHIP_IDS.has(msg.sunk)) return false;
  if (msg.outcome !== "sunk" && msg.sunk != null) return false;
  return true;
}

export function validLayout(layout) {
  if (!Array.isArray(layout) || layout.length !== FLEET.length) return false;
  const acc = [];
  for (const spec of FLEET) {
    const ship = layout.find((s) => s && s.id === spec.id);
    if (!ship) return false;
    if (ship.orientation !== "horizontal" && ship.orientation !== "vertical") return false;
    const norm = { id: spec.id, name: spec.name, length: spec.length, x: ship.x, y: ship.y, orientation: ship.orientation };
    if (!canPlace(acc, norm)) return false;
    acc.push(norm);
  }
  return true;
}

// ===========================================================================
// GEOMETRY CONSTANTS (metres, in the board group's local XZ plane).
// YOUR OCEAN at −Z (near); ENEMY WATERS at +Z (far). col → X, row(=y) → Z.
//
// SIZING: the ORIGINAL battleship authors in big world units (CELL=10,
// GRID_SPAN=100, two grids centre-to-centre 144 → ~244 deep × ~114 wide incl.
// rim). We reproduce those PROPORTIONS but multiply by SCALE so the WHOLE
// board-pair fits comfortably inside the seated café-table camera framing (the
// inscribed BOARD_SIZE≈0.7 m square). 244 original units → ~0.62 m depth.
// ===========================================================================
const OCELL = 10; // original world units per cell
const OSPAN = OCELL * GRID; // 100 — one grid span in original units
const OGAP_C = 144; // original centre-to-centre gap between the two grids
const ODEPTH = OGAP_C + OSPAN; // 244 — full Z footprint incl. both grids
const SCALE = 0.62 / ODEPTH; // metres per original unit (≈0.00254)

const CELL = OCELL * SCALE; // ≈0.0254 m
const GRID_SPAN = OSPAN * SCALE; // ≈0.254 m
const HALF = GRID_SPAN / 2; // half a single grid in X
const GRID_GAP = (OGAP_C - OSPAN) * SCALE; // edge-to-edge open sea (≈0.112 m)
const OCEAN_CZ = -OGAP_C * SCALE / 2; // your ocean (near, −Z)
const ENEMY_CZ = OGAP_C * SCALE / 2; // enemy waters (far, +Z)

const BASE_T = 0.012;
const TILE_T = 0.004;
const SURF_Y = BASE_T;
const PEG_Y = SURF_Y + 0.006;

const HULL_H = CELL * 0.5;
const HULL_Y = SURF_Y + HULL_H / 2;

// ===========================================================================
// ORIGINAL PALETTE (hex) — moody dusk naval. Reproduced from the original
// battleship source so the silhouette / colour reads identically.
//
// NOTE: only the constants that are ACTUALLY RENDERED by this tabletop module are
// kept. The original's scene-level environment colours — FogExp2 0x16243a (horizon
// haze) and the Water sunColor 0xffd9a6 (warm sunset glint) — are intentionally
// omitted: there is no scene.fog and no three Water shader here to consume them
// (see the SCOPE note in the file header), so listing them would imply a fidelity
// this module does not render. PAL.water 0x051a27 is the rendered ocean-body hue.
// ===========================================================================
const PAL = {
  water: 0x051a27, // very dark teal-navy ocean body (inlay .color)
  platform: 0x163a47, // grid platform top
  rim: 0x3f8a99, // raised platform rim
  inlay: 0x123a4a, // glassy water inlay (play surface)
  grid: 0x9becff, // glowing cyan grid lines
  hover: 0x7ffcff,
  hoverEmis: 0x36c6d6,
  hit: 0xff5126,
  hitEmis: 0xff3b12,
  miss: 0xeaf6ff,
  missEmis: 0x9fd0e8,
};
// Per-class jewel-tone hull liveries (matte painted steel — low metalness).
const SHIP_PAINT = {
  carrier: { hull: 0x21407a, deck: 0x2c3138, accent: "#e8b021", num: "72", beam: 0.5, height: 7 },
  battleship: { hull: 0x7d2f2f, deck: 0x6a4a28, accent: "#101010", num: "61", beam: 0.5, height: 4.2 },
  cruiser: { hull: 0x1d6f79, deck: 0x223842, accent: "#0c1316", num: "52", beam: 0.42, height: 3.8 },
  submarine: { hull: 0x161a1e, deck: 0x202428, accent: "#0a0c0e", num: "21", beam: 0.46, height: 3.4 },
  destroyer: { hull: 0x394f9c, deck: 0x222b3a, accent: "#0d1322", num: "51", beam: 0.4, height: 4.0 },
};

const _texCache = new Map();
function _canvas(w, h) {
  if (typeof document === "undefined" || !document.createElement) return null;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
}
function _lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const _hex = (n) => "#" + n.toString(16).padStart(6, "0");
function _shade(color, f) {
  const r = Math.min(255, ((color >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((color >> 8) & 255) * f) | 0;
  const b = Math.min(255, (color & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

// Procedural water normal map (DataTexture, seamless tiling sum-of-sines).
// Direct port of the original makeWaterNormals — deterministic, no asset.
function makeWaterNormals(THREE, size = 256) {
  const key = "waterNormals" + size;
  if (_texCache.has(key)) return _texCache.get(key);
  const rand = _lcg(1337);
  const freqs = [2, 3, 4, 5, 6, 8, 11, 13];
  const waves = freqs.map((f) => {
    const a = rand() * Math.PI * 2;
    return { nx: Math.round(Math.cos(a) * f), ny: Math.round(Math.sin(a) * f), amp: 1 / (f * f * 0.12 + 1), phase: rand() * Math.PI * 2 };
  });
  const TAU = Math.PI * 2;
  const strength = 0.7;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let du = 0;
      let dv = 0;
      for (const w of waves) {
        const p = TAU * (w.nx * u + w.ny * v) + w.phase;
        const c = Math.cos(p) * w.amp * TAU;
        du += c * w.nx;
        dv += c * w.ny;
      }
      let nx = -du * strength;
      let ny = -dv * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  _texCache.set(key, tex);
  return tex;
}

// Cached tiling roughness/metalness map (plated steel) — port of makeMetalRough.
function makeMetalRough(THREE) {
  if (_texCache.has("metalRough")) return _texCache.get("metalRough");
  const cv = _canvas(256, 256);
  let tex;
  if (!cv) {
    tex = null;
  } else {
    const g = cv.getContext("2d");
    const rand = _lcg(91);
    g.fillStyle = "rgb(150,150,150)";
    g.fillRect(0, 0, 256, 256);
    for (let x = 9; x < 256; x += 22) {
      const grad = g.createLinearGradient(x, 0, x + 14, 0);
      grad.addColorStop(0, "rgba(40,40,40,0)");
      grad.addColorStop(0.5, "rgba(40,40,40,0.45)");
      grad.addColorStop(1, "rgba(40,40,40,0)");
      g.fillStyle = grad;
      g.fillRect(x, 0, 14, 256);
    }
    g.strokeStyle = "rgba(225,225,225,0.5)";
    g.lineWidth = 1;
    for (let y = 12; y < 256; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    for (let x = 18; x < 256; x += 22) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    for (let i = 0; i < 90; i++) {
      const x = rand() * 256;
      const y = rand() * 256;
      const r = 3 + rand() * 14;
      const bright = rand() < 0.65;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      const c = bright ? "235,235,235" : "30,30,30";
      rg.addColorStop(0, `rgba(${c},${0.1 + rand() * 0.22})`);
      rg.addColorStop(1, "rgba(150,150,150,0)");
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (THREE.NoColorSpace) tex.colorSpace = THREE.NoColorSpace;
  }
  _texCache.set("metalRough", tex);
  return tex;
}

// Cached tiling panel normal map — port of panelNormal (V-channel plate grooves).
function makePanelNormal(THREE) {
  if (_texCache.has("panelNormal")) return _texCache.get("panelNormal");
  const cv = _canvas(256, 256);
  let tex;
  if (!cv) {
    tex = null;
  } else {
    const g = cv.getContext("2d");
    const rand = _lcg(53);
    g.fillStyle = "rgb(128,128,255)";
    g.fillRect(0, 0, 256, 256);
    const groove = (horiz, step, str) => {
      g.lineWidth = 1;
      for (let p = 12; p < 256; p += step) {
        const lo = horiz ? `rgb(128,${128 - str},235)` : `rgb(${128 - str},128,235)`;
        const hi = horiz ? `rgb(128,${128 + str},235)` : `rgb(${128 + str},128,235)`;
        g.strokeStyle = lo;
        g.beginPath();
        if (horiz) { g.moveTo(0, p); g.lineTo(256, p); } else { g.moveTo(p, 0); g.lineTo(p, 256); }
        g.stroke();
        g.strokeStyle = hi;
        g.beginPath();
        if (horiz) { g.moveTo(0, p + 1.5); g.lineTo(256, p + 1.5); } else { g.moveTo(p + 1.5, 0); g.lineTo(p + 1.5, 256); }
        g.stroke();
      }
    };
    groove(true, 20, 34);
    groove(false, 22, 28);
    for (let i = 0; i < 160; i++) {
      const x = rand() * 256;
      const y = rand() * 256;
      const len = 10 + rand() * 70;
      g.strokeStyle = `rgb(${118 + (rand() * 20) | 0},128,250)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + len);
      g.stroke();
    }
    tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (THREE.NoColorSpace) tex.colorSpace = THREE.NoColorSpace;
  }
  _texCache.set("panelNormal", tex);
  return tex;
}

// Per-class hull albedo (canvas) — gradient + plating + weathering + boot-top +
// accent stripe + hull number. Condensed port of makeHullAlbedo.
function makeHullAlbedo(THREE, paint) {
  const key = "hull" + paint.hull + paint.num;
  if (_texCache.has(key)) return _texCache.get(key);
  const W = 1024;
  const H = 192;
  const cv = _canvas(W, H);
  let tex;
  if (!cv) {
    tex = null;
  } else {
    const g = cv.getContext("2d");
    const rand = _lcg(7 + (paint.hull & 255));
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.0, _shade(paint.hull, 1.22));
    grad.addColorStop(0.06, _shade(paint.hull, 1.1));
    grad.addColorStop(0.45, _hex(paint.hull));
    grad.addColorStop(0.8, _shade(paint.hull, 0.88));
    grad.addColorStop(1.0, _shade(paint.hull, 0.74));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // sheer line + gunwale shadow
    g.fillStyle = "rgba(232,238,242,0.55)";
    g.fillRect(0, 1, W, 2);
    g.fillStyle = "rgba(8,12,16,0.3)";
    g.fillRect(0, 4, W, 2);
    const bootTop = H * 0.84;
    // horizontal strakes
    for (let y = 14; y < bootTop; y += 16) {
      g.strokeStyle = "rgba(0,0,0,0.34)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y + Math.sin(y * 0.6) * 1.2);
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.1)";
      g.beginPath();
      g.moveTo(0, y - 1.5);
      g.lineTo(W, y - 1.5);
      g.stroke();
    }
    // vertical butt seams + rivets
    for (let x = 32; x < W; x += 48) {
      const xj = x + (rand() - 0.5) * 8;
      g.strokeStyle = "rgba(0,0,0,0.22)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xj, 0);
      g.lineTo(xj, bootTop);
      g.stroke();
      for (let y = 20; y < bootTop; y += 14) { g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(xj - 1, y, 2, 2); }
    }
    // weathering streaks
    for (let i = 0; i < 120; i++) {
      const x = rand() * W;
      const high = rand() < 0.5;
      const y0 = high ? 6 : H * 0.4;
      const len = 14 + rand() * 90;
      const col = high ? "18,22,26" : `${110 + (rand() * 40) | 0},${60 + (rand() * 30) | 0},${34 + (rand() * 20) | 0}`;
      g.strokeStyle = `rgba(${col},${0.1 + rand() * 0.12})`;
      g.lineWidth = 1 + rand() * 1.6;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x, y0 + len);
      g.stroke();
    }
    // boot-topping + accent stripe
    g.fillStyle = _shade(paint.hull, 0.5);
    g.fillRect(0, bootTop + 6, W, H - bootTop - 6);
    g.fillStyle = paint.accent;
    g.fillRect(0, bootTop, W, 6);
    // hull number
    const drawNum = (x, y, size, a) => {
      g.font = `bold ${size}px Arial`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = `rgba(8,12,16,${a * 0.6})`;
      g.fillText(paint.num, x + 2, y + 2);
      g.strokeStyle = `rgba(20,26,30,${a * 0.5})`;
      g.lineWidth = 3;
      g.strokeText(paint.num, x, y);
      g.fillStyle = `rgba(238,242,244,${a})`;
      g.fillText(paint.num, x, y);
    };
    drawNum(W * 0.8, H * 0.4, 64, 0.95);
    drawNum(W * 0.05, H * 0.42, 42, 0.55);
    tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
  }
  _texCache.set(key, tex);
  return tex;
}

// ===========================================================================
// THE MODULE
// ===========================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "battleship";

  let role = ctx.role;
  let seatRy = ctx.seatRy;
  let mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
  let oppSide = mySide === "host" ? "guest" : mySide === "guest" ? "host" : null;

  // optional DOM-HUD hook (never required — we always render an in-world HUD too)
  const hudHook = typeof ctx.onHud === "function" ? ctx.onHud : null;

  // ── Phase / turn state ──────────────────────────────────────────────────
  let phase = "placement"; // "placement" | "playing" | "over"
  let myTurn = false;
  let first = null; // "host" | "guest"
  let winner = null;
  const ready = { host: false, guest: false };

  // ── PRIVATE: my own fleet (never serialized except in the post-game reveal) ──
  let myPlacements = [];
  let myOcean = freshOceanState();
  function freshOceanState() {
    return { occ: new Array(GRID * GRID).fill(null), firedAt: new Array(GRID * GRID).fill(false), hitCount: {} };
  }

  // ── PUBLIC: the two shot grids ──────────────────────────────────────────
  const shots = { host: [], guest: [] };
  const tracking = { host: new Map(), guest: new Map() };
  const sunkBy = { host: new Set(), guest: new Set() };
  let pendingFire = null; // shot I sent and await a result for

  // ── Placement-phase interaction state ───────────────────────────────────
  let placeIndex = 0;
  let ghostOrient = "horizontal";
  let hoverCell = null; // last placement cell (ocean) under pointer
  let aimCol = -1; // hover col over enemy waters (from setHover routing)
  let aimRow = -1; // hover row over enemy waters (resolved on hover raycast)

  // ===========================================================================
  // Materials + geometries (created once; freed in dispose()).
  // HOST = steel blue, GUEST = amber. Local hulls + ocean trim use side colour.
  // ===========================================================================
  const SIDE_COLOR = { host: "#3f7fd6", guest: "#e0962f" };
  const myHullColor = mySide ? SIDE_COLOR[mySide] : "#5a636b";

  // Shared procedural maps (tiling steel + plate normal) for hulls + platforms.
  const metalRough = makeMetalRough(THREE);
  const panelNormal = makePanelNormal(THREE);

  // Animated water normal map for the glassy inlays (scrolled each frame).
  const waterNormals = makeWaterNormals(THREE, 256);

  // A dark-teal water inlay material with the procedural normal map. Both grids
  // use the SAME ocean body colour (the original has one sea); the frame rim +
  // cyan grid lines distinguish your ocean from enemy waters.
  function makeInlayMat(repeat) {
    const m = new THREE.MeshStandardMaterial({
      color: PAL.water,
      roughness: 0.18,
      metalness: 0.1,
      envMapIntensity: 1.4,
      transparent: true,
      opacity: 0.92,
    });
    if (waterNormals) {
      m.normalMap = waterNormals.clone();
      m.normalMap.needsUpdate = true;
      m.normalMap.wrapS = m.normalMap.wrapT = THREE.RepeatWrapping;
      m.normalMap.repeat.set(repeat, repeat);
      m.normalScale = new THREE.Vector2(0.35, 0.35);
    }
    return m;
  }

  const M = {
    base: new THREE.MeshStandardMaterial({ color: _hex(PAL.platform), roughness: 0.4, metalness: 0.85, envMapIntensity: 1.6 }),
    rim: new THREE.MeshStandardMaterial({ color: _hex(PAL.rim), roughness: 0.28, metalness: 0.9, envMapIntensity: 1.6 }),
    // your-ocean rim glows your side colour; enemy waters get the cyan-platform
    // accent so the two grids read apart at a glance.
    frameOcean: new THREE.MeshStandardMaterial({ color: mySide ? SIDE_COLOR[mySide] : "#3f8a99", roughness: 0.3, metalness: 0.85, emissive: "#06121e", emissiveIntensity: 0.35, envMapIntensity: 1.4 }),
    frameEnemy: new THREE.MeshStandardMaterial({ color: "#7a2230", roughness: 0.35, metalness: 0.8, emissive: "#1c0408", emissiveIntensity: 0.35, envMapIntensity: 1.2 }),
    oceanInlay: makeInlayMat(2),
    enemyInlay: makeInlayMat(2),
    gridLine: new THREE.LineBasicMaterial({ color: PAL.grid, transparent: true, opacity: 0.55 }),
    hull: new THREE.MeshStandardMaterial({ color: myHullColor, roughness: 0.82, metalness: 0.1, envMapIntensity: 0.45 }),
    hullDeck: new THREE.MeshStandardMaterial({ color: "#2c3238", roughness: 0.85, metalness: 0.3, envMapIntensity: 0.7 }),
    superstructure: new THREE.MeshStandardMaterial({ color: "#6f7980", roughness: 0.65, metalness: 0.18, normalMap: panelNormal || null, envMapIntensity: 0.45 }),
    black: new THREE.MeshStandardMaterial({ color: "#14181b", roughness: 0.5, metalness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: "#0a1418", roughness: 0.08, metalness: 0.1, envMapIntensity: 1.6 }),
    miss: new THREE.MeshStandardMaterial({ color: _hex(PAL.miss), emissive: _hex(PAL.missEmis), emissiveIntensity: 0.4, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.92 }),
    hit: new THREE.MeshStandardMaterial({ color: _hex(PAL.hit), emissive: _hex(PAL.hitEmis), emissiveIntensity: 2.0, roughness: 0.4, metalness: 0.1 }),
    sunkMark: new THREE.MeshStandardMaterial({ color: "#8a1c0c", emissive: "#ff3b12", emissiveIntensity: 1.4, roughness: 0.5, metalness: 0.2 }),
    shell: new THREE.MeshStandardMaterial({ color: "#d9dde2", roughness: 0.5, metalness: 0.3 }),
    shellNose: new THREE.MeshStandardMaterial({ color: "#9a1f1f", roughness: 0.5, metalness: 0.3 }),
    shellFlame: new THREE.MeshStandardMaterial({ color: "#ffd27a", emissive: "#ff7b1a", emissiveIntensity: 4, roughness: 1 }),
    ghostOk: new THREE.MeshStandardMaterial({ color: "#49f08a", emissive: "#0c3320", emissiveIntensity: 0.45, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.5, depthWrite: false }),
    ghostBad: new THREE.MeshStandardMaterial({ color: "#ff5555", emissive: "#3a0a02", emissiveIntensity: 0.45, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.5, depthWrite: false }),
    enemyLive: new THREE.MeshBasicMaterial({ color: _hex(PAL.hover), transparent: true, opacity: 0.14, depthWrite: false }),
    target: new THREE.MeshBasicMaterial({ color: _hex(PAL.grid), transparent: true, opacity: 0.75, depthWrite: false }),
    reticleOk: new THREE.MeshBasicMaterial({ color: "#7ffcff", transparent: true, opacity: 0.95, depthWrite: false }),
    reticleBad: new THREE.MeshBasicMaterial({ color: "#ff6a5a", transparent: true, opacity: 0.95, depthWrite: false }),
    splash: new THREE.MeshBasicMaterial({ color: "#eef6ff", transparent: true, opacity: 0.9, depthWrite: false }),
    ember: new THREE.MeshBasicMaterial({ color: "#ff7b3c", transparent: true, opacity: 0.95, depthWrite: false }),
    pillarIdle: new THREE.MeshStandardMaterial({ color: "#1d4a5a", roughness: 0.4, metalness: 0.6, emissive: "#06181f", emissiveIntensity: 0.4, envMapIntensity: 1.2 }),
    pillarGo: new THREE.MeshStandardMaterial({ color: "#2f8a99", roughness: 0.35, metalness: 0.6, emissive: "#0c3340", emissiveIntensity: 0.6, envMapIntensity: 1.2 }),
    pillarDim: new THREE.MeshStandardMaterial({ color: "#2a343a", roughness: 0.7, metalness: 0.3, emissive: "#080d10", emissiveIntensity: 0.2 }),
    invisible: new THREE.MeshBasicMaterial({ visible: false }),
  };

  // Per-class hull materials (matte painted steel, textured) built lazily.
  const hullMatCache = new Map();
  function hullMatFor(shipId) {
    if (hullMatCache.has(shipId)) return hullMatCache.get(shipId);
    const paint = SHIP_PAINT[shipId];
    const mat = new THREE.MeshStandardMaterial({ color: _hex(paint.hull), roughness: 0.82, metalness: 0.1, envMapIntensity: 0.45 });
    const alb = makeHullAlbedo(THREE, paint);
    if (alb) mat.map = alb;
    if (panelNormal) { mat.normalMap = panelNormal; mat.normalScale = new THREE.Vector2(0.3, 0.3); }
    if (metalRough) {
      const rm = metalRough.clone();
      rm.needsUpdate = true;
      rm.wrapS = rm.wrapT = THREE.RepeatWrapping;
      rm.repeat.set(6, 1);
      mat.roughnessMap = rm;
      mat.metalnessMap = rm;
    }
    hullMatCache.set(shipId, mat);
    return mat;
  }
  function deckMatFor(shipId) {
    const k = "deck:" + shipId;
    if (hullMatCache.has(k)) return hullMatCache.get(k);
    const paint = SHIP_PAINT[shipId];
    const mat = new THREE.MeshStandardMaterial({ color: _hex(paint.deck), roughness: 0.85, metalness: 0.3, envMapIntensity: 0.7 });
    hullMatCache.set(k, mat);
    return mat;
  }

  const G = {
    inlay: new THREE.PlaneGeometry(GRID_SPAN, GRID_SPAN, 1, 1),
    hit: new THREE.BoxGeometry(CELL * 0.98, HULL_H * 1.4, CELL * 0.98),
    // MISS = flat disc (original CircleGeometry CELL*0.34). HIT = red peg
    // (CylinderGeometry CELL*0.16/0.2 height 0.024).
    missDisc: new THREE.CircleGeometry(CELL * 0.34, 24),
    peg: new THREE.CylinderGeometry(CELL * 0.16, CELL * 0.2, CELL * 0.24, 18),
    emberPeg: new THREE.SphereGeometry(CELL * 0.2, 12, 10),
    ring: new THREE.TorusGeometry(CELL * 0.34, CELL * 0.05, 8, 22),
    pillar: new THREE.BoxGeometry(CELL * 1.4, CELL * 0.5, CELL * 0.95),
    bit: new THREE.SphereGeometry(CELL * 0.07, 6, 5),
  };

  function cellX(x) { return -HALF + (x + 0.5) * CELL; }
  function cellZ(y, which) {
    const cz = which === "ocean" ? OCEAN_CZ : ENEMY_CZ;
    return cz - GRID_SPAN / 2 + (y + 0.5) * CELL;
  }

  // ── Live scene bookkeeping ──────────────────────────────────────────────
  const hullMeshes = [];
  const oceanShotMarks = new Map(); // enemy shots landing on MY ocean
  const enemyShotMarks = new Map(); // MY shots on enemy waters
  let ghostMesh = null;
  const placeButtons = []; // { mesh, btn, label, tex, cv }
  let enemyLivePlate = null;
  let reticle = null;
  let laneMesh = null;
  const targetRings = []; // bobbing rings on un-fired enemy cells (my turn)

  // Fleet-status placards (canvas-textured planes). Spectator: both. Seated: one
  // for the enemy fleet (what I must sink) and one for my own losses.
  const panels = []; // { mesh, cv, tex, firer }

  // HUD billboard (canvas-textured plane above the board, faces camera).
  let hudMesh = null;

  // Each client renders with its OWN seatRy; orientFor(seatRy) ALONE brings that
  // seat's near edge (local −Z ocean) to the front. No extra per-role PI.
  function applyFacing() {
    group.rotation.y = orientFor(seatRy);
    aimLabels(); // keep pillar labels upright for the local seat
  }

  buildStaticBoard();
  buildColliders();
  buildPanels();
  buildHud();
  applyFacing();

  // ===========================================================================
  // Static geometry — two metal "console platforms on the sea", each carrying a
  // glassy dark-teal water inlay + a glowing cyan grid (the original board3d
  // look), scaled to the café table. YOUR OCEAN (−Z) and ENEMY WATERS (+Z).
  // ===========================================================================
  function buildStaticBoard() {
    // Platform geometry, in original units → metres. top 108, rim 114, inlay 100.
    const platW = (OSPAN + 8) * SCALE;
    const rimW = (OSPAN + 14) * SCALE;
    const platH = 4 * SCALE;
    const rimH = 3 * SCALE;

    for (const which of ["ocean", "enemy"]) {
      const cz = which === "ocean" ? OCEAN_CZ : ENEMY_CZ;

      // rim (raised frame, slightly larger & lower)
      const rim = new THREE.Mesh(new THREE.BoxGeometry(rimW, rimH, rimW), M.rim);
      rim.position.set(0, SURF_Y - platH - rimH * 0.4, cz);
      rim.receiveShadow = true;
      group.add(rim);

      // top deck
      const deck = new THREE.Mesh(new THREE.BoxGeometry(platW, platH, platW), M.base);
      deck.position.set(0, SURF_Y - platH / 2, cz);
      deck.receiveShadow = true;
      group.add(deck);

      // glassy water inlay (the play surface)
      const inlay = new THREE.Mesh(G.inlay, which === "ocean" ? M.oceanInlay : M.enemyInlay);
      inlay.rotation.x = -Math.PI / 2;
      inlay.position.set(0, SURF_Y - 0.0008, cz);
      inlay.receiveShadow = true;
      group.add(inlay);

      // glowing cyan grid lines (LineSegments cross-hatch, just above inlay)
      const pos = [];
      const half = GRID_SPAN / 2;
      for (let i = 0; i <= GRID; i++) {
        const p = -half + i * CELL;
        pos.push(p, 0, -half, p, 0, half);
        pos.push(-half, 0, p, half, 0, p);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const lines = new THREE.LineSegments(geo, M.gridLine);
      lines.position.set(0, SURF_Y + 0.0006, cz);
      group.add(lines);

      // a thin coloured frame band so you read "mine" vs "theirs" instantly.
      const mat = which === "ocean" ? M.frameOcean : M.frameEnemy;
      const fw = GRID_SPAN + CELL * 0.18;
      const t = CELL * 0.14;
      const h = HULL_H * 0.4;
      const fy = SURF_Y + h / 2 - 0.001;
      const rails = [
        [new THREE.BoxGeometry(fw, h, t), 0, cz - GRID_SPAN / 2 - t / 2],
        [new THREE.BoxGeometry(fw, h, t), 0, cz + GRID_SPAN / 2 + t / 2],
        [new THREE.BoxGeometry(t, h, GRID_SPAN + t * 2), -HALF - t / 2, cz],
        [new THREE.BoxGeometry(t, h, GRID_SPAN + t * 2), HALF + t / 2, cz],
      ];
      for (const [g2, x, z] of rails) {
        const rail = new THREE.Mesh(g2, mat);
        rail.position.set(x, fy, z);
        rail.castShadow = true;
        rail.receiveShadow = true;
        group.add(rail);
      }
    }

    buildPlaceButtons();
  }

  // Labelled control pillars hovering just in front of (slightly −Z of) YOUR
  // ocean's near edge. Each pillar's top face is a canvas-textured label so the
  // player reads the original's words. Anchored to the local −Z ocean: Fix-A
  // self-orientation renders them in front of whichever seat owns that ocean.
  function buildPlaceButtons() {
    const defs = [
      { btn: "rotate", label: "Rotate", mat: M.pillarIdle },
      { btn: "random", label: "Randomize", mat: M.pillarIdle },
      { btn: "clear", label: "Clear", mat: M.pillarIdle },
      { btn: "ready", label: "Ready ▸", mat: M.pillarGo },
    ];
    const rowZ = OCEAN_CZ - GRID_SPAN / 2 + CELL * 0.55;
    const bx0 = -HALF * 0.72;
    const bxStep = (HALF * 1.44) / 3;
    defs.forEach((d, i) => {
      const m = new THREE.Mesh(G.pillar, d.mat.clone());
      m.position.set(bx0 + i * bxStep, SURF_Y + CELL * 0.4, rowZ);
      m.castShadow = true;
      m.userData.btn = d.btn;
      group.add(m);

      // Canvas label on the top face. A pivot group spins the flat label in the
      // table plane so the words read RIGHT-SIDE-UP for the LOCAL seated player.
      // The pillars are anchored to the local −Z ocean and the whole group is
      // rotated by orientFor(seatRy); without this counter-rotation the labels
      // render upside-down for seats whose facing is π (opposite chair). We store
      // the pivot and re-aim it in applyFacing() (same idea as the menu/connect4
      // faceplate facing fix).
      const pivot = new THREE.Group();
      pivot.position.set(0, CELL * 0.26, 0);
      const lbl = makeLabelMesh(d.label, CELL * 1.34, CELL * 0.9);
      lbl.rotation.x = -Math.PI / 2;
      pivot.add(lbl);
      m.add(pivot);

      placeButtons.push({ mesh: m, btn: d.btn, label: d.label, lblTex: lbl.userData.tex, lblCv: lbl.userData.cv, idleMat: d.mat, pivot });
    });
    aimLabels();
    refreshButtons();
  }

  // Spin each flat tabletop label so its baseline faces the LOCAL seat. The plane
  // (rotation.x=−π/2) authors its text "up" toward the −Z near edge, i.e. TOWARD
  // the seated player — which reads UPSIDE DOWN. The board group is already
  // rotated by orientFor(seatRy) so the pillars/placards face the local seat from
  // any chair; we just need a constant π flip so the text top points AWAY from the
  // player (the upright reading direction on a flat surface). No per-seat term is
  // needed (verified across all four chairs): the group's own facing rotation
  // already carries the label to the right place.
  function aimLabels() {
    for (const b of placeButtons) {
      if (b.pivot) b.pivot.rotation.y = Math.PI;
    }
    for (const p of panels) {
      if (p.pivot) p.pivot.rotation.y = Math.PI;
    }
  }

  // A small canvas-textured plane carrying a single line of text.
  function makeLabelMesh(text, w, h) {
    const canCreate = typeof document !== "undefined" && document.createElement;
    const cv = canCreate ? document.createElement("canvas") : null;
    if (cv) { cv.width = 256; cv.height = 128; }
    const tex = cv ? new THREE.CanvasTexture(cv) : null;
    if (tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const mat = tex
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      : new THREE.MeshBasicMaterial({ color: "#dfe9f2", transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.userData.cv = cv;
    mesh.userData.tex = tex;
    mesh.renderOrder = 8;
    drawLabel(cv, tex, text, "#eaf3fb");
    return mesh;
  }

  function drawLabel(cv, tex, text, color) {
    if (!cv || !tex) return;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.font = "bold 48px sans-serif";
    g.fillText(text, cv.width / 2, cv.height / 2);
    tex.needsUpdate = true;
  }

  // Visibility + Ready-disabled tint, matching the original's gated READY control.
  function refreshButtons() {
    const show = phase === "placement" && !!mySide && !ready[mySide];
    for (const b of placeButtons) {
      b.mesh.visible = show;
      if (b.btn === "ready") {
        const enabled = isComplete(myPlacements);
        b.mesh.material = enabled ? M.pillarGo : M.pillarDim;
        drawLabel(b.lblCv, b.lblTex, enabled ? "Ready ▸" : "Ready ▸", enabled ? "#eafff1" : "#8b97a0");
      }
    }
  }

  // Per-cell invisible colliders over BOTH grids, tagged {r,c,which}.
  function buildColliders() {
    for (const which of ["ocean", "enemy"]) {
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const box = new THREE.Mesh(G.hit, M.invisible);
          box.position.set(cellX(x), SURF_Y + HULL_H * 0.3, cellZ(y, which));
          box.userData.cell = { r: y, c: x, which };
          group.add(box);
        }
      }
    }
  }

  // ===========================================================================
  // Fleet-status placards — canvas planes mimicking the original .fleet-panel:
  // ship rows by name + live/sunk pips; the row is struck-through + dimmed when
  // the ship is sunk. firer = the side that SANK those ships.
  // ===========================================================================
  function buildPanels() {
    const W = GRID_SPAN * 0.66;
    const H = GRID_SPAN * 0.62;
    const make = (firer, x) => {
      const canCreate = typeof document !== "undefined" && document.createElement;
      const cv = canCreate ? document.createElement("canvas") : null;
      if (cv) { cv.width = 320; cv.height = 300; }
      const tex = cv ? new THREE.CanvasTexture(cv) : null;
      if (tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      const mat = tex
        ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
        : new THREE.MeshBasicMaterial({ color: "#0c2036", transparent: true, opacity: 0.85, depthWrite: false });
      // A pivot keeps the placard text upright for the local seat (same facing
      // fix as the pillar labels) regardless of the group's orientFor rotation.
      const pivot = new THREE.Group();
      pivot.position.set(x, SURF_Y + 0.002, ENEMY_CZ + GRID_SPAN / 2 + H * 0.62);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 6;
      mesh.userData.cv = cv;
      mesh.userData.tex = tex;
      pivot.add(mesh);
      group.add(pivot);
      panels.push({ mesh, cv, tex, firer, pivot });
    };
    if (mySide) {
      // Enemy fleet I must sink (firer = me), plus my losses (firer = opponent).
      make(mySide, -W * 0.62);
      make(oppSide, W * 0.62);
    } else {
      make("host", -W * 0.62);
      make("guest", W * 0.62);
    }
    refreshPanels();
  }

  // firer's pips = ships firer has sunk on the opponent. Title names whose fleet.
  function refreshPanels() {
    for (const p of panels) {
      const cv = p.cv, tex = p.tex;
      if (!cv || !tex) continue;
      const g = cv.getContext("2d");
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = "rgba(8,18,30,0.86)";
      roundRect(g, 6, 6, cv.width - 12, cv.height - 12, 18);
      g.fill();
      // The fleet that firer is sinking belongs to the OTHER side.
      const ownerSide = p.firer === "host" ? "guest" : "host";
      const isMine = mySide && ownerSide === mySide;
      const accent = p.firer === "host" ? SIDE_COLOR.host : SIDE_COLOR.guest;
      g.lineWidth = 4;
      g.strokeStyle = accent;
      g.stroke();
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillStyle = accent;
      g.font = "bold 26px sans-serif";
      const title = mySide ? (isMine ? "Your Fleet" : "Enemy Fleet") : (ownerSide === "host" ? "Host Fleet" : "Guest Fleet");
      g.fillText(title, 22, 34);
      const sunkCount = sunkBy[p.firer].size;
      g.fillStyle = "#9fb2c0";
      g.font = "16px sans-serif";
      g.textAlign = "right";
      g.fillText(`${sunkCount}/${FLEET.length} sunk`, cv.width - 22, 34);

      let yy = 76;
      const rowH = (cv.height - 96) / FLEET.length;
      for (const spec of FLEET) {
        const dead = sunkBy[p.firer].has(spec.id);
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.font = "bold 20px sans-serif";
        g.fillStyle = dead ? "#7d4a4a" : "#dfe9f2";
        g.fillText(spec.name, 22, yy);
        if (dead) {
          g.strokeStyle = "#b1463c";
          g.lineWidth = 2;
          const w = g.measureText(spec.name).width;
          g.beginPath();
          g.moveTo(22, yy);
          g.lineTo(22 + w, yy);
          g.stroke();
        }
        // pips
        const pipR = 6;
        const pipGap = 18;
        const px0 = cv.width - 22 - spec.length * pipGap;
        for (let i = 0; i < spec.length; i++) {
          g.beginPath();
          g.arc(px0 + i * pipGap + pipGap / 2, yy, pipR, 0, Math.PI * 2);
          g.fillStyle = dead ? "#8a1c0c" : accent;
          g.fill();
        }
        yy += rowH;
      }
      tex.needsUpdate = true;
    }
  }

  // ===========================================================================
  // HUD billboard — a canvas plane hovering over the board centre that always
  // faces the camera and states the current guidance, using the original's
  // phrasing mapped into the in-world HUD. Also forwarded to ctx.onHud if present.
  // ===========================================================================
  function buildHud() {
    const canCreate = typeof document !== "undefined" && document.createElement;
    const cv = canCreate ? document.createElement("canvas") : null;
    if (cv) { cv.width = 512; cv.height = 192; }
    const tex = cv ? new THREE.CanvasTexture(cv) : null;
    if (tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const mat = tex
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
      : new THREE.MeshBasicMaterial({ color: "#0c2036", transparent: true, opacity: 0.85, depthWrite: false });
    const w = GRID_SPAN * 1.15;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.375), mat);
    mesh.position.set(0, SURF_Y + GRID_SPAN * 0.62, 0);
    mesh.renderOrder = 30;
    mesh.userData.cv = cv;
    mesh.userData.tex = tex;
    group.add(mesh);
    hudMesh = mesh;
    refreshHud();
  }

  // Guidance text for the current phase/turn — mapped from the original strings.
  function hudLines() {
    if (!mySide) {
      if (phase === "over") return { title: "Battle over", sub: winner ? `${cap(winner)} fleet victorious` : "", color: "#9fd3ff" };
      if (phase === "placement") return { title: "Battleship · Naval Warfare", sub: "Players deploying fleets…", color: "#9fd3ff" };
      const firer = currentFirer();
      return { title: "Battleship (spectating)", sub: firer ? `${cap(firer)} to fire` : "", color: "#9fd3ff" };
    }
    const sideName = cap(mySide);
    if (phase === "over") {
      const won = winner === mySide;
      return {
        title: won ? "VICTORY — enemy fleet sunk!" : "DEFEAT — your fleet is sunk",
        sub: won ? "Enemy fleet sent to the depths." : "Your fleet was lost at sea.",
        color: won ? "#7fffb0" : "#ff9a8a",
      };
    }
    if (phase === "placement") {
      if (ready[mySide]) {
        const oppReady = ready[oppSide];
        return { title: "Fleet ready", sub: oppReady ? "Both fleets deployed…" : "Waiting for opponent to deploy their fleet…", color: "#dfe9f2" };
      }
      const remaining = FLEET.length - myPlacements.length;
      if (remaining === 0) {
        return { title: "All ships placed — ready when you are!", sub: "Tap Ready ▸ to deploy.", color: "#bfe0ff" };
      }
      const spec = currentSpec();
      const sub = spec
        ? `Place ${spec.name} (${spec.length}). Click your waters · Rotate: ${ghostOrient}.`
        : "All ships placed. Click Ready ▸.";
      return {
        title: `Place your fleet — ${remaining} ship${remaining === 1 ? "" : "s"} left`,
        sub,
        color: "#bfe0ff",
      };
    }
    // playing
    const mine = sunkBy[mySide].size, theirs = sunkBy[oppSide].size;
    const counts = `Enemy sunk ${mine}/${FLEET.length} · yours lost ${theirs}/${FLEET.length}`;
    if (myTurnNow()) {
      return { title: "YOUR TURN — fire!", sub: `Pick a target on enemy waters. ${counts}`, color: "#7fd1ff" };
    }
    return { title: "Incoming fire — brace!", sub: `Waiting for opponent… ${counts}`, color: "#dfe9f2" };
  }

  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function refreshHud() {
    const { title, sub, color } = hudLines();
    if (hudHook) { try { hudHook(sub ? `${title} — ${sub}` : title); } catch { /* ignore */ } }
    const mesh = hudMesh;
    const cv = mesh && mesh.userData.cv;
    const tex = mesh && mesh.userData.tex;
    if (!cv || !tex) return;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = "rgba(8,18,30,0.86)";
    roundRect(g, 6, 6, cv.width - 12, cv.height - 12, 22);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = color;
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.font = "bold 46px sans-serif";
    g.fillText(clip(title, 28), cv.width / 2, 68);
    if (sub) {
      g.fillStyle = "#dfe9f2";
      g.font = "24px sans-serif";
      g.fillText(clip(sub, 56), cv.width / 2, 128);
    }
    tex.needsUpdate = true;
  }

  function clip(s, n) { return s && s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ===========================================================================
  // Animation loop (internal rAF; idles to zero when nothing moves except the
  // HUD billboard, which we keep tracking the camera).
  // ===========================================================================
  const shells = [];
  const blooms = [];
  const sparks = []; // short-lived particle bits (splash geyser / explosion)
  let rafId = null;
  let lastT = 0;
  let idleT = 0;
  let waterT = 0;
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const raf = (fn) => (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(fn) : setTimeout(() => fn(nowMs()), 16));
  const caf = (id) => (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(id) : clearTimeout(id));
  const easeOut = (x) => 1 - (1 - x) * (1 - x);

  function startLoop() {
    if (rafId != null) return;
    lastT = nowMs();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
      lastT = t;
      stepAnim(dt);
      rafId = raf(tick); // HUD billboard always needs tracking; cheap when idle
    };
    rafId = raf(tick);
  }

  const _UP = new THREE.Vector3(0, 1, 0);
  const _vel = new THREE.Vector3();
  const _q = new THREE.Quaternion();

  function stepAnim(dt) {
    // Scroll the procedural water normal map so the dark teal inlays shimmer.
    waterT += dt;
    for (const m of [M.oceanInlay, M.enemyInlay]) {
      if (m && m.normalMap) {
        m.normalMap.offset.x = waterT * 0.012;
        m.normalMap.offset.y = waterT * 0.018;
      }
    }
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const px = s.from.x + (s.to.x - s.from.x) * k;
      const pz = s.from.z + (s.to.z - s.from.z) * k;
      const py = s.baseY + Math.sin(k * Math.PI) * s.arc;
      s.mesh.position.set(px, py, pz);
      // Orient nose (+Y of the rocket group) along the velocity vector.
      _vel.set(s.to.x - s.from.x, s.arc * Math.PI * Math.cos(k * Math.PI), s.to.z - s.from.z);
      if (_vel.lengthSq() > 1e-9) {
        _vel.normalize();
        _q.setFromUnitVectors(_UP, _vel);
        s.mesh.quaternion.copy(_q);
      }
      // Exhaust puff trail.
      s.trailT = (s.trailT || 0) + dt;
      if (s.trailT > 0.03) { s.trailT = 0; spawnTrail(px, py, pz); }
      if (k >= 1) {
        group.remove(s.mesh);
        s.mesh.traverse((c) => { if (c.geometry && c.geometry !== G.peg) c.geometry.dispose?.(); });
        shells.splice(i, 1);
        if (s.onLand) s.onLand();
      }
    }
    for (let i = blooms.length - 1; i >= 0; i--) {
      const b = blooms[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      const sc = 0.4 + easeOut(k) * b.grow;
      b.mesh.scale.setScalar(sc);
      b.mesh.material.opacity = (1 - k) * b.peak;
      if (k >= 1) {
        group.remove(b.mesh);
        b.mesh.material.dispose?.();
        b.mesh.geometry.dispose?.();
        blooms.splice(i, 1);
      }
    }
    // Cheap CPU particle bits: ballistic, fade out, settle on the sea.
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.t += dt;
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < SURF_Y) { p.mesh.position.y = SURF_Y; p.vy = 0; p.vx *= 0.6; p.vz *= 0.6; }
      const k = Math.min(1, p.t / p.dur);
      p.mesh.material.opacity = (1 - k) * p.peak;
      if (k >= 1) {
        group.remove(p.mesh);
        p.mesh.material.dispose?.();
        sparks.splice(i, 1);
      }
    }
    if (targetRings.length > 0 || (reticle && reticle.visible)) {
      idleT += dt;
      const bob = Math.sin(idleT * 3.2) * CELL * 0.06;
      for (const t of targetRings) {
        t.position.y = t.userData.baseY + bob;
        t.rotation.z = idleT * 1.6;
        t.material.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(idleT * 4));
      }
      if (reticle && reticle.visible) {
        reticle.rotation.z = idleT * 1.6;
        const s = 1 + Math.sin(idleT * 5) * 0.08;
        reticle.scale.setScalar(s);
      }
    }
    // Billboard the HUD toward the camera (counter the group's own Y rotation so
    // the text stays upright + readable from any seat).
    if (hudMesh) hudMesh.rotation.y = -group.rotation.y;
  }

  // A small ballistic missile (rocket) group, nose along +Y — scaled port of the
  // original missile.ts (body + red nose + fins + emissive flame).
  function buildMissile() {
    const g = new THREE.Group();
    const u = CELL * 0.18; // unit scale for the toy rocket
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * u, 0.42 * u, 3 * u, 10), M.shell);
    g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42 * u, 1.1 * u, 10), M.shellNose);
    nose.position.y = 2.05 * u;
    g.add(nose);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12 * u, 1.0 * u, 0.7 * u), M.black);
      fin.position.set(Math.cos(a) * 0.5 * u, -1.2 * u, Math.sin(a) * 0.5 * u);
      fin.rotation.y = -a;
      g.add(fin);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36 * u, 1.8 * u, 8), M.shellFlame);
    flame.position.y = -2.2 * u;
    flame.rotation.x = Math.PI;
    g.add(flame);
    g.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    return g;
  }

  function launchShell(targetX, targetY, which, fromZEdge, onLand) {
    const tx = cellX(targetX);
    const tz = cellZ(targetY, which);
    const shell = buildMissile();
    const dist = Math.abs(tz - fromZEdge);
    shells.push({
      mesh: shell,
      from: { x: tx, z: fromZEdge },
      to: { x: tx, z: tz },
      baseY: SURF_Y + CELL * 0.2,
      arc: Math.max(CELL * 1.6, dist * 0.5),
      t: 0,
      dur: 0.5,
      trailT: 0,
      onLand,
    });
    group.add(shell);
    startLoop();
  }

  // One short-lived additive particle bit.
  function spawnParticle(x, y, z, vx, vy, vz, color, size, dur, gravity, peak) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: peak, depthWrite: false });
    const mesh = new THREE.Mesh(G.bit, mat);
    mesh.scale.setScalar(size);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 5;
    group.add(mesh);
    sparks.push({ mesh, vx, vy, vz, gravity, t: 0, dur, peak });
  }

  function spawnTrail(x, y, z) {
    spawnParticle(x, y, z, (Math.random() - 0.5) * CELL, Math.random() * CELL * 0.4, (Math.random() - 0.5) * CELL, "#cfcfcf", 0.9, 0.35, CELL * 0.6, 0.5);
  }

  // Impact FX — geyser (miss) or fireball + sparks (hit/sunk). A persistent
  // marker/peg is added separately by placeMarker.
  function spawnBloom(x, z, outcome) {
    const isHit = outcome === "hit" || outcome === "sunk";
    // central flash ring/ember (the scaling bloom).
    const geo = isHit ? G.emberPeg.clone() : G.ring.clone();
    const mesh = new THREE.Mesh(geo, (isHit ? M.ember : M.splash).clone());
    if (!isHit) mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, SURF_Y + CELL * 0.18, z);
    mesh.renderOrder = 4;
    group.add(mesh);
    blooms.push({ mesh, t: 0, dur: isHit ? 0.6 : 0.5, grow: isHit ? 2.6 : 2.0, peak: isHit ? 0.95 : 0.9 });

    const y0 = SURF_Y + CELL * 0.1;
    if (isHit) {
      // fireball + sparks: white-hot core, orange body, flying sparks.
      const big = outcome === "sunk";
      const n = big ? 22 : 14;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = CELL * (1 + Math.random() * 2.4);
        const col = Math.random() < 0.4 ? "#fff1d0" : Math.random() < 0.6 ? "#ff7b1a" : "#ff3b12";
        spawnParticle(x, y0, z, Math.cos(ang) * spd, CELL * (1.4 + Math.random() * 2.6), Math.sin(ang) * spd, col, 0.7 + Math.random() * 0.8, 0.4 + Math.random() * 0.5, CELL * 1.4, 0.95);
      }
    } else {
      // tall near-white geyser + foam ring.
      for (let i = 0; i < 14; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = CELL * (0.4 + Math.random() * 1.4);
        spawnParticle(x, y0, z, Math.cos(ang) * spd, CELL * (2 + Math.random() * 3), Math.sin(ang) * spd, "#eef6ff", 0.6 + Math.random() * 0.7, 0.5 + Math.random() * 0.4, CELL * 2.4, 0.9);
      }
    }
    startLoop();
  }

  // ===========================================================================
  // Markers — persistent pegs encoding the public shot grids.
  // ===========================================================================
  function placeMarker(x, y, outcome, which, mapStore) {
    const key = x + "," + y;
    if (mapStore.has(key)) return; // idempotent
    let mesh;
    if (outcome === "miss") {
      // flat white splash disc on the water (original CircleGeometry).
      mesh = new THREE.Mesh(G.missDisc, M.miss);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cellX(x), SURF_Y + 0.0012, cellZ(y, which));
    } else {
      // red glowing peg standing on the surface (original CylinderGeometry).
      mesh = new THREE.Mesh(G.peg, outcome === "sunk" ? M.sunkMark : M.hit);
      mesh.position.set(cellX(x), SURF_Y + CELL * 0.12, cellZ(y, which));
      mesh.castShadow = true;
    }
    group.add(mesh);
    mapStore.set(key, mesh);
  }

  function clearMarkers() {
    for (const m of oceanShotMarks.values()) group.remove(m);
    for (const m of enemyShotMarks.values()) group.remove(m);
    oceanShotMarks.clear();
    enemyShotMarks.clear();
  }

  // ===========================================================================
  // Hull rendering — MY ships only, on MY (near) ocean. Local-only; never wired.
  // ===========================================================================
  // Build a class-specific warship: pointed-bow extruded hull in its jewel-tone
  // paint, plus a small superstructure / turrets / funnels / island matching the
  // original warship.ts silhouettes (scaled to the café table). Ship runs along
  // local +X, centred. Sits ON the water at y≈0.
  function buildHull(ship) {
    const spec = SHIP_BY_ID.get(ship.id);
    const len = spec.length;
    const paint = SHIP_PAINT[ship.id];
    const g = new THREE.Group();
    const hullMat = hullMatFor(ship.id);
    const deckMat = deckMatFor(ship.id);

    const L = len * CELL * 0.84; // hull length (original length*CELL*0.84)
    const w = CELL * paint.beam; // beam
    const H = HULL_H * (paint.height / 4.2); // height scaled off battleship ref
    const deckY = H * 0.62;

    const box = (ww, hh, dd, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, dd), mat || M.superstructure);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    if (ship.id === "submarine") {
      // teardrop body via a stretched, low cylinder + sail.
      const body = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.5, L, 14), hullMat);
      body.rotation.z = Math.PI / 2;
      body.position.y = H * 0.32;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      // tapered bow/stern caps
      const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.5, L * 0.18, 14), hullMat);
      cap.rotation.z = -Math.PI / 2;
      cap.position.set(L * 0.55, H * 0.32, 0);
      g.add(cap);
      box(L * 0.22, H * 0.5, w * 0.5, L * 0.06, H * 0.32 + H * 0.4, 0, hullMat); // sail
      const peri = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.05, w * 0.05, H * 0.5, 6), M.black);
      peri.position.set(L * 0.06, H * 0.32 + H * 0.75, 0);
      g.add(peri);
    } else {
      // Pointed-bow hull from an extruded plan shape.
      const bow = L / 2 - L * 0.22;
      const stern = w * 0.46;
      const shape = new THREE.Shape();
      shape.moveTo(-L / 2, -stern);
      shape.lineTo(bow, -w / 2);
      shape.quadraticCurveTo(L / 2, -w * 0.18, L / 2, 0);
      shape.quadraticCurveTo(L / 2, w * 0.18, bow, w / 2);
      shape.lineTo(-L / 2, stern);
      shape.lineTo(-L / 2, -stern);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: true, bevelThickness: H * 0.12, bevelSize: w * 0.06, bevelSegments: 1, steps: 1 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0, 0);
      const hull = new THREE.Mesh(geo, hullMat);
      hull.castShadow = true;
      hull.receiveShadow = true;
      g.add(hull);

      if (ship.id === "carrier") {
        // flat flight deck slab + starboard island.
        box(L * 0.92, H * 0.12, w * 1.5, 0, deckY + H * 0.1, 0, deckMat);
        box(L * 0.14, H * 0.9, w * 0.5, -L * 0.04, deckY + H * 0.55, w * 0.5, M.superstructure); // island
        box(L * 0.06, H * 0.4, w * 0.4, -L * 0.04, deckY + H * 1.1, w * 0.5, M.glass); // bridge
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.04, w * 0.04, H * 0.8, 6), M.black);
        mast.position.set(-L * 0.04, deckY + H * 1.5, w * 0.5);
        g.add(mast);
      } else if (ship.id === "battleship") {
        box(L * 0.5, H * 0.18, w * 0.9, 0, deckY + H * 0.05, 0, deckMat);
        // superfiring main turrets fore + aft.
        const turret = (x) => {
          box(w * 0.9, H * 0.3, w * 0.8, x, deckY + H * 0.25, 0, M.superstructure);
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.06, w * 0.06, L * 0.18, 6), M.black);
          barrel.rotation.z = Math.PI / 2;
          barrel.position.set(x + L * 0.1, deckY + H * 0.3, 0);
          g.add(barrel);
        };
        turret(L * 0.3);
        turret(-L * 0.32);
        box(L * 0.16, H * 0.9, w * 0.7, 0, deckY + H * 0.55, 0, M.superstructure); // tower
        box(L * 0.08, H * 0.4, w * 0.45, 0, deckY + H * 1.1, 0, M.glass);
        const funnel = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.16, w * 0.2, H * 0.7, 12), M.superstructure);
        funnel.position.set(-L * 0.12, deckY + H * 0.5, 0);
        g.add(funnel);
      } else if (ship.id === "cruiser") {
        box(L * 0.5, H * 0.16, w * 0.9, 0, deckY + H * 0.05, 0, deckMat);
        box(w * 0.8, H * 0.28, w * 0.7, L * 0.34, deckY + H * 0.22, 0, M.superstructure); // fwd gun
        box(L * 0.2, H * 0.8, w * 0.65, L * 0.02, deckY + H * 0.5, 0, M.superstructure); // bridge block
        box(L * 0.1, H * 0.35, w * 0.4, L * 0.05, deckY + H * 1.0, 0, M.glass);
        const funnel = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.13, w * 0.17, H * 0.6, 10), M.superstructure);
        funnel.position.set(-L * 0.08, deckY + H * 0.45, 0);
        g.add(funnel);
      } else {
        // destroyer
        box(L * 0.55, H * 0.16, w * 0.85, 0, deckY + H * 0.05, 0, deckMat);
        box(w * 0.7, H * 0.26, w * 0.6, L * 0.34, deckY + H * 0.2, 0, M.superstructure); // fwd gun
        box(L * 0.22, H * 0.75, w * 0.6, L * 0.04, deckY + H * 0.45, 0, M.superstructure); // bridge
        box(L * 0.08, H * 0.3, w * 0.4, L * 0.08, deckY + H * 0.95, 0, M.glass);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.04, w * 0.06, H * 0.8, 6), M.black);
        mast.position.set(-L * 0.02, deckY + H * 0.9, 0);
        g.add(mast);
      }
    }

    const cells = shipCells(ship);
    const a = cells[0];
    const b = cells[cells.length - 1];
    const cx = (cellX(a.x) + cellX(b.x)) / 2;
    const cz = (cellZ(a.y, "ocean") + cellZ(b.y, "ocean")) / 2;
    g.position.set(cx, SURF_Y + 0.0005, cz);
    if (ship.orientation === "vertical") g.rotation.y = Math.PI / 2;
    g.userData.shipId = ship.id;
    return g;
  }

  function rebuildHulls() {
    for (const h of hullMeshes) {
      h.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
      group.remove(h);
    }
    hullMeshes.length = 0;
    if (!mySide) return; // only the seated owner renders their own fleet hulls
    for (const ship of myPlacements) {
      const h = buildHull(ship);
      group.add(h);
      hullMeshes.push(h);
    }
  }

  // ===========================================================================
  // Placement ghost + interaction
  // ===========================================================================
  function clearGhost() {
    if (ghostMesh) {
      ghostMesh.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
      group.remove(ghostMesh);
      ghostMesh = null;
    }
  }

  function currentSpec() {
    return placeIndex < FLEET.length ? FLEET[placeIndex] : null;
  }

  function refreshGhost() {
    clearGhost();
    if (phase !== "placement" || !mySide || ready[mySide]) return;
    const spec = currentSpec();
    if (!spec || !hoverCell) return;
    const ship = { id: spec.id, name: spec.name, length: spec.length, x: hoverCell.x, y: hoverCell.y, orientation: ghostOrient };
    const ok = canPlace(myPlacements, ship);
    const cells = shipCells(ship).filter((c) => inGrid(c.x, c.y));
    if (cells.length === 0) return;
    const g = new THREE.Group();
    const mat = ok ? M.ghostOk : M.ghostBad;
    for (const cell of cells) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.8, HULL_H * 0.7, CELL * 0.8), mat);
      block.position.set(cellX(cell.x), HULL_Y, cellZ(cell.y, "ocean"));
      g.add(block);
    }
    group.add(g);
    ghostMesh = g;
  }

  function tryPlaceAt(x, y) {
    const spec = currentSpec();
    if (!spec) return false;
    const ship = { id: spec.id, name: spec.name, length: spec.length, x, y, orientation: ghostOrient };
    if (!canPlace(myPlacements, ship)) return false;
    myPlacements.push(ship);
    placeIndex = myPlacements.length;
    rebuildHulls();
    refreshGhost();
    refreshButtons();
    refreshHud();
    return true;
  }

  function doRandomize() {
    const fleet = randomFleet();
    if (!fleet) return;
    myPlacements = fleet;
    placeIndex = FLEET.length;
    rebuildHulls();
    refreshGhost();
    refreshButtons();
    refreshHud();
  }

  function doAutoRemaining() {
    for (let i = placeIndex; i < FLEET.length; i++) {
      const spec = FLEET[i];
      let placed = false;
      for (let attempt = 0; attempt < 1000 && !placed; attempt++) {
        const orientation = Math.random() < 0.5 ? "horizontal" : "vertical";
        const maxX = orientation === "horizontal" ? GRID - spec.length : GRID - 1;
        const maxY = orientation === "vertical" ? GRID - spec.length : GRID - 1;
        const x = Math.floor(Math.random() * (maxX + 1));
        const y = Math.floor(Math.random() * (maxY + 1));
        const ship = { id: spec.id, name: spec.name, length: spec.length, x, y, orientation };
        if (canPlace(myPlacements, ship)) { myPlacements.push(ship); placed = true; }
      }
    }
    placeIndex = myPlacements.length;
    rebuildHulls();
    refreshGhost();
    refreshButtons();
    refreshHud();
  }

  function doClear() {
    myPlacements = [];
    placeIndex = 0;
    rebuildHulls();
    refreshGhost();
    refreshButtons();
    refreshHud();
  }

  function doReady() {
    if (!isComplete(myPlacements) || !mySide) return;
    myOcean = freshOceanState();
    myOcean.occ = occupancyOf(myPlacements);
    ready[mySide] = true;
    clearGhost();
    refreshButtons();
    refreshHud();
    try { ctx.net.sendMove({ type: "place", ready: true }); } catch { /* transport optional */ }
    maybeStart();
    pushSnapshot();
  }

  function maybeStart() {
    if (phase !== "placement") return;
    if (!ready.host || !ready.guest) return;
    if (role !== "host") return; // only the host decides + broadcasts the start
    first = Math.random() < 0.5 ? "host" : "guest";
    phase = "playing";
    myTurn = first === "host";
    try { ctx.net.sendMove({ type: "start", first }); } catch { /* transport optional */ }
    refreshEnemyLive();
    refreshHud();
    pushSnapshot();
  }

  // ===========================================================================
  // Firing — single shot, strictly alternating. Lock input the instant we fire.
  // ===========================================================================
  function canFireAt(x, y) {
    if (phase !== "playing" || !mySide) return false;
    if (!myTurn || pendingFire) return false;
    if (!ctx.isLocalTurnAllowed()) return false;
    if (!inGrid(x, y)) return false;
    if (tracking[mySide].has(x + "," + y)) return false;
    return true;
  }

  function fireAt(x, y) {
    if (!canFireAt(x, y)) return;
    pendingFire = { x, y };
    myTurn = false;
    clearReticle();
    refreshEnemyLive();
    refreshHud();
    const fromZ = ENEMY_CZ - GRID_SPAN / 2 - CELL * 0.8; // launch from the near edge of enemy waters
    launchShell(x, y, "enemy", fromZ, null);
    try { ctx.net.sendMove({ type: "fire", x, y }); } catch { /* transport optional */ }
  }

  function resolveMyResult(x, y, outcome, sunkId) {
    const key = x + "," + y;
    tracking[mySide].set(key, { outcome, sunk: sunkId });
    shots[mySide].push({ x, y, outcome, sunk: sunkId });
    placeMarker(x, y, outcome, "enemy", enemyShotMarks);
    spawnBloom(cellX(x), cellZ(y, "enemy"), outcome);
    if (outcome === "sunk" && sunkId) sunkBy[mySide].add(sunkId);
    pendingFire = null;
    refreshPanels();
    if (sunkBy[mySide].size === FLEET.length) {
      endGame(mySide, "fleet-sunk");
      sendReveal();
      return;
    }
    if (role === "host") pushSnapshot();
    refreshHud();
    // Turn passes to the opponent; it returns to me only after their incoming
    // {fire} lands (receiveIncomingFire sets myTurn=true).
  }

  function receiveIncomingFire(x, y) {
    if (phase !== "playing") return;
    const res = receiveFire(myOcean, x, y);
    if (!res) return; // out of bounds / duplicate — ignore, don't desync
    shots[oppSide].push({ x, y, outcome: res.outcome, sunk: res.sunk });
    tracking[oppSide].set(x + "," + y, { outcome: res.outcome, sunk: res.sunk });
    placeMarker(x, y, res.outcome, "ocean", oceanShotMarks);
    spawnBloom(cellX(x), cellZ(y, "ocean"), res.outcome);
    if (res.outcome === "sunk" && res.sunk) sunkBy[oppSide].add(res.sunk);
    refreshPanels();

    const reply = { type: "result", x, y, outcome: res.outcome };
    if (res.outcome === "sunk") reply.sunk = res.sunk;
    try { ctx.net.sendMove(reply); } catch { /* transport optional */ }

    if (res.allSunk) {
      endGame(oppSide, "fleet-sunk");
      sendReveal();
      return;
    }
    myTurn = true;
    refreshEnemyLive();
    if (role === "host") pushSnapshot();
    refreshHud();
  }

  // ===========================================================================
  // Aim affordances. On my turn:
  //   (1) PRIMARY: a bobbing TARGET RING sits on every un-fired enemy cell — an
  //       always-visible, framework-independent "these cells are pickable" cue.
  //       Already-fired cells have a peg + no ring, so the board reads its own
  //       firing history.
  //   (2) AIM RETICLE: a crosshair the player slides over enemy waters. board.js
  //       forwards the hovered COLUMN to setHover(); we light that whole column
  //       as a targeting lane and snap a crosshair onto the most-recently aimed
  //       cell (full {r,c} when available, else the column's nearest un-fired
  //       cell). This degrades gracefully to a column lane when only a column is
  //       known, so the aim cue works regardless of how the framework hovers.
  // ===========================================================================
  function myTurnNow() {
    return phase === "playing" && !!mySide && myTurn && !pendingFire && ctx.isLocalTurnAllowed();
  }

  function refreshEnemyLive() {
    // Clear old rings + lane.
    for (const t of targetRings) { group.remove(t); t.material.dispose?.(); }
    targetRings.length = 0;
    if (laneMesh) { group.remove(laneMesh); laneMesh.geometry.dispose?.(); laneMesh = null; }
    if (enemyLivePlate) { group.remove(enemyLivePlate); enemyLivePlate.geometry.dispose?.(); enemyLivePlate = null; }
    if (!myTurnNow()) { clearReticle(); return; }

    // Faint live tint over the whole enemy grid (this grid is now active).
    enemyLivePlate = new THREE.Mesh(new THREE.BoxGeometry(GRID_SPAN + CELL * 0.2, 0.001, GRID_SPAN + CELL * 0.2), M.enemyLive);
    enemyLivePlate.position.set(0, SURF_Y + 0.0015, ENEMY_CZ);
    enemyLivePlate.renderOrder = 1;
    group.add(enemyLivePlate);

    // A bobbing target ring on every un-fired enemy cell.
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (tracking[mySide].has(x + "," + y)) continue;
        const ring = new THREE.Mesh(G.ring, M.target.clone());
        ring.rotation.x = Math.PI / 2;
        const baseY = SURF_Y + CELL * 0.13;
        ring.position.set(cellX(x), baseY, cellZ(y, "enemy"));
        ring.userData.baseY = baseY;
        ring.renderOrder = 3;
        group.add(ring);
        targetRings.push(ring);
      }
    }
    updateReticle();
    startLoop();
  }

  function ensureReticle() {
    if (reticle) return reticle;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(G.ring.clone(), M.reticleOk.clone());
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    // crosshair lines
    const barGeo = new THREE.BoxGeometry(CELL * 0.74, 0.0015, CELL * 0.06);
    const barGeo2 = new THREE.BoxGeometry(CELL * 0.06, 0.0015, CELL * 0.74);
    const h = new THREE.Mesh(barGeo, M.reticleOk.clone());
    const v = new THREE.Mesh(barGeo2, M.reticleOk.clone());
    g.add(h); g.add(v);
    g.userData.parts = [ring, h, v];
    g.renderOrder = 5;
    g.visible = false;
    group.add(g);
    reticle = g;
    return g;
  }

  // Snap the crosshair onto the aimed cell. If only a column is known (aimRow<0),
  // pick that column's nearest un-fired cell and also light the column as a lane.
  function updateReticle() {
    // refresh the column lane.
    if (laneMesh) { group.remove(laneMesh); laneMesh.geometry.dispose?.(); laneMesh = null; }
    if (!myTurnNow() || aimCol < 0 || aimCol >= GRID) { clearReticle(); return; }

    let row = aimRow;
    if (row < 0 || row >= GRID) row = nearestUnfiredRow(aimCol);

    // Column lane highlight (full enemy column under the pointer).
    laneMesh = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.94, 0.0016, GRID_SPAN), M.enemyLive.clone());
    laneMesh.material.opacity = 0.28;
    laneMesh.position.set(cellX(aimCol), SURF_Y + 0.002, ENEMY_CZ);
    laneMesh.renderOrder = 2;
    group.add(laneMesh);

    if (row < 0 || row >= GRID) { clearReticle(); return; }
    const r = ensureReticle();
    const fired = tracking[mySide].has(aimCol + "," + row);
    const mat = fired ? M.reticleBad : M.reticleOk;
    for (const p of r.userData.parts) p.material = mat;
    r.position.set(cellX(aimCol), SURF_Y + CELL * 0.16, cellZ(row, "enemy"));
    r.visible = true;
    startLoop();
  }

  function nearestUnfiredRow(col) {
    for (let y = 0; y < GRID; y++) if (!tracking[mySide].has(col + "," + y)) return y;
    return -1;
  }

  function clearReticle() {
    if (reticle) reticle.visible = false;
    if (laneMesh) { group.remove(laneMesh); laneMesh.geometry.dispose?.(); laneMesh = null; }
  }

  // ===========================================================================
  // onPointer — the framework dispatches { cell, point, object }.
  //   placement: click YOUR (near) ocean to place/rotate; click a labelled pillar.
  //   playing  : click ENEMY (far) waters to fire (your turn, un-fired cell).
  // ===========================================================================
  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed()) return; // spectators + game-over: inert

    const btn = buttonFromHit(hit);
    if (btn && phase === "placement" && mySide && !ready[mySide]) {
      if (btn === "rotate") { ghostOrient = ghostOrient === "horizontal" ? "vertical" : "horizontal"; refreshGhost(); refreshHud(); }
      else if (btn === "random") doRandomize();
      else if (btn === "clear") doClear();
      else if (btn === "ready") { if (isComplete(myPlacements)) doReady(); else doAutoRemaining(); }
      return;
    }

    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.r) || !Number.isInteger(cell.c)) return;
    const x = cell.c, y = cell.r;
    if (!inGrid(x, y)) return;

    if (phase === "placement") {
      if (!mySide || ready[mySide]) return;
      if (cell.which !== "ocean") return; // only your ocean is placeable
      if (hoverCell && hoverCell.x === x && hoverCell.y === y && ghostMesh) {
        if (!tryPlaceAt(x, y)) {
          ghostOrient = ghostOrient === "horizontal" ? "vertical" : "horizontal";
          refreshGhost();
          refreshHud();
        }
      } else {
        hoverCell = { x, y };
        if (!tryPlaceAt(x, y)) { refreshGhost(); refreshHud(); }
      }
      return;
    }

    if (phase === "playing") {
      if (cell.which !== "enemy") return; // only fire on enemy waters
      fireAt(x, y);
    }
  }

  // ── Hover routing — board.js forwards the hovered COLUMN via setHover(cell.c)
  // (a number), or a full {r,c,which} cell if a richer host provides it, or -1 on
  // a miss. We handle BOTH: a number drives the column lane + crosshair (snapped
  // to that column's nearest un-fired cell); a full cell additionally pins the
  // exact row + discriminates the enemy grid. During placement a full ocean cell
  // updates the ghost preview. Always defensive — never assumes the object form.
  function setHover(arg) {
    if (arg == null || arg === -1) {
      aimCol = aimRow = -1;
      clearReticle();
      return;
    }
    const cell = (typeof arg === "object" && arg) ? arg : null;
    const which = cell ? cell.which : null;
    const col = cell ? (Number.isInteger(cell.c) ? cell.c : -1) : (Number.isInteger(arg) ? arg : -1);
    const row = cell && Number.isInteger(cell.r) ? cell.r : -1;

    // Placement: a full ocean cell drives the ghost preview.
    if (phase === "placement") {
      if (mySide && !ready[mySide] && which === "ocean" && col >= 0 && row >= 0) {
        if (!hoverCell || hoverCell.x !== col || hoverCell.y !== row) {
          hoverCell = { x: col, y: row };
          refreshGhost();
          refreshHud();
        }
      }
      return;
    }

    // Playing: drive the aim lane + crosshair on enemy waters. A bare column
    // (no `which`) is treated as an enemy-grid hover (the only live grid on my
    // turn); a full ocean cell is ignored.
    if (phase === "playing" && mySide) {
      if (which === "ocean") { aimCol = aimRow = -1; clearReticle(); return; }
      aimCol = col;
      aimRow = row;
      updateReticle();
    }
  }

  function buttonFromHit(hit) {
    let o = hit && hit.object;
    while (o && o !== group) {
      if (o.userData && o.userData.btn) return o.userData.btn;
      o = o.parent;
    }
    return null;
  }

  // ===========================================================================
  // applyMove — apply ONE relayed message. Throws GameDesync on a structural
  // mismatch (the contract's resync signal).
  // ===========================================================================
  function applyMove(move, byRole) {
    if (!move || typeof move !== "object") return false;
    switch (move.type) {
      case "place": {
        const them = byRole === "host" ? "host" : byRole === "guest" ? "guest" : oppSide;
        if (them) ready[them] = true;
        refreshButtons();
        refreshHud();
        maybeStart();
        pushSnapshot();
        return true;
      }
      case "start": {
        if (move.first !== "host" && move.first !== "guest") throw new GameDesync("battleship: bad start.first");
        first = move.first;
        phase = "playing";
        ready.host = true;
        ready.guest = true;
        if (mySide) myTurn = first === mySide;
        refreshButtons();
        refreshEnemyLive();
        refreshHud();
        pushSnapshot();
        return true;
      }
      case "fire": {
        if (phase !== "playing") throw new GameDesync("battleship: fire before play");
        if (!mySide) return true; // spectators never receive raw fires (server-gated)
        const fromZ = OCEAN_CZ + GRID_SPAN / 2 + CELL * 0.8; // incoming arc from the far edge of MY ocean
        launchShell(move.x, move.y, "ocean", fromZ, () => receiveIncomingFire(move.x, move.y));
        return true;
      }
      case "result": {
        if (!validResult(move)) throw new GameDesync("battleship: invalid result");
        if (!mySide) return true;
        if (!pendingFire || pendingFire.x !== move.x || pendingFire.y !== move.y) {
          return false; // result for a shot we aren't waiting on — request resync
        }
        resolveMyResult(move.x, move.y, move.outcome, move.outcome === "sunk" ? move.sunk : null);
        return true;
      }
      case "reveal": {
        validLayout(move.layout); // verified-or-not; harmless either way
        return true;
      }
      default:
        return false;
    }
  }

  // ===========================================================================
  // applyState — render an AUTHORITATIVE PUBLIC snapshot. Idempotent. Contains
  // ONLY the public shot grids + statuses — NEVER any ship placement. NEVER
  // recomputes the local role/colour (no side-flip). state === null ⇒ fresh game.
  // ===========================================================================
  function applyState(state) {
    for (const s of shells) group.remove(s.mesh);
    for (const b of blooms) { group.remove(b.mesh); b.mesh.material?.dispose?.(); b.mesh.geometry?.dispose?.(); }
    for (const p of sparks) { group.remove(p.mesh); p.mesh.material?.dispose?.(); }
    shells.length = 0;
    blooms.length = 0;
    sparks.length = 0;
    clearReticle();
    for (const t of targetRings) { group.remove(t); t.material.dispose?.(); }
    targetRings.length = 0;
    if (enemyLivePlate) { group.remove(enemyLivePlate); enemyLivePlate.geometry.dispose?.(); enemyLivePlate = null; }
    clearMarkers();

    if (!state) {
      phase = "placement";
      first = null;
      winner = null;
      myTurn = false;
      pendingFire = null;
      ready.host = false;
      ready.guest = false;
      shots.host = [];
      shots.guest = [];
      tracking.host.clear();
      tracking.guest.clear();
      sunkBy.host.clear();
      sunkBy.guest.clear();
      myPlacements = [];
      placeIndex = 0;
      hoverCell = null;
      aimCol = aimRow = -1;
      myOcean = freshOceanState();
      rebuildHulls();
      refreshPanels();
      refreshButtons();
      refreshGhost();
      refreshEnemyLive();
      refreshHud();
      return;
    }

    phase = state.phase === "playing" ? "playing" : state.phase === "over" ? "over" : "placement";
    first = state.first === "host" || state.first === "guest" ? state.first : null;
    winner = state.winner === "host" || state.winner === "guest" ? state.winner : null;
    ready.host = !!(state.ready && state.ready.host);
    ready.guest = !!(state.ready && state.ready.guest);

    for (const side of ["host", "guest"]) {
      shots[side] = [];
      tracking[side].clear();
      sunkBy[side].clear();
    }

    const srcShots = state.shots || {};
    for (const side of ["host", "guest"]) {
      const list = Array.isArray(srcShots[side]) ? srcShots[side] : [];
      for (const s of list) {
        if (!inGrid(s.x, s.y)) continue;
        const outcome = s.outcome === "hit" || s.outcome === "sunk" ? s.outcome : "miss";
        const sunkId = outcome === "sunk" && SHIP_IDS.has(s.sunk) ? s.sunk : null;
        shots[side].push({ x: s.x, y: s.y, outcome, sunk: sunkId });
        tracking[side].set(s.x + "," + s.y, { outcome, sunk: sunkId });
        if (sunkId) sunkBy[side].add(sunkId);
        // From MY seat: my shots → enemy grid; opponent's → my ocean.
        if (mySide) {
          if (side === mySide) placeMarker(s.x, s.y, outcome, "enemy", enemyShotMarks);
          else placeMarker(s.x, s.y, outcome, "ocean", oceanShotMarks);
        } else {
          // Spectator (canonical frame): host's shots on the enemy grid, guest's
          // on the ocean grid — a fixed, layout-free view of both shot streams.
          placeMarker(s.x, s.y, outcome, side === "host" ? "enemy" : "ocean", side === "host" ? enemyShotMarks : oceanShotMarks);
        }
      }
    }

    if (state.sunk) {
      for (const side of ["host", "guest"]) {
        const ids = Array.isArray(state.sunk[side]) ? state.sunk[side] : [];
        for (const id of ids) if (SHIP_IDS.has(id)) sunkBy[side].add(id);
      }
    }

    if (mySide && phase === "playing") {
      const mine = shots[mySide].length;
      const theirs = shots[oppSide].length;
      myTurn = first === mySide ? mine <= theirs : mine < theirs;
      pendingFire = null;
    } else {
      myTurn = false;
    }

    rebuildHulls();
    refreshPanels();
    refreshButtons();
    refreshGhost();
    refreshEnemyLive();
    refreshHud();
  }

  // ===========================================================================
  // Snapshots — PUBLIC-ONLY. NEVER a ship placement.
  // ===========================================================================
  function snapshot() {
    return {
      phase,
      first,
      winner,
      turn: phase === "playing" ? currentFirer() : null,
      ready: { host: ready.host, guest: ready.guest },
      shots: {
        host: shots.host.map((s) => ({ x: s.x, y: s.y, outcome: s.outcome, ...(s.sunk ? { sunk: s.sunk } : {}) })),
        guest: shots.guest.map((s) => ({ x: s.x, y: s.y, outcome: s.outcome, ...(s.sunk ? { sunk: s.sunk } : {}) })),
      },
      sunk: { host: [...sunkBy.host], guest: [...sunkBy.guest] },
    };
  }

  function currentFirer() {
    if (!first) return null;
    const h = shots.host.length;
    const g = shots.guest.length;
    if (first === "host") return h <= g ? "host" : "guest";
    return g <= h ? "guest" : "host";
  }

  function publicState() { return snapshot(); }

  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* transport optional / non-host */ }
  }

  // ===========================================================================
  // Game over + end-of-game reveal
  // ===========================================================================
  function endGame(winnerSide, reason) {
    if (phase === "over") return;
    phase = "over";
    winner = winnerSide;
    myTurn = false;
    pendingFire = null;
    clearReticle();
    if (enemyLivePlate) { group.remove(enemyLivePlate); enemyLivePlate.geometry.dispose?.(); enemyLivePlate = null; }
    refreshButtons();
    refreshPanels();
    refreshHud();
    try { ctx.onGameOver({ winner: winnerSide, reason: reason || "fleet-sunk" }); } catch { /* ignore */ }
    if (role === "host") pushSnapshot();
  }

  function sendReveal() {
    if (!mySide || myPlacements.length !== FLEET.length) return;
    const layout = myPlacements.map((s) => ({ id: s.id, x: s.x, y: s.y, orientation: s.orientation }));
    try { ctx.net.sendMove({ type: "reveal", layout }); } catch { /* transport optional */ }
  }

  // ===========================================================================
  // Role / seat changes — switch in place. applyState NEVER recomputes role; only
  // setRole does, and a promoted player re-enters placement locally (empty ocean).
  // ===========================================================================
  function setRole(newRole, newSeatIndex) {
    const prev = mySide;
    role = newRole || "spectator";
    if (newSeatIndex !== undefined) ctx.seatIndex = newSeatIndex;
    mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
    oppSide = mySide === "host" ? "guest" : mySide === "guest" ? "host" : null;
    if (mySide !== prev) {
      if (!prev && mySide) {
        phase = phase === "over" ? "over" : "placement";
        myPlacements = [];
        placeIndex = 0;
        hoverCell = null;
        aimCol = aimRow = -1;
        myOcean = freshOceanState();
      }
    }
    applyFacing();
    rebuildHulls();
    refreshButtons();
    refreshPanels();
    refreshGhost();
    refreshEnemyLive();
    refreshHud();
  }

  function setSeatRy(ry) {
    seatRy = ry;
    applyFacing();
    refreshEnemyLive();
    refreshGhost();
    refreshHud();
  }

  // ===========================================================================
  // dispose — stop the loop, free GPU resources, drop the group.
  // ===========================================================================
  function dispose() {
    if (rafId != null) { caf(rafId); rafId = null; }
    for (const b of blooms) { b.mesh.material?.dispose?.(); b.mesh.geometry?.dispose?.(); }
    shells.length = 0;
    blooms.length = 0;
    if (enemyLivePlate) { group.remove(enemyLivePlate); enemyLivePlate.geometry.dispose?.(); enemyLivePlate = null; }
    if (laneMesh) { group.remove(laneMesh); laneMesh.geometry.dispose?.(); laneMesh = null; }
    for (const t of targetRings) { group.remove(t); t.material.dispose?.(); }
    targetRings.length = 0;
    if (reticle) {
      reticle.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); if (c.material) c.material.dispose?.(); });
      group.remove(reticle);
      reticle = null;
    }
    clearGhost();
    clearMarkers();
    for (const h of hullMeshes) {
      h.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
    }
    hullMeshes.length = 0;
    for (const b of placeButtons) {
      b.mesh.traverse((c) => {
        if (c.geometry) c.geometry.dispose?.();
        if (c.material && c.material !== M.pillarGo && c.material !== M.pillarDim && c.material !== M.pillarIdle) c.material.dispose?.();
        if (c.userData && c.userData.tex) c.userData.tex.dispose?.();
      });
    }
    placeButtons.length = 0;
    for (const p of panels) {
      group.remove(p.pivot || p.mesh);
      p.mesh.geometry?.dispose?.();
      p.tex?.dispose?.();
      p.mesh.material?.dispose?.();
    }
    panels.length = 0;
    if (hudMesh) {
      group.remove(hudMesh);
      hudMesh.geometry?.dispose?.();
      hudMesh.userData?.tex?.dispose?.();
      hudMesh.material?.dispose?.();
      hudMesh = null;
    }
    for (const p of sparks) { group.remove(p.mesh); p.mesh.material?.dispose?.(); }
    sparks.length = 0;
    if (group.parent) group.parent.remove(group);
    for (const g of Object.values(G)) g && g.dispose?.();
    // Per-instance cloned water normal maps (the shared cache maps stay alive).
    for (const m of [M.oceanInlay, M.enemyInlay]) m && m.normalMap && m.normalMap.dispose?.();
    for (const m of Object.values(M)) m && m.dispose?.();
    // Per-class hull materials + their cloned rough/metal maps.
    for (const mat of hullMatCache.values()) {
      if (mat.roughnessMap) mat.roughnessMap.dispose?.();
      mat.dispose?.();
    }
    hullMatCache.clear();
  }

  // Initial paint.
  rebuildHulls();
  refreshButtons();
  refreshPanels();
  refreshGhost();
  refreshEnemyLive();
  refreshHud();
  startLoop(); // keep the HUD billboard tracking the camera

  return {
    group,
    orientPolicy: "self", // we rotate the group ourselves so each seat sees its OWN ocean near
    applyState,
    applyMove,
    onPointer,
    setHover, // hover crosshair reticle over enemy waters + ghost preview during placement
    publicState,
    setRole,
    setSeatRy,
    dispose,
    // Convenience for the framework/tests (not part of the required surface).
    isOurTurn: () => myTurnNow(),
  };
}

export default createGame;
