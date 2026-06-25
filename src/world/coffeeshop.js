// Assembles the coffeeshop: floor, walls, ceiling, windows, and all furniture.
// Returns { group, colliders } where colliders is an array of axis-aligned XZ
// boxes { minX, maxX, minZ, maxZ } used by the player movement code.

import * as THREE from "three";
import { WORLD } from "../config.js";
import { buildOutside } from "./outside.js";
import { buildCity } from "./city.js";
import { woodFloorTexture, plasterTexture, chalkboardMenuTexture, brickTexture, fabricTexture } from "./textures.js";
import {
  makeTable,
  makeChair,
  makeCounter,
  makeStool,
  makeEspressoMachine,
  makePastryCase,
  makePlant,
  makePendantLamp,
  makeRug,
  makeMug,
  makeChalkboard,
  makeWindow,
} from "./props.js";

// --- Shared interior-decor materials -------------------------------------
// Built once at module load and reused across every decor mesh below, so the
// extra cozy props add no per-frame allocation and no duplicate materials.
const DECOR = {
  frame: new THREE.MeshStandardMaterial({ color: "#3f2a1a", roughness: 0.65 }),
  artA: new THREE.MeshStandardMaterial({ color: "#caa05a", roughness: 0.9 }),
  artB: new THREE.MeshStandardMaterial({ color: "#7c9e8e", roughness: 0.9 }),
  artC: new THREE.MeshStandardMaterial({ color: "#b5613a", roughness: 0.9 }),
  shelfWood: new THREE.MeshStandardMaterial({ color: "#5a3c22", roughness: 0.7 }),
  bean: new THREE.MeshStandardMaterial({ color: "#3a2415", roughness: 0.7 }),
  jar: new THREE.MeshStandardMaterial({ color: "#dfe9ea", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.4 }),
  couch: new THREE.MeshStandardMaterial({ color: "#5d6f5a", roughness: 0.85 }),
  cushion: new THREE.MeshStandardMaterial({ color: "#b5613a", roughness: 0.85 }),
  couchLeg: new THREE.MeshStandardMaterial({ color: "#3f2a1a", roughness: 0.6 }),
  book: [
    new THREE.MeshStandardMaterial({ color: "#9e3b3b", roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: "#2a6e6a", roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: "#c98a3a", roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: "#3a4b7c", roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: "#6b4423", roughness: 0.8 }),
  ],
  string: new THREE.MeshStandardMaterial({ color: "#2a2a2a", roughness: 0.8 }),
  warmBulb: new THREE.MeshStandardMaterial({ color: "#fff2d0", emissive: "#ffcf8a", emissiveIntensity: 2.2 }),
  shaft: new THREE.MeshStandardMaterial({ color: "#fff4d8", emissive: "#fff0cf", emissiveIntensity: 0.5, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
  mugColors: ["#f4efe6", "#e8c8a0", "#9fc3b8", "#d98a8a", "#c9b48a"],
  // Sleeping ginger cat curled on a chair.
  catFur: new THREE.MeshStandardMaterial({ color: "#d6863f", roughness: 0.9 }),
  catFurDark: new THREE.MeshStandardMaterial({ color: "#b56a2c", roughness: 0.9 }),
  catNose: new THREE.MeshStandardMaterial({ color: "#caa05a", roughness: 0.8 }),
  // Condiment caddy + its contents.
  caddyWood: new THREE.MeshStandardMaterial({ color: "#5a3c22", roughness: 0.7 }),
  napkin: new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.95 }),
  sugarGlass: new THREE.MeshStandardMaterial({ color: "#dfe9ea", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45 }),
  sugarLid: new THREE.MeshStandardMaterial({ color: "#cfd2d6", roughness: 0.3, metalness: 0.8 }),
  sugar: new THREE.MeshStandardMaterial({ color: "#f0ead8", roughness: 1 }),
  milk: new THREE.MeshStandardMaterial({ color: "#cfd2d6", roughness: 0.25, metalness: 0.7 }),
  stir: new THREE.MeshStandardMaterial({ color: "#8a6a3a", roughness: 0.8 }),
  // Espresso steam: soft translucent white, no depth write so it never occludes.
  steam: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.15, transparent: true, opacity: 0.0, depthWrite: false }),
};

