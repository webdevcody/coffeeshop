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
  const apron = flat(20, 16, matConcrete);
  apron.position.set(-15, 0.02, -16);
  group.add(apron);

  // Concrete pad under the showroom / parking (back, left-of-centre) ----------
  const lotPad = flat(34, 14, matConcrete);
  lotPad.position.set(-7, 0.02, 21);
  group.add(lotPad);

  // === GLASS SHOWROOM (back-right / NE corner) ==============================
  // Footprint ~16×11, sits at x≈16, z≈22 with its glass front facing -Z.
  const SHOW = { x: 16, z: 22, w: 16, d: 11, h: 5.6 };
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
  const bayLeft = SHOW.x + SHOW.w / 2 + 0.2; // ≈ 24.2 (world)
  const bayX = bayLeft + BAY.w / 2;          // ≈ 26.8
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
  const PYL = { x: 22, z: -18 };
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
  const GAS = { x: -15, z: -16, w: 16, d: 9, h: 4.6 };
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

  // === CONVENIENCE STORE (kiosk) — left of the canopy, faces the forecourt ===
  // A real, full-volume building (not a facade): four solid walls + roof so it
  // reads solid from the street, the forecourt AND the back. Its glazed
  // STOREFRONT + "MART" sign face +X toward the pumps / central drive lane; the
  // back (-X), sides and roof are closed. Footprint X∈[-29.8,-23.8], Z∈[-17.5,-8.5]
  // (6 m wide × 9 m deep) — its +X front wall sits ~0.8 m clear of the canopy
  // deck's left edge (x≈-23) so nothing clips the canopy, and the back/roof stay
  // inside the tile edge (x=-30).
  const STORE = { x: -26.8, z: -13, w: 6, d: 9, h: 4.2 };
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
  const STALL_Z = 24; // back-of-lot line for parked cars
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
    const z0 = -27.5;
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
    dash.position.set(x, 0.04, -27);
    group.add(dash);
  }

  // --- Light bollards flanking the entrance lane (slim, with colliders) ------
  for (const x of [-4, 4]) {
    const bol = new THREE.Group();
    const post = box(0.22, 1.1, 0.22, matSteel);
    post.position.y = 0.55;
    const cap = cyl(0.16, 0.18, matLight, false);
    cap.position.y = 1.15;
    bol.add(post, cap);
    bol.position.set(x, 0, -28);
    group.add(bol);
    addCollider(colliders, x, -28, 0.4, 0.4);
  }

  // --- Street dressing: planters with shrubs + a bin (flank, clear of lanes) -
  for (const [px, pz] of [[-26, -2], [-26, 8], [10, -26]]) {
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
  bin.position.set(-24, 0, -24);
  group.add(bin);
  addCollider(colliders, -24, -24, 0.7, 0.7);

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
