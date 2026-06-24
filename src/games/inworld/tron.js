// Light Cycles (Tron) — in-world 3D module (createGame contract). REAL-TIME,
// host-authoritative LOCKSTEP grid. Host ticks the sim every TICK_MS and streams a
// full grid snapshot; guests send only steering intent ({turn}); spectators only
// watch. No interpolation — discrete cells render exactly as the authoritative
// grid says. Best-of-5, first to WIN_SCORE=3 rounds takes the match.
//
// Candidate #1 design notes (distinct approach vs. the original):
//   * ORIENTATION: cycles spawn on the NEAR/FAR (row / canonical Z) axis instead
//     of left/right. board.js uses the default FLAT orientPolicy and rotates this
//     group by orientFor(seatRy) so canonical row 0 (-Z) lands nearest whoever is
//     looking. Host's cycle (seat 0) spawns at the NEAR edge (row 0), guest's
//     (seat 1) at the FAR edge (last row). Under the host's rotation (ry≈0) the
//     host's own cycle is nearest; under the guest's rotation (ry≈PI) the board
//     flips so the guest's own cycle (far in canonical space) is nearest THEM. So
//     each seated player genuinely has their OWN side nearest, opponent across —
//     with NO per-state recomputation of identity.
//   * IDENTITY: the local side is derived ONCE from role and never re-read off the
//     wire. The two cycles use clearly distinct colours (cyan vs orange), the
//     LOCAL cycle gets a brighter head + a pulsing halo + a glowing home strip on
//     its own near edge.
//   * STEERING is buffered to the tick boundary (at most one turn per cycle per
//     tick) and a 180° reversal is rejected, so no instant in-place flip.
//   * In-world status: a countdown banner, per-side score pips, and a round/match
//     winner banner — all driven from the synced snapshot, so guests & spectators
//     read the same cues as the host.

import { BOARD_SIZE, PALETTE, meshOf, standard } from "./pieces.js";
import { orientFor } from "./createGame.js";

// Near-square arena so the 90° side-chair rotations still frame cleanly. Rows run
// along the canonical near/far (Z) axis; cols along left/right (X).
const COLS = 30, ROWS = 30;
const TICK_MS = 90;
const WIN_SCORE = 3;
const COUNTDOWN = 3;
const COUNTDOWN_STEP_MS = 750;
const ROUND_GAP_MS = 1900;
// dirs: 0=toward -Z (near), 1=+X (right), 2=+Z (far), 3=-X (left)
const DV = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const turnLeft = (d) => (d + 3) % 4;
const turnRight = (d) => (d + 1) % 4;
const reverse = (d) => (d + 2) % 4;

function makeArena() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
}

