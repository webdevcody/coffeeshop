// Industrial zone — one 60×60 m tile of a larger 3D city, centred on the origin.
//
// Theme: gritty utilitarian works yard. Corrugated steel warehouses, two animated
// smokestacks that puff grey blobs upward, cylindrical storage silos and a couple
// of squat tanks, a run of overhead pipework, a chain-link perimeter feel, and a
// water tower on stilts. Stylized low-poly so it sits next to a cozy cafe game.
//
// buildIndustrial() returns:
//   group     — THREE.Group of all geometry, in LOCAL tile coords (origin centred)
//   colliders — AABBs { minX, maxX, minZ, maxZ } for solid footprints (player + car)
//   ground    — walkable rects; includes the full tile so the whole floor is solid
//   update(dt)— advances the smoke puffs + a slow rotating warning beacon
//
// Layout keeps a wide cross of open lanes (>= 6 m) so a car can drive through:
//   a N–S lane along x ≈ 0 and an E–W lane along z ≈ 0.

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

// --- Tile bounds -----------------------------------------------------------
const TILE = 30; // half-extent: X,Z ∈ [-30, 30]

// --- Shared materials (created ONCE, reused across every prop) --------------
const concrete = new THREE.MeshStandardMaterial({ color: "#6f6f76", roughness: 0.97 });
const concreteDark = new THREE.MeshStandardMaterial({ color: "#55555c", roughness: 1 });
const steelWall = new THREE.MeshStandardMaterial({ color: "#8a8f95", roughness: 0.6, metalness: 0.55 });
const steelWallRust = new THREE.MeshStandardMaterial({ color: "#9c6a48", roughness: 0.85, metalness: 0.3 });
const roofMat = new THREE.MeshStandardMaterial({ color: "#3b4147", roughness: 0.85, metalness: 0.2 });
const siloMat = new THREE.MeshStandardMaterial({ color: "#c9cdd1", roughness: 0.5, metalness: 0.45 });
const tankMat = new THREE.MeshStandardMaterial({ color: "#6f8a6f", roughness: 0.55, metalness: 0.4 });
const pipeMat = new THREE.MeshStandardMaterial({ color: "#b6a23a", roughness: 0.6, metalness: 0.5 });
const pipeMat2 = new THREE.MeshStandardMaterial({ color: "#7a8896", roughness: 0.6, metalness: 0.55 });
const stackMat = new THREE.MeshStandardMaterial({ color: "#7a5240", roughness: 0.85, metalness: 0.2 });
const stackBand = new THREE.MeshStandardMaterial({ color: "#d6cfc4", roughness: 0.8 });
const frameMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.6, metalness: 0.6 });
const fenceMat = new THREE.MeshStandardMaterial({
  color: "#9aa0a6", roughness: 0.7, metalness: 0.6,
  transparent: true, opacity: 0.32, side: THREE.DoubleSide,
});
const smokeMat = new THREE.MeshStandardMaterial({
  color: "#b9b9c0", roughness: 1, transparent: true, opacity: 0.7, flatShading: true,
});
const beaconMat = new THREE.MeshStandardMaterial({
  color: "#ffb347", emissive: "#ff6a1f", emissiveIntensity: 0.9, roughness: 0.4,
});
const crateMat = new THREE.MeshStandardMaterial({ color: "#a9743b", roughness: 0.85 });
const drumRed = new THREE.MeshStandardMaterial({ color: "#b8402f", roughness: 0.6, metalness: 0.3 });
const drumBlue = new THREE.MeshStandardMaterial({ color: "#2f6fb8", roughness: 0.6, metalness: 0.3 });
const hazardMat = new THREE.MeshStandardMaterial({ color: "#e6c200", roughness: 0.9 });
// Floor hazard-kerb decals are flat single-sided planes; DoubleSide so they still
// read from a grazing/edge-on camera (or from below) instead of vanishing to a 1px line.
const hazardLineMat = new THREE.MeshStandardMaterial({ color: "#e6c200", roughness: 0.9, side: THREE.DoubleSide });
const hazardDark = new THREE.MeshStandardMaterial({ color: "#1c1c1c", roughness: 0.95 });
const groundMat = new THREE.MeshStandardMaterial({ color: "#4c4d52", roughness: 1 });
const ribMat = new THREE.MeshStandardMaterial({ color: "#787d83", roughness: 0.7, metalness: 0.45, flatShading: true });
const dockMat = new THREE.MeshStandardMaterial({ color: "#4a4b50", roughness: 0.95 });
const rollerMat = new THREE.MeshStandardMaterial({ color: "#5a5e64", roughness: 0.7, metalness: 0.4 });
const bumperMat = new THREE.MeshStandardMaterial({ color: "#1a1a1a", roughness: 1 });
const ventMat = new THREE.MeshStandardMaterial({ color: "#aeb3b8", roughness: 0.55, metalness: 0.6, flatShading: true });
const railMat = new THREE.MeshStandardMaterial({ color: "#c9b23a", roughness: 0.55, metalness: 0.5 });
const catwalkMat = new THREE.MeshStandardMaterial({ color: "#3f444a", roughness: 0.8, metalness: 0.4 });

