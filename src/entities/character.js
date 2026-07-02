// A stylized café-goer. Root group sits on the floor (y = 0) facing +Z by
// default. Exposes limb groups so the walk cycle can swing arms and legs, and a
// `head` anchor so labels/chat bubbles can attach above it.
//
// Geometry is built once per character but every mesh shares a small set of
// module-level geometries (created lazily on first use) so spawning dozens of
// avatars stays cheap. Materials are per-character (so each player can recolor
// independently) but limbs reuse the character's own shared mats. The face is a
// single CanvasTexture drawn once at module scope and shared by every avatar.
// update() does only scalar math + transform writes — no per-frame allocation.

import * as THREE from "three";
import { SKIN_TONES, HAIR_TONES } from "../config.js";

// World-space height of the underside of the hips when standing (group at y=0).
// Used to drop a seated body so its hips rest on the seating surface.
const HIP_BOTTOM = 0.63;
// Base height of the head anchor (labels/indicators attach here). update() only
// ever offsets this by a tiny breathing amount, so the label height is stable.
const HEAD_Y = 1.58;
// Pivot height of the internal upper-body group. Torso/chest/arms hang off this
// so the gait can twist and lean the upper body without moving the root group
// (which consumers own) or the head anchor (which labels attach to).
const TORSO_PIVOT_Y = 0.95;

// Trouser + footwear palettes the model picks from deterministically (see the
// per-character style hash). These aren't part of the synced { color, skin, hair }
// appearance — they're derived from it, so every client lands on the same look.
const PANTS_TONES = ["#3a4a5a", "#46382c", "#2e3b32", "#534a4a", "#37415a", "#3d3d42", "#5a4632"];
const SHOE_TONES = ["#23242a", "#3a2a20", "#2a2f3a", "#46413a", "#1d2730"];

function strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function hashPick(arr, seed) {
  return arr[strHash(seed) % arr.length];
}

