// Roaming wildlife + DINOSAURS for the open-world city + park.
//
// buildWildlife(opts = {}) -> { group, update(dt) }
//   opts.bounds  optional { minX, maxX, minZ, maxZ } roam rectangle. Defaults to
//                the city span x∈[-120,120], z∈[20,280]. A small keep-out box near
//                the origin protects the café footprint / front plaza.
//
// A lively mix of ~16 creatures wanders the streets and park: deer, dogs, a cat,
// ducks, pigeons, a rabbit — and the headliners, a TALL T-REX, two fast RAPTORS,
// a huge grazing BRONTOSAURUS and a TRICERATOPS, all a touch larger than life so
// they read as a fun surprise downtown. Every creature picks a target inside the
// bounds, turns to face travel, walks there with a leg-swing/body-bob gait
// (tail sway, neck dip for grazers), then picks a new target on arrival or after
// a timer. Grazers stop and graze for a few seconds before moving on.
//
// ---------------------------------------------------------------------------
// FORWARD-COMPATIBLE ART (procedural now, real models later)
// ---------------------------------------------------------------------------
// Every creature here is a plain THREE.Group of shared low-poly primitives —
// zero external assets, so it never fails to load. The animation only mutates
// transforms on a few cached child groups (legs / tail / neck), which is exactly
// the interface a rigged GLB exposes. To swap in free CC0 models later
// (Quaternius "Animated Animals" + "Ultimate Dinosaurs" packs, CC0):
//
//   1. Drop the .glb files in /public/models/ (e.g. /public/models/trex.glb).
//   2. import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
//   3. In a make* factory, load the scene and (optionally) an AnimationMixer:
//        const gltf = await loader.loadAsync("/models/trex.glb");
//        const mixer = new THREE.AnimationMixer(gltf.scene);
//        const walk  = mixer.clipAction(gltf.animations.find(a => /walk/i.test(a.name)));
//        return { group: gltf.scene, mixer, action: walk /* , legs:[], tail, neck */ };
//   4. In update(dt): if a creature has a mixer, call `c.mixer.update(dt)` and let
//      the clip drive the gait instead of the procedural leg/tail/neck writes; the
//      wander/steer code below stays identical (it only touches group.position /
//      group.rotation.y). Pre-build/cache the mixers — never construct in update().
//
// Keep the wander state machine and the per-frame "transform writes only" rule and
// the two art paths stay interchangeable.
//
// PERFORMANCE: all meshes/geometries/materials are built once at construction and
// shared. update(dt) is ALLOCATION-FREE — it only reads numbers off preallocated
// per-creature records and writes into existing position/rotation objects. No
// `new`, no array/object literals, no closures created per frame.

import * as THREE from "three";

const TWO_PI = Math.PI * 2;

// ---- Shared unit geometries (scaled per part; built once) --------------------
const GEO = {
  box:  new THREE.BoxGeometry(1, 1, 1),           // unit cube
  sph:  new THREE.SphereGeometry(0.5, 10, 8),      // unit-diameter sphere
  cone: new THREE.ConeGeometry(0.5, 1, 9),         // unit cone, apex +Y
};

// ---- Cached materials (one per colour, reused across every creature) ----------
const _matCache = new Map();
function mat(color) {
  let m = _matCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0, flatShading: true });
    _matCache.set(color, m);
  }
  return m;
}
const EYE  = mat("#141418");
const BEAK = mat("#e0a52e");
const CLAW = mat("#e9e2cc");
const HORN = mat("#d8cdab");
const TOOTH = mat("#f0ece0");

// ---- Tiny mesh helpers (construction-time only) ------------------------------
function box(m, w, h, d, x, y, z) {
  const e = new THREE.Mesh(GEO.box, m);
  e.scale.set(w, h, d); e.position.set(x, y, z); e.castShadow = true;
  return e;
}
function ball(m, w, h, d, x, y, z) {
  const e = new THREE.Mesh(GEO.sph, m);
  e.scale.set(w, h, d); e.position.set(x, y, z); e.castShadow = true;
  return e;
}
function cone(m, w, h, d, x, y, z) {
  const e = new THREE.Mesh(GEO.cone, m);
  e.scale.set(w, h, d); e.position.set(x, y, z); e.castShadow = true;
  return e;
}
// A leg as a pivot GROUP at the hip joint with a box hanging straight down, so a
// rotation.x on the pivot swings the whole limb from the hip (foot at local y=0).
function limb(m, w, len, d, hx, hy, hz) {
  const piv = new THREE.Group();
  piv.position.set(hx, hy, hz);
  const seg = new THREE.Mesh(GEO.box, m);
  seg.scale.set(w, len, d); seg.position.y = -len / 2; seg.castShadow = true;
  piv.add(seg);
  return piv;
}
function eyesOn(g, sepX, y, z, r) {
  g.add(ball(EYE, r, r, r, -sepX, y, z));
  g.add(ball(EYE, r, r, r,  sepX, y, z));
}

