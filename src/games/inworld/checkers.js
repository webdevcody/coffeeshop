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
const LIFT_Y = STEP * 0.05;           // gentle hover lift for the SELECTED disc (reduced so the contact shadow doesn't detach)

const RAIL_GAP = HALF + FRAME_W / 2; // lane centred on the frame band (X=0.365); the frame band spans X∈[HALF, HALF+FRAME_W] = [0.350, 0.380]

// Captured discs rack as small chips on the frame band. The band is only FRAME_W
// (0.030 m) wide — far narrower than a full disc (0.070 m) — so a full-size disc
// would overhang BOTH the playable field (inner) and the table rim (outer). We
// therefore shrink parked discs to PARK_SCALE so a single column sits FULLY within
// the frame band: parked radius = DISC_R*PARK_SCALE = 0.014, diameter 0.028, which
// fits inside the 0.030-wide band centred on RAIL_GAP. Reads as a neat trophy rack.
const PARK_SCALE = 0.40;
const PARK_R = DISC_R * PARK_SCALE;   // 0.014 m — half the racked chip's diameter

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
    // Black men: lift the diffuse value (#34302b) and add a touch more metalness so a
    // near-black disc still reads clearly against the dark #7a4a25 wells from BOTH
    // seats. Emissive stays black so the hover-glow on/off reset path is unaffected.
    black: new THREE.MeshStandardMaterial({ color: "#34302b", roughness: 0.46, metalness: 0.18, emissive: "#000000" }),
    gold: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.72, emissive: "#5a3c00", emissiveIntensity: 0.32 }),
    selRing: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.34, metalness: 0.5, emissive: "#e0a23a", emissiveIntensity: 0.5, transparent: true, opacity: 0.92, depthWrite: false }),
    target: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.3, emissive: "#e0a23a", emissiveIntensity: 0.55, transparent: true, opacity: 0.7, depthWrite: false }),
    // Faint preview of the FURTHER steps of a committed multi-jump chain (steps beyond
    // the immediate next landing), so a long jump's full path reads ahead of time.
    targetGhost: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.3, metalness: 0.3, emissive: "#e0a23a", emissiveIntensity: 0.3, transparent: true, opacity: 0.3, depthWrite: false }),
    // Last-move trail (spectator-safe, shown to EVERYONE): a faint dark ring on the
    // previous move's from-square and a brighter gold ring on its to-square. Cosmetic
    // readability cue; cleared on applyState. depthWrite:false + low opacity like selRing.
    trailFrom: new THREE.MeshStandardMaterial({ color: "#2c1d11", roughness: 0.7, metalness: 0.1, emissive: "#1a1208", emissiveIntensity: 0.25, transparent: true, opacity: 0.4, depthWrite: false }),
    trailTo: new THREE.MeshStandardMaterial({ color: "#e0a23a", roughness: 0.34, metalness: 0.5, emissive: "#e0a23a", emissiveIntensity: 0.35, transparent: true, opacity: 0.5, depthWrite: false }),
    invisible: new THREE.MeshBasicMaterial({ visible: false }),
    homeRed: new THREE.MeshStandardMaterial({ color: "#c4452f", roughness: 0.5, metalness: 0.1, emissive: "#c4452f", emissiveIntensity: 0.0 }),
    homeBlack: new THREE.MeshStandardMaterial({ color: "#2a2320", roughness: 0.5, metalness: 0.1, emissive: "#6b6058", emissiveIntensity: 0.12 }),
    lampRed: new THREE.MeshStandardMaterial({ color: "#c4452f", roughness: 0.35, metalness: 0.2, emissive: "#e7796a", emissiveIntensity: 0.0 }),
    lampBlack: new THREE.MeshStandardMaterial({ color: "#2a2320", roughness: 0.35, metalness: 0.2, emissive: "#6b6058", emissiveIntensity: 0.0 }),
  };
  const GLOW = { red: new THREE.Color("#e7796a"), black: new THREE.Color("#6b6058") };
  // Forced-capture emphasis: a warm amber the selectable glow blends toward, plus a
  // single reusable scratch colour so the per-frame blend allocates nothing.
  const FORCE_GLOW = new THREE.Color("#ff9a3c");
  const _glowScratch = new THREE.Color();

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

  const OUTER = BOARD_SIZE + FRAME_W * 2;
  const G = {
    disc: discProfile(),
    cap: discProfile(),                                                    // king's stacked second disc
    crown: new THREE.TorusGeometry(DISC_R * 0.94, DISC_R * 0.12, 8, 20),   // gold crown ring
    well: new THREE.BoxGeometry(STEP * 0.92, WELL_D + 0.001, STEP * 0.92), // sunk square well floor
    tile: new THREE.BoxGeometry(STEP, STEP * 0.6, STEP),                   // light-square filler (cosmetic, between wells)
    selRing: new THREE.TorusGeometry(DISC_R * 1.12, DISC_R * 0.1, 8, 28),
    trailRing: new THREE.TorusGeometry(DISC_R * 1.18, DISC_R * 0.08, 8, 28), // last-move from/to markers
    target: new THREE.CylinderGeometry(STEP * 0.22, STEP * 0.22, STEP * 0.04, 24),
    hit: new THREE.BoxGeometry(STEP * 0.98, DISC_T * 3, STEP * 0.98),      // per-square collider
    homeBar: new THREE.BoxGeometry(BOARD_SIZE * 0.7, FRAME_H * 0.5, FRAME_W * 0.5),
    lamp: new THREE.SphereGeometry(FRAME_W * 0.32, 18, 14),
    plank: new THREE.BoxGeometry(OUTER, PLANK_H, OUTER),                   // solid base plank
    frameLong: new THREE.BoxGeometry(OUTER, FRAME_H, FRAME_W),             // ±Z frame rails
    frameSide: new THREE.BoxGeometry(FRAME_W, FRAME_H, OUTER - FRAME_W * 2), // ±X frame rails
    capRail: new THREE.BoxGeometry(FRAME_W * 0.9, 0.006, BOARD_SIZE * 0.62), // captured-chip tray, sized to sit WITHIN the frame band (X) and span the rack run (Z)
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
  let hoverKey = -1;   // r*8+c of the hovered legal target (mouse pre-click feedback), or -1
  let hoverPieceId = 0; // id of a hovered selectable own disc (legal from-square), or 0 — boosts its glow
  let forcedCapture = false; // true when the local player's ONLY legal moves are captures (drives a warmer/faster glow)

  // ---- Last-move trail (persistent, shown to EVERYONE incl. spectators) ----
  // The from/to squares of the most recent committed/applied move. Drawn as faint
  // rings so both players AND spectators can read what just happened. Distinct from
  // the turn-gated highlights above (cleared on applyState, not on every refresh).
  let lastMove = null;          // { from:{r,c}, to:{r,c} } in canonical cell coords
  const trailMeshes = [];       // the from/to ring meshes currently in the scene

  // ---- Persistent identity / turn cues (built once) -----------------------
  const cue = { red: { bar: null, lamp: null }, black: { bar: null, lamp: null } };

  // ---- Animation pools (advanced by update(dt); NO internal rAF) ----------
  const hops = [];     // a disc gliding/hopping along a move path, segment by segment
  const fades = [];    // a captured disc fading + sinking, then parked on a rail
  const crowns = [];   // a king cap + ring springing in on promotion
  const settles = [];  // a tiny squash-and-settle as a non-jump glide seats into its well
  let idleT = 0;       // accumulator for the steady glow/target idle motion
  // Transient one-shot cue pulses (purely cosmetic, advanced in update()):
  //   handoffT  — a brief brighten of the LOCAL home bar when the turn arrives.
  //   winT      — a sustained brighten/pulse of the winner's bar+lamp on game over.
  let handoffT = 0;    // >0 while the turn-arrival pulse plays
  let winPulseT = 0;   // accumulator that drives the win flourish while phase==="over"
  let winHopT = 0;     // one-shot accumulator: winner's surviving discs do a brief victory hop
  const WIN_HOP_DUR = 1.6; // seconds the victory-hop wave plays before settling
  let glintT = 0;      // accumulator for the faint continuous king gold glint
  let kingCount = 0;   // number of kings currently on the board (gates the glint)
  const HANDOFF_DUR = 0.5; // seconds the turn-arrival bar pulse lasts

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
    const plank = new THREE.Mesh(G.plank, M.plank);
    plank.position.y = PLANK_H / 2;
    plank.castShadow = true;
    plank.receiveShadow = true;
    group.add(plank);

    // Raised frame rails framing the field.
    const frameY = PLANK_TOP + FRAME_H / 2;
    const off = HALF + FRAME_W / 2;
    for (const [geo, x, z] of [[G.frameLong, 0, -off], [G.frameLong, 0, off], [G.frameSide, -off, 0], [G.frameSide, off, 0]]) {
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

    // Two captured-disc trays inset into the -X / +X frame top. Captured black discs
    // park on +X (red's rail), captured red on -X. The tray's top sits flush with the
    // frame top so racked discs (seated at frame-top + DISC_T/2) read as resting in it.
    const trayTop = PLANK_TOP + FRAME_H;
    for (const sx of [-1, 1]) {
      const railMesh = new THREE.Mesh(G.capRail, M.rail);
      railMesh.position.set(sx * RAIL_GAP, trayTop - 0.003, 0);
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
    // Per-side ambient floor for the home bar when it is NOT the local player's. The
    // black bar (near-black diffuse on the dark-brown frame) needs a small constant
    // glow to read as 'this side is black' from the opponent's seat; the red bar is
    // already legible at its bright diffuse, so it stays low. A SPECTATOR (myColor
    // null) gets an identity floor on BOTH bars so each side reads as its colour, and
    // the side-to-move lamp stays clearly visible so a passerby can read whose turn it
    // is. Seated players are unchanged. No rules/sync touched here.
    const spectator = myColor == null;
    const barFloor = spectator ? { red: 0.18, black: 0.18 } : { red: 0.0, black: 0.12 };
    for (const color of ["red", "black"]) {
      const c = cue[color];
      if (!c.bar || !c.lamp) continue;
      const isMine = myColor != null && color === myColor;
      const isTurn = phase === "play" && turn === color;
      // Cache the steady base so update()'s transient pulses layer on top of it.
      c.barBase = isMine ? 0.6 : barFloor[color];
      c.lampBase = isTurn ? (isMine ? 1.0 : (spectator ? 0.6 : 0.45)) : 0.0;
      c.bar.material.emissiveIntensity = c.barBase;
      c.lamp.material.emissiveIntensity = c.lampBase;
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
    // Tag the disc with its current square so hitToCell's ancestor walk resolves a
    // click on the disc body (proud/lifted/mid-hop) to the disc's OWN cell, never a
    // neighbour and never null. Cleared to null when the disc leaves the board
    // (fadeCapture / parkOnRail) so a parked disc never resolves to a stale square.
    rec.mesh.userData.cell = { r, c };
  }

  // ===========================================================================
  // hitToCell — authoritative pointer->cell resolver (board.js tier 1). Exposing
  // it makes our mapping authoritative so disc clicks never depend on the thin
  // per-square collider box. Walk the hit's parent chain for the FIRST
  // userData.cell (covers BOTH the flat colliders AND tagged disc groups), then
  // fall back to a round()-based geometric snap in the group's local frame (same
  // flat self-oriented board as chess.js).
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
      if (inBounds(r, c) && playable(r, c)) return { r, c };
    }
    return null;
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
  // captured black on +X. A SINGLE column of small chips, CENTRED on the frame band:
  //   * X = lane (RAIL_GAP) — chip diameter (2*PARK_R = 0.028) fits inside the
  //     0.030-wide band, so nothing overhangs the field (inner) or table rim (outer).
  //   * Z is centred: slot 0..11 maps symmetrically around z=0 so the rack fills the
  //     tray evenly instead of hugging one end (the old two-column layout overlapped
  //     its own neighbours by ~0.041 m AND overhung the outer frame by 0.035 m).
  const RACK_ROWS = 12;
  const RACK_DZ = PARK_R * 2 + 0.0035;        // chip diameter + a small gap (0.0315 m)
  function railDest(color) {
    const sx = color === "red" ? -1 : 1;
    const slot = Math.min(railCount[color]++, RACK_ROWS - 1);
    const lane = sx * RAIL_GAP;
    return {
      x: lane,
      y: PLANK_TOP + FRAME_H + (DISC_T * PARK_SCALE) / 2, // chip seated on the tray top
      z: (slot - (RACK_ROWS - 1) / 2) * RACK_DZ,          // centred run around z=0
    };
  }

  // Snap a captured disc straight to its rail slot (snapshot rebuild path).
  function parkOnRail(rec) {
    setGlow(rec, false);
    setKing(rec, false, true); // a parked disc is always demoted to a plain man (drop crown + stacked cap)
    rec.onBoard = false;
    rec.mesh.userData.cell = null; // off-board: never resolve a click to a stale square
    const dest = railDest(rec.color);
    // Shrink the racked disc to a chip so a full column fits within the frame band
    // without overhanging the field or the table rim (see PARK_SCALE / railDest).
    rec.mesh.scale.set(PARK_SCALE, PARK_SCALE, PARK_SCALE);
    rec.mesh.rotation.set(0, 0, 0);
    rec.mesh.position.set(dest.x, dest.y, dest.z);
    rec.baseMat.opacity = 1;
    rec.baseMat.transparent = false;
    // Clear any capture-flash emissive so a racked disc reads as a plain matte man.
    rec.baseMat.emissive.set("#000000");
    rec.baseMat.emissiveIntensity = 1;
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
        const wasJump = seg.jump;
        a.i += 1;
        a.t = 0;
        if (a.i >= a.segs.length) {
          hops.splice(i, 1);
          if (a.promotes) setKing(a.rec, true, false);
          // Landing settle: a tiny squash-and-seat for a non-jump glide (jump landings
          // already squash mid-hop), so pieces "seat" into the well rather than snap.
          if (!wasJump && !isHopping(a.rec.id)) settles.push({ rec: a.rec, t: 0, dur: 0.12 });
          if (a.onDone) a.onDone();
        }
      }
    }

    // Landing settle: scale 1.06 -> 1 (slight squash) as a glided disc seats home.
    for (let i = settles.length - 1; i >= 0; i--) {
      const s = settles[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      // A gentle squash that recovers: y dips then returns, xz bulges then returns.
      const sq = Math.sin(k * Math.PI) * 0.06;
      s.rec.mesh.scale.set(1 + sq, 1 - sq, 1 + sq);
      if (k >= 1) {
        s.rec.mesh.scale.set(1, 1, 1);
        settles.splice(i, 1);
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
      // Capture flourish: emissive flashes up then back down (0->0.6->0) as it sinks.
      f.rec.baseMat.emissiveIntensity = Math.sin(k * Math.PI) * 0.6;
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

    // Idle motion: pulse the emissive glow on every selectable disc; LIFT only the
    // actually-SELECTED disc (its shadow detaching is hidden by the gold ring under
    // it), so the rest of the selectable set glows without the floaty-shadow jank.
    if (glowing.size > 0 || targets.length > 0) {
      idleT += dt;
      // Forced-capture turns pulse FASTER and a touch BRIGHTER, and the glow blends
      // toward a warm amber — a clear "you must jump" cue. Quiet turns keep the calm
      // slow pulse in each side's own colour.
      const freq = forcedCapture ? 6.4 : 4.2;
      const wave = 0.5 + 0.5 * Math.sin(idleT * freq);
      const pulse = forcedCapture ? 0.4 + 0.45 * wave : 0.3 + 0.3 * wave;
      const lift = LIFT_Y * (0.5 + 0.5 * Math.sin(idleT * freq));
      const selId = selectedFrom ? idAt(selectedFrom.r, selectedFrom.c) : 0;
      for (const id of glowing) {
        const rec = pieces.get(id);
        if (!rec) continue;
        if (forcedCapture) {
          // Blend the side's glow toward amber (no allocation: reuse the scratch colour).
          _glowScratch.copy(GLOW[rec.color]).lerp(FORCE_GLOW, 0.6);
          rec.baseMat.emissive.copy(_glowScratch);
        } else {
          rec.baseMat.emissive.copy(GLOW[rec.color]);
        }
        // Pre-pick hover: brighten the disc the cursor is resting on (mouse affordance).
        rec.baseMat.emissiveIntensity = pulse + (id === hoverPieceId ? 0.35 : 0);
        if (!isHopping(rec.id)) {
          rec.mesh.position.y = (id === selId) ? REST_Y + lift : REST_Y;
        }
      }
      const bob = Math.sin(idleT * 3.0) * STEP * 0.045;
      for (const t of targets) {
        const tt = t.userData.target;
        const hovered = tt && (tt.r * 8 + tt.c) === hoverKey;
        // Hovered legal target: lift a touch and scale up so the mouse user gets clear
        // pre-click feedback (the shared material can't be per-instance tinted, so we
        // use a geometric pop — purely cosmetic, no rules/sync touched).
        t.position.y = t.userData.baseY + bob + (hovered ? STEP * 0.06 : 0);
        t.rotation.y = idleT * (hovered ? 3.0 : 1.6);
        const s = hovered ? 1.35 : 1;
        t.scale.set(s, 1, s);
      }
    }

    // Faint continuous gold glint on every king so crowned discs stay distinguishable
    // at a glance from both seats. Drives only the shared gold material's emissive
    // intensity (no per-disc allocation), shimmering gently around its base value.
    if (kingCount > 0) {
      glintT += dt;
      M.gold.emissiveIntensity = 0.32 + 0.14 * (0.5 + 0.5 * Math.sin(glintT * 2.4));
    }

    // Turn-handoff flourish: a brief brighten of the LOCAL home bar when the turn
    // arrives, so the player FEELS the turn land. Additive over the steady base.
    if (handoffT > 0 && myColor != null) {
      handoffT = Math.max(0, handoffT - dt);
      const c = cue[myColor];
      if (c && c.bar) {
        const k = 1 - handoffT / HANDOFF_DUR;        // 0..1 across the pulse
        const add = Math.sin(k * Math.PI) * 0.35;    // 0 -> +0.35 -> 0
        c.bar.material.emissiveIntensity = (c.barBase || 0) + add;
      }
    }

    // Win flourish: while the game is over, gently pulse the WINNER's home bar+lamp
    // brighter so the result reads clearly. Cosmetic only; gated by local `winner`.
    if (phase === "over" && winner) {
      winPulseT += dt;
      const c = cue[winner];
      if (c && c.bar && c.lamp) {
        const w = 0.5 + 0.5 * Math.sin(winPulseT * 3.2);
        c.bar.material.emissiveIntensity = 0.55 + 0.35 * w;
        c.lamp.material.emissiveIntensity = 0.55 + 0.45 * w;
      }

      // Victory hop (one-shot): the winner's surviving discs do a brief synchronized
      // bobbing wave, then settle back to rest. Reads only `winner`/`phase`, so every
      // viewer (both players AND spectators) sees the win celebrated. No rules/sync.
      if (winHopT > 0) {
        winHopT = Math.max(0, winHopT - dt);
        const prog = 1 - winHopT / WIN_HOP_DUR;       // 0..1 across the celebration
        const envelope = Math.sin(prog * Math.PI);    // ramp in then out (no snap at the ends)
        for (const rec of pieces.values()) {
          if (!rec.onBoard || rec.color !== winner) continue;
          if (isHopping(rec.id)) continue;            // never fight an in-flight glide (defensive)
          const cell = rec.mesh.userData.cell;
          const phaseOff = cell ? (cell.r + cell.c) * 0.6 : 0; // board-position wave
          const bob = Math.abs(Math.sin(prog * Math.PI * 3 + phaseOff));
          rec.mesh.position.y = REST_Y + envelope * bob * HOP_Y * 0.45;
        }
        if (winHopT === 0) {
          // Settle every winner disc flat once the wave ends.
          for (const rec of pieces.values()) {
            if (rec.onBoard && rec.color === winner && !isHopping(rec.id)) rec.mesh.position.y = REST_Y;
          }
        }
      }
    }
  }

  function isHopping(id) {
    for (const a of hops) if (a.rec.id === id) return true;
    return false;
  }

  // Snap every in-flight cosmetic animation straight to its final state. Used when
  // a relayed move arrives while a previous hop is still gliding (applyMove): the
  // logical board is already current, so we fast-forward the meshes rather than let
  // two discs glide concurrently (which can also target a disc mid-hop).
  function finishAnimations() {
    // Fades: drop captured discs onto their rail (mirrors the k>=1 branch).
    for (const f of fades) parkOnRail(f.rec);
    fades.length = 0;

    // Hops: snap each hopper to its final landing, then run promote/onDone.
    for (const a of hops) {
      const last = a.segs[a.segs.length - 1];
      a.rec.mesh.position.set(last.toX, REST_Y, last.toZ);
      a.rec.mesh.scale.set(1, 1, 1);
      // Fire any captures not yet peeled off (segment never reached its trigger).
      for (const seg of a.segs) {
        if (seg.capRec && !seg.captureFired) {
          seg.captureFired = true;
          parkOnRail(seg.capRec);
        }
      }
      if (a.promotes) setKing(a.rec, true, true);
      if (a.onDone) a.onDone();
    }
    hops.length = 0;

    // Crowns: settle any springing-in cap/ring instantly.
    for (const cr of crowns) {
      cr.rec.cap.scale.setScalar(1);
      cr.rec.crown.scale.setScalar(1);
      cr.rec.cap.position.y = DISC_T * 0.9;
    }
    crowns.length = 0;

    // Settles: collapse any in-flight landing squash back to unit scale.
    for (const s of settles) s.rec.mesh.scale.set(1, 1, 1);
    settles.length = 0;
    busy = false;
  }

  // Fade a captured disc out (model already removed it from the id grid).
  function fadeCapture(rec) {
    if (!rec) return;
    rec.onBoard = false;
    rec.mesh.userData.cell = null; // off-board: stop resolving clicks to its old square
    setGlow(rec, false);
    rec.baseMat.transparent = true;
    rec.capMat.transparent = true;
    // Capture flourish: flash the captured disc's own glow colour, ramped down over
    // the fade in update() for a satisfying "sink." parkOnRail resets it afterwards.
    rec.baseMat.emissive.copy(GLOW[rec.color]);
    rec.baseMat.emissiveIntensity = 0;
    fades.push({ rec, t: 0, dur: 0.42, y0: rec.mesh.position.y });
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

    // Drift guard: if the moving disc's id is missing (id grid out of sync with a
    // snapshot), bail out WITHOUT touching the board — otherwise the capture loop
    // below would delete captured piece ids from the authoritative grid while the
    // mover was never actually moved, corrupting turn/game-over computation.
    if (!rec) {
      busy = false;
      return false;
    }

    board[from.r][from.c] = 0;
    board[final.r][final.c] = id;
    // Re-tag the mover with its destination square NOW (the mesh still trails via the
    // hop), so a click landing on the disc mid-glide resolves to where it's going,
    // matching the already-authoritative id grid.
    rec.mesh.userData.cell = { r: final.r, c: final.c };
    if (promotes) { rec.king = true; kingCount++; } // logical flag now; crown mesh springs in on land

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

    // Record the last move for the persistent trail (drawn for everyone). Set here so
    // BOTH the local commit path and the remote apply path get it through one place.
    lastMove = { from: { r: from.r, c: from.c }, to: { r: final.r, c: final.c } };
    refreshTrail();

    busy = true;
    animateMove(rec, from, steps, capRecs, promotes, () => { busy = false; });
    return true;
  }

  // -------------------------------------------------------------------------
  // Turn resolution: flip the turn, detect loss-by-no-moves (the side to move with
  // NO legal moves loses — covers an empty side AND a fully-blocked side), then
  // refresh highlights.
  // -------------------------------------------------------------------------
  // Recompute the king tally from the authoritative id grid. Promotion bumps
  // kingCount in performMove, but a CAPTURED king (its id cleared from the grid)
  // never decremented it, so a delta-only game would let kingCount drift upward and
  // keep the gold glint running forever. Recomputing here keeps the delta path as
  // authoritative as the snapshot path (which recomputes in setBoardFromLogical).
  function recomputeKingCount() {
    let n = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const rec = pieceAt(r, c);
        if (rec && rec.king) n++;
      }
    }
    kingCount = n;
  }

  function afterMove() {
    recomputeKingCount();
    turn = other(turn);
    if (allMoves(logicalBoard(), turn).length === 0) {
      phase = "over";
      winner = other(turn);
      winPulseT = 0;
      winHopT = WIN_HOP_DUR; // arm the one-shot victory hop for the winner's discs
      clearSelection();
      clearHighlights();
      updateIdentityCues();
      try { ctx.onGameOver({ winner, reason: "no-moves" }); } catch { /* framework optional */ }
      return;
    }
    // The turn just arrived to the LOCAL seated player — fire the handoff flourish.
    if (myColor != null && turn === myColor && role !== "spectator") handoffT = HANDOFF_DUR;
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
    if (!myTurnNow()) { forcedCapture = false; return; }
    const moves = allMoves(logicalBoard(), myColor);
    // allMoves() returns ONLY captures when any exist (mandatory-capture rule), so a
    // non-empty set that is all-captures means the player is forced to jump. Drive a
    // warmer/faster selectable glow off this so "you must jump" reads at a glance.
    forcedCapture = moves.length > 0 && moves.every((m) => m.captured.length > 0);

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
    // Lift clearly above the light filler tiles' top face so a grazing seated angle
    // can't z-fight/shimmer (the material is depthWrite:false + renderOrder 2).
    selRingMesh.position.set(cellX(selectedFrom.c), PLANK_TOP + 0.004, cellZ(selectedFrom.r));
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

    // Multi-jump path preview: when the selection has narrowed to a SINGLE remaining
    // chain, faintly mark its further landings (beyond the immediate next) so the
    // player sees where a long jump ends. Only when unambiguous, to avoid clutter.
    if (candidateSeqs.length === 1) {
      const only = candidateSeqs[0];
      for (let i = pathSoFar.length + 1; i < only.steps.length; i++) {
        const s = only.steps[i];
        if (seen.has(s.r * 8 + s.c)) continue;
        seen.add(s.r * 8 + s.c);
        addTarget(s.r, s.c, true);
      }
    }
  }

  // `ghost` true => a faint, lower preview marker for a FURTHER step of a single
  // remaining jump chain (not the immediate landing). Ghosts are NOT hover/click
  // targets (no userData.target), they only hint where a long jump continues.
  function addTarget(r, c, ghost) {
    const t = new THREE.Mesh(G.target, ghost ? M.targetGhost : M.target);
    const baseY = REST_Y + (ghost ? STEP * 0.1 : STEP * 0.18);
    t.position.set(cellX(c), baseY, cellZ(r));
    t.userData.baseY = baseY;
    if (!ghost) t.userData.target = { r, c };
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
    hoverKey = -1;
    hoverPieceId = 0;
    if (selRingMesh) { group.remove(selRingMesh); selRingMesh = null; }
  }

  // -------------------------------------------------------------------------
  // Last-move trail: rebuild the two faint rings to match `lastMove`. Shown to
  // EVERYONE (seated players AND spectators) since it is pure read-only history —
  // it is NOT gated by myTurnNow(). Cleared (lastMove=null) in applyState so a
  // fresh game / authoritative resync doesn't carry a stale marker.
  function clearTrail() {
    for (const m of trailMeshes) group.remove(m);
    trailMeshes.length = 0;
  }
  function addTrailRing(r, c, mat) {
    const ring = new THREE.Mesh(G.trailRing, mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cellX(c), PLANK_TOP + 0.0035, cellZ(r));
    ring.renderOrder = 1; // under the selRing (2) / targets (3) so live cues stay on top
    group.add(ring);
    trailMeshes.push(ring);
  }
  function refreshTrail() {
    clearTrail();
    if (!lastMove) return;
    addTrailRing(lastMove.from.r, lastMove.from.c, M.trailFrom);
    addTrailRing(lastMove.to.r, lastMove.to.c, M.trailTo);
  }

  // ===========================================================================
  // setHover(cell) — optional pre-click affordance for MOUSE users. board.js routes
  // a throttled, non-consuming hover here (a resolved {r,c} cell, a column number, or
  // -1 on a miss) and already gates it to our turn for a seated player. We only
  // brighten an existing legal-target token under the cursor; everything else is a
  // no-op. Spectators/off-turn never reach here (board.js _turnAllowed gate), and we
  // re-check myTurnNow() defensively. Never touches rules or sync.
  // ===========================================================================
  function setHover(cell) {
    if (!myTurnNow()) { hoverKey = -1; hoverPieceId = 0; return; }
    let r = null, c = null;
    if (cell && typeof cell === "object") { r = cell.r; c = cell.c; }
    if (!Number.isInteger(r) || !Number.isInteger(c)) { hoverKey = -1; hoverPieceId = 0; return; }
    const key = r * 8 + c;
    // Honour the hover when it lands on a real legal-target token (one we drew).
    hoverKey = targets.some((t) => t.userData.target && t.userData.target.r === r && t.userData.target.c === c)
      ? key : -1;
    // Also recognise a hover over a SELECTABLE own disc (a legal from-square, already in
    // `glowing`) and momentarily boost that disc's glow so a mouse user gets pre-pick
    // feedback before clicking. Rules untouched — the disc is already selectable.
    const id = idAt(r, c);
    hoverPieceId = id && glowing.has(id) ? id : 0;
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
    if (role === "spectator") return;                   // hardening: mirror myTurnNow's explicit spectator gate
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
    // Only relay + advance the turn if the move actually mutated the board. If
    // performMove() hit its drift guard (mover id missing) it bailed without
    // touching anything, so flipping the turn here would desync further.
    if (performMove(from, steps, captured)) {
      try { ctx.net.sendMove({ type: "move", from, steps }); } catch { /* transport optional */ }
      afterMove();
      if (role === "host") pushSnapshot();
    }
  }

  // ===========================================================================
  // applyMove — apply ONE relayed opponent/host move. Trust only (from, steps);
  // recompute captures via matchLegalMove. On mismatch THROW GameDesync so the
  // framework requests an authoritative snapshot.
  // ===========================================================================
  // Has this exact move already been applied to the current board? True when the
  // from-square is now empty and the final landing square holds a disc of the side
  // that just moved (other(turn), since the turn already advanced). Used to absorb
  // the host's double-send (move delta + post-move snapshot) arriving out of order.
  function isAlreadyApplied(move) {
    if (!move || !move.from || !Array.isArray(move.steps) || move.steps.length === 0) return false;
    const { r: fr, c: fc } = move.from;
    const final = move.steps[move.steps.length - 1];
    if (!final || !inBounds(fr, fc) || !inBounds(final.r, final.c)) return false;
    if (idAt(fr, fc) !== 0) return false;            // mover hasn't left the from-square
    const landed = pieceAt(final.r, final.c);
    if (!landed || landed.color !== other(turn)) return false; // mover not on its destination
    // Tighten the dedupe: every square this move would have JUMPED over must now be
    // empty. Without this, a multi-jump that re-crosses a square, or a same-colour
    // disc legitimately sitting on the destination from a prior state, can falsely
    // report "already applied" and swallow a delta that should have forced a resync.
    const pts = [{ r: fr, c: fc }, ...move.steps];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.abs(b.r - a.r) !== 2) continue;       // not a jump step
      const mr = (a.r + b.r) / 2, mc = (a.c + b.c) / 2;
      if (idAt(mr, mc) !== 0) return false;          // a captured midpoint is still occupied
    }
    return true;
  }

  function applyMove(move) {
    if (!move || move.type !== "move") return false;
    if (phase !== "play") {
      // The game may have already ended via an authoritative snapshot delivered
      // before this delta. If the move is consistent with the already-applied
      // position, treat it as a benign no-op rather than forcing a resync.
      if (isAlreadyApplied(move)) return true;
      throw new GameDesync("checkers: move while not in play");
    }
    // If a previous hop is still animating, fast-forward it so the new move doesn't
    // glide concurrently (the logical board is already current either way).
    if (busy) finishAnimations();
    const legal = matchLegalMove(logicalBoard(), turn, move);
    if (!legal) {
      // Host self-echo / reordered snapshot: the host sends BOTH a move delta and a
      // post-move snapshot. If the snapshot landed first the move is already applied,
      // so there is no legal match for the current turn. Tolerate that as a no-op
      // (when the board already reflects this exact move) instead of GameDesync.
      if (isAlreadyApplied(move)) return true;
      throw new GameDesync("checkers: no matching legal move");
    }
    clearSelection();
    clearHighlights();
    // performMove() returns false if its drift guard fired (mover id missing despite
    // matchLegalMove validating against logicalBoard()). In that case the board was
    // NOT mutated, so we must NOT flip the turn — surface a desync to force a resync
    // instead of compounding the drift.
    if (!performMove(legal.from, legal.steps, legal.captured)) {
      throw new GameDesync("checkers: move id drift on apply");
    }
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
    settles.length = 0;
    busy = false;
    clearSelection();
    clearHighlights();
    // An authoritative snapshot doesn't carry which delta produced it, so drop any
    // stale last-move trail rather than show a marker that may not match this state.
    lastMove = null;
    refreshTrail();

    const prevTurn = turn;
    const prevPhase = phase;

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

    // Cue transients (purely cosmetic): restart the win pulse when the game first
    // reads as over, and fire the turn-handoff flourish only when the turn ACTUALLY
    // changed to the local player (so a redundant same-turn echo never re-pulses).
    if (newPhase === "over" && (prevPhase !== "over" || winPulseT === 0)) winPulseT = 0;
    // Victory hop: arm the one-shot only on the TRANSITION into a won game (a resync of
    // an already-over board must not re-trigger it). Reset to 0 otherwise so a fresh /
    // still-playing snapshot never leaves the discs mid-hop.
    if (newPhase === "over" && newWinner && prevPhase !== "over") winHopT = WIN_HOP_DUR;
    else if (newPhase !== "over") winHopT = 0;
    if (newPhase === "play" && myColor != null && role !== "spectator"
        && turn === myColor && prevTurn !== myColor) {
      handoffT = HANDOFF_DUR;
    }

    refreshHighlights();
  }

  // Reconcile the pool to a logical target with MINIMAL churn and POSITION STABILITY.
  // The naive approach (rebuild from empty, assign by pool order) re-homes untouched
  // discs to different squares and snaps them there — a visible teleport/identity-swap
  // for a guest/spectator applying a snapshot of a logically-identical position. Here
  // we do two passes against the PREVIOUS id grid:
  //   Pass 1 — for every wanted square already holding a disc of the right colour on
  //            the current board, KEEP that disc in place (consume it from avail).
  //   Pass 2 — fill the remaining wanted squares from leftover discs (genuinely moved).
  // Untouched pieces stay glued to their squares across snapshots; only pieces that
  // actually changed move. `instant` skips spring-ins (always true for a snapshot).
  function setBoardFromLogical(logical, newTurn, newPhase, newWinner, instant) {
    const prev = board;                  // the id grid BEFORE this reconcile
    board = emptyGrid();
    clearRails();

    const avail = { red: [], black: [] };
    for (const rec of pieces.values()) avail[rec.color].push(rec);

    const seat = (rec, r, c, want) => {
      const ai = avail[rec.color].indexOf(rec);
      if (ai >= 0) avail[rec.color].splice(ai, 1);
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
    };

    // Pass 1 — keep discs that already occupy their wanted square (same colour).
    const pending = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const want = logical[r][c];
        if (!want) continue;
        const pid = prev[r][c];
        const held = pid ? pieces.get(pid) : null;
        if (held && held.color === want.color && avail[want.color].includes(held)) {
          seat(held, r, c, want);
        } else {
          pending.push({ r, c, want });
        }
      }
    }

    // Pass 2 — fill the remaining wanted squares from whatever discs are left.
    for (const { r, c, want } of pending) {
      const rec = avail[want.color].pop();
      if (!rec) continue;
      seat(rec, r, c, want);
    }

    for (const rec of avail.red) parkOnRail(rec);
    for (const rec of avail.black) parkOnRail(rec);

    // Recompute the king tally authoritatively from the freshly-seated board (only
    // on-board kings count; parked discs were demoted by parkOnRail).
    recomputeKingCount();

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
    settles.length = 0;
    clearHighlights();
    clearTrail();
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
    // Authoritative pointer->cell resolver (board.js tier 1). Exposing this makes disc
    // clicks reliable regardless of the thin per-square collider (see hitToCell).
    hitToCell,
    // Pre-click hover affordance for mouse users (board.js gates it to our turn).
    setHover,
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
