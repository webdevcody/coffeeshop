// SHOPPING DISTRICT — one 60×60m tile of an expanded 3D city for the cafe game.
//
// A clean commercial street. The back of the tile is a two-storey storefront ROW
// broken into individual shop BAYS — each bay has a recessed door, a big display
// window, a striped awning and a hanging artPanel "sign". Above the awnings runs
// a cornice trim band and a grid of upper-floor windows (instanced). A covered
// ARCADE walkway with a colonnade of columns runs along the shopfronts. The
// sidewalk in front is dressed with planters, benches, litter bins and bollards
// (all clear of the lanes), and a wide open asphalt street runs down the middle
// so a car can drive straight through. A bus-stop shelter and a rotating mall
// pylon sign finish the scene.
//
// buildShopping() returns { group, colliders, ground, update }:
//   group     — THREE.Group of all geometry, LOCAL coords centred on (0,0,0)
//   colliders — AABBs { minX,maxX,minZ,maxZ } for solid props (player + car block)
//   ground    — walkable rects; includes the full tile [-30,30]×[-30,30]
//   update(dt)— cheap ambient animation (flickering neon, spinning pylon sign)
//
// Layout (metres, +X east / +Z south, up +Y):
//   Storefronts:  fronts at z = -18 facing +Z, bodies run back to z = -23, with
//                 unit X-spans inside [-23, 23] — a ~7m SETBACK from every tile
//                 edge (±30) so no block clips into the seam-road grid + sidewalk.
//   Arcade:       columns at z ≈ -15.6 (covered walkway, gaps clear to walk)
//   Sidewalk:     z ∈ [-16, -8]   (planters, benches, bins, bollards, bus stop)
//   Open street:  z ∈ [-7, 14]    (>= 6m clear lane through the tile, no colliders)
//   South verge:  z ∈ [14, 23]    (a couple of planters near the corners, in setback)
//
// Performance: upper-floor windows and the arcade colonnade use THREE.InstancedMesh;
// all repeated dressing reuses a small palette of shared geometries + materials.
// No per-frame allocation in update().

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

// --- Shared materials (created ONCE, reused across every repeated prop) -------
const pavement   = new THREE.MeshStandardMaterial({ color: "#9a958b", roughness: 0.97 });
const slabSide   = new THREE.MeshStandardMaterial({ color: "#6f6a62", roughness: 1 });
const asphalt    = new THREE.MeshStandardMaterial({ color: "#34343b", roughness: 0.98 });
const paintWhite = new THREE.MeshStandardMaterial({ color: "#e7e7e0", roughness: 0.6 });
const curbMat    = new THREE.MeshStandardMaterial({ color: "#c6c1b6", roughness: 0.9 });

const wallA  = new THREE.MeshStandardMaterial({ color: "#d9cdb6", roughness: 0.9, flatShading: true });  // MALL
const wallB  = new THREE.MeshStandardMaterial({ color: "#c9d6d8", roughness: 0.9, flatShading: true });  // MART
const wallC  = new THREE.MeshStandardMaterial({ color: "#e3c9b4", roughness: 0.9, flatShading: true });  // CAFE
const roofMat = new THREE.MeshStandardMaterial({ color: "#3c3f46", roughness: 0.85 });
const trimMat = new THREE.MeshStandardMaterial({ color: "#5a5048", roughness: 0.8 });
const corniceMat = new THREE.MeshStandardMaterial({ color: "#efe7d6", roughness: 0.75 });
const stallMat = new THREE.MeshStandardMaterial({ color: "#3a3530", roughness: 0.85 });  // shop bulkhead / stall riser
const doorMat  = new THREE.MeshStandardMaterial({ color: "#2b2622", roughness: 0.55, metalness: 0.2 });
const glass  = new THREE.MeshStandardMaterial({
  color: "#9fc4d6", roughness: 0.18, metalness: 0.4,
  emissive: "#3a4d57", emissiveIntensity: 0.25,
});
const winLit = new THREE.MeshStandardMaterial({   // upper-floor window panes (warm glow)
  color: "#cdb27a", roughness: 0.35, metalness: 0.2,
  emissive: "#ffca6a", emissiveIntensity: 0.55, flatShading: true,
});

const awnRed   = new THREE.MeshStandardMaterial({ color: "#c4423b", roughness: 0.85, side: THREE.DoubleSide });
const awnTeal  = new THREE.MeshStandardMaterial({ color: "#2f8f88", roughness: 0.85, side: THREE.DoubleSide });
const awnAmber = new THREE.MeshStandardMaterial({ color: "#d79a3a", roughness: 0.85, side: THREE.DoubleSide });

const poleMat    = new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.5, metalness: 0.7 });
const metalMat   = new THREE.MeshStandardMaterial({ color: "#8c8f95", roughness: 0.6, metalness: 0.8, flatShading: true });
const planterMat = new THREE.MeshStandardMaterial({ color: "#7c5234", roughness: 0.85 });
const foliage    = new THREE.MeshStandardMaterial({ color: "#3f7d4d", roughness: 0.9, flatShading: true });
const trunkMat   = new THREE.MeshStandardMaterial({ color: "#5a3d28", roughness: 0.9 });
const shelterGlass = new THREE.MeshStandardMaterial({
  color: "#bcd6e0", roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
});
const benchWood  = new THREE.MeshStandardMaterial({ color: "#6b4326", roughness: 0.7 });
const binMat     = new THREE.MeshStandardMaterial({ color: "#3c5648", roughness: 0.7, metalness: 0.3 });
const bollardMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.6, flatShading: true });

// --- Boutique interior palette (enterable clothing shop) ---------------------
const boutiqueWall  = new THREE.MeshStandardMaterial({ color: "#e7d8c4", roughness: 0.92 });          // warm plaster
const boutiqueFloor = new THREE.MeshStandardMaterial({ color: "#9c7b56", roughness: 0.85 });          // wood-look floor
const boutiqueRoof  = new THREE.MeshStandardMaterial({ color: "#cdbba4", roughness: 0.9 });           // ceiling
const counterMat    = new THREE.MeshStandardMaterial({ color: "#5e3b25", roughness: 0.55 });          // service counter
const counterTopMat = new THREE.MeshStandardMaterial({ color: "#2e2620", roughness: 0.4, metalness: 0.2 });
const shelfMat      = new THREE.MeshStandardMaterial({ color: "#7a5638", roughness: 0.7 });           // shelving / rack frame
const rackBarMat    = new THREE.MeshStandardMaterial({ color: "#b9bcc2", roughness: 0.4, metalness: 0.8 });
const rugMat        = new THREE.MeshStandardMaterial({ color: "#9d2f3f", roughness: 0.95 });          // cozy rug
const stoolSeatMat  = new THREE.MeshStandardMaterial({ color: "#324a5e", roughness: 0.6 });           // stool cushion
const caseGlass     = new THREE.MeshStandardMaterial({
  color: "#cfe6ef", roughness: 0.12, metalness: 0.3, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
});
const lampShadeMat  = new THREE.MeshStandardMaterial({
  color: "#ffe6b0", roughness: 0.4, emissive: "#ffcf7a", emissiveIntensity: 0.7,
});

// Neutral base material for instanced garments/folds — white so per-instance
// setColorAt() colours read true (the base colour multiplies the instance tint).
const garmentMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85 });

// --- Boutique shared geometry (reused for repeats) ---------------------------
const garmentGeo = new THREE.BoxGeometry(0.18, 0.85, 0.5);   // a hanging garment slab on the rack
const foldGeo    = new THREE.BoxGeometry(0.7, 0.16, 0.45);   // a folded stack of clothes on a shelf
const stoolSeatGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12);
const stoolLegGeo  = new THREE.CylinderGeometry(0.04, 0.04, 0.55, 8);

// --- Extra enterable-shop palette (BAKERY warm + GROCER fresh) ----------------
const bakeWall   = new THREE.MeshStandardMaterial({ color: "#efe0c6", roughness: 0.92 });   // warm cream plaster
const bakeFloor  = new THREE.MeshStandardMaterial({ color: "#b8825a", roughness: 0.85 });   // terracotta-ish tile
const bakeRoof   = new THREE.MeshStandardMaterial({ color: "#d8c4a4", roughness: 0.9 });
const breadMat   = new THREE.MeshStandardMaterial({ color: "#c98b46", roughness: 0.85 });   // golden loaf
const ovenMat    = new THREE.MeshStandardMaterial({ color: "#7d4a2c", roughness: 0.7, metalness: 0.2 });
const ovenGlow   = new THREE.MeshStandardMaterial({ color: "#ff8a3a", roughness: 0.4, emissive: "#ff5a18", emissiveIntensity: 0.8 });

