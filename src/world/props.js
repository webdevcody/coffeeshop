// Reusable furniture / decor builders. Each returns a THREE.Group positioned at
// its own local origin (centered on the floor, y=0 at the base) so the caller
// can simply set group.position and group.rotation.y.

import * as THREE from "three";

// --- Shared materials (created once, reused everywhere) --------------------
const wood = new THREE.MeshStandardMaterial({ color: "#6b4326", roughness: 0.7, metalness: 0.05 });
const darkWood = new THREE.MeshStandardMaterial({ color: "#3f2a1a", roughness: 0.7 });
const metal = new THREE.MeshStandardMaterial({ color: "#2b2b2f", roughness: 0.35, metalness: 0.85 });
const chrome = new THREE.MeshStandardMaterial({ color: "#cfd2d6", roughness: 0.2, metalness: 0.95 });
const ceramic = new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.4 });
const terracotta = new THREE.MeshStandardMaterial({ color: "#b5613a", roughness: 0.8 });
const leaf = new THREE.MeshStandardMaterial({ color: "#3f7d4d", roughness: 0.85, flatShading: true });
const leafDark = new THREE.MeshStandardMaterial({ color: "#356641", roughness: 0.85, flatShading: true });

function mesh(geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// Height (metres) of the seating surface for each sittable prop. The world uses
// these to register seats and to drop a seated character onto the right level.
export const CHAIR_SEAT_Y = 0.49; // seat box top: 0.46 + 0.06/2
export const STOOL_SEAT_Y = 0.82; // seat disc top: 0.78 + 0.08/2

// --- Bistro table (round) --------------------------------------------------
export function makeTable() {
  const g = new THREE.Group();
  const top = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 24), wood);
  top.position.y = 0.74;
  const post = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.72, 12), metal);
  post.position.y = 0.38;
  const base = mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.06, 20), metal);
  base.position.y = 0.03;
  g.add(top, post, base);
  return g;
}

// --- Chair -----------------------------------------------------------------
export function makeChair() {
  const g = new THREE.Group();
  const seat = mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), wood);
  seat.position.y = 0.46;
  // Backrest: two uprights plus a couple of horizontal slats instead of one
  // solid slab — reads as a proper café chair. The uprights overlap into the
  // seat (bottom at 0.43, below the seat top 0.49) so no coincident faces.
  const uprightGeo = new THREE.BoxGeometry(0.05, 0.52, 0.05);
  for (const ux of [-0.17, 0.17]) {
    const up = mesh(uprightGeo, darkWood);
    up.position.set(ux, 0.72, -0.18);
    g.add(up);
  }
  const slatGeo = new THREE.BoxGeometry(0.34, 0.07, 0.045);
  for (const sy of [0.66, 0.84]) {
    const slat = mesh(slatGeo, wood);
    slat.position.set(0, sy, -0.18);
    g.add(slat);
  }
  g.add(seat);
  const legGeo = new THREE.BoxGeometry(0.05, 0.46, 0.05);
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
    const leg = mesh(legGeo, darkWood);
    leg.position.set(x, 0.23, z);
    g.add(leg);
  }
  g.userData.seatY = CHAIR_SEAT_Y;
  return g;
}

// --- Counter / bar (length along local X) ----------------------------------
export function makeCounter(length = 6) {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(length, 1.05, 0.85), darkWood);
  body.position.y = 0.525;
  // Overlap the worktop slightly into the body (bottom at 1.02 vs body top
  // 1.05) so the seam is buried rather than two coincident faces z-fighting.
  const top = mesh(new THREE.BoxGeometry(length + 0.18, 0.08, 1.02), wood);
  top.position.y = 1.06;
  // front panel accent
  const panel = mesh(new THREE.BoxGeometry(length - 0.2, 0.7, 0.04), wood);
  panel.position.set(0, 0.5, 0.43);
  g.add(body, top, panel);
  return g;
}

// --- Counter stool ---------------------------------------------------------
export function makeStool() {
  const g = new THREE.Group();
  const seat = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 18), wood);
  seat.position.y = 0.78;
  // Lift the post so its base is buried inside the foot (bottom at ~0.013)
  // instead of sharing the floor plane with the foot's underside; top still
  // penetrates the seat disc.
  const post = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.78, 12), chrome);
  post.position.y = 0.4;
  const foot = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 18), chrome);
  foot.position.y = 0.02;
  g.add(seat, post, foot);
  g.userData.seatY = STOOL_SEAT_Y;
  return g;
}

