// Faithful vanilla-JS (ESM) port of the original TypeScript `warship.ts`.
//
// This reproduces the EXACT detailed warship geometry the original renderer
// built — per-class hulls (ExtrudeGeometry / LatheGeometry), decks, tapered
// superstructure deckhouses, main/secondary/gun turrets with barrels, funnels,
// the carrier flight deck + island + parked jets, the submarine teardrop lathe
// hull + faired sail + dive planes, masts, phased-array SPY panels, CIWS domes,
// VLS cells, radar dishes — together with the original procedural albedo/normal/
// roughness textures and the bold per-class liveries. NOTHING is simplified or
// substituted with a box approximation; the only changes from the .ts source are
// TypeScript-only artefacts (type annotations) which have no runtime effect.
//
// The original authored everything at its console CELL = 10 (layout.ts). We build
// at that same CELL so all the geometry math is byte-identical to the original,
// then SCALE the whole Group by (cell / ORIGINAL_CELL) so the ship spans `length`
// in-world cells of the caller's `cell` size. Horizontal ships lie along +X,
// centred at the origin; the caller rotates for vertical placement.

import * as THREE from "three";
import {
  makeDeckAlbedo,
  makeFlightDeck,
  makeHullAlbedo,
  makeMetalRough,
  panelNormal,
} from "./shipTextures.js";

// Original console CELL (src/scene/layout.ts). The whole ship is authored at this
// scale and then uniformly scaled to the caller's in-world cell size.
const CELL = 10;
const ORIGINAL_CELL = CELL;

// Bold, game-style per-class liveries — distinct so the fleet reads as colourful
// and you can tell classes apart. Deep jewel tones, not neon.
const CARRIER_PAINT = { hull: 0x21407a, deck: 0x2c3138, accent: "#e8b021" }; // navy blue
const BATTLESHIP_PAINT = { hull: 0x7d2f2f, deck: 0x6a4a28, accent: "#101010" }; // crimson, teak deck
const CRUISER_PAINT = { hull: 0x1d6f79, deck: 0x223842, accent: "#0c1316" }; // teal
const SUB = { hull: 0x161a1e, deck: 0x202428, accent: "#0a0c0e" }; // near-black
const DESTROYER_PAINT = { hull: 0x394f9c, deck: 0x222b3a, accent: "#0d1322" }; // indigo steel
const NAVY = CARRIER_PAINT; // legacy default

const HULL_NUM = {
  carrier: "72",
  battleship: "61",
  cruiser: "52",
  submarine: "21",
  destroyer: "51",
};

const norm = panelNormal();
const roughMap = makeMetalRough();

function hullMat(paint, hullNumber, seed) {
  const rough = roughMap.clone();
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.repeat.set(6, 1); // tile along the long hull; avoids stretched blotches
  rough.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    map: makeHullAlbedo(paint, hullNumber, seed),
    normalMap: norm,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughnessMap: rough,
    metalnessMap: rough,
    metalness: 0.1, // matte painted steel — low so the colour reads, not chrome
    roughness: 0.82,
    envMapIntensity: 0.45,
  });
}
function deckMat(paint, helo = false) {
  return new THREE.MeshStandardMaterial({
    map: makeDeckAlbedo(paint, { helo }),
    metalness: 0.3,
    roughness: 0.85,
    envMapIntensity: 0.7,
  });
}
// Painted (matte) accent material; low metalness/env so colour dominates.
const gray = (color, roughness = 0.65, metalness = 0.18) =>
  new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    normalMap: norm,
    normalScale: new THREE.Vector2(0.25, 0.25),
    envMapIntensity: 0.45,
  });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1418, metalness: 0.1, roughness: 0.08, envMapIntensity: 1.6 });
