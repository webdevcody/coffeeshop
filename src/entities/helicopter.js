// A low-poly rideable HELICOPTER — a true VTOL toy. It owns its own geometry
// (a rounded cabin with a glass canopy, a tapered tail boom + fin/stabilisers,
// a spinning MAIN rotor on a mast up top, a spinning TAIL rotor on the boom, and
// landing skids), an arcade flight model (collective lift -> rise / hover /
// descend, tail-rotor YAW, and a tilt-into-drift that flies it in any direction),
// always-spinning rotors, a gentle idle sway on the skids, and a chase camera
// that frames the heli and leans into its motion. It deliberately MIRRORS the
// car/boat/rocket API (group / state / drive / updateCamera / resetCamera /
// footprint / exitSpot / distanceTo / syncGroup) so rides.js can pilot it like
// the other vehicles.
//
// drive()'s signature matches the rocket: (dt, throttle, steer, ctx).
//   throttle  -1..1  COLLECTIVE — vertical lift. >0 climbs, <0 descends, 0 HOVERS
//                    (rotor thrust balances gravity at neutral, so it just hangs).
//   steer     -1..1  YAW via the tail rotor (only bites once airborne).
//   ctx               optional { maxAltitude, forward, strafe }:
//                       maxAltitude — altitude ceiling (default ~200).
//                       forward     — optional -1..1 cyclic pitch: tilts the nose
//                                     and DRIFTS the heli forward/back.
//                       strafe      — optional -1..1 cyclic roll: lateral drift.
//                     forward/strafe are optional; with neither, the heli is a
//                     pure up/down/yaw hover machine (still a full VTOL).
//
// All hot paths (drive / updateCamera) are allocation-free: every `new` lives in
// the build step (run once from makeHelicopter), and the per-frame code only
// mutates cached refs (rotor groups, the body transform, two scratch Vector3s).

import * as THREE from "three";

