// AIRPORT — an OFFSHORE AIRFIELD ISLAND in the ocean, EAST of the city, reachable
// on foot by a causeway. Built to MIRROR the OCEAN / SPACE module contract: its
// group is added straight to the scene by main.js, and its extra walkable rects
// (`ground`) + solid props (`colliders`) are merged into the player + ride world.
//
// What this module adds to the world (all in WORLD coords):
//   • A big flat RECLAIMED-LAND platform/island centred at (190, 130) in the sea,
//     ~120 (X) × 80 (Z). Its TOP sits flush at y=0 (the city slab-top height) and
//     its concrete skirt drops to y=-3 — well below the ocean surface (waterY=-0.8)
//     — so no gap shows at the waterline. The whole top is one big walkable AABB.
//   • A long RUNWAY strip running EAST–WEST down the island's length (asphalt with a
//     dashed centreline, threshold "piano-key" bars + edge lines) so a plane parked
//     at the west threshold can roll EAST and lift off over open ocean.
//   • TWO HELIPADS (dark disc + white ring + painted H) on the south apron.
//   • TWO open-fronted HANGARS (arched/gabled sheds, walls registered as tight
//     colliders, fronts left OPEN so you can walk inside) on the east apron.
//   • A control TOWER (tall shaft + glass cab + railed catwalk) with a slowly
//     ROTATING radar dish on its roof; its base is a tight collider.
//   • Apron flavour: a swaying WINDSOCK, blinking pad/edge STROBE lights, and a
//     couple of parked-plane silhouettes.
//   • A walkable CAUSEWAY bridging WEST off the island back to the city's east edge
//     (~x=120) at the same z (~130): a ~7 m plank/concrete deck on pilings with low
//     side rails. Its deck is registered as walkable `ground`; the rails are slim
//     colliders.
//
// ── Y-STACK (must not fight the city's existing stack) ─────────────────────────
// City stack: base pavement y=-0.12, district slabs top y=0.00, roads y=0.02,
// road decals y=0.025. Ocean surface waterY=-0.80.
//   • island/causeway TOP = y=0.00  → flush with the city slab top.
//   • platform skirt bottom = y=-3.0 → far below waterY, so the sea never gaps.
//   • asphalt slab top ≈ y=0.04, paint markings ≈ y=0.05 → a thin raised road layer
//     on the island, comfortably above y=0 and never near the city's own ground.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// All shared materials + geometries are created ONCE at module scope (like the
// zone/ocean/space files). The build phase may allocate freely; update(dt) only
// mutates cached transforms + material scalars on a small list of animated handles
// — no `new` per frame.

import * as THREE from "three";

