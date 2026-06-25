// Gomoku — in-world 3D module (createGame contract). 15×15 intersections, full-info.
//
// Identity / orientation / turn:
//   * Host plays BLACK and moves first; guest plays WHITE. The two stone colours
//     are rendered with clearly distinct materials (matte black vs glossy white).
//   * The LOCAL player's side is derived purely from `role` (host=black, guest=
//     white, spectator=none) and NEVER recomputed from a relayed snapshot, so a
//     wire state can't flip "which colour is me".
//   * Per-seat facing is owned by the module (orientPolicy:"self"), exactly like
//     reversi/chess. Cues/home edges are authored in ONE canonical frame (black
//     home at -Z, white home at +Z); applyFacing() then rotates the group so each
//     player's OWN colour home bar lands at their near edge regardless of which
//     free chair they walked to: orientFor(seatRy) brings the canonical -Z edge
//     near, and a further PI for white brings the +Z (white) edge near instead.
//     Clicks resolve through hitToCell -> group.worldToLocal (which undoes the
//     full rotation), so cells stay canonical under any facing.
//   * Whose-turn is unmistakable: a per-side home bar glows in the local player's
//     own colour ("this near side, in MY colour, is me"), and a turn lamp lights
//     on the side to move (brighter when it's the local player's turn) and gently
//     breathes so it reads as live. All cue emissives are driven from local
//     myColor/turn, never the wire.
//   * Wins are FREE-STYLE (an unbroken run of 5 OR MORE of one colour wins, and
//     the whole run is highlighted). This is the common casual rule, symmetric for
//     both players and recomputed locally on both sides, so it carries no sync
//     risk; documented here so it isn't re-flagged as a bug.
//   * A your-turn hover-ghost stone previews the move under the cursor in the
//     local player's colour; it is shown only on the local player's turn while the
//     game is in play, and only over empty intersections.
//
// Spectators (role "spectator", seatRy null) render read-only from applyState and
// never receive input (the framework gates pointer routing off for them).

