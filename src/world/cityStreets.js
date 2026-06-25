// City streets + unified ground. The 16 districts abut edge-to-edge, which reads as
// one big open plane. This lays a textured pavement base under everything (so there
// are never voids or jarring slab seams) plus an asphalt ROAD GRID on the tile seams
// — main avenues + cross streets with painted lane lines, crosswalks at every
// intersection, kerbs, and instanced street lamps + trees lining the roads. That
// carves the map into believable city blocks and fills the open space. Visual only
// (no colliders): roads are walkable/drivable; the ground already exists beneath.

import * as THREE from "three";

const NEAR = 13, FAR = 277, LEFT = -122, RIGHT = 122; // NEAR=13 keeps roads OUT of the cafe (front wall at z=11)
const MIDX = (LEFT + RIGHT) / 2, MIDZ = (NEAR + FAR) / 2;
const LEN = FAR - NEAR, WID = RIGHT - LEFT;
const VROADS = [-60, 0, 60]; // vertical avenues (run along Z) on the column seams
const HROADS = [35, 95, 155, 215]; // cross streets (run along X) on the row seams
const ROADW = 12, HALFR = ROADW / 2;

// True if world point (x,z) sits on the asphalt of ANY road lane (an avenue OR a
// cross street). Roadside props line the kerbs (x = avenue ± ~7.4, just OUTSIDE
// their own 6 m half-lane) but march down Z / across X, so without this guard they
// land squarely in a PERPENDICULAR lane wherever the step coincides with a cross
// street (z≈35/95/155/215) or an avenue (x≈-60/0/60) — that's the "pole in the
// middle of the road" bug. Every prop generator below skips spots where this is
// true. `pad` widens the lane a touch so props also clear the painted edge.
// (scripts/props-in-road-test.mjs is the automated guard for this.)
function onRoad(x, z, pad = 0.8) {
  const onAvenue = z >= NEAR && z <= FAR && VROADS.some((ax) => Math.abs(x - ax) <= HALFR + pad);
  const onCross = x >= LEFT && x <= RIGHT && HROADS.some((hz) => Math.abs(z - hz) <= HALFR + pad);
  return onAvenue || onCross;
}

function cnv(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; }
function tex(c, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}

