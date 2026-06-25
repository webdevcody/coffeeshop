// Ambient city life: low-poly vehicles that DRIVE looping circuits along the road
// grid, pedestrians (some walking dogs, one sitting on a bench) that stroll the
// sidewalks, and a small flock of birds wheeling overhead. Pure decoration — no
// colliders, no gameplay, nothing the player can hit. It exists to make the
// streets feel alive.
//
// World facts it relies on (right-handed, Y-up): avenues run along Z at
// X∈{-60,0,60} from Z=8..277; cross streets run along X at Z∈{35,95,155,215}
// from X=-122..122; roads are ~12m wide with the surface at y≈0.03. Vehicles hug
// the right-hand lane (lane offset chosen from heading) and wrap at the segment
// ends. Bigger vehicles (bus/truck) sit further from the centre so they don't
// clip the parked cars at the kerb.
//
// Performance: geometries + materials are shared, vehicles/peds are driven by
// tiny preallocated state records, birds use a single InstancedMesh, and
// update(dt) does ZERO allocation — all math reuses module-level scratch and
// writes straight into object transforms / the instance matrix buffer.

import * as THREE from "three";

const NEAR = 13, FAR = 277, LEFT = -122, RIGHT = 122; // match cityStreets: keep traffic out of the cafe (front wall z=11)
const VROADS = [-60, 0, 60];          // avenues — run along Z
const HROADS = [35, 95, 155, 215];    // cross streets — run along X
const HALFR = 6;                      // half the ~12m road width
const LANE = 2.6;                     // distance from centre line to a lane centre
const ROAD_Y = 0.03;                  // road surface height

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
const PED_TOPS = ["#c94f4f", "#4f7ec9", "#4faf5c", "#c9a84f", "#9b5fc0", "#d06b3a", "#d8d2c4", "#3a8f8a"];
const PED_BOTS = ["#33384a", "#2d2d33", "#3a2d22", "#26303a", "#4a4038"];
const DOG_COLORS = ["#7a5232", "#1f2024", "#d9c39a", "#9a9a9a"];

// ---- Shared geometry (built once) --------------------------------------------
const GEO = {
  // Unit cube (1×1×1) so every box-ish part can be made by scaling one geometry.
  unit:  new THREE.BoxGeometry(1, 1, 1),
  wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.34, 10),
  pedHead:  new THREE.SphereGeometry(0.2, 8, 6),
  lamp:  new THREE.BoxGeometry(0.28, 0.22, 0.12),
  // A flat 3-vertex "bird" — a shallow shallow boomerang built from a triangle.
  bird:  birdGeometry(),
};
// Wheels are modelled lying along X then rotated so they roll about X.
GEO.wheel.rotateZ(Math.PI / 2);

