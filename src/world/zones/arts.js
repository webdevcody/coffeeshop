// ARTS DISTRICT — one 60×60 m tile of the expanded city, centred on origin.
//
// Theme: a creative, colourful gallery quarter. Two gallery buildings wear huge
// exterior murals (style "mural", tags "ART" / "CAFE CITY"); a small open-air
// installation of bold abstract sculptures (twisted torus / cone / box stacks)
// fills a plaza; a slowly rotating "kinetic" sculpture and flickering neon give
// the place ambient life. Wide (>= 6 m) paved lanes cross the tile on both axes
// so a car can drive straight through.
//
// buildArts() returns { group, colliders, ground, update } — all LOCAL coords:
//   group     — THREE.Group of every mesh (X,Z ∈ [-30,30], ground at y=0)
//   colliders — AABBs { minX,maxX,minZ,maxZ } for solid props/buildings only
//   ground    — walkable rects; includes the full tile [-30,30]²
//   update(dt)— spins the kinetic sculpture, flickers neon, sways a banner
//
// Coordinates: right-handed, Y up. Lanes: a N–S lane along x≈0 and an E–W lane
// along z≈0, both ~8 m wide and collider-free, meet in the central plaza.

import * as THREE from "three";
import { artPanel, artMaterial } from "../cityArt.js";

// --- Shared materials (created ONCE, reused across props) -------------------
const pavement = new THREE.MeshStandardMaterial({ color: "#b9b2a6", roughness: 0.96 });
const paveSide = new THREE.MeshStandardMaterial({ color: "#8e887d", roughness: 1 });
const plazaMat = new THREE.MeshStandardMaterial({ color: "#c8a36b", roughness: 0.9 });
const galleryWall = new THREE.MeshStandardMaterial({ color: "#efe7d8", roughness: 0.85 });
const galleryWall2 = new THREE.MeshStandardMaterial({ color: "#e3d4c0", roughness: 0.85 });
const cafeWall = new THREE.MeshStandardMaterial({ color: "#d9b894", roughness: 0.85 });        // warm terracotta cafe
const studioWall = new THREE.MeshStandardMaterial({ color: "#c9cdd6", roughness: 0.85 });       // cool grey studio
const roofMat = new THREE.MeshStandardMaterial({ color: "#3b3640", roughness: 0.8 });
const plinthMat = new THREE.MeshStandardMaterial({ color: "#4a4750", roughness: 0.9 });
const planterMat = new THREE.MeshStandardMaterial({ color: "#8a5a36", roughness: 0.9 });
const foliageMat = new THREE.MeshStandardMaterial({ color: "#4f9a55", roughness: 0.9, flatShading: true });
const poleMat = new THREE.MeshStandardMaterial({ color: "#2b2e33", roughness: 0.5, metalness: 0.6 });

// --- Extra shared materials for architectural detail (created ONCE) ---------
const trimMat = new THREE.MeshStandardMaterial({ color: "#cdbfa6", roughness: 0.8 });        // cornice / parapet band
const trimMat2 = new THREE.MeshStandardMaterial({ color: "#b9a888", roughness: 0.82 });
const frameMat = new THREE.MeshStandardMaterial({ color: "#5a5048", roughness: 0.6, metalness: 0.2 }); // window mullions
const glassMat = new THREE.MeshStandardMaterial({                                              // dark display/atrium glass
  color: "#1d3640", roughness: 0.18, metalness: 0.55,
  transparent: true, opacity: 0.62,
});
const litGlassMat = new THREE.MeshStandardMaterial({                                           // warm lit upper windows
  color: "#f6dca0", roughness: 0.35, metalness: 0.0,
  emissive: new THREE.Color("#ffd27a"), emissiveIntensity: 0.55,
  side: THREE.DoubleSide, // single-sided PlaneGeometry panes vanish edge-on / from behind
});
const awningMat = new THREE.MeshStandardMaterial({ color: "#c0392b", roughness: 0.85, flatShading: true });
const awningMat2 = new THREE.MeshStandardMaterial({ color: "#2b7a78", roughness: 0.85, flatShading: true });
const doorMat = new THREE.MeshStandardMaterial({ color: "#3a342f", roughness: 0.5, metalness: 0.25 });
const acMat = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.7, metalness: 0.35, flatShading: true });
const ventMat = new THREE.MeshStandardMaterial({ color: "#6e7378", roughness: 0.75, metalness: 0.3 });
const tankMat = new THREE.MeshStandardMaterial({ color: "#7c5a3a", roughness: 0.85, flatShading: true });
const benchWood = new THREE.MeshStandardMaterial({ color: "#9c6b3f", roughness: 0.85, flatShading: true });
const benchMetal = new THREE.MeshStandardMaterial({ color: "#33373c", roughness: 0.5, metalness: 0.55 });
const bollardMat = new THREE.MeshStandardMaterial({ color: "#2e3236", roughness: 0.5, metalness: 0.5 });
const binMat = new THREE.MeshStandardMaterial({ color: "#3d4b3f", roughness: 0.8, metalness: 0.2 });
const spotHousing = new THREE.MeshStandardMaterial({ color: "#26282b", roughness: 0.45, metalness: 0.65, flatShading: true });
const spotGlow = new THREE.MeshStandardMaterial({
  color: "#fff4d6", roughness: 0.3,
  emissive: new THREE.Color("#fff0c8"), emissiveIntensity: 1.1,
  side: THREE.DoubleSide, // single-sided CircleGeometry lens vanishes edge-on / from behind
});
const flagPoleMat = new THREE.MeshStandardMaterial({ color: "#d8d2c4", roughness: 0.5, metalness: 0.4 });