const HELI = {
  // --- Flight model ---
  collectiveAccel: 13.0, // m/s^2 vertical accel at full collective (throttle = ±1)
  vDrag: 1.6,            // vertical velocity damping /s — eases vy back to 0 (hover)
  maxClimb: 14.0,        // m/s vertical speed cap (both up and down)
  yawRate: 1.7,          // rad/s yaw authority (tail rotor), airborne only
  driftAccel: 9.5,       // m/s^2 horizontal accel from a forward/lateral tilt
  maxDrift: 17.0,        // m/s horizontal drift cap
  hDrag: 1.25,           // horizontal velocity damping /s — bleeds drift back to hover
  defaultMaxAlt: 200,    // ceiling (m) when ctx.maxAltitude is not supplied
  groundedAlt: 0.4,      // altitude (m) below which we count as "on the skids"
  // --- Visual lean (eased) ---
  tiltMax: 0.34,         // max nose pitch (rad) into forward drift
  bankMax: 0.30,         // max body roll (rad) into lateral drift / yaw
  leanEase: 3.0,         // how fast the visual tilt chases its target /s
  // --- Idle sway on the skids ---
  swayAmp: 0.02,
  swayRate: 1.6,
  bobAmp: 0.015,
  // --- Rotor spin (always on; faster under positive collective for life) ---
  mainSpinBase: 30.0, mainSpinBoost: 14.0, // main rotor rad/s
  tailSpinBase: 46.0, tailSpinBoost: 18.0, // tail rotor rad/s
  // --- Chase camera (trails the heading; lifts a touch with altitude; leans the
  // look point into forward motion so a fast pass reads as the cam tilting along) ---
  camBack: 9.0,
  camHeight: 4.4,
  camLook: 1.6,
  camEase: 3.0,
  camUpPerAlt: 0.06, camUpMax: 14,
  camLeanPerDrift: 0.16, // forward look-offset (m) per m/s of forward drift
  camLeanMax: 5.0,
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

// Build the helicopter group. The local origin sits at GROUND level (y=0 = the
// bottom of the skids); the heli builds UPWARD along +Y. Heading is yaw about +Y,
// and "forward" (the nose / drift direction) is +Z local — forward = (sin(h), 0,
// cos(h)) — matching the player/car/boat/rocket convention so the same sin/cos
// heading math drives all the vehicles. The tail boom extends back along -Z.
// Dynamic refs (the two rotor groups) are stashed on userData so drive() can spin
// them with zero per-frame allocation.
function buildHeliGroup(bodyColor) {
  const g = new THREE.Group();

  const body = mat(bodyColor, { rough: 0.3, metal: 0.42 });        // glossy painted shell
  const accent = mat("#eef2f6", { rough: 0.4, metal: 0.25 });      // white trim stripe
  const darkMetal = mat("#262a32", { rough: 0.45, metal: 0.75 });  // rotors / fittings
  const skidMetal = mat("#3a3e46", { rough: 0.4, metal: 0.7 });    // landing skids
  const glass = new THREE.MeshStandardMaterial({ color: "#12324a", roughness: 0.05, metalness: 0.9, emissive: "#0a1f30", emissiveIntensity: 0.35 });
  const EP = 0.012;

  // --- Cabin: a rounded box body with a bubble canopy at the nose (+Z) ---
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.0, 1.7), body);
  cabin.position.set(0, 1.0, 0.0);
  cabin.castShadow = true; cabin.receiveShadow = true;
  g.add(cabin);

  // Glass canopy: a flattened sphere wrapping the front of the cabin.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.6, 18, 14), glass);
  canopy.scale.set(0.95, 0.82, 0.95);
  canopy.position.set(0, 1.02, 0.74);
  g.add(canopy);

  // A nose cap to round off the snout below the canopy.
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), body);
  nose.scale.set(1.05, 0.78, 0.85);
  nose.position.set(0, 0.82, 0.86);
  nose.castShadow = true;
  g.add(nose);

  // White trim stripe down the flanks, just proud of the skin.
  for (const sx of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 1.6), accent);
    stripe.position.set(sx * (0.575 + EP), 1.05, 0.0);
    g.add(stripe);
  }

  // Engine cowling hump on the roof, behind the rotor mast.
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 1.0), body);
  cowl.position.set(0, 1.6, -0.35);
  cowl.castShadow = true;
  g.add(cowl);

  // --- Tail boom: a tapered cylinder sweeping back (-Z), fat end at the body ---
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.08, 2.7, 12), body);
  boom.rotation.x = Math.PI / 2;     // lay the cylinder along Z (fat +Y end -> +Z)
  boom.position.set(0, 1.18, -1.95);
  boom.castShadow = true;
  g.add(boom);

  // Horizontal stabiliser + vertical fin near the tail.
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.42), body);
  hStab.position.set(0, 1.2, -2.85);
  g.add(hStab);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.66, 0.5), body);
  fin.position.set(0, 1.46, -3.05);
  fin.castShadow = true;
  g.add(fin);

  // --- Main rotor: a short mast + hub on the roof, then a spinning blade group.
  // The blade group is the only thing that turns (about +Y). Three slim blades
  // radiate from the hub via per-blade sub-groups so they fan out evenly. A faint
  // translucent disc sits in the rotor plane to read as motion blur. ---
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 10), darkMetal);
  mast.position.set(0, 1.95, -0.1);
  g.add(mast);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 12), darkMetal);
  hub.position.set(0, 2.16, -0.1);
  g.add(hub);

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 2.2, -0.1);
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 3) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 1.55), darkMetal);
    blade.position.z = 0.8;          // extend outward from the hub
    arm.add(blade);
    mainRotor.add(arm);
  }
  // Spinning-blur disc (faint) sitting just under the blades. Its opacity ramps a
  // touch with collective in drive() so a spun-up rotor reads as a stronger blur.
  const mainDiscMat = new THREE.MeshBasicMaterial({ color: "#cdd3da", transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.72, 32), mainDiscMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 2.18, -0.1);
  g.add(disc);
  g.add(mainRotor);

  // --- Tail rotor: a small hub + blades on the side of the fin, spinning in a
  // vertical disc about the LATERAL (X) axis. Two crossed blades read as a fan. ---
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.2, 1.46, -3.18);
  const tailHub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), darkMetal);
  tailHub.rotation.z = Math.PI / 2;  // hub axis along X
  tailRotor.add(tailHub);
  const tbA = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.62, 0.07), darkMetal); // along Y
  tailRotor.add(tbA);
  const tbB = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.62), darkMetal); // along Z
  tailRotor.add(tbB);
  g.add(tailRotor);
  // Tail rotor-blur disc (faint), in the rotor's vertical plane (faces ±X). Static;
  // opacity ramps with collective in drive() alongside the main disc.
  const tailDiscMat = new THREE.MeshBasicMaterial({ color: "#cdd3da", transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const tailDisc = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), tailDiscMat);
  tailDisc.rotation.y = Math.PI / 2; // spin plane about the lateral (X) axis
  tailDisc.position.set(0.2, 1.46, -3.18);
  g.add(tailDisc);

  // --- Landing skids: two longitudinal tubes + four splayed legs + cross struts ---
  for (const sx of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 10), skidMetal);
    skid.rotation.x = Math.PI / 2;   // run the tube fore-aft along Z
    skid.position.set(sx * 0.56, 0.12, -0.1);
    skid.castShadow = true;
    g.add(skid);
    // Two legs per side, splayed outward from the belly down to the skid.
    for (const dz of [0.55, -0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.08), skidMetal);
      leg.position.set(sx * 0.4, 0.36, dz);
      leg.rotation.z = sx * 0.32;    // splay so the skids sit wider than the belly
      leg.castShadow = true;
      g.add(leg);
    }
  }

  // --- Emissive nav/beacon lights (no scene lights added): a red anti-collision
  // beacon on the belly + tail fin, and green/red side lights on the nose. ---
  const navGeo = new THREE.SphereGeometry(0.06, 8, 6);
  const navRed = new THREE.MeshStandardMaterial({ color: "#ff5a4a", emissive: "#ff2410", emissiveIntensity: 1.7, roughness: 0.4 });
  const navGreen = new THREE.MeshStandardMaterial({ color: "#5aff8a", emissive: "#12d64a", emissiveIntensity: 1.6, roughness: 0.4 });
  const beaconBelly = new THREE.Mesh(navGeo, navRed);
  beaconBelly.position.set(0, 0.48, 0.1);
  g.add(beaconBelly);
  const beaconTail = new THREE.Mesh(navGeo, navRed);
  beaconTail.position.set(0, 1.78, -3.05);
  g.add(beaconTail);
  const noseR = new THREE.Mesh(navGeo, navRed);
  noseR.position.set(0.42, 0.82, 1.02);
  g.add(noseR);
  const noseG = new THREE.Mesh(navGeo, navGreen);
  noseG.position.set(-0.42, 0.82, 1.02);
  g.add(noseG);

  g.userData.dyn = { mainRotor, tailRotor, mainDiscMat, tailDiscMat };
  return g;
}