// --- Shared geometries (created ONCE, reused) ------------------------------
const smokeGeo = new THREE.IcosahedronGeometry(0.55, 0);
const siloGeo = new THREE.CylinderGeometry(2, 2, 9, 16);
const siloCapGeo = new THREE.ConeGeometry(2, 1.6, 16);
const drumGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12);
const crateGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
// Reusable detail geometries (shared across instanced/looped props)
const ribGeo = new THREE.BoxGeometry(0.06, 1, 0.12);          // vertical corrugation strip (scaled per wall)
const fencePostGeo = new THREE.CylinderGeometry(0.06, 0.06, 2, 6);
const ladderRungGeo = new THREE.BoxGeometry(0.5, 0.04, 0.04);
const railPostGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6);
const turbineBaseGeo = new THREE.CylinderGeometry(0.45, 0.55, 0.35, 12);
const turbineDomeGeo = new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const bumperGeo = new THREE.BoxGeometry(0.25, 0.55, 0.18);

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// --- Prop builders ---------------------------------------------------------

// Corrugated warehouse: a long steel shed with a low gable roof, ribbed walls,
// a loading dock (roller doors + bumpers) on the +Z face, hazard-stripe trim,
// roof ventilation turbines (spinning) and an exterior pipe + catwalk run.
// Pushes any spinning turbines into `spinners` (array of THREE.Object3D) so the
// caller's update() can rotate them with no per-frame allocation.
function makeWarehouse(w, h, d, wall, spinners) {
  const g = new THREE.Group();
  const body = box(w, h, d, wall);
  body.position.y = h / 2;
  g.add(body);

  // --- Corrugated panel ribbing: instanced vertical strips on the long faces.
  // One InstancedMesh per warehouse covers both +Z and -Z faces cheaply.
  const ribStep = 0.55;
  const cols = Math.max(1, Math.floor((w - 0.4) / ribStep));
  const ribCount = cols * 2; // front + back face
  const ribs = new THREE.InstancedMesh(ribGeo, ribMat, ribCount);
  ribs.castShadow = false;
  ribs.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const ribH = h - 0.9;
  let ri = 0;
  for (const face of [1, -1]) {
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + 0.4 + c * ribStep;
      m4.makeScale(1, ribH, 1);
      m4.setPosition(x, ribH / 2 + 0.05, face * (d / 2 + 0.03));
      ribs.setMatrixAt(ri++, m4.clone());
    }
  }
  ribs.instanceMatrix.needsUpdate = true;
  g.add(ribs);

  // corrugated read: a single dark trim band wrapping near the eaves (1 mesh)
  const band = box(w + 0.06, 0.5, d + 0.06, roofMat, false);
  band.position.y = h - 0.6;
  g.add(band);

  // --- Hazard-stripe trim band around the base (yellow/black diagonal feel).
  const hzCount = Math.max(2, Math.round(w / 0.6));
  const hzGeo = new THREE.BoxGeometry(0.3, 0.45, 0.06);
  const stripes = new THREE.InstancedMesh(hzGeo, hazardMat, hzCount * 2);
  stripes.castShadow = false;
  const hzBack = box(w + 0.04, 0.5, 0.05, hazardDark, false);
  hzBack.position.set(0, 0.3, d / 2 + 0.04);
  g.add(hzBack);
  let hi = 0;
  for (let c = 0; c < hzCount; c++) {
    const x = -w / 2 + 0.45 + c * (w / hzCount);
    m4.makeRotationZ(0.5);
    m4.setPosition(x, 0.3, d / 2 + 0.07);
    stripes.setMatrixAt(hi++, m4.clone());
  }
  // also mark the spare half so the count is exact (mirror cluster, off to side)
  for (let c = 0; c < hzCount; c++) {
    const x = -w / 2 + 0.75 + c * (w / hzCount);
    m4.makeRotationZ(0.5);
    m4.setPosition(x, 0.3, d / 2 + 0.07);
    stripes.setMatrixAt(hi++, m4.clone());
  }
  stripes.instanceMatrix.needsUpdate = true;
  g.add(stripes);

  // shallow gable roof (two slabs leaned together)
  const slopeW = Math.hypot(w / 2, h * 0.28);
  const roofGeo = new THREE.BoxGeometry(slopeW, 0.18, d + 0.4);
  const lean = Math.atan2(h * 0.28, w / 2);
  const left = new THREE.Mesh(roofGeo, roofMat);
  left.position.set(-w / 4, h + h * 0.14, 0);
  left.rotation.z = -lean;
  left.castShadow = true;
  const right = new THREE.Mesh(roofGeo, roofMat);
  right.position.set(w / 4, h + h * 0.14, 0);
  right.rotation.z = lean;
  right.castShadow = true;
  g.add(left, right);

  // --- Roof ventilation turbines along the ridge (whirly-birds that spin).
  const ridgeY = h + h * 0.28 + 0.18;
  const nVents = Math.max(2, Math.floor(d / 5));
  for (let i = 0; i < nVents; i++) {
    const vz = -d / 2 + d / (nVents + 1) * (i + 1);
    const base = new THREE.Mesh(turbineBaseGeo, ventMat);
    base.position.set(0, ridgeY, vz);
    base.castShadow = true;
    g.add(base);
    const dome = new THREE.Mesh(turbineDomeGeo, ventMat);
    dome.position.set(0, ridgeY + 0.32, vz);
    dome.castShadow = true;
    // a couple of fins to make the spin read
    for (let f = 0; f < 4; f++) {
      const fin = new THREE.Mesh(ladderRungGeo, ventMat);
      fin.scale.set(0.7, 1, 4);
      fin.position.y = 0.0;
      fin.rotation.y = (f / 4) * Math.PI;
      dome.add(fin);
    }
    g.add(dome);
    spinners.push(dome);
  }

  // --- Loading dock: a low concrete apron + roller doors + dock bumpers on +Z.
  const dockDepth = 1.6;
  const dockH = 0.45;
  const apron = box(w * 0.8, dockH, dockDepth, dockMat, false);
  apron.position.set(0, dockH / 2, d / 2 + dockDepth / 2);
  apron.receiveShadow = true;
  g.add(apron);

  // roller doors: shared geometry reused in a loop (not per-window allocation)
  const nDoors = Math.max(1, Math.floor(w / 5));
  const doorW = Math.min(3, (w * 0.7) / nDoors);
  const doorH = h * 0.62;
  const rollerGeo = new THREE.BoxGeometry(doorW, doorH, 0.12);
  const slatGeo = new THREE.BoxGeometry(doorW, 0.06, 0.14);
  for (let i = 0; i < nDoors; i++) {
    const dx = nDoors === 1 ? 0 : -w * 0.32 + i * (w * 0.64 / (nDoors - 1));
    const dr = new THREE.Mesh(rollerGeo, rollerMat);
    dr.position.set(dx, doorH / 2 + 0.02, d / 2 + 0.07);
    g.add(dr);
    // a few horizontal slat lines so it reads as a roller shutter
    for (let s = 1; s < 5; s++) {
      const slat = new THREE.Mesh(slatGeo, frameMat);
      slat.position.set(dx, (doorH / 5) * s, d / 2 + 0.14);
      g.add(slat);
    }
    // dock bumpers flanking each door
    for (const bx of [dx - doorW / 2 - 0.18, dx + doorW / 2 + 0.18]) {
      const bump = new THREE.Mesh(bumperGeo, bumperMat);
      bump.position.set(bx, 0.4, d / 2 + 0.12);
      g.add(bump);
    }
  }

  // --- Exterior pipe run + catwalk along the +X gable end, with handrail.
  const cwY = h * 0.62;
  const catwalk = box(0.8, 0.08, d * 0.7, catwalkMat, false);
  catwalk.position.set(w / 2 + 0.4, cwY, 0);
  catwalk.castShadow = true;
  g.add(catwalk);
  // handrail (top rail + instanced posts) running the catwalk
  const cwLen = d * 0.7;
  const rail = box(0.05, 0.05, cwLen, railMat, false);
  rail.position.set(w / 2 + 0.78, cwY + 0.45, 0);
  g.add(rail);
  const nRailPosts = 5;
  const railPosts = new THREE.InstancedMesh(railPostGeo, railMat, nRailPosts);
  for (let i = 0; i < nRailPosts; i++) {
    const pz = -cwLen / 2 + (cwLen / (nRailPosts - 1)) * i;
    m4.makeTranslation(w / 2 + 0.78, cwY + 0.0, pz);
    railPosts.setMatrixAt(i, m4.clone());
  }
  railPosts.instanceMatrix.needsUpdate = true;
  g.add(railPosts);
  // two pipes running along the catwalk at the wall
  const pipeRunGeo = new THREE.CylinderGeometry(0.13, 0.13, cwLen, 8);
  for (let i = 0; i < 2; i++) {
    const p = new THREE.Mesh(pipeRunGeo, i === 0 ? pipeMat : pipeMat2);
    p.rotation.x = Math.PI / 2;
    p.position.set(w / 2 + 0.18, cwY + 0.6 + i * 0.3, 0);
    p.castShadow = true;
    g.add(p);
  }
  return g;
}

