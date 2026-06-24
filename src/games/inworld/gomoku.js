// Gomoku — in-world 3D module (createGame contract). 15×15 intersections, full-info.
//
// Identity / orientation / turn:
//   * Host plays BLACK and moves first; guest plays WHITE. The two stone colours
//     are rendered with clearly distinct materials (matte black vs glossy white).
//   * The LOCAL player's side is derived purely from `role` (host=black, guest=
//     white, spectator=none) and NEVER recomputed from a relayed snapshot, so a
//     wire state can't flip "which colour is me".
//   * The board is a FLAT board: the framework rotates the whole group by
//     orientFor(seatRy) so the canonical near edge (the local player's home bar)
//     ends up in front of the seated viewer. We therefore use the default orient
//     policy (no orientPolicy:"self"); the host applies the rotation.
//   * Whose-turn is unmistakable: a per-side home bar glows in the local player's
//     own colour ("this near side, in MY colour, is me"), and a turn lamp lights
//     on the side to move (brighter when it's the local player's turn). All cue
//     emissives are driven from local myColor/turn, never the wire.
//   * A your-turn hover-ghost stone previews the move under the cursor in the
//     local player's colour; it is shown only on the local player's turn while the
//     game is in play, and only over empty intersections.
//
// Spectators (role "spectator", seatRy null) render read-only from applyState and
// never receive input (the framework gates pointer routing off for them).

import { GameDesync } from "./createGame.js";
import {
  BOARD_SIZE,
  BOARD_HALF,
  PALETTE,
  meshOf,
  standard,
  discGeometry,
} from "./pieces.js";

const SIZE = 15;
const NEED = 5;
const other = (c) => (c === "black" ? "white" : "black");

// Intersections: lines run through cell centres. Map intersection i (0..14) to a
// local coordinate so the whole grid spans the playable board square.
const STEP = BOARD_SIZE / SIZE;
function ix(i) {
  return -BOARD_HALF + (i + 0.5) * STEP;
}

