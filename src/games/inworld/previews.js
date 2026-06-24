// Tiny game DIORAMAS for the flip-book menu pages. Each `buildGamePreview(THREE,
// gameId)` returns a small (~0.18 m) THREE.Object3D — a charming, low-poly mini
// model of the game, centred on the origin so the menu can spin it freely.
//
// These are NOT the playable boards (those live in each game's createGame module,
// sized in metres off the café table). They are pure decoration: a single shared
// material cache, simple primitives, low triangle counts. THREE is passed in by
// the caller (never a second copy) so matrices stay consistent. Disposal: these
// are menu props with shared geometry/material pools that live for the menu's
// lifetime; the caller can `traverse` + dispose if it wants, but we keep the
// pools small and reused so it's cheap to just drop them.
//
// House style matches src/world/props.js and src/games/inworld/pieces.js:
// flat-ish MeshStandard, warm wood frames, the same per-game palette tokens.

import { PALETTE } from "./pieces.js";

// Target overall footprint (metres). Each builder lays out in a ~[-0.5, 0.5]
// unit box, then we scale the whole group to fit this and re-centre vertically.
const TARGET = 0.18;

// ── Shared material cache ────────────────────────────────────────────────────
// One MeshStandardMaterial per colour, reused across every diorama. Keyed by a
// colour+finish signature so wood/felt/metal variants are distinct but pooled.
function makeMatPool(THREE) {
  const cache = new Map();
  return function mat(color, opts = {}) {
    const key = `${color}|${opts.rough ?? 0.6}|${opts.metal ?? 0.05}|${opts.emi ?? ""}|${opts.emiI ?? 0}|${opts.flat ? 1 : 0}|${opts.opacity ?? 1}`;
    let m = cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: opts.rough ?? 0.6,
        metalness: opts.metal ?? 0.05,
        emissive: opts.emi ?? "#000000",
        emissiveIntensity: opts.emiI ?? 1,
        flatShading: !!opts.flat,
        transparent: (opts.opacity ?? 1) < 1,
        opacity: opts.opacity ?? 1,
      });
      cache.set(key, m);
    }
    return m;
  };
}

// ── Tiny geometry helpers (operate in the ~unit-box build space) ─────────────
function box(THREE, mat, w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function cyl(THREE, mat, rt, rb, h, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function sph(THREE, mat, r, seg = 10) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function at(obj, x, y, z) {
  obj.position.set(x, y, z);
  return obj;
}

// A flat wood board base (plank + slim frame) centred at origin, top at y=th.
// Returns the group; tiles/pieces stack on top of `th`.
function boardBase(THREE, mat, side, th = 0.05, frameCol, plankCol) {
  const g = new THREE.Group();
  const fw = side * 0.06;
  const outer = side + fw;
  const plank = at(box(THREE, mat(plankCol), outer, th, outer), 0, th / 2, 0);
  g.add(plank);
  const frameH = th * 1.4;
  const fy = frameH / 2;
  const long = new THREE.BoxGeometry(outer, frameH, fw);
  const sideG = new THREE.BoxGeometry(fw, frameH, outer - fw * 2);
  const off = side / 2 + fw / 2 - fw / 2;
  for (const [geo, x, z] of [
    [long, 0, -off],
    [long, 0, off],
    [sideG, -off, 0],
    [sideG, off, 0],
  ]) {
    const rail = new THREE.Mesh(geo, mat(frameCol));
    rail.castShadow = rail.receiveShadow = true;
    g.add(at(rail, x, fy, z));
  }
  g.userData.top = th;
  return g;
}

// Checkerboard tiles laid on top of a board at height `top`.
function checkerTiles(THREE, mat, parent, n, side, top, darkCol, lightCol, isDark) {
  const step = side / n;
  const tileGeo = new THREE.BoxGeometry(step * 0.92, 0.012, step * 0.92);
  const dark = mat(darkCol);
  const light = mat(lightCol);
  // Tiles clearly OVERLAY the plank top: bottom at top+0.004, top at top+0.016, so
  // no large face is coplanar with the plank (avoids grazing-angle z-fighting).
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const t = new THREE.Mesh(tileGeo, (isDark || ((rr, cc) => (rr + cc) % 2 === 1))(r, c) ? dark : light);
      t.receiveShadow = true;
      const x = (c - (n - 1) / 2) * step;
      const z = (r - (n - 1) / 2) * step;
      parent.add(at(t, x, top + 0.01, z));
    }
  }
  return step;
}