// Bold sculpture colours (reused MeshStandardMaterials)
const cRed = new THREE.MeshStandardMaterial({ color: "#e2483a", roughness: 0.55, metalness: 0.15, flatShading: true });
const cYellow = new THREE.MeshStandardMaterial({ color: "#f4c93b", roughness: 0.55, metalness: 0.15, flatShading: true });
const cBlue = new THREE.MeshStandardMaterial({ color: "#3b7fd4", roughness: 0.55, metalness: 0.15, flatShading: true });
const cTeal = new THREE.MeshStandardMaterial({ color: "#2bb7a3", roughness: 0.55, metalness: 0.15, flatShading: true });
const cMagenta = new THREE.MeshStandardMaterial({ color: "#d24a96", roughness: 0.55, metalness: 0.15, flatShading: true });
const cPurple = new THREE.MeshStandardMaterial({ color: "#7d54c9", roughness: 0.55, metalness: 0.15, flatShading: true });
const cWhite = new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 0.6, flatShading: true });

// --- Shared geometries (created ONCE) --------------------------------------
const torusGeo = new THREE.TorusGeometry(1.0, 0.34, 10, 20);
const torusKnotGeo = new THREE.TorusKnotGeometry(0.8, 0.26, 64, 10, 2, 3);
const coneGeo = new THREE.ConeGeometry(0.9, 2.2, 6);
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.SphereGeometry(0.7, 14, 12);
const plinthGeo = new THREE.CylinderGeometry(0.85, 1.0, 0.6, 16);
const blobGeo = new THREE.IcosahedronGeometry(0.9, 0);

// Shared unit geometries reused (scaled per instance) for detail props.
const unitBox = new THREE.BoxGeometry(1, 1, 1);              // generic scaled box
const winPaneGeo = new THREE.PlaneGeometry(1.0, 1.4);        // ONE shared window pane (instanced)
const skylightGeo = new THREE.BoxGeometry(2.2, 0.25, 2.2);   // roof skylight glass
const acGeo = new THREE.BoxGeometry(1.4, 0.8, 1.0);
const ventGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.6, 10);
const tankGeo = new THREE.CylinderGeometry(0.85, 0.85, 1.5, 12);
const bollardGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.9, 10);
const binGeo = new THREE.CylinderGeometry(0.32, 0.28, 0.9, 12);
const spotGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.4, 8);
const spotLensGeo = new THREE.CircleGeometry(0.13, 10);

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// Reusable dummy for composing InstancedMesh matrices (NO per-call allocation
// of geometry/material — only Object3D math).
const _dummy = new THREE.Object3D();

