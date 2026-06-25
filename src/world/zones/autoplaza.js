// AUTO PLAZA district — a car dealership + gas station on a 60×60 m tile.
//
// Layout (local coords, tile spans X,Z ∈ [-30,30], ground at y=0, up = +Y):
//   • Glass curtain-wall SHOWROOM in the back-right (NE) corner with instanced
//     mullions, a hero car on a turntable visible inside, a sign fascia and a
//     parapet trim band. A SERVICE BAY with a ribbed ROLLER DOOR is attached to
//     the showroom's east side.
//   • Tall PYLON sign near the front-right reading "AUTO" (rotates slowly).
//   • GAS STATION: a flat canopy on slim columns sheltering two fuel pumps,
//     front-left of the tile.
//   • PARKING LOT: painted stalls along the back-left with 3 parked low-poly
//     cars (box bodies + cylinder wheels) wearing windshield PRICE FLAGS.
//   • A triangular PENNANT STRING strung over the lot and STRING LIGHTS along
//     the entrance, plus planters / bins as street dressing.
//   • Lots of open ASPHALT down the middle — a >= 6 m lane runs the full length
//     of the tile in both X and Z so a driving car can pass straight through.
//
// buildAutoPlaza() returns { group, colliders, ground, update } where colliders
// are tight AABBs around solids (showroom + service bay, pylon base, canopy
// columns, pumps, parked cars) and `ground` is the single full-tile rect.

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

// --- Shared geometry + materials (created ONCE, reused across props) ---------
const boxGeo = new THREE.BoxGeometry(1, 1, 1); // unit box, scaled per use
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16); // unit cylinder
// Shared instancing geometries (1×1×1 / unit) reused with per-instance matrices.
const mullGeo = new THREE.BoxGeometry(1, 1, 1);
const slatGeo = new THREE.BoxGeometry(1, 1, 1);
const winGeo = new THREE.BoxGeometry(1, 1, 1);
const acGeo = new THREE.BoxGeometry(1, 1, 1);
const bulbGeo = new THREE.SphereGeometry(0.5, 8, 6);
const pennantGeo = (() => {
  // A small downward triangle pennant lying in the XY plane (flips per use).
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -0.5, 0, 0, 0.5, 0, 0, 0, -0.7, 0,
  ]), 3));
  g.setIndex([0, 1, 2]);
  g.computeVertexNormals();
  return g;
})();

const matAsphalt = new THREE.MeshStandardMaterial({ color: "#34343c", roughness: 0.98 });
const matSlabSide = new THREE.MeshStandardMaterial({ color: "#26262c", roughness: 1 });
const matConcrete = new THREE.MeshStandardMaterial({ color: "#9b968c", roughness: 0.95 });
const matCurb = new THREE.MeshStandardMaterial({ color: "#c7c2b8", roughness: 0.9 });
const matPaintWhite = new THREE.MeshStandardMaterial({ color: "#e9e9e4", roughness: 0.6 });
const matPaintYellow = new THREE.MeshStandardMaterial({ color: "#e7d24a", roughness: 0.6 });
const matGlass = new THREE.MeshStandardMaterial({
  color: "#8fc6e0", roughness: 0.15, metalness: 0.5, transparent: true, opacity: 0.6,
});
const matFrame = new THREE.MeshStandardMaterial({ color: "#d9dde2", roughness: 0.4, metalness: 0.4 });
const matWall = new THREE.MeshStandardMaterial({ color: "#c4485a", roughness: 0.7 });
const matWall2 = new THREE.MeshStandardMaterial({ color: "#7a8794", roughness: 0.85, flatShading: true });
const matRoof = new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.8 });
const matSteel = new THREE.MeshStandardMaterial({ color: "#b9bdc4", roughness: 0.5, metalness: 0.7 });
const matRed = new THREE.MeshStandardMaterial({ color: "#c8362e", roughness: 0.6 });
const matDark = new THREE.MeshStandardMaterial({ color: "#1c1c20", roughness: 0.8 });
const matTire = new THREE.MeshStandardMaterial({ color: "#17171a", roughness: 0.85 });
const matCanopy = new THREE.MeshStandardMaterial({ color: "#e8edf2", roughness: 0.5, metalness: 0.2 });
const matCanopyStripe = new THREE.MeshStandardMaterial({ color: "#d63a3a", roughness: 0.6 });
const matRoller = new THREE.MeshStandardMaterial({ color: "#c9ccd2", roughness: 0.55, metalness: 0.55, flatShading: true });
const matTrim = new THREE.MeshStandardMaterial({ color: "#1a2742", roughness: 0.6 });
const matAwning = new THREE.MeshStandardMaterial({ color: "#1f5c8a", roughness: 0.7 });
const matGreen = new THREE.MeshStandardMaterial({ color: "#3f7d4a", roughness: 0.9, flatShading: true });
const matPlanter = new THREE.MeshStandardMaterial({ color: "#6b6258", roughness: 0.95 });
const matFlagRed = new THREE.MeshStandardMaterial({ color: "#d6362f", roughness: 0.7, side: THREE.DoubleSide });
const matFlagYel = new THREE.MeshStandardMaterial({ color: "#f0c030", roughness: 0.7, side: THREE.DoubleSide });
const matPriceFlag = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7, side: THREE.DoubleSide });
const matLight = new THREE.MeshStandardMaterial({
  color: "#fff3cf", emissive: "#ffe49a", emissiveIntensity: 0.7, roughness: 0.4,
});
const matWinLit = new THREE.MeshStandardMaterial({
  color: "#ffe9b0", emissive: "#ffd680", emissiveIntensity: 0.55, roughness: 0.5,
});
const matBulb = new THREE.MeshStandardMaterial({
  color: "#fff6da", emissive: "#ffe9a8", emissiveIntensity: 0.9, roughness: 0.4,
});
// --- Parts & accessories SHOP interior palette (reused across its props) ------
const matShopWall = new THREE.MeshStandardMaterial({ color: "#3a4654", roughness: 0.85 });
const matShopFloor = new THREE.MeshStandardMaterial({ color: "#4a4a52", roughness: 0.95 });
const matShelf = new THREE.MeshStandardMaterial({ color: "#7a6a52", roughness: 0.9 });
const matCounter = new THREE.MeshStandardMaterial({ color: "#b54a3a", roughness: 0.6 });
const matRug = new THREE.MeshStandardMaterial({ color: "#264a63", roughness: 0.95 });
const matProdBlue = new THREE.MeshStandardMaterial({ color: "#3f7fd0", roughness: 0.55 });
const matProdRed = new THREE.MeshStandardMaterial({ color: "#d6453a", roughness: 0.55 });
const matProdYel = new THREE.MeshStandardMaterial({ color: "#e7c24a", roughness: 0.55 });
// --- Tyre shop + car-wash interiors / props palette (reused across props) -----
const matTyreWall = new THREE.MeshStandardMaterial({ color: "#3d3a44", roughness: 0.9 });
const matTyreFloor = new THREE.MeshStandardMaterial({ color: "#43474d", roughness: 0.95 });
const matRim = new THREE.MeshStandardMaterial({ color: "#c9ccd2", roughness: 0.4, metalness: 0.7 });
const matWashWall = new THREE.MeshStandardMaterial({ color: "#2f5d7a", roughness: 0.7 });
const matWashFloor = new THREE.MeshStandardMaterial({ color: "#5a6168", roughness: 0.9 });
const matWashTrim = new THREE.MeshStandardMaterial({ color: "#1f8fb0", roughness: 0.5, metalness: 0.3 });
const matBrush = new THREE.MeshStandardMaterial({ color: "#2c6fb0", roughness: 0.95, flatShading: true });
const matWood = new THREE.MeshStandardMaterial({ color: "#8a6b46", roughness: 0.92, flatShading: true });
const matCone = new THREE.MeshStandardMaterial({ color: "#e8612a", roughness: 0.7 });
const matConeBand = new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.7 });
const matWater = new THREE.MeshStandardMaterial({
  color: "#7fc8e8", roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.55,
});

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function cyl(r, h, mat, cast = true) {
  const m = new THREE.Mesh(cylGeo, mat);
  m.scale.set(r, h, r);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function flat(w, d, mat) {
  // A thin floor plate (plane) lying on the XZ plane, top facing +Y.
  // PlaneGeometry is single-sided by default, so a ground-level camera looking
  // across the tile sees these plates edge-on as a 1-px line (and they vanish
  // from below). Force DoubleSide on the plate's material so the surface reads
  // from any approach. The floor materials are only used for flat plates (or
  // solid boxes, where DoubleSide is harmless), so toggling them here is safe.
  mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// Build an InstancedMesh from a list of {pos:[x,y,z], scale:[x,y,z], rotY?} and
// add it to `parent`. One geometry + one material shared across all instances.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
function instance(geo, mat, items, parent, cast = false) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  im.castShadow = cast;
  im.receiveShadow = true;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    _p.set(it.pos[0], it.pos[1], it.pos[2]);
    _e.set(it.rotX || 0, it.rotY || 0, it.rotZ || 0);
    _q.setFromEuler(_e);
    _s.set(it.scale[0], it.scale[1], it.scale[2]);
    _m.compose(_p, _q, _s);
    im.setMatrixAt(i, _m);
  }
  im.instanceMatrix.needsUpdate = true;
  parent.add(im);
  return im;
}

