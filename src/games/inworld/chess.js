// Chess (full FIDE rules, 8x8) — in-world 3D table game module.
//
// A COMPLETE, self-contained ES module implementing the createGame() contract
// documented in ./createGame.js. The framework (board.js -> InWorldBoard) owns
// the café table, the WebSocket relay, role/turn gating and spectator read-only
// mode; THIS module owns ONLY the rules, the 3D geometry (real meshes parented to
// the café table) and per-cell hit-testing.
//
//   import { createGame } from "../inworld/chess.js";
//   const instance = createGame(ctx);   // InWorldBoard.mount() does this
//
// ===========================================================================
// DESIGN
//
//   * WHITE = host, moves first. BLACK = guest. Spectators may never move.
//   * FULL LEGAL CHESS: every piece's geometry, check/checkmate/stalemate,
//     castling (both sides, with all the "not through/into check, empty path,
//     unmoved king+rook" constraints), en passant, and promotion (auto-queen).
//   * STRICT TURN ENFORCEMENT via ctx.isLocalTurnAllowed(): onPointer is inert
//     for spectators and the off-turn player.
//   * HOST-AUTHORITATIVE: after every committed move the host pushes a full
//     net.sendState(snapshot). applyState() does an IDEMPOTENT rebuild from a
//     snapshot (FEN-like board + side + castling + en-passant target). applyMove()
//     applies ONE relayed delta, trusting only (from,to,promotion) and re-deriving
//     legality locally — an illegal/unmatched relay throws GameDesync, the
//     contract's explicit resync signal.
//
// WIRE FORMAT:
//   move:  { type:"move", from:{r,c}, to:{r,c}, promo?:"q"|"r"|"b"|"n" }
//   state: { board:[8][8 of piece|null], turn, castling, ep, phase, winner, ... }
//          where a piece is { color:"white"|"black", type:"p"|"n"|"b"|"r"|"q"|"k" }
//
// 3D ASSETS
//   Real binary glTF (GLB) chess models live under public/models/chess/ (by Jarlan
//   Perez, CC BY 3.0, via Poly Pizza). We load the six per-piece GLBs with
//   GLTFLoader, normalise each to a target height, recolour into a white/black set
//   and CLONE one instance per board piece. Model loading is async and never blocks
//   the mount: PROCEDURAL pieces (LatheGeometry surfaces of revolution + a stylized
//   knight) render immediately and are swapped for the GLB clones once they resolve.
//   If a model fails (or never loads) the procedural pieces remain, so chess ALWAYS
//   works. Attribution is exposed on the returned instance + group.userData.
//
// Coordinate convention matches createGame.js cellCenter()/hitToCell(): col -> local
// X, row -> local Z, canonical row 0 at -Z. White pieces start on rows 6-7 (near the
// host's -Z... actually rows 0-1 vs 6-7 below) — see initialBoard().

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
// PURE RULES — fully self-contained, transport-free. Board frame:
//   board[r][c] = null | { color:"white"|"black", type:"p"|"n"|"b"|"r"|"q"|"k" }
//   r=0 is the -Z edge, r=7 the +Z edge. Black home rows are 0/1, white home rows
//   are 6/7, so white pawns march toward row 0 (dr = -1) and black toward row 7.
// ===========================================================================
const N = 8;
export const other = (c) => (c === "white" ? "black" : "white");
const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const eqSq = (a, b) => !!a && !!b && a.r === b.r && a.c === b.c;
const PAWN_DIR = { white: -1, black: 1 };   // forward row delta
const PROMO_ROW = { white: 0, black: 7 };   // pawn promotes on reaching this row
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

