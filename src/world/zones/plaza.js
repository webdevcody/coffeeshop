// Town Plaza district — a paved public square centered on the origin, filling a
// 60×60 m tile (X,Z ∈ [-30,30]). A central circular fountain with animated
// rising water and a spinning ripple ring is the focal point. The square is now
// FRAMED by three SUBSTANTIAL civic/commercial buildings along its north and
// west edges — each a real full 3D VOLUME with genuine width, depth AND height
// (no thin slab facades): a corner clock-tower hall, a two-storey civic block,
// and a café/shop block. Every building reads solid from front, side AND back,
// has a recessed glazed shopfront + door, an awning, a cornice + parapet,
// instanced upper-floor windows, rooftop clutter, and a readable sign mounted on
// the FRONT facing the plaza/avenue. The remaining edges keep two double-faced
// billboards. Benches, planters, lamp posts dress the open square. Warm vibe.
//
// buildPlaza() returns:
//   group     — THREE.Group of all LOCAL meshes (centered on origin)
//   colliders — AABBs { minX,maxX,minZ,maxZ } for solid props (buildings,
//               fountain, posts…); every building footprint matches its volume
//   ground    — walkable rects; includes the full tile rect
//   update(dt)— advances the fountain water, a slow foliage sway, spins the
//               clock-tower hands and flickers the building signs
//
// Coordinates: right-handed, Y-up. Ground is the XZ plane at y=0. Buildings hug
// the north (local -Z) and west (local -X) edges with their fronts facing INTO
// the square; the centre stays a wide (>=6 m) open lane so a car can drive across
// the plaza in any direction. Footprints are pulled back out of the road lanes.

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

// --- Shared geometry (created ONCE, reused across repeated props) -----------
const G = {
  benchSeat: new THREE.BoxGeometry(1.8, 0.16, 0.5),
  benchLeg: new THREE.BoxGeometry(0.16, 0.42, 0.5),
  benchBack: new THREE.BoxGeometry(1.8, 0.5, 0.12),
  planterBox: new THREE.BoxGeometry(1.6, 0.6, 1.6),
  shrub: new THREE.IcosahedronGeometry(0.62, 0),
  shrubTop: new THREE.IcosahedronGeometry(0.42, 0),
  lampPole: new THREE.CylinderGeometry(0.09, 0.11, 4.4, 8),
  lampBase: new THREE.CylinderGeometry(0.22, 0.26, 0.4, 10),
  lampHead: new THREE.SphereGeometry(0.28, 14, 12),
  pole: new THREE.CylinderGeometry(0.12, 0.12, 5.2, 8),
  poleBase: new THREE.BoxGeometry(0.5, 0.4, 0.5),
  // Building detail geometry (shared/instanced)
  winPane: new THREE.BoxGeometry(1.0, 1.4, 0.14),   // upper-floor window pane
  winFrame: new THREE.BoxGeometry(1.22, 1.62, 0.08),// window frame
  acUnit: new THREE.BoxGeometry(1.4, 0.7, 1.0),     // rooftop AC unit
  ventPipe: new THREE.CylinderGeometry(0.12, 0.12, 1.4, 8),
  // Flower/gift KIOSK repeats (instanced where many)
  bloom: new THREE.IcosahedronGeometry(0.13, 0),    // a single flower head
  stem: new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5),
  potRim: new THREE.CylinderGeometry(0.16, 0.12, 0.22, 10),
  giftBox: new THREE.BoxGeometry(0.34, 0.3, 0.34),
};

