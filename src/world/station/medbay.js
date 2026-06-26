// STATION MED BAY — a clean, futuristic sick-bay module bolted onto the orbital
// station, meant to sit at the SAME altitude as the walkable station interior in
// space.js (floorY ≈ 260) but on its OWN clear patch of "deck" far EAST of the
// city footprint, so its floor rect never collides with the y=0 city ground at the
// same XZ.
//
// CONTRACT (mirrors the station-interior pieces of space.js):
//   buildStationMedbay(opts={}) -> { group, update(dt), ground, colliders }
//     opts { ox=510, oz=130, floorY=260 }
//   • group      — THREE.Group positioned at WORLD (ox, floorY, oz). ALL content is
//                  built in LOCAL coords on the deck (deck top = group-local y=0).
//   • ground     — [{ minX:ox-19, maxX:ox+19, minZ:oz-16, maxZ:oz+16 }]  (one 38×32
//                  walkable deck rect, in WORLD XZ; the player code lifts you to
//                  floorY while you stand on it).
//   • colliders  — TIGHT world-XZ AABBs around SOLID props only (bio-beds, scanner
//                  posts, holo/DNA pedestals, surgical table + robot base, supply
//                  cabinets, perimeter walls). A clear walkable lane is left open.
//
// WHAT'S INSIDE (going all out):
//   • Three MED PODS / bio-beds, each under a glowing cyan SCANNER ARCH that sweeps
//     back and forth along the patient, trailing a translucent "light sheet".
//   • VITAL-SIGN MONITORS (per-bed + a back-wall bank) drawing a live, scrolling
//     EKG/heartbeat waveform on a real Line whose vertices are rewritten each frame,
//     with a blip dot that flashes on every R-spike.
//   • A six-axis SURGICAL ROBOT arm over an operating table, articulating gently.
//   • SUPPLY CABINETS full of glowing vials + med-kits behind frosted glass.
//   • A central HOLOGRAM of a rotating human body inside a projector beam, plus a
//     spinning DNA double-helix on its own emitter.
//   • Sterile white wall/ceiling panels, cyan medical accent trim + glow strips,
//     red-cross signage, and IV stands beside the beds.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// Materials + shared geometries are created ONCE at module scope. The build phase
// allocates freely; update(dt) only mutates cached transforms / material scalars /
// pre-allocated vertex buffers on small handle lists — never `new` per frame.

import * as THREE from "three";

