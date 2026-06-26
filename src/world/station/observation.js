// OBSERVATION DECK — a stunning panoramic lounge bolted onto the orbital space
// station, meant to be walked into at altitude (deck top at world floorY≈260).
//
// What this module builds (everything inside one THREE.Group placed at the world
// anchor (ox, floorY, oz); ALL child meshes use LOCAL coords with the deck top at
// local y = 0):
//   • A huge CURVED, floor-to-ceiling PANORAMIC WINDOW sweeping the +Z wall, framed
//     in metallic mullions, with a big beautiful EARTH (ocean + drifting clouds +
//     atmosphere rim + continents), a deep STARFIELD, and a passing SATELLITE
//     visible through it — all hanging out in space beyond the glass.
//   • Two MOUNTED TELESCOPES on tripods angled up at the planet, comfy curved
//     LOUNGE SOFAS + low glass TABLES facing the window, POTTED PLANTS, a glowing
//     STAR-CHART wall on the back bulkhead, side CONSOLES with holo screens.
//   • Soft warm RIM LIGHTING: cove light-strips along the walls + ceiling, a cool
//     earthshine wash by the glass, real PointLights, metallic TRIM + GREEBLES.
//
// ── CONTRACT (mirrors the other world modules) ────────────────────────────────
//   buildStationObservation(opts) -> { group, update(dt), ground, colliders }
//     group     — THREE.Group anchored at world (ox, floorY, oz); local content.
//     ground    — ONE walkable deck rect in WORLD XZ coords.
//     colliders — tight WORLD-XZ AABBs for SOLID furniture only (sofas, tables,
//                 telescopes, planters, consoles); the central walk path is clear.
//     update(dt)— spins the Earth + clouds, drifts the satellite, twinkles +
//                 parallaxes the stars, breathes the warm light-strips. ALL via
//                 cached refs / component-wise writes — zero allocation per frame.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// Materials are created ONCE at module scope. The build phase allocates freely;
// update(dt) only mutates cached transforms + material scalars (no `new`, no Vec3
// churn — positions written via .set / += on component fields).

import * as THREE from "three";

