// Silly little things you can buy at the coffee bar. They cost "fake money" —
// there's no balance to check, buying always succeeds. Each item builds a small
// THREE.Object3D centered near the origin, sized to sit in a character's hand
// (and to look fine dropped on the floor). You can only hold one at a time.

import * as THREE from "three";

function mesh(geo, color, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0, flatShading: !!opts.flat });
  if (opts.opacity != null) { mat.transparent = true; mat.opacity = opts.opacity; }
  if (opts.emissive) { mat.emissive = new THREE.Color(opts.emissive); mat.emissiveIntensity = opts.emissiveIntensity ?? 1; }
  if (opts.side) mat.side = opts.side;
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function rubberDuck() {
  const g = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.1, 14, 12), "#f4c430");
  body.scale.set(1, 0.85, 1.2);
  const head = mesh(new THREE.SphereGeometry(0.07, 14, 12), "#f4c430");
  head.position.set(0, 0.12, 0.06);
  const beak = mesh(new THREE.ConeGeometry(0.035, 0.06, 8), "#e8862e");
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.12, 0.14);
  const eye = mesh(new THREE.SphereGeometry(0.014, 8, 8), "#1a1a1a");
  eye.position.set(0.03, 0.14, 0.11);
  const eye2 = eye.clone(); eye2.position.x = -0.03;
  g.add(body, head, beak, eye, eye2);
  return g;
}

function donut() {
  const g = new THREE.Group();
  const ring = mesh(new THREE.TorusGeometry(0.09, 0.045, 12, 20), "#8a5a3a");
  const frost = mesh(new THREE.TorusGeometry(0.09, 0.05, 12, 20), "#ef6fa6");
  frost.scale.set(1, 1, 0.55); frost.position.z = 0.02;
  for (let i = 0; i < 8; i++) {
    const s = mesh(new THREE.BoxGeometry(0.018, 0.008, 0.008), ["#ffe066", "#7ad1ff", "#fff"][i % 3]);
    const a = (i / 8) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.05);
    s.rotation.z = a;
    g.add(s);
  }
  g.add(ring, frost);
  g.rotation.x = Math.PI / 2.4;
  return g;
}

function petRock() {
  const g = new THREE.Group();
  const rock = mesh(new THREE.IcosahedronGeometry(0.1, 0), "#8d8a86", { flat: true, rough: 0.95 });
  rock.scale.set(1.2, 0.85, 1);
  const wEye = mesh(new THREE.SphereGeometry(0.03, 10, 10), "#ffffff");
  wEye.position.set(0.04, 0.05, 0.09);
  const wEye2 = wEye.clone(); wEye2.position.x = -0.04;
  const pupil = mesh(new THREE.SphereGeometry(0.014, 8, 8), "#111");
  pupil.position.set(0.045, 0.05, 0.115);
  const pupil2 = pupil.clone(); pupil2.position.x = -0.035;
  g.add(rock, wEye, wEye2, pupil, pupil2);
  return g;
}

function cactus() {
  const g = new THREE.Group();
  const pot = mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.07, 12), "#c8743f");
  pot.position.y = -0.06;
  const rim = mesh(new THREE.CylinderGeometry(0.064, 0.06, 0.018, 12), "#d4824c");
  rim.position.y = -0.03;
  const soil = mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.01, 12), "#3a2a1a");
  soil.position.y = -0.025;
  const body = mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 10), "#4f9d5a", { flat: true });
  body.position.y = 0.05;
  const arm = mesh(new THREE.CapsuleGeometry(0.018, 0.05, 4, 8), "#4f9d5a", { flat: true });
  arm.position.set(0.05, 0.06, 0); arm.rotation.z = -0.8;
  const arm2 = mesh(new THREE.CapsuleGeometry(0.016, 0.04, 4, 8), "#4f9d5a", { flat: true });
  arm2.position.set(-0.045, 0.09, 0); arm2.rotation.z = 0.9;
  const flower = mesh(new THREE.SphereGeometry(0.02, 8, 8), "#ff7eb6");
  flower.position.set(0, 0.13, 0); flower.scale.set(1, 0.6, 1);
  g.add(pot, rim, soil, body, arm, arm2, flower);
  return g;
}