// ── Per-game dioramas ────────────────────────────────────────────────────────
// Each returns a THREE.Group built in the ~unit box (side ≈ 0.7).

function diorChess(THREE, mat) {
  const g = new THREE.Group();
  const side = 0.62;
  const base = boardBase(THREE, mat, side, 0.05, PALETTE.frame, PALETTE.darkSq);
  g.add(base);
  const step = checkerTiles(THREE, mat, g, 8, side, base.userData.top, PALETTE.darkSq, PALETTE.lightSq);
  // A couple of turned piece silhouettes (pawn + a taller king) per side.
  const white = mat(PALETTE.lightSq, { rough: 0.45 });
  const black = mat(PALETTE.black, { rough: 0.4 });
  const top = base.userData.top;
  const pawn = (m, x, z) => {
    const p = new THREE.Group();
    p.add(at(cyl(THREE, m, step * 0.16, step * 0.26, step * 0.16, 14), 0, step * 0.08, 0));
    p.add(at(sph(THREE, m, step * 0.18, 12), 0, step * 0.3, 0));
    return at(p, x, top, z);
  };
  const king = (m, x, z) => {
    const p = new THREE.Group();
    p.add(at(cyl(THREE, m, step * 0.18, step * 0.28, step * 0.5, 14), 0, step * 0.25, 0));
    p.add(at(sph(THREE, m, step * 0.16, 12), 0, step * 0.56, 0));
    p.add(at(box(THREE, m, step * 0.08, step * 0.18, step * 0.08), 0, step * 0.74, 0));
    p.add(at(box(THREE, m, step * 0.22, step * 0.07, step * 0.07), 0, step * 0.74, 0));
    return at(p, x, top, z);
  };
  g.add(pawn(white, -step * 1.0, step * 2.6));
  g.add(king(white, step * 0.6, step * 2.2));
  g.add(pawn(black, step * 1.1, -step * 2.6));
  g.add(king(black, -step * 0.5, -step * 2.2));
  return g;
}

function diorCheckers(THREE, mat) {
  const g = new THREE.Group();
  const side = 0.62;
  const base = boardBase(THREE, mat, side, 0.05, PALETTE.frame, PALETTE.darkSq);
  g.add(base);
  const step = checkerTiles(THREE, mat, g, 8, side, base.userData.top, PALETTE.darkSq, PALETTE.lightSq);
  const top = base.userData.top;
  const red = mat(PALETTE.red, { rough: 0.5 });
  const black = mat(PALETTE.black, { rough: 0.4 });
  const chip = (m, c, r, stack = 1) => {
    const x = (c - 3.5) * step;
    const z = (r - 3.5) * step;
    for (let i = 0; i < stack; i++) {
      g.add(at(cyl(THREE, m, step * 0.32, step * 0.32, step * 0.12, 14), x, top + 0.06 + i * step * 0.13, z));
    }
  };
  chip(red, 1, 0); chip(red, 3, 2); chip(black, 4, 5, 2); chip(black, 6, 7); chip(red, 0, 1);
  return g;
}

