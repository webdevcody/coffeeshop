// STATION CARGO BAY — a big pressurised industrial loading bay bolted onto the
// orbital station, sitting up at the station altitude (well east of the city
// footprint so its deck never fights the y=0 ground at the same XZ).
//
// buildStationCargo(opts) returns the OCEAN/SPACE-style contract:
//   group      — THREE.Group parked at WORLD (ox, floorY, oz); ALL content is built
//                in LOCAL deck coords with the deck top at local y = 0.
//   update(dt) — allocation-free: slow gantry-crane traverse, blinking status
//                beacons, slowly-rotating scanner rings, and an airlock light cycle.
//   ground     — ONE walkable deck rect in WORLD XZ: the inscribed bay floor.
//   colliders  — TIGHT world-space AABBs for the solid props (perimeter walls,
//                container stacks, crates, barrels, the forklift, scanner-gate
//                posts). A central drive lane (local x∈[-3,3], full depth) plus the
//                front doorway gap are left collider-free so there is a clear path.
//
// ── WHAT'S IN THE BAY ─────────────────────────────────────────────────────────
//   • Stacks of colourful, labelled ISO shipping CONTAINERS (corrugated sides,
//     corner castings, locking-bar door ends) + wooden CRATE stacks under cargo
//     NETTING + clustered colour-coded BARRELS on pallets.
//   • An overhead GANTRY CRANE on wall rails: a bridge girder that slowly traverses
//     the length of the bay, a trolley that drifts across it, and a hanging
//     chain + hook block with a robotic grab claw.
//   • A FORKLIFT loader parked off the drive lane.
//   • A big side AIRLOCK in the +X wall: a sealed round hatch + a framed VIEWPORT
//     onto a starfield with a docked SUPPLY POD just outside, ringed by an airlock
//     light strip that cycles colour.
//   • Two SCANNER GATES straddling the drive lane, each with a rotating sensor
//     ring; hazard-stripe floor markings; blinking beacons; hanging chains.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// All materials + shared geometries are created ONCE at module scope. The build
// phase allocates freely; update(dt) only mutates cached transforms / material
// scalars on small handle lists — no `new` per frame (Color.setHSL mutates in
// place, so the airlock hue sweep is allocation-free too).

import * as THREE from "three";

