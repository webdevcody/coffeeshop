// COMMAND BRIDGE — a richly detailed starship-style command deck you can walk
// around inside. Built as a self-contained module that drops a fully-furnished
// bridge onto a raised deck somewhere in the world (by default far EAST of the
// city, up at the space-station altitude so it shares that sky).
//
// CONTRACT (mirrors the other walkable-interior builders):
//   buildStationCommand(opts = {}) -> { group, update(dt), ground, colliders }
//     opts { ox=320, oz=130, floorY=260 }
//   • group     — a THREE.Group positioned at WORLD (ox, floorY, oz). EVERY child
//                 lives in LOCAL coords resting on the deck (local y >= 0), so the
//                 deck top is local y=0 and the whole room can be re-homed just by
//                 moving the group.
//   • ground    — ONE walkable WORLD-coord deck rect:
//                 [{ minX:ox-19, maxX:ox+19, minZ:oz-16, maxZ:oz+16 }]
//   • colliders — tight WORLD-coord AABBs for SOLID furniture only (captain's
//                 dais, console banks, holo-table). The wide lateral aisles and a
//                 central lane are deliberately left clear so you can walk through.
//   • update(dt)— ALLOCATION-FREE. Mutates cached material emissive scalars,
//                 texture offsets and transforms on a small list of animated
//                 handles. No `new` per frame.
//
// LAYOUT (local axes): +X = right, +Z = FORWARD (the big main viewscreen wall),
// -Z = aft (the entrance walkway). The captain's chair sits on a central dais
// facing +Z toward the viewscreen; a holographic star-map hovers over a table
// just ahead of it; curved console banks line the port/starboard walls and the
// forward helm. FPS is not a concern here — it goes all out on detail.

import * as THREE from "three";

// ── Shared geometries (created ONCE; scaled per use) ──────────────────────────
const UNIT_BOX    = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL    = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
const UNIT_SPHERE = new THREE.SphereGeometry(0.5, 20, 14);
const RIVET_GEO   = new THREE.SphereGeometry(0.06, 6, 5);

