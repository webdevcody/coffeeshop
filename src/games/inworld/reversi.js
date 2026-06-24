// Reversi / Othello — in-world 3D module (createGame contract). 8x8, full-info.
//
// Host = BLACK (moves first), guest = WHITE. Discs flip black<->white on capture.
// Turn auto-passes when a side has no legal move; the game ends when neither side
// can move and the winner is decided by disc count.
//
// Candidate #4. Distinct structural choices vs. the shipped module:
//   * A single authoritative `commit()` path drives BOTH local clicks and relayed
//     moves, so the host re-broadcasts an authoritative snapshot after EVERY
//     committed move — including a guest's relayed move. (The shipped module
//     pushed a snapshot only on the host's own clicks, so a guest's move never
//     reached spectators and broke resync.)
//   * Identity / colour is derived ONCE from the local role and NEVER recomputed
//     from the wire. applyState only ingests board/turn/phase/winner; the local
//     player's side + the board facing are owned locally.
//   * Per-seat facing is owned by the module (orientPolicy:"self"): each player
//     sees their OWN home edge nearest them; the opponent sits across.

import { GameDesync, orientFor } from "./createGame.js";
import {
  PALETTE,
  meshOf,
  standard,
  discGeometry,
  buildGridBoard,
  cellX,
  cellZ,
} from "./pieces.js";

const N = 8;
const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];
const other = (c) => (c === "black" ? "white" : "black");

export function initialBoard() {
  const b = Array.from({ length: N }, () => Array(N).fill(null));
  b[3][3] = "white";
  b[3][4] = "black";
  b[4][3] = "black";
  b[4][4] = "white";
  return b;
}

// Cells captured if `color` plays at (r,c); [] if the move is illegal/occupied.
function flipsFor(board, r, c, color) {
  if (r < 0 || r >= N || c < 0 || c >= N || board[r][c]) return [];
  const opp = other(color);
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === opp) {
      line.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    if (line.length && rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === color) {
      out.push(...line);
    }
  }
  return out;
}

function legalMoves(board, color) {
  const out = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!board[r][c] && flipsFor(board, r, c, color).length) out.push({ r, c });
    }
  }
  return out;
}

function hasMove(board, color) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!board[r][c] && flipsFor(board, r, c, color).length) return true;
    }
  }
  return false;
}

