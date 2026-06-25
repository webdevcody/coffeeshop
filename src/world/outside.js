// The outside world: a city block in front of the coffeeshop with sidewalks, a
// road, street props, and a couple of ambient systems — cars that periodically
// drive by and birds that fly across the sky. The block is a finite slab: walk
// off any edge and there's nothing under you (the player code makes you fall and
// respawn back inside).
//
// buildOutside() returns:
//   group     — a THREE.Group of all the static + animated geometry
//   colliders — AABBs { minX, maxX, minZ, maxZ } for solid props (lamps, benches…)
//   ground    — walkable rectangles; standing outside all of them means you fall
//   update(dt)— advances the cars/birds; call once per frame
//
// Coordinates: the building occupies z ∈ [-11, 11]; everything here lives in +z
// (in front of the entrance) so the player steps straight out the front door.

import * as THREE from "three";
import { WORLD } from "../config.js";

// --- Block layout (metres) -------------------------------------------------
const FRONT = WORLD.depth / 2; // building front wall, z = 11
const BLOCK = {
  minX: -20,
  maxX: 20,
  minZ: FRONT, // flush with the front wall so you walk straight out
  maxZ: 35,
};
const NEAR_WALK_END = FRONT + 10; // sidewalk in front of the shop: z [11, 21]
const ROAD_NEAR = NEAR_WALK_END + 1; // curb, then road starts: z 22
const ROAD_FAR = ROAD_NEAR + 7; // road is 7 wide: z [22, 29]
const ROAD_MID = (ROAD_NEAR + ROAD_FAR) / 2; // z 25.5
const LANE_NEAR = ROAD_NEAR + 1.75; // cars heading +x
const LANE_FAR = ROAD_FAR - 1.75; // cars heading -x
// (Road geometry is no longer drawn by this module — the city street grid owns
// it now — but LANE_NEAR/LANE_FAR still position the ambient cars driving past
// the cafe front, so the road-band constants above are retained.)

// --- Materials (created once) ----------------------------------------------
// The original sidewalk/road/curb/paint slabs were removed in favour of the
// city's unified pavement, so only the materials still used by the entrance
// apron + retained props remain here.
const sidewalk = new THREE.MeshStandardMaterial({ color: "#9b968c", roughness: 0.95 });
const curbMat = new THREE.MeshStandardMaterial({ color: "#c7c2b8", roughness: 0.9 });
const poleMat = new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.5, metalness: 0.7 });
const lampGlass = new THREE.MeshStandardMaterial({
  color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 0.9, roughness: 0.4,
});
const benchWood = new THREE.MeshStandardMaterial({ color: "#6b4326", roughness: 0.7 });
const trunkMat = new THREE.MeshStandardMaterial({ color: "#5a3d28", roughness: 0.9 });
const foliage = new THREE.MeshStandardMaterial({ color: "#3f7d4d", roughness: 0.9, flatShading: true });
const planterMat = new THREE.MeshStandardMaterial({ color: "#7c5234", roughness: 0.85 });

const CAR_COLORS = ["#d94f4f", "#3f7fd0", "#e8b54a", "#54a86b", "#d98a3f", "#8a6fc0", "#cfcfd4"];
const birdMat = new THREE.MeshStandardMaterial({ color: "#3a3a40", roughness: 0.8, flatShading: true });

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// --- Street prop builders --------------------------------------------------
function makeStreetLamp() {
  const g = new THREE.Group();
  const pole = box(0.16, 4.2, 0.16, poleMat);
  pole.position.y = 2.1;
  const arm = box(0.9, 0.12, 0.12, poleMat);
  arm.position.set(0.42, 4.1, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), lampGlass);
  head.position.set(0.82, 4.0, 0);
  const base = box(0.34, 0.3, 0.34, poleMat);
  base.position.y = 0.15;
  g.add(pole, arm, head, base);
  return g;
}

function makeBench() {
  const g = new THREE.Group();
  const seat = box(1.8, 0.1, 0.5, benchWood);
  seat.position.y = 0.46;
  const back = box(1.8, 0.5, 0.1, benchWood);
  back.position.set(0, 0.72, -0.2);
  g.add(seat, back);
  const legGeo = poleMat;
  for (const x of [-0.78, 0.78]) {
    const leg = box(0.1, 0.46, 0.46, legGeo);
    leg.position.set(x, 0.23, 0);
    g.add(leg);
  }
  return g;
}

// (makeHydrant / makeTrashCan were removed — the city street grid now places its
// own hydrants and bins along the avenues, so the originals only doubled up.)

