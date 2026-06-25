// WATERFRONT PIER district — a 60×60 m tile centred on the origin.
//
// Layout (looking down, +Z is "out to sea"):
//   • The shore half (Z < ~0) is a sandy/wood boardwalk promenade.
//   • A water slab fills the seaward half and gently bobs (animated verts via
//     a cheap material-time uniform-free sine on a few segments).
//   • A wooden pier deck on pilings runs straight out along X=0 into the water.
//   • A red-and-white striped lighthouse stands at the shore end with a
//     rotating beacon (animated cone of light + spinning lamp).
//   • Railings line the pier, an arcade booth + ferris-wheel silhouette sit on
//     the promenade, and seagull specks circle overhead.
//
// A wide-open lane is kept along the promenade (Z in [-12, -2]) and the pier
// deck itself is the only structure crossing the water, so a car can cruise the
// boardwalk. Returns { group, colliders, ground, update }.

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

// --- Shared materials (created ONCE, reused across props) ------------------
// DoubleSide so the flat sand/seabed surfaces still read when viewed edge-on or
// from below (e.g. the seabed seen at a glancing angle through the sea); a
// single-sided ground plane vanishes / reads as a 1px line from those angles.
const sandMat = new THREE.MeshStandardMaterial({ color: "#d9c79a", roughness: 1, side: THREE.DoubleSide });
// Wet-sand beach band where the surf meets the shore (darker, damp, faintly shiny).
const wetSandMat = new THREE.MeshStandardMaterial({ color: "#b8a16f", roughness: 0.8, metalness: 0.05 });
// Translucent animated sea: a low gloss, slightly metallic surface that lets a
// little of the sandy seabed show through. The emissive/colour are nudged each
// frame in update() for a gentle shimmer; the verts swell with sine waves.
const waterMat = new THREE.MeshStandardMaterial({
  color: "#2f7fa8", roughness: 0.2, metalness: 0.35,
  emissive: "#0d3a52", emissiveIntensity: 0.3, flatShading: true,
  transparent: true, opacity: 0.82,
  // DoubleSide: the sea sits below deck height, so the player driving the pier
  // views it near edge-on / from above-and-out; a single-sided plane would
  // vanish or read as a 1px sliver at those glancing angles.
  side: THREE.DoubleSide,
});
// Foamy surf line (a thin translucent white strip riding the waterline).
const foamMat = new THREE.MeshStandardMaterial({
  color: "#eaf6fb", roughness: 0.7, emissive: "#cfeaf4", emissiveIntensity: 0.35,
  transparent: true, opacity: 0.55, depthWrite: false,
  // DoubleSide so the surf line reads from both the shore and seaward approaches
  // instead of dropping to a 1px line when seen edge-on.
  side: THREE.DoubleSide,
});
const slabSide = new THREE.MeshStandardMaterial({ color: "#8a7a55", roughness: 1 });
const plankMat = new THREE.MeshStandardMaterial({ color: "#9c6b3f", roughness: 0.85 });
const plankDark = new THREE.MeshStandardMaterial({ color: "#7d5230", roughness: 0.9 });
const pilingMat = new THREE.MeshStandardMaterial({ color: "#5d4127", roughness: 0.95 });
const railMat = new THREE.MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.8 });
const whiteMat = new THREE.MeshStandardMaterial({ color: "#f2efe6", roughness: 0.7 });
const redMat = new THREE.MeshStandardMaterial({ color: "#cf3b34", roughness: 0.7 });
const glassMat = new THREE.MeshStandardMaterial({
  color: "#fff3c4", emissive: "#ffe08a", emissiveIntensity: 1.4, roughness: 0.3,
});
const beamMat = new THREE.MeshStandardMaterial({
  color: "#fff2c0", emissive: "#ffe79a", emissiveIntensity: 0.9,
  transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
});
const steelMat = new THREE.MeshStandardMaterial({ color: "#cf4f6b", roughness: 0.5, metalness: 0.6 });
const cabinMat = new THREE.MeshStandardMaterial({ color: "#4fb0c7", roughness: 0.6 });
const boothMat = new THREE.MeshStandardMaterial({ color: "#e85d8a", roughness: 0.7 });
const boothRoofMat = new THREE.MeshStandardMaterial({ color: "#f6d24a", roughness: 0.7 });
const gullMat = new THREE.MeshStandardMaterial({ color: "#f4f4ee", roughness: 0.8, flatShading: true });
const buoyMat = new THREE.MeshStandardMaterial({ color: "#e0473c", roughness: 0.7 });
const ropeMat = new THREE.MeshStandardMaterial({ color: "#caa86a", roughness: 1 });
// Building skins for the promenade pavilions (a ticket-office / pier hall and the
// arcade). Painted seaside-resort woodwork: cream walls, teal & coral trim, glassy
// shopfronts and a striped awning. All reused across the two buildings.
const wallMat = new THREE.MeshStandardMaterial({ color: "#eae3d2", roughness: 0.85 });
const wallTrimMat = new THREE.MeshStandardMaterial({ color: "#2f7f93", roughness: 0.75 });
const roofMat = new THREE.MeshStandardMaterial({ color: "#b8453e", roughness: 0.7 });
const doorMat = new THREE.MeshStandardMaterial({ color: "#3a4f57", roughness: 0.7, metalness: 0.2 });
const shopWinMat = new THREE.MeshStandardMaterial({
  color: "#bfe6ef", roughness: 0.25, metalness: 0.2,
  emissive: "#2b3d44", emissiveIntensity: 0.35,
});
const awningMat = new THREE.MeshStandardMaterial({ color: "#d24b6a", roughness: 0.75 });
const awningStripeMat = new THREE.MeshStandardMaterial({ color: "#f2efe6", roughness: 0.75 });
const columnMat = new THREE.MeshStandardMaterial({ color: "#d8cfb8", roughness: 0.85 });

