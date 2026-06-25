// A small rideable low-poly PROP PLANE — the "steal a plane" toy. It owns its own
// geometry (tube fuselage + nose spinner prop, swept wings with engine pods, a
// tail fin + horizontal stabilisers, a glass cockpit canopy, retractable landing
// gear), an arcade flight model (taxi -> build airspeed -> rotate off the runway
// at takeoff speed -> climb/cruise/descend vs a soft stall), banking/pitching
// attitude, and a cinematic chase camera that cranes back and up with speed +
// altitude. It deliberately MIRRORS the car/boat/rocket vehicle API
// (group/state/drive/updateCamera/resetCamera/footprint/exitSpot/distanceTo/
// syncGroup) so rides.js can pilot it like the other vehicles. drive()'s signature
// matches the boat/rocket: (dt, throttle, steer, ctx) where throttle is the engine
// (build forward airspeed -> lift -> climb) and steer is yaw (+ a visual bank/roll
// and climb/descend pitch). ctx may carry { maxAltitude } as the flight ceiling.
//
// All hot paths (drive / updateCamera) are allocation-free: every `new` lives in
// the build step (run once from makeAirplane), and the per-frame code only mutates
// cached refs (prop spinner, gear group, group transform) + two scratch Vector3s
// and a handful of closure number/bool vars.

import * as THREE from "three";