// --- Shared materials (created ONCE) ---------------------------------------
const M = {
  pavement: new THREE.MeshStandardMaterial({ color: "#b9b2a4", roughness: 0.96 }),
  pavementRing: new THREE.MeshStandardMaterial({ color: "#a89c86", roughness: 0.95 }),
  slabSide: new THREE.MeshStandardMaterial({ color: "#8d8676", roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: "#cdc6b6", roughness: 0.9 }),
  // Double-sided stone for OPEN-ENDED surfaces (the open-top basin wall ring):
  // its inner face must render when viewed from across/inside the fountain,
  // otherwise the single-sided ring vanishes edge-on / from the back.
  stoneWall: new THREE.MeshStandardMaterial({ color: "#cdc6b6", roughness: 0.9, side: THREE.DoubleSide }),
  stoneDark: new THREE.MeshStandardMaterial({ color: "#9a9384", roughness: 0.95 }),
  water: new THREE.MeshStandardMaterial({
    color: "#4fb6d8", roughness: 0.25, metalness: 0.15,
    transparent: true, opacity: 0.85,
    emissive: "#1d6f8f", emissiveIntensity: 0.25,
  }),
  jet: new THREE.MeshStandardMaterial({
    color: "#bfeefc", roughness: 0.2,
    transparent: true, opacity: 0.7,
    emissive: "#9fe0f5", emissiveIntensity: 0.3,
  }),
  benchWood: new THREE.MeshStandardMaterial({ color: "#a0683a", roughness: 0.7 }),
  benchMetal: new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.6 }),
  planter: new THREE.MeshStandardMaterial({ color: "#8a5a34", roughness: 0.85 }),
  foliage: new THREE.MeshStandardMaterial({ color: "#4f9d57", roughness: 0.9, flatShading: true }),
  foliageHi: new THREE.MeshStandardMaterial({ color: "#6cb86a", roughness: 0.9, flatShading: true }),
  poleMat: new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.5, metalness: 0.7 }),
  lampGlass: new THREE.MeshStandardMaterial({
    color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 0.9, roughness: 0.4,
  }),
  // --- Building materials ---------------------------------------------------
  wallA: new THREE.MeshStandardMaterial({ color: "#d8c7a8", roughness: 0.92, flatShading: true }), // warm stone (hall)
  wallB: new THREE.MeshStandardMaterial({ color: "#c2cdd0", roughness: 0.92, flatShading: true }), // pale civic
  wallC: new THREE.MeshStandardMaterial({ color: "#cf9f74", roughness: 0.92, flatShading: true }), // terracotta café
  base: new THREE.MeshStandardMaterial({ color: "#7c7468", roughness: 0.95 }),                      // plinth/base course
  cornice: new THREE.MeshStandardMaterial({ color: "#efe7d6", roughness: 0.75 }),                   // pale trim band
  trim: new THREE.MeshStandardMaterial({ color: "#5a5048", roughness: 0.8 }),                       // dark trim / parapet
  roof: new THREE.MeshStandardMaterial({ color: "#3c3f46", roughness: 0.85 }),
  bulkhead: new THREE.MeshStandardMaterial({ color: "#3a352f", roughness: 0.85 }),                  // shopfront fascia band
  door: new THREE.MeshStandardMaterial({ color: "#2b2622", roughness: 0.55, metalness: 0.2 }),
  glass: new THREE.MeshStandardMaterial({
    color: "#9fc4d6", roughness: 0.18, metalness: 0.4,
    emissive: "#3a4d57", emissiveIntensity: 0.25,
  }),
  winLit: new THREE.MeshStandardMaterial({
    color: "#cdb27a", roughness: 0.35, metalness: 0.2,
    emissive: "#ffca6a", emissiveIntensity: 0.5, flatShading: true,
  }),
  metal: new THREE.MeshStandardMaterial({ color: "#8c8f95", roughness: 0.6, metalness: 0.8, flatShading: true }),
  awnGreen: new THREE.MeshStandardMaterial({ color: "#2f8f88", roughness: 0.85, side: THREE.DoubleSide }),
  awnRed: new THREE.MeshStandardMaterial({ color: "#c4423b", roughness: 0.85, side: THREE.DoubleSide }),
  awnAmber: new THREE.MeshStandardMaterial({ color: "#d79a3a", roughness: 0.85, side: THREE.DoubleSide }),
  clockFace: new THREE.MeshStandardMaterial({
    color: "#f3ead2", roughness: 0.6, emissive: "#d8c89a", emissiveIntensity: 0.3,
  }),
  clockHand: new THREE.MeshStandardMaterial({ color: "#23201b", roughness: 0.5 }),
  // --- Flower/gift KIOSK interior materials --------------------------------
  shopWall: new THREE.MeshStandardMaterial({ color: "#f3e6d2", roughness: 0.95, side: THREE.DoubleSide }), // creamy plaster (see inside + out)
  shopFloor: new THREE.MeshStandardMaterial({ color: "#caa97e", roughness: 0.9 }),                          // warm timber floor
  shopRoof: new THREE.MeshStandardMaterial({ color: "#6f5b46", roughness: 0.85, side: THREE.DoubleSide }),  // dark beam ceiling
  shopTrim: new THREE.MeshStandardMaterial({ color: "#3f7d54", roughness: 0.7 }),                           // florist green trim
  counter: new THREE.MeshStandardMaterial({ color: "#9c6a3c", roughness: 0.6 }),                            // counter wood
  counterTop: new THREE.MeshStandardMaterial({ color: "#d8c7a8", roughness: 0.4 }),                         // pale stone top
  shelfWood: new THREE.MeshStandardMaterial({ color: "#b5854f", roughness: 0.75 }),
  rug: new THREE.MeshStandardMaterial({ color: "#b34a52", roughness: 0.95 }),                               // rose-red rug
  stool: new THREE.MeshStandardMaterial({ color: "#586d4a", roughness: 0.7 }),
  vase: new THREE.MeshStandardMaterial({ color: "#cfe5ec", roughness: 0.35, metalness: 0.1 }),
  bloomA: new THREE.MeshStandardMaterial({ color: "#e85d8a", roughness: 0.8, flatShading: true }),          // pink blooms
  bloomB: new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.8, flatShading: true }),          // yellow blooms
  bloomC: new THREE.MeshStandardMaterial({ color: "#b06fd6", roughness: 0.8, flatShading: true }),          // violet blooms
  stem: new THREE.MeshStandardMaterial({ color: "#3f7d54", roughness: 0.85, flatShading: true }),
  gift: new THREE.MeshStandardMaterial({ color: "#d24b6a", roughness: 0.6 }),                               // wrapped gift box
  giftLid: new THREE.MeshStandardMaterial({ color: "#f3d9a0", roughness: 0.6 }),                            // ribbon/lid
  caseGlass: new THREE.MeshStandardMaterial({
    color: "#bfe0ea", roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.32, side: THREE.DoubleSide,
  }),
  shopLight: new THREE.MeshStandardMaterial({
    color: "#fff3cf", emissive: "#ffdf9a", emissiveIntensity: 1.0, roughness: 0.4,
  }),
};

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// A scaled box from a fresh BoxGeometry (buildings use varied, one-off sizes; the
// repeated bits — windows, AC, vents — use the shared instanced geometry above).
function box(w, h, d, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// --- Prop builders ----------------------------------------------------------
function makeBench() {
  const g = new THREE.Group();
  const seat = mesh(G.benchSeat, M.benchWood);
  seat.position.y = 0.46;
  const back = mesh(G.benchBack, M.benchWood);
  back.position.set(0, 0.72, -0.19);
  const legL = mesh(G.benchLeg, M.benchMetal);
  legL.position.set(-0.78, 0.21, 0);
  const legR = mesh(G.benchLeg, M.benchMetal);
  legR.position.set(0.78, 0.21, 0);
  g.add(seat, back, legL, legR);
  return g;
}

function makePlanter(swayList) {
  const g = new THREE.Group();
  const box1 = mesh(G.planterBox, M.planter);
  box1.position.y = 0.3;
  g.add(box1);
  // a couple of flat-shaded shrubs clustered in the planter
  const offs = [
    [-0.28, 0.92, -0.2, G.shrub, M.foliage],
    [0.2, 1.12, 0.12, G.shrubTop, M.foliageHi],
  ];
  for (const [x, y, z, geo, mat] of offs) {
    const s = mesh(geo, mat);
    s.position.set(x, y, z);
    s.rotation.y = Math.random() * Math.PI;
    g.add(s);
    swayList.push({ obj: s, base: s.rotation.z, phase: Math.random() * Math.PI * 2 });
  }
  return g;
}

function makeLamp() {
  const g = new THREE.Group();
  const base = mesh(G.lampBase, M.poleMat);
  base.position.y = 0.2;
  const pole = mesh(G.lampPole, M.poleMat);
  pole.position.y = 2.4;
  const head = mesh(G.lampHead, M.lampGlass, true, false);
  head.position.y = 4.7;
  g.add(base, pole, head);
  return g;
}

// A double-FACED billboard: pole + base, a thin opaque backing board, and a
// readable artPanel mounted on EACH side of the board so the (un-mirrored)
// front face is visible from both the bordering street AND the square — no
// matter which way the structure is turned. artPanel() planes face +Z by
// default and only the +Z side shows un-mirrored text; the back side mirrors
// it. Mounting one panel facing +Z and a second facing -Z (rotated 180°, lifted
// just off the board so they don't z-fight) gives a correct, readable face on
// both sides.
function makeBillboard(w, h, opts) {
  const g = new THREE.Group();
  const pole = mesh(G.pole, M.poleMat);
  pole.position.y = 2.6;
  const baseBlk = mesh(G.poleBase, M.poleMat);
  baseBlk.position.y = 0.2;
  // Slim opaque backing board the two ad faces sandwich (gives the sign mass so
  // it never reads as an infinitely-thin floating plane edge-on).
  const board = mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.18), M.poleMat);
  board.position.set(0, 5.2, 0);
  const front = artPanel(w, h, "billboard", opts);   // faces +Z
  front.position.set(0, 5.2, 0.12);
  front.castShadow = false;
  const back = artPanel(w, h, "billboard", opts);    // faces -Z
  back.position.set(0, 5.2, -0.12);
  back.rotation.y = Math.PI;
  back.castShadow = false;
  g.add(pole, baseBlk, board, front, back);
  return g;
}

