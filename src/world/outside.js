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
const FAR_WALK_START = ROAD_FAR + 1; // far sidewalk: z [30, 35]

// --- Materials (created once) ----------------------------------------------
const sidewalk = new THREE.MeshStandardMaterial({ color: "#9b968c", roughness: 0.95 });
const asphalt = new THREE.MeshStandardMaterial({ color: "#33333a", roughness: 0.98 });
const slabSide = new THREE.MeshStandardMaterial({ color: "#6c6760", roughness: 1 });
const curbMat = new THREE.MeshStandardMaterial({ color: "#c7c2b8", roughness: 0.9 });
const paint = new THREE.MeshStandardMaterial({ color: "#e7d98c", roughness: 0.6 });
const paintWhite = new THREE.MeshStandardMaterial({ color: "#e9e9e4", roughness: 0.6 });
const poleMat = new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.5, metalness: 0.7 });
const lampGlass = new THREE.MeshStandardMaterial({
  color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 0.9, roughness: 0.4,
});
const benchWood = new THREE.MeshStandardMaterial({ color: "#6b4326", roughness: 0.7 });
const hydrantMat = new THREE.MeshStandardMaterial({ color: "#c23b39", roughness: 0.6 });
const binMat = new THREE.MeshStandardMaterial({ color: "#3c5a45", roughness: 0.6, metalness: 0.3 });
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

function makeHydrant() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.55, 12), hydrantMat);
  body.position.y = 0.32;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), hydrantMat);
  cap.position.y = 0.62;
  const sideGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8);
  const left = new THREE.Mesh(sideGeo, hydrantMat);
  left.rotation.z = Math.PI / 2;
  left.position.set(-0.2, 0.38, 0);
  const right = left.clone();
  right.position.x = 0.2;
  body.castShadow = cap.castShadow = true;
  g.add(body, cap, left, right);
  return g;
}

function makeTrashCan() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.8, 14), binMat);
  body.position.y = 0.4;
  body.castShadow = body.receiveShadow = true;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 14), binMat);
  lid.position.y = 0.84;
  g.add(body, lid);
  return g;
}

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

  // --- The block slab (gives the edges visible thickness so it reads as a
  // city block you can fall off of) -----------------------------------------
  const w = BLOCK.maxX - BLOCK.minX;
  const d = BLOCK.maxZ - BLOCK.minZ;
  const cx = (BLOCK.minX + BLOCK.maxX) / 2;
  const cz = (BLOCK.minZ + BLOCK.maxZ) / 2;
  const slab = box(w, 0.8, d, slabSide);
  slab.position.set(cx, -0.4, cz); // top at y = 0, flush with the interior floor
  slab.castShadow = false;
  group.add(slab);

  // Sidewalk surfaces (near + far) and the road, as thin top plates.
  const nearWalk = new THREE.Mesh(new THREE.PlaneGeometry(w, NEAR_WALK_END - BLOCK.minZ), sidewalk);
  nearWalk.rotation.x = -Math.PI / 2;
  nearWalk.position.set(cx, 0.01, (BLOCK.minZ + NEAR_WALK_END) / 2);
  nearWalk.receiveShadow = true;
  group.add(nearWalk);

  const farWalk = new THREE.Mesh(new THREE.PlaneGeometry(w, BLOCK.maxZ - FAR_WALK_START), sidewalk);
  farWalk.rotation.x = -Math.PI / 2;
  farWalk.position.set(cx, 0.01, (FAR_WALK_START + BLOCK.maxZ) / 2);
  farWalk.receiveShadow = true;
  group.add(farWalk);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(w, ROAD_FAR - ROAD_NEAR + 2), asphalt);
  road.rotation.x = -Math.PI / 2;
  road.position.set(cx, 0.005, ROAD_MID);
  road.receiveShadow = true;
  group.add(road);

  // Curbs along both sides of the road.
  for (const z of [ROAD_NEAR - 0.5, ROAD_FAR + 0.5]) {
    const curb = box(w, 0.16, 0.3, curbMat);
    curb.position.set(cx, 0.08, z);
    curb.castShadow = false;
    group.add(curb);
  }

  // Dashed centre line.
  for (let x = BLOCK.minX + 1; x < BLOCK.maxX; x += 3) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.18), paint);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x + 0.7, 0.02, ROAD_MID);
    group.add(dash);
  }
  // Crosswalk stripes lined up with the entrance.
  for (let i = -3; i <= 3; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.45, ROAD_FAR - ROAD_NEAR), paintWhite);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(i * 0.75, 0.02, ROAD_MID);
    group.add(stripe);
  }

  // --- Static street props (with colliders) --------------------------------
  // Kept clear of the entrance lane (x ≈ 0, z 11–14) so you can walk straight out.
  const lampSpots = [
    [-12, FRONT + 2.5], [12, FRONT + 2.5], [-4, FRONT + 8.5], [8, FRONT + 8.5],
    [-12, FAR_WALK_START + 3], [6, FAR_WALK_START + 3],
  ];
  for (const [x, z] of lampSpots) {
    const lamp = makeStreetLamp();
    lamp.position.set(x, 0, z);
    group.add(lamp);
    addCollider(colliders, x, z, 0.4, 0.4);
  }

  const benchSpots = [[-7, FRONT + 2.2, 0], [4, FRONT + 2.2, 0]];
  for (const [x, z, ry] of benchSpots) {
    const bench = makeBench();
    bench.position.set(x, 0, z);
    bench.rotation.y = ry;
    group.add(bench);
    addCollider(colliders, x, z, 1.9, 0.7);
  }

  const trees = [[-16, FRONT + 4, 1.1], [16, FRONT + 6, 1.0], [-16, FAR_WALK_START + 2.5, 1.0], [15, FAR_WALK_START + 2.5, 1.1]];
  for (const [x, z, s] of trees) {
    const tree = makeTree(s);
    tree.position.set(x, 0, z);
    group.add(tree);
    addCollider(colliders, x, z, 0.9 * s, 0.9 * s);
  }

  const hydrant = makeHydrant();
  hydrant.position.set(10, 0, FRONT + 5.5);
  group.add(hydrant);
  addCollider(colliders, 10, FRONT + 5.5, 0.4, 0.4);

  const bin = makeTrashCan();
  bin.position.set(-9.5, 0, FRONT + 5.5);
  group.add(bin);
  addCollider(colliders, -9.5, FRONT + 5.5, 0.55, 0.55);

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

  // The whole top of the block is walkable; stepping off any edge drops you.
  const ground = [{ minX: BLOCK.minX, maxX: BLOCK.maxX, minZ: BLOCK.minZ, maxZ: BLOCK.maxZ }];

  return { group, colliders, ground, update };
}
