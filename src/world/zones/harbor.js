// HARBOR district — a 60x60m maritime tile centered on origin.
// Docks over a water slab, low-poly boats, a tall dockside crane (boom + cable),
// stacked bright shipping containers, bollards and a warehouse. One boat bobs.
//
// LOCAL coords: X in [-30,30], Z in [-30,30], ground (the dock deck) at y=0.
// The water sits a touch below the deck on the south half of the tile.

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

export function buildHarbor() {
  const group = new THREE.Group();
  const colliders = [];

  // ── Shared geometries (created ONCE, reused) ──────────────────────────────
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); // unit box, scaled per use
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12); // unit cylinder
  const bollardGeo = new THREE.CylinderGeometry(0.35, 0.42, 1.1, 10);
  const containerGeo = new THREE.BoxGeometry(6, 2.5, 2.5);

  // ── Shared materials (created ONCE, reused) ───────────────────────────────
  // Translucent animated harbour water: glossy, faintly metallic, slightly see-
  // through over a dark seabed. Colour + emissive shimmer in update(); the
  // surface verts swell with sine waves (no per-frame allocation).
  const matWater = new THREE.MeshStandardMaterial({
    color: "#1d6e8c", roughness: 0.18, metalness: 0.4,
    emissive: "#08303f", emissiveIntensity: 0.3,
    transparent: true, opacity: 0.85, flatShading: true,
    // DoubleSide so the single-sided water plane never vanishes / reads as a
    // 1px sliver when grazed edge-on or viewed from just below the surface
    // (the deck sits 0.5m above the water, so a player at the pier edge can
    // look across/under it).
    side: THREE.DoubleSide,
  });
  const matSeabed = new THREE.MeshStandardMaterial({ color: "#123642", roughness: 1 });
  const matDeck = new THREE.MeshStandardMaterial({ color: "#6f5a42", roughness: 0.95 });
  const matPlank = new THREE.MeshStandardMaterial({ color: "#8a7256", roughness: 0.95 });
  const matPile = new THREE.MeshStandardMaterial({ color: "#3a2c20", roughness: 1.0 });
  const matSteel = new THREE.MeshStandardMaterial({ color: "#9aa3ab", roughness: 0.6, metalness: 0.7 });
  const matDarkSteel = new THREE.MeshStandardMaterial({ color: "#42484f", roughness: 0.7, metalness: 0.6 });
  const matCraneYellow = new THREE.MeshStandardMaterial({ color: "#f4b21a", roughness: 0.55, metalness: 0.4 });
  const matWarehouse = new THREE.MeshStandardMaterial({ color: "#b7c2c9", roughness: 0.9 });
  const matRoof = new THREE.MeshStandardMaterial({ color: "#4a5a66", roughness: 0.85, metalness: 0.3 });
  const matBollard = new THREE.MeshStandardMaterial({ color: "#262b30", roughness: 0.85, metalness: 0.4 });
  const matHull1 = new THREE.MeshStandardMaterial({ color: "#c8412f", roughness: 0.7 });
  const matHull2 = new THREE.MeshStandardMaterial({ color: "#2f6fc8", roughness: 0.7 });
  const matHull3 = new THREE.MeshStandardMaterial({ color: "#e8e2d2", roughness: 0.8 });
  const matWood = new THREE.MeshStandardMaterial({ color: "#7a5a36", roughness: 0.9 });
  const matSail = new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 0.85, side: THREE.DoubleSide });
  const matSail2 = new THREE.MeshStandardMaterial({ color: "#d24b4b", roughness: 0.85, side: THREE.DoubleSide });
  const matFlag = new THREE.MeshStandardMaterial({ color: "#e7c84b", roughness: 0.7, side: THREE.DoubleSide });
  const matCleat = new THREE.MeshStandardMaterial({ color: "#1b1f23", roughness: 0.5, metalness: 0.7 });
  const matCable = new THREE.MeshStandardMaterial({ color: "#15191d", roughness: 0.9 });
  const matRope = new THREE.MeshStandardMaterial({ color: "#c9aa6a", roughness: 1 });
  const containerMats = [
    new THREE.MeshStandardMaterial({ color: "#d8483a", roughness: 0.8, metalness: 0.2 }),
    new THREE.MeshStandardMaterial({ color: "#2f9e58", roughness: 0.8, metalness: 0.2 }),
    new THREE.MeshStandardMaterial({ color: "#e0a52a", roughness: 0.8, metalness: 0.2 }),
    new THREE.MeshStandardMaterial({ color: "#3b6fb0", roughness: 0.8, metalness: 0.2 }),
    new THREE.MeshStandardMaterial({ color: "#8a4bb0", roughness: 0.8, metalness: 0.2 }),
  ];

  // small helper: a scaled, positioned box mesh added to the group
  function addBox(geo, mat, x, y, z, sx, sy, sz, shadow = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    if (shadow) { m.castShadow = true; m.receiveShadow = true; }
    group.add(m);
    return m;
  }

  // ── Water: south half of the tile, an animated plane just below the deck ──
  // A dark seabed sits under the translucent surface so the water reads as deep.
  const seabed = new THREE.Mesh(boxGeo, matSeabed);
  seabed.position.set(0, -1.4, 8);
  seabed.scale.set(60, 1.4, 44);
  seabed.receiveShadow = true;
  group.add(seabed);

  const waterGeo = new THREE.PlaneGeometry(60, 44, 24, 18);
  const water = new THREE.Mesh(waterGeo, matWater);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.5, 8); // covers Z in [-14, 30]
  water.receiveShadow = true;
  group.add(water);
  // Cache base heights so the swell animation never allocates.
  const waterPos = waterGeo.attributes.position;
  const waterBaseY = new Float32Array(waterPos.count);
  for (let i = 0; i < waterPos.count; i++) waterBaseY[i] = waterPos.getZ(i);

  // ── Dock deck: north strip + a pier running south over the water ──────────
  // North quay (solid land/dock surface)
  const quay = new THREE.Mesh(boxGeo, matDeck);
  quay.position.set(0, -0.05, -22);
  quay.scale.set(60, 0.5, 16); // Z in [-30, -14]
  quay.receiveShadow = true;
  group.add(quay);

  // Wide main pier deck extending south over the water (a car-drivable lane)
  const pier = new THREE.Mesh(boxGeo, matPlank);
  pier.position.set(-9, 0.02, 2);
  pier.scale.set(14, 0.4, 32); // X in [-16,-2], Z in [-14,18]
  pier.receiveShadow = true;
  group.add(pier);

  // Plank seams across the pier (flat decorative — NO collider)
  for (let i = 0; i < 4; i++) {
    addBox(boxGeo, matPile, -9, 0.21, -10 + i * 8, 13.6, 0.06, 0.25, false);
  }

  // Pier support piles (decorative posts under deck edge — small, walk-over-free
  // but visually below; no collider so the deck reads as solid floor)
  for (let i = 0; i < 4; i++) {
    const pz = -10 + i * 8;
    addBox(cylGeo, matPile, -15, -0.9, pz, 0.7, 1.8, 0.7, true);
    addBox(cylGeo, matPile, -3, -0.9, pz, 0.7, 1.8, 0.7, true);
  }

  // ── Warehouse (north-east corner) ─────────────────────────────────────────
  const whX = 16, whZ = -22, whW = 18, whD = 12, whH = 7;
  const warehouse = addBox(boxGeo, matWarehouse, whX, whH / 2 - 0.3, whZ, whW, whH, whD);
  // ridged roof
  addBox(boxGeo, matRoof, whX, whH - 0.3, whZ, whW + 0.6, 0.5, whD + 0.6);
  for (let i = 0; i < 6; i++) {
    addBox(boxGeo, matRoof, whX - whW / 2 + 1.6 + i * 2.9, whH + 0.1, whZ, 0.4, 0.5, whD + 0.6, false);
  }
  colliders.push({ minX: whX - whW / 2, maxX: whX + whW / 2, minZ: whZ - whD / 2, maxZ: whZ + whD / 2 });

  // Warehouse signage billboard on the south face
  const whSign = artPanel(8, 2.4, "sign", {
    text: "HARBOR FREIGHT CO",
    bg: "#1d6e8c",
    fg: "#ffd23f",
    file: "harbor-warehouse.png",
    emissiveIntensity: 0.5,
  });
  whSign.position.set(whX, 4.6, whZ - whD / 2 - 0.06);
  group.add(whSign);

  // ── Stacked shipping containers (north-west, a bright colorful block) ─────
  // Two ground rows + a partial second tier. Tight collider on the stack base.
  const stackX = -18, stackZ = -22;
  const place = [
    // [dx, tier, dz, colorIndex]
    [0, 0, 0, 0], [0, 0, 3, 1], [0, 0, 6, 2],
    [7, 0, 0, 3], [7, 0, 3, 4], [7, 0, 6, 0],
    [0, 1, 0, 4], [0, 1, 3, 3], [0, 1, 6, 1],
    [7, 1, 1.5, 2], [3.5, 1, 4.5, 0],
    [0, 2, 1.5, 1], [7, 2, 4.5, 4], // a taller, more jumbled third tier
  ];
  // Thin recessed end-doors give each container ribbed-box detail cheaply.
  const doorGeo = new THREE.BoxGeometry(0.06, 2.1, 2.1);
  const doorMat = new THREE.MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.85 });
  for (const [dx, tier, dz, ci] of place) {
    const px = stackX + dx - 3.5, py = 1.25 + tier * 2.55, pz = stackZ + dz - 3;
    const m = new THREE.Mesh(containerGeo, containerMats[ci]);
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    const door = new THREE.Mesh(doorGeo, doorMat);
    // Push the door panel proud of the container's +X face (face is at px+3.0)
    // so its 0.06-thick box sits fully on the surface and never z-fights /
    // flickers as a thin line where it was previously centred on the face plane.
    door.position.set(px + 3.04, py, pz);
    group.add(door);
  }
  colliders.push({ minX: stackX - 4, maxX: stackX + 6.5, minZ: stackZ - 4.5, maxZ: stackZ + 5 });

  // ── Dockside crane (tall): tower + boom + hanging cable & hook ─────────────
  const craneBaseX = 6, craneBaseZ = -14;
  // base block
  addBox(boxGeo, matDarkSteel, craneBaseX, 0.6, craneBaseZ, 3, 1.6, 3);
  colliders.push({ minX: craneBaseX - 1.8, maxX: craneBaseX + 1.8, minZ: craneBaseZ - 1.8, maxZ: craneBaseZ + 1.8 });
  // tower mast
  const towerH = 16;
  addBox(boxGeo, matCraneYellow, craneBaseX, 1.4 + towerH / 2, craneBaseZ, 1.4, towerH, 1.4);
  // operator cab near top
  addBox(boxGeo, matDarkSteel, craneBaseX, towerH + 0.4, craneBaseZ + 1.2, 1.8, 1.8, 1.8);
  // horizontal boom reaching out over the water (toward +Z / south)
  const boomLen = 18;
  const boom = addBox(boxGeo, matCraneYellow, craneBaseX, towerH + 1.6, craneBaseZ + boomLen / 2 - 1, 1.0, 1.0, boomLen);
  // short counter-jib backward
  addBox(boxGeo, matCraneYellow, craneBaseX, towerH + 1.6, craneBaseZ - 3, 1.0, 1.0, 6);
  addBox(boxGeo, matDarkSteel, craneBaseX, towerH + 0.4, craneBaseZ - 5.6, 1.6, 2.0, 1.6); // counterweight

  // Hanging cable + hook (these animate). Cable is a thin tall cylinder.
  const cableTopY = towerH + 1.1;
  const cable = new THREE.Mesh(cylGeo, matCable);
  const hookZ = craneBaseZ + boomLen - 3; // out over the water
  cable.scale.set(0.08, 1, 0.08);
  cable.position.set(craneBaseX, cableTopY - 3, hookZ);
  cable.castShadow = false;
  group.add(cable);
  const hook = new THREE.Mesh(boxGeo, matSteel);
  hook.scale.set(0.9, 0.9, 0.9);
  hook.castShadow = true;
  group.add(hook);
  // a slung container hanging from the hook (animated together)
  const slung = new THREE.Mesh(containerGeo, containerMats[2]);
  slung.scale.set(0.55, 0.55, 0.55);
  slung.castShadow = true;
  group.add(slung);

  // ── Bollards along the pier & quay edge (decorative posts, no colliders) ──
  const bollardSpots = [
    [-16.4, -8], [-16.4, 2], [-16.4, 12],
    [-1.6, -8], [-1.6, 2], [-1.6, 12],
  ];
  for (const [bx, bz] of bollardSpots) {
    addBox(bollardGeo, matBollard, bx, 0.55, bz, 1, 1, 1, true);
    // A coiled mooring rope at the base of each bollard (flat decorative torus).
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.12, 6, 12), matRope);
    coil.rotation.x = -Math.PI / 2;
    coil.position.set(bx, 0.06, bz);
    group.add(coil);
  }

  // ── Dock cleats: low T-shaped steel mooring fittings between the bollards ──
  // A small reusable cleat = a horizontal bar on two stubby feet.
  const cleatBarGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 8);
  const cleatFootGeo = new THREE.CylinderGeometry(0.14, 0.18, 0.32, 8);
  function addCleat(x, z) {
    const bar = new THREE.Mesh(cleatBarGeo, matCleat);
    bar.rotation.x = Math.PI / 2; // lie along Z, parallel to the pier edge
    bar.position.set(x, 0.42, z);
    bar.castShadow = true;
    group.add(bar);
    for (const dz of [-0.4, 0.4]) {
      const foot = new THREE.Mesh(cleatFootGeo, matCleat);
      foot.position.set(x, 0.22, z + dz);
      group.add(foot);
    }
  }
  for (const z of [-3, 7]) { addCleat(-16.4, z); addCleat(-1.6, z); }

  // ── Boats / sailboats floating on the water (3 of them) ───────────────────
  // Reusable hull builder: a low-poly hull = box + tapered bow proxy.
  function makeBoat(hullMat, withSail, sailMat) {
    const b = new THREE.Group();
    // hull
    const hull = new THREE.Mesh(boxGeo, hullMat);
    hull.scale.set(2.6, 1.0, 6.2);
    hull.position.y = 0.1;
    hull.castShadow = true;
    b.add(hull);
    // tapered bow wedge so the boat reads as pointed rather than a brick
    const bow = new THREE.Mesh(boxGeo, hullMat);
    bow.scale.set(2.6, 1.0, 1.4);
    bow.position.set(0, 0.1, 3.5);
    bow.rotation.x = 0.5;
    bow.castShadow = true;
    b.add(bow);
    // waterline trim stripe
    const trim = new THREE.Mesh(boxGeo, matHull3);
    trim.scale.set(2.66, 0.18, 6.3);
    trim.position.set(0, 0.55, 0);
    b.add(trim);
    // cabin / deck block
    const cabin = new THREE.Mesh(boxGeo, matHull3);
    cabin.scale.set(1.8, 0.9, 2.4);
    cabin.position.set(0, 0.85, -0.6);
    cabin.castShadow = true;
    b.add(cabin);
    if (withSail) {
      const mast = new THREE.Mesh(cylGeo, matWood);
      mast.scale.set(0.12, 5.5, 0.12);
      mast.position.set(0, 2.7, 0.4);
      b.add(mast);
      // horizontal boom along the bottom of the sail
      const boom = new THREE.Mesh(cylGeo, matWood);
      boom.scale.set(0.09, 3.4, 0.09);
      boom.rotation.x = Math.PI / 2;
      boom.position.set(0.06, 0.95, 1.6);
      b.add(boom);
      // main sail (a flag-like group so update() can luff it gently)
      const sailPivot = new THREE.Group();
      sailPivot.position.set(0.05, 0.9, 0.45);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.2, 4, 1), sailMat || matSail);
      sail.position.set(0, 1.8, 1.2);
      sail.rotation.y = Math.PI / 2;
      sailPivot.add(sail);
      b.add(sailPivot);
      b.userData.sail = sail;
      // jib (small triangular foresail proxy)
      const jib = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.2), matSail);
      jib.position.set(0.05, 2.4, -0.9);
      jib.rotation.y = Math.PI / 2;
      b.add(jib);
      // pennant flag at the masthead
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), matFlag);
      flag.position.set(0, 5.4, 0.85);
      flag.rotation.y = Math.PI / 2;
      b.add(flag);
      b.userData.flag = flag;
    } else {
      // small wheelhouse mast/antenna
      const mast = new THREE.Mesh(cylGeo, matWood);
      mast.scale.set(0.1, 3, 0.1);
      mast.position.set(0, 2.2, -0.6);
      b.add(mast);
      // funnel + flag for the tug
      const funnel = new THREE.Mesh(cylGeo, matHull1);
      funnel.scale.set(0.45, 1.1, 0.45);
      funnel.position.set(0, 1.7, -1.4);
      funnel.castShadow = true;
      b.add(funnel);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), matFlag);
      flag.position.set(0, 3.6, -0.6);
      flag.rotation.y = Math.PI / 2;
      b.add(flag);
      b.userData.flag = flag;
    }
    return b;
  }

  const boatA = makeBoat(matHull1, false); // tug — this one bobs
  boatA.position.set(-22, -0.1, 6);
  boatA.rotation.y = 0.25;
  group.add(boatA);

  const boatB = makeBoat(matHull2, true, matSail2); // sailboat with a red sail
  boatB.position.set(8, -0.1, 16);
  boatB.rotation.y = -0.5;
  group.add(boatB);

  const boatC = makeBoat(matHull3, true, matSail); // sailboat with a white sail
  boatC.position.set(-2, -0.1, 24);
  boatC.rotation.y = 1.9;
  group.add(boatC);

  // Floating dock buoys (small decorative spheres-as-boxes; no collider)
  const buoyMat = new THREE.MeshStandardMaterial({ color: "#e23b3b", roughness: 0.6, flatShading: true });
  for (let i = 0; i < 3; i++) {
    addBox(cylGeo, buoyMat, 18 + i * 3, -0.2, 6 + i * 4, 0.7, 0.9, 0.7, false);
  }

  // ── ground: whole tile is walkable floor ──────────────────────────────────
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  // ── update: gentle boat bob + sway, swinging hook/cable, glinting water ───
  let t = 0;
  const boatABaseY = boatA.position.y;
  const boatBBaseY = boatB.position.y;
  const boatCBaseY = boatC.position.y;
  function update(dt) {
    t += dt;

    // Animated sea: swell the surface verts with crossed sine waves, then let
    // the recomputed normals catch the light so crests glint.
    for (let i = 0; i < waterPos.count; i++) {
      const x = waterPos.getX(i);
      const y = waterPos.getY(i);
      const h = Math.sin(x * 0.2 + t * 1.2) * 0.18
              + Math.cos(y * 0.28 - t * 0.85) * 0.13
              + Math.sin((x - y) * 0.45 + t * 2.0) * 0.05;
      waterPos.setZ(i, waterBaseY[i] + h);
    }
    waterPos.needsUpdate = true;
    waterGeo.computeVertexNormals();
    // Colour/emissive shimmer between deep teal and a brighter sunlit blue.
    const shimmer = (Math.sin(t * 0.7) + 1) * 0.5; // 0..1
    matWater.emissiveIntensity = 0.24 + shimmer * 0.2;
    matWater.color.setRGB(0.1 + shimmer * 0.05, 0.42 + shimmer * 0.08, 0.55 + shimmer * 0.08);

    // boatA bobs noticeably (the called-for gentle bob)
    boatA.position.y = boatABaseY + Math.sin(t * 1.3) * 0.18;
    boatA.rotation.z = Math.sin(t * 1.0) * 0.05;
    boatA.rotation.x = Math.sin(t * 0.8 + 1) * 0.04;
    // other boats sway subtly
    boatB.position.y = boatBBaseY + Math.sin(t * 1.0 + 1.7) * 0.12;
    boatB.rotation.z = Math.sin(t * 0.9 + 0.5) * 0.04;
    boatB.rotation.x = Math.sin(t * 0.7 + 2.0) * 0.03;
    boatC.position.y = boatCBaseY + Math.sin(t * 1.15 + 3.1) * 0.1;
    boatC.rotation.z = Math.sin(t * 0.7 + 2.2) * 0.035;
    boatC.rotation.x = Math.sin(t * 0.6 + 0.4) * 0.025;

    // Sails belly in the wind and pennant flags flutter.
    const luff = Math.sin(t * 1.4) * 0.12;
    if (boatB.userData.sail) boatB.userData.sail.rotation.y = Math.PI / 2 + luff;
    if (boatC.userData.sail) boatC.userData.sail.rotation.y = Math.PI / 2 - luff;
    for (const b of [boatA, boatB, boatC]) {
      if (b.userData.flag) b.userData.flag.rotation.z = Math.sin(t * 4 + b.position.x) * 0.25;
    }

    // crane hook + slung container swing along the boom slightly
    const swing = Math.sin(t * 0.6) * 1.4;
    const hookY = cableTopY - 6 - Math.sin(t * 0.6) * 0.5;
    hook.position.set(craneBaseX, hookY, hookZ + swing);
    cable.position.set(craneBaseX, (cableTopY + hookY) / 2 + 0.3, hookZ + swing * 0.5);
    cable.scale.y = (cableTopY - hookY);
    slung.position.set(craneBaseX, hookY - 1.1, hookZ + swing);
    slung.rotation.y = Math.sin(t * 0.5) * 0.2;
  }

  return { group, colliders, ground, update };
}