// A grid of lit window panes on ONE wall face, as a single InstancedMesh.
// `dir` is the outward unit normal of the face. Panes sit just outside the wall.
// cols×rows panes are laid across `faceW` (local horizontal) × building height.
function addWindowGrid(parent, cx, cy, cz, dir, faceW, cols, rows, y0, ystep) {
  const count = cols * rows;
  const inst = new THREE.InstancedMesh(winPaneGeo, litGlassMat, count);
  inst.castShadow = false;
  inst.receiveShadow = false;
  // Build a basis: tangent (horizontal along face) is perpendicular to dir on XZ.
  const tang = new THREE.Vector3(-dir.z, 0, dir.x);
  const rotY = Math.atan2(dir.x, dir.z); // face the plane along the outward normal
  const colStep = faceW / cols;
  const startU = -faceW / 2 + colStep / 2;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const yy = y0 + r * ystep;
    for (let c = 0; c < cols; c++) {
      const u = startU + c * colStep;
      _dummy.position.set(
        cx + tang.x * u + dir.x * 0.06,
        yy,
        cz + tang.z * u + dir.z * 0.06,
      );
      _dummy.rotation.set(0, rotY, 0);
      _dummy.scale.set(colStep * 0.62, ystep * 0.6, 1);
      _dummy.updateMatrix();
      inst.setMatrixAt(i++, _dummy.matrix);
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  parent.add(inst);
  return inst;
}

// Ground-floor storefront on a wall face: display glass + door + awning + framing.
// dir = outward normal. Visual only (sits flush on the existing footprint).
// doorOffset = tangent offset (m) of the entrance door from the face centre; pass
// 0 to centre the door (e.g. under a centred entrance porch).
function addStorefront(parent, cx, cz, dir, faceW, awning, doorOffset = null) {
  const rotY = Math.atan2(dir.x, dir.z);
  const tang = new THREE.Vector3(-dir.z, 0, dir.x);
  const off = (s) => ({ x: cx + dir.x * 0.07 + tang.x * s, z: cz + dir.z * 0.07 + tang.z * s });

  // big display window band
  const glass = new THREE.Mesh(unitBox, glassMat);
  glass.scale.set(faceW * 0.82, 2.4, 0.12);
  glass.position.set(cx + dir.x * 0.1, 1.6, cz + dir.z * 0.1);
  glass.rotation.y = rotY;
  parent.add(glass);

  // mullion frame around the glass (thin slabs)
  const frameTop = new THREE.Mesh(unitBox, frameMat);
  frameTop.scale.set(faceW * 0.86, 0.18, 0.16);
  frameTop.position.set(cx + dir.x * 0.11, 2.85, cz + dir.z * 0.11);
  frameTop.rotation.y = rotY;
  const frameBot = frameTop.clone();
  frameBot.scale.set(faceW * 0.86, 0.22, 0.16);
  frameBot.position.set(cx + dir.x * 0.11, 0.42, cz + dir.z * 0.11);
  parent.add(frameTop, frameBot);
  // vertical mullions
  for (const s of [-faceW * 0.3, 0, faceW * 0.3]) {
    const mull = new THREE.Mesh(unitBox, frameMat);
    mull.scale.set(0.12, 2.6, 0.16);
    const p = off(s);
    mull.position.set(p.x, 1.6, p.z);
    mull.rotation.y = rotY;
    parent.add(mull);
  }

  // glass entrance door (centred if doorOffset===0, else offset to one side)
  const door = new THREE.Mesh(unitBox, doorMat);
  door.scale.set(1.3, 2.3, 0.14);
  const dp = off(doorOffset ?? faceW * 0.32);
  door.position.set(dp.x + dir.x * 0.05, 1.15, dp.z + dir.z * 0.05);
  door.rotation.y = rotY;
  parent.add(door);

  // sloped awning over the storefront
  const aw = new THREE.Mesh(unitBox, awning);
  aw.scale.set(faceW * 0.9, 0.14, 1.1);
  aw.position.set(cx + dir.x * 0.55, 3.05, cz + dir.z * 0.55);
  aw.rotation.set(dir.z * 0.32, rotY, dir.x * 0.32);
  aw.castShadow = true;
  parent.add(aw);
}

// A full-volume corner building (real width x depth x height) with a cornice,
// flat roof, rooftop clutter, a storefront on its primary face, a shop sign
// mounted over the storefront (FRONT faces `dir`, never mirrored), and lit window
// grids on the upper floor of the two side/back faces. Registers a footprint
// collider sized to the wall (+ a small skin for the storefront depth).
//
//   dir  — outward unit normal of the PRIMARY (storefront) face, toward a lane.
//   side — outward unit normal of a SECONDARY face that also fronts a lane; gets
//          its own slim mural-free window band + an accent door. Pass null to skip.
// Returns nothing; everything is added to `parent`, collider pushed to `colliders`.
function addShopBuilding(parent, colliders, cfg) {
  const { cx, cz, w, d, h, wall, trim, awning, dir, side = null, sign } = cfg;

  // main solid mass — substantial on ALL three axes, reads solid from every angle
  const body = box(w, h, d, wall);
  body.position.set(cx, h / 2, cz);
  parent.add(body);

  // flat roof slab + cornice/parapet + rooftop clutter
  const roof = box(w + 0.5, 0.5, d + 0.5, roofMat);
  roof.position.set(cx, h + 0.25, cz);
  parent.add(roof);
  addCornice(parent, cx, cz, w, d, h, trim);
  addRoofClutter(parent, cx, cz, h + 0.5, w, d);

  // string-course band between the ground floor and upper floor (depth on facade)
  const course = box(w + 0.3, 0.4, d + 0.3, trim);
  course.position.set(cx, 3.3, cz);
  parent.add(course);

  // Primary storefront face (toward the avenue/plaza). faceW spans the wall edge
  // perpendicular to `dir`: if dir is along Z the storefront width is `w`, else `d`.
  const primW = Math.abs(dir.x) > 0.5 ? d : w;
  const fcx = cx + dir.x * (Math.abs(dir.x) > 0.5 ? w / 2 : 0);
  const fcz = cz + dir.z * (Math.abs(dir.z) > 0.5 ? d / 2 : 0);
  addStorefront(parent, fcx, fcz, dir, primW, awning, 0);

  // Shop SIGN mounted on the string-course over the storefront. artPanel("sign")
  // is double-sided; we orient its FRONT outward along `dir` so text reads
  // correctly from the street (rotY = atan2(dir.x,dir.z)) — never mirrored.
  const rotY = Math.atan2(dir.x, dir.z);
  const signPanel = artPanel(Math.min(primW * 0.7, 6.4), 1.5, "sign", {
    text: sign.text, bg: sign.bg, fg: sign.fg || "#ffffff",
    emissiveIntensity: 0.5, file: sign.file,
  });
  // Mounted on the facade ABOVE the awning (awning tops ~y3.1), below the cornice.
  signPanel.position.set(fcx + dir.x * 0.18, 4.15, fcz + dir.z * 0.18);
  signPanel.rotation.y = rotY;
  parent.add(signPanel);

  // Secondary lane face: a slim storefront so the building reads "active" on its
  // other street frontage too (still one coherent mass, sits flush on the wall).
  if (side) {
    const secW = Math.abs(side.x) > 0.5 ? d : w;
    const scx = cx + side.x * (Math.abs(side.x) > 0.5 ? w / 2 : 0);
    const scz = cz + side.z * (Math.abs(side.z) > 0.5 ? d / 2 : 0);
    addStorefront(parent, scx, scz, side, secW, awning, secW * 0.3);
  }

  // Lit instanced window grids on the upper floor of the remaining (back) faces,
  // so the building has detail from behind too (NOT a one-sided facade).
  const backDir = new THREE.Vector3(-dir.x, 0, -dir.z);
  const backW = Math.abs(backDir.x) > 0.5 ? d : w;
  const bcx = cx + backDir.x * (Math.abs(backDir.x) > 0.5 ? w / 2 : 0);
  const bcz = cz + backDir.z * (Math.abs(backDir.z) > 0.5 ? d / 2 : 0);
  addWindowGrid(parent, bcx, 0, bcz, backDir, backW * 0.78, 4, 2, 4.4, 2.2);
  if (!side) {
    // if there is no secondary storefront, also dress that side face with windows
    const sd = new THREE.Vector3(-dir.z, 0, dir.x); // perpendicular to dir
    const sdW = Math.abs(sd.x) > 0.5 ? d : w;
    const sdcx = cx + sd.x * (Math.abs(sd.x) > 0.5 ? w / 2 : 0);
    const sdcz = cz + sd.z * (Math.abs(sd.z) > 0.5 ? d / 2 : 0);
    addWindowGrid(parent, sdcx, 0, sdcz, sd, sdW * 0.72, 3, 2, 4.4, 2.2);
  }

  // Footprint collider tight to the wall + a thin storefront skin.
  addCollider(colliders, cx, cz, w + 0.4, d + 0.4);
}

// Cornice / parapet trim band wrapping the top of a rectangular footprint.
function addCornice(parent, cx, cz, w, d, topY, mat) {
  const band = new THREE.Mesh(unitBox, mat);
  band.scale.set(w + 0.9, 0.5, d + 0.9);
  band.position.set(cx, topY + 0.25, cz);
  band.castShadow = true;
  parent.add(band);
  // raised parapet rim just inside the cornice
  const rim = new THREE.Mesh(unitBox, mat);
  rim.scale.set(w + 0.2, 0.55, d + 0.2);
  rim.position.set(cx, topY + 0.75, cz);
  parent.add(rim);
  // hollow it visually with a darker inset roof deck handled by caller's roof box
}

// Rooftop clutter: AC units, a vent, a water tank, an antenna + a skylight.
function addRoofClutter(parent, cx, cz, topY, w, d) {
  const ac1 = new THREE.Mesh(acGeo, acMat);
  ac1.position.set(cx - w * 0.25, topY + 0.4, cz - d * 0.2);
  ac1.castShadow = true;
  const ac2 = new THREE.Mesh(acGeo, acMat);
  ac2.position.set(cx - w * 0.05, topY + 0.4, cz - d * 0.25);
  ac2.rotation.y = 0.4;
  ac2.castShadow = true;
  const vent = new THREE.Mesh(ventGeo, ventMat);
  vent.position.set(cx + w * 0.28, topY + 0.3, cz + d * 0.1);
  vent.castShadow = true;
  const tank = new THREE.Mesh(tankGeo, tankMat);
  tank.position.set(cx + w * 0.2, topY + 0.75, cz - d * 0.28);
  tank.castShadow = true;
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 2.4, 6), poleMat);
  antenna.position.set(cx - w * 0.3, topY + 1.2, cz + d * 0.3);
  antenna.castShadow = true;
  // roof skylight (glass)
  const sky = new THREE.Mesh(skylightGeo, glassMat);
  sky.position.set(cx + w * 0.02, topY + 0.12, cz + d * 0.28);
  parent.add(ac1, ac2, vent, tank, antenna, sky);
}

