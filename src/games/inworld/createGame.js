// Shared spine for the in-world game framework.
//
// This module is imported by every game module AND by board.js (the host). It
// owns the small set of constants + pure helpers the framework and modules
// agree on: where the playable square sits on the café table, how a seat's ry
// maps to the board's rotation, and how a world-space raycast hit maps back to a
// canonical {r,c} cell. There is intentionally NO three.js import here — all
// geometry math runs on plain numbers / the THREE instance passed in by callers,
// so this file parses standalone (npm run check) and never mints a second THREE.

// Tabletop surface height (local Y of a board parented to a makeTable() Group).
// makeTable()'s top cylinder sits at y=0.74 with thickness 0.06 → top face 0.77.
export const TABLE_SURFACE_Y = 0.77;

// Edge of the inscribed playable square (metres). 0.7 fits inside the 0.55 m
// radius round tabletop with a small corner margin; every grid game maps its N×N
// cells across this.
export const BOARD_SIZE = 0.7;
export const BOARD_HALF = BOARD_SIZE / 2;

// Thrown by a module's applyMove() when a relayed delta can't be reconciled with
// local state. The framework catches it and requests an authoritative resync
// (host re-pushes its cached snapshot) instead of trusting a bad move.
export class GameDesync extends Error {
  constructor(msg) {
    super(msg || "game desync");
    this.name = "GameDesync";
  }
}

// Per-viewer board orientation. A seated player faces seat.ry toward the table
// centre; rotating the board group by that same ry puts the canonical near edge
// (row 0 at -Z) where the player physically sits. Snap to the nearest quarter
// turn so the four chairs (ry ∈ {0, PI, ±PI/2}) read cleanly. Spectators have no
// seat (ry == null) → fixed canonical orientation 0.
export function orientFor(seatRy) {
  if (seatRy == null || !Number.isFinite(seatRy)) return 0;
  const q = Math.PI / 2;
  return Math.round(seatRy / q) * q;
}

// Map a world-space hit point back to a canonical {r,c} on an N×N grid spanning
// the BOARD_SIZE square. group.worldToLocal() undoes BOTH the table transform AND
// the per-viewer group.rotation.y, so every seat resolves the SAME canonical
// cell. col → local X, row → local Z (row 0 at -Z). Returns null outside [0,1).
// NOTE: clones the point — worldToLocal mutates its argument.
export function hitToCell(group, worldPoint, n = 8) {
  const local = group.worldToLocal(worldPoint.clone());
  const u = (local.x + BOARD_HALF) / BOARD_SIZE;
  const v = (local.z + BOARD_HALF) / BOARD_SIZE;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  return { r: Math.floor(v * n), c: Math.floor(u * n) };
}

// Canonical cell centre → local XZ (inverse of hitToCell). Used by modules that
// want the shared mapping for piece placement.
export function cellCenter(r, c, n = 8) {
  const step = BOARD_SIZE / n;
  return { x: -BOARD_HALF + (c + 0.5) * step, z: -BOARD_HALF + (r + 0.5) * step };
}

export const cellX = (c, n = 8) => -BOARD_HALF + (c + 0.5) * (BOARD_SIZE / n);
export const cellZ = (r, n = 8) => -BOARD_HALF + (r + 0.5) * (BOARD_SIZE / n);
