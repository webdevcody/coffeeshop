// A stylized café-goer. Root group sits on the floor (y = 0) facing +Z by
// default. Exposes limb groups so the walk cycle can swing arms and legs, and a
// `head` anchor so labels/chat bubbles can attach above it.
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
  const eyeWhite = new THREE.SphereGeometry(0.034, 14, 10);
  const pupil = new THREE.SphereGeometry(0.018, 10, 8);
  const brow = new THREE.BoxGeometry(0.075, 0.018, 0.022);
  const nose = new THREE.ConeGeometry(0.034, 0.085, 10);
  // A friendly smile — a partial torus arc, rotated so it curves up at the ends.
  const mouth = new THREE.TorusGeometry(0.05, 0.013, 8, 20, Math.PI * 0.72);

  // --- Hair pieces (all tinted by the one hairMat) ------------------------
  // A fuller cap that comes down further at the back/sides; plus optional extras
  // (puff, bun, tail, spikes, drape) layered on for the different styles.
  const hair = new THREE.SphereGeometry(0.255, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.72);
  const hairPuff = new THREE.SphereGeometry(0.285, 20, 16);
  const hairBun = new THREE.SphereGeometry(0.1, 14, 12);
  const hairTail = new THREE.CapsuleGeometry(0.055, 0.18, 5, 12);
  const hairSpike = new THREE.ConeGeometry(0.05, 0.16, 8);
  const hairLong = makeHairLong();

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
    head, ear, eyeWhite, pupil, brow, nose, mouth,
    hair, hairPuff, hairBun, hairTail, hairSpike, hairLong,
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
    // White sclera; dark shared material for pupils + the smile line.
    this.eyeMat = new THREE.MeshStandardMaterial({ color: "#fbfbfb", roughness: 0.25 });
    this.featureMat = new THREE.MeshStandardMaterial({ color: "#1a1718", roughness: 0.4 });
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

    // --- Hips ---------------------------------------------------------------
    const hipsMesh = m(G.hips, pantsMat);
    hipsMesh.position.y = 0.74;
    this.group.add(hipsMesh);

    // --- Torso + chest yoke -------------------------------------------------
    const torso = m(G.torso, this.bodyMat);
    torso.position.y = 1.12;
    torso.scale.set(1, 0.95, 1);
    this.group.add(torso);

    const chest = m(G.chest, this.bodyMat);
    chest.position.y = 1.28;
    chest.scale.set(1.14, 0.85, 0.95);
    this.group.add(chest);

    // --- Clothing accents (collar / jacket lapels / chest stripe) -----------
    this._buildOutfit(outfit, G, m);

    // --- Neck ---------------------------------------------------------------
    const neck = m(G.neck, skinMat);
    neck.position.y = 1.42;
    this.group.add(neck);

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

    // Eyes (white sclera + dark pupil), brows + nose + smile, all facing +Z.
    for (const ex of [-0.085, 0.085]) {
      const eyeWhite = m(G.eyeWhite, this.eyeMat);
      eyeWhite.position.set(ex, 0.02, 0.202);
      eyeWhite.scale.set(1, 1.2, 0.5);
      this.head.add(eyeWhite);

      const pupil = m(G.pupil, this.featureMat);
      pupil.position.set(ex, 0.012, 0.224);
      pupil.scale.set(1, 1.1, 0.7);
      this.head.add(pupil);

      const brow = m(G.brow, hairMat);
      brow.position.set(ex, 0.085, 0.214);
      brow.rotation.z = (ex < 0 ? 1 : -1) * 0.08;
      this.head.add(brow);
    }
    const nose = m(G.nose, skinMat);
    nose.position.set(0, -0.02, 0.228);
    nose.rotation.x = Math.PI * 0.5;
    nose.scale.set(0.75, 0.55, 0.75);
    this.head.add(nose);

    const mouth = m(G.mouth, this.featureMat);
    mouth.position.set(0, -0.05, 0.214);
    mouth.rotation.z = Math.PI * 1.14; // swing the arc to the bottom → a smile
    this.head.add(mouth);

    // --- Hair (style chosen by the per-character hash) ----------------------
    this._buildHair(hairStyle, G, m);

    this.group.add(this.head);

    // --- Legs (pivot at hip → thigh, knee joint → shin + shoe + sole) -------
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
      const sole = m(G.sole, this.soleMat);
      sole.position.set(0, -0.448, 0.07);
      kneeJoint.add(sole);
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
    switch (style) {
      case 0: // tidy short crop
        cap(1.06, 1.02, 1.08, 0.03);
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
        const tail = m(G.hairTail, this.hairMat);
        tail.position.set(0, 0.0, -0.26);
        tail.rotation.x = 0.6;
        tail.scale.set(1, 1.15, 1);
        this.head.add(tail);
        break;
      }
      case 5: { // top bun
        cap(1.05, 1.0, 1.07, 0.02);
        const bun = m(G.hairBun, this.hairMat);
        bun.position.set(0, 0.18, -0.14);
        bun.scale.set(1.1, 0.95, 1.1);
        this.head.add(bun);
        break;
      }
      case 6: { // long, draping the back + sides
        cap(1.05, 1.0, 1.07, 0.02);
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
  _buildOutfit(outfit, G, m) {
    if (outfit === 1 || outfit === 2) {
      // Collar ring for polo (1) and jacket (2).
      const collar = m(G.collar, this.accentMat);
      collar.position.y = 1.4;
      collar.rotation.x = Math.PI / 2;
      collar.scale.set(1.04, 1, 0.82);
      this.group.add(collar);
    }
    if (outfit === 2) {
      // Jacket lapels — a shallow V down the chest front.
      for (const side of [-1, 1]) {
        const lapel = m(G.lapel, this.accentMat);
        lapel.position.set(side * 0.06, 1.2, 0.135);
        lapel.rotation.z = side * 0.32;
        this.group.add(lapel);
      }
    } else if (outfit === 3) {
      // Contrast chest stripe wrapping the shirt.
      const stripe = m(G.stripe, this.accentMat);
      stripe.position.y = 1.13;
      stripe.scale.set(1, 1, 0.76);
      this.group.add(stripe);
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
    const kneeBendL = Math.max(0, Math.sin(ph - Math.PI * 0.5)) * 0.9 * sw;
    const kneeBendR = Math.max(0, Math.sin(ph + Math.PI * 0.5)) * 0.9 * sw;
    // Arms counter-swing the legs, with the elbow bending on the forward reach.
    const armSwing = Math.sin(ph) * 0.5 * sw;
    const elbowL = (-0.18 - Math.max(0, Math.sin(ph)) * 0.5) * sw;
    const elbowR = (-0.18 - Math.max(0, -Math.sin(ph)) * 0.5) * sw;

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
    this.soleMat.dispose();
    this.accentMat.dispose();
    this.eyeMat.dispose();
    this.featureMat.dispose();
  }
}
