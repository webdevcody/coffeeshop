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
});
// Sand beach apron + island discs (opaque, matte).
const sandMat = new THREE.MeshStandardMaterial({ color: "#d9c79a", roughness: 1, side: THREE.DoubleSide });
const sandSideMat = new THREE.MeshStandardMaterial({ color: "#b89f6e", roughness: 1 });
// Foam trim riding the waterline (visual only).
const foamMat = new THREE.MeshStandardMaterial({
  color: "#eaf6fb", roughness: 0.7, emissive: "#cfeaf4", emissiveIntensity: 0.35,
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
};

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

export function buildOcean(opts = {}) {
  const lb = opts.landBounds || { minX: -125, maxX: 125, minZ: -15, maxZ: 285 };
  const group = new THREE.Group();
  group.name = "ocean";

  // Returned contract arrays.
  const ground = [];     // EXTRA walkable rects (beach apron, dock platform, island tops)
  const colliders = [];  // SOLID island/dock props
  const docks = [];      // {x,z} boarding points
  const islandDiscs = [];// {x, z, r} for isWater + ground (cached plain numbers)

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
  const seaGeo = new THREE.PlaneGeometry(SEA_HALF * 2, SEA_HALF * 2, 48, 48);
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
  // Register the dock platform as walkable ground.
  ground.push({ minX: dockX1, maxX: dockX0, minZ: dockZ - DOCK_W / 2, maxZ: dockZ + DOCK_W / 2 });
  const dockRect = { minX: dockX1, maxX: dockX0, minZ: dockZ - DOCK_W / 2, maxZ: dockZ + DOCK_W / 2 };
  // Boarding point at the seaward tip + boat spawn floating just past it (in water).
  docks.push({ x: dockX1 + 1.5, z: dockZ });
  const boatSpawn = { x: dockX1 - 4, z: dockZ, heading: Math.PI / 2 }; // facing out to sea (-X / west)

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
  for (const isl of ISLANDS) {
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

    // A couple of palms for flavour (trunk colliders).
    for (let p = 0; p < 2; p++) {
      const pa = isl.dockDir + Math.PI + (p === 0 ? 0.9 : -0.9);
      const prad = isl.r * 0.55;
      const lx = Math.cos(pa) * prad, lz = Math.sin(pa) * prad;
      const palm = makePalm();
      palm.position.set(lx, 0, lz);
      ig.add(palm);
      addAABB(colliders, ix + lx, iz + lz, 0.6, 0.6); // palm trunk collider
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
      const h = Math.sin(lx * 0.02 + t * 0.8) * 0.5
              + Math.cos(ly * 0.025 - t * 0.6) * 0.4
              + Math.sin((lx + ly) * 0.05 + t * 1.4) * 0.15;
      seaPos.setZ(i, seaBaseZ[i] + h);
    }
    seaPos.needsUpdate = true;
    seaGeo.computeVertexNormals(); // facet normals shift → moving sparkle
    // Colour/emissive shimmer between teal and a sun-glint blue.
    const s = (Math.sin(t * 0.7) + 1) * 0.5; // 0..1
    seaMat.emissiveIntensity = 0.22 + s * 0.16;
    seaMat.color.setRGB(0.10 + s * 0.05, 0.42 + s * 0.07, 0.60 + s * 0.06);
    foamMat.opacity = 0.4 + (Math.sin(t * 1.4) + 1) * 0.5 * 0.25;
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
