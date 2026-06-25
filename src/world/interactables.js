// THINGS TO DO — a handful of placeable, interactive world objects the player
// triggers with E: sit on a bench, play a street piano (keys light + notes
// float), shoot a basketball hoop, use an ATM, take a selfie at a photo spot,
// and grab a hot-dog. Each is a self-contained world object with an absolute
// (x,z) position + a use `range` + a "use" action (a short animation / visual +
// a HUD line that flows through the existing rides prompt channel).
//
// buildInteractables() -> {
//   group,                              // THREE.Group of every placed object (world coords)
//   update(dt),                         // advances every object's "use" animation
//   tryUse(x, z, facing, local) -> string|null,  // E pressed: fire nearest in-range use
//   nearestPrompt(x, z) -> string|null, // hover prompt when near one (no E)
// }
//
// Design rules (mirroring skatepark.js / plaza.js):
//   • ALL materials + geometries are created ONCE at module load (shared `M`/`G`)
//     so placing/animating an object never allocates per frame or per object.
//   • These are DECORATIVE interactables — none register colliders, so the player
//     can never get wedged against one (you walk through / up to it, press E).
//   • Each def's tick() reads state.active / state.t, advances t, and auto-clears
//     active when its animation finishes — pure mutation of cached meshes.

import * as THREE from "three";

