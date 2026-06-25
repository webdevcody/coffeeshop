// Market Street district — a bustling 60×60 m market tile centered on origin.
// Two rows of striped market stalls with bright alternating awnings (now varied
// in shape AND height) face a wide central lane (a car can drive straight
// through). Crates + woven baskets of colored produce sit in front of each
// stall, hanging goods (sausages/peppers) and little chalkboard price signs
// dangle from the awning bars, tilted vendor umbrellas shade alternating stalls,
// dense strings of warm bulbs are strung overhead, and a steel MARKET-HALL roof
// with simple A-frame trusses spans the whole arcade. Four SUBSTANTIAL brick
// shop buildings (FRESH GROCER / BAKERY / CORNER MART / DELI) — full 3D volumes
// with real width, depth AND height, instanced windows, doors, awnings and a
// storefront sign mounted on the FRONT facing the lane — anchor the tile edges.
// A cobbled ground slab plus a slow-rotating "MARKET" sign and flickering string
// lights keep it alive.
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

// --- Street-flavor prop materials (benches, planters, barrels, signs) -------
const benchSlatMat = new THREE.MeshStandardMaterial({ color: "#6e4a2a", roughness: 0.85 });
const planterMat = new THREE.MeshStandardMaterial({ color: "#7d6f63", roughness: 0.95, flatShading: true });
const soilMat = new THREE.MeshStandardMaterial({ color: "#3a2c20", roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({ color: "#3f8f4a", roughness: 0.85, flatShading: true });
const bloomMat = new THREE.MeshStandardMaterial({ color: "#d8453a", roughness: 0.7, flatShading: true });
const barrelMat = new THREE.MeshStandardMaterial({ color: "#5a3a24", roughness: 0.8, flatShading: true });
const barrelBandMat = new THREE.MeshStandardMaterial({ color: "#3a3a40", roughness: 0.5, metalness: 0.6 });

// --- Shop-building materials (substantial brick storefronts) ---------------
const brickMat = new THREE.MeshStandardMaterial({ color: "#9c5a44", roughness: 0.95 });
const brickMat2 = new THREE.MeshStandardMaterial({ color: "#7d6f63", roughness: 0.95 });
const stuccoMat = new THREE.MeshStandardMaterial({ color: "#c9b89a", roughness: 0.9 });
const parapetMat = new THREE.MeshStandardMaterial({ color: "#5c4a3c", roughness: 0.9 });
const shopRoofMat = new THREE.MeshStandardMaterial({ color: "#36302b", roughness: 0.95 });
const windowMat = new THREE.MeshStandardMaterial({
  color: "#bfe2ea", roughness: 0.25, metalness: 0.2,
  emissive: "#9fd0dc", emissiveIntensity: 0.18,
});
const doorMat = new THREE.MeshStandardMaterial({ color: "#3a2c20", roughness: 0.8 });
const trimMat = new THREE.MeshStandardMaterial({ color: "#efe6d4", roughness: 0.8 });
const shopAwningMat = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });

// --- Enterable deli/grocery interior materials (created ONCE, reused) -------
const delWallMat = new THREE.MeshStandardMaterial({ color: "#e7dcc4", roughness: 0.95, side: THREE.DoubleSide });
const delFloorMat = new THREE.MeshStandardMaterial({ color: "#b9a37e", roughness: 0.95 });
const delCeilMat = new THREE.MeshStandardMaterial({ color: "#cdbf9f", roughness: 0.95, side: THREE.DoubleSide });
const delCounterMat = new THREE.MeshStandardMaterial({ color: "#5a3a24", roughness: 0.7 });
const delCounterTopMat = new THREE.MeshStandardMaterial({ color: "#cfd2d6", roughness: 0.35, metalness: 0.3 });
const delShelfMat = new THREE.MeshStandardMaterial({ color: "#7a5230", roughness: 0.8 });
const delCaseGlassMat = new THREE.MeshStandardMaterial({
  color: "#cfeef5", roughness: 0.2, metalness: 0.15,
  emissive: "#bfe6ef", emissiveIntensity: 0.12, transparent: true, opacity: 0.45,
});
const delStoolMat = new THREE.MeshStandardMaterial({ color: "#9a3b28", roughness: 0.6 });
const delStoolLegMat = new THREE.MeshStandardMaterial({ color: "#3a3a40", roughness: 0.5, metalness: 0.6 });
const delRugMat = new THREE.MeshStandardMaterial({ color: "#7a2f24", roughness: 1 });
const delLightMat = new THREE.MeshStandardMaterial({
  color: "#fff2c4", emissive: "#ffe2a0", emissiveIntensity: 1.0, roughness: 0.4,
});
// Themed deli product colors for the shelf goods (instanced, vertex-colored).
const DELI_GOODS_COLORS = ["#e0473c", "#e8b53a", "#5fae3f", "#c4502a", "#d8742a", "#a8632c", "#e8efe4", "#9a3b28"];

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

