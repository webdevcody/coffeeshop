// STADIUM district — a small sports arena filling a 60×60 tile centered on the
// origin. An oval grandstand wall rings a green pitch with painted field lines;
// tiered seating rows step down toward the field; four floodlight towers stand at
// the corners with emissive lamp heads; big "CAFE FC" banners hang on the stands.
//
// buildStadium() returns { group, colliders, ground, update }:
//   group     — THREE.Group of all geometry (LOCAL coords within the tile)
//   colliders — AABBs { minX,maxX,minZ,maxZ } for solid props (stand wall arcs,
//               floodlight towers). The pitch + field are open and walkable.
//   ground    — walkable rects; includes the full tile.
//   update(dt)— flickers the floodlights + slowly orbits a blimp over the pitch.
//
// Coordinates: ground is the XZ plane at y=0; +Y up. Right-handed Y-up world.

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

// --- Materials (created once, reused) --------------------------------------
const grassMat = new THREE.MeshStandardMaterial({ color: "#2f7d3f", roughness: 1 });
const grassDark = new THREE.MeshStandardMaterial({ color: "#2a6f37", roughness: 1 });
const lineMat = new THREE.MeshStandardMaterial({ color: "#eef3ec", roughness: 0.7 });
// concreteMat clads the OPEN-ENDED cylinder grandstand wall (a tube). Open
// cylinders have no caps and only their outer faces, so a single-sided (default
// FrontSide) material makes the wall vanish / read as a 1px line when viewed
// from inside the arena. DoubleSide renders the inner face as a solid wall too.
const concreteMat = new THREE.MeshStandardMaterial({ color: "#b9b3a6", roughness: 0.95, side: THREE.DoubleSide });
const concreteDark = new THREE.MeshStandardMaterial({ color: "#8d887d", roughness: 1 });
// Seat-row materials clad OPEN-ENDED cylinder arcs (tiered seating tubes); make
// them DoubleSide for the same reason so the inward-facing seating reads solid.
const seatMatA = new THREE.MeshStandardMaterial({ color: "#c43b3b", roughness: 0.7, side: THREE.DoubleSide });
const seatMatB = new THREE.MeshStandardMaterial({ color: "#3667c0", roughness: 0.7, side: THREE.DoubleSide });
const seatMatC = new THREE.MeshStandardMaterial({ color: "#e0b03a", roughness: 0.7, side: THREE.DoubleSide });
const towerMat = new THREE.MeshStandardMaterial({ color: "#42474d", roughness: 0.5, metalness: 0.7 });
const rigMat = new THREE.MeshStandardMaterial({ color: "#2c3034", roughness: 0.6, metalness: 0.6 });
const lampMat = new THREE.MeshStandardMaterial({
  color: "#fff6d8", emissive: "#fff0b0", emissiveIntensity: 1.0, roughness: 0.3,
});
const goalMat = new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.5, metalness: 0.2 });
const blimpMat = new THREE.MeshStandardMaterial({ color: "#d6dadf", roughness: 0.6, metalness: 0.2 });

// --- Shared geometries (reused across repeated props) ----------------------
const lampGeo = new THREE.BoxGeometry(1.0, 1.1, 0.2);      // one floodlight lamp bank

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