// --- Shared materials (created ONCE, reused across every placed object) ------
const M = {
  // generic structural
  wood: new THREE.MeshStandardMaterial({ color: "#8a5a32", roughness: 0.8 }),
  woodDark: new THREE.MeshStandardMaterial({ color: "#5f3d22", roughness: 0.85 }),
  metal: new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.7 }),
  metalLight: new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.4, metalness: 0.8 }),
  pole: new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.5, metalness: 0.7 }),
  // piano
  pianoBody: new THREE.MeshStandardMaterial({ color: "#26201c", roughness: 0.4, metalness: 0.1 }),
  keyWhite: new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.5 }),
  keyWhiteLit: new THREE.MeshStandardMaterial({ color: "#fff7d8", roughness: 0.4, emissive: "#ffcf5a", emissiveIntensity: 0.9 }),
  keyBlack: new THREE.MeshStandardMaterial({ color: "#15110e", roughness: 0.5 }),
  note: new THREE.MeshStandardMaterial({ color: "#ffe26a", roughness: 0.4, emissive: "#ffb43a", emissiveIntensity: 0.8, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  // hoop
  hoopPole: new THREE.MeshStandardMaterial({ color: "#5a5f66", roughness: 0.5, metalness: 0.6 }),
  backboard: new THREE.MeshStandardMaterial({ color: "#f2efe8", roughness: 0.6, transparent: true, opacity: 0.92 }),
  backboardTrim: new THREE.MeshStandardMaterial({ color: "#c4423b", roughness: 0.7 }),
  rim: new THREE.MeshStandardMaterial({ color: "#e8612a", roughness: 0.4, metalness: 0.6 }),
  net: new THREE.MeshStandardMaterial({ color: "#e8e8ea", roughness: 0.8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  ball: new THREE.MeshStandardMaterial({ color: "#e0712a", roughness: 0.85 }),
  // atm
  atmBody: new THREE.MeshStandardMaterial({ color: "#23618f", roughness: 0.5, metalness: 0.3 }),
  atmTrim: new THREE.MeshStandardMaterial({ color: "#16384f", roughness: 0.6, metalness: 0.4 }),
  atmScreen: new THREE.MeshStandardMaterial({ color: "#0a2b1f", roughness: 0.3, emissive: "#1f8f5a", emissiveIntensity: 0.4 }),
  atmKeypad: new THREE.MeshStandardMaterial({ color: "#1a1d22", roughness: 0.6 }),
  // photo spot
  tripod: new THREE.MeshStandardMaterial({ color: "#202327", roughness: 0.5, metalness: 0.6 }),
  camBody: new THREE.MeshStandardMaterial({ color: "#101216", roughness: 0.5, metalness: 0.4 }),
  camLens: new THREE.MeshStandardMaterial({ color: "#3a4452", roughness: 0.2, metalness: 0.7, emissive: "#22303c", emissiveIntensity: 0.3 }),
  frameMark: new THREE.MeshStandardMaterial({ color: "#ffd24a", roughness: 0.7, emissive: "#ffb024", emissiveIntensity: 0.35 }),
  flash: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  // hot-dog stand
  cartBody: new THREE.MeshStandardMaterial({ color: "#c4423b", roughness: 0.6 }),
  cartTop: new THREE.MeshStandardMaterial({ color: "#f2efe8", roughness: 0.6 }),
  canopy: new THREE.MeshStandardMaterial({ color: "#e7c23a", roughness: 0.7, side: THREE.DoubleSide }),
  canopyStripe: new THREE.MeshStandardMaterial({ color: "#c4423b", roughness: 0.7, side: THREE.DoubleSide }),
  wheel: new THREE.MeshStandardMaterial({ color: "#1c1c22", roughness: 0.7 }),
  bun: new THREE.MeshStandardMaterial({ color: "#d8a356", roughness: 0.8 }),
  sausage: new THREE.MeshStandardMaterial({ color: "#8a3b2a", roughness: 0.7 }),
  steam: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, transparent: true, opacity: 0, depthWrite: false }),
};

// --- Shared geometries (created ONCE, reused across repeated bits) ----------
const G = {
  noteFlat: new THREE.PlaneGeometry(0.22, 0.28),
  steamPuff: new THREE.SphereGeometry(0.12, 8, 6),
  ball: new THREE.SphereGeometry(0.22, 16, 12),
};

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// A one-off scaled box (varied sizes; repeats use the shared instanced/geo above).
function box(w, h, d, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ===========================================================================
// OBJECT BUILDERS — each returns { group, use(state, local), tick(dt, state) }
// The returned group is LOCAL (centred on the object); the caller positions it
// at the def's world (x,z). use() kicks off an animation (and may nudge the
// player); tick() advances it and clears state.active when finished.
// ===========================================================================

// 1) BENCH — a wooden slatted bench. Sitting is a VISUAL-ONLY rest (it does NOT
//    touch localPlayer's seat machine): we snap the player to the bench, face
//    them along it, and pop a tiny dust puff so the "take a load off" reads.
function buildBench() {
  const group = new THREE.Group();
  // seat slats
  for (const z of [-0.16, 0, 0.16]) {
    const slat = box(2.0, 0.08, 0.14, M.wood);
    slat.position.set(0, 0.45, z);
    group.add(slat);
  }
  // backrest slats
  for (const y of [0.72, 0.9]) {
    const back = box(2.0, 0.1, 0.06, M.wood);
    back.position.set(0, y, -0.24);
    group.add(back);
  }
  // legs / supports
  for (const x of [-0.85, 0.85]) {
    const leg = box(0.12, 0.45, 0.5, M.woodDark);
    leg.position.set(x, 0.225, 0);
    group.add(leg);
    const armPost = box(0.08, 0.5, 0.08, M.woodDark, false);
    armPost.position.set(x, 0.7, -0.24);
    group.add(armPost);
  }
  // a small dust puff that pops when you sit (reused; opacity ramps in tick)
  const dust = mesh(G.steamPuff, M.steam, false, false);
  dust.material = M.steam.clone(); // its own opacity so it doesn't fight other steam
  dust.position.set(0, 0.55, 0.3);
  dust.visible = false;
  group.add(dust);

  function use(state, local) {
    // Snap onto the bench (visual rest) and face along it (+X seat run -> face +X).
    if (local) {
      local.pos.x = group.position.x;
      local.pos.z = group.position.z + 0.05;
      local.facing = Math.PI / 2;
    }
    state.dust = dust;
  }
  function tick(dt, state) {
    if (!state.active) {
      if (dust.visible) dust.visible = false;
      return;
    }
    state.t += dt;
    const D = 0.9; // seconds
    dust.visible = true;
    const p = state.t / D;
    dust.material.opacity = Math.max(0, 0.5 * (1 - p));
    dust.position.y = 0.55 + p * 0.25;
    if (state.t >= D) {
      state.active = false;
      dust.visible = false;
    }
  }
  return { group, use, tick };
}

// 2) STREET PIANO — an upright piano with a row of white/black keys. While
//    active, keys light up in sequence and small "note" quads float up + fade.
function buildPiano() {
  const group = new THREE.Group();
  // body
  const body = box(1.6, 1.3, 0.6, M.pianoBody);
  body.position.set(0, 0.65, -0.1);
  group.add(body);
  const top = box(1.7, 0.12, 0.7, M.pianoBody, true, false);
  top.position.set(0, 1.32, -0.1);
  group.add(top);
  // music desk / fallboard front face
  const fall = box(1.5, 0.5, 0.06, M.woodDark, false);
  fall.position.set(0, 1.0, 0.22);
  group.add(fall);
  // keybed shelf
  const shelf = box(1.55, 0.1, 0.4, M.woodDark, false);
  shelf.position.set(0, 0.7, 0.28);
  group.add(shelf);
  // pedestal feet
  for (const x of [-0.7, 0.7]) {
    const foot = box(0.18, 0.7, 0.55, M.woodDark);
    foot.position.set(x, 0.35, -0.1);
    group.add(foot);
  }
  // white keys (the ones we light in sequence)
  const keys = [];
  const N = 10;
  const kw = 0.13, gap = 0.005;
  const span = N * (kw + gap);
  for (let i = 0; i < N; i++) {
    const k = box(kw, 0.05, 0.34, M.keyWhite, false, false);
    k.position.set(-span / 2 + kw / 2 + i * (kw + gap), 0.78, 0.32);
    group.add(k);
    keys.push(k);
  }
  // a few black keys sitting between the whites (purely decorative)
  for (let i = 0; i < N - 1; i++) {
    if (i % 7 === 2 || i % 7 === 6) continue; // skip a couple to fake the B/C, E/F gaps
    const bk = box(0.08, 0.06, 0.2, M.keyBlack, false, false);
    bk.position.set(-span / 2 + kw + i * (kw + gap), 0.82, 0.25);
    group.add(bk);
  }
  // floating notes (reused quads; each clones the note material for its own opacity)
  const notes = [];
  for (let i = 0; i < 5; i++) {
    const n = mesh(G.noteFlat, M.note.clone(), false, false);
    n.visible = false;
    n.position.set(0, 1.4, 0.1);
    group.add(n);
    notes.push({ mesh: n, x0: 0, phase: 0, born: -1 });
  }

  function use(state) {
    state.keys = keys;
    state.notes = notes;
    state.nextNote = 0;
  }
  function tick(dt, state) {
    // animate notes whenever any are alive, even after active clears
    const keysOn = state.active;
    const D = 2.4; // play duration
    if (keysOn) state.t += dt;
    // light keys in a marching sequence while playing
    const lit = keysOn ? Math.floor(state.t * 12) % keys.length : -1;
    for (let i = 0; i < keys.length; i++) {
      keys[i].material = i === lit ? M.keyWhiteLit : M.keyWhite;
    }
    // spawn a note roughly twice a second while playing
    if (keysOn && state.notes) {
      state.spawnAcc = (state.spawnAcc || 0) + dt;
      if (state.spawnAcc > 0.4) {
        state.spawnAcc = 0;
        const slot = state.notes[state.nextNote % state.notes.length];
        state.nextNote++;
        slot.born = 0;
        slot.x0 = -0.5 + Math.random();
        slot.phase = Math.random() * Math.PI * 2;
        slot.mesh.visible = true;
        slot.mesh.position.set(slot.x0, 1.4, 0.1);
        slot.mesh.material.opacity = 0.9;
      }
    }
    // advance every live note (independent of active so the last notes finish)
    let anyAlive = false;
    if (state.notes) {
      for (const slot of state.notes) {
        if (slot.born < 0) continue;
        anyAlive = true;
        slot.born += dt;
        const life = 1.6;
        const p = slot.born / life;
        slot.mesh.position.y = 1.4 + p * 1.1;
        slot.mesh.position.x = slot.x0 + Math.sin(slot.phase + slot.born * 3) * 0.18;
        slot.mesh.rotation.z = Math.sin(slot.phase + slot.born * 2) * 0.3;
        slot.mesh.material.opacity = Math.max(0, 0.9 * (1 - p));
        if (slot.born >= life) { slot.born = -1; slot.mesh.visible = false; }
      }
    }
    if (keysOn && state.t >= D) {
      state.active = false; // stop lighting keys + spawning; live notes still fade
    }
    if (!keysOn && !anyAlive) {
      for (let i = 0; i < keys.length; i++) keys[i].material = M.keyWhite;
    }
  }
  return { group, use, tick };
}

// 3) BASKETBALL HOOP — pole + backboard + rim + net. use() launches a ball on a
//    parabolic arc toward the rim; tick() integrates it and resets on landing.
function buildHoop() {
  const group = new THREE.Group();
  const RIM_Y = 3.05, RIM_Z = -0.15;
  // pole
  const pole = box(0.18, 3.6, 0.18, M.hoopPole);
  pole.position.set(0, 1.8, -0.7);
  group.add(pole);
  // backboard
  const board = box(1.8, 1.1, 0.08, M.backboard, false);
  board.position.set(0, 3.5, -0.55);
  group.add(board);
  const trim = box(0.7, 0.5, 0.1, M.backboardTrim, false);
  trim.position.set(0, 3.25, -0.5);
  group.add(trim);
  // rim (a torus lying flat)
  const rim = mesh(new THREE.TorusGeometry(0.26, 0.03, 8, 20), M.rim, true, false);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, RIM_Y, RIM_Z);
  group.add(rim);
  // a simple cone net hanging under the rim
  const net = mesh(new THREE.CylinderGeometry(0.26, 0.14, 0.4, 12, 1, true), M.net, false, false);
  net.position.set(0, RIM_Y - 0.22, RIM_Z);
  group.add(net);
  // the ball (reused; flown along an arc in tick)
  const ball = mesh(G.ball, M.ball, true, false);
  ball.visible = false;
  group.add(ball);

  function use(state) {
    // launch from in front of the hoop up toward the rim
    state.ball = ball;
    state.bx0 = 0; state.by0 = 1.2; state.bz0 = 2.2;     // start (in front)
    state.bx1 = 0; state.by1 = RIM_Y; state.bz1 = RIM_Z;  // target (the rim)
    state.arcH = 1.6;                                      // extra lift at the apex
    ball.visible = true;
    ball.position.set(state.bx0, state.by0, state.bz0);
  }
  function tick(dt, state) {
    if (!state.active) { if (ball.visible && !state.flying) ball.visible = false; return; }
    state.t += dt;
    const D = 0.9;
    state.flying = true;
    const p = Math.min(1, state.t / D);
    // lerp XZ, parabola in Y (start->rim plus an arc hump)
    ball.position.x = state.bx0 + (state.bx1 - state.bx0) * p;
    ball.position.z = state.bz0 + (state.bz1 - state.bz0) * p;
    const base = state.by0 + (state.by1 - state.by0) * p;
    ball.position.y = base + Math.sin(p * Math.PI) * state.arcH;
    if (p >= 1) {
      // swish: drop through the net then vanish
      state.t2 = (state.t2 || 0) + dt;
      ball.position.y = state.by1 - state.t2 * 4;
      ball.position.x = state.bx1; ball.position.z = state.bz1;
      if (state.t2 > 0.35) {
        ball.visible = false;
        state.flying = false;
        state.t2 = 0;
        state.active = false;
      }
    }
  }
  return { group, use, tick };
}

// 4) ATM — a boxy cash machine with an emissive screen. While active the screen
//    cycles a "processing… cash" glow for ~1.5 s.
function buildAtm() {
  const group = new THREE.Group();
  const body = box(0.9, 1.9, 0.7, M.atmBody);
  body.position.set(0, 0.95, 0);
  group.add(body);
  // sloped head trim
  const head = box(0.95, 0.5, 0.75, M.atmTrim, false);
  head.position.set(0, 1.95, 0);
  group.add(head);
  // screen (its own cloned material so we cycle just this object's emissive)
  const screen = mesh(new THREE.PlaneGeometry(0.55, 0.4), M.atmScreen.clone(), false, false);
  screen.position.set(0, 1.35, 0.36);
  group.add(screen);
  // keypad
  const keypad = box(0.5, 0.3, 0.06, M.atmKeypad, false);
  keypad.position.set(0, 0.95, 0.36);
  group.add(keypad);
  // cash slot
  const slot = box(0.4, 0.05, 0.06, M.atmTrim, false);
  slot.position.set(0, 0.7, 0.36);
  group.add(slot);

  function use(state) {
    state.screen = screen;
    screen.material.color.set("#0a2b1f");
    screen.material.emissive.set("#1f8f5a");
  }
  function tick(dt, state) {
    if (!state.active) {
      // idle: gentle steady glow
      screen.material.emissiveIntensity = 0.4 + Math.sin((state.idle = (state.idle || 0) + dt) * 1.5) * 0.06;
      return;
    }
    state.t += dt;
    const D = 1.5;
    // flash bright green "processing", then a gold "cash" pulse near the end
    if (state.t < D * 0.7) {
      screen.material.emissive.set("#1f8f5a");
      screen.material.emissiveIntensity = 0.6 + Math.abs(Math.sin(state.t * 14)) * 0.7;
    } else {
      screen.material.emissive.set("#e8b53a");
      screen.material.emissiveIntensity = 0.8 + Math.abs(Math.sin(state.t * 10)) * 0.8;
    }
    if (state.t >= D) {
      state.active = false;
      screen.material.emissive.set("#1f8f5a");
      screen.material.emissiveIntensity = 0.4;
    }
  }
  return { group, use, tick };
}

// 5) PHOTO SPOT — a tripod + camera + a frame marker. use() fires a flash: a
//    white plane ramps opacity up then down over ~0.4 s.
function buildPhoto() {
  const group = new THREE.Group();
  // tripod legs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = box(0.05, 1.3, 0.05, M.tripod, true, false);
    leg.position.set(Math.sin(a) * 0.25, 0.65, Math.cos(a) * 0.25);
    leg.rotation.x = Math.cos(a) * 0.18;
    leg.rotation.z = -Math.sin(a) * 0.18;
    group.add(leg);
  }
  // camera body on top, facing +Z (toward whoever stands on the marker)
  const cam = box(0.4, 0.3, 0.3, M.camBody);
  cam.position.set(0, 1.45, 0);
  group.add(cam);
  const lens = mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.18, 16), M.camLens, true, false);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 1.45, 0.22);
  group.add(lens);
  // a "stand here" frame marker on the ground in front of the camera
  const markGeo = new THREE.TorusGeometry(0.5, 0.04, 6, 24);
  const mark = mesh(markGeo, M.frameMark, false, true);
  mark.rotation.x = Math.PI / 2;
  mark.position.set(0, 0.03, 1.4);
  group.add(mark);
  // flash plane (its own cloned material; opacity ramps in tick)
  const flash = mesh(new THREE.PlaneGeometry(0.3, 0.22), M.flash.clone(), false, false);
  flash.position.set(0, 1.45, 0.34);
  group.add(flash);

  function use(state, local) {
    // turn the visitor to face the camera (camera looks +Z, so face -Z)
    if (local) local.facing = Math.PI;
    state.flash = flash;
    flash.material.opacity = 0;
  }
  function tick(dt, state) {
    if (!state.active) { if (flash.material.opacity !== 0) flash.material.opacity = 0; return; }
    state.t += dt;
    const D = 0.4;
    const p = state.t / D;
    // ramp up fast, fall off — a camera pop
    flash.material.opacity = p < 0.25 ? p / 0.25 : Math.max(0, 1 - (p - 0.25) / 0.75);
    if (state.t >= D) {
      state.active = false;
      flash.material.opacity = 0;
    }
  }
  return { group, use, tick };
}

