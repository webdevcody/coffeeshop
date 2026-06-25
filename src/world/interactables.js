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

// 7) ARCADE CABINET — a standing cabinet with a glowing screen. use() boots a
//    "mini game": the screen hue-cycles fast while a little pixel blip bounces
//    across it, then settles back to an idle glow.
function buildArcadeCabinet() {
  const group = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: "#181028", roughness: 0.6, metalness: 0.25 });
  const matNeon = new THREE.MeshStandardMaterial({ color: "#ff3fae", roughness: 0.4, emissive: "#ff2fa0", emissiveIntensity: 0.7 });
  const matNeon2 = new THREE.MeshStandardMaterial({ color: "#27e0ff", roughness: 0.4, emissive: "#27d0ff", emissiveIntensity: 0.7 });
  const screenMat = new THREE.MeshStandardMaterial({ color: "#0a2030", roughness: 0.3, emissive: "#1f8fce", emissiveIntensity: 0.5 });
  const pixelMat = new THREE.MeshBasicMaterial({ color: "#fff2a0", transparent: true, opacity: 0, depthWrite: false });
  // body + angled top
  const body = box(1.4, 3.0, 1.0, matBody);
  body.position.set(0, 1.5, 0);
  group.add(body);
  const hood = box(1.4, 0.5, 1.0, matBody, true, false);
  hood.position.set(0, 3.05, -0.05);
  hood.rotation.x = -0.25;
  group.add(hood);
  // glowing marquee header on the front
  const marquee = box(1.3, 0.45, 0.12, matNeon, false, false);
  marquee.position.set(0, 3.0, 0.5);
  group.add(marquee);
  // the screen (its own material so only this object's emissive cycles)
  const screen = box(1.16, 1.0, 0.06, screenMat, false, false);
  screen.position.set(0, 2.35, 0.5);
  group.add(screen);
  // a screen bezel
  const bezel = box(1.3, 1.16, 0.05, matBody, false, false);
  bezel.position.set(0, 2.35, 0.47);
  group.add(bezel);
  // bouncing "game" pixel (lives just in front of the screen)
  const pixel = mesh(new THREE.PlaneGeometry(0.13, 0.13), pixelMat, false, false);
  pixel.position.set(0, 2.35, 0.55);
  group.add(pixel);
  // control deck + joystick + buttons
  const deck = box(1.3, 0.25, 0.7, matBody, false);
  deck.position.set(0, 1.5, 0.62);
  deck.rotation.x = 0.18;
  group.add(deck);
  const stick = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.32, 8), matBody, false, false);
  stick.position.set(-0.3, 1.7, 0.62);
  group.add(stick);
  const knob = mesh(new THREE.SphereGeometry(0.08, 10, 8), matNeon, false, false);
  knob.position.set(-0.3, 1.86, 0.62);
  group.add(knob);
  for (let i = 0; i < 3; i++) {
    const btn = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), i % 2 ? matNeon : matNeon2, false, false);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0.1 + i * 0.18, 1.66, 0.66);
    group.add(btn);
  }
  // side neon stripes
  for (const sx of [-0.72, 0.72]) {
    const stripe = box(0.05, 2.6, 0.05, matNeon2, false, false);
    stripe.position.set(sx, 1.6, 0.45);
    group.add(stripe);
  }

  function use(state, local) {
    if (local) local.facing = Math.PI; // turn to face the screen (front is +Z)
  }
  function tick(dt, state) {
    if (!state.active) {
      if (pixelMat.opacity !== 0) pixelMat.opacity = 0;
      // idle attract-mode shimmer
      state.idle = (state.idle || 0) + dt;
      screenMat.emissiveIntensity = 0.45 + Math.sin(state.idle * 2.2) * 0.12;
      screenMat.emissive.setHSL((state.idle * 0.05) % 1, 0.7, 0.45);
      return;
    }
    state.t += dt;
    const D = 3.2;
    // fast hue-cycling "game" screen
    screenMat.emissive.setHSL((state.t * 0.9) % 1, 0.85, 0.5);
    screenMat.emissiveIntensity = 0.8 + Math.abs(Math.sin(state.t * 16)) * 0.5;
    // a blip bouncing around the screen bounds
    pixelMat.opacity = 0.95;
    pixel.position.x = Math.sin(state.t * 9.0) * 0.42;
    pixel.position.y = 2.35 + Math.sin(state.t * 7.0 + 1.3) * 0.32;
    if (state.t >= D) {
      state.active = false;
      pixelMat.opacity = 0;
    }
  }
  return { group, use, tick };
}

