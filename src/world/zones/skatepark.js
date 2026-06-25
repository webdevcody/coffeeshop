// SKATE PARK — a hero district: a gritty, colorful concrete skate plaza filling a
// 60×60 m tile centered on the origin. It reads as a real place: a shallow bowl
// (segmented curved ramp), a quarter-pipe, a funbox, a flat grind rail, a ledge,
// graffiti murals on low walls, a halfpipe silhouette and scattered traffic cones.
//
// CRUCIAL design rule: the plaza stays mostly OPEN and FLAT so a skater rolls
// freely. Ramps/bowls are VISUAL only — they get NO tall colliders. The only
// colliders are thin rail/ledge footprints and the low mural walls around the
// rim, leaving wide (>= 6 m) lanes through the middle for a car to drive through.
//
// buildSkatepark() returns { group, colliders, ground, update } in LOCAL coords:
//   group     — THREE.Group of all meshes (centered on origin)
//   colliders — AABBs { minX,maxX,minZ,maxZ } for solid props only
//   ground    — walkable rects (includes the full 60×60 tile)
//   update(dt)— cheap ambient animation (flickering neon, swaying flag, spin sign)

import * as THREE from "three";
import { artPanel, artMaterial } from "../cityArt.js";

// --- Shared materials (created ONCE, reused across props) -------------------
const pavement = new THREE.MeshStandardMaterial({ color: "#8d8a86", roughness: 0.97 });
const slabSide = new THREE.MeshStandardMaterial({ color: "#6f6c68", roughness: 1 });
const concrete = new THREE.MeshStandardMaterial({ color: "#b4b0a8", roughness: 0.92 });
const concreteDark = new THREE.MeshStandardMaterial({ color: "#8f8b82", roughness: 0.95 });
const rampPaint = new THREE.MeshStandardMaterial({ color: "#d8d4cc", roughness: 0.85 });
const coping = new THREE.MeshStandardMaterial({ color: "#c9c4b8", roughness: 0.5, metalness: 0.4 });
const railMat = new THREE.MeshStandardMaterial({ color: "#d7d9dc", roughness: 0.35, metalness: 0.85 });
const ledgeTop = new THREE.MeshStandardMaterial({ color: "#e0b94a", roughness: 0.6 });
const coneMat = new THREE.MeshStandardMaterial({ color: "#ee6a25", roughness: 0.7 });
const coneStripe = new THREE.MeshStandardMaterial({ color: "#f2efe8", roughness: 0.7 });
const poleMat = new THREE.MeshStandardMaterial({ color: "#2b2e32", roughness: 0.5, metalness: 0.7 });
const lampGlass = new THREE.MeshStandardMaterial({ color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 0.9, roughness: 0.4 });
const flagMat = new THREE.MeshStandardMaterial({ color: "#e23b6d", roughness: 0.8, side: THREE.DoubleSide });
const benchWood = new THREE.MeshStandardMaterial({ color: "#5f7d3c", roughness: 0.8 });
const lineYellow = new THREE.MeshStandardMaterial({ color: "#e7d061", roughness: 0.6 });
const deckMat = new THREE.MeshStandardMaterial({ color: "#c8492f", roughness: 0.6 });
const wheelMat = new THREE.MeshStandardMaterial({ color: "#1c1c22", roughness: 0.7 });
// Building shell materials (full-volume back-rim structures: skate shop, cafe,
// halfpipe house). Brick/stucco walls + a parapet roof so each reads as a real,
// solid building from front, side AND back — not a thin facade panel.
const brickMat = new THREE.MeshStandardMaterial({ color: "#9c5d49", roughness: 0.95 });
const stuccoMat = new THREE.MeshStandardMaterial({ color: "#cdbfa6", roughness: 0.92 });
const roofMat = new THREE.MeshStandardMaterial({ color: "#41454c", roughness: 0.9 });
const parapetMat = new THREE.MeshStandardMaterial({ color: "#6f6c66", roughness: 0.9 });
const winMat = new THREE.MeshStandardMaterial({ color: "#8fb6c9", roughness: 0.25, metalness: 0.5, emissive: "#22323b", emissiveIntensity: 0.3 });
const doorMat = new THREE.MeshStandardMaterial({ color: "#2c2f36", roughness: 0.6, metalness: 0.3 });
const awningMat = new THREE.MeshStandardMaterial({ color: "#cf3f5c", roughness: 0.8, side: THREE.DoubleSide });
// Enterable skate-shop interior materials (created ONCE, reused).
const shopWallMat = new THREE.MeshStandardMaterial({ color: "#3a4654", roughness: 0.9, side: THREE.DoubleSide });
const shopFloorMat = new THREE.MeshStandardMaterial({ color: "#7a6a55", roughness: 0.95 });
const shopRoofMat = new THREE.MeshStandardMaterial({ color: "#262b33", roughness: 0.92, side: THREE.DoubleSide });
const shopCounterMat = new THREE.MeshStandardMaterial({ color: "#9c5a32", roughness: 0.7 });
const shopCounterTop = new THREE.MeshStandardMaterial({ color: "#1f242b", roughness: 0.5, metalness: 0.3 });
const shopShelfMat = new THREE.MeshStandardMaterial({ color: "#caa46a", roughness: 0.8 });
const shopRugMat = new THREE.MeshStandardMaterial({ color: "#b8324f", roughness: 0.95 });
const shopStoolMat = new THREE.MeshStandardMaterial({ color: "#23262c", roughness: 0.6, metalness: 0.2 });
const shopGlassMat = new THREE.MeshStandardMaterial({ color: "#9fd0e0", roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
const shopBulbMat = new THREE.MeshStandardMaterial({ color: "#fff0c8", emissive: "#ffdf9a", emissiveIntensity: 1.0, roughness: 0.3 });
// Deck-product palette for shelved skateboard decks (instanced repeat).
const deckProductMats = [
  new THREE.MeshStandardMaterial({ color: "#e0552e", roughness: 0.55 }),
  new THREE.MeshStandardMaterial({ color: "#2f9e8f", roughness: 0.55 }),
  new THREE.MeshStandardMaterial({ color: "#e7c23a", roughness: 0.55 }),
  new THREE.MeshStandardMaterial({ color: "#5b6bd0", roughness: 0.55 }),
];

// --- Shared geometries (created ONCE, reused) ------------------------------
const coneConeGeo = new THREE.ConeGeometry(0.22, 0.62, 12);
const coneBaseGeo = new THREE.BoxGeometry(0.5, 0.06, 0.5);
const coneRingGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.1, 12);
const railPostGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8);
const railBarGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 10); // scaled in X via length
const lampPoleGeo = new THREE.BoxGeometry(0.16, 5.0, 0.16);
const lampHeadGeo = new THREE.SphereGeometry(0.26, 12, 10);
const winGeo = new THREE.BoxGeometry(0.9, 1.2, 0.12); // upper-floor window pane (instanced)
const shopDeckGeo = new THREE.BoxGeometry(0.22, 0.9, 0.04); // a skate deck standing on a shelf
const shopWheelGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12); // boxed wheel set on a shelf