// 6) HOT-DOG STAND — a striped-canopy cart. use() pops a few steam puffs rising
//    off the grill (like coffeeshop.js's espresso steam).
function buildHotdog() {
  const group = new THREE.Group();
  // cart body
  const body = box(1.6, 0.7, 0.8, M.cartBody);
  body.position.set(0, 0.7, 0);
  group.add(body);
  const counter = box(1.7, 0.1, 0.9, M.cartTop, false);
  counter.position.set(0, 1.08, 0);
  group.add(counter);
  // wheels
  for (const x of [-0.6, 0.6]) {
    const w = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 16), M.wheel, true, false);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.28, 0.45);
    group.add(w);
  }
  // canopy posts + striped roof
  for (const x of [-0.7, 0.7]) {
    const post = box(0.05, 1.0, 0.05, M.pole, false);
    post.position.set(x, 1.6, -0.3);
    group.add(post);
  }
  for (let i = 0; i < 5; i++) {
    const stripe = box(0.34, 0.04, 0.9, i % 2 ? M.canopyStripe : M.canopy, false, false);
    stripe.position.set(-0.68 + i * 0.34, 2.12, -0.3);
    stripe.rotation.x = -0.12;
    group.add(stripe);
  }
  // a hot-dog on the counter (decor)
  const bun = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), M.bun, false, false);
  bun.rotation.z = Math.PI / 2;
  bun.position.set(0.3, 1.16, 0.1);
  group.add(bun);
  const dog = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 10), M.sausage, false, false);
  dog.rotation.z = Math.PI / 2;
  dog.position.set(0.3, 1.2, 0.1);
  group.add(dog);
  // steam puffs over the grill (reused; each its own opacity via cloned material)
  const puffs = [];
  for (let i = 0; i < 4; i++) {
    const p = mesh(G.steamPuff, M.steam.clone(), false, false);
    p.visible = false;
    p.position.set(-0.3, 1.2, 0);
    group.add(p);
    puffs.push({ mesh: p, born: -1, x0: 0, phase: 0 });
  }

  function use(state) {
    state.puffs = puffs;
    state.spawnAcc = 0;
    state.nextPuff = 0;
  }
  function tick(dt, state) {
    const cooking = state.active;
    const D = 1.8;
    if (cooking) {
      state.t += dt;
      state.spawnAcc = (state.spawnAcc || 0) + dt;
      if (state.spawnAcc > 0.35) {
        state.spawnAcc = 0;
        const slot = puffs[state.nextPuff % puffs.length];
        state.nextPuff++;
        slot.born = 0;
        slot.x0 = -0.4 + Math.random() * 0.3;
        slot.phase = Math.random() * Math.PI * 2;
        slot.mesh.visible = true;
        slot.mesh.position.set(slot.x0, 1.2, 0.05);
        slot.mesh.material.opacity = 0.55;
      }
      if (state.t >= D) state.active = false;
    }
    for (const slot of puffs) {
      if (slot.born < 0) continue;
      slot.born += dt;
      const life = 1.4;
      const p = slot.born / life;
      slot.mesh.position.y = 1.2 + p * 0.8;
      slot.mesh.position.x = slot.x0 + Math.sin(slot.phase + slot.born * 2) * 0.1;
      const s = 1 + p * 1.2;
      slot.mesh.scale.setScalar(s);
      slot.mesh.material.opacity = Math.max(0, 0.55 * (1 - p));
      if (slot.born >= life) { slot.born = -1; slot.mesh.visible = false; slot.mesh.scale.setScalar(1); }
    }
  }
  return { group, use, tick };
}

