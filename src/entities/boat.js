// A small drivable BOAT — the "steal a boat" toy. It owns its own geometry, arcade
// nautical physics (gliding accel + slow, momentum-y turning), a water-only motion
// constraint (it can't sail onto land/docks/islands), a gentle idle bob/roll, a soft
// speed-scaled wake hint, and a trailing chase camera. It deliberately MIRRORS the
// car.js API (group/state/drive/updateCamera/resetCamera/footprint/exitSpot/
// distanceTo/syncGroup) so rides.js can pilot it almost identically to the car —
// the only meaningful difference is drive()'s signature: the boat takes the raw
// (throttle, steer) axes + an isWater(x,z) predicate instead of (input, colliders,
// isGround), because the sea constrains motion to the water surface, not to ground.

import * as THREE from "three";

const BOAT = {
  radius: 1.6,          // collision/clearance circle (XZ), used for slide checks
  accel: 7.5,           // m/s^2 forward thrust (gentler than a car)
  reverseAccel: 4.0,    // m/s^2 astern
  maxSpeed: 11,         // m/s top cruise
  maxReverse: 3.5,      // m/s astern
  waterDrag: 1.9,       // coast deceleration — long, gliding (much lower than car roll)
  brakeDrag: 6.0,       // extra drag when actively reversing throttle while moving fwd
  turnRate: 1.25,       // rad/s at full steer — boaty, lazy turn (car is 2.1)
  turnGripSpeed: 3.5,   // speed at which steering reaches full authority
  // Idle/water motion.
  bobAmp: 0.06,         // vertical bob amplitude (m) at rest
  bobRate: 1.4,         // bob frequency (rad/s)
  rollAmp: 0.05,        // idle roll amplitude (rad) about the heading axis
  rollRate: 1.0,        // roll frequency (rad/s)
  heelPerSpeed: 0.018,  // banking lean into a turn, scaled by speed*steer
  // Chase camera (a touch higher + further back than the car — you sit lower/longer).
  camBack: 9.5,
  camHeight: 4.4,
  camLook: 1.2,
  camEase: 3.2,
  // Free-look chase orbit (GTA-style, mirrors the car). camBasePitch reproduces the
  // old fixed framing when no `controls` is passed; pitch clamps to [camMinPitch,camMaxPitch].
  camDist: 10.02,     // ≈ hypot(camBack, camHeight - camLook); orbit radius
  camBasePitch: 0.32, // ≈ atan2(camHeight - camLook, camBack); resting chase pitch
  camMinPitch: 0.1,
  camMaxPitch: 1.05,
};

// NOS boost tuning (mirrors the car). Level 1 = Shift, level 2 = Shift+Ctrl.
const NOS = {
  mult1: 1.5,    // level-1 top-speed + accel multiplier
  mult2: 2.1,    // level-2 (EXTREME) multiplier
  drain1: 0.30,  // tank drain /s at level 1
  drain2: 0.6,   // tank drain /s at level 2 (extreme burns faster)
  regen: 0.15,   // tank refill /s when not boosting
  rearm: 0.1,    // after the tank empties it must refill past this before NOS re-arms
};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.6,
    metalness: opts.metal ?? 0.15,
    emissive: opts.emissive || "#000000",
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