// ===========================================================================
// FULL-VOLUME BUILDING BUILDER
// ===========================================================================
// Builds ONE substantial building as a real 3D box volume with WIDTH (w, along
// the building's local X) × DEPTH (d, along local +Z toward its back) × HEIGHT
// (h). The detailed FRONT (recessed glazed shopfront, door, awning, fascia sign,
// cornice) sits on the -Z (local) face; upper-floor windows are instanced. The
// whole group is rotated by `ry` and placed so its FRONT faces the plaza/avenue.
//
// IMPORTANT: every building is solid on all four sides — the wall slab is a full
// box (w×h×d), so it reads as a real block from front, side and back. It is NOT
// a flat panel. Returns { group, signPanels[], footprint:{w,d} } so the caller
// can add a footprint collider matching the FULL volume (not just the facade).
//
// Window instancing is deferred: the builder pushes window placements (local,
// pre-rotation) onto `winList` so the caller can build ONE InstancedMesh across
// all buildings.
function makeBuilding(opts, winList) {
  const {
    w, d, h,                       // full volume dimensions (metres)
    wallMat, awnMat, sign, bg, emis,
    cols = 4,                      // upper-floor window columns across the front
    floors = 1,                    // rows of upper-floor windows
    gf = 3.4,                      // ground-floor (shopfront) height
  } = opts;
  const g = new THREE.Group();
  const half = w / 2;
  const frontZ = -d / 2;           // local front face (-Z)

  // --- Solid wall block: the full w×h×d volume (reads solid from ALL sides) --
  const body = box(w, h, d, wallMat);
  body.position.set(0, h / 2, 0);
  g.add(body);

  // base course / plinth wrapping the bottom so the building sits on the ground
  const plinth = box(w + 0.3, 0.6, d + 0.3, M.base);
  plinth.position.set(0, 0.3, 0);
  g.add(plinth);

  // --- Shopfront fascia band (bulkhead) above the ground floor, on the front --
  const bulk = box(w - 0.2, 0.6, 0.4, M.bulkhead, false);
  bulk.position.set(0, gf - 0.1, frontZ - 0.18);
  g.add(bulk);

  // --- Recessed glazed shopfront: a central door flanked by display windows ---
  const doorW = 1.6;
  const sideW = (w - doorW - 1.6) / 2;
  if (sideW > 0.8) {
    for (const sx of [-(doorW / 2 + sideW / 2 + 0.2), (doorW / 2 + sideW / 2 + 0.2)]) {
      const win = box(sideW, 2.2, 0.16, M.glass, false);
      win.position.set(sx, 1.7, frontZ - 0.16);
      g.add(win);
      const sill = box(sideW + 0.12, 0.35, 0.5, M.bulkhead, false);
      sill.position.set(sx, 0.4, frontZ - 0.1);
      g.add(sill);
      // dark mullion frame around the display window
      const wframe = box(sideW + 0.18, 2.45, 0.1, M.door, false);
      wframe.position.set(sx, 1.7, frontZ - 0.1);
      g.add(wframe);
    }
  }
  // recessed glass double-door with a dark frame
  const door = box(doorW, 2.7, 0.12, M.glass, false);
  door.position.set(0, 1.35, frontZ - 0.14);
  g.add(door);
  const dframe = box(doorW + 0.3, 2.95, 0.16, M.door, false);
  dframe.position.set(0, 1.45, frontZ - 0.08);
  g.add(dframe);
  // a low entry step so the doorway reads as a real threshold, not floating glass
  const step = box(doorW + 0.8, 0.18, 0.9, M.cornice);
  step.position.set(0, 0.09, frontZ - 0.55);
  g.add(step);

  // --- Cornice band between the ground floor and the upper storeys -----------
  const cornice = box(w + 0.25, 0.5, d + 0.25, M.cornice, false);
  cornice.position.set(0, gf + 0.4, 0);
  g.add(cornice);

  // --- Parapet cap around the whole roofline (wraps all sides) ---------------
  const parapet = box(w + 0.25, 0.7, d + 0.25, M.trim, false);
  parapet.position.set(0, h + 0.05, 0);
  g.add(parapet);
  // recessed flat roof deck just inside the parapet (so the top isn't open)
  const roofDeck = box(w - 0.3, 0.2, d - 0.3, M.roof, false);
  roofDeck.position.set(0, h - 0.1, 0);
  g.add(roofDeck);

  // --- Striped awning jutting over the shopfront (front face) ----------------
  const awnW = w - 1.2;
  const canopy = box(awnW, 0.12, 1.8, awnMat, false);
  canopy.rotation.x = -0.32;
  canopy.position.set(0, gf - 0.5, frontZ - 1.0);
  g.add(canopy);
  const valance = box(awnW, 0.4, 0.06, awnMat, false);
  valance.position.set(0, gf - 0.95, frontZ - 1.85);
  g.add(valance);

  // --- Upper-floor windows: queued for the shared InstancedMesh -------------
  // Distributed evenly across the front face on each upper storey. Stored in the
  // building's LOCAL frame plus the group's ry so the caller can bake world-ish
  // local matrices into a single instanced mesh.
  const usableTop = h - 0.9;            // below the parapet
  const floorGap = (usableTop - (gf + 1.0)) / floors;
  for (let f = 0; f < floors; f++) {
    const wy = gf + 1.4 + floorGap * f + floorGap * 0.5;
    for (let c = 0; c < cols; c++) {
      const wx = -half + (w / (cols + 1)) * (c + 1);
      winList.push({ g, lx: wx, ly: wy, lz: frontZ + 0.02 });
    }
  }

  // --- Fascia sign mounted on the FRONT, facing the plaza/avenue -------------
  // artPanel faces +Z; the building's front is its -Z face, so rotate the sign
  // 180° to face OUT of the front (un-mirrored toward whoever approaches it).
  const signW = Math.min(w - 1.5, 6.2);
  const panel = artPanel(signW, 1.3, "sign", {
    text: sign, bg, fg: "#ffffff",
    emissiveIntensity: 0.55,
    file: `plaza-sign-${sign.toLowerCase().replace(/\s+/g, "-")}.png`,
  });
  panel.position.set(0, gf + 1.0, frontZ - 0.32);
  panel.rotation.y = Math.PI;          // face -Z (out the front), un-mirrored
  panel.castShadow = false;
  g.add(panel);

  return { group: g, signPanels: [panel], footprint: { w, d } };
}

