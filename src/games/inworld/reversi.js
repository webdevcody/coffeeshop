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
  // Whether ctx.onGameOver has already fired for the CURRENT over state. Gates
  // both the incremental endGame() path and the snapshot path in applyState so
  // the framework banner is pushed exactly once (and reset on a fresh game).
  let announced = false;

  // ---- Materials / geometry (module owns disposal) ---------------------------
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    frame: keep(standard(THREE, PALETTE.feltEdge, { roughness: 0.7 })),
    plank: keep(standard(THREE, PALETTE.felt, { roughness: 0.85 })),
    // Widen the checkerboard contrast: a deep felt for the dark squares vs the
    // brighter green light squares. The shipped pair (felt vs #28925e) were two
    // near-identical greens, so the 8×8 grid barely read and the black disc
    // vanished into the dark squares from a low seated angle.
    dark: keep(standard(THREE, "#15543a", { roughness: 0.85 })),
    light: keep(standard(THREE, "#2fa169", { roughness: 0.85 })),
    // The two sides MUST read as clearly distinct materials. The black disc gets a
    // faint cool emissive so it catches light and stays legible against the dark
    // felt squares from either seat (per-seat facing changes the light direction).
    black: keep(standard(THREE, PALETTE.discBlack, {
      roughness: 0.42,
      metalness: 0.12,
      emissive: "#243a31",
      emissiveIntensity: 0.45,
    })),
    // White disc carries a warm emissive COLOUR but at intensity 0, so it reads as
    // a plain matte disc normally; the win flourish ramps the intensity up so the
    // winner's glow is actually visible (a black emissive colour × any intensity is
    // still black, so the colour must be non-black for the flourish to show).
    white: keep(standard(THREE, PALETTE.discWhite, {
      roughness: 0.45,
      metalness: 0.05,
      emissive: "#fff4d8",
      emissiveIntensity: 0,
    })),
    ghost: keep(standard(THREE, PALETTE.accent, {
      emissive: PALETTE.accent,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })),
    // Translucent hover preview of the local player's disc (re-tinted on role
    // change). Decorative: raycast disabled where it's used so the userData.cell
    // colliders always win the hit-test.
    hoverBlack: keep(standard(THREE, PALETTE.discBlack, {
      emissive: PALETTE.accent,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      roughness: 0.42,
    })),
    hoverWhite: keep(standard(THREE, PALETTE.discWhite, {
      emissive: PALETTE.accent,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      roughness: 0.45,
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
  // Lift discs a hair off the tile top: REST_Y is the tile surface and the disc's
  // underside (centre - DISC_T/2) would otherwise be coplanar with it, shimmering
  // at grazing seated angles. A sub-mm bump removes the z-fight with no visible gap.
  const DISC_LIFT = 0.0008;
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

  // Ease-in-out quad: removes the constant-velocity mechanical feel of the spin.
  const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  // Ease-out cubic: a settling "drop" for a newly-placed disc.
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);

  // ---- Animation loop (capture flips + place settle + win flourish) ----------
  // A single rAF loop drives every time-based visual. Each entry is one of:
  //   { kind:"flip",  mesh, t, dur, to, swapped }   capture spin + colour swap
  //   { kind:"place", mesh, t, dur }                drop/settle of the new disc
  // The win flourish runs separately (`flourish`) but shares this loop so it
  // works even where the framework's update() pump is absent. NONE of these
  // touch board/turn/phase/winner — applyState remains the sole state authority.
  const anims = [];
  let rafId = 0;
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let lastT = 0;
  function loopActive() {
    return anims.length > 0 || flourish.active;
  }
  function startLoop() {
    if (rafId || disposed || typeof requestAnimationFrame === "undefined") return;
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
    for (let i = anims.length - 1; i >= 0; i--) {
      const f = anims[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      if (f.kind === "flip") {
        const e = easeInOut(k);
        f.mesh.rotation.x = e * Math.PI;
        if (k >= 0.5 && !f.swapped) {
          f.swapped = true;
          f.mesh.material = f.to === "black" ? M.black : M.white;
        }
        // A brief 1.0→~1.08→1.0 scale blip around the colour-swap beat for a
        // satisfying "flip" pop (reused scalar, no per-frame allocation).
        const pop = 1 + 0.08 * Math.sin(Math.min(1, Math.max(0, (k - 0.4) / 0.4)) * Math.PI);
        f.mesh.scale.set(pop, 1, pop);
        if (k >= 1) {
          f.mesh.rotation.x = 0;
          f.mesh.scale.set(1, 1, 1);
          anims.splice(i, 1);
        }
      } else if (f.kind === "place") {
        // Scale-in from a flat disc plus a tiny ease-out drop so the disc settles
        // onto the board instead of popping into existence.
        const e = easeOut(k);
        const s = 0.6 + 0.4 * e;
        f.mesh.scale.set(s, s, s);
        f.mesh.position.y = f.restY + (1 - e) * (DISC_T * 1.6);
        if (k >= 1) {
          f.mesh.scale.set(1, 1, 1);
          f.mesh.position.y = f.restY;
          anims.splice(i, 1);
        }
      }
    }
    if (flourish.active) stepFlourish(dt);
    if (!anims.length) busy = false;
  }

  const discRestY = REST_Y + DISC_T / 2 + DISC_LIFT;

  function ensureDisc(r, c, color) {
    let d = discs[r][c];
    if (!d) {
      d = meshOf(THREE, discGeo, color === "black" ? M.black : M.white);
      d.position.set(cellX(c, N), discRestY, cellZ(r, N));
      group.add(d);
      discs[r][c] = d;
    }
    return d;
  }

  // animate: false = snap; "flip" = capture spin; "place" = drop/settle.
  function setDisc(r, c, color, animate) {
    const fresh = !discs[r][c];
    const d = ensureDisc(r, c, color);
    const canAnim = animate && typeof requestAnimationFrame !== "undefined";
    if (canAnim && animate === "flip") {
      anims.push({ kind: "flip", mesh: d, t: 0, dur: 0.3, to: color, swapped: false });
      busy = true;
      startLoop();
    } else if (canAnim && animate === "place" && fresh) {
      d.material = color === "black" ? M.black : M.white;
      d.rotation.x = 0;
      d.scale.set(0.6, 1, 0.6);
      d.position.y = discRestY + DISC_T * 1.6;
      anims.push({ kind: "place", mesh: d, t: 0, dur: 0.14, restY: discRestY });
      busy = true;
      startLoop();
    } else {
      // Snap (headless / non-rAF / re-paint): swap material and clear any
      // transient transform so input is never gated by a loop that can't run.
      d.material = color === "black" ? M.black : M.white;
      d.rotation.x = 0;
      d.scale.set(1, 1, 1);
      d.position.y = discRestY;
    }
  }

  function removeDisc(r, c) {
    const d = discs[r][c];
    if (d) {
      group.remove(d);
      discs[r][c] = null;
    }
  }

  // ---- Win flourish ----------------------------------------------------------
  // A purely-visual emissive-glow ramp across the winner's discs after the game
  // ends. Drives off the same rAF loop; never writes game state. `boost` rides on
  // TOP of the disc's base emissiveIntensity so the shared material is restored
  // cleanly when the flourish finishes (or is cancelled by dispose/applyState).
  const flourish = { active: false, t: 0, dur: 1.0, color: null };
  const BLACK_EMISSIVE = M.black.emissiveIntensity; // 0.45 base (legibility glow)
  const WHITE_EMISSIVE = M.white.emissiveIntensity; // 0 base
  function resetFlourishEmissive() {
    M.black.emissiveIntensity = BLACK_EMISSIVE;
    M.white.emissiveIntensity = WHITE_EMISSIVE;
  }
  function startFlourish(color) {
    if (!color || typeof requestAnimationFrame === "undefined") return;
    flourish.active = true;
    flourish.t = 0;
    flourish.color = color;
    startLoop();
  }
  function stepFlourish(dt) {
    flourish.t += dt;
    const k = Math.min(1, flourish.t / flourish.dur);
    // Two-bump glow that eases back to the base emissive.
    const glow = Math.sin(k * Math.PI) * 0.6;
    const mat = flourish.color === "black" ? M.black : M.white;
    const base = flourish.color === "black" ? BLACK_EMISSIVE : WHITE_EMISSIVE;
    // Keep the OTHER side at its base so contrast is preserved.
    resetFlourishEmissive();
    mat.emissiveIntensity = base + glow;
    if (k >= 1) {
      flourish.active = false;
      flourish.color = null;
      resetFlourishEmissive();
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
      hideHover();
      return;
    }
    for (const m of legalMoves(board, myColor)) {
      const g = meshOf(THREE, ghostGeo, M.ghost, false);
      // Decorative marker: NEVER let it intercept the board ray. It sits between
      // the tiles and the userData.cell colliders, so without this a click landing
      // on a legal-move dot returned the ghost as hit.object and (orientPolicy
      // "self" → no geometric fallback) silently failed to resolve a cell.
      g.raycast = () => {};
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

  // ---- Hover preview ---------------------------------------------------------
  // One re-used translucent disc in the LOCAL player's colour, shown only when the
  // cursor is over a cell that is ACTUALLY legal for them (own turn, empty, has
  // flips). hitToCell records the precise {r,c} for this hover raycast; setHover
  // (called by the framework right after) positions the preview. Decorative:
  // raycast disabled so the userData.cell colliders always win the hit-test.
  const hoverDisc = meshOf(THREE, discGeo, M.hoverBlack, false);
  hoverDisc.raycast = () => {};
  hoverDisc.visible = false;
  hoverDisc.position.y = REST_Y + DISC_T / 2 + 0.012;
  group.add(hoverDisc);
  let hoverCell = null;   // last {r,c} resolved by hitToCell, or null on a miss
  let hoverPulse = 0;

  function retintHover() {
    hoverDisc.material = myColor === "white" ? M.hoverWhite : M.hoverBlack;
  }
  retintHover();

  function hideHover() {
    hoverDisc.visible = false;
    hoverCell = null;
  }

  // Is (r,c) a legal placement for the local player right now?
  function canPlay(r, c) {
    return (
      myColor != null &&
      phase === "play" &&
      turn === myColor &&
      r >= 0 && r < N && c >= 0 && c < N &&
      !board[r][c] &&
      flipsFor(board, r, c, myColor).length > 0 &&
      safeTurnAllowed()
    );
  }

  function showHoverAt(r, c) {
    if (!canPlay(r, c)) {
      hoverDisc.visible = false;
      return;
    }
    hoverDisc.position.set(cellX(c, N), REST_Y + DISC_T / 2 + 0.012, cellZ(r, N));
    hoverDisc.visible = true;
  }

  // Our own hit-test, used by BOTH the framework's click resolver (Tier 1) and the
  // hover path. We resolve ONLY through the per-cell userData.cell colliders that
  // buildGridBoard tags (the orientation-safe contract for this self-oriented
  // module) — exactly the mapping board.js's Tier-2 walk used before. We do NOT
  // add a geometric fallback: board.js intentionally returns null there for
  // orientPolicy:"self" modules, and the colliders already cover all 64 cells, so
  // a click/hover off the grid correctly resolves to nothing rather than a guess.
  function hitToCell(hit) {
    let node = hit && hit.object;
    while (node) {
      if (node.userData && node.userData.cell) {
        hoverCell = { r: node.userData.cell.r, c: node.userData.cell.c };
        return hoverCell;
      }
      node = node.parent;
    }
    hoverCell = null;
    return null;
  }

  function setHover(x) {
    if (disposed) return;
    if (x === -1 || x == null || hoverCell == null) {
      hideHover();
      return;
    }
    showHoverAt(hoverCell.r, hoverCell.c);
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
    hideHover();
  }

  // ---- Move application ------------------------------------------------------
  // Apply a VALIDATED move to logical + visual state, then advance the turn
  // (with auto-pass / game-over). This is the single commit path for local
  // clicks AND relayed moves so behaviour can never diverge.
  function commit(r, c, color, animate) {
    const flipped = flipsFor(board, r, c, color);
    board[r][c] = color;
    // The newly-placed disc is created already in its final colour, so it never
    // flips — only the CAPTURED discs play the flip-spin (flips carry meaning).
    // The fresh disc gets a small drop/settle so it doesn't pop into existence.
    setDisc(r, c, color, animate ? "place" : false);
    for (const [fr, fc] of flipped) {
      board[fr][fc] = color;
      setDisc(fr, fc, color, animate ? "flip" : false);
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
    hideHover();
    updateCues();
    if (winner) startFlourish(winner); // purely-visual winner glow; no state write
    announceOver();
  }

  // Fire ctx.onGameOver exactly once per over state. Called by BOTH the
  // incremental endGame() path AND applyState when a terminal snapshot lands
  // without us having played the deciding move (resync / late join / a relayed
  // last move dropped by board.js's hydration/resync gating). Guarded by
  // `announced`, which applyState resets whenever it ingests a live/reset state.
  function announceOver() {
    if (announced) return;
    announced = true;
    try {
      ctx.onGameOver({
        winner,
        reason: "no-moves",
        black: count(board, "black"),
        white: count(board, "white"),
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
    hideHover();
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
  // Both the host (receiving the guest's move) and the guest (receiving the
  // host's move) commit relayed deltas here; we always validate against the
  // CURRENT `turn` colour, never the local colour, so the path is symmetric.
  // The host additionally re-pushes an authoritative snapshot.
  function applyMove(move, byRole) {
    // A payload we don't recognise is a no-op that does NOT mark the move
    // consumed (matches gomoku/connect4) — returning true would falsely claim we
    // handled a packet we ignored.
    if (!move || move.type !== "move") return false;
    if (phase !== "play") throw new GameDesync("reversi: relayed move while not in play");
    const { r, c } = move;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) {
      throw new GameDesync("reversi: relayed move out of range");
    }
    // Cross-check the SENDER's identity (host=black, guest=white) against whose
    // turn it logically is. A mis-stamped / out-of-turn / duplicated relayed move
    // (e.g. a guest move racing the host's turn-flip) would otherwise be committed
    // in the WRONG colour with no desync — corrupting the authoritative state the
    // host then re-broadcasts. Routing through GameDesync triggers a resync.
    const moverColor = byRole === "host" ? "black" : byRole === "guest" ? "white" : null;
    if (moverColor != null && moverColor !== turn) {
      throw new GameDesync("reversi: wrong mover");
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
    // Drop any in-flight animation; we snap to the authoritative layout. paint()
    // below calls setDisc(...,false) for every occupied cell, which resets each
    // disc's rotation/scale/y, so a mid-flip/mid-place mesh is cleaned up. Also
    // restore the flourish emissive in case a snapshot lands mid-flourish.
    if (rafId && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    anims.length = 0;
    flourish.active = false;
    flourish.color = null;
    resetFlourishEmissive();
    busy = false;

    if (!state) {
      board = initialBoard();
      turn = "black";
      phase = "play";
      winner = null;
      announced = false; // fresh game: re-arm the game-over announcement
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
      // A live (non-over) snapshot re-arms the announcement so a subsequent
      // over state — incremental or snapshot — fires the banner exactly once.
      if (phase !== "over") announced = false;
    }
    // Reconcile a pass/game-over position the snapshot may not have advanced:
    // if the side to move has no legal move, auto-pass to the opponent, or end
    // the game when neither side can move. Keeps turn/phase consistent so the
    // local player isn't left stuck on an unplayable turn.
    if (phase === "play") {
      if (!hasMove(board, turn)) {
        if (!hasMove(board, other(turn))) {
          endGame(); // sets phase="over", winner, and announces once
        } else {
          turn = other(turn);
        }
      }
    } else {
      // The wire already says the game is over (e.g. a guest that joins/resyncs
      // after the finish, or whose relayed last move was dropped by board.js's
      // gating so only the terminal snapshot reached it). The incremental
      // endGame() path never ran here, so announce the game-over now — once.
      announceOver();
    }
    paint();
  }

  // ---- Per-frame pump (framework-driven) -------------------------------------
  // Only a gentle hover-preview pulse so the affordance reads as "live". The
  // capture flip / place settle / win flourish run on the module's own rAF loop
  // (they must animate even where the framework's update pump is absent), so this
  // stays cheap and allocation-free. Never writes game state.
  function update(dt) {
    if (disposed || !hoverDisc.visible) return;
    hoverPulse += dt || 0.016;
    const base = myColor === "white" ? 0.6 : 0.55;
    hoverDisc.material.opacity = base + 0.12 * (0.5 + 0.5 * Math.sin(hoverPulse * 4));
  }

  // ---- Role / seat changes ---------------------------------------------------
  function setRole(r) {
    role = r || "spectator";
    myColor = role === "host" ? "black" : role === "guest" ? "white" : null;
    applyFacing(); // colour may flip -> re-derive the half-turn
    retintHover(); // preview must match the (possibly new) local colour
    hideHover();
    updateCues();
    refreshGhosts();
  }
  function setSeatRy(ry) {
    seatRy = ry;
    applyFacing();
    hideHover();
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
    anims.length = 0;
    flourish.active = false;
    flourish.color = null;
    resetFlourishEmissive(); // restore shared materials before a possible reuse
    clearGhosts();
    hideHover();
    group.remove(hoverDisc);
    // Detach + null any live disc meshes so a reparented/reused group can't
    // reference disposed (shared) materials or stale meshes. Reset any transient
    // flip/place transform first so a reused mesh never starts half-rotated/scaled.
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const d = discs[r][c];
        if (d) {
          d.rotation.x = 0;
          d.scale.set(1, 1, 1);
          group.remove(d);
          discs[r][c] = null;
        }
      }
    }
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
    hitToCell, // own hit-test (records the hovered cell for the preview)
    setHover,  // your-turn hover preview of the move under the cursor
    update,    // gentle hover-preview pulse
    setRole,
    setSeatRy,
    dispose,
  };
}

export default createGame;