const AIRPLANE = {
  // --- Longitudinal airspeed (along heading) ---
  accel: 12.0,          // m/s^2 thrust at full throttle
  reverseAccel: 4.0,    // m/s^2 slow reverse taxi (pushback) on the ground
  brake: 16.0,          // m/s^2 wheel brakes when throttle<0 rolling forward on the ground
  airDrag: 2.2,         // airspeed bleed when coasting (idle throttle)
  cutDrag: 5.0,         // extra bleed when actively pulling throttle back aloft (airbrake)
  maxSpeed: 46.0,       // m/s top airspeed
  maxReverse: 2.5,      // m/s reverse taxi cap
  // --- Lift / vertical / altitude ---
  takeoffSpeed: 14.0,   // m/s — at/above this (with throttle up) the wheels leave the runway
  stallSpeed: 9.0,      // m/s — below this aloft the wings lose lift and you sink (stall)
  climbRate: 15.0,      // m/s max climb rate at full throttle
  sinkRate: 11.0,       // m/s reference sink rate at idle/airbrake
  vEase: 1.7,           // how fast vertical speed eases toward its target /s (smooth rotate/flare)
  flareAlt: 14.0,       // m — below this the sink is softened for a gentle touchdown
  defaultMaxAlt: 200,   // ceiling (m) when ctx.maxAltitude is not supplied
  groundedAlt: 0.4,     // altitude (m) under which we count as "on the runway"
  groundClearance: 1.0, // fuselage centreline sits this high so the gear wheels meet y=0
  gearUpAlt: 5.0,       // retract the gear once climbing past this altitude
  // --- Steering / attitude ---
  yawRate: 0.95,        // rad/s yaw authority at full rudder (scaled by airspeed grip)
  turnGripSpeed: 16.0,  // airspeed at which steering reaches full authority
  bankMax: 0.62,        // max roll (rad) banked into a turn
  pitchMax: 0.34,       // max pitch (rad) nose-up climbing / nose-down diving
  attEase: 3.0,         // attitude (roll/pitch) smoothing /s
  // --- Prop ---
  propIdle: 6.0,        // rad/s spinner idle spin
  propGain: 60.0,       // rad/s extra spin per unit throttle
  // --- Chase camera (cranes back + up with speed AND altitude) ---
  camBack: 12.0,
  camHeight: 4.6,
  camLook: 2.0,
  camEase: 3.0,
  camBackPerSpeed: 0.18, camBackPerAlt: 0.10, camBackMax: 26,
  camUpPerSpeed: 0.05,   camUpPerAlt: 0.10,   camUpMax: 20,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.5,
    metalness: opts.metal ?? 0.3,
    emissive: opts.emissive || "#000000",
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

// Build the plane group. Forward is +Z local (heading 0 faces +Z, so forward =
// (sin(h), 0, cos(h)) — matching the player/car/boat/rocket convention). The local
// origin sits on the fuselage centreline; the gear hangs down to y=-groundClearance
// so the wheels meet the world ground (makeAirplane parks the group at
// y=groundClearance when landed). Nose (+Z) carries the spinner prop; tail (-Z)
// the fin. Wingspan ~8 (±4). Dynamic refs (prop spinner, gear group) are stashed on
// userData so drive() can spin/retract them with zero per-frame allocation.
function buildAirplaneGroup() {
  const g = new THREE.Group();

  const skin = mat("#e9eef3", { rough: 0.4, metal: 0.35 });   // bright fuselage/wings
  const accent = mat("#d23b34", { rough: 0.45, metal: 0.3 }); // red cheat-line / tail
  const accentB = mat("#1d6fb8", { rough: 0.45, metal: 0.3 });// blue trim
  const darkMetal = mat("#2a2e36", { rough: 0.55, metal: 0.6 });
  const chrome = mat("#cfd4da", { rough: 0.22, metal: 0.9 });
  const rubber = mat("#0c0c10", { rough: 0.92, metal: 0.05 });
  const glass = new THREE.MeshStandardMaterial({ color: "#163b52", roughness: 0.08, metalness: 0.85, transparent: true, opacity: 0.72, emissive: "#0a1f30", emissiveIntensity: 0.3 });
  const EP = 0.012;

  // --- Fuselage: a tube along Z (axis rotated onto +Z), spanning z -3.0..3.0 ---
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.5, 6.0, 22), skin);
  fuse.rotation.x = Math.PI / 2;     // lay the cylinder axis along Z
  fuse.castShadow = true; fuse.receiveShadow = true;
  g.add(fuse);
  // Tapered nose cone (apex +Z) housing the engine; tail cone tapering to the fin.
  const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 22), skin);
  noseCone.rotation.x = Math.PI / 2; // apex toward +Z
  noseCone.position.z = 3.55;
  noseCone.castShadow = true;
  g.add(noseCone);
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 20), skin);
  tailCone.rotation.x = -Math.PI / 2; // apex toward -Z
  tailCone.position.z = -3.7;
  g.add(tailCone);
  // Red cheat-line along each flank, just proud of the skin.
  for (const sx of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 5.4), accent);
    line.position.set(sx * (0.5 + EP), 0.08, -0.1);
    g.add(line);
  }

  // --- Cockpit canopy: a glass bubble up front, set into the spine ---
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12), glass);
  canopy.scale.set(0.85, 0.7, 1.5);
  canopy.position.set(0, 0.45, 1.25);
  g.add(canopy);
  // A thin frame fairing behind the canopy for a faired-in spine.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 1.6), skin);
  spine.position.set(0, 0.42, 0.1);
  g.add(spine);

  // --- Main wings: swept-back halves with a touch of dihedral + engine pods ---
  // Each wing is a thin slab pinned at the root, swept aft (rotation.y) and lifted
  // at the tip (rotation.z dihedral). Mounted low-mid on the fuselage near z~0.3.
  const wingMat = skin;
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.14, 1.5), wingMat);
    wing.castShadow = true;
    // Root meets the fuselage; centre pushed out to ~±2.1 so the inner edge tucks in.
    wing.position.set(sx * 2.1, -0.12, 0.25);
    wing.rotation.y = sx * 0.26;   // sweep the leading edge aft
    wing.rotation.z = sx * -0.06;  // gentle upward dihedral
    g.add(wing);
    // Blue wingtip cap for a little pop + a nav-light feel.
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 1.0), accentB);
    tip.position.set(sx * 3.85, -0.04, -0.05);
    tip.rotation.y = sx * 0.26;
    g.add(tip);
    // Under-wing engine pod (a second pair of engines, twin-style) with an intake.
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.0, 14), darkMetal);
    pod.rotation.x = Math.PI / 2;  // axis along Z
    pod.position.set(sx * 2.0, -0.34, 0.55);
    pod.castShadow = true;
    g.add(pod);
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.12, 14), chrome);
    intake.rotation.x = Math.PI / 2;
    intake.position.set(sx * 2.0, -0.34, 1.06);
    g.add(intake);
  }

  // --- Tail: vertical fin + two horizontal stabilisers at the tail cone ---
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 1.2), accent);
  fin.castShadow = true;
  fin.position.set(0, 0.62, -3.35);
  fin.rotation.x = 0.32; // sweep the fin back
  g.add(fin);
  for (const sx of [-1, 1]) {
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.7), skin);
    stab.position.set(sx * 0.85, 0.18, -3.45);
    stab.rotation.y = sx * 0.16;
    g.add(stab);
  }

  // --- Nose spinner PROP: a hub cone + 3 blades, wrapped in a group that spins
  // about the forward (Z) axis. The disc lies in the XY plane at the nose tip;
  // drive() advances propGroup.rotation.z so the prop blurs with throttle. ---
  const propGroup = new THREE.Group();
  propGroup.position.set(0, 0, 4.05);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 12), chrome);
  spinner.rotation.x = Math.PI / 2; // point the spinner +Z
  spinner.position.z = 0.18;
  propGroup.add(spinner);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.7, 0.05), darkMetal);
    blade.rotation.z = (i / 3) * Math.PI * 2; // fan the 3 blades around the hub
    propGroup.add(blade);
  }
  g.add(propGroup);

  // --- Landing gear: two main wheels under the wings + a nose wheel. Grouped so
  // drive() can retract (hide) the whole set once airborne. Wheel centres at
  // y=-0.7, radius 0.3 -> wheel bottoms at y=-1.0 == -groundClearance. ---
  const gearGroup = new THREE.Group();
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 14);
  function makeGear(px, pz, strutLen) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, strutLen, 0.08), darkMetal);
    strut.position.set(px, -0.5 - strutLen / 2 + 0.2, pz);
    gearGroup.add(strut);
    const wheel = new THREE.Mesh(wheelGeo, rubber);
    wheel.rotation.z = Math.PI / 2; // axle along X
    wheel.position.set(px, -0.7, pz);
    wheel.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8), chrome);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(px, -0.7, pz);
    gearGroup.add(wheel);
    gearGroup.add(hub);
  }
  makeGear(-1.3, 0.4, 0.45);  // left main
  makeGear(1.3, 0.4, 0.45);   // right main
  makeGear(0, 2.4, 0.4);      // nose wheel
  g.add(gearGroup);

  g.userData.dyn = { prop: propGroup, gear: gearGroup };
  return g;
}

