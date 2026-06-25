// A big rideable ROCKET — the "steal a rocket" toy. It owns its own geometry
// (tall multi-stage stack: tapered nose cone, two body stages with fins, an
// engine bell cluster, windows + a flag/insignia), an arcade flight model
// (sit-on-the-pad -> spool the engine -> LAUNCH straight up -> cruise/yaw/drift
// at altitude vs gravity), a flame cone + cached smoke-puff plume that bloom on
// thrust, a gentle idle sway, and a cinematic chase camera that pulls back and
// up as it climbs. It deliberately MIRRORS the car/boat API
// (group/state/drive/updateCamera/resetCamera/footprint/exitSpot/distanceTo/
// syncGroup) so rides.js can pilot it like the other vehicles. The only twist is
// drive()'s signature: (dt, throttle, steer, ctx) where ctx may carry
// {maxAltitude} — throttle is the MAIN ENGINE (rises / accelerates) and steer is
// YAW.
//
// All hot paths (drive / updateCamera) are allocation-free: every `new` lives in
// the build step (run once from makeRocket), and the per-frame code only mutates
// cached refs (materials, group scales/positions, two scratch Vector3s).

import * as THREE from "three";

const ROCKET = {
  // --- Flight model ---
  gravity: 9.8,          // m/s^2 pulling the rocket back down
  thrustAccel: 19.0,     // m/s^2 upward accel at full engine power
  liftoffPower: 0.55,    // engine spool fraction needed to leave the pad
  initialKick: 4.0,      // m/s vertical pop the instant it unsticks from the pad
  spoolUp: 1.1,          // engine power ramp /s when commanded up
  spoolDown: 1.8,        // engine power ramp /s when commanded down (cuts faster)
  vDrag: 0.35,           // vertical velocity damping /s (keeps climb controllable)
  maxClimb: 42.0,        // m/s vertical speed cap (both up and down)
  yawRate: 1.15,         // rad/s yaw authority at altitude
  driftAccel: 6.5,       // m/s^2 forward (heading) drift accel while thrusting aloft
  maxDrift: 14.0,        // m/s horizontal drift cap
  hDrag: 0.9,            // horizontal velocity damping /s
  defaultMaxAlt: 220,    // ceiling (m) when ctx.maxAltitude is not supplied
  groundedAlt: 0.6,      // altitude (m) below which we count as "on the pad"
  leanMax: 0.16,         // max body lean (rad) into yaw / drift at altitude
  // --- Idle sway on the pad ---
  swayAmp: 0.02,
  swayRate: 1.3,
  // --- Chase camera (lazy + cinematic; pulls back & up with altitude) ---
  camBack: 11.0,
  camHeight: 5.0,
  camLook: 4.0,
  camEase: 2.6,
  camBackPerAlt: 0.14, camBackMax: 34,
  camUpPerAlt: 0.10,   camUpMax: 22,
  // --- Pad ---
  padTop: 0.5,           // rocket base sits this high (on the pad platform top)
  bodyR: 1.0,
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

// A soft radial puff texture for the launch smoke — built once at construction
// time (NOT in the hot path) so the smoke quads read as billowing clouds rather
// than hard squares.
function makeSmokeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0.0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.45, "rgba(226,229,234,0.55)");
  grad.addColorStop(1.0, "rgba(205,210,218,0.0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// Build the rocket group. The local origin sits at the engine base (y=0 = bottom
// of the stack); the rocket builds UPWARD along +Y and the nose tips +Y. Heading
// is yaw about +Y, and "forward" (the drift direction at altitude) is +Z local —
// forward = (sin(h), 0, cos(h)) — matching the player/car/boat convention so the
// same sin/cos heading math drives all the vehicles. Stash dynamic refs (flame,
// smoke puffs, flag, windows) on userData so drive() can tween them with zero
// per-frame allocation.
function buildRocketGroup() {
  const g = new THREE.Group();

  const R = ROCKET.bodyR;
  const hull = mat("#eef2f6", { rough: 0.4, metal: 0.35 });   // bright fuselage
  const accent = mat("#d23b34", { rough: 0.45, metal: 0.3 }); // red trim / insignia
  const accentB = mat("#1d6fb8", { rough: 0.45, metal: 0.3 });// blue trim
  const darkMetal = mat("#2a2e36", { rough: 0.6, metal: 0.65 });
  const chrome = mat("#cfd4da", { rough: 0.22, metal: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: "#163b52", roughness: 0.08, metalness: 0.85, emissive: "#0a1f30", emissiveIntensity: 0.35 });
  const EP = 0.012;

  // --- Stage 1 body (lower, fat) — cylinder centred so it spans y 0.9..5.1 ---
  const s1 = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 4.2, 28), hull);
  s1.position.y = 3.0;
  s1.castShadow = true; s1.receiveShadow = true;
  g.add(s1);

  // Red accent band low on stage 1 + a blue one high — just proud of the skin.
  const band1 = new THREE.Mesh(new THREE.CylinderGeometry(R + EP, R + EP, 0.55, 28), accent);
  band1.position.y = 1.55;
  g.add(band1);
  const band2 = new THREE.Mesh(new THREE.CylinderGeometry(R + EP, R + EP, 0.4, 28), accentB);
  band2.position.y = 4.7;
  g.add(band2);

  // --- Interstage ring (dark) bridging stage 1 -> stage 2 (y 5.1..5.45) ---
  const inter = new THREE.Mesh(new THREE.CylinderGeometry(0.82, R, 0.35, 28), darkMetal);
  inter.position.y = 5.27;
  g.add(inter);

  // --- Stage 2 body (upper, slimmer) — spans y 5.45..8.45 ---
  const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.82, 3.0, 26), hull);
  s2.position.y = 6.95;
  s2.castShadow = true;
  g.add(s2);

  // --- Nose cone (tapered) — apex at +Y, base meets stage 2 (y 8.45..11.05) ---
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.6, 26), hull);
  nose.position.y = 9.75;
  nose.castShadow = true;
  g.add(nose);
  // Red nose tip cap for a little pop.
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 20), accent);
  tip.position.y = 10.75;
  g.add(tip);

  // --- Capsule windows: a ring of small dark portholes around stage 2 ---
  const winGeo = new THREE.CircleGeometry(0.13, 14);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const w = new THREE.Mesh(winGeo, glass);
    w.position.set(Math.sin(a) * (0.81 + EP), 7.3, Math.cos(a) * (0.81 + EP));
    w.lookAt(w.position.x * 3, 7.3, w.position.z * 3); // face radially outward
    g.add(w);
  }
  // A bigger cockpit window facing forward (+Z) on the upper stage.
  const cockpit = new THREE.Mesh(new THREE.CircleGeometry(0.26, 20), glass);
  cockpit.position.set(0, 6.4, 0.81 + EP);
  g.add(cockpit);

  // --- Flag / insignia panel on stage 1, facing forward (+Z) ---
  const insignia = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ color: "#f4f6f8", roughness: 0.5, emissive: "#101418", emissiveIntensity: 0.2, side: THREE.DoubleSide }));
  insignia.position.set(0, 3.2, R + EP);
  g.add(insignia);
  const star = new THREE.Mesh(new THREE.CircleGeometry(0.26, 5), accentB); // 5-gon "star" badge
  star.position.set(0, 3.2, R + EP + 0.006);
  g.add(star);
  // A little fabric flag near the top, side-mounted.
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 8), chrome);
  flagPole.position.set(0.86, 8.9, 0.0);
  g.add(flagPole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34), new THREE.MeshStandardMaterial({ color: "#d23b34", roughness: 0.7, side: THREE.DoubleSide }));
  flag.position.set(1.18, 9.25, 0.0);
  g.add(flag);

  // --- Fins: 4 swept fins around the base of stage 1, protruding outward ---
  const finMat = accent;
  const finGeo = new THREE.BoxGeometry(0.1, 1.8, 1.3);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.castShadow = true;
    // Push outward along the radial; rotation.y aligns the box depth radially.
    fin.position.set(Math.sin(a) * (R + 0.42), 1.55, Math.cos(a) * (R + 0.42));
    fin.rotation.y = a;
    fin.rotation.x = -0.12; // slight aft sweep
    g.add(fin);
    // Fin tip cap (chrome) at the trailing low corner for detail.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.4), chrome);
    cap.position.set(Math.sin(a) * (R + 0.95), 0.95, Math.cos(a) * (R + 0.95));
    cap.rotation.y = a;
    g.add(cap);
  }

  // --- Engine section: a thrust plate + a cluster of bells under stage 1 ---
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(R, 0.86, 0.5, 28), darkMetal);
  plate.position.y = 0.7;
  g.add(plate);
  // Main central bell (frustum: narrow throat up, wide exit down) + verniers.
  const bellGeo = new THREE.CylinderGeometry(0.26, 0.6, 0.82, 18, 1, true);
  const mainBell = new THREE.Mesh(bellGeo, chrome); // bright bell mouth
  mainBell.position.y = 0.42;
  g.add(mainBell);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.26, 0.5, 12, 1, true), darkMetal);
    v.position.set(Math.sin(a) * 0.5, 0.5, Math.cos(a) * 0.5);
    g.add(v);
  }

  // --- Flame: an additive cone whose TOP is anchored at the nozzle exit and
  // grows DOWNWARD. Wrapped in a group so scaling group.scale.y blooms the flame
  // out of the nozzle without the top creeping up into the engine. An inner core
  // cone gives the hot white center. Both materials live in userData for tween. ---
  const flameGroup = new THREE.Group();
  flameGroup.position.set(0, 0.18, 0);
  const coneH = 2.6, coneR = 0.62;
  const flameMat = new THREE.MeshBasicMaterial({ color: "#ff9b30", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 18, 1, true), flameMat);
  flame.rotation.x = Math.PI;      // flip so the wide base sits up at the nozzle, apex points down
  flame.position.y = -coneH / 2;   // top edge anchored at the group origin (nozzle)
  flameGroup.add(flame);
  const coreMat = new THREE.MeshBasicMaterial({ color: "#fff4c2", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const core = new THREE.Mesh(new THREE.ConeGeometry(coneR * 0.5, coneH * 0.7, 14, 1, true), coreMat);
  core.rotation.x = Math.PI;
  core.position.y = -coneH * 0.35;
  flameGroup.add(core);
  flameGroup.visible = false;
  g.add(flameGroup);

  // --- Smoke plume: a ring of soft puff quads at the base that bloom outward on
  // thrust (heaviest near the ground, faded out by altitude). Built once, parked
  // invisible; drive() tweens opacity + scale + outward offset on the cached
  // refs. dirx/dirz/phase are baked per puff so the bloom feels organic. ---
  const smokeTex = makeSmokeTexture();
  const puffGeo = new THREE.PlaneGeometry(1.7, 1.7);
  const puffs = [];
  const PUFF_N = 9;
  for (let i = 0; i < PUFF_N; i++) {
    const a = (i / PUFF_N) * Math.PI * 2;
    const m = new THREE.MeshBasicMaterial({ map: smokeTex, color: "#e9ecf0", transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(puffGeo, m);
    mesh.rotation.x = -Math.PI / 2;       // lie flat, billowing across the pad
    mesh.rotation.z = a;
    mesh.position.set(Math.sin(a) * 1.0, 0.06, Math.cos(a) * 1.0);
    mesh.renderOrder = 3;
    mesh.visible = false;
    g.add(mesh);
    puffs.push({ mesh, mat: m, dx: Math.sin(a), dz: Math.cos(a), phase: (i / PUFF_N) * Math.PI * 2 });
  }

  g.userData.dyn = {
    flameGroup, flameMat, coreMat,
    puffs,
    flag,
  };
  return g;
}

// Build a static launch PAD (platform + legs + a slim service mast). It is NOT
// part of the moving rocket group — it stays on the ground while the rocket
// climbs. Exposed on the return as `pad` so the wiring can drop it into the scene
// at the spawn (mirrors how main.js adds ocean docks etc.).
function buildPad() {
  const p = new THREE.Group();
  const concrete = mat("#6b6f76", { rough: 0.9, metal: 0.05 });
  const steel = mat("#3a3e46", { rough: 0.55, metal: 0.6 });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, ROCKET.padTop, 32), concrete);
  deck.position.y = ROCKET.padTop / 2;
  deck.receiveShadow = true;
  p.add(deck);
  // A darker scorch ring + flame trench rim under the engines.
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, ROCKET.padTop + 0.04, 24), steel);
  rim.position.y = (ROCKET.padTop + 0.04) / 2;
  p.add(rim);
  // Four hold-down legs.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.4), steel);
    leg.position.set(Math.sin(a) * 2.6, ROCKET.padTop + 0.45, Math.cos(a) * 2.6);
    leg.castShadow = true;
    p.add(leg);
  }
  // Slim service/gantry mast beside the pad with two crossarms.
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.45, 11, 0.45), steel);
  mast.position.set(-3.0, ROCKET.padTop + 5.5, 0);
  mast.castShadow = true;
  p.add(mast);
  for (const yy of [4.5, 8.5]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.3), steel);
    arm.position.set(-1.9, ROCKET.padTop + yy, 0);
    p.add(arm);
  }
  return p;
}