// =============================================================================
// CREATURE FACTORIES  — each returns { group, legs:[pivot…], legDir:[±1…],
//                        tail:Group|null, neck:Group|null, ears:[pivot…]|null }
// All built facing +Z (snout at +Z, tail at -Z); feet rest at local y = 0.
// =============================================================================

function makeDeer(c, belly) {
  const g = new THREE.Group(), bm = mat(c), bl = mat(belly);
  g.add(box(bm, 0.55, 0.6, 1.5, 0, 1.36, 0));   // body
  g.add(box(bl, 0.5, 0.3, 1.32, 0, 1.16, 0));   // pale belly
  g.add(box(bm, 0.5, 0.55, 0.5, 0, 1.46, 0.58)); // shoulders
  const legs = [];
  for (const [hx, hz] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) {
    const L = limb(bm, 0.12, 1.06, 0.12, hx, 1.06, hz); g.add(L); legs.push(L);
  }
  const neck = new THREE.Group(); neck.position.set(0, 1.62, 0.58);
  neck.add(box(bm, 0.22, 0.72, 0.24, 0, 0.32, 0.05)); // neck
  neck.add(box(bm, 0.26, 0.3, 0.36, 0, 0.68, 0.2));   // head
  neck.add(box(bm, 0.18, 0.18, 0.26, 0, 0.62, 0.42)); // snout
  const ears = [];
  for (const sx of [-0.13, 0.13]) { const e = cone(bm, 0.1, 0.24, 0.06, sx, 0.84, 0.14); neck.add(e); ears.push(e); }
  for (const sx of [-0.08, 0.08]) neck.add(box(bl, 0.04, 0.34, 0.04, sx, 0.94, 0.08)); // antler stubs
  eyesOn(neck, 0.11, 0.7, 0.36, 0.05);
  g.add(neck);
  const tail = new THREE.Group(); tail.position.set(0, 1.52, -0.72);
  tail.add(box(bl, 0.1, 0.28, 0.12, 0, -0.12, -0.03)); g.add(tail);
  return { group: g, legs, legDir: [1, -1, -1, 1], tail, neck, ears };
}

function makeDog(c) {
  const g = new THREE.Group(), bm = mat(c);
  g.add(box(bm, 0.36, 0.4, 0.95, 0, 0.6, 0));   // body
  g.add(box(bm, 0.38, 0.42, 0.4, 0, 0.62, 0.42)); // chest
  const legs = [];
  for (const [hx, hz] of [[-0.13, 0.3], [0.13, 0.3], [-0.13, -0.3], [0.13, -0.3]]) {
    const L = limb(bm, 0.1, 0.5, 0.1, hx, 0.5, hz); g.add(L); legs.push(L);
  }
  const neck = new THREE.Group(); neck.position.set(0, 0.72, 0.52);
  neck.add(box(bm, 0.3, 0.32, 0.34, 0, 0.1, 0.12));  // head
  neck.add(box(bm, 0.18, 0.16, 0.22, 0, 0.04, 0.34)); // snout
  const ears = [];
  for (const sx of [-0.15, 0.15]) { const e = box(bm, 0.08, 0.18, 0.04, sx, 0.22, 0.05); neck.add(e); ears.push(e); }
  eyesOn(neck, 0.1, 0.14, 0.27, 0.04);
  g.add(neck);
  const tail = new THREE.Group(); tail.position.set(0, 0.72, -0.5);
  tail.add(box(bm, 0.08, 0.08, 0.4, 0, 0.06, -0.2)); g.add(tail); // jaunty tail
  return { group: g, legs, legDir: [1, -1, -1, 1], tail, neck, ears };
}

