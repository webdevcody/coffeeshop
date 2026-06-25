// NEON NIGHTLIFE — the hero district. A glowing strip of bars and a club at
// night: stacked neon signs ("NEON LOUNGE", "OPEN 24/7", "CLUB"), gig posters,
// a sweeping marquee, a string of bulbs across the lane, and a pulsing
// dance-floor glow. Heavily emissive; the update() flickers and cycles the
// neon so the whole block shimmers.
//
// Architectural detail: each building now carries a parapet cornice + rail,
// instanced lit window bays (warm + teal, one InstancedMesh per palette),
// storefront bands with fabric awnings + mullions, rooftop clutter (AC ducts,
// vents, water tank, antenna). The club gets a lit marquee canopy over its
// door, a velvet-rope entrance (brass posts + rope swags), a rooftop
// "NIGHTLIFE" sign and a glowing dance-floor plate-glass window. A small bar
// terrace with stools fronts the south bar. All decorative detail is
// visual-only — no new colliders intrude on the wide through-lanes.
//
// buildNightlife() returns { group, colliders, ground, update }:
//   group     — THREE.Group of all meshes in LOCAL tile coords (origin centred)
//   colliders — AABBs { minX, maxX, minZ, maxZ } for solid building footprints
//   ground    — walkable rects (includes the full 60×60 tile)
//   update(dt)— flickers neon, cycles sign colours, spins the marquee, pulses
//               the dance floor; no per-frame allocation
//
// Tile: X ∈ [-30,30], Z ∈ [-30,30], ground at y=0, up is +Y. A wide central
// lane (Z ∈ [-6,6]) is kept clear so a car can drive straight through on X.

import * as THREE from "three";
import { artPanel, artMaterial } from "../cityArt.js";

// --- Shared materials (created ONCE, reused across props) -------------------
const pavementMat = new THREE.MeshStandardMaterial({ color: "#16141d", roughness: 0.85 });
const slabSideMat = new THREE.MeshStandardMaterial({ color: "#0c0b12", roughness: 1 });
const laneGlowMat = new THREE.MeshStandardMaterial({
  color: "#241a3a", emissive: "#5a2db0", emissiveIntensity: 0.5, roughness: 0.6,
});
const buildingDarkMat = new THREE.MeshStandardMaterial({ color: "#1d1830", roughness: 0.8 });
const buildingPlumMat = new THREE.MeshStandardMaterial({ color: "#241430", roughness: 0.8 });
const buildingTealMat = new THREE.MeshStandardMaterial({ color: "#142733", roughness: 0.8 });
const trimMat = new THREE.MeshStandardMaterial({
  color: "#2a2a3a", emissive: "#ff2f8e", emissiveIntensity: 0.7, roughness: 0.5,
});
const trimTealMat = new THREE.MeshStandardMaterial({
  color: "#2a2a3a", emissive: "#2fe6ff", emissiveIntensity: 0.7, roughness: 0.5,
});
const poleMat = new THREE.MeshStandardMaterial({ color: "#23232c", roughness: 0.5, metalness: 0.6 });
const marqueeMat = new THREE.MeshStandardMaterial({
  color: "#3a0f1f", emissive: "#ffb028", emissiveIntensity: 0.6, roughness: 0.5,
});
const bulbMat = new THREE.MeshStandardMaterial({
  color: "#fff2c0", emissive: "#ffdf7a", emissiveIntensity: 1.0, roughness: 0.4,
});
const danceMat = new THREE.MeshStandardMaterial({
  color: "#2a1240", emissive: "#ff3fc0", emissiveIntensity: 0.9, roughness: 0.5,
});
const speakerMat = new THREE.MeshStandardMaterial({ color: "#141118", roughness: 0.8 });
const coneMat = new THREE.MeshStandardMaterial({ color: "#3a3340", roughness: 0.7 });
const planterMat = new THREE.MeshStandardMaterial({ color: "#1a1622", roughness: 0.9 });
const palmTrunkMat = new THREE.MeshStandardMaterial({ color: "#2e2418", roughness: 0.9 });
const palmLeafMat = new THREE.MeshStandardMaterial({
  color: "#1f5a3a", roughness: 0.9, flatShading: true,
});
// --- Architectural-detail materials (shared, low-poly stylised) ------------
const frameMat = new THREE.MeshStandardMaterial({ color: "#0c0a14", roughness: 0.8, flatShading: true });
const corniceMat = new THREE.MeshStandardMaterial({ color: "#15121f", roughness: 0.85, flatShading: true });
const metalMat = new THREE.MeshStandardMaterial({ color: "#2a2a33", roughness: 0.55, metalness: 0.7, flatShading: true });
const ductMat = new THREE.MeshStandardMaterial({ color: "#1c1c24", roughness: 0.75, flatShading: true });
const tankMat = new THREE.MeshStandardMaterial({ color: "#23202c", roughness: 0.8, flatShading: true });
const awningMat = new THREE.MeshStandardMaterial({ color: "#2a0f1f", emissive: "#ff2f8e", emissiveIntensity: 0.35, roughness: 0.6, flatShading: true });
const awningTealMat = new THREE.MeshStandardMaterial({ color: "#0f2733", emissive: "#2fe6ff", emissiveIntensity: 0.35, roughness: 0.6, flatShading: true });
const ropeMat = new THREE.MeshStandardMaterial({ color: "#5a0f24", emissive: "#a01030", emissiveIntensity: 0.4, roughness: 0.6 });
const brassMat = new THREE.MeshStandardMaterial({ color: "#caa24a", roughness: 0.35, metalness: 0.85, flatShading: true });
const stoolSeatMat = new THREE.MeshStandardMaterial({ color: "#3a0f1f", emissive: "#ff2f8e", emissiveIntensity: 0.2, roughness: 0.6 });
const terraceMat = new THREE.MeshStandardMaterial({ color: "#19161f", roughness: 0.85, flatShading: true });
// --- ENTERABLE SHOP materials (record store / late-night bar) ---------------
const shopWallMat = new THREE.MeshStandardMaterial({ color: "#241a2c", roughness: 0.9 });
const shopFloorMat = new THREE.MeshStandardMaterial({ color: "#1a1320", roughness: 0.95 });
const shopRoofMat = new THREE.MeshStandardMaterial({ color: "#15101c", roughness: 0.95 });
const shopWoodMat = new THREE.MeshStandardMaterial({ color: "#3a2418", roughness: 0.7 });
const shopCounterTopMat = new THREE.MeshStandardMaterial({ color: "#1d1a24", roughness: 0.45, metalness: 0.3 });
const shopShelfMat = new THREE.MeshStandardMaterial({ color: "#2c2030", roughness: 0.85 });
const shopRugMat = new THREE.MeshStandardMaterial({ color: "#3a0f24", roughness: 0.95 });
const shopGlassMat = new THREE.MeshStandardMaterial({
  color: "#1a2630", emissive: "#2fc6ff", emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.2,
  transparent: true, opacity: 0.55,
});
const shopBulbMat = new THREE.MeshStandardMaterial({
  color: "#fff0d0", emissive: "#ffd98a", emissiveIntensity: 1.0, roughness: 0.4,
});
// Vinyl-record spine colours for shelf goods (instanced; per-instance colour).
const recordMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 });
// Lit window — shared emissive material reused by ALL instanced windows.
const winLitMat = new THREE.MeshStandardMaterial({
  color: "#2a1c10", emissive: "#ffcf73", emissiveIntensity: 0.85, roughness: 0.5, flatShading: true,
});
const winTealMat = new THREE.MeshStandardMaterial({
  color: "#0c1c24", emissive: "#3fd6ff", emissiveIntensity: 0.8, roughness: 0.5, flatShading: true,
});
const danceWinMat = new THREE.MeshStandardMaterial({
  color: "#2a1240", emissive: "#ff3fc0", emissiveIntensity: 1.1, roughness: 0.4, flatShading: true,
});

// --- Shared geometries -----------------------------------------------------
const bulbGeo = new THREE.SphereGeometry(0.14, 8, 6);
const coneGeo = new THREE.ConeGeometry(0.22, 0.55, 10);
const speakerGeo = new THREE.BoxGeometry(0.7, 1.1, 0.6);
const palmLeafGeo = new THREE.ConeGeometry(0.35, 1.7, 5);
const palmTrunkGeo = new THREE.CylinderGeometry(0.13, 0.18, 2.6, 8);
// Detail geometries (shared, reused in loops / instancing)
const windowGeo = new THREE.BoxGeometry(1.0, 1.4, 0.12); // unit window pane for InstancedMesh
const ductGeo = new THREE.BoxGeometry(1.0, 0.6, 0.8);
const tankGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.2, 12);
const ventGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8);
const antennaGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6);
const stoolPoleGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.95, 8);
const stoolSeatGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12);
const ropePostGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.95, 10);
const ropeKnobGeo = new THREE.SphereGeometry(0.1, 10, 8);
const ropeSpanGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 6); // scaled per span
// Shop interior shared geometries (reused / instanced — no per-prop mint)
const recordGeo = new THREE.BoxGeometry(0.04, 0.5, 0.5); // a single vinyl spine (instanced)
const shopStoolPoleGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.7, 8);
const shopStoolSeatGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 12);
const shopBulbGeo = new THREE.SphereGeometry(0.12, 10, 8);
const shopCordGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4); // scaled per drop

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