// A vertical caged ladder: two stiles + instanced rungs, runs from y0 to y0+len.
// Sits on the +/-X or +/-Z face at radius r (oriented so rungs face outward).
function makeLadder(r, y0, len, faceAngle) {
  const g = new THREE.Group();
  const stileGeo = new THREE.BoxGeometry(0.04, len, 0.04);
  for (const sx of [-0.22, 0.22]) {
    const stile = new THREE.Mesh(stileGeo, frameMat);
    stile.position.set(sx, y0 + len / 2, 0);
    g.add(stile);
  }
  const nRungs = Math.max(3, Math.floor(len / 0.45));
  const rungs = new THREE.InstancedMesh(ladderRungGeo, frameMat, nRungs);
  const lm = new THREE.Matrix4();
  for (let i = 0; i < nRungs; i++) {
    lm.makeTranslation(0, y0 + 0.3 + (len - 0.6) / (nRungs - 1) * i, 0);
    rungs.setMatrixAt(i, lm.clone());
  }
  rungs.instanceMatrix.needsUpdate = true;
  g.add(rungs);
  // push out to the surface, facing outward
  g.position.set(Math.sin(faceAngle) * r, 0, Math.cos(faceAngle) * r);
  g.rotation.y = faceAngle;
  return g;
}

// A circular handrail ring (top rail + instanced posts) at height y, radius r.
function makeRailRing(r, y, posts = 10) {
  const g = new THREE.Group();
  const torus = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 6, 20), railMat);
  torus.rotation.x = Math.PI / 2;
  torus.position.y = y;
  g.add(torus);
  const ringPosts = new THREE.InstancedMesh(railPostGeo, railMat, posts);
  const rm = new THREE.Matrix4();
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    rm.makeTranslation(Math.cos(a) * r, y - 0.45, Math.sin(a) * r);
    ringPosts.setMatrixAt(i, rm.clone());
  }
  ringPosts.instanceMatrix.needsUpdate = true;
  g.add(ringPosts);
  return g;
}