// Speckled concrete pavement for the base ground.
function pavementTex() {
  const [c, g] = cnv(256, 256);
  g.fillStyle = "#8f8c85"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 120 + Math.floor(Math.random() * 70);
    g.fillStyle = `rgba(${v},${v},${v - 6},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // faint expansion-joint grid
  g.strokeStyle = "rgba(60,60,60,0.25)"; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  return c;
}

// One lengthwise tile of asphalt road: dark, side lines, dashed centre line.
function roadTex() {
  const [c, g] = cnv(128, 256);
  g.fillStyle = "#33343a"; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 1400; i++) { const v = 40 + Math.floor(Math.random() * 30); g.fillStyle = `rgba(${v},${v},${v},0.4)`; g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
  g.fillStyle = "#e7e7df"; // white edge lines
  g.fillRect(10, 0, 4, 256); g.fillRect(114, 0, 4, 256);
  g.fillStyle = "#e9d24a"; // dashed yellow centre
  for (let y = 14; y < 256; y += 56) g.fillRect(61, y, 6, 30);
  return c;
}

function crosswalkTex() {
  const [c, g] = cnv(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = "#eaeae2";
  for (let x = 10; x < 128; x += 22) g.fillRect(x, 6, 12, 116);
  return c;
}

// Green street-name blade: a label bar with faux text strokes. Re-used on both
// faces of the blade so the sign reads from either approach.
function streetSignTex(label) {
  const [c, g] = cnv(256, 64);
  g.fillStyle = "#1f7a4d"; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = "#eef3ee"; g.lineWidth = 3;
  g.strokeRect(5, 5, 246, 54);
  // Faux letters: a row of short white bars suggesting a name (cheap + readable).
  g.fillStyle = "#f3f6f3";
  let x = 22;
  for (const w of [10, 14, 8, 16, 6, 12, 18, 9, 13]) { g.fillRect(x, 24, w, 16); x += w + 8; if (x > 220) break; }
  return c;
}

// Newspaper-box front: a coloured panel with a paler "window" rectangle.
function newsboxTex() {
  const [c, g] = cnv(64, 64);
  g.fillStyle = "#b23838"; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#d9d2bf"; g.fillRect(10, 10, 44, 30);
  g.fillStyle = "#2a2a2a"; g.fillRect(16, 16, 32, 4); g.fillRect(16, 24, 28, 3); g.fillRect(16, 30, 30, 3);
  return c;
}

export function buildStreets() {
  const group = new THREE.Group();
  group.name = "streets";

  // World-space XZ AABB colliders for SOLID static street props (collected below
  // and inside addStreetLife). Players/car must not pass through these. The road
  // surface, low kerbs, crosswalks and flat decals deliberately get NO collider.
  const colliders = [];

  // GROUND Y-STACK (deliberate, so the layers never z-fight or sink the avatars):
  //   base pavement   y = -0.12  (opaque fallback under the whole map; a clear
  //                               0.12 m below the district slab tops at y=0 so it
  //                               can never z-fight them — it only shows through the
  //                               road-grid seams where slabs don't reach)
  //   district slabs  y =  0.00  (built in the zone files — must not edit)
  //   road grid       y =  0.02  (single tier; V renderOrder 0, H renderOrder 1,
  //                               both polygonOffset -1 so asphalt deterministically
  //                               wins over the y=0 slabs; only 2 cm above the
  //                               avatar's y=0 feet, so they don't visibly sink)
  //   road decals     y =  0.025 (crosswalk > manhole > stain, separated by
  //                               polygonOffset + renderOrder, not Y; transparent
  //                               ones use depthWrite:false so they blend cleanly)
  const pav = new THREE.MeshStandardMaterial({ map: tex(pavementTex(), WID / 16, LEN / 16), roughness: 0.97, metalness: 0 });
  const base = new THREE.Mesh(new THREE.PlaneGeometry(WID, LEN), pav);
  base.rotation.x = -Math.PI / 2;
  base.position.set(MIDX, -0.12, MIDZ);
  base.receiveShadow = true;
  group.add(base);

  // Both road materials get polygonOffset so the asphalt is pulled toward the camera
  // and deterministically wins over whatever district slab top sits beneath it at
  // y=0 — that ordering no longer relies on a sub-mm Y lift the depth buffer can't
  // resolve at city distance. Vertical avenues and cross streets share one height
  // (y=0.02); inside the 12x12 intersection square the two road planes are exactly
  // coplanar, so renderOrder alone (which only sequences draws) can't stop them
  // z-fighting. The H (cross-street) material gets a STRONGER polygonOffset than the
  // V material, so in the overlap the cross street is pulled a hair closer to the
  // camera and deterministically wins the depth test — matching the renderOrder
  // intent (H on top) with an actual depth bias, not luck.
  const roadMatV = new THREE.MeshStandardMaterial({ map: tex(roadTex(), 1, LEN / 24), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const roadMatH = new THREE.MeshStandardMaterial({ map: tex(roadTex(), 1, WID / 24), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 });
  const kerbMat = new THREE.MeshStandardMaterial({ color: "#b9b6ac", roughness: 0.9 });

  // Kerbs are BROKEN at every crossing so the two perpendicular kerb runs never
  // interpenetrate at the 4 intersection corners (that overlap was the visible
  // clipping). KGAP is the half-width of the air gap left around each crossing
  // road's centreline — wide enough to clear the road (HALFR) AND the perpendicular
  // kerb's own outer face (HALFR+0.5), so corners read as clean open junctions.
  const KGAP = HALFR + 1;
  // Emit straight kerb segments along one axis (`along` = "z" for the Z-running
  // avenue kerbs, "x" for the X-running cross-street kerbs), spanning [aMin,aMax]
  // at the fixed cross-coordinate `fixed`, but skipping the band ±KGAP around each
  // crossing in `crossings`. Only segments with positive length are added.
  const addKerb = (along, fixed, aMin, aMax, crossings) => {
    const cuts = crossings.filter((c) => c > aMin && c < aMax).sort((p, q) => p - q);
    let start = aMin;
    const emit = (s, e) => {
      const len = e - s;
      if (len <= 0.01) return;
      const mid = (s + e) / 2;
      const k = along === "z"
        ? new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, len), kerbMat)
        : new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.5), kerbMat);
      if (along === "z") k.position.set(fixed, 0.06, mid);
      else k.position.set(mid, 0.06, fixed);
      group.add(k);
    };
    for (const c of cuts) { emit(start, c - KGAP); start = c + KGAP; }
    emit(start, aMax);
  };

  // Vertical avenues (run along Z) + flanking kerbs. PlaneGeometry(ROADW, LEN) with
  // rotation.x=-PI/2 maps width->world X (ROADW) and height->world Z (LEN); the dashed
  // centre line runs down the height, i.e. along Z. No extra rotation. Kerbs run the
  // length of the avenue but are gapped where each cross street (HROADS) passes.
  for (const x of VROADS) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(ROADW, LEN), roadMatV);
    r.rotation.x = -Math.PI / 2; r.position.set(x, 0.02, MIDZ); r.receiveShadow = true; r.renderOrder = 0;
    group.add(r);
    for (const s of [-1, 1]) addKerb("z", x + s * (HALFR + 0.25), NEAR, FAR, HROADS);
  }
  // Cross streets (run along X) + flanking kerbs. Use PlaneGeometry(ROADW, WID) then
  // rotation.z=PI/2 to swing the long axis (and the centre dashes) onto world X. Kerbs
  // run the width of the street but are gapped where each avenue (VROADS) passes.
  for (const z of HROADS) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(ROADW, WID), roadMatH);
    r.rotation.x = -Math.PI / 2; r.rotation.z = Math.PI / 2; r.position.set(MIDX, 0.02, z); r.receiveShadow = true; r.renderOrder = 1;
    group.add(r);
    for (const s of [-1, 1]) addKerb("x", z + s * (HALFR + 0.25), LEFT, RIGHT, VROADS);
  }

  // Crosswalks at every intersection (4 approaches each). Top decal of the road
  // tier: a hair (5 mm) above the asphalt, with the strongest polygonOffset and
  // highest renderOrder so the paint always composites over the road and the other
  // decals. depthWrite:false lets the transparent stripes blend over a single
  // stable surface instead of depth-fighting the road beneath them. The stripes sit
  // entirely OUTSIDE the 12x12 intersection square on each approach: the bar is 4.2
  // deep, so a centre offset of HALFR+2.5 puts its inner edge at HALFR+0.4 — clear
  // of the box edge (HALFR) so it overlaps only ONE road plane, never both.
  const cwMat = new THREE.MeshStandardMaterial({ map: tex(crosswalkTex()), transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const cwGeo = new THREE.PlaneGeometry(ROADW - 1, 4.2);
  const CWO = HALFR + 2.5;
  for (const x of VROADS) for (const z of HROADS) {
    for (const [dx, dz, rot] of [[0, CWO, 0], [0, -CWO, 0], [CWO, 0, Math.PI / 2], [-CWO, 0, Math.PI / 2]]) {
      const cw = new THREE.Mesh(cwGeo, cwMat);
      cw.rotation.x = -Math.PI / 2; cw.rotation.z = rot; cw.position.set(x + dx, 0.025, z + dz); cw.renderOrder = 4;
      group.add(cw);
    }
  }

  // Instanced street lamps lining the avenues (posts + emissive heads).
  const postGeo = new THREE.CylinderGeometry(0.12, 0.14, 5, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: "#2b2e33", roughness: 0.5, metalness: 0.6 });
  const headGeo = new THREE.BoxGeometry(0.5, 0.3, 0.5);
  const headMat = new THREE.MeshStandardMaterial({ color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 0.9, roughness: 0.4 });
  const spots = [];
  for (const x of VROADS) for (let z = NEAR + 12; z < FAR; z += 26) {
    for (const lx of [x - HALFR - 1.4, x + HALFR + 1.4]) if (!onRoad(lx, z)) spots.push([lx, z]);
  }
  const posts = new THREE.InstancedMesh(postGeo, postMat, spots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => {
    m.makeTranslation(x, 2.5, z); posts.setMatrixAt(i, m);
    m.makeTranslation(x, 5.0, z); heads.setMatrixAt(i, m);
  });
  posts.castShadow = true;
  group.add(posts); group.add(heads);
  // Tight collider per street-lamp post (head box 0.5 -> half 0.25; posts at ax+-7.4).
  for (const [x, z] of spots) colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 });

  // Instanced roadside trees on the cross streets for greenery/density.
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.6, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#5a3d28", roughness: 0.9 });
  const leafGeo = new THREE.IcosahedronGeometry(1.5, 0);
  const leafMat = new THREE.MeshStandardMaterial({ color: "#3f7d4d", roughness: 0.9, flatShading: true });
  const tspots = [];
  for (const z of HROADS) for (let x = LEFT + 16; x < RIGHT; x += 24) {
    for (const tz of [z - HALFR - 2.2, z + HALFR + 2.2]) if (!onRoad(x, tz)) tspots.push([x, tz]);
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, tspots.length);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, tspots.length);
  tspots.forEach(([x, z], i) => {
    m.makeTranslation(x, 0.8, z); trunks.setMatrixAt(i, m);
    m.makeTranslation(x, 2.4, z); leaves.setMatrixAt(i, m);
  });
  trunks.castShadow = true; leaves.castShadow = true;
  group.add(trunks); group.add(leaves);

  const life = addStreetLife(group, m);
  if (life.colliders) for (const c of life.colliders) colliders.push(c);

  // Drive the traffic-light heads through R -> G -> A in a continuous loop. We
  // animate by fading each colour's shared emissive material (every lamp of a
  // colour shares one material, so this is a handful of float writes per frame —
  // allocation-free). The lamps stay dimly lit when "off" so they never vanish.
  const lights = life.lights;
  const PHASE = [4.6, 4.6, 1.6];   // seconds for RED, GREEN, AMBER
  const CYCLE = PHASE[0] + PHASE[1] + PHASE[2];
  const HOT = 1.5, COLD = 0.12;    // emissiveIntensity when active / idle
  let tAcc = 0;
  const update = (dt) => {
    tAcc += dt;
    if (tAcc > CYCLE) tAcc -= CYCLE * Math.floor(tAcc / CYCLE);
    // 0 = red, 1 = green, 2 = amber
    const phase = tAcc < PHASE[0] ? 0 : tAcc < PHASE[0] + PHASE[1] ? 1 : 2;
    lights.r.emissiveIntensity = phase === 0 ? HOT : COLD;
    lights.g.emissiveIntensity = phase === 1 ? HOT : COLD;
    lights.a.emissiveIntensity = phase === 2 ? HOT : COLD;
  };

  return { group, update, colliders };
}

// ---------------------------------------------------------------------------
// STREET LIFE: visual-only clutter that makes the avenues feel busy and lived-in.
// Traffic-light posts at every intersection, instanced parked cars at the kerbs,
// fire hydrants, manhole discs, road signs, bus shelters, trash bins, and faint
// oil-stain/road-patch decals. All repeats use InstancedMesh; no per-frame work.
// ---------------------------------------------------------------------------
function addStreetLife(group, m) {
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const v = new THREE.Vector3();
  const place = (mesh, i, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => {
    q.setFromAxisAngle(_UP, ry);
    v.set(x, y, z); s.set(sx, sy, sz);
    m.compose(v, q, s); mesh.setMatrixAt(i, m);
  };

  // World-space XZ AABB colliders for the SOLID static props built below. Each is
  // kept TIGHT to the prop's footprint. addAABB() centres a box at (x,z) with the
  // given half-extents along world X/Z; for props placed with a small yaw it widens
  // the box to the rotated bounding extents so the AABB still fully contains the
  // footprint. Road surface, kerbs, crosswalks and flat decals get NO collider.
  const colliders = [];
  // True if (x,z) falls inside (or within a small margin of) any intersection
  // square — the 12x12 patch where an avenue (VROADS) crosses a cross street
  // (HROADS). Flat road decals (manhole/stain/patch) are dropped here so none
  // ever lands on the doubly-painted junction and flickers against both road
  // planes + the crosswalk paint stacked there.
  const intMargin = HALFR + 2;
  const inIntersection = (x, z) =>
    VROADS.some((ax) => Math.abs(x - ax) < intMargin) &&
    HROADS.some((hz) => Math.abs(z - hz) < intMargin);
  const addAABB = (x, z, hx, hz, ry = 0) => {
    if (ry) {
      const c = Math.abs(Math.cos(ry)), n = Math.abs(Math.sin(ry));
      const ax = hx * c + hz * n, az = hx * n + hz * c;
      hx = ax; hz = az;
    }
    colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
  };

  // --- Traffic-light posts at the 12 intersections (one per corner approach). ---
  // A dark pole + a stacked head box with three emissive lamp discs (R/A/G).
  const tlInter = [];
  for (const x of VROADS) for (const z of HROADS) tlInter.push([x, z]);
  // Put a post on the near-right corner of each approach so all 4 corners get one.
  const tlCorners = [[HALFR + 1.6, HALFR + 1.6], [HALFR + 1.6, -HALFR - 1.6], [-HALFR - 1.6, HALFR + 1.6], [-HALFR - 1.6, -HALFR - 1.6]];
  const tlCount = tlInter.length * tlCorners.length;
  const tlPoleMat = new THREE.MeshStandardMaterial({ color: "#1d2024", roughness: 0.45, metalness: 0.7 });
  const tlPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.16, 4.4, 6), tlPoleMat, tlCount);
  const tlBoxMat = new THREE.MeshStandardMaterial({ color: "#17191c", roughness: 0.6, metalness: 0.3 });
  const tlBoxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.3, 0.42), tlBoxMat, tlCount);
  // Three lamp colours, one InstancedMesh each so each can carry its own emissive.
  // We keep the materials around so the update() loop can cycle them R->G->A.
  const lampGeo = new THREE.CircleGeometry(0.16, 10);
  const lampMatR = new THREE.MeshStandardMaterial({ color: "#ff5a4a", emissive: "#ff2a18", emissiveIntensity: 1.5, roughness: 0.4 });
  const lampMatA = new THREE.MeshStandardMaterial({ color: "#ffd24a", emissive: "#ffb000", emissiveIntensity: 0.12, roughness: 0.4 });
  const lampMatG = new THREE.MeshStandardMaterial({ color: "#5dff84", emissive: "#16d24a", emissiveIntensity: 0.12, roughness: 0.4 });
  const lampR = new THREE.InstancedMesh(lampGeo, lampMatR, tlCount);
  const lampA = new THREE.InstancedMesh(lampGeo, lampMatA, tlCount);
  const lampG = new THREE.InstancedMesh(lampGeo, lampMatG, tlCount);
  let ti = 0;
  for (const [ix, iz] of tlInter) for (const [cx, cz] of tlCorners) {
    const x = ix + cx, z = iz + cz;
    // Face the head roughly toward the intersection centre.
    const ry = Math.atan2(-cx, -cz);
    place(tlPoles, ti, x, 2.2, z, ry);
    place(tlBoxes, ti, x, 4.7, z, ry);
    // Tight collider on the traffic-light post footprint (head box 0.5 x 0.42).
    addAABB(x, z, 0.25, 0.21, ry);
    // Lamps sit on the +Z face of the (unrotated) box; offset along the box-forward.
    const fz = 0.23, fx = 0;
    const rx = Math.cos(ry) * fx + Math.sin(ry) * fz;
    const rz = -Math.sin(ry) * fx + Math.cos(ry) * fz;
    // Lamp planes need to face outward: rotate the circle to stand vertical, facing ry.
    q.setFromEuler(new THREE.Euler(0, ry, 0));
    for (const [mesh, yy] of [[lampR, 5.1], [lampA, 4.7], [lampG, 4.3]]) {
      v.set(x + rx, yy, z + rz); s.set(1, 1, 1);
      m.compose(v, q, s); mesh.setMatrixAt(ti, m);
    }
    ti++;
  }
  tlPoles.castShadow = true; tlBoxes.castShadow = true;
  group.add(tlPoles, tlBoxes, lampR, lampA, lampG);

  // --- Parked cars pulled to the kerb along the avenues (instanced low-poly boxes). ---
  // Bodies + cabins, varied colours via a few colour buckets (one InstancedMesh per
  // colour so we keep instancing). Wheels are one dark InstancedMesh (4 per car).
  const carColors = ["#b5392f", "#2f5fb5", "#cdb23a", "#3a8f55", "#cfcfcf", "#7a3fa0", "#d98a2b", "#2b2e33", "#2c8c8c", "#9aa0a6"];
  // Two body silhouettes for variety: a sedan and a longer/taller van. Each type
  // gets its own cabin geometry; both reuse the per-colour body materials.
  const carBodyGeo = new THREE.BoxGeometry(2.0, 0.85, 4.4);   // sedan
  const carCabGeo = new THREE.BoxGeometry(1.85, 0.7, 2.2);
  const vanBodyGeo = new THREE.BoxGeometry(2.1, 1.2, 5.0);    // van/SUV
  const vanCabGeo = new THREE.BoxGeometry(1.95, 0.95, 3.2);
  const carSpots = []; // [x, z, ry, colorIdx, type]  type 0 = sedan, 1 = van
  let cseed = 1234.5;
  const rnd = () => { cseed = (cseed * 9301 + 49297) % 233280; return cseed / 233280; };
  for (const ax of VROADS) {
    for (let z = NEAR + 18; z < FAR - 6; z += 17) {
      if (rnd() < 0.22) continue; // gaps so it's not a solid wall of cars
      // alternate which kerb side; pull body so it sits just inside the lane edge
      const side = rnd() < 0.5 ? -1 : 1;
      const x = ax + side * (HALFR - 1.3);
      const jitter = (rnd() - 0.5) * 3.0;
      const ry = (rnd() - 0.5) * 0.18; // slight angle so they don't look stamped
      const type = rnd() < 0.28 ? 1 : 0;
      carSpots.push([x, z + jitter, ry, Math.floor(rnd() * carColors.length), type]);
    }
  }
  // Group spots by colour to build one InstancedMesh per colour for bodies+cabins.
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 8);
  const wheelMat = new THREE.MeshStandardMaterial({ color: "#17181a", roughness: 0.8 });
  const totalWheels = carSpots.length * 4;
  const wheels = new THREE.InstancedMesh(wheelGeo, wheelMat, totalWheels);
  let wi = 0;
  const cabMat = new THREE.MeshStandardMaterial({ color: "#aebcc6", roughness: 0.25, metalness: 0.1 });
  const wheelOff = [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.5], [0.95, -1.5]];
  for (let ci = 0; ci < carColors.length; ci++) {
    const mine = carSpots.filter((c) => c[3] === ci);
    if (!mine.length) continue;
    const bodyMat = new THREE.MeshStandardMaterial({ color: carColors[ci], roughness: 0.4, metalness: 0.25 });
    // Split by type so each instanced batch shares one geometry.
    const sedans = mine.filter((c) => c[4] === 0);
    const vans = mine.filter((c) => c[4] === 1);
    if (sedans.length) {
      const bodies = new THREE.InstancedMesh(carBodyGeo, bodyMat, sedans.length);
      const cabs = new THREE.InstancedMesh(carCabGeo, cabMat, sedans.length);
      sedans.forEach(([x, z, ry], i) => { place(bodies, i, x, 0.62, z, ry); place(cabs, i, x, 1.28, z - 0.2, ry); });
      bodies.castShadow = true; cabs.castShadow = true;
      group.add(bodies, cabs);
    }
    if (vans.length) {
      const bodies = new THREE.InstancedMesh(vanBodyGeo, bodyMat, vans.length);
      const cabs = new THREE.InstancedMesh(vanCabGeo, cabMat, vans.length);
      vans.forEach(([x, z, ry], i) => { place(bodies, i, x, 0.8, z, ry); place(cabs, i, x, 1.78, z - 0.3, ry); });
      bodies.castShadow = true; cabs.castShadow = true;
      group.add(bodies, cabs);
    }
  }
  // Wheels for all cars (after bodies so indices line up to carSpots order).
  for (const [x, z, ry, , type] of carSpots) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    q.setFromEuler(new THREE.Euler(0, ry, Math.PI / 2)); // lay cylinder on its side (axis -> X), then yaw
    for (const [ox, oz] of wheelOff) {
      v.set(x + ox * cs - oz * sn, 0.34, z + ox * sn + oz * cs); s.set(1, 1, 1);
      m.compose(v, q, s); wheels.setMatrixAt(wi++, m);
    }
    // Tight collider on the parked-car body footprint (sedan 2.0x4.4 / van 2.1x5.0),
    // widened to the yawed bounding box. These hug the kerb edge by design.
    const hw = type === 1 ? 1.05 : 1.0, hl = type === 1 ? 2.5 : 2.2;
    addAABB(x, z, hw, hl, ry);
  }
  group.add(wheels);

  // --- Fire hydrants on the pavement just outside the kerbs. ---
  const hydMat = new THREE.MeshStandardMaterial({ color: "#c43a2c", roughness: 0.55, metalness: 0.2 });
  const hydSpots = [];
  for (const ax of VROADS) for (let z = NEAR + 30; z < FAR; z += 60) { const hx = ax - HALFR - 1.0; if (!onRoad(hx, z)) hydSpots.push([hx, z]); }
  const hydBody = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.26, 0.8, 8), hydMat, hydSpots.length);
  const hydCap = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 8, 6), hydMat, hydSpots.length);
  hydSpots.forEach(([x, z], i) => { place(hydBody, i, x, 0.4, z); place(hydCap, i, x, 0.82, z); addAABB(x, z, 0.26, 0.26); });
  hydBody.castShadow = true;
  group.add(hydBody, hydCap);

  // --- Manhole-cover discs flush on the asphalt down the avenue centres. ---
  // Middle decal: a solid cover, so it stays opaque + depthWrite, but its
  // polygonOffset/renderOrder sit below the crosswalk paint and above the oil
  // stains for a stable ordering on the unified road tier.
  const mhMat = new THREE.MeshStandardMaterial({ color: "#3a3b40", roughness: 0.95, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const mhSpots = [];
  for (const ax of VROADS) for (let z = NEAR + 24; z < FAR; z += 38) {
    const x = ax + (Math.random() < 0.5 ? -2.5 : 2.5);
    if (!inIntersection(x, z)) mhSpots.push([x, z]);
  }
  const manholes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.55, 14), mhMat, mhSpots.length);
  manholes.renderOrder = 3;
  mhSpots.forEach(([x, z], i) => {
    q.setFromAxisAngle(_RIGHT, -Math.PI / 2); v.set(x, 0.025, z); s.set(1, 1, 1);
    m.compose(v, q, s); manholes.setMatrixAt(i, m);
  });
  group.add(manholes);

  // --- Faint oil-stain / road-patch decals scattered on the road surface. ---
  // Bottom-most decal: depthWrite:false + the weakest polygonOffset/renderOrder so
  // it blends softly over the asphalt without depth-fighting it (it was the dark
  // rectangle that flickered over the pavement). Opacity dialled back so any residual
  // overlap reads as a faint stain, never a hard dark patch.
  const stainMat = new THREE.MeshStandardMaterial({ color: "#15151a", roughness: 1, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stainSpots = [];
  for (const ax of VROADS) for (let z = NEAR + 14; z < FAR; z += 21) {
    const sx = ax + (Math.random() - 0.5) * 7, sz = z + (Math.random() - 0.5) * 8;
    if (!inIntersection(sx, sz)) stainSpots.push([sx, sz, 1.0 + Math.random() * 1.8]);
  }
  const stains = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 10), stainMat, stainSpots.length);
  stains.renderOrder = 2;
  stainSpots.forEach(([x, z, sc], i) => {
    q.setFromAxisAngle(_RIGHT, -Math.PI / 2); v.set(x, 0.025, z); s.set(sc, sc * 0.7, 1);
    m.compose(v, q, s); stains.setMatrixAt(i, m);
  });
  group.add(stains);

  // --- Road signs: STOP (octagon, red) + ONE-WAY (rectangle) on thin posts. ---
  const signPostGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6);
  const signPostMat = new THREE.MeshStandardMaterial({ color: "#777", roughness: 0.5, metalness: 0.6 });
  const signSpots = []; // [x, z, type]  type 0 = stop, 1 = one-way
  let snToggle = 0;
  for (const ax of VROADS) for (const hz of HROADS) {
    signSpots.push([ax - HALFR - 1.4, hz - HALFR - 1.4, (snToggle++) % 2]);
  }
  const signPosts = new THREE.InstancedMesh(signPostGeo, signPostMat, signSpots.length);
  signSpots.forEach(([x, z], i) => place(signPosts, i, x, 1.3, z));
  signPosts.castShadow = true;
  group.add(signPosts);
  // Stop faces (octagon approximated by an 8-gon circle) and one-way plates.
  const stopList = signSpots.filter((sn) => sn[2] === 0);
  const owList = signSpots.filter((sn) => sn[2] === 1);
  const stopFaceMat = new THREE.MeshStandardMaterial({ color: "#c0392b", emissive: "#5a160f", emissiveIntensity: 0.4, roughness: 0.5, side: THREE.DoubleSide });
  const stops = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 8), stopFaceMat, Math.max(1, stopList.length));
  stopList.forEach(([x, z], i) => { q.setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)); v.set(x, 2.45, z); s.set(1, 1, 1); m.compose(v, q, s); stops.setMatrixAt(i, m); });
  if (stopList.length) group.add(stops);
  const owFaceMat = new THREE.MeshStandardMaterial({ color: "#1f2933", roughness: 0.5, side: THREE.DoubleSide });
  const ow = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.34), owFaceMat, Math.max(1, owList.length));
  owList.forEach(([x, z], i) => { q.setFromEuler(new THREE.Euler(0, 0, 0)); v.set(x, 2.45, z); s.set(1, 1, 1); m.compose(v, q, s); ow.setMatrixAt(i, m); });
  if (owList.length) group.add(ow);

  // --- Trash bins along the pavement. ---
  const binMat = new THREE.MeshStandardMaterial({ color: "#2f6f4a", roughness: 0.7, metalness: 0.2 });
  const lidMat = new THREE.MeshStandardMaterial({ color: "#244f37", roughness: 0.6 });
  const binSpots = [];
  for (const ax of VROADS) for (let z = NEAR + 46; z < FAR; z += 62) { const bx = ax + HALFR + 1.0; if (!onRoad(bx, z)) binSpots.push([bx, z]); }
  const bins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.34, 0.3, 1.0, 8), binMat, binSpots.length);
  const lids = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.37, 0.37, 0.12, 8), lidMat, binSpots.length);
  binSpots.forEach(([x, z], i) => { place(bins, i, x, 0.5, z); place(lids, i, x, 1.06, z); });
  bins.castShadow = true;
  group.add(bins, lids);

  // --- A couple of bus-stop shelters beside the main avenue. ---
  const shelterMat = new THREE.MeshStandardMaterial({ color: "#3b4651", roughness: 0.5, metalness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: "#acd5e6", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35 });
  const shelterSpots = [[0 - HALFR - 2.6, 70], [0 + HALFR + 2.6, 200]];
  for (const [sx, sz] of shelterSpots) {
    // Tight collider on the shelter footprint (roof 4.2 x 2.0 -> half 2.1 x 1.0).
    addAABB(sx, sz, 2.1, 1.0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 2.0), shelterMat);
    roof.position.set(sx, 2.5, sz); roof.castShadow = true; group.add(roof);
    const back = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.0, 0.08), glassMat);
    back.position.set(sx, 1.4, sz - 0.95); group.add(back);
    for (const ex of [-2.0, 2.0]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.5, 0.12), shelterMat);
      post.position.set(sx + ex, 1.25, sz + 0.9); post.castShadow = true; group.add(post);
    }
    const bench = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.5), shelterMat);
    bench.position.set(sx, 0.5, sz - 0.5); group.add(bench);
  }

  // --- Bus-stop benches on the pavement (slatted seat + back on two legs). ---
  // Stand-alone seating, well outside the kerb so the lanes stay >=6 m clear.
  const benchWoodMat = new THREE.MeshStandardMaterial({ color: "#7a5532", roughness: 0.85 });
  const benchMetalMat = new THREE.MeshStandardMaterial({ color: "#33373c", roughness: 0.5, metalness: 0.6 });
  const benchSpots = []; // [x, z, ry]
  for (const ax of VROADS) for (let z = NEAR + 38; z < FAR; z += 70) {
    const bx = ax - HALFR - 2.4;
    if (!onRoad(bx, z)) benchSpots.push([bx, z, Math.PI / 2]);   // long axis runs along Z (parallel to avenue)
  }
  const bSeat = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.12, 0.5), benchWoodMat, benchSpots.length);
  const bBack = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.5, 0.1), benchWoodMat, benchSpots.length);
  const bLegs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), benchMetalMat, benchSpots.length * 2);
  let bli = 0;
  benchSpots.forEach(([x, z, ry], i) => {
    place(bSeat, i, x, 0.5, z, ry);
    // Tight collider on the bench seat footprint (2.2 x 0.5 -> half 1.1 x 0.25, yawed).
    addAABB(x, z, 1.1, 0.25, ry);
    // back panel sits at the rear edge (local -Z before yaw); offset rotated into world
    const bx = Math.sin(ry) * -0.2, bz = Math.cos(ry) * -0.2;
    place(bBack, i, x + bx, 0.78, z + bz, ry);
    for (const lo of [-0.9, 0.9]) {
      place(bLegs, bli++, x + Math.cos(ry) * lo, 0.25, z + Math.sin(ry) * lo, ry);
    }
  });
  bSeat.castShadow = true; bBack.castShadow = true;
  group.add(bSeat, bBack, bLegs);

  // --- Bike racks: a low U-loop rail (a few bars) on the pavement. ---
  const bikeMat = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.4, metalness: 0.7 });
  const bikeSpots = [];
  for (const ax of VROADS) for (let z = NEAR + 54; z < FAR; z += 64) { const bx = ax + HALFR + 2.2; if (!onRoad(bx, z)) bikeSpots.push([bx, z]); }
  // Each rack = 3 vertical U-bars; instance the bars (3 per rack) along one rail.
  const bikeBars = new THREE.InstancedMesh(new THREE.TorusGeometry(0.32, 0.04, 5, 8, Math.PI), bikeMat, bikeSpots.length * 3);
  let bbi = 0;
  bikeSpots.forEach(([x, z]) => {
    for (const off of [-0.5, 0, 0.5]) {
      // torus arc stands upright facing +X; ry=0 keeps the loop in the X-Y plane along Z
      q.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
      v.set(x, 0.32, z + off); s.set(1, 1, 1);
      m.compose(v, q, s); bikeBars.setMatrixAt(bbi++, m);
    }
  });
  group.add(bikeBars);

  // --- Mailboxes: classic rounded-top blue boxes on a short pedestal. ---
  const mailMat = new THREE.MeshStandardMaterial({ color: "#2452a6", roughness: 0.5, metalness: 0.3 });
  const mailSpots = [];
  for (const ax of VROADS) for (let z = NEAR + 58; z < FAR; z += 80) { const mx = ax - HALFR - 2.0; if (!onRoad(mx, z)) mailSpots.push([mx, z]); }
  const mailBody = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.7, 0.5), mailMat, mailSpots.length);
  const mailTop = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 10, 1, false, 0, Math.PI), mailMat, mailSpots.length);
  const mailLeg = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6), benchMetalMat, mailSpots.length);
  mailSpots.forEach(([x, z], i) => {
    place(mailLeg, i, x, 0.25, z);
    place(mailBody, i, x, 0.85, z);
    // Tight collider on the mailbox body footprint (0.6 x 0.5 -> half 0.3 x 0.25).
    addAABB(x, z, 0.3, 0.25);
    // half-cylinder cap: lay it so the flat side faces down, long axis along Z
    q.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    v.set(x, 1.2, z); s.set(1, 0.5, 1);
    m.compose(v, q, s); mailTop.setMatrixAt(i, m);
  });
  mailBody.castShadow = true; mailTop.castShadow = true;
  group.add(mailBody, mailTop, mailLeg);

  // --- Newspaper boxes: clustered coloured vending boxes by the kerb. ---
  const newsTex = tex(newsboxTex());
  const newsMat = new THREE.MeshStandardMaterial({ map: newsTex, roughness: 0.6, metalness: 0.2 });
  const newsSpots = [];
  for (const ax of VROADS) for (let z = NEAR + 64; z < FAR; z += 88) {
    const a = [ax + HALFR + 1.8, z], b = [ax + HALFR + 2.4, z + 0.7];
    if (!onRoad(a[0], a[1])) newsSpots.push(a);
    if (!onRoad(b[0], b[1])) newsSpots.push(b);
  }
  const newsboxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), newsMat, newsSpots.length);
  newsSpots.forEach(([x, z], i) => {
    const ry = (i % 2) * 0.3;
    place(newsboxes, i, x, 0.55, z, ry);
    // Tight collider on the newspaper-box footprint (0.5 x 0.5 -> half 0.25, yawed).
    addAABB(x, z, 0.25, 0.25, ry);
  });
  newsboxes.castShadow = true;
  group.add(newsboxes);

  // --- Planters: low concrete tubs with a leafy mound, lining the pavement. ---
  const planterMat = new THREE.MeshStandardMaterial({ color: "#9b958a", roughness: 0.95 });
  const plantMat = new THREE.MeshStandardMaterial({ color: "#4f8a53", roughness: 0.9, flatShading: true });
  const planterSpots = [];
  for (const ax of VROADS) for (let z = NEAR + 28; z < FAR; z += 34) {
    const px = ax + (z % 2 < 1 ? -1 : 1) * (HALFR + 1.6);
    if (!onRoad(px, z)) planterSpots.push([px, z]);
  }
  const planterBox = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.5, 1.1), planterMat, planterSpots.length);
  const planterBush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6, 0), plantMat, planterSpots.length);
  planterSpots.forEach(([x, z], i) => {
    place(planterBox, i, x, 0.25, z);
    place(planterBush, i, x, 0.78, z, 0, 1, 0.8, 1);
    // Tight collider on the planter tub footprint (1.1 x 1.1 -> half 0.55).
    addAABB(x, z, 0.55, 0.55);
  });
  planterBox.castShadow = true; planterBush.castShadow = true;
  group.add(planterBox, planterBush);

  // --- Street-name blades at each intersection (green double-sided sign). ---
  // Sits on the same thin posts used for road signs but up high, perpendicular to
  // the avenue so it reads from the road. Visual only.
  const bladeMat = new THREE.MeshStandardMaterial({ map: tex(streetSignTex()), roughness: 0.6, side: THREE.DoubleSide });
  const bladePostMat = new THREE.MeshStandardMaterial({ color: "#5a5e63", roughness: 0.5, metalness: 0.6 });
  const bladeSpots = [];
  for (const ax of VROADS) for (const hz of HROADS) bladeSpots.push([ax + HALFR + 1.4, hz + HALFR + 1.4]);
  const bladePosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6), bladePostMat, bladeSpots.length);
  const blades = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 0.6), bladeMat, bladeSpots.length);
  bladeSpots.forEach(([x, z], i) => {
    place(bladePosts, i, x, 1.8, z);
    // blade faces along X (readable from the avenue), mounted near the top
    q.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    v.set(x, 3.4, z); s.set(1, 1, 1);
    m.compose(v, q, s); blades.setMatrixAt(i, m);
  });
  bladePosts.castShadow = true;
  group.add(bladePosts, blades);

  // --- Road wear / asphalt-patch decals: lighter rectangular repairs on the
  // lanes (polygonOffset, no Y lift). Sits on the decal tier just above the oil
  // stains, below the manhole covers, so the ordering stays stable. ---
  const patchMat = new THREE.MeshStandardMaterial({ color: "#42434a", roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2.5, polygonOffsetUnits: -2.5 });
  const patchSpots = [];
  for (const ax of VROADS) for (let z = NEAR + 20; z < FAR; z += 29) {
    const px = ax + (Math.random() - 0.5) * 5;
    if (!inIntersection(px, z)) patchSpots.push([px, z, 1.4 + Math.random() * 2.0, 0.8 + Math.random() * 1.4]);
  }
  const patches = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), patchMat, patchSpots.length);
  patches.renderOrder = 2;
  patchSpots.forEach(([x, z, sw, sl], i) => {
    q.setFromAxisAngle(_RIGHT, -Math.PI / 2); v.set(x, 0.025, z); s.set(sw, sl, 1);
    m.compose(v, q, s); patches.setMatrixAt(i, m);
  });
  group.add(patches);

  // Hand the traffic-light materials back so buildStreets can cycle their emissive,
  // plus the world-space prop colliders so buildStreets can return them to the city.
  return { lights: { r: lampMatR, g: lampMatG, a: lampMatA }, colliders };
}

const _UP = new THREE.Vector3(0, 1, 0);
const _RIGHT = new THREE.Vector3(1, 0, 0);