// Plaza bench: two wood slabs on metal legs. Returns a positioned Group.
function makeBench(x, z, ry) {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(unitBox, benchWood);
  seat.scale.set(2.0, 0.12, 0.55);
  seat.position.y = 0.5;
  seat.castShadow = true;
  const back = new THREE.Mesh(unitBox, benchWood);
  back.scale.set(2.0, 0.45, 0.1);
  back.position.set(0, 0.78, -0.22);
  back.castShadow = true;
  for (const lx of [-0.85, 0.85]) {
    const leg = new THREE.Mesh(unitBox, benchMetal);
    leg.scale.set(0.1, 0.5, 0.5);
    leg.position.set(lx, 0.25, 0);
    g.add(leg);
  }
  g.add(seat, back);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  return g;
}

// Wall-mounted spotlight aimed up at a mural: housing + glowing lens.
function makeSpotlight(x, y, z, ry) {
  const g = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.y = 0;
  const head = new THREE.Mesh(spotGeo, spotHousing);
  head.position.set(0.4, 0.05, 0);
  head.rotation.z = -0.9; // tilt the can upward
  head.castShadow = true;
  const lens = new THREE.Mesh(spotLensGeo, spotGlow);
  lens.position.set(0.52, 0.18, 0);
  lens.rotation.set(0, Math.PI / 2, -0.9);
  g.add(arm, head, lens);
  g.position.set(x, y, z);
  g.rotation.y = ry;
  return g;
}

// A plinth + abstract sculpture on top. `kind` picks the bold form.
function makeSculpture(kind) {
  const g = new THREE.Group();
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.position.y = 0.3;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  g.add(plinth);

  if (kind === "torus") {
    const t = new THREE.Mesh(torusGeo, cRed);
    t.position.y = 1.7;
    t.rotation.set(0.5, 0.3, 0);
    t.castShadow = true;
    const t2 = new THREE.Mesh(torusGeo, cBlue);
    t2.scale.setScalar(0.7);
    t2.position.y = 2.6;
    t2.rotation.set(1.2, 0.8, 0.4);
    t2.castShadow = true;
    g.add(t, t2);
  } else if (kind === "cone") {
    const c = new THREE.Mesh(coneGeo, cYellow);
    c.position.y = 1.7;
    c.castShadow = true;
    const c2 = new THREE.Mesh(coneGeo, cMagenta);
    c2.scale.setScalar(0.6);
    c2.position.y = 3.1;
    c2.rotation.z = Math.PI; // inverted cone balanced on top
    c2.castShadow = true;
    g.add(c, c2);
  } else if (kind === "stack") {
    const b1 = new THREE.Mesh(cubeGeo, cTeal);
    b1.scale.set(1.3, 1.3, 1.3);
    b1.position.y = 1.25;
    b1.rotation.y = 0.4;
    b1.castShadow = true;
    const b2 = new THREE.Mesh(cubeGeo, cPurple);
    b2.scale.set(1.0, 1.0, 1.0);
    b2.position.y = 2.4;
    b2.rotation.y = -0.5;
    b2.castShadow = true;
    const b3 = new THREE.Mesh(cubeGeo, cYellow);
    b3.scale.set(0.7, 0.7, 0.7);
    b3.position.y = 3.2;
    b3.rotation.y = 0.9;
    b3.castShadow = true;
    g.add(b1, b2, b3);
  } else if (kind === "sphere") {
    const s = new THREE.Mesh(sphereGeo, cMagenta);
    s.scale.setScalar(1.3);
    s.position.y = 1.7;
    s.castShadow = true;
    const ring = new THREE.Mesh(torusGeo, cWhite);
    ring.scale.setScalar(1.25);
    ring.position.y = 1.7;
    ring.rotation.x = Math.PI / 2.4;
    ring.castShadow = true;
    g.add(s, ring);
  } else { // "blob"
    const bl = new THREE.Mesh(blobGeo, cBlue);
    bl.scale.setScalar(1.2);
    bl.position.y = 1.7;
    bl.castShadow = true;
    const bl2 = new THREE.Mesh(blobGeo, cRed);
    bl2.scale.setScalar(0.7);
    bl2.position.y = 2.7;
    bl2.rotation.set(0.6, 0.3, 0.2);
    bl2.castShadow = true;
    g.add(bl, bl2);
  }
  return g;
}