// ── Shared materials (created ONCE) ───────────────────────────────────────────
// Reclaimed-land platform.
const platTopMat  = new THREE.MeshStandardMaterial({ color: "#9a9c94", roughness: 0.97, metalness: 0.04 });
const platSideMat = new THREE.MeshStandardMaterial({ color: "#6c6e68", roughness: 0.98, metalness: 0.04 });
const seawallMat  = new THREE.MeshStandardMaterial({ color: "#7f8179", roughness: 0.95 });
// Paved surfaces.
const asphaltMat = new THREE.MeshStandardMaterial({ color: "#2e3236", roughness: 0.95, metalness: 0.05 });
const apronMat   = new THREE.MeshStandardMaterial({ color: "#7c7f84", roughness: 0.94, metalness: 0.05 });
// Paint markings.
const paintWhiteMat  = new THREE.MeshStandardMaterial({ color: "#eef0ec", roughness: 0.6, emissive: "#9a9c98", emissiveIntensity: 0.2 });
const paintYellowMat = new THREE.MeshStandardMaterial({ color: "#e8c020", roughness: 0.6, emissive: "#5a4400", emissiveIntensity: 0.25 });
// Helipads.
const helipadMat     = new THREE.MeshStandardMaterial({ color: "#23262b", roughness: 0.9 });
const helipadRingMat = new THREE.MeshStandardMaterial({ color: "#f2f4ef", roughness: 0.6, emissive: "#8a8c88", emissiveIntensity: 0.25, side: THREE.DoubleSide });
// Hangars.
const hangarWallMat = new THREE.MeshStandardMaterial({ color: "#b6c0c8", roughness: 0.55, metalness: 0.45 });
const hangarRoofMat = new THREE.MeshStandardMaterial({ color: "#8d97a0", roughness: 0.6, metalness: 0.4 });
const hangarInnerMat = new THREE.MeshStandardMaterial({ color: "#3a3f45", roughness: 0.85, side: THREE.DoubleSide });
// Control tower.
const towerMat     = new THREE.MeshStandardMaterial({ color: "#c9ccd2", roughness: 0.85, metalness: 0.1 });
const towerDarkMat = new THREE.MeshStandardMaterial({ color: "#5a5f66", roughness: 0.7, metalness: 0.3 });
const glassMat     = new THREE.MeshStandardMaterial({ color: "#8fc4e0", roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.55, emissive: "#244a5e", emissiveIntensity: 0.3 });
const railMat      = new THREE.MeshStandardMaterial({ color: "#8a8f96", roughness: 0.6, metalness: 0.5 });
const radarMat     = new THREE.MeshStandardMaterial({ color: "#d7dadf", roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide });
// Windsock.
const sockOrangeMat = new THREE.MeshStandardMaterial({ color: "#e8721f", roughness: 0.8, side: THREE.DoubleSide });
const sockWhiteMat  = new THREE.MeshStandardMaterial({ color: "#f0f0ea", roughness: 0.8, side: THREE.DoubleSide });
// Parked-plane silhouettes.
const planeBodyMat   = new THREE.MeshStandardMaterial({ color: "#dfe4e8", roughness: 0.5, metalness: 0.2 });
const planeAccentMat = new THREE.MeshStandardMaterial({ color: "#c0453e", roughness: 0.6 });
// Causeway woodwork / steel.
const deckMat   = new THREE.MeshStandardMaterial({ color: "#8d8f93", roughness: 0.9 });
const pilingMat = new THREE.MeshStandardMaterial({ color: "#5d6166", roughness: 0.95 });

