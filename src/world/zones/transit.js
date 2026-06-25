// TRANSIT HUB district — an elevated/ground train station filling one 60×60 tile
// (X ∈ [-30,30], Z ∈ [-30,30], ground at y=0, up = +Y).
//
// What's here:
//   • a raised concrete PLATFORM running the length of the tile (north side)
//   • a long STATIC TRAIN of connected coach boxes with windows, parked on a
//     ballast track beside the platform
//   • a STATION CANOPY roof carried on a row of steel columns over the platform
//   • a glowing DEPARTURE-BOARD sign (artPanel "sign", text "TRANSIT")
//   • passenger BENCHES, lamps and a clock pillar
//   • a ground slab (asphalt plaza + grass verge) so it reads as a real place
//
// A WIDE open plaza lane runs down the middle of the tile (Z ∈ roughly [-8, 6])
// with no colliders, so a driving car can cross the tile end to end. The train,
// platform edge wall, canopy columns and clock are the solid colliders.
//
// buildTransit() returns { group, colliders, ground, update }.

import * as THREE from "three";
import { artPanel, artMaterial } from "../cityArt.js";

// --- Shared geometry (created ONCE, reused across repeated props) -----------
const GEO = {
  unit: new THREE.BoxGeometry(1, 1, 1), // generic box, scaled per use
  column: new THREE.CylinderGeometry(0.18, 0.22, 4.2, 12),
  wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14),
  railTie: new THREE.BoxGeometry(0.3, 0.12, 3.0),
  lampPole: new THREE.CylinderGeometry(0.09, 0.11, 4.0, 10),
  lampHead: new THREE.SphereGeometry(0.22, 12, 10),
  clockBody: new THREE.CylinderGeometry(0.45, 0.5, 3.6, 14),
  clockFace: new THREE.CylinderGeometry(0.55, 0.55, 0.16, 16),
  // NEW shared geometry for the enhanced station detail
  facadePane: new THREE.BoxGeometry(1, 1, 0.06),   // glazing pane, scaled per use
  mullion: new THREE.BoxGeometry(0.12, 1, 0.16),   // vertical glazing mullion
  trussLeg: new THREE.CylinderGeometry(0.1, 0.1, 1, 8), // canopy diagonal brace
  turnstile: new THREE.BoxGeometry(0.5, 1.05, 0.7),// turnstile cabinet body
  tsArm: new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), // turnstile barrier arm
  catPole: new THREE.CylinderGeometry(0.07, 0.09, 5.2, 8), // catenary mast
  bollard: new THREE.CylinderGeometry(0.13, 0.16, 0.9, 10),
  vent: new THREE.CylinderGeometry(0.3, 0.3, 0.4, 10),
  clockHand: new THREE.BoxGeometry(0.06, 1, 0.04),
};

// --- Shared materials (created ONCE) ---------------------------------------
const MAT = {
  asphalt: new THREE.MeshStandardMaterial({ color: "#3b3d44", roughness: 0.97 }),
  grass: new THREE.MeshStandardMaterial({ color: "#4f7d44", roughness: 0.95, flatShading: true, side: THREE.DoubleSide }),
  platform: new THREE.MeshStandardMaterial({ color: "#b9b3a6", roughness: 0.92 }),
  platformSide: new THREE.MeshStandardMaterial({ color: "#8d887d", roughness: 1 }),
  edgeStripe: new THREE.MeshStandardMaterial({ color: "#e7c84a", roughness: 0.6 }),
  ballast: new THREE.MeshStandardMaterial({ color: "#55585e", roughness: 1, flatShading: true }),
  rail: new THREE.MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.4, metalness: 0.8 }),
  tie: new THREE.MeshStandardMaterial({ color: "#4a3a2c", roughness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ color: "#3a3e44", roughness: 0.5, metalness: 0.7 }),
  canopy: new THREE.MeshStandardMaterial({ color: "#586374", roughness: 0.7, metalness: 0.3 }),
  canopyUnder: new THREE.MeshStandardMaterial({ color: "#cdd3da", roughness: 0.85 }),
  coach: new THREE.MeshStandardMaterial({ color: "#b23a3a", roughness: 0.55, metalness: 0.2 }),
  coachTrim: new THREE.MeshStandardMaterial({ color: "#efe7d8", roughness: 0.6 }),
  coachRoof: new THREE.MeshStandardMaterial({ color: "#43464d", roughness: 0.7, metalness: 0.3 }),
  window: new THREE.MeshStandardMaterial({
    color: "#bfe2f0", roughness: 0.18, metalness: 0.5,
    emissive: "#9ccbe0", emissiveIntensity: 0.25,
  }),
  wheelMat: new THREE.MeshStandardMaterial({ color: "#16181c", roughness: 0.85 }),
  benchWood: new THREE.MeshStandardMaterial({ color: "#6b4326", roughness: 0.75 }),
  benchLeg: new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.5, metalness: 0.6 }),
  lampGlass: new THREE.MeshStandardMaterial({
    color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 0.9, roughness: 0.4,
  }),
  clockMat: new THREE.MeshStandardMaterial({ color: "#26303a", roughness: 0.5, metalness: 0.4 }),
  clockFaceMat: new THREE.MeshStandardMaterial({
    color: "#f4efdc", emissive: "#fff6d0", emissiveIntensity: 0.4, roughness: 0.5,
  }),
  // NEW materials for the enhanced station concourse + dressing
  concourse: new THREE.MeshStandardMaterial({ color: "#c9b79a", roughness: 0.9, flatShading: true }),
  concourseTrim: new THREE.MeshStandardMaterial({ color: "#8c7a5e", roughness: 0.85 }),
  brick: new THREE.MeshStandardMaterial({ color: "#7c5544", roughness: 0.95, flatShading: true }),
  glazing: new THREE.MeshStandardMaterial({
    color: "#9fcfe0", roughness: 0.12, metalness: 0.55,
    emissive: "#bfe2f0", emissiveIntensity: 0.18, transparent: true, opacity: 0.78,
  }),
  mullion: new THREE.MeshStandardMaterial({ color: "#2f343a", roughness: 0.5, metalness: 0.6, flatShading: true }),
  litWin: new THREE.MeshStandardMaterial({
    color: "#ffe6a8", emissive: "#ffd877", emissiveIntensity: 0.7, roughness: 0.4,
  }),
  cornice: new THREE.MeshStandardMaterial({ color: "#ddd4c2", roughness: 0.8, flatShading: true }),
  rooftop: new THREE.MeshStandardMaterial({ color: "#6a6f78", roughness: 0.85, metalness: 0.2, flatShading: true }),
  tank: new THREE.MeshStandardMaterial({ color: "#9a8c6f", roughness: 0.9, flatShading: true }),
  catenary: new THREE.MeshStandardMaterial({ color: "#33373d", roughness: 0.45, metalness: 0.7 }),
  wire: new THREE.MeshStandardMaterial({ color: "#1c1f24", roughness: 0.6, metalness: 0.4 }),
  planter: new THREE.MeshStandardMaterial({ color: "#4a4d54", roughness: 0.92, flatShading: true }),
  foliage: new THREE.MeshStandardMaterial({ color: "#3f7a3d", roughness: 0.95, flatShading: true }),
  bin: new THREE.MeshStandardMaterial({ color: "#2e3a2f", roughness: 0.8, metalness: 0.2 }),
  clockHandMat: new THREE.MeshStandardMaterial({ color: "#1a1d22", roughness: 0.5 }),
  awning: new THREE.MeshStandardMaterial({ color: "#b23a3a", roughness: 0.7, flatShading: true }),
};

