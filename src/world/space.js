// SPACE — a SPACEPORT on the ground + an orbital SPACE STATION far overhead, so a
// player who climbs into the rocket parked on the launchpad can blast straight up,
// break the low sky dome, and reach orbit to circle / dock with the station.
//
// What this module adds to the world (all in WORLD coords, added straight to the
// scene by main.js, MIRRORING the OCEAN module contract):
//   • A concrete LAUNCHPAD on solid ground at a clear EDGE of the city (the NE
//     corner of landBounds, far from the cafe at the origin and from the ocean's
//     west dock / offshore islands). Its top is registered as walkable `ground` so
//     you can stroll out and board the rocket; a service GANTRY, a cluster of FUEL
//     TANKS and floodlight masts ring it as solid `colliders` (tight footprints),
//     with painted hazard chevrons + a warning-stripe rim for flavour.
//   • A modular SPACE STATION ~260 m up: a central hub, cylindrical crew modules, a
//     down-facing DOCKING RING the ascending rocket rises into, big solar-panel
//     wings, a comms dish and blinking nav beacons. It slowly rotates.
//   • A handful of drifting SATELLITES + a couple of tumbling ASTEROIDS orbiting the
//     station, plus a big pale MOON hanging far off, and a cheap STARFIELD of high
//     Points so the sky reads as space once you climb above the daylight dome.
//
// ── Y-STACK (must not fight the city's existing stack) ─────────────────────────
// The city uses base pavement y=-0.12, district slabs top y=0.00, road grid y=0.02,
// road decals y=0.025. The launchpad disc TOP sits at y=+0.06 (just above the road
// decals) — a low raised concrete apron, flush enough that the player (feet at y=0)
// reads as standing on it, with ZERO z-fighting against any city ground layer.
// Everything else (gantry, tanks, station, moon, stars) lives well above, so nothing
// here ever pokes through the city floor.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// All materials + geometries are created ONCE at module scope (like the zone/ocean
// files). The build phase may allocate freely; update(dt) only mutates cached
// transforms + material scalars on a small list of animated handles — no `new` per
// frame (no Vector3 churn: positions are written component-wise via .set / += ).

import * as THREE from "three";

// ── Shared materials (created ONCE) ───────────────────────────────────────────
// Launchpad / ground.
const concreteMat     = new THREE.MeshStandardMaterial({ color: "#8a8d92", roughness: 0.96, metalness: 0.05 });
const concreteSideMat = new THREE.MeshStandardMaterial({ color: "#6f7378", roughness: 0.98, metalness: 0.05 });
const stripeYellowMat = new THREE.MeshStandardMaterial({ color: "#e8c020", roughness: 0.6, emissive: "#5a4400", emissiveIntensity: 0.25 });
const stripeDarkMat   = new THREE.MeshStandardMaterial({ color: "#1b1d20", roughness: 0.7 });
const hazardMat       = new THREE.MeshStandardMaterial({ color: "#ffd23a", roughness: 0.5, emissive: "#caa018", emissiveIntensity: 0.5, side: THREE.DoubleSide });
// Gantry / service tower steelwork.
const steelMat     = new THREE.MeshStandardMaterial({ color: "#5a626b", roughness: 0.5, metalness: 0.7 });
const steelDarkMat = new THREE.MeshStandardMaterial({ color: "#3c424a", roughness: 0.6, metalness: 0.65 });
// Fuel tanks.
const tankMat    = new THREE.MeshStandardMaterial({ color: "#d8dde2", roughness: 0.4, metalness: 0.3 });
const tankCapMat = new THREE.MeshStandardMaterial({ color: "#b0b6bc", roughness: 0.45, metalness: 0.3 });
// Floodlights.
const floodMat = new THREE.MeshStandardMaterial({ color: "#fff6d8", roughness: 0.4, emissive: "#fff0c0", emissiveIntensity: 1.4 });
// Station structure.
const hullMat     = new THREE.MeshStandardMaterial({ color: "#c7ced6", roughness: 0.42, metalness: 0.55 });
const hullDarkMat = new THREE.MeshStandardMaterial({ color: "#8b939c", roughness: 0.5, metalness: 0.5 });
const moduleMat   = new THREE.MeshStandardMaterial({ color: "#e6eaef", roughness: 0.4, metalness: 0.4 });
const trussMat    = new THREE.MeshStandardMaterial({ color: "#6b7681", roughness: 0.55, metalness: 0.65 });
const ringMat     = new THREE.MeshStandardMaterial({ color: "#aeb6c0", roughness: 0.45, metalness: 0.6 });
const ringLipMat  = new THREE.MeshStandardMaterial({ color: "#2b3138", roughness: 0.6, metalness: 0.5, emissive: "#0c2a16", emissiveIntensity: 0.4 });
const solarMat    = new THREE.MeshStandardMaterial({ color: "#1b2c63", roughness: 0.35, metalness: 0.25, emissive: "#16307a", emissiveIntensity: 0.22, flatShading: true });
const solarFrameMat = new THREE.MeshStandardMaterial({ color: "#3a4250", roughness: 0.6, metalness: 0.5 });
const dishMat     = new THREE.MeshStandardMaterial({ color: "#e9edf2", roughness: 0.4, metalness: 0.35, side: THREE.DoubleSide });
const goldFoilMat = new THREE.MeshStandardMaterial({ color: "#caa23a", roughness: 0.4, metalness: 0.65 });
// Satellites / asteroids / moon. Moon + far bodies opt OUT of fog so they stay
// crisp against the high sky (a daytime moon is believable; the station/sats are
// near the camera once you've launched, so their fog contribution is negligible).
const rockMat = new THREE.MeshStandardMaterial({ color: "#6a6058", roughness: 1.0, metalness: 0.05, flatShading: true });
const moonMat = new THREE.MeshStandardMaterial({ color: "#cdd2d8", roughness: 1.0, metalness: 0.0, emissive: "#262b33", emissiveIntensity: 0.18, flatShading: true, fog: false });
const moonMareMat = new THREE.MeshStandardMaterial({ color: "#a9afb6", roughness: 1.0, fog: false });