// A simple slatted street bench (seat + backrest + two legs). `ry` faces the
// seat-back so the seat opens toward the lane. Adds a tight collider.
function makeBench(group, colliders, x, z, ry) {
  const b = new THREE.Group();
  b.position.set(x, 0, z);
  b.rotation.y = ry;
  group.add(b);
  const seat = box(new THREE.BoxGeometry(1.7, 0.1, 0.5), benchSlatMat);
  seat.position.set(0, 0.5, 0);
  b.add(seat);
  const back = box(new THREE.BoxGeometry(1.7, 0.45, 0.08), benchSlatMat);
  back.position.set(0, 0.78, -0.21);
  b.add(back);
  for (const sx of [-0.7, 0.7]) {
    const leg = box(new THREE.BoxGeometry(0.12, 0.5, 0.45), darkWood, false);
    leg.position.set(sx, 0.25, 0);
    b.add(leg);
  }
  // collider matches the rotated 1.7×0.5 footprint (ry is a multiple of ~90°).
  const cos = Math.abs(Math.cos(ry)), sin = Math.abs(Math.sin(ry));
  addCollider(colliders, x, z, 1.7 * cos + 0.5 * sin, 1.7 * sin + 0.5 * cos);
}

// A square stone planter with soil, a few leafy bushes and bright blooms.
function makePlanter(group, colliders, x, z) {
  const p = new THREE.Group();
  p.position.set(x, 0, z);
  group.add(p);
  const tub = box(new THREE.BoxGeometry(1.1, 0.55, 1.1), planterMat);
  tub.position.set(0, 0.275, 0);
  p.add(tub);
  const soil = box(new THREE.BoxGeometry(0.92, 0.1, 0.92), soilMat, false);
  soil.position.set(0, 0.56, 0);
  p.add(soil);
  for (const [bx, bz, s] of [[-0.22, -0.18, 0.34], [0.2, 0.16, 0.3], [0.18, -0.2, 0.24]]) {
    const bush = box(new THREE.SphereGeometry(s, 8, 6), leafMat);
    bush.position.set(bx, 0.62 + s * 0.5, bz);
    p.add(bush);
  }
  for (const [bx, bz] of [[-0.1, 0.22], [0.26, -0.04], [-0.28, 0.05]]) {
    const bloom = box(new THREE.SphereGeometry(0.1, 6, 5), bloomMat, false);
    bloom.position.set(bx, 0.92, bz);
    p.add(bloom);
  }
  addCollider(colliders, x, z, 1.1, 1.1);
}

// A wooden barrel with two steel hoops (rolled-out shop stock).
function makeBarrel(group, colliders, x, z) {
  const body = box(new THREE.CylinderGeometry(0.34, 0.3, 0.78, 12), barrelMat);
  body.position.set(x, 0.39, z);
  group.add(body);
  for (const by of [0.18, 0.6]) {
    const hoop = box(new THREE.CylinderGeometry(0.35, 0.35, 0.06, 12), barrelBandMat, false);
    hoop.position.set(x, by, z);
    group.add(hoop);
  }
  addCollider(colliders, x, z, 0.7, 0.7);
}