// Storage silo: tall cylinder with a conical cap, hoop bands, a caged access
// ladder up one side and a handrail platform at the cap shoulder.
function makeSilo() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(siloGeo, siloMat);
  body.position.y = 4.5;
  body.castShadow = true;
  const cap = new THREE.Mesh(siloCapGeo, siloMat);
  cap.position.y = 9.8;
  cap.castShadow = true;
  g.add(body, cap);
  const bandGeo = new THREE.CylinderGeometry(2.06, 2.06, 0.18, 16);
  const band = new THREE.Mesh(bandGeo, frameMat);
  band.position.y = 5;
  g.add(band);
  const band2 = new THREE.Mesh(bandGeo, frameMat);
  band2.position.y = 7.5;
  g.add(band2);
  // caged access ladder up the +Z face, ground to shoulder
  g.add(makeLadder(2.04, 0.2, 8.6, 0));
  // handrail platform ringing the top shoulder
  g.add(makeRailRing(2.15, 9.1, 12));
  return g;
}

// Squat storage tank: wide low cylinder on a small skirt, with a side access
// ladder and a handrail ring around the top so it reads as a service tank.
function makeTank() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 18), tankMat);
  body.position.y = 1.9;
  body.castShadow = true;
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.55, 0.5, 18), concreteDark);
  skirt.position.y = 0.25;
  g.add(body, skirt);
  // access ladder up the +Z face from skirt to top
  g.add(makeLadder(2.42, 0.2, 3.4, 0));
  // handrail ring around the top
  g.add(makeRailRing(2.3, 3.95, 12));
  return g;
}

