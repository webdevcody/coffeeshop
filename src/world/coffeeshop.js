// Assembles the coffeeshop: floor, walls, ceiling, windows, and all furniture.
// Returns { group, colliders } where colliders is an array of axis-aligned XZ
// boxes { minX, maxX, minZ, maxZ } used by the player movement code.

import * as THREE from "three";
import { WORLD } from "../config.js";
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

// Maps a table index to the game it hosts (a key in games/registry.js). Today
// every table runs Battleship; to give a table a different game later, return a
// different registry id here (e.g. `return i === 0 ? "checkers" : "battleship"`).
function TABLE_GAME(_i) {
  return "battleship";
}

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
    // wainscot panel along the bottom
    const wain = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 0.08), wainscotMat);
    wain.position.set(x, 0.55, z + (ry === 0 ? 0.04 : 0) * Math.sign(z || 1));
    wain.rotation.y = ry;
    wain.receiveShadow = true;
    wain.castShadow = true;
    group.add(wain);
  }
  wall(WORLD.width, 0, -halfD, 0); // back
  wall(WORLD.width, 0, halfD, Math.PI); // front
  wall(WORLD.depth, -halfW, 0, Math.PI / 2); // left
  wall(WORLD.depth, halfW, 0, -Math.PI / 2); // right

  // Wall colliders (thin boxes just inside each wall).
  const t = 0.3;
  addBox(colliders, 0, -halfD + t / 2, WORLD.width, t);
  addBox(colliders, 0, halfD - t / 2, WORLD.width, t);
  addBox(colliders, -halfW + t / 2, 0, t, WORLD.depth);
  addBox(colliders, halfW - t / 2, 0, t, WORLD.depth);

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

  // --- Entrance door (visual) on the front wall ----------------------------
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 3.2, 0.1),
    new THREE.MeshStandardMaterial({ color: "#4a3322", roughness: 0.6 })
  );
  door.position.set(0, 1.6, halfD - 0.06);
  group.add(door);
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
    // Which game lives on this table. All tables host Battleship today; point
    // individual tables at other registry ids here to mix games per table.
    const gameId = TABLE_GAME(i);

    const table = makeTable();
    table.position.set(x, 0, z);
    group.add(table);
    addBox(colliders, x, z, 1.0, 1.0); // table footprint
    // four chairs around it — each seat remembers which table (and therefore
    // which game room) it belongs to.
    const offsets = [[0, 0.85, 0], [0, -0.85, Math.PI], [0.85, 0, -Math.PI / 2], [-0.85, 0, Math.PI / 2]];
    for (const [ox, oz, ry] of offsets) {
      const chair = makeChair();
      chair.position.set(x + ox, 0, z + oz);
      chair.rotation.y = ry;
      group.add(chair);
      seats.push({ x: x + ox, z: z + oz, ry, seatY: chair.userData.seatY, table: tableId, gameId });
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

  return { group, colliders, lights, seats };
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