// ── Shared (non-animated) materials (created ONCE) ────────────────────────────
const deckMat     = new THREE.MeshStandardMaterial({ color: "#2e343c", roughness: 0.7,  metalness: 0.55 });
const deckInlayMat= new THREE.MeshStandardMaterial({ color: "#23282f", roughness: 0.55, metalness: 0.6 });
const wallMat     = new THREE.MeshStandardMaterial({ color: "#aeb6c1", roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide });
const wallDarkMat = new THREE.MeshStandardMaterial({ color: "#7d858f", roughness: 0.5,  metalness: 0.5 });
const ribMat      = new THREE.MeshStandardMaterial({ color: "#5d646d", roughness: 0.45, metalness: 0.65 });
const pipeMat     = new THREE.MeshStandardMaterial({ color: "#8a9099", roughness: 0.4,  metalness: 0.7 });
const pipeDarkMat = new THREE.MeshStandardMaterial({ color: "#454b53", roughness: 0.5,  metalness: 0.6 });
const ventMat     = new THREE.MeshStandardMaterial({ color: "#3b4047", roughness: 0.6,  metalness: 0.5 });
const rivetMat    = new THREE.MeshStandardMaterial({ color: "#cfd5dc", roughness: 0.35, metalness: 0.85 });
const ceilMat     = new THREE.MeshStandardMaterial({ color: "#9aa2ac", roughness: 0.6,  metalness: 0.35, side: THREE.DoubleSide });
const frameMat    = new THREE.MeshStandardMaterial({ color: "#4c535c", roughness: 0.4,  metalness: 0.75 });
const consoleMat  = new THREE.MeshStandardMaterial({ color: "#363d45", roughness: 0.5,  metalness: 0.55 });
const consoleTopMat = new THREE.MeshStandardMaterial({ color: "#262b31", roughness: 0.45, metalness: 0.6 });
const daisMat     = new THREE.MeshStandardMaterial({ color: "#3a414a", roughness: 0.55, metalness: 0.5 });
const daisTrimMat = new THREE.MeshStandardMaterial({ color: "#2a2f35", roughness: 0.5,  metalness: 0.6 });
const chairMat    = new THREE.MeshStandardMaterial({ color: "#21262c", roughness: 0.55, metalness: 0.4 });
const chairCushMat= new THREE.MeshStandardMaterial({ color: "#3a4756", roughness: 0.8,  metalness: 0.1 });
const glassMat    = new THREE.MeshStandardMaterial({ color: "#08101f", roughness: 0.1,  metalness: 0.0, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
const earthMat    = new THREE.MeshStandardMaterial({ color: "#27567f", roughness: 0.85, metalness: 0.0, emissive: "#0f2c52", emissiveIntensity: 0.5, flatShading: true });
const earthLandMat= new THREE.MeshStandardMaterial({ color: "#3f8a55", roughness: 1.0, emissive: "#16331f", emissiveIntensity: 0.3 });
const screenBackMat = new THREE.MeshStandardMaterial({ color: "#020812", roughness: 0.5, metalness: 0.2 });

// ── Mesh helpers (build-time allocation only) ─────────────────────────────────
function box(w, h, d, mat, x, y, z, cast = false) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}
function cyl(r, h, mat, x, y, z, cast = false) {
  const m = new THREE.Mesh(UNIT_CYL, mat);
  m.scale.set(r * 2, h, r * 2);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}
function sph(r, mat, x, y, z, cast = false) {
  const m = new THREE.Mesh(UNIT_SPHERE, mat);
  m.scale.setScalar(r * 2);
  m.position.set(x, y, z);
  m.castShadow = cast;
  return m;
}

// A small procedural "live data" texture (scrolling rows + a waveform + ticks) so
// each console screen reads as a busy readout. Drawn ONCE; scrolled at runtime by
// nudging its .offset.y (allocation-free). Wraps vertically for a seamless loop.
function dataTexture(bgHex, inkHex) {
  if (typeof document === "undefined") return null; // node --check / headless: skip
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const x = c.getContext("2d");
  x.fillStyle = bgHex;
  x.fillRect(0, 0, s, s);
  // Faint column grid.
  x.strokeStyle = "rgba(255,255,255,0.05)";
  x.lineWidth = 1;
  for (let gx = 0; gx < s; gx += 16) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, s); x.stroke(); }
  // Scrolling data rows — variable-length bars, like log lines / bar graphs.
  for (let y = 3; y < s; y += 8) {
    const w = 8 + Math.random() * 92;
    x.globalAlpha = 0.35 + Math.random() * 0.6;
    x.fillStyle = inkHex;
    x.fillRect(6, y, w, 3);
    if (Math.random() < 0.4) { x.fillRect(6 + w + 4, y, 4 + Math.random() * 16, 3); }
    x.globalAlpha = 1;
  }
  // A bright waveform sweeping across the panel.
  x.strokeStyle = inkHex;
  x.lineWidth = 1.6;
  x.beginPath();
  for (let px = 0; px <= s; px += 2) {
    const yy = s * 0.5 + Math.sin(px * 0.18) * 12 + Math.sin(px * 0.5) * 4;
    if (px === 0) x.moveTo(px, yy); else x.lineTo(px, yy);
  }
  x.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildStationCommand(opts = {}) {
  const ox = opts.ox ?? 320;
  const oz = opts.oz ?? 130;
  const floorY = opts.floorY ?? 260;

  const group = new THREE.Group();
  group.name = "stationCommand";
  group.position.set(ox, floorY, oz);

  // Walkable deck rect (WORLD coords) — the single returned ground rect.
  const ground = [{ minX: ox - 19, maxX: ox + 19, minZ: oz - 16, maxZ: oz + 16 }];
  const colliders = [];

  // Viewscreen animation handles (written during build, read in this build's
  // update()). Local so multiple bridges never share state.
  const viewscreen = { earth: null, starMat: null };

  // ── Animated handles (collected at build → mutated in update, no allocation) ─
  const screens = [];      // { mat, base, amp, rate, phase }  emissive pulse
  const scrollers = [];    // { tex, speed }                   scrolling data maps
  const statusLights = []; // { mat, onI, offI, rate, phase }  blinking LEDs
  const strips = [];       // { mat, base, amp, rate, phase }  floor/ceiling glow
  const holoMats = [];     // { mat, base, amp, rate, phase }  hologram shimmer

  // Footprint half-extents (the deck is 38 x 32 m).
  const HW = 19, HD = 16, WALL_H = 6.5, WT = 0.5;

  // Push a SOLID-furniture collider given a LOCAL center + footprint (-> world AABB).
  function pushCollider(lx, lz, w, d) {
    colliders.push({
      minX: ox + lx - w / 2, maxX: ox + lx + w / 2,
      minZ: oz + lz - d / 2, maxZ: oz + lz + d / 2,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 1) DECK — metallic floor plate, recessed inlay ring + glowing walkway strips.
  // ════════════════════════════════════════════════════════════════════════════
  const deck = box(HW * 2, 0.4, HD * 2, deckMat, 0, -0.2, 0, false);
  deck.castShadow = false;
  group.add(deck);
  // Darker recessed inlay panels (cosmetic plating seams).
  for (let gx = -3; gx <= 3; gx++) {
    group.add(box(0.12, 0.02, HD * 2 - 1, deckInlayMat, gx * 5, 0.01, 0, false));
  }
  for (let gz = -2; gz <= 2; gz++) {
    group.add(box(HW * 2 - 1, 0.02, 0.12, deckInlayMat, 0, 0.01, gz * 6, false));
  }
  // A concentric inlay ring framing the central command island.
  {
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 5.6, 48), deckInlayMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);
  }

  // FLOOR LIGHT STRIPS — twin glowing runners down the port & starboard aisles,
  // each segment its own material so a pulse can travel along them.
  for (const sx of [-9.5, 9.5]) {
    for (let i = 0; i < 9; i++) {
      const lz = -13.5 + i * 3.4;
      const mat = new THREE.MeshStandardMaterial({ color: "#0c2030", emissive: "#34c8ff", emissiveIntensity: 0.7, roughness: 0.4 });
      const strip = box(0.5, 0.05, 2.4, mat, sx, 0.04, lz, false);
      strip.castShadow = false;
      group.add(strip);
      strips.push({ mat, base: 0.5, amp: 0.55, rate: 3.2, phase: i * 0.7 + (sx < 0 ? 0 : 0.35) });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 2) WALLS — metallic paneling ringing the deck, with greebles (ribs, pipes,
  //    vents, rivets, conduit). Inner faces sit exactly on the walkable boundary
  //    so the panels never intrude on the deck rect; they carry no colliders (the
  //    deck rect already bounds the player).
  // ════════════════════════════════════════════════════════════════════════════
  function wallPanel(cx, cz, w, faceAxis) {
    // faceAxis: 'z' wall spans X (front/back); 'x' wall spans Z (sides).
    const isZ = faceAxis === "z";
    const ww = isZ ? w : WT, dd = isZ ? WT : w;
    group.add(box(ww, WALL_H, dd, wallMat, cx, WALL_H / 2, cz, false));
    // A darker wainscot band along the floor + a header band up top.
    group.add(box(isZ ? w : WT + 0.04, 1.0, isZ ? WT + 0.04 : w, wallDarkMat, cx, 0.5, cz, false));
    group.add(box(isZ ? w : WT + 0.04, 0.6, isZ ? WT + 0.04 : w, wallDarkMat, cx, WALL_H - 0.5, cz, false));
  }
  // Back (-Z) wall split to leave a 4 m entrance gap at center.
  wallPanel(-9.75, -HD - WT / 2, HW - 1.5, "z");
  wallPanel(9.75, -HD - WT / 2, HW - 1.5, "z");
  // Side walls (the LEFT/-X and RIGHT/+X ends that face the neighbouring zones):
  // OPEN them with a wide, full-height central doorway so you walk straight down
  // the station along X instead of hitting a wall. We keep ~10 m corner stubs at
  // each end for structure and carve a 12 m gap (z in [-6, 6]) clean through.
  const SIDE_GAP_HALF = 6;                        // half-width of the open doorway (gap = 12 m)
  const SIDE_STUB_LEN = HD - SIDE_GAP_HALF;       // 10 m stub from doorway edge to each corner
  const SIDE_STUB_C   = (SIDE_GAP_HALF + HD) / 2; // 11 m: center of each corner stub
  for (const wx of [-HW - WT / 2, HW + WT / 2]) {
    wallPanel(wx, -SIDE_STUB_C, SIDE_STUB_LEN, "x"); // aft (-Z) corner stub
    wallPanel(wx,  SIDE_STUB_C, SIDE_STUB_LEN, "x"); // fore (+Z) corner stub
  }
  // Front (+Z) wall — solid backing for the main viewscreen.
  wallPanel(0, HD + WT / 2, HW * 2, "z");

  // Greeble pass: structural ribs + conduit pipes + vents on every wall, plus a
  // baked rivet field. Ribs are vertical pilasters; pipes run horizontally.
  const rivetPlacements = [];
  function greebleWallX(wx, faceNX) {
    // wx = wall plane X; faceNX = +1 if the visible face points toward +X.
    // This wall now has a central doorway (|z| < SIDE_GAP_HALF), so its greebles
    // are kept clear of the gap: ribs only sit on the corner stubs, and the conduit
    // pipes are split into fore/aft runs that stop at the doorway edges.
    const fx = wx + faceNX * 0.06;
    for (let z = -HD + 2; z <= HD - 2; z += 3.6) {
      if (Math.abs(z) < SIDE_GAP_HALF + 0.5) continue; // keep the doorway clear
      group.add(box(0.35, WALL_H - 1.4, 0.5, ribMat, fx, WALL_H / 2, z, false)); // rib pilaster
      rivetPlacements.push([fx + faceNX * 0.28, 1.1, z], [fx + faceNX * 0.28, WALL_H - 1.1, z]);
    }
    // Two horizontal conduit pipes, each SPLIT into fore/aft runs flanking the gap.
    const segEnd = HD - 0.75, segLen = segEnd - SIDE_GAP_HALF, segC = (SIDE_GAP_HALF + segEnd) / 2;
    for (const py of [1.6, 4.4]) {
      for (const sgn of [-1, 1]) {
        const p = cyl(0.16, segLen, py < 3 ? pipeMat : pipeDarkMat, fx + faceNX * 0.22, py, sgn * segC, false);
        p.rotation.x = Math.PI / 2;
        group.add(p);
      }
    }
    // A couple of louvered vents (on the corner stubs, clear of the doorway).
    for (const vz of [-7, 7]) {
      group.add(box(0.18, 1.4, 2.2, ventMat, fx + faceNX * 0.12, 2.6, vz, false));
      for (let s = -2; s <= 2; s++) {
        group.add(box(0.2, 0.12, 2.0, wallDarkMat, fx + faceNX * 0.16, 2.6 + s * 0.32, vz, false));
      }
    }
  }
  function greebleWallZ(wz, faceNZ) {
    const fz = wz + faceNZ * 0.06;
    for (let x = -HW + 2.5; x <= HW - 2.5; x += 4.0) {
      group.add(box(0.5, WALL_H - 1.4, 0.35, ribMat, x, WALL_H / 2, fz, false));
      rivetPlacements.push([x, 1.1, fz + faceNZ * 0.28], [x, WALL_H - 1.1, fz + faceNZ * 0.28]);
    }
    for (const py of [1.6, 4.4]) {
      const p = cyl(0.16, HW * 2 - 1.5, py < 3 ? pipeMat : pipeDarkMat, 0, py, fz + faceNZ * 0.22, false);
      p.rotation.z = Math.PI / 2;
      group.add(p);
    }
  }
  greebleWallX(-HW, +1);
  greebleWallX(HW, -1);
  greebleWallZ(-HD, +1);  // aft wall greebles face into the room
  // (front wall is covered by the viewscreen, so it gets only a rivet seam below)

  // Bake the rivet field into one InstancedMesh (shared geo + material).
  if (rivetPlacements.length) {
    const inst = new THREE.InstancedMesh(RIVET_GEO, rivetMat, rivetPlacements.length);
    inst.castShadow = false; inst.receiveShadow = false;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < rivetPlacements.length; i++) {
      const [rx, ry, rz] = rivetPlacements[i];
      m4.makeTranslation(rx, ry, rz);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 3) CEILING — paneled overhead with two long glowing light strips + spotlights.
  // ════════════════════════════════════════════════════════════════════════════
  group.add(box(HW * 2, 0.3, HD * 2, ceilMat, 0, WALL_H, 0, false));
  for (let x = -HW + 3; x <= HW - 3; x += 5) {
    group.add(box(0.3, 0.4, HD * 2 - 2, ribMat, x, WALL_H - 0.2, 0, false)); // ceiling beam
  }
  for (const sx of [-7, 7]) {
    for (let i = 0; i < 6; i++) {
      const lz = -13 + i * 5.2;
      const mat = new THREE.MeshStandardMaterial({ color: "#dff0ff", emissive: "#bfe4ff", emissiveIntensity: 0.9, roughness: 0.3 });
      const strip = box(0.7, 0.12, 3.6, mat, sx, WALL_H - 0.36, lz, false);
      strip.castShadow = false;
      group.add(strip);
      strips.push({ mat, base: 0.8, amp: 0.25, rate: 1.6, phase: i * 0.5 + (sx < 0 ? 0 : 1.0) });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 4) MAIN VIEWSCREEN — a huge framed forward display on the +Z wall showing a
  //    starfield + a slowly rotating Earth, behind a thin glass pane.
  // ════════════════════════════════════════════════════════════════════════════
  {
    const scW = 22, scH = 4.4, scCY = 3.6, scZ = HD - 0.08;
    // Bezel frame + a glowing inner trim.
    group.add(box(scW + 1.4, scH + 1.4, 0.5, frameMat, 0, scCY, scZ + 0.15, false));
    const trimMat = new THREE.MeshStandardMaterial({ color: "#0c2433", emissive: "#37b6ff", emissiveIntensity: 0.8, roughness: 0.4 });
    group.add(box(scW + 0.5, scH + 0.5, 0.3, trimMat, 0, scCY, scZ + 0.02, false));
    screens.push({ mat: trimMat, base: 0.7, amp: 0.3, rate: 0.8, phase: 0 });
    // Dark space backdrop.
    group.add(box(scW, scH, 0.06, screenBackMat, 0, scCY, scZ - 0.05, false));

    // Starfield on the screen (a flat Points cloud just in front of the backdrop).
    const N = 360;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * (scW - 0.6);
      pos[i * 3 + 1] = scCY + (Math.random() - 0.5) * (scH - 0.4);
      pos[i * 3 + 2] = scZ - 0.12 - Math.random() * 0.18;
      const b = 0.6 + Math.random() * 0.4;
      const tint = Math.random();
      col[i * 3] = (tint < 0.2 ? 1.0 : tint < 0.4 ? 0.75 : 1.0) * b;
      col[i * 3 + 1] = (tint < 0.2 ? 0.85 : 0.85) * b;
      col[i * 3 + 2] = (tint < 0.4 ? 1.0 : 0.9) * b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    starGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const starMat = new THREE.PointsMaterial({ size: 0.12, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    group.add(stars);

    // Earth — a flattened glowing marble in the lower-left of the screen, slowly
    // spinning. Flattened in Z so it barely protrudes from the wall.
    const earth = sph(1.25, earthMat, -6.5, scCY - 0.4, scZ - 0.5, false);
    earth.scale.z *= 0.45;
    group.add(earth);
    for (const [ea, eb] of [[0.4, 0.3], [-0.7, 0.8], [1.6, -0.4], [2.5, 0.5]]) {
      const land = sph(0.5, earthLandMat, 0, 0, 0, false);
      const nx = Math.cos(ea) * Math.cos(eb), ny = Math.sin(eb), nz = Math.sin(ea) * Math.cos(eb);
      land.position.set(nx * 1.1, ny * 1.1, nz * 1.1);
      land.scale.set(0.9, 0.9, 0.25);
      earth.add(land);
    }

    // Glass pane over the whole screen.
    group.add(box(scW, scH, 0.04, glassMat, 0, scCY, scZ - 0.2, false));

    // Stash for animation.
    viewscreen.earth = earth;
    viewscreen.starMat = starMat;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 5) CONSOLE BANKS — curved rows of control consoles with angled glowing
  //    data screens + blinking status lights. Each console is a solid collider.
  // ════════════════════════════════════════════════════════════════════════════
  // Build one console facing +Z (operator stands at -Z, screen tilts up toward
  // them). It is then rotated/placed by the caller. Returns nothing; registers a
  // collider + animated handles. screenTint/dataInk vary per bank for variety.
  const dataTints = ["#34ffd0", "#ffb13a", "#52b8ff", "#ff5a8a", "#9cff5a"];
  let tintIx = 0;
  function makeConsole(lx, lz, rotY, cw, cd) {
    const g = new THREE.Group();
    g.position.set(lx, 0, lz);
    g.rotation.y = rotY;
    group.add(g);

    // Cabinet body (wedge-ish: a base + a slightly narrower top).
    g.add(box(2.6, 1.0, 1.2, consoleMat, 0, 0.5, 0, true));
    g.add(box(2.7, 0.16, 1.3, consoleTopMat, 0, 1.02, 0, false));
    // A kick-plate + side cheeks.
    g.add(box(2.7, 0.3, 0.1, daisTrimMat, 0, 0.15, 0.6, false));
    g.add(box(0.12, 1.0, 1.2, daisTrimMat, -1.3, 0.5, 0, false));
    g.add(box(0.12, 1.0, 1.2, daisTrimMat, 1.3, 0.5, 0, false));

    // Angled top control deck (buttons baked as a glowing strip).
    const deckPanelMat = new THREE.MeshStandardMaterial({ color: "#14242e", emissive: "#2a99c0", emissiveIntensity: 0.5, roughness: 0.4 });
    const ctrl = box(2.4, 0.08, 0.9, deckPanelMat, 0, 1.18, -0.1, false);
    ctrl.rotation.x = -0.5;
    g.add(ctrl);
    screens.push({ mat: deckPanelMat, base: 0.45, amp: 0.2, rate: 2.4, phase: Math.random() * 6.28 });

    // Upright data SCREEN riser, tilted back, facing the operator (+Z).
    const tint = dataTints[tintIx % dataTints.length];
    const ink = dataTints[(tintIx + 2) % dataTints.length];
    tintIx++;
    const tex = dataTexture("#06121c", ink);
    const scrMat = new THREE.MeshStandardMaterial({
      color: "#08161f", emissive: tint, emissiveIntensity: 0.75,
      emissiveMap: tex || null, map: tex || null, roughness: 0.32, metalness: 0.1,
    });
    const scr = box(2.3, 1.5, 0.1, scrMat, 0, 2.0, -0.5, false);
    scr.rotation.x = 0.28;
    g.add(scr);
    // Screen surround.
    g.add(box(2.5, 1.7, 0.06, frameMat, 0, 2.0, -0.56, false));
    screens.push({ mat: scrMat, base: 0.6, amp: 0.35, rate: 1.2 + Math.random(), phase: Math.random() * 6.28 });
    if (tex) scrollers.push({ tex, speed: 0.12 + Math.random() * 0.18 });

    // Blinking status LEDs across the cabinet front.
    for (let i = -2; i <= 2; i++) {
      const onC = i % 2 ? "#ff4a4a" : "#4aff7a";
      const ledMat = new THREE.MeshStandardMaterial({ color: "#101010", emissive: onC, emissiveIntensity: 1.0, roughness: 0.4 });
      g.add(sph(0.07, ledMat, i * 0.4, 0.78, 0.61, false));
      statusLights.push({ mat: ledMat, onI: 1.6, offI: 0.08, rate: 1.5 + Math.random() * 2.5, phase: Math.random() * 6.28 });
    }

    // Small lit reading lamp arching over the deck.
    g.add(cyl(0.04, 0.7, frameMat, -1.0, 1.3, 0.1, false));

    // Collider (world AABB) sized to the console footprint in its final orientation.
    pushCollider(lx, lz, cw, cd);
  }

  // PORT bank (-X wall), screens facing +X (rotY = +PI/2). Pulled into a shallow
  // concave arc by nudging the end consoles toward the room.
  for (const lz of [-9, -3, 3, 9]) {
    const curve = (Math.abs(lz) / 9) * 1.3;
    makeConsole(-15.6 + curve, lz, Math.PI / 2, 1.7, 3.0);
  }
  // STARBOARD bank (+X wall), screens facing -X (rotY = -PI/2).
  for (const lz of [-9, -3, 3, 9]) {
    const curve = (Math.abs(lz) / 9) * 1.3;
    makeConsole(15.6 - curve, lz, -Math.PI / 2, 1.7, 3.0);
  }
  // FORWARD HELM bank below the viewscreen, screens facing -Z (rotY = PI),
  // arced concave toward the captain.
  for (const lx of [-6.5, 0, 6.5]) {
    const curve = (Math.abs(lx) / 6.5) * 0.9;
    makeConsole(lx, 13.6 - curve, Math.PI, 3.0, 1.7);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 6) CAPTAIN'S DAIS + COMMAND CHAIR — raised platform amidships-aft, facing the
  //    viewscreen, ringed by a handrail.
  // ════════════════════════════════════════════════════════════════════════════
  {
    const dx = 0, dz = -8;
    const dais = new THREE.Group();
    dais.position.set(dx, 0, dz);
    group.add(dais);
    // Two-tier round dais.
    dais.add(cyl(2.6, 0.3, daisMat, 0, 0.15, 0, false));
    dais.add(cyl(2.0, 0.3, daisMat, 0, 0.45, 0, false));
    dais.add(cyl(2.05, 0.08, daisTrimMat, 0, 0.6, 0, false));
    // A glowing rim light around the lower tier.
    const rimMat = new THREE.MeshStandardMaterial({ color: "#0c2030", emissive: "#36c4ff", emissiveIntensity: 0.8, roughness: 0.4 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.06, 8, 40), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.32;
    dais.add(rim);
    strips.push({ mat: rimMat, base: 0.7, amp: 0.3, rate: 1.0, phase: 0.4 });
    // Access steps at the aft side (-Z).
    dais.add(box(1.6, 0.15, 0.5, daisMat, 0, 0.075, -2.5, false));
    dais.add(box(1.6, 0.15, 0.5, daisMat, 0, 0.225, -2.9, false));

    // CHAIR on the dais (seat top ~ y=0.6+1.05), facing +Z.
    const chair = new THREE.Group();
    chair.position.set(0, 0.6, 0);
    dais.add(chair);
    chair.add(cyl(0.45, 0.2, chairMat, 0, 0.1, 0, true));      // swivel base
    chair.add(cyl(0.12, 0.5, chairMat, 0, 0.45, 0, false));    // post
    chair.add(box(1.1, 0.25, 1.1, chairMat, 0, 0.78, 0, true)); // seat pan
    chair.add(box(1.0, 0.16, 1.0, chairCushMat, 0, 0.93, 0, false)); // cushion
    chair.add(box(1.1, 1.4, 0.22, chairMat, 0, 1.6, -0.55, true));   // backrest
    chair.add(box(0.95, 1.2, 0.14, chairCushMat, 0, 1.55, -0.46, false));
    chair.add(box(0.9, 0.3, 0.2, chairMat, 0, 2.5, -0.5, false));    // headrest
    // Armrests, each capped by a small glowing control pad (a mini screen).
    for (const sx of [-1, 1]) {
      chair.add(box(0.18, 0.5, 1.0, chairMat, sx * 0.62, 1.1, 0.05, false)); // arm support
      chair.add(box(0.34, 0.12, 0.9, chairMat, sx * 0.62, 1.36, 0.05, false)); // armrest top
      const padMat = new THREE.MeshStandardMaterial({ color: "#0a1f14", emissive: "#43ffa0", emissiveIntensity: 0.8, roughness: 0.4 });
      chair.add(box(0.3, 0.04, 0.5, padMat, sx * 0.62, 1.44, 0.2, false));
      screens.push({ mat: padMat, base: 0.6, amp: 0.4, rate: 2.0 + Math.random(), phase: Math.random() * 6.28 });
    }

    // HANDRAIL ringing the dais (posts + a torus top rail).
    const railMat = new THREE.MeshStandardMaterial({ color: "#d8a23a", roughness: 0.4, metalness: 0.6, emissive: "#3a2a00", emissiveIntensity: 0.25 });
    const railRing = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.05, 8, 40), railMat);
    railRing.rotation.x = Math.PI / 2;
    railRing.position.y = 1.05;
    dais.add(railRing);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      // Skip the two posts over the aft steps so the entrance reads open.
      if (a > Math.PI * 1.35 && a < Math.PI * 1.65) continue;
      const px = Math.cos(a) * 2.5, pz = Math.sin(a) * 2.5;
      dais.add(cyl(0.04, 1.05, railMat, px, 0.55, pz, false));
    }

    // Dais is a solid collider; rounded footprint approximated by a tight square.
    pushCollider(dx, dz, 5.0, 5.0);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 7) HOLOGRAPHIC STAR-MAP TABLE — a pedestal projecting a rotating 3D star map
  //    (a planet, orbital rings, drifting star points) inside a soft light cone.
  // ════════════════════════════════════════════════════════════════════════════
  const holo = { pivot: null, ringA: null, ringB: null };
  {
    const hx = 0, hz = 2;
    // Pedestal table + emitter lens.
    group.add(cyl(1.4, 0.2, consoleMat, hx, 0.1, hz, true));
    group.add(cyl(0.7, 0.9, consoleMat, hx, 0.55, hz, true));
    group.add(cyl(1.5, 0.12, consoleTopMat, hx, 1.05, hz, false));
    const emitterMat = new THREE.MeshStandardMaterial({ color: "#0a2436", emissive: "#36d0ff", emissiveIntensity: 1.0, roughness: 0.3 });
    group.add(cyl(1.1, 0.06, emitterMat, hx, 1.13, hz, false));
    holoMats.push({ mat: emitterMat, base: 0.9, amp: 0.3, rate: 1.4, phase: 0 });
    pushCollider(hx, hz, 3.4, 3.4);

    // Soft projection light cone (open truncated cone, additive, no shadows).
    const coneMat = new THREE.MeshBasicMaterial({ color: "#37d6ff", transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 0.9, 2.4, 24, 1, true), coneMat);
    cone.position.set(hx, 2.4, hz);
    group.add(cone);

    // The rotating hologram itself.
    const pivot = new THREE.Group();
    pivot.position.set(hx, 2.55, hz);
    group.add(pivot);
    holo.pivot = pivot;

    const planetMat = new THREE.MeshStandardMaterial({ color: "#0e3a52", emissive: "#3fd8ff", emissiveIntensity: 0.7, transparent: true, opacity: 0.85, roughness: 0.3, flatShading: true });
    pivot.add(sph(0.6, planetMat, 0, 0, 0, false));
    holoMats.push({ mat: planetMat, base: 0.6, amp: 0.35, rate: 1.8, phase: 1.0 });

    // Two counter-rotating orbital rings carrying little glowing markers.
    const ringMatA = new THREE.MeshStandardMaterial({ color: "#0c2a3a", emissive: "#5ad6ff", emissiveIntensity: 0.8, transparent: true, opacity: 0.8, roughness: 0.4 });
    const ringMatB = new THREE.MeshStandardMaterial({ color: "#0c2a3a", emissive: "#ffd24a", emissiveIntensity: 0.8, transparent: true, opacity: 0.8, roughness: 0.4 });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.02, 8, 48), ringMatA);
    ringA.rotation.x = Math.PI / 2.4;
    pivot.add(ringA); holo.ringA = ringA;
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.02, 8, 48), ringMatB);
    ringB.rotation.x = Math.PI / 1.8; ringB.rotation.z = 0.5;
    pivot.add(ringB); holo.ringB = ringB;
    holoMats.push({ mat: ringMatA, base: 0.7, amp: 0.3, rate: 2.2, phase: 0.5 });
    holoMats.push({ mat: ringMatB, base: 0.7, amp: 0.3, rate: 2.6, phase: 2.0 });
    for (const [r, ring] of [[1.05, ringA], [1.35, ringB]]) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ring.add(sph(0.05, ringMatA, Math.cos(a) * r, 0, Math.sin(a) * r, false));
      }
    }
    // A field of drifting star-points around the planet (one Points cloud).
    const SN = 90;
    const sp = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) {
      const u = Math.random() * 2 - 1, az = Math.random() * Math.PI * 2, rr = 0.8 + Math.random() * 0.9;
      const sxy = Math.sqrt(1 - u * u);
      sp[i * 3] = sxy * Math.cos(az) * rr;
      sp[i * 3 + 1] = u * rr * 0.7;
      sp[i * 3 + 2] = sxy * Math.sin(az) * rr;
    }
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    const spMat = new THREE.PointsMaterial({ color: "#bdecff", size: 0.05, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    pivot.add(new THREE.Points(spGeo, spMat));
  }

  // ════════════════════════════════════════════════════════════════════════════
  // update(dt) — ALLOCATION-FREE. Cached refs only.
  // ════════════════════════════════════════════════════════════════════════════
  let t = 0;
  function update(dt) {
    t += dt;
    // Console / panel emissive pulses.
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      s.mat.emissiveIntensity = s.base + Math.sin(t * s.rate + s.phase) * s.amp;
    }
    // Scrolling data textures (mutate offset.y in place; wrap implicitly).
    for (let i = 0; i < scrollers.length; i++) {
      scrollers[i].tex.offset.y = (scrollers[i].tex.offset.y - scrollers[i].speed * dt) % 1;
    }
    // Blinking status LEDs (sharp on/off).
    for (let i = 0; i < statusLights.length; i++) {
      const b = statusLights[i];
      b.mat.emissiveIntensity = Math.sin(t * b.rate + b.phase) > 0.4 ? b.onI : b.offI;
    }
    // Floor / ceiling / rim light strips (travelling pulse).
    for (let i = 0; i < strips.length; i++) {
      const s = strips[i];
      s.mat.emissiveIntensity = s.base + Math.sin(t * s.rate + s.phase) * s.amp;
    }
    // Hologram shimmer + rotation.
    for (let i = 0; i < holoMats.length; i++) {
      const h = holoMats[i];
      h.mat.emissiveIntensity = h.base + Math.sin(t * h.rate + h.phase) * h.amp;
    }
    if (holo.pivot) {
      holo.pivot.rotation.y += dt * 0.4;
      holo.pivot.position.y = 2.55 + Math.sin(t * 0.9) * 0.04;
      if (holo.ringA) holo.ringA.rotation.z += dt * 0.6;
      if (holo.ringB) holo.ringB.rotation.z -= dt * 0.45;
    }
    // Viewscreen: spin the Earth, twinkle the stars.
    if (viewscreen.earth) viewscreen.earth.rotation.y += dt * 0.06;
    if (viewscreen.starMat) viewscreen.starMat.opacity = 0.78 + Math.sin(t * 1.5) * 0.16;
  }

  return { group, update, ground, colliders };
}