export function buildNightlife() {
  const group = new THREE.Group();
  const colliders = [];
  // Collected emissive materials the update() loop animates.
  const neonMats = [];   // {mat, base, phase, speed} — flicker
  const cycleMats = [];  // {mat, hueOffset} — cycle hue
  const bulbStrings = []; // bulb meshes — twinkle

  // --- Ground slab (thin box covering the tile) ----------------------------
  const slab = box(60, 0.3, 60, pavementMat, false);
  slab.position.y = -0.15;
  slab.receiveShadow = true;
  group.add(slab);
  // darker side band for depth on edges
  const sideBand = box(60.4, 0.34, 60.4, slabSideMat, false);
  sideBand.position.y = -0.28;
  group.add(sideBand);

  // --- Central glowing lane strip (decorative, walk/drive over — NO collider)
  const lane = box(60, 0.04, 11, laneGlowMat, false);
  lane.position.set(0, 0.02, 0);
  lane.receiveShadow = true;
  group.add(lane);
  cycleMats.push({ mat: laneGlowMat, hueOffset: 0.0 });

  // --- Building footprint helper -------------------------------------------
  // Builds a bar/club box with an emissive trim band, a parapet cornice, a
  // ground-floor storefront band + awning, and registers its lane-facing
  // façade so windows get batched into a single InstancedMesh later.
  // `facing` = +1 if the front faces +Z (north side), -1 if -Z (south side).
  const facades = []; // {cx, cz, w, h, frontZ, facing, winMat}
  function makeBuilding(cx, cz, w, h, d, bodyMat, trim, facing, winMat) {
    const g = new THREE.Group();
    const body = box(w, h, d, bodyMat);
    body.position.y = h / 2;
    g.add(body);
    // glowing trim band wrapping the upper façade (facing the lane = ±Z)
    const band = box(w * 0.96, 0.35, d * 0.96, trim, false);
    band.position.y = h - 0.6;
    g.add(band);
    // parapet / cornice cap so the roofline reads as a real building edge
    const cornice = box(w + 0.5, 0.5, d + 0.5, corniceMat, false);
    cornice.position.y = h + 0.2;
    g.add(cornice);
    // thin parapet rail above the cornice (front + back lips)
    for (const sz of [-1, 1]) {
      const lip = box(w + 0.3, 0.35, 0.18, corniceMat, false);
      lip.position.set(0, h + 0.55, sz * (d / 2 + 0.1));
      g.add(lip);
    }
    // ground-floor storefront band (darker, recessed-looking) on the front
    const frontZ = cz + facing * (d / 2 + 0.02);
    const storeBand = box(w * 0.92, 2.4, 0.12, frameMat, false);
    storeBand.position.set(0, 1.2, facing * (d / 2 + 0.02));
    g.add(storeBand);
    // fabric awning jutting over the storefront
    const aMat = (winMat === winTealMat) ? awningTealMat : awningMat;
    const awning = box(w * 0.78, 0.18, 1.5, aMat, false);
    awning.position.set(0, 2.55, facing * (d / 2 + 0.75));
    awning.rotation.x = facing * -0.22;
    g.add(awning);
    // little valance lip under the awning edge
    const valance = box(w * 0.78, 0.5, 0.08, aMat, false);
    valance.position.set(0, 2.25, facing * (d / 2 + 1.45));
    g.add(valance);
    g.position.set(cx, 0, cz);
    group.add(g);
    addCollider(colliders, cx, cz, w, d);
    facades.push({ cx, cz, w, h, frontZ, facing, winMat });
    return g;
  }

  // North side (Z negative, facing +Z lane) and South side (Z positive).
  // Lane stays clear: buildings sit at |Z| >= ~9. Every building below is a
  // FULL 3-D volume (w & d both >= 6 m) and the streetwall is kept continuous
  // (footprints abut with no card-like gaps) so the block reads solid from the
  // front, the sides AND the back. The pedestrian cross-lanes at X ≈ ±9 stay
  // open at ground level (only overhead bulb strings span them).
  // -- NORTH STREETWALL (front faces +Z) --
  // Setback: every footprint kept within LOCAL X,Z ∈ [-23,23] to clear the seam
  // road grid (roads on tile edges at ±30) + kerb + sidewalk. Corner blocks were
  // pulled inward (and modestly narrowed) so nothing reaches the street.
  makeBuilding(-16, -15.5, 14, 7.5, 12, buildingDarkMat, trimMat, 1, winLitMat);    // NEON LOUNGE bar  X[-23,-9]
  makeBuilding(-2, -16, 14, 9.5, 12, buildingPlumMat, trimTealMat, 1, winTealMat);  // THE CLUB (tall hero) X[-9,5]
  makeBuilding(7.75, -15.5, 5.5, 6.0, 9, buildingTealMat, trimTealMat, 1, winTealMat); // CLUB box-office kiosk X[5,10.5] (narrowed to abut the diner, no overlap)
  makeBuilding(16.5, -15, 12, 6.5, 11, buildingTealMat, trimMat, 1, winLitMat);     // OPEN 24/7 diner  X[10.5,22.5]
  // -- SOUTH STREETWALL (front faces -Z) --
  makeBuilding(-17.5, 16, 11, 7.0, 11, buildingPlumMat, trimMat, -1, winLitMat);    // south corner bar X[-23,-12]
  makeBuilding(-7, 16, 11, 6.5, 11, buildingTealMat, trimTealMat, -1, winTealMat);  // south bar (terrace) X[-12.5,-1.5]
  makeBuilding(3, 16.5, 10, 7.5, 11, buildingDarkMat, trimTealMat, -1, winTealMat); // south music hall X[-2,8]
  makeBuilding(13, 16.5, 10, 8, 12, buildingPlumMat, trimMat, -1, winLitMat);       // south lounge X[8,18] (narrowed; centre kept at 13 so the LATE LOUNGE sign still fits)
  makeBuilding(20.5, 16, 5, 6.5, 11, buildingTealMat, trimMat, -1, winLitMat);      // south corner diner X[18,23] (was 5.5m embedded inside the lounge; now abuts it cleanly)

  // ── LIT WINDOW BAYS — one InstancedMesh per material, shared geometry ──
  // Build window-bay grids on each lane-facing façade above the storefront.
  // Collect all transforms first, then commit to two InstancedMeshes (warm +
  // teal). One shared geometry + one shared material each — no per-window mint.
  const winMatrix = new THREE.Matrix4();
  const warmXforms = [];
  const tealXforms = [];
  for (const f of facades) {
    const cols = Math.max(2, Math.floor(f.w / 2.6));
    const rows = Math.max(1, Math.floor((f.h - 3.2) / 1.9));
    const colGap = f.w / (cols + 1);
    const z = f.frontZ + f.facing * 0.07; // sit just proud of the façade
    const target = (f.winMat === winTealMat) ? tealXforms : warmXforms;
    for (let r = 0; r < rows; r++) {
      const y = 3.6 + r * 1.9;
      if (y > f.h - 1.1) continue;
      for (let c = 0; c < cols; c++) {
        const x = f.cx - f.w / 2 + colGap * (c + 1);
        winMatrix.makeTranslation(x, y, z);
        target.push(winMatrix.clone());
      }
    }
  }
  function commitWindows(xforms, mat) {
    if (!xforms.length) return;
    const inst = new THREE.InstancedMesh(windowGeo, mat, xforms.length);
    for (let i = 0; i < xforms.length; i++) inst.setMatrixAt(i, xforms[i]);
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = false;
    inst.receiveShadow = false;
    group.add(inst);
  }
  commitWindows(warmXforms, winLitMat);
  commitWindows(tealXforms, winTealMat);
  // Register the two window materials so they flicker subtly with the neon.
  neonMats.push({ mat: winLitMat, base: 0.85, phase: 1.1, speed: 2.2 });
  neonMats.push({ mat: winTealMat, base: 0.8, phase: 3.4, speed: 2.6 });

  // ── WINDOW FRAMES / MULLIONS — shared geo + shared mat reused in a loop ──
  // Thin cross mullions over a couple of storefront bays for believability.
  const frameBarGeo = new THREE.BoxGeometry(0.08, 2.2, 0.06);
  for (const f of facades) {
    const z = f.frontZ + f.facing * 0.09;
    for (const dx of [-f.w * 0.22, 0, f.w * 0.22]) {
      const bar = new THREE.Mesh(frameBarGeo, frameMat);
      bar.position.set(f.cx + dx, 1.3, z);
      group.add(bar);
    }
  }

  // helper: attach an emissive art panel and register it for animation
  function addNeonPanel(w, h, opts, x, y, z, rotY) {
    const panel = artPanel(w, h, "neon", opts);
    panel.position.set(x, y, z);
    panel.rotation.y = rotY;
    group.add(panel);
    neonMats.push({ mat: panel.material, base: opts.emissiveIntensity ?? 0.9, phase: Math.random() * 6.28, speed: 5 + Math.random() * 4 });
    return panel;
  }

  // ── NEON SIGNS (the stars of the show) ──
  // "NEON / LOUNGE" — on the NEON LOUNGE bar, facing +Z (the lane)
  addNeonPanel(6, 4, {
    lines: ["NEON", "LOUNGE"], color: "#ff4fa3", color2: "#4fd2ff",
    emissiveIntensity: 0.95, file: "neon-lounge.png",
  }, -16, 5.6, -9.3, 0); // follows NEON LOUNGE bar (cx -16)

  // "CLUB" — huge sign on the hero club, facing +Z
  addNeonPanel(7, 5, {
    lines: ["CLUB"], color: "#b14fff", color2: "#ff4fa3",
    emissiveIntensity: 1.0, file: "neon-club.png",
  }, -2, 7.4, -9.6, 0);

  // "OPEN / 24/7" — on the diner, facing +Z
  addNeonPanel(5, 4, {
    lines: ["OPEN", "24/7"], color: "#4fffa0", color2: "#ffe24f",
    emissiveIntensity: 0.95, file: "neon-open247.png",
  }, 16.5, 4.9, -9.2, 0); // follows OPEN 24/7 diner (cx 16.5)

  // South-side signs face -Z (toward the lane from the other side)
  addNeonPanel(6, 4, {
    lines: ["NEON", "BAR"], color: "#ff7a2f", color2: "#4fd2ff",
    emissiveIntensity: 0.95, file: "neon-bar.png",
  }, -17.5, 4.7, 10.2, Math.PI); // follows south corner bar (cx -17.5)

  addNeonPanel(6.5, 4.5, {
    lines: ["LATE", "LOUNGE"], color: "#4fd2ff", color2: "#ff4fa3",
    emissiveIntensity: 0.95, file: "neon-late.png",
  }, 13, 5.8, 10.2, Math.PI); // follows south lounge (cx 13)

  // A vertical blade sign on a pole at a corner (rotated, faces the lane)
  const blade = addNeonPanel(2.4, 6, {
    lines: ["C", "L", "U", "B"], color: "#ff4fa3", color2: "#b14fff",
    emissiveIntensity: 1.0, file: "neon-blade.png",
  }, 6, 4.4, -8.6, 0);
  const bladePole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.4, 8), poleMat);
  bladePole.position.set(6.0, 2.2, -8.0);
  bladePole.castShadow = true;
  group.add(bladePole);
  blade.position.z = -8.05;

  // ── GIG POSTERS (style "poster", top "LIVE TONIGHT") ──
  function addPoster(opts, x, y, z, rotY) {
    const p = artPanel(2.2, 3.3, "poster", opts);
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    group.add(p);
    return p;
  }
  addPoster({ top: "LIVE TONIGHT", bottom: "THE VOLTS", foot: "DOORS 9PM", glyph: "♪", accent: "#ff2f8e", bg: "#1a0f24", file: "poster-volts.png" }, -11.6, 2.6, -8.85, 0);
  addPoster({ top: "LIVE TONIGHT", bottom: "NEON KIDS", foot: "FREE ENTRY", glyph: "★", accent: "#2fe6ff", bg: "#12091e", file: "poster-neonkids.png" }, 12, 2.6, -9.35, 0); // was floating 2.3m in front of the recessed kiosk; now flush on the diner storefront
  addPoster({ top: "LIVE TONIGHT", bottom: "DJ HALO", foot: "TILL LATE", glyph: "◎", accent: "#ffb028", bg: "#1a0f24", file: "poster-djhalo.png" }, -7.2, 2.6, 9.4, Math.PI);

  // ── MARQUEE (a wide horizontal sign that rotates/oscillates in update) ──
  // Mounted out front of the hero club on a post; spins slowly.
  const marqueePivot = new THREE.Group();
  marqueePivot.position.set(-2, 4.2, -3.0);
  const marqueeBoard = artPanel(5.5, 1.4, "sign", {
    text: "TONIGHT", bg: "#2a0f1f", fg: "#ffd27a", file: "marquee-tonight.png",
  });
  marqueeBoard.material.emissiveIntensity = 0.6;
  marqueeBoard.castShadow = false;
  // ring of bulbs around the marquee board
  const marqueeFrame = box(5.9, 1.8, 0.18, marqueeMat, false);
  marqueeFrame.position.z = -0.06;
  marqueePivot.add(marqueeFrame, marqueeBoard);
  group.add(marqueePivot);
  cycleMats.push({ mat: marqueeMat, hueOffset: 0.3 });
  const marqueePost = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.2, 8), poleMat);
  marqueePost.position.set(-2, 2.1, -3.0);
  marqueePost.castShadow = true;
  group.add(marqueePost);

  // ── STRING OF BULBS across the lane (two catenary-ish strings) ──
  // Poles at the lane edges; bulbs hang in a shallow arc between them.
  function addBulbString(x, z0, z1, peakY, sagY, count) {
    const p0 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, peakY + 0.4, 6), poleMat);
    p0.position.set(x, (peakY + 0.4) / 2, z0);
    const p1 = p0.clone();
    p1.position.z = z1;
    p0.castShadow = p1.castShadow = true;
    group.add(p0, p1);
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const z = z0 + (z1 - z0) * t;
      const sag = Math.sin(t * Math.PI) * sagY; // dip in the middle
      const b = new THREE.Mesh(bulbGeo, bulbMat);
      b.position.set(x, peakY - sag, z);
      group.add(b);
      bulbStrings.push(b);
    }
  }
  addBulbString(-9, -6.5, 6.5, 4.6, 1.0, 5);
  addBulbString(9, -6.5, 6.5, 4.6, 1.0, 5);
  // A third string running ALONG the lane edge (X) over the club doors — purely
  // decorative, hangs above head height so it never blocks the through-lane.
  function addBulbStringX(z, x0, x1, peakY, sagY, count) {
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = x0 + (x1 - x0) * t;
      const sag = Math.sin(t * Math.PI) * sagY;
      const b = new THREE.Mesh(bulbGeo, bulbMat);
      b.position.set(x, peakY - sag, z);
      group.add(b);
      bulbStrings.push(b);
    }
  }
  addBulbStringX(-7.0, -9, 5, 4.4, 0.5, 7);

  // ── MARQUEE CANOPY over the club door (a lit projecting canopy) ──
  // The hero club is cx=-2, front face at z=-10; door faces +Z.
  const canopy = new THREE.Group();
  canopy.position.set(-2, 3.5, -8.7);
  const canopyRoof = box(7.0, 0.3, 2.4, marqueeMat, false);
  canopyRoof.position.set(0, 0, 0);
  const canopyFascia = box(7.0, 0.7, 0.12, marqueeMat, false);
  canopyFascia.position.set(0, -0.2, 1.18);
  canopy.add(canopyRoof, canopyFascia);
  cycleMats.push({ mat: marqueeMat, hueOffset: 0.55 });
  // ring of bulbs under the canopy fascia (shared geo + mat)
  for (let i = -3; i <= 3; i++) {
    const b = new THREE.Mesh(bulbGeo, bulbMat);
    b.position.set(i * 1.0, -0.35, 1.22);
    canopy.add(b);
    bulbStrings.push(b);
  }
  // two tie-rods angling back to the façade
  for (const sx of [-2.7, 2.7]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), metalMat);
    rod.position.set(sx, 0.55, -0.6);
    rod.rotation.x = 0.7;
    canopy.add(rod);
  }
  group.add(canopy);
  // canopy nameboard sign on the fascia
  addNeonPanel(5.4, 0.55, {
    lines: ["THE CLUB"], color: "#ffd27a", color2: "#ff8a3a",
    emissiveIntensity: 0.9, file: "neon-clubdoor.png",
  }, -2, 3.3, -7.45, 0);

  // ── ROOFTOP SIGN on the hero club (big standing letters on a frame) ──
  const roofSign = addNeonPanel(8, 2.6, {
    lines: ["NIGHTLIFE"], color: "#ff4fa3", color2: "#4fd2ff",
    emissiveIntensity: 1.0, file: "neon-roofsign.png",
  }, -2, 11.6, -16, 0);
  roofSign.castShadow = false;
  // support legs for the rooftop sign
  for (const sx of [-3, 3]) {
    const leg = new THREE.Mesh(antennaGeo, metalMat);
    leg.position.set(-2 + sx, 10.8, -16);
    leg.scale.y = 0.7;
    group.add(leg);
  }

  // ── VELVET-ROPE ENTRANCE in front of the club door ──
  // Brass posts + draped rope swags forming a short queue channel. Posts are
  // slim props near the building front (NOT in the through-lane Z∈[-6,6]).
  const ropePosts = [
    [-5.2, -7.2], [-5.2, -8.6],
    [1.2, -7.2], [1.2, -8.6],
  ];
  const postTops = [];
  for (const [px, pz] of ropePosts) {
    const post = new THREE.Mesh(ropePostGeo, brassMat);
    post.position.set(px, 0.5, pz);
    post.castShadow = true;
    group.add(post);
    const knob = new THREE.Mesh(ropeKnobGeo, brassMat);
    knob.position.set(px, 1.0, pz);
    group.add(knob);
    postTops.push([px, 0.95, pz]);
  }
  // rope swags between adjacent posts on each side
  function addRopeSwag(a, b) {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    const rope = new THREE.Mesh(ropeSpanGeo, ropeMat);
    rope.scale.y = len;
    rope.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.12, (a[2] + b[2]) / 2);
    // orient cylinder (default +Y) along the span
    rope.rotation.z = Math.PI / 2;
    rope.rotation.y = -Math.atan2(dz, dx);
    group.add(rope);
  }
  addRopeSwag(postTops[0], postTops[1]);
  addRopeSwag(postTops[2], postTops[3]);

  // ── BAR TERRACE with stools (small raised deck + stools by the south bar) ──
  // South bar is cx=-7, cz=16, front face at z=10.5 (faces -Z). Terrace sits
  // just in front, well outside the lane.
  const terrace = box(6.0, 0.18, 3.0, terraceMat, false);
  terrace.position.set(-7, 0.12, 9.0);
  terrace.receiveShadow = true;
  group.add(terrace);
  // low terrace rail (decorative, thin)
  for (const [rw, rd, rx, rz] of [[6.0, 0.1, -7, 7.55], [0.1, 3.0, -4.05, 9.0], [0.1, 3.0, -9.95, 9.0]]) {
    const rail = box(rw, 0.5, rd, terraceMat, false);
    rail.position.set(rx, 0.45, rz);
    group.add(rail);
  }
  function makeStool(x, z) {
    const pole = new THREE.Mesh(stoolPoleGeo, metalMat);
    pole.position.set(x, 0.6, z);
    pole.castShadow = true;
    const seat = new THREE.Mesh(stoolSeatGeo, stoolSeatMat);
    seat.position.set(x, 1.1, z);
    seat.castShadow = true;
    group.add(pole, seat);
  }
  for (const sx of [-8.8, -7, -5.2]) makeStool(sx, 9.6);

  // ── ROOFTOP CLUTTER — AC ducts, vent stacks, a water tank, antennas ──
  // Reuses shared geometries; small visual-only props sitting on each roof.
  function addRoofClutter(cx, cz, w, d, h) {
    // AC duct boxes
    for (const [ox, oz] of [[-w * 0.22, d * 0.18], [w * 0.2, -d * 0.15]]) {
      const duct = new THREE.Mesh(ductGeo, ductMat);
      duct.position.set(cx + ox, h + 0.75, cz + oz);
      duct.castShadow = true;
      group.add(duct);
    }
    // vent stacks
    for (const [ox, oz] of [[w * 0.3, d * 0.25], [-w * 0.3, -d * 0.2]]) {
      const v = new THREE.Mesh(ventGeo, ductMat);
      v.position.set(cx + ox, h + 0.7, cz + oz);
      group.add(v);
    }
    // water tank
    const tank = new THREE.Mesh(tankGeo, tankMat);
    tank.position.set(cx - w * 0.05, h + 1.05, cz - d * 0.28);
    tank.castShadow = true;
    group.add(tank);
    // antenna
    const ant = new THREE.Mesh(antennaGeo, metalMat);
    ant.position.set(cx + w * 0.34, h + 1.6, cz + d * 0.3);
    group.add(ant);
  }
  addRoofClutter(-16, -15.5, 14, 12, 7.5);  // NEON LOUNGE roof
  addRoofClutter(16.5, -15, 12, 11, 6.5);    // diner roof
  addRoofClutter(-17.5, 16, 11, 11, 7.0);    // south corner bar roof
  addRoofClutter(-7, 16, 11, 11, 6.5);       // south bar roof
  addRoofClutter(13, 16.5, 10, 12, 8);       // south lounge roof (width follows the narrowed footprint)

  // ── EXTRA NEON + GIG POSTERS (more signage density) ──
  // A second blade sign on the south side + extra wall neons.
  addNeonPanel(2.2, 5, {
    lines: ["B", "A", "R"], color: "#4fffa0", color2: "#ffe24f",
    emissiveIntensity: 1.0, file: "neon-blade2.png",
  }, -21, 4.6, 9.6, Math.PI); // corner of south corner bar (kept within setback)
  addNeonPanel(4.5, 2.2, {
    lines: ["COCKTAILS"], color: "#ff7a2f", color2: "#4fd2ff",
    emissiveIntensity: 0.95, file: "neon-cocktails.png",
  }, 16.5, 5.3, -9.0, 0); // follows OPEN 24/7 diner (cx 16.5)
  // extra gig posters by the canopy / south lounge
  addPoster({ top: "LIVE TONIGHT", bottom: "VELVET", foot: "DOORS 10PM", glyph: "♫", accent: "#b14fff", bg: "#160a22", file: "poster-velvet.png" }, -5.4, 2.6, -8.85, 0);
  addPoster({ top: "THIS FRIDAY", bottom: "PULSE", foot: "18+", glyph: "◆", accent: "#2fe6ff", bg: "#0f1626", file: "poster-pulse.png" }, 18.5, 2.6, 9.4, Math.PI);

  // ── DANCE-FLOOR GLOW (a grid of emissive tiles in front of the club) ──
  const danceGroup = new THREE.Group();
  danceGroup.position.set(-2, 0.03, 4.5);
  const danceTileGeo = new THREE.BoxGeometry(1.4, 0.06, 1.4);
  const danceTiles = [];
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      // each tile gets its own cheap material clone so they pulse out of phase
      const m = danceMat.clone();
      const tile = new THREE.Mesh(danceTileGeo, m);
      tile.position.set(ix * 1.5, 0, iz * 1.5);
      tile.receiveShadow = true;
      danceGroup.add(tile);
      danceTiles.push({ mat: m, phase: (ix + iz) * 0.7 });
    }
  }
  group.add(danceGroup);

  // ── GLOWING DANCE-FLOOR WINDOW set into the club façade ──
  // A big plate-glass bay on the club front through which the floor glows;
  // its emissive hue cycles in sync with the floor tiles.
  const danceWin = box(5.2, 2.4, 0.14, danceWinMat, false);
  danceWin.position.set(-2, 1.5, -9.9); // club front face is z=-10
  group.add(danceWin);
  // window frame around it (shared frame mat)
  const dwFrameGeo = new THREE.BoxGeometry(5.6, 0.14, 0.16);
  for (const sy of [-1.25, 1.25]) {
    const bar = new THREE.Mesh(dwFrameGeo, frameMat);
    bar.position.set(-2, 1.5 + sy, -9.86);
    group.add(bar);
  }
  const dwFrameVGeo = new THREE.BoxGeometry(0.16, 2.7, 0.16);
  for (const sx of [-2.7, 0, 2.7]) {
    const bar = new THREE.Mesh(dwFrameVGeo, frameMat);
    bar.position.set(-2 + sx, 1.5, -9.86);
    group.add(bar);
  }

  // ── A few props: speakers flanking the dance floor + traffic cones + palms ─
  for (const sx of [-5, 1]) {
    const sp = new THREE.Mesh(speakerGeo, speakerMat);
    sp.position.set(-2 + sx, 0.55, 6.6);
    sp.castShadow = true;
    sp.receiveShadow = true;
    group.add(sp);
  }
  // (cones kept clear of the dance floor + the two new enterable shops below)
  for (const [cx, cz] of [[-8.5, -4.5], [9.6, -4.5], [-8.5, 4.5]]) {
    const c = new THREE.Mesh(coneGeo, coneMat);
    c.position.set(cx, 0.27, cz);
    c.castShadow = true;
    group.add(c);
  }
  // potted palms by the doors (foliage, flatShading) — walk-around small props
  function makePalm(x, z) {
    const g = new THREE.Group();
    const planter = box(0.7, 0.5, 0.7, planterMat);
    planter.position.y = 0.25;
    const trunk = new THREE.Mesh(palmTrunkGeo, palmTrunkMat);
    trunk.position.y = 1.55;
    trunk.castShadow = true;
    g.add(planter, trunk);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(palmLeafGeo, palmLeafMat);
      leaf.position.y = 2.7;
      leaf.rotation.z = 0.9;
      leaf.rotation.y = (i / 5) * Math.PI * 2;
      leaf.castShadow = true;
      g.add(leaf);
    }
    g.position.set(x, 0, z);
    group.add(g);
    return g;
  }
  makePalm(-9.5, -8);
  makePalm(9.5, -8);

  // ── ENTERABLE SHOP: "VINYL & TONIC" record store / late-night bar ──────────
  // A real walk-in room tucked into the open south-east quadrant, footprint
  // X∈[9,17], Z∈[3,9] (8 m wide × 6 m deep). Back wall abuts the south lounge
  // front; the DOORWAY faces the lane (−Z). Four walls (0.25 m thick, 2.8 m
  // tall) get individual AABB colliders EXCEPT across the 2.2 m doorway gap, so
  // the player walks straight in. Inside: a bar/record counter, record-bin
  // shelves with vinyl, a glowing display case, stools, signage, hanging
  // pendant lights and a rug. The shop sits clear of all buildings/props and
  // leaves the central drive-lane (Z<3) open.
  {
    const SX0 = 9, SX1 = 17;   // X extents
    const SZ0 = 3, SZ1 = 9;    // Z extents (SZ0 = street-facing front)
    const wh = 2.8;            // wall height
    const wt = 0.25;           // wall thickness
    const cz = (SZ0 + SZ1) / 2; // 6 (depth centre)
    const cx = (SX0 + SX1) / 2; // 13 (width centre)
    const sw = SX1 - SX0;       // 8 (interior+wall span in X)
    const sd = SZ1 - SZ0;       // 6 (span in Z)
    const doorW = 2.2;          // doorway gap width
    const shop = new THREE.Group();

    // FLOOR (thin slab, just proud of the pavement so it reads as a room floor)
    const floor = box(sw, 0.08, sd, shopFloorMat, false);
    floor.position.set(cx, 0.04, cz);
    floor.receiveShadow = true;
    shop.add(floor);

    // FLAT ROOF / ceiling
    const roof = box(sw + 0.1, 0.2, sd + 0.1, shopRoofMat, false);
    roof.position.set(cx, wh + 0.1, cz);
    shop.add(roof);

    // --- WALLS + their individual colliders -----------------------------
    // Helper: a wall box centred at (wx,wz) of given footprint, plus a matching
    // AABB collider. The doorway segment is added WITHOUT a collider.
    function addWall(wx, wz, w, d, collide) {
      const m = box(w, wh, d, shopWallMat, true);
      m.position.set(wx, wh / 2, wz);
      m.receiveShadow = true;
      shop.add(m);
      if (collide) addCollider(colliders, wx, wz, w, d);
    }
    // BACK wall (z = SZ1), full width, with collider
    addWall(cx, SZ1 - wt / 2, sw, wt, true);
    // LEFT side wall (x = SX0), full depth, with collider
    addWall(SX0 + wt / 2, cz, wt, sd, true);
    // RIGHT side wall (x = SX1), full depth, with collider
    addWall(SX1 - wt / 2, cz, wt, sd, true);
    // FRONT wall (z = SZ0) — split into two short segments flanking the door.
    const frontZ = SZ0 + wt / 2;
    const segW = (sw - doorW) / 2;              // each front segment width (2.9)
    const segLcx = SX0 + segW / 2;              // left segment centre x
    const segRcx = SX1 - segW / 2;              // right segment centre x
    addWall(segLcx, frontZ, segW, wt, true);    // left front segment + collider
    addWall(segRcx, frontZ, segW, wt, true);    // right front segment + collider
    // NB: doorway gap x∈[cx-doorW/2, cx+doorW/2] has NO wall and NO collider.

    // Door lintel (header over the doorway, above head height — no collider)
    const lintel = box(doorW + 0.1, 0.45, wt, shopWoodMat, false);
    lintel.position.set(cx, wh - 0.225, frontZ);
    shop.add(lintel);

    // --- RUG (warm floor accent, centred in the room) -------------------
    const rug = box(3.6, 0.03, 2.6, shopRugMat, false);
    rug.position.set(cx - 0.6, 0.09, cz + 0.2);
    rug.receiveShadow = true;
    shop.add(rug);

    // --- SERVICE / RECORD COUNTER (an L of cabinetry along the back-right) --
    // Long run parallel to the back wall + a short return toward the front.
    const counterTopY = 1.02;
    function addCounter(wx, wz, w, d) {
      const base = box(w, 1.0, d, shopWoodMat, true);
      base.position.set(wx, 0.5, wz);
      base.castShadow = true; base.receiveShadow = true;
      const top = box(w + 0.08, 0.08, d + 0.08, shopCounterTopMat, false);
      top.position.set(wx, counterTopY, wz);
      shop.add(base, top);
    }
    addCounter(cx + 1.4, SZ1 - 1.1, 3.6, 0.8);   // main run along back
    addCounter(SX1 - 1.1, cz + 1.1, 0.8, 2.2);   // short return down the right

    // --- SHELVES with little products (record bins) along the left wall ---
    // Three stacked shelf boards on uprights; vinyl spines instanced on top.
    const shelfX = SX0 + 0.55;
    const recordXforms = [];
    const recordColors = ["#ff4fa3", "#4fd2ff", "#ffe24f", "#b14fff", "#4fffa0", "#ff7a2f", "#f2f2f2", "#ff3030"];
    const recordColorList = [];
    const tmpM = new THREE.Matrix4();
    for (let s = 0; s < 3; s++) {
      const sy = 0.7 + s * 0.7;
      const board = box(0.5, 0.06, 4.4, shopShelfMat, true);
      board.position.set(shelfX, sy, cz);
      board.castShadow = true; board.receiveShadow = true;
      shop.add(board);
      // a back panel behind the shelf (against the wall)
      // vinyl records standing on the board (instanced spines)
      for (let i = 0; i < 18; i++) {
        const rz = cz - 2.0 + i * 0.235;
        // tiny lean so the row looks browsed-through
        const lean = (Math.sin(i * 1.7) * 0.06);
        tmpM.makeRotationZ(lean);
        tmpM.setPosition(shelfX + 0.05, sy + 0.31, rz);
        recordXforms.push(tmpM.clone());
        recordColorList.push(recordColors[(i + s) % recordColors.length]);
      }
    }
    // shelf uprights (two ends)
    for (const ez of [cz - 2.2, cz + 2.2]) {
      const up = box(0.5, 2.1, 0.08, shopShelfMat, true);
      up.position.set(shelfX, 1.05, ez);
      shop.add(up);
    }
    // commit the vinyl as ONE InstancedMesh (per-instance colour)
    const recInst = new THREE.InstancedMesh(recordGeo, recordMat, recordXforms.length);
    const _rc = new THREE.Color();
    for (let i = 0; i < recordXforms.length; i++) {
      recInst.setMatrixAt(i, recordXforms[i]);
      recInst.setColorAt(i, _rc.set(recordColorList[i]));
    }
    recInst.instanceMatrix.needsUpdate = true;
    if (recInst.instanceColor) recInst.instanceColor.needsUpdate = true;
    recInst.castShadow = false; recInst.receiveShadow = false;
    shop.add(recInst);

    // --- DISPLAY CASE (glowing glass cabinet — featured records / bottles) --
    const caseBase = box(1.8, 0.9, 0.7, shopWoodMat, true);
    caseBase.position.set(cx - 1.6, 0.45, SZ1 - 0.7);
    caseBase.castShadow = true; caseBase.receiveShadow = true;
    const caseGlass = box(1.7, 0.7, 0.6, shopGlassMat, false);
    caseGlass.position.set(cx - 1.6, 1.25, SZ1 - 0.7);
    shop.add(caseBase, caseGlass);

    // --- STOOLS at the counter (a couple of bar seats) ------------------
    function addShopStool(x, z) {
      const pole = new THREE.Mesh(shopStoolPoleGeo, metalMat);
      pole.position.set(x, 0.35, z);
      pole.castShadow = true;
      const seat = new THREE.Mesh(shopStoolSeatGeo, stoolSeatMat);
      seat.position.set(x, 0.72, z);
      seat.castShadow = true;
      shop.add(pole, seat);
    }
    addShopStool(cx + 0.4, SZ1 - 2.2);
    addShopStool(cx + 1.5, SZ1 - 2.2);
    addShopStool(cx + 2.6, SZ1 - 2.2);

    // --- HANGING PENDANT LIGHTS (two glowing bulbs on cords from the roof) --
    const shopBulbs = [];
    for (const [bx, bz] of [[cx - 0.6, cz - 0.4], [cx + 1.4, cz + 1.0]]) {
      const cord = new THREE.Mesh(shopCordGeo, frameMat);
      cord.scale.y = 0.9;
      cord.position.set(bx, wh - 0.45, bz);
      const bulb = new THREE.Mesh(shopBulbGeo, shopBulbMat);
      bulb.position.set(bx, wh - 0.95, bz);
      shop.add(cord, bulb);
      shopBulbs.push(bulb);
    }

    // --- WALL SIGNAGE (interior) — a neon strip behind the counter --------
    const innerSign = artPanel(2.8, 0.7, "neon", {
      lines: ["NOW SPINNING"], color: "#4fd2ff", color2: "#ff4fa3",
      emissiveIntensity: 0.9, file: "neon-nowspinning.png",
    });
    innerSign.position.set(cx + 1.4, 1.9, SZ1 - 0.18);
    innerSign.rotation.y = Math.PI; // faces into the room (toward −Z / the door)
    shop.add(innerSign);
    neonMats.push({ mat: innerSign.material, base: 0.9, phase: 2.2, speed: 3.0 });
    // a small interior price/menu sign on the left wall
    const wallMenu = artPanel(1.6, 1.0, "sign", {
      text: "VINYL BAR", bg: "#2a0f1f", fg: "#ffd27a", file: "sign-vinylbar-inner.png",
    });
    wallMenu.position.set(SX0 + 0.16, 2.0, cz + 1.6);
    wallMenu.rotation.y = Math.PI / 2; // faces +X into the room from the left wall
    shop.add(wallMenu);

    // --- OUTSIDE SHOP SIGN above the door, facing the street (−Z) ----------
    // artPanel faces +Z by default; rotate π so the text reads correctly toward
    // the lane (matches the district's other south-facing signs).
    const shopSign = artPanel(4.4, 1.1, "sign", {
      text: "VINYL & TONIC", bg: "#2a0f1f", fg: "#ffd27a", file: "sign-vinyl-tonic.png",
    });
    shopSign.position.set(cx, wh + 0.55, SZ0 - 0.06);
    shopSign.rotation.y = Math.PI;
    shopSign.material.emissiveIntensity = 0.7;
    shop.add(shopSign);
    // a little signboard frame behind it
    const signFrame = box(4.7, 1.35, 0.1, frameMat, false);
    signFrame.position.set(cx, wh + 0.55, SZ0 - 0.12);
    shop.add(signFrame);

    group.add(shop);
    // register the two pendant bulbs so they twinkle with the rest
    for (const b of shopBulbs) bulbStrings.push(b);
  }

  // ── ENTERABLE SHOP #2: "AFTER HOURS" late-night cocktail bar ───────────────
  // SW corner of the district, footprint X∈[-22,-13], Z∈[3,9] (9 m × 6 m). Back
  // wall sits clear in front of the south corner bar; the DOORWAY faces the lane
  // (−Z). Same construction as VINYL & TONIC: four 0.25 m walls get individual
  // AABB colliders EXCEPT across the 2.2 m doorway gap. Inside: an L-bar with a
  // glowing back-bar bottle wall, stools, a booth table with seats, pendant
  // lights, a neon "AFTER HOURS" strip + an exterior sign over the door.
  {
    const SX0 = -22, SX1 = -13;
    const SZ0 = 3, SZ1 = 9;
    const wh = 2.8, wt = 0.25;
    const cx = (SX0 + SX1) / 2; // -17.5
    const cz = (SZ0 + SZ1) / 2; // 6
    const sw = SX1 - SX0;       // 9
    const sd = SZ1 - SZ0;       // 6
    const doorW = 2.2;
    const shop = new THREE.Group();

    const floor = box(sw, 0.08, sd, shopFloorMat, false);
    floor.position.set(cx, 0.04, cz);
    floor.receiveShadow = true;
    shop.add(floor);
    const roof = box(sw + 0.1, 0.2, sd + 0.1, shopRoofMat, false);
    roof.position.set(cx, wh + 0.1, cz);
    shop.add(roof);

    function addWall(wx, wz, w, d, collide) {
      const m = box(w, wh, d, shopWallMat, true);
      m.position.set(wx, wh / 2, wz);
      m.receiveShadow = true;
      shop.add(m);
      if (collide) addCollider(colliders, wx, wz, w, d);
    }
    addWall(cx, SZ1 - wt / 2, sw, wt, true);          // back wall
    addWall(SX0 + wt / 2, cz, wt, sd, true);          // left wall
    addWall(SX1 - wt / 2, cz, wt, sd, true);          // right wall
    const frontZ = SZ0 + wt / 2;
    const segW = (sw - doorW) / 2;
    addWall(SX0 + segW / 2, frontZ, segW, wt, true);  // left front segment
    addWall(SX1 - segW / 2, frontZ, segW, wt, true);  // right front segment
    const lintel = box(doorW + 0.1, 0.45, wt, shopWoodMat, false);
    lintel.position.set(cx, wh - 0.225, frontZ);
    shop.add(lintel);

    // rug
    const rug = box(3.4, 0.03, 2.4, shopRugMat, false);
    rug.position.set(cx, 0.09, cz - 0.2);
    rug.receiveShadow = true;
    shop.add(rug);

    // L-bar: long run along the back + a short return down the left
    const counterTopY = 1.02;
    function addCounter(wx, wz, w, d) {
      const base = box(w, 1.0, d, shopWoodMat, true);
      base.position.set(wx, 0.5, wz);
      base.castShadow = true; base.receiveShadow = true;
      const top = box(w + 0.08, 0.08, d + 0.08, shopCounterTopMat, false);
      top.position.set(wx, counterTopY, wz);
      shop.add(base, top);
    }
    addCounter(cx - 0.6, SZ1 - 1.1, 5.0, 0.8);   // along back wall
    addCounter(SX0 + 1.1, cz + 0.4, 0.8, 2.6);   // return down the left

    // back-bar bottle wall (glowing shelves of "bottles" — instanced spines)
    const bottleXforms = [];
    const bottleColors = ["#4fffa0", "#ff4fa3", "#ffe24f", "#4fd2ff", "#ff7a2f", "#b14fff"];
    const bottleColorList = [];
    const tmpB = new THREE.Matrix4();
    for (let s = 0; s < 2; s++) {
      const sy = 1.45 + s * 0.55;
      const board = box(4.6, 0.05, 0.32, shopShelfMat, false);
      board.position.set(cx - 0.6, sy, SZ1 - 0.4);
      shop.add(board);
      for (let i = 0; i < 16; i++) {
        const bxp = cx - 2.7 + i * 0.27;
        tmpB.makeScale(1, 0.9 + (i % 3) * 0.18, 1);
        tmpB.setPosition(bxp, sy + 0.28, SZ1 - 0.42);
        bottleXforms.push(tmpB.clone());
        bottleColorList.push(bottleColors[(i + s) % bottleColors.length]);
      }
    }
    // a glowing material so the back-bar reads as lit liquor (registered to flicker)
    const bottleMat = new THREE.MeshStandardMaterial({
      color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6, roughness: 0.5,
    });
    const bottleGeo = new THREE.BoxGeometry(0.1, 0.42, 0.1);
    const bottleInst = new THREE.InstancedMesh(bottleGeo, bottleMat, bottleXforms.length);
    const _bc = new THREE.Color();
    for (let i = 0; i < bottleXforms.length; i++) {
      bottleInst.setMatrixAt(i, bottleXforms[i]);
      bottleInst.setColorAt(i, _bc.set(bottleColorList[i]));
    }
    bottleInst.instanceMatrix.needsUpdate = true;
    if (bottleInst.instanceColor) bottleInst.instanceColor.needsUpdate = true;
    bottleInst.castShadow = false; bottleInst.receiveShadow = false;
    shop.add(bottleInst);
    neonMats.push({ mat: bottleMat, base: 0.6, phase: 0.7, speed: 2.4 });

    // stools at the back bar
    function addShopStool(x, z) {
      const pole = new THREE.Mesh(shopStoolPoleGeo, metalMat);
      pole.position.set(x, 0.35, z);
      pole.castShadow = true;
      const seat = new THREE.Mesh(shopStoolSeatGeo, stoolSeatMat);
      seat.position.set(x, 0.72, z);
      seat.castShadow = true;
      shop.add(pole, seat);
    }
    for (const sx of [cx - 2.0, cx - 0.6, cx + 0.8, cx + 2.2]) addShopStool(sx, SZ1 - 2.1);

    // a small booth table + two seats near the door corner (right-front)
    const tableLeg = box(0.12, 0.7, 0.12, shopWoodMat, true);
    tableLeg.position.set(SX1 - 1.4, 0.35, SZ0 + 1.6);
    const tableTop = box(1.0, 0.08, 1.0, shopCounterTopMat, false);
    tableTop.position.set(SX1 - 1.4, 0.72, SZ0 + 1.6);
    shop.add(tableLeg, tableTop);
    for (const [sx, sz] of [[SX1 - 2.0, SZ0 + 1.6], [SX1 - 0.8, SZ0 + 1.6]]) {
      const cube = box(0.5, 0.45, 0.5, stoolSeatMat, true);
      cube.position.set(sx, 0.22, sz);
      shop.add(cube);
    }

    // pendant lights
    const shopBulbs = [];
    for (const [bx, bz] of [[cx - 1.2, cz - 0.3], [cx + 1.2, cz + 0.6]]) {
      const cord = new THREE.Mesh(shopCordGeo, frameMat);
      cord.scale.y = 0.9;
      cord.position.set(bx, wh - 0.45, bz);
      const bulb = new THREE.Mesh(shopBulbGeo, shopBulbMat);
      bulb.position.set(bx, wh - 0.95, bz);
      shop.add(cord, bulb);
      shopBulbs.push(bulb);
    }

    // interior neon strip behind the bar
    const innerSign = artPanel(3.0, 0.7, "neon", {
      lines: ["AFTER HOURS"], color: "#ff7a2f", color2: "#4fd2ff",
      emissiveIntensity: 0.9, file: "neon-afterhours-inner.png",
    });
    innerSign.position.set(cx - 0.6, 2.45, SZ1 - 0.16);
    innerSign.rotation.y = Math.PI; // faces into the room toward the door
    shop.add(innerSign);
    neonMats.push({ mat: innerSign.material, base: 0.9, phase: 4.1, speed: 3.3 });

    // exterior sign above the door, facing the lane (−Z)
    const shopSign = artPanel(4.6, 1.1, "sign", {
      text: "AFTER HOURS", bg: "#1a0f24", fg: "#ffd27a", file: "sign-afterhours.png",
    });
    shopSign.position.set(cx, wh + 0.55, SZ0 - 0.06);
    shopSign.rotation.y = Math.PI;
    shopSign.material.emissiveIntensity = 0.7;
    shop.add(shopSign);
    const signFrame = box(4.9, 1.35, 0.1, frameMat, false);
    signFrame.position.set(cx, wh + 0.55, SZ0 - 0.12);
    shop.add(signFrame);

    group.add(shop);
    for (const b of shopBulbs) bulbStrings.push(b);
  }

  // ── ENTERABLE SHOP #3: "PIXEL PALACE" neon arcade ──────────────────────────
  // South-centre, footprint X∈[0.5,8.5], Z∈[3,9] (8 m × 6 m), sitting between the
  // dance floor and the VINYL & TONIC shop, clear of both. DOORWAY faces the lane
  // (−Z). Inside: a row of arcade cabinets (glowing instanced screens), a prize/
  // token counter, a couple of stools, a glowing high-score board, pendant
  // lights, and signage. The emissive screens flicker with the district neon.
  {
    const SX0 = 0.5, SX1 = 8.5;
    const SZ0 = 3, SZ1 = 9;
    const wh = 2.8, wt = 0.25;
    const cx = (SX0 + SX1) / 2; // 4.5
    const cz = (SZ0 + SZ1) / 2; // 6
    const sw = SX1 - SX0;       // 8
    const sd = SZ1 - SZ0;       // 6
    const doorW = 2.2;
    const shop = new THREE.Group();

    const floor = box(sw, 0.08, sd, shopFloorMat, false);
    floor.position.set(cx, 0.04, cz);
    floor.receiveShadow = true;
    shop.add(floor);
    const roof = box(sw + 0.1, 0.2, sd + 0.1, shopRoofMat, false);
    roof.position.set(cx, wh + 0.1, cz);
    shop.add(roof);

    function addWall(wx, wz, w, d, collide) {
      const m = box(w, wh, d, shopWallMat, true);
      m.position.set(wx, wh / 2, wz);
      m.receiveShadow = true;
      shop.add(m);
      if (collide) addCollider(colliders, wx, wz, w, d);
    }
    addWall(cx, SZ1 - wt / 2, sw, wt, true);          // back wall
    addWall(SX0 + wt / 2, cz, wt, sd, true);          // left wall
    addWall(SX1 - wt / 2, cz, wt, sd, true);          // right wall
    const frontZ = SZ0 + wt / 2;
    const segW = (sw - doorW) / 2;
    addWall(SX0 + segW / 2, frontZ, segW, wt, true);  // left front segment
    addWall(SX1 - segW / 2, frontZ, segW, wt, true);  // right front segment
    const lintel = box(doorW + 0.1, 0.45, wt, shopWoodMat, false);
    lintel.position.set(cx, wh - 0.225, frontZ);
    shop.add(lintel);

    // rug
    const rug = box(3.4, 0.03, 2.4, shopRugMat, false);
    rug.position.set(cx, 0.09, cz - 0.3);
    rug.receiveShadow = true;
    shop.add(rug);

    // a row of arcade cabinets along the back wall — cabinet body (shared mat) +
    // a glowing screen each (one InstancedMesh of emissive screens, flickering).
    const cabMat = shopShelfMat; // dark cabinet body reuses the shelf material
    const screenMat = new THREE.MeshStandardMaterial({
      color: "#101824", emissive: "#3fd6ff", emissiveIntensity: 0.8, roughness: 0.4, flatShading: true,
    });
    const screenGeo = new THREE.BoxGeometry(0.6, 0.5, 0.06);
    const screenXforms = [];
    const screenColors = ["#3fd6ff", "#ff4fa3", "#4fffa0", "#ffe24f"];
    const screenColorList = [];
    const tmpS = new THREE.Matrix4();
    const cabZ = SZ1 - 0.65;
    let ci = 0;
    for (const sx of [cx - 2.7, cx - 0.9, cx + 0.9, cx + 2.7]) {
      // cabinet body
      const cab = box(0.8, 1.7, 0.7, cabMat, true);
      cab.position.set(sx, 0.85, cabZ);
      cab.castShadow = true; cab.receiveShadow = true;
      // sloped control panel
      const panel = box(0.8, 0.12, 0.4, shopWoodMat, false);
      panel.position.set(sx, 0.95, cabZ - 0.5);
      panel.rotation.x = -0.5;
      shop.add(cab, panel);
      // glowing screen (instanced) angled on the cabinet face
      tmpS.makeRotationX(0.18);
      tmpS.setPosition(sx, 1.42, cabZ - 0.36);
      screenXforms.push(tmpS.clone());
      screenColorList.push(screenColors[ci % screenColors.length]);
      ci++;
    }
    const screenInst = new THREE.InstancedMesh(screenGeo, screenMat, screenXforms.length);
    const _sc = new THREE.Color();
    for (let i = 0; i < screenXforms.length; i++) {
      screenInst.setMatrixAt(i, screenXforms[i]);
      screenInst.setColorAt(i, _sc.set(screenColorList[i]));
    }
    screenInst.instanceMatrix.needsUpdate = true;
    if (screenInst.instanceColor) screenInst.instanceColor.needsUpdate = true;
    screenInst.castShadow = false; screenInst.receiveShadow = false;
    shop.add(screenInst);
    neonMats.push({ mat: screenMat, base: 0.8, phase: 5.0, speed: 4.0 });

    // token / prize counter along the right wall
    const base = box(0.8, 1.0, 3.2, shopWoodMat, true);
    base.position.set(SX1 - 0.6, 0.5, cz + 0.4);
    base.castShadow = true; base.receiveShadow = true;
    const top = box(0.9, 0.08, 3.3, shopCounterTopMat, false);
    top.position.set(SX1 - 0.6, 1.02, cz + 0.4);
    shop.add(base, top);

    // a couple of stools facing the cabinets
    function addShopStool(x, z) {
      const pole = new THREE.Mesh(shopStoolPoleGeo, metalMat);
      pole.position.set(x, 0.35, z);
      pole.castShadow = true;
      const seat = new THREE.Mesh(shopStoolSeatGeo, stoolSeatMat);
      seat.position.set(x, 0.72, z);
      seat.castShadow = true;
      shop.add(pole, seat);
    }
    addShopStool(cx - 1.8, SZ1 - 2.0);
    addShopStool(cx + 0.0, SZ1 - 2.0);

    // pendant lights
    const shopBulbs = [];
    for (const [bx, bz] of [[cx - 1.4, cz - 0.4], [cx + 1.4, cz + 0.4]]) {
      const cord = new THREE.Mesh(shopCordGeo, frameMat);
      cord.scale.y = 0.9;
      cord.position.set(bx, wh - 0.45, bz);
      const bulb = new THREE.Mesh(shopBulbGeo, shopBulbMat);
      bulb.position.set(bx, wh - 0.95, bz);
      shop.add(cord, bulb);
      shopBulbs.push(bulb);
    }

    // interior high-score / now-playing neon strip on the left wall
    const innerSign = artPanel(2.4, 0.7, "neon", {
      lines: ["HIGH SCORE"], color: "#4fffa0", color2: "#ff4fa3",
      emissiveIntensity: 0.9, file: "neon-highscore-inner.png",
    });
    innerSign.position.set(SX0 + 0.16, 2.0, cz);
    innerSign.rotation.y = Math.PI / 2; // faces +X into the room
    shop.add(innerSign);
    neonMats.push({ mat: innerSign.material, base: 0.9, phase: 1.7, speed: 3.6 });

    // exterior sign above the door, facing the lane (−Z)
    const shopSign = artPanel(4.2, 1.1, "sign", {
      text: "PIXEL PALACE", bg: "#10002b", fg: "#4cc9f0", file: "sign-pixelpalace.png",
    });
    shopSign.position.set(cx, wh + 0.55, SZ0 - 0.06);
    shopSign.rotation.y = Math.PI;
    shopSign.material.emissiveIntensity = 0.7;
    shop.add(shopSign);
    const signFrame = box(4.5, 1.35, 0.1, frameMat, false);
    signFrame.position.set(cx, wh + 0.55, SZ0 - 0.12);
    shop.add(signFrame);

    group.add(shop);
    for (const b of shopBulbs) bulbStrings.push(b);
  }

  // ── EXTRA STREET FLAVOR — benches, crates, a planter row, a food stall ──────
  // Small lived-in props scattered on the open pavement, all clear of the
  // through-lane (Z∈[-6,6]) and the new shop footprints / building setbacks.
  {
    // simple wooden bench (slats + two legs), reused via a helper
    function addBench(x, z, rotY) {
      const g = new THREE.Group();
      const seat = box(1.8, 0.12, 0.5, shopWoodMat, true);
      seat.position.y = 0.5;
      const backrest = box(1.8, 0.5, 0.1, shopWoodMat, true);
      backrest.position.set(0, 0.8, -0.2);
      g.add(seat, backrest);
      for (const lx of [-0.75, 0.75]) {
        const leg = box(0.12, 0.5, 0.45, frameMat, false);
        leg.position.set(lx, 0.25, 0);
        g.add(leg);
      }
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      group.add(g);
    }
    addBench(-11.5, 8.4, 0);          // SW, in the gap beside AFTER HOURS
    addBench(-1.0, -8.6, Math.PI);    // north kerb under the lounge windows
    addBench(21.0, 8.6, 0);           // SE corner pavement

    // a little stack of crates (street clutter)
    function addCrates(x, z) {
      const c0 = box(0.7, 0.7, 0.7, shopWoodMat, true);
      c0.position.set(x, 0.35, z);
      const c1 = box(0.6, 0.6, 0.6, shopWoodMat, true);
      c1.position.set(x + 0.15, 0.95, z + 0.1);
      const c2 = box(0.55, 0.55, 0.55, shopWoodMat, true);
      c2.position.set(x - 0.25, 0.32, z + 0.55);
      group.add(c0, c1, c2);
    }
    addCrates(-22.5, -8.0);   // NW corner alley clutter (clear of buildings)
    addCrates(11.5, 9.2);     // SE, between the two south shops

    // a tidy row of glowing planters along the NORTH lane edge (decorative);
    // sits at z≈-6.8, just clear of the drive-lane (Z∈[-6,6]) in the pedestrian
    // cross-lane gaps, so it never blocks the through-route.
    for (const px of [-9.0, 0.0, 9.0]) {
      const planter = box(1.2, 0.5, 0.6, planterMat, true);
      planter.position.set(px, 0.25, -6.8);
      group.add(planter);
      // a small lit shrub on top (emissive, registered to flicker softly)
      const shrubMat = new THREE.MeshStandardMaterial({
        color: "#173a26", emissive: "#2fae5a", emissiveIntensity: 0.3, roughness: 0.9, flatShading: true,
      });
      const shrub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), shrubMat);
      shrub.position.set(px, 0.75, -6.8);
      shrub.castShadow = true;
      group.add(shrub);
      neonMats.push({ mat: shrubMat, base: 0.3, phase: px, speed: 1.6 });
    }

    // a small street food stall (cart + striped canopy + a glowing menu board)
    const stall = new THREE.Group();
    const cart = box(2.2, 1.0, 1.0, shopWoodMat, true);
    cart.position.y = 0.5;
    const cartTop = box(2.3, 0.1, 1.1, shopCounterTopMat, false);
    cartTop.position.y = 1.02;
    const canopy = box(2.6, 0.12, 1.4, awningMat, false);
    canopy.position.y = 2.0;
    stall.add(cart, cartTop, canopy);
    // four canopy posts
    for (const [lx, lz] of [[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.95, 6), poleMat);
      post.position.set(lx, 1.0, lz);
      stall.add(post);
    }
    // a glowing menu board on the cart, facing the lane
    const menu = artPanel(1.6, 0.7, "sign", {
      text: "NOODLES", bg: "#2a0f1f", fg: "#ffd27a", file: "sign-noodles.png",
    });
    menu.position.set(0, 1.55, -0.55);
    menu.material.emissiveIntensity = 0.7;
    stall.add(menu);
    stall.position.set(-20.0, 0, -7.5); // NW pavement, clear of buildings + lane
    group.add(stall);
  }

  // ── UPDATE: flicker neon, cycle hues, spin marquee, pulse dance floor ──
  let t = 0;
  const _col = new THREE.Color(); // reused, no per-frame allocation
  function update(dt) {
    t += dt;
    // Neon flicker — vary emissiveIntensity around its base value
    for (let i = 0; i < neonMats.length; i++) {
      const n = neonMats[i];
      const f = 0.78 + 0.22 * Math.sin(t * n.speed + n.phase)
        + (Math.sin(t * 41.0 + n.phase) > 0.92 ? -0.35 : 0); // occasional dropout
      n.mat.emissiveIntensity = n.base * Math.max(0.35, f);
    }
    // Cycle hue on trim/lane/marquee glow
    for (let i = 0; i < cycleMats.length; i++) {
      const c = cycleMats[i];
      const hue = (t * 0.06 + c.hueOffset) % 1;
      _col.setHSL(hue, 0.85, 0.55);
      c.mat.emissive.copy(_col);
    }
    // Marquee slow oscillation (looks like it's turning to catch the eye)
    marqueePivot.rotation.y = Math.sin(t * 0.5) * 0.6;
    // Bulb string twinkle (chase pattern)
    for (let i = 0; i < bulbStrings.length; i++) {
      const phase = Math.sin(t * 6 - i * 0.5);
      // shared bulb material, so twinkle via per-bulb scale
      bulbStrings[i].scale.setScalar(0.85 + 0.25 * Math.max(0, phase));
    }
    // Dance floor pulse — each tile breathes out of phase
    for (let i = 0; i < danceTiles.length; i++) {
      const d = danceTiles[i];
      d.mat.emissiveIntensity = 0.6 + 0.7 * (0.5 + 0.5 * Math.sin(t * 4 + d.phase));
      const hue = (t * 0.12 + d.phase * 0.15) % 1;
      _col.setHSL(hue, 0.9, 0.6);
      d.mat.emissive.copy(_col);
    }
    // Glowing dance-floor window — pulses + cycles hue with the floor
    danceWinMat.emissiveIntensity = 0.9 + 0.6 * (0.5 + 0.5 * Math.sin(t * 4 + 1.3));
    _col.setHSL((t * 0.12 + 0.4) % 1, 0.9, 0.6);
    danceWinMat.emissive.copy(_col);
  }

  // ground: full-tile walkable rect (buildings block via colliders)
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  return { group, colliders, ground, update };
}
