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

// --- Tool/supply SHOP interior materials (created ONCE, reused) ------------
const shopWallMat = new THREE.MeshStandardMaterial({ color: "#7e8489", roughness: 0.9, metalness: 0.15 });
const shopWallInMat = new THREE.MeshStandardMaterial({ color: "#9aa0a4", roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide });
const shopRoofMat = new THREE.MeshStandardMaterial({ color: "#41464b", roughness: 0.85, metalness: 0.2 });
const shopFloorMat = new THREE.MeshStandardMaterial({ color: "#5b5e63", roughness: 1 });
const shopRugMat = new THREE.MeshStandardMaterial({ color: "#8a3b2c", roughness: 0.95, side: THREE.DoubleSide });
const counterMat = new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.75 });
const counterTopMat = new THREE.MeshStandardMaterial({ color: "#caa46a", roughness: 0.5, metalness: 0.25 });
const shelfMat = new THREE.MeshStandardMaterial({ color: "#5a4632", roughness: 0.85 });
const stoolSeatMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.7, metalness: 0.4 });
const stoolLegMat = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.5, metalness: 0.6 });
const rackMat = new THREE.MeshStandardMaterial({ color: "#454a50", roughness: 0.6, metalness: 0.55 });
const lampShadeMat = new THREE.MeshStandardMaterial({
  color: "#ffd27a", emissive: "#ffb347", emissiveIntensity: 0.9, roughness: 0.5,
});
const cordMat = new THREE.MeshStandardMaterial({ color: "#26282b", roughness: 0.9 });
// Little themed products on the shelves (paint cans, tool boxes, bolt boxes…),
// drawn from a small reused palette so an InstancedMesh-per-colour stays cheap.
const prodMatA = new THREE.MeshStandardMaterial({ color: "#c0392b", roughness: 0.6 }); // red paint cans
const prodMatB = new THREE.MeshStandardMaterial({ color: "#2f6fb8", roughness: 0.6 }); // blue toolboxes
const prodMatC = new THREE.MeshStandardMaterial({ color: "#e0a82e", roughness: 0.7 }); // yellow boxes
const prodMatD = new THREE.MeshStandardMaterial({ color: "#3a8d54", roughness: 0.65 }); // green tins
// --- Fabrication-shop accents (welding bench, gas bottles, anvil, glow) -----
const benchTopMat = new THREE.MeshStandardMaterial({ color: "#5d6166", roughness: 0.55, metalness: 0.6 });
const anvilMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.7 });
const gasBottleA = new THREE.MeshStandardMaterial({ color: "#1d6f3f", roughness: 0.45, metalness: 0.55 }); // O2 green
const gasBottleB = new THREE.MeshStandardMaterial({ color: "#9c2b22", roughness: 0.45, metalness: 0.55 }); // fuel red
const sparkMat = new THREE.MeshStandardMaterial({
  color: "#fff0c2", emissive: "#ff7b2e", emissiveIntensity: 1.4, roughness: 0.4,
});
const planterMat = new THREE.MeshStandardMaterial({ color: "#4f5358", roughness: 0.95 });
const shrubMat = new THREE.MeshStandardMaterial({ color: "#46663a", roughness: 0.95, flatShading: true });
const palletMat = new THREE.MeshStandardMaterial({ color: "#9c7a44", roughness: 0.9 });
const lampPostMat = new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.6, metalness: 0.5 });
const lampGlowMat = new THREE.MeshStandardMaterial({
  color: "#ffe6a8", emissive: "#ffbe55", emissiveIntensity: 0.9, roughness: 0.5,
});
// Door-awning canopy (corrugated steel/canvas look). DoubleSide so it reads from
// under it too, since the player walks UNDERNEATH the projecting canopy.
const awningMat = new THREE.MeshStandardMaterial({
  color: "#b0563a", roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide,
});

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
// Shop interior detail geometries (reused across the instanced products + props)
const shopProdCanGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.3, 8); // paint can
const shopProdBoxGeo = new THREE.BoxGeometry(0.34, 0.26, 0.26);         // toolbox / parts box
const stoolSeatGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.07, 12);
const stoolLegGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.62, 6);
const lampCordGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5);     // scaled per lamp
const lampShadeGeo = new THREE.ConeGeometry(0.26, 0.26, 12, 1, true);
// Fab-shop + street-prop detail geometries (created ONCE, reused)
const gasBottleGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.1, 10);
const gasCapGeo = new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const sparkGeo = new THREE.IcosahedronGeometry(0.05, 0);
const palletPlankGeo = new THREE.BoxGeometry(1.2, 0.06, 0.16);
const shrubGeo = new THREE.IcosahedronGeometry(0.42, 0);

// --- Added gritty-detail materials (created ONCE, reused) -------------------
// Emissive-only glow (NO real lights): floodlight heads, bollard warning caps,
// coolant-vent glow. Steam is a translucent non-emissive puff.
const floodHeadMat = new THREE.MeshStandardMaterial({
  color: "#fff4d6", emissive: "#ffd27a", emissiveIntensity: 1.1, roughness: 0.4,
});
const bollardCapMat = new THREE.MeshStandardMaterial({
  color: "#ffb347", emissive: "#ff5a1f", emissiveIntensity: 0.7, roughness: 0.5,
});
const steamMat = new THREE.MeshStandardMaterial({
  color: "#e2eef2", roughness: 1, transparent: true, opacity: 0.5, flatShading: true,
});
const ventGlowMat = new THREE.MeshStandardMaterial({
  color: "#bfefff", emissive: "#33b8e0", emissiveIntensity: 0.85, roughness: 0.6,
  side: THREE.DoubleSide,
});

// --- Added gritty-detail geometries (created ONCE, reused) ------------------
const floodPoleGeo = new THREE.CylinderGeometry(0.11, 0.15, 7.2, 8);
const floodHeadGeo = new THREE.BoxGeometry(0.8, 0.55, 0.34);
const bollardGeo = new THREE.CylinderGeometry(0.13, 0.16, 1.0, 8);
const bollardStripeGeo = new THREE.CylinderGeometry(0.155, 0.165, 0.18, 8);
const bollardCapGeo = new THREE.SphereGeometry(0.15, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const reelDiscGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.12, 18);
const reelDrumGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.06, 12);
const cableCoilGeo = new THREE.TorusGeometry(0.52, 0.15, 6, 16);
const ventGrateGeo = new THREE.BoxGeometry(1.3, 0.16, 1.3);
const ventGlowGeo = new THREE.CircleGeometry(0.68, 18);
const fanHubGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.22, 8);
const fanBladeGeo = new THREE.BoxGeometry(0.07, 0.72, 0.18);
const valveWheelGeo = new THREE.TorusGeometry(0.24, 0.045, 6, 14);
const valveSpokeGeo = new THREE.BoxGeometry(0.44, 0.05, 0.05);
const valveStemGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8);
const drumBandGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.16, 12);

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

