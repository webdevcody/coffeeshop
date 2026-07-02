// OCEAN — wraps the whole city in a HUGE sea so the landmass reads as an ISLAND.
//
// What this module adds to the world (all in WORLD coords, added straight to the
// scene by main.js):
//   • One enormous animated water plane centred on the city, spanning ~3200 m so
//     it fades into the existing fog horizon (no hard edge — the fog at 220→480
//     swallows the rim, so the sea reads as endless).
//   • A sand BEACH apron ringing the city just outside its walkable AABB, so you
//     can stroll off the pavement onto the sand to the water's edge.
//   • A wooden MAIN DOCK bridging west off the landmass out over the water, with
//     a boat floating at its seaward tip.
//   • Four tiny ISLANDS a moderate distance out, each a raised sand disc topped
//     with a little themed SHOP hut, a palm tree or two, and a short dock.
//
// ── Y-STACK (must not fight the city's existing stack) ─────────────────────────
// The city already uses: base pavement y=-0.12, district slabs top y=0.00, road
// grid y=0.02, road decals y=0.025; camera near=1.0 far=600; fog 220→480.
//   • waterY = -0.80  → the sea surface sits BELOW the pavement (-0.12), so the
//                       whole city sits ON TOP of the sea with a clear air gap and
//                       ZERO z-fighting against any city ground layer.
//   • beach apron y=-0.06 → between pavement (-0.12) and slab (0.00): an opaque
//                       sand ring that reads as shoreline and is above the water.
//   • dock platform y=-0.02 → just above the sand apron, walkable, below slab top.
//   • island disc top y= 0.00 → flush with the city slab top, so island tops read
//                       as the same "ground height" as downtown.
// Every walkable surface here is ABOVE waterY, so the sea never pokes through.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// All materials + geometries are created ONCE at module scope (like the zone
// files). update(dt) only mutates cached vertex/uv data + a couple material
// scalars — no `new` per frame. isWater() walks cached plain-number arrays.

import * as THREE from "three";

// ── Shared materials (created ONCE) ───────────────────────────────────────────
// Sea: a glossy, faintly transparent blue. DoubleSide so the surface still reads
// when the camera dips near the waterline or looks at it edge-on from a dock.
const seaMat = new THREE.MeshStandardMaterial({
  color: "#1f6f9c", roughness: 0.18, metalness: 0.35,
  emissive: "#0a3650", emissiveIntensity: 0.28,
  transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  flatShading: true, // crisp little facets catch the light → a glittery swell
  vertexColors: true, // baked depth gradient: bright turquoise shallows → deep navy
});
// Sand beach apron + island discs (opaque, matte).
const sandMat = new THREE.MeshStandardMaterial({ color: "#d9c79a", roughness: 1, side: THREE.DoubleSide });
const sandSideMat = new THREE.MeshStandardMaterial({ color: "#b89f6e", roughness: 1 });
// Foam trim riding the waterline (visual only).
const foamMat = new THREE.MeshStandardMaterial({
  color: "#eaf6fb", roughness: 0.7, emissive: "#cfeaf4", emissiveIntensity: 0.4,
  transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
});
// Dock woodwork.
const plankMat = new THREE.MeshStandardMaterial({ color: "#9c6b3f", roughness: 0.85 });
const plankDarkMat = new THREE.MeshStandardMaterial({ color: "#7d5230", roughness: 0.9 });
const pilingMat = new THREE.MeshStandardMaterial({ color: "#5d4127", roughness: 0.95 });
const railMat = new THREE.MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.8 });
// Island greenery + palms.
const grassMat = new THREE.MeshStandardMaterial({ color: "#6fae54", roughness: 0.95, side: THREE.DoubleSide });
const trunkMat = new THREE.MeshStandardMaterial({ color: "#8a5a32", roughness: 0.9 });
const frondMat = new THREE.MeshStandardMaterial({ color: "#3f9e54", roughness: 0.8, side: THREE.DoubleSide });
// Shop hut skins (one neutral cabin wall + one roof; awnings/signs are recoloured
// per island via cloned materials so the four shops read distinct).
const hutWallMat = new THREE.MeshStandardMaterial({ color: "#efe6cf", roughness: 0.85 });
const hutRoofMat = new THREE.MeshStandardMaterial({ color: "#b8453e", roughness: 0.7 });
const hutPostMat = new THREE.MeshStandardMaterial({ color: "#caa86a", roughness: 0.85 });

// ── Shared geometries (created ONCE) ──────────────────────────────────────────
const G = {
  pilingGeo: new THREE.CylinderGeometry(0.18, 0.22, 4.0, 8),
  railPostGeo: new THREE.BoxGeometry(0.12, 0.9, 0.12),
  trunkGeo: new THREE.CylinderGeometry(0.18, 0.28, 4.2, 8),
  frondGeo: new THREE.PlaneGeometry(2.6, 0.8),
  coconutGeo: new THREE.SphereGeometry(0.16, 8, 6),
  // Beach + shoreline dressing (all shared, created once).
  rockGeo: new THREE.DodecahedronGeometry(1, 0),          // scaled per-instance
  lanternGeo: new THREE.BoxGeometry(0.34, 0.5, 0.34),
  ropeGeo: new THREE.CylinderGeometry(0.05, 0.05, 1, 6),  // scaled along its run
  chairLegGeo: new THREE.BoxGeometry(0.08, 0.5, 0.08),
  hullGeo: new THREE.BoxGeometry(3.4, 0.7, 1.5),
  debrisFlagGeo: new THREE.PlaneGeometry(1.2, 0.7),
};