// 8) CLAW MACHINE — a glass prize cabinet. use() drives the claw DOWN into the
//    prize pile, the fingers pinch shut, then it rises with a grabbed toy before
//    resetting.
function buildClaw() {
  const group = new THREE.Group();
  const matCab = new THREE.MeshStandardMaterial({ color: "#c4356b", roughness: 0.6, metalness: 0.2 });
  const matTrim = new THREE.MeshStandardMaterial({ color: "#ffd23f", roughness: 0.4, emissive: "#ffb01f", emissiveIntensity: 0.5 });
  const matGlass = new THREE.MeshStandardMaterial({ color: "#bfe6f2", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
  const matMetal = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.4, metalness: 0.8 });
  const prizeMats = [
    new THREE.MeshStandardMaterial({ color: "#ff5a8a", roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: "#4fd2ff", roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: "#9fff6a", roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: "#ffd23f", roughness: 0.7 }),
  ];
  // base cabinet
  const base = box(1.7, 1.0, 1.5, matCab);
  base.position.set(0, 0.5, 0);
  group.add(base);
  const tray = box(0.7, 0.12, 0.4, matTrim, false);
  tray.position.set(0, 0.7, 0.62);
  group.add(tray);
  // glass chamber pillars + panes
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.7, 0.7]) {
    const post = box(0.08, 1.7, 0.08, matMetal, false);
    post.position.set(sx, 1.95, sz);
    group.add(post);
  }
  const glass = box(1.6, 1.65, 1.4, matGlass, false, false);
  glass.position.set(0, 1.95, 0);
  group.add(glass);
  const lid = box(1.74, 0.12, 1.54, matCab, false);
  lid.position.set(0, 2.86, 0);
  group.add(lid);
  const sign = box(1.2, 0.4, 0.1, matTrim, false, false);
  sign.position.set(0, 2.86, 0.74);
  group.add(sign);
  // a pile of prize toys at the bottom of the chamber
  for (let i = 0; i < 9; i++) {
    const s = 0.18 + (i % 3) * 0.04;
    const p = mesh(new THREE.SphereGeometry(s, 8, 6), prizeMats[i % prizeMats.length], true, false);
    const a = (i / 9) * Math.PI * 2;
    p.position.set(Math.cos(a) * (0.18 + (i % 2) * 0.22), 1.28 + (i % 2) * 0.05, Math.sin(a) * (0.18 + (i % 2) * 0.2));
    group.add(p);
  }
  // gantry rail near the top
  const rail = box(1.4, 0.08, 0.08, matMetal, false);
  rail.position.set(0, 2.7, 0);
  group.add(rail);
  // claw assembly (descends/rises as a group; fingers pinch)
  const clawGrp = new THREE.Group();
  clawGrp.position.set(0, 2.55, 0);
  group.add(clawGrp);
  const cord = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), matMetal, false, false);
  cord.position.set(0, 0.25, 0);
  clawGrp.add(cord);
  const hub = mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.14, 10), matMetal, true, false);
  hub.position.set(0, 0, 0);
  clawGrp.add(hub);
  const fingers = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.rotation.y = a;
    const finger = box(0.05, 0.34, 0.08, matMetal, true, false);
    finger.position.set(0, -0.18, 0.12);
    pivot.add(finger);
    pivot.position.set(0, -0.04, 0);
    clawGrp.add(pivot);
    fingers.push(pivot);
  }
  // the toy the claw "grabs" (rides with the claw during the lift)
  const grabbed = mesh(new THREE.SphereGeometry(0.2, 8, 6), prizeMats[0], true, false);
  grabbed.position.set(0, -0.34, 0);
  grabbed.visible = false;
  clawGrp.add(grabbed);

  const TOP = 2.55, BOTTOM = 1.45;
  function use() {
    clawGrp.position.y = TOP;
    grabbed.visible = false;
    for (const f of fingers) f.children[0].rotation.x = -0.45; // open
  }
  function tick(dt, state) {
    if (!state.active) return;
    state.t += dt;
    const D = 2.8;
    const t = state.t;
    if (t < 0.9) {
      // descend
      clawGrp.position.y = TOP + (BOTTOM - TOP) * (t / 0.9);
      for (const f of fingers) f.children[0].rotation.x = -0.45;
    } else if (t < 1.3) {
      // pinch shut over the pile
      clawGrp.position.y = BOTTOM;
      const c = (t - 0.9) / 0.4;
      for (const f of fingers) f.children[0].rotation.x = -0.45 + c * 0.6;
      grabbed.visible = c > 0.6;
    } else if (t < D) {
      // rise with the prize
      const c = (t - 1.3) / (D - 1.3);
      clawGrp.position.y = BOTTOM + (TOP - BOTTOM) * c;
      grabbed.visible = true;
    } else {
      state.active = false;
      clawGrp.position.y = TOP;
      grabbed.visible = false;
      for (const f of fingers) f.children[0].rotation.x = -0.45;
    }
  }
  return { group, use, tick };
}

// 9) VENDING MACHINE — a lit snack machine. use() drops a can: it falls from a
//    shelf, bounces in the delivery tray with a clunk, then settles.
function buildVending() {
  const group = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: "#c43a2c", roughness: 0.5, metalness: 0.3 });
  const matSide = new THREE.MeshStandardMaterial({ color: "#7c241a", roughness: 0.6, metalness: 0.3 });
  const matGlass = new THREE.MeshStandardMaterial({ color: "#bfe6f2", roughness: 0.12, metalness: 0.2, emissive: "#2a6f8c", emissiveIntensity: 0.3, transparent: true, opacity: 0.35 });
  const matDark = new THREE.MeshStandardMaterial({ color: "#15171b", roughness: 0.6 });
  const matCan = new THREE.MeshStandardMaterial({ color: "#ffd23f", roughness: 0.4, metalness: 0.5 });
  const prodMats = [
    new THREE.MeshStandardMaterial({ color: "#4fd2ff", roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ color: "#9fff6a", roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ color: "#ff5a8a", roughness: 0.6 }),
  ];
  const body = box(1.1, 2.4, 0.8, matBody);
  body.position.set(0, 1.2, 0);
  group.add(body);
  const side = box(1.12, 2.4, 0.05, matSide, false, false);
  side.position.set(0, 1.2, -0.4);
  group.add(side);
  // lit product window
  const win = box(0.78, 1.6, 0.06, matGlass, false, false);
  win.position.set(-0.1, 1.55, 0.41);
  group.add(win);
  const winFrame = box(0.9, 1.74, 0.05, matDark, false, false);
  winFrame.position.set(-0.1, 1.55, 0.38);
  group.add(winFrame);
  // rows of products behind the glass
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    const p = box(0.16, 0.22, 0.1, prodMats[(r + c) % prodMats.length], false, false);
    p.position.set(-0.36 + c * 0.26, 1.0 + r * 0.36, 0.36);
    group.add(p);
  }
  // control column (buttons + coin slot)
  const col = box(0.22, 1.6, 0.06, matDark, false, false);
  col.position.set(0.42, 1.55, 0.41);
  group.add(col);
  for (let i = 0; i < 5; i++) {
    const b = box(0.05, 0.05, 0.04, i === 2 ? matCan : matSide, false, false);
    b.position.set(0.42, 1.95 - i * 0.16, 0.45);
    group.add(b);
  }
  // delivery tray opening at the bottom
  const slot = box(0.7, 0.34, 0.2, matDark, false, false);
  slot.position.set(-0.1, 0.42, 0.31);
  group.add(slot);
  // the can that drops (cached; falls + bounces in tick)
  const can = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12), matCan, true, false);
  can.visible = false;
  group.add(can);

  const SHELF_Y = 0.95, TRAY_Y = 0.36;
  function use(state, local) {
    if (local) local.facing = Math.PI;
    can.visible = true;
    can.position.set(-0.1, SHELF_Y, 0.34);
    can.rotation.set(0, 0, 0);
  }
  function tick(dt, state) {
    if (!state.active) return;
    state.t += dt;
    const D = 1.8;
    const t = state.t;
    if (t < 0.45) {
      // fall straight down out of the shelf
      const c = t / 0.45;
      can.position.y = SHELF_Y + (TRAY_Y - SHELF_Y) * (c * c);
      can.rotation.z = c * 1.6;
    } else if (t < D) {
      // settle in the tray with a damped bounce (the "clunk")
      const b = t - 0.45;
      can.position.y = TRAY_Y + Math.abs(Math.sin(b * 12)) * 0.12 * Math.max(0, 1 - b / (D - 0.45));
      can.rotation.z = 1.6 + Math.sin(b * 9) * 0.1 * Math.max(0, 1 - b);
    } else {
      state.active = false;
      can.position.y = TRAY_Y;
      can.visible = false;
    }
  }
  return { group, use, tick };
}