// ---------------------------------------------------------------------------
// Shared geometry cache. Every avatar pulls the same geometry instances out of
// here, so the GPU only ever sees one copy of each shape no matter how many
// characters exist. Built lazily the first time a Character is constructed.
// ---------------------------------------------------------------------------
let GEO = null;
function geometry() {
  if (GEO) return GEO;

  // --- Body ---------------------------------------------------------------
  const torso = new THREE.CapsuleGeometry(0.21, 0.34, 8, 20);
  // Shape the torso: pinch the waist, broaden the chest/shoulders, flatten it
  // front-to-back a touch so it reads as a clothed body rather than a pill.
  shapeTorso(torso);
  const hips = new THREE.CylinderGeometry(0.27, 0.215, 0.2, 18);
  // A rounded chest/shoulder yoke sitting on top of the torso so the shoulders
  // carry some mass instead of a flat cylinder top.
  const chest = new THREE.SphereGeometry(0.25, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const neck = new THREE.CylinderGeometry(0.072, 0.09, 0.13, 12);

  // --- Head + face --------------------------------------------------------
  // Rounder, smoother head: a high-segment sphere squashed a hair and tapered
  // toward the chin so it's egg-shaped rather than a perfect ball.
  const head = new THREE.SphereGeometry(0.24, 28, 22);
  shapeHead(head);
  const ear = new THREE.SphereGeometry(0.045, 10, 8);
  const brow = new THREE.BoxGeometry(0.072, 0.02, 0.024);
  const nose = new THREE.ConeGeometry(0.03, 0.075, 10);
  // The face (eyes / cheeks / smile) is a curved decal that hugs the front of
  // the skull — see makeFaceGeo(); the drawing lives in faceAssets().
  const face = makeFaceGeo();

  // --- Hair pieces (all tinted by the one hairMat) ------------------------
  // A fuller cap that comes down further at the back/sides; plus optional extras
  // (puff, bun, tail, spikes, drape) layered on for the different styles.
  const hair = new THREE.SphereGeometry(0.255, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.72);
  const hairPuff = new THREE.SphereGeometry(0.285, 20, 16);
  const hairBun = new THREE.SphereGeometry(0.1, 14, 12);
  const hairTail = new THREE.CapsuleGeometry(0.055, 0.18, 5, 12);
  const hairSpike = new THREE.ConeGeometry(0.05, 0.16, 8);
  const hairLong = makeHairLong();
  // A soft fringe/bangs slab that sits at the hairline so short styles don't
  // read as a bare forehead.
  const hairFringe = makeHairFringe();

  // --- Arms: tapered upper arm (sleeve) + skin forearm + rounded hand ------
  const upperArm = new THREE.CapsuleGeometry(0.064, 0.2, 5, 12);
  const foreArm = new THREE.CapsuleGeometry(0.052, 0.2, 5, 12);
  const hand = new THREE.SphereGeometry(0.062, 12, 10);
  const thumb = new THREE.SphereGeometry(0.03, 8, 8);
  const shoulder = new THREE.SphereGeometry(0.078, 12, 10);
  const cuff = new THREE.CylinderGeometry(0.066, 0.072, 0.05, 14, 1, true); // short-sleeve hem

  // --- Legs: thigh + shin jointed at the knee + a shaped shoe + a sole -----
  const thigh = new THREE.CapsuleGeometry(0.092, 0.22, 5, 12);
  const shin = new THREE.CapsuleGeometry(0.072, 0.24, 5, 12);
  const knee = new THREE.SphereGeometry(0.084, 12, 10);
  const shoe = makeShoe();
  const sole = new THREE.BoxGeometry(0.138, 0.04, 0.31);

  // --- Clothing accents (collar / lapels / chest stripe) ------------------
  const collar = new THREE.TorusGeometry(0.12, 0.03, 8, 20);
  const lapel = new THREE.BoxGeometry(0.05, 0.2, 0.025);
  const stripe = new THREE.CylinderGeometry(0.238, 0.238, 0.085, 22, 1, true);

  GEO = {
    torso, hips, chest, neck,
    head, ear, brow, nose, face,
    hair, hairPuff, hairBun, hairTail, hairSpike, hairLong, hairFringe,
    upperArm, foreArm, hand, thumb, shoulder, cuff,
    thigh, shin, knee, shoe, sole,
    collar, lapel, stripe,
  };
  return GEO;
}

// Pinch the waist and broaden the chest/shoulders of the capsule torso, and
// flatten it front-to-back so it reads as a clothed upper body.
function shapeTorso(geo) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // y runs roughly -0.38 .. 0.38 for this capsule. t: 0 at hips, 1 at chest.
    const t = THREE.MathUtils.clamp((y + 0.38) / 0.76, 0, 1);
    // Waist pinch around the lower-middle, chest + shoulder swell up top.
    const waist = 0.8 + 0.2 * Math.abs(t - 0.4) * 2;
    const chest = 1 + 0.2 * THREE.MathUtils.smoothstep(t, 0.55, 1);
    const rx = waist * chest;
    const rz = rx * 0.72; // flatter front-to-back
    p.setX(i, p.getX(i) * rx);
    p.setZ(i, p.getZ(i) * rz);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
}

// Squash the head a hair vertically and taper the lower half toward a chin so
// it's egg-shaped rather than a perfect ball.
function shapeHead(geo) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    y *= 0.97;
    if (y < 0) {
      const taper = 1 + y * 0.5; // narrows toward the chin
      x *= taper; z *= taper;
    }
    z *= 1.03; // slightly longer face than wide
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
}

