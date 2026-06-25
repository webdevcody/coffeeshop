// ARCADE ALLEY — a neon 80s-synthwave arcade strip.
//
// A 60x60 m tile centered on the origin (X,Z ∈ [-30,30], ground at y=0). Two
// rows of glowing arcade buildings face a wide central avenue so a car can drive
// straight down Z. Big neon signs ("ARCADE", "PLAY"), a "PLAY AT THE CAFE"
// billboard, tall standalone cabinets along the curbs, and a giant joystick
// sculpture as the centerpiece. The neon flickers in update().
//
// THEME DETAIL: every building now wears a marquee band + a full neon trim
// outline tracing its facade, a glowing entrance archway, a ticket booth, and
// movie-style posters. Rooftop neon tubes + signage clutter the parapets, lit
// window grids glow on the upper floors (InstancedMesh), and extra standing
// cabinets line the curbs. All new detail is visual-only and stays clear of the
// central avenue and the cross lane.
//
// buildArcade() returns { group, colliders, ground, update }:
//   group     — THREE.Group of all meshes, LOCAL to the tile
//   colliders — AABBs { minX, maxX, minZ, maxZ } for solid props only
//   ground    — walkable rects; includes the full-tile slab
//   update(dt)— flickers neon + spins the joystick sculpture; no allocation
//
// A car can drive the central avenue along Z (X ∈ [-6, 6] is clear). The cross
// lane along X (Z ∈ [-6, 6]) at the plaza is also open.

import * as THREE from "three";
import { artPanel, artTexture } from "../cityArt.js";

// --- Shared geometries (created once, reused) ------------------------------
const BOX = new THREE.BoxGeometry(1, 1, 1); // unit box, scaled per use
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 16); // unit cylinder
const SPHERE = new THREE.SphereGeometry(0.5, 16, 12);
const TORUS = new THREE.TorusGeometry(0.5, 0.12, 8, 24); // unit ring (archway)
const WINDOW_GEO = new THREE.BoxGeometry(1, 1, 1); // shared geo for window instances

// --- Shared materials (created once, reused) -------------------------------
const matPavement = new THREE.MeshStandardMaterial({ color: "#1a1430", roughness: 0.95 });
const matLane = new THREE.MeshStandardMaterial({ color: "#241a44", roughness: 0.9 });
const matCurb = new THREE.MeshStandardMaterial({ color: "#3a2a66", roughness: 0.8 });
const matBuildA = new THREE.MeshStandardMaterial({ color: "#2a1d4d", roughness: 0.85, flatShading: true });
const matBuildB = new THREE.MeshStandardMaterial({ color: "#3a1d52", roughness: 0.85, flatShading: true });
const matStore = new THREE.MeshStandardMaterial({ color: "#140e26", roughness: 0.7 }); // dark storefront base
const matGlass = new THREE.MeshStandardMaterial({
  color: "#0c1c2e", emissive: "#1c5a7a", emissiveIntensity: 0.45, roughness: 0.25, metalness: 0.3,
});
const matTrim = new THREE.MeshStandardMaterial({
  color: "#ff3fae", emissive: "#ff2fa0", emissiveIntensity: 0.7, roughness: 0.4,
});
const matTrimCyan = new THREE.MeshStandardMaterial({
  color: "#27e0ff", emissive: "#27d0ff", emissiveIntensity: 0.7, roughness: 0.4,
});
const matTrimGold = new THREE.MeshStandardMaterial({
  color: "#ffd23f", emissive: "#ffb01f", emissiveIntensity: 0.65, roughness: 0.4,
});
const matMarquee = new THREE.MeshStandardMaterial({ color: "#0f0a1e", roughness: 0.6 }); // marquee backing
const matWindow = new THREE.MeshStandardMaterial({
  color: "#1a3346", emissive: "#46d6ff", emissiveIntensity: 0.55, roughness: 0.3,
});
const matCabinet = new THREE.MeshStandardMaterial({ color: "#181028", roughness: 0.6, metalness: 0.2 });
const matScreen = new THREE.MeshStandardMaterial({
  color: "#0a2a3a", emissive: "#34c8ff", emissiveIntensity: 0.9, roughness: 0.3,
});
const matMetal = new THREE.MeshStandardMaterial({ color: "#22202c", roughness: 0.5, metalness: 0.7 });
const matRoof = new THREE.MeshStandardMaterial({ color: "#15101f", roughness: 0.9 }); // rooftop clutter
const matStick = new THREE.MeshStandardMaterial({ color: "#c2103f", roughness: 0.5, metalness: 0.2 });
const matKnob = new THREE.MeshStandardMaterial({
  color: "#ff3050", emissive: "#ff2040", emissiveIntensity: 0.6, roughness: 0.4,
});
const matButton = new THREE.MeshStandardMaterial({
  color: "#ffd23f", emissive: "#ffb01f", emissiveIntensity: 0.8, roughness: 0.4,
});
const matPole = new THREE.MeshStandardMaterial({ color: "#1c1a28", roughness: 0.5, metalness: 0.7 });