// ── Shared geometries (created ONCE) ──────────────────────────────────────────
const G = {
  legGeo:      new THREE.BoxGeometry(0.6, 24, 0.6),       // gantry tower leg
  braceGeo:    new THREE.BoxGeometry(0.3, 0.3, 1),        // diagonal/horizontal brace (scaled per use)
  tankGeo:     new THREE.CylinderGeometry(2.2, 2.2, 6, 18),
  tankCapGeo:  new THREE.SphereGeometry(2.2, 18, 9),
  floodPoleGeo:new THREE.CylinderGeometry(0.16, 0.2, 7, 8),
  floodHeadGeo:new THREE.BoxGeometry(1.3, 0.6, 0.45),
  moduleGeo:   new THREE.CylinderGeometry(2.2, 2.2, 7, 18),
  modCapGeo:   new THREE.SphereGeometry(2.2, 18, 10),
  trussGeo:    new THREE.CylinderGeometry(0.28, 0.28, 1, 8), // scaled along Y per span
  panelGeo:    new THREE.BoxGeometry(7, 0.12, 3.2),       // a solar-panel section
  beaconGeo:   new THREE.SphereGeometry(0.42, 8, 6),
  antennaGeo:  new THREE.CylinderGeometry(0.05, 0.05, 1, 6),
  satBodyGeo:  new THREE.BoxGeometry(1.6, 1.6, 2.2),
  satPanelGeo: new THREE.BoxGeometry(4.2, 0.08, 1.5),
  satDishGeo:  new THREE.ConeGeometry(0.9, 0.5, 14, 1, true),
};

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = true, receive = true) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}
function addAABB(arr, cx, cz, w, d) {
  arr.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// A self-contained SATELLITE: a foil-wrapped bus, two stubby solar wings, a little
// dish + whip antenna. Returned as a group the caller parks on an orbit.
function makeSatellite(bodyMat) {
  const g = new THREE.Group();
  const bus = mesh(G.satBodyGeo, bodyMat, true, false);
  g.add(bus);
  for (const sx of [-1, 1]) {
    const arm = mesh(G.trussGeo, trussMat, false, false);
    arm.scale.y = 1.4;
    arm.rotation.z = Math.PI / 2;
    arm.position.x = sx * 1.5;
    g.add(arm);
    const wing = mesh(G.satPanelGeo, solarMat, false, false);
    wing.position.set(sx * 3.4, 0, 0);
    g.add(wing);
  }
  const dish = mesh(G.satDishGeo, dishMat, false, false);
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, 0, 1.5);
  g.add(dish);
  const whip = mesh(G.antennaGeo, steelMat, false, false);
  whip.scale.y = 1.6;
  whip.position.set(0, 1.2, -0.6);
  g.add(whip);
  return g;
}