const blackMat = new THREE.MeshStandardMaterial({ color: 0x14181b, metalness: 0.4, roughness: 0.5 });
const radarMat = new THREE.MeshStandardMaterial({ color: 0x20262b, metalness: 0.3, roughness: 0.55, emissive: 0x0b2030, emissiveIntensity: 0.4 });

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Tapered stealth deckhouse block (narrower at top → angled sides). */
function deckhouse(parent, len, w, h, x, baseY, mat, taper = 0.7) {
  const geo = new THREE.BoxGeometry(len, h, w);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * 0.92);
      pos.setZ(i, pos.getZ(i) * taper);
    }
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, baseY + h / 2, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Single-barrel 5-inch Mk45 mount; `dir` flips it to point astern. */
function gunTurret(parent, x, y, scale = 1, mat = gray(0x6b757c, 0.5), dir = 1) {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2 * scale, 2.7 * scale, 1.2 * scale, 18), mat);
  base.position.set(x, y + 0.6 * scale, 0);
  base.castShadow = true;
  parent.add(base);
  const house = box(parent, 4.2 * scale, 2.0 * scale, 3.0 * scale, x, y + 1.9 * scale, 0, mat);
  house.position.y = y + 1.9 * scale;
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * scale, 0.5 * scale, 1.4 * scale, 10), blackMat);
  shroud.rotation.z = Math.PI / 2;
  shroud.position.set(x + dir * 1.9 * scale, y + 2.0 * scale, 0);
  parent.add(shroud);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * scale, 0.26 * scale, 6 * scale, 10), blackMat);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(x + dir * 4.2 * scale, y + 2.0 * scale, 0);
  barrel.castShadow = true;
  parent.add(barrel);
}

/** Triple 16-inch battleship main turret. */
function mainTurret(parent, x, y, scale = 1, mat = gray(0x66707a, 0.5)) {
  const barb = new THREE.Mesh(new THREE.CylinderGeometry(2.7 * scale, 3.1 * scale, 1.1 * scale, 20), mat);
  barb.position.set(x, y + 0.55 * scale, 0);
  barb.castShadow = true;
  parent.add(barb);
  const houseY = y + 1.9 * scale;
  box(parent, 5.2 * scale, 2.4 * scale, 4.4 * scale, x, houseY, 0, mat);
  const face = box(parent, 1.4 * scale, 2.0 * scale, 4.2 * scale, x + 3.0 * scale, houseY - 0.1 * scale, 0, mat);
  face.rotation.z = -0.18;
  const dz = 1.15 * scale;
  for (const oz of [-dz, 0, dz]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * scale, 0.3 * scale, 8 * scale, 12), blackMat);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(x + 5.2 * scale, houseY + 0.15 * scale, oz);
    barrel.castShadow = true;
    parent.add(barrel);
  }
}

/** Twin 5-inch secondary mount (authored at local origin; translate into place). */
function secondaryMount(parent, mat = gray(0x6b757c, 0.5)) {
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.6, 12), mat);
  parent.add(ring);
  box(parent, 1.8, 1.2, 1.6, 0, 1.0, 0, mat);
  for (const oz of [-0.4, 0.4]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.2, 8), blackMat);
    b.rotation.z = Math.PI / 2;
    b.position.set(1.6, 1.1, oz);
    parent.add(b);
  }
}

/** Lattice/mack mast with platforms + a spinnable 'radar' dish on top. */
function mast(parent, x, y, h, z = 0) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, h, 8), blackMat);
  pole.position.set(x, y + h / 2, z);
  pole.castShadow = true;
  parent.add(pole);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 2.6), gray(0x4a5258, 0.5));
  plat.position.set(x, y + h * 0.45, z);
  parent.add(plat);
  const plat2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 1.8), gray(0x4a5258, 0.5));
  plat2.position.set(x, y + h * 0.78, z);
  parent.add(plat2);
  const yard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, h * 0.5), blackMat);
  yard.position.set(x, y + h * 0.7, z);
  parent.add(yard);
  const dish = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 0.2), radarMat);
  dish.position.set(x, y + h + 0.6, z);
  dish.name = "radar";
  parent.add(dish);
}

/** Raked, capped exhaust funnel/uptake. */
function funnel(parent, x, baseY, h) {
  const rake = 0.12;
  const up = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.5, h, 14), gray(0x4a5258, 0.6));
  up.position.set(x, baseY + h / 2, 0);
  up.rotation.z = -rake;
  up.castShadow = true;
  parent.add(up);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 0.5, 14), blackMat);
  cap.position.set(x + Math.sin(rake) * h, baseY + h, 0);
  cap.rotation.z = -rake;
  parent.add(cap);
}