// 10) TELESCOPE — a sidewalk stargazer on a tripod. use() tips the tube UP for a
//     look at the sky while the front lens catches a glint.
function buildTelescope() {
  const group = new THREE.Group();
  const matMetal = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.4, metalness: 0.7 });
  const matTube = new THREE.MeshStandardMaterial({ color: "#1f5fa6", roughness: 0.45, metalness: 0.4 });
  const lensMat = new THREE.MeshStandardMaterial({ color: "#cfe9ff", roughness: 0.15, metalness: 0.6, emissive: "#7fb8e8", emissiveIntensity: 0.3 });
  // tripod legs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.5, 6), matMetal, true, false);
    leg.position.set(Math.sin(a) * 0.32, 0.72, Math.cos(a) * 0.32);
    leg.rotation.x = Math.cos(a) * 0.24;
    leg.rotation.z = -Math.sin(a) * 0.24;
    group.add(leg);
  }
  // mount head
  const head = mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 10), matMetal, true, false);
  head.position.set(0, 1.5, 0);
  group.add(head);
  // tilting tube assembly (rotates about its mount in X for elevation)
  const tubeGrp = new THREE.Group();
  tubeGrp.position.set(0, 1.55, 0);
  tubeGrp.rotation.x = -0.5; // resting elevation
  group.add(tubeGrp);
  const tube = mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.3, 14), matTube, true, false);
  tube.rotation.x = Math.PI / 2;        // lay the cylinder along local Z
  tube.position.set(0, 0, 0.2);
  tubeGrp.add(tube);
  // big objective lens at the front (+Z end)
  const lens = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 16), lensMat, false, false);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0, 0.85);
  tubeGrp.add(lens);
  // small eyepiece at the back (-Z end), where the player looks
  const eye = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10), matMetal, false, false);
  eye.rotation.x = Math.PI / 2;
  eye.position.set(0, 0, -0.5);
  tubeGrp.add(eye);

  const REST = -0.5, UP = -1.15;
  function use(state, local) {
    if (local) local.facing = 0; // look up/forward (+Z) with the scope
  }
  function tick(dt, state) {
    if (!state.active) {
      if (tubeGrp.rotation.x !== REST) tubeGrp.rotation.x += (REST - tubeGrp.rotation.x) * Math.min(1, dt * 4);
      lensMat.emissiveIntensity = 0.3;
      return;
    }
    state.t += dt;
    const D = 2.6;
    const p = state.t / D;
    // ease the tube up to the sky and back down
    const sweep = Math.sin(Math.min(1, p) * Math.PI);
    tubeGrp.rotation.x = REST + (UP - REST) * sweep;
    // lens glints a couple of times while aimed up
    lensMat.emissiveIntensity = 0.3 + Math.abs(Math.sin(state.t * 7)) * 1.1 * sweep;
    if (state.t >= D) {
      state.active = false;
      lensMat.emissiveIntensity = 0.3;
    }
  }
  return { group, use, tick };
}