export function buildSpace(opts = {}) {
  const lb = opts.landBounds || { minX: -125, maxX: 125, minZ: -15, maxZ: 285 };
  const group = new THREE.Group();
  group.name = "space";

  // Returned contract arrays.
  const ground = [];    // EXTRA walkable rect: the launchpad apron
  const colliders = []; // SOLID props: gantry legs, fuel tanks, flood masts

  // Animated handles collected at build → mutated allocation-free in update().
  const beacons = [];    // { mat, rate, phase }  blinking nav lights
  const sats = [];       // { group, cx, cy, cz, r, ang, rate, tilt, spin }
  const asteroids = [];  // { group, cx, cy, cz, r, ang, rate, rx, ry, rz }
  const solarPivots = []; // station solar-wing roots (gentle sun-tracking tilt)

  // ── LAUNCHPAD placement ───────────────────────────────────────────────────
  // The 16 districts fill a 4x4 grid (cols x=-90/-30/30/90, rows z=65/125/185/245,
  // each ~±23) — so EVERY corner cell is a district. The old NE-corner pad landed
  // dead-centre on the nightlife/club tile. Instead park it on the OPEN connector
  // apron south of the district grid, between the x=0 and x=60 avenues (a road-free
  // band), right on the cafe→city spawn path so you walk past the rocket on the way
  // in. Clear of the cafe (origin), the avenues (x=0/±6, x=60/±6), the cross streets
  // (first at z=35), and all districts (first row at z≈42). Radius trimmed so the
  // 22 m disc fits the band cleanly.
  const pad = { x: 33, z: 19 };
  const R_PAD = 9;           // launchpad disc radius (trimmed to fit the apron band, clear of the z=35 cross street)
  const padTopY = 0.06;      // top face height (just above road decals @0.025)
  const padThick = 0.6;

  // Station altitude — high overhead so a launched rocket climbs to it. (Should sit
  // at/above the rocket's flight ceiling; returned as `stationY` for that caller.)
  const stationY = 260;

  // ── 1) Concrete pad disc ───────────────────────────────────────────────────
  const pg = new THREE.Group();
  pg.position.set(pad.x, 0, pad.z);
  group.add(pg);

  const disc = mesh(new THREE.CylinderGeometry(R_PAD, R_PAD + 0.8, padThick, 36), concreteMat, false, true);
  disc.position.y = padTopY - padThick / 2; // top face at padTopY
  pg.add(disc);
  // A darker recessed flame trench cross under the rocket (cosmetic inlay).
  for (let i = 0; i < 2; i++) {
    const trench = box(i ? 1.6 : 9, 0.04, i ? 9 : 1.6, concreteSideMat, false, true);
    trench.position.y = padTopY + 0.005;
    pg.add(trench);
  }
  // Painted landing bullseye: two concentric emissive hazard rings + chevrons.
  for (const rr of [5.5, 8.5]) {
    const ring = mesh(new THREE.RingGeometry(rr - 0.5, rr, 40), hazardMat, false, false);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = padTopY + 0.01;
    pg.add(ring);
  }
  // Warning-stripe rim: alternating yellow / dark blocks around the disc edge.
  const RIM_N = 28;
  for (let i = 0; i < RIM_N; i++) {
    const a = (i / RIM_N) * Math.PI * 2;
    const blk = box(1.4, 0.08, 1.0, i % 2 ? stripeDarkMat : stripeYellowMat, false, false);
    blk.position.set(Math.cos(a) * (R_PAD - 0.4), padTopY + 0.02, Math.sin(a) * (R_PAD - 0.4));
    blk.rotation.y = -a;
    pg.add(blk);
  }
  // Register the pad top as walkable ground (a generous inscribed square).
  addAABB(ground, pad.x, pad.z, R_PAD * 1.9, R_PAD * 1.9);

  // ── 2) SERVICE GANTRY beside the pad (4 legs + bracing + a swing arm) ───────
  // Offset to +X of the rocket (which sits at pad centre) so its footprint never
  // overlaps the rocketSpawn. Legs become tight colliders.
  const gx = 9.0, gz = 0;            // tower centre, local to pad
  const legSpan = 2.4;               // half-distance between legs
  const towerTopY = 24 / 2 + padTopY; // legGeo is 24 tall, base on the pad
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = mesh(G.legGeo, steelMat);
      leg.position.set(gx + sx * legSpan, 12 + padTopY, gz + sz * legSpan);
      pg.add(leg);
      addAABB(colliders, pad.x + gx + sx * legSpan, pad.z + gz + sz * legSpan, 1.0, 1.0);
    }
  }
  // Horizontal brace rings up the tower so it reads as a lattice (cosmetic).
  for (let h = 3; h < 24; h += 3.5) {
    for (const along of [-1, 1]) {
      const bx = mesh(G.braceGeo, steelDarkMat, false, false);
      bx.scale.z = legSpan * 2;
      bx.position.set(gx + along * legSpan, padTopY + h, gz);
      pg.add(bx);
      const bz = mesh(G.braceGeo, steelDarkMat, false, false);
      bz.scale.z = legSpan * 2;
      bz.rotation.y = Math.PI / 2;
      bz.position.set(gx, padTopY + h, gz + along * legSpan);
      pg.add(bz);
    }
  }
  // Swing/crew arm reaching from the tower toward the rocket at pad centre.
  const arm = box(gx - legSpan - 1.5, 0.5, 1.6, steelMat, true, false);
  arm.position.set((gx - legSpan) / 2 - 0.5, padTopY + 14, gz);
  pg.add(arm);
  const armTip = box(1.2, 2.4, 1.6, steelDarkMat, true, false);
  armTip.position.set(2.2, padTopY + 14, gz);
  pg.add(armTip);
  // A red obstruction beacon at the tower top.
  {
    const navMat = new THREE.MeshStandardMaterial({ color: "#ff5a4a", roughness: 0.4, emissive: "#ff2a1a", emissiveIntensity: 1.2 });
    const nav = mesh(G.beaconGeo, navMat, false, false);
    nav.position.set(gx, towerTopY + 0.6, gz);
    pg.add(nav);
    beacons.push({ mat: navMat, rate: 2.4, phase: 0 });
  }

  // ── 3) FUEL TANKS clustered on the -X side (opposite the gantry) ────────────
  for (const [tx, tz] of [[-9, 5], [-9, -5], [-12.5, 0]]) {
    const tank = mesh(G.tankGeo, tankMat);
    tank.position.set(tx, padTopY + 3, tz);
    pg.add(tank);
    const cap = mesh(G.tankCapGeo, tankCapMat, true, false);
    cap.scale.y = 0.55;
    cap.position.set(tx, padTopY + 6, tz);
    pg.add(cap);
    // A single hazard band around the belly.
    const band = mesh(new THREE.CylinderGeometry(2.24, 2.24, 0.8, 18), stripeYellowMat, false, false);
    band.position.set(tx, padTopY + 2.4, tz);
    pg.add(band);
    addAABB(colliders, pad.x + tx, pad.z + tz, 4.8, 4.8);
  }

  // ── 4) FLOODLIGHT masts at the pad's diagonals (thin colliders) ─────────────
  for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
    const mx = Math.cos(a) * (R_PAD - 1.5), mz = Math.sin(a) * (R_PAD - 1.5);
    const pole = mesh(G.floodPoleGeo, steelDarkMat, true, false);
    pole.position.set(mx, padTopY + 3.5, mz);
    pg.add(pole);
    const head = mesh(G.floodHeadGeo, floodMat, false, false);
    head.position.set(mx, padTopY + 7.2, mz);
    head.lookAt(0, padTopY + 2, 0); // aim the lamp inward at the rocket
    pg.add(head);
    addAABB(colliders, pad.x + mx, pad.z + mz, 0.6, 0.6);
  }

  // Rocket parking spot: dead centre of the pad, nose-forward (+Z).
  const rocketSpawn = { x: pad.x, z: pad.z, heading: 0 };

  // ── 5) SPACE STATION (sub-group spun in update) ────────────────────────────
  const station = new THREE.Group();
  station.position.set(pad.x, stationY, pad.z);
  group.add(station);

  // Central hub — a faceted core sphere with a band of windows.
  const hub = mesh(new THREE.IcosahedronGeometry(3.2, 1), hullMat, false, false);
  station.add(hub);
  const collar = mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.2, 20), hullDarkMat, false, false);
  station.add(collar);

  // A central truss SPINE running along Z, with crew modules strung along it.
  const spine = mesh(G.trussGeo, trussMat, false, false);
  spine.scale.y = 34;               // 34 m long
  spine.rotation.x = Math.PI / 2;   // lie along Z
  station.add(spine);
  for (const mz of [-11, -4.5, 4.5, 11]) {
    const mod = mesh(G.moduleGeo, moduleMat, false, false);
    mod.rotation.x = Math.PI / 2;   // axis along Z
    mod.position.set(0, 0, mz);
    mod.scale.set(0.85, 0.85, 0.85);
    station.add(mod);
    for (const e of [-1, 1]) {
      const capm = mesh(G.modCapGeo, hullDarkMat, false, false);
      capm.scale.set(0.85, 0.55, 0.85);
      capm.position.set(0, 0, mz + e * 2.6);
      station.add(capm);
    }
  }
  // A couple of modules sprouting sideways off the hub for a fuller silhouette.
  for (const sx of [-1, 1]) {
    const mod = mesh(G.moduleGeo, moduleMat, false, false);
    mod.rotation.z = Math.PI / 2;   // axis along X
    mod.scale.set(0.7, 0.7, 0.7);
    mod.position.set(sx * 6, 0, 0);
    station.add(mod);
  }

  // SOLAR WINGS — long arms off the spine ends (±Z), each carrying panels on a
  // pivot that gently tilts in update() (sun-tracking flavour).
  for (const ez of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const armT = mesh(G.trussGeo, trussMat, false, false);
      armT.scale.y = 9;
      armT.rotation.z = Math.PI / 2; // run along X
      armT.position.set(sx * 6, 0, ez * 15);
      station.add(armT);
      const pivot = new THREE.Group();
      pivot.position.set(sx * 10.5, 0, ez * 15);
      station.add(pivot);
      for (const py of [-1.8, 1.8]) {
        const panel = mesh(G.panelGeo, solarMat, false, false);
        panel.position.set(sx * 1.5, 0, 0);
        // grid frame lines via a slightly larger dark backing
        const frame = mesh(new THREE.BoxGeometry(7.3, 0.06, 3.5), solarFrameMat, false, false);
        frame.position.copy(panel.position);
        frame.position.y -= 0.08;
        const holder = new THREE.Group();
        holder.position.z = py;
        holder.add(frame);
        holder.add(panel);
        pivot.add(holder);
      }
      solarPivots.push(pivot);
    }
  }

  // DOCKING RING hanging below the hub (-Y), facing DOWN so the ascending rocket
  // rises straight into it. A green-lit lip rings the aperture as a "cleared to
  // dock" cue; a blinking beacon flanks it.
  const dockY = -5.5;
  const ringTorus = mesh(new THREE.TorusGeometry(3.6, 0.55, 12, 28), ringMat, false, false);
  ringTorus.rotation.x = Math.PI / 2; // ring lies in the XZ plane (opening faces ±Y)
  ringTorus.position.y = dockY;
  station.add(ringTorus);
  const ringLip = mesh(new THREE.TorusGeometry(3.0, 0.18, 10, 28), ringLipMat, false, false);
  ringLip.rotation.x = Math.PI / 2;
  ringLip.position.y = dockY - 0.1;
  station.add(ringLip);
  // Stalk connecting the ring up to the hub.
  const stalk = mesh(new THREE.CylinderGeometry(1.0, 1.4, 4.5, 14), hullDarkMat, false, false);
  stalk.position.y = dockY + 2.4;
  station.add(stalk);
  {
    const dockBeaconMat = new THREE.MeshStandardMaterial({ color: "#37ff7a", roughness: 0.4, emissive: "#19e85f", emissiveIntensity: 1.0 });
    for (const ba of [0, Math.PI]) {
      const b = mesh(G.beaconGeo, dockBeaconMat, false, false);
      b.position.set(Math.cos(ba) * 3.6, dockY, Math.sin(ba) * 3.6);
      station.add(b);
    }
    beacons.push({ mat: dockBeaconMat, rate: 1.6, phase: 0.5 });
  }

  // COMMS DISH on a short mast off the top of the hub.
  const dishMast = mesh(G.antennaGeo, steelMat, false, false);
  dishMast.scale.y = 3;
  dishMast.position.set(2.5, 4, 0);
  station.add(dishMast);
  const dish = mesh(new THREE.ConeGeometry(2.6, 1.5, 22, 1, true), dishMat, false, false);
  dish.position.set(2.5, 5.6, 0);
  dish.rotation.x = -0.5;
  station.add(dish);
  const dishFeed = mesh(new THREE.SphereGeometry(0.2, 8, 6), goldFoilMat, false, false);
  dishFeed.position.set(2.5, 6.4, 0.7);
  station.add(dishFeed);

  // Red/green nav beacons at the wing extremities (blink out of phase).
  {
    const redMat   = new THREE.MeshStandardMaterial({ color: "#ff5a4a", roughness: 0.4, emissive: "#ff2a1a", emissiveIntensity: 1.0 });
    const greenMat = new THREE.MeshStandardMaterial({ color: "#5aff7a", roughness: 0.4, emissive: "#1aff4a", emissiveIntensity: 1.0 });
    for (const [bx, bz, bm] of [[14, 15, greenMat], [-14, 15, redMat], [14, -15, greenMat], [-14, -15, redMat]]) {
      const b = mesh(G.beaconGeo, bm, false, false);
      b.position.set(bx, 0, bz);
      station.add(b);
    }
    beacons.push({ mat: redMat, rate: 3.0, phase: 0 });
    beacons.push({ mat: greenMat, rate: 3.0, phase: Math.PI });
  }

  // ── 6) DRIFTING SATELLITES orbiting the station ────────────────────────────
  const SC = { x: pad.x, y: stationY, z: pad.z }; // station centre (world)
  const satParams = [
    { r: 46, ang: 0.4, rate: 0.10, tilt: 0.35, spin: 0.5, mat: goldFoilMat },
    { r: 62, ang: 2.1, rate: -0.07, tilt: -0.5, spin: 0.3, mat: hullMat },
    { r: 78, ang: 4.0, rate: 0.05, tilt: 0.2, spin: 0.7, mat: goldFoilMat },
  ];
  for (const p of satParams) {
    const sat = makeSatellite(p.mat);
    group.add(sat);
    sats.push({ group: sat, cx: SC.x, cy: SC.y, cz: SC.z, r: p.r, ang: p.ang, rate: p.rate, tilt: p.tilt, spin: p.spin });
  }

  // ── 7) ASTEROIDS — a couple of lumpy rocks tumbling on wide slow orbits ─────
  const astParams = [
    { r: 110, ang: 1.2, rate: 0.018, s: 4.5, rx: 0.12, ry: 0.07, rz: 0.05 },
    { r: 150, ang: 3.6, rate: -0.012, s: 7.0, rx: 0.05, ry: 0.10, rz: 0.08 },
  ];
  for (const p of astParams) {
    const ag = new THREE.Group();
    const rock = mesh(new THREE.IcosahedronGeometry(p.s, 0), rockMat, false, false);
    rock.scale.set(1, 0.75, 1.2); // irregular lump
    ag.add(rock);
    group.add(ag);
    asteroids.push({ group: ag, cx: SC.x, cy: SC.y + 15, cz: SC.z, r: p.r, ang: p.ang, rate: p.rate, rx: p.rx, ry: p.ry, rz: p.rz });
  }

  // ── 8) MOON — a big pale sphere hanging far off the launch corner ───────────
  const moon = mesh(new THREE.IcosahedronGeometry(42, 2), moonMat, false, false);
  moon.position.set(pad.x + 230, stationY + 130, pad.z + 300);
  group.add(moon);
  // A few darker "mare" blotches embedded in the surface (flattened spheres — no
  // orientation needed, so they read from every angle without facing math).
  for (const [ma, mb, ms] of [[0.4, 0.6, 12], [-0.7, 1.1, 8], [1.4, -0.3, 10]]) {
    const mare = mesh(new THREE.SphereGeometry(ms, 12, 8), moonMareMat, false, false);
    const nx = Math.cos(ma) * Math.cos(mb), ny = Math.sin(mb), nz = Math.sin(ma) * Math.cos(mb);
    mare.position.set(nx * 40, ny * 40, nz * 40);
    mare.scale.set(1, 1, 0.3); // sink the blotch into the surface
    moon.add(mare);
  }

  // ── 9) STARFIELD — a cheap high Points cloud so the sky reads as space at
  // altitude. Centred high above the launch corner; we KEEP every star well above
  // the ground (world y ≥ 120) so none hug the pad, and let the city's fog fade
  // them toward the daylight sky colour near the ground while they pop once you've
  // climbed up among them. Built once; only a subtle global twinkle in update().
  const STAR_N = 1300;
  const starCenterY = stationY + 50;
  const starPos = new Float32Array(STAR_N * 3);
  const starCol = new Float32Array(STAR_N * 3);
  let si = 0, guard = 0;
  while (si < STAR_N && guard < STAR_N * 8) {
    guard++;
    const u = Math.random() * 2 - 1;          // cos(theta)
    const az = Math.random() * Math.PI * 2;
    const r = 200 + Math.random() * 130;
    const sxy = Math.sqrt(1 - u * u);
    const wy = starCenterY + u * r;
    if (wy < 120) continue;                   // keep stars high, never near the ground
    const wx = pad.x + sxy * Math.cos(az) * r;
    const wz = pad.z + sxy * Math.sin(az) * r;
    starPos[si * 3] = wx; starPos[si * 3 + 1] = wy; starPos[si * 3 + 2] = wz;
    // Mostly white with a scatter of warm/cool tints.
    const tint = Math.random();
    let cr = 1, cg = 1, cb = 1;
    if (tint < 0.16) { cr = 1.0; cg = 0.82; cb = 0.62; }       // warm
    else if (tint < 0.32) { cr = 0.7; cg = 0.82; cb = 1.0; }   // cool
    const b = 0.65 + Math.random() * 0.35;
    starCol[si * 3] = cr * b; starCol[si * 3 + 1] = cg * b; starCol[si * 3 + 2] = cb * b;
    si++;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos.subarray(0, si * 3), 3));
  starGeo.setAttribute("color", new THREE.Float32BufferAttribute(starCol.subarray(0, si * 3), 3));
  const starMat = new THREE.PointsMaterial({
    size: 1.7, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  // ── Animation — ALLOCATION-FREE. Spin the station, blink beacons, drift sats
  // + asteroids, gently track the solar wings, and twinkle the starfield. Writes
  // cached transforms / scalars only; no `new` per frame. ─────────────────────
  let t = 0;
  function update(dt) {
    t += dt;
    // Slow station rotation + a barely-there list.
    station.rotation.y += dt * 0.05;
    station.rotation.z = Math.sin(t * 0.08) * 0.015;
    // Comms dish slow sweep.
    dish.rotation.z = Math.sin(t * 0.25) * 0.4;
    // Solar wings gently tilt as if tracking a sun.
    const tilt = Math.sin(t * 0.06) * 0.25;
    for (let i = 0; i < solarPivots.length; i++) solarPivots[i].rotation.x = tilt;
    // Blinking nav beacons (sharp on/off pulse, each its own phase/rate).
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i];
      b.mat.emissiveIntensity = Math.sin(t * b.rate + b.phase) > 0.55 ? 1.6 : 0.12;
    }
    // Drifting satellites: advance orbit angle, write position component-wise.
    for (let i = 0; i < sats.length; i++) {
      const s = sats[i];
      s.ang += s.rate * dt;
      const c = Math.cos(s.ang), sn = Math.sin(s.ang);
      s.group.position.set(s.cx + c * s.r, s.cy + sn * s.r * s.tilt, s.cz + sn * s.r);
      s.group.rotation.y += s.spin * dt;
    }
    // Tumbling asteroids on wide slow orbits.
    for (let i = 0; i < asteroids.length; i++) {
      const a = asteroids[i];
      a.ang += a.rate * dt;
      const c = Math.cos(a.ang), sn = Math.sin(a.ang);
      a.group.position.set(a.cx + c * a.r, a.cy + sn * a.r * 0.2, a.cz + sn * a.r);
      a.group.rotation.x += a.rx * dt;
      a.group.rotation.y += a.ry * dt;
      a.group.rotation.z += a.rz * dt;
    }
    // Subtle starfield twinkle (one cheap global scalar).
    starMat.opacity = 0.78 + Math.sin(t * 1.3) * 0.14;
  }

  return {
    group,
    update,
    ground,
    colliders,
    rocketSpawn,
    pad,
    // (not part of the required contract, but handy for the rocket/HUD/minimap)
    stationY,
    stationCenter: SC,
  };
}