function diorReversi(THREE, mat) {
  const g = new THREE.Group();
  const side = 0.6;
  const base = boardBase(THREE, mat, side, 0.05, PALETTE.feltEdge, PALETTE.felt);
  g.add(base);
  const top = base.userData.top;
  // green felt face — clearly overlays the plank top (bottom at top+0.004) so the
  // two large coplanar faces don't shimmer at grazing angles.
  g.add(at(box(THREE, mat(PALETTE.felt), side, 0.014, side), 0, top + 0.011, 0));
  const step = side / 8;
  const disc = (m, c, r) =>
    g.add(at(cyl(THREE, m, step * 0.36, step * 0.36, step * 0.12, 16), (c - 3.5) * step, top + 0.06, (r - 3.5) * step));
  const black = mat(PALETTE.discBlack, { rough: 0.4 });
  const white = mat(PALETTE.discWhite, { rough: 0.45 });
  // centre four + a couple flanking
  disc(white, 3, 3); disc(black, 4, 3); disc(black, 3, 4); disc(white, 4, 4);
  disc(black, 2, 3); disc(white, 5, 4);
  return g;
}

function diorGomoku(THREE, mat) {
  const g = new THREE.Group();
  const side = 0.6;
  const base = boardBase(THREE, mat, side, 0.05, PALETTE.woodEdge, PALETTE.woodBoard);
  g.add(base);
  const top = base.userData.top;
  // grid lines (thin dark strips) — a sparse 7-line lattice reads as a go board
  const lineMat = mat(PALETTE.woodEdge, { rough: 0.7 });
  const n = 7;
  const gstep = (side * 0.82) / (n - 1);
  const span = side * 0.82;
  // grid lines lifted clear of the plank top (bottom at top+0.006) so they overlay
  // rather than fight the wood face.
  for (let i = 0; i < n; i++) {
    const p = -span / 2 + i * gstep;
    g.add(at(box(THREE, lineMat, span, 0.004, 0.006), 0, top + 0.008, p));
    g.add(at(box(THREE, lineMat, 0.006, 0.004, span), p, top + 0.008, 0));
  }
  const black = mat(PALETTE.stoneBlack, { rough: 0.4 });
  const white = mat(PALETTE.stoneWhite, { rough: 0.45 });
  const stone = (m, ci, ri) =>
    g.add(at(cyl(THREE, m, gstep * 0.3, gstep * 0.3, gstep * 0.16, 16),
      -span / 2 + ci * gstep, top + 0.025, -span / 2 + ri * gstep));
  // a little diagonal black run plus a couple of white stones crowding it
  stone(black, 2, 2); stone(black, 3, 3); stone(black, 4, 4);
  stone(white, 3, 2); stone(white, 2, 4); stone(white, 5, 3);
  return g;
}

function diorConnect4(THREE, mat) {
  const g = new THREE.Group();
  // Upright blue grid slab with drilled sockets + a few chips inside. Built upright,
  // then tilted slightly forward (about X) so the face reads while the page spins
  // about Y, matching the readable "standing board" look.
  const slabG = new THREE.Group();
  const w = 0.56, h = 0.42, d = 0.07;
  const footH = 0.05;
  const slab = mat("#1f4ea8", { rough: 0.5 });
  // Slab sits ON the foot (bottom at footH) so the two solids don't interpenetrate.
  slabG.add(at(box(THREE, slab, w, h, d), 0, footH + h / 2, 0));
  const cols = 5, rows = 4;
  const cw = w / (cols + 0.5);
  const ch = h / (rows + 0.6);
  const r = Math.min(cw, ch) * 0.36;
  const hole = mat("#0a1426", { rough: 0.8 });
  const red = mat(PALETTE.red, { rough: 0.5 });
  const yellow = mat(PALETTE.accent, { rough: 0.5 });
  const filled = { "0_3": red, "0_2": yellow, "1_3": yellow, "2_3": red, "2_2": red, "4_3": yellow };
  for (let c = 0; c < cols; c++) {
    for (let rr = 0; rr < rows; rr++) {
      const x = (c - (cols - 1) / 2) * cw;
      const y = footH + ch * 0.8 + rr * ch;
      const key = `${c}_${rr}`;
      const m = filled[key] || hole;
      // discs poke proud of BOTH faces so they don't z-fight the slab face.
      const disc = cyl(THREE, m, r, r, d * 1.05, 16);
      disc.rotation.x = Math.PI / 2;
      slabG.add(at(disc, x, y, 0));
    }
  }
  // foot bar (bottom at y=0)
  const foot = mat("#16387a", { rough: 0.6 });
  slabG.add(at(box(THREE, foot, w * 0.9, footH, d * 2.4), 0, footH / 2, 0));
  // Tilt forward; pivot near the foot so the base stays at/above y=0.
  slabG.rotation.x = -0.22;
  g.add(slabG);
  return g;
}