// Spawns on the NEAR/FAR axis: seat 0 (host) hugs the near edge driving toward the
// far edge (+Z, dir 2); seat 1 (guest) hugs the far edge driving toward near (-Z,
// dir 0). Centred on X so both have symmetric room.
const SPAWN = [
  { x: Math.floor(COLS / 2), y: 4, dir: 2, colorIdx: 0 },
  { x: Math.floor(COLS / 2), y: ROWS - 5, dir: 0, colorIdx: 1 },
];
function spawnCycles() {
  return SPAWN.map((s) => ({ x: s.x, y: s.y, dir: s.dir, alive: true, colorIdx: s.colorIdx }));
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "tron";

  let role = ctx.role;
  const isHost = role === "host";

  // Per-viewer seat facing. board.js (FLAT policy — no orientPolicy declared)
  // rotates THIS group by orientFor(seatRy) so the arena turns to face whoever is
  // looking. We retain seatRy only so an in-place re-seat (setSeatRy) keeps in
  // step; the arena + cues are authored in the canonical frame and the framework
  // applies the rotation.
  let seatRy = ctx.seatRy;

  // COLOR/SIDE DERIVATION (canonical convention §2). Derived ONCE from ROLE and
  // NEVER recomputed inside applyState() — host = cycle 0 (cyan, near edge, moves
  // first/COLOR_A), guest = cycle 1 (orange, far edge, COLOR_B), spectator = null
  // (read-only). A relayed snapshot can never flip the local player's colour/side.
  const mySeat = role === "host" ? 0 : role === "guest" ? 1 : null;
  const myColorIdx = mySeat;

  // ---- authoritative / mirrored game state ----
  let grid = makeArena();
  let cycles = spawnCycles();
  let scores = [0, 0];
  let round = 1;
  let phase = "countdown"; // countdown|playing|roundover|matchover
  let countdown = COUNTDOWN;
  let roundWinner = null;   // 0|1|null(draw)
  let matchWinner = null;   // 0|1|null

  // host timers
  let tickAcc = 0;
  let countdownAcc = 0;
  let gapAcc = 0;
  const pendingTurn = [null, null];

  // ---- input — gated to a SEATED, non-spectator local player only (§4) ----
  // Real-time, so there is no turn alternation, but a spectator / unseated /
  // finished viewer must never steer. isLocalTurnAllowed() (board.js) confirms
  // we're seated at this table and the match isn't over.
  const onKeyDown = (e) => {
    if (role === "spectator" || mySeat == null) return;
    try { if (ctx.isLocalTurnAllowed && !ctx.isLocalTurnAllowed()) return; } catch { /* */ }
    let t = null;
    if (e.code === "ArrowLeft" || e.code === "KeyA") t = "left";
    else if (e.code === "ArrowRight" || e.code === "KeyD") t = "right";
    if (!t) return;
    // Steering is relative to the LOCAL player's own forward view. The board is
    // rotated to face this seat, but left/right of the cycle's heading are
    // invariant under that rotation (a 90°/180° board spin maps screen-left to
    // the cycle's canonical left consistently), so "left" => turnLeft is correct
    // for both seats. We buffer (host) or stream the intent (guest).
    e.preventDefault?.();
    if (isHost) hostTurn(0, t);
    else { try { ctx.net.sendInput({ turn: t }); } catch { /* */ } }
  };
  window.addEventListener("keydown", onKeyDown);

  // ---- geometry / materials ----
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const COLORS = [PALETTE.tron0, PALETTE.tron1];
  const myColor = myColorIdx != null ? COLORS[myColorIdx] : null;

  const M = {
    floor: keep(standard(THREE, "#081c2e", { roughness: 0.7 })),
    // Two CLEARLY DISTINCT trail materials: cyan (tron0) vs orange (tron1).
    t0: keep(standard(THREE, COLORS[0], { emissive: COLORS[0], emissiveIntensity: 0.55 })),
    t1: keep(standard(THREE, COLORS[1], { emissive: COLORS[1], emissiveIntensity: 0.55 })),
    head0: keep(standard(THREE, "#bff7ff", { emissive: COLORS[0], emissiveIntensity: 0.9 })),
    head1: keep(standard(THREE, "#ffe0c0", { emissive: COLORS[1], emissiveIntensity: 0.9 })),
    // IDENTITY CUE: the LOCAL cycle's head out-glows the opponent's; halo + home
    // strip in the local colour. Spectators get none (myColor == null).
    myHead: myColor ? keep(standard(THREE, "#ffffff", { emissive: myColor, emissiveIntensity: 1.8 })) : null,
    mine: myColor ? keep(standard(THREE, myColor, { emissive: myColor, emissiveIntensity: 0.9, transparent: true, opacity: 0.5, depthWrite: false })) : null,
    grid: keep(standard(THREE, "#0f2a40", { roughness: 0.85 })),
  };

  const AW = BOARD_SIZE * 0.94, AH = AW * (ROWS / COLS);
  const cw = AW / COLS, chh = AH / ROWS;
  const plankH = 0.016;
  const floor = meshOf(THREE, keep(new THREE.BoxGeometry(AW + 0.03, plankH, AH + 0.03)), M.floor);
  floor.position.y = plankH / 2;
  group.add(floor);
  const TOP = plankH;
  const gx = (x) => -AW / 2 + (x + 0.5) * cw;
  const gz = (y) => -AH / 2 + (y + 0.5) * chh;

  const cellGeo = keep(new THREE.BoxGeometry(cw * 0.92, 0.012, chh * 0.92));
  const headGeo = keep(new THREE.BoxGeometry(cw * 0.98, 0.022, chh * 0.98));

  // pool of trail meshes keyed by "x,y"
  const trailMeshes = new Map();

  // IDENTITY CUE: the LOCAL cycle's head uses the brighter myHead material.
  const headMeshes = [
    meshOf(THREE, headGeo, myColorIdx === 0 && M.myHead ? M.myHead : M.head0),
    meshOf(THREE, headGeo, myColorIdx === 1 && M.myHead ? M.myHead : M.head1),
  ];
  for (const h of headMeshes) { h.position.y = TOP + 0.014; group.add(h); }

  // IDENTITY CUE: a soft halo that tracks the local cycle, plus a glowing home
  // strip across the local player's own SPAWN edge (near edge after rotation).
  let myHalo = null, myHomeStrip = null;
  if (M.mine && myColorIdx != null) {
    const haloGeo = keep(new THREE.BoxGeometry(cw * 2.6, 0.002, chh * 2.6));
    myHalo = meshOf(THREE, haloGeo, M.mine, false);
    myHalo.position.y = TOP + 0.006;
    group.add(myHalo);
    const spawn = SPAWN[myColorIdx];
    const stripGeo = keep(new THREE.BoxGeometry(AW * 0.96, 0.002, chh * 1.8));
    myHomeStrip = meshOf(THREE, stripGeo, M.mine, false);
    myHomeStrip.position.set(0, TOP + 0.004, gz(spawn.y));
    group.add(myHomeStrip);
  }

  // ---- in-world status banner (countdown / round / winner) ----
  // A canvas-textured sprite rendered above the arena centre. Driven entirely by
  // the synced snapshot so host, guests, and spectators all read the same cue.
  let bannerTex = null, bannerMat = null, bannerSprite = null, bannerCanvas = null, bannerCtx = null;
  let lastBannerText = "";
  (function buildBanner() {
    if (typeof document === "undefined") return; // headless guard
    try {
      bannerCanvas = document.createElement("canvas");
      bannerCanvas.width = 512; bannerCanvas.height = 128;
      bannerCtx = bannerCanvas.getContext("2d");
      bannerTex = new THREE.CanvasTexture(bannerCanvas);
      if ("colorSpace" in bannerTex && THREE.SRGBColorSpace) bannerTex.colorSpace = THREE.SRGBColorSpace;
      owned.push(bannerTex);
      bannerMat = new THREE.SpriteMaterial({ map: bannerTex, transparent: true, depthTest: false, depthWrite: false });
      owned.push(bannerMat);
      bannerSprite = new THREE.Sprite(bannerMat);
      bannerSprite.position.set(0, TOP + 0.16, 0);
      bannerSprite.scale.set(AW * 0.7, AW * 0.7 * (128 / 512), 1);
      bannerSprite.renderOrder = 999;
      group.add(bannerSprite);
    } catch { bannerSprite = null; }
  })();

  function drawBanner(text, color) {
    if (!bannerCtx || !bannerTex) return;
    const c = bannerCtx;
    c.clearRect(0, 0, bannerCanvas.width, bannerCanvas.height);
    if (text) {
      c.font = "bold 84px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = 10;
      c.strokeStyle = "rgba(0,0,0,0.85)";
      c.strokeText(text, 256, 64);
      c.fillStyle = color || "#ffffff";
      c.fillText(text, 256, 64);
    }
    bannerTex.needsUpdate = true;
  }

  function bannerFor() {
    // Returns { text, color }. From the LOCAL player's perspective where relevant.
    if (phase === "countdown") {
      return { text: countdown > 0 ? String(countdown) : "GO", color: "#ffffff" };
    }
    if (phase === "roundover") {
      if (roundWinner == null) return { text: "DRAW", color: "#ffd166" };
      const won = myColorIdx != null && roundWinner === myColorIdx;
      return {
        text: myColorIdx == null
          ? `${roundWinner === 0 ? "CYAN" : "ORANGE"} WINS ROUND`
          : (won ? "ROUND: YOU WIN" : "ROUND: YOU LOSE"),
        color: roundWinner === 0 ? COLORS[0] : COLORS[1],
      };
    }
    if (phase === "matchover") {
      const w = matchWinner;
      if (w == null) return { text: "MATCH OVER", color: "#ffd166" };
      const won = myColorIdx != null && w === myColorIdx;
      return {
        text: myColorIdx == null
          ? `${w === 0 ? "CYAN" : "ORANGE"} WINS!`
          : (won ? "YOU WIN!" : "YOU LOSE"),
        color: w === 0 ? COLORS[0] : COLORS[1],
      };
    }
    return { text: "", color: "#ffffff" };
  }

  // ---- score pips ----
  // Small glowing pips on each side edge: cyan near the near edge, orange near the
  // far edge, lit up to the round count so the running best-of is readable in-world.
  const pipGeo = keep(new THREE.BoxGeometry(cw * 0.9, 0.01, chh * 0.9));
  const pipOnMat = [
    keep(standard(THREE, COLORS[0], { emissive: COLORS[0], emissiveIntensity: 1.1 })),
    keep(standard(THREE, COLORS[1], { emissive: COLORS[1], emissiveIntensity: 1.1 })),
  ];
  const pipOffMat = keep(standard(THREE, "#22384a", { emissive: "#0a1a26", emissiveIntensity: 0.2 }));
  const pips = [[], []];
  for (let side = 0; side < 2; side++) {
    const z = side === 0 ? gz(0) : gz(ROWS - 1);
    for (let k = 0; k < WIN_SCORE; k++) {
      const p = meshOf(THREE, pipGeo, pipOffMat, false);
      const x = (k - (WIN_SCORE - 1) / 2) * cw * 1.4;
      p.position.set(x, TOP + 0.01, z);
      group.add(p);
      pips[side].push(p);
    }
  }

  function clearTrails() {
    for (const m of trailMeshes.values()) group.remove(m);
    trailMeshes.clear();
  }

  function renderGrid() {
    // reconcile: ensure a mesh exists for every occupied cell, remove stale.
    const wanted = new Set();
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const v = grid[y][x];
        if (v < 0) continue;
        const key = `${x},${y}`;
        wanted.add(key);
        let m = trailMeshes.get(key);
        if (!m) {
          m = meshOf(THREE, cellGeo, v === 0 ? M.t0 : M.t1, false);
          m.position.set(gx(x), TOP + 0.007, gz(y));
          group.add(m);
          trailMeshes.set(key, m);
        } else {
          m.material = v === 0 ? M.t0 : M.t1;
        }
      }
    for (const [key, m] of trailMeshes) {
      if (!wanted.has(key)) { group.remove(m); trailMeshes.delete(key); }
    }

    const showHeads = phase === "playing" || phase === "countdown" || phase === "roundover";
    for (let i = 0; i < 2; i++) {
      const c = cycles[i];
      headMeshes[i].visible = !!c && c.alive && showHeads;
      if (c) headMeshes[i].position.set(gx(c.x), TOP + 0.014, gz(c.y));
    }

    if (myColorIdx != null) {
      const me = cycles[myColorIdx];
      if (myHalo) {
        myHalo.visible = !!me && me.alive && showHeads;
        if (me) myHalo.position.set(gx(me.x), TOP + 0.006, gz(me.y));
      }
      // Home strip marks the spawn edge during countdown so the player confirms
      // their starting side, then fades so it doesn't clutter the live arena.
      if (myHomeStrip) myHomeStrip.visible = phase === "countdown";
    }

    // score pips
    for (let side = 0; side < 2; side++) {
      const s = scores[side] | 0;
      for (let k = 0; k < pips[side].length; k++) {
        pips[side][k].material = k < s ? pipOnMat[side] : pipOffMat;
      }
    }

    // banner
    const b = bannerFor();
    if (b.text !== lastBannerText || phase === "countdown") {
      lastBannerText = b.text;
      drawBanner(b.text, b.color);
    }
    if (bannerSprite) bannerSprite.visible = !!b.text;
  }

  // ---- host sim ----
  // LOCKSTEP steering: an input does NOT mutate dir the instant the packet lands;
  // it is buffered into pendingTurn[seat] (overwriting any earlier turn this tick,
  // so at most one turn per cycle per tick) and applied atomically at the top of
  // the next stepCycles(). This removes sub-tick arrival-time dependence and the
  // two-turns-in-one-tick 180° stack.
  function hostTurn(seat, t) {
    const c = cycles[seat];
    if (!c || !c.alive || phase !== "playing") return;
    if (t !== "left" && t !== "right") return;
    pendingTurn[seat] = t;
  }

  function applyPendingTurns() {
    for (let i = 0; i < cycles.length; i++) {
      const t = pendingTurn[i];
      pendingTurn[i] = null; // consume regardless of outcome — never replays
      const c = cycles[i];
      if (!t || !c || !c.alive) continue;
      const nd = t === "left" ? turnLeft(c.dir) : turnRight(c.dir);
      // A single buffered left/right can't yield a 180° from the committed dir,
      // but verify against the reverse so no path drives the head into its neck.
      if (nd === reverse(c.dir)) continue;
      c.dir = nd;
    }
  }

  function stepCycles() {
    applyPendingTurns();
    const targets = cycles.map((c) => (c.alive ? { x: c.x + DV[c.dir][0], y: c.y + DV[c.dir][1] } : null));

    // wall + existing-trail collisions (evaluated against the pre-move grid)
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i], tg = targets[i];
      if (!c.alive || !tg) continue;
      if (tg.x < 0 || tg.x >= COLS || tg.y < 0 || tg.y >= ROWS) { c.alive = false; continue; }
      if (grid[tg.y][tg.x] >= 0) { c.alive = false; continue; }
    }

    // Head-on collisions, evaluated against PRE-move positions so the outcome is
    // symmetric and order-independent:
    //   (a) shared target — both aim at the same empty cell, and
    //   (b) cell swap     — each aims at the other's current cell (they pass
    //       through one another within a single tick; neither target is filled
    //       yet so the wall check above misses it).
    for (let i = 0; i < cycles.length; i++)
      for (let j = i + 1; j < cycles.length; j++) {
        const a = cycles[i], b = cycles[j], ta = targets[i], tb = targets[j];
        if (!a.alive || !b.alive || !ta || !tb) continue;
        const sharedTarget = ta.x === tb.x && ta.y === tb.y;
        const cellSwap = ta.x === b.x && ta.y === b.y && tb.x === a.x && tb.y === a.y;
        if (sharedTarget || cellSwap) { a.alive = false; b.alive = false; }
      }

    // commit moves for survivors, lay trail at the OLD position
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i];
      if (!c.alive) continue;
      grid[c.y][c.x] = c.colorIdx;
      c.x = targets[i].x;
      c.y = targets[i].y;
      grid[c.y][c.x] = c.colorIdx;
    }
  }

  function aliveCount() {
    return cycles.reduce((n, c) => n + (c.alive ? 1 : 0), 0);
  }

  function hostTick(dt) {
    const ms = dt * 1000;
    if (phase === "countdown") {
      countdownAcc += ms;
      while (countdownAcc >= COUNTDOWN_STEP_MS) {
        countdownAcc -= COUNTDOWN_STEP_MS;
        countdown--;
        if (countdown < 0) { phase = "playing"; countdown = 0; tickAcc = 0; }
        pushState();
        if (phase === "playing") break;
      }
      return;
    }
    if (phase === "playing") {
      tickAcc += ms;
      let stepped = false;
      while (tickAcc >= TICK_MS) {
        tickAcc -= TICK_MS;
        stepCycles();
        stepped = true;
        if (aliveCount() <= 1) { endRound(); return; }
      }
      if (stepped) pushState();
      return;
    }
    if (phase === "roundover") {
      gapAcc += ms;
      if (gapAcc >= ROUND_GAP_MS) { gapAcc = 0; beginRound(); pushState(); }
    }
    // matchover: idle (final banner already pushed)
  }

  function endRound() {
    const survivors = cycles.map((c, i) => (c.alive ? i : -1)).filter((i) => i >= 0);
    roundWinner = survivors.length === 1 ? survivors[0] : null;
    if (roundWinner != null) scores[roundWinner]++;
    if (scores[0] >= WIN_SCORE || scores[1] >= WIN_SCORE) {
      phase = "matchover";
      matchWinner = scores[0] >= WIN_SCORE ? 0 : 1;
      try { ctx.onGameOver({ winner: matchWinner === 0 ? "host" : "guest", reason: "match" }); } catch { /* */ }
    } else {
      phase = "roundover";
      gapAcc = 0;
    }
    pushState();
  }

  function beginRound() {
    round++;
    grid = makeArena();
    cycles = spawnCycles();
    roundWinner = null;
    phase = "countdown";
    countdown = COUNTDOWN;
    countdownAcc = 0;
    tickAcc = 0;
    pendingTurn[0] = pendingTurn[1] = null;
  }

  // ---- state wire format ----
  function buildState() {
    let g = "";
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) g += grid[y][x] < 0 ? "." : String(grid[y][x]);
    return {
      phase, cols: COLS, rows: ROWS, grid: g,
      cycles: cycles.map((c) => ({ x: c.x, y: c.y, dir: c.dir, alive: c.alive, colorIdx: c.colorIdx })),
      scores: scores.slice(), round, countdown, roundWinner, matchWinner,
    };
  }
  function publicState() { return buildState(); }

  function pushState() {
    const s = buildState();
    try { ctx.net.sendState(s, s); } catch { /* */ }
    if (isHost) renderGrid(); // host renders the exact snapshot it sends
  }

  // ---- guest steering inbound (host integrates) ----
  function onInput(input, byRole) {
    if (role !== "host" || byRole !== "guest") return;
    if (input && (input.turn === "left" || input.turn === "right")) hostTurn(1, input.turn);
  }

  function update(dt) {
    if (isHost) hostTick(dt);
    // Idle pulse on the local halo so "which one am I" reads at a glance even
    // while standing still during the countdown.
    if (M.mine) {
      const t = nowMs() / 1000;
      M.mine.emissiveIntensity = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3.2));
    }
    // guests/spectators paint on snapshot arrival (renderGrid in applyState).
  }

  function applyState(state) {
    if (!state) {
      grid = makeArena();
      cycles = spawnCycles();
      scores = [0, 0];
      round = 1;
      phase = "countdown";
      countdown = COUNTDOWN;
      roundWinner = matchWinner = null;
      tickAcc = countdownAcc = gapAcc = 0;
      pendingTurn[0] = pendingTurn[1] = null;
      renderGrid();
      return;
    }
    if (role === "host") { renderGrid(); return; } // host is authoritative locally

    // decode grid string
    const g = makeArena();
    if (typeof state.grid === "string" && state.grid.length === COLS * ROWS) {
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++) {
          const ch = state.grid[y * COLS + x];
          g[y][x] = ch === "." ? -1 : Number(ch);
        }
    }
    grid = g;
    // IMPORTANT: cycles/colorIdx come straight from the wire (shared game state).
    // The LOCAL identity (myColorIdx/myColor/which head glows) was fixed at
    // construction from role and is NOT touched here — no side-flip.
    cycles = Array.isArray(state.cycles)
      ? state.cycles.map((c, i) => ({
          x: c.x | 0, y: c.y | 0, dir: c.dir | 0,
          alive: !!c.alive, colorIdx: c.colorIdx ?? i,
        }))
      : spawnCycles();
    scores = Array.isArray(state.scores) ? [state.scores[0] | 0, state.scores[1] | 0] : [0, 0];
    phase = state.phase || "playing";
    round = Number.isInteger(state.round) ? state.round : round;
    countdown = Number.isInteger(state.countdown) ? state.countdown : 0;
    roundWinner = Number.isInteger(state.roundWinner) ? state.roundWinner : null;
    matchWinner = Number.isInteger(state.matchWinner) ? state.matchWinner : null;
    renderGrid();
  }

  function onPointer() { /* real-time: keyboard only */ }
  function setRole(r) { role = r || "spectator"; }
  // board.js re-rotates the group by orientFor(seatRy) on an in-place seat move
  // and calls this; the arena + cues are authored canonically so the rotation is
  // all that's needed. Track seatRy and reference orientFor so the contract is
  // explicit in this module.
  function setSeatRy(ry) { seatRy = ry; void orientFor(seatRy); }
  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
    clearTrails();
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  renderGrid();
  return { group, applyState, applyMove: () => true, onPointer, onInput, update, publicState, setRole, setSeatRy, dispose };
}

export default createGame;