// ── Shared geometries (created ONCE) ──────────────────────────────────────────
const G = {
  dashGeo:     new THREE.BoxGeometry(4, 0.02, 0.5),    // runway centreline dash
  edgeGeo:     new THREE.BoxGeometry(100, 0.02, 0.3),  // runway edge line
  threshGeo:   new THREE.BoxGeometry(6, 0.02, 1.1),    // threshold "piano-key" bar
  poleGeo:     new THREE.CylinderGeometry(0.1, 0.13, 5, 8),
  beaconGeo:   new THREE.SphereGeometry(0.32, 8, 6),
  railPostGeo: new THREE.BoxGeometry(0.12, 0.85, 0.12),
  pilingGeo:   new THREE.CylinderGeometry(0.28, 0.34, 4.2, 8),
};

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = true, receive = true) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}
function addAABB(arr, cx, cz, w, d) {
  arr.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// An open-fronted HANGAR shed: back wall (-Z) + two side walls (±X) as solid
// geometry, a gabled metal roof, and an OPEN front (+Z) so you can walk inside.
// Returns a group at local origin; the caller positions it + registers wall
// colliders in world coords.
function makeHangar(w, d, h) {
  const g = new THREE.Group();
  const t = 0.4; // wall thickness
  // Back wall (-Z face).
  const back = box(w, h, t, hangarWallMat);
  back.position.set(0, h / 2, -d / 2 + t / 2);
  g.add(back);
  // Side walls (±X).
  for (const sx of [-1, 1]) {
    const side = box(t, h, d, hangarWallMat);
    side.position.set(sx * (w / 2 - t / 2), h / 2, 0);
    g.add(side);
  }
  // Dark interior back-drop so the open mouth reads as a deep shed (not a hole).
  const inner = box(w - 2 * t, h - 0.3, 0.1, hangarInnerMat, false, false);
  inner.position.set(0, (h - 0.3) / 2, -d / 2 + t + 0.1);
  g.add(inner);
  // Gabled roof: two tilted panels meeting at a ridge, deterministic geometry.
  const rise = h * 0.45;
  const slopeLen = Math.sqrt((w / 2) * (w / 2) + rise * rise);
  const slopeAngle = Math.atan2(rise, w / 2);
  for (const sx of [-1, 1]) {
    const panel = box(slopeLen, 0.16, d + 0.6, hangarRoofMat);
    panel.position.set(sx * (w / 4), h + rise / 2, 0);
    panel.rotation.z = -sx * slopeAngle; // +X panel slopes down toward +x eave
    g.add(panel);
  }
  // Ridge cap.
  const ridge = box(0.4, 0.3, d + 0.6, hangarRoofMat, false, false);
  ridge.position.set(0, h + rise, 0);
  g.add(ridge);
  return g;
}

// A small parked-plane SILHOUETTE for apron flavour (fuselage + wings + tail).
function makeParkedPlane() {
  const g = new THREE.Group();
  const fuse = mesh(new THREE.CylinderGeometry(0.55, 0.45, 5, 12), planeBodyMat);
  fuse.rotation.x = Math.PI / 2; // lie along Z
  fuse.position.y = 1.0;
  g.add(fuse);
  const nose = mesh(new THREE.ConeGeometry(0.55, 1.0, 12), planeBodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.0, 3.0);
  g.add(nose);
  const wing = box(7.4, 0.16, 1.3, planeBodyMat);
  wing.position.set(0, 0.95, 0.2);
  g.add(wing);
  const stripe = box(7.4, 0.04, 0.3, planeAccentMat, false, false);
  stripe.position.set(0, 1.04, 0.2);
  g.add(stripe);
  const tailFin = box(0.16, 1.4, 1.2, planeBodyMat);
  tailFin.position.set(0, 1.7, -2.1);
  g.add(tailFin);
  const stab = box(2.6, 0.14, 0.8, planeBodyMat);
  stab.position.set(0, 1.0, -2.1);
  g.add(stab);
  for (const px of [-1.2, 1.2]) {
    const wheel = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 10), planeAccentMat, true, false);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(px, 0.3, 0.4);
    g.add(wheel);
  }
  return g;
}