/** Flush phased-array radar face with a bezel, slightly back-canted. */
function spyPanel(parent, x, y, z, ry) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 3.6, 3.4),
    new THREE.MeshStandardMaterial({ color: 0x223040, metalness: 0.35, roughness: 0.45, emissive: 0x163a5c, emissiveIntensity: 0.7 }),
  );
  g.add(face);
  const bez = new THREE.Mesh(new THREE.BoxGeometry(0.34, 4.0, 3.8), gray(0x5a636a, 0.5));
  bez.position.x = -0.1;
  g.add(bez);
  g.position.set(x, y, z);
  g.rotation.y = ry;
  g.rotation.z = 0.1;
  parent.add(g);
}

function ciws(parent, x, y) {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 1.0, 12), gray(0xcfcfcf, 0.5));
  base.position.set(x, y + 0.5, 0);
  parent.add(base);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, metalness: 0.2 }),
  );
  dome.position.set(x, y + 1.0, 0);
  parent.add(dome);
}

let vlsTex = null;
function vlsTexture() {
  if (vlsTex) return vlsTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2c3237";
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#10141a";
  ctx.lineWidth = 3;
  for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) ctx.strokeRect(col * 16 + 1, r * 16 + 1, 14, 14);
  vlsTex = new THREE.CanvasTexture(c);
  return vlsTex;
}
function vls(parent, x, y, len, w) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, w), new THREE.MeshStandardMaterial({ map: vlsTexture(), metalness: 0.4, roughness: 0.7 }));
  m.position.set(x, y + 0.3, 0);
  m.castShadow = true;
  parent.add(m);
}

/** Box with topside pulled inward (stealth tumblehome). */
function tumblehomeBlock(parent, len, w, h, x, baseY, mat, cant = 0.28) {
  const g = new THREE.BoxGeometry(len, h, w);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * 0.96);
      p.setZ(i, p.getZ(i) * (1 - cant));
    }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, baseY + h / 2, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Teardrop SSN hull: rounded bow, max beam ~1/3 aft, long tapering stern. */
function subBody(L, rMax, mat) {
  const ctrl = [
    [0.0, 0.2], [0.04, 0.4], [0.1, 0.66], [0.2, 0.86],
    [0.34, 0.97], [0.46, 1.0], [0.6, 0.99], [0.74, 0.93],
    [0.85, 0.8], [0.92, 0.6], [0.965, 0.4], [0.99, 0.2], [1.0, 0.04],
  ];
  const pts = ctrl.map(([t, rf]) => new THREE.Vector2(rMax * rf, (t - 0.5) * L));
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Faired conning-tower sail: rounded leading edge + rounded top, raked aft. */
function subSail(sailLen, sailH, thick, mat) {
  const s = new THREE.Shape();
  const x0 = -sailLen / 2;
  const x1 = sailLen / 2;
  s.moveTo(x0 + sailLen * 0.18, 0);
  s.quadraticCurveTo(x0, 0, x0, sailH * 0.45);
  s.quadraticCurveTo(x0, sailH, x0 + sailLen * 0.28, sailH);
  s.lineTo(x1 - sailLen * 0.06, sailH);
  s.quadraticCurveTo(x1, sailH, x1, sailH * 0.7);
  s.lineTo(x1 - sailLen * 0.05, 0);
  s.lineTo(x0 + sailLen * 0.18, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 1, steps: 1 });
  geo.translate(0, 0, -thick / 2);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Refined modern hull. `tumble`>0 opts into Burke-style bow knuckle + topside pull-in. */
function buildHull(length, paint, hullNumber, seed, beam = 0.42, height = 4.2, tumble = 0) {
  const L = length * CELL * 0.84;
  const w = CELL * beam;
  const bow = tumble > 0 ? L / 2 - L * 0.2 : L / 2 - L * 0.24;
  const stern = w * 0.46;
  const s = new THREE.Shape();
  s.moveTo(-L / 2, -stern);
  s.lineTo(bow, -w / 2);
  if (tumble > 0) {
    s.quadraticCurveTo(L / 2 - L * 0.04, -w * 0.3, L / 2, 0);
    s.quadraticCurveTo(L / 2 - L * 0.04, w * 0.3, bow, w / 2);
  } else {
    s.quadraticCurveTo(L / 2, -w * 0.18, L / 2, 0);
    s.quadraticCurveTo(L / 2, w * 0.18, bow, w / 2);
  }
  s.lineTo(-L / 2, stern);
  s.lineTo(-L / 2, -stern);
  const geo = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.4, bevelSegments: 1, steps: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -1.0, 0);
  if (tumble > 0) {
    const hp = geo.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i);
      if (y > 0) {
        const t = Math.min(1, y / (height - 1.0));
        hp.setZ(i, hp.getZ(i) * (1 - tumble * t));
      }
    }
  }
  geo.computeVertexNormals();
  const hull = new THREE.Mesh(geo, hullMat(paint, hullNumber, seed));
  hull.castShadow = true;
  hull.receiveShadow = true;
  return { hull, L, w, deckY: height - 1.0 };
}

