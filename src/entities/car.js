// A drivable, low-poly car — the "steal a car" toy. It owns its own geometry,
// arcade driving physics (throttle/brake/reverse + speed-scaled steering),
// collision against the world's static colliders, a ground check so it can't drive
// off the edge of the map, and a trailing chase camera. main.js (via rides.js)
// hands it a drive axis while you're behind the wheel.

import * as THREE from "three";
import { resolveCollisions } from "../world/collision.js";

const CAR = {
  radius: 1.05, // collision circle (XZ)
  accel: 14, // m/s^2 forward
  reverseAccel: 9,
  maxSpeed: 16, // m/s (~58 km/h, arcade-fast)
  maxReverse: 6,
  brake: 26,
  rollFriction: 4.5, // coast deceleration when off throttle
  turnRate: 2.1, // rad/s at full steer, scaled by speed
  // Chase camera.
  camBack: 7.5,
  camHeight: 3.6,
  camLook: 1.0,
  camEase: 4.5,
  // Free-look chase orbit (GTA-style). The cam sits on a sphere of radius camDist
  // around the look point; camBasePitch reproduces the old fixed (camBack/camHeight)
  // framing when no `controls` is passed. Pitch is clamped to [camMinPitch,camMaxPitch].
  camDist: 7.94,      // ≈ hypot(camBack, camHeight - camLook); orbit radius
  camBasePitch: 0.33, // ≈ atan2(camHeight - camLook, camBack); resting chase pitch
  camMinPitch: 0.1,
  camMaxPitch: 1.05,
};

// NOS boost tuning (shared feel with the boat). Level 1 = Shift, level 2 = Shift+Ctrl.
const NOS = {
  mult1: 1.5,    // level-1 top-speed + accel multiplier
  mult2: 2.1,    // level-2 (EXTREME) multiplier
  drain1: 0.30,  // tank drain /s at level 1
  drain2: 0.6,   // tank drain /s at level 2 (extreme burns faster)
  regen: 0.15,   // tank refill /s when not boosting
  rearm: 0.1,    // after the tank empties it must refill past this before NOS re-arms
};

function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.5, metalness: opts.metal ?? 0.3, emissive: opts.emissive || "#000000", emissiveIntensity: opts.emissiveIntensity ?? 0 })
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Lighten/darken a hex color for the two-tone accent stripe.
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return "#" + c.getHexString();
}

