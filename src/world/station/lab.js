// STATION LAB — a self-contained, walkable SCIENCE LAB module that drops onto the
// orbital station deck (or any deck) as ONE THREE.Group placed at a world origin.
//
// Contract (mirrors the ocean/space module shape used across this codebase):
//   buildStationLab(opts) -> { group, update(dt), ground, colliders }
//     • group     — a THREE.Group positioned at world (ox, floorY, oz). EVERYTHING
//                   inside is built in LOCAL coordinates on the deck (local y=0 is the
//                   deck top face), so the whole lab can be re-parented / moved freely.
//     • update(dt)— allocation-free per-frame animation: floating specimens bob, plasma
//                   cores flicker, the holographic molecule spins, screen waveforms
//                   dance, the robotic arm articulates, the containment field arcs, and
//                   vial racks pulse. Writes cached transforms / material scalars only;
//                   no `new` per frame.
//     • ground    — a single walkable deck rect (WORLD XZ AABB) the player can stand on.
//     • colliders — TIGHT world-space XZ AABBs for the SOLID furniture + perimeter walls,
//                   deliberately leaving a clear central walking path + a door on -X.
//
// Footprint: the deck spans local x[-19,19], z[-16,16] (38 x 32 m). The +Z wall is the
// CONTAINMENT bay (glowing chambers), the -Z wall is the WET BENCH row (microscopes /
// beakers / screens), -X holds analysis benches + the entry door, +X holds the energy
// containment ring, a robotic arm and a tall vial cabinet; the centre stages a floating
// holographic molecule. Clean white panelling + emissive cyan/teal accents + greebles.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// All STATIC, shared materials + geometries are created ONCE at module scope. The build
// phase may allocate freely (per-instance animated materials are made here so each glow
// can flicker on its own phase). update(dt) only mutates cached handles.

import * as THREE from "three";