// ── Enterable TOOL & SUPPLY SHOP ───────────────────────────────────────────
// A small walk-in storefront themed to the works yard: four walls + a floor +
// a flat steel roof, with a 2.2 m DOORWAY GAP cut into the street-facing (−Z)
// wall. Built around a LOCAL origin (centre of the room floor at y=0); the
// caller positions the whole group and offsets the returned colliders.
//
// The doorway is the gap between the two short front-wall segments — and gets
// NO collider, so the player walks straight in. Every other wall (back + two
// sides + the two front flanks) becomes an individual AABB so the shell is
// solid but the interior is fully walkable.
//
// Returns { group, colliders } where colliders are AABBs in the shop's LOCAL
// frame (caller adds the shop's world x/z offset before pushing them).
function makeToolShop(W, D, H, wallT, doorGap) {
  const g = new THREE.Group();
  const colliders = [];

  const hw = W / 2, hd = D / 2;             // interior half-extents
  const wallCX = hw + wallT / 2;            // side-wall centreline offset (X)
  const wallCZ = hd + wallT / 2;            // front/back-wall centreline offset (Z)
  const outerW = W + 2 * wallT;             // front/back walls span past the corners

  // --- Floor slab (sits flush at y=0) and a flat steel roof/ceiling ---------
  const floor = box(W + wallT, 0.12, D + wallT, shopFloorMat, false);
  floor.position.y = 0.06;
  floor.receiveShadow = true;
  g.add(floor);

  const roof = box(outerW, 0.2, D + 2 * wallT, shopRoofMat, true);
  roof.position.y = H + 0.1;
  g.add(roof);
  // a slim eaves/parapet lip so the roof reads as a real cap
  const parapet = box(outerW + 0.18, 0.28, D + 2 * wallT + 0.18, roofMat, false);
  parapet.position.y = H + 0.04;
  g.add(parapet);

  // --- Walls (visible mesh) -------------------------------------------------
  // Back wall (+Z), full span.
  const back = box(outerW, H, wallT, shopWallMat);
  back.position.set(0, H / 2, wallCZ);
  g.add(back);
  // Side walls (±X), span the interior depth.
  for (const sx of [-1, 1]) {
    const side = box(wallT, H, D, shopWallMat);
    side.position.set(sx * wallCX, H / 2, 0);
    g.add(side);
  }
  // Front wall (−Z): two segments flanking the doorway gap.
  const frontSegLen = (outerW - doorGap) / 2;
  const segOffset = doorGap / 2 + frontSegLen / 2;
  for (const sx of [-1, 1]) {
    const seg = box(frontSegLen, H, wallT, shopWallMat);
    seg.position.set(sx * segOffset, H / 2, -wallCZ);
    g.add(seg);
  }
  // A header/lintel spanning ABOVE the doorway (door clear height ~2.4 m) so the
  // opening reads as a framed door, not a missing wall chunk. It is up high, so
  // it does NOT block the walkable doorway and gets no collider.
  const doorClear = 2.4;
  if (H > doorClear + 0.1) {
    const lintel = box(doorGap + 0.2, H - doorClear, wallT, shopWallMat);
    lintel.position.set(0, doorClear + (H - doorClear) / 2, -wallCZ);
    g.add(lintel);
  }
  // Door jambs (thin frames either side of the opening) for a finished look.
  for (const sx of [-1, 1]) {
    const jamb = box(0.1, doorClear, wallT + 0.04, frameMat, false);
    jamb.position.set(sx * (doorGap / 2 + 0.05), doorClear / 2, -wallCZ);
    g.add(jamb);
  }

  // --- WALL COLLIDERS (local frame) -----------------------------------------
  // Back wall.
  addCollider(colliders, 0, wallCZ, outerW, wallT);
  // Side walls.
  addCollider(colliders, -wallCX, 0, wallT, D);
  addCollider(colliders, wallCX, 0, wallT, D);
  // Front flanks (NONE across the doorway gap — that span stays open).
  addCollider(colliders, -segOffset, -wallCZ, frontSegLen, wallT);
  addCollider(colliders, segOffset, -wallCZ, frontSegLen, wallT);

  // --- Inviting interior content -------------------------------------------
  // A rug anchoring the centre.
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.55, D * 0.5), shopRugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.13, 0.2);
  rug.receiveShadow = true;
  g.add(rug);

  // Service COUNTER along the back-left, with a lighter countertop.
  const counterW = W * 0.5, counterD = 0.7, counterH = 1.05;
  const counterX = -hw + counterW / 2 + 0.4;
  const counterZ = hd - counterD / 2 - 0.5;
  const counterBody = box(counterW, counterH, counterD, counterMat);
  counterBody.position.set(counterX, counterH / 2, counterZ);
  g.add(counterBody);
  const counterTop = box(counterW + 0.12, 0.08, counterD + 0.12, counterTopMat);
  counterTop.position.set(counterX, counterH + 0.04, counterZ);
  g.add(counterTop);
  // A small register block + a couple of paint cans on the counter.
  const register = box(0.34, 0.22, 0.26, stoolSeatMat);
  register.position.set(counterX - counterW / 2 + 0.45, counterH + 0.19, counterZ);
  g.add(register);
  for (let i = 0; i < 3; i++) {
    const can = new THREE.Mesh(shopProdCanGeo, i % 2 ? prodMatD : prodMatA);
    can.position.set(counterX + 0.4 + i * 0.32, counterH + 0.23, counterZ + 0.05);
    can.castShadow = true;
    g.add(can);
  }

  // SHELVING along the back wall + the +X side wall, each a stack of planks.
  // Little themed products sit on the planks via InstancedMesh (one per shape).
  const prodCans = []; // {x,y,z}
  const prodBoxes = [];
  function shelfUnit(cxL, czL, unitW, faceX) {
    // faceX !== 0 → unit runs along Z against an X-wall; else along X against +Z wall
    const planks = 3;
    const unitH = 2.0;
    const frame = box(faceX ? 0.3 : unitW, unitH, faceX ? unitW : 0.3, shelfMat, false);
    frame.position.set(cxL, unitH / 2, czL);
    g.add(frame);
    for (let p = 0; p < planks; p++) {
      const py = 0.55 + p * 0.6;
      const plank = box(faceX ? 0.34 : unitW, 0.05, faceX ? unitW : 0.34, shelfMat, false);
      plank.position.set(cxL, py, czL);
      g.add(plank);
      // scatter products along this plank
      const n = faceX ? Math.max(2, Math.floor(unitW / 0.5)) : Math.max(2, Math.floor(unitW / 0.5));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n - 0.5;
        const ox = faceX ? cxL : cxL + t * (unitW - 0.4);
        const oz = faceX ? czL + t * (unitW - 0.4) : czL;
        const slot = (p + k) % 2;
        if (slot === 0) prodCans.push({ x: ox, y: py + 0.18, z: oz });
        else prodBoxes.push({ x: ox, y: py + 0.16, z: oz });
      }
    }
  }
  // back-wall shelving (right of the counter), running along X
  shelfUnit(hw - 1.9, hd - 0.32, 3.0, 0);
  // +X side-wall shelving, running along Z
  shelfUnit(hw - 0.32, -hd + 1.6, 2.6, 1);

  // Instanced product meshes (4 colour pools → still few draw calls).
  function placeProducts(list, geo, mats) {
    if (!list.length) return;
    const per = Math.ceil(list.length / mats.length);
    let idx = 0;
    for (let mi = 0; mi < mats.length; mi++) {
      const slice = list.slice(idx, idx + per);
      idx += per;
      if (!slice.length) continue;
      const inst = new THREE.InstancedMesh(geo, mats[mi], slice.length);
      inst.castShadow = true;
      const m = new THREE.Matrix4();
      for (let i = 0; i < slice.length; i++) {
        m.makeTranslation(slice[i].x, slice[i].y, slice[i].z);
        inst.setMatrixAt(i, m.clone());
      }
      inst.instanceMatrix.needsUpdate = true;
      g.add(inst);
    }
  }
  placeProducts(prodCans, shopProdCanGeo, [prodMatA, prodMatD]);
  placeProducts(prodBoxes, shopProdBoxGeo, [prodMatB, prodMatC]);

  // A DISPLAY RACK (tool wall) of hanging hand tools against the −X wall:
  // a slim pegboard panel + a few hung "tools" (thin boxes).
  const pegboard = box(0.12, 1.6, 2.4, rackMat, false);
  pegboard.position.set(-hw + 0.12, 1.4, -hd + 1.8);
  g.add(pegboard);
  const toolGeo = new THREE.BoxGeometry(0.06, 0.5, 0.12);
  for (let i = 0; i < 5; i++) {
    const tool = new THREE.Mesh(toolGeo, i % 2 ? stoolLegMat : prodMatC);
    tool.position.set(-hw + 0.22, 1.5, -hd + 0.9 + i * 0.45);
    tool.castShadow = true;
    g.add(tool);
  }

  // A couple of STOOLS by the counter for customers.
  for (const sx of [-0.5, 0.55]) {
    const stool = new THREE.Group();
    const seat = new THREE.Mesh(stoolSeatGeo, stoolSeatMat);
    seat.position.y = 0.64;
    seat.castShadow = true;
    stool.add(seat);
    for (let l = 0; l < 3; l++) {
      const a = (l / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(stoolLegGeo, stoolLegMat);
      leg.position.set(Math.cos(a) * 0.13, 0.31, Math.sin(a) * 0.13);
      leg.rotation.z = Math.cos(a) * 0.08;
      leg.rotation.x = -Math.sin(a) * 0.08;
      stool.add(leg);
    }
    stool.position.set(counterX + sx, 0.13, counterZ - 0.95);
    g.add(stool);
  }

  // Hanging INTERIOR LIGHTS (cord + glowing conical shade) — two of them.
  for (const lx of [-W * 0.22, W * 0.26]) {
    const cordLen = H - 0.9;
    const cord = new THREE.Mesh(lampCordGeo, cordMat);
    cord.scale.y = cordLen;
    cord.position.set(lx, H - cordLen / 2 - 0.1, -0.2);
    g.add(cord);
    const shade = new THREE.Mesh(lampShadeGeo, lampShadeMat);
    shade.position.set(lx, H - cordLen - 0.1, -0.2);
    shade.castShadow = false;
    g.add(shade);
  }

  // Interior WALL SIGNAGE behind the counter (un-mirrored, faces −Z into room).
  const wallSign = artPanel(2.4, 0.9, "sign", {
    text: "TOOLS PARTS", bg: "#222831", fg: "#ffd369", emissiveIntensity: 0.4,
    file: "industrial-shop-wallsign.png",
  });
  wallSign.position.set(counterX, 2.2, hd - 0.06);
  wallSign.rotation.y = Math.PI; // textured front faces −Z (into the room)
  g.add(wallSign);

  return { group: g, colliders };
}

