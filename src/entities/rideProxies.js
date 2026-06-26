// Cheap low-poly PROXY vehicles for REMOTE players. The real ride builders
// (car.js / boat.js / airplane.js / helicopter.js / rocket.js / jetpack.js /
// skateboard.js) are detailed + heavy; instantiating one per networked player
// would be far too expensive. These proxies are recognizable silhouettes built
// from a handful of primitives so a remote player visibly sits in / stands on /
// wears their vehicle.
//
// Conventions shared by every proxy (so remotePlayers.js can pose them uniformly):
//   - Forward is +Z local, heading is yaw about +Y (matches the avatar/vehicles).
//   - "rig" vehicles (car/boat/rocket/plane/heli) build UPWARD from a local origin
//     at the rig's base (ground / waterline). The driver SEAT sits at local XZ
//     origin (x=0,z=0) at a known height, so remotePlayers can drop the seated
//     avatar straight onto the proxy origin with no per-frame offset math.
//   - "worn" gear (skate/jetpack) is returned ready to parent under the avatar.
//   - Anything that animates is captured in a build-time `group.userData.spin(dt)`
//     closure that only mutates cached rotations / opacities — ZERO per-frame
//     allocation, no geometry/material creation after build.

import * as THREE from "three";

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.6,
    metalness: opts.metal ?? 0.2,
    emissive: opts.emissive || "#000000",
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

function glass() {
  return new THREE.MeshStandardMaterial({
    color: "#163b52", roughness: 0.1, metalness: 0.85,
    transparent: true, opacity: 0.5, emissive: "#0a1f30", emissiveIntensity: 0.3,
  });
}

function mesh(geo, material, cast = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  return m;
}

// Shade a hex color lighter/darker for a two-tone accent.
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return "#" + c.getHexString();
}

// --- CAR ---------------------------------------------------------------------
// An open roadster so the seated driver shows: two-tone body + low wraparound
// windshield + a seat back + 4 rolling wheels. Seat surface ~y=0.60.
export function buildCarProxy(color = "#d23b34") {
  const g = new THREE.Group();
  const paint = mat(color, { rough: 0.3, metal: 0.55 });
  const dark = mat(shade(color, -0.24), { rough: 0.4, metal: 0.45 });
  const trim = mat("#15161a", { rough: 0.6, metal: 0.3 });
  const rubber = mat("#0c0c10", { rough: 0.9, metal: 0.05 });

  // Lower rocker (darker) + main body slab (paint).
  const sill = mesh(new THREE.BoxGeometry(1.86, 0.3, 3.7), dark);
  sill.position.y = 0.36; g.add(sill);
  const body = mesh(new THREE.BoxGeometry(1.78, 0.42, 3.6), paint);
  body.position.y = 0.62; g.add(body);
  // Hood + trunk rises just front/back of the open cockpit so it reads as a car.
  const hood = mesh(new THREE.BoxGeometry(1.7, 0.26, 1.1), paint);
  hood.position.set(0, 0.82, 1.2); g.add(hood);
  const trunk = mesh(new THREE.BoxGeometry(1.7, 0.3, 0.9), paint);
  trunk.position.set(0, 0.84, -1.45); g.add(trunk);
  // Seat back behind the driver.
  const seat = mesh(new THREE.BoxGeometry(1.1, 0.5, 0.18), trim);
  seat.position.set(0, 0.85, -0.55); g.add(seat);
  // Low wraparound windshield (glass) in front of the cockpit.
  const wind = mesh(new THREE.BoxGeometry(1.3, 0.42, 0.06), glass(), false);
  wind.position.set(0, 1.05, 0.62); wind.rotation.x = -0.42; g.add(wind);

  // 4 rolling wheels — each in a hub group spun about its axle (world X).
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 16);
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [1.2, -1.2]) {
      const hub = new THREE.Group();
      hub.position.set(sx * 0.92, 0.34, sz);
      const w = mesh(wheelGeo, rubber);
      w.rotation.z = Math.PI / 2; // axle along X
      hub.add(w);
      g.add(hub);
      wheels.push(hub);
    }
  }
  g.userData.spin = (dt) => {
    for (let i = 0; i < wheels.length; i++) wheels[i].rotation.x += 9 * dt;
  };
  return g;
}

