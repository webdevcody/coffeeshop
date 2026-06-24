// Ultimate Tic-Tac-Toe — in-world 3D module (createGame contract). Full-info.
//
// Host = X (color A, moves first), guest = O (color B). 9 sub-boards × 9 cells.
// Move on the wire is { type:"move", B, i } where B is the sub-board (0..8) and
// i the cell within it (0..8). The cell you play (index i) dictates the sub-board
// the opponent is FORCED into next; if that sub-board is already decided/full the
// opponent may play anywhere (activeBoard === null).
//
// Identity/orientation/turn contract (see createGame.js + board.js):
//   * The LOCAL player's mark is derived ONCE from `role` (host=X, guest=O) and
//     is NEVER recomputed from a relayed snapshot — applyState only rebuilds the
//     shared game state, never myMark. This prevents a side-flip on the guest.
//   * X and O render in clearly distinct materials (warm red vs cool blue), and
//     each side gets its own "home" edge bar + turn lamp. The home bar in the
//     local player's OWN colour sits on the near (-Z) edge; the framework rotates
//     the whole group by orientFor(seatRy) so it ends up directly in front of the
//     seated viewer — host reads X-near, guest reads O-near, opposite-but-correct.
//   * The forced sub-board is highlighted for BOTH players at all times so the
//     constraint is unmistakable; the side-to-move's lamp glows (brighter when
//     it's the local player's turn) as the unmistakable whose-turn cue.
//   * Input is gated on ctx.isLocalTurnAllowed() AND turn === myMark AND legality.
//   * A spectator (myMark null, seatRy null) renders read-only from applyState and
//     never has input.

import { GameDesync } from "./createGame.js";
import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard } from "./pieces.js";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const other = (p) => (p === "X" ? "O" : "X");

