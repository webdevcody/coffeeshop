// Chess (full FIDE rules, 8x8) — in-world 3D table game module.
//
// A COMPLETE, self-contained ES module implementing the createGame() contract
// documented in ./createGame.js. The framework (board.js -> InWorldBoard) owns
// the café table, the WebSocket relay, role/turn gating and spectator read-only
// mode; THIS module owns ONLY the rules, the 3D geometry (real meshes parented to
// the café table) and per-cell hit-testing.
//
// ---------------------------------------------------------------------------
// WHAT WAS BROKEN (and is fixed here):
//
//   1. CRASH ON MOUNT (the headline bug). createGame() ran its static scene
//      builders (buildBoard/buildColliders/buildIdentityCue/updateIdentityCue)
//      in the MIDDLE of the function — BEFORE the `let cueCanvas, cueTex,
//      cueMesh, homeRail` declarations further down. Because `let`/`const` are
//      hoisted but live in the Temporal Dead Zone until their line executes,
//      buildIdentityCue()'s `cueCanvas = document.createElement(...)` threw
//      "Cannot access 'cueCanvas' before initialization" — the mount crashed the
//      instant you clicked Play. FIX: ALL mutable instance state + cue/canvas
//      variables are now declared up front, and every builder runs only AFTER
//      that block. No TDZ access is possible.
//
//   2. WHITE/BLACK BOTH RENDERED DARK. The Poly-Pizza GLBs ship with no vertex
//      normals and a near-black baseColorFactor. Without normals a
//      MeshStandardMaterial has no light response → every face shades black
//      regardless of material colour. FIX: normalizeModel() computes vertex
//      normals when missing, strips any baked map, and makeModelPiece() REPLACES
//      every submesh material with our cloned ivory/charcoal material — so white
//      reads ivory and black reads charcoal, both clearly lit and distinct.
//
//   3. Hardened: every async GLB callback is wrapped; a failed/absent model
//      leaves procedural pieces in place so chess ALWAYS works; applyState never
//      recomputes the local role/colour from the wire; selection ring + legal
//      markers show only on the local player's turn; the local army renders on
//      the near edge via self-orientation.
//
// WIRE FORMAT:
//   move:  { type:"move", from:{r,c}, to:{r,c}, promo?:"q"|"r"|"b"|"n" }
//   state: { board:[8][8 of piece|null], turn, castling, ep, phase, winner }
//          where a piece is { color:"white"|"black", type:"p"|"n"|"b"|"r"|"q"|"k" }
//
// Coordinate convention matches createGame.js: col -> local X, row -> local Z,
// canonical row 0 at -Z. Black home rows 0/1, white home rows 6/7.

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GameDesync, BOARD_SIZE as FRAMEWORK_BOARD_SIZE, orientFor } from "./createGame.js";

// Attribution string the framework / UI may surface (CC BY requires it).
export const ATTRIBUTION = "Chess pieces by Jarlan Perez, CC BY 3.0, via Poly Pizza";

const MODEL_BASE = "/models/chess/";
const MODEL_FILES = {
  p: "pawn.glb",
  n: "knight.glb",
  b: "bishop.glb",
  r: "rook.glb",
  q: "queen.glb",
  k: "king.glb",
};

// ===========================================================================
// PURE RULES — fully self-contained, transport-free.
//   board[r][c] = null | { color:"white"|"black", type:"p"|"n"|"b"|"r"|"q"|"k" }
//   r=0 is the -Z edge (black home rows 0/1), r=7 the +Z edge (white home 6/7).
//   White pawns march toward row 0 (dr = -1), black toward row 7 (dr = +1).
// ===========================================================================
const N = 8;
export const other = (c) => (c === "white" ? "black" : "white");
const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const eqSq = (a, b) => !!a && !!b && a.r === b.r && a.c === b.c;
const PAWN_DIR = { white: -1, black: 1 };
const PROMO_ROW = { white: 0, black: 7 };
const HOME_PAWN_ROW = { white: 6, black: 1 };

export function initialBoard() {
  const b = Array.from({ length: N }, () => Array(N).fill(null));
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let c = 0; c < N; c++) {
    b[0][c] = { color: "black", type: back[c] };
    b[1][c] = { color: "black", type: "p" };
    b[6][c] = { color: "white", type: "p" };
    b[7][c] = { color: "white", type: back[c] };
  }
  return b;
}

export function cloneBoard(b) {
  return b.map((row) => row.map((cell) => (cell ? { color: cell.color, type: cell.type } : null)));
}

export function initialState() {
  return {
    board: initialBoard(),
    turn: "white",
    castling: { white: { k: true, q: true }, black: { k: true, q: true } },
    ep: null, // en-passant TARGET square {r,c}, or null
  };
}

function findKing(board, color) {
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const p = board[r][c];
      if (p && p.color === color && p.type === "k") return { r, c };
    }
  return null;
}