// ── Shared, STATIC materials (created once) ───────────────────────────────────
const panelMat     = new THREE.MeshStandardMaterial({ color: "#eef2f7", roughness: 0.5,  metalness: 0.18, side: THREE.DoubleSide }); // clean white wall panels
const panelTrimMat = new THREE.MeshStandardMaterial({ color: "#c2cad4", roughness: 0.45, metalness: 0.35 });                          // panel seams / trim
const deckMat      = new THREE.MeshStandardMaterial({ color: "#b9c1cb", roughness: 0.55, metalness: 0.25 });                          // lab floor
const deckTrimMat  = new THREE.MeshStandardMaterial({ color: "#3a424c", roughness: 0.6,  metalness: 0.4 });                           // floor border inlay
const ceilMat      = new THREE.MeshStandardMaterial({ color: "#aab2bd", roughness: 0.6,  metalness: 0.3, side: THREE.DoubleSide });
const steelMat     = new THREE.MeshStandardMaterial({ color: "#9aa3ad", roughness: 0.4,  metalness: 0.7 });
const steelDarkMat = new THREE.MeshStandardMaterial({ color: "#3c424a", roughness: 0.55, metalness: 0.65 });
const benchTopMat  = new THREE.MeshStandardMaterial({ color: "#dde3ea", roughness: 0.35, metalness: 0.3 });
const benchBodyMat = new THREE.MeshStandardMaterial({ color: "#aeb6c0", roughness: 0.5,  metalness: 0.35 });
const rubberMat    = new THREE.MeshStandardMaterial({ color: "#23272d", roughness: 0.8,  metalness: 0.2 });
const glassMat     = new THREE.MeshStandardMaterial({ color: "#bfe9ff", roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
const cabGlassMat  = new THREE.MeshStandardMaterial({ color: "#cfe6ff", roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
const screenDarkMat= new THREE.MeshStandardMaterial({ color: "#0a141c", roughness: 0.3,  metalness: 0.2 });
const accentStatic = new THREE.MeshStandardMaterial({ color: "#1fa6ff", roughness: 0.3,  emissive: "#1fa6ff", emissiveIntensity: 0.7 });
const goldGreeble  = new THREE.MeshStandardMaterial({ color: "#caa23a", roughness: 0.4,  metalness: 0.65 });

// ── Shared, STATIC geometries (created once; instanced via cheap clones) ───────
const G = {
  beakerBody:  new THREE.CylinderGeometry(0.16, 0.18, 0.42, 14, 1, true),
  beakerLiq:   new THREE.CylinderGeometry(0.145, 0.16, 0.22, 14),
  flask:       new THREE.SphereGeometry(0.2, 14, 10),
  flaskNeck:   new THREE.CylinderGeometry(0.06, 0.06, 0.22, 10),
  vial:        new THREE.CylinderGeometry(0.07, 0.07, 0.6, 10),
  vialCap:     new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10),
  scopeBase:   new THREE.CylinderGeometry(0.22, 0.26, 0.1, 16),
  scopeArm:    new THREE.BoxGeometry(0.12, 0.5, 0.16),
  scopeTube:   new THREE.CylinderGeometry(0.06, 0.08, 0.34, 12),
  tabletGeo:   new THREE.BoxGeometry(0.5, 0.34, 0.03),
  pipeGeo:     new THREE.CylinderGeometry(0.09, 0.09, 1, 10), // scaled along Y per run
  bolt:        new THREE.CylinderGeometry(0.05, 0.05, 0.06, 6),
  waveBar:     new THREE.BoxGeometry(0.12, 1, 0.05),          // unit-height; scaled in update
  atom:        new THREE.IcosahedronGeometry(0.26, 1),
  bond:        new THREE.CylinderGeometry(0.05, 0.05, 1, 8),  // scaled per bond length
};

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = true, receive = true) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}
// Small palettes reused for liquids / specimens / vials.
const LIQUIDS = ["#2ee6c2", "#ff5fa2", "#5fa8ff", "#b6ff4d", "#ffb02e", "#a86bff"];
const SPECIMEN = ["#37ffd0", "#ff6ad5", "#7cc0ff", "#c8ff5a", "#ff9f43"];

export function buildStationLab(opts = {}) {
  const ox = opts.ox ?? 396;
  const oz = opts.oz ?? 130;
  const floorY = opts.floorY ?? 260;

  const group = new THREE.Group();
  group.name = "stationLab";
  group.position.set(ox, floorY, oz);

  // ── Contract arrays ─────────────────────────────────────────────────────────
  const ground = [{ minX: ox - 19, maxX: ox + 19, minZ: oz - 16, maxZ: oz + 16 }];
  const colliders = [];
  // Tight WORLD AABB from a LOCAL centre + size.
  function addCol(lx, lz, w, d) {
    colliders.push({ minX: ox + lx - w / 2, maxX: ox + lx + w / 2, minZ: oz + lz - d / 2, maxZ: oz + lz + d / 2 });
  }

  // ── Animated handle caches (mutated allocation-free in update) ───────────────
  const specimens = []; // { mesh, baseY, amp, rate, phase, spin }
  const glowPulse = []; // { mat, base, amp, rate, phase, amp2, rate2 }
  const spinners  = []; // { obj, rx, ry, rz }
  const waveBars  = []; // { mesh, bottomY, base, amp, rate, phase }
  const armJoints = []; // { obj, axis, base, amp, rate, phase }

  function addGlow(mat, base, amp, rate, phase, amp2 = 0, rate2 = 1) {
    glowPulse.push({ mat, base, amp, rate, phase, amp2, rate2 });
    return mat;
  }

  const H_WALL = 5;     // wall height
  const T_WALL = 0.4;   // wall thickness

  // ── DECK + floor detailing ──────────────────────────────────────────────────
  const deck = box(38, 0.4, 32, deckMat, false, true);
  deck.position.y = -0.2; // top face at local y=0
  group.add(deck);
  // Dark inlay border framing the deck just inside the walls (cosmetic greeble).
  for (const [w, d, cx, cz] of [[36.4, 0.4, 0, 15.0], [36.4, 0.4, 0, -15.0], [0.4, 30.0, 18.0, 0], [0.4, 30.0, -18.0, 0]]) {
    const inlay = box(w, 0.04, d, deckTrimMat, false, false);
    inlay.position.set(cx, 0.02, cz);
    group.add(inlay);
  }
  // Emissive floor accent: two long teal guide strips framing the central aisle.
  for (const sx of [-6.5, 6.5]) {
    const strip = box(0.18, 0.05, 26, addGlow(new THREE.MeshStandardMaterial({ color: "#0c2a30", emissive: "#23e8d0", emissiveIntensity: 0.8, roughness: 0.4 }), 0.7, 0.25, 0.6, sx), false, false);
    strip.position.set(sx, 0.03, 0);
    group.add(strip);
  }
  // A glowing hazard ring set into the floor under the central molecule stage.
  const floorRing = mesh(new THREE.RingGeometry(2.4, 2.9, 48), addGlow(new THREE.MeshStandardMaterial({ color: "#0b2030", emissive: "#1fa6ff", emissiveIntensity: 0.9, roughness: 0.4, side: THREE.DoubleSide }), 0.8, 0.3, 1.1, 0), false, false);
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = 0.03;
  group.add(floorRing);

  // ── PERIMETER WALLS (clean white panels) + colliders, door gap on -X ─────────
  function panelWall(cx, cz, w, d) {
    const wl = box(w, H_WALL, d, panelMat, false, true);
    wl.position.set(cx, H_WALL / 2, cz);
    group.add(wl);
    // Trim seams every few metres along the longer axis (cosmetic greeble).
    const along = w >= d ? "x" : "z";
    const span = Math.max(w, d);
    for (let s = -span / 2 + 2; s < span / 2 - 1; s += 3) {
      const seam = box(along === "x" ? 0.1 : d + 0.02, H_WALL, along === "x" ? d + 0.02 : 0.1, panelTrimMat, false, false);
      if (along === "x") seam.position.set(cx + s, H_WALL / 2, cz);
      else seam.position.set(cx, H_WALL / 2, cz + s);
      group.add(seam);
    }
  }
  panelWall(0, 15.8, 38, T_WALL);   addCol(0, 15.8, 38, T_WALL);   // +Z back (containment bay)
  panelWall(0, -15.8, 38, T_WALL);  addCol(0, -15.8, 38, T_WALL);  // -Z front (wet bench)
  panelWall(18.8, 0, T_WALL, 32);   addCol(18.8, 0, T_WALL, 32);   // +X right
  // -X left split around a 5 m doorway (z[-2.5,2.5]) so the player can walk in.
  panelWall(-18.8, -9.25, T_WALL, 13.5); addCol(-18.8, -9.25, T_WALL, 13.5);
  panelWall(-18.8, 9.25, T_WALL, 13.5);  addCol(-18.8, 9.25, T_WALL, 13.5);
  // Lit door surround + header above the gap.
  const doorHeader = box(T_WALL + 0.1, 1.0, 5.4, panelTrimMat, false, false);
  doorHeader.position.set(-18.8, H_WALL - 0.5, 0);
  group.add(doorHeader);
  for (const dz of [-2.7, 2.7]) {
    const jamb = box(0.18, H_WALL - 1.0, 0.18, addGlow(new THREE.MeshStandardMaterial({ color: "#0c2a30", emissive: "#23e8d0", emissiveIntensity: 1.0, roughness: 0.4 }), 0.9, 0.3, 0.9, dz), false, false);
    jamb.position.set(-18.6, (H_WALL - 1.0) / 2, dz);
    group.add(jamb);
  }

  // ── CEILING + glow strips ────────────────────────────────────────────────────
  const ceil = box(38, 0.3, 32, ceilMat, false, false);
  ceil.position.y = H_WALL;
  group.add(ceil);
  for (const cz of [-9, 0, 9]) {
    const strip = box(30, 0.1, 0.7, addGlow(new THREE.MeshStandardMaterial({ color: "#dff4ff", emissive: "#bfe6ff", emissiveIntensity: 0.9, roughness: 0.3 }), 0.85, 0.15, 0.5 + Math.abs(cz) * 0.03, cz), false, false);
    strip.position.set(0, H_WALL - 0.2, cz);
    group.add(strip);
  }
  // Ceiling pipe/conduit greebles running along +X.
  for (const cz of [-12, 12]) {
    const pipe = mesh(G.pipeGeo, steelMat, false, false);
    pipe.scale.y = 34;
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, H_WALL - 0.5, cz);
    group.add(pipe);
  }

  // ── CONTAINMENT CHAMBERS along the +Z wall (glowing cylinders, floating
  //    specimens + flickering plasma cores) ─────────────────────────────────────
  const chambers = [
    { x: -12, color: "#37ffd0", plasma: "#5fffe0", spec: 0 },
    { x: 0,   color: "#7cc0ff", plasma: "#9fd4ff", spec: 2 },
    { x: 12,  color: "#ff6ad5", plasma: "#ff9be4", spec: 1 },
  ];
  for (const c of chambers) {
    const cz = 14;
    const base = mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.55, 24), steelDarkMat, true, false);
    base.position.set(c.x, 0.27, cz);
    group.add(base);
    const cap = mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 24), steelMat, true, false);
    cap.position.set(c.x, 4.6, cz);
    group.add(cap);
    // Outer glass tube.
    const tube = mesh(new THREE.CylinderGeometry(1.3, 1.3, 3.6, 28, 1, true), glassMat, false, false);
    tube.position.set(c.x, 2.45, cz);
    group.add(tube);
    // Emissive rings at the seals (pulse).
    for (const ry of [0.6, 4.3]) {
      const ring = mesh(new THREE.TorusGeometry(1.32, 0.08, 10, 28), addGlow(new THREE.MeshStandardMaterial({ color: "#0a2a26", emissive: c.color, emissiveIntensity: 1.0, roughness: 0.4 }), 0.9, 0.4, 1.4, c.x), false, false);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(c.x, ry, cz);
      group.add(ring);
    }
    // Inner column of suspended fluid (faint emissive cylinder).
    const fluid = mesh(new THREE.CylinderGeometry(1.18, 1.18, 3.4, 24, 1, true), addGlow(new THREE.MeshStandardMaterial({ color: c.color, emissive: c.color, emissiveIntensity: 0.45, roughness: 0.5, transparent: true, opacity: 0.22, side: THREE.DoubleSide }), 0.45, 0.2, 0.8, c.x + 1.0), false, false);
    fluid.position.set(c.x, 2.45, cz);
    group.add(fluid);
    // Flickering plasma core.
    const plasmaMat = addGlow(new THREE.MeshStandardMaterial({ color: c.plasma, emissive: c.plasma, emissiveIntensity: 1.6, roughness: 0.3 }), 1.5, 0.5, 6.0, c.x, 0.7, 17.0);
    const plasma = mesh(new THREE.IcosahedronGeometry(0.45, 1), plasmaMat, false, false);
    plasma.position.set(c.x, 1.6, cz);
    group.add(plasma);
    specimens.push({ mesh: plasma, baseY: 1.6, amp: 0.18, rate: 1.7, phase: c.x, spin: 1.4 });
    // Floating specimen (organic shape) bobbing/spinning above the plasma.
    const specGeo = c.spec === 0 ? new THREE.TorusKnotGeometry(0.34, 0.12, 64, 8)
                  : c.spec === 1 ? new THREE.IcosahedronGeometry(0.4, 0)
                                 : new THREE.DodecahedronGeometry(0.4, 0);
    const specMat = addGlow(new THREE.MeshStandardMaterial({ color: SPECIMEN[c.spec], emissive: SPECIMEN[c.spec], emissiveIntensity: 0.8, roughness: 0.4, metalness: 0.2 }), 0.8, 0.3, 2.2, c.x + 2.0);
    const spec = mesh(specGeo, specMat, false, false);
    spec.position.set(c.x, 3.1, cz);
    group.add(spec);
    specimens.push({ mesh: spec, baseY: 3.1, amp: 0.3, rate: 1.1, phase: c.x * 0.7, spin: 0.9 });
    addCol(c.x, cz, 2.7, 2.7);
  }
  // Tall vial cabinets tucked between the chambers on the back wall.
  for (const cx of [-6, 6]) makeVialCabinet(cx, 14.6, 3.0, 0.7, true);

  // ── WET BENCH ROW along the -Z wall (microscopes, beakers, tablets) ──────────
  makeBench(-12, -14.2, 7, 1.6, "scope");
  makeBench(-2, -14.2, 7, 1.6, "tablet");
  makeBench(8, -14.2, 7, 1.6, "beaker");
  // Wall-mounted waveform screens above the bench row.
  makeWaveScreen(-12, 3.3, -15.55);
  makeWaveScreen(-2, 3.3, -15.55);
  makeWaveScreen(8, 3.3, -15.55);

  // ── ANALYSIS BENCHES along the -X wall (flank the door) ──────────────────────
  makeBench(-17.4, 8, 1.8, 6, "beaker", true);
  makeBench(-17.4, -8, 1.8, 6, "scope", true);

  // ── RIGHT WALL (+X): energy CONTAINMENT FIELD ring, ROBOTIC ARM, vial cabinet ─
  makeFieldRing(15.4, 0);
  makeRoboticArm(15.4, -9);
  makeVialCabinet(17.2, 9, 1.4, 5, false);

  // ── CENTRAL HOLOGRAPHIC MOLECULE display (rotating) ──────────────────────────
  makeMoleculeStage(0, 0);

  // =====================================================================================
  // Builder helpers (closures over caches/group). Defined after use is fine — hoisted.
  // =====================================================================================

  // A lab bench: top slab + body + legs, dressed with kit. `wall`=true means it runs
  // along the -X wall (depth on X), else along a -Z/back wall (depth on Z).
  function makeBench(lx, lz, w, d, kit, wall = false) {
    const topY = 1.0;
    const top = box(w, 0.12, d, benchTopMat, true, true);
    top.position.set(lx, topY, lz);
    group.add(top);
    const body = box(w - 0.3, topY - 0.15, d - 0.3, benchBodyMat, false, false);
    body.position.set(lx, (topY - 0.15) / 2, lz);
    group.add(body);
    // Drawer seams + handles greeble.
    const seamAxis = wall ? "z" : "x";
    const seamSpan = wall ? d : w;
    for (let s = -seamSpan / 2 + 1; s < seamSpan / 2 - 0.5; s += 1.6) {
      const h = box(0.22, 0.05, 0.05, goldGreeble, false, false);
      if (wall) h.position.set(lx + (d / 2 - 0.16), 0.55, lz + s);
      else h.position.set(lx + s, 0.55, lz + (d / 2 - 0.16));
      group.add(h);
    }
    // Kit on the bench top — spread along the long axis.
    const longSpan = wall ? d : w;
    const n = Math.max(2, Math.floor(longSpan / 2));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const kx = wall ? lx : lx + f * (w - 1.0);
      const kz = wall ? lz + f * (d - 1.0) : lz;
      if (kit === "scope" && i % 2 === 0) makeMicroscope(kx, topY + 0.06, kz);
      else if (kit === "tablet" && i % 2 === 0) makeTablet(kx, topY + 0.06, kz);
      else makeBeaker(kx, topY + 0.06, kz, i);
      // a stray flask between items
      if (i % 2 === 1) makeFlask(kx + (wall ? 0.0 : 0.0), topY + 0.06, kz + (wall ? 0.0 : 0.0), i + 3);
    }
    addCol(lx, lz, w, d);
  }

  function makeBeaker(x, y, z, i) {
    const beaker = mesh(G.beakerBody, glassMat, false, false);
    beaker.position.set(x, y + 0.21, z);
    group.add(beaker);
    const liqColor = LIQUIDS[i % LIQUIDS.length];
    const liq = mesh(G.beakerLiq, addGlow(new THREE.MeshStandardMaterial({ color: liqColor, emissive: liqColor, emissiveIntensity: 0.6, roughness: 0.4, transparent: true, opacity: 0.85 }), 0.55, 0.25, 1.3 + (i % 3) * 0.4, x + z), false, false);
    liq.position.set(x, y + 0.13, z);
    group.add(liq);
  }
  function makeFlask(x, y, z, i) {
    const bulb = mesh(G.flask, glassMat, false, false);
    bulb.position.set(x, y + 0.2, z);
    group.add(bulb);
    const neck = mesh(G.flaskNeck, glassMat, false, false);
    neck.position.set(x, y + 0.42, z);
    group.add(neck);
    const cColor = LIQUIDS[(i + 2) % LIQUIDS.length];
    const core = mesh(new THREE.SphereGeometry(0.13, 12, 8), addGlow(new THREE.MeshStandardMaterial({ color: cColor, emissive: cColor, emissiveIntensity: 0.7, roughness: 0.4, transparent: true, opacity: 0.9 }), 0.6, 0.3, 1.5 + (i % 4) * 0.3, x - z), false, false);
    core.position.set(x, y + 0.17, z);
    group.add(core);
  }
  function makeMicroscope(x, y, z) {
    const base = mesh(G.scopeBase, steelDarkMat, true, false);
    base.position.set(x, y + 0.05, z);
    group.add(base);
    const arm = mesh(G.scopeArm, steelMat, true, false);
    arm.position.set(x - 0.06, y + 0.32, z);
    arm.rotation.z = 0.18;
    group.add(arm);
    const tube = mesh(G.scopeTube, steelMat, true, false);
    tube.position.set(x + 0.05, y + 0.5, z);
    tube.rotation.x = 0.5;
    group.add(tube);
    const lens = mesh(new THREE.SphereGeometry(0.05, 8, 6), addGlow(new THREE.MeshStandardMaterial({ color: "#2ee6c2", emissive: "#2ee6c2", emissiveIntensity: 1.0, roughness: 0.3 }), 0.9, 0.4, 2.0, x), false, false);
    lens.position.set(x + 0.05, y + 0.18, z + 0.02);
    group.add(lens);
  }
  function makeTablet(x, y, z) {
    const stand = box(0.18, 0.18, 0.12, steelDarkMat, true, false);
    stand.position.set(x, y + 0.09, z);
    group.add(stand);
    const screenMat = addGlow(new THREE.MeshStandardMaterial({ color: "#06222e", emissive: "#1fc8ff", emissiveIntensity: 0.8, roughness: 0.3 }), 0.7, 0.35, 1.8, x + z);
    const tab = mesh(G.tabletGeo, screenMat, true, false);
    tab.position.set(x, y + 0.27, z);
    tab.rotation.x = -0.55;
    group.add(tab);
  }

  // A vial cabinet: white body + glass front + shelves of glowing vials (pulse).
  function makeVialCabinet(lx, lz, w, d, backWall) {
    const hC = 3.4;
    const body = box(w, hC, d, panelTrimMat, true, true);
    body.position.set(lx, hC / 2, lz);
    group.add(body);
    // Glass face toward the room.
    const glass = backWall
      ? box(w - 0.3, hC - 0.4, 0.04, cabGlassMat, false, false)
      : box(0.04, hC - 0.4, d - 0.3, cabGlassMat, false, false);
    if (backWall) glass.position.set(lx, hC / 2, lz - d / 2 - 0.02);
    else glass.position.set(lx - w / 2 - 0.02, hC / 2, lz);
    group.add(glass);
    // Shelves of vials.
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const sy = 0.5 + r * 0.7;
      const shelf = backWall ? box(w - 0.2, 0.05, d - 0.2, steelMat, false, false) : box(w - 0.2, 0.05, d - 0.2, steelMat, false, false);
      shelf.position.set(lx, sy - 0.05, lz);
      group.add(shelf);
      const cols = backWall ? 5 : 4;
      for (let cI = 0; cI < cols; cI++) {
        const f = (cI + 0.5) / cols - 0.5;
        const vx = backWall ? lx + f * (w - 0.5) : lx;
        const vz = backWall ? lz : lz + f * (d - 0.5);
        const color = SPECIMEN[(r + cI) % SPECIMEN.length];
        const vial = mesh(G.vial, glassMat, false, false);
        vial.position.set(vx, sy + 0.3, vz);
        group.add(vial);
        const fill = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 8), addGlow(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4 }), 0.65, 0.35, 1.2 + ((r + cI) % 4) * 0.3, vx + vz * 1.3), false, false);
        fill.position.set(vx, sy + 0.26, vz);
        group.add(fill);
        const capm = mesh(G.vialCap, steelDarkMat, false, false);
        capm.position.set(vx, sy + 0.62, vz);
        group.add(capm);
      }
    }
    addCol(lx, lz, w, d);
  }

  // Wall-mounted waveform screen: dark panel + frame + a row of animated bars.
  function makeWaveScreen(lx, ly, lz) {
    const fw = 2.8, fh = 1.7;
    const frame = box(fw, fh, 0.12, steelDarkMat, false, false);
    frame.position.set(lx, ly, lz);
    group.add(frame);
    const panel = box(fw - 0.2, fh - 0.2, 0.04, addGlow(new THREE.MeshStandardMaterial({ color: "#04161f", emissive: "#0d3a52", emissiveIntensity: 0.6, roughness: 0.3 }), 0.55, 0.2, 0.7, lx), false, false);
    panel.position.set(lx, ly, lz + 0.08);
    group.add(panel);
    // Bars (unit-height geometry, scaled in update; anchored at bottom).
    const N = 16;
    const barMat = addGlow(new THREE.MeshStandardMaterial({ color: "#23e8d0", emissive: "#23e8d0", emissiveIntensity: 1.0, roughness: 0.3 }), 1.0, 0.3, 2.0, lx);
    const bottomY = ly - (fh - 0.3) / 2;
    for (let i = 0; i < N; i++) {
      const bx = lx - (fw - 0.4) / 2 + (i + 0.5) * ((fw - 0.4) / N);
      const bar = mesh(G.waveBar, barMat, false, false);
      const h0 = 0.2 + Math.abs(Math.sin(i * 0.9)) * 0.6;
      bar.scale.y = h0;
      bar.position.set(bx, bottomY + h0 / 2, lz + 0.12);
      group.add(bar);
      waveBars.push({ mesh: bar, bottomY, base: 0.5, amp: 0.45, rate: 3.5 + (i % 5) * 0.5, phase: i * 0.6 });
    }
  }

  // Central rotating holographic molecule on a lit pedestal, in a cone of light.
  function makeMoleculeStage(lx, lz) {
    const ped = mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.9, 24), benchBodyMat, true, true);
    ped.position.set(lx, 0.45, lz);
    group.add(ped);
    const emit = mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.08, 24), addGlow(new THREE.MeshStandardMaterial({ color: "#0c3050", emissive: "#37d0ff", emissiveIntensity: 1.1, roughness: 0.25 }), 1.0, 0.35, 1.2, lx), false, false);
    emit.position.set(lx, 0.94, lz);
    group.add(emit);
    // Faint holographic cone of light rising from the emitter.
    const cone = mesh(new THREE.ConeGeometry(1.4, 2.6, 28, 1, true), addGlow(new THREE.MeshStandardMaterial({ color: "#37d0ff", emissive: "#37d0ff", emissiveIntensity: 0.5, roughness: 0.5, transparent: true, opacity: 0.1, side: THREE.DoubleSide }), 0.5, 0.2, 0.9, lx + 1), false, false);
    cone.position.set(lx, 2.3, lz);
    group.add(cone);
    // The molecule itself — central atom + ring of outer atoms + bonds — in a
    // spinning group floating above the pedestal.
    const mol = new THREE.Group();
    mol.position.set(lx, 2.7, lz);
    group.add(mol);
    const coreMat = addGlow(new THREE.MeshStandardMaterial({ color: "#37d0ff", emissive: "#37d0ff", emissiveIntensity: 1.0, roughness: 0.3, metalness: 0.2 }), 1.0, 0.3, 1.6, 0);
    const core = mesh(G.atom, coreMat, false, false);
    core.scale.setScalar(1.2);
    mol.add(core);
    const ATOMS = 6;
    const R = 1.05;
    const atomCols = ["#ff6ad5", "#37ffd0", "#ffd23a", "#7cc0ff", "#b6ff4d", "#ff9f43"];
    for (let i = 0; i < ATOMS; i++) {
      const a = (i / ATOMS) * Math.PI * 2;
      const tilt = (i % 2 ? 0.5 : -0.4);
      const ax = Math.cos(a) * R;
      const ay = Math.sin(tilt) * 0.6 * (i % 3 - 1);
      const az = Math.sin(a) * R;
      const col = atomCols[i % atomCols.length];
      const at = mesh(G.atom, addGlow(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.15 }), 0.85, 0.3, 2.0 + i * 0.2, i), false, false);
      at.position.set(ax, ay, az);
      at.scale.setScalar(0.75);
      mol.add(at);
      // Bond from core to this atom (scaled + oriented cylinder).
      const len = Math.hypot(ax, ay, az);
      const bond = mesh(G.bond, accentStatic, false, false);
      bond.scale.y = len;
      bond.position.set(ax / 2, ay / 2, az / 2);
      // orient +Y to the atom direction
      bond.quaternion.setFromUnitVectors(UP, TMP.set(ax, ay, az).normalize());
      mol.add(bond);
    }
    spinners.push({ obj: mol, rx: 0.15, ry: 0.5, rz: 0.0 });
    specimens.push({ mesh: mol, baseY: 2.7, amp: 0.12, rate: 0.8, phase: 0, spin: 0 }); // gentle bob (spin handled by spinners)
    addCol(lx, lz, 2.6, 2.6);
  }

  // Energy CONTAINMENT FIELD: a vertical ring on a pillar with a glowing core and a
  // cage of flickering energy arcs.
  function makeFieldRing(lx, lz) {
    const pillar = mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 16), steelDarkMat, true, true);
    pillar.position.set(lx, 1.1, lz);
    group.add(pillar);
    const ringY = 3.0;
    // Main ring (opening faces ±X so it reads as a portal from the room).
    const ring = mesh(new THREE.TorusGeometry(1.6, 0.16, 16, 40), steelMat, true, false);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(lx, ringY, lz);
    group.add(ring);
    // Inner emissive rim (pulse).
    const rim = mesh(new THREE.TorusGeometry(1.45, 0.06, 12, 40), addGlow(new THREE.MeshStandardMaterial({ color: "#0a2030", emissive: "#7c4dff", emissiveIntensity: 1.2, roughness: 0.4 }), 1.1, 0.5, 1.6, lx), false, false);
    rim.rotation.y = Math.PI / 2;
    rim.position.set(lx, ringY, lz);
    group.add(rim);
    // Glowing containment core in the centre (flicker + spin).
    const coreMat = addGlow(new THREE.MeshStandardMaterial({ color: "#b69bff", emissive: "#9b7bff", emissiveIntensity: 1.8, roughness: 0.3 }), 1.7, 0.6, 7.0, lx, 0.6, 19.0);
    const fcore = mesh(new THREE.IcosahedronGeometry(0.5, 1), coreMat, false, false);
    fcore.position.set(lx, ringY, lz);
    group.add(fcore);
    specimens.push({ mesh: fcore, baseY: ringY, amp: 0.0, rate: 1, phase: 0, spin: 1.8 });
    // Cage of energy arcs — partial tori at varied tilts, flickering out of phase.
    const arcCluster = new THREE.Group();
    arcCluster.position.set(lx, ringY, lz);
    group.add(arcCluster);
    for (let i = 0; i < 5; i++) {
      const arcMat = addGlow(new THREE.MeshStandardMaterial({ color: "#c9b6ff", emissive: "#a98bff", emissiveIntensity: 1.4, roughness: 0.4, transparent: true, opacity: 0.9 }), 1.0, 0.9, 9.0 + i * 1.7, i * 1.3, 0.8, 23.0 + i * 2);
      const arc = mesh(new THREE.TorusGeometry(1.35, 0.04, 8, 24, Math.PI * (0.7 + Math.random() * 0.5)), arcMat, false, false);
      arc.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      arcCluster.add(arc);
    }
    spinners.push({ obj: arcCluster, rx: 0.4, ry: 0.7, rz: 0.5 });
    addCol(lx, lz, 2.8, 2.8);
  }

  // Articulated ROBOTIC ARM on a base; shoulder sweep + shoulder/elbow/wrist joints
  // animated via cached pivots; gripper at the tip.
  function makeRoboticArm(lx, lz) {
    const ped = box(1.6, 1.0, 1.6, benchBodyMat, true, true);
    ped.position.set(lx, 0.5, lz);
    group.add(ped);
    const base = mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.4, 20), steelDarkMat, true, false);
    base.position.set(lx, 1.2, lz);
    group.add(base);
    // Shoulder pivot (yaw sweep).
    const shoulder = new THREE.Group();
    shoulder.position.set(lx, 1.4, lz);
    group.add(shoulder);
    armJoints.push({ obj: shoulder, axis: "y", base: 0, amp: 0.7, rate: 0.5, phase: 0 });
    // Upper arm (pitch about Z at the shoulder).
    const upperPivot = new THREE.Group();
    shoulder.add(upperPivot);
    armJoints.push({ obj: upperPivot, axis: "z", base: 0.3, amp: 0.4, rate: 0.7, phase: 0.5 });
    const upper = box(0.4, 2.0, 0.4, steelMat, true, false);
    upper.position.set(0, 1.0, 0);
    upperPivot.add(upper);
    for (const sy of [0.3, 1.7]) {
      const j = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 14), goldGreeble, true, false);
      j.rotation.x = Math.PI / 2;
      j.position.set(0, sy, 0);
      upperPivot.add(j);
    }
    // Elbow pivot at the top of the upper arm.
    const elbow = new THREE.Group();
    elbow.position.set(0, 2.0, 0);
    upperPivot.add(elbow);
    armJoints.push({ obj: elbow, axis: "z", base: -0.8, amp: 0.6, rate: 0.9, phase: 1.2 });
    const fore = box(0.32, 1.6, 0.32, steelMat, true, false);
    fore.position.set(0, 0.8, 0);
    elbow.add(fore);
    // Wrist + gripper.
    const wrist = new THREE.Group();
    wrist.position.set(0, 1.6, 0);
    elbow.add(wrist);
    armJoints.push({ obj: wrist, axis: "z", base: 0.5, amp: 0.4, rate: 1.3, phase: 0.3 });
    const wristMat = addGlow(new THREE.MeshStandardMaterial({ color: "#0c3050", emissive: "#1fc8ff", emissiveIntensity: 1.0, roughness: 0.3 }), 0.9, 0.4, 3.0, lx);
    const wristHub = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 12), wristMat, true, false);
    wristHub.position.set(0, 0.18, 0);
    wrist.add(wristHub);
    for (const sx of [-1, 1]) {
      const fingerPivot = new THREE.Group();
      fingerPivot.position.set(sx * 0.12, 0.3, 0);
      wrist.add(fingerPivot);
      armJoints.push({ obj: fingerPivot, axis: "z", base: sx * 0.25, amp: sx * 0.2, rate: 2.0, phase: 0.7 });
      const finger = box(0.08, 0.4, 0.16, steelDarkMat, true, false);
      finger.position.set(0, 0.2, 0);
      fingerPivot.add(finger);
    }
    addCol(lx, lz, 1.9, 1.9);
  }

  // ── ANIMATION — allocation-free. Cached handles only; no `new` per frame. ─────
  let t = 0;
  function update(dt) {
    t += dt;
    // Glow / plasma / screen / vial pulses + flickers.
    for (let i = 0; i < glowPulse.length; i++) {
      const g = glowPulse[i];
      g.mat.emissiveIntensity = g.base + Math.sin(t * g.rate + g.phase) * g.amp + Math.sin(t * g.rate2 + g.phase * 1.7) * g.amp2;
    }
    // Floating specimens / plasma cores / molecule bob (and self-spin where set).
    for (let i = 0; i < specimens.length; i++) {
      const s = specimens[i];
      if (s.amp !== 0) s.mesh.position.y = s.baseY + Math.sin(t * s.rate + s.phase) * s.amp;
      if (s.spin !== 0) {
        s.mesh.rotation.y += s.spin * dt;
        s.mesh.rotation.x += s.spin * 0.4 * dt;
      }
    }
    // Free spinners (molecule cloud, energy-arc cage).
    for (let i = 0; i < spinners.length; i++) {
      const sp = spinners[i];
      sp.obj.rotation.x += sp.rx * dt;
      sp.obj.rotation.y += sp.ry * dt;
      sp.obj.rotation.z += sp.rz * dt;
    }
    // Waveform bars — scale + re-anchor at bottom.
    for (let i = 0; i < waveBars.length; i++) {
      const b = waveBars[i];
      const h = b.base + (Math.sin(t * b.rate + b.phase) * 0.5 + 0.5) * b.amp + Math.sin(t * b.rate * 0.37 + b.phase) * 0.06;
      b.mesh.scale.y = h;
      b.mesh.position.y = b.bottomY + h / 2;
    }
    // Robotic-arm joints sweep on sines about their cached axes.
    for (let i = 0; i < armJoints.length; i++) {
      const j = armJoints[i];
      const v = j.base + Math.sin(t * j.rate + j.phase) * j.amp;
      if (j.axis === "y") j.obj.rotation.y = v;
      else if (j.axis === "z") j.obj.rotation.z = v;
      else j.obj.rotation.x = v;
    }
  }

  return { group, update, ground, colliders };
}

// Scratch constants for one-time orientation math during build (NOT used in update).
const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
