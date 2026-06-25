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
  ghostRing.position.y = TOP + 0.0014;
  ghostRing.raycast = () => {};
  ghostRing.visible = false;
  ghostRing.renderOrder = 2;
  group.add(ghostRing);

  // Single reusable last-move marker: a thin accent ring around the latest drop.
  const lastRingGeo = keep(new THREE.RingGeometry(STONE_R * 1.08, STONE_R * 1.3, 28));
  const lastRing = new THREE.Mesh(lastRingGeo, M.last);
  lastRing.rotation.x = -Math.PI / 2;
  lastRing.position.y = TOP + 0.0016;
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
    ghostRing.position.set(ix(c), TOP + 0.0014, ix(r));
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
  let lampClock = 0; // running clock for the turn-lamp breathe
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
    return drops.length > 0 || phase === "over" || (phase === "play" && myColor != null);
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
      const lift = Math.max(0, 0.004 * (1 - winT / 0.5)); // one-shot settle
      for (const [r, c] of winLine) {
        const s = stones[r] && stones[r][c];
        // Skip a stone still playing its placement settle (the just-played winning
        // stone) so the two tweens don't fight on position.y; it joins next frame.
        if (s && !drops.some((d) => d.mesh === s)) s.position.y = STONE_REST_Y + lift;
      }
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

  // Drive identity/turn cue emissives — purely from local myColor/turn. The home
  // bar is static; the to-move lamp's base level is set here and then breathed by
  // the idle clock (stepAnim) while it runs.
  function updateIdentityCues() {
    for (const color of ["black", "white"]) {
      const c = cue[color];
      if (!c.bar || !c.lamp) continue;
      const isMine = myColor != null && color === myColor;
      const isTurn = phase === "play" && turn === color;
      c.bar.material.emissiveIntensity = isMine ? 0.7 : 0.0;
      c.lamp.material.emissiveIntensity = isTurn ? (isMine ? 1.0 : 0.4) : 0.0;
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
    s.material = color === "black" ? M.black : M.white;
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
      lastRing.position.set(ix(lastDrop.c), TOP + 0.0016, ix(lastDrop.r));
      lastRing.visible = true;
    } else {
      lastRing.visible = false;
    }
  }

  function highlightWin() {
    if (!winLine) return;
    for (const [r, c] of winLine) {
      const s = stones[r][c];
      if (s) s.material = M.win;
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
    M.win.emissiveIntensity = 0.7;
    if (phase === "over" && winner && lastDrop) {
      const { r, c } = lastDrop;
      if (board[r] && board[r][c] === winner) {
        winLine = winningLine(board, r, c, winner);
      }
    }
    highlightWin();
    paintLastMarker();
    hideGhost();
    updateIdentityCues();
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