const KNIGHT_DELTAS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_DELTAS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Is square (r,c) attacked by `byColor`? (Ignores en-passant and castling.)
export function isAttacked(board, r, c, byColor) {
  // A `byColor` pawn attacks one step along its forward dir on adjacent files,
  // so it attacks (r,c) if it sits at (r - dir, c ± 1).
  const pdr = PAWN_DIR[byColor];
  for (const dc of [-1, 1]) {
    const pr = r - pdr, pc = c - dc;
    if (inBounds(pr, pc)) {
      const p = board[pr][pc];
      if (p && p.color === byColor && p.type === "p") return true;
    }
  }
  for (const [dr, dc] of KNIGHT_DELTAS) {
    const rr = r + dr, cc = c + dc;
    if (inBounds(rr, cc)) {
      const p = board[rr][cc];
      if (p && p.color === byColor && p.type === "n") return true;
    }
  }
  for (const [dr, dc] of KING_DELTAS) {
    const rr = r + dr, cc = c + dc;
    if (inBounds(rr, cc)) {
      const p = board[rr][cc];
      if (p && p.color === byColor && p.type === "k") return true;
    }
  }
  for (const [dr, dc] of BISHOP_DIRS) {
    let rr = r + dr, cc = c + dc;
    while (inBounds(rr, cc)) {
      const p = board[rr][cc];
      if (p) {
        if (p.color === byColor && (p.type === "b" || p.type === "q")) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  for (const [dr, dc] of ROOK_DIRS) {
    let rr = r + dr, cc = c + dc;
    while (inBounds(rr, cc)) {
      const p = board[rr][cc];
      if (p) {
        if (p.color === byColor && (p.type === "r" || p.type === "q")) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  return false;
}

export function inCheck(board, color) {
  const k = findKing(board, color);
  if (!k) return false;
  return isAttacked(board, k.r, k.c, other(color));
}

// PSEUDO-LEGAL moves for the piece at (r,c) — does NOT filter self-check.
function pseudoMovesFrom(state, r, c) {
  const board = state.board;
  const p = board[r][c];
  if (!p) return [];
  const out = [];
  const color = p.color;
  const enemy = other(color);

  const push = (tr, tc, flags) => {
    out.push({ from: { r, c }, to: { r: tr, c: tc }, flags: flags || {} });
  };

  if (p.type === "p") {
    const dir = PAWN_DIR[color];
    const fr = r + dir;
    if (inBounds(fr, c) && !board[fr][c]) {
      pawnPush(out, r, c, fr, c, color);
      const fr2 = r + 2 * dir;
      if (r === HOME_PAWN_ROW[color] && inBounds(fr2, c) && !board[fr2][c]) {
        push(fr2, c, { double: true });
      }
    }
    for (const dc of [-1, 1]) {
      const tc = c + dc;
      if (!inBounds(fr, tc)) continue;
      const target = board[fr][tc];
      if (target && target.color === enemy) {
        pawnPush(out, r, c, fr, tc, color);
      } else if (state.ep && state.ep.r === fr && state.ep.c === tc) {
        // En passant: the captured pawn sits beside the mover (row r, file tc).
        push(fr, tc, { ep: { r, c: tc } });
      }
    }
    return out;
  }

  if (p.type === "n") {
    for (const [dr, dc] of KNIGHT_DELTAS) {
      const rr = r + dr, cc = c + dc;
      if (!inBounds(rr, cc)) continue;
      const t = board[rr][cc];
      if (!t || t.color === enemy) push(rr, cc, {});
    }
    return out;
  }

  if (p.type === "k") {
    for (const [dr, dc] of KING_DELTAS) {
      const rr = r + dr, cc = c + dc;
      if (!inBounds(rr, cc)) continue;
      const t = board[rr][cc];
      if (!t || t.color === enemy) push(rr, cc, {});
    }
    addCastles(state, r, c, color, push);
    return out;
  }

  let dirs;
  if (p.type === "b") dirs = BISHOP_DIRS;
  else if (p.type === "r") dirs = ROOK_DIRS;
  else dirs = [...BISHOP_DIRS, ...ROOK_DIRS]; // queen
  for (const [dr, dc] of dirs) {
    let rr = r + dr, cc = c + dc;
    while (inBounds(rr, cc)) {
      const t = board[rr][cc];
      if (!t) { push(rr, cc, {}); }
      else { if (t.color === enemy) push(rr, cc, {}); break; }
      rr += dr; cc += dc;
    }
  }
  return out;
}

// Emit a pawn forward/capture, expanding to four promotions on the last rank.
function pawnPush(out, r, c, tr, tc, color) {
  if (tr === PROMO_ROW[color]) {
    for (const promo of ["q", "r", "b", "n"]) {
      out.push({ from: { r, c }, to: { r: tr, c: tc }, flags: { promo } });
    }
  } else {
    out.push({ from: { r, c }, to: { r: tr, c: tc }, flags: {} });
  }
}

// Castling moves for the king at (r,c). All FIDE constraints enforced.
function addCastles(state, r, c, color, push) {
  const board = state.board;
  const homeRow = color === "white" ? 7 : 0;
  if (r !== homeRow || c !== 4) return;
  const rights = state.castling[color];
  if (!rights) return;
  const enemy = other(color);
  if (isAttacked(board, r, 4, enemy)) return; // can't castle out of check
  if (rights.k) {
    const rook = board[homeRow][7];
    if (rook && rook.color === color && rook.type === "r" &&
      !board[homeRow][5] && !board[homeRow][6] &&
      !isAttacked(board, homeRow, 5, enemy) && !isAttacked(board, homeRow, 6, enemy)) {
      push(homeRow, 6, { castle: "k" });
    }
  }
  if (rights.q) {
    const rook = board[homeRow][0];
    if (rook && rook.color === color && rook.type === "r" &&
      !board[homeRow][1] && !board[homeRow][2] && !board[homeRow][3] &&
      !isAttacked(board, homeRow, 3, enemy) && !isAttacked(board, homeRow, 2, enemy)) {
      push(homeRow, 2, { castle: "q" });
    }
  }
}

// Apply a pseudo-legal move to a CLONED next state (no check filtering). Pure.
export function applyMoveToState(state, move) {
  const board = cloneBoard(state.board);
  const castling = {
    white: { ...state.castling.white },
    black: { ...state.castling.black },
  };
  const { from, to, flags } = move;
  const piece = board[from.r][from.c];
  const color = piece.color;
  let ep = null;

  if (flags.ep) board[flags.ep.r][flags.ep.c] = null;

  board[from.r][from.c] = null;
  let moved = { color, type: piece.type };
  if (flags.promo) moved = { color, type: flags.promo };
  board[to.r][to.c] = moved;

  if (flags.castle) {
    const homeRow = color === "white" ? 7 : 0;
    if (flags.castle === "k") {
      board[homeRow][5] = board[homeRow][7];
      board[homeRow][7] = null;
    } else {
      board[homeRow][3] = board[homeRow][0];
      board[homeRow][0] = null;
    }
  }

  if (flags.double) ep = { r: (from.r + to.r) / 2, c: from.c };

  if (piece.type === "k") { castling[color].k = false; castling[color].q = false; }
  if (piece.type === "r") {
    const homeRow = color === "white" ? 7 : 0;
    if (from.r === homeRow && from.c === 0) castling[color].q = false;
    if (from.r === homeRow && from.c === 7) castling[color].k = false;
  }
  // A rook captured on its home square also voids that side's right.
  if (to.r === 7 && to.c === 0) castling.white.q = false;
  if (to.r === 7 && to.c === 7) castling.white.k = false;
  if (to.r === 0 && to.c === 0) castling.black.q = false;
  if (to.r === 0 && to.c === 7) castling.black.k = false;

  return { board, turn: other(color), castling, ep };
}

// All FULLY LEGAL moves for the side to move (self-check filtered).
export function legalMoves(state, color) {
  const side = color || state.turn;
  const out = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const p = state.board[r][c];
      if (!p || p.color !== side) continue;
      for (const m of pseudoMovesFrom(state, r, c)) {
        const next = applyMoveToState(state, m);
        if (!inCheck(next.board, side)) out.push(m);
      }
    }
  }
  return out;
}

export function legalMovesFrom(state, r, c) {
  const p = state.board[r][c];
  if (!p) return [];
  return legalMoves(state, p.color).filter((m) => m.from.r === r && m.from.c === c);
}

// "checkmate" | "stalemate" | "check" | "ongoing"
export function gameStatus(state) {
  const moves = legalMoves(state, state.turn);
  if (moves.length > 0) return inCheck(state.board, state.turn) ? "check" : "ongoing";
  return inCheck(state.board, state.turn) ? "checkmate" : "stalemate";
}

// Accept a relayed move only if it matches a legal move on (from,to)[+promo].
export function matchLegalMove(state, msg) {
  if (!msg || !msg.from || !msg.to) return null;
  const candidates = legalMoves(state, state.turn).filter(
    (m) => eqSq(m.from, msg.from) && eqSq(m.to, msg.to)
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const want = msg.promo || "q";
  return candidates.find((m) => m.flags.promo === want) ||
    candidates.find((m) => m.flags.promo === "q") || candidates[0];
}

// ===========================================================================
// GEOMETRY CONSTANTS (metres, board group local XZ; col -> X, row -> Z, row 0 -Z).
// ===========================================================================
const BOARD_SIZE = FRAMEWORK_BOARD_SIZE || 0.7;
const HALF = BOARD_SIZE / 2;
const STEP = BOARD_SIZE / N;

const PLANK_H = 0.022;
const FRAME_W = 0.030;
const FRAME_H = 0.012;
const TILE_T = 0.004;
const PLANK_TOP = PLANK_H;
const TILE_TOP = PLANK_TOP + TILE_T; // pieces rest here

const PIECE_HEIGHT = {
  p: STEP * 0.62,
  n: STEP * 0.72,
  b: STEP * 0.78,
  r: STEP * 0.64,
  q: STEP * 0.92,
  k: STEP * 1.0,
};

function cellX(c) { return -HALF + (c + 0.5) * STEP; }
function cellZ(r) { return -HALF + (r + 0.5) * STEP; }
const isDarkSq = (r, c) => (r + c) % 2 === 1;

// ===========================================================================
// THE MODULE
// ===========================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "chess";
  group.userData.gridN = N;
  group.userData.attribution = ATTRIBUTION;

  // -------------------------------------------------------------------------
  // ALL MUTABLE INSTANCE STATE DECLARED UP FRONT.
  // Nothing below this block may be touched by a builder that runs before its
  // declaration — that Temporal-Dead-Zone access is exactly the crash we fixed.
  // Every builder call happens AFTER this entire block.
  // -------------------------------------------------------------------------
  let state = initialState();      // { board, turn, castling, ep }
  let phase = "play";              // "play" | "over"
  let winner = null;               // "white" | "black" | null (draw)

  let role = ctx.role;
  let seatRy = ctx.seatRy;
  // White = host (moves first), black = guest. Spectators get null.
  let myColor = role === "host" ? "white" : role === "guest" ? "black" : null;

  // Selection (seated local player, on their turn only).
  let selectedFrom = null;         // {r,c}
  let selMoves = [];               // legal moves from the selected square

  let busy = false;                // true while a move animates
  let disposed = false;

  // GLB-derived templates per type (filled async; null until/unless resolved).
  const modelTemplate = { p: null, n: null, b: null, r: null, q: null, k: null };
  let modelsReady = false;

  // Piece ledger: pieceMeshes[r][c] = Group|null, diffed against the board.
  const pieceMeshes = Array.from({ length: N }, () => new Array(N).fill(null));

  // Highlights.
  let selRingMesh = null;
  const targets = [];

  // Identity / turn cue resources.
  let cueCanvas = null, cueTex = null, cueMesh = null, homeRail = null;

  // Animation loop state.
  const glides = []; // { mesh, t, dur, fromX, fromZ, toX, toZ, arc, onDone }
  let rafId = null, lastT = 0, idleT = 0;

  // ===========================================================================
  // Materials. Pieces clone a per-colour material so selection emissive (if any)
  // is independent. White = ivory, black = charcoal — clearly distinct + lit.
  // ===========================================================================
  const M = {
    frame: new THREE.MeshStandardMaterial({ color: "#4a311c", roughness: 0.66, metalness: 0.06 }),
    plank: new THREE.MeshStandardMaterial({ color: "#3a281a", roughness: 0.74, metalness: 0.04 }),
    dark: new THREE.MeshStandardMaterial({ color: "#7a4a25", roughness: 0.8, metalness: 0.03 }),
    light: new THREE.MeshStandardMaterial({ color: "#e8d2ab", roughness: 0.84, metalness: 0.02 }),
    tray: new THREE.MeshStandardMaterial({ color: "#2c1d11", roughness: 0.9, metalness: 0.03 }),
    white: new THREE.MeshStandardMaterial({ color: "#f1ead6", roughness: 0.46, metalness: 0.06, emissive: "#000000" }),
    black: new THREE.MeshStandardMaterial({ color: "#26211d", roughness: 0.5, metalness: 0.12, emissive: "#000000" }),
    selRing: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.34, metalness: 0.5, emissive: "#e0a23a", emissiveIntensity: 0.5, transparent: true, opacity: 0.92 }),
    target: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.3, emissive: "#e0a23a", emissiveIntensity: 0.55, transparent: true, opacity: 0.62, depthWrite: false }),
    capTarget: new THREE.MeshStandardMaterial({ color: "#e05a3a", roughness: 0.3, metalness: 0.3, emissive: "#e05a3a", emissiveIntensity: 0.6, transparent: true, opacity: 0.5, depthWrite: false }),
    invisible: new THREE.MeshBasicMaterial({ visible: false }),
  };

  // Shared misc geometry (highlights + colliders).
  const G = {
    selRing: new THREE.TorusGeometry(STEP * 0.42, STEP * 0.05, 8, 28),
    target: new THREE.CylinderGeometry(STEP * 0.16, STEP * 0.16, STEP * 0.04, 22),
    capRing: new THREE.TorusGeometry(STEP * 0.40, STEP * 0.045, 8, 28),
    // Flat slab (like checkers): a thin per-cell collider sitting just above the
    // tiles. A tall collider would occlude the square BEHIND it at an oblique
    // camera angle, so empty-square clicks could pick the wrong (front) cell.
    // Keeping it flat means hits[0] is reliably the aimed square's collider.
    hit: new THREE.BoxGeometry(STEP * 0.98, TILE_T * 3, STEP * 0.98),
  };

  // Procedural piece geometry (lathe surfaces of revolution + stylized knight).
  const procGeo = buildProceduralGeometry();

  // ---- Orientation --------------------------------------------------------
  // Canonical frame: black home rows 0/1 (-Z), white home rows 6/7 (+Z). We
  // declare orientPolicy:"self" so board.js does NOT rotate the group, then turn
  // the group ourselves by orientFor(seatRy) + (white ? PI : 0): orientFor brings
  // the -Z (black) edge to the local seat; the extra PI for white flips so the +Z
  // (white) edge comes near. Result: host(white) sees white nearest, guest(black)
  // sees black nearest, opponent across. Spectators (seatRy null) get 0.
  function applyFacing() {
    const extra = myColor === "white" ? Math.PI : 0;
    group.rotation.y = orientFor(seatRy) + extra;
  }
  applyFacing();

  // ---------------------------------------------------------------------------
  // Build static scene graph + cue, then kick async model load. (Runs AFTER all
  // state declarations above, so no TDZ.)
  // ---------------------------------------------------------------------------
  buildBoard();
  buildColliders();
  buildIdentityCue();
  updateIdentityCue();
  paint();
  loadModels();

  // ===========================================================================
  // Procedural geometry builders.
  // ===========================================================================
  function buildProceduralGeometry() {
    const lathe = (pts, seg = 24) =>
      new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
    const out = {};
    out.p = lathe([
      [0.0, 0], [0.30, 0], [0.30, 0.06], [0.16, 0.12], [0.13, 0.45],
      [0.20, 0.55], [0.13, 0.6], [0.20, 0.66], [0.20, 0.72], [0.0, 0.86],
    ]);
    out.r = lathe([
      [0.0, 0], [0.34, 0], [0.34, 0.08], [0.24, 0.14], [0.24, 0.6],
      [0.30, 0.68], [0.34, 0.72], [0.34, 0.86], [0.22, 0.86], [0.22, 0.74], [0.0, 0.74],
    ]);
    out.b = lathe([
      [0.0, 0], [0.32, 0], [0.32, 0.07], [0.18, 0.13], [0.15, 0.5],
      [0.22, 0.58], [0.10, 0.64], [0.14, 0.74], [0.07, 0.84], [0.10, 0.9], [0.0, 0.98],
    ]);
    out.q = lathe([
      [0.0, 0], [0.36, 0], [0.36, 0.08], [0.20, 0.15], [0.16, 0.55],
      [0.26, 0.66], [0.30, 0.74], [0.14, 0.8], [0.18, 0.88], [0.08, 0.94], [0.10, 0.98], [0.0, 1.04],
    ]);
    out.k = lathe([
      [0.0, 0], [0.36, 0], [0.36, 0.08], [0.20, 0.15], [0.16, 0.58],
      [0.27, 0.69], [0.31, 0.78], [0.15, 0.84], [0.18, 0.92], [0.10, 0.98], [0.12, 1.02], [0.0, 1.06],
    ]);
    out.n = null; // knight handled specially (extruded silhouette)
    // Vertex normals so lit StandardMaterial shades correctly.
    for (const k of Object.keys(out)) {
      const g = out[k];
      if (g && !g.attributes.normal) g.computeVertexNormals();
    }
    return out;
  }

  // Build a procedural piece Group for (type, mat). Base on y=0, sits at TILE_TOP.
  function makeProceduralPiece(type, mat) {
    const g = new THREE.Group();
    if (type === "n") {
      const baseGeo = new THREE.CylinderGeometry(STEP * 0.3, STEP * 0.34, STEP * 0.12, 20);
      const base = new THREE.Mesh(baseGeo, mat);
      base.position.y = STEP * 0.06;
      base.castShadow = true; base.receiveShadow = true;
      g.add(base);
      const shape = new THREE.Shape();
      shape.moveTo(-0.18, 0.0);
      shape.lineTo(-0.20, 0.30);
      shape.lineTo(-0.05, 0.55);
      shape.lineTo(-0.12, 0.66);
      shape.lineTo(0.02, 0.78);
      shape.lineTo(0.10, 0.66);
      shape.lineTo(0.22, 0.62);
      shape.lineTo(0.16, 0.40);
      shape.lineTo(0.20, 0.10);
      shape.lineTo(0.20, 0.0);
      shape.closePath();
      const headGeo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2,
      });
      headGeo.center();
      const head = new THREE.Mesh(headGeo, mat);
      const sc = PIECE_HEIGHT.n / 0.78;
      head.scale.setScalar(sc);
      head.position.y = STEP * 0.12 + (0.78 * sc) / 2;
      head.rotation.y = Math.PI / 2;
      head.castShadow = true; head.receiveShadow = true;
      g.add(head);
      g.userData.baseGeo = baseGeo;
      g.userData.headGeo = headGeo;
      return g;
    }
    const geo = procGeo[type];
    const mesh = new THREE.Mesh(geo, mat);
    const profH = type === "p" ? 0.86 : type === "r" ? 0.86 : type === "b" ? 0.98 : 1.06;
    const sc = (PIECE_HEIGHT[type] / profH) * (STEP * 1.0);
    mesh.scale.setScalar(sc);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    if (type === "k") {
      const v = new THREE.Mesh(new THREE.BoxGeometry(STEP * 0.06, STEP * 0.22, STEP * 0.06), mat);
      const h = new THREE.Mesh(new THREE.BoxGeometry(STEP * 0.16, STEP * 0.06, STEP * 0.06), mat);
      v.position.y = PIECE_HEIGHT.k + STEP * 0.06;
      h.position.y = PIECE_HEIGHT.k + STEP * 0.02;
      v.castShadow = h.castShadow = true;
      g.add(v); g.add(h);
      g.userData.crossGeo = [v.geometry, h.geometry];
    }
    return g;
  }

  // ===========================================================================
  // IDENTITY + TURN CUE — a flat placard outside the LOCAL player's own near edge
  // naming their colour and whose turn it is, derived from role/myColour (NEVER
  // the wire). Plus a coloured rim on the local home edge as a second cue.
  // ===========================================================================
  function buildIdentityCue() {
    if (typeof document === "undefined" || !document.createElement) return;
    cueCanvas = document.createElement("canvas");
    cueCanvas.width = 512; cueCanvas.height = 96;
    cueTex = new THREE.CanvasTexture(cueCanvas);
    if (THREE.SRGBColorSpace) cueTex.colorSpace = THREE.SRGBColorSpace;
    const cueMat = new THREE.MeshBasicMaterial({ map: cueTex, transparent: true, depthWrite: false });
    const cueGeo = new THREE.PlaneGeometry(BOARD_SIZE * 0.62, BOARD_SIZE * 0.62 * (96 / 512));
    cueMesh = new THREE.Mesh(cueGeo, cueMat);
    cueMesh.rotation.x = -Math.PI / 2;
    cueMesh.renderOrder = 4;
    group.add(cueMesh);
    const railGeo = new THREE.BoxGeometry(BOARD_SIZE + FRAME_W * 2, FRAME_H * 0.6, STEP * 0.16);
    homeRail = new THREE.Mesh(railGeo, new THREE.MeshStandardMaterial({
      color: "#efe7d2", emissive: "#efe7d2", emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.1,
    }));
    homeRail.castShadow = false; homeRail.receiveShadow = true;
    group.add(homeRail);
    G._cueGeo = cueGeo; G._railGeo = railGeo;
  }

  function updateIdentityCue() {
    if (!cueMesh) return;
    const nearZ = myColor === "white" ? 1 : -1; // white home +Z, black home -Z
    const edgeZ = nearZ * (HALF + FRAME_W + STEP * 0.30);
    cueMesh.position.set(0, TILE_TOP + 0.003, edgeZ + nearZ * STEP * 0.34);
    cueMesh.rotation.z = nearZ > 0 ? Math.PI : 0;

    if (homeRail) {
      homeRail.position.set(0, PLANK_TOP + FRAME_H + (FRAME_H * 0.6) / 2, nearZ * (HALF + FRAME_W / 2));
      const c = myColor === "white" ? "#efe7d2" : myColor === "black" ? "#2b2622" : "#6a5a44";
      homeRail.material.color.set(c);
      homeRail.material.emissive.set(c);
      homeRail.material.emissiveIntensity = myColor === "black" ? 0.18 : 0.35;
      homeRail.visible = !!myColor;
    }
    paintCueText();
  }

  function paintCueText() {
    if (!cueCanvas || !cueTex) return;
    const g = cueCanvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, 512, 96);
    let text, accent;
    if (!myColor) {
      text = "Spectating";
      accent = "#d8c9ad";
    } else {
      const youAre = myColor === "white" ? "You are White" : "You are Black";
      let status;
      if (phase === "over") {
        status = winner == null ? "Draw" : winner === myColor ? "You win" : "You lose";
      } else {
        status = state.turn === myColor ? "Your move" : "Opponent's move";
      }
      text = `${youAre}  —  ${status}`;
      accent = phase === "over"
        ? (winner === myColor ? "#7ad08a" : winner == null ? "#d8c9ad" : "#e0734a")
        : (state.turn === myColor ? "#7ad08a" : "#e0a23a");
    }
    g.fillStyle = "rgba(26,18,11,0.86)";
    roundRect(g, 2, 6, 508, 84, 18); g.fill();
    g.lineWidth = 4; g.strokeStyle = accent; g.stroke();
    g.font = "bold 42px sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = accent;
    g.fillText(text, 256, 50);
    cueTex.needsUpdate = true;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // -------------------------------------------------------------------------
  // Static board: plank, proud frame, 64 tiles, two side capture trays.
  // -------------------------------------------------------------------------
  function buildBoard() {
    const outer = BOARD_SIZE + FRAME_W * 2;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(outer, PLANK_H, outer), M.plank);
    plank.position.y = PLANK_H / 2;
    plank.castShadow = true; plank.receiveShadow = true;
    group.add(plank);

    const frameY = PLANK_TOP + FRAME_H / 2;
    const longGeo = new THREE.BoxGeometry(outer, FRAME_H, FRAME_W);
    const sideGeo = new THREE.BoxGeometry(FRAME_W, FRAME_H, outer - FRAME_W * 2);
    const off = HALF + FRAME_W / 2;
    for (const [geo, x, z] of [
      [longGeo, 0, -off], [longGeo, 0, off], [sideGeo, -off, 0], [sideGeo, off, 0],
    ]) {
      const rail = new THREE.Mesh(geo, M.frame);
      rail.position.set(x, frameY, z);
      rail.scale.set(0.96, 1, 0.96);
      rail.castShadow = true; rail.receiveShadow = true;
      group.add(rail);
    }

    const tileGeo = new THREE.BoxGeometry(STEP * 0.98, TILE_T, STEP * 0.98);
    G._tileGeo = tileGeo;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const tile = new THREE.Mesh(tileGeo, isDarkSq(r, c) ? M.dark : M.light);
        tile.position.set(cellX(c), PLANK_TOP + TILE_T / 2, cellZ(r));
        tile.receiveShadow = true;
        group.add(tile);
      }
    }

    G._trayGeo = new THREE.BoxGeometry(STEP * 0.9, 0.006, BOARD_SIZE * 0.92);
    for (const sx of [-1, 1]) {
      const tray = new THREE.Mesh(G._trayGeo, M.tray);
      tray.position.set(sx * (HALF + FRAME_W + STEP * 0.55), PLANK_TOP - 0.001, 0);
      tray.receiveShadow = true;
      group.add(tray);
    }
  }

  // One invisible collider per square so empty cells are reliably clickable.
  function buildColliders() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const box = new THREE.Mesh(G.hit, M.invisible);
        box.position.set(cellX(c), TILE_TOP + (TILE_T * 3) / 2, cellZ(r));
        box.userData.cell = { r, c };
        group.add(box);
      }
    }
  }

  // -------------------------------------------------------------------------
  // GLB loading (non-blocking). Loads six per-piece models, normalises each to
  // base-centered + target height, stores a template per type. On any success
  // flips modelsReady and repaints. Failures leave that type procedural.
  // -------------------------------------------------------------------------
  function loadModels() {
    let loader;
    try {
      loader = new GLTFLoader();
    } catch {
      return; // no loader → stay procedural
    }
    const types = Object.keys(MODEL_FILES);
    let remaining = types.length;
    let anyOk = false;
    const done = () => {
      remaining -= 1;
      if (remaining > 0) return;
      if (anyOk && !disposed) { modelsReady = true; paint(); }
    };
    for (const type of types) {
      const url = MODEL_BASE + MODEL_FILES[type];
      let settled = false;
      const finish = (tmpl) => {
        if (settled) return; settled = true;
        if (tmpl) { modelTemplate[type] = tmpl; anyOk = true; }
        done();
      };
      try {
        loader.load(
          url,
          (gltf) => {
            try {
              const scene = gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]));
              finish(normalizeModel(scene, type));
            } catch {
              finish(null);
            }
          },
          undefined,
          () => finish(null) // network/parse error → procedural for this type
        );
      } catch {
        finish(null);
      }
    }
  }

  // Normalise a loaded GLB scene into a template Group: recenter on XZ base, scale
  // to PIECE_HEIGHT, stand upright on y=0. CRITICAL fixes: compute missing vertex
  // normals (else StandardMaterial shades black) and strip baked maps so our
  // ivory/charcoal material is the only colour that reaches the screen.
  function normalizeModel(scene, type) {
    if (!scene) return null;
    let tmpl;
    try { tmpl = scene.clone(true); } catch { return null; }
    const box = new THREE.Box3().setFromObject(tmpl);
    if (!box || box.isEmpty() || !isFinite(box.min.x) || !isFinite(box.max.y)) return null;
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const height = size.y || 1;
    const scale = PIECE_HEIGHT[type] / height;

    tmpl.position.x = -center.x;
    tmpl.position.z = -center.z;
    tmpl.position.y = -box.min.y; // base sits on y=0
    const inner = new THREE.Group();
    inner.add(tmpl);
    inner.scale.setScalar(scale);
    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.userData.modelGeometries = [];

    wrap.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const g = o.geometry;
      if (g) {
        if (!g.attributes || !g.attributes.normal) {
          g.computeVertexNormals();
          g.normalizeNormals?.();
          if (g.attributes && g.attributes.normal) g.attributes.normal.needsUpdate = true;
        }
        wrap.userData.modelGeometries.push(g);
      }
      // Drop the GLB's own (near-black) material/map; replaced per clone anyway.
      if (o.material && o.material.map) { o.material.map = null; o.material.needsUpdate = true; }
    });
    return wrap;
  }

  // Clone a normalized template for (type,color) and bind our cloned colour mat to
  // EVERY submesh so the GLB's near-black baseColorFactor never reaches the screen.
  function makeModelPiece(type, color, mat) {
    const tmpl = modelTemplate[type];
    if (!tmpl) return null;
    let g;
    try { g = tmpl.clone(true); } catch { return null; }
    g.traverse((o) => {
      if (o.isMesh) {
        o.material = mat;
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (color === "black") g.rotation.y = Math.PI; // cosmetic symmetry
    return g;
  }

  // Create a piece Group (model clone if ready, else procedural) for (type,color).
  function makePiece(type, color) {
    const mat = (color === "white" ? M.white : M.black).clone();
    let g = null;
    if (modelsReady && modelTemplate[type]) g = makeModelPiece(type, color, mat);
    if (!g) g = makeProceduralPiece(type, mat);
    g.userData.pieceMat = mat;
    g.userData.pieceType = type;
    g.userData.pieceColor = color;
    return g;
  }

  function disposePiece(g) {
    if (!g) return;
    if (g.parent) g.parent.remove(g);
    g.userData.pieceMat?.dispose?.();
    if (g.userData.baseGeo) g.userData.baseGeo.dispose?.();
    if (g.userData.headGeo) g.userData.headGeo.dispose?.();
    if (g.userData.crossGeo) for (const cg of g.userData.crossGeo) cg.dispose?.();
  }

  // -------------------------------------------------------------------------
  // Paint: idempotently rebuild the visible pieces from the logical board.
  // -------------------------------------------------------------------------
  function paint() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const want = state.board[r][c];
        const have = pieceMeshes[r][c];
        if (!want) {
          if (have) { disposePiece(have); pieceMeshes[r][c] = null; }
          continue;
        }
        const wantIsModel = modelsReady && !!modelTemplate[want.type];
        if (have && have.userData.pieceType === want.type &&
          have.userData.pieceColor === want.color &&
          have.userData.isModel === wantIsModel) {
          have.position.set(cellX(c), TILE_TOP, cellZ(r));
          // Tag this piece's resting cell so a click on ANY of its submeshes
          // resolves to its OWN square (never a neighbour). The moving piece
          // glides to (r,c) but state has already advanced, so this is correct.
          have.userData.cell = { r, c };
          continue;
        }
        if (have) { disposePiece(have); pieceMeshes[r][c] = null; }
        const g = makePiece(want.type, want.color);
        g.userData.isModel = wantIsModel;
        g.position.set(cellX(c), TILE_TOP, cellZ(r));
        g.userData.cell = { r, c };
        group.add(g);
        pieceMeshes[r][c] = g;
      }
    }
    refreshHighlights();
  }

  // ===========================================================================
  // Highlights — gold selection ring + bobbing target tokens (gold quiet, red
  // ring capture). Only for the seated player on their turn.
  // ===========================================================================
  function myTurnNow() {
    const gate = typeof ctx.isLocalTurnAllowed === "function"
      ? ctx.isLocalTurnAllowed() : (state.turn === myColor);
    return phase === "play" && role !== "spectator" && state.turn === myColor && gate;
  }

  function refreshHighlights() {
    clearHighlights();
    if (!myTurnNow() || !selectedFrom) { startLoopIfNeeded(); return; }
    selRingMesh = new THREE.Mesh(G.selRing, M.selRing);
    selRingMesh.rotation.x = Math.PI / 2;
    selRingMesh.position.set(cellX(selectedFrom.c), TILE_TOP + 0.002, cellZ(selectedFrom.r));
    selRingMesh.renderOrder = 2;
    group.add(selRingMesh);

    for (const m of selMoves) {
      const capture = !!state.board[m.to.r][m.to.c] || !!m.flags.ep;
      addTarget(m.to.r, m.to.c, capture);
    }
    startLoopIfNeeded();
  }

  function addTarget(r, c, capture) {
    let t;
    if (capture) {
      t = new THREE.Mesh(G.capRing, M.capTarget);
      t.rotation.x = Math.PI / 2;
    } else {
      t = new THREE.Mesh(G.target, M.target);
    }
    const baseY = TILE_TOP + STEP * 0.16;
    t.position.set(cellX(c), baseY, cellZ(r));
    t.userData.baseY = baseY;
    t.renderOrder = 3;
    group.add(t);
    targets.push(t);
  }

  function clearHighlights() {
    for (const t of targets) group.remove(t);
    targets.length = 0;
    if (selRingMesh) { group.remove(selRingMesh); selRingMesh = null; }
  }

  function clearSelection() { selectedFrom = null; selMoves = []; }

  // ===========================================================================
  // Animation loop — gliding mover + idle bob/spin for the target tokens.
  // ===========================================================================
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const raf = (fn) => (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(fn) : setTimeout(() => fn(nowMs()), 16));
  const caf = (id) => (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(id) : clearTimeout(id));
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  function loopActive() { return glides.length > 0 || targets.length > 0; }
  function startLoopIfNeeded() { if (loopActive()) startLoop(); }
  function startLoop() {
    if (rafId != null || disposed) return;
    lastT = nowMs();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
      lastT = t;
      stepAnim(dt);
      rafId = (loopActive() && !disposed) ? raf(tick) : null;
    };
    rafId = raf(tick);
  }

  function stepAnim(dt) {
    for (let i = glides.length - 1; i >= 0; i--) {
      const a = glides[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const e = easeInOut(k);
      a.mesh.position.x = a.fromX + (a.toX - a.fromX) * e;
      a.mesh.position.z = a.fromZ + (a.toZ - a.fromZ) * e;
      a.mesh.position.y = TILE_TOP + (a.arc ? Math.sin(k * Math.PI) * STEP * 0.35 : 0);
      if (k >= 1) {
        a.mesh.position.set(a.toX, TILE_TOP, a.toZ);
        glides.splice(i, 1);
        if (a.onDone) a.onDone();
      }
    }
    if (targets.length > 0) {
      idleT += dt;
      const bob = Math.sin(idleT * 3.0) * STEP * 0.04;
      for (const t of targets) {
        t.position.y = t.userData.baseY + bob;
        t.rotation.z = idleT * 1.4;
      }
    }
  }

  function animateMove(from, to, isKnight, onDone) {
    const mesh = pieceMeshes[to.r][to.c];
    if (!mesh) { if (onDone) onDone(); return; }
    glides.push({
      mesh, t: 0, dur: 0.26,
      fromX: cellX(from.c), fromZ: cellZ(from.r),
      toX: cellX(to.c), toZ: cellZ(to.r),
      arc: isKnight, onDone,
    });
    startLoop();
  }

  // ===========================================================================
  // performMove — apply a validated legal move. The logical state is the source
  // of truth; meshes reconcile (paint) then the mover glides.
  // ===========================================================================
  function performMove(move) {
    const movingPiece = state.board[move.from.r][move.from.c];
    const isKnight = movingPiece && movingPiece.type === "n";
    state = applyMoveToState(state, move);

    busy = true;
    clearSelection();
    clearHighlights();
    paint();
    animateMove(move.from, move.to, isKnight, () => { busy = false; });
    if (!pieceMeshes[move.to.r][move.to.c]) busy = false;
  }

  // After a move: detect checkmate / stalemate.
  function afterMove() {
    const status = gameStatus(state);
    if (status === "checkmate") {
      phase = "over";
      winner = other(state.turn);
      clearSelection(); clearHighlights();
      updateIdentityCue();
      try { ctx.onGameOver?.({ winner, reason: "checkmate" }); } catch { /* */ }
      return;
    }
    if (status === "stalemate") {
      phase = "over";
      winner = null;
      clearSelection(); clearHighlights();
      updateIdentityCue();
      try { ctx.onGameOver?.({ winner: null, reason: "stalemate" }); } catch { /* */ }
      return;
    }
    updateIdentityCue();
    refreshHighlights();
  }

  // ===========================================================================
  // hitToCell — authoritative pointer->cell resolver (used by board.js tier 1).
  // Walk the hit object's parent chain returning the FIRST userData.cell found:
  // this covers BOTH the flat per-square colliders AND the now-tagged piece
  // groups, so a click on a tall piece resolves to that piece's OWN square
  // (never a neighbour). Only when no tagged ancestor exists (a true bare-wood
  // hit beyond the colliders) do we fall back to a SNAP geometric map using
  // round() (nearest cell centre), which tolerates a high/oblique hit-point far
  // better than a floor()-based world-point map.
  // ===========================================================================
  function hitToCell(hit) {
    let o = hit && hit.object;
    while (o) {
      if (o.userData && o.userData.cell) {
        return { r: o.userData.cell.r, c: o.userData.cell.c };
      }
      o = o.parent;
    }
    if (hit && hit.point && group.worldToLocal) {
      const local = group.worldToLocal(hit.point.clone());
      const c = Math.round((local.x + HALF) / BOARD_SIZE * N - 0.5);
      const r = Math.round((local.z + HALF) / BOARD_SIZE * N - 0.5);
      if (inBounds(r, c)) return { r, c };
    }
    return null;
  }

  // ===========================================================================
  // onPointer — seated player clicked a resolved cell.
  // ===========================================================================
  function onPointer(hit) {
    const gate = typeof ctx.isLocalTurnAllowed === "function"
      ? ctx.isLocalTurnAllowed() : (state.turn === myColor);
    if (!gate) return;
    if (phase !== "play" || state.turn !== myColor) return;
    if (busy) return;
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.r) || !Number.isInteger(cell.c)) return;
    const { r, c } = cell;
    if (!inBounds(r, c)) return;

    if (selectedFrom) {
      const move = selMoves.find((m) => m.to.r === r && m.to.c === c);
      if (move) { commitMove(move); return; }
      // Clicked off the legal targets — fall through to (re)select.
    }

    const p = state.board[r][c];
    if (p && p.color === myColor) {
      selectedFrom = { r, c };
      selMoves = dedupePromotions(legalMovesFrom(state, r, c));
      refreshHighlights();
    } else {
      clearSelection();
      refreshHighlights();
    }
  }

  // Collapse four promotion moves to a single auto-queen per destination.
  function dedupePromotions(moves) {
    const seen = new Set();
    const out = [];
    for (const m of moves) {
      const key = m.to.r * 8 + m.to.c;
      if (m.flags.promo) {
        if (seen.has(key)) continue;
        if (m.flags.promo !== "q") continue;
        seen.add(key);
      }
      out.push(m);
    }
    return out;
  }

  // Commit a LOCAL move: mutate + animate, relay (from,to,promo), then (host) push.
  function commitMove(move) {
    const promo = move.flags.promo || null;
    performMove(move);
    try {
      ctx.net?.sendMove?.({ type: "move", from: move.from, to: move.to, ...(promo ? { promo } : {}) });
    } catch { /* transport optional */ }
    afterMove();
    if (role === "host") pushSnapshot();
  }

  // ===========================================================================
  // applyMove — apply ONE relayed move. Trust only (from,to,promo); re-derive
  // legality AND verify the sender owns the side to move. On mismatch THROW
  // GameDesync (the contract's resync signal).
  // ===========================================================================
  function applyMove(move, byRole, by) {
    if (phase !== "play") throw new GameDesync("chess: move while not in play");
    if (!move || move.type !== "move") return false;
    let moverColor = null;
    if (by && Number.isInteger(by.seatIndex)) {
      moverColor = by.seatIndex === 0 ? "white" : by.seatIndex === 1 ? "black" : null;
    } else if (byRole === "host") {
      moverColor = "white";
    } else if (byRole === "guest") {
      moverColor = "black";
    }
    if (moverColor !== state.turn) {
      throw new GameDesync("chess: relayed move from wrong seat/colour");
    }
    const legal = matchLegalMove(state, move);
    if (!legal) throw new GameDesync("chess: no matching legal move");
    performMove(legal);
    afterMove();
    // Re-cache + re-broadcast authoritative state (and ambient pub) on the
    // opponent's relayed move too — mirroring commitMove(). Without this, after
    // every guest (black) move the server's cached pub/full stays stale and
    // broadcastAmbient never fires (it runs only from the game-state handler),
    // so ambient/passersby mirrors and any late-join/resync spectator render
    // the board frozen one ply behind. afterMove() above already advanced phase/
    // winner on checkmate/stalemate, so this final snapshot also carries the
    // game-over position publicly.
    if (role === "host") pushSnapshot();
    return true;
  }

  // ===========================================================================
  // Snapshots — full-information game; public state IS the full state.
  // ===========================================================================
  function snapshot() {
    return {
      board: cloneBoard(state.board),
      turn: state.turn,
      castling: {
        white: { ...state.castling.white },
        black: { ...state.castling.black },
      },
      ep: state.ep ? { r: state.ep.r, c: state.ep.c } : null,
      phase,
      winner,
    };
  }
  function publicState() { return snapshot(); }
  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net?.sendState?.(s, s); } catch { /* */ }
  }

  // ===========================================================================
  // applyState — render an AUTHORITATIVE FULL snapshot. Idempotent. null => fresh.
  // NEVER recomputes myColor/role from the wire (no side-flip).
  // ===========================================================================
  function applyState(incoming) {
    glides.length = 0;
    busy = false;
    clearSelection();
    clearHighlights();

    if (!incoming) {
      state = initialState();
      phase = "play";
      winner = null;
    } else {
      state = decodeState(incoming);
      phase = incoming.phase === "over" ? "over" : "play";
      winner = incoming.winner === "white" || incoming.winner === "black" ? incoming.winner : null;
    }
    updateIdentityCue();
    paint();
  }

  // Decode a snapshot into a clean { board, turn, castling, ep } state.
  function decodeState(incoming) {
    const src = Array.isArray(incoming) ? incoming : incoming.board;
    const board = Array.from({ length: N }, () => new Array(N).fill(null));
    if (Array.isArray(src)) {
      for (let r = 0; r < N; r++) {
        const row = src[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < N; c++) {
          const v = row[c];
          if (v && (v.color === "white" || v.color === "black") &&
            ["p", "n", "b", "r", "q", "k"].includes(v.type)) {
            board[r][c] = { color: v.color, type: v.type };
          }
        }
      }
    }
    const obj = Array.isArray(incoming) ? {} : (incoming || {});
    const turn = obj.turn === "black" ? "black" : "white";
    const cIn = obj.castling || {};
    const castling = {
      white: { k: !!(cIn.white && cIn.white.k), q: !!(cIn.white && cIn.white.q) },
      black: { k: !!(cIn.black && cIn.black.k), q: !!(cIn.black && cIn.black.q) },
    };
    const ep = obj.ep && Number.isInteger(obj.ep.r) && Number.isInteger(obj.ep.c)
      ? { r: obj.ep.r, c: obj.ep.c } : null;
    return { board, turn, castling, ep };
  }

  // ===========================================================================
  // Role / seat changes.
  // ===========================================================================
  function setRole(newRole) {
    role = newRole || "spectator";
    myColor = role === "host" ? "white" : role === "guest" ? "black" : null;
    applyFacing();
    clearSelection();
    updateIdentityCue();
    refreshHighlights();
  }
  function setSeatRy(ry) { seatRy = ry; applyFacing(); updateIdentityCue(); refreshHighlights(); }

  // ===========================================================================
  // dispose — stop the loop, free GPU resources, drop the group.
  // ===========================================================================
  function dispose() {
    disposed = true;
    if (rafId != null) { caf(rafId); rafId = null; }
    glides.length = 0;
    clearHighlights();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (pieceMeshes[r][c]) { disposePiece(pieceMeshes[r][c]); pieceMeshes[r][c] = null; }
      }
    }
    for (const type of Object.keys(modelTemplate)) {
      const tmpl = modelTemplate[type];
      if (tmpl && tmpl.userData.modelGeometries) {
        for (const g of tmpl.userData.modelGeometries) g.dispose?.();
      }
      modelTemplate[type] = null;
    }
    if (cueMesh) { group.remove(cueMesh); cueMesh.material?.dispose?.(); cueMesh = null; }
    if (cueTex) { cueTex.dispose?.(); cueTex = null; }
    cueCanvas = null;
    if (homeRail) { group.remove(homeRail); homeRail.material?.dispose?.(); homeRail = null; }
    for (const k of Object.keys(procGeo)) procGeo[k]?.dispose?.();
    for (const k of Object.keys(G)) G[k]?.dispose?.();
    for (const m of Object.values(M)) m.dispose?.();
    if (group.parent) group.parent.remove(group);
  }

  return {
    group,
    // We rotate the group ourselves (per-colour near-edge facing) so the
    // framework must NOT also rotate it — declare self-orientation.
    orientPolicy: "self",
    applyState,
    applyMove,
    onPointer,
    hitToCell,
    publicState,
    setRole,
    setSeatRy,
    dispose,
    attribution: ATTRIBUTION,
    isOurTurn: () => phase === "play" && state.turn === myColor && role !== "spectator",
  };
}

export default createGame;