// ── Enterable FABRICATION / WELDING SHOP ───────────────────────────────────
// A second walk-in storefront with its OWN look: a welding bench, paired gas
// bottles, an anvil on a stump, a parts shelf and a glowing weld-arc that the
// caller animates. Same shell convention as makeToolShop — four walls + floor +
// flat roof with a doorway GAP in the −Z (street) wall (no collider on the gap).
//
// Returns { group, colliders, sparks } where sparks is an array of
// { mesh, baseY, t, speed } the caller's update() advances (no per-frame alloc).
function makeFabShop(W, D, H, wallT, doorGap) {
  const g = new THREE.Group();
  const colliders = [];
  const sparks = [];

  const hw = W / 2, hd = D / 2;
  const wallCX = hw + wallT / 2;
  const wallCZ = hd + wallT / 2;
  const outerW = W + 2 * wallT;

  // Floor + flat roof + parapet (same recipe as the tool shop).
  const floor = box(W + wallT, 0.12, D + wallT, shopFloorMat, false);
  floor.position.y = 0.06;
  floor.receiveShadow = true;
  g.add(floor);
  const roof = box(outerW, 0.2, D + 2 * wallT, shopRoofMat, true);
  roof.position.y = H + 0.1;
  g.add(roof);
  const parapet = box(outerW + 0.18, 0.28, D + 2 * wallT + 0.18, roofMat, false);
  parapet.position.y = H + 0.04;
  g.add(parapet);

  // Walls: back (+Z), two sides (±X), and two front (−Z) flanks around the door.
  const back = box(outerW, H, wallT, shopWallMat);
  back.position.set(0, H / 2, wallCZ);
  g.add(back);
  for (const sx of [-1, 1]) {
    const side = box(wallT, H, D, shopWallMat);
    side.position.set(sx * wallCX, H / 2, 0);
    g.add(side);
  }
  const frontSegLen = (outerW - doorGap) / 2;
  const segOffset = doorGap / 2 + frontSegLen / 2;
  for (const sx of [-1, 1]) {
    const seg = box(frontSegLen, H, wallT, shopWallMat);
    seg.position.set(sx * segOffset, H / 2, -wallCZ);
    g.add(seg);
  }
  const doorClear = 2.4;
  if (H > doorClear + 0.1) {
    const lintel = box(doorGap + 0.2, H - doorClear, wallT, shopWallMat);
    lintel.position.set(0, doorClear + (H - doorClear) / 2, -wallCZ);
    g.add(lintel);
  }
  for (const sx of [-1, 1]) {
    const jamb = box(0.1, doorClear, wallT + 0.04, frameMat, false);
    jamb.position.set(sx * (doorGap / 2 + 0.05), doorClear / 2, -wallCZ);
    g.add(jamb);
  }

  // WALL COLLIDERS (local frame; doorway gap left open — no collider).
  addCollider(colliders, 0, wallCZ, outerW, wallT);
  addCollider(colliders, -wallCX, 0, wallT, D);
  addCollider(colliders, wallCX, 0, wallT, D);
  addCollider(colliders, -segOffset, -wallCZ, frontSegLen, wallT);
  addCollider(colliders, segOffset, -wallCZ, frontSegLen, wallT);

  // Floor rug to anchor the room.
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.5, D * 0.5), shopRugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.13, 0.1);
  rug.receiveShadow = true;
  g.add(rug);

  // WELDING BENCH along the back wall — a heavy steel-topped table.
  const benchW = W * 0.6, benchD = 0.7, benchH = 0.95;
  const benchX = -hw + benchW / 2 + 0.4;
  const benchZ = hd - benchD / 2 - 0.45;
  const benchLegMat = stoolLegMat;
  for (const lx of [-benchW / 2 + 0.15, benchW / 2 - 0.15]) {
    for (const lz of [-benchD / 2 + 0.12, benchD / 2 - 0.12]) {
      const leg = box(0.1, benchH, 0.1, benchLegMat, false);
      leg.position.set(benchX + lx, benchH / 2, benchZ + lz);
      g.add(leg);
    }
  }
  const benchTop = box(benchW, 0.1, benchD, benchTopMat);
  benchTop.position.set(benchX, benchH, benchZ);
  g.add(benchTop);
  // A weld-arc glow on the bench, with a small pool of rising sparks.
  const arc = new THREE.Mesh(sparkGeo, sparkMat);
  arc.scale.setScalar(1.6);
  arc.position.set(benchX + 0.4, benchH + 0.12, benchZ);
  g.add(arc);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(sparkGeo, sparkMat);
    const baseX = benchX + 0.4 + (Math.random() - 0.5) * 0.3;
    const baseZ = benchZ + (Math.random() - 0.5) * 0.3;
    s.position.set(baseX, benchH + 0.14, baseZ);
    g.add(s);
    sparks.push({ mesh: s, baseY: benchH + 0.14, x: baseX, z: baseZ, t: i / 5, speed: 1.2 + Math.random() });
  }

  // Paired GAS BOTTLES (oxy + fuel) chained by the +X wall.
  for (let i = 0; i < 2; i++) {
    const bottle = new THREE.Mesh(gasBottleGeo, i ? gasBottleB : gasBottleA);
    bottle.position.set(hw - 0.4, 0.55, -hd + 0.6 + i * 0.45);
    bottle.castShadow = true;
    g.add(bottle);
    const cap = new THREE.Mesh(gasCapGeo, frameMat);
    cap.position.set(hw - 0.4, 1.1, -hd + 0.6 + i * 0.45);
    g.add(cap);
  }

  // ANVIL on a chunky stump near the centre-front.
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.6, 10), counterMat);
  stump.position.set(hw - 1.5, 0.3, -hd + 1.4);
  stump.castShadow = true;
  g.add(stump);
  const anvilBody = box(0.7, 0.22, 0.28, anvilMat);
  anvilBody.position.set(hw - 1.5, 0.7, -hd + 1.4);
  anvilBody.castShadow = true;
  g.add(anvilBody);
  const anvilWaist = box(0.3, 0.16, 0.2, anvilMat, false);
  anvilWaist.position.set(hw - 1.5, 0.53, -hd + 1.4);
  g.add(anvilWaist);

  // A small PARTS SHELF on the −X wall (planks + a couple of instanced boxes).
  const shelfX = -hw + 0.3;
  const shelfFrame = box(0.3, 1.7, D * 0.55, shelfMat, false);
  shelfFrame.position.set(shelfX, 0.85, -hd + D * 0.32);
  g.add(shelfFrame);
  const shelfBoxes = [];
  for (let p = 0; p < 3; p++) {
    const py = 0.5 + p * 0.55;
    const plank = box(0.34, 0.05, D * 0.55, shelfMat, false);
    plank.position.set(shelfX, py, -hd + D * 0.32);
    g.add(plank);
    for (let k = 0; k < 2; k++) {
      shelfBoxes.push({ x: shelfX, y: py + 0.16, z: -hd + 0.8 + k * 1.0 + p * 0.1 });
    }
  }
  if (shelfBoxes.length) {
    const inst = new THREE.InstancedMesh(shopProdBoxGeo, prodMatC, shelfBoxes.length);
    inst.castShadow = true;
    const m = new THREE.Matrix4();
    for (let i = 0; i < shelfBoxes.length; i++) {
      m.makeTranslation(shelfBoxes[i].x, shelfBoxes[i].y, shelfBoxes[i].z);
      inst.setMatrixAt(i, m.clone());
    }
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  }

  // One hanging interior light.
  const cordLen = H - 0.9;
  const cord = new THREE.Mesh(lampCordGeo, cordMat);
  cord.scale.y = cordLen;
  cord.position.set(0, H - cordLen / 2 - 0.1, 0);
  g.add(cord);
  const shade = new THREE.Mesh(lampShadeGeo, lampShadeMat);
  shade.position.set(0, H - cordLen - 0.1, 0);
  g.add(shade);

  // Interior wall sign behind the bench.
  const wallSign = artPanel(2.2, 0.8, "sign", {
    text: "WELD · FAB", bg: "#1c1c1c", fg: "#ffb347", emissiveIntensity: 0.45,
    file: "industrial-fab-wallsign.png",
  });
  wallSign.position.set(benchX, 2.1, hd - 0.06);
  wallSign.rotation.y = Math.PI;
  g.add(wallSign);

  return { group: g, colliders, sparks };
}