// Winner of a 9-cell grid: "X" | "O" | "draw" | null. A grid is a draw only when
// every cell is filled with no line.
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

  // ---- identity (derived ONCE from role; never from the wire) ----------------
  let role = ctx.role;
  let myMark = role === "host" ? "X" : role === "guest" ? "O" : null;

  // ---- shared game state -----------------------------------------------------
  let cells = Array.from({ length: 9 }, () => Array(9).fill(null)); // cells[B][i]
  let bigWinner = Array(9).fill(null); // "X" | "O" | "draw" | null per sub-board
  let turn = "X";                      // host (X) always moves first
  let activeBoard = null;              // forced sub-board index, or null = play anywhere
  let phase = "play";                  // "play" | "over"
  let winner = null;                   // "X" | "O" | null (null at over = draw)
  let lastMove = null;                 // { B, i } — for a subtle "just played" cue

  const owned = [];
  const keep = (x) => (owned.push(x), x);

  const MARK_HEX = { X: "#c4452f", O: "#4a85d6" };
  const M = {
    plank: keep(standard(THREE, "#3a281a", { roughness: 0.8 })),
    frame: keep(standard(THREE, PALETTE.frame, { roughness: 0.7 })),
    sub: keep(standard(THREE, "#e8d2ab", { roughness: 0.85 })),
    // Forced sub-board: glows for everyone so the constraint reads at a glance.
    subActive: keep(standard(THREE, "#fff0c8", { emissive: PALETTE.accent, emissiveIntensity: 0.5, roughness: 0.6 })),
    subWonX: keep(standard(THREE, "#c4452f", { roughness: 0.5 })),
    subWonO: keep(standard(THREE, "#4a85d6", { roughness: 0.5 })),
    subDraw: keep(standard(THREE, "#9a8f7a", { roughness: 0.7 })),
    gutter: keep(standard(THREE, "#2a1d12", { roughness: 0.85 })),
    x: keep(standard(THREE, "#c4452f", { roughness: 0.45 })),
    o: keep(standard(THREE, "#4a85d6", { roughness: 0.45 })),
    // Win highlight for the marks on the deciding meta-line.
    xWin: keep(standard(THREE, "#ff6a4d", { emissive: "#ff6a4d", emissiveIntensity: 0.6, roughness: 0.4 })),
    oWin: keep(standard(THREE, "#6aa8ff", { emissive: "#6aa8ff", emissiveIntensity: 0.6, roughness: 0.4 })),
    // Identity home bars + turn lamps, one per side. Emissive is driven purely
    // from local myMark/turn (never the wire) so a snapshot can't flip the cue.
    homeX: keep(standard(THREE, "#c4452f", { roughness: 0.5, emissive: "#c4452f", emissiveIntensity: 0 })),
    homeO: keep(standard(THREE, "#4a85d6", { roughness: 0.5, emissive: "#4a85d6", emissiveIntensity: 0 })),
    lampX: keep(standard(THREE, "#7a2a1c", { roughness: 0.35, metalness: 0.2, emissive: "#ff7a55", emissiveIntensity: 0 })),
    lampO: keep(standard(THREE, "#1c3a7a", { roughness: 0.35, metalness: 0.2, emissive: "#6aa8ff", emissiveIntensity: 0 })),
  };

  // ---- base board ------------------------------------------------------------
  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plank = meshOf(THREE, keep(new THREE.BoxGeometry(outer, plankH, outer)), M.plank);
  plank.position.y = plankH / 2;
  group.add(plank);
  const frameGeo = keep(new THREE.BoxGeometry(outer + 0.03, plankH * 0.6, outer + 0.03));
  const frame = meshOf(THREE, frameGeo, M.frame);
  frame.position.y = plankH * 0.3;
  group.add(frame);
  const TOP = plankH;

  // 3×3 sub-boards with gutters; each sub holds a 3×3 of cells.
  const spacing = BOARD_SIZE / 3;
  const subSize = spacing * 0.92;
  const cellSize = subSize / 3;
  function subCenter(B) {
    const br = Math.floor(B / 3), bc = B % 3;
    return { x: -BOARD_HALF + (bc + 0.5) * spacing, z: -BOARD_HALF + (br + 0.5) * spacing };
  }
  function cellCenter(B, i) {
    const sc = subCenter(B);
    const cr = Math.floor(i / 3), cc = i % 3;
    return { x: sc.x - subSize / 2 + (cc + 0.5) * cellSize, z: sc.z - subSize / 2 + (cr + 0.5) * cellSize };
  }

  // Gutter lines between the 3×3 of sub-boards so the meta-grid reads as such.
  {
    const gutGeoV = keep(new THREE.BoxGeometry(0.006, 0.003, BOARD_SIZE * 0.98));
    const gutGeoH = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.98, 0.003, 0.006));
    for (let k = 1; k <= 2; k++) {
      const x = -BOARD_HALF + k * spacing;
      const v = meshOf(THREE, gutGeoV, M.gutter, false);
      v.position.set(x, TOP + 0.0015, 0);
      group.add(v);
      const h = meshOf(THREE, gutGeoH, M.gutter, false);
      h.position.set(0, TOP + 0.0015, x);
      group.add(h);
    }
  }

  const subPlates = [];
  const subGeo = keep(new THREE.BoxGeometry(subSize, 0.004, subSize));
  // Thin inner grid lines on each sub-board for cell legibility.
  const cellLineGeoV = keep(new THREE.BoxGeometry(0.0025, 0.002, subSize * 0.95));
  const cellLineGeoH = keep(new THREE.BoxGeometry(subSize * 0.95, 0.002, 0.0025));
  const hitGeo = keep(new THREE.BoxGeometry(cellSize * 0.92, 0.03, cellSize * 0.92));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));
  for (let B = 0; B < 9; B++) {
    const sc = subCenter(B);
    const plate = meshOf(THREE, subGeo, M.sub, false);
    plate.position.set(sc.x, TOP + 0.002, sc.z);
    group.add(plate);
    subPlates.push(plate);
    for (let k = 1; k <= 2; k++) {
      const off = -subSize / 2 + k * (subSize / 3);
      const lv = meshOf(THREE, cellLineGeoV, M.gutter, false);
      lv.position.set(sc.x + off, TOP + 0.0045, sc.z);
      group.add(lv);
      const lh = meshOf(THREE, cellLineGeoH, M.gutter, false);
      lh.position.set(sc.x, TOP + 0.0045, sc.z + off);
      group.add(lh);
    }
    for (let i = 0; i < 9; i++) {
      const cc = cellCenter(B, i);
      const box = new THREE.Mesh(hitGeo, invis);
      box.position.set(cc.x, TOP + 0.015, cc.z);
      box.userData.cell = { B, i };
      group.add(box);
    }
  }

  // ---- mark meshes pool indexed [B][i] ---------------------------------------
  const marks = Array.from({ length: 9 }, () => Array(9).fill(null));
  const xGeo = keep(new THREE.BoxGeometry(cellSize * 0.5, 0.01, cellSize * 0.14));
  const oGeo = keep(new THREE.TorusGeometry(cellSize * 0.26, cellSize * 0.07, 8, 18));

  // A "big" mark stamped on a won sub-board so winners read across the room.
  const bigXGeo = keep(new THREE.BoxGeometry(subSize * 0.6, 0.012, subSize * 0.16));
  const bigOGeo = keep(new THREE.TorusGeometry(subSize * 0.3, subSize * 0.08, 10, 22));
  const bigMarks = Array(9).fill(null);

  function makeMark(mark, big = false) {
    const g = new THREE.Group();
    if (mark === "X") {
      const mat = M.x;
      const geo = big ? bigXGeo : xGeo;
      const a = meshOf(THREE, geo, mat);
      a.rotation.y = Math.PI / 4;
      const b = meshOf(THREE, geo, mat);
      b.rotation.y = -Math.PI / 4;
      g.add(a, b);
    } else {
      const o = meshOf(THREE, big ? bigOGeo : oGeo, M.o);
      o.rotation.x = Math.PI / 2;
      g.add(o);
    }
    return g;
  }

  // ---- identity / turn cues (built once) -------------------------------------
  // Per side: a home-edge tint bar in its own colour just outside the field, and
  // a turn lamp beside it. X home = -Z edge (host / moves-first), O home = +Z.
  const cue = { X: { bar: null, lamp: null }, O: { bar: null, lamp: null } };
  {
    const barGeo = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.7, 0.006, 0.014));
    const lampGeo = keep(new THREE.SphereGeometry(0.013, 18, 14));
    const edgeZ = BOARD_HALF + 0.03;
    const sides = [
      { mark: "X", z: -edgeZ, barMat: M.homeX, lampMat: M.lampX },
      { mark: "O", z: edgeZ, barMat: M.homeO, lampMat: M.lampO },
    ];
    for (const s of sides) {
      const bar = meshOf(THREE, barGeo, s.barMat, false);
      bar.position.set(0, TOP + 0.004, s.z);
      group.add(bar);
      const lamp = meshOf(THREE, lampGeo, s.lampMat, false);
      lamp.position.set(BOARD_SIZE * 0.42, TOP + 0.009, s.z);
      group.add(lamp);
      cue[s.mark].bar = bar;
      cue[s.mark].lamp = lamp;
    }
  }

  // ---- text placard on the LOCAL near edge -----------------------------------
  // Names THEIR OWN mark (derived from role, never the wire) + whose turn.
  const labelCv = document.createElement("canvas");
  labelCv.width = 256;
  labelCv.height = 64;
  const labelTex = keep(new THREE.CanvasTexture(labelCv));
  labelTex.colorSpace = THREE.SRGBColorSpace;
  const labelMat = keep(new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }));
  const labelGeo = keep(new THREE.PlaneGeometry(BOARD_SIZE * 0.5, BOARD_SIZE * 0.5 * 0.25));
  const labelMesh = meshOf(THREE, labelGeo, labelMat, false);
  labelMesh.rotation.x = -Math.PI / 2;
  labelMesh.position.set(0, TOP + 0.004, -BOARD_HALF - 0.06);
  group.add(labelMesh);

  function refreshLabel() {
    const g = labelCv.getContext("2d");
    g.clearRect(0, 0, 256, 64);
    let text;
    let color = "#f0e4cf";
    if (!myMark) {
      const t = phase === "over"
        ? (winner ? `${winner} wins` : "Draw")
        : `${turn} to move`;
      text = `Spectating — ${t}`;
    } else {
      const yours = phase === "over"
        ? (winner === myMark ? "You win!" : winner ? "You lose" : "Draw")
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

  // Drive identity bar + turn lamp emissives (never reads the wire).
  function updateIdentityCues() {
    for (const mark of ["X", "O"]) {
      const c = cue[mark];
      if (!c.bar || !c.lamp) continue;
      const isMine = myMark != null && mark === myMark;
      const isTurn = phase === "play" && turn === mark;
      c.bar.material.emissiveIntensity = isMine ? 0.7 : 0.0;
      c.lamp.material.emissiveIntensity = isTurn ? (isMine ? 1.0 : 0.4) : 0.0;
    }
  }

  // ---- rendering -------------------------------------------------------------
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

  function setBigMark(B, mark) {
    if (bigMarks[B]) {
      group.remove(bigMarks[B]);
      bigMarks[B] = null;
    }
    if (mark !== "X" && mark !== "O") return;
    const g = makeMark(mark, true);
    const sc = subCenter(B);
    g.position.set(sc.x, TOP + 0.03, sc.z);
    bigMarks[B] = g;
    group.add(g);
  }

  function refreshPlates() {
    for (let B = 0; B < 9; B++) {
      const plate = subPlates[B];
      if (bigWinner[B] === "X") plate.material = M.subWonX;
      else if (bigWinner[B] === "O") plate.material = M.subWonO;
      else if (bigWinner[B] === "draw") plate.material = M.subDraw;
      // Forced board glows for EVERYONE (host, guest, spectator) while play is on.
      else if (phase === "play" && (activeBoard === null || activeBoard === B)) plate.material = M.subActive;
      else plate.material = M.sub;
    }
    updateIdentityCues();
    refreshLabel();
  }

  // Highlight the marks on the deciding meta-line (the three won sub-boards).
  // Rebuild the winning bigMark meshes fresh and assign the win material rather
  // than mutating the pooled big-mark meshes' shared material in place — that way
  // M.x/M.o are never permanently overwritten and a redundant call is harmless.
  function highlightMetaWin() {
    if (phase !== "over" || (winner !== "X" && winner !== "O")) return;
    const big = bigWinner.map((x) => (x === "draw" ? null : x));
    let line = null;
    for (const L of LINES)
      if (big[L[0]] === winner && big[L[1]] === winner && big[L[2]] === winner) { line = L; break; }
    if (!line) return;
    const winMat = winner === "X" ? M.xWin : M.oWin;
    for (const B of line) {
      if (bigWinner[B] !== "X" && bigWinner[B] !== "O") continue;
      setBigMark(B, bigWinner[B]);
      const g = bigMarks[B];
      if (!g) continue;
      g.traverse((o) => { if (o.isMesh) o.material = winMat; });
    }
  }

  // ---- game logic ------------------------------------------------------------
  function recomputeBig(B) {
    const w = winnerOf(cells[B]);
    bigWinner[B] = w ? w : null;
  }

  function metaWinner() {
    return winnerOf(bigWinner.map((x) => (x === "draw" ? null : x)));
  }

  // True when no legal move exists anywhere (respecting the forced active board).
  function noPlayableCell() {
    for (let B = 0; B < 9; B++) {
      if (bigWinner[B]) continue;
      if (activeBoard !== null && activeBoard !== B) continue;
      for (let i = 0; i < 9; i++) if (!cells[B][i]) return false;
    }
    return true;
  }

  function legal(B, i) {
    if (phase !== "play") return false;
    if (!Number.isInteger(B) || B < 0 || B > 8 || !Number.isInteger(i) || i < 0 || i > 8) return false;
    if (bigWinner[B] || cells[B][i]) return false;
    if (activeBoard !== null && activeBoard !== B) return false;
    return true;
  }

  function performMove(B, i, mark) {
    cells[B][i] = mark;
    lastMove = { B, i };
    setMark(B, i, mark);
    recomputeBig(B);
    if (bigWinner[B] === "X" || bigWinner[B] === "O") setBigMark(B, bigWinner[B]);

    // Overall (meta-board) line win ends the game immediately.
    const mw = metaWinner();
    if (mw === "X" || mw === "O") {
      phase = "over";
      winner = mw;
      activeBoard = null;
      refreshPlates();
      highlightMetaWin();
      try { ctx.onGameOver({ winner, reason: "line" }); } catch { /* */ }
      return;
    }

    // No meta win: forced next board is the played cell index, unless that sub is
    // already decided (won or drawn) → free choice (null).
    activeBoard = bigWinner[i] ? null : i;
    turn = other(mark);

    // Drawn / fully-blocked board (incl. meta board full with no line) ends as a draw.
    if (noPlayableCell() || metaWinner() === "draw") {
      phase = "over";
      winner = null;
      activeBoard = null;
      refreshPlates();
      try { ctx.onGameOver({ winner: null, reason: "draw" }); } catch { /* */ }
      return;
    }
    refreshPlates();
  }

  function onPointer(hit) {
    if (!myMark) return;                       // spectator never has input
    if (!ctx.isLocalTurnAllowed() || turn !== myMark) return;
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.B) || !Number.isInteger(cell.i)) return;
    if (!legal(cell.B, cell.i)) return;
    performMove(cell.B, cell.i, myMark);
    try { ctx.net.sendMove({ type: "move", B: cell.B, i: cell.i }); } catch { /* */ }
    if (role === "host") pushSnapshot();
  }

  // Relayed move from the OTHER seat. We apply it as the side whose turn it is
  // (NOT myMark — that would corrupt 2-player identity). If the host receives a
  // guest move it must re-broadcast the resulting snapshot so spectators converge.
  function applyMove(move) {
    if (phase !== "play") throw new GameDesync("uttt: not in play");
    if (!move || move.type !== "move") return false;
    if (!legal(move.B, move.i)) throw new GameDesync("uttt: illegal move");
    performMove(move.B, move.i, turn);
    if (role === "host") pushSnapshot();
    return true;
  }

  // ---- snapshots -------------------------------------------------------------
  function snapshot() {
    return {
      cells: cells.map((s) => s.slice()),
      bigWinner: bigWinner.slice(),
      turn, activeBoard, phase, winner, lastMove,
    };
  }
  function publicState() { return snapshot(); }
  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  function paint() {
    for (let B = 0; B < 9; B++) {
      for (let i = 0; i < 9; i++) setMark(B, i, cells[B][i]);
      setBigMark(B, bigWinner[B] === "X" || bigWinner[B] === "O" ? bigWinner[B] : null);
    }
    refreshPlates();
    if (phase === "over") highlightMetaWin();
  }

  // applyState rebuilds shared state ONLY — never myMark/role (no side-flip).
  function applyState(state) {
    if (!state) {
      cells = Array.from({ length: 9 }, () => Array(9).fill(null));
      bigWinner = Array(9).fill(null);
      turn = "X";
      activeBoard = null;
      phase = "play";
      winner = null;
      lastMove = null;
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
      // activeBoard must be a real, still-undecided sub-board (0..8) or null.
      activeBoard =
        Number.isInteger(state.activeBoard) &&
        state.activeBoard >= 0 &&
        state.activeBoard < 9 &&
        !bigWinner[state.activeBoard]
          ? state.activeBoard
          : null;
      phase = state.phase === "over" ? "over" : "play";
      winner = state.winner === "X" || state.winner === "O" ? state.winner : null;
      // lastMove is a cosmetic cue; validate both B and i before trusting it.
      lastMove =
        state.lastMove &&
        Number.isInteger(state.lastMove.B) &&
        Number.isInteger(state.lastMove.i)
          ? state.lastMove
          : null;
    }
    paint();
  }

  // ---- role / seat / lifecycle ----------------------------------------------
  function setRole(r) {
    role = r || "spectator";
    myMark = role === "host" ? "X" : role === "guest" ? "O" : null;
    refreshPlates();
  }
  function setSeatRy() { updateIdentityCues(); }
  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  paint();
  return { group, applyState, applyMove, onPointer, publicState, setRole, setSeatRy, dispose };
}

export default createGame;
