// Checkers (American / English draughts, 8x8) — in-world 3D table game module.
//
// CANDIDATE VARIATION #2 — "framework-pumped, pooled discs, recessed well board."
//
// A complete, self-contained ES module implementing the createGame() contract
// from ./createGame.js. The framework (board.js -> InWorldBoard) owns the café
// table, the relay, role/turn gating and the spectator read-only mode; THIS
// module owns ONLY the rules, the 3D geometry and per-cell hit-testing.
//
// Deliberately distinct from the internal-rAF / capture-tray candidates:
//
//   1. FRAMEWORK-PUMPED ANIMATION. There is NO internal requestAnimationFrame
//      loop. All cosmetic motion (glides, parabolic jump hops, capture fades,
//      crown spring-ins, turn-cue + selection pulses) is advanced from the
//      module's optional update(dt) hook, which InWorldBoard.update(dt) already
//      pumps every frame (and which the ambient read-only mount also drives). The
//      LOGICAL board is always mutated synchronously when a move commits, so the
//      rules/turn never wait on a frame — the meshes merely trail.
//
//   2. POOLED DISCS WITH STABLE IDS. createGame mints exactly 24 discs up front
//      (12 red, 12 black). Each is a long-lived THREE.Group with a stable integer
//      id, tracked in a Map. The logical 8x8 grid stores the id sitting on each
//      square (or 0). applyState reconciles the pool to a snapshot by MOVING
//      existing discs and parking the surplus off-board (never delete+recreate),
//      so a catch-up never strobes. Captures fade + sink the disc, then park it on
//      its captor's rail. Promotion flips a gold crown ring on; demotion off.
//
//   3. RECESSED WELL BOARD. A solid plank with a raised frame and 64 square wells
//      sunk INTO the top; pieces seat in the wells. Dark playable squares #7a4a25,
//      light #e8d2ab, frame #4a311c — mirrors the 2D :root tokens.
//
//   4. UNMISTAKABLE IDENTITY + TURN CUES. Each home edge carries a colour bar in
//      that side's colour; the LOCAL player's own bar glows steadily (that's me).
//      A turn lamp on the side-to-move glows, brighter when it's the local turn.
//      On your turn your movable discs glow and lift; the picked disc gets a gold
//      ring and each legal landing floats a bobbing gold target token. Spectators
//      and the off-turn player get NONE of these.
//
//   5. SELF-ORIENTATION. orientPolicy:"self" — the module rotates its own group so
//      the LOCAL player's army sits on the near edge (red host near red, black
//      guest near black, opponent across). applyState NEVER recomputes the local
//      colour from the wire (no side-flip): colour is fixed by role at mount.
//
// WIRE FORMAT (matches the spec's moveFormat):
//   { type:"move", from:{r,c}, steps:[{r,c}...] }
//   `captured` is OMITTED on send — the receiver recomputes a trusted captured
//   list (and promotion) via matchLegalMove. Only (from, ordered steps) are
//   trusted; an unmatched path -> GameDesync (the contract's resync signal).
//
// Palette: dark #7a4a25 / light #e8d2ab / frame #4a311c / accent gold #e0a23a
//          red #c4452f (hi #e7796a) / black #2a2320 (hi #6b6058).

import { GameDesync, BOARD_SIZE as FRAMEWORK_BOARD_SIZE, orientFor } from "./createGame.js";

// ===========================================================================
// PURE RULES — American/English draughts. One canonical frame:
//   board[r][c] = null | { color:"red"|"black", king:bool }
//   r=0 is the top (-Z) edge; red promotes on row 0 (moves "up"), black promotes
//   on row 7 (moves "down"). Captures are mandatory (global, no maximum-capture
//   rule). A man crowned BY A JUMP ends the chain.
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

// Enumerate jump sequences for a piece on a working board. Returns
// [{ steps:[{r,c}...], captured:[{r,c}...] }]. A cloned board per hop stops a disc
// being jumped twice. Reaching the king row by a jump promotes and ENDS the chain.
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
      for (const k of cont) out.push({ steps: [land, ...k.steps], captured: [cap, ...k.captured] });
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