function diorDots(THREE, mat) {
  const g = new THREE.Group();
  const side = 0.58;
  const base = boardBase(THREE, mat, side, 0.045, PALETTE.frame, PALETTE.lightSq);
  g.add(base);
  const top = base.userData.top;
  const n = 4; // dot grid
  const span = side * 0.78;
  const dstep = span / (n - 1);
  const dot = mat(PALETTE.frame, { rough: 0.5 });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      g.add(at(cyl(THREE, dot, 0.02, 0.02, 0.03, 12), -span / 2 + c * dstep, top + 0.025, -span / 2 + r * dstep));
    }
  }
  // Layered clear of the plank: claimed fill lowest, drawn edges above it, dots on top.
  const edgeR = mat(PALETTE.red, { rough: 0.5 });
  const edgeB = mat(PALETTE.pongRight, { rough: 0.5 });
  const hEdge = (c, r, m) =>
    g.add(at(box(THREE, m, dstep * 0.9, 0.018, 0.02), -span / 2 + (c + 0.5) * dstep, top + 0.02, -span / 2 + r * dstep));
  const vEdge = (c, r, m) =>
    g.add(at(box(THREE, m, 0.02, 0.018, dstep * 0.9), -span / 2 + c * dstep, top + 0.02, -span / 2 + (r + 0.5) * dstep));
  hEdge(0, 0, edgeR); hEdge(0, 1, edgeR); vEdge(0, 0, edgeR); vEdge(1, 0, edgeR);
  // claimed-box fill (overlays the plank, sits below the drawn edges)
  g.add(at(box(THREE, mat(PALETTE.red, { rough: 0.7, opacity: 0.6 }), dstep * 0.7, 0.01, dstep * 0.7),
    -span / 2 + dstep * 0.5, top + 0.009, -span / 2 + dstep * 0.5));
  hEdge(1, 2, edgeB); vEdge(2, 1, edgeB);
  return g;
}

function diorUttt(THREE, mat) {
  const g = new THREE.Group();
  const side = 0.6;
  const base = boardBase(THREE, mat, side, 0.045, PALETTE.frame, PALETTE.lightSq);
  g.add(base);
  const top = base.userData.top;
  const span = side * 0.9;
  // thick lines splitting into 3×3 of 3×3 (draw the 2 main + 2 sub dividers)
  const main = mat(PALETTE.frame, { rough: 0.6 });
  const sub = mat(PALETTE.darkSq, { rough: 0.6 });
  // Sub dividers sit just above the plank; main dividers a clear layer higher so the
  // two lattices never share a face.
  for (let i = 1; i < 9; i++) {
    if (i % 3 === 0) continue;
    const p = -span / 2 + (i / 9) * span;
    g.add(at(box(THREE, sub, span, 0.006, 0.008), 0, top + 0.007, p));
    g.add(at(box(THREE, sub, 0.008, 0.006, span), p, top + 0.007, 0));
  }
  for (let i = 1; i < 3; i++) {
    const p = -span / 2 + (i / 3) * span;
    g.add(at(box(THREE, main, span, 0.01, 0.016), 0, top + 0.016, p));
    g.add(at(box(THREE, main, 0.016, 0.01, span), p, top + 0.016, 0));
  }
  // a few X / O marks
  const cell = span / 9;
  const xMat = mat(PALETTE.red, { rough: 0.5 });
  const oMat = mat(PALETTE.pongRight, { rough: 0.5 });
  const cx = (ci) => -span / 2 + (ci + 0.5) * cell;
  const drawX = (ci, ri) => {
    const x = cx(ci), z = cx(ri);
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const b = box(THREE, xMat, cell * 0.7, 0.02, cell * 0.16);
      b.rotation.y = rot;
      g.add(at(b, x, top + 0.02, z));
    }
  };
  const drawO = (ci, ri) => {
    const o = new THREE.Mesh(new THREE.TorusGeometry(cell * 0.3, cell * 0.08, 6, 16), oMat);
    o.rotation.x = Math.PI / 2;
    g.add(at(o, cx(ci), top + 0.02, cx(ri)));
  };
  drawX(1, 1); drawX(4, 4); drawO(7, 1); drawO(2, 6); drawX(6, 6);
  return g;
}

