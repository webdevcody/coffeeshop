// City Park district — one 60×60 m tile of the expanded city, centred on the
// origin. A lush, living green: a vivid grass slab, bright flower beds, dense
// varied flat-shaded trees + bushes, a rippling central pond with lily pads and
// drifting ducks, winding light paths, a tiered fountain, picnic tables, a
// gazebo and benches. Everything is LOCAL geometry (X,Z ∈ [-30,30], ground at
// y = 0, up = +Y) so the city loader can drop it anywhere.
//
// buildPark() returns:
//   group     — THREE.Group of all meshes (local coords)
//   colliders — tight AABBs { minX,maxX,minZ,maxZ } for solid props only
//   ground    — [{ -30..30 }] the whole tile is walkable floor
//   update(dt)— cheap ambient animation (water ripple, fountain, ducks, sway)
//
// Cars: wide-open grass lanes run N–S along x≈±20 and E–W along z≈±20; the only
// obstacles a driver must avoid are the pond (centre), the gazebo (NW), the
// visitor pavilion (W edge, footprint pulled to x≈-25 so the lane stays clear),
// the fountain (SE corner of the central green) and the tree-line colliders.
// Keep to the perimeter and the cross-axes and there's clear >6 m driving room.

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

// --- Vivid grass texture (procedural canvas, drawn ONCE, reused) -----------
// A mottled green with faint lighter blades so the lawn reads as lush, not flat.
function grassTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, "#4f9a48");
  g.addColorStop(0.5, "#5bab50");
  g.addColorStop(1, "#46893f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  // soft mottled patches
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 4 + Math.random() * 18;
    ctx.globalAlpha = 0.06 + Math.random() * 0.12;
    ctx.fillStyle = Math.random() < 0.5 ? "#6fc15e" : "#3c7a36";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // fine blade flecks
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    ctx.strokeStyle = Math.random() < 0.5 ? "#76c764" : "#3a7233";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 2 - Math.random() * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.anisotropy = 4;
  return tex;
}

