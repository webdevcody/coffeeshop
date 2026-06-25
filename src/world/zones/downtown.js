// DOWNTOWN TOWERS — one 60×60 m district tile for the expanded city.
//
// A dense corporate block: 4 tall glass skyscrapers (up to ~40 m) ringing a
// central plaza, plus 4 secondary mid-rise blocks at the outer quadrant corners
// — every building a SOLID 3D volume (min 7×7 m footprint, no flat facades) —
// with emissive window-grid facades, two huge wall billboards mounted high on
// building sides, and wide (11 m) avenues kept fully clear so a car can drive
// straight through the cross from any edge.
//
// buildDowntown() returns { group, colliders, ground, update }:
//   group     — THREE.Group of all meshes, LOCAL coords centered on origin.
//   colliders — AABBs { minX,maxX,minZ,maxZ } for solid footprints (towers, walls).
//   ground    — [{ minX:-30,maxX:30,minZ:-30,maxZ:30 }] full-tile walkable floor.
//   update(dt)— flickers neon window facades + spins a rooftop beacon sign.
//
// Coordinates: ground is the XZ plane at y=0, up is +Y, right-handed world.
// X ∈ [-30,30], Z ∈ [-30,30].

import * as THREE from "three";
import { artPanel, artMaterial } from "../cityArt.js";

// --- Shared geometry + materials (created ONCE, reused across props) --------
const boxGeo = new THREE.BoxGeometry(1, 1, 1); // unit box, scaled per use
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12); // unit cylinder, scaled per use
const planeGeo = new THREE.PlaneGeometry(1, 1); // unit plane, scaled per use

const pavementMat = new THREE.MeshStandardMaterial({ color: "#33343c", roughness: 0.96 });
const curbMat = new THREE.MeshStandardMaterial({ color: "#5a5b63", roughness: 0.9 });
const laneMat = new THREE.MeshStandardMaterial({ color: "#d8c96a", roughness: 0.7 });
const plazaMat = new THREE.MeshStandardMaterial({ color: "#6d6e76", roughness: 0.95 });

// Glass tower body materials — a few corporate tints, reused across towers.
const glassA = new THREE.MeshStandardMaterial({ color: "#2c4a63", roughness: 0.25, metalness: 0.55 });
const glassB = new THREE.MeshStandardMaterial({ color: "#244a4a", roughness: 0.25, metalness: 0.55 });
const glassC = new THREE.MeshStandardMaterial({ color: "#3a3f55", roughness: 0.25, metalness: 0.55 });
const concreteMat = new THREE.MeshStandardMaterial({ color: "#42434b", roughness: 0.9 });
const crownMat = new THREE.MeshStandardMaterial({ color: "#1d1f28", roughness: 0.6, metalness: 0.4 });
const antennaMat = new THREE.MeshStandardMaterial({ color: "#15161d", roughness: 0.5, metalness: 0.7 });
const beaconMat = new THREE.MeshStandardMaterial({
  color: "#ff5a4a", emissive: "#ff3322", emissiveIntensity: 1.0, roughness: 0.4,
});

