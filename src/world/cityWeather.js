// Ambient weather over the city: a slow STATE MACHINE that cycles the sky through
// clear -> overcast -> rain -> clearing on a multi-minute loop, plus the visuals
// that sell each phase. It is pure ambience — no colliders, no gameplay — and is
// designed to be cheap and allocation-free in update(dt):
//
//   CLOUDS   — a handful of drifting low-poly cloud puffs high in the sky. They
//              wrap around the map so the cover is endless. Their opacity is the
//              "overcast" tell: thin/transparent when clear, thick when overcast/raining.
//   RAIN     — ONE InstancedMesh of ~600 thin vertical streaks falling inside a
//              fixed volume that covers the whole play area. Streaks that fall below
//              the ground are recycled back to the top, so a finite pool rains over
//              the entire map for free. Rain fades in/out with the state via material
//              opacity (and the instances simply stop being recycled when fully clear).
//   LIGHTNING— during rain, an occasional distant flash briefly brightens the scene
//              by ramping a big sky-high emissive quad's opacity (a cheap full-scene
//              tint). No render passes, no light objects — just one quad's alpha.
//   WIND     — a slow-evolving scalar (and a 2D direction) that the rest of the
//              update reads to slant the rain and drift the clouds. Exposed on the
//              returned object so OTHER systems could read it (flags, leaves, etc.).
//
// The whole thing lives under one group added to the city group. update(dt) reuses
// module-level scratch and writes straight into instance buffers / transforms — it
// never allocates. Everything that animates has frustumCulled = false so it is never
// wrongly culled when the volume sits behind the camera.

import * as THREE from "three";

// --- Map extents (match cityStreets / cityLife) -------------------------------
// The play area the rain volume must blanket. Centre the volume here; streaks are
// distributed across the full span so the finite pool covers the whole map.
const LEFT = -122, RIGHT = 122, NEAR = 13, FAR = 277;
const CENTER_X = (LEFT + RIGHT) / 2;        // 0
const CENTER_Z = (NEAR + FAR) / 2;          // 145
const SPAN_X = RIGHT - LEFT;                // 244
const SPAN_Z = FAR - NEAR;                  // 264

// --- Rain volume --------------------------------------------------------------
const RAIN_COUNT = 600;
const RAIN_TOP = 70;                        // streaks spawn at this height
const RAIN_BOTTOM = 0;                      // recycle once they fall past ground
const RAIN_FALL = 58;                       // base fall speed (m/s)
const STREAK_LEN = 1.6;                     // half-length of a unit streak (geo is 1m tall, scaled)

// --- Cloud layer --------------------------------------------------------------
const CLOUD_COUNT = 14;
const CLOUD_Y = 95;                         // high in the sky

// --- Weather state machine ----------------------------------------------------
// Phases run in order on a multi-minute cycle. `rain` is the target rain density
// for each phase (0..1); `cover` is the target cloud opacity (0..1). The machine
// lerps the LIVE rain/cover toward the active phase's targets so transitions are
// smooth rather than snapping.
const PHASES = [
  { name: "clear",    dur: 95, rain: 0.0, cover: 0.18 },
  { name: "overcast", dur: 55, rain: 0.0, cover: 0.85 },
  { name: "rain",     dur: 80, rain: 1.0, cover: 1.0  },
  { name: "clearing", dur: 50, rain: 0.0, cover: 0.45 },
];

// --- Shared scratch (reused every frame; never reallocated in update) ---------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler();

// A flat-bottomed low-poly cloud: a clump of squashed icosahedra merged visually
// by overlapping them in one little group. Cheap, blocky, reads as a cloud.
function makeCloudGeo() {
  // One squashed low-poly blob; the cloud is several of these scaled/placed.
  return new THREE.IcosahedronGeometry(1, 0);
}