function makeCat(c) {
  const g = new THREE.Group(), bm = mat(c);
  g.add(box(bm, 0.26, 0.28, 0.72, 0, 0.42, 0));
  const legs = [];
  for (const [hx, hz] of [[-0.09, 0.24], [0.09, 0.24], [-0.09, -0.24], [0.09, -0.24]]) {
    const L = limb(bm, 0.07, 0.34, 0.07, hx, 0.34, hz); g.add(L); legs.push(L);
  }
  const neck = new THREE.Group(); neck.position.set(0, 0.5, 0.4);
  neck.add(ball(bm, 0.26, 0.24, 0.24, 0, 0.06, 0.06)); // round head
  const ears = [];
  for (const sx of [-0.08, 0.08]) { const e = cone(bm, 0.08, 0.14, 0.05, sx, 0.2, 0.02); neck.add(e); ears.push(e); }
  eyesOn(neck, 0.07, 0.08, 0.16, 0.035);
  g.add(neck);
  const tail = new THREE.Group(); tail.position.set(0, 0.5, -0.38);
  tail.add(box(bm, 0.07, 0.07, 0.5, 0, 0.12, -0.2)); g.add(tail); // long upright tail
  return { group: g, legs, legDir: [1, -1, -1, 1], tail, neck, ears };
}

function makeDuck(bodyC, headC) {
  const g = new THREE.Group(), bm = mat(bodyC);
  g.add(ball(bm, 0.5, 0.46, 0.84, 0, 0.46, 0));      // plump body
  g.add(box(bm, 0.18, 0.2, 0.22, 0, 0.62, -0.42));   // perky tail
  for (const sx of [-0.27, 0.27]) g.add(box(bm, 0.07, 0.24, 0.4, sx, 0.5, -0.02)); // folded wings
  const neck = new THREE.Group(); neck.position.set(0, 0.58, 0.3);
  neck.add(box(mat(headC), 0.18, 0.28, 0.18, 0, 0.12, 0));   // neck
  neck.add(ball(mat(headC), 0.3, 0.3, 0.32, 0, 0.34, 0.06)); // head
  neck.add(box(BEAK, 0.18, 0.09, 0.24, 0, 0.3, 0.26));        // bill
  eyesOn(neck, 0.12, 0.36, 0.16, 0.035);
  g.add(neck);
  const legs = [];
  for (const hx of [-0.12, 0.12]) { const L = limb(BEAK, 0.07, 0.26, 0.07, hx, 0.26, -0.02); g.add(L); legs.push(L); }
  return { group: g, legs, legDir: [1, 1], tail: null, neck, ears: null };
}

function makePigeon(c) {
  const g = new THREE.Group(), bm = mat(c);
  g.add(ball(bm, 0.32, 0.34, 0.56, 0, 0.3, 0));
  g.add(box(bm, 0.16, 0.1, 0.26, 0, 0.34, -0.32));   // tail
  const neck = new THREE.Group(); neck.position.set(0, 0.4, 0.18);
  neck.add(ball(mat("#5f6b78"), 0.22, 0.24, 0.22, 0, 0.12, 0.06)); // head (darker)
  neck.add(box(BEAK, 0.06, 0.05, 0.12, 0, 0.1, 0.2));
  eyesOn(neck, 0.08, 0.14, 0.12, 0.028);
  g.add(neck);
  const legs = [];
  for (const hx of [-0.08, 0.08]) { const L = limb(mat("#c8635a"), 0.04, 0.16, 0.04, hx, 0.16, 0); g.add(L); legs.push(L); }
  return { group: g, legs, legDir: [1, 1], tail: null, neck, ears: null };
}

function makeRabbit(c) {
  const g = new THREE.Group(), bm = mat(c);
  g.add(ball(bm, 0.34, 0.38, 0.52, 0, 0.32, -0.02)); // body
  g.add(ball(mat("#f3efe6"), 0.16, 0.16, 0.16, 0, 0.34, -0.3)); // cotton tail
  const neck = new THREE.Group(); neck.position.set(0, 0.4, 0.2);
  neck.add(ball(bm, 0.28, 0.28, 0.3, 0, 0.08, 0.06)); // head
  neck.add(ball(mat("#e7b8b0"), 0.07, 0.06, 0.07, 0, 0.04, 0.22)); // nose
  const ears = [];
  for (const sx of [-0.08, 0.09]) { const e = box(bm, 0.07, 0.42, 0.04, sx, 0.34, -0.02); e.rotation.z = sx > 0 ? -0.08 : 0.08; neck.add(e); ears.push(e); }
  eyesOn(neck, 0.12, 0.1, 0.14, 0.04);
  g.add(neck);
  const legs = [];
  legs.push(addLeg(g, bm, 0.07, 0.18, 0.08, -0.12, 0.18, 0.16)); // FL
  legs.push(addLeg(g, bm, 0.07, 0.18, 0.08,  0.12, 0.18, 0.16)); // FR
  legs.push(addLeg(g, bm, 0.1, 0.26, 0.16, -0.13, 0.26, -0.12)); // BL (haunch)
  legs.push(addLeg(g, bm, 0.1, 0.26, 0.16,  0.13, 0.26, -0.12)); // BR
  return { group: g, legs, legDir: [1, 1, 1, 1], tail: null, neck, ears };
}
function addLeg(g, m, w, len, d, hx, hy, hz) { const L = limb(m, w, len, d, hx, hy, hz); g.add(L); return L; }

