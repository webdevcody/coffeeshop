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
// --- Snack/ice-cream kiosk (enterable shop) materials (created ONCE, reused) --
const kioskWallMat = new THREE.MeshStandardMaterial({ color: "#fbe4c4", roughness: 0.9 }); // warm cream plaster
const kioskTrimMat = new THREE.MeshStandardMaterial({ color: "#e2604a", roughness: 0.7 }); // candy-red trim
const kioskFloorMat = new THREE.MeshStandardMaterial({ color: "#caa46a", roughness: 0.85 }); // warm timber floor
const kioskRoofMat = new THREE.MeshStandardMaterial({ color: "#f1f1ec", roughness: 0.85 }); // pale flat roof/ceiling
const counterMat = new THREE.MeshStandardMaterial({ color: "#9c5b34", roughness: 0.6 }); // wood counter body
const counterTopMat = new THREE.MeshStandardMaterial({ color: "#3a4a52", roughness: 0.35, metalness: 0.4 }); // slate top
const shelfMat = new THREE.MeshStandardMaterial({ color: "#a9794a", roughness: 0.75 });
const caseGlassMat = new THREE.MeshStandardMaterial({
  color: "#cfeefb", roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.34,
});
const stoolSeatMat = new THREE.MeshStandardMaterial({ color: "#e0526a", roughness: 0.6 });
const rugMat = new THREE.MeshStandardMaterial({ color: "#c43d5a", roughness: 0.95 });
const rugTrimMat = new THREE.MeshStandardMaterial({ color: "#f4d27a", roughness: 0.95 });
const kioskBulbMat = new THREE.MeshStandardMaterial({
  color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 1.0, roughness: 0.4,
});
const kioskAwningMat = new THREE.MeshStandardMaterial({ color: "#e74c4c", roughness: 0.7, side: THREE.DoubleSide });
const kioskAwningStripeMat = new THREE.MeshStandardMaterial({ color: "#f6f1e7", roughness: 0.7, side: THREE.DoubleSide });
// Bright ice-cream/treat scoop colours for shelf goods + cone displays (each its own InstancedMesh).
const treatColors = ["#f6a8c0", "#9e6b3f", "#fff1a8", "#a3e0c0", "#caa6ff", "#ff9b6b"];
const treatMats = treatColors.map(
  (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, flatShading: true })
);
const coneMat = new THREE.MeshStandardMaterial({ color: "#d9a85c", roughness: 0.7, flatShading: true });
// Duck parts.
const duckBodyMat = new THREE.MeshStandardMaterial({ color: "#f2efe6", roughness: 0.8, flatShading: true });
const duckHeadMat = new THREE.MeshStandardMaterial({ color: "#3e7a3a", roughness: 0.8, flatShading: true });
const duckBillMat = new THREE.MeshStandardMaterial({ color: "#e8a23a", roughness: 0.7, flatShading: true });
// Bright flower-bed dot palette (each colour gets its own InstancedMesh).
const flowerColors = ["#e35d7a", "#f0c64a", "#9a6fe0", "#ff7a4d", "#ffffff", "#5fd0e0"];
const flowerDotMats = flowerColors.map(
  (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, emissive: col, emissiveIntensity: 0.12, flatShading: true })
);

// --- Garden centre / flower shop (enterable) materials (created ONCE) --------
const gardenWallMat = new THREE.MeshStandardMaterial({ color: "#e6efe0", roughness: 0.92 }); // pale greenhouse plaster
const gardenTrimMat = new THREE.MeshStandardMaterial({ color: "#3f7d4d", roughness: 0.7 });  // leaf-green trim
const gardenFloorMat = new THREE.MeshStandardMaterial({ color: "#b7a07a", roughness: 0.9 });  // terracotta-tan floor
const gardenRoofMat = new THREE.MeshStandardMaterial({ color: "#cfe6d8", roughness: 0.8 });   // pale glasshouse roof
const potMat = new THREE.MeshStandardMaterial({ color: "#b05a3a", roughness: 0.85, flatShading: true }); // terracotta pots
const soilMat = new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 1 });            // potting soil
const gardenAwningMat = new THREE.MeshStandardMaterial({ color: "#3f9d5a", roughness: 0.7, side: THREE.DoubleSide });
// --- Park tea house / café (enterable) materials (created ONCE) --------------
const teaWallMat = new THREE.MeshStandardMaterial({ color: "#f3e7d2", roughness: 0.9 });   // warm cream
const teaTrimMat = new THREE.MeshStandardMaterial({ color: "#7a4a86", roughness: 0.7 });    // soft plum trim
const teaFloorMat = new THREE.MeshStandardMaterial({ color: "#9a7048", roughness: 0.85 });  // honey timber
const teaRoofMat = new THREE.MeshStandardMaterial({ color: "#efe6da", roughness: 0.85 });   // pale ceiling
const teaTableTopMat = new THREE.MeshStandardMaterial({ color: "#d8c8a8", roughness: 0.6 }); // light café tabletop
const teacupMat = new THREE.MeshStandardMaterial({ color: "#fbf6ee", roughness: 0.5, flatShading: true }); // porcelain
const teaAwningMat = new THREE.MeshStandardMaterial({ color: "#8a5a96", roughness: 0.7, side: THREE.DoubleSide });
const teaAwningStripeMat = new THREE.MeshStandardMaterial({ color: "#f6f1e7", roughness: 0.7, side: THREE.DoubleSide });
// Shared crate/planter/stall flavour materials.
const crateMat = new THREE.MeshStandardMaterial({ color: "#9c6b3e", roughness: 0.85 });
const planterMat = new THREE.MeshStandardMaterial({ color: "#7c5a3a", roughness: 0.9 });
const stallCanvasA = new THREE.MeshStandardMaterial({ color: "#c4524a", roughness: 0.75, side: THREE.DoubleSide });
const stallCanvasB = new THREE.MeshStandardMaterial({ color: "#e9e2d2", roughness: 0.75, side: THREE.DoubleSide });
const produceMats = ["#e34d4d", "#f0a93a", "#7bbf4a", "#d8b13a"].map(
  (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, flatShading: true })
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

