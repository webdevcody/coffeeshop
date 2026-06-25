// Town Plaza district — a paved public square centered on the origin, filling a
// 60×60 m tile (X,Z ∈ [-30,30]). A central circular fountain with animated
// rising water and a spinning ripple ring is the focal point, surrounded by
// benches, planters with flat-shaded shrubs, lamp posts, and two billboards on
// poles around the edges. Warm, friendly vibe.
//
// buildPlaza() returns:
//   group     — THREE.Group of all LOCAL meshes (centered on origin)
//   colliders — AABBs { minX,maxX,minZ,maxZ } for solid props (fountain, posts…)
//   ground    — walkable rects; includes the full tile rect
//   update(dt)— advances the fountain water + a slow foliage sway
//
// Coordinates: right-handed, Y-up. Ground is the XZ plane at y=0. Wide (>=6 m)
// open lanes are left between the centre fountain and the edge props so a car
// can drive across the square.

import * as THREE from "three";
import { artPanel, artMaterial } from "../cityArt.js";

// --- Shared geometry (created ONCE, reused across repeated props) -----------
const G = {
  benchSeat: new THREE.BoxGeometry(1.8, 0.16, 0.5),
  benchLeg: new THREE.BoxGeometry(0.16, 0.42, 0.5),
  benchBack: new THREE.BoxGeometry(1.8, 0.5, 0.12),
  planterBox: new THREE.BoxGeometry(1.6, 0.6, 1.6),
  shrub: new THREE.IcosahedronGeometry(0.62, 0),
  shrubTop: new THREE.IcosahedronGeometry(0.42, 0),
  lampPole: new THREE.CylinderGeometry(0.09, 0.11, 4.4, 8),
  lampBase: new THREE.CylinderGeometry(0.22, 0.26, 0.4, 10),
  lampHead: new THREE.SphereGeometry(0.28, 14, 12),
  pole: new THREE.CylinderGeometry(0.12, 0.12, 5.2, 8),
  poleBase: new THREE.BoxGeometry(0.5, 0.4, 0.5),
};

// --- Shared materials (created ONCE) ---------------------------------------
const M = {
  pavement: new THREE.MeshStandardMaterial({ color: "#b9b2a4", roughness: 0.96 }),
  pavementRing: new THREE.MeshStandardMaterial({ color: "#a89c86", roughness: 0.95 }),
  slabSide: new THREE.MeshStandardMaterial({ color: "#8d8676", roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: "#cdc6b6", roughness: 0.9 }),
  // Double-sided stone for OPEN-ENDED surfaces (the open-top basin wall ring):
  // its inner face must render when viewed from across/inside the fountain,
  // otherwise the single-sided ring vanishes edge-on / from the back.
  stoneWall: new THREE.MeshStandardMaterial({ color: "#cdc6b6", roughness: 0.9, side: THREE.DoubleSide }),
  stoneDark: new THREE.MeshStandardMaterial({ color: "#9a9384", roughness: 0.95 }),
  water: new THREE.MeshStandardMaterial({
    color: "#4fb6d8", roughness: 0.25, metalness: 0.15,
    transparent: true, opacity: 0.85,
    emissive: "#1d6f8f", emissiveIntensity: 0.25,
  }),
  jet: new THREE.MeshStandardMaterial({
    color: "#bfeefc", roughness: 0.2,
    transparent: true, opacity: 0.7,
    emissive: "#9fe0f5", emissiveIntensity: 0.3,
  }),
  benchWood: new THREE.MeshStandardMaterial({ color: "#a0683a", roughness: 0.7 }),
  benchMetal: new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.6 }),
  planter: new THREE.MeshStandardMaterial({ color: "#8a5a34", roughness: 0.85 }),
  foliage: new THREE.MeshStandardMaterial({ color: "#4f9d57", roughness: 0.9, flatShading: true }),
  foliageHi: new THREE.MeshStandardMaterial({ color: "#6cb86a", roughness: 0.9, flatShading: true }),
  poleMat: new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.5, metalness: 0.7 }),
  lampGlass: new THREE.MeshStandardMaterial({
    color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 0.9, roughness: 0.4,
  }),
};

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// --- Prop builders ----------------------------------------------------------
function makeBench() {
  const g = new THREE.Group();
  const seat = mesh(G.benchSeat, M.benchWood);
  seat.position.y = 0.46;
  const back = mesh(G.benchBack, M.benchWood);
  back.position.set(0, 0.72, -0.19);
  const legL = mesh(G.benchLeg, M.benchMetal);
  legL.position.set(-0.78, 0.21, 0);
  const legR = mesh(G.benchLeg, M.benchMetal);
  legR.position.set(0.78, 0.21, 0);
  g.add(seat, back, legL, legR);
  return g;
}

