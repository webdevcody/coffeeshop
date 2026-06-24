// Gomoku — in-world 3D module (createGame contract). 15×15, full-info.
// Host = black (moves first), guest = white. Five in a row wins.

import { GameDesync } from "./createGame.js";
import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard, discGeometry } from "./pieces.js";

const SIZE = 15;
const NEED = 5;
const other = (c) => (c === "black" ? "white" : "black");

// Intersections: lines run through cell centres. We map intersection i (0..14)
// to a local coordinate so the whole grid spans the board square.
const STEP = BOARD_SIZE / SIZE;
function ix(i) {
  return -BOARD_HALF + (i + 0.5) * STEP;
}

function winningLine(board, r, c, color) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const line = [[r, c]];
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === color) {
        line.push([rr, cc]);
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (line.length >= NEED) return line;
  }
  return null;
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "gomoku";
  group.userData.gridN = SIZE;

  let role = ctx.role;
  let myColor = role === "host" ? "black" : role === "guest" ? "white" : null;
  let board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  let turn = "black";
  let phase = "play";
  let winner = null;
  let winLine = null;

  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    board: keep(standard(THREE, PALETTE.woodBoard, { roughness: 0.8 })),
    edge: keep(standard(THREE, PALETTE.woodEdge, { roughness: 0.7 })),
    line: keep(standard(THREE, "#3c2610", { roughness: 0.9 })),
    black: keep(standard(THREE, PALETTE.stoneBlack, { roughness: 0.45 })),
    white: keep(standard(THREE, PALETTE.stoneWhite, { roughness: 0.45 })),
    ghost: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.4, transparent: true, opacity: 0.4, depthWrite: false })),
    win: keep(standard(THREE, "#e23b4e", { emissive: "#e23b4e", emissiveIntensity: 0.7 })),
    // Persistent identity / turn cues, one per side. Home bar = "this near side,
    // in MY colour, is me"; lamp = whose-turn. Emissive driven purely from local
    // myColor/turn (never the wire) so a relayed snapshot can't flip the cue.
    homeBlack: keep(standard(THREE, PALETTE.stoneBlack, { roughness: 0.5, emissive: "#9a9a9a", emissiveIntensity: 0 })),
    homeWhite: keep(standard(THREE, PALETTE.stoneWhite, { roughness: 0.5, emissive: "#fbfbfb", emissiveIntensity: 0 })),
    lampBlack: keep(standard(THREE, "#3a3a3a", { roughness: 0.35, metalness: 0.2, emissive: "#cfcfcf", emissiveIntensity: 0 })),
    lampWhite: keep(standard(THREE, PALETTE.stoneWhite, { roughness: 0.35, metalness: 0.2, emissive: "#fbfbfb", emissiveIntensity: 0 })),
  };

  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plankGeo = keep(new THREE.BoxGeometry(outer, plankH, outer));
  const plank = meshOf(THREE, plankGeo, M.board);
  plank.position.y = plankH / 2;
  group.add(plank);
  const frameGeo = keep(new THREE.BoxGeometry(outer + 0.03, plankH * 0.6, outer + 0.03));
  const frame = meshOf(THREE, frameGeo, M.edge);
  frame.position.y = plankH * 0.3;
  group.add(frame);

  const TOP = plankH;
  // Grid lines.
  const lineGeoH = keep(new THREE.BoxGeometry((SIZE - 1) * STEP, 0.0015, 0.0035));
  const lineGeoV = keep(new THREE.BoxGeometry(0.0035, 0.0015, (SIZE - 1) * STEP));
  for (let i = 0; i < SIZE; i++) {
    const h = meshOf(THREE, lineGeoH, M.line, false);
    h.position.set(0, TOP + 0.001, ix(i));
    group.add(h);
    const v = meshOf(THREE, lineGeoV, M.line, false);
    v.position.set(ix(i), TOP + 0.001, 0);
    group.add(v);
  }

  const STONE_R = STEP * 0.42;
  const stoneGeo = keep(discGeometry(THREE, STONE_R, 0.012, true));
  const ghostGeo = keep(new THREE.CylinderGeometry(STONE_R * 0.6, STONE_R * 0.6, 0.003, 16));
  const hitGeo = keep(new THREE.BoxGeometry(STEP * 0.95, 0.02, STEP * 0.95));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));

  // Per-intersection colliders.
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const box = new THREE.Mesh(hitGeo, invis);
      box.position.set(ix(c), TOP + 0.01, ix(r));
      box.userData.cell = { r, c };
      group.add(box);
    }

  const stones = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const ghosts = [];

  // ---- Persistent identity / turn cues (built once, never rebuilt) ----------
  // Per side: a home-edge tint bar (its own colour) just outside the field, and a
  // turn lamp beside it. Black home = -Z edge (row 0 side, host/moves-first),
  // white home = +Z edge. Both sides are authored in the canonical frame; the
  // framework rotates the whole group by orientFor(seatRy) so each client's OWN
  // home bar ends up directly in front of them — host sees the black bar near,
  // guest sees the white bar near. That gives an at-a-glance "this near side, in
  // MY colour, is me", and host/guest read OPPOSITE-but-consistent identities.
  const cue = { black: { bar: null, lamp: null }, white: { bar: null, lamp: null } };
  {
    const barGeo = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.7, 0.006, 0.012));
    const lampGeo = keep(new THREE.SphereGeometry(0.012, 18, 14));
    const edgeZ = BOARD_HALF + 0.028; // just outside the playing field
    const sides = [
      { color: "black", z: -edgeZ, barMat: M.homeBlack, lampMat: M.lampBlack },
      { color: "white", z: edgeZ, barMat: M.homeWhite, lampMat: M.lampWhite },
    ];
    for (const s of sides) {
      const bar = meshOf(THREE, barGeo, s.barMat, false);
      bar.position.set(0, TOP + 0.004, s.z);
      group.add(bar);
      const lamp = meshOf(THREE, lampGeo, s.lampMat, false);
      lamp.position.set(BOARD_SIZE * 0.42, TOP + 0.008, s.z);
      group.add(lamp);
      cue[s.color].bar = bar;
      cue[s.color].lamp = lamp;
    }
  }

  // Drive the identity/turn cue emissives. Called on every state/role/turn/seat
  // change. NEVER reads colour from the wire — purely from local `myColor`/`turn`.
  //   * Home bar: the LOCAL player's own colour bar glows steadily (that's me);
  //     the opponent's bar stays matte. Spectators: both matte (read-only).
  //   * Turn lamp: only the side-to-move's lamp glows, and brighter when that
  //     side is the local player (it's MY turn). Off when the game is over.
  function updateIdentityCues() {
    for (const color of ["black", "white"]) {
      const c = cue[color];
      if (!c.bar || !c.lamp) continue;
      const isMine = myColor != null && color === myColor;
      const isTurn = phase === "play" && turn === color;
      c.bar.material.emissiveIntensity = isMine ? 0.7 : 0.0;
      c.lamp.material.emissiveIntensity = isTurn ? (isMine ? 1.0 : 0.4) : 0.0;
    }
  }

  function setStone(r, c, color) {
    let s = stones[r][c];
    if (!s) {
      s = meshOf(THREE, stoneGeo, color === "black" ? M.black : M.white);
      s.position.set(ix(c), TOP + 0.006, ix(r));
      group.add(s);
      stones[r][c] = s;
    }
    s.material = color === "black" ? M.black : M.white;
  }
  function clearGhosts() {
    for (const g of ghosts) group.remove(g);
    ghosts.length = 0;
  }
  function refreshGhost() {
    clearGhosts();
    updateIdentityCues();
  }

  function highlightWin() {
    if (!winLine) return;
    for (const [r, c] of winLine) {
      const s = stones[r][c];
      if (s) s.material = M.win;
    }
  }

  function paint() {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c]) setStone(r, c, board[r][c]);
        else if (stones[r][c]) {
          group.remove(stones[r][c]);
          stones[r][c] = null;
        }
      }
    if (phase === "over" && winner) {
      winLine = lastDrop && board[lastDrop.r] && board[lastDrop.r][lastDrop.c] === winner
        ? winningLine(board, lastDrop.r, lastDrop.c, winner) : null;
      highlightWin();
    }
    refreshGhost();
  }

  let lastDrop = null;
  function performMove(r, c, color) {
    board[r][c] = color;
    lastDrop = { r, c };
    setStone(r, c, color);
    const line = winningLine(board, r, c, color);
    if (line) {
      winLine = line;
      winner = color;
      phase = "over";
      highlightWin();
      updateIdentityCues();
      try { ctx.onGameOver({ winner, reason: "five" }); } catch { /* */ }
      return;
    }
    // draw if full
    let full = true;
    for (let rr = 0; rr < SIZE && full; rr++)
      for (let cc = 0; cc < SIZE; cc++) if (!board[rr][cc]) { full = false; break; }
    if (full) {
      phase = "over";
      winner = null;
      updateIdentityCues();
      try { ctx.onGameOver({ winner: null, reason: "draw" }); } catch { /* */ }
      return;
    }
    turn = other(color);
    updateIdentityCues();
  }

  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed()) return;
    if (phase !== "play" || turn !== myColor) return;
    const cell = hit && hit.cell;
    if (!cell) return;
    const { r, c } = cell;
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[r][c]) return;
    performMove(r, c, myColor);
    try { ctx.net.sendMove({ type: "move", r, c }); } catch { /* */ }
    if (role === "host") pushSnapshot();
  }

  function applyMove(move) {
    if (phase !== "play") throw new GameDesync("gomoku: not in play");
    if (!move || move.type !== "move") return false;
    const { r, c } = move;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= SIZE || c < 0 || c >= SIZE)
      throw new GameDesync("gomoku: bad cell");
    if (board[r][c]) throw new GameDesync("gomoku: occupied");
    performMove(r, c, turn);
    return true;
  }

  function snapshot() {
    return { board: board.map((row) => row.slice()), turn, phase, winner, lastDrop };
  }
  function publicState() { return snapshot(); }
  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  function applyState(state) {
    if (!state) {
      board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
      turn = "black";
      phase = "play";
      winner = null;
      winLine = null;
      lastDrop = null;
    } else {
      const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
      const src = Array.isArray(state.board) ? state.board : [];
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
          const v = src[r] && src[r][c];
          if (v === "black" || v === "white") b[r][c] = v;
        }
      board = b;
      turn = state.turn === "white" ? "white" : "black";
      phase = state.phase === "over" ? "over" : "play";
      winner = state.winner === "black" || state.winner === "white" ? state.winner : null;
      lastDrop = state.lastDrop && Number.isInteger(state.lastDrop.r) ? state.lastDrop : null;
      winLine = null;
    }
    paint();
  }

  function setRole(r) {
    role = r || "spectator";
    myColor = role === "host" ? "black" : role === "guest" ? "white" : null;
    refreshGhost();
  }
  function setSeatRy() { updateIdentityCues(); }
  function dispose() {
    clearGhosts();
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  paint();
  return { group, applyState, applyMove, onPointer, publicState, setRole, setSeatRy, dispose };
}

export default createGame;