// ===========================================================================
// ENTERABLE FLOWER / GIFT KIOSK  (a real, walkable interior)
// ===========================================================================
// A small one-room shop the player can walk INTO. Built directly in WORLD-
// aligned local coordinates (the returned group is added at the tile origin, so
// local == world here) so every wall AABB is axis-aligned and trivial to push.
//
// Layout (centred at cx,cz; FRONT faces -X toward the open plaza):
//   • depth along X = `depth` m, width along Z = `width` m, walls `wallH` tall.
//   • FRONT wall on the -X face has a `doorW`-wide DOORWAY GAP (no wall, no
//     collider) flanked by two short segments.
//   • back wall (+X), two side walls (±Z): solid, each with its OWN AABB.
//   • cosy florist interior: counter, shelves of potted blooms, a glass display
//     case, two stools, wall signage, two hanging lights, a rug.
//   • outdoor SIGN above the doorway facing -X (the street), un-mirrored.
// Pushes one AABB per solid wall onto `colliders`; the doorway gap gets NONE.
// Returns { group, lights:[] } — lights are the emissive pendants for flicker.
function makeFlowerKiosk(cx, cz, colliders) {
  const g = new THREE.Group();
  const lights = [];
  const width = 8;            // along world Z
  const depth = 7;            // along world X
  const wallH = 3.2;
  const t = 0.25;             // wall thickness
  const doorW = 2.2;          // doorway gap width (along Z)
  const xFront = cx - depth / 2;   // -X face (street-facing front)
  const xBack = cx + depth / 2;    // +X face (back)
  const zMin = cz - width / 2;     // -Z side wall
  const zMax = cz + width / 2;     // +Z side wall
  const wy = wallH / 2;            // wall centre height

  // --- FLOOR -----------------------------------------------------------------
  const floor = mesh(new THREE.BoxGeometry(depth - t, 0.08, width - t), M.shopFloor, false, true);
  floor.position.set(cx, 0.04, cz);
  g.add(floor);

  // --- ROOF / flat ceiling ---------------------------------------------------
  const roof = mesh(new THREE.BoxGeometry(depth + 0.3, 0.2, width + 0.3), M.shopRoof, true, false);
  roof.position.set(cx, wallH + 0.1, cz);
  g.add(roof);
  // a slim fascia band wrapping the roofline for a finished kiosk look
  const fascia = mesh(new THREE.BoxGeometry(depth + 0.36, 0.3, width + 0.36), M.shopTrim, false, false);
  fascia.position.set(cx, wallH - 0.05, cz);
  g.add(fascia);

  // --- BACK wall (+X face), full width --------------------------------------
  const back = mesh(new THREE.BoxGeometry(t, wallH, width), M.shopWall);
  back.position.set(xBack, wy, cz);
  g.add(back);
  addCollider(colliders, xBack, cz, t, width);

  // --- SIDE walls (±Z faces), full depth ------------------------------------
  const sideN = mesh(new THREE.BoxGeometry(depth, wallH, t), M.shopWall);
  sideN.position.set(cx, wy, zMin);
  g.add(sideN);
  addCollider(colliders, cx, zMin, depth, t);

  const sideS = mesh(new THREE.BoxGeometry(depth, wallH, t), M.shopWall);
  sideS.position.set(cx, wy, zMax);
  g.add(sideS);
  addCollider(colliders, cx, zMax, depth, t);

  // --- FRONT wall (-X face) = two short segments flanking the DOORWAY GAP ----
  // The gap (doorW wide, centred at cz) has NO wall and NO collider so the
  // player walks straight in.
  const segLen = (width - doorW) / 2;                 // length of each flank along Z
  const segNcz = zMin + segLen / 2;                   // centre of -Z flank
  const segScz = zMax - segLen / 2;                   // centre of +Z flank
  const frontN = mesh(new THREE.BoxGeometry(t, wallH, segLen), M.shopWall);
  frontN.position.set(xFront, wy, segNcz);
  g.add(frontN);
  addCollider(colliders, xFront, segNcz, t, segLen);

  const frontS = mesh(new THREE.BoxGeometry(t, wallH, segLen), M.shopWall);
  frontS.position.set(xFront, wy, segScz);
  g.add(frontS);
  addCollider(colliders, xFront, segScz, t, segLen);

  // lintel above the doorway (spans the gap, high enough to walk under — no
  // collider; players never reach 2.6 m up)
  const lintel = mesh(new THREE.BoxGeometry(t + 0.05, wallH - 2.4, doorW + 0.2), M.shopTrim, true, false);
  lintel.position.set(xFront, wallH - (wallH - 2.4) / 2, cz);
  g.add(lintel);

  // --- OUTDOOR SIGN above the door, facing -X (the street) -------------------
  // artPanel planes face +Z by default; rotate -90° about Y so the readable
  // (+Z) face points toward world -X (out the front, un-mirrored).
  const sign = artPanel(3.2, 0.95, "sign", {
    text: "BLOOM & GIFT", bg: "#3f7d54", fg: "#fff3cf",
    emissiveIntensity: 0.6, file: "plaza-sign-bloom-gift.png",
  });
  sign.position.set(xFront - 0.16, wallH - 0.55, cz);
  sign.rotation.y = -Math.PI / 2;
  sign.castShadow = false;
  g.add(sign);

  // --- INTERIOR: RUG ---------------------------------------------------------
  const rug = mesh(new THREE.BoxGeometry(depth - 2.2, 0.03, width - 2.6), M.rug, false, true);
  rug.position.set(cx + 0.2, 0.07, cz);
  g.add(rug);

  // --- INTERIOR: SERVICE COUNTER (L-ish bar near the back-right) -------------
  const counterBase = mesh(new THREE.BoxGeometry(2.6, 1.0, 0.8), M.counter);
  counterBase.position.set(xBack - 1.0, 0.5, zMin + 1.4);
  g.add(counterBase);
  const counterTop = mesh(new THREE.BoxGeometry(2.8, 0.1, 1.0), M.counterTop, false);
  counterTop.position.set(xBack - 1.0, 1.05, zMin + 1.4);
  g.add(counterTop);
  // a small register block on the counter
  const reg = mesh(new THREE.BoxGeometry(0.4, 0.3, 0.34), M.shopTrim);
  reg.position.set(xBack - 1.6, 1.25, zMin + 1.4);
  g.add(reg);

  // --- INTERIOR: SHELVES on the back wall with potted blooms -----------------
  const shelfY = [1.0, 1.7, 2.4];
  for (const sy of shelfY) {
    const shelf = mesh(new THREE.BoxGeometry(0.4, 0.06, width - 1.6), M.shelfWood, false);
    shelf.position.set(xBack - 0.35, sy, cz + 1.6);
    g.add(shelf);
  }

  // --- INTERIOR: a DISPLAY CASE / glass cabinet by the +Z wall ---------------
  const caseBase = mesh(new THREE.BoxGeometry(2.4, 0.7, 0.7), M.shelfWood);
  caseBase.position.set(cx + 0.4, 0.35, zMax - 0.6);
  g.add(caseBase);
  const caseGlass = mesh(new THREE.BoxGeometry(2.4, 0.8, 0.7), M.caseGlass, false, false);
  caseGlass.position.set(cx + 0.4, 1.1, zMax - 0.6);
  g.add(caseGlass);

  // --- INTERIOR: two STOOLS in front of the counter --------------------------
  for (const sz of [zMin + 1.2, zMin + 2.3]) {
    const seat = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12), M.stool);
    seat.position.set(xBack - 2.4, 0.6, sz);
    g.add(seat);
    const leg = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), M.poleMat);
    leg.position.set(xBack - 2.4, 0.3, sz);
    g.add(leg);
  }

  // --- INTERIOR: wall SIGNAGE (small framed sign inside, on the back wall) ----
  const innerSign = artPanel(1.6, 0.7, "sign", {
    text: "FRESH FLOWERS", bg: "#b34a52", fg: "#fff3cf",
    emissiveIntensity: 0.4, file: "plaza-kiosk-inner.png",
  });
  // back wall is the +X face; its inner side faces -X, so face -X (rotate -90°)
  innerSign.position.set(xBack - 0.18, 2.3, cz - 1.2);
  innerSign.rotation.y = -Math.PI / 2;
  innerSign.castShadow = false;
  g.add(innerSign);

  // --- INTERIOR: two HANGING pendant lights ----------------------------------
  for (const lz of [cz - 1.6, cz + 1.6]) {
    const cord = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), M.poleMat, false, false);
    cord.position.set(cx - 1.0, wallH - 0.45, lz);
    g.add(cord);
    const bulb = mesh(new THREE.SphereGeometry(0.16, 12, 10), M.shopLight, false, false);
    bulb.position.set(cx - 1.0, wallH - 0.85, lz);
    g.add(bulb);
    lights.push(bulb);
  }

  // --- INTERIOR: POTTED FLOWERS — instanced pots, stems and blooms -----------
  // Bunches sit on the three back shelves + the front display case. Each "pot"
  // is a pot rim + a few stems topped with bloom heads. Repeats are baked into
  // shared InstancedMeshes (no per-frame allocation).
  const pots = [];          // {x,y,z}
  // along each back shelf
  for (const sy of shelfY) {
    for (let i = 0; i < 4; i++) {
      pots.push({ x: xBack - 0.35, y: sy + 0.11, z: cz - 2.4 + i * 1.6, mat: i });
    }
  }
  // a row on top of the display case
  for (let i = 0; i < 4; i++) {
    pots.push({ x: cx - 0.6 + i * 0.55, y: 1.6, z: zMax - 0.6, mat: i + 1 });
  }
  // a couple on the counter top
  pots.push({ x: xBack - 0.6, y: 1.2, z: zMin + 1.2, mat: 2 });

  const bloomMats = [M.bloomA, M.bloomB, M.bloomC];
  const potCount = pots.length;
  const stemPerPot = 3;
  const dummyL = new THREE.Object3D();

  // pot rims (instanced)
  const potMesh = new THREE.InstancedMesh(G.potRim, M.vase, potCount);
  potMesh.castShadow = true; potMesh.receiveShadow = false;
  // stems (instanced, stemPerPot each)
  const stemMesh = new THREE.InstancedMesh(G.stem, M.stem, potCount * stemPerPot);
  stemMesh.castShadow = false; stemMesh.receiveShadow = false;
  // blooms grouped per colour into 3 instanced meshes
  const bloomCounts = [0, 0, 0];
  for (const p of pots) bloomCounts[p.mat % 3] += stemPerPot;
  const bloomMeshes = bloomMats.map((m, i) => {
    const im = new THREE.InstancedMesh(G.bloom, m, bloomCounts[i]);
    im.castShadow = false; im.receiveShadow = false;
    return im;
  });
  const bloomIdx = [0, 0, 0];

  for (let pi = 0; pi < potCount; pi++) {
    const p = pots[pi];
    dummyL.position.set(p.x, p.y, p.z);
    dummyL.rotation.set(0, 0, 0);
    dummyL.scale.set(1, 1, 1);
    dummyL.updateMatrix();
    potMesh.setMatrixAt(pi, dummyL.matrix);
    const colour = p.mat % 3;
    for (let s = 0; s < stemPerPot; s++) {
      const ox = (s - 1) * 0.09;
      const oz = ((s % 2) - 0.5) * 0.12;
      // stem
      dummyL.position.set(p.x + ox, p.y + 0.32, p.z + oz);
      dummyL.rotation.set(0, 0, 0);
      dummyL.scale.set(1, 1, 1);
      dummyL.updateMatrix();
      stemMesh.setMatrixAt(pi * stemPerPot + s, dummyL.matrix);
      // bloom head atop the stem
      dummyL.position.set(p.x + ox, p.y + 0.58, p.z + oz);
      dummyL.updateMatrix();
      const ci = colour;
      bloomMeshes[ci].setMatrixAt(bloomIdx[ci]++, dummyL.matrix);
    }
  }
  potMesh.instanceMatrix.needsUpdate = true;
  stemMesh.instanceMatrix.needsUpdate = true;
  for (const im of bloomMeshes) im.instanceMatrix.needsUpdate = true;
  g.add(potMesh, stemMesh, ...bloomMeshes);

  // --- INTERIOR: a few WRAPPED GIFTS stacked by the front display ------------
  const giftPlaces = [
    [cx - 0.2, 0.85, zMax - 0.6, M.gift],
    [cx + 0.2, 0.85, zMax - 0.6, M.giftLid],
    [cx, 1.18, zMax - 0.6, M.gift],
  ];
  for (const [x, y, z, gm] of giftPlaces) {
    const box1 = mesh(G.giftBox, gm);
    box1.position.set(x, y, z);
    box1.rotation.y = Math.random() * 0.4;
    g.add(box1);
    // ribbon cross on top
    const rib = mesh(new THREE.BoxGeometry(0.36, 0.04, 0.06), M.giftLid, false);
    rib.position.set(x, y + 0.16, z);
    g.add(rib);
  }

  return { group: g, lights };
}