// 11) TACO TRUCK — a little food truck with a serving window. use() fires up the
//     griddle: steam puffs rise off the plancha (like the hot-dog stand).
function buildTacoTruck() {
  const group = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: "#e0a32a", roughness: 0.5, metalness: 0.2 });
  const matCab = new THREE.MeshStandardMaterial({ color: "#c9871f", roughness: 0.5, metalness: 0.2 });
  const matDark = new THREE.MeshStandardMaterial({ color: "#15171b", roughness: 0.6 });
  const matWindow = new THREE.MeshStandardMaterial({ color: "#2a1d12", roughness: 0.4, emissive: "#3a2a16", emissiveIntensity: 0.25 });
  const matAwning = new THREE.MeshStandardMaterial({ color: "#3f8f5a", roughness: 0.7, side: THREE.DoubleSide });
  const matGrill = new THREE.MeshStandardMaterial({ color: "#4a4d52", roughness: 0.5, metalness: 0.6 });
  // box body + cab (truck runs along X)
  const bodyBox = box(2.6, 1.4, 1.5, matBody);
  bodyBox.position.set(0.2, 1.25, 0);
  group.add(bodyBox);
  const cab = box(1.0, 1.1, 1.5, matCab);
  cab.position.set(-1.7, 1.05, 0);
  group.add(cab);
  const windshield = box(0.06, 0.5, 1.3, matWindow, false, false);
  windshield.position.set(-2.18, 1.3, 0);
  group.add(windshield);
  // serving window cut into the +Z side
  const win = box(1.6, 0.7, 0.06, matWindow, false, false);
  win.position.set(0.2, 1.45, 0.76);
  group.add(win);
  const counter = box(1.8, 0.1, 0.3, matCab, false);
  counter.position.set(0.2, 1.08, 0.86);
  group.add(counter);
  // fold-up awning over the window
  const awning = box(2.0, 0.06, 0.7, matAwning, false, false);
  awning.position.set(0.2, 1.95, 1.0);
  awning.rotation.x = -0.5;
  group.add(awning);
  // rooftop taco sign
  const signPost = box(0.06, 0.5, 0.06, matDark, false, false);
  signPost.position.set(0.2, 2.25, 0);
  group.add(signPost);
  const sign = box(1.2, 0.5, 0.08, matAwning, false, false);
  sign.position.set(0.2, 2.6, 0);
  group.add(sign);
  // wheels
  for (const wx of [-1.5, 1.2]) {
    const w = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 14), matDark, true, false);
    w.rotation.x = Math.PI / 2;
    w.position.set(wx, 0.34, 0.72);
    group.add(w);
    const w2 = w.clone();
    w2.position.set(wx, 0.34, -0.72);
    group.add(w2);
  }
  // griddle on the counter where the steam rises
  const grill = box(0.6, 0.06, 0.24, matGrill, false, false);
  grill.position.set(0.5, 1.16, 0.86);
  group.add(grill);
  // steam puffs (reused; each with its own cloned opacity)
  const puffs = [];
  for (let i = 0; i < 4; i++) {
    const p = mesh(G.steamPuff, M.steam.clone(), false, false);
    p.visible = false;
    p.position.set(0.5, 1.3, 0.86);
    group.add(p);
    puffs.push({ mesh: p, born: -1, x0: 0, phase: 0 });
  }

  function use(state) {
    state.spawnAcc = 0;
    state.nextPuff = 0;
  }
  function tick(dt, state) {
    const cooking = state.active;
    const D = 1.8;
    if (cooking) {
      state.t += dt;
      state.spawnAcc = (state.spawnAcc || 0) + dt;
      if (state.spawnAcc > 0.34) {
        state.spawnAcc = 0;
        const slot = puffs[state.nextPuff % puffs.length];
        state.nextPuff++;
        slot.born = 0;
        slot.x0 = 0.3 + Math.random() * 0.4;
        slot.phase = Math.random() * Math.PI * 2;
        slot.mesh.visible = true;
        slot.mesh.position.set(slot.x0, 1.3, 0.86);
        slot.mesh.material.opacity = 0.5;
      }
      if (state.t >= D) state.active = false;
    }
    for (const slot of puffs) {
      if (slot.born < 0) continue;
      slot.born += dt;
      const life = 1.4;
      const p = slot.born / life;
      slot.mesh.position.y = 1.3 + p * 0.8;
      slot.mesh.position.x = slot.x0 + Math.sin(slot.phase + slot.born * 2) * 0.1;
      const s = 1 + p * 1.2;
      slot.mesh.scale.setScalar(s);
      slot.mesh.material.opacity = Math.max(0, 0.5 * (1 - p));
      if (slot.born >= life) { slot.born = -1; slot.mesh.visible = false; slot.mesh.scale.setScalar(1); }
    }
  }
  return { group, use, tick };
}

// 12) DJ BOOTH + DANCE FLOOR — a booth with spinning decks and a grid of light-up
//     floor tiles. use() drops the beat: the tiles chase through colour while the
//     turntables spin.
function buildDanceFloor() {
  const group = new THREE.Group();
  const matBooth = new THREE.MeshStandardMaterial({ color: "#1a1430", roughness: 0.6, metalness: 0.3 });
  const matDeck = new THREE.MeshStandardMaterial({ color: "#0f0a1c", roughness: 0.4, metalness: 0.5 });
  const matSpeaker = new THREE.MeshStandardMaterial({ color: "#15101f", roughness: 0.7 });
  const matCone = new THREE.MeshStandardMaterial({ color: "#2a2438", roughness: 0.6 });
  // dance-floor tiles (each its own material so colours pulse independently)
  const N = 5, sz = 0.78, gap = 0.06, span = N * (sz + gap);
  const tiles = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const mat = new THREE.MeshStandardMaterial({ color: "#101018", roughness: 0.5, emissive: "#101018", emissiveIntensity: 0.2 });
    const t = box(sz, 0.08, sz, mat, false, true);
    t.position.set(-span / 2 + sz / 2 + i * (sz + gap), 0.05, 1.6 - span / 2 + sz / 2 + j * (sz + gap));
    group.add(t);
    tiles.push({ mesh: t, mat, i, j });
  }
  // booth at the back (-Z)
  const booth = box(2.4, 1.1, 0.8, matBooth);
  booth.position.set(0, 0.55, -0.9);
  group.add(booth);
  const boothTop = box(2.5, 0.08, 0.9, matDeck, false);
  boothTop.position.set(0, 1.12, -0.9);
  group.add(boothTop);
  // two turntables that spin
  const decks = [];
  for (const dx of [-0.6, 0.6]) {
    const platter = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 20), matDeck, false, false);
    platter.position.set(dx, 1.18, -0.85);
    group.add(platter);
    const label = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16), matCone, false, false);
    label.position.set(dx, 1.2, -0.85);
    group.add(label);
    decks.push(platter);
  }
  // speaker stacks flanking the booth
  for (const sx of [-1.7, 1.7]) {
    const sp = box(0.6, 1.6, 0.6, matSpeaker);
    sp.position.set(sx, 0.8, -0.9);
    group.add(sp);
    for (const sy of [0.6, 1.2]) {
      const cone = mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.06, 14), matCone, false, false);
      cone.rotation.x = Math.PI / 2;
      cone.position.set(sx, sy, -0.6);
      group.add(cone);
    }
  }

  function use(state, local) {
    if (local) local.facing = Math.PI; // face the booth
    state.dimmed = false;
  }
  function tick(dt, state) {
    if (!state.active) {
      if (!state.dimmed) {
        for (const t of tiles) { t.mat.emissive.setHex(0x101018); t.mat.emissiveIntensity = 0.2; }
        state.dimmed = true;
      }
      return;
    }
    state.t += dt;
    const D = 4.2;
    // spin the decks
    decks[0].rotation.y += dt * 6;
    decks[1].rotation.y -= dt * 5;
    // a diagonal colour wave chasing across the floor
    for (const t of tiles) {
      const hue = ((t.i + t.j) * 0.11 + state.t * 0.6) % 1;
      t.mat.emissive.setHSL(hue, 0.9, 0.5);
      t.mat.emissiveIntensity = 0.5 + Math.sin((t.i + t.j) * 0.8 - state.t * 7) * 0.45 + 0.5;
    }
    if (state.t >= D) state.active = false;
  }
  return { group, use, tick };
}

