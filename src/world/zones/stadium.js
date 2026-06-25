// STADIUM district — a small sports arena filling a 60×60 tile centered on the
// origin. A THICK oval grandstand SHELL (real inner+outer concrete faces, a top
// deck and a base plinth — solid from front, side AND back) rings a green pitch
// with painted field lines; solid stepped seating tiers step down toward the
// field; four floodlight towers stand at the corners with emissive lamp heads;
// big "CAFE FC" banners + a scoreboard are mounted on SOLID sign-box structures.
//
// buildStadium() returns { group, colliders, ground, update }:
//   group     — THREE.Group of all geometry (LOCAL coords within the tile)
//   colliders — AABBs { minX,maxX,minZ,maxZ } for solid props (grandstand shell
//               arcs, floodlight towers, shop/booth/cafe walls, ground props).
//               Pitch, gates AND every overhead sign/banner/scoreboard are
//               WALK-UNDER: high-mounted panels register NO collider (colliders
//               are infinite-height in XZ) so players pass freely beneath them.
//   ground    — walkable rects; includes the full tile.
//   update(dt)— flickers the floodlights + slowly orbits a blimp over the pitch.
//
// Coordinates: ground is the XZ plane at y=0; +Y up. Right-handed Y-up world.
//
// FULL-VOLUME NOTE: the grandstand was previously a single zero-thickness
// open-cylinder tube (a curved "card" that read as a 1px line from the side and
// had nothing behind it). It is now a genuine thick bowl: an OUTER face shell, an
// INNER face shell, a TOP capping deck and a BASE plinth, braced by buttress
// columns on the back — a substantial structure from every angle. Seating tiers
// are solid stepped blocks (tread + riser depth), not curved sheets. Banners /
// scoreboard sit on solid backing boxes, not floating planes.

import * as THREE from "three";
import { artPanel } from "../cityArt.js";

// --- Materials (created once, reused) --------------------------------------
const grassMat = new THREE.MeshStandardMaterial({ color: "#2f7d3f", roughness: 1 });
const grassDark = new THREE.MeshStandardMaterial({ color: "#2a6f37", roughness: 1 });
const lineMat = new THREE.MeshStandardMaterial({ color: "#eef3ec", roughness: 0.7 });
// concreteMat clads the grandstand shell faces. The shell now has BOTH an inner
// and an outer wall (so it has real thickness), but we keep DoubleSide so the
// open-ended cylinder faces read solid whether seen from inside or outside.
const concreteMat = new THREE.MeshStandardMaterial({ color: "#b9b3a6", roughness: 0.95, side: THREE.DoubleSide });
const concreteDark = new THREE.MeshStandardMaterial({ color: "#8d887d", roughness: 1 });
// Seat-row materials clad the solid stepped tiers (closed boxes/arcs); keep
// DoubleSide so the inward-facing seating reads solid from the pitch side.
const seatMatA = new THREE.MeshStandardMaterial({ color: "#c43b3b", roughness: 0.7, side: THREE.DoubleSide });
const seatMatB = new THREE.MeshStandardMaterial({ color: "#3667c0", roughness: 0.7, side: THREE.DoubleSide });
const seatMatC = new THREE.MeshStandardMaterial({ color: "#e0b03a", roughness: 0.7, side: THREE.DoubleSide });
const towerMat = new THREE.MeshStandardMaterial({ color: "#42474d", roughness: 0.5, metalness: 0.7 });
const rigMat = new THREE.MeshStandardMaterial({ color: "#2c3034", roughness: 0.6, metalness: 0.6 });
const lampMat = new THREE.MeshStandardMaterial({
  color: "#fff6d8", emissive: "#fff0b0", emissiveIntensity: 1.0, roughness: 0.3,
});
const goalMat = new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.5, metalness: 0.2 });
const blimpMat = new THREE.MeshStandardMaterial({ color: "#d6dadf", roughness: 0.6, metalness: 0.2 });
// Solid backing box behind every banner / scoreboard so signage is a real 3D
// volume (a mounted frame), never a floating flat card.
const signFrameMat = new THREE.MeshStandardMaterial({ color: "#3a3f45", roughness: 0.8, metalness: 0.3 });

// --- Team merch shop materials (created once, reused) -----------------------
// A small pitchside club store the player can walk INTO. Themed to the home club
// (CAFE FC) with the same red/blue palette as the banners.
const shopWallMat = new THREE.MeshStandardMaterial({ color: "#e8e4da", roughness: 0.9 });
const shopWallIn = new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.95, side: THREE.DoubleSide });
const shopFloorMat = new THREE.MeshStandardMaterial({ color: "#7a4a32", roughness: 0.85 });
const shopRoofMat = new THREE.MeshStandardMaterial({ color: "#9b1f2a", roughness: 0.7 });
const shopTrimMat = new THREE.MeshStandardMaterial({ color: "#1f3a9b", roughness: 0.6 });
const counterMat = new THREE.MeshStandardMaterial({ color: "#6b4326", roughness: 0.6 });
const counterTopMat = new THREE.MeshStandardMaterial({ color: "#cfc7b6", roughness: 0.4 });
const shelfMat = new THREE.MeshStandardMaterial({ color: "#caa46a", roughness: 0.7 });
const rugMat = new THREE.MeshStandardMaterial({ color: "#16245a", roughness: 1 });
const stoolMat = new THREE.MeshStandardMaterial({ color: "#2b2f36", roughness: 0.5, metalness: 0.4 });
const caseMat = new THREE.MeshStandardMaterial({
  color: "#bfe6ff", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.32,
});
const shopBulbMat = new THREE.MeshStandardMaterial({
  color: "#fff3cf", emissive: "#ffe9ad", emissiveIntensity: 0.9, roughness: 0.4,
});
// Little merch products on the shelves — scarves, jerseys, balls — as instanced
// blocks/spheres in club colours.
const merchRed = new THREE.MeshStandardMaterial({ color: "#c43b3b", roughness: 0.6 });
const merchBlue = new THREE.MeshStandardMaterial({ color: "#3667c0", roughness: 0.6 });
const merchGold = new THREE.MeshStandardMaterial({ color: "#e0b03a", roughness: 0.6 });
const merchBall = new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.5 });

// --- Concession (snack bar) + ticket-booth shop materials -------------------
// Two more walk-IN structures on the pitch apron. The concession stand is a warm
// food-stall theme (kraft/cream + roasted reds); the ticket booth is a compact
// club-blue kiosk. All reuse the box() helper + per-wall AABB collider pattern.
const concWallMat = new THREE.MeshStandardMaterial({ color: "#d9cdb4", roughness: 0.92 });
const concRoofMat = new THREE.MeshStandardMaterial({ color: "#7a2f1f", roughness: 0.75 });
const concTrimMat = new THREE.MeshStandardMaterial({ color: "#e0b03a", roughness: 0.55 });
const concFloorMat = new THREE.MeshStandardMaterial({ color: "#5c5048", roughness: 0.9 });
const griddleMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.4, metalness: 0.6 });
const fryerMat = new THREE.MeshStandardMaterial({ color: "#c8c2b4", roughness: 0.35, metalness: 0.5 });
const popcornMat = new THREE.MeshStandardMaterial({ color: "#f2e4b0", roughness: 0.8 });
const ketchupMat = new THREE.MeshStandardMaterial({ color: "#b22a22", roughness: 0.5 });
const mustardMat = new THREE.MeshStandardMaterial({ color: "#e0b03a", roughness: 0.5 });
const cupMat = new THREE.MeshStandardMaterial({ color: "#d6402f", roughness: 0.6 });
const boothWallMat = new THREE.MeshStandardMaterial({ color: "#243a78", roughness: 0.85 });
const boothRoofMat = new THREE.MeshStandardMaterial({ color: "#16245a", roughness: 0.7 });
const boothTrimMat = new THREE.MeshStandardMaterial({ color: "#e0b03a", roughness: 0.55 });
const ticketMat = new THREE.MeshStandardMaterial({ color: "#f4ead0", roughness: 0.8 });