const grocWall   = new THREE.MeshStandardMaterial({ color: "#d6e6d2", roughness: 0.92 });   // cool mint plaster
const grocFloor  = new THREE.MeshStandardMaterial({ color: "#8f9488", roughness: 0.88 });   // grey-green lino
const grocRoof   = new THREE.MeshStandardMaterial({ color: "#bfcabb", roughness: 0.9 });
const produceMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 });    // white base, tinted per-instance
const crateMat   = new THREE.MeshStandardMaterial({ color: "#9c6b3f", roughness: 0.9 });    // wooden crate / stall riser
const fridgeMat  = new THREE.MeshStandardMaterial({ color: "#cfe3ea", roughness: 0.3, metalness: 0.4, emissive: "#7fb3c9", emissiveIntensity: 0.25 });

// --- Enterable FLORIST palette (fresh sage + terracotta) ----------------------
const florWall  = new THREE.MeshStandardMaterial({ color: "#e3ecd9", roughness: 0.92 });  // soft sage plaster
const florFloor = new THREE.MeshStandardMaterial({ color: "#8a8f86", roughness: 0.88 });  // slate tile
const florRoof  = new THREE.MeshStandardMaterial({ color: "#c5cdb9", roughness: 0.9 });
const potMat    = new THREE.MeshStandardMaterial({ color: "#b5643c", roughness: 0.85 });  // terracotta pot
const stemMat   = new THREE.MeshStandardMaterial({ color: "#3f7d4d", roughness: 0.85 });  // green shrub
const bloomMat  = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 });   // white base, tinted per-instance
const bucketMat = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.5, metalness: 0.6 }); // galvanized bucket

// --- Extra shared geometry for the new shops + street flavor ------------------
const loafGeo    = new THREE.BoxGeometry(0.5, 0.22, 0.3);    // a bread loaf on a bakery tray
const produceGeo = new THREE.IcosahedronGeometry(0.16, 0);   // a piece of fruit/veg in a grocer bin
const crateGeo   = new THREE.BoxGeometry(0.9, 0.7, 0.9);     // a stacked wooden crate
const awnPostGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8);  // market-stall corner post
const lampPoleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.4, 8);  // street-lamp pole
const lampHeadGeo = new THREE.SphereGeometry(0.28, 12, 10);        // lamp globe
const potGeo     = new THREE.CylinderGeometry(0.16, 0.12, 0.26, 10); // a terracotta plant pot
const bucketGeo  = new THREE.CylinderGeometry(0.22, 0.18, 0.5, 12);  // a flower-display bucket
const bloomGeo   = new THREE.IcosahedronGeometry(0.14, 0);          // a flower bloom cluster