// --- Espresso machine ------------------------------------------------------
// The world parks an animated steam puff above this machine's left group head;
// userData.steamAnchor records that local offset (relative to the machine
// origin) so the caller doesn't have to hard-code it.
export function makeEspressoMachine() {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(1.1, 0.55, 0.6), chrome);
  body.position.y = 0.28;
  const dome = mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.0, 16), chrome);
  dome.rotation.z = Math.PI / 2;
  dome.position.y = 0.6;
  // Two brew groups, each a chrome collar with a portafilter handle jutting
  // forward. The collar overlaps the body (back at z=0.26 vs body front 0.30)
  // so there's no coincident face to z-fight.
  const headPos = [-0.28, 0.28];
  const collarGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.14, 14);
  const handleGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8);
  const knobGeo = new THREE.SphereGeometry(0.03, 8, 8);
  for (const hx of headPos) {
    const collar = mesh(collarGeo, metal);
    collar.position.set(hx, 0.2, 0.32);
    const handle = mesh(handleGeo, darkWood);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(hx, 0.16, 0.46);
    const knob = mesh(knobGeo, darkWood);
    knob.position.set(hx, 0.16, 0.55);
    g.add(collar, handle, knob);
  }
  // Cup grate / drip tray beneath the heads (sits on the counter just in front
  // of the body, not coincident with it).
  const tray = mesh(new THREE.BoxGeometry(0.78, 0.03, 0.18), metal);
  tray.position.set(0, 0.025, 0.36);
  // Two warm-up cups resting on top of the dome.
  const warmCupGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.07, 12);
  for (const cx of [-0.18, 0.18]) {
    const c = mesh(warmCupGeo, ceramic);
    c.position.set(cx, 0.755, 0);
    g.add(c);
  }
  // Steam wand on the right side: a thin angled pipe with a tip.
  const wand = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), chrome);
  wand.position.set(0.5, 0.4, 0.2);
  wand.rotation.x = 0.5;
  const wandTip = mesh(new THREE.CylinderGeometry(0.02, 0.012, 0.05, 8), metal);
  wandTip.position.set(0.5, 0.26, 0.27);
  wandTip.rotation.x = 0.5;
  const lamp = mesh(new THREE.SphereGeometry(0.05, 10, 10), new THREE.MeshStandardMaterial({ color: "#ff5a3c", emissive: "#ff3b1f", emissiveIntensity: 1.5 }));
  lamp.position.set(0, 0.62, 0.18);
  g.add(body, dome, tray, wand, wandTip, lamp);
  // Local offset where steam should rise (just above the left brew group).
  g.userData.steamAnchor = { x: -0.28, y: 0.5, z: 0.3 };
  return g;
}

// --- Pastry display case ---------------------------------------------------
const pastryDough = new THREE.MeshStandardMaterial({ color: "#d9a066", roughness: 0.8 });
const pastryDark = new THREE.MeshStandardMaterial({ color: "#a86a38", roughness: 0.8 });
const pastryGlaze = new THREE.MeshStandardMaterial({ color: "#7a4a2a", roughness: 0.45 });
export function makePastryCase() {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: "#cfe8ef", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.3 });
  // A wooden tray under the glass so the case reads as a real display, not a
  // floating cube. The tray top (y=0.04) sits below the glass box bottom (y=0)
  // — the glass overlaps down into the tray, so no coincident faces.
  const tray = mesh(new THREE.BoxGeometry(1.26, 0.08, 0.66), darkWood);
  tray.position.y = -0.02;
  const box = mesh(new THREE.BoxGeometry(1.2, 0.5, 0.6), glass, false);
  box.position.y = 0.25;
  // A glass shelf splitting the case so pastries occupy two tiers.
  const shelf = mesh(new THREE.BoxGeometry(1.16, 0.012, 0.56), glass, false);
  shelf.position.y = 0.25;
  g.add(tray, box, shelf);
  // Lower tier: round buns / muffins resting on the tray.
  for (let i = -1; i <= 1; i++) {
    const p = mesh(new THREE.SphereGeometry(0.1, 10, 8), i === 0 ? pastryDark : pastryDough);
    p.scale.y = 0.62;
    p.position.set(i * 0.34, 0.085, 0.12);
    g.add(p);
  }
  // Upper tier: a couple of croissant-ish crescents (squashed torus) plus a
  // glazed loaf, sitting on the glass shelf.
  for (const cx of [-0.32, 0.32]) {
    const cr = mesh(new THREE.TorusGeometry(0.08, 0.035, 8, 12, Math.PI * 1.3), pastryDough);
    cr.rotation.x = Math.PI / 2;
    cr.scale.set(1, 1, 0.7);
    cr.position.set(cx, 0.3, -0.1);
    g.add(cr);
  }
  const loaf = mesh(new THREE.CapsuleGeometry(0.06, 0.16, 4, 8), pastryGlaze);
  loaf.rotation.z = Math.PI / 2;
  loaf.position.set(0, 0.3, -0.1);
  g.add(loaf);
  return g;
}

// --- Potted plant ----------------------------------------------------------
export function makePlant(scale = 1) {
  const g = new THREE.Group();
  const pot = mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.4, 16), terracotta);
  pot.position.y = 0.2;
  g.add(pot);
  const trunk = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 8), darkWood);
  trunk.position.y = 0.55;
  g.add(trunk);
  const blobs = [
    [0, 1.05, 0, 0.45, leaf],
    [0.25, 0.85, 0.1, 0.32, leafDark],
    [-0.22, 0.92, -0.08, 0.3, leaf],
    [0.05, 1.3, -0.05, 0.3, leafDark],
  ];
  for (const [x, y, z, r, mat] of blobs) {
    const b = mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    b.position.set(x, y, z);
    g.add(b);
  }
  g.scale.setScalar(scale);
  return g;
}

