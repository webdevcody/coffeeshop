// STATION GARDEN — a lush HYDROPONIC GARDEN module that drops onto the orbital
// space-station deck (mirrors the space.js interior contract). It is a warm,
// living, ORGANIC counterpoint to the cold metal station: tall vertical-farm
// racks glowing with rows of green plants, transparent grow-PODS cradling
// glowing seedlings, hanging vines, flowing nutrient TUBES, pink/purple GROW-
// LIGHT panels casting colour, a central TREE-in-a-DOME, drifting misters and a
// haze of slow spores in the air.
//
// ── CONTRACT ──────────────────────────────────────────────────────────────────
//   buildStationGarden(opts = {}) -> { group, update(dt), ground, colliders }
//     opts: { ox = 434, oz = 130, floorY = 260 }
//   • group   — a THREE.Group parked at WORLD (ox, floorY, oz); ALL content is
//               authored LOCAL to it, growing up from the deck at local y = 0.
//   • ground  — ONE walkable rect (world XZ): [{ ox-19..ox+19, oz-16..oz+16 }].
//               (Player code lifts you to floorY while you stand on it.)
//   • colliders — TIGHT world-XZ AABBs around the SOLID props (planters, racks,
//               pod towers, dome, trellis posts) only — the central cross + the
//               lanes between the dome and the wall racks stay CLEAR to walk.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// Every material + reused geometry is created ONCE at module scope. The build
// phase allocates freely; update(dt) only mutates cached handles (rotations,
// emissiveIntensity, light intensity, a reused spore position buffer) — no `new`
// per frame, and indexed for-loops only (no per-frame iterator churn).

import * as THREE from "three";

