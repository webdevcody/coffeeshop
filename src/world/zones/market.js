// Market Street district — a bustling 60×60 m market tile centered on origin.
// Two rows of striped market stalls with bright alternating awnings (now varied
// in shape AND height) face a wide central lane (a car can drive straight
// through). Crates + woven baskets of colored produce sit in front of each
// stall, hanging goods (sausages/peppers) and little chalkboard price signs
// dangle from the awning bars, tilted vendor umbrellas shade alternating stalls,
// dense strings of warm bulbs are strung overhead, and a steel MARKET-HALL roof
// with simple A-frame trusses spans the whole arcade. Tall shop signs (style
// "sign": FRESH / BAKERY / CORNER MART) flank the street. A cobbled ground slab
// plus a slow-rotating "MARKET" sign and flickering string lights keep it alive.
//
// Performance: repeated produce + bulbs use THREE.InstancedMesh so the whole
// district stays well under ~50 draw objects. Geometries + materials are created
// once and reused. No per-frame allocation in update().
//
// buildMarket() returns { group, colliders, ground, update }:
//   group     — all meshes in LOCAL tile coords (X,Z ∈ [-30,30], y=0 ground)
//   colliders — tight AABBs for stalls/signs the player & a car can't pass
//   ground    — [{ full tile rect }] (whole tile is walkable; stalls block)
//   update(dt)— rotates the hub sign + flickers the string lights

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

// --- Shared materials (created ONCE, reused across every prop) --------------
const cobble = new THREE.MeshStandardMaterial({ color: "#8d857a", roughness: 1 });
const slabSide = new THREE.MeshStandardMaterial({ color: "#6c655c", roughness: 1 });
const laneMat = new THREE.MeshStandardMaterial({ color: "#7a736a", roughness: 1 });
const woodMat = new THREE.MeshStandardMaterial({ color: "#7a5230", roughness: 0.8 });
const darkWood = new THREE.MeshStandardMaterial({ color: "#4a3320", roughness: 0.85 });
const poleMat = new THREE.MeshStandardMaterial({ color: "#3a3a40", roughness: 0.5, metalness: 0.6 });
const stallBody = new THREE.MeshStandardMaterial({ color: "#caa46a", roughness: 0.85 });
const bulbMat = new THREE.MeshStandardMaterial({
  color: "#fff2c4", emissive: "#ffd980", emissiveIntensity: 0.9, roughness: 0.4,
});
const crateMat = new THREE.MeshStandardMaterial({ color: "#8a5e34", roughness: 0.8, flatShading: true });
const produceMat = new THREE.MeshStandardMaterial({ color: "#d8472b", roughness: 0.7, flatShading: true });
const basketMat = new THREE.MeshStandardMaterial({ color: "#b98a4a", roughness: 0.95, flatShading: true });
const steelMat = new THREE.MeshStandardMaterial({ color: "#5a5d63", roughness: 0.55, metalness: 0.55, flatShading: true });
const trussMat = new THREE.MeshStandardMaterial({ color: "#6f7378", roughness: 0.6, metalness: 0.5 });
const roofMat = new THREE.MeshStandardMaterial({ color: "#3b4a55", roughness: 0.85, metalness: 0.1, flatShading: true });
const chalkMat = new THREE.MeshStandardMaterial({ color: "#2a2f2c", roughness: 1 });
const chalkFrameMat = new THREE.MeshStandardMaterial({ color: "#6b4a28", roughness: 0.9, flatShading: true });
const hangMat = new THREE.MeshStandardMaterial({ color: "#9a3b28", roughness: 0.7, flatShading: true });
const umbrellaPoleMat = new THREE.MeshStandardMaterial({ color: "#cfc7b6", roughness: 0.7 });

// Bright alternating canopy colors for the awnings (vertex-colored instances).
const AWNING_COLORS = ["#e0473c", "#2f9e6e", "#e8a93a", "#3f7fd0"];
const UMBRELLA_COLORS = ["#d8453a", "#e8b53a", "#3f9e8e"];