// --- BOAT --------------------------------------------------------------------
// An open runabout: hull (waterline at local y=0) + below-water keel + bow wedge
// + console/windshield + a low seat. Seat surface ~y=0.34. Static.
export function buildBoatProxy() {
  const g = new THREE.Group();
  const hull = mat("#e9eef2", { rough: 0.45, metal: 0.18 });
  const below = mat("#9aa6ad", { rough: 0.7, metal: 0.05 });
  const deck = mat("#caa472", { rough: 0.75 });
  const trim = mat("#202830", { rough: 0.6, metal: 0.3 });

  const mid = mesh(new THREE.BoxGeometry(2.0, 0.8, 4.0), hull);
  mid.position.y = 0.0; g.add(mid);                       // spans -0.4..0.4
  const keel = mesh(new THREE.BoxGeometry(1.6, 0.4, 3.6), below);
  keel.position.y = -0.38; g.add(keel);
  const stripe = mesh(new THREE.BoxGeometry(2.04, 0.12, 4.0), trim, false);
  stripe.position.y = 0.0; g.add(stripe);
  // Pointed bow wedge at +Z (pinched to a prow).
  const bow = mesh(new THREE.BoxGeometry(2.0, 0.8, 1.4), hull);
  bow.position.set(0, 0.0, 2.5); bow.scale.set(0.2, 1, 1); g.add(bow);
  // Open cockpit floor + seat back behind the rider.
  const floor = mesh(new THREE.BoxGeometry(1.5, 0.08, 2.0), deck, false);
  floor.position.set(0, 0.0, -0.2); g.add(floor);
  const seat = mesh(new THREE.BoxGeometry(1.0, 0.42, 0.16), trim);
  seat.position.set(0, 0.22, -0.95); g.add(seat);
  // Console + windshield up front.
  const cons = mesh(new THREE.BoxGeometry(1.1, 0.34, 0.4), hull);
  cons.position.set(0, 0.22, 0.7); g.add(cons);
  const wind = mesh(new THREE.BoxGeometry(1.1, 0.3, 0.05), glass(), false);
  wind.position.set(0, 0.5, 0.55); wind.rotation.x = -0.3; g.add(wind);
  return g;
}

