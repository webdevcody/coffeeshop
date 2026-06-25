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

// --- Enterable shop (retro arcade lounge) materials ------------------------
const matShopWall = new THREE.MeshStandardMaterial({ color: "#241a3e", roughness: 0.85, flatShading: true });
const matShopFloor = new THREE.MeshStandardMaterial({ color: "#161024", roughness: 0.9 });
const matShopRoof = new THREE.MeshStandardMaterial({ color: "#0f0a1c", roughness: 0.9 });
const matCounter = new THREE.MeshStandardMaterial({ color: "#2a1640", roughness: 0.6, metalness: 0.15 });
const matCounterTop = new THREE.MeshStandardMaterial({
  color: "#1a2a3a", emissive: "#1f6f8c", emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.3,
});
const matShelf = new THREE.MeshStandardMaterial({ color: "#1d1530", roughness: 0.75 });
const matRug = new THREE.MeshStandardMaterial({ color: "#3a124a", roughness: 0.95 });
const matStool = new THREE.MeshStandardMaterial({ color: "#c2103f", roughness: 0.5, metalness: 0.2 });
const matStoolLeg = new THREE.MeshStandardMaterial({ color: "#22202c", roughness: 0.5, metalness: 0.7 });
const matLampShade = new THREE.MeshStandardMaterial({
  color: "#ffd277", emissive: "#ffb733", emissiveIntensity: 0.85, roughness: 0.4,
});
// Small colourful goods sit on the shelves as InstancedMesh (one shared mat).
const matGoods = new THREE.MeshStandardMaterial({
  color: "#46d6ff", emissive: "#2f9fc4", emissiveIntensity: 0.35, roughness: 0.5,
});

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
  // Each building is a SUBSTANTIAL full-volume mass (real width AND depth AND
  // height) that fills its quadrant of the plot — never a thin facade. The
  // avenue-facing wall is at X = ±7 (the lane X∈[-6,6] + curbs stay clear); the
  // mass runs deep (14 m) toward the tile edge so it reads solid from the back
  // too, and an attached ANNEX wing toward the tile edge gives each block a
  // stepped multi-volume silhouette. Centers/depths are chosen so the four
  // blocks nearly tile each side of the avenue, leaving only the plaza cross
  // lane (Z∈[-6,6]) and the wide sidewalks open.
  const buildMats = [matBuildA, matBuildB];
  // w = depth along the AVENUE wall's tangent is `d` (Z extent); `w` is the X
  // extent (how far the mass reaches back from the avenue). facadeX = b.x +
  // facing*(w/2) is the avenue wall. Annex sits on the tile-edge side (away from
  // the avenue), lower/taller for stepped massing.
  // SETBACK: a ROAD GRID runs on the tile seams (tile edge = ±30); a road + kerb
  // + sidewalk covers the outer ~7 m of every tile edge. So every building mass
  // AND its annex must stay within LOCAL X,Z in [-23, 23] to clear the street.
  // Centers/depths below are pulled inward (mains z=±16 d=14 => Z∈[±9,±23];
  // annexes outer edge at ±22.7) so nothing reaches past ±23 while the avenue
  // wall stays at X=±7 and the plaza cross lane (Z∈[-9,9]) stays open.
  const buildSpots = [
    // Left row (faces +X toward avenue). Avenue wall at x=-7 => b.x = -7 - w/2.
    { x: -14, z: -16, w: 14, d: 14, facing: 1,
      annex: { dx: -6.7, dz: 0, w: 4, d: 10, h: 13 } },   // main X[-21,-7] Z[-23,-9]; annex X[-22.7,-18.7]
    { x: -14, z: 16, w: 14, d: 14, facing: 1,
      annex: { dx: -6.7, dz: 0, w: 4, d: 10, h: 7 } },    // main X[-21,-7] Z[9,23]; annex X[-22.7,-18.7]
    // Right row (faces -X toward avenue). Avenue wall at x=7 => b.x = 7 + w/2.
    { x: 14, z: -16, w: 14, d: 14, facing: -1,
      annex: { dx: 6.7, dz: 0, w: 4, d: 10, h: 7 } },     // main X[7,21] Z[-23,-9]; annex X[18.7,22.7]
    { x: 14, z: 16, w: 14, d: 14, facing: -1,
      annex: { dx: 6.7, dz: 0, w: 4, d: 10, h: 13 } },    // main X[7,21] Z[9,23]; annex X[18.7,22.7]
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

    // Main mass — a full WxDxH volume that reads solid from every side.
    group.add(box(b.w, h, b.d, mat, b.x, h / 2, b.z));

    // --- ANNEX wing: a second stacked volume toward the tile edge -----------
    // Gives the block a stepped multi-volume silhouette (taller or shorter than
    // the main mass) and pushes real building DEPTH back across the plot, so the
    // structure never reads as a single slab. Footprint folded into the
    // building's collider below.
    const an = b.annex;
    const anX = b.x + an.dx;
    const anZ = b.z + an.dz;
    group.add(box(an.w, an.h, an.d, buildMats[(i + 1) % 2], anX, an.h / 2, anZ));
    // A glowing trim band capping the annex parapet.
    group.add(box(an.w + 0.2, 0.35, an.d + 0.2, trim, anX, an.h - 0.5, anZ, false));
    // Where the annex is TALLER than the main mass it forms a back tower with a
    // rooftop neon blade; where shorter it forms a setback terrace. Either way a
    // small vent box sits on its roof for clutter.
    group.add(box(1.2, 0.7, 1.2, matRoof, anX, an.h + 0.35, anZ, true));
    if (an.h > h) {
      const blade = box(0.25, 2.6, 0.25, trim, anX, an.h + 1.3, anZ - 0.0, false);
      group.add(blade);
    }
    // Lit windows on the annex's tile-edge-facing wall (so the BACK reads solid).
    {
      const anEdgeX = anX + b.facing * (-an.w / 2) - b.facing * 0.06; // outward (away from avenue) X wall
      const anRows = Math.max(1, Math.floor((an.h - 2.5) / 1.6));
      for (let r = 0; r < anRows; r++) {
        const wy = 2.0 + r * 1.6;
        for (let k = -1; k <= 1; k++) {
          winPlacements.push({ x: anEdgeX, y: wy, z: anZ + k * 2.6, ry: 0, w: 1.0, h: 0.9 });
        }
      }
    }

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
    // Glowing threshold strip on the ground at the entrance. Kept on the
    // sidewalk: with the facade at X=±7 and the curb at X=±6.25, a strip
    // centered at facadeX+fnorm*0.35 (=±6.65) with width 0.8 spans only out to
    // ±6.25, so it never juts into the drivable lane (X in [-6,6]).
    group.add(box(0.8, 0.05, 1.8, trim, facadeX + fnorm * 0.35, 0.06, b.z, false));

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
    // Lit windows on the avenue-facing face above the marquee. The instanced
    // pane is thin along X by default (scale 0.12 in X => its broad faces face
    // ±X), so the FRONT facade (which faces the X-aligned avenue) wants ry=0 and
    // a SIDE wall (which faces ±Z) wants ry=PI/2 to lie flat. (These were
    // previously swapped, making every pane read edge-on.)
    const winBottom = marqY + 1.4;
    const rows = Math.floor((h - 1.6 - winBottom) / 1.6);
    for (let r = 0; r < rows; r++) {
      const wy = winBottom + 0.8 + r * 1.6;
      for (let k = -1; k <= 1; k++) {
        const wz = b.z + k * 3.0;
        // Front pane sits just proud of the avenue-facing wall, normal along ±X.
        winPlacements.push({ x: facadeX + fnorm * 0.18, y: wy, z: wz, ry: 0, w: 1.2, h: 0.9 });
      }
    }
    // Windows on BOTH Z side walls so the mass reads solid from front, side AND
    // back angles (not just the avenue facade). Panes on a ±Z wall need ry=PI/2.
    for (let r = 0; r < rows; r++) {
      const wy = winBottom + 0.8 + r * 1.6;
      const zN = b.z - b.d / 2 - 0.05; // -Z wall
      const zP = b.z + b.d / 2 + 0.05; // +Z wall
      for (const wx of [b.x - 3.5, b.x, b.x + 3.5]) {
        winPlacements.push({ x: wx, y: wy, z: zN, ry: Math.PI / 2, w: 1.2, h: 0.9 });
        winPlacements.push({ x: wx, y: wy, z: zP, ry: Math.PI / 2, w: 1.2, h: 0.9 });
      }
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

    // Collider = merged AABB of the main mass AND its annex wing, so the solid
    // footprint matches the full enlarged building.
    {
      const anX2 = b.x + an.dx, anZ2 = b.z + an.dz;
      colliders.push({
        minX: Math.min(b.x - b.w / 2, anX2 - an.w / 2),
        maxX: Math.max(b.x + b.w / 2, anX2 + an.w / 2),
        minZ: Math.min(b.z - b.d / 2, anZ2 - an.d / 2),
        maxZ: Math.max(b.z + b.d / 2, anZ2 + an.d / 2),
      });
    }
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
  // Sit in the open plaza band. After the setback the building masses occupy
  // Z∈[9,23] and Z∈[-23,-9], so the open band is Z∈[-9,9]; the cross lane is
  // Z∈[-6,6]. z=±7.5 (collider Z∈[±6.5,±8.5]) clears both the cross lane and the
  // building masses. X=±9.5 stays clear of the avenue (X∈[-6,6]).
  const boothSpots = [
    { x: -9.5, z: -7.5, faceX: 1 },
    { x: 9.5, z: 7.5, faceX: -1 },
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
  arcadeSign.position.set(-6.94, 7, -16); // on the pulled-in front-left building
  arcadeSign.rotation.y = Math.PI / 2; // face +X (toward avenue)
  arcadeSign.castShadow = false;
  group.add(arcadeSign);
  neonMats.push(arcadeSign.material);

  // "PLAY" over the front-right building, facing the avenue (-X normal).
  const playSign = artPanel(6, 4, "neon", {
    lines: ["PLAY"], color: "#4fd2ff", color2: "#ff4fa3",
    emissiveIntensity: 0.9, file: "arcade-neon-play.png",
  });
  playSign.position.set(6.94, 7, 16); // on the pulled-in back-right building
  playSign.rotation.y = -Math.PI / 2; // face -X (toward avenue)
  playSign.castShadow = false;
  group.add(playSign);
  neonMats.push(playSign.material);

  // Second "ARCADE" / "PLAY" pair on the back buildings for symmetry.
  const arcade2 = artPanel(6, 3.5, "neon", {
    lines: ["ARCADE"], color: "#ffd23f", color2: "#ff4fa3",
    emissiveIntensity: 0.9, file: "arcade-neon-arcade2.png",
  });
  arcade2.position.set(6.94, 7, -16); // on the pulled-in front-right building
  arcade2.rotation.y = -Math.PI / 2;
  arcade2.castShadow = false;
  group.add(arcade2);
  neonMats.push(arcade2.material);

  const play2 = artPanel(6, 3.5, "neon", {
    lines: ["PLAY"], color: "#9fff4f", color2: "#4fd2ff",
    emissiveIntensity: 0.9, file: "arcade-neon-play2.png",
  });
  play2.position.set(-6.94, 7, 16); // on the pulled-in back-left building
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
  // Pulled in to z=-22.6 so the billboard + its legs/collider clear the seam road
  // grid on the back tile edge. Panel still faces +Z toward the plaza interior so
  // "PLAY AT THE CAFE" reads un-mirrored from the avenue.
  billboard.position.set(0, 9, -22.6);
  billboard.castShadow = false;
  group.add(billboard);
  // Two support legs for the billboard frame.
  group.add(cyl(0.35, 9, matMetal, -5.5, 4.5, -23.0));
  group.add(cyl(0.35, 9, matMetal, 5.5, 4.5, -23.0));
  colliders.push({ minX: -6, maxX: 6, minZ: -23.0, maxZ: -22.3 });

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
  // Cabinets line the OPEN plaza band on both sides of the avenue. After the
  // setback the building masses occupy Z∈[9,23] and Z∈[-23,-9], so cabinets must
  // stay at |z| <= 8 (also clears the cross lane at |z|=6). They face the avenue
  // (rotY toward ∓X) at X=±8.5/±11.5 (clear of the avenue X∈[-6,6]). Booths sit
  // at (∓9.5, ∓7.5); every cabinet keeps >=1.8 m from them.
  const cabSpots = [
    // inner row at X=±8.5 (left booth at (-9.5,-7.5), right booth at (9.5,7.5))
    [-8.5, 7.5, Math.PI], [-8.5, 0, Math.PI], [-8.5, 3.5, Math.PI],
    [8.5, -7.5, 0], [8.5, 0, 0], [8.5, -3.5, 0],
    // outer row at X=±11.5, further from the avenue
    [-11.5, -4, Math.PI], [-11.5, 4, Math.PI],
    [11.5, 4, 0], [11.5, -4, 0],
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
  // Pulled in to ±22.5 so they sit inside the setback and clear the corner road
  // seams instead of standing in the street.
  const poleSpots = [
    [-22.5, -22.5], [22.5, -22.5], [-22.5, 22.5], [22.5, 22.5],
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

  // --- ENTERABLE SHOP: "GAME ON" retro arcade lounge -----------------------
  // A real, walk-in room tucked into the open right-front pocket (clear of the
  // avenue X∈[-6,6], the cabinets at X=±8.5/±11.5, and the right-front building
  // mass at X≥7,Z≤-9). Outer footprint X∈[13,21], Z∈[-8.5,-1.5] (8 m wide x 7 m
  // deep). The STREET-FACING wall is the -X wall (faces the avenue); it has a
  // 2.2 m doorway GAP centered at Z=-5 with NO collider, so the player walks in.
  {
    const sCx = 17, sCz = -5;          // shop center
    const sW = 8, sD = 7;              // outer extents (X width, Z depth)
    const T = 0.25;                    // wall thickness
    const wallH = 3.2;                 // wall/ceiling height
    const doorW = 2.2;                 // doorway gap width
    const minX = sCx - sW / 2, maxX = sCx + sW / 2; // 13..21
    const minZ = sCz - sD / 2, maxZ = sCz + sD / 2; // -8.5..-1.5
    const frontX = minX + T / 2;       // -X (street-facing) wall centerline
    const backX = maxX - T / 2;        // +X (back) wall centerline
    const sideZn = minZ + T / 2;       // -Z side wall centerline
    const sideZp = maxZ - T / 2;       // +Z side wall centerline
    const gapMinZ = sCz - doorW / 2;   // doorway gap Z span
    const gapMaxZ = sCz + doorW / 2;

    const shop = new THREE.Group();

    // Floor slab + a cozy rug on top.
    shop.add(box(sW, 0.08, sD, matShopFloor, sCx, 0.04, sCz, false));
    const rug = box(4.6, 0.04, 3.4, matRug, sCx + 0.4, 0.1, sCz, false);
    rug.castShadow = false;
    shop.add(rug);

    // Flat roof / ceiling.
    shop.add(box(sW, 0.2, sD, matShopRoof, sCx, wallH + 0.1, sCz, false));

    // --- Walls (individual boxes; colliders added to the array below) -------
    // Back wall (+X), full Z span.
    shop.add(box(T, wallH, sD, matShopWall, backX, wallH / 2, sCz));
    // Side walls (±Z), full X span.
    shop.add(box(sW, wallH, T, matShopWall, sCx, wallH / 2, sideZn));
    shop.add(box(sW, wallH, T, matShopWall, sCx, wallH / 2, sideZp));
    // Front wall (-X, street-facing) split into two segments flanking the door.
    const segAlen = gapMinZ - minZ;    // segment toward -Z
    const segBlen = maxZ - gapMaxZ;    // segment toward +Z
    shop.add(box(T, wallH, segAlen, matShopWall, frontX, wallH / 2, (minZ + gapMinZ) / 2));
    shop.add(box(T, wallH, segBlen, matShopWall, frontX, wallH / 2, (gapMaxZ + maxZ) / 2));
    // A lintel beam above the doorway (visual only — spans the gap up high so it
    // never blocks walking; no collider). Sits at the top of the opening.
    shop.add(box(T, 0.5, doorW + 0.1, matShopWall, frontX, wallH - 0.25, sCz, false));
    // Glowing threshold strip on the floor at the doorway (inviting).
    const thr = box(0.5, 0.04, doorW, matTrimCyan, frontX + 0.3, 0.06, sCz, false);
    thr.castShadow = false;
    shop.add(thr);

    // WALL COLLIDERS — back + two sides + two front segments. NONE across the
    // doorway gap (Z∈[gapMinZ,gapMaxZ] at the front wall stays open).
    colliders.push({ minX: backX - T / 2, maxX: backX + T / 2, minZ, maxZ });            // back
    colliders.push({ minX, maxX, minZ: sideZn - T / 2, maxZ: sideZn + T / 2 });          // -Z side
    colliders.push({ minX, maxX, minZ: sideZp - T / 2, maxZ: sideZp + T / 2 });          // +Z side
    colliders.push({ minX: frontX - T / 2, maxX: frontX + T / 2, minZ, maxZ: gapMinZ }); // front seg A
    colliders.push({ minX: frontX - T / 2, maxX: frontX + T / 2, minZ: gapMaxZ, maxZ }); // front seg B

    // --- Service COUNTER along the back wall --------------------------------
    const ctrZ = sCz;
    const ctrX = backX - 0.7;
    shop.add(box(1.0, 1.05, 4.2, matCounter, ctrX, 0.55, ctrZ));          // counter body
    shop.add(box(1.2, 0.12, 4.4, matCounterTop, ctrX, 1.15, ctrZ, false)); // glowing top
    // A small register / display box on the counter.
    shop.add(box(0.5, 0.45, 0.6, matCabinet, ctrX, 1.42, ctrZ - 1.2, false));
    shop.add(box(0.42, 0.3, 0.08, matScreen, ctrX - 0.3, 1.5, ctrZ - 1.2, false));

    // --- SHELVES on the +Z side wall, stocked with little goods -------------
    const shelfX = sCx + 0.6;
    const shelfZ = sideZp - 0.25;
    const goods = []; // queued for an InstancedMesh
    const goodTints = [
      new THREE.Color("#ff4fa3"), new THREE.Color("#46d6ff"),
      new THREE.Color("#ffd23f"), new THREE.Color("#9fff4f"),
    ];
    for (let r = 0; r < 3; r++) {
      const sy = 0.9 + r * 0.85;
      shop.add(box(2.6, 0.08, 0.5, matShelf, shelfX, sy, shelfZ, false)); // shelf board
      for (let k = -2; k <= 2; k++) {
        goods.push({ x: shelfX + k * 0.5, y: sy + 0.22, z: shelfZ, tint: goodTints[(r + k + 8) % goodTints.length] });
      }
    }
    if (goods.length) {
      const gGeo = new THREE.BoxGeometry(0.3, 0.36, 0.28);
      const gMesh = new THREE.InstancedMesh(gGeo, matGoods, goods.length);
      gMesh.castShadow = false; gMesh.receiveShadow = false;
      for (let n = 0; n < goods.length; n++) {
        const g = goods[n];
        _pos.set(g.x, g.y, g.z);
        _quat.identity();
        _scl.set(1, 1, 1);
        _m4.compose(_pos, _quat, _scl);
        gMesh.setMatrixAt(n, _m4);
        gMesh.setColorAt(n, g.tint);
      }
      gMesh.instanceMatrix.needsUpdate = true;
      if (gMesh.instanceColor) gMesh.instanceColor.needsUpdate = true;
      shop.add(gMesh);
    }

    // --- DISPLAY RACK / glass case on the -Z side wall ----------------------
    const caseX = sCx - 0.4;
    const caseZ = sideZn + 0.35;
    shop.add(box(2.4, 1.3, 0.5, matCabinet, caseX, 0.65, caseZ));           // case body
    shop.add(box(2.2, 0.9, 0.45, matGlass, caseX, 0.75, caseZ + 0.04, false)); // lit glass front
    shop.add(box(2.4, 0.1, 0.55, matCounterTop, caseX, 1.32, caseZ, false));    // glowing cap

    // --- A couple of STOOLS in front of the counter -------------------------
    const stoolGeoR = 0.32;
    for (const sz of [ctrZ - 1.0, ctrZ + 1.0]) {
      const sx = ctrX - 1.6;
      shop.add(cyl(stoolGeoR, 0.12, matStool, sx, 0.74, sz));      // seat
      shop.add(cyl(0.06, 0.7, matStoolLeg, sx, 0.37, sz));         // pedestal
    }

    // --- Interior wall SIGNAGE (artPanel) on the back wall ------------------
    const wallSign = artPanel(2.6, 1.0, "sign", {
      text: "HIGH SCORE", bg: "#1a0e2e", fg: "#46d6ff",
      emissiveIntensity: 0.55, file: "arcade-shop-wall-highscore.png",
    });
    wallSign.position.set(backX - 0.13, 2.4, sCz + 1.6);
    wallSign.rotation.y = -Math.PI / 2; // face -X (into the room)
    wallSign.castShadow = false;
    shop.add(wallSign);
    neonMats.push(wallSign.material);

    // --- Hanging interior LIGHTS (two pendant lamps) ------------------------
    for (const lz of [sCz - 1.6, sCz + 1.6]) {
      const lx = sCx - 0.6;
      shop.add(cyl(0.02, 0.7, matStoolLeg, lx, wallH - 0.45, lz, false)); // cord
      const shade = new THREE.Mesh(SPHERE, matLampShade);
      shade.scale.set(0.5, 0.45, 0.5);
      shade.position.set(lx, wallH - 0.85, lz);
      shade.castShadow = false;
      shop.add(shade);
    }
    neonMats.push(matLampShade, matCounterTop, matGoods);

    // --- Exterior SHOP SIGN above the door, facing the street (un-mirrored) --
    // The street is toward -X. artPanel faces +Z by default; rotate so its front
    // faces -X (toward the avenue). At rotation.y = -PI/2 the panel's +Z front
    // points to -X and the text reads correctly from the avenue.
    const shopSign = artPanel(4.4, 1.4, "sign", {
      text: "GAME ON", bg: "#5f0f40", fg: "#ffd23f",
      emissiveIntensity: 0.6, file: "arcade-shop-sign-gameon.png",
    });
    shopSign.position.set(frontX - 0.16, wallH + 0.55, sCz);
    shopSign.rotation.y = -Math.PI / 2; // front faces -X (the avenue/street)
    shopSign.castShadow = false;
    shop.add(shopSign);
    neonMats.push(shopSign.material);
    // A glowing sign bracket/backer behind it.
    shop.add(box(0.18, 1.7, 4.7, matMarquee, frontX - 0.05, wallH + 0.55, sCz, false));
    shop.add(box(0.2, 0.16, 4.8, matTrimGold, frontX - 0.06, wallH + 1.45, sCz, false));

    group.add(shop);
  }

  // --- MORE ENTERABLE SHOPS: reusable walk-in room builder -----------------
  // Mirrors the "GAME ON" construction above but parameterised so we can drop a
  // few more themed rooms into the open plaza pockets. Each shop is an 8x7 m
  // room whose street-facing wall (toward the avenue) carries a 2.2 m doorway
  // GAP with NO collider, so the player can walk straight in. `faceX` is the
  // sign of the direction toward the avenue (-1 for right-side shops whose door
  // faces -X, +1 for left-side shops whose door faces +X). All footprints sit
  // within local bounds [-23,23] and clear the curb (|X|=6.25), the cabinets
  // (|X|=8.5/11.5), the cross lane (Z∈[-6,6]) and the building masses.
  function enterableShop(opts) {
    const { sCx, sCz, faceX, sign, wallSign, accentMat, theme } = opts;
    const sW = 8, sD = 7;              // outer extents (X width, Z depth)
    const T = 0.25;                    // wall thickness
    const wallH = 3.2;                 // wall/ceiling height
    const doorW = 2.2;                 // doorway gap width
    const minX = sCx - sW / 2, maxX = sCx + sW / 2;
    const minZ = sCz - sD / 2, maxZ = sCz + sD / 2;
    // The door is on the wall that faces the avenue. faceX>0 => avenue is +X =>
    // door on the +X (maxX) wall; faceX<0 => door on the -X (minX) wall.
    const doorX = faceX > 0 ? maxX - T / 2 : minX + T / 2; // door-wall centerline
    const backWallX = faceX > 0 ? minX + T / 2 : maxX - T / 2; // opposite (back) wall
    const sideZn = minZ + T / 2;
    const sideZp = maxZ - T / 2;
    const gapMinZ = sCz - doorW / 2;
    const gapMaxZ = sCz + doorW / 2;

    const shop = new THREE.Group();

    // Floor + rug, flat roof.
    shop.add(box(sW, 0.08, sD, matShopFloor, sCx, 0.04, sCz, false));
    const rug = box(4.6, 0.04, 3.4, matRug, sCx, 0.1, sCz, false);
    rug.castShadow = false;
    shop.add(rug);
    shop.add(box(sW, 0.2, sD, matShopRoof, sCx, wallH + 0.1, sCz, false));

    // Walls: back (+/-X), both sides (±Z), and the door wall split into two
    // segments flanking the doorway gap.
    shop.add(box(T, wallH, sD, matShopWall, backWallX, wallH / 2, sCz));
    shop.add(box(sW, wallH, T, matShopWall, sCx, wallH / 2, sideZn));
    shop.add(box(sW, wallH, T, matShopWall, sCx, wallH / 2, sideZp));
    const segAlen = gapMinZ - minZ;
    const segBlen = maxZ - gapMaxZ;
    shop.add(box(T, wallH, segAlen, matShopWall, doorX, wallH / 2, (minZ + gapMinZ) / 2));
    shop.add(box(T, wallH, segBlen, matShopWall, doorX, wallH / 2, (gapMaxZ + maxZ) / 2));
    // Lintel above the doorway (visual only, no collider).
    shop.add(box(T, 0.5, doorW + 0.1, matShopWall, doorX, wallH - 0.25, sCz, false));
    // Glowing threshold strip, pulled just inside the door.
    const thr = box(0.5, 0.04, doorW, accentMat, doorX - faceX * 0.3, 0.06, sCz, false);
    thr.castShadow = false;
    shop.add(thr);

    // WALL COLLIDERS — back + both sides + two door-wall segments. NONE across
    // the doorway gap.
    colliders.push({ minX: backWallX - T / 2, maxX: backWallX + T / 2, minZ, maxZ });
    colliders.push({ minX, maxX, minZ: sideZn - T / 2, maxZ: sideZn + T / 2 });
    colliders.push({ minX, maxX, minZ: sideZp - T / 2, maxZ: sideZp + T / 2 });
    colliders.push({ minX: doorX - T / 2, maxX: doorX + T / 2, minZ, maxZ: gapMinZ });
    colliders.push({ minX: doorX - T / 2, maxX: doorX + T / 2, minZ: gapMaxZ, maxZ });

    // Service COUNTER along the back wall (runs along Z).
    const ctrX = backWallX - faceX * (-0.7); // 0.7 m inside the back wall
    shop.add(box(1.0, 1.05, 4.2, matCounter, ctrX, 0.55, sCz));
    shop.add(box(1.2, 0.12, 4.4, matCounterTop, ctrX, 1.15, sCz, false));
    // Register + tiny screen on the counter.
    shop.add(box(0.5, 0.45, 0.6, matCabinet, ctrX, 1.42, sCz - 1.2, false));
    shop.add(box(0.42, 0.3, 0.08, matScreen, ctrX + faceX * 0.3, 1.5, sCz - 1.2, false));

    // SHELVES on the +Z side wall, stocked with little goods (InstancedMesh).
    const shelfZ = sideZp - 0.25;
    const goods = [];
    const goodTints = [
      new THREE.Color(theme.t0), new THREE.Color(theme.t1),
      new THREE.Color(theme.t2), new THREE.Color(theme.t3),
    ];
    for (let r = 0; r < 3; r++) {
      const sy = 0.9 + r * 0.85;
      shop.add(box(2.6, 0.08, 0.5, matShelf, sCx, sy, shelfZ, false));
      for (let k = -2; k <= 2; k++) {
        goods.push({ x: sCx + k * 0.5, y: sy + 0.22, z: shelfZ, tint: goodTints[(r + k + 8) % goodTints.length] });
      }
    }
    if (goods.length) {
      const gGeo = new THREE.BoxGeometry(0.3, 0.36, 0.28);
      const gMesh = new THREE.InstancedMesh(gGeo, matGoods, goods.length);
      gMesh.castShadow = false; gMesh.receiveShadow = false;
      for (let n = 0; n < goods.length; n++) {
        const g = goods[n];
        _pos.set(g.x, g.y, g.z);
        _quat.identity();
        _scl.set(1, 1, 1);
        _m4.compose(_pos, _quat, _scl);
        gMesh.setMatrixAt(n, _m4);
        gMesh.setColorAt(n, g.tint);
      }
      gMesh.instanceMatrix.needsUpdate = true;
      if (gMesh.instanceColor) gMesh.instanceColor.needsUpdate = true;
      shop.add(gMesh);
    }

    // DISPLAY CASE on the -Z side wall.
    const caseZ = sideZn + 0.35;
    shop.add(box(2.4, 1.3, 0.5, matCabinet, sCx, 0.65, caseZ));
    shop.add(box(2.2, 0.9, 0.45, matGlass, sCx, 0.75, caseZ + 0.04, false));
    shop.add(box(2.4, 0.1, 0.55, matCounterTop, sCx, 1.32, caseZ, false));

    // Two STOOLS in front of the counter.
    for (const sz of [sCz - 1.0, sCz + 1.0]) {
      const sx = ctrX + faceX * 1.6;
      shop.add(cyl(0.32, 0.12, matStool, sx, 0.74, sz));
      shop.add(cyl(0.06, 0.7, matStoolLeg, sx, 0.37, sz));
    }

    // Interior wall SIGNAGE on the back wall, facing into the room.
    const ws = artPanel(2.6, 1.0, "sign", {
      text: wallSign.text, bg: wallSign.bg, fg: wallSign.fg,
      emissiveIntensity: 0.55, file: wallSign.file,
    });
    ws.position.set(backWallX + faceX * 0.13, 2.4, sCz + 1.6);
    ws.rotation.y = faceX > 0 ? Math.PI / 2 : -Math.PI / 2; // face into room
    ws.castShadow = false;
    shop.add(ws);
    neonMats.push(ws.material);

    // Two pendant LAMPS.
    for (const lz of [sCz - 1.6, sCz + 1.6]) {
      shop.add(cyl(0.02, 0.7, matStoolLeg, sCx, wallH - 0.45, lz, false));
      const shade = new THREE.Mesh(SPHERE, matLampShade);
      shade.scale.set(0.5, 0.45, 0.5);
      shade.position.set(sCx, wallH - 0.85, lz);
      shade.castShadow = false;
      shop.add(shade);
    }

    // Exterior SHOP SIGN above the door, facing the avenue (un-mirrored).
    const ss = artPanel(4.4, 1.4, "sign", {
      text: sign.text, bg: sign.bg, fg: sign.fg,
      emissiveIntensity: 0.6, file: sign.file,
    });
    ss.position.set(doorX + faceX * 0.16, wallH + 0.55, sCz);
    ss.rotation.y = faceX > 0 ? Math.PI / 2 : -Math.PI / 2; // front toward avenue
    ss.castShadow = false;
    shop.add(ss);
    neonMats.push(ss.material);
    // Glowing backer behind the sign.
    shop.add(box(0.18, 1.7, 4.7, matMarquee, doorX + faceX * 0.05, wallH + 0.55, sCz, false));
    shop.add(box(0.2, 0.16, 4.8, accentMat, doorX + faceX * 0.06, wallH + 1.45, sCz, false));

    group.add(shop);
  }

  // Three new themed rooms in the open plaza pockets (the GAME ON shop fills the
  // right-front pocket; these fill the other three). Each door faces the avenue
  // and its footprint sits at |X|∈[13,21], |Z|∈[1.5,8.5] — clear of the curb,
  // the curbside cabinets, the cross lane and the building masses.
  const moreShops = [
    // Left-front: snack & soda bar (mirror of GAME ON).
    { sCx: -17, sCz: -5, faceX: 1, accentMat: matTrim,
      sign: { text: "SODA BAR", bg: "#5f0f40", fg: "#46d6ff", file: "arcade-shop-sign-sodabar.png" },
      wallSign: { text: "REFUEL", bg: "#1a0e2e", fg: "#ff4fa3", file: "arcade-shop-wall-refuel.png" },
      theme: { t0: "#ff4fa3", t1: "#46d6ff", t2: "#ffd23f", t3: "#9fff4f" } },
    // Right-back: prize / token redemption counter.
    { sCx: 17, sCz: 5, faceX: -1, accentMat: matTrimGold,
      sign: { text: "PRIZES", bg: "#3a124a", fg: "#ffd23f", file: "arcade-shop-sign-prizes.png" },
      wallSign: { text: "REDEEM TICKETS", bg: "#1a0e2e", fg: "#ffd23f", file: "arcade-shop-wall-redeem.png" },
      theme: { t0: "#ffd23f", t1: "#ff4fa3", t2: "#9fff4f", t3: "#46d6ff" } },
    // Left-back: VR / laser lounge.
    { sCx: -17, sCz: 5, faceX: 1, accentMat: matTrimCyan,
      sign: { text: "VR ZONE", bg: "#0c1c2e", fg: "#27e0ff", file: "arcade-shop-sign-vrzone.png" },
      wallSign: { text: "ENTER THE GRID", bg: "#0a1422", fg: "#27e0ff", file: "arcade-shop-wall-grid.png" },
      theme: { t0: "#27e0ff", t1: "#9fff4f", t2: "#ff4fa3", t3: "#46d6ff" } },
  ];
  for (const s of moreShops) enterableShop(s);

  // --- Extra STREET FLAVOR so the plaza feels lived-in ----------------------
  // A bench: slatted seat + back on two legs. Small collider so it's solid.
  function bench(x, z, rotY) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.add(box(2.0, 0.14, 0.6, matStore, 0, 0.5, 0));        // seat
    g.add(box(2.0, 0.7, 0.12, matStore, 0, 0.85, -0.24));   // backrest
    g.add(box(0.16, 0.5, 0.5, matMetal, -0.85, 0.25, 0));   // leg
    g.add(box(0.16, 0.5, 0.5, matMetal, 0.85, 0.25, 0));    // leg
    g.add(box(2.05, 0.05, 0.62, matTrimCyan, 0, 0.58, 0, false)); // glow lip
    group.add(g);
    // collider in WORLD space (account for rotation: benches here are axis-aligned).
    const halfW = Math.abs(Math.cos(rotY)) > 0.5 ? 1.05 : 0.35;
    const halfD = Math.abs(Math.cos(rotY)) > 0.5 ? 0.35 : 1.05;
    colliders.push({ minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD });
  }
  // A planter: low box with a glowing rim and a couple of "shrub" cubes.
  function planter(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(box(1.4, 0.7, 1.4, matCurb, 0, 0.35, 0));
    g.add(box(1.5, 0.12, 1.5, matTrimGold, 0, 0.72, 0, false)); // glowing rim
    g.add(box(0.7, 0.7, 0.7, matShelf, 0.2, 1.05, -0.1));       // shrub
    g.add(box(0.55, 0.55, 0.55, matShelf, -0.25, 0.95, 0.2));   // shrub
    group.add(g);
    colliders.push({ minX: x - 0.75, maxX: x + 0.75, minZ: z - 0.75, maxZ: z + 0.75 });
  }
  // A stack of arcade-supply crates with a glowing strap.
  function crateStack(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(box(1.1, 1.1, 1.1, matCabinet, 0, 0.55, 0));
    g.add(box(0.9, 0.9, 0.9, matCabinet, 0.15, 1.5, 0.1));
    g.add(box(1.16, 0.1, 1.16, matTrimCyan, 0, 0.9, 0, false)); // strap glow
    group.add(g);
    colliders.push({ minX: x - 0.7, maxX: x + 0.7, minZ: z - 0.7, maxZ: z + 0.7 });
  }
  // A token-vending STALL: little kiosk with a glowing coin slot sign.
  function tokenStall(x, z, faceX) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(box(1.6, 2.2, 1.0, matStore, 0, 1.1, 0));            // body
    g.add(box(0.1, 0.7, 0.8, matScreen, faceX * 0.83, 1.4, 0, false)); // lit slot panel
    g.add(box(2.0, 0.22, 1.3, matMetal, 0, 2.35, 0, false));   // canopy
    g.add(box(0.12, 0.35, 1.0, matTrimGold, faceX * 0.86, 1.95, 0, false)); // "TOKENS" band
    group.add(g);
    colliders.push({ minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.6, maxZ: z + 0.6 });
  }
  // Placements: all in the open plaza band (|Z|≤8) and clear of avenue
  // (X∈[-6,6]), cabinets (X=±8.5/±11.5, |z| up to 8) and booths (∓9.5,∓7.5).
  bench(-7.4, -1.5, 0);      // left curb (gap between cabinets at z=0 & 3.5 mirror)
  bench(7.4, 1.5, 0);        // right curb
  planter(-12.0, 7.7);       // left-back, between outer cabinet (z=4) and building
  planter(12.0, -7.7);       // right-front, mirror
  crateStack(12.0, 7.7);     // right-back corner of plaza band
  crateStack(-12.0, -7.7);   // left-front corner
  tokenStall(10.0, 1.5, -1); // right side, faces avenue
  tokenStall(-10.0, -1.5, 1); // left side, faces avenue

  // Decorative STRING LIGHTS strung over the avenue between curbside posts:
  // small emissive bulbs hung in catenary-ish arcs (visual only, high up so they
  // never block the car). Built from the shared box geo + a neon mat.
  function stringLights(z) {
    const postH = 5.2;
    group.add(cyl(0.12, postH, matPole, -7.0, postH / 2, z, true));
    group.add(cyl(0.12, postH, matPole, 7.0, postH / 2, z, true));
    colliders.push({ minX: -7.2, maxX: -6.8, minZ: z - 0.2, maxZ: z + 0.2 });
    colliders.push({ minX: 6.8, maxX: 7.2, minZ: z - 0.2, maxZ: z + 0.2 });
    const N = 9;
    for (let k = 0; k <= N; k++) {
      const f = k / N;
      const bx = -7.0 + f * 14.0;
      const sag = Math.sin(f * Math.PI) * 0.7; // dip in the middle
      const by = postH - 0.3 - sag;
      const bulbMat = (k % 2 === 0) ? matTrim : matTrimCyan;
      const bulb = box(0.16, 0.16, 0.16, bulbMat, bx, by, z, false);
      group.add(bulb);
    }
  }
  stringLights(-3.0);
  stringLights(3.0);

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
