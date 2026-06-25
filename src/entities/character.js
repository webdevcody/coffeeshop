// A stylized low-poly café-goer. Root group sits on the floor (y = 0) facing +Z
// by default. Exposes limb groups so the walk cycle can swing arms and legs, and
// a `head` anchor so labels/chat bubbles can attach above it.
//
// Geometry is built once per character but every mesh shares a small set of
// module-level geometries (created lazily on first use) so spawning dozens of
// avatars stays cheap. Materials are per-character (so each player can recolor
// independently) but limbs reuse the character's own shared mats. update() does
// only scalar math + transform writes — no per-frame allocation.

import * as THREE from "three";
import { SKIN_TONES, HAIR_TONES } from "../config.js";

// World-space height of the underside of the hips when standing (group at y=0).
// Used to drop a seated body so its hips rest on the seating surface.
const HIP_BOTTOM = 0.63;
// Base height of the head anchor (labels/indicators attach here). update() only
// ever offsets this by a tiny breathing amount, so the label height is stable.
const HEAD_Y = 1.58;

function hashPick(arr, seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

// ---------------------------------------------------------------------------
// Shared geometry cache. Every avatar pulls the same geometry instances out of
// here, so the GPU only ever sees one copy of each shape no matter how many
// characters exist. Built lazily the first time a Character is constructed.
// ---------------------------------------------------------------------------
let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const torso = new THREE.CapsuleGeometry(0.21, 0.34, 6, 16);
  // Shape the torso: pinch the waist, broaden the chest, flatten front-to-back a
  // touch so it reads as a body rather than a pill. Cheap one-time vertex edit.
  shapeTorso(torso);

  const hips = new THREE.CylinderGeometry(0.28, 0.22, 0.2, 16);
  // A small rounded chest/shoulder yoke that sits on top of the torso to give
  // the shoulders some mass instead of a flat cylinder top.
  const chest = new THREE.SphereGeometry(0.25, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);

  const neck = new THREE.CylinderGeometry(0.075, 0.09, 0.12, 10);

  // Rounder head: a sphere squashed very slightly and tapered toward the chin.
  const head = new THREE.SphereGeometry(0.24, 20, 18);
  shapeHead(head);

  // Hair: a fuller cap that comes down a bit further at the back/sides.
  const hair = new THREE.SphereGeometry(0.255, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.72);
  const ear = new THREE.SphereGeometry(0.045, 8, 8);
  const eye = new THREE.SphereGeometry(0.026, 10, 8);
  const brow = new THREE.BoxGeometry(0.07, 0.018, 0.02);
  const nose = new THREE.ConeGeometry(0.035, 0.09, 8);

  // Arms: tapered upper arm + forearm + rounded hand, jointed at the elbow.
  const upperArm = new THREE.CapsuleGeometry(0.062, 0.2, 4, 10);
  const foreArm = new THREE.CapsuleGeometry(0.052, 0.2, 4, 10);
  const hand = new THREE.SphereGeometry(0.062, 10, 8);
  const shoulder = new THREE.SphereGeometry(0.075, 10, 8);

  // Legs: thigh + shin jointed at the knee + a shaped shoe.
  const thigh = new THREE.CapsuleGeometry(0.09, 0.22, 4, 10);
  const shin = new THREE.CapsuleGeometry(0.072, 0.24, 4, 10);
  const knee = new THREE.SphereGeometry(0.082, 10, 8);
  const shoe = makeShoe();

  GEO = {
    torso, hips, chest, neck, head, hair, ear, eye, brow, nose,
    upperArm, foreArm, hand, shoulder, thigh, shin, knee, shoe,
  };
  return GEO;
}