// Build the car group. Forward is +Z local (heading 0 faces +Z, matching the
// player's facing convention: forward = (sin(h), 0, cos(h))). Footprint ~1.9 x 3.9.
//
// Construction notes (read before tweaking numbers):
//  - The body is a stack of slabs (sill -> body -> shoulder) that each TUCK IN
//    above the one below: every slab's bottom face sits a hair INSIDE the slab
//    below it (never coincident), so there are no flickering shared faces and the
//    silhouette steps inward as it rises. Half-widths shrink monotonically.
//  - Detail pieces (stripes, seams, glass, lights) are pushed a small epsilon
//    PROUD of the surface they decorate so nothing z-fights with the panel.
//  - Footprint envelope: width 1.9 (±0.95), length 3.9 (±1.95). Nothing sticks
//    out past that except the mirrors, which are meant to.
function buildCarGroup(color) {
  const g = new THREE.Group();

  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.6 });
  const accentColor = shade(color, -0.24); // darker two-tone (lower body + bumpers)
  const accent = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.34, metalness: 0.5 });
  const trim = new THREE.MeshStandardMaterial({ color: "#101014", roughness: 0.55, metalness: 0.35 });
  const chrome = new THREE.MeshStandardMaterial({ color: "#d7dadf", roughness: 0.2, metalness: 0.9 });
  const EP = 0.012; // proud-of-surface epsilon to kill z-fighting on appliqué detail

  // --- Body: three stacked slabs, each tucked inside the one below ---
  // Half-widths step inward (0.95 -> 0.87 -> 0.79) and the vertical spans abut
  // with a small overlap so faces never coincide.
  //
  // Lower rocker / chassis sill (darker two-tone, full footprint width).
  // span y: 0.26 .. 0.56
  const sill = box(1.9, 0.3, 3.86, accentColor, { rough: 0.5, metal: 0.45 });
  sill.position.y = 0.41;
  g.add(sill);

  // Main body beam — overlaps into the sill from above. span y: 0.50 .. 0.96
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.46, 3.86), paint);
  body.castShadow = true; body.receiveShadow = true;
  body.position.y = 0.73;
  g.add(body);

  // Tapered shoulder slab — narrower + a touch shorter, rounds the upper profile.
  // span y: 0.90 .. 1.16, sunk into the body so the seam isn't a coincident face.
  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.26, 3.56), paint);
  shoulder.castShadow = true;
  shoulder.position.y = 1.03;
  g.add(shoulder);

  // Sculpted nose + tail wedges — tapered for an aero look, tucked into the body
  // ends (their inner faces are buried inside `body`, outer faces are the slope).
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.4, 0.62), paint);
  nose.castShadow = true;
  nose.position.set(0, 0.66, 1.78);
  nose.rotation.x = 0.16; // dips toward the front
  g.add(nose);
  const tailDeck = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.36, 0.6), paint);
  tailDeck.castShadow = true;
  tailDeck.position.set(0, 0.74, -1.8);
  tailDeck.rotation.x = -0.12;
  g.add(tailDeck);

  // Two-tone side accent stripe running the body flanks. Sits just proud of the
  // body face (half-width 0.87) so it reads as paint, not a clipping sliver.
  for (const sx of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 3.5), accent);
    stripe.position.set(sx * (0.87 + EP), 0.84, 0);
    g.add(stripe);
  }

  // --- Cabin: tapered greenhouse, set into the shoulder so its base is hidden ---
  // Cabin base half-width 0.74 < shoulder 0.79, so it reads as a stepped-in roof.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.5, 1.9), paint);
  cabin.castShadow = true;
  cabin.position.set(0, 1.32, -0.2);
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 1.5), paint);
  roof.castShadow = true;
  roof.position.set(0, 1.6, -0.24); // sits on top of the cabin, slight overlap
  g.add(roof);

  // --- Glass: windshield, rear, side windows — inset into the cabin opening ---
  // Each pane is recessed just inside the cabin half-width (0.74) for a clean
  // window reveal, and the front/rear panes are pulled in from the cabin ends.
  const glass = new THREE.MeshStandardMaterial({ color: "#16242e", roughness: 0.08, metalness: 0.85, transparent: true, opacity: 0.72 });
  const wind = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.5, 0.05), glass);
  wind.position.set(0, 1.34, 0.72); // raked windshield
  wind.rotation.x = -0.46;
  g.add(wind);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.46, 0.05), glass);
  rear.position.set(0, 1.36, -1.14);
  rear.rotation.x = 0.44;
  g.add(rear);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 1.36), glass);
    side.position.set(sx * (0.74 - 0.03), 1.34, -0.2); // recessed into the cabin flank
    g.add(side);
  }

  // --- Door seams + handle (thin dark insets just proud of the body flank) ---
  for (const sx of [-1, 1]) {
    for (const dz of [0.42, -0.5]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.025), trim);
      seam.position.set(sx * (0.87 + EP), 0.8, dz);
      g.add(seam);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.22), chrome);
    handle.position.set(sx * (0.87 + EP + 0.015), 0.96, -0.04);
    g.add(handle);
  }

  // --- Front grille + chrome slats + bumpers ---
  // Grille recessed slightly into the nose; slats float a hair in front of it.
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 0.05), trim);
  grille.position.set(0, 0.62, 1.95);
  g.add(grille);
  for (let i = -2; i <= 2; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.02, 0.03), chrome);
    slat.position.set(0, 0.62 + i * 0.045, 1.99);
    g.add(slat);
  }
  // Bumpers — kept inside the ±1.95 length envelope, two-tone with the lower body.
  const fBumper = box(1.86, 0.24, 0.26, accentColor, { rough: 0.45, metal: 0.5 });
  fBumper.position.set(0, 0.42, 1.82);
  g.add(fBumper);
  const rBumper = box(1.86, 0.24, 0.26, accentColor, { rough: 0.45, metal: 0.5 });
  rBumper.position.set(0, 0.42, -1.82);
  g.add(rBumper);

  // --- Side mirrors (allowed to extend past the body for that classic stance) ---
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.045, 0.05), trim);
    arm.position.set(sx * 0.86, 1.06, 0.62);
    g.add(arm);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.18), paint);
    cap.position.set(sx * 1.0, 1.08, 0.62);
    g.add(cap);
  }

  // --- Low rear spoiler (twin stands + wing, floats above the tail deck) ---
  for (const sx of [-0.62, 0.62]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.06), trim);
    stand.position.set(sx, 1.06, -1.72);
    g.add(stand);
  }
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.32), trim);
  wing.position.set(0, 1.17, -1.76);
  wing.rotation.x = -0.14;
  g.add(wing);

  // --- Wheels with alloy rim + spoke detail (cylinders rotated around Z) ---
  // Tyre OD 0.84 sits in arches; rim disc proud of the tyre's outer face so the
  // alloy face shows; hub + spokes parented so they spin with the wheel.
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 20);
  const wheelMat = new THREE.MeshStandardMaterial({ color: "#0c0c10", roughness: 0.92, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({ color: "#cdd2d8", roughness: 0.3, metalness: 0.85 });
  const rimGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.06, 16);
  const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.07, 10);
  const spokeGeo = new THREE.BoxGeometry(0.5, 0.05, 0.05);
  const wheels = [];
  for (const [wx, wz] of [[-0.92, 1.25], [0.92, 1.25], [-0.92, -1.25], [0.92, -1.25]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; // lay the cylinder on its side (axle along X)
    w.position.set(wx, 0.42, wz);
    w.castShadow = true;
    // Outboard side of the wheel (local +Y after the Z rotation faces away from car).
    const outY = Math.sign(wx) * 0.13; // just proud of the 0.30-wide tyre face
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = outY;
    w.add(rim);
    const hub = new THREE.Mesh(hubGeo, chrome);
    hub.position.y = outY + 0.02;
    w.add(hub);
    for (let s = 0; s < 5; s++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.position.y = outY - 0.005;
      spoke.rotation.y = (s / 5) * Math.PI; // fan the spokes across the rim face
      w.add(spoke);
    }
    g.add(w);
    wheels.push(w);
  }

  // --- Headlights (front, +Z): soft always-on glow + forward spotlight ---
  // headMat is a shared, dimmable emissive: it idles at a soft glow and the
  // horn() honk flashes it up briefly (see drive()'s honk ticker). Stored on
  // userData so drive() can reuse the same material ref every frame (no alloc).
  const head = new THREE.MeshStandardMaterial({ color: "#fffdf2", emissive: "#fff4c4", emissiveIntensity: 0.85, roughness: 0.2 });
  // tailMat idles dim and BRIGHTENS while braking (driven each frame in drive()).
  const tail = new THREE.MeshStandardMaterial({ color: "#ff6a58", emissive: "#ff2412", emissiveIntensity: 0.7, roughness: 0.35 });
  // reverseMat: white, only lit while the car is moving backwards.
  const reverse = new THREE.MeshStandardMaterial({ color: "#f6f6ff", emissive: "#ffffff", emissiveIntensity: 0, roughness: 0.3 });
  for (const hx of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), head);
    h.position.set(hx, 0.72, 1.96); // proud of the nose face, above the bumper
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), tail);
    t.position.set(hx, 0.78, -1.94);
    g.add(t);
  }
  // Light-bar style tail strip joining the two taillights.
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.06, 0.05), tail);
  tailBar.position.set(0, 0.78, -1.945);
  g.add(tailBar);
  // Reverse lights — small white lenses inboard of the taillights, just proud
  // of the tail face. Dark until the car rolls backwards.
  for (const rx of [-0.34, 0.34]) {
    const rv = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.05), reverse);
    rv.position.set(rx, 0.7, -1.945);
    g.add(rv);
  }

  // Subtle forward beam so the headlights actually throw light at night.
  const beam = new THREE.SpotLight("#fff3cf", 6, 22, Math.PI / 6, 0.5, 1.4);
  beam.position.set(0, 0.72, 1.96);
  beam.target.position.set(0, 0.1, 9);
  beam.castShadow = false;
  g.add(beam);
  g.add(beam.target);

  // license plate (GTA gag) — sat just proud of the rear bumper, facing back.
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 0.2),
    new THREE.MeshStandardMaterial({ color: "#f4e9c8", roughness: 0.6, emissive: "#2a2510", emissiveIntensity: 0.3 })
  );
  plate.position.set(0, 0.46, -1.96);
  plate.rotation.y = Math.PI;
  g.add(plate);

  // --- Horn honk effect: a reusable expanding ring that flashes on horn() ---
  // Built once, hidden, with its own material so the honk animation never
  // touches the headlight/taillight materials' base state. drive() advances it.
  const ringMat = new THREE.MeshBasicMaterial({ color: "#fff6c0", transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 28), ringMat);
  ring.position.set(0, 0.72, 2.02); // just ahead of the headlights
  ring.visible = false;
  g.add(ring);

  // --- NOS exhaust flames (rear): twin cones tucked under the bumper that flare
  // out the back while the driver is boosting. Hidden at rest; drive() flickers
  // their opacity/length + tints them (blue normal, orange EXTREME). Cheap: one
  // shared MeshBasicMaterial, no per-frame allocation. ---
  const nosMat = new THREE.MeshBasicMaterial({ color: "#7fdfff", transparent: true, opacity: 0, depthWrite: false });
  const nosGeo = new THREE.ConeGeometry(0.13, 0.9, 12);
  const nosFlames = [];
  for (const nx of [-0.5, 0.5]) {
    const fl = new THREE.Mesh(nosGeo, nosMat);
    fl.rotation.x = -Math.PI / 2; // cone apex points out the back (-Z)
    fl.position.set(nx, 0.5, -2.05);
    fl.visible = false;
    g.add(fl);
    nosFlames.push(fl);
  }
  g.userData.nos = { flames: nosFlames, mat: nosMat };

  // Stash material/mesh refs + idle baselines so drive() can mutate emissive
  // intensity in place each frame with zero per-frame allocation.
  g.userData.wheels = wheels;
  g.userData.lights = {
    head,
    headBase: head.emissiveIntensity, // soft idle glow
    tail,
    tailBase: tail.emissiveIntensity, // dim idle
    tailBrake: 2.6, // bright when braking
    reverse,
    reverseLit: 2.2, // white reverse glow
    ring,
    ringMat,
  };
  return g;
}