function addDeck(ship, length, deckY, paint = NAVY) {
  const deck = new THREE.Mesh(new THREE.BoxGeometry(length * CELL * 0.74, 0.4, CELL * 0.38), deckMat(paint));
  deck.position.set(0, deckY, 0);
  deck.receiveShadow = true;
  ship.add(deck);
}

// ---------------------------------------------------------------------------

function buildCarrier(ship, length) {
  const { hull, L, deckY } = buildHull(length, CARRIER_PAINT, HULL_NUM.carrier, 3, 0.5, 7);
  ship.add(hull);

  const knuckle = box(ship, L * 0.16, 3.0, 4.4, L * 0.46, deckY - 2.2, 0, gray(0x6f797f, 0.65));
  {
    const p = knuckle.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getX(i) > 0) { p.setZ(i, p.getZ(i) * 0.4); p.setY(i, p.getY(i) + 0.8); }
    knuckle.geometry.computeVertexNormals();
  }

  const dW = 9.6;
  const dHalf = L * 0.5;
  const ds = new THREE.Shape();
  ds.moveTo(-dHalf, -dW * 0.55);
  ds.lineTo(-dHalf, dW * 0.92);
  ds.lineTo(dHalf * 0.3, dW);
  ds.lineTo(dHalf * 0.86, dW * 0.7);
  ds.quadraticCurveTo(dHalf, dW * 0.2, dHalf, -dW * 0.1);
  ds.lineTo(dHalf * 0.2, -dW);
  ds.lineTo(-dHalf * 0.55, -dW * 0.78);
  ds.lineTo(-dHalf, -dW * 0.55);
  const deckGeo = new THREE.ExtrudeGeometry(ds, { depth: 1.0, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.3, bevelSegments: 1, steps: 1 });
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, deckY + 1.0, 0);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ map: makeFlightDeck(), metalness: 0.3, roughness: 0.85, envMapIntensity: 0.7 }));
  deck.castShadow = true;
  deck.receiveShadow = true;
  ship.add(deck);

  const gal = new THREE.Mesh(new THREE.ExtrudeGeometry(ds, { depth: 1.6, bevelEnabled: false, steps: 1 }), gray(0x646e75, 0.7));
  gal.geometry.rotateX(-Math.PI / 2);
  gal.geometry.scale(0.93, 1, 0.9);
  gal.position.y = deckY - 0.9;
  gal.castShadow = true;
  gal.receiveShadow = true;
  ship.add(gal);

  const islandZ = 7.0;
  const islandX = -L * 0.06;
  const is1 = deckhouse(ship, L * 0.11, 3.2, 5.5, islandX, deckY + 1.0, gray(0x6f7980), 0.9);
  is1.position.z = islandZ;
  const is2 = deckhouse(ship, L * 0.075, 2.6, 4.0, islandX - L * 0.005, deckY + 6.5, gray(0x767f86), 0.92);
  is2.position.z = islandZ;
  box(ship, L * 0.07, 1.3, 3.0, islandX, deckY + 9.6, islandZ, glassMat);
  box(ship, L * 0.03, 1.6, 2.0, islandX - L * 0.05, deckY + 8.0, islandZ + 1.4, gray(0x5b6168, 0.6));
  mast(ship, islandX - L * 0.01, deckY + 10.5, 7, islandZ);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.4, 4.0), radarMat);
  bed.position.set(islandX + L * 0.02, deckY + 9.0, islandZ);
  bed.rotation.x = -0.2;
  ship.add(bed);
  spyPanel(ship, islandX + L * 0.04, deckY + 6.0, islandZ - 1.3, -0.4);
  spyPanel(ship, islandX - L * 0.04, deckY + 6.0, islandZ + 1.3, Math.PI + 0.4);

  const rd = box(ship, L * 0.1, 1.4, 16, -L * 0.47, deckY + 0.4, 0, gray(0x646e75, 0.7));
  {
    const p = rd.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getX(i) < 0) p.setY(i, p.getY(i) - 1.2);
    rd.geometry.computeVertexNormals();
  }
  box(ship, L * 0.06, 2.2, 12, -L * 0.49, deckY - 1.6, 0, gray(0x5d666c, 0.72));

  const elevator = (x, z) => box(ship, L * 0.07, 0.5, 4.2, x, deckY + 0.8, z, gray(0x3f4549, 0.8));
  elevator(L * 0.18, 9.4);
  elevator(-L * 0.18, 9.4);
  elevator(-L * 0.3, -9.2);
  for (const [ex, ez] of [[L * 0.18, 9.4], [-L * 0.18, 9.4]]) box(ship, 0.3, 1.6, 3.6, ex, deckY, ez + 0.2, blackMat);

  const jet = (x, z, ry) => {
    const g = new THREE.Group();
    box(g, 4.0, 0.5, 0.9, 0, 0, 0, gray(0x5b6168, 0.55));
    box(g, 1.6, 0.25, 4.4, -0.2, 0.05, 0, gray(0x555b61, 0.6));
    box(g, 0.9, 0.25, 2.0, -1.7, 0.05, 0, gray(0x555b61, 0.6));
    box(g, 0.7, 0.9, 0.15, -1.6, 0.5, 0.6, gray(0x4f555b, 0.6));
    box(g, 0.7, 0.9, 0.15, -1.6, 0.5, -0.6, gray(0x4f555b, 0.6));
    g.position.set(x, deckY + 1.55, z);
    g.rotation.y = ry;
    ship.add(g);
  };
  jet(L * 0.3, 8.0, 0.4);
  jet(L * 0.22, 8.6, 0.7);
  jet(-L * 0.24, 8.2, 2.5);
  jet(-L * 0.33, 8.4, 2.9);
  jet(-L * 0.41, 6.5, 3.4);
  jet(L * 0.05, -6.5, -2.2);
  jet(-L * 0.05, -7.4, -2.0);

  box(ship, L * 0.34, 0.18, 0.5, L * 0.28, deckY + 1.55, -2.2, gray(0x2c3236, 0.7));
  box(ship, L * 0.34, 0.18, 0.5, L * 0.3, deckY + 1.55, 1.2, gray(0x2c3236, 0.7));
  for (const jz of [-2.2, 1.2]) {
    const jbd = box(ship, 0.6, 1.6, 3.2, L * 0.1, deckY + 2.0, jz, gray(0x6b757c, 0.5));
    jbd.rotation.z = -0.5;
  }
}

