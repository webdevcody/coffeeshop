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
// 10 richly-detailed themed interior modules strung along the station deck.
import { buildStationCommand } from "./station/command.js";
import { buildStationObservation } from "./station/observation.js";
import { buildStationLab } from "./station/lab.js";
import { buildStationGarden } from "./station/garden.js";
import { buildStationQuarters } from "./station/quarters.js";
import { buildStationMedbay } from "./station/medbay.js";
import { buildStationEngineering } from "./station/engineering.js";
import { buildStationCargo } from "./station/cargo.js";
import { buildStationRecreation } from "./station/recreation.js";
import { buildStationGalley } from "./station/galley.js";

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
// Walkable STATION INTERIOR — deck, hull walls, ceiling glow, framed viewport glass,
// consoles, handrails, airlock, and a big Earth hanging out the window.
const deckMat       = new THREE.MeshStandardMaterial({ color: "#3a4048", roughness: 0.7, metalness: 0.45 });
const wallMat       = new THREE.MeshStandardMaterial({ color: "#c8ced6", roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide });
const wallRibMat    = new THREE.MeshStandardMaterial({ color: "#9aa3ad", roughness: 0.5, metalness: 0.45 });
const ceilMat       = new THREE.MeshStandardMaterial({ color: "#aab2bb", roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
const ceilStripMat  = new THREE.MeshStandardMaterial({ color: "#eef4ff", roughness: 0.3, emissive: "#bfe0ff", emissiveIntensity: 0.9 });
const frameMat      = new THREE.MeshStandardMaterial({ color: "#5a626b", roughness: 0.4, metalness: 0.7 });
const glassMat      = new THREE.MeshStandardMaterial({ color: "#0a1830", roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, emissive: "#0a1428", emissiveIntensity: 0.2 });
const consoleMat    = new THREE.MeshStandardMaterial({ color: "#3d444c", roughness: 0.5, metalness: 0.5 });
const railMat       = new THREE.MeshStandardMaterial({ color: "#d8a23a", roughness: 0.4, metalness: 0.6, emissive: "#3a2a00", emissiveIntensity: 0.2 });
const airlockMat    = new THREE.MeshStandardMaterial({ color: "#80878f", roughness: 0.5, metalness: 0.6 });
const earthMat      = new THREE.MeshStandardMaterial({ color: "#2a5a9a", roughness: 0.9, metalness: 0.0, emissive: "#0e2240", emissiveIntensity: 0.35, flatShading: true, fog: false });
const earthLandMat  = new THREE.MeshStandardMaterial({ color: "#3f8a55", roughness: 1.0, fog: false });
const earthCloudMat = new THREE.MeshStandardMaterial({ color: "#eef4fb", roughness: 1.0, transparent: true, opacity: 0.6, fog: false });

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
  // Interior contract (kept SEPARATE from the y=0 `ground`/`colliders`): these rects
  // live up at the station altitude. Player code lifts you to `stationFloorY` while
  // you stand on a `stationGround` rect; `stationColliders` block you inside.
  const stationGround = [];    // walkable interior deck rects (world XZ; lifted to stationFloorY)
  const stationColliders = []; // interior walls / consoles (world XZ AABBs)
  const stationModuleUpdates = []; // per-frame update fns of the 10 themed interior modules

  // Animated handles collected at build → mutated allocation-free in update().
  const beacons = [];    // { mat, rate, phase }  blinking nav lights
  const sats = [];       // { group, cx, cy, cz, r, ang, rate, tilt, spin }
  const asteroids = [];  // { group, cx, cy, cz, r, ang, rate, rx, ry, rz }
  const solarPivots = []; // station solar-wing roots (gentle sun-tracking tilt)
  const screens = [];     // interior console / holo screens { mat, rate, phase }
  const floatProps = [];  // low-g bobbing props { mesh, baseY, amp, rate, phase, spin }

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

  // ── 10) WALKABLE STATION INTERIOR ──────────────────────────────────────────
  // A self-contained pressurised module you can actually STAND inside: a docking
  // airlock → corridor → control room with consoles + a big viewport onto Earth.
  // It sits at the STATION altitude but is OFFSET far EAST of the city footprint
  // (city is x[-120,120] z[40,275]) to a clear patch at (IX,IZ), so its floor rects
  // never collide with the y=0 city ground at the same XZ. Deck top is at world
  // y = stationFloorY; the player code lifts you onto it on the `stationGround`
  // rects (returned separately from the y=0 `ground`).
  const IX = 300, IZ = 130;          // interior footprint centre (clear of the city)
  const stationFloorY = stationY;    // 260 — interior deck sits at station altitude
  const WALL_H = 5, WALL_T = 0.4;

  // The HEAVY station interior (control room + 10 detailed modules + hull + fill
  // lights + Earth) lives in its OWN sub-group so main.js can hide it while you're
  // down in the city — it's ~400 m away at y=260 and invisible from the city anyway
  // — WITHOUT hiding the launchpad / rocket / orbital shell, which stay in `group`.
  const stationInterior = new THREE.Group();
  group.add(stationInterior);

  const interior = new THREE.Group();
  interior.position.set(IX, stationFloorY, IZ);
  stationInterior.add(interior);

  // Deck slab + walkable rect (world coords). Top face at interior-local y=0.
  function addDeck(minX, maxX, minZ, maxZ) {
    const w = maxX - minX, d = maxZ - minZ;
    const deck = box(w, 0.3, d, deckMat, false, true);
    deck.position.set((minX + maxX) / 2, -0.15, (minZ + maxZ) / 2);
    interior.add(deck);
    stationGround.push({ minX: IX + minX, maxX: IX + maxX, minZ: IZ + minZ, maxZ: IZ + maxZ });
  }
  // Full-height solid wall + its XZ collider (world coords).
  function addWall(cx, cz, w, d) {
    const wl = box(w, WALL_H, d, wallMat, false, true);
    wl.position.set(cx, WALL_H / 2, cz);
    interior.add(wl);
    addAABB(stationColliders, IX + cx, IZ + cz, w, d);
  }
  // Flat ceiling panel + a glow strip (cosmetic, no collider).
  function addCeiling(cx, cz, w, d) {
    const cl = box(w, 0.3, d, ceilMat, false, false);
    cl.position.set(cx, WALL_H, cz);
    interior.add(cl);
    const strip = box(w * 0.5, 0.08, 0.5, ceilStripMat, false, false);
    strip.position.set(cx, WALL_H - 0.22, cz);
    interior.add(strip);
  }

  // Decks: control room (24×18), corridor (12×6), docking airlock (12×10).
  addDeck(-12, 12, -9, 9);
  addDeck(-24, -12, -3, 3);
  addDeck(-36, -24, -5, 5);
  addCeiling(0, 0, 24, 18);
  addCeiling(-18, 0, 12, 6);
  addCeiling(-30, 0, 12, 10);

  // Control-room walls. The +X wall is the big VIEWPORT — collider only here, the
  // glazing is built below; the -X wall has a doorway through to the corridor.
  addAABB(stationColliders, IX + 12, IZ + 0, WALL_T, 18);
  addWall(0, 9, 24, WALL_T);    // +Z
  addWall(0, -9, 24, WALL_T);   // -Z (console wall)
  addWall(-12, 6, WALL_T, 6);   // -X upper (doorway gap z[-3,3])
  addWall(-12, -6, WALL_T, 6);  // -X lower
  // Corridor walls.
  addWall(-18, 3, 12, WALL_T);
  addWall(-18, -3, 12, WALL_T);
  // Airlock walls (back-wall flanks of the corridor doorway, sides, outer bulkhead).
  addWall(-24, 4, WALL_T, 2);
  addWall(-24, -4, WALL_T, 2);
  addWall(-30, 5, 12, WALL_T);
  addWall(-30, -5, 12, WALL_T);
  addWall(-36, 0, WALL_T, 10);  // outer docking bulkhead (hatch is cosmetic)

  // Structural ribs down the control-room +Z wall (cosmetic).
  for (const rx of [-9, -3, 3, 9]) {
    const rib = box(0.3, WALL_H, 0.5, wallRibMat, false, false);
    rib.position.set(rx, WALL_H / 2, 8.7);
    interior.add(rib);
  }

  // BIG VIEWPORT on the +X wall — framed glazing onto the starfield + Earth.
  {
    const openH = WALL_H - 2.4, openCY = openH / 2 + 1.0;
    const header = box(WALL_T, 1.4, 18, frameMat, false, false);
    header.position.set(12, WALL_H - 0.7, 0); interior.add(header);
    const sill = box(WALL_T, 1.0, 18, frameMat, false, false);
    sill.position.set(12, 0.5, 0); interior.add(sill);
    const glass = box(0.12, openH, 17.4, glassMat, false, false);
    glass.position.set(12, openCY, 0); interior.add(glass);
    for (const mz of [-6, -2, 2, 6]) {
      const mull = box(0.22, openH, 0.22, frameMat, false, false);
      mull.position.set(12, openCY, mz); interior.add(mull);
    }
  }

  // CONSOLES along the -Z wall — each a solid collider with an angled glowing screen.
  for (const cxp of [-7, 0, 7]) {
    const baseC = box(3.2, 1.0, 1.2, consoleMat, false, false);
    baseC.position.set(cxp, 0.5, -7.9); interior.add(baseC);
    const scrMat = new THREE.MeshStandardMaterial({ color: "#0a2740", roughness: 0.3, emissive: "#1fa6ff", emissiveIntensity: 0.7 });
    const scr = box(2.8, 1.3, 0.1, scrMat, false, false);
    scr.position.set(cxp, 1.45, -7.35); scr.rotation.x = -0.45; interior.add(scr);
    addAABB(stationColliders, IX + cxp, IZ - 7.9, 3.2, 1.6);
    screens.push({ mat: scrMat, rate: 1.4 + Math.random() * 1.6, phase: Math.random() * 6.28 });
  }

  // Central HOLO-TABLE the crew gathers at (a solid round collider).
  {
    const ped = mesh(new THREE.CylinderGeometry(1.6, 1.9, 1.0, 18), consoleMat, false, false);
    ped.position.set(0, 0.5, 0); interior.add(ped);
    const holoMat = new THREE.MeshStandardMaterial({ color: "#0c3050", roughness: 0.25, emissive: "#37d0ff", emissiveIntensity: 0.6, transparent: true, opacity: 0.85 });
    const holo = mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 18), holoMat, false, false);
    holo.position.set(0, 1.06, 0); interior.add(holo);
    addAABB(stationColliders, IX + 0, IZ + 0, 3.6, 3.6);
    screens.push({ mat: holoMat, rate: 0.9, phase: 2.0 });
  }

  // HANDRAILS lining the corridor (cosmetic — posts + a top bar each side).
  for (const rz of [-2.5, 2.5]) {
    const bar = box(11, 0.12, 0.12, railMat, false, false);
    bar.position.set(-18, 1.0, rz); interior.add(bar);
    for (let px = -23; px <= -13; px += 2.5) {
      const post = mesh(G.antennaGeo, railMat, false, false);
      post.position.set(px, 0.5, rz); interior.add(post);
    }
  }

  // DOCKING HATCH detail on the outer bulkhead + a blinking "clear to dock" light.
  {
    const hatch = mesh(new THREE.TorusGeometry(1.8, 0.22, 10, 24), airlockMat, false, false);
    hatch.rotation.y = Math.PI / 2;
    hatch.position.set(-35.7, 2.2, 0); interior.add(hatch);
    const dockLightMat = new THREE.MeshStandardMaterial({ color: "#37ff7a", roughness: 0.4, emissive: "#19e85f", emissiveIntensity: 1.0 });
    for (const lz of [-2.4, 2.4]) {
      const lt = mesh(G.beaconGeo, dockLightMat, false, false);
      lt.position.set(-35.6, 2.2, lz); interior.add(lt);
    }
    beacons.push({ mat: dockLightMat, rate: 1.4, phase: 0.2 });
  }

  // LOW-G ambience: a couple of props slowly drifting / tumbling in the cabin.
  {
    const crate = box(0.8, 0.8, 0.8, frameMat, false, false);
    crate.position.set(-5, 1.6, 5); interior.add(crate);
    floatProps.push({ mesh: crate, baseY: 1.6, amp: 0.22, rate: 0.8, phase: 0, spin: 0.4 });
    const helm = mesh(new THREE.SphereGeometry(0.4, 12, 8), tankMat, false, false);
    helm.position.set(6, 1.9, 6); interior.add(helm);
    floatProps.push({ mesh: helm, baseY: 1.9, amp: 0.3, rate: 1.1, phase: 1.5, spin: -0.6 });
  }

  // EARTH framed in the viewport — a big blue marble hanging off the +X windows.
  const earth = mesh(new THREE.SphereGeometry(160, 30, 22), earthMat, false, false);
  earth.position.set(IX + 430, stationFloorY - 120, IZ + 30);
  stationInterior.add(earth);
  for (const [ea, eb, es] of [[0.5, 0.3, 60], [-0.6, 0.9, 44], [1.8, -0.4, 52], [2.6, 0.5, 38]]) {
    const land = mesh(new THREE.SphereGeometry(es, 14, 10), earthLandMat, false, false);
    const nx = Math.cos(ea) * Math.cos(eb), ny = Math.sin(eb), nz = Math.sin(ea) * Math.cos(eb);
    land.position.set(nx * 150, ny * 150, nz * 150);
    land.scale.set(1, 1, 0.25);
    earth.add(land);
  }
  for (const [ca, cb, cs] of [[1.1, 0.7, 40], [-1.4, -0.2, 34], [0.2, 1.3, 30]]) {
    const cloud = mesh(new THREE.SphereGeometry(cs, 12, 8), earthCloudMat, false, false);
    const nx = Math.cos(ca) * Math.cos(cb), ny = Math.sin(cb), nz = Math.sin(ca) * Math.cos(cb);
    cloud.position.set(nx * 156, ny * 156, nz * 156);
    cloud.scale.set(1, 1, 0.18);
    earth.add(cloud);
  }

  // Docking + exit spots (world XZ). The rocket parks just OUTSIDE the airlock
  // bulkhead; after E the player stands just INSIDE the airlock, on the deck.
  const dockSpot = { x: IX - 46, z: IZ, heading: Math.PI / 2 };
  const exitSpot = { x: IX - 30, z: IZ };

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
    // Interior ambience: console / holo glow, low-g props bob + tumble, Earth spin.
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      s.mat.emissiveIntensity = 0.55 + Math.sin(t * s.rate + s.phase) * 0.32;
    }
    for (let i = 0; i < floatProps.length; i++) {
      const f = floatProps[i];
      f.mesh.position.y = f.baseY + Math.sin(t * f.rate + f.phase) * f.amp;
      f.mesh.rotation.y += f.spin * dt;
      f.mesh.rotation.x += f.spin * 0.5 * dt;
    }
    earth.rotation.y += dt * 0.008;
    // Pump the 10 themed interior modules (console glow, holograms, robots, etc.).
    for (let i = 0; i < stationModuleUpdates.length; i++) stationModuleUpdates[i](dt);
  }

  // ── 10 THEMED INTERIOR MODULES strung EAST off the control room ──────────────
  // Each is a self-contained, richly-detailed zone at the station altitude on a
  // continuous deck (x≈301..681 at z=IZ): command bridge → observation deck →
  // lab → garden → quarters → medbay → engineering → cargo → recreation → galley.
  // We add each module's GROUP + its walkable GROUND rect + its update, but
  // DELIBERATELY DROP each module's own colliders (their perimeter walls would
  // trap you between zones) and instead wrap the whole run in one OUTER HULL — so
  // you can walk the entire station freely and explore every section.
  const STATION_MODULES = [
    buildStationCommand, buildStationObservation, buildStationLab, buildStationGarden,
    buildStationQuarters, buildStationMedbay, buildStationEngineering, buildStationCargo,
    buildStationRecreation, buildStationGalley,
  ];
  let mox = 320;
  for (const buildMod of STATION_MODULES) {
    const m = buildMod({ ox: mox, oz: IZ, floorY: stationFloorY });
    stationInterior.add(m.group);
    if (Array.isArray(m.ground)) for (const g of m.ground) stationGround.push(g);
    // DROP each module's own colliders so you can walk FREELY through the entire
    // station and explore every zone — keeping them solid turned the 10 chained
    // sealed-room modules into a maze of blocking walls. The outer hull (below) is
    // the only solid boundary, so you can't fall off the sides. (A separate pass
    // also strips the modules' interior divider walls so they don't even look like
    // false walls.)
    if (typeof m.update === "function") stationModuleUpdates.push(m.update);
    // (Per-zone fill PointLights removed for GPU cost — the whole module run is now
    // lit by a few wide-range spanning lights added AFTER the loop, so the per-pixel
    // light loop stays cheap. The modules' emissive surfaces carry the close detail.)
    mox += 38; // contiguous 38 m-wide decks: 320, 358, ... , 662
  }
  // A few WIDE-RANGE fill lights spanning the whole interior run instead of one
  // per zone (was 10 zone + 3 entry = 13 PointLights; now ~4). Three big lights
  // cover the module deck (x≈301..681) and one entry light keeps the airlock /
  // corridor / control room near IX from going dark.
  // Even fill down the whole run. These live in `stationInterior`, which is hidden
  // (group.visible=false) whenever you're not at the station, so Three.js skips them
  // entirely — they cost ZERO when you're in the city and only light the deck when
  // you're actually up here. So we can afford generous, evenly-spaced coverage.
  for (const sx of [330, 385, 440, 495, 550, 605, 660]) {
    const runLight = new THREE.PointLight(0xdce8ff, 34, 72, 1.7);
    runLight.position.set(sx, stationFloorY + 4.4, IZ);
    stationInterior.add(runLight);
  }
  {
    const entryLight = new THREE.PointLight(0xdce8ff, 36, 56, 1.7);
    entryLight.position.set(IX - 8, stationFloorY + 4.4, IZ); // near the control room
    stationInterior.add(entryLight);
  }
  // Outer hull around the whole run (x≈301..681, z = IZ±19): long side walls + an
  // east end cap, as colliders so you can't step off the deck into space; the west
  // end opens onto the existing control room. Cheap visual panels included.
  {
    const runMinX = 301, runMaxX = 681, midX = (runMinX + runMaxX) / 2, runLen = runMaxX - runMinX;
    for (const sz of [-19, 19]) {
      addAABB(stationColliders, midX, IZ + sz, runLen, WALL_T);
      const wl = box(runLen, WALL_H, WALL_T, wallMat, false, true);
      wl.position.set(midX, stationFloorY + WALL_H / 2, IZ + sz);
      stationInterior.add(wl);
    }
    addAABB(stationColliders, runMaxX, IZ, WALL_T, 40);
    const cap = box(WALL_T, WALL_H, 40, wallMat, false, true);
    cap.position.set(runMaxX, stationFloorY + WALL_H / 2, IZ);
    stationInterior.add(cap);
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
    // ── WALKABLE STATION INTERIOR contract (NEW) ──────────────────────────────
    stationGround,                       // walkable interior deck rects (world XZ)
    stationColliders,                    // interior wall / console AABBs (world XZ)
    stationFloorY,                       // world Y the interior deck sits at (260)
    dockSpot,                            // { x, z, heading } rocket parks outside the airlock
    exitSpot,                            // { x, z } player stands here, inside the airlock
    stationInteriorCenter: { x: IX, z: IZ }, // interior footprint centre (300, 130)
    stationInterior,                          // heavy interior sub-group (gated by distance/altitude in main.js)
    stationRenderCenter: { x: 472, z: IZ },   // middle of the module run (x301..681) — gate distance reference
  };
}