export function buildCityWeather() {
  const group = new THREE.Group();
  group.name = "cityWeather";
  group.frustumCulled = false;

  // ---------------------------------------------------------------- WIND -----
  // Slowly evolving wind. `wind` is the live state other systems can read.
  const wind = {
    speed: 1.2,          // current strength (m/s-ish)
    dirX: 0.8,           // unit-ish direction in XZ
    dirZ: 0.3,
    // internal targets so the wind wanders smoothly instead of jumping
    _tSpeed: 1.2,
    _tAngle: Math.atan2(0.3, 0.8),
    _angle: Math.atan2(0.3, 0.8),
    _retarget: 6,        // seconds until next gust retarget
  };

  // --------------------------------------------------------------- CLOUDS ----
  // A pooled set of low-poly cloud clumps. Each clump is a small group of 3-4
  // squashed icosahedra. They share one translucent material whose opacity is the
  // overcast tell. They drift with the wind and wrap around the map edges.
  const cloudGeo = makeCloudGeo();
  const cloudMat = new THREE.MeshStandardMaterial({
    color: "#d7dde4",
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    flatShading: true,
  });
  const clouds = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const clump = new THREE.Group();
    clump.frustumCulled = false;
    // 3-4 overlapping blobs make one fluffy clump.
    const blobs = 3 + (i % 2);
    for (let b = 0; b < blobs; b++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      const sx = 6 + ((i * 7 + b * 3) % 6);
      const sy = 2.4 + ((i + b) % 3);
      const sz = 5 + ((i * 5 + b * 2) % 5);
      puff.scale.set(sx, sy, sz);
      puff.position.set((b - blobs / 2) * 6 + ((i + b) % 3), ((i + b) % 2) * 1.2, ((i * 3 + b) % 4) - 2);
      puff.frustumCulled = false;
      clump.add(puff);
    }
    // Spread clumps across the sky over the whole map.
    const cx = CENTER_X + (((i * 53) % SPAN_X) - SPAN_X / 2);
    const cz = CENTER_Z + (((i * 97) % SPAN_Z) - SPAN_Z / 2);
    clump.position.set(cx, CLOUD_Y + (i % 4) * 4, cz);
    group.add(clump);
    clouds.push(clump);
  }

  // ----------------------------------------------------------------- RAIN ----
  // ONE InstancedMesh of thin streaks. Geometry is a 1m-tall, paper-thin quad-ish
  // box; per-instance scale stretches it into a streak. Each instance carries a
  // plain {x,z,y,speed} state record so update() can fall + recycle with no allocation.
  const rainGeo = new THREE.BoxGeometry(0.035, 1.0, 0.035);
  const rainMat = new THREE.MeshBasicMaterial({
    color: "#aebfcf",
    transparent: true,
    opacity: 0.0,            // starts invisible; faded in when it rains
    depthWrite: false,
    fog: false,
  });
  const rain = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
  rain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rain.frustumCulled = false;     // the volume often sits partly behind the camera
  group.add(rain);

  // Per-streak state: position within the volume + a slight speed variation. The
  // streaks are scattered over the WHOLE map (centred on CENTER) and at random
  // heights so the curtain is dense and seamless from the first frame.
  const streaks = new Array(RAIN_COUNT);
  for (let i = 0; i < RAIN_COUNT; i++) {
    streaks[i] = {
      x: CENTER_X + (Math.random() - 0.5) * SPAN_X,
      z: CENTER_Z + (Math.random() - 0.5) * SPAN_Z,
      y: RAIN_BOTTOM + Math.random() * (RAIN_TOP - RAIN_BOTTOM),
      speed: RAIN_FALL * (0.85 + Math.random() * 0.4),
      len: STREAK_LEN * (0.8 + Math.random() * 0.5),
    };
  }
  // Seed the instance matrices once so nothing flickers before the first update.
  for (let i = 0; i < RAIN_COUNT; i++) {
    const s = streaks[i];
    _pos.set(s.x, s.y, s.z);
    _scl.set(1, s.len, 1);
    _m.compose(_pos, _q, _scl);
    rain.setMatrixAt(i, _m);
  }
  rain.instanceMatrix.needsUpdate = true;

  // ------------------------------------------------------------- LIGHTNING ---
  // A big emissive quad parked high overhead, facing down. During rain its opacity
  // is briefly ramped up for a flash — a cheap full-scene "tint" without touching
  // any lights or adding a render pass. It is double-sided and ignores fog so the
  // flash reads from anywhere on the map.
  const flashMat = new THREE.MeshBasicMaterial({
    color: "#eaf0ff",
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(SPAN_X * 2, SPAN_Z * 2), flashMat);
  flash.rotation.x = Math.PI / 2;            // face down over the map
  flash.position.set(CENTER_X, RAIN_TOP + 6, CENTER_Z);
  flash.frustumCulled = false;
  group.add(flash);

  // ------------------------------------------------------- STATE MACHINE -----
  let phaseIdx = 0;
  let phaseT = 0;                 // seconds spent in the current phase
  let liveRain = 0;              // smoothed rain density 0..1
  let liveCover = PHASES[0].cover; // smoothed cloud opacity 0..1

  // Lightning timing (only fires while it's actually raining).
  let flashTimer = 4 + Math.random() * 8;   // seconds until next strike
  let flashLevel = 0;                       // current flash brightness 0..1

  let t = 0;

  function update(dt) {
    if (!dt) dt = 0;
    // Clamp dt so a tab-switch hitch can't teleport rain or skip a whole phase.
    if (dt > 0.1) dt = 0.1;
    t += dt;

    // ----- advance the weather phase -----
    phaseT += dt;
    const phase = PHASES[phaseIdx];
    if (phaseT >= phase.dur) {
      phaseT -= phase.dur;
      phaseIdx = (phaseIdx + 1) % PHASES.length;
    }
    const target = PHASES[phaseIdx];
    // Smoothly chase the active phase targets (exponential-ish ease, framerate-safe).
    const k = 1 - Math.exp(-dt * 0.5);
    liveRain += (target.rain - liveRain) * k;
    liveCover += (target.cover - liveCover) * k;

    // ----- wind: wander the gust target, then ease the live wind toward it -----
    wind._retarget -= dt;
    if (wind._retarget <= 0) {
      wind._retarget = 5 + Math.random() * 7;
      wind._tSpeed = 0.6 + Math.random() * 2.6;
      wind._tAngle = wind._angle + (Math.random() - 0.5) * 1.4;
    }
    const wk = 1 - Math.exp(-dt * 0.6);
    wind.speed += (wind._tSpeed - wind.speed) * wk;
    wind._angle += (wind._tAngle - wind._angle) * wk;
    wind.dirX = Math.cos(wind._angle);
    wind.dirZ = Math.sin(wind._angle);

    // ----- clouds: opacity = cover; drift with the wind, wrap at the edges -----
    cloudMat.opacity = 0.12 + liveCover * 0.72;
    const cdx = wind.dirX * wind.speed * 0.6 * dt;
    const cdz = wind.dirZ * wind.speed * 0.6 * dt;
    const halfX = SPAN_X / 2 + 30;
    const halfZ = SPAN_Z / 2 + 30;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      let px = c.position.x + cdx;
      let pz = c.position.z + cdz;
      // wrap so the cover is endless
      if (px > CENTER_X + halfX) px -= 2 * halfX;
      else if (px < CENTER_X - halfX) px += 2 * halfX;
      if (pz > CENTER_Z + halfZ) pz -= 2 * halfZ;
      else if (pz < CENTER_Z - halfZ) pz += 2 * halfZ;
      c.position.x = px;
      c.position.z = pz;
    }

    // ----- rain: fade material with density, fall + recycle the pool ----------
    // Opacity tracks live rain density; when essentially zero we can skip the heavy
    // per-instance work entirely (the streaks just hold position, invisible).
    rainMat.opacity = liveRain * 0.55;
    if (liveRain > 0.01) {
      // Wind-driven slant: a small horizontal drift applied to every streak, plus a
      // matching tilt on the streak geometry so the rain leans into the wind.
      const slantX = wind.dirX * wind.speed * 0.12;
      const slantZ = wind.dirZ * wind.speed * 0.12;
      // Tilt: lean the unit streak by a small angle toward the wind heading.
      const lean = Math.min(0.35, wind.speed * 0.05);
      _euler.set(slantZ * 0.0 + lean * wind.dirZ, 0, -lean * wind.dirX);
      _q.setFromEuler(_euler);

      for (let i = 0; i < RAIN_COUNT; i++) {
        const s = streaks[i];
        s.y -= s.speed * dt;
        s.x += slantX * dt;
        s.z += slantZ * dt;
        // Recycle: once a streak passes the ground, send it back to the top at a
        // fresh scattered X/Z so the finite pool keeps blanketing the whole map.
        if (s.y < RAIN_BOTTOM) {
          s.y = RAIN_TOP - (RAIN_BOTTOM - s.y);     // carry the overshoot upward
          s.x = CENTER_X + (Math.random() - 0.5) * SPAN_X;
          s.z = CENTER_Z + (Math.random() - 0.5) * SPAN_Z;
        }
        // Keep streaks from drifting off the volume edges over time (wrap X/Z).
        if (s.x > CENTER_X + SPAN_X / 2) s.x -= SPAN_X;
        else if (s.x < CENTER_X - SPAN_X / 2) s.x += SPAN_X;
        if (s.z > CENTER_Z + SPAN_Z / 2) s.z -= SPAN_Z;
        else if (s.z < CENTER_Z - SPAN_Z / 2) s.z += SPAN_Z;

        _pos.set(s.x, s.y, s.z);
        _scl.set(1, s.len, 1);
        _m.compose(_pos, _q, _scl);
        rain.setMatrixAt(i, _m);
      }
      rain.instanceMatrix.needsUpdate = true;
    }

    // ----- lightning: only while it's raining; ramp + decay the flash quad -----
    if (liveRain > 0.45) {
      flashTimer -= dt;
      if (flashTimer <= 0 && flashLevel <= 0) {
        flashTimer = 6 + Math.random() * 14;   // next strike a while off
        flashLevel = 0.8 + Math.random() * 0.2; // pop the flash on
      }
    }
    if (flashLevel > 0) {
      // Fast decay so it reads as a sharp flash, not a glow.
      flashLevel -= dt * 3.2;
      if (flashLevel < 0) flashLevel = 0;
      // Flicker a touch on the way down so it looks like a real strike.
      const flicker = 0.7 + 0.3 * Math.abs(Math.sin(t * 40));
      flashMat.opacity = flashLevel * flicker * 0.5 * Math.min(1, liveRain * 1.5);
    } else if (flashMat.opacity !== 0) {
      flashMat.opacity = 0;
    }
  }

  // `wind` is exposed so other ambient systems could read the current gust.
  return { group, update, wind };
}