export function makeHelicopter(opts = {}) {
  const spawn = opts.spawn || {};
  const spawnY = spawn.y ?? 0;
  const baseY = spawnY;                 // skids rest on the ground at the spawn Y

  const group = buildHeliGroup(opts.color || "#2f7fb8");
  const dyn = group.userData.dyn;

  // Authoritative state (public surface mirrors car/boat/rocket: speed/heading +
  // the aircraft altitude/airborne flags).
  const state = {
    x: spawn.x ?? 0,
    z: spawn.z ?? 0,
    heading: spawn.heading ?? 0,
    speed: 0,          // overall velocity magnitude (m/s) — what the drive HUD shows
    altitude: 0,       // metres above the ground (baseY)
    airborne: false,   // false = on the skids, true = off the ground
  };

  // Internal physics scratch (closure vars — numbers/bools, never reallocated).
  let vy = 0;            // vertical velocity (m/s)
  let vx = 0, vz = 0;    // horizontal drift velocity (m/s, world)
  let _t = 0;            // time accumulator for sway / idle bob
  let _leanX = 0, _leanZ = 0; // smoothed visual pitch/roll
  let _driftFwd = 0;    // forward component of horizontal velocity (for the cam lean)

  // Cached camera scratch.
  const _camPos = new THREE.Vector3();
  const _camLook = new THREE.Vector3();
  let _camInit = false;

  group.position.set(state.x, baseY, state.z);
  group.rotation.y = state.heading;

  // Copy authoritative state -> a group transform. Used for the local heli
  // (g omitted) and for the networked remote mirror (g given). Visual tilt/sway is
  // layered on in drive() only; syncGroup writes just the authoritative pose.
  function syncGroup(g) {
    const t = g || group;
    t.position.x = state.x;
    t.position.z = state.z;
    t.position.y = baseY + state.altitude;
    t.rotation.y = state.heading;
  }

  // Advance one flight step. Allocation-free.
  //   dt        seconds
  //   throttle  -1..1  COLLECTIVE: vertical lift. >0 climb, <0 descend, 0 hover.
  //   steer     -1..1  YAW (tail rotor) — only bites once airborne.
  //   ctx       optional { maxAltitude, forward, strafe }. forward/strafe are the
  //             optional cyclic tilt axes that DRIFT the heli; both default to 0.
  function drive(dt, throttle, steer, ctx) {
    throttle = throttle || 0;
    steer = steer || 0;
    _t += dt;
    const ceil = (ctx && ctx.maxAltitude) || HELI.defaultMaxAlt;
    const fwdIn = (ctx && ctx.forward) || 0;   // optional forward/back cyclic tilt
    const strafeIn = (ctx && ctx.strafe) || 0; // optional lateral cyclic tilt

    // --- Vertical: collective adds vertical accel; damping eases vy back toward 0
    // so releasing the stick HOVERS (rotor thrust is modelled as exactly cancelling
    // gravity at neutral). Cap the climb/descent rate and integrate altitude. On the
    // ground a non-positive collective just keeps us parked on the skids. ---
    vy += HELI.collectiveAccel * throttle * dt;
    vy -= vy * HELI.vDrag * dt;
    vy = clamp(vy, -HELI.maxClimb, HELI.maxClimb);
    state.altitude += vy * dt;

    // Ceiling: clamp + cancel any remaining climb so you cruise at the top.
    if (state.altitude >= ceil) {
      state.altitude = ceil;
      if (vy > 0) vy = 0;
    }
    // Ground: settle onto the skids, kill the descent + any residual drift grip.
    if (state.altitude <= 0) {
      state.altitude = 0;
      if (vy < 0) vy = 0;
    }
    state.airborne = state.altitude > HELI.groundedAlt;

    // --- Yaw + horizontal drift: only meaningful once airborne (the skids hold it
    // on the ground). Steer swings the nose via the tail rotor; a forward/lateral
    // tilt accelerates the heli along its heading/right vectors; drag bleeds the
    // drift back to a hover when you let go. ---
    if (state.airborne) {
      state.heading -= steer * HELI.yawRate * dt;
      const fx = Math.sin(state.heading), fz = Math.cos(state.heading); // forward
      const rx = Math.cos(state.heading), rz = -Math.sin(state.heading); // right
      vx += (fx * fwdIn + rx * strafeIn) * HELI.driftAccel * dt;
      vz += (fz * fwdIn + rz * strafeIn) * HELI.driftAccel * dt;
      vx -= vx * HELI.hDrag * dt;
      vz -= vz * HELI.hDrag * dt;
      const hsp = Math.hypot(vx, vz);
      if (hsp > HELI.maxDrift) {
        const s = HELI.maxDrift / hsp;
        vx *= s; vz *= s;
      }
      state.x += vx * dt;
      state.z += vz * dt;
    } else {
      // On the skids: no sliding. Bleed any leftover drift quickly.
      vx -= vx * Math.min(1, dt * 8);
      vz -= vz * Math.min(1, dt * 8);
    }

    state.speed = Math.hypot(vx, vy, vz);

    // --- Write the transform: authoritative XZ/heading + altitude, then layer the
    // visual sway (on the skids) or tilt (aloft) on top (never feeds back to state). ---
    group.position.x = state.x;
    group.position.z = state.z;
    group.position.y = baseY + state.altitude;
    group.rotation.y = state.heading;

    // Forward/right velocity components — drive the pitch/roll lean + the cam lean.
    const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
    const rx = Math.cos(state.heading), rz = -Math.sin(state.heading);
    _driftFwd = vx * fx + vz * fz;
    const driftRight = vx * rx + vz * rz;

    if (!state.airborne) {
      // Idle sway + a faint bob while parked / hovering on the skids.
      group.rotation.z = Math.sin(_t * HELI.swayRate) * HELI.swayAmp;
      group.rotation.x = Math.cos(_t * HELI.swayRate * 0.85) * HELI.swayAmp * 0.6;
      group.position.y += Math.sin(_t * HELI.swayRate * 1.3) * HELI.bobAmp;
      _leanX = group.rotation.x; _leanZ = group.rotation.z;
    } else {
      // Pitch nose-down into forward drift; bank into lateral drift + the yaw input.
      const targetX = clamp(_driftFwd / HELI.maxDrift, -1, 1) * HELI.tiltMax;
      const targetZ = -clamp(driftRight / HELI.maxDrift, -1, 1) * HELI.bankMax + steer * HELI.bankMax * 0.45;
      const k = Math.min(1, dt * HELI.leanEase);
      _leanX += (targetX - _leanX) * k;
      _leanZ += (targetZ - _leanZ) * k;
      group.rotation.x = _leanX;
      group.rotation.z = _leanZ;
    }

    // --- Spin the rotors every frame (always alive; faster under positive lift). ---
    const lift = Math.max(0, throttle);
    dyn.mainRotor.rotation.y += (HELI.mainSpinBase + lift * HELI.mainSpinBoost) * dt;
    dyn.tailRotor.rotation.x += (HELI.tailSpinBase + lift * HELI.tailSpinBoost) * dt;
    // Rotor-blur discs strengthen a touch under positive collective (scalar only).
    if (dyn.mainDiscMat) dyn.mainDiscMat.opacity = 0.08 + 0.07 * lift;
    if (dyn.tailDiscMat) dyn.tailDiscMat.opacity = 0.08 + 0.07 * lift;
  }

  // Chase camera: trails behind the heading, hoisted a touch higher with altitude,
  // and with its look point pushed forward in proportion to forward drift so a fast
  // pass reads as the camera leaning/tilting along with the heli.
  function updateCamera(camera, dt) {
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    const up = HELI.camHeight + Math.min(HELI.camUpMax, state.altitude * HELI.camUpPerAlt);
    const lean = clamp(_driftFwd * HELI.camLeanPerDrift, -HELI.camLeanMax, HELI.camLeanMax);
    _camPos.set(state.x - fx * HELI.camBack, baseY + state.altitude + up, state.z - fz * HELI.camBack);
    _camLook.set(state.x + fx * (2.0 + lean), baseY + state.altitude + HELI.camLook, state.z + fz * (2.0 + lean));
    if (!_camInit) {
      camera.position.copy(_camPos);
      _camInit = true;
    }
    const k = Math.min(1, dt * HELI.camEase);
    camera.position.lerp(_camPos, k);
    camera.lookAt(_camLook);
  }

  // Snap the chase cam behind the heli next frame (called when you board).
  function resetCamera() {
    _camInit = false;
  }

  // Current AABB footprint on XZ (padded square around the skids) for the
  // static-collider system — registered while the heli is parked.
  function footprint() {
    const pad = 2.4;
    return { minX: state.x - pad, maxX: state.x + pad, minZ: state.z - pad, maxZ: state.z + pad };
  }

  // Where to put the player when they disembark: beside the skids (the heli's left
  // side). On the skids that's a ground point (y=0); aloft it's beside the hull at
  // the current height (an aerial step-off), mirroring the rocket.
  function exitSpot() {
    const lx = Math.cos(state.heading);  // heli's left vector
    const lz = -Math.sin(state.heading);
    const grounded = state.altitude < HELI.groundedAlt;
    const reach = 1.8;                   // just outboard of the skids
    if (grounded) {
      return { x: state.x + lx * reach, z: state.z + lz * reach, facing: state.heading + Math.PI / 2, y: 0 };
    }
    return { x: state.x + lx * reach, z: state.z + lz * reach, facing: state.heading + Math.PI / 2, y: baseY + state.altitude };
  }

  function distanceTo(x, z) {
    return Math.hypot(state.x - x, state.z - z);
  }

  return { group, state, drive, updateCamera, resetCamera, footprint, exitSpot, distanceTo, syncGroup };
}