// Smokestack: a tapered brick chimney with a hazard band, mounted on a roof at
// height `baseY` (so it rises OFF the warehouse roof instead of punching through
// the building mass). A short concrete collar ties it visually to the roof.
function makeStack(height, baseY = 0) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.35, height, 14), stackMat);
  body.position.y = baseY + height / 2;
  body.castShadow = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.7, 14), stackBand);
  band.position.y = baseY + height - 1.6;
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.95, 0.5, 14), concreteDark);
  lip.position.y = baseY + height;
  // collar/flashing where the stack meets the roof
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.5, 14), concreteDark);
  collar.position.y = baseY + 0.2;
  collar.castShadow = true;
  g.add(body, band, lip, collar);
  return g;
}

// Water tower: a tank on four splayed steel legs with a conical roof.
function makeWaterTower() {
  const g = new THREE.Group();
  const legGeo = new THREE.BoxGeometry(0.22, 7, 0.22);
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    const leg = new THREE.Mesh(legGeo, frameMat);
    leg.position.set(x, 3.5, z);
    leg.rotation.x = (z > 0 ? -1 : 1) * 0.06;
    leg.rotation.z = (x > 0 ? -1 : 1) * 0.06;
    leg.castShadow = true;
    g.add(leg);
  }
  // cross bracing (one ring of four braces — keeps the silhouette, cuts meshes)
  const braceGeo = new THREE.BoxGeometry(3.5, 0.12, 0.12);
  const by = 4;
  const b1 = new THREE.Mesh(braceGeo, frameMat); b1.position.set(0, by, -1.64);
  const b2 = new THREE.Mesh(braceGeo, frameMat); b2.position.set(0, by, 1.64);
  const b3 = b1.clone(); b3.rotation.y = Math.PI / 2; b3.position.set(-1.64, by, 0);
  const b4 = b1.clone(); b4.rotation.y = Math.PI / 2; b4.position.set(1.64, by, 0);
  g.add(b1, b2, b3, b4);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3, 16), siloMat);
  tank.position.y = 8.5;
  tank.castShadow = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.6, 16), roofMat);
  roof.position.y = 10.8;
  roof.castShadow = true;
  g.add(tank, roof);
  return g;
}

// A chain-link fence run (decorative, semi-transparent mesh — NOT a collider).
// Posts are an InstancedMesh spaced every ~2.5 m so a long fence line is cheap,
// plus a top rail tying the posts together.
function makeFence(len) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.8), fenceMat);
  mesh.position.y = 0.9;
  g.add(mesh);
  // top rail
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 6), frameMat);
  rail.rotation.z = Math.PI / 2;
  rail.position.y = 1.78;
  g.add(rail);
  // instanced posts every ~2.5 m
  const nPosts = Math.max(2, Math.round(len / 2.5) + 1);
  const posts = new THREE.InstancedMesh(fencePostGeo, frameMat, nPosts);
  const fm = new THREE.Matrix4();
  for (let i = 0; i < nPosts; i++) {
    const x = -len / 2 + (len / (nPosts - 1)) * i;
    fm.makeTranslation(x, 1, 0);
    posts.setMatrixAt(i, fm.clone());
  }
  posts.instanceMatrix.needsUpdate = true;
  g.add(posts);
  return g;
}

