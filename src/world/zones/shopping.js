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
//   Storefronts:  back wall along z ≈ -22, fronts facing +Z, x ∈ [-24, 24]
//   Arcade:       columns at z ≈ -19.4 (covered walkway, gaps clear to walk)
//   Sidewalk:     z ∈ [-18, -8]   (planters, benches, bins, bollards, bus stop)
//   Open street:  z ∈ [-7, 14]    (>= 6m clear lane through the tile, no colliders)
//   South verge:  z ∈ [14, 30]    (a couple of planters near the far corners)
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

// One storefront BAY: bulkhead riser, recessed door, big display window,
// glass apron + flat roof parapet trim. (width is the bay's full span.)
function makeShopBay(width, wallMat) {
  const g = new THREE.Group();
  const H = 8;            // two storeys tall now
  const GF = 3.4;         // ground-floor height
  // main wall slab (full height)
  const wall = box(width, H, 0.4, wallMat);
  wall.position.set(0, H / 2, 0);
  g.add(wall);
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
  // parapet trim cap across the roofline
  const trim = box(width + 0.2, 0.6, 0.6, trimMat);
  trim.position.set(0, H + 0.2, 0.1);
  g.add(trim);
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
  const Z_FRONT = -21.8;   // front face of the storefront walls
  const units = [
    { x: -16, w: 16, wall: wallA, awn: awnRed,   sign: "MALL", bg: "#b8402f", emis: "#ff5a3c", bays: 3 },
    { x:   1, w: 13, wall: wallB, awn: awnTeal,  sign: "MART", bg: "#1f7a73", emis: "#3fe0d4", bays: 3 },
    { x:  16, w: 14, wall: wallC, awn: awnAmber, sign: "CAFE", bg: "#caa24a", emis: "#ffd070", bays: 3 },
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

  for (const u of units) {
    const bayW = u.w / u.bays;
    const left = u.x - u.w / 2;

    // individual shop bays across the unit's span
    for (let b = 0; b < u.bays; b++) {
      const bx = left + bayW * (b + 0.5);
      const bay = makeShopBay(bayW - 0.12, u.wall);
      bay.position.set(bx, 0, Z_FRONT - 0.2);
      group.add(bay);

      // striped awning over each bay's shopfront
      const awn = makeAwning(bayW - 0.5, u.awn);
      awn.position.set(bx, 3.2, Z_FRONT + 0.85);
      group.add(awn);

      // small hanging artPanel "sign" projecting from each bay (perpendicular)
      const hangSign = artPanel(1.0, 0.7, "sign", {
        text: ["SHOP", "SALE", "OPEN", "DELI", "GIFTS", "WEAR", "FOOD", "BOOKS", "TOYS"][(ci + b) % 9],
        bg: u.bg, fg: "#ffffff", emissiveIntensity: 0.4,
        file: `shop-hang-${u.sign.toLowerCase()}-${b}.png`,
      });
      hangSign.rotation.y = Math.PI / 2;            // face down the sidewalk (±X)
      hangSign.position.set(bx + bayW / 2 - 0.1, 2.7, Z_FRONT + 0.95);
      hangSign.castShadow = false;
      group.add(hangSign);
      signPanels.push(hangSign);

      // upper-floor windows for this bay (instanced panes + frames)
      for (let r = 0; r < UP_ROWS; r++) {
        const wy = 6.0;
        for (const wx of [bx - bayW * 0.22, bx + bayW * 0.22]) {
          dummy.position.set(wx, wy, Z_FRONT - 0.12);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          winPanes.setMatrixAt(wi, dummy.matrix);
          dummy.position.z = Z_FRONT + 0.0;
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

    // solid footprint collider for the whole unit (tight to wall + window depth)
    addCollider(colliders, u.x, Z_FRONT - 0.2, u.w, 1.2);

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

  // --- Rooftop clutter on the storefront block (visual only, atop the parapet) -
  const rooftop = new THREE.Group();
  // a few AC condenser units + vent pipes scattered on the roof (y≈8.4)
  for (const [rx, rz] of [[-18, -22.4], [-12, -23.1], [2, -22.6], [18, -23.0]]) {
    const ac = new THREE.Mesh(acGeo, metalMat);
    ac.position.set(rx, 8.55, rz);
    ac.castShadow = true;
    rooftop.add(ac);
  }
  for (const [px, pz] of [[-8, -22.8], [6, -23.2], [20, -22.7]]) {
    const pipe = new THREE.Mesh(pipeGeo, metalMat);
    pipe.position.set(px, 9.0, pz);
    pipe.castShadow = true;
    rooftop.add(pipe);
  }
  // a small water tank on a low cradle
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 12), metalMat);
  tank.position.set(-20, 9.1, -23.2);
  tank.castShadow = true;
  rooftop.add(tank);
  // a thin antenna mast
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.0, 6), poleMat);
  antenna.position.set(10, 9.9, -23.4);
  antenna.castShadow = true;
  rooftop.add(antenna);
  rooftop.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  group.add(rooftop);

  // --- Mall entrance: a raised glass portal + rotating pylon sign ------------
  // Portal sits at the MALL unit; pylon stands on the sidewalk in front of it.
  const portal = box(5, 4, 0.3, glass);
  portal.position.set(-16, 2, Z_FRONT + 0.05);
  portal.castShadow = false;
  group.add(portal);
  const portalFrame = box(5.6, 0.5, 0.5, trimMat);
  portalFrame.position.set(-16, 4.1, Z_FRONT + 0.05);
  group.add(portalFrame);

  // Rotating pylon sign (totem) — billboard text on a pole, spins slowly.
  const pylonPole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 6, 10), poleMat);
  pylonPole.position.set(-16, 3, -16.5);
  pylonPole.castShadow = true;
  group.add(pylonPole);
  const pylonSign = artPanel(2.6, 3.4, "billboard", {
    title: "MALL", sub: "OPEN", a: "#1f3f7a", b: "#0c1830", accent: "#ffcf3f", glyph: "★",
    emissiveIntensity: 0.5, file: "mall-pylon.png",
  });
  pylonSign.position.set(-16, 5.4, -16.5);
  group.add(pylonSign);
  addCollider(colliders, -16, -16.5, 0.6, 0.6);

  // --- Sidewalk planters lining the storefront row --------------------------
  const planterXs = [-24, 0, 23];
  for (const x of planterXs) {
    const p = makePlanter();
    p.position.set(x, 0, -17.5);
    group.add(p);
    addCollider(colliders, x, -17.5, 1.3, 1.3);
  }
  // a couple near the far (south) corners so the open street stays clear
  for (const x of [-24, 24]) {
    const p = makePlanter();
    p.position.set(x, 0, 24);
    group.add(p);
    addCollider(colliders, x, 24, 1.3, 1.3);
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
  for (let x = -26; x <= 26; x += 4) {
    // skip the central span so the open lane reads unobstructed
    if (Math.abs(x) < 4) continue;
    bollardXs.push(x);
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
  shelter.position.set(22, 0, -10.5);
  group.add(shelter);
  addCollider(colliders, 22, -11, 4, 1.8);

  // Bus-stop sign post by the shelter.
  const stopPole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 8), poleMat);
  stopPole.position.set(19, 1.5, -9);
  stopPole.castShadow = true;
  group.add(stopPole);
  const stopSign = artPanel(1.1, 1.1, "sign", {
    text: "BUS", bg: "#1f4fa0", fg: "#ffffff", emissiveIntensity: 0.45, file: "bus-stop.png",
  });
  stopSign.position.set(19, 2.7, -9);
  group.add(stopSign);

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
