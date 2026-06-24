// Connect 4 — in-world 3D table game module (createGame contract). VARIATION #19.
//
// A COMPLETE, fully self-contained ES module implementing the `createGame(ctx)`
// contract documented in ./createGame.js and hosted by the framework in
// ./board.js. The framework owns the café table, the WS relay (a per-room curried
// `net`), role/turn gating, and spectator read-only mode. THIS module owns ONLY
// the rules, the 3D geometry, and per-column hit-testing — nothing else. It pulls
// THREE from ctx (never a second copy) and imports only the shared spine helpers.
//
// ──────────────────────────────────────────────────────────────────────────────
// HOW VARIATION #19 IS GENUINELY DISTINCT — "the chunky arcade cabinet with a
// real bouncing drop and a column launcher lever."
// ──────────────────────────────────────────────────────────────────────────────
// Where other variants reach for frosted glass tanks, open lattices, or floating
// ring bezels, this one is unapologetically the SOLID classic Connect 4 you grew
// up with — but built honestly in 3D, with three things the 2D version never had:
//
//   1. THICK SOLID FACEPLATE WITH REAL DRILLED SOCKETS. The board is one chunky
//      blue slab (--board #1f4ea8 / edge --board-edge #16387a) with 42 actual
//      cylindrical sockets recessed into it — a front bezel ring + a recessed dark
//      hole (--hole #0a1426). Discs are thin lens cylinders captured INSIDE the
//      slab, visible across the café table exactly as a physical set reads. No
//      painted-on holes; the geometry is the hole.
//
//   2. A SPRING-GRAVITY DROP WITH A REAL BOUNCE + SQUASH. Dropped discs do not
//      lerp into place — they FALL under constant gravitational acceleration from
//      the slot mouth above the column, slam the stack below, and bounce with
//      restitution before settling, briefly squashing on each impact (vertical
//      scale dips, radial scale swells, conserving volume) like a real checker
//      rattling down the chute. Each disc owns a tiny physics body; the clock
//      integrates them and PARKS itself the instant the last body sleeps.
//
//   3. A COLUMN LAUNCHER LEVER as the targeting affordance. Above the seven
//      columns sits a slim brass rail; the hovered column lifts a little spring
//      "loader" (a tilted chute + a translucent ghost disc cocked in it) over that
//      column, and the lowest open socket glows with a cyan rim (--accent #7fd1ff)
//      — the 3D analogue of the 2D cyan inset preview ring. Full / off-turn columns
//      refuse to cock the loader at all, so the affordance itself signals legality.
//
//   4. WIN CELEBRATION = LIFTED RUN + GOLDEN HALO SWEEP. When four-plus line up,
//      the winning discs ease FORWARD out of the slab a few millimetres, gain a
//      bright emissive highlight, and a golden torus halo sweeps along the run from
//      one end to the other then parks ringing the centre disc, pulsing. Clean and
//      legible from any seat; no confetti, no spin.
//
//   5. TWIN READY-LAMPS AS THE TURN HUD. Two domed lamps (red + yellow) flank the
//      top rail; the side-to-move's lamp glows (emissive up), the idle one is dark.
//      At game over both dim, the winner's gives a slow heartbeat. Readable from
//      either side of the table with zero billboarding or text.
//
//   6. ONE COMMIT PATH. A single `commit(col, color, animate)` is the ONLY mutator
//      of the logical board/turn/phase; onPointer (local), applyMove (relayed), and
//      applyState (snapshot rebuild) all funnel through it or the shared `paint()`
//      projector, so a live drop, a relayed move, and a catch-up repaint touch
//      state identically — no spawn-vs-snapshot divergence. The scene is a pure
//      projection of `board` through a per-cell disc registry (`discs[r][c]`).
//
//   7. SELF-CONTAINED & TIDY. Inlined pure rules (single source of legality), a
//      lazy self-driven rAF clock that costs nothing while idle, and an exhaustive
//      dispose() that frees every geometry + material it minted.
//
// COORDINATE CONVENTION (verbatim from public/games/connect4/index.html):
//   board[r][c], r = 0 is the TOP row, r = ROWS-1 is the BOTTOM row. Gravity fills
//   the LARGEST empty r first ("lowest empty row"; dropRow scans bottom→top). The
//   wire carries ONLY the column; every peer recomputes the landing row from shared
//   gravity, so no row coordinate is ever trusted off the wire (anti-ghost-cell /
//   anti-desync). WIN is checked BEFORE DRAW. A win is a contiguous run of length
//   >= 4 through the just-placed cell (a longer run also wins; the whole run
//   lights). Out-of-turn / full-column / out-of-bounds inputs are silently ignored.
//   Red is the host and always drops first; yellow is the guest.
//
// THE CABINET STANDS UPRIGHT on the table: columns run along local X, rows stack
// along local Y (top row highest), the faceplate faces ±Z. Authored in the
// CANONICAL frame (the +Z face toward the ry-0 seat); the framework lifts the group
// to the tabletop (group.position.y = anchorY) and rotates it to each viewer's near
// edge via orientFor(seatRy). Our own hitToCell undoes that rotation through
// worldToLocal, so a host click and the guest's view of the same column agree.
//
// THREE.JS STYLE matches src/world/props.js: MeshStandardMaterial with
// roughness/metalness, shared geometry + materials created once, a small mesh()
// helper that flags castShadow/receiveShadow, and the group authored at its own
// local origin.

