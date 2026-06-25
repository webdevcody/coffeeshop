// A wearable JETPACK — the "strap rockets to your back and fly" toy. Unlike the
// car/boat, you don't sit in it: rides.js parents this group onto the local
// player's back (a small back-plate with twin tanks + thrusters) and runs the
// fly physics with the FLY constants below, calling update(dt, thrust) every
// frame so the flame cones + exhaust sparks pulse with how hard you're burning.
//
// The mesh is deliberately COMPACT (envelope ~0.5m wide x ~0.6m tall x ~0.25m
// deep) so it tucks against a character's back without clipping. Forward is +Z
// local to match the player/car/boat convention; the nozzles + flame fire DOWN
// (-Y) so thrust reads as lift. Everything that animates is cached on build so
// update() never allocates (no `new` in the hot path).

import * as THREE from "three";

// Fly physics tunables — imported by the ride code so the jetpack's flight model
// lives in one place. Snappy but controllable: a strong upward thrust you hold to
// climb, gravity that pulls you back down when you ease off, a capped rise speed,
// light air drag so horizontal drift bleeds off, and a ceiling so you can't fly to
// the moon (and above the fog/sky dome). Units: thrust/gravity in m/s^2, speeds in
// m/s, drag in 1/s, altitude in metres.
export const FLY = { thrust: 9.0, gravity: 14, maxUp: 7, drag: 2.2, maxAltitude: 260 };

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.5,
    metalness: opts.metal ?? 0.55,
    emissive: opts.emissive || "#000000",
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