export function makeCar(opts = {}) {
  const color = opts.color || "#d23b34";
  const group = buildCarGroup(color);
  const state = {
    x: opts.x ?? 0,
    z: opts.z ?? 0,
    heading: opts.heading ?? 0,
    speed: 0,
    nos: 1,         // NOS tank, 0..1 (full at spawn) — read by the HUD gauge
    boosting: false, // true while NOS is actively firing — read by the HUD gauge
  };
  group.position.set(state.x, 0, state.z);
  group.rotation.y = state.heading;

  const _camPos = new THREE.Vector3();
  const _camLook = new THREE.Vector3();
  let _camInit = false;
  let _baseYaw = 0;     // orbit-yaw captured on (re)board so free-look starts behind the car
  let _nosEmpty = false; // latched true when the tank bottoms out; cleared once it refills past NOS.rearm
  const _nos = group.userData.nos;

  // Horn honk state: countdown timer (seconds remaining) ticked down in drive().
  // Self-contained + visual-only (no audio) so horn() can be called anywhere.
  const HONK_TIME = 0.45;
  let _honk = 0;
  const _lights = group.userData.lights;

  function syncGroup() {
    group.position.x = state.x;
    group.position.z = state.z;
    group.rotation.y = state.heading;
  }

  // Advance one physics step. input = { throttle:-1..1, steer:-1..1 }.
  // colliders: world AABBs; isGround(x,z): bool. Returns nothing.
  function drive(dt, input, colliders, isGround) {
    const { throttle, steer } = input;
    const boost = input.boost || 0; // 0|1|2 NOS level (Shift / Shift+Ctrl in a vehicle)
    const prevSpeed = state.speed; // for "speed dropping" brake-light detection

    // --- NOS boost: holding Shift (1) / Shift+Ctrl (2) while throttling FORWARD
    // burns the tank for extra top speed + accel; otherwise the tank slowly refills.
    // Never fires without throttle or with an empty tank, and once the tank bottoms
    // out it must refill past NOS.rearm before it re-arms (so empty ≠ stutter). ---
    if (state.nos <= 0.001) _nosEmpty = true;
    if (state.nos >= NOS.rearm) _nosEmpty = false;
    const boosting = boost > 0 && throttle > 0 && !_nosEmpty && state.nos > 0;
    state.boosting = boosting;
    let maxSpeed = CAR.maxSpeed;
    let accel = CAR.accel;
    if (boosting) {
      const mult = boost >= 2 ? NOS.mult2 : NOS.mult1;
      maxSpeed *= mult;
      accel *= mult;
      state.nos = Math.max(0, state.nos - (boost >= 2 ? NOS.drain2 : NOS.drain1) * dt);
    } else {
      state.nos = Math.min(1, state.nos + NOS.regen * dt);
    }

    // Longitudinal
    if (throttle > 0) {
      state.speed += accel * throttle * dt;
    } else if (throttle < 0) {
      // brake first if moving forward, else reverse
      if (state.speed > 0.1) state.speed -= CAR.brake * dt;
      else state.speed += CAR.reverseAccel * throttle * dt;
    } else {
      // coast
      const f = CAR.rollFriction * dt;
      if (state.speed > 0) state.speed = Math.max(0, state.speed - f);
      else if (state.speed < 0) state.speed = Math.min(0, state.speed + f);
    }
    state.speed = Math.max(-CAR.maxReverse, Math.min(maxSpeed, state.speed));

    // Steering — proportional to how fast we're going, and reversed in reverse.
    if (Math.abs(state.speed) > 0.05) {
      const grip = Math.min(1, Math.abs(state.speed) / 5);
      state.heading -= steer * CAR.turnRate * dt * grip * Math.sign(state.speed);
    }

    // Integrate
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    let nx = state.x + fx * state.speed * dt;
    let nz = state.z + fz * state.speed * dt;

    // Stay on walkable ground — if the next spot has no ground, stop dead.
    if (isGround && !isGround(nx, nz)) {
      state.speed = 0;
      nx = state.x;
      nz = state.z;
    }

    // Collide against world props/buildings; if we got pushed back hard, bleed speed.
    if (colliders && colliders.length) {
      const r = resolveCollisions(nx, nz, CAR.radius, colliders);
      if (Math.hypot(r.x - nx, r.z - nz) > 0.02) state.speed *= 0.4;
      nx = r.x;
      nz = r.z;
    }

    state.x = nx;
    state.z = nz;
    syncGroup();

    // spin wheels for feel
    const ws = group.userData.wheels;
    if (ws) for (const w of ws) w.rotation.x += state.speed * dt * 2.2;

    // --- Lights (mutate shared material refs in place; no per-frame alloc) ---
    if (_lights) {
      // Brake lights: lit when braking while moving forward (throttle<0 and
      // still rolling forward) OR whenever forward speed is actively dropping.
      const movingFwd = state.speed > 0.1;
      const slowingFwd = movingFwd && state.speed < prevSpeed - 1e-4;
      const braking = (throttle < 0 && movingFwd) || slowingFwd;
      _lights.tail.emissiveIntensity = braking ? _lights.tailBrake : _lights.tailBase;

      // Reverse lights: white, lit only while the car is actually moving backward.
      _lights.reverse.emissiveIntensity = state.speed < -0.05 ? _lights.reverseLit : 0;

      // Horn honk: flash the headlights up + expand/fade the ring while active.
      if (_honk > 0) {
        _honk = Math.max(0, _honk - dt);
        const t = _honk / HONK_TIME; // 1 -> 0 over the honk
        // Headlight flash: pulse above the soft idle glow, settle back to base.
        _lights.head.emissiveIntensity = _lights.headBase + 2.4 * t;
        // Ring: grow from the headlights outward and fade as the honk ends.
        const ring = _lights.ring;
        ring.visible = true;
        const s = 1 + (1 - t) * 2.2; // expand outward
        ring.scale.set(s, s, s);
        _lights.ringMat.opacity = 0.55 * t;
        if (_honk === 0) ring.visible = false;
      } else {
        _lights.head.emissiveIntensity = _lights.headBase;
      }
    }

    // --- NOS flames: flicker + stretch the twin cones while boosting, tinted blue
    // (level 1) or orange (EXTREME level 2). Mutates the shared material/meshes in
    // place — no per-frame allocation. ---
    if (_nos) {
      if (boosting) {
        const flicker = 0.75 + Math.random() * 0.25;
        _nos.mat.opacity = 0.85 * flicker;
        _nos.mat.color.setHex(boost >= 2 ? 0xff7a3c : 0x7fdfff);
        const len = (boost >= 2 ? 1.7 : 1.1) * flicker;
        for (const fl of _nos.flames) {
          fl.visible = true;
          fl.scale.set(1, len, 1);
        }
      } else if (_nos.flames[0].visible) {
        for (const fl of _nos.flames) fl.visible = false;
      }
    }
  }

  // Visual horn honk — flashes the headlights + an expanding ring for ~0.45s.
  // Self-contained and audio-free by default; safe to call from anywhere (the
  // animation is advanced inside drive() each frame). Returns nothing.
  function horn() {
    _honk = HONK_TIME;
  }

  // Trailing chase camera behind the car. With free-look, controls.orbit.yaw swings
  // the chase angle around the car (GTA-style) and controls.orbit.pitch raises/lowers
  // it; the offset is HELD (no auto-recenter) for a true free-look. When `controls`
  // is absent it falls back to the old fixed behind-the-car chase. Scratch-vector
  // reuse keeps it allocation-free.
  function updateCamera(camera, dt, controls) {
    // Free-look offsets from the mouse-drag orbit. The yaw baseline is captured on
    // (re)board so the view starts directly behind the car, then the drag delta
    // swings it; pitch rides the orbit pitch (already clamped in controls.js).
    let yawOff = 0;
    let pitch = CAR.camBasePitch;
    if (controls && controls.orbit) {
      if (!_camInit) _baseYaw = controls.orbit.yaw;
      yawOff = controls.orbit.yaw - _baseYaw;
      pitch = Math.max(CAR.camMinPitch, Math.min(CAR.camMaxPitch, controls.orbit.pitch));
    }
    const ang = state.heading + yawOff;
    const sa = Math.sin(ang);
    const ca = Math.cos(ang);
    const horiz = CAR.camDist * Math.cos(pitch);
    const vert = CAR.camDist * Math.sin(pitch);
    _camPos.set(state.x - sa * horiz, vert + CAR.camLook, state.z - ca * horiz);
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    _camLook.set(state.x + fx * 2.0, CAR.camLook, state.z + fz * 2.0);
    if (!_camInit) {
      camera.position.copy(_camPos);
      _camInit = true;
    }
    const k = Math.min(1, dt * CAR.camEase);
    camera.position.lerp(_camPos, k);
    camera.lookAt(_camLook);
  }

  function resetCamera() {
    _camInit = false;
  }

  // AABB footprint for the static-collider system (oriented box approximated as a
  // padded square around the car centre).
  function footprint() {
    const pad = 1.2;
    return { minX: state.x - pad, maxX: state.x + pad, minZ: state.z - pad, maxZ: state.z + pad };
  }

  // Where to drop the player when they get out: beside the driver door (car's left).
  function exitSpot() {
    const lx = Math.cos(state.heading); // car's left = +X local rotated
    const lz = -Math.sin(state.heading);
    return { x: state.x + lx * 1.7, z: state.z + lz * 1.7, facing: state.heading + Math.PI / 2 };
  }

  function distanceTo(x, z) {
    return Math.hypot(state.x - x, state.z - z);
  }

  return { group, state, drive, updateCamera, resetCamera, footprint, exitSpot, distanceTo, syncGroup, horn };
}
