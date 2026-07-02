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

  // ── Warehouse (north-east of the quay) ────────────────────────────────────
  // SET BACK ~7m from every tile edge: footprint X[9,23] Z[-23,-14] sits clear
  // of the road grid on the seams (X=±30 → road; Z=-30 → cross-street). Modestly
  // narrowed (18→14) and shallowed (12→9) from its over-large size so it clears
  // the road yet stays a full 7m-tall solid mass. Front still faces the quay (+Z).
  const whX = 16, whZ = -18.5, whW = 14, whD = 9, whH = 7;
  const warehouse = addBox(boxGeo, matWarehouse, whX, whH / 2 - 0.3, whZ, whW, whH, whD);
  // ridged roof
  addBox(boxGeo, matRoof, whX, whH - 0.3, whZ, whW + 0.6, 0.5, whD + 0.6);
  for (let i = 0; i < 6; i++) {
    addBox(boxGeo, matRoof, whX - whW / 2 + 1.4 + i * 2.25, whH + 0.1, whZ, 0.4, 0.5, whD + 0.6, false);
  }
  colliders.push({ minX: whX - whW / 2, maxX: whX + whW / 2, minZ: whZ - whD / 2, maxZ: whZ + whD / 2 });

  // Warehouse FRONT faces the open dock/quay to the SOUTH (+Z), the side the
  // player roams (pier, crane, boats). The big mass + roof are BEHIND this face.
  // ── Signage billboard, mounted proud of the south face, normal pointing +Z so
  // its readable front looks OUT over the dock (artPanel faces +Z by default, so
  // NO rotation — a 180° turn here would show the player the mirrored back).
  const whFrontZ = whZ + whD / 2; // south wall plane, z = -16
  const whSign = artPanel(8, 2.4, "sign", {
    text: "HARBOR FREIGHT CO",
    bg: "#1d6e8c",
    fg: "#ffd23f",
    file: "harbor-warehouse.png",
    emissiveIntensity: 0.5,
  });
  whSign.position.set(whX, 5.0, whFrontZ + 0.06);
  group.add(whSign);

  // Storefront detail on the same south face so the building reads as a FRONT:
  // a wide roll-up cargo door (the entrance), flanking windows, and a canopy
  // over the door. All sit just proud of the wall (≤0.25m) so the footprint
  // collider is unchanged.
  const matWhDoor = new THREE.MeshStandardMaterial({ color: "#3c4a52", roughness: 0.75, metalness: 0.3 });
  const matWhWin = new THREE.MeshStandardMaterial({ color: "#bfe2ea", roughness: 0.25, metalness: 0.2, emissive: "#22333a", emissiveIntensity: 0.3 });
  const matWhTrim = new THREE.MeshStandardMaterial({ color: "#8a949b", roughness: 0.8 });
  // Big roll-up loading door = the entrance, centred on the front.
  addBox(boxGeo, matWhDoor, whX, 1.85, whFrontZ + 0.08, 4.6, 3.7, 0.16, false);
  // Door guide rails + lintel for a tidy framed entrance.
  for (const dx of [-2.45, 2.45]) addBox(boxGeo, matWhTrim, whX + dx, 1.85, whFrontZ + 0.1, 0.25, 3.9, 0.18, false);
  addBox(boxGeo, matWhTrim, whX, 3.85, whFrontZ + 0.1, 5.2, 0.3, 0.2, false);
  // Two window strips flanking the door.
  for (const dx of [-6.0, 6.0]) addBox(boxGeo, matWhWin, whX + dx, 2.4, whFrontZ + 0.08, 3.2, 1.6, 0.12, false);
  // A flat canopy/awning shading the cargo door (shallow, stays over the quay).
  addBox(boxGeo, matRoof, whX, 4.0, whFrontZ + 0.85, 6.0, 0.25, 1.6, false);
  for (const dx of [-2.7, 2.7]) addBox(cylGeo, matWhTrim, whX + dx, 3.55, whFrontZ + 1.5, 0.12, 0.9, 0.12, false);

  // ── Dockside buildings filling the open quay ──────────────────────────────
  // The harbour previously had a single full-size building (the warehouse) and a
  // lot of empty quay. Add two more SUBSTANTIAL buildings — each a real 3D mass
  // with proper WIDTH *and* DEPTH *and* HEIGHT (no thin facades / standing cards)
  // — so the dock reads as a proper port block from every angle. Each front (sign,
  // door, windows, canopy) faces +Z out over the open quay, the side the player
  // approaches from, using artPanel (which faces +Z by default → no mirrored text).
  //
  // Shared materials for the new masonry buildings (reuse the warehouse facade
  // mats above so we add no per-building material churn).
  const matBldgA = new THREE.MeshStandardMaterial({ color: "#9fb0a6", roughness: 0.9 });
  const matBldgB = new THREE.MeshStandardMaterial({ color: "#c2a878", roughness: 0.92 });
  const matBldgRoof = new THREE.MeshStandardMaterial({ color: "#384650", roughness: 0.85, metalness: 0.3 });

  // Window InstancedMesh shared across the new buildings' fronts (one draw call).
  // A flat lit pane sitting proud of a wall; we fill the matrices below.
  const winGeo = new THREE.BoxGeometry(1.5, 1.3, 0.16);
  const bldgWindows = []; // { x, y, z } collected, baked into an InstancedMesh

  // Build one full-volume building with a +Z-facing front. Returns the collider.
  function makeDockBuilding(cx, cz, w, d, h, bodyMat, signOpts) {
    const frontZ = cz + d / 2;           // south wall plane (faces the open quay)
    // Solid body — a true box volume (w × h × d), reads solid from all sides.
    addBox(boxGeo, bodyMat, cx, h / 2 - 0.3, cz, w, h, d);
    // Roof cap + a slim parapet so the silhouette isn't a bare cube.
    addBox(boxGeo, matBldgRoof, cx, h - 0.3, cz, w + 0.5, 0.5, d + 0.5);
    addBox(boxGeo, matBldgRoof, cx, h + 0.05, frontZ - 0.1, w + 0.5, 0.6, 0.4, false); // front parapet lip
    // Sign mounted proud of the front, normal +Z (readable from the quay).
    const sign = artPanel(Math.min(w - 1.2, 7), 1.8, "sign", signOpts);
    sign.position.set(cx, h - 1.6, frontZ + 0.07);
    group.add(sign);
    // Ground-floor entrance: a recessed door centred on the front.
    addBox(boxGeo, matWhDoor, cx, 1.7, frontZ + 0.08, 2.6, 3.4, 0.16, false);
    for (const dx of [-1.5, 1.5]) addBox(boxGeo, matWhTrim, cx + dx, 1.7, frontZ + 0.1, 0.25, 3.6, 0.18, false);
    addBox(boxGeo, matWhTrim, cx, 3.55, frontZ + 0.1, 3.2, 0.3, 0.2, false);
    // Front windows (collected for the shared InstancedMesh) — a tidy 2-column
    // grid flanking the door, on each floor the building is tall enough for.
    const floors = Math.max(1, Math.floor((h - 2.0) / 2.4));
    for (let f = 0; f < floors; f++) {
      const wy = 2.4 + f * 2.4;
      if (wy + 0.8 > h - 0.3) break;
      for (const dx of [-w / 2 + 1.6, w / 2 - 1.6]) {
        bldgWindows.push({ x: cx + dx, y: wy, z: frontZ + 0.08 });
      }
    }
    // A shallow front canopy over the door (stays within ~1.4m of the wall, well
    // clear of the road/walk lanes south of the quay).
    addBox(boxGeo, matBldgRoof, cx, 3.7, frontZ + 0.8, 3.6, 0.22, 1.4, false);
    for (const dx of [-1.6, 1.6]) addBox(cylGeo, matWhTrim, cx + dx, 3.2, frontZ + 1.4, 0.1, 0.9, 0.1, false);
    return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
  }

  // Building 1 — Port Authority / Harbour Master's office (2-storey block).
  // SET BACK onto the quay band Z[-23,-14] (depth trimmed 11→9): footprint
  // X[-8,2] Z[-23,-14] clears the road grid (north cross-street on the Z=-30
  // seam) while staying a full 8m-tall solid block. Front faces the quay (+Z).
  // Sits in the gap between the container stack (west) and the crane (X 4.2–7.8).
  colliders.push(makeDockBuilding(-3, -18.5, 10, 9, 8, matBldgA, {
    text: "PORT AUTHORITY", bg: "#13414f", fg: "#ffe08a",
    file: "harbor-port-authority.png", emissiveIntensity: 0.5,
  }));

  // Building 2 — Ship Chandlery storefront with REAL depth (not a card): a full
  // 7×9×6.5m volume tucked into the west end of the quay.
  // SET BACK to footprint X[-23,-16] Z[-23,-14]: hugs the west road kerb (X=-30
  // seam) at minX -23 and the north cross-street (Z=-30 seam) at minZ -23, fully
  // clearing both roads + sidewalks. Front faces the quay (+Z).
  colliders.push(makeDockBuilding(-19.5, -18.5, 7, 9, 6.5, matBldgB, {
    text: "SHIP CHANDLERY", bg: "#5a3a22", fg: "#ffd23f",
    file: "harbor-chandlery.png", emissiveIntensity: 0.5,
  }));

  // Bake the collected front windows into a single InstancedMesh (one draw call).
  if (bldgWindows.length) {
    const inst = new THREE.InstancedMesh(winGeo, matWhWin, bldgWindows.length);
    inst.castShadow = false;
    inst.receiveShadow = false;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < bldgWindows.length; i++) {
      const wpt = bldgWindows[i];
      m4.makeTranslation(wpt.x, wpt.y, wpt.z);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // ── Stacked shipping containers (a bright colorful block on the quay) ─────
  // SET BACK into the quay gap between the Chandlery (maxX -16) and the Port
  // Authority (minX -8): a compact single-X-column stack at X≈[-15,-9], rows in
  // Z and tiers in Y, all inside the road-clear band X,Z∈[-23,-14]. Each 6m-long
  // container (X) faces its door +X toward the lane. Tight collider on the base.
  const stackX = -12, stackZ = -18.5;
  const place = [
    // [dx, tier, dz, colorIndex] — containers are 6(X)×2.5(Y)×2.5(Z)
    [0, 0, -3, 0], [0, 0, 0, 1], [0, 0, 3, 2],
    [0, 1, -3, 4], [0, 1, 0, 3], [0, 1, 3, 1],
    [0, 2, -1.5, 2], [0, 2, 1.5, 4], // a taller, jumbled third tier
  ];
  // Thin recessed end-doors give each container ribbed-box detail cheaply.
  const doorGeo = new THREE.BoxGeometry(0.06, 2.1, 2.1);
  const doorMat = new THREE.MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.85 });
  for (const [dx, tier, dz, ci] of place) {
    const px = stackX + dx, py = 1.25 + tier * 2.55, pz = stackZ + dz;
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
  // Base footprint collider: X[-15.5,-8.5] Z[-22.5,-14.5] — inside [-23,23].
  colliders.push({ minX: stackX - 3.5, maxX: stackX + 3.5, minZ: stackZ - 4, maxZ: stackZ + 4 });

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

  // ── ENTERABLE BAIT & TACKLE SHACK (a real walk-in interior) ───────────────
  // A small chandlery/bait shop on the pier deck the player can walk INTO. It is
  // ADDITIVE (its own 4 walls + floor + roof), tucked onto the open pier deck in
  // the SW quad so it clears the quay buildings, the crane and the bollard/cleat
  // line. Footprint X[-13,-5] Z[2.75,9.25] (8m wide × 6.5m deep) sits squarely on
  // the plank deck (X[-16,-2] Z[-14,18]) between the pier piles at X=-15/-3, all
  // well inside X,Z ∈ [-23,23]. The FRONT (door gap + sign) faces +Z toward the
  // open south end of the pier — artPanel faces +Z by default, so the sign reads
  // un-mirrored with NO rotation.
  {
    const shX = -9;            // shop centre X
    const shZ = 6;             // shop centre Z
    const shW = 8;             // interior+wall span in X (X[-13,-5])
    const shD = 6.5;           // span in Z (Z[2.75,9.25])
    const wallT = 0.25;        // wall thickness
    const wallH = 3.2;         // wall height
    const floorY = 0.22;       // pier deck top
    const frontZ = shZ + shD / 2;  // +Z wall plane (street/pier-facing front)
    const backZ = shZ - shD / 2;
    const leftX = shX - shW / 2;   // -13
    const rightX = shX + shW / 2;  // -5
    const doorW = 2.2;             // doorway gap width in the front wall

    // Shop-specific materials (created ONCE, reused across the room).
    const matShopWall = new THREE.MeshStandardMaterial({ color: "#5d7c84", roughness: 0.95 });
    const matShopWallIn = new THREE.MeshStandardMaterial({ color: "#7d9aa0", roughness: 0.95, side: THREE.DoubleSide });
    const matShopFloor = new THREE.MeshStandardMaterial({ color: "#7a6244", roughness: 0.96 });
    const matShopRoof = new THREE.MeshStandardMaterial({ color: "#39474f", roughness: 0.85, metalness: 0.3 });
    const matShopTrim = new THREE.MeshStandardMaterial({ color: "#274049", roughness: 0.8 });
    const matCounter = new THREE.MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.85 });
    const matCounterTop = new THREE.MeshStandardMaterial({ color: "#caa86a", roughness: 0.5, metalness: 0.2 });
    const matShelf = new THREE.MeshStandardMaterial({ color: "#8a6a44", roughness: 0.9 });
    const matRug = new THREE.MeshStandardMaterial({ color: "#3f6b6e", roughness: 1 });
    const matStool = new THREE.MeshStandardMaterial({ color: "#2c3a40", roughness: 0.7, metalness: 0.3 });
    const matGlass = new THREE.MeshStandardMaterial({ color: "#bfe2ea", roughness: 0.2, metalness: 0.2, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    const matLamp = new THREE.MeshStandardMaterial({ color: "#ffe9b0", emissive: "#ffcf6a", emissiveIntensity: 0.9, roughness: 0.6 });
    const matProd = [
      new THREE.MeshStandardMaterial({ color: "#c8412f", roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: "#2f9e58", roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: "#e0a52a", roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: "#3b6fb0", roughness: 0.8 }),
    ];

    // FLOOR slab (its own walkable surface; ground rect already covers the tile).
    addBox(boxGeo, matShopFloor, shX, floorY + 0.02, shZ, shW, 0.1, shD);

    // ── WALLS (each a box mesh) + matching individual AABB colliders ──────────
    // Back wall (−Z), full width.
    addBox(boxGeo, matShopWall, shX, floorY + wallH / 2, backZ, shW, wallH, wallT);
    colliders.push({ minX: leftX, maxX: rightX, minZ: backZ - wallT / 2, maxZ: backZ + wallT / 2 });
    // Left side wall (−X), full depth.
    addBox(boxGeo, matShopWall, leftX, floorY + wallH / 2, shZ, wallT, wallH, shD);
    colliders.push({ minX: leftX - wallT / 2, maxX: leftX + wallT / 2, minZ: backZ, maxZ: frontZ });
    // Right side wall (+X), full depth.
    addBox(boxGeo, matShopWall, rightX, floorY + wallH / 2, shZ, wallT, wallH, shD);
    colliders.push({ minX: rightX - wallT / 2, maxX: rightX + wallT / 2, minZ: backZ, maxZ: frontZ });
    // FRONT wall (+Z) split into two short segments flanking a 2.2m doorway GAP.
    // segWidth on each side of the centred door; NO collider spans the gap, so
    // the player walks straight through the door into the interior.
    const segW = (shW - doorW) / 2; // 2.9m each
    const segLcx = leftX + segW / 2;   // centre of left front segment
    const segRcx = rightX - segW / 2;  // centre of right front segment
    addBox(boxGeo, matShopWall, segLcx, floorY + wallH / 2, frontZ, segW, wallH, wallT);
    colliders.push({ minX: leftX, maxX: leftX + segW, minZ: frontZ - wallT / 2, maxZ: frontZ + wallT / 2 });
    addBox(boxGeo, matShopWall, segRcx, floorY + wallH / 2, frontZ, segW, wallH, wallT);
    colliders.push({ minX: rightX - segW, maxX: rightX, minZ: frontZ - wallT / 2, maxZ: frontZ + wallT / 2 });
    // Door lintel above the gap (flat, ABOVE head height — NO collider, the gap
    // below it stays clear and walkable).
    addBox(boxGeo, matShopTrim, shX, floorY + wallH - 0.25, frontZ, doorW + 0.3, 0.5, wallT + 0.04, false);

    // ROOF / flat ceiling slab capping the room.
    addBox(boxGeo, matShopRoof, shX, floorY + wallH + 0.08, shZ, shW + 0.5, 0.2, shD + 0.5);

    // ── SHOP SIGN above the door, OUTSIDE, facing the street (+Z, un-mirrored).
    const shopSign = artPanel(4.4, 1.2, "sign", {
      text: "HARBOR BAIT & TACKLE",
      bg: "#13414f", fg: "#ffd23f",
      file: "harbor-bait-tackle.png",
      emissiveIntensity: 0.55,
    });
    shopSign.position.set(shX, floorY + wallH + 0.45, frontZ + wallT / 2 + 0.05);
    group.add(shopSign);

    // ── INTERIOR CONTENT (cozy + themed) ─────────────────────────────────────
    // Floor RUG (flat, decorative).
    addBox(boxGeo, matRug, shX, floorY + 0.09, shZ - 0.3, shW - 2.4, 0.04, shD - 2.6, false);

    // Service COUNTER along the back-left, with a lighter countertop.
    const cntZ = backZ + 1.0;
    addBox(boxGeo, matCounter, shX - 1.3, floorY + 0.55, cntZ, 3.4, 1.1, 0.9);
    addBox(boxGeo, matCounterTop, shX - 1.3, floorY + 1.13, cntZ, 3.6, 0.1, 1.0, false);
    // An old brass register / scale on the counter.
    addBox(boxGeo, matCounterTop, shX - 2.2, floorY + 1.32, cntZ, 0.5, 0.35, 0.5, false);

    // SHELVES against the left wall (stacked planks) with little product boxes.
    const shelfX = leftX + 0.45;
    for (let s = 0; s < 3; s++) {
      const sy = floorY + 0.9 + s * 0.8;
      addBox(boxGeo, matShelf, shelfX, sy, shZ + 0.6, 0.35, 0.06, 3.4, false);
      for (let p = 0; p < 4; p++) {
        const pm = matProd[(s + p) % matProd.length];
        addBox(boxGeo, pm, shelfX, sy + 0.22, shZ - 0.9 + p * 0.85, 0.26, 0.32, 0.36, false);
      }
    }
    // Wall SIGNAGE inside above the shelves (faces +X into the room).
    const inSign = artPanel(2.2, 0.9, "sign", {
      text: "FRESH BAIT", bg: "#5a3a22", fg: "#ffe08a", file: "harbor-bait-inside.png",
    });
    inSign.rotation.y = Math.PI / 2;
    inSign.position.set(leftX + wallT / 2 + 0.04, floorY + 2.55, shZ + 0.6);
    group.add(inSign);

    // DISPLAY CASE / glass tackle cabinet against the right wall (lures & reels).
    const caseX = rightX - 0.6;
    addBox(boxGeo, matShelf, caseX, floorY + 0.5, shZ - 0.4, 0.7, 1.0, 2.6, false);
    addBox(boxGeo, matGlass, caseX, floorY + 1.4, shZ - 0.4, 0.55, 0.8, 2.5, false);
    // A fishing-ROD rack standing in the front-right corner (a few thin rods).
    for (let r = 0; r < 4; r++) {
      const rod = new THREE.Mesh(cylGeo, matWood);
      rod.scale.set(0.04, 2.6, 0.04);
      rod.position.set(rightX - 0.5 - r * 0.18, floorY + 1.3, frontZ - 0.9);
      rod.rotation.z = 0.12;
      group.add(rod);
    }

    // Two STOOLS in front of the counter (seat + single post).
    for (const sx of [shX + 0.4, shX + 1.6]) {
      addBox(cylGeo, matStool, sx, floorY + 0.62, cntZ + 1.1, 0.42, 0.12, 0.42, false);
      addBox(cylGeo, matStool, sx, floorY + 0.3, cntZ + 1.1, 0.1, 0.6, 0.1, false);
    }

    // Hanging interior LIGHTS (two warm lamps under the ceiling) + a tiny cord.
    for (const lx of [shX - 1.8, shX + 1.8]) {
      addBox(boxGeo, matLamp, lx, floorY + wallH - 0.45, shZ - 0.2, 0.5, 0.22, 0.5, false);
      addBox(cylGeo, matShopTrim, lx, floorY + wallH - 0.18, shZ - 0.2, 0.03, 0.4, 0.03, false);
    }

    // A coiled rope + a life-ring on the front exterior beside the door for charm
    // (decorative, no collider; sits flush on the front wall).
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.14, 6, 14), matHull3);
    ring.position.set(segLcx, floorY + 1.6, frontZ + wallT / 2 + 0.08);
    group.add(ring);
  }

  // ── MORE ENTERABLE SHOPS + DOCK FLAVOR (additive enrichment) ──────────────
  // Two further walk-in shops on the OPEN pier deck (X[-16,-2], Z[-14,18]) plus
  // a scatter of lived-in props. Both shops are self-contained rooms (own floor,
  // 4 walls with a doorway GAP, ceiling) whose colliders are per-wall AABBs so
  // the doorway stays clear. All footprints stay well inside X,Z ∈ [-23,23] and
  // clear the road seams. Fronts face +Z (the open south pier) so artPanel signs
  // read un-mirrored with NO rotation.

  // Shared shop materials for the two rooms (created ONCE, reused).
  const matShop2Wall = new THREE.MeshStandardMaterial({ color: "#6c5740", roughness: 0.95 });
  const matShop2Floor = new THREE.MeshStandardMaterial({ color: "#856a48", roughness: 0.96 });
  const matShop2Roof = new THREE.MeshStandardMaterial({ color: "#3a4a44", roughness: 0.85, metalness: 0.3 });
  const matShop2Trim = new THREE.MeshStandardMaterial({ color: "#2a4046", roughness: 0.8 });
  const matShop2Counter = new THREE.MeshStandardMaterial({ color: "#5e4228", roughness: 0.85 });
  const matShop2Top = new THREE.MeshStandardMaterial({ color: "#cba86a", roughness: 0.5, metalness: 0.2 });
  const matShop2Shelf = new THREE.MeshStandardMaterial({ color: "#7e6240", roughness: 0.9 });
  const matShop2Lamp = new THREE.MeshStandardMaterial({ color: "#ffe9b0", emissive: "#ffcf6a", emissiveIntensity: 0.9, roughness: 0.6 });
  const matCrate = new THREE.MeshStandardMaterial({ color: "#8a6a3e", roughness: 0.95 });
  const matBarrel = new THREE.MeshStandardMaterial({ color: "#5a4326", roughness: 0.9 });
  const matNet = new THREE.MeshStandardMaterial({ color: "#3c5a4a", roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  const matFish = new THREE.MeshStandardMaterial({ color: "#b8c4cc", roughness: 0.5, metalness: 0.3 });
  const matIce = new THREE.MeshStandardMaterial({ color: "#cfe6ee", roughness: 0.3, metalness: 0.1 });
  const matProd2 = [
    new THREE.MeshStandardMaterial({ color: "#c8412f", roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: "#2f9e58", roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: "#e0a52a", roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: "#3b6fb0", roughness: 0.8 }),
  ];

  // Reusable enterable-room shell: floor + 4 walls (front split round a doorway
  // GAP) + ceiling + an exterior sign over the door. Pushes per-wall colliders.
  // Returns useful interior bounds so the caller can furnish the room.
  function makeShopShell(cx, cz, w, d, wallH, signOpts, doorW = 2.2) {
    const wallT = 0.25;
    const floorY = 0.22;                 // pier deck top
    const frontZ = cz + d / 2;           // +Z wall (faces open pier)
    const backZ = cz - d / 2;
    const leftX = cx - w / 2;
    const rightX = cx + w / 2;

    // Floor slab.
    addBox(boxGeo, matShop2Floor, cx, floorY + 0.02, cz, w, 0.1, d);
    // Back wall.
    addBox(boxGeo, matShop2Wall, cx, floorY + wallH / 2, backZ, w, wallH, wallT);
    colliders.push({ minX: leftX, maxX: rightX, minZ: backZ - wallT / 2, maxZ: backZ + wallT / 2 });
    // Left + right side walls.
    addBox(boxGeo, matShop2Wall, leftX, floorY + wallH / 2, cz, wallT, wallH, d);
    colliders.push({ minX: leftX - wallT / 2, maxX: leftX + wallT / 2, minZ: backZ, maxZ: frontZ });
    addBox(boxGeo, matShop2Wall, rightX, floorY + wallH / 2, cz, wallT, wallH, d);
    colliders.push({ minX: rightX - wallT / 2, maxX: rightX + wallT / 2, minZ: backZ, maxZ: frontZ });
    // Front wall: two segments flanking a centred doorway GAP (no collider spans it).
    const segW = (w - doorW) / 2;
    addBox(boxGeo, matShop2Wall, leftX + segW / 2, floorY + wallH / 2, frontZ, segW, wallH, wallT);
    colliders.push({ minX: leftX, maxX: leftX + segW, minZ: frontZ - wallT / 2, maxZ: frontZ + wallT / 2 });
    addBox(boxGeo, matShop2Wall, rightX - segW / 2, floorY + wallH / 2, frontZ, segW, wallH, wallT);
    colliders.push({ minX: rightX - segW, maxX: rightX, minZ: frontZ - wallT / 2, maxZ: frontZ + wallT / 2 });
    // Door lintel (above head height, NO collider — gap below stays walkable).
    addBox(boxGeo, matShop2Trim, cx, floorY + wallH - 0.25, frontZ, doorW + 0.3, 0.5, wallT + 0.04, false);
    // Ceiling cap.
    addBox(boxGeo, matShop2Roof, cx, floorY + wallH + 0.08, cz, w + 0.5, 0.2, d + 0.5);
    // Exterior sign over the door, facing +Z (un-mirrored, no rotation).
    const sign = artPanel(Math.min(w - 1.0, 4.6), 1.2, "sign", signOpts);
    sign.position.set(cx, floorY + wallH + 0.45, frontZ + wallT / 2 + 0.05);
    group.add(sign);
    // Two warm hanging lamps under the ceiling.
    for (const lx of [cx - w / 4, cx + w / 4]) {
      addBox(boxGeo, matShop2Lamp, lx, floorY + wallH - 0.45, cz - 0.1, 0.5, 0.22, 0.5, false);
      addBox(cylGeo, matShop2Trim, lx, floorY + wallH - 0.18, cz - 0.1, 0.03, 0.4, 0.03, false);
    }
    return { floorY, frontZ, backZ, leftX, rightX, segLcx: leftX + segW / 2 };
  }

  // ── SHOP 2: DOCKSIDE FISH MARKET (north pier, between quay & bait shack) ───
  // Footprint X[-15,-7] Z[-12.5,-5.5] (8w × 7d), centred (-11,-9), on the plank
  // deck north of the bait shack and clear of the bollard/cleat line at Z=-8.
  {
    const fm = makeShopShell(-11, -9, 8, 7, 3.2, {
      text: "DOCKSIDE FISH MARKET", bg: "#13414f", fg: "#ffd23f",
      file: "harbor-fish-market.png", emissiveIntensity: 0.55,
    });
    const cx = -11, cz = -9;
    // Long ice-bed display counter across the back, heaped with fresh catch.
    addBox(boxGeo, matShop2Counter, cx, fm.floorY + 0.5, fm.backZ + 1.0, 6.2, 1.0, 1.0);
    addBox(boxGeo, matIce, cx, fm.floorY + 1.05, fm.backZ + 1.0, 6.0, 0.14, 0.9, false);
    for (let i = 0; i < 6; i++) {
      const fish = new THREE.Mesh(boxGeo, matFish);
      fish.scale.set(0.7, 0.16, 0.26);
      fish.position.set(cx - 2.4 + i * 0.95, fm.floorY + 1.18, fm.backZ + 0.9 + (i % 2) * 0.3);
      fish.rotation.y = (i % 2 ? 0.3 : -0.3);
      group.add(fish);
    }
    // Hanging fishing NET draped on the left wall (flat decorative plane).
    const net = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.0), matNet);
    net.position.set(fm.leftX + 0.18, fm.floorY + 1.9, cz + 0.4);
    net.rotation.y = Math.PI / 2;
    group.add(net);
    // Stacked produce crates against the right wall.
    for (let s = 0; s < 3; s++) {
      addBox(boxGeo, matCrate, fm.rightX - 0.6, fm.floorY + 0.35 + s * 0.62, cz - 1.4 + (s % 2) * 0.4, 1.0, 0.6, 1.0, false);
    }
    // A chalk price board (interior sign) above the counter, facing +Z.
    const board = artPanel(2.6, 1.0, "sign", { text: "CATCH OF THE DAY", bg: "#1c2a26", fg: "#eaf2ec", file: "harbor-fish-board.png" });
    board.position.set(cx, fm.floorY + 2.5, fm.backZ + 0.2);
    group.add(board);
    // Barrel of ice by the door + a stool.
    addBox(cylGeo, matBarrel, fm.rightX - 0.8, fm.floorY + 0.5, fm.frontZ - 1.0, 0.8, 1.0, 0.8, false);
  }

  // ── SHOP 3: HARBOR FERRY TICKET OFFICE (south pier) ───────────────────────
  // Footprint X[-15,-7] Z[10,16] (8w × 6d), centred (-11,13). PULLED NORTH from
  // its old centre (15.5 → 13): the old Z[12.5,18.5] poked 0.5m PAST the pier's
  // south edge (Z=18), so the floor + door wall floated over open water and the
  // +Z-facing door was unreachable. Now the whole footprint sits on solid deck
  // with a ~2m approach apron (Z[16,18]) south of the door; still clear of the
  // bait shack (maxZ 9.25) and inside [-23,23]. Front/sign face +Z (un-mirrored).
  {
    const fo = makeShopShell(-11, 13, 8, 6, 3.2, {
      text: "HARBOR FERRY TICKETS", bg: "#5a3a22", fg: "#ffe08a",
      file: "harbor-ferry-office.png", emissiveIntensity: 0.55,
    });
    const cx = -11, cz = 13;
    // Ticket counter with a glass-topped window across the back.
    addBox(boxGeo, matShop2Counter, cx, fo.floorY + 0.55, fo.backZ + 0.9, 5.6, 1.1, 0.8);
    addBox(boxGeo, matShop2Top, cx, fo.floorY + 1.13, fo.backZ + 0.9, 5.8, 0.1, 0.9, false);
    // Wall of shelved schedules / parcels (left wall) with little boxes.
    const shX = fo.leftX + 0.42;
    for (let s = 0; s < 3; s++) {
      const sy = fo.floorY + 0.9 + s * 0.8;
      addBox(boxGeo, matShop2Shelf, shX, sy, cz + 0.4, 0.35, 0.06, 3.0, false);
      for (let p = 0; p < 3; p++) {
        addBox(boxGeo, matProd2[(s + p) % matProd2.length], shX, sy + 0.2, cz - 0.9 + p * 0.9, 0.24, 0.3, 0.34, false);
      }
    }
    // A timetable board (interior sign) above the counter, facing +Z.
    const board = artPanel(3.0, 1.1, "sign", { text: "DEPARTURES", bg: "#13414f", fg: "#ffd23f", file: "harbor-ferry-board.png" });
    board.position.set(cx, fo.floorY + 2.5, fo.backZ + 0.2);
    group.add(board);
    // A waiting bench by the right wall + two short stanchion posts by the door.
    addBox(boxGeo, matShop2Counter, fo.rightX - 0.7, fo.floorY + 0.45, cz, 0.7, 0.5, 2.4, false);
    addBox(boxGeo, matShop2Shelf, fo.rightX - 0.7, fo.floorY + 0.95, cz, 0.7, 0.6, 0.12, false);
    for (const dz of [-0.6, 0.6]) {
      addBox(cylGeo, matSteel, cx + 1.6, fo.floorY + 0.55, fo.frontZ - 1.2 + dz, 0.08, 1.0, 0.08, false);
    }
  }

  // ── Lobster pots, crates, barrels & a net stand scattered on the deck ─────
  // (decorative, NO colliders — small enough to step past, keep hot path clear)
  const lobsterGeo = new THREE.BoxGeometry(0.9, 0.55, 0.9);
  for (const [px, pz, r] of [[-4.2, -11, 0.2], [-3.6, -6, -0.4], [-4.0, -3.5, 0.5], [-4.0, 11, 0.3]]) {
    const pot = new THREE.Mesh(lobsterGeo, matCrate);
    pot.position.set(px, 0.5, pz);
    pot.rotation.y = r;
    pot.castShadow = true;
    group.add(pot);
    // domed rim (a flattened cylinder) so it reads as a trap, not just a crate
    addBox(cylGeo, matBarrel, px, 0.82, pz, 0.7, 0.22, 0.7, false);
  }
  // A few stacked crates + barrels along the quay edge for cargo flavor.
  for (const [px, pz] of [[-6.2, -12.5], [-6.2, -11.4], [-14.0, -13.3]]) {
    addBox(boxGeo, matCrate, px, 0.55, pz, 1.0, 1.0, 1.0, true);
  }
  for (const [px, pz] of [[-5.2, 13.5], [-5.6, 14.6], [-4.5, 11.5]]) {
    const bar = new THREE.Mesh(cylGeo, matBarrel);
    bar.scale.set(0.8, 1.1, 0.8);
    bar.position.set(px, 0.55, pz);
    bar.castShadow = true;
    group.add(bar);
  }

  // ── Dockside lamp posts (a warm glow head on a dark steel pole) ───────────
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: "#ffe6a8", emissive: "#ffcf6a", emissiveIntensity: 0.95, roughness: 0.5 });
  for (const [lx, lz] of [[-16.6, -3], [-1.4, 7], [-16.6, 12], [-1.4, -8]]) {
    addBox(cylGeo, matDarkSteel, lx, 1.6, lz, 0.14, 3.2, 0.14, true);
    addBox(cylGeo, matDarkSteel, lx, 3.25, lz, 0.5, 0.12, 0.5, false);
    addBox(boxGeo, lampHeadMat, lx, 3.05, lz, 0.42, 0.42, 0.42, false);
  }

  // ── A wooden produce/fish STALL on the pier (open-air, awning + crates) ───
  // The north quay band is FULL (warehouse, port-authority, chandlery, container
  // stack and crane leave no 5m gap), and the spot east of the crane is actually
  // OPEN WATER (south of the quay edge Z=-14, east of the pier X=-2 — no deck).
  // So this open-air stall now sits on solid PIER deck, on the west side of the
  // clear span between the fish market and the bait shack: footprint
  // ~X[-15.4,-10.6] Z[-3.4,1.8], inside [-23,23], clear of the road seams, and no
  // longer floating over the sea. Front/sign face +Z (the open pier walkway).
  {
    const sx = -13, sz = -2;
    const matAwn = new THREE.MeshStandardMaterial({ color: "#b5453a", roughness: 0.85, side: THREE.DoubleSide });
    // Four corner posts + a flat counter board.
    for (const [dx, dz] of [[-2, -1.2], [2, -1.2], [-2, 1.2], [2, 1.2]]) {
      addBox(cylGeo, matWood, sx + dx, 1.0, sz + dz, 0.12, 2.0, 0.12, true);
    }
    addBox(boxGeo, matShop2Counter, sx, 0.95, sz + 1.0, 4.4, 0.2, 0.8);
    // Slanted striped awning over the stall.
    const awn = addBox(boxGeo, matAwn, sx, 2.15, sz + 0.2, 4.8, 0.1, 3.2, false);
    awn.rotation.x = -0.18;
    // Crates of goods on the counter.
    for (let i = 0; i < 3; i++) {
      addBox(boxGeo, matProd2[i % matProd2.length], sx - 1.4 + i * 1.4, 1.25, sz + 1.0, 0.7, 0.4, 0.6, false);
    }
    // Small hanging sign on the front beam.
    const stallSign = artPanel(2.2, 0.7, "sign", { text: "MARKET", bg: "#5a3a22", fg: "#ffd23f", file: "harbor-stall.png" });
    stallSign.position.set(sx, 1.95, sz + 1.7);
    group.add(stallSign);
  }

  // ════════════════════════════════════════════════════════════════════════
  // MARITIME RICHNESS PASS (additive) — instanced fleet, nav buoys, pilings,
  // bunting, seagulls and a rotating channel-marker beacon. Everything here is
  // either floating on the water, overhead, or thin/decorative → NO colliders
  // are added (the drivable boardwalk lane + pier deck stay completely clear).
  // All geometries/materials are created ONCE; animated instances are driven by
  // per-instance matrices in update() using a single reused scratch Object3D,
  // so update() stays allocation-free.
  // ════════════════════════════════════════════════════════════════════════
  const _d = new THREE.Object3D(); // reused scratch transform (build + update)

  // ── Shared geometries for the pass (created ONCE) ─────────────────────────
  const pilingGeo = new THREE.CylinderGeometry(0.34, 0.46, 3.4, 8);
  const pilingCapGeo = new THREE.CylinderGeometry(0.5, 0.42, 0.28, 8);
  const buoyBodyGeo = new THREE.CylinderGeometry(0.34, 0.62, 1.25, 10);
  const buoyLampGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const dinghyHullGeo = new THREE.BoxGeometry(1.7, 0.62, 3.6);
  const dinghyThwartGeo = new THREE.BoxGeometry(1.7, 0.12, 0.4);
  const gullGeo = new THREE.BoxGeometry(0.72, 0.05, 0.2);
  // A single down-pointing triangle for the bunting flags (pivot at the top
  // edge so update() can swing each flag about its X axis).
  const buntGeo = new THREE.BufferGeometry();
  buntGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -0.28, 0, 0,  0.28, 0, 0,  0, -0.66, 0,
  ]), 3));
  buntGeo.setIndex([0, 1, 2]);
  buntGeo.computeVertexNormals();

  // ── Shared materials for the pass (created ONCE) ──────────────────────────
  const matBarnaclePile = new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 1 });
  const matBuoyRed = new THREE.MeshStandardMaterial({ color: "#d23b32", roughness: 0.55, metalness: 0.1, flatShading: true });
  const matBuoyGreen = new THREE.MeshStandardMaterial({ color: "#2fa15a", roughness: 0.55, metalness: 0.1, flatShading: true });
  const matLampRed = new THREE.MeshStandardMaterial({ color: "#ff6a5a", emissive: "#ff2a1a", emissiveIntensity: 1.1, roughness: 0.5 });
  const matLampGreen = new THREE.MeshStandardMaterial({ color: "#7cffb0", emissive: "#12ff5a", emissiveIntensity: 1.1, roughness: 0.5 });
  const matDinghy = new THREE.MeshStandardMaterial({ color: "#355a7a", roughness: 0.8, flatShading: true });
  const matGull = new THREE.MeshStandardMaterial({ color: "#eef2f4", roughness: 0.9 });
  const matBunting = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7, side: THREE.DoubleSide });
  const matBeaconWhite = new THREE.MeshStandardMaterial({ color: "#e9edf0", roughness: 0.8 });
  const matBeaconRed = new THREE.MeshStandardMaterial({ color: "#c23a30", roughness: 0.8 });
  const matBeaconLamp = new THREE.MeshStandardMaterial({ color: "#fff0c0", emissive: "#ffcf5a", emissiveIntensity: 1.4, roughness: 0.4 });

  // ── Mooring pilings / dolphins scattered across the water (instanced) ──────
  // Clustered around the moored boats and along the open water; all Z > -14
  // (seaward of the quay) and clear of the pier deck (X[-16,-2]).
  const pilingSpots = [
    [-20, 10], [-24, 4], [-19, 1], [-26, 18],
    [12, 20], [10, 12], [14, 16], [16, 8],
    [2, 27], [-6, 26], [5, 22], [22, 24],
    [26, 14], [24, 4],
  ];
  const pilingsMesh = new THREE.InstancedMesh(pilingGeo, matBarnaclePile, pilingSpots.length);
  const pilingCapsMesh = new THREE.InstancedMesh(pilingCapGeo, matPile, pilingSpots.length);
  pilingsMesh.castShadow = true; pilingsMesh.receiveShadow = true;
  for (let i = 0; i < pilingSpots.length; i++) {
    const [px, pz] = pilingSpots[i];
    _d.position.set(px, 0.1, pz);
    _d.rotation.set(0, (px * 1.7 + pz) % 1, 0);
    _d.scale.set(1, 1, 1);
    _d.updateMatrix();
    pilingsMesh.setMatrixAt(i, _d.matrix);
    _d.position.set(px, 1.75, pz);
    _d.rotation.set(0, 0, 0);
    _d.updateMatrix();
    pilingCapsMesh.setMatrixAt(i, _d.matrix);
  }
  pilingsMesh.instanceMatrix.needsUpdate = true;
  pilingCapsMesh.instanceMatrix.needsUpdate = true;
  group.add(pilingsMesh, pilingCapsMesh);

  // ── Navigation buoys (instanced) — colourful floats with emissive lamps ────
  // Red set + green set, each a body InstancedMesh + a matching emissive-lamp
  // InstancedMesh. They bob on the swell (matrices rewritten in update()).
  const buoyRed = [[22, 20], [26, 10], [15, 26], [24, 2]];
  const buoyGreen = [[-24, 14], [-28, 22], [18, 6], [6, 28]];
  function makeBuoySet(spots, bodyMat, lampMat) {
    const bodies = new THREE.InstancedMesh(buoyBodyGeo, bodyMat, spots.length);
    const lamps = new THREE.InstancedMesh(buoyLampGeo, lampMat, spots.length);
    bodies.castShadow = true;
    group.add(bodies, lamps);
    return { bodies, lamps, spots, phase: spots.map((s) => (s[0] + s[1]) * 0.3) };
  }
  const buoySets = [
    makeBuoySet(buoyRed, matBuoyRed, matLampRed),
    makeBuoySet(buoyGreen, matBuoyGreen, matLampGreen),
  ];

  // ── Moored dinghy fleet (instanced hulls + thwarts) — bob gently ───────────
  // Small tenders tied up in the open water west & south of the pier.
  const dinghies = [
    [-28, 5, 0.5], [-27, 11, -0.35], [-28, 17, 0.2], [-25, 23, -0.5],
    [7, 4, 1.35], [17, 24, -1.0],
  ];
  const dinghyHulls = new THREE.InstancedMesh(dinghyHullGeo, matDinghy, dinghies.length);
  const dinghyThwarts = new THREE.InstancedMesh(dinghyThwartGeo, matHull3, dinghies.length);
  dinghyHulls.castShadow = true;
  group.add(dinghyHulls, dinghyThwarts);

  // ── String of triangular BUNTING across the quay edge (instanced, sways) ───
  // Overhead at ~5m, drooping in a shallow catenary; NO collider.
  const buntCount = 26;
  const buntMesh = new THREE.InstancedMesh(buntGeo, matBunting, buntCount);
  const buntColors = ["#d84a3a", "#f2f2f2", "#2f6fc8", "#e8b23a", "#2fa15a"];
  const _c = new THREE.Color();
  const buntBase = []; // {x,y,z} cached top-anchor per flag (no per-frame alloc)
  const buntX0 = -22, buntX1 = 22, buntZ = -14.4, buntTopY = 5.3;
  for (let i = 0; i < buntCount; i++) {
    const f = i / (buntCount - 1);
    const x = buntX0 + (buntX1 - buntX0) * f;
    const y = buntTopY - 0.85 * (1 - (2 * f - 1) * (2 * f - 1)); // shallow droop
    buntBase.push({ x, y, z: buntZ });
    _c.set(buntColors[i % buntColors.length]);
    buntMesh.setColorAt(i, _c);
  }
  if (buntMesh.instanceColor) buntMesh.instanceColor.needsUpdate = true;
  group.add(buntMesh);

  // ── Circling SEAGULLS (instanced specks) — orbit overhead in update() ──────
  const gulls = [
    // [radius, y, centerX, centerZ, speed, phase]
    [9, 11, -6, 8, 0.5, 0], [12, 13, -6, 8, -0.38, 1.7],
    [7, 9, 10, 18, 0.62, 3.0], [14, 15, 4, 12, 0.3, 0.8],
    [6, 12, -18, 4, -0.55, 2.2], [10, 10, 16, 22, 0.42, 4.1],
    [8, 14, 0, 0, 0.35, 5.0], [11, 12, -10, 20, -0.47, 1.1],
  ];
  const gullMesh = new THREE.InstancedMesh(gullGeo, matGull, gulls.length);
  group.add(gullMesh);

  // ── Channel-marker BEACON out in the water (rotating emissive lamp) ────────
  // Sits on its own piling cluster in open water south-east; NO collider.
  const bcX = 12, bcZ = 30;
  for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    addBox(cylGeo, matBarnaclePile, bcX + dx, 0.2, bcZ + dz, 0.34, 3.6, 0.34, true);
  }
  addBox(cylGeo, matPile, bcX, 1.75, bcZ, 2.4, 0.4, 2.4, true);          // platform
  addBox(cylGeo, matBeaconWhite, bcX, 3.4, bcZ, 1.5, 3.2, 1.5, true);    // white tower
  addBox(cylGeo, matBeaconRed, bcX, 4.2, bcZ, 1.56, 0.7, 1.56, false);   // red band
  addBox(cylGeo, matBeaconRed, bcX, 2.6, bcZ, 1.56, 0.7, 1.56, false);   // red band
  addBox(cylGeo, matBeaconWhite, bcX, 5.1, bcZ, 1.1, 0.5, 1.1, false);   // lamp housing
  const beaconLamp = new THREE.Mesh(boxGeo, matBeaconLamp);
  beaconLamp.position.set(bcX, 5.55, bcZ);
  beaconLamp.scale.set(0.9, 0.7, 0.5); // a directional lens that sweeps as it turns
  group.add(beaconLamp);
  addBox(cylGeo, matDarkSteel, bcX, 6.05, bcZ, 1.0, 0.5, 1.0, false);    // cap/roof

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

    // ── Nav buoys bob + tilt on the swell; lamps flash (emissive pulse) ──────
    for (let s = 0; s < buoySets.length; s++) {
      const set = buoySets[s];
      for (let i = 0; i < set.spots.length; i++) {
        const [bx, bz] = set.spots[i];
        const ph = set.phase[i];
        const bob = Math.sin(t * 1.1 + ph) * 0.14;
        _d.rotation.set(Math.sin(t * 0.9 + ph) * 0.14, 0, Math.cos(t * 0.8 + ph) * 0.12);
        _d.scale.set(1, 1, 1);
        _d.position.set(bx, bob, bz);
        _d.updateMatrix();
        set.bodies.setMatrixAt(i, _d.matrix);
        _d.position.set(bx, 0.92 + bob, bz);
        _d.rotation.set(0, 0, 0);
        _d.updateMatrix();
        set.lamps.setMatrixAt(i, _d.matrix);
      }
      set.bodies.instanceMatrix.needsUpdate = true;
      set.lamps.instanceMatrix.needsUpdate = true;
    }
    // Lamps flash on offset cadences (red vs green), never below a dim floor.
    matLampRed.emissiveIntensity = 0.5 + (Math.sin(t * 2.4) * 0.5 + 0.5) * 1.3;
    matLampGreen.emissiveIntensity = 0.5 + (Math.sin(t * 2.4 + 2.1) * 0.5 + 0.5) * 1.3;

    // ── Moored dinghy fleet bobs gently ─────────────────────────────────────
    for (let i = 0; i < dinghies.length; i++) {
      const [dx, dz, hd] = dinghies[i];
      const bob = Math.sin(t * 1.25 + i * 1.3) * 0.11;
      _d.scale.set(1, 1, 1);
      _d.rotation.set(Math.sin(t * 0.9 + i) * 0.05, hd, Math.sin(t * 0.7 + i * 0.6) * 0.06);
      _d.position.set(dx, -0.12 + bob, dz);
      _d.updateMatrix();
      dinghyHulls.setMatrixAt(i, _d.matrix);
      _d.position.set(dx, 0.12 + bob, dz);
      _d.updateMatrix();
      dinghyThwarts.setMatrixAt(i, _d.matrix);
    }
    dinghyHulls.instanceMatrix.needsUpdate = true;
    dinghyThwarts.instanceMatrix.needsUpdate = true;

    // ── Bunting flags swing in the breeze about their top edge ──────────────
    for (let i = 0; i < buntBase.length; i++) {
      const b = buntBase[i];
      _d.scale.set(1, 1, 1);
      _d.position.set(b.x, b.y, b.z);
      _d.rotation.set(Math.sin(t * 2.2 + i * 0.6) * 0.35, 0, Math.sin(t * 1.6 + i * 0.5) * 0.18);
      _d.updateMatrix();
      buntMesh.setMatrixAt(i, _d.matrix);
    }
    buntMesh.instanceMatrix.needsUpdate = true;

    // ── Seagulls circle overhead, banking into the turn with a wing flap ────
    for (let i = 0; i < gulls.length; i++) {
      const [r, gy, cx, cz, spd, gph] = gulls[i];
      const ang = t * spd + gph;
      _d.scale.set(1, 1, 1);
      _d.position.set(cx + Math.cos(ang) * r, gy + Math.sin(t * 1.3 + gph) * 0.4, cz + Math.sin(ang) * r);
      _d.rotation.set(0, -ang, Math.sin(t * 6 + gph) * 0.5); // heading + wing flap
      _d.updateMatrix();
      gullMesh.setMatrixAt(i, _d.matrix);
    }
    gullMesh.instanceMatrix.needsUpdate = true;

    // ── Beacon lamp slowly rotates + flashes (rotating channel marker) ──────
    beaconLamp.rotation.y = t * 1.6;
    matBeaconLamp.emissiveIntensity = 0.6 + (Math.sin(t * 3.0) * 0.5 + 0.5) * 1.6;
  }

  return { group, colliders, ground, update };
}