export function makeJetpack(opts = {}) {
  const group = new THREE.Group();

  const plateMat = mat("#3a3f47", { rough: 0.6, metal: 0.4 });   // dark back-plate
  const tankMat = mat("#d24b34", { rough: 0.35, metal: 0.5 });   // red fuel tanks
  const capMat = mat("#e7ecef", { rough: 0.3, metal: 0.7 });     // bright tank caps
  const thrusterMat = mat("#9aa2ab", { rough: 0.4, metal: 0.8 }); // steel thrusters
  const nozzleMat = mat("#22262b", { rough: 0.5, metal: 0.6 });  // dark nozzle bells
  const strapMat = mat("#1c1f24", { rough: 0.9, metal: 0.05 });  // webbing straps

  // ---- Back-plate: a thin curved-ish slab that meets the spine. Sits at -Z so
  // the bulk hangs off the back; the tanks/thrusters mount on its rear face. ----
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.06), plateMat);
  plate.castShadow = true;
  plate.position.set(0, 0, -0.10);
  group.add(plate);

  // Shoulder straps (two webbing loops curling over the front of the wearer).
  for (const sx of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.04), strapMat);
    strap.position.set(sx * 0.12, 0.02, -0.04);
    strap.rotation.x = 0.18; // lean the webbing forward over the shoulder
    group.add(strap);
  }

  // The flame group holds everything that glows/pulses, so the ride code can grab
  // `flame` and scale the whole exhaust with thrust if it wants. update() also
  // mutates the cached cones/sparks inside it directly.
  const flame = new THREE.Group();
  group.add(flame);

  // Per-nozzle animated bits, cached for an allocation-free update().
  const flameCones = [];   // emissive lift cones
  const flameMats = [];
  const sparks = [];       // exhaust spark quads (a few per nozzle)
  const sparkMats = [];
  const sparkBaseY = [];   // each spark's rest Y (so we can drop them by thrust)

  // Shared geometry for the exhaust sparks (one PlaneGeometry reused everywhere).
  const sparkGeo = new THREE.PlaneGeometry(0.07, 0.07);

  // ---- Twin tanks + thrusters, one on each side of the spine ----------------
  for (const sx of [-1, 1]) {
    const cx = sx * 0.12;

    // Fuel tank: a vertical capsule-ish cylinder strapped to the plate.
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.34, 16), tankMat);
    tank.castShadow = true;
    tank.position.set(cx, 0.02, -0.16);
    group.add(tank);
    // Rounded caps top + bottom so it reads as a pressure tank, not a can.
    const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), capMat);
    capTop.position.set(cx, 0.19, -0.16);
    group.add(capTop);
    const capBot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), capMat);
    capBot.position.set(cx, -0.15, -0.16);
    group.add(capBot);

    // Thruster body: a stubby cylinder slung below/outboard of the tank.
    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.18, 14), thrusterMat);
    thruster.castShadow = true;
    thruster.position.set(cx, -0.24, -0.13);
    group.add(thruster);

    // Short flared nozzle bell pointing straight down.
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.045, 0.08, 14, 1, true), nozzleMat);
    nozzle.position.set(cx, -0.35, -0.13);
    group.add(nozzle);

    // Emissive flame cone hanging out of the nozzle. ConeGeometry's apex is +Y, so
    // flip it (rotation.x = PI) to taper DOWNWARD into a teardrop of exhaust.
    const coneMat = new THREE.MeshBasicMaterial({
      color: "#ffb24a", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 12), coneMat);
    cone.rotation.x = Math.PI;
    cone.position.set(cx, -0.5, -0.13);
    cone.renderOrder = 3;
    flame.add(cone);
    flameCones.push(cone);
    flameMats.push(coneMat);

    // A few exhaust spark quads under the nozzle — billboards we just fade + drop +
    // grow with thrust. Built once, near-invisible at rest, never reallocated.
    for (let i = 0; i < 3; i++) {
      const sMat = new THREE.MeshBasicMaterial({
        color: i === 0 ? "#fff0c0" : "#ff8a3c",
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const spark = new THREE.Mesh(sparkGeo, sMat);
      const baseY = -0.52 - i * 0.08;
      spark.position.set(cx, baseY, -0.13);
      spark.renderOrder = 3;
      flame.add(spark);
      sparks.push(spark);
      sparkMats.push(sMat);
      sparkBaseY.push(baseY);
    }
  }

  if (opts.scale) group.scale.setScalar(opts.scale);

  // Phase accumulator for the flicker — a plain number, no allocation.
  let _t = Math.random() * Math.PI * 2;

  // Animate the exhaust by current thrust (0..1). Allocation-free: only mutates
  // cached material opacities + mesh scales/positions. A little sine flicker keeps
  // the flame alive even at a steady burn.
  function update(dt, thrust) {
    _t += dt;
    const f = thrust < 0 ? 0 : thrust > 1 ? 1 : thrust; // clamp 0..1
    const flick = 0.85 + Math.sin(_t * 38) * 0.15;      // fast jittery flame flicker

    for (let i = 0; i < flameCones.length; i++) {
      const cone = flameCones[i];
      flameMats[i].opacity = f * 0.9 * flick;
      // Stretch the cone downward with thrust (scale Y), pinch it in a touch in XZ.
      const len = 0.35 + f * 1.15 * flick;
      cone.scale.set(0.7 + f * 0.5, len, 0.7 + f * 0.5);
    }

    for (let i = 0; i < sparks.length; i++) {
      // Each spark in a nozzle's trio flickers on its own phase so they shimmer.
      const ph = Math.sin(_t * 26 + i * 2.1) * 0.5 + 0.5;
      const s = sparkMats[i];
      s.opacity = f * (0.55 - (i % 3) * 0.12) * ph;
      const sc = 0.5 + f * (1.1 + (i % 3) * 0.5) * ph;
      sparks[i].scale.set(sc, sc, sc);
      // Push the spark further down the harder we burn (longer exhaust plume).
      sparks[i].position.y = sparkBaseY[i] - f * (0.12 + (i % 3) * 0.16) * ph;
    }
  }

  function setVisible(b) {
    group.visible = b;
  }

  return { group, flame, update, setVisible };
}
