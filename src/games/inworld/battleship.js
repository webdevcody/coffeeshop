// Battleship — in-world 3D table game module (createGame contract).
//
// CANDIDATE VARIATION #0 — "labelled control pillars, hover crosshair reticle,
// canvas fleet-panel placards."
//
// A COMPLETE, self-contained ES module implementing createGame(ctx) → GameInstance
// per ./createGame.js. The framework (board.js → InWorldBoard) owns the café table,
// the per-room `net` relay, role/turn gating and spectator read-only mode. THIS
// module owns the rules, the 3D geometry (meshes parented to the table group) and
// per-cell hit-testing.
//
// WHAT THIS VARIATION DOES DIFFERENTLY (distinct UX/impl from sibling candidates,
// while satisfying the identical contract):
//
//   (A) The original DOM iframe's controls read as labelled buttons ("Rotate",
//       "Randomize", "Clear", "Ready ▸"). Here each in-world control is a raised
//       PILLAR whose top face carries a canvas-textured LABEL, so the player sees
//       the same words on the table — not a blank coloured box. Ready is greyed
//       (disabled tint + "Ready ▸" → kept dim) until all 5 ships are placed, exactly
//       as the original gates its READY control.
//
//   (B) Instead of bobbing target rings on every un-fired enemy cell, this variation
//       uses a single HOVER CROSSHAIR RETICLE that follows the pointer over enemy
//       waters via the framework's setHover() routing — closer to the original's
//       "aimed cell" affordance ("Pick a target on enemy waters"). The reticle turns
//       red/locked over already-fired cells. A faint live tint still marks the whole
//       enemy grid as "active" on your turn.
//
//   (C) The fleet-status panels are CANVAS PLACARDS (one per side) drawn to mimic the
//       original's .fleet-panel / .ship-row / .pips look: each of the 5 ships listed
//       by name with live/sunk pips, the row struck through + dimmed when SUNK. The
//       spectator sees both panels; a seated player sees the enemy panel (ships they
//       must sink) prominently and their own losses.
//
// Everything else follows the spec's exact flow + the createGame contract:
// orientPolicy:"self" self-orientation (each seat's own −Z ocean nearest), hidden-
// info safety (only shots/results on the wire, layout revealed cosmetically post-
// game), public-only snapshots for spectators, strict single-shot alternation,
// host-only start, turn derived purely from public shot counts on resync.
//
// CANONICAL CONVENTION (createGame.js): row 0 / y 0 is the −Z edge = NEAREST the
// local seat after orientation. YOUR OCEAN sits at −Z (near); ENEMY WATERS at +Z
// (far). You place ships in front of you and fire across the table.
//
// WIRE FORMAT (only shot coordinates + outcomes ever leave the device):
//   { type:"place",  ready:true }                                  // I placed all ships
//   { type:"start",  first:"host"|"guest" }                        // host-only, once both ready
//   { type:"fire",   x, y }                                        // a shot at enemy cell (x,y)
//   { type:"result", x, y, outcome:"miss"|"hit"|"sunk", sunk? }    // defender's reply
//
// FLEET REVEAL travels on its OWN channel (ctx.net.sendReveal → applyReveal), NOT a
// public move: { side, fleet } is published from doReady() the moment a seat deploys
// and the server forwards it ONLY to spectators (never the opponent). No layout is
// ever relayed on the public move stream.
//
// PUBLIC SNAPSHOT (publicState / applyState — spectator + opponent safe):
//   { phase, turn, first, winner, ready:{host,guest},
//     shots:{ host:[{x,y,outcome,sunk?}...], guest:[...] },
//     sunk:{ host:[shipId...], guest:[shipId...] } }
//   No occupancy, no hull, no placement anywhere — by design.

import { GameDesync, orientFor } from "./createGame.js";
import { buildWarship, shipHullColor } from "./warship.js";
import { FX } from "./fx.js";
import { MissileSystem } from "./missile.js";

// ===========================================================================
// PURE RULES — transport-free, self-contained.
// 10×10 grid, classic 5-ship fleet (17 cells), allowTouching = true.
// ===========================================================================
export const GRID = 10;
export const FLEET = [
  { id: "carrier", name: "Carrier", length: 5 },
  { id: "battleship", name: "Battleship", length: 4 },
  { id: "cruiser", name: "Cruiser", length: 3 },
  { id: "submarine", name: "Submarine", length: 3 },
  { id: "destroyer", name: "Destroyer", length: 2 },
];
export const FLEET_CELLS = 17;
const SHIP_BY_ID = new Map(FLEET.map((s) => [s.id, s]));
const SHIP_IDS = new Set(FLEET.map((s) => s.id));

export const inGrid = (x, y) => x >= 0 && x < GRID && y >= 0 && y < GRID;
const idx = (x, y) => y * GRID + x;

export function shipCells(ship) {
  const out = [];
  const spec = SHIP_BY_ID.get(ship.id);
  const len = spec ? spec.length : ship.length;
  for (let n = 0; n < len; n++) {
    out.push(
      ship.orientation === "vertical"
        ? { x: ship.x, y: ship.y + n }
        : { x: ship.x + n, y: ship.y }
    );
  }
  return out;
}

export function occupancyOf(placements) {
  const occ = new Array(GRID * GRID).fill(null);
  for (const ship of placements) {
    for (const cell of shipCells(ship)) {
      if (inGrid(cell.x, cell.y)) occ[idx(cell.x, cell.y)] = ship.id;
    }
  }
  return occ;
}

// canPlace — reject a duplicate id, any off-grid cell, or overlap. allowTouching
// is true, so adjacency is NOT checked.
export function canPlace(placements, ship) {
  if (placements.some((p) => p.id === ship.id)) return false;
  const occ = occupancyOf(placements);
  for (const cell of shipCells(ship)) {
    if (!inGrid(cell.x, cell.y)) return false;
    if (occ[idx(cell.x, cell.y)] != null) return false;
  }
  return true;
}

export const isComplete = (placements) => placements.length === FLEET.length;

export function randomFleet(rng = Math.random) {
  const placements = [];
  for (const spec of FLEET) {
    let placed = false;
    for (let attempt = 0; attempt < 1000 && !placed; attempt++) {
      const orientation = rng() < 0.5 ? "horizontal" : "vertical";
      const maxX = orientation === "horizontal" ? GRID - spec.length : GRID - 1;
      const maxY = orientation === "vertical" ? GRID - spec.length : GRID - 1;
      const x = Math.floor(rng() * (maxX + 1));
      const y = Math.floor(rng() * (maxY + 1));
      const ship = { id: spec.id, name: spec.name, length: spec.length, x, y, orientation };
      if (canPlace(placements, ship)) {
        placements.push(ship);
        placed = true;
      }
    }
    if (!placed) return null;
  }
  return placements;
}

// receiveFire — the DEFENDER resolves a shot against its OWN private grid. The
// ONLY function that reads ship positions; runs only on the owning client.
export function receiveFire(state, x, y) {
  if (!inGrid(x, y)) return null;
  const i = idx(x, y);
  if (state.firedAt[i]) return null; // already fired here
  state.firedAt[i] = true;
  const shipId = state.occ[i];
  if (shipId == null) return { outcome: "miss", allSunk: false };
  state.hitCount[shipId] = (state.hitCount[shipId] || 0) + 1;
  const spec = SHIP_BY_ID.get(shipId);
  if (state.hitCount[shipId] >= spec.length) {
    const allSunk = FLEET.every((s) => (state.hitCount[s.id] || 0) >= s.length);
    return { outcome: "sunk", sunk: shipId, allSunk };
  }
  return { outcome: "hit", allSunk: false };
}

export function validResult(msg) {
  if (!msg || !inGrid(msg.x, msg.y)) return false;
  if (msg.outcome !== "miss" && msg.outcome !== "hit" && msg.outcome !== "sunk") return false;
  if (msg.outcome === "sunk" && !SHIP_IDS.has(msg.sunk)) return false;
  if (msg.outcome !== "sunk" && msg.sunk != null) return false;
  return true;
}

export function validLayout(layout) {
  if (!Array.isArray(layout) || layout.length !== FLEET.length) return false;
  const acc = [];
  for (const spec of FLEET) {
    const ship = layout.find((s) => s && s.id === spec.id);
    if (!ship) return false;
    if (ship.orientation !== "horizontal" && ship.orientation !== "vertical") return false;
    const norm = { id: spec.id, name: spec.name, length: spec.length, x: ship.x, y: ship.y, orientation: ship.orientation };
    if (!canPlace(acc, norm)) return false;
    acc.push(norm);
  }
  return true;
}

// ===========================================================================
// GEOMETRY CONSTANTS (metres, in the board group's local XZ plane).
// YOUR OCEAN at −Z (near); ENEMY WATERS at +Z (far). col → X, row(=y) → Z.
// ===========================================================================
const PLAY = 0.66;
const CELL = PLAY / GRID;
const HALF = PLAY / 2;

const GRID_GAP = CELL * 1.1;
const GRID_SPAN = CELL * GRID;
const OCEAN_CZ = -(GRID_SPAN + GRID_GAP) / 2;
const ENEMY_CZ = (GRID_SPAN + GRID_GAP) / 2;

const BASE_T = 0.012;
const TILE_T = 0.004;
const SURF_Y = BASE_T;
const PEG_Y = SURF_Y + 0.006;

const HULL_H = CELL * 0.5;
const HULL_Y = SURF_Y + HULL_H / 2;

// The two grids reach local ±0.696 in Z, but the chairs sit at only ±0.85 from the
// table centre — leaving ~0.15 of clearance, so the OPPONENT across the table leans
// their torso right over the far grid's edge (the "belly overlapping the board"
// report). Shrink the whole board so its far edge pulls in to ~±0.54, clearing the
// seated avatar's torso. Everything (grids, colliders, ships, FX) is a child of the
// group, so the scale is uniform and the world-space raycast / camera framing follow
// automatically. The seated camera already pulls back (SEATED_CAM_ZOOM) so the
// smaller board still reads large on screen.
const BOARD_SCALE = 0.78;