// An ENTERABLE park snack / ice-cream kiosk: a real little room the player can
// walk INTO. Four walls (back + two sides + two short front segments flanking a
// centred doorway gap), a timber FLOOR and a flat ROOF/ceiling, plus a cosy
// themed interior (service counter, shelves of treats, a glass display case,
// stools, wall signage, hanging bulbs and a rug). The street-facing wall is the
// front (−Z) and carries the doorway gap + an awning; the caller mounts the
// outdoor shop sign above it. Geometry is built around a LOCAL origin (0,0) at
// floor level so the caller positions it. Exterior W×D, walls thickness T,
// doorway width `door`. The caller pushes matching wall colliders (with NO
// collider across the doorway). Returns { group, lights } where `lights` are the
// bulb meshes for the gentle flicker in update().
function makeSnackShop(W = 8.0, D = 6.5, wallH = 3.0, T = 0.25, door = 2.2) {
  const g = new THREE.Group();
  const hw = W / 2, hd = D / 2;

  // Floor slab (warm timber), sitting just above the lawn so it reads as a step.
  const floor = box(W, 0.12, D, kioskFloorMat);
  floor.position.set(0, 0.06, 0);
  floor.receiveShadow = true;
  g.add(floor);

  // Flat roof / ceiling cap covering the whole footprint, with a small eave.
  const roof = box(W + 0.4, 0.2, D + 0.4, kioskRoofMat);
  roof.position.set(0, wallH + 0.1, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  g.add(roof);

  // --- Walls (each a solid box; caller adds matching AABB colliders) ---------
  const wallY = wallH / 2;
  // Back wall (+Z).
  const back = box(W, wallH, T, kioskWallMat);
  back.position.set(0, wallY, hd - T / 2);
  g.add(back);
  // Left wall (−X) and right wall (+X).
  const left = box(T, wallH, D, kioskWallMat);
  left.position.set(-hw + T / 2, wallY, 0);
  g.add(left);
  const right = box(T, wallH, D, kioskWallMat);
  right.position.set(hw - T / 2, wallY, 0);
  g.add(right);
  // Front (−Z) wall: two short segments flanking the centred doorway GAP.
  const segW = (W - door) / 2;
  const segCx = door / 2 + segW / 2;
  const frontL = box(segW, wallH, T, kioskWallMat);
  frontL.position.set(-segCx, wallY, -hd + T / 2);
  g.add(frontL);
  const frontR = box(segW, wallH, T, kioskWallMat);
  frontR.position.set(segCx, wallY, -hd + T / 2);
  g.add(frontR);
  // Door lintel spanning the gap (above head height — no collider needed).
  const lintel = box(door + 0.3, 0.4, T, kioskTrimMat);
  lintel.position.set(0, wallH - 0.2, -hd + T / 2);
  g.add(lintel);
  // A coloured trim band along the top of each wall for a tidy finish.
  for (const m of [back, frontL, frontR]) {
    const band = box(m.scale.x, 0.18, T + 0.02, kioskTrimMat);
    band.position.set(m.position.x, wallH - 0.09, m.position.z);
    g.add(band);
  }

  // --- Striped awning over the front doorway (outside, faces the street) -----
  const awY = wallH - 0.55, awZ = -hd - 0.55;
  const awning = box(door + 1.6, 0.08, 1.2, kioskAwningMat);
  awning.position.set(0, awY, awZ);
  awning.rotation.x = -0.35;
  awning.castShadow = true;
  g.add(awning);
  for (let i = -1; i <= 1; i++) {
    const stripe = box(0.5, 0.085, 1.2, kioskAwningStripeMat);
    stripe.position.set(i * 1.1, awY + 0.002, awZ);
    stripe.rotation.x = -0.35;
    g.add(stripe);
  }

  // --- Service COUNTER along the back-right, with a slate top --------------
  const counterBody = box(4.2, 1.0, 0.8, counterMat);
  counterBody.position.set(0.9, 0.56, hd - 1.1);
  counterBody.castShadow = true;
  g.add(counterBody);
  const counterTop = box(4.4, 0.1, 0.95, counterTopMat);
  counterTop.position.set(0.9, 1.11, hd - 1.05);
  g.add(counterTop);

  // --- Glass DISPLAY CASE on the counter (chilled treats behind glass) ------
  const caseBody = box(2.4, 0.55, 0.7, caseGlassMat);
  caseBody.position.set(0.4, 1.43, hd - 1.05);
  g.add(caseBody);
  // Little scoop blobs inside the case (instanced per colour).
  const caseRow = [-0.9, -0.45, 0, 0.45, 0.9];
  const caseScoopGeo = new THREE.IcosahedronGeometry(0.13, 0);
  const cm = new THREE.Matrix4(), cq = new THREE.Quaternion(), cp = new THREE.Vector3(), cs = new THREE.Vector3(1, 1, 1);
  // Assign one scoop per slot, colour cycling — one instanced mesh per colour.
  const slotByColor = [];
  for (let k = 0; k < treatMats.length; k++) slotByColor.push([]);
  for (let i = 0; i < caseRow.length; i++) slotByColor[i % treatMats.length].push(caseRow[i]);
  for (let k = 0; k < treatMats.length; k++) {
    const xs = slotByColor[k];
    if (!xs.length) continue;
    const inst = new THREE.InstancedMesh(caseScoopGeo, treatMats[k], xs.length);
    for (let i = 0; i < xs.length; i++) {
      cp.set(0.4 + xs[i], 1.4, hd - 1.05);
      cm.compose(cp, cq, cs);
      inst.setMatrixAt(i, cm);
    }
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  }

  // --- SHELVES on the left wall with little product jars/cartons ------------
  for (const sy of [1.0, 1.7, 2.4]) {
    const shelf = box(0.5, 0.06, 3.6, shelfMat);
    shelf.position.set(-hw + 0.4, sy, 0.2);
    g.add(shelf);
  }
  // Jars/cartons on the shelves (instanced per colour, upright little boxes).
  const jarGeo = new THREE.BoxGeometry(0.22, 0.34, 0.22);
  const jm = new THREE.Matrix4(), jq = new THREE.Quaternion(), jp = new THREE.Vector3(), js = new THREE.Vector3(1, 1, 1);
  const shelfYs = [1.0, 1.7, 2.4];
  const jarZs = [-1.3, -0.7, -0.1, 0.5, 1.1, 1.6];
  const jarsByColor = [];
  for (let k = 0; k < treatMats.length; k++) jarsByColor.push([]);
  let ji = 0;
  for (const sy of shelfYs) {
    for (const z of jarZs) {
      jarsByColor[ji % treatMats.length].push([-hw + 0.4, sy + 0.2, z]);
      ji++;
    }
  }
  for (let k = 0; k < treatMats.length; k++) {
    const pts = jarsByColor[k];
    if (!pts.length) continue;
    const inst = new THREE.InstancedMesh(jarGeo, treatMats[k], pts.length);
    for (let i = 0; i < pts.length; i++) {
      jp.set(pts[i][0], pts[i][1], pts[i][2]);
      jm.compose(jp, jq, js);
      inst.setMatrixAt(i, jm);
    }
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  }

  // --- Cone RACK by the door: a small stand holding ice-cream cones ----------
  const rackPost = box(0.12, 1.0, 0.12, shelfMat);
  rackPost.position.set(hw - 0.8, 0.56, -hd + 1.2);
  g.add(rackPost);
  const rackTop = box(0.7, 0.08, 0.7, shelfMat);
  rackTop.position.set(hw - 0.8, 1.05, -hd + 1.2);
  g.add(rackTop);
  const coneGeo = new THREE.ConeGeometry(0.1, 0.34, 8);
  const scoopGeo = new THREE.IcosahedronGeometry(0.12, 0);
  const conePos = [[-0.18, -0.18], [0.18, -0.18], [0, 0.18]];
  for (let i = 0; i < conePos.length; i++) {
    const [dx, dz] = conePos[i];
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.rotation.x = Math.PI; // tip up
    cone.position.set(hw - 0.8 + dx, 1.26, -hd + 1.2 + dz);
    g.add(cone);
    const scoop = new THREE.Mesh(scoopGeo, treatMats[i % treatMats.length]);
    scoop.position.set(hw - 0.8 + dx, 1.45, -hd + 1.2 + dz);
    g.add(scoop);
  }

  // --- A couple of STOOLS at the counter (seat + leg) -----------------------
  for (const sx of [-2.0, -1.0]) {
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12), stoolSeatMat);
    seat.position.set(sx, 0.62, hd - 2.0);
    seat.castShadow = true;
    g.add(seat);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 8), metalMat);
    leg.position.set(sx, 0.3, hd - 2.0);
    g.add(leg);
  }

  // --- RUG on the floor in the middle of the room ---------------------------
  const rug = box(3.4, 0.03, 2.4, rugMat);
  rug.position.set(-0.5, 0.13, -0.6);
  rug.receiveShadow = true;
  g.add(rug);
  const rugTrim = box(3.0, 0.032, 2.0, rugTrimMat);
  rugTrim.position.set(-0.5, 0.135, -0.6);
  g.add(rugTrim);

  // --- Wall SIGNAGE inside (a little menu board on the back wall) -----------
  const menu = artPanel(2.0, 1.0, "sign", {
    text: "ICE CREAM", bg: "#2d6a4f", fg: "#fff3b0",
    file: "sign-park-kiosk-menu.png", emissiveIntensity: 0.4,
  });
  menu.position.set(-1.6, 2.05, hd - T - 0.02);
  menu.rotation.y = Math.PI; // face into the room (−Z)
  g.add(menu);

  // --- Hanging interior LIGHTS (two pendant bulbs) --------------------------
  const lights = [];
  for (const lx of [-1.8, 1.8]) {
    const cord = box(0.03, 0.5, 0.03, metalMat);
    cord.position.set(lx, wallH - 0.25, -0.3);
    g.add(cord);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), kioskBulbMat);
    bulb.position.set(lx, wallH - 0.55, -0.3);
    g.add(bulb);
    lights.push(bulb);
  }

  return { group: g, lights };
}

