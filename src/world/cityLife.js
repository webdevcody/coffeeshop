// Ambient city life: low-poly vehicles that DRIVE looping circuits along the road
// grid, pedestrians (walkers, joggers, dog-walkers, idlers who look around, a
// street musician, plus a cyclist sharing the road) that stroll the sidewalks and
// occasionally pause at corners/crossings, and a small flock of birds wheeling
// overhead. Pure decoration — no colliders, no gameplay, nothing the player can
// hit. It exists to make the streets feel alive.
//
// World facts it relies on (right-handed, Y-up): avenues run along Z at
// X∈{-60,0,60} from Z=8..277; cross streets run along X at Z∈{35,95,155,215}
// from X=-122..122; roads are ~12m wide with the surface at y≈0.03. Vehicles hug
// the right-hand lane (lane offset chosen from heading) and wrap at the segment
// ends. Bigger vehicles (bus/truck) sit further from the centre so they don't
// clip the parked cars at the kerb. The plaza zone sits near (x≈-90..-60, z≈65)
// and the market near (x≈0..60, z≈65); crowd density is nudged up there.
//
// Performance: geometries + materials are shared, vehicles/peds are driven by
// tiny preallocated state records, birds use a single InstancedMesh, and
// update(dt) does ZERO allocation — all math reuses module-level scratch and
// writes straight into object transforms / the instance matrix buffer.

import * as THREE from "three";
import { buildWildlife } from "./wildlife.js";

const NEAR = 13, FAR = 277, LEFT = -122, RIGHT = 122; // match cityStreets: keep traffic out of the cafe (front wall z=11)
const VROADS = [-60, 0, 60];          // avenues — run along Z
const HROADS = [35, 95, 155, 215];    // cross streets — run along X
const HALFR = 6;                      // half the ~12m road width
const LANE = 2.6;                     // distance from centre line to a lane centre
const ROAD_Y = 0.03;                  // road surface height

// Stage-2 distance cull: traffic cars + pedestrians whose XZ is beyond this
// radius from the player stop DRAWING (group.visible=false) and skip their
// per-entity limb/wheel/beacon animation. Their route POSITIONS still advance
// every frame so they're correct the instant you come back into range, and the
// getTraffic()/getPedestrians() lists stay fully live — the cull is render-only,
// so steal-car (E) + rob (R) keep working on far entities. If no player is
// supplied (pre-join) nothing is culled, matching the original behaviour.
const CULL_R = 140, CULL_R2 = CULL_R * CULL_R;

// "Hot" crowd zones (plaza + market sit around z≈65): pedestrians slow and bunch
// when their position falls inside one of these Z bands on the adjacent avenues.
const CROWD_Z_LO = 40, CROWD_Z_HI = 92; // the z≈65 row, between cross streets 35 & 95

// ---- Shared scratch (reused every frame; never reallocated in update) --------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

// A short palette of cheerful low-poly body colours.
const CAR_COLORS = [
  "#d23b3b", "#f0a92e", "#2e8bd2", "#39b35a", "#e8e3da",
  "#7a4fd0", "#e0683c", "#2d3a48", "#d83f86", "#36b8b0",
  "#c0c4c9", "#8a5a2b",
];
const BUS_COLORS = ["#c83b34", "#2f7fc0", "#3a9d4f"];
const TRUCK_COLORS = ["#385066", "#7a4030", "#4a5a2c"];
const TAXI_COLOR = "#f5c518";          // classic taxi yellow
const VAN_COLOR = "#e6e2da";           // delivery van panel white
const EMERGENCY_COLOR = "#e3e6ea";     // ambulance body
const PED_TOPS = ["#c94f4f", "#4f7ec9", "#4faf5c", "#c9a84f", "#9b5fc0", "#d06b3a", "#d8d2c4", "#3a8f8a"];
const PED_BOTS = ["#33384a", "#2d2d33", "#3a2d22", "#26303a", "#4a4038"];
const DOG_COLORS = ["#7a5232", "#1f2024", "#d9c39a", "#9a9a9a"];

// ---- Shared geometry (built once) --------------------------------------------
const GEO = {
  // Unit cube (1×1×1) so every box-ish part can be made by scaling one geometry.
  unit:  new THREE.BoxGeometry(1, 1, 1),
  wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.34, 10),
  bikeWheel: new THREE.TorusGeometry(0.34, 0.045, 6, 16),
  pedHead:  new THREE.SphereGeometry(0.2, 8, 6),
  lamp:  new THREE.BoxGeometry(0.28, 0.22, 0.12),
  // A flat 3-vertex "bird" — a shallow shallow boomerang built from a triangle.
  bird:  birdGeometry(),
};
// Wheels are modelled lying along X then rotated so they roll about X.
GEO.wheel.rotateZ(Math.PI / 2);
GEO.bikeWheel.rotateY(Math.PI / 2); // torus lies in the plane facing X, rolls about X