// --- Shared geometries (created ONCE) --------------------------------------
const counterGeo = new THREE.BoxGeometry(4, 1, 1.4);
const topGeo = new THREE.BoxGeometry(4.2, 0.1, 1.6);
const awningGeo = new THREE.BoxGeometry(4.4, 0.16, 1.9);          // flat slab awning
const awningPeakGeo = new THREE.CylinderGeometry(0.05, 1.1, 4.5, 4, 1, false); // 4-sided ridge (gabled)
const postGeo = new THREE.BoxGeometry(0.14, 2.0, 0.14);
const crateGeo = new THREE.BoxGeometry(0.7, 0.55, 0.7);
const basketGeo = new THREE.CylinderGeometry(0.32, 0.24, 0.42, 8);
const produceGeo = new THREE.SphereGeometry(0.14, 8, 6);
const bulbGeo = new THREE.SphereGeometry(0.09, 8, 6);
const lampPoleGeo = new THREE.CylinderGeometry(0.09, 0.11, 5.2, 10);
// Theme detail geometries
const hangBarGeo = new THREE.BoxGeometry(3.6, 0.06, 0.06);       // rail under awning to hang goods
const hangGoodGeo = new THREE.CapsuleGeometry(0.06, 0.34, 3, 6); // sausage/pepper strand
const chalkGeo = new THREE.BoxGeometry(0.7, 0.5, 0.12);          // chalkboard panel (real thickness, not a sliver)
const chalkFrameGeo = new THREE.BoxGeometry(0.78, 0.58, 0.14);   // its wood frame (slightly deeper than the board)
const umbPoleGeo = new THREE.CylinderGeometry(0.04, 0.05, 3.0, 8);
const umbCanopyGeo = new THREE.ConeGeometry(1.4, 0.7, 8, 1, false); // 8-rib parasol
const trussChordGeo = new THREE.BoxGeometry(0.14, 0.14, 18.2);   // long roof beam (along Z)
const trussRiseGeo = new THREE.BoxGeometry(0.1, 0.1, 5.4);       // diagonal A-frame member
const hallColGeo = new THREE.BoxGeometry(0.26, 6.0, 0.26);       // market-hall support column