// ── Shared materials (created ONCE) ───────────────────────────────────────────
// Deck / structure.
const deckMat      = new THREE.MeshStandardMaterial({ color: "#363c45", roughness: 0.62, metalness: 0.55 });
const deckInlayMat = new THREE.MeshStandardMaterial({ color: "#5a6470", roughness: 0.4, metalness: 0.7, emissive: "#1a2b3a", emissiveIntensity: 0.3 });
const rugMat       = new THREE.MeshStandardMaterial({ color: "#5a3f3a", roughness: 0.95, metalness: 0.0 });
const wallMat      = new THREE.MeshStandardMaterial({ color: "#c5ccd5", roughness: 0.55, metalness: 0.28, side: THREE.DoubleSide });
const wallRibMat   = new THREE.MeshStandardMaterial({ color: "#8f98a3", roughness: 0.45, metalness: 0.55 });
const ceilMat      = new THREE.MeshStandardMaterial({ color: "#aab2bc", roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
const trimMat      = new THREE.MeshStandardMaterial({ color: "#aeb6c0", roughness: 0.32, metalness: 0.85 });
const greebleMat   = new THREE.MeshStandardMaterial({ color: "#6b747f", roughness: 0.5, metalness: 0.6 });
// Warm cove strips + cool earthshine accent (emissive scalars are breathed in update).
const warmGlowMat  = new THREE.MeshStandardMaterial({ color: "#ffe6c0", roughness: 0.3, emissive: "#ffb968", emissiveIntensity: 0.9 });
const coolGlowMat  = new THREE.MeshStandardMaterial({ color: "#bfe0ff", roughness: 0.3, emissive: "#7fb4ff", emissiveIntensity: 0.7 });
// Panoramic window.
const frameMat     = new THREE.MeshStandardMaterial({ color: "#5a626b", roughness: 0.35, metalness: 0.8 });
const glassMat     = new THREE.MeshStandardMaterial({ color: "#0a1830", roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, emissive: "#0a1a34", emissiveIntensity: 0.18 });
// Lounge furniture.
const sofaMat      = new THREE.MeshStandardMaterial({ color: "#2f6e6b", roughness: 0.85, metalness: 0.05 });
const cushionMat   = new THREE.MeshStandardMaterial({ color: "#3f8f8a", roughness: 0.9, metalness: 0.0 });
const sofaFootMat  = new THREE.MeshStandardMaterial({ color: "#caa23a", roughness: 0.4, metalness: 0.7 });
const tableTopMat  = new THREE.MeshStandardMaterial({ color: "#14202c", roughness: 0.12, metalness: 0.3, transparent: true, opacity: 0.78 });
const tableLegMat  = new THREE.MeshStandardMaterial({ color: "#b8bec6", roughness: 0.3, metalness: 0.8 });
// Telescopes.
const scopeBodyMat = new THREE.MeshStandardMaterial({ color: "#e8edf2", roughness: 0.4, metalness: 0.3 });
const scopeTubeMat = new THREE.MeshStandardMaterial({ color: "#2a2e34", roughness: 0.5, metalness: 0.45 });
const scopeMetalMat= new THREE.MeshStandardMaterial({ color: "#9aa2ac", roughness: 0.35, metalness: 0.7 });
const scopeLensMat = new THREE.MeshStandardMaterial({ color: "#1a3a55", roughness: 0.1, metalness: 0.2, emissive: "#1a4a78", emissiveIntensity: 0.4 });
// Plants.
const planterMat   = new THREE.MeshStandardMaterial({ color: "#c9cdd2", roughness: 0.6, metalness: 0.2 });
const soilMat      = new THREE.MeshStandardMaterial({ color: "#3a2c22", roughness: 1.0 });
const foliageMat   = new THREE.MeshStandardMaterial({ color: "#4f9a55", roughness: 0.9, metalness: 0.0, flatShading: true });
const foliageMat2  = new THREE.MeshStandardMaterial({ color: "#3c7d46", roughness: 0.9, metalness: 0.0, flatShading: true });
// Star-chart wall + side consoles.
const chartFrameMat= new THREE.MeshStandardMaterial({ color: "#444b54", roughness: 0.4, metalness: 0.7 });
const chartMat     = new THREE.MeshStandardMaterial({ color: "#070c18", roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
const chartStarMat = new THREE.MeshStandardMaterial({ color: "#dfeaff", roughness: 0.4, emissive: "#bcd6ff", emissiveIntensity: 0.9 });
const chartLineMat = new THREE.MeshStandardMaterial({ color: "#6fa0d8", roughness: 0.5, emissive: "#3f7fd0", emissiveIntensity: 0.6 });
const consoleMat   = new THREE.MeshStandardMaterial({ color: "#3d444c", roughness: 0.5, metalness: 0.5 });
const screenMat    = new THREE.MeshStandardMaterial({ color: "#0d2740", roughness: 0.3, metalness: 0.2, emissive: "#2f9adf", emissiveIntensity: 0.7, side: THREE.DoubleSide });
// Deep-space bodies — opt OUT of fog so they stay crisp out the window.
const earthOceanMat= new THREE.MeshStandardMaterial({ color: "#1f5fae", roughness: 0.85, metalness: 0.0, emissive: "#0a1f3e", emissiveIntensity: 0.35, fog: false });
const earthLandMat = new THREE.MeshStandardMaterial({ color: "#3f7a46", roughness: 0.95, metalness: 0.0, emissive: "#10240f", emissiveIntensity: 0.25, flatShading: true, fog: false });
const earthIceMat  = new THREE.MeshStandardMaterial({ color: "#e8eef5", roughness: 0.85, metalness: 0.0, fog: false });
const cloudMat     = new THREE.MeshStandardMaterial({ color: "#f2f6fb", roughness: 1.0, metalness: 0.0, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
const atmoMat      = new THREE.MeshStandardMaterial({ color: "#6fb4ff", transparent: true, opacity: 0.35, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const satFoilMat   = new THREE.MeshStandardMaterial({ color: "#caa23a", roughness: 0.4, metalness: 0.7, fog: false });
const satBodyMat   = new THREE.MeshStandardMaterial({ color: "#cfd5db", roughness: 0.45, metalness: 0.5, fog: false });
const satPanelMat  = new THREE.MeshStandardMaterial({ color: "#1b2c63", roughness: 0.35, metalness: 0.25, emissive: "#163a8a", emissiveIntensity: 0.3, flatShading: true, fog: false });
const satDishMat   = new THREE.MeshStandardMaterial({ color: "#e9edf2", roughness: 0.4, metalness: 0.35, side: THREE.DoubleSide, fog: false });
const satBeaconMat = new THREE.MeshStandardMaterial({ color: "#ff5a4a", roughness: 0.4, emissive: "#ff3a2a", emissiveIntensity: 1.2, fog: false });
const heroStarMat  = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4, emissive: "#cfe2ff", emissiveIntensity: 1.0, fog: false });

// ── tiny mesh helpers ─────────────────────────────────────────────────────────
function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = true, receive = true) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}

// A self-contained little SATELLITE: foil bus, two solar wings, a dish, a red
// beacon (returned so the caller can blink it). Built once, drifted in update().
function makeSatellite() {
  const g = new THREE.Group();
  const bus = mesh(new THREE.BoxGeometry(1.5, 1.4, 2.0), satBodyMat, false, false);
  g.add(bus);
  const wrap = mesh(new THREE.BoxGeometry(1.54, 0.9, 1.2), satFoilMat, false, false);
  g.add(wrap);
  for (const sx of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), scopeMetalMat, false, false);
    arm.rotation.z = Math.PI / 2;
    arm.position.x = sx * 1.4;
    g.add(arm);
    const wing = mesh(new THREE.BoxGeometry(3.8, 0.07, 1.5), satPanelMat, false, false);
    wing.position.set(sx * 3.5, 0, 0);
    g.add(wing);
  }
  const dish = mesh(new THREE.ConeGeometry(0.8, 0.45, 14, 1, true), satDishMat, false, false);
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, 0.2, 1.4);
  g.add(dish);
  const whip = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), scopeMetalMat, false, false);
  whip.position.set(0, 1.1, -0.6);
  g.add(whip);
  const beacon = mesh(new THREE.SphereGeometry(0.18, 8, 6), satBeaconMat, false, false);
  beacon.position.set(0, 0.85, 0);
  g.add(beacon);
  return g;
}

