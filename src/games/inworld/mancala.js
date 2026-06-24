// Mancala (Kalah) — in-world 3D module (createGame contract). Full-info.
// 14 pits: 0-5 = host pits, 6 = host store, 7-12 = guest pits, 13 = guest store.
// Host moves first. Landing in own store = free turn; capture on empty own pit.

import { GameDesync } from "./createGame.js";
import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard } from "./pieces.js";

const HOST_PITS = [0, 1, 2, 3, 4, 5];
const HOST_STORE = 6;
const GUEST_PITS = [7, 8, 9, 10, 11, 12];
const GUEST_STORE = 13;
const opposite = (i) => 12 - i;

function initBoard() {
  const b = Array(14).fill(0);
  for (const i of [...HOST_PITS, ...GUEST_PITS]) b[i] = 4;
  return b;
}

// Pure sow: returns { board, freeTurn, captured } or null if illegal.
function sow(board, pit, side) {
  const pits = side === "host" ? HOST_PITS : GUEST_PITS;
  const store = side === "host" ? HOST_STORE : GUEST_STORE;
  const oppStore = side === "host" ? GUEST_STORE : HOST_STORE;
  if (!pits.includes(pit) || board[pit] === 0) return null;
  const b = board.slice();
  let seeds = b[pit];
  b[pit] = 0;
  let i = pit;
  while (seeds > 0) {
    i = (i + 1) % 14;
    if (i === oppStore) continue; // skip opponent's store
    b[i]++;
    seeds--;
  }
  let captured = 0;
  // capture: last seed in own empty pit, opposite has seeds
  if (pits.includes(i) && b[i] === 1 && b[opposite(i)] > 0) {
    captured = b[opposite(i)] + 1;
    b[store] += captured;
    b[i] = 0;
    b[opposite(i)] = 0;
  }
  const freeTurn = i === store;
  return { board: b, freeTurn, captured };
}

function sideEmpty(board, side) {
  const pits = side === "host" ? HOST_PITS : GUEST_PITS;
  return pits.every((i) => board[i] === 0);
}