// --- ROCKET ------------------------------------------------------------------
// A capsule rocket: body cylinder + nose cone + 4 fins + a cockpit window where
// the pilot sits, plus a pulsing exhaust flame. Seat ~y=1.25 (pilot inside the
// hull). Origin at the engine base (local y=0).
export function buildRocketProxy() {
  const g = new THREE.Group();
  const hull = mat("#eef2f6", { rough: 0.4, metal: 0.35 });
  const accent = mat("#d23b34", { rough: 0.45, metal: 0.3 });
  const darkMetal = mat("#2a2e36", { rough: 0.6, metal: 0.6 });

  const body = mesh(new THREE.CylinderGeometry(0.6, 0.62, 2.4, 20), hull);
  body.position.y = 1.4; g.add(body);                     // spans 0.2..2.6
  const band = mesh(new THREE.CylinderGeometry(0.61, 0.63, 0.3, 20), accent, false);
  band.position.y = 0.6; g.add(band);
  const nose = mesh(new THREE.ConeGeometry(0.6, 1.2, 20), hull);
  nose.position.y = 3.2; g.add(nose);                     // spans 2.6..3.8
  const tip = mesh(new THREE.ConeGeometry(0.26, 0.5, 14), accent, false);
  tip.position.y = 3.95; g.add(tip);
  // Forward cockpit window at the pilot's seat height.
  const win = mesh(new THREE.CircleGeometry(0.26, 16), glass(), false);
  win.position.set(0, 1.7, 0.61); g.add(win);
  // 4 swept fins around the base.
  const finGeo = new THREE.BoxGeometry(0.08, 1.0, 0.8);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const fin = mesh(finGeo, accent);
    fin.position.set(Math.sin(a) * 0.75, 0.6, Math.cos(a) * 0.75);
    fin.rotation.y = a; g.add(fin);
  }
  // Engine bell + downward exhaust flame (additive, pulses with spin()).
  const bell = mesh(new THREE.CylinderGeometry(0.3, 0.5, 0.5, 16), darkMetal);
  bell.position.y = 0.0; g.add(bell);
  const flameMat = new THREE.MeshBasicMaterial({ color: "#ff9b30", transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const flame = mesh(new THREE.ConeGeometry(0.4, 1.6, 14), flameMat, false);
  flame.rotation.x = Math.PI; flame.position.y = -0.95; g.add(flame); // apex down

  let t = 0;
  g.userData.spin = (dt) => {
    t += dt;
    const flick = 0.7 + Math.sin(t * 34) * 0.2 + Math.sin(t * 21) * 0.1;
    flameMat.opacity = 0.5 + 0.4 * flick;
    flame.scale.y = 0.8 + 0.4 * flick;
  };
  return g;
}

// --- AIRPLANE ----------------------------------------------------------------
// Prop plane: fuselage tube + nose/tail cones + swept wings + tail fin + a glass
// canopy over the cockpit + a spinning nose prop + simple landing gear. The
// cockpit seat is at local (0, ~0.58, 0). Origin at ground (wheels touch y=0).
export function buildPlaneProxy() {
  const g = new THREE.Group();
  const skin = mat("#e9eef3", { rough: 0.4, metal: 0.35 });
  const accent = mat("#d23b34", { rough: 0.45, metal: 0.3 });
  const darkMetal = mat("#2a2e36", { rough: 0.55, metal: 0.6 });
  const rubber = mat("#0c0c10", { rough: 0.9, metal: 0.05 });

  const fuse = mesh(new THREE.CylinderGeometry(0.5, 0.42, 5.0, 18), skin);
  fuse.rotation.x = Math.PI / 2; fuse.position.y = 0.62; g.add(fuse); // z -2.5..2.5
  const nose = mesh(new THREE.ConeGeometry(0.42, 0.9, 16), skin);
  nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.62, 2.9); g.add(nose);
  const tail = mesh(new THREE.ConeGeometry(0.42, 1.0, 14), skin);
  tail.rotation.x = -Math.PI / 2; tail.position.set(0, 0.62, -3.0); g.add(tail);
  // Glass canopy over the seated pilot (cockpit at z~0.3).
  const canopy = mesh(new THREE.SphereGeometry(0.46, 14, 10), glass(), false);
  canopy.scale.set(0.85, 0.78, 1.4); canopy.position.set(0, 1.0, 0.3); g.add(canopy);

  // Swept wings + blue tips.
  for (const sx of [-1, 1]) {
    const wing = mesh(new THREE.BoxGeometry(3.2, 0.12, 1.3), skin);
    wing.position.set(sx * 1.9, 0.5, 0.2); wing.rotation.y = sx * 0.24; g.add(wing);
    const tip = mesh(new THREE.BoxGeometry(0.4, 0.1, 0.9), accent, false);
    tip.position.set(sx * 3.4, 0.54, -0.05); tip.rotation.y = sx * 0.24; g.add(tip);
  }
  // Tail: vertical fin + horizontal stabilisers.
  const fin = mesh(new THREE.BoxGeometry(0.08, 1.1, 1.0), accent);
  fin.position.set(0, 1.2, -2.7); fin.rotation.x = 0.3; g.add(fin);
  const hstab = mesh(new THREE.BoxGeometry(2.2, 0.08, 0.6), skin);
  hstab.position.set(0, 0.7, -2.85); g.add(hstab);

  // Landing gear: two mains + a nose wheel, wheels touch y=0.
  const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12);
  for (const [px, pz] of [[-0.9, 0.3], [0.9, 0.3], [0, 1.8]]) {
    const strut = mesh(new THREE.BoxGeometry(0.07, 0.4, 0.07), darkMetal, false);
    strut.position.set(px, 0.32, pz); g.add(strut);
    const w = mesh(wheelGeo, rubber);
    w.rotation.z = Math.PI / 2; w.position.set(px, 0.2, pz); g.add(w);
  }

  // Spinning nose prop (hub + 3 blades) on the nose, turning about +Z.
  const prop = new THREE.Group();
  prop.position.set(0, 0.62, 3.35);
  const spinner = mesh(new THREE.ConeGeometry(0.16, 0.4, 10), darkMetal, false);
  spinner.rotation.x = Math.PI / 2; spinner.position.z = 0.12; prop.add(spinner);
  for (let i = 0; i < 3; i++) {
    const blade = mesh(new THREE.BoxGeometry(0.1, 1.4, 0.04), darkMetal, false);
    blade.rotation.z = (i / 3) * Math.PI * 2; prop.add(blade);
  }
  g.add(prop);
  g.userData.spin = (dt) => { prop.rotation.z += 26 * dt; };
  return g;
}