// --- Stand-cafe (matchday coffee kiosk) materials --------------------------
// A fourth walk-IN unit themed as a pitchside espresso bar (warm cream walls,
// espresso-brown roof, teal trim). Reuses counter/case/bulb mats where possible.
const cafeWallMat = new THREE.MeshStandardMaterial({ color: "#efe7d6", roughness: 0.9 });
const cafeRoofMat = new THREE.MeshStandardMaterial({ color: "#3f2a1c", roughness: 0.7 });
const cafeTrimMat = new THREE.MeshStandardMaterial({ color: "#1f6f5c", roughness: 0.55 });
const espressoMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.35, metalness: 0.65 });
const cafeCupMat = new THREE.MeshStandardMaterial({ color: "#efe6d0", roughness: 0.6 });
const pastryMat = new THREE.MeshStandardMaterial({ color: "#caa050", roughness: 0.7 });
const beanSackMat = new THREE.MeshStandardMaterial({ color: "#6e4a2b", roughness: 0.9 });

// --- Street-flavour prop materials (created once, reused) -------------------
const benchWoodMat = new THREE.MeshStandardMaterial({ color: "#7c5a3a", roughness: 0.8 });
const benchLegMat = new THREE.MeshStandardMaterial({ color: "#37404a", roughness: 0.5, metalness: 0.5 });
const crateMat = new THREE.MeshStandardMaterial({ color: "#8a6a40", roughness: 0.85 });
const planterMat = new THREE.MeshStandardMaterial({ color: "#5b6168", roughness: 0.9 });
const hedgeMat = new THREE.MeshStandardMaterial({ color: "#356b34", roughness: 1 });
const binMat = new THREE.MeshStandardMaterial({ color: "#2f3a33", roughness: 0.7, metalness: 0.2 });
const turnstileMat = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.5, metalness: 0.6 });
const bollardLampMat = new THREE.MeshStandardMaterial({
  color: "#fff3cf", emissive: "#ffe08a", emissiveIntensity: 0.85, roughness: 0.4,
});

// --- Shared geometries (reused across repeated props) ----------------------
const lampGeo = new THREE.BoxGeometry(1.0, 1.1, 0.2);      // one floodlight lamp bank
// Buttress column on the OUTER back of the grandstand shell (shared, instanced).
const buttressGeo = new THREE.BoxGeometry(1.2, 7.6, 1.6);

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