// A street-side planter (concrete box + a couple of clumpy shrubs). Decorative,
// no collider — small enough to walk past, adds greenery to the grey yard.
function makePlanter() {
  const g = new THREE.Group();
  const tub = box(1.3, 0.5, 0.7, planterMat);
  tub.position.y = 0.25;
  g.add(tub);
  for (const sx of [-0.32, 0.0, 0.34]) {
    const shrub = new THREE.Mesh(shrubGeo, shrubMat);
    shrub.position.set(sx, 0.62 + Math.abs(sx) * 0.1, (sx === 0 ? 0.05 : 0));
    shrub.scale.set(1, 0.85, 1);
    shrub.castShadow = true;
    g.add(shrub);
  }
  return g;
}

// A wooden loading PALLET stacked with a crate. Footprint is small; the caller
// adds a tight collider so it reads solid.
function makePallet() {
  const g = new THREE.Group();
  const topGeo = new THREE.BoxGeometry(1.2, 0.05, 1.2);
  const top = new THREE.Mesh(topGeo, palletMat);
  top.position.y = 0.16;
  top.receiveShadow = true;
  g.add(top);
  for (const pz of [-0.5, 0, 0.5]) {
    const plank = new THREE.Mesh(palletPlankGeo, palletMat);
    plank.position.set(0, 0.06, pz);
    g.add(plank);
  }
  const crate = new THREE.Mesh(crateGeo, crateMat);
  crate.scale.setScalar(0.7);
  crate.position.set(0.05, 0.7, -0.05);
  crate.rotation.y = 0.2;
  crate.castShadow = true;
  g.add(crate);
  return g;
}

// A simple yard LAMP POST (pole + boxy head with an emissive lens). No collider
// (slim pole), pure ambience for the evening-lit works yard.
function makeLampPost() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.6, 8), lampPostMat);
  pole.position.y = 1.8;
  pole.castShadow = true;
  g.add(pole);
  const arm = box(0.7, 0.1, 0.1, lampPostMat, false);
  arm.position.set(0.3, 3.5, 0);
  g.add(arm);
  const head = box(0.5, 0.18, 0.3, lampPostMat, false);
  head.position.set(0.6, 3.4, 0);
  g.add(head);
  const lens = box(0.4, 0.06, 0.22, lampGlowMat, false);
  lens.position.set(0.6, 3.3, 0);
  g.add(lens);
  return g;
}

// A simple slatted yard BENCH (seat + back + two end legs). Decorative, no
// collider — slim enough to read as walk-past clutter beside the shop fronts.
function makeBench() {
  const g = new THREE.Group();
  const seat = box(1.6, 0.1, 0.45, palletMat, false);
  seat.position.y = 0.48;
  g.add(seat);
  const back = box(1.6, 0.4, 0.08, palletMat, false);
  back.position.set(0, 0.74, -0.2);
  g.add(back);
  for (const sx of [-0.65, 0.65]) {
    const leg = box(0.12, 0.48, 0.42, frameMat, false);
    leg.position.set(sx, 0.24, 0);
    g.add(leg);
  }
  return g;
}

// A projecting door AWNING: a canted canopy on two angled wall braces, built so
// its LOCAL origin sits at the wall face and the canopy cants out toward −Z (the
// street). Mounted ABOVE the door (y≈2.55) so it never blocks the doorway — and
// it carries NO collider, so the player walks straight under it into the shop.
// (Colliders are infinite-height in XZ; a high canopy MUST stay collider-free.)
function makeAwning(width) {
  const g = new THREE.Group();
  const canopy = box(width, 0.08, 1.1, awningMat, false);
  canopy.position.set(0, 0, -0.55);
  canopy.rotation.x = -0.32; // outer edge cants down toward the street
  g.add(canopy);
  const valance = box(width, 0.22, 0.05, awningMat, false);
  valance.position.set(0, -0.16, -1.04);
  g.add(valance);
  for (const sx of [-width / 2 + 0.25, width / 2 - 0.25]) {
    const brace = box(0.05, 0.05, 1.05, frameMat, false);
    brace.position.set(sx, -0.16, -0.5);
    brace.rotation.x = 0.42;
    g.add(brace);
  }
  return g;
}

// An overhead PIPE GANTRY that straddles a lane: two ground legs (with feet) a
// `span` apart, an overhead crossbeam carrying a twin pipe run, and a hanging
// caution sign slung below the beam. EVERYTHING above the legs (beam, pipes,
// sign) sits >4 m up with NO collider, so the car + player pass underneath; the
// caller adds a TIGHT collider on each thin leg only. Sign is DoubleSide
// (artPanel) so it reads from both lane directions.
function makeGantry(span) {
  const g = new THREE.Group();
  const legH = 4.6;
  const legGeo = new THREE.BoxGeometry(0.24, legH, 0.24);
  for (const sx of [-span / 2, span / 2]) {
    const leg = new THREE.Mesh(legGeo, frameMat);
    leg.position.set(sx, legH / 2, 0);
    leg.castShadow = true;
    g.add(leg);
    const foot = box(0.5, 0.12, 0.5, concreteDark, false);
    foot.position.set(sx, 0.06, 0);
    g.add(foot);
  }
  const beamY = legH - 0.2;
  const beam = box(span + 0.5, 0.3, 0.4, frameMat);
  beam.position.set(0, beamY, 0);
  g.add(beam);
  const pipeG = new THREE.CylinderGeometry(0.16, 0.16, span + 0.4, 8);
  for (let i = 0; i < 2; i++) {
    const p = new THREE.Mesh(pipeG, i ? pipeMat2 : pipeMat);
    p.rotation.z = Math.PI / 2;
    p.position.set(0, beamY + 0.32 + i * 0.34, i ? 0.12 : -0.12);
    p.castShadow = true;
    g.add(p);
  }
  // hanging caution sign below the beam (bottom ≈ 3.35 m — overhead, NO collider)
  const sign = artPanel(1.7, 0.6, "sign", {
    text: "CLEARANCE", bg: "#e6c200", fg: "#1c1c1c", emissiveIntensity: 0.4,
    file: "industrial-gantry-sign.png",
  });
  sign.position.set(0, beamY - 0.75, 0);
  g.add(sign);
  for (const sx of [-0.75, 0.75]) {
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 5), frameMat);
    chain.position.set(sx, beamY - 0.42, 0);
    g.add(chain);
  }
  return g;
}