function diorMancala(THREE, mat) {
  const g = new THREE.Group();
  // Long carved wood board: two rows of pits + a big store at each end.
  const w = 0.66, d = 0.28, h = 0.08;
  const body = mat(PALETTE.mancalaWood, { rough: 0.65 });
  const edge = mat(PALETTE.mancalaEdge, { rough: 0.7 });
  g.add(at(box(THREE, body, w, h, d), 0, h / 2, 0));
  // pits (recessed dark cylinders) — 6 per row
  const pit = mat(PALETTE.mancalaEdge, { rough: 0.8 });
  const seed = mat(PALETTE.seed, { rough: 0.6 });
  const cols = 6;
  const pstep = (w * 0.62) / cols;
  for (let r = 0; r < 2; r++) {
    const z = (r === 0 ? -1 : 1) * d * 0.22;
    for (let c = 0; c < cols; c++) {
      const x = -w * 0.31 + (c + 0.5) * pstep;
      g.add(at(cyl(THREE, pit, pstep * 0.4, pstep * 0.34, h * 0.6, 12), x, h * 0.72, z));
      // a couple of seed beads
      for (let s = 0; s < 2; s++)
        g.add(at(sph(THREE, seed, pstep * 0.12, 8), x + (s - 0.5) * pstep * 0.3, h * 0.95, z + (s - 0.5) * pstep * 0.2));
    }
  }
  // stores
  for (const sx of [-1, 1]) {
    g.add(at(cyl(THREE, pit, d * 0.18, d * 0.15, h * 0.6, 14), sx * w * 0.42, h * 0.72, 0));
  }
  // rim accents
  g.add(at(box(THREE, edge, w, h * 0.18, 0.012), 0, h * 0.95, d / 2 - 0.006));
  g.add(at(box(THREE, edge, w, h * 0.18, 0.012), 0, h * 0.95, -d / 2 + 0.006));
  return g;
}

function diorBattleship(THREE, mat) {
  const g = new THREE.Group();
  // Two tiny ocean grids side by side + one ship + a peg.
  const gs = 0.26, th = 0.04;
  const ocean = mat("#2f6f9c", { rough: 0.55 });
  const frame = mat(PALETTE.frame, { rough: 0.6 });
  const grid = mat("#1c4763", { rough: 0.6 });
  const buildGrid = (ox, pegs) => {
    const sub = new THREE.Group();
    sub.add(at(box(THREE, frame, gs * 1.12, th, gs * 1.12), 0, th / 2, 0));
    // ocean overlays the frame top (bottom at th+0.004); grid lines a clear layer above.
    sub.add(at(box(THREE, ocean, gs, 0.012, gs), 0, th + 0.01, 0));
    const n = 5, step = gs / n;
    for (let i = 1; i < n; i++) {
      const p = -gs / 2 + i * step;
      sub.add(at(box(THREE, grid, gs, 0.004, 0.005), 0, th + 0.02, p));
      sub.add(at(box(THREE, grid, 0.005, 0.004, gs), p, th + 0.02, 0));
    }
    for (const [c, r, hit] of pegs) {
      const m = mat(hit ? PALETTE.red : PALETTE.discWhite, { rough: 0.5 });
      sub.add(at(cyl(THREE, m, step * 0.16, step * 0.16, step * 0.5, 12),
        -gs / 2 + (c + 0.5) * step, th + 0.04, -gs / 2 + (r + 0.5) * step));
    }
    return at(sub, ox, 0, 0);
  };
  g.add(buildGrid(-gs * 0.72, [[1, 1, true], [3, 2, false]]));
  const right = buildGrid(gs * 0.72, [[0, 0, false], [2, 4, true]]);
  g.add(right);
  // a destroyer on the right grid
  const ship = mat(PALETTE.black, { rough: 0.4, metal: 0.3 });
  const hull = box(THREE, ship, gs * 0.16, th * 0.7, gs * 0.5);
  g.add(at(hull, gs * 0.72 + (-gs / 2 + 1.5 * (gs / 5)), th + 0.03, 0));
  g.add(at(box(THREE, ship, gs * 0.05, th * 0.8, gs * 0.05), gs * 0.72 + (-gs / 2 + 1.5 * (gs / 5)), th + 0.07, 0));
  return g;
}

