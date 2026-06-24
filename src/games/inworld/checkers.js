// Checkers (American / English draughts, 8x8) — in-world 3D table game module.
//
// A COMPLETE, fully self-contained ES module implementing the createGame()
// contract documented in ./createGame.js. The framework (board.js -> InWorldBoard)
// owns the physical café table, the WebSocket relay, role/turn gating and the
// spectator read-only mode; THIS module owns ONLY the rules, the 3D geometry
// (real meshes parented to the café table) and per-cell hit-testing.
//
//   import { createGame } from "../inworld/checkers.js";
//   const instance = createGame(ctx);   // InWorldBoard.mount() does this
//
// ===========================================================================
// CANDIDATE VARIATION #29 — "ledger of living chips, raised inlaid board,
// captures swept into a side tray."
//
// A deliberately distinct take from the pool/occupancy candidates. The whole
// module is built around ONE idea: every physical disc is a long-lived object
// with a stable identity (an integer id), tracked in a `pieces` Map. The logical
// 8x8 board never stores piece data directly — it stores the id sitting on each
// square (or 0). This "id-on-the-grid" model makes both kinds of update cheap and
// strobe-free:
//
//   1. LEDGER OF LIVING CHIPS. createGame mints exactly 24 discs up front (12 red,
//      12 black), each its own THREE.Group with a stable id, and never destroys
//      them for the life of the instance. A captured disc is not deleted — it is
//      retired to a capture tray off the side of the board. applyState reconciles
//      the ledger to a snapshot by MOVING existing chips to where they belong and
//      retiring/reviving the surplus, so a catch-up never deletes+recreates meshes
//      (no flicker). Promotion just flips a chip's crown on; demotion (from a
//      snapshot) flips it off. The id is the single source of mesh identity.
//
//   2. RAISED INLAID BOARD WITH A BEVELED WOODEN FRAME. The board is a solid plank
//      with a chamfered frame border (the 2D "6px wooden frame, rounded corners,
//      drop shadow"), and 64 thin inlaid square tiles sitting PROUD of the plank
//      top — pieces rest ON the tiles, not down in a well. Dark playable tiles
//      #7a4a25, light tiles #e8d2ab, frame #4a311c, all MeshStandard per props.js.
//
//   3. CAPTURES SLIDE INTO A SIDE TRAY. A taken disc sinks a hair, then slides off
//      the board to a little recessed tray along the capturing side's frame edge
//      and stacks there. It stays visible (you can see the score mounting) rather
//      than vanishing — a calmer, "set aside" beat than flicking a disc into the
//      void, and it gives the table a tactile, played-with feel.
//
//   4. MOVE MOTION = FLAT GLIDE (simple) / PARABOLIC HOP (jump). A simple move
//      glides flat tile-to-tile with an ease. A jump lifts in a clean parabola
//      over the captured disc and lands with a small settle; multi-jumps chain one
//      hop per segment, and each captured disc peels into the tray as the hopper
//      clears it.
//
//   5. KING = STACKED DISC + FACETED GOLD CROWN RING. Promotion seats a second
//      disc of the same colour on top and clamps a low-poly gold ring (the spec's
//      "stacked / double disc … crowned disc in gold accent") around the seam, both
//      springing in with a short overshoot. Readable from any seat, no billboard.
//
//   6. SEATED-PLAYER AFFORDANCES, THEIR TURN ONLY. Selectable own chips lift a hair
//      and glow; the picked chip gets a gold selection ring on the tile; each legal
//      next landing floats a translucent gold target token that bobs. Spectators
//      and the off-turn player get NONE of this (onPointer gated inert via
//      ctx.isLocalTurnAllowed()).
//
// WIRE FORMAT (matches the spec's moveFormat):
//   { type:"move", from:{r,c}, steps:[{r,c}...] }
//   `captured` is intentionally OMITTED on send — the receiver ignores a sender's
//   captured list and recomputes a trusted one (and promotion) via matchLegalMove.
//   Only (from, ordered step path) are trusted; an unmatched path -> GameDesync,
//   the contract's explicit resync signal (mirrors checkers' handleDesync).
//
// Palette mirrors the 2D :root tokens of public/games/checkers/index.html:
//   dark-sq #7a4a25 / light-sq #e8d2ab / frame #4a311c / accent gold #e0a23a
//   red #c4452f (hi #e7796a) / black #2a2320 (hi #6b6058).
//
// Three.js style follows src/world/props.js: MeshStandardMaterial with
// roughness/metalness, shared geometry/materials created once and freed in
// dispose(), castShadow/receiveShadow on real meshes. Geometry maps cells the same
// way createGame.js cellCenter()/hitToCell() do (col -> local X, row -> local Z,
// canonical row 0 at -Z) so a raycast on a disc resolves to that disc's own cell.

import { GameDesync, BOARD_SIZE as FRAMEWORK_BOARD_SIZE } from "./createGame.js";

// ===========================================================================
// PURE RULES — ported VERBATIM (behaviour) from public/games/checkers/index.html,
// inlined so the module is fully self-contained and transport-free. One canonical
// frame:  board[r][c] = null | { color:"red"|"black", king:bool }
//   r=0 is the top (-Z) edge; red moves UP (host, promotes on row 0), black moves
//   DOWN (guest, promotes on row 7).
// There is NO maximum-capture rule, and reaching the king row BY A JUMP ends the
// chain (a man crowned mid-jump may NOT keep jumping as a king the same turn).
// ===========================================================================
export const KING_ROW = { red: 0, black: 7 };
export const other = (c) => (c === "red" ? "black" : "red");

const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const playable = (r, c) => (r + c) % 2 === 1;
const eqSq = (a, b) => !!a && !!b && a.r === b.r && a.c === b.c;

export function initialBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!playable(r, c)) continue;
      if (r < 3) b[r][c] = { color: "black", king: false };
      else if (r > 4) b[r][c] = { color: "red", king: false };
    }
  }
  return b;
}

