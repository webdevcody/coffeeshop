// A stylized low-poly café-goer. Root group sits on the floor (y = 0) facing +Z
// by default. Exposes limb groups so the walk cycle can swing arms and legs, and
// a `head` anchor so labels/chat bubbles can attach above it.

import * as THREE from "three";
import { SKIN_TONES, HAIR_TONES } from "../config.js";

// World-space height of the underside of the hips when standing (group at y=0).
// Used to drop a seated body so its hips rest on the seating surface.
const HIP_BOTTOM = 0.63;

function hashPick(arr, seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
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

    // Seated state: `seated` is the target, `seatBlend` eases the pose in/out so
    // sitting down and standing up are smooth. `sitDrop` lowers (or raises) the
    // body so the hips rest on the seating surface.
    this.seated = false;
    this.seatBlend = 0;
    this.sitDrop = 0;

    const color = appearance.color || "#e76f51";
    const skin = appearance.skin || hashPick(SKIN_TONES, seed + "s");
    const hair = appearance.hair || hashPick(HAIR_TONES, seed + "h");
    const pants = "#3a4a5a";

    // bodyMat = clothing (torso + arms); skinMat = head/neck/hands; hairMat =
    // hair cap. All three are customizable at runtime (see setAppearance).
    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true });
    this.skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7, flatShading: true });
    const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8, flatShading: true });
    this.hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85, flatShading: true });
    const skinMat = this.skinMat;
    const hairMat = this.hairMat;

    const m = (geo, mat) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // Torso (slightly tapered).
    const torso = m(new THREE.CylinderGeometry(0.22, 0.27, 0.62, 12), this.bodyMat);
    torso.position.y = 1.02;
    this.group.add(torso);

    // Hips.
    const hips = m(new THREE.CylinderGeometry(0.27, 0.24, 0.18, 12), pantsMat);
    hips.position.y = 0.72;
    this.group.add(hips);

    // Head + face.
    this.head = new THREE.Group();
    this.head.position.y = 1.58;
    const skull = m(new THREE.SphereGeometry(0.23, 16, 14), skinMat);
    this.head.add(skull);
    const hairCap = m(new THREE.SphereGeometry(0.245, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat);
    hairCap.position.y = 0.02;
    this.head.add(hairCap);
    // eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: "#222", roughness: 0.4 });
    for (const ex of [-0.08, 0.08]) {
      const eye = m(new THREE.SphereGeometry(0.028, 8, 8), eyeMat);
      eye.position.set(ex, 0.02, 0.21);
      this.head.add(eye);
    }
    this.group.add(this.head);

    // Neck.
    const neck = m(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8), skinMat);
    neck.position.y = 1.4;
    this.group.add(neck);

    // Legs (pivot at hip).
    const legGeo = new THREE.CylinderGeometry(0.09, 0.07, 0.66, 8);
    const footGeo = new THREE.BoxGeometry(0.14, 0.08, 0.24);
    const shoeMat = new THREE.MeshStandardMaterial({ color: "#2a2a2a", roughness: 0.6, flatShading: true });
    this.legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.12, 0.72, 0);
      const leg = m(legGeo, pantsMat);
      leg.position.y = -0.33;
      const foot = m(footGeo, shoeMat);
      foot.position.set(0, -0.66, 0.05);
      pivot.add(leg, foot);
      this.group.add(pivot);
      this.legs.push(pivot);
    }

    // Arms (pivot at shoulder).
    const armGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.56, 8);
    const handGeo = new THREE.SphereGeometry(0.075, 10, 8);
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.3, 1.32, 0);
      const arm = m(armGeo, this.bodyMat);
      arm.position.y = -0.28;
      const hand = m(handGeo, skinMat);
      hand.position.y = -0.56;
      pivot.add(arm, hand);
      pivot.rotation.z = side * 0.08;
      this.group.add(pivot);
      this.arms.push(pivot);
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
    if (on) this.sitDrop = seatTopY - HIP_BOTTOM;
  }

  // dt seconds; moving boolean. Animates a simple walk cycle / idle breathing,
  // or a seated pose, easing between the two via `seatBlend`.
  update(dt, moving) {
    const s = (this.seatBlend += ((this.seated ? 1 : 0) - this.seatBlend) * Math.min(1, dt * 10));
    const walking = moving && !this.seated;

    const target = walking ? 1 : 0;
    this.swing += (target - this.swing) * Math.min(1, dt * 8);

    if (walking) this.phase += dt * 9;
    const a = Math.sin(this.phase) * 0.7 * this.swing;

    // Blend each limb between its walk-cycle angle and a seated pose: legs bent
    // forward 90° at the hip, hands resting toward the lap.
    const legSit = -Math.PI / 2;
    const armSit = -0.45;
    this.legs[0].rotation.x = a * (1 - s) + legSit * s;
    this.legs[1].rotation.x = -a * (1 - s) + legSit * s;
    this.arms[0].rotation.x = -a * 0.8 * (1 - s) + armSit * s;
    this.arms[1].rotation.x = a * 0.8 * (1 - s) + armSit * s;

    // Gentle vertical bob while walking, easing toward the seat drop when seated.
    const bob = Math.abs(Math.sin(this.phase)) * 0.04 * this.swing;
    this.group.position.y = bob * (1 - s) + this.sitDrop * s;
    const breathe = walking ? 0 : Math.sin(performanceNow() * 0.002) * 0.01;
    this.head.position.y = 1.58 + breathe;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
  }
}

function performanceNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