// An ENTERABLE garden centre / flower shop: a bright little glasshouse the player
// can walk INTO. Same construction grammar as the snack shop — back + two side
// walls + two short front segments flanking a centred doorway GAP, a tiled FLOOR
// and a flat ROOF/ceiling. Themed interior: a long potting BENCH with terracotta
// pots of flowers, tiered plant SHELVES on the back wall, a seed-rack, a watering
// can and a green pendant lamp. Front faces −Z (the lane); the caller mounts the
// outdoor sign + awning above the door and pushes matching wall colliders (NO
// collider across the doorway). Returns { group, lights }.
function makeGardenShop(W = 6.6, D = 6.0, wallH = 3.0, T = 0.25, door = 2.0) {
  const g = new THREE.Group();
  const hw = W / 2, hd = D / 2;

  const floor = box(W, 0.12, D, gardenFloorMat);
  floor.position.set(0, 0.06, 0);
  floor.receiveShadow = true;
  g.add(floor);

  const roof = box(W + 0.4, 0.2, D + 0.4, gardenRoofMat);
  roof.position.set(0, wallH + 0.1, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  g.add(roof);

  // Walls (caller adds matching AABB colliders).
  const wallY = wallH / 2;
  const back = box(W, wallH, T, gardenWallMat);
  back.position.set(0, wallY, hd - T / 2);
  g.add(back);
  const left = box(T, wallH, D, gardenWallMat);
  left.position.set(-hw + T / 2, wallY, 0);
  g.add(left);
  const right = box(T, wallH, D, gardenWallMat);
  right.position.set(hw - T / 2, wallY, 0);
  g.add(right);
  const segW = (W - door) / 2;
  const segCx = door / 2 + segW / 2;
  const frontL = box(segW, wallH, T, gardenWallMat);
  frontL.position.set(-segCx, wallY, -hd + T / 2);
  g.add(frontL);
  const frontR = box(segW, wallH, T, gardenWallMat);
  frontR.position.set(segCx, wallY, -hd + T / 2);
  g.add(frontR);
  const lintel = box(door + 0.3, 0.4, T, gardenTrimMat);
  lintel.position.set(0, wallH - 0.2, -hd + T / 2);
  g.add(lintel);
  for (const m of [back, frontL, frontR]) {
    const band = box(m.scale.x, 0.18, T + 0.02, gardenTrimMat);
    band.position.set(m.position.x, wallH - 0.09, m.position.z);
    g.add(band);
  }

  // Striped (solid green) awning over the doorway outside (−Z).
  const awY = wallH - 0.55, awZ = -hd - 0.5;
  const awning = box(door + 1.4, 0.08, 1.1, gardenAwningMat);
  awning.position.set(0, awY, awZ);
  awning.rotation.x = -0.35;
  awning.castShadow = true;
  g.add(awning);

  // Potting BENCH along the back, with terracotta pots + bright blooms on top.
  const bench = box(4.0, 0.9, 0.8, counterMat);
  bench.position.set(-0.2, 0.5, hd - 1.1);
  bench.castShadow = true;
  g.add(bench);
  const benchTop = box(4.2, 0.1, 0.9, shelfMat);
  benchTop.position.set(-0.2, 1.0, hd - 1.1);
  g.add(benchTop);
  const potGeo = new THREE.CylinderGeometry(0.2, 0.15, 0.32, 10);
  const bloomGeo = new THREE.IcosahedronGeometry(0.18, 0);
  const potXs = [-1.8, -1.1, -0.4, 0.3, 1.0, 1.7];
  for (let i = 0; i < potXs.length; i++) {
    const px = potXs[i] - 0.2;
    const pot = new THREE.Mesh(potGeo, potMat);
    pot.position.set(px, 1.22, hd - 1.1);
    pot.castShadow = true;
    g.add(pot);
    const bloom = new THREE.Mesh(bloomGeo, flowerDotMats[i % flowerDotMats.length]);
    bloom.position.set(px, 1.5, hd - 1.1);
    g.add(bloom);
  }

  // Tiered plant SHELVES on the left wall, rows of small potted greens.
  const potS = new THREE.CylinderGeometry(0.13, 0.1, 0.22, 8);
  const greenS = new THREE.IcosahedronGeometry(0.14, 0);
  for (const sy of [1.0, 1.8]) {
    const shelf = box(0.45, 0.06, 3.4, shelfMat);
    shelf.position.set(-hw + 0.4, sy, 0.1);
    g.add(shelf);
    for (const z of [-1.2, -0.5, 0.2, 0.9, 1.5]) {
      const pot = new THREE.Mesh(potS, potMat);
      pot.position.set(-hw + 0.4, sy + 0.14, z);
      g.add(pot);
      const grn = new THREE.Mesh(greenS, bushMat);
      grn.position.set(-hw + 0.4, sy + 0.34, z);
      g.add(grn);
    }
  }

  // A seed/flower display rack by the door + a watering can prop.
  const sackZ = -hd + 1.2;
  for (let i = 0; i < 3; i++) {
    const sack = box(0.5, 0.5, 0.5, soilMat);
    sack.position.set(hw - 0.7 - i * 0.0, 0.31, sackZ - i * 0.6);
    sack.castShadow = true;
    g.add(sack);
  }
  const canBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.3, 10), metalMat);
  canBody.position.set(hw - 0.7, 1.15, -hd + 1.2);
  g.add(canBody);

  // Floor pots of tall blooms flanking the entrance inside.
  for (const sx of [-hw + 0.9, hw - 0.9]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 10), potMat);
    pot.position.set(sx, 0.31, -hd + 0.9);
    pot.castShadow = true;
    g.add(pot);
    const stem = box(0.06, 0.7, 0.06, gardenTrimMat);
    stem.position.set(sx, 0.85, -hd + 0.9);
    g.add(stem);
    const head = new THREE.Mesh(bloomGeo, flowerDotMats[1]);
    head.position.set(sx, 1.25, -hd + 0.9);
    head.scale.setScalar(1.4);
    g.add(head);
  }

  // Back-wall sign + a green pendant bulb.
  const board = artPanel(2.0, 0.9, "sign", {
    text: "BLOOMS", bg: "#2d6a4f", fg: "#eaf7d8", accent: "#f0c64a",
    file: "sign-park-garden-menu.png", emissiveIntensity: 0.4,
  });
  board.position.set(1.4, 2.1, hd - T - 0.02);
  board.rotation.y = Math.PI;
  g.add(board);

  const lights = [];
  const cord = box(0.03, 0.5, 0.03, metalMat);
  cord.position.set(0, wallH - 0.25, -0.4);
  g.add(cord);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), kioskBulbMat);
  bulb.position.set(0, wallH - 0.55, -0.4);
  g.add(bulb);
  lights.push(bulb);

  return { group: g, lights };
}