function diorMemory(THREE, mat) {
  const g = new THREE.Group();
  // A few face-down café cards in a little fan + one flipped up.
  const cardBack = mat("#7a4a25", { rough: 0.5 });
  const cardFace = mat(PALETTE.lightSq, { rough: 0.5 });
  const accent = mat(PALETTE.gold, { rough: 0.4, emi: PALETTE.gold, emiI: 0.15 });
  const cw = 0.18, chh = 0.24, ct = 0.018;
  const place = (x, z, rotY, faceUp) => {
    const card = new THREE.Group();
    card.add(at(box(THREE, faceUp ? cardFace : cardBack, cw, ct, chh), 0, 0, 0));
    if (!faceUp) {
      // back pattern pip
      card.add(at(cyl(THREE, accent, cw * 0.18, cw * 0.18, ct * 0.6, 10), 0, ct * 0.6, 0));
    } else {
      // a little cup motif on the face
      card.add(at(cyl(THREE, mat(PALETTE.frame), cw * 0.18, cw * 0.16, ct * 0.6, 12), 0, ct * 0.6, 0));
    }
    card.rotation.y = rotY;
    return at(card, x, ct / 2 + 0.02, z);
  };
  // grid-ish layout of 6 cards, one face-up
  const xs = [-0.22, 0, 0.22];
  let i = 0;
  for (const zz of [-0.16, 0.16]) {
    for (const xx of xs) {
      g.add(place(xx, zz, (i % 3 - 1) * 0.08, i === 4));
      i++;
    }
  }
  return g;
}

function diorPong(THREE, mat) {
  const g = new THREE.Group();
  // Mini dark table, centre dashed line, two paddles, a ball.
  const w = 0.62, d = 0.4, th = 0.04;
  const table = mat("#101418", { rough: 0.4, emi: "#0a2030", emiI: 0.2 });
  const frame = mat("#2b2b2f", { rough: 0.4, metal: 0.6 });
  g.add(at(box(THREE, frame, w * 1.1, th, d * 1.15), 0, th / 2, 0));
  // playfield overlays the frame top (bottom at th+0.005); dashes a clear layer above.
  g.add(at(box(THREE, table, w, 0.012, d), 0, th + 0.011, 0));
  // dashed centre line
  const dash = mat(PALETTE.discWhite, { rough: 0.4, emi: "#445", emiI: 0.2 });
  for (let i = -2; i <= 2; i++) {
    g.add(at(box(THREE, dash, 0.012, 0.006, d * 0.12), 0, th + 0.022, i * d * 0.2));
  }
  const left = mat(PALETTE.pongLeft, { rough: 0.4, emi: PALETTE.pongLeft, emiI: 0.3 });
  const right = mat(PALETTE.pongRight, { rough: 0.4, emi: PALETTE.pongRight, emiI: 0.3 });
  g.add(at(box(THREE, left, 0.02, 0.05, d * 0.28), -w * 0.45, th + 0.03, -d * 0.05));
  g.add(at(box(THREE, right, 0.02, 0.05, d * 0.28), w * 0.45, th + 0.03, d * 0.08));
  const ball = mat(PALETTE.accent, { rough: 0.3, emi: PALETTE.accent, emiI: 0.5 });
  g.add(at(sph(THREE, ball, 0.022, 10), w * 0.05, th + 0.035, -d * 0.1));
  return g;
}