// ── Extra shared materials for shoreline/dock dressing (created ONCE) ──────────
const rockMat = new THREE.MeshStandardMaterial({ color: "#8a8f96", roughness: 1, flatShading: true });
const rockDarkMat = new THREE.MeshStandardMaterial({ color: "#5f676e", roughness: 1, flatShading: true });
// Warm emissive lantern glass (no light object — emissive only, pulsed in update()).
const lanternMat = new THREE.MeshStandardMaterial({
  color: "#ffd489", emissive: "#ffb64a", emissiveIntensity: 1.1, roughness: 0.5,
});
const ropeMat = new THREE.MeshStandardMaterial({ color: "#caa46b", roughness: 1 });
const dinghyHullMat = new THREE.MeshStandardMaterial({ color: "#b8492f", roughness: 0.8 });
const dinghyTrimMat = new THREE.MeshStandardMaterial({ color: "#e9dcc0", roughness: 0.8 });
const chairFrameMat = new THREE.MeshStandardMaterial({ color: "#c9b98f", roughness: 0.9 });
const clothMats = [
  new THREE.MeshStandardMaterial({ color: "#e46a6a", roughness: 0.85, side: THREE.DoubleSide }),
  new THREE.MeshStandardMaterial({ color: "#e8b04b", roughness: 0.85, side: THREE.DoubleSide }),
  new THREE.MeshStandardMaterial({ color: "#5fa9d6", roughness: 0.85, side: THREE.DoubleSide }),
];
const hammockMat = new THREE.MeshStandardMaterial({ color: "#d8d2c2", roughness: 1, side: THREE.DoubleSide });
const gullMat = new THREE.MeshStandardMaterial({ color: "#f2f5f8", roughness: 0.9, side: THREE.DoubleSide });

// ── Per-frame scratch (created ONCE; update() only mutates these) ─────────────
const _m4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _scl = new THREE.Vector3(1, 1, 1);

// A soft, seamless foam-bubble texture built ONCE on a small canvas. Scrolled by
// update() (offset mutation only — no allocation) so shoreline foam looks alive.
function makeFoamTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 128, y = Math.random() * 128, r = 2 + Math.random() * 8;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  return tex;
}
const foamTex = makeFoamTexture();
// The foam trim now reads as scattered bubbles (texture alpha) rather than a flat
// strip; update() scrolls it so the surf appears to wash along the shoreline.
foamMat.map = foamTex;

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = true, receive = true) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}
function addAABB(arr, cx, cz, w, d) {
  arr.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

// A palm tree: a leaning trunk + a fan of fronds + a couple of coconuts. Returns
// a group positioned by the caller; the trunk's footprint is added as a collider
// by the island builder.
function makePalm() {
  const g = new THREE.Group();
  const trunk = mesh(G.trunkGeo, trunkMat);
  trunk.position.y = 2.1;
  trunk.rotation.z = 0.12; // a gentle island lean
  g.add(trunk);
  const crown = new THREE.Group();
  crown.position.set(0.5, 4.1, 0);
  for (let i = 0; i < 6; i++) {
    const frond = mesh(G.frondGeo, frondMat, true, false);
    frond.rotation.y = (i / 6) * Math.PI * 2;
    frond.rotation.z = -0.5;
    frond.position.x = 1.1;
    const holder = new THREE.Group();
    holder.rotation.y = (i / 6) * Math.PI * 2;
    holder.add(frond);
    crown.add(holder);
  }
  for (let i = 0; i < 3; i++) {
    const c = mesh(G.coconutGeo, trunkMat, true, false);
    c.position.set(0.4 + Math.cos(i) * 0.2, -0.1, Math.sin(i) * 0.2);
    crown.add(c);
  }
  g.add(crown);
  return g;
}

// A little SHOP hut: a colored cabin (neutral walls), a pitched roof, a small
// awning + an emissive sign panel in the shop's accent colour. `accent` tints the
// awning/sign so the four shops read as distinct vibes. Returns { group, w, d }.
function makeShopHut(accent) {
  const g = new THREE.Group();
  const w = 4.2, d = 3.4, h = 2.8;
  const body = box(w, h, d, hutWallMat);
  body.position.y = h / 2;
  g.add(body);
  // Pitched roof (a flattened pyramid) overhanging the walls a touch.
  const roof = mesh(new THREE.ConeGeometry(w * 0.72, 1.4, 4), hutRoofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = h + 0.7;
  roof.scale.z = d / w;
  g.add(roof);
  // Door (decor) on the +Z face.
  const door = box(1.0, 1.8, 0.1, plankDarkMat, false);
  door.position.set(0, 0.9, d / 2 + 0.02);
  g.add(door);
  // Awning over the door, tinted with the shop accent (cloned so each hut differs).
  const awnMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.75, side: THREE.DoubleSide });
  const awn = box(w - 0.4, 0.1, 1.4, awnMat, false);
  awn.position.set(0, h - 0.4, d / 2 + 0.6);
  awn.rotation.x = -0.2;
  g.add(awn);
  for (const sx of [-(w / 2) + 0.5, (w / 2) - 0.5]) {
    const post = box(0.1, h - 0.6, 0.1, hutPostMat, false);
    post.position.set(sx, (h - 0.6) / 2, d / 2 + 1.2);
    g.add(post);
  }
  // Glowing sign board above the awning in the accent colour.
  const signMat = new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.5, emissive: accent, emissiveIntensity: 0.6,
  });
  const sign = box(w * 0.8, 0.7, 0.12, signMat, false);
  sign.position.set(0, h + 0.2, d / 2 + 0.1);
  g.add(sign);
  return { group: g, w, d };
}