// ── Shared materials (created ONCE) ───────────────────────────────────────────
// Deck + floor markings.
const deckMat       = new THREE.MeshStandardMaterial({ color: "#3a4048", roughness: 0.78, metalness: 0.4 });
const deckSeamMat   = new THREE.MeshStandardMaterial({ color: "#2b3036", roughness: 0.85, metalness: 0.35 });
const hazardYMat    = new THREE.MeshStandardMaterial({ color: "#e8c01f", roughness: 0.6, emissive: "#5a4400", emissiveIntensity: 0.3, side: THREE.DoubleSide });
const hazardKMat    = new THREE.MeshStandardMaterial({ color: "#16181b", roughness: 0.8, side: THREE.DoubleSide });
const laneLineMat   = new THREE.MeshStandardMaterial({ color: "#cdd4db", roughness: 0.7, side: THREE.DoubleSide });
// Hull walls + ceiling.
const wallMat       = new THREE.MeshStandardMaterial({ color: "#9aa3ad", roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
const wallRibMat    = new THREE.MeshStandardMaterial({ color: "#6f7984", roughness: 0.55, metalness: 0.45 });
const ceilMat       = new THREE.MeshStandardMaterial({ color: "#828b95", roughness: 0.65, metalness: 0.3, side: THREE.DoubleSide });
const ceilStripMat  = new THREE.MeshStandardMaterial({ color: "#eaf4ff", roughness: 0.3, emissive: "#bfe0ff", emissiveIntensity: 0.9 });
// Containers.
const containerMats = [
  new THREE.MeshStandardMaterial({ color: "#b23a32", roughness: 0.72, metalness: 0.25 }),
  new THREE.MeshStandardMaterial({ color: "#2f6db5", roughness: 0.72, metalness: 0.25 }),
  new THREE.MeshStandardMaterial({ color: "#2f8f57", roughness: 0.72, metalness: 0.25 }),
  new THREE.MeshStandardMaterial({ color: "#d6802a", roughness: 0.72, metalness: 0.25 }),
  new THREE.MeshStandardMaterial({ color: "#2aa39a", roughness: 0.72, metalness: 0.25 }),
  new THREE.MeshStandardMaterial({ color: "#7d4aa8", roughness: 0.72, metalness: 0.25 }),
  new THREE.MeshStandardMaterial({ color: "#c9a92a", roughness: 0.72, metalness: 0.25 }),
];
const contFrameMat = new THREE.MeshStandardMaterial({ color: "#2c3036", roughness: 0.6, metalness: 0.55 });
const labelMat     = new THREE.MeshStandardMaterial({ color: "#e8ebf0", roughness: 0.5, emissive: "#20242a", emissiveIntensity: 0.25 });
// Crates + pallets + barrels.
const crateMat     = new THREE.MeshStandardMaterial({ color: "#9c7338", roughness: 0.88 });
const crateEdgeMat = new THREE.MeshStandardMaterial({ color: "#6f4f24", roughness: 0.9 });
const palletMat    = new THREE.MeshStandardMaterial({ color: "#b08a4e", roughness: 0.9 });
const barrelMats   = [
  new THREE.MeshStandardMaterial({ color: "#b8402f", roughness: 0.55, metalness: 0.35 }),
  new THREE.MeshStandardMaterial({ color: "#2f6fb8", roughness: 0.55, metalness: 0.35 }),
  new THREE.MeshStandardMaterial({ color: "#d8b62a", roughness: 0.55, metalness: 0.35 }),
  new THREE.MeshStandardMaterial({ color: "#3a8d54", roughness: 0.55, metalness: 0.35 }),
];
const barrelRimMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.6, metalness: 0.5 });
const nettingMat   = new THREE.MeshBasicMaterial({ color: "#1c1f24", wireframe: true, transparent: true, opacity: 0.5 });
// Steel / gantry crane / chains.
const steelMat     = new THREE.MeshStandardMaterial({ color: "#5a626b", roughness: 0.5, metalness: 0.7 });
const steelDarkMat = new THREE.MeshStandardMaterial({ color: "#3c424a", roughness: 0.6, metalness: 0.65 });
const craneYellow  = new THREE.MeshStandardMaterial({ color: "#e0a92a", roughness: 0.55, metalness: 0.5 });
const hookMat      = new THREE.MeshStandardMaterial({ color: "#6a7178", roughness: 0.5, metalness: 0.7 });
const chainMat     = new THREE.MeshStandardMaterial({ color: "#4a4f56", roughness: 0.55, metalness: 0.75 });
const cableMat     = new THREE.MeshStandardMaterial({ color: "#26282b", roughness: 0.8 });
// Forklift.
const fkBody = new THREE.MeshStandardMaterial({ color: "#e8a51f", roughness: 0.55, metalness: 0.35 });
const fkDark = new THREE.MeshStandardMaterial({ color: "#2a2d31", roughness: 0.7, metalness: 0.4 });
const fkMast = new THREE.MeshStandardMaterial({ color: "#6b7179", roughness: 0.5, metalness: 0.65 });
const fkFork = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.45, metalness: 0.7 });
const fkSeat = new THREE.MeshStandardMaterial({ color: "#20242a", roughness: 0.8 });
const tireMat = new THREE.MeshStandardMaterial({ color: "#1a1c1f", roughness: 0.95 });
// Airlock + viewport + supply pod.
const airlockFrameMat = new THREE.MeshStandardMaterial({ color: "#80878f", roughness: 0.5, metalness: 0.6 });
const hatchMat   = new THREE.MeshStandardMaterial({ color: "#6b7179", roughness: 0.5, metalness: 0.65 });
const lockWheelMat = new THREE.MeshStandardMaterial({ color: "#c8a23a", roughness: 0.45, metalness: 0.6 });
const glassMat   = new THREE.MeshStandardMaterial({ color: "#08101f", roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.18, side: THREE.DoubleSide, emissive: "#0a1428", emissiveIntensity: 0.2 });
const spaceBackMat = new THREE.MeshBasicMaterial({ color: "#05070e", side: THREE.DoubleSide, fog: false });
const airlockLightMat = new THREE.MeshStandardMaterial({ color: "#19e85f", roughness: 0.4, emissive: "#19e85f", emissiveIntensity: 1.0 });
const podMat     = new THREE.MeshStandardMaterial({ color: "#d6dade", roughness: 0.45, metalness: 0.35, fog: false });
const podDarkMat = new THREE.MeshStandardMaterial({ color: "#8b939c", roughness: 0.5, metalness: 0.4, fog: false });
const podFinMat  = new THREE.MeshStandardMaterial({ color: "#1b2c63", roughness: 0.35, metalness: 0.25, emissive: "#16307a", emissiveIntensity: 0.25, flatShading: true, fog: false });
const podCollarMat = new THREE.MeshStandardMaterial({ color: "#3a4250", roughness: 0.55, metalness: 0.5, fog: false });
// Scanner gates.
const scanFrameMat = new THREE.MeshStandardMaterial({ color: "#4a525c", roughness: 0.5, metalness: 0.55 });
const scanRingMat  = new THREE.MeshStandardMaterial({ color: "#1fd4ff", roughness: 0.3, metalness: 0.2, emissive: "#1fd4ff", emissiveIntensity: 0.8 });
const scanPodMat   = new THREE.MeshStandardMaterial({ color: "#20242a", roughness: 0.6, metalness: 0.5 });