// Build the boat group. Forward is +Z local (heading 0 faces +Z, matching the
// player/car convention: forward = (sin(h), 0, cos(h))). The hull is modelled so
// that the WATERLINE sits at local y=0 — makeBoat() then parks the group at
// waterY, so the painted waterline rides exactly on the sea surface. Footprint
// envelope ~2.2 wide (±1.1) x ~5.4 long (±2.7), nose pointing +Z.
function buildBoatGroup() {
  const g = new THREE.Group();

  const hullPaint = mat("#f2f6f9", { rough: 0.28, metal: 0.24 }); // glossy topsides gelcoat
  const bootStripe = mat("#1d6fb8", { rough: 0.32, metal: 0.3 }); // boot-line accent
  const sweep = mat("#123a63", { rough: 0.3, metal: 0.35 });      // hull-side sport sweep
  const belowWater = mat("#8f9ba3", { rough: 0.72, metal: 0.05 });// dull anti-foul keel
  const deckMat = mat("#c39a63", { rough: 0.72, metal: 0.05 });   // teak-ish deck
  const cabinMat = mat("#fbfcfd", { rough: 0.3, metal: 0.28 });   // bright console/cabin
  const glassMat = new THREE.MeshStandardMaterial({ color: "#12202a", roughness: 0.06, metalness: 0.9, transparent: true, opacity: 0.62 });
  const chrome = mat("#dfe3e8", { rough: 0.16, metal: 0.95 });    // rails / cleats / frame
  const trim = mat("#1b232b", { rough: 0.55, metal: 0.35 });
  const cushion = mat("#2a3138", { rough: 0.85, metal: 0.02 });   // upholstered bolsters
  const EP = 0.012; // proud epsilon to keep appliqué detail off the panels

  // --- Hull: a stretched, slightly pointed body. Built from a box midsection with
  // a wedge bow tucked into its front. The hull spans y -0.45..0.55: the slab below
  // y=0 is the wetted (below-water) part, above is topsides. Waterline at y=0. ---
  const midHull = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 4.0), hullPaint);
  midHull.castShadow = true; midHull.receiveShadow = true;
  midHull.position.set(0, 0.05, -0.2);
  g.add(midHull);

  // Below-water keel slab (dull), sunk into the hull bottom so the seam isn't coincident.
  const keel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 3.7), belowWater);
  keel.position.set(0, -0.36, -0.2);
  g.add(keel);

  // Boot-line stripe running the flanks right at the waterline.
  for (const sx of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 3.9), bootStripe);
    stripe.position.set(sx * (1.0 + EP), 0.02, -0.2);
    g.add(stripe);
  }
  // Dark sport sweep along the topsides, rising toward the bow, with a thin chrome
  // pinstripe under it — the racy two-tone flash on the hull side.
  for (const sx of [-1, 1]) {
    const flash = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 3.6), sweep);
    flash.position.set(sx * (1.0 + EP), 0.3, -0.1);
    flash.rotation.x = -0.04; // gentle rise toward the prow
    g.add(flash);
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.03, 3.6), chrome);
    pin.position.set(sx * (1.0 + EP + 0.004), 0.19, -0.1);
    pin.rotation.x = -0.04;
    g.add(pin);
  }

  // Pointed bow wedge — narrows to a prow at +Z, tucked into the midhull front.
  const bow = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 1.4), hullPaint);
  bow.castShadow = true;
  bow.position.set(0, 0.05, 1.95);
  bow.scale.set(0.18, 1, 1.0); // pinch the front to a near-point (keeps the prow sharp)
  // Offset back so the scaled wedge meets the square hull face cleanly.
  bow.position.z = 1.78;
  g.add(bow);
  // A second, fuller bow flare just behind the point for a fairer entry.
  const bowFlare = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.95, 1.0), hullPaint);
  bowFlare.castShadow = true;
  bowFlare.position.set(0, 0.06, 1.55);
  bowFlare.scale.set(1, 1, 1);
  bowFlare.geometry.computeBoundingBox();
  // taper the front face inward by skewing via a thin nose cap instead of vertex edits
  g.add(bowFlare);
  const prow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 1.2), hullPaint);
  prow.castShadow = true;
  prow.position.set(0, 0.08, 2.5);
  g.add(prow);

  // --- Deck: a lighter inset deck plane sitting on top of the topsides ---
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 3.9), deckMat);
  deck.receiveShadow = true;
  deck.position.set(0, 0.56, -0.25);
  g.add(deck);
  // Low gunwale lip around the deck edge so it reads as a cockpit, not a flat slab.
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 3.9), hullPaint);
    rail.position.set(sx * 0.92, 0.62, -0.25);
    g.add(rail);
  }

  // --- Cabin / console: a low forward console with a raked windscreen ---
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.62, 1.3), cabinMat);
  cabin.castShadow = true;
  cabin.position.set(0, 0.92, 0.55);
  g.add(cabin);
  const cabinRoof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.2), cabinMat);
  cabinRoof.castShadow = true;
  cabinRoof.position.set(0, 1.26, 0.55);
  g.add(cabinRoof);
  // Raked windscreen on the front face of the console.
  const screen = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.05), glassMat);
  screen.position.set(0, 1.0, 1.22);
  screen.rotation.x = -0.32;
  g.add(screen);
  // Side windows.
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 1.0), glassMat);
    side.position.set(sx * 0.71, 0.98, 0.55);
    g.add(side);
  }
  // Chrome windshield frame hugging the raked screen (top rail + two A-posts).
  const wsTop = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.05, 0.06), chrome);
  wsTop.position.set(0, 1.24, 1.14);
  wsTop.rotation.x = -0.32;
  g.add(wsTop);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.54, 0.05), chrome);
    post.position.set(sx * 0.65, 1.0, 1.22);
    post.rotation.x = -0.32;
    g.add(post);
  }
  // Sporty chrome grab-rail arch behind the console (wake-tower vibe).
  const archGeo = new THREE.TorusGeometry(0.52, 0.035, 8, 16, Math.PI);
  const arch = new THREE.Mesh(archGeo, chrome);
  arch.position.set(0, 1.3, -0.1); // default ring in X-Y spans the beam, crowning up
  g.add(arch);
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), chrome);
    foot.position.set(sx * 0.52, 1.05, -0.1);
    g.add(foot);
  }
  // Emissive nav lights: red to port (-X) and green to starboard (+X) up at the bow.
  const navRed = new THREE.MeshStandardMaterial({ color: "#ff5a4a", emissive: "#ff2a18", emissiveIntensity: 1.4, roughness: 0.4 });
  const navGreen = new THREE.MeshStandardMaterial({ color: "#5aff8a", emissive: "#12d64a", emissiveIntensity: 1.4, roughness: 0.4 });
  const navGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const portLight = new THREE.Mesh(navGeo, navRed);
  portLight.position.set(-0.42, 0.62, 2.25);
  g.add(portLight);
  const stbdLight = new THREE.Mesh(navGeo, navGreen);
  stbdLight.position.set(0.42, 0.62, 2.25);
  g.add(stbdLight);

  // Small wheel/helm hint inside the console.
  const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16), trim);
  helm.rotation.x = Math.PI / 2 - 0.3;
  helm.position.set(0, 0.95, 0.1);
  g.add(helm);

  // --- Tiny mast + flag aft, so the silhouette has a vertical accent ---
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 8), trim);
  mast.position.set(0, 1.4, -1.7);
  g.add(mast);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshStandardMaterial({ color: "#e23b2e", roughness: 0.7, side: THREE.DoubleSide }));
  flag.position.set(0.27, 2.0, -1.7);
  g.add(flag);

  // Transom + small outboard motor at the stern (-Z).
  const transom = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 0.2), hullPaint);
  transom.position.set(0, 0.1, -2.15);
  g.add(transom);
  const outboard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.5), trim);
  outboard.position.set(0, 0.05, -2.45);
  g.add(outboard);
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8), trim);
  prop.rotation.x = Math.PI / 2;
  prop.position.set(0, -0.35, -2.5);
  g.add(prop);

  // Upholstered bolster seats in the cockpit: a cushioned base + a raked backrest.
  for (const dz of [-0.7, -1.45]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.16, 0.5), cushion);
    base.position.set(0, 0.68, dz);
    g.add(base);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.4, 0.12), cushion);
    backrest.position.set(0, 0.9, dz - 0.24);
    backrest.rotation.x = 0.18;
    g.add(backrest);
  }

  // Swim platform off the transom + a boarding rail (chrome).
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.55), deckMat);
  platform.position.set(0, 0.34, -2.45);
  g.add(platform);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), chrome);
    post.position.set(sx * 0.7, 0.54, -2.4);
    g.add(post);
  }

  // Chrome mooring cleats along the gunwales.
  for (const sx of [-1, 1]) {
    for (const cz of [1.4, -1.5]) {
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.06), chrome);
      cleat.position.set(sx * 0.9, 0.66, cz);
      g.add(cleat);
    }
  }

  // --- WAKE hint: two thin foam quads trailing aft, opacity/scale tweened in
  // drive() with speed. Built once, near-invisible at rest, never reallocated.
  // Laid flat on the water (rotated to the XZ plane) just behind the transom. ---
  const wakeMatL = new THREE.MeshBasicMaterial({ color: "#eaf6ff", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const wakeMatR = new THREE.MeshBasicMaterial({ color: "#eaf6ff", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const wakeGeo = new THREE.PlaneGeometry(0.5, 3.0);
  const wakeL = new THREE.Mesh(wakeGeo, wakeMatL);
  const wakeR = new THREE.Mesh(wakeGeo, wakeMatR);
  for (const [w, sx] of [[wakeL, -1], [wakeR, 1]]) {
    w.rotation.x = -Math.PI / 2;          // lie flat on the sea surface
    w.rotation.z = sx * 0.16;             // fan outward into a V behind the stern
    w.position.set(sx * 0.5, 0.01, -3.4); // just aft of the transom, on the waterline
    w.renderOrder = 2;
    g.add(w);
  }

  // --- NOS jet (stern): twin flame cones behind the outboard that flare out the
  // back while boosting. Hidden at rest; drive() flickers their opacity/length +
  // tints them (blue normal, orange EXTREME). One shared material, no per-frame alloc.
  const nosMat = new THREE.MeshBasicMaterial({ color: "#7fdfff", transparent: true, opacity: 0, depthWrite: false });
  const nosGeo = new THREE.ConeGeometry(0.16, 1.1, 12);
  const nosFlames = [];
  for (const nx of [-0.32, 0.32]) {
    const fl = new THREE.Mesh(nosGeo, nosMat);
    fl.rotation.x = -Math.PI / 2; // cone apex points astern (-Z)
    fl.position.set(nx, -0.05, -2.75);
    fl.visible = false;
    g.add(fl);
    nosFlames.push(fl);
  }

  // Stash refs for drive() to mutate with zero per-frame allocation.
  g.userData.wake = { wakeL, wakeR, wakeMatL, wakeMatR };
  g.userData.prop = prop;
  g.userData.flag = flag;
  g.userData.nos = { flames: nosFlames, mat: nosMat };
  return g;
}

export function makeBoat(opts = {}) {
  const spawn = opts.spawn || {};
  const waterY = opts.waterY ?? 0;
  const group = buildBoatGroup();

  const state = {
    x: spawn.x ?? 0,
    z: spawn.z ?? 0,
    heading: spawn.heading ?? 0,
    speed: 0,
    waterY,
    nos: 1,          // NOS tank, 0..1 (full at spawn) — read by the HUD gauge
    boosting: false, // true while NOS is actively firing — read by the HUD gauge
  };
  group.position.set(state.x, waterY, state.z);
  group.rotation.y = state.heading;

  // Cached scratch — reused every frame so drive()/updateCamera() never `new`.
  const _camPos = new THREE.Vector3();
  const _camLook = new THREE.Vector3();
  let _camInit = false;
  let _baseYaw = 0;      // orbit-yaw captured on (re)board so free-look starts behind the boat
  let _nosEmpty = false; // latched true when the tank bottoms out; cleared once it refills past NOS.rearm
  const _nos = group.userData.nos;

  // Idle bob/roll phase accumulator + a smoothed heel (bank into turns).
  let _bobT = Math.random() * Math.PI * 2; // desync multiple boats' bobbing
  let _heel = 0;

  const _wake = group.userData.wake;
  const _prop = group.userData.prop;
  const _flag = group.userData.flag;

  // Copy state -> group transform. The bob/roll/heel offsets are layered on in
  // drive(); syncGroup writes only the authoritative XZ/heading (used by both the
  // local drive() and the remote mirror via syncGroup(otherGroup)).
  function syncGroup(g) {
    const t = g || group;
    t.position.x = state.x;
    t.position.z = state.z;
    t.rotation.y = state.heading;
    if (!g) t.position.y = waterY; // local boat: keep base height; bob added in drive()
  }

  // Advance one physics step.
  //   dt        seconds
  //   throttle  -1..1  (forward / reverse)
  //   steer     -1..1  (left / right)
  //   isWater   (x,z) -> bool : true where the boat may float. A move whose target
  //             is NOT water is rejected (we try to slide along one axis, else stop)
  //             so you can never sail onto land, a dock, or an island.
  function drive(dt, throttle, steer, isWater, boost) {
    throttle = throttle || 0;
    steer = steer || 0;
    boost = boost || 0; // 0|1|2 NOS level (Shift / Shift+Ctrl while sailing)

    // --- NOS boost (mirrors the car): Shift (1) / Shift+Ctrl (2) while throttling
    // FORWARD burns the tank for extra top speed + thrust; otherwise it slowly
    // refills. Never fires without throttle or with an empty tank, and once empty it
    // must refill past NOS.rearm before it re-arms. ---
    if (state.nos <= 0.001) _nosEmpty = true;
    if (state.nos >= NOS.rearm) _nosEmpty = false;
    const boosting = boost > 0 && throttle > 0 && !_nosEmpty && state.nos > 0;
    state.boosting = boosting;
    let maxSpeed = BOAT.maxSpeed;
    let accel = BOAT.accel;
    if (boosting) {
      const mult = boost >= 2 ? NOS.mult2 : NOS.mult1;
      maxSpeed *= mult;
      accel *= mult;
      state.nos = Math.max(0, state.nos - (boost >= 2 ? NOS.drain2 : NOS.drain1) * dt);
    } else {
      state.nos = Math.min(1, state.nos + NOS.regen * dt);
    }

    // --- Longitudinal: thrust, astern, and a long gliding drag when coasting ---
    if (throttle > 0) {
      state.speed += accel * throttle * dt;
    } else if (throttle < 0) {
      if (state.speed > 0.1) {
        // Reversing throttle while still moving forward = engine brake-ish drag.
        state.speed -= BOAT.brakeDrag * dt;
      } else {
        state.speed += BOAT.reverseAccel * throttle * dt;
      }
    } else {
      // Coast: water drag bleeds speed toward zero — gentle, gliding (not snappy).
      const f = BOAT.waterDrag * dt;
      if (state.speed > 0) state.speed = Math.max(0, state.speed - f);
      else if (state.speed < 0) state.speed = Math.min(0, state.speed + f);
    }
    state.speed = Math.max(-BOAT.maxReverse, Math.min(maxSpeed, state.speed));

    // --- Steering: lazy, and only effective with way on. Authority ramps up with
    // speed (you can't turn a stopped boat), and reverses going astern. ---
    if (Math.abs(state.speed) > 0.04) {
      const grip = Math.min(1, Math.abs(state.speed) / BOAT.turnGripSpeed);
      state.heading -= steer * BOAT.turnRate * dt * grip * Math.sign(state.speed);
    }

    // --- Integrate proposed position ---
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    const dx = fx * state.speed * dt;
    const dz = fz * state.speed * dt;
    let nx = state.x + dx;
    let nz = state.z + dz;

    // --- Water constraint: the target (and a little clearance ahead) must be water.
    // If the full move leaves the water, try to slide along whichever single axis
    // stays wet (so you graze a shoreline instead of sticking); if neither works,
    // stop dead and kill speed (you've run aground). ---
    if (isWater) {
      // Sample slightly beyond the hull centre along travel so we don't clip the bow
      // into land before stopping.
      const cl = BOAT.radius;
      const aheadX = nx + fx * cl;
      const aheadZ = nz + fz * cl;
      if (!isWater(aheadX, aheadZ) || !isWater(nx, nz)) {
        const wetX = isWater(state.x + dx + fx * cl, state.z) && isWater(state.x + dx, state.z);
        const wetZ = isWater(state.x, state.z + dz + fz * cl) && isWater(state.x, state.z + dz);
        if (wetX && !wetZ) {
          nz = state.z;            // slide along X only
          state.speed *= 0.85;
        } else if (wetZ && !wetX) {
          nx = state.x;            // slide along Z only
          state.speed *= 0.85;
        } else {
          // Ran aground — stop and bleed almost all way off.
          nx = state.x;
          nz = state.z;
          state.speed *= 0.1;
          if (Math.abs(state.speed) < 0.05) state.speed = 0;
        }
      }
    }

    state.x = nx;
    state.z = nz;

    // --- Write authoritative transform, then layer idle bob/roll + turn heel on
    // top (visual only; these never feed back into state.x/z/heading). ---
    group.position.x = state.x;
    group.position.z = state.z;
    group.rotation.y = state.heading;

    _bobT += dt;
    const moveScale = 1 + Math.min(1.5, Math.abs(state.speed) / BOAT.maxSpeed); // bob harder underway
    const bob = Math.sin(_bobT * BOAT.bobRate) * BOAT.bobAmp * moveScale;
    group.position.y = waterY + bob;

    // Heel: ease toward a bank set by steer*speed; gentle idle roll added on top.
    const targetHeel = -steer * Math.min(1, Math.abs(state.speed) / BOAT.maxSpeed) * (state.speed >= 0 ? 1 : -1) * BOAT.heelPerSpeed * 18;
    _heel += (targetHeel - _heel) * Math.min(1, dt * 3);
    const idleRoll = Math.sin(_bobT * BOAT.rollRate + 0.7) * BOAT.rollAmp;
    group.rotation.z = idleRoll + _heel;
    // A touch of pitch as the bow rises with speed.
    group.rotation.x = -Math.min(0.06, Math.abs(state.speed) / BOAT.maxSpeed * 0.06) * Math.sign(state.speed || 1);

    // Spin the prop + flutter the flag for life.
    if (_prop) _prop.rotation.y += (0.4 + Math.abs(state.speed)) * dt * 6;
    if (_flag) _flag.rotation.y = Math.sin(_bobT * 4) * 0.25;

    // --- WAKE: fade + stretch the two foam quads with forward speed; hidden at
    // rest and when reversing. Mutates cached materials/meshes in place. ---
    if (_wake) {
      const spd = Math.max(0, state.speed); // only a forward wake
      const f = Math.min(1, spd / BOAT.maxSpeed);
      const op = f * 0.5;
      _wake.wakeMatL.opacity = op;
      _wake.wakeMatR.opacity = op;
      const len = 1 + f * 1.6;    // stretch the foam tail as you speed up
      const wide = 1 + f * 0.8;
      _wake.wakeL.scale.set(wide, len, 1);
      _wake.wakeR.scale.set(wide, len, 1);
    }

    // --- NOS flames: flicker + stretch the twin stern cones while boosting, tinted
    // blue (level 1) or orange (EXTREME level 2). Mutates shared refs in place. ---
    if (_nos) {
      if (boosting) {
        const flicker = 0.75 + Math.random() * 0.25;
        _nos.mat.opacity = 0.85 * flicker;
        _nos.mat.color.setHex(boost >= 2 ? 0xff7a3c : 0x7fdfff);
        const flen = (boost >= 2 ? 1.7 : 1.1) * flicker;
        for (const fl of _nos.flames) {
          fl.visible = true;
          fl.scale.set(1, flen, 1);
        }
      } else if (_nos.flames[0].visible) {
        for (const fl of _nos.flames) fl.visible = false;
      }
    }
  }

  // Trailing chase camera behind the boat — same easing model as the car, just a
  // higher/longer vantage and lazier ease for a calmer "on the water" feel. With
  // free-look, controls.orbit.yaw swings the chase angle around the boat and
  // controls.orbit.pitch raises/lowers it (offset HELD, no auto-recenter); when
  // `controls` is absent it falls back to the old fixed behind-the-boat chase.
  function updateCamera(camera, dt, controls) {
    // Free-look offsets from the mouse-drag orbit (baseline captured on board so the
    // view starts directly astern); pitch rides the orbit pitch (clamped in controls).
    let yawOff = 0;
    let pitch = BOAT.camBasePitch;
    if (controls && controls.orbit) {
      if (!_camInit) _baseYaw = controls.orbit.yaw;
      yawOff = controls.orbit.yaw - _baseYaw;
      pitch = Math.max(BOAT.camMinPitch, Math.min(BOAT.camMaxPitch, controls.orbit.pitch));
    }
    const ang = state.heading + yawOff;
    const sa = Math.sin(ang);
    const ca = Math.cos(ang);
    const horiz = BOAT.camDist * Math.cos(pitch);
    const vert = BOAT.camDist * Math.sin(pitch);
    _camPos.set(state.x - sa * horiz, waterY + vert + BOAT.camLook, state.z - ca * horiz);
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    _camLook.set(state.x + fx * 2.0, waterY + BOAT.camLook, state.z + fz * 2.0);
    if (!_camInit) {
      camera.position.copy(_camPos);
      _camInit = true;
    }
    const k = Math.min(1, dt * BOAT.camEase);
    camera.position.lerp(_camPos, k);
    camera.lookAt(_camLook);
  }

  // Snap the chase cam behind the boat next frame (called when you board).
  function resetCamera() {
    _camInit = false;
  }

  // Current AABB footprint on XZ (padded square around the hull centre).
  function footprint() {
    const pad = 2.4;
    return { minX: state.x - pad, maxX: state.x + pad, minZ: state.z - pad, maxZ: state.z + pad };
  }

  // Where to step ashore when you disembark. Given the ocean's docks
  // [{x,z}, ...], return the nearest dock; if none provided, fall back to a point
  // just beside the hull (the boat's port side) at the current heading.
  function exitSpot(docks) {
    if (docks && docks.length) {
      let best = docks[0];
      let bestD = Infinity;
      for (const d of docks) {
        const dd = (d.x - state.x) ** 2 + (d.z - state.z) ** 2;
        if (dd < bestD) { bestD = dd; best = d; }
      }
      return { x: best.x, z: best.z, facing: Math.atan2(state.x - best.x, state.z - best.z) };
    }
    // Fallback: beside the hull on the port (left) side.
    const lx = Math.cos(state.heading);
    const lz = -Math.sin(state.heading);
    return { x: state.x + lx * 2.2, z: state.z + lz * 2.2, facing: state.heading + Math.PI / 2 };
  }

  function distanceTo(x, z) {
    return Math.hypot(state.x - x, state.z - z);
  }

  return { group, state, drive, updateCamera, resetCamera, footprint, exitSpot, distanceTo, syncGroup };
}