// ---- DINOSAURS ---------------------------------------------------------------

function makeTRex(c, belly) {
  const g = new THREE.Group(), bm = mat(c), bl = mat(belly);
  g.add(box(bm, 1.1, 1.3, 2.4, 0, 3.0, -0.1));   // torso
  g.add(box(bl, 0.9, 0.7, 1.8, 0, 2.7, 0.1));    // pale belly
  g.add(box(bm, 1.0, 1.1, 1.0, 0, 2.9, -0.95));  // haunch mass
  // Two powerful legs (with a foot box) — biped diagonal-free swing.
  const legs = [];
  for (const hx of [-0.5, 0.5]) {
    const L = limb(bm, 0.55, 2.45, 0.6, hx, 2.55, -0.05);
    L.children[0].add(box(bm, 0.62, 0.3, 1.0, 0, -1.25, 0.28)); // foot at shin base
    g.add(L); legs.push(L);
  }
  // Tiny comedic arms.
  for (const sx of [-0.42, 0.42]) { const a = box(bm, 0.14, 0.5, 0.14, sx, 2.72, 0.85); a.rotation.x = 0.7; g.add(a); }
  // Short neck + big head with jaws + teeth.
  const neck = new THREE.Group(); neck.position.set(0, 3.45, 0.9);
  neck.add(box(bm, 0.62, 0.7, 0.7, 0, 0.12, 0.1));
  neck.add(box(bm, 0.95, 1.0, 1.7, 0, 0.42, 0.95));   // upper head
  neck.add(box(bl, 0.82, 0.28, 1.35, 0, -0.02, 1.0)); // lower jaw
  for (let i = 0; i < 4; i++) for (const sx of [-0.33, 0.33])
    neck.add(box(TOOTH, 0.07, 0.16, 0.07, sx, 0.18, 0.55 + i * 0.34)); // tooth row
  eyesOn(neck, 0.42, 0.7, 1.3, 0.09);
  g.add(neck);
  // Thick tapering tail.
  const tail = new THREE.Group(); tail.position.set(0, 3.0, -1.25);
  tail.add(box(bm, 0.75, 0.75, 1.4, 0, -0.05, -0.7));
  tail.add(box(bm, 0.46, 0.46, 1.4, 0, -0.18, -1.9));
  tail.add(box(bm, 0.24, 0.24, 1.2, 0, -0.32, -3.0));
  g.add(tail);
  return { group: g, legs, legDir: [1, -1], tail, neck, ears: null };
}

function makeRaptor(c, belly) {
  const g = new THREE.Group(), bm = mat(c), bl = mat(belly);
  g.add(box(bm, 0.5, 0.55, 1.45, 0, 1.7, 0));    // body
  g.add(box(bl, 0.4, 0.35, 1.1, 0, 1.55, 0.05)); // belly
  g.add(box(bm, 0.46, 0.5, 0.6, 0, 1.66, -0.5)); // hips
  const legs = [];
  for (const hx of [-0.28, 0.28]) {
    const L = limb(bm, 0.26, 1.35, 0.32, hx, 1.42, 0.02);
    L.children[0].add(box(bm, 0.28, 0.16, 0.5, 0, -0.7, 0.18));      // foot
    L.children[0].add(cone(CLAW, 0.08, 0.22, 0.08, 0, -0.74, 0.44)); // sickle claw
    g.add(L); legs.push(L);
  }
  for (const sx of [-0.28, 0.28]) { const a = box(bm, 0.1, 0.45, 0.1, sx, 1.62, 0.45); a.rotation.x = 0.9; g.add(a); }
  const neck = new THREE.Group(); neck.position.set(0, 1.96, 0.5);
  neck.add(box(bm, 0.22, 0.52, 0.24, 0, 0.2, 0.1));   // neck
  neck.add(box(bm, 0.3, 0.34, 0.74, 0, 0.42, 0.42));  // snout/head
  neck.add(box(bl, 0.26, 0.12, 0.6, 0, 0.3, 0.46));   // lower jaw
  eyesOn(neck, 0.14, 0.5, 0.42, 0.05);
  g.add(neck);
  const tail = new THREE.Group(); tail.position.set(0, 1.7, -0.7);
  tail.add(box(bm, 0.3, 0.3, 1.6, 0, -0.02, -0.8));
  tail.add(box(bm, 0.18, 0.18, 1.3, 0, -0.06, -2.05));
  g.add(tail);
  return { group: g, legs, legDir: [1, -1], tail, neck, ears: null };
}

