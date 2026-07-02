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
// Perf pass #2: the curtain used to blanket the WHOLE 244x264 map with 600
// streaks, almost all of them falling far from the camera. We cut the pool ~45%
// (600 -> 330) AND concentrate it in a moving footprint centred on the player
// (RAIN_SPAN below) so the streaks that remain are the ones you can actually see.
// Density per square metre is HIGHER than before inside that footprint, so the
// rain reads as believable (often heavier) up close while costing far less.
const RAIN_COUNT = 330;
const RAIN_TOP = 70;                        // streaks spawn at this height
const RAIN_BOTTOM = 0;                      // recycle once they fall past ground
const RAIN_FALL = 58;                       // base fall speed (m/s)
const STREAK_LEN = 1.6;                     // half-length of a unit streak (geo is 1m tall, scaled)
// Footprint the falling rain is scattered across, centred on the player (or on
// the map centre pre-join). A ~160m box comfortably covers the visible range
// while keeping all 330 streaks near the camera.
const RAIN_SPAN_X = 160, RAIN_SPAN_Z = 160;

// --- Cloud layer --------------------------------------------------------------
const CLOUD_COUNT = 14;
const CLOUD_Y = 95;                         // high in the sky

// --- Tornadoes ----------------------------------------------------------------
// A POOL of at most 2 funnels, built once and reused across events (toggled
// visible). During heavy rain an "event" wakes 1 (rarely 2) funnels that roam
// the map then dissipate, followed by a long calm gap before the next event.
// Each funnel is a tapered stack of swirling rings (wide top, narrow base) with
// a faster debris swirl orbiting the base and a dark ground smudge.
const TORNADO_MAX = 2;                      // pool size (never more than this)
const FUNNEL_RINGS = 12;                    // stacked rings forming the cone shell
const FUNNEL_HEIGHT = 56;                   // base on the ground -> top in the air
const FUNNEL_TOP_R = 13;                    // wide swirling top radius
const FUNNEL_BASE_R = 1.2;                  // narrow base radius (touches ground)
const FUNNEL_DEBRIS = 7;                    // debris quads orbiting the base
const TORNADO_INFLUENCE = 5.5;             // ground "catch" radius at full size
// Roam bounds, inset from the map edges so funnels stay over the play area.
const T_MINX = LEFT + 10, T_MAXX = RIGHT - 10;
const T_MINZ = NEAR + 14, T_MAXZ = FAR - 14;
const TWO_PI = Math.PI * 2;

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
const _white = new THREE.Color("#dfe6f2");  // lightning fog-tint target (const, never mutated)
const _col = new THREE.Color();             // scratch for one-time instanceColor seeding

// A flat-bottomed low-poly cloud: a clump of squashed icosahedra merged visually
// by overlapping them in one little group. Cheap, blocky, reads as a cloud.
function makeCloudGeo() {
  // One squashed low-poly blob; the cloud is several of these scaled/placed.
  return new THREE.IcosahedronGeometry(1, 0);
}