// A striped beach lounger: two low legs + a reclined seat/back plane in a bright
// cloth colour. Purely decorative (no collider — it sits on the walkable island).
function makeBeachChair(cloth) {
  const g = new THREE.Group();
  for (const sx of [-0.35, 0.35]) {
    const leg = mesh(G.chairLegGeo, chairFrameMat, false);
    leg.position.set(sx, 0.18, 0.1);
    g.add(leg);
  }
  const seat = mesh(new THREE.PlaneGeometry(0.9, 0.9), cloth, false, false);
  seat.rotation.x = -Math.PI / 2;
  seat.position.set(0, 0.36, 0.1);
  g.add(seat);
  const back = mesh(new THREE.PlaneGeometry(0.9, 0.8), cloth, false, false);
  back.rotation.x = -0.9;      // reclined
  back.position.set(0, 0.66, -0.32);
  g.add(back);
  return g;
}

// A hammock slung between two short posts: two posts + a sagging cloth sling
// (approximated by a gently tilted, double-sided plane).
function makeHammock() {
  const g = new THREE.Group();
  for (const sx of [-1.1, 1.1]) {
    const post = mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 6), chairFrameMat, false);
    post.position.set(sx, 0.65, 0);
    post.rotation.z = sx > 0 ? -0.12 : 0.12;
    g.add(post);
  }
  const sling = mesh(new THREE.PlaneGeometry(2.0, 0.6), hammockMat, false, false);
  sling.rotation.x = -Math.PI / 2.2;
  sling.position.set(0, 0.85, 0);
  g.add(sling);
  return g;
}

// A little moored dinghy: a shallow hull with a pale gunwale trim and a thwart
// seat. Returned so the caller can bob it in update() (position/roll mutation).
function makeDinghy() {
  const g = new THREE.Group();
  const hull = mesh(G.hullGeo, dinghyHullMat);
  hull.position.y = 0.35;
  g.add(hull);
  const trim = box(3.4, 0.14, 1.5, dinghyTrimMat, false);
  trim.position.y = 0.7;
  g.add(trim);
  const seat = box(0.8, 0.1, 1.3, dinghyTrimMat, false);
  seat.position.set(0, 0.55, 0);
  g.add(seat);
  return g;
}