const MAT = {
  cabin: new THREE.MeshStandardMaterial({ color: "#1b2733", roughness: 0.35, metalness: 0.1 }),
  glass: new THREE.MeshStandardMaterial({ color: "#9fd0e6", roughness: 0.15, metalness: 0.2, emissive: "#243038", emissiveIntensity: 0.25 }),
  tyre:  new THREE.MeshStandardMaterial({ color: "#16171a", roughness: 0.9 }),
  head:  new THREE.MeshStandardMaterial({ color: "#fff4cf", emissive: "#ffe9a8", emissiveIntensity: 0.9, roughness: 0.4 }),
  tail:  new THREE.MeshStandardMaterial({ color: "#5a1414", emissive: "#ff3b30", emissiveIntensity: 0.8, roughness: 0.4 }),
  skin:  new THREE.MeshStandardMaterial({ color: "#e0b48c", roughness: 0.8 }),
  bird:  new THREE.MeshStandardMaterial({ color: "#33373d", roughness: 0.8, side: THREE.DoubleSide }),
  bench: new THREE.MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.85 }),
  metal: new THREE.MeshStandardMaterial({ color: "#3a3f46", roughness: 0.5, metalness: 0.5 }),
  // Taxi "TAXI" roof sign + the red cross panel on the ambulance.
  taxiSign: new THREE.MeshStandardMaterial({ color: "#1a1a1a", emissive: "#ffd23b", emissiveIntensity: 0.7, roughness: 0.5 }),
  cross: new THREE.MeshStandardMaterial({ color: "#cf2b2b", roughness: 0.6 }),
  // Emergency beacon — its emissiveIntensity is driven per-frame in update().
  beacon: new THREE.MeshStandardMaterial({ color: "#b01818", emissive: "#ff2a2a", emissiveIntensity: 0.2, roughness: 0.4 }),
  // Street-musician guitar + a small busking case.
  guitar: new THREE.MeshStandardMaterial({ color: "#a8632a", roughness: 0.6 }),
  caseMat: new THREE.MeshStandardMaterial({ color: "#2a2622", roughness: 0.8 }),
};

// Per-colour body materials are cached so repeated colours share one material.
const _bodyMatCache = new Map();
function bodyMat(color) {
  let m = _bodyMatCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25 });
    _bodyMatCache.set(color, m);
  }
  return m;
}
const _legMatCache = new Map();
function legMat(color) {
  let m = _legMatCache.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 }); _legMatCache.set(color, m); }
  return m;
}
const _topMatCache = new Map();
function topMat(color) {
  let m = _topMatCache.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 }); _topMatCache.set(color, m); }
  return m;
}