import { GameDesync, orientFor } from "./createGame.js";

// ============================================================================
// PURE RULES — ported verbatim (behaviour) from the authoritative 2D engine.
// Transport-free and side-effect-free; kept inline so the module is fully
// self-contained and is the single source of truth on legality. Exported for
// tests / reuse.
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

// True only when every column is full (no column has any empty cell).
export function isFull(board) {
  for (let c = 0; c < COLS; c++) if (dropRow(board, c) >= 0) return false;
  return true;
}

export const other = (color) => (color === "red" ? "yellow" : "red");

// If placing `color` at (r,c) completes a contiguous line of length >= 4 through
// that cell, return the WHOLE winning run (array of [r,c]); otherwise null. Only
// the four axes through the just-placed cell are examined — sound because any
// earlier 4-line would already have ended the game. Length >= 4 so a 5-in-a-row
// also wins and the entire run is returned.
export function winningCells(board, r, c, color) {
  const dirs = [
    [0, 1], // horizontal  →
    [1, 0], // vertical    ↓
    [1, 1], // diagonal    ↘
    [1, -1], // diagonal   ↙
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

// A received column is honoured only when it is a real in-grid integer. Mirrors
// the 2D guard against a malformed/hostile peer writing an off-grid ghost cell.
export function isLegalCol(col) {
  return Number.isInteger(col) && col >= 0 && col < COLS;
}

// ============================================================================
// GEOMETRY CONSTANTS — the upright cabinet, authored at its own local origin
// with y=0 on the tabletop (the framework sets group.position.y = anchorY).
// ============================================================================
const BOARD_W = 0.62; // overall grid width  (X) — fits the ~0.7 m square
const CELL = BOARD_W / COLS; // per-column / per-row pitch (square cells)
const GRID_W = CELL * COLS; // playable grid width
const GRID_H = CELL * ROWS; // playable grid height
const DISC_R = CELL * 0.38; // disc radius
const DISC_T = 0.018; // disc thickness (Z)
const SLAB_T = 0.05; // faceplate thickness (Z)
const SOCKET_R = CELL * 0.43; // recessed socket radius (a touch wider than disc)
const FOOT_Y = 0.012; // tabletop clearance under the feet
const BASE_H = 0.05; // height of the cabinet base/foot block

// Grid bottom sits above the base; the whole playable grid is centred in X.
const GRID_BOTTOM = FOOT_Y + BASE_H + CELL * 0.55;
const GRID_LEFT = -GRID_W / 2;

// Local position of the CENTRE of cell (r, c). r=0 is the TOP row, so a smaller r
// maps to a HIGHER y. Discs and sockets share this so a click resolves to the
// disc you see in that hole.
function cellX(c) {
  return GRID_LEFT + (c + 0.5) * CELL;
}
function cellY(r) {
  // r=0 → top row (highest y); r=ROWS-1 → bottom row (lowest y).
  return GRID_BOTTOM + (ROWS - 1 - r + 0.5) * CELL;
}

// Y of the slot mouth above a column where a freshly dropped disc enters.
const MOUTH_Y = cellY(0) + CELL * 1.35;

// Drop physics tuning (local metres, seconds).
const GRAVITY = -3.6; // m/s² in local space (snappy but readable on a table)
const RESTITUTION = 0.32; // bounce energy kept per impact
const REST_EPS = 0.18; // |v| below which an impact is treated as the final rest

// ============================================================================
// FACTORY
// ============================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const net = ctx.net || {};
  const isAllowed = typeof ctx.isLocalTurnAllowed === "function" ? ctx.isLocalTurnAllowed : () => false;
  const reportOver = typeof ctx.onGameOver === "function" ? ctx.onGameOver : () => {};

  // ---- colour identity ------------------------------------------------------
  // Host is red and ALWAYS drops first; guest is yellow. Spectators have no
  // colour (myColor stays null) — they only ever receive snapshots/moves.
  let role = ctx.role || "spectator";
  let seatRy = ctx.seatRy ?? null;
  const colorForRole = (rl) => (rl === "host" ? "red" : rl === "guest" ? "yellow" : null);
  let myColor = colorForRole(role);

  // ---- logical state (the single source of truth) ---------------------------
  let board = emptyBoard();
  let turn = "red"; // red always starts a game
  let phase = "play"; // "play" | "over"
  let winLine = null; // array of [r,c] or null
  let winner = null; // "red" | "yellow" | null (null + over ⇒ draw)
  let lastDrop = null; // {r,c} of most recent landing, for snapshot fidelity

  // ============================================================================
  // SHARED MATERIALS + GEOMETRY (created once; freed in dispose()).
  // ============================================================================
  const disposables = []; // geometries + materials we own
  const keep = (x) => {
    disposables.push(x);
    return x;
  };

  const matSlab = keep(new THREE.MeshStandardMaterial({ color: "#1f4ea8", roughness: 0.55, metalness: 0.1 }));
  const matEdge = keep(new THREE.MeshStandardMaterial({ color: "#16387a", roughness: 0.5, metalness: 0.12 }));
  const matSocket = keep(new THREE.MeshStandardMaterial({ color: "#0a1426", roughness: 0.9, metalness: 0.0 }));
  const matBase = keep(new THREE.MeshStandardMaterial({ color: "#16387a", roughness: 0.7, metalness: 0.1 }));
  const matRail = keep(new THREE.MeshStandardMaterial({ color: "#caa15a", roughness: 0.35, metalness: 0.85 }));

  const matRed = keep(new THREE.MeshStandardMaterial({ color: "#e23b4e", roughness: 0.35, metalness: 0.1, emissive: "#3a0a10", emissiveIntensity: 0.45 }));
  const matYellow = keep(new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.35, metalness: 0.1, emissive: "#3a2c08", emissiveIntensity: 0.45 }));
  const matRedWin = keep(new THREE.MeshStandardMaterial({ color: "#ff7080", roughness: 0.25, metalness: 0.1, emissive: "#ff3b4e", emissiveIntensity: 0.9 }));
  const matYellowWin = keep(new THREE.MeshStandardMaterial({ color: "#ffe08a", roughness: 0.25, metalness: 0.1, emissive: "#ffcf4e", emissiveIntensity: 0.9 }));

  // Translucent ghost (preview) — cyan-tinted, never opaque.
  const matGhostRed = keep(new THREE.MeshStandardMaterial({ color: "#e23b4e", roughness: 0.4, transparent: true, opacity: 0.32, emissive: "#7fd1ff", emissiveIntensity: 0.25, depthWrite: false }));
  const matGhostYellow = keep(new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.4, transparent: true, opacity: 0.32, emissive: "#7fd1ff", emissiveIntensity: 0.25, depthWrite: false }));

  const matAccent = keep(new THREE.MeshStandardMaterial({ color: "#7fd1ff", roughness: 0.4, metalness: 0.0, emissive: "#7fd1ff", emissiveIntensity: 0.9, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  const matHalo = keep(new THREE.MeshStandardMaterial({ color: "#fff1b8", roughness: 0.3, metalness: 0.2, emissive: "#ffd24a", emissiveIntensity: 1.3 }));

  // Reusable disc geometry: a thin lens (cylinder, flat faces toward ±Z).
  const discGeo = keep(new THREE.CylinderGeometry(DISC_R, DISC_R, DISC_T, 28));
  // Lay the cylinder so its flat circular faces look out along ±Z (board faces).
  discGeo.rotateX(Math.PI / 2);
  // Socket look: a short dark cylinder recessed into the slab.
  const socketGeo = keep(new THREE.CylinderGeometry(SOCKET_R, SOCKET_R, SLAB_T + 0.004, 26));
  socketGeo.rotateX(Math.PI / 2);
  const bezelGeo = keep(new THREE.TorusGeometry(SOCKET_R, CELL * 0.06, 8, 24));

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

  // -- solid faceplate slab with recessed sockets ----------------------------
  // The cabinet stands UPRIGHT with its readable face toward local +Z. A flat
  // board lets the framework rotate the whole `group` by orientFor(seatRy) so its
  // near edge meets the viewer — but a vertical cabinet must turn its FACEPLATE
  // toward the local seat instead. We declare orientPolicy:"self" (see the return
  // object) so the framework does NOT rotate the group, and we rotate slabRoot by
  // +orientFor(seatRy) ourselves: the faceplate (+Z) then faces the local seat
  // from every chair — the opposite-seated player sees the readable face, not the
  // dark back plate. Each client renders with its OWN seatRy, so both players get
  // a readable board with naturally mirrored columns. hitToCell resolves in
  // slabRoot-local space (below) so the visible column the user clicks maps to the
  // same canonical column on every seat.
  //
  // (Previously this counter-rotated by -orientFor to cancel a framework rotation
  // that no longer happens for orientPolicy:"self"; -orientFor froze the faceplate
  // to canonical +Z and showed the back to the opposite seat — the bug we fix.)
  const slabRoot = new THREE.Group();
  group.add(slabRoot);
  function applyFacing() {
    // The readable faceplate is the +Z face of slabRoot (slab, sockets, bezels and
    // discs all author toward +Z). For a seated player to READ that face, its
    // normal must point OUT of the table toward their chair. orientFor(seatRy)
    // alone rotates +Z to point AWAY from the seat at every chair (the cabinet's
    // dark back plate faces the reader). The extra +Math.PI flips the cabinet so
    // the +Z faceplate points toward the local seat from all four chairs
    // (faceNormal · seatDir = +1). Flat boards do NOT need this Pi because their
    // canonical near edge is the OPPOSITE (-Z) face; the upright cabinet's readable
    // surface is +Z, so it genuinely needs the half-turn.
    //
    // hitToCell resolves via slabRoot.worldToLocal, so it self-corrects for this
    // rotation — column mapping and the natural left/right mirror between opposing
    // seats stay correct. The win-lift (+local Z), rim and ghost all ride slabRoot,
    // so they follow the same single fix.
    slabRoot.rotation.y = orientFor(seatRy) + Math.PI;
  }
  applyFacing();

  const SLAB_W = GRID_W + CELL * 0.5;
  const SLAB_H = GRID_H + CELL * 0.5;
  const slabGeo = keep(new THREE.BoxGeometry(SLAB_W, SLAB_H, SLAB_T));
  const slab = mesh(slabGeo, matSlab);
  slab.position.set(0, GRID_BOTTOM + GRID_H / 2 - CELL / 2, 0);
  slabRoot.add(slab);

  // a slightly larger, darker back plate so discs never show daylight behind
  const backGeo = keep(new THREE.BoxGeometry(SLAB_W + 0.02, SLAB_H + 0.02, 0.012));
  const back = mesh(backGeo, matEdge);
  back.position.set(slab.position.x, slab.position.y, -SLAB_T / 2 - 0.006);
  slabRoot.add(back);

  // recessed sockets + front bezel rings, per cell
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const sock = mesh(socketGeo, matSocket, false);
      sock.position.set(cellX(c), cellY(r), 0);
      slabRoot.add(sock);
      const bez = mesh(bezelGeo, matEdge, false);
      bez.position.set(cellX(c), cellY(r), SLAB_T / 2 + 0.001);
      slabRoot.add(bez);
    }
  }

  // -- base / feet ------------------------------------------------------------
  const baseGeo = keep(new THREE.BoxGeometry(SLAB_W + 0.06, BASE_H, SLAB_T + 0.1));
  const base = mesh(baseGeo, matBase);
  base.position.set(0, FOOT_Y + BASE_H / 2, 0);
  slabRoot.add(base);

  // -- top brass rail (the launcher track) ------------------------------------
  const railGeo = keep(new THREE.BoxGeometry(SLAB_W, CELL * 0.16, 0.03));
  const rail = mesh(railGeo, matRail);
  rail.position.set(0, cellY(0) + CELL * 0.9, 0);
  slabRoot.add(rail);

  // -- twin ready lamps flanking the rail -------------------------------------
  const lampGeo = keep(new THREE.SphereGeometry(CELL * 0.16, 16, 12));
  const matLampRed = keep(new THREE.MeshStandardMaterial({ color: "#2a2f3a", roughness: 0.5, metalness: 0.3, emissive: "#000000", emissiveIntensity: 0 }));
  const matLampYellow = keep(new THREE.MeshStandardMaterial({ color: "#2a2f3a", roughness: 0.5, metalness: 0.3, emissive: "#000000", emissiveIntensity: 0 }));
  const lampRed = mesh(lampGeo, matLampRed, false);
  const lampYellow = mesh(lampGeo, matLampYellow, false);
  const lampY = rail.position.y;
  lampRed.position.set(-SLAB_W / 2 - CELL * 0.18, lampY, 0.02);
  lampYellow.position.set(SLAB_W / 2 + CELL * 0.18, lampY, 0.02);
  slabRoot.add(lampRed, lampYellow);

  // -- "YOU" identity marker --------------------------------------------------
  // A persistent at-a-glance cue of WHICH side the LOCAL player is, independent
  // of whose turn it is. A bright cyan halo rings the local player's own lamp
  // (host → the red lamp, guest → the yellow lamp). Spectators have no side, so
  // it stays hidden. Because host and guest derive `myColor` from their OWN role
  // (never from the wire), host sees the ring on red and guest sees it on yellow —
  // opposite, consistent identities. It rides slabRoot so it follows the facing
  // compensation and reads from either chair.
  const youRingGeo = keep(new THREE.TorusGeometry(CELL * 0.24, CELL * 0.04, 10, 24));
  const matYouRing = keep(
    new THREE.MeshStandardMaterial({ color: "#7fd1ff", roughness: 0.4, metalness: 0.0, emissive: "#7fd1ff", emissiveIntensity: 1.0 })
  );
  const youRing = mesh(youRingGeo, matYouRing, false);
  youRing.visible = false;
  slabRoot.add(youRing);
  // Point the local player at their own lamp. Hidden for spectators.
  function refreshYouMarker() {
    if (myColor === "red") {
      youRing.position.copy(lampRed.position);
      youRing.position.z += 0.005;
      youRing.visible = true;
    } else if (myColor === "yellow") {
      youRing.position.copy(lampYellow.position);
      youRing.position.z += 0.005;
      youRing.visible = true;
    } else {
      youRing.visible = false;
    }
  }
  refreshYouMarker();

  // ============================================================================
  // DYNAMIC LAYERS
  //   discRoot  — settled + falling discs (the projection of `board`)
  //   fxRoot    — hover preview (loader chute + ghost + accent rim) and win halo
  // ============================================================================
  // Parent the dynamic layers under slabRoot so they inherit the same facing
  // compensation as the sockets/faceplate — discs, hover loader, accent rim and
  // win halo all stay registered with their holes from every seat.
  const discRoot = new THREE.Group();
  const fxRoot = new THREE.Group();
  slabRoot.add(discRoot, fxRoot);

  // Per-cell registry: the live disc mesh occupying board[r][c], or null.
  const discs = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  // Active physics bodies (falling/bouncing discs) integrated by the clock.
  const bodies = []; // { mesh, r, c, color, y, vy, restY, settled, squash, resolveOnRest }

  // ---- HOVER PREVIEW (the launcher loader) ----------------------------------
  // A small tilted chute riding the rail + a translucent ghost disc cocked in
  // it, plus a glowing accent rim ringing the lowest open socket of the column.
  const loader = new THREE.Group();
  const chuteGeo = keep(new THREE.BoxGeometry(CELL * 0.7, CELL * 0.5, 0.02));
  const chute = mesh(chuteGeo, matRail, false);
  chute.rotation.x = -0.35;
  chute.position.y = CELL * 0.55;
  loader.add(chute);
  const ghost = mesh(discGeo, matGhostRed, false);
  ghost.position.set(0, CELL * 0.55, 0.01);
  loader.add(ghost);
  loader.visible = false;
  fxRoot.add(loader);

  // Accent rim ring (cyan) ringing the next-to-fill socket.
  const rimGeo = keep(new THREE.RingGeometry(SOCKET_R * 0.9, SOCKET_R * 1.12, 28));
  const rim = mesh(rimGeo, matAccent, false);
  rim.visible = false;
  rim.position.z = SLAB_T / 2 + 0.004;
  fxRoot.add(rim);

  let hoverCol = -1; // currently previewed column, or -1

  // ---- WIN HALO -------------------------------------------------------------
  const haloGeo = keep(new THREE.TorusGeometry(DISC_R * 1.25, DISC_R * 0.12, 10, 28));
  const halo = mesh(haloGeo, matHalo, false);
  halo.visible = false;
  fxRoot.add(halo);

  // ============================================================================
  // SELF-DRIVEN CLOCK — runs only while something animates, then parks.
  // ============================================================================
  let rafId = 0;
  let lastT = 0;
  let lampPulse = false; // heartbeat the winner's lamp at game over
  let lampPhase = 0;

  function needsAnim() {
    return bodies.length > 0 || winAnim.active || lampPulse;
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
    if (dt > 0.05) dt = 0.05; // clamp big frame gaps (tab refocus) so physics stays sane

    stepBodies(dt);
    stepWinAnim(dt);
    stepLamps(dt);

    if (needsAnim()) rafId = requestAnimationFrame(tick);
  }

  // ---- physics integration for falling/bouncing discs -----------------------
  function stepBodies(dt) {
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      b.vy += GRAVITY * dt;
      b.y += b.vy * dt;

      if (b.y <= b.restY) {
        b.y = b.restY;
        const speed = Math.abs(b.vy);
        if (speed < REST_EPS) {
          // come to rest: snap, give a tiny settle squash, retire the body.
          b.vy = 0;
          b.squash = 0.5; // brief final settle pop
          b.settled = true;
        } else {
          b.vy = speed * RESTITUTION; // bounce up
          b.squash = Math.min(1, speed * 0.6); // impact squash ∝ speed
        }
      }

      b.mesh.position.y = b.y;

      // squash-and-stretch: decays each frame; conserves volume (radial swell
      // when vertically compressed).
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
        // when a body settles, resolve win/draw for the move that triggered it
        // (so any celebration starts only after the disc has landed).
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
      // sweep the halo from the first winning disc to the last.
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
        SLAB_T / 2 + DISC_T
      );
    } else {
      // park ringing the middle disc, pulsing.
      const [rm, cm] = winLine[Math.floor(n / 2)];
      halo.position.set(cellX(cm), cellY(rm), SLAB_T / 2 + DISC_T);
      halo.scale.setScalar(1 + 0.12 * Math.sin(winAnim.t * 6));
    }
    // ease the winning discs forward out of the slab.
    const lift = Math.min(1, winAnim.t / 0.5) * (DISC_T * 1.2);
    for (const [r, c] of winLine) {
      const d = discs[r][c];
      if (d) d.position.z = lift;
    }
  }

  // ---- lamp heartbeat at game over ------------------------------------------
  function stepLamps(dt) {
    if (!lampPulse) return;
    lampPhase += dt;
    const winMat = winner === "red" ? matLampRed : winner === "yellow" ? matLampYellow : null;
    if (winMat) winMat.emissiveIntensity = 0.6 + 0.6 * (0.5 + 0.5 * Math.sin(lampPhase * 3));
  }

  // ============================================================================
  // RENDERING / PROJECTION — the scene is a pure function of `board`.
  // ============================================================================

  // Build (or reuse) the settled disc mesh for a filled cell. Used by paint()
  // and by the catch-up snapshot rebuild — never animated, instantly in place.
  function placeStaticDisc(r, c, color) {
    let d = discs[r][c];
    if (!d) {
      d = mesh(discGeo, color === "red" ? matRed : matYellow);
      discRoot.add(d);
      discs[r][c] = d;
    }
    d.material = color === "red" ? matRed : matYellow;
    d.position.set(cellX(c), cellY(r), 0);
    d.scale.set(1, 1, 1);
    return d;
  }

  // Remove every rendered disc + fx (idempotent rebuild primitive).
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

  // Repaint the WHOLE scene from `board` with no animation. The idempotent
  // projector that applyState() and reset rely on.
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
  //   The ONLY function that writes board/turn/phase. Returns the landing row,
  //   or -1 if the column was full / out of bounds. When `animate` is true a
  //   physics body is spawned and win/draw resolution is deferred to its rest;
  //   otherwise the disc snaps and resolution happens immediately.
  // ============================================================================
  function commit(col, color, animate) {
    if (!isLegalCol(col) || phase !== "play") return -1;
    const r = dropRow(board, col);
    if (r < 0) return -1; // full column: silently ignored
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

  // Spawn a physics body that falls from the slot mouth into (r,c).
  function spawnFalling(r, c, color) {
    const d = mesh(discGeo, color === "red" ? matRed : matYellow);
    d.position.set(cellX(c), MOUTH_Y, 0);
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

  // Win/draw resolution + turn flip. Called once the relevant disc is in place
  // (immediately for static, on-rest for animated). WIN is checked before DRAW.
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

  // Kick off the win celebration (sweep + lift + highlight). `instant` skips the
  // sweep timeline (used by snapshot rebuild of an already-decided game).
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
      halo.position.set(cellX(cm), cellY(rm), SLAB_T / 2 + DISC_T);
      for (const [r, c] of winLine) {
        const d = discs[r][c];
        if (d) d.position.z = DISC_T * 1.2;
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
    lampPulse = !!winner; // heartbeat the winner's lamp
    if (lampPulse) ensureClock();
    try {
      reportOver({ winner: winner || null, reason: winner ? "four" : "draw" });
    } catch {
      /* framework callback must never break the module */
    }
  }

  // ============================================================================
  // TURN HUD — twin ready lamps.
  // ============================================================================
  function refreshLamps() {
    if (phase === "over") {
      // both dim at game over; the winner's lamp heartbeat (if any) is driven by
      // stepLamps so we don't fight it here.
      if (!lampPulse) {
        setLamp(matLampRed, "#e23b4e", false);
        setLamp(matLampYellow, "#f2c14e", false);
      }
      return;
    }
    setLamp(matLampRed, "#e23b4e", turn === "red");
    setLamp(matLampYellow, "#f2c14e", turn === "yellow");
  }
  function setLamp(mat, color, lit) {
    mat.color.set(lit ? color : "#2a2f3a");
    mat.emissive.set(lit ? color : "#000000");
    mat.emissiveIntensity = lit ? 0.9 : 0;
  }

  // ============================================================================
  // HOVER PREVIEW — the launcher loader + accent rim. Only shown when it's our
  // turn and the column can actually accept a disc (legal-move affordance).
  // ============================================================================
  function setHover(col) {
    if (!canPlayLocally() || !isLegalCol(col) || dropRow(board, col) < 0) {
      clearHover();
      return;
    }
    if (col === hoverCol) return;
    hoverCol = col;

    ghost.material = myColor === "yellow" ? matGhostYellow : matGhostRed;
    loader.position.x = cellX(col);
    loader.position.y = cellY(0) + CELL * 0.45;
    loader.visible = true;

    const r = dropRow(board, col);
    rim.position.set(cellX(col), cellY(r), SLAB_T / 2 + 0.004);
    rim.visible = true;
  }
  function clearHover() {
    hoverCol = -1;
    loader.visible = false;
    rim.visible = false;
  }

  // True iff the local player may currently drop in their own colour: framework
  // says input is allowed AND it's our colour's turn AND we're not a spectator.
  function canPlayLocally() {
    return phase === "play" && myColor != null && turn === myColor && isAllowed();
  }

  // ============================================================================
  // SNAPSHOT (publicState / applyState payloads)
  //   Full-info game ⇒ public === full. The snapshot is the entire authoritative
  //   position; applyState rebuilds the scene from scratch (idempotent).
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

  // Host pushes the authoritative snapshot after every local commit so a late
  // guest / spectator / desync-recovery can be re-seeded by the server cache.
  function pushState() {
    if (role !== "host") return;
    const snap = snapshot();
    try {
      net.sendState?.(snap, snap); // full-info ⇒ pub === full
    } catch {
      /* transport hiccup: the next move re-pushes */
    }
  }

  // ============================================================================
  // CONTRACT METHODS
  // ============================================================================

  // Render an AUTHORITATIVE FULL snapshot. Idempotent: rebuilds from scratch.
  // state === null/empty ⇒ fresh game (the framework's reset path passes null).
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
    // Defensive parse — never trust a payload to be well-formed.
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
      // fall back to the transmitted line if lastDrop reconstruction missed.
      const wl = state.win.filter((p) => Array.isArray(p) && p.length === 2).map(([r, c]) => [r, c]);
      winLine = wl.length ? wl : null;
    }
    lastDrop = state.lastDrop && Number.isInteger(state.lastDrop.r) ? { r: state.lastDrop.r, c: state.lastDrop.c } : null;

    paint();
    if (phase === "over") announceOver();
  }

  // Apply+animate ONE relayed opponent/host move {type:"drop", col}. Validate
  // against local rules; on mismatch return false / throw GameDesync so the
  // framework can request an authoritative resync rather than trust a bad delta.
  function applyMove(move, byRole) {
    if (!move || move.type !== "drop") return false;
    const col = move.col;
    // Port the 2D guard: only an in-grid integer column is honoured.
    if (!isLegalCol(col)) throw new GameDesync("connect4: out-of-grid column");
    if (phase !== "play") throw new GameDesync("connect4: move after game over");
    if (dropRow(board, col) < 0) throw new GameDesync("connect4: drop into full column");
    // The relayed move is by the side whose turn it currently is (the 2D engine
    // advances turn off the local `turn` as the placing colour). If byRole tells
    // us who moved and it disagrees with whose turn it is, that's a desync.
    const movedColor = byRole ? colorForRole(byRole) : turn;
    if (movedColor && movedColor !== turn) throw new GameDesync("connect4: out-of-turn relayed move");
    commit(col, turn, /*animate*/ true);
    return true;
  }

  // The framework already resolved a board cell from the raycast hit. For
  // Connect 4 only the COLUMN matters (gravity derives the row). If it's our
  // turn and the column is legal, animate locally, mutate, broadcast the column,
  // and (host) push the authoritative snapshot.
  function onPointer(hit) {
    if (!hit || !hit.cell) return;
    if (!canPlayLocally()) return;
    const col = hit.cell.c;
    if (!isLegalCol(col)) return;
    if (dropRow(board, col) < 0) return; // full column: ignore

    const color = turn; // === myColor by canPlayLocally()
    clearHover();
    const r = commit(col, color, /*animate*/ true);
    if (r < 0) return;

    // Wire carries ONLY the column (matching the 2D contract); the peer derives
    // the landing row from shared gravity.
    try {
      net.sendMove?.({ type: "drop", col });
    } catch {
      /* transport hiccup: snapshot push below still re-seeds authority */
    }
    pushState();
  }

  // Module-side raycast→cell resolver (the framework prefers this over its
  // generic 8×8 mapper). We map the hit's LOCAL x onto a column; the row is
  // irrelevant to a Connect 4 move but we return the lowest open row for
  // completeness. worldToLocal undoes the table transform + per-viewer rotation,
  // so every seat resolves the same canonical column.
  function hitToCell(hit) {
    if (!hit || !hit.point) return null;
    // Resolve in slabRoot-local space: it undoes the table transform, the
    // framework's per-viewer group rotation AND our facing compensation, so the
    // visible column the user clicked maps to the same canonical column on every
    // seat (the faceplate now always faces the local viewer).
    const local = slabRoot.worldToLocal(hit.point.clone());
    const u = (local.x - GRID_LEFT) / GRID_W; // 0..1 across columns
    if (u < 0 || u >= 1) return null;
    const c = Math.min(COLS - 1, Math.max(0, Math.floor(u * COLS)));
    const r = dropRow(board, c);
    return { r: r < 0 ? 0 : r, c };
  }

  // OPTIONAL but provided: full-info ⇒ public state IS the full snapshot. The
  // framework falls back to full state if absent; returning it keeps spectators
  // in exact sync.
  function publicState() {
    return snapshot();
  }

  // Role changed (spectator → host/guest on sitting, or re-seat). Re-derive our
  // colour and re-gate the hover affordance.
  function setRole(nextRole) {
    role = nextRole || "spectator";
    myColor = colorForRole(role);
    refreshYouMarker();
    if (!canPlayLocally()) clearHover();
  }

  // Viewer re-seated. The framework re-applies group.rotation.y itself; we record
  // the seat, re-apply the faceplate facing compensation (so the readable face
  // still points at the new seat), and drop any stale hover.
  function setSeatRy(ry) {
    seatRy = ry ?? null;
    applyFacing();
    clearHover();
  }

  // Free every geometry + material we minted and drop the group from the table.
  function dispose() {
    if (rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    bodies.length = 0;
    clearScene(); // detach disc meshes from the graph (shared geo/mats freed below)
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
  // Newcomers/guests/spectators get a real snapshot via applyState shortly after
  // mount; until then we render the (empty) default board so the cabinet is
  // visible in-world before anyone sits.
  paint();

  return {
    group,
    // Upright cabinet: we orient the faceplate toward the local seat OURSELVES
    // (applyFacing → slabRoot.rotation.y = orientFor(seatRy)). Tell the framework
    // NOT to also rotate the group, or the two rotations fight and the cabinet's
    // back faces the opposite-seated player.
    orientPolicy: "self",
    applyState,
    applyMove,
    onPointer,
    hitToCell,
    publicState,
    setRole,
    setSeatRy,
    dispose,
    // expose a hover hook the framework MAY call on pointer-move (optional; the
    // current pointer path only calls onPointer on click, but exposing setHover
    // keeps the affordance wireable without a contract change).
    setHover,
  };
}

export default createGame;