function box(w, h, d, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(GEO.unit, mat);
  m.scale.set(w, h, d);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// A "sign"/billboard artPanel whose readable FRONT faces −Z (toward the plaza /
// platform crowd that approaches the station from the south). artPanel's textured
// front faces +Z and the canvas text reads correctly only from the +Z side; the
// OLD code rotated these panels 180° about Y to point at the −Z crowd, which
// renders the text MIRRORED ("backwards SHOP-style"). Mirroring the mesh on X
// (scale.x = −1) instead points the front at −Z *and* un-mirrors the glyphs, and
// — unlike flipping the texture — it survives the async PNG swap in artMaterial().
function signFacingNorthApproach(w, h, opts) {
  const panel = artPanel(w, h, "sign", opts);
  panel.scale.x = -1; // face −Z with correct (non-mirrored) text
  return panel;
}

// --- Prop builders ----------------------------------------------------------

// One train coach: red box with cream window-band + windows, dark roof, bogies.
function makeCoach(len) {
  const g = new THREE.Group();
  const H = 2.8;
  const body = box(len, H, 2.4, MAT.coach);
  body.position.y = 1.7;
  g.add(body);
  // rounded-ish dark roof cap
  const roof = box(len - 0.2, 0.45, 2.5, MAT.coachRoof);
  roof.position.y = 3.05;
  g.add(roof);
  // A continuous cream window-band wraps the upper body (one box for all four
  // sides), and a single glass strip per long side reads as the window row.
  // Mullion lines are painted into a future PNG; here we stay within budget
  // with 1 glass mesh per side (2 per coach).
  const band = box(len - 0.4, 0.95, 2.46, MAT.coachTrim);
  band.position.y = 2.1;
  g.add(band);
  for (const side of [1.25, -1.25]) {
    const glass = box(len - 1.8, 0.74, 0.05, MAT.window, false, false);
    glass.position.set(0, 2.1, side);
    g.add(glass);
  }
  // one wheel pair per bogie (2 wheels per coach) — enough to read at distance
  for (const bx of [-(len / 2 - 1.0), len / 2 - 1.0]) {
    const w = new THREE.Mesh(GEO.wheel, MAT.wheelMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(bx, 0.42, 0);
    w.scale.set(1, 2.6, 1); // widen the cylinder to span both rails
    w.castShadow = true;
    g.add(w);
  }
  return g;
}

function makeColumn() {
  const c = new THREE.Mesh(GEO.column, MAT.steel);
  c.position.y = 2.1;
  c.castShadow = true;
  c.receiveShadow = true;
  return c;
}

function makeBench() {
  const g = new THREE.Group();
  const seat = box(1.7, 0.1, 0.5, MAT.benchWood);
  seat.position.y = 0.46;
  const back = box(1.7, 0.45, 0.1, MAT.benchWood);
  back.position.set(0, 0.7, -0.2);
  // one continuous plinth instead of separate legs (keeps mesh budget low)
  const plinth = box(1.5, 0.46, 0.4, MAT.benchLeg);
  plinth.position.y = 0.23;
  g.add(seat, back, plinth);
  return g;
}

function makeLamp() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(GEO.lampPole, MAT.steel);
  pole.position.y = 2.0;
  pole.castShadow = true;
  const head = new THREE.Mesh(GEO.lampHead, MAT.lampGlass);
  head.position.y = 4.05;
  g.add(pole, head);
  return g;
}

// A turnstile gate: dark cabinet with a rotating tri-arm barrier (animated).
// Returns { group, arm } so the arm can be spun in update().
function makeTurnstile() {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(GEO.turnstile, MAT.steel);
  cab.position.y = 0.55;
  cab.castShadow = true;
  g.add(cab);
  // a glowing fare-reader pad on top
  const pad = box(0.34, 0.06, 0.34, MAT.litWin, false, false);
  pad.position.y = 1.1;
  g.add(pad);
  // tri-arm barrier (three arms 120° apart on a small hub)
  const arm = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Mesh(GEO.tsArm, MAT.steel);
    a.rotation.z = Math.PI / 2;             // lay the cylinder horizontal
    a.position.set(0.35, 0, 0);             // offset out from hub
    a.castShadow = true;
    const holder = new THREE.Group();
    holder.add(a);
    holder.rotation.y = (i * Math.PI * 2) / 3;
    arm.add(holder);
  }
  arm.position.set(0.25, 1.0, 0);
  g.add(arm);
  return { group: g, arm };
}

// A planter box with a low foliage block on top.
function makePlanter() {
  const g = new THREE.Group();
  const tub = box(1.4, 0.6, 1.4, MAT.planter);
  tub.position.y = 0.3;
  const green = box(1.2, 0.5, 1.2, MAT.foliage);
  green.position.y = 0.75;
  g.add(tub, green);
  return g;
}