// A minimal "M"-shaped gull: two swept wing quads sharing a body vertex. Built
// once; instanced into a small drifting flock.
function makeGullGeo() {
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    0, 0, 0,   -1.1, 0.35, -0.15,   -0.5, 0.05, 0.0,   // left wing
    0, 0, 0,    1.1, 0.35, -0.15,    0.5, 0.05, 0.0,   // right wing
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

export function buildOcean(opts = {}) {
  const lb = opts.landBounds || { minX: -125, maxX: 125, minZ: -15, maxZ: 285 };
  const group = new THREE.Group();
  group.name = "ocean";

  // Returned contract arrays.
  const ground = [];     // EXTRA walkable rects (beach apron, dock platform, island tops)
  const colliders = [];  // SOLID island/dock props
  const docks = [];      // {x,z} boarding points
  const islandDiscs = [];// {x, z, r} for isWater + ground (cached plain numbers)
  const lanterns = [];   // lantern meshes pulsed by update() (emissive only — no lights)
  let dinghy = null;     // moored dinghy group, bobbed by update()

  // Y-stack constants (see header).
  const waterY = -0.8;
  const beachY = -0.06;
  const dockY = -0.02;

  // City centre (used to centre the sea + radiate the islands).
  const cx = (lb.minX + lb.maxX) / 2;
  const cz = (lb.minZ + lb.maxZ) / 2;

  // ── 1) HUGE WATER PLANE ─────────────────────────────────────────────────────
  // Half-size ~1600 → ~3200 across. A modest 48×48 segment grid is plenty for a
  // cheap sine swell; we cache the base heights once so update() never allocates.
  const SEA_HALF = 1600;
  const seaGeo = new THREE.PlaneGeometry(SEA_HALF * 2, SEA_HALF * 2, 32, 32);
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(cx, waterY, cz);
  sea.receiveShadow = true;
  group.add(sea);
  // Sea bounds (world AABB of the plane) — used by isWater.
  const seaMinX = cx - SEA_HALF, seaMaxX = cx + SEA_HALF;
  const seaMinZ = cz - SEA_HALF, seaMaxZ = cz + SEA_HALF;
  // Cache base (pre-swell) plane-local Z (= world height before rotation).
  const seaPos = seaGeo.attributes.position;
  const seaBaseZ = new Float32Array(seaPos.count);
  // Also cache plane-local X/Y so update() reads cached numbers, not attribute gets.
  const seaLX = new Float32Array(seaPos.count);
  const seaLY = new Float32Array(seaPos.count);
  for (let i = 0; i < seaPos.count; i++) {
    seaLX[i] = seaPos.getX(i);
    seaLY[i] = seaPos.getY(i);
    seaBaseZ[i] = seaPos.getZ(i);
  }
  // Baked DEPTH GRADIENT via vertex colours. The plane is centred on the city, so
  // a vertex's distance from the plane centre ≈ its distance from the island: near
  // vertices get a bright turquoise "shallows" tint (values >1 lift the greens for
  // a lagoon glow under tone-mapping), far vertices get a darker, bluer "deep sea"
  // tint. These MULTIPLY the animated material colour, so the swell shimmer still
  // plays on top. Computed ONCE — no per-frame cost.
  {
    const seaCol = new Float32Array(seaPos.count * 3);
    for (let i = 0; i < seaPos.count; i++) {
      const d = Math.sqrt(seaLX[i] * seaLX[i] + seaLY[i] * seaLY[i]);
      // 0 at the island, 1 out in open water (~340 m fade to deep).
      const t01 = Math.min(1, d / 340);
      const e = t01 * t01 * (3 - 2 * t01); // smoothstep
      // shallow (1.15, 1.32, 1.18) → deep (0.34, 0.52, 0.82)
      seaCol[i * 3]     = 1.15 + (0.34 - 1.15) * e;
      seaCol[i * 3 + 1] = 1.32 + (0.52 - 1.32) * e;
      seaCol[i * 3 + 2] = 1.18 + (0.82 - 1.18) * e;
    }
    seaGeo.setAttribute("color", new THREE.BufferAttribute(seaCol, 3));
  }

  // ── 2) SHORELINE BEACH apron ring (just outside landBounds) ─────────────────
  const APRON = 14; // how far the sand extends out past the city on each side
  // Four rectangular sand strips forming a ring around the landmass. Each strip
  // is a flat box at beachY; we register each as a walkable `ground` rect and as a
  // beach AABB (for isWater). Corners are covered by extending the N/S strips the
  // full apron-widened width.
  const beachRects = []; // {minX,maxX,minZ,maxZ} for isWater
  function addBeachStrip(minX, maxX, minZ, maxZ) {
    const w = maxX - minX, d = maxZ - minZ;
    const mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
    const slab = box(w, 0.12, d, sandMat, false, true);
    slab.position.set(mx, beachY - 0.06, mz);
    group.add(slab);
    ground.push({ minX, maxX, minZ, maxZ });
    beachRects.push({ minX, maxX, minZ, maxZ });
    // A thin foam trim along the seaward edges (visual only) is added by caller.
  }
  // West strip, East strip (full city Z depth), North + South strips (widened to
  // cover the corners).
  addBeachStrip(lb.minX - APRON, lb.minX, lb.minZ, lb.maxZ); // west
  addBeachStrip(lb.maxX, lb.maxX + APRON, lb.minZ, lb.maxZ); // east
  addBeachStrip(lb.minX - APRON, lb.maxX + APRON, lb.minZ - APRON, lb.minZ); // south (-Z), widened
  addBeachStrip(lb.minX - APRON, lb.maxX + APRON, lb.maxZ, lb.maxZ + APRON); // north (+Z), widened
  // Foam waterline trim ringing the apron's outer edge (purely visual quads).
  for (const [fx, fz, fw, fd] of [
    [lb.minX - APRON, cz, 1.6, (lb.maxZ - lb.minZ) + APRON * 2 + 3],   // west edge
    [lb.maxX + APRON, cz, 1.6, (lb.maxZ - lb.minZ) + APRON * 2 + 3],   // east edge
    [cx, lb.minZ - APRON, (lb.maxX - lb.minX) + APRON * 2 + 3, 1.6],   // south edge
    [cx, lb.maxZ + APRON, (lb.maxX - lb.minX) + APRON * 2 + 3, 1.6],   // north edge
  ]) {
    const foam = mesh(new THREE.PlaneGeometry(fw, fd), foamMat, false, false);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(fx, waterY + 0.06, fz);
    group.add(foam);
  }

  // ── 3) MAIN DOCK — bridges WEST off the landmass out over the water ─────────
  const dockZ = cz;                       // mid-Z of the landmass
  const DOCK_W = 4;                        // 4 m wide plank platform
  const DOCK_OUT = 22;                     // reaches 22 m past the beach apron
  const dockX0 = lb.minX - APRON;          // starts at the beach's outer (west) edge
  const dockX1 = dockX0 - DOCK_OUT;        // seaward tip (further west = smaller X)
  const dockLen = dockX0 - dockX1;
  const dockMx = (dockX0 + dockX1) / 2;
  const dockPlat = box(dockLen, 0.16, DOCK_W, plankMat, true, true);
  dockPlat.position.set(dockMx, dockY - 0.04, dockZ);
  group.add(dockPlat);
  // Cross-plank seams for decking detail.
  for (let i = 1; i < Math.floor(dockLen / 2); i++) {
    const seam = box(0.1, 0.18, DOCK_W, plankDarkMat, false, false);
    seam.position.set(dockX1 + i * 2, dockY - 0.03, dockZ);
    group.add(seam);
  }
  // Pilings under the dock + rail posts (colliders) along both sides.
  for (let i = 0; i <= Math.floor(dockLen / 5); i++) {
    const px = dockX1 + i * 5;
    for (const side of [-1, 1]) {
      const pz = dockZ + side * (DOCK_W / 2 - 0.3);
      const piling = mesh(G.pilingGeo, pilingMat, true, false);
      piling.position.set(px, waterY - 1.6, pz);
      group.add(piling);
      const post = mesh(G.railPostGeo, railMat, true, false);
      post.position.set(px, dockY + 0.4, pz);
      group.add(post);
      addAABB(colliders, px, pz, 0.3, 0.3); // slim rail-post collider
    }
  }
  // Guide ROPES strung between consecutive rail posts (both sides) + warm LANTERNS
  // on every other post. Ropes are thin cylinders laid along the dock run; lanterns
  // are emissive boxes (no light objects) whose glow is gently pulsed in update().
  const postTopY = dockY + 0.85;
  const nPosts = Math.floor(dockLen / 5);
  for (const side of [-1, 1]) {
    const pz = dockZ + side * (DOCK_W / 2 - 0.3);
    for (let i = 0; i < nPosts; i++) {
      const rope = mesh(G.ropeGeo, ropeMat, false, false);
      rope.scale.y = 5;                 // span one 5 m post gap
      rope.rotation.z = Math.PI / 2;    // lay along +X
      rope.position.set(dockX1 + i * 5 + 2.5, postTopY - 0.12, pz);
      group.add(rope);
    }
    for (let i = 0; i <= nPosts; i += 2) {
      const lantern = mesh(G.lanternGeo, lanternMat.clone(), false, false);
      lantern.position.set(dockX1 + i * 5, postTopY + 0.1, pz);
      group.add(lantern);
      lanterns.push(lantern);
    }
  }
  // A moored DINGHY floating just off the north side of the dock (over water, clear
  // of the boat spawn/board reach). Bobbed + gently rolled by update().
  dinghy = makeDinghy();
  dinghy.position.set(dockMx, waterY + 0.15, dockZ + DOCK_W / 2 + 2.6);
  dinghy.rotation.y = 0.35;
  group.add(dinghy);
  // A short tie-rope from a dock post down to the dinghy.
  {
    const tie = mesh(G.ropeGeo, ropeMat, false, false);
    tie.scale.y = 3.0;
    tie.rotation.x = -0.9;
    tie.position.set(dockMx - 0.6, postTopY - 0.6, dockZ + DOCK_W / 2 + 0.6);
    group.add(tie);
  }
  // Register the dock platform as walkable ground.
  ground.push({ minX: dockX1, maxX: dockX0, minZ: dockZ - DOCK_W / 2, maxZ: dockZ + DOCK_W / 2 });
  const dockRect = { minX: dockX1, maxX: dockX0, minZ: dockZ - DOCK_W / 2, maxZ: dockZ + DOCK_W / 2 };
  // Boarding point near the seaward tip + boat spawn floating just past it (in
  // water). These MUST be close: the boat is boardable only within the ride's
  // board reach (~4 m), so the gap between this boarding point and the boat has to
  // stay under that. Boarding at the tip (dockX1+1.0, on the walkable dock) and the
  // boat 2.5 m past the tip → ~3.5 m apart, comfortably within reach. (Was 5.5 m,
  // which made the boat impossible to board.)
  docks.push({ x: dockX1 + 1.0, z: dockZ });
  const boatSpawn = { x: dockX1 - 2.5, z: dockZ, heading: Math.PI / 2 }; // facing out to sea (-X / west)

  // ── 4) FOUR TINY ISLANDS, each with a shop, palms + a short dock ────────────
  // Spread NW / NE / SE / SW of the city centre at a moderate radius so they're
  // visible but clear of the landmass and each other. Each entry: angle (rad from
  // +X, CCW), radial distance, island radius, shop accent + name, and the heading
  // (in radians) toward open water for the island's little dock.
  // dist tuned so every island clears the beach apron by ~30-40 m of open water
  // (the landmass is a tall rectangle z∈[-15,285], so the NW/SW corners sit far
  // from the city centre — radial distance must exceed the half-diagonal + apron).
  const ISLANDS = [
    { name: "Bait & Tackle", accent: "#2f7f93", ang: Math.PI * 0.75, dist: 260, r: 13, dockDir: Math.PI * 0.75 },  // NW
    { name: "Tiki Bar",      accent: "#e08a2f", ang: Math.PI * 0.25, dist: 250, r: 14, dockDir: Math.PI * 0.25 },  // NE
    { name: "Surf Shack",    accent: "#3fa0c7", ang: -Math.PI * 0.25, dist: 250, r: 12, dockDir: -Math.PI * 0.25 }, // SE
    { name: "Ice Cream",     accent: "#e85d8a", ang: -Math.PI * 0.75, dist: 250, r: 13, dockDir: -Math.PI * 0.75 }, // SW
  ];
  const islandCoords = []; // for the summary text
  const rockXforms = [];   // {x,y,z,s,ry,dark} collected across all islands → one InstancedMesh
  let islIdx = -1;
  for (const isl of ISLANDS) {
    islIdx++;
    const ix = cx + Math.cos(isl.ang) * isl.dist;
    const iz = cz + Math.sin(isl.ang) * isl.dist;
    islandCoords.push({ name: isl.name, x: Math.round(ix), z: Math.round(iz) });

    const ig = new THREE.Group();
    ig.position.set(ix, 0, iz);

    // Raised sand disc: a short tapered cylinder rising from the seabed to y=0.
    // Skirt goes down to below waterY so no gap shows at the shoreline.
    // Total cylinder height; placed so its TOP face sits flush at y=0 (the city
    // slab top), with its skirt reaching well below waterY (-0.8) so no gap shows.
    const discTotalH = 2.4;
    const disc = mesh(new THREE.CylinderGeometry(isl.r, isl.r + 1.5, discTotalH, 24), sandMat, false, true);
    disc.position.y = -discTotalH / 2; // top face at y=0
    ig.add(disc);
    // A grass cap on the inner top so the island reads sand-rim + grass-centre.
    const grass = mesh(new THREE.CylinderGeometry(isl.r - 2.5, isl.r - 2.5, 0.08, 24), grassMat, false, true);
    grass.position.y = 0.04;
    ig.add(grass);
    // A faint foam ring around the island waterline (visual).
    const ring = mesh(new THREE.TorusGeometry(isl.r + 0.6, 0.5, 6, 28), foamMat, false, false);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = waterY + 0.05;
    ig.add(ring);

    // SHOP hut near the island centre, facing the city (toward -dockDir-ish): we
    // simply face it toward the island's dock so you walk dock→door.
    const hut = makeShopHut(isl.accent);
    // Place hut slightly back from centre, on the side AWAY from the dock so the
    // dock approach lands at its front.
    const hutBackX = -Math.cos(isl.dockDir) * (isl.r * 0.35);
    const hutBackZ = -Math.sin(isl.dockDir) * (isl.r * 0.35);
    hut.group.position.set(hutBackX, 0, hutBackZ);
    hut.group.rotation.y = isl.dockDir + Math.PI / 2; // front (+Z face) toward the dock
    ig.add(hut.group);
    // Hut footprint collider (world coords): rotate the local footprint roughly to
    // an axis-aligned AABB sized to the hut's larger extent (cheap + safe).
    const hutR = Math.max(hut.w, hut.d) / 2 + 0.3;
    addAABB(colliders, ix + hutBackX, iz + hutBackZ, hutR * 2, hutR * 2);

    // A little palm CLUSTER for flavour (trunk colliders). Two full palms flanking
    // the shop plus a shorter third leaning the other way so the grove reads fuller.
    const palmDefs = [
      { off: 0.9, rad: 0.55, scale: 1.0, lean: 0.12 },
      { off: -0.9, rad: 0.55, scale: 0.92, lean: -0.1 },
      { off: 0.2, rad: 0.72, scale: 0.72, lean: 0.18 },
    ];
    for (const pd of palmDefs) {
      const pa = isl.dockDir + Math.PI + pd.off;
      const prad = isl.r * pd.rad;
      const lx = Math.cos(pa) * prad, lz = Math.sin(pa) * prad;
      const palm = makePalm();
      palm.position.set(lx, 0, lz);
      palm.scale.setScalar(pd.scale);
      palm.rotation.y = pa;
      ig.add(palm);
      addAABB(colliders, ix + lx, iz + lz, 0.6, 0.6); // palm trunk collider
    }

    // A striped beach lounger + a slung hammock near the shop front for holiday
    // vibe (decorative — they sit on the walkable island top, no colliders).
    const chair = makeBeachChair(clothMats[islIdx % clothMats.length]);
    const chairA = isl.dockDir + 0.6;
    chair.position.set(Math.cos(chairA) * isl.r * 0.45, 0.08, Math.sin(chairA) * isl.r * 0.45);
    chair.rotation.y = -isl.dockDir + 0.4;
    ig.add(chair);
    const ham = makeHammock();
    const hamA = isl.dockDir + Math.PI - 0.4;
    ham.position.set(Math.cos(hamA) * isl.r * 0.5, 0.08, Math.sin(hamA) * isl.r * 0.5);
    ham.rotation.y = hamA;
    ig.add(ham);

    // A ring of shoreline BOULDERS scattered just inside the rim (collected into a
    // single InstancedMesh after the loop — one draw call for all islands' rocks).
    const rockN = 5;
    for (let k = 0; k < rockN; k++) {
      const ra = (k / rockN) * Math.PI * 2 + islIdx * 0.7;
      // Keep rocks off the dock approach so they never block boarding.
      if (Math.abs(((ra - isl.dockDir + Math.PI) % (Math.PI * 2))) < 0.5) continue;
      const rr = isl.r - 0.6;
      const s = 0.6 + ((k * 7 + islIdx) % 5) * 0.18;
      rockXforms.push({
        x: ix + Math.cos(ra) * rr, y: -0.15, z: iz + Math.sin(ra) * rr,
        s, ry: ra * 1.7, dark: (k % 2) === 0,
      });
    }

    // SHORT DOCK jutting from the island toward open water (in the dockDir).
    const idLen = 8, idW = 2.2;
    const idDirX = Math.cos(isl.dockDir), idDirZ = Math.sin(isl.dockDir);
    const idStart = isl.r - 1;          // start just inside the rim
    const idEnd = isl.r - 1 + idLen;    // seaward tip (local radius)
    const idMidR = (idStart + idEnd) / 2;
    const idGroup = new THREE.Group();
    const idPlat = box(idLen, 0.14, idW, plankMat, true, true);
    idPlat.position.set(idMidR, dockY - 0.04, 0);
    idGroup.add(idPlat);
    // a couple of pilings under the island dock
    for (let s = 0; s <= 1; s++) {
      const piling = mesh(G.pilingGeo, pilingMat, true, false);
      piling.position.set(idStart + s * idLen, waterY - 1.6, 0);
      idGroup.add(piling);
    }
    idGroup.rotation.y = -isl.dockDir; // orient +X run along the dock direction
    ig.add(idGroup);
    // Island dock as walkable ground (world AABB covering the dock run).
    const idTipX = ix + idDirX * idEnd, idTipZ = iz + idDirZ * idEnd;
    const idBaseX = ix + idDirX * idStart, idBaseZ = iz + idDirZ * idStart;
    ground.push({
      minX: Math.min(idBaseX, idTipX) - idW / 2, maxX: Math.max(idBaseX, idTipX) + idW / 2,
      minZ: Math.min(idBaseZ, idTipZ) - idW / 2, maxZ: Math.max(idBaseZ, idTipZ) + idW / 2,
    });
    // Boarding point at the island dock tip.
    docks.push({ x: idTipX - idDirX * 1.0, z: idTipZ - idDirZ * 1.0 });

    group.add(ig);

    // Register island disc as a walkable circular-ish AABB (a square inscribed-ish
    // bound that comfortably covers the top) + cache the disc for isWater.
    addAABB(ground, ix, iz, isl.r * 1.6, isl.r * 1.6);
    islandDiscs.push({ x: ix, z: iz, r: isl.r + 1.2 });
  }

  // ── 4b) SHORELINE BOULDERS — one InstancedMesh for every island's rocks ──────
  // Colour variation comes from per-instance instanceColor (light vs. weathered
  // dark) so a single mesh/draw-call covers them all. Set ONCE.
  if (rockXforms.length) {
    const rocks = new THREE.InstancedMesh(G.rockGeo, rockMat, rockXforms.length);
    rocks.castShadow = false;
    rocks.receiveShadow = true;
    for (let i = 0; i < rockXforms.length; i++) {
      const r = rockXforms[i];
      _pos.set(r.x, r.y, r.z);
      _eul.set(r.ry * 0.3, r.ry, r.ry * 0.2);
      _quat.setFromEuler(_eul);
      _scl.set(r.s * 1.3, r.s, r.s * 1.15);
      _m4.compose(_pos, _quat, _scl);
      rocks.setMatrixAt(i, _m4);
      rocks.setColorAt(i, r.dark ? rockDarkMat.color : rockMat.color);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    group.add(rocks);
  }
  // reset the shared scratch scale so later composes start from a clean (1,1,1)
  _scl.set(1, 1, 1);

  // ── 4c) SEAGULLS — a small drifting flock circling high over the lagoon ──────
  // One InstancedMesh (one draw call); update() re-composes the handful of matrices
  // each frame from cached per-gull orbit params using the shared scratch — no alloc.
  const GULL_COUNT = 7;
  const gulls = new THREE.InstancedMesh(makeGullGeo(), gullMat, GULL_COUNT);
  gulls.frustumCulled = false;
  const gullState = new Array(GULL_COUNT);
  for (let i = 0; i < GULL_COUNT; i++) {
    gullState[i] = {
      cx: cx + (Math.random() - 0.5) * 220,
      cz: cz + (Math.random() - 0.5) * 220,
      rad: 14 + Math.random() * 26,
      y: 26 + Math.random() * 22,
      phase: Math.random() * Math.PI * 2,
      speed: 0.15 + Math.random() * 0.2,
      flap: 2 + Math.random() * 2,
    };
  }
  group.add(gulls);

  // ── 5) isWater(x,z) ─────────────────────────────────────────────────────────
  // TRUE iff inside the sea plane AND outside the landmass, every beach apron,
  // the main dock platform, and every island disc. Fast cached AABB/radius checks
  // — no allocation. The boat is constrained to where this returns true.
  function isWater(x, z) {
    // Outside the sea plane entirely → not navigable water.
    if (x < seaMinX || x > seaMaxX || z < seaMinZ || z > seaMaxZ) return false;
    // Inside the city landmass AABB → land.
    if (x >= lb.minX && x <= lb.maxX && z >= lb.minZ && z <= lb.maxZ) return false;
    // Inside any beach apron rect → land.
    for (let i = 0; i < beachRects.length; i++) {
      const b = beachRects[i];
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return false;
    }
    // On the main dock platform → land.
    if (x >= dockRect.minX && x <= dockRect.maxX && z >= dockRect.minZ && z <= dockRect.maxZ) return false;
    // Inside any island disc (radius test) → land.
    for (let i = 0; i < islandDiscs.length; i++) {
      const d = islandDiscs[i];
      const dx = x - d.x, dz = z - d.z;
      if (dx * dx + dz * dz <= d.r * d.r) return false;
    }
    return true;
  }

  // ── Animation — cheap sine swell + a colour shimmer. ALLOCATION-FREE ─────────
  let t = 0;
  function update(dt) {
    t += dt;
    // Low-amplitude crossed sine waves over the cached grid. Reads cached local
    // X/Y arrays and writes Z back; no attribute getX/getY calls, no allocation.
    for (let i = 0; i < seaPos.count; i++) {
      const lx = seaLX[i], ly = seaLY[i];
      // Crested swell amplitude is kept SMALL (sum ≤ 0.56) on purpose: the sea sits
      // at waterY=-0.8 only 0.68 m below the base pavement (-0.12), so a bigger
      // swell (the old sum 1.05) pushed wave CRESTS up to +0.25 — above the city
      // slabs/roads at y=0 — and the sea visibly "overflowed" onto the tiles,
      // roads and cafe floor. At ≤0.56 the highest crest is -0.24, safely under the
      // pavement, so the sea can never poke through the city ground.
      const h = Math.sin(lx * 0.02 + t * 0.8) * 0.28
              + Math.cos(ly * 0.025 - t * 0.6) * 0.2
              + Math.sin((lx + ly) * 0.05 + t * 1.4) * 0.08;
      seaPos.setZ(i, seaBaseZ[i] + h);
    }
    seaPos.needsUpdate = true;
    // NO computeVertexNormals() here: the material is flatShading, so the shader
    // derives face normals from screen-space position derivatives and ignores the
    // normal attribute entirely. Recomputing 2304 vertex normals every frame was
    // pure wasted work (a major FPS sink) — the facets still sparkle as they move
    // because their POSITIONS change, which flat shading already responds to.
    // Colour/emissive shimmer between teal and a sun-glint blue.
    const s = (Math.sin(t * 0.7) + 1) * 0.5; // 0..1
    seaMat.emissiveIntensity = 0.22 + s * 0.16;
    seaMat.color.setRGB(0.10 + s * 0.05, 0.42 + s * 0.07, 0.60 + s * 0.06);
    foamMat.opacity = 0.4 + (Math.sin(t * 1.4) + 1) * 0.5 * 0.25;
    // Scroll the shared foam texture so surf appears to wash along every shoreline
    // (offset mutation only — the texture/material are shared, so this is one write).
    foamTex.offset.x = (t * 0.05) % 1;
    foamTex.offset.y = Math.sin(t * 0.6) * 0.03;

    // Lantern glow: a slow warm breathe with a faint per-lantern flicker offset.
    for (let i = 0; i < lanterns.length; i++) {
      lanterns[i].material.emissiveIntensity =
        0.9 + Math.sin(t * 1.3 + i * 1.7) * 0.35;
    }
    // Moored dinghy bobs on the swell + rolls gently.
    if (dinghy) {
      dinghy.position.y = waterY + 0.18 + Math.sin(t * 0.9) * 0.07;
      dinghy.rotation.z = Math.sin(t * 0.7) * 0.05;
      dinghy.rotation.x = Math.cos(t * 0.55) * 0.03;
    }
    // Seagulls drift in slow circles with a small wing "flap" (scale.y wobble).
    for (let i = 0; i < gullState.length; i++) {
      const g = gullState[i];
      const a = g.phase + t * g.speed;
      _pos.set(g.cx + Math.cos(a) * g.rad, g.y + Math.sin(t * 0.4 + i) * 1.2, g.cz + Math.sin(a) * g.rad);
      _eul.set(0, -a + Math.PI / 2, 0);
      _quat.setFromEuler(_eul);
      const flap = 0.7 + 0.3 * Math.abs(Math.sin(t * g.flap + i));
      _scl.set(1, flap, 1);
      _m4.compose(_pos, _quat, _scl);
      gulls.setMatrixAt(i, _m4);
    }
    gulls.instanceMatrix.needsUpdate = true;
    _scl.set(1, 1, 1);
  }

  return {
    group,
    update,
    waterY,
    ground,
    colliders,
    docks,
    boatSpawn,
    isWater,
    // (not part of the required contract, but handy for a caller's summary/HUD)
    _islands: islandCoords,
  };
}
