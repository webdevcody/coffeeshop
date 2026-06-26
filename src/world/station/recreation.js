// STATION RECREATION LOUNGE — a walkable crew rec-room module that lives at the
// space-station altitude, EAST of the existing station interior (which sits at
// x≈300). This one parks at the caller-supplied (ox,oz) on the same deck height
// (floorY≈260) so it slots into the station complex as "the fun deck".
//
// MIRRORS the module contract used across the world files (ocean / space / zones):
//   buildStationRecreation(opts) -> { group, update(dt), ground, colliders }
//   • group      — a THREE.Group parked at WORLD (ox, floorY, oz). EVERYTHING
//                  inside is LOCAL: the deck top is local y=0, so when the player
//                  is lifted onto `ground` their feet read as standing on it.
//   • ground     — ONE walkable rect (world XZ) = the rec-deck footprint.
//   • colliders  — TIGHT world-XZ AABBs around the SOLID equipment only, arranged
//                  so a clear walking path threads the room (central spine + a
//                  loop around the seating). Perimeter walls bound the deck.
//   • update(dt) — ALLOCATION-FREE. Animates the big lounge screen ("a game" with
//                  a bouncing puck + paddles), the arcade cabinet (hue-cycling
//                  screen + blinking marquee bulbs), the drifting zero-g balls,
//                  and the neon strip lighting pulse — all via cached refs, no
//                  `new`/Vector churn per frame.
//
// WHAT'S ON THE DECK (go-all-out rec lounge):
//   a glowing ARCADE CABINET • a felt POOL TABLE with balls + cue • a row of
//   EXERCISE machines (TREADMILL w/ lit console, spin BIKE, WEIGHT bench+rack) •
//   a wall-mounted BASKETBALL mini-hoop • a curved SOFA + chunky BEAN BAGS facing
//   a big glowing GAME SCREEN • a ZERO-G play zone with balls drifting in the air •
//   SNACK + DRINK dispensers • NEON strip lighting • POSTERS • leafy PLANTS.
//
// ── ALLOCATION DISCIPLINE ───────────────────────────────────────────────────
// Shared structural materials + a few geometries are created ONCE at module
// scope. The build phase allocates freely (it runs once). update(dt) only mutates
// cached transforms + material scalars/colors (Color.setHSL mutates in place — no
// allocation) on small handle lists.

import * as THREE from "three";