export function buildCityWeather(opts = {}) {
  const group = new THREE.Group();
  group.name = "cityWeather";
  group.frustumCulled = false;

  // Optional scene fog: if a caller wires it in, lightning briefly tints it (light
  // polish). Left null otherwise, so existing callers (no args) are unaffected.
  const fog = opts && opts.fog ? opts.fog : null;
  const _fogBase = fog ? fog.color.clone() : null;

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
    // Lightning underglow: normally black (inert), ramped up during a flash so the
    // storm clouds light from within on each strike. Colour set once; only the
    // intensity scalar is touched per frame.
    emissive: "#dfe6ff",
    emissiveIntensity: 0.0,
  });
  const clouds = [];
  const cloudDrift = new Array(CLOUD_COUNT); // per-clump {mul, bobA, bobP, baseY}
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const clump = new THREE.Group();
    clump.frustumCulled = false;
    // 3-5 overlapping blobs make one fluffy clump; flatter/wider than before so the
    // silhouette reads as a soft cumulus rather than a lumpy ball.
    const blobs = 3 + (i % 3);
    for (let b = 0; b < blobs; b++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      const sx = 7 + ((i * 7 + b * 3) % 7);
      const sy = 2.0 + ((i + b) % 3) * 0.8;   // flatter vertically → softer puff
      const sz = 6 + ((i * 5 + b * 2) % 6);
      puff.scale.set(sx, sy, sz);
      puff.position.set((b - blobs / 2) * 6 + ((i + b) % 3), ((i + b) % 2) * 1.0, ((i * 3 + b) % 4) - 2);
      puff.frustumCulled = false;
      clump.add(puff);
    }
    // Spread clumps across the sky over the whole map.
    const cx = CENTER_X + (((i * 53) % SPAN_X) - SPAN_X / 2);
    const cz = CENTER_Z + (((i * 97) % SPAN_Z) - SPAN_Z / 2);
    const baseY = CLOUD_Y + (i % 4) * 4;
    clump.position.set(cx, baseY, cz);
    group.add(clump);
    clouds.push(clump);
    // Each clump drifts at its own fraction of the wind and bobs on its own phase so
    // the cover shears and breathes instead of sliding as one rigid sheet.
    cloudDrift[i] = { mul: 0.65 + (i % 5) * 0.16, bobA: 0.6 + (i % 3) * 0.5, bobP: i * 1.3, baseY };
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
      // Wider length spread than before → nearer/heavier streaks read as long
      // slashes, distant ones as short ticks, giving the curtain real depth.
      len: STREAK_LEN * (0.6 + Math.random() * 1.1),
    };
  }
  // Seed the instance matrices once so nothing flickers before the first update.
  // Also seed a per-streak brightness via instanceColor: some streaks are faint and
  // hazy, others bright and sharp, so the sheet reads as layered rather than flat.
  // (Multiplies the base colour; set ONCE — no per-frame colour work.)
  for (let i = 0; i < RAIN_COUNT; i++) {
    const s = streaks[i];
    _pos.set(s.x, s.y, s.z);
    _scl.set(1, s.len, 1);
    _m.compose(_pos, _q, _scl);
    rain.setMatrixAt(i, _m);
    const b = 0.65 + Math.random() * 0.5;   // 0.65..1.15 brightness
    _col.setRGB(b, b, b * 1.04);            // a hair cooler on the bright end
    rain.setColorAt(i, _col);
  }
  rain.instanceMatrix.needsUpdate = true;
  if (rain.instanceColor) rain.instanceColor.needsUpdate = true;

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

  // ------------------------------------------------------- TORNADOES ---------
  // Build the funnel POOL once. Geometry is shared across both funnels (each ring
  // band, the debris quad, the ground smudge) so only materials are per-funnel
  // (needed so their lifecycle opacity can differ). Nothing here runs per frame.
  function funnelRingRadius(frac) {
    // frac 0 at the base -> 1 at the top; curved taper (narrow base, wide top).
    return FUNNEL_BASE_R + (FUNNEL_TOP_R - FUNNEL_BASE_R) * Math.pow(frac, 0.85);
  }
  const ringGeos = [];
  for (let i = 0; i < FUNNEL_RINGS; i++) {
    const fracB = i / FUNNEL_RINGS;
    const fracT = (i + 1) / FUNNEL_RINGS;
    const rB = funnelRingRadius(fracB);
    const rT = funnelRingRadius(fracT);
    const h = (fracT - fracB) * FUNNEL_HEIGHT * 1.25;   // overlap a touch
    // Open-ended cylinder band: top radius < bottom only near the base, giving the
    // stacked cone shell its taper. Double-sided material shows the hollow interior.
    ringGeos.push(new THREE.CylinderGeometry(rT, rB, h, 16, 1, true));
  }
  // Inner CORE shell: a second, narrower stack that counter-rotates inside the outer
  // shell so the funnel reads as layered, twisting sheets of dust rather than one
  // hollow cone. Fewer segments (they're small and mostly occluded) to stay cheap.
  const INNER_RINGS = 6;
  const innerRingGeos = [];
  for (let i = 0; i < INNER_RINGS; i++) {
    const fracB = i / INNER_RINGS;
    const fracT = (i + 1) / INNER_RINGS;
    const rB = funnelRingRadius(fracB) * 0.55;
    const rT = funnelRingRadius(fracT) * 0.55;
    const h = (fracT - fracB) * FUNNEL_HEIGHT * 1.3;
    innerRingGeos.push(new THREE.CylinderGeometry(rT, rB, h, 12, 1, true));
  }
  const debrisGeo = new THREE.PlaneGeometry(2.2, 1.3);
  const smudgeGeo = new THREE.CircleGeometry(FUNNEL_BASE_R * 3.4, 20);
  // Debris RING: many small torn chunks orbiting the base, drawn as ONE InstancedMesh
  // per funnel (one draw call). Static per-instance matrices → the whole ring is
  // animated for free by spinning its parent group (no per-frame matrix writes).
  const DEBRIS_INSTANCES = 22;
  const debrisChunkGeo = new THREE.PlaneGeometry(1.5, 0.85);

  function buildFunnel(seed) {
    const root = new THREE.Group();      // roam position (x,z); visibility toggled
    root.frustumCulled = false;
    root.visible = false;

    const bodyGroup = new THREE.Group(); // spins + sways + scales for the lifecycle
    bodyGroup.frustumCulled = false;
    root.add(bodyGroup);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: "#4f463b",                  // dark, dirty storm-brown (more menacing)
      roughness: 1.0, metalness: 0.0,
      transparent: true, opacity: 0.0,   // faded in by the forming phase
      depthWrite: false, side: THREE.DoubleSide, flatShading: true,
    });

    const rings = [];
    for (let i = 0; i < FUNNEL_RINGS; i++) {
      const frac = (i + 0.5) / FUNNEL_RINGS;
      const m = new THREE.Mesh(ringGeos[i], bodyMat);
      m.frustumCulled = false;
      // Offset each ring centre into a gentle helix so the (otherwise symmetric)
      // stack reads as a visibly twisting column once the body spins. Top sways out.
      const off = 0.25 + frac * 2.4;
      const hAng = frac * 3.2 + seed;
      m.position.set(Math.cos(hAng) * off, frac * FUNNEL_HEIGHT, Math.sin(hAng) * off);
      bodyGroup.add(m);
      rings.push(m);
    }

    // Inner counter-swirl core (shares bodyMat so it fades with the lifecycle). Its
    // helix winds the OTHER way; update() spins this group against the outer shell.
    const innerGroup = new THREE.Group();
    innerGroup.frustumCulled = false;
    for (let i = 0; i < INNER_RINGS; i++) {
      const frac = (i + 0.5) / INNER_RINGS;
      const m = new THREE.Mesh(innerRingGeos[i], bodyMat);
      m.frustumCulled = false;
      const off = 0.15 + frac * 1.2;
      const hAng = -frac * 3.6 + seed * 1.3;   // opposite-handed helix
      m.position.set(Math.cos(hAng) * off, frac * FUNNEL_HEIGHT, Math.sin(hAng) * off);
      innerGroup.add(m);
    }
    bodyGroup.add(innerGroup);

    // Faster debris swirl orbiting the base — one InstancedMesh of many torn chunks.
    const debrisGroup = new THREE.Group();
    debrisGroup.frustumCulled = false;
    const debrisMat = new THREE.MeshBasicMaterial({
      color: "#4a3e30",
      transparent: true, opacity: 0.0,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const debrisIM = new THREE.InstancedMesh(debrisChunkGeo, debrisMat, DEBRIS_INSTANCES);
    debrisIM.frustumCulled = false;
    for (let i = 0; i < DEBRIS_INSTANCES; i++) {
      const a = (i / DEBRIS_INSTANCES) * TWO_PI + seed;
      const r = FUNNEL_BASE_R + 0.8 + (i % 4) * 1.0;
      const y = 0.4 + (i % 6) * 1.25;         // stacked up the lower funnel
      _pos.set(Math.cos(a) * r, y, Math.sin(a) * r);
      _euler.set((i % 3) * 0.4, a, (i % 2) ? 0.35 : -0.35);
      _q.setFromEuler(_euler);
      const sc = 0.6 + (i % 3) * 0.45;
      _scl.set(sc, sc, sc);
      _m.compose(_pos, _q, _scl);
      debrisIM.setMatrixAt(i, _m);
    }
    debrisIM.instanceMatrix.needsUpdate = true;
    _scl.set(1, 1, 1);                          // restore shared scratch
    debrisGroup.add(debrisIM);
    bodyGroup.add(debrisGroup);

    // Dark ground smudge — sits flat under the funnel and does NOT tilt with the
    // body sway, so it stays glued to the ground.
    const smudgeMat = new THREE.MeshBasicMaterial({
      color: "#3a3026",
      transparent: true, opacity: 0.0,
      depthWrite: false, fog: false,
    });
    const smudge = new THREE.Mesh(smudgeGeo, smudgeMat);
    smudge.rotation.x = -Math.PI / 2;
    smudge.position.y = 0.06;
    smudge.frustumCulled = false;
    root.add(smudge);

    group.add(root);

    // Plain reused state record (no per-frame allocation). `report` is the reused
    // object handed out by getTornadoes() so that call never allocates either.
    return {
      root, bodyGroup, innerGroup, debrisGroup, rings,
      bodyMat, debrisMat, smudgeMat,
      phase: "idle",                     // idle | forming | active | dissipating
      life: 0,
      formDur: 0, activeDur: 0, dissDur: 0,
      x: CENTER_X, z: CENTER_Z, vx: 0, vz: 0,
      wanderT: 0,
      spin: seed, debrisSpin: seed * 1.7, swayPhase: seed * 3,
      radius: 0,
      report: { x: 0, z: 0, radius: 0, active: false },
    };
  }

  const funnels = [];
  for (let i = 0; i < TORNADO_MAX; i++) funnels.push(buildFunnel(i * 2.1));

  // Wake a pooled funnel for a fresh roam (called rarely; Math.random only — no `new`).
  function spawnFunnel(f) {
    f.phase = "forming";
    f.life = 0;
    f.formDur = 4 + Math.random() * 4;       // grow from a wisp
    f.activeDur = 22 + Math.random() * 34;   // roam at full size
    f.dissDur = 5 + Math.random() * 4;       // shrink + fade away
    f.x = T_MINX + Math.random() * (T_MAXX - T_MINX);
    f.z = T_MINZ + Math.random() * (T_MAXZ - T_MINZ);
    const a = Math.random() * TWO_PI;
    const spd = 2.5 + Math.random() * 4;
    f.vx = Math.cos(a) * spd;
    f.vz = Math.sin(a) * spd;
    f.wanderT = 2 + Math.random() * 3;
    f.root.position.set(f.x, 0, f.z);
    f.root.visible = true;
    f.bodyGroup.scale.setScalar(0.12);
  }

  // Event scheduler: a long initial calm, then events separated by long calm gaps.
  let tornadoCooldown = 35 + Math.random() * 50;
  let tornadoEvent = false;

  // ------------------------------------------------------- STATE MACHINE -----
  let phaseIdx = 0;
  let phaseT = 0;                 // seconds spent in the current phase
  let liveRain = 0;              // smoothed rain density 0..1
  let liveCover = PHASES[0].cover; // smoothed cloud opacity 0..1

  // Lightning timing (only fires while it's actually raining).
  let flashTimer = 4 + Math.random() * 8;   // seconds until next strike
  let flashLevel = 0;                       // current flash brightness 0..1
  let flashRestrike = 0;                    // >0 = a quick second stroke is pending
  let fogDirty = false;                     // true while the fog is tinted by a flash

  let t = 0;

  function update(dt, player) {
    if (!dt) dt = 0;
    // Clamp dt so a tab-switch hitch can't teleport rain or skip a whole phase.
    if (dt > 0.1) dt = 0.1;
    t += dt;

    // Centre the (smaller) rain footprint on the player so the streaks fall where
    // they're visible. Falls back to the map centre pre-join. Plain scalars.
    const rcx = player ? player.x : CENTER_X;
    const rcz = player ? player.z : CENTER_Z;

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
    const cbx = wind.dirX * wind.speed * 0.6 * dt;
    const cbz = wind.dirZ * wind.speed * 0.6 * dt;
    const halfX = SPAN_X / 2 + 30;
    const halfZ = SPAN_Z / 2 + 30;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const d = cloudDrift[i];
      let px = c.position.x + cbx * d.mul;
      let pz = c.position.z + cbz * d.mul;
      // wrap so the cover is endless
      if (px > CENTER_X + halfX) px -= 2 * halfX;
      else if (px < CENTER_X - halfX) px += 2 * halfX;
      if (pz > CENTER_Z + halfZ) pz -= 2 * halfZ;
      else if (pz < CENTER_Z - halfZ) pz += 2 * halfZ;
      c.position.x = px;
      c.position.z = pz;
      // gentle independent vertical breathing
      c.position.y = d.baseY + Math.sin(t * 0.12 + d.bobP) * d.bobA;
    }

    // ----- rain: fade material with density, fall + recycle the pool ----------
    // Opacity tracks live rain density; when essentially zero we can skip the heavy
    // per-instance work entirely (the streaks just hold position, invisible).
    // Density curve: a touch denser as it nears the peak (Y-range unchanged).
    rainMat.opacity = liveRain * (0.5 + liveRain * 0.18);
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
        // fresh scattered X/Z inside the player-centred footprint, so the finite
        // pool keeps a believable curtain right where the camera is.
        if (s.y < RAIN_BOTTOM) {
          s.y = RAIN_TOP - (RAIN_BOTTOM - s.y);     // carry the overshoot upward
          s.x = rcx + (Math.random() - 0.5) * RAIN_SPAN_X;
          s.z = rcz + (Math.random() - 0.5) * RAIN_SPAN_Z;
        }
        // Keep streaks within the footprint as the player moves (wrap X/Z around
        // the moving centre so streaks left behind re-enter ahead).
        if (s.x > rcx + RAIN_SPAN_X / 2) s.x -= RAIN_SPAN_X;
        else if (s.x < rcx - RAIN_SPAN_X / 2) s.x += RAIN_SPAN_X;
        if (s.z > rcz + RAIN_SPAN_Z / 2) s.z -= RAIN_SPAN_Z;
        else if (s.z < rcz - RAIN_SPAN_Z / 2) s.z += RAIN_SPAN_Z;

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
      if (flashTimer <= 0 && flashLevel <= 0 && flashRestrike <= 0) {
        flashTimer = 6 + Math.random() * 14;   // next strike a while off
        flashLevel = 0.8 + Math.random() * 0.2; // pop the flash on
        // ~45% of strikes are multi-stroke: queue a quick second pop just after the
        // first begins to fade, so the bolt flickers like a real lightning stroke.
        flashRestrike = (Math.random() < 0.45) ? 0.09 + Math.random() * 0.07 : 0;
      }
    }
    // Fire the pending restrike once its short delay elapses.
    if (flashRestrike > 0) {
      flashRestrike -= dt;
      if (flashRestrike <= 0 && liveRain > 0.4) {
        flashLevel = Math.max(flashLevel, 0.55 + Math.random() * 0.3);
      }
    }
    if (flashLevel > 0) {
      // Fast decay so it reads as a sharp flash, not a glow.
      flashLevel -= dt * 3.2;
      if (flashLevel < 0) flashLevel = 0;
      // An erratic flicker (two detuned oscillators) reads as a jagged strike rather
      // than a smooth pulse.
      const flicker = 0.5 + 0.5 * Math.abs(Math.sin(t * 47) * Math.cos(t * 13));
      const fa = flashLevel * flicker * 0.5 * Math.min(1, liveRain * 1.5);
      flashMat.opacity = fa;
      // Underlight the storm clouds from within on each stroke (emissive only — no
      // light object). The clouds glow, then fall dark as the flash decays.
      cloudMat.emissiveIntensity = fa * 1.7;
      // Polish: briefly tint the fog toward the flash colour (in-place lerp — no
      // allocation). Only runs if a fog was wired in via opts; otherwise inert.
      if (fog) {
        fog.color.copy(_fogBase).lerp(_white, Math.min(0.6, fa * 0.9));
        fogDirty = true;
      }
    } else {
      if (flashMat.opacity !== 0) flashMat.opacity = 0;
      if (cloudMat.emissiveIntensity !== 0) cloudMat.emissiveIntensity = 0;
      if (fog && fogDirty) { fog.color.copy(_fogBase); fogDirty = false; }
    }

    // ----- tornadoes: roam during heavy rain; long calm gaps between events ----
    // Start an event only when there is none running and the storm is heavy.
    if (!tornadoEvent) {
      tornadoCooldown -= dt;
      if (liveRain > 0.55 && tornadoCooldown <= 0) {
        const count = (Math.random() < 0.18 ? 2 : 1);   // 1, rarely 2
        let started = 0;
        for (let i = 0; i < funnels.length && started < count; i++) {
          if (funnels[i].phase === "idle") { spawnFunnel(funnels[i]); started++; }
        }
        tornadoEvent = started > 0;
      }
    }

    let anyAlive = false;
    for (let i = 0; i < funnels.length; i++) {
      const f = funnels[i];
      if (f.phase === "idle") continue;
      anyAlive = true;
      f.life += dt;

      // If the storm dies down, force the funnel to dissipate gracefully.
      if (f.phase !== "dissipating" && liveRain < 0.30) { f.phase = "dissipating"; f.life = 0; }

      // Lifecycle -> body scale + alpha. forming grows from a wisp; dissipating
      // shrinks + fades; then it returns to the pool (idle, hidden) for reuse.
      let scl = 1, alpha = 1;
      if (f.phase === "forming") {
        const p = f.life / f.formDur;
        if (p >= 1) { f.phase = "active"; f.life = 0; }
        else { const e = p * p * (3 - 2 * p); scl = 0.12 + e * 0.88; alpha = p; }
      } else if (f.phase === "active") {
        if (f.life >= f.activeDur) { f.phase = "dissipating"; f.life = 0; }
      } else { // dissipating
        const p = f.life / f.dissDur;
        if (p >= 1) {
          f.phase = "idle";
          f.root.visible = false;
          f.radius = 0;
          f.bodyMat.opacity = 0; f.debrisMat.opacity = 0; f.smudgeMat.opacity = 0;
          continue;
        }
        scl = 1 - p * 0.95; alpha = 1 - p;
      }

      // Wander a slow ground path, reflecting off the (inset) city bounds.
      f.wanderT -= dt;
      if (f.wanderT <= 0) {
        f.wanderT = 3 + Math.random() * 4;
        const a = Math.random() * TWO_PI;
        const spd = 2.5 + Math.random() * 4.5;
        f.vx = Math.cos(a) * spd + wind.dirX * wind.speed * 0.3;
        f.vz = Math.sin(a) * spd + wind.dirZ * wind.speed * 0.3;
      }
      f.x += f.vx * dt; f.z += f.vz * dt;
      if (f.x < T_MINX) { f.x = T_MINX; f.vx = Math.abs(f.vx); }
      else if (f.x > T_MAXX) { f.x = T_MAXX; f.vx = -Math.abs(f.vx); }
      if (f.z < T_MINZ) { f.z = T_MINZ; f.vz = Math.abs(f.vz); }
      else if (f.z > T_MAXZ) { f.z = T_MAXZ; f.vz = -Math.abs(f.vz); }
      f.root.position.x = f.x;
      f.root.position.z = f.z;

      // Spin the funnel, swirl the debris faster, and wobble the body a little.
      f.spin += dt * 1.7;
      f.bodyGroup.rotation.y = f.spin;
      // Inner core winds against the shell for a layered, twisting-sheets look.
      f.innerGroup.rotation.y = -f.spin * 1.9;
      f.debrisSpin += dt * 4.2;
      f.debrisGroup.rotation.y = f.debrisSpin;
      f.swayPhase += dt;
      f.bodyGroup.rotation.x = Math.sin(f.swayPhase * 0.7) * 0.06;
      f.bodyGroup.rotation.z = Math.cos(f.swayPhase * 0.9) * 0.05;

      // Apply lifecycle scale + alpha and update the exposed influence radius.
      f.bodyGroup.scale.setScalar(scl);
      f.bodyMat.opacity = 0.55 * alpha;   // denser, darker column
      f.debrisMat.opacity = 0.6 * alpha;
      f.smudgeMat.opacity = 0.55 * alpha;
      f.radius = TORNADO_INFLUENCE * scl;
    }

    // Event ends once all its funnels are back in the pool -> long calm gap.
    if (tornadoEvent && !anyAlive) {
      tornadoEvent = false;
      tornadoCooldown = 70 + Math.random() * 90;
    }
  }

  // Live tornado report. Reuses one array + one object per funnel so repeated
  // calls (even per frame from another system) never allocate.
  const _tornadoReport = [];
  function getTornadoes() {
    _tornadoReport.length = 0;
    for (let i = 0; i < funnels.length; i++) {
      const f = funnels[i];
      if (f.phase === "idle") continue;
      const r = f.report;
      r.x = f.x;
      r.z = f.z;
      r.radius = f.radius;
      r.active = (f.phase === "active");   // true only at full strength
      _tornadoReport.push(r);
    }
    return _tornadoReport;
  }

  // `wind` is exposed so other ambient systems could read the current gust.
  // `getRain` (a later audio pass reads it) and `getTornadoes` (a later gameplay
  // pass reads it to detect a caught player) expose live state — visual only here.
  return { group, update, wind, getRain: () => liveRain, getTornadoes };
}
