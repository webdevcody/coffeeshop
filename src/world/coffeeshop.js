// Assembles the coffeeshop: floor, walls, ceiling, windows, and all furniture.
// Returns { group, colliders } where colliders is an array of axis-aligned XZ
// boxes { minX, maxX, minZ, maxZ } used by the player movement code.

import * as THREE from "three";
import { WORLD } from "../config.js";
import { buildOutside } from "./outside.js";
import { woodFloorTexture, plasterTexture, chalkboardMenuTexture } from "./textures.js";
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

export function buildCoffeeshop(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const lights = [];
  // Sittable spots: { x, z, ry, seatY }. ry is the body facing when seated.
  const seats = [];

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
  pastry.position.set(-1.2, 1.13, -halfD + 1.35);
  group.add(pastry);
  // a few mugs on the counter
  for (const dx of [-0.2, 0.1, 0.5]) {
    const mug = makeMug();
    mug.position.set(-2.5 + dx, 1.13, -halfD + 1.55);
    group.add(mug);
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
    group.add(table);
    addBox(colliders, x, z, 1.0, 1.0); // table footprint
    // four chairs around it — each seat remembers which table (and therefore
    // which game room) it belongs to. The game itself is chosen from a menu by
    // whoever sits first, so seats only flag that they belong to a game table.
    const offsets = [[0, 0.85, 0], [0, -0.85, Math.PI], [0.85, 0, -Math.PI / 2], [-0.85, 0, Math.PI / 2]];
    for (const [ox, oz, ry] of offsets) {
      const chair = makeChair();
      chair.position.set(x + ox, 0, z + oz);
      chair.rotation.y = ry;
      group.add(chair);
      seats.push({ x: x + ox, z: z + oz, ry, seatY: chair.userData.seatY, table: tableId, gameTable: true });
    }
    // mug on table sometimes
    if ((x + z) % 2 === 0) {
      const mug = makeMug(["#f4efe6", "#e9c46a", "#8ecae6"][(Math.abs(x + z)) % 3]);
      mug.position.set(x, 0.77, z);
      group.add(mug);
    }
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

  // --- Outside: the street block in front of the entrance ------------------
  const outside = buildOutside(scene);
  for (const c of outside.colliders) colliders.push(c);

  // Walkable ground = the interior floor + the outside block. Standing outside
  // every rect makes the player fall and respawn (see LocalPlayer).
  const ground = [
    { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD },
    ...outside.ground,
  ];
  const spawn = { x: 0, z: 4 };

  return { group, colliders, lights, seats, bar, ground, spawn, update: outside.update };
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