function sweep(board) {
  const b = board.slice();
  for (const i of HOST_PITS) { b[HOST_STORE] += b[i]; b[i] = 0; }
  for (const i of GUEST_PITS) { b[GUEST_STORE] += b[i]; b[i] = 0; }
  return b;
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "mancala";

  let role = ctx.role;
  let mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
  let board = initBoard();
  let turn = "host";
  let phase = "play";
  let winner = null;

  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    wood: keep(standard(THREE, PALETTE.mancalaWood, { roughness: 0.8 })),
    edge: keep(standard(THREE, PALETTE.mancalaEdge, { roughness: 0.75 })),
    pit: keep(standard(THREE, "#3f2814", { roughness: 0.9 })),
    seed: keep(standard(THREE, PALETTE.seed, { roughness: 0.6 })),
    glow: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.5, transparent: true, opacity: 0.5, depthWrite: false })),
  };

  const plankH = 0.03;
  const W = BOARD_SIZE, D = BOARD_SIZE * 0.5;
  const bodyGeo = keep(new THREE.BoxGeometry(W + 0.04, plankH, D + 0.04));
  const body = meshOf(THREE, bodyGeo, M.wood);
  body.position.y = plankH / 2;
  group.add(body);
  const TOP = plankH;

  // Pit layout in local XZ. Host pits along near edge (+Z), guest along -Z.
  // Stores at the X ends. Canonical: host store at +X.
  const pitR = (W / 7) * 0.36;
  const colX = (k) => -W * 0.32 + k * (W * 0.64 / 5); // 6 columns
  const pitPos = {};
  for (let k = 0; k < 6; k++) {
    pitPos[HOST_PITS[k]] = { x: colX(k), z: D * 0.22 };
    pitPos[GUEST_PITS[5 - k]] = { x: colX(k), z: -D * 0.22 };
  }
  pitPos[HOST_STORE] = { x: W * 0.42, z: 0 };
  pitPos[GUEST_STORE] = { x: -W * 0.42, z: 0 };

  const pitGeo = keep(new THREE.CylinderGeometry(pitR, pitR * 0.85, plankH * 0.7, 18));
  const storeGeo = keep(new THREE.CylinderGeometry(pitR * 1.3, pitR * 1.1, plankH * 0.8, 18));
  const seedGeo = keep(new THREE.IcosahedronGeometry(pitR * 0.18, 0));
  const hitGeo = keep(new THREE.CylinderGeometry(pitR * 1.1, pitR * 1.1, 0.04, 12));
  const glowGeo = keep(new THREE.TorusGeometry(pitR * 1.1, pitR * 0.1, 8, 20));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));

  const seedGroups = {}; // pit -> THREE.Group of seed meshes
  const glows = [];

  for (let i = 0; i < 14; i++) {
    const isStore = i === HOST_STORE || i === GUEST_STORE;
    const p = pitPos[i];
    const well = meshOf(THREE, isStore ? storeGeo : pitGeo, M.pit, false);
    well.position.set(p.x, TOP - plankH * 0.3, p.z);
    group.add(well);
    // collider for selectable pits
    if (!isStore) {
      const box = new THREE.Mesh(hitGeo, invis);
      box.position.set(p.x, TOP + 0.02, p.z);
      box.userData.cell = { pit: i };
      group.add(box);
    }
    const sg = new THREE.Group();
    sg.position.set(p.x, TOP, p.z);
    group.add(sg);
    seedGroups[i] = sg;
  }

  function renderSeeds() {
    for (let i = 0; i < 14; i++) {
      const sg = seedGroups[i];
      while (sg.children.length) sg.remove(sg.children[0]);
      const n = board[i];
      const isStore = i === HOST_STORE || i === GUEST_STORE;
      const spread = isStore ? pitR * 1.0 : pitR * 0.6;
      for (let k = 0; k < n; k++) {
        const s = meshOf(THREE, seedGeo, M.seed);
        const ang = (k / Math.max(1, n)) * Math.PI * 2 + k * 0.7;
        const rad = spread * (0.3 + 0.7 * ((k % 5) / 5));
        s.position.set(Math.cos(ang) * rad, pitR * 0.18 + (k % 3) * pitR * 0.12, Math.sin(ang) * rad);
        sg.add(s);
      }
    }
  }

  function clearGlows() {
    for (const g of glows) group.remove(g);
    glows.length = 0;
  }
  function refreshGlows() {
    clearGlows();
    if (phase !== "play" || role === "spectator" || turn !== mySide || !ctx.isLocalTurnAllowed()) return;
    const pits = mySide === "host" ? HOST_PITS : GUEST_PITS;
    for (const i of pits) {
      if (board[i] === 0) continue;
      const g = meshOf(THREE, glowGeo, M.glow, false);
      g.rotation.x = Math.PI / 2;
      const p = pitPos[i];
      g.position.set(p.x, TOP + 0.03, p.z);
      group.add(g);
      glows.push(g);
    }
  }

  function performMove(pit, side) {
    const res = sow(board, pit, side);
    if (!res) return false;
    board = res.board;
    // end check
    if (sideEmpty(board, "host") || sideEmpty(board, "guest")) {
      board = sweep(board);
      phase = "over";
      winner = board[HOST_STORE] === board[GUEST_STORE] ? null
        : board[HOST_STORE] > board[GUEST_STORE] ? "host" : "guest";
      renderSeeds();
      clearGlows();
      try { ctx.onGameOver({ winner, reason: "empty" }); } catch { /* */ }
      return true;
    }
    if (!res.freeTurn) turn = side === "host" ? "guest" : "host";
    renderSeeds();
    refreshGlows();
    return true;
  }

  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed()) return;
    if (phase !== "play" || turn !== mySide) return;
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.pit)) return;
    const pit = cell.pit;
    const pits = mySide === "host" ? HOST_PITS : GUEST_PITS;
    if (!pits.includes(pit) || board[pit] === 0) return;
    clearGlows();
    performMove(pit, mySide);
    try { ctx.net.sendMove({ type: "move", pit }); } catch { /* */ }
    if (role === "host") pushSnapshot();
  }

  function applyMove(move) {
    if (phase !== "play") throw new GameDesync("mancala: not in play");
    if (!move || move.type !== "move" || !Number.isInteger(move.pit)) return false;
    const pits = turn === "host" ? HOST_PITS : GUEST_PITS;
    if (!pits.includes(move.pit) || board[move.pit] === 0)
      throw new GameDesync("mancala: illegal pit");
    performMove(move.pit, turn);
    return true;
  }

  function snapshot() {
    return { board: board.slice(), turn, phase, winner };
  }
  function publicState() { return snapshot(); }
  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  function applyState(state) {
    if (!state) {
      board = initBoard();
      turn = "host";
      phase = "play";
      winner = null;
    } else {
      const b = Array(14).fill(0);
      if (Array.isArray(state.board)) for (let i = 0; i < 14; i++) b[i] = state.board[i] | 0;
      board = b;
      turn = state.turn === "guest" ? "guest" : "host";
      phase = state.phase === "over" ? "over" : "play";
      winner = state.winner === "host" || state.winner === "guest" ? state.winner : null;
    }
    renderSeeds();
    refreshGlows();
  }

  function setRole(r) {
    role = r || "spectator";
    mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
    refreshGlows();
  }
  function setSeatRy() {}
  function dispose() {
    clearGlows();
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  renderSeeds();
  refreshGlows();
  return { group, applyState, applyMove, onPointer, publicState, setRole, setSeatRy, dispose };
}

export default createGame;