// 13) STRENGTH TESTER — a carnival high-striker. use() swings the mallet and the
//     puck rockets up the tower; at the top the bell flashes and a score pops.
function buildStrengthTester() {
  const group = new THREE.Group();
  const matTower = new THREE.MeshStandardMaterial({ color: "#b5392f", roughness: 0.6 });
  const matRail = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.4, metalness: 0.8 });
  const matPad = new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.6, metalness: 0.4 });
  const matPuck = new THREE.MeshStandardMaterial({ color: "#ffd23f", roughness: 0.4, metalness: 0.4 });
  const matWood = new THREE.MeshStandardMaterial({ color: "#8a5a32", roughness: 0.8 });
  const bellMat = new THREE.MeshStandardMaterial({ color: "#e8c54a", roughness: 0.3, metalness: 0.8, emissive: "#5a4a10", emissiveIntensity: 0.3 });
  const scoreMat = new THREE.MeshBasicMaterial({ color: "#fff2a0", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const TOWER_H = 4.2;
  // tower column + side rails
  const tower = box(0.4, TOWER_H, 0.4, matTower);
  tower.position.set(0, TOWER_H / 2, 0);
  group.add(tower);
  for (const rx of [-0.26, 0.26]) {
    const rail = mesh(new THREE.CylinderGeometry(0.03, 0.03, TOWER_H, 6), matRail, false, false);
    rail.position.set(rx, TOWER_H / 2, 0.18);
    group.add(rail);
  }
  // base + strike pad
  const base = box(1.4, 0.3, 1.0, matPad);
  base.position.set(0, 0.15, 0.2);
  group.add(base);
  const pad = box(0.7, 0.12, 0.5, matTower, false);
  pad.position.set(0, 0.36, 0.55);
  group.add(pad);
  // bell at the top
  const bell = mesh(new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), bellMat, true, false);
  bell.rotation.x = Math.PI;
  bell.position.set(0, TOWER_H + 0.1, 0);
  group.add(bell);
  // the puck that rides the rails (between the rails, on +Z face)
  const puck = box(0.5, 0.18, 0.16, matPuck, true, false);
  puck.position.set(0, 0.45, 0.2);
  group.add(puck);
  // "score!" plate that pops near the bell
  const score = mesh(new THREE.PlaneGeometry(0.7, 0.32), scoreMat, false, false);
  score.position.set(0, TOWER_H - 0.2, 0.3);
  group.add(score);
  // a mallet leaning on the base that swings on use
  const malletGrp = new THREE.Group();
  malletGrp.position.set(0.6, 0.36, 0.55);
  group.add(malletGrp);
  const handle = box(0.07, 1.2, 0.07, matWood, true, false);
  handle.position.set(0, 0.6, 0);
  malletGrp.add(handle);
  const headM = box(0.34, 0.26, 0.26, matPad, true, false);
  headM.position.set(0, 1.2, 0);
  malletGrp.add(headM);
  malletGrp.rotation.z = -0.5; // resting upright-ish

  const PUCK_LOW = 0.45, PUCK_HIGH = TOWER_H - 0.35;
  function use() {
    puck.position.y = PUCK_LOW;
    score.scale.setScalar(0.2);
    scoreMat.opacity = 0;
  }
  function tick(dt, state) {
    if (!state.active) {
      if (malletGrp.rotation.z !== -0.5) malletGrp.rotation.z += (-0.5 - malletGrp.rotation.z) * Math.min(1, dt * 6);
      bellMat.emissiveIntensity = 0.3;
      return;
    }
    state.t += dt;
    const D = 2.0;
    const t = state.t;
    if (t < 0.18) {
      // mallet swings down onto the pad
      malletGrp.rotation.z = -0.5 + (t / 0.18) * 1.4;
    } else if (t < 0.72) {
      // puck rockets up (ease-out)
      malletGrp.rotation.z = 0.9;
      const c = (t - 0.18) / 0.54;
      const e = 1 - (1 - c) * (1 - c);
      puck.position.y = PUCK_LOW + (PUCK_HIGH - PUCK_LOW) * e;
    } else if (t < 1.1) {
      // bell DING + score pops
      puck.position.y = PUCK_HIGH;
      malletGrp.rotation.z = 0.9 - (t - 0.72) / 0.38 * 1.4;
      bellMat.emissiveIntensity = 0.3 + Math.abs(Math.sin(t * 26)) * 2.2;
      const c = (t - 0.72) / 0.38;
      score.scale.setScalar(0.2 + c * 1.0);
      score.position.y = (TOWER_H - 0.2) + c * 0.4;
      scoreMat.opacity = Math.max(0, 1 - c);
    } else if (t < D) {
      // puck drops back to the pad
      const c = (t - 1.1) / (D - 1.1);
      puck.position.y = PUCK_HIGH + (PUCK_LOW - PUCK_HIGH) * (c * c);
      bellMat.emissiveIntensity = 0.3;
      scoreMat.opacity = 0;
    } else {
      state.active = false;
      puck.position.y = PUCK_LOW;
      malletGrp.rotation.z = -0.5;
      bellMat.emissiveIntensity = 0.3;
      scoreMat.opacity = 0;
    }
  }
  return { group, use, tick };
}