function bobaTea() {
  const g = new THREE.Group();
  const cup = mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.16, 16), "#dcecf4", { opacity: 0.45 });
  const tea = mesh(new THREE.CylinderGeometry(0.055, 0.044, 0.1, 16), "#c89b6a", { opacity: 0.85 });
  tea.position.y = -0.03;
  for (let i = 0; i < 6; i++) {
    const b = mesh(new THREE.SphereGeometry(0.014, 8, 8), "#2a1c14");
    b.position.set((Math.random() - 0.5) * 0.07, -0.07 + Math.random() * 0.015, (Math.random() - 0.5) * 0.07);
    g.add(b);
  }
  const lid = mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.012, 16), "#f2f2f2");
  lid.position.y = 0.085;
  const straw = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), "#e0556f");
  straw.position.set(0.015, 0.08, 0); straw.rotation.z = 0.18;
  g.add(cup, tea, lid, straw);
  return g;
}

function balloon() {
  const g = new THREE.Group();
  const b = mesh(new THREE.SphereGeometry(0.1, 16, 14), "#e0473a");
  b.scale.set(1, 1.18, 1); b.position.y = 0.06;
  const knot = mesh(new THREE.ConeGeometry(0.02, 0.03, 6), "#e0473a");
  knot.position.y = -0.05; knot.rotation.x = Math.PI;
  const string = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.22, 5), "#cccccc");
  string.position.y = -0.16;
  g.add(b, knot, string);
  return g;
}

// --- New charming hand-held treats & trinkets -------------------------------

function croissant() {
  const g = new THREE.Group();
  // A crescent built from a row of overlapping golden bumps that taper at the ends.
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);            // 0..1 along the crescent
    const a = (t - 0.5) * 2.0;        // sweep angle
    const taper = 1 - Math.abs(t - 0.5) * 1.1; // fatter in the middle
    const r = 0.05 * Math.max(0.35, taper);
    const seg = mesh(new THREE.SphereGeometry(r, 10, 8), "#d39a4e", { flat: true, rough: 0.7 });
    seg.position.set(Math.sin(a) * 0.11, Math.cos(a) * 0.05 - 0.02, 0);
    seg.scale.set(1.15, 0.8, 0.95);
    g.add(seg);
  }
  // a couple of toasted highlights
  const sheen = mesh(new THREE.SphereGeometry(0.03, 8, 6), "#e8bd78", { flat: true });
  sheen.position.set(0, 0.03, 0.03); sheen.scale.set(1.6, 0.5, 0.5);
  g.add(sheen);
  return g;
}

function cookie() {
  const g = new THREE.Group();
  const disc = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.028, 18), "#c8924e", { flat: true, rough: 0.85 });
  // chocolate chips dotted across the top
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39996; // golden-angle spread
    const rad = 0.018 + (i / 7) * 0.07;
    const chip = mesh(new THREE.SphereGeometry(0.013, 8, 6), "#4a2c18", { flat: true });
    chip.position.set(Math.cos(a) * rad, 0.018, Math.sin(a) * rad);
    chip.scale.set(1, 0.7, 1);
    g.add(chip);
  }
  g.add(disc);
  return g;
}

function coffeeCup() {
  const g = new THREE.Group();
  const cup = mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 18), "#f4f1ec", { rough: 0.4 });
  const sleeve = mesh(new THREE.CylinderGeometry(0.062, 0.054, 0.045, 18), "#b5703a", { rough: 0.85 });
  sleeve.position.y = -0.01;
  const lid = mesh(new THREE.CylinderGeometry(0.064, 0.062, 0.018, 18), "#3a3a3a");
  lid.position.y = 0.07;
  const dome = mesh(new THREE.SphereGeometry(0.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), "#3a3a3a");
  dome.position.y = 0.078; dome.scale.set(1, 0.4, 1);
  const sip = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), "#222");
  sip.position.set(0, 0.092, 0.03);
  // wisps of steam rising off the lid
  const steamMat = { opacity: 0.5, emissive: "#ffffff", emissiveIntensity: 0.15 };
  for (let i = 0; i < 3; i++) {
    const puff = mesh(new THREE.SphereGeometry(0.02 - i * 0.003, 8, 6), "#ffffff", steamMat);
    puff.castShadow = false;
    puff.position.set((i - 1) * 0.018, 0.12 + i * 0.035, 0);
    g.add(puff);
  }
  g.add(cup, sleeve, lid, dome, sip);
  return g;
}