export function buildAirport(opts = {}) {
  // landBounds kept for API symmetry with ocean.js / space.js (the island is at a
  // fixed offshore site, but accepting it keeps the build({landBounds}) contract).
  const lb = opts.landBounds || { minX: -125, maxX: 125, minZ: -15, maxZ: 285 };
  void lb;

  const group = new THREE.Group();
  group.name = "airport";

  // Returned contract arrays.
  const ground = [];     // EXTRA walkable rects: island top + causeway deck
  const colliders = [];  // SOLID props: hangar walls, tower, light/sock poles, rails

  // Animated handles collected at build → mutated allocation-free in update().
  const beacons = [];    // { mat, rate, phase }  blinking strobes / nav lights
  let radarDish = null;  // rotating radar on the tower roof
  let sockPivot = null;  // swaying windsock

  // Y-stack constants (see header).
  const waterY = -0.8;
  const topY = 0.0;      // island + causeway walkable top

  // ── ISLAND geometry ─────────────────────────────────────────────────────────
  const cx = 190, cz = 130;          // island centre (offshore, EAST of the city)
  const HX = 60, HZ = 40;            // half-extents → 120 (X) × 80 (Z)
  const islMinX = cx - HX, islMaxX = cx + HX; // [130, 250]
  const islMinZ = cz - HZ, islMaxZ = cz + HZ; // [90, 170]

  // ── 1) RECLAIMED-LAND PLATFORM (top flush at y=0, skirt below the sea) ───────
  const platH = 3.0;                 // bottom at y=-3.0, well below waterY=-0.8
  const platform = box(HX * 2, platH, HZ * 2, platSideMat, false, true);
  platform.position.set(cx, topY - platH / 2, cz);
  group.add(platform);
  // A thin top cap in concrete tone so the deck reads cleaner than the skirt.
  const cap = box(HX * 2, 0.06, HZ * 2, platTopMat, false, true);
  cap.position.set(cx, topY - 0.02, cz);
  group.add(cap);
  // Low seawall lip around the rim (visual only; leaves a notch on the WEST edge
  // at the causeway z-band so the bridge meets the deck cleanly).
  const lipH = 0.4;
  for (const [lx, lz, lw, ld, skipWest] of [
    [cx, islMaxZ - 0.3, HX * 2, 0.6, false], // north
    [cx, islMinZ + 0.3, HX * 2, 0.6, false], // south
    [islMaxX - 0.3, cz, 0.6, HZ * 2, false], // east
    [islMinX + 0.3, cz, 0.6, HZ * 2, true],  // west (notched for causeway)
  ]) {
    if (skipWest) {
      // Split the west lip into two segments either side of the causeway band.
      for (const seg of [[islMinZ, 126], [134, islMaxZ]]) {
        const segLen = seg[1] - seg[0];
        const wall = box(0.6, lipH, segLen, seawallMat, false, true);
        wall.position.set(lx, topY + lipH / 2, (seg[0] + seg[1]) / 2);
        group.add(wall);
      }
      continue;
    }
    const wall = box(lw, lipH, ld, seawallMat, false, true);
    wall.position.set(lx, topY + lipH / 2, lz);
    group.add(wall);
  }
  // Register the ISLAND TOP as one big walkable AABB.
  addAABB(ground, cx, cz, HX * 2, HZ * 2);

  // ── 2) RUNWAY — runs EAST–WEST down the island's length ─────────────────────
  const rwX0 = 140, rwX1 = 240;      // west / east ends (length 100)
  const rwCx = (rwX0 + rwX1) / 2;    // 190
  const rwLen = rwX1 - rwX0;         // 100
  const rwW = 16;                    // runway width
  const rwCz = 134;                  // runway centre-Z (north half of the island)
  const rwMinZ = rwCz - rwW / 2, rwMaxZ = rwCz + rwW / 2; // [126, 142]
  // Asphalt slab (top ≈ 0.04).
  const rw = box(rwLen, 0.08, rwW, asphaltMat, false, true);
  rw.position.set(rwCx, topY + 0.0, rwCz);
  group.add(rw);
  // Dashed centreline.
  for (let x = rwX0 + 8; x <= rwX1 - 8; x += 8) {
    const dash = mesh(G.dashGeo, paintWhiteMat, false, false);
    dash.position.set(x, topY + 0.05, rwCz);
    group.add(dash);
  }
  // Edge lines (full length, both sides).
  for (const ez of [rwMinZ + 0.4, rwMaxZ - 0.4]) {
    const edge = mesh(G.edgeGeo, paintWhiteMat, false, false);
    edge.position.set(rwCx, topY + 0.05, ez);
    group.add(edge);
  }
  // Threshold "piano-key" bars at both ends.
  for (const ex of [rwX0 + 4, rwX1 - 4]) {
    for (let k = 0; k < 6; k++) {
      const bar = mesh(G.threshGeo, paintWhiteMat, false, false);
      bar.position.set(ex, topY + 0.05, rwCz + (k - 2.5) * 2.6);
      group.add(bar);
    }
  }

  // ── 3) APRON paving on the south half (visual; the whole top is walkable) ────
  const apron = box(96, 0.06, 32, apronMat, false, true);
  apron.position.set(193, topY + 0.015, 106); // z∈[90,122], x∈[145,241]
  group.add(apron);
  // A yellow taxi line linking the apron up to the runway centre.
  const taxi = box(0.4, 0.02, 14, paintYellowMat, false, false);
  taxi.position.set(190, topY + 0.05, 120);
  group.add(taxi);

  // ── 4) HELIPADS (south apron) ───────────────────────────────────────────────
  const helipads = [{ x: 172, z: 106 }, { x: 196, z: 106 }];
  for (const hp of helipads) {
    const disc = mesh(new THREE.CylinderGeometry(5, 5, 0.06, 28), helipadMat, false, true);
    disc.position.set(hp.x, topY + 0.045, hp.z);
    group.add(disc);
    const ring = mesh(new THREE.RingGeometry(4.2, 4.8, 32), helipadRingMat, false, false);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(hp.x, topY + 0.07, hp.z);
    group.add(ring);
    // Painted "H": two uprights + a crossbar.
    for (const sx of [-1, 1]) {
      const post = box(0.5, 0.02, 3.4, paintWhiteMat, false, false);
      post.position.set(hp.x + sx * 1.3, topY + 0.07, hp.z);
      group.add(post);
    }
    const cross = box(2.6, 0.02, 0.5, paintWhiteMat, false, false);
    cross.position.set(hp.x, topY + 0.07, hp.z);
    group.add(cross);
    // A blinking touchdown strobe on the pad rim.
    const padLightMat = new THREE.MeshStandardMaterial({ color: "#48e0ff", roughness: 0.4, emissive: "#16c8ff", emissiveIntensity: 1.0 });
    const padLight = mesh(G.beaconGeo, padLightMat, false, false);
    padLight.scale.setScalar(0.6);
    padLight.position.set(hp.x + 5.2, topY + 0.4, hp.z);
    group.add(padLight);
    beacons.push({ mat: padLightMat, rate: 2.0, phase: hp.x });
  }

  // ── 5) HANGARS (east apron, open fronts facing +Z toward the runway) ─────────
  const hangarSites = [{ x: 220, z: 102 }, { x: 240, z: 102 }];
  const hW = 18, hD = 14, hH = 8;
  for (const hs of hangarSites) {
    const hg = makeHangar(hW, hD, hH);
    hg.position.set(hs.x, topY, hs.z);
    group.add(hg);
    // Tight wall colliders (back + two sides); the +Z front stays OPEN.
    addAABB(colliders, hs.x, hs.z - hD / 2 + 0.2, hW, 0.6);                 // back wall
    addAABB(colliders, hs.x - hW / 2 + 0.2, hs.z, 0.6, hD);                 // -X side
    addAABB(colliders, hs.x + hW / 2 - 0.2, hs.z, 0.6, hD);                 // +X side
  }

  // ── 6) CONTROL TOWER (west apron) ───────────────────────────────────────────
  const twr = { x: 150, z: 102 };
  const tg = new THREE.Group();
  tg.position.set(twr.x, topY, twr.z);
  group.add(tg);
  const shaftH = 17;
  const shaft = mesh(new THREE.CylinderGeometry(1.7, 2.1, shaftH, 14), towerMat);
  shaft.position.y = shaftH / 2;
  tg.add(shaft);
  // Glass cab (a flared box) at the top.
  const cabY = shaftH + 1.6;
  const cab = box(5.4, 3.0, 5.4, glassMat, false, false);
  cab.position.y = cabY;
  tg.add(cab);
  // Cab floor + roof slabs.
  const cabFloor = box(5.8, 0.3, 5.8, towerDarkMat, true, true);
  cabFloor.position.y = cabY - 1.6;
  tg.add(cabFloor);
  const cabRoof = box(6.0, 0.4, 6.0, towerDarkMat, true, false);
  cabRoof.position.y = cabY + 1.7;
  tg.add(cabRoof);
  // Railed catwalk around the cab floor.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const rail = box(i % 2 ? 0.1 : 6.0, 0.5, i % 2 ? 6.0 : 0.1, railMat, false, false);
    rail.position.set(Math.cos(a) * 3.0, cabY - 1.2, Math.sin(a) * 3.0);
    tg.add(rail);
  }
  // ROTATING radar dish on the roof.
  const radarPivot = new THREE.Group();
  radarPivot.position.y = cabY + 2.4;
  tg.add(radarPivot);
  const radarMast = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 6), towerDarkMat, false, false);
  radarMast.position.y = 0.5;
  radarPivot.add(radarMast);
  const dish = mesh(new THREE.SphereGeometry(1.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), radarMat, false, false);
  dish.scale.set(1, 0.45, 1);
  dish.rotation.z = Math.PI / 2; // tip the dish so it sweeps the sky as it spins
  dish.position.set(0.9, 1.0, 0);
  radarPivot.add(dish);
  radarDish = radarPivot;
  // A red obstruction beacon at the very top.
  const twrBeaconMat = new THREE.MeshStandardMaterial({ color: "#ff5a4a", roughness: 0.4, emissive: "#ff2a1a", emissiveIntensity: 1.2 });
  const twrBeacon = mesh(G.beaconGeo, twrBeaconMat, false, false);
  twrBeacon.position.y = cabY + 2.0;
  tg.add(twrBeacon);
  beacons.push({ mat: twrBeaconMat, rate: 1.4, phase: 0 });
  // Tight tower base collider.
  addAABB(colliders, twr.x, twr.z, 4.4, 4.4);

  // ── 7) WINDSOCK (sways in update) ───────────────────────────────────────────
  const sockBase = { x: 138, z: 120 };
  const sockMast = mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.5, 8), towerDarkMat, true, false);
  sockMast.position.set(sockBase.x, topY + 2.25, sockBase.z);
  group.add(sockMast);
  sockPivot = new THREE.Group();
  sockPivot.position.set(sockBase.x, topY + 4.3, sockBase.z);
  group.add(sockPivot);
  // The sock: alternating orange/white truncated cones strung along +X.
  let segX = 0.5;
  for (let s = 0; s < 4; s++) {
    const r0 = 0.55 - s * 0.09, r1 = 0.55 - (s + 1) * 0.09;
    const seg = mesh(new THREE.CylinderGeometry(r1, r0, 0.7, 12, 1, true), s % 2 ? sockWhiteMat : sockOrangeMat, false, false);
    seg.rotation.z = Math.PI / 2; // axis along X
    seg.position.x = segX;
    sockPivot.add(seg);
    segX += 0.72;
  }
  addAABB(colliders, sockBase.x, sockBase.z, 0.5, 0.5);

  // ── 8) APRON EDGE LIGHTS (a few blink) + parked-plane silhouettes ───────────
  const lightPositions = [
    [150, 124], [175, 124], [200, 124], [225, 124],
    [rwX0, rwMinZ - 1], [rwX0, rwMaxZ + 1], [rwX1, rwMinZ - 1], [rwX1, rwMaxZ + 1],
  ];
  for (let i = 0; i < lightPositions.length; i++) {
    const [lx, lz] = lightPositions[i];
    const pole = mesh(G.poleGeo, towerDarkMat, true, false);
    pole.scale.y = 0.5;
    pole.position.set(lx, topY + 1.25, lz);
    group.add(pole);
    const lampMat = new THREE.MeshStandardMaterial({
      color: i < 4 ? "#fff0c0" : "#ff7a5a",
      roughness: 0.4,
      emissive: i < 4 ? "#ffdf90" : "#ff4a2a",
      emissiveIntensity: 1.0,
    });
    const lamp = mesh(G.beaconGeo, lampMat, false, false);
    lamp.scale.setScalar(0.55);
    lamp.position.set(lx, topY + 2.7, lz);
    group.add(lamp);
    // Runway-end lights (i>=4) strobe fast; apron lights glow steady-ish.
    if (i >= 4) beacons.push({ mat: lampMat, rate: 3.4, phase: i });
    addAABB(colliders, lx, lz, 0.3, 0.3);
  }
  // A couple of parked planes near the hangars / apron.
  for (const [px, pz, ry] of [[202, 114, 0.4], [232, 116, -0.5]]) {
    const p = makeParkedPlane();
    p.position.set(px, topY, pz);
    p.rotation.y = ry;
    group.add(p);
    addAABB(colliders, px, pz, 5.5, 5.5);
  }

  // ── 9) CAUSEWAY — walkable bridge WEST to the city east edge (~x=120) ────────
  // Deck spans x∈[118,131] (overlaps the city/beach edge on the west and the
  // island rim on the east), centred at z=130, ~7 m wide.
  const cwX0 = 118, cwX1 = 131, cwZ = 130, cwW = 7;
  const cwLen = cwX1 - cwX0;
  const deck = box(cwLen, 0.4, cwW, deckMat, false, true);
  deck.position.set((cwX0 + cwX1) / 2, topY - 0.2, cwZ);
  group.add(deck);
  // Cross-plank seams for decking detail.
  for (let i = 1; i < cwLen; i += 1.6) {
    const seam = box(0.1, 0.42, cwW, pilingMat, false, false);
    seam.position.set(cwX0 + i, topY - 0.18, cwZ);
    group.add(seam);
  }
  // Pilings down into the sea at the corners.
  for (const px of [cwX0 + 1.5, cwX1 - 1.5]) {
    for (const side of [-1, 1]) {
      const piling = mesh(G.pilingGeo, pilingMat, true, false);
      piling.position.set(px, waterY - 1.6, cwZ + side * (cwW / 2 - 0.4));
      group.add(piling);
    }
  }
  // Low side rails (slim colliders) along both deck edges.
  for (const side of [-1, 1]) {
    const railZ = cwZ + side * (cwW / 2 - 0.15);
    const topRail = box(cwLen, 0.12, 0.12, railMat, false, false);
    topRail.position.set((cwX0 + cwX1) / 2, topY + 0.8, railZ);
    group.add(topRail);
    for (let x = cwX0 + 0.6; x <= cwX1 - 0.6; x += 2.4) {
      const post = mesh(G.railPostGeo, railMat, true, false);
      post.position.set(x, topY + 0.4, railZ);
      group.add(post);
      addAABB(colliders, x, railZ, 0.25, 0.25);
    }
  }
  // Register the causeway deck as walkable ground.
  ground.push({ minX: cwX0, maxX: cwX1, minZ: cwZ - cwW / 2, maxZ: cwZ + cwW / 2 });

  // ── SPAWNS ──────────────────────────────────────────────────────────────────
  // Plane forward is +Z local (heading 0 → +Z); heading = +PI/2 faces +X (EAST).
  // Park at the WEST threshold so the take-off roll runs EAST down the runway and
  // lifts off over open ocean (away from the city).
  const planeSpawn = { x: rwX0 + 8, z: rwCz, heading: Math.PI / 2 };
  // Heli sits on the first (main) helipad, nose +Z.
  const heliSpawn = { x: helipads[0].x, z: helipads[0].z, heading: 0 };
  const pad = { x: helipads[0].x, z: helipads[0].z };

  // ── Animation — ALLOCATION-FREE. Spin the radar, blink strobes, sway the sock.
  let t = 0;
  function update(dt) {
    t += dt;
    // Rotating radar dish.
    if (radarDish) radarDish.rotation.y += dt * 0.7;
    // Blinking strobes / nav beacons (sharp on/off pulse, each its own phase/rate).
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i];
      b.mat.emissiveIntensity = Math.sin(t * b.rate + b.phase) > 0.55 ? 1.7 : 0.12;
    }
    // Windsock sway: swings about the mast (y) and lifts in a gust (z).
    if (sockPivot) {
      sockPivot.rotation.y = Math.sin(t * 0.8) * 0.5;
      sockPivot.rotation.z = -0.18 + Math.sin(t * 1.7) * 0.12;
    }
  }

  return {
    group,
    update,
    ground,
    colliders,
    planeSpawn,
    heliSpawn,
    pad,
  };
}