// An ENTERABLE park tea house / café: a snug room the player can walk INTO. Same
// wall grammar (back + sides + two front segments flanking a centred doorway
// GAP), timber FLOOR + flat ROOF. Interior: a service counter with a pastry case,
// two small round café TABLES each with porcelain cups, a wall menu, a striped
// awning outside and warm pendant bulbs. Front faces −Z; the caller mounts the
// sign and pushes matching wall colliders (NO collider across the doorway).
// Returns { group, lights }.
function makeTeaHouse(W = 7.0, D = 5.6, wallH = 3.0, T = 0.25, door = 2.2) {
  const g = new THREE.Group();
  const hw = W / 2, hd = D / 2;

  const floor = box(W, 0.12, D, teaFloorMat);
  floor.position.set(0, 0.06, 0);
  floor.receiveShadow = true;
  g.add(floor);

  const roof = box(W + 0.4, 0.2, D + 0.4, teaRoofMat);
  roof.position.set(0, wallH + 0.1, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  g.add(roof);

  const wallY = wallH / 2;
  const back = box(W, wallH, T, teaWallMat);
  back.position.set(0, wallY, hd - T / 2);
  g.add(back);
  const left = box(T, wallH, D, teaWallMat);
  left.position.set(-hw + T / 2, wallY, 0);
  g.add(left);
  const right = box(T, wallH, D, teaWallMat);
  right.position.set(hw - T / 2, wallY, 0);
  g.add(right);
  const segW = (W - door) / 2;
  const segCx = door / 2 + segW / 2;
  const frontL = box(segW, wallH, T, teaWallMat);
  frontL.position.set(-segCx, wallY, -hd + T / 2);
  g.add(frontL);
  const frontR = box(segW, wallH, T, teaWallMat);
  frontR.position.set(segCx, wallY, -hd + T / 2);
  g.add(frontR);
  const lintel = box(door + 0.3, 0.4, T, teaTrimMat);
  lintel.position.set(0, wallH - 0.2, -hd + T / 2);
  g.add(lintel);
  for (const m of [back, frontL, frontR]) {
    const band = box(m.scale.x, 0.18, T + 0.02, teaTrimMat);
    band.position.set(m.position.x, wallH - 0.09, m.position.z);
    g.add(band);
  }

  // Striped awning over the doorway outside (−Z).
  const awY = wallH - 0.55, awZ = -hd - 0.5;
  const awning = box(door + 1.6, 0.08, 1.15, teaAwningMat);
  awning.position.set(0, awY, awZ);
  awning.rotation.x = -0.35;
  awning.castShadow = true;
  g.add(awning);
  for (let i = -1; i <= 1; i++) {
    const stripe = box(0.55, 0.085, 1.15, teaAwningStripeMat);
    stripe.position.set(i * 1.2, awY + 0.002, awZ);
    stripe.rotation.x = -0.35;
    g.add(stripe);
  }

  // Service COUNTER along the back with a slate top + a small pastry case.
  const counterBody = box(3.8, 1.0, 0.8, counterMat);
  counterBody.position.set(0.6, 0.56, hd - 1.0);
  counterBody.castShadow = true;
  g.add(counterBody);
  const counterTop = box(4.0, 0.1, 0.95, counterTopMat);
  counterTop.position.set(0.6, 1.11, hd - 0.95);
  g.add(counterTop);
  const pastryCase = box(1.6, 0.5, 0.6, caseGlassMat);
  pastryCase.position.set(-0.2, 1.42, hd - 0.95);
  g.add(pastryCase);
  for (let i = 0; i < 3; i++) {
    const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 10), treatMats[i % treatMats.length]);
    cake.position.set(-0.6 + i * 0.4, 1.36, hd - 0.95);
    g.add(cake);
  }
  // An urn / tea boiler on the counter.
  const urn = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.5, 12), metalMat);
  urn.position.set(2.0, 1.4, hd - 0.95);
  g.add(urn);

  // Two round café TABLES with porcelain cups + a couple of stools each.
  const tableTopGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16);
  const tableLegGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.7, 8);
  const cupGeo = new THREE.CylinderGeometry(0.07, 0.05, 0.1, 10);
  const lights = [];
  for (const [tx, tz] of [[-1.9, -0.6], [1.9, -1.0]]) {
    const top = new THREE.Mesh(tableTopGeo, teaTableTopMat);
    top.position.set(tx, 0.78, tz);
    top.castShadow = true;
    g.add(top);
    const leg = new THREE.Mesh(tableLegGeo, metalMat);
    leg.position.set(tx, 0.4, tz);
    g.add(leg);
    for (const [dx, dz] of [[-0.28, 0.1], [0.28, -0.1]]) {
      const cup = new THREE.Mesh(cupGeo, teacupMat);
      cup.position.set(tx + dx, 0.87, tz + dz);
      g.add(cup);
    }
    for (const [sx, sz] of [[tx - 0.85, tz], [tx + 0.85, tz]]) {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.09, 12), stoolSeatMat);
      seat.position.set(sx, 0.5, sz);
      g.add(seat);
      const sleg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.5, 8), metalMat);
      sleg.position.set(sx, 0.25, sz);
      g.add(sleg);
    }
  }

  // Wall menu board on the back wall.
  const menu = artPanel(2.0, 1.0, "sign", {
    text: "TEA & CAKE", bg: "#5a2e63", fg: "#f7e9c8", accent: "#f0c64a",
    file: "sign-park-tea-menu.png", emissiveIntensity: 0.4,
  });
  menu.position.set(-1.8, 2.05, hd - T - 0.02);
  menu.rotation.y = Math.PI;
  g.add(menu);

  // Two warm pendant bulbs.
  for (const lx of [-1.6, 1.6]) {
    const cord = box(0.03, 0.5, 0.03, metalMat);
    cord.position.set(lx, wallH - 0.25, -0.4);
    g.add(cord);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), kioskBulbMat);
    bulb.position.set(lx, wallH - 0.55, -0.4);
    g.add(bulb);
    lights.push(bulb);
  }

  return { group: g, lights };
}