function muffin() {
  const g = new THREE.Group();
  // fluted paper wrapper
  const wrap = mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.08, 14), "#d9b25a", { rough: 0.8 });
  wrap.position.y = -0.04;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const pleat = mesh(new THREE.BoxGeometry(0.006, 0.075, 0.012), "#caa24c");
    pleat.position.set(Math.cos(a) * 0.058, -0.04, Math.sin(a) * 0.058);
    pleat.rotation.y = -a;
    g.add(pleat);
  }
  // domed muffin top, overhanging the wrapper
  const top = mesh(new THREE.SphereGeometry(0.075, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.7), "#7a4a2c", { flat: true, rough: 0.8 });
  top.position.y = 0.0; top.scale.set(1, 0.85, 1);
  // blueberries peeking out
  for (let i = 0; i < 5; i++) {
    const a = i * 1.6;
    const berry = mesh(new THREE.SphereGeometry(0.012, 8, 6), "#5566cc");
    berry.position.set(Math.cos(a) * 0.04, 0.035 + Math.sin(i) * 0.01, Math.sin(a) * 0.04);
    g.add(berry);
  }
  g.add(wrap, top);
  return g;
}

function iceCream() {
  const g = new THREE.Group();
  // waffle cone
  const cone = mesh(new THREE.ConeGeometry(0.045, 0.16, 14), "#d8a23f", { flat: true, rough: 0.85 });
  cone.rotation.x = Math.PI; cone.position.y = -0.02;
  // two stacked scoops
  const scoop1 = mesh(new THREE.SphereGeometry(0.05, 14, 12), "#f7e0c0", { flat: true });
  scoop1.position.y = 0.075;
  const scoop2 = mesh(new THREE.SphereGeometry(0.042, 14, 12), "#f5a3c0", { flat: true });
  scoop2.position.y = 0.13;
  // a cherry on top
  const cherry = mesh(new THREE.SphereGeometry(0.016, 10, 8), "#cc2233");
  cherry.position.y = 0.175;
  const stem = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 5), "#4a6b2a");
  stem.position.set(0.005, 0.195, 0); stem.rotation.z = 0.25;
  g.add(cone, scoop1, scoop2, cherry, stem);
  return g;
}

function tinyPlant() {
  const g = new THREE.Group();
  const pot = mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.06, 12), "#e0e0e0", { rough: 0.5 });
  pot.position.y = -0.06;
  const rim = mesh(new THREE.CylinderGeometry(0.05, 0.046, 0.014, 12), "#f0f0f0");
  rim.position.y = -0.034;
  const soil = mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.01, 12), "#3a2a1a");
  soil.position.y = -0.03;
  // a few heart-leaf sprigs splaying out of the pot
  const leafColors = ["#5aa84c", "#6cbf58", "#4f9d44"];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const lean = 0.5 + (i % 2) * 0.2;
    const stem = mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.09, 6), "#4a7a3a");
    stem.position.set(Math.cos(a) * 0.012, 0.005, Math.sin(a) * 0.012);
    stem.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
    const leaf = mesh(new THREE.SphereGeometry(0.028, 10, 8), leafColors[i % 3], { flat: true });
    leaf.scale.set(1, 0.35, 1.3);
    leaf.position.set(Math.cos(a) * 0.05, 0.05, Math.sin(a) * 0.05);
    leaf.rotation.y = -a;
    g.add(stem, leaf);
  }
  g.add(pot, rim, soil);
  return g;
}

function sandwich() {
  const g = new THREE.Group();
  const breadGeo = new THREE.BoxGeometry(0.16, 0.025, 0.13);
  const bottom = mesh(breadGeo, "#e3b878", { flat: true, rough: 0.85 });
  bottom.position.y = -0.045;
  const top = mesh(breadGeo, "#d9a85f", { flat: true, rough: 0.85 });
  top.position.y = 0.045;
  // a leaf of lettuce frilling out the sides
  const lettuce = mesh(new THREE.BoxGeometry(0.18, 0.012, 0.15), "#6fb04a", { flat: true });
  lettuce.position.y = 0.018; lettuce.rotation.z = 0.04;
  // tomato slice
  const tomato = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 12), "#d8412f");
  tomato.position.set(0.01, 0.005, 0);
  // cheese square, rotated for a poking corner
  const cheese = mesh(new THREE.BoxGeometry(0.15, 0.01, 0.13), "#f2c14e", { flat: true });
  cheese.position.y = -0.012; cheese.rotation.y = 0.18;
  g.add(bottom, cheese, tomato, lettuce, top);
  return g;
}