// Pinch the waist and broaden the chest of the capsule torso, and flatten it
// front-to-back so it reads as a clothed upper body.
function shapeTorso(geo) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // y runs roughly -0.38 .. 0.38 for this capsule. t: 0 at hips, 1 at chest.
    const t = THREE.MathUtils.clamp((y + 0.38) / 0.76, 0, 1);
    // Waist pinch around the lower-middle, chest swell up top.
    const waist = 0.82 + 0.18 * Math.abs(t - 0.42) * 2;
    const chest = 1 + 0.16 * THREE.MathUtils.smoothstep(t, 0.55, 1);
    const rx = waist * chest;
    const rz = rx * 0.74; // flatter front-to-back
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
    y *= 0.96;
    if (y < 0) {
      const taper = 1 + y * 0.55; // narrows toward the chin
      x *= taper; z *= taper;
    }
    z *= 1.02; // slightly longer face than wide
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
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
    const pants = "#3a4a5a";

    // bodyMat = clothing (torso + arms); skinMat = head/neck/hands; hairMat =
    // hair cap. All three are customizable at runtime (see setAppearance).
    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.72, flatShading: false });
    this.skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62, flatShading: false });
    this.pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.82, flatShading: false });
    this.hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.88, flatShading: false });
    this.shoeMat = new THREE.MeshStandardMaterial({ color: "#23242a", roughness: 0.55, flatShading: false });
    // Eyes/brows share one dark material (not user-customizable).
    this.featureMat = new THREE.MeshStandardMaterial({ color: "#1a1718", roughness: 0.4 });
    const skinMat = this.skinMat;
    const hairMat = this.hairMat;
    const pantsMat = this.pantsMat;

    const m = (geo, mat) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // --- Hips ---------------------------------------------------------------
    const hips = m(G.hips, pantsMat);
    hips.position.y = 0.74;
    this.group.add(hips);

    // --- Torso + chest yoke -------------------------------------------------
    const torso = m(G.torso, this.bodyMat);
    torso.position.y = 1.12;
    torso.scale.set(1, 0.95, 1);
    this.group.add(torso);

    const chest = m(G.chest, this.bodyMat);
    chest.position.y = 1.28;
    chest.scale.set(1.12, 0.85, 0.95);
    this.group.add(chest);

    // --- Neck ---------------------------------------------------------------
    const neck = m(G.neck, skinMat);
    neck.position.y = 1.42;
    this.group.add(neck);

    // --- Head + face (anchor for labels) ------------------------------------
    this.head = new THREE.Group();
    this.head.position.y = HEAD_Y;

    const skull = m(G.head, skinMat);
    this.head.add(skull);

    const hairCap = m(G.hair, hairMat);
    hairCap.position.y = 0.025;
    hairCap.scale.set(1.04, 1.0, 1.06);
    this.head.add(hairCap);

    // Ears.
    for (const ex of [-1, 1]) {
      const ear = m(G.ear, skinMat);
      ear.position.set(ex * 0.235, -0.01, -0.01);
      ear.scale.set(0.6, 1, 0.8);
      this.head.add(ear);
    }

    // Eyes + brows + nose, facing +Z.
    for (const ex of [-0.085, 0.085]) {
      const eyeWhite = m(G.eye, this.featureMat);
      eyeWhite.position.set(ex, 0.015, 0.215);
      eyeWhite.scale.set(1.15, 1, 0.6);
      this.head.add(eyeWhite);
      const brow = m(G.brow, hairMat);
      brow.position.set(ex, 0.075, 0.215);
      brow.rotation.z = (ex < 0 ? 1 : -1) * 0.08;
      this.head.add(brow);
    }
    const nose = m(G.nose, skinMat);
    nose.position.set(0, -0.025, 0.235);
    nose.rotation.x = Math.PI * 0.5;
    nose.scale.set(0.8, 0.6, 0.8);
    this.head.add(nose);

    this.group.add(this.head);

    // --- Legs (pivot at hip → thigh, knee joint → shin + shoe) --------------
    // Each entry in this.legs is the hip pivot whose rotation.x the walk cycle
    // drives; the knee group is bent procedurally in update().
    this.legs = [];
    this.knees = [];
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
      const shoe = m(G.shoe, this.shoeMat);
      shoe.position.set(0, -0.4, 0.06);
      kneeJoint.add(shoe);
      hipPivot.add(kneeJoint);

      this.group.add(hipPivot);
      this.legs.push(hipPivot);
      this.knees.push(kneeJoint);
    }

    // --- Arms (shoulder pivot → upper arm, elbow joint → forearm + hand) ----
    this.arms = [];
    this.elbows = [];
    for (const side of [-1, 1]) {
      const shoulderPivot = new THREE.Group();
      shoulderPivot.position.set(side * 0.31, 1.34, 0);

      const shoulder = m(G.shoulder, this.bodyMat);
      shoulderPivot.add(shoulder);
      const upper = m(G.upperArm, this.bodyMat);
      upper.position.y = -0.16;
      shoulderPivot.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -0.32;
      const fore = m(G.foreArm, skinMat);
      fore.position.y = -0.15;
      elbow.add(fore);
      const hand = m(G.hand, skinMat);
      hand.position.y = -0.3;
      hand.scale.set(1, 0.85, 1.1);
      elbow.add(hand);
      shoulderPivot.add(elbow);

      // Resting splay so arms hang slightly out from the body, and a tiny
      // forward bend at the elbow so they don't read as stiff poles.
      shoulderPivot.rotation.z = side * 0.1;
      elbow.rotation.x = -0.18;

      this.group.add(shoulderPivot);
      this.arms.push(shoulderPivot);
      this.elbows.push(elbow);

      // Right hand gets an anchor a held item can be parented to, so it swings
      // naturally with the arm. Its world position matches the old single-pivot
      // hand location so held items keep reading correctly in the hand.
      if (side === 1) {
        this.handAnchor = new THREE.Group();
        this.handAnchor.position.set(0, -0.34, 0.08);
        elbow.add(this.handAnchor);
      }
    }
  }

  setColor(hex) {
    this.bodyMat.color.set(hex);
  }

  // Live appearance editing. Pass any subset of { color, skin, hair }; only the
  // provided fields change. `color` is the clothing (shirt) color.
  setAppearance(app = {}) {
    if (app.color) this.bodyMat.color.set(app.color);
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

  // dt seconds; moving boolean. Animates a smooth walk cycle (arm+leg swing with
  // knee/elbow bend and a vertical bob) or a calm idle (breathing sway + slow
  // weight shift), easing into a seated pose via `seatBlend`. Pure scalar math
  // and transform writes — no allocation.
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

    // --- Walk cycle ---------------------------------------------------------
    // Legs swing opposite each other; the knee tucks on the back-swing so the
    // foot clears the ground (sin gated to its positive lobe).
    const legSwing = Math.sin(ph) * 0.62 * sw;
    const kneeBendL = Math.max(0, Math.sin(ph + Math.PI * 0.5)) * 0.9 * sw;
    const kneeBendR = Math.max(0, Math.sin(ph - Math.PI * 0.5)) * 0.9 * sw;
    // Arms counter-swing the legs, with the elbow bending on the forward reach.
    const armSwing = Math.sin(ph) * 0.5 * sw;
    const elbowL = (-0.18 - Math.max(0, -Math.sin(ph)) * 0.5) * sw;
    const elbowR = (-0.18 - Math.max(0, Math.sin(ph)) * 0.5) * sw;

    // --- Idle motion (only meaningful when not walking) ---------------------
    // Slow breathing rise and a gentle, occasionally-shifting weight lean.
    const idleBreath = Math.sin(this.idlePhase * 1.6) * 0.5 + 0.5; // 0..1
    // A low-frequency lean target that drifts and sometimes flips sides.
    const leanTarget = Math.sin(this.idlePhase * 0.5) * 0.6 + Math.sin(this.idlePhase * 0.17) * 0.4;
    this.weightShift += (leanTarget - this.weightShift) * Math.min(1, dt * 1.5);
    const idleAmt = (1 - sw) * w; // idle fades out while walking / seated

    // --- Seated pose --------------------------------------------------------
    const legSit = -Math.PI / 2; // thighs forward at the hip
    const kneeSit = Math.PI / 2; // shins drop down from the knee
    const armSit = -0.32;        // hands rest toward the lap
    const elbowSit = -0.6;

    // --- Apply leg transforms ----------------------------------------------
    this.legs[0].rotation.x = legSwing * w + legSit * s;
    this.legs[1].rotation.x = -legSwing * w + legSit * s;
    this.knees[0].rotation.x = kneeBendL * w + kneeSit * s;
    this.knees[1].rotation.x = kneeBendR * w + kneeSit * s;

    // --- Apply arm transforms ----------------------------------------------
    // Idle: arms sway in very gently with breathing.
    const armIdle = (idleBreath - 0.5) * 0.06;
    this.arms[0].rotation.x = (-armSwing + armIdle * idleAmt) * w + armSit * s;
    this.arms[1].rotation.x = (armSwing + armIdle * idleAmt) * w + armSit * s;
    this.elbows[0].rotation.x = elbowL * w + elbowSit * s + (-0.18) * idleAmt;
    this.elbows[1].rotation.x = elbowR * w + elbowSit * s + (-0.18) * idleAmt;

    // --- Body bob, breathing rise, and idle weight lean --------------------
    // Vertical bob peaks twice per stride (abs of sin), plus the seat drop.
    const bob = Math.abs(Math.sin(ph)) * 0.045 * sw;
    this.group.position.y = bob * w + this.sitDrop * s;

    // Idle lateral weight shift: a small roll + matching hip sway.
    const lean = this.weightShift * 0.035 * idleAmt;
    this.group.rotation.z = lean;

    // Head breathing: a tiny rise that's stronger at rest. Base stays at HEAD_Y
    // so attached labels keep their height.
    const breathe = (walking ? Math.abs(Math.sin(ph)) * 0.012 : (idleBreath - 0.5) * 0.02);
    this.head.position.y = HEAD_Y + breathe;
  }

  dispose() {
    // Per-character materials are owned here; shared geometry in GEO is module-
    // level and intentionally left intact for other/future characters.
    this.bodyMat.dispose();
    this.skinMat.dispose();
    this.pantsMat.dispose();
    this.hairMat.dispose();
    this.shoeMat.dispose();
    this.featureMat.dispose();
  }
}