// 14) BUBBLE MACHINE — a wind-up bubbler on legs. use() sends a stream of soapy
//     bubbles drifting up before they wobble and pop.
function buildBubbleMachine() {
  const group = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: "#3f8fcf", roughness: 0.5, metalness: 0.2 });
  const matTrim = new THREE.MeshStandardMaterial({ color: "#ffd23f", roughness: 0.4 });
  const matLeg = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.6 });
  // body box on three legs
  const body = box(0.7, 0.5, 0.5, matBody);
  body.position.set(0, 0.95, 0);
  group.add(body);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const leg = mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.9, 6), matLeg, true, false);
    leg.position.set(Math.sin(a) * 0.22, 0.45, Math.cos(a) * 0.22);
    leg.rotation.x = Math.cos(a) * 0.16;
    leg.rotation.z = -Math.sin(a) * 0.16;
    group.add(leg);
  }
  // a wand ring on top where bubbles form
  const ring = mesh(new THREE.TorusGeometry(0.14, 0.02, 8, 18), matTrim, false, false);
  ring.position.set(0, 1.3, 0.1);
  group.add(ring);
  const spout = box(0.12, 0.16, 0.12, matTrim, false, false);
  spout.position.set(0, 1.2, 0.1);
  group.add(spout);
  // a wind-up crank on the side (decor)
  const crank = mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12), matLeg, false, false);
  crank.position.set(0.4, 0.95, 0);
  crank.rotation.y = Math.PI / 2;
  group.add(crank);
  // bubble pool (each its own translucent material for independent opacity)
  const bubbles = [];
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: "#cfeeff", roughness: 0.05, metalness: 0.1, emissive: "#6fb8e8", emissiveIntensity: 0.25, transparent: true, opacity: 0, depthWrite: false });
    const b = mesh(G.steamPuff, mat, false, false);
    b.visible = false;
    b.position.set(0, 1.3, 0.1);
    group.add(b);
    bubbles.push({ mesh: b, mat, born: -1, x0: 0, drift: 0, phase: 0, rise: 1 });
  }

  function use(state) {
    state.spawnAcc = 0;
    state.nextB = 0;
  }
  function tick(dt, state) {
    const blowing = state.active;
    const D = 2.6;
    if (blowing) {
      state.t += dt;
      state.spawnAcc = (state.spawnAcc || 0) + dt;
      if (state.spawnAcc > 0.22) {
        state.spawnAcc = 0;
        const slot = bubbles[state.nextB % bubbles.length];
        state.nextB++;
        slot.born = 0;
        slot.x0 = (Math.random() - 0.5) * 0.1;
        slot.drift = (Math.random() - 0.5) * 0.5;
        slot.phase = Math.random() * Math.PI * 2;
        slot.rise = 0.9 + Math.random() * 0.7;
        slot.mesh.visible = true;
        slot.mesh.position.set(slot.x0, 1.3, 0.1);
        slot.mesh.scale.setScalar(0.6 + Math.random() * 0.7);
        slot.mat.opacity = 0.5;
      }
      if (state.t >= D) state.active = false;
    }
    for (const slot of bubbles) {
      if (slot.born < 0) continue;
      slot.born += dt;
      const life = 2.2;
      const p = slot.born / life;
      slot.mesh.position.y = 1.3 + p * slot.rise * 1.8;
      slot.mesh.position.x = slot.x0 + slot.drift * p + Math.sin(slot.phase + slot.born * 3) * 0.12;
      slot.mesh.position.z = 0.1 + Math.cos(slot.phase + slot.born * 2.5) * 0.12;
      // fade in fast, hold, then pop (quick fade) at the end
      slot.mat.opacity = p > 0.85 ? Math.max(0, 0.5 * (1 - (p - 0.85) / 0.15)) : 0.5;
      if (slot.born >= life) { slot.born = -1; slot.mesh.visible = false; slot.mesh.scale.setScalar(1); }
    }
  }
  return { group, use, tick };
}