import { GameDesync, orientFor } from "./createGame.js";
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
  let seatRy = ctx.seatRy;
  let myColor = role === "host" ? "black" : role === "guest" ? "white" : null;

  // ---- Per-seat facing (module-owned; orientPolicy:"self") ------------------
  // Home edges/cues are authored canonical (black -Z, white +Z). We rotate the
  // whole group ourselves so each player's OWN colour home bar faces them:
  //   orientFor(seatRy) brings the canonical -Z (black) edge near the seat;
  //   a further PI for white brings the +Z (white) edge near instead.
  // Clicks resolve via hitToCell -> group.worldToLocal (which undoes the full
  // rotation), so cells stay canonical regardless of facing.
  function applyFacing() {
    const extra = myColor === "white" ? Math.PI : 0;
    group.rotation.y = orientFor(seatRy) + extra;
  }

  // ---- Authoritative-ish local game state -----------------------------------
  let board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  let turn = "black"; // black always moves first
  let phase = "play"; // "play" | "over"
  let winner = null; // "black" | "white" | null (draw / in-play)
  let winLine = null;
  let lastDrop = null;
  let announced = false; // game-over banner fired exactly once per over state
  let disposed = false; // set in dispose(); gates update/onPointer/setHover

  // ---- Materials ------------------------------------------------------------
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    board: keep(standard(THREE, PALETTE.woodBoard, { roughness: 0.8 })),
    edge: keep(standard(THREE, PALETTE.woodEdge, { roughness: 0.7 })),
    // Slightly darker grid so the lines read against the warm wood from both seats.
    line: keep(standard(THREE, "#2e1c0b", { roughness: 0.9 })),
    // Two CLEARLY distinct stone materials: matte dark vs bright glossy. The black
    // stone gets a touch more spec + a faint rim emissive so it catches a highlight
    // and reads as a 3D piece (not a dark hole) from the opposite (white) seat.
    black: keep(standard(THREE, PALETTE.stoneBlack, {
      roughness: 0.4,
      metalness: 0.1,
      emissive: "#222222",
      emissiveIntensity: 0.05,
    })),
    white: keep(standard(THREE, PALETTE.stoneWhite, { roughness: 0.3, metalness: 0.0 })),
    // I10 — dimmed variants used for the NON-winning stones once the game is over,
    // so the red winning run pops. Darker + rougher + no rim emissive than the live
    // stones; swapped in/out by setStone/highlightWin, never mutated in place.
    blackDim: keep(standard(THREE, "#0d0d0d", { roughness: 0.7, metalness: 0.05 })),
    whiteDim: keep(standard(THREE, "#8f8f8f", { roughness: 0.6, metalness: 0.0 })),
    win: keep(standard(THREE, "#e23b4e", { emissive: "#e23b4e", emissiveIntensity: 0.7 })),
    // Last-move marker: a thin accent ring parked at the most recent drop so both
    // seats (and spectators) can follow the game from across the table.
    last: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.7, roughness: 0.5 })),
    // Faint ground ring under the hover ghost so the target intersection reads.
    ghostRing: keep(standard(THREE, PALETTE.accent, {
      emissive: PALETTE.accent,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      roughness: 0.5,
    })),
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
  // Purely decorative preview: never let it intercept the board ray (it sits above
  // the per-cell colliders). Matches battleship's pattern of disabling raycast on
  // decorative meshes so the tagged userData.cell colliders always win the hit-test.
  ghost.raycast = () => {};
  ghost.visible = false;
  // Previews where the stone will actually rest (real stones' top ≈ TOP + 0.012).
  // depthWrite:false + raycast disabled keep it from z-fighting the wood/colliders.
  ghost.position.y = TOP + 0.007;
  group.add(ghost);

  // Faint ground ring under the hover ghost so the hovered intersection reads
  // clearly on the busy wood (shown/hidden with the ghost). Decorative — no ray.
  const ringGeo = keep(new THREE.RingGeometry(STONE_R * 1.05, STONE_R * 1.35, 28));
  const ghostRing = new THREE.Mesh(ringGeo, M.ghostRing);
  ghostRing.rotation.x = -Math.PI / 2;
  // Layered ~0.4 mm clear of the grid lines (TOP+0.001), hoshi (TOP+0.0012) and
  // the last-move ring (TOP+0.0024) so co-located rings/dots don't z-fight (C7).
  ghostRing.position.y = TOP + 0.002;
  ghostRing.raycast = () => {};
  ghostRing.visible = false;
  ghostRing.renderOrder = 2;
  group.add(ghostRing);

  // Single reusable last-move marker: a thin accent ring around the latest drop.
  const lastRingGeo = keep(new THREE.RingGeometry(STONE_R * 1.08, STONE_R * 1.3, 28));
  const lastRing = new THREE.Mesh(lastRingGeo, M.last);
  lastRing.rotation.x = -Math.PI / 2;
  // Highest of the ground rings (~0.4 mm over the ghost ring) so it never z-fights
  // the hover ring, grid lines or hoshi when they co-locate (C7).
  lastRing.position.y = TOP + 0.0024;
  lastRing.raycast = () => {};
  lastRing.visible = false;
  lastRing.renderOrder = 2;
  group.add(lastRing);

  let hoverCell = null; // last {r,c} resolved by hitToCell, or null on a miss
  let ghostPulse = 0;

  function retintGhost() {
    ghost.material = myColor === "white" ? M.ghostWhite : M.ghostBlack;
  }
  retintGhost();

  function hideGhost() {
    ghost.visible = false;
    ghostRing.visible = false;
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
      ghostRing.visible = false;
      return;
    }
    const newlyShown = !ghost.visible;
    ghost.position.set(ix(c), TOP + 0.007, ix(r));
    ghostRing.position.set(ix(c), TOP + 0.002, ix(r));
    if (newlyShown) {
      // Reset the pulse so the first visible frame isn't a random dim/bright flash
      // (the per-frame update leaves opacity at an arbitrary value when hidden).
      ghostPulse = 0;
      ghost.material.opacity = myColor === "white" ? 0.55 : 0.5;
    }
    ghost.visible = true;
    ghostRing.visible = true;
  }

  // ---- Shared idle animation clock ------------------------------------------
  // One on-demand rAF loop drives three purely-cosmetic effects: a stone-placement
  // settle pop (I1), a win flourish on the five winning stones (I2), and a turn-lamp
  // breathe (I6). It starts when there's work and stops when idle so the ambient/
  // spectator path stays cheap. board.js also pumps update(dt) (the ghost pulse);
  // these are independent. Gated behind requestAnimationFrame so headless checks
  // stay synchronous (placements just snap to final position).
  const RAF_OK = typeof requestAnimationFrame !== "undefined";
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const drops = []; // active settle tweens: { mesh, t, dur, baseY }
  let winT = 0; // running clock for the win flourish (0 when no win)
  let winSweepT = 0; // running clock for the staggered win-line reveal (I9)
  const WIN_SWEEP_DUR = 0.4; // total time for the run to light up end-to-end
  let lampClock = 0; // running clock for the turn-lamp breathe
  let lastBreatheClock = 0; // running clock for the last-move ring breathe (I11)
  let rafId = 0;
  let lastT = 0;

  const STONE_REST_Y = TOP + 0.006;
  // easeOutBack: gentle overshoot for the settle pop.
  function easeOutBack(k) {
    const s = 1.70158;
    const t = k - 1;
    return t * t * ((s + 1) * t + s) + 1;
  }

  function animActive() {
    return (
      drops.length > 0 ||
      phase === "over" ||
      lastRing.visible || // keep the last-move breathe (I11) live, even for spectators
      (phase === "play" && myColor != null)
    );
  }

  function startClock() {
    if (rafId || disposed || !RAF_OK) return;
    lastT = nowMs();
    const tick = (t) => {
      rafId = 0;
      if (disposed) return;
      const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
      lastT = t;
      stepAnim(dt);
      if (animActive() && !disposed) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopClock() {
    if (rafId && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function stepAnim(dt) {
    // I1 — settle pop for newly placed stones (ease the y down with overshoot).
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      d.mesh.position.y = d.baseY + (1 - easeOutBack(k)) * 0.03;
      if (k >= 1) {
        d.mesh.position.y = d.baseY;
        drops.splice(i, 1);
      }
    }
    // I2 — win flourish: breathe the win emissive + a tiny one-shot vertical pop.
    if (phase === "over" && winLine) {
      winT += dt;
      M.win.emissiveIntensity = 0.65 + 0.25 * Math.sin(winT * 3.4);
      // I9 — staggered reveal: advance the sweep clock and re-light the run/loser
      // dim along it. Re-run highlightWin every frame until the sweep completes.
      if (winSweepT < WIN_SWEEP_DUR) {
        winSweepT += dt;
        highlightWin(Math.min(1, winSweepT / WIN_SWEEP_DUR));
      }
      const lift = Math.max(0, 0.004 * (1 - winT / 0.5)); // one-shot settle
      for (const [r, c] of winLine) {
        const s = stones[r] && stones[r][c];
        // Skip a stone still playing its placement settle (the just-played winning
        // stone) so the two tweens don't fight on position.y; it joins next frame.
        if (s && !drops.some((d) => d.mesh === s)) s.position.y = STONE_REST_Y + lift;
      }
    }
    // I11 — last-move "drop shadow" breathe: gently pulse the accent ring's emissive
    // while a most-recent move exists so it's easy to find across the 15×15 grid
    // from the opposite seat. Runs in both play and over phases (the deciding move
    // hides its ring via C6, so this only breathes a non-winning last move).
    if (lastRing.visible) {
      lastBreatheClock += dt;
      M.last.emissiveIntensity = 0.55 + 0.25 * (0.5 + 0.5 * Math.sin(lastBreatheClock * 2.0));
    }
    // I6 — turn-lamp breathe: the to-move side's lamp gently pulses.
    if (phase === "play") {
      lampClock += dt;
      for (const color of ["black", "white"]) {
        const c = cue[color];
        if (!c.lamp) continue;
        const isMine = myColor != null && color === myColor;
        const isTurn = turn === color;
        if (!isTurn) {
          c.lamp.material.emissiveIntensity = 0;
          continue;
        }
        const baseL = isMine ? 1.0 : 0.4;
        const amp = isMine ? 0.18 : 0.1;
        c.lamp.material.emissiveIntensity = baseL + amp * (0.5 + 0.5 * Math.sin(lampClock * 2.4));
      }
    }
  }

  // ---- Persistent identity / turn cues (built once, never rebuilt) ----------
  // Black home = -Z edge (canonical near edge, host/moves-first); white home = +Z.
  // applyFacing() rotates the whole group by orientFor(seatRy)(+PI for white) so
  // each client's OWN colour home bar ends up directly in front of them.
  const cue = {
    black: { bar: null, lamp: null, tally: null },
    white: { bar: null, lamp: null, tally: null },
  };
  // C5 — keep the home bar + lamp INSIDE the plank rim (outer half-extent 0.375)
  // so the bar no longer straddles the rim onto bare table; the bar (12 mm deep
  // in Z, centred at edgeZ) spans 0.362..0.374, all on the plank. The lamp is
  // lifted so its underside clears the plank top (TOP) instead of intersecting it.
  const edgeZ = BOARD_HALF + 0.018; // 0.368 — inside the 0.375 plank rim
  // I8 — a slim "tally" bar per side whose length tracks that colour's stone count
  // (derived locally from `board`, never the wire). Purely cosmetic progress cue.
  const TALLY_LEN = BOARD_SIZE * 0.5; // length at a full 225-stone board
  const MAX_STONES = SIZE * SIZE;
  {
    const barGeo = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.7, 0.006, 0.012));
    const lampGeo = keep(new THREE.SphereGeometry(0.012, 18, 14));
    // Unit-length tally bar; scale.x in updateIdentityCues sets the fill, anchored
    // at its left end (group via a parent so we scale without moving the anchor).
    const tallyGeo = keep(new THREE.BoxGeometry(TALLY_LEN, 0.004, 0.006));
    const sides = [
      { color: "black", z: -edgeZ, barMat: M.homeBlack, lampMat: M.lampBlack },
      { color: "white", z: edgeZ, barMat: M.homeWhite, lampMat: M.lampWhite },
    ];
    for (const s of sides) {
      const bar = meshOf(THREE, barGeo, s.barMat, false);
      bar.position.set(0, TOP + 0.004, s.z);
      group.add(bar);
      const lamp = meshOf(THREE, lampGeo, s.lampMat, false);
      lamp.position.set(BOARD_SIZE * 0.42, TOP + 0.014, s.z);
      group.add(lamp);
      // Anchor pivot at the inner end of the tally so scale.x grows it toward the
      // board centre's far side without shifting its origin (no per-frame alloc).
      const tallyPivot = new THREE.Group();
      tallyPivot.position.set(-BOARD_SIZE * 0.34, TOP + 0.003, s.z);
      const tally = meshOf(THREE, tallyGeo, s.barMat, false);
      tally.position.x = TALLY_LEN / 2; // left edge sits on the pivot
      tally.scale.x = 0.0001; // empty board → effectively zero length
      tallyPivot.add(tally);
      group.add(tallyPivot);
      cue[s.color].bar = bar;
      cue[s.color].lamp = lamp;
      cue[s.color].tally = tally;
    }
  }

  // Drive identity/turn cue emissives — purely from local myColor/turn. The home
  // bar is static; the to-move lamp's base level is set here and then breathed by
  // the idle clock (stepAnim) while it runs.
  function updateIdentityCues() {
    // I8 — count each colour's stones locally for the progress tallies.
    let nBlack = 0;
    let nWhite = 0;
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const v = board[r][c];
        if (v === "black") nBlack++;
        else if (v === "white") nWhite++;
      }
    const counts = { black: nBlack, white: nWhite };
    for (const color of ["black", "white"]) {
      const c = cue[color];
      if (!c.bar || !c.lamp) continue;
      const isMine = myColor != null && color === myColor;
      const isTurn = phase === "play" && turn === color;
      c.bar.material.emissiveIntensity = isMine ? 0.7 : 0.0;
      c.lamp.material.emissiveIntensity = isTurn ? (isMine ? 1.0 : 0.4) : 0.0;
      if (c.tally) {
        // Scale the unit-length tally to fill toward the board; clamp to a tiny
        // floor so an empty side keeps a non-degenerate (invisible) sliver.
        c.tally.scale.x = Math.max(0.0001, counts[color] / MAX_STONES);
      }
    }
    // (Re)arm or release the idle clock now that turn/phase may have changed.
    if (animActive()) startClock();
    else stopClock();
  }

  // ---- Stone rendering ------------------------------------------------------
  // `animate` true only for a freshly committed move (local click or relayed move),
  // false for paint()/snapshot rebuilds so a resync never animates a teleport.
  function setStone(r, c, color, animate) {
    let s = stones[r][c];
    const created = !s;
    if (!s) {
      s = meshOf(THREE, stoneGeo, color === "black" ? M.black : M.white);
      s.position.set(ix(c), STONE_REST_Y, ix(r));
      group.add(s);
      stones[r][c] = s;
    }
    const baseMat = color === "black" ? M.black : M.white;
    s.material = baseMat;
    // Remember the un-highlighted material so the win-sweep can light/un-light
    // the stone (I9) and the loser-dim restore (I10) can find it again.
    s.userData.baseMat = baseMat;
    if (created && animate && RAF_OK) {
      // I1 — settle pop: ease in from just above the surface with a small overshoot.
      s.position.y = STONE_REST_Y + 0.03;
      drops.push({ mesh: s, t: 0, dur: 0.18, baseY: STONE_REST_Y });
      startClock();
    } else if (!animate) {
      s.position.y = STONE_REST_Y; // ensure a rebuilt/snapped stone rests cleanly
    }
  }

  // Move the last-move accent ring under the most recent drop (or hide it).
  function paintLastMarker() {
    if (lastDrop && board[lastDrop.r] && board[lastDrop.r][lastDrop.c]) {
      lastRing.position.set(ix(lastDrop.c), TOP + 0.0024, ix(lastDrop.r));
      // C6 — hide the accent ring when the most-recent drop is also part of the
      // winning run, so the red win highlight reads cleanly instead of stacking a
      // second emissive ring at the same intersection.
      const onWin =
        winLine != null &&
        winLine.some(([wr, wc]) => wr === lastDrop.r && wc === lastDrop.c);
      lastRing.visible = !onWin;
    } else {
      lastRing.visible = false;
    }
  }

  // Map a colour to its dimmed end-state variant (I10).
  const dimOf = (color) => (color === "black" ? M.blackDim : M.whiteDim);
  let loserDimDone = false; // I10 one-shot guard so the dim pass runs once per win

  // Is (r,c) part of the current winning run? Small linear scan (winLine length
  // is typically 5) so the per-frame sweep stays allocation-free.
  function onWinLine(r, c) {
    if (!winLine) return false;
    for (let i = 0; i < winLine.length; i++)
      if (winLine[i][0] === r && winLine[i][1] === c) return true;
    return false;
  }

  // End-state styling pass for a WIN. `progress` (0..1) staggers two effects along
  // the same clock: the winning run lights to M.win end-to-end (I9), and the
  // non-winning stones fade to their dim variant as the sweep passes (I10), so the
  // red run pops. progress >= 1 (default) applies the full styling at once — used
  // by the snapshot path so a resync/late-join shows the finished look immediately,
  // never a mid-sweep frame; the live deciding move ramps progress from 0.
  // Allocation-free: no Set/map per call so stepAnim can ramp it every frame.
  function highlightWin(progress = 1) {
    if (!winLine) return;
    const len = winLine.length;
    // Winning stones: light in order along the run.
    for (let i = 0; i < len; i++) {
      const r = winLine[i][0];
      const c = winLine[i][1];
      const s = stones[r] && stones[r][c];
      if (!s) continue;
      const lit = progress >= 1 || i / len <= progress;
      const want = lit ? M.win : s.userData.baseMat || s.material;
      if (s.material !== want) s.material = want;
    }
    // Non-winning stones: dim them in once the sweep is well underway so the win
    // run is already lighting when the rest settles back. One-shot per win.
    if (progress >= 0.5 && !loserDimDone) {
      loserDimDone = true;
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
          const v = board[r][c];
          if (!v || onWinLine(r, c)) continue;
          const s = stones[r] && stones[r][c];
          if (!s) continue;
          const want = dimOf(v);
          if (s.material !== want) s.material = want;
        }
    }
  }

  // Full repaint from `board`. Used by applyState and the initial draw. Snapshots
  // never animate (animate=false) so a resync/late-join is a clean teleport.
  function paint() {
    drops.length = 0; // drop any in-flight settle tweens; we snap to the snapshot
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c]) {
          setStone(r, c, board[r][c], false);
          // B4 — reset any stone that was previously highlighted (e.g. a snapshot
          // that rewinds an "over" state) back to its base colour + rest height
          // before we re-highlight the (possibly new) winning line.
          const s = stones[r][c];
          if (s) {
            s.material = board[r][c] === "black" ? M.black : M.white;
            s.position.y = STONE_REST_Y;
          }
        } else if (stones[r][c]) {
          group.remove(stones[r][c]);
          stones[r][c] = null;
        }
      }
    // Recompute the winning line locally from the snapshot's last drop so a relayed
    // "over" state highlights the same five — without trusting any wire line.
    winLine = null;
    winT = 0;
    // A snapshot-driven over-state shows the FINISHED look at once (no re-sweep):
    // mark the sweep complete so stepAnim's I9 ramp doesn't briefly un-light it.
    winSweepT = WIN_SWEEP_DUR;
    loserDimDone = false; // re-arm so highlightWin(1) re-applies the loser-dim
    M.win.emissiveIntensity = 0.7;
    if (phase === "over" && winner && lastDrop) {
      const { r, c } = lastDrop;
      if (board[r] && board[r][c] === winner) {
        winLine = winningLine(board, r, c, winner);
      }
    }
    highlightWin(); // progress=1: full highlight + loser-dim immediately
    paintLastMarker();
    hideGhost();
    updateIdentityCues();
  }

  // Fire ctx.onGameOver exactly once per over state. Called by BOTH the
  // incremental performMove() path AND applyState/paint when a terminal snapshot
  // lands without us having played the deciding move (every spectator, any late
  // joiner, or a guest whose relayed deciding move was dropped by board.js's
  // hydration/resync gating — for whom the snapshot is the ONLY convergence path
  // to "over"). Guarded by `announced`, which applyState re-arms whenever it
  // ingests a live/reset state. `reason` reflects the actual outcome ("five" for
  // a win, "draw" for a full board) so a snapshot-driven draw never mis-reports.
  function announceOver() {
    if (announced || phase !== "over") return;
    announced = true;
    try {
      ctx.onGameOver({ winner, reason: winner ? "five" : "draw" });
    } catch {
      /* never let a host callback crash play */
    }
  }

  // ---- Move application (shared by local click and relayed move) ------------
  function performMove(r, c, color) {
    board[r][c] = color;
    lastDrop = { r, c };
    setStone(r, c, color, true); // committed move -> animate the settle pop
    paintLastMarker();
    hideGhost();

    const line = winningLine(board, r, c, color);
    if (line) {
      winLine = line;
      winner = color;
      phase = "over";
      winT = 0; // start the win flourish from the top
      loserDimDone = false; // re-arm the I10 loser-dim one-shot for this win
      // I9 — live deciding move: start the sweep from 0 and let stepAnim ramp it.
      // Headless (no rAF): light the full run at once so a sync check sees the win.
      if (RAF_OK) {
        winSweepT = 0;
        highlightWin(0);
      } else {
        winSweepT = WIN_SWEEP_DUR;
        highlightWin(1);
      }
      paintLastMarker(); // re-evaluate now winLine is set (C6: hide ring on a win)
      updateIdentityCues();
      announceOver();
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
      announceOver();
      return;
    }

    turn = other(color);
    updateIdentityCues();
  }

  // ---- Pointer (local click) ------------------------------------------------
  function onPointer(hit) {
    if (disposed) return;
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
  function applyMove(move, byRole) {
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
    // Cross-check the mover's identity (host=black, guest=white) against whose turn
    // it logically is. A mis-stamped/out-of-turn relayed move (e.g. a guest move
    // racing the host's turn flip) would otherwise be committed in the WRONG colour
    // with no desync — corrupting the authoritative state the host then broadcasts.
    // Routing it through GameDesync triggers the framework's self-healing resync.
    const moverColor =
      byRole === "host" ? "black" : byRole === "guest" ? "white" : null;
    if (moverColor != null && moverColor !== turn)
      throw new GameDesync("gomoku: wrong mover");
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
      announced = false; // fresh game / reset: re-arm the game-over announcement
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
      // A live (non-over) snapshot re-arms the announcement so a subsequent over
      // state — incremental or snapshot-driven — fires the banner exactly once.
      if (phase !== "over") announced = false;
    }
    paint();
    // The wire may already say the game is over (a spectator, a late joiner, or a
    // guest whose relayed deciding move was dropped by board.js's gating so only
    // the terminal snapshot reached it). The incremental performMove() path never
    // ran for those clients, so announce the game-over here — exactly once.
    if (phase === "over") announceOver();
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
    if (disposed) return;
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
    if (disposed || !ghost.visible) return;
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
    applyFacing(); // colour may flip -> re-derive the white half-turn
    updateIdentityCues();
  }
  function setSeatRy(ry) {
    // We own per-seat facing now (orientPolicy:"self"); a re-seat must re-orient
    // the board to the new chair (orientFor handles a null spectator ry), then
    // refresh the local cue emissives.
    seatRy = ry;
    applyFacing();
    updateIdentityCues();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopClock();
    hideGhost();
    // Remove the live per-cell stone meshes from the group before teardown.
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const s = stones[r][c];
        if (s) {
          group.remove(s);
          stones[r][c] = null;
        }
      }
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  // Initial facing + draw.
  applyFacing();
  paint();

  return {
    group,
    // We own per-seat facing (applyFacing). board.js must NOT also rotate us, or
    // the two transforms fight. Clicks still resolve via our hitToCell ->
    // group.worldToLocal, so cells stay canonical under the extra rotation.
    orientPolicy: "self",
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