// All legal moves for a colour. If ANY capture exists, captures are mandatory and
// are the only legal moves (global; no maximum-capture rule).
export function allMoves(bd, color) {
  const captures = [];
  const simples = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = bd[r][c];
      if (!p || p.color !== color) continue;
      for (const j of jumpsFrom(r, c, p, bd)) captures.push({ from: { r, c }, steps: j.steps, captured: j.captured });
      for (const s of simpleMovesFrom(r, c, p, bd)) simples.push({ from: { r, c }, steps: s.steps, captured: s.captured });
    }
  }
  return captures.length ? captures : simples;
}

// Accept a remote move only if some legal move for the side to move shares its
// from-square AND its exact ordered step path. Returns the validated move (with
// OUR trusted captured list) or null. The sender's captured list is never trusted.
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
// square spans BOARD_SIZE so 8 cells map onto it exactly as createGame.js
// cellCenter()/hitToCell() expect (col -> local X, row -> local Z, row 0 at -Z).
// ===========================================================================
const BOARD_SIZE = FRAMEWORK_BOARD_SIZE || 0.7;
const HALF = BOARD_SIZE / 2;
const N = 8;
const STEP = BOARD_SIZE / N;          // one cell ~ 0.0875 m

const PLANK_H = 0.024;                // solid board plank thickness
const FRAME_W = 0.030;                // wooden frame width around the field
const FRAME_H = 0.016;                // how proud the frame stands above the plank top
const WELL_D = 0.003;                 // how deep each square well is sunk into the top
const PLANK_TOP = PLANK_H;            // local Y of the plank top face
const WELL_FLOOR = PLANK_TOP - WELL_D;// local Y of a well floor (where a disc seats)

const DISC_R = STEP * 0.40;
const DISC_T = 0.016;
const REST_Y = WELL_FLOOR + DISC_T / 2; // resting centre height of a man
const HOP_Y = STEP * 0.62;            // peak extra height of a jump parabola
const LIFT_Y = STEP * 0.08;           // hover lift for a selectable / selected disc

const RAIL_GAP = HALF + FRAME_W + STEP * 0.55; // distance to the captured-disc rail lane

function cellX(c) { return -HALF + (c + 0.5) * STEP; }
function cellZ(r) { return -HALF + (r + 0.5) * STEP; }