function teddy() {
  const g = new THREE.Group();
  const fur = "#b07d4e";
  const body = mesh(new THREE.SphereGeometry(0.07, 14, 12), fur, { flat: true, rough: 0.9 });
  body.scale.set(1, 1.1, 0.9); body.position.y = -0.02;
  const tummy = mesh(new THREE.SphereGeometry(0.045, 12, 10), "#d8b487", { flat: true });
  tummy.position.set(0, -0.025, 0.045); tummy.scale.set(1, 1.1, 0.5);
  const head = mesh(new THREE.SphereGeometry(0.055, 14, 12), fur, { flat: true, rough: 0.9 });
  head.position.y = 0.08;
  const snout = mesh(new THREE.SphereGeometry(0.025, 10, 8), "#d8b487", { flat: true });
  snout.position.set(0, 0.07, 0.05); snout.scale.set(1, 0.8, 0.8);
  const nose = mesh(new THREE.SphereGeometry(0.01, 8, 6), "#3a2a1a");
  nose.position.set(0, 0.075, 0.072);
  // ears
  const ear = mesh(new THREE.SphereGeometry(0.022, 10, 8), fur, { flat: true });
  ear.position.set(0.035, 0.115, 0); ear.scale.set(1, 1, 0.6);
  const ear2 = ear.clone(); ear2.position.x = -0.035;
  // eyes
  const eye = mesh(new THREE.SphereGeometry(0.008, 8, 6), "#1a1a1a");
  eye.position.set(0.02, 0.09, 0.046);
  const eye2 = eye.clone(); eye2.position.x = -0.02;
  // stubby arms & legs
  const limbGeo = new THREE.SphereGeometry(0.03, 10, 8);
  const armL = mesh(limbGeo, fur, { flat: true }); armL.position.set(0.07, -0.01, 0.01); armL.scale.set(0.8, 1, 0.8);
  const armR = armL.clone(); armR.position.x = -0.07;
  const legL = mesh(limbGeo, fur, { flat: true }); legL.position.set(0.04, -0.09, 0.01);
  const legR = legL.clone(); legR.position.x = -0.04;
  g.add(body, tummy, head, snout, nose, ear, ear2, eye, eye2, armL, armR, legL, legR);
  return g;
}

// --- More snacks & toys ------------------------------------------------------

function pizza() {
  const g = new THREE.Group();
  // a single wedge slice (apex at origin, crust on the +Z arc)
  const slice = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.016, 1, 1, false, -Math.PI / 9, (Math.PI * 2) / 9), "#f0c24a", { flat: true, rough: 0.8 });
  // chunky crust along the outer arc
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 9 + (i / 4) * ((Math.PI * 2) / 9);
    const seg = mesh(new THREE.BoxGeometry(0.045, 0.026, 0.05), "#caa05a", { flat: true, rough: 0.85 });
    seg.position.set(Math.sin(a) * 0.155, 0.004, Math.cos(a) * 0.155);
    seg.rotation.y = -a;
    g.add(seg);
  }
  // pepperoni + a few basil flecks
  const peps = [[0.0, 0.07], [0.18, 0.1], [-0.18, 0.1], [0.0, 0.125]];
  for (const [a, r] of peps) {
    const p = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.006, 10), "#bf3b2b", { flat: true });
    p.position.set(Math.sin(a) * r, 0.011, Math.cos(a) * r);
    g.add(p);
  }
  for (let i = 0; i < 4; i++) {
    const basil = mesh(new THREE.SphereGeometry(0.008, 6, 5), "#3f7a32", { flat: true });
    basil.position.set((Math.random() - 0.5) * 0.08, 0.011, 0.05 + Math.random() * 0.07);
    g.add(basil);
  }
  g.add(slice);
  return g;
}

function taco() {
  const g = new THREE.Group();
  // folded shell: bottom half of an open cylinder lying on its side, opening up
  const shell = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.13, 16, 1, true, Math.PI, Math.PI), "#e8b94e", { flat: true, rough: 0.8, side: THREE.DoubleSide });
  shell.rotation.z = Math.PI / 2;
  // fillings poking out of the top
  for (let i = 0; i < 5; i++) {
    const x = -0.05 + i * 0.025;
    const meat = mesh(new THREE.SphereGeometry(0.026, 8, 6), "#7a4a2c", { flat: true });
    meat.position.set(x, -0.01, (i % 2 - 0.5) * 0.02);
    const lettuce = mesh(new THREE.SphereGeometry(0.022, 8, 6), "#6fb04a", { flat: true });
    lettuce.position.set(x + 0.012, 0.03, 0.02); lettuce.scale.set(1, 0.6, 1);
    g.add(meat, lettuce);
  }
  const cheese = mesh(new THREE.SphereGeometry(0.016, 8, 6), "#f2c14e", { flat: true });
  cheese.position.set(0.02, 0.035, -0.02); cheese.scale.set(1.4, 0.4, 0.6);
  const tomato = mesh(new THREE.SphereGeometry(0.014, 8, 6), "#d8412f", { flat: true });
  tomato.position.set(-0.03, 0.03, 0.025);
  g.add(shell, cheese, tomato);
  return g;
}