// Build a SUBSTANTIAL shop building: a real 3D brick volume with width, depth
// AND height (not a flat facade card). The storefront — sign, awning, door and
// big display windows — is built on the FRONT (+Z) face, then the whole building
// group is rotated by `ry` so that detailed front turns toward the central
// lane/plaza (ry=π → front points -Z; ry=0 → front points +Z).
//
//   x,z   centre of the building footprint (placed at the tile edge, off lanes)
//   ry    yaw so the +Z storefront face turns toward the lane
//   w,d,h building width / DEPTH / wall height (all generous — a real block)
//   text/bg  storefront sign
function makeShopBuilding(group, colliders, dummy, opts) {
  const { x, z, ry, w, d, h, text, bg, accent, wallMat } = opts;
  const b = new THREE.Group();
  b.position.set(x, 0, z);
  b.rotation.y = ry;
  group.add(b);

  // --- Main brick mass (full volume: width × depth × height) -------------
  const body = box(new THREE.BoxGeometry(w, h, d), wallMat);
  body.position.set(0, h / 2, 0);
  b.add(body);

  // Parapet cap + thin flat roof slab so it reads solid from above/behind.
  const parapet = box(new THREE.BoxGeometry(w + 0.4, 0.6, d + 0.4), parapetMat);
  parapet.position.set(0, h + 0.25, 0);
  b.add(parapet);
  const roof = box(new THREE.BoxGeometry(w - 0.2, 0.3, d - 0.2), shopRoofMat);
  roof.position.set(0, h + 0.05, 0);
  b.add(roof);
  // A little rooftop vent box for silhouette interest.
  const vent = box(new THREE.BoxGeometry(1.2, 0.9, 1.2), parapetMat);
  vent.position.set(w * 0.25, h + 0.6, -d * 0.15);
  b.add(vent);

  // --- Storefront on the FRONT (+Z) face ---------------------------------
  const fz = d / 2;        // front face plane
  // Ground-floor trim band that frames the shopfront.
  const band = box(new THREE.BoxGeometry(w - 0.3, 0.4, 0.18), trimMat, false);
  band.position.set(0, 2.7, fz + 0.06);
  b.add(band);

  // Big display windows flanking a central door (built proud of the wall).
  const winH = 1.9, winY = 1.45;
  const winW = (w - 2.4) / 2;
  for (const sx of [-1, 1]) {
    const frame = box(new THREE.BoxGeometry(winW + 0.2, winH + 0.2, 0.16), trimMat, false);
    frame.position.set(sx * (winW / 2 + 0.7), winY, fz + 0.05);
    b.add(frame);
    const glass = box(new THREE.BoxGeometry(winW, winH, 0.1), windowMat, false);
    glass.position.set(sx * (winW / 2 + 0.7), winY, fz + 0.12);
    b.add(glass);
  }
  // Central door.
  const door = box(new THREE.BoxGeometry(1.1, 2.3, 0.16), doorMat, false);
  door.position.set(0, 1.15, fz + 0.06);
  b.add(door);
  const doorFrame = box(new THREE.BoxGeometry(1.4, 2.5, 0.1), trimMat, false);
  doorFrame.position.set(0, 1.25, fz + 0.02);
  b.add(doorFrame);

  // --- Storefront awning over the shopfront (faces the lane) -------------
  const awnW = w - 0.6, awnDepth = 1.6;
  const awnMat = shopAwningMat.clone(); // one tinted clone per building (not per-frame)
  awnMat.color.set(accent);
  const awn = box(new THREE.BoxGeometry(awnW, 0.14, awnDepth), awnMat);
  awn.position.set(0, 3.05, fz + awnDepth / 2 - 0.1);
  awn.rotation.x = 0.22; // slope down toward the street
  b.add(awn);
  // Two small brackets holding the awning to the wall.
  for (const sx of [-1, 1]) {
    const br = box(new THREE.BoxGeometry(0.1, 0.1, awnDepth + 0.2), poleMat, false);
    br.position.set(sx * (awnW / 2 - 0.3), 3.2, fz + awnDepth / 2 - 0.1);
    br.rotation.x = 0.22;
    b.add(br);
  }

  // --- Storefront SIGN mounted on the front, ABOVE the awning -----------
  // artPanel faces +Z at local ry=0; the building group's ry rotation turns
  // this whole front toward the lane, so text reads correctly (not mirrored).
  const sign = artPanel(Math.min(w - 1.0, 4.0), 1.3, "sign", {
    text, bg, fg: "#fff7e8",
    emissiveIntensity: 0.55,
    file: `market-sign-${text.toLowerCase().replace(/\s+/g, "-")}.png`,
  });
  sign.position.set(0, h - 0.5, fz + 0.12);
  b.add(sign);

  // --- Footprint collider (axis-aligned AABB matching the rotated box) ----
  // ry is a multiple of ~90° for these placements, but to stay robust we take
  // the rotated extent of the (w × d) footprint around (x,z).
  const cos = Math.abs(Math.cos(ry)), sin = Math.abs(Math.sin(ry));
  const exX = (w * cos + d * sin);
  const exZ = (w * sin + d * cos);
  addCollider(colliders, x, z, exX, exZ);
}