function makeTree(scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.2 * scale, 1.6 * scale, 10), trunkMat);
  trunk.position.y = 0.8 * scale;
  trunk.castShadow = true;
  g.add(trunk);
  const blobGeo = new THREE.IcosahedronGeometry(0.85 * scale, 0);
  for (const [x, y, z] of [[0, 2.1, 0], [0.5, 1.8, 0.2], [-0.45, 1.85, -0.2], [0.1, 2.5, -0.1]]) {
    const blob = new THREE.Mesh(blobGeo, foliage);
    blob.position.set(x * scale, y * scale, z * scale);
    blob.scale.setScalar(0.8 + (x + z) * 0.1);
    blob.castShadow = true;
    g.add(blob);
  }
  // square planter at the base
  const planter = box(0.9 * scale, 0.4, 0.9 * scale, planterMat);
  planter.position.y = 0.2;
  g.add(planter);
  return g;
}

// --- Car / bird pools ------------------------------------------------------
function makeCar(color) {
  const g = new THREE.Group();
  const paintMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: "#a8c4d8", roughness: 0.2, metalness: 0.5 });
  const body = box(1.9, 0.55, 0.95, paintMat);
  body.position.y = 0.5;
  const cabin = box(1.05, 0.5, 0.85, glass);
  cabin.position.set(-0.05, 0.95, 0);
  g.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.2, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: "#1a1a1d", roughness: 0.8 });
  for (const [x, z] of [[-0.6, 0.48], [0.6, 0.48], [-0.6, -0.48], [0.6, -0.48]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.26, z);
    g.add(w);
  }
  const head = new THREE.MeshStandardMaterial({ color: "#fff6d8", emissive: "#ffe9a8", emissiveIntensity: 0.7 });
  const tail = new THREE.MeshStandardMaterial({ color: "#ff5a5a", emissive: "#ff3030", emissiveIntensity: 0.6 });
  for (const z of [0.32, -0.32]) {
    const hl = box(0.08, 0.14, 0.18, head, false);
    hl.position.set(0.96, 0.5, z);
    g.add(hl);
    const tl = box(0.08, 0.14, 0.18, tail, false);
    tl.position.set(-0.96, 0.5, z);
    g.add(tl);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.visible = false;
  return g;
}

function makeBird() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), birdMat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const wingGeo = new THREE.PlaneGeometry(0.6, 0.22);
  const left = new THREE.Mesh(wingGeo, birdMat);
  left.material.side = THREE.DoubleSide;
  const lp = new THREE.Group();
  lp.add(left);
  left.position.z = -0.3;
  const right = new THREE.Mesh(wingGeo, birdMat);
  const rp = new THREE.Group();
  rp.add(right);
  right.position.z = 0.3;
  g.add(lp, rp);
  g.userData.wings = [lp, rp];
  g.visible = false;
  return g;
}