function burger() {
  const g = new THREE.Group();
  const bottom = mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.04, 16), "#e0a85a", { flat: true, rough: 0.85 });
  bottom.position.y = -0.06;
  const patty = mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.035, 16), "#5a3826", { flat: true, rough: 0.9 });
  patty.position.y = -0.03;
  const cheese = mesh(new THREE.BoxGeometry(0.2, 0.012, 0.2), "#f2b829", { flat: true });
  cheese.position.y = -0.012; cheese.rotation.y = Math.PI / 4;
  const lettuce = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.018, 16), "#6fb04a", { flat: true });
  lettuce.position.y = 0.004;
  const top = mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), "#e0a85a", { flat: true, rough: 0.85 });
  top.position.y = 0.018; top.scale.set(1, 0.7, 1);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05;
    const r = 0.03 + (i % 2) * 0.025;
    const seed = mesh(new THREE.SphereGeometry(0.006, 6, 5), "#f5e6c0");
    seed.position.set(Math.cos(a) * r, 0.05 + Math.sin(i) * 0.008, Math.sin(a) * r);
    g.add(seed);
  }
  g.add(bottom, patty, cheese, lettuce, top);
  return g;
}

function sushi() {
  const g = new THREE.Group();
  const rice = mesh(new THREE.CapsuleGeometry(0.05, 0.1, 4, 8), "#f6f3ee", { flat: true, rough: 0.6 });
  rice.rotation.z = Math.PI / 2; rice.scale.set(1, 0.7, 1); rice.position.y = -0.02;
  const fish = mesh(new THREE.BoxGeometry(0.2, 0.03, 0.085), "#f08b5a", { flat: true, rough: 0.5 });
  fish.position.y = 0.02;
  for (let i = 0; i < 3; i++) {
    const stripe = mesh(new THREE.BoxGeometry(0.205, 0.004, 0.012), "#ffd9c0", { flat: true });
    stripe.position.set(0, 0.036, -0.025 + i * 0.025);
    g.add(stripe);
  }
  const nori = mesh(new THREE.BoxGeometry(0.045, 0.05, 0.1), "#2e3b2a", { flat: true, rough: 0.7 });
  g.add(rice, fish, nori);
  return g;
}

function pretzel() {
  const g = new THREE.Group();
  const knot = mesh(new THREE.TorusKnotGeometry(0.085, 0.022, 40, 6, 2, 3), "#8a5a2a", { flat: true, rough: 0.85 });
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.06 + Math.random() * 0.05;
    const salt = mesh(new THREE.SphereGeometry(0.005, 5, 4), "#ffffff");
    salt.position.set(Math.cos(a) * r, (Math.random() - 0.5) * 0.05, Math.sin(a) * r);
    g.add(salt);
  }
  g.add(knot);
  return g;
}

function baguette() {
  const g = new THREE.Group();
  const loaf = mesh(new THREE.CapsuleGeometry(0.04, 0.22, 6, 10), "#d6a85e", { flat: true, rough: 0.85 });
  loaf.rotation.z = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const cut = mesh(new THREE.BoxGeometry(0.022, 0.01, 0.05), "#b5854a", { flat: true });
    cut.position.set(-0.09 + i * 0.06, 0.036, 0); cut.rotation.y = 0.5;
    g.add(cut);
  }
  g.add(loaf);
  return g;
}

function lollipop() {
  const g = new THREE.Group();
  const disc = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 20), "#ffffff", { flat: true, rough: 0.3 });
  disc.rotation.x = Math.PI / 2; disc.position.y = 0.08;
  const cols = ["#e84c6a", "#ffffff", "#e84c6a"];
  for (let i = 0; i < 3; i++) {
    const ring = mesh(new THREE.TorusGeometry(0.018 + i * 0.022, 0.009, 6, 18), cols[i], { rough: 0.3 });
    ring.position.y = 0.08;
    g.add(ring);
  }
  const stick = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8), "#f4f1ec");
  g.add(disc, stick);
  return g;
}