const MAT = {
  cabin: new THREE.MeshStandardMaterial({ color: "#1b2733", roughness: 0.35, metalness: 0.1 }),
  glass: new THREE.MeshStandardMaterial({ color: "#9fd0e6", roughness: 0.15, metalness: 0.2, emissive: "#243038", emissiveIntensity: 0.25 }),
  tyre:  new THREE.MeshStandardMaterial({ color: "#16171a", roughness: 0.9 }),
  head:  new THREE.MeshStandardMaterial({ color: "#fff4cf", emissive: "#ffe9a8", emissiveIntensity: 0.9, roughness: 0.4 }),
  tail:  new THREE.MeshStandardMaterial({ color: "#5a1414", emissive: "#ff3b30", emissiveIntensity: 0.8, roughness: 0.4 }),
  skin:  new THREE.MeshStandardMaterial({ color: "#e0b48c", roughness: 0.8 }),
  bird:  new THREE.MeshStandardMaterial({ color: "#33373d", roughness: 0.8, side: THREE.DoubleSide }),
  bench: new THREE.MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.85 }),
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
// kind: "car" | "van" | "truck" | "bus". Returns { group, wheels:[...] }.
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

  // --- Light vehicles: "car" (sedan) and "van" -------------------------------
  const isVan = kind === "van";
  const len = isVan ? 4.6 : 4.0;
  const w = 2.0;
  const bodyH = 0.7;

  const body = box(bm, w, bodyH, len, 0, 0.6, 0, true);
  car.add(body);

  // Cabin: vans get a tall full-length box; cars get a short greenhouse pushed back.
  if (isVan) {
    car.add(box(MAT.cabin, w * 0.88, 0.95, len * 0.62, 0, 1.32, -0.2, true));
    car.add(box(MAT.glass, w * 0.9, 0.45, len * 0.58, 0, 1.55, -0.2));
    car.add(box(MAT.glass, w * 0.85, 0.4, 0.1, 0, 1.4, len * 0.31)); // windshield
  } else {
    car.add(box(MAT.cabin, w * 0.85, 0.65, 2.0, 0, 1.12, -0.1, true));
    const glass = box(MAT.glass, w * 0.86, 0.36, 2.04, 0, 1.16, -0.1);
    car.add(glass);
  }

  // Headlights (front = +Z) and tail lights (back = -Z).
  for (const sx of [-0.6, 0.6]) {
    car.add(box(MAT.head, 0.28, 0.22, 0.12, sx, 0.6, len / 2));
    car.add(box(MAT.tail, 0.28, 0.22, 0.12, sx, 0.6, -len / 2));
  }

  // Four wheels; keep references so update() can spin them.
  for (const sx of [-0.95, 0.95]) for (const sz of [-(len / 2 - 0.7), (len / 2 - 0.7)]) {
    const wl = new THREE.Mesh(GEO.wheel, MAT.tyre);
    wl.position.set(sx, 0.42, sz);
    car.add(wl);
    wheels.push(wl);
  }
  return { group: car, wheels };
}

