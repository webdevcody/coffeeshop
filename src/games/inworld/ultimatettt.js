// Ultimate Tic-Tac-Toe — in-world 3D module (createGame contract). Full-info.
// Host = X (first), guest = O. 9 sub-boards × 9 cells. Move {B,i}.

import { GameDesync } from "./createGame.js";
import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard } from "./pieces.js";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const other = (p) => (p === "X" ? "O" : "X");

function winnerOf(cells) {
  for (const [a, b, c] of LINES)
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
  if (cells.every((v) => v)) return "draw";
  return null;
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "ultimatettt";

  let role = ctx.role;
  let myMark = role === "host" ? "X" : role === "guest" ? "O" : null;
  let cells = Array.from({ length: 9 }, () => Array(9).fill(null)); // cells[B][i]
  let bigWinner = Array(9).fill(null);
  let turn = "X";
  let activeBoard = null; // index or null = any
  let phase = "play";
  let winner = null;

  const owned = [];
  const keep = (x) => (owned.push(x), x);

  const MARK_HEX = { X: "#c4452f", O: "#4a85d6" };
  const M = {
    plank: keep(standard(THREE, "#3a281a", { roughness: 0.8 })),
    frame: keep(standard(THREE, PALETTE.frame, { roughness: 0.7 })),
    sub: keep(standard(THREE, "#e8d2ab", { roughness: 0.85 })),
    subActive: keep(standard(THREE, "#fff0c8", { emissive: PALETTE.accent, emissiveIntensity: 0.25, roughness: 0.7 })),
    subWonX: keep(standard(THREE, "#c4452f", { roughness: 0.5 })),
    subWonO: keep(standard(THREE, "#4a85d6", { roughness: 0.5 })),
    x: keep(standard(THREE, "#c4452f", { roughness: 0.45 })),
    o: keep(standard(THREE, "#4a85d6", { roughness: 0.45 })),
  };

  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plank = meshOf(THREE, keep(new THREE.BoxGeometry(outer, plankH, outer)), M.plank);
  plank.position.y = plankH / 2;
  group.add(plank);
  const TOP = plankH;

  // 3×3 sub-boards with gutters; each sub holds a 3×3 of cells.
  const subSize = BOARD_SIZE / 3 * 0.92;
  const cellSize = subSize / 3;
  function subCenter(B) {
    const br = Math.floor(B / 3), bc = B % 3;
    const sp = BOARD_SIZE / 3;
    return { x: -BOARD_HALF + (bc + 0.5) * sp, z: -BOARD_HALF + (br + 0.5) * sp };
  }
  function cellCenter(B, i) {
    const sc = subCenter(B);
    const cr = Math.floor(i / 3), cc = i % 3;
    return { x: sc.x - subSize / 2 + (cc + 0.5) * cellSize, z: sc.z - subSize / 2 + (cr + 0.5) * cellSize };
  }

  const subPlates = [];
  const subGeo = keep(new THREE.BoxGeometry(subSize, 0.004, subSize));
  const hitGeo = keep(new THREE.BoxGeometry(cellSize * 0.92, 0.03, cellSize * 0.92));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));
  for (let B = 0; B < 9; B++) {
    const sc = subCenter(B);
    const plate = meshOf(THREE, subGeo, M.sub, false);
    plate.position.set(sc.x, TOP + 0.002, sc.z);
    group.add(plate);
    subPlates.push(plate);
    for (let i = 0; i < 9; i++) {
      const cc = cellCenter(B, i);
      const box = new THREE.Mesh(hitGeo, invis);
      box.position.set(cc.x, TOP + 0.015, cc.z);
      box.userData.cell = { B, i };
      group.add(box);
    }
  }

  // Mark meshes pool indexed [B][i].
  const marks = Array.from({ length: 9 }, () => Array(9).fill(null));
  const xGeo = keep(new THREE.BoxGeometry(cellSize * 0.5, 0.01, cellSize * 0.14));
  const oGeo = keep(new THREE.TorusGeometry(cellSize * 0.26, cellSize * 0.07, 8, 18));

  function makeMark(mark) {
    const g = new THREE.Group();
    if (mark === "X") {
      const a = meshOf(THREE, xGeo, M.x);
      a.rotation.y = Math.PI / 4;
      const b = meshOf(THREE, xGeo, M.x);
      b.rotation.y = -Math.PI / 4;
      g.add(a, b);
    } else {
      const o = meshOf(THREE, oGeo, M.o);
      o.rotation.x = Math.PI / 2;
      g.add(o);
    }
    return g;
  }

  // ---- at-a-glance identity + turn label -----------------------------------
  // A small placard on the LOCAL player's near edge (canonical -Z). The framework
  // rotates the whole group by orientFor(seatRy), so -Z always faces the seated
  // viewer — host reads it from one chair, guest from the opposite chair, and each
  // sees a placard that names THEIR OWN mark (derived from role, never the wire).
  const labelCv = document.createElement("canvas");
  labelCv.width = 256;
  labelCv.height = 64;
  const labelTex = keep(new THREE.CanvasTexture(labelCv));
  labelTex.colorSpace = THREE.SRGBColorSpace;
  const labelMat = keep(new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }));
  const labelGeo = keep(new THREE.PlaneGeometry(BOARD_SIZE * 0.5, BOARD_SIZE * 0.5 * 0.25));
  const labelMesh = meshOf(THREE, labelGeo, labelMat, false);
  labelMesh.rotation.x = -Math.PI / 2;
  // Lay flat just outside the near (-Z) edge so it doesn't overlap play cells.
  labelMesh.position.set(0, TOP + 0.004, -BOARD_HALF - 0.045);
  group.add(labelMesh);

  function refreshLabel() {
    const g = labelCv.getContext("2d");
    g.clearRect(0, 0, 256, 64);
    let text;
    let color = "#f0e4cf";
    if (!myMark) {
      text = "Spectating";
    } else {
      const yours = phase === "over"
        ? (winner === myMark ? "You win" : winner ? "You lose" : "Draw")
        : (turn === myMark ? "Your turn" : "Opponent's turn");
      text = `You are ${myMark} — ${yours}`;
      color = MARK_HEX[myMark];
    }
    g.fillStyle = "rgba(28,20,12,0.82)";
    g.beginPath();
    const rr = 12;
    g.moveTo(rr, 0); g.arcTo(256, 0, 256, 64, rr); g.arcTo(256, 64, 0, 64, rr);
    g.arcTo(0, 64, 0, 0, rr); g.arcTo(0, 0, 256, 0, rr); g.closePath(); g.fill();
    g.font = "bold 30px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, 128, 34);
    labelTex.needsUpdate = true;
  }

  function setMark(B, i, mark) {
    if (marks[B][i]) {
      group.remove(marks[B][i]);
      marks[B][i] = null;
    }
    if (!mark) return;
    const g = makeMark(mark);
    const cc = cellCenter(B, i);
    g.position.set(cc.x, TOP + 0.02, cc.z);
    group.add(g);
    marks[B][i] = g;
  }

  function refreshPlates() {
    for (let B = 0; B < 9; B++) {
      const plate = subPlates[B];
      if (bigWinner[B] === "X") plate.material = M.subWonX;
      else if (bigWinner[B] === "O") plate.material = M.subWonO;
      else if (phase === "play" && (activeBoard === null || activeBoard === B) && turn === myMark && ctx.isLocalTurnAllowed())
        plate.material = M.subActive;
      else plate.material = M.sub;
    }
    refreshLabel();
  }

  function performMove(B, i, mark) {
    cells[B][i] = mark;
    setMark(B, i, mark);
    const w = winnerOf(cells[B]);
    if (w && w !== "draw") bigWinner[B] = w;
    else if (w === "draw") bigWinner[B] = "draw";
    const bw = winnerOf(bigWinner.map((x) => (x === "draw" ? null : x)));
    // End on a real meta-line winner, OR on a DRAW when no playable cell remains and
    // nobody has won the meta-board. Without an explicit draw end the game softlocks:
    // legal() returns false for every cell once the board can no longer be advanced,
    // so onGameOver would never fire and the turn would deadlock with no legal move.
    // `noPlayableCell()` is the authoritative "board is full / unplayable" test — it
    // covers both a literally full meta-board and the case where the only remaining
    // empty cells sit inside already-decided sub-boards (i.e. forced to no move).
    if (bw && bw !== "draw") {
      phase = "over";
      winner = bw;
      refreshPlates();
      try { ctx.onGameOver({ winner, reason: "line" }); } catch { /* */ }
      return;
    }
    // No meta-line winner: advance forced-board + turn, then re-check for a drawn board.
    // next active board = the cell index just played, unless that sub is decided.
    activeBoard = bigWinner[i] ? null : i;
    turn = other(mark);
    if (noPlayableCell()) {
      phase = "over";
      winner = null;
      refreshPlates();
      try { ctx.onGameOver({ winner: null, reason: "draw" }); } catch { /* */ }
      return;
    }
    refreshPlates();
  }

  function legal(B, i) {
    if (phase !== "play") return false;
    if (bigWinner[B] || cells[B][i]) return false;
    if (activeBoard !== null && activeBoard !== B) return false;
    return true;
  }

  // True when no legal move exists anywhere on the board (respecting the forced
  // active sub-board). Used to detect a drawn, fully-blocked board.
  function noPlayableCell() {
    for (let B = 0; B < 9; B++) {
      if (bigWinner[B]) continue;
      if (activeBoard !== null && activeBoard !== B) continue;
      for (let i = 0; i < 9; i++) if (!cells[B][i]) return false;
    }
    return true;
  }

  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed() || turn !== myMark) return;
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.B) || !Number.isInteger(cell.i)) return;
    if (!legal(cell.B, cell.i)) return;
    performMove(cell.B, cell.i, myMark);
    try { ctx.net.sendMove({ type: "move", B: cell.B, i: cell.i }); } catch { /* */ }
    if (role === "host") pushSnapshot();
  }

  function applyMove(move) {
    if (phase !== "play") throw new GameDesync("uttt: not in play");
    if (!move || move.type !== "move") return false;
    if (!legal(move.B, move.i)) throw new GameDesync("uttt: illegal move");
    performMove(move.B, move.i, turn);
    return true;
  }

  function snapshot() {
    return {
      cells: cells.map((s) => s.slice()),
      bigWinner: bigWinner.slice(),
      turn, activeBoard, phase, winner,
    };
  }
  function publicState() { return snapshot(); }
  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  function paint() {
    for (let B = 0; B < 9; B++)
      for (let i = 0; i < 9; i++) setMark(B, i, cells[B][i]);
    refreshPlates();
  }

  function applyState(state) {
    if (!state) {
      cells = Array.from({ length: 9 }, () => Array(9).fill(null));
      bigWinner = Array(9).fill(null);
      turn = "X";
      activeBoard = null;
      phase = "play";
      winner = null;
    } else {
      cells = Array.from({ length: 9 }, (_, B) => {
        const row = state.cells && state.cells[B];
        return Array.from({ length: 9 }, (_, i) => {
          const v = row && row[i];
          return v === "X" || v === "O" ? v : null;
        });
      });
      bigWinner = Array.from({ length: 9 }, (_, B) => {
        const v = state.bigWinner && state.bigWinner[B];
        return v === "X" || v === "O" || v === "draw" ? v : null;
      });
      turn = state.turn === "O" ? "O" : "X";
      activeBoard = Number.isInteger(state.activeBoard) ? state.activeBoard : null;
      phase = state.phase === "over" ? "over" : "play";
      winner = state.winner === "X" || state.winner === "O" ? state.winner : null;
    }
    paint();
  }

  function setRole(r) {
    role = r || "spectator";
    myMark = role === "host" ? "X" : role === "guest" ? "O" : null;
    refreshPlates();
  }
  function setSeatRy() {}
  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  paint();
  return { group, applyState, applyMove, onPointer, publicState, setRole, setSeatRy, dispose };
}

export default createGame;