function buildBattleship(ship, length) {
  const { hull, L, w, deckY } = buildHull(length, BATTLESHIP_PAINT, HULL_NUM.battleship, 4, 0.5, 4.2);
  ship.add(hull);

  const bdeck = new THREE.Mesh(new THREE.BoxGeometry(length * CELL * 0.8, 0.4, CELL * 0.5), deckMat(BATTLESHIP_PAINT));
  bdeck.position.set(0, deckY, 0);
  bdeck.receiveShadow = true;
  ship.add(bdeck);

  mainTurret(ship, L * 0.34, deckY, 1.25); // A
  mainTurret(ship, L * 0.205, deckY + 2.6, 1.25); // B superfiring
  mainTurret(ship, -L * 0.36, deckY, 1.25); // X aft

  const towerX = -L * 0.02;
  deckhouse(ship, L * 0.18, CELL * 0.34, 3.4, towerX, deckY, gray(0x6f7980), 0.8);
  deckhouse(ship, L * 0.12, CELL * 0.26, 3.4, towerX, deckY + 3.4, gray(0x767f86), 0.82);
  box(ship, L * 0.045, 1.4, CELL * 0.18, towerX, deckY + 6.4, 0, glassMat);
  deckhouse(ship, L * 0.07, CELL * 0.16, 3.0, towerX, deckY + 6.8, gray(0x7a838a), 0.85);
  const dirTop = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, 1.2, 14), gray(0x7a838a, 0.5));
  dirTop.position.set(towerX, deckY + 10.2, 0);
  ship.add(dirTop);

  const funnelM = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.1, 4.2, 16), gray(0x3a4046, 0.6));
  funnelM.position.set(-L * 0.16, deckY + 4.0, 0);
  funnelM.castShadow = true;
  ship.add(funnelM);
  const fcap = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 1.9, 0.5, 16), blackMat);
  fcap.position.set(-L * 0.16, deckY + 6.1, 0);
  ship.add(fcap);

  mast(ship, towerX - L * 0.01, deckY + 10.8, 4.5);
  mast(ship, -L * 0.24, deckY, 9.0);

  const secY = deckY + 0.3;
  for (const sz of [w * 0.42, -w * 0.42]) {
    for (const sx of [L * 0.06, -L * 0.1, -L * 0.22]) {
      const g = new THREE.Group();
      secondaryMount(g);
      g.position.set(sx, secY, sz);
      ship.add(g);
    }
  }
}