// --- Hanging pendant lamp (returns light so caller can register it) --------
export function makePendantLamp() {
  const g = new THREE.Group();
  const cord = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 6), darkWood, false);
  cord.position.y = 0.6;
  const shadeMat = new THREE.MeshStandardMaterial({
    color: "#1d1d22",
    emissive: "#ffcaa0",
    emissiveIntensity: 0.9,
    side: THREE.DoubleSide,
    roughness: 0.6,
  });
  const shade = mesh(new THREE.ConeGeometry(0.32, 0.34, 20, 1, true), shadeMat, false);
  shade.position.y = -0.15;
  const bulb = mesh(new THREE.SphereGeometry(0.08, 10, 10), new THREE.MeshStandardMaterial({ color: "#fff2d0", emissive: "#ffdca0", emissiveIntensity: 2 }), false);
  bulb.position.y = -0.2;
  g.add(cord, shade, bulb);

  const light = new THREE.PointLight("#ffd9a8", 14, 11, 2);
  light.position.y = -0.25;
  light.castShadow = false;
  g.add(light);
  return { group: g, light };
}

// --- Rug -------------------------------------------------------------------
export function makeRug(w = 5, d = 4, color = "#9e3b3b") {
  const g = new THREE.Group();
  const rug = mesh(new THREE.BoxGeometry(w, 0.02, d), new THREE.MeshStandardMaterial({ color, roughness: 1 }), false);
  rug.position.y = 0.011;
  rug.receiveShadow = true;
  // Inset field as a thin slab whose underside is buried just inside the rug
  // (bottom ~0.018, below the rug top at 0.021) so neither face is coincident
  // with the floor or the rug surface — its top alone reads as the lighter band.
  const border = mesh(
    // Muted oatmeal, kept below the bloom threshold so the rug's centre band
    // doesn't blow out into a washed-out "glow" under the warm interior light +
    // bloom (the old near-white #e9dcc3 read as luminance ~0.87, above threshold).
    new THREE.BoxGeometry(w - 0.5, 0.008, d - 0.5),
    new THREE.MeshStandardMaterial({ color: "#cdbfa0", roughness: 1 }),
    false
  );
  border.position.y = 0.022;
  border.receiveShadow = true;
  g.add(rug, border);
  return g;
}

// --- Coffee mug (decor + can be parented to a hand) ------------------------
export function makeMug(color = "#f4efe6") {
  const g = new THREE.Group();
  const cup = mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.09, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  cup.position.y = 0.045;
  const coffee = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 14), new THREE.MeshStandardMaterial({ color: "#3a2415", roughness: 0.5 }), false);
  // Coffee surface just below the rim (cup top is at 0.09) so it doesn't poke
  // through and the dark disc reads as liquid inside the cup.
  coffee.position.y = 0.082;
  const handle = mesh(new THREE.TorusGeometry(0.03, 0.01, 8, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  handle.position.set(0.055, 0.045, 0);
  handle.rotation.y = Math.PI / 2;
  g.add(cup, coffee, handle);
  return g;
}

// --- Framed chalkboard menu (hangs on a wall) ------------------------------
export function makeChalkboard(texture) {
  const g = new THREE.Group();
  const frame = mesh(new THREE.BoxGeometry(2.0, 2.6, 0.08), darkWood, false);
  const board = mesh(new THREE.PlaneGeometry(1.8, 2.4), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }), false);
  board.position.z = 0.05;
  // A chalk ledge across the bottom with a stub of chalk on it.
  const ledge = mesh(new THREE.BoxGeometry(2.0, 0.05, 0.12), wood, false);
  ledge.position.set(0, -1.32, 0.08);
  const chalk = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), ceramic, false);
  chalk.rotation.z = Math.PI / 2;
  chalk.position.set(0.5, -1.29, 0.12);
  g.add(frame, board, ledge, chalk);
  return g;
}

// --- Window (frame + glowing pane; sits in a wall) -------------------------
export function makeWindow(w = 2.4, h = 2.6) {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: "#efe7d6", roughness: 0.7 });
  const pane = mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ color: "#cfe9ff", emissive: "#bfe0ff", emissiveIntensity: 0.6, roughness: 0.1 }),
    false
  );
  g.add(pane);
  const t = 0.12;
  const top = mesh(new THREE.BoxGeometry(w + t * 2, t, 0.12), frameMat, false);
  top.position.y = h / 2;
  const bot = top.clone();
  bot.position.y = -h / 2;
  const left = mesh(new THREE.BoxGeometry(t, h + t * 2, 0.12), frameMat, false);
  left.position.x = -w / 2;
  const right = left.clone();
  right.position.x = w / 2;
  const mullV = mesh(new THREE.BoxGeometry(0.06, h, 0.1), frameMat, false);
  const mullH = mesh(new THREE.BoxGeometry(w, 0.06, 0.1), frameMat, false);
  g.add(top, bot, left, right, mullV, mullH);
  return g;
}