// --- Shared geometry + materials (created ONCE, reused across props) --------
const grassMat = new THREE.MeshStandardMaterial({
  color: "#7fce6e", map: grassTexture(), roughness: 1,
});
const grassSideMat = new THREE.MeshStandardMaterial({ color: "#3c6a36", roughness: 1 });
const pathMat = new THREE.MeshStandardMaterial({ color: "#d8cba2", roughness: 0.95 });
// Translucent pond water — rippled in update() via an injected vertex/uniform.
const waterMat = new THREE.MeshStandardMaterial({
  color: "#3aa0cf", roughness: 0.12, metalness: 0.5,
  emissive: "#114a66", emissiveIntensity: 0.25,
  transparent: true, opacity: 0.86,
});
const waterUniforms = { uTime: { value: 0 } };
waterMat.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = waterUniforms.uTime;
  shader.vertexShader =
    "uniform float uTime;\n" +
    shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n" +
      "transformed.z += sin(position.x * 0.9 + uTime * 1.6) * 0.10;\n" +
      "transformed.z += cos(position.y * 1.1 + uTime * 1.3) * 0.08;"
    );
};
const lilyMat = new THREE.MeshStandardMaterial({ color: "#2f8f4a", roughness: 0.8, flatShading: true });
const lilyFlowerMat = new THREE.MeshStandardMaterial({ color: "#f4c0d8", roughness: 0.7, emissive: "#7a2f4f", emissiveIntensity: 0.15, flatShading: true });
const trunkMat = new THREE.MeshStandardMaterial({ color: "#5a3d28", roughness: 0.9 });
const foliageA = new THREE.MeshStandardMaterial({ color: "#3f7d4d", roughness: 0.9, flatShading: true });
const foliageB = new THREE.MeshStandardMaterial({ color: "#56964f", roughness: 0.9, flatShading: true });
const foliageC = new THREE.MeshStandardMaterial({ color: "#6fae5a", roughness: 0.9, flatShading: true });
const foliageD = new THREE.MeshStandardMaterial({ color: "#86c25f", roughness: 0.9, flatShading: true });
const blossomMat = new THREE.MeshStandardMaterial({ color: "#f3b4cf", roughness: 0.85, flatShading: true });
const bushMat = new THREE.MeshStandardMaterial({ color: "#4f9a4a", roughness: 0.95, flatShading: true });
const benchWood = new THREE.MeshStandardMaterial({ color: "#6b4326", roughness: 0.7 });
const metalMat = new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.5, metalness: 0.7 });
const stoneMat = new THREE.MeshStandardMaterial({ color: "#c4bdae", roughness: 0.95, flatShading: true });
const woodMat = new THREE.MeshStandardMaterial({ color: "#7a5230", roughness: 0.85 });
const roofMat = new THREE.MeshStandardMaterial({ color: "#8c4a3a", roughness: 0.8 });
// Pavilion building materials (full-volume park lodge): plaster walls, timber
// trim, a darker base course and warm-lit windows so it reads solid all round.
const pavilionWall = new THREE.MeshStandardMaterial({ color: "#e7dcc4", roughness: 0.92 });
const pavilionBase = new THREE.MeshStandardMaterial({ color: "#7d6a4f", roughness: 0.95 });
const pavilionWindow = new THREE.MeshStandardMaterial({
  color: "#fff2cf", emissive: "#ffcf7a", emissiveIntensity: 0.55, roughness: 0.4,
});
const lampGlass = new THREE.MeshStandardMaterial({
  color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 0.9, roughness: 0.4,
});
const fountainWater = new THREE.MeshStandardMaterial({
  color: "#bfeaf7", roughness: 0.1, metalness: 0.4,
  emissive: "#3f9fc8", emissiveIntensity: 0.4, transparent: true, opacity: 0.8,
});
const fountainPool = new THREE.MeshStandardMaterial({
  color: "#4ab0d8", roughness: 0.12, metalness: 0.5,
  emissive: "#16566f", emissiveIntensity: 0.3, transparent: true, opacity: 0.88,
});
const rockMat = new THREE.MeshStandardMaterial({ color: "#8d8576", roughness: 1, flatShading: true });
// Duck parts.
const duckBodyMat = new THREE.MeshStandardMaterial({ color: "#f2efe6", roughness: 0.8, flatShading: true });
const duckHeadMat = new THREE.MeshStandardMaterial({ color: "#3e7a3a", roughness: 0.8, flatShading: true });
const duckBillMat = new THREE.MeshStandardMaterial({ color: "#e8a23a", roughness: 0.7, flatShading: true });
// Bright flower-bed dot palette (each colour gets its own InstancedMesh).
const flowerColors = ["#e35d7a", "#f0c64a", "#9a6fe0", "#ff7a4d", "#ffffff", "#5fd0e0"];
const flowerDotMats = flowerColors.map(
  (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, emissive: col, emissiveIntensity: 0.12, flatShading: true })
);

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.6, 8);
const blobGeo = new THREE.IcosahedronGeometry(1, 0); // unit foliage blob, scaled per use
const bushGeo = new THREE.IcosahedronGeometry(1, 0);
const lampHeadGeo = new THREE.SphereGeometry(0.26, 12, 10);
const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.0, 8);
const flowerDotGeo = new THREE.IcosahedronGeometry(0.16, 0);
const lilyGeo = new THREE.CircleGeometry(0.5, 7);
const lilyFlowerGeo = new THREE.IcosahedronGeometry(0.12, 0);

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// A flat-shaded low-poly tree: tapered trunk + 2–3 foliage blobs. Tight trunk
// collider only (handled by caller). `blossom` swaps the top blob for pink.
function makeTree(scale, foliage, blossom) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.scale.set(scale, scale, scale);
  trunk.position.y = 0.8 * scale;
  trunk.castShadow = true;
  g.add(trunk);
  const blobs = [
    [0, 2.2, 0, 0.95],
    [0.55, 1.85, 0.25, 0.7],
    [-0.45, 1.95, -0.2, 0.62],
    [0.1, 2.55, -0.1, 0.5],
  ];
  const n = 3 + (Math.random() < 0.6 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const [x, y, z, r] = blobs[i];
    const blob = new THREE.Mesh(blobGeo, blossom && i === n - 1 ? blossomMat : foliage);
    blob.position.set(x * scale, y * scale, z * scale);
    blob.scale.setScalar(r * scale);
    blob.castShadow = true;
    g.add(blob);
  }
  g.userData.sway = Math.random() * Math.PI * 2;
  return g;
}