// ── Shared structural materials (created ONCE) ──────────────────────────────
const matDeck     = new THREE.MeshStandardMaterial({ color: "#2e333b", roughness: 0.7, metalness: 0.4 });
const matDeckTrim = new THREE.MeshStandardMaterial({ color: "#3c434d", roughness: 0.6, metalness: 0.5 });
const matWall     = new THREE.MeshStandardMaterial({ color: "#454c57", roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
const matWallTrim = new THREE.MeshStandardMaterial({ color: "#5a626d", roughness: 0.5, metalness: 0.5 });
const matCeil     = new THREE.MeshStandardMaterial({ color: "#363c45", roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
const matBlack    = new THREE.MeshStandardMaterial({ color: "#15171c", roughness: 0.6, metalness: 0.4 });
const matMetal    = new THREE.MeshStandardMaterial({ color: "#9aa3ad", roughness: 0.4, metalness: 0.75 });
const matMetalDk  = new THREE.MeshStandardMaterial({ color: "#4c535c", roughness: 0.5, metalness: 0.65 });
const matChrome   = new THREE.MeshStandardMaterial({ color: "#c8cfd6", roughness: 0.2, metalness: 0.9 });
const matWood     = new THREE.MeshStandardMaterial({ color: "#7a4a2a", roughness: 0.6, metalness: 0.1 });
const matFelt     = new THREE.MeshStandardMaterial({ color: "#157a3e", roughness: 0.95, metalness: 0.0 });
const matSofa     = new THREE.MeshStandardMaterial({ color: "#7d3550", roughness: 0.9, metalness: 0.05 });
const matPad      = new THREE.MeshStandardMaterial({ color: "#23262d", roughness: 0.8, metalness: 0.1 });
const matWhite    = new THREE.MeshStandardMaterial({ color: "#eef2f6", roughness: 0.5, metalness: 0.1 });
const matPot      = new THREE.MeshStandardMaterial({ color: "#8a5a3a", roughness: 0.8, metalness: 0.05 });
const matFoliage  = new THREE.MeshStandardMaterial({ color: "#2f8f46", roughness: 0.9, metalness: 0.0, flatShading: true });
const matRim      = new THREE.MeshStandardMaterial({ color: "#ff7a1a", roughness: 0.5, metalness: 0.3, emissive: "#ff5a00", emissiveIntensity: 0.6 });
const matRubber   = new THREE.MeshStandardMaterial({ color: "#1a1c20", roughness: 0.9, metalness: 0.1 });

// ── Shared geometries (created ONCE) ────────────────────────────────────────
const G = {
  ball:    new THREE.SphereGeometry(0.12, 12, 8),     // pool ball
  bulb:    new THREE.SphereGeometry(0.09, 8, 6),      // marquee bulb
  leg:     new THREE.CylinderGeometry(0.08, 0.08, 0.85, 8),
  post:    new THREE.CylinderGeometry(0.05, 0.05, 1, 6),
  zball:   new THREE.IcosahedronGeometry(0.3, 1),     // zero-g ball
  pot:     new THREE.CylinderGeometry(0.4, 0.32, 0.7, 12),
  foliage: new THREE.IcosahedronGeometry(0.8, 0),
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

export function buildStationRecreation(opts = {}) {
  const ox = opts.ox != null ? opts.ox : 624;
  const oz = opts.oz != null ? opts.oz : 130;
  const floorY = opts.floorY != null ? opts.floorY : 260;

  const group = new THREE.Group();
  group.name = "stationRecreation";
  group.position.set(ox, floorY, oz);

  // ── Returned contract ─────────────────────────────────────────────────────
  const ground = [{ minX: ox - 19, maxX: ox + 19, minZ: oz - 16, maxZ: oz + 16 }];
  const colliders = [];
  // Solid-equipment AABB helper: takes LOCAL centre + size, pushes WORLD rect.
  function solid(cx, cz, w, d) {
    colliders.push({ minX: ox + cx - w / 2, maxX: ox + cx + w / 2, minZ: oz + cz - d / 2, maxZ: oz + cz + d / 2 });
  }

  // ── Animated handles (mutated allocation-free in update) ──────────────────
  const screens = [];      // { mat, base, amp, rate, phase }  glowing screen pulse
  const arcadeLights = [];  // { mat, rate, phase }            blinking marquee bulbs
  const zeroBalls = [];     // { mesh, bx,by,bz, ax,ay,az, fx,fy,fz, px,py,pz, sx,sy }
  const neon = [];          // { mat, base, amp, rate, phase, hue, hueRate }
  let arcadeScreenMat = null;
  let bigScreenMat = null;
  let puck = null, paddleL = null, paddleR = null, bikeWheel = null;

  // Room half-extents (match the ground rect) + wall metrics.
  const HW = 19, HD = 16, WH = 6, WT = 0.5;

  // Make + register a neon strip material (dark body, bright emissive).
  function makeNeon(hex, rate, phase, hue, hueRate) {
    const m = new THREE.MeshStandardMaterial({ color: "#0c0d11", emissive: hex, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.2 });
    neon.push({ mat: m, base: 1.1, amp: 0.7, rate, phase, hue: hue != null ? hue : -1, hueRate: hueRate || 0 });
    return m;
  }

  // ── DECK ──────────────────────────────────────────────────────────────────
  const deck = box(HW * 2, 0.4, HD * 2, matDeck, false, true);
  deck.position.y = -0.2; // top face at local y=0
  group.add(deck);
  // Subtle deck trim border + a glowing walkway runner up the centre.
  const runner = box(3.0, 0.04, HD * 2 - 1, makeNeon("#1fa6ff", 0.7, 0.0), false, false);
  runner.position.set(0, 0.02, 0);
  group.add(runner);
  // Zero-g zone floor ring (glowing decal) front-centre.
  const zring = mesh(new THREE.RingGeometry(3.2, 4.0, 36), makeNeon("#b14bff", 1.1, 1.2), false, false);
  zring.rotation.x = -Math.PI / 2;
  zring.position.set(0, 0.03, -8);
  group.add(zring);

  // ── WALLS (cosmetic panels + perimeter colliders; doorway gap in -Z) ───────
  function wall(cx, cz, w, d) {
    const wl = box(w, WH, d, matWall, false, true);
    wl.position.set(cx, WH / 2, cz);
    group.add(wl);
    solid(cx, cz, w, d);
    // wall-top trim rail
    const trim = box(w, 0.18, d + 0.04, matWallTrim, false, false);
    trim.position.set(cx, WH - 0.2, cz);
    group.add(trim);
  }
  // West (-X / LEFT) + East (+X / RIGHT) END walls OPEN into the neighbouring
  // zones: this module sits mid-run on one continuous east-west deck, so its X-end
  // panels are "false walls" between zones. Instead of one solid panel each, build
  // two short corner stubs per end and leave a WIDE full-height doorway gap
  // (DOOR_W m, centered on z=0) so players walk straight through along the long
  // axis and see clean into the next zone. The basketball hoop (z≈13), arcade
  // (z≈12) and vending (z≈-10) all sit inside the surviving +Z/-Z stub regions, so
  // they stay backed by wall; only the posters get re-anchored (below).
  const DOOR_W = 11;                       // open span (>= 10 m), centered on z=0
  const endSpan = HD * 2 + WT;             // full z-depth of an end wall
  const stubD = (endSpan - DOOR_W) / 2;   // remaining corner-stub depth (each end)
  const stubCz = DOOR_W / 2 + stubD / 2;  // stub centre offset in z
  for (const sx of [-1, 1]) {              // -1 = west (left), +1 = east (right)
    const wx = sx * (HW + WT / 2);
    wall(wx, stubCz, WT, stubD);           // +Z corner stub
    wall(wx, -stubCz, WT, stubD);          // -Z corner stub
  }
  wall(0, HD + WT / 2, HW * 2 + WT, WT);           // north (screen wall)
  wall(-HW / 2 - 0.6, -HD - WT / 2, HW - 1.2, WT); // south-left  (doorway gap x[-2.5,2.5])
  wall(HW / 2 + 0.6, -HD - WT / 2, HW - 1.2, WT);  // south-right

  // ── CEILING + neon ceiling strips ──────────────────────────────────────────
  const ceil = box(HW * 2, 0.3, HD * 2, matCeil, false, false);
  ceil.position.y = WH;
  group.add(ceil);
  for (const cz of [-9, 0, 9]) {
    const cs = box(HW * 1.7, 0.08, 0.4, makeNeon("#37e0ff", 0.9, cz * 0.2), false, false);
    cs.position.set(0, WH - 0.25, cz);
    group.add(cs);
  }
  // Perimeter wall-top neon (rainbow-cycling) on each long wall.
  for (const sx of [-1, 1]) {
    const ns = box(0.1, 0.16, HD * 1.8, makeNeon("#ff2ad0", 0.6, sx, 0.5 + sx * 0.25, 0.04), false, false);
    ns.position.set(sx * (HW - 0.2), WH - 0.5, 0);
    group.add(ns);
  }

  // ── BIG GAME SCREEN on the north wall + curved sofa + bean bags ────────────
  {
    const bezel = box(11.6, 5.4, 0.3, matBlack, false, false);
    bezel.position.set(0, 3.4, HD - 0.35);
    group.add(bezel);
    bigScreenMat = new THREE.MeshStandardMaterial({ color: "#05203a", roughness: 0.3, metalness: 0.1, emissive: "#1f8fff", emissiveIntensity: 1.0 });
    const panel = box(11, 4.8, 0.12, bigScreenMat, false, false);
    panel.position.set(0, 3.4, HD - 0.55);
    group.add(panel);
    screens.push({ mat: bigScreenMat, base: 0.95, amp: 0.25, rate: 1.1, phase: 0 });
    // The "game" playing on it: a bright puck + two paddles, just in front of glass.
    const playMat = new THREE.MeshStandardMaterial({ color: "#0a1424", roughness: 0.4, emissive: "#ffe14a", emissiveIntensity: 1.3 });
    puck = box(0.45, 0.45, 0.06, playMat, false, false);
    puck.position.set(0, 3.4, HD - 0.62);
    group.add(puck);
    const padMat = new THREE.MeshStandardMaterial({ color: "#0a1424", roughness: 0.4, emissive: "#37ff9a", emissiveIntensity: 1.0 });
    paddleL = box(0.3, 1.4, 0.06, padMat, false, false);
    paddleL.position.set(-4.9, 3.4, HD - 0.62);
    group.add(paddleL);
    paddleR = box(0.3, 1.4, 0.06, padMat, false, false);
    paddleR.position.set(4.9, 3.4, HD - 0.62);
    group.add(paddleR);
  }
  // Curved sofa (C-shape opening toward the screen) — back bench + two wings.
  function sofaSeg(cx, cz, w, d, backOnZ) {
    const seat = box(w, 0.5, d, matSofa, true, true);
    seat.position.set(cx, 0.45, cz);
    group.add(seat);
    const back = backOnZ
      ? box(w, 1.2, 0.4, matSofa, true, false)
      : box(0.4, 1.2, d, matSofa, true, false);
    back.position.set(cx + (backOnZ ? 0 : (cx < 0 ? -w / 2 + 0.2 : w / 2 - 0.2)), 1.0, cz + (backOnZ ? -d / 2 + 0.2 : 0));
    group.add(back);
  }
  sofaSeg(0, 6, 6.4, 2.0, true);     // back bench (sitters face +Z toward screen)
  sofaSeg(-5.6, 7.8, 1.8, 3.4, false); // left wing
  sofaSeg(5.6, 7.8, 1.8, 3.4, false);  // right wing
  solid(0, 6, 6.6, 2.2);
  solid(-5.7, 7.8, 2.0, 3.6);
  solid(5.7, 7.8, 2.0, 3.6);
  // Bean bags between sofa and screen.
  const beanCols = ["#d8453a", "#3a7bd8", "#e0a92a"];
  let bi = 0;
  for (const [bx, bz] of [[-2.6, 11], [2.6, 11], [0, 9.5]]) {
    const bm = new THREE.MeshStandardMaterial({ color: beanCols[bi % 3], roughness: 0.95, metalness: 0.0, flatShading: true });
    const bag = mesh(new THREE.IcosahedronGeometry(0.85, 1), bm, true, true);
    bag.scale.set(1, 0.7, 1);
    bag.position.set(bx, 0.55, bz);
    group.add(bag);
    solid(bx, bz, 1.5, 1.5);
    bi++;
  }

  // ── ARCADE CABINET (back-left, against the west wall, facing +X) ───────────
  {
    const cx = -HW + 1.0, cz = 12;
    const body = box(1.0, 2.4, 1.4, new THREE.MeshStandardMaterial({ color: "#2b1c6e", roughness: 0.5, metalness: 0.3 }), true, true);
    body.position.set(cx, 1.2, cz);
    group.add(body);
    // marquee (top, lit)
    const marquee = box(1.05, 0.5, 1.45, new THREE.MeshStandardMaterial({ color: "#120a30", roughness: 0.4, emissive: "#ff36c0", emissiveIntensity: 1.2 }), false, false);
    marquee.position.set(cx + 0.05, 2.5, cz);
    group.add(marquee);
    screens.push({ mat: marquee.material, base: 1.1, amp: 0.4, rate: 2.0, phase: 0.7 });
    // screen (front +X, angled, hue-cycling)
    arcadeScreenMat = new THREE.MeshStandardMaterial({ color: "#04121f", roughness: 0.3, emissive: "#28e0ff", emissiveIntensity: 1.2 });
    const scr = box(0.1, 1.1, 1.1, arcadeScreenMat, false, false);
    scr.position.set(cx + 0.55, 1.75, cz);
    group.add(scr);
    // control panel (sloped) + joystick + buttons
    const panel = box(0.7, 0.12, 1.2, matBlack, true, false);
    panel.position.set(cx + 0.7, 1.0, cz);
    panel.rotation.z = -0.5;
    group.add(panel);
    const stick = mesh(G.post, matMetal, false, false);
    stick.scale.y = 0.3;
    stick.position.set(cx + 0.75, 1.2, cz - 0.3);
    group.add(stick);
    const knob = mesh(new THREE.SphereGeometry(0.07, 8, 6), matRim, false, false);
    knob.position.set(cx + 0.75, 1.35, cz - 0.3);
    group.add(knob);
    for (let b = 0; b < 4; b++) {
      const btnMat = new THREE.MeshStandardMaterial({ color: "#0a0a0a", roughness: 0.4, emissive: ["#ff3030", "#30ff60", "#3060ff", "#ffd030"][b], emissiveIntensity: 0.9 });
      const btn = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), btnMat, false, false);
      btn.position.set(cx + 0.72, 1.18, cz + 0.05 + b * 0.18);
      group.add(btn);
    }
    // blinking marquee bulbs around the top
    for (let i = 0; i < 6; i++) {
      const bm = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4, emissive: "#ffe680", emissiveIntensity: 1.4 });
      const bulb = mesh(G.bulb, bm, false, false);
      bulb.position.set(cx + 0.58, 2.28 + (i % 2) * 0.1, cz - 0.6 + i * 0.24);
      group.add(bulb);
      arcadeLights.push({ mat: bm, rate: 6.0, phase: i * 0.9 });
    }
    solid(cx, cz, 1.6, 1.6);
  }

  // ── POOL TABLE (front-left floor) ──────────────────────────────────────────
  {
    const px = -11, pz = -6, topY = 0.85;
    const railMat = matWood;
    const slate = box(4.6, 0.25, 2.4, matFelt, true, true);
    slate.position.set(px, topY, pz);
    group.add(slate);
    // rails
    for (const sx of [-1, 1]) {
      const r = box(0.3, 0.4, 2.7, railMat, true, false);
      r.position.set(px + sx * 2.45, topY + 0.05, pz);
      group.add(r);
    }
    for (const sz of [-1, 1]) {
      const r = box(5.2, 0.4, 0.3, railMat, true, false);
      r.position.set(px, topY + 0.05, pz + sz * 1.35);
      group.add(r);
    }
    // pockets (dark cylinders at the 6 spots)
    for (const [qx, qz] of [[-2.4, -1.3], [0, -1.3], [2.4, -1.3], [-2.4, 1.3], [0, 1.3], [2.4, 1.3]]) {
      const pk = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12), matBlack, false, false);
      pk.position.set(px + qx, topY + 0.18, pz + qz);
      group.add(pk);
    }
    // legs
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lg = box(0.3, topY, 0.3, railMat, true, false);
      lg.position.set(px + sx * 2.0, topY / 2, pz + sz * 0.95);
      group.add(lg);
    }
    // a rack of balls + cue ball
    const ballCols = ["#f2d22a", "#2a55e0", "#e02a2a", "#7a2ad0", "#e07a2a", "#2aa84a", "#a02a2a"];
    let n = 0;
    for (let row = 0; row < 3; row++) {
      for (let c = 0; c <= row; c++) {
        const bm = new THREE.MeshStandardMaterial({ color: ballCols[n % ballCols.length], roughness: 0.3, metalness: 0.1 });
        const ball = mesh(G.ball, bm, true, false);
        ball.position.set(px + 1.2 + row * 0.22, topY + 0.25, pz - row * 0.12 + c * 0.24);
        group.add(ball);
        n++;
      }
    }
    const cue = mesh(G.ball, matWhite, true, false);
    cue.position.set(px - 1.4, topY + 0.25, pz);
    group.add(cue);
    // cue stick leaning on the rail
    const stick = mesh(new THREE.CylinderGeometry(0.025, 0.04, 2.8, 8), matWood, true, false);
    stick.position.set(px - 1.0, topY + 0.6, pz + 1.5);
    stick.rotation.set(0.5, 0, 0.4);
    group.add(stick);
    solid(px, pz, 5.4, 3.2);
  }

  // ── EXERCISE ROW (east wall, facing -X) ────────────────────────────────────
  // Treadmill
  {
    const tx = HW - 1.4, tz = 9;
    const base = box(2.2, 0.3, 1.2, matMetalDk, true, true);
    base.position.set(tx, 0.15, tz);
    group.add(base);
    const belt = box(2.0, 0.06, 0.9, matRubber, false, false);
    belt.position.set(tx, 0.33, tz);
    group.add(belt);
    // console on the -X (room) side
    const postL = box(0.1, 1.3, 0.1, matMetal, true, false);
    postL.position.set(tx - 0.9, 1.0, tz - 0.45);
    group.add(postL);
    const postR = box(0.1, 1.3, 0.1, matMetal, true, false);
    postR.position.set(tx - 0.9, 1.0, tz + 0.45);
    group.add(postR);
    const bar = box(0.12, 0.12, 1.1, matChrome, false, false);
    bar.position.set(tx - 0.9, 1.6, tz);
    group.add(bar);
    const conMat = new THREE.MeshStandardMaterial({ color: "#04121f", roughness: 0.3, emissive: "#2affc0", emissiveIntensity: 1.0 });
    const con = box(0.08, 0.55, 0.9, conMat, false, false);
    con.position.set(tx - 0.92, 1.45, tz);
    con.rotation.z = 0.25;
    group.add(con);
    screens.push({ mat: conMat, base: 0.9, amp: 0.3, rate: 1.6, phase: 2.1 });
    solid(tx, tz, 2.4, 1.6);
  }
  // Spin bike (front wheel slowly turns in update)
  {
    const bx = HW - 1.7, bz = 1;
    const frame = box(1.0, 0.12, 0.12, matMetalDk, true, false);
    frame.position.set(bx, 0.8, bz);
    frame.rotation.z = 0.2;
    group.add(frame);
    const seat = box(0.5, 0.12, 0.3, matPad, true, false);
    seat.position.set(bx + 0.4, 1.05, bz);
    group.add(seat);
    const handle = box(0.1, 0.5, 0.1, matMetal, true, false);
    handle.position.set(bx - 0.45, 1.0, bz);
    group.add(handle);
    const hbar = box(0.1, 0.1, 0.5, matChrome, false, false);
    hbar.position.set(bx - 0.45, 1.2, bz);
    group.add(hbar);
    bikeWheel = mesh(new THREE.TorusGeometry(0.45, 0.06, 8, 18), matMetal, true, false);
    bikeWheel.position.set(bx - 0.5, 0.55, bz);
    group.add(bikeWheel);
    const rear = box(0.1, 0.8, 0.5, matMetalDk, true, false);
    rear.position.set(bx + 0.5, 0.4, bz);
    group.add(rear);
    solid(bx, bz, 1.4, 1.0);
  }
  // Weight bench + rack
  {
    const wx = HW - 1.5, wz = -8;
    const bench = box(1.0, 0.2, 2.0, matPad, true, true);
    bench.position.set(wx + 0.4, 0.55, wz);
    group.add(bench);
    for (const sz of [-1, 1]) {
      const leg = box(0.8, 0.45, 0.12, matMetalDk, true, false);
      leg.position.set(wx + 0.4, 0.22, wz + sz * 0.8);
      group.add(leg);
    }
    // upright rack uprights
    for (const sz of [-1, 1]) {
      const up = box(0.12, 1.5, 0.12, matMetal, true, false);
      up.position.set(wx - 0.4, 0.75, wz + sz * 0.7);
      group.add(up);
    }
    // barbell + plates
    const bar = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 8), matChrome, true, false);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(wx - 0.4, 1.35, wz);
    group.add(bar);
    for (const sz of [-1, 1]) {
      const plate = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 16), matRubber, true, false);
      plate.rotation.x = Math.PI / 2;
      plate.position.set(wx - 0.4, 1.35, wz + sz * 0.75);
      group.add(plate);
    }
    // a couple of dumbbells on the floor
    for (const dz of [1.4, 1.8]) {
      const db = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), matMetalDk, true, false);
      db.rotation.x = Math.PI / 2;
      db.position.set(wx + 0.6, 0.18, wz + dz - 2.6);
      group.add(db);
      for (const ds of [-1, 1]) {
        const w = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 12), matRubber, true, false);
        w.rotation.x = Math.PI / 2;
        w.position.set(wx + 0.6, 0.18, wz + dz - 2.6 + ds * 0.22);
        group.add(w);
      }
    }
    solid(wx, wz, 2.6, 2.6);
  }

  // ── BASKETBALL mini-hoop (wall-mounted, back-right; no floor collider) ──────
  {
    const hx = HW - 0.4, hz = 13, hy = 3.4;
    const board = box(0.12, 1.2, 1.7, matWhite, false, false);
    board.position.set(hx, hy, hz);
    group.add(board);
    const sq = box(0.14, 0.5, 0.7, matRim, false, false);
    sq.position.set(hx - 0.02, hy - 0.1, hz);
    group.add(sq);
    const rim = mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 18), matRim, false, false);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(hx - 0.5, hy - 0.45, hz);
    group.add(rim);
    // net strands
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const strand = mesh(G.post, matWhite, false, false);
      strand.scale.y = 0.35;
      strand.position.set(hx - 0.5 + Math.cos(a) * 0.26, hy - 0.62, hz + Math.sin(a) * 0.26);
      group.add(strand);
    }
    // a basketball resting on the floor below
    const ball = mesh(new THREE.SphereGeometry(0.24, 14, 10), new THREE.MeshStandardMaterial({ color: "#d9702a", roughness: 0.8, metalness: 0.0 }), true, true);
    ball.position.set(hx - 1.8, 0.24, hz - 1);
    group.add(ball);
  }

  // ── SNACK + DRINK DISPENSERS (west wall, front, facing +X) ─────────────────
  {
    const dx = -HW + 0.9;
    for (const [dz, accent] of [[-12, "#ff3b6b"], [-9.4, "#2ad0ff"]]) {
      const body = box(1.0, 2.6, 1.5, new THREE.MeshStandardMaterial({ color: "#1c2026", roughness: 0.5, metalness: 0.4 }), true, true);
      body.position.set(dx, 1.3, dz);
      group.add(body);
      // lit glass front
      const glassMat = new THREE.MeshStandardMaterial({ color: "#0a2030", roughness: 0.2, metalness: 0.1, emissive: accent, emissiveIntensity: 0.7, transparent: true, opacity: 0.5 });
      const glass = box(0.06, 1.8, 1.2, glassMat, false, false);
      glass.position.set(dx + 0.53, 1.5, dz);
      group.add(glass);
      screens.push({ mat: glassMat, base: 0.6, amp: 0.25, rate: 1.2, phase: dz });
      // product rows behind the glass
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
        const pm = new THREE.MeshStandardMaterial({ color: ["#e0452a", "#2a9ae0", "#e0c52a", "#9a2ae0"][(r + c) % 4], roughness: 0.5, metalness: 0.2 });
        const prod = box(0.1, 0.22, 0.22, pm, false, false);
        prod.position.set(dx + 0.45, 0.85 + r * 0.42, dz - 0.4 + c * 0.4);
        group.add(prod);
      }
      // keypad / mini screen
      const kpMat = new THREE.MeshStandardMaterial({ color: "#04121f", roughness: 0.3, emissive: accent, emissiveIntensity: 1.0 });
      const kp = box(0.06, 0.4, 0.3, kpMat, false, false);
      kp.position.set(dx + 0.53, 2.0, dz + 0.55);
      group.add(kp);
      screens.push({ mat: kpMat, base: 0.9, amp: 0.3, rate: 2.2, phase: dz * 0.5 });
    }
    solid(dx, -10.7, 1.4, 3.4);
  }

  // ── PLANTS (corners; two big planters flanking the screen get colliders) ───
  function plant(cx, cz, withCollider) {
    const pot = mesh(G.pot, matPot, true, true);
    pot.position.set(cx, 0.35, cz);
    group.add(pot);
    for (let i = 0; i < 3; i++) {
      const leaf = mesh(G.foliage, matFoliage, true, false);
      leaf.position.set(cx + (i - 1) * 0.25, 1.0 + i * 0.3, cz + (i % 2 ? 0.2 : -0.2));
      leaf.scale.setScalar(0.7 + i * 0.15);
      group.add(leaf);
    }
    if (withCollider) solid(cx, cz, 0.9, 0.9);
  }
  plant(-9, HD - 1.2, true);
  plant(9, HD - 1.2, true);
  plant(-HW + 1.2, -HD + 1.4, false);
  plant(HW - 1.2, -HD + 1.4, false);

  // ── POSTERS (flat lit panels on the END-wall corner stubs; cosmetic) ───────
  // (z values kept inside the surviving stub ranges — |z| >= 5.5 — so they stay
  // mounted to wall now that the centre of each X-end is an open doorway.)
  const posterCols = ["#ff4d6d", "#4dd2ff", "#ffd24d", "#a14dff"];
  let pidx = 0;
  for (const [sx, pzs] of [[-1, [-9, 8]], [1, [-7, 10]]]) {
    for (const pz of pzs) {
      const pm = new THREE.MeshStandardMaterial({ color: posterCols[pidx % 4], roughness: 0.6, metalness: 0.1, emissive: posterCols[pidx % 4], emissiveIntensity: 0.25 });
      const poster = box(0.05, 1.6, 1.2, pm, false, false);
      poster.position.set(sx * (HW - 0.3), 3.2, pz);
      group.add(poster);
      pidx++;
    }
  }

  // ── ZERO-G PLAY ZONE — balls drifting in the air above the front-centre ring.
  {
    const zCols = ["#ff5a8a", "#4dff9a", "#4da6ff", "#ffd24d", "#c46aff", "#ff8a3a"];
    for (let i = 0; i < 8; i++) {
      const zm = new THREE.MeshStandardMaterial({ color: zCols[i % zCols.length], roughness: 0.35, metalness: 0.1, emissive: zCols[i % zCols.length], emissiveIntensity: 0.55, flatShading: true });
      const b = mesh(G.zball, zm, true, false);
      b.scale.setScalar(0.7 + Math.random() * 0.9);
      const bx = (Math.random() * 2 - 1) * 2.6;
      const bz = -8 + (Math.random() * 2 - 1) * 2.6;
      const by = 2.4 + Math.random() * 1.0;
      b.position.set(bx, by, bz);
      group.add(b);
      zeroBalls.push({
        mesh: b, bx, by, bz,
        ax: 1.4 + Math.random() * 0.8, ay: 0.8 + Math.random() * 0.5, az: 1.4 + Math.random() * 0.8,
        fx: 0.25 + Math.random() * 0.3, fy: 0.4 + Math.random() * 0.35, fz: 0.25 + Math.random() * 0.3,
        px: Math.random() * 6.28, py: Math.random() * 6.28, pz: Math.random() * 6.28,
        sx: (Math.random() - 0.5) * 0.8, sy: (Math.random() - 0.5) * 0.8,
      });
    }
  }

  // ── ANIMATION — ALLOCATION-FREE ─────────────────────────────────────────────
  let t = 0;
  function update(dt) {
    t += dt;
    // Big lounge screen "game": bounce the puck + track paddles.
    if (puck) {
      const gx = Math.sin(t * 1.3) * 4.4;
      const gy = 3.4 + Math.sin(t * 2.1 + 0.6) * 1.7;
      puck.position.x = gx;
      puck.position.y = gy;
      paddleL.position.y = 3.4 + Math.sin(t * 2.1 + 0.6) * 1.5;
      paddleR.position.y = 3.4 + Math.sin(t * 2.1 - 0.4) * 1.5;
    }
    // Glowing screen pulses (big screen, arcade marquee, treadmill console, vending).
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      s.mat.emissiveIntensity = s.base + Math.sin(t * s.rate + s.phase) * s.amp;
    }
    // Arcade cabinet screen: cycle hue + pulse.
    if (arcadeScreenMat) {
      arcadeScreenMat.emissive.setHSL((t * 0.12) % 1, 1.0, 0.55);
      arcadeScreenMat.emissiveIntensity = 1.0 + Math.sin(t * 3.0) * 0.4;
    }
    // Blinking marquee bulbs (sharp on/off chase).
    for (let i = 0; i < arcadeLights.length; i++) {
      const a = arcadeLights[i];
      a.mat.emissiveIntensity = Math.sin(t * a.rate + a.phase) > 0.2 ? 1.6 : 0.15;
    }
    // Neon strip pulse (+ rainbow cycle on those that opted in).
    for (let i = 0; i < neon.length; i++) {
      const n = neon[i];
      n.mat.emissiveIntensity = n.base + Math.sin(t * n.rate + n.phase) * n.amp;
      if (n.hue >= 0) n.mat.emissive.setHSL((n.hue + t * n.hueRate) % 1, 1.0, 0.55);
    }
    // Drifting zero-g balls (sinusoidal free-float + slow tumble).
    for (let i = 0; i < zeroBalls.length; i++) {
      const z = zeroBalls[i];
      z.mesh.position.x = z.bx + Math.sin(t * z.fx + z.px) * z.ax;
      z.mesh.position.y = z.by + Math.sin(t * z.fy + z.py) * z.ay;
      z.mesh.position.z = z.bz + Math.sin(t * z.fz + z.pz) * z.az;
      z.mesh.rotation.x += z.sx * dt;
      z.mesh.rotation.y += z.sy * dt;
    }
    // Spin bike wheel.
    if (bikeWheel) bikeWheel.rotation.z += dt * 2.5;
  }

  return { group, update, ground, colliders };
}