function box(geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

function makeShopSign(group, colliders, x, z, ry, text, bg) {
  const pole = box(new THREE.BoxGeometry(0.18, 4.4, 0.18), poleMat);
  pole.position.set(x, 2.2, z);
  pole.rotation.y = ry;
  group.add(pole);
  const panel = artPanel(2.4, 1.6, "sign", {
    text, bg, fg: "#fff7e8",
    emissiveIntensity: 0.55,
    file: `market-sign-${text.toLowerCase().replace(/\s+/g, "-")}.png`,
  });
  panel.position.set(x, 3.6, z);
  panel.rotation.y = ry;
  group.add(panel);
  addCollider(colliders, x, z, 0.6, 0.6);
}

export function buildMarket() {
  const group = new THREE.Group();
  const colliders = [];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  // --- Ground slab: cobbled market plaza ----------------------------------
  const slab = box(new THREE.BoxGeometry(60, 0.4, 60), cobble, false);
  slab.position.y = -0.2;
  slab.receiveShadow = true;
  group.add(slab);

  // central driving lane (8 m wide, runs along X through the middle)
  const lane = box(new THREE.BoxGeometry(60, 0.42, 8), laneMat, false);
  lane.position.y = -0.18;
  lane.receiveShadow = true;
  group.add(lane);

  // --- Stall layout -------------------------------------------------------
  // Lane occupies Z ∈ [-4, 4]. Near row centered z=+9, far row z=-9. Stalls
  // every 7 m along X (5 per row) so a car has a clear >=8 m lane down the
  // middle. Counters/tops/posts are built as plain meshes; awnings + produce +
  // bulbs are instanced.
  const stallX = [-21, -10.5, 0, 10.5, 21];
  const rows = [{ z: 9 }, { z: -9 }];
  const stalls = []; // {x,z,color,peak,awnH,umbrella}
  let ci = 0;
  for (const row of rows) {
    for (const x of stallX) {
      stalls.push({
        x,
        z: row.z,
        color: ci % AWNING_COLORS.length,
        peak: ci % 2 === 0,             // alternate gabled vs flat awning shape
        awnH: 2.2 + (ci % 3) * 0.22,    // vary awning HEIGHT (2.20 / 2.42 / 2.64)
        umbrella: ci % 3 === 1,         // a vendor umbrella on every third stall
      });
      ci++;
    }
  }
  const N = stalls.length; // 10
  const flatStalls = stalls.filter((s) => !s.peak);
  const peakStalls = stalls.filter((s) => s.peak);
  const umbStalls = stalls.filter((s) => s.umbrella);

  // Plain per-stall structure meshes (counter + top), kept low-count.
  for (const s of stalls) {
    const counter = box(counterGeo, stallBody);
    counter.position.set(s.x, 0.5, s.z);
    group.add(counter);
    const top = box(topGeo, darkWood);
    top.position.set(s.x, 1.05, s.z);
    group.add(top);
    addCollider(colliders, s.x, s.z, 4.4, 2.0);
  }

  // Instanced corner posts (4 per stall).
  const posts = new THREE.InstancedMesh(postGeo, woodMat, N * 4);
  posts.castShadow = true;
  posts.receiveShadow = true;
  let pi = 0;
  for (const s of stalls) {
    for (const dx of [-1.9, 1.9]) {
      for (const dz of [-0.7, 0.7]) {
        dummy.position.set(s.x + dx, 1.0, s.z + dz);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        posts.setMatrixAt(pi++, dummy.matrix);
      }
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);

  // Instanced sloped striped awnings — TWO shapes for variety:
  //  • flat slab awnings (sloped forward) on odd stalls
  //  • gabled "tent" ridge awnings on even stalls
  // Both share the same color palette and vary in mounting HEIGHT per stall.
  const awningFlatMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const awningPeakMat = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });

  const awningsFlat = new THREE.InstancedMesh(awningGeo, awningFlatMat, Math.max(1, flatStalls.length));
  awningsFlat.castShadow = true;
  awningsFlat.receiveShadow = true;
  flatStalls.forEach((s, i) => {
    dummy.position.set(s.x, s.awnH, s.z);
    dummy.rotation.set(-0.22, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    awningsFlat.setMatrixAt(i, dummy.matrix);
    awningsFlat.setColorAt(i, col.set(AWNING_COLORS[s.color]));
  });
  awningsFlat.instanceMatrix.needsUpdate = true;
  if (awningsFlat.instanceColor) awningsFlat.instanceColor.needsUpdate = true;
  group.add(awningsFlat);

  const awningsPeak = new THREE.InstancedMesh(awningPeakGeo, awningPeakMat, Math.max(1, peakStalls.length));
  awningsPeak.castShadow = true;
  awningsPeak.receiveShadow = true;
  peakStalls.forEach((s, i) => {
    // ridge runs along X (rotate cylinder so its axis is X), apex pointing up
    dummy.position.set(s.x, s.awnH + 0.35, s.z);
    dummy.rotation.set(0, 0, Math.PI / 2);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    awningsPeak.setMatrixAt(i, dummy.matrix);
    awningsPeak.setColorAt(i, col.set(AWNING_COLORS[s.color]));
  });
  awningsPeak.instanceMatrix.needsUpdate = true;
  if (awningsPeak.instanceColor) awningsPeak.instanceColor.needsUpdate = true;
  group.add(awningsPeak);

  // Reset dummy scale for subsequent instanced props.
  dummy.scale.set(1, 1, 1);

  // Instanced produce crates (2 per stall) on the lane-facing side.
  const crates = new THREE.InstancedMesh(crateGeo, crateMat, N * 2);
  crates.castShadow = true;
  crates.receiveShadow = true;
  let xi = 0;
  // lane-facing offset: near row (+z) faces -z, far row (-z) faces +z
  for (const s of stalls) {
    const faceZ = s.z > 0 ? -1 : 1;
    for (const dx of [-0.9, 0.9]) {
      dummy.position.set(s.x + dx, 0.27, s.z + faceZ * 1.05);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      crates.setMatrixAt(xi++, dummy.matrix);
    }
  }
  crates.instanceMatrix.needsUpdate = true;
  group.add(crates);

  // Instanced woven baskets (1 per stall) tucked beside the crates, lane-facing.
  const baskets = new THREE.InstancedMesh(basketGeo, basketMat, N);
  baskets.castShadow = true;
  baskets.receiveShadow = true;
  let basi = 0;
  for (const s of stalls) {
    const faceZ = s.z > 0 ? -1 : 1;
    dummy.position.set(s.x, 0.21, s.z + faceZ * 1.6);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    baskets.setMatrixAt(basi++, dummy.matrix);
  }
  baskets.instanceMatrix.needsUpdate = true;
  group.add(baskets);

  // A heap of produce sitting in each basket (3 per basket, reuses produceGeo).
  const basketHeap = new THREE.InstancedMesh(produceGeo, produceMat, N * 3);
  basketHeap.castShadow = true;
  let bhi = 0;
  const HEAP_COLORS = ["#e8b53a", "#5fae3f", "#e8742a"];
  for (const s of stalls) {
    const faceZ = s.z > 0 ? -1 : 1;
    const bx = s.x;
    const bz = s.z + faceZ * 1.6;
    const cc = col.set(HEAP_COLORS[(s.color) % HEAP_COLORS.length]);
    for (let p = 0; p < 3; p++) {
      dummy.position.set(bx + (p - 1) * 0.12, 0.46 + (p === 1 ? 0.08 : 0), bz + (p % 2 ? 0.08 : -0.08));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      basketHeap.setMatrixAt(bhi, dummy.matrix);
      basketHeap.setColorAt(bhi, cc);
      bhi++;
    }
  }
  basketHeap.instanceMatrix.needsUpdate = true;
  if (basketHeap.instanceColor) basketHeap.instanceColor.needsUpdate = true;
  group.add(basketHeap);

  // Instanced produce mounds (5 spheres per crate => N*2*5 = 100 instances).
  const PROD_PER = 5;
  const produce = new THREE.InstancedMesh(produceGeo, produceMat, N * 2 * PROD_PER);
  produce.castShadow = true;
  const PROD_COLORS = ["#d8472b", "#e8b53a", "#5fae3f", "#a44fc0", "#e8742a"];
  let fi = 0;
  for (const s of stalls) {
    const faceZ = s.z > 0 ? -1 : 1;
    let crateNo = 0;
    for (const dx of [-0.9, 0.9]) {
      const cx = s.x + dx;
      const cz = s.z + faceZ * 1.05;
      const cc = col.set(PROD_COLORS[(s.color + crateNo) % PROD_COLORS.length]);
      for (let p = 0; p < PROD_PER; p++) {
        const ox = (p - 2) * 0.13;
        const oz = (p % 2 ? 0.1 : -0.1);
        const oy = 0.6 + (p === 4 ? 0.13 : 0);
        dummy.position.set(cx + ox, oy, cz + oz);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        produce.setMatrixAt(fi, dummy.matrix);
        produce.setColorAt(fi, cc);
        fi++;
      }
      crateNo++;
    }
  }
  produce.instanceMatrix.needsUpdate = true;
  if (produce.instanceColor) produce.instanceColor.needsUpdate = true;
  group.add(produce);

  // --- Hanging goods rail + dangling strands (instanced) ------------------
  // A thin rail under the front edge of each awning, with 4 hanging strands
  // (sausages / dried peppers) per stall swaying gently below it.
  const hangBars = new THREE.InstancedMesh(hangBarGeo, darkWood, N);
  hangBars.castShadow = true;
  let hbi = 0;
  for (const s of stalls) {
    const faceZ = s.z > 0 ? -1 : 1;
    dummy.position.set(s.x, s.awnH - 0.25, s.z + faceZ * 0.85);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    hangBars.setMatrixAt(hbi++, dummy.matrix);
  }
  hangBars.instanceMatrix.needsUpdate = true;
  group.add(hangBars);

  const HANG_PER = 4;
  const hangGoods = new THREE.InstancedMesh(hangGoodGeo, hangMat, N * HANG_PER);
  hangGoods.castShadow = true;
  const HANG_COLORS = ["#9a3b28", "#c4502a", "#a8632c", "#7d2f22"];
  const hangBase = []; // remember rest pose for sway in update()
  let hgi = 0;
  for (const s of stalls) {
    const faceZ = s.z > 0 ? -1 : 1;
    const cc = col.set(HANG_COLORS[s.color % HANG_COLORS.length]);
    for (let h = 0; h < HANG_PER; h++) {
      const gx = s.x + (h - 1.5) * 0.7;
      const gy = s.awnH - 0.55;
      const gz = s.z + faceZ * 0.85;
      hangBase.push({ x: gx, y: gy, z: gz, phase: hgi * 0.9 });
      dummy.position.set(gx, gy, gz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      hangGoods.setMatrixAt(hgi, dummy.matrix);
      hangGoods.setColorAt(hgi, cc);
      hgi++;
    }
  }
  hangGoods.instanceMatrix.needsUpdate = true;
  if (hangGoods.instanceColor) hangGoods.instanceColor.needsUpdate = true;
  group.add(hangGoods);

  // --- Chalkboard price signs (instanced board + frame, one per stall) ----
  // Propped on the counter top, lane-facing, with a little hand-written price
  // panel (artPanel) on the two front-most stalls for legibility flavor.
  const chalkFrames = new THREE.InstancedMesh(chalkFrameGeo, chalkFrameMat, N);
  const chalkBoards = new THREE.InstancedMesh(chalkGeo, chalkMat, N);
  chalkFrames.castShadow = true;
  chalkBoards.castShadow = true;
  let chi = 0;
  for (const s of stalls) {
    const faceZ = s.z > 0 ? -1 : 1;
    const px = s.x + 1.4;
    const py = 1.35;
    const pz = s.z + faceZ * 0.55;
    const tilt = faceZ > 0 ? 0.16 : -0.16; // lean back toward the stall
    dummy.position.set(px, py, pz);
    dummy.rotation.set(tilt, 0, 0);
    dummy.updateMatrix();
    chalkFrames.setMatrixAt(chi, dummy.matrix);
    // Push the board face clear of the frame face (frame is 0.14 deep, board
    // 0.12 deep) so it reads as an inset panel instead of z-fighting coplanar.
    dummy.position.set(px, py, pz + faceZ * 0.05);
    dummy.updateMatrix();
    chalkBoards.setMatrixAt(chi, dummy.matrix);
    chi++;
  }
  chalkFrames.instanceMatrix.needsUpdate = true;
  chalkBoards.instanceMatrix.needsUpdate = true;
  group.add(chalkFrames);
  group.add(chalkBoards);

  // A couple of readable chalk "price" signs (procedural sign panels).
  const priceTags = [
    { x: 0, z: 9, faceZ: -1, text: "APPLES $2", bg: "#2a2f2c" },
    { x: 0, z: -9, faceZ: 1, text: "BREAD $4", bg: "#2a2f2c" },
  ];
  for (const p of priceTags) {
    const panel = artPanel(0.66, 0.46, "sign", {
      text: p.text, bg: p.bg, fg: "#e8efe4",
      emissiveIntensity: 0.18,
      file: `market-price-${p.text.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
    });
    panel.position.set(p.x + 1.4, 1.35, p.z + p.faceZ * 0.6);
    panel.rotation.x = p.faceZ > 0 ? 0.16 : -0.16;
    if (p.faceZ > 0) panel.rotation.y = Math.PI;
    group.add(panel);
  }

  // --- Vendor umbrellas over every third stall ----------------------------
  // A leaning parasol: thin pole + colored cone canopy, tilted toward the lane.
  const umbPoles = new THREE.InstancedMesh(umbPoleGeo, umbrellaPoleMat, Math.max(1, umbStalls.length));
  const umbCanopies = new THREE.InstancedMesh(umbCanopyGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), Math.max(1, umbStalls.length));
  umbPoles.castShadow = true;
  umbCanopies.castShadow = true;
  umbCanopies.receiveShadow = true;
  umbStalls.forEach((s, i) => {
    const faceZ = s.z > 0 ? -1 : 1;
    const ux = s.x - 1.5;
    const uz = s.z + faceZ * 1.3;
    const tilt = faceZ * -0.18;
    dummy.position.set(ux, 1.9, uz);
    dummy.rotation.set(tilt, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    umbPoles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(ux + Math.sin(0) * 0, 3.4, uz + faceZ * 0.35);
    dummy.rotation.set(tilt, 0, 0);
    dummy.updateMatrix();
    umbCanopies.setMatrixAt(i, dummy.matrix);
    umbCanopies.setColorAt(i, col.set(UMBRELLA_COLORS[i % UMBRELLA_COLORS.length]));
  });
  umbPoles.instanceMatrix.needsUpdate = true;
  umbCanopies.instanceMatrix.needsUpdate = true;
  if (umbCanopies.instanceColor) umbCanopies.instanceColor.needsUpdate = true;
  group.add(umbPoles);
  group.add(umbCanopies);

  // --- Central MARKET-HALL roof with simple A-frame trusses ---------------
  // A light steel frame spanning both stall rows down the arcade, with a
  // translucent dark roof deck on top. Columns sit on the OUTER edge of each
  // row (|z| ~ 11.5) so the central driving corridor Z∈[-4,4] stays clear.
  const HALL_Y = 7.0;                 // eave height
  const RIDGE_Y = 9.2;                // ridge (peak) height
  const colXs = [-21, -10.5, 0, 10.5, 21];
  const colZ = 11.6;                  // outside both rows, off the lane

  // Support columns (solid mass -> real colliders) at each bay corner.
  for (const x of colXs) {
    for (const z of [colZ, -colZ]) {
      const c = box(hallColGeo, steelMat);
      c.position.set(x, HALL_Y / 2, z);
      group.add(c);
      addCollider(colliders, x, z, 0.4, 0.4);
    }
  }

  // Long top chords running along Z at each column line (eave height).
  for (const x of colXs) {
    const chord = box(trussChordGeo, trussMat, true);
    chord.position.set(x, HALL_Y, 0);
    group.add(chord);
    // A-frame: two diagonal members rising to a center ridge node.
    const riseN = box(trussRiseGeo, trussMat, true);
    riseN.position.set(x, (HALL_Y + RIDGE_Y) / 2, 6.0);
    riseN.rotation.x = Math.atan2(RIDGE_Y - HALL_Y, -colZ);
    group.add(riseN);
    const riseS = box(trussRiseGeo, trussMat, true);
    riseS.position.set(x, (HALL_Y + RIDGE_Y) / 2, -6.0);
    riseS.rotation.x = Math.atan2(RIDGE_Y - HALL_Y, colZ);
    group.add(riseS);
  }
  // Ridge beam along the spine (over the lane center, well above 4 m clearance).
  const ridge = box(new THREE.BoxGeometry(45.0, 0.16, 0.16), trussMat, true);
  ridge.position.set(0, RIDGE_Y, 0);
  group.add(ridge);

  // Two gable roof decks (north & south slopes) of the hall.
  const slopeLen = Math.hypot(colZ, RIDGE_Y - HALL_Y);
  const slopeGeo = new THREE.BoxGeometry(46.0, 0.12, slopeLen);
  const slopeAngle = Math.atan2(RIDGE_Y - HALL_Y, colZ);
  const deckN = box(slopeGeo, roofMat, true);
  deckN.position.set(0, (HALL_Y + RIDGE_Y) / 2, colZ / 2);
  deckN.rotation.x = -slopeAngle;
  group.add(deckN);
  const deckS = box(slopeGeo, roofMat, true);
  deckS.position.set(0, (HALL_Y + RIDGE_Y) / 2, -colZ / 2);
  deckS.rotation.x = slopeAngle;
  group.add(deckS);

  // --- Lamp posts along the lane edges ------------------------------------
  const lampXs = [-24, -8, 8, 24];
  const lampZ = 4.6; // just outside the 8 m lane
  for (const x of lampXs) {
    for (const z of [lampZ, -lampZ]) {
      const pole = box(lampPoleGeo, poleMat);
      pole.position.set(x, 2.6, z);
      group.add(pole);
      addCollider(colliders, x, z, 0.5, 0.5);
    }
  }

  // --- Hanging string lights (instanced bulbs) — DENSE festoon canopy ------
  // Two families of strings, all sharing one InstancedMesh + the shared bulbMat:
  //  • cross strings: one per lamp X, dense catenary across the lane
  //  • longitudinal strings: two long runs along X (over each stall row) so the
  //    whole arcade glows, not just the lane crossings.
  const BULBS_PER = 15;                       // denser than before (was 9)
  const crossCount = lampXs.length * (BULBS_PER + 1);
  const longZs = [4.6, -4.6];                 // run along the lane edges
  const LONG_PER = 41;                         // bulbs along each 48 m run
  const longCount = longZs.length * (LONG_PER + 1);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, crossCount + longCount);
  let bi = 0;
  for (const x of lampXs) {
    for (let i = 0; i <= BULBS_PER; i++) {
      const tt = i / BULBS_PER;
      const z = lampZ + (-lampZ - lampZ) * tt;
      const y = 5.0 - Math.sin(tt * Math.PI) * 0.9; // catenary sag
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bulbs.setMatrixAt(bi++, dummy.matrix);
    }
  }
  for (const z of longZs) {
    for (let i = 0; i <= LONG_PER; i++) {
      const tt = i / LONG_PER;
      const x = -24 + tt * 48;                 // -24 .. +24 along the arcade
      // gentle scalloped sag between the four lamp posts
      const y = 5.0 - Math.abs(Math.sin(tt * Math.PI * 4)) * 0.45;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bulbs.setMatrixAt(bi++, dummy.matrix);
    }
  }
  bulbs.instanceMatrix.needsUpdate = true;
  group.add(bulbs);

  // --- Shop signs flanking the street -------------------------------------
  makeShopSign(group, colliders, -26, 13, 0, "FRESH", "#2f9e6e");
  makeShopSign(group, colliders, 26, -13, 0, "BAKERY", "#c4302b");
  makeShopSign(group, colliders, 26, 13, -Math.PI / 6, "CORNER MART", "#3f7fd0");

  // --- Rotating market hub sign (animated) --------------------------------
  // Pole sits OFF the lane (Z=6, beside the west lamp posts) so the central
  // driving corridor Z∈[-4,4] stays fully clear end-to-end; the sign hangs out
  // over the lane entrance on a short arm and spins.
  const hubPole = box(new THREE.BoxGeometry(0.24, 7.2, 0.24), poleMat);
  hubPole.position.set(-28, 3.6, 6);
  group.add(hubPole);
  addCollider(colliders, -28, 6, 0.6, 0.6);
  const hubArm = box(new THREE.BoxGeometry(0.12, 0.12, 6.4), poleMat);
  hubArm.position.set(-28, 6.9, 2.8);
  group.add(hubArm);
  const hubSign = artPanel(3.0, 1.8, "sign", {
    text: "MARKET", bg: "#e0473c", fg: "#fff7e8",
    emissiveIntensity: 0.55, file: "market-hub.png",
  });
  hubSign.position.set(-28, 6.4, 0);
  group.add(hubSign);

  // --- ground: whole tile is walkable -------------------------------------
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  // --- Animation (no per-frame allocation) --------------------------------
  let t = 0;
  let swayAccum = 0;
  function update(dt) {
    t += dt;
    hubSign.rotation.y += dt * 0.6; // slowly spin the hub sign
    // flicker the string lights via shared emissive intensity (two phases)
    bulbMat.emissiveIntensity = 0.9 + Math.sin(t * 7.0) * 0.18 + Math.sin(t * 2.3) * 0.1;
    // gentle sway of the hanging goods (throttled to ~20 Hz, reuses dummy)
    swayAccum += dt;
    if (swayAccum >= 0.05) {
      swayAccum = 0;
      for (let g = 0; g < hangBase.length; g++) {
        const b = hangBase[g];
        const a = Math.sin(t * 1.6 + b.phase) * 0.14; // small pendulum angle
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(a, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        hangGoods.setMatrixAt(g, dummy.matrix);
      }
      hangGoods.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, colliders, ground, update };
}