function count(board, color) {
  let n = 0;
  for (const row of board) for (const v of row) if (v === color) n++;
  return n;
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "reversi";
  group.userData.gridN = N; // help the host's geometric cell fallback

  // ---- Local identity (derived ONCE from role; NEVER from the wire) ----------
  let role = ctx.role;
  let seatRy = ctx.seatRy;
  // host => black & moves first; guest => white; spectator => no side.
  let myColor = role === "host" ? "black" : role === "guest" ? "white" : null;

  // ---- Per-seat facing -------------------------------------------------------
  // Cues/home edges are authored in ONE canonical frame: black home at -Z, white
  // home at +Z. We declare orientPolicy:"self" so the host does NOT rotate us,
  // then rotate the group ourselves so each player's OWN home edge faces them:
  //   orientFor(seatRy) brings the canonical -Z (black) edge near the seat;
  //   a further PI for white brings the +Z (white) edge near instead.
  // Othello is symmetric and clicks resolve through group.worldToLocal (which
  // undoes the full rotation), so cells stay canonical regardless of facing.
  function applyFacing() {
    const extra = myColor === "white" ? Math.PI : 0;
    group.rotation.y = orientFor(seatRy) + extra;
  }
  applyFacing();

  // ---- Logical state ---------------------------------------------------------
  let board = initialBoard();
  let turn = "black";
  let phase = "play"; // "play" | "over"
  let winner = null;  // "black" | "white" | null(draw/none)

  // ---- Materials / geometry (module owns disposal) ---------------------------
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    frame: keep(standard(THREE, PALETTE.feltEdge, { roughness: 0.7 })),
    plank: keep(standard(THREE, PALETTE.felt, { roughness: 0.85 })),
    dark: keep(standard(THREE, PALETTE.felt, { roughness: 0.85 })),
    light: keep(standard(THREE, "#28925e", { roughness: 0.85 })),
    // The two sides MUST read as clearly distinct materials.
    black: keep(standard(THREE, PALETTE.discBlack, { roughness: 0.5, metalness: 0.05 })),
    white: keep(standard(THREE, PALETTE.discWhite, { roughness: 0.45, metalness: 0.05 })),
    ghost: keep(standard(THREE, PALETTE.accent, {
      emissive: PALETTE.accent,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })),
    // Per-side identity bars + turn lamps, each its own instance so the local
    // side can light independently of the opponent's.
    homeBlack: keep(standard(THREE, PALETTE.discBlack, { roughness: 0.5, emissive: "#6b6b7a", emissiveIntensity: 0 })),
    homeWhite: keep(standard(THREE, PALETTE.discWhite, { roughness: 0.5, emissive: "#cfe6d8", emissiveIntensity: 0 })),
    lampBlack: keep(standard(THREE, PALETTE.discBlack, { roughness: 0.35, metalness: 0.2, emissive: "#9aa0b5", emissiveIntensity: 0 })),
    lampWhite: keep(standard(THREE, PALETTE.discWhite, { roughness: 0.35, metalness: 0.2, emissive: "#eafff2", emissiveIntensity: 0 })),
  };

  const base = buildGridBoard(THREE, group, {
    n: N,
    isDark: (r, c) => (r + c) % 2 === 0,
    darkMat: M.dark,
    lightMat: M.light,
    frameMat: M.frame,
    plankMat: M.plank,
  });
  const REST_Y = base.tileTop;
  const STEP = base.step;
  const DISC_R = STEP * 0.42;
  const DISC_T = 0.014;
  const discGeo = keep(discGeometry(THREE, DISC_R, DISC_T, true));
  const ghostGeo = keep(new THREE.CylinderGeometry(DISC_R * 0.55, DISC_R * 0.55, 0.004, 20));

  // ---- Identity / turn cues (authored canonical; rotated by applyFacing) -----
  const cue = { black: { bar: null, lamp: null }, white: { bar: null, lamp: null } };
  {
    const HALF = STEP * (N / 2);
    const frameW = 0.03;
    const frameH = 0.012;
    const railTop = base.tileTop + frameH;
    const edge = HALF + frameW / 2;
    const barGeo = keep(new THREE.BoxGeometry(STEP * N * 0.7, frameH * 0.5, frameW * 0.5));
    const lampGeo = keep(new THREE.SphereGeometry(frameW * 0.32, 18, 14));
    const sides = [
      { color: "black", z: -edge, barMat: M.homeBlack, lampMat: M.lampBlack },
      { color: "white", z: edge, barMat: M.homeWhite, lampMat: M.lampWhite },
    ];
    for (const s of sides) {
      const bar = meshOf(THREE, barGeo, s.barMat, false);
      bar.position.set(0, railTop + frameH * 0.26, s.z);
      group.add(bar);
      const lamp = meshOf(THREE, lampGeo, s.lampMat, false);
      lamp.position.set(STEP * N * 0.42, railTop + frameW * 0.32, s.z);
      group.add(lamp);
      cue[s.color].bar = bar;
      cue[s.color].lamp = lamp;
    }
  }

  // Drive cue emissives purely from local myColor/turn/phase — NEVER the wire.
  function updateCues() {
    for (const color of ["black", "white"]) {
      const c = cue[color];
      if (!c.bar || !c.lamp) continue;
      const isMine = myColor != null && color === myColor;
      const isTurn = phase === "play" && turn === color;
      c.bar.material.emissiveIntensity = isMine ? 0.6 : 0.0;
      c.lamp.material.emissiveIntensity = isTurn ? (isMine ? 1.0 : 0.45) : 0.0;
    }
  }

  // ---- Disc meshes + ghosts --------------------------------------------------
  const discs = Array.from({ length: N }, () => Array(N).fill(null));
  const ghosts = [];
  let busy = false;     // an animation is in flight (gates input)
  let disposed = false;

  // ---- Flip animation --------------------------------------------------------
  const flips = []; // { mesh, t, dur, to, swapped }
  let rafId = 0;
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let lastT = 0;
  function startLoop() {
    if (rafId || disposed || typeof requestAnimationFrame === "undefined") return;
    lastT = nowMs();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
      lastT = t;
      step(dt);
      rafId = flips.length && !disposed ? requestAnimationFrame(tick) : 0;
    };
    rafId = requestAnimationFrame(tick);
  }
  function step(dt) {
    for (let i = flips.length - 1; i >= 0; i--) {
      const f = flips[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.mesh.rotation.x = k * Math.PI;
      if (k >= 0.5 && !f.swapped) {
        f.swapped = true;
        f.mesh.material = f.to === "black" ? M.black : M.white;
      }
      if (k >= 1) {
        f.mesh.rotation.x = 0;
        flips.splice(i, 1);
      }
    }
    if (!flips.length) busy = false;
  }

  function ensureDisc(r, c, color) {
    let d = discs[r][c];
    if (!d) {
      d = meshOf(THREE, discGeo, color === "black" ? M.black : M.white);
      d.position.set(cellX(c, N), REST_Y + DISC_T / 2, cellZ(r, N));
      group.add(d);
      discs[r][c] = d;
    }
    return d;
  }

  function setDisc(r, c, color, animate) {
    const d = ensureDisc(r, c, color);
    if (animate) {
      flips.push({ mesh: d, t: 0, dur: 0.3, to: color, swapped: false });
      busy = true;
      startLoop();
    } else {
      d.material = color === "black" ? M.black : M.white;
      d.rotation.x = 0;
    }
  }

  function removeDisc(r, c) {
    const d = discs[r][c];
    if (d) {
      group.remove(d);
      discs[r][c] = null;
    }
  }

  // ---- Ghost legal-move markers (only on the LOCAL player's own turn) --------
  function clearGhosts() {
    for (const g of ghosts) group.remove(g);
    ghosts.length = 0;
  }
  function refreshGhosts() {
    clearGhosts();
    if (
      phase !== "play" ||
      role === "spectator" ||
      myColor == null ||
      turn !== myColor ||
      !safeTurnAllowed()
    ) {
      return;
    }
    for (const m of legalMoves(board, myColor)) {
      const g = meshOf(THREE, ghostGeo, M.ghost, false);
      g.position.set(cellX(m.c, N), REST_Y + 0.01, cellZ(m.r, N));
      group.add(g);
      ghosts.push(g);
    }
  }

  function safeTurnAllowed() {
    try {
      return !!ctx.isLocalTurnAllowed();
    } catch {
      return false;
    }
  }

  // Full repaint from `board` (used by applyState + initial paint). Idempotent.
  function paint() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = board[r][c];
        if (v) setDisc(r, c, v, false);
        else removeDisc(r, c);
      }
    }
    updateCues();
    refreshGhosts();
  }

  // ---- Move application ------------------------------------------------------
  // Apply a VALIDATED move to logical + visual state, then advance the turn
  // (with auto-pass / game-over). This is the single commit path for local
  // clicks AND relayed moves so behaviour can never diverge.
  function commit(r, c, color, animate) {
    const flipped = flipsFor(board, r, c, color);
    board[r][c] = color;
    setDisc(r, c, color, animate);
    for (const [fr, fc] of flipped) {
      board[fr][fc] = color;
      setDisc(fr, fc, color, animate);
    }
    advanceTurn(color);
  }

  function advanceTurn(justMoved) {
    let next = other(justMoved);
    if (!hasMove(board, next)) {
      // `next` must pass. If the side that just moved also has no move, the game
      // is over; otherwise the same side moves again.
      if (!hasMove(board, justMoved)) {
        endGame();
        return;
      }
      next = justMoved;
    }
    turn = next;
    updateCues();
    refreshGhosts();
  }

  function endGame() {
    phase = "over";
    const b = count(board, "black");
    const w = count(board, "white");
    winner = b === w ? null : b > w ? "black" : "white";
    clearGhosts();
    updateCues();
    try {
      ctx.onGameOver({
        winner,
        reason: "no-moves",
        black: b,
        white: w,
      });
    } catch {
      /* never let a host callback crash play */
    }
  }

  // ---- Pointer (local move) --------------------------------------------------
  function onPointer(hit) {
    if (disposed || busy) return;
    if (phase !== "play" || role === "spectator" || myColor == null) return;
    if (turn !== myColor || !safeTurnAllowed()) return;
    const cell = hit && hit.cell;
    if (!cell) return;
    const { r, c } = cell;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    if (board[r][c] || flipsFor(board, r, c, myColor).length === 0) return;

    clearGhosts();
    commit(r, c, myColor, true);
    // Relay the delta to peers...
    try {
      ctx.net.sendMove({ type: "move", r, c });
    } catch {
      /* ignore */
    }
    // ...and, if we're authoritative, push the resulting snapshot so spectators
    // (and resyncing guests) converge.
    if (role === "host") pushSnapshot();
  }

  // ---- Relayed move (from the other player) ----------------------------------
  // The host receives the GUEST's move here (and the guest receives nothing, as
  // the host re-broadcasts authoritative state instead). We validate against the
  // CURRENT turn colour, never the local colour, then commit + (host) re-push.
  function applyMove(move) {
    if (!move || move.type !== "move") return true; // not ours; ignore, no resync
    if (phase !== "play") throw new GameDesync("reversi: relayed move while not in play");
    const { r, c } = move;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) {
      throw new GameDesync("reversi: relayed move out of range");
    }
    if (board[r][c] || flipsFor(board, r, c, turn).length === 0) {
      throw new GameDesync("reversi: illegal relayed move");
    }
    commit(r, c, turn, true);
    if (role === "host") pushSnapshot();
    return true;
  }

  // ---- Snapshots -------------------------------------------------------------
  function snapshot() {
    return {
      board: board.map((row) => row.slice()),
      turn,
      phase,
      winner,
    };
  }
  function publicState() {
    return snapshot();
  }
  function pushSnapshot() {
    if (role !== "host") return;
    const s = snapshot();
    try {
      ctx.net.sendState(s, s); // full + public are identical (full-info game)
    } catch {
      /* ignore */
    }
  }

  // Ingest authoritative board/turn/phase from the wire. NEVER touches the local
  // role/colour/facing. Idempotent: rebuilds purely from the snapshot.
  function applyState(state) {
    // Drop any in-flight animation; we snap to the authoritative layout.
    if (rafId && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    flips.length = 0;
    busy = false;

    if (!state) {
      board = initialBoard();
      turn = "black";
      phase = "play";
      winner = null;
    } else {
      const b = Array.from({ length: N }, () => Array(N).fill(null));
      const src = Array.isArray(state.board) ? state.board : [];
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const v = src[r] && src[r][c];
          if (v === "black" || v === "white") b[r][c] = v;
        }
      }
      board = b;
      turn = state.turn === "white" ? "white" : "black";
      phase = state.phase === "over" ? "over" : "play";
      winner = state.winner === "black" || state.winner === "white" ? state.winner : null;
    }
    paint();
  }

  // ---- Role / seat changes ---------------------------------------------------
  function setRole(r) {
    role = r || "spectator";
    myColor = role === "host" ? "black" : role === "guest" ? "white" : null;
    applyFacing(); // colour may flip -> re-derive the half-turn
    updateCues();
    refreshGhosts();
  }
  function setSeatRy(ry) {
    seatRy = ry;
    applyFacing();
    refreshGhosts();
  }

  // ---- Teardown --------------------------------------------------------------
  function dispose() {
    if (disposed) return; // idempotent; never double-free owned resources
    disposed = true;
    if (rafId && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafId);
    }
    rafId = 0;
    flips.length = 0;
    clearGhosts();
    if (group.parent) group.parent.remove(group);
    base.dispose();
    for (const o of owned) o.dispose?.();
    owned.length = 0;
  }

  // Initial render.
  paint();

  return {
    group,
    // We own per-seat facing (applyFacing). board.js must NOT also rotate us, or
    // the two transforms fight.
    orientPolicy: "self",
    applyState,
    applyMove,
    onPointer,
    publicState,
    setRole,
    setSeatRy,
    dispose,
  };
}

export default createGame;