function buildCruiser(ship, length) {
  const { hull, L, deckY } = buildHull(length, CRUISER_PAINT, HULL_NUM.cruiser, 5, 0.42, 3.8);
  ship.add(hull);
  addDeck(ship, length, deckY, CRUISER_PAINT);

  gunTurret(ship, L * 0.4, deckY, 0.9); // fwd 5in
  gunTurret(ship, -L * 0.42, deckY, 0.9, undefined, -1); // aft 5in

  vls(ship, L * 0.22, deckY, L * 0.12, CELL * 0.24);
  vls(ship, -L * 0.33, deckY, L * 0.12, CELL * 0.24);

  const fwdLen = L * 0.2;
  const fwdW = CELL * 0.34;
  deckhouse(ship, fwdLen, fwdW, 5.2, L * 0.06, deckY, gray(0x6f7980), 0.86);
  deckhouse(ship, fwdLen * 0.55, fwdW * 0.78, 2.0, L * 0.1, deckY + 5.2, gray(0x767f86), 0.9);
  box(ship, fwdLen * 0.4, 1.0, fwdW * 0.8, L * 0.105, deckY + 6.5, 0, glassMat);
  for (const sz of [-1, 1]) box(ship, 1.4, 0.5, 1.2, L * 0.1, deckY + 5.6, sz * (fwdW * 0.5 + 0.4), gray(0x636d74, 0.6));
  const aftLen = L * 0.22;
  const aftW = CELL * 0.34;
  deckhouse(ship, aftLen, aftW, 4.0, -L * 0.22, deckY, gray(0x6f7980), 0.84);

  funnel(ship, -L * 0.04, deckY + 1.2, 4.2);
  funnel(ship, -L * 0.13, deckY + 1.2, 4.0);
  mast(ship, -L * 0.085, deckY + 5.0, 6.5);

  spyPanel(ship, L * 0.15, deckY + 3.0, CELL * 0.16, -0.35);
  spyPanel(ship, L * 0.15, deckY + 3.0, -CELL * 0.16, 0.35);
  spyPanel(ship, -L * 0.31, deckY + 2.4, CELL * 0.16, Math.PI + 0.35);
  spyPanel(ship, -L * 0.31, deckY + 2.4, -CELL * 0.16, Math.PI - 0.35);

  ciws(ship, L * 0.0, deckY + 5.2);
  ciws(ship, -L * 0.13, deckY + 4.0);
}

