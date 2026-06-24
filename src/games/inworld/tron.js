// Light Cycles (Tron) — in-world 3D module (createGame contract). REAL-TIME,
// host-authoritative LOCKSTEP grid. Host ticks the sim every TICK_MS and streams a
// full grid snapshot; guest sends only steering ({turn}). No interpolation —
// discrete cells render as-is. Best-of-5, WIN_SCORE=3.

import { BOARD_SIZE, PALETTE, meshOf, standard } from "./pieces.js";
import { orientFor } from "./createGame.js";

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

  // Per-viewer seat facing. board.js rotates THIS module's group by
  // orientFor(seatRy) (default FLAT policy — no orientPolicy declared) so the
  // arena turns to face whoever is looking; we keep seatRy only so an in-place
  // re-seat (setSeatRy) can re-derive the identity-cue placement. The arena is
  // authored in the canonical frame; the framework handles the rotation.
  let seatRy = ctx.seatRy;

  // COLOR/SIDE DERIVATION (canonical convention §2). A 2-player game derives its
  // own side from ROLE, never from a relayed snapshot: host = cycle 0 (the
  // "moves-first"/COLOR_A side, tron0 cyan), guest = cycle 1 (COLOR_B, tron1
  // orange), spectator = null (read-only). Computed ONCE here and NEVER
  // recomputed inside applyState(), so a synced snapshot can't flip the local
  // player to the wrong colour — host always knows "I am cyan", guest "I am
  // orange", consistent and opposite across clients.
  const mySeat = role === "host" ? 0 : role === "guest" ? 1 : null;
  const myColorIdx = mySeat; // 0 = cyan (tron0), 1 = orange (tron1), null = spectator

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

  // input — gated to a SEATED, non-spectator local player only (§4). It's a
  // real-time game so there's no turn alternation, but a spectator or an
  // unseated/finished viewer must never steer a cycle. isLocalTurnAllowed()
  // (board.js) confirms we're seated at this table and the match isn't over.
  const kd = (e) => {
    if (role === "spectator") return;
    try { if (ctx.isLocalTurnAllowed && !ctx.isLocalTurnAllowed()) return; } catch { /* */ }
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
  const myColor = myColorIdx != null ? COLORS[myColorIdx] : null;
  const M = {
    floor: keep(standard(THREE, "#081c2e", { roughness: 0.7 })),
    grid: keep(standard(THREE, "#0f2a40", { roughness: 0.8 })),
    // Two CLEARLY DISTINCT side materials: cyan (tron0) vs orange (tron1), each
    // self-lit by its own emissive so the two trails never read alike.
    t0: keep(standard(THREE, COLORS[0], { emissive: COLORS[0], emissiveIntensity: 0.5 })),
    t1: keep(standard(THREE, COLORS[1], { emissive: COLORS[1], emissiveIntensity: 0.5 })),
    head0: keep(standard(THREE, "#bff7ff", { emissive: COLORS[0], emissiveIntensity: 0.9 })),
    head1: keep(standard(THREE, "#ffe0c0", { emissive: COLORS[1], emissiveIntensity: 0.9 })),
    // IDENTITY CUE (§4): a brighter head + a glowing halo/home pad in the LOCAL
    // player's OWN colour, so they can tell at a glance which cycle is theirs.
    // Spectators get none (myColor == null).
    myHead: myColor ? keep(standard(THREE, "#ffffff", { emissive: myColor, emissiveIntensity: 1.6 })) : null,
    mine: myColor ? keep(standard(THREE, myColor, { emissive: myColor, emissiveIntensity: 0.85, transparent: true, opacity: 0.55, depthWrite: false })) : null,
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
  // IDENTITY CUE (§4): give the LOCAL player's OWN head the brighter myHead
  // material so it visibly out-glows the opponent's; the other head keeps its
  // normal side material. Spectators (myColorIdx == null) see both normal.
  const headMeshes = [
    meshOf(THREE, headGeo, myColorIdx === 0 && M.myHead ? M.myHead : M.head0),
    meshOf(THREE, headGeo, myColorIdx === 1 && M.myHead ? M.myHead : M.head1),
  ];
  for (const h of headMeshes) { h.position.y = TOP + 0.012; group.add(h); }

  // IDENTITY CUE (§4): a soft glowing halo in the local player's own colour that
  // tracks THEIR head, plus a static home pad on their spawn cell, so the local
  // player can instantly find "which one am I" at round start and mid-round. Both
  // are authored in the canonical frame; board.js rotates the group so they land
  // on the viewer's own near side. Spectators get neither.
  let myHalo = null, myHomePad = null;
  if (M.mine && myColorIdx != null) {
    const haloGeo = keep(new THREE.BoxGeometry(cw * 2.4, 0.002, chh * 2.4));
    myHalo = meshOf(THREE, haloGeo, M.mine, false);
    myHalo.position.y = TOP + 0.005;
    group.add(myHalo);
    // Home pad sits under the local player's spawn cell (host=cycle0 left edge,
    // guest=cycle1 right edge) so the player can confirm their starting side.
    const spawn = spawnCycles()[myColorIdx];
    const padGeo = keep(new THREE.BoxGeometry(cw * 2.0, 0.002, AH * 0.9));
    myHomePad = meshOf(THREE, padGeo, M.mine, false);
    myHomePad.position.set(gx(spawn.x), TOP + 0.003, gz(Math.floor(ROWS / 2)));
    group.add(myHomePad);
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
    // IDENTITY CUE: keep the local player's halo glued to their own head while
    // their cycle is alive; the home pad only marks the spawn side before the
    // round runs (countdown), then fades so it doesn't clutter the arena.
    if (myColorIdx != null) {
      const me = cycles[myColorIdx];
      if (myHalo) {
        myHalo.visible = !!me && me.alive && phase !== "matchover";
        if (me) myHalo.position.set(gx(me.x), TOP + 0.005, gz(me.y));
      }
      if (myHomePad) myHomePad.visible = phase === "countdown";
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
      // Consume the buffered turn regardless of outcome so it can never replay
      // on a later tick.
      pendingTurn[i] = null;
      const c = cycles[i];
      if (!t || !c || !c.alive) continue;
      const nd = t === "left" ? turnLeft(c.dir) : turnRight(c.dir);
      // REJECT a 180° reversal: a single buffered left/right can't produce one
      // from the committed dir, but check the actual resulting movement vector
      // against the reverse of travel so no input path can drive the head back
      // into its own neck (an instant in-place reversal / self-crash).
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
    // Head-on collisions, evaluated against the PRE-move positions so the
    // outcome is symmetric and order-independent:
    //   (a) shared target  — both cycles aim at the same empty cell, and
    //   (b) cell swap       — each aims at the other's current cell, so they
    //       pass straight through one another within a single tick. The grid
    //       wall check above misses (b) because neither target cell is filled
    //       until trails are laid after the move, so it must be caught here.
    for (let i = 0; i < cycles.length; i++)
      for (let j = i + 1; j < cycles.length; j++) {
        const a = cycles[i], b = cycles[j], ta = targets[i], tb = targets[j];
        if (!a.alive || !b.alive || !ta || !tb) continue;
        const sharedTarget = ta.x === tb.x && ta.y === tb.y;
        const cellSwap = ta.x === b.x && ta.y === b.y && tb.x === a.x && tb.y === a.y;
        if (sharedTarget || cellSwap) {
          a.alive = false;
          b.alive = false;
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
      // LOCKSTEP STREAMING: only advance the sim and broadcast the arena on a
      // tick boundary (~TICK_MS / 85ms), never per render frame. Buffered
      // steering inputs that arrived since the last tick are applied inside
      // stepCycles() -> applyPendingTurns(), so a frame-rate-independent,
      // deterministic snapshot is what every peer sees.
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
  // board.js re-rotates the group by orientFor(seatRy) on an in-place seat move
  // and calls this; the arena + cues are authored canonically so the rotation is
  // all that's needed, but track seatRy so it stays in step. (Reference orientFor
  // so the orientation contract is explicit in this module.)
  function setSeatRy(ry) { seatRy = ry; void orientFor(seatRy); }
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