// --- HELICOPTER --------------------------------------------------------------
// Cabin + glass canopy + tapered tail boom + fin + a spinning MAIN rotor (blades
// + a faint blur disc) + a spinning TAIL rotor + landing skids. Cockpit seat at
// local (0, ~0.60, 0). Origin at ground (skids on y=0).
export function buildHeliProxy(color = "#2f7fb8") {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.4, metal: 0.35 });
  const darkMetal = mat("#2a2e36", { rough: 0.5, metal: 0.7 });
  const skidMetal = mat("#3a3e46", { rough: 0.45, metal: 0.65 });

  const cabin = mesh(new THREE.BoxGeometry(1.15, 1.15, 1.7), body);
  cabin.position.set(0, 0.95, 0.0); g.add(cabin);          // spans ~0.38..1.53
  const canopy = mesh(new THREE.SphereGeometry(0.58, 16, 12), glass(), false);
  canopy.scale.set(0.95, 0.85, 0.95); canopy.position.set(0, 1.0, 0.7); g.add(canopy);
  // Tapered tail boom + fin.
  const boom = mesh(new THREE.CylinderGeometry(0.14, 0.07, 2.6, 12), body);
  boom.rotation.x = Math.PI / 2; boom.position.set(0, 1.1, -1.9); g.add(boom);
  const fin = mesh(new THREE.BoxGeometry(0.07, 0.6, 0.45), body);
  fin.position.set(0, 1.4, -3.0); g.add(fin);

  // Main rotor: mast + hub + a spinning 3-blade group + a faint blur disc.
  const mast = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), darkMetal, false);
  mast.position.set(0, 1.75, -0.1); g.add(mast);
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 1.98, -0.1);
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 3) * Math.PI * 2;
    const blade = mesh(new THREE.BoxGeometry(0.13, 0.03, 1.5), darkMetal, false);
    blade.position.z = 0.78; arm.add(blade); mainRotor.add(arm);
  }
  const disc = mesh(
    new THREE.CircleGeometry(1.65, 24),
    new THREE.MeshBasicMaterial({ color: "#cdd3da", transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
    false,
  );
  disc.rotation.x = -Math.PI / 2; disc.position.set(0, 1.96, -0.1); g.add(disc);
  g.add(mainRotor);

  // Tail rotor: a small 2-blade group spinning about the lateral (X) axis.
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.18, 1.4, -3.12);
  const tbA = mesh(new THREE.BoxGeometry(0.04, 0.58, 0.06), darkMetal, false); tailRotor.add(tbA);
  const tbB = mesh(new THREE.BoxGeometry(0.04, 0.06, 0.58), darkMetal, false); tailRotor.add(tbB);
  g.add(tailRotor);

  // Landing skids: two fore-aft tubes + splayed legs.
  for (const sx of [-1, 1]) {
    const skid = mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), skidMetal);
    skid.rotation.x = Math.PI / 2; skid.position.set(sx * 0.55, 0.06, -0.1); g.add(skid);
    for (const dz of [0.5, -0.65]) {
      const leg = mesh(new THREE.BoxGeometry(0.07, 0.4, 0.08), skidMetal, false);
      leg.position.set(sx * 0.4, 0.3, dz); leg.rotation.z = sx * 0.3; g.add(leg);
    }
  }

  g.userData.spin = (dt) => {
    mainRotor.rotation.y += 26 * dt;
    tailRotor.rotation.x += 40 * dt;
  };
  return g;
}