function makePlanterTree(x, z) {
  const g = new THREE.Group();
  const pl = box(1.2, 0.5, 1.2, planterMat);
  pl.position.y = 0.25;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.0, 6), planterMat);
  trunk.position.y = 1.0;
  trunk.castShadow = true;
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), foliageMat);
  crown.position.y = 1.9;
  crown.castShadow = true;
  g.add(pl, trunk, crown);
  g.position.set(x, 0, z);
  return g;
}

export function buildArts() {
  const group = new THREE.Group();
  const colliders = [];

  // --- Ground slabs --------------------------------------------------------
  // Base pavement covering the whole tile.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(60, 0.4, 60), pavement);
  slab.position.y = -0.2;
  slab.receiveShadow = true;
  group.add(slab);
  // thin side skirt for depth
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(60.2, 0.42, 60.2), paveSide);
  skirt.position.y = -0.42;
  skirt.receiveShadow = true;
  group.add(skirt);

  // Warm sandy plaza disc in the centre (decorative, walkable — NO collider).
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 0.06, 40), plazaMat);
  plaza.position.set(0, 0.03, 0);
  plaza.receiveShadow = true;
  group.add(plaza);

  // --- Gallery buildings (with big exterior murals) ------------------------
  // Two galleries placed in opposite corners so the lanes stay open.
  // Gallery A — back-left corner. Footprint 15 x 11, faces +Z and +X lanes.
  // Pulled inward (gx,gz) so wall edges land at -22 on the tile-edge sides,
  // clearing the seam road + sidewalk (everything stays within local +-23).
  {
    const gx = -14.5, gz = -16.5, w = 15, d = 11, h = 9;
    const b = box(w, h, d, galleryWall);
    b.position.set(gx, h / 2, gz);
    group.add(b);
    const roof = box(w + 0.6, 0.6, d + 0.6, roofMat);
    roof.position.set(gx, h + 0.3, gz);
    group.add(roof);
    addCollider(colliders, gx, gz, w + 0.4, d + 0.4);

    // Cornice / parapet trim wrapping the top, + rooftop clutter & skylights.
    addCornice(group, gx, gz, w, d, h, trimMat);
    addRoofClutter(group, gx, gz, h + 0.6, w, d);

    // Mural on the +Z face (faces the central plaza / E–W lane).
    const muralZ = artPanel(13, 7, "mural", {
      tag: "ART", tagColor: "#37e0c2",
      sky: ["#3a1f5d", "#e0568a", "#f4a04b"],
      emissiveIntensity: 0.45, file: "arts-mural-art.png",
    });
    muralZ.position.set(gx, 4.4, gz + d / 2 + 0.05);
    group.add(muralZ);

    // Mural on the +X face (faces the N–S lane).
    const muralX = artPanel(10, 7, "mural", {
      tag: "CAFE CITY", tagColor: "#ffd24a",
      sky: ["#1f3f5d", "#2bb7a3", "#f4e04b"],
      emissiveIntensity: 0.45, file: "arts-mural-cafecity.png",
    });
    muralX.rotation.y = Math.PI / 2;
    muralX.position.set(gx + w / 2 + 0.05, 4.4, gz);
    group.add(muralX);

    // Framed exterior artworks flanking the mural on the +Z (plaza) face.
    const artL = artPanel(2.4, 3.0, "poster", {
      top: "STILL", bottom: "LIFE", foot: "GALLERY A", glyph: "❖",
      accent: "#2b7a78", bg: "#f1e8d4", emissiveIntensity: 0.3, file: "arts-frame-a1.png",
    });
    artL.position.set(gx - 6.4, 4.2, gz + d / 2 + 0.06);
    const artR = artL.clone();
    artR.material = artMaterial("poster", {
      top: "ABSTRACT", bottom: "No.7", foot: "GALLERY A", glyph: "◐",
      accent: "#c0392b", bg: "#efe6d2", emissiveIntensity: 0.3, file: "arts-frame-a2.png",
    });
    artR.material.side = THREE.DoubleSide;
    artR.position.set(gx + 6.4, 4.2, gz + d / 2 + 0.06);
    // thin frame surrounds
    for (const a of [artL, artR]) {
      const fr = new THREE.Mesh(unitBox, frameMat);
      fr.scale.set(2.7, 3.3, 0.12);
      fr.position.copy(a.position);
      fr.position.z -= 0.04;
      group.add(fr, a);
    }

    // Glass storefront band on the +Z (plaza) face, with the door centred so the
    // entrance porch lines up over it.
    addStorefront(group, gx, gz + d / 2, new THREE.Vector3(0, 0, 1), w, awningMat, 0);
    // Centred glass entrance porch projecting cleanly from the wall. Kept narrow
    // (3.6 m) and short (top y≈2.8) so it sits BELOW the awning and does not bury
    // the flanking display windows — one coherent vestibule, no overlap.
    const porchW = 3.6, porchDepth = 1.0;
    const porchFront = gz + d / 2 + porchDepth; // front plane of the porch
    // two glass side walls of the porch (tucked under the cap at y≈2.5)
    for (const sx of [-porchW / 2, porchW / 2]) {
      const side = new THREE.Mesh(unitBox, glassMat);
      side.scale.set(0.12, 2.4, porchDepth);
      side.position.set(gx + sx, 1.25, gz + d / 2 + porchDepth / 2);
      group.add(side);
    }
    // glass front of the porch (above the doorway)
    const porchGlass = new THREE.Mesh(unitBox, glassMat);
    porchGlass.scale.set(porchW, 1.1, 0.12);
    porchGlass.position.set(gx, 1.95, porchFront);
    group.add(porchGlass);
    // solid framed lintel capping the porch (flat roof of the vestibule)
    const porchCap = new THREE.Mesh(unitBox, frameMat);
    porchCap.scale.set(porchW + 0.3, 0.22, porchDepth + 0.2);
    porchCap.position.set(gx, 2.62, gz + d / 2 + porchDepth / 2);
    porchCap.castShadow = true;
    group.add(porchCap);

    // Lit instanced window grids on the upper floor of the back faces (-Z, -X)
    // which front no mural — keeps the plaza faces clean for the art.
    addWindowGrid(group, gx, 0, gz - d / 2, new THREE.Vector3(0, 0, -1), w * 0.78, 5, 2, 4.0, 2.4);
    addWindowGrid(group, gx - w / 2, 0, gz, new THREE.Vector3(-1, 0, 0), d * 0.7, 3, 2, 4.0, 2.4);

    // Spotlights washing the plaza mural from above.
    group.add(makeSpotlight(gx - 4.5, 7.6, gz + d / 2 + 0.2, 0));
    group.add(makeSpotlight(gx + 4.5, 7.6, gz + d / 2 + 0.2, 0));
  }

  // Gallery B — front-right corner. Footprint 14 x 11, faces -Z and -X lanes.
  // Pulled inward so wall edges land at +22 on the tile-edge sides, clearing
  // the seam road + sidewalk (footprint + collider stay within local +-23).
  {
    const gx = 15, gz = 16.5, w = 14, d = 11, h = 8;
    const b = box(w, h, d, galleryWall2);
    b.position.set(gx, h / 2, gz);
    group.add(b);
    const roof = box(w + 0.6, 0.6, d + 0.6, roofMat);
    roof.position.set(gx, h + 0.3, gz);
    group.add(roof);
    addCollider(colliders, gx, gz, w + 0.4, d + 0.4);

    // Cornice / parapet + rooftop clutter & skylights.
    addCornice(group, gx, gz, w, d, h, trimMat2);
    addRoofClutter(group, gx, gz, h + 0.6, w, d);

    // Mural on the -Z face (faces plaza).
    const muralZ = artPanel(11, 6.4, "mural", {
      tag: "ART", tagColor: "#ff7ad1",
      sky: ["#23204f", "#7d54c9", "#f4a04b"],
      emissiveIntensity: 0.45, file: "arts-mural-art2.png",
    });
    muralZ.rotation.y = Math.PI;
    muralZ.position.set(gx, 4.2, gz - d / 2 - 0.05);
    group.add(muralZ);

    // Mural on the -X face (faces N–S lane).
    const muralX = artPanel(9, 6.4, "mural", {
      tag: "CAFE CITY", tagColor: "#37e0c2",
      sky: ["#3a1f5d", "#e2483a", "#f4c93b"],
      emissiveIntensity: 0.45, file: "arts-mural-cafecity2.png",
    });
    muralX.rotation.y = -Math.PI / 2;
    muralX.position.set(gx - w / 2 - 0.05, 4.2, gz);
    group.add(muralX);

    // Framed exterior artwork beside the plaza mural (-Z face).
    const frame = artPanel(2.2, 2.8, "poster", {
      top: "PORTRAIT", bottom: "SERIES", foot: "GALLERY B", glyph: "◑",
      accent: "#7d54c9", bg: "#efe6d2", emissiveIntensity: 0.3, file: "arts-frame-b1.png",
    });
    frame.rotation.y = Math.PI;
    frame.position.set(gx - 5.6, 4.0, gz - d / 2 - 0.06);
    const fr = new THREE.Mesh(unitBox, frameMat);
    fr.scale.set(2.5, 3.1, 0.12);
    fr.position.set(gx - 5.6, 4.0, gz - d / 2 - 0.02);
    group.add(fr, frame);

    // Storefront band + entrance on the -Z (plaza) face.
    addStorefront(group, gx, gz - d / 2, new THREE.Vector3(0, 0, -1), w, awningMat2);

    // Lit instanced windows on the clean back faces (+Z, +X).
    addWindowGrid(group, gx, 0, gz + d / 2, new THREE.Vector3(0, 0, 1), w * 0.74, 4, 2, 3.6, 2.3);
    addWindowGrid(group, gx + w / 2, 0, gz, new THREE.Vector3(1, 0, 0), d * 0.7, 3, 2, 3.6, 2.3);

    // Spotlights washing the plaza mural.
    group.add(makeSpotlight(gx - 4, 6.8, gz - d / 2 - 0.2, Math.PI));
    group.add(makeSpotlight(gx + 4, 6.8, gz - d / 2 - 0.2, Math.PI));
  }

  // --- Cafe building — front-right corner (+x,-z), a FULL VOLUME (15x12x7.5) ---
  // Storefront FRONT faces the plaza (+Z, along the E-W lane); a second active
  // frontage faces the N-S lane (-X). Real depth + height, not a facade card.
  // Pulled inward (cx 19.5->14.5, cz -19.5->-16) so the +X wall edge lands at
  // +22 and the -Z wall edge at -22, clearing the seam road (within local +-23).
  addShopBuilding(group, colliders, {
    cx: 14.5, cz: -16, w: 15, d: 12, h: 7.5,
    wall: cafeWall, trim: trimMat2, awning: awningMat2,
    dir: new THREE.Vector3(0, 0, 1),    // primary face +Z -> E-W lane / plaza
    side: new THREE.Vector3(-1, 0, 0),  // secondary face -X -> N-S lane / plaza
    sign: { text: "CAFE CITY", bg: "#2b7a78", fg: "#f6efe0", file: "arts-shop-cafe.png" },
  });

  // --- Studio / print shop — back-left corner (-x,+z), FULL VOLUME (15x12x7.5) -
  // Storefront FRONT faces the plaza (-Z); second frontage faces the N-S lane (+X).
  // Pulled inward (cx -19.5->-14.5, cz 19.5->16) so the -X wall edge lands at -22
  // and the +Z wall edge at +22, clearing the seam road (within local +-23).
  addShopBuilding(group, colliders, {
    cx: -14.5, cz: 16, w: 15, d: 12, h: 7.5,
    wall: studioWall, trim: trimMat, awning: awningMat,
    dir: new THREE.Vector3(0, 0, -1),   // primary face -Z -> E-W lane / plaza
    side: new THREE.Vector3(1, 0, 0),   // secondary face +X -> N-S lane / plaza
    sign: { text: "ART STUDIO", bg: "#c0392b", fg: "#f6efe0", file: "arts-shop-studio.png" },
  });

  // --- Banner flags on a row of slim poles flanking the plaza approach ------
  // Placed in the open corner quadrants, clear of BOTH through-lanes
  // (|x| and |z| both well over the ~4 m lane half-width). Tiny colliders.
  const flagSwayers = [];
  // The flags line the plaza-facing frontage of the Cafe / Studio buildings,
  // clear of BOTH footprints (the pulled-in colliders front at |z|≈9.8) AND the
  // through-lanes (|x|,|z| > ~4.5). Set at |z|=8.5 so they sit in the open band
  // between each building's plaza face and the central lanes.
  const flagSpots = [
    { x: 10, z: -8.5, c1: "#e2483a", c2: "#f4efe0", top: "ART", bottom: "FEST" },
    { x: 6, z: -8.5, c1: "#3b7fd4", c2: "#f4efe0", top: "OPEN", bottom: "DAILY" },
    { x: -10, z: 8.5, c1: "#2bb7a3", c2: "#f4efe0", top: "CAFE", bottom: "CITY" },
    { x: -6, z: 8.5, c1: "#d24a96", c2: "#f4efe0", top: "NEW", bottom: "SHOW" },
  ];
  for (let i = 0; i < flagSpots.length; i++) {
    const f = flagSpots[i];
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6.0, 8), flagPoleMat);
    pole.position.set(f.x, 3.0, f.z);
    pole.castShadow = true;
    group.add(pole);
    const flag = artPanel(2.0, 1.2, "poster", {
      top: f.top, bottom: f.bottom, accent: f.c1, bg: f.c2,
      emissiveIntensity: 0.32, file: `arts-flag-${i}.png`,
    });
    // pivot at the pole so it swings like a hanging banner
    const pivot = new THREE.Group();
    pivot.position.set(f.x, 5.3, f.z);
    flag.position.set(f.x < 0 ? -1.0 : 1.0, 0, 0);
    pivot.add(flag);
    group.add(pivot);
    flagSwayers.push({ pivot, phase: i * 1.3 });
    addCollider(colliders, f.x, f.z, 0.4, 0.4);
  }

  // --- Open-air installation: ring of bold abstract sculptures -------------
  // Arranged around the plaza, all well clear of the central lanes.
  const sculptSpots = [
    { x: -7, z: -7, kind: "torus", r: 1.1 },
    { x: 7, z: -7, kind: "cone", r: 1.0 },
    { x: -7, z: 7, kind: "stack", r: 1.4 },
    { x: 7, z: 7, kind: "sphere", r: 1.3 },
    { x: -10, z: 6, kind: "blob", r: 1.1 },   // pulled off the E-W lane (z=0)
    { x: 10, z: -6, kind: "cone", r: 1.0 },   // pulled off the E-W lane (z=0)
  ];
  for (const s of sculptSpots) {
    const m = makeSculpture(s.kind);
    m.position.set(s.x, 0, s.z);
    m.rotation.y = (s.x + s.z) * 0.3;
    group.add(m);
    addCollider(colliders, s.x, s.z, s.r * 2, s.r * 2);
  }

  // --- Central kinetic sculpture (animated) --------------------------------
  // A twisted torus-knot on a tall plinth — slowly rotates in update().
  const kinetic = new THREE.Group();
  const kPlinth = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.95, 1.6, 16), plinthMat);
  kPlinth.position.y = 0.8;
  kPlinth.castShadow = true;
  kPlinth.receiveShadow = true;
  const kKnot = new THREE.Mesh(torusKnotGeo, cMagenta);
  kKnot.position.y = 3.0;
  kKnot.scale.setScalar(1.4);
  kKnot.castShadow = true;
  const kRing = new THREE.Mesh(torusGeo, cYellow);
  kRing.position.y = 3.0;
  kRing.scale.setScalar(1.8);
  kRing.rotation.x = Math.PI / 2;
  kRing.castShadow = true;
  kinetic.add(kPlinth, kKnot, kRing);
  group.add(kinetic);
  addCollider(colliders, 0, 0, 2.2, 2.2);

  // --- Welcome billboard + neon (glow) at a plaza edge ---------------------
  // Billboard on a post on the plaza rim (off the lanes AND clear of the corner
  // buildings' frontages), facing in toward the plaza centre.
  const bbPost = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.2, 8), poleMat);
  bbPost.position.set(13, 2.1, -7);
  bbPost.castShadow = true;
  group.add(bbPost);
  const billboard = artPanel(6, 3.2, "billboard", {
    title: "ARTS QUARTER", sub: "CAFE CITY GALLERIES",
    a: "#3a1f5d", b: "#0c1830", accent: "#f4c93b", glyph: "✺",
    emissiveIntensity: 0.5, file: "arts-billboard.png",
  });
  billboard.position.set(13, 5.4, -7);
  billboard.rotation.y = -Math.PI * 0.62; // front faces the plaza centre
  group.add(billboard);

  // Flickering neon "GALLERY" sign on the opposite plaza rim.
  const neonPost = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.4, 8), poleMat);
  neonPost.position.set(-13, 1.7, 7);
  neonPost.castShadow = true;
  group.add(neonPost);
  const neon = artPanel(3.2, 3.2, "neon", {
    lines: ["OPEN", "GALLERY"], color: "#ff4fa3", color2: "#4fd2ff",
    emissiveIntensity: 0.9, file: "arts-neon.png",
  });
  neon.position.set(-13, 4.4, 7);
  neon.rotation.y = Math.PI * 0.38; // front faces the plaza centre
  group.add(neon);

  // Swaying banner near plaza entrance (animated, no collider — thin/high).
  const banner = artPanel(1.6, 3.4, "poster", {
    top: "ART", bottom: "WALK", foot: "CAFE CITY", glyph: "✦",
    accent: "#e2483a", bg: "#f4efe0", emissiveIntensity: 0.4, file: "arts-banner.png",
  });
  const bannerArm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.4, 8), poleMat);
  bannerArm.position.set(0, 2.2, 13.5);
  bannerArm.castShadow = true;
  group.add(bannerArm);
  banner.position.set(0, 3.4, 13.5);
  group.add(banner);

  // --- Planter trees softening the corners (decorative, small colliders) ---
  // Placed to FLANK the lane mouths (not block them): pulled off both the N-S
  // (x=0) and E-W (z=0) centrelines, and clear of every building footprint.
  const treeSpots = [
    [5.5, 27], [-5.5, -27],   // flank the N-S lane mouths
    [27, 5.5], [-27, -5.5],   // flank the E-W lane mouths
  ];
  for (const [tx, tz] of treeSpots) {
    const t = makePlanterTree(tx, tz);
    group.add(t);
    addCollider(colliders, tx, tz, 1.3, 1.3);
  }

  // --- Bench seating ringing the plaza (decorative; thin, low — no colliders) -
  // Placed on the plaza rim, all clear of the central N–S / E–W lanes.
  const benchSpots = [
    { x: -9.5, z: -4, ry: Math.PI / 2 },
    { x: -9.5, z: 4, ry: Math.PI / 2 },
    { x: 9.5, z: -4, ry: -Math.PI / 2 },
    { x: 9.5, z: 4, ry: -Math.PI / 2 },
    { x: -4, z: 9.5, ry: Math.PI },
    { x: 4, z: 9.5, ry: Math.PI },
    { x: -4, z: -9.5, ry: 0 },
    { x: 4, z: -9.5, ry: 0 },
  ];
  for (const bs of benchSpots) group.add(makeBench(bs.x, bs.z, bs.ry));

  // --- Bollards lining the plaza disc edge (instanced, single draw call) -----
  const bollardN = 16;
  const bollards = new THREE.InstancedMesh(bollardGeo, bollardMat, bollardN);
  bollards.castShadow = true;
  for (let i = 0; i < bollardN; i++) {
    const a = (i / bollardN) * Math.PI * 2;
    // skip bollards that would block the lane mouths (near the +/- axes)
    const nearAxis = Math.min(
      Math.abs(Math.cos(a)), Math.abs(Math.sin(a)),
    ) < 0.18;
    _dummy.position.set(Math.sin(a) * 12.5, 0.45, Math.cos(a) * 12.5);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, nearAxis ? 0.001 : 1, 1); // collapse hidden ones
    _dummy.updateMatrix();
    bollards.setMatrixAt(i, _dummy.matrix);
  }
  bollards.instanceMatrix.needsUpdate = true;
  group.add(bollards);

  // --- Litter bins as street dressing near the gallery entrances -----------
  for (const [bx, bz] of [[-13, -9], [13, 9]]) {
    const bin = new THREE.Mesh(binGeo, binMat);
    bin.position.set(bx, 0.45, bz);
    bin.castShadow = true;
    group.add(bin);
  }

  // Mark large faces / props for shadows where useful.
  group.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.type === "BoxGeometry") o.castShadow = o.castShadow ?? true;
  });

  // --- Ground (full tile is walkable) --------------------------------------
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  // --- Ambient animation ---------------------------------------------------
  let t = 0;
  const neonMat = neon.material;     // flicker emissiveIntensity
  const baseNeon = 0.9;
  const update = (dt) => {
    t += dt;
    // Kinetic sculpture: slow spin + counter-spin ring.
    kKnot.rotation.y += dt * 0.6;
    kKnot.rotation.x += dt * 0.25;
    kRing.rotation.z += dt * 0.4;
    // Neon flicker.
    neonMat.emissiveIntensity = baseNeon + Math.sin(t * 9) * 0.12 + Math.sin(t * 23) * 0.06;
    // Banner sway.
    banner.rotation.y = Math.sin(t * 0.8) * 0.18;
    // Flag banners swing on their pivots (reuse existing objects, no alloc).
    for (let i = 0; i < flagSwayers.length; i++) {
      const fs = flagSwayers[i];
      fs.pivot.rotation.y = Math.sin(t * 1.1 + fs.phase) * 0.22;
    }
  };

  return { group, colliders, ground, update };
}
