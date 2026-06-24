// Battleship — in-world 3D table game module (createGame contract).
//
// CANDIDATE VARIATION #7 — "self-oriented dual ocean, billboard HUD."
//
// A COMPLETE, self-contained ES module implementing createGame(ctx) → GameInstance
// per ./createGame.js. The framework (board.js → InWorldBoard) owns the café table,
// the per-room `net` relay, role/turn gating and spectator read-only mode. THIS
// module owns the rules, the 3D geometry (meshes parented to the table group) and
// per-cell hit-testing.
//
// WHAT THIS VARIATION FIXES vs the broken module:
//
//   (1) SIDES WERE SWAPPED. The canonical near edge of a board (the one the
//       framework rotates toward the local seat) is row 0 / −Z (see createGame.js
//       and the other modules, e.g. checkers). The broken module authored YOUR
//       OCEAN at +Z (FAR) and ENEMY WATERS at −Z (NEAR) — so your fleet landed on
//       the far grid and you were aiming at your own ocean. Here YOUR OCEAN is at
//       the near −Z edge and ENEMY WATERS at the far +Z edge, so you place ships in
//       front of you and fire across the table.
//
//   (2) BOTH SEATS MUST SEE THEIR OWN OCEAN NEAREST. Host and guest sit on OPPOSITE
//       chairs. We declare orientPolicy:"self" (board.js then does NOT rotate the
//       group) and rotate the group OURSELVES by orientFor(seatRy) ALONE. Because
//       each client renders with its OWN seatRy, orientFor() brings THAT seat's own
//       near edge (local −Z ocean, authored once) to the front for everyone:
//       host orientFor(0)=0 keeps −Z near; guest orientFor(~PI)=PI maps local −Z to
//       world +Z, nearest the guest. No extra per-role PI is added — that would
//       double-count the opposite seat and flip the guest into the host's frame.
//       So host sees host-blue ocean near, guest sees guest-amber ocean near,
//       opponent across — and applyState NEVER recomputes role/colour from the wire
//       (no side-flip).
//
//   (3) A REAL, ALWAYS-ON HUD. A floating billboard placard above the board states
//       the phase ("Place your fleet" / "YOUR TURN — fire!" / "Waiting for opponent"
//       / win-lose), the ships-remaining count, and the rotate/ready hint during
//       placement. In-world status chips track each enemy ship sunk. If the host
//       provides an optional ctx.onHud(text) callback we also push the same line to
//       it (DOM HUD friendly), but we never DEPEND on a DOM HUD.
//
//   (4) FIRING WORKS END TO END. Clicking an un-fired ENEMY-WATERS cell on your turn
//       lobs a torpedo, the DEFENDER resolves it against their own private grid and
//       replies with only {result}, turns alternate strictly (a hit does NOT grant a
//       second shot), and the match ends when a whole fleet is sunk.
//
// HIDDEN-INFO SAFETY: a player's fleet positions NEVER cross the wire while the game
// is live. A {fire,x,y} is resolved by the DEFENDER against their OWN private grid;
// the reply is only {result,x,y,outcome,sunk?}. publicState() exposes ONLY the two
// shot streams + readiness + sunk lists — never any ship placement. The only time a
// layout is serialized is the cosmetic post-game {reveal}, after the game is decided.
//
// WIRE FORMAT (only shot coordinates + outcomes ever leave the device):
//   { type:"place",  ready:true }                                  // I placed all ships
//   { type:"start",  first:"host"|"guest" }                        // host-only, once both ready
//   { type:"fire",   x, y }                                        // a shot at enemy cell (x,y)
//   { type:"result", x, y, outcome:"miss"|"hit"|"sunk", sunk? }    // defender's reply
//   { type:"reveal", layout }                                      // END-OF-GAME ONLY
//
// PUBLIC SNAPSHOT (publicState / applyState — spectator + opponent safe):
//   { phase, turn, first, winner, ready:{host,guest},
//     shots:{ host:[{x,y,outcome,sunk?}...], guest:[...] },
//     sunk:{ host:[shipId...], guest:[shipId...] } }
//   shots.host = shots host fired at the GUEST's ocean (and vice-versa). No
//   occupancy, no hull, no placement anywhere — by design.