function diorTron(THREE, mat) {
  const g = new THREE.Group();
  // Glowing arena floor + low neon walls + two light trails + two cycles.
  const w = 0.6, d = 0.5, th = 0.03;
  const floor = mat("#06080d", { rough: 0.3, emi: "#06121c", emiI: 0.3 });
  g.add(at(box(THREE, floor, w, th, d), 0, th / 2, 0));
  // neon border walls
  const wallMat = mat(PALETTE.tron0, { rough: 0.3, emi: PALETTE.tron0, emiI: 0.5 });
  const wh = 0.03;
  // walls sit just above the floor face so their footprint doesn't fight the floor top.
  g.add(at(box(THREE, wallMat, w, wh, 0.01), 0, th + 0.004 + wh / 2, -d / 2));
  g.add(at(box(THREE, wallMat, w, wh, 0.01), 0, th + 0.004 + wh / 2, d / 2));
  g.add(at(box(THREE, wallMat, 0.01, wh, d), -w / 2, th + 0.004 + wh / 2, 0));
  g.add(at(box(THREE, wallMat, 0.01, wh, d), w / 2, th + 0.004 + wh / 2, 0));
  // two L-shaped trails
  const t0 = mat(PALETTE.tron0, { rough: 0.3, emi: PALETTE.tron0, emiI: 0.6 });
  const t1 = mat(PALETTE.tron1, { rough: 0.3, emi: PALETTE.tron1, emiI: 0.6 });
  const trail = (m, segs) => segs.forEach((s) => g.add(at(box(THREE, m, s[2], 0.022, s[3]), s[0], th + 0.018, s[1])));
  trail(t0, [[-w * 0.2, -d * 0.1, w * 0.35, 0.018], [-w * 0.03, d * 0.05, 0.018, d * 0.3]]);
  trail(t1, [[w * 0.2, d * 0.12, w * 0.35, 0.018], [w * 0.03, -d * 0.05, 0.018, d * 0.3]]);
  // two cycle nubs
  g.add(at(box(THREE, t0, 0.03, 0.03, 0.05), -w * 0.03, th + 0.025, d * 0.2));
  g.add(at(box(THREE, t1, 0.03, 0.03, 0.05), w * 0.03, th + 0.025, -d * 0.2));
  return g;
}

function diorLudo(THREE, mat) {
  const g = new THREE.Group();
  const side = 0.6, th = 0.045;
  const base = boardBase(THREE, mat, side, th, PALETTE.frame, PALETTE.lightSq);
  g.add(base);
  const top = base.userData.top;
  const arm = side / 3;
  // four coloured corner home bases (the cross leaves white centre + arms)
  const corners = [
    [-1, -1, PALETTE.ludo.red],
    [1, -1, PALETTE.ludo.green],
    [1, 1, PALETTE.ludo.yellow],
    [-1, 1, PALETTE.ludo.blue],
  ];
  // Coloured corners overlay the plank; the white cross sits a clear layer above the
  // corners so the large flat faces never coincide.
  for (const [sx, sz, col] of corners) {
    g.add(at(box(THREE, mat(col, { rough: 0.6 }), arm * 0.95, 0.012, arm * 0.95),
      sx * arm, top + 0.008, sz * arm));
  }
  // white cross arms
  const cross = mat(PALETTE.lightSq, { rough: 0.6 });
  g.add(at(box(THREE, cross, arm, 0.013, side * 0.99), 0, top + 0.018, 0));
  g.add(at(box(THREE, cross, side * 0.99, 0.013, arm), 0, top + 0.018, 0));
  // four tokens, one per colour, in their home corner
  const token = (col, sx, sz) => {
    const t = new THREE.Group();
    const m = mat(col, { rough: 0.5 });
    t.add(at(cyl(THREE, m, arm * 0.18, arm * 0.26, arm * 0.22, 12), 0, arm * 0.11, 0));
    t.add(at(sph(THREE, m, arm * 0.16, 10), 0, arm * 0.32, 0));
    return at(t, sx * arm, top, sz * arm);
  };
  g.add(token(PALETTE.ludo.red, -1, -1));
  g.add(token(PALETTE.ludo.green, 1, -1));
  g.add(token(PALETTE.ludo.yellow, 1, 1));
  g.add(token(PALETTE.ludo.blue, -1, 1));
  return g;
}