function makeBronto(c, belly) {
  const g = new THREE.Group(), bm = mat(c), bl = mat(belly);
  g.add(box(bm, 1.7, 1.9, 4.3, 0, 3.0, 0));      // huge body
  g.add(box(bl, 1.4, 0.9, 3.6, 0, 2.5, 0));      // belly
  const legs = [];
  for (const [hx, hz] of [[-0.6, 1.4], [0.6, 1.4], [-0.6, -1.4], [0.6, -1.4]]) {
    const L = limb(bm, 0.55, 2.3, 0.55, hx, 2.3, hz);
    L.children[0].add(box(bm, 0.62, 0.3, 0.7, 0, -1.18, 0)); // round foot
    g.add(L); legs.push(L);
  }
  // The long neck is the headliner — dips to graze in update().
  const neck = new THREE.Group(); neck.position.set(0, 3.7, 1.9);
  neck.add(box(bm, 0.55, 2.7, 0.6, 0, 1.35, 0.35));  // long neck (angled fwd)
  neck.add(box(bm, 0.45, 0.5, 0.85, 0, 2.75, 0.7));  // small head
  neck.add(box(bm, 0.3, 0.2, 0.4, 0, 2.66, 1.05));   // snout
  eyesOn(neck, 0.22, 2.85, 0.95, 0.07);
  g.add(neck);
  const tail = new THREE.Group(); tail.position.set(0, 3.0, -2.1);
  tail.add(box(bm, 0.6, 0.6, 1.8, 0, 0, -0.9));
  tail.add(box(bm, 0.38, 0.38, 1.8, 0, -0.1, -2.4));
  tail.add(box(bm, 0.18, 0.18, 1.6, 0, -0.2, -3.9));
  g.add(tail);
  return { group: g, legs, legDir: [1, -1, -1, 1], tail, neck, ears: null };
}

function makeTriceratops(c, belly) {
  const g = new THREE.Group(), bm = mat(c), bl = mat(belly);
  g.add(box(bm, 1.2, 1.2, 2.5, 0, 1.5, -0.1));
  g.add(box(bl, 1.0, 0.6, 2.0, 0, 1.15, -0.1));
  const legs = [];
  for (const [hx, hz] of [[-0.5, 0.85], [0.5, 0.85], [-0.52, -0.9], [0.52, -0.9]]) {
    const L = limb(bm, 0.4, 1.1, 0.45, hx, 1.1, hz); g.add(L); legs.push(L);
  }
  // Head/frill assembly on a short neck (mild grazer dip).
  const neck = new THREE.Group(); neck.position.set(0, 1.55, 1.15);
  neck.add(box(bm, 1.6, 1.45, 0.22, 0, 0.35, -0.1));  // bony frill
  neck.add(box(bm, 0.95, 0.8, 0.95, 0, 0.05, 0.45));  // head
  neck.add(box(BEAK, 0.34, 0.4, 0.34, 0, -0.12, 0.92)); // beak
  // Three horns: a small nose horn + two long brow horns pointing forward-up.
  const nose = cone(HORN, 0.16, 0.42, 0.16, 0, 0.2, 0.9); nose.rotation.x = 0.5; neck.add(nose);
  for (const sx of [-0.32, 0.32]) { const h = cone(HORN, 0.16, 0.7, 0.16, sx, 0.55, 0.6); h.rotation.x = 0.9; neck.add(h); }
  eyesOn(neck, 0.4, 0.25, 0.55, 0.06);
  g.add(neck);
  const tail = new THREE.Group(); tail.position.set(0, 1.5, -1.3);
  tail.add(box(bm, 0.4, 0.4, 1.2, 0, -0.1, -0.6)); g.add(tail);
  return { group: g, legs, legDir: [1, -1, -1, 1], tail, neck, ears: null };
}