function makeBench() {
  const g = new THREE.Group();
  const seat = box(1.7, 0.12, 0.5, benchWood);
  seat.position.y = 0.45;
  const back = box(1.7, 0.45, 0.1, benchWood);
  back.position.set(0, 0.7, -0.2);
  const legs = box(1.6, 0.45, 0.46, metalMat);
  legs.position.y = 0.22;
  g.add(seat, back, legs);
  return g;
}

// A wooden picnic table: top, two bench planks, and an X of legs.
function makePicnicTable() {
  const g = new THREE.Group();
  const top = box(2.0, 0.1, 1.0, woodMat);
  top.position.y = 0.75;
  const benchL = box(2.0, 0.08, 0.32, woodMat);
  benchL.position.set(0, 0.42, 0.62);
  const benchR = box(2.0, 0.08, 0.32, woodMat);
  benchR.position.set(0, 0.42, -0.62);
  const legA = box(0.12, 0.75, 1.7, woodMat);
  legA.position.set(0.8, 0.37, 0);
  const legB = box(0.12, 0.75, 1.7, woodMat);
  legB.position.set(-0.8, 0.37, 0);
  g.add(top, benchL, benchR, legA, legB);
  return g;
}

// A short path lamp post with a glowing globe.
function makeLamp() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(poleGeo, metalMat);
  pole.position.y = 2.0;
  pole.castShadow = true;
  const head = new THREE.Mesh(lampHeadGeo, lampGlass);
  head.position.y = 4.1;
  const base = box(0.3, 0.3, 0.3, metalMat);
  base.position.y = 0.15;
  g.add(pole, head, base);
  return g;
}

// A small low-poly duck (body + head + bill). Returns the group; caller drifts.
function makeDuck() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(blobGeo, duckBodyMat);
  body.scale.set(0.42, 0.3, 0.6);
  body.position.y = 0.0;
  body.castShadow = true;
  const tail = new THREE.Mesh(blobGeo, duckBodyMat);
  tail.scale.set(0.16, 0.16, 0.22);
  tail.position.set(0, 0.08, -0.46);
  const neck = new THREE.Mesh(poleGeo, duckHeadMat);
  neck.scale.set(0.4, 0.06, 0.4);
  neck.position.set(0, 0.22, 0.34);
  const head = new THREE.Mesh(blobGeo, duckHeadMat);
  head.scale.setScalar(0.22);
  head.position.set(0, 0.36, 0.42);
  const bill = box(0.12, 0.06, 0.18, duckBillMat);
  bill.position.set(0, 0.33, 0.6);
  g.add(body, tail, neck, head, bill);
  return g;
}