function milkshake() {
  const g = new THREE.Group();
  const glass = mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.16, 16), "#eef3f5", { opacity: 0.4, rough: 0.2 });
  const shake = mesh(new THREE.CylinderGeometry(0.047, 0.038, 0.14, 16), "#f7a8c4", { opacity: 0.95, rough: 0.4 });
  shake.position.y = -0.005;
  const cream = mesh(new THREE.SphereGeometry(0.05, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), "#fff8f0", { flat: true });
  cream.position.y = 0.08; cream.scale.set(1, 1.2, 1);
  const cherry = mesh(new THREE.SphereGeometry(0.018, 10, 8), "#cc2233");
  cherry.position.y = 0.14;
  const straw = mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.18, 8), "#e0556f");
  straw.position.set(0.02, 0.09, 0); straw.rotation.z = 0.2;
  g.add(glass, shake, cream, cherry, straw);
  return g;
}

function bouquet() {
  const g = new THREE.Group();
  const wrap = mesh(new THREE.ConeGeometry(0.07, 0.16, 6, 1, true), "#cf8fb8", { flat: true, rough: 0.7 });
  wrap.rotation.x = Math.PI; wrap.position.y = -0.04;
  const cols = ["#ff5d73", "#ffd23f", "#8a6cff", "#ff8c42", "#56c271"];
  const spots = [[0, 0.13, 0], [0.05, 0.11, 0.02], [-0.05, 0.11, -0.02], [0.03, 0.1, -0.05], [-0.03, 0.1, 0.05]];
  for (let i = 0; i < 5; i++) {
    const [x, y, z] = spots[i];
    const stem = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.13, 5), "#4a8a3a");
    stem.position.set(x * 0.6, y - 0.06, z * 0.6);
    const blossom = mesh(new THREE.SphereGeometry(0.03, 10, 8), cols[i], { flat: true });
    blossom.position.set(x, y, z); blossom.scale.set(1, 0.7, 1);
    const center = mesh(new THREE.SphereGeometry(0.014, 8, 6), "#ffe066");
    center.position.set(x, y + 0.012, z);
    g.add(stem, blossom, center);
  }
  g.add(wrap);
  return g;
}

function camera() {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(0.2, 0.12, 0.08), "#3a3f44", { rough: 0.5 });
  const grip = mesh(new THREE.BoxGeometry(0.04, 0.12, 0.085), "#2a2e32", { rough: 0.6 });
  grip.position.x = 0.085;
  const barrel = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 18), "#1f2225", { rough: 0.4 });
  barrel.rotation.x = Math.PI / 2; barrel.position.set(-0.01, -0.005, 0.06);
  const glass = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 18), "#4a90d9", { rough: 0.1, metal: 0.3, emissive: "#214a6e", emissiveIntensity: 0.3 });
  glass.rotation.x = Math.PI / 2; glass.position.set(-0.01, -0.005, 0.092);
  const flash = mesh(new THREE.BoxGeometry(0.03, 0.02, 0.01), "#f5f5f5", { emissive: "#ffffff", emissiveIntensity: 0.2 });
  flash.position.set(-0.07, 0.05, 0.041);
  const finder = mesh(new THREE.BoxGeometry(0.04, 0.025, 0.02), "#15181a");
  finder.position.set(-0.06, 0.072, 0);
  const button = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 10), "#cc3333");
  button.position.set(0.06, 0.066, 0);
  g.add(body, grip, barrel, glass, flash, finder, button);
  return g;
}

function umbrella() {
  const g = new THREE.Group();
  const canopy = mesh(new THREE.SphereGeometry(0.14, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.3), "#e8473a", { flat: true, rough: 0.55 });
  canopy.position.y = 0.1;
  const tip = mesh(new THREE.ConeGeometry(0.012, 0.04, 8), "#caa24c");
  tip.position.y = 0.21;
  const shaft = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.24, 8), "#caa24c");
  const handle = mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 12, Math.PI), "#8a5a2a");
  handle.position.set(-0.03, -0.12, 0);
  g.add(canopy, tip, shaft, handle);
  return g;
}

function book() {
  const g = new THREE.Group();
  const cover = mesh(new THREE.BoxGeometry(0.16, 0.22, 0.025), "#9c3b3b", { rough: 0.6 });
  cover.position.z = 0.022;
  const back = cover.clone(); back.position.z = -0.022;
  const pages = mesh(new THREE.BoxGeometry(0.15, 0.205, 0.035), "#f3ead5", { rough: 0.8 });
  const spine = mesh(new THREE.BoxGeometry(0.025, 0.22, 0.088), "#7a2a2a", { rough: 0.6 });
  spine.position.x = -0.08;
  const title = mesh(new THREE.BoxGeometry(0.09, 0.05, 0.002), "#e8c46a");
  title.position.set(0.01, 0.05, 0.035);
  g.add(back, pages, cover, title, spine);
  return g;
}