// ===========================================================================
// THE MODULE
// ===========================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "battleship";
  group.scale.setScalar(BOARD_SCALE); // pull the board in so opponents don't lean over it

  let role = ctx.role;
  let seatRy = ctx.seatRy;
  let mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
  let oppSide = mySide === "host" ? "guest" : mySide === "guest" ? "host" : null;

  // optional DOM-HUD hook (never required — we always render an in-world HUD too)
  const hudHook = typeof ctx.onHud === "function" ? ctx.onHud : null;
  // When present, the host app renders the placement controls (Rotate/Randomize/
  // Clear/Ready) as a screen-space DOM bar instead of 3D pillars on the board — so
  // they never overlap the ships/grid or interrupt placing.
  const controlsHook = typeof ctx.onControls === "function" ? ctx.onControls : null;
  // Same idea for the two fleet-status panels — render them as DOM so the table
  // pedestal / 3D bodies can't clip them.
  const fleetHook = typeof ctx.onFleet === "function" ? ctx.onFleet : null;

  // ── Phase / turn state ──────────────────────────────────────────────────
  let phase = "placement"; // "placement" | "playing" | "over"
  let myTurn = false;
  let first = null; // "host" | "guest"
  let winner = null;
  const ready = { host: false, guest: false };

  // ── PRIVATE: my own fleet (never serialized except in the post-game reveal) ──
  let myPlacements = [];
  let myOcean = freshOceanState();

  // ── SPECTATOR-ONLY: both fleets, revealed by the seated players over the
  // spectator-only reveal channel (server forwards each seat's own fleet to
  // WATCHERS, never to the opponent). A seated player NEVER fills these — they stay
  // empty in a player's own view, so the game stays fair. A spectator renders the
  // host fleet on its OCEAN grid (−Z, where the guest fires) and the guest fleet on
  // its ENEMY grid (+Z, where the host fires) — the same grids the shot streams use
  // in applyState's spectator branch, so ships and shots line up.
  const revealFleets = { host: null, guest: null }; // [{id,x,y,orientation}...] | null
  const revealHullMeshes = [];
  function freshOceanState() {
    return { occ: new Array(GRID * GRID).fill(null), firedAt: new Array(GRID * GRID).fill(false), hitCount: {} };
  }

  // ── PUBLIC: the two shot grids ──────────────────────────────────────────
  const shots = { host: [], guest: [] };
  const tracking = { host: new Map(), guest: new Map() };
  const sunkBy = { host: new Set(), guest: new Set() };
  let pendingFire = null; // shot I sent and await a result for
  // Cosmetic impact params handed from the (immediate) state resolution to the
  // decorative missile's onArrive, so the blast lines up with the projectile
  // landing WITHOUT the state/turn handback waiting on the animation (B1).
  let incomingImpact = null;
  // SPECTATOR-ONLY (I7): the set of "side:x,y" shot keys we've already rendered, so
  // applyState can diff a fresh snapshot and play a one-shot impact ONLY for a
  // single newly-added shot per side (a late-joiner catch-up adds many at once and
  // is skipped, avoiding a fireworks dump).
  let specShotKeys = new Set();

  // ── Placement-phase interaction state ───────────────────────────────────
  let placeIndex = 0;
  let ghostOrient = "horizontal";
  let hoverCell = null; // last placement cell (ocean) under pointer
  let aimCol = -1; // hover col over enemy waters (from setHover routing)
  let aimRow = -1; // hover row over enemy waters (resolved on hover raycast)

  // ===========================================================================
  // Materials + geometries (created once; freed in dispose()).
  // HOST = steel blue, GUEST = amber. Local hulls + ocean trim use side colour.
  // ===========================================================================
  const SIDE_COLOR = { host: "#3f7fd6", guest: "#e0962f" };
  const myHullColor = mySide ? SIDE_COLOR[mySide] : "#5a636b";

  const M = {
    base: new THREE.MeshStandardMaterial({ color: "#15314f", roughness: 0.85, metalness: 0.05 }),
    frameOcean: new THREE.MeshStandardMaterial({ color: mySide ? SIDE_COLOR[mySide] : "#3f7fd6", roughness: 0.5, metalness: 0.3, emissive: "#06121e", emissiveIntensity: 0.4 }),
    frameEnemy: new THREE.MeshStandardMaterial({ color: "#7a2230", roughness: 0.6, metalness: 0.25, emissive: "#1c0408", emissiveIntensity: 0.35 }),
    oceanA: new THREE.MeshStandardMaterial({ color: "#1f5d86", roughness: 0.55, metalness: 0.1 }),
    oceanB: new THREE.MeshStandardMaterial({ color: "#23688f", roughness: 0.55, metalness: 0.1 }),
    enemyA: new THREE.MeshStandardMaterial({ color: "#143241", roughness: 0.6, metalness: 0.1 }),
    enemyB: new THREE.MeshStandardMaterial({ color: "#173b4f", roughness: 0.6, metalness: 0.1 }),
    hull: new THREE.MeshStandardMaterial({ color: myHullColor, roughness: 0.5, metalness: 0.55 }),
    hullDeck: new THREE.MeshStandardMaterial({ color: "#2c3238", roughness: 0.6, metalness: 0.45 }),
    miss: new THREE.MeshStandardMaterial({ color: "#eef3f6", roughness: 0.5, metalness: 0.05 }),
    hit: new THREE.MeshStandardMaterial({ color: "#d8442c", roughness: 0.45, metalness: 0.1, emissive: "#5a1206", emissiveIntensity: 0.5 }),
    sunkMark: new THREE.MeshStandardMaterial({ color: "#8a1c0c", roughness: 0.5, metalness: 0.2, emissive: "#3a0a02", emissiveIntensity: 0.6 }),
    shell: new THREE.MeshStandardMaterial({ color: "#f0d28a", roughness: 0.4, metalness: 0.3, emissive: "#3a2a00", emissiveIntensity: 0.3 }),
    ghostOk: new THREE.MeshStandardMaterial({ color: "#4fd18a", roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.55, depthWrite: false }),
    ghostBad: new THREE.MeshStandardMaterial({ color: "#e2503c", roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.5, depthWrite: false }),
    enemyLive: new THREE.MeshBasicMaterial({ color: "#7fd1ff", transparent: true, opacity: 0.16, depthWrite: false }),
    // ONE shared, animated ring material for ALL un-fired target rings (I6) — its
    // opacity is bobbed once per frame in stepAnim, replacing the per-cell clone +
    // dispose churn (up to ~100 material allocs/disposals per turn flip).
    targetShared: new THREE.MeshBasicMaterial({ color: "#7fd1ff", transparent: true, opacity: 0.8, depthWrite: false }),
    reticleOk: new THREE.MeshBasicMaterial({ color: "#7fffb0", transparent: true, opacity: 0.95, depthWrite: false }),
    reticleBad: new THREE.MeshBasicMaterial({ color: "#ff6a5a", transparent: true, opacity: 0.95, depthWrite: false }),
    splash: new THREE.MeshBasicMaterial({ color: "#eef6ff", transparent: true, opacity: 0.9, depthWrite: false }),
    ember: new THREE.MeshBasicMaterial({ color: "#ff6a3c", transparent: true, opacity: 0.95, depthWrite: false }),
    // Shared "most recent shot" halo (P2 #6). One per side reuses this single
    // material; its opacity is driven per-frame in stepLastShot (no per-cell alloc).
    lastShot: new THREE.MeshBasicMaterial({ color: "#ffe27a", transparent: true, opacity: 0.0, depthWrite: false }),
    pillarIdle: new THREE.MeshStandardMaterial({ color: "#27506f", roughness: 0.5, metalness: 0.2, emissive: "#0a1c2a", emissiveIntensity: 0.4 }),
    pillarGo: new THREE.MeshStandardMaterial({ color: "#2f8a5a", roughness: 0.45, metalness: 0.2, emissive: "#0c3320", emissiveIntensity: 0.6 }),
    pillarDim: new THREE.MeshStandardMaterial({ color: "#39444c", roughness: 0.7, metalness: 0.1, emissive: "#0a0e12", emissiveIntensity: 0.2 }),
    invisible: new THREE.MeshBasicMaterial({ visible: false }),
  };

  const G = {
    tile: new THREE.BoxGeometry(CELL * 0.96, TILE_T, CELL * 0.96),
    hit: new THREE.BoxGeometry(CELL * 0.98, HULL_H * 1.4, CELL * 0.98),
    peg: new THREE.CylinderGeometry(CELL * 0.18, CELL * 0.18, 0.018, 12),
    emberPeg: new THREE.SphereGeometry(CELL * 0.2, 12, 10),
    shell: new THREE.SphereGeometry(CELL * 0.12, 10, 8),
    ring: new THREE.TorusGeometry(CELL * 0.34, CELL * 0.05, 8, 22),
    pillar: new THREE.BoxGeometry(CELL * 1.4, CELL * 0.5, CELL * 0.95),
  };

  function cellX(x) { return -HALF + (x + 0.5) * CELL; }
  function cellZ(y, which) {
    const cz = which === "ocean" ? OCEAN_CZ : ENEMY_CZ;
    return cz - GRID_SPAN / 2 + (y + 0.5) * CELL;
  }

  // FIRING-ORIENTATION CANON (Task 1). Each seat self-orients (orientFor(seatRy))
  // so its OWN ocean (−Z) meets it and the enemy grid (+Z) sits across. Both grids
  // address cells with the SAME canonical (x,y) AND the SAME cellZ row direction,
  // so for EVERY seat pair (verified by tracing all four chairs) a defender's
  // perception of their ocean (x,y) lines up with an attacker's perception of the
  // enemy (x,y) at the same (row-from-near, col-from-left): the attacker firing the
  // cell in FRONT of them on the enemy grid hits the cell in FRONT of the defender
  // on their ocean, and a player's own ocean + enemy grids share one orientation
  // (just like a real Battleship board + target grid). The render path therefore
  // stays the canonical cellZ — a row flip would have INVERTED this correct
  // mapping (making the attacker's front hit the defender's back, i.e. the very
  // "front of P1 = back of P2" symptom). cellZView is the single render-row choke
  // point, today the identity, so any future per-grid remap lives in one place
  // without touching cellZ / the cell math.
  function cellZView(y, which) { return cellZ(y, which); }

  // ── Live scene bookkeeping ──────────────────────────────────────────────
  const hullMeshes = [];
  const oceanShotMarks = new Map(); // enemy shots landing on MY ocean
  const enemyShotMarks = new Map(); // MY shots on enemy waters
  let ghostMesh = null;
  const placeButtons = []; // { mesh, btn, label, tex, cv }
  let enemyLivePlate = null;
  let reticle = null;
  let laneMesh = null;
  const targetRings = []; // bobbing rings on un-fired enemy cells (my turn)

  // Last-shot indicator (P2 #6): the most-recent shot per side, plus one reusable
  // halo mesh per side (lazily built, own material so the two fade independently).
  // born = nowMs() of the shot; the halo bobs + fades over LAST_SHOT_MS then hides.
  const lastShot = { host: null, guest: null }; // { x, y, which, born } | null
  const lastShotHalos = { host: null, guest: null };
  const LAST_SHOT_MS = 1500;

  // Reticle "locked target" confirm (P2 #10): when the player commits a shot, the
  // crosshair flips red + scale-punches for a beat at the fired cell before clearing,
  // so the launch reads as deliberate. { until } drives a one-shot punch in stepAnim.
  let reticleLock = null; // { until } | null
  const RETICLE_LOCK_MS = 240;

  // Fleet-status placards (canvas-textured planes). Spectator: both. Seated: one
  // for the enemy fleet (what I must sink) and one for my own losses.
  const panels = []; // { mesh, cv, tex, firer }
  // Sink-flourish (I3): when a ship sinks we stamp { firer → { id, until } } and
  // the placard row glows + redraws while the timer runs (purely local cosmetic).
  const panelFlash = { host: null, guest: null };
  const PANEL_FLASH_MS = 900;

  // HUD billboard (canvas-textured plane above the board, faces camera).
  let hudMesh = null;

  // Each client renders with its OWN seatRy; orientFor(seatRy) ALONE brings that
  // seat's near edge (local −Z ocean) to the front. No extra per-role PI.
  function applyFacing() {
    group.rotation.y = orientFor(seatRy);
    // NOTE: do NOT start the loop here — applyFacing runs during init (before the
    // rAF state exists). setSeatRy/setRole call startLoop() after init so the HUD
    // billboard re-counters the new group rotation even when the loop was idle (I9).
  }

  buildStaticBoard();
  buildColliders();
  buildPanels();
  buildHud();
  applyFacing();

  // ===========================================================================
  // Static geometry: base panel + two 10×10 water grids + coloured frame bands +
  // labelled control pillars.
  // ===========================================================================
  function buildStaticBoard() {
    const baseW = PLAY + CELL * 0.5;
    const baseD = GRID_SPAN * 2 + GRID_GAP + CELL * 0.7;
    const base = new THREE.Mesh(new THREE.BoxGeometry(baseW, BASE_T, baseD), M.base);
    base.position.set(0, BASE_T / 2, 0);
    base.receiveShadow = true;
    group.add(base);

    for (const which of ["ocean", "enemy"]) {
      const a = which === "ocean" ? M.oceanA : M.enemyA;
      const b = which === "ocean" ? M.oceanB : M.enemyB;
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const tile = new THREE.Mesh(G.tile, (x + y) % 2 === 0 ? a : b);
          tile.position.set(cellX(x), SURF_Y - TILE_T / 2 + 0.0006, cellZ(y, which));
          tile.receiveShadow = true;
          group.add(tile);
        }
      }
    }

    // Coloured frame band around each grid: your-side colour around your ocean,
    // enemy red around enemy waters — an at-a-glance "this is mine / theirs".
    for (const which of ["ocean", "enemy"]) {
      const cz = which === "ocean" ? OCEAN_CZ : ENEMY_CZ;
      const mat = which === "ocean" ? M.frameOcean : M.frameEnemy;
      const fw = GRID_SPAN + CELL * 0.18;
      const t = CELL * 0.14;
      const h = HULL_H * 0.45;
      const fy = SURF_Y + h / 2 - 0.001;
      const rails = [
        [new THREE.BoxGeometry(fw, h, t), 0, cz - GRID_SPAN / 2 - t / 2],
        [new THREE.BoxGeometry(fw, h, t), 0, cz + GRID_SPAN / 2 + t / 2],
        [new THREE.BoxGeometry(t, h, GRID_SPAN + t * 2), -HALF - t / 2, cz],
        [new THREE.BoxGeometry(t, h, GRID_SPAN + t * 2), HALF + t / 2, cz],
      ];
      for (const [geo, x, z] of rails) {
        const rail = new THREE.Mesh(geo, mat);
        rail.position.set(x, fy, z);
        rail.castShadow = true;
        rail.receiveShadow = true;
        group.add(rail);
      }
    }

    buildPlaceButtons();
  }

  // Labelled control pillars hovering just in front of (slightly −Z of) YOUR
  // ocean's near edge. Each pillar's top face is a canvas-textured label so the
  // player reads the original's words. Anchored to the local −Z ocean: Fix-A
  // self-orientation renders them in front of whichever seat owns that ocean.
  function buildPlaceButtons() {
    if (controlsHook) return; // DOM control bar instead of in-world pillars
    const defs = [
      { btn: "rotate", label: "Rotate", mat: M.pillarIdle },
      { btn: "random", label: "Randomize", mat: M.pillarIdle },
      { btn: "clear", label: "Clear", mat: M.pillarIdle },
      { btn: "ready", label: "Ready ▸", mat: M.pillarGo },
    ];
    const rowZ = OCEAN_CZ - GRID_SPAN / 2 + CELL * 0.55;
    const bx0 = -HALF * 0.72;
    const bxStep = (HALF * 1.44) / 3;
    defs.forEach((d, i) => {
      const m = new THREE.Mesh(G.pillar, d.mat.clone());
      m.position.set(bx0 + i * bxStep, SURF_Y + CELL * 0.4, rowZ);
      m.castShadow = true;
      m.userData.btn = d.btn;
      group.add(m);

      // Canvas label on the top face.
      const lbl = makeLabelMesh(d.label, CELL * 1.34, CELL * 0.9);
      lbl.rotation.x = -Math.PI / 2;
      lbl.position.set(0, CELL * 0.26, 0);
      m.add(lbl);

      placeButtons.push({ mesh: m, btn: d.btn, label: d.label, lblTex: lbl.userData.tex, lblCv: lbl.userData.cv, idleMat: d.mat });
    });
    refreshButtons();
  }

  // A small canvas-textured plane carrying a single line of text.
  function makeLabelMesh(text, w, h) {
    const canCreate = typeof document !== "undefined" && document.createElement;
    const cv = canCreate ? document.createElement("canvas") : null;
    if (cv) { cv.width = 256; cv.height = 128; }
    const tex = cv ? new THREE.CanvasTexture(cv) : null;
    if (tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const mat = tex
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      : new THREE.MeshBasicMaterial({ color: "#dfe9f2", transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.userData.cv = cv;
    mesh.userData.tex = tex;
    mesh.renderOrder = 8;
    drawLabel(cv, tex, text, "#eaf3fb");
    return mesh;
  }

  // Shrink the font until `text` fits `maxW` (no clipping/overflow).
  function fitFont(g, text, maxW, startPx, weight) {
    let px = startPx;
    const w = weight ? weight + " " : "";
    g.font = `${w}${px}px sans-serif`;
    while (px > 12 && g.measureText(text).width > maxW) {
      px -= 2;
      g.font = `${w}${px}px sans-serif`;
    }
  }

  function drawLabel(cv, tex, text, color) {
    if (!cv || !tex) return;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    g.save();
    // The control pillars sit at YOUR ocean's NEAR edge; after the board's per-seat
    // self-orientation their flat top faces read 180° rotated from the seat (the
    // labels showed upside-down). Pre-rotate the canvas 180° so they read upright.
    g.translate(cv.width / 2, cv.height / 2);
    g.rotate(Math.PI);
    g.translate(-cv.width / 2, -cv.height / 2);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    fitFont(g, text, cv.width - 28, 48, "bold");
    g.fillText(text, cv.width / 2, cv.height / 2);
    g.restore();
    tex.needsUpdate = true;
  }

  // Visibility + Ready-disabled tint, matching the original's gated READY control.
  function refreshButtons() {
    const show = phase === "placement" && !!mySide && !ready[mySide];
    // DOM control bar (host-app rendered): hand it the current buttons + state.
    if (controlsHook) {
      const defs = show
        ? [
            { id: "rotate", label: "Rotate" },
            { id: "random", label: "Randomize" },
            { id: "clear", label: "Clear" },
            { id: "ready", label: "Ready ▸", primary: true, enabled: isComplete(myPlacements) },
          ]
        : [];
      try { controlsHook(defs, handleControl); } catch { /* ignore */ }
      return;
    }
    for (const b of placeButtons) {
      b.mesh.visible = show;
      if (b.btn === "ready") {
        const enabled = isComplete(myPlacements);
        b.mesh.material = enabled ? M.pillarGo : M.pillarDim;
        drawLabel(b.lblCv, b.lblTex, enabled ? "Ready ▸" : "Ready ▸", enabled ? "#eafff1" : "#8b97a0");
      }
    }
  }

  // Per-cell invisible colliders over BOTH grids, tagged {r,c,which}. The collider
  // for logical row y sits at the canonical render position (cellZView, today the
  // identity) and carries the canonical userData {r:y,c:x,which}, so a click on the
  // cell the player sees returns the canonical logical (x,y) on EITHER grid (Task 1
  // — the firing coordinate is identical for both seats; see cellZView's note).
  function buildColliders() {
    for (const which of ["ocean", "enemy"]) {
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const box = new THREE.Mesh(G.hit, M.invisible);
          box.position.set(cellX(x), SURF_Y + HULL_H * 0.3, cellZView(y, which));
          box.userData.cell = { r: y, c: x, which };
          group.add(box);
        }
      }
    }
  }

  // ===========================================================================
  // Fleet-status placards — canvas planes mimicking the original .fleet-panel:
  // ship rows by name + live/sunk pips; the row is struck-through + dimmed when
  // the ship is sunk. firer = the side that SANK those ships.
  // ===========================================================================
  // Data for the two fleet status panels (DOM rendering).
  function fleetPanelData(firer) {
    const ownerSide = firer === "host" ? "guest" : "host";
    const isMine = mySide && ownerSide === mySide;
    const accent = firer === "host" ? SIDE_COLOR.host : SIDE_COLOR.guest;
    const title = mySide ? (isMine ? "Your Fleet" : "Enemy Fleet") : (ownerSide === "host" ? "Host Fleet" : "Guest Fleet");
    const sunkSet = sunkBy[firer];
    return {
      title, accent, mine: !!isMine, firer, sunk: sunkSet.size, total: FLEET.length,
      ships: FLEET.map((s) => ({ name: s.name, length: s.length, dead: sunkSet.has(s.id) })),
    };
  }

  function buildPanels() {
    if (fleetHook) { refreshPanels(); return; } // DOM panels instead of 3D placards
    // Two flat placards laid along the LOCAL (−Z, own) near edge, INSIDE the board's
    // footprint — previously they were pinned to the far (+Z) opponent side at
    // ENEMY_CZ + GRID_SPAN/2 + H*0.62 (≈0.884), well past the base panel (z≈0.719),
    // so the whole ~0.30m-deep placard floated over bare tabletop in front of the
    // opponent, and at x=±W*0.62 its outer edge (X≈0.370) overhung HALF=0.330. Now
    // sized to sit two-up within the board width and anchored over the local near
    // edge where the HUD points, so they read as "my readouts" and never overhang or
    // hover past the opponent (P2 #4/#5).
    const W = HALF * 0.94;        // two placards span ≤ 2*HALF (the full board width)
    const H = GRID_SPAN * 0.4;
    // Far edge of the placard tucked just shy of the ocean grid's near rail, so the
    // body lies over the small near base margin + the player's own near rows (their
    // ships render as raised hulls above it, so the flat readout stays legible).
    const panelZ = OCEAN_CZ - GRID_SPAN / 2 + H * 0.42;
    const make = (firer, x) => {
      const canCreate = typeof document !== "undefined" && document.createElement;
      const cv = canCreate ? document.createElement("canvas") : null;
      if (cv) { cv.width = 320; cv.height = 300; }
      const tex = cv ? new THREE.CanvasTexture(cv) : null;
      if (tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      const mat = tex
        ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
        : new THREE.MeshBasicMaterial({ color: "#0c2036", transparent: true, opacity: 0.85, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
      mesh.rotation.x = -Math.PI / 2;
      // Lifted a touch higher than before (was +0.002) and given polygonOffset so the
      // coplanar café tabletop underneath can't z-fight through it (P2 #5).
      mesh.position.set(x, SURF_Y + 0.004, panelZ);
      mesh.renderOrder = 7;
      mesh.userData.cv = cv;
      mesh.userData.tex = tex;
      group.add(mesh);
      panels.push({ mesh, cv, tex, firer });
    };
    if (mySide) {
      // Enemy fleet I must sink (firer = me), plus my losses (firer = opponent).
      make(mySide, -W * 0.52);
      make(oppSide, W * 0.52);
    } else {
      make("host", -W * 0.52);
      make("guest", W * 0.52);
    }
    refreshPanels();
  }

  // firer's pips = ships firer has sunk on the opponent. Title names whose fleet.
  function refreshPanels() {
    if (fleetHook) {
      // DOM panels: hand both fleet-status cards to the host app to render as
      // screen-space DOM so the table pedestal / 3D bodies can never clip them.
      // Order matches the 3D path: [the enemy fleet I'm sinking, my own fleet].
      const firers = mySide ? [mySide, oppSide] : ["host", "guest"];
      try { fleetHook(firers.map((f) => fleetPanelData(f))); } catch { /* transport optional */ }
      return;
    }
    for (const p of panels) {
      const cv = p.cv, tex = p.tex;
      if (!cv || !tex) continue;
      const g = cv.getContext("2d");
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = "rgba(8,18,30,0.86)";
      roundRect(g, 6, 6, cv.width - 12, cv.height - 12, 18);
      g.fill();
      // The fleet that firer is sinking belongs to the OTHER side.
      const ownerSide = p.firer === "host" ? "guest" : "host";
      const isMine = mySide && ownerSide === mySide;
      const accent = p.firer === "host" ? SIDE_COLOR.host : SIDE_COLOR.guest;
      g.lineWidth = 4;
      g.strokeStyle = accent;
      g.stroke();
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillStyle = accent;
      g.font = "bold 26px sans-serif";
      const title = mySide ? (isMine ? "Your Fleet" : "Enemy Fleet") : (ownerSide === "host" ? "Host Fleet" : "Guest Fleet");
      g.fillText(title, 22, 34);
      const sunkCount = sunkBy[p.firer].size;
      g.fillStyle = "#9fb2c0";
      g.font = "16px sans-serif";
      g.textAlign = "right";
      g.fillText(`${sunkCount}/${FLEET.length} sunk`, cv.width - 22, 34);

      let yy = 76;
      const rowH = (cv.height - 96) / FLEET.length;
      // Active sink-flourish for this placard's fleet (I3): a 0→1 fade.
      const flash = panelFlash[p.firer];
      let flashGlow = 0;
      if (flash) {
        const left = flash.until - nowMs();
        flashGlow = left > 0 ? Math.max(0, Math.min(1, left / PANEL_FLASH_MS)) : 0;
      }
      for (const spec of FLEET) {
        const dead = sunkBy[p.firer].has(spec.id);
        const glowing = flash && flash.id === spec.id && flashGlow > 0;
        if (glowing) {
          // Brief warm glow band behind the just-sunk row.
          g.fillStyle = `rgba(216,68,44,${0.45 * flashGlow})`;
          roundRect(g, 14, yy - rowH * 0.42, cv.width - 28, rowH * 0.84, 8);
          g.fill();
        }
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.font = "bold 20px sans-serif";
        // Brighter strike colour + darker base so dead rows read clearly (I5).
        g.fillStyle = dead ? "#c8786e" : "#dfe9f2";
        g.fillText(spec.name, 22, yy);
        if (dead) {
          g.strokeStyle = "#d8543c";
          g.lineWidth = 2;
          const w = g.measureText(spec.name).width;
          g.beginPath();
          g.moveTo(22, yy);
          g.lineTo(22 + w, yy);
          g.stroke();
        }
        // pips
        const pipR = 6;
        const pipGap = 18;
        const px0 = cv.width - 22 - spec.length * pipGap;
        for (let i = 0; i < spec.length; i++) {
          g.beginPath();
          g.arc(px0 + i * pipGap + pipGap / 2, yy, pipR, 0, Math.PI * 2);
          g.fillStyle = dead ? "#c83828" : accent;
          g.fill();
        }
        yy += rowH;
      }
      tex.needsUpdate = true;
    }
  }

  // Trigger the sink-flourish on the placard whose `firer` just sank `shipId`.
  // No-op if no ship id (a plain hit/miss). Drives a brief redraw window via the
  // animation loop; safe on every client (derived from existing sunkBy data).
  function flashPanelRow(firer, shipId) {
    if (!shipId || !SHIP_IDS.has(shipId)) return;
    panelFlash[firer] = { id: shipId, until: nowMs() + PANEL_FLASH_MS };
    refreshPanels();
    startLoop();
  }

  // Advance/expire the placard sink-flourish; redraw while any is live (I3).
  function stepPanelFlash() {
    let any = false;
    for (const firer of ["host", "guest"]) {
      const f = panelFlash[firer];
      if (!f) continue;
      if (f.until - nowMs() <= 0) { panelFlash[firer] = null; refreshPanels(); }
      else any = true;
    }
    if (any) refreshPanels();
    return any;
  }

  // ===========================================================================
  // HUD billboard — a canvas plane that states the current guidance (original
  // phrasing mapped into the in-world HUD). Also forwarded to ctx.onHud if present.
  //
  // PLACEMENT (Task 3): it must NEVER overlap the board (esp. "Incoming fire —
  // brace!"), must be readable by the LOCAL seated player from their first-person
  // seated camera, and must not be clipped by a chair across the table. It is
  // anchored HIGH ABOVE and pulled toward/over the LOCAL player's OWN (near, −Z)
  // ocean edge — never over the grids. Because the board self-orients per seat
  // (orientFor(seatRy)), anchoring above the local near ocean automatically puts
  // the HUD in front of whichever seat owns that board, correct for BOTH players.
  // depthTest:false keeps it drawn on top; the per-frame billboard counter-rotates
  // the group's Y so the text stays upright/forward.
  function buildHud() {
    // When the host app provides a DOM HUD hook (ctx.onHud), skip the in-world 3D
    // billboard — refreshHud() forwards the text to the hook, which renders a
    // screen-space banner that's always visible to every player.
    if (hudHook) { hudMesh = null; return; }
    const canCreate = typeof document !== "undefined" && document.createElement;
    const cv = canCreate ? document.createElement("canvas") : null;
    if (cv) { cv.width = 512; cv.height = 192; }
    const tex = cv ? new THREE.CanvasTexture(cv) : null;
    if (tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const mat = tex
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
      : new THREE.MeshBasicMaterial({ color: "#0c2036", transparent: true, opacity: 0.85, depthWrite: false });
    const w = GRID_SPAN * 0.9;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.36), mat);
    // Above + over the LOCAL player's own ocean: pulled to the near (−Z) edge and
    // lifted well clear of the board so it never covers the two grids, and high
    // enough to clear chairs/heads across the table.
    const hudZ = OCEAN_CZ - GRID_SPAN * 0.42; // toward the local seat, past the near ocean edge
    const hudY = SURF_Y + GRID_SPAN * 1.05;   // raised high above the board surface
    mesh.position.set(0, hudY, hudZ);
    mesh.renderOrder = 30;
    mesh.userData.cv = cv;
    mesh.userData.tex = tex;
    group.add(mesh);
    hudMesh = mesh;
    refreshHud();
  }

  // Guidance text for the current phase/turn — mapped from the original strings.
  function hudLines() {
    if (!mySide) {
      if (phase === "over") return { title: "Battle over", sub: winner ? `${cap(winner)} fleet victorious` : "", color: "#9fd3ff" };
      if (phase === "placement") return { title: "Battleship · Naval Warfare", sub: "Players deploying fleets…", color: "#9fd3ff" };
      const firer = currentFirer();
      return { title: "Battleship (spectating)", sub: firer ? `${cap(firer)} to fire` : "", color: "#9fd3ff" };
    }
    const sideName = cap(mySide);
    if (phase === "over") {
      const won = winner === mySide;
      return {
        title: won ? "VICTORY — enemy fleet sunk!" : "DEFEAT — your fleet is sunk",
        sub: won ? "Enemy fleet sent to the depths." : "Your fleet was lost at sea.",
        color: won ? "#7fffb0" : "#ff9a8a",
      };
    }
    if (phase === "placement") {
      if (ready[mySide]) {
        const oppReady = ready[oppSide];
        return { title: "Fleet ready", sub: oppReady ? "Both fleets deployed…" : "Waiting for opponent to deploy their fleet…", color: "#dfe9f2" };
      }
      const remaining = FLEET.length - myPlacements.length;
      if (remaining === 0) {
        return { title: "All ships placed — ready when you are!", sub: "Tap Ready ▸ to deploy.", color: "#bfe0ff" };
      }
      const spec = currentSpec();
      const sub = spec
        ? `Place ${spec.name} (${spec.length}). Click your waters · Rotate: ${ghostOrient}.`
        : "All ships placed. Click Ready ▸.";
      return {
        title: `Place your fleet — ${remaining} ship${remaining === 1 ? "" : "s"} left`,
        sub,
        color: "#bfe0ff",
      };
    }
    // playing
    const mine = sunkBy[mySide].size, theirs = sunkBy[oppSide].size;
    const counts = `Enemy sunk ${mine}/${FLEET.length} · yours lost ${theirs}/${FLEET.length}`;
    if (myTurnNow()) {
      return { title: "YOUR TURN — fire!", sub: `Pick a target on enemy waters. ${counts}`, color: "#7fd1ff" };
    }
    return { title: "Incoming fire — brace!", sub: `Waiting for opponent… ${counts}`, color: "#dfe9f2" };
  }

  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function refreshHud() {
    const { title, sub, color } = hudLines();
    if (hudHook) { try { hudHook(sub ? `${title} — ${sub}` : title); } catch { /* ignore */ } }
    const mesh = hudMesh;
    const cv = mesh && mesh.userData.cv;
    const tex = mesh && mesh.userData.tex;
    if (!cv || !tex) return;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = "rgba(8,18,30,0.86)";
    roundRect(g, 6, 6, cv.width - 12, cv.height - 12, 22);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = color;
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    // Auto-fit so the full line always fits the canvas — no more clipped edges.
    fitFont(g, title, cv.width - 44, 46, "bold");
    g.fillText(title, cv.width / 2, 70);
    if (sub) {
      g.fillStyle = "#dfe9f2";
      fitFont(g, sub, cv.width - 36, 26, "");
      g.fillText(sub, cv.width / 2, 134);
    }
    tex.needsUpdate = true;
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

  // ===========================================================================
  // Animation loop (internal rAF; idles to zero when nothing moves except the
  // HUD billboard, which we keep tracking the camera).
  // ===========================================================================
  const shells = [];
  const blooms = [];
  const hullPops = []; // { group, t, dur } settle-in pops for freshly placed hulls (I1)
  let rafId = null;
  let lastT = 0;
  let idleT = 0;

  // ── Ported missile + FX (faithful port of the original missile.ts / fx.ts /
  // debris.ts / damage.ts). Cosmetic only: launched from public shot results, so
  // they are owner-and-spectator safe and never touch the firing/turn/sync logic.
  // Parented to `group` so they inherit the board transform + per-seat orientation.
  const fx = new FX(group, CELL);
  const missiles = new MissileSystem(group, fx, CELL);
  const _v3 = new THREE.Vector3();
  // Local-space launch points: a firer lobs from above their OWN near ocean edge
  // toward the enemy grid; an incoming shot arcs from above the enemy's far edge.
  function fireLaunchOrigin() {
    return new THREE.Vector3((Math.random() - 0.5) * GRID_SPAN * 0.3, SURF_Y + GRID_SPAN * 0.55, OCEAN_CZ - GRID_SPAN * 0.2);
  }
  function incomingLaunchOrigin() {
    return new THREE.Vector3((Math.random() - 0.5) * GRID_SPAN * 0.5, SURF_Y + GRID_SPAN * 0.55, ENEMY_CZ + GRID_SPAN * 0.2);
  }
  // Launch the ported missile arcing to the target cell's render position. onArrive
  // is now PURELY COSMETIC (plays the impact blast where the missile lands) — the
  // shot result + turn handback are resolved immediately, never gated on this (B1).
  function launchMissile(x, y, which, origin, onArrive) {
    const target = new THREE.Vector3(cellX(x), SURF_Y + CELL * 0.4, cellZView(y, which));
    missiles.launch(origin, target, { duration: 1.0, arc: GRID_SPAN * 0.5, onArrive });
    startLoop();
  }
  // Play the ported impact effect at a target cell — water geyser on a miss, the
  // big fireball + flying debris + a revealed burning ship section on a hit/sink.
  // `orient` is the real ship orientation when known (defender side); the firer
  // doesn't know it, so it falls back to "horizontal" (B3).
  const MAX_DAMAGE_TILES = 12; // cap the live burning sections so they don't pile up (B2)
  function playImpact(x, y, which, outcome, sunkId, orient) {
    _v3.set(cellX(x), SURF_Y, cellZView(y, which));
    if (outcome === "miss") {
      fx.splash(_v3);
    } else {
      const color = sunkId ? shipHullColor(sunkId) : 0x556069;
      fx.bigExplosion(_v3);
      fx.debris.burst(_v3, 18, color);
      // structure stub on any hit to a larger ship — not only on the sinking blow:
      // a mid-hit on a non-submarine still reveals a superstructure stub (B3).
      const structure = sunkId ? sunkId !== "submarine" : outcome === "hit";
      fx.damage.add(_v3, color, orient === "vertical" ? "vertical" : "horizontal", structure);
      pruneDamageTiles();
    }
    startLoop();
  }

  // Retire the oldest burning ship sections once we exceed the cap so they can't
  // accumulate for the whole game on the firing client (B2). fx.damage.tiles is
  // the ported DamageSystem's live list; each tile owns its group + dispose().
  function pruneDamageTiles() {
    const tiles = fx.damage && fx.damage.tiles;
    if (!Array.isArray(tiles)) return;
    while (tiles.length > MAX_DAMAGE_TILES) {
      const old = tiles.shift();
      if (!old) break;
      try { fx.damage.root.remove(old.group); } catch { /* ignore */ }
      try { old.dispose?.(); } catch { /* ignore */ }
    }
  }
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const raf = (fn) => (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(fn) : setTimeout(() => fn(nowMs()), 16));
  const caf = (id) => (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(id) : clearTimeout(id));
  const easeOut = (x) => 1 - (1 - x) * (1 - x);

  // Authored base emissive of the two frame-rail materials — the turn cue pulses
  // around these and the inactive rail eases back to them (P2 #7).
  const FRAME_OCEAN_EM = M.frameOcean.emissiveIntensity;
  const FRAME_ENEMY_EM = M.frameEnemy.emissiveIntensity;
  let turnCuePhase = 0;

  // Which frame rail belongs to the grid the CURRENT firer is shooting at, in THIS
  // view (matches applyState's marker placement): the firer hits the enemy grid
  // (M.frameEnemy) when it's a seated player's own turn or, for a spectator, the
  // host firing; otherwise it's the ocean grid (M.frameOcean). null while not playing.
  function activeFireRail() {
    if (phase !== "playing") return null;
    const firer = currentFirer();
    if (!firer) return null;
    const onEnemyGrid = mySide ? firer === mySide : firer === "host";
    return onEnemyGrid ? M.frameEnemy : M.frameOcean;
  }

  function stepTurnCue(dt) {
    const active = phase === "playing" ? activeFireRail() : null;
    turnCuePhase += dt;
    const pulse = active ? 0.5 + 0.5 * Math.sin(turnCuePhase * 3.4) : 0;
    // Pulse the active rail up to ~+0.9 over base; ease the other back toward base.
    const oceanTarget = active === M.frameOcean ? FRAME_OCEAN_EM + 0.9 * pulse : FRAME_OCEAN_EM;
    const enemyTarget = active === M.frameEnemy ? FRAME_ENEMY_EM + 0.9 * pulse : FRAME_ENEMY_EM;
    M.frameOcean.emissiveIntensity += (oceanTarget - M.frameOcean.emissiveIntensity) * Math.min(1, dt * 8);
    M.frameEnemy.emissiveIntensity += (enemyTarget - M.frameEnemy.emissiveIntensity) * Math.min(1, dt * 8);
  }

  // Is anything still animating? Used to let the rAF self-cancel when idle (I9)
  // instead of spinning forever. The HUD billboard only needs re-tracking when the
  // group rotation changes (seat/role change), which re-arms the loop explicitly.
  function hasAnimWork() {
    return (
      shells.length > 0 ||
      blooms.length > 0 ||
      hullPops.length > 0 ||
      targetRings.length > 0 ||
      (reticle && reticle.visible) ||
      !!(panelFlash.host || panelFlash.guest) ||
      (ghostMesh && phase === "placement") ||
      !!reticleLock ||
      flourishQueue.length > 0 ||
      // Keep ticking while playing so the whose-turn rail pulse (P2 #7) and the
      // last-shot halo (P2 #6) keep animating, and once more after to settle the
      // rails back to base when the game ends.
      phase === "playing" ||
      !!(lastShot.host || lastShot.guest) ||
      missiles.active ||
      fx.active
    );
  }

  function startLoop() {
    if (rafId != null) return;
    lastT = nowMs();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
      lastT = t;
      stepAnim(dt);
      // Self-cancel when nothing is animating (I9) — re-armed by the fire/impact/
      // aim/seat paths that already call startLoop(). One final billboard sync was
      // done in stepAnim, so the HUD stays correct until the next change.
      if (hasAnimWork()) rafId = raf(tick);
      else rafId = null;
    };
    rafId = raf(tick);
  }

  function stepAnim(dt) {
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      s.mesh.position.x = s.from.x + (s.to.x - s.from.x) * k;
      s.mesh.position.z = s.from.z + (s.to.z - s.from.z) * k;
      s.mesh.position.y = s.baseY + Math.sin(k * Math.PI) * s.arc;
      if (k >= 1) {
        group.remove(s.mesh);
        shells.splice(i, 1);
        if (s.onLand) s.onLand();
      }
    }
    for (let i = blooms.length - 1; i >= 0; i--) {
      const b = blooms[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      const sc = 0.4 + easeOut(k) * b.grow;
      b.mesh.scale.setScalar(sc);
      b.mesh.material.opacity = (1 - k) * b.peak;
      if (k >= 1) {
        group.remove(b.mesh);
        b.mesh.material.dispose?.();
        b.mesh.geometry.dispose?.();
        blooms.splice(i, 1);
      }
    }
    // Placement ghost pulse (I2): breathe the preview opacity so it reads as a live
    // preview. Cheap — only runs while a ghost exists during placement.
    if (ghostMesh && phase === "placement") {
      idleT += dt;
      const pulse = 0.5 + 0.5 * Math.sin(idleT * 4.2);
      M.ghostOk.opacity = 0.42 + 0.22 * pulse;
      M.ghostBad.opacity = 0.4 + 0.18 * pulse;
    }
    // Settle-in pops for freshly placed hulls (I1): 0.85→1.0 with a tiny overshoot.
    for (let i = hullPops.length - 1; i >= 0; i--) {
      const p = hullPops[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const e = easeOut(k);
      const base = p.group.userData.popBase || 1;
      // slight overshoot near the end for a lively settle, easing back to 1.0
      const overshoot = Math.sin(k * Math.PI) * 0.06;
      p.group.scale.setScalar(base * (0.85 + 0.15 * e + overshoot));
      if (k >= 1) {
        p.group.scale.setScalar(base);
        hullPops.splice(i, 1);
      }
    }
    if (targetRings.length > 0 || (reticle && reticle.visible)) {
      idleT += dt;
      const bob = Math.sin(idleT * 3.2) * CELL * 0.06;
      const rz = idleT * 1.6;
      // Animate the ONE shared ring material's opacity a single time (I6).
      M.targetShared.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(idleT * 4));
      for (const t of targetRings) {
        t.position.y = t.userData.baseY + bob;
        t.rotation.z = rz;
      }
      if (reticle && reticle.visible) {
        reticle.rotation.z = rz;
        const s = 1 + Math.sin(idleT * 5) * 0.08;
        reticle.scale.setScalar(s);
      }
    }
    // Whose-turn board cue (P2 #7): while playing, gently pulse the emissive of the
    // frame rail around the grid the CURRENT firer is shooting at, so a spectator or
    // an idle player reads turn state off the board itself, not just the HUD text.
    // Drives the two shared frame materials; the inactive one eases back to its base.
    stepTurnCue(dt);
    // Last-shot indicator (P2 #6): a short-lived bobbing halo over the most recent
    // marker per side, so players + spectators can follow the volley.
    stepLastShot(dt);
    // Locked-target confirm punch on the just-fired reticle (P2 #10).
    stepReticleLock();
    // Ported missile flight + particle/debris/damage systems (cosmetic).
    missiles.update(dt);
    fx.update(dt);
    // Advance/redraw the placard sink-flourish while one is live (I3).
    stepPanelFlash();
    // Fire any due victory ripples (I4).
    stepFlourish();
    // Billboard the HUD toward the camera (counter the group's own Y rotation so
    // the text stays upright + readable from any seat).
    if (hudMesh) hudMesh.rotation.y = -group.rotation.y;
  }

  // (The old simple shell-arc + bloom helpers were replaced by the faithful
  // ported missile + FX, wired through launchMissile()/playImpact() above. The
  // shells/blooms arrays remain only so applyState/dispose stay no-op-safe.)

  // ===========================================================================
  // Markers — persistent pegs encoding the public shot grids.
  // ===========================================================================
  function placeMarker(x, y, outcome, which, mapStore) {
    const key = x + "," + y;
    if (mapStore.has(key)) return; // idempotent
    let mesh;
    const mz = cellZView(y, which);
    if (outcome === "miss") {
      mesh = new THREE.Mesh(G.peg, M.miss);
      mesh.position.set(cellX(x), PEG_Y, mz);
    } else {
      mesh = new THREE.Mesh(G.emberPeg, outcome === "sunk" ? M.sunkMark : M.hit);
      mesh.position.set(cellX(x), PEG_Y + CELL * 0.06, mz);
    }
    mesh.castShadow = true;
    group.add(mesh);
    mapStore.set(key, mesh);
  }

  function clearMarkers() {
    for (const m of oceanShotMarks.values()) group.remove(m);
    for (const m of enemyShotMarks.values()) group.remove(m);
    oceanShotMarks.clear();
    enemyShotMarks.clear();
  }

  // ── Last-shot halo (P2 #6) ────────────────────────────────────────────────
  // Record the newest shot for `side`, rendered on `which` grid in THIS view. The
  // halo is a single reusable ring per side; stepLastShot bobs + fades it. Cosmetic
  // and derived purely from the public shot just rendered — no state, no sync.
  function markLastShot(side, x, y, which) {
    if (!inGrid(x, y)) return;
    lastShot[side] = { x, y, which, born: nowMs() };
    startLoop();
  }

  function ensureLastShotHalo(side) {
    let h = lastShotHalos[side];
    if (h) return h;
    h = new THREE.Mesh(G.ring, M.lastShot.clone());
    h.rotation.x = Math.PI / 2;
    h.renderOrder = 4;
    h.visible = false;
    group.add(h);
    lastShotHalos[side] = h;
    return h;
  }

  function stepLastShot() {
    for (const side of ["host", "guest"]) {
      const s = lastShot[side];
      const h = lastShotHalos[side];
      if (!s) { if (h) h.visible = false; continue; }
      const age = nowMs() - s.born;
      if (age >= LAST_SHOT_MS) {
        lastShot[side] = null;
        if (h) h.visible = false;
        continue;
      }
      const halo = ensureLastShotHalo(side);
      const k = age / LAST_SHOT_MS;        // 0→1 over its life
      const baseY = PEG_Y + CELL * 0.2;
      halo.position.set(cellX(s.x), baseY + Math.sin(nowMs() * 0.012) * CELL * 0.08, cellZView(s.y, s.which));
      halo.scale.setScalar(1.1 + 0.7 * k); // grows as it fades, like a sonar ping
      halo.material.opacity = (1 - k) * 0.85;
      halo.visible = true;
    }
  }

  function clearLastShot() {
    lastShot.host = lastShot.guest = null;
    for (const side of ["host", "guest"]) {
      const h = lastShotHalos[side];
      if (h) h.visible = false;
    }
  }

  // ===========================================================================
  // Hull rendering — MY ships only, on MY (near) ocean. Local-only; never wired.
  // ===========================================================================
  // The FULL detailed warship per class — a faithful port of the original
  // warship.ts builder (ExtrudeGeometry / LatheGeometry hulls, tapered
  // superstructure, turrets + barrels, funnels, flight deck / island / jets,
  // sub teardrop + sail, masts, SPY panels, CIWS, VLS, radar) with the original
  // procedural albedo/normal/roughness textures and per-class liveries, scaled
  // to the in-world cell size. PURELY VISUAL: every mesh is made non-raycastable
  // so the ships can never intercept a board click — the grid cells stay the
  // only hit-test.
  // Build one ship's detailed warship mesh, centred on its cells of the given grid
  // ("ocean" = your near −Z grid; "enemy" = the far +Z grid). Seated play always
  // renders MY fleet on the ocean grid; a spectator renders each revealed fleet on
  // the grid where that side is FIRED UPON (see revealFleets above).
  function buildHull(ship, which = "ocean") {
    const spec = SHIP_BY_ID.get(ship.id);
    const g = new THREE.Group();
    g.add(buildWarship({ id: ship.id, length: spec.length, orientation: ship.orientation, cell: CELL }));

    const cells = shipCells(ship);
    const a = cells[0];
    const b = cells[cells.length - 1];
    const cx = (cellX(a.x) + cellX(b.x)) / 2;
    const cz = (cellZView(a.y, which) + cellZView(b.y, which)) / 2;
    g.position.set(cx, HULL_Y, cz);
    if (ship.orientation === "vertical") g.rotation.y = Math.PI / 2;
    g.userData.shipId = ship.id;
    // Purely decorative — never intercept a board click.
    g.traverse((c) => { if (c.isMesh) c.raycast = () => {}; });
    return g;
  }

  // popLastId: when set, the hull whose shipId matches gets a brief settle-in pop
  // (I1) — used only when a single ship was just placed by the local player.
  function rebuildHulls(popLastId) {
    hullPops.length = 0; // any in-flight pops belong to hulls about to be rebuilt
    for (const h of hullMeshes) {
      h.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
      group.remove(h);
    }
    hullMeshes.length = 0;
    if (!mySide) return; // only the seated owner renders their own fleet hulls
    for (const ship of myPlacements) {
      const h = buildHull(ship);
      group.add(h);
      hullMeshes.push(h);
      if (popLastId && ship.id === popLastId) startHullPop(h);
    }
  }

  // A short ease-out scale-in so a freshly placed hull settles rather than snapping
  // (I1). Stores the hull's authored scale and lerps from 0.85→1.0 over ~160ms.
  function startHullPop(h) {
    h.userData.popBase = h.scale.x; // warships are uniform-scaled
    hullPops.push({ group: h, t: 0, dur: 0.16 });
    h.scale.setScalar(h.userData.popBase * 0.85);
    startLoop();
  }

  // SPECTATOR-ONLY: render BOTH revealed fleets — host on the OCEAN grid (−Z),
  // guest on the ENEMY grid (+Z) — so a watcher sees every ship alongside every
  // shot. A seated player NEVER calls this (revealFleets stay null), so an opponent
  // can never see your ships. Idempotent: clears and rebuilds from revealFleets.
  function rebuildRevealFleets() {
    for (const h of revealHullMeshes) {
      h.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
      group.remove(h);
    }
    revealHullMeshes.length = 0;
    if (mySide) return; // seated players never render revealed opponent fleets
    const layoutFor = { host: revealFleets.host, guest: revealFleets.guest };
    // host fleet sits where the GUEST fires (ocean, −Z); guest fleet where the HOST
    // fires (enemy, +Z) — matching applyState's spectator shot-stream placement.
    const gridFor = { host: "ocean", guest: "enemy" };
    for (const side of ["host", "guest"]) {
      const layout = layoutFor[side];
      if (!Array.isArray(layout)) continue;
      for (const ship of layout) {
        if (!ship || !SHIP_BY_ID.has(ship.id)) continue;
        const norm = { id: ship.id, x: ship.x, y: ship.y, orientation: ship.orientation };
        const h = buildHull(norm, gridFor[side]);
        group.add(h);
        revealHullMeshes.push(h);
      }
    }
  }

  // SPECTATOR-ONLY REVEAL apply. The framework hands a spectator instance the merged
  // per-seat reveals { host:{side,fleet}|null, guest:{...}|null } that the two seated
  // players published. We store each side's fleet and re-render. NO-OP for a seated
  // player (mySide set) so an opponent's layout never reaches a player's own view.
  function applyReveal(reveals) {
    if (mySide) return; // only a spectator renders opponent fleets
    if (!reveals || typeof reveals !== "object") return;
    for (const side of ["host", "guest"]) {
      const r = reveals[side];
      const norm = r && Array.isArray(r.fleet) ? normalizeLayout(r.fleet) : null;
      if (norm && validLayout(norm)) revealFleets[side] = norm;
    }
    rebuildRevealFleets();
  }

  // Coerce a wire fleet into the canonical {id,x,y,length,name,orientation} shape
  // validLayout expects (it fills length/name from the spec). Tolerant of extras.
  function normalizeLayout(fleet) {
    if (!Array.isArray(fleet)) return null;
    return fleet.map((s) => {
      const spec = s && SHIP_BY_ID.get(s.id);
      return spec
        ? { id: s.id, name: spec.name, length: spec.length, x: s.x, y: s.y, orientation: s.orientation }
        : s;
    });
  }

  // ===========================================================================
  // Placement ghost + interaction
  // ===========================================================================
  function clearGhost() {
    if (ghostMesh) {
      ghostMesh.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
      group.remove(ghostMesh);
      ghostMesh = null;
    }
  }

  function currentSpec() {
    return placeIndex < FLEET.length ? FLEET[placeIndex] : null;
  }

  function refreshGhost() {
    clearGhost();
    if (phase !== "placement" || !mySide || ready[mySide]) return;
    const spec = currentSpec();
    if (!spec || !hoverCell) return;
    const ship = { id: spec.id, name: spec.name, length: spec.length, x: hoverCell.x, y: hoverCell.y, orientation: ghostOrient };
    const ok = canPlace(myPlacements, ship);
    const cells = shipCells(ship).filter((c) => inGrid(c.x, c.y));
    if (cells.length === 0) return;
    const g = new THREE.Group();
    const mat = ok ? M.ghostOk : M.ghostBad;
    for (const cell of cells) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.8, HULL_H * 0.7, CELL * 0.8), mat);
      block.position.set(cellX(cell.x), HULL_Y, cellZ(cell.y, "ocean"));
      g.add(block);
    }
    // Purely a preview — never intercept a placement click. Without this the ghost
    // blocks can steal the raycast at grazing angles (their front face sits in front
    // of the cell collider), _resolveCell finds no userData.cell on the ghost, and
    // the placement click silently drops (P1 #1). Mirror buildHull's treatment.
    g.traverse((c) => { if (c.isMesh) c.raycast = () => {}; });
    group.add(g);
    ghostMesh = g;
    startLoop(); // animate the ghost pulse (I2)
  }

  function tryPlaceAt(x, y) {
    const spec = currentSpec();
    if (!spec) return false;
    const ship = { id: spec.id, name: spec.name, length: spec.length, x, y, orientation: ghostOrient };
    if (!canPlace(myPlacements, ship)) return false;
    myPlacements.push(ship);
    placeIndex = myPlacements.length;
    rebuildHulls(ship.id); // settle-in pop on the just-placed hull (I1)
    refreshGhost();
    refreshButtons();
    refreshHud();
    return true;
  }

  function doRandomize() {
    const fleet = randomFleet();
    if (!fleet) return;
    myPlacements = fleet;
    placeIndex = FLEET.length;
    rebuildHulls();
    refreshGhost();
    refreshButtons();
    refreshHud();
  }

  function doAutoRemaining() {
    for (let i = placeIndex; i < FLEET.length; i++) {
      const spec = FLEET[i];
      let placed = false;
      for (let attempt = 0; attempt < 1000 && !placed; attempt++) {
        const orientation = Math.random() < 0.5 ? "horizontal" : "vertical";
        const maxX = orientation === "horizontal" ? GRID - spec.length : GRID - 1;
        const maxY = orientation === "vertical" ? GRID - spec.length : GRID - 1;
        const x = Math.floor(Math.random() * (maxX + 1));
        const y = Math.floor(Math.random() * (maxY + 1));
        const ship = { id: spec.id, name: spec.name, length: spec.length, x, y, orientation };
        if (canPlace(myPlacements, ship)) { myPlacements.push(ship); placed = true; }
      }
    }
    placeIndex = myPlacements.length;
    rebuildHulls();
    refreshGhost();
    refreshButtons();
    refreshHud();
  }

  function doClear() {
    myPlacements = [];
    placeIndex = 0;
    rebuildHulls();
    refreshGhost();
    refreshButtons();
    refreshHud();
  }

  function doReady() {
    if (!isComplete(myPlacements) || !mySide) return;
    myOcean = freshOceanState();
    myOcean.occ = occupancyOf(myPlacements);
    ready[mySide] = true;
    clearGhost();
    refreshButtons();
    refreshHud();
    try { ctx.net.sendMove({ type: "place", ready: true }); } catch { /* transport optional */ }
    // SPECTATOR-ONLY REVEAL: publish MY finalized fleet so watchers (seated
    // spectators + ambient passersby) can render it. The server routes this ONLY to
    // spectators + ambient — NEVER to my opponent's seat — so the game stays fair.
    sendFleetReveal();
    maybeStart();
    pushSnapshot();
  }

  // Publish my own fleet on the spectator-only reveal channel. Side-tagged so the
  // spectator renders it on the correct grid. Guarded to a seated player with a
  // complete fleet; a spectator has no fleet to send.
  function sendFleetReveal() {
    if (!mySide || myPlacements.length !== FLEET.length) return;
    const fleet = myPlacements.map((s) => ({ id: s.id, x: s.x, y: s.y, orientation: s.orientation }));
    try { ctx.net.sendReveal({ side: mySide, fleet }); } catch { /* transport optional */ }
  }

  function maybeStart() {
    if (phase !== "placement") return;
    if (!ready.host || !ready.guest) return;
    if (role !== "host") return; // only the host decides + broadcasts the start
    first = Math.random() < 0.5 ? "host" : "guest";
    phase = "playing";
    myTurn = first === "host";
    try { ctx.net.sendMove({ type: "start", first }); } catch { /* transport optional */ }
    refreshEnemyLive();
    refreshHud();
    pushSnapshot();
  }

  // ===========================================================================
  // Firing — single shot, strictly alternating. Lock input the instant we fire.
  // ===========================================================================
  function canFireAt(x, y) {
    if (phase !== "playing" || !mySide) return false;
    if (!myTurn || pendingFire) return false;
    if (!ctx.isLocalTurnAllowed()) return false;
    if (!inGrid(x, y)) return false;
    if (tracking[mySide].has(x + "," + y)) return false;
    return true;
  }

  function fireAt(x, y) {
    if (!canFireAt(x, y)) return;
    pendingFire = { x, y };
    myTurn = false;
    clearReticle();
    refreshEnemyLive();
    refreshHud();
    // Locked-target confirm flash at the fired cell (P2 #10) — set up AFTER
    // refreshEnemyLive (which hides the reticle for the now-not-my-turn state) so the
    // punch survives; stepAnim animates + retires it.
    startReticleLock(x, y);
    // Ported missile: arc a guided projectile from my side onto the enemy cell.
    // Purely cosmetic — the shot result still arrives over the wire ("result").
    launchMissile(x, y, "enemy", fireLaunchOrigin(), null);
    try { ctx.net.sendMove({ type: "fire", x, y }); } catch { /* transport optional */ }
  }

  // Briefly hold the crosshair (red + scale-punch) at the just-fired cell, then hide
  // it. Reuses the persistent reticle mesh; purely cosmetic (P2 #10).
  function startReticleLock(x, y) {
    const r = ensureReticle();
    M.reticleBad.opacity = 0.95; // start from the authored opacity each lock
    for (const p of r.userData.parts) p.material = M.reticleBad;
    r.position.set(cellX(x), SURF_Y + CELL * 0.16, cellZView(y, "enemy"));
    r.rotation.z = 0;
    r.scale.setScalar(1.5);
    r.visible = true;
    reticleLock = { until: nowMs() + RETICLE_LOCK_MS };
    startLoop();
  }

  function stepReticleLock() {
    if (!reticleLock) return;
    const left = reticleLock.until - nowMs();
    if (left <= 0 || !reticle) {
      reticleLock = null;
      M.reticleBad.opacity = 0.95; // restore the shared material opacity (I6-style)
      // Only hide if a fresh aim hasn't re-shown it for a new turn.
      if (reticle && !myTurnNow()) reticle.visible = false;
      return;
    }
    const k = 1 - left / RETICLE_LOCK_MS; // 0→1
    // Snap in big then settle: a quick punch from 1.5→1.0 with a brief recoil.
    reticle.scale.setScalar(1.5 - 0.6 * easeOut(k) + Math.sin(k * Math.PI) * 0.12);
    M.reticleBad.opacity = 0.95 * (1 - k * 0.5);
  }

  function resolveMyResult(x, y, outcome, sunkId) {
    const key = x + "," + y;
    tracking[mySide].set(key, { outcome, sunk: sunkId });
    shots[mySide].push({ x, y, outcome, sunk: sunkId });
    placeMarker(x, y, outcome, "enemy", enemyShotMarks);
    markLastShot(mySide, x, y, "enemy"); // last-shot halo (P2 #6)
    // The firer doesn't know the enemy ship's orientation; playImpact falls back
    // to "horizontal" (B3). Damage tiles are capped inside playImpact (B2).
    playImpact(x, y, "enemy", outcome, sunkId, "horizontal");
    if (outcome === "sunk" && sunkId) sunkBy[mySide].add(sunkId);
    pendingFire = null;
    refreshPanels();
    flashPanelRow(mySide, sunkId); // sink-flourish on the enemy placard (I3)
    if (sunkBy[mySide].size === FLEET.length) {
      endGame(mySide, "fleet-sunk");
      return;
    }
    if (role === "host") pushSnapshot();
    refreshHud();
    // Turn passes to the opponent; it returns to me only after their incoming
    // {fire} lands (receiveIncomingFire sets myTurn=true).
  }

  function receiveIncomingFire(x, y) {
    if (phase !== "playing") return;
    const res = receiveFire(myOcean, x, y);
    if (!res) return; // out of bounds / duplicate — ignore, don't desync
    shots[oppSide].push({ x, y, outcome: res.outcome, sunk: res.sunk });
    tracking[oppSide].set(x + "," + y, { outcome: res.outcome, sunk: res.sunk });
    placeMarker(x, y, res.outcome, "ocean", oceanShotMarks);
    markLastShot(oppSide, x, y, "ocean"); // last-shot halo (P2 #6)
    // Cosmetic impact rides the missile's arrival (~1s later) so the blast lines up
    // with the projectile landing — but the STATE + reply below are resolved NOW
    // (B1) so the turn handback never waits on an animation. The true ship
    // orientation is known here (defender's grid), so the burning section sits
    // correctly (B3).
    incomingImpact = { x, y, outcome: res.outcome, sunk: res.sunk, orient: orientationAt(x, y) };
    if (res.outcome === "sunk" && res.sunk) sunkBy[oppSide].add(res.sunk);
    refreshPanels();
    flashPanelRow(oppSide, res.sunk);

    const reply = { type: "result", x, y, outcome: res.outcome };
    if (res.outcome === "sunk") reply.sunk = res.sunk;
    try { ctx.net.sendMove(reply); } catch { /* transport optional */ }

    if (res.allSunk) {
      endGame(oppSide, "fleet-sunk");
      return;
    }
    myTurn = true;
    refreshEnemyLive();
    if (role === "host") pushSnapshot();
    refreshHud();
  }

  // The ship id occupying MY ocean cell (x,y), or null. Only valid on the
  // defender (myOcean.occ is the local layout) — used to orient the burning
  // damage section correctly (B3).
  function orientationAt(x, y) {
    const id = myOcean.occ[idx(x, y)];
    if (!id) return "horizontal";
    const ship = myPlacements.find((s) => s.id === id);
    return ship ? ship.orientation : "horizontal";
  }

  // ===========================================================================
  // Aim affordances. On my turn:
  //   (1) PRIMARY: a bobbing TARGET RING sits on every un-fired enemy cell — an
  //       always-visible, framework-independent "these cells are pickable" cue.
  //       Already-fired cells have a peg + no ring, so the board reads its own
  //       firing history.
  //   (2) AIM RETICLE: a crosshair the player slides over enemy waters. board.js
  //       forwards the hovered COLUMN to setHover(); we light that whole column
  //       as a targeting lane and snap a crosshair onto the most-recently aimed
  //       cell (full {r,c} when available, else the column's nearest un-fired
  //       cell). This degrades gracefully to a column lane when only a column is
  //       known, so the aim cue works regardless of how the framework hovers.
  // ===========================================================================
  function myTurnNow() {
    return phase === "playing" && !!mySide && myTurn && !pendingFire && ctx.isLocalTurnAllowed();
  }

  function refreshEnemyLive() {
    // Clear old rings + lane. Rings share M.targetShared — never dispose it here (I6).
    for (const t of targetRings) group.remove(t);
    targetRings.length = 0;
    if (laneMesh) { group.remove(laneMesh); laneMesh.geometry.dispose?.(); laneMesh = null; }
    if (enemyLivePlate) { group.remove(enemyLivePlate); enemyLivePlate.geometry.dispose?.(); enemyLivePlate = null; }
    if (!myTurnNow()) { clearReticle(); return; }

    // Faint live tint over the whole enemy grid (this grid is now active). Sized a
    // hair INSIDE the grid span (was GRID_SPAN + CELL*0.2, whose half-width 0.337
    // poked ~0.007 past the frame rail at HALF=0.330, leaving a thin blue halo
    // outside the border on your turn — P1 #3).
    enemyLivePlate = new THREE.Mesh(new THREE.BoxGeometry(GRID_SPAN - CELL * 0.1, 0.001, GRID_SPAN - CELL * 0.1), M.enemyLive);
    enemyLivePlate.position.set(0, SURF_Y + 0.0015, ENEMY_CZ);
    enemyLivePlate.renderOrder = 1;
    group.add(enemyLivePlate);

    // A bobbing target ring on every un-fired enemy cell — all SHARE one material
    // (M.targetShared), animated once per frame in stepAnim (I6).
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (tracking[mySide].has(x + "," + y)) continue;
        const ring = new THREE.Mesh(G.ring, M.targetShared);
        ring.rotation.x = Math.PI / 2;
        const baseY = SURF_Y + CELL * 0.13;
        ring.position.set(cellX(x), baseY, cellZView(y, "enemy"));
        ring.userData.baseY = baseY;
        ring.renderOrder = 3;
        group.add(ring);
        targetRings.push(ring);
      }
    }
    updateReticle();
    startLoop();
  }

  function ensureReticle() {
    if (reticle) return reticle;
    const g = new THREE.Group();
    // Parts SHARE the M.reticleOk/M.reticleBad materials directly — updateReticle
    // swaps between the two shared mats, so no per-part clone is needed (I6).
    const ring = new THREE.Mesh(G.ring.clone(), M.reticleOk);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    // crosshair lines
    const barGeo = new THREE.BoxGeometry(CELL * 0.74, 0.0015, CELL * 0.06);
    const barGeo2 = new THREE.BoxGeometry(CELL * 0.06, 0.0015, CELL * 0.74);
    const h = new THREE.Mesh(barGeo, M.reticleOk);
    const v = new THREE.Mesh(barGeo2, M.reticleOk);
    g.add(h); g.add(v);
    g.userData.parts = [ring, h, v];
    g.renderOrder = 5;
    g.visible = false;
    group.add(g);
    reticle = g;
    return g;
  }

  // Snap the crosshair onto the aimed cell. If only a column is known (aimRow<0),
  // pick that column's nearest un-fired cell and also light the column as a lane.
  function updateReticle() {
    // refresh the column lane.
    if (laneMesh) { group.remove(laneMesh); laneMesh.geometry.dispose?.(); laneMesh = null; }
    if (!myTurnNow() || aimCol < 0 || aimCol >= GRID) { clearReticle(); return; }

    let row = aimRow;
    if (row < 0 || row >= GRID) row = nearestUnfiredRow(aimCol);

    const fired = row >= 0 && row < GRID && tracking[mySide].has(aimCol + "," + row);

    // Column lane highlight (full enemy column under the pointer). Tint it red too
    // when the aimed cell is already fired so the lane + reticle agree (I10).
    laneMesh = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.94, 0.0016, GRID_SPAN), M.enemyLive.clone());
    laneMesh.material.color.set(fired ? "#ff6a5a" : "#7fd1ff");
    laneMesh.material.opacity = 0.28;
    laneMesh.position.set(cellX(aimCol), SURF_Y + 0.002, ENEMY_CZ);
    laneMesh.renderOrder = 2;
    group.add(laneMesh);

    if (row < 0 || row >= GRID) { clearReticle(); return; }
    const r = ensureReticle();
    const mat = fired ? M.reticleBad : M.reticleOk;
    for (const p of r.userData.parts) p.material = mat;
    r.position.set(cellX(aimCol), SURF_Y + CELL * 0.16, cellZView(row, "enemy"));
    r.visible = true;
    startLoop();
  }

  function nearestUnfiredRow(col) {
    for (let y = 0; y < GRID; y++) if (!tracking[mySide].has(col + "," + y)) return y;
    return -1;
  }

  function clearReticle() {
    if (reticle) reticle.visible = false;
    if (laneMesh) { group.remove(laneMesh); laneMesh.geometry.dispose?.(); laneMesh = null; }
  }

  // ===========================================================================
  // onPointer — the framework dispatches { cell, point, object }.
  //   placement: click YOUR (near) ocean to place/rotate; click a labelled pillar.
  //   playing  : click ENEMY (far) waters to fire (your turn, un-fired cell).
  // ===========================================================================
  // Run a placement control — from a 3D pillar click OR the DOM control bar.
  function handleControl(btn) {
    if (phase !== "placement" || !mySide || ready[mySide]) return;
    if (btn === "rotate") { ghostOrient = ghostOrient === "horizontal" ? "vertical" : "horizontal"; refreshGhost(); refreshHud(); }
    else if (btn === "random") doRandomize();
    else if (btn === "clear") doClear();
    else if (btn === "ready") { if (isComplete(myPlacements)) doReady(); else doAutoRemaining(); }
  }

  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed()) return; // spectators + game-over: inert

    const btn = buttonFromHit(hit);
    if (btn) { handleControl(btn); return; }

    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.r) || !Number.isInteger(cell.c)) return;
    const x = cell.c, y = cell.r;
    if (!inGrid(x, y)) return;

    if (phase === "placement") {
      if (!mySide || ready[mySide]) return;
      if (cell.which !== "ocean") return; // only your ocean is placeable
      if (hoverCell && hoverCell.x === x && hoverCell.y === y && ghostMesh) {
        if (!tryPlaceAt(x, y)) {
          ghostOrient = ghostOrient === "horizontal" ? "vertical" : "horizontal";
          refreshGhost();
          refreshHud();
        }
      } else {
        hoverCell = { x, y };
        if (!tryPlaceAt(x, y)) { refreshGhost(); refreshHud(); }
      }
      return;
    }

    if (phase === "playing") {
      if (cell.which !== "enemy") return; // only fire on enemy waters
      fireAt(x, y);
    }
  }

  // ── Hover routing — board.js forwards the FULL resolved {r,c,which} cell (or
  // -1 on a miss; a bare column number is still tolerated for safety). A full cell
  // pins the EXACT row+col under the cursor: during PLACEMENT a hovered ocean cell
  // drives the ghost preview at that precise {x,y}; during PLAY a hovered enemy
  // cell sets aimCol AND aimRow so the firing reticle tracks the exact cell (it no
  // longer snaps to the column's top). A bare column (no `which`) degrades to a
  // column lane + nearest-un-fired crosshair. Always defensive — never assumes the
  // object form.
  function setHover(arg) {
    if (arg == null || arg === -1) {
      aimCol = aimRow = -1;
      clearReticle();
      return;
    }
    const cell = (typeof arg === "object" && arg) ? arg : null;
    const which = cell ? cell.which : null;
    const col = cell ? (Number.isInteger(cell.c) ? cell.c : -1) : (Number.isInteger(arg) ? arg : -1);
    const row = cell && Number.isInteger(cell.r) ? cell.r : -1;

    // Placement: a full ocean cell drives the ghost preview.
    if (phase === "placement") {
      if (mySide && !ready[mySide] && which === "ocean" && col >= 0 && row >= 0) {
        if (!hoverCell || hoverCell.x !== col || hoverCell.y !== row) {
          hoverCell = { x: col, y: row };
          refreshGhost();
          refreshHud();
        }
      }
      return;
    }

    // Playing: drive the aim lane + crosshair on enemy waters. A bare column
    // (no `which`) is treated as an enemy-grid hover (the only live grid on my
    // turn); a full ocean cell is ignored.
    if (phase === "playing" && mySide) {
      if (which === "ocean") { aimCol = aimRow = -1; clearReticle(); return; }
      aimCol = col;
      aimRow = row;
      updateReticle();
    }
  }

  function buttonFromHit(hit) {
    let o = hit && hit.object;
    while (o && o !== group) {
      if (o.userData && o.userData.btn) return o.userData.btn;
      o = o.parent;
    }
    return null;
  }

  // ===========================================================================
  // applyMove — apply ONE relayed message. Throws GameDesync on a structural
  // mismatch (the contract's resync signal).
  // ===========================================================================
  function applyMove(move, byRole) {
    if (!move || typeof move !== "object") return false;
    switch (move.type) {
      case "place": {
        const them = byRole === "host" ? "host" : byRole === "guest" ? "guest" : oppSide;
        if (them) ready[them] = true;
        refreshButtons();
        refreshHud();
        maybeStart();
        pushSnapshot();
        return true;
      }
      case "start": {
        if (move.first !== "host" && move.first !== "guest") throw new GameDesync("battleship: bad start.first");
        first = move.first;
        phase = "playing";
        ready.host = true;
        ready.guest = true;
        if (mySide) myTurn = first === mySide;
        refreshButtons();
        refreshEnemyLive();
        refreshHud();
        pushSnapshot();
        return true;
      }
      case "fire": {
        if (phase !== "playing") throw new GameDesync("battleship: fire before play");
        if (!mySide) return true; // spectators never receive raw fires (server-gated)
        // Resolve + reply + flip the turn IMMEDIATELY (B1): the shot result and turn
        // handback must NOT wait for the cosmetic missile flight, otherwise the
        // attacker stalls ~1s per shot and a throttled/backgrounded defender (whose
        // rAF is paused) could never fire onArrive — leaving the match wedged with
        // no result on the wire. The incoming missile is purely decorative now.
        incomingImpact = null;
        receiveIncomingFire(move.x, move.y); // sets incomingImpact (if a fresh shot)
        // The decorative missile's arrival plays the geyser/blast where it lands, so
        // the FX still lines up with the projectile — but if it's swallowed (already
        // fired cell, no impact recorded) nothing happens, and the state is already
        // committed regardless of whether the rAF ever advances.
        const impact = incomingImpact;
        incomingImpact = null;
        launchMissile(move.x, move.y, "ocean", incomingLaunchOrigin(),
          impact ? () => playImpact(impact.x, impact.y, "ocean", impact.outcome, impact.sunk, impact.orient) : null);
        return true;
      }
      case "result": {
        if (!validResult(move)) throw new GameDesync("battleship: invalid result");
        if (!mySide) return true;
        if (!pendingFire || pendingFire.x !== move.x || pendingFire.y !== move.y) {
          return false; // result for a shot we aren't waiting on — request resync
        }
        resolveMyResult(move.x, move.y, move.outcome, move.outcome === "sunk" ? move.sunk : null);
        return true;
      }
      default:
        return false;
    }
  }

  // ===========================================================================
  // applyState — render an AUTHORITATIVE PUBLIC snapshot. Idempotent. Contains
  // ONLY the public shot grids + statuses — NEVER any ship placement. NEVER
  // recomputes the local role/colour (no side-flip). state === null ⇒ fresh game.
  // ===========================================================================
  function applyState(state) {
    shells.length = 0;
    blooms.length = 0;
    fx.clear();
    missiles.clear();
    reticleLock = null; M.reticleBad.opacity = 0.95; // cancel any pending lock punch (P2 #10)
    clearReticle();
    for (const t of targetRings) group.remove(t); // shared material — don't dispose (I6)
    targetRings.length = 0;
    if (enemyLivePlate) { group.remove(enemyLivePlate); enemyLivePlate.geometry.dispose?.(); enemyLivePlate = null; }
    clearMarkers();
    clearLastShot(); // markers are about to be rebuilt; drop any stale last-shot halo (P2 #6)

    if (!state) {
      phase = "placement";
      first = null;
      winner = null;
      myTurn = false;
      pendingFire = null;
      ready.host = false;
      ready.guest = false;
      shots.host = [];
      shots.guest = [];
      tracking.host.clear();
      tracking.guest.clear();
      sunkBy.host.clear();
      sunkBy.guest.clear();
      myPlacements = [];
      placeIndex = 0;
      hoverCell = null;
      aimCol = aimRow = -1;
      myOcean = freshOceanState();
      incomingImpact = null;
      specShotKeys = new Set();
      panelFlash.host = panelFlash.guest = null;
      flourishFired = false;
      flourishQueue.length = 0;
      // SPECTATOR-ONLY: a reset reshuffles the deployment, so drop revealed fleets;
      // the seated players re-send them when they re-deploy.
      revealFleets.host = null;
      revealFleets.guest = null;
      rebuildHulls();
      rebuildRevealFleets();
      refreshPanels();
      refreshButtons();
      refreshGhost();
      refreshEnemyLive();
      refreshHud();
      return;
    }

    const prevPhase = phase;
    phase = state.phase === "playing" ? "playing" : state.phase === "over" ? "over" : "placement";
    // P3 #11: if a snapshot moves us OUT of "over" (a fresh game that didn't route
    // through applyState(null) first), re-arm the one-shot victory flourish so it can
    // replay. Resets normally pass null and clear it there; this is the latent guard.
    if (prevPhase === "over" && phase !== "over") {
      flourishFired = false;
      flourishQueue.length = 0;
    }
    first = state.first === "host" || state.first === "guest" ? state.first : null;
    winner = state.winner === "host" || state.winner === "guest" ? state.winner : null;
    ready.host = !!(state.ready && state.ready.host);
    ready.guest = !!(state.ready && state.ready.guest);

    for (const side of ["host", "guest"]) {
      shots[side] = [];
      tracking[side].clear();
      sunkBy[side].clear();
    }

    const srcShots = state.shots || {};
    // SPECTATOR FX diff (I7): collect shots that are NEW vs. the previously-rendered
    // snapshot; we only animate when exactly one new shot lands on a side.
    const nextSpecKeys = new Set();
    const specNew = { host: [], guest: [] };
    for (const side of ["host", "guest"]) {
      const list = Array.isArray(srcShots[side]) ? srcShots[side] : [];
      for (const s of list) {
        if (!inGrid(s.x, s.y)) continue;
        const outcome = s.outcome === "hit" || s.outcome === "sunk" ? s.outcome : "miss";
        const sunkId = outcome === "sunk" && SHIP_IDS.has(s.sunk) ? s.sunk : null;
        shots[side].push({ x: s.x, y: s.y, outcome, sunk: sunkId });
        tracking[side].set(s.x + "," + s.y, { outcome, sunk: sunkId });
        if (sunkId) sunkBy[side].add(sunkId);
        // From MY seat: my shots → enemy grid; opponent's → my ocean.
        if (mySide) {
          if (side === mySide) placeMarker(s.x, s.y, outcome, "enemy", enemyShotMarks);
          else placeMarker(s.x, s.y, outcome, "ocean", oceanShotMarks);
        } else {
          // Spectator (canonical frame): host's shots on the enemy grid, guest's
          // on the ocean grid — a fixed, layout-free view of both shot streams.
          placeMarker(s.x, s.y, outcome, side === "host" ? "enemy" : "ocean", side === "host" ? enemyShotMarks : oceanShotMarks);
          const key = side + ":" + s.x + "," + s.y;
          nextSpecKeys.add(key);
          if (!specShotKeys.has(key)) specNew[side].push({ x: s.x, y: s.y, outcome, sunk: sunkId });
        }
      }
    }

    // Spectator one-shot impact FX for a SINGLE freshly-added shot per side (I7).
    // Skip the bulk catch-up (a late joiner gets many new shots at once) so we
    // don't dump a wall of explosions. Cosmetic only — never touches state.
    if (!mySide && phase === "playing" && specShotKeys.size > 0) {
      for (const side of ["host", "guest"]) {
        if (specNew[side].length === 1) {
          const s = specNew[side][0];
          const which = side === "host" ? "enemy" : "ocean";
          playImpact(s.x, s.y, which, s.outcome, s.sunk, "horizontal");
          markLastShot(side, s.x, s.y, which); // last-shot halo (P2 #6)
          if (s.sunk) flashPanelRow(side, s.sunk);
        }
      }
    }
    if (!mySide) specShotKeys = nextSpecKeys;

    if (state.sunk) {
      for (const side of ["host", "guest"]) {
        const ids = Array.isArray(state.sunk[side]) ? state.sunk[side] : [];
        for (const id of ids) if (SHIP_IDS.has(id)) sunkBy[side].add(id);
      }
    }

    if (mySide && phase === "playing") {
      const mine = shots[mySide].length;
      const theirs = shots[oppSide].length;
      const computed = first === mySide ? mine <= theirs : mine < theirs;
      // B4: if we have a shot in flight whose result isn't yet reflected in THIS
      // snapshot, stay locked (keep pendingFire, myTurn=false) so a recovery/late
      // snapshot can't briefly re-enable a second shot before the result lands.
      if (pendingFire && !tracking[mySide].has(pendingFire.x + "," + pendingFire.y)) {
        myTurn = false; // keep pendingFire — the result is still outstanding
      } else {
        myTurn = computed;
        pendingFire = null;
      }
    } else {
      myTurn = false;
      pendingFire = null;
    }

    // I4: when a remote client first learns the game is over via this snapshot,
    // play the one-shot victory flourish (guarded inside winFlourish to fire once).
    if (phase === "over" && winner) winFlourish(winner);

    rebuildHulls();
    // SPECTATOR-ONLY: re-assert the revealed fleets after a snapshot repaint (a
    // seated player's revealFleets are empty, so this is a no-op for them).
    rebuildRevealFleets();
    refreshPanels();
    refreshButtons();
    refreshGhost();
    refreshEnemyLive();
    refreshHud();
  }

  // ===========================================================================
  // Snapshots — PUBLIC-ONLY. NEVER a ship placement.
  // ===========================================================================
  function snapshot() {
    return {
      phase,
      first,
      winner,
      turn: phase === "playing" ? currentFirer() : null,
      ready: { host: ready.host, guest: ready.guest },
      shots: {
        host: shots.host.map((s) => ({ x: s.x, y: s.y, outcome: s.outcome, ...(s.sunk ? { sunk: s.sunk } : {}) })),
        guest: shots.guest.map((s) => ({ x: s.x, y: s.y, outcome: s.outcome, ...(s.sunk ? { sunk: s.sunk } : {}) })),
      },
      sunk: { host: [...sunkBy.host], guest: [...sunkBy.guest] },
    };
  }

  function currentFirer() {
    if (!first) return null;
    const h = shots.host.length;
    const g = shots.guest.length;
    if (first === "host") return h <= g ? "host" : "guest";
    return g <= h ? "guest" : "host";
  }

  function publicState() { return snapshot(); }

  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* transport optional / non-host */ }
  }

  // ===========================================================================
  // Game over + end-of-game reveal
  // ===========================================================================
  function endGame(winnerSide, reason) {
    if (phase === "over") return;
    phase = "over";
    winner = winnerSide;
    myTurn = false;
    pendingFire = null;
    clearReticle();
    if (enemyLivePlate) { group.remove(enemyLivePlate); enemyLivePlate.geometry.dispose?.(); enemyLivePlate = null; }
    refreshButtons();
    refreshPanels();
    refreshHud();
    winFlourish(winnerSide); // celebratory ripples over the loser's grid (I4)
    try { ctx.onGameOver({ winner: winnerSide, reason: reason || "fleet-sunk" }); } catch { /* ignore */ }
    if (role === "host") pushSnapshot();
  }

  // I4 — a brief, cosmetic victory flourish: a handful of staggered blasts walking
  // across the LOSER's sunk cells (host/guest/spectator-safe; runs once per game).
  // The flourish never touches state — it's a one-shot timed ripple sequence.
  let flourishFired = false;
  const flourishQueue = []; // { x, y, which, at } pending ripples
  function winFlourish(winnerSide) {
    if (flourishFired || !winnerSide) return;
    flourishFired = true;
    const loser = winnerSide === "host" ? "guest" : "host";
    // The loser's grid in THIS view: seated → my ocean if I lost, else enemy grid;
    // spectator → host on enemy grid, guest on ocean grid (canonical frame).
    let which;
    if (mySide) which = loser === mySide ? "ocean" : "enemy";
    else which = loser === "host" ? "enemy" : "ocean";
    // Ripple across the cells where the loser's ships were hit/sunk (their shots
    // landed on the loser are tracked under tracking[winnerSide] — those are the
    // winner's shots on the loser). Fall back to a sweep if none are tracked.
    const cells = [];
    for (const [key, info] of tracking[winnerSide]) {
      if (info && (info.outcome === "hit" || info.outcome === "sunk")) {
        const [cx, cy] = key.split(",").map(Number);
        if (inGrid(cx, cy)) cells.push({ x: cx, y: cy });
      }
    }
    if (cells.length === 0) return;
    // Stagger the ripples so they read as a celebratory wave, not one big flash.
    const base = nowMs();
    cells.slice(0, 12).forEach((c, i) => flourishQueue.push({ x: c.x, y: c.y, which, at: base + i * 90 }));
    startLoop();
  }

  // Fire any due ripples from the win-flourish queue (I4). Cosmetic only.
  function stepFlourish() {
    if (flourishQueue.length === 0) return false;
    const t = nowMs();
    for (let i = flourishQueue.length - 1; i >= 0; i--) {
      const f = flourishQueue[i];
      if (t >= f.at) {
        _v3.set(cellX(f.x), SURF_Y, cellZView(f.y, f.which));
        fx.bigExplosion(_v3);
        flourishQueue.splice(i, 1);
      }
    }
    return flourishQueue.length > 0;
  }

  // (Removed the redundant {type:"reveal"} public-move send. The spectator fleet
  // reveal travels on the dedicated, fairness-gated sendReveal/applyReveal channel
  // — published from doReady() the moment a player deploys — so relaying the full
  // layout over the public move stream at end-of-game was both duplicative and a
  // hidden-info smell. P1 #2.)

  // ===========================================================================
  // Role / seat changes — switch in place. applyState NEVER recomputes role; only
  // setRole does, and a promoted player re-enters placement locally (empty ocean).
  // ===========================================================================
  function setRole(newRole, newSeatIndex) {
    const prev = mySide;
    role = newRole || "spectator";
    if (newSeatIndex !== undefined) ctx.seatIndex = newSeatIndex;
    mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
    oppSide = mySide === "host" ? "guest" : mySide === "guest" ? "host" : null;
    if (mySide !== prev) {
      if (!prev && mySide) {
        phase = phase === "over" ? "over" : "placement";
        myPlacements = [];
        placeIndex = 0;
        hoverCell = null;
        aimCol = aimRow = -1;
        myOcean = freshOceanState();
      }
    }
    applyFacing();
    rebuildHulls();
    refreshButtons();
    refreshPanels();
    refreshGhost();
    refreshEnemyLive();
    refreshHud();
    startLoop(); // re-sync the HUD billboard to the new facing even when idle (I9)
  }

  function setSeatRy(ry) {
    seatRy = ry;
    applyFacing();
    refreshEnemyLive();
    refreshGhost();
    refreshHud();
    startLoop(); // re-sync the HUD billboard to the new facing even when idle (I9)
  }

  // ===========================================================================
  // dispose — stop the loop, free GPU resources, drop the group.
  // ===========================================================================
  function dispose() {
    if (controlsHook) { try { controlsHook([], null); } catch { /* ignore */ } }
    if (fleetHook) { try { fleetHook([]); } catch { /* ignore */ } }
    if (rafId != null) { caf(rafId); rafId = null; }
    for (const b of blooms) { b.mesh.material?.dispose?.(); b.mesh.geometry?.dispose?.(); }
    shells.length = 0;
    blooms.length = 0;
    try { missiles.dispose(); } catch { /* ignore */ }
    try { fx.dispose(); } catch { /* ignore */ }
    if (enemyLivePlate) { group.remove(enemyLivePlate); enemyLivePlate.geometry.dispose?.(); enemyLivePlate = null; }
    if (laneMesh) { group.remove(laneMesh); laneMesh.geometry.dispose?.(); laneMesh = null; }
    for (const t of targetRings) group.remove(t); // M.targetShared disposed via M loop below
    targetRings.length = 0;
    // Last-shot halos: shared G.ring geometry, but each owns a cloned M.lastShot
    // material (P2 #6) — free those clones here.
    for (const side of ["host", "guest"]) {
      const h = lastShotHalos[side];
      if (h) { group.remove(h); h.material?.dispose?.(); lastShotHalos[side] = null; }
    }
    if (reticle) {
      // Parts share M.reticleOk/M.reticleBad (disposed via the M loop) — only free
      // the cloned geometry here, never the shared materials (I6).
      reticle.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
      group.remove(reticle);
      reticle = null;
    }
    clearGhost();
    clearMarkers();
    for (const h of hullMeshes) {
      h.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
    }
    hullMeshes.length = 0;
    for (const h of revealHullMeshes) {
      h.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
      group.remove(h);
    }
    revealHullMeshes.length = 0;
    for (const b of placeButtons) {
      b.mesh.traverse((c) => {
        if (c.geometry) c.geometry.dispose?.();
        if (c.material && c.material !== M.pillarGo && c.material !== M.pillarDim && c.material !== M.pillarIdle) c.material.dispose?.();
        if (c.userData && c.userData.tex) c.userData.tex.dispose?.();
      });
    }
    placeButtons.length = 0;
    for (const p of panels) {
      group.remove(p.mesh);
      p.mesh.geometry?.dispose?.();
      p.tex?.dispose?.();
      p.mesh.material?.dispose?.();
    }
    panels.length = 0;
    if (hudMesh) {
      group.remove(hudMesh);
      hudMesh.geometry?.dispose?.();
      hudMesh.userData?.tex?.dispose?.();
      hudMesh.material?.dispose?.();
      hudMesh = null;
    }
    if (group.parent) group.parent.remove(group);
    for (const g of Object.values(G)) g && g.dispose?.();
    for (const m of Object.values(M)) m && m.dispose?.();
  }

  // Initial paint.
  rebuildHulls();
  refreshButtons();
  refreshPanels();
  refreshGhost();
  refreshEnemyLive();
  refreshHud();
  startLoop(); // keep the HUD billboard tracking the camera

  return {
    group,
    orientPolicy: "self", // we rotate the group ourselves so each seat sees its OWN ocean near
    applyState,
    applyMove,
    applyReveal, // SPECTATOR-ONLY: render both revealed fleets (no-op for a seated player)
    onPointer,
    setHover, // hover crosshair reticle over enemy waters + ghost preview during placement
    publicState,
    setRole,
    setSeatRy,
    dispose,
    // Convenience for the framework/tests (not part of the required surface).
    isOurTurn: () => myTurnNow(),
  };
}

export default createGame;