// =============================================================================
// MOTION PROFILES (per kind) — units are SI-ish: speed m/s, turn rad/s.
//   gait      leg-swing angular rate
//   legAmp    leg swing amplitude (rad)
//   bob       vertical body bob amplitude (m)
//   tailRate/tailAmp   tail sway
//   graze     stop & dip the neck on arrival (deer/bronto/triceratops)
//   grazeAng  neck pitch when grazing
//   hop       hopper gait (legs in phase, bigger bob — ducks/pigeons/rabbit)
//   arrive    distance (m) that counts as "reached target"
//   walk[lo,hi]  seconds before forcing a fresh target while walking
// =============================================================================
const PROFILE = {
  deer:        { speed: 2.1, turn: 2.2, gait: 7,   legAmp: 0.6, bob: 0.06, tailRate: 3.0, tailAmp: 0.22, graze: true,  grazeAng: 1.15, grazeDur: 5, hop: false, arrive: 3,   walk: [6, 12], earAmp: 0.1 },
  dog:         { speed: 2.7, turn: 3.0, gait: 10,  legAmp: 0.7, bob: 0.05, tailRate: 9.0, tailAmp: 0.55, graze: false, grazeAng: 0,    grazeDur: 0, hop: false, arrive: 2.5, walk: [4, 9],  earAmp: 0.14 },
  cat:         { speed: 2.0, turn: 3.2, gait: 9,   legAmp: 0.55,bob: 0.04, tailRate: 3.5, tailAmp: 0.5,  graze: false, grazeAng: 0,    grazeDur: 0, hop: false, arrive: 2,   walk: [4, 9],  earAmp: 0.1 },
  duck:        { speed: 1.2, turn: 2.6, gait: 9,   legAmp: 0.5, bob: 0.1,  tailRate: 5.0, tailAmp: 0.2,  graze: false, grazeAng: 0,    grazeDur: 0, hop: true,  arrive: 1.5, walk: [4, 8],  earAmp: 0, wobble: true },
  pigeon:      { speed: 1.4, turn: 3.0, gait: 12,  legAmp: 0.5, bob: 0.12, tailRate: 6.0, tailAmp: 0.2,  graze: false, grazeAng: 0,    grazeDur: 0, hop: true,  arrive: 1.2, walk: [3, 7],  earAmp: 0 },
  rabbit:      { speed: 2.3, turn: 3.0, gait: 6.5, legAmp: 0.45,bob: 0.24, tailRate: 4.0, tailAmp: 0.0,  graze: false, grazeAng: 0,    grazeDur: 0, hop: true,  arrive: 1.5, walk: [3, 7],  earAmp: 0.18 },
  trex:        { speed: 2.7, turn: 1.4, gait: 5.5, legAmp: 0.55,bob: 0.14, tailRate: 2.2, tailAmp: 0.22, graze: false, grazeAng: 0,    grazeDur: 0, hop: false, arrive: 4,   walk: [7, 14], earAmp: 0 },
  raptor:      { speed: 4.5, turn: 2.7, gait: 9.5, legAmp: 0.6, bob: 0.1,  tailRate: 4.0, tailAmp: 0.15, graze: false, grazeAng: 0,    grazeDur: 0, hop: false, arrive: 3,   walk: [5, 10], earAmp: 0 },
  bronto:      { speed: 1.1, turn: 0.9, gait: 3.2, legAmp: 0.3, bob: 0.05, tailRate: 1.4, tailAmp: 0.25, graze: true,  grazeAng: 1.35, grazeDur: 7, hop: false, arrive: 6,   walk: [9, 16], earAmp: 0 },
  triceratops: { speed: 1.6, turn: 1.4, gait: 5.0, legAmp: 0.4, bob: 0.06, tailRate: 2.5, tailAmp: 0.2,  graze: true,  grazeAng: 0.5,  grazeDur: 5, hop: false, arrive: 3.5, walk: [7, 13], earAmp: 0 },
};

// Which factory builds each kind, and a small colour palette per kind.
const KIND = {
  deer:        { make: (i) => makeDeer(["#9c6b3f", "#8a5d36", "#a87a4c"][i % 3], "#d8c0a0") },
  dog:         { make: (i) => makeDog(["#7a5232", "#2a2a2e", "#d9c39a", "#b8924f"][i % 4]) },
  cat:         { make: (i) => makeCat(["#3a3a40", "#d9853b", "#cfc8bd"][i % 3]) },
  duck:        { make: (i) => makeDuck("#e9e4d8", "#2f6f43") },
  pigeon:      { make: (i) => makePigeon(["#8a929c", "#a7adb5"][i % 2]) },
  rabbit:      { make: (i) => makeRabbit(["#c9bda8", "#9a9088"][i % 2]) },
  trex:        { make: (i) => makeTRex("#5e7d4a", "#caa86a") },
  raptor:      { make: (i) => makeRaptor(["#a9742e", "#8f6f3a"][i % 2], "#d8c48a") },
  bronto:      { make: (i) => makeBronto("#5b6f8c", "#7d8ca3") },
  triceratops: { make: (i) => makeTriceratops("#6f7d5a", "#9aa07e") },
};