// Build one blocky pedestrian, height-scaled. Returns { group, legs:[2] }.
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
  return { group: p, legs, h: s };
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
  // Lane offset hugs the right side relative to heading (right-hand traffic).
  const cars = [];
  let ci = 0;

  // Kind picker — mostly cars, with the occasional van/truck/bus mixed in.
  const VKINDS = ["car", "car", "van", "car", "truck", "car", "bus", "car", "van", "car"];
  function pickKind(i) { return VKINDS[i % VKINDS.length]; }
  function pickColor(kind, i) {
    if (kind === "bus") return BUS_COLORS[i % BUS_COLORS.length];
    if (kind === "truck") return TRUCK_COLORS[i % TRUCK_COLORS.length];
    return CAR_COLORS[i % CAR_COLORS.length];
  }
  // Big vehicles ride a wider lane so they clear the kerb-parked cars.
  function laneFor(kind) { return (kind === "bus" || kind === "truck") ? LANE + 0.6 : LANE; }

  // Several vehicles per avenue, alternating direction and phase so both lanes
  // stay busy. Three groups along Z keep cars spread the length of the avenue.
  for (const x of VROADS) {
    for (let g = 0; g < 3; g++) {
      for (const dir of [1, -1]) {
        const kind = pickKind(ci);
        const lane = x + dir * laneFor(kind);          // right lane for this heading
        const v = makeVehicle(kind, pickColor(kind, ci));
        const speed = (kind === "bus" || kind === "truck" ? 6 : 8) + (ci % 5) * 1.3; // varied
        const span = FAR - NEAR;
        const pos = NEAR + ((ci * 53 + g * 91) % Math.floor(span)); // spread starts out
        v.group.position.set(lane, ROAD_Y, pos);
        v.group.rotation.y = dir === 1 ? 0 : Math.PI;  // body faces +Z / -Z
        group.add(v.group);
        cars.push({ group: v.group, wheels: v.wheels, axis: "z", dir, lo: NEAR, hi: FAR, pos, speed, wheelR: 0.42 });
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
      const speed = (kind === "bus" || kind === "truck" ? 6 : 8) + (ci % 4) * 1.2;
      const span = RIGHT - LEFT;
      const pos = LEFT + ((ci * 71) % Math.floor(span));
      v.group.position.set(pos, ROAD_Y, lane);
      v.group.rotation.y = dir === 1 ? Math.PI / 2 : -Math.PI / 2; // face +X / -X
      group.add(v.group);
      cars.push({ group: v.group, wheels: v.wheels, axis: "x", dir, lo: LEFT, hi: RIGHT, pos, speed, wheelR: 0.42 });
      ci++;
    }
  }

  // -------------------- PEDESTRIANS ------------------------------------------
  // Walkers stroll the sidewalk just outside an avenue kerb, looping along Z.
  // A couple of them tow a dog; one sits on a bench (handled separately below).
  const peds = [];
  const dogs = [];
  const SIDEWALK = HALFR + 2.0; // a touch beyond the kerb
  let pj = 0;
  for (const x of VROADS) {
    for (const side of [-1, 1]) {
      // Three pedestrians per sidewalk, offset in phase, mixed walking dirs.
      for (let k = 0; k < 3; k++) {
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

        const rec = { group: ped.group, legs: ped.legs, fixed, dir, lo: NEAR, hi: FAR,
                      pos, speed: 1.3 + (pj % 3) * 0.25, phase: pj * 1.7, dog };
        peds.push(rec);
        if (dog) dogs.push(dog);
        pj++;
      }
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
    peds.push({ group: sitter.group, legs: sitter.legs, fixed: bx, dir: 1, lo: bz, hi: bz,
                pos: bz, speed: 0, phase: 2.2, dog: null, seated: true, baseY: 0.5 });
  }

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

  // -------------------- UPDATE (no allocation) -------------------------------
  let t = 0;
  function update(dt) {
    if (!dt) dt = 0;
    t += dt;

    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      c.pos += c.dir * c.speed * dt;
      // Wrap around the segment ends, re-entering from the far side.
      if (c.pos > c.hi) c.pos = c.lo + (c.pos - c.hi);
      else if (c.pos < c.lo) c.pos = c.hi - (c.lo - c.pos);
      if (c.axis === "z") c.group.position.z = c.pos;
      else c.group.position.x = c.pos;
      // Spin wheels: angular = linear / radius. Same for all wheels on a vehicle.
      const spin = c.speed * dt / c.wheelR * c.dir;
      const w0 = c.wheels[0].rotation.x + spin;
      for (let w = 0; w < c.wheels.length; w++) c.wheels[w].rotation.x = w0;
    }

    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p.speed > 0) {
        p.pos += p.dir * p.speed * dt;
        if (p.pos > p.hi) p.pos = p.lo + (p.pos - p.hi);
        else if (p.pos < p.lo) p.pos = p.hi - (p.lo - p.pos);
        p.group.position.z = p.pos;
        // Leg swing + a little bob so they read as walking, not sliding.
        const s = Math.sin(t * 7 + p.phase) * 0.5;
        p.legs[0].rotation.x = s;
        p.legs[1].rotation.x = -s;
        p.group.position.y = Math.abs(Math.sin(t * 7 + p.phase)) * 0.05;
        // Keep this walker's dog trotting just ahead, legs pumping.
        if (p.dog) {
          let dz = p.pos + p.dir * p.dog.ahead;
          if (dz > p.hi) dz = p.lo + (dz - p.hi);
          else if (dz < p.lo) dz = p.hi - (p.lo - dz);
          p.dog.group.position.z = dz;
          const ds = Math.sin(t * 11 + p.phase) * 0.6;
          p.dog.legs[0].rotation.x = ds;  p.dog.legs[3].rotation.x = ds;
          p.dog.legs[1].rotation.x = -ds; p.dog.legs[2].rotation.x = -ds;
        }
      } else if (p.seated) {
        // Idle: a tiny breathing bob, legs stay folded.
        p.group.position.y = p.baseY + Math.sin(t * 2 + p.phase) * 0.015;
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
  }

  return { group, update };
}
