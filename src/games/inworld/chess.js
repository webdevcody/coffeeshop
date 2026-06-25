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

// Capture-tray geometry. The lane sits just outside the +X / -X frame, and parked
// prisoners stand upright at TRAY_TOP scaled to ~0.6 so up to 15 of one colour fit
// in an 8-row x 2-col grid that stays inside the tray's BOARD_SIZE*0.92 Z extent.
const TRAY_LANE_X = HALF + FRAME_W + STEP * 0.55;
const TRAY_TOP = PLANK_TOP + FRAME_H;        // tray shelf top (flush with frame)
const TRAY_SCALE = 0.6;                       // prisoners shrink to read as "taken"
const TRAY_COLS = 2;                          // columns per tray
const TRAY_COL_DX = STEP * 0.30;              // half-spacing between the two columns
const TRAY_ROW_DZ = STEP * 0.42;              // spacing down the tray

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

  // Promotion picker: when the local player chooses a pawn-promotion destination
  // we pause before committing and offer the four piece choices (q/r/b/n) so
  // under-promotion is reachable from the UI. While active, picker holds the
  // destination + the four candidate moves keyed by their flags.promo.
  let promoPick = null;            // null | { to:{r,c}, moves:{q,r,b,n} }
  const promoChoiceMeshes = [];    // selectable token meshes for the active picker
  let promoBackMesh = null;        // dark backing quad under the choice row

  let busy = false;                // true while a move animates
  let disposed = false;

  // GLB-derived templates per type (filled async; null until/unless resolved).
  const modelTemplate = { p: null, n: null, b: null, r: null, q: null, k: null };
  let modelsReady = false;

  // Piece ledger: pieceMeshes[r][c] = Group|null, diffed against the board.
  const pieceMeshes = Array.from({ length: N }, () => new Array(N).fill(null));

  // While a promotion mover glides, paint() must NOT reconcile its destination
  // cell (the logical board already says "queen" there, but the gliding mesh is
  // still the pawn — we swap it after the glide). Key = r*8+c, or -1 = none.
  // Declared up front with all other mutable state to avoid the TDZ crash the
  // module header documents (the initial paint() runs before later let-bindings).
  let paintSkipCell = -1;

  // Highlights.
  let selRingMesh = null;
  const targets = [];
  let liftedPiece = null;          // the selected piece given the I1 emissive lift
  let hoverCell = null;            // {r,c} | null — cursor cell on the local turn
  let hoverRingMesh = null;        // faint ring affordance on a hoverable square
  const hoverGhosts = [];          // faint preview tokens of a hovered piece's targets

  // Win flourish: a one-shot "victory breathe" on every surviving piece of the
  // winning army, driven from stepWinFlourish. Re-derivable in applyState so a
  // late-join/spectator sees the celebratory styling without the topple context.
  let winFlourishT = 0;            // >0 while the win breathe is animating
  const winGlowMeshes = [];        // surviving winning-army meshes being pulsed

  // Last-move trace: two fading tinted quads marking the previous from/to.
  let traceFromMesh = null, traceToMesh = null;
  let traceT = 0;                  // seconds since the trace was armed
  const TRACE_DUR = 1.2;
  // Last move {from,to} stashed into the snapshot so a converged spectator /
  // late-join can re-arm the trace in applyState (cosmetic, derived data).
  let lastMove = null;

  // Capture trays: a captured piece is parked (shrunk + stood upright) on the
  // side tray for the colour that took it, exactly like checkers' rails. White
  // captures park on +X, black captures on -X. A per-colour slot counter lays
  // them out in a tidy grid so the full 15 prisoners fit. Populated meshes are
  // owned by `prisoners` (not the pieceMeshes ledger) so paint()/applyState never
  // touch them; applyState recomputes the prisoner roster by diffing the board
  // against a full 16-piece army so spectators/late-joiners see filled trays too.
  const prisoners = [];            // { mesh, color, type } parked off-board
  const trayCount = { white: 0, black: 0 };

  // Transient cosmetic animations driven by stepAnim (capture sink/fade, piece
  // scale-pop, king check pulse / mate topple). All purely visual — never touch
  // logical state, the wire, or the piece ledger.
  const fxAnims = [];              // { kind, mesh, t, dur, ... }
  let checkPulseKing = null;       // mesh of the king in check (emissive pulse)
  let checkPulseT = 0;

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
    dark: new THREE.MeshStandardMaterial({ color: "#6e4220", roughness: 0.8, metalness: 0.03 }),
    light: new THREE.MeshStandardMaterial({ color: "#ecd7b2", roughness: 0.84, metalness: 0.02 }),
    tray: new THREE.MeshStandardMaterial({ color: "#2c1d11", roughness: 0.9, metalness: 0.03 }),
    // White = warm ivory, black = lifted graphite with a faint cool rim so the
    // dark army reads clearly against the dark squares from an oblique seated
    // angle (was #26211d, near-invisible on #7a4a25 at grazing incidence).
    white: new THREE.MeshStandardMaterial({ color: "#f3ecda", roughness: 0.44, metalness: 0.08, emissive: "#3a352a", emissiveIntensity: 0.10 }),
    black: new THREE.MeshStandardMaterial({ color: "#322a24", roughness: 0.42, metalness: 0.22, emissive: "#1a2230", emissiveIntensity: 0.16 }),
    selRing: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.34, metalness: 0.5, emissive: "#e0a23a", emissiveIntensity: 0.5, transparent: true, opacity: 0.92 }),
    target: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.3, emissive: "#e0a23a", emissiveIntensity: 0.55, transparent: true, opacity: 0.62, depthWrite: false }),
    capTarget: new THREE.MeshStandardMaterial({ color: "#e05a3a", roughness: 0.3, metalness: 0.3, emissive: "#e05a3a", emissiveIntensity: 0.6, transparent: true, opacity: 0.5, depthWrite: false }),
    // Hover ring on a hoverable own-piece / ghost target (cool gold, fainter than
    // the firm selection ring so the two never read the same).
    hover: new THREE.MeshStandardMaterial({ color: "#9fd4ff", roughness: 0.4, metalness: 0.3, emissive: "#7fb8ee", emissiveIntensity: 0.45, transparent: true, opacity: 0.55, depthWrite: false }),
    // Ghost preview of a HOVERED (not yet selected) piece's legal destinations —
    // dimmer + cooler than the firm selection targets so "scout" reads as distinct
    // from "committed". Shared (no per-instance tint), depthWrite off like targets.
    ghost: new THREE.MeshBasicMaterial({ color: "#7fb8ee", transparent: true, opacity: 0.26, depthWrite: false }),
    // Last-move trace quads (from = cool, to = warm) that fade out over ~1.2 s.
    traceFrom: new THREE.MeshBasicMaterial({ color: "#7fb8ee", transparent: true, opacity: 0.0, depthWrite: false }),
    traceTo: new THREE.MeshBasicMaterial({ color: "#e0a23a", transparent: true, opacity: 0.0, depthWrite: false }),
    // Dark rounded backing the promotion choices float over so they read as a
    // deliberate menu rather than four disconnected pieces. depthTest:false (like the
    // cue placard) so it never z-fights the trace/target overlay quads sharing the
    // cell, and always reads as a clean overlay under the floating choices.
    promoBack: new THREE.MeshBasicMaterial({ color: "#1a120b", transparent: true, opacity: 0.78, depthWrite: false, depthTest: false }),
    invisible: new THREE.MeshBasicMaterial({ visible: false }),
  };

  // Shared misc geometry (highlights + colliders).
  const G = {
    selRing: new THREE.TorusGeometry(STEP * 0.42, STEP * 0.05, 8, 28),
    target: new THREE.CylinderGeometry(STEP * 0.16, STEP * 0.16, STEP * 0.04, 22),
    capRing: new THREE.TorusGeometry(STEP * 0.40, STEP * 0.045, 8, 28),
    hoverRing: new THREE.TorusGeometry(STEP * 0.44, STEP * 0.035, 8, 28),
    ghost: new THREE.CylinderGeometry(STEP * 0.13, STEP * 0.13, STEP * 0.02, 18),
    trace: new THREE.PlaneGeometry(STEP * 0.94, STEP * 0.94),
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
  // `color` orients the knight to face the opponent (white faces -Z, black +Z).
  function makeProceduralPiece(type, mat, color) {
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
      // Face the opponent: white knights look toward -Z (black home), black
      // knights toward +Z. Mirroring per colour (rather than rotating the whole
      // group by PI as the GLB path did) keeps both knights upright and facing
      // across the board correctly from either seat.
      head.rotation.y = color === "black" ? -Math.PI / 2 : Math.PI / 2;
      head.castShadow = true; head.receiveShadow = true;
      g.add(head);
      g.userData.baseGeo = baseGeo;
      g.userData.headGeo = headGeo;
      return g;
    }
    const geo = procGeo[type];
    const mesh = new THREE.Mesh(geo, mat);
    const profH = type === "p" ? 0.86 : type === "r" ? 0.86 : type === "b" ? 0.98 : 1.06;
    // PIECE_HEIGHT[type] is the target height in METRES; profH is the lathe
    // profile-space height. Scale = target / profile (matches the knight path,
    // sc = PIECE_HEIGHT.n / 0.78). The old extra `* STEP` factor shrank every
    // non-knight piece to a ~5 mm flat speck.
    const sc = PIECE_HEIGHT[type] / profH;
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
    // depthTest:false (paired with renderOrder 4 + depthWrite:false) so the
    // placard never z-fights the tray and is never occluded by a tall piece on
    // the home rank from a low seated angle — it always reads as an overlay.
    const cueMat = new THREE.MeshBasicMaterial({ map: cueTex, transparent: true, depthWrite: false, depthTest: false });
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
    // White home is +Z, black home -Z. A SPECTATOR has no colour: branch
    // explicitly to +Z (the standard spectator look direction is down -Z toward
    // +Z's far edge), so "Spectating" sits on a neutral near edge and reads
    // upright from the default canonical spectator camera. (Previously the
    // `white?1:-1` ternary silently pinned the spectator cue to black's edge.)
    const nearZ = myColor === "white" ? 1 : myColor === "black" ? -1 : 1;
    const edgeZ = nearZ * (HALF + FRAME_W + STEP * 0.30);
    cueMesh.position.set(0, TILE_TOP + 0.012, edgeZ + nearZ * STEP * 0.34);
    // The cue is flat on the table (rotation.x = -PI/2) and lives in group-local
    // space alongside its near-edge position, so it turns WITH the per-seat
    // group.rotation.y (no per-frame counter-rotation needed, unlike battleship's
    // upright HUD). For the text to read upright to the LOCAL viewer, its text-top
    // (plane +Y) must point toward the FAR edge (group-local -nearZ), away from the
    // seated player. With rotation.x = -PI/2, text-top maps to group-local
    // (-sin z, 0, -cos z): z = 0 -> -Z, z = PI -> +Z. White home is +Z (nearZ > 0)
    // so its far edge is -Z -> z = 0; black is the inverse. The previous flip was
    // reversed, so text read upside-down from both seats.
    cueMesh.rotation.z = nearZ > 0 ? 0 : Math.PI;

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

    // Two capture trays, one per side. Raise the tray top FLUSH with the frame top
    // (PLANK_TOP + FRAME_H) like checkers' rail so parked prisoners read as seated
    // on a shelf rather than sunk under the plank (the old PLANK_TOP - 0.001 left
    // the tray a dead sliver below the surface). White prisoners rack on +X, black
    // on -X — see railDest().
    G._trayGeo = new THREE.BoxGeometry(STEP * 0.9, 0.006, BOARD_SIZE * 0.92);
    for (const sx of [-1, 1]) {
      const tray = new THREE.Mesh(G._trayGeo, M.tray);
      tray.position.set(sx * TRAY_LANE_X, PLANK_TOP + FRAME_H - 0.003, 0);
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
      if (anyOk && !disposed) { modelsReady = true; repaintForModels(); }
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

  // B6: models resolved. Rebuild the procedural pieces into model pieces, but DEFER
  // while a move animates — repainting mid-glide would orphan the in-flight mover
  // (paint() now skips gliding cells, but the OTHER cells would still swap under a
  // running animation, and the mover itself would stay procedural). Once the board
  // is idle (no glides, not busy), repaint once so the whole army upgrades cleanly.
  let modelRepaintPending = false;
  function repaintForModels() {
    if (disposed) return;
    if (busy || glides.length > 0) {
      if (!modelRepaintPending) {
        modelRepaintPending = true;
        const wait = () => {
          if (disposed) { modelRepaintPending = false; return; }
          if (busy || glides.length > 0) { raf(wait); return; }
          modelRepaintPending = false;
          paint();
        };
        raf(wait);
      }
      return;
    }
    paint();
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
    // Flip black 180° so the two armies face opposite directions (knights then
    // look across at each other rather than both the same way); for symmetric
    // pieces this is purely cosmetic.
    if (color === "black") g.rotation.y = Math.PI;
    return g;
  }

  // Create a piece Group (model clone if ready, else procedural) for (type,color).
  function makePiece(type, color) {
    const mat = (color === "white" ? M.white : M.black).clone();
    let g = null;
    if (modelsReady && modelTemplate[type]) g = makeModelPiece(type, color, mat);
    if (!g) g = makeProceduralPiece(type, mat, color);
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

  // ===========================================================================
  // Capture trays — park a captured piece (shrunk + stood upright) on the side
  // tray for the colour that took it. Mirrors checkers' rails. White captures rack
  // on +X, black captures on -X; a per-colour counter lays them out 2 columns wide,
  // 8 rows deep so all 15 prisoners of one colour fit inside the tray's Z extent.
  // ===========================================================================
  // Resting world-local pose for the `slot`-th prisoner CAPTURED BY `capturedBy`.
  function trayDest(capturedBy, slot) {
    const sx = capturedBy === "white" ? 1 : -1;     // white racks on +X, black on -X
    const col = slot % TRAY_COLS;
    const row = Math.floor(slot / TRAY_COLS);
    const dx = (col === 0 ? -1 : 1) * TRAY_COL_DX;
    // Centre the column of `row`s about z=0; clamp so a long game can't march a
    // prisoner off the tray (extra captures just stack on the last slot).
    const maxRow = 7;
    const z = -maxRow / 2 * TRAY_ROW_DZ + Math.min(row, maxRow) * TRAY_ROW_DZ;
    return { x: sx * TRAY_LANE_X + dx, y: TRAY_TOP, z };
  }

  // Re-home an existing piece mesh onto the tray as a prisoner (used at the glide
  // peak so the captured mesh slides off the board onto the shelf instead of being
  // disposed). `capturedBy` is the colour of the CAPTOR (opposite the victim).
  function parkPrisonerMesh(mesh, victimColor, victimType, capturedBy) {
    const dest = trayDest(capturedBy, trayCount[capturedBy]++);
    mesh.userData.cell = null;                       // off-board: never resolve clicks here
    mesh.rotation.set(0, 0, 0);
    if (mesh.userData.pieceColor === "black") mesh.rotation.y = Math.PI;
    mesh.scale.setScalar(TRAY_SCALE);
    mesh.position.set(dest.x, dest.y, dest.z);
    const mat = mesh.userData.pieceMat;
    if (mat) { mat.transparent = false; mat.opacity = 1; }
    prisoners.push({ mesh, color: victimColor, type: victimType });
  }

  // Drop ALL prisoners (used by applyState / dispose before recomputing the roster).
  function clearPrisoners() {
    for (const p of prisoners) disposePiece(p.mesh);
    prisoners.length = 0;
    trayCount.white = 0;
    trayCount.black = 0;
  }

  // Recompute the prisoner roster from the current board by diffing it against a
  // full 16-piece army, then build fresh prisoner meshes on the trays. Used by
  // applyState so spectators / late-joiners see populated trays even though they
  // never witnessed the captures. Promotions are accounted for: a side's prisoner
  // COUNT is exactly (16 - survivors), and the extra material a promotion creates
  // (e.g. a 2nd queen) cancels one phantom pawn from the deficit, so the displayed
  // prisoners read as genuine losses rather than a spurious "missing pawn".
  function rebuildPrisonersFromBoard() {
    clearPrisoners();
    const FULL = { p: 8, n: 2, b: 2, r: 2, q: 1 };   // king never captured
    for (const color of ["white", "black"]) {
      const live = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const p = state.board[r][c];
          if (p && p.color === color) live[p.type] = (live[p.type] || 0) + 1;
        }
      }
      // Promotion surplus: any non-pawn type above its starting count came from a
      // promoted pawn. That surplus offsets the pawn deficit so we don't park a
      // phantom pawn for a pawn that was actually promoted (not captured).
      let promoSurplus = 0;
      for (const type of ["n", "b", "r", "q"]) {
        promoSurplus += Math.max(0, (live[type] || 0) - FULL[type]);
      }
      const deficit = {
        q: Math.max(0, FULL.q - (live.q || 0)),
        r: Math.max(0, FULL.r - (live.r || 0)),
        b: Math.max(0, FULL.b - (live.b || 0)),
        n: Math.max(0, FULL.n - (live.n || 0)),
        p: Math.max(0, FULL.p - (live.p || 0) - promoSurplus),
      };
      const capturedBy = other(color);               // who took this colour's losses
      // Walk a stable order so the tray layout is deterministic across clients.
      for (const type of ["q", "r", "b", "n", "p"]) {
        for (let i = 0; i < deficit[type]; i++) {
          const mesh = makePiece(type, color);
          mesh.userData.isModel = modelsReady && !!modelTemplate[type];
          group.add(mesh);
          parkPrisonerMesh(mesh, color, type, capturedBy);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Paint: idempotently rebuild the visible pieces from the logical board.
  // -------------------------------------------------------------------------
  function paint() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (paintSkipCell === r * 8 + c) continue;
        const want = state.board[r][c];
        const have = pieceMeshes[r][c];
        // B6: if this cell's mesh is mid-glide (e.g. a deferred modelsReady repaint
        // landed while a move animates), leave it ALONE — disposing/repositioning it
        // would orphan the in-flight glide and pop the piece to its target. It will
        // be reconciled cleanly on the next paint after the glide finishes.
        if (have && isGliding(have)) continue;
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

  // I1: lift + warm-glow the actually-selected piece so the choice reads on the
  // tall back rank, not just via the floor ring. Stored so it can be reset.
  function liftSelectedPiece() {
    dropSelectedPiece();
    if (!selectedFrom) return;
    const p = pieceMeshes[selectedFrom.r][selectedFrom.c];
    if (!p || !p.userData.pieceMat) return;
    // B4 (defensive): only capture the rest baseline when none is already stored, so
    // a double refreshHighlights() (e.g. a stray repaint) can't stack lifts and bake
    // the lifted Y in as the new rest height. If _y0 is still set, this piece is
    // already lifted — just re-tag it as the lifted piece and return.
    if (p.userData._y0 !== undefined) { liftedPiece = p; return; }
    const mat = p.userData.pieceMat;
    p.userData._emR0 = mat.emissive.getHex();
    p.userData._emI0 = mat.emissiveIntensity;
    p.userData._y0 = p.position.y;
    mat.emissive.set("#e0a23a");
    mat.emissiveIntensity = 0.42;
    p.position.y = p.userData._y0 + STEP * 0.06;
    liftedPiece = p;
  }
  function dropSelectedPiece() {
    const p = liftedPiece;
    liftedPiece = null;
    if (!p) return;
    const mat = p.userData.pieceMat;
    if (mat && p.userData._emR0 !== undefined) {
      mat.emissive.setHex(p.userData._emR0);
      mat.emissiveIntensity = p.userData._emI0;
    }
    if (p.userData._y0 !== undefined && !isGliding(p)) p.position.y = p.userData._y0;
    delete p.userData._emR0; delete p.userData._emI0; delete p.userData._y0;
  }
  function isGliding(mesh) {
    for (const a of glides) if (a.mesh === mesh) return true;
    return false;
  }

  function refreshHighlights() {
    clearHighlights();
    if (!myTurnNow() || !selectedFrom) { startLoopIfNeeded(); return; }
    selRingMesh = new THREE.Mesh(G.selRing, M.selRing);
    selRingMesh.rotation.x = Math.PI / 2;
    selRingMesh.position.set(cellX(selectedFrom.c), TILE_TOP + 0.002, cellZ(selectedFrom.r));
    selRingMesh.renderOrder = 2;
    group.add(selRingMesh);
    liftSelectedPiece();

    for (const m of selMoves) {
      const capture = !!state.board[m.to.r][m.to.c] || !!m.flags.ep;
      addTarget(m.to.r, m.to.c, capture);
    }
    refreshHoverRing();
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
    // I8: scale-in from 0 so selecting doesn't pop the markers in.
    t.scale.setScalar(0.01);
    t.userData.appear = 0;
    group.add(t);
    targets.push(t);
  }

  function clearHighlights() {
    for (const t of targets) group.remove(t);
    targets.length = 0;
    if (selRingMesh) { group.remove(selRingMesh); selRingMesh = null; }
    dropSelectedPiece();
    clearHoverRing();
  }

  function clearSelection() { selectedFrom = null; selMoves = []; closePromoPicker(); }

  // ===========================================================================
  // I2: hover affordance. board.js routes throttled cursor cells here on the
  // local player's turn (and clears with -1 off-turn / on leave). We show a faint
  // ring on a hoverable own-piece, or on a legal destination when a piece is
  // selected. Purely additive — never mutates state or the wire.
  // ===========================================================================
  function setHover(cell) {
    let next = null;
    if (cell && Number.isInteger(cell.r) && Number.isInteger(cell.c) && inBounds(cell.r, cell.c)) {
      next = { r: cell.r, c: cell.c };
    }
    if (next && hoverCell && next.r === hoverCell.r && next.c === hoverCell.c) return;
    if (!next && !hoverCell) return;
    hoverCell = next;
    refreshHoverRing();
  }

  function hoverableAt(r, c) {
    if (!myTurnNow() || busy || promoPick) return false;
    // When a piece is selected, a hover on one of its legal destinations is the
    // affordance; otherwise hover an own-piece you could pick up.
    if (selectedFrom) return selMoves.some((m) => m.to.r === r && m.to.c === c);
    const p = state.board[r][c];
    return !!(p && p.color === myColor && legalMovesFrom(state, r, c).length > 0);
  }

  function refreshHoverRing() {
    clearHoverRing();
    if (!hoverCell) return;
    const { r, c } = hoverCell;
    // Don't double-ring the already-selected square.
    if (selectedFrom && selectedFrom.r === r && selectedFrom.c === c) return;
    if (!hoverableAt(r, c)) return;
    hoverRingMesh = new THREE.Mesh(G.hoverRing, M.hover);
    hoverRingMesh.rotation.x = Math.PI / 2;
    hoverRingMesh.position.set(cellX(c), TILE_TOP + 0.0018, cellZ(r));
    hoverRingMesh.renderOrder = 2;
    group.add(hoverRingMesh);
    // I2b: when no piece is committed yet, ghost where the hovered own-piece COULD
    // go so a mouse user can scout before clicking. Dimmer/cooler than the firm
    // selection targets so "scout" never reads the same as "committed". Skipped
    // once a piece is selected (the firm targets already cover that case).
    if (!selectedFrom) {
      for (const m of legalMovesFrom(state, r, c)) {
        addGhost(m.to.r, m.to.c);
      }
    }
    startLoopIfNeeded();
  }

  function addGhost(r, c) {
    const g = new THREE.Mesh(G.ghost, M.ghost);
    g.position.set(cellX(c), TILE_TOP + STEP * 0.10, cellZ(r));
    g.renderOrder = 2;
    group.add(g);
    hoverGhosts.push(g);
  }

  function clearHoverRing() {
    if (hoverRingMesh) { group.remove(hoverRingMesh); hoverRingMesh = null; }
    for (const g of hoverGhosts) group.remove(g);
    hoverGhosts.length = 0;
  }

  // ===========================================================================
  // I5: last-move trace. Two faint tinted quads on the from/to squares that fade
  // out over ~1.2 s, so the waiting player and spectators (who get no turn cue)
  // can see what just happened. Driven from performMove for every move path.
  // ===========================================================================
  function armTrace(from, to) {
    ensureTraceMeshes();
    if (!traceFromMesh) return;
    traceFromMesh.position.set(cellX(from.c), TILE_TOP + 0.0014, cellZ(from.r));
    traceToMesh.position.set(cellX(to.c), TILE_TOP + 0.0016, cellZ(to.r));
    traceFromMesh.visible = traceToMesh.visible = true;
    traceT = 0;
    startLoop();
  }
  function ensureTraceMeshes() {
    if (traceFromMesh || !group) return;
    traceFromMesh = new THREE.Mesh(G.trace, M.traceFrom);
    traceToMesh = new THREE.Mesh(G.trace, M.traceTo);
    for (const t of [traceFromMesh, traceToMesh]) {
      t.rotation.x = -Math.PI / 2;
      t.renderOrder = 1;
      t.visible = false;
      group.add(t);
    }
  }
  function hideTrace() {
    if (traceFromMesh) traceFromMesh.visible = false;
    if (traceToMesh) traceToMesh.visible = false;
  }

  // ===========================================================================
  // Animation loop — gliding mover + idle bob/spin for the target tokens.
  // ===========================================================================
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const raf = (fn) => (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(fn) : setTimeout(() => fn(nowMs()), 16));
  const caf = (id) => (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(id) : clearTimeout(id));
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  function loopActive() {
    return glides.length > 0 || targets.length > 0 || promoChoiceMeshes.length > 0 ||
      fxAnims.length > 0 || checkPulseKing != null || winGlowMeshes.length > 0 ||
      (traceFromMesh && traceFromMesh.visible);
  }
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
    // B3: advance the shared idle clock ONCE per frame; both the target tokens
    // and the promo tokens read it, so coexisting lists never double-step it.
    idleT += dt;

    for (let i = glides.length - 1; i >= 0; i--) {
      const a = glides[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const e = easeInOut(k);
      a.mesh.position.x = a.fromX + (a.toX - a.fromX) * e;
      a.mesh.position.z = a.fromZ + (a.toZ - a.fromZ) * e;
      // Sliding pieces get a whisper of lift mid-glide; knights keep their arc.
      const lift = a.arc ? Math.sin(k * Math.PI) * STEP * 0.35
                         : Math.sin(k * Math.PI) * STEP * 0.05;
      a.mesh.position.y = TILE_TOP + lift;
      if (a.onPeak && !a.peaked && k >= 0.5) { a.peaked = true; a.onPeak(); }
      if (k >= 1) {
        a.mesh.position.set(a.toX, TILE_TOP, a.toZ);
        glides.splice(i, 1);
        if (a.onDone) a.onDone();
      }
    }

    if (targets.length > 0) {
      const bob = Math.sin(idleT * 3.0) * STEP * 0.04;
      for (const t of targets) {
        // I8: ease the scale-in to 1 on appearance.
        if (t.userData.appear < 1) {
          t.userData.appear = Math.min(1, t.userData.appear + dt / 0.12);
          t.scale.setScalar(t.userData.appear);
        }
        t.position.y = t.userData.baseY + bob;
        t.rotation.z = idleT * 1.4;
      }
    }
    if (promoChoiceMeshes.length > 0) {
      for (const t of promoChoiceMeshes) t.rotation.y = idleT * 1.2;
    }

    stepFxAnims(dt);
    stepTrace(dt);
    stepCheckPulse(dt);
    stepWinFlourish(dt);
  }

  // Transient cosmetic animations: capture sink/fade, promotion scale-pop, mate
  // king topple. No per-frame allocation; meshes/materials are reused.
  function stepFxAnims(dt) {
    for (let i = fxAnims.length - 1; i >= 0; i--) {
      const a = fxAnims[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      if (a.kind === "capture") {
        // I4: shrink + sink + fade the doomed mesh, then dispose it.
        const e = easeInOut(k);
        a.mesh.scale.setScalar(a.s0 * (1 - 0.85 * e));
        a.mesh.position.y = a.y0 - e * STEP * 0.5;
        if (a.mat) { a.mat.transparent = true; a.mat.opacity = 1 - e; }
        if (k >= 1) { disposePiece(a.mesh); fxAnims.splice(i, 1); }
      } else if (a.kind === "toTray") {
        // Slide the captured mesh off the board onto the captor's tray, shrinking
        // to TRAY_SCALE on the way, with a small arc so it reads as "swept aside".
        const e = easeInOut(k);
        a.mesh.position.x = a.fromX + (a.toX - a.fromX) * e;
        a.mesh.position.z = a.fromZ + (a.toZ - a.fromZ) * e;
        a.mesh.position.y = a.fromY + (a.toY - a.fromY) * e + Math.sin(k * Math.PI) * STEP * 0.18;
        a.mesh.scale.setScalar(a.s0 + (a.s0 * TRAY_SCALE - a.s0) * e);
        if (k >= 1) {
          fxAnims.splice(i, 1);
          // Finalise: parkPrisonerMesh snaps the exact pose, bumps the slot counter
          // and records the prisoner so applyState/dispose can manage it.
          parkPrisonerMesh(a.mesh, a.victimColor, a.victimType, a.capturedBy);
        }
      } else if (a.kind === "pop") {
        // Promotion settle: overshoot past 1 then ease back (subtle).
        const o = 1 + Math.sin(k * Math.PI) * 0.18;
        a.mesh.scale.setScalar(a.s0 * (k >= 1 ? 1 : o));
        if (k >= 1) { a.mesh.scale.setScalar(a.s0); fxAnims.splice(i, 1); }
      } else if (a.kind === "topple") {
        // Mate: rotate the losing king onto its side and let it settle.
        const e = easeInOut(k);
        a.mesh.rotation.z = e * (Math.PI / 2) * a.dir;
        a.mesh.position.y = TILE_TOP + Math.sin(k * Math.PI) * STEP * 0.04;
        if (k >= 1) { a.mesh.rotation.z = (Math.PI / 2) * a.dir; fxAnims.splice(i, 1); }
      } else {
        fxAnims.splice(i, 1);
      }
    }
  }

  function stepTrace(dt) {
    if (!traceFromMesh || !traceFromMesh.visible) return;
    traceT += dt;
    const k = Math.min(1, traceT / TRACE_DUR);
    // Quick rise, slow fall — pop in then linger then fade.
    const a = k < 0.12 ? (k / 0.12) : (1 - (k - 0.12) / (1 - 0.12));
    const op = Math.max(0, a);
    M.traceFrom.opacity = op * 0.5;
    M.traceTo.opacity = op * 0.62;
    if (k >= 1) hideTrace();
  }

  function stepCheckPulse(dt) {
    if (!checkPulseKing) return;
    const mat = checkPulseKing.userData.pieceMat;
    if (!mat) { checkPulseKing = null; return; }
    checkPulseT += dt;
    const pulse = 0.5 + 0.5 * Math.sin(checkPulseT * 6.0);
    mat.emissive.set("#e0734a");
    mat.emissiveIntensity = 0.25 + pulse * 0.55;
  }

  function animateMove(from, to, isKnight, onDone, onPeak) {
    const mesh = pieceMeshes[to.r][to.c];
    if (!mesh) { if (onDone) onDone(); return; }
    // I7: scale glide time by Chebyshev distance so a queen crossing the board
    // doesn't move as fast as a one-square king step (and short steps aren't
    // sluggish). Knights keep their hop.
    const maxStep = Math.max(Math.abs(to.r - from.r), Math.abs(to.c - from.c));
    const dur = Math.min(0.42, 0.18 + 0.032 * maxStep);
    glides.push({
      mesh, t: 0, dur,
      fromX: cellX(from.c), fromZ: cellZ(from.r),
      toX: cellX(to.c), toZ: cellZ(to.r),
      arc: isKnight, onDone, onPeak, peaked: false,
    });
    startLoop();
  }

  // ===========================================================================
  // performMove — apply a validated legal move. The logical state is the source
  // of truth, but we GLIDE THE ACTUAL moving mesh (not a freshly-spawned one) and
  // keep the captured mesh around to sink/fade it at the glide's peak. We seed the
  // piece ledger before paint() so paint() leaves the mover/victim alone and only
  // rebuilds the rest (castled rook, en-passant square, promotion swap).
  // ===========================================================================
  function performMove(move) {
    const movingPiece = state.board[move.from.r][move.from.c];
    const isKnight = movingPiece && movingPiece.type === "n";
    const movingColor = movingPiece && movingPiece.color;
    const isPromo = !!move.flags.promo;

    // Grab the real meshes BEFORE state advances.
    const mover = pieceMeshes[move.from.r][move.from.c];
    let captured = null, capR = -1, capC = -1;
    if (move.flags.ep) {
      capR = move.flags.ep.r; capC = move.flags.ep.c;
    } else if (state.board[move.to.r][move.to.c]) {
      capR = move.to.r; capC = move.to.c;
    }
    if (capR >= 0) captured = pieceMeshes[capR][capC];
    // Record the victim's identity (board still pre-move here) so the glide peak
    // can park it on the captor's tray as a prisoner.
    const victim = capR >= 0 && state.board[capR][capC]
      ? { color: state.board[capR][capC].color, type: state.board[capR][capC].type }
      : null;

    state = applyMoveToState(state, move);

    busy = true;
    clearSelection();
    clearHighlights();

    // B1/B2: seed the ledger so paint() doesn't recreate the mover, and so the
    // victim's square (the `to` cell for a normal capture) isn't re-diffed into a
    // brand-new mesh on top of the one we're animating. The mover is now logically
    // at `to`; reparent it there in the ledger and free its old square.
    if (mover) {
      pieceMeshes[move.from.r][move.from.c] = null;
      pieceMeshes[move.to.r][move.to.c] = mover;
      mover.userData.cell = { r: move.to.r, c: move.to.c };
    }
    // Detach the captured mesh from the ledger so paint() won't dispose it now —
    // we sink+fade it at the glide peak instead (I4).
    if (captured) pieceMeshes[capR][capC] = null;

    // For a promotion the gliding mesh is still the pawn; tell paint() to leave
    // the destination cell alone so it doesn't dispose the pawn under us. We swap
    // to the promoted mesh after the glide (onDone).
    paintSkipCell = (isPromo && mover) ? move.to.r * 8 + move.to.c : -1;
    paint(); // rebuilds rook on castle, en-passant square, everything but mover/victim
    paintSkipCell = -1;

    // I5: trace the move so the waiting player + spectators can read it. Stash it
    // into lastMove so snapshot() can carry it to converged viewers.
    lastMove = { from: { r: move.from.r, c: move.from.c }, to: { r: move.to.r, c: move.to.c } };
    armTrace(move.from, move.to);

    const onPeak = () => {
      if (captured && victim) {
        // Park the captured mesh on the captor's tray instead of disposing it: the
        // "toTray" fxAnim sinks it briefly, then slides + shrinks it onto the shelf
        // and finalises via parkPrisonerMesh (so it survives in `prisoners`).
        const capturedBy = other(victim.color);
        const dest = trayDest(capturedBy, trayCount[capturedBy]); // peek; counter bumped on land
        fxAnims.push({
          kind: "toTray", mesh: captured,
          t: 0, dur: 0.34,
          s0: captured.scale.x || 1,
          fromX: captured.position.x, fromY: captured.position.y, fromZ: captured.position.z,
          toX: dest.x, toY: dest.y, toZ: dest.z,
          victimColor: victim.color, victimType: victim.type, capturedBy,
        });
        captured = null;
        startLoop();
      } else if (captured) {
        // No recorded victim (defensive) — fall back to the old sink+fade dispose.
        const mat = captured.userData.pieceMat;
        if (mat) { mat.transparent = true; mat.needsUpdate = true; }
        fxAnims.push({
          kind: "capture", mesh: captured, mat,
          t: 0, dur: 0.16, s0: captured.scale.x || 1, y0: captured.position.y,
        });
        captured = null;
        startLoop();
      }
    };
    const onDone = () => {
      // Promotion: swap the pawn mesh for the promoted type with a scale-pop.
      if (isPromo && mover) {
        const newMesh = makePiece(move.flags.promo, movingColor);
        newMesh.userData.isModel = modelsReady && !!modelTemplate[move.flags.promo];
        newMesh.position.set(cellX(move.to.c), TILE_TOP, cellZ(move.to.r));
        newMesh.userData.cell = { r: move.to.r, c: move.to.c };
        group.add(newMesh);
        if (pieceMeshes[move.to.r][move.to.c] === mover) pieceMeshes[move.to.r][move.to.c] = newMesh;
        disposePiece(mover);
        const s0 = newMesh.scale.x || 1;
        newMesh.scale.setScalar(s0 * 0.4);
        fxAnims.push({ kind: "pop", mesh: newMesh, t: 0, dur: 0.22, s0 });
        startLoop();
      }
      busy = false;
    };

    if (mover) {
      animateMove(move.from, move.to, isKnight, onDone, captured ? onPeak : null);
    } else {
      // No mover mesh (shouldn't happen in normal play) — still resolve cleanly.
      if (captured) onPeak();
      onDone();
    }
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
      mateFlourish(state.turn); // topple the mated king (state.turn = loser)
      startWinFlourish(winner); // victory breathe on the surviving winning army
      try { ctx.onGameOver?.({ winner, reason: "checkmate" }); } catch { /* */ }
      return;
    }
    if (status === "stalemate") {
      phase = "over";
      winner = null;
      clearSelection(); clearHighlights();
      updateIdentityCue();
      clearCheckPulse();
      try { ctx.onGameOver?.({ winner: null, reason: "stalemate" }); } catch { /* */ }
      return;
    }
    // I3: pulse the king of the side now in check (or clear if no check).
    updateCheckFlourish(status === "check");
    updateIdentityCue();
    refreshHighlights();
  }

  // I3: drive the in-check king's red emissive pulse. `inCheckNow` => start/keep
  // pulsing the side-to-move's king; otherwise restore its material.
  function updateCheckFlourish(inCheckNow) {
    clearCheckPulse();
    if (!inCheckNow) return;
    const k = findKing(state.board, state.turn);
    if (!k) return;
    const km = pieceMeshes[k.r][k.c];
    if (!km || !km.userData.pieceMat) return;
    const mat = km.userData.pieceMat;
    km.userData._ckR0 = mat.emissive.getHex();
    km.userData._ckI0 = mat.emissiveIntensity;
    checkPulseKing = km;
    checkPulseT = 0;
    startLoop();
  }
  function clearCheckPulse() {
    const km = checkPulseKing;
    checkPulseKing = null;
    if (!km || !km.userData.pieceMat) return;
    const mat = km.userData.pieceMat;
    if (km.userData._ckR0 !== undefined) {
      mat.emissive.setHex(km.userData._ckR0);
      mat.emissiveIntensity = km.userData._ckI0;
      delete km.userData._ckR0; delete km.userData._ckI0;
    }
  }

  // Checkmate flourish: settle the losing king onto its side, no rule effect.
  function mateFlourish(loserColor) {
    clearCheckPulse();
    const k = findKing(state.board, loserColor);
    if (!k) return;
    const km = pieceMeshes[k.r][k.c];
    if (!km) return;
    // Topple toward +X (a stable, board-bounded direction); reuse fxAnims.
    fxAnims.push({ kind: "topple", mesh: km, t: 0, dur: 0.5, dir: 1 });
    startLoop();
  }

  // ===========================================================================
  // Win flourish — a gentle gold "victory breathe" on every surviving piece of
  // the WINNING army, plus a celebratory pulse recolour of the local home rail when
  // the local player won. Purely cosmetic; driven by stepWinFlourish from the loop
  // and re-derivable in applyState so a late-join sees the end-state styling.
  // ===========================================================================
  function startWinFlourish(winColor) {
    clearWinFlourish();
    if (!winColor) return;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const m = pieceMeshes[r][c];
        if (!m || m.userData.pieceColor !== winColor || !m.userData.pieceMat) continue;
        const mat = m.userData.pieceMat;
        // Stash the resting emissive so it can be restored if the game restarts via
        // a fresh applyState. (clearWinFlourish reads these back.)
        m.userData._wfR0 = mat.emissive.getHex();
        m.userData._wfI0 = mat.emissiveIntensity;
        winGlowMeshes.push(m);
      }
    }
    winFlourishT = 0;
    startLoop();
  }

  function stepWinFlourish(dt) {
    if (winGlowMeshes.length === 0) return;
    winFlourishT += dt;
    const pulse = 0.5 + 0.5 * Math.sin(winFlourishT * 3.2);
    for (const m of winGlowMeshes) {
      const mat = m.userData.pieceMat;
      if (!mat) continue;
      mat.emissive.set("#e0a23a");
      mat.emissiveIntensity = 0.22 + pulse * 0.5;
    }
  }

  function clearWinFlourish() {
    for (const m of winGlowMeshes) {
      const mat = m.userData.pieceMat;
      if (mat && m.userData._wfR0 !== undefined) {
        mat.emissive.setHex(m.userData._wfR0);
        mat.emissiveIntensity = m.userData._wfI0;
      }
      delete m.userData._wfR0; delete m.userData._wfI0;
    }
    winGlowMeshes.length = 0;
    winFlourishT = 0;
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
    // While the promotion picker is open, route clicks to it first: a click on a
    // choice token commits that promotion; any other click cancels the picker.
    if (promoPick) {
      const chosen = pickPromoChoiceFromHit(hit);
      if (chosen && promoPick.moves[chosen]) {
        const move = promoPick.moves[chosen];
        closePromoPicker();
        commitMove(move);
        return;
      }
      closePromoPicker();
      // Fall through so the same click can (re)select another piece.
    }

    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.r) || !Number.isInteger(cell.c)) return;
    const { r, c } = cell;
    if (!inBounds(r, c)) return;

    if (selectedFrom) {
      const move = selMoves.find((m) => m.to.r === r && m.to.c === c);
      if (move) {
        if (move.flags.promoOptions) { openPromoPicker(move); return; }
        commitMove(move);
        return;
      }
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

  // Collapse the four promotion moves per destination into a SINGLE selectable
  // target (the queen, kept as the representative) so each promotion square shows
  // one marker. The representative is tagged with the full set of promotion
  // options so onPointer can open the under-promotion picker on click instead of
  // silently auto-queening. Non-promotion moves pass through unchanged.
  function dedupePromotions(moves) {
    const seen = new Set();
    const out = [];
    for (const m of moves) {
      if (!m.flags.promo) { out.push(m); continue; }
      const key = m.to.r * 8 + m.to.c;
      if (seen.has(key)) continue;
      seen.add(key);
      // Gather all four promotion variants targeting this destination.
      const options = {};
      for (const o of moves) {
        if (o.flags.promo && o.to.r === m.to.r && o.to.c === m.to.c) {
          options[o.flags.promo] = o;
        }
      }
      // Representative = queen (default); carry the full option set for the UI.
      const rep = options.q || m;
      out.push({ ...rep, flags: { ...rep.flags, promoOptions: options } });
    }
    return out;
  }

  // ---- Promotion picker UI -------------------------------------------------
  // Float the four promotion choices (queen, rook, bishop, knight) above the
  // destination square as small selectable pieces in the local colour; clicking
  // one commits that promotion. Auto-queen is no longer forced — under-promotion
  // is reachable here.
  const PROMO_ORDER = ["q", "r", "b", "n"];

  function openPromoPicker(move) {
    closePromoPicker();
    const options = move.flags.promoOptions || {};
    promoPick = { to: { r: move.to.r, c: move.to.c }, moves: {} };
    // Keep the selection ring + (now redundant) targets out of the way.
    clearHighlights();
    const baseX = cellX(move.to.c);
    const baseZ = cellZ(move.to.r);
    // B4: lower the floating row so it reads as anchored to the board from a
    // seated angle, and give it a dark backing quad so the four choices read as
    // a deliberate menu, not disconnected pieces.
    const lift = TILE_TOP + STEP * 0.8;
    const spread = STEP * 0.92;
    const count = PROMO_ORDER.filter((p) => options[p]).length || 1;

    // Backing quad, flat just above the board under the row centre.
    promoBackMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(spread * count + STEP * 0.5, STEP * 0.9),
      M.promoBack
    );
    promoBackMesh.rotation.x = -Math.PI / 2;
    // Lift clear of the trace/target overlay quads (which sit at TILE_TOP + ~0.002);
    // paired with depthTest:false + renderOrder 4 the backing never z-fights them.
    promoBackMesh.position.set(baseX, TILE_TOP + 0.012, baseZ);
    promoBackMesh.renderOrder = 4;
    group.add(promoBackMesh);

    let slot = 0;
    for (let i = 0; i < PROMO_ORDER.length; i++) {
      const promo = PROMO_ORDER[i];
      const m = options[promo];
      if (!m) continue;
      promoPick.moves[promo] = m;
      // B4: use makePiece so the choices match the board pieces (model when
      // loaded, procedural fallback otherwise) instead of always-procedural.
      const token = makePiece(promo, myColor);
      token.scale.multiplyScalar(0.62);
      // I9: tint the queen brightest so "which is which" reads at a glance.
      const em = token.userData.pieceMat;
      if (em) { em.emissive.set(promo === "q" ? "#e0a23a" : "#5a4a30"); em.emissiveIntensity = promo === "q" ? 0.4 : 0.15; }
      const dx = (slot - (count - 1) / 2) * spread;
      slot++;
      token.position.set(baseX + dx, lift, baseZ);
      token.userData.promoChoice = promo;
      // Tag every submesh so a raycast hit on any part resolves the choice.
      token.traverse((o) => { if (o.isMesh) o.userData.promoChoice = promo; });
      token.renderOrder = 5;
      group.add(token);
      promoChoiceMeshes.push(token);
    }
    startLoop();
  }

  function closePromoPicker() {
    if (promoBackMesh) { group.remove(promoBackMesh); promoBackMesh.geometry?.dispose?.(); promoBackMesh = null; }
    if (!promoPick) {
      for (const t of promoChoiceMeshes) disposePiece(t);
      promoChoiceMeshes.length = 0;
      return;
    }
    promoPick = null;
    for (const t of promoChoiceMeshes) disposePiece(t);
    promoChoiceMeshes.length = 0;
  }

  // Resolve a raycast hit to a promotion choice ('q'|'r'|'b'|'n') or null.
  function pickPromoChoiceFromHit(hit) {
    let o = hit && hit.object;
    while (o) {
      if (o.userData && o.userData.promoChoice) return o.userData.promoChoice;
      o = o.parent;
    }
    return null;
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
      // Pure-cosmetic derived data so a snapshot-converged viewer (spectator /
      // late-join) can re-arm the last-move trace. Wire-safe: ignored by decode.
      lastMove: lastMove
        ? { from: { r: lastMove.from.r, c: lastMove.from.c }, to: { r: lastMove.to.r, c: lastMove.to.c } }
        : null,
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
    clearWinFlourish();
    // Drop any transient cosmetic anim that references meshes paint() may dispose.
    clearTransientFx();

    let lm = null;
    if (!incoming) {
      state = initialState();
      phase = "play";
      winner = null;
    } else {
      state = decodeState(incoming);
      phase = incoming.phase === "over" ? "over" : "play";
      winner = incoming.winner === "white" || incoming.winner === "black" ? incoming.winner : null;
      const m = incoming.lastMove;
      if (m && m.from && m.to &&
        Number.isInteger(m.from.r) && Number.isInteger(m.from.c) &&
        Number.isInteger(m.to.r) && Number.isInteger(m.to.c) &&
        inBounds(m.from.r, m.from.c) && inBounds(m.to.r, m.to.c)) {
        lm = { from: { r: m.from.r, c: m.from.c }, to: { r: m.to.r, c: m.to.c } };
      }
    }
    lastMove = lm;
    updateIdentityCue();
    paint();
    // Populate the capture trays by diffing the rebuilt board against a full army,
    // so spectators / late-joiners see the prisoners even though they never saw the
    // captures happen.
    rebuildPrisonersFromBoard();
    // Re-arm the last-move trace so a converged viewer sees what just happened.
    if (lastMove) armTrace(lastMove.from, lastMove.to);
    // Re-derive the in-check pulse from the rebuilt position so a snapshot that
    // lands mid-check still shows the cue (spectators/late-join). On game over we
    // leave the king upright — applyState has no per-move topple context.
    if (phase === "play") updateCheckFlourish(inCheck(state.board, state.turn));
    // Re-derive the victory styling on a snapshot that lands already over.
    else if (winner) startWinFlourish(winner);
  }

  // Stop & detach transient cosmetic animations without restoring materials of
  // meshes that are about to be disposed (paint rebuilds them). Used by applyState
  // and dispose so we never poke a freed mesh.
  function clearTransientFx() {
    // Dispose any mesh still mid-flight in an fxAnim so it isn't orphaned in the
    // group (capture sink, toTray slide, promotion pop). The promoted "pop" mesh is
    // a live board piece tracked by pieceMeshes, so paint() owns it — leave it.
    for (const a of fxAnims) {
      if (a.kind === "capture" || a.kind === "toTray") disposePiece(a.mesh);
    }
    fxAnims.length = 0;
    checkPulseKing = null;
    hideTrace();
    traceT = TRACE_DUR;
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
    hoverCell = null;
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
    clearWinFlourish();
    clearTransientFx();
    if (traceFromMesh) { group.remove(traceFromMesh); traceFromMesh = null; }
    if (traceToMesh) { group.remove(traceToMesh); traceToMesh = null; }
    closePromoPicker();
    clearHighlights();
    clearPrisoners();
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
    setHover,
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