// Build a small ENTERABLE deli/grocery shop the player can walk INTO. Unlike the
// solid storefront blocks above, this is a hollow room: 4 walls (with a doorway
// GAP in the street-facing wall), a floor and a flat ceiling, plus cozy themed
// interior content. Each WALL gets its own AABB collider (back + two sides + the
// two short front segments flanking the door) — and crucially NO collider spans
// the doorway gap, so the player enters through the door and the interior stays
// walkable.
//
//   cx,cz       centre of the room footprint (placed in a clear open quadrant)
//   w,d,h       interior-ish room WIDTH (X) / DEPTH (Z) / wall HEIGHT
//   doorW       width of the doorway gap in the front (street-facing) wall
//   frontZsign  +1 if the front (door) wall faces +Z, -1 if it faces -Z
//               (the doorway must open toward the central lane / street at z≈0)
function makeDeliShop(group, colliders, dummy, col, opts) {
  const {
    cx, cz, w, d, h, doorW, frontZsign,
    outerText = "CORNER DELI", outerBg = "#8d0801",
    innerText = "DELI MENU", innerBg = "#2d6a4f",
    goodsColors = DELI_GOODS_COLORS,
  } = opts;
  const t = 0.25;                       // wall thickness
  const halfW = w / 2, halfD = d / 2;
  const shop = new THREE.Group();
  shop.position.set(cx, 0, cz);
  group.add(shop);

  // Wall Z planes: the front (door) wall sits on the side facing the street.
  const frontZ = frontZsign * halfD;    // street-facing wall plane (local Z)
  const backZ = -frontZsign * halfD;    // opposite wall plane

  // --- Floor + flat ceiling (roof) ---------------------------------------
  const floor = box(new THREE.BoxGeometry(w, 0.12, d), delFloorMat, false);
  floor.position.set(0, 0.06, 0);
  floor.receiveShadow = true;
  shop.add(floor);
  const ceil = box(new THREE.BoxGeometry(w + t, 0.18, d + t), delCeilMat);
  ceil.position.set(0, h + 0.09, 0);
  shop.add(ceil);

  // --- Walls (each its OWN AABB collider; NONE across the doorway) --------
  // Back wall (full span).
  const back = box(new THREE.BoxGeometry(w + t, h, t), delWallMat);
  back.position.set(0, h / 2, backZ);
  shop.add(back);
  addCollider(colliders, cx, cz + backZ, w + t, t);

  // Two side walls (run along Z, full depth).
  for (const sx of [-1, 1]) {
    const side = box(new THREE.BoxGeometry(t, h, d), delWallMat);
    side.position.set(sx * halfW, h / 2, 0);
    shop.add(side);
    addCollider(colliders, cx + sx * halfW, cz, t, d);
  }

  // Front (street-facing) wall: TWO short segments flanking a doorway GAP.
  // gap is centered at x=0; each flank runs from |x|=doorW/2 to |x|=halfW.
  const segW = halfW - doorW / 2;       // width of each front-wall segment
  if (segW > 0.01) {
    const segCx = (doorW / 2 + halfW) / 2; // centre of one flank segment
    for (const sx of [-1, 1]) {
      const seg = box(new THREE.BoxGeometry(segW, h, t), delWallMat);
      seg.position.set(sx * segCx, h / 2, frontZ);
      shop.add(seg);
      addCollider(colliders, cx + sx * segCx, cz + frontZ, segW, t);
    }
  }
  // A slim lintel header spanning ABOVE the doorway (no collider — it is up high,
  // the gap below it is the walkable opening).
  const lintel = box(new THREE.BoxGeometry(doorW + 0.1, h - 2.2, t), delWallMat);
  lintel.position.set(0, h - (h - 2.2) / 2, frontZ);
  shop.add(lintel);

  // --- Service COUNTER along the back wall, with a steel top --------------
  const counterD = 0.9;
  const ccz = backZ + frontZsign * (counterD / 2 + 0.35); // inside the room, off back wall
  const counter = box(new THREE.BoxGeometry(w - 1.8, 1.0, counterD), delCounterMat);
  counter.position.set(0, 0.5, ccz);
  shop.add(counter);
  const ctop = box(new THREE.BoxGeometry(w - 1.6, 0.08, counterD + 0.15), delCounterTopMat);
  ctop.position.set(0, 1.04, ccz);
  shop.add(ctop);

  // --- DISPLAY CASE (refrigerated deli case) at the front of the counter --
  const caseBody = box(new THREE.BoxGeometry(w - 2.4, 0.7, 0.55), delCounterMat);
  const caseCz = ccz + frontZsign * 0.85;
  caseBody.position.set(0, 0.55, caseCz);
  shop.add(caseBody);
  const caseGlass = box(new THREE.BoxGeometry(w - 2.5, 0.5, 0.45), delCaseGlassMat, false);
  caseGlass.position.set(0, 1.05, caseCz);
  shop.add(caseGlass);

  // --- SHELVES of little products on BOTH side walls ----------------------
  // Two shelf boards per side at different heights, with instanced goods on top.
  const shelfLen = d - 1.4;
  const shelfYs = [1.1, 1.85];
  const goodsCount = shelfYs.length * 2 * 6;  // 6 goods per shelf board
  const goods = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.28, 0.34, 0.28),
    new THREE.MeshStandardMaterial({ roughness: 0.75, flatShading: true }),
    goodsCount
  );
  goods.castShadow = true;
  let gi = 0;
  for (const sx of [-1, 1]) {
    const shelfX = sx * (halfW - 0.32);
    for (const sy of shelfYs) {
      const board = box(new THREE.BoxGeometry(0.34, 0.05, shelfLen), delShelfMat);
      board.position.set(shelfX, sy, 0);
      shop.add(board);
      // little bracket under each shelf
      const brkt = box(new THREE.BoxGeometry(0.3, 0.3, 0.06), delShelfMat, false);
      brkt.position.set(shelfX, sy - 0.18, 0);
      shop.add(brkt);
      // products lined up on the board
      for (let p = 0; p < 6; p++) {
        const gz = -shelfLen / 2 + 0.4 + p * (shelfLen - 0.8) / 5;
        dummy.position.set(shelfX, sy + 0.2, gz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 0.7 + ((p + (sx > 0 ? 3 : 0)) % 3) * 0.25, 1);
        dummy.updateMatrix();
        goods.setMatrixAt(gi, dummy.matrix);
        goods.setColorAt(gi, col.set(goodsColors[(p + gi) % goodsColors.length]));
        gi++;
      }
    }
  }
  dummy.scale.set(1, 1, 1);
  goods.instanceMatrix.needsUpdate = true;
  if (goods.instanceColor) goods.instanceColor.needsUpdate = true;
  shop.add(goods);

  // --- A standing produce/bread RACK near a front corner ------------------
  const rackX = (halfW - 0.7) * -1;            // tuck in one front corner
  const rackZ = frontZ - frontZsign * 1.1;
  const rack = box(new THREE.BoxGeometry(0.8, 1.4, 0.8), delShelfMat);
  rack.position.set(rackX, 0.7, rackZ);
  shop.add(rack);
  const rackGoods = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.13, 8, 6),
    new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }),
    9
  );
  rackGoods.castShadow = true;
  let rgi = 0;
  for (let ly = 0; ly < 3; ly++) {
    for (let p = 0; p < 3; p++) {
      dummy.position.set(rackX + (p - 1) * 0.22, 0.55 + ly * 0.4, rackZ + (p % 2 ? 0.12 : -0.12));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      rackGoods.setMatrixAt(rgi, dummy.matrix);
      rackGoods.setColorAt(rgi, col.set(goodsColors[(ly + p) % goodsColors.length]));
      rgi++;
    }
  }
  rackGoods.instanceMatrix.needsUpdate = true;
  if (rackGoods.instanceColor) rackGoods.instanceColor.needsUpdate = true;
  shop.add(rackGoods);

  // --- A couple of STOOLS by the counter ----------------------------------
  for (const sx of [-1.0, 1.0]) {
    const seat = box(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12), delStoolMat);
    const stz = caseCz + frontZsign * 0.9;
    seat.position.set(sx, 0.62, stz);
    shop.add(seat);
    const leg = box(new THREE.CylinderGeometry(0.05, 0.06, 0.62, 8), delStoolLegMat, false);
    leg.position.set(sx, 0.31, stz);
    shop.add(leg);
  }

  // --- RUG in the middle of the floor -------------------------------------
  const rug = box(new THREE.BoxGeometry(w - 2.6, 0.04, d - 3.0), delRugMat, false);
  rug.position.set(0, 0.13, frontZsign * 0.4);
  rug.receiveShadow = true;
  shop.add(rug);

  // --- Hanging interior LIGHTS (two pendant bulbs) ------------------------
  for (const lz of [-1.4, 1.4]) {
    const cord = box(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), delStoolLegMat, false);
    cord.position.set(0, h - 0.25, lz);
    shop.add(cord);
    const bulb = box(new THREE.SphereGeometry(0.16, 10, 8), delLightMat, false);
    bulb.position.set(0, h - 0.55, lz);
    shop.add(bulb);
  }

  // --- Interior wall SIGNAGE on the back wall (faces into the room) -------
  // The panel faces +Z by default; flip it by π when the room's interior is on
  // the -Z side of the back wall so the text reads correctly to a player inside.
  const innerSign = artPanel(2.6, 0.9, "sign", {
    text: innerText, bg: innerBg, fg: "#f7fff7",
    emissiveIntensity: 0.3,
    file: `market-inner-${innerText.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
  });
  innerSign.position.set(0, 2.3, backZ + frontZsign * 0.14);
  // Back wall is on the -frontZsign side; its inward face points +frontZsign.
  // artPanel front is +Z, so flip when frontZsign is -1.
  if (frontZsign < 0) innerSign.rotation.y = Math.PI;
  shop.add(innerSign);

  // --- Exterior shop SIGN above the door, FACING THE STREET ---------------
  // Front wall faces frontZsign·Z toward the lane. artPanel front is +Z, so flip
  // when the front faces -Z to keep the text un-mirrored to a player on the street.
  const outerSign = artPanel(3.2, 1.1, "sign", {
    text: outerText, bg: outerBg, fg: "#fff3b0",
    emissiveIntensity: 0.5,
    file: `market-outer-${outerText.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
  });
  outerSign.position.set(0, h + 0.4, frontZ + frontZsign * 0.16);
  if (frontZsign < 0) outerSign.rotation.y = Math.PI;
  shop.add(outerSign);
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
  // Outer stalls pulled to |x|=20.5 so their 4.4 m collider (x±2.2) ends at
  // |x|=22.7 — inside the ±23 setback that clears the seam road + sidewalk.
  const stallX = [-20.5, -10.5, 0, 10.5, 20.5];
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
  // faceZ is the lane-facing direction of each row: near row (z=+9) faces -Z,
  // far row (z=-9) faces +Z. The panel's FRONT must point along faceZ toward the
  // lane, otherwise its DoubleSide back shows MIRRORED text to the player.
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
    // tilt the top slightly back toward the stall; turn the front to face the lane
    panel.rotation.x = p.faceZ < 0 ? 0.16 : -0.16;
    if (p.faceZ < 0) panel.rotation.y = Math.PI; // near row: front must point -Z
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
  const colXs = [-20.5, -10.5, 0, 10.5, 20.5]; // match the (set-in) stall columns
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

  // --- Street-level flavor: benches, planters & barrels (lived-in) --------
  // BENCHES face the central lane from the open gaps BETWEEN stalls, at z=±6
  // (outside the 8 m lane, in front of — but clear of — the stall produce at
  // z≈7.4). Near row (z=+6) opens toward -Z (ry=π); far row (z=-6) opens +Z.
  for (const bx of [-15.5, -5, 5, 15.5]) {
    makeBench(group, colliders, bx, 6, Math.PI); // near row, seat faces the lane
    makeBench(group, colliders, bx, -6, 0);      // far row, seat faces the lane
  }

  // PLANTERS flank each ENTERABLE shop's doorway (greenery either side of the
  // door). South deli door front sits at z=-15 (opens +Z); the two north shops'
  // doors sit at z=15 (open -Z). All planter spots are clear of hall columns
  // (|z|=11.6) and inside the ±23 setback.
  for (const px of [-1.9, 1.9]) makePlanter(group, colliders, px, -13.9);          // south deli
  for (const px of [-5.75 - 1.7, -5.75 + 1.7]) makePlanter(group, colliders, px, 13.9); // cheese shop
  for (const px of [5.75 - 1.7, 5.75 + 1.7]) makePlanter(group, colliders, px, 13.9);   // flower shop

  // BARRELS & crate stacks set out as shop stock beside the storefront blocks,
  // tucked into the clear gaps in front of the building fronts (|z|≈14.5).
  makeBarrel(group, colliders, -9.6, 14.0);    // gap between CHEESE SHOP & FRESH GROCER
  makeBarrel(group, colliders, 12.0, 14.0);    // in front of CORNER MART frontage
  makeBarrel(group, colliders, -8.4, -14.2);   // by the south DELI/BAKERY gap
  makeBarrel(group, colliders, 8.4, -14.2);
  // A short stack of two crates beside the south deli doorway (reuses crateGeo).
  for (const [stx, stz, sty] of [[3.6, -13.8, 0.27], [3.6, -13.8, 0.82], [4.25, -13.6, 0.27]]) {
    const cr = box(crateGeo, crateMat);
    cr.position.set(stx, sty, stz);
    cr.rotation.y = 0.3;
    group.add(cr);
  }
  addCollider(colliders, 3.85, -13.7, 1.4, 1.0);

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

  // --- Substantial shop buildings flanking the street ---------------------
  // Four full-volume brick storefronts anchor the tile edges (set BACK from the
  // seam-road grid). Each is a real 3D block — generous WIDTH, DEPTH and HEIGHT —
  // with its detailed storefront (sign, awning, door, display windows) on the
  // FRONT face turned toward the central lane (z≈0):
  //   • north buildings (z>0): front points -Z → ry = π
  //   • south buildings (z<0): front points +Z → ry = 0
  // SETBACK: a road grid runs on the TILE SEAMS (avenues at world X=-60,0,60;
  // cross-streets at world Z=35,95,155,215), each ~12 m wide + kerb/sidewalk.
  // To clear that road every footprint (and its collider) must stay within LOCAL
  // X,Z ∈ [-23,23] — a ~7 m setback from each of the four tile edges ([-30,30]).
  // X is already inside ±23 for all four; the buildings sat at |z|=21 which let a
  // d=8 footprint reach z=±25 (into the cross-street). Pull them in to |z|=18.5
  // so the BACK face sits ≤22.5 (clear of the road+sidewalk) while the FRONT face
  // (|z|≈14.5) still clears the hall columns at z=±11.6 and the stalls at z=±9.
  makeShopBuilding(group, colliders, dummy, {
    x: -16, z: 18.5, ry: Math.PI, w: 11, d: 8, h: 6.6,
    text: "FRESH GROCER", bg: "#2f9e6e", accent: "#2f9e6e", wallMat: brickMat,
  });
  makeShopBuilding(group, colliders, dummy, {
    x: 14, z: 18.5, ry: Math.PI, w: 10, d: 7.5, h: 7.2,
    text: "CORNER MART", bg: "#3f7fd0", accent: "#3f7fd0", wallMat: stuccoMat,
  });
  makeShopBuilding(group, colliders, dummy, {
    x: -14, z: -18.5, ry: 0, w: 10, d: 7.5, h: 6.2,
    text: "BAKERY", bg: "#c4302b", accent: "#c4302b", wallMat: brickMat,
  });
  makeShopBuilding(group, colliders, dummy, {
    x: 16, z: -18.5, ry: 0, w: 11, d: 8, h: 7.0,
    text: "DELI", bg: "#e8a93a", accent: "#e8a93a", wallMat: brickMat2,
  });

  // --- ENTERABLE deli/grocery shop (a hollow room the player walks INTO) ---
  // Tucked into the open SOUTH-CENTRE quadrant between the BAKERY (right edge
  // x≈-9) and DELI (left edge x≈10.5) storefronts, set back so it clears the
  // hall columns (z=±11.6) and stalls (z=±9). The door faces +Z toward the
  // central lane/street. Room: 8 m wide × 7 m deep, walls 3.2 m tall, 2.2 m
  // doorway. Footprint x∈[-4.1,4.1], z∈[-22.1,-15] — all inside [-23,23].
  makeDeliShop(group, colliders, dummy, col, {
    cx: 0, cz: -18.5, w: 8, d: 7, h: 3.2, doorW: 2.2, frontZsign: 1,
  });

  // --- A FOURTH enterable shop fills the open SOUTH-EAST market slot ---------
  // The south side has a ~6.5 m gap between the enterable DELI room (right edge
  // x≈4) and the solid DELI storefront block (left edge x≈10.5). A small FISH
  // MARKET room slots in there with its door facing +Z toward the central lane.
  // Room: 5.4 m wide × 7 m deep → footprint x∈[4.4,9.8], z∈[-22,-15] — inside
  // [-23,23], clear of the hall columns (z=±11.6) and stalls (z=±9), and not
  // overlapping the deli room (x≤4.1) or the DELI block (x≥10.5). It registers
  // only its own four wall AABBs (none across the doorway gap), so the player
  // walks straight in; the nearby barrel/crate stock sits in front un-blocked.
  makeDeliShop(group, colliders, dummy, col, {
    cx: 7.1, cz: -18.5, w: 5.4, d: 7, h: 3.2, doorW: 1.8, frontZsign: 1,
    outerText: "FISH MARKET", outerBg: "#2f6f8d",
    innerText: "FRESH CATCH", innerBg: "#1d5a7a",
    goodsColors: ["#bcd4dd", "#8fb3c0", "#cfe0e6", "#7a98a4", "#e8efe4", "#5f7e8a"],
  });

  // --- TWO MORE enterable shops along the open NORTH gap ------------------
  // The north side has a wide clear gap between FRESH GROCER (right edge x≈-10.5)
  // and CORNER MART (left edge x≈9). Two themed rooms sit side-by-side there,
  // their doorways facing -Z toward the central lane (frontZsign = -1). Each is
  // 6 m wide × 7 m deep, set back to cz=18.5 so the front (z≈15) clears the hall
  // columns (z=11.6) and stalls (z=9), while the back (z≈22) stays inside the
  // ±23 setback. A ~5.5 m walkable alley remains between them (x∈[-2.75,2.75]).
  //   • CHEESE SHOP  — west: cx=-5.75 → x∈[-8.75,-2.75] (1.75 m gap to GROCER)
  //   • FLOWER SHOP  — east: cx= 5.75 → x∈[ 2.75, 8.75] (0.25 m gap to MART)
  makeDeliShop(group, colliders, dummy, col, {
    cx: -5.75, cz: 18.5, w: 6, d: 7, h: 3.2, doorW: 2.0, frontZsign: -1,
    outerText: "CHEESE SHOP", outerBg: "#b5651d",
    innerText: "TODAY'S CHEESE", innerBg: "#9c6b1f",
    goodsColors: ["#f3d27a", "#e8c25a", "#f7e7a8", "#d9b24a", "#caa46a", "#e8efe4"],
  });
  makeDeliShop(group, colliders, dummy, col, {
    cx: 5.75, cz: 18.5, w: 6, d: 7, h: 3.2, doorW: 2.0, frontZsign: -1,
    outerText: "FLOWER SHOP", outerBg: "#2f9e6e",
    innerText: "FRESH BLOOMS", innerBg: "#7a2f6b",
    goodsColors: ["#e0473c", "#e8b53a", "#a44fc0", "#3f7fd0", "#e8742a", "#5fae3f"],
  });

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
