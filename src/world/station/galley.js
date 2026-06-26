// STATION GALLEY — a warm, cozy MESS HALL bolted into the cold metal of the orbital
// station. A self-contained walkable room you can drop anywhere on a station deck:
// dining tables with benches + trays of glowing food, a long stainless KITCHEN line
// (cooktop + glowing food dispensers + espresso machines steaming away), a drinks
// BAR with stools and a backlit bottle shelf, hanging pendant lamps, a chalkboard
// menu, a big viewport onto a slowly-drifting Earth, pot plants, and a hovering
// robot server ferrying a tray of food up and down the line.
//
// ── CONTRACT (mirrors the ocean / space-interior modules) ─────────────────────
//   buildStationGalley(opts) -> { group, update(dt), ground, colliders }
//     opts.ox / opts.oz  — world XZ the room is centred on (default 662, 130)
//     opts.floorY        — world Y the deck top sits at (default 260, station alt.)
//   group     — a THREE.Group parked at world (ox, floorY, oz). ALL content is built
//               in LOCAL coords with the deck top at local y=0, so the player (lifted
//               onto floorY by the caller's station-ground handling) reads as standing
//               on the deck.
//   ground    — one walkable rect (world XZ): the room footprint, 38 x 32 m.
//   colliders — tight WORLD-space AABBs around the SOLID furniture (kitchen line, bar,
//               dining tables, planters). Aisles between them stay clear so you can
//               actually walk the room.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// Every shared material + geometry is created ONCE at module scope. The build phase
// may allocate freely (incl. a few per-unit emissive/steam materials so each glow can
// pulse independently). update(dt) only mutates cached transforms + material scalars
// on small handle lists — no `new` per frame (positions written component-wise, scales
// via .setScalar). Animated: dispenser/food/cooktop glow, espresso steam columns, the
// bar back-light shimmer, the robot server's patrol, and a slow Earth drift + spin.

import * as THREE from "three";