export function buildIndustrial() {
  const group = new THREE.Group();
  const colliders = [];
  const updaters = [];

  // --- Ground slab: a cracked-concrete yard pad covering the whole tile ----
  const pad = box(TILE * 2, 0.4, TILE * 2, groundMat, false);
  pad.position.y = -0.2; // top flush with y=0
  pad.receiveShadow = true;
  group.add(pad);

  // Painted hazard kerbs marking the open driving cross (flat, walk-over).
  for (const z of [-3.4, 3.4]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 2, 0.25), hazardLineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.02, z);
    group.add(line);
  }
  for (const x of [-3.4, 3.4]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, TILE * 2), hazardLineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.02, 0);
    group.add(line);
  }

  // --- Warehouses (corner quadrants; lanes stay open along x≈0 and z≈0) ----
  // Roof ventilation turbines from all sheds collect here so update() can spin
  // them with no per-frame allocation.
  const spinners = [];
  // Each warehouse is a full BLOCK-scale steel shed — substantial width AND
  // depth AND height so it reads solid from every side (front, flank and back),
  // filling a good share of its corner quadrant rather than a thin slab. The
  // collider always matches the body footprint exactly (see addCollider calls).

  // NW warehouse, runs along Z (deep shed). Footprint x∈[-26,-12] z∈[-23,-5].
  const WH1 = { w: 14, h: 7, d: 18, x: -19, z: -14 };
  const wh1 = makeWarehouse(WH1.w, WH1.h, WH1.d, steelWall, spinners);
  wh1.position.set(WH1.x, 0, WH1.z);
  group.add(wh1);
  addCollider(colliders, WH1.x, WH1.z, WH1.w, WH1.d);

  // SW warehouse (rusty), runs along X. Flipped 180° so its detailed FRONT
  // (loading dock + roller doors, built on the local +Z face) points toward the
  // open center lane (−Z) the player approaches from, not the cramped south
  // perimeter strip. Footprint is symmetric so the collider stays centred.
  // Footprint x∈[-26,-6] z∈[11,23].
  const WH2 = { w: 20, h: 6.5, d: 12, x: -16, z: 17 };
  const wh2 = makeWarehouse(WH2.w, WH2.h, WH2.d, steelWallRust, spinners);
  wh2.position.set(WH2.x, 0, WH2.z);
  wh2.rotation.y = Math.PI;
  group.add(wh2);
  addCollider(colliders, WH2.x, WH2.z, WH2.w, WH2.d);

  // NE warehouse, runs along X (deepened so its back is a real wall, not a card).
  // Footprint x∈[8,26] z∈[-24,-12]; the +X catwalk reaches x≈26.8 (< tile 30).
  const WH3 = { w: 18, h: 6.5, d: 12, x: 17, z: -18 };
  const wh3 = makeWarehouse(WH3.w, WH3.h, WH3.d, steelWall, spinners);
  wh3.position.set(WH3.x, 0, WH3.z);
  group.add(wh3);
  addCollider(colliders, WH3.x, WH3.z, WH3.w, WH3.d);

  // --- Silos cluster (NE quadrant, south of wh3) ---------------------------
  const siloSpots = [[10, -7], [14.6, -8]];
  for (const [x, z] of siloSpots) {
    const s = makeSilo();
    s.position.set(x, 0, z);
    group.add(s);
    addCollider(colliders, x, z, 4.1, 4.1);
  }

  // --- Storage tanks (SE quadrant) -----------------------------------------
  const tankSpots = [[18, 11], [13, 17]];
  for (const [x, z] of tankSpots) {
    const t = makeTank();
    t.position.set(x, 0, z);
    group.add(t);
    addCollider(colliders, x, z, 5, 5);
  }

  // --- Water tower (SE corner, prominent) ----------------------------------
  const tower = makeWaterTower();
  tower.position.set(24, 0, 24);
  group.add(tower);
  addCollider(colliders, 24, 24, 3.6, 3.6); // tight to the leg spread

  // --- Two smokestacks rising off the NW warehouse ROOF --------------------
  // Mounted on the roof (baseY ≈ ridge height of wh1) so the chimneys sit ON the
  // shed instead of punching through its mass. No ground colliders: they're up
  // on the roof, not blocking the yard floor. Both stack feet land inside wh1's
  // footprint (x∈[-26,-12], z∈[-23,-5]).
  // Emitters at the stack tips; each owns a pool of reusable puff blobs.
  const smokeSystems = [];
  const wh1RoofY = WH1.h + WH1.h * 0.28; // wh1 gable ridge height
  const stackSpots = [
    { x: -19, z: -15, h: 8, baseY: wh1RoofY - 0.6 },
    { x: -16, z: -11, h: 6.5, baseY: wh1RoofY - 0.6 },
  ];
  for (const sp of stackSpots) {
    const stack = makeStack(sp.h, sp.baseY);
    stack.position.set(sp.x, 0, sp.z);
    group.add(stack);

    const puffs = [];
    const tipY = sp.baseY + sp.h + 0.4;
    const PUFFS = 3;
    for (let i = 0; i < PUFFS; i++) {
      const puff = new THREE.Mesh(smokeGeo, smokeMat.clone());
      puff.castShadow = false;
      puff.position.set(sp.x, tipY, sp.z);
      group.add(puff);
      puffs.push({
        mesh: puff,
        // stagger initial life so the column is continuous, not pulsing
        life: i / PUFFS,
        speed: 0.9 + Math.random() * 0.4,
        sway: Math.random() * Math.PI * 2,
      });
    }
    smokeSystems.push({ x: sp.x, z: sp.z, tipY, puffs });
  }

  // --- Pipework: an elevated run of pipes bridging the SW shed to the tanks -
  const pipeY = 3.2;
  const runGeo = new THREE.CylinderGeometry(0.22, 0.22, 20, 10);
  for (let i = 0; i < 2; i++) {
    const pipe = new THREE.Mesh(runGeo, i === 0 ? pipeMat : pipeMat2);
    pipe.rotation.z = Math.PI / 2; // lie along X
    pipe.position.set(0, pipeY + i * 0.55, 23);
    pipe.castShadow = true;
    group.add(pipe);
  }
  // support trestles for the pipe run (slim — colliders kept tight)
  const trestleGeo = new THREE.BoxGeometry(0.2, pipeY + 0.6, 0.2);
  for (const x of [-7, 7]) {
    const t = new THREE.Mesh(trestleGeo, frameMat);
    t.position.set(x, (pipeY + 0.6) / 2, 23);
    t.castShadow = true;
    group.add(t);
  }
  // an elbow dropping toward the ground at the +X end
  const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, pipeY, 10), pipeMat);
  elbow.position.set(10, pipeY / 2, 23);
  group.add(elbow);

  // --- Chain-link fence runs along the perimeter edges (decorative, instanced)
  const fenceS = makeFence(40);
  fenceS.position.set(-4, 0, 29);
  group.add(fenceS);
  const fenceE = makeFence(34);
  fenceE.rotation.y = Math.PI / 2;
  fenceE.position.set(29, 0, 6);
  group.add(fenceE);
  // north perimeter fence line (skirts the warehouse yard, off the lanes)
  const fenceN = makeFence(22);
  fenceN.position.set(17, 0, -29);
  group.add(fenceN);
  // west perimeter fence line
  const fenceW = makeFence(20);
  fenceW.rotation.y = Math.PI / 2;
  fenceW.position.set(-29, 0, -16);
  group.add(fenceW);

  // --- Scatter: stacked crates + oil drums near the lane edges (solid) -----
  const crateStacks = [[-6, -8], [6, 9], [-7, 8]];
  for (const [x, z] of crateStacks) {
    const c1 = new THREE.Mesh(crateGeo, crateMat);
    c1.position.set(x, 0.7, z);
    c1.castShadow = true; c1.receiveShadow = true;
    const c2 = new THREE.Mesh(crateGeo, crateMat);
    c2.scale.setScalar(0.8);
    c2.position.set(x + 0.3, 1.95, z - 0.2);
    c2.rotation.y = 0.3;
    c2.castShadow = true;
    group.add(c1, c2);
    addCollider(colliders, x, z, 1.8, 1.8);
  }

  // oil drums in tight clusters (small footprints, off the lanes)
  const drumSpots = [
    [7.5, -4, drumRed], [8.4, -4.8, drumBlue], [7.8, -5.6, drumRed],
    [-8, 5, drumBlue],
  ];
  for (const [x, z, mat] of drumSpots) {
    const d = new THREE.Mesh(drumGeo, mat);
    d.position.set(x, 0.55, z);
    d.castShadow = true;
    group.add(d);
  }

  // --- Signage: a hazard billboard + a works sign on the warehouses --------
  const sign1 = artPanel(6, 3, "billboard", {
    title: "IRONWORKS", sub: "SECTOR 7 · NO ENTRY", accent: "#ffcf3f",
    a: "#5a3320", b: "#1c1410", glyph: "⚙", emissiveIntensity: 0.5,
    file: "industrial-ironworks.png",
  });
  // On the NW warehouse's FRONT (+Z dock) face — wall at z=-5, panel just proud
  // of it at z=-4.92. The PlaneGeometry's textured front already faces +Z (the
  // open center the player approaches from), so the text reads correctly (no
  // mirroring) and the detailed front faces the avenue.
  sign1.position.set(WH1.x, 4.6, WH1.z + WH1.d / 2 + 0.08);
  group.add(sign1);

  const sign2 = artPanel(5, 2.4, "sign", {
    text: "HAZARD ZONE", bg: "#e6c200", fg: "#1c1c1c", emissiveIntensity: 0.45,
    file: "industrial-hazard.png",
  });
  // High on the SW warehouse's FRONT (−Z) face, above the loading dock, and
  // rotated to FACE −Z (toward the player approaching from the open center).
  // The shed is flipped 180° so its dock front is the −Z wall at z=11; the panel
  // sits just proud at z=10.92. Without the Math.PI turn the plane's textured
  // front would point into the building and the player would read the mirrored
  // back of the panel.
  sign2.position.set(WH2.x, 4.6, WH2.z - WH2.d / 2 - 0.08);
  sign2.rotation.y = Math.PI;
  group.add(sign2);

  // --- Rotating warning beacon atop the SE tank (cheap ambient motion) ------
  const beaconPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), frameMat);
  beaconPole.position.set(18, 3.9, 11);
  group.add(beaconPole);
  const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.18), beaconMat);
  beacon.position.set(18, 4.4, 11);
  group.add(beacon);

  // --- Animation -------------------------------------------------------------
  let beaconT = 0;
  function update(dt) {
    if (dt > 0.1) dt = 0.1; // clamp big frame gaps so puffs don't jump

    // Smokestacks: each puff rises, expands, fades, then recycles to the tip.
    for (const sys of smokeSystems) {
      for (const p of sys.puffs) {
        p.life += dt * p.speed * 0.45;
        if (p.life >= 1) p.life -= 1; // recycle (continuous column)
        const t = p.life;
        const m = p.mesh;
        m.position.y = sys.tipY + t * 6.5; // rise ~6.5 m over a lifetime
        m.position.x = sys.x + Math.sin(p.sway + t * 3) * (0.4 + t * 1.2); // drift
        m.position.z = sys.z + Math.cos(p.sway + t * 2) * (0.3 + t * 0.9);
        const s = 0.6 + t * 2.4;
        m.scale.setScalar(s);
        m.material.opacity = (1 - t) * 0.72; // fade out as it rises
      }
    }

    // Slowly spinning amber beacon.
    beaconT += dt;
    beacon.rotation.y = beaconT * 2.2;
    beacon.material.emissiveIntensity = 0.6 + Math.abs(Math.sin(beaconT * 2.2)) * 0.6;

    // Roof ventilation turbines idly spin (varied speed for a lively look).
    for (let i = 0; i < spinners.length; i++) {
      spinners[i].rotation.y += dt * (1.4 + (i % 3) * 0.5);
    }
  }
  updaters.length = 0; // (kept for clarity; single inline update used)

  // The whole tile floor is walkable; buildings block via colliders above.
  const ground = [{ minX: -TILE, maxX: TILE, minZ: -TILE, maxZ: TILE }];

  return { group, colliders, ground, update };
}