export function makeAirplane(opts = {}) {
  const spawn = opts.spawn || {};
  const baseY = AIRPLANE.groundClearance; // wheels meet y=0 when landed

  const group = buildAirplaneGroup();
  const dyn = group.userData.dyn;

  // Authoritative state — public surface mirrors car/boat/rocket (speed/heading)
  // plus the flight-specific altitude/airborne fields.
  const state = {
    x: spawn.x ?? 0,
    z: spawn.z ?? 0,
    heading: spawn.heading ?? 0,
    speed: 0,          // forward airspeed (m/s) — what the drive HUD shows
    altitude: 0,       // metres above the runway (y=0)
    airborne: false,   // false = wheels on the runway (taxi), true = in flight
  };

  // Internal physics scratch (closure numbers/bools — never reallocated).
  let vy = 0;            // vertical speed (m/s)
  let _roll = 0, _pitch = 0; // smoothed visual attitude
  let _propSpin = 0;    // accumulated prop angle

  // Cached camera scratch.
  const _camPos = new THREE.Vector3();
  const _camLook = new THREE.Vector3();
  let _camInit = false;

  group.position.set(state.x, baseY, state.z);
  group.rotation.y = state.heading;

  // Copy authoritative state -> a group transform. Used for the local plane (g
  // omitted: keeps base+altitude Y) and the networked remote mirror (g given).
  function syncGroup(g) {
    const t = g || group;
    t.position.x = state.x;
    t.position.z = state.z;
    t.position.y = baseY + state.altitude;
    t.rotation.y = state.heading;
  }

  // Advance one flight step.
  //   dt        seconds
  //   throttle  -1..1  ENGINE: >0 builds forward airspeed (and, once fast enough,
  //             lift -> climb); 0 idles (coast + gentle descent aloft); <0 brakes on
  //             the runway / airbrakes + dives aloft.
  //   steer     -1..1  YAW (rudder) — scaled by airspeed, also drives the visual bank.
  //   ctx       optional { maxAltitude } ceiling. Other fields ignored.
  // Allocation-free.
  function drive(dt, throttle, steer, ctx) {
    throttle = throttle || 0;
    steer = steer || 0;
    const ceil = (ctx && ctx.maxAltitude) || AIRPLANE.defaultMaxAlt;

    // --- Longitudinal airspeed: thrust, runway brakes / reverse taxi, and drag ---
    if (throttle > 0) {
      state.speed += AIRPLANE.accel * throttle * dt;
    } else if (throttle < 0) {
      if (state.airborne) {
        // Throttle pulled back aloft = airbrake bleed (and you'll start to sink).
        state.speed -= AIRPLANE.cutDrag * dt;
      } else if (state.speed > 0.1) {
        state.speed -= AIRPLANE.brake * dt;            // wheel brakes
      } else {
        state.speed += AIRPLANE.reverseAccel * throttle * dt; // slow reverse taxi
      }
    } else {
      // Coast: aerodynamic drag bleeds airspeed toward zero.
      const f = AIRPLANE.airDrag * dt;
      if (state.speed > 0) state.speed = Math.max(0, state.speed - f);
      else if (state.speed < 0) state.speed = Math.min(0, state.speed + f);
    }
    const minSpeed = state.airborne ? 0 : -AIRPLANE.maxReverse; // no reverse in the air
    state.speed = clamp(state.speed, minSpeed, AIRPLANE.maxSpeed);

    // --- Takeoff: on the runway, hold altitude at 0 until we hit rotation speed
    // with the throttle up — then the wheels unstick and we're flying. ---
    if (!state.airborne) {
      state.altitude = 0;
      vy = 0;
      if (state.speed >= AIRPLANE.takeoffSpeed && throttle > 0.02) {
        state.airborne = true;
      }
    }

    // --- Vertical: pick a target climb/sink rate from airspeed + throttle, ease
    // toward it, integrate altitude, clamp to the ceiling, and detect touchdown. ---
    if (state.airborne) {
      let targetVy;
      if (state.speed < AIRPLANE.stallSpeed) {
        // Not enough airspeed for lift — stall: sink regardless of throttle.
        targetVy = -AIRPLANE.sinkRate * 0.8;
      } else if (throttle > 0) {
        targetVy = throttle * AIRPLANE.climbRate;          // climb under power
      } else {
        // Idle/airbrake glide: gentle at idle, steeper when actively pushing down.
        targetVy = -AIRPLANE.sinkRate * (0.45 - 0.55 * throttle); // throttle in [-1,0]
      }
      // Flare: soften the sink near the ground for a gentle touchdown.
      if (targetVy < 0 && state.altitude < AIRPLANE.flareAlt) {
        targetVy *= 0.25 + 0.75 * (state.altitude / AIRPLANE.flareAlt);
      }
      vy += (targetVy - vy) * Math.min(1, dt * AIRPLANE.vEase);
      state.altitude += vy * dt;

      // Ceiling: clamp + cancel any remaining climb so you cruise at the top.
      if (state.altitude >= ceil) {
        state.altitude = ceil;
        if (vy > 0) vy = 0;
      }
      // Touchdown: settle back onto the runway, ready to taxi / take off again.
      if (state.altitude <= 0) {
        state.altitude = 0;
        if (vy < 0) vy = 0;
        state.airborne = false;
      }
    }

    // --- Yaw: rudder authority ramps up with airspeed (you can't steer a parked
    // plane); effective both taxiing (nosewheel) and aloft. ---
    if (Math.abs(state.speed) > 0.05) {
      const grip = Math.min(1, Math.abs(state.speed) / AIRPLANE.turnGripSpeed);
      state.heading -= steer * AIRPLANE.yawRate * dt * grip * Math.sign(state.speed);
    }

    // --- Integrate position along the heading ---
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    state.x += fx * state.speed * dt;
    state.z += fz * state.speed * dt;

    // --- Write the transform: authoritative XZ/heading + altitude, then layer the
    // visual bank (roll into yaw) + pitch (nose up/down with climb) on top. These
    // are eased and never feed back into state. ---
    group.position.x = state.x;
    group.position.z = state.z;
    group.position.y = baseY + state.altitude;
    group.rotation.y = state.heading;

    const grip = Math.min(1, Math.abs(state.speed) / AIRPLANE.turnGripSpeed);
    const targetRoll = state.airborne ? -steer * AIRPLANE.bankMax * grip : 0;
    // Nose pitches up while climbing (vy>0 -> negative rotation.x), down while diving.
    const targetPitch = state.airborne
      ? -clamp(vy / AIRPLANE.climbRate, -1, 1) * AIRPLANE.pitchMax
      : 0;
    const k = Math.min(1, dt * AIRPLANE.attEase);
    _roll += (targetRoll - _roll) * k;
    _pitch += (targetPitch - _pitch) * k;
    group.rotation.z = _roll;
    group.rotation.x = _pitch;

    // --- Prop: spin faster with throttle (always idling), and retract the gear
    // once we've climbed away. Both mutate cached refs in place (no alloc). ---
    _propSpin += (AIRPLANE.propIdle + AIRPLANE.propGain * Math.max(0, throttle)) * dt;
    if (dyn.prop) dyn.prop.rotation.z = _propSpin;
    if (dyn.gear) dyn.gear.visible = state.altitude < AIRPLANE.gearUpAlt;
  }

  // Cinematic chase camera: trails behind the heading and cranes further back and
  // higher with both airspeed and altitude, so a takeoff reads as the camera
  // craning up to keep the climbing plane in frame.
  function updateCamera(camera, dt) {
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    const sp = Math.abs(state.speed);
    const alt = state.altitude;
    const back = AIRPLANE.camBack + Math.min(AIRPLANE.camBackMax, sp * AIRPLANE.camBackPerSpeed + alt * AIRPLANE.camBackPerAlt);
    const up = AIRPLANE.camHeight + Math.min(AIRPLANE.camUpMax, sp * AIRPLANE.camUpPerSpeed + alt * AIRPLANE.camUpPerAlt);
    _camPos.set(state.x - fx * back, baseY + alt + up, state.z - fz * back);
    _camLook.set(state.x + fx * 4.0, baseY + alt + AIRPLANE.camLook, state.z + fz * 4.0);
    if (!_camInit) {
      camera.position.copy(_camPos);
      _camInit = true;
    }
    const k = Math.min(1, dt * AIRPLANE.camEase);
    camera.position.lerp(_camPos, k);
    camera.lookAt(_camLook);
  }

  // Snap the chase cam behind the plane next frame (called when you board).
  function resetCamera() {
    _camInit = false;
  }

  // AABB footprint on XZ (padded square around the fuselage centre, sized to the
  // wingspan) for the static-collider system — registered while parked so you can't
  // walk through it.
  function footprint() {
    const pad = 4.4;
    return { minX: state.x - pad, maxX: state.x + pad, minZ: state.z - pad, maxZ: state.z + pad };
  }

  // Where to put the player when they disembark: beside the plane (its left wing),
  // on the ground when landed. At altitude an eject point beside the hull at the
  // current height is returned (y included) so the caller can place an aerial exit;
  // grounded exits sit at y=0.
  function exitSpot() {
    const lx = Math.cos(state.heading);  // plane's left vector
    const lz = -Math.sin(state.heading);
    const grounded = state.altitude < AIRPLANE.groundedAlt;
    if (grounded) {
      return { x: state.x + lx * 4.6, z: state.z + lz * 4.6, facing: state.heading + Math.PI / 2, y: 0 };
    }
    return { x: state.x + lx * 4.0, z: state.z + lz * 4.0, facing: state.heading + Math.PI / 2, y: baseY + state.altitude };
  }

  function distanceTo(x, z) {
    return Math.hypot(state.x - x, state.z - z);
  }

  return { group, state, drive, updateCamera, resetCamera, footprint, exitSpot, distanceTo, syncGroup };
}