// ── Shared geometries (created ONCE) ──────────────────────────────────────────
const beaconGeo    = new THREE.SphereGeometry(0.16, 8, 6);
const chainLinkGeo = new THREE.TorusGeometry(0.09, 0.035, 6, 8);
const barrelGeo    = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 14);
const barrelRimGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.08, 14);
const tireGeo      = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 12);

// Container dimensions (length along local X, width along Z, height).
const CL = 6.0, CW = 2.5, CH = 2.6;

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = true, receive = true) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}
function cyl(rt, rb, h, mat, cast = true, receive = true) {
  return mesh(new THREE.CylinderGeometry(rt, rb, h, 14), mat, cast, receive);
}

// A single ISO shipping container: corrugated body, 8 corner castings, a locking-
// bar door end on +X, a side label placard on -Z. Local origin at base centre.
function makeContainer(mat) {
  const g = new THREE.Group();
  const body = box(CL, CH, CW, mat);
  body.position.y = CH / 2;
  g.add(body);
  // Corrugation ribs down both long (±Z) faces.
  const ribGeo = new THREE.BoxGeometry(0.12, CH * 0.82, 0.08);
  for (const sz of [1, -1]) {
    for (let i = 0; i < 11; i++) {
      const rx = -CL / 2 + 0.5 + i * ((CL - 1) / 10);
      const rib = mesh(ribGeo, contFrameMat, false, false);
      rib.position.set(rx, CH / 2, sz * (CW / 2 + 0.03));
      g.add(rib);
    }
  }
  // Corner castings.
  const ccGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
    const cc = mesh(ccGeo, contFrameMat, false, false);
    cc.position.set(sx * (CL / 2 - 0.04), sy ? CH - 0.21 : 0.21, sz * (CW / 2 - 0.04));
    g.add(cc);
  }
  // Door end (+X): recessed panel + vertical locking bars + handles.
  const doorPanel = box(0.14, CH * 0.92, CW * 0.94, contFrameMat, false);
  doorPanel.position.set(CL / 2 + 0.02, CH / 2, 0);
  g.add(doorPanel);
  for (const bz of [-0.55, -0.18, 0.18, 0.55]) {
    const bar = box(0.14, CH * 0.86, 0.1, wallRibMat, false, false);
    bar.position.set(CL / 2 + 0.09, CH / 2, bz);
    g.add(bar);
    const handle = box(0.06, 0.5, 0.06, contFrameMat, false, false);
    handle.position.set(CL / 2 + 0.16, CH / 2, bz);
    g.add(handle);
  }
  // Side label placard.
  const label = box(1.6, 0.9, 0.06, labelMat, false, false);
  label.position.set(-CL * 0.18, CH * 0.62, -(CW / 2 + 0.05));
  g.add(label);
  return g;
}

// A wooden crate stack on a pallet (3 jittered cubes with a banded mid-strap).
function makeCrateStack() {
  const g = new THREE.Group();
  const pal = box(2.0, 0.18, 2.0, palletMat, false);
  pal.position.y = 0.09;
  g.add(pal);
  for (const pz of [-0.7, 0, 0.7]) {
    const pl = box(2.0, 0.1, 0.18, palletMat, false);
    pl.position.set(0, 0.04, pz);
    g.add(pl);
  }
  const cubes = [
    { s: 1.5, x: 0.0, z: 0.0, y: 0.95, r: 0.0 },
    { s: 1.2, x: 0.25, z: -0.2, y: 1.98, r: 0.25 },
    { s: 1.0, x: -0.35, z: 0.3, y: 2.85, r: -0.2 },
  ];
  for (const c of cubes) {
    const cr = box(c.s, c.s, c.s, crateMat);
    cr.position.set(c.x, c.y, c.z);
    cr.rotation.y = c.r;
    g.add(cr);
    const band = box(c.s * 1.02, 0.16, c.s * 1.02, crateEdgeMat, false, false);
    band.position.set(c.x, c.y, c.z);
    band.rotation.y = c.r;
    g.add(band);
  }
  return g;
}

// A cluster of colour-coded barrels on a pallet (2 hoop rims each).
function makeBarrelCluster(cols) {
  const g = new THREE.Group();
  const pal = box(2.2, 0.16, 2.2, palletMat, false);
  pal.position.y = 0.08;
  g.add(pal);
  const spots = [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55], [0, 0]];
  for (let i = 0; i < cols.length; i++) {
    const [bx, bz] = spots[i % spots.length];
    const barrel = mesh(barrelGeo, cols[i]);
    barrel.position.set(bx, 0.71, bz);
    g.add(barrel);
    for (const ry of [0.4, 0.95]) {
      const rim = mesh(barrelRimGeo, barrelRimMat, false, false);
      rim.position.set(bx, 0.16 + ry, bz);
      g.add(rim);
    }
  }
  return g;
}