// --- Prop builders ----------------------------------------------------------
// One parked low-poly car: box body + cabin + 4 cylinder wheels.
function makeCar(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const body = box(3.6, 0.85, 1.7, paint);
  body.position.y = 0.75;
  const cabin = box(1.9, 0.7, 1.5, matGlass);
  cabin.position.set(-0.1, 1.4, 0);
  g.add(body, cabin);
  for (const [x, z] of [[-1.1, 0.85], [1.1, 0.85], [-1.1, -0.85], [1.1, -0.85]]) {
    const w = cyl(0.4, 0.34, matTire);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.4, z);
    g.add(w);
  }
  return g;
}

// A small triangular windshield price flag mounted on a slim staff.
function makePriceFlag() {
  const g = new THREE.Group();
  const staff = box(0.04, 0.7, 0.04, matSteel, false);
  staff.position.y = 0.35;
  // A right-triangle pennant flying from the staff top.
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 0.6, -0.14, 0, 0, -0.34, 0,
  ]), 3));
  flagGeo.setIndex([0, 1, 2]);
  flagGeo.computeVertexNormals();
  const flag = new THREE.Mesh(flagGeo, matPriceFlag);
  flag.position.y = 0.68;
  g.add(staff, flag);
  return g;
}

// A fuel pump: a low box dispenser with a small lit screen and a hose nozzle.
function makeFuelPump() {
  const g = new THREE.Group();
  const base = box(0.9, 0.2, 0.7, matDark);
  base.position.y = 0.1;
  const body = box(0.8, 1.6, 0.6, matRed);
  body.position.y = 1.0;
  const screen = box(0.55, 0.4, 0.05, matLight, false);
  screen.position.set(0, 1.45, 0.31);
  g.add(base, body, screen);
  return g;
}

// A traffic cone: an orange cone on a square base with a reflective band.
function makeCone() {
  const g = new THREE.Group();
  const base = box(0.42, 0.06, 0.42, matCone, false);
  base.position.y = 0.03;
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 12), matCone);
  body.position.y = 0.36;
  body.castShadow = true;
  const band = cyl(0.13, 0.08, matConeBand, false);
  band.position.y = 0.34;
  g.add(base, body, band);
  return g;
}

// A short stack of tyres (rings of dark cylinders) — auto-district street dressing.
function makeTyreStack(n) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const t = cyl(0.45, 0.26, matTire);
    t.position.y = 0.13 + i * 0.26;
    g.add(t);
  }
  return g;
}