// A full-volume park visitor pavilion: a real little building with substantial
// WIDTH (X) × DEPTH (Z) × HEIGHT, not a flat card. Base course + plaster walls
// + overhanging hipped roof + a doorway and warm-lit windows wrapped on ALL
// four sides so it reads solid from front, sides AND back. The detailed FRONT
// (door + porch) faces +X by default; the caller rotates/positions it and the
// welcome sign is mounted flush on that front wall. Footprint = W × D; the
// caller adds a matching collider. Returns { group, W, D, wallH }.
function makePavilion(W = 7.2, D = 6.2, wallH = 3.6) {
  const g = new THREE.Group();

  // Dark stone base course (slightly larger footprint than the walls).
  const base = box(W + 0.5, 0.5, D + 0.5, pavilionBase);
  base.position.y = 0.25;
  base.receiveShadow = true;
  g.add(base);

  // Solid plaster wall block — the main mass with real width AND depth.
  const walls = box(W, wallH, D, pavilionWall);
  walls.position.y = 0.5 + wallH / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);

  // Recessed doorway on the FRONT (+X) face: a dark inset panel + timber frame.
  const door = box(0.12, 2.1, 1.5, pavilionBase);
  door.position.set(W / 2 + 0.02, 0.5 + 1.05, 0);
  g.add(door);
  const lintel = box(0.3, 0.25, 1.9, woodMat);
  lintel.position.set(W / 2, 0.5 + 2.2, 0);
  g.add(lintel);

  // Two porch posts + a small flat porch roof over the entrance (front detail).
  for (const pz of [-1.3, 1.3]) {
    const post = box(0.22, 2.6, 0.22, woodMat);
    post.position.set(W / 2 + 1.1, 0.5 + 1.3, pz);
    post.castShadow = true;
    g.add(post);
  }
  const porchRoof = box(1.6, 0.18, 3.4, roofMat);
  porchRoof.position.set(W / 2 + 0.7, 0.5 + 2.7, 0);
  porchRoof.castShadow = true;
  g.add(porchRoof);

  // Overhanging hipped roof: a wide low pyramid covering the whole footprint
  // with eaves past every wall, so the silhouette reads as a building from all
  // sides (front, back and both flanks).
  const roofGeo = new THREE.ConeGeometry(Math.max(W, D) * 0.82, 1.8, 4);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.rotation.y = Math.PI / 4; // align the 4-sided cone to the box footprint
  roof.scale.set(1, 1, D / W);    // stretch to cover the rectangular plan
  roof.position.y = 0.5 + wallH + 0.9;
  roof.castShadow = true;
  g.add(roof);

  // Warm-lit windows wrapped on ALL four faces (instanced). Front gets two
  // flanking the door; back gets three; each flank gets two — so the back is
  // never a blank wall.
  const winGeo = new THREE.BoxGeometry(0.14, 1.1, 0.9);
  const wy = 0.5 + 1.7;
  const specs = []; // [x, z, rotY]
  // Front (+X), beside the door.
  specs.push([W / 2 + 0.01, -2.0, 0], [W / 2 + 0.01, 2.0, 0]);
  // Back (-X).
  specs.push([-W / 2 - 0.01, -1.7, 0], [-W / 2 - 0.01, 0, 0], [-W / 2 - 0.01, 1.7, 0]);
  // Right flank (+Z).
  specs.push([-1.8, D / 2 + 0.01, Math.PI / 2], [1.8, D / 2 + 0.01, Math.PI / 2]);
  // Left flank (-Z).
  specs.push([-1.8, -D / 2 - 0.01, Math.PI / 2], [1.8, -D / 2 - 0.01, Math.PI / 2]);
  const wins = new THREE.InstancedMesh(winGeo, pavilionWindow, specs.length);
  const wm = new THREE.Matrix4();
  const wq = new THREE.Quaternion();
  const wp = new THREE.Vector3();
  const ws = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < specs.length; i++) {
    const [x, z, ry] = specs[i];
    wq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    wp.set(x, wy, z);
    wm.compose(wp, wq, ws);
    wins.setMatrixAt(i, wm);
  }
  wins.instanceMatrix.needsUpdate = true;
  g.add(wins);

  return { group: g, W, D, wallH };
}