// ── Enterable MESS HALL / CANTEEN ──────────────────────────────────────────
// A third interior archetype (the works canteen) sharing the same shell as the
// other two shops: four walls + floor + flat roof, with a doorway GAP in the −Z
// (street) wall that carries NO collider. Interior: a servery counter, a pair of
// canteen tables with stools, a drinks shelf and a wall sign. Returns
// { group, colliders } with colliders in the shop's LOCAL frame (the caller
// offsets them via placeShopColliders).
function makeMessHall(W, D, H, wallT, doorGap) {
  const g = new THREE.Group();
  const colliders = [];
  const hw = W / 2, hd = D / 2;
  const wallCX = hw + wallT / 2;
  const wallCZ = hd + wallT / 2;
  const outerW = W + 2 * wallT;

  // Floor + flat roof + parapet (same recipe as the other shops).
  const floor = box(W + wallT, 0.12, D + wallT, shopFloorMat, false);
  floor.position.y = 0.06; floor.receiveShadow = true; g.add(floor);
  const roof = box(outerW, 0.2, D + 2 * wallT, shopRoofMat, true);
  roof.position.y = H + 0.1; g.add(roof);
  const parapet = box(outerW + 0.18, 0.28, D + 2 * wallT + 0.18, roofMat, false);
  parapet.position.y = H + 0.04; g.add(parapet);

  // Walls: back (+Z), two sides (±X), two front (−Z) flanks around the door.
  const back = box(outerW, H, wallT, shopWallMat);
  back.position.set(0, H / 2, wallCZ); g.add(back);
  for (const sx of [-1, 1]) {
    const side = box(wallT, H, D, shopWallMat);
    side.position.set(sx * wallCX, H / 2, 0); g.add(side);
  }
  const frontSegLen = (outerW - doorGap) / 2;
  const segOffset = doorGap / 2 + frontSegLen / 2;
  for (const sx of [-1, 1]) {
    const seg = box(frontSegLen, H, wallT, shopWallMat);
    seg.position.set(sx * segOffset, H / 2, -wallCZ); g.add(seg);
  }
  const doorClear = 2.4;
  if (H > doorClear + 0.1) {
    const lintel = box(doorGap + 0.2, H - doorClear, wallT, shopWallMat);
    lintel.position.set(0, doorClear + (H - doorClear) / 2, -wallCZ); g.add(lintel);
  }
  for (const sx of [-1, 1]) {
    const jamb = box(0.1, doorClear, wallT + 0.04, frameMat, false);
    jamb.position.set(sx * (doorGap / 2 + 0.05), doorClear / 2, -wallCZ); g.add(jamb);
  }

  // WALL COLLIDERS (doorway gap left open — no collider).
  addCollider(colliders, 0, wallCZ, outerW, wallT);
  addCollider(colliders, -wallCX, 0, wallT, D);
  addCollider(colliders, wallCX, 0, wallT, D);
  addCollider(colliders, -segOffset, -wallCZ, frontSegLen, wallT);
  addCollider(colliders, segOffset, -wallCZ, frontSegLen, wallT);

  // Floor rug to anchor the room.
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.5, D * 0.5), shopRugMat);
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.13, 0.1);
  rug.receiveShadow = true; g.add(rug);

  // Servery COUNTER along the back wall, with a lighter top, a tea urn + tins.
  const counterW = W * 0.62, counterD = 0.6, counterH = 1.0;
  const counterZ = hd - counterD / 2 - 0.4;
  const counterBody = box(counterW, counterH, counterD, counterMat);
  counterBody.position.set(0, counterH / 2, counterZ); g.add(counterBody);
  const counterTop = box(counterW + 0.1, 0.08, counterD + 0.1, counterTopMat);
  counterTop.position.set(0, counterH + 0.04, counterZ); g.add(counterTop);
  const urn = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.4, 10), stoolLegMat);
  urn.position.set(-counterW / 2 + 0.4, counterH + 0.24, counterZ);
  urn.castShadow = true; g.add(urn);
  for (let i = 0; i < 3; i++) {
    const tin = new THREE.Mesh(shopProdCanGeo, i % 2 ? prodMatD : prodMatA);
    tin.position.set(0.1 + i * 0.3, counterH + 0.23, counterZ);
    tin.castShadow = true; g.add(tin);
  }

  // Two canteen TABLES (steel-topped) with a pair of stools each.
  for (const tx of [-hw + 0.95, hw - 0.95]) {
    const tableTop = box(1.0, 0.08, 0.8, counterTopMat);
    tableTop.position.set(tx, 0.74, -hd + 1.25); g.add(tableTop);
    const tleg = box(0.12, 0.74, 0.12, stoolLegMat, false);
    tleg.position.set(tx, 0.37, -hd + 1.25); g.add(tleg);
    for (const sz of [-0.55, 0.55]) {
      const stool = new THREE.Mesh(stoolSeatGeo, stoolSeatMat);
      stool.position.set(tx, 0.48, -hd + 1.25 + sz);
      stool.castShadow = true; g.add(stool);
    }
  }

  // A drinks/supplies SHELF on the +X wall (a couple of planks).
  const shelfX = hw - 0.28;
  for (let p = 0; p < 2; p++) {
    const plank = box(0.32, 0.05, D * 0.5, shelfMat, false);
    plank.position.set(shelfX, 0.9 + p * 0.6, 0); g.add(plank);
  }

  // Hanging interior light.
  const cordLen = H - 0.9;
  const cord = new THREE.Mesh(lampCordGeo, cordMat);
  cord.scale.y = cordLen; cord.position.set(0, H - cordLen / 2 - 0.1, 0); g.add(cord);
  const shade = new THREE.Mesh(lampShadeGeo, lampShadeMat);
  shade.position.set(0, H - cordLen - 0.1, 0); g.add(shade);

  // Interior wall sign behind the counter (faces −Z into the room).
  const wallSign = artPanel(2.0, 0.7, "sign", {
    text: "CANTEEN", bg: "#0b6e4f", fg: "#f7fff7", emissiveIntensity: 0.4,
    file: "industrial-mess-wallsign.png",
  });
  wallSign.position.set(0, 2.1, hd - 0.06);
  wallSign.rotation.y = Math.PI;
  g.add(wallSign);

  return { group: g, colliders };
}

// A tall FLOODLIGHT MAST: a slim tapered pole on a plinth with a canted head-bar
// carrying three EMISSIVE lamp heads (glow boxes — NOT real lights). Heads share
// floodHeadMat so update() can flicker them all at once with zero allocation.
function makeFloodMast() {
  const g = new THREE.Group();
  const H = 7.2;
  const base = box(0.5, 0.3, 0.5, concreteDark, false);
  base.position.y = 0.15;
  g.add(base);
  const pole = new THREE.Mesh(floodPoleGeo, lampPostMat);
  pole.position.y = H / 2 + 0.1;
  pole.castShadow = true;
  g.add(pole);
  const bar = box(1.9, 0.14, 0.14, frameMat, false);
  bar.position.set(0.2, H, 0);
  g.add(bar);
  for (let i = 0; i < 3; i++) {
    const head = new THREE.Mesh(floodHeadGeo, floodHeadMat);
    head.position.set(-0.6 + i * 0.7, H - 0.18, 0);
    head.rotation.x = 0.5; // aim the beam box down into the yard
    head.castShadow = false;
    g.add(head);
  }
  return g;
}

// A hazard BOLLARD: a stubby safety-yellow post with a black stripe and an
// emissive amber cap. Caps share bollardCapMat so update() strobes them like
// warning lamps. Slim + no collider (walk-past marker clutter).
function makeBollard() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(bollardGeo, hazardMat);
  post.position.y = 0.5;
  post.castShadow = true;
  g.add(post);
  const stripe = new THREE.Mesh(bollardStripeGeo, hazardDark);
  stripe.position.y = 0.62;
  g.add(stripe);
  const cap = new THREE.Mesh(bollardCapGeo, bollardCapMat);
  cap.position.y = 1.0;
  g.add(cap);
  return g;
}

// A cable REEL / spool: two wooden end-discs on a steel drum, wound with a few
// dark cable coils. A solid yard mass — the caller adds a tight collider.
function makeCableReel() {
  const g = new THREE.Group();
  const axleY = 0.9;
  for (const sx of [-0.55, 0.55]) {
    const disc = new THREE.Mesh(reelDiscGeo, palletMat);
    disc.rotation.z = Math.PI / 2; // coin faces along X (the axle)
    disc.position.set(sx, axleY, 0);
    disc.castShadow = true;
    g.add(disc);
  }
  const drum = new THREE.Mesh(reelDrumGeo, frameMat);
  drum.rotation.z = Math.PI / 2;
  drum.position.y = axleY;
  g.add(drum);
  for (let i = 0; i < 3; i++) {
    const coil = new THREE.Mesh(cableCoilGeo, bumperMat);
    coil.rotation.y = Math.PI / 2; // ring wraps around the X axle
    coil.position.set(-0.3 + i * 0.3, axleY, 0);
    g.add(coil);
  }
  return g;
}

// A coolant/STEAM VENT: a floor grate with an emissive glow disc and a rising
// column of translucent steam puffs (each puff owns a cloned material so it can
// fade independently). Returns { group, system } — system = { tipY, puffs } the
// caller's update() advances with no per-frame allocation.
function makeSteamVent() {
  const g = new THREE.Group();
  const grate = new THREE.Mesh(ventGrateGeo, ventMat);
  grate.position.y = 0.08;
  grate.receiveShadow = true;
  g.add(grate);
  const glow = new THREE.Mesh(ventGlowGeo, ventGlowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.17;
  g.add(glow);
  const puffs = [];
  const tipY = 0.3;
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Mesh(smokeGeo, steamMat.clone());
    puff.castShadow = false;
    puff.position.set(0, tipY, 0);
    puff.scale.setScalar(0.5);
    g.add(puff);
    puffs.push({ mesh: puff, life: i / 4, speed: 0.7 + Math.random() * 0.3, sway: Math.random() * Math.PI * 2 });
  }
  return { group: g, system: { tipY, puffs } };
}