function makePlanter(swayList) {
  const g = new THREE.Group();
  const box = mesh(G.planterBox, M.planter);
  box.position.y = 0.3;
  g.add(box);
  // three flat-shaded shrubs clustered in the planter
  const offs = [
    [-0.28, 0.92, -0.2, G.shrub, M.foliage],
    [0.2, 1.12, 0.12, G.shrubTop, M.foliageHi],
  ];
  for (const [x, y, z, geo, mat] of offs) {
    const s = mesh(geo, mat);
    s.position.set(x, y, z);
    s.rotation.y = Math.random() * Math.PI;
    g.add(s);
    swayList.push({ obj: s, base: s.rotation.z, phase: Math.random() * Math.PI * 2 });
  }
  return g;
}

function makeLamp() {
  const g = new THREE.Group();
  const base = mesh(G.lampBase, M.poleMat);
  base.position.y = 0.2;
  const pole = mesh(G.lampPole, M.poleMat);
  pole.position.y = 2.4;
  const head = mesh(G.lampHead, M.lampGlass, true, false);
  head.position.y = 4.7;
  g.add(base, pole, head);
  return g;
}

// --- Main build -------------------------------------------------------------
export function buildPlaza() {
  const group = new THREE.Group();
  const colliders = [];
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];
  const sway = [];

  // Ground slab — pavement covering the whole tile (thin box at y~0).
  const slab = mesh(new THREE.BoxGeometry(60, 0.4, 60), M.pavement, false, true);
  slab.position.y = -0.2;
  group.add(slab);

  // A darker paved ring under the central fountain for visual focus.
  // Min ~0.1 m thick so the disc never reads as a 1px sliver edge-on; keep its
  // top face flush with the old 0.07 m top by lowering the center accordingly.
  const ringPave = mesh(new THREE.CylinderGeometry(9, 9, 0.1, 40), M.pavementRing, false, true);
  ringPave.position.y = 0.02;
  group.add(ringPave);

  // === Central circular fountain ===========================================
  const fountain = new THREE.Group();
  // Outer stone basin wall (ring) — open-top low cylinder.
  const basinWall = mesh(new THREE.CylinderGeometry(4, 4.2, 1.0, 36, 1, true), M.stoneWall);
  basinWall.position.y = 0.5;
  // Basin floor / inner water disc.
  const waterDisc = mesh(new THREE.CylinderGeometry(3.85, 3.85, 0.5, 36), M.water, false, false);
  waterDisc.position.y = 0.4;
  // Rim cap.
  const rim = mesh(new THREE.TorusGeometry(4.05, 0.18, 8, 36), M.stoneDark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.0;
  // Central pedestal column.
  const pedestal = mesh(new THREE.CylinderGeometry(0.6, 0.85, 1.6, 16), M.stone);
  pedestal.position.y = 0.8;
  // Upper tier bowl.
  const bowl = mesh(new THREE.CylinderGeometry(1.4, 0.5, 0.4, 20), M.stone);
  bowl.position.y = 1.7;
  const bowlWater = mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.16, 20), M.water, false, false);
  bowlWater.position.y = 1.92;
  // Animated rising water jet (scaled in update).
  const jet = mesh(new THREE.CylinderGeometry(0.16, 0.26, 1.6, 12), M.jet, false, false);
  jet.position.y = 2.7;
  // Animated spinning ripple ring on the basin surface.
  const ripple = mesh(new THREE.TorusGeometry(2.4, 0.1, 6, 28), M.jet, false, false);
  ripple.rotation.x = Math.PI / 2;
  ripple.position.y = 0.66;
  fountain.add(basinWall, waterDisc, rim, pedestal, bowl, bowlWater, jet, ripple);
  group.add(fountain);
  // Fountain collider — tight to the basin footprint (~4.2 m radius => 8.4 box).
  addCollider(colliders, 0, 0, 8.6, 8.6);

  // === Benches — arranged around the fountain, facing inward ================
  // Placed on a ~7 m radius so a wide ring lane (fountain edge ~4.3 to bench
  // ~6.5) stays open. Benches are small props; give each a tight collider.
  const benchPlaces = [
    { x: 0, z: 7.2, ry: Math.PI },     // south, facing -Z toward fountain
    { x: 0, z: -7.2, ry: 0 },          // north
    { x: 7.2, z: 0, ry: -Math.PI / 2 },// east
    { x: -7.2, z: 0, ry: Math.PI / 2 },// west
  ];
  for (const p of benchPlaces) {
    const b = makeBench();
    b.position.set(p.x, 0, p.z);
    b.rotation.y = p.ry;
    group.add(b);
    // tight collider aligned to bench orientation (1.8 wide x 0.5 deep)
    if (Math.abs(Math.sin(p.ry)) > 0.5) addCollider(colliders, p.x, p.z, 0.6, 2.0);
    else addCollider(colliders, p.x, p.z, 2.0, 0.6);
  }

  // === Planters with flat-shaded shrubs — corners of the square =============
  const planterPlaces = [
    [-22, -22], [22, -22], [-22, 22], [22, 22],
  ];
  for (const [x, z] of planterPlaces) {
    const pl = makePlanter(sway);
    pl.position.set(x, 0, z);
    group.add(pl);
    addCollider(colliders, x, z, 1.7, 1.7);
  }

  // === Lamp posts — spread around the plaza edges ==========================
  const lampPlaces = [
    [-12, -12], [12, -12], [-12, 12], [12, 12],
  ];
  for (const [x, z] of lampPlaces) {
    const l = makeLamp();
    l.position.set(x, 0, z);
    group.add(l);
    addCollider(colliders, x, z, 0.5, 0.5);
  }

  // === Two billboards on poles around the edge ============================
  // Billboard A — north edge, faces +Z (into the square / toward south spawn).
  const billA = new THREE.Group();
  const poleA = mesh(G.pole, M.poleMat);
  poleA.position.y = 2.6;
  const baseA = mesh(G.poleBase, M.poleMat);
  baseA.position.y = 0.2;
  const panelA = artPanel(5.0, 2.8, "billboard", {
    title: "WELCOME", sub: "TOWN PLAZA", accent: "#ffcf3f",
    a: "#2a6b4f", b: "#10331f", glyph: "☕",
    emissiveIntensity: 0.5, file: "billboard-plaza-welcome.png",
  });
  panelA.position.set(0, 5.2, 0.08);
  billA.add(poleA, baseA, panelA);
  billA.position.set(-9, 0, -25);
  group.add(billA);
  addCollider(colliders, -9, -25, 0.6, 0.6);

  // Billboard B — east edge, faces -X (into the square), so rotate around Y.
  const billB = new THREE.Group();
  const poleB = mesh(G.pole, M.poleMat);
  poleB.position.y = 2.6;
  const baseB = mesh(G.poleBase, M.poleMat);
  baseB.position.y = 0.2;
  const panelB = artPanel(5.0, 2.8, "billboard", {
    title: "FRESH BREW", sub: "OPEN DAILY", accent: "#ff9d3f",
    a: "#6b3a2a", b: "#331810", glyph: "★",
    emissiveIntensity: 0.5, file: "billboard-plaza-brew.png",
  });
  panelB.position.set(0, 5.2, 0.08);
  billB.add(poleB, baseB, panelB);
  billB.position.set(25, 0, 9);
  billB.rotation.y = -Math.PI / 2;
  group.add(billB);
  addCollider(colliders, 25, 9, 0.6, 0.6);

  // --- Animation state (no per-frame allocation) ---------------------------
  let t = 0;
  const update = (dt) => {
    t += dt;
    // Rising/falling water jet from the upper bowl.
    const grow = 1 + Math.sin(t * 3.0) * 0.35;
    jet.scale.y = grow;
    jet.position.y = 2.7 + (grow - 1) * 0.8; // keep base anchored as it grows
    // Gentle bob of the upper-bowl water surface.
    bowlWater.position.y = 1.92 + Math.sin(t * 2.2) * 0.03;
    // Spinning + pulsing ripple ring on the basin.
    ripple.rotation.z = t * 0.8;
    const rs = 1 + Math.sin(t * 1.6) * 0.12;
    ripple.scale.set(rs, rs, 1);
    // Subtle foliage sway.
    for (let i = 0; i < sway.length; i++) {
      const s = sway[i];
      s.obj.rotation.z = s.base + Math.sin(t * 1.2 + s.phase) * 0.06;
    }
  };

  return { group, colliders, ground, update };
}