export function buildStationObservation(opts = {}) {
  const ox = opts.ox ?? 358;
  const oz = opts.oz ?? 130;
  const floorY = opts.floorY ?? 260;

  const group = new THREE.Group();
  group.name = "stationObservation";
  group.position.set(ox, floorY, oz);

  // Contract arrays (WORLD coords).
  const ground = [{ minX: ox - 19, maxX: ox + 19, minZ: oz - 16, maxZ: oz + 16 }];
  const colliders = [];
  // Push a tight WORLD AABB for a piece of furniture given its LOCAL centre + size.
  const addCol = (lx, lz, w, d) => {
    colliders.push({ minX: ox + lx - w / 2, maxX: ox + lx + w / 2, minZ: oz + lz - d / 2, maxZ: oz + lz + d / 2 });
  };

  // Animated handles, collected at build → mutated allocation-free in update().
  let earthCore = null;     // ocean + continents (spins)
  let earthClouds = null;   // cloud shell (spins slightly faster)
  let starField = null;     // THREE.Points (twinkle via opacity + parallax via position)
  let satellite = null;     // drifting satellite group
  let satBeacon = null;     // its blinking light material
  const STAR_BASE_OPACITY = 0.82;

  // Deck footprint half-extents (matches the `ground` rect above).
  const HX = 19, HZ = 16, H = 7; // half-width, half-depth, ceiling height (local)

  // ── DECK FLOOR ──────────────────────────────────────────────────────────────
  const floor = box(HX * 2, 0.4, HZ * 2, deckMat, false, true);
  floor.position.y = -0.2;
  group.add(floor);
  // Brushed inlay ring + a long inlay runway pointing at the window (orientation).
  const inlayRing = mesh(new THREE.RingGeometry(6.0, 6.6, 56), deckInlayMat, false, true);
  inlayRing.rotation.x = -Math.PI / 2;
  inlayRing.position.y = 0.012;
  group.add(inlayRing);
  const runway = box(2.2, 0.02, 22, deckInlayMat, false, true);
  runway.position.set(0, 0.01, 4);
  group.add(runway);
  // A warm lounge rug under the sofas.
  const rug = mesh(new THREE.CircleGeometry(8.5, 40), rugMat, false, true);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.02, 6.5);
  group.add(rug);

  // ── CEILING ─────────────────────────────────────────────────────────────────
  const ceil = box(HX * 2, 0.4, HZ * 2, ceilMat, false, false);
  ceil.position.y = H + 0.2;
  group.add(ceil);
  // Recessed warm ceiling light-strips (longitudinal).
  for (const sx of [-12, -6, 0, 6, 12]) {
    const strip = box(1.0, 0.08, HZ * 2 - 3, warmGlowMat, false, false);
    strip.position.set(sx, H - 0.05, 0);
    group.add(strip);
  }

  // ── SIDE + BACK BULKHEAD WALLS (with ribs, cove glow, greebles) ──────────────
  const buildSideWall = (sx) => {
    const wall = box(0.5, H, HZ * 2, wallMat, false, true);
    wall.position.set(sx * HX, H / 2, 0);
    group.add(wall);
    // Vertical ribs.
    for (let z = -HZ + 3; z <= HZ - 3; z += 4) {
      const rib = box(0.3, H - 0.6, 0.5, wallRibMat, false, false);
      rib.position.set(sx * (HX - 0.35), H / 2, z);
      group.add(rib);
    }
    // Warm cove strip along the wall/ceiling join.
    const cove = box(0.25, 0.3, HZ * 2 - 2, warmGlowMat, false, false);
    cove.position.set(sx * (HX - 0.3), H - 0.5, 0);
    group.add(cove);
    // A few pipe/greeble runs low on the wall.
    for (const z of [-10, 8]) {
      const pipe = mesh(new THREE.CylinderGeometry(0.18, 0.18, 6, 8), greebleMat, false, false);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(sx * (HX - 0.5), 1.4, z);
      group.add(pipe);
    }
  };
  buildSideWall(-1);
  buildSideWall(1);

  // Back bulkhead — two panels leaving a central doorway gap (entrance from -Z).
  for (const sgn of [-1, 1]) {
    const seg = box(HX - 3, H, 0.5, wallMat, false, true);
    seg.position.set(sgn * (HX / 2 + 1.5), H / 2, -HZ);
    group.add(seg);
  }
  // Lit door frame around the gap.
  const lintel = box(8, 0.5, 0.6, trimMat, false, false);
  lintel.position.set(0, H - 0.6, -HZ);
  group.add(lintel);
  for (const sx of [-1, 1]) {
    const jamb = box(0.5, H - 1.2, 0.6, trimMat, false, false);
    jamb.position.set(sx * 3.25, (H - 1.2) / 2, -HZ);
    group.add(jamb);
  }
  const doorGlow = box(7, 0.18, 0.2, coolGlowMat, false, false);
  doorGlow.position.set(0, H - 1.0, -HZ + 0.3);
  group.add(doorGlow);
  // Warm cove along the back wall top.
  const backCove = box(HX * 2 - 2, 0.3, 0.25, warmGlowMat, false, false);
  backCove.position.set(0, H - 0.5, -(HZ - 0.3));
  group.add(backCove);

  // ── STAR-CHART WALL (framed glowing panels on the back bulkhead) ─────────────
  const chartWall = new THREE.Group();
  chartWall.position.set(0, 0, -(HZ - 0.28));
  group.add(chartWall);
  for (const px of [-11, 11]) {
    const panel = new THREE.Group();
    panel.position.set(px, 3.6, 0);
    chartWall.add(panel);
    const frame = box(8.2, 4.6, 0.25, chartFrameMat, false, false);
    panel.add(frame);
    const face = mesh(new THREE.PlaneGeometry(7.6, 4.0), chartMat, false, false);
    face.position.z = 0.14;
    panel.add(face);
    // Scatter star dots + a couple of constellation lines on the chart face.
    const dots = [];
    for (let i = 0; i < 16; i++) {
      const dx = (Math.random() * 2 - 1) * 3.4;
      const dy = (Math.random() * 2 - 1) * 1.7;
      const s = 0.05 + Math.random() * 0.08;
      const d = mesh(new THREE.SphereGeometry(s, 6, 5), chartStarMat, false, false);
      d.position.set(dx, dy, 0.16);
      panel.add(d);
      dots.push(d);
    }
    for (let i = 0; i < 6; i++) {
      const a = dots[i], b = dots[i + 1];
      const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
      const len = Math.hypot(dx, dy);
      const line = box(len, 0.04, 0.02, chartLineMat, false, false);
      line.position.set((a.position.x + b.position.x) / 2, (a.position.y + b.position.y) / 2, 0.15);
      line.rotation.z = Math.atan2(dy, dx);
      panel.add(line);
    }
  }

  // ── CURVED PANORAMIC WINDOW along the +Z wall ────────────────────────────────
  // Built from flat glass panes arranged on an arc that bulges OUTWARD (+Z), with
  // metallic mullions between, a top header + a low sill. Centre of curvature sits
  // behind the deck so the glass sweeps toward the viewer.
  const RW = 24;                 // arc radius
  const CZ = (HZ - 1) - RW;      // centre of curvature (local z, well behind the glass)
  const HALF_ARC = 0.95;         // half sweep (rad) → panes span ~±18 in x
  const PANES = 11;
  const winTopY = H - 0.2;       // glass goes floor (≈0) to just under ceiling
  for (let i = 0; i < PANES; i++) {
    const a = -HALF_ARC + (2 * HALF_ARC) * (i / (PANES - 1));
    const wx = Math.sin(a) * RW;
    const wz = CZ + Math.cos(a) * RW;
    // Glass pane (a touch oversized so panes overlap their mullions cleanly).
    const paneW = (2 * HALF_ARC * RW) / PANES + 0.4;
    const pane = mesh(new THREE.PlaneGeometry(paneW, winTopY - 0.1), glassMat, false, false);
    pane.position.set(wx, (winTopY) / 2 + 0.05, wz);
    pane.rotation.y = -a;        // normal points radially outward (+Z at a=0)
    group.add(pane);
  }
  // Vertical mullions on the pane boundaries.
  for (let i = 0; i <= PANES; i++) {
    const a = -HALF_ARC + (2 * HALF_ARC) * (i / PANES);
    const wx = Math.sin(a) * RW;
    const wz = CZ + Math.cos(a) * RW;
    const mull = box(0.28, winTopY, 0.5, frameMat, true, false);
    mull.position.set(wx, winTopY / 2, wz);
    mull.rotation.y = -a;
    group.add(mull);
  }
  // Curved header + sill + a mid-rail, plus a cool earthshine cove on the sill.
  for (const ry of [winTopY, 1.8, 0.25]) {
    for (let i = 0; i < PANES; i++) {
      const a = -HALF_ARC + (2 * HALF_ARC) * ((i + 0.5) / PANES);
      const wx = Math.sin(a) * RW;
      const wz = CZ + Math.cos(a) * RW;
      const segW = (2 * HALF_ARC * RW) / PANES + 0.5;
      const isSill = ry === 0.25;
      const rail = box(segW, ry === winTopY ? 0.6 : 0.3, 0.55, isSill ? coolGlowMat : frameMat, true, false);
      rail.position.set(wx, ry, wz);
      rail.rotation.y = -a;
      group.add(rail);
    }
  }

  // ── DEEP SPACE beyond the glass: EARTH + STARFIELD + SATELLITE ───────────────
  // EARTH (a tilted group: spinning core of ocean+continents, a cloud shell, an
  // additive atmosphere rim). Hangs big and low-right out the window.
  const earth = new THREE.Group();
  earth.position.set(7, 1.5, 62);
  earth.rotation.z = 0.41;       // axial tilt
  group.add(earth);
  const ER = 16;
  earthCore = new THREE.Group();
  earth.add(earthCore);
  const ocean = mesh(new THREE.SphereGeometry(ER, 48, 32), earthOceanMat, false, false);
  earthCore.add(ocean);
  // Continents — flattened blobs sat on the surface, parented so they spin along.
  const continents = [
    [0.5, 0.3, 5], [0.1, 1.7, 6], [-0.6, 2.6, 5], [0.9, 4.0, 4],
    [-0.3, 5.0, 5], [0.3, 3.2, 4], [-0.9, 0.9, 3.5],
  ];
  for (const [lat, lon, sz] of continents) {
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const px = ER * cl * Math.cos(lon), py = ER * sl, pz = ER * cl * Math.sin(lon);
    const land = mesh(new THREE.IcosahedronGeometry(sz, 1), Math.random() > 0.78 ? earthIceMat : earthLandMat, false, false);
    land.position.set(px * 0.99, py * 0.99, pz * 0.99);
    land.scale.set(1, 0.5, 1);
    land.lookAt(0, 0, 0);
    earthCore.add(land);
  }
  // Polar ice caps.
  for (const sy of [1, -1]) {
    const cap = mesh(new THREE.SphereGeometry(ER * 0.99, 24, 10, 0, Math.PI * 2, sy > 0 ? 0 : 2.74, 0.4), earthIceMat, false, false);
    earthCore.add(cap);
  }
  earthClouds = mesh(new THREE.SphereGeometry(ER * 1.02, 40, 24), cloudMat, false, false);
  earth.add(earthClouds);
  const atmosphere = mesh(new THREE.SphereGeometry(ER * 1.07, 40, 24), atmoMat, false, false);
  earth.add(atmosphere);

  // STARFIELD — a deep slab of Points beyond the glass (twinkles + parallaxes).
  const STAR_N = 1500;
  const starPos = new Float32Array(STAR_N * 3);
  for (let i = 0; i < STAR_N; i++) {
    starPos[i * 3] = (Math.random() * 2 - 1) * 120;
    starPos[i * 3 + 1] = (Math.random() * 2 - 1) * 60 + 14;
    starPos[i * 3 + 2] = 26 + Math.random() * 150;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: "#eaf2ff", size: 0.85, sizeAttenuation: true, transparent: true, opacity: STAR_BASE_OPACITY, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  starField = new THREE.Points(starGeo, starMat);
  group.add(starField);
  // A handful of bigger "hero" stars for depth.
  for (let i = 0; i < 14; i++) {
    const hs = mesh(new THREE.SphereGeometry(0.25 + Math.random() * 0.3, 6, 5), heroStarMat, false, false);
    hs.position.set((Math.random() * 2 - 1) * 90, (Math.random() * 2 - 1) * 45 + 16, 35 + Math.random() * 110);
    group.add(hs);
  }

  // SATELLITE — drifts across the window in update().
  satellite = makeSatellite();
  satellite.position.set(0, 8, 42);
  satellite.userData.ang = 0.0;
  group.add(satellite);
  // Grab the beacon material handle (last-added small sphere) for blinking.
  satBeacon = satBeaconMat;

  // ── LOUNGE SOFAS facing the window (left + right, central path stays clear) ───
  const buildSofa = (lx) => {
    const s = new THREE.Group();
    s.position.set(lx, 0, 5.5);
    group.add(s);
    const base = box(7.0, 0.7, 2.4, sofaMat, true, true);
    base.position.y = 0.55;
    s.add(base);
    const back = box(7.0, 1.5, 0.6, sofaMat, true, false);
    back.position.set(0, 1.35, -0.9);
    s.add(back);
    for (const ax of [-3.1, 3.1]) {
      const arm = box(0.7, 1.1, 2.4, sofaMat, true, false);
      arm.position.set(ax, 0.95, 0);
      s.add(arm);
    }
    for (const cx of [-2.1, 0, 2.1]) {
      const cush = box(1.9, 0.4, 1.9, cushionMat, true, false);
      cush.position.set(cx, 1.05, 0.1);
      s.add(cush);
    }
    for (const fx of [-3.2, 3.2]) for (const fz of [-1.0, 1.0]) {
      const foot = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8), sofaFootMat, false, false);
      foot.position.set(fx, 0.2, fz);
      s.add(foot);
    }
    addCol(lx, 5.5, 7.0, 2.4);
  };
  buildSofa(-7.5);
  buildSofa(7.5);

  // ── LOW GLASS TABLES in front of each sofa (toward the window) ───────────────
  const buildTable = (lx) => {
    const t = new THREE.Group();
    t.position.set(lx, 0, 8.6);
    group.add(t);
    const top = box(2.6, 0.12, 1.4, tableTopMat, true, false);
    top.position.y = 0.6;
    t.add(top);
    const rim = box(2.7, 0.1, 1.5, tableLegMat, false, false);
    rim.position.y = 0.52;
    t.add(rim);
    for (const fx of [-1.1, 1.1]) for (const fz of [-0.5, 0.5]) {
      const leg = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), tableLegMat, false, false);
      leg.position.set(fx, 0.3, fz);
      t.add(leg);
    }
    addCol(lx, 8.6, 2.6, 1.4);
  };
  buildTable(-7.5);
  buildTable(7.5);

  // ── MOUNTED TELESCOPES near the glass, angled up at the planet ───────────────
  const buildTelescope = (lx, lz, yaw) => {
    const tg = new THREE.Group();
    tg.position.set(lx, 0, lz);
    tg.rotation.y = yaw;
    group.add(tg);
    // Tripod legs.
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3);
      const leg = mesh(new THREE.CylinderGeometry(0.07, 0.05, 2.3, 8), scopeMetalMat, true, false);
      leg.position.set(Math.cos(a) * 0.7, 1.05, Math.sin(a) * 0.7);
      leg.rotation.z = Math.cos(a) * 0.32;
      leg.rotation.x = -Math.sin(a) * 0.32;
      tg.add(leg);
    }
    // Mount head.
    const head = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.5, 12), scopeBodyMat, true, false);
    head.position.y = 2.2;
    tg.add(head);
    // Optical tube (tilted up toward the window/planet).
    const tube = new THREE.Group();
    tube.position.set(0, 2.4, 0);
    tube.rotation.x = -0.95;     // tip up toward +Y/+Z
    tg.add(tube);
    const barrel = mesh(new THREE.CylinderGeometry(0.42, 0.42, 3.0, 18), scopeTubeMat, true, false);
    barrel.rotation.x = Math.PI / 2;
    tube.add(barrel);
    const collar = mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.5, 18), scopeBodyMat, true, false);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 0.9;
    tube.add(collar);
    const objective = mesh(new THREE.CircleGeometry(0.4, 18), scopeLensMat, false, false);
    objective.position.z = 1.51;
    tube.add(objective);
    const eyepiece = mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.6, 10), scopeMetalMat, true, false);
    eyepiece.position.set(0, -0.35, -1.3);
    tube.add(eyepiece);
    // Finder scope greeble.
    const finder = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 8), scopeMetalMat, true, false);
    finder.rotation.x = Math.PI / 2;
    finder.position.set(0.4, 0.45, 0.4);
    tube.add(finder);
    addCol(lx, lz, 1.6, 1.6);
  };
  buildTelescope(-12.5, 11.5, 0.35);
  buildTelescope(12.5, 11.5, -0.35);

  // ── POTTED PLANTS (back corners + window-side corners) ───────────────────────
  const buildPlant = (lx, lz, scl) => {
    const p = new THREE.Group();
    p.position.set(lx, 0, lz);
    p.scale.setScalar(scl);
    group.add(p);
    const pot = mesh(new THREE.CylinderGeometry(0.85, 0.65, 1.2, 14), planterMat, true, true);
    pot.position.y = 0.6;
    p.add(pot);
    const soil = mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.12, 14), soilMat, false, false);
    soil.position.y = 1.2;
    p.add(soil);
    // Layered foliage clumps.
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.7;
      const clump = mesh(new THREE.IcosahedronGeometry(0.55 + Math.random() * 0.4, 0), i % 2 ? foliageMat2 : foliageMat, true, false);
      clump.position.set(Math.cos(a) * r, 1.6 + Math.random() * 1.3, Math.sin(a) * r);
      clump.scale.set(1, 1.3, 1);
      p.add(clump);
    }
    addCol(lx, lz, 1.7 * scl, 1.7 * scl);
  };
  buildPlant(-16.5, -13, 1.0);
  buildPlant(16.5, -13, 1.0);
  buildPlant(-17, 9, 0.85);
  buildPlant(17, 9, 0.85);

  // ── SIDE CONSOLES with holo screens (flush to the walls, off the walk path) ──
  const buildConsole = (lx, lz, yaw) => {
    const c = new THREE.Group();
    c.position.set(lx, 0, lz);
    c.rotation.y = yaw;
    group.add(c);
    const body = box(3.2, 1.1, 1.0, consoleMat, true, true);
    body.position.y = 0.55;
    c.add(body);
    const deskTop = box(3.3, 0.1, 1.1, trimMat, true, false);
    deskTop.position.y = 1.1;
    c.add(deskTop);
    const scr = mesh(new THREE.PlaneGeometry(2.6, 1.2), screenMat, false, false);
    scr.position.set(0, 1.9, -0.1);
    scr.rotation.x = -0.18;
    c.add(scr);
    // greeble knobs.
    for (const kx of [-1, 0, 1]) {
      const knob = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8), trimMat, false, false);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(kx * 0.7, 0.9, 0.5);
      c.add(knob);
    }
    addCol(lx, lz, 3.2, 1.0);
  };
  buildConsole(-17.6, -3, Math.PI / 2);
  buildConsole(17.6, -3, -Math.PI / 2);

  // ── LIGHTS — warm rim + cool earthshine (non-shadow, distance-limited) ───────
  const warmA = new THREE.PointLight("#ffcaa0", 0.9, 34, 2.0);
  warmA.position.set(-10, H - 1.0, -8);
  group.add(warmA);
  const warmB = new THREE.PointLight("#ffd6b0", 0.9, 34, 2.0);
  warmB.position.set(10, H - 1.0, -8);
  group.add(warmB);
  const earthShine = new THREE.PointLight("#88b6ff", 1.1, 40, 2.0);
  earthShine.position.set(0, 4, 13);
  group.add(earthShine);
  const fill = new THREE.PointLight("#ffe8cc", 0.5, 30, 2.0);
  fill.position.set(0, H - 1, 4);
  group.add(fill);

  // ── ANIMATION — allocation-free (cached refs + component writes only) ────────
  let t = 0;
  function update(dt) {
    t += dt;
    // Earth slow spin; clouds drift a touch faster the other components.
    if (earthCore) earthCore.rotation.y += dt * 0.02;
    if (earthClouds) earthClouds.rotation.y += dt * 0.026;
    // Satellite drifts across the window on a slow arc; gentle tumble + beacon blink.
    if (satellite) {
      satellite.userData.ang += dt * 0.06;
      const a = satellite.userData.ang;
      satellite.position.set(Math.sin(a) * 34, 8 + Math.cos(a * 0.7) * 4, 42 + Math.sin(a * 0.5) * 8);
      satellite.rotation.y += dt * 0.25;
      satellite.rotation.x = Math.sin(a) * 0.2;
    }
    if (satBeacon) satBeacon.emissiveIntensity = Math.sin(t * 3.4) > 0.4 ? 1.4 : 0.12;
    // Starfield twinkle (global opacity) + a subtle parallax sway.
    if (starField) {
      starField.material.opacity = STAR_BASE_OPACITY + Math.sin(t * 1.3) * 0.12;
      starField.position.x = Math.sin(t * 0.04) * 0.7;
      starField.position.y = Math.cos(t * 0.031) * 0.4;
    }
    // Warm cove + cool earthshine strips breathe softly.
    warmGlowMat.emissiveIntensity = 0.85 + Math.sin(t * 0.6) * 0.18;
    coolGlowMat.emissiveIntensity = 0.6 + Math.sin(t * 0.45 + 1.2) * 0.16;
  }

  return { group, update, ground, colliders };
}