// Fresh, default game state.
export function initialState() {
  return {
    board: initialBoard(),
    turn: "white",
    castling: { white: { k: true, q: true }, black: { k: true, q: true } },
    ep: null, // en-passant TARGET square {r,c} (the square a pawn skipped over), or null
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

// Is square (r,c) attacked by `byColor` on this board? (Ignores en-passant and
// castling — those never deliver check; pawn ATTACK squares are the diagonals.)
export function isAttacked(board, r, c, byColor) {
  // Pawns: a `byColor` pawn attacks the square in FRONT of it (toward its dir), so
  // it attacks (r,c) if it sits one row back-against-its-dir on an adjacent file.
  const pdr = PAWN_DIR[byColor];
  for (const dc of [-1, 1]) {
    const pr = r - pdr, pc = c - dc;
    if (inBounds(pr, pc)) {
      const p = board[pr][pc];
      if (p && p.color === byColor && p.type === "p") return true;
    }
  }
  // Knights
  for (const [dr, dc] of KNIGHT_DELTAS) {
    const rr = r + dr, cc = c + dc;
    if (inBounds(rr, cc)) {
      const p = board[rr][cc];
      if (p && p.color === byColor && p.type === "n") return true;
    }
  }
  // King (adjacent)
  for (const [dr, dc] of KING_DELTAS) {
    const rr = r + dr, cc = c + dc;
    if (inBounds(rr, cc)) {
      const p = board[rr][cc];
      if (p && p.color === byColor && p.type === "k") return true;
    }
  }
  // Sliders: bishop/queen on diagonals, rook/queen on orthogonals.
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

// PSEUDO-LEGAL moves for the piece at (r,c) — does NOT filter out moves that leave
// the mover in check (that filtering happens in legalMoves). Each move is
// { from, to, flags } where flags may carry { ep, castle, double, promo }.
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
    // Forward 1 (no capture)
    if (inBounds(fr, c) && !board[fr][c]) {
      pawnPush(out, r, c, fr, c, color);
      // Forward 2 from home row
      const fr2 = r + 2 * dir;
      if (r === HOME_PAWN_ROW[color] && !board[fr2][c]) {
        push(fr2, c, { double: true });
      }
    }
    // Captures (incl. en passant)
    for (const dc of [-1, 1]) {
      const tc = c + dc;
      if (!inBounds(fr, tc)) continue;
      const target = board[fr][tc];
      if (target && target.color === enemy) {
        pawnPush(out, r, c, fr, tc, color);
      } else if (state.ep && state.ep.r === fr && state.ep.c === tc) {
        // En passant: the captured pawn sits beside the mover (on row r, file tc).
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
    // Castling (king on home square, rights intact, path empty, not through check).
    addCastles(state, r, c, color, push);
    return out;
  }

  // Sliders
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

// Emit a pawn forward/capture move, expanding to four promotion moves on the last
// rank (auto-queen is the default chosen at commit, but we enumerate all so a
// relayed promo of any piece validates).
function pawnPush(out, r, c, tr, tc, color) {
  if (tr === PROMO_ROW[color]) {
    for (const promo of ["q", "r", "b", "n"]) {
      out.push({ from: { r, c }, to: { r: tr, c: tc }, flags: { promo } });
    }
  } else {
    out.push({ from: { r, c }, to: { r: tr, c: tc }, flags: {} });
  }
}

// Castling moves for the king at (r,c). Requires: right intact, king on its home
// square, rook present on its home square, all squares between empty, king not
// currently in check and not passing through / landing on an attacked square.
function addCastles(state, r, c, color, push) {
  const board = state.board;
  const homeRow = color === "white" ? 7 : 0;
  if (r !== homeRow || c !== 4) return;
  const rights = state.castling[color];
  if (!rights) return;
  const enemy = other(color);
  if (isAttacked(board, r, 4, enemy)) return; // can't castle out of check
  // King-side: rook on (homeRow,7), squares 5 & 6 empty, 5 & 6 not attacked.
  if (rights.k) {
    const rook = board[homeRow][7];
    if (rook && rook.color === color && rook.type === "r" &&
      !board[homeRow][5] && !board[homeRow][6] &&
      !isAttacked(board, homeRow, 5, enemy) && !isAttacked(board, homeRow, 6, enemy)) {
      push(homeRow, 6, { castle: "k" });
    }
  }
  // Queen-side: rook on (homeRow,0), squares 1,2,3 empty, 3 & 2 not attacked
  // (b1/b8 only needs to be empty, not safe).
  if (rights.q) {
    const rook = board[homeRow][0];
    if (rook && rook.color === color && rook.type === "r" &&
      !board[homeRow][1] && !board[homeRow][2] && !board[homeRow][3] &&
      !isAttacked(board, homeRow, 3, enemy) && !isAttacked(board, homeRow, 2, enemy)) {
      push(homeRow, 2, { castle: "q" });
    }
  }
}

// Apply a pseudo-legal move to a CLONED next state (board + castling + ep), without
// any legality (check) filtering. Returns the new state object. Pure.
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

  // En-passant capture removes the pawn beside the mover.
  if (flags.ep) board[flags.ep.r][flags.ep.c] = null;

  // Move the piece.
  board[from.r][from.c] = null;
  let moved = { color, type: piece.type };

  // Promotion.
  if (flags.promo) moved = { color, type: flags.promo };
  board[to.r][to.c] = moved;

  // Castling: also slide the rook.
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

  // Double pawn push sets the en-passant target (the skipped-over square).
  if (flags.double) ep = { r: (from.r + to.r) / 2, c: from.c };

  // Update castling rights: king or rook leaving home, or a rook being captured.
  if (piece.type === "k") { castling[color].k = false; castling[color].q = false; }
  if (piece.type === "r") {
    const homeRow = color === "white" ? 7 : 0;
    if (from.r === homeRow && from.c === 0) castling[color].q = false;
    if (from.r === homeRow && from.c === 7) castling[color].k = false;
  }
  // A rook captured on its home square also voids that side's right.
  const wHome = 7, bHome = 0;
  if (to.r === wHome && to.c === 0) castling.white.q = false;
  if (to.r === wHome && to.c === 7) castling.white.k = false;
  if (to.r === bHome && to.c === 0) castling.black.q = false;
  if (to.r === bHome && to.c === 7) castling.black.k = false;

  return { board, turn: other(color), castling, ep };
}

// All FULLY LEGAL moves for the side to move: pseudo-legal moves filtered so the
// mover is not left in check.
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

// Game status for the side to move on this state.
//   "checkmate" | "stalemate" | "check" | "ongoing"
export function gameStatus(state) {
  const moves = legalMoves(state, state.turn);
  if (moves.length > 0) return inCheck(state.board, state.turn) ? "check" : "ongoing";
  return inCheck(state.board, state.turn) ? "checkmate" : "stalemate";
}

// Anti-cheat: accept a relayed move only if it matches a legal move for the side to
// move on (from,to) [+ promo if given]. Returns the canonical legal move (with our
// trusted flags) or null. Auto-queen default when no promo specified on a promotion.
export function matchLegalMove(state, msg) {
  if (!msg || !msg.from || !msg.to) return null;
  const candidates = legalMoves(state, state.turn).filter(
    (m) => eqSq(m.from, msg.from) && eqSq(m.to, msg.to)
  );
  if (candidates.length === 0) return null;
  // Multiple candidates only happen on a promotion (q/r/b/n). Pick by msg.promo, or
  // default to queen.
  if (candidates.length === 1) return candidates[0];
  const want = msg.promo || "q";
  return candidates.find((m) => m.flags.promo === want) || candidates.find((m) => m.flags.promo === "q") || candidates[0];
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
const TILE_TOP = PLANK_TOP + TILE_T;        // pieces rest here

// Per-type target height (metres) so the set reads in proportion on the cell.
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

  // ---- Game state ---------------------------------------------------------
  let state = initialState();      // { board, turn, castling, ep }
  let phase = "play";              // "play" | "over"
  let winner = null;               // "white" | "black" | null (draw)

  let role = ctx.role;
  let seatRy = ctx.seatRy;
  // White = host (moves first), black = guest. Spectators get null.
  let myColor = role === "host" ? "white" : role === "guest" ? "black" : null;

  // ---- Orientation --------------------------------------------------------
  // The logical board is authored in ONE canonical frame: black home on rows 0/1
  // (the -Z edge), white home on rows 6/7 (the +Z edge). The framework's default
  // "flat" policy would rotate our group by orientFor(seatRy) — which brings the
  // canonical -Z edge to WHOEVER is looking, so BOTH players would see the same
  // colour nearest them. Chess instead needs each player to see THEIR OWN army on
  // the near edge. So we declare orientPolicy:"self" (board.js then does NOT rotate
  // the group) and rotate the whole group ourselves by
  //   orientFor(seatRy) + (myColor === "white" ? PI : 0)
  // orientFor(seatRy) brings the -Z (black) edge to the local seat; the extra PI
  // for white flips the board so the +Z (white) edge comes near instead. Result:
  // the host (white) sees white nearest, the guest (black) sees black nearest, and
  // each sees the opponent across the table — consistent OPPOSITE identities.
  // Spectators (myColor null, seatRy null) get the canonical orientation (0).
  // hitToCell is irrelevant here: clicks resolve through per-square colliders that
  // carry their canonical {r,c} and rotate WITH the group, so any rotation is
  // self-correcting and the clicked square is always the canonical one.
  function applyFacing() {
    const extra = myColor === "white" ? Math.PI : 0;
    group.rotation.y = orientFor(seatRy) + extra;
  }
  applyFacing();

  // ---- Selection (seated local player on their turn only) -----------------
  let selectedFrom = null;         // {r,c} of the picked piece
  let selMoves = [];               // legal moves from the selected square

  let busy = false;                // true while a move animates
  let disposed = false;

  // ===========================================================================
  // Materials + shared geometry. Pieces clone a per-colour material so selection
  // emissive is independent. Palette follows the wooden board tokens.
  // ===========================================================================
  const M = {
    frame: new THREE.MeshStandardMaterial({ color: "#4a311c", roughness: 0.66, metalness: 0.06 }),
    plank: new THREE.MeshStandardMaterial({ color: "#3a281a", roughness: 0.74, metalness: 0.04 }),
    dark: new THREE.MeshStandardMaterial({ color: "#7a4a25", roughness: 0.8, metalness: 0.03 }),
    light: new THREE.MeshStandardMaterial({ color: "#e8d2ab", roughness: 0.84, metalness: 0.02 }),
    tray: new THREE.MeshStandardMaterial({ color: "#2c1d11", roughness: 0.9, metalness: 0.03 }),
    // White/black piece sets (tinted ivory / charcoal). Cloned per piece.
    white: new THREE.MeshStandardMaterial({ color: "#efe7d2", roughness: 0.5, metalness: 0.08, emissive: "#000000" }),
    black: new THREE.MeshStandardMaterial({ color: "#2b2622", roughness: 0.55, metalness: 0.1, emissive: "#000000" }),
    selRing: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.34, metalness: 0.5, emissive: "#e0a23a", emissiveIntensity: 0.5, transparent: true, opacity: 0.92 }),
    target: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.3, emissive: "#e0a23a", emissiveIntensity: 0.55, transparent: true, opacity: 0.62, depthWrite: false }),
    capTarget: new THREE.MeshStandardMaterial({ color: "#e05a3a", roughness: 0.3, metalness: 0.3, emissive: "#e05a3a", emissiveIntensity: 0.6, transparent: true, opacity: 0.5, depthWrite: false }),
    invisible: new THREE.MeshBasicMaterial({ visible: false }),
  };
  const GLOW = new THREE.Color("#e0a23a");

  // Shared misc geometry (highlights + colliders).
  const G = {
    selRing: new THREE.TorusGeometry(STEP * 0.42, STEP * 0.05, 8, 28),
    target: new THREE.CylinderGeometry(STEP * 0.16, STEP * 0.16, STEP * 0.04, 22),
    capRing: new THREE.TorusGeometry(STEP * 0.40, STEP * 0.045, 8, 28),
    hit: new THREE.BoxGeometry(STEP * 0.98, PIECE_HEIGHT.k * 1.4, STEP * 0.98),
  };

  // ---------------------------------------------------------------------------
  // Procedural piece geometry (surfaces of revolution + stylized knight). Cached
  // per type; built once, disposed at the end. These are the IMMEDIATE pieces and
  // the permanent fallback if GLB loading fails.
  // ---------------------------------------------------------------------------
  const procGeo = buildProceduralGeometry();
  // GLB-derived normalized geometries/groups per type, filled in async. null until
  // (and unless) the model resolves.
  const modelTemplate = { p: null, n: null, b: null, r: null, q: null, k: null };
  let modelsReady = false;

  function buildProceduralGeometry() {
    const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
    const out = {};
    // Each profile is [radius, y] from base (y=0) upward, scaled to PIECE_HEIGHT.
    // Pawn: rounded base, slim stem, ball head.
    out.p = lathe([
      [0.0, 0], [0.30, 0], [0.30, 0.06], [0.16, 0.12], [0.13, 0.45],
      [0.20, 0.55], [0.13, 0.6], [0.20, 0.66], [0.20, 0.72], [0.0, 0.86],
    ]);
    // Rook: cylindrical body with a flared top (crenellations approximated by a ring).
    out.r = lathe([
      [0.0, 0], [0.34, 0], [0.34, 0.08], [0.24, 0.14], [0.24, 0.6],
      [0.30, 0.68], [0.34, 0.72], [0.34, 0.86], [0.22, 0.86], [0.22, 0.74], [0.0, 0.74],
    ]);
    // Bishop: tapered body with a slit head + topknot.
    out.b = lathe([
      [0.0, 0], [0.32, 0], [0.32, 0.07], [0.18, 0.13], [0.15, 0.5],
      [0.22, 0.58], [0.10, 0.64], [0.14, 0.74], [0.07, 0.84], [0.10, 0.9], [0.0, 0.98],
    ]);
    // Queen: tall flared body + crown ring + finial.
    out.q = lathe([
      [0.0, 0], [0.36, 0], [0.36, 0.08], [0.20, 0.15], [0.16, 0.55],
      [0.26, 0.66], [0.30, 0.74], [0.14, 0.8], [0.18, 0.88], [0.08, 0.94], [0.10, 0.98], [0.0, 1.04],
    ]);
    // King: like queen but taller with a cross finial (cross added as mesh).
    out.k = lathe([
      [0.0, 0], [0.36, 0], [0.36, 0.08], [0.20, 0.15], [0.16, 0.58],
      [0.27, 0.69], [0.31, 0.78], [0.15, 0.84], [0.18, 0.92], [0.10, 0.98], [0.12, 1.02], [0.0, 1.06],
    ]);
    // Knight handled specially (extruded silhouette) — store a flag.
    out.n = null;
    return out;
  }

  // Build a procedural piece Group for (type,color). Centered on its base; sits at
  // TILE_TOP. Returns a Group with a single (cloned-material) mesh hierarchy.
  function makeProceduralPiece(type, mat) {
    const g = new THREE.Group();
    if (type === "n") {
      // Stylized knight: a chunky horse-head silhouette extruded, on a round base.
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
      const headGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
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
    // Profiles are authored on a 0..~1 unit-height scale; scale to target height.
    const profH = type === "p" ? 0.86 : type === "r" ? 0.86 : type === "b" ? 0.98 : 1.06;
    const sc = (PIECE_HEIGHT[type] / profH) * (STEP * 1.0);
    mesh.scale.setScalar(sc);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    // King cross finial.
    if (type === "k") {
      const crossMat = mat;
      const v = new THREE.Mesh(new THREE.BoxGeometry(STEP * 0.06, STEP * 0.22, STEP * 0.06), crossMat);
      const h = new THREE.Mesh(new THREE.BoxGeometry(STEP * 0.16, STEP * 0.06, STEP * 0.06), crossMat);
      v.position.y = PIECE_HEIGHT.k + STEP * 0.06;
      h.position.y = PIECE_HEIGHT.k + STEP * 0.02;
      v.castShadow = h.castShadow = true;
      g.add(v); g.add(h);
      g.userData.crossGeo = [v.geometry, h.geometry];
    }
    return g;
  }

  // ---- Piece ledger -------------------------------------------------------
  // Each square's piece is a managed record. We rebuild the visible set from the
  // logical board on every paint (idempotent), reusing meshes by (r,c) identity is
  // unnecessary because chess positions reshuffle a lot — instead we keep a flat
  // pool keyed by a running id and reconcile on paint.
  // For simplicity + correctness we maintain `pieceMeshes[r][c]` = Group|null and
  // diff against the logical board each paint.
  const pieceMeshes = Array.from({ length: N }, () => new Array(N).fill(null));
  // Captured pieces parked in side trays (kept visible for a played-with feel).
  const trayPieces = []; // Group[]
  const trayCount = { white: 0, black: 0 };

  // Highlights.
  let selRingMesh = null;
  const targets = [];

  // Build static scene graph.
  buildBoard();
  buildColliders();
  buildIdentityCue();
  updateIdentityCue();

  // Kick off async GLB loading (non-blocking). On success swaps templates + repaints.
  loadModels();

  // ===========================================================================
  // IDENTITY + TURN CUE — a flat placard laid just outside the LOCAL player's OWN
  // near edge that always names which colour they are (white/black/spectator) and
  // whose turn it is ("Your move" vs "Opponent's move"), plus the game result when
  // over. Because we self-orient the group by myColour, the local player's own home
  // edge faces them: white's home is the +Z (rows 6/7) edge, black's the -Z (rows
  // 0/1) edge — we park the placard just beyond that edge so it reads upright at the
  // bottom of the local player's view. The TEXT is derived from role/myColour (never
  // from the wire), so host and guest each see THEIR OWN identity, never flipped by a
  // relayed snapshot. We also tint the local player's home rail rim with their
  // colour as a second at-a-glance "this side is yours" cue.
  // ===========================================================================
  let cueCanvas = null, cueTex = null, cueMesh = null, homeRail = null;
  function buildIdentityCue() {
    if (typeof document === "undefined" || !document.createElement) return;
    cueCanvas = document.createElement("canvas");
    cueCanvas.width = 512; cueCanvas.height = 96;
    cueTex = new THREE.CanvasTexture(cueCanvas);
    if (THREE.SRGBColorSpace) cueTex.colorSpace = THREE.SRGBColorSpace;
    const cueMat = new THREE.MeshBasicMaterial({ map: cueTex, transparent: true, depthWrite: false });
    const cueGeo = new THREE.PlaneGeometry(BOARD_SIZE * 0.62, BOARD_SIZE * 0.62 * (96 / 512));
    cueMesh = new THREE.Mesh(cueGeo, cueMat);
    cueMesh.rotation.x = -Math.PI / 2; // lay flat on the table
    cueMesh.renderOrder = 4;
    group.add(cueMesh);
    // A thin coloured rim that highlights the LOCAL player's own home edge.
    const railGeo = new THREE.BoxGeometry(BOARD_SIZE + FRAME_W * 2, FRAME_H * 0.6, STEP * 0.16);
    homeRail = new THREE.Mesh(railGeo, new THREE.MeshStandardMaterial({
      color: "#efe7d2", emissive: "#efe7d2", emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.1,
    }));
    homeRail.castShadow = false; homeRail.receiveShadow = true;
    group.add(homeRail);
    G._cueGeo = cueGeo; G._railGeo = railGeo;
  }

  // Re-place + repaint the identity/turn cue. Cheap; called on every state change.
  function updateIdentityCue() {
    if (!cueMesh) return;
    // Local player's own near edge in CANONICAL coords: white home is +Z (rows 6/7),
    // black home is -Z (rows 0/1). Spectators default to the -Z edge.
    const nearZ = myColor === "white" ? 1 : -1;
    const edgeZ = nearZ * (HALF + FRAME_W + STEP * 0.30);
    cueMesh.position.set(0, TILE_TOP + 0.003, edgeZ + nearZ * STEP * 0.34);
    // Orient the text so it reads upright FROM the local player's seat (text top
    // points away from the player, i.e. toward board centre = -nearZ).
    cueMesh.rotation.z = nearZ > 0 ? Math.PI : 0;

    if (homeRail) {
      // Sit just above the frame rail's top so the coloured rim reads cleanly
      // without z-fighting the wooden frame underneath.
      homeRail.position.set(0, PLANK_TOP + FRAME_H + (FRAME_H * 0.6) / 2, nearZ * (HALF + FRAME_W / 2));
      const c = myColor === "white" ? "#efe7d2" : myColor === "black" ? "#2b2622" : "#6a5a44";
      homeRail.material.color.set(c);
      homeRail.material.emissive.set(c);
      homeRail.material.emissiveIntensity = myColor === "black" ? 0.18 : 0.35;
      homeRail.visible = !!myColor; // spectators get no "your side" rim
    }
    paintCueText();
  }

  function paintCueText() {
    if (!cueCanvas || !cueTex) return;
    const g = cueCanvas.getContext("2d");
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
      // Accent green when it's your move, amber otherwise, so turn reads at a glance.
      accent = phase === "over"
        ? (winner === myColor ? "#7ad08a" : winner == null ? "#d8c9ad" : "#e0734a")
        : (state.turn === myColor ? "#7ad08a" : "#e0a23a");
    }
    // Rounded pill background.
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

    // Two capture trays outside the frame on -X / +X.
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
        box.position.set(cellX(c), TILE_TOP + PIECE_HEIGHT.k * 0.5, cellZ(r));
        box.userData.cell = { r, c };
        group.add(box);
      }
    }
  }

  // -------------------------------------------------------------------------
  // GLB loading. Loads the six per-piece models, normalises each to base-centered
  // + target height, and stores a template Group per type. On success, flips
  // modelsReady and repaints so existing procedural pieces are swapped for clones.
  // Any failure leaves that type (or all types) procedural — chess still works.
  // -------------------------------------------------------------------------
  function loadModels() {
    let loader;
    try {
      loader = new GLTFLoader();
    } catch {
      return; // no loader available → stay procedural
    }
    const types = Object.keys(MODEL_FILES);
    let remaining = types.length;
    let anyOk = false;
    const done = () => {
      remaining -= 1;
      if (remaining > 0) return;
      if (anyOk) { modelsReady = true; if (!disposed) paint(); }
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
              finish(normalizeModel(gltf.scene || (gltf.scenes && gltf.scenes[0]), type));
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

  // Normalise a loaded GLB scene into a template Group: extract a single merged-ish
  // mesh hierarchy, recenter on its XZ base, scale to PIECE_HEIGHT[type], stand it
  // upright on y=0. Returns a Group whose children are meshes WITHOUT a bound
  // material (we assign a cloned colour material per clone in makeModelPiece()).
  function normalizeModel(scene, type) {
    if (!scene) return null;
    const tmpl = scene.clone(true);
    // Compute bounding box to normalise.
    const box = new THREE.Box3().setFromObject(tmpl);
    if (!isFinite(box.min.x) || box.isEmpty()) return null;
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const height = size.y || 1;
    const scale = PIECE_HEIGHT[type] / height;
    // Wrap so we can offset to base-on-floor without fighting the model's own root.
    const wrap = new THREE.Group();
    tmpl.position.x = -center.x;
    tmpl.position.z = -center.z;
    tmpl.position.y = -box.min.y; // base sits on y=0
    const inner = new THREE.Group();
    inner.add(tmpl);
    inner.scale.setScalar(scale);
    wrap.add(inner);
    wrap.userData.modelGeometries = [];
    // Collect geometries we own (for disposal) and force shadows.
    wrap.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.geometry) {
          // The Poly-Pizza chess GLBs ship with ONLY a POSITION attribute (no
          // vertex normals) AND a near-black baseColorFactor. Without normals a
          // MeshStandardMaterial has no light response and shades every face black
          // regardless of the material's colour — which is exactly why BOTH the
          // ivory and the charcoal armies rendered black. Generate normals when
          // they're missing so the assigned white/black material actually lights.
          const g = o.geometry;
          if (!g.attributes || !g.attributes.normal) {
            g.computeVertexNormals();
            // normalizeNormals() guards against any zero-length normals left by
            // degenerate faces (they'd shade black again); needsUpdate uploads the
            // freshly computed buffer to the GPU.
            g.normalizeNormals?.();
            if (g.attributes && g.attributes.normal) g.attributes.normal.needsUpdate = true;
          }
          // The GLB's own near-black material/map must never leak onto our coloured
          // clone. We replace o.material per-clone in makeModelPiece(), but also
          // null any inherited texture map here so a stray baked map can't tint the
          // ivory set dark.
          if (o.material && o.material.map) { o.material.map = null; o.material.needsUpdate = true; }
          wrap.userData.modelGeometries.push(g);
        }
      }
    });
    return wrap;
  }

  // Clone a normalized model template for (type,color) and bind a cloned colour mat.
  function makeModelPiece(type, color, mat) {
    const tmpl = modelTemplate[type];
    if (!tmpl) return null;
    const g = tmpl.clone(true);
    // Replace EVERY submesh's material with our cloned colour material so the GLB's
    // own near-black baseColorFactor (≈#030303) never reaches the screen — this is
    // what makes the white set read as ivory rather than black. mat carries no map.
    g.traverse((o) => {
      if (o.isMesh) {
        o.material = mat;
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // Black set faces +Z toward the board; the knight reads directionally, so flip
    // black pieces 180° for symmetry (purely cosmetic).
    if (color === "black") g.rotation.y = Math.PI;
    return g;
  }

  // Create a piece Group (model clone if ready, else procedural) for (type,color),
  // with a freshly cloned colour material so its emissive is independent.
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
    // Dispose procedural-only geometries we minted (model template geometries are
    // shared by the template and disposed there; clones share buffers).
    if (g.userData.baseGeo) g.userData.baseGeo.dispose?.();
    if (g.userData.headGeo) g.userData.headGeo.dispose?.();
    if (g.userData.crossGeo) for (const cg of g.userData.crossGeo) cg.dispose?.();
  }

  // -------------------------------------------------------------------------
  // Paint: idempotently rebuild the visible pieces from the logical board. Diffs
  // by (r,c) + (type,color): if the existing mesh matches, keep it (and just snap
  // position); otherwise dispose + recreate. Captured/missing pieces are removed.
  // Surplus (vs a 32-piece start) is parked in trays for a tactile feel.
  // -------------------------------------------------------------------------
  function paint() {
    clearTrays();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const want = state.board[r][c];
        const have = pieceMeshes[r][c];
        if (!want) {
          if (have) { disposePiece(have); pieceMeshes[r][c] = null; }
          continue;
        }
        if (have && have.userData.pieceType === want.type && have.userData.pieceColor === want.color &&
          (!modelsReady || have.userData.isModel === !!modelTemplate[want.type])) {
          have.position.set(cellX(c), TILE_TOP, cellZ(r));
          continue;
        }
        if (have) { disposePiece(have); pieceMeshes[r][c] = null; }
        const g = makePiece(want.type, want.color);
        g.userData.isModel = modelsReady && !!modelTemplate[want.type];
        g.position.set(cellX(c), TILE_TOP, cellZ(r));
        group.add(g);
        pieceMeshes[r][c] = g;
      }
    }
    refreshHighlights();
  }

  // Park a captured/surplus piece in a side tray (purely cosmetic). Called nowhere
  // critical — we keep it simple: trays are decorative beds; we don't track each
  // captured identity, so we leave trays empty unless we want the flourish. For a
  // clean idempotent rebuild we simply DON'T render captured pieces. (Kept for
  // future use / symmetry with checkers.)
  function clearTrays() {
    for (const g of trayPieces) disposePiece(g);
    trayPieces.length = 0;
    trayCount.white = 0; trayCount.black = 0;
  }

  // ===========================================================================
  // Highlights — gold selection ring on the picked piece's square + bobbing target
  // tokens (gold for quiet, red ring for captures) on legal destinations. Only for
  // the seated player on their turn.
  // ===========================================================================
  function myTurnNow() {
    const gate = typeof ctx.isLocalTurnAllowed === "function" ? ctx.isLocalTurnAllowed() : (state.turn === myColor);
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
  // Animation loop — a gliding mover + idle bob/spin for the target tokens. The
  // logical model is mutated synchronously; meshes trail purely cosmetically.
  // ===========================================================================
  const glides = []; // { mesh, t, dur, fromX, fromZ, toX, toZ, arc, onDone }
  let rafId = null, lastT = 0, idleT = 0;
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
        t.rotation.z = idleT * 1.4; // spin (rings already x-rotated; flat tokens spin on z)
      }
    }
  }

  // Glide the mover mesh from its source square to its destination. The model is
  // already up to date; this just re-homes the existing mesh and (for a non-capture
  // / capture alike) slides it. Knights arc.
  function animateMove(from, to, isKnight, onDone) {
    const mesh = pieceMeshes[to.r][to.c]; // already moved in the model+pieceMeshes
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
  // performMove — apply a validated legal move. The logical state is the source of
  // truth and is replaced SYNCHRONOUSLY; the meshes are then reconciled (paint) and
  // the mover glides. Handles capture removal, castling rook slide, en-passant, and
  // promotion via the pure applyMoveToState() + a mesh repaint.
  // ===========================================================================
  function performMove(move) {
    const movingPiece = state.board[move.from.r][move.from.c];
    const isKnight = movingPiece && movingPiece.type === "n";
    // Advance the authoritative model.
    state = applyMoveToState(state, move);

    busy = true;
    clearSelection();
    clearHighlights();
    // Reconcile meshes to the new board, then glide the mover from its old square.
    // We special-case the mover so its mesh slides instead of snapping: paint()
    // would place a NEW mesh at the destination if identity changed (promotion), so
    // we paint first then glide whatever mesh now sits on `to`.
    paint();
    animateMove(move.from, move.to, isKnight, () => { busy = false; });
    if (!pieceMeshes[move.to.r][move.to.c]) busy = false;
  }

  // After a move: detect end-of-game (checkmate / stalemate). No 50-move / threefold
  // / insufficient-material draw detection (kept minimal; stalemate is handled).
  function afterMove() {
    const status = gameStatus(state);
    if (status === "checkmate") {
      phase = "over";
      winner = other(state.turn); // side to move is mated → the other side won
      clearSelection(); clearHighlights();
      updateIdentityCue();
      try { ctx.onGameOver({ winner, reason: "checkmate" }); } catch { /* */ }
      return;
    }
    if (status === "stalemate") {
      phase = "over";
      winner = null;
      clearSelection(); clearHighlights();
      updateIdentityCue();
      try { ctx.onGameOver({ winner: null, reason: "stalemate" }); } catch { /* */ }
      return;
    }
    updateIdentityCue();
    refreshHighlights();
  }

  // ===========================================================================
  // onPointer — seated player clicked a resolved cell. Select own piece, click a
  // highlighted destination to move (auto-queen on promotion), click elsewhere to
  // reselect/cancel.
  // ===========================================================================
  function onPointer(hit) {
    const gate = typeof ctx.isLocalTurnAllowed === "function" ? ctx.isLocalTurnAllowed() : (state.turn === myColor);
    if (!gate) return;
    if (phase !== "play" || state.turn !== myColor) return;
    if (busy) return;
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.r) || !Number.isInteger(cell.c)) return;
    const { r, c } = cell;
    if (!inBounds(r, c)) return;

    // With a piece selected, a click on a legal destination commits.
    if (selectedFrom) {
      const move = selMoves.find((m) => m.to.r === r && m.to.c === c);
      if (move) { commitMove(move); return; }
      // Clicked off the legal targets — fall through to (re)select.
    }

    const p = state.board[r][c];
    if (p && p.color === myColor) {
      selectedFrom = { r, c };
      selMoves = legalMovesFrom(state, r, c);
      // Default promotions to queen so the destination set has ONE entry per square.
      selMoves = dedupePromotions(selMoves);
      refreshHighlights();
    } else {
      clearSelection();
      refreshHighlights();
    }
  }

  // Collapse the four promotion moves to a single auto-queen move per destination so
  // a single click commits (auto-queen ok per spec).
  function dedupePromotions(moves) {
    const seen = new Set();
    const out = [];
    for (const m of moves) {
      const key = m.to.r * 8 + m.to.c;
      if (m.flags.promo) {
        if (seen.has(key)) continue;
        if (m.flags.promo !== "q") continue; // keep only the queen variant
        seen.add(key);
      }
      out.push(m);
    }
    return out;
  }

  // Commit a chosen LOCAL move: mutate + animate, relay (from,to,promo), advance,
  // then (host) push an authoritative snapshot.
  function commitMove(move) {
    const promo = move.flags.promo || null;
    performMove(move);
    try {
      ctx.net.sendMove({ type: "move", from: move.from, to: move.to, ...(promo ? { promo } : {}) });
    } catch { /* transport optional */ }
    afterMove();
    if (role === "host") pushSnapshot();
  }

  // ===========================================================================
  // applyMove — apply ONE relayed move. Trust only (from,to,promo); re-derive
  // legality AND verify the relayed sender actually owns the side to move. The
  // server stamps the mover identity as `by.seatIndex` (host=0, guest=1) /
  // `byRole`; board.js passes both. matchLegalMove only checks the coordinates
  // form a legal move for whichever side is to move, so without this seat/colour
  // check a guest could relay a move of the host's (white's) pieces during
  // white's turn and have it accepted. We derive the sender's colour and require
  // it to equal state.turn before applying. On mismatch THROW GameDesync.
  // ===========================================================================
  function applyMove(move, byRole, by) {
    if (phase !== "play") throw new GameDesync("chess: move while not in play");
    if (!move || move.type !== "move") return false;
    // Map the server-stamped sender identity → the colour they are allowed to
    // move. Prefer the seat index (host=0=white, guest=1=black); fall back to
    // byRole. White = host, black = guest; spectators (no seat/role) own nothing.
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
    return true;
  }

  // ===========================================================================
  // Snapshots — full-information game; the public state IS the full state.
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
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  // ===========================================================================
  // applyState — render an AUTHORITATIVE FULL snapshot. Idempotent rebuild. null =>
  // fresh game.
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
    // applyState NEVER recomputes myColor/role from the wire — it only sets the
    // shared board/turn/phase — so a relayed snapshot can't flip this client to the
    // wrong side. The identity cue is re-derived from our OWN myColour + the new turn.
    updateIdentityCue();
    paint();
  }

  // Decode a snapshot into a clean { board, turn, castling, ep } state, tolerating a
  // bare board array or a partial object.
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
    // myColor changed → the near-edge for this client may flip; re-orient so the
    // local player's own army stays nearest them.
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
    clearTrays();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (pieceMeshes[r][c]) { disposePiece(pieceMeshes[r][c]); pieceMeshes[r][c] = null; }
      }
    }
    // Dispose model template geometries.
    for (const type of Object.keys(modelTemplate)) {
      const tmpl = modelTemplate[type];
      if (tmpl && tmpl.userData.modelGeometries) {
        for (const g of tmpl.userData.modelGeometries) g.dispose?.();
      }
      modelTemplate[type] = null;
    }
    // Identity/turn cue resources.
    if (cueMesh) { group.remove(cueMesh); cueMesh.material?.dispose?.(); cueMesh = null; }
    if (cueTex) { cueTex.dispose?.(); cueTex = null; }
    cueCanvas = null;
    if (homeRail) { group.remove(homeRail); homeRail.material?.dispose?.(); homeRail = null; }
    // Procedural geometry.
    for (const k of Object.keys(procGeo)) procGeo[k]?.dispose?.();
    for (const k of Object.keys(G)) G[k]?.dispose?.();
    if (G._tileGeo) G._tileGeo.dispose?.();
    if (G._trayGeo) G._trayGeo.dispose?.();
    for (const m of Object.values(M)) m.dispose?.();
    if (group.parent) group.parent.remove(group);
  }

  // Initial paint (procedural pieces immediately; models swap in async).
  paint();

  return {
    group,
    // We rotate the group ourselves (per-colour near-edge facing) so the framework
    // must NOT also rotate it — declare self-orientation.
    orientPolicy: "self",
    applyState,
    applyMove,
    onPointer,
    publicState,
    setRole,
    setSeatRy,
    dispose,
    attribution: ATTRIBUTION,
    // Convenience for framework/tests (not part of the required surface).
    isOurTurn: () => phase === "play" && state.turn === myColor && role !== "spectator",
  };
}

export default createGame;