// --- SKATEBOARD (worn) -------------------------------------------------------
// A simple deck + 2 trucks + 4 wheels, ~0.8m long, nose toward +Z. Returned at
// its natural pose; remotePlayers parents it under the avatar's feet. Static.
export function buildSkateProxy() {
  const g = new THREE.Group();
  const deckMat = mat("#3a2a1c", { rough: 0.7 });
  const gripMat = mat("#16171a", { rough: 0.95 });
  const wheelMat = mat("#e8e4d8", { rough: 0.5 });
  const truckMat = mat("#b9bcc4", { rough: 0.4, metal: 0.7 });

  const deck = mesh(new THREE.BoxGeometry(0.22, 0.04, 0.8), deckMat);
  deck.position.y = 0.085; g.add(deck);
  const grip = mesh(new THREE.BoxGeometry(0.2, 0.008, 0.76), gripMat, false);
  grip.position.y = 0.108; g.add(grip);
  const wheelGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.045, 12);
  for (const tz of [0.27, -0.27]) {
    const truck = mesh(new THREE.BoxGeometry(0.13, 0.03, 0.05), truckMat, false);
    truck.position.set(0, 0.05, tz); g.add(truck);
    for (const tx of [-0.1, 0.1]) {
      const w = mesh(wheelGeo, wheelMat, false);
      w.rotation.z = Math.PI / 2; w.position.set(tx, 0.05, tz); g.add(w);
    }
  }
  return g;
}

// --- JETPACK (worn) ----------------------------------------------------------
// A compact back-plate + twin fuel tanks + downward thruster nozzles with a
// pulsing exhaust glow. Returned at its natural pose; remotePlayers parents it
// onto the avatar's back. Nozzles fire down (-Y) so the glow reads as lift.
export function buildJetpackProxy() {
  const g = new THREE.Group();
  const plateMat = mat("#3a3f47", { rough: 0.6, metal: 0.4 });
  const tankMat = mat("#d24b34", { rough: 0.35, metal: 0.5 });
  const capMat = mat("#e7ecef", { rough: 0.3, metal: 0.7 });
  const nozzleMat = mat("#22262b", { rough: 0.5, metal: 0.6 });

  const plate = mesh(new THREE.BoxGeometry(0.36, 0.46, 0.06), plateMat);
  plate.position.set(0, 0, -0.1); g.add(plate);
  const flameMats = [];
  const flames = [];
  for (const sx of [-1, 1]) {
    const cx = sx * 0.12;
    const tank = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.34, 12), tankMat);
    tank.position.set(cx, 0.02, -0.16); g.add(tank);
    const cap = mesh(new THREE.SphereGeometry(0.075, 10, 8), capMat, false);
    cap.position.set(cx, 0.19, -0.16); g.add(cap);
    const nozzle = mesh(new THREE.CylinderGeometry(0.07, 0.045, 0.1, 12), nozzleMat, false);
    nozzle.position.set(cx, -0.26, -0.14); g.add(nozzle);
    const fMat = new THREE.MeshBasicMaterial({ color: "#ffb24a", transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    const flame = mesh(new THREE.ConeGeometry(0.05, 0.3, 10), fMat, false);
    flame.rotation.x = Math.PI; flame.position.set(cx, -0.45, -0.14); g.add(flame); // apex down
    flameMats.push(fMat); flames.push(flame);
  }
  let t = 0;
  g.userData.spin = (dt) => {
    t += dt;
    const flick = 0.7 + Math.sin(t * 30) * 0.2 + Math.sin(t * 19) * 0.1;
    for (let i = 0; i < flameMats.length; i++) {
      flameMats[i].opacity = 0.45 + 0.4 * flick;
      flames[i].scale.y = 0.8 + 0.5 * flick;
    }
  };
  return g;
}