// A litter bin: short cylinder-ish box with a lid band.
function makeBin() {
  const g = new THREE.Group();
  const body = box(0.6, 0.95, 0.6, MAT.bin);
  body.position.y = 0.48;
  const lid = box(0.7, 0.12, 0.7, MAT.steel);
  lid.position.y = 1.0;
  g.add(body, lid);
  return g;
}

// A platform KIOSK building: a genuine little structure (brick base, glazed
// shopfront on the −Z platform-facing side, parapet roof) with real WIDTH, DEPTH
// AND HEIGHT — NOT a flat card. Returns the group; the caller adds a footprint
// collider sized to (w, d). The readable shop sign faces −Z (platform crowd).
function makeKiosk(w, d, h, signText, signBg) {
  const g = new THREE.Group();
  // solid brick body — full volume, reads from front, sides and back
  const body = box(w, h, d, MAT.brick, true, true);
  body.position.y = h / 2;
  g.add(body);
  // flat roof slab + parapet lip so the top reads as a real building, not a box
  const roof = box(w + 0.4, 0.4, d + 0.4, MAT.cornice, true, false);
  roof.position.y = h + 0.1;
  g.add(roof);
  // glazed shopfront recessed into the −Z (platform-facing) wall
  const glass = box(w - 1.2, h - 1.6, 0.12, MAT.glazing, false, false);
  glass.position.set(0, (h - 1.6) / 2 + 0.5, -d / 2 - 0.02);
  g.add(glass);
  // a stall counter / sill projecting from the shopfront
  const counter = box(w - 0.8, 0.3, 0.6, MAT.concourseTrim, true, false);
  counter.position.set(0, 1.0, -d / 2 - 0.35);
  g.add(counter);
  // a small striped awning over the shopfront (sloped, slab — clearly an awning)
  const awn = box(w - 0.6, 0.12, 1.1, MAT.awning, true, false);
  awn.position.set(0, h - 1.0, -d / 2 - 0.55);
  awn.rotation.x = 0.2;
  g.add(awn);
  // a fascia sign board on the −Z face, text reading toward the platform (−Z)
  const sign = signFacingNorthApproach(w - 1.0, 0.8, {
    text: signText, bg: signBg, fg: "#ffffff", emissiveIntensity: 0.45,
  });
  sign.position.set(0, h - 0.5, -d / 2 - 0.08);
  g.add(sign);
  return g;
}