// --- Main build -------------------------------------------------------------
export function buildPlaza() {
  const group = new THREE.Group();
  const colliders = [];
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];
  const sway = [];
  const dummy = new THREE.Object3D();
  const winList = [];        // queued upper-floor windows across all buildings
  const signPanels = [];     // collected for ambient sign-glow flicker

  // Ground slab — pavement covering the whole tile (thin box at y~0).
  const slab = mesh(new THREE.BoxGeometry(60, 0.4, 60), M.pavement, false, true);
  slab.position.y = -0.2;
  group.add(slab);

  // A darker paved ring under the central fountain for visual focus.
  const ringPave = mesh(new THREE.CylinderGeometry(9, 9, 0.1, 40), M.pavementRing, false, true);
  ringPave.position.y = 0.02;
  group.add(ringPave);

  // === Central circular fountain ===========================================
  const fountain = new THREE.Group();
  // Outer stone basin wall (ring) — open-top low cylinder.
  const basinWall = mesh(new THREE.CylinderGeometry(4, 4.2, 1.0, 36, 1, true), M.stoneWall);
  basinWall.position.y = 0.5;
  // Basin floor / inner water disc.
  const waterDisc = mesh(new THREE.CylinderGeometry(3.85, 3.85, 0.5, 36), M.water, false, false);
  waterDisc.position.y = 0.4;
  // Rim cap.
  const rim = mesh(new THREE.TorusGeometry(4.05, 0.18, 8, 36), M.stoneDark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.0;
  // Central pedestal column.
  const pedestal = mesh(new THREE.CylinderGeometry(0.6, 0.85, 1.6, 16), M.stone);
  pedestal.position.y = 0.8;
  // Upper tier bowl.
  const bowl = mesh(new THREE.CylinderGeometry(1.4, 0.5, 0.4, 20), M.stone);
  bowl.position.y = 1.7;
  const bowlWater = mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.16, 20), M.water, false, false);
  bowlWater.position.y = 1.92;
  // Animated rising water jet (scaled in update).
  const jet = mesh(new THREE.CylinderGeometry(0.16, 0.26, 1.6, 12), M.jet, false, false);
  jet.position.y = 2.7;
  // Animated spinning ripple ring on the basin surface.
  const ripple = mesh(new THREE.TorusGeometry(2.4, 0.1, 6, 28), M.jet, false, false);
  ripple.rotation.x = Math.PI / 2;
  ripple.position.y = 0.66;
  fountain.add(basinWall, waterDisc, rim, pedestal, bowl, bowlWater, jet, ripple);
  group.add(fountain);
  // Fountain collider — tight to the basin footprint (~4.2 m radius => 8.6 box).
  addCollider(colliders, 0, 0, 8.6, 8.6);

  // === FULL-VOLUME BUILDINGS framing the square (north + west edges) ========
  // Each building is a real block (width × depth × height). Fronts face INTO the
  // square / toward the bordering avenue. Every footprint is SET BACK so it stays
  // within LOCAL X,Z ∈ [-23,23] — a ~7 m clearance from each tile edge (the tile
  // is [-30,30]) so nothing clips the seam road + kerb + sidewalk. The centre
  // stays a wide open lane (the closest building face is >= ~12 m from the
  // fountain edge, leaving plenty of room for the car to cross).
  //
  // Building placement (centre x,z and front-facing rotation ry):
  //   - NW CORNER HALL: clock-tower civic hall in the north-west corner; its
  //     front faces +Z toward the square (ry = 0 means front=-Z local, so we
  //     spin 180° to face +Z... see below — we author front as local -Z and use
  //     ry to aim it).
  // We author makeBuilding with its detailed front on local -Z, then choose ry
  // so that face points toward the square interior.

  const buildings = [
    // NORTH block along the back (front faces +Z / south, into square). Pulled
    // SOUTH out of the north-edge road: depth 8 m centred at cz=-19 ⇒ Z∈[-23,-15],
    // a 7 m setback from the -30 tile edge. Width 20 m at cx=12 ⇒ X∈[2,22], clear
    // of the +23 limit and of billboard A (x=-9). Full volume kept.
    {
      cx: 12, cz: -19, ry: Math.PI,              // front (local -Z) rotated to face +Z
      w: 20, d: 8, h: 9.5, cols: 5, floors: 1, gf: 3.4,
      wallMat: M.wallB, awnMat: M.awnGreen, sign: "TOWN HALL", bg: "#2f6f8f", emis: "#5fc6e8",
    },
    // WEST café/shop block (front faces +X / east, into square). Pulled EAST out
    // of the west-edge road: depth 8 m centred at cx=-19 ⇒ X∈[-23,-15], a 7 m
    // setback from the -30 tile edge. Width 18 m in Z at cz=4 ⇒ Z∈[-5,13]. Full
    // volume kept.
    {
      cx: -19, cz: 4, ry: -Math.PI / 2,          // front (local -Z) rotated to face +X
      w: 18, d: 8, h: 8.5, cols: 5, floors: 1, gf: 3.4,
      wallMat: M.wallC, awnMat: M.awnAmber, sign: "PLAZA CAFE", bg: "#caa24a", emis: "#ffd070",
    },
  ];

  let clockTower = null;
  for (const b of buildings) {
    const built = makeBuilding(b, winList);
    built.group.position.set(b.cx, 0, b.cz);
    built.group.rotation.y = b.ry;
    group.add(built.group);
    for (const p of built.signPanels) signPanels.push(p);
    // Footprint collider matches the FULL rotated volume. ry is a multiple of
    // 90°, so the world-space footprint just swaps w/d when |sin(ry)| ~ 1.
    const swap = Math.abs(Math.sin(b.ry)) > 0.5;
    const fw = swap ? b.d : b.w;
    const fd = swap ? b.w : b.d;
    addCollider(colliders, b.cx, b.cz, fw, fd);
  }

  // --- NW CORNER CLOCK-TOWER HALL -------------------------------------------
  // A taller corner landmark closing the north-west corner of the square. Built
  // as its own group so the rotating clock hands can be animated. Solid full
  // volume (10×10×13) with windows on TWO faces (it's a corner), a parapet, a
  // setback belfry stage, a pyramidal roof and a working clock facing the plaza.
  {
    const tower = new THREE.Group();
    // Pulled IN from the NW corner so its 11×11 footprint clears the corner roads:
    // centred at (-17.5,-17.5) ⇒ X,Z∈[-23,-12], a 7 m setback from both -30 edges.
    const cx = -17.5, cz = -17.5;        // centre of the corner footprint
    const W = 11, D = 11, H = 13;
    // main solid shaft (full volume — reads solid from every side)
    const shaft = box(W, H, D, M.wallA);
    shaft.position.set(0, H / 2, 0);
    tower.add(shaft);
    // plinth
    const plinth = box(W + 0.4, 0.7, D + 0.4, M.base);
    plinth.position.set(0, 0.35, 0);
    tower.add(plinth);
    // cornice band partway up
    const cband = box(W + 0.3, 0.5, D + 0.3, M.cornice, false);
    cband.position.set(0, 4.2, 0);
    tower.add(cband);
    // parapet at the top of the shaft
    const para = box(W + 0.3, 0.7, D + 0.3, M.trim, false);
    para.position.set(0, H + 0.05, 0);
    tower.add(para);
    // setback belfry stage above the shaft
    const belfry = box(W - 3.2, 3.2, D - 3.2, M.wallA);
    belfry.position.set(0, H + 1.6, 0);
    tower.add(belfry);
    // pyramidal roof over the belfry
    const roofPyr = new THREE.Mesh(new THREE.ConeGeometry((W - 3.2) * 0.78, 3.2, 4), M.roof);
    roofPyr.rotation.y = Math.PI / 4;
    roofPyr.position.set(0, H + 3.2 + 1.6, 0);
    roofPyr.castShadow = true;
    roofPyr.receiveShadow = true;
    tower.add(roofPyr);
    // finial
    const finial = box(0.3, 1.2, 0.3, M.metal);
    finial.position.set(0, H + 5.6, 0);
    tower.add(finial);

    // recessed grand entrance on the south face (+Z, toward the square)
    const entFrame = box(3.6, 4.0, 0.4, M.trim);
    entFrame.position.set(0, 2.0, D / 2 - 0.05);
    tower.add(entFrame);
    const entGlass = box(3.0, 3.4, 0.14, M.glass, false);
    entGlass.position.set(0, 1.75, D / 2 + 0.02);
    tower.add(entGlass);
    const entStep = box(4.0, 0.18, 1.0, M.cornice);
    entStep.position.set(0, 0.09, D / 2 + 0.5);
    tower.add(entStep);

    // upper windows on the two plaza-facing faces (+Z south, +X east) — queued
    // for the shared InstancedMesh. (south face winList uses lz = +D/2 then we
    // pre-rotate per face below by pushing already-rotated placements.)
    for (const wy of [6.4, 9.6]) {
      // south face (toward +Z)
      for (const wx of [-3.0, 0, 3.0]) {
        winList.push({ g: tower, lx: wx, ly: wy, lz: D / 2 - 0.02, faceRy: 0 });
      }
      // east face (toward +X)
      for (const wz of [-3.0, 0, 3.0]) {
        winList.push({ g: tower, lx: W / 2 - 0.02, ly: wy, lz: wz, faceRy: Math.PI / 2 });
      }
    }

    // CLOCK on the belfry, facing +Z (south, toward the plaza).
    const clockZ = (D - 3.2) / 2 + 0.05;
    const clockDisc = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.18, 24), M.clockFace);
    clockDisc.rotation.x = Math.PI / 2;
    clockDisc.position.set(0, H + 1.8, clockZ);
    clockDisc.castShadow = false;
    tower.add(clockDisc);
    const clockRim = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 8, 24), M.trim);
    clockRim.position.set(0, H + 1.8, clockZ + 0.02);
    tower.add(clockRim);
    // hour + minute hands (pivot at clock centre; animated in update)
    const hourHand = box(0.12, 0.7, 0.05, M.clockHand, false);
    hourHand.geometry.translate(0, 0.35, 0);   // pivot at bottom
    hourHand.position.set(0, H + 1.8, clockZ + 0.12);
    const minHand = box(0.09, 1.0, 0.05, M.clockHand, false);
    minHand.geometry.translate(0, 0.5, 0);
    minHand.position.set(0, H + 1.8, clockZ + 0.14);
    tower.add(hourHand, minHand);

    // rooftop AC/vent clutter on the main shaft roof (visual only)
    const acT = mesh(G.acUnit, M.metal);
    acT.position.set(2.5, H + 0.4, -2.5);
    tower.add(acT);

    tower.position.set(cx, 0, cz);
    group.add(tower);
    // footprint collider for the corner tower (full square volume)
    addCollider(colliders, cx, cz, W, D);
    clockTower = { hourHand, minHand };
  }

  // --- Bake all queued upper-floor windows into ONE InstancedMesh -----------
  // Each entry is in a building group's LOCAL frame; we compose the group's
  // world matrix (position + ry) with an optional per-face rotation so a single
  // InstancedMesh covers every window across every building.
  if (winList.length > 0) {
    const winPanes = new THREE.InstancedMesh(G.winPane, M.winLit, winList.length);
    const winFrames = new THREE.InstancedMesh(G.winFrame, M.trim, winList.length);
    winPanes.castShadow = false;
    winFrames.castShadow = true;
    winPanes.receiveShadow = false;
    winFrames.receiveShadow = true;
    for (let i = 0; i < winList.length; i++) {
      const e = winList[i];
      e.g.updateMatrixWorld(true);
      // local placement (relative to the building group), incl. optional face spin
      dummy.position.set(e.lx, e.ly, e.lz);
      dummy.rotation.set(0, e.faceRy || 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      // compose: group local matrix (pos + ry) ∘ window local matrix
      const local = new THREE.Matrix4();
      local.compose(e.g.position, e.g.quaternion, e.g.scale);
      local.multiply(dummy.matrix);
      winPanes.setMatrixAt(i, local);
      // frame nudged slightly behind the pane (toward the wall)
      dummy.position.set(e.lx, e.ly, e.lz - 0.04);
      dummy.updateMatrix();
      const local2 = new THREE.Matrix4();
      local2.compose(e.g.position, e.g.quaternion, e.g.scale);
      local2.multiply(dummy.matrix);
      winFrames.setMatrixAt(i, local2);
    }
    winPanes.instanceMatrix.needsUpdate = true;
    winFrames.instanceMatrix.needsUpdate = true;
    group.add(winPanes, winFrames);
  }

  // --- Rooftop clutter on the two storefront blocks (visual only) -----------
  // (Instanced AC + vent pipes scattered atop the parapets.)
  const acPlaces = [
    [8, 9.0, -18.0], [16, 9.0, -20.0],          // atop TOWN HALL roof (X[2,22] Z[-23,-15], h=9.5)
    [-18.0, 8.0, 0], [-20.0, 8.0, 8],           // atop PLAZA CAFE roof (X[-23,-15] Z[-5,13], h=8.5)
  ];
  for (const [x, y, z] of acPlaces) {
    const ac = mesh(G.acUnit, M.metal);
    ac.position.set(x, y, z);
    group.add(ac);
  }
  const ventPlaces = [
    [4, 9.5, -19.0], [20, 9.5, -19.0],          // TOWN HALL roof
    [-20.0, 8.6, -3], [-18.0, 8.6, 11],         // PLAZA CAFE roof
  ];
  for (const [x, y, z] of ventPlaces) {
    const v = mesh(G.ventPipe, M.metal);
    v.position.set(x, y, z);
    group.add(v);
  }

  // === Benches — arranged around the fountain, facing inward ================
  // Placed on a ~7 m radius so a wide ring lane (fountain edge ~4.3 to bench
  // ~6.5) stays open. Benches are small props; give each a tight collider.
  const benchPlaces = [
    { x: 0, z: 7.2, ry: Math.PI },     // south, facing -Z toward fountain
    { x: 0, z: -7.2, ry: 0 },          // north
    { x: 7.2, z: 0, ry: -Math.PI / 2 },// east
    { x: -7.2, z: 0, ry: Math.PI / 2 },// west
  ];
  for (const p of benchPlaces) {
    const b = makeBench();
    b.position.set(p.x, 0, p.z);
    b.rotation.y = p.ry;
    group.add(b);
    // tight collider aligned to bench orientation (1.8 wide x 0.5 deep)
    if (Math.abs(Math.sin(p.ry)) > 0.5) addCollider(colliders, p.x, p.z, 0.6, 2.0);
    else addCollider(colliders, p.x, p.z, 2.0, 0.6);
  }

  // === Planters with flat-shaded shrubs ====================================
  // Corner planters that USED to overlap the (now set-back) buildings are placed
  // to dress the OPEN south-east area + flank building entrances, clear of every
  // building footprint and the central lanes. New footprints: hall X[2,22]
  // Z[-23,-15], café X[-23,-15] Z[-5,13], tower X[-23,-12] Z[-23,-12].
  const planterPlaces = [
    [21, 21], [21, -2],     // south-east open corner / east edge (clear of hall maxX=22)
    [-2, 21], [-13, 16],    // south edge / café-entrance flank (café maxZ=13)
    [9, -13],               // hall-entrance flank, plaza side (hall minZ=-15)
  ];
  for (const [x, z] of planterPlaces) {
    const pl = makePlanter(sway);
    pl.position.set(x, 0, z);
    group.add(pl);
    addCollider(colliders, x, z, 1.7, 1.7);
  }

  // === Lamp posts — spread around the plaza edges ==========================
  const lampPlaces = [
    [-11, -11], [12, -12], [-12, 12], [9, 9],     // NW lamp nudged off the set-back tower; SE lamp pulled in to clear the kiosk
  ];
  for (const [x, z] of lampPlaces) {
    const l = makeLamp();
    l.position.set(x, 0, z);
    group.add(l);
    addCollider(colliders, x, z, 0.5, 0.5);
  }

  // === Two double-faced billboards on poles (south + east edges) ===========
  // The plaza tile abuts the cross street on its south edge and an avenue on its
  // east edge, so the billboards stand BROADSIDE to those streets and are built
  // double-faced — a readable, un-mirrored advert shows toward the approaching
  // street AND toward the square.

  // Billboard A — SOUTH edge (local +Z), beside the cross street the player
  // approaches from. No Y rotation: broad faces look +Z (toward the street) and
  // -Z (into the square); both faces are readable. Set back to z=+22 so the pole
  // clears the seam road + sidewalk while still standing broadside to the street.
  const billA = makeBillboard(5.0, 2.8, {
    title: "WELCOME", sub: "TOWN PLAZA", accent: "#ffcf3f",
    a: "#2a6b4f", b: "#10331f", glyph: "☕",
    emissiveIntensity: 0.5, file: "billboard-plaza-welcome.png",
  });
  billA.position.set(-9, 0, 22);
  group.add(billA);
  addCollider(colliders, -9, 22, 0.6, 0.6);

  // Billboard B — EAST edge (local +X), beside the avenue. Rotated +90° so its
  // broad faces look +X (toward the avenue) and -X (into the square); both faces
  // are readable. Set back to x=+22 so the pole clears the seam road + sidewalk.
  const billB = makeBillboard(5.0, 2.8, {
    title: "FRESH BREW", sub: "OPEN DAILY", accent: "#ff9d3f",
    a: "#6b3a2a", b: "#331810", glyph: "★",
    emissiveIntensity: 0.5, file: "billboard-plaza-brew.png",
  });
  billB.position.set(22, 0, 16);
  billB.rotation.y = Math.PI / 2;
  group.add(billB);
  addCollider(colliders, 22, 16, 0.6, 0.6);

  // === ENTERABLE FLOWER / GIFT KIOSK (SE quadrant, open pocket) =============
  // A walkable one-room florist tucked into the clear SE pocket. Centre (15,16.5)
  // ⇒ footprint X[11.5,18.5] Z[12.5,20.5] — clear of the fountain ring, the
  // benches, the SE lamp (now at 9,9), planters (21,21 / 21,-2) and billboard B
  // (22,16); all of it within X,Z∈[-23,23]. Its DOORWAY faces -X (the open
  // plaza), so the player walks straight in from the square. Each solid wall gets
  // its own collider; the doorway gap gets NONE (walkable threshold).
  const kiosk = makeFlowerKiosk(15, 16.5, colliders);
  group.add(kiosk.group);

  // --- Animation state (no per-frame allocation) ---------------------------
  let t = 0;
  const baseSign = signPanels.map((p) => p.material.emissiveIntensity ?? 0.55);
  const kioskLights = kiosk.lights;
  const update = (dt) => {
    t += dt;
    // Rising/falling water jet from the upper bowl.
    const grow = 1 + Math.sin(t * 3.0) * 0.35;
    jet.scale.y = grow;
    jet.position.y = 2.7 + (grow - 1) * 0.8; // keep base anchored as it grows
    // Gentle bob of the upper-bowl water surface.
    bowlWater.position.y = 1.92 + Math.sin(t * 2.2) * 0.03;
    // Spinning + pulsing ripple ring on the basin.
    ripple.rotation.z = t * 0.8;
    const rs = 1 + Math.sin(t * 1.6) * 0.12;
    ripple.scale.set(rs, rs, 1);
    // Subtle foliage sway.
    for (let i = 0; i < sway.length; i++) {
      const s = sway[i];
      s.obj.rotation.z = s.base + Math.sin(t * 1.2 + s.phase) * 0.06;
    }
    // Clock-tower hands sweep slowly (decorative, not real time).
    if (clockTower) {
      clockTower.minHand.rotation.z = -t * 0.25;
      clockTower.hourHand.rotation.z = -t * 0.25 / 12;
    }
    // Gentle neon flicker on the building fascia signs.
    for (let i = 0; i < signPanels.length; i++) {
      const flick = 0.85 + 0.18 * Math.sin(t * (2.0 + i * 0.6) + i);
      signPanels[i].material.emissiveIntensity = baseSign[i] * flick;
    }
    // Warm pulse of the kiosk pendant lights.
    for (let i = 0; i < kioskLights.length; i++) {
      kioskLights[i].material.emissiveIntensity = 0.9 + 0.25 * Math.sin(t * 1.7 + i * 1.6);
    }
  };

  return { group, colliders, ground, update };
}
