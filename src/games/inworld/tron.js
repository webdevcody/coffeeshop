// Light Cycles (Tron) — in-world 3D module (createGame contract). REAL-TIME,
// host-authoritative LOCKSTEP grid. Host ticks the sim every TICK_MS and streams a
// full grid snapshot; guest sends only steering ({turn}). No interpolation —
// discrete cells render as-is. Best-of-5, WIN_SCORE=3.

import { BOARD_SIZE, PALETTE, meshOf, standard } from "./pieces.js";

const COLS = 40, ROWS = 26;
const TICK_MS = 85;
const WIN_SCORE = 3;
const COUNTDOWN = 3;
const ROUND_GAP_MS = 1700;
// dirs: 0=up,1=right,2=down,3=left
const DV = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const turnLeft = (d) => (d + 3) % 4;
const turnRight = (d) => (d + 1) % 4;

function makeArena() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
}
function spawnCycles() {
  return [
    { x: 6, y: Math.floor(ROWS / 2), dir: 1, alive: true, colorIdx: 0 },
    { x: COLS - 7, y: Math.floor(ROWS / 2), dir: 3, alive: true, colorIdx: 1 },
  ];
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "tron";

  let role = ctx.role;
  const isHost = role === "host";

  let grid = makeArena();
  let cycles = spawnCycles();
  let scores = [0, 0];
  let round = 1;
  let phase = "countdown"; // countdown|playing|roundover|matchover
  let countdown = COUNTDOWN;
  let roundWinner = null;
  let matchWinner = null;

  // host timers
  let tickAcc = 0;
  let countdownAcc = 0;
  let gapAcc = 0;
  const pendingTurn = [null, null];

  const mySeat = role === "host" ? 0 : role === "guest" ? 1 : null;

  // input
  const kd = (e) => {
    if (role === "spectator") return;
    let t = null;
    if (e.code === "ArrowLeft" || e.code === "KeyA") t = "left";
    else if (e.code === "ArrowRight" || e.code === "KeyD") t = "right";
    if (!t) return;
    if (isHost) hostTurn(0, t);
    else { try { ctx.net.sendInput({ turn: t }); } catch { /* */ } }
  };
  window.addEventListener("keydown", kd);

  // geometry
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const COLORS = [PALETTE.tron0, PALETTE.tron1];
  const M = {
    floor: keep(standard(THREE, "#081c2e", { roughness: 0.7 })),
    grid: keep(standard(THREE, "#0f2a40", { roughness: 0.8 })),
    t0: keep(standard(THREE, COLORS[0], { emissive: COLORS[0], emissiveIntensity: 0.5 })),
    t1: keep(standard(THREE, COLORS[1], { emissive: COLORS[1], emissiveIntensity: 0.5 })),
    head0: keep(standard(THREE, "#bff7ff", { emissive: COLORS[0], emissiveIntensity: 0.9 })),
    head1: keep(standard(THREE, "#ffe0c0", { emissive: COLORS[1], emissiveIntensity: 0.9 })),
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

  const cellGeo = keep(new THREE.BoxGeometry(cw * 0.9, 0.012, chh * 0.9));
  const headGeo = keep(new THREE.BoxGeometry(cw * 0.95, 0.02, chh * 0.95));
  // pool of trail meshes keyed by "x,y"
  const trailMeshes = new Map();
  const headMeshes = [meshOf(THREE, headGeo, M.head0), meshOf(THREE, headGeo, M.head1)];
  for (const h of headMeshes) { h.position.y = TOP + 0.012; group.add(h); }

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
          m.position.set(gx(x), TOP + 0.006, gz(y));
          group.add(m);
          trailMeshes.set(key, m);
        } else {
          m.material = v === 0 ? M.t0 : M.t1;
        }
      }
    for (const [key, m] of trailMeshes) {
      if (!wanted.has(key)) { group.remove(m); trailMeshes.delete(key); }
    }
    for (let i = 0; i < 2; i++) {
      const c = cycles[i];
      headMeshes[i].visible = !!c && c.alive && phase !== "matchover";
      if (c) headMeshes[i].position.set(gx(c.x), TOP + 0.012, gz(c.y));
    }
  }

  // ---- host sim ----
  // LOCKSTEP: a steering input does NOT mutate dir the instant the packet lands
  // (that made the outcome depend on sub-tick arrival time and let two turns in
  // one tick stack into a 180°). Instead it is buffered into pendingTurn[seat],
  // overwriting any earlier turn this tick (so at most one turn per cycle per
  // tick), and applied atomically at the top of the next stepCycles().
  function hostTurn(seat, t) {
    const c = cycles[seat];
    if (!c || !c.alive || phase !== "playing") return;
    if (t !== "left" && t !== "right") return;
    pendingTurn[seat] = t;
  }

  function applyPendingTurns() {
    for (let i = 0; i < cycles.length; i++) {
      const t = pendingTurn[i];
      pendingTurn[i] = null;
      const c = cycles[i];
      if (!t || !c || !c.alive) continue;
      const nd = t === "left" ? turnLeft(c.dir) : turnRight(c.dir);
      // A left/right turn can never be a direct 180° reversal, but guard anyway so
      // a future input type can't drive the cycle straight back into its own neck.
      if (nd === (c.dir + 2) % 4) continue;
      c.dir = nd;
    }
  }

  function stepCycles() {
    // Apply this tick's buffered turns atomically, then advance — deterministic
    // regardless of when within the tick each packet arrived.
    applyPendingTurns();
    const targets = cycles.map((c) => (c.alive ? { x: c.x + DV[c.dir][0], y: c.y + DV[c.dir][1] } : null));
    // resolve collisions
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i], tg = targets[i];
      if (!c.alive || !tg) continue;
      if (tg.x < 0 || tg.x >= COLS || tg.y < 0 || tg.y >= ROWS) { c.alive = false; continue; }
      if (grid[tg.y][tg.x] >= 0) { c.alive = false; continue; }
    }
    // head-on (shared target)
    for (let i = 0; i < cycles.length; i++)
      for (let j = i + 1; j < cycles.length; j++) {
        if (targets[i] && targets[j] && targets[i].x === targets[j].x && targets[i].y === targets[j].y) {
          cycles[i].alive = false;
          cycles[j].alive = false;
        }
      }
    // commit moves for survivors, lay trail at OLD position
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
    return cycles.filter((c) => c.alive).length;
  }

  function hostTick(dt) {
    if (phase === "countdown") {
      countdownAcc += dt * 1000;
      if (countdownAcc >= 800) {
        countdownAcc = 0;
        countdown--;
        if (countdown <= 0) { phase = "playing"; countdown = 0; }
        pushState();
      }
      return;
    }
    if (phase === "playing") {
      tickAcc += dt * 1000;
      while (tickAcc >= TICK_MS) {
        tickAcc -= TICK_MS;
        stepCycles();
        if (aliveCount() <= 1) { endRound(); break; }
      }
      pushState();
      return;
    }
    if (phase === "roundover") {
      gapAcc += dt * 1000;
      if (gapAcc >= ROUND_GAP_MS) { gapAcc = 0; beginRound(); pushState(); }
    }
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
  function snapshot() { return buildState(); }
  function publicState() { return buildState(); }
  function pushState() {
    const s = buildState();
    try { ctx.net.sendState(s, s); } catch { /* */ }
    if (isHost) { applyLocal(s); }
  }

  // host renders the same snapshot it sends
  function applyLocal(s) {
    renderGrid();
  }

  function onInput(input, byRole) {
    if (role !== "host" || byRole !== "guest") return;
    if (input && (input.turn === "left" || input.turn === "right")) hostTurn(1, input.turn);
  }

  function update(dt) {
    if (isHost) hostTick(dt);
    // guests/spectators paint on snapshot arrival only (renderGrid in applyState)
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
      renderGrid();
      return;
    }
    if (role === "host") { renderGrid(); return; }
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
    cycles = Array.isArray(state.cycles)
      ? state.cycles.map((c, i) => ({ x: c.x | 0, y: c.y | 0, dir: c.dir | 0, alive: !!c.alive, colorIdx: c.colorIdx ?? i }))
      : spawnCycles();
    scores = Array.isArray(state.scores) ? state.scores.slice(0, 2) : [0, 0];
    phase = state.phase || "playing";
    matchWinner = Number.isInteger(state.matchWinner) ? state.matchWinner : null;
    renderGrid();
  }

  function onPointer() { /* keyboard only */ }
  function setRole(r) { role = r || "spectator"; }
  function setSeatRy() {}
  function dispose() {
    window.removeEventListener("keydown", kd);
    clearTrails();
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  renderGrid();
  return { group, applyState, applyMove: () => true, onPointer, onInput, update, publicState, setRole, setSeatRy, dispose };
}

export default createGame;