function box(w, h, d, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function addCollider(colliders, cx, cz, w, d) {
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// A segmented curved ramp face (a few angled slabs approximating a quarter-curve).
// Rises from y=0 at the front to `height` at the back over `depth`. Purely visual.
function makeCurvedRamp(width, depth, height, segs, mat) {
  const g = new THREE.Group();
  const segDepth = depth / segs;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    // ease-out curve so it's shallow near the floor, steeper up top (bowl feel)
    const y0 = height * (1 - Math.cos((t0 * Math.PI) / 2));
    const y1 = height * (1 - Math.cos((t1 * Math.PI) / 2));
    const slabH = 0.18;
    const slab = box(width, slabH, segDepth * 1.18, mat);
    const my = (y0 + y1) / 2;
    const angle = Math.atan2(y1 - y0, segDepth);
    slab.position.set(0, my + slabH / 2, -depth / 2 + segDepth * (i + 0.5));
    slab.rotation.x = -angle;
    g.add(slab);
  }
  return g;
}

export function buildSkatepark() {
  const group = new THREE.Group();
  const colliders = [];

  // === Ground slab — pavement reads as a real plaza ========================
  const slab = box(60, 0.2, 60, pavement, false);
  slab.position.y = -0.1;
  slab.receiveShadow = true;
  slab.castShadow = false;
  group.add(slab);
  // slab edge skirt so the tile has thickness when viewed from outside
  const skirt = box(60.2, 0.5, 60.2, slabSide, false);
  skirt.position.y = -0.35;
  group.add(skirt);

  // Painted plaza guide lines (flat decals, walked over — NO colliders)
  for (const z of [-18, 0, 18]) {
    const ln = box(48, 0.02, 0.18, lineYellow, false);
    ln.position.set(0, 0.02, z);
    ln.receiveShadow = false;
    group.add(ln);
  }

  // === Shallow BOWL — segmented curved ramp ring (visual, no collider) =====
  // Two opposing curved walls form a wide shallow bowl in the NW area.
  const bowlX = -14, bowlZ = -12;
  const bowlA = makeCurvedRamp(14, 6, 1.7, 4, rampPaint);
  bowlA.position.set(bowlX, 0, bowlZ - 5);
  bowlA.rotation.y = 0; // faces +Z (inward)
  group.add(bowlA);
  const bowlB = makeCurvedRamp(14, 6, 1.7, 4, rampPaint);
  bowlB.position.set(bowlX, 0, bowlZ + 5);
  bowlB.rotation.y = Math.PI; // faces -Z (inward)
  group.add(bowlB);
  // coping lips along the top rim of each bowl wall
  const copeA = box(14, 0.12, 0.22, coping);
  copeA.position.set(bowlX, 1.72, bowlZ - 8);
  group.add(copeA);
  const copeB = box(14, 0.12, 0.22, coping);
  copeB.position.set(bowlX, 1.72, bowlZ + 8);
  group.add(copeB);

  // === QUARTER-PIPE — single curved ramp against the east rim (visual) =====
  const qpX = 18, qpZ = -8;
  const quarter = makeCurvedRamp(10, 5.5, 2.4, 5, rampPaint);
  quarter.position.set(qpX, 0, qpZ);
  quarter.rotation.y = -Math.PI / 2; // curve rises toward +X (east wall)
  group.add(quarter);
  const qpCope = box(0.22, 0.12, 10, coping);
  qpCope.position.set(qpX + 2.6, 2.42, qpZ);
  group.add(qpCope);

  // === FUNBOX — low flat-topped box with a flat top to skate over =========
  // Short enough to roll over; only the small core gets a tight low collider.
  const fbX = 6, fbZ = 10;
  const funTop = box(6, 0.7, 4, concrete);
  funTop.position.set(fbX, 0.35, fbZ);
  group.add(funTop);
  // angled approach slabs on two ends (visual, walk-over)
  const funRampA = box(6, 0.12, 2.2, rampPaint);
  funRampA.position.set(fbX, 0.32, fbZ - 3);
  funRampA.rotation.x = -Math.atan2(0.7, 2.2);
  group.add(funRampA);
  const funRampB = box(6, 0.12, 2.2, rampPaint);
  funRampB.position.set(fbX, 0.32, fbZ + 3);
  funRampB.rotation.x = Math.atan2(0.7, 2.2);
  group.add(funRampB);
  // a ledge/grind edge bar across the top of the funbox
  const funEdge = box(6, 0.1, 0.12, coping);
  funEdge.position.set(fbX, 0.72, fbZ - 2);
  group.add(funEdge);
  // tight low collider only on the solid core (a car would bump this — keep small)
  addCollider(colliders, fbX, fbZ, 6, 4);

  // === FLAT GRIND RAIL — thin rail, only thin collider ====================
  function makeRail(len) {
    const g = new THREE.Group();
    const bar = new THREE.Mesh(railBarGeo, railMat);
    bar.scale.y = len; // cylinder is unit-length along Y; rotate to lie along X
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 0.5;
    bar.castShadow = true;
    g.add(bar);
    for (const x of [-len / 2 + 0.3, 0, len / 2 - 0.3]) {
      const post = new THREE.Mesh(railPostGeo, railMat);
      post.position.set(x, 0.25, 0);
      post.castShadow = true;
      g.add(post);
    }
    return g;
  }
  const rail = makeRail(8);
  rail.position.set(-4, 0, 4);
  group.add(rail);
  // thin rail collider (the only allowed ramp-area collider type)
  addCollider(colliders, -4, 4, 8, 0.3);

  // === LEDGE — a long low grind ledge (thin, low collider) ================
  const ledgeX = -16, ledgeZ = 16;
  const ledgeBody = box(10, 0.55, 0.8, concreteDark);
  ledgeBody.position.set(ledgeX, 0.275, ledgeZ);
  group.add(ledgeBody);
  const ledgeCap = box(10, 0.08, 0.8, ledgeTop, false);
  ledgeCap.position.set(ledgeX, 0.59, ledgeZ);
  group.add(ledgeCap);
  addCollider(colliders, ledgeX, ledgeZ, 10, 0.8);

  // === BACK-RIM BUILDINGS — full-volume storefronts (skate shop + cafe) =====
  // Previously these were paper-thin (0.4 m) mural facade slabs — standing cards
  // with nothing behind them. They are now SOLID, full-size buildings: a real
  // multi-metre-deep brick/stucco mass with a parapet roof, upper-floor windows,
  // a recessed shopfront, a door and an awning, so each reads as a coherent
  // structure from the front, the side AND the back. The detailed FRONT (mural +
  // shopfront + awning) faces -Z toward the plaza, since the player crosses the
  // tile from the -Z side. They sit along the +Z back rim, fully inside [-30,30]
  // and clear of the wide central lanes and the corner lamp posts.
  //
  // Window panes are batched into ONE shared InstancedMesh (built after the loop)
  // so repeated detail costs a single draw call and no per-frame allocation.
  const winMatrices = [];
  const _wm = new THREE.Matrix4();
  function addWindow(x, y, z, ry) {
    _wm.makeRotationY(ry);
    _wm.setPosition(x, y, z);
    winMatrices.push(_wm.clone());
  }

  // One storefront building. (cx,cz) is the footprint centre; the FRONT faces -Z.
  // w = width (X), d = depth (Z, the volume BEHIND the facade), h = wall height.
  function makeStorefront(cx, cz, w, d, h, wallMatRef, tag, tagColor, file, awningColor) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    const frontZ = -d / 2; // plaza-facing face (local -Z)

    // Main solid mass — real width, depth AND height (a true 3D volume).
    const body = box(w, h, d, wallMatRef);
    body.position.set(0, h / 2, 0);
    g.add(body);

    // Parapet roof rim sitting just proud of the walls all the way around, so
    // the roofline reads as a building top from every angle (not an open slab).
    const para = box(w + 0.4, 0.5, d + 0.4, parapetMat, false);
    para.position.set(0, h + 0.25, 0);
    g.add(para);
    const roof = box(w - 0.2, 0.2, d - 0.2, roofMat, false);
    roof.position.set(0, h + 0.05, 0);
    g.add(roof);

    // Graffiti / sign mural across the upper FRONT (local -Z) face. artPanel
    // faces +Z by default, so rotate 180° to point it at -Z (the plaza) and seat
    // it just off the wall so it never z-fights or reads mirrored.
    const mural = artPanel(w - 1.0, 1.7, "mural", {
      tag,
      tagColor,
      sky: ["#2a1742", "#b5417a", "#f4a04b"],
      file,
    });
    mural.position.set(0, h - 1.2, frontZ - 0.06);
    mural.rotation.y = Math.PI;
    g.add(mural);

    // Recessed shopfront band on the ground floor (a real storefront, set into
    // the FRONT face) with a glass strip and an entry door.
    const sill = box(w - 0.8, 1.4, 0.25, doorMat, false);
    sill.position.set(0, 1.0, frontZ + 0.1);
    g.add(sill);
    const glass = box(w - 1.6, 1.0, 0.1, winMat, false);
    glass.position.set(-0.1, 1.05, frontZ - 0.03);
    g.add(glass);
    const door = box(1.1, 2.0, 0.12, doorMat, false);
    door.position.set(w / 2 - 1.4, 1.0, frontZ - 0.05);
    g.add(door);

    // Awning over the shopfront, sloping out over the -Z front (toward plaza).
    const awnMat = awningColor
      ? new THREE.MeshStandardMaterial({ color: awningColor, roughness: 0.8, side: THREE.DoubleSide })
      : awningMat;
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.1, 1.4), awnMat);
    awning.position.set(0, 2.25, frontZ - 0.7);
    awning.rotation.x = -0.32;
    awning.castShadow = true;
    g.add(awning);

    // Upper-floor windows across the FRONT face (batched into the instanced mesh).
    const cols = Math.max(2, Math.floor((w - 1.5) / 1.7));
    const span = w - 1.6;
    for (let i = 0; i < cols; i++) {
      const wx = cx + (-span / 2 + (span / (cols - 1 || 1)) * i);
      addWindow(wx, h - 1.15, cz + frontZ - 0.04, Math.PI);
    }
    // A couple of windows on the visible SIDE face so the depth reads from the
    // side too (these face ±X).
    for (const sz of [-d / 4, d / 4]) {
      addWindow(cx - w / 2 - 0.04, h - 1.15, cz + sz, -Math.PI / 2);
      addWindow(cx + w / 2 + 0.04, h - 1.15, cz + sz, Math.PI / 2);
    }

    group.add(g);
    // Footprint collider matches the FULL new volume (width × depth), pulled back
    // out of the lanes along the +Z rim.
    addCollider(colliders, cx, cz, w, d);
  }

  // Skate shop (left) and cafe (right) along the +Z back rim. SET BACK ~7 m from
  // the +Z tile edge (z=30) so they clear the seam road + kerb + sidewalk: depth
  // 6.5 m, centre z=19.5 → each spans z=[16.25,22.75], fully inside the building
  // keep-out box (local X,Z in [-23,23]). X ranges x=[-16,-5] / [5,16] stay clear
  // of the avenue seams at the ±X tile edges and of the corner lamps at x=±26.
  makeStorefront(-10.5, 19.5, 11, 6.5, 4.2, brickMat, "SHRED", "#37e0c2", "mural-shred.png", "#37b8a0");
  makeStorefront(10.5, 19.5, 11, 6.5, 4.2, stuccoMat, "CAFE", "#ffd24a", "mural-cafe.png", "#cf3f5c");

  // === HALFPIPE HOUSE — a tall full-volume building on the far (-Z) edge ======
  // Previously a flat billboard "card" with only frame posts. Now a real,
  // two-storey building mass with depth behind a halfpipe-silhouette mural on its
  // plaza-facing (+Z) FRONT. SET BACK ~7 m from the -Z tile edge (z=-30) so it
  // clears the seam road + kerb + sidewalk: depth 6.5, centre z=-19.5 → spans
  // z=[-22.75,-16.25], inside the building keep-out box (local X,Z in [-23,23]).
  // Width 16 → x=[-8,8] (clear of the corner lamps at x=±26).
  {
    const hpX = 0, hpZ = -19.5, hpW = 16, hpD = 6.5, hpH = 7.0;
    const hg = new THREE.Group();
    hg.position.set(hpX, 0, hpZ);
    const frontZ = hpD / 2; // plaza-facing face is the +Z side here

    const hbody = box(hpW, hpH, hpD, concrete);
    hbody.position.set(0, hpH / 2, 0);
    hg.add(hbody);
    // stepped parapet roof
    const hpara = box(hpW + 0.5, 0.6, hpD + 0.5, parapetMat, false);
    hpara.position.set(0, hpH + 0.3, 0);
    hg.add(hpara);
    const hroof = box(hpW - 0.3, 0.25, hpD - 0.3, roofMat, false);
    hroof.position.set(0, hpH + 0.1, 0);
    hg.add(hroof);

    // Halfpipe silhouette mural across the +Z FRONT (faces the plaza, +Z, which
    // is artPanel's default orientation — no rotation, so text reads correctly).
    const hmural = artPanel(hpW - 1.2, 5.0, "mural", {
      tag: "HALFPIPE",
      tagColor: "#ff6a2b",
      sky: ["#10243f", "#1f5fa0", "#5fc8ff"],
      file: "mural-halfpipe.png",
    });
    hmural.position.set(0, hpH - 3.0, frontZ + 0.06);
    hg.add(hmural);

    // Big ground-floor garage/shop door + flanking windows on the front.
    const hdoor = box(4.2, 2.6, 0.14, doorMat, false);
    hdoor.position.set(0, 1.3, frontZ - 0.02);
    hg.add(hdoor);
    group.add(hg);

    // Front + side windows (batched into the shared instanced mesh).
    for (const wx of [-5.6, -2.0, 2.0, 5.6]) {
      addWindow(hpX + wx, hpH - 4.6, hpZ + frontZ - 0.04, 0);
    }
    for (const sz of [-hpD / 4, hpD / 4]) {
      addWindow(hpX - hpW / 2 - 0.04, hpH - 4.6, hpZ + sz, -Math.PI / 2);
      addWindow(hpX + hpW / 2 + 0.04, hpH - 4.6, hpZ + sz, Math.PI / 2);
    }

    // Full-volume footprint collider, pulled back to the -Z rim and out of lanes.
    addCollider(colliders, hpX, hpZ, hpW, hpD);
  }

  // Emit ALL building window panes as ONE InstancedMesh (single draw call).
  if (winMatrices.length) {
    const wins = new THREE.InstancedMesh(winGeo, winMat, winMatrices.length);
    wins.castShadow = false;
    wins.receiveShadow = true;
    for (let i = 0; i < winMatrices.length; i++) wins.setMatrixAt(i, winMatrices[i]);
    wins.instanceMatrix.needsUpdate = true;
    group.add(wins);
  }

  // === TRAFFIC CONES — scattered, walk-over (NO colliders) =================
  function makeCone() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(coneBaseGeo, coneMat);
    base.position.y = 0.03;
    base.castShadow = true;
    g.add(base);
    const body = new THREE.Mesh(coneConeGeo, coneMat);
    body.position.y = 0.34;
    body.castShadow = true;
    const ring = new THREE.Mesh(coneRingGeo, coneStripe);
    ring.position.y = -0.02; // sits on the cone body
    body.add(ring);
    g.add(body);
    return g;
  }
  const conePositions = [
    [-2, -4], [2, -6], [12, 4], [-12, 2],
    [4, -14], [-6, 14], [10, -2],
  ];
  for (const [cx, cz] of conePositions) {
    const cone = makeCone();
    cone.position.set(cx, 0, cz);
    cone.rotation.y = Math.random() * Math.PI;
    group.add(cone);
  }

  // === Corner LAMP POSTS (solid props → colliders) ========================
  function makeLamp() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(lampPoleGeo, poleMat);
    pole.position.y = 2.5;
    pole.castShadow = true;
    g.add(pole);
    const head = new THREE.Mesh(lampHeadGeo, lampGlass);
    head.position.y = 5.0;
    g.add(head);
    return g;
  }
  const lampPositions = [[-26, -26], [26, -26], [-26, 26], [26, 26]];
  for (const [lx, lz] of lampPositions) {
    const lamp = makeLamp();
    lamp.position.set(lx, 0, lz);
    group.add(lamp);
    addCollider(colliders, lx, lz, 0.4, 0.4);
  }

  // === A spinning skate-deck pylon sign (the rotating ambient piece) =======
  const signGroup = new THREE.Group();
  const signPole = box(0.18, 4.0, 0.18, poleMat);
  signPole.position.y = 2.0;
  signGroup.add(signPole);
  const deck = artPanel(1.1, 3.2, "deck", { glyph: "☠", accent: "#ff6a2b", a: "#161620", b: "#33121b" });
  deck.position.y = 4.0;
  const spinner = new THREE.Group();
  spinner.add(deck);
  spinner.position.y = 0;
  signGroup.add(spinner);
  signGroup.position.set(22, 0, 18);
  group.add(signGroup);
  addCollider(colliders, 22, 18, 0.4, 0.4);

  // === A neon "SKATE PARK" sign on a low post (flickers in update) =========
  const neon = artPanel(4.2, 2.2, "neon", {
    lines: ["SKATE", "PARK"],
    color: "#ff4fa3",
    color2: "#4fd2ff",
    emissiveIntensity: 0.9,
    file: "neon-skatepark.png",
  });
  // This SW marquee sits at the back (z=18); the player crosses the plaza from
  // -Z, so the neon FRONT must face -Z (toward the plaza), angled slightly toward
  // the plaza centre (+X). artPanel faces +Z, so rotate ~180° to point it at -Z.
  neon.position.set(-22, 3.2, 18);
  neon.rotation.y = Math.PI - Math.PI / 6;
  group.add(neon);
  // Support posts straddle the sign in X and sit just BEHIND the -Z front face
  // (toward +Z) so they never poke through the readable face.
  const neonPostA = box(0.16, 2.4, 0.16, poleMat);
  neonPostA.position.set(-23.6, 1.2, 18.6);
  group.add(neonPostA);
  const neonPostB = box(0.16, 2.4, 0.16, poleMat);
  neonPostB.position.set(-20.4, 1.2, 18.2);
  group.add(neonPostB);

  // === A swaying pennant flag on a corner pole (ambient sway) =============
  const flagPole = box(0.1, 5.0, 0.1, poleMat);
  flagPole.position.set(20, 2.5, -22);
  group.add(flagPole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), flagMat);
  flag.position.set(20.8, 4.4, -22);
  group.add(flag);

  // === A couple of low planter benches to sit/grind (low colliders) ========
  function makeBench() {
    const g = new THREE.Group();
    const seat = box(2.0, 0.16, 0.5, benchWood);
    seat.position.y = 0.42;
    g.add(seat);
    for (const x of [-0.85, 0.85]) {
      const leg = box(0.14, 0.42, 0.46, concreteDark);
      leg.position.set(x, 0.21, 0);
      g.add(leg);
    }
    return g;
  }
  // Benches sit in the OPEN plaza in front of the (now set-back) rim buildings,
  // not inside their footprints.
  const benchA = makeBench();
  benchA.position.set(-2, 0, 13);
  group.add(benchA);
  addCollider(colliders, -2, 13, 2.0, 0.5);

  const benchB = makeBench();
  benchB.position.set(2, 0, -13);
  group.add(benchB);
  addCollider(colliders, 2, -13, 2.0, 0.5);

  // === A lone skateboard prop lying on the ground (decor, walk-over) =======
  const sk = new THREE.Group();
  const skDeck = box(0.85, 0.06, 0.24, deckMat);
  skDeck.position.y = 0.12;
  sk.add(skDeck);
  for (const x of [-0.28, 0.28]) {
    const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), wheelMat);
    w1.rotation.x = Math.PI / 2;
    w1.position.set(x, 0.06, 0.1);
    sk.add(w1);
    const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), wheelMat);
    w2.rotation.x = Math.PI / 2;
    w2.position.set(x, 0.06, -0.1);
    sk.add(w2);
  }
  sk.position.set(-8, 0, -2);
  sk.rotation.y = 0.6;
  group.add(sk);

  // === ENTERABLE SKATE SHOP — a real walk-in interior ======================
  // A small standalone shop the player can walk INTO: 4 walls, a floor, a flat
  // ceiling and a ~2.2 m doorway gap in the STREET-FACING (-Z) wall. Tucked into
  // the open SE quadrant along the inner edge, clear of the cafe (+Z rim, z>=16),
  // the quarter-pipe (x~18,z=[-13,-3]), the cones and the spin sign (22,18).
  // Footprint centre (shX,shZ); room is shW wide (X) × shD deep (Z). The door
  // faces -Z toward the plaza centre. Each wall gets its OWN AABB collider; the
  // doorway gap gets NONE so the player strolls straight in.
  {
    const shX = 17.5, shZ = 8.0;     // room centre
    const shW = 8.0, shD = 7.0;      // interior footprint (X × Z)
    const wallH = 3.0;               // wall height
    const wallT = 0.25;              // wall thickness
    const doorW = 2.2;               // doorway gap width
    const shop = new THREE.Group();
    shop.position.set(shX, 0, shZ);
    group.add(shop);

    const halfW = shW / 2, halfD = shD / 2;
    const frontZ = -halfD;           // street-facing wall sits at local -Z
    const backZ = halfD;

    // Floor (a touch proud of the plaza so it reads as a shop floor).
    const floor = box(shW + wallT, 0.08, shD + wallT, shopFloorMat, false);
    floor.position.set(0, 0.04, 0);
    floor.receiveShadow = true;
    shop.add(floor);

    // Flat roof / ceiling.
    const roof = box(shW + wallT * 2, 0.18, shD + wallT * 2, shopRoofMat, false);
    roof.position.set(0, wallH + 0.09, 0);
    shop.add(roof);

    // --- Walls (each a mesh + its own collider; world-space colliders) ------
    // Back wall (+Z, full width).
    const backWall = box(shW + wallT, wallH, wallT, shopWallMat);
    backWall.position.set(0, wallH / 2, backZ);
    shop.add(backWall);
    addCollider(colliders, shX, shZ + backZ, shW + wallT, wallT);

    // Side walls (±X, full depth).
    const leftWall = box(wallT, wallH, shD + wallT, shopWallMat);
    leftWall.position.set(-halfW, wallH / 2, 0);
    shop.add(leftWall);
    addCollider(colliders, shX - halfW, shZ, wallT, shD + wallT);

    const rightWall = box(wallT, wallH, shD + wallT, shopWallMat);
    rightWall.position.set(halfW, wallH / 2, 0);
    shop.add(rightWall);
    addCollider(colliders, shX + halfW, shZ, wallT, shD + wallT);

    // Front wall (-Z) split into TWO segments flanking the central doorway gap.
    // Each segment spans from a side wall inward to the edge of the 2.2 m gap.
    const segW = (shW - doorW) / 2;          // width of each front segment
    const segCx = (doorW / 2) + segW / 2;    // |X| centre of each segment
    const frontLeft = box(segW + wallT, wallH, wallT, shopWallMat);
    frontLeft.position.set(-segCx, wallH / 2, frontZ);
    shop.add(frontLeft);
    addCollider(colliders, shX - segCx, shZ + frontZ, segW + wallT, wallT);

    const frontRight = box(segW + wallT, wallH, wallT, shopWallMat);
    frontRight.position.set(segCx, wallH / 2, frontZ);
    shop.add(frontRight);
    addCollider(colliders, shX + segCx, shZ + frontZ, segW + wallT, wallT);
    // NOTE: the doorway gap (|X| < doorW/2 on the front wall) gets NO collider.

    // A small lintel beam above the doorway so the gap reads as a real opening.
    const lintel = box(doorW, 0.35, wallT, shopWallMat, false);
    lintel.position.set(0, wallH - 0.175, frontZ);
    shop.add(lintel);

    // --- Outside SHOP SIGN above the door, facing the street (-Z) -----------
    // artPanel faces +Z by default; rotate 180° so it points -Z (the street) and
    // reads un-mirrored.
    const sign = artPanel(3.6, 0.95, "sign", {
      text: "SHRED CITY SKATES",
      fg: "#ffe14a",
      bg: "#161a22",
      template: 0,
      file: "sign-skateshop.png",
      emissiveIntensity: 0.55,
    });
    sign.position.set(0, wallH + 0.55, frontZ - wallT / 2 - 0.05);
    sign.rotation.y = Math.PI;
    shop.add(sign);

    // === INTERIOR CONTENT — cozy + themed ===================================
    // Rug centred on the floor.
    const rug = box(4.0, 0.02, 3.0, shopRugMat, false);
    rug.position.set(0, 0.09, -0.3);
    rug.receiveShadow = true;
    shop.add(rug);

    // Service COUNTER along the back-right, with a dark top.
    const counterX = halfW - 1.4, counterZ = backZ - 1.0;
    const counter = box(2.6, 1.0, 0.7, shopCounterMat);
    counter.position.set(counterX, 0.5, counterZ);
    shop.add(counter);
    const counterTop = box(2.7, 0.08, 0.8, shopCounterTop, false);
    counterTop.position.set(counterX, 1.04, counterZ);
    shop.add(counterTop);
    // A register block on the counter.
    const register = box(0.4, 0.28, 0.3, shopStoolMat, false);
    register.position.set(counterX + 0.7, 1.22, counterZ);
    shop.add(register);

    // SHELVES on the back wall + left wall, holding little products.
    // Back-wall shelf unit (left of counter).
    const shelfBack = box(3.0, 1.6, 0.4, shopShelfMat);
    shelfBack.position.set(-halfW + 1.8, 0.85, backZ - 0.25);
    shop.add(shelfBack);
    // Two shelf planks across it.
    for (const sy of [0.7, 1.25]) {
      const plank = box(2.9, 0.05, 0.42, shopCounterTop, false);
      plank.position.set(-halfW + 1.8, sy, backZ - 0.25);
      shop.add(plank);
    }
    // Left-wall shelf unit.
    const shelfLeft = box(0.4, 1.7, 3.4, shopShelfMat);
    shelfLeft.position.set(-halfW + 0.25, 0.9, -0.2);
    shop.add(shelfLeft);

    // DISPLAY RACK / case for stickers near the front-right.
    const displayCase = box(1.1, 1.3, 0.5, shopShelfMat);
    displayCase.position.set(halfW - 0.9, 0.65, frontZ + 1.4);
    shop.add(displayCase);
    const caseGlass = box(0.95, 0.9, 0.06, shopGlassMat, false);
    caseGlass.position.set(halfW - 0.9, 0.85, frontZ + 1.16);
    shop.add(caseGlass);

    // Wheels-in-a-box products on the back-wall shelf (instanced, themed goods).
    const wheelMatrices = [];
    const _bm = new THREE.Matrix4();
    for (const wy of [0.78, 1.33]) {        // shelf-plank tops (local Y)
      for (let c = 0; c < 5; c++) {
        const wx = (-halfW + 1.8) - 1.15 + c * 0.55;
        _bm.makeRotationX(Math.PI / 2);
        _bm.setPosition(wx, wy, backZ - 0.25);
        wheelMatrices.push(_bm.clone());
      }
    }
    if (wheelMatrices.length) {
      const wheels = new THREE.InstancedMesh(shopWheelGeo, wheelMat, wheelMatrices.length);
      wheels.castShadow = false;
      wheels.receiveShadow = true;
      for (let i = 0; i < wheelMatrices.length; i++) wheels.setMatrixAt(i, wheelMatrices[i]);
      wheels.instanceMatrix.needsUpdate = true;
      shop.add(wheels);
    }

    // DECKS standing on the left-wall shelf (a few colored boards leaning up).
    const deckZs = [-1.4, -0.55, 0.3, 1.15, 1.95];
    for (let i = 0; i < deckZs.length; i++) {
      const d = new THREE.Mesh(shopDeckGeo, deckProductMats[i % deckProductMats.length]);
      d.position.set(-halfW + 0.55, 1.1, deckZs[i]);
      d.rotation.z = Math.PI / 2;       // lay the deck so its long axis is vertical-ish
      d.rotation.y = Math.PI / 2;       // face into the room
      d.castShadow = true;
      shop.add(d);
    }

    // A couple of STOOLS / seats by the counter.
    for (const sx of [counterX - 0.6, counterX + 0.4]) {
      const stoolSeat = box(0.42, 0.08, 0.42, shopStoolMat);
      stoolSeat.position.set(sx, 0.62, counterZ - 1.1);
      shop.add(stoolSeat);
      const stoolLeg = box(0.1, 0.6, 0.1, poleMat);
      stoolLeg.position.set(sx, 0.31, counterZ - 1.1);
      shop.add(stoolLeg);
    }

    // Wall SIGNAGE inside (above the counter on the back wall, faces -Z/inward).
    const innerSign = artPanel(2.2, 0.7, "sign", {
      text: "GRIP & GRIND",
      fg: "#2fe0c2",
      bg: "#101418",
      template: 2,
      emissiveIntensity: 0.5,
    });
    innerSign.position.set(counterX, 2.1, backZ - wallT / 2 - 0.06);
    // faces -Z (into the room) — artPanel default is +Z, so rotate 180°.
    innerSign.rotation.y = Math.PI;
    shop.add(innerSign);

    // Hanging interior LIGHTS — two bulbs on short cords from the ceiling.
    for (const bx of [-1.8, 1.8]) {
      const cord = box(0.03, 0.5, 0.03, poleMat, false);
      cord.position.set(bx, wallH - 0.25, -0.3);
      shop.add(cord);
      const bulb = new THREE.Mesh(lampHeadGeo, shopBulbMat);
      bulb.scale.setScalar(0.55);
      bulb.position.set(bx, wallH - 0.55, -0.3);
      shop.add(bulb);
    }
  }

  // --- Ambient animation -----------------------------------------------------
  // Cache the materials we flicker so we never allocate per frame.
  const neonMat = neon.material;
  const lampMats = [lampGlass]; // shared
  let t = 0;
  function update(dt) {
    t += dt;
    // spin the deck pylon sign slowly
    spinner.rotation.y += dt * 0.8;
    // flicker the neon sign
    neonMat.emissiveIntensity = 0.7 + Math.sin(t * 7.0) * 0.12 + (Math.random() < 0.04 ? -0.4 : 0);
    // gentle lamp pulse at night-feel
    lampGlass.emissiveIntensity = 0.85 + Math.sin(t * 1.7) * 0.08;
    // warm flicker for the interior shop bulbs (shared material)
    shopBulbMat.emissiveIntensity = 1.0 + Math.sin(t * 2.3) * 0.12;
    // sway the pennant flag
    flag.rotation.z = Math.sin(t * 2.2) * 0.12;
    flag.rotation.y = Math.sin(t * 1.6) * 0.18;
  }

  // The whole tile is walkable floor; props block via colliders.
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  return { group, colliders, ground, update };
}