// ── Shared materials (created ONCE) ───────────────────────────────────────────
// Sterile shell.
const matFloor     = new THREE.MeshStandardMaterial({ color: "#e9eef3", roughness: 0.55, metalness: 0.15 });
const matFloorSeam = new THREE.MeshStandardMaterial({ color: "#0e2a38", roughness: 0.4, emissive: "#22cdfb", emissiveIntensity: 0.7 });
const matWall      = new THREE.MeshStandardMaterial({ color: "#f0f5fa", roughness: 0.6, metalness: 0.08, side: THREE.DoubleSide });
const matWallTrim  = new THREE.MeshStandardMaterial({ color: "#0e2a38", roughness: 0.4, emissive: "#22cdfb", emissiveIntensity: 0.6 });
const matCeil      = new THREE.MeshStandardMaterial({ color: "#dfe6ee", roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide });
const matCeilGlow  = new THREE.MeshStandardMaterial({ color: "#eaf6ff", roughness: 0.3, emissive: "#bdeeff", emissiveIntensity: 0.9 });
// Bio-bed.
const matSteel     = new THREE.MeshStandardMaterial({ color: "#aeb7c1", roughness: 0.4, metalness: 0.6 });
const matSteelDark = new THREE.MeshStandardMaterial({ color: "#6b7480", roughness: 0.5, metalness: 0.55 });
const matPad       = new THREE.MeshStandardMaterial({ color: "#e6edf3", roughness: 0.75, metalness: 0.05 });
const matPillow    = new THREE.MeshStandardMaterial({ color: "#dbe6ef", roughness: 0.8 });
// Scanner arch + its swept light sheet.
const matArch      = new THREE.MeshStandardMaterial({ color: "#163947", roughness: 0.35, metalness: 0.45, emissive: "#2ce6ff", emissiveIntensity: 1.1 });
const matArchRib   = new THREE.MeshStandardMaterial({ color: "#0e2a38", roughness: 0.4, emissive: "#2ce6ff", emissiveIntensity: 0.9 });
const matBeam      = new THREE.MeshStandardMaterial({ color: "#2ce6ff", roughness: 0.3, emissive: "#2ce6ff", emissiveIntensity: 0.8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
// Monitors.
const matMonFrame  = new THREE.MeshStandardMaterial({ color: "#262c34", roughness: 0.5, metalness: 0.4 });
const matScreen    = new THREE.MeshStandardMaterial({ color: "#04141f", roughness: 0.3, metalness: 0.2, emissive: "#0a3550", emissiveIntensity: 0.5 });
const matEkgGreen  = new THREE.LineBasicMaterial({ color: "#38ffae" });
const matEkgCyan   = new THREE.LineBasicMaterial({ color: "#2ce6ff" });
const matBlip      = new THREE.MeshStandardMaterial({ color: "#38ffae", roughness: 0.4, emissive: "#38ffae", emissiveIntensity: 1.0 });
const matBlipCyan  = new THREE.MeshStandardMaterial({ color: "#2ce6ff", roughness: 0.4, emissive: "#2ce6ff", emissiveIntensity: 1.0 });
// Surgical robot + table.
const matRobot     = new THREE.MeshStandardMaterial({ color: "#eef2f6", roughness: 0.4, metalness: 0.3 });
const matRobotJoint= new THREE.MeshStandardMaterial({ color: "#3a424c", roughness: 0.5, metalness: 0.5 });
const matToolGlow  = new THREE.MeshStandardMaterial({ color: "#ff6a5a", roughness: 0.4, emissive: "#ff3a2a", emissiveIntensity: 1.1 });
const matTable     = new THREE.MeshStandardMaterial({ color: "#cfd6dd", roughness: 0.5, metalness: 0.25 });
const matSurgArm   = new THREE.MeshStandardMaterial({ color: "#2a313a", roughness: 0.5, metalness: 0.5 });
const matSurgLamp  = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3, emissive: "#eaffff", emissiveIntensity: 1.2 });
// Supply cabinets + contents.
const matCabinet   = new THREE.MeshStandardMaterial({ color: "#eef3f8", roughness: 0.5, metalness: 0.2 });
const matCabGlass  = new THREE.MeshStandardMaterial({ color: "#bfe8f5", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.24, side: THREE.DoubleSide, emissive: "#2ce6ff", emissiveIntensity: 0.15 });
const matShelf     = new THREE.MeshStandardMaterial({ color: "#c4ccd4", roughness: 0.5, metalness: 0.2 });
const matVialCyan  = new THREE.MeshStandardMaterial({ color: "#2ce6ff", roughness: 0.25, emissive: "#2ce6ff", emissiveIntensity: 0.85, transparent: true, opacity: 0.85 });
const matVialGreen = new THREE.MeshStandardMaterial({ color: "#38ff9a", roughness: 0.25, emissive: "#38ff9a", emissiveIntensity: 0.85, transparent: true, opacity: 0.85 });
const matVialAmber = new THREE.MeshStandardMaterial({ color: "#ffb24a", roughness: 0.25, emissive: "#ff9a1a", emissiveIntensity: 0.85, transparent: true, opacity: 0.85 });
const matKit       = new THREE.MeshStandardMaterial({ color: "#f6f9fc", roughness: 0.6, metalness: 0.05 });
// Hologram + DNA.
const matHolo      = new THREE.MeshStandardMaterial({ color: "#2ce6ff", roughness: 0.3, emissive: "#2ce6ff", emissiveIntensity: 0.95, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
const matHoloBeam  = new THREE.MeshStandardMaterial({ color: "#2ce6ff", roughness: 0.3, emissive: "#2ce6ff", emissiveIntensity: 0.5, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
const matPedestal  = new THREE.MeshStandardMaterial({ color: "#2a313a", roughness: 0.5, metalness: 0.5 });
const matPedRing   = new THREE.MeshStandardMaterial({ color: "#0e2a38", roughness: 0.4, emissive: "#2ce6ff", emissiveIntensity: 1.0 });
const matHelixA    = new THREE.MeshStandardMaterial({ color: "#2ce6ff", roughness: 0.25, emissive: "#2ce6ff", emissiveIntensity: 0.95, transparent: true, opacity: 0.82 });
const matHelixB    = new THREE.MeshStandardMaterial({ color: "#38ff9a", roughness: 0.25, emissive: "#38ff9a", emissiveIntensity: 0.95, transparent: true, opacity: 0.82 });
const matHelixRung = new THREE.MeshStandardMaterial({ color: "#eafcff", roughness: 0.3, emissive: "#cfefff", emissiveIntensity: 0.6, transparent: true, opacity: 0.7 });
// Signage + IV.
const matRed       = new THREE.MeshStandardMaterial({ color: "#ff3a44", roughness: 0.5, emissive: "#ff2a34", emissiveIntensity: 0.75 });
const matSignWhite = new THREE.MeshStandardMaterial({ color: "#f7fbff", roughness: 0.5 });
const matIVPole    = new THREE.MeshStandardMaterial({ color: "#b8c0c8", roughness: 0.35, metalness: 0.6 });
const matIVBag     = new THREE.MeshStandardMaterial({ color: "#d2f0f2", roughness: 0.3, transparent: true, opacity: 0.62, emissive: "#bfeef0", emissiveIntensity: 0.2 });

// ── Shared geometries (created ONCE) ──────────────────────────────────────────
const G = {
  bedFrame:   new THREE.BoxGeometry(2.4, 0.45, 3.8),
  bedLeg:     new THREE.BoxGeometry(0.18, 0.55, 0.18),
  mattress:   new THREE.BoxGeometry(2.0, 0.28, 3.3),
  pillow:     new THREE.BoxGeometry(1.6, 0.18, 0.7),
  arch:       new THREE.TorusGeometry(1.5, 0.13, 12, 30, Math.PI),       // upside-down U (top half)
  archRib:    new THREE.TorusGeometry(1.28, 0.05, 8, 30, Math.PI),        // inner glow rib
  scanPlane:  new THREE.PlaneGeometry(3.0, 1.7),                          // swept light sheet (XY)
  monPost:    new THREE.BoxGeometry(0.1, 2.2, 0.1),
  monFrame:   new THREE.BoxGeometry(2.3, 1.35, 0.12),
  monScreen:  new THREE.BoxGeometry(2.05, 1.1, 0.05),
  blip:       new THREE.SphereGeometry(0.07, 8, 6),
  ivPole:     new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8),
  ivBase:     new THREE.CylinderGeometry(0.32, 0.36, 0.08, 14),
  ivArm:      new THREE.BoxGeometry(0.5, 0.05, 0.05),
  ivBag:      new THREE.BoxGeometry(0.34, 0.5, 0.12),
  ivDrip:     new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8),
  vial:       new THREE.CylinderGeometry(0.07, 0.07, 0.42, 10),
  vialCap:    new THREE.CylinderGeometry(0.075, 0.075, 0.06, 10),
  kit:        new THREE.BoxGeometry(0.5, 0.3, 0.36),
  helixBall:  new THREE.SphereGeometry(0.11, 10, 8),
  helixRung:  new THREE.BoxGeometry(0.84, 0.05, 0.05),
  pedestal:   new THREE.CylinderGeometry(0.95, 1.15, 0.9, 20),
  pedRing:    new THREE.TorusGeometry(0.85, 0.07, 8, 24),
  dnaPed:     new THREE.CylinderGeometry(0.6, 0.75, 0.7, 16),
  robotBase:  new THREE.CylinderGeometry(0.7, 0.82, 0.9, 18),
  robotCol:   new THREE.CylinderGeometry(0.4, 0.42, 1.3, 16),
  jointBall:  new THREE.SphereGeometry(0.32, 14, 10),
  upperArm:   new THREE.BoxGeometry(2.2, 0.36, 0.36),
  foreArm:    new THREE.BoxGeometry(1.8, 0.3, 0.3),
  toolHead:   new THREE.BoxGeometry(0.34, 0.5, 0.34),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function mesh(geo, mat, cast = false, receive = false) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = false, receive = false) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}

// Heartbeat / EKG amplitude for a normalized phase p in [0,1) (a PQRST complex on a
// flat baseline; ~0 at both ends so the scrolling trace wraps seamlessly).
function heartbeat(p) {
  const g = (c, w, a) => a * Math.exp(-((p - c) * (p - c)) / (2 * w * w));
  return (
    g(0.20, 0.022, 0.13) +   // P wave
    g(0.31, 0.007, -0.20) +  // Q
    g(0.34, 0.0055, 1.0) +   // R spike
    g(0.37, 0.008, -0.30) +  // S
    g(0.56, 0.045, 0.24)     // T wave
  );
}

export function buildStationMedbay(opts = {}) {
  const ox = opts.ox ?? 510;
  const oz = opts.oz ?? 130;
  const floorY = opts.floorY ?? 260;

  const group = new THREE.Group();
  group.name = "stationMedbay";
  group.position.set(ox, floorY, oz);

  // Required contract arrays.
  const ground = [{ minX: ox - 19, maxX: ox + 19, minZ: oz - 16, maxZ: oz + 16 }];
  const colliders = [];

  // Local deck extent (group is at world ox,floorY,oz → local maps directly to world XZ).
  const HX = 19, HZ = 16, WALL_H = 5, WALL_T = 0.4;

  // Push a TIGHT world AABB from a LOCAL centre + size.
  function addCol(lx, lz, w, d) {
    colliders.push({ minX: ox + lx - w / 2, maxX: ox + lx + w / 2, minZ: oz + lz - d / 2, maxZ: oz + lz + d / 2 });
  }

  // Animated handles — mutated allocation-free in update().
  const arches = [];   // { mesh, plane, cz, range, rate, phase }
  const ekgs = [];     // { positions, attr, n, half, width, cycles, rate, amp }
  const blips = [];    // { mat, base, amp, rate }
  const spinners = []; // { obj, rate, bobBase, bobAmp, bobRate, phase }
  const joints = [];   // { obj, axis, base, amp, rate, phase }
  const glows = [];    // { mat, base, amp, rate, phase }
  const pulses = [];   // { mat, base, amp, rate, phase }  (opacity throb)

  // ── DECK + sterile shell ────────────────────────────────────────────────────
  const deck = box(HX * 2, 0.3, HZ * 2, matFloor, false, true);
  deck.position.y = -0.15;
  group.add(deck);
  // Cyan floor seams (a light grid) for that clinical look.
  for (const sx of [-9.5, 9.5]) {
    const seam = box(0.12, 0.02, HZ * 2 - 1, matFloorSeam, false, false);
    seam.position.set(sx, 0.012, 0);
    group.add(seam);
  }
  for (const sz of [-8, 0, 8]) {
    const seam = box(HX * 2 - 1, 0.02, 0.12, matFloorSeam, false, false);
    seam.position.set(0, 0.012, sz);
    group.add(seam);
  }

  // Perimeter walls (white panels + a cyan accent stripe), with a doorway gap on
  // the +Z (front) side so the bay reads as enter-able. All are colliders.
  function wallSeg(cx, cz, w, d) {
    const wl = box(w, WALL_H, d, matWall, false, true);
    wl.position.set(cx, WALL_H / 2, cz);
    group.add(wl);
    // accent stripe near eye level
    const stripe = box(w + 0.02, 0.18, d + 0.02, matWallTrim, false, false);
    stripe.position.set(cx, 2.4, cz);
    group.add(stripe);
    addCol(cx, cz, w, d);
  }
  wallSeg(0, -HZ, HX * 2, WALL_T);                 // back (-Z)
  wallSeg(-HX, 0, WALL_T, HZ * 2);                 // left (-X)
  wallSeg(HX, 0, WALL_T, HZ * 2);                  // right (+X)
  wallSeg(-11, HZ, 16, WALL_T);                    // front (+Z) left of door
  wallSeg(11, HZ, 16, WALL_T);                     // front (+Z) right of door

  // Ceiling + cool-white glow strips.
  const ceil = box(HX * 2, 0.3, HZ * 2, matCeil, false, false);
  ceil.position.y = WALL_H;
  group.add(ceil);
  for (const sz of [-8, 0, 8]) {
    const strip = box(HX * 2 - 4, 0.1, 0.6, matCeilGlow, false, false);
    strip.position.set(0, WALL_H - 0.18, sz);
    group.add(strip);
  }
  // One shared gentle pulse on the glow material.
  glows.push({ mat: matCeilGlow, base: 0.85, amp: 0.12, rate: 0.9, phase: 0 });

  // ── RED-CROSS signage ───────────────────────────────────────────────────────
  function redCross(lx, ly, lz, faceZ) {
    const g = new THREE.Group();
    g.position.set(lx, ly, lz);
    if (faceZ < 0) g.rotation.y = Math.PI;
    const backer = box(1.5, 1.5, 0.12, matSignWhite, false, false);
    g.add(backer);
    const v = box(0.42, 1.1, 0.06, matRed, false, false);
    v.position.z = 0.09; g.add(v);
    const h = box(1.1, 0.42, 0.06, matRed, false, false);
    h.position.z = 0.09; g.add(h);
    group.add(g);
  }
  redCross(0, 3.7, -HZ + 0.25, 1);   // back wall, faces +Z
  redCross(0, 4.0, HZ - 0.25, -1);   // over the doorway, faces -Z

  // ── MONITOR builder (vital-sign screen with a live scrolling EKG) ───────────
  // Builds a framed screen facing +Z at LOCAL (lx,ly,lz). cyan=true tints the trace.
  function buildMonitor(parent, lx, ly, lz, cyan) {
    const frame = mesh(G.monFrame, matMonFrame, false, false);
    frame.position.set(lx, ly, lz);
    parent.add(frame);
    const screen = mesh(G.monScreen, matScreen, false, false);
    screen.position.set(lx, ly, lz + 0.07);
    parent.add(screen);

    // EKG Line — vertices live in the screen's LOCAL XY; rewritten each frame.
    const n = 88, width = 1.9, half = width / 2;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = -half + (i / (n - 1)) * width;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.Float32BufferAttribute(positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", attr);
    const line = new THREE.Line(geo, cyan ? matEkgCyan : matEkgGreen);
    line.position.set(lx, ly + 0.15, lz + 0.1);
    parent.add(line);
    ekgs.push({ positions, attr, n, half, width, cycles: 2.2, rate: 0.34 + Math.random() * 0.06, amp: 0.34 });

    // Blip dot (flashes on the R-spike) + a couple of static "readout" pips.
    const blip = mesh(G.blip, cyan ? matBlipCyan : matBlip, false, false);
    blip.position.set(lx + 0.78, ly - 0.42, lz + 0.1);
    parent.add(blip);
    // unique material instance so each blip pulses independently
    const bm = (cyan ? matBlipCyan : matBlip).clone();
    blip.material = bm;
    blips.push({ mat: bm, base: 0.25, amp: 2.0, rate: 1.05 + Math.random() * 0.25 });
  }

  // ── BIO-BED builder (med pod) ───────────────────────────────────────────────
  function buildBed(bx, bz) {
    const bed = new THREE.Group();
    bed.position.set(bx, 0, bz);
    group.add(bed);

    // Frame on four legs; mattress + pillow (head toward -Z).
    const frame = mesh(G.bedFrame, matSteel, true, false);
    frame.position.y = 0.78;
    bed.add(frame);
    for (const lx of [-1.0, 1.0]) for (const lz of [-1.7, 1.7]) {
      const leg = mesh(G.bedLeg, matSteelDark, false, false);
      leg.position.set(lx, 0.27, lz);
      bed.add(leg);
    }
    const pad = mesh(G.mattress, matPad, false, false);
    pad.position.y = 1.14;
    bed.add(pad);
    const pillow = mesh(G.pillow, matPillow, false, false);
    pillow.position.set(0, 1.32, -1.15);
    bed.add(pillow);
    // tight collider around the solid pod
    addCol(bx, bz, 2.6, 4.0);

    // SCANNER ARCH (+ inner glow rib + swept light sheet) straddling the pod.
    const arch = mesh(G.arch, matArch, false, false);
    arch.position.y = 1.3;                       // ends rest near mattress, peak ~2.8
    bed.add(arch);
    const rib = mesh(G.archRib, matArchRib, false, false);
    rib.position.y = 1.3;
    bed.add(rib);
    const sheet = mesh(G.scanPlane, matBeam, false, false);
    sheet.position.set(0, 2.05, 0);
    bed.add(sheet);
    // sweep arch + sheet together along the pod's long (Z) axis
    const archHandle = { mesh: arch, plane: sheet, rib, cz: 0, range: 1.5, rate: 0.9 + Math.random() * 0.3, phase: Math.random() * 6.28 };
    arches.push(archHandle);
    pulses.push({ mat: matBeam, base: 0.2, amp: 0.1, rate: 1.4, phase: archHandle.phase });

    // Per-bed VITAL MONITOR on a post at the head, facing +Z.
    const post = mesh(G.monPost, matSteelDark, false, false);
    post.position.set(0.0, 1.1, -1.95);
    bed.add(post);
    buildMonitor(bed, 0.0, 2.55, -1.95, false);

    // IV STAND beside the foot (+X side). Thin → a small collider only.
    const ivx = 1.55, ivz = 1.2;
    const ivBaseM = mesh(G.ivBase, matSteelDark, false, false);
    ivBaseM.position.set(ivx, 0.04, ivz); bed.add(ivBaseM);
    const ivPole = mesh(G.ivPole, matIVPole, false, false);
    ivPole.position.set(ivx, 1.24, ivz); bed.add(ivPole);
    const ivArm = mesh(G.ivArm, matIVPole, false, false);
    ivArm.position.set(ivx - 0.2, 2.36, ivz); bed.add(ivArm);
    const ivBag = mesh(G.ivBag, matIVBag, false, false);
    ivBag.position.set(ivx - 0.42, 2.05, ivz); bed.add(ivBag);
    const ivDrip = mesh(G.ivDrip, matIVBag, false, false);
    ivDrip.position.set(ivx - 0.42, 1.72, ivz); bed.add(ivDrip);
    addCol(bx + ivx, bz + ivz, 0.7, 0.7);
  }

  buildBed(-12, -11);
  buildBed(0, -11);
  buildBed(12, -11);

  // ── BACK-WALL MONITOR BANK (two big EKG screens, cyan trace) ────────────────
  buildMonitor(group, -6, 3.1, -HZ + 0.3, true);
  buildMonitor(group, 6, 3.1, -HZ + 0.3, true);

  // ── CENTRAL HOLOGRAM — rotating human body in a projector beam ───────────────
  {
    const cx = 0, cz = 1.5;
    const ped = mesh(G.pedestal, matPedestal, true, false);
    ped.position.set(cx, 0.45, cz);
    group.add(ped);
    const ring = mesh(G.pedRing, matPedRing, false, false);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, 0.92, cz);
    group.add(ring);
    glows.push({ mat: matPedRing, base: 0.9, amp: 0.25, rate: 1.6, phase: 0 });
    addCol(cx, cz, 2.0, 2.0);
    // floor halo ring under the projector
    const halo = mesh(new THREE.RingGeometry(1.4, 1.7, 32), matBeam, false, false);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(cx, 0.02, cz);
    group.add(halo);

    // Projector beam (cone widening upward; apex down at the pedestal).
    const beam = mesh(new THREE.ConeGeometry(1.25, 2.6, 24, 1, true), matHoloBeam, false, false);
    beam.rotation.x = Math.PI;        // flip so the wide end is at the top
    beam.position.set(cx, 2.3, cz);
    group.add(beam);

    // Stylized HOLO HUMAN (translucent additive primitives) that spins.
    const human = new THREE.Group();
    human.position.set(cx, 1.0, cz);
    group.add(human);
    const head = mesh(new THREE.SphereGeometry(0.3, 14, 12), matHolo, false, false);
    head.position.y = 1.85; human.add(head);
    const torso = mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.9, 14), matHolo, false, false);
    torso.position.y = 1.15; human.add(torso);
    const pelvis = mesh(new THREE.SphereGeometry(0.38, 12, 10), matHolo, false, false);
    pelvis.position.y = 0.68; pelvis.scale.set(1, 0.7, 0.8); human.add(pelvis);
    for (const s of [-1, 1]) {
      const arm = mesh(new THREE.CylinderGeometry(0.11, 0.1, 1.0, 10), matHolo, false, false);
      arm.position.set(s * 0.48, 1.2, 0);
      arm.rotation.z = s * 0.28; human.add(arm);
      const leg = mesh(new THREE.CylinderGeometry(0.14, 0.11, 1.05, 10), matHolo, false, false);
      leg.position.set(s * 0.17, 0.18, 0);
      leg.rotation.z = s * 0.06; human.add(leg);
    }
    spinners.push({ obj: human, rate: 0.6, bobBase: 1.0, bobAmp: 0.06, bobRate: 1.3, phase: 0 });
    pulses.push({ mat: matHolo, base: 0.34, amp: 0.08, rate: 2.0, phase: 0 });
  }

  // ── DNA DOUBLE-HELIX hologram on its own emitter ────────────────────────────
  {
    const cx = -13, cz = 7.5;
    const ped = mesh(G.dnaPed, matPedestal, true, false);
    ped.position.set(cx, 0.35, cz);
    group.add(ped);
    const ring = mesh(G.pedRing, matPedRing, false, false);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, 0.72, cz);
    ring.scale.set(0.7, 0.7, 0.7);
    group.add(ring);
    addCol(cx, cz, 1.6, 1.6);

    const dna = new THREE.Group();
    dna.position.set(cx, 2.3, cz);
    group.add(dna);
    const PER_TURN = 9, TURNS = 3, N = PER_TURN * TURNS, HEIGHT = 2.5, R = 0.42;
    for (let i = 0; i < N; i++) {
      const a = (i / PER_TURN) * Math.PI * 2;
      const y = (i / (N - 1)) * HEIGHT - HEIGHT / 2;
      const sa = mesh(G.helixBall, matHelixA, false, false);
      sa.position.set(Math.cos(a) * R, y, Math.sin(a) * R); dna.add(sa);
      const sb = mesh(G.helixBall, matHelixB, false, false);
      sb.position.set(Math.cos(a + Math.PI) * R, y, Math.sin(a + Math.PI) * R); dna.add(sb);
      if (i % 2 === 0) {
        const rung = mesh(G.helixRung, matHelixRung, false, false);
        rung.position.set(0, y, 0);
        rung.rotation.y = -a;
        dna.add(rung);
      }
    }
    spinners.push({ obj: dna, rate: 1.1, bobBase: 2.3, bobAmp: 0.08, bobRate: 1.0, phase: 1.5 });
  }

  // ── SURGICAL ROBOT ARM over an operating table ──────────────────────────────
  {
    const tx = 13, tz = 7.5;
    // Operating table (solid).
    const tTop = box(2.0, 0.18, 3.6, matTable, true, false);
    tTop.position.set(tx, 1.0, tz); group.add(tTop);
    for (const lx of [-0.8, 0.8]) for (const lz of [-1.5, 1.5]) {
      const leg = mesh(G.bedLeg, matSteelDark, false, false);
      leg.position.set(tx + lx, 0.55, tz + lz); group.add(leg);
    }
    addCol(tx, tz, 2.2, 3.9);

    // Hanging surgical light over the table.
    const lampMast = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8), matSurgArm, false, false);
    lampMast.position.set(tx, WALL_H - 0.5, tz); group.add(lampMast);
    const lamp = mesh(new THREE.CylinderGeometry(0.9, 0.95, 0.18, 22), matSteel, false, false);
    lamp.position.set(tx, WALL_H - 1.05, tz); group.add(lamp);
    const lampGlow = mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.06, 22), matSurgLamp, false, false);
    lampGlow.position.set(tx, WALL_H - 1.16, tz); group.add(lampGlow);
    glows.push({ mat: matSurgLamp, base: 1.15, amp: 0.15, rate: 0.8, phase: 0.5 });

    // Robot — nested joint groups so a parent rotation drives the whole linkage.
    const rbx = tx + 3.3, rbz = tz;            // base sits between table and the +X wall
    const robot = new THREE.Group();
    robot.position.set(rbx, 0, rbz);
    group.add(robot);
    const base = mesh(G.robotBase, matRobot, true, false);
    base.position.y = 0.45; robot.add(base);
    addCol(rbx, rbz, 1.6, 1.6);
    const col = mesh(G.robotCol, matRobot, false, false);
    col.position.y = 1.45; robot.add(col);

    const shoulder = new THREE.Group();
    shoulder.position.set(0, 2.1, 0);
    robot.add(shoulder);
    const sBall = mesh(G.jointBall, matRobotJoint, false, false); shoulder.add(sBall);
    const upper = mesh(G.upperArm, matRobot, false, false);
    upper.position.set(-1.1, 0, 0); shoulder.add(upper);   // reaches -X toward the table

    const elbow = new THREE.Group();
    elbow.position.set(-2.2, 0, 0);
    shoulder.add(elbow);
    const eBall = mesh(G.jointBall, matRobotJoint, false, false); eBall.scale.setScalar(0.85); elbow.add(eBall);
    const fore = mesh(G.foreArm, matRobot, false, false);
    fore.position.set(-0.9, 0, 0); elbow.add(fore);

    const wrist = new THREE.Group();
    wrist.position.set(-1.8, 0, 0);
    elbow.add(wrist);
    const tool = mesh(G.toolHead, matRobotJoint, false, false);
    tool.position.set(0, -0.28, 0); wrist.add(tool);
    const tip = mesh(new THREE.SphereGeometry(0.09, 8, 6), matToolGlow, false, false);
    tip.position.set(0, -0.56, 0); wrist.add(tip);
    glows.push({ mat: matToolGlow, base: 1.0, amp: 0.5, rate: 3.4, phase: 0 });

    // Base poses + gentle articulation.
    shoulder.rotation.z = -0.12;
    elbow.rotation.z = -0.4;
    joints.push({ obj: shoulder, axis: "z", base: -0.12, amp: 0.12, rate: 0.6, phase: 0 });
    joints.push({ obj: elbow,    axis: "z", base: -0.4,  amp: 0.18, rate: 0.9, phase: 1.2 });
    joints.push({ obj: wrist,    axis: "y", base: 0.0,   amp: 0.6,  rate: 1.4, phase: 0.4 });
    joints.push({ obj: robot,    axis: "y", base: 0.0,   amp: 0.1,  rate: 0.5, phase: 2.0 });
  }

  // ── SUPPLY CABINETS (frosted glass front, shelves of glowing vials + kits) ──
  function buildCabinet(lx, lz, ry) {
    const cab = new THREE.Group();
    cab.position.set(lx, 0, lz);
    cab.rotation.y = ry;
    group.add(cab);
    // body (local: width along X, depth along Z; faces +Z before rotation)
    const body = box(2.4, 3.2, 0.7, matCabinet, false, false);
    body.position.y = 1.6; cab.add(body);
    const glass = box(2.1, 2.7, 0.06, matCabGlass, false, false);
    glass.position.set(0, 1.7, 0.37); cab.add(glass);
    const vialMats = [matVialCyan, matVialGreen, matVialAmber];
    for (let s = 0; s < 3; s++) {
      const sy = 0.9 + s * 0.85;
      const shelf = box(2.1, 0.05, 0.5, matShelf, false, false);
      shelf.position.set(0, sy - 0.28, 0.1); cab.add(shelf);
      // a row of vials
      for (let v = 0; v < 5; v++) {
        const vial = mesh(G.vial, vialMats[(s + v) % 3], false, false);
        vial.position.set(-0.8 + v * 0.4, sy, 0.18); cab.add(vial);
        const cap = mesh(G.vialCap, matShelf, false, false);
        cap.position.set(-0.8 + v * 0.4, sy + 0.24, 0.18); cab.add(cap);
      }
      // a med-kit on the side of one shelf
      if (s < 2) {
        const kit = mesh(G.kit, matKit, false, false);
        kit.position.set(0.78, sy + 0.02, 0.05); cab.add(kit);
        const cross = box(0.18, 0.06, 0.02, matRed, false, false);
        cross.position.set(0.78, sy + 0.02, 0.24); cab.add(cross);
        const cross2 = box(0.06, 0.18, 0.02, matRed, false, false);
        cross2.position.set(0.78, sy + 0.02, 0.24); cab.add(cross2);
      }
    }
    // collider footprint aligned to the (axis-aligned) wall placement
    if (Math.abs(Math.sin(ry)) > 0.5) addCol(lx, lz, 0.7, 2.4);
    else addCol(lx, lz, 2.4, 0.7);
  }
  buildCabinet(-HX + 0.45, 11, Math.PI / 2);   // left wall, faces +X
  buildCabinet(-HX + 0.45, 1, Math.PI / 2);    // left wall, faces +X
  buildCabinet(HX - 0.45, -9, -Math.PI / 2);   // right wall, faces -X

  // ── Animation — ALLOCATION-FREE. Sweep arches, redraw EKG traces, flash blips,
  // spin holograms, articulate the robot, throb the glows. Writes cached transforms
  // / material scalars / pre-allocated vertex buffers only; no `new` per frame. ──
  let t = 0;
  function update(dt) {
    t += dt;

    // Scanner arches sweep along their pods, light sheet riding with them.
    for (let i = 0; i < arches.length; i++) {
      const a = arches[i];
      const z = a.cz + Math.sin(t * a.rate + a.phase) * a.range;
      a.mesh.position.z = z;
      a.rib.position.z = z;
      a.plane.position.z = z;
    }

    // EKG traces — rewrite each vertex's Y from the scrolling heartbeat function.
    for (let i = 0; i < ekgs.length; i++) {
      const e = ekgs[i];
      const inv = 1 / e.width;
      for (let k = 0; k < e.n; k++) {
        const u = (e.positions[k * 3] + e.half) * inv;   // 0..1 across the screen
        let ph = u * e.cycles - t * e.rate;
        ph -= Math.floor(ph);
        e.positions[k * 3 + 1] = heartbeat(ph) * e.amp;
      }
      e.attr.needsUpdate = true;
    }

    // Monitor blips flash on each R-spike.
    for (let i = 0; i < blips.length; i++) {
      const b = blips[i];
      let ph = t * b.rate;
      ph -= Math.floor(ph);
      const hb = heartbeat(ph);
      b.mat.emissiveIntensity = b.base + (hb > 0 ? hb : 0) * b.amp;
    }

    // Spinning holograms (human + DNA) + gentle float.
    for (let i = 0; i < spinners.length; i++) {
      const s = spinners[i];
      s.obj.rotation.y += s.rate * dt;
      s.obj.position.y = s.bobBase + Math.sin(t * s.bobRate + s.phase) * s.bobAmp;
    }

    // Surgical-robot articulation.
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i];
      j.obj.rotation[j.axis] = j.base + Math.sin(t * j.rate + j.phase) * j.amp;
    }

    // Emissive throbs (ceiling glow, ped rings, tool tip, surg lamp).
    for (let i = 0; i < glows.length; i++) {
      const g = glows[i];
      g.mat.emissiveIntensity = g.base + Math.sin(t * g.rate + g.phase) * g.amp;
    }

    // Translucent opacity throbs (scan sheets, holo body).
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i];
      p.mat.opacity = p.base + Math.sin(t * p.rate + p.phase) * p.amp;
    }
  }

  return { group, update, ground, colliders };
}