// --- Shared geometries (reused across repeated props) ----------------------
const pilingGeo = new THREE.CylinderGeometry(0.22, 0.26, 5, 8);
const railPostGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
const gullBodyGeo = new THREE.ConeGeometry(0.1, 0.42, 5);
const gullWingGeo = new THREE.PlaneGeometry(0.7, 0.16);

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// A stretch of railing: two long rails plus a few posts, running along +X.
// Posts are kept sparse so a long pier doesn't blow the mesh budget.
function makeRailing(length) {
  const g = new THREE.Group();
  const posts = Math.max(2, Math.round(length / 14));
  for (let i = 0; i <= posts; i++) {
    const post = new THREE.Mesh(railPostGeo, railMat);
    post.position.set(-length / 2 + (i / posts) * length, 0.5, 0);
    post.castShadow = true;
    g.add(post);
  }
  // One sturdy top rail + a mid rail drawn as a single taller bar keeps mesh
  // count low while still reading as a guard rail.
  const rail = box(length, 0.55, 0.09, railMat);
  rail.position.set(0, 0.68, 0);
  g.add(rail);
  return g;
}

function makeSeagull() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(gullBodyGeo, gullMat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const lp = new THREE.Group();
  const left = new THREE.Mesh(gullWingGeo, gullMat);
  left.material.side = THREE.DoubleSide;
  left.position.z = -0.32;
  lp.add(left);
  const rp = new THREE.Group();
  const right = new THREE.Mesh(gullWingGeo, gullMat);
  right.position.z = 0.32;
  rp.add(right);
  g.add(lp, rp);
  g.userData.wings = [lp, rp];
  return g;
}

