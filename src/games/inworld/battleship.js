// Battleship — in-world 3D table game module (createGame contract).
//
// A COMPLETE, fully self-contained ES module implementing the createGame()
// contract documented in ./createGame.js. The framework (board.js → InWorldBoard)
// owns the physical café table, the WebSocket relay (a per-room curried `net`),
// role/turn gating, and spectator read-only mode. THIS module owns ONLY the
// rules, the 3D geometry (real meshes parented to the café table), and per-cell
// hit-testing.
//
//   import { createGame } from "../inworld/battleship.js";
//   const instance = createGame(ctx);   // InWorldBoard.mount() does this
//
// ───────────────────────────────────────────────────────────────────────────
// CANDIDATE VARIATION #0 — "two clients, two oceans, owner-authoritative hits."
//
// The load-bearing design rule of Battleship is the PRIVATE/PUBLIC split: a
// player's fleet positions must NEVER cross the wire to anyone (opponent or
// spectator) while the game is live. This variation enforces that STRUCTURALLY:
//
//   1. EACH CLIENT OWNS ITS OCEAN, AND ITS OCEAN ALONE. The local seated player
//      keeps a private occupancy grid for their own fleet. A {fire,x,y} from the
//      attacker is resolved by the DEFENDER (the owning client) against its own
//      private grid; the defender replies with only {result,x,y,outcome,sunk?}.
//      No single "host authority" ever holds both fleets — there is no place a
//      leak could even originate, because no client ever has the enemy layout.
//      (Contrast checkers, where the host is authoritative over the whole board.)
//
//   2. publicState() EXPOSES ONLY THE TWO SHOT GRIDS — never a ship placement.
//      The spectator/newcomer snapshot is derived purely from the {x,y,outcome}
//      shot streams (white splash pegs for misses, red ember pegs for hits) plus
//      a fleet-status readout of which NAMED enemy ships are sunk. The hidden
//      hull meshes are spectator-invisible by construction; a passer-by replaying
//      the wire sees exactly the information each player legitimately has.
//
//   3. TWO 10×10 GRIDS PER SEAT, on a shared physical board: a near "YOUR OCEAN"
//      grid (your real ship hulls, visible only to you) and a far "ENEMY WATERS"
//      tracking grid (your shots). Targeting input is enabled ONLY on enemy
//      waters, ONLY while it is your turn in the playing phase, and ONLY on a
//      cell you have not already fired at. The framework's per-viewer
//      group.rotation.y means each seat reads its own ocean as the near grid.
//
//   4. PLACEMENT PHASE with a hovering ghost ship, click-to-rotate-then-place,
//      plus RANDOMIZE / CLEAR / READY surfaced as floating 3D buttons beside your
//      ocean. Ships may touch (allowTouching = true, matching the shipped game).
//      Ready-up commits your fleet locally and announces {ready} — never the
//      layout.
//
//   5. TORPEDO-ARC shots: firing lobs a small shell on a parabola from your edge
//      to the targeted enemy cell; on resolve it blooms a white splash ring
//      (miss) or a red ember burst (hit), and a completed sink flips that ship's
//      status chip to dead. A distinct, readable motion language.
//
// WIRE FORMAT (only shot coordinates + outcomes ever leave the device):
//   { type:"place", ready:true }                       // I have placed all ships
//   { type:"start", first:"host"|"guest" }             // host-only, once both ready
//   { type:"fire",  x, y }                             // a shot at enemy cell (x,y)
//   { type:"result", x, y, outcome:"miss"|"hit"|"sunk", sunk? } // defender's reply
//   { type:"reveal", layout }                          // END-OF-GAME ONLY: prove no cheat
// Ship layouts are LOCAL state; they are serialized ONLY in the post-game
// `reveal` (cosmetic verification), never in any live fire/result/snapshot.
//
// PUBLIC SNAPSHOT (publicState / applyState, spectator+opponent safe):
//   { phase, turn, first, winner, ready:{host,guest},
//     shots:{ host:[{x,y,outcome,sunk?}...], guest:[...] }, // per-firer shot log
//     sunk:{ host:[shipId...], guest:[shipId...] } }        // named ships sunk BY each firer
//   shots.host = shots host fired at the GUEST's ocean, and vice-versa. There is
//   no occupancy, no hull, no placement anywhere in this object — by design.
//
// Three.js style follows src/world/props.js: MeshStandardMaterial with
// roughness/metalness, shared geometry/materials created once and freed in
// dispose(), castShadow/receiveShadow on real meshes.

import { GameDesync } from "./createGame.js";

// ===========================================================================
// PURE RULES — extracted from the authoritative spec (index-CAbjjkeG.js):
// 10×10 grid (rt=10), 5-ship fleet (It / wd=17 cells), allowTouching default
// true, three outcomes (miss/hit/sunk), strict single-shot alternation. All
// transport-free so the module is self-contained.
// ===========================================================================
export const GRID = 10; // rt
export const FLEET = [
  { id: "carrier", name: "Carrier", length: 5 },
  { id: "battleship", name: "Battleship", length: 4 },
  { id: "cruiser", name: "Cruiser", length: 3 },
  { id: "submarine", name: "Submarine", length: 3 },
  { id: "destroyer", name: "Destroyer", length: 2 },
];
export const FLEET_CELLS = 17; // wd — total occupied cells across the fleet
const SHIP_BY_ID = new Map(FLEET.map((s) => [s.id, s]));
const SHIP_IDS = new Set(FLEET.map((s) => s.id));

export const inGrid = (x, y) => x >= 0 && x < GRID && y >= 0 && y < GRID; // di()
const idx = (x, y) => y * GRID + x; // pn()

// Expand a ship to its occupied cells (ao()): horizontal adds +n to x, vertical
// adds +n to y. Returns [{x,y}...] of length ship.length.
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

