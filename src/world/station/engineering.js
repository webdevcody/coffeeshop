// ENGINEERING / REACTOR BAY — a self-contained walkable deck module for the space
// station. A tall central glowing REACTOR CORE pulses in a railed pit while energy
// rings orbit it and electric arcs flicker; thick PIPES + CONDUITS carry flowing
// energy along the walls past control valves, twitching GAUGES and a blinking
// BREAKER PANEL; a robotic maintenance ARM sweeps overhead; tool racks, hazard-
// stripe trim, a grated catwalk floor and rising STEAM round out the bay.
//
// ── CONTRACT (mirrors the other station/world modules) ────────────────────────
//   buildStationEngineering(opts={}) -> { group, update(dt), ground, colliders }
//     opts.ox, opts.oz  WORLD XZ where the bay's CENTRE sits      (default 548,130)
//     opts.floorY       WORLD Y the deck floor sits at            (default 260)
//   • group   THREE.Group placed at world (ox, floorY, oz); ALL content is built in
//             LOCAL coords on the deck (floor at local y=0), so the bay can be
//             dropped anywhere just by moving the group.
//   • ground  one walkable rect (WORLD XZ) covering the deck footprint.
//   • colliders  tight WORLD-XZ AABBs around the solid reactor housing + wall
//             machinery, leaving a clear catwalk lane ringing the core.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// The build phase allocates freely. update(dt) only mutates cached transforms +
// material scalars on small handle lists — no `new` per frame, no Vector3/Color
// churn (everything is written component-wise).

import * as THREE from "three";

// ── LOCAL FOOTPRINT ───────────────────────────────────────────────────────────
const HW_X = 19;   // deck half-extent in X (matches ground rect ox±19)
const HW_Z = 16;   // deck half-extent in Z (matches ground rect oz±16)
const WALL_H = 11; // bulkhead height

// ── tiny build helpers ────────────────────────────────────────────────────────
function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = true, receive = true) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}
function cyl(rt, rb, h, seg, mat, cast = true, receive = true) {
  return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, cast, receive);
}