// A forklift loader (counterweight chassis, operator cage, mast + forks, 4 tyres).
// Built facing +X (forks point +X). Local origin at base centre between the axles.
function makeForklift() {
  const g = new THREE.Group();
  const bodyM = box(2.2, 0.9, 1.3, fkBody);
  bodyM.position.set(-0.1, 0.75, 0);
  g.add(bodyM);
  const hood = box(1.0, 0.6, 1.2, fkBody);
  hood.position.set(-0.7, 1.25, 0);
  g.add(hood);
  const counter = box(0.5, 0.8, 1.2, fkDark);
  counter.position.set(-1.25, 0.7, 0);
  g.add(counter);
  // Operator cage (posts + roof).
  for (const sx of [-0.9, 0.0]) for (const sz of [-0.55, 0.55]) {
    const post = box(0.08, 1.3, 0.08, fkDark, false);
    post.position.set(sx, 1.9, sz);
    g.add(post);
  }
  const roof = box(1.1, 0.1, 1.4, fkDark, false);
  roof.position.set(-0.45, 2.55, 0);
  g.add(roof);
  const seat = box(0.5, 0.18, 0.6, fkSeat, false);
  seat.position.set(-0.5, 1.25, 0);
  g.add(seat);
  const seatBack = box(0.14, 0.5, 0.6, fkSeat, false);
  seatBack.position.set(-0.75, 1.5, 0);
  g.add(seatBack);
  // Tyres.
  for (const [wx, wz] of [[0.6, 0.62], [0.6, -0.62], [-0.9, 0.55], [-0.9, -0.55]]) {
    const w = mesh(tireGeo, tireMat, true, false);
    w.rotation.x = Math.PI / 2;
    w.position.set(wx, 0.42, wz);
    g.add(w);
  }
  // Mast + carriage + forks (front, +X).
  for (const sz of [-0.45, 0.45]) {
    const rail = box(0.12, 2.6, 0.12, fkMast);
    rail.position.set(1.0, 1.3, sz);
    g.add(rail);
  }
  const mastTop = box(0.12, 0.14, 1.1, fkMast, false);
  mastTop.position.set(1.0, 2.55, 0);
  g.add(mastTop);
  const carriage = box(0.12, 0.6, 1.0, fkFork, false);
  carriage.position.set(1.08, 0.7, 0);
  g.add(carriage);
  for (const sz of [-0.32, 0.32]) {
    const fork = box(1.3, 0.08, 0.16, fkFork);
    fork.position.set(1.75, 0.45, sz);
    g.add(fork);
  }
  return g;
}