// --- Extra shared detail materials (architectural enrichment) ---------------
// Pale anodized-aluminium mullions: the instanced spandrel grid on every face.
const mullionMat = new THREE.MeshStandardMaterial({ color: "#aeb6c2", roughness: 0.5, metalness: 0.6, flatShading: true });
// Brushed-steel vertical accent fins running up the corners.
const finMat = new THREE.MeshStandardMaterial({ color: "#8b94a3", roughness: 0.4, metalness: 0.75, flatShading: true });
// Bright clear glass for ground-floor lobbies (slightly emissive so they glow).
const lobbyGlassMat = new THREE.MeshStandardMaterial({
  color: "#bfe8ff", roughness: 0.12, metalness: 0.3,
  emissive: "#9fd8ff", emissiveIntensity: 0.45, transparent: true, opacity: 0.78,
});
// Dark lobby interior backing (so glass reads as a room, not the sky).
const lobbyBackMat = new THREE.MeshStandardMaterial({ color: "#1a2230", roughness: 0.85, emissive: "#1d2a3a", emissiveIntensity: 0.25 });
// Polished stone canopy / cornice trim.
const trimMat = new THREE.MeshStandardMaterial({ color: "#cdd2da", roughness: 0.55, metalness: 0.25, flatShading: true });
// Revolving-door brass frame.
const doorMat = new THREE.MeshStandardMaterial({ color: "#caa64f", roughness: 0.35, metalness: 0.8, flatShading: true });
// Rooftop clutter: dull galvanised metal for tanks / AC / vents / rails.
const metalMat = new THREE.MeshStandardMaterial({ color: "#6b6f78", roughness: 0.7, metalness: 0.5, flatShading: true });
const tankMat = new THREE.MeshStandardMaterial({ color: "#7d6f5e", roughness: 0.85, metalness: 0.15, flatShading: true });
// Helipad paint (white "H" + ring) — emissive so it reads from below at night.
const helipadMat = new THREE.MeshStandardMaterial({ color: "#222530", roughness: 0.9 });
const helipadPaintMat = new THREE.MeshStandardMaterial({ color: "#f2f4f8", emissive: "#cfe2ff", emissiveIntensity: 0.3, roughness: 0.6 });
// Street furniture.
const planterMat = new THREE.MeshStandardMaterial({ color: "#4a4c54", roughness: 0.92, flatShading: true });
const foliageMat = new THREE.MeshStandardMaterial({ color: "#33623f", roughness: 0.95, flatShading: true });
const bollardMat = new THREE.MeshStandardMaterial({ color: "#2a2c34", roughness: 0.6, metalness: 0.4, flatShading: true });
const benchMat = new THREE.MeshStandardMaterial({ color: "#5b4632", roughness: 0.85, flatShading: true });
// Lit canopy underside / accent strip — warm emissive, animated by update().
const accentLitMat = new THREE.MeshStandardMaterial({ color: "#ffdfa0", emissive: "#ffcf6f", emissiveIntensity: 0.8, roughness: 0.5 });

