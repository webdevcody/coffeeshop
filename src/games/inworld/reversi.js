// Reversi / Othello — in-world 3D module (createGame contract). 8×8, full-info.
// Host = black (moves first), guest = white. Discs flip black↔white on capture.
// Turn may auto-pass when a side has no legal move; game ends when neither can.

import { GameDesync, orientFor } from "./createGame.js";
import { PALETTE, meshOf, standard, discGeometry, buildGridBoard, cellX, cellZ } from "./pieces.js";

const N = 8;
const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
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

function flipsFor(board, r, c, color) {
  if (board[r][c]) return [];
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === other(color)) {
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
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (!board[r][c] && flipsFor(board, r, c, color).length) out.push({ r, c });
  return out;
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
  group.userData.gridN = N;

  let role = ctx.role;
  let seatRy = ctx.seatRy;
  let myColor = role === "host" ? "black" : role === "guest" ? "white" : null;

  // ---- Orientation --------------------------------------------------------
  // Cues/home edges are authored in ONE canonical frame: black home on the -Z
  // edge, white home on the +Z edge. The framework's default "flat" policy would
  // rotate our group by orientFor(seatRy), which brings the canonical -Z (black)
  // edge to WHOEVER is looking — so the guest (white, +Z home) would see the
  // BLACK edge near and their own white home + lit identity bar on the FAR edge.
  // We instead give each player their own colour near (matching chess/checkers on
  // the same table): declare orientPolicy:"self" so board.js does NOT rotate us,
  // and rotate the group ourselves by
  //   orientFor(seatRy) + (myColor === "white" ? PI : 0)
  // orientFor(seatRy) brings the -Z (black) home near; the extra PI for white
  // flips the +Z (white) home near instead. Othello play is symmetric, so clicks
  // still resolve to the same canonical cell via the colliders that rotate WITH
  // the group. Spectators (myColor null, seatRy null) get the canonical view.
  function applyFacing() {
    const extra = myColor === "white" ? Math.PI : 0;
    group.rotation.y = orientFor(seatRy) + extra;
  }
  applyFacing();

  let board = initialBoard();
  let turn = "black";
  let phase = "play";
  let winner = null;

  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    frame: keep(standard(THREE, PALETTE.feltEdge, { roughness: 0.7 })),
    plank: keep(standard(THREE, PALETTE.felt, { roughness: 0.85 })),
    dark: keep(standard(THREE, PALETTE.felt, { roughness: 0.85 })),
    light: keep(standard(THREE, "#28925e", { roughness: 0.85 })),
    black: keep(standard(THREE, PALETTE.discBlack, { roughness: 0.5 })),
    white: keep(standard(THREE, PALETTE.discWhite, { roughness: 0.5 })),
    ghost: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.5, transparent: true, opacity: 0.45, depthWrite: false })),
    // Persistent identity / turn cues: a home-edge tint bar + turn lamp per side,
    // each in that side's disc colour, with its OWN material instance so the local
    // player's bar/lamp can be lit independently of the opponent's.
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

  // --- Identity / turn cues -------------------------------------------------
  // Per side: a home-edge tint bar (in that side's disc colour) on the long frame
  // rail, plus a turn lamp beside it. Authored in the CANONICAL frame — black
  // home on the -Z edge, white home on the +Z edge — so once applyFacing() rotates
  // the whole group by orientFor(seatRy) + (white ? PI : 0) each client's OWN home
  // edge faces them. The local player's bar glows steadily ("this near side, in my
  // colour, is me"); the side-to-move's lamp glows (brighter when it's MY turn) so
  // it's unambiguous whose turn it is even when it's not mine.
  const cue = { black: { bar: null, lamp: null }, white: { bar: null, lamp: null } };
  {
    const HALF = STEP * (N / 2);                 // = BOARD_HALF
    const frameW = 0.03, frameH = 0.012;
    const railTop = base.tileTop + frameH;        // roughly the proud frame top
    const edge = HALF + frameW / 2;               // centre of a long frame rail
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

  // Drive the identity/turn cue emissives. Called on every state/turn/role/seat
  // change. NEVER reads colour from the wire — purely from local `myColor`/`turn`.
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

  // One reusable disc mesh per cell; color via material swap + flip animation.
  const discs = Array.from({ length: N }, () => Array(N).fill(null));
  const ghosts = [];
  let busy = false;
  let disposed = false;

  // --- animation ---
  const flips = []; // { mesh, t, dur, to }
  let rafId = 0;
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let lastT = 0;
  function loopActive() {
    return flips.length > 0;
  }
  function startLoop() {
    if (rafId || disposed) return;
    lastT = nowMs();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
      lastT = t;
      step(dt);
      rafId = loopActive() && !disposed ? requestAnimationFrame(tick) : 0;
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

  function clearGhosts() {
    for (const g of ghosts) group.remove(g);
    ghosts.length = 0;
  }
  function refreshGhosts() {
    updateCues();
    clearGhosts();
    if (phase !== "play" || role === "spectator" || turn !== myColor || !ctx.isLocalTurnAllowed()) return;
    for (const m of legalMoves(board, myColor)) {
      const g = meshOf(THREE, ghostGeo, M.ghost, false);
      g.position.set(cellX(m.c, N), REST_Y + 0.01, cellZ(m.r, N));
      group.add(g);
      ghosts.push(g);
    }
  }

  function paint(animate) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = board[r][c];
        if (v) setDisc(r, c, v, false);
        else if (discs[r][c]) {
          group.remove(discs[r][c]);
          discs[r][c] = null;
        }
      }
    }
    refreshGhosts();
  }

  // Apply a validated move locally: place + flip + advance turn (with auto-pass).
  function performMove(r, c, color, animate) {
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
    if (legalMoves(board, next).length === 0) {
      // pass; if neither can move, game over.
      if (legalMoves(board, justMoved).length === 0) {
        phase = "over";
        const b = count(board, "black"), w = count(board, "white");
        winner = b === w ? null : b > w ? "black" : "white";
        clearGhosts();
        updateCues();
        try { ctx.onGameOver({ winner, reason: "no-moves" }); } catch { /* */ }
        return;
      }
      next = justMoved; // opponent passes
    }
    turn = next;
    refreshGhosts();
  }

  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed() || busy) return;
    if (phase !== "play" || turn !== myColor) return;
    const cell = hit && hit.cell;
    if (!cell) return;
    const { r, c } = cell;
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    if (board[r][c] || flipsFor(board, r, c, myColor).length === 0) return;
    clearGhosts();
    performMove(r, c, myColor, true);
    try { ctx.net.sendMove({ type: "move", r, c }); } catch { /* */ }
    if (role === "host") pushSnapshot();
  }

  function applyMove(move) {
    if (phase !== "play") throw new GameDesync("reversi: not in play");
    if (!move || move.type !== "move") return false;
    const { r, c } = move;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
    if (board[r][c] || flipsFor(board, r, c, turn).length === 0)
      throw new GameDesync("reversi: illegal relayed move");
    performMove(r, c, turn, true);
    return true;
  }

  function snapshot() {
    return { board: board.map((row) => row.slice()), turn, phase, winner };
  }
  function publicState() { return snapshot(); }
  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  function applyState(state) {
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
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const v = src[r] && src[r][c];
          if (v === "black" || v === "white") b[r][c] = v;
        }
      board = b;
      turn = state.turn === "white" ? "white" : "black";
      phase = state.phase === "over" ? "over" : "play";
      winner = state.winner === "black" || state.winner === "white" ? state.winner : null;
    }
    paint(false);
  }

  function setRole(r) {
    role = r || "spectator";
    myColor = role === "host" ? "black" : role === "guest" ? "white" : null;
    applyFacing();             // colour may have changed -> re-derive the half-turn
    refreshGhosts();
  }
  function setSeatRy(ry) {
    seatRy = ry;
    applyFacing();             // re-face the board for the new seat ourselves
    refreshGhosts();
  }

  function dispose() {
    if (disposed) return; // idempotent: never double-free owned geometries/materials
    disposed = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    flips.length = 0;
    clearGhosts();
    if (group.parent) group.parent.remove(group);
    base.dispose();
    // discGeo + ghostGeo are already in `owned` (via keep), so disposing `owned`
    // alone frees every minted geometry/material exactly once.
    for (const o of owned) o.dispose?.();
    owned.length = 0;
  }

  paint(false);

  return {
    group,
    // We own our own per-seat facing (applyFacing): orientFor(seatRy) plus a PI
    // half-turn for white so each player sees their OWN home edge near. board.js
    // must NOT also rotate the group, or the two would fight.
    orientPolicy: "self",
    applyState, applyMove, onPointer, publicState, setRole, setSeatRy, dispose,
  };
}

export default createGame;