// 15) JUKEBOX — a classic glowing jukebox. use() lights chase around the arch and
//     music notes float up out of the grille.
function buildJukebox() {
  const group = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: "#7a2d52", roughness: 0.45, metalness: 0.2 });
  const matWood = new THREE.MeshStandardMaterial({ color: "#5f3d22", roughness: 0.7 });
  const matGrille = new THREE.MeshStandardMaterial({ color: "#1a1014", roughness: 0.6 });
  const matPanel = new THREE.MeshStandardMaterial({ color: "#1a2a3a", roughness: 0.3, emissive: "#1f6f8c", emissiveIntensity: 0.5 });
  // body + domed top
  const body = box(1.4, 1.4, 0.7, matBody);
  body.position.set(0, 0.85, 0);
  group.add(body);
  const dome = mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.7, 18, 1, false, 0, Math.PI), matBody, true, false);
  dome.rotation.z = Math.PI / 2;
  dome.position.set(0, 1.55, 0);
  group.add(dome);
  const domeFront = mesh(new THREE.CircleGeometry(0.7, 18, 0, Math.PI), matPanel, false, false);
  domeFront.position.set(0, 1.55, 0.36);
  group.add(domeFront);
  // selection panel + grille on the front
  const panel = box(1.0, 0.5, 0.06, matPanel, false, false);
  panel.position.set(0, 1.05, 0.36);
  group.add(panel);
  const grille = box(1.0, 0.5, 0.06, matGrille, false, false);
  grille.position.set(0, 0.5, 0.36);
  group.add(grille);
  for (let i = 0; i < 4; i++) {
    const bar = box(0.9, 0.03, 0.04, matWood, false, false);
    bar.position.set(0, 0.34 + i * 0.11, 0.4);
    group.add(bar);
  }
  // arch of chase lights tracing the dome (each its own material to chase)
  const archLights = [];
  const AN = 9;
  for (let i = 0; i < AN; i++) {
    const a = (i / (AN - 1)) * Math.PI;
    const mat = new THREE.MeshStandardMaterial({ color: "#ff7a3a", roughness: 0.4, emissive: "#ff5a1a", emissiveIntensity: 0.4 });
    const dot = mesh(new THREE.SphereGeometry(0.05, 8, 6), mat, false, false);
    dot.position.set(Math.cos(a) * 0.62, 1.55 + Math.sin(a) * 0.62, 0.4);
    group.add(dot);
    archLights.push(mat);
  }
  // floating music notes (reuse the shared note quad geo; cloned for own opacity)
  const notes = [];
  for (let i = 0; i < 5; i++) {
    const n = mesh(G.noteFlat, M.note.clone(), false, false);
    n.visible = false;
    n.position.set(0, 1.0, 0.4);
    group.add(n);
    notes.push({ mesh: n, x0: 0, phase: 0, born: -1 });
  }

  function use(state, local) {
    if (local) local.facing = Math.PI;
    state.spawnAcc = 0;
    state.nextNote = 0;
    state.dimmed = false;
  }
  function tick(dt, state) {
    const playing = state.active;
    const D = 3.2;
    if (playing) {
      state.t += dt;
      // chase the arch lights
      const lit = Math.floor(state.t * 10) % archLights.length;
      for (let i = 0; i < archLights.length; i++) {
        archLights[i].emissiveIntensity = i === lit || i === (lit + archLights.length - 1) % archLights.length ? 1.6 : 0.4;
      }
      // spawn notes
      state.spawnAcc = (state.spawnAcc || 0) + dt;
      if (state.spawnAcc > 0.4) {
        state.spawnAcc = 0;
        const slot = notes[state.nextNote % notes.length];
        state.nextNote++;
        slot.born = 0;
        slot.x0 = -0.4 + Math.random() * 0.8;
        slot.phase = Math.random() * Math.PI * 2;
        slot.mesh.visible = true;
        slot.mesh.position.set(slot.x0, 1.2, 0.4);
        slot.mesh.material.opacity = 0.9;
      }
      if (state.t >= D) state.active = false;
      state.dimmed = false;
    } else if (!state.dimmed) {
      for (const m of archLights) m.emissiveIntensity = 0.4;
      state.dimmed = true;
    }
    // advance live notes regardless so the last few finish rising
    for (const slot of notes) {
      if (slot.born < 0) continue;
      slot.born += dt;
      const life = 1.6;
      const p = slot.born / life;
      slot.mesh.position.y = 1.2 + p * 1.2;
      slot.mesh.position.x = slot.x0 + Math.sin(slot.phase + slot.born * 3) * 0.18;
      slot.mesh.rotation.z = Math.sin(slot.phase + slot.born * 2) * 0.3;
      slot.mesh.material.opacity = Math.max(0, 0.9 * (1 - p));
      if (slot.born >= life) { slot.born = -1; slot.mesh.visible = false; }
    }
  }
  return { group, use, tick };
}

