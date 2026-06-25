// Shared piece-kit helpers for in-world game modules. Framework-agnostic: every
// function takes a THREE instance (ctx.THREE — never a second copy) so raycast /
// matrix ops stay consistent across the boundary. Geometry is sized off a cell
// `step` (metres), never furniture-scale. Modules own disposal of what they mint.

import { BOARD_SIZE, BOARD_HALF, cellX as canonX, cellZ as canonZ } from "./createGame.js";

export { BOARD_SIZE, BOARD_HALF };

// Palette tokens extracted from the 2D games so 3D pieces read as the same game.
export const PALETTE = {
  frame: "#4a311c",
  darkSq: "#7a4a25",
  lightSq: "#e8d2ab",
  gold: "#e0a23a",
  // checkers
  red: "#c4452f",
  black: "#2a2320",
  // reversi
  felt: "#1f7a4d",
  feltEdge: "#134d31",
  discBlack: "#15201b",
  discWhite: "#f6fbf7",
  // gomoku
  woodBoard: "#d9a86a",
  woodEdge: "#a9763f",
  stoneBlack: "#1a1a1a",
  stoneWhite: "#fbfbfb",
  // mancala
  mancalaWood: "#8a5a2b",
  mancalaEdge: "#5e3c1a",
  seed: "#e8e0cf",
  // ludo
  ludo: { red: "#d65a4a", green: "#4caf6a", yellow: "#e3b34a", blue: "#4a85d6" },
  ludoDark: { red: "#9c2f23", green: "#2f7a47", yellow: "#a87c1e", blue: "#2c5a9c" },
  // pong / tron
  pongLeft: "#d65a4a",
  pongRight: "#4a85d6",
  tron0: "#22d3ee",
  tron1: "#fb923c",
  accent: "#ffd166",
};

export function meshOf(THREE, geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

export function standard(THREE, color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.08,
    emissive: opts.emissive ?? "#000000",
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? true,
  });
}

// A gently domed turned-disc profile (checkers chip / go stone). `flat` makes a
// flatter go-stone; radius and thickness in metres.
export function discGeometry(THREE, r, t, flat = false) {
  const h = t / 2;
  const top = flat ? h * 0.7 : h;
  const pts = [
    new THREE.Vector2(0.0, -h),
    new THREE.Vector2(r * 0.92, -h),
    new THREE.Vector2(r * 1.0, -h * 0.35),
    new THREE.Vector2(r * 1.0, top * 0.35),
    new THREE.Vector2(r * 0.9, top),
    new THREE.Vector2(r * 0.5, top * 1.05),
    new THREE.Vector2(0.0, top * 1.07),
  ];
  return new THREE.LatheGeometry(pts, 28);
}

// Canonical N×N cell-centre → local XZ (re-exported convenience).
export function cellX(c, n) {
  return canonX(c, n);
}
export function cellZ(r, n) {
  return canonZ(r, n);
}

// Build a solid plank + proud frame + N×N inlaid tiles in the canonical frame.
// Returns { add(group), tileTop, dispose } so modules share the board base.
export function buildGridBoard(THREE, group, opts) {
  const n = opts.n;
  const size = opts.size ?? BOARD_SIZE;
  const half = size / 2;
  const step = size / n;
  const plankH = opts.plankH ?? 0.022;
  const frameW = opts.frameW ?? 0.03;
  const frameH = opts.frameH ?? 0.012;
  const tileT = opts.tileT ?? 0.004;
  const isDark = opts.isDark || (() => false);
  const darkMat = opts.darkMat;
  const lightMat = opts.lightMat;
  const frameMat = opts.frameMat;
  const plankMat = opts.plankMat;

  const owned = [];
  const keep = (x) => {
    owned.push(x);
    return x;
  };

  const outer = size + frameW * 2;
  const plankGeo = keep(new THREE.BoxGeometry(outer, plankH, outer));
  const plank = meshOf(THREE, plankGeo, plankMat);
  plank.position.y = plankH / 2;
  group.add(plank);

  const frameY = plankH + frameH / 2;
  const longGeo = keep(new THREE.BoxGeometry(outer, frameH, frameW));
  const sideGeo = keep(new THREE.BoxGeometry(frameW, frameH, outer - frameW * 2));
  const off = half + frameW / 2;
  for (const [geo, x, z] of [
    [longGeo, 0, -off],
    [longGeo, 0, off],
    [sideGeo, -off, 0],
    [sideGeo, off, 0],
  ]) {
    const rail = meshOf(THREE, geo, frameMat);
    rail.position.set(x, frameY, z);
    group.add(rail);
  }

  const tileTop = plankH + tileT;
  const tileGeo = keep(new THREE.BoxGeometry(step * 0.94, tileT, step * 0.94));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const tile = meshOf(THREE, tileGeo, isDark(r, c) ? darkMat : lightMat, false);
      tile.position.set(canonX(c, n), plankH + tileT / 2, canonZ(r, n));
      tile.receiveShadow = true;
      group.add(tile);
    }
  }

  // Invisible per-cell colliders tagged userData.cell so empty cells are clickable.
  const hitGeo = keep(new THREE.BoxGeometry(step * 0.98, 0.03, step * 0.98));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (opts.collideAll === false && !isDark(r, c)) continue;
      const box = new THREE.Mesh(hitGeo, invis);
      box.position.set(canonX(c, n), tileTop + 0.015, canonZ(r, n));
      box.userData.cell = { r, c };
      group.add(box);
    }
  }

  return {
    tileTop,
    step,
    half,
    dispose() {
      for (const o of owned) o.dispose?.();
    },
  };
}