// ── Shared materials (created ONCE) ───────────────────────────────────────────
// Deck / structure.
const deckMat      = new THREE.MeshStandardMaterial({ color: "#39434a", roughness: 0.7, metalness: 0.4 });
const deckTrimMat  = new THREE.MeshStandardMaterial({ color: "#262d33", roughness: 0.6, metalness: 0.5, emissive: "#0c2a22", emissiveIntensity: 0.35 });
const rackFrameMat = new THREE.MeshStandardMaterial({ color: "#c8d0d6", roughness: 0.4, metalness: 0.6 });
const rackTrayMat  = new THREE.MeshStandardMaterial({ color: "#46505a", roughness: 0.6, metalness: 0.4 });
const panelBackMat = new THREE.MeshStandardMaterial({ color: "#eef6ff", roughness: 0.5, metalness: 0.1, emissive: "#2a1430", emissiveIntensity: 0.18 });
const trellisMat   = new THREE.MeshStandardMaterial({ color: "#7b8590", roughness: 0.5, metalness: 0.55 });
// Plants / soil / moss.
const leafMat      = new THREE.MeshStandardMaterial({ color: "#4caf50", roughness: 0.7, emissive: "#123d18", emissiveIntensity: 0.28, flatShading: true });
const leafDarkMat  = new THREE.MeshStandardMaterial({ color: "#357a3e", roughness: 0.8, emissive: "#0d2c14", emissiveIntensity: 0.22, flatShading: true });
const sproutMat    = new THREE.MeshStandardMaterial({ color: "#5a8f4a", roughness: 0.9 });
const seedlingMat  = new THREE.MeshStandardMaterial({ color: "#b6ff7a", roughness: 0.5, emissive: "#5cff34", emissiveIntensity: 0.85 });
const foliageMat   = new THREE.MeshStandardMaterial({ color: "#3f9d4f", roughness: 0.85, emissive: "#103a16", emissiveIntensity: 0.32, flatShading: true });
const mossMat      = new THREE.MeshStandardMaterial({ color: "#4a7a3a", roughness: 1.0, emissive: "#16331a", emissiveIntensity: 0.2 });
const soilMat      = new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 1.0 });
const planterMat   = new THREE.MeshStandardMaterial({ color: "#6b5640", roughness: 0.9, metalness: 0.05 });
const trunkMat     = new THREE.MeshStandardMaterial({ color: "#6e5238", roughness: 0.95 });
const vineMat      = new THREE.MeshStandardMaterial({ color: "#3f7a3a", roughness: 0.9 });
const vineLeafMat  = new THREE.MeshStandardMaterial({ color: "#5aa84a", roughness: 0.8, emissive: "#0e2c12", emissiveIntensity: 0.2, flatShading: true });
// Glass — dome + grow-pods + tray water (transparent so the green reads through).
const domeGlassMat = new THREE.MeshStandardMaterial({ color: "#aee9d2", roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, emissive: "#0e2a22", emissiveIntensity: 0.2 });
const podGlassMat  = new THREE.MeshStandardMaterial({ color: "#9fe8d8", roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.18, side: THREE.DoubleSide, emissive: "#103029", emissiveIntensity: 0.25 });
const waterMat     = new THREE.MeshStandardMaterial({ color: "#bfeaff", roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.5, emissive: "#1f6f8a", emissiveIntensity: 0.25 });
const mistMat      = new THREE.MeshStandardMaterial({ color: "#eaf6ff", roughness: 1.0, transparent: true, opacity: 0.14, depthWrite: false });
// Pulsing GROW-LIGHT panels + rack strips (emissiveIntensity mutated in update).
const growPinkMat   = new THREE.MeshStandardMaterial({ color: "#ff7ab8", roughness: 0.4, metalness: 0.1, emissive: "#ff2f86", emissiveIntensity: 0.85, side: THREE.DoubleSide });
const growPurpleMat = new THREE.MeshStandardMaterial({ color: "#b98cff", roughness: 0.4, metalness: 0.1, emissive: "#7a2bff", emissiveIntensity: 0.85, side: THREE.DoubleSide });
const growStripMat  = new THREE.MeshStandardMaterial({ color: "#ff9ad0", roughness: 0.4, metalness: 0.1, emissive: "#ff3f9a", emissiveIntensity: 0.7 });
// Flowing nutrient-TUBE glow — FOUR phased materials; segments are assigned in
// sequence so the staggered pulse reads as fluid travelling along the run.
const tubeGlow0 = new THREE.MeshStandardMaterial({ color: "#8ffff0", roughness: 0.3, metalness: 0.0, emissive: "#1fd9c8", emissiveIntensity: 0.7, transparent: true, opacity: 0.92 });
const tubeGlow1 = new THREE.MeshStandardMaterial({ color: "#8ffff0", roughness: 0.3, metalness: 0.0, emissive: "#1fd9c8", emissiveIntensity: 0.7, transparent: true, opacity: 0.92 });
const tubeGlow2 = new THREE.MeshStandardMaterial({ color: "#8ffff0", roughness: 0.3, metalness: 0.0, emissive: "#1fd9c8", emissiveIntensity: 0.7, transparent: true, opacity: 0.92 });
const tubeGlow3 = new THREE.MeshStandardMaterial({ color: "#8ffff0", roughness: 0.3, metalness: 0.0, emissive: "#1fd9c8", emissiveIntensity: 0.7, transparent: true, opacity: 0.92 });

// ── Shared geometries (created ONCE) ──────────────────────────────────────────
const G = {
  postGeo:     new THREE.BoxGeometry(0.12, 1, 0.12),          // rack/trellis post (scaled in Y)
  stemGeo:     new THREE.CylinderGeometry(0.025, 0.05, 0.4, 5),
  leafGeo:     new THREE.SphereGeometry(0.14, 6, 5),
  seedlingGeo: new THREE.ConeGeometry(0.08, 0.22, 7),
  podGeo:      new THREE.SphereGeometry(0.7, 16, 12),
  vineSegGeo:  new THREE.CylinderGeometry(0.04, 0.04, 1, 5),  // scaled per drop segment
  tubeSegGeo:  new THREE.CylinderGeometry(0.08, 0.08, 1, 8),  // scaled per run segment
  mistGeo:     new THREE.SphereGeometry(0.5, 8, 6),
};

