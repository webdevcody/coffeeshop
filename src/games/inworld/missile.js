// Faithful vanilla-JS (ESM) port of the original `src/scene/missile.ts` — the
// guided projectile that arcs from the firing fleet to the target cell, noses
// along its velocity, streams an exhaust trail, and fires a callback on impact.
//
// The geometry (cylinder body, conic nose, four fins, conic flame) and the flight
// integration (ballistic lerp + vertical sine bump, quaternion nose-orient along
// velocity, ~55 Hz trail emission) are the SAME as missile.ts. The only changes
// from the .ts source are TypeScript-only artefacts.
//
// SCALE. missile.ts builds the model at the console CELL = 10 and scales it ×2.2.
// In-world we additionally multiply the MODEL scale by S = cell/10 so it reads at
// the board's size, while origin/target/arc are passed by the caller already in
// BOARD-LOCAL (in-world) units. Everything is parented to a caller root Group so
// it inherits the board transform + per-seat orientation; fully disposable.

import * as THREE from "three";

const ORIGINAL_CELL = 10;
const UP = new THREE.Vector3(0, 1, 0);

function buildMissile(disposables) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.3, roughness: 0.5 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x9a1f1f, metalness: 0.3, roughness: 0.5 });
  const finMat = new THREE.MeshStandardMaterial({ color: 0x2a2f34, metalness: 0.4, roughness: 0.5 });
  const flameMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xff7b1a, emissiveIntensity: 6, roughness: 1 });
  disposables.push(bodyMat, noseMat, finMat, flameMat);

  const g = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(0.35, 0.42, 3, 10);
  disposables.push(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  g.add(body);
  const noseGeo = new THREE.ConeGeometry(0.42, 1.1, 10);
  disposables.push(noseGeo);
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.y = 2.05;
  g.add(nose);
  for (let i = 0; i < 4; i++) {
    const finGeo = new THREE.BoxGeometry(0.12, 1.0, 0.7);
    disposables.push(finGeo);
    const fin = new THREE.Mesh(finGeo, finMat);
    const a = (i * Math.PI) / 2;
    fin.position.set(Math.cos(a) * 0.5, -1.2, Math.sin(a) * 0.5);
    fin.rotation.y = -a;
    g.add(fin);
  }
  const flameGeo = new THREE.ConeGeometry(0.36, 1.8, 8);
  disposables.push(flameGeo);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.y = -2.2;
  flame.rotation.x = Math.PI; // taper points down (aft)
  g.add(flame);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

class Missile {
  constructor(origin, target, duration, arc, onArrive, S, disposables) {
    this.origin = origin;
    this.target = target;
    this.duration = duration;
    this.arc = arc;
    this.onArrive = onArrive;
    this.t = 0;
    this.trailTimer = 0;
    this.q = new THREE.Quaternion();
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.delta = new THREE.Vector3();
    this._tailLocal = new THREE.Vector3();

    this.group = buildMissile(disposables);
    // toy-scale (×2.2 in the original) folded with the in-world cell scale S.
    this.group.scale.setScalar(2.2 * S);
    this.group.position.copy(origin);
    // The tail trail-emit point is at model-local y = -2.4 (in original units),
    // converted through localToWorld so it accounts for the missile scale.
    this._tailY = -2.4;
  }

  /** @returns true when the missile has reached its target. */
  update(dt, fx) {
    this.t += dt / this.duration;
    const k = Math.min(this.t, 1);

    // Ballistic arc: straight-line interp + a vertical sine bump.
    this.pos.lerpVectors(this.origin, this.target, k);
    this.pos.y += this.arc * Math.sin(Math.PI * k);
    this.group.position.copy(this.pos);

    // Orient nose (+Y) along the velocity vector.
    this.delta.subVectors(this.target, this.origin);
    this.vel.copy(this.delta);
    this.vel.y += this.arc * Math.PI * Math.cos(Math.PI * k);
    if (this.vel.lengthSq() > 1e-9) {
      this.q.setFromUnitVectors(UP, this.vel.normalize());
      this.group.quaternion.copy(this.q);
    }

    // Exhaust trail from the tail (~55 Hz, exactly as the original). The missile
    // group and the fx root share the SAME parent (the board group), so the tail
    // in the fx-root frame is just the missile's LOCAL transform (position +
    // quaternion + scale) applied to the model-local tail offset — no world-matrix
    // round-trip needed (robust even if matrixWorld is a frame stale).
    this.trailTimer += dt;
    if (this.trailTimer > 0.018) {
      this.trailTimer = 0;
      this._tailLocal.set(0, this._tailY, 0);
      this._tailLocal.multiply(this.group.scale).applyQuaternion(this.group.quaternion).add(this.group.position);
      fx.missileTrail(this._tailLocal);
    }
    return k >= 1;
  }
}

/** Spawns and advances guided missiles; fires a callback on impact. Port of
 *  missile.ts MissileSystem, parented to `root` (the board group). */
export class MissileSystem {
  constructor(root, fx, cell) {
    this.root = root;
    this.fx = fx;
    this.S = (cell || ORIGINAL_CELL) / ORIGINAL_CELL;
    this.missiles = [];
    this._disposables = [];
  }

  get active() {
    return this.missiles.length > 0;
  }

  // origin/target are BOARD-LOCAL Vector3 (in-world units). duration (s) + arc
  // (in-world height) default to the original feel scaled by S.
  launch(origin, target, opts) {
    const dist = origin.distanceTo(target);
    const duration = opts && opts.duration != null ? opts.duration : 1.6;
    const arc = opts && opts.arc != null ? opts.arc : Math.max(48 * this.S, dist * 0.5);
    const onArrive = opts && opts.onArrive ? opts.onArrive : () => {};
    const m = new Missile(origin.clone(), target.clone(), duration, arc, onArrive, this.S, this._disposables);
    this.missiles.push(m);
    this.root.add(m.group);
  }

  update(dt) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (m.update(dt, this.fx)) {
        this.root.remove(m.group);
        this.missiles.splice(i, 1);
        m.onArrive();
      }
    }
  }

  clear() {
    for (const m of this.missiles) this.root.remove(m.group);
    this.missiles.length = 0;
  }

  dispose() {
    this.clear();
    for (const d of this._disposables) d.dispose?.();
    this._disposables.length = 0;
  }
}

export default MissileSystem;