// Window-grid facade: an emissive CanvasTexture of lit windows, reused for all
// tower faces (we tile it per-face via texture.repeat clones below).
function makeWindowTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0b1622";
  ctx.fillRect(0, 0, 128, 128);
  const lit = ["#ffe7a8", "#ffd271", "#bfe6ff", "#9fd0ff", "#fff4cf"];
  for (let y = 8; y < 128; y += 16) {
    for (let x = 8; x < 128; x += 16) {
      ctx.fillStyle = Math.random() > 0.42 ? lit[(Math.random() * lit.length) | 0] : "#16263a";
      ctx.fillRect(x, y, 9, 10);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const windowTex = makeWindowTexture();

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// Scaled cylinder from the shared unit-cylinder geometry (radius 1, height 1).
function cyl(r, h, mat, cast = true) {
  const m = new THREE.Mesh(cylGeo, mat);
  m.scale.set(r, h, r);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// Spandrel mullion grid for ONE tower face, built as a single InstancedMesh:
// thin horizontal + vertical bars laid over the glass to read as a window grid.
// Returns one mesh positioned/rotated to hug the face (callers add it to the
// tower group). Reuses the shared boxGeo + mullionMat — zero new geometry/mats.
const _mtx = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
function makeMullionGrid(fw, fh, px, py, pz, ry) {
  const colStep = 1.7;            // ~window module width
  const rowStep = 2.6;            // ~floor height
  const cols = Math.max(2, Math.round(fw / colStep) + 1);
  const rows = Math.max(2, Math.round(fh / rowStep) + 1);
  const bar = 0.12;               // mullion thickness
  const total = cols + rows;      // verticals + horizontals
  const im = new THREE.InstancedMesh(boxGeo, mullionMat, total);
  im.castShadow = false;
  im.receiveShadow = false;
  _q.identity();
  let i = 0;
  // Vertical mullions across the width.
  for (let c = 0; c < cols; c++) {
    const x = -fw / 2 + (c / (cols - 1)) * fw;
    _v.set(x, 0, 0.02);
    _s.set(bar, fh, bar);
    _mtx.compose(_v, _q, _s);
    im.setMatrixAt(i++, _mtx);
  }
  // Horizontal spandrel rails up the height.
  for (let r = 0; r < rows; r++) {
    const y = -fh / 2 + (r / (rows - 1)) * fh;
    _v.set(0, y, 0.02);
    _s.set(fw, bar, bar);
    _mtx.compose(_v, _q, _s);
    im.setMatrixAt(i++, _mtx);
  }
  im.instanceMatrix.needsUpdate = true;
  // Orient the whole grid to the face plane.
  im.position.set(px, py, pz);
  im.rotation.y = ry;
  return im;
}

// A skyscraper: glass shaft with emissive window grid on all 4 sides, a dark
// crown, and (optionally) a rooftop antenna. Footprint w×d, height h.
// Window faces are tracked so update() can flicker their emissiveIntensity.
//
// ENRICHED with: instanced spandrel mullion grids over every face, stepped
// setback tiers near the top, a glass ground-floor lobby with stone canopy and
// brass revolving-door front, vertical accent fins up the corners, a cornice
// trim band, and rooftop clutter (water tank, AC units, parapet rail, vents,
// plus a helipad on the tallest). flickerList = window mats, litList = lobby /
// canopy accent mats animated by update().
function makeTower(w, h, d, glassMat, flickerList, antenna, litList, opts = {}) {
  const g = new THREE.Group();

  // Solid shaft (gives the silhouette + receives shadow).
  const shaft = box(w, h, d, glassMat);
  shaft.position.y = h / 2;
  g.add(shaft);

  // Emissive window-grid skin: 4 thin planes hugging each face. Each gets its
  // own cloned material so we can flicker brightness independently per tower.
  const faceMat = new THREE.MeshStandardMaterial({
    map: windowTex.clone(),
    emissive: "#fff0c0",
    emissiveMap: windowTex,
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0.2,
    // Single-sided PlaneGeometry vanishes edge-on / from behind, rendering the
    // window-grid skin as a 1px sliver at steep angles. DoubleSide keeps the
    // facade reading as a real surface from every approach.
    side: THREE.DoubleSide,
  });
  faceMat.map.needsUpdate = true;
  const repX = Math.max(1, Math.round(w / 2));
  const repY = Math.max(2, Math.round(h / 3));
  faceMat.map.repeat.set(repX, repY);
  faceMat.emissiveMap = faceMat.map;
  flickerList.push(faceMat);

  const lobbyH = 4.2; // ground-floor lobby band height (glass starts above it)
  const faces = [
    [0, h / 2, d / 2 + 0.02, 0, w, h],            // +Z
    [0, h / 2, -d / 2 - 0.02, Math.PI, w, h],     // -Z
    [w / 2 + 0.02, h / 2, 0, Math.PI / 2, d, h],  // +X
    [-w / 2 - 0.02, h / 2, 0, -Math.PI / 2, d, h],// -X
  ];
  for (const [px, py, pz, ry, fw, fh] of faces) {
    const f = new THREE.Mesh(planeGeo, faceMat);
    f.scale.set(fw, fh, 1);
    f.position.set(px, py, pz);
    f.rotation.y = ry;
    g.add(f);
    // Instanced spandrel mullion grid hugging this face (window-grid relief).
    // The grid's local +Z (0.02 offset baked into makeMullionGrid) is rotated
    // by ry to sit just proud of the same face plane as the window texture.
    g.add(makeMullionGrid(fw, fh, px, py, pz, ry));
  }

  // Vertical accent fins up each corner (brushed steel pilasters).
  const finH = h - lobbyH;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const fin = box(0.45, finH, 0.45, finMat);
    fin.position.set(sx * (w / 2 + 0.05), lobbyH + finH / 2, sz * (d / 2 + 0.05));
    g.add(fin);
  }

  // Cornice / trim band wrapping the shaft just below the crown.
  const cornice = box(w + 0.5, 0.8, d + 0.5, trimMat);
  cornice.position.y = h - 0.4;
  g.add(cornice);

  // --- Stepped setback tiers near the top (Art-Deco massing) ----------------
  const tiers = [
    [w * 0.82, 2.6, d * 0.82],
    [w * 0.6, 2.2, d * 0.6],
    [w * 0.4, 1.8, d * 0.4],
  ];
  let tierY = h + 1.4; // sits above the crown cap (added below)
  // Dark crown / mechanical cap.
  const crown = box(w * 0.96, 1.4, d * 0.96, crownMat);
  crown.position.y = h + 0.7;
  g.add(crown);
  for (const [tw, th, td] of tiers) {
    const tier = box(tw, th, td, crownMat);
    tier.position.y = tierY + th / 2;
    g.add(tier);
    // thin lit rim on each tier for a "lit crown" glow (shares accentLitMat,
    // which buildDowntown pulses once via litList — no per-rim tracking).
    const rim = box(tw + 0.18, 0.18, td + 0.18, accentLitMat);
    rim.position.y = tierY + th - 0.09;
    g.add(rim);
    tierY += th;
  }
  const topY = tierY; // flat usable rooftop of the stack (above tiers)

  // --- Ground-floor glass lobby + canopy + revolving-door front -------------
  // The whole entrance assembly is built once along the LOCAL +Z face, then the
  // sub-group is rotated so its detailed storefront faces the real street: a
  // tower beside the N-S avenue wants its front on ±X (use opts.frontX), one
  // beside the E-W avenue wants ±Z (use opts.frontZ). Exactly one is chosen.
  // This guarantees the lobby/canopy/door never point at an interior/back face.
  const entranceG = new THREE.Group();
  // entranceYaw maps the assembly's local +Z to the requested world direction.
  // +Z→0, -Z→π, +X→π/2, -X→-π/2.   fz/fd = facade width / building depth seen
  // by the entrance (so an X-facing front uses w as its outward depth, d as width).
  let entranceYaw = 0;
  let fw = w, fd = d; // facade width, building depth in the entrance's local frame
  if (opts.frontX !== undefined) {
    entranceYaw = opts.frontX >= 0 ? Math.PI / 2 : -Math.PI / 2;
    fw = d; fd = w; // facing along X: the visible facade spans the depth (d)
  } else {
    const fz = opts.frontZ ?? 1; // +1 → toward +Z, -1 → toward -Z
    entranceYaw = fz >= 0 ? 0 : Math.PI;
  }
  // Concrete plinth/sill the lobby glazing sits on (shared base, not rotated).
  const plinth = box(w + 0.3, 0.6, d + 0.3, concreteMat);
  plinth.position.y = 0.3;
  g.add(plinth);
  // Lobby glazing on the front face (bright, slightly transparent).
  const lobbyGlass = box(fw * 0.92, lobbyH, 0.12, lobbyGlassMat, false);
  lobbyGlass.position.set(0, lobbyH / 2, fd / 2 + 0.08);
  entranceG.add(lobbyGlass);
  // Dark interior backing behind the glass.
  const lobbyBack = box(fw * 0.9, lobbyH - 0.3, 0.1, lobbyBackMat, false);
  lobbyBack.position.set(0, lobbyH / 2, fd / 2 - 0.2);
  entranceG.add(lobbyBack);
  // Side returns so the lobby reads as wrapping the corner a little.
  for (const sx of [-1, 1]) {
    const sideGlass = box(0.12, lobbyH, fw * 0.5, lobbyGlassMat, false);
    sideGlass.position.set(sx * (fw / 2 + 0.06), lobbyH / 2, fd * 0.2);
    entranceG.add(sideGlass);
  }
  // Stone entrance canopy projecting over the door.
  const canopy = box(fw * 0.5, 0.45, 2.4, trimMat);
  canopy.position.set(0, lobbyH - 0.4, fd / 2 + 1.1);
  entranceG.add(canopy);
  // Lit canopy underside strip.
  const canopyLit = box(fw * 0.46, 0.1, 2.0, accentLitMat, false);
  canopyLit.position.set(0, lobbyH - 0.66, fd / 2 + 1.1);
  entranceG.add(canopyLit);
  // Two canopy support posts.
  for (const sx of [-1, 1]) {
    const post = cyl(0.12, 2.2, doorMat);
    post.position.set(sx * fw * 0.22, 1.1, fd / 2 + 2.1);
    entranceG.add(post);
  }
  // Brass revolving-door drum at the entrance.
  const drum = cyl(1.05, 2.6, lobbyGlassMat, false);
  drum.position.set(0, 1.3, fd / 2 + 0.6);
  entranceG.add(drum);
  const drumFrame = cyl(1.12, 0.18, doorMat, false);
  drumFrame.position.set(0, 2.55, fd / 2 + 0.6);
  entranceG.add(drumFrame);
  // Door wings (cross of 4 panels) inside the drum.
  for (let k = 0; k < 4; k++) {
    const wing = box(1.9, 2.4, 0.06, doorMat, false);
    wing.position.set(0, 1.3, fd / 2 + 0.6);
    wing.rotation.y = k * (Math.PI / 2);
    entranceG.add(wing);
  }
  entranceG.rotation.y = entranceYaw;
  g.add(entranceG);

  // --- Rooftop clutter on the flat stack top --------------------------------
  // Parapet rail around the topmost tier.
  const railTW = tiers[tiers.length - 1][0];
  const railTD = tiers[tiers.length - 1][2];
  const rail = box(railTW + 0.1, 0.5, railTD + 0.1, metalMat, false);
  // hollow look: a thin ring frame just above the top tier
  rail.position.y = topY + 0.25;
  g.add(rail);
  // Cylindrical water tank on stilts.
  const tank = cyl(Math.min(1.6, w * 0.22), 2.4, tankMat);
  tank.position.set(railTW * 0.18, topY + 1.4, -railTD * 0.18);
  g.add(tank);
  const tankCap = new THREE.Mesh(new THREE.ConeGeometry(Math.min(1.7, w * 0.24), 0.8, 12), tankMat);
  tankCap.position.set(railTW * 0.18, topY + 3.0, -railTD * 0.18);
  tankCap.castShadow = true;
  g.add(tankCap);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = box(0.12, 0.5, 0.12, metalMat, false);
    leg.position.set(railTW * 0.18 + lx * 0.9, topY + 0.25, -railTD * 0.18 + lz * 0.9);
    g.add(leg);
  }
  // A couple of AC/condenser units.
  for (const [ux, uz] of [[-railTW * 0.22, railTD * 0.16], [railTW * 0.05, railTD * 0.26]]) {
    const ac = box(1.3, 0.8, 1.0, metalMat);
    ac.position.set(ux, topY + 0.4, uz);
    g.add(ac);
    const grille = box(1.0, 0.55, 0.05, crownMat, false);
    grille.position.set(ux, topY + 0.4, uz + 0.52);
    g.add(grille);
  }
  // Vent pipes.
  for (const [vx, vz, vh] of [[-railTW * 0.05, -railTD * 0.05, 1.2], [railTW * 0.2, railTD * 0.05, 0.9]]) {
    const pipe = cyl(0.13, vh, metalMat);
    pipe.position.set(vx, topY + vh / 2, vz);
    g.add(pipe);
  }

  // Helipad markings on the flagship roof.
  if (opts.helipad) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(Math.min(railTW, railTD) * 0.4, 24), helipadMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = topY + 0.55;
    g.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.min(railTW, railTD) * 0.3, Math.min(railTW, railTD) * 0.36, 24), helipadPaintMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = topY + 0.56;
    g.add(ring);
    // Painted "H" (three bars).
    const hScale = Math.min(railTW, railTD) * 0.12;
    for (const [hx, hw, hd] of [[-hScale, hScale * 0.4, hScale * 2], [hScale, hScale * 0.4, hScale * 2], [0, hScale * 1.6, hScale * 0.4]]) {
      const bar = box(hw, 0.04, hd, helipadPaintMat, false);
      bar.position.set(hx, topY + 0.57, 0);
      g.add(bar);
    }
  }

  if (antenna) {
    const mast = cyl(0.16, 5, antennaMat);
    mast.position.y = topY + 2.5;
    mast.castShadow = true;
    g.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), beaconMat);
    beacon.position.y = topY + 5;
    g.add(beacon);
    // Guy-wire-ish cross struts near the antenna base.
    for (const ax of [-1, 1]) {
      const strut = cyl(0.06, 2.2, antennaMat, false);
      strut.position.set(ax * 0.6, topY + 1.0, 0);
      strut.rotation.z = ax * 0.5;
      g.add(strut);
    }
  }
  return g;
}

