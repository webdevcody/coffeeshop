// CANNON — a SECRET back room hidden behind the cafe, holding a GIANT human-
// cannonball CANNON that fires the player in a high arc clear over the city.
//
// What this module adds to the world (all in WORLD coords, added straight to the
// scene by main.js, MIRRORING the OCEAN / SPACE / AIRPORT module contract):
//   • A small enclosed STONE ROOM centred at (0, -22) — well behind the bar at
//     z≈-9.6 — with brick walls, a flagstone floor, a low ceiling, flickering wall
//     TORCHES and a few CRATES. The floor is registered as walkable `ground`; the
//     four walls are solid `colliders`, EXCEPT a doorway gap in the cafe-facing
//     (+Z) wall at z=-13 so you can walk in from the cafe.
//   • A SECRET SLIDING DOOR: a brick-faced panel that fills that doorway gap. It
//     rides on the cafe-side face of the front wall and slides aside (+X, into a
//     pocket behind the right wall segment) when opened. setDoorOpen(true/false)
//     drives an eased slide in update(); while CLOSED its collider blocks the gap,
//     while OPEN the gap is clear. doorTrigger is a press-spot just in front of it,
//     on the CAFE side, where the player reveals/opens it.
//   • The GIANT CANNON: a big iron BARREL on a wooden CARRIAGE with two huge spoked
//     WHEELS, angled ~45° up and pointing +Z (toward the cafe/city) so a launch arcs
//     over the rooftops and lands anywhere downtown. The carriage/wheels are solid
//     colliders, but the MUZZLE/loading spot is left clear so you can stand under it.
//     A lit FUSE spark sputters at the breech and a little SMOKE curls from the muzzle.
//   • launch() returns a ballistic initial velocity along aimDir at a big speed (the
//     integration wave applies it to the player so they fly across the map in an arc).
//
// ── Y-STACK (must not fight the city's existing stack) ─────────────────────────
// City stack: base pavement y=-0.12, district slabs top y=0.00, roads y=0.02.
//   • room flagstone floor TOP = y=0.05 → a hair above the city ground, so the
//     player (feet at y=0) reads as standing on it with ZERO z-fighting.
//   • walls/ceiling rise to y=7; the angled barrel muzzle tops out near y=5.5, so
//     the whole cannon clears the ceiling.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// All shared materials + geometries are created ONCE at module scope (like the
// zone/ocean/space files). The build phase may allocate freely (incl. a few cloned
// flame/smoke materials so each flickers/fades on its own); update(dt) only mutates
// cached transforms + material scalars on a small list of animated handles — no
// `new` per frame.

import * as THREE from "three";

// ── Shared materials (created ONCE) ───────────────────────────────────────────
// Room shell.
const brickMat   = new THREE.MeshStandardMaterial({ color: "#6e5a4c", roughness: 0.96, metalness: 0.02 });
const brickDarkMat = new THREE.MeshStandardMaterial({ color: "#564437", roughness: 0.98, metalness: 0.02 });
const floorMat   = new THREE.MeshStandardMaterial({ color: "#5b5651", roughness: 0.98, metalness: 0.03 });
const ceilMat    = new THREE.MeshStandardMaterial({ color: "#3d352e", roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide });
const mortarMat  = new THREE.MeshStandardMaterial({ color: "#48392e", roughness: 1.0 });
// Secret sliding door — brick-faced so it reads as wall, with a faint iron rim.
const doorMat    = new THREE.MeshStandardMaterial({ color: "#6a5648", roughness: 0.95, metalness: 0.04 });
const doorTrimMat = new THREE.MeshStandardMaterial({ color: "#33373c", roughness: 0.5, metalness: 0.6 });
// Cannon.
const ironMat    = new THREE.MeshStandardMaterial({ color: "#2b2e33", roughness: 0.45, metalness: 0.8 });
const ironDarkMat = new THREE.MeshStandardMaterial({ color: "#181b1f", roughness: 0.5, metalness: 0.75 });
const brassMat   = new THREE.MeshStandardMaterial({ color: "#b08a2e", roughness: 0.35, metalness: 0.85, emissive: "#3a2c08", emissiveIntensity: 0.25 });
const woodMat    = new THREE.MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.85, metalness: 0.05 });
const woodDarkMat = new THREE.MeshStandardMaterial({ color: "#4d3520", roughness: 0.9 });
const wheelMat   = new THREE.MeshStandardMaterial({ color: "#3b2a1a", roughness: 0.9 });
const tireMat    = new THREE.MeshStandardMaterial({ color: "#23252a", roughness: 0.6, metalness: 0.5 });
const crateMat   = new THREE.MeshStandardMaterial({ color: "#7a5a32", roughness: 0.92 });
const crateTrimMat = new THREE.MeshStandardMaterial({ color: "#5a3f22", roughness: 0.95 });
// Torch + fuse glows (cloned per instance at build for independent flicker).
const torchWoodMat = new THREE.MeshStandardMaterial({ color: "#4a3522", roughness: 0.9 });
const flameMat   = new THREE.MeshStandardMaterial({ color: "#ffb648", roughness: 0.4, emissive: "#ff7a18", emissiveIntensity: 1.4 });
const fuseCordMat = new THREE.MeshStandardMaterial({ color: "#2a2622", roughness: 0.95 });
const sparkMat   = new THREE.MeshStandardMaterial({ color: "#fff0b0", roughness: 0.3, emissive: "#ffd24a", emissiveIntensity: 1.6 });
const smokeMat   = new THREE.MeshStandardMaterial({ color: "#cfcabf", roughness: 1.0, transparent: true, opacity: 0.0, depthWrite: false });