// A curved decal plane that wraps the front of the skull, so the drawn face
// (eyes/cheeks/smile) follows the head's curvature instead of floating on a
// flat card. UVs stay 0..1 for the CanvasTexture.
function makeFaceGeo() {
  const geo = new THREE.PlaneGeometry(0.34, 0.36, 10, 10);
  const p = geo.attributes.position;
  const R = 0.235; // ~skull radius; wrap x around it, dome z forward
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const ax = x / R;             // horizontal wrap angle
    const nx = R * Math.sin(ax);
    // Recede toward the sides (cos ax) and gently toward top/bottom so the
    // decal sits flush on the cheeks and brow rather than poking out.
    const nz = R * Math.cos(ax) * (1 - 0.18 * (y / 0.18) * (y / 0.18));
    p.setXYZ(i, nx, y, nz);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Long hair: a sphere whose front is pushed back (buried inside the skull, so it
// stays hidden) leaving a fuller mass that drapes around the back and sides.
function makeHairLong() {
  const geo = new THREE.SphereGeometry(0.26, 20, 16);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    if (z > 0.05) p.setZ(i, 0.05);             // clip the face side flat → hidden
    if (y > 0.12) p.setY(i, 0.12 + (y - 0.12) * 0.4); // flatten the crown so the cap shows
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// A soft bangs slab: a shallow curved wedge that sits low across the forehead so
// short styles get a hairline instead of a bare brow.
function makeHairFringe() {
  const geo = new THREE.BoxGeometry(0.4, 0.11, 0.12, 8, 2, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    // Curve the slab around the brow (front is +z) and dip the centre a touch
    // for a gentle middle-part fringe.
    p.setZ(i, p.getZ(i) + (0.2 - x * x * 3.4));
    if (y < 0) p.setY(i, y - Math.abs(x) * 0.12); // longer at the temples
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// A simple stylized shoe: a rounded box with a slightly raised, longer toe.
function makeShoe() {
  const geo = new THREE.BoxGeometry(0.13, 0.1, 0.28, 2, 1, 3);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    // Round the toe up and in (toe is +z), keep the heel boxier.
    if (z > 0.05) {
      if (y > 0) p.setY(i, y - (z - 0.05) * 0.45); // bevel top of toe down
      p.setZ(i, z + 0.02);
    }
    if (y < 0) p.setY(i, y * 0.7); // thin sole
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Shared face decal (CanvasTexture + material). Drawn once, reused by every
// avatar — the face isn't tinted per-player, so a single material is fine. Lives
// alongside GEO at module scope and is intentionally never disposed. Returns
// null in a DOM-less environment (Character is client-only, but stay safe).
// ---------------------------------------------------------------------------
let FACE = null;
function faceAssets() {
  if (FACE !== null) return FACE;
  if (typeof document === "undefined") { FACE = { mat: null }; return FACE; }

  const S = 256;
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = S;
  const c = cvs.getContext("2d");
  const cx = S / 2;

  // Rosy cheeks first (behind the eyes), soft and low-opacity.
  for (const dx of [-60, 60]) {
    const g = c.createRadialGradient(cx + dx, 170, 2, cx + dx, 170, 30);
    g.addColorStop(0, "rgba(233,120,110,0.35)");
    g.addColorStop(1, "rgba(233,120,110,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx + dx, 170, 30, 0, Math.PI * 2);
    c.fill();
  }

  // Eyes: white sclera, warm iris, dark pupil, and a bright catchlight so they
  // read as friendly and alive rather than dead dots.
  for (const ex of [-46, 46]) {
    const x = cx + ex, y = 104;
    // Sclera.
    c.fillStyle = "#fdfdfd";
    c.beginPath();
    c.ellipse(x, y, 17, 21, 0, 0, Math.PI * 2);
    c.fill();
    // Iris + pupil.
    c.fillStyle = "#4a3327";
    c.beginPath();
    c.arc(x, y + 3, 11, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#191315";
    c.beginPath();
    c.arc(x, y + 3, 6.5, 0, Math.PI * 2);
    c.fill();
    // Catchlight.
    c.fillStyle = "rgba(255,255,255,0.95)";
    c.beginPath();
    c.arc(x - 4, y - 3, 3.4, 0, Math.PI * 2);
    c.fill();
    // Upper lid line for a bit of definition.
    c.strokeStyle = "rgba(40,30,32,0.5)";
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(x, y - 2, 17, 20, 0, Math.PI * 1.05, Math.PI * 1.95);
    c.stroke();
  }

  // A warm, gently upturned smile.
  c.strokeStyle = "#7a3330";
  c.lineWidth = 6;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(cx - 30, 168);
  c.quadraticCurveTo(cx, 192, cx + 30, 168);
  c.stroke();

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  // transparent + a low alphaTest cuts the empty margin (so brows/nose behind
  // the decal show through) while keeping antialiased edges and the soft cheeks.
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.02,
    roughness: 0.6,
    metalness: 0,
  });
  FACE = { mat };
  return FACE;
}

export class Character {
  // `appearance` is { color, skin, hair }; any omitted field falls back to a
  // deterministic default derived from `seed` (so un-customized players still
  // look distinct). A bare color string is accepted for backward compatibility.
  constructor(appearance = {}, seed = "x") {
    if (typeof appearance === "string") appearance = { color: appearance };
    this.group = new THREE.Group();
    this.phase = Math.random() * Math.PI * 2;
    this.swing = 0;
    // Slow, independent clock for idle motion so a crowd doesn't breathe in sync.
    this.idlePhase = Math.random() * Math.PI * 2;
    this.weightShift = 0; // smoothed lateral idle lean

    // Seated state: `seated` is the target, `seatBlend` eases the pose in/out so
    // sitting down and standing up are smooth. `sitDrop` lowers (or raises) the
    // body so the hips rest on the seating surface.
    this.seated = false;
    this.seatBlend = 0;
    this.sitDrop = 0;

    const G = geometry();

    const color = appearance.color || "#e76f51";
    const skin = appearance.skin || hashPick(SKIN_TONES, seed + "s");
    const hair = appearance.hair || hashPick(HAIR_TONES, seed + "h");

    // Per-character style choices (hairstyle, outfit accent, trouser + shoe
    // tones) are hashed from the RESOLVED appearance — never the raw seed — so a
    // player looks identical to themselves and to everyone else (remotes are
    // rebuilt from the same { color, skin, hair } that gets synced over the wire).
    const sh = strHash(color + skin + hair);
    const hairStyle = sh % 8;
    const outfit = (sh >>> 3) % 4;
    const pants = PANTS_TONES[(sh >>> 6) % PANTS_TONES.length];
    const shoeCol = SHOE_TONES[(sh >>> 9) % SHOE_TONES.length];

    // bodyMat = clothing (torso + sleeves); skinMat = head/neck/forearms/hands;
    // hairMat = all hair; accentMat = a coordinated darker trim (collar/lapels/
    // stripe). color/skin/hair are customizable at runtime (see setAppearance).
    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.72, flatShading: false });
    this.skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62, flatShading: false });
    this.pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.82, flatShading: false });
    this.hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.86, flatShading: false });
    this.shoeMat = new THREE.MeshStandardMaterial({ color: shoeCol, roughness: 0.55, flatShading: false });
    this.soleMat = new THREE.MeshStandardMaterial({ color: "#e9e9ee", roughness: 0.6, flatShading: false });
    // Accent trim — a darker shade of the shirt, kept in sync on every recolor.
    this.accentMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: false });
    this._syncAccent();

    const skinMat = this.skinMat;
    const hairMat = this.hairMat;
    const pantsMat = this.pantsMat;

    const m = (geo, mat) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // --- Hips (root/lower body) --------------------------------------------
    const hipsMesh = m(G.hips, pantsMat);
    hipsMesh.position.y = 0.74;
    this.group.add(hipsMesh);

    // --- Upper-body pivot: torso, chest, neck, arms + outfit hang off this so
    // the gait can twist and lean the torso without disturbing the root group
    // (owned by consumers) or the head anchor (labels attach there).
    this.torsoTwist = new THREE.Group();
    this.torsoTwist.position.y = TORSO_PIVOT_Y;
    this.group.add(this.torsoTwist);
    const py = (worldY) => worldY - TORSO_PIVOT_Y;

    // --- Torso + chest yoke -------------------------------------------------
    const torso = m(G.torso, this.bodyMat);
    torso.position.y = py(1.12);
    torso.scale.set(1, 0.95, 1);
    this.torsoTwist.add(torso);

    this.chest = m(G.chest, this.bodyMat);
    this.chest.position.y = py(1.28);
    this._chestS = { x: 1.14, y: 0.85, z: 0.95 };
    this.chest.scale.set(this._chestS.x, this._chestS.y, this._chestS.z);
    this.torsoTwist.add(this.chest);

    // --- Clothing accents (collar / jacket lapels / chest stripe) -----------
    this._buildOutfit(outfit, G, m, py);

    // --- Neck ---------------------------------------------------------------
    const neck = m(G.neck, skinMat);
    neck.position.y = py(1.42);
    this.torsoTwist.add(neck);

    // --- Head + face (anchor for labels) ------------------------------------
    this.head = new THREE.Group();
    this.head.position.y = HEAD_Y;

    const skull = m(G.head, skinMat);
    this.head.add(skull);

    // Ears.
    for (const ex of [-1, 1]) {
      const ear = m(G.ear, skinMat);
      ear.position.set(ex * 0.235, -0.01, -0.01);
      ear.scale.set(0.6, 1, 0.8);
      this.head.add(ear);
    }

    // Face decal (eyes/cheeks/smile) sitting just proud of the skull front.
    const fa = faceAssets();
    if (fa.mat) {
      const faceMesh = new THREE.Mesh(G.face, fa.mat);
      faceMesh.position.set(0, -0.005, 0.017);
      faceMesh.castShadow = false;
      faceMesh.receiveShadow = false;
      this.head.add(faceMesh);
    }

    // Eyebrows stay geometry so they recolor with the hair; nose stays skin.
    for (const ex of [-0.078, 0.078]) {
      const brow = m(G.brow, hairMat);
      brow.position.set(ex, 0.088, 0.216);
      brow.rotation.z = (ex < 0 ? 1 : -1) * 0.1;
      this.head.add(brow);
    }
    const nose = m(G.nose, skinMat);
    nose.position.set(0, -0.01, 0.232);
    nose.rotation.x = Math.PI * 0.5;
    nose.scale.set(0.8, 0.55, 0.8);
    this.head.add(nose);

    // --- Hair (style chosen by the per-character hash) ----------------------
    this._buildHair(hairStyle, G, m);

    this.group.add(this.head);

    // --- Legs (pivot at hip → thigh, knee joint → shin, ankle → shoe+sole) --
    // this.legs = hip pivots (walk swing), this.knees = knee joints (bend),
    // this.ankles = foot joints (heel-strike / toe-off roll).
    this.legs = [];
    this.knees = [];
    this.ankles = [];
    for (const side of [-1, 1]) {
      const hipPivot = new THREE.Group();
      hipPivot.position.set(side * 0.13, 0.7, 0);

      const thigh = m(G.thigh, pantsMat);
      thigh.position.y = -0.18;
      hipPivot.add(thigh);

      const kneeJoint = new THREE.Group();
      kneeJoint.position.y = -0.36;
      const knee = m(G.knee, pantsMat);
      knee.scale.set(1, 0.8, 1);
      kneeJoint.add(knee);
      const shin = m(G.shin, pantsMat);
      shin.position.y = -0.2;
      kneeJoint.add(shin);

      // Ankle joint carries the shoe + sole so the foot can roll heel-to-toe.
      const ankle = new THREE.Group();
      ankle.position.y = -0.4;
      const shoe = m(G.shoe, this.shoeMat);
      shoe.position.set(0, 0, 0.06);
      ankle.add(shoe);
      const sole = m(G.sole, this.soleMat);
      sole.position.set(0, -0.048, 0.07);
      ankle.add(sole);
      kneeJoint.add(ankle);
      hipPivot.add(kneeJoint);

      this.group.add(hipPivot);
      this.legs.push(hipPivot);
      this.knees.push(kneeJoint);
      this.ankles.push(ankle);
    }

    // --- Arms (shoulder pivot → upper arm, elbow joint → forearm + hand) ----
    // Parented under the torso pivot so they twist with the upper body.
    this.arms = [];
    this.elbows = [];
    for (const side of [-1, 1]) {
      const shoulderPivot = new THREE.Group();
      shoulderPivot.position.set(side * 0.31, py(1.34), 0);

      const shoulder = m(G.shoulder, this.bodyMat);
      shoulderPivot.add(shoulder);
      const upper = m(G.upperArm, this.bodyMat);
      upper.position.y = -0.16;
      shoulderPivot.add(upper);
      // Short-sleeve hem where the clothing ends and bare forearm begins.
      const hem = m(G.cuff, this.bodyMat);
      hem.position.y = -0.3;
      shoulderPivot.add(hem);

      const elbow = new THREE.Group();
      elbow.position.y = -0.32;
      const fore = m(G.foreArm, skinMat);
      fore.position.y = -0.15;
      elbow.add(fore);
      const hand = m(G.hand, skinMat);
      hand.position.y = -0.3;
      hand.scale.set(1, 0.85, 1.1);
      elbow.add(hand);
      // A little thumb on the inner side so the hand reads as a hand.
      const thumb = m(G.thumb, skinMat);
      thumb.position.set(-side * 0.045, -0.27, 0.05);
      elbow.add(thumb);
      shoulderPivot.add(elbow);

      // Resting splay so arms hang slightly out from the body, and a tiny
      // forward bend at the elbow so they don't read as stiff poles.
      shoulderPivot.rotation.z = side * 0.1;
      elbow.rotation.x = -0.18;

      this.torsoTwist.add(shoulderPivot);
      this.arms.push(shoulderPivot);
      this.elbows.push(elbow);

      // Right hand gets an anchor a held item can be parented to, so it swings
      // naturally with the arm. Its local offset matches the old single-pivot
      // hand location so held items keep reading correctly in the hand.
      if (side === 1) {
        this.handAnchor = new THREE.Group();
        this.handAnchor.position.set(0, -0.34, 0.08);
        elbow.add(this.handAnchor);
      }
    }
  }

  // Layer the hair pieces for the chosen style onto the head. Everything uses
  // the single hairMat so recoloring hair tints the whole 'do at once.
  _buildHair(style, G, m) {
    const cap = (sx, sy, sz, oy) => {
      const c = m(G.hair, this.hairMat);
      c.position.y = oy;
      c.scale.set(sx, sy, sz);
      this.head.add(c);
      return c;
    };
    // A soft fringe across the brow — added to most styles so there's a real
    // hairline (skipped for buzz/afro/bald which manage their own front).
    const fringe = () => {
      const f = m(G.hairFringe, this.hairMat);
      f.position.set(0, 0.11, 0.13);
      f.scale.set(0.62, 1, 0.62);
      this.head.add(f);
    };
    switch (style) {
      case 0: // tidy short crop
        cap(1.06, 1.02, 1.08, 0.03);
        fringe();
        break;
      case 1: // buzz — hugs the skull
        cap(1.02, 0.94, 1.03, 0.0);
        break;
      case 2: { // spiky
        cap(1.05, 1.0, 1.06, 0.02);
        // [x, y, z, rotX, rotZ] per spike.
        const spikes = [
          [0, 0.2, 0.02, 0, 0],
          [0.13, 0.15, 0.03, 0, 0.55],
          [-0.13, 0.15, 0.03, 0, -0.55],
          [0.08, 0.16, -0.13, 0.55, 0.3],
          [-0.08, 0.16, -0.13, 0.55, -0.3],
          [0, 0.17, 0.15, -0.5, 0],
        ];
        for (const [x, y, z, rx, rz] of spikes) {
          const sp = m(G.hairSpike, this.hairMat);
          sp.position.set(x, y, z);
          sp.rotation.set(rx, 0, rz);
          this.head.add(sp);
        }
        break;
      }
      case 3: { // afro / curly puff (no cap)
        const puff = m(G.hairPuff, this.hairMat);
        puff.position.set(0, 0.05, -0.01);
        puff.scale.set(1.05, 1.02, 1.05);
        this.head.add(puff);
        break;
      }
      case 4: { // ponytail
        cap(1.05, 1.0, 1.07, 0.02);
        fringe();
        const tail = m(G.hairTail, this.hairMat);
        tail.position.set(0, 0.0, -0.26);
        tail.rotation.x = 0.6;
        tail.scale.set(1, 1.15, 1);
        this.head.add(tail);
        break;
      }
      case 5: { // top bun
        cap(1.05, 1.0, 1.07, 0.02);
        fringe();
        const bun = m(G.hairBun, this.hairMat);
        bun.position.set(0, 0.18, -0.14);
        bun.scale.set(1.1, 0.95, 1.1);
        this.head.add(bun);
        break;
      }
      case 6: { // long, draping the back + sides
        cap(1.05, 1.0, 1.07, 0.02);
        fringe();
        const drape = m(G.hairLong, this.hairMat);
        drape.position.set(0, -0.05, -0.02);
        drape.scale.set(1.06, 1.3, 1.1);
        this.head.add(drape);
        break;
      }
      case 7: // bald (brows still show — they live on the face)
      default:
        break;
    }
  }

  // Optional clothing accent for the torso, in the coordinated accentMat trim.
  // Parented under the torso pivot so it twists/leans with the body. `py` maps a
  // world-space Y to the torso pivot's local space.
  _buildOutfit(outfit, G, m, py) {
    const parent = this.torsoTwist;
    if (outfit === 1 || outfit === 2) {
      // Collar ring for polo (1) and jacket (2).
      const collar = m(G.collar, this.accentMat);
      collar.position.y = py(1.4);
      collar.rotation.x = Math.PI / 2;
      collar.scale.set(1.04, 1, 0.82);
      parent.add(collar);
    }
    if (outfit === 2) {
      // Jacket lapels — a shallow V down the chest front.
      for (const side of [-1, 1]) {
        const lapel = m(G.lapel, this.accentMat);
        lapel.position.set(side * 0.06, py(1.2), 0.135);
        lapel.rotation.z = side * 0.32;
        parent.add(lapel);
      }
    } else if (outfit === 3) {
      // Contrast chest stripe wrapping the shirt.
      const stripe = m(G.stripe, this.accentMat);
      stripe.position.y = py(1.13);
      stripe.scale.set(1, 1, 0.76);
      parent.add(stripe);
    }
    // outfit === 0 → plain tee, no accent mesh.
  }

  // Accent trim tracks the shirt: a darker shade of the current body color.
  _syncAccent() {
    this.accentMat.color.copy(this.bodyMat.color).multiplyScalar(0.6);
  }

  setColor(hex) {
    this.bodyMat.color.set(hex);
    this._syncAccent();
  }

  // Live appearance editing. Pass any subset of { color, skin, hair }; only the
  // provided fields change. `color` is the clothing (shirt) color.
  setAppearance(app = {}) {
    if (app.color) {
      this.bodyMat.color.set(app.color);
      this._syncAccent();
    }
    if (app.skin) this.skinMat.color.set(app.skin);
    if (app.hair) this.hairMat.color.set(app.hair);
  }

  getAppearance() {
    return {
      color: "#" + this.bodyMat.color.getHexString(),
      skin: "#" + this.skinMat.color.getHexString(),
      hair: "#" + this.hairMat.color.getHexString(),
    };
  }

  // Sit on / get up from a seat. `seatTopY` is the world-space height of the
  // seating surface; the body drops so the hips rest there.
  setSeated(on, seatTopY = 0) {
    this.seated = on;
    // Only recompute the drop when we have a real seat height. A missing/zero
    // (or otherwise non-finite/non-positive) seatTopY would otherwise yield a
    // negative sitDrop that sinks the seated body ~0.63 m through the floor, so
    // keep the previous drop in that case instead of trusting a bad value.
    if (on && Number.isFinite(seatTopY) && seatTopY > 0) {
      this.sitDrop = seatTopY - HIP_BOTTOM;
    }
  }

  // dt seconds; moving boolean. Animates a smooth walk cycle (opposing arm/leg
  // swing with knee/elbow bend, foot roll, a torso counter-twist + forward lean,
  // and a vertical bob) or a calm idle (breathing + slow weight shift), easing
  // into a seated pose via `seatBlend`. Pure scalar math + transform writes — no
  // allocation. On the ROOT group it only ever writes position.y and rotation.z,
  // exactly as before, so the tumble/ride code that stacks on top still works.
  update(dt, moving) {
    const s = (this.seatBlend += ((this.seated ? 1 : 0) - this.seatBlend) * Math.min(1, dt * 10));
    const walking = moving && !this.seated;
    const w = 1 - s; // how "not seated" we are

    // Ease the overall walk amount so starts/stops are smooth.
    const target = walking ? 1 : 0;
    this.swing += (target - this.swing) * Math.min(1, dt * 8);
    const sw = this.swing;

    // Advance phases. The walk phase only ticks while walking; the idle phase
    // always ticks (slowly) so breathing/weight-shift continue when standing.
    if (walking) this.phase += dt * 8.5;
    this.idlePhase += dt;
    const ph = this.phase;
    const sinP = Math.sin(ph);

    // --- Walk cycle ---------------------------------------------------------
    // Legs swing opposite each other; the knee tucks on the back-swing so the
    // foot clears the ground (sin gated to its positive lobe).
    const legSwing = sinP * 0.62 * sw;
    const kneeBendL = Math.max(0, Math.sin(ph - Math.PI * 0.5)) * 0.95 * sw;
    const kneeBendR = Math.max(0, Math.sin(ph + Math.PI * 0.5)) * 0.95 * sw;
    // Arms counter-swing the legs, with the elbow bending on the forward reach.
    const armSwing = sinP * 0.5 * sw;
    const elbowL = (-0.2 - Math.max(0, sinP) * 0.55) * sw;
    const elbowR = (-0.2 - Math.max(0, -sinP) * 0.55) * sw;

    // --- Idle motion (only meaningful when not walking) ---------------------
    // Slow breathing rise and a gentle, occasionally-shifting weight lean.
    const idleBreath = Math.sin(this.idlePhase * 1.6) * 0.5 + 0.5; // 0..1
    // A low-frequency lean target that drifts and sometimes flips sides.
    const leanTarget = Math.sin(this.idlePhase * 0.5) * 0.6 + Math.sin(this.idlePhase * 0.17) * 0.4;
    this.weightShift += (leanTarget - this.weightShift) * Math.min(1, dt * 1.5);
    const idleAmt = (1 - sw) * w; // idle fades out while walking / seated
    // Combined breath signal: stride-locked while walking, slow while idle.
    const breath = walking ? Math.abs(sinP) : idleBreath;

    // --- Seated pose --------------------------------------------------------
    const legSit = -Math.PI / 2; // thighs forward at the hip
    const kneeSit = Math.PI / 2; // shins drop down from the knee
    const armSit = -0.32;        // hands rest toward the lap
    const elbowSit = -0.6;

    // --- Apply leg + foot transforms ---------------------------------------
    this.legs[0].rotation.x = legSwing * w + legSit * s;
    this.legs[1].rotation.x = -legSwing * w + legSit * s;
    this.knees[0].rotation.x = kneeBendL * w + kneeSit * s;
    this.knees[1].rotation.x = kneeBendR * w + kneeSit * s;
    // Foot roll: level the sole as the knee tucks, then flick the toe on push-off
    // (the opposite phase to that leg's knee bend). Fades to flat when seated.
    this.ankles[0].rotation.x = (-kneeBendL * 0.5 + Math.max(0, -sinP) * 0.3 * sw) * w;
    this.ankles[1].rotation.x = (-kneeBendR * 0.5 + Math.max(0, sinP) * 0.3 * sw) * w;

    // --- Apply arm transforms ----------------------------------------------
    // Idle: arms sway in very gently with breathing.
    const armIdle = (idleBreath - 0.5) * 0.06;
    this.arms[0].rotation.x = (-armSwing + armIdle * idleAmt) * w + armSit * s;
    this.arms[1].rotation.x = (armSwing + armIdle * idleAmt) * w + armSit * s;
    this.elbows[0].rotation.x = elbowL * w + elbowSit * s + (-0.2) * idleAmt;
    this.elbows[1].rotation.x = elbowR * w + elbowSit * s + (-0.2) * idleAmt;

    // --- Upper-body pivot: gait twist, forward lean, breathing -------------
    // Shoulders counter-rotate the stride; a slight forward lean sells momentum;
    // a tiny breathing sway keeps the idle alive. All on the internal pivot, so
    // the root group + head anchor stay untouched.
    this.torsoTwist.rotation.y = -armSwing * 0.32 * w;
    this.torsoTwist.rotation.x = Math.abs(sinP) * 0.05 * sw * w + (breath - 0.5) * 0.02 * idleAmt;
    this.torsoTwist.rotation.z = (idleBreath - 0.5) * 0.02 * idleAmt;

    // Chest breathing — scalar scale writes, no allocation. Gentler while walking.
    const bAmt = breath * (walking ? 0.5 : 1);
    this.chest.scale.set(
      this._chestS.x * (1 + bAmt * 0.02),
      this._chestS.y,
      this._chestS.z * (1 + bAmt * 0.03),
    );

    // --- Body bob + seat drop (SAME contract as before: assign group.position.y)
    const bob = Math.abs(sinP) * 0.05 * sw;
    this.group.position.y = bob * w + this.sitDrop * s;

    // Idle lateral weight lean on the ROOT rotation.z (unchanged contract).
    this.group.rotation.z = this.weightShift * 0.035 * idleAmt;

    // Head breathing: a tiny rise that's stronger at rest. Base stays at HEAD_Y
    // so attached labels keep their height.
    const breathe = (walking ? Math.abs(sinP) * 0.012 : (idleBreath - 0.5) * 0.02);
    this.head.position.y = HEAD_Y + breathe;
  }

  dispose() {
    // Per-character materials are owned here; shared geometry in GEO and the
    // shared face texture/material are module-level and intentionally left
    // intact for other/future characters.
    this.bodyMat.dispose();
    this.skinMat.dispose();
    this.pantsMat.dispose();
    this.hairMat.dispose();
    this.shoeMat.dispose();
    this.soleMat.dispose();
    this.accentMat.dispose();
  }
}