export function buildStationCargo(opts = {}) {
  const ox = opts.ox != null ? opts.ox : 586;
  const oz = opts.oz != null ? opts.oz : 130;
  const floorY = opts.floorY != null ? opts.floorY : 260;

  const group = new THREE.Group();
  group.name = "stationCargo";
  group.position.set(ox, floorY, oz);

  // Bay half-extents (deck top at local y=0). Ground rect is the inscribed floor.
  const HX = 19, HZ = 16;
  const WALL_H = 9.6, WALL_T = 0.5, CEIL_Y = 9.6;

  // Contract arrays.
  const ground = [{ minX: ox - HX, maxX: ox + HX, minZ: oz - HZ, maxZ: oz + HZ }];
  const colliders = [];

  // Animated handles (mutated allocation-free in update).
  const beacons = [];   // { mat, rate, phase }
  const scanners = [];  // { ring, mat, rate, phase }

  // Push a TIGHT world AABB from a LOCAL centre + size.
  function solid(lx, lz, w, d) {
    colliders.push({ minX: ox + lx - w / 2, maxX: ox + lx + w / 2, minZ: oz + lz - d / 2, maxZ: oz + lz + d / 2 });
  }
  // A blinking status beacon parented under `parent` (LOCAL coords there).
  function addBeacon(parent, x, y, z, hex, rate, phase) {
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4, emissive: hex, emissiveIntensity: 1.4 });
    const b = mesh(beaconGeo, m, false, false);
    b.position.set(x, y, z);
    parent.add(b);
    beacons.push({ mat: m, rate, phase });
    return b;
  }

  // ── 1) DECK + ceiling + glow strips ─────────────────────────────────────────
  const deck = box(HX * 2, 0.4, HZ * 2, deckMat, false, true);
  deck.position.y = -0.2;
  group.add(deck);
  // Plate seams (cosmetic grid lines just above the deck).
  for (let gx = -12; gx <= 12; gx += 6) {
    const seam = box(0.12, 0.04, HZ * 2 - 1, deckSeamMat, false, false);
    seam.position.set(gx, 0.02, 0);
    group.add(seam);
  }
  for (let gz = -12; gz <= 12; gz += 6) {
    const seam = box(HX * 2 - 1, 0.04, 0.12, deckSeamMat, false, false);
    seam.position.set(0, 0.02, gz);
    group.add(seam);
  }
  const ceil = box(HX * 2, 0.3, HZ * 2, ceilMat, false, false);
  ceil.position.y = CEIL_Y;
  group.add(ceil);
  for (const cz of [-9, 0, 9]) {
    const strip = box(HX * 1.7, 0.08, 0.5, ceilStripMat, false, false);
    strip.position.set(0, CEIL_Y - 0.22, cz);
    group.add(strip);
  }

  // ── 2) PERIMETER HULL WALLS (solid colliders; front doorway gap left open) ──
  // Back (+Z) and left (-X) walls full span; right (+X) wall is segmented around
  // the airlock VIEWPORT so the starfield shows through it; front (-Z) wall has a
  // central doorway gap (x∈[-3,3]) aligned with the drive lane.
  function wallPanel(cx, cy, cz, w, h, d) {
    const wl = box(w, h, d, wallMat, false, true);
    wl.position.set(cx, cy, cz);
    group.add(wl);
  }
  // Back wall.
  wallPanel(0, WALL_H / 2, HZ + WALL_T / 2, HX * 2 + WALL_T, WALL_H, WALL_T);
  solid(0, HZ + WALL_T / 2, HX * 2 + WALL_T, WALL_T);
  // Left wall.
  wallPanel(-HX - WALL_T / 2, WALL_H / 2, 0, WALL_T, WALL_H, HZ * 2);
  solid(-HX - WALL_T / 2, 0, WALL_T, HZ * 2);
  // Front wall: two flanks around the doorway gap.
  for (const sx of [-1, 1]) {
    const segW = HX - 3;            // each flank x∈[3,19] (or mirror)
    wallPanel(sx * (3 + segW / 2), WALL_H / 2, -HZ - WALL_T / 2, segW, WALL_H, WALL_T);
    solid(sx * (3 + segW / 2), -HZ - WALL_T / 2, segW, WALL_T);
  }
  // Doorway lintel over the gap (high — no collider, walk-through).
  const lintel = box(6.2, WALL_H - 2.6, WALL_T, wallMat, false, false);
  lintel.position.set(0, 2.6 + (WALL_H - 2.6) / 2, -HZ - WALL_T / 2);
  group.add(lintel);
  // Right (+X) wall — segmented around a viewport opening z∈[1,9], y∈[1.4,5.6].
  const RWX = HX + WALL_T / 2;
  const winZ0 = 1, winZ1 = 9, winY0 = 1.4, winY1 = 5.6;
  wallPanel(RWX, winY0 / 2, 0, WALL_T, winY0, HZ * 2);                                  // below sill
  wallPanel(RWX, (winY1 + WALL_H) / 2, 0, WALL_T, WALL_H - winY1, HZ * 2);              // above header
  wallPanel(RWX, (winY0 + winY1) / 2, (-HZ + winZ0) / 2, WALL_T, winY1 - winY0, HZ + winZ0); // south of window
  wallPanel(RWX, (winY0 + winY1) / 2, (HZ + winZ1) / 2, WALL_T, winY1 - winY0, HZ - winZ1);  // north of window
  solid(RWX, 0, WALL_T, HZ * 2); // full-span collider (glass is impassable anyway)
  // Wall ribs down the back wall for an industrial read (cosmetic).
  for (let rx = -16; rx <= 16; rx += 4) {
    const rib = box(0.3, WALL_H - 0.6, 0.3, wallRibMat, false, false);
    rib.position.set(rx, (WALL_H - 0.6) / 2, HZ - 0.25);
    group.add(rib);
  }

  // ── 3) HAZARD-STRIPE FLOOR MARKINGS ─────────────────────────────────────────
  // Drive-lane edge lines (x=±3, full depth).
  for (const sx of [-3, 3]) {
    const line = box(0.22, 0.04, HZ * 2 - 1, laneLineMat, false, false);
    line.position.set(sx, 0.03, 0);
    group.add(line);
  }
  // Hazard chevron band across the front threshold.
  for (let i = 0; i < 26; i++) {
    const seg = box(1.2, 0.04, 0.55, i % 2 ? hazardKMat : hazardYMat, false, false);
    seg.position.set(-15.6 + i * 1.25, 0.035, -14.6);
    seg.rotation.y = 0.5;
    group.add(seg);
  }
  // A yellow "drop zone" outline under the crane on the right floor.
  for (const [lx, lz, lw, ld] of [[10, -8.4, 6, 0.2], [10, -3.6, 6, 0.2], [7.1, -6, 0.2, 5], [12.9, -6, 0.2, 5]]) {
    const m = box(lw, 0.04, ld, hazardYMat, false, false);
    m.position.set(lx, 0.035, lz);
    group.add(m);
  }

  // ── 4) SHIPPING CONTAINER STACKS ────────────────────────────────────────────
  // Each entry: [cx, cz, rotY, [matIndex per stacked level]]. Footprint collider
  // is one tight AABB sized to the rotated container plan. All kept off the lane.
  const i_even = (v) => (Math.floor(v) % 2 === 0);
  function placeStack(cx, cz, rotY, levels) {
    for (let i = 0; i < levels.length; i++) {
      const c = makeContainer(containerMats[levels[i] % containerMats.length]);
      c.position.set(cx + (i % 2 ? 0.12 : -0.1), i * CH, cz);
      c.rotation.y = rotY;
      group.add(c);
    }
    // Corner beacon on the top container.
    addBeacon(group, cx, levels.length * CH + 0.1, cz, i_even(cz) ? "#37ff7a" : "#ff4533", 2.2 + (cx % 3) * 0.3, (cx + cz) * 0.4);
    const alongX = Math.abs(Math.cos(rotY)) > 0.5;
    const w = alongX ? CL : CW;
    const d = alongX ? CW : CL;
    solid(cx, cz, w + 0.3, d + 0.3);
  }

  // Left half (x < -4).
  placeStack(-13, 12.0, 0, [0, 2]);
  placeStack(-7, 13.6, 0, [3]);
  placeStack(-16, 4.0, Math.PI / 2, [1, 4]);
  placeStack(-10.5, 8.5, 0, [5, 6]);
  // Right half (x > 4).
  placeStack(12, 12.0, 0, [4, 1, 3]);
  placeStack(6.6, 13.6, 0, [2, 0]);
  placeStack(16, 5.5, Math.PI / 2, [6, 3]);
  placeStack(9.5, 8.0, 0, [0]);

  // ── 5) CRATE STACKS (+ cargo netting) & BARRELS ─────────────────────────────
  for (const [cx, cz] of [[-9, -4], [13.5, -3]]) {
    const cs = makeCrateStack();
    cs.position.set(cx, 0, cz);
    cs.rotation.y = (cx + cz) * 0.2;
    group.add(cs);
    // Drape cargo netting over the stack.
    const net = box(2.2, 3.2, 2.2, nettingMat, false, false);
    net.position.set(cx, 1.7, cz);
    group.add(net);
    solid(cx, cz, 3.1, 3.1);
  }
  for (const [cx, cz, idx] of [[-15.5, -9, 0], [8, -11, 1]]) {
    const cols = [barrelMats[idx], barrelMats[(idx + 1) % 4], barrelMats[(idx + 2) % 4], barrelMats[(idx + 3) % 4], barrelMats[idx]];
    const bc = makeBarrelCluster(cols);
    bc.position.set(cx, 0, cz);
    group.add(bc);
    solid(cx, cz, 2.4, 2.4);
  }

  // ── 6) FORKLIFT (parked off the lane, facing the bay centre) ────────────────
  const forklift = makeForklift();
  forklift.position.set(-7, 0, -10.5);
  forklift.rotation.y = -0.5;
  group.add(forklift);
  solid(-7, -10.5, 3.0, 2.4);

  // ── 7) OVERHEAD GANTRY CRANE on wall rails ──────────────────────────────────
  const railY = 8.4, railZ = 13.5;
  for (const sz of [-1, 1]) {
    const rail = box(HX * 2, 0.4, 0.5, steelDarkMat, false, false);
    rail.position.set(0, railY, sz * railZ);
    group.add(rail);
    for (const bx of [-15, -5, 5, 15]) {
      const br = box(0.4, 1.6, 0.4, steelMat, false, false);
      br.position.set(bx, railY + 0.9, sz * railZ);
      group.add(br);
    }
  }
  // Bridge girder (traverses along X in update()).
  const craneBridge = new THREE.Group();
  group.add(craneBridge);
  const craneBaseX = 0, craneSpanX = 12;
  const girder = box(1.0, 0.7, railZ * 2 + 0.6, craneYellow);
  girder.position.set(0, railY + 0.25, 0);
  craneBridge.add(girder);
  // Hazard chevrons on the girder side.
  for (let i = 0; i < 14; i++) {
    const ch = box(0.06, 0.5, 0.6, i % 2 ? hazardKMat : hazardYMat, false, false);
    ch.position.set(0.53, railY + 0.25, -railZ + 1 + i * 1.9);
    craneBridge.add(ch);
  }
  // End trucks riding the rails.
  for (const sz of [-1, 1]) {
    const truck = box(1.4, 0.7, 1.2, steelDarkMat, false, false);
    truck.position.set(0, railY, sz * railZ);
    craneBridge.add(truck);
  }
  addBeacon(craneBridge, 0, railY + 0.7, railZ, "#ff4533", 2.8, 0);
  addBeacon(craneBridge, 0, railY + 0.7, -railZ, "#ff4533", 2.8, Math.PI);
  // Trolley (drifts along Z on the bridge in update()).
  const craneTrolley = new THREE.Group();
  craneTrolley.position.set(0, railY - 0.15, 0);
  craneBridge.add(craneTrolley);
  const craneTrolleyZ = 0, craneTrolleyAmp = 9;
  const trolleyBody = box(1.4, 0.7, 1.6, steelMat, false, false);
  craneTrolley.add(trolleyBody);
  // Hanging hook block + chain + robotic grab claw (sways in update()).
  const craneHook = new THREE.Group();
  craneHook.position.set(0, -0.4, 0);
  craneTrolley.add(craneHook);
  const cable = cyl(0.05, 0.05, 3.4, cableMat, false, false);
  cable.position.y = -1.7;
  craneHook.add(cable);
  for (let i = 0; i < 4; i++) {
    const link = mesh(chainLinkGeo, chainMat, false, false);
    link.position.y = -3.3 - i * 0.16;
    link.rotation.x = i % 2 ? Math.PI / 2 : 0;
    craneHook.add(link);
  }
  const block = box(0.6, 0.5, 0.6, hookMat, false, false);
  block.position.y = -4.0;
  craneHook.add(block);
  for (const sx of [-1, 1]) {
    const jaw = box(0.12, 0.8, 0.5, fkMast, false, false);
    jaw.position.set(sx * 0.32, -4.55, 0);
    jaw.rotation.z = sx * 0.3;
    craneHook.add(jaw);
  }

  // ── 8) SCANNER GATES straddling the drive lane (rotating sensor rings) ──────
  function addScannerGate(gz) {
    const g = new THREE.Group();
    g.position.set(0, 0, gz);
    group.add(g);
    for (const sx of [-1, 1]) {
      const post = box(0.6, 5.0, 0.7, scanFrameMat);
      post.position.set(sx * 3.5, 2.5, 0);
      g.add(post);
      const panel = box(0.2, 3.2, 0.5, scanRingMat, false, false);
      panel.position.set(sx * 3.15, 2.5, 0);
      g.add(panel);
      solid(sx * 3.5, gz, 0.7, 0.8);
    }
    const beam = box(7.7, 0.7, 0.7, scanFrameMat);
    beam.position.set(0, 5.0, 0);
    g.add(beam);
    // Rotating scanner ring around the lane (hoop in XY plane, spins about Z).
    const ring = mesh(new THREE.TorusGeometry(2.2, 0.12, 8, 28), scanRingMat, false, false);
    ring.position.set(0, 2.6, 0);
    g.add(ring);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const pod = box(0.3, 0.3, 0.3, scanPodMat, false, false);
      pod.position.set(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0);
      ring.add(pod);
    }
    scanners.push({ ring, mat: scanRingMat, rate: 0.9, phase: gz });
    for (const sx of [-1, 1]) addBeacon(g, sx * 3.5, 5.4, 0, "#ffb020", 3.0, sx > 0 ? 0 : Math.PI);
  }
  addScannerGate(-9);
  addScannerGate(4);

  // ── 9) SIDE AIRLOCK + VIEWPORT + DOCKED SUPPLY POD (in/through the +X wall) ──
  // Sealed round HATCH (south of the window).
  {
    const hz = -7;
    const ringT = mesh(new THREE.TorusGeometry(1.5, 0.22, 10, 24), airlockFrameMat, false, false);
    ringT.rotation.y = Math.PI / 2;
    ringT.position.set(HX + 0.02, 2.3, hz);
    group.add(ringT);
    const door = cyl(1.4, 1.4, 0.2, hatchMat, false, false);
    door.rotation.z = Math.PI / 2;
    door.position.set(HX - 0.02, 2.3, hz);
    group.add(door);
    // Locking wheel.
    const wheel = mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 18), lockWheelMat, false, false);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(HX - 0.12, 2.3, hz);
    group.add(wheel);
    for (let i = 0; i < 4; i++) {
      const spoke = box(0.1, 0.9, 0.08, lockWheelMat, false, false);
      spoke.position.set(HX - 0.12, 2.3, hz);
      spoke.rotation.x = (i / 4) * Math.PI;
      group.add(spoke);
    }
    // Airlock light strip framing the hatch (cycles colour in update()).
    const strip = mesh(new THREE.TorusGeometry(1.75, 0.06, 8, 24), airlockLightMat, false, false);
    strip.rotation.y = Math.PI / 2;
    strip.position.set(HX - 0.05, 2.3, hz);
    group.add(strip);
  }
  // Framed VIEWPORT glazing in the window opening (z 1..9, y 1.4..5.6).
  {
    const cz = (winZ0 + winZ1) / 2, cy = (winY0 + winY1) / 2;
    const glass = box(0.12, winY1 - winY0, winZ1 - winZ0, glassMat, false, false);
    glass.position.set(HX, cy, cz);
    group.add(glass);
    // Frame: header / sill / jambs / mullions.
    const header = box(WALL_T + 0.1, 0.4, winZ1 - winZ0 + 0.6, airlockFrameMat, false, false);
    header.position.set(HX, winY1 + 0.05, cz); group.add(header);
    const sill = box(WALL_T + 0.1, 0.4, winZ1 - winZ0 + 0.6, airlockFrameMat, false, false);
    sill.position.set(HX, winY0 - 0.05, cz); group.add(sill);
    for (const jz of [winZ0 - 0.05, winZ1 + 0.05]) {
      const jamb = box(WALL_T + 0.1, winY1 - winY0 + 0.8, 0.4, airlockFrameMat, false, false);
      jamb.position.set(HX, cy, jz); group.add(jamb);
    }
    for (const mz of [3.7, 6.3]) {
      const mull = box(0.14, winY1 - winY0, 0.14, airlockFrameMat, false, false);
      mull.position.set(HX, cy, mz); group.add(mull);
    }
  }
  // SPACE beyond the wall: a dark backdrop, a starfield, and a docked supply pod.
  {
    const back = mesh(new THREE.PlaneGeometry(60, 40), spaceBackMat, false, false);
    back.rotation.y = -Math.PI / 2;   // faces -X (back toward the bay)
    back.position.set(HX + 42, 4, 5);
    group.add(back);
    // Starfield (cheap Points cloud out beyond +X, visible through the viewport).
    const N = 320;
    const pos = new Float32Array(N * 3);
    let seed = 1234.5;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < N; i++) {
      pos[i * 3] = HX + 6 + rnd() * 34;
      pos[i * 3 + 1] = -4 + rnd() * 16;
      pos[i * 3 + 2] = -16 + rnd() * 34;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const sm = new THREE.PointsMaterial({ color: "#ffffff", size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    const stars = new THREE.Points(sg, sm);
    stars.frustumCulled = false;
    group.add(stars);
    // Docked SUPPLY POD aligned with the viewport (nose berthed at the window).
    const pod = new THREE.Group();
    pod.position.set(HX + 6.5, 3.5, 5);
    group.add(pod);
    const podBody = cyl(1.4, 1.4, 4.5, podMat, false, false);
    podBody.rotation.z = Math.PI / 2;   // axis along X
    pod.add(podBody);
    const nose = mesh(new THREE.ConeGeometry(1.4, 1.6, 16), podDarkMat, false, false);
    nose.rotation.z = Math.PI / 2;
    nose.position.x = -3.0;
    pod.add(nose);
    const collar = cyl(1.2, 1.2, 0.6, podCollarMat, false, false);
    collar.rotation.z = Math.PI / 2;
    collar.position.x = -2.5;
    pod.add(collar);
    for (const sz of [-1, 1]) {
      const fin = box(0.1, 2.0, 4.2, podFinMat, false, false);
      fin.position.set(1.2, 0, sz * 2.6);
      pod.add(fin);
    }
    addBeacon(pod, 2.4, 0.9, 0, "#37ff7a", 1.6, 0.5);
  }

  // ── 10) HANGING CHAINS on the back wall (decorative drape) ──────────────────
  for (const cx of [-3.5, 2.5]) {
    for (let i = 0; i < 10; i++) {
      const link = mesh(chainLinkGeo, chainMat, false, false);
      link.position.set(cx, CEIL_Y - 0.6 - i * 0.17, HZ - 0.5);
      link.rotation.x = i % 2 ? Math.PI / 2 : 0;
      group.add(link);
    }
  }

  // ── Animation — ALLOCATION-FREE ─────────────────────────────────────────────
  let t = 0;
  function update(dt) {
    if (dt > 0.1) dt = 0.1;
    t += dt;
    // Gantry crane: slow traverse along X, trolley drift along Z, hook sway.
    craneBridge.position.x = craneBaseX + Math.sin(t * 0.16) * craneSpanX;
    craneTrolley.position.z = craneTrolleyZ + Math.sin(t * 0.11) * craneTrolleyAmp;
    craneHook.rotation.z = Math.sin(t * 0.7) * 0.06;
    // Blinking status beacons (sharp on/off, each its own rate/phase).
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i];
      b.mat.emissiveIntensity = Math.sin(t * b.rate + b.phase) > 0.3 ? 1.7 : 0.15;
    }
    // Slowly-rotating scanner rings + glow pulse.
    for (let i = 0; i < scanners.length; i++) {
      const s = scanners[i];
      s.ring.rotation.z += dt * s.rate;
      s.mat.emissiveIntensity = 0.65 + Math.sin(t * 2.4 + s.phase) * 0.3;
    }
    // Airlock light cycle: hue sweeps green→amber→red as it "pressurises".
    const phase = Math.sin(t * 0.5) * 0.5 + 0.5;   // 0..1
    airlockLightMat.emissive.setHSL(0.33 * phase, 1.0, 0.5);
    airlockLightMat.emissiveIntensity = 0.8 + phase * 1.1;
  }

  return { group, update, ground, colliders };
}