function controller() {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(0.18, 0.055, 0.09), "#4a4f57", { rough: 0.5 });
  const gripL = mesh(new THREE.CapsuleGeometry(0.028, 0.04, 4, 8), "#3a3f47", { rough: 0.5 });
  gripL.position.set(-0.08, -0.04, 0.01); gripL.rotation.set(0.4, 0, 0.5);
  const gripR = gripL.clone(); gripR.position.x = 0.08; gripR.rotation.set(0.4, 0, -0.5);
  const dpadH = mesh(new THREE.BoxGeometry(0.045, 0.012, 0.015), "#222"); dpadH.position.set(-0.05, 0.032, 0);
  const dpadV = mesh(new THREE.BoxGeometry(0.015, 0.012, 0.045), "#222"); dpadV.position.set(-0.05, 0.032, 0);
  const bcols = ["#e74c3c", "#27ae60", "#2980d9", "#f1c40f"];
  const boff = [[0, 0.016], [0.016, 0], [0, -0.016], [-0.016, 0]];
  for (let i = 0; i < 4; i++) {
    const b = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.012, 10), bcols[i]);
    b.position.set(0.05 + boff[i][0], 0.034, boff[i][1]);
    g.add(b);
  }
  const stickL = mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.014, 12), "#222"); stickL.position.set(-0.018, 0.033, 0.03);
  const stickR = stickL.clone(); stickR.position.set(0.018, 0.033, 0.03);
  g.add(body, gripL, gripR, dpadH, dpadV, stickL, stickR);
  return g;
}

function skateboard() {
  const g = new THREE.Group();
  const deck = mesh(new THREE.BoxGeometry(0.28, 0.014, 0.08), "#6a4cd0", { rough: 0.5 });
  const nose = mesh(new THREE.BoxGeometry(0.04, 0.014, 0.08), "#6a4cd0", { rough: 0.5 });
  nose.position.set(0.15, 0.01, 0); nose.rotation.z = -0.4;
  const tail = nose.clone(); tail.position.x = -0.15; tail.rotation.z = 0.4;
  const truckGeo = new THREE.BoxGeometry(0.02, 0.012, 0.06);
  const t1 = mesh(truckGeo, "#cccccc", { metal: 0.6, rough: 0.3 }); t1.position.set(0.09, -0.014, 0);
  const t2 = t1.clone(); t2.position.x = -0.09;
  const wheelGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.016, 12);
  for (const [x, z] of [[0.09, 0.035], [0.09, -0.035], [-0.09, 0.035], [-0.09, -0.035]]) {
    const w = mesh(wheelGeo, "#f5c542", { rough: 0.4 });
    w.rotation.x = Math.PI / 2; w.position.set(x, -0.026, z);
    g.add(w);
  }
  g.add(deck, nose, tail, t1, t2);
  return g;
}

function wand() {
  const g = new THREE.Group();
  const stick = mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.24, 8), "#3a2a4a", { rough: 0.5 });
  const star = mesh(new THREE.SphereGeometry(0.025, 10, 8), "#ffd23f", { flat: true, emissive: "#ffcc33", emissiveIntensity: 0.4 });
  star.position.y = 0.15; star.scale.set(1, 1, 0.7);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const spike = mesh(new THREE.ConeGeometry(0.013, 0.04, 5), "#ffd23f", { flat: true, emissive: "#ffcc33", emissiveIntensity: 0.4 });
    spike.position.set(Math.cos(a) * 0.035, 0.15 + Math.sin(a) * 0.035, 0);
    spike.rotation.z = a - Math.PI / 2;
    g.add(spike);
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.06 + Math.random() * 0.03;
    const sparkle = mesh(new THREE.SphereGeometry(0.006, 6, 5), "#fff6c0", { emissive: "#fff0a0", emissiveIntensity: 0.6 });
    sparkle.castShadow = false;
    sparkle.position.set(Math.cos(a) * r, 0.15 + Math.sin(a) * r, 0.02);
    g.add(sparkle);
  }
  g.add(stick, star);
  return g;
}