export function buildStadium() {
  const group = new THREE.Group();
  const colliders = [];
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  // Pitch is an oval; stands ring it. Use elliptical radii. SHRUNK in step with
  // the set-back bowl so the seating tiers still ring the pitch without the bowl
  // reaching past LOCAL ±23.
  const PITCH_RX = 13.5;  // pitch half-width (X)
  const PITCH_RZ = 10;    // pitch half-depth (Z)

  // --- Ground slab: concrete apron under everything --------------------------
  const apron = box(60, 0.2, 60, concreteDark, false);
  apron.position.y = -0.1;
  apron.receiveShadow = true;
  group.add(apron);

  // --- The pitch: a green oval slab (thin cylinder, scaled to an ellipse) -----
  const pitch = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.16, 48), grassMat);
  pitch.scale.set(PITCH_RX, 1, PITCH_RZ);
  pitch.position.y = 0.02;
  pitch.receiveShadow = true;
  group.add(pitch);

  // Mowing stripes — a couple of darker bands across the pitch.
  for (const sx of [-1, 1]) {
    const stripe = box(3.0, 0.02, PITCH_RZ * 1.9, grassDark, false);
    stripe.position.set(sx * 6.2, 0.11, 0);
    stripe.receiveShadow = true;
    group.add(stripe);
  }

  // --- Field lines (flat, walkable, no colliders) ----------------------------
  const lineY = 0.12;
  // halfway line
  const halfway = box(0.3, 0.02, PITCH_RZ * 1.85, lineMat, false);
  halfway.position.set(0, lineY, 0);
  group.add(halfway);
  // center circle (thin torus)
  const circle = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.16, 8, 40), lineMat);
  circle.rotation.x = Math.PI / 2;
  circle.position.y = lineY;
  group.add(circle);
  // center spot
  const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 12), lineMat);
  spot.position.y = lineY;
  group.add(spot);
  // touch/goal outline rectangle near pitch edge
  const outlineW = PITCH_RX * 1.7, outlineD = PITCH_RZ * 1.6;
  for (const [w, d, x, z] of [
    [outlineW, 0.3, 0, outlineD / 2],
    [outlineW, 0.3, 0, -outlineD / 2],
    [0.3, outlineD, outlineW / 2, 0],
    [0.3, outlineD, -outlineW / 2, 0],
  ]) {
    const seg = box(w, 0.02, d, lineMat, false);
    seg.position.set(x, lineY, z);
    group.add(seg);
  }
  // penalty-box front line (one thin line set in from the goal end)
  const pbLine = box(0.3, 0.02, 8.0, lineMat, false);
  pbLine.position.set(outlineW / 2 - 6.0, lineY, 0);
  group.add(pbLine);

  // --- Goals at each pitch end ----------------------------------------------
  for (const sx of [-1, 1]) {
    const gx = sx * (PITCH_RX * 0.92);
    const goal = new THREE.Group();
    const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8), goalMat);
    postL.position.set(0, 1.2, -1.6);
    const postR = postL.clone();
    postR.position.z = 1.6;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 8), goalMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, 2.4, 0);
    postL.castShadow = postR.castShadow = bar.castShadow = true;
    goal.add(postL, postR, bar);
    goal.position.x = gx;
    group.add(goal);
  }

  // --- Grandstand: a THICK oval shell + solid stepped seating, with E/W gates -
  // The shell is built as TWO arcs (north + south) leaving open gates on the ±X
  // axis so a car can drive straight through the tile across the pitch.
  //
  // Real thickness: each arc has an OUTER face (radius WALL_R*), an INNER face
  // (radius WALL_R* - THICK), a flat TOP deck capping the gap between them, and a
  // BASE plinth at the bottom. So the wall is a genuine ~2 m-thick concrete band
  // that reads solid from the front, the side, and the BACK — not a curved card.
  // SETBACK: outer radii pulled inward so the bowl (incl. its outer buttress
  // columns at WALL_R*+0.5) clears the seam road + sidewalk and stays within
  // LOCAL X,Z in [-23, 23]. Buttress outer edge ≈ WALL_RX+0.5+0.8 ≈ 22.6 ≤ 23.
  const WALL_RX = 21.3, WALL_RZ = 20.5;   // outer-face elliptical radii
  const THICK = 2.0;                  // radial wall thickness (m)
  const WALL_H = 8.0;                  // wall height (m)
  const WALL_Y = WALL_H / 2;           // shell center height
  const inRX = WALL_RX - THICK, inRZ = WALL_RZ - THICK; // inner-face radii
  const GATE = 0.34;                  // gate half-angle (~19°) at each X pole
  const ARC = Math.PI - 2 * GATE;     // angular length of each wall arc
  const SEG_W = 44;                    // radial segments per shell arc

  // outer + inner face shells (open-ended cylinder arcs, scaled to ellipses)
  for (const startA of [GATE, Math.PI + GATE]) {
    // outer face
    const outGeo = new THREE.CylinderGeometry(1, 1, WALL_H, SEG_W, 1, true, startA, ARC);
    const outer = new THREE.Mesh(outGeo, concreteMat);
    outer.scale.set(WALL_RX, 1, WALL_RZ);
    outer.position.y = WALL_Y;
    outer.castShadow = true;
    outer.receiveShadow = true;
    group.add(outer);
    // inner face
    const inGeo = new THREE.CylinderGeometry(1, 1, WALL_H, SEG_W, 1, true, startA, ARC);
    const inner = new THREE.Mesh(inGeo, concreteMat);
    inner.scale.set(inRX, 1, inRZ);
    inner.position.y = WALL_Y;
    inner.castShadow = true;
    inner.receiveShadow = true;
    group.add(inner);

    // TOP deck + BASE plinth: a flat ribbon (RingGeometry arc) bridging inner→outer
    // faces, so the top and the bottom of the wall read as solid concrete, not a
    // hollow tube. Scaled X/Z to follow the ellipse.
    for (const [y, mat] of [[WALL_H, concreteMat], [0.0, concreteDark]]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1 - THICK / WALL_RX, 1, SEG_W, 1, startA, ARC),
        mat
      );
      ring.rotation.x = -Math.PI / 2;
      ring.scale.set(WALL_RX, WALL_RZ, 1); // ring is in XY before rotation → X,Y map to X,Z
      ring.position.y = y;
      ring.receiveShadow = true;
      group.add(ring);
    }
  }

  // Gate jambs: short solid concrete posts capping the open ends of each arc so
  // the cut edges read as a real doorway frame (thickness visible), not a raw
  // hollow shell mouth. Four jambs, one at each arc end, set on the ellipse.
  const gateAngles = [GATE, Math.PI - GATE, Math.PI + GATE, 2 * Math.PI - GATE];
  for (const a of gateAngles) {
    const mx = Math.cos(a) * (WALL_RX - THICK / 2);
    const mz = Math.sin(a) * (WALL_RZ - THICK / 2);
    const jamb = box(THICK + 0.4, WALL_H + 0.6, THICK + 0.4, concreteMat);
    jamb.position.set(mx, (WALL_H + 0.6) / 2, mz);
    group.add(jamb);
  }

  // Buttress columns bracing the OUTER back of the shell — make the structure
  // read as a real building from behind. One shared InstancedMesh.
  {
    const buttAngles = [];
    for (const startA of [GATE, Math.PI + GATE]) {
      for (let k = 1; k <= 5; k++) buttAngles.push(startA + (ARC * k) / 6);
    }
    const butt = new THREE.InstancedMesh(buttressGeo, concreteDark, buttAngles.length);
    butt.castShadow = true;
    butt.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < buttAngles.length; i++) {
      const a = buttAngles[i];
      // sit the column just OUTSIDE the outer face, hugging the ellipse
      const bx = Math.cos(a) * (WALL_RX + 0.5);
      const bz = Math.sin(a) * (WALL_RZ + 0.4);
      pos.set(bx, WALL_H / 2 - 0.2, bz);
      // face the column tangent toward the shell center
      q.setFromAxisAngle(up, Math.atan2(-bx, -bz));
      m.compose(pos, q, s);
      butt.setMatrixAt(i, m);
    }
    butt.instanceMatrix.needsUpdate = true;
    group.add(butt);
  }

  // Solid stepped seating tiers: each tier is a curved SOLID band (inner+outer
  // face + top tread + riser), stacking inward+up. Built from the same arc-shell
  // technique so each tread reads as a real step with depth, not a thin sheet.
  const seatMats = [seatMatA, seatMatB, seatMatC, seatMatA];
  const TIER_THICK = 1.5;  // radial depth of each tread
  for (let t = 0; t < 4; t++) {
    const rx = 19.0 - t * 1.3;        // outer radius of this tier (inside inner wall)
    const rz = 18.0 - t * 1.4;
    const topY = 0.5 + t * 1.4;        // tread top height
    const tierH = topY;                // riser face runs to the ground for solidity
    const inRx = rx - TIER_THICK, inRz = rz - TIER_THICK;
    const mat = seatMats[t];
    for (const startA of [GATE, Math.PI + GATE]) {
      // riser (outer vertical face of the step)
      const riser = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, tierH, 30, 1, true, startA, ARC), mat
      );
      riser.scale.set(rx, 1, rz);
      riser.position.y = tierH / 2;
      riser.receiveShadow = true;
      group.add(riser);
      // inner vertical face (so the step has back/depth)
      const innerFace = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, tierH, 30, 1, true, startA, ARC), mat
      );
      innerFace.scale.set(inRx, 1, inRz);
      innerFace.position.y = tierH / 2;
      innerFace.receiveShadow = true;
      group.add(innerFace);
      // top tread (flat ribbon between inner & outer face)
      const tread = new THREE.Mesh(
        new THREE.RingGeometry(1 - TIER_THICK / rx, 1, 30, 1, startA, ARC), mat
      );
      tread.rotation.x = -Math.PI / 2;
      tread.scale.set(rx, rz, 1);
      tread.position.y = topY;
      tread.receiveShadow = true;
      group.add(tread);
    }
  }

  // --- Floodlight towers at the four corners ---------------------------------
  // SETBACK: towers pulled inward so each mast + its ±0.9 collider stays within
  // LOCAL [-23, 23] (max |X| = 21.5 + 0.9 = 22.4 ≤ 23).
  const towerPositions = [
    [-21.5, -18.5], [21.5, -18.5], [-21.5, 18.5], [21.5, 18.5],
  ];
  for (const [tx, tz] of towerPositions) {
    const t = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 16, 8), towerMat);
    mast.position.y = 8;
    mast.castShadow = true;
    // angled rig at top, tilted toward pitch center
    const rig = box(2.6, 1.6, 0.5, rigMat);
    rig.position.set(0, 16.3, 0);
    // lamp heads (emissive) on the rig, facing pitch — a side-by-side pair.
    for (const c of [-1, 1]) {
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(c * 0.62, 16.3, 0.32);
      t.add(lamp);
    }
    t.add(mast, rig);
    t.position.set(tx, 0, tz);
    // aim rig roughly at center
    t.rotation.y = Math.atan2(-tx, -tz);
    group.add(t);
    // collider: tight footprint around the mast base
    colliders.push({ minX: tx - 0.9, maxX: tx + 0.9, minZ: tz - 0.9, maxZ: tz + 0.9 });
  }

  // --- "CAFE FC" banners on SOLID sign boxes ---------------------------------
  // Each banner is a real mounted structure: a deep frame box with the art panel
  // set just proud of its FRONT face (facing the pitch), never a floating card.
  function signBox(w, h, depth, style, opts, pos, rotY) {
    const g = new THREE.Group();
    const back = box(w + 0.6, h + 0.6, depth, signFrameMat);
    back.position.set(0, 0, 0);
    g.add(back);
    const panel = artPanel(w, h, style, opts);
    panel.position.set(0, 0, depth / 2 + 0.03); // proud of the FRONT (+Z local) face
    g.add(panel);
    g.position.set(pos[0], pos[1], pos[2]);
    g.rotation.y = rotY;
    group.add(g);
    return g;
  }

  // North-stand banner: mounted on the inner face of the north arc, sitting a
  // touch proud of the wall (z=-17.7 keeps the box back clear of the inner face
  // at z≈-18.5, no coplanar z-fight). FRONT faces +Z toward the pitch/viewer.
  // WALK-UNDER: the banner panel is high overhead (y 3.4–6.6), so it registers
  // NO collider — players walk right beneath it; the wall behind still blocks.
  signBox(12, 3.2, 1.0, "sign", {
    text: "CAFE FC", bg: "#9b1f2a", fg: "#ffe14d",
    emissiveIntensity: 0.5, file: "stadium-cafefc.png",
  }, [0, 5.0, -17.7], 0);

  // South-stand banner: mounted on the inner face of the south arc (z=+17.7,
  // proud of the wall to avoid a coplanar back face). FRONT faces -Z toward the
  // pitch (rotated 180°). WALK-UNDER: overhead panel, so NO collider.
  signBox(12, 3.2, 1.0, "sign", {
    text: "CAFE FC", bg: "#1f3a9b", fg: "#ffffff",
    emissiveIntensity: 0.5, file: "stadium-cafefc-b.png",
  }, [0, 5.0, 17.7], Math.PI);

  // Scoreboard: a chunky billboard cabinet mounted on the north-arc inner wall,
  // offset to the west of the central banner. The inner wall is a tight ellipse,
  // so the cabinet is placed ON the wall point near x≈-12.5 and ROTATED to sit
  // tangent (rotY≈0.72) with its FRONT facing the pitch centre — otherwise a flat
  // off-centre panel would float outside the curving wall. Kept OFF the Z≈0
  // drive-through gate corridor. WALK-UNDER: overhead cabinet, so NO collider.
  signBox(8, 4.5, 1.2, "billboard", {
    title: "CAFE FC", sub: "HOME 2 — 1 AWAY", a: "#13243f", b: "#070d1a",
    accent: "#ffd24a", glyph: "⚽", emissiveIntensity: 0.5, file: "stadium-score.png",
  }, [-12.1, 6.0, -13.65], 0.72);

  // --- Floodlight tint / blimp animation -------------------------------------
  // Blimp circling above the pitch.
  const blimp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), blimpMat);
  body.scale.set(2.4, 1, 1);
  const fin = box(0.1, 1.0, 1.0, blimpMat);
  fin.position.x = -3.4;
  blimp.add(body, fin);
  const banner = artPanel(5, 1.4, "sign", {
    text: "CAFE FC", bg: "#0e7a4a", fg: "#fff7cf",
    emissiveIntensity: 0.5, file: "stadium-blimp.png",
  });
  banner.position.set(0, -1.6, 0);
  blimp.add(banner);
  blimp.position.set(0, 18, 0);
  group.add(blimp);

  // --- ENTERABLE TEAM MERCH SHOP (pitchside club store) ----------------------
  // A small walk-IN store on the open pitch apron, set off to the +Z half so it
  // clears the central Z≈0 gate drive-corridor and the centre circle. Real room:
  // 4 walls + floor + flat roof, with a 2.2 m DOORWAY GAP in the STREET-facing
  // (-Z, toward the halfway line) wall. Each wall gets its own AABB collider; the
  // doorway has NONE, so the player walks straight in. All geometry + colliders
  // stay within LOCAL X,Z in [-23, 23] and sit on clear, prop-free pitch ground.
  {
    const SW = 8.0;          // shop width  (X)
    const SD = 6.0;          // shop depth  (Z)
    const WT = 0.25;         // wall thickness
    const WH = 3.2;          // wall height
    const SCX = 0.0;         // shop centre X
    const SCZ = 6.4;         // shop centre Z (front wall faces -Z)
    const x0 = SCX - SW / 2, x1 = SCX + SW / 2;   // -4 .. 4
    const z0 = SCZ - SD / 2, z1 = SCZ + SD / 2;   // 3.4 .. 9.4 (front=z0)
    const DOOR = 2.2;                              // doorway gap width
    const segW = (SW - DOOR) / 2;                  // each front segment width (2.9)
    const FY = 0.13;                               // floor top sits just above pitch

    const shop = new THREE.Group();

    // FLOOR slab
    const floor = box(SW, 0.12, SD, shopFloorMat, false);
    floor.position.set(SCX, FY - 0.06, SCZ);
    floor.receiveShadow = true;
    shop.add(floor);

    // RUG — a club-coloured rug in the middle of the floor
    const rug = box(4.4, 0.03, 3.4, rugMat, false);
    rug.position.set(SCX, FY + 0.02, SCZ + 0.3);
    rug.receiveShadow = true;
    shop.add(rug);

    // WALLS — helper builds a box wall + pushes its collider.
    const addWall = (cx, cz, w, d) => {
      const wall = box(w, WH, d, shopWallMat);
      wall.position.set(cx, FY + WH / 2, cz);
      shop.add(wall);
      colliders.push({
        minX: cx - w / 2, maxX: cx + w / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
      });
    };
    // BACK wall (+Z), full width (overlaps the side corners for a sealed box)
    addWall(SCX, z1, SW + WT, WT);
    // LEFT (-X) side wall, full depth
    addWall(x0, SCZ, WT, SD);
    // RIGHT (+X) side wall, full depth
    addWall(x1, SCZ, WT, SD);
    // FRONT (-Z) wall — TWO short segments flanking the central doorway gap.
    addWall(x0 + segW / 2, z0, segW, WT);   // left of door
    addWall(x1 - segW / 2, z0, segW, WT);   // right of door
    // NOTE: no wall + NO collider across the doorway gap (x ∈ [-1.1, 1.1]).

    // Door-frame lintel above the gap (decorative, no collider — passable head-room)
    const lintel = box(DOOR + 0.4, 0.5, WT, shopTrimMat);
    lintel.position.set(SCX, FY + WH - 0.25, z0);
    shop.add(lintel);

    // ROOF / flat ceiling slab capping the walls
    const roof = box(SW + WT + 0.4, 0.2, SD + WT + 0.4, shopRoofMat);
    roof.position.set(SCX, FY + WH + 0.1, SCZ);
    roof.castShadow = true;
    shop.add(roof);
    // A thin trim band where roof meets walls
    const fascia = box(SW + WT + 0.5, 0.3, SD + WT + 0.5, shopTrimMat, false);
    fascia.position.set(SCX, FY + WH - 0.05, SCZ);
    shop.add(fascia);

    // SERVICE COUNTER along the back-right, facing the door
    const counter = box(4.0, 1.0, 0.9, counterMat);
    counter.position.set(SCX + 1.3, FY + 0.5, z1 - 1.2);
    shop.add(counter);
    const counterTop = box(4.2, 0.1, 1.1, counterTopMat, false);
    counterTop.position.set(SCX + 1.3, FY + 1.05, z1 - 1.2);
    shop.add(counterTop);
    // a small register block on the counter
    const reg = box(0.5, 0.35, 0.4, stoolMat);
    reg.position.set(SCX + 2.6, FY + 1.28, z1 - 1.2);
    shop.add(reg);

    // SHELVES on the left wall — two stacked shelf boards with little products
    const shelfX = x0 + 0.45;
    const shelfYs = [FY + 0.9, FY + 1.7, FY + 2.5];
    for (const sy of shelfYs) {
      const board = box(0.5, 0.08, 4.2, shelfMat, false);
      board.position.set(shelfX, sy, SCZ);
      shop.add(board);
    }
    // little merch products lined on the shelves (instanced boxes in club colours)
    {
      const prodGeo = new THREE.BoxGeometry(0.34, 0.42, 0.34);
      const prodMats = [merchRed, merchBlue, merchGold];
      const spotsPerShelf = 5;
      for (let mi = 0; mi < prodMats.length; mi++) {
        const inst = new THREE.InstancedMesh(prodGeo, prodMats[mi], shelfYs.length * spotsPerShelf);
        inst.castShadow = true;
        const m = new THREE.Matrix4();
        let n = 0;
        for (let s = 0; s < shelfYs.length; s++) {
          for (let p = 0; p < spotsPerShelf; p++) {
            // 3 colour bands cycle along each shelf
            if ((p % prodMats.length) !== mi) continue;
            const pz = SCZ - 1.7 + p * 0.85;
            m.makeTranslation(shelfX + 0.02, shelfYs[s] + 0.25, pz);
            inst.setMatrixAt(n++, m);
          }
        }
        inst.count = n;
        inst.instanceMatrix.needsUpdate = true;
        shop.add(inst);
      }
    }

    // DISPLAY CASE — a glass cabinet by the right wall showing signed footballs
    const caseBase = box(2.6, 0.9, 1.0, counterMat);
    caseBase.position.set(x1 - 0.8, FY + 0.45, SCZ - 0.6);
    shop.add(caseBase);
    const caseGlass = box(2.5, 0.9, 0.9, caseMat, false);
    caseGlass.position.set(x1 - 0.8, FY + 1.35, SCZ - 0.6);
    shop.add(caseGlass);
    {
      const ballGeo = new THREE.SphereGeometry(0.22, 12, 10);
      const balls = new THREE.InstancedMesh(ballGeo, merchBall, 3);
      balls.castShadow = true;
      const m = new THREE.Matrix4();
      for (let i = 0; i < 3; i++) {
        m.makeTranslation(x1 - 0.8, FY + 1.12, SCZ - 1.3 + i * 0.7);
        balls.setMatrixAt(i, m);
      }
      balls.instanceMatrix.needsUpdate = true;
      shop.add(balls);
    }

    // STOOLS — a couple of bar stools at the counter
    for (const sx of [SCX - 0.6, SCX + 0.6]) {
      const stool = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6), stoolMat);
      legs.position.y = 0.35;
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 12), merchRed);
      seat.position.y = 0.74;
      legs.castShadow = seat.castShadow = true;
      stool.add(legs, seat);
      stool.position.set(sx, FY, z1 - 2.2);
      shop.add(stool);
    }

    // WALL SIGNAGE — interior club crest panel mounted on the back wall, facing -Z
    const innerSign = artPanel(2.6, 1.3, "sign", {
      text: "CLUB SHOP", bg: "#1f3a9b", fg: "#ffe14d",
      emissiveIntensity: 0.45, file: "stadium-shop-inner.png",
    });
    innerSign.position.set(SCX - 1.6, FY + 2.1, z1 - WT / 2 - 0.04);
    innerSign.rotation.y = Math.PI; // face into the room (-Z)
    shop.add(innerSign);

    // HANGING INTERIOR LIGHTS — two glowing bulbs on short cords from the ceiling
    for (const lx of [SCX - 1.8, SCX + 1.8]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), stoolMat);
      cord.position.set(lx, FY + WH - 0.35, SCZ - 0.5);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), shopBulbMat);
      bulb.position.set(lx, FY + WH - 0.62, SCZ - 0.5);
      shop.add(cord, bulb);
    }

    // OUTSIDE SHOP SIGN above the door, facing the street (-Z), un-mirrored.
    // artPanel faces +Z by default, so rotate 180° so the readable face looks -Z.
    const shopSign = artPanel(5.0, 1.2, "sign", {
      text: "CAFE FC MERCH", bg: "#9b1f2a", fg: "#ffffff",
      emissiveIntensity: 0.5, file: "stadium-shop-sign.png",
    });
    shopSign.position.set(SCX, FY + WH + 0.55, z0 - WT / 2 - 0.05);
    shopSign.rotation.y = Math.PI; // readable face toward -Z (the approach/street)
    shop.add(shopSign);

    group.add(shop);
  }

  // --- ENTERABLE CONCESSION / SNACK STAND (south apron) ----------------------
  // Mirror-side walk-IN food stall on the -Z pitch apron (clears the centre
  // circle and the Z≈0 drive corridor). Real room: 4 walls + floor + flat roof,
  // with a 2.2 m DOORWAY GAP in the pitch-facing (+Z) wall. Each solid wall pushes
  // its own AABB; the doorway has none, so the player walks straight in. Inside:
  // a serving counter with a griddle + fryer, a popcorn machine, a condiment
  // shelf and a couple of bistro stools. All within LOCAL [-23, 23].
  {
    const SW = 8.0;          // width (X)
    const SD = 6.0;          // depth (Z)
    const WT = 0.25;         // wall thickness
    const WH = 3.2;          // wall height
    const SCX = 0.0;         // centre X
    const SCZ = -6.4;        // centre Z (door faces +Z toward the pitch)
    const x0 = SCX - SW / 2, x1 = SCX + SW / 2;
    const z0 = SCZ - SD / 2, z1 = SCZ + SD / 2;   // z0=back(-Z), z1=front(+Z, door)
    const DOOR = 2.2;
    const segW = (SW - DOOR) / 2;
    const FY = 0.13;

    const stand = new THREE.Group();

    // FLOOR slab
    const floor = box(SW, 0.12, SD, concFloorMat, false);
    floor.position.set(SCX, FY - 0.06, SCZ);
    floor.receiveShadow = true;
    stand.add(floor);

    // WALLS helper (box wall + collider)
    const addWall = (cx, cz, w, d) => {
      const wall = box(w, WH, d, concWallMat);
      wall.position.set(cx, FY + WH / 2, cz);
      stand.add(wall);
      colliders.push({
        minX: cx - w / 2, maxX: cx + w / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
      });
    };
    addWall(SCX, z0, SW + WT, WT);          // BACK (-Z) full width
    addWall(x0, SCZ, WT, SD);               // LEFT (-X)
    addWall(x1, SCZ, WT, SD);               // RIGHT (+X)
    addWall(x0 + segW / 2, z1, segW, WT);   // FRONT (+Z) left of door
    addWall(x1 - segW / 2, z1, segW, WT);   // FRONT (+Z) right of door
    // doorway gap x ∈ [-1.1, 1.1] has NO wall + NO collider.

    // Door lintel (decorative, passable)
    const lintel = box(DOOR + 0.4, 0.5, WT, concTrimMat);
    lintel.position.set(SCX, FY + WH - 0.25, z1);
    stand.add(lintel);

    // ROOF + fascia
    const roof = box(SW + WT + 0.4, 0.2, SD + WT + 0.4, concRoofMat);
    roof.position.set(SCX, FY + WH + 0.1, SCZ);
    roof.castShadow = true;
    stand.add(roof);
    const fascia = box(SW + WT + 0.5, 0.3, SD + WT + 0.5, concTrimMat, false);
    fascia.position.set(SCX, FY + WH - 0.05, SCZ);
    stand.add(fascia);

    // Striped awning over the doorway (jaunty market-stall vibe)
    const awning = box(SW * 0.7, 0.12, 1.1, concTrimMat, false);
    awning.position.set(SCX, FY + WH - 0.55, z1 + 0.55);
    awning.rotation.x = -0.32;
    stand.add(awning);

    // SERVING COUNTER along the back, facing the door
    const counter = box(5.2, 1.0, 0.9, counterMat);
    counter.position.set(SCX, FY + 0.5, z0 + 1.1);
    stand.add(counter);
    const counterTop = box(5.4, 0.1, 1.1, counterTopMat, false);
    counterTop.position.set(SCX, FY + 1.05, z0 + 1.1);
    stand.add(counterTop);

    // GRIDDLE + FRYER on the counter
    const griddle = box(1.6, 0.18, 0.8, griddleMat);
    griddle.position.set(SCX - 1.4, FY + 1.19, z0 + 1.1);
    stand.add(griddle);
    const fryer = box(0.9, 0.5, 0.7, fryerMat);
    fryer.position.set(SCX + 1.5, FY + 1.35, z0 + 1.1);
    stand.add(fryer);

    // POPCORN MACHINE (cabinet + glowing kernels) on the right wall
    const popBase = box(0.9, 0.8, 0.8, ketchupMat);
    popBase.position.set(x1 - 0.7, FY + 0.4, SCZ + 1.6);
    stand.add(popBase);
    const popGlass = box(0.86, 0.7, 0.76, caseMat, false);
    popGlass.position.set(x1 - 0.7, FY + 1.15, SCZ + 1.6);
    stand.add(popGlass);
    const popcorn = box(0.7, 0.4, 0.6, popcornMat, false);
    popcorn.position.set(x1 - 0.7, FY + 1.0, SCZ + 1.6);
    stand.add(popcorn);

    // CONDIMENT SHELF on the left wall with ketchup/mustard/cup rows
    const condShelf = box(0.45, 0.07, 3.2, shelfMat, false);
    condShelf.position.set(x0 + 0.4, FY + 1.5, SCZ);
    stand.add(condShelf);
    {
      const bGeo = new THREE.BoxGeometry(0.22, 0.34, 0.22);
      const bMats = [ketchupMat, mustardMat, cupMat];
      for (let r = 0; r < 3; r++) {
        const inst = new THREE.InstancedMesh(bGeo, bMats[r], 3);
        inst.castShadow = true;
        const m = new THREE.Matrix4();
        for (let p = 0; p < 3; p++) {
          m.makeTranslation(x0 + 0.4, FY + 1.72, SCZ - 1.0 + (r * 3 + p) * 0.32 - 0.5);
          inst.setMatrixAt(p, m);
        }
        inst.instanceMatrix.needsUpdate = true;
        stand.add(inst);
      }
    }

    // BISTRO STOOLS at the doorway side of the counter
    for (const sx of [SCX - 1.4, SCX + 1.4]) {
      const stool = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6), stoolMat);
      legs.position.y = 0.35;
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12), mustardMat);
      seat.position.y = 0.74;
      legs.castShadow = seat.castShadow = true;
      stool.add(legs, seat);
      stool.position.set(sx, FY, z0 + 2.3);
      stand.add(stool);
    }

    // MENU BOARD on the back wall (interior, faces the door +Z)
    const menu = artPanel(3.0, 1.3, "sign", {
      text: "SNACKS · DRINKS", bg: "#7a2f1f", fg: "#ffe14d",
      emissiveIntensity: 0.4, file: "stadium-conc-menu.png",
    });
    menu.position.set(SCX, FY + 2.3, z0 + WT / 2 + 0.04);
    stand.add(menu);

    // HANGING BULB
    {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), stoolMat);
      cord.position.set(SCX, FY + WH - 0.35, SCZ + 0.4);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), shopBulbMat);
      bulb.position.set(SCX, FY + WH - 0.62, SCZ + 0.4);
      stand.add(cord, bulb);
    }

    // OUTSIDE STALL SIGN above the door (faces +Z toward the pitch approach;
    // artPanel faces +Z by default so no rotation needed).
    const standSign = artPanel(5.0, 1.2, "sign", {
      text: "MATCHDAY GRILL", bg: "#7a2f1f", fg: "#ffe14d",
      emissiveIntensity: 0.5, file: "stadium-conc-sign.png",
    });
    standSign.position.set(SCX, FY + WH + 0.55, z1 + WT / 2 + 0.05);
    stand.add(standSign);

    group.add(stand);
  }

  // --- ENTERABLE TICKET BOOTH (west apron) -----------------------------------
  // A compact walk-IN club-blue kiosk tucked on the -X apron, between the pitch
  // and the west gate, clear of the Z≈0 drive lane (sits at z≈+4.5). Smaller
  // footprint than the shops but still a real room: 4 walls + floor + roof with a
  // 1.8 m DOORWAY GAP in the +Z (pitch-facing) wall, a ticket counter with a
  // glass screen, a stub of tickets and a wall schedule. Within LOCAL [-23, 23].
  {
    const SW = 5.0;          // width (X)
    const SD = 4.2;          // depth (Z)
    const WT = 0.22;
    const WH = 3.0;
    const SCX = -16.0;       // centre X (west apron, clear of pitch oval RX=13.5)
    const SCZ = 4.6;         // centre Z (off the Z≈0 gate corridor)
    const x0 = SCX - SW / 2, x1 = SCX + SW / 2;
    const z0 = SCZ - SD / 2, z1 = SCZ + SD / 2;   // z1 = front (+Z) with door
    const DOOR = 1.8;
    const segW = (SW - DOOR) / 2;
    const FY = 0.13;

    const booth = new THREE.Group();

    const floor = box(SW, 0.12, SD, concFloorMat, false);
    floor.position.set(SCX, FY - 0.06, SCZ);
    floor.receiveShadow = true;
    booth.add(floor);

    const addWall = (cx, cz, w, d) => {
      const wall = box(w, WH, d, boothWallMat);
      wall.position.set(cx, FY + WH / 2, cz);
      booth.add(wall);
      colliders.push({
        minX: cx - w / 2, maxX: cx + w / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
      });
    };
    addWall(SCX, z0, SW + WT, WT);          // BACK (-Z)
    addWall(x0, SCZ, WT, SD);               // LEFT (-X)
    addWall(x1, SCZ, WT, SD);               // RIGHT (+X)
    addWall(x0 + segW / 2, z1, segW, WT);   // FRONT (+Z) left of door
    addWall(x1 - segW / 2, z1, segW, WT);   // FRONT (+Z) right of door
    // doorway gap (no wall / no collider)

    const lintel = box(DOOR + 0.4, 0.45, WT, boothTrimMat);
    lintel.position.set(SCX, FY + WH - 0.22, z1);
    booth.add(lintel);

    const roof = box(SW + WT + 0.4, 0.2, SD + WT + 0.4, boothRoofMat);
    roof.position.set(SCX, FY + WH + 0.1, SCZ);
    roof.castShadow = true;
    booth.add(roof);
    const fascia = box(SW + WT + 0.5, 0.28, SD + WT + 0.5, boothTrimMat, false);
    fascia.position.set(SCX, FY + WH - 0.05, SCZ);
    booth.add(fascia);

    // TICKET COUNTER across the back with a glass screen above
    const counter = box(3.4, 1.05, 0.7, counterMat);
    counter.position.set(SCX, FY + 0.52, z0 + 0.9);
    booth.add(counter);
    const counterTop = box(3.6, 0.1, 0.9, counterTopMat, false);
    counterTop.position.set(SCX, FY + 1.1, z0 + 0.9);
    booth.add(counterTop);
    const screen = box(3.2, 1.1, 0.06, caseMat, false);
    screen.position.set(SCX, FY + 1.75, z0 + 0.6);
    booth.add(screen);

    // A stub of printed tickets + a till on the counter
    const tickets = box(0.5, 0.12, 0.3, ticketMat, false);
    tickets.position.set(SCX - 0.9, FY + 1.21, z0 + 0.9);
    booth.add(tickets);
    const till = box(0.45, 0.3, 0.4, stoolMat);
    till.position.set(SCX + 1.0, FY + 1.3, z0 + 0.9);
    booth.add(till);

    // SCHEDULE / FIXTURE BOARD on the back wall (interior, faces +Z)
    const sched = artPanel(2.4, 1.2, "billboard", {
      title: "FIXTURES", sub: "GATES OPEN 6PM", a: "#16245a", b: "#070d1a",
      accent: "#ffd24a", glyph: "⚽", emissiveIntensity: 0.4, file: "stadium-fixtures.png",
    });
    sched.position.set(SCX, FY + 2.35, z0 + WT / 2 + 0.04);
    booth.add(sched);

    // hanging bulb
    {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 4), stoolMat);
      cord.position.set(SCX, FY + WH - 0.32, SCZ + 0.3);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), shopBulbMat);
      bulb.position.set(SCX, FY + WH - 0.56, SCZ + 0.3);
      booth.add(cord, bulb);
    }

    // OUTSIDE "TICKETS" sign above the door (faces +Z, no rotation needed)
    const boothSign = artPanel(3.4, 1.0, "sign", {
      text: "TICKETS", bg: "#16245a", fg: "#ffe14d",
      emissiveIntensity: 0.5, file: "stadium-tickets-sign.png",
    });
    boothSign.position.set(SCX, FY + WH + 0.5, z1 + WT / 2 + 0.05);
    booth.add(boothSign);

    group.add(booth);
  }

  // --- ENTERABLE STAND CAFE (south-west apron) -------------------------------
  // A fourth walk-IN unit: a matchday COFFEE kiosk tucked on the -X/-Z apron,
  // clear of the concession (x≥-4) and the Z≈0 drive lane. Real room: 4 walls +
  // floor + roof with a 1.8 m DOORWAY GAP in the +Z (pitch-facing) wall; each
  // solid wall pushes its own AABB, the doorway none, so the player walks
  // straight in. Inside: an espresso bar with a chrome machine + grinder, a
  // pastry case, coffee-bean sacks, stools and signage. The back wall nestles
  // just inside the innermost seating tier; all within LOCAL [-23, 23].
  {
    const SW = 5.0, SD = 4.0, WT = 0.22, WH = 3.0;
    const SCX = -8.0, SCZ = -5.6;
    const x0 = SCX - SW / 2, x1 = SCX + SW / 2;   // -10.5 .. -5.5
    const z0 = SCZ - SD / 2, z1 = SCZ + SD / 2;   // -7.6 .. -3.6 (z1 = front/door)
    const DOOR = 1.8;
    const segW = (SW - DOOR) / 2;
    const FY = 0.13;

    const cafe = new THREE.Group();

    const floor = box(SW, 0.12, SD, concFloorMat, false);
    floor.position.set(SCX, FY - 0.06, SCZ);
    floor.receiveShadow = true;
    cafe.add(floor);

    const addWall = (cx, cz, w, d) => {
      const wall = box(w, WH, d, cafeWallMat);
      wall.position.set(cx, FY + WH / 2, cz);
      cafe.add(wall);
      colliders.push({
        minX: cx - w / 2, maxX: cx + w / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
      });
    };
    addWall(SCX, z0, SW + WT, WT);          // BACK (-Z)
    addWall(x0, SCZ, WT, SD);               // LEFT (-X)
    addWall(x1, SCZ, WT, SD);               // RIGHT (+X)
    addWall(x0 + segW / 2, z1, segW, WT);   // FRONT (+Z) left of door
    addWall(x1 - segW / 2, z1, segW, WT);   // FRONT (+Z) right of door
    // doorway gap x ∈ [SCX-0.9, SCX+0.9] has NO wall + NO collider.

    const lintel = box(DOOR + 0.4, 0.45, WT, cafeTrimMat);
    lintel.position.set(SCX, FY + WH - 0.22, z1);
    cafe.add(lintel);

    const roof = box(SW + WT + 0.4, 0.2, SD + WT + 0.4, cafeRoofMat);
    roof.position.set(SCX, FY + WH + 0.1, SCZ);
    roof.castShadow = true;
    cafe.add(roof);
    const fascia = box(SW + WT + 0.5, 0.28, SD + WT + 0.5, cafeTrimMat, false);
    fascia.position.set(SCX, FY + WH - 0.05, SCZ);
    cafe.add(fascia);

    // Awning over the door — high above head height; NO collider (walk-under).
    const awning = box(SW * 0.7, 0.12, 1.0, cafeTrimMat, false);
    awning.position.set(SCX, FY + WH - 0.5, z1 + 0.5);
    awning.rotation.x = -0.3;
    cafe.add(awning);

    // ESPRESSO BAR counter along the back wall, facing the door
    const counter = box(3.6, 1.0, 0.8, counterMat);
    counter.position.set(SCX, FY + 0.5, z0 + 0.95);
    cafe.add(counter);
    const counterTop = box(3.8, 0.1, 1.0, counterTopMat, false);
    counterTop.position.set(SCX, FY + 1.05, z0 + 0.95);
    cafe.add(counterTop);

    // chrome espresso machine + a grinder on the counter
    const machine = box(1.1, 0.6, 0.6, espressoMat);
    machine.position.set(SCX - 0.9, FY + 1.4, z0 + 0.95);
    cafe.add(machine);
    const grinder = box(0.35, 0.55, 0.35, espressoMat);
    grinder.position.set(SCX, FY + 1.37, z0 + 0.95);
    cafe.add(grinder);

    // a small cluster of to-go cups on the counter (instanced)
    {
      const cupGeo = new THREE.CylinderGeometry(0.07, 0.05, 0.18, 8);
      const cups = new THREE.InstancedMesh(cupGeo, cafeCupMat, 5);
      cups.castShadow = true;
      const m = new THREE.Matrix4();
      for (let i = 0; i < 5; i++) {
        m.makeTranslation(SCX + 0.7 + (i % 3) * 0.22, FY + 1.19, z0 + 0.75 + ((i / 3) | 0) * 0.22);
        cups.setMatrixAt(i, m);
      }
      cups.instanceMatrix.needsUpdate = true;
      cafe.add(cups);
    }

    // PASTRY CASE by the right wall (glass cabinet + golden pastries)
    const caseBase = box(0.9, 0.9, 2.2, counterMat);
    caseBase.position.set(x1 - 0.55, FY + 0.45, SCZ);
    cafe.add(caseBase);
    const caseGlass = box(0.86, 0.7, 2.1, caseMat, false);
    caseGlass.position.set(x1 - 0.55, FY + 1.2, SCZ);
    cafe.add(caseGlass);
    {
      const pGeo = new THREE.BoxGeometry(0.3, 0.16, 0.3);
      const pastries = new THREE.InstancedMesh(pGeo, pastryMat, 4);
      pastries.castShadow = true;
      const m = new THREE.Matrix4();
      for (let i = 0; i < 4; i++) {
        m.makeTranslation(x1 - 0.55, FY + 0.98, SCZ - 0.75 + i * 0.5);
        pastries.setMatrixAt(i, m);
      }
      pastries.instanceMatrix.needsUpdate = true;
      cafe.add(pastries);
    }

    // COFFEE-BEAN SACKS on the floor by the left wall
    for (const sz of [SCZ - 0.6, SCZ + 0.4]) {
      const sack = box(0.55, 0.6, 0.55, beanSackMat);
      sack.position.set(x0 + 0.5, FY + 0.3, sz);
      cafe.add(sack);
    }

    // STOOLS at the counter
    for (const sx of [SCX - 0.9, SCX + 0.9]) {
      const stool = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6), stoolMat);
      legs.position.y = 0.35;
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12), cafeTrimMat);
      seat.position.y = 0.74;
      legs.castShadow = seat.castShadow = true;
      stool.add(legs, seat);
      stool.position.set(sx, FY, z0 + 2.1);
      cafe.add(stool);
    }

    // MENU BOARD on the back wall (interior, faces +Z toward the door)
    const menu = artPanel(2.6, 1.2, "sign", {
      text: "STAND CAFE", bg: "#1f6f5c", fg: "#ffe9ad",
      emissiveIntensity: 0.4, file: "stadium-cafe-menu.png",
    });
    menu.position.set(SCX, FY + 2.3, z0 + WT / 2 + 0.04);
    cafe.add(menu);

    // hanging bulb
    {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 4), stoolMat);
      cord.position.set(SCX, FY + WH - 0.32, SCZ + 0.3);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), shopBulbMat);
      bulb.position.set(SCX, FY + WH - 0.56, SCZ + 0.3);
      cafe.add(cord, bulb);
    }

    // OUTSIDE "MATCHDAY COFFEE" sign above the door — overhead panel, NO collider
    // so players walk straight under it. artPanel faces +Z by default → no rotate.
    const cafeSign = artPanel(4.4, 1.1, "sign", {
      text: "MATCHDAY COFFEE", bg: "#3f2a1c", fg: "#ffe9ad",
      emissiveIntensity: 0.5, file: "stadium-cafe-sign.png",
    });
    cafeSign.position.set(SCX, FY + WH + 0.5, z1 + WT / 2 + 0.05);
    cafe.add(cafeSign);

    group.add(cafe);

    // Outdoor flavour by the cafe: a hedge planter at the left-front corner + a
    // short A-frame sandwich board to one side (both ground props, tight AABBs,
    // neither blocks the 1.8 m doorway).
    const pot = box(1.0, 0.6, 1.0, planterMat);
    pot.position.set(x0 - 0.2, FY + 0.3, z1 + 0.4);
    const hedge = box(0.9, 0.45, 0.9, hedgeMat);
    hedge.position.set(x0 - 0.2, FY + 0.8, z1 + 0.4);
    hedge.castShadow = true;
    group.add(pot, hedge);
    colliders.push({ minX: x0 - 0.7, maxX: x0 + 0.3, minZ: z1 - 0.1, maxZ: z1 + 0.9 });

    {
      const aframe = new THREE.Group();
      for (const s of [-1, 1]) {
        const leaf = artPanel(0.7, 1.0, "sign", {
          text: "OPEN", bg: "#1f6f5c", fg: "#ffe9ad",
          emissiveIntensity: 0.35, file: "stadium-cafe-aframe.png",
        });
        leaf.position.set(0, 0.5, s * 0.18);
        leaf.rotation.x = s * 0.22;
        aframe.add(leaf);
      }
      aframe.position.set(SCX + 1.7, FY, z1 + 0.7);
      group.add(aframe);
      colliders.push({ minX: SCX + 1.4, maxX: SCX + 2.0, minZ: z1 + 0.4, maxZ: z1 + 1.0 });
    }
  }

  // --- STREET-LEVEL FLAVOUR PROPS (benches, planters, crates, bins, lamps) ----
  // Lived-in pitchside dressing scattered on clear apron ground between the pitch
  // oval (RX 13.5 / RZ 10) and the seating tiers, kept OFF the Z≈0 drive corridor
  // and away from the shop/booth footprints. Each solid prop pushes a small AABB.
  {
    // Reusable park-style bench (slatted seat + back + two legs).
    const addBench = (px, pz, rotY) => {
      const b = new THREE.Group();
      const seat = box(2.2, 0.12, 0.5, benchWoodMat);
      seat.position.y = 0.5;
      const back = box(2.2, 0.5, 0.12, benchWoodMat);
      back.position.set(0, 0.78, -0.2);
      const legL = box(0.12, 0.5, 0.5, benchLegMat);
      legL.position.set(-0.95, 0.25, 0);
      const legR = legL.clone();
      legR.position.x = 0.95;
      b.add(seat, back, legL, legR);
      b.position.set(px, 0.13, pz);
      b.rotation.y = rotY;
      group.add(b);
      // collider in WORLD-axis local space (bench is roughly axis-aligned)
      const halfX = Math.abs(Math.cos(rotY)) > 0.5 ? 1.2 : 0.4;
      const halfZ = Math.abs(Math.cos(rotY)) > 0.5 ? 0.4 : 1.2;
      colliders.push({ minX: px - halfX, maxX: px + halfX, minZ: pz - halfZ, maxZ: pz + halfZ });
    };
    // Benches along the east apron (between pitch and east gate), facing the pitch.
    addBench(16.0, -4.0, Math.PI / 2);
    addBench(16.0, 4.0, Math.PI / 2);
    addBench(-9.5, -8.6, 0);

    // Planters with a hedge cap — a couple framing the merch-shop approach.
    const addPlanter = (px, pz) => {
      const pot = box(1.2, 0.7, 1.2, planterMat);
      pot.position.set(px, 0.13 + 0.35, pz);
      const hedge = box(1.1, 0.5, 1.1, hedgeMat);
      hedge.position.set(px, 0.13 + 0.95, pz);
      hedge.castShadow = true;
      group.add(pot, hedge);
      colliders.push({ minX: px - 0.65, maxX: px + 0.65, minZ: pz - 0.65, maxZ: pz + 0.65 });
    };
    addPlanter(-4.8, 3.2);
    addPlanter(4.8, 3.2);
    addPlanter(11.5, 8.2);
    addPlanter(-11.5, -8.2);

    // Stacked supply crates near the concession stand.
    const addCrate = (px, py, pz, s) => {
      const c = box(s, s, s, crateMat);
      c.position.set(px, 0.13 + s / 2 + py, pz);
      group.add(c);
      if (py === 0) colliders.push({ minX: px - s / 2, maxX: px + s / 2, minZ: pz - s / 2, maxZ: pz + s / 2 });
    };
    addCrate(4.6, 0, -8.4, 0.9);
    addCrate(4.6, 0.9, -8.4, 0.7);
    addCrate(5.6, 0, -8.6, 0.8);

    // Litter bins (cylinders) dotted around — small colliders.
    const addBin = (px, pz) => {
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.9, 12), binMat);
      bin.position.set(px, 0.13 + 0.45, pz);
      bin.castShadow = true;
      group.add(bin);
      colliders.push({ minX: px - 0.35, maxX: px + 0.35, minZ: pz - 0.35, maxZ: pz + 0.35 });
    };
    addBin(-6.5, 4.6);
    addBin(6.5, 4.6);
    addBin(12.5, 4.6);

    // Entrance TURNSTILES flanking each ±X gate (a row of rotating-arm posts).
    const addTurnstile = (px, pz) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.1, 10), turnstileMat);
      post.position.set(px, 0.13 + 0.55, pz);
      post.castShadow = true;
      const arm = box(1.3, 0.08, 0.08, turnstileMat, false);
      arm.position.set(px, 0.13 + 0.95, pz);
      group.add(post, arm);
      colliders.push({ minX: px - 0.3, maxX: px + 0.3, minZ: pz - 0.3, maxZ: pz + 0.3 });
    };
    // Place turnstiles just inside each gate, OFF the Z≈0 centre lane so cars pass.
    addTurnstile(18.5, 2.6);
    addTurnstile(18.5, -2.6);
    addTurnstile(-18.5, 2.6);
    addTurnstile(-18.5, -2.6);

    // Bollard path lights lining the apron — short posts with emissive caps.
    const addBollard = (px, pz) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.0, 8), towerMat);
      post.position.set(px, 0.13 + 0.5, pz);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bollardLampMat);
      cap.position.set(px, 0.13 + 1.05, pz);
      group.add(post, cap);
      colliders.push({ minX: px - 0.18, maxX: px + 0.18, minZ: pz - 0.18, maxZ: pz + 0.18 });
    };
    // NOTE: keep all bollards OFF the Z≈0 drive corridor so a car can pass the
    // ±X gates; the two pitch-end pairs sit at |z|≈3.4, flanking the goal mouths.
    for (const [bx, bz] of [
      [-9.0, 8.8], [9.0, 8.8], [-9.0, -8.8], [9.0, -8.8],
      [14.6, 3.4], [14.6, -3.4], [-14.6, 3.4], [-14.6, -3.4],
    ]) addBollard(bx, bz);
  }

  // --- update: flicker floodlights + orbit blimp -----------------------------
  let tAcc = 0;
  const baseIntensity = 1.0;
  const update = (dt) => {
    tAcc += dt;
    // Subtle synchronized buzz/flicker on the lamp heads (shared material).
    const flick = baseIntensity + Math.sin(tAcc * 9.0) * 0.08 + (Math.sin(tAcc * 37.0) > 0.96 ? -0.25 : 0);
    lampMat.emissiveIntensity = flick;
    // Orbit the blimp slowly over the pitch.
    const ang = tAcc * 0.18;
    blimp.position.set(Math.cos(ang) * 14, 18 + Math.sin(tAcc * 0.5) * 0.6, Math.sin(ang) * 10);
    blimp.rotation.y = -ang + Math.PI / 2;
  };

  // --- Colliders for the grandstand shell ------------------------------------
  // The stand is two thick oval arcs; approximate each with box colliders so
  // players/cars can't pass through the structure. We SKIP segments near the ±X
  // poles so the east/west gates stay open — a car can drive straight through the
  // tile along the Z≈0 corridor (gate openings are ~14 m wide). Pitch is open.
  // Colliders sit on the wall's MID radius and are sized to the new thickness.
  const SEG = 20;
  const GATE_SKIP = 0.5; // skip segments whose angle is within this of a pole
  const midRX = WALL_RX - THICK / 2, midRZ = WALL_RZ - THICK / 2;
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    // distance of this angle from the +X (0) or -X (π) gate centers
    const dGate = Math.min(Math.abs(a), Math.abs(a - Math.PI), Math.abs(a - 2 * Math.PI));
    if (dGate < GATE_SKIP) continue; // leave the gate corridor clear
    const cx = Math.cos(a) * midRX;
    const cz = Math.sin(a) * midRZ;
    const half = 2.8; // box bridging to the next segment
    colliders.push({
      minX: cx - half, maxX: cx + half,
      minZ: cz - half, maxZ: cz + half,
    });
  }

  return { group, colliders, ground, update };
}