// Scan from (r,c) along all four axes; return the full run of `color` stones if it
// reaches NEED, else null.
function winningLine(board, r, c, color) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    const line = [[r, c]];
    for (const s of [1, -1]) {
      let rr = r + dr * s;
      let cc = c + dc * s;
      while (
        rr >= 0 &&
        rr < SIZE &&
        cc >= 0 &&
        cc < SIZE &&
        board[rr][cc] === color
      ) {
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
  // Grid size for the framework's geometric click fallback (15×15, not the 8×8
  // default). We also expose our own hitToCell below, which the framework prefers.
  group.userData.gridN = SIZE;

  // ---- Local identity (derived from role, never the wire) -------------------
  let role = ctx.role;
  let myColor = role === "host" ? "black" : role === "guest" ? "white" : null;

  // ---- Authoritative-ish local game state -----------------------------------
  let board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  let turn = "black"; // black always moves first
  let phase = "play"; // "play" | "over"
  let winner = null; // "black" | "white" | null (draw / in-play)
  let winLine = null;
  let lastDrop = null;

  // ---- Materials ------------------------------------------------------------
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    board: keep(standard(THREE, PALETTE.woodBoard, { roughness: 0.8 })),
    edge: keep(standard(THREE, PALETTE.woodEdge, { roughness: 0.7 })),
    line: keep(standard(THREE, "#3c2610", { roughness: 0.9 })),
    // Two CLEARLY distinct stone materials: matte dark vs bright glossy.
    black: keep(standard(THREE, PALETTE.stoneBlack, { roughness: 0.5, metalness: 0.05 })),
    white: keep(standard(THREE, PALETTE.stoneWhite, { roughness: 0.3, metalness: 0.0 })),
    win: keep(standard(THREE, "#e23b4e", { emissive: "#e23b4e", emissiveIntensity: 0.7 })),
    // Hover-ghost: a translucent preview of the LOCAL player's stone. Colour is
    // swapped to match myColor whenever the role changes (see retintGhost()).
    ghostBlack: keep(
      standard(THREE, PALETTE.stoneBlack, {
        emissive: PALETTE.accent,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        roughness: 0.5,
      })
    ),
    ghostWhite: keep(
      standard(THREE, PALETTE.stoneWhite, {
        emissive: PALETTE.accent,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        roughness: 0.3,
      })
    ),
    // Persistent identity / turn cues, one per side. Emissive driven purely from
    // local myColor/turn (never the wire) so a relayed snapshot can't flip them.
    homeBlack: keep(standard(THREE, PALETTE.stoneBlack, { roughness: 0.5, emissive: "#9a9a9a", emissiveIntensity: 0 })),
    homeWhite: keep(standard(THREE, PALETTE.stoneWhite, { roughness: 0.5, emissive: "#fbfbfb", emissiveIntensity: 0 })),
    lampBlack: keep(standard(THREE, "#3a3a3a", { roughness: 0.35, metalness: 0.2, emissive: "#cfcfcf", emissiveIntensity: 0 })),
    lampWhite: keep(standard(THREE, PALETTE.stoneWhite, { roughness: 0.35, metalness: 0.2, emissive: "#fbfbfb", emissiveIntensity: 0 })),
  };

  // ---- Board base: plank + frame --------------------------------------------
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

  // ---- Grid lines (through intersection centres) ----------------------------
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

  // Star points (hoshi) for visual reference — purely decorative.
  {
    const dotGeo = keep(new THREE.CylinderGeometry(STEP * 0.12, STEP * 0.12, 0.0016, 12));
    const dotMat = M.line;
    for (const r of [3, 7, 11])
      for (const c of [3, 7, 11]) {
        const dot = meshOf(THREE, dotGeo, dotMat, false);
        dot.position.set(ix(c), TOP + 0.0012, ix(r));
        group.add(dot);
      }
  }

  // ---- Stone / ghost / collider geometry ------------------------------------
  const STONE_R = STEP * 0.42;
  const stoneGeo = keep(discGeometry(THREE, STONE_R, 0.012, true));
  const hitGeo = keep(new THREE.BoxGeometry(STEP * 0.95, 0.02, STEP * 0.95));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));

  // Per-intersection invisible colliders, tagged userData.cell for the framework's
  // ancestor-walk cell resolver (and our own hitToCell falls back to the same map).
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const box = new THREE.Mesh(hitGeo, invis);
      box.position.set(ix(c), TOP + 0.01, ix(r));
      box.userData.cell = { r, c };
      group.add(box);
    }

  const stones = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  // ---- Hover ghost ----------------------------------------------------------
  // A single re-used ghost stone, hidden until the local player hovers an empty
  // intersection on their own turn. `hoverCell` is recorded by hitToCell (which
  // the framework calls during its hover raycast immediately before setHover), so
  // setHover can place the ghost at the precise {r,c} even though the framework
  // only forwards the column to setHover.
  const ghost = meshOf(THREE, stoneGeo, M.ghostBlack, false);
  ghost.visible = false;
  ghost.position.y = TOP + 0.006;
  group.add(ghost);
  let hoverCell = null; // last {r,c} resolved by hitToCell, or null on a miss
  let ghostPulse = 0;

  function retintGhost() {
    ghost.material = myColor === "white" ? M.ghostWhite : M.ghostBlack;
  }
  retintGhost();

  function hideGhost() {
    ghost.visible = false;
    hoverCell = null;
  }

  // Can the local player place at (r,c) right now?
  function canPlay(r, c) {
    return (
      myColor != null &&
      phase === "play" &&
      turn === myColor &&
      r >= 0 &&
      r < SIZE &&
      c >= 0 &&
      c < SIZE &&
      !board[r][c] &&
      (typeof ctx.isLocalTurnAllowed !== "function" || ctx.isLocalTurnAllowed())
    );
  }

  function showGhostAt(r, c) {
    if (!canPlay(r, c)) {
      ghost.visible = false;
      return;
    }
    ghost.position.set(ix(c), TOP + 0.006, ix(r));
    ghost.visible = true;
  }

  // ---- Persistent identity / turn cues (built once, never rebuilt) ----------
  // Black home = -Z edge (canonical near edge, host/moves-first); white home = +Z.
  // The framework rotates the whole group by orientFor(seatRy) so each client's OWN
  // home bar ends up directly in front of them.
  const cue = { black: { bar: null, lamp: null }, white: { bar: null, lamp: null } };
  {
    const barGeo = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.7, 0.006, 0.012));
    const lampGeo = keep(new THREE.SphereGeometry(0.012, 18, 14));
    const edgeZ = BOARD_HALF + 0.028;
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

  // Drive identity/turn cue emissives — purely from local myColor/turn.
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

  // ---- Stone rendering ------------------------------------------------------
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

  function highlightWin() {
    if (!winLine) return;
    for (const [r, c] of winLine) {
      const s = stones[r][c];
      if (s) s.material = M.win;
    }
  }

  // Full repaint from `board`. Used by applyState and the initial draw.
  function paint() {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c]) setStone(r, c, board[r][c]);
        else if (stones[r][c]) {
          group.remove(stones[r][c]);
          stones[r][c] = null;
        }
      }
    // Recompute the winning line locally from the snapshot's last drop so a relayed
    // "over" state highlights the same five — without trusting any wire line.
    winLine = null;
    if (phase === "over" && winner && lastDrop) {
      const { r, c } = lastDrop;
      if (board[r] && board[r][c] === winner) {
        winLine = winningLine(board, r, c, winner);
      }
    }
    highlightWin();
    hideGhost();
    updateIdentityCues();
  }

  // ---- Move application (shared by local click and relayed move) ------------
  function performMove(r, c, color) {
    board[r][c] = color;
    lastDrop = { r, c };
    setStone(r, c, color);
    hideGhost();

    const line = winningLine(board, r, c, color);
    if (line) {
      winLine = line;
      winner = color;
      phase = "over";
      highlightWin();
      updateIdentityCues();
      try {
        ctx.onGameOver({ winner, reason: "five" });
      } catch {
        /* never let a callback throw break the move */
      }
      return;
    }

    // Draw if the board is full.
    let full = true;
    for (let rr = 0; rr < SIZE && full; rr++)
      for (let cc = 0; cc < SIZE; cc++)
        if (!board[rr][cc]) {
          full = false;
          break;
        }
    if (full) {
      phase = "over";
      winner = null;
      updateIdentityCues();
      try {
        ctx.onGameOver({ winner: null, reason: "draw" });
      } catch {
        /* ignore */
      }
      return;
    }

    turn = other(color);
    updateIdentityCues();
  }

  // ---- Pointer (local click) ------------------------------------------------
  function onPointer(hit) {
    if (typeof ctx.isLocalTurnAllowed === "function" && !ctx.isLocalTurnAllowed())
      return;
    if (phase !== "play" || turn !== myColor || myColor == null) return;
    const cell = hit && hit.cell;
    if (!cell) return;
    const { r, c } = cell;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[r][c]) return;

    performMove(r, c, myColor);
    try {
      ctx.net.sendMove({ type: "move", r, c });
    } catch {
      /* ignore send failure */
    }
    // Host is authoritative: push a fresh snapshot after every committed move.
    if (role === "host") pushSnapshot();
  }

  // ---- Relayed move (host -> guest, or guest -> host) -----------------------
  function applyMove(move) {
    if (!move || move.type !== "move") return false;
    if (phase !== "play") throw new GameDesync("gomoku: not in play");
    const { r, c } = move;
    if (
      !Number.isInteger(r) ||
      !Number.isInteger(c) ||
      r < 0 ||
      r >= SIZE ||
      c < 0 ||
      c >= SIZE
    )
      throw new GameDesync("gomoku: bad cell");
    if (board[r][c]) throw new GameDesync("gomoku: occupied");
    // The colour is whoever is to move — derived locally, not from the wire.
    performMove(r, c, turn);
    // Host re-broadcasts authoritative state after applying a relayed guest move.
    if (role === "host") pushSnapshot();
    return true;
  }

  // ---- Snapshots ------------------------------------------------------------
  function snapshot() {
    return {
      board: board.map((row) => row.slice()),
      turn,
      phase,
      winner,
      lastDrop: lastDrop ? { r: lastDrop.r, c: lastDrop.c } : null,
    };
  }
  function publicState() {
    return snapshot();
  }
  function pushSnapshot() {
    const s = snapshot();
    try {
      ctx.net.sendState(s, s);
    } catch {
      /* ignore */
    }
  }

  // ---- Apply authoritative state (guest/spectator catch-up) -----------------
  // Rebuilds the game from scratch idempotently. NEVER recomputes myColor/role
  // from the wire — only the shared board/turn/phase do.
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
      winner =
        state.winner === "black" || state.winner === "white" ? state.winner : null;
      lastDrop =
        state.lastDrop && Number.isInteger(state.lastDrop.r) && Number.isInteger(state.lastDrop.c)
          ? { r: state.lastDrop.r, c: state.lastDrop.c }
          : null;
    }
    paint();
  }

  // ---- Hover routing --------------------------------------------------------
  // The framework's hover path raycasts the board, calls hitToCell(hit) (we record
  // the full {r,c}), then calls setHover(cell.c). On a miss it calls setHover(-1).
  // We use the recorded hoverCell to position the ghost precisely.
  function hitToCell(hit) {
    const o = hit && hit.object;
    let node = o;
    while (node) {
      if (node.userData && node.userData.cell) {
        hoverCell = { r: node.userData.cell.r, c: node.userData.cell.c };
        return hoverCell;
      }
      node = node.parent;
    }
    // No collider hit (e.g. bare wood beyond the colliders): geometric fallback.
    if (hit && hit.point && group.worldToLocal) {
      const local = group.worldToLocal(hit.point.clone());
      const c = Math.round((local.x + BOARD_HALF) / BOARD_SIZE * SIZE - 0.5);
      const r = Math.round((local.z + BOARD_HALF) / BOARD_SIZE * SIZE - 0.5);
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
        hoverCell = { r, c };
        return hoverCell;
      }
    }
    hoverCell = null;
    return null;
  }

  function setHover(x) {
    // x === -1 (miss / off-turn) clears the preview. Otherwise use the precise
    // {r,c} that hitToCell just recorded for this hover raycast.
    if (x === -1 || x == null || hoverCell == null) {
      hideGhost();
      return;
    }
    showGhostAt(hoverCell.r, hoverCell.c);
  }

  // ---- Per-frame: gentle ghost pulse so the affordance reads as "live" -------
  function update(dt) {
    if (!ghost.visible) return;
    ghostPulse += dt || 0.016;
    const base = myColor === "white" ? 0.5 : 0.45;
    ghost.material.opacity = base + 0.12 * (0.5 + 0.5 * Math.sin(ghostPulse * 4));
  }

  // ---- Role / seat changes --------------------------------------------------
  function setRole(r) {
    role = r || "spectator";
    myColor = role === "host" ? "black" : role === "guest" ? "white" : null;
    retintGhost();
    hideGhost();
    updateIdentityCues();
  }
  function setSeatRy() {
    // Orientation is applied by the framework (orientFor(seatRy)); we only refresh
    // the local cue emissives.
    updateIdentityCues();
  }

  function dispose() {
    hideGhost();
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  // Initial draw.
  paint();

  return {
    group,
    applyState,
    applyMove,
    onPointer,
    publicState,
    hitToCell,
    setHover,
    update,
    setRole,
    setSeatRy,
    dispose,
  };
}

export default createGame;