// occupancy[100] → ship id at each cell, or null. The private heart of a board.
export function occupancyOf(placements) {
  const occ = new Array(GRID * GRID).fill(null);
  for (const ship of placements) {
    for (const cell of shipCells(ship)) {
      if (inGrid(cell.x, cell.y)) occ[idx(cell.x, cell.y)] = ship.id;
    }
  }
  return occ;
}

// canPlace() — reject a duplicate ship id, any off-grid cell, or any overlap with
// an already-placed ship. allowTouching is true (the shipped default), so
// adjacency is NOT checked: touching ships are legal.
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

// randomFleet() — for each ship in fleet order, up to 1000 attempts to pick a
// random orientation + in-bounds origin and place if legal. Returns a fresh full
// placement array or null if it somehow failed (vanishingly unlikely).
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

// receiveFire(state,x,y) — the DEFENDER resolves a shot against its OWN private
// grid. Mutates `firedAt` / `hitCount`. Returns { outcome, sunk?, allSunk } or
// null if the shot is out of bounds or the cell was already fired (re-fire
// guard). This is the ONLY function that ever reads ship positions, and it runs
// only on the owning client.
export function receiveFire(state, x, y) {
  if (!inGrid(x, y)) return null; // "Shot out of bounds"
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

// Validate an inbound {result} so a malformed/cheating packet never poisons our
// tracking grid: outcome must be one of three; `sunk` must be a real ship id and
// only present for a sink.
export function validResult(msg) {
  if (!msg || !inGrid(msg.x, msg.y)) return false;
  if (msg.outcome !== "miss" && msg.outcome !== "hit" && msg.outcome !== "sunk") return false;
  if (msg.outcome === "sunk" && !SHIP_IDS.has(msg.sunk)) return false;
  if (msg.outcome !== "sunk" && msg.sunk != null) return false;
  return true;
}

// Validate a layout reveal (Dd-equivalent): exactly 5 ships, each a legal placement.
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
//
// The two 10×10 grids are stacked along Z so each seated player reads their own
// OCEAN as the near grid (larger +Z = nearer the viewer at canonical ry 0) and
// ENEMY WATERS as the far grid. col → local X, row(=y) → local Z within a grid.
// Canonical convention (matches createGame.js): row 0 / y 0 is the −Z edge.
// ===========================================================================
const PLAY = 0.66;          // overall board span across X (fits the ~0.7 m square)
const CELL = PLAY / GRID;   // one cell ≈ 0.066 m
const HALF = PLAY / 2;

const GRID_GAP = CELL * 1.1;        // gap between the two grids along Z
const GRID_SPAN = CELL * GRID;      // span of one 10×10 grid along Z
// Near grid (YOUR OCEAN) centred at +Z; far grid (ENEMY WATERS) at −Z.
const OCEAN_CZ = (GRID_SPAN + GRID_GAP) / 2;   // +Z centre of your ocean
const ENEMY_CZ = -(GRID_SPAN + GRID_GAP) / 2;  // −Z centre of enemy waters

const BASE_T = 0.012;       // board base panel thickness
const TILE_T = 0.004;       // water tile thickness
const SURF_Y = BASE_T;      // local Y of the water surface
const PEG_Y = SURF_Y + 0.006;

const HULL_H = CELL * 0.5;  // ship hull height above water
const HULL_Y = SURF_Y + HULL_H / 2;

// ===========================================================================
// THE MODULE
// ===========================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "battleship";

  let role = ctx.role;             // "host" | "guest" | "spectator"
  let seatRy = ctx.seatRy;
  // host fires at the guest's ocean and vice-versa. mySide / oppSide name the two
  // shot streams in the public snapshot.
  let mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
  let oppSide = mySide === "host" ? "guest" : mySide === "guest" ? "host" : null;

  // ── Phase / turn state ────────────────────────────────────────────────────
  let phase = "placement";   // "placement" | "playing" | "over"
  let myTurn = false;        // is it the local seated player's shot?
  let first = null;          // "host" | "guest" — who fired first (host-decided)
  let winner = null;         // "host" | "guest" | null
  const ready = { host: false, guest: false };

  // ── PRIVATE: my own fleet (NEVER serialized except in the post-game reveal) ──
  // placements: committed ship objects; occ/hitCount/firedAt are the live ocean.
  let myPlacements = [];
  let myOcean = freshOceanState();
  function freshOceanState() {
    return { occ: new Array(GRID * GRID).fill(null), firedAt: new Array(GRID * GRID).fill(false), hitCount: {} };
  }

  // ── PUBLIC: the two shot grids (the only cross-player truth) ────────────────
  // shots[side] = array of {x,y,outcome,sunk?} that `side` fired at the OTHER
  // ocean, in order. tracking[side] = Map "x,y" → {outcome,sunk?} for O(1) lookup
  // and re-fire prevention. sunkBy[side] = Set of ship ids `side` has sunk.
  const shots = { host: [], guest: [] };
  const tracking = { host: new Map(), guest: new Map() };
  const sunkBy = { host: new Set(), guest: new Set() };

  // Outstanding fire I sent and am awaiting a result for (re-fire lock).
  let pendingFire = null;

  // ── Placement-phase interaction state (local seated player only) ────────────
  let placeIndex = 0;                 // which fleet ship we're placing next
  let ghostOrient = "horizontal";     // current ghost orientation
  let hoverCell = null;               // {x,y} the ghost is hovering, or null

  // ===========================================================================
  // Shared materials + geometries (created once; freed in dispose()).
  // ===========================================================================
  const M = {
    base: new THREE.MeshStandardMaterial({ color: "#15314f", roughness: 0.85, metalness: 0.05 }),
    frame: new THREE.MeshStandardMaterial({ color: "#0c2036", roughness: 0.7, metalness: 0.2 }),
    oceanA: new THREE.MeshStandardMaterial({ color: "#1f5d86", roughness: 0.55, metalness: 0.1 }),
    oceanB: new THREE.MeshStandardMaterial({ color: "#23688f", roughness: 0.55, metalness: 0.1 }),
    enemyA: new THREE.MeshStandardMaterial({ color: "#13384d", roughness: 0.6, metalness: 0.1 }),
    enemyB: new THREE.MeshStandardMaterial({ color: "#173f56", roughness: 0.6, metalness: 0.1 }),
    hull: new THREE.MeshStandardMaterial({ color: "#5a636b", roughness: 0.5, metalness: 0.55 }),
    hullDeck: new THREE.MeshStandardMaterial({ color: "#3c444b", roughness: 0.6, metalness: 0.45 }),
    miss: new THREE.MeshStandardMaterial({ color: "#eef3f6", roughness: 0.5, metalness: 0.05 }),
    hit: new THREE.MeshStandardMaterial({ color: "#d8442c", roughness: 0.45, metalness: 0.1, emissive: "#5a1206", emissiveIntensity: 0.5 }),
    sunkMark: new THREE.MeshStandardMaterial({ color: "#8a1c0c", roughness: 0.5, metalness: 0.2, emissive: "#3a0a02", emissiveIntensity: 0.6 }),
    shell: new THREE.MeshStandardMaterial({ color: "#f0d28a", roughness: 0.4, metalness: 0.3, emissive: "#3a2a00", emissiveIntensity: 0.3 }),
    ghostOk: new THREE.MeshStandardMaterial({ color: "#4fd18a", roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.55, depthWrite: false }),
    ghostBad: new THREE.MeshStandardMaterial({ color: "#e2503c", roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.5, depthWrite: false }),
    target: new THREE.MeshBasicMaterial({ color: "#7fd1ff", transparent: true, opacity: 0.85, depthWrite: false }),
    aim: new THREE.MeshBasicMaterial({ color: "#7fd1ff", transparent: true, opacity: 0.5, depthWrite: false }),
    splash: new THREE.MeshBasicMaterial({ color: "#eef6ff", transparent: true, opacity: 0.9, depthWrite: false }),
    ember: new THREE.MeshBasicMaterial({ color: "#ff6a3c", transparent: true, opacity: 0.95, depthWrite: false }),
    btnIdle: new THREE.MeshStandardMaterial({ color: "#27506f", roughness: 0.5, metalness: 0.2, emissive: "#0a1c2a", emissiveIntensity: 0.4 }),
    btnGo: new THREE.MeshStandardMaterial({ color: "#2f8a5a", roughness: 0.45, metalness: 0.2, emissive: "#0c3320", emissiveIntensity: 0.6 }),
    invisible: new THREE.MeshBasicMaterial({ visible: false }),
    statusLive: new THREE.MeshStandardMaterial({ color: "#3a4750", roughness: 0.6, metalness: 0.3 }),
    statusDead: new THREE.MeshStandardMaterial({ color: "#8a1c0c", roughness: 0.5, metalness: 0.2, emissive: "#3a0a02", emissiveIntensity: 0.5 }),
  };

  const G = {
    tile: new THREE.BoxGeometry(CELL * 0.96, TILE_T, CELL * 0.96),
    hit: new THREE.BoxGeometry(CELL * 0.98, HULL_H * 1.4, CELL * 0.98), // per-cell collider
    peg: new THREE.CylinderGeometry(CELL * 0.18, CELL * 0.18, 0.018, 12),
    emberPeg: new THREE.SphereGeometry(CELL * 0.2, 12, 10),
    shell: new THREE.SphereGeometry(CELL * 0.12, 10, 8),
    ring: new THREE.TorusGeometry(CELL * 0.34, CELL * 0.05, 8, 22),
    btn: new THREE.BoxGeometry(CELL * 1.6, CELL * 0.5, CELL * 0.7),
    statusChip: new THREE.BoxGeometry(CELL * 0.7, CELL * 0.22, CELL * 0.22),
    hullBody: null,   // built per-ship (length-dependent), not pooled
  };

  // Per-cell local centre. Column → X; within a grid, row(=y) → local Z offset
  // from that grid's centre. `which` selects the ocean (+Z) or enemy (−Z) grid.
  function cellX(x) { return -HALF + (x + 0.5) * CELL; }
  function cellZ(y, which) {
    const cz = which === "ocean" ? OCEAN_CZ : ENEMY_CZ;
    return cz - GRID_SPAN / 2 + (y + 0.5) * CELL;
  }

  // ── Live scene bookkeeping ──────────────────────────────────────────────────
  const hullMeshes = [];            // my own ship hull meshes (private; on my ocean)
  const oceanShotMarks = new Map(); // "x,y" → mesh on my ocean (enemy shots at me)
  const enemyShotMarks = new Map(); // "x,y" → mesh on enemy waters (my shots)
  let ghostMesh = null;             // hovering placement ghost
  const placeButtons = [];          // floating 3D placement buttons
  const targetRings = [];           // bobbing aim targets on enemy waters (my turn)
  let aimPlate = null;
  const statusChips = { host: [], guest: [] }; // fleet-status chips per enemy fleet

  buildStaticBoard();
  buildColliders();
  buildStatusChips();

  // ===========================================================================
  // Static geometry: a base panel + two 10×10 water grids + a frame band, plus
  // floating placement buttons (only meaningful in the placement phase).
  // ===========================================================================
  function buildStaticBoard() {
    const baseW = PLAY + CELL * 0.5;
    const baseD = GRID_SPAN * 2 + GRID_GAP + CELL * 0.7;
    const base = new THREE.Mesh(new THREE.BoxGeometry(baseW, BASE_T, baseD), M.base);
    base.position.set(0, BASE_T / 2, 0);
    base.receiveShadow = true;
    group.add(base);

    // Water tiles for both grids; checker the two ocean shades for readability.
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

    // A thin frame band around each grid so the two oceans read as distinct.
    for (const which of ["ocean", "enemy"]) {
      const cz = which === "ocean" ? OCEAN_CZ : ENEMY_CZ;
      const fw = GRID_SPAN + CELL * 0.18;
      const t = CELL * 0.12;
      const h = HULL_H * 0.4;
      const fy = SURF_Y + h / 2 - 0.001;
      const rails = [
        [new THREE.BoxGeometry(fw, h, t), 0, cz - GRID_SPAN / 2 - t / 2],
        [new THREE.BoxGeometry(fw, h, t), 0, cz + GRID_SPAN / 2 + t / 2],
        [new THREE.BoxGeometry(t, h, GRID_SPAN + t * 2), -HALF - t / 2, cz],
        [new THREE.BoxGeometry(t, h, GRID_SPAN + t * 2), HALF + t / 2, cz],
      ];
      for (const [geo, x, z] of rails) {
        const rail = new THREE.Mesh(geo, M.frame);
        rail.position.set(x, fy, z);
        rail.castShadow = true;
        rail.receiveShadow = true;
        group.add(rail);
      }
    }

    buildPlaceButtons();
  }

  // Floating placement buttons beside your ocean: Rotate, Random, Clear, Ready.
  // Each carries userData.btn so onPointer can dispatch on a hit.
  function buildPlaceButtons() {
    const defs = [
      { btn: "rotate", mat: M.btnIdle },
      { btn: "random", mat: M.btnIdle },
      { btn: "clear", mat: M.btnIdle },
      { btn: "ready", mat: M.btnGo },
    ];
    const bx = HALF + CELL * 1.4; // to the +X side of the board
    const startZ = OCEAN_CZ - GRID_SPAN / 2 + CELL * 0.6;
    defs.forEach((d, i) => {
      const m = new THREE.Mesh(G.btn, d.mat.clone());
      m.position.set(bx, SURF_Y + CELL * 0.3, startZ + i * CELL * 0.95);
      m.castShadow = true;
      m.userData.btn = d.btn;
      group.add(m);
      placeButtons.push(m);
    });
    refreshButtonsVisibility();
  }

  function refreshButtonsVisibility() {
    const show = phase === "placement" && !!mySide && !ready[mySide];
    for (const b of placeButtons) b.visible = show;
  }

  // Per-cell invisible colliders over BOTH grids, tagged with their {r,c, which}
  // so the framework's _resolveCell can walk up to userData.cell — empty water is
  // reliably clickable. We encode the grid into the cell so onPointer knows
  // whether a click targets your ocean (placement) or enemy waters (firing).
  function buildColliders() {
    for (const which of ["ocean", "enemy"]) {
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const box = new THREE.Mesh(G.hit, M.invisible);
          box.position.set(cellX(x), SURF_Y + HULL_H * 0.3, cellZ(y, which));
          box.userData.cell = { r: y, c: x, which };
          group.add(box);
        }
      }
    }
  }

  // Fleet-status chips: a small chip per enemy ship near the enemy-waters grid,
  // flipping from "live" grey to "dead" red as that ship is reported sunk. A
  // seated player renders chips for the enemy fleet they are sinking; a spectator
  // renders both fleets' chips flanking the enemy grid.
  function buildStatusChips() {
    const makeRow = (firer, baseX, baseZ) => {
      FLEET.forEach((spec, i) => {
        const chip = new THREE.Mesh(G.statusChip, M.statusLive.clone());
        chip.position.set(baseX, SURF_Y + CELL * 0.18, baseZ + i * CELL * 0.34);
        chip.castShadow = true;
        chip.userData.firer = firer;
        chip.userData.shipId = spec.id;
        group.add(chip);
        statusChips[firer].push(chip);
      });
    };
    const z0 = ENEMY_CZ - GRID_SPAN / 2 + CELL * 0.4;
    if (mySide) {
      makeRow(mySide, HALF + CELL * 1.3, z0);
    } else {
      makeRow("host", HALF + CELL * 1.3, z0);
      makeRow("guest", -HALF - CELL * 1.3, z0);
    }
  }

  // ===========================================================================
  // Animation loop (internal rAF; idles to zero cost when nothing moves). Pools:
  //   shells  : torpedo arcs in flight
  //   blooms  : splash rings / ember bursts expanding then fading
  // plus a steady bob/spin for the aim targets during your turn.
  // ===========================================================================
  const shells = [];
  const blooms = [];
  let rafId = null;
  let lastT = 0;
  let idleT = 0;
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const raf = (fn) => (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(fn) : setTimeout(() => fn(nowMs()), 16));
  const caf = (id) => (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(id) : clearTimeout(id));
  const easeOut = (x) => 1 - (1 - x) * (1 - x);

  function loopActive() {
    return shells.length > 0 || blooms.length > 0 || targetRings.length > 0;
  }
  function startLoop() {
    if (rafId != null) return;
    lastT = nowMs();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
      lastT = t;
      stepAnim(dt);
      rafId = loopActive() ? raf(tick) : null;
    };
    rafId = raf(tick);
  }

  function stepAnim(dt) {
    // Torpedo shells: parabolic arc from a launch edge to the target cell. On
    // landing, fire the deferred onLand callback (which resolves the shot).
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
    // Blooms: a ring/burst that scales up while fading out, then is freed.
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
    // Idle motion for the aim targets (your turn on enemy waters).
    if (targetRings.length > 0) {
      idleT += dt;
      const bob = Math.sin(idleT * 3.2) * CELL * 0.06;
      for (const t of targetRings) {
        t.position.y = t.userData.baseY + bob;
        t.rotation.z = idleT * 2.0;
        t.material.opacity = 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(idleT * 4));
      }
    }
  }

  // Launch a torpedo shell arcing to a cell on a grid; onLand fires at touchdown.
  function launchShell(targetX, targetY, which, fromZEdge, onLand) {
    const tx = cellX(targetX);
    const tz = cellZ(targetY, which);
    const shell = new THREE.Mesh(G.shell, M.shell);
    shell.castShadow = true;
    shells.push({
      mesh: shell,
      from: { x: tx, z: fromZEdge },
      to: { x: tx, z: tz },
      baseY: SURF_Y + CELL * 0.2,
      arc: CELL * 2.2,
      t: 0,
      dur: 0.42,
      onLand,
    });
    group.add(shell);
    startLoop();
  }

  // A bloom (splash ring for miss, ember burst for hit/sunk) at a grid position.
  // Clones geometry/material so it can be freed independently when it expires.
  function spawnBloom(x, z, outcome) {
    const isHit = outcome === "hit" || outcome === "sunk";
    const geo = isHit ? G.emberPeg.clone() : G.ring.clone();
    const mesh = new THREE.Mesh(geo, (isHit ? M.ember : M.splash).clone());
    if (!isHit) mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, SURF_Y + CELL * 0.18, z);
    mesh.renderOrder = 4;
    group.add(mesh);
    blooms.push({ mesh, t: 0, dur: 0.55, grow: isHit ? 2.4 : 2.0, peak: isHit ? 0.95 : 0.9 });
    startLoop();
  }

  // ===========================================================================
  // Markers — the persistent pegs that encode the public shot grids.
  // ===========================================================================
  // Put a marker on a grid for one shot. `which`="ocean" for enemy shots landing
  // on MY ocean; "enemy" for MY shots on enemy waters. mapStore selects the map.
  function placeMarker(x, y, outcome, which, mapStore) {
    const key = x + "," + y;
    if (mapStore.has(key)) return; // idempotent (snapshot replays)
    let mesh;
    if (outcome === "miss") {
      mesh = new THREE.Mesh(G.peg, M.miss);
      mesh.position.set(cellX(x), PEG_Y, cellZ(y, which));
    } else {
      mesh = new THREE.Mesh(G.emberPeg, outcome === "sunk" ? M.sunkMark : M.hit);
      mesh.position.set(cellX(x), PEG_Y + CELL * 0.06, cellZ(y, which));
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

  // ===========================================================================
  // Hull rendering — MY ships only, on MY ocean. These meshes are visible only to
  // the local seated player; they are NEVER created for spectators and their
  // positions never enter any snapshot or wire message.
  // ===========================================================================
  function buildHull(ship) {
    const spec = SHIP_BY_ID.get(ship.id);
    const len = spec.length;
    const g = new THREE.Group();
    const along = len * CELL * 0.86;
    const wide = CELL * 0.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(along, HULL_H * 0.7, wide), M.hull);
    body.position.y = HULL_H * 0.35;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(along * 0.3, HULL_H * 0.5, wide * 0.55), M.hullDeck);
    deck.position.set(-along * 0.12, HULL_H * 0.85, 0);
    deck.castShadow = true;
    g.add(deck);

    // Position the hull spanning its cells. Horizontal runs along X; vertical
    // along Z (rotate 90°). Centre on the midpoint of the occupied cells.
    const cells = shipCells(ship);
    const a = cells[0];
    const b = cells[cells.length - 1];
    const cx = (cellX(a.x) + cellX(b.x)) / 2;
    const cz = (cellZ(a.y, "ocean") + cellZ(b.y, "ocean")) / 2;
    g.position.set(cx, HULL_Y, cz);
    if (ship.orientation === "vertical") g.rotation.y = Math.PI / 2;
    g.userData.shipId = ship.id;
    return g;
  }

  function rebuildHulls() {
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
    }
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

  // Build/refresh the hovering ghost for the ship currently being placed, at the
  // hovered origin with the current orientation, coloured by legality.
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
    group.add(g);
    ghostMesh = g;
  }

  // Try to commit the ghost as a real placement at (x,y) with the current
  // orientation. Returns true if placed.
  function tryPlaceAt(x, y) {
    const spec = currentSpec();
    if (!spec) return false;
    const ship = { id: spec.id, name: spec.name, length: spec.length, x, y, orientation: ghostOrient };
    if (!canPlace(myPlacements, ship)) return false;
    myPlacements.push(ship);
    placeIndex = myPlacements.length;
    rebuildHulls();
    refreshGhost();
    return true;
  }

  function doRandomize() {
    const fleet = randomFleet();
    if (!fleet) return;
    myPlacements = fleet;
    placeIndex = FLEET.length;
    rebuildHulls();
    refreshGhost();
  }

  // Place only the ships not yet placed, leaving manual ones intact (the "Ready"
  // button auto-completes a partial fleet before committing).
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
  }

  function doClear() {
    myPlacements = [];
    placeIndex = 0;
    rebuildHulls();
    refreshGhost();
  }

  // Ready up: lock the fleet into the private ocean state and announce {ready}.
  // The layout itself is NEVER sent — only the boolean.
  function doReady() {
    if (!isComplete(myPlacements) || !mySide) return;
    myOcean = freshOceanState();
    myOcean.occ = occupancyOf(myPlacements);
    ready[mySide] = true;
    clearGhost();
    refreshButtonsVisibility();
    try { ctx.net.sendMove({ type: "place", ready: true }); } catch { /* transport optional */ }
    maybeStart();
    pushSnapshot();
  }

  // Host decides who fires first once BOTH sides are ready (coin flip), announces
  // {start, first}, and sets local turn. Guests learn `first` via applyMove.
  function maybeStart() {
    if (phase !== "placement") return;
    if (!ready.host || !ready.guest) return;
    if (role !== "host") return; // only the host decides + broadcasts the start
    first = Math.random() < 0.5 ? "host" : "guest";
    phase = "playing";
    myTurn = first === "host";
    try { ctx.net.sendMove({ type: "start", first }); } catch { /* transport optional */ }
    refreshAim();
    pushSnapshot();
  }

  // ===========================================================================
  // Firing — the seated player taps an enemy-waters cell. Single shot, strictly
  // alternating; a hit does NOT grant a second shot. We lock input the instant we
  // fire (myTurn=false, pendingFire set) and only restore the turn once the
  // defender's {result} fully resolves and the opponent's incoming shot lands.
  // ===========================================================================
  function canFireAt(x, y) {
    if (phase !== "playing" || !mySide) return false;
    if (!myTurn || pendingFire) return false;
    if (!ctx.isLocalTurnAllowed()) return false;
    if (!inGrid(x, y)) return false;
    if (tracking[mySide].has(x + "," + y)) return false; // already fired here
    return true;
  }

  function fireAt(x, y) {
    if (!canFireAt(x, y)) return;
    pendingFire = { x, y };
    myTurn = false;
    clearAim();
    // Visual torpedo at the enemy-waters grid, launched from our near edge.
    const fromZ = ENEMY_CZ + GRID_SPAN / 2 + CELL * 0.8;
    launchShell(x, y, "enemy", fromZ, null);
    try { ctx.net.sendMove({ type: "fire", x, y }); } catch { /* transport optional */ }
  }

  // Record MY shot's result on the enemy-waters tracking grid + status chips, and
  // detect victory (all five enemy ships sunk). Called when the defender's
  // {result} arrives (applyMove) for a shot I fired.
  function resolveMyResult(x, y, outcome, sunkId) {
    const key = x + "," + y;
    tracking[mySide].set(key, { outcome, sunk: sunkId });
    shots[mySide].push({ x, y, outcome, sunk: sunkId });
    placeMarker(x, y, outcome, "enemy", enemyShotMarks);
    spawnBloom(cellX(x), cellZ(y, "enemy"), outcome);
    if (outcome === "sunk" && sunkId) {
      sunkBy[mySide].add(sunkId);
      markStatusChip(mySide, sunkId);
    }
    pendingFire = null;
    if (sunkBy[mySide].size === FLEET.length) {
      endGame(mySide, "fleet-sunk");
      sendReveal(); // prove my own fleet for the loser's verification
      return;
    }
    // The turn now passes to the opponent; it returns to me only after their
    // incoming {fire} lands and resolves (receiveIncomingFire sets myTurn=true).
  }

  // The opponent fired at MY ocean: resolve against my PRIVATE grid, mark it,
  // reply with only the outcome, then it becomes my turn again.
  function receiveIncomingFire(x, y) {
    if (phase !== "playing") return;
    const res = receiveFire(myOcean, x, y);
    if (!res) return; // out of bounds or duplicate — ignore, don't desync
    shots[oppSide].push({ x, y, outcome: res.outcome, sunk: res.sunk });
    tracking[oppSide].set(x + "," + y, { outcome: res.outcome, sunk: res.sunk });
    placeMarker(x, y, res.outcome, "ocean", oceanShotMarks);
    spawnBloom(cellX(x), cellZ(y, "ocean"), res.outcome);
    if (res.outcome === "sunk" && res.sunk) sunkBy[oppSide].add(res.sunk);

    // Reply with ONLY the shot's outcome — never any ship position.
    const reply = { type: "result", x, y, outcome: res.outcome };
    if (res.outcome === "sunk") reply.sunk = res.sunk;
    try { ctx.net.sendMove(reply); } catch { /* transport optional */ }

    if (res.allSunk) {
      // The opponent just sank my last ship — they win. Reveal my layout so they
      // can verify I didn't cheat (cosmetic, end-of-game only).
      endGame(oppSide, "fleet-sunk");
      sendReveal();
      return;
    }
    // Now it's my turn to fire.
    myTurn = true;
    refreshAim();
  }

  // ===========================================================================
  // Aim affordances — bobbing target rings on every un-fired enemy cell, plus a
  // soft aim plate, ONLY on my turn in the playing phase. Spectators / off-turn
  // see nothing.
  // ===========================================================================
  function myTurnNow() {
    return phase === "playing" && !!mySide && myTurn && !pendingFire && ctx.isLocalTurnAllowed();
  }

  function refreshAim() {
    clearAim();
    if (!myTurnNow()) return;
    aimPlate = new THREE.Mesh(new THREE.BoxGeometry(GRID_SPAN + CELL * 0.2, 0.001, GRID_SPAN + CELL * 0.2), M.aim);
    aimPlate.position.set(0, SURF_Y + 0.0015, ENEMY_CZ);
    aimPlate.renderOrder = 1;
    group.add(aimPlate);
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (tracking[mySide].has(x + "," + y)) continue;
        const ring = new THREE.Mesh(G.ring, M.target.clone());
        ring.rotation.x = Math.PI / 2;
        const baseY = SURF_Y + CELL * 0.14;
        ring.position.set(cellX(x), baseY, cellZ(y, "enemy"));
        ring.userData.baseY = baseY;
        ring.renderOrder = 3;
        group.add(ring);
        targetRings.push(ring);
      }
    }
    startLoop();
  }

  function clearAim() {
    for (const t of targetRings) {
      group.remove(t);
      t.material.dispose?.();
    }
    targetRings.length = 0;
    if (aimPlate) { group.remove(aimPlate); aimPlate.geometry.dispose?.(); aimPlate = null; }
  }

  // ===========================================================================
  // Fleet-status chips
  // ===========================================================================
  function markStatusChip(firer, shipId) {
    const chip = statusChips[firer]?.find((c) => c.userData.shipId === shipId);
    if (chip) chip.material = M.statusDead;
  }

  function refreshStatusChips() {
    for (const firer of ["host", "guest"]) {
      for (const chip of statusChips[firer]) {
        chip.material = sunkBy[firer].has(chip.userData.shipId) ? M.statusDead : M.statusLive;
      }
    }
  }

  // ===========================================================================
  // onPointer — the seated player clicked a resolved board cell. Behaviour
  // depends on phase and which grid was hit (encoded in cell.which):
  //   placement: click YOUR ocean to place/rotate the current ship; click a
  //              floating button to rotate/randomize/clear/ready.
  //   playing  : click ENEMY waters to fire (if it's your turn, cell un-fired).
  // ===========================================================================
  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed()) return; // spectators + game-over: inert

    // Button clicks (placement controls) — dispatch on the tagged object first.
    const btn = buttonFromHit(hit);
    if (btn && phase === "placement" && mySide && !ready[mySide]) {
      if (btn === "rotate") { ghostOrient = ghostOrient === "horizontal" ? "vertical" : "horizontal"; refreshGhost(); }
      else if (btn === "random") doRandomize();
      else if (btn === "clear") doClear();
      else if (btn === "ready") { if (isComplete(myPlacements)) doReady(); else doAutoRemaining(); }
      return;
    }

    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.r) || !Number.isInteger(cell.c)) return;
    const x = cell.c, y = cell.r;        // c = column = x; r = row = y
    if (!inGrid(x, y)) return;

    if (phase === "placement") {
      if (!mySide || ready[mySide]) return;
      if (cell.which !== "ocean") return; // only your ocean is placeable
      if (hoverCell && hoverCell.x === x && hoverCell.y === y && ghostMesh) {
        // Re-clicking the same hovered origin: place; if blocked, rotate in place.
        if (!tryPlaceAt(x, y)) {
          ghostOrient = ghostOrient === "horizontal" ? "vertical" : "horizontal";
          refreshGhost();
        }
      } else {
        hoverCell = { x, y };
        if (!tryPlaceAt(x, y)) refreshGhost();
      }
      return;
    }

    if (phase === "playing") {
      if (cell.which !== "enemy") return; // only fire on enemy waters
      fireAt(x, y);
    }
  }

  // Walk up from a raycast hit to a button-tagged ancestor.
  function buttonFromHit(hit) {
    let o = hit && hit.object;
    while (o && o !== group) {
      if (o.userData && o.userData.btn) return o.userData.btn;
      o = o.parent;
    }
    return null;
  }

  // ===========================================================================
  // applyMove — apply ONE relayed message from the opponent/host. Validates
  // against local rules; on a structural mismatch THROWS GameDesync (the
  // contract's explicit resync signal) so the framework re-seeds from authority.
  // ===========================================================================
  function applyMove(move, byRole) {
    if (!move || typeof move !== "object") return false;
    switch (move.type) {
      case "place": {
        const them = byRole === "host" ? "host" : byRole === "guest" ? "guest" : oppSide;
        if (them) ready[them] = true;
        refreshButtonsVisibility();
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
        refreshButtonsVisibility();
        refreshAim();
        pushSnapshot();
        return true;
      }
      case "fire": {
        if (phase !== "playing") throw new GameDesync("battleship: fire before play");
        if (!mySide) return true; // spectators never receive raw fires (server-gated)
        // Visual incoming arc, then resolve at touchdown against my private grid.
        const fromZ = OCEAN_CZ - GRID_SPAN / 2 - CELL * 0.8;
        launchShell(move.x, move.y, "ocean", fromZ, () => receiveIncomingFire(move.x, move.y));
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
      case "reveal": {
        // End-of-game layout reveal (cosmetic verification). We don't render the
        // opponent fleet, but we accept + validate it so the protocol round-trips.
        validLayout(move.layout); // verified-or-not; harmless either way
        return true;
      }
      default:
        return false;
    }
  }

  // ===========================================================================
  // applyState — render an AUTHORITATIVE PUBLIC snapshot. Idempotent (rebuild
  // from scratch). This is the catch-up primitive for spectators, newcomers, the
  // guest's first paint, and desync recovery. It contains ONLY the public shot
  // grids + statuses — NEVER any ship placement. state === null ⇒ fresh game.
  // ===========================================================================
  function applyState(state) {
    // Cancel in-flight animation; the snapshot is the source of truth now.
    shells.length = 0;
    blooms.length = 0;
    clearAim();
    clearMarkers();

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
      // A reset is a brand-new game: clear my fleet too so I re-place.
      myPlacements = [];
      placeIndex = 0;
      hoverCell = null;
      myOcean = freshOceanState();
      rebuildHulls();
      refreshStatusChips();
      refreshButtonsVisibility();
      refreshGhost();
      refreshAim();
      return;
    }

    // Decode the public snapshot.
    phase = state.phase === "playing" ? "playing" : state.phase === "over" ? "over" : "placement";
    first = state.first === "host" || state.first === "guest" ? state.first : null;
    winner = state.winner === "host" || state.winner === "guest" ? state.winner : null;
    ready.host = !!(state.ready && state.ready.host);
    ready.guest = !!(state.ready && state.ready.guest);

    // Reset then replay the shot streams onto the tracking grids + markers.
    for (const side of ["host", "guest"]) {
      shots[side] = [];
      tracking[side].clear();
      sunkBy[side].clear();
    }

    const srcShots = state.shots || {};
    for (const side of ["host", "guest"]) {
      const list = Array.isArray(srcShots[side]) ? srcShots[side] : [];
      for (const s of list) {
        if (!inGrid(s.x, s.y)) continue;
        const outcome = s.outcome === "hit" || s.outcome === "sunk" ? s.outcome : "miss";
        const sunkId = outcome === "sunk" && SHIP_IDS.has(s.sunk) ? s.sunk : null;
        shots[side].push({ x: s.x, y: s.y, outcome, sunk: sunkId });
        tracking[side].set(s.x + "," + s.y, { outcome, sunk: sunkId });
        if (sunkId) sunkBy[side].add(sunkId);
        // host's shots land on the GUEST's ocean (= the host's enemy waters) and
        // vice-versa. From MY seat: my shots → enemy grid; opponent's → my ocean.
        if (mySide) {
          if (side === mySide) placeMarker(s.x, s.y, outcome, "enemy", enemyShotMarks);
          else placeMarker(s.x, s.y, outcome, "ocean", oceanShotMarks);
        } else {
          // Spectator (canonical frame): host's shots on the enemy grid, guest's
          // on the ocean grid — a fixed, layout-free view of both shot streams.
          placeMarker(s.x, s.y, outcome, side === "host" ? "enemy" : "ocean", side === "host" ? enemyShotMarks : oceanShotMarks);
        }
      }
    }

    // Trust an explicit sunk list if present (authoritative over inference).
    if (state.sunk) {
      for (const side of ["host", "guest"]) {
        const ids = Array.isArray(state.sunk[side]) ? state.sunk[side] : [];
        for (const id of ids) if (SHIP_IDS.has(id)) sunkBy[side].add(id);
      }
    }

    // Restore my turn flag from the public shot counts + first-mover (no private
    // info needed): it's my turn iff I've fired no more than the opponent when I
    // go first, or strictly fewer when I go second.
    if (mySide && phase === "playing") {
      const mine = shots[mySide].length;
      const theirs = shots[oppSide].length;
      myTurn = first === mySide ? mine <= theirs : mine < theirs;
      pendingFire = null;
    } else {
      myTurn = false;
    }

    // My own placements are private and not part of any snapshot; keep whatever I
    // have locally. Re-render hulls (only if seated) and re-gate affordances.
    rebuildHulls();
    refreshStatusChips();
    refreshButtonsVisibility();
    refreshGhost();
    refreshAim();
  }

  // ===========================================================================
  // Snapshots — PUBLIC-ONLY. The shot grids + readiness + statuses. NEVER a ship
  // placement. This is both publicState() and what the host pushes via sendState.
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

  // Whose shot is it, derived purely from the public shot counts + first-mover.
  function currentFirer() {
    if (!first) return null;
    const h = shots.host.length;
    const g = shots.guest.length;
    if (first === "host") return h <= g ? "host" : "guest";
    return g <= h ? "guest" : "host";
  }

  function publicState() { return snapshot(); }

  // Host-only authoritative push (the framework gates non-hosts). full === pub
  // here BY DESIGN: there is no private board in the public snapshot, so the same
  // leak-free object serves host, guest, and spectators alike.
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
    clearAim();
    refreshButtonsVisibility();
    ctx.onGameOver({ winner: winnerSide, reason: reason || "fleet-sunk" });
    if (role === "host") pushSnapshot();
  }

  // Post-game ONLY: reveal my layout so the opponent can verify I didn't move
  // ships. This is the FIRST and ONLY time my placements cross the wire, after
  // the game is already decided. Sent as a relayed move (opponent-only;
  // spectators never receive raw moves for a hidden-info game — server-gated).
  function sendReveal() {
    if (!mySide || myPlacements.length !== FLEET.length) return;
    const layout = myPlacements.map((s) => ({ id: s.id, x: s.x, y: s.y, orientation: s.orientation }));
    try { ctx.net.sendMove({ type: "reveal", layout }); } catch { /* transport optional */ }
  }

  // ===========================================================================
  // Role / seat changes — switch in place. A spectator who sits is promoted via
  // setRole; a spectator never held a private fleet, so a promoted player
  // re-enters the placement phase locally (their ocean starts empty). The
  // framework re-applies group.rotation.y on setSeatRy.
  // ===========================================================================
  function setRole(newRole) {
    const prev = mySide;
    role = newRole || "spectator";
    mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
    oppSide = mySide === "host" ? "guest" : mySide === "guest" ? "host" : null;
    if (mySide !== prev) {
      // Spectator → seated (or vice-versa): rebuild seat-specific affordances.
      if (!prev && mySide) {
        // Newly seated: start fresh placement; my ocean is empty.
        phase = phase === "over" ? "over" : "placement";
        myPlacements = [];
        placeIndex = 0;
        hoverCell = null;
        myOcean = freshOceanState();
      }
    }
    rebuildHulls();
    refreshButtonsVisibility();
    refreshStatusChips();
    refreshGhost();
    refreshAim();
  }
  function setSeatRy(ry) {
    seatRy = ry;
    refreshAim();
    refreshGhost();
  }

  // ===========================================================================
  // dispose — stop the loop, free GPU resources, drop the group.
  // ===========================================================================
  function dispose() {
    if (rafId != null) { caf(rafId); rafId = null; }
    // Free per-instance bloom geometry/material clones still in flight.
    for (const b of blooms) { b.mesh.material?.dispose?.(); b.mesh.geometry?.dispose?.(); }
    shells.length = 0;
    blooms.length = 0;
    clearAim();
    clearGhost();
    clearMarkers();
    for (const h of hullMeshes) {
      h.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
    }
    hullMeshes.length = 0;
    if (group.parent) group.parent.remove(group);
    for (const g of Object.values(G)) g && g.dispose?.();
    for (const m of Object.values(M)) m.dispose?.();
  }

  // Initial paint.
  rebuildHulls();
  refreshButtonsVisibility();
  refreshStatusChips();
  refreshGhost();
  refreshAim();

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
    isOurTurn: () => myTurnNow(),
  };
}

export default createGame;
