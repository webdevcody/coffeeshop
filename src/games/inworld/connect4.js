// Connect 4 — in-world 3D table game module (createGame contract). CANDIDATE #2.
//
// A complete, self-contained ES module implementing the createGame(ctx) contract
// documented in ./createGame.js and hosted by ./board.js. The framework owns the
// café table, the WS relay (a per-room curried `net`), role/turn gating and the
// spectator read-only path. THIS module owns ONLY the rules, the 3D geometry,
// per-column hit-testing, the hover preview, the turn cue and the win
// celebration. THREE is pulled from ctx (never a second copy); only the shared
// spine helpers are imported.
//
// ──────────────────────────────────────────────────────────────────────────────
// APPROACH (distinct from sibling candidates) — "the OPEN LATTICE rack."
// ──────────────────────────────────────────────────────────────────────────────
// Instead of a solid drilled slab (where a disc parked in an opaque dark socket
// gets visually swallowed) or a frosted acrylic tank, this cabinet is an OPEN
// skeletal rack: a thin back-plate, a 6×7 grid of thin RING bezels (open holes,
// not filled cylinders) and slim vertical column dividers. The discs sit in the
// open holes fully visible from the front with nothing covering them — exactly
// how a real Connect-4 set reads. This deliberately avoids the occlusion failure
// of a solid-socket build.
//
//   * Host = RED and ALWAYS drops first; Guest = YELLOW. The two sides use clearly
//     distinct emissive materials. A cyan "YOU" ring sits on the local player's own
//     colour chip so identity is read from role, never from the wire.
//   * Hover a column → a translucent ghost disc cocks at the column mouth and the
//     lowest open hole glows with a cyan rim. Full / off-turn columns show nothing.
//   * Click a column → the disc FALLS under gravity from the mouth, bounces once
//     with a squash, and settles in the lowest open hole.
//   * Turn cue: a chunky arrow above the rack points DOWN and glows in the
//     side-to-move's colour; twin domed lamps (red / yellow) flank the top and the
//     mover's lamp is lit. Unmistakable from either seat.
//   * Win = a contiguous run of >= 4 through the just-placed cell: the run brightens,
//     eases forward out of the rack, and a golden halo sweeps the run then parks
//     pulsing on its centre.
//
// ORIENTATION: authored canonically with the readable face at +Z (toward the ry=0
// seat). We declare orientPolicy:"self" so the framework does NOT rotate the
// group; instead we rotate `rack` by orientFor(seatRy)+π so the +Z faceplate
// points at the LOCAL seat from any chair (flat boards put their canonical near
// edge at -Z; an upright cabinet's readable surface is +Z, hence the extra π).
// hitToCell resolves through rack.worldToLocal so the visible column a player
// clicks maps to the same canonical column on every seat. applyState NEVER
// recomputes the local role/colour from the wire (no side-flip).
//
// COORDINATES (verbatim from the authoritative 2D engine): board[r][c], r=0 is the
// TOP row, r=ROWS-1 the BOTTOM. Gravity fills the largest empty r first. The wire
// carries ONLY the column; every peer recomputes the landing row from shared
// gravity (anti-ghost-cell / anti-desync). WIN is checked BEFORE DRAW.

import { GameDesync, orientFor } from "./createGame.js";

// ============================================================================
// PURE RULES — transport-free, side-effect-free single source of legality.
// ============================================================================
export const ROWS = 6; // r = 0 is the TOP row, r = ROWS-1 is the BOTTOM row
export const COLS = 7; // c = 0..6, left → right

export function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

// Lowest empty row in a column (largest empty r), or -1 if the column is full.
export function dropRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) if (!board[r][col]) return r;
  return -1;
}

// True only when every column is full.
export function isFull(board) {
  for (let c = 0; c < COLS; c++) if (dropRow(board, c) >= 0) return false;
  return true;
}

export const other = (color) => (color === "red" ? "yellow" : "red");

// If placing `color` at (r,c) completes a contiguous line of length >= 4 through
// that cell, return the WHOLE winning run; otherwise null.
export function winningCells(board, r, c, color) {
  const dirs = [
    [0, 1], // horizontal →
    [1, 0], // vertical   ↓
    [1, 1], // diagonal   ↘
    [1, -1], // diagonal  ↙
  ];
  for (const [dr, dc] of dirs) {
    const line = [[r, c]];
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === color) {
        line.push([rr, cc]);
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (line.length >= 4) {
      // Order the run spatially along its [dr,dc] axis so a halo that
      // interpolates winLine[i]→winLine[i+1] by index sweeps monotonically
      // end-to-end instead of zig-zagging (the line above is built as
      // [placed, ...forward, ...backward], which is NOT in spatial order).
      line.sort((a, b) => (a[0] - b[0]) * dr + (a[1] - b[1]) * dc);
      return line;
    }
  }
  return null;
}

// A received column is honoured only when it is a real in-grid integer.
export function isLegalCol(col) {
  return Number.isInteger(col) && col >= 0 && col < COLS;
}

// ============================================================================
// GEOMETRY CONSTANTS — the upright open rack, authored at its own local origin
// with y=0 on the tabletop (the framework sets group.position.y = anchorY).
// ============================================================================
const BOARD_W = 0.62; // overall grid width (X)
const CELL = BOARD_W / COLS; // square cell pitch
const GRID_W = CELL * COLS;
const GRID_H = CELL * ROWS;
const DISC_R = CELL * 0.4; // disc radius
const DISC_T = 0.02; // disc thickness (Z)
const BACK_T = 0.022; // thin back-plate thickness (Z)
const FRAME_D = 0.03; // depth of the front frame ribs (Z), holds the disc plane
const FOOT_Y = 0.012; // tabletop clearance under the feet
const BASE_H = 0.05; // cabinet base height

// Grid bottom sits above the base; the playable grid is centred in X.
const GRID_BOTTOM = FOOT_Y + BASE_H + CELL * 0.55;
const GRID_LEFT = -GRID_W / 2;

// The disc plane sits just in front of the back-plate, inside the open frame.
const DISC_Z = BACK_T / 2 + DISC_T / 2 + 0.001;

// Local centre of cell (r,c). r=0 is the TOP row → highest y.
function cellX(c) {
  return GRID_LEFT + (c + 0.5) * CELL;
}
function cellY(r) {
  return GRID_BOTTOM + (ROWS - 1 - r + 0.5) * CELL;
}

// Y of the slot mouth above a column where a freshly dropped disc enters.
// Kept close above row 0 so the hover ghost (radius DISC_R + idle bob) clears the
// down-arrow cone parked higher up (whose tip descends to ~cellY(0)+1.275*CELL):
// at 1.05*CELL the ghost top reaches ~cellY(0)+1.5*CELL only on the local-turn bob,
// and the arrow itself sits at cellY(0)+1.55*CELL, so the two no longer interpenetrate
// at rest. The drop still visibly falls from above the rack into the lowest hole (I4).
const MOUTH_Y = cellY(0) + CELL * 1.05;

