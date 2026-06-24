// Silly little things you can buy at the coffee bar. They cost "fake money" —
// there's no balance to check, buying always succeeds. Each item builds a small
// THREE.Object3D centered near the origin, sized to sit in a character's hand
// (and to look fine dropped on the floor). You can only hold one at a time.

import * as THREE from "three";

function mesh(geo, color, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0, flatShading: !!opts.flat });
  if (opts.opacity != null) { mat.transparent = true; mat.opacity = opts.opacity; }
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
  const soil = mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.01, 12), "#3a2a1a");
  soil.position.y = -0.025;
  const body = mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 10), "#4f9d5a", { flat: true });
  body.position.y = 0.05;
  const arm = mesh(new THREE.CapsuleGeometry(0.018, 0.05, 4, 8), "#4f9d5a", { flat: true });
  arm.position.set(0.05, 0.06, 0); arm.rotation.z = -0.8;
  g.add(pot, soil, body, arm);
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

// id, display name, fake price (in "§"), emoji for the menu, and a mesh builder.
export const ITEMS = [
  { id: "balloon", name: "Party Balloon", price: 1, icon: "🎈", build: balloon },
  { id: "donut", name: "Sprinkle Donut", price: 2, icon: "🍩", build: donut },
  { id: "rubber-duck", name: "Rubber Duck", price: 3, icon: "🦆", build: rubberDuck },
  { id: "pet-rock", name: "Pet Rock", price: 4, icon: "🪨", build: petRock },
  { id: "cactus", name: "Tiny Cactus", price: 5, icon: "🌵", build: cactus },
  { id: "boba", name: "Boba Tea", price: 6, icon: "🧋", build: bobaTea },
];

export function getItem(id) {
  return ITEMS.find((i) => i.id === id) || null;
}
