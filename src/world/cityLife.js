// Ambient city life: low-poly cars that DRIVE looping circuits along the road grid
// and pedestrians that stroll the sidewalks. Pure decoration — no colliders, no
// gameplay, nothing the player can hit. It exists to make the streets feel alive.
//
// World facts it relies on (right-handed, Y-up): avenues run along Z at
// X∈{-60,0,60} from Z=8..277; cross streets run along X at Z∈{35,95,155,215}
// from X=-122..122; roads are ~12m wide with the surface at y≈0.03. Cars hug the
// right-hand lane (lane offset chosen from heading) and wrap at the segment ends.
//
// Performance: geometries + materials are shared, every car/ped is driven by a
// tiny preallocated state record, and update(dt) does ZERO allocation — all math
// reuses module-level scratch and writes straight into object transforms.

import * as THREE from "three";

const NEAR = 8, FAR = 277, LEFT = -122, RIGHT = 122;
const VROADS = [-60, 0, 60];          // avenues — run along Z
const HROADS = [35, 95, 155, 215];    // cross streets — run along X
const HALFR = 6;                      // half the ~12m road width
const LANE = 2.6;                     // distance from centre line to a lane centre
const ROAD_Y = 0.03;                  // road surface height

// ---- Shared scratch (reused every frame; never reallocated in update) --------
const _v = new THREE.Vector3();

// A short palette of cheerful low-poly car body colours.
const CAR_COLORS = [
  "#d23b3b", "#f0a92e", "#2e8bd2", "#39b35a", "#e8e3da",
  "#7a4fd0", "#e0683c", "#2d3a48", "#d83f86", "#36b8b0",
];
const PED_TOPS = ["#c94f4f", "#4f7ec9", "#4faf5c", "#c9a84f", "#9b5fc0", "#d06b3a"];
const PED_BOTS = ["#33384a", "#2d2d33", "#3a2d22", "#26303a"];

// ---- Shared geometry (built once) --------------------------------------------
const GEO = {
  body:  new THREE.BoxGeometry(2.0, 0.7, 4.0),
  cabin: new THREE.BoxGeometry(1.7, 0.65, 2.0),
  wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.34, 10),
  pedTorso: new THREE.BoxGeometry(0.45, 0.7, 0.28),
  pedHead:  new THREE.SphereGeometry(0.2, 8, 6),
  pedLeg:   new THREE.BoxGeometry(0.16, 0.7, 0.18),
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
};
// Small shared geo for car lamps.
GEO.lamp = new THREE.BoxGeometry(0.28, 0.22, 0.12);

// Build one low-poly car as a Group. Returns { group, wheels:[4] }.
function makeCar(color) {
  const car = new THREE.Group();

  const body = new THREE.Mesh(GEO.body, new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25 }));
  body.position.y = 0.6;
  body.castShadow = true;
  car.add(body);

  const cabin = new THREE.Mesh(GEO.cabin, MAT.cabin);
  cabin.position.set(0, 1.12, -0.1);
  cabin.castShadow = true;
  car.add(cabin);
  // Glass band so the cabin reads as windows, not a black block.
  const glass = new THREE.Mesh(GEO.cabin, MAT.glass);
  glass.scale.set(1.01, 0.55, 1.02);
  glass.position.set(0, 1.16, -0.1);
  car.add(glass);

  // Headlights (front = +Z) and tail lights (back = -Z).
  for (const sx of [-0.6, 0.6]) {
    const h = new THREE.Mesh(GEO.lamp, MAT.head);
    h.position.set(sx, 0.6, 2.0); car.add(h);
    const t = new THREE.Mesh(GEO.lamp, MAT.tail);
    t.position.set(sx, 0.6, -2.0); car.add(t);
  }

  // Four wheels; keep references so update() can spin them.
  const wheels = [];
  for (const sx of [-0.95, 0.95]) for (const sz of [-1.3, 1.3]) {
    const w = new THREE.Mesh(GEO.wheel, MAT.tyre);
    w.position.set(sx, 0.42, sz);
    car.add(w);
    wheels.push(w);
  }
  return { group: car, wheels };
}

// Build one blocky pedestrian. Returns { group, legs:[2] }.
function makePed(top, bot) {
  const p = new THREE.Group();
  const torso = new THREE.Mesh(GEO.pedTorso, new THREE.MeshStandardMaterial({ color: top, roughness: 0.85 }));
  torso.position.y = 1.05; torso.castShadow = true; p.add(torso);
  const head = new THREE.Mesh(GEO.pedHead, MAT.skin);
  head.position.y = 1.55; p.add(head);
  const legMat = new THREE.MeshStandardMaterial({ color: bot, roughness: 0.85 });
  const legs = [];
  for (const sx of [-0.12, 0.12]) {
    const l = new THREE.Mesh(GEO.pedLeg, legMat);
    l.position.set(sx, 0.35, 0);
    p.add(l);
    legs.push(l);
  }
  return { group: p, legs };
}

