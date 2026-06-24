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
    if (line.length >= 4) return line;
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
const MOUTH_Y = cellY(0) + CELL * 1.25;

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

  // ============================================================================
  // SHARED MATERIALS + GEOMETRY (created once; freed in dispose()).
  // ============================================================================
  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };

  const matFrame = keep(new THREE.MeshStandardMaterial({ color: "#1f4ea8", roughness: 0.5, metalness: 0.15 }));
  const matBack = keep(new THREE.MeshStandardMaterial({ color: "#14305f", roughness: 0.7, metalness: 0.08 }));
  const matBase = keep(new THREE.MeshStandardMaterial({ color: "#16387a", roughness: 0.7, metalness: 0.1 }));
  const matRail = keep(new THREE.MeshStandardMaterial({ color: "#caa15a", roughness: 0.35, metalness: 0.85 }));

  const matRed = keep(new THREE.MeshStandardMaterial({ color: "#e23b4e", roughness: 0.35, metalness: 0.1, emissive: "#5a0d16", emissiveIntensity: 0.5 }));
  const matYellow = keep(new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.35, metalness: 0.1, emissive: "#5a4208", emissiveIntensity: 0.5 }));
  const matRedWin = keep(new THREE.MeshStandardMaterial({ color: "#ff8090", roughness: 0.25, metalness: 0.1, emissive: "#ff3b4e", emissiveIntensity: 1.0 }));
  const matYellowWin = keep(new THREE.MeshStandardMaterial({ color: "#ffe79a", roughness: 0.25, metalness: 0.1, emissive: "#ffcf4e", emissiveIntensity: 1.0 }));

  // Translucent ghost (preview), tinted to the local player's own colour.
  const matGhostRed = keep(new THREE.MeshStandardMaterial({ color: "#e23b4e", roughness: 0.4, transparent: true, opacity: 0.34, emissive: "#7fd1ff", emissiveIntensity: 0.3, depthWrite: false }));
  const matGhostYellow = keep(new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.4, transparent: true, opacity: 0.34, emissive: "#7fd1ff", emissiveIntensity: 0.3, depthWrite: false }));

  const matAccent = keep(new THREE.MeshStandardMaterial({ color: "#7fd1ff", roughness: 0.4, metalness: 0.0, emissive: "#7fd1ff", emissiveIntensity: 0.95, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  const matHalo = keep(new THREE.MeshStandardMaterial({ color: "#fff1b8", roughness: 0.3, metalness: 0.2, emissive: "#ffd24a", emissiveIntensity: 1.4 }));

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
    // the upright rack's readable surface is +Z, so the extra π turns +Z toward
    // the local viewer from every chair. hitToCell resolves via rack.worldToLocal,
    // so column mapping (and the natural L/R mirror between opposing seats) stays
    // correct under this rotation.
    rack.rotation.y = orientFor(seatRy) + Math.PI;
  }
  applyFacing();

  // -- back-plate -------------------------------------------------------------
  const SLAB_W = GRID_W + CELL * 0.5;
  const SLAB_H = GRID_H + CELL * 0.5;
  const backGeo = keep(new THREE.BoxGeometry(SLAB_W, SLAB_H, BACK_T));
  const back = mesh(backGeo, matBack);
  back.position.set(0, GRID_BOTTOM + GRID_H / 2 - CELL / 2, 0);
  rack.add(back);

  // -- front frame: outer ring + vertical column dividers (open between holes) -
  const frameTopGeo = keep(new THREE.BoxGeometry(SLAB_W, CELL * 0.28, FRAME_D));
  const frameBotGeo = keep(new THREE.BoxGeometry(SLAB_W, CELL * 0.28, FRAME_D));
  const frameSideGeo = keep(new THREE.BoxGeometry(CELL * 0.28, GRID_H + CELL * 0.5, FRAME_D));
  const frameMidY = back.position.y;
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

  // slim vertical dividers between columns
  const dividerGeo = keep(new THREE.BoxGeometry(CELL * 0.06, GRID_H, FRAME_D * 0.8));
  for (let c = 1; c < COLS; c++) {
    const div = mesh(dividerGeo, matFrame);
    div.position.set(GRID_LEFT + c * CELL, frameMidY, frameZ);
    rack.add(div);
  }

  // -- open hole bezels (rings), per cell -------------------------------------
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const bez = mesh(bezelGeo, matFrame, false);
      bez.position.set(cellX(c), cellY(r), DISC_Z);
      rack.add(bez);
    }
  }

  // -- base / feet ------------------------------------------------------------
  const baseGeo = keep(new THREE.BoxGeometry(SLAB_W + 0.06, BASE_H, FRAME_D + BACK_T + 0.06));
  const base = mesh(baseGeo, matBase);
  base.position.set(0, FOOT_Y + BASE_H / 2, DISC_Z / 2);
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
    if (myColor === "red") {
      youRing.position.copy(lampRed.position);
      youRing.position.z += 0.006;
      youRing.visible = true;
    } else if (myColor === "yellow") {
      youRing.position.copy(lampYellow.position);
      youRing.position.z += 0.006;
      youRing.visible = true;
    } else {
      youRing.visible = false;
    }
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

  let hoverCol = -1;

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

  function needsAnim() {
    return bodies.length > 0 || winAnim.active || lampPulse || (phase === "play" && arrow.visible);
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
          b.squash = 0.5;
          b.settled = true;
        } else {
          b.vy = speed * RESTITUTION;
          b.squash = Math.min(1, speed * 0.6);
        }
      }

      b.mesh.position.y = b.y;

      if (b.squash > 0) {
        b.squash = Math.max(0, b.squash - dt * 6);
        const s = b.squash;
        b.mesh.scale.set(1 + 0.22 * s, 1 - 0.35 * s, 1 + 0.22 * s);
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
      halo.scale.setScalar(1 + 0.12 * Math.sin(winAnim.t * 6));
    }
    // ease the winning discs forward out of the rack.
    const lift = Math.min(1, winAnim.t / 0.5) * (DISC_T * 1.2);
    for (const [r, c] of winLine) {
      const d = discs[r][c];
      if (d) d.position.z = DISC_Z + lift;
    }
  }

  // ---- lamp heartbeat at game over ------------------------------------------
  function stepLamps(dt) {
    if (!lampPulse) return;
    lampPhase += dt;
    const winMat = winner === "red" ? matLampRed : winner === "yellow" ? matLampYellow : null;
    if (winMat) winMat.emissiveIntensity = 0.6 + 0.6 * (0.5 + 0.5 * Math.sin(lampPhase * 3));
  }

  // ---- turn arrow bob -------------------------------------------------------
  function stepArrow(dt) {
    if (phase !== "play" || !arrow.visible) return;
    arrowPhase += dt;
    arrow.position.y = cellY(0) + CELL * 1.55 + Math.sin(arrowPhase * 3) * CELL * 0.08;
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
    const line = winningCells(board, r, c, color);
    if (line) {
      winLine = line;
      winner = color;
      phase = "over";
      startWinFx(false);
      refreshLamps();
      announceOver();
      return;
    }
    if (isFull(board)) {
      winner = null;
      winLine = null;
      phase = "over";
      refreshLamps();
      announceOver();
      return;
    }
    turn = other(turn);
    refreshLamps();
  }

  function startWinFx(instant) {
    if (!winLine) return;
    for (const [r, c] of winLine) {
      const d = discs[r][c];
      if (d) d.material = winner === "red" ? matRedWin : matYellowWin;
    }
    halo.visible = true;
    if (instant) {
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
    lampPulse = !!winner;
    if (lampPulse) ensureClock();
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
    // arrow tracks the side-to-move's colour and stays visible during play.
    const col = turn === "red" ? "#e23b4e" : "#f2c14e";
    matArrow.color.set(col);
    matArrow.emissive.set(col);
    arrow.visible = true;
    ensureClock();
  }
  function setLamp(mat, color, lit) {
    mat.color.set(lit ? color : "#2a2f3a");
    mat.emissive.set(lit ? color : "#000000");
    mat.emissiveIntensity = lit ? 0.9 : 0;
  }

  // ============================================================================
  // HOVER PREVIEW — ghost disc + cyan rim, gated to our turn + a legal column.
  // ============================================================================
  function setHover(col) {
    if (!canPlayLocally() || !isLegalCol(col) || dropRow(board, col) < 0) {
      clearHover();
      return;
    }
    if (col === hoverCol) return;
    hoverCol = col;

    ghost.material = myColor === "yellow" ? matGhostYellow : matGhostRed;
    ghost.position.set(cellX(col), MOUTH_Y, DISC_Z);
    ghost.visible = true;

    const r = dropRow(board, col);
    rim.position.set(cellX(col), cellY(r), DISC_Z + DISC_T / 2 + 0.002);
    rim.visible = true;
  }
  function clearHover() {
    hoverCol = -1;
    ghost.visible = false;
    rim.visible = false;
  }

  // True iff the local player may currently drop in their own colour.
  function canPlayLocally() {
    return phase === "play" && myColor != null && turn === myColor && isAllowed();
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
      const wl = state.win.filter((p) => Array.isArray(p) && p.length === 2).map(([r, c]) => [r, c]);
      winLine = wl.length ? wl : null;
    }
    lastDrop = state.lastDrop && Number.isInteger(state.lastDrop.r) ? { r: state.lastDrop.r, c: state.lastDrop.c } : null;

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
    try {
      net.sendMove?.({ type: "drop", col });
    } catch {
      /* transport hiccup: snapshot push below still re-seeds authority */
    }
    pushState();
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

  return {
    group,
    orientPolicy: "self",
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