// A small open-air market STALL (street flavour, decorative): four posts, a
// striped canvas roof, a plank counter and a few produce crates with instanced
// produce blobs. No interior; the caller adds ONE tight collider for the body.
function makeStall() {
  const g = new THREE.Group();
  // Posts.
  for (const [x, z] of [[-1.2, -0.7], [1.2, -0.7], [-1.2, 0.7], [1.2, 0.7]]) {
    const post = box(0.1, 1.9, 0.1, woodMat);
    post.position.set(x, 0.95, z);
    g.add(post);
  }
  // Plank counter.
  const counter = box(2.6, 0.6, 1.4, woodMat);
  counter.position.set(0, 0.7, 0);
  counter.castShadow = true;
  g.add(counter);
  // Sloped striped canvas roof (two halves).
  const roofA = box(2.8, 0.06, 0.9, stallCanvasA);
  roofA.position.set(0, 2.0, -0.45);
  roofA.rotation.x = 0.32;
  roofA.castShadow = true;
  g.add(roofA);
  const roofB = box(2.8, 0.06, 0.9, stallCanvasB);
  roofB.position.set(0, 2.0, 0.45);
  roofB.rotation.x = -0.32;
  roofB.castShadow = true;
  g.add(roofB);
  // Produce crates on the counter + instanced produce blobs.
  const blobG = new THREE.IcosahedronGeometry(0.11, 0);
  for (let c = 0; c < 3; c++) {
    const crate = box(0.7, 0.3, 0.55, crateMat);
    crate.position.set(-0.9 + c * 0.9, 1.15, 0);
    g.add(crate);
    const mat = produceMats[c % produceMats.length];
    const inst = new THREE.InstancedMesh(blobG, mat, 5);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 0; j++) {
      if (n >= 5) break;
      p.set(-0.9 + c * 0.9 + i * 0.16, 1.34, j * 0.16 + 0.08);
      m.compose(p, q, s);
      inst.setMatrixAt(n++, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  }
  return g;
}

// A simple terracotta PLANTER box with a couple of bushy greens (decorative).
function makePlanter() {
  const g = new THREE.Group();
  const boxBody = box(1.4, 0.5, 0.55, planterMat);
  boxBody.position.y = 0.25;
  boxBody.castShadow = true;
  g.add(boxBody);
  const soil = box(1.3, 0.08, 0.45, soilMat);
  soil.position.y = 0.5;
  g.add(soil);
  for (const sx of [-0.4, 0.1, 0.5]) {
    const grn = new THREE.Mesh(bushGeo, bushMat);
    grn.position.set(sx, 0.7, 0);
    grn.scale.set(0.34, 0.42, 0.34);
    grn.castShadow = true;
    g.add(grn);
  }
  return g;
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
    [-22, 18], [-14, 22], [14, 22], [-4, -22], [6, -22],
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

  // --- Park snack / ice-cream KIOSK (SE-south): an ENTERABLE shop ------------
  // A small room the player can walk INTO, tucked into the open south-east
  // quadrant along the inner edge by the south E–W lane. Its FRONT (−Z, with the
  // doorway gap + awning + street sign) faces the lane. Footprint W×D = 8.0×6.5,
  // centred at (kx, kz); whole thing (walls + sign) stays in X,Z ∈ [-23,23] and
  // clears the pond, gazebo, pavilion, fountain, trees, beds and lanes.
  const kx = 13.5, kz = -18;
  const kW = 8.0, kD = 6.5, kWallH = 3.0, kT = 0.25, kDoor = 2.2;
  const kiosk = makeSnackShop(kW, kD, kWallH, kT, kDoor);
  kiosk.group.position.set(kx, 0, kz);
  group.add(kiosk.group);

  // Individual AABB colliders for the kiosk's WALLS so the interior is walkable
  // and the player enters through the doorway. There is deliberately NO collider
  // across the doorway GAP in the front (−Z) wall.
  const kHW = kW / 2, kHD = kD / 2;
  const kSegW = (kW - kDoor) / 2;
  const kSegCx = kDoor / 2 + kSegW / 2;
  addCollider(colliders, kx, kz + kHD - kT / 2, kW, kT);            // back wall (+Z)
  addCollider(colliders, kx - kHW + kT / 2, kz, kT, kD);            // left wall (−X)
  addCollider(colliders, kx + kHW - kT / 2, kz, kT, kD);            // right wall (+X)
  addCollider(colliders, kx - kSegCx, kz - kHD + kT / 2, kSegW, kT); // front-left segment
  addCollider(colliders, kx + kSegCx, kz - kHD + kT / 2, kSegW, kT); // front-right segment
  // (No collider at X∈[kx−1.1, kx+1.1] on the front line — the doorway is open.)

  // Outdoor shop SIGN above the door on the OUTSIDE front (−Z) wall, facing the
  // street (−Z). artPanel faces +Z at ry=0, so ry=π turns it to face −Z without
  // mirroring the text (a rotation, not a reflection — reads un-mirrored).
  const kioskSign = artPanel(3.0, 1.0, "sign", {
    text: "SCOOPS", bg: "#e2604a", fg: "#fff3cf",
    accent: "#ffd86b", emissiveIntensity: 0.55, file: "sign-park-kiosk.png",
  });
  kioskSign.position.set(kx, kWallH + 0.55, kz - kHD - 0.06);
  kioskSign.rotation.y = Math.PI; // face −Z (the street/lane)
  group.add(kioskSign);

  // --- Garden centre / flower shop (E side): an ENTERABLE shop ---------------
  // Footprint W×D = 6.6×6.0 centred at (gcx, gcz). Its FRONT (−Z, doorway +
  // awning + sign) faces the central green. Whole thing stays inside [-23,23]:
  // X∈[15.7,22.3], Z∈[2,8], clear of the pond, fountain, picnic table (21,-7),
  // beds and the perimeter trees. Reuses the shared kiosk bulb material so its
  // pendant flickers with the others in update().
  const gcx = 19, gcz = 5;
  const gcW = 6.6, gcD = 6.0, gcWallH = 3.0, gcT = 0.25, gcDoor = 2.0;
  const garden = makeGardenShop(gcW, gcD, gcWallH, gcT, gcDoor);
  garden.group.position.set(gcx, 0, gcz);
  group.add(garden.group);
  const gcHW = gcW / 2, gcHD = gcD / 2;
  const gcSegW = (gcW - gcDoor) / 2;
  const gcSegCx = gcDoor / 2 + gcSegW / 2;
  addCollider(colliders, gcx, gcz + gcHD - gcT / 2, gcW, gcT);            // back (+Z)
  addCollider(colliders, gcx - gcHW + gcT / 2, gcz, gcT, gcD);            // left (−X)
  addCollider(colliders, gcx + gcHW - gcT / 2, gcz, gcT, gcD);            // right (+X)
  addCollider(colliders, gcx - gcSegCx, gcz - gcHD + gcT / 2, gcSegW, gcT); // front-left
  addCollider(colliders, gcx + gcSegCx, gcz - gcHD + gcT / 2, gcSegW, gcT); // front-right
  // (Doorway GAP at X∈[gcx−1, gcx+1] on the −Z line — no collider, walkable.)
  const gardenSign = artPanel(2.8, 1.0, "sign", {
    text: "GREENHOUSE", bg: "#3f9d5a", fg: "#f4ffe6",
    accent: "#f0c64a", emissiveIntensity: 0.55, file: "sign-park-garden.png",
  });
  gardenSign.position.set(gcx, gcWallH + 0.55, gcz - gcHD - 0.06);
  gardenSign.rotation.y = Math.PI; // face −Z (the green)
  group.add(gardenSign);

  // --- Park tea house / café (N side): an ENTERABLE shop --------------------
  // Footprint W×D = 7.0×5.6 centred at (tcx, tcz). FRONT (−Z) faces the green.
  // X∈[-3.5,3.5], Z∈[16.2,21.8] — inside [-23,23], clear of the north bushes
  // (±8,18), trees and beds, and the N–S/E–W lanes. Reuses the shared bulb mat.
  const tcx = 0, tcz = 19;
  const tcW = 7.0, tcD = 5.6, tcWallH = 3.0, tcT = 0.25, tcDoor = 2.2;
  const tea = makeTeaHouse(tcW, tcD, tcWallH, tcT, tcDoor);
  tea.group.position.set(tcx, 0, tcz);
  group.add(tea.group);
  const tcHW = tcW / 2, tcHD = tcD / 2;
  const tcSegW = (tcW - tcDoor) / 2;
  const tcSegCx = tcDoor / 2 + tcSegW / 2;
  addCollider(colliders, tcx, tcz + tcHD - tcT / 2, tcW, tcT);            // back (+Z)
  addCollider(colliders, tcx - tcHW + tcT / 2, tcz, tcT, tcD);            // left (−X)
  addCollider(colliders, tcx + tcHW - tcT / 2, tcz, tcT, tcD);            // right (+X)
  addCollider(colliders, tcx - tcSegCx, tcz - tcHD + tcT / 2, tcSegW, tcT); // front-left
  addCollider(colliders, tcx + tcSegCx, tcz - tcHD + tcT / 2, tcSegW, tcT); // front-right
  // (Doorway GAP at X∈[tcx−1.1, tcx+1.1] on the −Z line — no collider, walkable.)
  const teaSign = artPanel(3.0, 1.0, "sign", {
    text: "TEA HOUSE", bg: "#7a4a86", fg: "#f7e9c8",
    accent: "#ffd86b", emissiveIntensity: 0.55, file: "sign-park-tea.png",
  });
  teaSign.position.set(tcx, tcWallH + 0.55, tcz - tcHD - 0.06);
  teaSign.rotation.y = Math.PI; // face −Z (the green)
  group.add(teaSign);

  // --- Street-level FLAVOUR: market stalls, planters, crates, extra lamps ----
  // Two small open-air produce stalls on the lawn near the lane edges (front of
  // the new shops), each with a tight body collider. Kept off the doorways.
  const stallSpots = [[14, 6, Math.PI / 2], [-9, 16, 0]];
  for (const [x, z, ry] of stallSpots) {
    const stall = makeStall();
    stall.position.set(x, 0, z);
    stall.rotation.y = ry;
    group.add(stall);
    // Stall body is ~2.6 (X) × 1.8 (Z); swap when rotated 90° so the AABB fits.
    const rot = Math.abs(Math.cos(ry)) < 0.5;
    addCollider(colliders, x, z, rot ? 1.8 : 2.6, rot ? 2.6 : 1.8);
  }

  // Terracotta planters flanking the new shop entrances + along the path. Tight
  // colliders (they are solid little boxes the player walks around).
  const planterSpots = [
    [16.4, 1.4, 0], [21.6, 1.4, 0],   // flank the garden shop's −Z doorway
    [-3.6, 15.8, 0], [3.6, 15.8, 0],  // flank the tea house's −Z doorway
    [11.5, -14.0, 0], [-15, 4, 0],    // a couple along the paths
  ];
  for (const [x, z, ry] of planterSpots) {
    const pl = makePlanter();
    pl.position.set(x, 0, z);
    pl.rotation.y = ry;
    group.add(pl);
    addCollider(colliders, x, z, ry === 0 ? 1.4 : 0.55, ry === 0 ? 0.55 : 1.4);
  }

  // A few wooden crates stacked as lived-in clutter near the stalls (decorative,
  // small — no colliders).
  for (const [x, z, s] of [[12.5, 8.2, 1], [11.8, 8.0, 0.8], [-11, 14.5, 1], [-6.5, 17.5, 0.85]]) {
    const crate = box(0.7 * s, 0.7 * s, 0.7 * s, crateMat);
    crate.position.set(x, 0.35 * s, z);
    crate.castShadow = true;
    group.add(crate);
  }

  // Two extra path lamps lighting the new shop fronts (slim; tight colliders).
  for (const [x, z] of [[19, 9], [5, 16]]) {
    const lamp = makeLamp();
    lamp.position.set(x, 0, z);
    group.add(lamp);
    addCollider(colliders, x, z, 0.4, 0.4);
  }

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
    // Gentle flicker on the kiosk's interior pendant bulbs (shared material).
    kioskBulbMat.emissiveIntensity = 0.95 + Math.sin(t * 3.1) * 0.12;
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