// ===========================================================================
// DESCRIPTOR ARRAY — id, label, WORLD (x,z), use range, builder, HUD text.
// Coords use the city LAYOUT (city.js): each district tile is 60×60 centred on
// (ox,oz). All spots sit on walkable ground, clear of building footprints, on
// the open lanes / connector apron — mirroring skatepark.js's "open lanes"
// discipline. None register colliders (decorative), so they can't wedge you.
// ===========================================================================
const DEFS = [
  // Bench → plaza tile (ox:-90, oz:65), south-open area in front of the fountain.
  {
    id: "bench", label: "🪑",
    x: -90, z: 60, range: 2.4, build: buildBench,
    hintText: "🪑 Press E to sit",
    useText: "🪑 Resting on the bench…",
  },
  // Street piano → connector apron (z[10,35], fully open + always reachable),
  // near the cafe approach / market seam.
  {
    id: "piano", label: "🎹",
    x: 14, z: 32, range: 2.4, build: buildPiano,
    hintText: "🎹 Press E to play",
    useText: "🎹 Playing a tune — notes float up",
  },
  // Basketball hoop → park tile (ox:-90, oz:185): local (13,-16), open NE lawn,
  // clear of the central pond (r≈7), the gazebo (-19,-16) and the path lamps.
  {
    id: "hoop", label: "🏀",
    x: -77, z: 169, range: 3.0, build: buildHoop,
    hintText: "🏀 Press E to shoot",
    useText: "🏀 Shooting hoops — swish!",
  },
  // ATM → downtown tile (ox:-90, oz:125): local (0,-12), on the wide central
  // north avenue between the flagship towers (x≈0 lane stays open/drivable).
  {
    id: "atm", label: "🏧",
    x: -90, z: 113, range: 2.2, build: buildAtm,
    hintText: "🏧 Press E to withdraw",
    useText: "🏧 Withdrawing… cha-ching!",
  },
  // Photo spot → connector apron near the cafe approach (always reachable).
  {
    id: "photo", label: "📸",
    x: -8, z: 30, range: 2.2, build: buildPhoto,
    hintText: "📸 Press E for a selfie",
    useText: "📸 Say cheese! *flash*",
  },
  // Hot-dog stand → connector apron (z[10,35], fully open), market side,
  // opposite the piano so the two don't crowd one approach.
  {
    id: "hotdog", label: "🌭",
    x: 40, z: 32, range: 2.4, build: buildHotdog,
    hintText: "🌭 Press E for a hot-dog",
    useText: "🌭 One hot-dog, coming up!",
  },
];