// 16) PIGEON FEEDING SPOT — a feed bowl ringed by resting pigeons. use() scatters
//     a handful of seed: the flock startles up, flutters outward, then settles.
function buildPigeons() {
  const group = new THREE.Group();
  const matPost = new THREE.MeshStandardMaterial({ color: "#9a9384", roughness: 0.9 });
  const matBowl = new THREE.MeshStandardMaterial({ color: "#7c7468", roughness: 0.95 });
  const matSeed = new THREE.MeshStandardMaterial({ color: "#cdb27a", roughness: 0.9 });
  const matBird = new THREE.MeshStandardMaterial({ color: "#8a9099", roughness: 0.8 });
  const matBirdDk = new THREE.MeshStandardMaterial({ color: "#5a6068", roughness: 0.8 });
  const matBeak = new THREE.MeshStandardMaterial({ color: "#e0a32a", roughness: 0.6 });
  // pedestal + feed bowl
  const post = mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.7, 10), matPost, true, false);
  post.position.set(0, 0.35, 0);
  group.add(post);
  const bowl = mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.16, 16), matBowl, true, false);
  bowl.position.set(0, 0.78, 0);
  group.add(bowl);
  const seedPile = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14), matSeed, false, true);
  seedPile.position.set(0, 0.87, 0);
  group.add(seedPile);
  // scattered seed specks on the ground
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.7 + Math.random() * 1.0;
    const sp = mesh(new THREE.SphereGeometry(0.03, 5, 4), matSeed, false, true);
    sp.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r);
    group.add(sp);
  }
  // flock of pigeons resting on the ground around the bowl
  const birds = [];
  const BN = 6;
  for (let i = 0; i < BN; i++) {
    const a = (i / BN) * Math.PI * 2 + 0.3;
    const r = 1.0 + (i % 2) * 0.5;
    const hx = Math.cos(a) * r, hz = Math.sin(a) * r;
    const bg = new THREE.Group();
    bg.position.set(hx, 0.16, hz);
    bg.rotation.y = a + Math.PI; // face the bowl
    const bodyB = mesh(new THREE.SphereGeometry(0.13, 8, 6), i % 2 ? matBird : matBirdDk, true, false);
    bodyB.scale.set(1, 0.85, 1.4);
    bg.add(bodyB);
    const head = mesh(new THREE.SphereGeometry(0.08, 8, 6), i % 2 ? matBird : matBirdDk, true, false);
    head.position.set(0, 0.12, 0.16);
    bg.add(head);
    const beak = mesh(new THREE.ConeGeometry(0.03, 0.09, 6), matBeak, false, false);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.12, 0.26);
    bg.add(beak);
    const tail = box(0.1, 0.03, 0.16, i % 2 ? matBird : matBirdDk, false, false);
    tail.position.set(0, 0.02, -0.2);
    bg.add(tail);
    const wingL = box(0.04, 0.1, 0.22, matBirdDk, false, false);
    wingL.position.set(-0.12, 0.04, 0);
    bg.add(wingL);
    const wingR = box(0.04, 0.1, 0.22, matBirdDk, false, false);
    wingR.position.set(0.12, 0.04, 0);
    bg.add(wingR);
    group.add(bg);
    birds.push({ grp: bg, wingL, wingR, hx, hz, hy: 0.16, baseRot: a + Math.PI, dir: a, phase: i * 0.7 });
  }

  function use() { /* the scatter is driven entirely from tick via state.t */ }
  function tick(dt, state) {
    if (!state.active) {
      // gentle idle pecking bob
      state.idle = (state.idle || 0) + dt;
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        b.grp.position.y = b.hy + Math.max(0, Math.sin(state.idle * 2 + b.phase)) * 0.015;
        b.wingL.rotation.z = 0.1; b.wingR.rotation.z = -0.1;
      }
      return;
    }
    state.t += dt;
    const D = 2.8;
    const t = state.t;
    for (const b of birds) {
      let lift, out, flap;
      if (t < 1.2) {
        // startle: rise + scatter outward, fast flapping
        const c = t / 1.2;
        lift = Math.sin(c * Math.PI * 0.5) * 1.4;
        out = c * 1.1;
        flap = Math.sin(t * 22 + b.phase) * 0.9;
      } else if (t < D) {
        // glide back down to the home perch, slowing flaps
        const c = (t - 1.2) / (D - 1.2);
        lift = Math.cos(c * Math.PI * 0.5) * 1.4;
        out = (1 - c) * 1.1;
        flap = Math.sin(t * 14 + b.phase) * 0.5 * (1 - c);
      } else {
        lift = 0; out = 0; flap = 0;
      }
      b.grp.position.x = b.hx + Math.cos(b.dir) * out;
      b.grp.position.z = b.hz + Math.sin(b.dir) * out;
      b.grp.position.y = b.hy + lift;
      b.grp.rotation.y = b.baseRot + (lift > 0.05 ? Math.PI : 0); // turn to face out when flying
      b.wingL.rotation.z = 0.1 + Math.abs(flap);
      b.wingR.rotation.z = -0.1 - Math.abs(flap);
    }
    if (state.t >= D) {
      state.active = false;
      for (const b of birds) {
        b.grp.position.set(b.hx, b.hy, b.hz);
        b.grp.rotation.y = b.baseRot;
        b.wingL.rotation.z = 0.1; b.wingR.rotation.z = -0.1;
      }
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
  // Arcade cabinet → arcade tile (ox:90, oz:65): local (0,10), on the open plaza
  // band beside the central avenue, clear of the cabinet rows + ticket booths.
  {
    id: "arcade", label: "🕹️",
    x: 90, z: 75, range: 2.4, build: buildArcadeCabinet,
    hintText: "🕹️ Press E to play",
    useText: "🕹️ INSERT COIN — new high score!",
  },
  // Claw machine → shopping tile (ox:30, oz:125): local (12,0), in the wide-open
  // central court (clear ~9 m of any storefront).
  {
    id: "claw", label: "🧸",
    x: 42, z: 125, range: 2.4, build: buildClaw,
    hintText: "🧸 Press E for the claw",
    useText: "🧸 The claw descends… got one!",
  },
  // Vending machine → offices tile (ox:30, oz:185): local (0,8), office-plaza
  // break spot off the lobby fronts.
  {
    id: "vending", label: "🥤",
    x: 30, z: 193, range: 2.2, build: buildVending,
    hintText: "🥤 Press E for a drink",
    useText: "🥤 *clunk* — ice-cold can!",
  },
  // Telescope → pier tile (ox:-90, oz:245): local (10,6), on the boardwalk apron
  // facing the open water/sky.
  {
    id: "telescope", label: "🔭",
    x: -80, z: 251, range: 2.4, build: buildTelescope,
    hintText: "🔭 Press E to stargaze",
    useText: "🔭 Tipping up for a look at the stars…",
  },
  // Taco truck → market tile (ox:30, oz:65): local (-18,0), parked on the market's
  // west open lane opposite the connector hot-dog stand.
  {
    id: "taco", label: "🌮",
    x: 12, z: 65, range: 2.6, build: buildTacoTruck,
    hintText: "🌮 Press E for tacos",
    useText: "🌮 Two tacos al pastor — sizzling!",
  },
  // DJ booth + dance floor → nightlife tile (ox:90, oz:245): local (-6,0), on the
  // open club forecourt beside the central lane.
  {
    id: "dancefloor", label: "🪩",
    x: 84, z: 245, range: 3.0, build: buildDanceFloor,
    hintText: "🪩 Press E to drop the beat",
    useText: "🪩 Lights up — the floor is alive!",
  },
  // Strength tester → stadium tile (ox:90, oz:185): local (10,0), on the open
  // concourse clear of the stands.
  {
    id: "striker", label: "💪",
    x: 100, z: 185, range: 2.6, build: buildStrengthTester,
    hintText: "💪 Press E to test your strength",
    useText: "💪 *DING!* Ring the bell — you're strong!",
  },
  // Bubble machine → park tile (ox:-90, oz:185): local (10,20), open SE lawn well
  // clear of the pond, gazebo and the basketball hoop.
  {
    id: "bubbles", label: "🫧",
    x: -80, z: 205, range: 2.4, build: buildBubbleMachine,
    hintText: "🫧 Press E for bubbles",
    useText: "🫧 Bubbles drifting up… pop!",
  },
  // Jukebox → arts tile (ox:90, oz:125): local (0,14), on the open arts plaza
  // beside the central lane.
  {
    id: "jukebox", label: "🎵",
    x: 90, z: 139, range: 2.4, build: buildJukebox,
    hintText: "🎵 Press E to pick a track",
    useText: "🎵 Lights chase — your song is playing!",
  },
  // Pigeon feeding spot → transit tile (ox:-30, oz:185): local (-12,-2), on the
  // open station forecourt clear of the kiosks.
  {
    id: "pigeons", label: "🐦",
    x: -42, z: 183, range: 2.6, build: buildPigeons,
    hintText: "🐦 Press E to feed the pigeons",
    useText: "🐦 You toss the seed — the flock takes off!",
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