import { GameDesync, orientFor } from "./createGame.js";

// ===========================================================================
// PURE RULES — transport-free, self-contained.
// 10×10 grid, classic 5-ship fleet (17 cells), allowTouching = true, three
// outcomes (miss/hit/sunk), strict single-shot alternation.
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
//
// CANONICAL CONVENTION (createGame.js): row 0 / y 0 is the −Z edge = NEAREST the
// local seat after orientation. So YOUR OCEAN sits at −Z (near) and ENEMY WATERS
// at +Z (far). col → local X, row(=y) → local Z within a grid.
// ===========================================================================
const PLAY = 0.66;
const CELL = PLAY / GRID;
const HALF = PLAY / 2;

const GRID_GAP = CELL * 1.1;
const GRID_SPAN = CELL * GRID;
// YOUR OCEAN at the near −Z edge; ENEMY WATERS at the far +Z edge.
const OCEAN_CZ = -(GRID_SPAN + GRID_GAP) / 2;
const ENEMY_CZ = (GRID_SPAN + GRID_GAP) / 2;

const BASE_T = 0.012;
const TILE_T = 0.004;
const SURF_Y = BASE_T;
const PEG_Y = SURF_Y + 0.006;

const HULL_H = CELL * 0.5;
const HULL_Y = SURF_Y + HULL_H / 2;