function diorFallback(THREE, mat) {
  // Generic "boardgame on a coaster": a wood disc + a die + two pawns.
  const g = new THREE.Group();
  const board = mat(PALETTE.woodBoard, { rough: 0.6 });
  const edge = mat(PALETTE.woodEdge, { rough: 0.7 });
  g.add(at(cyl(THREE, edge, 0.34, 0.36, 0.05, 24), 0, 0.025, 0));
  g.add(at(cyl(THREE, board, 0.3, 0.3, 0.02, 24), 0, 0.055, 0));
  // a die
  const die = mat(PALETTE.discWhite, { rough: 0.4 });
  g.add(at(box(THREE, die, 0.12, 0.12, 0.12), -0.08, 0.13, 0.06));
  const pip = mat(PALETTE.black, { rough: 0.4 });
  g.add(at(sph(THREE, pip, 0.016, 8), -0.08, 0.195, 0.06));
  // two pawns
  const pawn = (col, x, z) => {
    const m = mat(col, { rough: 0.5 });
    const p = new THREE.Group();
    p.add(at(cyl(THREE, m, 0.04, 0.06, 0.05, 10), 0, 0.025, 0));
    p.add(at(sph(THREE, m, 0.045, 10), 0, 0.085, 0));
    return at(p, x, 0.07, z);
  };
  g.add(pawn(PALETTE.red, 0.1, -0.05));
  g.add(pawn(PALETTE.pongRight, 0.14, 0.08));
  return g;
}

const BUILDERS = {
  chess: diorChess,
  checkers: diorCheckers,
  connect4: diorConnect4,
  reversi: diorReversi,
  gomoku: diorGomoku,
  dotsandboxes: diorDots,
  ultimatettt: diorUttt,
  mancala: diorMancala,
  battleship: diorBattleship,
  memory: diorMemory,
  pong: diorPong,
  tron: diorTron,
  ludo: diorLudo,
};

// ── Public API ───────────────────────────────────────────────────────────────
// buildGamePreview(THREE, gameId) → THREE.Object3D (~TARGET m), centred at origin.
export function buildGamePreview(THREE, gameId) {
  const mat = makeMatPool(THREE);
  const build = BUILDERS[gameId] || diorFallback;
  const inner = build(THREE, mat);

  // Normalise: measure the built group, scale to TARGET, re-centre on origin so
  // the menu can spin it about its middle.
  const bbox = new THREE.Box3().setFromObject(inner);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);
  // Normalise by the XZ FOOTPRINT (to match the menu's fitPreview, which scales by
  // maxXZ) with only a capped Y contribution, so tall pieces (chess king, upright
  // Connect-4 slab) don't shrink the whole board to a tiny on-page dot. This keeps
  // every board reading at a consistent footprint size and makes the menu's
  // fitPreview act as a near-identity (factor ≈ 1.0, as its own comment expects).
  const maxDim = Math.max(size.x, size.z, size.y * 0.6) || 1;
  const scale = TARGET / maxDim;

  // Re-centre inner around its own bbox centre, then scale at the wrapper.
  inner.position.sub(center);

  const wrap = new THREE.Group();
  wrap.add(inner);
  wrap.scale.setScalar(scale);
  wrap.userData.gameId = gameId;
  return wrap;
}

export default buildGamePreview;