// Small helper: a scaled, positioned box reusing the unit cube + a material.
function box(mat, w, h, d, x, y, z, cast) {
  const m = new THREE.Mesh(GEO.unit, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  if (cast) m.castShadow = true;
  return m;
}

function birdGeometry() {
  // A thin V (two wings) lying in the XZ plane, ~0.9m span. Flat-shaded.
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 0.18,     // nose
   -0.45, 0, -0.18, // left wingtip
    0.45, 0, -0.18, // right wingtip
  ]);
  g.setAttribute("position", new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

// ---- Vehicle factory ---------------------------------------------------------
// kind: "car" | "van" | "truck" | "bus" | "taxi" | "emergency".
// Returns { group, wheels:[...], beacon? } — beacon is the flashing-light material
// when present (emergency vehicle), otherwise undefined.
// All bodies are built from the shared unit cube + cached materials.
function makeVehicle(kind, color) {
  const car = new THREE.Group();
  const wheels = [];
  const bm = bodyMat(color);

  if (kind === "bus" || kind === "truck") {
    // Long, tall box vehicles. Truck = cab + cargo box; bus = one long body.
    const len = kind === "bus" ? 8.4 : 7.2;
    const w = kind === "bus" ? 2.4 : 2.3;
    const bodyH = kind === "bus" ? 2.5 : 1.4;
    const bodyY = 0.95 + bodyH / 2 - 0.35;

    if (kind === "truck") {
      // Cab at front (+Z) then a tall cargo box behind it.
      car.add(box(bm, w, 1.5, 2.4, 0, 1.05, len / 2 - 1.2, true));
      car.add(box(MAT.cabin, w * 0.92, 0.7, 1.6, 0, 1.55, len / 2 - 1.2, true)); // cab roof/window block
      car.add(box(MAT.glass, w * 0.85, 0.5, 0.1, 0, 1.55, len / 2 - 0.42));      // windshield
      const cargo = box(bodyMat(color), w, 2.0, len - 3.2, 0, 1.55, -0.6, true);
      car.add(cargo);
    } else {
      // Bus: one long body with a glass band of windows.
      car.add(box(bm, w, bodyH, len, 0, bodyY, 0, true));
      car.add(box(MAT.glass, w * 1.01, 0.7, len * 0.86, 0, bodyY + 0.45, 0));
      car.add(box(MAT.cabin, w * 1.005, 0.35, len * 0.9, 0, bodyY + 1.05, 0)); // roof trim
    }

    // Lamps.
    for (const sx of [-0.75, 0.75]) {
      car.add(box(MAT.head, 0.3, 0.24, 0.12, sx, 0.7, len / 2));
      car.add(box(MAT.tail, 0.3, 0.24, 0.12, sx, 0.7, -len / 2));
    }
    // Six wheels (two axles front, one rear pair set back) for the big rigs.
    for (const sx of [-1.05, 1.05]) for (const sz of [len / 2 - 1.4, -len / 2 + 1.9, -len / 2 + 0.9]) {
      const wl = new THREE.Mesh(GEO.wheel, MAT.tyre);
      wl.position.set(sx, 0.42, sz);
      car.add(wl);
      wheels.push(wl);
    }
    return { group: car, wheels };
  }

  // --- Light vehicles: car / van / taxi / emergency --------------------------
  const isVan = kind === "van";
  const isEmergency = kind === "emergency";
  const isTaxi = kind === "taxi";
  // Vans + ambulance share the longer body; the ambulance is a touch taller.
  const len = (isVan || isEmergency) ? 4.6 : 4.0;
  const w = 2.0;
  const bodyH = 0.7;

  const body = box(bm, w, bodyH, len, 0, 0.6, 0, true);
  car.add(body);

  // Cabin: vans/ambulance get a tall full-length box; cars/taxis a short greenhouse.
  if (isVan || isEmergency) {
    const boxH = isEmergency ? 1.15 : 0.95;
    car.add(box(MAT.cabin, w * 0.88, boxH, len * 0.62, 0, 0.85 + boxH / 2, -0.2, true));
    car.add(box(MAT.glass, w * 0.9, 0.45, len * 0.58, 0, 1.55, -0.2));
    car.add(box(MAT.glass, w * 0.85, 0.4, 0.1, 0, 1.4, len * 0.31)); // windshield
    if (isEmergency) {
      // Red cross panels on the two flanks + a flashing roof beacon.
      for (const sx of [-1, 1]) car.add(box(MAT.cross, 0.05, 0.5, 0.5, sx * (w / 2), 1.25, -0.4));
      car.add(box(MAT.cross, 0.5, 0.5, 0.05, 0, 1.25, -len / 2 + 0.05)); // rear cross
    }
  } else {
    car.add(box(MAT.cabin, w * 0.85, 0.65, 2.0, 0, 1.12, -0.1, true));
    const glass = box(MAT.glass, w * 0.86, 0.36, 2.04, 0, 1.16, -0.1);
    car.add(glass);
    if (isTaxi) {
      // Lit "TAXI" sign on the roof + a couple of dark checker squares.
      car.add(box(MAT.taxiSign, 0.7, 0.22, 0.32, 0, 1.55, -0.1));
      for (const sx of [-0.55, 0.55]) car.add(box(MAT.cabin, 0.45, 0.06, 0.45, sx, 0.95, 0));
    }
  }

  // Headlights (front = +Z) and tail lights (back = -Z).
  for (const sx of [-0.6, 0.6]) {
    car.add(box(MAT.head, 0.28, 0.22, 0.12, sx, 0.6, len / 2));
    car.add(box(MAT.tail, 0.28, 0.22, 0.12, sx, 0.6, -len / 2));
  }

  let beacon = null;
  if (isEmergency) {
    // A small light bar on the roof; we hand its material back so update() can
    // pulse emissiveIntensity for a subtle flash (no per-frame allocation).
    car.add(box(MAT.beacon, 0.9, 0.16, 0.3, 0, 2.05, 0.6));
    beacon = MAT.beacon;
  }

  // Four wheels; keep references so update() can spin them.
  for (const sx of [-0.95, 0.95]) for (const sz of [-(len / 2 - 0.7), (len / 2 - 0.7)]) {
    const wl = new THREE.Mesh(GEO.wheel, MAT.tyre);
    wl.position.set(sx, 0.42, sz);
    car.add(wl);
    wheels.push(wl);
  }
  return { group: car, wheels, beacon };
}

// A lean low-poly cyclist + bicycle, sharing the road (hugs the lane like a car).
// Returns { group, wheels:[2], legs:[2] }. Built facing +Z (heading).
function makeCyclist(top, bot) {
  const g = new THREE.Group();
  // Frame.
  g.add(box(MAT.metal, 0.06, 0.06, 1.0, 0, 0.62, 0));      // top tube
  g.add(box(MAT.metal, 0.05, 0.5, 0.05, 0, 0.4, 0.45));    // head tube/fork-ish (front)
  g.add(box(MAT.metal, 0.05, 0.5, 0.05, 0, 0.4, -0.45));   // seat tube (rear)
  g.add(box(MAT.cabin, 0.34, 0.05, 0.18, 0, 0.6, 0.5));    // handlebars
  // Two spoked wheels (torus) that roll about X.
  const wheels = [];
  for (const sz of [0.55, -0.55]) {
    const wl = new THREE.Mesh(GEO.bikeWheel, MAT.tyre);
    wl.position.set(0, 0.34, sz);
    g.add(wl);
    wheels.push(wl);
  }
  // Rider: a compact seated figure leaning forward.
  const torso = box(topMat(top), 0.4, 0.55, 0.26, 0, 0.95, -0.1, true);
  torso.rotation.x = 0.5; // lean into the bars
  g.add(torso);
  const head = new THREE.Mesh(GEO.pedHead, MAT.skin);
  head.position.set(0, 1.2, 0.18);
  g.add(head);
  // Pedalling legs (swing about X around the crank).
  const legs = [];
  const lm = legMat(bot);
  for (const sz of [0.05, -0.05]) {
    const l = box(lm, 0.14, 0.5, 0.14, 0, 0.4, sz);
    l.position.set(0, 0.45, 0);
    g.add(l);
    legs.push(l);
  }
  return { group: g, wheels, legs };
}

// Build one blocky pedestrian, height-scaled. Returns { group, legs:[2], arms:[2] }.
// arms hang at the sides; idle/jogger/musician records animate them in update().
function makePed(top, bot, height) {
  const p = new THREE.Group();
  const s = height; // 1.0 = adult; <1 = child/shorter
  p.add(box(topMat(top), 0.45 * s, 0.7 * s, 0.28 * s, 0, 1.05 * s, 0, true));
  const head = new THREE.Mesh(GEO.pedHead, MAT.skin);
  head.position.y = 1.55 * s; head.scale.setScalar(s); p.add(head);
  const lm = legMat(bot);
  const legs = [];
  for (const sx of [-0.12 * s, 0.12 * s]) {
    const l = box(lm, 0.16 * s, 0.7 * s, 0.18 * s, sx, 0.35 * s, 0);
    p.add(l);
    legs.push(l);
  }
  // Two short arms beside the torso; update() rotates them about X for a swing.
  const arms = [];
  for (const sx of [-0.28 * s, 0.28 * s]) {
    const a = box(topMat(top), 0.12 * s, 0.55 * s, 0.14 * s, sx, 1.05 * s, 0);
    p.add(a);
    arms.push(a);
  }
  return { group: p, legs, arms, head, h: s };
}

// Build a tiny low-poly dog on a leash. Returns { group, legs:[2] }.
function makeDog(color) {
  const d = new THREE.Group();
  const m = legMat(color);
  d.add(box(m, 0.32, 0.34, 0.85, 0, 0.45, 0, true));   // body
  d.add(box(m, 0.26, 0.28, 0.26, 0, 0.62, 0.5));        // head
  d.add(box(m, 0.08, 0.4, 0.08, 0, 0.55, -0.55));       // tail (angled-ish)
  const legs = [];
  for (const sx of [-0.11, 0.11]) for (const sz of [0.3, -0.3]) {
    const l = box(m, 0.1, 0.4, 0.1, sx, 0.2, sz);
    d.add(l);
    legs.push(l);
  }
  return { group: d, legs };
}

// A simple wooden bench (purely visual prop, no state record).
function makeBench(x, z, rotY) {
  const b = new THREE.Group();
  b.add(box(MAT.bench, 1.8, 0.12, 0.5, 0, 0.5, 0, true)); // seat
  b.add(box(MAT.bench, 1.8, 0.5, 0.1, 0, 0.78, -0.2));    // back
  for (const sx of [-0.75, 0.75]) b.add(box(MAT.bench, 0.12, 0.5, 0.45, sx, 0.25, 0)); // legs
  b.position.set(x, 0, z);
  b.rotation.y = rotY;
  return b;
}

export function buildCityLife() {
  const group = new THREE.Group();
  group.name = "cityLife";

  // -------------------- VEHICLES ---------------------------------------------
  // Each vehicle gets a route record describing the straight segment it loops on.
  //   axis: "z" (drives along Z on an avenue) or "x" (along a cross street)
  //   dir: +1 or -1 travel direction
  //   lo/hi: segment bounds along the travelling axis
  //   pos: current position along the travelling axis
  //   speed: m/s, wheelR: wheel radius for spin math
  //   beacon: (emergency only) material whose emissive we pulse each frame
  // Lane offset hugs the right side relative to heading (right-hand traffic).
  const cars = [];
  let ci = 0;

  // Kind picker — mostly cars, with a van, truck, bus, taxi and one ambulance
  // sprinkled in so the traffic reads as varied.
  const VKINDS = ["car", "taxi", "van", "car", "truck", "car", "bus", "taxi", "emergency", "car", "van", "car"];
  function pickKind(i) { return VKINDS[i % VKINDS.length]; }
  function pickColor(kind, i) {
    if (kind === "bus") return BUS_COLORS[i % BUS_COLORS.length];
    if (kind === "truck") return TRUCK_COLORS[i % TRUCK_COLORS.length];
    if (kind === "taxi") return TAXI_COLOR;
    if (kind === "van") return VAN_COLOR;
    if (kind === "emergency") return EMERGENCY_COLOR;
    return CAR_COLORS[i % CAR_COLORS.length];
  }
  // Big vehicles ride a wider lane so they clear the kerb-parked cars.
  function laneFor(kind) { return (kind === "bus" || kind === "truck") ? LANE + 0.6 : LANE; }
  function baseSpeed(kind, jitter) {
    if (kind === "bus" || kind === "truck") return 6 + jitter;
    if (kind === "emergency") return 11 + jitter;     // a bit quicker — it's responding
    return 8 + jitter;
  }

  // Several vehicles per avenue, alternating direction and phase so both lanes
  // stay busy. Three groups along Z keep cars spread the length of the avenue.
  for (const x of VROADS) {
    for (let g = 0; g < 3; g++) {
      for (const dir of [1, -1]) {
        const kind = pickKind(ci);
        const lane = x + dir * laneFor(kind);          // right lane for this heading
        const v = makeVehicle(kind, pickColor(kind, ci));
        const speed = baseSpeed(kind, (ci % 5) * 1.3); // varied
        const span = FAR - NEAR;
        const pos = NEAR + ((ci * 53 + g * 91) % Math.floor(span)); // spread starts out
        v.group.position.set(lane, ROAD_Y, pos);
        v.group.rotation.y = dir === 1 ? 0 : Math.PI;  // body faces +Z / -Z
        group.add(v.group);
        cars.push({ group: v.group, wheels: v.wheels, axis: "z", dir, lo: NEAR, hi: FAR, pos, speed, wheelR: 0.42, beacon: v.beacon || null });
        ci++;
      }
    }
  }
  // A couple of vehicles on each cross street, going each way.
  for (let h = 0; h < HROADS.length; h++) {
    const z = HROADS[h];
    for (const dir of [1, -1]) {
      const kind = pickKind(ci);
      const lane = z - dir * laneFor(kind);            // right lane for heading along X
      const v = makeVehicle(kind, pickColor(kind, ci));
      const speed = baseSpeed(kind, (ci % 4) * 1.2);
      const span = RIGHT - LEFT;
      const pos = LEFT + ((ci * 71) % Math.floor(span));
      v.group.position.set(pos, ROAD_Y, lane);
      v.group.rotation.y = dir === 1 ? Math.PI / 2 : -Math.PI / 2; // face +X / -X
      group.add(v.group);
      cars.push({ group: v.group, wheels: v.wheels, axis: "x", dir, lo: LEFT, hi: RIGHT, pos, speed, wheelR: 0.42, beacon: v.beacon || null });
      ci++;
    }
  }

  // A lone cyclist sharing the road on the centre avenue, riding the kerb lane
  // (offset a little further out than the cars so it reads as a bike lane).
  {
    const x = 0, dir = 1;
    const cy = makeCyclist(PED_TOPS[3], PED_BOTS[0]);
    const lane = x + dir * (LANE + 1.3);
    cy.group.position.set(lane, ROAD_Y, NEAR + 40);
    cy.group.rotation.y = 0;
    group.add(cy.group);
    cars.push({ group: cy.group, wheels: cy.wheels, legs: cy.legs, axis: "z", dir,
                lo: NEAR, hi: FAR, pos: NEAR + 40, speed: 4.6, wheelR: 0.34, beacon: null, isBike: true, phase: 0.6 });
  }

  // -------------------- PEDESTRIANS ------------------------------------------
  // Walkers stroll the sidewalk just outside an avenue kerb, looping along Z.
  // Behaviours: "walk" (default), "jog" (faster, big arm swing), and pause logic
  // that occasionally halts a walker near a cross-street (a "crossing") then lets
  // them continue. A couple tow a dog; the seated figure + musician are added
  // separately below.
  const peds = [];
  const dogs = [];
  const SIDEWALK = HALFR + 2.0; // a touch beyond the kerb
  let pj = 0;

  // Helper: is this Z position near one of the cross-street crossings?
  // (used to decide where a paused walker may stop). Kept inline to avoid alloc.
  function nearCrossing(z) {
    for (let i = 0; i < HROADS.length; i++) {
      const d = z - HROADS[i];
      if (d > -10 && d < 10) return true;
    }
    return false;
  }

  for (const x of VROADS) {
    for (const side of [-1, 1]) {
      // Crowd is denser on the avenues that flank the plaza/market row (x≈-60/0/60
      // all border that block) — give those sidewalks an extra couple of peds.
      const count = 4;
      for (let k = 0; k < count; k++) {
        const dir = k % 2 === 0 ? 1 : -1;
        const height = pj % 5 === 0 ? 0.72 : (0.92 + (pj % 3) * 0.07); // a child now and then
        const ped = makePed(PED_TOPS[pj % PED_TOPS.length], PED_BOTS[pj % PED_BOTS.length], height);
        const fixed = x + side * SIDEWALK;
        const pos = NEAR + ((pj * 41) % Math.floor(FAR - NEAR));
        ped.group.position.set(fixed, 0, pos);
        ped.group.rotation.y = dir === 1 ? 0 : Math.PI;
        group.add(ped.group);

        // Every 4th walker (adult only) is a dog-walker.
        let dog = null;
        if (pj % 4 === 1) {
          const dg = makeDog(DOG_COLORS[pj % DOG_COLORS.length]);
          // Dog walks ahead of the owner along the heading, on the kerb side.
          dg.group.position.set(fixed + side * 0.5, 0, pos + dir * 1.6);
          dg.group.rotation.y = dir === 1 ? 0 : Math.PI;
          group.add(dg.group);
          dog = { group: dg.group, legs: dg.legs, fixed: fixed + side * 0.5, ahead: 1.6 };
        }

        // Behaviour mix: every 6th adult jogs; the rest walk. Joggers don't pause.
        const isJogger = pj % 6 === 3 && height > 0.85;
        const base = isJogger ? 3.0 + (pj % 3) * 0.3 : 1.3 + (pj % 3) * 0.25;
        const rec = { group: ped.group, legs: ped.legs, arms: ped.arms, fixed, dir,
                      lo: NEAR, hi: FAR, pos, speed: base, baseSpeed: base,
                      phase: pj * 1.7, dog,
                      mode: isJogger ? "jog" : "walk",
                      // Pause state: pauseTimer counts down a halt; cooldown gates how
                      // soon another pause can begin. Joggers/dog-walkers never pause.
                      pauseTimer: 0, cooldown: 4 + (pj % 5),
                      canPause: !isJogger && !dog };
        peds.push(rec);
        if (dog) dogs.push(dog);
        pj++;
      }
    }
  }

  // -------------------- CROWD CLUSTER (plaza / market) -----------------------
  // A gentle knot of pedestrians milling around the z≈65 row where the plaza and
  // market sit. They drift along short side streets at low speed and pause often,
  // giving the impression of a busy public square without leaving the road grid.
  for (let c = 0; c < 6; c++) {
    // Spread them across the avenues that border the plaza/market block.
    const x = VROADS[c % VROADS.length];
    const side = (c & 1) ? 1 : -1;
    const fixed = x + side * SIDEWALK;
    const dir = (c % 2 === 0) ? 1 : -1;
    const pos = CROWD_Z_LO + 6 + (c * 7) % (CROWD_Z_HI - CROWD_Z_LO - 12);
    const ped = makePed(PED_TOPS[(c + 2) % PED_TOPS.length], PED_BOTS[c % PED_BOTS.length], 0.9 + (c % 3) * 0.05);
    ped.group.position.set(fixed, 0, pos);
    ped.group.rotation.y = dir === 1 ? 0 : Math.PI;
    group.add(ped.group);
    const base = 0.7 + (c % 3) * 0.15; // ambling
    peds.push({ group: ped.group, legs: ped.legs, arms: ped.arms, fixed, dir,
                lo: CROWD_Z_LO, hi: CROWD_Z_HI, pos, speed: base, baseSpeed: base,
                phase: c * 2.3, dog: null, mode: "walk",
                pauseTimer: 0, cooldown: 1 + (c % 3), canPause: true, crowd: true });
  }

  // -------------------- IDLER (looking around) -------------------------------
  // Someone standing on a corner near the market, slowly turning their head to
  // look around. speed 0 → it never moves; update() bobs + swivels the head.
  {
    const ix = 60 - SIDEWALK, iz = HROADS[0] + 18; // SW corner of the market block
    const idler = makePed(PED_TOPS[5], PED_BOTS[2], 0.96);
    idler.group.position.set(ix, 0, iz);
    idler.group.rotation.y = -Math.PI / 2;
    group.add(idler.group);
    peds.push({ group: idler.group, legs: idler.legs, arms: idler.arms, head: idler.head,
                fixed: ix, dir: 1, lo: iz, hi: iz, pos: iz, speed: 0, baseSpeed: 0,
                phase: 1.1, dog: null, mode: "idle", pauseTimer: 0, cooldown: 0, canPause: false });
  }

  // -------------------- STREET MUSICIAN --------------------------------------
  // A busker standing by the market with a guitar and an open case, gently
  // swaying and strumming (handled in update). Plants a small crowd around them.
  {
    const mx = 0 + SIDEWALK, mz = HROADS[0] + 22;
    const musician = makePed(PED_TOPS[4], PED_BOTS[1], 0.98);
    musician.group.position.set(mx, 0, mz);
    musician.group.rotation.y = -Math.PI / 2; // face the avenue
    // A guitar slung across the body + an open case at the feet.
    const guitar = box(MAT.guitar, 0.12, 0.85, 0.36, 0.25, 1.0, 0.05);
    guitar.rotation.z = 0.5;
    musician.group.add(guitar);
    musician.group.add(box(MAT.caseMat, 0.5, 0.1, 0.9, 0, 0.06, 0.7));
    group.add(musician.group);
    // strumArm is the right arm; update() swings it across the guitar.
    peds.push({ group: musician.group, legs: musician.legs, arms: musician.arms,
                fixed: mx, dir: 1, lo: mz, hi: mz, pos: mz, speed: 0, baseSpeed: 0,
                phase: 0.3, dog: null, mode: "busk", pauseTimer: 0, cooldown: 0, canPause: false,
                baseY: 0 });

    // A few onlookers gathered loosely in front of the busker (very low speed).
    for (let o = 0; o < 3; o++) {
      const ox = mx + 1.4 + o * 0.6, oz = mz + 1.8 + (o % 2) * 1.0;
      const fan = makePed(PED_TOPS[(o + 1) % PED_TOPS.length], PED_BOTS[(o + 2) % PED_BOTS.length], 0.9 + o * 0.04);
      fan.group.position.set(ox, 0, oz);
      fan.group.rotation.y = -Math.PI / 2 + 0.2; // turned toward the music
      group.add(fan.group);
      peds.push({ group: fan.group, legs: fan.legs, arms: fan.arms,
                  fixed: ox, dir: 1, lo: oz, hi: oz, pos: oz, speed: 0, baseSpeed: 0,
                  phase: o * 1.6 + 0.5, dog: null, mode: "watch", pauseTimer: 0, cooldown: 0, canPause: false });
    }
  }

  // -------------------- SEATED FIGURE + BENCH --------------------------------
  // A bench on the +X sidewalk of the centre avenue near the first cross street,
  // with someone sitting on it (legs folded, gentle idle — handled in update).
  {
    const bx = 0 + SIDEWALK, bz = HROADS[0] - 14;
    group.add(makeBench(bx, bz, -Math.PI / 2)); // face the avenue (−X)
    const sitter = makePed(PED_TOPS[2], PED_BOTS[1], 0.95);
    sitter.group.position.set(bx, 0.5, bz);
    sitter.group.rotation.y = -Math.PI / 2;
    // Fold the legs forward so they read as sitting; torso/head ride the seat.
    sitter.legs[0].rotation.x = -1.3;
    sitter.legs[1].rotation.x = -1.3;
    group.add(sitter.group);
    // Store as a "ped" with speed 0 so it just idle-bobs in place.
    peds.push({ group: sitter.group, legs: sitter.legs, arms: sitter.arms, fixed: bx, dir: 1, lo: bz, hi: bz,
                pos: bz, speed: 0, baseSpeed: 0, phase: 2.2, dog: null, mode: "seated",
                pauseTimer: 0, cooldown: 0, canPause: false, seated: true, baseY: 0.5 });
  }

  // -------------------- WILDLIFE (animals + dinosaurs) -----------------------
  // A standalone roaming menagerie that shares the city's roam rectangle (the
  // road-grid span). It builds once here, parents under the cityLife group, and
  // is pumped by cityLife's own update(dt) below so it animates automatically.
  // Its update is allocation-free, matching cityLife's hot-path contract.
  const wildlife = buildWildlife({ bounds: { minX: LEFT, maxX: RIGHT, minZ: NEAR, maxZ: FAR } });
  group.add(wildlife.group);

  // -------------------- BIRDS (InstancedMesh) --------------------------------
  // A small flock that wheels in lazy horizontal circles high above the grid.
  const BIRD_COUNT = 18;
  const birds = new THREE.InstancedMesh(GEO.bird, MAT.bird, BIRD_COUNT);
  birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  birds.frustumCulled = false;
  group.add(birds);
  // Preallocated per-bird flight params (plain numbers — no per-frame objects).
  const birdState = new Array(BIRD_COUNT);
  for (let i = 0; i < BIRD_COUNT; i++) {
    birdState[i] = {
      cx: (i % 3 - 1) * 60 + (i * 17 % 40) - 20, // orbit centre X near an avenue
      cz: NEAR + 30 + (i * 37 % (FAR - NEAR - 60)),
      r: 8 + (i % 4) * 4,                         // orbit radius
      y: 22 + (i % 5) * 3,                        // altitude
      sp: 0.5 + (i % 3) * 0.25,                   // angular speed (rad/s)
      ph: i * 0.9,                                // phase offset
      flap: 5 + (i % 3),                          // wing-flap rate
    };
  }

  // A tiny deterministic pseudo-random number generator so pause decisions vary
  // without allocating or pulling in Math.random's nondeterminism every frame.
  // Returns 0..1; advances the per-ped seed in place.
  function rnd(p) {
    // xorshift-ish on an integer seed stored on the record.
    let s = (p._seed | 0) || ((p.phase * 1000) | 0) || 1;
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    p._seed = s;
    return ((s >>> 0) % 10000) / 10000;
  }

  // -------------------- UPDATE (no allocation) -------------------------------
  let t = 0;
  function update(dt, player) {
    if (!dt) dt = 0;
    t += dt;

    // Player XZ drives the distance cull. When absent (pre-join) haveP is false,
    // so `near` is always true below and everything renders + animates as before.
    // Plain scalars — no per-frame allocation.
    const haveP = !!player;
    const plx = haveP ? player.x : 0;
    const plz = haveP ? player.z : 0;

    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.stolen) continue; // hijacked away by the player — freeze it + keep it hidden
      c.pos += c.dir * c.speed * dt;
      // Wrap around the segment ends, re-entering from the far side.
      if (c.pos > c.hi) c.pos = c.lo + (c.pos - c.hi);
      else if (c.pos < c.lo) c.pos = c.hi - (c.lo - c.pos);
      if (c.axis === "z") c.group.position.z = c.pos;
      else c.group.position.x = c.pos;

      // Distance cull (render-only): far cars stop drawing and skip the wheel /
      // cyclist-leg / beacon work below. Position was already advanced above, so
      // the car is in the right place when you return — and getTraffic() still
      // hands it out for hijacking regardless of visibility.
      const cdx = c.group.position.x - plx, cdz = c.group.position.z - plz;
      const near = !haveP || (cdx * cdx + cdz * cdz) <= CULL_R2;
      if (c.group.visible !== near) c.group.visible = near;
      if (!near) continue;

      // Spin wheels: angular = linear / radius. Same for all wheels on a vehicle.
      const spin = c.speed * dt / c.wheelR * c.dir;
      const w0 = c.wheels[0].rotation.x + spin;
      for (let w = 0; w < c.wheels.length; w++) c.wheels[w].rotation.x = w0;
      // Cyclist: pump the legs in time with the ride.
      if (c.isBike && c.legs) {
        const ls = Math.sin(t * 9 + c.phase) * 0.7;
        c.legs[0].rotation.x = ls;
        c.legs[1].rotation.x = -ls;
      }
      // Emergency beacon: subtle quick flash on the roof bar.
      if (c.beacon) {
        c.beacon.emissiveIntensity = 0.2 + (Math.sin(t * 9.0) > 0 ? 1.5 : 0.0);
      }
    }

    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];

      // ROBBERY reaction + payout-cooldown timers, both set by rob() below. They're
      // plain scalars the rest of this loop reads; ticking them here (not allocating)
      // keeps the hot path allocation-free. While reacting the ped bolts (never pauses).
      if (p.robCooldown > 0) p.robCooldown -= dt;
      const reacting = p.react > 0;
      if (reacting) { p.react -= dt; p.pauseTimer = 0; }

      // Distance cull (render-only): use the ped's current XZ. Far peds (and their
      // dog) stop drawing and skip all limb/bob/swivel animation, but their route
      // position is still advanced below so they're correct when you approach.
      // getPedestrians() still lists them for robbing regardless of visibility.
      const pdx = p.group.position.x - plx, pdz = p.group.position.z - plz;
      const near = !haveP || (pdx * pdx + pdz * pdz) <= CULL_R2;
      if (p.group.visible !== near) p.group.visible = near;
      if (p.dog && p.dog.group.visible !== near) p.dog.group.visible = near;

      if (p.speed > 0 || p.pauseTimer > 0) {
        // ----- Moving walkers/joggers (and ones currently paused) -----
        // Pause logic: when allowed, near a crossing, and off cooldown, a walker
        // may halt for a beat; otherwise it walks. pauseTimer>0 freezes motion.
        if (p.pauseTimer > 0) {
          p.pauseTimer -= dt;
          if (p.pauseTimer <= 0) { p.pauseTimer = 0; p.cooldown = 5 + (p.phase % 4); }
        } else {
          if (p.cooldown > 0) p.cooldown -= dt;
          if (p.canPause && p.cooldown <= 0 && nearCrossing(p.pos) && rnd(p) > 0.985) {
            p.pauseTimer = 1.2 + rnd(p) * 1.8; // stop and wait ~1-3s
          }
        }

        const moving = p.pauseTimer <= 0;
        if (moving) {
          // A panicking (just-robbed) ped sprints away — scale the stride for a flee.
          p.pos += p.dir * p.baseSpeed * (reacting ? 2.7 : 1) * dt;
          if (p.pos > p.hi) p.pos = p.lo + (p.pos - p.hi);
          else if (p.pos < p.lo) p.pos = p.hi - (p.lo - p.pos);
          p.group.position.z = p.pos;
        }

        // Leg/arm swing + bob (RENDER-only — skipped when far). Joggers swing
        // harder and bob higher; while paused the figure settles to a standing
        // idle (tiny sway only).
        if (near) {
          const rate = p.mode === "jog" ? 11 : 7;
          const amp = moving ? (p.mode === "jog" ? 0.9 : 0.5) : 0.0;
          const s = Math.sin(t * rate + p.phase) * amp;
          p.legs[0].rotation.x = s;
          p.legs[1].rotation.x = -s;
          if (p.arms) {
            // arms counter-swing to the legs; joggers pump bent arms.
            p.arms[0].rotation.x = -s * 0.8;
            p.arms[1].rotation.x = s * 0.8;
          }
          const bobAmp = moving ? (p.mode === "jog" ? 0.12 : 0.05) : 0.0;
          p.group.position.y = Math.abs(Math.sin(t * rate + p.phase)) * bobAmp;
        }

        // Keep this walker's dog trotting just ahead (position stays in sync so it
        // doesn't drift off its owner); its leg pumping is skipped when far.
        if (p.dog) {
          let dz = p.pos + p.dir * p.dog.ahead;
          if (dz > p.hi) dz = p.lo + (dz - p.hi);
          else if (dz < p.lo) dz = p.hi - (p.lo - dz);
          p.dog.group.position.z = dz;
          if (near) {
            const ds = (moving ? Math.sin(t * 11 + p.phase) : Math.sin(t * 3 + p.phase) * 0.2) * 0.6;
            p.dog.legs[0].rotation.x = ds;  p.dog.legs[3].rotation.x = ds;
            p.dog.legs[1].rotation.x = -ds; p.dog.legs[2].rotation.x = -ds;
          }
        }
      } else if (near && p.mode === "idle") {
        // Standing and looking around: slow head swivel + a faint weight shift.
        if (p.head) p.head.rotation.y = Math.sin(t * 0.7 + p.phase) * 0.8;
        p.group.position.y = Math.abs(Math.sin(t * 1.3 + p.phase)) * 0.01;
        // occasional ankle shift so the body isn't dead-still
        const sway = Math.sin(t * 0.9 + p.phase) * 0.03;
        p.legs[0].rotation.x = sway; p.legs[1].rotation.x = -sway;
      } else if (near && p.mode === "busk") {
        // Street musician: gentle body sway + a strumming right arm.
        p.group.position.y = Math.abs(Math.sin(t * 1.6 + p.phase)) * 0.02;
        p.group.rotation.z = Math.sin(t * 1.2 + p.phase) * 0.04;
        if (p.arms) p.arms[1].rotation.x = Math.sin(t * 6 + p.phase) * 0.7; // strum hand
        if (p.head) p.head.rotation.y = Math.sin(t * 0.8) * 0.2;
      } else if (near && p.mode === "watch") {
        // Onlooker: tiny bob + occasional head turn, weight on one foot.
        p.group.position.y = Math.abs(Math.sin(t * 1.4 + p.phase)) * 0.012;
        if (p.head) p.head.rotation.y = Math.sin(t * 0.5 + p.phase) * 0.3;
      } else if (near && p.seated) {
        // Idle: a tiny breathing bob, legs stay folded.
        p.group.position.y = p.baseY + Math.sin(t * 2 + p.phase) * 0.015;
      }

      // ROBBERY pose override: regardless of the ped's usual behaviour, while the
      // reaction flag is hot both arms are thrown overhead with a fast scared bob.
      // (Only when visible — a just-robbed ped is by definition right next to you.)
      if (near && reacting && p.arms) {
        p.arms[0].rotation.x = -2.7;
        p.arms[1].rotation.x = -2.7;
        const baseY = p.baseY || 0;
        p.group.position.y = baseY + Math.abs(Math.sin(t * 13 + p.phase)) * 0.06;
      }
    }

    // Birds: orbit horizontally, banked, with a flapping wing scale on Y.
    for (let i = 0; i < BIRD_COUNT; i++) {
      const b = birdState[i];
      const a = t * b.sp + b.ph;
      _pos.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(a * 2) * 1.2, b.cz + Math.sin(a) * b.r);
      // Heading = tangent of the circle; yaw so the nose leads the orbit.
      _q.setFromAxisAngle(_up, -a + Math.PI / 2);
      const flap = 0.55 + Math.abs(Math.sin(t * b.flap + b.ph)) * 0.85;
      _scl.set(1, flap, 1);
      _m.compose(_pos, _q, _scl);
      birds.setMatrixAt(i, _m);
    }
    birds.instanceMatrix.needsUpdate = true;

    // Advance the roaming wildlife in lock-step with the rest of city life.
    wildlife.update(dt);
  }

  // ---- STEAL / ROB hooks (GTA) ----------------------------------------------
  // Gameplay (rides.js / main.js) reads these on a KEY PRESS only — never per
  // frame — so building the small descriptor arrays here is fine (the hot path
  // update() above stays allocation-free; rob() just sets per-ped scalars it reads).
  //
  // getTraffic(): the roaming CARS you can hijack, each { x, z, heading, hide() }.
  //   hide() raises the `stolen` flag the update loop skips, so the car vanishes and
  //   the player's drivable car is yoinked into its place. Bikes are excluded.
  function getTraffic() {
    const out = [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.stolen || c.isBike) continue; // already taken, or it's the cyclist (not a car)
      out.push({
        x: c.group.position.x,
        z: c.group.position.z,
        heading: c.group.rotation.y, // heading == rotation.y (forward = (sin h, cos h))
        hide() { c.stolen = true; c.group.visible = false; },
      });
    }
    return out;
  }

  // getPedestrians(): the people you can rob, each { x, z, rob() }. rob() flips a
  //   per-ped hands-up/flee reaction the update reads, returns a one-off $5..$50, and
  //   drops onto a cooldown so a single ped can't be farmed (returns 0 until it clears).
  function getPedestrians() {
    const out = [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      out.push({
        x: p.group.position.x,
        z: p.group.position.z,
        rob() {
          if (p.robCooldown > 0) return 0;            // robbed too recently — no farming
          p.robCooldown = 22;                         // seconds before this ped pays out again
          p.react = 3.0;                              // seconds of hands-up + flee reaction
          return 5 + Math.floor(Math.random() * 46);  // $5..$50 grab
        },
      });
    }
    return out;
  }

  return { group, update, getTraffic, getPedestrians };
}