export function buildCoffeeshop(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const lights = [];
  // Sittable spots: { x, z, ry, seatY }. ry is the body facing when seated.
  const seats = [];
  // tableId -> the physical THREE.Group, so an in-world board can parent to the
  // correct table mesh (resolved from game-assign's `table` string).
  const tables = new Map();

  const halfW = WORLD.width / 2;
  const halfD = WORLD.depth / 2;
  const h = WORLD.wallHeight;

  // --- Floor ---------------------------------------------------------------
  const floorTex = woodFloorTexture();
  floorTex.repeat.set(WORLD.width / 2, WORLD.depth / 2);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.width, WORLD.depth),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // --- Ceiling -------------------------------------------------------------
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.width, WORLD.depth),
    new THREE.MeshStandardMaterial({ color: "#e8dcc6", roughness: 0.95, side: THREE.DoubleSide })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  group.add(ceiling);

  // --- Walls ---------------------------------------------------------------
  const wallTex = plasterTexture("#efe2cf");
  wallTex.repeat.set(6, 2);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, side: THREE.DoubleSide });
  const wainscotMat = new THREE.MeshStandardMaterial({ color: "#5d6f5a", roughness: 0.8 });

  function wall(w, x, z, ry) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, h / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    group.add(m);
    // Wainscot panel along the bottom. Walls sit on the room boundary, so nudge
    // the panel a few cm toward the room centre along the wall's inward normal —
    // otherwise its front face lands exactly on the wall plane and the two
    // z-fight (the "flashing wall"). Each wall is axis-aligned, so the inward
    // direction is simply away from whichever axis is pinned to the boundary.
    const inset = 0.06;
    const nx = x !== 0 ? -Math.sign(x) : 0;
    const nz = z !== 0 ? -Math.sign(z) : 0;
    const wain = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 0.08), wainscotMat);
    wain.position.set(x + nx * inset, 0.55, z + nz * inset);
    wain.rotation.y = ry;
    wain.receiveShadow = true;
    wain.castShadow = true;
    group.add(wain);
  }
  wall(WORLD.width, 0, -halfD, 0); // back
  wall(WORLD.depth, -halfW, 0, Math.PI / 2); // left
  wall(WORLD.depth, halfW, 0, -Math.PI / 2); // right

  // --- Front facade with an open entrance ----------------------------------
  // The front wall (z = +halfD) has a doorway cut into it so players can walk
  // out to the street. It's two plain wall segments either side of the opening
  // plus a header beam, a wooden frame, and an open glass door leaf.
  const doorHalf = 1.3; // half-width of the opening
  const doorTop = 3.2; // height of the opening
  const sideW = halfW - doorHalf; // width of each side segment
  function frontSegment(segW, cx) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(segW, h), wallMat);
    m.position.set(cx, h / 2, halfD);
    m.rotation.y = Math.PI;
    m.receiveShadow = true;
    group.add(m);
    const wain = new THREE.Mesh(new THREE.BoxGeometry(segW, 1.1, 0.08), wainscotMat);
    wain.position.set(cx, 0.55, halfD - 0.06); // just inside the wall plane
    wain.receiveShadow = true;
    wain.castShadow = true;
    group.add(wain);
  }
  frontSegment(sideW, -(doorHalf + sideW / 2));
  frontSegment(sideW, doorHalf + sideW / 2);
  // header above the opening
  const header = new THREE.Mesh(new THREE.PlaneGeometry(doorHalf * 2, h - doorTop), wallMat);
  header.position.set(0, (doorTop + h) / 2, halfD);
  header.rotation.y = Math.PI;
  header.receiveShadow = true;
  group.add(header);
  // wooden frame: jambs + lintel
  const frameMat = new THREE.MeshStandardMaterial({ color: "#4a3322", roughness: 0.6 });
  for (const jx of [-doorHalf, doorHalf]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.12, doorTop, 0.22), frameMat);
    jamb.position.set(jx, doorTop / 2, halfD - 0.04);
    jamb.castShadow = true;
    group.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorHalf * 2 + 0.24, 0.18, 0.22), frameMat);
  lintel.position.set(0, doorTop, halfD - 0.04);
  group.add(lintel);
  // an open glass door leaf, hinged on the left jamb and swung out to the street
  const leafPivot = new THREE.Group();
  leafPivot.position.set(-doorHalf + 0.04, 0, halfD - 0.04);
  const leafW = 2 * doorHalf - 0.16;
  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(leafW, doorTop - 0.12, 0.06),
    new THREE.MeshStandardMaterial({ color: "#bcd9e6", roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.55 })
  );
  leaf.position.set(leafW / 2, (doorTop - 0.12) / 2, 0);
  leafPivot.add(leaf);
  leafPivot.rotation.y = -1.95; // swing it open toward the street
  group.add(leafPivot);

  // Wall colliders (thin boxes just inside each wall). The front wall leaves a
  // gap at the entrance so you can walk through it.
  const t = 0.3;
  addBox(colliders, 0, -halfD + t / 2, WORLD.width, t); // back
  addBox(colliders, -(doorHalf + sideW / 2), halfD - t / 2, sideW, t); // front-left
  addBox(colliders, doorHalf + sideW / 2, halfD - t / 2, sideW, t); // front-right
  addBox(colliders, -halfW + t / 2, 0, t, WORLD.depth); // left
  addBox(colliders, halfW - t / 2, 0, t, WORLD.depth); // right

  // --- Windows on the left & right walls -----------------------------------
  for (const z of [-4, 4]) {
    const wL = makeWindow(2.6, 3.0);
    wL.position.set(-halfW + 0.06, 2.4, z);
    wL.rotation.y = Math.PI / 2;
    group.add(wL);
    const wR = makeWindow(2.6, 3.0);
    wR.position.set(halfW - 0.06, 2.4, z);
    wR.rotation.y = -Math.PI / 2;
    group.add(wR);
  }
  // Big front windows beside the door.
  for (const x of [-7, 7]) {
    const win = makeWindow(3.4, 3.0);
    win.position.set(x, 2.4, halfD - 0.06);
    win.rotation.y = Math.PI;
    group.add(win);
  }

  // --- Welcome mat just inside the entrance --------------------------------
  const matWelcome = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.02, 1.0),
    new THREE.MeshStandardMaterial({ color: "#7a5a3a", roughness: 1 })
  );
  matWelcome.position.set(0, 0.011, halfD - 1.0);
  matWelcome.receiveShadow = true;
  group.add(matWelcome);

  // --- Counter / bar along the back wall -----------------------------------
  const counterLen = 7;
  const counter = makeCounter(counterLen);
  counter.position.set(-2.5, 0, -halfD + 1.4);
  group.add(counter);
  addBox(colliders, -2.5, -halfD + 1.4, counterLen + 0.2, 1.0);
  // The order zone in front of the counter: stand here to use the coffee bar.
  const bar = { x: -2.5, z: -halfD + 1.4, halfW: counterLen / 2 + 0.5, range: 2.6 };

  const espresso = makeEspressoMachine();
  espresso.position.set(-4.0, 1.13, -halfD + 1.4);
  group.add(espresso);
  const pastry = makePastryCase();
  pastry.position.set(-1.2, 1.18, -halfD + 1.35); // sits on the counter worktop (top y≈1.10)
  group.add(pastry);
  // a few mugs on the counter
  for (const dx of [-0.2, 0.1, 0.5]) {
    const mug = makeMug();
    mug.position.set(-2.5 + dx, 1.13, -halfD + 1.55);
    group.add(mug);
  }

  // --- Animated espresso steam --------------------------------------------
  // A small wisp of steam rising from the machine's left brew group. Five soft
  // puffs cycle continuously: each rises, swells and fades on its own phase so
  // the wisp looks alive. Each puff owns a cloned material (one-time alloc) so
  // its opacity is independent; update() only mutates position/scale/opacity,
  // never allocates. The anchor offset comes from the machine itself.
  const steamPuffs = [];
  let steamT = 0; // accumulated time for the steam loop (advanced in update)
  {
    const a = espresso.userData.steamAnchor || { x: 0, y: 0.5, z: 0.3 };
    const baseX = espresso.position.x + a.x;
    const baseY = espresso.position.y + a.y;
    const baseZ = espresso.position.z + a.z;
    const puffGeo = new THREE.SphereGeometry(0.05, 8, 8);
    const N = 5;
    for (let i = 0; i < N; i++) {
      const m = new THREE.Mesh(puffGeo, DECOR.steam.clone());
      m.position.set(baseX, baseY, baseZ);
      m.renderOrder = 3; // draw after opaque props so the soft puff blends nicely
      group.add(m);
      steamPuffs.push({
        mesh: m,
        baseX, baseY, baseZ,
        phase: i / N, // staggered so puffs don't pulse in unison
        drift: (i % 2 === 0 ? 1 : -1) * 0.05,
      });
    }
  }

  // --- Condiment caddy on the counter --------------------------------------
  // A little wooden tray holding a sugar jar, a milk pitcher, a stack of
  // napkins and a cup of wooden stirrers. Sits on the worktop at the clear
  // right end of the counter (counter spans x[-6,1]; pastry case ends near
  // x=-0.6), well away from the order-zone walk path — no collider.
  {
    const caddy = new THREE.Group();
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.34), DECOR.caddyWood);
    tray.castShadow = true;
    tray.receiveShadow = true;
    tray.position.y = 0.02;
    caddy.add(tray);
    // low rim around the tray so it reads as a caddy, not a flat board
    const rimLong = new THREE.BoxGeometry(0.62, 0.05, 0.03);
    const rimShort = new THREE.BoxGeometry(0.03, 0.05, 0.34);
    for (const rz of [-0.155, 0.155]) {
      const r = new THREE.Mesh(rimLong, DECOR.caddyWood);
      r.position.set(0, 0.045, rz);
      caddy.add(r);
    }
    for (const rx of [-0.295, 0.295]) {
      const r = new THREE.Mesh(rimShort, DECOR.caddyWood);
      r.position.set(rx, 0.045, 0);
      caddy.add(r);
    }
    // Sugar jar (glass body + chrome lid) — overlap the lid into the body so the
    // two never share a coincident face.
    const jarBody = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.13, 14), DECOR.sugarGlass);
    jarBody.position.set(-0.19, 0.105, 0);
    const jarFill = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.09, 14), DECOR.sugar);
    jarFill.position.set(-0.19, 0.085, 0);
    const jarLid = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.03, 14), DECOR.sugarLid);
    jarLid.position.set(-0.19, 0.18, 0);
    caddy.add(jarBody, jarFill, jarLid);
    // Milk pitcher: a small chrome cylinder with a tube handle.
    const pitcher = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 14), DECOR.milk);
    pitcher.castShadow = true;
    pitcher.position.set(0, 0.1, 0);
    const pHandle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 10), DECOR.milk);
    pHandle.position.set(0.06, 0.1, 0);
    pHandle.rotation.y = Math.PI / 2;
    caddy.add(pitcher, pHandle);
    // Stack of folded napkins.
    const napkins = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.13), DECOR.napkin);
    napkins.castShadow = true;
    napkins.position.set(0.2, 0.065, -0.07);
    caddy.add(napkins);
    // Cup of wooden stirrers leaning together.
    const stirCup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.1, 12), DECOR.caddyWood);
    stirCup.position.set(0.2, 0.09, 0.08);
    caddy.add(stirCup);
    const stirGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.16, 6);
    for (const [sdx, sdz, tilt] of [[-0.01, 0, 0.12], [0.012, 0.008, -0.1], [0, -0.012, 0.05]]) {
      const s = new THREE.Mesh(stirGeo, DECOR.stir);
      s.position.set(0.2 + sdx, 0.15, 0.08 + sdz);
      s.rotation.z = tilt;
      caddy.add(s);
    }
    caddy.position.set(0.2, 1.1, -halfD + 1.55); // on the worktop (top y≈1.10)
    group.add(caddy);
  }

  // Stools in front of the counter (seated diners face the counter, i.e. -Z).
  for (let i = 0; i < 4; i++) {
    const stool = makeStool();
    const sx = -5.2 + i * 1.5;
    const sz = -halfD + 2.4;
    stool.position.set(sx, 0, sz);
    group.add(stool);
    seats.push({ x: sx, z: sz, ry: Math.PI, seatY: stool.userData.seatY });
  }

  // Back-bar shelving + chalkboard menu.
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(5, 1.6, 0.3),
    new THREE.MeshStandardMaterial({ color: "#4a3322", roughness: 0.7 })
  );
  shelf.position.set(-2.5, 2.4, -halfD + 0.25);
  shelf.castShadow = true;
  group.add(shelf);
  const board = makeChalkboard(chalkboardMenuTexture());
  board.position.set(3.5, 2.5, -halfD + 0.2);
  group.add(board);

  // --- Seating: a grid of tables with chairs -------------------------------
  // Every table is a game table: sitting at one opens that table's game (see
  // TABLE_GAME) connected to the table's own room. The `id` is stable for the
  // life of the build so the server can key rooms off it.
  const tablePositions = [
    [-6, 2], [-6, 6],
    [-1.5, 6],
    [3, 2], [3, 6],
    [7, 2], [7, 6],
    [0.5, 1.5],
  ];
  tablePositions.forEach(([x, z], i) => {
    const tableId = `table-${i}`;

    const table = makeTable();
    table.position.set(x, 0, z);
    table.userData.tableId = tableId;
    table.name = tableId;
    group.add(table);
    tables.set(tableId, table);
    addBox(colliders, x, z, 1.0, 1.0); // table footprint
    // Four chairs around it — one per side — each facing INWARD toward the
    // table so seated players look at the board. A chair faces +Z at yaw 0
    // (backrest at -Z) and facing(yaw) = (sin yaw, cos yaw), so to look from a
    // chair's offset back toward the center the yaw is atan2(-ox, -oz). Deriving
    // it from the offset keeps every chair inward by construction. Each seat
    // remembers which table (and therefore which game room) it belongs to.
    const offsets = [[0, 0.85], [0, -0.85], [0.85, 0], [-0.85, 0]];
    for (const [ox, oz] of offsets) {
      const ry = Math.atan2(-ox, -oz); // face the table center
      const chair = makeChair();
      chair.position.set(x + ox, 0, z + oz);
      chair.rotation.y = ry;
      group.add(chair);
      seats.push({ x: x + ox, z: z + oz, ry, seatY: chair.userData.seatY, table: tableId, gameTable: true });
    }
    // (No centre mug on game tables — the in-world board occupies the tabletop
    // centre at y≈0.77 and a mug there would z-fight / clip through the board.)
  });

  // --- Rug under the central lounge ----------------------------------------
  const rug = makeRug(6, 5, "#8a3a3a");
  rug.position.set(0.5, 0, 4);
  group.add(rug);

  // --- Plants in the corners + along walls ---------------------------------
  const plantSpots = [
    [-halfW + 1.2, halfD - 1.2, 1.2],
    [halfW - 1.2, halfD - 1.2, 1.3],
    [halfW - 1.2, -halfD + 3.5, 1.1],
    [-halfW + 1.2, 0, 1.0],
  ];
  for (const [x, z, s] of plantSpots) {
    const plant = makePlant(s);
    plant.position.set(x, 0, z);
    group.add(plant);
    addBox(colliders, x, z, 0.6 * s, 0.6 * s);
  }

  // --- Pendant lamps over the seating --------------------------------------
  const lampSpots = [[-4, 4], [3, 4], [7, 4], [0.5, 7]];
  for (const [x, z] of lampSpots) {
    const { group: lamp, light } = makePendantLamp();
    lamp.position.set(x, h - 1.4, z);
    group.add(lamp);
    lights.push(light);
  }

  // --- Extra cozy interior decor ------------------------------------------
  // Everything below is purely cosmetic and lives inside the interior region
  // (x[-13,13], z[-11,11]). None of it registers a collider: each piece either
  // hugs a wall, hangs from the ceiling, or sits in a dead corner, so the
  // walkable paths, seats and tables are untouched. Walls sit on the room
  // boundary, so wall-mounted decor is nudged a few cm toward the centre along
  // the wall's inward normal to avoid z-fighting against the plaster.

  // Framed wall art, hung flat on the plaster between the windows. Each entry
  // is [x, z, ry, w, art-material] where ry rotates the frame to face inward.
  function wallArt(x, y, z, ry, w, hgt, artMat) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 0.06), DECOR.frame);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.16, hgt - 0.16), artMat);
    art.position.z = 0.035;
    frame.castShadow = false;
    g.add(frame, art);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    group.add(g);
  }
  // Left wall (x = -halfW), faces +X (ry = +90deg); gap at z=0 sits between the
  // two left windows. A taller portrait near the front-left.
  wallArt(-halfW + 0.08, 2.5, 0, Math.PI / 2, 1.3, 1.0, DECOR.artA);
  wallArt(-halfW + 0.08, 2.4, 8, Math.PI / 2, 0.9, 1.3, DECOR.artB);
  // Right wall (x = +halfW), faces -X (ry = -90deg). Gap at z=0 between windows.
  wallArt(halfW - 0.08, 2.5, 0, -Math.PI / 2, 1.3, 1.0, DECOR.artC);
  wallArt(halfW - 0.08, 2.4, 8, -Math.PI / 2, 0.9, 1.3, DECOR.artA);
  // Back wall, in the clear gap between the chalkboard menu (x=3.5) and the
  // floating mug shelves (which start near x=6.4).
  wallArt(5.4, 3.4, -halfD + 0.18, 0, 1.0, 1.0, DECOR.artB);

  // Floating shelves of mugs, jars of beans, and books — mounted high on the
  // back wall over the right end (the chalkboard is at x=3.5, shelf box centre
  // at x=-2.5, so x in [6,11.5] is clear). Two stacked ledges.
  function backShelf(x, y, len) {
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.26), DECOR.shelfWood);
    ledge.position.set(x, y, -halfD + 0.2);
    ledge.castShadow = true;
    ledge.receiveShadow = true;
    group.add(ledge);
    return ledge;
  }
  backShelf(8.6, 1.5, 4.4);
  backShelf(8.6, 2.2, 4.4);
  // Mugs lined up on the lower ledge.
  for (let i = 0; i < 6; i++) {
    const mug = makeMug(DECOR.mugColors[i % DECOR.mugColors.length]);
    mug.position.set(7.0 + i * 0.62, 1.53, -halfD + 0.2);
    mug.castShadow = false;
    group.add(mug);
  }
  // Glass jars of coffee beans on the upper ledge.
  for (let i = 0; i < 4; i++) {
    const jx = 7.2 + i * 0.95;
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.34, 14), DECOR.jar);
    jar.position.set(jx, 2.41, -halfD + 0.2);
    group.add(jar);
    const beans = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.2, 14), DECOR.bean);
    beans.position.set(jx, 2.33, -halfD + 0.2);
    group.add(beans);
  }

  // A tall bookshelf tucked into the back-right corner (counter ends near x=1,
  // the x=7 table column starts at z=2, so x~11.6 / z~-6 is a dead corner). It
  // hugs the wall and faces into the room; no collider so it never blocks a path.
  const bookcase = new THREE.Group();
  const caseW = 1.6, caseH = 3.2, caseD = 0.34;
  const caseSide = new THREE.MeshStandardMaterial({ color: "#4a3322", roughness: 0.7 });
  const sideGeo = new THREE.BoxGeometry(0.08, caseH, caseD);
  for (const sx of [-caseW / 2, caseW / 2]) {
    const s = new THREE.Mesh(sideGeo, caseSide);
    s.position.set(sx, caseH / 2, 0);
    s.castShadow = true;
    bookcase.add(s);
  }
  const shelfGeo = new THREE.BoxGeometry(caseW, 0.05, caseD);
  for (let i = 0; i <= 4; i++) {
    const sh = new THREE.Mesh(shelfGeo, caseSide);
    sh.position.set(0, 0.1 + i * (caseH - 0.2) / 4, 0);
    sh.castShadow = true;
    sh.receiveShadow = true;
    bookcase.add(sh);
    if (i < 4) {
      // a row of books leaning on this shelf
      let bx = -caseW / 2 + 0.16;
      while (bx < caseW / 2 - 0.16) {
        const bw = 0.07 + Math.random() * 0.05;
        const bh = 0.34 + Math.random() * 0.16;
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.22), DECOR.book[Math.floor(Math.random() * DECOR.book.length)]);
        b.position.set(bx + bw / 2, 0.1 + i * (caseH - 0.2) / 4 + bh / 2 + 0.025, 0);
        b.castShadow = true;
        bookcase.add(b);
        bx += bw + 0.012;
      }
    }
  }
  bookcase.position.set(halfW - 0.3 - caseD / 2, 0, -5.5);
  bookcase.rotation.y = -Math.PI / 2; // face into the room (-X)
  group.add(bookcase);

  // A cozy reading couch in the front-left corner facing into the lounge. The
  // front-left interior (x < -8, z > 7) is open floor between the left wall and
  // the door; the couch sits against the wall with its seat looking toward +X.
  const couch = new THREE.Group();
  const cw = 2.4, cdp = 0.95;
  const cbase = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.35, cdp), DECOR.couch);
  cbase.position.y = 0.28;
  cbase.castShadow = true;
  cbase.receiveShadow = true;
  couch.add(cbase);
  const cback = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.6, 0.22), DECOR.couch);
  cback.position.set(0, 0.62, -cdp / 2 + 0.11);
  cback.castShadow = true;
  couch.add(cback);
  for (const ax of [-cw / 2 + 0.13, cw / 2 - 0.13]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, cdp), DECOR.couch);
    arm.position.set(ax, 0.46, 0);
    arm.castShadow = true;
    couch.add(arm);
  }
  for (const cx of [-cw / 4, cw / 4]) {
    const cush = new THREE.Mesh(new THREE.BoxGeometry(cw / 2 - 0.16, 0.16, cdp - 0.18), DECOR.cushion);
    cush.position.set(cx, 0.5, 0.02);
    cush.castShadow = true;
    couch.add(cush);
  }
  const legGeo = new THREE.BoxGeometry(0.08, 0.18, 0.08);
  for (const [lx, lz] of [[-cw / 2 + 0.18, -cdp / 2 + 0.18], [cw / 2 - 0.18, -cdp / 2 + 0.18], [-cw / 2 + 0.18, cdp / 2 - 0.18], [cw / 2 - 0.18, cdp / 2 - 0.18]]) {
    const lg = new THREE.Mesh(legGeo, DECOR.couchLeg);
    lg.position.set(lx, 0.09, lz);
    couch.add(lg);
  }
  couch.position.set(-halfW + 1.5, 0, 7.9);
  couch.rotation.y = -Math.PI / 2; // back to the left wall, seat faces +X
  group.add(couch);
  // A small accent rug under the couch nook to anchor it.
  const nookRug = makeRug(3.2, 2.2, "#6b4423");
  nookRug.position.set(-halfW + 2.3, 0, 7.9);
  group.add(nookRug);
  // A potted plant beside the couch (no collider — it sits in the dead corner).
  const couchPlant = makePlant(1.0);
  couchPlant.position.set(-halfW + 1.1, 0, 6.1);
  group.add(couchPlant);

  // --- A cozy reading armchair with a sleeping cat, front-right corner ------
  // The front-right interior (x > 9, z > 7) is open floor between the right
  // wall, the window column and the door. The armchair hugs the corner facing
  // the lounge; it's decor only (no collider — it sits well outside every walk
  // path and the x=7 table column ends at z=6).
  function makeArmchair() {
    const a = new THREE.Group();
    const aw = 0.95, ad = 0.9;
    const aseat = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.34, ad), DECOR.couch);
    aseat.position.y = 0.3;
    aseat.castShadow = true;
    aseat.receiveShadow = true;
    a.add(aseat);
    const aback = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.62, 0.2), DECOR.couch);
    aback.position.set(0, 0.62, -ad / 2 + 0.1);
    aback.castShadow = true;
    a.add(aback);
    for (const ax of [-aw / 2 + 0.1, aw / 2 - 0.1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, ad), DECOR.couch);
      arm.position.set(ax, 0.44, 0);
      arm.castShadow = true;
      a.add(arm);
    }
    const cush = new THREE.Mesh(new THREE.BoxGeometry(aw - 0.24, 0.14, ad - 0.18), DECOR.cushion);
    cush.position.set(0, 0.5, 0.02);
    cush.castShadow = true;
    a.add(cush);
    const alegGeo = new THREE.BoxGeometry(0.08, 0.18, 0.08);
    for (const [lx, lz] of [[-aw / 2 + 0.14, -ad / 2 + 0.14], [aw / 2 - 0.14, -ad / 2 + 0.14], [-aw / 2 + 0.14, ad / 2 - 0.14], [aw / 2 - 0.14, ad / 2 - 0.14]]) {
      const lg = new THREE.Mesh(alegGeo, DECOR.couchLeg);
      lg.position.set(lx, 0.09, lz);
      a.add(lg);
    }
    return a;
  }
  // A small ginger cat curled up asleep: a flattened body loop, a tucked head,
  // a tail wrapped around, and two pricked ears. Built at local origin so it can
  // be dropped onto any seat surface.
  function makeCat() {
    const c = new THREE.Group();
    // Body: a squashed sphere forming the curled loop.
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), DECOR.catFur);
    body.scale.set(1.0, 0.62, 1.3);
    body.castShadow = true;
    c.add(body);
    // Head tucked against the body.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), DECOR.catFur);
    head.position.set(0.0, 0.04, 0.17);
    head.scale.set(1, 0.9, 0.9);
    head.castShadow = true;
    c.add(head);
    const earGeo = new THREE.ConeGeometry(0.04, 0.07, 5);
    for (const ex of [-0.05, 0.05]) {
      const ear = new THREE.Mesh(earGeo, DECOR.catFurDark);
      ear.position.set(ex, 0.12, 0.16);
      c.add(ear);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), DECOR.catNose);
    nose.position.set(0, 0.02, 0.27);
    c.add(nose);
    // Tail curled around the front of the body (a partial torus).
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.028, 8, 14, Math.PI * 1.2), DECOR.catFurDark);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0.02, -0.02, -0.02);
    tail.castShadow = true;
    c.add(tail);
    return c;
  }
  const armchair = makeArmchair();
  // Front-right corner: clear of the corner plant at (11.8, 9.8) and the x=7
  // table column (which ends at z=6), with the right wall at x=13.
  armchair.position.set(halfW - 1.4, 0, 8.3);
  armchair.rotation.y = -Math.PI / 2 + 0.35; // face the lounge centre
  group.add(armchair);
  const cat = makeCat();
  // Drop the cat onto the armchair's cushion (cushion top ≈ 0.57) and orient it
  // with the chair so it nestles against the backrest.
  cat.position.set(armchair.position.x, 0.66, armchair.position.z);
  cat.rotation.y = armchair.rotation.y + Math.PI; // head tucked toward the back
  group.add(cat);

  // String / fairy lights swagged across the ceiling for warmth. Each swag is a
  // thin sagging tube with a row of small emissive bulbs; purely decorative.
  function fairyLights(x1, z1, x2, z2, beads) {
    const y = h - 0.25;
    const sag = 0.55;
    const start = new THREE.Vector3(x1, y, z1);
    const end = new THREE.Vector3(x2, y, z2);
    const mid = start.clone().lerp(end, 0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.01, 5, false), DECOR.string);
    group.add(tube);
    const bulbGeo = new THREE.SphereGeometry(0.045, 8, 8);
    for (let i = 1; i < beads; i++) {
      const p = curve.getPoint(i / beads);
      const bulb = new THREE.Mesh(bulbGeo, DECOR.warmBulb);
      bulb.position.copy(p);
      bulb.position.y -= 0.03;
      group.add(bulb);
    }
  }
  fairyLights(-halfW + 1.5, halfD - 1.5, halfW - 1.5, halfD - 1.5, 12); // across the front
  fairyLights(-halfW + 1.5, 2.5, halfW - 1.5, 2.5, 12); // across the mid-lounge
  fairyLights(-halfW + 1.5, halfD - 1.5, -halfW + 1.5, 2.5, 8); // down the left
  fairyLights(halfW - 1.5, halfD - 1.5, halfW - 1.5, 2.5, 8); // down the right

  // Soft window light shafts: faint glowing slabs angled in from the big front
  // windows, selling the "afternoon sun" mood. depthWrite is off and opacity is
  // tiny so they never obscure props; no collider, purely a volumetric hint.
  for (const x of [-7, 7]) {
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 5.2), DECOR.shaft);
    shaft.position.set(x, 2.3, halfD - 2.4);
    shaft.rotation.x = -Math.PI / 2.6;
    group.add(shaft);
  }

  // ========================================================================
  // EXTRA COZY DECOR (pass 2) — a fireplace hearth nook, reading-nook side
  // tables, a wall clock, a hanging menu, a coat rack, a magazine rack, a
  // floor lamp, a wall shelf, a sidewalk specials board, runner rugs, floor
  // cushions and more framed art. Each piece hugs a wall or sits in a dead
  // corner; the only new colliders are tight boxes around solid stand-alone
  // furniture, so the entrance, the bar approach, the central lounge (spawn)
  // and every game TABLE + SEAT are completely untouched.
  // ========================================================================

  // Hearth location (back wall, in the clear span left of the counter) — reused
  // by several blocks below. fireLight/fireT are flickered allocation-free in
  // update(); declared here so they're in the closure's scope.
  const FX = -9.5;
  const FZ = -halfD;
  let fireLight = null;
  let fireT = 0;

  // Build-time textures + materials for this pass (made once, reused across
  // meshes, so update() stays allocation-free). Canvas textures are created
  // here inside the build so they have a DOM to draw onto.
  const brickTex = brickTexture("#7a4a36", "#cdbfa6");
  brickTex.repeat.set(2, 2);
  const COZY = {
    brick: new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.95 }),
    stone: new THREE.MeshStandardMaterial({ color: "#7d756a", roughness: 0.9 }),
    firebox: new THREE.MeshStandardMaterial({ color: "#140f0b", roughness: 1 }),
    ember: new THREE.MeshStandardMaterial({ color: "#ff7a2a", emissive: "#ff5a18", emissiveIntensity: 1.6, roughness: 0.6 }),
    pole: new THREE.MeshStandardMaterial({ color: "#2b2b2f", roughness: 0.4, metalness: 0.7 }),
    brass: new THREE.MeshStandardMaterial({ color: "#caa05a", roughness: 0.35, metalness: 0.8 }),
    shade: new THREE.MeshStandardMaterial({ color: "#f3e3c2", emissive: "#ffcf8a", emissiveIntensity: 0.9, roughness: 0.7, side: THREE.DoubleSide }),
    clockFace: new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.8 }),
    clockHand: new THREE.MeshStandardMaterial({ color: "#1c1c1c", roughness: 0.6 }),
    candle: new THREE.MeshStandardMaterial({ color: "#efe6d0", roughness: 0.85 }),
    flame: new THREE.MeshStandardMaterial({ color: "#ffd27a", emissive: "#ffb24a", emissiveIntensity: 2.0 }),
    cushionA: new THREE.MeshStandardMaterial({ map: fabricTexture("#b5613a"), roughness: 0.95 }),
    cushionB: new THREE.MeshStandardMaterial({ map: fabricTexture("#5d6f5a"), roughness: 0.95 }),
    wood: DECOR.shelfWood,
    log: DECOR.bean,
  };

  // --- Small reusable builders for this pass --------------------------------
  function makeLowTable(w, d, hgt) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), COZY.wood);
    top.position.y = hgt;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);
    const legGeo = new THREE.BoxGeometry(0.07, hgt, 0.07);
    const lx = w / 2 - 0.09;
    const lz = d / 2 - 0.09;
    for (const [sx, sz] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) {
      const leg = new THREE.Mesh(legGeo, DECOR.couchLeg);
      leg.position.set(sx, hgt / 2, sz);
      leg.castShadow = true;
      g.add(leg);
    }
    return g;
  }
  // A little napkin + sugar caddy that drops onto any tabletop.
  function makeTableCaddy() {
    const g = new THREE.Group();
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.14), COZY.wood);
    tray.position.y = 0.015;
    tray.castShadow = true;
    g.add(tray);
    const shakerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 12), DECOR.sugarGlass);
    shakerBody.position.set(-0.07, 0.08, 0);
    const shakerLid = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.025, 12), DECOR.sugarLid);
    shakerLid.position.set(-0.07, 0.14, 0);
    g.add(shakerBody, shakerLid);
    const napkins = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.08), DECOR.napkin);
    napkins.position.set(0.07, 0.05, 0);
    g.add(napkins);
    for (const hx of [0.025, 0.115]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.08, 0.09), COZY.brass);
      panel.position.set(hx, 0.06, 0);
      g.add(panel);
    }
    return g;
  }
  // A floating wall shelf with two end brackets.
  function makeWallShelf(len) {
    const g = new THREE.Group();
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.26), COZY.wood);
    ledge.castShadow = true;
    ledge.receiveShadow = true;
    g.add(ledge);
    for (const bx of [-len / 2 + 0.12, len / 2 - 0.12]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.22), COZY.wood);
      bracket.position.set(bx, -0.1, -0.02);
      g.add(bracket);
    }
    return g;
  }
  // A round wall clock reading roughly ten-past-ten.
  function makeWallClock(radius) {
    const c = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.06, 28), DECOR.frame);
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = true;
    c.add(rim);
    const face = new THREE.Mesh(new THREE.CircleGeometry(radius - 0.04, 28), COZY.clockFace);
    face.position.z = 0.032;
    c.add(face);
    const tickGeo = new THREE.BoxGeometry(0.015, 0.05, 0.01);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const tk = new THREE.Mesh(tickGeo, COZY.clockHand);
      tk.position.set(Math.sin(a) * (radius - 0.09), Math.cos(a) * (radius - 0.09), 0.04);
      tk.rotation.z = -a;
      c.add(tk);
    }
    function hand(len, w, ang) {
      const hg = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.012), COZY.clockHand);
      bar.position.y = len / 2 - 0.03;
      hg.add(bar);
      hg.rotation.z = ang;
      hg.position.z = 0.05;
      return hg;
    }
    c.add(hand(radius * 0.55, 0.03, -1.1));
    c.add(hand(radius * 0.82, 0.02, 0.7));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), COZY.brass);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.06;
    c.add(hub);
    return c;
  }

  // --- Fireplace hearth (back wall, in the clear span left of the counter) --
  // The back wall is bare plaster from x=-13 to the counter at x=-6; the hearth
  // sits centred at x=-9.5 against it, facing +Z into the room. Only its solid
  // stone base gets a collider; the firebox opening is up off the floor. Bricks
  // are buried a little into the wall so no face is coincident with the plaster.
  {
    const fireplace = new THREE.Group();
    const hearthSlab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 0.8), COZY.stone);
    hearthSlab.position.set(0, 0.08, 0.34);
    hearthSlab.receiveShadow = true;
    fireplace.add(hearthSlab);
    const pillarGeo = new THREE.BoxGeometry(0.55, 2.0, 0.5);
    for (const px of [-0.83, 0.83]) {
      const pil = new THREE.Mesh(pillarGeo, COZY.brick);
      pil.position.set(px, 1.0, 0.05);
      pil.castShadow = true;
      pil.receiveShadow = true;
      fireplace.add(pil);
    }
    const lintelBrick = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.5), COZY.brick);
    lintelBrick.position.set(0, 1.85, 0.05);
    lintelBrick.castShadow = true;
    fireplace.add(lintelBrick);
    const fireboxBack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.06), COZY.firebox);
    fireboxBack.position.set(0, 0.95, -0.18);
    fireplace.add(fireboxBack);
    const fireboxFloor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.45), COZY.firebox);
    fireboxFloor.position.set(0, 0.18, 0.0);
    fireplace.add(fireboxFloor);
    const mantel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.62), COZY.wood);
    mantel.position.set(0, 2.18, 0.06);
    mantel.castShadow = true;
    mantel.receiveShadow = true;
    fireplace.add(mantel);
    const logGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8);
    for (const [lx, ly, lz, lr] of [[-0.12, 0.34, 0.02, 0.2], [0.1, 0.34, -0.04, -0.25], [-0.02, 0.46, 0.0, 0.05]]) {
      const lg = new THREE.Mesh(logGeo, COZY.log);
      lg.rotation.z = Math.PI / 2;
      lg.rotation.y = lr;
      lg.position.set(lx, ly, lz);
      lg.castShadow = true;
      fireplace.add(lg);
    }
    const emberBed = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.3), COZY.ember);
    emberBed.position.set(0, 0.24, 0.0);
    fireplace.add(emberBed);
    for (let i = 0; i < 5; i++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), COZY.ember);
      e.position.set(-0.34 + i * 0.17, 0.3 + (i % 2) * 0.05, 0.02);
      fireplace.add(e);
    }
    fireplace.position.set(FX, 0, FZ);
    group.add(fireplace);
    addBox(colliders, FX, FZ + 0.34, 2.5, 0.85); // tight box around the stone base
    fireLight = new THREE.PointLight("#ff8a3c", 6, 7, 2);
    fireLight.position.set(FX, 0.7, FZ + 0.3);
    fireLight.castShadow = false;
    group.add(fireLight);
    lights.push(fireLight);
    // Cosy objects on the mantel: a small plant, a candle, a leaning photo.
    const mPlant = makePlant(0.42);
    mPlant.position.set(FX - 1.0, 2.25, FZ + 0.06);
    group.add(mPlant);
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), COZY.candle);
    candle.position.set(FX + 0.95, 2.33, FZ + 0.06);
    candle.castShadow = true;
    const candleFlame = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 8), COZY.flame);
    candleFlame.position.set(FX + 0.95, 2.46, FZ + 0.06);
    group.add(candle, candleFlame);
    const photo = new THREE.Group();
    const photoFrame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.03), DECOR.frame);
    const photoArt = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16), DECOR.artB);
    photoArt.position.z = 0.02;
    photo.add(photoFrame, photoArt);
    photo.position.set(FX + 0.35, 2.4, FZ + 0.05);
    photo.rotation.x = -0.12;
    group.add(photo);
  }

  // --- Firewood basket + magazine rack flanking the hearth (back-wall nook) --
  {
    const woodBasket = new THREE.Group();
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.34, 14, 1, true), COZY.wood);
    basket.position.y = 0.17;
    basket.castShadow = true;
    const basketBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 14), COZY.wood);
    basketBottom.position.y = 0.02;
    woodBasket.add(basket, basketBottom);
    const fwGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8);
    for (const [wx, wy, wz, wr] of [[-0.06, 0.4, 0, 0.1], [0.06, 0.42, 0.03, -0.15], [0, 0.5, -0.05, 0.3]]) {
      const fw = new THREE.Mesh(fwGeo, COZY.log);
      fw.rotation.x = Math.PI / 2 + wr;
      fw.position.set(wx, wy, wz);
      fw.castShadow = true;
      woodBasket.add(fw);
    }
    woodBasket.position.set(-11.4, 0, -10.4);
    group.add(woodBasket);
    addBox(colliders, -11.4, -10.4, 0.5, 0.5);

    const magRack = new THREE.Group();
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), COZY.wood);
      leg.position.set(0, 0.25, side * 0.16);
      leg.rotation.x = side * 0.28;
      magRack.add(leg);
    }
    const magTray = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.3), COZY.wood);
    magTray.position.y = 0.34;
    magTray.castShadow = true;
    magRack.add(magTray);
    for (let i = 0; i < 4; i++) {
      const mz = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.26), DECOR.book[i % DECOR.book.length]);
      mz.position.set(0, 0.37 + i * 0.014, -0.02 + i * 0.01);
      mz.rotation.x = -0.18 + i * 0.02;
      magRack.add(mz);
    }
    magRack.position.set(-7.55, 0, -10.4);
    group.add(magRack);
    addBox(colliders, -7.55, -10.4, 0.5, 0.4);
  }

  // --- Hearth-side reading nook: a small runner + two floor cushions --------
  // Sits in the dead pocket in front of the hearth (no path runs through here).
  // The cushions are low and soft, so no collider — you can step over them.
  {
    const hearthRunner = makeRug(2.6, 1.6, "#6b4423");
    hearthRunner.position.set(FX, 0, FZ + 1.7);
    group.add(hearthRunner);
    const cushGeo = new THREE.BoxGeometry(0.55, 0.16, 0.55);
    const hcA = new THREE.Mesh(cushGeo, COZY.cushionA);
    hcA.position.set(FX - 0.45, 0.09, FZ + 1.6);
    hcA.rotation.y = 0.3;
    hcA.castShadow = true;
    const hcB = new THREE.Mesh(cushGeo, COZY.cushionB);
    hcB.position.set(FX + 0.5, 0.09, FZ + 1.75);
    hcB.rotation.y = -0.4;
    hcB.castShadow = true;
    group.add(hcA, hcB);
  }

  // --- Reading-nook coffee table in front of the couch (front-left corner) --
  {
    const coffeeTable = makeLowTable(1.0, 0.6, 0.42);
    coffeeTable.position.set(-9.7, 0, 7.9);
    group.add(coffeeTable);
    addBox(colliders, -9.7, 7.9, 1.0, 0.6);
    for (const [mdx, col] of [[-0.28, 1], [-0.08, 3]]) {
      const mug = makeMug(DECOR.mugColors[col]);
      mug.position.set(-9.7 + mdx, 0.45, 7.78);
      group.add(mug);
    }
    for (let i = 0; i < 2; i++) {
      const bk = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.24), DECOR.book[i + 1]);
      bk.position.set(-9.55, 0.475 + i * 0.05, 8.02);
      bk.rotation.y = 0.2 - i * 0.15;
      bk.castShadow = true;
      group.add(bk);
    }
    const caddy = makeTableCaddy();
    caddy.position.set(-9.95, 0.45, 7.95);
    group.add(caddy);
  }

  // --- Side table + reading lamp + caddy beside the armchair (front-right) ---
  {
    const sideTable = makeLowTable(0.5, 0.5, 0.52);
    sideTable.position.set(11.7, 0, 7.1);
    group.add(sideTable);
    addBox(colliders, 11.7, 7.1, 0.5, 0.5);
    const sMug = makeMug(DECOR.mugColors[2]);
    sMug.position.set(11.6, 0.55, 7.0);
    group.add(sMug);
    const sCaddy = makeTableCaddy();
    sCaddy.position.set(11.8, 0.55, 7.2);
    sCaddy.rotation.y = Math.PI / 2;
    group.add(sCaddy);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.04, 12), COZY.brass);
    lampBase.position.set(11.7, 0.56, 7.1);
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), COZY.brass);
    lampStem.position.set(11.7, 0.69, 7.1);
    const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.16, 16, 1, true), COZY.shade);
    lampShade.position.set(11.7, 0.84, 7.1);
    group.add(lampBase, lampStem, lampShade);
  }

  // --- Floor lamp beside the couch (front-left corner) ----------------------
  {
    const floorLamp = new THREE.Group();
    const flFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 16), COZY.pole);
    flFoot.position.y = 0.025;
    const flPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.55, 10), COZY.pole);
    flPole.position.y = 0.8;
    const flShade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 18, 1, true), COZY.shade);
    flShade.position.y = 1.65;
    floorLamp.add(flFoot, flPole, flShade);
    floorLamp.position.set(-12.4, 0, 9.0);
    group.add(floorLamp);
    addBox(colliders, -12.4, 9.0, 0.4, 0.4);
  }

  // --- Coat rack just inside the entrance (front-right wall segment) ---------
  {
    const coatRack = new THREE.Group();
    const crFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.05, 14), COZY.pole);
    crFoot.position.y = 0.025;
    const crPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.85, 10), COZY.wood);
    crPole.position.y = 0.95;
    coatRack.add(crFoot, crPole);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), COZY.wood);
      peg.rotation.z = Math.PI / 2;
      peg.rotation.y = a;
      peg.position.set(Math.sin(a) * 0.09, 1.78, Math.cos(a) * 0.09);
      coatRack.add(peg);
    }
    const coat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.6, 0.16), DECOR.artB);
    coat.position.set(0.16, 1.4, 0.0);
    coat.castShadow = true;
    const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.08), DECOR.artC);
    scarf.position.set(-0.14, 1.45, 0.06);
    coatRack.add(coat, scarf);
    coatRack.position.set(4.2, 0, 10.3);
    group.add(coatRack);
    addBox(colliders, 4.2, 10.3, 0.45, 0.45);
  }

  // --- Round wall clock above the counter -----------------------------------
  {
    const wallClock = makeWallClock(0.42);
    wallClock.position.set(0.5, 3.9, -halfD + 0.16);
    group.add(wallClock);
  }

  // --- Floating wall shelf (plant + books + mug), back-right wall ------------
  {
    const rShelf = makeWallShelf(1.8);
    rShelf.position.set(halfW - 0.16, 1.8, -7.5);
    rShelf.rotation.y = -Math.PI / 2; // faces -X into the room
    group.add(rShelf);
    const shPlant = makePlant(0.5);
    shPlant.position.set(halfW - 0.28, 1.83, -8.0);
    group.add(shPlant);
    for (let i = 0; i < 3; i++) {
      const bk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.2), DECOR.book[i]);
      bk.position.set(halfW - 0.26, 1.98, -7.25 - i * 0.08);
      bk.castShadow = true;
      group.add(bk);
    }
    const shMug = makeMug(DECOR.mugColors[4]);
    shMug.position.set(halfW - 0.28, 1.83, -6.85);
    group.add(shMug);
  }

  // --- Hanging menu board over the order area (overhead, no collider) --------
  {
    const hangMenu = new THREE.Group();
    const hmFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.15, 0.04), DECOR.frame);
    hmFrame.position.z = -0.02;
    const hmBoard = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.05, 0.06),
      new THREE.MeshStandardMaterial({ map: chalkboardMenuTexture(), roughness: 0.9 })
    );
    hmBoard.castShadow = true;
    hangMenu.add(hmFrame, hmBoard);
    for (const cx of [-0.6, 0.6]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.0, 6), DECOR.string);
      cord.position.set(cx, 0.95, 0);
      hangMenu.add(cord);
    }
    hangMenu.position.set(0.5, 3.45, -halfD + 2.0);
    group.add(hangMenu);
  }

  // --- Standing A-frame "specials" chalkboard near the entrance --------------
  {
    const aFrame = new THREE.Group();
    const aBoardMat = new THREE.MeshStandardMaterial({ map: chalkboardMenuTexture(), roughness: 0.9 });
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.64, 1.0, 0.04), aBoardMat);
      panel.position.set(0, 0.66, side * 0.14);
      panel.rotation.x = side * 0.2;
      panel.castShadow = true;
      aFrame.add(panel);
    }
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.66, 8), COZY.wood);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.y = 1.16;
    aFrame.add(hinge);
    aFrame.position.set(-4.2, 0, 9.6);
    aFrame.rotation.y = 0.4;
    group.add(aFrame);
    addBox(colliders, -4.2, 9.6, 0.7, 0.5);
  }

  // --- A bar-front runner rug, a greeter plant + a couple scatter cushions ---
  {
    const barRunner = makeRug(7, 1.3, "#7a4a3a");
    barRunner.position.set(-2.6, 0, -7.6); // flat + walkable, no collider
    group.add(barRunner);

    const greetPlant = makePlant(1.2); // softens the open back-right
    greetPlant.position.set(10.5, 0, -9.0);
    group.add(greetPlant);
    addBox(colliders, 10.5, -9.0, 0.6, 0.6);

    const sc1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), COZY.cushionB);
    sc1.position.set(-11.3, 0.66, 8.4); // tossed on the couch seat
    sc1.rotation.set(0.1, 0.3, 0);
    sc1.castShadow = true;
    const sc2 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.15, 0.45), COZY.cushionA);
    sc2.position.set(-10.5, 0.09, 9.0); // on the nook rug
    sc2.rotation.y = -0.5;
    sc2.castShadow = true;
    group.add(sc1, sc2);
  }

  // --- More framed art on the remaining bare plaster ------------------------
  wallArt(-3.4, 2.7, halfD - 0.08, Math.PI, 1.0, 1.2, DECOR.artB);     // front wall, left of door
  wallArt(FX, 3.35, -halfD + 0.16, 0, 1.2, 0.95, DECOR.artC);          // above the mantel
  wallArt(-halfW + 0.08, 2.6, -8, Math.PI / 2, 1.0, 1.2, DECOR.artA);  // left wall, back
  wallArt(halfW - 0.08, 2.6, -8, -Math.PI / 2, 1.0, 1.2, DECOR.artB);  // right wall, back

  // --- A couple more pendant lamps + string-light swags ---------------------
  for (const [lx, lz] of [[-3, -7], [-9, -7.5]]) {
    const { group: lamp, light } = makePendantLamp();
    lamp.position.set(lx, h - 1.4, lz);
    group.add(lamp);
    lights.push(light);
  }
  fairyLights(-halfW + 1.5, -2.5, halfW - 1.5, -2.5, 12); // across the back lounge
  fairyLights(-9.5, -halfD + 1.0, -2.5, -halfD + 1.0, 8);  // along the back-left

  // --- Outside: the street block in front of the entrance ------------------
  const outside = buildOutside(scene);
  for (const c of outside.colliders) colliders.push(c);

  // --- The expanded city: 16 districts radiating out in front of the cafe ---
  const city = buildCity(scene);
  for (const c of city.colliders) colliders.push(c);

  // Walkable ground = the interior floor + the outside block + the whole city.
  // Standing outside every rect makes the player fall and respawn (see LocalPlayer).
  const ground = [
    { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD },
    ...outside.ground,
    ...city.ground,
  ];
  const spawn = { x: 0, z: 4 };

  const update = (dt) => {
    outside.update?.(dt);
    city.update?.(dt);
    // Espresso steam: each puff rises ~0.5 m over a 2 s loop while swelling and
    // fading out. Pure mutation of cached meshes/materials — no allocation.
    if (steamPuffs.length) {
      steamT += dt;
      const PERIOD = 2.0;
      for (let i = 0; i < steamPuffs.length; i++) {
        const p = steamPuffs[i];
        // progress in [0,1) for this puff, offset by its phase
        let u = (steamT / PERIOD + p.phase) % 1;
        const rise = u * 0.5; // metres climbed this cycle
        const grow = 0.6 + u * 1.4; // swell as it rises
        // fade in over the first 15%, hold, then fade out over the last 45%
        let op;
        if (u < 0.15) op = (u / 0.15) * 0.32;
        else op = 0.32 * Math.max(0, 1 - (u - 0.15) / 0.85);
        const m = p.mesh;
        m.position.set(p.baseX + p.drift * u, p.baseY + rise, p.baseZ);
        m.scale.setScalar(grow);
        m.material.opacity = op;
      }
    }
    // Hearth flicker: gently wobble the fire light + ember glow each frame.
    // Pure number mutation of cached light/material — no allocation.
    if (fireLight) {
      fireT += dt;
      const f = 0.8 + Math.sin(fireT * 11.0) * 0.12 + Math.sin(fireT * 6.3) * 0.08;
      fireLight.intensity = 6 * f;
      COZY.ember.emissiveIntensity = 1.4 * f + 0.35;
    }
  };

  return { group, colliders, lights, seats, bar, ground, spawn, tables, update };
}

// Register an axis-aligned box collider centered at (cx, cz) with full size (w, d).
function addBox(colliders, cx, cz, w, d) {
  colliders.push({
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
  });
}