// ── Shared materials (created ONCE) ───────────────────────────────────────────
// Cold structure — the metal the cozy fit-out contrasts against.
const deckMat     = new THREE.MeshStandardMaterial({ color: "#3c4148", roughness: 0.7, metalness: 0.45 });
const deckTrimMat = new THREE.MeshStandardMaterial({ color: "#2c3036", roughness: 0.6, metalness: 0.5 });
const wallMat     = new THREE.MeshStandardMaterial({ color: "#aeb6bf", roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
const wainscotMat = new THREE.MeshStandardMaterial({ color: "#6e4a2c", roughness: 0.72, metalness: 0.08 }); // warm wood dado strip
const ceilMat     = new THREE.MeshStandardMaterial({ color: "#9aa2ab", roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
const ribMat      = new THREE.MeshStandardMaterial({ color: "#6b7681", roughness: 0.5, metalness: 0.55 });
// Warm lighting — pendants + ceiling glow strips, the cozy counterpoint to the steel.
const warmStripMat = new THREE.MeshStandardMaterial({ color: "#ffd9a0", emissive: "#ffb866", emissiveIntensity: 0.8, roughness: 0.4 });
const shadeMat     = new THREE.MeshStandardMaterial({ color: "#caa05a", roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
const cordMat      = new THREE.MeshStandardMaterial({ color: "#26221e", roughness: 0.85 });
// Warm wood furniture.
const woodMat     = new THREE.MeshStandardMaterial({ color: "#7a4f2c", roughness: 0.7 });
const woodDarkMat = new THREE.MeshStandardMaterial({ color: "#553520", roughness: 0.72 });
const benchMat    = new THREE.MeshStandardMaterial({ color: "#8a5a32", roughness: 0.7 });
const cushionMat  = new THREE.MeshStandardMaterial({ color: "#b5613a", roughness: 0.85 });
// Stainless kitchen line.
const steelMat     = new THREE.MeshStandardMaterial({ color: "#c2c8ce", roughness: 0.35, metalness: 0.75 });
const steelDarkMat = new THREE.MeshStandardMaterial({ color: "#8a9099", roughness: 0.45, metalness: 0.7 });
const counterTopMat= new THREE.MeshStandardMaterial({ color: "#d6dade", roughness: 0.3, metalness: 0.6 });
const burnerBaseMat= new THREE.MeshStandardMaterial({ color: "#16181c", roughness: 0.6, metalness: 0.4 });
const potMetalMat  = new THREE.MeshStandardMaterial({ color: "#3a3e44", roughness: 0.5, metalness: 0.6 });
const espressoMat  = new THREE.MeshStandardMaterial({ color: "#7a2a24", roughness: 0.4, metalness: 0.5 }); // warm red machine body
const cupMat       = new THREE.MeshStandardMaterial({ color: "#f1ece2", roughness: 0.5 });
const trayMat      = new THREE.MeshStandardMaterial({ color: "#71777e", roughness: 0.4, metalness: 0.65 });
// Drinks bar.
const barTopMat = new THREE.MeshStandardMaterial({ color: "#6b3f22", roughness: 0.45, metalness: 0.05 });
const shelfMat  = new THREE.MeshStandardMaterial({ color: "#43301c", roughness: 0.72 });
const bottleMats = [
  new THREE.MeshStandardMaterial({ color: "#3f8f6a", roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.6 }),
  new THREE.MeshStandardMaterial({ color: "#9a3f3f", roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.6 }),
  new THREE.MeshStandardMaterial({ color: "#c9a23a", roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.6 }),
  new THREE.MeshStandardMaterial({ color: "#3a5f9a", roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.6 }),
  new THREE.MeshStandardMaterial({ color: "#cfd2d6", roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.55 }),
];
// Viewport + Earth (Earth opts out of fog so it stays crisp against the dark).
const frameMat      = new THREE.MeshStandardMaterial({ color: "#5a626b", roughness: 0.4, metalness: 0.7 });
const glassMat      = new THREE.MeshStandardMaterial({ color: "#0a1830", roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.15, side: THREE.DoubleSide, emissive: "#0a1428", emissiveIntensity: 0.2 });
const earthMat      = new THREE.MeshStandardMaterial({ color: "#2a5a9a", roughness: 0.9, metalness: 0.0, emissive: "#0e2240", emissiveIntensity: 0.35, flatShading: true, fog: false });
const earthLandMat  = new THREE.MeshStandardMaterial({ color: "#3f8a55", roughness: 1.0, fog: false });
const earthCloudMat = new THREE.MeshStandardMaterial({ color: "#eef4fb", roughness: 1.0, transparent: true, opacity: 0.6, fog: false });
// Pot plants.
const potMat  = new THREE.MeshStandardMaterial({ color: "#9c5a32", roughness: 0.8 });
const soilMat = new THREE.MeshStandardMaterial({ color: "#2e2018", roughness: 1.0 });
const leafMat = new THREE.MeshStandardMaterial({ color: "#3f7a3f", roughness: 0.85, flatShading: true });
const leafMat2= new THREE.MeshStandardMaterial({ color: "#56a356", roughness: 0.85, flatShading: true });
// Robot server.
const robotMat    = new THREE.MeshStandardMaterial({ color: "#d8dee4", roughness: 0.4, metalness: 0.6 });
const robotTrimMat= new THREE.MeshStandardMaterial({ color: "#c97a3a", roughness: 0.5, metalness: 0.4 });
const visorMat    = new THREE.MeshStandardMaterial({ color: "#0a2740", roughness: 0.3, emissive: "#37d0ff", emissiveIntensity: 0.9 });
// Chalkboard menu.
const boardMat     = new THREE.MeshStandardMaterial({ color: "#16221c", roughness: 0.9 });
const boardFrameMat= new THREE.MeshStandardMaterial({ color: "#5a3a20", roughness: 0.7 });
const chalkMat     = new THREE.MeshStandardMaterial({ color: "#e8e4d0", roughness: 0.9, emissive: "#3a3a30", emissiveIntensity: 0.12 });
const chalkWarmMat = new THREE.MeshStandardMaterial({ color: "#ffd9a0", roughness: 0.8, emissive: "#caa050", emissiveIntensity: 0.3 });

// ── Shared geometries (created ONCE; sized things still use box()/new at build) ─
const G = {
  thinRod:   new THREE.CylinderGeometry(0.03, 0.03, 1, 6),     // pendant cord / posts (scaled along Y)
  bulb:      new THREE.SphereGeometry(0.18, 12, 8),
  shade:     new THREE.ConeGeometry(0.55, 0.42, 18, 1, true),
  burner:    new THREE.TorusGeometry(0.26, 0.05, 8, 20),
  pot:       new THREE.CylinderGeometry(0.42, 0.36, 0.4, 16),
  bottle:    new THREE.CylinderGeometry(0.09, 0.09, 0.7, 10),
  stoolSeat: new THREE.CylinderGeometry(0.34, 0.34, 0.12, 16),
  stoolLeg:  new THREE.CylinderGeometry(0.05, 0.05, 1, 8),
  foodBlob:  new THREE.IcosahedronGeometry(0.16, 0),
  steamPuff: new THREE.SphereGeometry(0.16, 8, 6),
  thruster:  new THREE.ConeGeometry(0.34, 0.4, 16, 1, true),
  planter:   new THREE.CylinderGeometry(0.7, 0.58, 0.9, 16),
};

function mesh(geo, mat, cast = false, receive = false) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = false, receive = false) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}
function addAABB(arr, cx, cz, w, d) {
  arr.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

export function buildStationGalley(opts = {}) {
  const ox = opts.ox ?? 662;
  const oz = opts.oz ?? 130;
  const floorY = opts.floorY ?? 260;

  const group = new THREE.Group();
  group.name = "stationGalley";
  group.position.set(ox, floorY, oz);

  // Returned contract.
  const ground = [{ minX: ox - 19, maxX: ox + 19, minZ: oz - 16, maxZ: oz + 16 }];
  const colliders = [];

  // Animated handles (mutated allocation-free in update()).
  const glows = [];     // { mat, base, amp, rate, phase }  smooth emissive pulse
  const backlights = []; // { mat, base, amp, r1, r2, phase } two-sine shimmer
  const beacons = [];   // { mat, hi, lo, rate, phase }      sharp on/off blink
  const steam = [];     // { mesh, mat, baseY, rise, rate, phase, maxO }

  // Local-space room half-extents (footprint is 38 x 32 → ±19 x ±16).
  const HX = 19, HZ = 16, WALL_H = 4.6, WALL_T = 0.4;

  // Helper: register a solid prop's collider in WORLD coords from LOCAL centre.
  const solid = (lx, lz, w, d) => addAABB(colliders, ox + lx, oz + lz, w, d);

  // ── 1) SHELL — deck, walls, warm wood dado, ribs, ceiling ────────────────────
  const deck = box(2 * HX, 0.3, 2 * HZ, deckMat, false, true);
  deck.position.y = -0.15; // top face at local y=0
  group.add(deck);
  // A few inset deck trim lines for a paneled-floor read (cosmetic).
  for (const lz of [-8, 0, 8]) {
    const seam = box(2 * HX - 1, 0.02, 0.12, deckTrimMat, false, false);
    seam.position.set(0, 0.005, lz);
    group.add(seam);
  }

  // Solid walls on three sides (inner faces flush to the footprint edge). Visual
  // only — the player is bounded by the `ground` rect, so no wall colliders needed.
  const wallZneg = box(2 * HX + 0.8, WALL_H, WALL_T, wallMat, false, true);
  wallZneg.position.set(0, WALL_H / 2, -HZ - WALL_T / 2);
  group.add(wallZneg);
  const wallZpos = box(2 * HX + 0.8, WALL_H, WALL_T, wallMat, false, true);
  wallZpos.position.set(0, WALL_H / 2, HZ + WALL_T / 2);
  group.add(wallZpos);
  // LEFT (-X) END — OPENED. Instead of one solid divider wall sealing this zone
  // off from the neighbour, leave a WIDE centred full-height doorway (11 m) so you
  // walk straight through along the east-west axis. Two short corner stubs keep the
  // room's structure and still back the chalkboard menu / corner plant.
  const XDOOR_HALF = 5.5;                       // half-width of the open doorway (→ 11 m gap)
  const xStubLen = (HZ + 0.4) - XDOOR_HALF;     // each corner stub fills from the gap to the ±Z corner
  for (const sz of [-1, 1]) {
    const stub = box(WALL_T, WALL_H, xStubLen, wallMat, false, true);
    stub.position.set(-HX - WALL_T / 2, WALL_H / 2, sz * (XDOOR_HALF + xStubLen / 2));
    group.add(stub);
  }
  // Warm wood dado strip wrapping the three solid walls (cozy contrast band).
  for (const w of [
    [0, -HZ + 0.05, 2 * HX, 0.06], [0, HZ - 0.05, 2 * HX, 0.06],
  ]) {
    const dado = box(w[2], 1.0, w[3], wainscotMat, false, false);
    dado.position.set(w[0], 0.5, w[1]);
    group.add(dado);
  }
  // Warm wood dado on the two -X corner stubs (split to match the new doorway gap).
  const dadoXLen = HZ - XDOOR_HALF;             // 10.5 each side
  for (const sz of [-1, 1]) {
    const dadoX = box(0.06, 1.0, dadoXLen, wainscotMat, false, false);
    dadoX.position.set(-HX + 0.05, 0.5, sz * (XDOOR_HALF + dadoXLen / 2));
    group.add(dadoX);
  }
  // Structural ribs up the back (-Z) wall.
  for (const rx of [-14, -7, 0, 7, 14]) {
    const rib = box(0.3, WALL_H, 0.45, ribMat, false, false);
    rib.position.set(rx, WALL_H / 2, -HZ + 0.3);
    group.add(rib);
  }
  // Ceiling slab + warm glow strips (cosmetic, the cozy ambient wash).
  const ceil = box(2 * HX, 0.3, 2 * HZ, ceilMat, false, false);
  ceil.position.set(0, WALL_H + 0.15, 0);
  group.add(ceil);
  for (const lz of [-8, 8]) {
    const stripMat = warmStripMat.clone();
    const strip = box(2 * HX - 6, 0.1, 0.6, stripMat, false, false);
    strip.position.set(0, WALL_H - 0.12, lz);
    group.add(strip);
    glows.push({ mat: stripMat, base: 0.7, amp: 0.18, rate: 0.5 + Math.random() * 0.4, phase: Math.random() * 6.28 });
  }

  // ── 2) HANGING PENDANT LAMPS ─────────────────────────────────────────────────
  // Warm bulbs on cords over the tables, bar, and kitchen line.
  function pendant(lx, lz, drop) {
    const cord = mesh(G.thinRod, cordMat, false, false);
    cord.scale.y = WALL_H - drop;
    cord.position.set(lx, WALL_H - (WALL_H - drop) / 2, lz);
    group.add(cord);
    const shade = mesh(G.shade, shadeMat, false, false);
    shade.position.set(lx, drop + 0.18, lz);
    group.add(shade);
    const bulbMat = new THREE.MeshStandardMaterial({ color: "#fff2d0", emissive: "#ffcf8a", emissiveIntensity: 1.7 });
    const bulb = mesh(G.bulb, bulbMat, false, false);
    bulb.position.set(lx, drop + 0.02, lz);
    group.add(bulb);
    glows.push({ mat: bulbMat, base: 1.6, amp: 0.22, rate: 1.1 + Math.random() * 0.7, phase: Math.random() * 6.28 });
  }
  for (const [px, pz] of [[4, -6], [12, -6], [4, 6], [12, 6]]) pendant(px, pz, 2.7);
  pendant(-13, 12.6, 2.9);
  pendant(-5, 12.6, 2.9);
  pendant(-7, -11, 3.0);

  // ── 3) DINING TABLES with benches + a tray of glowing food ───────────────────
  // Long axis along X; a bench runs each ±Z side. Footprint ~2.8 x 3.0 → collider.
  function diningTable(lx, lz) {
    const TW = 2.4, TD = 1.1, TH = 0.95;
    const top = box(TW, 0.1, TD, woodMat, true, true);
    top.position.set(lx, TH, lz);
    group.add(top);
    const apron = box(TW - 0.3, 0.18, TD - 0.25, woodDarkMat, false, false);
    apron.position.set(lx, TH - 0.16, lz);
    group.add(apron);
    for (const sx of [-1, 1]) {
      const leg = box(0.12, TH, 0.12, woodDarkMat, false, false);
      leg.position.set(lx + sx * (TW / 2 - 0.25), TH / 2, lz);
      group.add(leg);
    }
    // Benches each side.
    for (const sz of [-1, 1]) {
      const bz = lz + sz * 1.05;
      const seat = box(TW, 0.12, 0.5, benchMat, true, true);
      seat.position.set(lx, 0.5, bz);
      group.add(seat);
      const pad = box(TW - 0.2, 0.08, 0.42, cushionMat, false, false);
      pad.position.set(lx, 0.58, bz);
      group.add(pad);
      for (const sx of [-1, 1]) {
        const bl = box(0.1, 0.5, 0.1, woodDarkMat, false, false);
        bl.position.set(lx + sx * (TW / 2 - 0.2), 0.25, bz);
        group.add(bl);
      }
    }
    // Tray of glowing food on the table.
    const tray = box(0.9, 0.05, 0.6, trayMat, false, false);
    tray.position.set(lx, TH + 0.08, lz);
    group.add(tray);
    const foods = ["#ffae3a", "#ff6a3a", "#9be84a"];
    for (let i = 0; i < 3; i++) {
      const fm = new THREE.MeshStandardMaterial({ color: foods[i], emissive: foods[i], emissiveIntensity: 0.7, roughness: 0.5 });
      const f = mesh(G.foodBlob, fm, false, false);
      f.position.set(lx - 0.28 + i * 0.28, TH + 0.16, lz);
      f.scale.setScalar(0.8 + (i % 2) * 0.4);
      group.add(f);
      glows.push({ mat: fm, base: 0.6, amp: 0.28, rate: 1.4 + i * 0.5, phase: i * 1.7 + lx });
    }
    // Tight collider around table + benches.
    solid(lx, lz, TW + 0.4, 3.0);
  }
  for (const [tx, tz] of [[4, -6], [12, -6], [4, 6], [12, 6]]) diningTable(tx, tz);

  // ── 4) KITCHEN LINE along the back (-Z) wall ─────────────────────────────────
  // A long stainless counter: cooktop (glowing burners + a steaming pot), a bank of
  // glowing food DISPENSERS, and two espresso machines venting steam.
  const KZ = -13.3, KW = 20, KX0 = -7; // counter centre x=-7, span x[-17,3]
  const counterH = 1.05;
  const kBase = box(KW, counterH, 1.7, steelMat, true, true);
  kBase.position.set(KX0, counterH / 2, KZ);
  group.add(kBase);
  const kTop = box(KW + 0.2, 0.1, 1.9, counterTopMat, false, true);
  kTop.position.set(KX0, counterH + 0.05, KZ);
  group.add(kTop);
  // Toe-kick + a couple of cabinet doors for detail.
  const kKick = box(KW, 0.18, 0.2, steelDarkMat, false, false);
  kKick.position.set(KX0, 0.09, KZ + 0.78);
  group.add(kKick);
  for (let dx = -16; dx <= 2; dx += 2.2) {
    const door = box(1.8, counterH - 0.35, 0.05, steelDarkMat, false, false);
    door.position.set(dx, counterH / 2, KZ + 0.86);
    group.add(door);
    const handle = box(0.06, 0.4, 0.06, steelMat, false, false);
    handle.position.set(dx + 0.7, counterH / 2 + 0.1, KZ + 0.9);
    group.add(handle);
  }
  solid(KX0, KZ, KW + 0.2, 1.9);

  // Cooktop with 4 glowing burner rings + a steaming pot.
  {
    const cx = -15;
    const ct = box(2.0, 0.06, 1.4, burnerBaseMat, false, false);
    ct.position.set(cx, counterH + 0.13, KZ);
    group.add(ct);
    let bi = 0;
    for (const [bx, bz] of [[-0.5, -0.35], [0.5, -0.35], [-0.5, 0.35], [0.5, 0.35]]) {
      const bm = new THREE.MeshStandardMaterial({ color: "#ff6a2a", emissive: "#ff5210", emissiveIntensity: 1.0, roughness: 0.5 });
      const ring = mesh(G.burner, bm, false, false);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx + bx, counterH + 0.17, KZ + bz);
      group.add(ring);
      glows.push({ mat: bm, base: 0.9, amp: 0.55, rate: 2.2 + bi * 0.7, phase: bi * 1.3 });
      bi++;
    }
    // Pot on the back burners, lid + rising steam.
    const pot = mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.36, 16), potMetalMat, true, false);
    pot.position.set(cx - 0.5, counterH + 0.34, KZ - 0.35);
    group.add(pot);
    addSteamColumn(cx - 0.5, counterH + 0.55, KZ - 0.35, 2);
  }

  // Glowing food DISPENSERS — tall steel cabinets, each with a backlit product
  // window and a little dispense spout.
  let di = 0;
  for (const dx of [-9.5, -7, -4.5, -2]) {
    const cab = box(2.0, 1.5, 1.1, steelDarkMat, true, false);
    cab.position.set(dx, counterH + 0.85, KZ);
    group.add(cab);
    const gm = new THREE.MeshStandardMaterial({ color: "#ffd24a", emissive: "#ffae22", emissiveIntensity: 0.8, roughness: 0.4, transparent: true, opacity: 0.92 });
    const winw = mesh(new THREE.BoxGeometry(1.5, 1.0, 0.08), gm, false, false);
    winw.position.set(dx, counterH + 0.95, KZ - 0.56);
    group.add(winw);
    // Spout under the window.
    const spout = box(0.5, 0.18, 0.3, steelMat, false, false);
    spout.position.set(dx, counterH + 0.32, KZ - 0.62);
    group.add(spout);
    glows.push({ mat: gm, base: 0.75, amp: 0.4, rate: 1.0 + di * 0.45, phase: di * 1.9 });
    di++;
  }

  // Two ESPRESSO machines venting steam (warm red bodies, steel group heads).
  for (const ex of [-0.2, 2.0]) {
    const body = box(1.1, 0.7, 0.85, espressoMat, true, false);
    body.position.set(ex, counterH + 0.45, KZ - 0.1);
    group.add(body);
    const head = box(0.85, 0.5, 0.7, steelMat, false, false);
    head.position.set(ex, counterH + 0.95, KZ - 0.1);
    group.add(head);
    const groupHead = mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 10), steelDarkMat, false, false);
    groupHead.position.set(ex, counterH + 0.55, KZ - 0.5);
    group.add(groupHead);
    const cup = mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.14, 12), cupMat, false, false);
    cup.position.set(ex, counterH + 0.27, KZ - 0.5);
    group.add(cup);
    addSteamColumn(ex - 0.05, counterH + 0.7, KZ - 0.5, 3);
  }

  // ── 5) DRINKS BAR along the +Z wall (west end) ───────────────────────────────
  // Wood bar top on a steel base, stools in front, a backlit bottle shelf behind.
  const BZ = 13.0, BW = 16, BX0 = -9; // span x[-17,-1]
  const barBase = box(BW, 1.05, 1.2, steelDarkMat, true, true);
  barBase.position.set(BX0, 0.525, BZ);
  group.add(barBase);
  const barTop = box(BW + 0.6, 0.14, 1.5, barTopMat, false, true);
  barTop.position.set(BX0, 1.12, BZ);
  group.add(barTop);
  // Warm wood front panel facing the room.
  const barFront = box(BW, 0.95, 0.06, woodMat, false, false);
  barFront.position.set(BX0, 0.5, BZ - 0.62);
  group.add(barFront);
  solid(BX0, BZ, BW + 0.6, 1.5);
  // Stools in front of the bar (cosmetic — small, set in the clear approach lane).
  function stool(lx, lz) {
    const seat = mesh(G.stoolSeat, cushionMat, true, false);
    seat.position.set(lx, 0.82, lz);
    group.add(seat);
    const post = mesh(G.stoolLeg, steelMat, false, false);
    post.scale.y = 0.82;
    post.position.set(lx, 0.41, lz);
    group.add(post);
    const foot = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 14), steelDarkMat, false, false);
    foot.position.set(lx, 0.04, lz);
    group.add(foot);
  }
  for (const sx of [-15.5, -11.5, -7.5, -3.5]) stool(sx, BZ - 1.5);

  // Backlit bottle shelf against the +Z wall. The back panel SHIMMERS (two-sine).
  const shelfBack = new THREE.MeshStandardMaterial({ color: "#2a1840", emissive: "#7a3aff", emissiveIntensity: 0.7, roughness: 0.5 });
  const backPanel = box(BW, 2.6, 0.08, shelfBack, false, false);
  backPanel.position.set(BX0, 2.4, HZ - 0.25);
  group.add(backPanel);
  backlights.push({ mat: shelfBack, base: 0.6, amp: 0.32, r1: 1.7, r2: 3.1, phase: 0.0 });
  for (const sy of [1.55, 2.45, 3.35]) {
    const shelf = box(BW, 0.08, 0.5, shelfMat, false, false);
    shelf.position.set(BX0, sy, HZ - 0.55);
    group.add(shelf);
    for (let bx = -7; bx <= 7; bx += 0.9) {
      const bm = bottleMats[(Math.abs(Math.round(bx)) + Math.round(sy)) % bottleMats.length];
      const bottle = mesh(G.bottle, bm, false, false);
      bottle.scale.y = 0.8 + ((bx + 7) % 3) * 0.18;
      bottle.position.set(BX0 + bx, sy + 0.4, HZ - 0.6);
      group.add(bottle);
    }
  }

  // ── 6) CHALKBOARD MENU on the -X corner STUB ─────────────────────────────────
  // Re-anchored from the old (now removed) full -X wall onto the -Z corner stub so
  // it still hangs flush against solid structure, clear of the new doorway gap.
  {
    const cz = -11, by = 2.5;
    const fr = box(0.06, 2.3, 3.9, boardFrameMat, false, false);
    fr.position.set(-HX + 0.12, by, cz);
    group.add(fr);
    const bd = box(0.05, 2.0, 3.6, boardMat, false, false);
    bd.position.set(-HX + 0.16, by, cz);
    group.add(bd);
    // A warm header line + a few pale "menu" lines chalked on.
    const hdr = box(0.02, 0.16, 2.6, chalkWarmMat, false, false);
    hdr.position.set(-HX + 0.19, by + 0.78, cz);
    group.add(hdr);
    let li = 0;
    for (const yy of [0.35, 0.05, -0.25, -0.55, -0.85]) {
      const len = 2.4 - (li % 3) * 0.6;
      const line = box(0.02, 0.07, len, chalkMat, false, false);
      line.position.set(-HX + 0.19, by + yy, cz - (2.6 - len) / 2 + 0.3);
      group.add(line);
      li++;
    }
  }

  // ── 7) BIG VIEWPORT on the +X END, Earth drifting beyond — OPENED ─────────────
  // The +X glazing is split into two side lights with a WIDE centred full-height
  // doorway (11 m) so you walk straight out this end of the zone. The header stays
  // full-width as the doorway LINTEL; the sill, glass and central mullions are cut
  // away across the opening. Earth + frame are kept.
  {
    const fx = HX + WALL_T / 2;
    const xdoor = XDOOR_HALF;                 // same 11 m centred doorway as the -X end
    // Header acts as the doorway lintel (kept full-width, overhead).
    const header = box(WALL_T, 1.0, 2 * HZ, frameMat, false, false);
    header.position.set(fx, WALL_H - 0.5, 0); group.add(header);
    const openH = WALL_H - 1.9, openCY = 0.9 + openH / 2;
    // Sill + glazing as two side lights, leaving the central doorway clear.
    const sillLen = HZ - xdoor;               // 10.5 each side
    const glassLen = (HZ - 0.3) - xdoor;      // 10.2 each side (matches old 2*HZ-0.6 glazing)
    for (const sz of [-1, 1]) {
      const sill = box(WALL_T, 0.9, sillLen, frameMat, false, false);
      sill.position.set(fx, 0.45, sz * (xdoor + sillLen / 2)); group.add(sill);
      const glass = box(0.12, openH, glassLen, glassMat, false, false);
      glass.position.set(fx, openCY, sz * (xdoor + glassLen / 2)); group.add(glass);
    }
    // Outer mullions only (central -5/0/5 mullions removed for the doorway).
    for (const mz of [-10, 10]) {
      const mull = box(0.22, openH, 0.2, frameMat, false, false);
      mull.position.set(fx, openCY, mz); group.add(mull);
    }
  }
  // Earth: a child of the group so it tracks the room, parked far in +X beyond the
  // window. Slowly spins + drifts in update().
  const earth = mesh(new THREE.IcosahedronGeometry(34, 2), earthMat, false, false);
  const earthBaseX = 132, earthBaseY = 8, earthBaseZ = 6;
  earth.position.set(earthBaseX, earthBaseY, earthBaseZ);
  group.add(earth);
  for (const [ea, eb, es] of [[0.4, 0.3, 13], [-0.7, 0.9, 9], [1.7, -0.4, 11], [2.6, 0.4, 8]]) {
    const land = mesh(new THREE.SphereGeometry(es, 12, 9), earthLandMat, false, false);
    const nx = Math.cos(ea) * Math.cos(eb), ny = Math.sin(eb), nz = Math.sin(ea) * Math.cos(eb);
    land.position.set(nx * 32, ny * 32, nz * 32);
    land.scale.set(1, 1, 0.25);
    earth.add(land);
  }
  for (const [ca, cb, cs] of [[1.1, 0.7, 9], [-1.4, -0.2, 7], [0.2, 1.3, 6]]) {
    const cloud = mesh(new THREE.SphereGeometry(cs, 10, 7), earthCloudMat, false, false);
    const nx = Math.cos(ca) * Math.cos(cb), ny = Math.sin(cb), nz = Math.sin(ca) * Math.cos(cb);
    cloud.position.set(nx * 33.5, ny * 33.5, nz * 33.5);
    cloud.scale.set(1, 1, 0.18);
    earth.add(cloud);
  }

  // ── 8) POT PLANTS flanking the window + bar (soft green against the steel) ────
  function plant(lx, lz) {
    const pl = mesh(G.planter, potMat, true, true);
    pl.position.set(lx, 0.45, lz);
    group.add(pl);
    const soil = mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 16), soilMat, false, false);
    soil.position.set(lx, 0.9, lz);
    group.add(soil);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 0.2 + (i % 3) * 0.12;
      const blade = mesh(new THREE.ConeGeometry(0.16, 1.0 + (i % 3) * 0.4, 5), i % 2 ? leafMat2 : leafMat, false, false);
      blade.position.set(lx + Math.cos(a) * r, 1.4, lz + Math.sin(a) * r);
      blade.rotation.set(Math.cos(a) * 0.4, a, Math.sin(a) * 0.4);
      group.add(blade);
    }
    solid(lx, lz, 1.4, 1.4);
  }
  plant(16.5, 12.5);
  plant(16.5, -12.5);
  plant(-16.5, 7);

  // ── 9) ROBOT SERVER — a hovering droid ferrying a tray of food down the line ──
  const robot = new THREE.Group();
  group.add(robot);
  {
    const body = mesh(new THREE.CapsuleGeometry(0.42, 0.5, 6, 14), robotMat, true, false);
    body.position.y = 1.1;
    robot.add(body);
    const collar = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 16), robotTrimMat, false, false);
    collar.position.y = 1.45;
    robot.add(collar);
    const head = mesh(new THREE.SphereGeometry(0.32, 14, 12), robotMat, true, false);
    head.position.y = 1.75;
    robot.add(head);
    const visor = mesh(new THREE.BoxGeometry(0.44, 0.16, 0.1), visorMat, false, false);
    visor.position.set(0.3, 1.78, 0); // an eye-band across the +X face (the leading face)
    visor.rotation.y = Math.PI / 2;   // width spans Z, thin dimension pokes out +X
    robot.add(visor);
    glows.push({ mat: visorMat, base: 0.8, amp: 0.25, rate: 2.4, phase: 0 });
    // Arms holding a tray out front (+X local).
    for (const sz of [-1, 1]) {
      const arm = mesh(new THREE.CapsuleGeometry(0.07, 0.45, 4, 8), robotMat, false, false);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(0.35, 1.05, sz * 0.32);
      robot.add(arm);
    }
    const carryTray = box(0.05, 0.05, 0.7, trayMat, false, false);
    carryTray.scale.x = 12; // 0.6 wide along +X
    carryTray.position.set(0.62, 0.92, 0);
    robot.add(carryTray);
    for (let i = 0; i < 3; i++) {
      const col = ["#ffae3a", "#9be84a", "#ff6a3a"][i];
      const fm = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, roughness: 0.5 });
      const f = mesh(G.foodBlob, fm, false, false);
      f.position.set(0.62, 1.0, -0.22 + i * 0.22);
      robot.add(f);
      glows.push({ mat: fm, base: 0.6, amp: 0.25, rate: 1.6 + i * 0.4, phase: i * 2.1 });
    }
    // Glowing antigrav thruster underneath.
    const thMat = new THREE.MeshStandardMaterial({ color: "#7ad0ff", emissive: "#37b0ff", emissiveIntensity: 1.1, roughness: 0.4, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const thr = mesh(G.thruster, thMat, false, false);
    thr.position.y = 0.45;
    robot.add(thr);
    glows.push({ mat: thMat, base: 1.0, amp: 0.45, rate: 3.4, phase: 1.0 });
    // Blinking status light on the collar.
    const statMat = new THREE.MeshStandardMaterial({ color: "#37ff7a", emissive: "#19e85f", emissiveIntensity: 1.0 });
    const stat = mesh(new THREE.SphereGeometry(0.07, 8, 6), statMat, false, false);
    stat.position.set(-0.4, 1.45, 0);
    robot.add(stat);
    beacons.push({ mat: statMat, hi: 1.4, lo: 0.1, rate: 1.8, phase: 0 });
  }
  // Patrol params: hovers in the clear lane in front of the kitchen line.
  const RB = { x: -2, z: -9.0, minX: -10, maxX: 10, dir: 1, speed: 1.6, baseY: 0.0 };

  // ── Steam-column factory (call during build; advanced in update) ─────────────
  function addSteamColumn(lx, ly, lz, n) {
    for (let i = 0; i < n; i++) {
      const sm = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.18, roughness: 1, transparent: true, opacity: 0.0, depthWrite: false });
      const puff = mesh(G.steamPuff, sm, false, false);
      puff.position.set(lx, ly, lz);
      group.add(puff);
      steam.push({ mesh: puff, mat: sm, baseY: ly, rise: 1.1, rate: 0.45 + i * 0.12, phase: i / n, maxO: 0.4 });
    }
  }

  // ── Animation — ALLOCATION-FREE ──────────────────────────────────────────────
  let t = 0;
  function update(dt) {
    t += dt;
    // Smooth emissive pulses: dispensers, food, burners, bulbs, ceiling, thruster.
    for (let i = 0; i < glows.length; i++) {
      const g = glows[i];
      g.mat.emissiveIntensity = g.base + Math.sin(t * g.rate + g.phase) * g.amp;
    }
    // Bar back-light shimmer (two beating sines for a restless glow).
    for (let i = 0; i < backlights.length; i++) {
      const b = backlights[i];
      b.mat.emissiveIntensity = b.base + (Math.sin(t * b.r1 + b.phase) * 0.6 + Math.sin(t * b.r2) * 0.4) * b.amp;
    }
    // Sharp blink beacons (robot status light).
    for (let i = 0; i < beacons.length; i++) {
      const bc = beacons[i];
      bc.mat.emissiveIntensity = Math.sin(t * bc.rate + bc.phase) > 0.4 ? bc.hi : bc.lo;
    }
    // Coffee/pot STEAM: each puff rises, swells, and fades on a looping phase.
    for (let i = 0; i < steam.length; i++) {
      const s = steam[i];
      let p = (t * s.rate + s.phase) % 1;
      if (p < 0) p += 1;
      s.mesh.position.y = s.baseY + p * s.rise;
      s.mesh.scale.setScalar(0.35 + p * 1.1);
      s.mat.opacity = (1 - p) * s.maxO;
    }
    // ROBOT SERVER patrol: glide along X, turn at the ends, hover-bob + lean.
    RB.x += RB.dir * RB.speed * dt;
    if (RB.x > RB.maxX) { RB.x = RB.maxX; RB.dir = -1; }
    else if (RB.x < RB.minX) { RB.x = RB.minX; RB.dir = 1; }
    robot.position.x = RB.x;
    robot.position.z = RB.z;
    robot.position.y = RB.baseY + Math.sin(t * 3.0) * 0.06;
    robot.rotation.y = RB.dir > 0 ? 0 : Math.PI;        // visor/tray face travel dir
    robot.rotation.z = -RB.dir * 0.06 + Math.sin(t * 1.4) * 0.02; // gentle lean
    // EARTH: slow spin + a lazy drift across the viewport.
    earth.rotation.y += dt * 0.012;
    earth.position.x = earthBaseX + Math.sin(t * 0.04) * 3;
    earth.position.y = earthBaseY + Math.cos(t * 0.031) * 2;
    earth.position.z = earthBaseZ + Math.sin(t * 0.027) * 4;
  }

  return { group, update, ground, colliders };
}