export function buildTransit() {
  const group = new THREE.Group();
  const colliders = [];

  // --- Ground slab: asphalt plaza with a grass verge along the south edge ---
  const slab = box(60, 0.4, 60, MAT.asphalt, false, true);
  slab.position.set(0, -0.2, 0); // top at y = 0
  group.add(slab);

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(60, 16), MAT.grass);
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, 0.02, -22); // south strip, decorative, walk-over
  grass.receiveShadow = true;
  group.add(grass);

  // --- Raised platform along the north side (Z ≈ +9..+15) -------------------
  // SETBACK: the platform is pulled IN to width 44 so it spans X ∈ [-22,+22],
  // a ~8 m setback from each side tile edge (±30) clearing the avenue road grid
  // on the X=±60 seams + kerb + sidewalk. (Z 9..15 already clears the Z seams.)
  const PLAT_Z = 12;       // centre of platform in Z
  const PLAT_DEPTH = 6;    // 9 .. 15
  const PLAT_H = 0.9;
  const PLAT_W = 44;       // X ∈ [-22,+22] — inside the [-23,23] setback band
  const platform = box(PLAT_W, PLAT_H, PLAT_DEPTH, MAT.platform, true, true);
  platform.position.set(0, PLAT_H / 2, PLAT_Z);
  group.add(platform);
  // platform side fascia (slightly inset look)
  const fascia = box(PLAT_W, PLAT_H + 0.02, 0.1, MAT.platformSide, false, true);
  fascia.position.set(0, (PLAT_H + 0.02) / 2, PLAT_Z - PLAT_DEPTH / 2);
  group.add(fascia);
  // yellow safety stripe along the track edge
  const stripe = box(PLAT_W, 0.04, 0.4, MAT.edgeStripe, false, false);
  stripe.position.set(0, PLAT_H + 0.02, PLAT_Z - PLAT_DEPTH / 2 + 0.3);
  group.add(stripe);
  // The platform is a SOLID raised block — collide its full footprint.
  addCollider(colliders, 0, PLAT_Z, PLAT_W, PLAT_DEPTH);

  // --- PLATFORM KIOSK BUILDINGS: two real little structures standing ON the
  // platform (a newsstand + a coffee bar). Each is a SUBSTANTIAL 3D volume
  // (5 m wide × 4.5 m deep × 3.6 m tall) with brick body, glazed shopfront,
  // counter, awning and a sign — NOT a flat facade card — so it reads solid from
  // every side. Placed toward the back of the platform, between the canopy
  // columns (x=±18,0) and benches, with the shopfront facing −Z (the crowd).
  const KIOSK_W = 5, KIOSK_D = 4.5, KIOSK_H = 3.6;
  const kioskZ = PLAT_Z + 0.6;                 // ≈12.6 → spans Z 10.35..14.85 (on platform)
  const kiosks = [
    { x: -10, text: "NEWS", bg: "#1f4fa0" },
    { x: 10, text: "COFFEE", bg: "#7a3b1f" },
  ];
  for (const k of kiosks) {
    const kg = makeKiosk(KIOSK_W, KIOSK_D, KIOSK_H, k.text, k.bg);
    kg.position.set(k.x, PLAT_H, kioskZ);      // sits on the raised platform top
    group.add(kg);
    addCollider(colliders, k.x, kioskZ, KIOSK_W, KIOSK_D);
  }

  // --- Glazed CONCOURSE building along the far north back edge (Z ≈ +16..+22)
  // Sits behind the platform, well clear of the open car/walk lanes. It's the
  // station head-house: a long brick base with a tall glazed concourse facade,
  // mullion grid, cornice/parapet, lit upper windows and rooftop clutter.
  // A real head-house needs genuine DEPTH, not a tall card: the building is now a
  // full 10 m-deep mass (front kept just behind the platform at Z≈15.6, back at
  // Z≈25.6 — well inside the tile) so it reads solid from the front, sides AND
  // back, with a stepped-back upper storey adding rooftop massing.
  // SETBACK: the head-house is re-centred (concX=0) and shrunk so its WHOLE
  // footprint sits in X,Z ∈ [-23,23]. Width 44 → X ∈ [-22,+22]; depth 7 with the
  // front kept just behind the platform (Z=15) → back at Z≈22.4, clearing the
  // cross-street seam at Z=215-world / +30-local + kerb + sidewalk. It stays a
  // full ~7 m-deep, 12 m-tall masonry mass (not a thin slab).
  const CONC_DEPTH = 7;       // building depth in Z (front Z≈15.4 .. back Z≈22.4)
  const CONC_FRONT = 15.4;    // platform-facing wall (platform back edge is Z=15)
  const CONC_Z = CONC_FRONT + CONC_DEPTH / 2; // centre = 18.9 (inside setback band)
  const CONC_W = 44;          // building width in X → X ∈ [-22,+22]
  const CONC_H = 11;          // wall height
  const concX = 0;            // centred on the tile so both ends stay inside ±22

  // masonry base wall
  const concWall = box(CONC_W, CONC_H, CONC_DEPTH, MAT.concourse, true, true);
  concWall.position.set(concX, CONC_H / 2, CONC_Z);
  group.add(concWall);
  // brick plinth band at the bottom of the facade
  const plinth = box(CONC_W + 0.3, 1.6, CONC_DEPTH + 0.3, MAT.brick, false, true);
  plinth.position.set(concX, 0.8, CONC_Z);
  group.add(plinth);
  // CORNICE / parapet cap along the top
  const cornice = box(CONC_W + 0.8, 0.9, CONC_DEPTH + 0.8, MAT.cornice, true, false);
  cornice.position.set(concX, CONC_H + 0.3, CONC_Z);
  group.add(cornice);
  // a thin parapet rail line above the cornice
  const parapet = box(CONC_W + 0.4, 0.5, 0.2, MAT.concourseTrim, false, false);
  parapet.position.set(concX, CONC_H + 1.0, CONC_Z - CONC_DEPTH / 2 - 0.2);
  group.add(parapet);
  // The concourse is solid mass — collide its footprint (clear of all lanes).
  addCollider(colliders, concX, CONC_Z, CONC_W, CONC_DEPTH);

  // STEPPED-BACK UPPER STOREY: a second, narrower+shallower block set on top and
  // toward the back of the head-house, so the building has real volume/massing
  // when seen from the platform AND from behind (not just a tall flat facade).
  const upperW = CONC_W - 14;
  const upperD = CONC_DEPTH - 3.5;
  const upperH = 5.0;
  const upperZ = CONC_Z + 1.4;                 // shifted back off the front wall
  const upper = box(upperW, upperH, upperD, MAT.concourse, true, true);
  upper.position.set(concX, CONC_H + upperH / 2, upperZ);
  group.add(upper);
  const upperCornice = box(upperW + 0.6, 0.7, upperD + 0.6, MAT.cornice, true, false);
  upperCornice.position.set(concX, CONC_H + upperH + 0.2, upperZ);
  group.add(upperCornice);

  // END PAVILION WING (−X end): a taller solid brick corner block anchoring the
  // −X end of the head-house. It rises above the main mass, breaking the long
  // facade into real stepped massing with its own side + back faces (so the
  // building reads solid from every angle, not as a uniform slab). (The +X end is
  // anchored by the clock TOWER below, so only the −X end gets a wing.)
  // SETBACK: its depth is matched to the main mass (front at CONC_FRONT, back at
  // ≈22.4) so its footprint stays inside the [-23,23] band; height is kept tall
  // so it still reads as a substantial corner volume.
  const WING_W = 8;
  const WING_D = CONC_DEPTH;                    // back aligns with the main mass (≈22.4)
  const WING_H = CONC_H + 1.5;                 // taller than the main mass
  const wingFront = CONC_FRONT;                // front kept just behind platform (Z=15)
  const wingCz = wingFront + WING_D / 2;       // ≈ 18.9 (back ≈ 22.4, inside band)
  const wingX = concX - (CONC_W / 2 - WING_W / 2 + 0.5); // ≈ -18.5 → X ∈ [-22.5,-14.5]
  const wing = box(WING_W, WING_H, WING_D, MAT.brick, true, true);
  wing.position.set(wingX, WING_H / 2, wingCz);
  group.add(wing);
  const wingCap = box(WING_W + 0.6, 0.8, WING_D + 0.6, MAT.cornice, true, false);
  wingCap.position.set(wingX, WING_H + 0.3, wingCz);
  group.add(wingCap);
  addCollider(colliders, wingX, wingCz, WING_W, WING_D);

  // GLAZED FACADE: a tall glass curtain wall on the platform-facing (-Z) side,
  // with a regular MULLION grid. The big glass sheet is ONE mesh; the mullions
  // are a single InstancedMesh (one vertical bar per bay + horizontal transoms).
  const facadeZ = CONC_Z - CONC_DEPTH / 2 - 0.04;
  const GLAZE_W = 30;         // central glazed bay width
  const GLAZE_H = 8.2;        // glazed height
  const GLAZE_Y = 4.8;        // centre height of glazing
  const glass = new THREE.Mesh(GEO.facadePane, MAT.glazing);
  glass.scale.set(GLAZE_W, GLAZE_H, 1);
  glass.position.set(concX, GLAZE_Y, facadeZ - 0.05);
  group.add(glass);
  // big recessed entrance portal under the glazing (dark archway box)
  const portal = box(7, 4.4, 0.4, MAT.steel, false, false);
  portal.position.set(concX, 2.2, facadeZ - 0.02);
  group.add(portal);
  // a sloped ENTRANCE CANOPY / awning over the main doors (tilted slab)
  const awning = box(9, 0.2, 2.2, MAT.awning, true, false);
  awning.position.set(concX, 4.6, facadeZ - 1.1);
  awning.rotation.x = 0.22;                            // slope down toward plaza
  group.add(awning);
  // two tie-rods holding the awning back to the facade
  for (const rx of [-3.5, 3.5]) {
    const rod = box(0.08, 0.08, 2.0, MAT.steel, false, false);
    rod.position.set(concX + rx, 5.0, facadeZ - 1.0);
    rod.rotation.x = -0.6;
    group.add(rod);
  }

  // MULLIONS as a single InstancedMesh: vertical bars across the glazed bay
  // plus a few horizontal transoms. Count them, fill one matrix per instance.
  const vBays = 11;                                  // vertical mullions
  const hTransoms = 3;                               // horizontal transoms
  const mullionCount = vBays + hTransoms;
  const mullions = new THREE.InstancedMesh(GEO.mullion, MAT.mullion, mullionCount);
  mullions.castShadow = false;
  const mTmp = new THREE.Object3D();
  let mi = 0;
  for (let i = 0; i < vBays; i++) {
    const fx = concX - GLAZE_W / 2 + (i * GLAZE_W) / (vBays - 1);
    mTmp.position.set(fx, GLAZE_Y, facadeZ);
    mTmp.scale.set(1, GLAZE_H, 1);
    mTmp.rotation.set(0, 0, 0);
    mTmp.updateMatrix();
    mullions.setMatrixAt(mi++, mTmp.matrix);
  }
  for (let j = 0; j < hTransoms; j++) {
    const fy = GLAZE_Y - GLAZE_H / 2 + ((j + 1) * GLAZE_H) / (hTransoms + 1);
    mTmp.position.set(concX, fy, facadeZ);
    mTmp.scale.set(GLAZE_W, 0.12, 1);                // reuse bar, lay horizontal
    mTmp.rotation.set(0, 0, Math.PI / 2);            // rotate the tall bar flat
    mTmp.updateMatrix();
    mullions.setMatrixAt(mi++, mTmp.matrix);
  }
  mullions.instanceMatrix.needsUpdate = true;
  group.add(mullions);

  // LIT UPPER-FLOOR WINDOW GRID flanking the glazing (solid wall reads as offices)
  // One InstancedMesh of small lit panes set into the masonry either side.
  const winCols = 10, winRows = 2;
  const sidePanes = winCols * winRows * 2;           // both flanking wings
  const winInst = new THREE.InstancedMesh(GEO.facadePane, MAT.litWin, sidePanes);
  const wTmp = new THREE.Object3D();
  let wi = 0;
  for (const sign of [-1, 1]) {                       // left + right wings
    // wing centre at ±18.5 with a ±2.5 spread → panes sit in the masonry band
    // between the glazing (±15) and the new wall edge (±22) — inside the setback.
    const wingCenter = concX + sign * (GLAZE_W / 2 + 3.5);
    for (let c = 0; c < winCols; c++) {
      for (let r = 0; r < winRows; r++) {
        const wx = wingCenter - 2.5 + (c * 5) / (winCols - 1);
        const wy = 6.4 + r * 2.4;
        wTmp.position.set(wx, wy, facadeZ + 0.04);
        wTmp.scale.set(0.5, 1.0, 1);
        wTmp.updateMatrix();
        winInst.setMatrixAt(wi++, wTmp.matrix);
      }
    }
  }
  winInst.instanceMatrix.needsUpdate = true;
  group.add(winInst);

  // CLOCK TOWER rising at the +X end of the concourse (a station landmark).
  // SETBACK: pulled in a touch (offset 3.2 from the +X end) so the tower body,
  // its cornice cap AND the wider roof spire (radius 4.2) all stay inside X≤23.
  const TOWER_X = concX + CONC_W / 2 - 3.2;
  const TOWER_H = 18;
  const tower = box(6, TOWER_H, 6, MAT.concourse, true, true);
  tower.position.set(TOWER_X, TOWER_H / 2, CONC_Z);
  group.add(tower);
  const towerCap = box(6.8, 1.0, 6.8, MAT.cornice, true, false);
  towerCap.position.set(TOWER_X, TOWER_H + 0.4, CONC_Z);
  group.add(towerCap);
  // little pyramid-ish roof spire on the tower
  const spire = new THREE.Mesh(new THREE.ConeGeometry(4.2, 3.2, 4), MAT.brick);
  spire.position.set(TOWER_X, TOWER_H + 2.4, CONC_Z);
  spire.rotation.y = Math.PI / 4;
  spire.castShadow = true;
  group.add(spire);
  // tower clock face on the platform-facing side, with moving hands (animated)
  const towerFaceZ = CONC_Z - 3.0 - 0.05;
  const towerFace = new THREE.Mesh(GEO.clockFace, MAT.clockFaceMat);
  towerFace.rotation.x = Math.PI / 2;                 // face toward -Z
  towerFace.scale.set(2.4, 1, 2.4);
  towerFace.position.set(TOWER_X, TOWER_H - 3.5, towerFaceZ);
  group.add(towerFace);
  // Each hand pivots from the face centre: wrap a mesh that is offset upward by
  // half its length inside a holder group placed at the hub, then spin the holder.
  function makeHand(len, thick, z) {
    const holder = new THREE.Group();
    const h = new THREE.Mesh(GEO.clockHand, MAT.clockHandMat);
    h.scale.set(thick, len, 1);
    h.position.y = len / 2;            // base at hub, tip outward
    holder.add(h);
    holder.position.set(TOWER_X, TOWER_H - 3.5, z);
    group.add(holder);
    return holder;
  }
  const towerMin = makeHand(1.9, 1.0, towerFaceZ - 0.12);
  const towerHour = makeHand(1.2, 1.6, towerFaceZ - 0.1);
  // The tower is solid — collide its footprint.
  addCollider(colliders, TOWER_X, CONC_Z, 6, 6);

  // ROOFTOP CLUTTER. The roof is now two levels: a LOWER front-roof strip (in
  // front of the stepped-back upper storey, Z≈17) and the UPPER storey roof on
  // top (Z≈22). Clutter is split between them so nothing buries itself inside the
  // upper storey block. Visual-only (above head height, no colliders).
  const roofY = CONC_H + 0.1;                          // lower (front) roof deck level
  const frontRoofZ = CONC_FRONT + 1.6;                 // ≈17.2 — front of the upper step
  const upperRoofY = CONC_H + upperH + 0.4;            // top of the upper storey
  // AC units sit on the LOWER front roof strip, clear of the upper storey.
  const acXs = [-18, -10, 6, 14];
  for (const ax of acXs) {
    const ac = box(2.0, 1.0, 1.6, MAT.rooftop);
    ac.position.set(concX + ax, roofY + 0.5, frontRoofZ);
    group.add(ac);
    // small fan grille on top
    const grille = box(1.4, 0.12, 1.2, MAT.steel, false, false);
    grille.position.set(concX + ax, roofY + 1.05, frontRoofZ);
    group.add(grille);
  }
  // cylindrical vents — also on the lower front roof strip
  for (const vx of [-14, -2, 10]) {
    const v = new THREE.Mesh(GEO.vent, MAT.rooftop);
    v.position.set(concX + vx, roofY + 0.2, frontRoofZ + 0.9);
    group.add(v);
  }
  // a raised water tank on stubby legs — perched ON the upper storey roof
  const tankBody = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.4, 12), MAT.tank);
  tankBody.position.set(concX - 6, upperRoofY + 1.5, upperZ);
  tankBody.castShadow = true;
  group.add(tankBody);
  const tankCap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.9, 12), MAT.rooftop);
  tankCap.position.set(concX - 6, upperRoofY + 3.1, upperZ);
  group.add(tankCap);
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
    const leg = box(0.18, 1.2, 0.18, MAT.steel, false, false);
    leg.position.set(concX - 6 + lx * 1.0, upperRoofY - 0.3, upperZ + lz * 1.0);
    group.add(leg);
  }
  // glowing skylight strip — set into the upper storey roof
  const skylight = box(8, 0.3, 2.2, MAT.litWin, false, false);
  skylight.position.set(concX + 10, upperRoofY - 0.1, upperZ);
  group.add(skylight);
  // antenna mast
  const antenna = box(0.1, 4.0, 0.1, MAT.steel, false, false);
  antenna.position.set(TOWER_X, TOWER_H + 5.0, CONC_Z);
  group.add(antenna);

  // --- Ballast + track bed beside the platform (Z ≈ +6.5) -------------------
  const TRACK_Z = 6.5;
  const ballast = box(60, 0.25, 3.4, MAT.ballast, false, true);
  ballast.position.set(0, 0.12, TRACK_Z);
  group.add(ballast);
  // sleepers (ties) — reuse one geometry, widely spaced (kept sparse for perf)
  for (let x = -27; x <= 27; x += 9.0) {
    const tie = new THREE.Mesh(GEO.railTie, MAT.tie);
    tie.position.set(x, 0.27, TRACK_Z);
    tie.receiveShadow = true;
    group.add(tie);
  }
  // two steel rails running the length
  for (const dz of [0.75, -0.75]) {
    const r = box(60, 0.12, 0.12, MAT.rail, false, false);
    r.position.set(0, 0.36, TRACK_Z + dz);
    group.add(r);
  }

  // --- The long static train: connected coaches on the track ----------------
  // Built as one Group so the whole consist can slide in update().
  const train = new THREE.Group();
  const COACH_LEN = 13.0;
  const GAP = 0.7;            // coupler gap between coaches
  const COACH_COUNT = 3;
  const totalLen = COACH_COUNT * COACH_LEN + (COACH_COUNT - 1) * GAP;
  let cx0 = -totalLen / 2 + COACH_LEN / 2;
  for (let i = 0; i < COACH_COUNT; i++) {
    const coach = makeCoach(COACH_LEN);
    coach.position.set(cx0 + i * (COACH_LEN + GAP), 0.4, 0);
    train.add(coach);
    // small coupler block between coaches
    if (i < COACH_COUNT - 1) {
      const coupler = box(GAP, 0.5, 0.4, MAT.steel);
      coupler.position.set(cx0 + i * (COACH_LEN + GAP) + COACH_LEN / 2 + GAP / 2, 0.85, 0);
      train.add(coupler);
    }
  }
  train.position.set(0, 0, TRACK_Z);
  group.add(train);
  // The train is solid — collide its full bounding footprint (track Z band).
  addCollider(colliders, 0, TRACK_Z, totalLen + 1, 2.6);

  // --- Station canopy: long roof on a row of columns over the platform -------
  const CANOPY_Z = PLAT_Z + 0.3;
  const colXs = [-18, 0, 18];
  for (const x of colXs) {
    // front + back columns (toward track edge and toward back of platform)
    for (const dz of [-2.0, 1.6]) {
      const col = makeColumn();
      col.position.set(x, PLAT_H, CANOPY_Z + dz);
      group.add(col);
      addCollider(colliders, x, CANOPY_Z + dz, 0.45, 0.45);
    }
  }
  // SETBACK: the canopy roof/beams are narrowed to 44 (X ∈ [-22,+22], matching
  // the platform) so the overhanging slab no longer reaches into the avenue road
  // airspace at the ±30 tile edges. Columns at ±18 still carry it.
  // the roof slab (slight tilt toward the track for a shed-roof look)
  const roof = box(44, 0.3, 5.2, MAT.canopy, true, false);
  roof.position.set(0, PLAT_H + 4.3, CANOPY_Z - 0.2);
  roof.rotation.z = 0.0;
  roof.rotation.x = -0.05;
  group.add(roof);
  // bright underside so it reads from below
  const under = box(43.6, 0.05, 4.9, MAT.canopyUnder, false, false);
  under.position.set(0, PLAT_H + 4.13, CANOPY_Z - 0.2);
  under.rotation.x = -0.05;
  group.add(under);
  // a longitudinal beam tying the column heads
  const beam = box(44, 0.3, 0.3, MAT.steel, true, false);
  beam.position.set(0, PLAT_H + 4.0, CANOPY_Z - 2.0);
  group.add(beam);
  // second longitudinal beam at the back column line
  const beam2 = box(44, 0.3, 0.3, MAT.steel, true, false);
  beam2.position.set(0, PLAT_H + 4.0, CANOPY_Z + 1.6);
  group.add(beam2);
  // RICHER CANOPY STRUCTURE: cross-tie + diagonal brace at each column bay.
  // Reuses the shared trussLeg + unit geometries; visual-only (overhead).
  for (const x of colXs) {
    // a transverse cross-tie linking the front and back columns
    const tie = box(0.22, 0.22, 4.0, MAT.steel, false, false);
    tie.position.set(x, PLAT_H + 3.7, CANOPY_Z - 0.2);
    group.add(tie);
    // two diagonal braces forming a shallow A under the roof
    for (const dz of [-2.0, 1.6]) {
      const brace = new THREE.Mesh(GEO.trussLeg, MAT.steel);
      brace.scale.set(1, 2.2, 1);
      brace.position.set(x, PLAT_H + 2.9, CANOPY_Z + dz * 0.45);
      brace.rotation.x = dz < 0 ? 0.5 : -0.5;
      group.add(brace);
    }
  }

  // --- Departure-board sign: artPanel "sign" "TRANSIT" ----------------------
  // Mounted on a frame hanging under the canopy, facing the platform (+Z look).
  const board = signFacingNorthApproach(7.0, 2.6, {
    text: "TRANSIT",
    bg: "#10324a",
    fg: "#ffd34d",
    emissiveIntensity: 0.5,
    file: "sign-transit.png",
  });
  board.position.set(0, PLAT_H + 3.0, CANOPY_Z + 1.7);
  // readable front already faces −Z (the approaching platform crowd) via scale.x
  group.add(board);
  // dark frame behind the board
  const boardFrame = box(7.4, 3.0, 0.18, MAT.steel, true, false);
  boardFrame.position.set(0, PLAT_H + 3.0, CANOPY_Z + 1.78);
  group.add(boardFrame);
  // keep a handle to the board material for the pulse animation
  const boardMat = board.material;

  // --- Benches on the platform (reuse builder) ------------------------------
  const benchXs = [-18, 0, 18];
  for (const x of benchXs) {
    const b = makeBench();
    b.position.set(x, PLAT_H, PLAT_Z + 1.4);
    b.rotation.y = Math.PI; // backs toward the rear, seats face the track
    group.add(b);
    addCollider(colliders, x, PLAT_Z + 1.4, 1.7, 0.6);
  }

  // --- Lamps along the platform edge ----------------------------------------
  for (const x of [-12, 12]) {
    const lamp = makeLamp();
    lamp.position.set(x, PLAT_H, PLAT_Z - 2.2);
    group.add(lamp);
    addCollider(colliders, x, PLAT_Z - 2.2, 0.3, 0.3);
  }

  // --- Station clock pillar on the plaza verge (SOUTH of the open car lane) --
  // Pulled clear of the drivable band (Z≈[−8,+5]) onto the south verge so it
  // never blocks a car crossing the tile; its face points −Z toward the plaza
  // crowd that approaches from the cafe side.
  const clock = new THREE.Group();
  const clockBody = new THREE.Mesh(GEO.clockBody, MAT.clockMat);
  clockBody.position.y = 1.8;
  clockBody.castShadow = true;
  const face = new THREE.Mesh(GEO.clockFace, MAT.clockFaceMat);
  face.rotation.x = Math.PI / 2;
  face.position.set(0, 3.5, -0.32);            // face the approaching plaza (−Z)
  clock.add(clockBody, face);
  clock.position.set(-2, 0, -11);              // south verge, clear of the lane
  group.add(clock);
  addCollider(colliders, -2, -11, 1.0, 1.0);

  // --- DEPARTURE BOARDS: two extra "sign" artPanels mounted on posts at the
  // platform ends, listing services. They face the platform (+Z look). Each
  // hangs on a small steel frame; their materials pulse with the main board.
  // SETBACK: pulled in to x=±19 (panel half-width 2.3 → X ∈ [16.7,21.3]) so each
  // board hangs over the narrowed platform, well inside the [-23,23] band.
  const depMats = [boardMat];
  const depSpecs = [
    { x: -19, text: "DEPARTURES", bg: "#0d2b14", fg: "#7dffa0", file: "sign-departures.png" },
    { x: 19, text: "ARRIVALS", bg: "#2b1410", fg: "#ffb37d", file: "sign-arrivals.png" },
  ];
  for (const s of depSpecs) {
    const dep = signFacingNorthApproach(4.6, 1.7, {
      text: s.text, bg: s.bg, fg: s.fg, emissiveIntensity: 0.5, file: s.file,
    });
    dep.position.set(s.x, PLAT_H + 2.9, CANOPY_Z + 1.55);
    // front faces −Z (the platform), text non-mirrored
    group.add(dep);
    depMats.push(dep.material);
    const depFrame = box(4.9, 2.0, 0.14, MAT.steel, true, false);
    depFrame.position.set(s.x, PLAT_H + 2.9, CANOPY_Z + 1.62);
    group.add(depFrame);
  }

  // --- TURNSTILE ROW at the plaza-side platform entrance (south edge of plat).
  // A line of gates; the tri-arm barriers slowly rotate (animated). Their thin
  // cabinet footprints are solid; the open gaps between them stay walkable.
  const turnstiles = [];
  const tsZ = PLAT_Z - PLAT_DEPTH / 2 - 0.9;          // just in front of platform
  for (const tx of [-7, -4, -1, 2, 5]) {
    const { group: tsG, arm } = makeTurnstile();
    tsG.position.set(tx, 0, tsZ);
    group.add(tsG);
    turnstiles.push(arm);
    addCollider(colliders, tx, tsZ, 0.5, 0.7);
  }
  // a low rail/screen behind the turnstile row (visual divider, no collider)
  const tsRail = box(13, 1.1, 0.12, MAT.mullion, false, false);
  tsRail.position.set(-1, 0.55, tsZ - 0.45);
  group.add(tsRail);

  // --- WAYFINDING SIGNAGE: a freestanding totem near the turnstiles. ---------
  // The player APPROACHES from the plaza/cafe side (−Z), so the readable face is
  // mounted on the −Z side of the post and rotated to face −Z (not the platform,
  // which would show the text mirrored to anyone walking up to the gates).
  const totemPost = box(0.22, 3.4, 0.22, MAT.steel, true, false);
  totemPost.position.set(9.5, 1.7, tsZ);
  group.add(totemPost);
  const totem = signFacingNorthApproach(1.6, 2.0, {
    text: "PLATFORM 1", bg: "#10324a", fg: "#ffffff", emissiveIntensity: 0.4,
    file: "sign-platform1.png",
  });
  totem.position.set(9.5, 2.7, tsZ - 0.13);   // panel on the approach (−Z) face,
  // its readable front facing −Z toward the oncoming plaza crowd (non-mirrored)
  group.add(totem);
  addCollider(colliders, 9.5, tsZ, 0.4, 0.4);

  // --- CATENARY POLES along the track, carrying a contact wire over the train.
  // Masts stand on the far (track) side; a thin wire box spans between heads.
  // All overhead — visual only, no colliders in the open lanes.
  const CAT_Z = TRACK_Z - 2.1;                         // track-side of the rails
  // SETBACK: masts pulled in to ±20 (was ±24) so the end poles + cantilever arms
  // sit over the narrowed track/train and clear the avenue road grid on the seams.
  const catXs = [-20, -10, 0, 10, 20];
  const CAT_TOP = 5.2;
  for (const cxp of catXs) {
    const mast = new THREE.Mesh(GEO.catPole, MAT.catenary);
    mast.position.set(cxp, CAT_TOP / 2, CAT_Z);
    mast.castShadow = true;
    group.add(mast);
    // cantilever arm reaching over the track toward the train
    const armC = box(2.4, 0.12, 0.12, MAT.catenary, false, false);
    armC.position.set(cxp + 1.2, CAT_TOP - 0.4, CAT_Z + 1.0);
    armC.rotation.y = -0.5;
    group.add(armC);
  }
  // the contact wire: one long thin box running the mast line
  const wire = box(42, 0.05, 0.05, MAT.wire, false, false);  // spans the ±20 masts
  wire.position.set(0, CAT_TOP - 0.6, TRACK_Z - 1.0);
  group.add(wire);

  // --- STREET DRESSING on the plaza south of the platform (well clear of the
  // open car/walk lanes Z≈[-8,+5]): bollard line, planters, a bin, a bench.
  // Bollards line the grass-verge edge at Z≈-13 (south of the open lanes).
  // SETBACK: the row is pulled in to ±21 so the end bollards clear the avenue
  // road grid on the X=±60 seams (formerly the ±24 ends sat in the kerb/road).
  const bollardZ = -13;
  for (let bx = -21; bx <= 21; bx += 6) {
    const bol = new THREE.Mesh(GEO.bollard, MAT.steel);
    bol.position.set(bx, 0.45, bollardZ);
    bol.castShadow = true;
    group.add(bol);
    addCollider(colliders, bx, bollardZ, 0.32, 0.32);
  }
  // planters at the BACK of the platform (on the raised top), flanking the
  // concourse glazed entrance. Placed clear of the kiosks (x=±10) and tower (x≈19).
  const planterZ = PLAT_Z + PLAT_DEPTH / 2 - 0.8;   // ≈14.2, just in front of concourse
  for (const px of [-16, 4]) {
    const planter = makePlanter();
    planter.position.set(px, PLAT_H, planterZ);     // sits on the platform top
    group.add(planter);
    addCollider(colliders, px, planterZ, 1.4, 1.4);
  }
  const bin1 = makeBin();
  bin1.position.set(-9, 0, bollardZ - 0.8);
  group.add(bin1);
  addCollider(colliders, -9, bollardZ - 0.8, 0.6, 0.6);
  // a plaza bench facing the station (south verge, clear of lanes)
  const plazaBench = makeBench();
  plazaBench.position.set(6, 0, -15);
  group.add(plazaBench);
  addCollider(colliders, 6, -15, 1.7, 0.6);

  // --- STRING LIGHTS: a festoon of small glowing bulbs strung along the plaza
  // front, between two short posts. One shared InstancedMesh of bulbs. ---------
  const fpZ = -10.5;
  for (const px of [-21, 21]) {                       // posts pulled inside ±23
    const fp = box(0.14, 4.0, 0.14, MAT.steel, true, false);
    fp.position.set(px, 2.0, fpZ);
    group.add(fp);
  }
  const bulbCount = 22;
  const bulbs = new THREE.InstancedMesh(GEO.lampHead, MAT.lampGlass, bulbCount);
  const bTmp = new THREE.Object3D();
  for (let i = 0; i < bulbCount; i++) {
    const f = i / (bulbCount - 1);
    const bx = -21 + f * 42;                           // span matches the ±21 posts
    // gentle catenary droop
    const droop = Math.sin(f * Math.PI) * 0.6;
    bTmp.position.set(bx, 3.7 - droop, fpZ);
    bTmp.scale.set(0.45, 0.45, 0.45);
    bTmp.updateMatrix();
    bulbs.setMatrixAt(i, bTmp.matrix);
  }
  bulbs.instanceMatrix.needsUpdate = true;
  group.add(bulbs);

  // --- Animation state ------------------------------------------------------
  // The train slowly slides in and out along X (parked → eases away → returns),
  // the departure boards pulse their glow, the turnstile barriers idle-rotate,
  // and the tower clock hands sweep. No per-frame allocation.
  const TRAIN_BASE_X = 0;
  const TRAIN_TRAVEL = 9;   // metres of slide
  let t = 0;
  const baseGlow = 0.5;

  function update(dt) {
    t += dt;
    // gentle ease-in/ease-out slide using a slow sine; the train never fully
    // leaves so the station always reads as occupied.
    train.position.x = TRAIN_BASE_X + Math.sin(t * 0.18) * TRAIN_TRAVEL;
    // pulse all departure-board glows between ~0.3 and ~0.8.
    const glow = baseGlow + Math.sin(t * 2.2) * 0.25;
    for (let i = 0; i < depMats.length; i++) depMats[i].emissiveIntensity = glow;
    // turnstile barriers creep forward (as if passengers pass through).
    for (let i = 0; i < turnstiles.length; i++) turnstiles[i].rotation.y += dt * 0.35;
    // tower clock: minute hand sweeps, hour hand much slower (sped up for life).
    towerMin.rotation.z = -t * 0.5;
    towerHour.rotation.z = -t * 0.5 / 12;
  }

  // Whole tile is walkable; the slab + props sit on it. Buildings block via
  // colliders. A car can cross the open plaza (Z roughly -8..+5, no colliders).
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  return { group, colliders, ground, update };
}