// ── Shared geometries (created ONCE) ──────────────────────────────────────────
const G = {
  wheelGeo:  new THREE.CylinderGeometry(1.55, 1.55, 0.4, 22),
  tireGeo:   new THREE.TorusGeometry(1.5, 0.18, 8, 24),
  spokeGeo:  new THREE.BoxGeometry(0.16, 2.7, 0.16),
  hubGeo:    new THREE.CylinderGeometry(0.4, 0.4, 0.5, 12),
  bandGeo:   new THREE.TorusGeometry(1.02, 0.14, 8, 22),     // reinforcing band round the barrel
  smokeGeo:  new THREE.SphereGeometry(0.5, 8, 6),
  sparkGeo:  new THREE.SphereGeometry(0.14, 8, 6),
  flameGeo:  new THREE.ConeGeometry(0.22, 0.7, 8),
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

// A wall TORCH: an angled wooden sconce + a glowing flame. Returns { group, mat }
// where `mat` is the flame's own (cloned) material the caller pushes into the
// flicker list. Caller positions + rotates the group to sit flush on a wall.
function makeTorch() {
  const g = new THREE.Group();
  const sconce = mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.9, 8), torchWoodMat, true, false);
  sconce.rotation.x = -0.5;          // tilt the stick up off the wall
  sconce.position.set(0, 0, 0.25);
  g.add(sconce);
  const cup = mesh(new THREE.CylinderGeometry(0.18, 0.1, 0.22, 10), ironDarkMat, true, false);
  cup.position.set(0, 0.35, 0.5);
  g.add(cup);
  const fm = flameMat.clone();
  const flame = mesh(G.flameGeo, fm, false, false);
  flame.position.set(0, 0.65, 0.5);
  g.add(flame);
  return { group: g, mat: fm, flame };
}