export function cloneBoard(b) {
  return b.map((row) => row.map((cell) => (cell ? { color: cell.color, king: cell.king } : null)));
}

export function dirsFor(piece) {
  if (piece.king) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return piece.color === "red" ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

// Recursively enumerate jump sequences for a piece on a working board. Returns
// [{ steps:[{r,c}...], captured:[{r,c}...] }]. American rule: reaching the king
// row by a jump promotes and ENDS the chain. A cloned board per hop prevents a
// disc from being jumped twice in one sequence.
export function jumpsFrom(r, c, piece, bd) {
  const out = [];
  for (const [dr, dc] of dirsFor(piece)) {
    const mr = r + dr, mc = c + dc;          // jumped-over square
    const lr = r + 2 * dr, lc = c + 2 * dc;  // landing square
    if (!inBounds(lr, lc) || !playable(lr, lc)) continue;
    const mid = bd[mr] && bd[mr][mc];
    if (!mid || mid.color === piece.color) continue;
    if (bd[lr][lc]) continue; // landing must be empty
    const promotes = !piece.king && lr === KING_ROW[piece.color];
    const moved = { color: piece.color, king: piece.king || promotes };
    const nb = cloneBoard(bd);
    nb[r][c] = null;
    nb[mr][mc] = null;
    nb[lr][lc] = moved;
    const land = { r: lr, c: lc };
    const cap = { r: mr, c: mc };
    const cont = promotes ? [] : jumpsFrom(lr, lc, moved, nb);
    if (cont.length === 0) {
      out.push({ steps: [land], captured: [cap] });
    } else {
      for (const k of cont) {
        out.push({ steps: [land, ...k.steps], captured: [cap, ...k.captured] });
      }
    }
  }
  return out;
}

export function simpleMovesFrom(r, c, piece, bd) {
  const out = [];
  for (const [dr, dc] of dirsFor(piece)) {
    const tr = r + dr, tc = c + dc;
    if (inBounds(tr, tc) && playable(tr, tc) && !bd[tr][tc]) {
      out.push({ steps: [{ r: tr, c: tc }], captured: [] });
    }
  }
  return out;
}

// All legal moves for a color on a board. If ANY capture exists, captures are
// mandatory and the only legal moves (global; no maximum-capture rule).
export function allMoves(bd, color) {
  const captures = [];
  const simples = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = bd[r][c];
      if (!p || p.color !== color) continue;
      for (const j of jumpsFrom(r, c, p, bd)) {
        captures.push({ from: { r, c }, steps: j.steps, captured: j.captured });
      }
      for (const s of simpleMovesFrom(r, c, p, bd)) {
        simples.push({ from: { r, c }, steps: s.steps, captured: s.captured });
      }
    }
  }
  return captures.length ? captures : simples;
}

// Apply a validated path to a board IN PLACE: remove captured pieces, then place
// the (possibly promoted) mover on the final landing square.
export function applyPath(bd, from, steps, captured) {
  const piece = bd[from.r][from.c];
  bd[from.r][from.c] = null;
  for (const cap of captured) bd[cap.r][cap.c] = null;
  const final = steps[steps.length - 1];
  const promote = !piece.king && final.r === KING_ROW[piece.color];
  bd[final.r][final.c] = { color: piece.color, king: piece.king || promote };
}

// Anti-cheat: accept a remote move only if some legal move for the side to move
// shares its from-square AND its exact ordered step path. Returns the validated
// move (with OUR trusted captured list) or null. The sender's captured list is
// never trusted — only (from, steps).
export function matchLegalMove(bd, turn, msg) {
  if (!msg || !msg.from || !Array.isArray(msg.steps) || msg.steps.length === 0) return null;
  for (const m of allMoves(bd, turn)) {
    if (!eqSq(m.from, msg.from)) continue;
    if (m.steps.length !== msg.steps.length) continue;
    if (m.steps.every((s, i) => eqSq(s, msg.steps[i]))) return m;
  }
  return null;
}

export function countPieces(bd, color) {
  let n = 0;
  for (const row of bd) for (const cell of row) if (cell && cell.color === color) n++;
  return n;
}

// ===========================================================================
// GEOMETRY CONSTANTS (metres, in the board group's local XZ plane). The playable
// square spans BOARD_SIZE so 8 cells map onto it exactly the way createGame.js
// cellCenter()/hitToCell() expect (col -> local X, row -> local Z, row 0 at -Z).
// ===========================================================================
const BOARD_SIZE = FRAMEWORK_BOARD_SIZE || 0.7; // edge of the playable square
const HALF = BOARD_SIZE / 2;
const N = 8;
const STEP = BOARD_SIZE / N;          // one cell ~ 0.0875 m

const PLANK_H = 0.022;                // solid board plank thickness
const FRAME_W = 0.030;                // beveled wooden frame width around the field
const FRAME_H = 0.012;                // how proud the frame stands above the plank top
const TILE_T = 0.004;                 // inlaid tile thickness (sits proud of the plank)
const PLANK_TOP = PLANK_H;            // local Y of the plank top face
const TILE_TOP = PLANK_TOP + TILE_T;  // local Y of the tile top (where discs rest)

const DISC_R = STEP * 0.40;           // ~76% across the cell (matches the 2D piece)
const DISC_T = 0.016;                 // single disc thickness
const REST_Y = TILE_TOP + DISC_T / 2; // resting centre height of a man
const HOP_Y = STEP * 0.6;             // peak extra height of a jump parabola
const LIFT_Y = STEP * 0.07;           // hover lift for a selectable / selected chip

const TRAY_DROP = -DISC_T * 0.2;      // captured discs sit a touch below board level in the tray
const TRAY_GAP = HALF + FRAME_W + STEP * 0.55; // distance from board centre to the tray lane

// Canonical cell -> local board centre (shared mapping with createGame.js).
function cellX(c) { return -HALF + (c + 0.5) * STEP; }
function cellZ(r) { return -HALF + (r + 0.5) * STEP; }