function buildSubmarine(ship, length) {
  const L = length * CELL * 0.84;
  const rMax = 2.05;
  const body = subBody(L, rMax, hullMat(SUB, HULL_NUM.submarine, 9));
  body.position.y = -rMax * 0.35;
  ship.add(body);
  const crownY = body.position.y + rMax;

  const deckMatS = gray(0x262b2f, 0.8, 0.45);
  box(ship, L * 0.7, 0.34, rMax * 0.92, 0, crownY - 0.05, 0, deckMatS);
  box(ship, L * 0.16, 0.3, rMax * 0.7, L * 0.4, crownY - 0.08, 0, deckMatS);
  box(ship, L * 0.14, 0.3, rMax * 0.66, -L * 0.4, crownY - 0.08, 0, deckMatS);

  const sailLen = L * 0.22;
  const sailH = 4.0;
  const sailX = L * 0.06;
  const sail = subSail(sailLen, sailH, rMax * 1.05, gray(0x2c3236, 0.6, 0.5));
  sail.position.set(sailX, crownY, 0);
  ship.add(sail);
  const planeMatS = gray(0x2c3236, 0.65);
  for (const sz of [-1, 1]) box(ship, sailLen * 0.42, 0.18, rMax * 1.5, sailX, crownY + sailH * 0.55, sz * (rMax * 1.3), planeMatS);

  const mastBaseY = crownY + sailH;
  const masts = [
    [sailX + sailLen * 0.1, 3.4, 0.13],
    [sailX - sailLen * 0.02, 2.6, 0.11],
    [sailX + sailLen * 0.22, 2.0, 0.1],
  ];
  for (const [mx, mh, mr] of masts) {
    const peri = new THREE.Mesh(new THREE.CylinderGeometry(mr, mr, mh, 8), blackMat);
    peri.position.set(mx, mastBaseY + mh / 2, 0);
    peri.castShadow = true;
    ship.add(peri);
  }

  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.0, rMax * 0.42, rMax * 1.1, 16), gray(0x20262a, 0.6, 0.55));
  cone.rotation.z = Math.PI / 2;
  cone.position.set(-L * 0.5 - rMax * 0.45, body.position.y, 0);
  cone.castShadow = true;
  ship.add(cone);
  const finMat = gray(0x2a3034, 0.6);
  for (const rot of [0, Math.PI / 2]) {
    const fin = box(ship, rMax * 1.3, 0.18, rMax * 2.6, -L * 0.44, body.position.y, 0, finMat);
    fin.geometry.rotateX(rot);
  }
}

function buildDestroyer(ship, length) {
  const { hull, deckY } = buildHull(length, DESTROYER_PAINT, HULL_NUM.destroyer, 6, 0.4, 4.0, 0.22);
  ship.add(hull);
  addDeck(ship, length, deckY, DESTROYER_PAINT);

  const housW = CELL * 0.3;
  tumblehomeBlock(ship, 7.0, housW, 2.6, -1.5, deckY, gray(0x70797f), 0.28); // 01 level
  tumblehomeBlock(ship, 3.4, housW * 0.8, 2.2, 0.6, deckY + 2.6, gray(0x767f86), 0.3); // 02 bridge
  box(ship, 2.4, 0.9, housW * 0.62, 1.0, deckY + 4.9, 0, glassMat);

  const spyY = deckY + 3.9;
  const spyZ = housW * 0.5 * 0.72;
  spyPanel(ship, 1.9, spyY, spyZ, -0.42);
  spyPanel(ship, 1.9, spyY, -spyZ, 0.42);
  spyPanel(ship, -0.6, spyY, spyZ, -0.42 + Math.PI);
  spyPanel(ship, -0.6, spyY, -spyZ, 0.42 + Math.PI);

  gunTurret(ship, 4.4, deckY, 0.85);
  vls(ship, 1.6, deckY, 2.4, CELL * 0.18);
  vls(ship, -5.6, deckY, 1.6, CELL * 0.2); // aft VLS
  box(ship, 2.9, 0.35, CELL * 0.34, -6.95, deckY + 0.18, 0, deckMat(DESTROYER_PAINT, true)); // helo pad
  tumblehomeBlock(ship, 1.6, housW * 0.9, 2.2, -4.6, deckY, gray(0x6b757c), 0.22); // hangar
  ciws(ship, 2.0, deckY + 2.6);
  ciws(ship, -4.6, deckY + 2.2);

  const mastBase = deckY + 2.6;
  const pyr = new THREE.BoxGeometry(1.6, 4.0, 1.6);
  const pp = pyr.attributes.position;
  for (let i = 0; i < pp.count; i++) if (pp.getY(i) > 0) { pp.setX(i, pp.getX(i) * 0.32); pp.setZ(i, pp.getZ(i) * 0.32); }
  pyr.computeVertexNormals();
  const mastMesh = new THREE.Mesh(pyr, gray(0x636d74, 0.55));
  mastMesh.position.set(-1.0, mastBase + 2.0, 0);
  mastMesh.castShadow = true;
  ship.add(mastMesh);
  const sps = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 0.18), radarMat);
  sps.position.set(-1.0, mastBase + 4.4, 0);
  sps.name = "radar";
  ship.add(sps);

  for (const mx of [0.0, -2.4]) {
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 2.6, 12), gray(0x3a4046, 0.6));
    up.position.set(mx, deckY + 2.6 + 1.3, 0);
    up.rotation.x = -0.12;
    up.castShadow = true;
    ship.add(up);
    const ucap = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.3, 12), blackMat);
    ucap.position.set(mx, deckY + 2.6 + 2.6, 0.1);
    ship.add(ucap);
  }
}