export function buildCannon(opts = {}) {
  // landBounds kept for API symmetry with the other world add-ons (the room is at a
  // fixed site directly behind the cafe, but accepting it keeps the build({...})
  // contract uniform).
  void opts;

  const group = new THREE.Group();
  group.name = "cannon";

  // Returned contract arrays.
  const ground = [];     // EXTRA walkable rects: room floor + doorway threshold
  const colliders = [];  // SOLID props: walls, carriage/wheels, crates, + the door

  // Animated handles collected at build → mutated allocation-free in update().
  const torches = [];    // { mat, phase, rate }  flickering flames
  const smokes = [];     // { mesh, mat, phase, rate }  muzzle smoke puffs

  // ── ROOM dimensions ─────────────────────────────────────────────────────────
  const RX = 0, RZ = -22;            // room centre (well behind the bar at z≈-9.6)
  const HX = 7;                      // half-width  → inner x∈[-7, 7]
  const frontZ = -13;                // cafe-facing (+Z) wall  (the secret-door wall)
  const backZ = -31;                 // far (-Z) wall   → depth 18, centred ~ -22
  const WH = 7;                      // wall height
  const WT = 0.5;                    // wall thickness
  const floorTopY = 0.05;            // flagstone top (just above city ground)
  const DOOR_HALF = 2.0;             // half-width of the doorway gap (x∈[-2, 2])

  // ── 1) FLOOR + CEILING ──────────────────────────────────────────────────────
  const depth = frontZ - backZ;      // 18
  const floor = box(HX * 2, 0.2, depth, floorMat, false, true);
  floor.position.set(RX, floorTopY - 0.1, RZ);
  group.add(floor);
  // A scatter of darker flagstone seams (cosmetic inlay).
  for (let i = 0; i < 5; i++) {
    const seam = box(HX * 2 - 0.6, 0.02, 0.12, mortarMat, false, true);
    seam.position.set(RX, floorTopY + 0.005, backZ + 2.6 + i * 3.2);
    group.add(seam);
  }
  const ceil = box(HX * 2, 0.3, depth, ceilMat, false, false);
  ceil.position.set(RX, WH, RZ);
  group.add(ceil);

  // ── 2) WALLS ────────────────────────────────────────────────────────────────
  // Back wall (-Z).
  const back = box(HX * 2 + WT, WH, WT, brickMat, true, true);
  back.position.set(RX, WH / 2, backZ);
  group.add(back);
  addAABB(colliders, RX, backZ, HX * 2 + WT, WT);
  // Side walls (±X).
  for (const sx of [-1, 1]) {
    const side = box(WT, WH, depth, brickMat, true, true);
    side.position.set(RX + sx * HX, WH / 2, RZ);
    group.add(side);
    addAABB(colliders, RX + sx * HX, RZ, WT, depth);
  }
  // Front (+Z) wall: two solid brick segments either side of the doorway gap, plus
  // a header (lintel) spanning above the opening. Gap = x∈[-DOOR_HALF, DOOR_HALF].
  const segW = HX - DOOR_HALF;       // width of each side segment (5)
  for (const sx of [-1, 1]) {
    const cxSeg = sx * (DOOR_HALF + segW / 2);
    const seg = box(segW, WH, WT, brickMat, true, true);
    seg.position.set(cxSeg, WH / 2, frontZ);
    group.add(seg);
    addAABB(colliders, cxSeg, frontZ, segW, WT);
  }
  const DOOR_TOP = 3.6;              // doorway opening height
  const header = box(DOOR_HALF * 2 + 0.4, WH - DOOR_TOP, WT, brickMat, true, true);
  header.position.set(0, DOOR_TOP + (WH - DOOR_TOP) / 2, frontZ);
  group.add(header);

  // ── 3) SECRET SLIDING DOOR ──────────────────────────────────────────────────
  // A brick-faced panel on the CAFE-side face of the front wall, covering the gap.
  // It slides +X (into a pocket in front of the right wall segment) to open. Its
  // collider is mutated in update() to track the panel so the gap is blocked only
  // where the panel actually is.
  const PANEL_W = DOOR_HALF * 2 + 0.4;   // 4.4 — overlaps the gap edges for a seal
  const PANEL_H = DOOR_TOP;              // 3.6
  const panelZ = frontZ + WT / 2 + 0.18; // ride just in FRONT of the wall face (cafe side)
  const SLIDE_DIST = PANEL_W;            // fully clears the x∈[-2,2] gap when open
  const doorPanel = new THREE.Group();
  doorPanel.position.set(0, PANEL_H / 2, panelZ);
  group.add(doorPanel);
  const panelFace = box(PANEL_W, PANEL_H, 0.3, doorMat, true, true);
  doorPanel.add(panelFace);
  // Iron strap trim + a recessed handle so the panel reads as a heavy slab.
  for (const ty of [-PANEL_H / 2 + 0.45, PANEL_H / 2 - 0.45]) {
    const strap = box(PANEL_W - 0.2, 0.18, 0.36, doorTrimMat, false, false);
    strap.position.set(0, ty, 0);
    doorPanel.add(strap);
  }
  const handle = mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 16), doorTrimMat, false, false);
  handle.position.set(PANEL_W / 2 - 0.7, 0, 0.2);
  doorPanel.add(handle);
  // The door's collider (kept by reference, mutated as it slides). Closed → blocks
  // the gap; pushed into `colliders` so the player/rides world honours it.
  const DOOR_HALF_W = PANEL_W / 2;
  const doorCollider = { minX: -DOOR_HALF_W, maxX: DOOR_HALF_W, minZ: panelZ - 0.35, maxZ: panelZ + 0.35 };
  colliders.push(doorCollider);

  // ── 4) WALL TORCHES (flicker in update) ─────────────────────────────────────
  // Two per side wall, mounted flush, flame poking into the room.
  for (const sx of [-1, 1]) {
    for (const tz of [-18, -26]) {
      const t = makeTorch();
      t.group.position.set(sx * (HX - 0.25), 2.7, tz);
      t.group.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; // face into the room
      group.add(t.group);
      torches.push({ mat: t.mat, phase: tz * 0.7 + sx, rate: 11 + sx });
    }
  }

  // ── 5) CRATES (flavour; small colliders) ────────────────────────────────────
  function addCrate(cx, cz, s, rot) {
    const c = box(s, s, s, crateMat, true, true);
    c.position.set(cx, s / 2 + floorTopY, cz);
    c.rotation.y = rot;
    group.add(c);
    // X-brace boards on two faces.
    for (const f of [1, -1]) {
      const b1 = box(s * 1.02, 0.12, 0.12, crateTrimMat, false, false);
      b1.position.set(cx, s * 0.5 + floorTopY, cz + f * (s / 2 + 0.01));
      b1.rotation.set(0, rot, 0.5);
      group.add(b1);
    }
    addAABB(colliders, cx, cz, s + 0.2, s + 0.2);
  }
  addCrate(-5.4, -29.2, 1.5, 0.3);
  addCrate(-5.7, -27.6, 1.0, -0.2);   // a smaller crate stacked beside
  addCrate(5.5, -28.6, 1.6, -0.25);
  addCrate(5.2, -15.4, 1.2, 0.15);

  // ── 6) THE GIANT CANNON ─────────────────────────────────────────────────────
  // Carriage at the back of the room; barrel angled 45° up, pointing +Z so a launch
  // arcs over the cafe and out across the city. The muzzle/loading spot (under the
  // barrel mouth, around z=-22.5) is left clear of colliders so you can stand to load.
  const CARR_Z = -26;                       // carriage centre (Z)
  const ELEV = Math.PI / 4;                 // 45° barrel elevation
  const aimDir = { x: 0, y: Math.sin(ELEV), z: Math.cos(ELEV) }; // unit (0, .707, .707)

  // Carriage wooden body + side cheeks rising to the trunnion (barrel pivot).
  const carriage = new THREE.Group();
  carriage.position.set(RX, 0, CARR_Z);
  group.add(carriage);
  const carBase = box(3.0, 1.0, 3.2, woodMat, true, true);
  carBase.position.set(0, 0.7 + floorTopY, 0);
  carriage.add(carBase);
  for (const sx of [-1, 1]) {
    // A stepped cheek (two stacked boxes) climbing toward the breech.
    const cheekLo = box(0.5, 1.8, 2.8, woodDarkMat, true, true);
    cheekLo.position.set(sx * 1.05, 1.1 + floorTopY, 0.1);
    carriage.add(cheekLo);
    const cheekHi = box(0.5, 1.2, 1.6, woodDarkMat, true, true);
    cheekHi.position.set(sx * 1.05, 2.3 + floorTopY, -0.6);
    carriage.add(cheekHi);
  }
  // Two huge spoked wheels on a cross axle.
  const axle = mesh(new THREE.CylinderGeometry(0.18, 0.18, 4.0, 10), ironDarkMat, true, false);
  axle.rotation.z = Math.PI / 2;
  axle.position.set(0, 1.55 + floorTopY, 0.4);
  carriage.add(axle);
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 1.85, 1.55 + floorTopY, 0.4);
    w.rotation.y = Math.PI / 2;       // wheel face out along ±X
    const rim = mesh(G.wheelGeo, wheelMat, true, true);
    rim.rotation.x = Math.PI / 2;
    w.add(rim);
    const tire = mesh(G.tireGeo, tireMat, true, false);
    w.add(tire);
    const hub = mesh(G.hubGeo, ironMat, true, false);
    hub.rotation.x = Math.PI / 2;
    w.add(hub);
    for (let s = 0; s < 4; s++) {
      const spoke = mesh(G.spokeGeo, wheelMat, true, false);
      spoke.rotation.z = (s / 4) * Math.PI; // 4 spokes = 8 visual arms
      w.add(spoke);
    }
    carriage.add(w);
    // Wheel footprint folded into the carriage collider below (not added here).
  }
  // Carriage + wheels collider (the breech end). Muzzle end stays clear.
  addAABB(colliders, RX, CARR_Z + 0.1, 4.2, 3.4);

  // BARREL — a tapered iron tube on a trunnion pivot, tilted up 45° toward +Z. Built
  // along the group's local +Y then rotated about X so +Y maps onto aimDir.
  const pivotY = 2.0 + floorTopY;
  const barrelPivot = new THREE.Group();
  barrelPivot.position.set(RX, pivotY, CARR_Z);
  barrelPivot.rotation.x = ELEV;            // +Y → (0, cosθ, sinθ) = up + +Z
  group.add(barrelPivot);
  const BARREL_LEN = 6.0;                   // local span; centre offset so it overhangs the breech
  const BARREL_CTR = 2.0;                   // local-Y of the tube centre (muzzle at +5, breech at -1)
  const tube = mesh(new THREE.CylinderGeometry(0.85, 1.05, BARREL_LEN, 24), ironMat, true, true);
  tube.position.y = BARREL_CTR;
  barrelPivot.add(tube);
  // Reinforcing bands along the tube.
  for (const by of [-0.6, 1.0, 2.6]) {
    const band = mesh(G.bandGeo, ironDarkMat, true, false);
    band.position.y = by;
    band.scale.setScalar(0.92 + (2.6 - by) * 0.03);
    barrelPivot.add(band);
  }
  // Brass muzzle ring at the mouth + a flared lip.
  const muzzleRing = mesh(new THREE.TorusGeometry(0.86, 0.16, 10, 24), brassMat, true, false);
  muzzleRing.position.y = BARREL_CTR + BARREL_LEN / 2; // local 5.0 (the mouth)
  barrelPivot.add(muzzleRing);
  // Rounded breech cap (cascabel) at the low end.
  const breech = mesh(new THREE.SphereGeometry(1.05, 18, 12), ironMat, true, false);
  breech.scale.y = 0.7;
  breech.position.y = BARREL_CTR - BARREL_LEN / 2 - 0.2; // local -1.2
  barrelPivot.add(breech);
  const knob = mesh(new THREE.SphereGeometry(0.34, 12, 8), ironDarkMat, true, false);
  knob.position.y = BARREL_CTR - BARREL_LEN / 2 - 1.1;
  barrelPivot.add(knob);

  // MUZZLE MOUTH world position = pivot + aimDir * (local muzzle Y). The barrel mouth
  // is where the player loads / is launched from.
  const MUZZLE_LOCAL = BARREL_CTR + BARREL_LEN / 2; // 5.0
  const mouth = {
    x: RX + aimDir.x * MUZZLE_LOCAL,
    y: pivotY + aimDir.y * MUZZLE_LOCAL,
    z: CARR_Z + aimDir.z * MUZZLE_LOCAL,
  };

  // FUSE — a little cord + a sputtering SPARK at the breech (top of the cascabel).
  const fuseCord = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), fuseCordMat, false, false);
  fuseCord.rotation.x = 0.5;
  fuseCord.position.set(0, BARREL_CTR - BARREL_LEN / 2 + 0.1, 0.0);
  barrelPivot.add(fuseCord);
  const spark = mesh(G.sparkGeo, sparkMat, false, false);
  // Park the spark at the cord tip in WORLD space (added to the room group, animated
  // in place). Compute its world spot from the pivot + a small along-barrel offset.
  const fuseLocalY = BARREL_CTR - BARREL_LEN / 2 + 0.5; // -0.5 local
  const sparkPos = {
    x: RX + aimDir.x * fuseLocalY,
    y: pivotY + aimDir.y * fuseLocalY + 0.35,
    z: CARR_Z + aimDir.z * fuseLocalY - 0.2,
  };
  spark.position.set(sparkPos.x, sparkPos.y, sparkPos.z);
  group.add(spark);

  // SMOKE — a handful of soft puffs curling up off the muzzle (each its own cloned
  // material so it fades on its own phase). Animated allocation-free in update().
  for (let i = 0; i < 5; i++) {
    const sm = smokeMat.clone();
    const puff = mesh(G.smokeGeo, sm, false, false);
    puff.position.set(mouth.x, mouth.y, mouth.z);
    group.add(puff);
    smokes.push({ mesh: puff, mat: sm, phase: i / 5, rate: 0.45 });
  }

  // ── DOOR STATE + animation ──────────────────────────────────────────────────
  let doorTarget = false; // commanded state (true = open)
  let doorPos = 0;        // eased 0 (closed) → 1 (open)
  const DOOR_RATE = 0.85; // slide speed (units of doorPos per second ≈ 1.2 s travel)
  function setDoorOpen(b) { doorTarget = !!b; }

  // doorTrigger — a press-spot just in FRONT of the door, on the CAFE side (z>frontZ),
  // where the player reveals/opens the panel.
  const doorTrigger = { x: 0, z: frontZ + 2.2, r: 2.6 }; // ≈ (0, -10.8) inside the cafe

  // ── Walkable ground: room floor + a doorway threshold bridging to the cafe ───
  ground.push({ minX: RX - HX, maxX: RX + HX, minZ: backZ, maxZ: frontZ });
  ground.push({ minX: -DOOR_HALF - 0.2, maxX: DOOR_HALF + 0.2, minZ: frontZ, maxZ: frontZ + 2.4 });

  // ── launch() — ballistic initial velocity for the player (applied elsewhere) ──
  // Speed in the 28–36 band; aimed along aimDir (up + forward). The integration wave
  // applies { vx, vy, vz } (+ a tumble `spin`) to the player so they arc over the city.
  const LAUNCH_SPEED = 34;
  const LAUNCH_SPIN = 8;
  function launch() {
    return {
      vx: aimDir.x * LAUNCH_SPEED,
      vy: aimDir.y * LAUNCH_SPEED,
      vz: aimDir.z * LAUNCH_SPEED,
      spin: LAUNCH_SPIN,
    };
  }

  // ── Animation — ALLOCATION-FREE. Slide the door, flicker torches + fuse spark,
  // curl the muzzle smoke. Writes cached transforms / scalars only; no `new`. ────
  let t = 0;
  function update(dt) {
    t += dt;

    // Secret door: ease doorPos toward the target, slide the panel, and move its
    // collider so it blocks the gap ONLY where the panel currently sits.
    const goal = doorTarget ? 1 : 0;
    if (doorPos !== goal) {
      const step = DOOR_RATE * dt;
      if (doorPos < goal) doorPos = Math.min(goal, doorPos + step);
      else doorPos = Math.max(goal, doorPos - step);
      const px = doorPos * SLIDE_DIST;
      doorPanel.position.x = px;
      doorCollider.minX = px - DOOR_HALF_W;
      doorCollider.maxX = px + DOOR_HALF_W;
    }

    // Torch flames: fast emissive flicker + a tiny scale shimmer, each own phase.
    for (let i = 0; i < torches.length; i++) {
      const fl = torches[i];
      const f = 0.5 + 0.5 * Math.sin(t * fl.rate + fl.phase) + 0.3 * Math.sin(t * (fl.rate * 2.3) + fl.phase);
      fl.mat.emissiveIntensity = 1.0 + f * 0.9;
    }

    // Fuse spark: a sharper sputter (random-ish via summed sines) + size pulse.
    const sp = 0.5 + 0.5 * Math.sin(t * 17) + 0.4 * Math.sin(t * 9.3 + 1.7);
    sparkMat.emissiveIntensity = 1.2 + sp * 1.4;
    const ss = 0.75 + sp * 0.5;
    spark.scale.setScalar(ss);

    // Muzzle smoke: each puff rises + drifts +Z off the mouth on a looping life,
    // growing and fading. Component-wise writes only.
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      let life = (t * s.rate + s.phase) % 1;
      if (life < 0) life += 1;
      const wob = s.phase * 6.28;
      s.mesh.position.set(
        mouth.x + Math.sin(wob + life * 3) * 0.35,
        mouth.y + life * 2.4,
        mouth.z + life * 1.3 + Math.cos(wob + life * 2) * 0.3
      );
      s.mesh.scale.setScalar(0.4 + life * 1.4);
      s.mat.opacity = 0.42 * (1 - life);
    }
  }

  return {
    group,
    update,
    ground,
    colliders,
    room: { x: RX, z: RZ },
    doorTrigger,
    setDoorOpen,
    get doorOpen() { return doorTarget; },
    mouth,
    aimDir,
    launch,
  };
}