// How many of each to spawn (~16 creatures: 11 animals + 5 dinosaurs).
const SPAWN = [
  ["deer", 3], ["dog", 2], ["cat", 1], ["duck", 2], ["pigeon", 2], ["rabbit", 1],
  ["trex", 1], ["raptor", 2], ["bronto", 1], ["triceratops", 1],
];

export function buildWildlife(opts = {}) {
  const group = new THREE.Group();
  group.name = "wildlife";

  const b = opts.bounds || {};
  const minX = b.minX ?? -120, maxX = b.maxX ?? 120;
  const minZ = b.minZ ?? 20,  maxZ = b.maxZ ?? 280;
  const spanX = maxX - minX, spanZ = maxZ - minZ;
  // Keep-out box guarding the café footprint / front plaza near the origin.
  const KX0 = -22, KX1 = 22, KZ0 = -30, KZ1 = 26;
  function inKeepout(x, z) { return x > KX0 && x < KX1 && z > KZ0 && z < KZ1; }

  // Deterministic per-creature PRNG (xorshift on an integer seed stored on the
  // record). No allocation; advances the seed in place. Returns 0..1.
  function rnd(c) {
    let s = c._seed | 0; if (s === 0) s = 0x9e3779b9;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    c._seed = s;
    return (s >>> 0) / 4294967296;
  }
  // Pick a fresh wander target inside the bounds but outside the keep-out box.
  function pickTarget(c) {
    for (let k = 0; k < 8; k++) {
      const nx = minX + rnd(c) * spanX, nz = minZ + rnd(c) * spanZ;
      if (!inKeepout(nx, nz)) { c.tx = nx; c.tz = nz; return; }
    }
    c.tx = minX + spanX * 0.5; c.tz = minZ + spanZ * 0.5;
  }

  const creatures = [];
  let idx = 0;
  for (const [kind, n] of SPAWN) {
    const prof = PROFILE[kind];
    for (let k = 0; k < n; k++) {
      const built = KIND[kind].make(k);
      group.add(built.group);

      // Scattered, keep-out-aware initial placement (golden-ratio low-discrepancy).
      let sx = minX + ((idx * 0.618033988749895) % 1) * spanX;
      let sz = minZ + ((idx * 0.754877666246693) % 1) * spanZ;
      if (inKeepout(sx, sz)) sz = KZ1 + 6 + ((idx * 17) % 40); // shove clear of the café
      sz = Math.min(sz, maxZ - 2);
      built.group.position.set(sx, 0, sz);
      const yaw = (idx * 1.371) % TWO_PI;
      built.group.rotation.y = yaw;

      const sw = prof.walk;
      const rec = {
        group: built.group, legs: built.legs, legDir: built.legDir,
        tail: built.tail, neck: built.neck, ears: built.ears,
        x: sx, z: sz, yaw,
        tx: sx, tz: sz,
        speed: prof.speed, turn: prof.turn,
        gait: prof.gait, legAmp: prof.legAmp, bob: prof.bob,
        tailRate: prof.tailRate, tailAmp: prof.tailAmp,
        earAmp: prof.earAmp || 0,
        graze: prof.graze, grazeAng: prof.grazeAng, grazeDur: prof.grazeDur,
        hop: !!prof.hop, wobble: !!prof.wobble,
        arrive: prof.arrive, walkLo: sw[0], walkHi: sw[1],
        phase: (idx % 8) * 0.83,
        state: 0,                         // 0 = walking, 1 = grazing/resting
        timer: sw[0] + (idx % 5),
        neckAng: 0,                       // smoothed neck dip
        _seed: (idx * 1103515245 + 12345) >>> 0 || 1,
      };
      pickTarget(rec);                    // first destination
      creatures.push(rec);
      idx++;
    }
  }

  // ---- UPDATE — allocation-free: only reads numbers + writes transforms -------
  let t = 0;
  function update(dt) {
    if (!dt) dt = 0;
    // Clamp dt so a long stall (tab refocus) can't teleport a creature.
    if (dt > 0.1) dt = 0.1;
    t += dt;

    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];

      const dx = c.tx - c.x, dz = c.tz - c.z;
      const d2 = dx * dx + dz * dz;
      c.timer -= dt;

      let moving;
      if (c.state === 1) {
        // Grazing / resting: hold still until the timer runs out.
        moving = false;
        if (c.timer <= 0) { c.state = 0; pickTarget(c); c.timer = c.walkLo + rnd(c) * (c.walkHi - c.walkLo); }
      } else {
        moving = true;
        const reached = d2 < c.arrive * c.arrive;
        if (reached || c.timer <= 0) {
          if (c.graze && reached) { c.state = 1; c.timer = c.grazeDur * (0.6 + rnd(c) * 0.8); moving = false; }
          else { pickTarget(c); c.timer = c.walkLo + rnd(c) * (c.walkHi - c.walkLo); }
        }
      }

      if (moving) {
        // Steer: rotate yaw toward the target heading, clamped by the turn rate.
        const desired = Math.atan2(dx, dz);  // +Z forward → yaw = atan2(dx, dz)
        let diff = desired - c.yaw;
        while (diff > Math.PI) diff -= TWO_PI;
        while (diff < -Math.PI) diff += TWO_PI;
        const maxTurn = c.turn * dt;
        if (diff > maxTurn) diff = maxTurn; else if (diff < -maxTurn) diff = -maxTurn;
        c.yaw += diff;

        // Advance along the current facing; ease off the throttle while turning hard.
        const throttle = 0.35 + 0.65 * Math.max(0, 1 - Math.abs(diff) / maxTurn || 0);
        const step = c.speed * dt * (isFinite(throttle) ? throttle : 1);
        c.x += Math.sin(c.yaw) * step;
        c.z += Math.cos(c.yaw) * step;

        // Stay inside the rectangle; bounce intent by repicking if we hit an edge.
        if (c.x < minX) { c.x = minX; pickTarget(c); }
        else if (c.x > maxX) { c.x = maxX; pickTarget(c); }
        if (c.z < minZ) { c.z = minZ; pickTarget(c); }
        else if (c.z > maxZ) { c.z = maxZ; pickTarget(c); }
        // If we strayed into the café keep-out, turn around for a new target.
        if (inKeepout(c.x, c.z)) pickTarget(c);

        c.group.position.x = c.x;
        c.group.position.z = c.z;
        c.group.rotation.y = c.yaw;
      }

      // ---- Gait animation (transform writes only) ----------------------------
      const ph = t * c.gait + c.phase;
      const sw = Math.sin(ph);
      const moveF = moving ? 1 : 0;

      // Legs: hoppers swing in phase (all legDir = +1) and tuck; walkers alternate.
      const legS = sw * c.legAmp * moveF;
      for (let k = 0; k < c.legs.length; k++) c.legs[k].rotation.x = legS * c.legDir[k];

      // Body bob: a tall hop for hoppers, a small two-beat bob for walkers.
      let y;
      if (c.hop) y = Math.abs(sw) * c.bob * moveF;
      else y = Math.abs(Math.sin(ph * 0.5)) * c.bob * moveF;
      c.group.position.y = y;

      // Side-to-side waddle roll (ducks only).
      if (c.wobble) c.group.rotation.z = Math.sin(t * c.gait * 0.5 + c.phase) * 0.12 * moveF;

      // Tail sway (still wags a little at rest — dogs especially).
      if (c.tail) c.tail.rotation.y = Math.sin(t * c.tailRate + c.phase) * c.tailAmp * (moving ? 1 : 0.5);

      // Neck: grazers dip toward the grass when stopped; others get a gentle bob.
      if (c.neck) {
        if (c.graze) {
          const want = moving ? 0 : c.grazeAng;
          c.neckAng += (want - c.neckAng) * Math.min(1, dt * 3);
          c.neck.rotation.x = c.neckAng + Math.sin(t * 1.5 + c.phase) * 0.03;
        } else {
          c.neck.rotation.x = Math.sin(t * (moving ? 4 : 1.5) + c.phase) * (moving ? 0.07 : 0.04);
        }
      }

      // Ear / antenna twitch.
      if (c.ears && c.earAmp) {
        for (let k = 0; k < c.ears.length; k++)
          c.ears[k].rotation.z = Math.sin(t * 3 + c.phase + k * 1.7) * c.earAmp;
      }
    }
  }

  return { group, update };
}