// Drop physics tuning (local metres, seconds).
const GRAVITY = -3.4; // m/s² (snappy but readable across a table)
const RESTITUTION = 0.3; // energy kept per bounce
const REST_EPS = 0.18; // |v| below which an impact is treated as final rest

// ============================================================================
// FACTORY
// ============================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const net = ctx.net || {};
  const isAllowed = typeof ctx.isLocalTurnAllowed === "function" ? ctx.isLocalTurnAllowed : () => false;
  const reportOver = typeof ctx.onGameOver === "function" ? ctx.onGameOver : () => {};

  // ---- colour identity (derived from ROLE, never the wire) ------------------
  let role = ctx.role || "spectator";
  let seatRy = ctx.seatRy ?? null;
  const colorForRole = (rl) => (rl === "host" ? "red" : rl === "guest" ? "yellow" : null);
  let myColor = colorForRole(role);

  // ---- logical state (the single source of truth) ---------------------------
  let board = emptyBoard();
  let turn = "red"; // red (host) always starts
  let phase = "play"; // "play" | "over"
  let winLine = null; // array of [r,c] or null
  let winner = null; // "red" | "yellow" | null (null + over ⇒ draw)
  let lastDrop = null; // {r,c} of the most recent landing
  // In-flight lock: true while an animated drop is falling and the turn has not
  // yet flipped (resolveAfter runs only once the disc settles). Gates onPointer
  // and canPlayLocally so a rapid second click cannot drop a second disc.
  let busy = false;

  // ============================================================================
  // SHARED MATERIALS + GEOMETRY (created once; freed in dispose()).
  // ============================================================================
  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };

  // Frame + back-plate read from BOTH faces (DoubleSide) so a spectator orbiting to
  // the -Z side still sees the rack, not a culled/blank face. The back is now an OPEN
  // perimeter (no solid centre) so discs in the holes are visible front AND back.
  const matFrame = keep(new THREE.MeshStandardMaterial({ color: "#1f4ea8", roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide }));
  const matBack = keep(new THREE.MeshStandardMaterial({ color: "#14305f", roughness: 0.7, metalness: 0.08, side: THREE.DoubleSide }));
  const matBase = keep(new THREE.MeshStandardMaterial({ color: "#16387a", roughness: 0.7, metalness: 0.1 }));
  const matRail = keep(new THREE.MeshStandardMaterial({ color: "#caa15a", roughness: 0.35, metalness: 0.85 }));

  // Discs carry a slightly stronger self-emissive so they stay legible from the open
  // -Z back side (no fill behind the holes) and under low café lighting, without
  // washing out the cosy low-poly read.
  const matRed = keep(new THREE.MeshStandardMaterial({ color: "#e23b4e", roughness: 0.35, metalness: 0.1, emissive: "#7a1320", emissiveIntensity: 0.62 }));
  const matYellow = keep(new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.35, metalness: 0.1, emissive: "#7a5a0c", emissiveIntensity: 0.62 }));
  const matRedWin = keep(new THREE.MeshStandardMaterial({ color: "#ff8090", roughness: 0.25, metalness: 0.1, emissive: "#ff3b4e", emissiveIntensity: 1.0 }));
  const matYellowWin = keep(new THREE.MeshStandardMaterial({ color: "#ffe79a", roughness: 0.25, metalness: 0.1, emissive: "#ffcf4e", emissiveIntensity: 1.0 }));

  // Translucent ghost (preview), tinted to the local player's own colour.
  const matGhostRed = keep(new THREE.MeshStandardMaterial({ color: "#e23b4e", roughness: 0.4, transparent: true, opacity: 0.34, emissive: "#7fd1ff", emissiveIntensity: 0.3, depthWrite: false }));
  const matGhostYellow = keep(new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.4, transparent: true, opacity: 0.34, emissive: "#7fd1ff", emissiveIntensity: 0.3, depthWrite: false }));

  const matAccent = keep(new THREE.MeshStandardMaterial({ color: "#7fd1ff", roughness: 0.4, metalness: 0.0, emissive: "#7fd1ff", emissiveIntensity: 0.95, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  // Last-move accent ring (item #8): a thin, dimmer cyan ring parked over the disc
  // that JUST landed so "what just happened" is instantly readable for a watcher who
  // looked away. Its own material (a dimmer variant of matAccent) so it never shares /
  // fights the breathing hover rim above. Hidden once the game is over (the win halo
  // owns the read at that point).
  const matLast = keep(new THREE.MeshStandardMaterial({ color: "#aee6ff", roughness: 0.5, metalness: 0.0, emissive: "#7fd1ff", emissiveIntensity: 0.55, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  // Full-column "no entry" flash (item #10): a dedicated red ring with its OWN
  // material, parked over the topmost hole of a full column the player tries to
  // hover. Its own material so the flash never tints the shared frame (I3). Faded
  // out by the clock; opacity is driven live so the keep()'d base value is only a
  // ceiling.
  const matFull = keep(new THREE.MeshStandardMaterial({ color: "#ff5566", roughness: 0.4, metalness: 0.0, emissive: "#ff3344", emissiveIntensity: 1.1, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  const matHalo = keep(new THREE.MeshStandardMaterial({ color: "#fff1b8", roughness: 0.3, metalness: 0.2, emissive: "#ffd24a", emissiveIntensity: 1.4, side: THREE.DoubleSide }));

  // Turn arrow — recoloured live to the side-to-move (clone of base, recolourable).
  const matArrow = keep(new THREE.MeshStandardMaterial({ color: "#e23b4e", roughness: 0.4, metalness: 0.1, emissive: "#e23b4e", emissiveIntensity: 0.9 }));

  // YOU identity ring.
  const matYouRing = keep(new THREE.MeshStandardMaterial({ color: "#7fd1ff", roughness: 0.4, metalness: 0.0, emissive: "#7fd1ff", emissiveIntensity: 1.0 }));

  // -- geometry ---------------------------------------------------------------
  // Disc: a thin lens cylinder with its flat circular faces looking out along ±Z.
  const discGeo = keep(new THREE.CylinderGeometry(DISC_R, DISC_R, DISC_T, 30));
  discGeo.rotateX(Math.PI / 2);
  // Open hole bezel: a torus ring (NOT a filled cylinder) so the disc inside is
  // fully visible. This is the key distinction from a drilled-socket build.
  const bezelGeo = keep(new THREE.TorusGeometry(DISC_R * 1.12, CELL * 0.07, 10, 26));

  function mesh(geo, mat, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }

  // ============================================================================
  // SCENE GRAPH
  // ============================================================================
  const group = new THREE.Group();
  group.name = "connect4";

  // `rack` carries the whole cabinet and is rotated by us (orientPolicy:"self")
  // so the +Z faceplate faces the LOCAL seat from any chair.
  const rack = new THREE.Group();
  group.add(rack);
  function applyFacing() {
    // orientFor(seatRy) alone points the flat-board near edge (-Z) at the seat;
    // the upright rack's readable surface is +Z, so the extra π turns +Z toward a
    // SEATED viewer from every chair. hitToCell resolves via rack.worldToLocal, so
    // column mapping (and the natural L/R mirror between opposing seats) stays
    // correct under this rotation.
    //
    // A spectator/ambient mount has NO seat (seatRy == null → orientFor == 0):
    // adding π there would rotate the open holes+discs to the canonical BACK and
    // leave the blank back-plate slab facing a canonical-front watcher (the reported
    // "one side just blue" bug). With no seat, keep the +Z faceplate at the canonical
    // front like every other board so a watcher orbiting from the front sees the full
    // board. (The cabinet is now also built two-sided, so the other side reads too.)
    const seated = seatRy != null && Number.isFinite(seatRy);
    rack.rotation.y = orientFor(seatRy) + (seated ? Math.PI : 0);
  }
  applyFacing();

  // -- back-plate (OPEN perimeter) --------------------------------------------
  // Authored as a thin perimeter ring at z=0 instead of a solid slab so the 6×7
  // open holes show straight through: a disc parked in a hole is visible from the
  // FRONT (+Z) and the BACK (-Z), so a spectator on either side of the table reads
  // the board (the reported "one side just blue, no holes, no discs" was a solid
  // opaque slab occluding the single +Z disc plane). `backY`/SLAB_* keep the same
  // overall footprint the rest of the layout references.
  const SLAB_W = GRID_W + CELL * 0.5;
  const SLAB_H = GRID_H + CELL * 0.5;
  const backY = GRID_BOTTOM + GRID_H / 2 - CELL / 2;
  const BACK_RIM = CELL * 0.25; // perimeter rail thickness
  const backTopGeo = keep(new THREE.BoxGeometry(SLAB_W, BACK_RIM, BACK_T));
  const backBotGeo = keep(new THREE.BoxGeometry(SLAB_W, BACK_RIM, BACK_T));
  const backSideGeo = keep(new THREE.BoxGeometry(BACK_RIM, SLAB_H, BACK_T));
  const backTop = mesh(backTopGeo, matBack);
  backTop.position.set(0, backY + SLAB_H / 2 - BACK_RIM / 2, 0);
  const backBot = mesh(backBotGeo, matBack);
  backBot.position.set(0, backY - SLAB_H / 2 + BACK_RIM / 2, 0);
  const backL = mesh(backSideGeo, matBack);
  backL.position.set(-SLAB_W / 2 + BACK_RIM / 2, backY, 0);
  const backR = mesh(backSideGeo, matBack);
  backR.position.set(SLAB_W / 2 - BACK_RIM / 2, backY, 0);
  rack.add(backTop, backBot, backL, backR);

  // -- front frame: outer ring + vertical column dividers (open between holes) -
  const frameTopGeo = keep(new THREE.BoxGeometry(SLAB_W, CELL * 0.28, FRAME_D));
  const frameBotGeo = keep(new THREE.BoxGeometry(SLAB_W, CELL * 0.28, FRAME_D));
  const frameSideGeo = keep(new THREE.BoxGeometry(CELL * 0.28, GRID_H + CELL * 0.5, FRAME_D));
  const frameMidY = backY;
  const frameZ = DISC_Z; // ribs sit at the disc plane front
  const fTop = mesh(frameTopGeo, matFrame);
  fTop.position.set(0, GRID_BOTTOM + GRID_H - CELL / 2 + CELL * 0.3, frameZ);
  const fBot = mesh(frameBotGeo, matFrame);
  fBot.position.set(0, GRID_BOTTOM - CELL / 2 - CELL * 0.3, frameZ);
  const fL = mesh(frameSideGeo, matFrame);
  fL.position.set(-SLAB_W / 2 + CELL * 0.14, frameMidY, frameZ);
  const fR = mesh(frameSideGeo, matFrame);
  fR.position.set(SLAB_W / 2 - CELL * 0.14, frameMidY, frameZ);
  rack.add(fTop, fBot, fL, fR);

  // slim vertical dividers between columns (mirrored onto the -Z back face too, so
  // the grid lattice reads from both sides).
  const dividerGeo = keep(new THREE.BoxGeometry(CELL * 0.06, GRID_H, FRAME_D * 0.8));
  for (let c = 1; c < COLS; c++) {
    const div = mesh(dividerGeo, matFrame);
    div.position.set(GRID_LEFT + c * CELL, frameMidY, frameZ);
    rack.add(div);
    const divB = mesh(dividerGeo, matFrame);
    divB.position.set(GRID_LEFT + c * CELL, frameMidY, -frameZ);
    rack.add(divB);
  }

  // -- open hole bezels (rings), per cell, on BOTH faces ----------------------
  // A ring on the +Z front (toward a seated/canonical-front viewer) AND a mirrored
  // ring on the -Z back, so the grid reads as open holes from either side of the
  // table. The disc inside (at +DISC_Z) is visible through both rings since the
  // back-plate centre is now open.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const bezF = mesh(bezelGeo, matFrame, false);
      bezF.position.set(cellX(c), cellY(r), DISC_Z);
      rack.add(bezF);
      const bezB = mesh(bezelGeo, matFrame, false);
      bezB.position.set(cellX(c), cellY(r), -DISC_Z);
      rack.add(bezB);
    }
  }

  // -- base / feet ------------------------------------------------------------
  // Centred on the back-plate (z=0), NOT shifted forward to DISC_Z/2 (item #7): the
  // base is structural and its depth (FRAME_D+BACK_T+0.06) is symmetric about z=0, so
  // its front face no longer protrudes ~0.03 ahead of the disc plane where it could
  // occlude the bottom row's lower bezel arc from a low seated angle. Symmetry also
  // keeps it reading from the open -Z back side.
  const baseGeo = keep(new THREE.BoxGeometry(SLAB_W + 0.06, BASE_H, FRAME_D + BACK_T + 0.06));
  const base = mesh(baseGeo, matBase);
  base.position.set(0, FOOT_Y + BASE_H / 2, 0);
  rack.add(base);

  // -- top brass rail ---------------------------------------------------------
  const railGeo = keep(new THREE.BoxGeometry(SLAB_W, CELL * 0.16, 0.03));
  const rail = mesh(railGeo, matRail);
  rail.position.set(0, cellY(0) + CELL * 0.85, DISC_Z);
  rack.add(rail);

  // -- twin ready lamps flanking the rail -------------------------------------
  const lampGeo = keep(new THREE.SphereGeometry(CELL * 0.16, 16, 12));
  const matLampRed = keep(new THREE.MeshStandardMaterial({ color: "#2a2f3a", roughness: 0.5, metalness: 0.3, emissive: "#000000", emissiveIntensity: 0 }));
  const matLampYellow = keep(new THREE.MeshStandardMaterial({ color: "#2a2f3a", roughness: 0.5, metalness: 0.3, emissive: "#000000", emissiveIntensity: 0 }));
  const lampRed = mesh(lampGeo, matLampRed, false);
  const lampYellow = mesh(lampGeo, matLampYellow, false);
  const lampY = rail.position.y;
  lampRed.position.set(-SLAB_W / 2 - CELL * 0.18, lampY, DISC_Z);
  lampYellow.position.set(SLAB_W / 2 + CELL * 0.18, lampY, DISC_Z);
  rack.add(lampRed, lampYellow);

  // -- turn arrow (points DOWN, recoloured to the side-to-move) ----------------
  const arrowGeo = keep(new THREE.ConeGeometry(CELL * 0.34, CELL * 0.55, 4));
  arrowGeo.rotateX(Math.PI); // point DOWN (−Y)
  const arrow = mesh(arrowGeo, matArrow, false);
  arrow.position.set(0, cellY(0) + CELL * 1.55, DISC_Z);
  rack.add(arrow);

  // -- YOU identity ring on the local player's own lamp -----------------------
  const youRingGeo = keep(new THREE.TorusGeometry(CELL * 0.24, CELL * 0.04, 10, 24));
  const youRing = mesh(youRingGeo, matYouRing, false);
  youRing.visible = false;
  rack.add(youRing);
  function refreshYouMarker() {
    // Seat the ring just in front of the lamp sphere (radius CELL*0.16) rather than
    // a hair off centre, so it never z-fights the sphere at grazing angles (I7).
    const front = CELL * 0.18;
    if (myColor === "red") {
      youRing.position.copy(lampRed.position);
      youRing.position.z += front;
      youRing.visible = true;
    } else if (myColor === "yellow") {
      youRing.position.copy(lampYellow.position);
      youRing.position.z += front;
      youRing.visible = true;
    } else {
      youRing.visible = false;
    }
    matYouRing.emissiveIntensity = 1.0;
  }
  refreshYouMarker();

  // ============================================================================
  // DYNAMIC LAYERS (parented under rack so they inherit the facing rotation).
  // ============================================================================
  const discRoot = new THREE.Group();
  const fxRoot = new THREE.Group();
  rack.add(discRoot, fxRoot);

  // Per-cell registry: the live disc occupying board[r][c], or null.
  const discs = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  // Active physics bodies (falling/bouncing discs) integrated by the clock.
  const bodies = []; // { mesh, r, c, color, y, vy, restY, settled, squash, resolveOnRest }

  // ---- hover preview: ghost disc at the column mouth + cyan rim --------------
  const ghost = mesh(discGeo, matGhostRed, false);
  ghost.visible = false;
  fxRoot.add(ghost);

  const rimGeo = keep(new THREE.RingGeometry(DISC_R * 0.96, DISC_R * 1.2, 28));
  const rim = mesh(rimGeo, matAccent, false);
  rim.visible = false;
  fxRoot.add(rim);

  // ---- last-move marker (item #8) -------------------------------------------
  // A flat ring sitting just proud of the disc face on the disc that most recently
  // landed. Driven purely off `lastDrop` in paintLastMarker(); not raycastable.
  const lastRingGeo = keep(new THREE.RingGeometry(DISC_R * 0.62, DISC_R * 0.82, 26));
  const lastRing = mesh(lastRingGeo, matLast, false);
  lastRing.raycast = () => {};
  lastRing.visible = false;
  fxRoot.add(lastRing);
  function paintLastMarker() {
    // Hide during "over": the golden win halo / draw beat owns the end-state read.
    if (phase === "play" && lastDrop && board[lastDrop.r] && board[lastDrop.r][lastDrop.c]) {
      lastRing.position.set(cellX(lastDrop.c), cellY(lastDrop.r), DISC_Z + DISC_T / 2 + 0.003);
      lastRing.visible = true;
    } else {
      lastRing.visible = false;
    }
  }

  // ---- full-column flash (item #10) -----------------------------------------
  const fullRingGeo = keep(new THREE.RingGeometry(DISC_R * 0.96, DISC_R * 1.22, 28));
  const fullRing = mesh(fullRingGeo, matFull, false);
  fullRing.raycast = () => {};
  fullRing.visible = false;
  fxRoot.add(fullRing);
  let fullFlash = 0; // seconds of flash remaining
  let fullFlashCol = -1; // column the flash is anchored to (de-dupes re-trigger)
  const FULL_FLASH_DUR = 0.5;
  function triggerFullFlash(col) {
    if (col === fullFlashCol && fullFlash > 0) return; // already flashing this column
    fullFlashCol = col;
    fullFlash = FULL_FLASH_DUR;
    // Park over the topmost hole (row 0) of the full column.
    fullRing.position.set(cellX(col), cellY(0), DISC_Z + DISC_T / 2 + 0.0035);
    fullRing.visible = true;
    ensureClock();
  }
  function stepFullFlash(dt) {
    if (fullFlash <= 0) return;
    fullFlash -= dt;
    if (fullFlash <= 0) {
      fullFlash = 0;
      fullFlashCol = -1;
      fullRing.visible = false;
      matFull.opacity = 0;
      return;
    }
    const f = fullFlash / FULL_FLASH_DUR; // 1 → 0
    // quick double-blink that fades: bright pulse riding a linear fade-out.
    matFull.opacity = 0.85 * f * (0.55 + 0.45 * Math.sin(f * Math.PI * 3));
  }

  let hoverCol = -1;
  // Hover animation state: the ghost eases in (scale+opacity) when a new column is
  // picked, then gently bobs at the mouth; the cyan landing rim breathes so the
  // target hole reads clearly. `hoverIn` ramps 0→1 on a fresh hover (I2).
  let hoverIn = 0;
  let hoverPhase = 0;
  const GHOST_BASE_OPACITY = matGhostRed.opacity;

  // ---- win halo -------------------------------------------------------------
  const haloGeo = keep(new THREE.TorusGeometry(DISC_R * 1.3, DISC_R * 0.12, 10, 28));
  const halo = mesh(haloGeo, matHalo, false);
  halo.visible = false;
  fxRoot.add(halo);

  // ============================================================================
  // SELF-DRIVEN CLOCK — runs only while something animates, then parks.
  // ============================================================================
  let rafId = 0;
  let lastT = 0;
  let lampPulse = false;
  let lampPhase = 0;
  let arrowPhase = 0;
  // Turn-arrow colour cross-fade (item #12): on a turn flip refreshLamps() sets a new
  // target colour and stepArrow() eases matArrow's colour/emissive from the previous
  // hue over ARROW_FADE seconds so the handoff feels intentional, not a hard snap.
  // Pre-allocated scratch colours (no per-frame alloc).
  const ARROW_FADE = 0.22;
  const _arrowFrom = new THREE.Color("#e23b4e");
  const _arrowTo = new THREE.Color("#e23b4e");
  let arrowFade = 1; // 0 at flip → 1 when settled (1 ⇒ no fade in progress)

  function needsAnim() {
    return bodies.length > 0 || winAnim.active || lampPulse || ghost.visible || fullFlash > 0 || (phase === "play" && arrow.visible);
  }
  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }
  function ensureClock() {
    if (rafId || typeof requestAnimationFrame !== "function") return;
    lastT = now();
    rafId = requestAnimationFrame(tick);
  }
  function tick() {
    rafId = 0;
    const t = now();
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;

    stepBodies(dt);
    stepWinAnim(dt);
    stepLamps(dt);
    stepArrow(dt);
    stepHover(dt);
    stepFullFlash(dt);

    if (needsAnim()) rafId = requestAnimationFrame(tick);
  }

  // ---- physics integration --------------------------------------------------
  function stepBodies(dt) {
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      b.vy += GRAVITY * dt;
      b.y += b.vy * dt;

      if (b.y <= b.restY) {
        b.y = b.restY;
        const speed = Math.abs(b.vy);
        if (speed < REST_EPS) {
          b.vy = 0;
          // Softer final squash for a cosier settle (I6) — the disc gives a small
          // diminishing wobble rather than an abrupt snap. Shared-material-safe:
          // this is a per-mesh scale pop, never a shared emissive flash (I3).
          b.squash = 0.38;
          b.settled = true;
        } else {
          b.vy = speed * RESTITUTION;
          b.squash = Math.min(1, speed * 0.6);
        }
      }

      b.mesh.position.y = b.y;

      if (b.squash > 0) {
        b.squash = Math.max(0, b.squash - dt * 5);
        const s = b.squash;
        b.mesh.scale.set(1 + 0.2 * s, 1 - 0.3 * s, 1 + 0.2 * s);
      } else {
        b.mesh.scale.set(1, 1, 1);
      }

      if (b.settled && b.squash === 0) {
        b.mesh.scale.set(1, 1, 1);
        b.mesh.position.y = b.restY;
        bodies.splice(i, 1);
        if (b.resolveOnRest) resolveAfter(b.r, b.c, b.color);
      }
    }
  }

  // ---- win-line animation (golden halo sweep + lifted run) ------------------
  const winAnim = { active: false, t: 0 };
  function stepWinAnim(dt) {
    if (!winAnim.active || !winLine) return;
    winAnim.t += dt;
    const sweepDur = 0.9;
    const n = winLine.length;
    if (winAnim.t < sweepDur) {
      const f = winAnim.t / sweepDur;
      const fi = f * (n - 1);
      const i0 = Math.floor(fi);
      const i1 = Math.min(n - 1, i0 + 1);
      const lf = fi - i0;
      const [r0, c0] = winLine[i0];
      const [r1, c1] = winLine[i1];
      halo.position.set(
        cellX(c0) + (cellX(c1) - cellX(c0)) * lf,
        cellY(r0) + (cellY(r1) - cellY(r0)) * lf,
        DISC_Z + DISC_T
      );
    } else {
      const [rm, cm] = winLine[Math.floor(n / 2)];
      halo.position.set(cellX(cm), cellY(rm), DISC_Z + DISC_T);
      // One-shot "bloom" at sweep-end (overshoot then ease back) before settling
      // into the steady heartbeat — a more satisfying win beat (I4).
      const tb = winAnim.t - sweepDur;
      const bloomDur = 0.32;
      if (tb < bloomDur) {
        const bf = tb / bloomDur;
        const bloom = 0.28 * Math.sin(bf * Math.PI); // 1.0→1.28→1.0
        halo.scale.setScalar(1 + bloom);
      } else {
        halo.scale.setScalar(1 + 0.12 * Math.sin(winAnim.t * 6));
      }
    }
    // ease the winning discs forward out of the rack, and sweep a small staggered
    // scale "shimmer" cell-by-cell along the run as the halo front passes each disc
    // (item #11). winLine is spatially sorted, so indexing by run order makes the win
    // read end-to-end. Per-mesh scale ONLY — the shared win materials are untouched
    // (I3-safe), so no other disc is affected.
    const lift = Math.min(1, winAnim.t / 0.5) * (DISC_T * 1.2);
    const sweepFront = (winAnim.t / sweepDur) * (n - 1); // index the halo has reached
    for (let i = 0; i < n; i++) {
      const [r, c] = winLine[i];
      const d = discs[r][c];
      if (!d) continue;
      d.position.z = DISC_Z + lift;
      // distance (in run-index units) of this disc behind the sweep front; a short
      // raised-cosine bump gives each disc a single pop as the front crosses it.
      const dx = sweepFront - i;
      let pop = 0;
      if (dx >= 0 && dx < 1) pop = Math.sin(dx * Math.PI); // 0→1→0 over one index
      const s = 1 + 0.16 * pop;
      d.scale.set(s, s, s);
    }
  }

  // ---- lamp heartbeat at game over ------------------------------------------
  // The winner lamp's base colour/emissive are set ONCE in announceOver() (so the
  // glow is the winner's hue, never the black/dim that refreshLamps leaves behind
  // when it runs before lampPulse flips true). Here we only modulate the intensity
  // so the heartbeat is a visible coloured pulse rather than an invisible black one.
  //
  // DRAW (item #9): on a full board there is no winner, so the old code armed no
  // pulse and stepLamps no-op'd — the end-state read as a dropped turn. announceOver
  // now also lights BOTH lamps for a draw and arms lampPulse; here we drive a gentle
  // ANTI-PHASE shimmer (red up while yellow down) so a draw reads unmistakably as a
  // shared, deliberate "nobody won" beat rather than a crash. Per-material emissive
  // only on the dedicated lamp materials (no shared-disc material touched).
  function stepLamps(dt) {
    if (!lampPulse) return;
    lampPhase += dt;
    if (winner === "red" || winner === "yellow") {
      const winMat = winner === "red" ? matLampRed : matLampYellow;
      winMat.emissiveIntensity = 0.65 + 0.65 * (0.5 + 0.5 * Math.sin(lampPhase * 3));
    } else {
      // draw: both lit, breathing in opposition.
      const s = 0.5 + 0.5 * Math.sin(lampPhase * 2.4);
      matLampRed.emissiveIntensity = 0.4 + 0.5 * s;
      matLampYellow.emissiveIntensity = 0.4 + 0.5 * (1 - s);
    }
  }

  // ---- turn arrow bob -------------------------------------------------------
  // When it is the LOCAL player's turn the arrow bobs with a wider amplitude and a
  // brighter emissive heartbeat ("it's YOU"); on the opponent's turn it sits calmer
  // and dimmer. Purely visual — drives off canPlayLocally(), never state/sync.
  function stepArrow(dt) {
    if (phase !== "play" || !arrow.visible) return;
    arrowPhase += dt;
    // advance the turn-flip colour cross-fade (item #12), if any is in progress.
    if (arrowFade < 1) {
      arrowFade = Math.min(1, arrowFade + dt / ARROW_FADE);
      matArrow.color.copy(_arrowFrom).lerp(_arrowTo, arrowFade);
      matArrow.emissive.copy(matArrow.color);
    }
    const mine = canPlayLocally();
    const amp = mine ? CELL * 0.14 : CELL * 0.06;
    const speed = mine ? 4.2 : 2.6;
    arrow.position.y = cellY(0) + CELL * 1.55 + Math.sin(arrowPhase * speed) * amp;
    const baseI = mine ? 1.05 : 0.55;
    const swing = mine ? 0.45 : 0.12;
    matArrow.emissiveIntensity = baseI + swing * (0.5 + 0.5 * Math.sin(arrowPhase * speed));
    if (youRing.visible) {
      matYouRing.emissiveIntensity = mine ? 1.0 + 0.5 * (0.5 + 0.5 * Math.sin(arrowPhase * speed)) : 0.45;
    }
  }

  // ---- hover ease-in + idle bob (ghost) and breathing landing rim (I2) ------
  function stepHover(dt) {
    if (!ghost.visible) return;
    hoverPhase += dt;
    if (hoverIn < 1) hoverIn = Math.min(1, hoverIn + dt * 6);
    // ease-out cubic so the ghost pops in then settles.
    const e = 1 - Math.pow(1 - hoverIn, 3);
    const bob = Math.sin(hoverPhase * 3) * CELL * 0.05 * e;
    ghost.position.y = MOUTH_Y + bob;
    const s = 0.7 + 0.3 * e;
    ghost.scale.set(s, s, s);
    ghost.material.opacity = GHOST_BASE_OPACITY * e;
    if (rim.visible) {
      // breathe the rim's emissive + scale so the target hole reads clearly.
      const pulse = 0.5 + 0.5 * Math.sin(hoverPhase * 3.4);
      matAccent.emissiveIntensity = 0.7 + 0.55 * pulse;
      const rs = 1 + 0.06 * pulse;
      rim.scale.set(rs, rs, rs);
    }
  }

  // ============================================================================
  // RENDERING / PROJECTION — the scene is a pure function of `board`.
  // ============================================================================
  function placeStaticDisc(r, c, color) {
    let d = discs[r][c];
    if (!d) {
      d = mesh(discGeo, color === "red" ? matRed : matYellow);
      discRoot.add(d);
      discs[r][c] = d;
    }
    d.material = color === "red" ? matRed : matYellow;
    d.position.set(cellX(c), cellY(r), DISC_Z);
    d.scale.set(1, 1, 1);
    return d;
  }

  function clearScene() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const d = discs[r][c];
        if (d) {
          discRoot.remove(d);
          discs[r][c] = null;
        }
      }
    }
    bodies.length = 0;
    winAnim.active = false;
    halo.visible = false;
    halo.scale.setScalar(1);
    lastRing.visible = false;
    fullFlash = 0;
    fullFlashCol = -1;
    fullRing.visible = false;
    matFull.opacity = 0;
    clearHover();
  }

  // Repaint the WHOLE scene from `board` with no animation.
  function paint() {
    clearScene();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = board[r][c];
        if (v) placeStaticDisc(r, c, v);
      }
    }
    if (phase === "over" && winLine) startWinFx(/*instant*/ true);
    paintLastMarker();
    refreshLamps();
  }

  // ============================================================================
  // THE SINGLE MUTATOR — commit(col, color, animate)
  // ============================================================================
  function commit(col, color, animate) {
    if (!isLegalCol(col) || phase !== "play") return -1;
    const r = dropRow(board, col);
    if (r < 0) return -1;
    board[r][col] = color;
    lastDrop = { r, c: col };

    if (animate) {
      spawnFalling(r, col, color);
    } else {
      placeStaticDisc(r, col, color);
      resolveAfter(r, col, color);
    }
    return r;
  }

  function spawnFalling(r, c, color) {
    busy = true; // lock input until this disc settles and resolveAfter runs
    const d = mesh(discGeo, color === "red" ? matRed : matYellow);
    d.position.set(cellX(c), MOUTH_Y, DISC_Z);
    discRoot.add(d);
    discs[r][c] = d;
    bodies.push({
      mesh: d,
      r,
      c,
      color,
      y: MOUTH_Y,
      vy: 0,
      restY: cellY(r),
      settled: false,
      squash: 0,
      resolveOnRest: true,
    });
    clearHover();
    ensureClock();
  }

  // Win/draw resolution + turn flip. WIN is checked before DRAW.
  function resolveAfter(r, c, color) {
    busy = false; // the disc has settled; the turn is about to flip / game ends
    const line = winningCells(board, r, c, color);
    if (line) {
      winLine = line;
      winner = color;
      phase = "over";
      startWinFx(false);
      paintLastMarker(); // hides the ring now that phase==="over" (halo takes over)
      refreshLamps();
      announceOver();
      // The logical resolution (turn/winner/winLine/phase) only exists NOW —
      // commit(animate=true) deferred it here. Broadcast the resolved snapshot
      // so peers/spectators receive the correct side-to-move and win line.
      // Self-gated to the host inside pushState().
      pushState();
      return;
    }
    if (isFull(board)) {
      winner = null;
      winLine = null;
      phase = "over";
      paintLastMarker(); // hides during the draw beat
      refreshLamps();
      announceOver();
      pushState();
      return;
    }
    turn = other(turn);
    paintLastMarker(); // surface the just-landed disc for both players + spectators
    refreshLamps();
    pushState();
  }

  function startWinFx(instant) {
    if (!winLine) return;
    for (const [r, c] of winLine) {
      const d = discs[r][c];
      if (d) d.material = winner === "red" ? matRedWin : matYellowWin;
    }
    halo.visible = true;
    if (instant) {
      // INTENT (item #5): the winning run deliberately "pops out" of the rack — its
      // front face (DISC_Z + DISC_T*1.2 ≈ 0.046) clears the front frame ribs (front
      // ≈ 0.037) so the run reads as lifted ABOVE the lattice, not z-fighting inside
      // it. This is the celebration beat, not a clipping bug; the animated path eases
      // to the same depth in stepWinAnim().
      const n = winLine.length;
      const [rm, cm] = winLine[Math.floor(n / 2)];
      halo.position.set(cellX(cm), cellY(rm), DISC_Z + DISC_T);
      for (const [r, c] of winLine) {
        const d = discs[r][c];
        if (d) d.position.z = DISC_Z + DISC_T * 1.2;
      }
      winAnim.active = false;
    } else {
      winAnim.active = true;
      winAnim.t = 0;
      ensureClock();
    }
  }

  let overAnnounced = false;
  function announceOver() {
    if (overAnnounced) return;
    overAnnounced = true;
    // Pulse on EITHER a win OR a draw (item #9). refreshLamps() ran earlier while
    // lampPulse was still false and left both lamps in their black/dim tint, so we
    // re-light the pulse base here before stepLamps modulates intensity.
    lampPulse = phase === "over";
    if (winner) {
      // Light the winner's lamp at its OWN colour as the pulse base. Without this the
      // emissive would still be #000000 → an invisible "black" pulse.
      const winColor = winner === "red" ? "#e23b4e" : "#f2c14e";
      setLamp(winner === "red" ? matLampRed : matLampYellow, winColor, true);
      ensureClock();
    } else if (lampPulse) {
      // Draw: light BOTH lamps at their own colour so the anti-phase shimmer in
      // stepLamps reads as a deliberate shared "nobody won" beat.
      setLamp(matLampRed, "#e23b4e", true);
      setLamp(matLampYellow, "#f2c14e", true);
      ensureClock();
    }
    try {
      reportOver({ winner: winner || null, reason: winner ? "four" : "draw" });
    } catch {
      /* framework callback must never break the module */
    }
  }

  // ============================================================================
  // TURN HUD — twin lamps + the coloured down-arrow.
  // ============================================================================
  function refreshLamps() {
    if (phase === "over") {
      arrow.visible = false;
      if (!lampPulse) {
        setLamp(matLampRed, "#e23b4e", false);
        setLamp(matLampYellow, "#f2c14e", false);
      }
      return;
    }
    setLamp(matLampRed, "#e23b4e", turn === "red");
    setLamp(matLampYellow, "#f2c14e", turn === "yellow");
    // arrow tracks the side-to-move's colour and stays visible during play. Cross-fade
    // to the new hue (item #12) only when it actually changed; a repaint that lands on
    // the same colour settles instantly (no spurious fade on hydration).
    const col = turn === "red" ? "#e23b4e" : "#f2c14e";
    _arrowTo.set(col);
    if (!_arrowTo.equals(matArrow.color)) {
      _arrowFrom.copy(matArrow.color);
      arrowFade = 0; // stepArrow eases color+emissive from _arrowFrom → _arrowTo
    } else {
      matArrow.color.copy(_arrowTo);
      matArrow.emissive.copy(_arrowTo);
      arrowFade = 1;
    }
    arrow.visible = true;
    ensureClock();
  }
  // An UNLIT lamp keeps a faint tint of its own side (dim red / dim yellow) plus a
  // low emissive so both lamps stay identifiable against the dark frame from either
  // seat and under low café lighting; only the side-to-move brightens to full.
  function dimTint(color) {
    return color === "#e23b4e" ? "#4a2226" : "#4a3c1e";
  }
  function setLamp(mat, color, lit) {
    mat.color.set(lit ? color : dimTint(color));
    mat.emissive.set(lit ? color : dimTint(color));
    mat.emissiveIntensity = lit ? 0.9 : 0.18;
  }

  // ============================================================================
  // HOVER PREVIEW — ghost disc + cyan rim, gated to our turn + a legal column.
  // ============================================================================
  function setHover(cell) {
    // board.js now forwards the FULL resolved {r,c,which} cell (or a number/-1).
    // Connect-4 only needs the column: accept either shape.
    const col = (cell && typeof cell === "object") ? cell.c : cell;
    if (!canPlayLocally() || !isLegalCol(col) || dropRow(board, col) < 0) {
      // Full-column feedback (item #10): if it IS our turn and the player is pointing
      // at a real but FULL column, flash that column's top hole red so the "no entry"
      // reads instantly. Off-turn / off-grid hovers stay silent.
      if (canPlayLocally() && isLegalCol(col) && dropRow(board, col) < 0) triggerFullFlash(col);
      clearHover();
      return;
    }
    if (col === hoverCol) return;
    hoverCol = col;
    hoverIn = 0; // restart the ease-in for the freshly hovered column

    ghost.material = myColor === "yellow" ? matGhostYellow : matGhostRed;
    ghost.position.set(cellX(col), MOUTH_Y, DISC_Z);
    ghost.scale.set(0.7, 0.7, 0.7);
    ghost.material.opacity = 0;
    ghost.visible = true;

    const r = dropRow(board, col);
    rim.position.set(cellX(col), cellY(r), DISC_Z + DISC_T / 2 + 0.002);
    rim.visible = true;
    ensureClock();
  }
  function clearHover() {
    hoverCol = -1;
    ghost.visible = false;
    rim.visible = false;
    // restore the shared ghost materials' base opacity so a static repaint or the
    // next hover doesn't inherit a mid-ease faded alpha.
    matGhostRed.opacity = GHOST_BASE_OPACITY;
    matGhostYellow.opacity = GHOST_BASE_OPACITY;
    ghost.scale.set(1, 1, 1);
  }

  // True iff the local player may currently drop in their own colour.
  function canPlayLocally() {
    return !busy && phase === "play" && myColor != null && turn === myColor && isAllowed();
  }

  // ============================================================================
  // SNAPSHOT (publicState / applyState payloads). Full-info ⇒ public === full.
  // ============================================================================
  function snapshot() {
    return {
      board: board.map((row) => row.slice()),
      turn,
      phase,
      win: winLine ? winLine.map(([r, c]) => [r, c]) : null,
      winner,
      lastDrop: lastDrop ? { r: lastDrop.r, c: lastDrop.c } : null,
    };
  }

  function pushState() {
    if (role !== "host") return;
    const snap = snapshot();
    try {
      net.sendState?.(snap, snap);
    } catch {
      /* transport hiccup: the next move re-pushes */
    }
  }

  // ============================================================================
  // CONTRACT METHODS
  // ============================================================================

  // Render an AUTHORITATIVE FULL snapshot. Idempotent rebuild from scratch.
  // state === null ⇒ fresh game (the framework's reset path passes null). NEVER
  // recomputes the local role/colour — myColor stays derived from our own role.
  function applyState(state) {
    overAnnounced = false;
    // A full snapshot rebuilds the scene via paint()->clearScene(), which drops
    // any in-flight falling body before it can settle — so resolveAfter() (the
    // only place busy is cleared) would never run. Reset the input lock here so
    // a resync that lands mid-drop always returns the module to interactable.
    busy = false;
    lampPulse = false;
    lampPhase = 0;
    if (state == null) {
      board = emptyBoard();
      turn = "red";
      phase = "play";
      winLine = null;
      winner = null;
      lastDrop = null;
      paint();
      // Re-seed the server's cached snapshot on reset so a spectator that joins
      // after the reset (but before the next move) hydrates against the fresh empty
      // board and animates the first move. Host-gated inside pushState().
      pushState();
      return;
    }
    const b = emptyBoard();
    const src = Array.isArray(state.board) ? state.board : null;
    if (src) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const v = src[r] ? src[r][c] : null;
          if (v === "red" || v === "yellow") b[r][c] = v;
        }
      }
    }
    board = b;
    turn = state.turn === "yellow" ? "yellow" : "red";
    phase = state.phase === "over" ? "over" : "play";
    winner = state.winner === "red" || state.winner === "yellow" ? state.winner : null;

    // Recompute/validate the winning line locally rather than trusting the wire.
    winLine = null;
    if (phase === "over" && winner && state.lastDrop && Number.isInteger(state.lastDrop.r) && Number.isInteger(state.lastDrop.c)) {
      const { r, c } = state.lastDrop;
      if (board[r] && board[r][c] === winner) winLine = winningCells(board, r, c, winner);
    }
    if (phase === "over" && winner && !winLine && Array.isArray(state.win)) {
      // Validate wire-supplied cells against the reconstructed board rather than
      // trusting them: keep only in-grid cells that actually hold `winner`, and
      // require a run of at least 4. A garbled/forged/stale `win` array drops to
      // null instead of highlighting arbitrary cells.
      const wl = state.win
        .filter((p) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]))
        .map(([r, c]) => [r, c])
        .filter(([r, c]) => board[r] && board[r][c] === winner);
      winLine = wl.length >= 4 ? wl : null;
    }
    lastDrop = state.lastDrop && Number.isInteger(state.lastDrop.r) && Number.isInteger(state.lastDrop.c) ? { r: state.lastDrop.r, c: state.lastDrop.c } : null;

    paint();
    if (phase === "over") announceOver();
  }

  // Apply+animate ONE relayed move {type:"drop", col}. Validate against local
  // rules; on mismatch throw GameDesync so the framework requests a resync.
  function applyMove(move, byRole) {
    if (!move || move.type !== "drop") return false;
    const col = move.col;
    if (!isLegalCol(col)) throw new GameDesync("connect4: out-of-grid column");
    if (phase !== "play") throw new GameDesync("connect4: move after game over");
    if (dropRow(board, col) < 0) throw new GameDesync("connect4: drop into full column");
    const movedColor = byRole ? colorForRole(byRole) : turn;
    if (movedColor && movedColor !== turn) throw new GameDesync("connect4: out-of-turn relayed move");
    // commit(animate=true) defers turn flip / win detection into resolveAfter(),
    // which broadcasts the RESOLVED authoritative snapshot once the disc settles
    // (host-gated via pushState). We must NOT push here: at this instant turn is
    // still the mover's colour and winner/winLine are null, so an immediate push
    // would relay a stale pre-resolution snapshot (wrong side-to-move, no win
    // line) that clobbers peers mid-animation. resolveAfter()'s push re-caches
    // t.pub on server.js and fires broadcastAmbient() with the correct state.
    commit(col, turn, /*animate*/ true);
    return true;
  }

  // Local click. Only the COLUMN matters (gravity derives the row).
  function onPointer(hit) {
    if (!hit || !hit.cell) return;
    if (!canPlayLocally()) return;
    const col = hit.cell.c;
    if (!isLegalCol(col)) return;
    if (dropRow(board, col) < 0) return;

    const color = turn; // === myColor by canPlayLocally()
    clearHover();
    const r = commit(col, color, /*animate*/ true);
    if (r < 0) return;

    // Wire carries ONLY the column; the peer derives the landing row from gravity.
    // Keep the move relay immediate for low latency. We deliberately do NOT
    // pushState() here: the logical resolution (turn flip + win/draw) is deferred
    // by commit(animate=true) into resolveAfter(), which broadcasts the resolved
    // snapshot (host-gated) once the disc settles. Pushing now would relay a
    // stale pre-resolution snapshot.
    try {
      net.sendMove?.({ type: "drop", col });
    } catch {
      /* transport hiccup: resolveAfter()'s snapshot push still re-seeds authority */
    }
  }

  // Module-side raycast→cell resolver. We map the hit's LOCAL x onto a column;
  // the row is irrelevant to a Connect-4 move but we return the lowest open row.
  function hitToCell(hit) {
    if (!hit || !hit.point) return null;
    // Resolve in rack-local space: undoes the table transform + our facing
    // rotation so the visible column maps to the same canonical column on every
    // seat.
    const local = rack.worldToLocal(hit.point.clone());
    const u = (local.x - GRID_LEFT) / GRID_W;
    if (u < 0 || u >= 1) return null;
    // Bound the local Y to the playable grid rows so a hit on non-cell geometry
    // that shares the grid's X span (base slab, brass rail, turn arrow, ready
    // lamps) does NOT resolve to a column and trigger a drop. The grid rows span
    // roughly from the bottom hole to the top hole (plus half a cell of bezel).
    // Extend the top bound up to the column mouth (where the ghost cocks and a
    // player naturally aims) so clicks at the top of a column resolve. The brass
    // rail centre is at cellY(0)+0.85*CELL, the lamps share that y but sit OUTSIDE
    // the grid's X span (so u<0/u>=1 rejects them), and the arrow is at
    // cellY(0)+1.55*CELL — so a mouth-inclusive top of cellY(0)+1.35*CELL keeps the
    // grid clickable while still excluding the arrow tip above it.
    const yBot = cellY(ROWS - 1) - CELL * 0.7;
    const yTop = cellY(0) + CELL * 1.35;
    if (local.y < yBot || local.y > yTop) return null;
    const c = Math.min(COLS - 1, Math.max(0, Math.floor(u * COLS)));
    const r = dropRow(board, c);
    return { r: r < 0 ? 0 : r, c };
  }

  // Full-info ⇒ public state IS the full snapshot.
  function publicState() {
    return snapshot();
  }

  // Role changed (spectator → host/guest on sitting, or re-seat).
  function setRole(nextRole) {
    role = nextRole || "spectator";
    myColor = colorForRole(role);
    refreshYouMarker();
    if (!canPlayLocally()) clearHover();
  }

  // Viewer re-seated. Re-apply the faceplate facing and drop any stale hover.
  function setSeatRy(ry) {
    seatRy = ry ?? null;
    applyFacing();
    clearHover();
  }

  // Optional per-frame pump. Not required (we self-drive via rAF) but harmless;
  // the framework calls update(dt) on modules that expose it. We use it only to
  // guarantee the clock is alive while play is in progress (e.g. a browser that
  // throttled our private rAF when backgrounded).
  function update() {
    if (needsAnim()) ensureClock();
  }

  // Free every geometry + material we minted and drop the group from the table.
  function dispose() {
    if (rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    bodies.length = 0;
    clearScene();
    if (group.parent) group.parent.remove(group);
    for (const d of disposables) {
      try {
        d.dispose?.();
      } catch {
        /* ignore */
      }
    }
    disposables.length = 0;
  }

  // ---- initial paint --------------------------------------------------------
  paint();
  // BUG (mid-join spectator drops first move): the host otherwise only ever
  // broadcasts AFTER a move resolves (resolveAfter→pushState), so until the first
  // drop lands the server's cached pub/full are null. A spectator that mounts in
  // that window gets pub:null, board.js _onState bails, _hydrated stays false, and
  // the first relayed move is DROPPED by the spectator gate (never animated).
  // Publish the authoritative empty board at game start so a joining spectator's
  // requestState() returns a real pub, hydrates, and animates the first move.
  // Host-gated inside pushState(); a no-op for guest/spectator instances.
  pushState();

  return {
    group,
    orientPolicy: "self",
    // Explicit contract (item #1): this is a full-info, turn-based module whose
    // spectator/guest applyMove actually APPLIES + animates the relayed move (the
    // drop falls, then resolveAfter flips the turn). board.js arms its one-shot
    // post-move snapshot-swallow window only when spectatorAnimates !== false, so the
    // animation isn't snapped away by the host's redundant echo snapshot. The old
    // instance omitted this flag and relied on `undefined !== false` being truthy;
    // stating it explicitly keeps the contract from silently flipping in a refactor.
    spectatorAnimates: true,
    applyState,
    applyMove,
    onPointer,
    hitToCell,
    publicState,
    setRole,
    setSeatRy,
    setHover,
    update,
    dispose,
  };
}

export default createGame;