// ===========================================================================
// THE MODULE
// ===========================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "battleship";

  let role = ctx.role;
  let seatRy = ctx.seatRy;
  let mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
  let oppSide = mySide === "host" ? "guest" : mySide === "guest" ? "host" : null;

  // optional DOM-HUD hook (never required — we always render an in-world HUD too)
  const hudHook = typeof ctx.onHud === "function" ? ctx.onHud : null;

  // ── Phase / turn state ──────────────────────────────────────────────────
  let phase = "placement";   // "placement" | "playing" | "over"
  let myTurn = false;
  let first = null;          // "host" | "guest"
  let winner = null;
  const ready = { host: false, guest: false };

  // ── PRIVATE: my own fleet (never serialized except in the post-game reveal) ──
  let myPlacements = [];
  let myOcean = freshOceanState();
  function freshOceanState() {
    return { occ: new Array(GRID * GRID).fill(null), firedAt: new Array(GRID * GRID).fill(false), hitCount: {} };
  }

  // ── PUBLIC: the two shot grids ──────────────────────────────────────────
  const shots = { host: [], guest: [] };
  const tracking = { host: new Map(), guest: new Map() };
  const sunkBy = { host: new Set(), guest: new Set() };
  let pendingFire = null; // shot I sent and await a result for

  // ── Placement-phase interaction state ───────────────────────────────────
  let placeIndex = 0;
  let ghostOrient = "horizontal";
  let hoverCell = null;

  // ===========================================================================
  // Shared materials + geometries (created once; freed in dispose()).
  //
  // The two SIDES read in clearly distinct colours: HOST = steel blue, GUEST =
  // amber. The local player's own hulls + ocean trim use their side colour.
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
    hit: new THREE.BoxGeometry(CELL * 0.98, HULL_H * 1.4, CELL * 0.98),
    peg: new THREE.CylinderGeometry(CELL * 0.18, CELL * 0.18, 0.018, 12),
    emberPeg: new THREE.SphereGeometry(CELL * 0.2, 12, 10),
    shell: new THREE.SphereGeometry(CELL * 0.12, 10, 8),
    ring: new THREE.TorusGeometry(CELL * 0.34, CELL * 0.05, 8, 22),
    btn: new THREE.BoxGeometry(CELL * 1.25, CELL * 0.45, CELL * 0.7),
    statusChip: new THREE.BoxGeometry(CELL * 0.7, CELL * 0.22, CELL * 0.22),
  };

  function cellX(x) { return -HALF + (x + 0.5) * CELL; }
  function cellZ(y, which) {
    const cz = which === "ocean" ? OCEAN_CZ : ENEMY_CZ;
    return cz - GRID_SPAN / 2 + (y + 0.5) * CELL;
  }

  // ── Live scene bookkeeping ──────────────────────────────────────────────
  const hullMeshes = [];
  const oceanShotMarks = new Map(); // enemy shots landing on MY ocean
  const enemyShotMarks = new Map(); // MY shots on enemy waters
  let ghostMesh = null;
  const placeButtons = [];
  const targetRings = [];
  let aimPlate = null;
  const statusChips = { host: [], guest: [] };

  // HUD billboard (canvas-textured plane, hovering above the board, faces camera).
  let hudMesh = null;

  // Self-orientation: rotate the WHOLE group so the local player's own ocean
  // (authored at −Z) lands nearest them. board.js does NOT rotate us
  // (orientPolicy:"self"). Each client renders with its OWN seatRy, and
  // orientFor(seatRy) ALONE brings that seat's near edge (local −Z, our ocean)
  // to the front — INCLUDING the opposite guest chair, where orientFor(~PI)===PI
  // already maps local −Z to world +Z (nearest the guest). There is NO extra
  // per-role PI: adding one would double-count the opposite seat and flip the
  // guest back into the host's frame (placing/firing on the wrong grids).
  function applyFacing() {
    group.rotation.y = orientFor(seatRy);
  }

  buildStaticBoard();
  buildColliders();
  buildStatusChips();
  buildHud();
  applyFacing();

  // ===========================================================================
  // Static geometry: base panel + two 10×10 water grids + coloured frame bands +
  // floating placement buttons.
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

    // Coloured frame band around each grid: YOUR-side colour around your ocean,
    // an enemy red band around enemy waters — an at-a-glance "this is mine".
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

  // Floating placement controls ON the board, hovering just in front of (slightly
  // −Z of) YOUR ocean's near edge. Laid out as a row ACROSS X, centred on 0, so
  // every button stays inside |X| <= HALF and within the tabletop radius / seated
  // camera framing. Anchored to the local −Z ocean, so Fix A renders them in front
  // of WHICHEVER seat owns that ocean (host near host, guest near guest).
  function buildPlaceButtons() {
    const defs = [
      { btn: "rotate", mat: M.btnIdle },
      { btn: "random", mat: M.btnIdle },
      { btn: "clear", mat: M.btnIdle },
      { btn: "ready", mat: M.btnGo },
    ];
    // Row sits just in front of the ocean grid's near edge, still on the base.
    const rowZ = OCEAN_CZ - GRID_SPAN / 2 + CELL * 0.5;
    const bx0 = -HALF * 0.66;
    const bxStep = (HALF * 1.32) / 3;
    defs.forEach((d, i) => {
      const m = new THREE.Mesh(G.btn, d.mat.clone());
      // Raised above the water so they read as floating controls and don't z-fight.
      m.position.set(bx0 + i * bxStep, SURF_Y + CELL * 0.35, rowZ);
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

  // Per-cell invisible colliders over BOTH grids, tagged {r,c,which}.
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

  // Fleet-status chips beside the enemy-waters grid.
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
    // Keep chips inboard (within |X| <= HALF) so they read on the board, not
    // floating off the tabletop edge.
    const z0 = ENEMY_CZ - GRID_SPAN / 2 + CELL * 0.4;
    if (mySide) {
      makeRow(mySide, HALF - CELL * 0.9, z0);
    } else {
      makeRow("host", HALF - CELL * 0.9, z0);
      makeRow("guest", -HALF + CELL * 0.9, z0);
    }
  }

  // ===========================================================================
  // HUD billboard — a canvas-textured plane hovering over the board centre that
  // always faces the camera and states the current guidance. ALWAYS rendered;
  // independent of any DOM HUD. We also forward the line to ctx.onHud if present.
  // ===========================================================================
  function buildHud() {
    const canCreate = typeof document !== "undefined" && document.createElement;
    const cv = canCreate ? document.createElement("canvas") : null;
    if (cv) { cv.width = 512; cv.height = 192; }
    const tex = cv ? new THREE.CanvasTexture(cv) : null;
    if (tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const mat = tex
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
      : new THREE.MeshBasicMaterial({ color: "#0c2036", transparent: true, opacity: 0.85, depthWrite: false });
    const w = GRID_SPAN * 1.15;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.375), mat);
    mesh.position.set(0, SURF_Y + GRID_SPAN * 0.62, 0);
    mesh.renderOrder = 30;
    mesh.userData.cv = cv;
    mesh.userData.tex = tex;
    mesh.userData.billboard = true;
    group.add(mesh);
    hudMesh = mesh;
    refreshHud();
  }

  // Compose the human-readable guidance for the current phase/turn.
  function hudLines() {
    if (!mySide) {
      // Spectator
      if (phase === "over") return { title: "Game over", sub: winner ? `${cap(winner)} wins` : "", color: "#9fd3ff" };
      if (phase === "placement") return { title: "Battleship", sub: "Players placing fleets…", color: "#9fd3ff" };
      const firer = currentFirer();
      return { title: "Battleship (spectating)", sub: firer ? `${cap(firer)} to fire` : "", color: "#9fd3ff" };
    }
    const sideName = cap(mySide);
    if (phase === "over") {
      const won = winner === mySide;
      return {
        title: won ? "VICTORY — enemy fleet sunk!" : "DEFEAT — your fleet is sunk",
        sub: `You played ${sideName}`,
        color: won ? "#7fffb0" : "#ff9a8a",
      };
    }
    if (phase === "placement") {
      if (ready[mySide]) {
        return { title: "Fleet ready", sub: "Waiting for opponent…", color: "#dfe9f2" };
      }
      const remaining = FLEET.length - myPlacements.length;
      const spec = currentSpec();
      const sub = spec
        ? `Place ${spec.name} (len ${spec.length}). Click your ocean. Rotate: ${ghostOrient}.`
        : "All ships placed. Click READY.";
      return {
        title: `Place your fleet (${sideName}) — ${remaining} ship${remaining === 1 ? "" : "s"} left`,
        sub,
        color: "#bfe0ff",
      };
    }
    // playing
    const mine = sunkBy[mySide].size, theirs = sunkBy[oppSide].size;
    if (myTurnNow()) {
      return { title: "YOUR TURN — fire!", sub: `Click an enemy cell. Enemy ships sunk: ${mine}/${FLEET.length} · yours lost: ${theirs}/${FLEET.length}`, color: "#7fd1ff" };
    }
    return { title: "Waiting for opponent…", sub: `Enemy ships sunk: ${mine}/${FLEET.length} · yours lost: ${theirs}/${FLEET.length}`, color: "#dfe9f2" };
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
    // rounded panel
    g.fillStyle = "rgba(8,18,30,0.86)";
    roundRect(g, 6, 6, cv.width - 12, cv.height - 12, 22);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = color;
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.font = "bold 46px sans-serif";
    g.fillText(clip(title, 26), cv.width / 2, 68);
    if (sub) {
      g.fillStyle = "#dfe9f2";
      g.font = "26px sans-serif";
      g.fillText(clip(sub, 52), cv.width / 2, 128);
    }
    tex.needsUpdate = true;
  }

  function clip(s, n) { return s && s.length > n ? s.slice(0, n - 1) + "…" : s; }
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
  // Animation loop (internal rAF; idles to zero cost when nothing moves).
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
    return shells.length > 0 || blooms.length > 0 || targetRings.length > 0 || !!hudMesh;
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
    if (targetRings.length > 0) {
      idleT += dt;
      const bob = Math.sin(idleT * 3.2) * CELL * 0.06;
      for (const t of targetRings) {
        t.position.y = t.userData.baseY + bob;
        t.rotation.z = idleT * 2.0;
        t.material.opacity = 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(idleT * 4));
      }
    }
    // Billboard the HUD toward the camera each frame (cheap; keeps text legible
    // from any seat). We only counter-rotate around Y by the group's own rotation
    // so the text stays upright and readable.
    if (hudMesh) {
      hudMesh.rotation.y = -group.rotation.y;
    }
  }

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
  // Markers — persistent pegs encoding the public shot grids.
  // ===========================================================================
  function placeMarker(x, y, outcome, which, mapStore) {
    const key = x + "," + y;
    if (mapStore.has(key)) return; // idempotent
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
  // Hull rendering — MY ships only, on MY (near) ocean. Visible only to the local
  // seated player; never serialized.
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

  function tryPlaceAt(x, y) {
    const spec = currentSpec();
    if (!spec) return false;
    const ship = { id: spec.id, name: spec.name, length: spec.length, x, y, orientation: ghostOrient };
    if (!canPlace(myPlacements, ship)) return false;
    myPlacements.push(ship);
    placeIndex = myPlacements.length;
    rebuildHulls();
    refreshGhost();
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
    refreshHud();
  }

  function doClear() {
    myPlacements = [];
    placeIndex = 0;
    rebuildHulls();
    refreshGhost();
    refreshHud();
  }

  function doReady() {
    if (!isComplete(myPlacements) || !mySide) return;
    myOcean = freshOceanState();
    myOcean.occ = occupancyOf(myPlacements);
    ready[mySide] = true;
    clearGhost();
    refreshButtonsVisibility();
    refreshHud();
    try { ctx.net.sendMove({ type: "place", ready: true }); } catch { /* transport optional */ }
    maybeStart();
    pushSnapshot();
  }

  function maybeStart() {
    if (phase !== "placement") return;
    if (!ready.host || !ready.guest) return;
    if (role !== "host") return; // only the host decides + broadcasts the start
    first = Math.random() < 0.5 ? "host" : "guest";
    phase = "playing";
    myTurn = first === "host";
    try { ctx.net.sendMove({ type: "start", first }); } catch { /* transport optional */ }
    refreshAim();
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
    clearAim();
    refreshHud();
    const fromZ = ENEMY_CZ - GRID_SPAN / 2 - CELL * 0.8; // launch from the near edge of enemy waters (the side facing me)
    launchShell(x, y, "enemy", fromZ, null);
    try { ctx.net.sendMove({ type: "fire", x, y }); } catch { /* transport optional */ }
  }

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
      sendReveal();
      return;
    }
    if (role === "host") pushSnapshot();
    refreshHud();
    // The turn passes to the opponent; it returns to me only after their incoming
    // {fire} lands (receiveIncomingFire sets myTurn=true).
  }

  function receiveIncomingFire(x, y) {
    if (phase !== "playing") return;
    const res = receiveFire(myOcean, x, y);
    if (!res) return; // out of bounds / duplicate — ignore, don't desync
    shots[oppSide].push({ x, y, outcome: res.outcome, sunk: res.sunk });
    tracking[oppSide].set(x + "," + y, { outcome: res.outcome, sunk: res.sunk });
    placeMarker(x, y, res.outcome, "ocean", oceanShotMarks);
    spawnBloom(cellX(x), cellZ(y, "ocean"), res.outcome);
    if (res.outcome === "sunk" && res.sunk) sunkBy[oppSide].add(res.sunk);

    const reply = { type: "result", x, y, outcome: res.outcome };
    if (res.outcome === "sunk") reply.sunk = res.sunk;
    try { ctx.net.sendMove(reply); } catch { /* transport optional */ }

    if (res.allSunk) {
      endGame(oppSide, "fleet-sunk");
      sendReveal();
      return;
    }
    myTurn = true;
    refreshAim();
    if (role === "host") pushSnapshot();
    refreshHud();
  }

  // ===========================================================================
  // Aim affordances — bobbing target rings on every un-fired enemy cell + a soft
  // aim plate, ONLY on my turn in the playing phase.
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
  // onPointer — the framework dispatches { cell, point, object }.
  //   placement: click YOUR (near) ocean to place/rotate; click a button.
  //   playing  : click ENEMY (far) waters to fire (your turn, un-fired cell).
  // ===========================================================================
  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed()) return; // spectators + game-over: inert

    const btn = buttonFromHit(hit);
    if (btn && phase === "placement" && mySide && !ready[mySide]) {
      if (btn === "rotate") { ghostOrient = ghostOrient === "horizontal" ? "vertical" : "horizontal"; refreshGhost(); refreshHud(); }
      else if (btn === "random") doRandomize();
      else if (btn === "clear") doClear();
      else if (btn === "ready") { if (isComplete(myPlacements)) doReady(); else doAutoRemaining(); }
      return;
    }

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
        refreshButtonsVisibility();
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
        refreshButtonsVisibility();
        refreshAim();
        refreshHud();
        pushSnapshot();
        return true;
      }
      case "fire": {
        if (phase !== "playing") throw new GameDesync("battleship: fire before play");
        if (!mySide) return true; // spectators never receive raw fires (server-gated)
        const fromZ = OCEAN_CZ + GRID_SPAN / 2 + CELL * 0.8; // incoming arc from the far edge of MY ocean
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
        validLayout(move.layout); // verified-or-not; harmless either way
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
      myPlacements = [];
      placeIndex = 0;
      hoverCell = null;
      myOcean = freshOceanState();
      rebuildHulls();
      refreshStatusChips();
      refreshButtonsVisibility();
      refreshGhost();
      refreshAim();
      refreshHud();
      return;
    }

    phase = state.phase === "playing" ? "playing" : state.phase === "over" ? "over" : "placement";
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
        }
      }
    }

    if (state.sunk) {
      for (const side of ["host", "guest"]) {
        const ids = Array.isArray(state.sunk[side]) ? state.sunk[side] : [];
        for (const id of ids) if (SHIP_IDS.has(id)) sunkBy[side].add(id);
      }
    }

    if (mySide && phase === "playing") {
      const mine = shots[mySide].length;
      const theirs = shots[oppSide].length;
      myTurn = first === mySide ? mine <= theirs : mine < theirs;
      pendingFire = null;
    } else {
      myTurn = false;
    }

    rebuildHulls();
    refreshStatusChips();
    refreshButtonsVisibility();
    refreshGhost();
    refreshAim();
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
    clearAim();
    refreshButtonsVisibility();
    refreshHud();
    try { ctx.onGameOver({ winner: winnerSide, reason: reason || "fleet-sunk" }); } catch { /* ignore */ }
    if (role === "host") pushSnapshot();
  }

  function sendReveal() {
    if (!mySide || myPlacements.length !== FLEET.length) return;
    const layout = myPlacements.map((s) => ({ id: s.id, x: s.x, y: s.y, orientation: s.orientation }));
    try { ctx.net.sendMove({ type: "reveal", layout }); } catch { /* transport optional */ }
  }

  // ===========================================================================
  // Role / seat changes — switch in place. applyState NEVER recomputes role; only
  // the framework's explicit setRole does, and a promoted player re-enters
  // placement locally (empty ocean).
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
        myOcean = freshOceanState();
      }
    }
    applyFacing();
    rebuildHulls();
    refreshButtonsVisibility();
    refreshStatusChips();
    refreshGhost();
    refreshAim();
    refreshHud();
  }

  function setSeatRy(ry) {
    seatRy = ry;
    applyFacing();
    refreshAim();
    refreshGhost();
    refreshHud();
  }

  // ===========================================================================
  // dispose — stop the loop, free GPU resources, drop the group.
  // ===========================================================================
  function dispose() {
    if (rafId != null) { caf(rafId); rafId = null; }
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
  refreshButtonsVisibility();
  refreshStatusChips();
  refreshGhost();
  refreshAim();
  refreshHud();
  startLoop(); // keep the HUD billboard tracking the camera

  return {
    group,
    orientPolicy: "self", // we rotate the group ourselves so each seat sees its OWN ocean near
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