function mesh(geo, mat, cast = false, receive = false) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = false, receive = false) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}

export function buildStationGarden(opts = {}) {
  const { ox = 434, oz = 130, floorY = 260 } = opts;

  const group = new THREE.Group();
  group.name = "stationGarden";
  group.position.set(ox, floorY, oz);

  // ── Returned contract ──────────────────────────────────────────────────────
  const ground = [{ minX: ox - 19, maxX: ox + 19, minZ: oz - 16, maxZ: oz + 16 }];
  const colliders = [];

  // ── Animated handles (collected at build → mutated allocation-free) ─────────
  const swayers  = []; // { obj, axis, base, amp, rate, phase }  gentle plant/vine sway
  const growMats = []; // { mat, baseI, amp, rate, phase }        grow-light pulse
  const misters  = []; // { mesh, baseY, amp, rate, phase, baseScale }  drifting mist

  // Flowing nutrient-tube materials (phase-staggered → travelling glow).
  const tubeMats = [
    { mat: tubeGlow0, baseI: 0.7, amp: 0.62, rate: 3.0, phase: 0.0 },
    { mat: tubeGlow1, baseI: 0.7, amp: 0.62, rate: 3.0, phase: Math.PI * 0.5 },
    { mat: tubeGlow2, baseI: 0.7, amp: 0.62, rate: 3.0, phase: Math.PI },
    { mat: tubeGlow3, baseI: 0.7, amp: 0.62, rate: 3.0, phase: Math.PI * 1.5 },
  ];

  // Push a TIGHT world-XZ AABB from a LOCAL centre + footprint.
  function solid(lcx, lcz, w, d) {
    colliders.push({ minX: ox + lcx - w / 2, maxX: ox + lcx + w / 2, minZ: oz + lcz - d / 2, maxZ: oz + lcz + d / 2 });
  }

  // A segmented, axis-aligned nutrient-tube run whose segments cycle through the
  // four phased glow materials (the pulse appears to flow along the pipe).
  //   axis 'y': c1 = x, c2 = z  | axis 'x': c1 = y, c2 = z  | axis 'z': c1 = x, c2 = y
  function tubeRun(parent, axis, start, end, c1, c2) {
    const len = Math.abs(end - start);
    const n = Math.max(1, Math.round(len / 0.7));
    const step = (end - start) / n;
    const segLen = (len / n) * 1.04; // slight overlap hides the seams
    for (let i = 0; i < n; i++) {
      const m = mesh(G.tubeSegGeo, tubeMats[i % tubeMats.length].mat, false, false);
      m.scale.y = segLen;
      const mid = start + step * (i + 0.5);
      if (axis === "y") m.position.set(c1, mid, c2);
      else if (axis === "x") { m.rotation.z = Math.PI / 2; m.position.set(mid, c1, c2); }
      else { m.rotation.x = Math.PI / 2; m.position.set(c1, c2, mid); }
      parent.add(m);
    }
  }

  // A single little plant: a stem, a cluster of leaves, an occasional glowing tip.
  function makePlant(parent, x, z, s) {
    const stem = mesh(G.stemGeo, sproutMat, false, false);
    stem.scale.set(s, s, s);
    stem.position.set(x, 0.2 * s, z);
    parent.add(stem);
    const lc = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < lc; i++) {
      const leaf = mesh(G.leafGeo, Math.random() < 0.5 ? leafMat : leafDarkMat, false, false);
      const a = Math.random() * Math.PI * 2;
      const r = (0.12 + Math.random() * 0.1) * s;
      leaf.position.set(x + Math.cos(a) * r, (0.3 + Math.random() * 0.2) * s, z + Math.sin(a) * r);
      leaf.scale.set(s * (0.8 + Math.random() * 0.5), s * 0.5, s * (0.8 + Math.random() * 0.5));
      parent.add(leaf);
    }
    if (Math.random() < 0.5) {
      const tip = mesh(G.seedlingGeo, seedlingMat, false, false);
      tip.position.set(x, 0.44 * s, z);
      tip.scale.setScalar(s * 0.7);
      parent.add(tip);
    }
  }

  // ── 0) DECK + accent trim ──────────────────────────────────────────────────
  const deck = box(38, 0.3, 32, deckMat, false, true);
  deck.position.y = -0.15;
  group.add(deck);
  for (const [tx, tz, tw, td] of [[0, 15.6, 38, 0.5], [0, -15.6, 38, 0.5], [18.6, 0, 0.5, 32], [-18.6, 0, 0.5, 32]]) {
    const trim = box(tw, 0.12, td, deckTrimMat, false, false);
    trim.position.set(tx, 0.02, tz);
    group.add(trim);
  }

  // ── 1) VERTICAL-FARM RACKS lining the +Z and -Z walls (clear central band) ──
  function makeRack(cx, cz, rotY) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rotY; // 0 → planted face +Z; PI → planted face -Z (both face the room)
    group.add(g);

    const W = 5, D = 1.4, H = 4.2;
    // Corner posts + a top/bottom rail so it reads as a steel lattice.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = mesh(G.postGeo, rackFrameMat, true, false);
      post.scale.y = H;
      post.position.set(sx * (W / 2 - 0.1), H / 2, sz * (D / 2 - 0.1));
      g.add(post);
    }
    for (const ry of [0.15, H]) {
      const rail = box(W, 0.1, D, rackFrameMat, false, false);
      rail.position.set(0, ry, 0);
      g.add(rail);
    }
    // Reflective back panel (white grow-cell) behind the rows.
    const back = box(W - 0.3, H - 0.5, 0.06, panelBackMat, false, false);
    back.position.set(0, H / 2 + 0.1, -(D / 2 - 0.1));
    g.add(back);

    // Stacked shelves: each a tray + water film, a glowing grow-strip overhead,
    // and a swaying row of plants near the open front.
    const shelfYs = [0.6, 1.7, 2.8, 3.9];
    for (let si = 0; si < shelfYs.length; si++) {
      const sy = shelfYs[si];
      const tray = box(W - 0.3, 0.12, D - 0.3, rackTrayMat, false, false);
      tray.position.set(0, sy, 0);
      g.add(tray);
      const water = box(W - 0.6, 0.04, D - 0.6, waterMat, false, false);
      water.position.set(0, sy + 0.09, 0.05);
      g.add(water);
      const strip = box(W - 0.7, 0.08, 0.16, growStripMat, false, false);
      strip.position.set(0, sy + 0.92, D / 2 - 0.3);
      g.add(strip);

      const row = new THREE.Group();
      row.position.set(0, sy + 0.16, D / 2 - 0.38);
      g.add(row);
      const n = 5;
      for (let i = 0; i < n; i++) {
        const px = -(W / 2 - 0.7) + i * ((W - 1.4) / (n - 1));
        makePlant(row, px, 0, 0.85 + Math.random() * 0.25);
      }
      swayers.push({ obj: row, axis: "x", base: 0, amp: 0.05 + Math.random() * 0.03, rate: 0.7 + Math.random() * 0.5, phase: Math.random() * 6.28 });
    }
    // A vertical nutrient feed flowing up the front-right post.
    tubeRun(g, "y", 0.3, H, W / 2 - 0.22, D / 2 - 0.22);

    solid(cx, cz, W + 0.2, D + 0.2);
  }
  for (const rx of [-12, -4, 4, 12]) {
    makeRack(rx, 13.6, Math.PI);  // +Z wall bank, planted face toward centre
    makeRack(rx, -13.6, 0);       // -Z wall bank
  }

  // ── 2) MOSSY PLANTER BEDS along the +X / -X end walls ───────────────────────
  // These planter beds ARE this zone's +X / -X END-WALL structures: 20 m runs
  // along the z-depth that used to seal each X end into a full-depth divider.
  // We now build each as TWO short STUB beds at the far +Z / -Z ends, leaving a
  // WIDE (>= 10 m) CENTRED doorway across the middle, so players walk straight
  // EAST-WEST through the zone and can see into the next module. All equipment
  // (plants, inner-edge feed tube, breathing misters) is KEPT — re-anchored onto
  // the two remaining stubs; only the central span + its collider are cut away.
  function makePlanterBed(cx) {
    const SEG = 4.0;   // length (in z) of each end-stub bed
    const SEGC = 7.5;  // |z| centre of each stub → central gap spans z∈[-5.5,5.5] (11 m)
    const feedX = cx + (cx < 0 ? 0.85 : -0.85); // inner-edge feed-tube x
    const mistX = cx + (cx < 0 ? 1.1 : -1.1);   // mister x just inside the bed
    const half = SEG / 2;

    for (const sgn of [-1, 1]) {
      const cz = sgn * SEGC;
      const bed = box(1.5, 0.7, SEG, planterMat, true, true);
      bed.position.set(cx, 0.35, cz);
      group.add(bed);
      const soil = box(1.2, 0.12, SEG - 0.3, soilMat, false, false);
      soil.position.set(cx, 0.72, cz);
      group.add(soil);
      const moss = box(1.16, 0.08, SEG - 0.4, mossMat, false, false);
      moss.position.set(cx, 0.79, cz);
      group.add(moss);

      const bedRow = new THREE.Group();
      bedRow.position.set(cx, 0.8, cz);
      group.add(bedRow);
      for (let pz = -(half - 0.4); pz <= half - 0.4; pz += 1.3) {
        makePlant(bedRow, (Math.random() - 0.5) * 0.4, pz, 0.85 + Math.random() * 0.5);
      }
      swayers.push({ obj: bedRow, axis: "z", base: 0, amp: 0.05, rate: 0.6, phase: Math.random() * 6.28 });

      // Inner-edge feed tube along this stub + a mister breathing over it.
      tubeRun(group, "z", cz - (half - 0.3), cz + (half - 0.3), feedX, 0.95);
      addMist(mistX, cz, 1.0, 0.9);

      // TIGHT collider around THIS stub only — the central z-band stays CLEAR.
      solid(cx, cz, 1.7, SEG + 0.4);
    }
  }

  // ── 3) GROW-POD TOWERS in the corners — stacked transparent pods + seedlings ─
  function makePodTower(cx, cz) {
    const HT = 3.4;
    const pole = mesh(new THREE.CylinderGeometry(0.1, 0.12, HT, 8), rackFrameMat, true, false);
    pole.position.set(cx, HT / 2, cz);
    group.add(pole);
    for (const py of [0.95, 1.95, 2.95]) {
      const collar = mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.12, 14), rackFrameMat, false, false);
      collar.position.set(cx, py - 0.62, cz);
      group.add(collar);
      const pod = mesh(G.podGeo, podGlassMat, false, false);
      pod.position.set(cx, py, cz);
      group.add(pod);
      const seed = new THREE.Group();
      seed.position.set(cx, py - 0.45, cz);
      group.add(seed);
      makePlant(seed, 0, 0, 0.9);
      const glow = mesh(G.seedlingGeo, seedlingMat, false, false);
      glow.position.set(cx, py - 0.2, cz);
      glow.scale.setScalar(1.0);
      group.add(glow);
      swayers.push({ obj: seed, axis: "z", base: 0, amp: 0.06, rate: 0.9 + Math.random() * 0.5, phase: Math.random() * 6.28 });
    }
    solid(cx, cz, 1.7, 1.7);
  }

  // ── 4) CENTRAL TREE-in-a-DOME — the lush organic centrepiece ────────────────
  {
    const planter = mesh(new THREE.CylinderGeometry(3.7, 4.0, 0.7, 28), planterMat, true, true);
    planter.position.y = 0.35;
    group.add(planter);
    const rim = mesh(new THREE.TorusGeometry(3.7, 0.16, 10, 28), rackFrameMat, false, false);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.72;
    group.add(rim);
    // Soil mound + moss + a ring of undergrowth.
    const mound = mesh(new THREE.SphereGeometry(3.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), soilMat, false, true);
    mound.scale.y = 0.32;
    mound.position.y = 0.7;
    group.add(mound);
    const mossCap = mesh(new THREE.SphereGeometry(3.0, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mossMat, false, false);
    mossCap.scale.y = 0.22;
    mossCap.position.y = 0.78;
    group.add(mossCap);
    const under = new THREE.Group();
    under.position.y = 0.82;
    group.add(under);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 1.2 + Math.random() * 1.6;
      makePlant(under, Math.cos(a) * r, Math.sin(a) * r, 0.8 + Math.random() * 0.5);
    }
    swayers.push({ obj: under, axis: "x", base: 0, amp: 0.04, rate: 0.6, phase: 0.4 });

    // Trunk + a swaying canopy of overlapping foliage blobs with glowing buds.
    const trunk = mesh(new THREE.CylinderGeometry(0.32, 0.55, 2.4, 10), trunkMat, true, false);
    trunk.position.y = 0.82 + 1.2;
    group.add(trunk);
    const canopy = new THREE.Group();
    canopy.position.y = 0.82 + 2.4;
    group.add(canopy);
    for (const [bx, by, bz, br] of [[0, 0.5, 0, 1.45], [1.0, 0.1, 0.3, 1.0], [-0.9, 0.2, -0.4, 1.05], [0.3, 0.0, -1.0, 0.95], [-0.3, 0.4, 0.9, 0.9]]) {
      const blob = mesh(new THREE.IcosahedronGeometry(br, 1), foliageMat, true, false);
      blob.position.set(bx, by, bz);
      canopy.add(blob);
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 0.9;
      const bud = mesh(G.seedlingGeo, seedlingMat, false, false);
      bud.position.set(Math.cos(a) * r, 0.2 + Math.random() * 0.6, Math.sin(a) * r);
      bud.scale.setScalar(0.8);
      canopy.add(bud);
    }
    swayers.push({ obj: canopy, axis: "z", base: 0, amp: 0.045, rate: 0.5, phase: 1.2 });
    swayers.push({ obj: canopy, axis: "x", base: 0, amp: 0.03, rate: 0.42, phase: 2.5 });

    // The glass dome + a base ring; misters breathe inside it.
    const dome = mesh(new THREE.SphereGeometry(4.3, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeGlassMat, false, false);
    dome.position.y = 0.7;
    group.add(dome);
    const domeRing = mesh(new THREE.TorusGeometry(4.3, 0.12, 10, 32), rackFrameMat, false, false);
    domeRing.rotation.x = Math.PI / 2;
    domeRing.position.y = 0.74;
    group.add(domeRing);
    addMist(-1.4, 0.8, 1.1, 1.0);
    addMist(1.5, -0.9, 1.0, 1.1);
    addMist(0.2, 1.6, 1.4, 0.85);

    solid(0, 0, 8.8, 8.8); // tight footprint of the dome; lanes around it stay clear
  }

  // ── 5) OVERHEAD TRELLIS — beams, corner posts, hanging vines, grow panels ───
  const beamY = 5.0;
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const post = mesh(G.postGeo, trellisMat, true, false);
    post.scale.set(1.4, beamY + 0.4, 1.4);
    post.position.set(sx * 16.5, (beamY + 0.4) / 2, sz * 14.5);
    group.add(post);
    solid(sx * 16.5, sz * 14.5, 0.5, 0.5);
  }
  for (const bz of [-14, 0, 14]) {
    const beam = box(34, 0.18, 0.22, trellisMat, false, false);
    beam.position.set(0, beamY, bz);
    group.add(beam);
  }
  for (const bx of [-16.5, 0, 16.5]) {
    const beam = box(0.22, 0.18, 29, trellisMat, false, false);
    beam.position.set(bx, beamY, 0);
    group.add(beam);
  }
  // Pink / purple grow-light panels mounted under the trellis (off the dome top).
  const panelSpots = [[-10, -7], [-10, 7], [10, -7], [10, 7], [-10, 0], [10, 0], [0, -10], [0, 10], [-6, -11], [6, 11]];
  for (let i = 0; i < panelSpots.length; i++) {
    const [px, pz] = panelSpots[i];
    const panel = box(3.2, 0.12, 1.6, i % 2 ? growPurpleMat : growPinkMat, false, false);
    panel.position.set(px, beamY - 0.32, pz);
    panel.rotation.x = (pz > 0 ? -1 : 1) * 0.12;
    group.add(panel);
    const hanger = box(0.06, 0.32, 0.06, trellisMat, false, false);
    hanger.position.set(px, beamY - 0.16, pz);
    group.add(hanger);
  }
  // Hanging vines off the beams (over walkways, clear of the dome footprint).
  for (const [vx, vz, vl] of [[-11, 7, 3.4], [-3, 12, 3.0], [10, 8, 3.6], [13, -6, 2.8], [-13, -9, 3.2], [3, -12, 3.0], [8, 12, 3.4], [-8, -12, 2.9], [11, -11, 3.1], [-12, 2, 3.5]]) {
    const pivot = new THREE.Group();
    pivot.position.set(vx, beamY - 0.1, vz);
    group.add(pivot);
    const segs = Math.max(4, Math.round(vl / 0.5));
    for (let i = 0; i < segs; i++) {
      const seg = mesh(G.vineSegGeo, vineMat, false, false);
      seg.scale.y = 0.5;
      seg.position.y = -(i * 0.5) - 0.25;
      pivot.add(seg);
      const lf = mesh(G.leafGeo, vineLeafMat, false, false);
      lf.position.set(i % 2 ? 0.13 : -0.13, -(i * 0.5) - 0.32, 0);
      lf.scale.set(0.75, 0.45, 0.75);
      pivot.add(lf);
    }
    swayers.push({ obj: pivot, axis: Math.random() < 0.5 ? "x" : "z", base: 0, amp: 0.05 + Math.random() * 0.05, rate: 0.45 + Math.random() * 0.6, phase: Math.random() * 6.28 });
  }

  // Build the corner pod towers + the two end-wall planter beds.
  function addMist(x, z, baseY, scale) {
    const m = mesh(G.mistGeo, mistMat, false, false);
    m.position.set(x, baseY, z);
    m.scale.setScalar(scale);
    group.add(m);
    misters.push({ mesh: m, baseY, amp: 0.12 + Math.random() * 0.1, rate: 0.5 + Math.random() * 0.5, phase: Math.random() * 6.28, baseScale: scale });
  }
  for (const [cx, cz] of [[-16, -13], [16, -13], [-16, 13], [16, 13]]) makePodTower(cx, cz);
  for (const cx of [-17.3, 17.3]) makePlanterBed(cx);

  // Register the pulsing grow materials ONCE (each shared by many meshes).
  growMats.push({ mat: growPinkMat, baseI: 0.85, amp: 0.5, rate: 1.1, phase: 0.0 });
  growMats.push({ mat: growPurpleMat, baseI: 0.85, amp: 0.5, rate: 0.9, phase: 1.7 });
  growMats.push({ mat: growStripMat, baseI: 0.7, amp: 0.45, rate: 1.4, phase: 0.6 });

  // ── 6) COLOURED GROW-LIGHT CASTS — removed for GPU cost. The pink/purple/warm
  // real PointLights here added three more lights to the per-pixel loop; the
  // pulsing grow-light PANELS, rack strips and emissive seedling/foliage materials
  // (registered in growMats + tubeMats above) already carry the coloured glow, so
  // the foliage still reads lit without the cast lights.

  // ── 7) DRIFTING SPORES — a slow haze rising through the garden volume. Built
  // once into a reusable buffer; update() only mutates the position array. ─────
  const SPORE_N = 220;
  const SPORE_TOP = 5.6;
  const sporePos     = new Float32Array(SPORE_N * 3);
  const sporeBaseXZ  = new Float32Array(SPORE_N * 2);
  const sporePhase   = new Float32Array(SPORE_N);
  const sporeVy      = new Float32Array(SPORE_N);
  const sporeDrift   = new Float32Array(SPORE_N);
  for (let i = 0; i < SPORE_N; i++) {
    const x = (Math.random() * 2 - 1) * 18;
    const z = (Math.random() * 2 - 1) * 15;
    sporePos[i * 3] = x;
    sporePos[i * 3 + 1] = Math.random() * SPORE_TOP;
    sporePos[i * 3 + 2] = z;
    sporeBaseXZ[i * 2] = x;
    sporeBaseXZ[i * 2 + 1] = z;
    sporePhase[i] = Math.random() * 6.28;
    sporeVy[i] = 0.08 + Math.random() * 0.16;
    sporeDrift[i] = 0.2 + Math.random() * 0.45;
  }
  const sporeGeo = new THREE.BufferGeometry();
  const sporeAttr = new THREE.Float32BufferAttribute(sporePos, 3);
  sporeAttr.setUsage(THREE.DynamicDrawUsage);
  sporeGeo.setAttribute("position", sporeAttr);
  const sporeMat = new THREE.PointsMaterial({ color: "#cfe6b0", size: 0.08, sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false });
  const spores = new THREE.Points(sporeGeo, sporeMat);
  spores.frustumCulled = false;
  group.add(spores);

  // ── Animation — ALLOCATION-FREE. Indexed loops only; mutate cached rotations,
  // emissiveIntensity, light intensity, mist transforms + the spore buffer. ────
  let t = 0;
  function update(dt) {
    t += dt;
    // Gentle plant / vine / canopy sway.
    for (let i = 0; i < swayers.length; i++) {
      const s = swayers[i];
      s.obj.rotation[s.axis] = s.base + Math.sin(t * s.rate + s.phase) * s.amp;
    }
    // Grow-light panel + rack-strip pulse.
    for (let i = 0; i < growMats.length; i++) {
      const g = growMats[i];
      g.mat.emissiveIntensity = g.baseI + Math.sin(t * g.rate + g.phase) * g.amp;
    }
    // Flowing nutrient-tube glow (phased → travelling wave).
    for (let i = 0; i < tubeMats.length; i++) {
      const u = tubeMats[i];
      u.mat.emissiveIntensity = u.baseI + Math.sin(t * u.rate + u.phase) * u.amp;
    }
    // (Coloured light casts removed — only the emissive grow materials pulse now.)
    // Mist puffs bob + breathe; one shared opacity pulse.
    for (let i = 0; i < misters.length; i++) {
      const m = misters[i];
      m.mesh.position.y = m.baseY + Math.sin(t * m.rate + m.phase) * m.amp;
      const sc = m.baseScale * (0.82 + 0.22 * Math.sin(t * m.rate * 0.7 + m.phase));
      m.mesh.scale.set(sc, sc, sc);
    }
    mistMat.opacity = 0.12 + Math.sin(t * 0.8) * 0.05;
    // Drifting spores — rise + gentle horizontal drift, recycle at the top.
    for (let i = 0; i < SPORE_N; i++) {
      let y = sporePos[i * 3 + 1] + sporeVy[i] * dt;
      if (y > SPORE_TOP) y -= SPORE_TOP;
      sporePos[i * 3 + 1] = y;
      sporePos[i * 3] = sporeBaseXZ[i * 2] + Math.sin(t * 0.6 + sporePhase[i]) * sporeDrift[i];
      sporePos[i * 3 + 2] = sporeBaseXZ[i * 2 + 1] + Math.cos(t * 0.5 + sporePhase[i]) * sporeDrift[i];
    }
    sporeAttr.needsUpdate = true;
  }

  return { group, update, ground, colliders };
}