/** The bold hull colour used for a given ship class (for revealed damage tiles). */
export function shipHullColor(id) {
  switch (id) {
    case "carrier":
      return CARRIER_PAINT.hull;
    case "battleship":
      return BATTLESHIP_PAINT.hull;
    case "cruiser":
      return CRUISER_PAINT.hull;
    case "submarine":
      return SUB.hull;
    case "destroyer":
      return DESTROYER_PAINT.hull;
  }
  return CARRIER_PAINT.hull;
}

// Map an arbitrary ship id / length to one of the five canonical classes. The
// original keyed purely on the fleet id; here we accept the id but fall back to
// the classic Milton-Bradley lengths (5/4/3/3/2) so the right class is built
// even if a caller passes a non-canonical id.
function classOf(id, length) {
  const key = String(id || "").toLowerCase();
  if (key.includes("carrier")) return "carrier";
  if (key.includes("battle")) return "battleship";
  if (key.includes("cruiser")) return "cruiser";
  if (key.includes("sub")) return "submarine";
  if (key.includes("destroy")) return "destroyer";
  if (length >= 5) return "carrier";
  if (length === 4) return "battleship";
  if (length === 2) return "destroyer";
  return "cruiser"; // length 3 — cruiser (submarine shares length 3 but needs an explicit id)
}

/** Build the detailed, class-distinct warship Group (length along +X, centred). */
function makeWarship(id, length) {
  const ship = new THREE.Group();
  switch (classOf(id, length)) {
    case "carrier":
      buildCarrier(ship, length);
      break;
    case "battleship":
      buildBattleship(ship, length);
      break;
    case "cruiser":
      buildCruiser(ship, length);
      break;
    case "submarine":
      buildSubmarine(ship, length);
      break;
    case "destroyer":
      buildDestroyer(ship, length);
      break;
  }
  return ship;
}

/**
 * Build a faithful, fully detailed warship scaled to the in-world board.
 *
 * @param {Object} opts
 * @param {string} opts.id           Ship id (carrier/battleship/cruiser/submarine/destroyer).
 * @param {number} opts.length       Ship length in board cells (5/4/3/3/2).
 * @param {string} [opts.orientation] "horizontal" | "vertical" (caller may rotate;
 *                                    the model itself is always authored along +X).
 * @param {number} opts.cell         In-world cell size (metres). The whole model is
 *                                    scaled by cell / ORIGINAL_CELL so it spans
 *                                    ~`length` cells, matching the original proportions.
 * @returns {THREE.Group} a Group containing the full detailed ship, lying along +X.
 */
export function buildWarship(opts) {
  const { id, length, cell } = opts;
  // Author the detailed ship at the ORIGINAL console CELL so every coordinate is
  // byte-identical to warship.ts, then uniformly scale to the in-world cell size.
  const detailed = makeWarship(id, length);
  const wrapper = new THREE.Group();
  wrapper.add(detailed);
  const s = cell / ORIGINAL_CELL;
  wrapper.scale.setScalar(s);
  return wrapper;
}

export default buildWarship;