export function buildOutside(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];

  // --- The cafe entrance apron ---------------------------------------------
  // RECONCILED WITH THE CITY: the new city now lays its OWN unified pavement
  // (cityStreets base at y=-0.12) + asphalt road grid + painted lines + dense
  // street furniture over this whole z[11,35] strip. The original block used to
  // paint its own sidewalk/road/curb/centre-line/crosswalk slabs here, which
  // z-fought the city pavement and doubled up the props. Those redundant ground
  // surfaces are GONE — the city pavement is now the single ground from the door
  // outward. All we keep here is a small raised sidewalk APRON right at the
  // entrance so the doorway reads as a tidy kerb-side stoop, plus a few tasteful
  // props that don't clash with the city's furniture.
  const w = BLOCK.maxX - BLOCK.minX;
  const cx = (BLOCK.minX + BLOCK.maxX) / 2;

  // Entrance apron: a shallow slab hugging the front wall (z [11, ~17]). Its top
  // sits a clear 6 cm above the city pavement (city base y=-0.12, road y=0.02) so
  // it never z-fights, giving the door a defined kerb you step down from. It is a
  // solid box (not a thin plane) so the front edge reads with thickness.
  const APRON_DEPTH = 6; // z [11, 17]
  const apron = box(w, 0.22, APRON_DEPTH, sidewalk);
  apron.position.set(cx, 0.05, FRONT + APRON_DEPTH / 2); // top at y = 0.16
  apron.castShadow = false;
  apron.receiveShadow = true;
  group.add(apron);
  // A thin kerb lip along the apron's far edge so it reads as a stepped stoop.
  const kerb = box(w, 0.16, 0.3, curbMat);
  kerb.position.set(cx, 0.06, FRONT + APRON_DEPTH);
  kerb.castShadow = false;
  group.add(kerb);

  // --- A few tasteful original props (kept clear of the entrance lane x≈0) ---
  // The city already lines its avenues with lamps, trees, hydrants and bins, so
  // we drop the original's far-side lamps/trees/hydrant/bin (they doubled up) and
  // keep only a couple of entrance-framing pieces sitting on the apron.
  const lampSpots = [
    [-13, FRONT + 2.5], [13, FRONT + 2.5],
  ];
  for (const [x, z] of lampSpots) {
    const lamp = makeStreetLamp();
    lamp.position.set(x, 0.16, z); // stand on the apron top
    group.add(lamp);
    addCollider(colliders, x, z, 0.4, 0.4);
  }

  const benchSpots = [[-7, FRONT + 2.2, 0], [5, FRONT + 2.2, 0]];
  for (const [x, z, ry] of benchSpots) {
    const bench = makeBench();
    bench.position.set(x, 0.16, z); // on the apron
    bench.rotation.y = ry;
    group.add(bench);
    addCollider(colliders, x, z, 1.9, 0.7);
  }

  // Two planter trees flanking the door, well clear of the walk-out lane.
  const trees = [[-17, FRONT + 3, 1.1], [17, FRONT + 3, 1.1]];
  for (const [x, z, s] of trees) {
    const tree = makeTree(s);
    tree.position.set(x, 0, z);
    group.add(tree);
    addCollider(colliders, x, z, 0.9 * s, 0.9 * s);
  }

  // --- Ambient cars ----------------------------------------------------------
  const cars = [];
  for (let i = 0; i < 6; i++) {
    const car = makeCar(CAR_COLORS[i % CAR_COLORS.length]);
    group.add(car);
    cars.push({ mesh: car, active: false, speed: 0, dir: 1 });
  }
  let carTimer = 1.5;

  function spawnCar() {
    const car = cars.find((c) => !c.active);
    if (!car) return;
    const dir = Math.random() < 0.5 ? 1 : -1; // +1 → drive toward +x, -1 → -x
    const laneZ = dir === 1 ? LANE_NEAR : LANE_FAR;
    car.active = true;
    car.dir = dir;
    car.speed = 6 + Math.random() * 5;
    car.mesh.visible = true;
    car.mesh.position.set(dir === 1 ? BLOCK.minX - 3 : BLOCK.maxX + 3, 0, laneZ);
    car.mesh.rotation.y = dir === 1 ? 0 : Math.PI;
    // recolour occasionally for variety
    const bodyMesh = car.mesh.children[0];
    if (bodyMesh?.material) bodyMesh.material.color.set(CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]);
  }

  // --- Ambient birds ---------------------------------------------------------
  const birds = [];
  for (let i = 0; i < 4; i++) {
    const bird = makeBird();
    group.add(bird);
    birds.push({ mesh: bird, active: false, speed: 0, dir: 1, baseY: 9, phase: 0, drift: 0 });
  }
  let birdTimer = 3;

  function spawnBird() {
    const bird = birds.find((b) => !b.active);
    if (!bird) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    bird.active = true;
    bird.dir = dir;
    bird.speed = 5 + Math.random() * 4;
    bird.baseY = 8 + Math.random() * 5;
    bird.phase = Math.random() * Math.PI * 2;
    bird.drift = 14 + Math.random() * 14;
    bird.mesh.visible = true;
    bird.mesh.position.set(dir === 1 ? BLOCK.minX - 4 : BLOCK.maxX + 4, bird.baseY, bird.drift);
    bird.mesh.rotation.y = dir === 1 ? 0 : Math.PI;
  }

  function update(dt) {
    // Cars
    carTimer -= dt;
    if (carTimer <= 0) {
      spawnCar();
      carTimer = 2.5 + Math.random() * 4;
    }
    for (const c of cars) {
      if (!c.active) continue;
      c.mesh.position.x += c.dir * c.speed * dt;
      if ((c.dir === 1 && c.mesh.position.x > BLOCK.maxX + 3) || (c.dir === -1 && c.mesh.position.x < BLOCK.minX - 3)) {
        c.active = false;
        c.mesh.visible = false;
      }
    }
    // Birds
    birdTimer -= dt;
    if (birdTimer <= 0) {
      spawnBird();
      birdTimer = 4 + Math.random() * 6;
    }
    for (const b of birds) {
      if (!b.active) continue;
      b.phase += dt * 10;
      b.mesh.position.x += b.dir * b.speed * dt;
      b.mesh.position.y = b.baseY + Math.sin(b.phase * 0.25) * 0.6;
      const flap = Math.sin(b.phase) * 0.7;
      b.mesh.userData.wings[0].rotation.x = flap;
      b.mesh.userData.wings[1].rotation.x = -flap;
      if ((b.dir === 1 && b.mesh.position.x > BLOCK.maxX + 4) || (b.dir === -1 && b.mesh.position.x < BLOCK.minX - 4)) {
        b.active = false;
        b.mesh.visible = false;
      }
    }
  }

  // Walkable ground in front of the entrance. The city's connector apron
  // (city.js) already spans z[10,35] full-width over this same strip, so this
  // rect is now mostly redundant — but it's retained so buildOutside remains
  // self-contained (its ground covers the door area even if the city fails to
  // build) and the union of walkable rects reads identically either way.
  const ground = [{ minX: BLOCK.minX, maxX: BLOCK.maxX, minZ: BLOCK.minZ, maxZ: BLOCK.maxZ }];

  return { group, colliders, ground, update };
}