// Procedural diagonal hazard-stripe texture (yellow/black) — no image assets.
function hazardTex() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 16;
  const x = c.getContext("2d");
  x.fillStyle = "#15161a"; x.fillRect(0, 0, 64, 16);
  x.fillStyle = "#e8c020";
  for (let i = -1; i < 5; i++) {
    x.beginPath();
    x.moveTo(i * 16, 0); x.lineTo(i * 16 + 9, 0);
    x.lineTo(i * 16 + 9 - 16, 16); x.lineTo(i * 16 - 16, 16);
    x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Procedural grated-catwalk floor texture — dark metal frame with punched holes.
function grateTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  x.fillStyle = "#2b2f35"; x.fillRect(0, 0, 64, 64);
  x.fillStyle = "#14161a";                 // recessed holes
  for (let gy = 0; gy < 64; gy += 16)
    for (let gx = 0; gx < 64; gx += 16) x.fillRect(gx + 3, gy + 3, 10, 10);
  x.strokeStyle = "#454c54"; x.lineWidth = 2; // highlighted bar tops
  for (let g = 0; g <= 64; g += 16) {
    x.beginPath(); x.moveTo(g, 0); x.lineTo(g, 64); x.stroke();
    x.beginPath(); x.moveTo(0, g); x.lineTo(64, g); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildStationEngineering(opts = {}) {
  const ox = opts.ox ?? 548;
  const oz = opts.oz ?? 130;
  const floorY = opts.floorY ?? 260;

  const group = new THREE.Group();
  group.name = "stationEngineering";
  group.position.set(ox, floorY, oz);

  // Required contract arrays.
  const ground = [{ minX: ox - HW_X, maxX: ox + HW_X, minZ: oz - HW_Z, maxZ: oz + HW_Z }];
  const colliders = [];
  // localCX/localCZ are deck-local; convert to a WORLD AABB by adding ox/oz.
  const addAABB = (lcx, lcz, w, d) =>
    colliders.push({ minX: ox + lcx - w / 2, maxX: ox + lcx + w / 2, minZ: oz + lcz - d / 2, maxZ: oz + lcz + d / 2 });

  // Animated handle lists (mutated allocation-free in update).
  const ringPivots = [];   // { node, axis:'x'|'y'|'z', rate }
  const arcs = [];         // { mesh, mat, rate, phase }
  const beads = [];        // { mat, rate, phase, base, amp }  flowing-conduit energy
  const gauges = [];       // { needle, rate, phase, amp }
  const blinkers = [];     // { mat, rate, phase }  breaker-panel lamps
  const steams = [];       // { mesh, mat, p, rate, x, z, baseY, riseY, maxOp, sx, sz }
  const armParts = {};     // robotic-arm pivots
  const core = {};         // central core pulse handles

  // ── MATERIALS (per-instance so each bay animates independently) ─────────────
  const M = {
    deck:      new THREE.MeshStandardMaterial({ map: grateTex(), color: "#9aa0a6", roughness: 0.85, metalness: 0.5 }),
    deckEdge:  new THREE.MeshStandardMaterial({ color: "#34383d", roughness: 0.8, metalness: 0.5 }),
    wall:      new THREE.MeshStandardMaterial({ color: "#3c424a", roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide }),
    wallRib:   new THREE.MeshStandardMaterial({ color: "#5a626b", roughness: 0.5, metalness: 0.55 }),
    steel:     new THREE.MeshStandardMaterial({ color: "#5a626b", roughness: 0.5, metalness: 0.7 }),
    steelDark: new THREE.MeshStandardMaterial({ color: "#363c43", roughness: 0.6, metalness: 0.6 }),
    pipe:      new THREE.MeshStandardMaterial({ color: "#8b929a", roughness: 0.4, metalness: 0.75 }),
    pipeWarm:  new THREE.MeshStandardMaterial({ color: "#7d6b5a", roughness: 0.55, metalness: 0.6 }),
    hazard:    new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.55, metalness: 0.3, emissive: "#3a2c00", emissiveIntensity: 0.35 }),
    housing:   new THREE.MeshStandardMaterial({ color: "#6b7480", roughness: 0.45, metalness: 0.7 }),
    rail:      new THREE.MeshStandardMaterial({ color: "#d8a23a", roughness: 0.4, metalness: 0.6, emissive: "#3a2a00", emissiveIntensity: 0.25 }),
    glassCore: new THREE.MeshStandardMaterial({ color: "#0a2a30", roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.4, emissive: "#27e6ff", emissiveIntensity: 1.1 }),
    coreInner: new THREE.MeshStandardMaterial({ color: "#bff7ff", roughness: 0.2, emissive: "#5af2ff", emissiveIntensity: 2.0 }),
    ringGlow:  new THREE.MeshStandardMaterial({ color: "#123036", roughness: 0.3, metalness: 0.2, emissive: "#3fe0ff", emissiveIntensity: 1.3 }),
    nodeGlow:  new THREE.MeshStandardMaterial({ color: "#eaffff", roughness: 0.2, emissive: "#7af6ff", emissiveIntensity: 2.2 }),
    arc:       new THREE.MeshBasicMaterial({ color: "#bfe9ff", transparent: true, opacity: 0.9 }),
    conduit:   new THREE.MeshStandardMaterial({ color: "#10202a", roughness: 0.4, metalness: 0.4 }),
    bead:      null, // beads each get their own material clone (independent flow)
    gaugeFace: new THREE.MeshStandardMaterial({ color: "#11161c", roughness: 0.3, metalness: 0.3, emissive: "#0a2230", emissiveIntensity: 0.5 }),
    needle:    new THREE.MeshStandardMaterial({ color: "#ff5a3a", roughness: 0.4, emissive: "#ff3a1a", emissiveIntensity: 0.8 }),
    panel:     new THREE.MeshStandardMaterial({ color: "#23282e", roughness: 0.6, metalness: 0.4 }),
    steam:     new THREE.MeshBasicMaterial({ color: "#cfe6ee", transparent: true, opacity: 0.0, depthWrite: false }),
    tool:      new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.5, metalness: 0.6 }),
    toolGrip:  new THREE.MeshStandardMaterial({ color: "#b6402a", roughness: 0.7, metalness: 0.2 }),
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 1) DECK + WALLS
  // ════════════════════════════════════════════════════════════════════════════
  const deckTex = M.deck.map;
  deckTex.repeat.set(HW_X, HW_Z); // one grate cell per ~1m
  const floor = box(HW_X * 2, 0.3, HW_Z * 2, M.deck, false, true);
  floor.position.y = -0.15;
  group.add(floor);
  // raised perimeter kick-rail so the deck reads as a contained bay.
  for (const [lx, lz, w, d] of [[0, -HW_Z, HW_X * 2, 0.4], [0, HW_Z, HW_X * 2, 0.4], [-HW_X, 0, 0.4, HW_Z * 2], [HW_X, 0, 0.4, HW_Z * 2]]) {
    const k = box(w, 0.5, d, M.deckEdge, true, true);
    k.position.set(lx, 0.25, lz); group.add(k);
  }

  // Walls (front +Z left open toward the station corridor). The ±X SIDE walls that
  // face the neighbouring zones are OPENED with a wide, full-height central doorway so
  // players walk straight down the station along the east-west axis; only short corner
  // stubs remain for structure — no full-width blank divider across the X ends.
  const mkWall = (w, lx, lz, ry) => {
    const wl = box(w, WALL_H, 0.4, M.wall, false, false);
    wl.position.set(lx, WALL_H / 2, lz); wl.rotation.y = ry; group.add(wl);
    return wl;
  };
  const DOOR_GAP = 12;                       // centered full-height opening (>= 10 m)
  const STUB = (HW_Z * 2 - DOOR_GAP) / 2;    // length of each remaining corner stub (10 m)
  const STUB_CZ = DOOR_GAP / 2 + STUB / 2;   // |local z| centre of each corner stub
  const mkSideWall = (lx) => {               // two corner stubs with a doorway gap between
    for (const sz of [-STUB_CZ, STUB_CZ]) mkWall(STUB, lx, sz, Math.PI / 2);
  };
  mkSideWall(-HW_X); // left  (-X) — wide central doorway opens through into the next zone
  mkSideWall(HW_X);  // right (+X) — wide central doorway opens through into the next zone
  mkWall(HW_X * 2, 0, -HW_Z, 0);           // back  (-Z)
  // wall ribs + a couple of ceiling trusses framing the open core shaft.
  for (const rx of [-12, -6, 6, 12]) {
    const rib = box(0.4, WALL_H, 0.4, M.wallRib, false, false);
    rib.position.set(rx, WALL_H / 2, -HW_Z + 0.3); group.add(rib);
  }
  for (const tz of [-10, 10]) {
    const truss = box(HW_X * 2, 0.5, 0.5, M.steelDark, false, false);
    truss.position.set(0, WALL_H, tz); group.add(truss);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 2) CENTRAL REACTOR CORE in a railed pit
  // ════════════════════════════════════════════════════════════════════════════
  const RP = 5.2;                 // pit / railing radius
  const reactor = new THREE.Group();
  group.add(reactor);
  addAABB(0, 0, RP * 2 + 0.6, RP * 2 + 0.6); // solid central housing — catwalk rings it

  // hazard-stripe floor ring + low curb around the pit
  const hzRing = mesh(new THREE.RingGeometry(RP, RP + 1.3, 48), M.hazard, false, true);
  hzRing.rotation.x = -Math.PI / 2; hzRing.position.y = 0.02;
  const hzT = M.hazard.map; hzT.repeat.set(18, 1);
  reactor.add(hzRing);
  const curb = cyl(RP + 0.15, RP + 0.15, 0.45, 40, M.housing, true, true);
  curb.position.y = 0.22; reactor.add(curb);

  // reactor base housing (stepped) sunk into the deck
  const base0 = cyl(3.4, 3.9, 1.5, 32, M.housing, true, true);
  base0.position.y = 0.75; reactor.add(base0);
  const base1 = cyl(2.7, 3.3, 0.9, 32, M.steelDark, true, true);
  base1.position.y = 1.7; reactor.add(base1);

  // glowing core column + brighter inner column
  const colH = 12, colBaseY = 2.1;
  const colMidY = colBaseY + colH / 2;
  const outerCol = cyl(1.7, 1.9, colH, 28, M.glassCore, false, false);
  outerCol.position.y = colMidY; reactor.add(outerCol);
  const innerCol = cyl(1.1, 1.25, colH - 0.6, 24, M.coreInner, false, false);
  innerCol.position.y = colMidY; reactor.add(innerCol);
  core.outerMat = M.glassCore;
  core.innerMesh = innerCol;
  core.innerMat = M.coreInner;
  core.midY = colMidY;

  // containment rings clamped around the column (static steel)
  for (const ry of [4, 7, 10]) {
    const cr = mesh(new THREE.TorusGeometry(2.05, 0.22, 10, 28), M.steel, true, false);
    cr.rotation.x = Math.PI / 2; cr.position.y = ry; reactor.add(cr);
  }
  // emitter cap on top
  const cap = cyl(0.5, 2.0, 1.2, 24, M.housing, true, false);
  cap.position.y = colBaseY + colH + 0.4; reactor.add(cap);
  const capGlow = mesh(new THREE.SphereGeometry(0.8, 16, 12), M.coreInner, false, false);
  capGlow.position.y = colBaseY + colH + 1.3; reactor.add(capGlow);
  core.capGlow = capGlow;

  // pulsing point light at the core's heart
  const coreLight = new THREE.PointLight("#5af2ff", 2.4, 34, 2.0);
  coreLight.position.set(0, colMidY, 0);
  reactor.add(coreLight);
  core.light = coreLight;

  // ENERGY RINGS orbiting the core — tilted torii on pivots, each with glowing nodes
  const ringSpecs = [
    { r: 3.2, tilt: 0.0, axis: "y", rate: 1.4 },
    { r: 3.9, tilt: 1.05, axis: "y", rate: -1.0 },
    { r: 4.4, tilt: Math.PI / 2, axis: "z", rate: 0.8 },
  ];
  for (const s of ringSpecs) {
    const pivot = new THREE.Group();
    pivot.position.y = colMidY;
    pivot.rotation.x = s.tilt;
    reactor.add(pivot);
    const ring = mesh(new THREE.TorusGeometry(s.r, 0.12, 8, 40), M.ringGlow, false, false);
    ring.rotation.x = Math.PI / 2; // lie flat in the pivot's frame
    pivot.add(ring);
    for (let n = 0; n < 3; n++) {
      const node = mesh(new THREE.SphereGeometry(0.26, 12, 10), M.nodeGlow, false, false);
      const a = (n / 3) * Math.PI * 2;
      node.position.set(Math.cos(a) * s.r, 0, Math.sin(a) * s.r);
      pivot.add(node);
    }
    ringPivots.push({ node: pivot, axis: s.axis, rate: s.rate });
  }

  // ELECTRIC ARCS — jagged emissive blades around the core that flicker on/off
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const blade = mesh(new THREE.BoxGeometry(0.06, 1.8 + (i % 3) * 0.6, 0.06), M.arc.clone(), false, false);
    blade.position.set(Math.cos(a) * 2.0, 3.5 + (i % 4) * 2.2, Math.sin(a) * 2.0);
    blade.rotation.z = (i % 2 ? 0.5 : -0.4);
    blade.rotation.y = a;
    reactor.add(blade);
    arcs.push({ mesh: blade, mat: blade.material, rate: 11 + i * 2.3, phase: i * 1.7 });
  }

  // RAILING ring around the pit (posts + top rail)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const post = cyl(0.06, 0.06, 1.1, 8, M.rail, true, false);
    post.position.set(Math.cos(a) * (RP + 0.7), 0.85, Math.sin(a) * (RP + 0.7));
    reactor.add(post);
  }
  const topRail = mesh(new THREE.TorusGeometry(RP + 0.7, 0.07, 8, 48), M.rail, true, false);
  topRail.rotation.x = Math.PI / 2; topRail.position.y = 1.4; reactor.add(topRail);

  // rising STEAM near the pit vents
  const addSteam = (x, z, riseY, maxOp, scale) => {
    const m = mesh(new THREE.PlaneGeometry(1, 1), M.steam.clone(), false, false);
    m.position.set(x, 0.5, z);
    m.scale.set(scale, scale, scale);
    group.add(m);
    steams.push({ mesh: m, mat: m.material, p: Math.random(), rate: 0.18 + Math.random() * 0.12, x, z, baseY: 0.6, riseY, maxOp, sx: scale, sz: scale });
  };
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    addSteam(Math.cos(a) * (RP + 0.4), Math.sin(a) * (RP + 0.4), 6.5, 0.28, 1.6 + (i % 2) * 0.6);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 3) WALL PIPES + FLOWING-ENERGY CONDUITS, VALVES, GAUGES
  // ════════════════════════════════════════════════════════════════════════════
  M.bead = new THREE.MeshStandardMaterial({ color: "#10202a", emissive: "#34e0ff", emissiveIntensity: 0.6, roughness: 0.4 });

  // A run of pipe + a glowing conduit (beads) along a wall segment.
  // dir: +1 runs along +Z … beads travel the run for a "flow" read.
  const buildPipeRun = (lx, lz, len, ry, y, pipeMat, condColor) => {
    const g = new THREE.Group();
    g.position.set(lx, y, lz); g.rotation.y = ry; group.add(g);
    // two thick pipes
    for (const py of [-0.55, 0.55]) {
      const p = cyl(0.34, 0.34, len, 16, pipeMat, true, false);
      p.rotation.z = Math.PI / 2; p.position.y = py; g.add(p);
      // flange joints
      for (let s = -len / 2 + 1.5; s <= len / 2 - 1.5; s += 3) {
        const fl = cyl(0.42, 0.42, 0.25, 16, M.steelDark, true, false);
        fl.rotation.z = Math.PI / 2; fl.position.set(s, py, 0); g.add(fl);
      }
    }
    // a glowing conduit channel between the pipes with travelling beads
    const chan = box(len, 0.3, 0.3, M.conduit, false, false);
    chan.position.y = 0; g.add(chan);
    const nB = Math.max(6, Math.round(len / 1.4));
    for (let b = 0; b < nB; b++) {
      const beadMat = M.bead.clone();
      if (condColor) beadMat.emissive.set(condColor);
      const bead = mesh(new THREE.SphereGeometry(0.16, 10, 8), beadMat, false, false);
      bead.position.set(-len / 2 + 0.7 + (b / (nB - 1)) * (len - 1.4), 0, 0.16);
      g.add(bead);
      beads.push({ mat: beadMat, rate: 3.2, phase: (b / nB) * Math.PI * 2, base: 0.35, amp: 1.7 });
    }
    return g;
  };

  // left + right walls run front-to-back; back wall runs side-to-side.
  buildPipeRun(-HW_X + 1.3, 0, 28, Math.PI / 2, 5.5, M.pipe, "#34e0ff");
  buildPipeRun(HW_X - 1.3, 0, 28, Math.PI / 2, 5.5, M.pipeWarm, "#ff8a3a");
  buildPipeRun(0, -HW_Z + 1.3, 30, 0, 7.5, M.pipe, "#3affa0");
  addAABB(-HW_X + 1.0, 0, 2.4, 28); // left wall machinery bank
  addAABB(HW_X - 1.0, 0, 2.4, 28);  // right wall machinery bank
  addAABB(0, -HW_Z + 0.9, 30, 1.8); // back wall machinery bank

  // CONTROL VALVES (wheel + spokes + stem) tapped onto the side pipes.
  const addValve = (lx, lz, y, ry) => {
    const g = new THREE.Group(); g.position.set(lx, y, lz); g.rotation.y = ry; group.add(g);
    const stem = cyl(0.12, 0.12, 0.8, 10, M.steel, true, false);
    stem.position.set(0, 0, 0.5); stem.rotation.x = Math.PI / 2; g.add(stem);
    const wheel = mesh(new THREE.TorusGeometry(0.5, 0.08, 8, 20), M.toolGrip, true, false);
    wheel.position.z = 0.95; g.add(wheel);
    for (let s = 0; s < 3; s++) {
      const sp = box(0.9, 0.06, 0.06, M.toolGrip, true, false);
      sp.position.z = 0.95; sp.rotation.z = (s / 3) * Math.PI; g.add(sp);
    }
  };
  addValve(-HW_X + 1.6, -7, 4.6, Math.PI / 2);
  addValve(-HW_X + 1.6, 7, 4.6, Math.PI / 2);
  addValve(HW_X - 1.6, -4, 4.6, -Math.PI / 2);

  // GAUGES (dial face + sweeping needle) — needles animate.
  const addGauge = (lx, lz, y, ry) => {
    const g = new THREE.Group(); g.position.set(lx, y, lz); g.rotation.y = ry; group.add(g);
    const housing = cyl(0.42, 0.42, 0.18, 20, M.steelDark, true, false);
    housing.rotation.x = Math.PI / 2; housing.position.z = 0.1; g.add(housing);
    const face = cyl(0.36, 0.36, 0.04, 20, M.gaugeFace, false, false);
    face.rotation.x = Math.PI / 2; face.position.z = 0.21; g.add(face);
    const needle = box(0.05, 0.5, 0.03, M.needle, false, false);
    needle.geometry.translate(0, 0.25, 0); // shift pivot to the needle's base
    needle.position.set(0, 0, 0.24); g.add(needle);
    gauges.push({ needle, rate: 1.5 + Math.random() * 2.5, phase: Math.random() * 6.28, amp: 1.1 });
  };
  addGauge(-HW_X + 1.7, -10, 6.6, Math.PI / 2);
  addGauge(-HW_X + 1.7, 10, 6.6, Math.PI / 2);
  addGauge(HW_X - 1.7, 8, 6.6, -Math.PI / 2);
  addGauge(HW_X - 1.7, -10, 6.6, -Math.PI / 2);

  // ════════════════════════════════════════════════════════════════════════════
  // 4) BREAKER PANEL with blinking lights (left wall)
  // ════════════════════════════════════════════════════════════════════════════
  {
    const g = new THREE.Group(); g.position.set(-HW_X + 0.6, 2.6, -10); g.rotation.y = Math.PI / 2; group.add(g);
    const panel = box(4.2, 3.4, 0.4, M.panel, true, false);
    g.add(panel);
    addAABB(-HW_X + 0.6, -10, 1.0, 4.4); // panel footprint (folded into wall bank already, kept tight)
    // breaker toggles
    for (let r = 0; r < 3; r++) for (let cc = 0; cc < 6; cc++) {
      const sw = box(0.22, 0.4, 0.12, M.steel, false, false);
      sw.position.set(-1.6 + cc * 0.64, 0.9 - r * 0.55, 0.26); g.add(sw);
    }
    // status lamps grid
    for (let r = 0; r < 2; r++) for (let cc = 0; cc < 8; cc++) {
      const lm = new THREE.MeshStandardMaterial({ color: "#0a1a10", roughness: 0.3, emissive: ["#2bff6a", "#ffd23a", "#ff4a3a"][(r * 8 + cc) % 3], emissiveIntensity: 0.4 });
      const lamp = mesh(new THREE.SphereGeometry(0.1, 10, 8), lm, false, false);
      lamp.position.set(-1.55 + cc * 0.44, -0.9 - r * 0.4, 0.24); g.add(lamp);
      blinkers.push({ mat: lm, rate: 1.5 + Math.random() * 4, phase: Math.random() * 6.28 });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 5) ROBOTIC MAINTENANCE ARM (animated sweep) near the core
  // ════════════════════════════════════════════════════════════════════════════
  {
    const baseLX = 9, baseLZ = 8.5;
    addAABB(baseLX, baseLZ, 2.4, 2.4);
    const pedestal = cyl(1.0, 1.2, 1.4, 18, M.steelDark, true, true);
    pedestal.position.set(baseLX, 0.7, baseLZ); group.add(pedestal);
    // hazard collar on the pedestal
    const collar = cyl(1.05, 1.05, 0.4, 18, M.hazard, true, false);
    collar.position.set(baseLX, 1.5, baseLZ); group.add(collar);

    const yaw = new THREE.Group(); yaw.position.set(baseLX, 1.7, baseLZ); group.add(yaw);
    const shoulder = new THREE.Group(); yaw.add(shoulder);
    const upper = box(0.5, 0.5, 4.0, M.housing, true, false);
    upper.position.set(0, 0, 2.0); shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.set(0, 0, 4.0); shoulder.add(elbow);
    const fore = box(0.4, 0.4, 3.0, M.steel, true, false);
    fore.position.set(0, 0, 1.5); elbow.add(fore);
    const wrist = new THREE.Group(); wrist.position.set(0, 0, 3.0); elbow.add(wrist);
    for (const sx of [-1, 1]) {
      const claw = box(0.12, 0.12, 0.9, M.steelDark, true, false);
      claw.position.set(sx * 0.18, 0, 0.45); claw.rotation.y = sx * 0.25; wrist.add(claw);
    }
    const tip = mesh(new THREE.SphereGeometry(0.16, 10, 8), M.nodeGlow, false, false);
    tip.position.set(0, 0, 0.4); wrist.add(tip);
    armParts.yaw = yaw; armParts.shoulder = shoulder; armParts.elbow = elbow; armParts.wrist = wrist;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 6) TOOL RACK on the back wall
  // ════════════════════════════════════════════════════════════════════════════
  {
    const g = new THREE.Group(); g.position.set(8, 2.4, -HW_Z + 0.7); group.add(g);
    const board = box(5, 3, 0.2, M.panel, true, false);
    g.add(board);
    const railTop = box(5, 0.12, 0.3, M.steel, true, false);
    railTop.position.set(0, 1.2, 0.25); g.add(railTop);
    // hanging tools (wrench/hammer-ish + pry bars)
    for (let i = 0; i < 5; i++) {
      const lx = -1.8 + i * 0.9;
      const shaft = cyl(0.06, 0.06, 1.4 - (i % 3) * 0.3, 8, M.tool, true, false);
      shaft.position.set(lx, 0.3, 0.28); g.add(shaft);
      const head = box(0.32, 0.32, 0.22, M.steelDark, true, false);
      head.position.set(lx, 1.0 - (i % 3) * 0.15, 0.3); g.add(head);
      const grip = cyl(0.08, 0.08, 0.4, 8, M.toolGrip, true, false);
      grip.position.set(lx, -0.4 - (i % 3) * 0.15, 0.3); g.add(grip);
    }
    addAABB(8, -HW_Z + 0.6, 5.2, 1.0);
  }

  // warning-stripe trim band along the front edge of the catwalk
  {
    const trim = box(HW_X * 2 - 1, 0.06, 0.6, M.hazard, false, true);
    const tt = M.hazard.map; // shared map; repeat already set, fine for trim too
    trim.position.set(0, 0.31, HW_Z - 0.6); group.add(trim);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UPDATE — allocation-free
  // ════════════════════════════════════════════════════════════════════════════
  let t = 0;
  function update(dt) {
    t += dt;

    // core pulse: breathe emissive + inner column scale + light intensity
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    core.outerMat.emissiveIntensity = 0.8 + pulse * 1.0;
    core.innerMat.emissiveIntensity = 1.4 + pulse * 1.6;
    const s = 1 + pulse * 0.06;
    core.innerMesh.scale.set(s, 1, s);
    core.capGlow.scale.setScalar(0.85 + pulse * 0.3);
    core.light.intensity = 1.8 + pulse * 1.8;

    // orbiting energy rings
    for (let i = 0; i < ringPivots.length; i++) {
      const r = ringPivots[i];
      r.node.rotation[r.axis] += r.rate * dt;
    }

    // electric-arc flicker (multi-frequency sin → pseudo-random on/off)
    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      const f = Math.sin(t * a.rate + a.phase) * Math.sin(t * (a.rate * 0.37) + a.phase * 2.1);
      const on = f > 0.45;
      a.mesh.visible = on;
      a.mat.opacity = on ? 0.55 + f * 0.45 : 0;
    }

    // flowing-conduit energy beads (travelling brightness wave)
    for (let i = 0; i < beads.length; i++) {
      const b = beads[i];
      b.mat.emissiveIntensity = b.base + (0.5 + 0.5 * Math.sin(t * b.rate - b.phase)) * b.amp;
    }

    // twitching gauge needles
    for (let i = 0; i < gauges.length; i++) {
      const g = gauges[i];
      g.needle.rotation.z = Math.sin(t * g.rate + g.phase) * g.amp;
    }

    // breaker-panel blinkers
    for (let i = 0; i < blinkers.length; i++) {
      const k = blinkers[i];
      k.mat.emissiveIntensity = Math.sin(t * k.rate + k.phase) > 0.3 ? 1.5 : 0.12;
    }

    // robotic arm sweep
    if (armParts.yaw) {
      armParts.yaw.rotation.y = Math.sin(t * 0.5) * 1.2;
      armParts.shoulder.rotation.x = -0.5 + Math.sin(t * 0.7) * 0.35;
      armParts.elbow.rotation.x = 0.8 + Math.sin(t * 0.9 + 1.0) * 0.4;
      armParts.wrist.rotation.z = Math.sin(t * 1.3) * 0.6;
    }

    // rising steam puffs (rise + fade, recycle)
    for (let i = 0; i < steams.length; i++) {
      const p = steams[i];
      p.p += dt * p.rate;
      if (p.p > 1) p.p -= 1;
      p.mesh.position.y = p.baseY + p.p * p.riseY;
      p.mat.opacity = Math.sin(p.p * Math.PI) * p.maxOp;
      const grow = p.sx * (0.7 + p.p * 0.9);
      p.mesh.scale.set(grow, grow, grow);
    }
  }

  return { group, update, ground, colliders };
}

export default buildStationEngineering;
