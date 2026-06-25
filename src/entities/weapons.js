// A self-contained WEAPONS toy — three low-poly hand weapons (a pistol, a rocket
// launcher and a grenade launcher) plus the projectiles + shared explosion FX
// they fling into the world. It owns everything: the held-weapon meshes (which
// the integrator parents onto the player's hand), and a separate WORLD group
// (parented to the scene) that holds every projectile, muzzle flash and
// explosion so they live in world space and keep flying after they leave the
// hand. NOTHING in fire()/update()/spawnRemoteShot() allocates after warmup —
// the projectiles, flashes and explosions are all fixed-capacity POOLS built
// once at construction; spawning recycles the oldest entry, and the per-frame
// integration only mutates cached mesh transforms + a handful of scratch
// vectors. There is no damage/gameplay here — it is purely cosmetic and is
// driven identically whether a shot is LOCAL (fire) or RELAYED from another
// player (spawnRemoteShot), so everyone sees everyone's tracers + blasts.
//
// Convention: every weapon mesh and projectile is built pointing +Z (forward),
// matching the player/car/boat heading convention, so a quaternion from +Z to
// the aim direction orients a flying projectile, and the held meshes point the
// way the hand faces once parented.

import * as THREE from "three";

// Fixed pool capacities. Tracers are cheap + very short-lived so we keep more of
// them; rockets/grenades are chunkier and rarer. Flash covers BOTH muzzle
// flashes and the little spark a tracer leaves on expiry. Recycling is
// oldest-first (see acquire), so sustained fire just overwrites stale entries.
const POOL = { tracer: 24, rocket: 8, grenade: 8, flash: 16, explosion: 6 };

// Projectile tunables (metres, seconds, m/s, m/s^2). Authored to feel arcadey.
const GUN = { speed: 120, life: 0.22 };                 // fast short tracer streak
const RKT = { speed: 32, life: 4.0, impactY: 0.15 };    // straight-flying rocket
const GREN = {                                          // arcing, bouncing grenade
  speed: 17, lob: 4.0, gravity: 18, restitution: 0.42,
  friction: 0.6, maxBounces: 2, life: 4.0, radius: 0.12,
};
const FLASH_LIFE = 0.09; // muzzle flash / spark fade time
const EXPLO_LIFE = 0.6;  // shared explosion fade time
const EXPLO_DEBRIS = 5;  // debris/smoke quads per explosion

const FORWARD = new THREE.Vector3(0, 0, 1);

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.5,
    metalness: opts.metal ?? 0.5,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

// Additive, depth-write-off basic material for every glowing FX bit (tracers,
// flames, flashes, explosions) so they bloom over the scene without z-fighting.
function fxMat(color, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: opts.opacity ?? 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: opts.side ?? THREE.FrontSide,
  });
}