// A wall EXHAUST FAN: a square steel housing with a five-blade rotor that the
// caller spins about its own axis. Blades are grouped so update() rotates the
// group (no per-frame allocation). Mounted high on a gable — NO collider.
function makeExhaustFan(fans) {
  const g = new THREE.Group();
  const housing = box(0.22, 1.8, 1.8, frameMat);
  g.add(housing);
  const hub = new THREE.Mesh(fanHubGeo, catwalkMat);
  hub.rotation.z = Math.PI / 2; // hub axis along X (the fan faces +X)
  hub.position.x = 0.16;
  g.add(hub);
  const blades = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = (i / 5) * Math.PI * 2; // radiate around the X axle
    const blade = new THREE.Mesh(fanBladeGeo, catwalkMat);
    blade.position.y = 0.42;
    blade.rotation.z = 0.35; // slight pitch so the spin reads
    holder.add(blade);
    blades.add(holder);
  }
  blades.position.x = 0.16;
  g.add(blades);
  fans.push(blades);
  return g;
}

// A pipe VALVE HAND-WHEEL: a red rim + spokes in the XY plane, spinning about
// its local Z (faces the viewer). Caller adds a short stem to the pipe.
function makeValveWheel() {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(valveWheelGeo, drumRed);
  g.add(rim);
  for (let i = 0; i < 2; i++) {
    const spoke = new THREE.Mesh(valveSpokeGeo, drumRed);
    spoke.rotation.z = i * Math.PI / 2;
    g.add(spoke);
  }
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

  // NW warehouse, runs along Z (deep shed). Set BACK from the seam roads so its
  // body + dock + catwalk all clear the kerb/sidewalk: footprint x∈[-22,-8],
  // z∈[-21,-5] (dock apron reaches z≈-3.4, catwalk reaches x≈-7.2 — both inward
  // toward the open centre). Nothing reaches past ±23 on any tile edge.
  const WH1 = { w: 14, h: 7, d: 16, x: -15, z: -13 };
  const wh1 = makeWarehouse(WH1.w, WH1.h, WH1.d, steelWall, spinners);
  wh1.position.set(WH1.x, 0, WH1.z);
  group.add(wh1);
  addCollider(colliders, WH1.x, WH1.z, WH1.w, WH1.d);

  // SW warehouse (rusty), runs along X. Flipped 180° so its detailed FRONT
  // (loading dock + roller doors, built on the local +Z face) points toward the
  // open center lane (−Z) the player approaches from, not the cramped south
  // perimeter strip. Footprint is symmetric so the collider stays centred.
  // Pulled IN off the south + west seam roads: footprint x∈[-21.5,-3.5],
  // z∈[10,22]; with the 180° flip the catwalk pokes to x≈-22.3 and the dock to
  // z≈8.4 (both inside ±23). Nothing sits in the kerb/sidewalk.
  const WH2 = { w: 18, h: 6.5, d: 12, x: -12.5, z: 16 };
  const wh2 = makeWarehouse(WH2.w, WH2.h, WH2.d, steelWallRust, spinners);
  wh2.position.set(WH2.x, 0, WH2.z);
  wh2.rotation.y = Math.PI;
  group.add(wh2);
  addCollider(colliders, WH2.x, WH2.z, WH2.w, WH2.d);

  // NE warehouse, runs along X (deepened so its back is a real wall, not a card).
  // Set BACK from the north + east seam roads: footprint x∈[4,22], z∈[-21,-10];
  // the +X catwalk reaches x≈22.85 and the +Z dock apron reaches z≈-8.4 (toward
  // the open centre) — all inside ±23, clear of the kerb/sidewalk.
  const WH3 = { w: 18, h: 6.5, d: 11, x: 13, z: -15.5 };
  const wh3 = makeWarehouse(WH3.w, WH3.h, WH3.d, steelWall, spinners);
  wh3.position.set(WH3.x, 0, WH3.z);
  group.add(wh3);
  addCollider(colliders, WH3.x, WH3.z, WH3.w, WH3.d);

  // --- Silos cluster (NE quadrant, south of wh3) ---------------------------
  const siloSpots = [[10, -6], [14.5, -6.3]];
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

  // --- Water tower (SE quadrant, prominent) --------------------------------
  // Pulled IN from the SE corner so its tank/roof (radius ≈2.6) clear the seam
  // roads: at (20,20) the widest part reaches ±22.6 in X,Z — inside ±23.
  const tower = makeWaterTower();
  tower.position.set(20, 0, 20);
  group.add(tower);
  addCollider(colliders, 20, 20, 3.6, 3.6); // tight to the leg spread

  // --- Two smokestacks rising off the NW warehouse ROOF --------------------
  // Mounted on the roof (baseY ≈ ridge height of wh1) so the chimneys sit ON the
  // shed instead of punching through its mass. No ground colliders: they're up
  // on the roof, not blocking the yard floor. Both stack feet land inside wh1's
  // (set-back) footprint (x∈[-22,-8], z∈[-21,-5]).
  // Emitters at the stack tips; each owns a pool of reusable puff blobs.
  const smokeSystems = [];
  const wh1RoofY = WH1.h + WH1.h * 0.28; // wh1 gable ridge height
  const stackSpots = [
    { x: -16, z: -15, h: 8, baseY: wh1RoofY - 0.6 },
    { x: -13, z: -10, h: 6.5, baseY: wh1RoofY - 0.6 },
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

  // --- Enterable TOOL & SUPPLY SHOP (SE quadrant, inner edge) ---------------
  // Tucked into clear space east of the open centre cross: interior 7.0 × 5.8 m,
  // street-facing (−Z) wall toward the player's approach from the open lane.
  // Outer footprint x∈[7.25,14.75], z∈[6.05,12.35] — inside ±23, clear of the
  // open lanes (minZ 6.05 > the z≈3.4 kerb), the warehouses, silos, tanks and
  // scatter props. The doorway gap in the −Z wall gets NO collider, so the
  // player walks straight in; every other wall is an individual AABB.
  const SHOP = { x: 11.0, z: 9.2, W: 7.0, D: 5.8, H: 3.2, wallT: 0.25, door: 2.2 };
  const shop = makeToolShop(SHOP.W, SHOP.D, SHOP.H, SHOP.wallT, SHOP.door);
  shop.group.position.set(SHOP.x, 0, SHOP.z);
  group.add(shop.group);
  // Offset the shop's local wall colliders into world space and add them.
  for (const c of shop.colliders) {
    colliders.push({
      minX: c.minX + SHOP.x, maxX: c.maxX + SHOP.x,
      minZ: c.minZ + SHOP.z, maxZ: c.maxZ + SHOP.z,
    });
  }
  // Exterior SHOP SIGN above the door, on the OUTSIDE of the −Z (street) wall,
  // facing the street. The street wall is the −Z face and the player approaches
  // from the open centre at LOWER z, looking in +Z toward the shop. artPanel's
  // textured front points +Z by default — i.e. AWAY from that viewer — so we
  // rotate it 180° (rotation.y = π) to face −Z toward the player, so the text
  // reads correctly (un-mirrored). (Same pattern as the SW warehouse sign2.)
  const shopSign = artPanel(3.4, 1.1, "sign", {
    text: "BOLT & BARREL", bg: "#1d4e89", fg: "#ffd166", emissiveIntensity: 0.5,
    file: "industrial-shop-sign.png",
  });
  shopSign.position.set(SHOP.x, SHOP.H + 0.7, SHOP.z - (SHOP.D / 2 + SHOP.wallT) - 0.05);
  shopSign.rotation.y = Math.PI;
  group.add(shopSign);

  // --- Helper: drop an enterable shop, offsetting its local wall colliders into
  // world space. `faceCenter` rotates the shell 180° (door points +Z) for shops
  // NORTH of the centre cross; under that turn a local AABB centred at (cx,cz)
  // maps to world (x0−cx, z0−cz) (verified), so the doorway gap stays open and
  // every solid wall keeps an exact AABB. Returns nothing; mutates `colliders`.
  function placeShopColliders(shopColliders, x0, z0, faceCenter) {
    for (const c of shopColliders) {
      if (faceCenter) {
        // local (cx,cz)->world (x0-cx, z0-cz): negate+swap the min/max bounds.
        colliders.push({
          minX: x0 - c.maxX, maxX: x0 - c.minX,
          minZ: z0 - c.maxZ, maxZ: z0 - c.minZ,
        });
      } else {
        colliders.push({
          minX: c.minX + x0, maxX: c.maxX + x0,
          minZ: c.minZ + z0, maxZ: c.maxZ + z0,
        });
      }
    }
  }

  // --- Enterable FAB / WELDING SHOP "ARC & ANVIL" (west-centre band) --------
  // The open band west of the centre cross (between WH1 to the N and WH2 to the S)
  // fits a COMPACT fab shop facing the lane. Interior 6.0 × 4.0 m; outer footprint
  // x∈[−18.25,−11.75], z∈[3.65,8.15] — inside ±23 and threaded through the narrow
  // gap between the z≈3.4 lane kerb and WH2's flipped loading DOCK APRON, which
  // reaches z≈8.4 (NOT just the WH2 body at z≥10 — the earlier 5.0 m-deep shell
  // clipped that apron). The shallow 4.0 m depth clears both. Door faces −Z toward
  // the player's approach (no flip).
  const FAB = { x: -15.0, z: 5.9, W: 6.0, D: 4.0, H: 3.1, wallT: 0.25, door: 2.2 };
  const fab = makeFabShop(FAB.W, FAB.D, FAB.H, FAB.wallT, FAB.door);
  fab.group.position.set(FAB.x, 0, FAB.z);
  group.add(fab.group);
  placeShopColliders(fab.colliders, FAB.x, FAB.z, false);
  // Hoist this shop's animated weld sparks into world space so update() can
  // advance them (each spark keeps its LOCAL x/z; add the shop offset once).
  const fabSparks = fab.sparks;
  for (const s of fabSparks) { s.wx = s.x + FAB.x; s.wz = s.z + FAB.z; }
  // Exterior sign over the door (−Z wall), rotated to read from the lane.
  const fabSign = artPanel(3.2, 1.0, "sign", {
    text: "ARC & ANVIL", bg: "#2b2118", fg: "#ff9e3d", emissiveIntensity: 0.5,
    file: "industrial-fab-sign.png",
  });
  fabSign.position.set(FAB.x, FAB.H + 0.65, FAB.z - (FAB.D / 2 + FAB.wallT) - 0.05);
  fabSign.rotation.y = Math.PI;
  group.add(fabSign);

  // --- Enterable PARTS DEPOT "GEAR DEPOT" (east band, S of the silos) -------
  // The east strip south of the silos and WH3 fits a tool-supply depot, FLIPPED
  // 180° so its door faces +Z toward the centre the player approaches from.
  // Interior 4.6 × 4.0 m; outer footprint x∈[17.45,22.55], z∈[−8.15,−3.65] —
  // inside ±23 and threaded between WH3's +Z loading DOCK APRON, which reaches
  // z≈−8.4 (NOT just the WH3 body at z≤−10 — the earlier z=−7 placement clipped
  // that apron), and the z≈−3.4 lane kerb the flipped door now opens onto. The
  // flipped colliders are mapped by placeShopColliders.
  const DEPOT = { x: 20.0, z: -5.9, W: 4.6, D: 4.0, H: 3.0, wallT: 0.25, door: 2.0 };
  const depot = makeToolShop(DEPOT.W, DEPOT.D, DEPOT.H, DEPOT.wallT, DEPOT.door);
  depot.group.position.set(DEPOT.x, 0, DEPOT.z);
  depot.group.rotation.y = Math.PI; // door (built on −Z) now faces +Z, toward centre
  group.add(depot.group);
  placeShopColliders(depot.colliders, DEPOT.x, DEPOT.z, true);
  // Exterior sign over the door. The shell is flipped, so the door is now on the
  // +Z face at world z = DEPOT.z + (D/2+wallT). The player approaches from LOWER
  // z (the centre) looking +Z; artPanel's textured front already points +Z, so
  // NO extra rotation is needed for it to read un-mirrored toward that viewer.
  const depotSign = artPanel(3.0, 0.95, "sign", {
    text: "GEAR DEPOT", bg: "#143d2e", fg: "#ffd166", emissiveIntensity: 0.5,
    file: "industrial-depot-sign.png",
  });
  depotSign.position.set(DEPOT.x, DEPOT.H + 0.6, DEPOT.z + (DEPOT.D / 2 + DEPOT.wallT) + 0.05);
  group.add(depotSign);

  // --- Enterable MESS HALL / CANTEEN "THE FEED BIN" (N of BOLT & BARREL) ----
  // Drops into the open SE-north pocket west of the storage tanks: interior
  // 4.6 × 4.6 m, door facing −Z down the open approach corridor (the strip west
  // of BOLT & BARREL). Outer footprint x∈[3.76,9.04], z∈[13.36,18.64] — inside
  // ±23, clear of BOLT & BARREL (z≤12.44), the tanks (x≥10.5), the water tower
  // and the lanes. The doorway gap gets NO collider; every other wall is an AABB.
  const MESS = { x: 6.4, z: 16.0, W: 4.6, D: 4.6, H: 3.0, wallT: 0.25, door: 2.0 };
  const mess = makeMessHall(MESS.W, MESS.D, MESS.H, MESS.wallT, MESS.door);
  mess.group.position.set(MESS.x, 0, MESS.z);
  group.add(mess.group);
  placeShopColliders(mess.colliders, MESS.x, MESS.z, false);
  // Exterior sign over the door (−Z wall), rotated to read from the corridor.
  const messSign = artPanel(3.0, 0.95, "sign", {
    text: "THE FEED BIN", bg: "#7a3b12", fg: "#ffd166", emissiveIntensity: 0.5,
    file: "industrial-mess-sign.png",
  });
  messSign.position.set(MESS.x, MESS.H + 0.6, MESS.z - (MESS.D / 2 + MESS.wallT) - 0.05);
  messSign.rotation.y = Math.PI;
  group.add(messSign);

  // --- Projecting door AWNINGS over every shop entrance --------------------
  // Each canopy is mounted high (y≈2.55, above the 2.4 m door clear) on the street
  // wall and cants out over the approach. They carry NO collider, so the player
  // walks straight under them into the doorway. The flipped DEPOT door faces +Z,
  // so its awning is turned 180° to project +Z to match.
  const shopAwnings = [
    { x: SHOP.x, z: SHOP.z - (SHOP.D / 2 + SHOP.wallT), w: SHOP.door + 0.9, flip: false },
    { x: FAB.x, z: FAB.z - (FAB.D / 2 + FAB.wallT), w: FAB.door + 0.9, flip: false },
    { x: MESS.x, z: MESS.z - (MESS.D / 2 + MESS.wallT), w: MESS.door + 0.9, flip: false },
    { x: DEPOT.x, z: DEPOT.z + (DEPOT.D / 2 + DEPOT.wallT), w: DEPOT.door + 0.9, flip: true },
  ];
  for (const a of shopAwnings) {
    const aw = makeAwning(a.w);
    aw.position.set(a.x, 2.55, a.z);
    if (a.flip) aw.rotation.y = Math.PI;
    group.add(aw);
  }

  // --- Overhead PIPE GANTRY bridging the works across the E–W lane ---------
  // The two legs stand JUST outside the lane (z = ±3.8) and get a TIGHT post
  // collider each; the crossbeam, twin pipe run and hanging "CLEARANCE" sign all
  // sit >4 m up with NO collider, so the car and the player pass straight under.
  // (Colliders are infinite-height in XZ — the beam/panel MUST stay collider-free
  // to stay walk-under.)
  const gantry = makeGantry(7.6);
  gantry.position.set(-11, 0, 0);
  gantry.rotation.y = Math.PI / 2; // legs straddle the E–W lane (world z = ±3.8)
  group.add(gantry);
  addCollider(colliders, -11, 3.8, 0.34, 0.34);
  addCollider(colliders, -11, -3.8, 0.34, 0.34);

  // --- A couple of yard BENCHES facing the open centre (decorative, no collider).
  for (const [bx, bz, br] of [[-6.5, 4.6, 0], [12.5, 4.6, 0]]) {
    const bench = makeBench();
    bench.position.set(bx, 0, bz);
    bench.rotation.y = br;
    group.add(bench);
  }

  // --- Extra street-level flavour: planters, pallets, lamp posts -----------
  // Planters soften the grey yard near the shop fronts (decorative, no collider).
  const planterSpots = [
    [-10.7, 5.0], [-19.3, 5.0],   // flanking the ARC & ANVIL front (clear of the shrunk shop)
    [5.6, 7.5], [16.4, 7.5],       // flanking the BOLT & BARREL door
  ];
  for (const [x, z] of planterSpots) {
    const pl = makePlanter();
    pl.position.set(x, 0, z);
    group.add(pl);
  }

  // Loading pallets dotted around the yard near the lane edges (solid, tight
  // colliders so they read as bump-into clutter).
  const palletSpots = [[-2.0, -6.5], [3.0, -7.5], [-3.5, 11.0]];
  for (const [x, z] of palletSpots) {
    const pa = makePallet();
    pa.position.set(x, 0, z);
    pa.rotation.y = (x + z) * 0.3; // varied facing from a deterministic value
    group.add(pa);
    addCollider(colliders, x, z, 1.3, 1.3);
  }

  // Yard lamp posts along the open driving cross for evening ambience (slim
  // poles, no colliders — they line the lanes without blocking the car).
  const lampSpots = [
    [-5.0, -5.0, 0], [5.0, 5.0, Math.PI],     // NW + SE inner corners of the cross
    [5.0, -5.0, Math.PI / 2], [-5.0, 5.0, -Math.PI / 2],
    [4.2, 9.0, Math.PI / 2], [16.0, 4.5, -Math.PI / 2], // canteen corridor + BOLT & BARREL front
  ];
  for (const [x, z, ry] of lampSpots) {
    const lp = makeLampPost();
    lp.position.set(x, 0, z);
    lp.rotation.y = ry; // turn the arm/head to overhang the lane
    group.add(lp);
  }

  // ═══ ADDED GRITTY RICHNESS ════════════════════════════════════════════════
  // Floodlight masts, hazard bollards, cable reels, a coolant/steam vent, a wall
  // exhaust fan, pipe-run valve wheels + an oil-drum staging bay. Every SOLID
  // mass stays OFF the open cross lanes (|x|,|z| > 3.4) and inside the ±23
  // seam-road margin; decorative/high items carry no collider.

  // Collectors for the animated additions (advanced allocation-free in update()).
  const steamSystems = []; // rising steam puff columns
  const fans = [];         // spinning exhaust-fan rotors
  const valveWheels = [];  // slowly-turning valve hand-wheels

  // Tall FLOODLIGHT MASTS ringing the open crossroads (slim poles, NO collider;
  // heads are EMISSIVE boxes, never real lights). Spots verified off both lanes
  // (|x|,|z| > 3.4) and clear of every footprint; the head-bars aim inward.
  const mastSpots = [
    [-6.5, -4.2, 0.7],  // NW of centre (east of WH1)
    [5.5, -4.2, -0.7],  // NE of centre
    [-9.5, 4.2, 2.4],   // SW of centre (west of the fab shop)
    [6.0, 4.2, -2.4],   // SE of centre (west of the tool shop)
  ];
  for (const [x, z, ry] of mastSpots) {
    const mast = makeFloodMast();
    mast.position.set(x, 0, z);
    mast.rotation.y = ry;
    group.add(mast);
  }

  // Hazard BOLLARDS at the four inner corners of the crossroads (off-lane, no
  // collider — slim safety posts; amber caps strobe via bollardCapMat).
  for (const [x, z] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]]) {
    const b = makeBollard();
    b.position.set(x, 0, z);
    group.add(b);
  }

  // SE STAGING BAY — the open pocket east of the tool shop and south of the
  // tanks (x∈[15,21.5], z∈[4,8.2]): two solid cable reels, a hazard-banded
  // oil-drum stack (decorative) and a coolant vent glow. All off-lane, inside
  // ±23, clear of the shop (x≤14.75) and the tanks (z≥8.5).
  for (const [x, z] of [[16, 5.0], [16, 7.2]]) {
    const reel = makeCableReel();
    reel.position.set(x, 0, z);
    reel.rotation.y = (x + z) * 0.2; // deterministic varied facing
    group.add(reel);
    addCollider(colliders, x, z, 2.0, 2.0);
  }
  // Oil-drum stack with hazard bands (only 6 → individual meshes reusing the
  // shared drum geometry/materials; decorative, no collider).
  const drumBay = [
    [19.0, 4.6, drumRed], [20.0, 4.6, drumBlue], [21.0, 4.6, drumRed],
    [19.5, 5.6, drumBlue], [20.5, 5.6, drumRed], [20.0, 6.6, drumBlue],
  ];
  for (const [x, z, mat] of drumBay) {
    const d = new THREE.Mesh(drumGeo, mat);
    d.position.set(x, 0.55, z);
    d.castShadow = true;
    group.add(d);
    const band = new THREE.Mesh(drumBandGeo, hazardMat);
    band.position.set(x, 0.62, z);
    group.add(band);
  }

  // Coolant/STEAM VENT in the open pocket west of the fab shop (south of WH2).
  // Flat grate → walk-over, no collider. (-20,6): WH2 is z≥10, FAB is x≥-18.25.
  const vent = makeSteamVent();
  vent.group.position.set(-20, 0, 6);
  group.add(vent.group);
  steamSystems.push(vent.system);

  // Wall EXHAUST FAN high on WH1's east gable (spins slowly; NO collider — high
  // on the wall, faces +X into the open yard).
  const fan = makeExhaustFan(fans);
  fan.position.set(WH1.x + WH1.w / 2 + 0.12, WH1.h * 0.62, WH1.z);
  group.add(fan);

  // Pipe-run VALVE WHEELS + stems on the elevated run (z=23), slowly turning.
  // Overhead/decorative — no collider (matches the existing pipe run + trestles).
  for (const [vx, vy] of [[-4, pipeY + 0.55], [4.5, pipeY]]) {
    const stem = new THREE.Mesh(valveStemGeo, pipeMat2);
    stem.rotation.x = Math.PI / 2; // stem points -Z, out of the pipe toward the viewer
    stem.position.set(vx, vy, 23 - 0.28);
    group.add(stem);
    const wheel = makeValveWheel();
    wheel.position.set(vx, vy, 23 - 0.46);
    group.add(wheel);
    valveWheels.push(wheel);
  }

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

    // Fab-shop weld arcs flicker (shared spark material strobes like a live weld).
    // Cheap + allocation-free: mutates one shared material's emissive intensity.
    sparkMat.emissiveIntensity = 1.0 + Math.abs(Math.sin(beaconT * 11)) * 1.1;

    // Roof ventilation turbines idly spin (varied speed for a lively look).
    for (let i = 0; i < spinners.length; i++) {
      spinners[i].rotation.y += dt * (1.4 + (i % 3) * 0.5);
    }

    // Coolant/steam vent: translucent puffs rise, expand and fade (reuses the
    // smoke recipe; each puff owns a cloned material so opacity is independent).
    for (const sys of steamSystems) {
      for (const p of sys.puffs) {
        p.life += dt * p.speed * 0.5;
        if (p.life >= 1) p.life -= 1;
        const t = p.life;
        const m = p.mesh;
        m.position.y = sys.tipY + t * 2.6;             // rise ~2.6 m (local)
        m.position.x = Math.sin(p.sway + t * 3) * (0.15 + t * 0.5);
        m.position.z = Math.cos(p.sway + t * 2) * (0.15 + t * 0.4);
        m.scale.setScalar(0.4 + t * 1.3);
        m.material.opacity = (1 - t) * 0.5;
      }
    }

    // Wall exhaust-fan rotors spin steadily about their own axle.
    for (let i = 0; i < fans.length; i++) fans[i].rotation.x += dt * 3.2;

    // Pipe valve hand-wheels turn slowly (staggered speeds).
    for (let i = 0; i < valveWheels.length; i++) {
      valveWheels[i].rotation.z += dt * (0.6 + (i % 2) * 0.4);
    }

    // Floodlight heads: a faint mains flicker (shared emissive material).
    floodHeadMat.emissiveIntensity = 1.05 + Math.sin(beaconT * 3.1) * 0.12;
    // Hazard bollard caps strobe like warning lamps (shared emissive material).
    bollardCapMat.emissiveIntensity = 0.5 + Math.abs(Math.sin(beaconT * 4.5)) * 0.7;
  }
  updaters.length = 0; // (kept for clarity; single inline update used)

  // The whole tile floor is walkable; buildings block via colliders above.
  const ground = [{ minX: -TILE, maxX: TILE, minZ: -TILE, maxZ: TILE }];

  return { group, colliders, ground, update };
}