export function buildAutoPlaza() {
  const group = new THREE.Group();
  const colliders = [];
  const movers = []; // animated objects, populated below

  // --- Ground: full-tile asphalt slab (thin box so edges read with depth) ---
  const slab = box(60, 0.6, 60, matSlabSide, false);
  slab.position.y = -0.3; // top flush at y = 0
  group.add(slab);
  const tarmac = flat(60, 60, matAsphalt);
  tarmac.position.y = 0.01;
  group.add(tarmac);

  // Concrete forecourt apron under the gas canopy (front-left) for contrast.
  // Sized/placed to stay inside the setback so it doesn't read under the seam road.
  const apron = flat(17, 16, matConcrete);
  apron.position.set(-13.5, 0.02, -16);
  group.add(apron);

  // Concrete pad under the showroom / parking (back, left-of-centre) ----------
  // Kept inside the setback so the pad doesn't read under the +Z / -X seam roads.
  const lotPad = flat(28, 10, matConcrete);
  lotPad.position.set(-8, 0.02, 17);
  group.add(lotPad);

  // === GLASS SHOWROOM (back-right / NE corner) ==============================
  // Footprint ~13×9, sits at x≈10, z≈17 with its glass front facing -Z. Pulled
  // IN from the NE tile corner so it (and the service bay it shares an east wall
  // with) clear the seam roads: with a 0.4 m collider margin the showroom+bay
  // mass stays inside local X,Z ∈ [-23,23] (≥7 m setback from each tile edge).
  const SHOW = { x: 10, z: 17, w: 13, d: 9, h: 5.6 };
  const show = new THREE.Group();
  // Back + side walls (solid), glass curtain front.
  const backWall = box(SHOW.w, SHOW.h, 0.3, matWall);
  backWall.position.set(0, SHOW.h / 2, SHOW.d / 2);
  const sideL = box(0.3, SHOW.h, SHOW.d, matWall);
  sideL.position.set(-SHOW.w / 2, SHOW.h / 2, 0);
  const sideR = box(0.3, SHOW.h, SHOW.d, matWall);
  sideR.position.set(SHOW.w / 2, SHOW.h / 2, 0);
  show.add(backWall, sideL, sideR);

  // Big curtain-wall glazing across the whole front (faces -Z).
  const glassFront = box(SHOW.w - 0.6, SHOW.h - 0.6, 0.16, matGlass, false);
  glassFront.position.set(0, SHOW.h / 2, -SHOW.d / 2);
  show.add(glassFront);
  // Instanced mullion grid (verticals + horizontal transoms) over the glass.
  {
    const fz = -SHOW.d / 2 - 0.02;
    const cols = 9;       // vertical mullions
    const rows = 3;       // horizontal transoms
    const innerW = SHOW.w - 0.6;
    const innerH = SHOW.h - 0.6;
    const items = [];
    for (let c = 0; c < cols; c++) {
      const x = -innerW / 2 + (c / (cols - 1)) * innerW;
      items.push({ pos: [x, SHOW.h / 2, fz], scale: [0.14, innerH, 0.16] });
    }
    for (let r = 0; r < rows; r++) {
      const y = (SHOW.h / 2 - innerH / 2) + (r / (rows - 1)) * innerH;
      items.push({ pos: [0, y, fz], scale: [innerW, 0.16, 0.16] });
    }
    instance(mullGeo, matFrame, items, show, false);
  }
  const sill = box(SHOW.w, 0.5, 0.5, matFrame);
  sill.position.set(0, 0.25, -SHOW.d / 2 - 0.02);
  show.add(sill);
  // Entrance door pair set into the glazing (dark anodised frames).
  for (const dx of [-0.85, 0.85]) {
    const door = box(1.5, 3.0, 0.1, matTrim, false);
    door.position.set(dx, 1.5, -SHOW.d / 2 - 0.06);
    show.add(door);
  }

  // Flat roof with a parapet + fascia sign band along the front.
  const roof = box(SHOW.w + 0.4, 0.4, SHOW.d + 0.4, matRoof);
  roof.position.set(0, SHOW.h + 0.2, 0);
  show.add(roof);
  // Parapet cap rail running the roof perimeter (front + sides).
  const parFront = box(SHOW.w + 0.6, 0.5, 0.25, matTrim, false);
  parFront.position.set(0, SHOW.h + 0.55, -SHOW.d / 2 - 0.05);
  const parL = box(0.25, 0.5, SHOW.d + 0.6, matTrim, false);
  parL.position.set(-SHOW.w / 2 - 0.05, SHOW.h + 0.55, 0);
  const parR = box(0.25, 0.5, SHOW.d + 0.6, matTrim, false);
  parR.position.set(SHOW.w / 2 + 0.05, SHOW.h + 0.55, 0);
  show.add(parFront, parL, parR);
  // Fascia "sign" billboard across the showroom front (faces -Z).
  const fascia = artPanel(11, 1.6, "sign", {
    text: "AUTO PLAZA", bg: "#1a2742", fg: "#ffd23f",
    emissiveIntensity: 0.5, file: "autoplaza-showroom.png",
  });
  fascia.position.set(0, SHOW.h + 0.55, -SHOW.d / 2 - 0.22);
  fascia.rotation.y = Math.PI; // face -Z (outward toward the lot/road)
  show.add(fascia);

  // Hero car on a slow turntable, lit inside the showroom floor.
  const heroTurn = new THREE.Group();
  const dais = cyl(2.4, 0.18, matLight, false);
  dais.position.y = 0.09;
  const hero = makeCar("#e8b23a");
  hero.scale.setScalar(1.08);
  heroTurn.add(dais, hero);
  heroTurn.position.set(0, 0, -1.2);
  show.add(heroTurn);
  movers.push({ kind: "spin", obj: heroTurn, rate: 0.35 });

  // Rooftop clutter (instanced AC units) + a vent stack + antenna.
  {
    const items = [];
    for (const [ux, uz] of [[-5, 2], [-1, -2], [3.5, 2.5], [5.5, -1]]) {
      items.push({ pos: [ux, SHOW.h + 0.85, uz], scale: [1.4, 0.7, 1.1] });
    }
    instance(acGeo, matSteel, items, show, true);
  }
  const vent = cyl(0.35, 0.9, matSteel, true);
  vent.position.set(-3, SHOW.h + 0.85, -3);
  show.add(vent);
  const antenna = box(0.06, 2.4, 0.06, matDark, false);
  antenna.position.set(6, SHOW.h + 1.6, 3.5);
  show.add(antenna);

  show.position.set(SHOW.x, 0, SHOW.z);
  group.add(show);
  addCollider(colliders, SHOW.x, SHOW.z, SHOW.w + 0.4, SHOW.d + 0.4);

  // === SERVICE BAY with a ribbed ROLLER DOOR (east of the showroom) =========
  // Abuts the showroom's east (+X) wall and shares it — the bay has NO west wall
  // of its own, so the two masses meet flush instead of interpenetrating. Its
  // left (west) face lines up just outside the showroom's east parapet; faces -Z
  // like the showroom. The bay roof sits lower than the showroom roof so the two
  // read as one taller hall + one attached lower service hall.
  const BAY = { w: 5.2, d: 9, h: 4.4 };
  // Showroom solid mass reaches x = SHOW.x + SHOW.w/2 + 0.175 (side wall + east
  // parapet). Seat the bay's left face just clear of that so nothing overlaps.
  // With the pulled-in showroom (x=10,w=13) the bay sits at x≈19.3, so its east
  // collider edge (≈21.9) clears the +X seam road / sidewalk (setback past 23).
  const bayLeft = SHOW.x + SHOW.w / 2 + 0.2; // ≈ 16.7 (world)
  const bayX = bayLeft + BAY.w / 2;          // ≈ 19.3
  const bayZ = SHOW.z + (SHOW.d - BAY.d) / 2; // align back walls
  const bay = new THREE.Group();
  const bBack = box(BAY.w, BAY.h, 0.3, matWall2);
  bBack.position.set(0, BAY.h / 2, BAY.d / 2);
  const bRight = box(0.3, BAY.h, BAY.d, matWall2);
  bRight.position.set(BAY.w / 2, BAY.h / 2, 0);
  // West side is closed by the showroom's east wall — no duplicate wall here.
  bay.add(bBack, bRight);
  // Roof overhangs the front/right/back only (NOT the west edge), so it never
  // clips the taller showroom parapet next door.
  const bRoof = box(BAY.w, 0.35, BAY.d + 0.2, matRoof);
  bRoof.position.set(0.1, BAY.h + 0.17, 0);
  bay.add(bRoof);
  // Roller-door header lintel.
  const lintel = box(BAY.w - 0.3, 0.5, 0.4, matTrim, false);
  lintel.position.set(0, BAY.h - 0.25, -BAY.d / 2);
  bay.add(lintel);
  // Ribbed roller door: instanced horizontal slats filling the opening.
  {
    const openW = BAY.w - 0.7;
    const slats = 11;
    const top = BAY.h - 0.55;
    const items = [];
    for (let i = 0; i < slats; i++) {
      const y = 0.25 + (i / (slats - 1)) * (top - 0.25);
      items.push({ pos: [0, y, -BAY.d / 2 - 0.05], scale: [openW, 0.34, 0.1] });
    }
    instance(slatGeo, matRoller, items, bay, false);
  }
  // "SERVICE" sign strip over the bay door.
  const svcSign = artPanel(4.2, 0.9, "sign", {
    text: "SERVICE", bg: "#c8362e", fg: "#ffffff",
    emissiveIntensity: 0.45, file: "autoplaza-service.png",
  });
  svcSign.position.set(0, BAY.h + 0.25, -BAY.d / 2 - 0.12);
  svcSign.rotation.y = Math.PI;
  bay.add(svcSign);
  bay.position.set(bayX, 0, bayZ);
  group.add(bay);
  // Footprint: from the shared showroom wall (bayLeft) to the bay's east wall.
  // Butts the showroom collider (which ends at x≈24.2) edge-to-edge, no overlap.
  addCollider(colliders, bayX, bayZ, BAY.w, BAY.d + 0.2);

  // === TALL PYLON SIGN ("AUTO") — front-right, near the entrance ============
  // Base at x=21 so its 1.6 m footing collider (→ x≈21.8) clears the +X seam road.
  const PYL = { x: 21, z: -18 };
  const pylon = new THREE.Group();
  const pole = box(0.7, 12, 0.7, matSteel);
  pole.position.y = 6;
  pylon.add(pole);
  const footing = box(1.6, 0.5, 1.6, matConcrete);
  footing.position.y = 0.25;
  pylon.add(footing);
  // Rotating sign cabinet near the top: a "sign"-style panel on each face.
  const signSpin = new THREE.Group();
  signSpin.position.y = 11;
  const cabinet = box(4.2, 2.6, 0.5, matDark, true);
  signSpin.add(cabinet);
  for (const ry of [0, Math.PI]) {
    const face = artPanel(4, 2.4, "sign", {
      text: "AUTO", bg: "#c8362e", fg: "#ffffff",
      emissiveIntensity: 0.55, file: "autoplaza-pylon.png",
    });
    face.position.z = ry === 0 ? 0.27 : -0.27;
    face.rotation.y = ry === 0 ? 0 : Math.PI;
    signSpin.add(face);
  }
  pylon.add(signSpin);
  pylon.position.set(PYL.x, 0, PYL.z);
  group.add(pylon);
  addCollider(colliders, PYL.x, PYL.z, 1.6, 1.6);
  movers.push({ kind: "spin", obj: signSpin, rate: 0.6 });

  // === GAS STATION: canopy + pumps (front-left) =============================
  // Nudged in from x=-15 to -13.5 so the canopy's left edge (x≈-21.5) and the
  // outer column colliders (x≈-20.8) clear the -X seam road + sidewalk (≥7 m in).
  const GAS = { x: -13.5, z: -16, w: 16, d: 9, h: 4.6 };
  const gas = new THREE.Group();
  // Flat canopy deck with a red accent stripe along the front edge.
  const deck = box(GAS.w, 0.5, GAS.d, matCanopy);
  deck.position.y = GAS.h;
  gas.add(deck);
  const stripe = box(GAS.w, 0.35, 0.4, matCanopyStripe, false);
  stripe.position.set(0, GAS.h, -GAS.d / 2 + 0.2);
  gas.add(stripe);
  // Recessed soffit light strip (emissive) under the canopy.
  const lite = box(GAS.w - 2, 0.08, 1.4, matLight, false);
  lite.position.set(0, GAS.h - 0.3, 0);
  gas.add(lite);
  // Four columns. These get colliders so cars don't drive through them.
  const colHalfX = GAS.w / 2 - 1.2;
  const colHalfZ = GAS.d / 2 - 1.2;
  const colSpots = [
    [-colHalfX, -colHalfZ], [colHalfX, -colHalfZ],
    [-colHalfX, colHalfZ], [colHalfX, colHalfZ],
  ];
  for (const [cxp, czp] of colSpots) {
    const col = box(0.6, GAS.h, 0.6, matSteel);
    col.position.set(cxp, GAS.h / 2, czp);
    gas.add(col);
    addCollider(colliders, GAS.x + cxp, GAS.z + czp, 0.9, 0.9);
  }
  // Two fuel pumps on a shared raised island between the column rows.
  const island = box(8.0, 0.18, 1.6, matConcrete, false);
  island.position.set(0, 0.09, 0);
  gas.add(island);
  for (const cxp of [-3, 3]) {
    const pump = makeFuelPump();
    pump.position.set(cxp, 0.18, 0);
    gas.add(pump);
    addCollider(colliders, GAS.x + cxp, GAS.z, 1.0, 0.85);
  }
  gas.position.set(GAS.x, 0, GAS.z);
  group.add(gas);

  // === CONVENIENCE STORE (kiosk) — west side, faces the central drive lane ===
  // A real, full-volume building (not a facade): four solid walls + roof so it
  // reads solid from the street, the forecourt AND the back. Its glazed
  // STOREFRONT + "MART" sign face +X toward the central drive lane; the back (-X),
  // sides and roof are closed. Pulled IN off the west tile edge: footprint
  // X∈[-22,-16], Z∈[-2.5,6.5] (6 m wide × 9 m deep) so its back/collider west edge
  // (x≈-22.15) clears the -X seam road + sidewalk, and it sits north of the gas
  // forecourt (Z≤-11.5) and south of the parking lot, keeping the centre lane open.
  const STORE = { x: -19, z: 2, w: 6, d: 9, h: 4.2 };
  const store = new THREE.Group();
  // Solid shell: back wall (-X face), two side walls (±Z), thick enough to read.
  const stBack = box(0.3, STORE.h, STORE.d, matWall2);
  stBack.position.set(-STORE.w / 2, STORE.h / 2, 0);
  const stSideN = box(STORE.w, STORE.h, 0.3, matWall2);
  stSideN.position.set(0, STORE.h / 2, STORE.d / 2);
  const stSideS = box(STORE.w, STORE.h, 0.3, matWall2);
  stSideS.position.set(0, STORE.h / 2, -STORE.d / 2);
  store.add(stBack, stSideN, stSideS);
  // Glazed storefront across the +X front (the readable, detailed face).
  const stGlass = box(0.16, STORE.h - 1.0, STORE.d - 0.8, matGlass, false);
  stGlass.position.set(STORE.w / 2, (STORE.h - 1.0) / 2 + 0.3, 0);
  store.add(stGlass);
  // Bulkhead band above the glazing + a low sill kicker below it.
  const stSill = box(0.4, 0.4, STORE.d, matFrame);
  stSill.position.set(STORE.w / 2, 0.2, 0);
  const stHead = box(0.4, 0.7, STORE.d, matWall);
  stHead.position.set(STORE.w / 2, STORE.h - 0.35, 0);
  store.add(stSill, stHead);
  // Storefront mullions (instanced vertical posts in the glazing).
  {
    const innerD = STORE.d - 0.8;
    const cols = 5;
    const items = [];
    for (let c = 0; c < cols; c++) {
      const z = -innerD / 2 + (c / (cols - 1)) * innerD;
      items.push({ pos: [STORE.w / 2 + 0.02, (STORE.h - 1.0) / 2 + 0.3, z], scale: [0.16, STORE.h - 1.0, 0.14] });
    }
    instance(mullGeo, matFrame, items, store, false);
  }
  // Entrance door pair set into the storefront (dark frames).
  for (const dz of [-0.75, 0.75]) {
    const door = box(0.1, 2.6, 1.3, matTrim, false);
    door.position.set(STORE.w / 2 + 0.06, 1.3, dz);
    store.add(door);
  }
  // Flat roof + parapet cap so the top reads solid, not open.
  const stRoof = box(STORE.w + 0.3, 0.35, STORE.d + 0.3, matRoof);
  stRoof.position.set(0, STORE.h + 0.18, 0);
  store.add(stRoof);
  const stPar = box(0.25, 0.5, STORE.d + 0.4, matTrim, false);
  stPar.position.set(STORE.w / 2 + 0.1, STORE.h + 0.5, 0);
  store.add(stPar);
  // "MART" fascia sign across the front, facing +X (toward the forecourt/lane).
  const martSign = artPanel(STORE.d - 1.2, 1.0, "sign", {
    text: "MART", bg: "#1f5c8a", fg: "#ffffff",
    emissiveIntensity: 0.45, file: "autoplaza-mart.png",
  });
  martSign.position.set(STORE.w / 2 + 0.24, STORE.h + 0.5, 0);
  martSign.rotation.y = Math.PI / 2; // readable front faces +X
  store.add(martSign);
  // A rooftop AC unit so the roofline isn't bare.
  const stAc = box(1.3, 0.6, 1.0, matSteel, true);
  stAc.position.set(-1.2, STORE.h + 0.65, 1.5);
  store.add(stAc);
  store.position.set(STORE.x, 0, STORE.z);
  group.add(store);
  addCollider(colliders, STORE.x, STORE.z, STORE.w + 0.3, STORE.d + 0.3);

  // === PARKING LOT: painted stalls + parked cars (back-left) ================
  // Stalls run along the back; cars face -Z toward the open lot. Stripes are
  // flat ground paint (no colliders); the cars themselves get colliders.
  const STALL_Z = 20; // back-of-lot line for parked cars (pulled in to clear the +Z seam road)
  const stallW = 3.0;
  const startX = -19;
  for (let i = 0; i <= 6; i += 2) {
    const sx = startX + i * stallW;
    const line = box(0.14, 0.02, 5.2, matPaintWhite, false);
    line.position.set(sx, 0.04, STALL_Z - 0.6);
    group.add(line);
  }
  // Wheel-stop / curb strip at the head of the stalls.
  const stopCurb = box(stallW * 6, 0.16, 0.3, matCurb, false);
  stopCurb.position.set(startX + stallW * 3, 0.08, STALL_Z + 2.0);
  group.add(stopCurb);

  // 3 parked cars in alternating stalls, each wearing a windshield price flag.
  const carColors = ["#d94f4f", "#3f7fd0", "#54a86b"];
  const carSlots = [0, 2, 4];
  for (let i = 0; i < carSlots.length; i++) {
    const sx = startX + carSlots[i] * stallW + stallW / 2;
    const car = makeCar(carColors[i]);
    car.position.set(sx, 0, STALL_Z - 0.6);
    car.rotation.y = Math.PI / 2; // nose toward -Z (out of the stall)
    // Price flag mounted on the hood (local +X of the un-rotated car body).
    const flag = makePriceFlag();
    flag.position.set(1.4, 1.6, 0);
    car.add(flag);
    group.add(car);
    // car footprint after 90° yaw: long axis runs along Z.
    addCollider(colliders, sx, STALL_Z - 0.6, 2.0, 4.0);
  }

  // === TRIANGULAR PENNANT STRING strung over the lot ========================
  // Two slim poles at the lot corners with a sagging pennant line between them.
  // Visual-only (poles are thin; placed at the back lot edge, clear of lanes).
  const penA = new THREE.Vector3(startX - 1, 5.0, STALL_Z - 4.5);
  const penB = new THREE.Vector3(startX + 6 * stallW + 1, 5.0, STALL_Z - 4.5);
  for (const p of [penA, penB]) {
    const pole = box(0.14, p.y, 0.14, matSteel);
    pole.position.set(p.x, p.y / 2, p.z);
    group.add(pole);
  }
  {
    const count = 18;
    const sag = 1.4;
    const flagMats = [matFlagRed, matFlagYel];
    // Group pennants by alternating material so each colour is one InstancedMesh.
    const groups = [[], []];
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const x = penA.x + (penB.x - penA.x) * u;
      // catenary-ish sag (parabola), pennant hangs below the cord.
      const y = penA.y - sag * 4 * u * (1 - u) - 0.05;
      const z = penA.z;
      groups[i % 2].push({ pos: [x, y, z], scale: [0.55, 0.65, 1] });
    }
    for (let k = 0; k < 2; k++) instance(pennantGeo, flagMats[k], groups[k], group, false);
  }

  // === STRING LIGHTS along the entrance edge (instanced glowing bulbs) ======
  {
    const items = [];
    const z0 = -22; // entrance edge pulled in to clear the -Z seam road
    for (let i = 0; i < 14; i++) {
      const x = -13 + i * 2.0;
      const sag = 0.5 * Math.sin((i / 13) * Math.PI);
      items.push({ pos: [x, 3.2 - sag, z0], scale: [0.16, 0.16, 0.16] });
    }
    instance(bulbGeo, matBulb, items, group, false);
    // Two slim support poles for the light string.
    for (const x of [-13, 13]) {
      const sp = box(0.12, 3.4, 0.12, matSteel);
      sp.position.set(x, 1.7, z0);
      group.add(sp);
    }
  }

  // --- Lane / lot markings down the open middle (flat paint, no colliders) ---
  // Centre driving lane dashes running along Z at x≈0 (the open corridor).
  for (let z = -26; z <= 14; z += 6) {
    const dash = box(0.3, 0.02, 2.0, matPaintYellow, false);
    dash.position.set(0, 0.04, z);
    group.add(dash);
  }
  // A couple of cross dashes marking the entrance.
  for (const x of [-8, 0, 8]) {
    const dash = box(1.6, 0.02, 0.3, matPaintWhite, false);
    dash.position.set(x, 0.04, -21.5);
    group.add(dash);
  }

  // --- Light bollards flanking the entrance lane (slim, with colliders) ------
  // At z=-22 so their colliders clear the -Z seam road + sidewalk (inside ±23).
  for (const x of [-4, 4]) {
    const bol = new THREE.Group();
    const post = box(0.22, 1.1, 0.22, matSteel);
    post.position.y = 0.55;
    const cap = cyl(0.16, 0.18, matLight, false);
    cap.position.y = 1.15;
    bol.add(post, cap);
    bol.position.set(x, 0, -22);
    group.add(bol);
    addCollider(colliders, x, -22, 0.4, 0.4);
  }

  // --- Street dressing: planters with shrubs + a bin (flank, clear of lanes) -
  // All pulled inside the ±23 setback so nothing sits in the seam roads.
  for (const [px, pz] of [[-22, -8], [-22, 12], [10, -22]]) {
    const planter = new THREE.Group();
    const tub = box(1.0, 0.6, 1.0, matPlanter);
    tub.position.y = 0.3;
    const shrub = box(0.85, 0.7, 0.85, matGreen, false);
    shrub.position.y = 0.95;
    planter.add(tub, shrub);
    planter.position.set(px, 0, pz);
    group.add(planter);
    addCollider(colliders, px, pz, 1.0, 1.0);
  }
  // A waste bin by the gas station forecourt edge.
  const bin = new THREE.Group();
  const binBody = cyl(0.32, 0.9, matDark);
  binBody.position.y = 0.45;
  bin.add(binBody);
  bin.position.set(-22, 0, -22);
  group.add(bin);
  addCollider(colliders, -22, -22, 0.7, 0.7);

  // === ENTERABLE PARTS & ACCESSORIES SHOP (SE open quadrant) ================
  // A small, real interior the player can WALK INTO: 4 thin walls, a floor and a
  // flat ceiling, with a 2.2 m DOORWAY GAP in the street-facing (-X) wall that
  // faces the central drive lane. Each wall is a SOLID box; the back wall, both
  // side walls and the two short front segments flanking the door each get their
  // own AABB collider — and crucially NO collider spans the doorway gap, so the
  // interior is walkable and the player enters through the door.
  // Placed clear of the showroom (z≈12+), gas forecourt (x<-5), pylon (z≈-18)
  // and the central lane (x≈0). Footprint X∈[11,19], Z∈[-11.5,-4.5] — all well
  // inside local X,Z ∈ [-23,23].
  const SHOP = { x: 15, z: -8, w: 8, d: 7, h: 3.4, t: 0.25 };
  const shop = new THREE.Group();
  const hw = SHOP.w / 2, hd = SHOP.d / 2, ht = SHOP.t / 2;
  const doorGap = 2.2;          // clear opening width in the front (-X) wall
  // The front (-X) wall runs along Z, so its total length is SHOP.d. Split it
  // into two flanking segments with the doorway gap centred between them.
  const frontSeg = (SHOP.d - doorGap) / 2; // length of each flanking front segment

  // Floor plate + a thin slab so the floor reads from outside too.
  const shopFloor = flat(SHOP.w, SHOP.d, matShopFloor);
  shopFloor.position.y = 0.03;
  shop.add(shopFloor);
  // Flat ceiling / roof.
  const shopRoof = box(SHOP.w + 0.3, SHOP.t, SHOP.d + 0.3, matRoof);
  shopRoof.position.y = SHOP.h + ht;
  shop.add(shopRoof);

  // --- Four walls (front wall is split by the doorway gap) ------------------
  // Back wall (+X face, away from the street).
  const wBack = box(SHOP.t, SHOP.h, SHOP.d, matShopWall);
  wBack.position.set(hw - ht, SHOP.h / 2, 0);
  // Two side walls (±Z).
  const wSideN = box(SHOP.w, SHOP.h, SHOP.t, matShopWall);
  wSideN.position.set(0, SHOP.h / 2, hd - ht);
  const wSideS = box(SHOP.w, SHOP.h, SHOP.t, matShopWall);
  wSideS.position.set(0, SHOP.h / 2, -hd + ht);
  // Front wall (-X, street-facing) split into two short segments flanking the door.
  const frontZ0 = -hd + frontSeg / 2; // segment toward -Z
  const frontZ1 = hd - frontSeg / 2;  // segment toward +Z
  const wFrontA = box(SHOP.t, SHOP.h, frontSeg, matShopWall);
  wFrontA.position.set(-hw + ht, SHOP.h / 2, frontZ0);
  const wFrontB = box(SHOP.t, SHOP.h, frontSeg, matShopWall);
  wFrontB.position.set(-hw + ht, SHOP.h / 2, frontZ1);
  // Door header lintel over the gap (above head height, doesn't block walking).
  const lintelS = box(SHOP.t, 0.5, doorGap, matTrim, false);
  lintelS.position.set(-hw + ht, SHOP.h - 0.25, 0);
  shop.add(wBack, wSideN, wSideS, wFrontA, wFrontB, lintelS);

  // --- INTERIOR: rug, service counter, shelves of goods, display rack, stools,
  // signage, hanging lights — a cozy, themed reason to step inside. ----------
  // Rug centred on the floor.
  const rug = flat(4.4, 3.2, matRug);
  rug.position.set(0.3, 0.05, 0);
  shop.add(rug);

  // Service counter along the back wall (with a darker top kick).
  const counter = box(2.8, 1.0, 0.9, matCounter);
  counter.position.set(hw - 0.7, 0.5, -1.4);
  const counterTop = box(3.0, 0.12, 1.1, matDark, false);
  counterTop.position.set(hw - 0.7, 1.06, -1.4);
  shop.add(counter, counterTop);
  // A small cash register box + a couple of boxed parts on the counter.
  const register = box(0.5, 0.35, 0.4, matSteel, false);
  register.position.set(hw - 0.9, 1.3, -1.1);
  shop.add(register);

  // Shelving unit along the back-N wall, stacked with little product boxes.
  const shelfUnit = new THREE.Group();
  for (let lvl = 0; lvl < 3; lvl++) {
    const plank = box(0.6, 0.08, 3.4, matShelf, false);
    plank.position.set(0, 0.9 + lvl * 0.85, 0);
    shelfUnit.add(plank);
  }
  // Side standards for the shelf.
  for (const sz of [-1.7, 1.7]) {
    const stud = box(0.6, 2.7, 0.08, matShelf, false);
    stud.position.set(0, 1.35, sz);
    shelfUnit.add(stud);
  }
  shelfUnit.position.set(hw - 0.4, 0, hd - 0.7);
  shop.add(shelfUnit);
  // Instanced product boxes on the shelf levels (themed: oil cans / parts boxes).
  {
    const prodMats = [matProdBlue, matProdRed, matProdYel];
    const groups = [[], [], []];
    for (let lvl = 0; lvl < 3; lvl++) {
      const y = 1.0 + lvl * 0.85;
      for (let i = 0; i < 5; i++) {
        const z = (hd - 0.7) - 1.5 + i * 0.75;
        groups[(lvl + i) % 3].push({ pos: [hw - 0.4, y, z], scale: [0.34, 0.34, 0.5] });
      }
    }
    for (let k = 0; k < 3; k++) instance(boxGeo, prodMats[k], groups[k], shop, false);
  }

  // Display rack near the front-S corner: a panel with hanging tools/accessories
  // (instanced little bars, like wiper blades / belts on a pegboard).
  const pegboard = box(0.12, 1.8, 2.4, matShelf, false);
  pegboard.position.set(-hw + 0.55, 1.4, -hd + 1.5);
  shop.add(pegboard);
  {
    const items = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        items.push({
          pos: [-hw + 0.5, 1.85 - r * 0.45, -hd + 0.7 + c * 0.55],
          scale: [0.06, 0.34, 0.07],
        });
      }
    }
    instance(boxGeo, matSteel, items, shop, false);
  }

  // A couple of stools by the counter (cylinder seat on a slim post).
  for (const sz of [-0.6, 0.4]) {
    const stool = new THREE.Group();
    const post = box(0.1, 0.6, 0.1, matSteel, false);
    post.position.y = 0.3;
    const seat = cyl(0.22, 0.1, matDark, false);
    seat.position.y = 0.62;
    stool.add(post, seat);
    stool.position.set(hw - 2.2, 0, sz);
    shop.add(stool);
  }

  // Two hanging interior lights (emissive discs on short drops).
  for (const lz of [-1.6, 1.6]) {
    const drop = box(0.05, 0.5, 0.05, matDark, false);
    drop.position.set(-0.5, SHOP.h - 0.25, lz);
    const lamp = cyl(0.3, 0.12, matLight, false);
    lamp.position.set(-0.5, SHOP.h - 0.55, lz);
    shop.add(drop, lamp);
  }

  // Interior wall signage above the counter (faces -X into the room).
  const wallSign = artPanel(2.4, 0.7, "sign", {
    text: "PARTS DESK", bg: "#1a2742", fg: "#ffd23f",
    emissiveIntensity: 0.4, file: "autoplaza-partsdesk.png",
  });
  wallSign.position.set(hw - 0.13, 2.2, -1.4);
  wallSign.rotation.y = -Math.PI / 2; // readable face toward -X (into the room)
  shop.add(wallSign);

  // --- OUTSIDE shop sign above the door, facing the street (-X) -------------
  // artPanel faces +Z by default; rotate -90° about Y so its readable front
  // faces -X (toward the central drive lane) and reads un-mirrored.
  const shopSign = artPanel(3.6, 1.0, "sign", {
    text: "AUTO PARTS", bg: "#c8362e", fg: "#ffffff",
    emissiveIntensity: 0.5, file: "autoplaza-parts.png",
  });
  shopSign.position.set(-hw - 0.13, SHOP.h + 0.55, 0);
  shopSign.rotation.y = -Math.PI / 2; // readable front faces -X (the street)
  shop.add(shopSign);
  // Small fascia band behind the outside sign so it has a backing.
  const fasciaBand = box(SHOP.t, 1.3, SHOP.d, matTrim, false);
  fasciaBand.position.set(-hw + ht, SHOP.h + 0.55, 0);
  shop.add(fasciaBand);

  shop.position.set(SHOP.x, 0, SHOP.z);
  group.add(shop);

  // --- Wall COLLIDERS (world space). NO collider across the doorway gap. -----
  // Back wall (runs along Z at +X face).
  addCollider(colliders, SHOP.x + hw - ht, SHOP.z, SHOP.t, SHOP.d);
  // Side walls (run along X at ±Z faces).
  addCollider(colliders, SHOP.x, SHOP.z + hd - ht, SHOP.w, SHOP.t);
  addCollider(colliders, SHOP.x, SHOP.z - hd + ht, SHOP.w, SHOP.t);
  // Two short front-wall segments flanking the doorway (gap between them is open).
  addCollider(colliders, SHOP.x - hw + ht, SHOP.z + frontZ0, SHOP.t, frontSeg);
  addCollider(colliders, SHOP.x - hw + ht, SHOP.z + frontZ1, SHOP.t, frontSeg);

  // === ENTERABLE TYRE & WHEEL SHOP (NW open quadrant) =======================
  // A second walkable interior, themed to wheels/tyres. Footprint X∈[-19,-11],
  // Z∈[8.5,16.5] — north of the convenience store (Z≤6.5), south of the parked
  // cars (Z≈19.4), west of the central drive lane (x≈0) and well inside ±23. Its
  // 2.2 m DOORWAY GAP is in the FRONT (+X) wall facing the central lane, so the
  // player walks in from the open middle. NO collider spans that gap.
  const TYRE = { x: -15, z: 12.5, w: 8, d: 8, h: 3.4, t: 0.25 };
  const tyreShop = new THREE.Group();
  const thw = TYRE.w / 2, thd = TYRE.d / 2, tht = TYRE.t / 2;
  const tDoor = 2.2;                       // doorway gap width in the +X wall
  const tFrontSeg = (TYRE.d - tDoor) / 2;  // each flanking front segment length

  // Floor + flat ceiling.
  const tyreFloor = flat(TYRE.w, TYRE.d, matTyreFloor);
  tyreFloor.position.y = 0.03;
  tyreShop.add(tyreFloor);
  const tyreRoof = box(TYRE.w + 0.3, TYRE.t, TYRE.d + 0.3, matRoof);
  tyreRoof.position.y = TYRE.h + tht;
  tyreShop.add(tyreRoof);

  // Walls: back (-X), two sides (±Z), and front (+X) split by the doorway gap.
  const tBack = box(TYRE.t, TYRE.h, TYRE.d, matTyreWall);
  tBack.position.set(-thw + tht, TYRE.h / 2, 0);
  const tSideN = box(TYRE.w, TYRE.h, TYRE.t, matTyreWall);
  tSideN.position.set(0, TYRE.h / 2, thd - tht);
  const tSideS = box(TYRE.w, TYRE.h, TYRE.t, matTyreWall);
  tSideS.position.set(0, TYRE.h / 2, -thd + tht);
  const tFrontZ0 = -thd + tFrontSeg / 2;
  const tFrontZ1 = thd - tFrontSeg / 2;
  const tFrontA = box(TYRE.t, TYRE.h, tFrontSeg, matTyreWall);
  tFrontA.position.set(thw - tht, TYRE.h / 2, tFrontZ0);
  const tFrontB = box(TYRE.t, TYRE.h, tFrontSeg, matTyreWall);
  tFrontB.position.set(thw - tht, TYRE.h / 2, tFrontZ1);
  const tLintel = box(TYRE.t, 0.5, tDoor, matTrim, false);
  tLintel.position.set(thw - tht, TYRE.h - 0.25, 0);
  tyreShop.add(tBack, tSideN, tSideS, tFrontA, tFrontB, tLintel);

  // Interior: rug, a low workbench along the back, wheel-display pegs on the
  // back wall, a couple of mounted alloy WHEELS, and stacks of tyres.
  const tRug = flat(4.2, 3.0, matRug);
  tRug.position.set(0.4, 0.05, 0);
  tyreShop.add(tRug);
  // Workbench against the back wall.
  const bench = box(0.8, 0.95, 4.0, matShelf);
  bench.position.set(-thw + 0.6, 0.48, 0);
  const benchTop = box(1.0, 0.12, 4.2, matDark, false);
  benchTop.position.set(-thw + 0.6, 1.0, 0);
  tyreShop.add(bench, benchTop);
  // Three mounted alloy wheels on the back wall (tyre + bright rim disc).
  for (const wz of [-2.4, 0, 2.4]) {
    const wheel = new THREE.Group();
    const tyre = cyl(0.55, 0.22, matTire);
    tyre.rotation.z = Math.PI / 2;
    const rim = cyl(0.34, 0.06, matRim, false);
    rim.rotation.z = Math.PI / 2;
    rim.position.x = 0.09;
    wheel.add(tyre, rim);
    wheel.position.set(-thw + 0.45, 2.0, wz);
    tyreShop.add(wheel);
  }
  // Two tyre stacks on the floor (interior dressing).
  const tStackA = makeTyreStack(4);
  tStackA.position.set(thw - 1.6, 0, -thd + 1.4);
  const tStackB = makeTyreStack(3);
  tStackB.position.set(thw - 1.6, 0, thd - 1.4);
  tyreShop.add(tStackA, tStackB);
  // A floor jack + tool chest near the bench so it reads like a workshop.
  const chest = box(1.2, 1.0, 0.7, matRed);
  chest.position.set(-thw + 1.8, 0.5, -thd + 1.0);
  tyreShop.add(chest);
  // Two hanging interior lights.
  for (const lz of [-1.8, 1.8]) {
    const drop = box(0.05, 0.5, 0.05, matDark, false);
    drop.position.set(0.4, TYRE.h - 0.25, lz);
    const lamp = cyl(0.3, 0.12, matLight, false);
    lamp.position.set(0.4, TYRE.h - 0.55, lz);
    tyreShop.add(drop, lamp);
  }
  // Interior wall sign above the bench (faces +X into the room).
  const tWallSign = artPanel(2.6, 0.7, "sign", {
    text: "WHEEL BAY", bg: "#1a2742", fg: "#ffd23f",
    emissiveIntensity: 0.4, file: "autoplaza-wheelbay.png",
  });
  tWallSign.position.set(-thw + 0.14, 2.5, 0);
  tWallSign.rotation.y = Math.PI / 2; // readable face toward +X (into the room)
  tyreShop.add(tWallSign);
  // Outside fascia sign above the door, facing the central lane (+X).
  const tFascia = box(TYRE.t, 1.2, TYRE.d, matTrim, false);
  tFascia.position.set(thw - tht, TYRE.h + 0.5, 0);
  tyreShop.add(tFascia);
  const tShopSign = artPanel(4.4, 1.0, "sign", {
    text: "TYRES & WHEELS", bg: "#c8362e", fg: "#ffffff",
    emissiveIntensity: 0.5, file: "autoplaza-tyres.png",
  });
  tShopSign.position.set(thw + 0.13, TYRE.h + 0.5, 0);
  tShopSign.rotation.y = Math.PI / 2; // readable front faces +X (the lane)
  tyreShop.add(tShopSign);

  tyreShop.position.set(TYRE.x, 0, TYRE.z);
  group.add(tyreShop);
  // Wall colliders — NO collider across the +X doorway gap.
  addCollider(colliders, TYRE.x - thw + tht, TYRE.z, TYRE.t, TYRE.d);          // back (-X)
  addCollider(colliders, TYRE.x, TYRE.z + thd - tht, TYRE.w, TYRE.t);          // side +Z
  addCollider(colliders, TYRE.x, TYRE.z - thd + tht, TYRE.w, TYRE.t);          // side -Z
  addCollider(colliders, TYRE.x + thw - tht, TYRE.z + tFrontZ0, TYRE.t, tFrontSeg); // front seg -Z
  addCollider(colliders, TYRE.x + thw - tht, TYRE.z + tFrontZ1, TYRE.t, tFrontSeg); // front seg +Z

  // === ENTERABLE CAR-WASH BAY (east side, south of the showroom) ============
  // A tall, open drive-through wash hall the player can WALK INTO. Footprint
  // X∈[12.5,19.5], Z∈[0.5,7.5] — east of the central lane (x≈0), south of the
  // showroom (Z≥12.5), north of the parts shop (Z≤-4.5), inside ±23. The 2.6 m
  // DOORWAY GAP faces the central lane (-X) so cars/players drive straight in;
  // NO collider spans that gap. A blue brush + a water sheen sit inside.
  const WASH = { x: 16, z: 4, w: 7, d: 7, h: 4.2, t: 0.25 };
  const wash = new THREE.Group();
  const whw = WASH.w / 2, whd = WASH.d / 2, wht = WASH.t / 2;
  const wDoor = 2.6;
  const wFrontSeg = (WASH.d - wDoor) / 2;

  const washFloor = flat(WASH.w, WASH.d, matWashFloor);
  washFloor.position.y = 0.03;
  wash.add(washFloor);
  // A faint water sheen plate down the wash channel (raised a hair to avoid z-fight).
  const sheen = flat(2.2, WASH.d - 0.8, matWater);
  sheen.position.set(0.3, 0.06, 0);
  wash.add(sheen);
  const washRoof = box(WASH.w + 0.3, WASH.t, WASH.d + 0.3, matRoof);
  washRoof.position.y = WASH.h + wht;
  wash.add(washRoof);

  // Walls: back (+X), two sides (±Z), front (-X) split by the doorway gap.
  const wBack2 = box(WASH.t, WASH.h, WASH.d, matWashWall);
  wBack2.position.set(whw - wht, WASH.h / 2, 0);
  const wSideN2 = box(WASH.w, WASH.h, WASH.t, matWashWall);
  wSideN2.position.set(0, WASH.h / 2, whd - wht);
  const wSideS2 = box(WASH.w, WASH.h, WASH.t, matWashWall);
  wSideS2.position.set(0, WASH.h / 2, -whd + wht);
  const wFrontZ0 = -whd + wFrontSeg / 2;
  const wFrontZ1 = whd - wFrontSeg / 2;
  const wFrontA2 = box(WASH.t, WASH.h, wFrontSeg, matWashWall);
  wFrontA2.position.set(-whw + wht, WASH.h / 2, wFrontZ0);
  const wFrontB2 = box(WASH.t, WASH.h, wFrontSeg, matWashWall);
  wFrontB2.position.set(-whw + wht, WASH.h / 2, wFrontZ1);
  const wLintel2 = box(WASH.t, 0.6, wDoor, matWashTrim, false);
  wLintel2.position.set(-whw + wht, WASH.h - 0.3, 0);
  wash.add(wBack2, wSideN2, wSideS2, wFrontA2, wFrontB2, wLintel2);

  // Interior: a big rotating wash BRUSH on a gantry, plus a control box + hoses.
  const gantry = box(0.3, 0.3, WASH.d - 0.6, matSteel, false);
  gantry.position.set(0.2, WASH.h - 0.5, 0);
  wash.add(gantry);
  const washBrush = new THREE.Group();
  const brushCore = cyl(0.18, WASH.d - 1.2, matSteel, false);
  const brushBristles = cyl(0.6, WASH.d - 1.4, matBrush, false);
  washBrush.add(brushCore, brushBristles);
  washBrush.rotation.x = Math.PI / 2; // axis along Z (vertical roller across the lane)
  washBrush.position.set(0.2, WASH.h / 2, 0);
  wash.add(washBrush);
  movers.push({ kind: "spin", obj: washBrush, rate: 1.6 });
  // Control pedestal by the back wall.
  const ctrl = box(0.7, 1.3, 0.6, matWashTrim);
  ctrl.position.set(whw - 0.6, 0.65, -whd + 1.0);
  const ctrlScreen = box(0.5, 0.4, 0.05, matLight, false);
  ctrlScreen.position.set(whw - 0.95, 1.1, -whd + 1.0);
  wash.add(ctrl, ctrlScreen);
  // A coiled hose reel on the side wall.
  const reel = cyl(0.35, 0.3, matRed, false);
  reel.rotation.x = Math.PI / 2;
  reel.position.set(whw - 0.9, 1.6, whd - 0.9);
  wash.add(reel);
  // Outside fascia sign over the door, facing the central lane (-X).
  const wFasciaBand = box(WASH.t, 1.2, WASH.d, matWashTrim, false);
  wFasciaBand.position.set(-whw + wht, WASH.h + 0.5, 0);
  wash.add(wFasciaBand);
  const washSign = artPanel(4.2, 1.0, "sign", {
    text: "CAR WASH", bg: "#1f5c8a", fg: "#ffffff",
    emissiveIntensity: 0.5, file: "autoplaza-carwash.png",
  });
  washSign.position.set(-whw - 0.13, WASH.h + 0.5, 0);
  washSign.rotation.y = -Math.PI / 2; // readable front faces -X (the lane)
  wash.add(washSign);

  wash.position.set(WASH.x, 0, WASH.z);
  group.add(wash);
  // Wall colliders — NO collider across the -X doorway gap.
  addCollider(colliders, WASH.x + whw - wht, WASH.z, WASH.t, WASH.d);            // back (+X)
  addCollider(colliders, WASH.x, WASH.z + whd - wht, WASH.w, WASH.t);            // side +Z
  addCollider(colliders, WASH.x, WASH.z - whd + wht, WASH.w, WASH.t);            // side -Z
  addCollider(colliders, WASH.x - whw + wht, WASH.z + wFrontZ0, WASH.t, wFrontSeg); // front seg -Z
  addCollider(colliders, WASH.x - whw + wht, WASH.z + wFrontZ1, WASH.t, wFrontSeg); // front seg +Z

  // === EXTRA STREET-LEVEL FLAVOR (lived-in dressing, clear of lanes) =========
  // Traffic cones lining the entrance approach + the wash door (visual only).
  for (const [cx, cz] of [[-2.4, -19], [2.4, -19], [10.5, 5.5], [10.5, 2.5]]) {
    const cone = makeCone();
    cone.position.set(cx, 0, cz);
    group.add(cone);
  }
  // Tyre stacks as street dressing by the service bay + gas forecourt (collidable).
  for (const [sx, sz, n] of [[21.5, 9, 4], [-5.5, -9, 3], [-22, -6, 3]]) {
    const stack = makeTyreStack(n);
    stack.position.set(sx, 0, sz);
    group.add(stack);
    addCollider(colliders, sx, sz, 1.0, 1.0);
  }
  // A couple of wooden benches facing the central lane (collidable seating).
  for (const [bx, bz, ry] of [[-4.5, 6, 0], [4.5, -2, Math.PI]]) {
    const benchG = new THREE.Group();
    const seat = box(2.0, 0.12, 0.5, matWood);
    seat.position.y = 0.45;
    const back = box(2.0, 0.5, 0.12, matWood);
    back.position.set(0, 0.75, -0.2);
    for (const lx of [-0.85, 0.85]) {
      const leg = box(0.12, 0.45, 0.45, matWood, false);
      leg.position.set(lx, 0.22, 0);
      benchG.add(leg);
    }
    benchG.add(seat, back);
    benchG.position.set(bx, 0, bz);
    benchG.rotation.y = ry;
    group.add(benchG);
    addCollider(colliders, bx, bz, 2.0, 0.6);
  }
  // A small open-air parts CRATE cluster near the parts shop (wooden boxes).
  for (const [cx, cy, cz, s] of [[8.0, 0, -11, 1.1], [8.0, 0, -9.7, 0.9], [9.1, 0, -10.4, 0.8]]) {
    const crate = box(s, s, s, matWood);
    crate.position.set(cx, cy + s / 2, cz);
    group.add(crate);
    addCollider(colliders, cx, cz, s, s);
  }
  // A self-serve AIR & WATER station (small kiosk) by the gas forecourt edge.
  {
    const air = new THREE.Group();
    const post = box(0.4, 1.4, 0.4, matRed);
    post.position.y = 0.7;
    const head = box(0.7, 0.6, 0.55, matDark, false);
    head.position.y = 1.6;
    const gauge = cyl(0.16, 0.06, matLight, false);
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(0, 1.6, 0.3);
    air.add(post, head, gauge);
    air.position.set(-5.5, 0, -19);
    air.rotation.y = -Math.PI / 2;
    group.add(air);
    addCollider(colliders, -5.5, -19, 0.8, 0.8);
  }
  // A vending machine pair against the convenience store's north side.
  for (const vx of [-17.5, -16.2]) {
    const vend = box(1.0, 2.0, 0.7, vx < -17 ? matProdRed : matProdBlue);
    vend.position.set(vx, 1.0, 7.0);
    vend.castShadow = true;
    group.add(vend);
    addCollider(colliders, vx, 7.0, 1.0, 0.7);
  }
  // A few extra planters to soften the central lane edges (collidable).
  for (const [px, pz] of [[6, 9], [-9, -16]]) {
    const planter = new THREE.Group();
    const tub = box(1.0, 0.6, 1.0, matPlanter);
    tub.position.y = 0.3;
    const shrub = box(0.85, 0.7, 0.85, matGreen, false);
    shrub.position.y = 0.95;
    planter.add(tub, shrub);
    planter.position.set(px, 0, pz);
    group.add(planter);
    addCollider(colliders, px, pz, 1.0, 1.0);
  }

  // --- Update: rotate the pylon sign + hero turntable; flicker the lights ----
  let t = 0;
  function update(dt) {
    t += dt;
    for (const m of movers) {
      if (m.kind === "spin") m.obj.rotation.y += dt * m.rate;
    }
    // Subtle neon-ish flicker on the shared light material (cheap, no alloc).
    matLight.emissiveIntensity = 0.6 + Math.sin(t * 6) * 0.08;
    matBulb.emissiveIntensity = 0.8 + Math.sin(t * 4 + 1) * 0.12;
  }

  // --- Ground: whole tile is walkable; buildings block via colliders. -------
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  return { group, colliders, ground, update };
}