// --- Shared geometry (reused) ------------------------------------------------
const blobGeo   = new THREE.IcosahedronGeometry(0.8, 0);
const planterGeo = new THREE.BoxGeometry(1.3, 0.5, 1.3);
const trunkGeo   = new THREE.CylinderGeometry(0.14, 0.18, 1.1, 8);
const benchSlatGeo = new THREE.BoxGeometry(2.0, 0.1, 0.16);
const benchLegGeo  = new THREE.BoxGeometry(0.12, 0.5, 0.5);
const binBodyGeo   = new THREE.CylinderGeometry(0.32, 0.28, 0.9, 12);
const binLidGeo    = new THREE.CylinderGeometry(0.36, 0.36, 0.12, 12);
const bollardGeo   = new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8);
const columnGeo    = new THREE.BoxGeometry(0.5, 4.0, 0.5);   // arcade colonnade post
const winPaneGeo   = new THREE.BoxGeometry(1.1, 1.5, 0.12);  // upper-floor window pane
const winFrameGeo  = new THREE.BoxGeometry(1.3, 1.7, 0.06);  // window frame (shared)
const acGeo        = new THREE.BoxGeometry(1.4, 0.7, 1.0);   // rooftop AC unit
const pipeGeo      = new THREE.CylinderGeometry(0.12, 0.12, 1.6, 8);

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// A planter box with a small flat-shaded shrub on top.
function makePlanter() {
  const g = new THREE.Group();
  const box1 = new THREE.Mesh(planterGeo, planterMat);
  box1.position.y = 0.25;
  box1.castShadow = box1.receiveShadow = true;
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.05;
  trunk.castShadow = true;
  g.add(box1, trunk);
  for (const [x, y, z, s] of [[0, 1.7, 0, 1], [0.35, 1.5, 0.1, 0.6]]) {
    const blob = new THREE.Mesh(blobGeo, foliage);
    blob.position.set(x, y, z);
    blob.scale.setScalar(s);
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

// A sidewalk bench: two slats on stubby legs (shared geo, visual only).
function makeBench() {
  const g = new THREE.Group();
  for (const [y, z] of [[0.5, -0.12], [0.5, 0.12]]) {
    const slat = new THREE.Mesh(benchSlatGeo, benchWood);
    slat.position.set(0, y, z);
    slat.castShadow = slat.receiveShadow = true;
    g.add(slat);
  }
  const back = new THREE.Mesh(benchSlatGeo, benchWood);
  back.position.set(0, 0.78, -0.18);
  back.rotation.x = -0.35;
  back.castShadow = true;
  g.add(back);
  for (const x of [-0.85, 0.85]) {
    const leg = new THREE.Mesh(benchLegGeo, poleMat);
    leg.position.set(x, 0.25, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  return g;
}

// A litter bin: body + lid (shared geo, visual only).
function makeBin() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(binBodyGeo, binMat);
  body.position.y = 0.45;
  body.castShadow = body.receiveShadow = true;
  const lid = new THREE.Mesh(binLidGeo, poleMat);
  lid.position.y = 0.96;
  lid.castShadow = true;
  g.add(body, lid);
  return g;
}

// One storefront BAY FACADE: the detailed shopfront treatment (bulkhead riser,
// recessed door, big display windows, glass apron) applied to the FRONT face of
// the deep building mass. The mass itself supplies the solid wall/depth, so this
// only adds the shallow details that sit proud of (z>0) the mass front (z=0).
// When `entrance` is true the ground floor is left OPEN (no shopfront glazing or
// door) so the glass mall portal can occupy that volume cleanly.
function makeShopBay(width, wallMat, entrance = false) {
  const g = new THREE.Group();
  const GF = 3.4;         // ground-floor height
  if (entrance) {
    // ground floor handled by the glass portal — nothing to add on the facade
    return g;
  }
  // dark stall bulkhead band above the shopfront glazing
  const bulk = box(width, 0.5, 0.5, stallMat, false);
  bulk.position.set(0, GF - 0.1, 0.18);
  g.add(bulk);
  // big display window (recessed glass) flanking a central recessed door
  const doorW = 1.3;
  const sideW = (width - doorW - 1.2) / 2;
  if (sideW > 0.6) {
    for (const sx of [-(doorW / 2 + sideW / 2 + 0.1), (doorW / 2 + sideW / 2 + 0.1)]) {
      const win = box(sideW, 2.2, 0.16, glass);
      win.position.set(sx, 1.6, 0.22);
      win.castShadow = false;
      g.add(win);
      // sill below the window
      const sill = box(sideW + 0.1, 0.3, 0.45, stallMat, false);
      sill.position.set(sx, 0.35, 0.2);
      g.add(sill);
    }
  }
  // recessed glass door with a dark frame
  const door = box(doorW, 2.5, 0.12, glass);
  door.position.set(0, 1.25, 0.18);
  door.castShadow = false;
  g.add(door);
  const dframe = box(doorW + 0.24, 2.7, 0.16, doorMat, false);
  dframe.position.set(0, 1.35, 0.12);
  g.add(dframe);
  return g;
}

// A striped awning (slanted slab) jutting out over a storefront, with a small
// valance lip on the front edge.
function makeAwning(width, mat) {
  const g = new THREE.Group();
  const canopy = box(width, 0.12, 1.7, mat, false);
  canopy.rotation.x = -0.34;
  g.add(canopy);
  const valance = box(width, 0.35, 0.06, mat, false);
  valance.position.set(0, -0.42, 0.85);
  g.add(valance);
  return g;
}

// A SUBSTANTIAL building mass for one storefront unit: a full solid block with
// real WIDTH, DEPTH and HEIGHT so the structure reads as a true city building
// from every angle (front, sides AND back), not a flat facade card.
//   width  — full street-facing span (X)
//   depth  — how far the block runs back from its front face toward -Z
//   H      — building height
//   wallMat— body material (its branded colour)
// The block is built so its FRONT face sits at z = 0 in the group's local space
// (callers position the group at the front line) and the body extends to -depth.
// Returns { group, roofY, backZ } so callers can sit rooftop clutter on it.
function makeBuildingMass(width, depth, H, wallMat) {
  const g = new THREE.Group();
  // solid core volume — front face at z=0, body running back to z=-depth
  const body = box(width, H, depth, wallMat);
  body.position.set(0, H / 2, -depth / 2);
  g.add(body);
  // flat roof cap so the top reads as a real roof, slightly oversized for a lip
  const roof = box(width + 0.3, 0.4, depth + 0.3, roofMat, false);
  roof.position.set(0, H + 0.2, -depth / 2);
  roof.receiveShadow = true;
  g.add(roof);
  // a parapet rim around the roof edge (front + two sides) so the silhouette
  // reads like a built-up commercial block, not a plain box.
  const parF = box(width + 0.3, 0.55, 0.3, corniceMat, false);
  parF.position.set(0, H + 0.45, 0.0);
  g.add(parF);
  for (const sx of [-(width + 0.3) / 2 + 0.15, (width + 0.3) / 2 - 0.15]) {
    const parS = box(0.3, 0.55, depth + 0.3, corniceMat, false);
    parS.position.set(sx, H + 0.45, -depth / 2);
    g.add(parS);
  }
  return { group: g, roofY: H + 0.4, backZ: -depth };
}

export function buildShopping() {
  const group = new THREE.Group();
  const colliders = [];
  const dummy = new THREE.Object3D();

  // --- Ground: pavement slab with thickness so the tile reads as a real place.
  const slab = box(60, 0.8, 60, slabSide, false);
  slab.position.set(0, -0.4, 0);
  group.add(slab);

  const pave = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), pavement);
  pave.rotation.x = -Math.PI / 2;
  pave.position.y = 0.01;
  pave.receiveShadow = true;
  group.add(pave);

  // Asphalt street band down the middle (the drivable lane, z ∈ [-7, 14]).
  const street = new THREE.Mesh(new THREE.PlaneGeometry(60, 21), asphalt);
  street.rotation.x = -Math.PI / 2;
  street.position.set(0, 0.02, 3.5);
  street.receiveShadow = true;
  group.add(street);

  // Curb between sidewalk and street (north edge of the road).
  const curb = box(60, 0.16, 0.3, curbMat, false);
  curb.position.set(0, 0.08, -7.2);
  group.add(curb);

  // Dashed centre line so it reads as a commercial street (reuse one geometry).
  const dashGeo = new THREE.PlaneGeometry(2.2, 0.22);
  for (let x = -24; x <= 24; x += 12) {
    const dash = new THREE.Mesh(dashGeo, paintWhite);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.03, 3.5);
    group.add(dash);
  }

  // --- Row of connected storefront BAYS along the back (fronts face +Z) ------
  // Each "unit" is a branded block; we further split each block into several
  // identical shop bays so the facade reads as a row of individual shops.
  // Front face of the storefront walls. Chosen with DEPTH below so the REAR wall
  // lands at exactly z = -23 — the back tile-edge setback that clears the seam
  // road + sidewalk (tile back edge is z = -30; road covers the outer ~6m, kerb
  // + walk a bit more). So the whole block stays inside Z ∈ [-23, 23].
  const Z_FRONT = -18.0;   // front face of the storefront walls
  // entranceBay (optional): index of the bay replaced by the glass mall portal,
  // so the portal is the ONLY mass there (no shop bay sharing the same volume).
  // Unit X-spans are kept inside the SETBACK window X ∈ [-23, 23] (a ~7m pull-in
  // from each tile edge at ±30) so no block clips into the seam-road grid:
  //   MALL  x=-14.5 w=16 → [-22.5, -6.5]
  //   MART  x=  1   w=13 → [ -5.5,  7.5]
  //   CAFE  x= 15.5 w=14 → [  8.5, 22.5]
  const MALL_X = -14.5;        // MALL centre (portal/pylon track this)
  const units = [
    { x: MALL_X, w: 16, wall: wallA, awn: awnRed,   sign: "MALL", bg: "#b8402f", emis: "#ff5a3c", bays: 3, entranceBay: 1 },
    { x:    1,   w: 13, wall: wallB, awn: awnTeal,  sign: "MART", bg: "#1f7a73", emis: "#3fe0d4", bays: 3 },
    { x:  15.5,  w: 14, wall: wallC, awn: awnAmber, sign: "CAFE", bg: "#caa24a", emis: "#ffd070", bays: 3 },
  ];

  const signPanels = []; // collected for ambient glow flicker

  // Count upper-floor windows up front so a single InstancedMesh covers them all.
  // Each unit gets a grid: one row of windows per upper storey, columns per bay.
  const UP_ROWS = 1;             // one upper-floor row (above the 8m bays it sits at y≈6)
  let totalWindows = 0;
  let totalColumns = 0;
  for (const u of units) {
    totalWindows += u.bays * UP_ROWS * 2; // 2 windows per bay
    totalColumns += u.bays + 1;           // colonnade posts: one per bay edge
  }

  const winPanes  = new THREE.InstancedMesh(winPaneGeo, winLit, totalWindows);
  const winFrames = new THREE.InstancedMesh(winFrameGeo, trimMat, totalWindows);
  const columns   = new THREE.InstancedMesh(columnGeo, corniceMat, totalColumns);
  winPanes.castShadow = false;
  winFrames.castShadow = true;
  columns.castShadow = columns.receiveShadow = true;
  let wi = 0, ci = 0;

  const H = 8;                 // building height (two storeys)
  const DEPTH = 4.85;          // how far each block runs back from the street face
  // (rear wall at Z_FRONT - DEPTH = -22.85; the +0.15 roof-lip overhang then lands
  //  exactly on the z=-23 setback line, so even the cornice clears the seam road.
  //  ~4.85m deep × 8m tall × full unit width keeps each block a substantial 3D
  //  volume, not a thin slab.)

  for (const u of units) {
    const bayW = u.w / u.bays;
    const left = u.x - u.w / 2;

    // SUBSTANTIAL solid building mass for the whole unit: full width, real depth
    // and height so the block reads solid from the front, the sides AND the back.
    const mass = makeBuildingMass(u.w, DEPTH, H, u.wall);
    mass.group.position.set(u.x, 0, Z_FRONT);
    group.add(mass.group);

    // individual shop-bay facades dressed onto the mass front face
    for (let b = 0; b < u.bays; b++) {
      const bx = left + bayW * (b + 0.5);
      const isEntrance = b === u.entranceBay;
      const bay = makeShopBay(bayW - 0.12, u.wall, isEntrance);
      bay.position.set(bx, 0, Z_FRONT);
      group.add(bay);

      // The entrance bay gets no awning / fascia sign — the glass mall portal and
      // the cornice-mounted MALL sign already mark it, and stacking an awning here
      // would clip the portal frame.
      if (!isEntrance) {
        // striped awning over each bay's shopfront
        const awn = makeAwning(bayW - 0.5, u.awn);
        awn.position.set(bx, 3.2, Z_FRONT + 0.85);
        group.add(awn);

        // small fascia "sign" for each bay, hung flat under the awning and facing
        // the street (+Z) so the text reads correctly to anyone on the avenue.
        // (Previously rotated 90° to face ±X, which showed the mirrored BACK of
        //  the panel to players approaching from the street/west — the bug.)
        const hangSign = artPanel(Math.min(bayW - 1.0, 1.6), 0.62, "sign", {
          text: ["SHOP", "SALE", "OPEN", "DELI", "GIFTS", "WEAR", "FOOD", "BOOKS", "TOYS"][(ci + b) % 9],
          bg: u.bg, fg: "#ffffff", emissiveIntensity: 0.4,
          file: `shop-hang-${u.sign.toLowerCase()}-${b}.png`,
        });
        hangSign.position.set(bx, 2.95, Z_FRONT + 0.42);   // centred, faces +Z (street)
        hangSign.castShadow = false;
        group.add(hangSign);
        signPanels.push(hangSign);
      }

      // upper-floor windows for this bay (instanced panes + frames), set into the
      // mass FRONT face (z just proud of Z_FRONT so they read, not embedded).
      for (let r = 0; r < UP_ROWS; r++) {
        const wy = 6.0;
        for (const wx of [bx - bayW * 0.22, bx + bayW * 0.22]) {
          dummy.position.set(wx, wy, Z_FRONT + 0.07);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          winPanes.setMatrixAt(wi, dummy.matrix);
          dummy.position.z = Z_FRONT + 0.04;
          dummy.updateMatrix();
          winFrames.setMatrixAt(wi, dummy.matrix);
          wi++;
        }
      }
    }

    // cornice band above the shopfront (between storeys) running the unit width
    const cornice = box(u.w + 0.1, 0.45, 0.7, corniceMat, false);
    cornice.position.set(u.x, 4.4, Z_FRONT + 0.25);
    group.add(cornice);

    // solid footprint collider for the whole DEEP unit block (full mass volume:
    // front face at Z_FRONT back to BACK_Z), so the building blocks like a real
    // building, not just a thin facade line.
    addCollider(colliders, u.x, Z_FRONT - DEPTH / 2, u.w, DEPTH);

    // big shop sign (artPanel "sign") mounted on the cornice, facing +Z
    const signW = Math.min(u.w - 2.0, 9);
    const panel = artPanel(signW, 1.6, "sign", {
      text: u.sign, bg: u.bg, fg: "#ffffff",
      emissiveIntensity: 0.6,
      file: `shop-sign-${u.sign.toLowerCase()}.png`,
    });
    panel.position.set(u.x, 5.4, Z_FRONT + 0.35);
    panel.castShadow = false;
    group.add(panel);
    signPanels.push(panel);

    // arcade colonnade posts in front of this unit (covered walkway)
    const colZ = Z_FRONT + 2.4;
    for (let p = 0; p <= u.bays; p++) {
      const cx = left + bayW * p;
      dummy.position.set(cx, 2.0, colZ);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      columns.setMatrixAt(ci++, dummy.matrix);
    }

    // arcade roof slab spanning this unit's colonnade (covered walkway lid)
    const arcRoof = box(u.w + 0.3, 0.18, 2.8, corniceMat, false);
    arcRoof.position.set(u.x, 4.0, Z_FRONT + 1.3);
    group.add(arcRoof);
  }
  winPanes.instanceMatrix.needsUpdate = true;
  winFrames.instanceMatrix.needsUpdate = true;
  columns.instanceMatrix.needsUpdate = true;
  group.add(winPanes, winFrames, columns);

  // --- Rooftop clutter sitting on the REAL roofs of the deep blocks (roof top is
  // at y≈8.4, decking spans z∈[-22,-28.8]). Spread across the depth so the roofs
  // read as occupied surfaces, not a thin parapet line.
  const rooftop = new THREE.Group();
  // a few AC condenser units + vent pipes scattered back across the roof deck
  for (const [rx, rz] of [[-18, -23.5], [-12, -26.5], [2, -24.0], [18, -26.0]]) {
    const ac = new THREE.Mesh(acGeo, metalMat);
    ac.position.set(rx, 8.75, rz);
    ac.castShadow = true;
    rooftop.add(ac);
  }
  for (const [px, pz] of [[-8, -25.5], [6, -27.0], [20, -23.5]]) {
    const pipe = new THREE.Mesh(pipeGeo, metalMat);
    pipe.position.set(px, 9.2, pz);
    pipe.castShadow = true;
    rooftop.add(pipe);
  }
  // a small water tank on a low cradle
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 12), metalMat);
  tank.position.set(-20, 9.1, -26.0);
  tank.castShadow = true;
  rooftop.add(tank);
  // a thin antenna mast
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.0, 6), poleMat);
  antenna.position.set(10, 9.9, -27.0);
  antenna.castShadow = true;
  rooftop.add(antenna);
  rooftop.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  group.add(rooftop);

  // --- Mall entrance: a glass portal filling the MALL's open entrance bay ----
  // The MALL centre bay (entranceBay:1, x=MALL_X) is built wall-only, so this glass
  // storefront is the SOLE mass in that volume (no shop bay clipping through it).
  const portal = box(4.6, 3.6, 0.25, glass);
  portal.position.set(MALL_X, 1.8, Z_FRONT + 0.18);
  portal.castShadow = false;
  group.add(portal);
  // a clean entrance lintel + side jambs framing the glazed portal
  const portalLintel = box(5.0, 0.5, 0.5, trimMat);
  portalLintel.position.set(MALL_X, 3.85, Z_FRONT + 0.18);
  group.add(portalLintel);
  for (const jx of [MALL_X - 2.35, MALL_X + 2.35]) {
    const jamb = box(0.3, 3.9, 0.5, trimMat);
    jamb.position.set(jx, 1.95, Z_FRONT + 0.18);
    group.add(jamb);
  }
  // a low entry step so the portal reads as a real doorway, not floating glass
  const portalStep = box(4.8, 0.18, 1.0, corniceMat);
  portalStep.position.set(MALL_X, 0.09, Z_FRONT + 0.55);
  group.add(portalStep);

  // Rotating pylon sign (totem) — billboard text on a pole, spins slowly. Stands
  // on the sidewalk in front of the MALL (z=-13.5, clear of the building front).
  const pylonPole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 6, 10), poleMat);
  pylonPole.position.set(MALL_X, 3, -13.5);
  pylonPole.castShadow = true;
  group.add(pylonPole);
  const pylonSign = artPanel(2.6, 3.4, "billboard", {
    title: "MALL", sub: "OPEN", a: "#1f3f7a", b: "#0c1830", accent: "#ffcf3f", glyph: "★",
    emissiveIntensity: 0.5, file: "mall-pylon.png",
  });
  pylonSign.position.set(MALL_X, 5.4, -13.5);
  group.add(pylonSign);
  addCollider(colliders, MALL_X, -13.5, 0.6, 0.6);

  // --- Sidewalk planters lining the storefront row --------------------------
  // Kept inside X ∈ [-23,23] (allowing for the 0.65m planter half-width) and just
  // in front of the building line (front face z=-18) so none sits in the seam road.
  const planterXs = [-22, 0, 22];
  for (const x of planterXs) {
    const p = makePlanter();
    p.position.set(x, 0, -15.5);
    group.add(p);
    addCollider(colliders, x, -15.5, 1.3, 1.3);
  }
  // a couple near the far (south) corners — pulled in to the setback so the open
  // street stays clear AND they don't reach the seam road at the tile corners.
  for (const x of [-22, 22]) {
    const p = makePlanter();
    p.position.set(x, 0, 22);
    group.add(p);
    addCollider(colliders, x, 22, 1.3, 1.3);
  }

  // --- Sidewalk dressing: benches + bins (visual only, kept out of the lanes) -
  // Sidewalk band is z ∈ [-18,-8]; these sit at z≈-16, well clear of the road.
  for (const [bx, rot] of [[-9, 0], [9, 0], [-22, Math.PI / 2]]) {
    const bench = makeBench();
    bench.position.set(bx, 0, -16.0);
    bench.rotation.y = rot;
    group.add(bench);
  }
  for (const bx of [-12, 5, 13]) {
    const bin = makeBin();
    bin.position.set(bx, 0, -16.4);
    group.add(bin);
  }

  // --- Bollards along the curb edge (instanced, decorative, no lane block) ----
  // Placed on the sidewalk just inside the curb (z≈-7.8), spaced so they line
  // the walk edge without protruding into the z≥-7 driving lane.
  const bollardXs = [];
  for (let x = -22; x <= 22; x += 4) {
    // skip the central span so the open lane reads unobstructed
    if (Math.abs(x) < 4) continue;
    bollardXs.push(x);   // x ∈ [-22,22] keeps them inside the setback, off the seam road
  }
  const bollards = new THREE.InstancedMesh(bollardGeo, bollardMat, bollardXs.length);
  bollards.castShadow = true;
  bollards.receiveShadow = true;
  for (let i = 0; i < bollardXs.length; i++) {
    dummy.position.set(bollardXs[i], 0.45, -7.8);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    bollards.setMatrixAt(i, dummy.matrix);
  }
  bollards.instanceMatrix.needsUpdate = true;
  group.add(bollards);

  // --- Bus-stop shelter on the sidewalk (east side, off the driving lane) ----
  const shelter = new THREE.Group();
  const roof = box(4, 0.16, 1.8, roofMat);
  roof.position.set(0, 2.5, 0);
  shelter.add(roof);
  for (const x of [-1.9, 1.9]) {
    const post = box(0.12, 2.5, 0.12, poleMat);
    post.position.set(x, 1.25, -0.8);
    shelter.add(post);
  }
  const backGlass = box(4, 1.8, 0.06, shelterGlass, false);
  backGlass.position.set(0, 1.3, -0.85);
  shelter.add(backGlass);
  const seat = box(3.4, 0.12, 0.4, benchWood);
  seat.position.set(0, 0.5, -0.6);
  shelter.add(seat);
  shelter.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // Pulled in to x=20.5 so the 4m-wide shelter spans X∈[18.5,22.5] — inside the
  // ±23 setback, off the avenue seam road on the east edge.
  shelter.position.set(20.5, 0, -10.5);
  group.add(shelter);
  // Collider covers ONLY the solid back (glass wall + posts + seat). The roof is an
  // overhead panel (y≈2.5) so it gets NO footprint collider — players can step UNDER
  // it and stand inside the shelter from the open street-facing front.
  addCollider(colliders, 20.5, -11.05, 4, 0.7);

  // Bus-stop sign post by the shelter.
  const stopPole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 8), poleMat);
  stopPole.position.set(17.5, 1.5, -9);
  stopPole.castShadow = true;
  group.add(stopPole);
  const stopSign = artPanel(1.1, 1.1, "sign", {
    text: "BUS", bg: "#1f4fa0", fg: "#ffffff", emissiveIntensity: 0.45, file: "bus-stop.png",
  });
  stopSign.position.set(17.5, 2.7, -9);
  group.add(stopSign);

  // --- ENTERABLE BOUTIQUE -----------------------------------------------------
  // A small, walk-in clothing boutique tucked along the OPEN south verge of the
  // tile (the quadrant south of the drive lane is clear: only corner planters at
  // x=±22 live here). The room is built around a local origin then offset so it
  // sits fully inside X,Z ∈ [-23,23] and clear of the lane (z>14) and planters.
  //
  //   Footprint (LOCAL to SHOP_X/SHOP_Z): 8m wide (X) × 7m deep (Z).
  //   STREET-FACING wall is the NORTH wall (toward -Z / the avenue) with a 2.2m
  //   doorway gap. Walls 0.25m thick. Each solid wall gets its OWN AABB collider;
  //   the doorway gap gets NONE so the player can walk straight in.
  const SHOP_W = 8.0;     // interior+wall span in X
  const SHOP_D = 7.0;     // interior+wall span in Z
  const WT     = 0.25;    // wall thickness
  const WALL_H = 3.2;     // interior wall height
  const DOOR_W = 2.2;     // doorway gap in the north (street-facing) wall
  const SHOP_X = -4.0;    // tile-local centre X  → spans [-8, 0]
  const SHOP_Z = 18.5;    // tile-local centre Z  → spans [15, 22] (clear of lane @14, planters @±22)

  const shop = new THREE.Group();
  shop.position.set(SHOP_X, 0, SHOP_Z);
  // wall extents in shop-local coords
  const halfW = SHOP_W / 2, halfD = SHOP_D / 2;
  const zNorth = -halfD;  // street-facing wall (toward the avenue)
  const zSouth =  halfD;  // back wall
  const wallTopY = WALL_H;

  // Floor (wood-look) + thin slab so it reads as a real shop floor.
  const floor = box(SHOP_W, 0.08, SHOP_D, boutiqueFloor, false);
  floor.position.set(0, 0.05, 0);
  floor.receiveShadow = true;
  shop.add(floor);

  // Flat roof / ceiling cap.
  const ceil = box(SHOP_W + 0.3, 0.2, SHOP_D + 0.3, boutiqueRoof, false);
  ceil.position.set(0, wallTopY + 0.1, 0);
  ceil.receiveShadow = true;
  shop.add(ceil);

  // BACK wall (south, solid full width).
  const backWall = box(SHOP_W, WALL_H, WT, boutiqueWall);
  backWall.position.set(0, WALL_H / 2, zSouth);
  shop.add(backWall);
  // SIDE walls (east + west, solid full depth).
  for (const sx of [-halfW + WT / 2, halfW - WT / 2]) {
    const sideWall = box(WT, WALL_H, SHOP_D, boutiqueWall);
    sideWall.position.set(sx, WALL_H / 2, 0);
    shop.add(sideWall);
  }
  // FRONT (north / street-facing) wall — TWO short segments flanking the doorway.
  // Each segment width = (full width - door width) / 2.
  const segW = (SHOP_W - DOOR_W) / 2;
  const segOffX = DOOR_W / 2 + segW / 2;   // centre offset of each flanking segment
  for (const sx of [-segOffX, segOffX]) {
    const seg = box(segW, WALL_H, WT, boutiqueWall);
    seg.position.set(sx, WALL_H / 2, zNorth);
    shop.add(seg);
  }
  // A slim lintel over the doorway (spans the gap up high) so the opening reads as
  // a real door head — it sits ABOVE head height, so no collider needed there.
  const lintel = box(DOOR_W + 0.1, 0.4, WT, boutiqueWall, false);
  lintel.position.set(0, WALL_H - 0.2, zNorth);
  shop.add(lintel);

  // --- Interior content (cozy + themed for a clothing boutique) --------------
  // Cozy rug centred on the floor.
  const rug = box(3.4, 0.03, 2.6, rugMat, false);
  rug.position.set(0, 0.10, 0.4);
  rug.receiveShadow = true;
  shop.add(rug);

  // Service COUNTER along the back-right corner (L of body + dark top).
  const counterBody = box(2.6, 1.0, 0.7, counterMat);
  counterBody.position.set(halfW - 1.6, 0.5, zSouth - 0.6);
  shop.add(counterBody);
  const counterTop = box(2.8, 0.08, 0.85, counterTopMat, false);
  counterTop.position.set(halfW - 1.6, 1.02, zSouth - 0.6);
  shop.add(counterTop);

  // SHELVES on the back wall (left side) with little folded-goods products.
  const shelfX = -halfW + 1.4;
  for (let s = 0; s < 3; s++) {
    const shelf = box(2.4, 0.08, 0.5, shelfMat, false);
    const sy = 0.7 + s * 0.7;
    shelf.position.set(shelfX, sy, zSouth - 0.35);
    shop.add(shelf);
  }
  // folded clothing stacks on the shelves (instanced for the repeated goods).
  const foldCount = 3 * 3;   // 3 shelves × 3 stacks
  const folds = new THREE.InstancedMesh(foldGeo, garmentMat, foldCount);
  folds.castShadow = true; folds.receiveShadow = true;
  let fi = 0;
  for (let s = 0; s < 3; s++) {
    const sy = 0.7 + s * 0.7;
    for (let c = 0; c < 3; c++) {
      dummy.position.set(shelfX - 0.75 + c * 0.75, sy + 0.12, zSouth - 0.35);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      folds.setMatrixAt(fi, dummy.matrix);
      folds.setColorAt(fi, new THREE.Color(["#c4566b", "#4a7ba6", "#5a8f6b", "#d9a23a", "#7a5aa0"][(s * 3 + c) % 5]));
      fi++;
    }
  }
  folds.instanceMatrix.needsUpdate = true;
  if (folds.instanceColor) folds.instanceColor.needsUpdate = true;
  shop.add(folds);

  // DISPLAY CASE (glass-topped cabinet) by the west wall, near the front.
  const caseBody = box(1.0, 0.9, 1.6, counterMat);
  caseBody.position.set(-halfW + 0.7, 0.45, -0.6);
  shop.add(caseBody);
  const caseTop = box(1.05, 0.5, 1.65, caseGlass, false);
  caseTop.position.set(-halfW + 0.7, 1.15, -0.6);
  shop.add(caseTop);

  // CLOTHING RACK (a metal rail on posts) with hanging garments — the boutique's
  // centrepiece, parallel to the front wall.
  const rackZ = -0.2;
  const rackY = 1.6;
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8), rackBarMat);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(1.0, rackY, rackZ);
  rail.castShadow = true;
  shop.add(rail);
  for (const px of [1.0 - 1.3, 1.0 + 1.3]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 8), rackBarMat);
    post.position.set(px, 0.8, rackZ);
    post.castShadow = true;
    shop.add(post);
  }
  // hanging garments on the rail (instanced).
  const hangCount = 7;
  const hangers = new THREE.InstancedMesh(garmentGeo, garmentMat, hangCount);
  hangers.castShadow = true; hangers.receiveShadow = true;
  for (let h = 0; h < hangCount; h++) {
    dummy.position.set(1.0 - 1.05 + h * 0.35, rackY - 0.5, rackZ);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    hangers.setMatrixAt(h, dummy.matrix);
    hangers.setColorAt(h, new THREE.Color(["#c4566b", "#4a7ba6", "#5a8f6b", "#d9a23a", "#7a5aa0", "#cf7a3a", "#3a8f8f"][h % 7]));
  }
  hangers.instanceMatrix.needsUpdate = true;
  if (hangers.instanceColor) hangers.instanceColor.needsUpdate = true;
  shop.add(hangers);

  // A couple of STOOLS / seats for browsing.
  for (const [sx, sz] of [[-1.6, 1.4], [-0.4, 1.6]]) {
    const seat = new THREE.Mesh(stoolSeatGeo, stoolSeatMat);
    seat.position.set(sx, 0.62, sz);
    seat.castShadow = true;
    shop.add(seat);
    const leg = new THREE.Mesh(stoolLegGeo, rackBarMat);
    leg.position.set(sx, 0.32, sz);
    leg.castShadow = true;
    shop.add(leg);
  }

  // WALL SIGNAGE inside — a small framed sign on the back wall (faces -Z, into
  // the room) so a browsing player reads it correctly.
  const innerSign = artPanel(2.2, 0.8, "sign", {
    text: "BOUTIQUE", bg: "#5f0f40", fg: "#ffd6e0", emissiveIntensity: 0.4,
    file: "boutique-inner.png",
  });
  innerSign.position.set(-1.0, 2.3, zSouth - 0.16);   // clear of the 0.25m wall so it reads from the room
  innerSign.rotation.y = Math.PI;   // face into the room (toward -Z)
  innerSign.castShadow = false;
  shop.add(innerSign);

  // Hanging INTERIOR LIGHTS (two glowing pendant shades under the ceiling).
  for (const [lx, lz] of [[-1.2, -0.2], [1.4, 0.6]]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), poleMat);
    cord.position.set(lx, wallTopY - 0.3, lz);
    shop.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 12, 1, true), lampShadeMat);
    shade.position.set(lx, wallTopY - 0.65, lz);
    shop.add(shade);
  }

  // --- Wall COLLIDERS (one AABB per solid wall; NONE across the doorway gap) --
  // Converted to TILE-LOCAL coords by adding the shop origin offset. The two
  // front segments flank the door; the gap between them carries NO collider.
  // back wall
  addCollider(colliders, SHOP_X + 0, SHOP_Z + zSouth, SHOP_W, WT);
  // side walls
  addCollider(colliders, SHOP_X + (-halfW + WT / 2), SHOP_Z + 0, WT, SHOP_D);
  addCollider(colliders, SHOP_X + ( halfW - WT / 2), SHOP_Z + 0, WT, SHOP_D);
  // front wall — two short segments flanking the 2.2m doorway (no collider in gap)
  addCollider(colliders, SHOP_X + (-segOffX), SHOP_Z + zNorth, segW, WT);
  addCollider(colliders, SHOP_X + ( segOffX), SHOP_Z + zNorth, segW, WT);

  group.add(shop);

  // --- Shop SIGN above the door, OUTSIDE, facing the STREET (-Z) -------------
  // Mounted on the north wall just above the doorway, facing the avenue. Faces
  // -Z (default plane faces +Z, so rotate 180° to read un-mirrored from the
  // street to the north). In tile-local coords.
  const shopSign = artPanel(3.2, 1.0, "sign", {
    text: "BOUTIQUE", bg: "#5f0f40", fg: "#ffd6e0", emissiveIntensity: 0.55,
    file: "boutique-sign.png",
  });
  shopSign.position.set(SHOP_X, WALL_H + 0.6, SHOP_Z + zNorth - 0.06);
  shopSign.rotation.y = Math.PI;   // face the street to the north (-Z)
  shopSign.castShadow = false;
  group.add(shopSign);
  signPanels.push(shopSign);

  // --- Generic ENTERABLE shop SHELL builder ----------------------------------
  // Builds a four-wall room with a doorway GAP in the NORTH (street-facing, -Z)
  // wall, plus floor + ceiling. Mirrors the boutique's wall layout exactly so the
  // two new shops stay consistent. Returns { group, wallH, halfW, halfD } and, via
  // `addShellColliders`, registers one AABB per SOLID wall (none across the gap)
  // converted to tile-local coords by the caller's (ox, oz) origin offset.
  function makeShellColliders(ox, oz, W, D, wt, doorW) {
    const hw = W / 2, hd = D / 2;
    const sW = (W - doorW) / 2;          // each flanking front-segment width
    const sOff = doorW / 2 + sW / 2;     // centre offset of each flanking segment
    addCollider(colliders, ox + 0, oz + hd, W, wt);                 // back (south)
    addCollider(colliders, ox + (-hw + wt / 2), oz + 0, wt, D);     // west side
    addCollider(colliders, ox + ( hw - wt / 2), oz + 0, wt, D);     // east side
    addCollider(colliders, ox + (-sOff), oz - hd, sW, wt);          // front-left seg
    addCollider(colliders, ox + ( sOff), oz - hd, sW, wt);          // front-right seg
  }
  function makeShell(W, D, wallH, wallMat, ceilMat, floorMat, wt, doorW) {
    const g = new THREE.Group();
    const hw = W / 2, hd = D / 2;
    const flr = box(W, 0.08, D, floorMat, false);
    flr.position.set(0, 0.05, 0); flr.receiveShadow = true; g.add(flr);
    const cap = box(W + 0.3, 0.2, D + 0.3, ceilMat, false);
    cap.position.set(0, wallH + 0.1, 0); cap.receiveShadow = true; g.add(cap);
    const back = box(W, wallH, wt, wallMat);
    back.position.set(0, wallH / 2, hd); g.add(back);                // back (south)
    for (const sx of [-hw + wt / 2, hw - wt / 2]) {
      const side = box(wt, wallH, D, wallMat);
      side.position.set(sx, wallH / 2, 0); g.add(side);
    }
    const sW = (W - doorW) / 2;
    const sOff = doorW / 2 + sW / 2;
    for (const sx of [-sOff, sOff]) {
      const seg = box(sW, wallH, wt, wallMat);
      seg.position.set(sx, wallH / 2, -hd); g.add(seg);              // front (north)
    }
    const lin = box(doorW + 0.1, 0.4, wt, wallMat, false);
    lin.position.set(0, wallH - 0.2, -hd); g.add(lin);              // door lintel
    return { group: g, hw, hd };
  }

  // Outward shop SIGN above a doorway, facing the avenue (-Z), pushed to signPanels.
  function addStreetSign(ox, oz, frontZ, wallH, w, h, opts) {
    const s = artPanel(w, h, "sign", opts);
    s.position.set(ox, wallH + 0.55, oz + frontZ - 0.06);
    s.rotation.y = Math.PI;
    s.castShadow = false;
    group.add(s);
    signPanels.push(s);
  }

  // ===== ENTERABLE BAKERY (south-west verge) =================================
  // Footprint 7m × 6.5m, centre (-15.5, 18.5) → X∈[-19,-12], Z∈[15.25,21.75].
  // Clear of the boutique (right edge -12 vs boutique left -8), the corner planter
  // (x=-22), the drive lane (z>14) and the ±23 setback. Doorway faces the avenue.
  {
    const BW = 7.0, BD = 6.5, BH = 3.2, WT2 = 0.25, DOOR2 = 2.2;
    const BX = -15.5, BZ = 18.5;
    const sh = makeShell(BW, BD, BH, bakeWall, bakeRoof, bakeFloor, WT2, DOOR2);
    sh.group.position.set(BX, 0, BZ);
    const hw = sh.hw, hd = sh.hd;

    // Display COUNTER with a glass pastry case along the back-left.
    const cb = box(2.6, 1.0, 0.7, ovenMat);
    cb.position.set(-hw + 1.7, 0.5, hd - 0.7); sh.group.add(cb);
    const ct = box(2.8, 0.08, 0.85, counterTopMat, false);
    ct.position.set(-hw + 1.7, 1.02, hd - 0.7); sh.group.add(ct);
    const cg = box(2.7, 0.55, 0.8, caseGlass, false);
    cg.position.set(-hw + 1.7, 1.35, hd - 0.7); sh.group.add(cg);

    // Brick OVEN with a glowing mouth along the back-right (the bakery's heart).
    const oven = box(2.0, 2.2, 1.1, ovenMat);
    oven.position.set(hw - 1.4, 1.1, hd - 0.7); sh.group.add(oven);
    const mouth = box(1.1, 0.7, 0.2, ovenGlow, false);
    mouth.position.set(hw - 1.4, 1.0, hd - 1.28); sh.group.add(mouth);

    // Two SHELF racks of bread along the west wall (instanced loaves).
    const loaves = new THREE.InstancedMesh(loafGeo, breadMat, 2 * 4);
    loaves.castShadow = true; loaves.receiveShadow = true;
    let li = 0;
    for (let s = 0; s < 2; s++) {
      const sy = 1.0 + s * 0.75;
      const shelf = box(0.55, 0.08, 3.0, shelfMat, false);
      shelf.position.set(-hw + 0.45, sy - 0.06, 0); sh.group.add(shelf);
      for (let c = 0; c < 4; c++) {
        dummy.position.set(-hw + 0.45, sy + 0.05, -1.1 + c * 0.75);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.updateMatrix();
        loaves.setMatrixAt(li++, dummy.matrix);
      }
    }
    loaves.instanceMatrix.needsUpdate = true;
    sh.group.add(loaves);

    // A small cafe TABLE with two stools near the door (somewhere to sit).
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 16), counterTopMat);
    tableTop.position.set(0.6, 0.78, -hd + 1.6); tableTop.castShadow = true; sh.group.add(tableTop);
    const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.78, 8), rackBarMat);
    tableLeg.position.set(0.6, 0.39, -hd + 1.6); sh.group.add(tableLeg);
    for (const [sx, sz] of [[-0.1, -hd + 1.6], [1.3, -hd + 1.6]]) {
      const seat = new THREE.Mesh(stoolSeatGeo, stoolSeatMat);
      seat.position.set(sx, 0.55, sz); seat.castShadow = true; sh.group.add(seat);
      const leg = new THREE.Mesh(stoolLegGeo, rackBarMat);
      leg.position.set(sx, 0.28, sz); sh.group.add(leg);
    }

    // Warm pendant LIGHTS.
    for (const [lx, lz] of [[-1.0, 0.2], [1.4, -0.6]]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), poleMat);
      cord.position.set(lx, BH - 0.3, lz); sh.group.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 12, 1, true), lampShadeMat);
      shade.position.set(lx, BH - 0.65, lz); sh.group.add(shade);
    }

    // Inner wall sign.
    const inner = artPanel(2.0, 0.7, "sign", {
      text: "FRESH BREAD", bg: "#7d4a2c", fg: "#ffe6b0", emissiveIntensity: 0.4, file: "bakery-inner.png",
    });
    inner.position.set(-1.0, 2.4, hd - 0.16); inner.rotation.y = Math.PI; inner.castShadow = false;
    sh.group.add(inner);

    group.add(sh.group);
    makeShellColliders(BX, BZ, BW, BD, WT2, DOOR2);
    addStreetSign(BX, BZ, -hd, BH, 3.0, 1.0, {
      text: "BAKERY", bg: "#7d4a2c", fg: "#ffe6b0", emissiveIntensity: 0.55, file: "bakery-sign.png",
    });
    // a striped awning over the bakery door, jutting toward the street (-Z). Kept
    // shallow so its front tip stays on the verge (z>14), clear of the drive lane.
    const bakeAwn = makeAwning(3.0, awnAmber);
    bakeAwn.position.set(BX, BH + 0.05, BZ - hd - 0.5);
    bakeAwn.rotation.y = Math.PI;
    group.add(bakeAwn);
  }

  // ===== ENTERABLE GROCER (south-east verge) =================================
  // Footprint 8m × 6.5m, centre (9, 18.5) → X∈[5,13], Z∈[15.25,21.75]. Clear of
  // the boutique (left edge 5 vs boutique right 0), the corner planter (x=22), the
  // drive lane (z>14) and the ±23 setback. Doorway faces the avenue.
  {
    const GW = 8.0, GD = 6.5, GH = 3.2, WT2 = 0.25, DOOR2 = 2.2;
    const GX = 9.0, GZ = 18.5;
    const sh = makeShell(GW, GD, GH, grocWall, grocRoof, grocFloor, WT2, DOOR2);
    sh.group.position.set(GX, 0, GZ);
    const hw = sh.hw, hd = sh.hd;

    // CHECKOUT counter near the door-right.
    const cb = box(2.2, 1.0, 0.7, counterMat);
    cb.position.set(hw - 1.5, 0.5, -hd + 1.2); sh.group.add(cb);
    const ct = box(2.4, 0.08, 0.85, counterTopMat, false);
    ct.position.set(hw - 1.5, 1.02, -hd + 1.2); sh.group.add(ct);

    // A glowing chilled DISPLAY FRIDGE against the back wall (metal frame + glass
    // front a touch proud of the inner wall face so neither z-fights the wall).
    const fframe = box(3.6, 2.2, 0.7, metalMat);
    fframe.position.set(0.4, 1.1, hd - 0.55); fframe.castShadow = true; sh.group.add(fframe);
    const fglass = box(3.4, 2.0, 0.1, fridgeMat, false);
    fglass.position.set(0.4, 1.0, hd - 0.92); sh.group.add(fglass);

    // TWO produce-display GONDOLAS (crate risers + tinted produce mounds) down the
    // middle aisle. Instanced produce (3 rows × 2 cols per riser) stays cheap.
    const produce = new THREE.InstancedMesh(produceGeo, produceMat, 2 * 6);
    produce.castShadow = true; produce.receiveShadow = true;
    const tints = ["#d2402f", "#e88a2a", "#e3c020", "#5a9e3f", "#9c4fa0", "#cf5a4a"];
    let pidx = 0;
    for (let g2 = 0; g2 < 2; g2++) {
      const gx = -hw + 2.2 + g2 * 2.6;
      const riser = box(1.4, 0.7, 2.4, crateMat);
      riser.position.set(gx, 0.35, 0.3); sh.group.add(riser);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 2; c++) {
          dummy.position.set(gx - 0.32 + c * 0.64, 0.8, -0.5 + r * 0.55);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          produce.setMatrixAt(pidx, dummy.matrix);
          produce.setColorAt(pidx, new THREE.Color(tints[(g2 * 6 + r * 2 + c) % tints.length]));
          pidx++;
        }
      }
    }
    produce.instanceMatrix.needsUpdate = true;
    if (produce.instanceColor) produce.instanceColor.needsUpdate = true;
    sh.group.add(produce);

    // A stack of spare CRATES in the back-left corner.
    for (const [cx, cy, cz] of [[-hw + 0.9, 0.4, hd - 0.9], [-hw + 0.9, 1.1, hd - 0.9], [-hw + 1.7, 0.4, hd - 0.9]]) {
      const cr = new THREE.Mesh(crateGeo, crateMat);
      cr.position.set(cx, cy, cz); cr.castShadow = true; cr.receiveShadow = true; sh.group.add(cr);
    }

    // Cool ceiling LIGHTS (flat panels glow).
    for (const [lx, lz] of [[-1.4, 0.0], [1.6, 0.4]]) {
      const panel = box(1.0, 0.06, 0.5, lampShadeMat, false);
      panel.position.set(lx, GH - 0.2, lz); sh.group.add(panel);
    }

    // Inner wall sign.
    const inner = artPanel(2.0, 0.7, "sign", {
      text: "FRESH PRODUCE", bg: "#1f6e3a", fg: "#e9ffe0", emissiveIntensity: 0.4, file: "grocer-inner.png",
    });
    inner.position.set(-2.4, 2.4, hd - 0.16); inner.rotation.y = Math.PI; inner.castShadow = false;
    sh.group.add(inner);

    group.add(sh.group);
    makeShellColliders(GX, GZ, GW, GD, WT2, DOOR2);
    addStreetSign(GX, GZ, -hd, GH, 3.2, 1.0, {
      text: "GROCER", bg: "#1f6e3a", fg: "#e9ffe0", emissiveIntensity: 0.55, file: "grocer-sign.png",
    });
    const grocAwn = makeAwning(3.2, awnTeal);
    grocAwn.position.set(GX, GH + 0.05, GZ - hd - 0.5);
    grocAwn.rotation.y = Math.PI;
    group.add(grocAwn);
  }

  // ===== ENTERABLE FLORIST (south-east verge) ================================
  // Footprint 6.5m × 6.5m, centre (17, 18.5) → X∈[13.75,20.25], Z∈[15.25,21.75].
  // Clear of the grocer (left edge 13.75 vs grocer right 13), the corner planter
  // (x=22,z=22), the drive lane (z>14) and the ±23 setback. Doorway faces the avenue.
  {
    const FW = 6.5, FD = 6.5, FH = 3.2, WT2 = 0.25, DOOR2 = 2.2;
    const FX = 17.0, FZ = 18.5;
    const sh = makeShell(FW, FD, FH, florWall, florRoof, florFloor, WT2, DOOR2);
    sh.group.position.set(FX, 0, FZ);
    const hw = sh.hw, hd = sh.hd;

    // POTTING-BENCH counter along the back-right with a dark work top.
    const cb = box(2.4, 1.0, 0.7, counterMat);
    cb.position.set(hw - 1.5, 0.5, hd - 0.7); sh.group.add(cb);
    const ct = box(2.6, 0.08, 0.85, counterTopMat, false);
    ct.position.set(hw - 1.5, 1.02, hd - 0.7); sh.group.add(ct);

    // Tiered DISPLAY SHELVES of potted plants along the west wall (instanced pots +
    // instanced blooms keep the greenery cheap).
    const POT_ROWS = 2, POT_COLS = 4;
    const pots   = new THREE.InstancedMesh(potGeo, potMat, POT_ROWS * POT_COLS);
    const blooms = new THREE.InstancedMesh(bloomGeo, bloomMat, POT_ROWS * POT_COLS);
    pots.castShadow = pots.receiveShadow = true;
    blooms.castShadow = true;
    const bloomTints = ["#e8557f", "#f0a13a", "#efd23a", "#b466c4", "#e85a4a", "#ffffff"];
    let pi = 0;
    for (let s = 0; s < POT_ROWS; s++) {
      const sy = 0.95 + s * 0.85;
      const shelf = box(0.55, 0.08, 3.4, shelfMat, false);
      shelf.position.set(-hw + 0.45, sy - 0.06, 0); sh.group.add(shelf);
      for (let c = 0; c < POT_COLS; c++) {
        const pz = -1.35 + c * 0.9;
        dummy.position.set(-hw + 0.45, sy + 0.07, pz);
        dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        pots.setMatrixAt(pi, dummy.matrix);
        dummy.position.set(-hw + 0.45, sy + 0.3, pz);
        dummy.updateMatrix();
        blooms.setMatrixAt(pi, dummy.matrix);
        blooms.setColorAt(pi, new THREE.Color(bloomTints[(s * POT_COLS + c) % bloomTints.length]));
        pi++;
      }
    }
    pots.instanceMatrix.needsUpdate = true;
    blooms.instanceMatrix.needsUpdate = true;
    if (blooms.instanceColor) blooms.instanceColor.needsUpdate = true;
    sh.group.add(pots, blooms);

    // A cluster of FLOWER BUCKETS near the entrance (galvanized buckets + bloom tufts).
    const bucketSpots = [[-1.2, -hd + 1.3], [-0.4, -hd + 1.5], [0.4, -hd + 1.3]];
    const tufts = new THREE.InstancedMesh(bloomGeo, bloomMat, bucketSpots.length * 3);
    tufts.castShadow = true;
    let ti = 0;
    for (let k = 0; k < bucketSpots.length; k++) {
      const [bx, bz] = bucketSpots[k];
      const bucket = new THREE.Mesh(bucketGeo, bucketMat);
      bucket.position.set(bx, 0.25, bz);
      bucket.castShadow = bucket.receiveShadow = true;
      sh.group.add(bucket);
      for (let f = 0; f < 3; f++) {
        dummy.position.set(bx - 0.1 + f * 0.1, 0.62 + f * 0.04, bz);
        dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        tufts.setMatrixAt(ti, dummy.matrix);
        tufts.setColorAt(ti, new THREE.Color(bloomTints[(k * 3 + f) % bloomTints.length]));
        ti++;
      }
    }
    tufts.instanceMatrix.needsUpdate = true;
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    sh.group.add(tufts);

    // A tall potted SHRUB in the back-left corner.
    const bigPot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.5, 12), potMat);
    bigPot.position.set(-hw + 0.7, 0.25, hd - 0.8); bigPot.castShadow = true; sh.group.add(bigPot);
    const shrub = new THREE.Mesh(blobGeo, stemMat);
    shrub.position.set(-hw + 0.7, 0.95, hd - 0.8); shrub.scale.setScalar(0.7); shrub.castShadow = true;
    sh.group.add(shrub);

    // Warm pendant LIGHTS.
    for (const [lx, lz] of [[-1.0, 0.2], [1.4, -0.6]]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), poleMat);
      cord.position.set(lx, FH - 0.3, lz); sh.group.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 12, 1, true), lampShadeMat);
      shade.position.set(lx, FH - 0.65, lz); sh.group.add(shade);
    }

    // Inner wall sign (sits in FRONT of the back wall so it reads from the room).
    const inner = artPanel(2.2, 0.7, "sign", {
      text: "FRESH FLOWERS", bg: "#2d6a4f", fg: "#d8f3dc", emissiveIntensity: 0.4, file: "florist-inner.png",
    });
    inner.position.set(-2.0, 2.4, hd - 0.16); inner.rotation.y = Math.PI; inner.castShadow = false;
    sh.group.add(inner);

    group.add(sh.group);
    makeShellColliders(FX, FZ, FW, FD, WT2, DOOR2);
    addStreetSign(FX, FZ, -hd, FH, 3.0, 1.0, {
      text: "FLORIST", bg: "#2d6a4f", fg: "#ffd6e0", emissiveIntensity: 0.55, file: "florist-sign.png",
    });
    // a striped awning over the door, jutting toward the street (-Z), above head
    // height (y≈3.25) so it carries NO collider and players walk straight under it.
    const florAwn = makeAwning(3.0, awnTeal);
    florAwn.position.set(FX, FH + 0.05, FZ - hd - 0.5);
    florAwn.rotation.y = Math.PI;
    group.add(florAwn);
  }

  // ===== STREET-LEVEL FLAVOR: market stall, crates, lamps, planters ==========
  // An open-air MARKET STALL between the boutique and grocer (south verge), so the
  // pedestrian zone feels lived-in. Centre (2.5, 16.2): a striped canopy on four
  // posts over a crate-topped produce table. Footprint ~3×2, inside the setback and
  // clear of the lane (z>14) and the three shopfronts.
  {
    const SX = 2.5, SZ = 16.2;
    const stall = new THREE.Group();
    // crate-riser table
    const tbl = box(3.0, 0.9, 1.4, crateMat);
    tbl.position.set(0, 0.45, 0); tbl.castShadow = true; tbl.receiveShadow = true; stall.add(tbl);
    // a few tinted produce mounds on top (small instanced cluster)
    const goods = new THREE.InstancedMesh(produceGeo, produceMat, 10);
    goods.castShadow = true;
    const gtint = ["#d2402f", "#e88a2a", "#e3c020", "#5a9e3f", "#cf5a4a"];
    for (let i = 0; i < 10; i++) {
      dummy.position.set(-1.1 + (i % 5) * 0.55, 1.0, (i < 5 ? -0.3 : 0.3));
      dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      goods.setMatrixAt(i, dummy.matrix);
      goods.setColorAt(i, new THREE.Color(gtint[i % gtint.length]));
    }
    goods.instanceMatrix.needsUpdate = true;
    if (goods.instanceColor) goods.instanceColor.needsUpdate = true;
    stall.add(goods);
    // four corner posts + a striped canopy
    for (const px of [-1.4, 1.4]) for (const pz of [-0.6, 0.6]) {
      const post = new THREE.Mesh(awnPostGeo, poleMat);
      post.position.set(px, 1.1, pz); post.castShadow = true; stall.add(post);
    }
    const canopy = box(3.4, 0.1, 1.8, awnRed, false);
    canopy.position.set(0, 2.25, 0); canopy.castShadow = true; stall.add(canopy);
    stall.position.set(SX, 0, SZ);
    group.add(stall);
    addCollider(colliders, SX, SZ, 3.0, 1.4);

    // A couple of spare CRATE stacks dressing the verge corners.
    for (const [cx, cz] of [[-10.5, 16.4], [21.8, 18.0]]) {
      const cr1 = new THREE.Mesh(crateGeo, crateMat);
      cr1.position.set(cx, 0.4, cz); cr1.castShadow = true; cr1.receiveShadow = true; group.add(cr1);
      const cr2 = new THREE.Mesh(crateGeo, crateMat);
      cr2.position.set(cx + 0.25, 1.1, cz - 0.1); cr2.castShadow = true; group.add(cr2);
      addCollider(colliders, cx, cz, 1.1, 1.0);
    }
  }

  // STREET LAMPS lining the open verge so it reads as a real avenue at dusk. Posts
  // sit on the south verge (z≈15) and on the north sidewalk (z≈-9), all inside the
  // setback and clear of the driving lane (z∈[-7,14]).
  for (const [lx, lz] of [[-21, 15.0], [21, 15.0], [-18, -9.0], [18, -9.0]]) {
    const lamp = new THREE.Group();
    const pole = new THREE.Mesh(lampPoleGeo, poleMat);
    pole.position.set(0, 2.2, 0); pole.castShadow = true; lamp.add(pole);
    const arm = box(0.9, 0.1, 0.1, poleMat);
    arm.position.set(0.35, 4.3, 0); lamp.add(arm);
    const head = new THREE.Mesh(lampHeadGeo, lampShadeMat);
    head.position.set(0.7, 4.25, 0); lamp.add(head);
    lamp.position.set(lx, 0, lz);
    group.add(lamp);
    addCollider(colliders, lx, lz, 0.3, 0.3);
  }

  // ------------------------------------------------------------------------
  // update: cheap ambient animation, NO per-frame allocation.
  //   - storefront / hanging signs gently pulse their emissive (neon flicker)
  //   - the mall pylon sign rotates slowly
  let t = 0;
  const baseIntensities = signPanels.map((p) => p.material.emissiveIntensity ?? 0.6);
  function update(dt) {
    t += dt;
    for (let i = 0; i < signPanels.length; i++) {
      const flick = 0.5 + 0.18 * Math.sin(t * (2.0 + i * 0.7) + i);
      signPanels[i].material.emissiveIntensity = baseIntensities[i] * (0.85 + flick * 0.3);
    }
    pylonSign.rotation.y += dt * 0.5;
  }

  // The entire tile is walkable floor; buildings/props block via colliders.
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  return { group, colliders, ground, update };
}