export function createWeapons(scene) {
  // Everything created here is tracked so dispose() can free GPU memory.
  const disposables = [];
  const D = (x) => (disposables.push(x), x);

  // -- The held-weapon group (integrator parents this onto the hand) ---------
  const group = new THREE.Group();
  group.name = "weapons";

  // -- The world-space FX group (projectiles + flashes + explosions) ---------
  const world = new THREE.Group();
  world.name = "weaponsFX";
  scene.add(world);

  // Scratch — reused every frame, never reallocated in a hot path.
  const _dir = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _vec = new THREE.Vector3();
  let _seq = 0; // monotonic spawn counter so acquire() can find the oldest entry

  // ===========================================================================
  // Held weapon hand-meshes (low-poly). Each is built pointing +Z so it aims the
  // way the hand faces. Hidden until equip() shows the chosen one.
  // ===========================================================================
  function buildPistol() {
    const g = new THREE.Group();
    const steel = D(mat(0x2b2f34, { rough: 0.4, metal: 0.85 }));
    const dark = D(mat(0x141619, { rough: 0.6, metal: 0.5 }));
    const slide = new THREE.Mesh(D(new THREE.BoxGeometry(0.06, 0.07, 0.22)), steel);
    slide.position.set(0, 0.02, 0.06);
    g.add(slide);
    const barrel = new THREE.Mesh(D(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 10)), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, 0.2);
    g.add(barrel);
    const grip = new THREE.Mesh(D(new THREE.BoxGeometry(0.05, 0.14, 0.06)), dark);
    grip.position.set(0, -0.07, -0.02);
    grip.rotation.x = -0.28;
    g.add(grip);
    const guard = new THREE.Mesh(D(new THREE.TorusGeometry(0.035, 0.008, 6, 12)), dark);
    guard.position.set(0, -0.02, 0.0);
    guard.rotation.x = Math.PI / 2;
    g.add(guard);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.visible = false;
    return g;
  }

  function buildRocketLauncher() {
    const g = new THREE.Group();
    const tubeMat = D(mat(0x3c6e3a, { rough: 0.55, metal: 0.35 })); // olive tube
    const trim = D(mat(0x20242a, { rough: 0.6, metal: 0.5 }));
    const warn = D(mat(0xd0a32a, { rough: 0.5, metal: 0.4 }));
    // Shoulder tube along +Z.
    const tube = new THREE.Mesh(D(new THREE.CylinderGeometry(0.075, 0.075, 0.8, 16)), tubeMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.04, 0.18);
    g.add(tube);
    // Flared muzzle ring at the front.
    const muzzle = new THREE.Mesh(D(new THREE.CylinderGeometry(0.1, 0.075, 0.1, 16, 1, true)), trim);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.04, 0.6);
    g.add(muzzle);
    // Rear blast cone (opens backward, -Z).
    const cone = new THREE.Mesh(D(new THREE.CylinderGeometry(0.075, 0.11, 0.16, 16, 1, true)), trim);
    cone.rotation.x = Math.PI / 2;
    cone.position.set(0, 0.04, -0.28);
    g.add(cone);
    // A yellow warning band near the muzzle.
    const band = new THREE.Mesh(D(new THREE.CylinderGeometry(0.078, 0.078, 0.06, 16)), warn);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0.04, 0.46);
    g.add(band);
    // Pistol grip below.
    const grip = new THREE.Mesh(D(new THREE.BoxGeometry(0.05, 0.13, 0.06)), trim);
    grip.position.set(0, -0.07, 0.0);
    grip.rotation.x = -0.18;
    g.add(grip);
    // Top optical sight.
    const sight = new THREE.Mesh(D(new THREE.BoxGeometry(0.03, 0.05, 0.12)), trim);
    sight.position.set(0, 0.13, 0.12);
    g.add(sight);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.visible = false;
    return g;
  }

  function buildGrenadeLauncher() {
    const g = new THREE.Group();
    const body = D(mat(0x33373d, { rough: 0.5, metal: 0.6 }));
    const wood = D(mat(0x6b4a2f, { rough: 0.7, metal: 0.1 }));
    const dark = D(mat(0x141619, { rough: 0.6, metal: 0.45 }));
    // Stubby fat barrel (big bore) along +Z.
    const barrel = new THREE.Mesh(D(new THREE.CylinderGeometry(0.055, 0.055, 0.32, 16)), body);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, 0.16);
    g.add(barrel);
    // Wide muzzle bore ring.
    const bore = new THREE.Mesh(D(new THREE.CylinderGeometry(0.062, 0.05, 0.05, 16, 1, true)), dark);
    bore.rotation.x = Math.PI / 2;
    bore.position.set(0, 0.03, 0.33);
    g.add(bore);
    // Receiver block (the break-action hinge body).
    const receiver = new THREE.Mesh(D(new THREE.BoxGeometry(0.07, 0.08, 0.12)), body);
    receiver.position.set(0, 0.0, -0.02);
    g.add(receiver);
    // Wooden stock sloping back/down.
    const stock = new THREE.Mesh(D(new THREE.BoxGeometry(0.05, 0.07, 0.16)), wood);
    stock.position.set(0, -0.03, -0.14);
    stock.rotation.x = 0.22;
    g.add(stock);
    // Grip + trigger guard.
    const grip = new THREE.Mesh(D(new THREE.BoxGeometry(0.045, 0.11, 0.05)), dark);
    grip.position.set(0, -0.08, -0.04);
    grip.rotation.x = -0.2;
    g.add(grip);
    const guard = new THREE.Mesh(D(new THREE.TorusGeometry(0.03, 0.007, 6, 12)), dark);
    guard.position.set(0, -0.03, 0.02);
    guard.rotation.x = Math.PI / 2;
    g.add(guard);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.visible = false;
    return g;
  }

  const gun = buildPistol();
  const rocket = buildRocketLauncher();
  const grenade = buildGrenadeLauncher();
  group.add(gun, rocket, grenade);
  const weaponMeshes = { gun, rocket, grenade };

  let _current = null;

  // Show the chosen weapon, hide the rest. equip(null)/unknown → holster all.
  function equip(kind) {
    const k = kind === "gun" || kind === "rocket" || kind === "grenade" ? kind : null;
    gun.visible = k === "gun";
    rocket.visible = k === "rocket";
    grenade.visible = k === "grenade";
    _current = k;
  }

  function current() {
    return _current;
  }

  // ===========================================================================
  // Shared FX geometry/materials + pools. Geometry (and look-alike materials) are
  // shared across a pool; materials whose OPACITY animates per-instance (flashes,
  // explosions) are per-entry so they fade independently.
  // ===========================================================================

  // -- Muzzle flash / spark pool ---------------------------------------------
  const flashGeo = D(new THREE.IcosahedronGeometry(0.5, 0));
  const flashPool = [];
  for (let i = 0; i < POOL.flash; i++) {
    const m = D(fxMat(0xfff2b0));
    const mesh = new THREE.Mesh(flashGeo, m);
    mesh.visible = false;
    mesh.renderOrder = 5;
    world.add(mesh);
    flashPool.push({ mesh, fmat: m, t: 0, life: FLASH_LIFE, base: 0.2, active: false, seq: 0 });
  }

  // -- Explosion pool (expanding core sphere + flat ring + flying debris quads) -
  const coreGeo = D(new THREE.IcosahedronGeometry(1, 1));
  const ringGeo = D(new THREE.RingGeometry(0.6, 1.0, 24));
  const debrisGeo = D(new THREE.PlaneGeometry(0.4, 0.4));
  const explosionPool = [];
  for (let i = 0; i < POOL.explosion; i++) {
    const eg = new THREE.Group();
    eg.visible = false;
    eg.renderOrder = 5;
    const coreMat = D(fxMat(0xffd27a));
    const core = new THREE.Mesh(coreGeo, coreMat);
    eg.add(core);
    const ringMat = D(fxMat(0xffa53a, { side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2; // lie the shockwave flat
    eg.add(ring);
    const debrisMat = D(fxMat(0xff7a2a, { side: THREE.DoubleSide }));
    const debris = [];
    for (let d = 0; d < EXPLO_DEBRIS; d++) {
      const dm = new THREE.Mesh(debrisGeo, debrisMat);
      // Bake an outward direction (hemisphere, biased upward) + a tumble.
      const a = Math.random() * Math.PI * 2;
      const up = 0.25 + Math.random() * 0.9;
      const rad = Math.sqrt(Math.max(0, 1 - up * up * 0.4));
      const dir = new THREE.Vector3(Math.cos(a) * rad, up, Math.sin(a) * rad).normalize();
      dm.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      eg.add(dm);
      debris.push({ mesh: dm, dir });
    }
    world.add(eg);
    explosionPool.push({ group: eg, core, coreMat, ring, ringMat, debris, debrisMat, t: 0, active: false, seq: 0 });
  }

  // -- Tracer pool (gun): one shared additive streak geo+mat ------------------
  const tracerGeo = D(new THREE.CylinderGeometry(0.03, 0.012, 0.7, 6));
  tracerGeo.rotateX(Math.PI / 2); // lay the streak along +Z
  const tracerMat = D(fxMat(0xfff0a0, { opacity: 0.95 }));
  const tracerPool = [];
  for (let i = 0; i < POOL.tracer; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    mesh.renderOrder = 5;
    world.add(mesh);
    tracerPool.push({ mesh, vel: new THREE.Vector3(), t: 0, life: GUN.life, active: false, seq: 0 });
  }

  // -- Rocket projectile pool -------------------------------------------------
  const rBodyGeo = D(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 10)); rBodyGeo.rotateX(Math.PI / 2);
  const rNoseGeo = D(new THREE.ConeGeometry(0.06, 0.14, 10)); rNoseGeo.rotateX(Math.PI / 2);
  const rFinGeo = D(new THREE.BoxGeometry(0.015, 0.07, 0.08));
  const rFlameGeo = D(new THREE.ConeGeometry(0.05, 0.2, 8)); rFlameGeo.rotateX(-Math.PI / 2);
  const rBodyMat = D(mat(0xd7dadf, { rough: 0.4, metal: 0.4 }));
  const rNoseMat = D(mat(0xb02525, { rough: 0.4, metal: 0.3 }));
  const rFinMat = D(mat(0x24282d, { rough: 0.5, metal: 0.5 }));
  const rFlameMat = D(fxMat(0xff9b30, { opacity: 0.9 }));
  const rocketPool = [];
  for (let i = 0; i < POOL.rocket; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(rBodyGeo, rBodyMat); g.add(body);
    const nose = new THREE.Mesh(rNoseGeo, rNoseMat); nose.position.z = 0.24; g.add(nose);
    for (let k = 0; k < 3; k++) {
      const f = new THREE.Mesh(rFinGeo, rFinMat);
      const a = (k / 3) * Math.PI * 2;
      f.position.set(Math.cos(a) * 0.07, Math.sin(a) * 0.07, -0.12);
      f.rotation.z = a;
      g.add(f);
    }
    const flame = new THREE.Mesh(rFlameGeo, rFlameMat);
    flame.position.z = -0.22;
    flame.renderOrder = 5;
    g.add(flame);
    g.visible = false;
    world.add(g);
    rocketPool.push({ mesh: g, vel: new THREE.Vector3(), t: 0, life: RKT.life, active: false, seq: 0 });
  }

  // -- Grenade projectile pool ------------------------------------------------
  const gBodyGeo = D(new THREE.IcosahedronGeometry(GREN.radius, 1));
  const gLeverGeo = D(new THREE.BoxGeometry(0.025, 0.06, 0.025));
  const gBodyMat = D(mat(0x42562b, { rough: 0.55, metal: 0.3 }));   // olive grenade
  const gLeverMat = D(mat(0xb8bcc2, { rough: 0.4, metal: 0.7 }));   // metal spoon
  const grenadePool = [];
  for (let i = 0; i < POOL.grenade; i++) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(gBodyGeo, gBodyMat); b.castShadow = true; g.add(b);
    const lever = new THREE.Mesh(gLeverGeo, gLeverMat); lever.position.set(0.04, GREN.radius * 0.8, 0); g.add(lever);
    g.visible = false;
    world.add(g);
    grenadePool.push({ mesh: g, vel: new THREE.Vector3(), t: 0, life: GREN.life, bounces: 0, sx: 0, sy: 0, sz: 0, active: false, seq: 0 });
  }

  // Grab a free pool entry, or recycle the OLDEST active one (smallest seq).
  function acquire(pool) {
    let oldest = pool[0];
    for (let i = 0; i < pool.length; i++) {
      const e = pool[i];
      if (!e.active) return e;
      if (e.seq < oldest.seq) oldest = e;
    }
    return oldest;
  }

  // -- Spawners ---------------------------------------------------------------
  function spawnFlash(pos, base, colorHex) {
    const f = acquire(flashPool);
    f.active = true; f.seq = _seq++; f.t = 0; f.base = base;
    f.fmat.color.setHex(colorHex);
    f.fmat.opacity = 1;
    f.mesh.position.copy(pos);
    f.mesh.scale.setScalar(base);
    f.mesh.visible = true;
  }

  function spawnExplosion(pos) {
    const e = acquire(explosionPool);
    e.active = true; e.seq = _seq++; e.t = 0;
    e.group.position.copy(pos);
    e.group.visible = true;
    // Seed initial child transforms so a one-frame gap before update() reads tidy.
    e.core.scale.setScalar(0.25); e.coreMat.opacity = 1;
    e.ring.scale.setScalar(0.4); e.ringMat.opacity = 0.7;
    e.debrisMat.opacity = 1;
    for (const d of e.debris) d.mesh.position.set(0, 0, 0);
  }

  function spawnTracer(origin, dir) {
    const e = acquire(tracerPool);
    e.active = true; e.seq = _seq++; e.t = 0;
    e.vel.copy(dir).multiplyScalar(GUN.speed);
    e.mesh.position.copy(origin);
    _q.setFromUnitVectors(FORWARD, dir);
    e.mesh.quaternion.copy(_q);
    e.mesh.visible = true;
  }

  function spawnRocket(origin, dir) {
    const e = acquire(rocketPool);
    e.active = true; e.seq = _seq++; e.t = 0;
    e.vel.copy(dir).multiplyScalar(RKT.speed);
    e.mesh.position.copy(origin);
    _q.setFromUnitVectors(FORWARD, dir);
    e.mesh.quaternion.copy(_q);
    e.mesh.visible = true;
  }

  function spawnGrenade(origin, dir) {
    const e = acquire(grenadePool);
    e.active = true; e.seq = _seq++; e.t = 0; e.bounces = 0;
    e.vel.copy(dir).multiplyScalar(GREN.speed);
    e.vel.y += GREN.lob; // a little lob so even a flat aim arcs
    e.mesh.position.copy(origin);
    e.mesh.rotation.set(0, 0, 0);
    e.sx = (Math.random() - 0.5) * 14;
    e.sy = (Math.random() - 0.5) * 14;
    e.sz = (Math.random() - 0.5) * 14;
    e.mesh.visible = true;
  }

  // Central spawn: muzzle flash at the origin + the right projectile. Used by
  // BOTH fire() (local) and spawnRemoteShot() (relayed) so visuals are identical.
  function spawnShot(origin, dir, kind) {
    _dir.copy(dir);
    if (_dir.lengthSq() < 1e-9) _dir.set(0, 0, 1);
    _dir.normalize();
    const flashBase = kind === "rocket" ? 0.3 : kind === "grenade" ? 0.24 : 0.18;
    spawnFlash(origin, flashBase, 0xfff2b0);
    if (kind === "rocket") spawnRocket(origin, _dir);
    else if (kind === "grenade") spawnGrenade(origin, _dir);
    else spawnTracer(origin, _dir);
  }

  function kindOf(k) {
    return k === "rocket" || k === "grenade" ? k : "gun";
  }

  // Public: fire a shot from the LOCAL player.
  function fire(origin, dir, kind) {
    spawnShot(origin, dir, kindOf(kind));
  }

  // Public: replay a shot RELAYED from another player (same visuals, no damage).
  function spawnRemoteShot(weapon, origin, dir) {
    spawnShot(origin, dir, kindOf(weapon));
  }

  // ===========================================================================
  // Per-frame update. Order: advance projectiles FIRST (they may spawn flashes /
  // explosions on expiry), THEN animate flashes + explosions so freshly-spawned
  // ones already tick this frame. Allocation-free.
  // ===========================================================================
  function update(dt) {
    if (dt > 0.1) dt = 0.1; // clamp big stalls so fast projectiles can't tunnel

    // -- Tracers: travel straight + fast; on expiry leave a little spark -------
    for (const e of tracerPool) {
      if (!e.active) continue;
      e.t += dt;
      e.mesh.position.addScaledVector(e.vel, dt);
      if (e.t >= e.life) {
        spawnFlash(e.mesh.position, 0.12, 0xfff0c0);
        e.active = false; e.mesh.visible = false;
      }
    }

    // -- Rockets: fly straight; explode on ground impact or lifetime -----------
    for (const e of rocketPool) {
      if (!e.active) continue;
      e.t += dt;
      e.mesh.position.addScaledVector(e.vel, dt);
      const hitGround = e.t > 0.04 && e.mesh.position.y <= RKT.impactY;
      if (hitGround || e.t >= e.life) {
        _vec.copy(e.mesh.position);
        if (_vec.y < RKT.impactY) _vec.y = RKT.impactY;
        spawnExplosion(_vec);
        e.active = false; e.mesh.visible = false;
      }
    }

    // -- Grenades: gravity + tumble; bounce off y=0 once/twice then explode -----
    for (const e of grenadePool) {
      if (!e.active) continue;
      e.t += dt;
      e.vel.y -= GREN.gravity * dt;
      e.mesh.position.addScaledVector(e.vel, dt);
      e.mesh.rotation.x += e.sx * dt;
      e.mesh.rotation.y += e.sy * dt;
      e.mesh.rotation.z += e.sz * dt;
      if (e.mesh.position.y <= GREN.radius && e.vel.y < 0) {
        e.mesh.position.y = GREN.radius;
        if (e.bounces < GREN.maxBounces) {
          e.vel.y = -e.vel.y * GREN.restitution;
          e.vel.x *= GREN.friction;
          e.vel.z *= GREN.friction;
          e.bounces++;
        } else {
          spawnExplosion(e.mesh.position);
          e.active = false; e.mesh.visible = false;
          continue;
        }
      }
      if (e.t >= e.life) {
        spawnExplosion(e.mesh.position);
        e.active = false; e.mesh.visible = false;
      }
    }

    // -- Muzzle flashes / sparks: pop + fade -----------------------------------
    for (const f of flashPool) {
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { f.active = false; f.mesh.visible = false; continue; }
      f.fmat.opacity = 1 - k;
      f.mesh.scale.setScalar(f.base * (1 + k * 1.6));
    }

    // -- Explosions: expand core + ring + fling debris, fade over ~0.6s --------
    for (const e of explosionPool) {
      if (!e.active) continue;
      e.t += dt;
      const k = e.t / EXPLO_LIFE;
      if (k >= 1) { e.active = false; e.group.visible = false; continue; }
      const inv = 1 - k;
      e.core.scale.setScalar(0.25 + k * 2.4);
      e.coreMat.opacity = inv * inv;
      const rs = 0.4 + k * 4.0;
      e.ring.scale.set(rs, rs, rs);
      e.ringMat.opacity = inv * 0.7;
      const spread = k * 3.0;
      const ds = 0.6 + k * 1.4;
      e.debrisMat.opacity = inv;
      for (const d of e.debris) {
        d.mesh.position.set(d.dir.x * spread, d.dir.y * spread - k * k * 0.8, d.dir.z * spread);
        d.mesh.scale.setScalar(ds);
      }
    }
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    if (world.parent) world.parent.remove(world);
    for (const d of disposables) d.dispose?.();
    disposables.length = 0;
  }

  return { group, weaponMeshes, equip, current, fire, update, spawnRemoteShot, dispose };
}

export default createWeapons;