// ===========================================================================
// THE MODULE
// ===========================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "checkers";

  // ---- Game state ---------------------------------------------------------
  // `board[r][c]` holds the integer ID of the disc on that square, or 0 for empty
  // — the id grid IS the authoritative position. The rules engine consumes a
  // derived { color, king } grid (logicalBoard()); the ledger (`pieces`) is the
  // bridge from id -> living mesh + colour/king/onBoard.
  let board = emptyGrid();      // ids
  let turn = "red";             // red always moves first
  let phase = "play";           // "play" | "over"
  let winner = null;

  let role = ctx.role;
  let seatRy = ctx.seatRy;
  // Colour is fixed by role: host = red (moves first), guest = black. Spectators
  // get null and may never move.
  let myColor = role === "host" ? "red" : role === "guest" ? "black" : null;

  // ---- Selection / multi-jump click-through (seated local player only) -----
  let selectedFrom = null;      // {r,c} of the piece being moved this turn
  let pathSoFar = [];           // landing squares clicked so far this turn
  let candidateSeqs = [];       // legal sequences still matching pathSoFar

  let busy = false;             // true while a local/remote move animates
  let disposed = false;

  // ===========================================================================
  // Shared materials + geometries (created once; freed in dispose()). Each disc
  // CLONES its base material so its own emissive (hover glow) is independent.
  // ===========================================================================
  const M = {
    frame: new THREE.MeshStandardMaterial({ color: "#4a311c", roughness: 0.66, metalness: 0.06 }),
    plank: new THREE.MeshStandardMaterial({ color: "#3a281a", roughness: 0.74, metalness: 0.04 }),
    dark: new THREE.MeshStandardMaterial({ color: "#7a4a25", roughness: 0.8, metalness: 0.03 }),
    light: new THREE.MeshStandardMaterial({ color: "#e8d2ab", roughness: 0.84, metalness: 0.02 }),
    tray: new THREE.MeshStandardMaterial({ color: "#2c1d11", roughness: 0.9, metalness: 0.03 }),
    red: new THREE.MeshStandardMaterial({ color: "#c4452f", roughness: 0.42, metalness: 0.12, emissive: "#000000" }),
    black: new THREE.MeshStandardMaterial({ color: "#2a2320", roughness: 0.48, metalness: 0.12, emissive: "#000000" }),
    gold: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.72, emissive: "#5a3c00", emissiveIntensity: 0.32 }),
    selRing: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.34, metalness: 0.5, emissive: "#e0a23a", emissiveIntensity: 0.5, transparent: true, opacity: 0.92 }),
    target: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.3, emissive: "#e0a23a", emissiveIntensity: 0.55, transparent: true, opacity: 0.7, depthWrite: false }),
    invisible: new THREE.MeshBasicMaterial({ visible: false }),
  };
  // Per-colour emissive accents used for the hover glow on own pieces.
  const GLOW = { red: new THREE.Color("#e7796a"), black: new THREE.Color("#6b6058") };

  // Turned draught profile via LatheGeometry: a gently domed, beveled disc so the
  // chips read as real turned wood, not a bare cylinder.
  function discProfile() {
    const r = DISC_R, h = DISC_T / 2;
    const pts = [
      new THREE.Vector2(0.0, -h),
      new THREE.Vector2(r * 0.92, -h),
      new THREE.Vector2(r * 1.0, -h * 0.35),
      new THREE.Vector2(r * 1.0, h * 0.35),
      new THREE.Vector2(r * 0.9, h),
      new THREE.Vector2(r * 0.5, h * 1.05),
      new THREE.Vector2(0.0, h * 1.07),
    ];
    return new THREE.LatheGeometry(pts, 32);
  }

  const G = {
    disc: discProfile(),
    cap: discProfile(),                                       // king's stacked second disc
    crown: new THREE.TorusGeometry(DISC_R * 0.94, DISC_R * 0.12, 6, 18), // faceted gold ring (low segments)
    tile: new THREE.BoxGeometry(STEP * 0.94, TILE_T, STEP * 0.94),
    selRing: new THREE.TorusGeometry(DISC_R * 1.12, DISC_R * 0.1, 8, 28), // selection ring laid on the tile
    target: new THREE.CylinderGeometry(STEP * 0.22, STEP * 0.22, STEP * 0.04, 24), // floating gold token
    hit: new THREE.BoxGeometry(STEP * 0.98, DISC_T * 3, STEP * 0.98),    // per-square collider
  };

  // ---- Piece ledger -------------------------------------------------------
  // id -> { id, color, mesh:Group, base, baseMat, cap, capMat, crown, king, onBoard }
  const pieces = new Map();
  let nextId = 1;
  // Per-colour captured-disc stacks (for tray layout).
  const trayCount = { red: 0, black: 0 };

  // ---- Highlight objects (rebuilt each refresh) ---------------------------
  let selRingMesh = null;       // gold ring on the selected chip's tile
  const targets = [];           // floating gold tokens on legal next landings
  const glowing = new Set();    // disc ids currently showing the hover glow

  // Static scene graph is built up front (these touch only bindings declared
  // above). The INITIAL PAINT (setBoardFromLogical + refreshHighlights) is run at
  // the very END of createGame instead — it reaches the animation-loop bindings
  // (rafId/hops/crowns/startLoop), which are declared further down, so calling it
  // here would hit a temporal-dead-zone ReferenceError.
  buildBoard();
  buildColliders();
  mintPieces();

  // -------------------------------------------------------------------------
  // Static board geometry: a solid plank, a proud beveled frame, 64 inlaid tiles
  // proud of the plank top, and two recessed capture trays along the side edges.
  // -------------------------------------------------------------------------
  function buildBoard() {
    const outer = BOARD_SIZE + FRAME_W * 2;

    // Solid plank body (everything under the tiles).
    const plank = new THREE.Mesh(new THREE.BoxGeometry(outer, PLANK_H, outer), M.plank);
    plank.position.y = PLANK_H / 2;
    plank.castShadow = true;
    plank.receiveShadow = true;
    group.add(plank);

    // Proud beveled frame: four rails standing above the plank top, framing the
    // field (the 2D "wooden frame border"). Tapered (top narrower) for a chamfer.
    const frameY = PLANK_TOP + FRAME_H / 2;
    const longGeo = new THREE.BoxGeometry(outer, FRAME_H, FRAME_W);
    const sideGeo = new THREE.BoxGeometry(FRAME_W, FRAME_H, outer - FRAME_W * 2);
    const off = HALF + FRAME_W / 2;
    for (const [geo, x, z] of [
      [longGeo, 0, -off],
      [longGeo, 0, off],
      [sideGeo, -off, 0],
      [sideGeo, off, 0],
    ]) {
      const rail = new THREE.Mesh(geo, M.frame);
      rail.position.set(x, frameY, z);
      rail.scale.set(0.96, 1, 0.96); // subtle chamfer feel at the top edge
      rail.castShadow = true;
      rail.receiveShadow = true;
      group.add(rail);
    }

    // 64 inlaid tiles sitting proud of the plank; dark tiles are the playable
    // squares ((r+c)%2===1), matching the 2D board.
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const isDark = playable(r, c);
        const tile = new THREE.Mesh(G.tile, isDark ? M.dark : M.light);
        tile.position.set(cellX(c), PLANK_TOP + TILE_T / 2, cellZ(r));
        tile.receiveShadow = true;
        group.add(tile);
      }
    }

    // Two capture trays: shallow recessed lanes outside the frame on the -X and +X
    // sides. Captured black discs stack on +X (red's tray); captured red on -X.
    // They are decorative beds the captured discs slide onto.
    for (const sx of [-1, 1]) {
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(STEP * 0.9, 0.006, BOARD_SIZE * 0.92),
        M.tray
      );
      tray.position.set(sx * TRAY_GAP, PLANK_TOP - 0.001, 0);
      tray.receiveShadow = true;
      group.add(tray);
    }
  }

  // One invisible collider over every playable square, tagged with its cell so the
  // framework's cell resolver can walk up to userData.cell — empty dark squares are
  // reliably clickable even with no disc on them. A click on a disc resolves via
  // the same geometric map (or this box under it), so they always agree.
  function buildColliders() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!playable(r, c)) continue;
        const box = new THREE.Mesh(G.hit, M.invisible);
        box.position.set(cellX(c), REST_Y, cellZ(r));
        box.userData.cell = { r, c };
        group.add(box);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Ledger: mint exactly 24 discs (12 red, 12 black) up front. They live for the
  // whole instance; capture retires them to the tray, never destroys them, so the
  // mesh set is stable and reconcile never deletes+recreates.
  // -------------------------------------------------------------------------
  function makeDisc(color) {
    const g = new THREE.Group();
    const src = color === "red" ? M.red : M.black;

    const baseMat = src.clone();
    const base = new THREE.Mesh(G.disc, baseMat);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // King's stacked second disc (hidden until promotion).
    const capMat = src.clone();
    const cap = new THREE.Mesh(G.cap, capMat);
    cap.position.y = DISC_T * 0.9;
    cap.castShadow = true;
    cap.visible = false;
    g.add(cap);

    // Faceted gold crown ring at the seam (hidden until promotion).
    const crown = new THREE.Mesh(G.crown, M.gold);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = DISC_T * 0.45;
    crown.castShadow = true;
    crown.visible = false;
    g.add(crown);

    g.visible = false;
    group.add(g);
    const id = nextId++;
    g.userData.pieceId = id;
    const rec = { id, color, mesh: g, base, baseMat, cap, capMat, crown, king: false, onBoard: false };
    pieces.set(id, rec);
    return rec;
  }

  function mintPieces() {
    for (let i = 0; i < 12; i++) makeDisc("red");
    for (let i = 0; i < 12; i++) makeDisc("black");
  }

  // -------------------------------------------------------------------------
  // Ledger helpers
  // -------------------------------------------------------------------------
  function emptyGrid() {
    return Array.from({ length: 8 }, () => new Array(8).fill(0));
  }
  function idAt(r, c) { return board[r][c]; }
  function pieceAt(r, c) {
    const id = board[r][c];
    return id ? pieces.get(id) : null;
  }
  // The logical { color, king } grid the rules engine consumes, derived on demand
  // from the id grid + ledger. This is the single bridge from meshes -> rules.
  function logicalBoard() {
    const out = Array.from({ length: 8 }, () => new Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = pieceAt(r, c);
        if (p) out[r][c] = { color: p.color, king: p.king };
      }
    }
    return out;
  }

  function placeMesh(rec, r, c, y) {
    rec.mesh.position.set(cellX(c), y == null ? REST_Y : y, cellZ(r));
  }

  // Show/hide the king cap + crown. `instant` skips the spring-in (snapshots).
  function setKing(rec, king, instant) {
    rec.king = king;
    rec.cap.visible = king;
    rec.crown.visible = king;
    if (king && !instant) {
      rec.cap.scale.setScalar(0.001);
      rec.crown.scale.setScalar(0.001);
      crowns.push({ rec, t: 0, dur: 0.4 });
      startLoop();
    } else if (king) {
      rec.cap.scale.setScalar(1);
      rec.crown.scale.setScalar(1);
      rec.cap.position.y = DISC_T * 0.9;
    }
  }

  // Toggle the hover glow on an own selectable chip (our turn only).
  function setGlow(rec, on) {
    if (on) {
      glowing.add(rec.id);
    } else {
      glowing.delete(rec.id);
      rec.baseMat.emissive.set("#000000");
      rec.baseMat.emissiveIntensity = 1;
      rec.mesh.position.y = REST_Y;
    }
  }

  // Snap a captured disc straight to its tray slot (used by a snapshot rebuild,
  // where surplus chips are placed without the cosmetic slide animation).
  function retireToTray(rec) {
    setGlow(rec, false);
    rec.onBoard = false;
    const dest = trayDest(rec.color);
    rec.mesh.scale.set(1, 1, 1);
    rec.mesh.rotation.set(0, 0, 0);
    rec.mesh.position.set(dest.x, dest.y, dest.z);
    rec.mesh.visible = true;
  }

  // Next free slot in a colour's tray lane (advances trayCount). Captured red
  // discs stack on the -X lane, captured black on the +X lane, two columns deep
  // so 12 fit comfortably.
  function trayDest(color) {
    const sx = color === "red" ? -1 : 1;
    const slot = trayCount[color]++;
    const lane = sx * TRAY_GAP;
    const col = slot % 2;
    const rowN = Math.floor(slot / 2);
    return {
      x: lane + (col === 0 ? -DISC_R * 0.55 : DISC_R * 0.55),
      y: PLANK_TOP + TRAY_DROP + DISC_T / 2,
      z: -BOARD_SIZE * 0.4 + rowN * (DISC_T * 1.2 + STEP * 0.18),
    };
  }

  // Reset every tray lane (used by a fresh snapshot rebuild).
  function clearTrays() {
    trayCount.red = 0;
    trayCount.black = 0;
  }

  // ===========================================================================
  // Animation loop (internal rAF; runs only while something is animating OR the
  // hover glow / target tokens need their idle motion). Pools:
  //   hops   : a disc gliding/hopping along its move path, segment by segment
  //   slides : a captured disc sinking + sliding into the tray
  //   crowns : a king cap + ring springing in on promotion
  // plus a steady glow pulse for selectable chips and a bob for the target tokens.
  // The LOGICAL MODEL is always already up to date (mutated synchronously in
  // performMove); everything here is purely cosmetic and may safely trail.
  // ===========================================================================
  const hops = [];
  const slides = [];
  const crowns = [];
  let rafId = null;
  let lastT = 0;
  let idleT = 0;
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const raf = (fn) => (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(fn) : setTimeout(() => fn(nowMs()), 16));
  const caf = (id) => (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(id) : clearTimeout(id));
  const easeOut = (x) => 1 - (1 - x) * (1 - x);
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  function loopActive() {
    return hops.length > 0 || slides.length > 0 || crowns.length > 0 ||
      glowing.size > 0 || targets.length > 0;
  }
  function startLoop() {
    if (rafId != null || disposed) return;
    lastT = nowMs();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
      lastT = t;
      stepAnim(dt);
      rafId = loopActive() && !disposed ? raf(tick) : null;
    };
    rafId = raf(tick);
  }

  function stepAnim(dt) {
    // Gliding / hopping discs along a move path.
    for (let i = hops.length - 1; i >= 0; i--) {
      const a = hops[i];
      a.t += dt;
      const seg = a.segs[a.i];
      const k = Math.min(1, a.t / a.dur);
      const e = easeInOut(k);
      const gp = a.rec.mesh.position;
      gp.x = seg.fromX + (seg.toX - seg.fromX) * e;
      gp.z = seg.fromZ + (seg.toZ - seg.fromZ) * e;
      if (seg.jump) {
        // Clean parabola over the captured man; small settle near the landing.
        gp.y = REST_Y + Math.sin(k * Math.PI) * HOP_Y;
        const sq = k > 0.85 ? Math.sin((k - 0.85) / 0.15 * Math.PI) * 0.1 : 0;
        a.rec.mesh.scale.set(1 + sq, 1 - sq, 1 + sq);
      } else {
        gp.y = REST_Y;
      }
      // Peel the captured disc into the tray as the hopper clears it.
      if (seg.capRec && !seg.captureFired && k >= 0.55) {
        seg.captureFired = true;
        slideCapture(seg.capRec);
      }
      if (k >= 1) {
        gp.set(seg.toX, REST_Y, seg.toZ);
        a.rec.mesh.scale.set(1, 1, 1);
        a.i += 1;
        a.t = 0;
        if (a.i >= a.segs.length) {
          hops.splice(i, 1);
          // Spring the crown in once the chip has settled on its final square.
          if (a.promotes) setKing(a.rec, true, false);
          if (a.onDone) a.onDone();
        }
      }
    }
    // Captured discs: sink a hair, then slide out to their tray slot.
    for (let i = slides.length - 1; i >= 0; i--) {
      const s = slides[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const e = easeInOut(k);
      const gp = s.rec.mesh.position;
      gp.x = s.x0 + (s.tx - s.x0) * e;
      gp.z = s.z0 + (s.tz - s.z0) * e;
      // Dip down at mid-slide, settle at the tray height.
      gp.y = s.y0 + (s.ty - s.y0) * e - Math.sin(k * Math.PI) * DISC_T * 0.6;
      if (k >= 1) {
        gp.set(s.tx, s.ty, s.tz);
        slides.splice(i, 1);
      }
    }
    // King cap + ring springing in on promotion (overshoot then settle).
    for (let i = crowns.length - 1; i >= 0; i--) {
      const cr = crowns[i];
      cr.t += dt;
      const k = Math.min(1, cr.t / cr.dur);
      const e = easeOut(k);
      const sc = e * (1 + Math.sin(k * Math.PI) * 0.24);
      cr.rec.cap.scale.setScalar(Math.max(0.001, sc));
      cr.rec.crown.scale.setScalar(Math.max(0.001, sc));
      cr.rec.cap.position.y = DISC_T * 0.9 + (1 - e) * STEP * 0.15;
      if (k >= 1) {
        cr.rec.cap.scale.setScalar(1);
        cr.rec.crown.scale.setScalar(1);
        cr.rec.cap.position.y = DISC_T * 0.9;
        crowns.splice(i, 1);
      }
    }
    // Idle motion: glow + lift the selectable chips, bob/spin the target tokens.
    if (glowing.size > 0 || targets.length > 0) {
      idleT += dt;
      const pulse = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(idleT * 4.2));
      const lift = LIFT_Y * (0.5 + 0.5 * Math.sin(idleT * 4.2));
      for (const id of glowing) {
        const rec = pieces.get(id);
        if (!rec) continue;
        rec.baseMat.emissive.copy(GLOW[rec.color]);
        rec.baseMat.emissiveIntensity = pulse;
        // Don't fight an in-flight hop: only lift a settled chip.
        if (!isHopping(rec.id)) rec.mesh.position.y = REST_Y + lift;
      }
      const bob = Math.sin(idleT * 3.0) * STEP * 0.045;
      for (const t of targets) {
        t.position.y = t.userData.baseY + bob;
        t.rotation.y = idleT * 1.6;
      }
    }
  }

  function isHopping(id) {
    for (const a of hops) if (a.rec.id === id) return true;
    return false;
  }

  // Slide a captured disc off the field into its tray. The chip was already
  // removed from the id grid synchronously by performMove; this is purely the
  // cosmetic peel-off, so we animate the record directly.
  function slideCapture(rec) {
    if (!rec) return;
    rec.onBoard = false;
    setGlow(rec, false);
    const x0 = rec.mesh.position.x, z0 = rec.mesh.position.z, y0 = rec.mesh.position.y;
    const dest = trayDest(rec.color);
    slides.push({ rec, t: 0, dur: 0.46, x0, z0, y0, tx: dest.x, tz: dest.z, ty: dest.y });
    startLoop();
  }

  // -------------------------------------------------------------------------
  // Build the per-segment glide/hop visual for a moving chip. The MODEL (id grid,
  // king flag, captured removal) is already mutated synchronously by performMove;
  // this function is purely cosmetic — meshes trail the authoritative state.
  // `capRecs[i]` is the captured chip record peeled off during segment i (or null).
  // -------------------------------------------------------------------------
  function animateMove(rec, from, steps, capRecs, promotes, onDone) {
    if (!rec) {
      // No mesh to move (snapshot drift): just call back; caller reconciles.
      if (onDone) onDone();
      return;
    }
    const pts = [{ r: from.r, c: from.c }, ...steps];
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const jump = Math.abs(b.r - a.r) === 2;
      segs.push({
        fromX: cellX(a.c), fromZ: cellZ(a.r),
        toX: cellX(b.c), toZ: cellZ(b.r),
        jump, capRec: capRecs[i - 1] || null, captureFired: false,
      });
    }
    hops.push({ rec, segs, i: 0, t: 0, dur: 0.32, promotes, onDone });
    startLoop();
  }

  // -------------------------------------------------------------------------
  // Apply a validated move. The LOGICAL MODEL is the source of truth and is
  // mutated SYNCHRONOUSLY here (re-home the disc id, clear captured ids, set the
  // mover's king flag), so afterMove()'s rules/turn computation is correct
  // regardless of animation timing. The meshes then TRAIL via animateMove():
  // captured chips slide to the tray and a promotion springs its crown in, but the
  // board's truth never waits on a frame.
  // -------------------------------------------------------------------------
  function performMove(from, steps, captured) {
    const id = idAt(from.r, from.c);
    const rec = id ? pieces.get(id) : null;
    const final = steps[steps.length - 1];
    const promotes = !!rec && !rec.king && final.r === KING_ROW[rec.color];

    // --- Synchronous model mutation (authoritative) ---
    if (rec) {
      board[from.r][from.c] = 0;
      board[final.r][final.c] = id;
      if (promotes) rec.king = true; // logical king flag now; crown mesh springs in below
    }
    // Map each captured square to its chip record and clear it from the id grid at
    // once, then index those records by hop segment so the visual can peel them off
    // as the hopper passes. A captured chip stays in `pieces` (we never delete a
    // minted chip) but leaves the id grid, so logicalBoard() no longer sees it.
    const pts = [{ r: from.r, c: from.c }, ...steps];
    const capRecs = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      let capRec = null;
      if (Math.abs(b.r - a.r) === 2) {
        const mr = (a.r + b.r) / 2, mc = (a.c + b.c) / 2;
        // Only treat it as a capture if the trusted captured list includes it.
        if (captured.some((cp) => cp.r === mr && cp.c === mc)) {
          const cid = board[mr][mc];
          capRec = cid ? pieces.get(cid) : null;
          board[mr][mc] = 0;
        }
      }
      capRecs.push(capRec);
    }

    // --- Trailing visuals ---
    busy = true;
    animateMove(rec, from, steps, capRecs, promotes, () => {
      busy = false;
    });
    if (!rec) busy = false; // nothing to animate (drift) — don't get stuck busy
  }

  // -------------------------------------------------------------------------
  // Turn resolution: flip the turn, detect loss-by-no-moves (the side to move with
  // NO legal moves loses — covers an empty side AND a fully-blocked side; no draw
  // rule), then refresh highlights.
  // -------------------------------------------------------------------------
  function afterMove() {
    turn = other(turn);
    if (allMoves(logicalBoard(), turn).length === 0) {
      phase = "over";
      winner = other(turn); // the side that cannot move loses
      clearSelection();
      clearHighlights();
      try { ctx.onGameOver({ winner, reason: "no-moves" }); } catch { /* framework optional */ }
      return;
    }
    refreshHighlights();
  }

  // ===========================================================================
  // Highlights — a gold selection ring on the picked chip's tile, bobbing gold
  // target tokens on legal next landings, and a hover glow/lift on each selectable
  // chip. ONLY for the seated player on their turn; spectators / off-turn see none.
  // ===========================================================================
  function myTurnNow() {
    const gate = typeof ctx.isLocalTurnAllowed === "function" ? ctx.isLocalTurnAllowed() : (turn === myColor);
    return phase === "play" && role !== "spectator" && turn === myColor && gate;
  }

  function refreshHighlights() {
    clearHighlights();
    if (!myTurnNow()) return;
    const moves = allMoves(logicalBoard(), myColor);

    if (!selectedFrom) {
      // No piece picked yet: glow every selectable chip.
      const selectable = new Set(moves.map((m) => m.from.r * 8 + m.from.c));
      for (const idx of selectable) {
        const rec = pieceAt(Math.floor(idx / 8), idx % 8);
        if (rec) setGlow(rec, true);
      }
      startLoop();
      return;
    }

    // A piece is selected: glow it, ring its tile, mark next landings.
    const selRec = pieceAt(selectedFrom.r, selectedFrom.c);
    if (selRec) setGlow(selRec, true);

    selRingMesh = new THREE.Mesh(G.selRing, M.selRing);
    selRingMesh.rotation.x = Math.PI / 2;
    selRingMesh.position.set(cellX(selectedFrom.c), TILE_TOP + 0.0016, cellZ(selectedFrom.r));
    selRingMesh.renderOrder = 2;
    group.add(selRingMesh);

    const seen = new Set();
    for (const seq of candidateSeqs) {
      const next = seq.steps[pathSoFar.length];
      if (!next) continue;
      const k = next.r * 8 + next.c;
      if (seen.has(k)) continue;
      seen.add(k);
      addTarget(next.r, next.c);
    }
    startLoop();
  }

  function addTarget(r, c) {
    const t = new THREE.Mesh(G.target, M.target);
    const baseY = REST_Y + STEP * 0.18;
    t.position.set(cellX(c), baseY, cellZ(r));
    t.userData.baseY = baseY;
    t.userData.target = { r, c };
    t.renderOrder = 3;
    group.add(t);
    targets.push(t);
  }

  function clearHighlights() {
    for (const id of [...glowing]) {
      const rec = pieces.get(id);
      if (rec) setGlow(rec, false);
    }
    for (const t of targets) group.remove(t);
    targets.length = 0;
    if (selRingMesh) { group.remove(selRingMesh); selRingMesh = null; }
  }

  function clearSelection() {
    selectedFrom = null;
    pathSoFar = [];
    candidateSeqs = [];
  }

  function movesForPiece(r, c) {
    return allMoves(logicalBoard(), turn).filter((m) => m.from.r === r && m.from.c === c);
  }

  // ===========================================================================
  // onPointer — the seated player clicked a resolved board cell. Mirrors the 2D
  // onCellClick: select a movable piece, click a target to advance/commit a
  // (possibly multi-jump) move, click elsewhere to cancel/reselect.
  // ===========================================================================
  function onPointer(hit) {
    const gate = typeof ctx.isLocalTurnAllowed === "function" ? ctx.isLocalTurnAllowed() : (turn === myColor);
    if (!gate) return;                                  // spectators + off-turn: inert
    if (phase !== "play" || turn !== myColor) return;
    if (busy) return;                                   // ignore clicks mid-move
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.r) || !Number.isInteger(cell.c)) return;
    const { r, c } = cell;
    if (!inBounds(r, c) || !playable(r, c)) { resetSelection(); return; }

    // With a piece selected, a click on a highlighted target advances the move.
    if (selectedFrom) {
      const next = candidateSeqs
        .map((s) => s.steps[pathSoFar.length])
        .find((s) => s && s.r === r && s.c === c);
      if (next) {
        pathSoFar.push({ r, c });
        const matching = candidateSeqs.filter((s) => {
          if (s.steps.length < pathSoFar.length) return false;
          return pathSoFar.every((p, i) => eqSq(p, s.steps[i]));
        });
        const finished = matching.find((s) => s.steps.length === pathSoFar.length);
        const continuing = matching.filter((s) => s.steps.length > pathSoFar.length);
        if (continuing.length > 0) {
          // Forced multi-jump continues — keep the selection, advance the targets.
          candidateSeqs = continuing;
          refreshHighlights();
        } else if (finished) {
          commitMove(finished.from, finished.steps, finished.captured);
        }
        return;
      }
      // Clicked off the legal targets — cancel and fall through to reselect.
      clearSelection();
    }

    // Selecting one of your movable pieces.
    const seqs = movesForPiece(r, c);
    if (seqs.length === 0) { resetSelection(); return; }
    selectedFrom = { r, c };
    pathSoFar = [];
    candidateSeqs = seqs;
    refreshHighlights();
  }

  function resetSelection() {
    clearSelection();
    refreshHighlights();
  }

  // Commit a fully-chosen LOCAL move: mutate + animate, relay the trusted identity
  // (from+steps only), advance the turn, then (host) push an authoritative snapshot
  // so late joiners and spectators paint the exact post-move position.
  function commitMove(from, steps, captured) {
    clearSelection();
    clearHighlights();
    performMove(from, steps, captured);
    try { ctx.net.sendMove({ type: "move", from, steps }); } catch { /* transport optional */ }
    afterMove();
    if (role === "host") pushSnapshot();
  }

  // ===========================================================================
  // applyMove — apply ONE relayed opponent/host move. Trust only (from, steps);
  // recompute captures via matchLegalMove. On mismatch THROW GameDesync (the
  // contract's explicit resync signal) so the framework requests an authoritative
  // snapshot rather than trusting a bad delta. A malformed packet never reaches
  // applyPath.
  // ===========================================================================
  function applyMove(move, byRole) {
    if (phase !== "play") throw new GameDesync("checkers: move while not in play");
    if (!move || move.type !== "move") return false;
    const legal = matchLegalMove(logicalBoard(), turn, move);
    if (!legal) throw new GameDesync("checkers: no matching legal move");
    clearSelection();
    clearHighlights();
    performMove(legal.from, legal.steps, legal.captured);
    afterMove();
    return true;
  }

  // ===========================================================================
  // applyState — render an AUTHORITATIVE FULL snapshot. Idempotent. Reconciles the
  // ledger to the target board by MOVING existing chips into place and retiring or
  // reviving surplus, rather than rebuilding meshes, so a catch-up that mostly
  // matches doesn't strobe. state === null => fresh game.
  // ===========================================================================
  function applyState(state) {
    // Cancel in-flight animations: a snapshot is the source of truth now.
    hops.length = 0;
    slides.length = 0;
    crowns.length = 0;
    busy = false;
    clearSelection();
    clearHighlights();

    let logical, newTurn, newPhase, newWinner;
    if (!state) {
      logical = initialBoard();
      newTurn = "red";
      newPhase = "play";
      newWinner = null;
    } else {
      const incoming = Array.isArray(state) ? { board: state } : state;
      logical = decodeBoard(incoming);
      newTurn = incoming.turn === "black" ? "black" : "red";
      newPhase = incoming.phase === "over" ? "over" : "play";
      newWinner = incoming.winner === "red" || incoming.winner === "black" ? incoming.winner : null;
    }

    setBoardFromLogical(logical, newTurn, newPhase, newWinner, true);
    refreshHighlights();
  }

  // Reconcile the ledger to a logical { color, king } target with minimal churn:
  //   * gather the available chips per colour (every minted chip lives forever);
  //   * for each wanted square, consume an available chip of that colour, snap it
  //     home, set its king flag;
  //   * any leftover chips of a colour are captured -> retired to the tray.
  // `instant` skips spring-ins (always true for a snapshot). This is the single
  // entry both first-paint and catch-up flow through.
  function setBoardFromLogical(logical, newTurn, newPhase, newWinner, instant) {
    board = emptyGrid();
    clearTrays();

    // Available chips per colour.
    const avail = { red: [], black: [] };
    for (const rec of pieces.values()) avail[rec.color].push(rec);

    // Place wanted pieces, consuming from the colour pool.
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const want = logical[r][c];
        if (!want) continue;
        const rec = avail[want.color].pop();
        if (!rec) continue; // more pieces than minted (impossible with valid state)
        rec.onBoard = true;
        rec.mesh.visible = true;
        rec.mesh.scale.set(1, 1, 1);
        rec.mesh.rotation.set(0, 0, 0);
        rec.baseMat.emissive.set("#000000");
        rec.baseMat.emissiveIntensity = 1;
        setKing(rec, !!want.king, instant);
        placeMesh(rec, r, c, REST_Y);
        board[r][c] = rec.id;
      }
    }

    // Whatever's left over of each colour is captured — park it in the tray.
    for (const rec of avail.red) retireToTray(rec);
    for (const rec of avail.black) retireToTray(rec);

    turn = newTurn;
    phase = newPhase;
    winner = newWinner;
  }

  // Decode a logical board from a structured 2D array OR a compact 64-char string
  // ("." empty, r/R red man/king, b/B black man/king) so host snapshots, spectators
  // and newcomers all round-trip regardless of which shape arrives.
  function decodeBoard(incoming) {
    const out = Array.from({ length: 8 }, () => new Array(8).fill(null));
    const src = incoming.board;
    if (Array.isArray(src)) {
      for (let r = 0; r < 8; r++) {
        const row = src[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < 8; c++) {
          const v = row[c];
          if (v && (v.color === "red" || v.color === "black") && playable(r, c)) {
            out[r][c] = { color: v.color, king: !!v.king };
          }
        }
      }
      return out;
    }
    if (typeof incoming.cells === "string" && incoming.cells.length >= 64) {
      const s = incoming.cells;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (!playable(r, c)) continue;
          const ch = s[r * 8 + c];
          if (ch === "r") out[r][c] = { color: "red", king: false };
          else if (ch === "R") out[r][c] = { color: "red", king: true };
          else if (ch === "b") out[r][c] = { color: "black", king: false };
          else if (ch === "B") out[r][c] = { color: "black", king: true };
        }
      }
    }
    return out;
  }

  // ===========================================================================
  // Snapshots — full-information game, so the public state IS the full state. We
  // encode BOTH a structured board and a compact `cells` string so any consumer
  // decodes regardless of preference.
  // ===========================================================================
  function snapshot() {
    const logical = logicalBoard();
    let cells = "";
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = logical[r][c];
        if (!p) cells += ".";
        else if (p.color === "red") cells += p.king ? "R" : "r";
        else cells += p.king ? "B" : "b";
      }
    }
    return {
      board: logical.map((row) => row.map((cell) => (cell ? { color: cell.color, king: !!cell.king } : null))),
      cells,
      turn,
      phase,
      winner,
      counts: { red: countPieces(logical, "red"), black: countPieces(logical, "black") },
    };
  }
  function publicState() { return snapshot(); }
  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* transport optional */ }
  }

  // ===========================================================================
  // Role / seat changes — switch in place (spectator -> player on sitting). The
  // framework re-applies group.rotation.y; we always render in the canonical
  // frame, so only the local-only highlights need re-gating.
  // ===========================================================================
  function setRole(newRole) {
    role = newRole || "spectator";
    myColor = role === "host" ? "red" : role === "guest" ? "black" : null;
    clearSelection();
    refreshHighlights();
  }
  function setSeatRy(ry) {
    seatRy = ry;
    refreshHighlights();
  }

  // ===========================================================================
  // dispose — stop the loop, free GPU resources, drop the group.
  // ===========================================================================
  function dispose() {
    disposed = true;
    if (rafId != null) { caf(rafId); rafId = null; }
    hops.length = 0;
    slides.length = 0;
    crowns.length = 0;
    clearHighlights();
    for (const rec of pieces.values()) {
      rec.baseMat.dispose?.();
      rec.capMat.dispose?.();
    }
    pieces.clear();
    if (group.parent) group.parent.remove(group);
    for (const g of Object.values(G)) g.dispose?.();
    for (const m of Object.values(M)) m.dispose?.();
  }

  // Initial paint: route the starting position through the SAME reconciler a
  // snapshot uses, so first-paint and catch-up share one code path. Run here (not
  // up top) so every animation-loop binding it touches is already initialized.
  setBoardFromLogical(initialBoard(), "red", "play", null, true);
  refreshHighlights();

  return {
    group,
    applyState,
    applyMove,
    onPointer,
    publicState,
    setRole,
    setSeatRy,
    dispose,
    // Convenience for the framework/tests (not part of the required surface).
    isOurTurn: () => phase === "play" && turn === myColor && role !== "spectator",
  };
}

export default createGame;