function fishingRod() {
  const g = new THREE.Group();
  const rod = mesh(new THREE.CylinderGeometry(0.003, 0.011, 0.3, 8), "#7a5230", { rough: 0.5 });
  rod.position.y = 0.05;
  const handle = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 10), "#222", { rough: 0.7 });
  handle.position.y = -0.1;
  const reel = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.016, 14), "#cfd2d6", { metal: 0.5, rough: 0.3 });
  reel.rotation.x = Math.PI / 2; reel.position.set(0.02, -0.06, 0);
  const knob = mesh(new THREE.SphereGeometry(0.006, 8, 6), "#888"); knob.position.set(0.02, -0.06, 0.022);
  const line = mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.16, 4), "#e8e8e8", { opacity: 0.7 });
  line.position.set(0, 0.12, 0.02);
  const bob = mesh(new THREE.SphereGeometry(0.016, 10, 8), "#e8473a");
  bob.position.set(0, 0.04, 0.02);
  const bobTop = mesh(new THREE.SphereGeometry(0.016, 10, 8), "#ffffff");
  bobTop.position.set(0, 0.05, 0.02); bobTop.scale.set(1, 0.5, 1);
  g.add(rod, handle, reel, knob, line, bob, bobTop);
  g.rotation.z = -0.55;
  return g;
}

// id, display name, fake price (in "§"), emoji for the menu, and a mesh builder.
export const ITEMS = [
  { id: "balloon", name: "Party Balloon", price: 1, icon: "🎈", build: balloon },
  { id: "donut", name: "Sprinkle Donut", price: 2, icon: "🍩", build: donut },
  { id: "cookie", name: "Choc-Chip Cookie", price: 2, icon: "🍪", build: cookie },
  { id: "croissant", name: "Buttery Croissant", price: 3, icon: "🥐", build: croissant },
  { id: "rubber-duck", name: "Rubber Duck", price: 3, icon: "🦆", build: rubberDuck },
  { id: "muffin", name: "Blueberry Muffin", price: 3, icon: "🧁", build: muffin },
  { id: "pet-rock", name: "Pet Rock", price: 4, icon: "🪨", build: petRock },
  { id: "coffee-cup", name: "Hot Coffee", price: 4, icon: "☕", build: coffeeCup },
  { id: "sandwich", name: "Club Sandwich", price: 4, icon: "🥪", build: sandwich },
  { id: "ice-cream", name: "Ice Cream Cone", price: 5, icon: "🍦", build: iceCream },
  { id: "cactus", name: "Tiny Cactus", price: 5, icon: "🌵", build: cactus },
  { id: "tiny-plant", name: "Tiny Plant", price: 5, icon: "🪴", build: tinyPlant },
  { id: "boba", name: "Boba Tea", price: 6, icon: "🧋", build: bobaTea },
  { id: "teddy", name: "Teddy Bear", price: 7, icon: "🧸", build: teddy },
  { id: "lollipop", name: "Swirl Lollipop", price: 2, icon: "🍭", build: lollipop },
  { id: "pretzel", name: "Soft Pretzel", price: 3, icon: "🥨", build: pretzel },
  { id: "baguette", name: "Fresh Baguette", price: 3, icon: "🥖", build: baguette },
  { id: "pizza", name: "Pizza Slice", price: 4, icon: "🍕", build: pizza },
  { id: "taco", name: "Crunchy Taco", price: 4, icon: "🌮", build: taco },
  { id: "sushi", name: "Salmon Sushi", price: 5, icon: "🍣", build: sushi },
  { id: "burger", name: "Cheeseburger", price: 5, icon: "🍔", build: burger },
  { id: "milkshake", name: "Strawberry Milkshake", price: 6, icon: "🥤", build: milkshake },
  { id: "bouquet", name: "Flower Bouquet", price: 6, icon: "💐", build: bouquet },
  { id: "umbrella", name: "Rainy Umbrella", price: 7, icon: "☂️", build: umbrella },
  { id: "book", name: "Storybook", price: 7, icon: "📖", build: book },
  { id: "skateboard", name: "Mini Skateboard", price: 8, icon: "🛹", build: skateboard },
  { id: "wand", name: "Magic Wand", price: 8, icon: "🪄", build: wand },
  { id: "camera", name: "Retro Camera", price: 9, icon: "📷", build: camera },
  { id: "controller", name: "Game Controller", price: 9, icon: "🎮", build: controller },
  { id: "fishing-rod", name: "Fishing Rod", price: 10, icon: "🎣", build: fishingRod },
];

export function getItem(id) {
  return ITEMS.find((i) => i.id === id) || null;
}