export function buildCityLife() {
  const group = new THREE.Group();
  group.name = "cityLife";

  // -------------------- CARS --------------------------------------------------
  // Each car gets a route record describing the straight segment it loops along.
  //   axis: "z" (drives along Z on an avenue) or "x" (along a cross street)
  //   fixed: the constant coordinate (X for avenues, Z for cross streets) incl. lane
  //   dir: +1 or -1 travel direction
  //   lo/hi: segment bounds along the travelling axis
  //   pos: current position along the travelling axis
  //   speed: m/s
  // Lane offset hugs the right side relative to heading (right-hand traffic).
  const cars = [];
  let ci = 0;

  // A handful of cars on each avenue, alternating direction so both lanes are used.
  for (const x of VROADS) {
    for (const dir of [1, -1]) {
      const lane = x + dir * LANE;            // right lane for this heading
      const car = makeCar(CAR_COLORS[ci % CAR_COLORS.length]);
      const speed = 7 + (ci % 4) * 1.6;       // 7..11.8 m/s, varied
      const pos = NEAR + ((ci * 53) % Math.floor(FAR - NEAR)); // spread starts out
      car.group.position.set(lane, ROAD_Y, pos);
      car.group.rotation.y = dir === 1 ? 0 : Math.PI; // body faces +Z / -Z
      group.add(car.group);
      cars.push({ ...car, axis: "z", fixed: lane, dir, lo: NEAR, hi: FAR, pos, speed });
      ci++;
    }
  }
  // A car or two on a few cross streets, going each way.
  for (let h = 0; h < HROADS.length; h++) {
    const z = HROADS[h];
    const dir = h % 2 === 0 ? 1 : -1;
    const lane = z - dir * LANE;             // right lane for heading along X
    const car = makeCar(CAR_COLORS[ci % CAR_COLORS.length]);
    const speed = 8 + (ci % 3) * 1.4;
    const pos = LEFT + ((ci * 71) % Math.floor(RIGHT - LEFT));
    car.group.position.set(pos, ROAD_Y, lane);
    car.group.rotation.y = dir === 1 ? Math.PI / 2 : -Math.PI / 2; // face +X / -X
    group.add(car.group);
    cars.push({ ...car, axis: "x", fixed: lane, dir, lo: LEFT, hi: RIGHT, pos, speed });
    ci++;
  }

  // -------------------- PEDESTRIANS ------------------------------------------
  // Walkers stroll the sidewalk just outside an avenue kerb, looping along Z.
  const peds = [];
  const SIDEWALK = HALFR + 2.0; // a touch beyond the kerb
  let pj = 0;
  for (const x of VROADS) {
    for (const side of [-1, 1]) {
      // Two pedestrians per sidewalk, offset in phase, opposite walking dirs.
      for (let k = 0; k < 2; k++) {
        const dir = k === 0 ? 1 : -1;
        const ped = makePed(PED_TOPS[pj % PED_TOPS.length], PED_BOTS[pj % PED_BOTS.length]);
        const fixed = x + side * SIDEWALK;
        const pos = NEAR + ((pj * 41) % Math.floor(FAR - NEAR));
        ped.group.position.set(fixed, 0, pos);
        ped.group.rotation.y = dir === 1 ? 0 : Math.PI;
        group.add(ped.group);
        peds.push({ ...ped, fixed, dir, lo: NEAR, hi: FAR, pos, speed: 1.3 + (pj % 3) * 0.25, phase: pj * 1.7 });
        pj++;
      }
    }
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
      // Spin wheels: angular = linear / radius (0.42). Same for all four.
      const spin = c.speed * dt / 0.42 * c.dir;
      const w0 = c.wheels[0].rotation.x + spin;
      for (let w = 0; w < c.wheels.length; w++) c.wheels[w].rotation.x = w0;
    }

    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      p.pos += p.dir * p.speed * dt;
      if (p.pos > p.hi) p.pos = p.lo + (p.pos - p.hi);
      else if (p.pos < p.lo) p.pos = p.hi - (p.lo - p.pos);
      p.group.position.z = p.pos;
      // Leg swing + a little bob so they read as walking, not sliding.
      const s = Math.sin(t * 7 + p.phase) * 0.5;
      p.legs[0].rotation.x = s;
      p.legs[1].rotation.x = -s;
      p.group.position.y = Math.abs(Math.sin(t * 7 + p.phase)) * 0.05;
    }
  }

  return { group, update };
}