export function buildStadium() {
  const group = new THREE.Group();
  const colliders = [];
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  // Pitch is an oval; stands ring it. Use elliptical radii.
  const PITCH_RX = 18;   // pitch half-width (X)
  const PITCH_RZ = 13;   // pitch half-depth (Z)

  // --- Ground slab: concrete apron under everything --------------------------
  const apron = box(60, 0.2, 60, concreteDark, false);
  apron.position.y = -0.1;
  apron.receiveShadow = true;
  group.add(apron);

  // --- The pitch: a green oval slab (thin cylinder, scaled to an ellipse) -----
  const pitch = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.16, 48), grassMat);
  pitch.scale.set(PITCH_RX, 1, PITCH_RZ);
  pitch.position.y = 0.02;
  pitch.receiveShadow = true;
  group.add(pitch);

  // Mowing stripes — a couple of darker bands across the pitch.
  for (const sx of [-1, 1]) {
    const stripe = box(3.0, 0.02, PITCH_RZ * 1.9, grassDark, false);
    stripe.position.set(sx * 6.2, 0.11, 0);
    stripe.receiveShadow = true;
    group.add(stripe);
  }

  // --- Field lines (flat, walkable, no colliders) ----------------------------
  const lineY = 0.12;
  // halfway line
  const halfway = box(0.3, 0.02, PITCH_RZ * 1.85, lineMat, false);
  halfway.position.set(0, lineY, 0);
  group.add(halfway);
  // center circle (thin torus)
  const circle = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.16, 8, 40), lineMat);
  circle.rotation.x = Math.PI / 2;
  circle.position.y = lineY;
  group.add(circle);
  // center spot
  const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 12), lineMat);
  spot.position.y = lineY;
  group.add(spot);
  // touch/goal outline rectangle near pitch edge
  const outlineW = PITCH_RX * 1.7, outlineD = PITCH_RZ * 1.6;
  for (const [w, d, x, z] of [
    [outlineW, 0.3, 0, outlineD / 2],
    [outlineW, 0.3, 0, -outlineD / 2],
    [0.3, outlineD, outlineW / 2, 0],
    [0.3, outlineD, -outlineW / 2, 0],
  ]) {
    const seg = box(w, 0.02, d, lineMat, false);
    seg.position.set(x, lineY, z);
    group.add(seg);
  }
  // penalty-box front line (one thin line set in from the goal end)
  const pbLine = box(0.3, 0.02, 8.0, lineMat, false);
  pbLine.position.set(outlineW / 2 - 6.0, lineY, 0);
  group.add(pbLine);

  // --- Goals at each pitch end ----------------------------------------------
  for (const sx of [-1, 1]) {
    const gx = sx * (PITCH_RX * 0.92);
    const goal = new THREE.Group();
    const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8), goalMat);
    postL.position.set(0, 1.2, -1.6);
    const postR = postL.clone();
    postR.position.z = 1.6;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 8), goalMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, 2.4, 0);
    postL.castShadow = postR.castShadow = bar.castShadow = true;
    goal.add(postL, postR, bar);
    goal.position.x = gx;
    group.add(goal);
  }

  // --- Grandstand: an oval wall + tiered seating, with east/west gates --------
  // The wall/seating are built as TWO arcs (north + south) leaving open gates on
  // the ±X axis so a car can drive straight through the tile across the pitch.
  const WALL_RX = 26, WALL_RZ = 21;
  const GATE = 0.34;                 // gate half-angle (~19°) at each X pole
  const ARC = Math.PI - 2 * GATE;    // angular length of each wall arc
  // Two arc geometries: north arc starts just past +X gate, south arc past -X.
  const wallGeoN = new THREE.CylinderGeometry(1, 1, 7.0, 40, 1, true, GATE, ARC);
  const wallGeoS = new THREE.CylinderGeometry(1, 1, 7.0, 40, 1, true, Math.PI + GATE, ARC);
  for (const geo of [wallGeoN, wallGeoS]) {
    const wall = new THREE.Mesh(geo, concreteMat);
    wall.scale.set(WALL_RX, 1, WALL_RZ);
    wall.position.y = 3.5;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  // Tiered seating: stacked arc rings stepping inward+up, matching the two gates.
  const seatMats = [seatMatA, seatMatB, seatMatC, seatMatA];
  for (let t = 0; t < 4; t++) {
    const rx = 24 - t * 1.7;
    const rz = 19 - t * 1.4;
    const y = 1.0 + t * 1.4;
    for (const startA of [GATE, Math.PI + GATE]) {
      const geo = new THREE.CylinderGeometry(1, 1, 1.0, 32, 1, true, startA, ARC);
      const ring = new THREE.Mesh(geo, seatMats[t]);
      ring.scale.set(rx, 1, rz);
      ring.position.y = y;
      ring.receiveShadow = true;
      group.add(ring);
    }
  }

  // --- Floodlight towers at the four corners ---------------------------------
  const towerPositions = [
    [-24, -19], [24, -19], [-24, 19], [24, 19],
  ];
  for (const [tx, tz] of towerPositions) {
    const t = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 16, 8), towerMat);
    mast.position.y = 8;
    mast.castShadow = true;
    // angled rig at top, tilted toward pitch center
    const rig = box(2.6, 1.6, 0.5, rigMat);
    rig.position.set(0, 16.3, 0);
    // lamp heads (emissive) on the rig, facing pitch — a side-by-side pair.
    for (const c of [-1, 1]) {
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(c * 0.62, 16.3, 0.32);
      t.add(lamp);
    }
    t.add(mast, rig);
    t.position.set(tx, 0, tz);
    // aim rig roughly at center
    t.rotation.y = Math.atan2(-tx, -tz);
    group.add(t);
    // collider: tight footprint around the mast base
    colliders.push({ minX: tx - 0.9, maxX: tx + 0.9, minZ: tz - 0.9, maxZ: tz + 0.9 });
  }

  // --- Big "CAFE FC" banners on the stands (artPanel "sign") -----------------
  // Front banner (faces +Z, readable from the open south side).
  const bannerFront = artPanel(12, 3.2, "sign", {
    text: "CAFE FC", bg: "#9b1f2a", fg: "#ffe14d",
    emissiveIntensity: 0.5, file: "stadium-cafefc.png",
  });
  bannerFront.position.set(0, 5.0, -20.4);
  bannerFront.rotation.y = 0; // faces +Z toward pitch/viewer
  group.add(bannerFront);

  // Back banner (faces -Z).
  const bannerBack = artPanel(12, 3.2, "sign", {
    text: "CAFE FC", bg: "#1f3a9b", fg: "#ffffff",
    emissiveIntensity: 0.5, file: "stadium-cafefc-b.png",
  });
  bannerBack.position.set(0, 5.0, 20.4);
  bannerBack.rotation.y = Math.PI;
  group.add(bannerBack);

  // Side scoreboard billboard on the east wall.
  const scoreboard = artPanel(8, 4.5, "billboard", {
    title: "CAFE FC", sub: "HOME 2 — 1 AWAY", a: "#13243f", b: "#070d1a",
    accent: "#ffd24a", glyph: "⚽", emissiveIntensity: 0.5, file: "stadium-score.png",
  });
  scoreboard.position.set(-24.2, 5.5, 0);
  scoreboard.rotation.y = Math.PI / 2; // faces +X / pitch
  group.add(scoreboard);

  // --- Floodlight tint / blimp animation -------------------------------------
  // Blimp circling above the pitch.
  const blimp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), blimpMat);
  body.scale.set(2.4, 1, 1);
  const fin = box(0.1, 1.0, 1.0, blimpMat);
  fin.position.x = -3.4;
  blimp.add(body, fin);
  const banner = artPanel(5, 1.4, "sign", {
    text: "CAFE FC", bg: "#0e7a4a", fg: "#fff7cf",
    emissiveIntensity: 0.5, file: "stadium-blimp.png",
  });
  banner.position.set(0, -1.6, 0);
  blimp.add(banner);
  blimp.position.set(0, 18, 0);
  group.add(blimp);

  // --- update: flicker floodlights + orbit blimp -----------------------------
  let tAcc = 0;
  const baseIntensity = 1.0;
  const update = (dt) => {
    tAcc += dt;
    // Subtle synchronized buzz/flicker on the lamp heads (shared material).
    const flick = baseIntensity + Math.sin(tAcc * 9.0) * 0.08 + (Math.sin(tAcc * 37.0) > 0.96 ? -0.25 : 0);
    lampMat.emissiveIntensity = flick;
    // Orbit the blimp slowly over the pitch.
    const ang = tAcc * 0.18;
    blimp.position.set(Math.cos(ang) * 14, 18 + Math.sin(tAcc * 0.5) * 0.6, Math.sin(ang) * 10);
    blimp.rotation.y = -ang + Math.PI / 2;
  };

  // --- Colliders for the grandstand wall ------------------------------------
  // The stand wall is two oval arcs; approximate each with box colliders so
  // players/cars can't pass through the structure. We SKIP segments near the ±X
  // poles so the east/west gates stay open — a car can drive straight through the
  // tile along the Z≈0 corridor (gate openings are ~14 m wide). Pitch is open.
  const SEG = 20;
  const GATE_SKIP = 0.5; // skip segments whose angle is within this of a pole
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    // distance of this angle from the +X (0) or -X (π) gate centers
    const dGate = Math.min(Math.abs(a), Math.abs(a - Math.PI), Math.abs(a - 2 * Math.PI));
    if (dGate < GATE_SKIP) continue; // leave the gate corridor clear
    const cx = Math.cos(a) * WALL_RX;
    const cz = Math.sin(a) * WALL_RZ;
    const half = 2.8; // tight-ish box bridging to the next segment
    colliders.push({
      minX: cx - half, maxX: cx + half,
      minZ: cz - half, maxZ: cz + half,
    });
  }

  return { group, colliders, ground, update };
}