// ===========================================================================
// THE MODULE
// ===========================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "checkers";

  // ---- Logical state ------------------------------------------------------
  // board[r][c] = id of the disc on that square, or 0. The id grid is the
  // authoritative position; logicalBoard() derives the {color,king} grid the
  // rules consume.
  let board = emptyGrid();
  let turn = "red";             // red always moves first
  let phase = "play";           // "play" | "over"
  let winner = null;

  let role = ctx.role;
  let seatRy = ctx.seatRy;
  // Colour fixed by role at mount: host = red (moves first), guest = black.
  // Spectators get null and may never move. NEVER recomputed from the wire.
  let myColor = role === "host" ? "red" : role === "guest" ? "black" : null;

  // ---- Orientation --------------------------------------------------------
  // Canonical frame: black home rows 0-2 (-Z edge), red home rows 5-7 (+Z edge).
  // We declare orientPolicy:"self" so board.js does NOT rotate the group, and we
  // rotate it ourselves by orientFor(seatRy) + (red ? PI : 0):
  //   * orientFor(seatRy) brings the canonical -Z (black) edge to the local seat;
  //   * the extra PI for red flips so the +Z (red) home edge comes near instead.
  // Result: host (red) sees red nearest, guest (black) sees black nearest, each
  // sees the opponent across, and each side's coloured home bar lands in front of
  // its own player. Spectators (myColor null, seatRy null) keep the canonical
  // orientation. Per-cell colliders carry canonical {r,c} and rotate WITH the
  // group, so clicks stay self-correcting and cross-client cell mapping is intact.
  function applyFacing() {
    const extra = myColor === "red" ? Math.PI : 0;
    group.rotation.y = orientFor(seatRy) + extra;
  }
  applyFacing();

  // ---- Selection / multi-jump click-through (seated local player only) ----
  let selectedFrom = null;
  let pathSoFar = [];
  let candidateSeqs = [];

  let busy = false;             // true while a local/remote move animates
  let disposed = false;

  // ===========================================================================
  // Shared materials + geometries (created once, freed in dispose()). Discs clone
  // their base material so each disc's emissive (hover glow) is independent.
  // ===========================================================================
  const M = {
    frame: new THREE.MeshStandardMaterial({ color: "#4a311c", roughness: 0.66, metalness: 0.06 }),
    plank: new THREE.MeshStandardMaterial({ color: "#3a281a", roughness: 0.74, metalness: 0.04 }),
    dark: new THREE.MeshStandardMaterial({ color: "#7a4a25", roughness: 0.8, metalness: 0.03 }),
    light: new THREE.MeshStandardMaterial({ color: "#e8d2ab", roughness: 0.84, metalness: 0.02 }),
    rail: new THREE.MeshStandardMaterial({ color: "#2c1d11", roughness: 0.9, metalness: 0.03 }),
    red: new THREE.MeshStandardMaterial({ color: "#c4452f", roughness: 0.42, metalness: 0.12, emissive: "#000000" }),
    black: new THREE.MeshStandardMaterial({ color: "#2a2320", roughness: 0.48, metalness: 0.12, emissive: "#000000" }),
    gold: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.72, emissive: "#5a3c00", emissiveIntensity: 0.32 }),
    selRing: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.34, metalness: 0.5, emissive: "#e0a23a", emissiveIntensity: 0.5, transparent: true, opacity: 0.92 }),
    target: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.3, emissive: "#e0a23a", emissiveIntensity: 0.55, transparent: true, opacity: 0.7, depthWrite: false }),
    invisible: new THREE.MeshBasicMaterial({ visible: false }),
    homeRed: new THREE.MeshStandardMaterial({ color: "#c4452f", roughness: 0.5, metalness: 0.1, emissive: "#c4452f", emissiveIntensity: 0.0 }),
    homeBlack: new THREE.MeshStandardMaterial({ color: "#2a2320", roughness: 0.5, metalness: 0.1, emissive: "#6b6058", emissiveIntensity: 0.0 }),
    lampRed: new THREE.MeshStandardMaterial({ color: "#c4452f", roughness: 0.35, metalness: 0.2, emissive: "#e7796a", emissiveIntensity: 0.0 }),
    lampBlack: new THREE.MeshStandardMaterial({ color: "#2a2320", roughness: 0.35, metalness: 0.2, emissive: "#6b6058", emissiveIntensity: 0.0 }),
  };
  const GLOW = { red: new THREE.Color("#e7796a"), black: new THREE.Color("#6b6058") };

  // Turned draught profile via LatheGeometry: a gently domed, beveled disc.
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
    cap: discProfile(),                                                    // king's stacked second disc
    crown: new THREE.TorusGeometry(DISC_R * 0.94, DISC_R * 0.12, 8, 20),   // gold crown ring
    well: new THREE.BoxGeometry(STEP * 0.92, WELL_D + 0.001, STEP * 0.92), // sunk square well floor
    tile: new THREE.BoxGeometry(STEP, STEP * 0.6, STEP),                   // light-square filler (cosmetic, between wells)
    selRing: new THREE.TorusGeometry(DISC_R * 1.12, DISC_R * 0.1, 8, 28),
    target: new THREE.CylinderGeometry(STEP * 0.22, STEP * 0.22, STEP * 0.04, 24),
    hit: new THREE.BoxGeometry(STEP * 0.98, DISC_T * 3, STEP * 0.98),      // per-square collider
    homeBar: new THREE.BoxGeometry(BOARD_SIZE * 0.7, FRAME_H * 0.5, FRAME_W * 0.5),
    lamp: new THREE.SphereGeometry(FRAME_W * 0.32, 18, 14),
  };

  // ---- Piece pool ---------------------------------------------------------
  // id -> { id, color, mesh:Group, base, baseMat, cap, capMat, crown, king, onBoard }
  const pieces = new Map();
  let nextId = 1;
  const railCount = { red: 0, black: 0 };

  // ---- Highlight objects (rebuilt each refresh) ---------------------------
  let selRingMesh = null;
  const targets = [];
  const glowing = new Set();

  // ---- Persistent identity / turn cues (built once) -----------------------
  const cue = { red: { bar: null, lamp: null }, black: { bar: null, lamp: null } };

  // ---- Animation pools (advanced by update(dt); NO internal rAF) ----------
  const hops = [];     // a disc gliding/hopping along a move path, segment by segment
  const fades = [];    // a captured disc fading + sinking, then parked on a rail
  const crowns = [];   // a king cap + ring springing in on promotion
  let idleT = 0;       // accumulator for the steady glow/target idle motion

  const easeOut = (x) => 1 - (1 - x) * (1 - x);
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  // Build static scene graph up front (touches only bindings declared above).
  buildBoard();
  buildColliders();
  buildIdentityCues();
  mintPieces();

  // -------------------------------------------------------------------------
  // Static board geometry: solid plank, raised frame, 64 sunk wells, two rails.
  // -------------------------------------------------------------------------
  function buildBoard() {
    const outer = BOARD_SIZE + FRAME_W * 2;

    const plank = new THREE.Mesh(new THREE.BoxGeometry(outer, PLANK_H, outer), M.plank);
    plank.position.y = PLANK_H / 2;
    plank.castShadow = true;
    plank.receiveShadow = true;
    group.add(plank);

    // Raised frame rails framing the field.
    const frameY = PLANK_TOP + FRAME_H / 2;
    const longGeo = new THREE.BoxGeometry(outer, FRAME_H, FRAME_W);
    const sideGeo = new THREE.BoxGeometry(FRAME_W, FRAME_H, outer - FRAME_W * 2);
    const off = HALF + FRAME_W / 2;
    for (const [geo, x, z] of [[longGeo, 0, -off], [longGeo, 0, off], [sideGeo, -off, 0], [sideGeo, off, 0]]) {
      const rail = new THREE.Mesh(geo, M.frame);
      rail.position.set(x, frameY, z);
      rail.castShadow = true;
      rail.receiveShadow = true;
      group.add(rail);
    }

    // 64 squares. Dark playable squares are sunk wells (a disc seats in the well);
    // light squares are flush filler so the chequer reads cleanly.
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (playable(r, c)) {
          const well = new THREE.Mesh(G.well, M.dark);
          well.position.set(cellX(c), WELL_FLOOR + (WELL_D + 0.001) / 2, cellZ(r));
          well.receiveShadow = true;
          group.add(well);
        } else {
          const tile = new THREE.Mesh(G.tile, M.light);
          tile.position.set(cellX(c), PLANK_TOP - (STEP * 0.6) / 2 + 0.0005, cellZ(r));
          tile.receiveShadow = true;
          group.add(tile);
        }
      }
    }

    // Two captured-disc rails along the -X / +X frame edges. Captured black discs
    // park on +X (red's rail), captured red on -X.
    for (const sx of [-1, 1]) {
      const railMesh = new THREE.Mesh(new THREE.BoxGeometry(STEP * 0.9, 0.006, BOARD_SIZE * 0.92), M.rail);
      railMesh.position.set(sx * RAIL_GAP, PLANK_TOP - 0.001, 0);
      railMesh.receiveShadow = true;
      group.add(railMesh);
    }
  }

  // One invisible collider over every playable square, tagged with its cell so the
  // framework's cell resolver walks up to userData.cell — empty dark squares stay
  // reliably clickable. A click on a disc resolves via the same geometric map (or
  // this box beneath it), so they always agree.
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

  // Persistent identity / turn cues, built ONCE in the canonical frame (red home on
  // the +Z edge, black home on the -Z edge). applyFacing() rotates the group so the
  // local player's own home bar (and lit lamp on their turn) sit in front of them.
  function buildIdentityCues() {
    const railTop = PLANK_TOP + FRAME_H;
    const edge = HALF + FRAME_W / 2;
    const sides = [
      { color: "red", z: edge, barMat: M.homeRed, lampMat: M.lampRed },
      { color: "black", z: -edge, barMat: M.homeBlack, lampMat: M.lampBlack },
    ];
    for (const s of sides) {
      const bar = new THREE.Mesh(G.homeBar, s.barMat);
      bar.position.set(0, railTop + FRAME_H * 0.26, s.z);
      bar.receiveShadow = true;
      group.add(bar);

      const lamp = new THREE.Mesh(G.lamp, s.lampMat);
      lamp.position.set(BOARD_SIZE * 0.42, railTop + FRAME_W * 0.32, s.z);
      group.add(lamp);

      cue[s.color].bar = bar;
      cue[s.color].lamp = lamp;
    }
  }

  // Drive the identity/turn cue emissives. NEVER reads colour from the wire —
  // purely from local `myColor`/`turn`.
  //   * Home bar: the LOCAL player's own colour bar glows; others matte.
  //   * Turn lamp: only the side-to-move's lamp glows, brighter on the local turn.
  function updateIdentityCues() {
    for (const color of ["red", "black"]) {
      const c = cue[color];
      if (!c.bar || !c.lamp) continue;
      const isMine = myColor != null && color === myColor;
      const isTurn = phase === "play" && turn === color;
      c.bar.material.emissiveIntensity = isMine ? 0.6 : 0.0;
      c.lamp.material.emissiveIntensity = isTurn ? (isMine ? 1.0 : 0.45) : 0.0;
    }
  }

  // -------------------------------------------------------------------------
  // Pool: mint exactly 24 discs (12 red, 12 black) up front; they live for the
  // whole instance. Capture parks them on a rail, never destroys them.
  // -------------------------------------------------------------------------
  function makeDisc(color) {
    const g = new THREE.Group();
    const src = color === "red" ? M.red : M.black;

    const baseMat = src.clone();
    const base = new THREE.Mesh(G.disc, baseMat);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    const capMat = src.clone();
    const cap = new THREE.Mesh(G.cap, capMat);
    cap.position.y = DISC_T * 0.9;
    cap.castShadow = true;
    cap.visible = false;
    g.add(cap);

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
  // Pool / grid helpers
  // -------------------------------------------------------------------------
  function emptyGrid() {
    return Array.from({ length: 8 }, () => new Array(8).fill(0));
  }
  function idAt(r, c) { return board[r][c]; }
  function pieceAt(r, c) {
    const id = board[r][c];
    return id ? pieces.get(id) : null;
  }
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
    } else if (king) {
      rec.cap.scale.setScalar(1);
      rec.crown.scale.setScalar(1);
      rec.cap.position.y = DISC_T * 0.9;
    }
  }

  // Toggle the hover glow on an own selectable disc (our turn only).
  function setGlow(rec, on) {
    if (on) {
      glowing.add(rec.id);
    } else {
      glowing.delete(rec.id);
      rec.baseMat.emissive.set("#000000");
      rec.baseMat.emissiveIntensity = 1;
      if (rec.onBoard && !isHopping(rec.id)) rec.mesh.position.y = REST_Y;
    }
  }

  // Next free slot on a colour's capture rail. Captured red park on the -X lane,
  // captured black on +X, two columns deep so 12 fit comfortably.
  function railDest(color) {
    const sx = color === "red" ? -1 : 1;
    const slot = railCount[color]++;
    const lane = sx * RAIL_GAP;
    const col = slot % 2;
    const rowN = Math.floor(slot / 2);
    return {
      x: lane + (col === 0 ? -DISC_R * 0.55 : DISC_R * 0.55),
      y: PLANK_TOP + DISC_T / 2,
      z: -BOARD_SIZE * 0.4 + rowN * (DISC_T * 1.2 + STEP * 0.18),
    };
  }

  // Snap a captured disc straight to its rail slot (snapshot rebuild path).
  function parkOnRail(rec) {
    setGlow(rec, false);
    rec.onBoard = false;
    const dest = railDest(rec.color);
    rec.mesh.scale.set(1, 1, 1);
    rec.mesh.rotation.set(0, 0, 0);
    rec.mesh.position.set(dest.x, dest.y, dest.z);
    rec.baseMat.opacity = 1;
    rec.baseMat.transparent = false;
    rec.mesh.visible = true;
  }

  function clearRails() {
    railCount.red = 0;
    railCount.black = 0;
  }

  // ===========================================================================
  // update(dt) — the ONLY animation driver. InWorldBoard pumps this every frame
  // (and the ambient mount drives it too). The logical model is always already
  // current; everything here is purely cosmetic and may safely trail.
  // ===========================================================================
  function update(dt) {
    if (disposed) return;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;

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
        gp.y = REST_Y + Math.sin(k * Math.PI) * HOP_Y;
        const sq = k > 0.85 ? Math.sin((k - 0.85) / 0.15 * Math.PI) * 0.1 : 0;
        a.rec.mesh.scale.set(1 + sq, 1 - sq, 1 + sq);
      } else {
        gp.y = REST_Y;
      }
      // Peel the captured disc onto its rail as the hopper clears it.
      if (seg.capRec && !seg.captureFired && k >= 0.55) {
        seg.captureFired = true;
        fadeCapture(seg.capRec);
      }
      if (k >= 1) {
        gp.set(seg.toX, REST_Y, seg.toZ);
        a.rec.mesh.scale.set(1, 1, 1);
        a.i += 1;
        a.t = 0;
        if (a.i >= a.segs.length) {
          hops.splice(i, 1);
          if (a.promotes) setKing(a.rec, true, false);
          if (a.onDone) a.onDone();
        }
      }
    }

    // Captured discs: fade + sink in place, then snap to their rail slot.
    for (let i = fades.length - 1; i >= 0; i--) {
      const f = fades[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = easeInOut(k);
      const gp = f.rec.mesh.position;
      gp.y = f.y0 - e * DISC_T * 1.2;
      const sc = 1 - e * 0.4;
      f.rec.mesh.scale.set(sc, sc, sc);
      f.rec.baseMat.opacity = 1 - e;
      f.rec.capMat.opacity = 1 - e;
      if (k >= 1) {
        fades.splice(i, 1);
        parkOnRail(f.rec); // restores opacity/scale and places on the rail
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

    // Idle motion: glow + lift selectable discs, bob/spin the target tokens.
    if (glowing.size > 0 || targets.length > 0) {
      idleT += dt;
      const pulse = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(idleT * 4.2));
      const lift = LIFT_Y * (0.5 + 0.5 * Math.sin(idleT * 4.2));
      for (const id of glowing) {
        const rec = pieces.get(id);
        if (!rec) continue;
        rec.baseMat.emissive.copy(GLOW[rec.color]);
        rec.baseMat.emissiveIntensity = pulse;
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

  // Fade a captured disc out (model already removed it from the id grid).
  function fadeCapture(rec) {
    if (!rec) return;
    rec.onBoard = false;
    setGlow(rec, false);
    rec.baseMat.transparent = true;
    rec.capMat.transparent = true;
    fades.push({ rec, t: 0, dur: 0.4, y0: rec.mesh.position.y });
  }

  // -------------------------------------------------------------------------
  // Build the per-segment glide/hop visual. The MODEL is already mutated by
  // performMove; this is purely cosmetic. capRecs[i] is the captured disc peeled
  // off during segment i (or null).
  // -------------------------------------------------------------------------
  function animateMove(rec, from, steps, capRecs, promotes, onDone) {
    if (!rec) { if (onDone) onDone(); return; }
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
  }

  // -------------------------------------------------------------------------
  // Apply a validated move. The LOGICAL MODEL is the source of truth and is mutated
  // SYNCHRONOUSLY here (re-home the disc id, clear captured ids, set the king flag)
  // so afterMove()'s rules/turn computation is correct regardless of animation
  // timing. The meshes then TRAIL via animateMove().
  // -------------------------------------------------------------------------
  function performMove(from, steps, captured) {
    const id = idAt(from.r, from.c);
    const rec = id ? pieces.get(id) : null;
    const final = steps[steps.length - 1];
    const promotes = !!rec && !rec.king && final.r === KING_ROW[rec.color];

    if (rec) {
      board[from.r][from.c] = 0;
      board[final.r][final.c] = id;
      if (promotes) rec.king = true; // logical flag now; crown mesh springs in on land
    }

    const pts = [{ r: from.r, c: from.c }, ...steps];
    const capRecs = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      let capRec = null;
      if (Math.abs(b.r - a.r) === 2) {
        const mr = (a.r + b.r) / 2, mc = (a.c + b.c) / 2;
        if (captured.some((cp) => cp.r === mr && cp.c === mc)) {
          const cid = board[mr][mc];
          capRec = cid ? pieces.get(cid) : null;
          board[mr][mc] = 0;
        }
      }
      capRecs.push(capRec);
    }

    busy = true;
    animateMove(rec, from, steps, capRecs, promotes, () => { busy = false; });
    if (!rec) busy = false; // nothing to animate (drift) — don't get stuck busy
  }

  // -------------------------------------------------------------------------
  // Turn resolution: flip the turn, detect loss-by-no-moves (the side to move with
  // NO legal moves loses — covers an empty side AND a fully-blocked side), then
  // refresh highlights.
  // -------------------------------------------------------------------------
  function afterMove() {
    turn = other(turn);
    if (allMoves(logicalBoard(), turn).length === 0) {
      phase = "over";
      winner = other(turn);
      clearSelection();
      clearHighlights();
      updateIdentityCues();
      try { ctx.onGameOver({ winner, reason: "no-moves" }); } catch { /* framework optional */ }
      return;
    }
    refreshHighlights();
  }

  // ===========================================================================
  // Highlights — gold selection ring on the picked disc's well, bobbing gold
  // targets on legal landings, hover glow/lift on each selectable disc. ONLY for
  // the seated player on their turn; spectators / off-turn see none.
  // ===========================================================================
  function myTurnNow() {
    const gate = typeof ctx.isLocalTurnAllowed === "function" ? ctx.isLocalTurnAllowed() : (turn === myColor);
    return phase === "play" && role !== "spectator" && turn === myColor && gate;
  }

  function refreshHighlights() {
    clearHighlights();
    updateIdentityCues();
    if (!myTurnNow()) return;
    const moves = allMoves(logicalBoard(), myColor);

    if (!selectedFrom) {
      const selectable = new Set(moves.map((m) => m.from.r * 8 + m.from.c));
      for (const idx of selectable) {
        const rec = pieceAt(Math.floor(idx / 8), idx % 8);
        if (rec) setGlow(rec, true);
      }
      return;
    }

    const selRec = pieceAt(selectedFrom.r, selectedFrom.c);
    if (selRec) setGlow(selRec, true);

    selRingMesh = new THREE.Mesh(G.selRing, M.selRing);
    selRingMesh.rotation.x = Math.PI / 2;
    selRingMesh.position.set(cellX(selectedFrom.c), PLANK_TOP + 0.0016, cellZ(selectedFrom.r));
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
  // onPointer — the seated player clicked a resolved board cell. Select a movable
  // piece, click a target to advance/commit a (possibly multi-jump) move, click
  // elsewhere to cancel/reselect.
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
          candidateSeqs = continuing;
          refreshHighlights();
        } else if (finished) {
          commitMove(finished.from, finished.steps, finished.captured);
        }
        return;
      }
      clearSelection();
    }

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
  // (from+steps only), advance the turn, then (host) push an authoritative snapshot.
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
  // recompute captures via matchLegalMove. On mismatch THROW GameDesync so the
  // framework requests an authoritative snapshot.
  // ===========================================================================
  function applyMove(move) {
    if (phase !== "play") throw new GameDesync("checkers: move while not in play");
    if (!move || move.type !== "move") return false;
    const legal = matchLegalMove(logicalBoard(), turn, move);
    if (!legal) throw new GameDesync("checkers: no matching legal move");
    clearSelection();
    clearHighlights();
    performMove(legal.from, legal.steps, legal.captured);
    afterMove();
    // Mirror commitMove(): after the host applies a relayed GUEST move, re-broadcast
    // an authoritative snapshot. This refreshes the server's full/pub cache and fires
    // broadcastAmbient so spectators, late joiners, resyncs, and ambient passersby all
    // converge on the position AFTER the guest's move (capture/king/game-over included).
    if (role === "host") pushSnapshot();
    return true;
  }

  // ===========================================================================
  // applyState — render an AUTHORITATIVE FULL snapshot. Idempotent. Reconciles the
  // pool by MOVING existing discs into place and parking surplus, never rebuilding
  // meshes. state === null => fresh game. NEVER recomputes local colour from wire.
  // ===========================================================================
  function applyState(state) {
    hops.length = 0;
    fades.length = 0;
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

  // Reconcile the pool to a logical target with minimal churn: gather available
  // discs per colour, consume one per wanted square (snap home + set king flag),
  // park the leftovers. `instant` skips spring-ins (always true for a snapshot).
  function setBoardFromLogical(logical, newTurn, newPhase, newWinner, instant) {
    board = emptyGrid();
    clearRails();

    const avail = { red: [], black: [] };
    for (const rec of pieces.values()) avail[rec.color].push(rec);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const want = logical[r][c];
        if (!want) continue;
        const rec = avail[want.color].pop();
        if (!rec) continue;
        rec.onBoard = true;
        rec.mesh.visible = true;
        rec.mesh.scale.set(1, 1, 1);
        rec.mesh.rotation.set(0, 0, 0);
        rec.baseMat.emissive.set("#000000");
        rec.baseMat.emissiveIntensity = 1;
        rec.baseMat.opacity = 1;
        rec.baseMat.transparent = false;
        rec.capMat.opacity = 1;
        rec.capMat.transparent = false;
        setKing(rec, !!want.king, instant);
        placeMesh(rec, r, c, REST_Y);
        board[r][c] = rec.id;
      }
    }

    for (const rec of avail.red) parkOnRail(rec);
    for (const rec of avail.black) parkOnRail(rec);

    turn = newTurn;
    phase = newPhase;
    winner = newWinner;
  }

  // Decode a logical board from a structured 2D array OR a compact 64-char string.
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
  // Snapshots — full-information game, so public state IS the full state. Encode
  // BOTH a structured board and a compact `cells` string.
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
  // Role / seat changes — switch in place. We own our facing (orientPolicy:"self"),
  // so re-run applyFacing(), then re-gate the local-only highlights.
  // ===========================================================================
  function setRole(newRole) {
    role = newRole || "spectator";
    myColor = role === "host" ? "red" : role === "guest" ? "black" : null;
    applyFacing();
    clearSelection();
    refreshHighlights();
  }
  function setSeatRy(ry) {
    seatRy = ry;
    applyFacing();
    refreshHighlights();
  }

  // ===========================================================================
  // dispose — free GPU resources, drop the group. No internal loop to stop.
  // ===========================================================================
  function dispose() {
    disposed = true;
    hops.length = 0;
    fades.length = 0;
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
  // snapshot uses, so first-paint and catch-up share one code path.
  setBoardFromLogical(initialBoard(), "red", "play", null, true);
  refreshHighlights();

  return {
    group,
    // We own our own per-seat facing (applyFacing): orientFor(seatRy) plus a PI
    // half-turn for red so each player sees their OWN army near. board.js must NOT
    // also rotate the group, or the two would fight.
    orientPolicy: "self",
    applyState,
    applyMove,
    onPointer,
    update,
    publicState,
    setRole,
    setSeatRy,
    dispose,
    // Convenience for the framework/tests (not part of the required surface).
    isOurTurn: () => phase === "play" && turn === myColor && role !== "spectator",
  };
}

export default createGame;