// Helper: a box prop. Scales the shared unit box; sets shadows.
function box(w, h, d, mat, x, y, z, cast = true) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function cyl(r, h, mat, x, y, z, cast = true) {
  const m = new THREE.Mesh(CYL, mat);
  m.scale.set(r * 2, h, r * 2);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

export function buildArcade() {
  const group = new THREE.Group();
  const colliders = [];
  const neonMats = []; // emissive mats to flicker
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  // --- Ground slab: dark synthwave pavement ---------------------------------
  const slab = box(60, 0.2, 60, matPavement, 0, -0.1, 0, false);
  slab.castShadow = false;
  group.add(slab);

  // Central avenue (drivable along Z), slightly different tone, X ∈ [-6,6].
  group.add(box(12, 0.04, 60, matLane, 0, 0.02, 0, false));
  // Glowing center line down the avenue.
  const centerLine = box(0.3, 0.06, 56, matTrimCyan, 0, 0.05, 0, false);
  centerLine.castShadow = false;
  group.add(centerLine);
  neonMats.push(matTrimCyan);

  // Curb strips lining the avenue (visual edge between lane and sidewalk).
  group.add(box(0.5, 0.18, 60, matCurb, -6.25, 0.06, 0, false));
  group.add(box(0.5, 0.18, 60, matCurb, 6.25, 0.06, 0, false));

  // --- Arcade buildings: two rows flanking the avenue -----------------------
  // Each building footprint sits beyond X = ±6 so the lane stays clear.
  // Buildings sit at z = ±18 on each side; the facade faces the avenue.
  const buildMats = [matBuildA, matBuildB];
  const buildSpots = [
    { x: -13, z: -18, w: 12, d: 12, facing: 1 },  // faces +X (toward avenue)
    { x: -13, z: 18, w: 12, d: 12, facing: 1 },
    { x: 13, z: -18, w: 12, d: 12, facing: -1 },  // faces -X (toward avenue)
    { x: 13, z: 18, w: 12, d: 12, facing: -1 },
  ];

  // Reusable matrix/objects for InstancedMesh writes (no per-frame allocation).
  const _m4 = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scl = new THREE.Vector3();

  // Collect all upper-floor window placements, then bake them into a single
  // InstancedMesh at the end (one shared geo + one shared material).
  const winPlacements = [];

  buildSpots.forEach((b, i) => {
    const h = 9 + (i % 2) * 2;
    const mat = buildMats[i % 2];
    const trim = (i % 2 === 0) ? matTrim : matTrimCyan;
    const facadeX = b.x + b.facing * (b.w / 2); // inner face X toward avenue
    const fnorm = b.facing; // +1 means face points toward +X

    // Main mass.
    group.add(box(b.w, h, b.d, mat, b.x, h / 2, b.z));

    // --- Cornice / parapet trim band near the top (existing look kept) ------
    group.add(box(b.w + 0.3, 0.5, b.d + 0.3, trim, b.x, h - 1.2, b.z, false));
    // Solid cornice ledge just below it (non-emissive lip for depth).
    group.add(box(b.w + 0.5, 0.4, b.d + 0.5, matMarquee, b.x, h - 1.8, b.z, false));

    // --- Full neon trim OUTLINE tracing the facade edges --------------------
    // Vertical tubes at the two front corners + horizontal tubes top & bottom,
    // all on the avenue-facing face. Visual only, flush to the wall.
    const fz0 = b.z - b.d / 2 + 0.2;
    const fz1 = b.z + b.d / 2 - 0.2;
    const outX = facadeX + fnorm * 0.12;
    group.add(box(0.18, h - 0.4, 0.18, trim, outX, h / 2, fz0, false)); // left vertical
    group.add(box(0.18, h - 0.4, 0.18, trim, outX, h / 2, fz1, false)); // right vertical
    group.add(box(0.18, 0.18, b.d - 0.4, trim, outX, h - 0.4, b.z, false)); // top horizontal
    group.add(box(0.18, 0.18, b.d - 0.4, trim, outX, 0.4, b.z, false)); // bottom horizontal

    // --- Ground-floor STOREFRONT: dark base + glowing display windows -------
    const storeH = 3.4;
    // Recessed storefront panel slightly proud of the wall.
    group.add(box(0.3, storeH, b.d - 1.2, matStore, facadeX + fnorm * 0.18, storeH / 2, b.z, false));
    // Three lit display windows across the storefront.
    for (let k = -1; k <= 1; k++) {
      const wz = b.z + k * 3.4;
      group.add(box(0.12, 2.2, 2.4, matGlass, facadeX + fnorm * 0.34, 1.7, wz, false));
      // mullion cross between windows
      group.add(box(0.14, 2.4, 0.14, matMetal, facadeX + fnorm * 0.36, 1.7, wz + 1.7, false));
    }

    // --- MARQUEE band: a lit horizontal sign box above the storefront -------
    const marqY = storeH + 0.9;
    group.add(box(0.5, 1.4, b.d - 1.0, matMarquee, facadeX + fnorm * 0.32, marqY, b.z, false));
    // Glowing marquee lip top & bottom.
    group.add(box(0.55, 0.18, b.d - 0.8, trim, facadeX + fnorm * 0.33, marqY + 0.75, b.z, false));
    group.add(box(0.55, 0.18, b.d - 0.8, matTrimGold, facadeX + fnorm * 0.33, marqY - 0.75, b.z, false));
    // Chasing marquee bulbs (small emissive dots along the lower lip).
    for (let k = -4; k <= 4; k++) {
      const bulb = box(0.16, 0.16, 0.16, matTrimGold, facadeX + fnorm * 0.4, marqY - 0.95, b.z + k * 1.0, false);
      group.add(bulb);
    }

    // --- Glowing ENTRANCE ARCHWAY at the storefront center ------------------
    const arch = new THREE.Mesh(TORUS, trim);
    arch.scale.set(2.6, 2.6, 1);
    arch.position.set(facadeX + fnorm * 0.4, 2.2, b.z);
    arch.rotation.y = Math.PI / 2; // ring opens toward avenue
    arch.castShadow = false;
    group.add(arch);
    // Dark doorway recess inside the arch.
    group.add(box(0.1, 3.0, 1.8, matStore, facadeX + fnorm * 0.28, 1.6, b.z, false));
    // Glowing threshold strip on the ground at the entrance.
    group.add(box(1.4, 0.05, 1.8, trim, facadeX + fnorm * 1.0, 0.06, b.z, false));

    // --- Movie-style POSTERS flanking the entrance (artPanel) ---------------
    const posterDefs = [
      { z: b.z - 4.0, top: "GALAXY", glyph: "★", bg: "#101030", ink: "#46d6ff", accent: "#ff3fae" },
      { z: b.z + 4.0, top: "RAIDERS", glyph: "▲", bg: "#1c0e22", ink: "#ffd23f", accent: "#27e0ff" },
    ];
    for (let p = 0; p < posterDefs.length; p++) {
      const pd = posterDefs[p];
      const poster = artPanel(1.7, 2.6, "poster", {
        top: pd.top, glyph: pd.glyph, bg: pd.bg, ink: pd.ink, accent: pd.accent,
        bottom: "TONIGHT", emissiveIntensity: 0.35,
        file: `arcade-poster-${i}-${p}.png`,
      });
      poster.position.set(facadeX + fnorm * 0.42, 1.9, pd.z);
      poster.rotation.y = fnorm > 0 ? Math.PI / 2 : -Math.PI / 2;
      poster.castShadow = false;
      group.add(poster);
      // poster frame
      group.add(box(0.1, 2.8, 1.9, matMetal, facadeX + fnorm * 0.36, 1.9, pd.z, false));
    }

    // --- Upper-floor window GRID (queued for InstancedMesh) -----------------
    // Lit windows on the avenue-facing face above the marquee.
    const winBottom = marqY + 1.4;
    const rows = Math.floor((h - 1.6 - winBottom) / 1.6);
    for (let r = 0; r < rows; r++) {
      const wy = winBottom + 0.8 + r * 1.6;
      for (let k = -1; k <= 1; k++) {
        const wz = b.z + k * 3.0;
        winPlacements.push({ x: facadeX + fnorm * 0.18, y: wy, z: wz, ry: Math.PI / 2, w: 1.2, h: 0.9 });
      }
    }
    // A couple of windows on the side faces for believability.
    // These sit on the -Z wall (which faces along Z). The front windows above
    // use ry=PI/2 to face the X-aligned avenue; ry=0 here turns the broad pane
    // face toward ±Z so they read flat against the side wall (not edge-on).
    for (let r = 0; r < rows; r++) {
      const wy = winBottom + 0.8 + r * 1.6;
      const sideZ = b.z - b.d / 2 - 0.05; // -Z face
      winPlacements.push({ x: b.x - 2.5, y: wy, z: sideZ, ry: 0, w: 1.2, h: 0.9 });
      winPlacements.push({ x: b.x + 2.5, y: wy, z: sideZ, ry: 0, w: 1.2, h: 0.9 });
    }

    // --- ROOFTOP neon + clutter --------------------------------------------
    const roofY = h;
    // Rooftop neon sign tube (tall vertical letters-bar) on the back edge.
    const ntube = box(0.25, 3.2, 0.25, trim, b.x - fnorm * 4.0, roofY + 1.6, b.z - 4.0, false);
    group.add(ntube);
    group.add(box(2.4, 0.22, 0.22, trim, b.x - fnorm * 4.0, roofY + 3.0, b.z - 4.0, false)); // crossbar
    // Parapet rail around the roof edge (thin emissive ring of 4 bars).
    group.add(box(b.w, 0.12, 0.15, matTrimGold, b.x, roofY + 0.5, b.z - b.d / 2 + 0.1, false));
    group.add(box(b.w, 0.12, 0.15, matTrimGold, b.x, roofY + 0.5, b.z + b.d / 2 - 0.1, false));
    group.add(box(0.15, 0.12, b.d, matTrimGold, b.x - b.w / 2 + 0.1, roofY + 0.5, b.z, false));
    group.add(box(0.15, 0.12, b.d, matTrimGold, b.x + b.w / 2 - 0.1, roofY + 0.5, b.z, false));
    // AC units + vents.
    group.add(box(1.6, 0.9, 1.6, matRoof, b.x + 2.5, roofY + 0.45, b.z + 2.5));
    group.add(box(1.2, 0.7, 1.2, matRoof, b.x - 2.5, roofY + 0.35, b.z + 3.0));
    group.add(cyl(0.4, 1.0, matMetal, b.x + 3.5, roofY + 0.5, b.z - 2.5)); // vent pipe
    group.add(cyl(0.5, 0.3, matMetal, b.x + 3.5, roofY + 1.1, b.z - 2.5, false)); // vent cap
    // Water tank on a small frame.
    group.add(cyl(0.9, 1.4, matRoof, b.x - 3.2, roofY + 1.2, b.z - 2.8));
    group.add(cyl(1.0, 0.25, matMetal, b.x - 3.2, roofY + 2.0, b.z - 2.8, false)); // tank cap
    // Antenna mast with a glowing tip.
    group.add(cyl(0.07, 3.0, matMetal, b.x, roofY + 1.5, b.z + 1.5));
    const antTip = new THREE.Mesh(SPHERE, trim);
    antTip.scale.set(0.4, 0.4, 0.4);
    antTip.position.set(b.x, roofY + 3.0, b.z + 1.5);
    antTip.castShadow = false;
    group.add(antTip);

    colliders.push({
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    });
  });
  neonMats.push(matTrim);

  // --- Bake all upper-floor windows into ONE InstancedMesh ------------------
  // Shared geometry (WINDOW_GEO) + shared material (matWindow). Each instance is
  // a thin lit pane scaled/oriented to its facade. No per-window geo/material.
  if (winPlacements.length) {
    const winMesh = new THREE.InstancedMesh(WINDOW_GEO, matWindow, winPlacements.length);
    winMesh.castShadow = false;
    winMesh.receiveShadow = false;
    for (let n = 0; n < winPlacements.length; n++) {
      const p = winPlacements[n];
      _pos.set(p.x, p.y, p.z);
      _quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
      // thin pane: depth 0.12 toward wall normal; before rotation it's along X.
      _scl.set(0.12, p.h, p.w);
      _m4.compose(_pos, _quat, _scl);
      winMesh.setMatrixAt(n, _m4);
    }
    winMesh.instanceMatrix.needsUpdate = true;
    group.add(winMesh);
  }

  // --- TICKET BOOTHS at the front corner of each building row ---------------
  // Placed at X = ±9.5 (clear of the X∈[-6,6] avenue) near the plaza-side end.
  function ticketBooth(x, z, faceX) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    // booth body
    g.add(box(1.8, 2.6, 1.8, matStore, 0, 1.3, 0));
    // glowing ticket window
    g.add(box(0.1, 1.0, 1.2, matGlass, faceX * 0.95, 1.5, 0, false));
    // little canopy roof
    g.add(box(2.4, 0.25, 2.4, matMetal, 0, 2.7, 0, false));
    // neon "TICKETS" stripe band under the canopy
    const band = box(0.12, 0.4, 1.6, matTrimGold, faceX * 0.93, 2.2, 0, false);
    g.add(band);
    return g;
  }
  const boothSpots = [
    { x: -9.5, z: -11.5, faceX: 1 },
    { x: 9.5, z: 11.5, faceX: -1 },
  ];
  for (const s of boothSpots) {
    group.add(ticketBooth(s.x, s.z, s.faceX));
    colliders.push({ minX: s.x - 1.0, maxX: s.x + 1.0, minZ: s.z - 1.0, maxZ: s.z + 1.0 });
  }

  // --- Big neon signs mounted on the buildings ------------------------------
  // "ARCADE" over the front-left building, facing the avenue (+X normal).
  const arcadeSign = artPanel(7, 4, "neon", {
    lines: ["ARCADE"], color: "#ff4fa3", color2: "#4fd2ff",
    emissiveIntensity: 0.9, file: "arcade-neon-arcade.png",
  });
  arcadeSign.position.set(-7.05, 7, -18);
  arcadeSign.rotation.y = Math.PI / 2; // face +X (toward avenue)
  arcadeSign.castShadow = false;
  group.add(arcadeSign);
  neonMats.push(arcadeSign.material);

  // "PLAY" over the front-right building, facing the avenue (-X normal).
  const playSign = artPanel(6, 4, "neon", {
    lines: ["PLAY"], color: "#4fd2ff", color2: "#ff4fa3",
    emissiveIntensity: 0.9, file: "arcade-neon-play.png",
  });
  playSign.position.set(7.05, 7, 18);
  playSign.rotation.y = -Math.PI / 2; // face -X (toward avenue)
  playSign.castShadow = false;
  group.add(playSign);
  neonMats.push(playSign.material);

  // Second "ARCADE" / "PLAY" pair on the back buildings for symmetry.
  const arcade2 = artPanel(6, 3.5, "neon", {
    lines: ["ARCADE"], color: "#ffd23f", color2: "#ff4fa3",
    emissiveIntensity: 0.9, file: "arcade-neon-arcade2.png",
  });
  arcade2.position.set(7.05, 7, -18);
  arcade2.rotation.y = -Math.PI / 2;
  arcade2.castShadow = false;
  group.add(arcade2);
  neonMats.push(arcade2.material);

  const play2 = artPanel(6, 3.5, "neon", {
    lines: ["PLAY"], color: "#9fff4f", color2: "#4fd2ff",
    emissiveIntensity: 0.9, file: "arcade-neon-play2.png",
  });
  play2.position.set(-7.05, 7, 18);
  play2.rotation.y = Math.PI / 2;
  play2.castShadow = false;
  group.add(play2);
  neonMats.push(play2.material);

  // --- Billboard: "PLAY AT THE CAFE" on a frame at the back of the tile -----
  const billboard = artPanel(14, 7, "billboard", {
    title: "PLAY AT THE CAFE", sub: "13 GAMES",
    a: "#3a1f6b", b: "#0c0830", accent: "#ff4fae", glyph: "▶",
    emissiveIntensity: 0.5, file: "arcade-billboard.png",
  });
  billboard.position.set(0, 9, -27.6);
  billboard.castShadow = false;
  group.add(billboard);
  // Two support legs for the billboard frame.
  group.add(cyl(0.35, 9, matMetal, -5.5, 4.5, -28.4));
  group.add(cyl(0.35, 9, matMetal, 5.5, 4.5, -28.4));
  colliders.push({ minX: -6, maxX: 6, minZ: -28.8, maxZ: -28 });

  // --- Tall arcade cabinets along the curbs (standalone props) --------------
  // Placed beyond X = ±8 so they don't pinch the avenue. Reuse geometry/mats.
  function cabinet(x, z, rotY) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    // body
    g.add(box(1.6, 3.6, 1.2, matCabinet, 0, 1.8, 0));
    // angled screen panel (glowing)
    g.add(box(1.3, 1.1, 0.1, matScreen, 0, 2.5, 0.62, false));
    // marquee header (neon)
    const marquee = (Math.abs(x) > 11) ? matTrim : matTrimCyan;
    g.add(box(1.5, 0.5, 0.4, marquee, 0, 3.45, 0.45, false));
    // control deck (single glowing strip — buttons read as part of the panel)
    g.add(box(1.5, 0.25, 0.7, matButton, 0, 1.7, 0.6, false));
    // side neon accent stripes
    g.add(box(0.06, 3.4, 0.06, matTrimCyan, 0.82, 1.8, 0.5, false));
    g.add(box(0.06, 3.4, 0.06, matTrimCyan, -0.82, 1.8, 0.5, false));
    return g;
  }
  // Original 4 cabinets + more lined along both curbs (all beyond X=±8).
  const cabSpots = [
    [-8.5, -26, Math.PI], [-8.5, 26, Math.PI],
    [8.5, -26, 0], [8.5, 26, 0],
    [-8.5, -10, Math.PI], [-8.5, 10, Math.PI],
    [8.5, -10, 0], [8.5, 10, 0],
    [-8.5, -2, Math.PI], [8.5, 2, 0],
  ];
  for (const [x, z, r] of cabSpots) {
    group.add(cabinet(x, z, r));
    colliders.push({ minX: x - 1, maxX: x + 1, minZ: z - 0.9, maxZ: z + 0.9 });
  }

  // --- Giant joystick sculpture: centerpiece at the plaza -------------------
  const joy = new THREE.Group();
  joy.position.set(0, 0, 0);
  // round base
  joy.add(cyl(2.2, 0.6, matMetal, 0, 0.3, 0));
  joy.add(cyl(1.6, 0.4, matCabinet, 0, 0.8, 0));
  // shaft (the part that "wobbles" via rotation)
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, 1.0, 0);
  const shaft = cyl(0.35, 5, matStick, 0, 2.5, 0);
  stickPivot.add(shaft);
  // big red ball-top knob
  const knob = new THREE.Mesh(SPHERE, matKnob);
  knob.scale.set(2.6, 2.6, 2.6);
  knob.position.set(0, 5.2, 0);
  knob.castShadow = true;
  stickPivot.add(knob);
  joy.add(stickPivot);
  // four glowing arcade buttons around the base
  const btnPos = [[1.4, 0, 0], [-1.4, 0, 0], [0, 0, 1.4], [0, 0, -1.4]];
  for (const [bx, , bz] of btnPos) {
    joy.add(cyl(0.4, 0.3, matButton, bx, 1.05, bz, false));
  }
  group.add(joy);
  neonMats.push(matKnob, matButton, matScreen, matTrimGold, matWindow);
  colliders.push({ minX: -2.4, maxX: 2.4, minZ: -2.4, maxZ: 2.4 });

  // --- Neon perimeter poles (decorative pylons at corners) ------------------
  const poleSpots = [
    [-27, -27], [27, -27], [-27, 27], [27, 27],
  ];
  for (const [x, z] of poleSpots) {
    group.add(cyl(0.3, 7, matPole, x, 3.5, z));
    const cap = new THREE.Mesh(SPHERE, (x < 0 ? matTrim : matTrimCyan));
    cap.scale.set(1.2, 1.2, 1.2);
    cap.position.set(x, 7.3, z);
    cap.castShadow = false;
    group.add(cap);
    colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 });
  }

  // --- Base emissive intensities captured for flicker math ------------------
  const baseIntensity = neonMats.map((m) => m.emissiveIntensity);

  // --- Animation: flicker neon + wobble the joystick sculpture --------------
  let t = 0;
  function update(dt) {
    t += dt;
    // Flicker: each neon mat pulses at its own phase; occasional dropouts.
    for (let i = 0; i < neonMats.length; i++) {
      const base = baseIntensity[i];
      const phase = i * 1.3;
      const flick = 0.85 + 0.15 * Math.sin(t * 9 + phase);
      // rare dip to mimic a failing tube
      const dip = (Math.sin(t * 2.3 + phase) > 0.96) ? 0.45 : 1.0;
      neonMats[i].emissiveIntensity = base * flick * dip;
    }
    // Joystick sculpture sways gently like it's being pushed around.
    stickPivot.rotation.z = Math.sin(t * 1.1) * 0.18;
    stickPivot.rotation.x = Math.cos(t * 0.8) * 0.14;
  }

  return { group, colliders, ground, update };
}