export function buildPark() {
  const group = new THREE.Group();
  const colliders = [];

  // --- Grass slab (thin box, top at y = 0) ---------------------------------
  const slab = box(60, 0.8, 60, grassSideMat, false);
  slab.position.y = -0.4;
  group.add(slab);
  const grassTop = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), grassMat);
  grassTop.rotation.x = -Math.PI / 2;
  grassTop.position.y = 0.01;
  grassTop.receiveShadow = true;
  group.add(grassTop);

  // --- Winding light path: a few rotated plates forming an S through the tile.
  const pathSegs = [
    [-22, -20, 7, 0.5],
    [-12, -12, 7, -0.4],
    [0, -2, 7, 0.4],
    [-10, 12, 6, 1.1],
    [12, 20, 6, 0.9],
    [20, 6, 6, 0.2],
    [-20, 4, 6, -0.3],
  ];
  for (const [x, z, len, rot] of pathSegs) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, len), pathMat);
    seg.rotation.x = -Math.PI / 2;
    seg.rotation.z = rot;
    seg.position.set(x, 0.02, z);
    seg.receiveShadow = true;
    group.add(seg);
  }

  // --- Central pond: rippling translucent water + a stone rim. --------------
  const pondR = 7;
  // Higher-segment disc so the injected vertex ripple reads smoothly.
  const pond = new THREE.Mesh(new THREE.CircleGeometry(pondR, 64), waterMat);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(0, 0.05, 0);
  pond.receiveShadow = true;
  group.add(pond);
  // Sandy/silty pond bed just under the water so transparency reads with depth.
  const bed = new THREE.Mesh(new THREE.CircleGeometry(pondR - 0.1, 32), grassSideMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = -0.18;
  group.add(bed);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(pondR, 0.35, 8, 36), stoneMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.1;
  group.add(rim);
  // Pond AABB so the car can't drive into the water. Tight to the rim.
  addCollider(colliders, 0, 0, pondR * 2 + 0.4, pondR * 2 + 0.4);

  // Lily pads (instanced flat discs) + a few lily flowers on the pond surface.
  const lilySpots = [
    [-3.4, 2.6], [3.8, 1.4], [-1.2, -3.6], [4.6, -2.2],
    [-4.6, -1.0], [1.8, 4.4], [2.4, -4.6],
  ];
  const lilyPads = new THREE.InstancedMesh(lilyGeo, lilyMat, lilySpots.length);
  const lilyM = new THREE.Matrix4();
  const lilyQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const lilyPos = new THREE.Vector3();
  const lilyScl = new THREE.Vector3();
  for (let i = 0; i < lilySpots.length; i++) {
    const [x, z] = lilySpots[i];
    const s = 0.7 + Math.random() * 0.6;
    lilyPos.set(x, 0.075, z);
    lilyScl.set(s, s, s);
    lilyM.compose(lilyPos, lilyQ, lilyScl);
    lilyPads.setMatrixAt(i, lilyM);
  }
  lilyPads.instanceMatrix.needsUpdate = true;
  group.add(lilyPads);
  for (const [x, z] of [lilySpots[0], lilySpots[2], lilySpots[5]]) {
    const fl = new THREE.Mesh(lilyFlowerGeo, lilyFlowerMat);
    fl.position.set(x, 0.16, z);
    fl.scale.setScalar(1.3);
    group.add(fl);
  }

  // A few ducks paddling on the pond (animated drift).
  const ducks = [];
  const duckParams = [
    [3.2, 0.0, 0.32, 0.0],
    [-2.6, 1.6, -0.24, 2.1],
    [0.6, -3.6, 0.28, 4.0],
  ];
  for (let i = 0; i < duckParams.length; i++) {
    const d = makeDuck();
    d.position.set(duckParams[i][0], 0.14, duckParams[i][1]);
    d.scale.setScalar(0.85);
    group.add(d);
    ducks.push(d);
  }

  // A couple of rocks at the pond edge (decorative; no collider — small).
  for (const [x, z, s] of [[-5.5, 3.5, 0.7], [4.5, -4, 0.6], [5.8, 2.4, 0.5]]) {
    const rock = new THREE.Mesh(blobGeo, rockMat);
    rock.position.set(x, 0.25 * s, z);
    rock.scale.set(s, s * 0.6, s);
    rock.castShadow = true;
    group.add(rock);
  }

  // --- Trees: a ring + scattered clusters. Tight trunk colliders only. ------
  const treeSpots = [
    [-24, -24, 1.2, 0], [-25, 0, 1.0, 1], [-24, 24, 1.15, 0], [0, -25, 1.1, 2],
    [24, -24, 1.05, 0], [25, 2, 1.2, 1], [24, 24, 1.0, 0], [2, 25, 1.1, 2],
    [-17, 15, 1.05, 1], [18, -15, 0.95, 0], [-26, -12, 0.9, 3], [26, -10, 0.95, 3],
    [-12, 25, 0.85, 1], [13, 26, 1.0, 2], [-26, 13, 1.05, 0], [27, 16, 0.9, 3],
  ];
  const foliagePalette = [foliageA, foliageB, foliageC, foliageD];
  const trees = [];
  for (let i = 0; i < treeSpots.length; i++) {
    const [x, z, s, fi] = treeSpots[i];
    const blossom = i % 4 === 1; // a few cherry-blossom trees for colour
    const t = makeTree(s, foliagePalette[fi], blossom);
    t.position.set(x, 0, z);
    group.add(t);
    trees.push(t);
    // Tight trunk-only collider.
    addCollider(colliders, x, z, 0.5 * s, 0.5 * s);
  }

  // --- Bushes (instanced, decorative, no colliders): squashed foliage blobs --
  // (The first two sit on the lawn EAST of the pavilion's porch — kept clear of
  // the pavilion footprint X∈[-21.85,-14.15], Z∈[-10.35,-3.65] after its setback.)
  const bushSpots = [
    [-12, -9], [-12, -3], [16, -6], [20, -2], [-8, 18], [8, 18],
    [-22, 18], [22, 8], [-14, 22], [14, 22], [-4, -22], [6, -22],
    [22, -16], [-22, -16],
  ];
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushSpots.length);
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  const bM = new THREE.Matrix4();
  const bQ = new THREE.Quaternion();
  const bPos = new THREE.Vector3();
  const bScl = new THREE.Vector3();
  for (let i = 0; i < bushSpots.length; i++) {
    const [x, z] = bushSpots[i];
    const s = 0.8 + Math.random() * 0.7;
    bQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    bPos.set(x, 0.45 * s, z);
    bScl.set(s, s * 0.7, s);
    bM.compose(bPos, bQ, bScl);
    bushes.setMatrixAt(i, bM);
  }
  bushes.instanceMatrix.needsUpdate = true;
  group.add(bushes);

  // --- Flower beds: dense bright dots, one InstancedMesh per colour. --------
  // Each bed is a small cluster scattered around a centre. No colliders.
  const bedCenters = [
    [-11, -10], [9, -9], [-6, 9], [13, 4], [-15, 6], [10, 12],
    [-9, -18], [18, -10],
  ];
  const perColor = [];
  for (let k = 0; k < flowerDotMats.length; k++) perColor.push([]);
  for (let b = 0; b < bedCenters.length; b++) {
    const [cx, cz] = bedCenters[b];
    const count = 14 + ((b * 5) % 8);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * 2.2;
      const x = cx + Math.cos(ang) * rad;
      const z = cz + Math.sin(ang) * rad;
      const k = (b + i) % flowerDotMats.length;
      perColor[k].push([x, z]);
    }
  }
  const dotM = new THREE.Matrix4();
  const dotQ = new THREE.Quaternion();
  const dotPos = new THREE.Vector3();
  const dotScl = new THREE.Vector3();
  for (let k = 0; k < flowerDotMats.length; k++) {
    const pts = perColor[k];
    if (!pts.length) continue;
    const inst = new THREE.InstancedMesh(flowerDotGeo, flowerDotMats[k], pts.length);
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const s = 0.8 + Math.random() * 0.8;
      dotQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      dotPos.set(x, 0.16 + Math.random() * 0.12, z);
      dotScl.set(s, s, s);
      dotM.compose(dotPos, dotQ, dotScl);
      inst.setMatrixAt(i, dotM);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // --- Benches around the pond (face inward). Tight colliders. --------------
  const benchSpots = [
    [0, 9.5, Math.PI], [9.5, 0, -Math.PI / 2], [0, -9.5, 0], [-9.5, 0, Math.PI / 2],
  ];
  for (const [x, z, ry] of benchSpots) {
    const b = makeBench();
    b.position.set(x, 0, z);
    b.rotation.y = ry;
    group.add(b);
    const w = Math.abs(Math.cos(ry)) > 0.5 ? 1.7 : 0.6;
    const d = Math.abs(Math.cos(ry)) > 0.5 ? 0.6 : 1.7;
    addCollider(colliders, x, z, w, d);
  }

  // --- Picnic tables (a couple on the lawn). Tight colliders. ---------------
  const picnicSpots = [[-21, 11, 0.3], [21, -7, -0.5]];
  for (const [x, z, ry] of picnicSpots) {
    const p = makePicnicTable();
    p.position.set(x, 0, z);
    p.rotation.y = ry;
    group.add(p);
    addCollider(colliders, x, z, 2.4, 2.4);
  }

  // --- Path lamps (slim; tight colliders) -----------------------------------
  for (const [x, z] of [[-12, -12], [12, 12], [-12, 12], [12, -12]]) {
    const lamp = makeLamp();
    lamp.position.set(x, 0, z);
    group.add(lamp);
    addCollider(colliders, x, z, 0.4, 0.4);
  }

  // --- Gazebo (NW): hex platform, 6 posts, conical roof. Solid collider. ----
  const gazebo = new THREE.Group();
  const gx = -19, gz = -16;
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.3, 6), woodMat);
  floor.position.y = 0.15;
  floor.receiveShadow = true;
  gazebo.add(floor);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const post = box(0.18, 2.6, 0.18, woodMat);
    post.position.set(Math.cos(a) * 2.5, 1.45, Math.sin(a) * 2.5);
    gazebo.add(post);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.5, 1.8, 6), roofMat);
  roof.position.y = 3.7;
  roof.castShadow = true;
  gazebo.add(roof);
  gazebo.position.set(gx, 0, gz);
  group.add(gazebo);
  addCollider(colliders, gx, gz, 6, 6);

  // --- Park Visitor Pavilion (W side): a REAL full-volume building -----------
  // A substantial little lodge (≈7.2 m wide × 6.2 m deep × 3.6 m tall) with
  // plaster walls, a stone base, an overhanging hipped roof, a porch entrance
  // and warm-lit windows wrapped on every face — solid from front, back AND
  // sides, never a flat card. Its detailed FRONT (porch + door + sign) faces
  // +X, i.e. east toward the central green/plaza and the nearest avenue.
  //
  // SETBACK: the pavilion sits on the west of the green but is pulled ~7 m in
  // from the tile edge so its whole footprint — base (±3.85 X), overhanging
  // roof eaves (≈±4.2 X / ±3.6 Z) and the +X porch (reaches px+5.1) — clears the
  // seam road + sidewalk that runs along the tile edges. Centre at x=-18 keeps
  // the back roof at x≈-22.2 (> -23) and the porch front at x≈-12.9 (< 23), and
  // z=-7 keeps the roof within z∈[-10.6, -3.4], all inside the [-23,23] build box.
  const pavW = 7.2, pavD = 6.2, pavWallH = 3.6;
  const px = -18, pz = -7;
  const pav = makePavilion(pavW, pavD, pavWallH);
  pav.group.position.set(px, 0, pz);
  group.add(pav.group);
  // Solid footprint collider matching the pavilion's full plan (incl. base).
  addCollider(colliders, px, pz, pavW + 0.5, pavD + 0.5);

  // Welcome sign mounted FLUSH on the pavilion's front (+X) wall, just above the
  // porch roof, reading outward toward the green so the text is never mirrored.
  const sign = artPanel(2.4, 1.4, "billboard", {
    title: "CITY PARK", sub: "Est. 1908", accent: "#ffd86b",
    a: "#2c6e3f", b: "#123a22", glyph: "❀",
    emissiveIntensity: 0.55, file: "billboard-park.png",
  });
  sign.position.set(px + pavW / 2 + 0.08, 0.5 + pavWallH - 0.2, pz);
  sign.rotation.y = Math.PI / 2; // artPanel faces +Z at ry=0; turn it to face +X
  group.add(sign);

  // --- Fountain (SE): tiered stone basin with a translucent pool + spray. ---
  const fountain = new THREE.Group();
  const fx = 17, fz = 15;
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.6, 20), stoneMat);
  basin.position.y = 0.3;
  basin.receiveShadow = true;
  // Translucent water pool sitting in the basin.
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.12, 24), fountainPool);
  pool.position.y = 0.55;
  const tier = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.5, 16), stoneMat);
  tier.position.y = 0.85;
  const upperPool = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 18), fountainPool);
  upperPool.position.y = 1.1;
  const fWater = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 12), fountainWater);
  fWater.position.y = 2.0;
  fountain.add(basin, pool, tier, upperPool, fWater);
  // Spray droplets (instanced) animated outward+down in update().
  const sprayCount = 18;
  const sprayGeo = new THREE.SphereGeometry(0.07, 6, 6);
  const spray = new THREE.InstancedMesh(sprayGeo, fountainWater, sprayCount);
  const sprayPhase = new Float32Array(sprayCount);
  const sprayAng = new Float32Array(sprayCount);
  for (let i = 0; i < sprayCount; i++) {
    sprayPhase[i] = Math.random();
    sprayAng[i] = (i / sprayCount) * Math.PI * 2;
  }
  fountain.add(spray);
  fountain.position.set(fx, 0, fz);
  fountain.castShadow = true;
  group.add(fountain);
  addCollider(colliders, fx, fz, 5.2, 5.2);

  // Reusable scratch objects for the spray animation (NO per-frame alloc).
  const sprayM = new THREE.Matrix4();
  const sprayQ = new THREE.Quaternion();
  const sprayPos = new THREE.Vector3();
  const sprayScl = new THREE.Vector3(1, 1, 1);

  // --- Animation state ------------------------------------------------------
  let t = 0;
  function update(dt) {
    t += dt;
    // Pond surface ripple (uniform feed, cheap).
    waterUniforms.uTime.value = t;
    // Spinning fountain water + gentle bob.
    fWater.rotation.y += dt * 1.8;
    fWater.scale.y = 1 + Math.sin(t * 4) * 0.06;
    // Fountain spray: droplets rise then arc out and fall, looping.
    for (let i = 0; i < sprayCount; i++) {
      let p = sprayPhase[i] + t * 0.55;
      p = p - Math.floor(p); // 0..1 loop
      const a = sprayAng[i];
      const rise = Math.sin(p * Math.PI); // up then down
      const out = p * 1.4;
      sprayPos.set(
        Math.cos(a) * out,
        2.1 + rise * 1.1 - p * 1.6,
        Math.sin(a) * out
      );
      const s = 0.7 + rise * 0.6;
      sprayScl.set(s, s, s);
      sprayM.compose(sprayPos, sprayQ, sprayScl);
      spray.setMatrixAt(i, sprayM);
    }
    spray.instanceMatrix.needsUpdate = true;
    // Ducks paddle in slow arcs and wobble (kept clear of the rim, r<6).
    for (let i = 0; i < ducks.length; i++) {
      const d = ducks[i];
      const [bx, bz, spd, ph] = duckParams[i];
      d.position.x = bx + Math.cos(t * spd + ph) * 1.6;
      d.position.z = bz + Math.sin(t * spd + ph) * 1.6;
      d.position.y = 0.14 + Math.sin(t * 2 + ph) * 0.03;
      d.rotation.y = -(t * spd + ph) + (spd > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    // Pulsing lamp glow.
    lampGlass.emissiveIntensity = 0.75 + Math.sin(t * 2) * 0.2;
    // Sway the tree foliage groups subtly.
    for (let i = 0; i < trees.length; i++) {
      const tr = trees[i];
      tr.rotation.z = Math.sin(t * 0.9 + tr.userData.sway) * 0.015;
    }
  }

  // Whole tile is walkable floor; colliders block solids.
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  return { group, colliders, ground, update };
}