export function makeRocket(opts = {}) {
  const spawn = opts.spawn || {};
  const spawnY = spawn.y ?? 0;
  const baseY = spawnY + ROCKET.padTop; // rocket base rests on the pad platform top

  const group = buildRocketGroup();
  const pad = buildPad();
  const dyn = group.userData.dyn;

  // Authoritative state (the public surface mirrors car/boat: speed/heading + the
  // rocket-specific altitude/launched flags).
  const state = {
    x: spawn.x ?? 0,
    z: spawn.z ?? 0,
    heading: spawn.heading ?? 0,
    speed: 0,          // overall velocity magnitude (m/s) — what the drive HUD shows
    altitude: 0,       // metres above the pad top (baseY)
    launched: false,   // false = sitting on the pad, true = in flight
  };

  // Internal physics scratch (closure vars — numbers/bools, never reallocated).
  let vy = 0;            // vertical velocity (m/s)
  let vx = 0, vz = 0;    // horizontal drift velocity (m/s, world)
  let enginePower = 0;   // 0..1 spooled engine output (drives thrust + flame size)
  let _t = 0;            // time accumulator for sway / flicker
  let _leanX = 0, _leanZ = 0; // smoothed visual lean

  // Cached camera scratch.
  const _camPos = new THREE.Vector3();
  const _camLook = new THREE.Vector3();
  let _camInit = false;

  pad.position.set(state.x, spawnY, state.z);
  group.position.set(state.x, baseY, state.z);
  group.rotation.y = state.heading;

  // Copy authoritative state -> a group transform. Used for the local rocket
  // (g omitted: also keeps base Y) and for the networked remote mirror (g given).
  function syncGroup(g) {
    const t = g || group;
    t.position.x = state.x;
    t.position.z = state.z;
    t.position.y = baseY + state.altitude;
    t.rotation.y = state.heading;
  }

  // Advance one flight step.
  //   dt        seconds
  //   throttle  -1..1  MAIN ENGINE: >0 spools thrust (climb / accelerate), <=0 cuts
  //             it (gravity takes over -> descend). The same axis governs the pad
  //             spool-up that triggers LAUNCH and the thrust-vs-gravity balance aloft.
  //   steer     -1..1  YAW (only effective once launched / off the pad)
  //   ctx       optional { maxAltitude } ceiling. Other fields ignored.
  // Allocation-free.
  function drive(dt, throttle, steer, ctx) {
    throttle = throttle || 0;
    steer = steer || 0;
    _t += dt;
    const ceil = (ctx && ctx.maxAltitude) || ROCKET.defaultMaxAlt;

    // --- Engine spool: ramp enginePower toward the commanded (positive) throttle.
    // Spooling happens on the pad AND aloft; a negative throttle just commands the
    // engine to zero so gravity brings you down. ---
    const cmd = Math.max(0, throttle);
    const rate = (cmd > enginePower ? ROCKET.spoolUp : ROCKET.spoolDown) * dt;
    enginePower = clamp(enginePower + clamp(cmd - enginePower, -rate, rate), 0, 1);

    if (!state.launched) {
      // --- On the pad: hold altitude at 0, ignore steer, sway gently. Once the
      // engine spools past the liftoff threshold (with throttle still commanding
      // up) the rocket unsticks and LAUNCHES with a vertical kick. ---
      state.altitude = 0;
      vy = 0; vx = 0; vz = 0;
      if (enginePower >= ROCKET.liftoffPower && cmd > 0) {
        state.launched = true;
        vy = ROCKET.initialKick;
      }
    }

    if (state.launched) {
      // --- Vertical: thrust vs gravity, damped, capped, integrated into altitude.
      const vAccel = ROCKET.thrustAccel * enginePower - ROCKET.gravity;
      vy += vAccel * dt;
      vy -= vy * ROCKET.vDrag * dt;
      vy = clamp(vy, -ROCKET.maxClimb, ROCKET.maxClimb);
      state.altitude += vy * dt;

      // Ceiling: clamp + cancel any remaining climb so you cruise at the top.
      if (state.altitude >= ceil) {
        state.altitude = ceil;
        if (vy > 0) vy = 0;
      }

      // Touchdown: settle back onto the pad, ready to re-launch.
      if (state.altitude <= 0) {
        state.altitude = 0;
        vy = 0;
        vx *= 0.3; vz *= 0.3;
        state.launched = false;
      }

      // --- Yaw + horizontal drift (only meaningful aloft). Steer turns the nose;
      // thrusting drifts you forward along the heading; both bleed off via drag. ---
      if (state.launched) {
        state.heading -= steer * ROCKET.yawRate * dt;
        const fx = Math.sin(state.heading);
        const fz = Math.cos(state.heading);
        vx += fx * ROCKET.driftAccel * enginePower * dt;
        vz += fz * ROCKET.driftAccel * enginePower * dt;
        vx -= vx * ROCKET.hDrag * dt;
        vz -= vz * ROCKET.hDrag * dt;
        const hsp = Math.hypot(vx, vz);
        if (hsp > ROCKET.maxDrift) {
          const s = ROCKET.maxDrift / hsp;
          vx *= s; vz *= s;
        }
        state.x += vx * dt;
        state.z += vz * dt;
      }
    }

    state.speed = Math.hypot(vx, vy, vz);

    // --- Write the transform: authoritative XZ/heading + altitude, then layer the
    // visual sway (on the pad) or lean (aloft) on top (never feeds back to state). ---
    group.position.x = state.x;
    group.position.z = state.z;
    group.position.y = baseY + state.altitude;
    group.rotation.y = state.heading;

    if (!state.launched) {
      group.rotation.z = Math.sin(_t * ROCKET.swayRate) * ROCKET.swayAmp;
      group.rotation.x = Math.cos(_t * ROCKET.swayRate * 0.8) * ROCKET.swayAmp * 0.6;
      _leanX = group.rotation.x; _leanZ = group.rotation.z;
    } else {
      // Bank into yaw input + pitch into forward drift, eased for smoothness.
      const driftFwd = vx * Math.sin(state.heading) + vz * Math.cos(state.heading);
      const targetZ = -steer * ROCKET.leanMax;
      const targetX = clamp(driftFwd / ROCKET.maxDrift, -1, 1) * ROCKET.leanMax;
      const k = Math.min(1, dt * 3);
      _leanZ += (targetZ - _leanZ) * k;
      _leanX += (targetX - _leanX) * k;
      group.rotation.z = _leanZ;
      group.rotation.x = _leanX;
    }

    // --- Flame: scale + opacity track engine power, with a fast flicker. The
    // group's top stays pinned at the nozzle; only the bloom grows downward. ---
    const fp = enginePower;
    const flame = dyn.flameGroup;
    if (fp > 0.03) {
      const flick = 0.82 + Math.sin(_t * 38) * 0.12 + Math.sin(_t * 23.7) * 0.06;
      flame.visible = true;
      flame.scale.set(0.5 + fp * 0.6, (0.35 + fp * 1.05) * flick, 0.5 + fp * 0.6);
      dyn.flameMat.opacity = Math.min(0.95, fp * 1.5);
      dyn.coreMat.opacity = Math.min(1, fp * 1.8);
    } else {
      flame.visible = false;
      dyn.flameMat.opacity = 0;
      dyn.coreMat.opacity = 0;
    }

    // --- Smoke plume: bloom outward, heaviest on the pad / near the ground,
    // fading to nothing by ~16 m up. Mutates cached puff refs in place. ---
    const groundProx = 1 - Math.min(1, state.altitude / 16);
    const plume = fp * groundProx;
    for (let i = 0; i < dyn.puffs.length; i++) {
      const pf = dyn.puffs[i];
      if (plume <= 0.01) {
        if (pf.mesh.visible) { pf.mesh.visible = false; pf.mat.opacity = 0; }
        continue;
      }
      const wob = 0.5 + 0.5 * Math.sin(_t * 2.2 + pf.phase);
      const spread = 1.0 + plume * (1.8 + wob * 0.9); // push outward as it blooms
      pf.mesh.visible = true;
      pf.mesh.position.x = pf.dx * spread;
      pf.mesh.position.z = pf.dz * spread;
      const sc = 1.0 + plume * 1.6 + wob * 0.4;
      pf.mesh.scale.set(sc, sc, sc);
      pf.mat.opacity = plume * (0.45 + wob * 0.25);
    }

    // Flutter the flag for a little life.
    if (dyn.flag) dyn.flag.rotation.y = Math.sin(_t * 4) * 0.3;
  }

  // Cinematic chase camera: trails behind the heading and is hoisted further back
  // and higher the more altitude the rocket gains, so a launch reads as the camera
  // craning upward to keep the climbing stack in frame.
  function updateCamera(camera, dt) {
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    const alt = state.altitude;
    const back = ROCKET.camBack + Math.min(ROCKET.camBackMax, alt * ROCKET.camBackPerAlt);
    const up = ROCKET.camHeight + Math.min(ROCKET.camUpMax, alt * ROCKET.camUpPerAlt);
    _camPos.set(state.x - fx * back, baseY + alt + up, state.z - fz * back);
    _camLook.set(state.x + fx * 2.0, baseY + alt + ROCKET.camLook, state.z + fz * 2.0);
    if (!_camInit) {
      camera.position.copy(_camPos);
      _camInit = true;
    }
    const k = Math.min(1, dt * ROCKET.camEase);
    camera.position.lerp(_camPos, k);
    camera.lookAt(_camLook);
  }

  // Snap the chase cam behind the rocket next frame (called when you board).
  function resetCamera() {
    _camInit = false;
  }

  // AABB footprint on XZ (padded square around the base) for the static-collider
  // system — registered while the rocket is parked so you can't walk through it.
  function footprint() {
    const pad2 = 2.0;
    return { minX: state.x - pad2, maxX: state.x + pad2, minZ: state.z - pad2, maxZ: state.z + pad2 };
  }

  // Where to put the player when they disembark. On the pad: step off beside the
  // rocket (its left side) onto the ground. At altitude: an eject point just beside
  // the hull at the current height (a bail-out / platform point) — y is included so
  // the caller can place an aerial exit if it wants; grounded exits sit at y=0.
  function exitSpot() {
    const lx = Math.cos(state.heading);  // rocket's left vector
    const lz = -Math.sin(state.heading);
    const grounded = state.altitude < ROCKET.groundedAlt;
    if (grounded) {
      return { x: state.x + lx * 3.2, z: state.z + lz * 3.2, facing: state.heading + Math.PI / 2, y: 0 };
    }
    return { x: state.x + lx * 2.4, z: state.z + lz * 2.4, facing: state.heading + Math.PI / 2, y: baseY + state.altitude };
  }

  function distanceTo(x, z) {
    return Math.hypot(state.x - x, state.z - z);
  }

  return { group, pad, state, drive, updateCamera, resetCamera, footprint, exitSpot, distanceTo, syncGroup };
}