export function buildInteractables() {
  const group = new THREE.Group();
  group.name = "interactables";

  // Build + place every def, recording a runtime item { def, obj, state }.
  const items = [];
  for (const def of DEFS) {
    let obj = null;
    try {
      obj = def.build(M);
    } catch (e) {
      // One broken object must not take down the rest.
      console.warn("[interactables] build failed", def.id, e);
      continue;
    }
    if (!obj || !obj.group) continue;
    obj.group.position.set(def.x, 0, def.z);
    group.add(obj.group);
    items.push({ def, obj, state: { active: false, t: 0 } });
  }

  // Nearest item whose centre is within its use range of (x,z), else null.
  // Squared-distance compare (like rides.js grindAt / localPlayer seat search).
  function nearestItem(x, z) {
    let best = null, bestD = Infinity;
    for (const it of items) {
      const dx = x - it.def.x, dz = z - it.def.z;
      const d = dx * dx + dz * dz;
      const r = it.def.range;
      if (d <= r * r && d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  // Hover prompt when standing near one (no E pressed).
  function nearestPrompt(x, z) {
    const it = nearestItem(x, z);
    return it ? it.def.hintText : null;
  }

  // E pressed: fire the nearest in-range object's use, return its HUD line.
  // null => nothing in range, so rides.js falls through to the skate fallback.
  function tryUse(x, z, facing, local) {
    const it = nearestItem(x, z);
    if (!it) return null;
    it.state.active = true;
    it.state.t = 0;
    it.state.t2 = 0;
    try {
      it.obj.use?.(it.state, local);
    } catch (e) {
      console.warn("[interactables] use failed", it.def.id, e);
    }
    return it.def.useText;
  }

  // Advance every object's animation (active or winding down). Pure mutation of
  // cached meshes/materials — no allocation.
  function update(dt) {
    for (const it of items) {
      try { it.obj.tick?.(dt, it.state); } catch { /* an anim error must not kill the loop */ }
    }
  }

  return { group, update, tryUse, nearestPrompt };
}