export function buildDowntown() {
  const group = new THREE.Group();
  const colliders = [];
  const flickerList = []; // facade materials to flicker
  const spinners = [];    // rooftop signs to rotate

  // --- Ground slab: pavement covering the tile (top flush at y=0). ----------
  const slab = box(60, 0.6, 60, pavementMat, false);
  slab.position.y = -0.3;
  slab.receiveShadow = true;
  group.add(slab);

  // Plaza pads under the tower clusters (reads as a corporate forecourt).
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), plazaMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.02;
  plaza.receiveShadow = true;
  group.add(plaza);

  // Avenue lane paint: one wide N-S avenue (x≈0) + one wide E-W avenue (z≈0),
  // both >= 10m clear so a car drives straight through the cross.
  const aveMat = pavementMat;
  const aveNS = new THREE.Mesh(new THREE.PlaneGeometry(11, 60), aveMat);
  aveNS.rotation.x = -Math.PI / 2;
  aveNS.position.set(0, 0.03, 0);
  aveNS.receiveShadow = true;
  group.add(aveNS);
  const aveEW = new THREE.Mesh(new THREE.PlaneGeometry(60, 11), aveMat);
  aveEW.rotation.x = -Math.PI / 2;
  aveEW.position.set(0, 0.031, 0);
  aveEW.receiveShadow = true;
  group.add(aveEW);
  // Dashed centre lines down both avenues (shared geometries, reused). Kept
  // within ±21 (dash half-length 1.1 → reaches ±22.1) so even the lane paint
  // stays inside the ±23 setback and never bleeds onto a tile-seam road.
  const dashNSGeo = new THREE.PlaneGeometry(0.4, 2.2);
  const dashEWGeo = new THREE.PlaneGeometry(2.2, 0.4);
  for (let s = -21; s <= 21; s += 7) {
    const dN = new THREE.Mesh(dashNSGeo, laneMat);
    dN.rotation.x = -Math.PI / 2;
    dN.position.set(0, 0.05, s);
    group.add(dN);
    const dE = new THREE.Mesh(dashEWGeo, laneMat);
    dE.rotation.x = -Math.PI / 2;
    dE.position.set(s, 0.051, 0);
    group.add(dE);
  }

  // --- Buildings — full 3D volumes, one per quadrant, all off the avenues. ---
  // Every building below is a SOLID box shaft (real width AND depth AND height),
  // never a flat facade: the smallest footprint here is 7×7 m, the towers 10×10 m.
  //
  // ROAD-GRID SETBACK: a 12 m road runs on every tile seam (avenues at world
  // X=-60,0,60 and cross-streets at world Z=35,95,155,215), so the outer ~6 m of
  // each tile edge plus a kerb+sidewalk is street, NOT plot. EVERY footprint here
  // (and its collider) is therefore kept inside LOCAL X,Z ∈ [-23, 23] — a ~7 m
  // setback from each of the 4 tile edges — so no building sits in the road.
  // The composition was re-centred toward the plaza to honour that. The corner
  // pocket between an avenue and a tile edge is small, so each quadrant holds a
  // tall flagship near the plaza plus a mid-rise block in the outer corner, and
  // both had to be sized to nest within the setback without overlapping:
  //   • the four flagship towers were pulled in from ±15.5 to ±10.5 and trimmed
  //     to 9×9 (still 30–40 m tall — very substantial volumes), so each footprint
  //     reaches only ±15 (collider ±15.2) and the inner face clears the avenue
  //     band (inner face at ±6, lanes at |coord|<5.5).
  //   • the four secondary blocks — which used to STRADDLE the tile edge at ±26
  //     (footprint reaching ±29.5, deep in the street) — were pulled into the
  //     outer corners at ±19.2 (footprint ±22.7, collider ±22.9), just inside the
  //     ±23 setback and clear of the flagship colliders (~0.3 m gap).
  //
  // [cx, cz, w, d, height, glassMat, antenna, helipad, frontZ]
  // frontZ chooses which Z face carries the lobby/canopy/door so the detailed
  // FRONT always faces the central avenue cross (the street), never a back lot.
  const towers = [
    // Four flagship corner towers (tall glass, ringing the plaza), at ±10.5 / 9×9
    // → footprint ±15, collider ±15.2, inside the ±23 setback and off the avenues.
    [-10.5, -10.5, 9, 9, 40, glassA, true,  true,   1], // NW flagship (beacon + helipad)
    [ 10.5, -10.5, 9, 9, 33, glassB, false, false,  1], // NE
    [-10.5,  10.5, 9, 9, 30, glassC, true,  false, -1], // SW (beacon)
    [ 10.5,  10.5, 9, 9, 36, glassA, false, true,  -1], // SE (helipad)
    // Four secondary mid-rise blocks at the OUTER corner of each quadrant. Full
    // volumes (7×7 footprint) so they read solid from every side, pulled in to
    // ±19.2 → footprint reaches ±22.7, collider ±22.9, just inside the ±23
    // setback and clear of the corner towers + both avenues.
    [-19.2, -19.2, 7, 7, 20, glassB, false, false,  1], // NW outer block
    [ 19.2, -19.2, 7, 7, 18, glassC, false, false,  1], // NE outer block
    [-19.2,  19.2, 7, 7, 22, glassA, false, false, -1], // SW outer block
    [ 19.2,  19.2, 7, 7, 19, glassB, false, false, -1], // SE outer block
  ];
  const litList = []; // lobby/canopy accent mats animated by update (shared mat)
  litList.push(accentLitMat, lobbyGlassMat); // pulse the shared lit accents once
  // The lobby/canopy is a thin overhead element ~3.8 m up that projects off the
  // chosen front face toward the tile centre; with the towers set in to ±10.5 it
  // overhangs the outer edge of the wide (11 m) central avenue but leaves the
  // drivable centre lane (|x|,|z| ≲ 2) fully clear, and never touches a seam road.
  for (const [cx, cz, w, d, h, gm, ant, heli, frontZ] of towers) {
    const t = makeTower(w, h, d, gm, flickerList, ant, litList, { frontZ, helipad: heli });
    t.position.set(cx, 0, cz);
    group.add(t);
    addCollider(colliders, cx, cz, w + 0.4, d + 0.4);
  }

  // --- Two HUGE wall billboards mounted high on tower sides. ----------------
  // Each billboard's lit FRONT faces an avenue; it is offset just proud of the
  // host face so it never sinks into (or floats off) the building.
  // Billboard 1: "SKYLINE TOWERS" on the SE tower's -X face, facing the NS ave.
  // SE tower is cx10.5,cz10.5,w9 → -X face at x=10.5-4.5=6.0.
  const bb1 = artPanel(8, 6.5, "billboard", {
    title: "SKYLINE TOWERS", sub: "LIVE ABOVE THE CITY",
    a: "#16335f", b: "#0a1428", accent: "#ffcf3f", glyph: "▲",
    emissiveIntensity: 0.5, file: "billboard-skyline.png",
  });
  bb1.position.set(5.9, 24, 10.5);     // just proud of the SE tower -X face
  bb1.rotation.y = -Math.PI / 2;        // normal faces -X toward the NS avenue
  group.add(bb1);

  // Billboard 2: "FIZZ POP COLA" on the NW flagship's +Z face, facing EW ave.
  // NW tower is cx-10.5,cz-10.5,d9 → +Z face at z=-10.5+4.5=-6.0.
  const bb2 = artPanel(8, 7, "billboard", {
    title: "FIZZ POP COLA", sub: "ICE-COLD & FIZZY",
    a: "#6b1130", b: "#1a0410", accent: "#ff5fa0", glyph: "✦",
    emissiveIntensity: 0.5, file: "billboard-cola.png",
  });
  bb2.position.set(-10.5, 27, -5.9);   // just proud of the NW tower +Z face
  group.add(bb2);                       // PlaneGeometry default normal +Z (toward EW ave)

  // --- A rooftop rotating beacon sign (neon) on the SE tower. ---------------
  const rooftopSign = artPanel(4.5, 4.5, "neon", {
    lines: ["DT", "TOWER"], color: "#4fd2ff", color2: "#ff4fa3",
    emissiveIntensity: 0.9, file: "neon-dt.png",
  });
  // mount it above the SE tower roof (height 36 + crown stack).
  rooftopSign.position.set(10.5, 41, 10.5);
  group.add(rooftopSign);
  spinners.push(rooftopSign);

  // --- A couple of lit CROWN SIGNS near tower tops (vertical wall signs) -----
  // "NOVA" up the NE tower's -X face (cx10.5,cz-10.5,w9 → -X at x=6), high up.
  const crownSign1 = artPanel(3.2, 8, "sign", {
    text: "NOVA", bg: "#0b2c4a", fg: "#7fe0ff",
    emissive: "#1c6fb0", emissiveIntensity: 0.9, file: "sign-nova.png",
  });
  crownSign1.position.set(5.9, 24, -10.5);
  crownSign1.rotation.y = -Math.PI / 2; // normal faces -X toward NS avenue
  group.add(crownSign1);
  // "VERTEX" up the SW tower's +X face (cx-10.5,cz10.5,w9 → +X at x=-6), high up.
  const crownSign2 = artPanel(3.0, 7, "sign", {
    text: "VERTEX", bg: "#3a0b2c", fg: "#ff9fe0",
    emissive: "#b01c7f", emissiveIntensity: 0.9, file: "sign-vertex.png",
  });
  crownSign2.position.set(-5.9, 23, 10.5);
  crownSign2.rotation.y = Math.PI / 2; // normal faces +X toward NS avenue
  group.add(crownSign2);

  // --- Street dressing along the plaza edge of the avenue cross (visual) -----
  // Bollards, planters and benches set back from the lanes (no colliders, low
  // mass). Placed at ±9 m from each avenue centreline so the >6m through-lanes
  // stay fully clear.
  const planterGeo = new THREE.SphereGeometry(0.7, 8, 6); // shared shrub geo
  for (const z of [-9, 9]) {
    for (let x = -22; x <= 22; x += 11) {
      if (Math.abs(x) < 7) continue; // keep the avenue cross clear
      // bollard
      const b = cyl(0.16, 0.9, bollardMat, false);
      b.position.set(x, 0.45, z * 0.62);
      group.add(b);
    }
  }
  // Planters + shrubs along the EW plaza frontage.
  for (const [px, pz] of [[-10, 9], [10, 9], [-10, -9], [10, -9], [-22, 9], [22, -9]]) {
    const planter = box(2.0, 0.7, 1.0, planterMat);
    planter.position.set(px, 0.35, pz);
    group.add(planter);
    const shrub = new THREE.Mesh(planterGeo, foliageMat);
    shrub.scale.set(1.2, 0.9, 0.7);
    shrub.position.set(px, 0.95, pz);
    shrub.castShadow = true;
    group.add(shrub);
  }
  // A few benches flanking the plaza.
  for (const [bx, bz, br] of [[-13, 8, 0], [13, 8, 0], [-13, -8, 0], [13, -8, 0]]) {
    const seat = box(2.2, 0.18, 0.6, benchMat);
    seat.position.set(bx, 0.5, bz);
    seat.rotation.y = br;
    group.add(seat);
    const back = box(2.2, 0.5, 0.12, benchMat);
    back.position.set(bx, 0.78, bz + (bz < 0 ? -0.24 : 0.24));
    back.rotation.y = br;
    group.add(back);
    for (const lx of [-0.9, 0.9]) {
      const leg = box(0.14, 0.5, 0.5, benchMat, false);
      leg.position.set(bx + lx, 0.25, bz);
      group.add(leg);
    }
  }

  // Curb strips framing the central avenue cross (low decorative, no collider).
  for (const x of [-5.7, 5.7]) {
    const curb = box(0.3, 0.18, 60, curbMat, false);
    curb.position.set(x, 0.09, 0);
    group.add(curb);
  }

  // --- Ambient animation ----------------------------------------------------
  let t = 0;
  function update(dt) {
    t += dt;
    // Flicker each tower facade's emissive brightness on its own phase.
    for (let i = 0; i < flickerList.length; i++) {
      const m = flickerList[i];
      m.emissiveIntensity = 0.7 + 0.25 * Math.sin(t * 2.3 + i * 1.7) + (Math.random() < 0.04 ? -0.3 : 0);
    }
    // Gentle pulse on shared lit accents (canopy strips, crown rims, lobby glow).
    // litList holds the SHARED accent mats (pushed once) — no per-mesh cost.
    const lit = 0.7 + 0.18 * Math.sin(t * 1.4);
    for (let i = 0; i < litList.length; i++) litList[i].emissiveIntensity = lit;
    // Slowly rotate the rooftop neon beacon sign.
    for (const s of spinners) s.rotation.y += dt * 0.6;
  }

  // Whole tile is walkable; towers block via colliders.
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  return { group, colliders, ground, update };
}