export function buildPier() {
  const group = new THREE.Group();
  const colliders = [];

  // --- Base slab: sandy shore on the near half, with thickness so the tile
  // reads as a solid block of land/boardwalk -------------------------------
  const slab = box(60, 0.8, 60, slabSide, false);
  slab.position.set(0, -0.4, 0);
  group.add(slab);

  // Sandy promenade top plate (whole tile, top at y=0).
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = 0.01;
  sand.receiveShadow = true;
  group.add(sand);

  // --- Wet-sand beach band where the surf meets the boardwalk (Z≈-3..0) ----
  // A darker damp strip + a translucent foam line make the shore feel alive.
  const beach = box(60, 0.05, 5, wetSandMat, false);
  beach.position.set(0, 0.02, -0.5);
  beach.receiveShadow = true;
  group.add(beach);
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(60, 2.4), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.05, -1.4);
  group.add(foam);

  // --- Seabed under the translucent water (visible faintly through the sea) --
  const seabed = new THREE.Mesh(new THREE.PlaneGeometry(60, 34), sandMat);
  seabed.rotation.x = -Math.PI / 2;
  seabed.position.set(0, -0.45, 14);
  seabed.receiveShadow = true;
  group.add(seabed);

  // --- Water slab covering the seaward half (Z from -2 to 30) -------------
  // A higher-res plane we nudge per-frame for a gentle swell.
  const waterGeo = new THREE.PlaneGeometry(60, 32, 24, 16);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.1, 14);
  water.receiveShadow = true;
  group.add(water);
  // Cache base positions so the swell animation never allocates.
  const waterPos = waterGeo.attributes.position;
  const waterBaseY = new Float32Array(waterPos.count);
  for (let i = 0; i < waterPos.count; i++) waterBaseY[i] = waterPos.getZ(i); // plane local Z = world height before rotation

  // --- Boardwalk promenade strip along the shore (a band of planks) -------
  // One base plank band + a few seam strips reads as decking without many meshes.
  const promenade = box(60, 0.12, 16, plankMat, false);
  promenade.position.set(0, 0.08, -15);
  group.add(promenade);
  for (let i = 0; i < 3; i++) {
    const seam = box(60, 0.13, 0.12, plankDark, false);
    seam.position.set(0, 0.085, -21 + i * 5);
    group.add(seam);
  }

  // --- Pier deck on pilings, running out along X=0 (Z from -4 to 28) ------
  const DECK_W = 6;       // 6 m wide: a clear lane a car could drive onto
  const DECK_Z0 = -4;
  const DECK_Z1 = 28;
  const deckLen = DECK_Z1 - DECK_Z0;
  const deckCz = (DECK_Z0 + DECK_Z1) / 2;
  const deck = box(DECK_W, 0.3, deckLen, plankMat);
  deck.position.set(0, 0.55, deckCz);
  group.add(deck);
  // Longitudinal plank boards: alternating light/dark strips running the length
  // of the deck give it real planking detail (cheap thin top-skin boxes).
  const PLANKS = 7;
  const plankW = (DECK_W - 0.4) / PLANKS;
  for (let i = 0; i < PLANKS; i++) {
    if (i % 2 === 0) continue; // only draw the darker boards as an overlay
    const board = box(plankW - 0.06, 0.02, deckLen - 0.4, plankDark, false);
    board.position.set(-DECK_W / 2 + 0.2 + (i + 0.5) * plankW, 0.706, deckCz);
    group.add(board);
  }
  // Plank seams across the deck (sparse cross-joints).
  for (let z = DECK_Z0 + 2; z < DECK_Z1; z += 6) {
    const seam = box(DECK_W, 0.32, 0.1, plankDark, false);
    seam.position.set(0, 0.56, z);
    group.add(seam);
  }
  // Pilings under the deck (two rows). Collider is the whole deck footprint.
  for (let z = DECK_Z0 + 1; z <= DECK_Z1; z += 9) {
    for (const x of [-DECK_W / 2 + 0.4, DECK_W / 2 - 0.4]) {
      const p = new THREE.Mesh(pilingGeo, pilingMat);
      p.position.set(x, -1.9, z);
      p.castShadow = true;
      group.add(p);
    }
  }
  addCollider(colliders, 0, deckCz, DECK_W, deckLen);

  // Railings down both sides of the pier deck.
  for (const side of [-1, 1]) {
    const rail = makeRailing(deckLen);
    rail.rotation.y = Math.PI / 2;
    rail.position.set(side * (DECK_W / 2 - 0.05), 0.7, deckCz);
    group.add(rail);
  }
  // A single end-cap bar at the seaward tip (bollards mark the corners).
  const endRail = box(DECK_W, 0.55, 0.09, railMat);
  endRail.position.set(0, 1.38, DECK_Z1 - 0.1);
  group.add(endRail);

  // --- Lighthouse at the shore end of the pier (X=0, Z=-9) ----------------
  const lhX = 0, lhZ = -9;
  const lighthouse = new THREE.Group();
  lighthouse.position.set(lhX, 0, lhZ);
  // Stone base.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.4, 1.2, 12), slabSide);
  base.position.y = 0.6;
  base.castShadow = base.receiveShadow = true;
  lighthouse.add(base);
  // Striped tapered tower (alternating red/white bands).
  const BANDS = 4;
  for (let i = 0; i < BANDS; i++) {
    const r0 = 1.5 - i * 0.2;
    const r1 = 1.5 - (i + 1) * 0.2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 2.0, 12), i % 2 ? redMat : whiteMat);
    band.position.y = 1.2 + 1.0 + i * 2.0;
    band.castShadow = true;
    lighthouse.add(band);
  }
  // Gallery deck + lamp room.
  const galleryY = 1.2 + 1.0 + BANDS * 2.0 - 0.2;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.25, 12), railMat);
  gallery.position.y = galleryY;
  lighthouse.add(gallery);
  const lampHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 1.1, 10), redMat);
  lampHousing.position.y = galleryY + 0.75;
  lampHousing.castShadow = true;
  lighthouse.add(lampHousing);
  // Glowing lamp (we spin a child group holding the beam).
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), glassMat);
  lamp.position.y = galleryY + 0.75;
  lighthouse.add(lamp);
  // Rotating beacon beam: a thin wedge of light that sweeps around.
  const beacon = new THREE.Group();
  beacon.position.y = galleryY + 0.75;
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 14, 4, 1, true), beamMat);
  beam.rotation.z = Math.PI / 2; // point the cone along +X
  beam.position.x = 7;
  beacon.add(beam);
  lighthouse.add(beacon);
  // Roof cap.
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.9, 10), redMat);
  cap.position.y = galleryY + 1.6;
  cap.castShadow = true;
  lighthouse.add(cap);
  group.add(lighthouse);
  addCollider(colliders, lhX, lhZ, 4.0, 4.0);

  // --- Seaside-resort buildings on the promenade --------------------------
  // PRIORITY: these are FULL 3D VOLUMES (real width AND depth AND height), not
  // flat facades or thin slabs. Each sits BEHIND the clear promenade driving lane
  // (Z in [-12,-2]) with its detailed FRONT facing +Z toward that lane/sea, so
  // artPanel signs (which face +Z by default) need NO rotation — no mirrored text.
  // Each building is a solid hall (wall box + overhanging roof) whose FRONT wall
  // sits at +Z = depth/2. The shared shopfront/awning helpers below pin glazing,
  // an awning and the sign just PROUD of that wall (≤0.6 m), so the ONE footprint
  // collider added per building (full width×depth) stays exact.
  function makeShopWindows(w, frontZ) {
    // A run of glowing shopfront windows across the front wall, framed by a
    // continuous teal sill/lintel so the storefront reads as glazed, not blank.
    const g = new THREE.Group();
    const panes = Math.max(2, Math.round(w / 2.2));
    const paneW = (w - 0.8) / panes;
    for (let i = 0; i < panes; i++) {
      const pane = box(paneW - 0.18, 1.7, 0.12, shopWinMat, false);
      pane.position.set(-w / 2 + 0.4 + (i + 0.5) * paneW, 1.9, frontZ + 0.07);
      g.add(pane);
    }
    const sill = box(w - 0.4, 0.18, 0.18, wallTrimMat, false);
    sill.position.set(0, 0.95, frontZ + 0.09);
    g.add(sill);
    const lintel = box(w - 0.4, 0.2, 0.2, wallTrimMat, false);
    lintel.position.set(0, 2.85, frontZ + 0.1);
    g.add(lintel);
    return g;
  }
  // A striped awning shading the shopfront: alternating coral/cream slats on a
  // gentle forward tilt, with two slim support posts to the deck.
  function makeAwning(w, frontZ, y) {
    const g = new THREE.Group();
    const depth = 1.8;
    const slats = Math.max(3, Math.round(w / 1.1));
    const slatW = w / slats;
    for (let i = 0; i < slats; i++) {
      const slat = box(slatW + 0.02, 0.08, depth, i % 2 ? awningStripeMat : awningMat, false);
      slat.position.set(-w / 2 + (i + 0.5) * slatW, y, frontZ + depth / 2 - 0.1);
      g.add(slat);
    }
    g.rotation.x = -0.18; // tip the front edge down toward the street
    // Support posts run from the awning's outer corners down to the deck.
    for (const sx of [-w / 2 + 0.4, w / 2 - 0.4]) {
      const post = box(0.12, y, 0.12, columnMat, false);
      post.position.set(sx, y / 2, frontZ + depth - 0.2);
      g.add(post);
    }
    return g;
  }

  // --- ARCADE (a full hall, left of the pier) -----------------------------
  // 11 m wide × 8 m deep × 5 m tall — a real city-block volume, solid from all
  // sides, well clear of the promenade lane (front wall at Z=-16, lane ends -12).
  const arcX = -15, arcZ = -20, arcW = 11, arcD = 8, arcH = 5;
  const arcFrontZ = arcD / 2;
  const arcade = new THREE.Group();
  arcade.position.set(arcX, 0, arcZ);
  const arcBody = box(arcW, arcH, arcD, boothMat);
  arcBody.position.y = arcH / 2;
  arcade.add(arcBody);
  // A pitched parapet roof cap (full footprint, slightly overhanging) so the
  // building reads as a solid hall from front, sides AND back.
  const arcRoof = box(arcW + 0.5, 0.6, arcD + 0.5, boothRoofMat);
  arcRoof.position.y = arcH + 0.2;
  arcade.add(arcRoof);
  const arcRidge = new THREE.Mesh(new THREE.ConeGeometry(arcW * 0.62, 1.7, 4), boothRoofMat);
  arcRidge.rotation.y = Math.PI / 4;
  arcRidge.position.y = arcH + 1.2;
  arcRidge.scale.z = (arcD + 0.5) / (arcW + 0.5);
  arcRidge.castShadow = true;
  arcade.add(arcRidge);
  // Glazed shopfront + glowing neon sign on the FRONT (faces +Z toward the lane).
  arcade.add(makeShopWindows(arcW, arcFrontZ));
  // Central entrance door set into the glazing.
  const arcDoor = box(2.0, 2.6, 0.16, doorMat, false);
  arcDoor.position.set(0, 1.3, arcFrontZ + 0.08);
  arcade.add(arcDoor);
  arcade.add(makeAwning(arcW - 1.0, arcFrontZ, 3.4));
  const arcSign = artPanel(5.0, 1.7, "neon", {
    lines: ["ARCADE", "PIER"], color: "#ff5fae", color2: "#5fd2ff",
    emissiveIntensity: 0.9, file: "pier-arcade-neon.png",
  });
  arcSign.position.set(0, arcH - 0.7, arcFrontZ + 0.12);
  arcade.add(arcSign);
  group.add(arcade);
  addCollider(colliders, arcX, arcZ, arcW, arcD);

  // --- PIER HALL / ticket office (a full hall, right of the pier) ----------
  // 12 m wide × 9 m deep × 6 m tall — the district's main building, a substantial
  // volume that reads solid from every angle. Front wall at Z=-16.5 (lane ends -12).
  const hallX = 15, hallZ = -21, hallW = 12, hallD = 9, hallH = 6;
  const hallFrontZ = hallD / 2;
  const hall = new THREE.Group();
  hall.position.set(hallX, 0, hallZ);
  const hallBody = box(hallW, hallH, hallD, wallMat);
  hallBody.position.y = hallH / 2;
  hall.add(hallBody);
  // Corner pilasters give the seaside-resort hall some relief on the side/back
  // faces too, so it never reads as a plain slab from behind.
  for (const cx of [-hallW / 2 + 0.25, hallW / 2 - 0.25]) {
    for (const cz of [-hallD / 2 + 0.25, hallD / 2 - 0.25]) {
      const pil = box(0.5, hallH, 0.5, wallTrimMat, false);
      pil.position.set(cx, hallH / 2, cz);
      hall.add(pil);
    }
  }
  // Overhanging hip roof (full footprint) + a small cupola, reading solid all round.
  const hallRoof = box(hallW + 0.9, 0.7, hallD + 0.9, roofMat);
  hallRoof.position.y = hallH + 0.25;
  hall.add(hallRoof);
  const hallHip = new THREE.Mesh(new THREE.ConeGeometry(hallW * 0.62, 2.2, 4), roofMat);
  hallHip.rotation.y = Math.PI / 4;
  hallHip.position.y = hallH + 1.4;
  hallHip.scale.z = (hallD + 0.9) / (hallW + 0.9);
  hallHip.castShadow = true;
  hall.add(hallHip);
  const cupola = box(1.4, 1.4, 1.4, wallMat);
  cupola.position.y = hallH + 2.3;
  hall.add(cupola);
  const cupolaCap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.0, 8), roofMat);
  cupolaCap.position.y = hallH + 3.5;
  cupolaCap.castShadow = true;
  hall.add(cupolaCap);
  // FRONT: a row of portico columns, glazed ticket windows, a central doorway,
  // an awning and the welcome billboard — all facing +Z (the promenade lane).
  for (const cx of [-hallW / 2 + 1.2, -1.8, 1.8, hallW / 2 - 1.2]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 3.2, 12), columnMat);
    col.position.set(cx, 1.6, hallFrontZ + 0.55);
    col.castShadow = true;
    hall.add(col);
  }
  hall.add(makeShopWindows(hallW, hallFrontZ));
  const hallDoor = box(2.4, 3.0, 0.18, doorMat, false);
  hallDoor.position.set(0, 1.5, hallFrontZ + 0.08);
  hall.add(hallDoor);
  hall.add(makeAwning(hallW - 1.2, hallFrontZ, 3.6));
  // Welcome billboard mounted PROUD of the front wall, facing +Z (no rotation →
  // readable, not mirrored). The big mass + roof sit BEHIND it as a real building.
  const welcome = artPanel(7, 2.6, "billboard", {
    title: "SEASIDE PIER", sub: "Boardwalk • Funfair • Fish & Chips",
    a: "#1f6f9c", b: "#0b2a3e", accent: "#ffd24a", glyph: "⚓",
    emissiveIntensity: 0.5, file: "pier-welcome.png",
  });
  welcome.position.set(0, hallH - 0.6, hallFrontZ + 0.12);
  hall.add(welcome);
  group.add(hall);
  addCollider(colliders, hallX, hallZ, hallW, hallD);

  // --- Ferris-wheel silhouette in the back-right corner -------------------
  // Pulled into the corner so its legs clear the pier-hall footprint (which now
  // reaches X≈21) and nothing interpenetrates the building.
  const wheelX = 24, wheelZ = -24;
  const wheel = new THREE.Group();
  wheel.position.set(wheelX, 0, wheelZ);
  // Support A-frame legs.
  for (const sx of [-2.4, 2.4]) {
    const leg = box(0.35, 9, 0.35, steelMat);
    leg.position.set(sx, 4.3, 0);
    leg.rotation.z = sx > 0 ? 0.22 : -0.22;
    wheel.add(leg);
  }
  // The rotating ring with spokes + cabins.
  const ring = new THREE.Group();
  ring.position.y = 8.2;
  const R = 5.2;
  const rimGeo = new THREE.TorusGeometry(R, 0.16, 6, 28);
  const rim = new THREE.Mesh(rimGeo, steelMat);
  rim.castShadow = true;
  ring.add(rim);
  const spokeGeo = new THREE.BoxGeometry(R * 2, 0.08, 0.08);
  const cabinGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const SPOKES = 3;   // crossed spokes read as a full wheel
  const CABINS = 5;
  for (let i = 0; i < SPOKES; i++) {
    const spoke = new THREE.Mesh(spokeGeo, steelMat);
    spoke.rotation.z = (i / SPOKES) * Math.PI;
    ring.add(spoke);
  }
  for (let i = 0; i < CABINS; i++) {
    const a = (i / CABINS) * Math.PI * 2;
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    cabin.userData.angle = a; // for keeping cabins upright
    cabin.castShadow = true;
    ring.add(cabin);
  }
  wheel.add(ring);
  group.add(wheel);
  addCollider(colliders, wheelX, wheelZ, 5, 1.6);

  // --- Mooring buoys floating near the pier (decorative, no collider) ------
  const buoyGeo = new THREE.SphereGeometry(0.5, 10, 8);
  const buoys = [];
  for (const [bx, bz] of [[-6, 6], [7, 12], [10, 22]]) {
    const buoy = new THREE.Mesh(buoyGeo, buoyMat);
    buoy.position.set(bx, 0.25, bz);
    buoy.castShadow = true;
    group.add(buoy);
    buoys.push({ mesh: buoy, phase: bx + bz });
  }

  // --- Coiled rope + a couple of bollards on the deck (flat, walked-over) --
  const bollardGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.6, 10);
  for (const x of [-2, 2]) {
    const bollard = new THREE.Mesh(bollardGeo, ropeMat);
    bollard.position.set(x, 0.85, DECK_Z1 - 3);
    bollard.castShadow = true;
    group.add(bollard);
  }

  // --- Seagulls circling overhead -----------------------------------------
  const gulls = [];
  for (let i = 0; i < 3; i++) {
    const gull = makeSeagull();
    const cx = -8 + i * 6;
    const cz = 4 + i * 4;
    gull.position.set(cx, 7 + i * 0.7, cz);
    group.add(gull);
    gulls.push({ mesh: gull, cx, cz, r: 4 + i, speed: 0.5 + i * 0.15, phase: i * 1.7, baseY: 7 + i * 0.7 });
  }

  // --- Animation state -----------------------------------------------------
  let t = 0;

  function update(dt) {
    t += dt;

    // Water swell: nudge plane-grid vertices with a couple of cross sine waves
    // (taller, slower primary swell + a faster ripple) for a livelier sea.
    for (let i = 0; i < waterPos.count; i++) {
      const x = waterPos.getX(i);
      const y = waterPos.getY(i);
      const h = Math.sin(x * 0.22 + t * 1.3) * 0.16
              + Math.cos(y * 0.3 - t * 0.9) * 0.12
              + Math.sin((x + y) * 0.5 + t * 2.1) * 0.05;
      waterPos.setZ(i, waterBaseY[i] + h);
    }
    waterPos.needsUpdate = true;
    waterGeo.computeVertexNormals(); // crests catch the light → glittery surface

    // Colour shimmer: drift the sea between teal and a brighter sun-glint blue.
    const shimmer = (Math.sin(t * 0.8) + 1) * 0.5; // 0..1
    waterMat.emissiveIntensity = 0.22 + shimmer * 0.22;
    waterMat.color.setRGB(
      0.16 + shimmer * 0.06,
      0.49 + shimmer * 0.08,
      0.64 + shimmer * 0.07,
    );
    // Surf foam breathes in and out with the swell.
    foamMat.opacity = 0.4 + (Math.sin(t * 1.6) + 1) * 0.5 * 0.3;

    // Lighthouse beacon sweep + subtle lamp flicker.
    beacon.rotation.y += dt * 0.9;
    glassMat.emissiveIntensity = 1.2 + Math.sin(t * 6) * 0.25;

    // Ferris wheel turns slowly; keep cabins hanging upright.
    ring.rotation.z += dt * 0.25;
    for (const child of ring.children) {
      if (child.userData.angle !== undefined) child.rotation.z = -ring.rotation.z;
    }

    // Buoys bob on the swell.
    for (const b of buoys) {
      b.mesh.position.y = 0.25 + Math.sin(t * 1.5 + b.phase) * 0.12;
      b.mesh.rotation.z = Math.sin(t * 1.2 + b.phase) * 0.2;
    }

    // Seagulls circle and flap.
    for (const g of gulls) {
      const a = t * g.speed + g.phase;
      g.mesh.position.set(g.cx + Math.cos(a) * g.r, g.baseY + Math.sin(t * 2 + g.phase) * 0.4, g.cz + Math.sin(a) * g.r);
      g.mesh.rotation.y = -a + Math.PI / 2;
      const flap = Math.sin(t * 9 + g.phase) * 0.6;
      g.mesh.userData.wings[0].rotation.x = flap;
      g.mesh.userData.wings[1].rotation.x = -flap;
    }
  }

  // The whole tile top is walkable; structures block via colliders.
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  return { group, colliders, ground, update };
}
