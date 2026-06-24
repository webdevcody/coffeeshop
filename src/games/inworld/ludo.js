// Ludo — in-world 3D module (createGame contract). 4-PLAYER, MULTI-SEAT,
// host-authoritative. seatIndex → colour. Host rolls the die (RNG) and resolves;
// guests send {roll} / {move,token} intents. Full-info (full === pub). Token step
// model: 0 = yard, 1..51 = shared track, 52..57 = home column, 57 = finished.

import { GameDesync, orientFor } from "./createGame.js";
import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard } from "./pieces.js";

const COLORS = ["red", "green", "yellow", "blue"];
const START = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// 52-cell clockwise track as [col,row] on a 15×15 conceptual grid (standard ludo).
const TRACK = [
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0],
];
// home columns (6 cells each, leading to centre)
const HOME = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
};
const YARD = {
  red: [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]],
  green: [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]],
  yellow: [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]],
  blue: [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]],
};

const absSquare = (color, step) => (START[color] + step - 1) % 52;

function cellOf(color, step) {
  if (step <= 0) return null;
  if (step <= 51) return TRACK[absSquare(color, step)];
  if (step <= 57) return HOME[color][step - 52];
  return HOME[color][5];
}

function legalMoves(s, color) {
  const out = [];
  const toks = s.tokens[color];
  for (let i = 0; i < 4; i++) {
    const step = toks[i];
    if (step === 0) { if (s.die === 6) out.push(i); }
    else if (step + s.die <= 57) out.push(i);
  }
  return out;
}

function applyTokenMove(s, color, idx) {
  const ns = JSON.parse(JSON.stringify(s));
  let step = ns.tokens[color][idx];
  step = step === 0 ? 1 : step + ns.die;
  ns.tokens[color][idx] = step;
  // capture on shared track non-safe
  if (step >= 1 && step <= 51) {
    const sq = absSquare(color, step);
    if (!SAFE.has(sq)) {
      for (const oc of ns.order) {
        if (oc === color) continue;
        for (let j = 0; j < 4; j++) {
          const os = ns.tokens[oc][j];
          if (os >= 1 && os <= 51 && absSquare(oc, os) === sq) ns.tokens[oc][j] = 0;
        }
      }
    }
  }
  return ns;
}

const allHome = (s, color) => s.tokens[color].every((t) => t === 57);
const curColor = (s) => s.order[s.turn];
// Seat index of the player whose turn it is. Seats map to colours canonically
// (seat 0=red, 1=green, 2=yellow, 3=blue) — the same map as `myColor =
// COLORS[seatIndex]` — so the current player's seat is the colour's index in
// COLORS. This is the seat the engine's server-stamped `by.seatIndex` is
// compared against to enforce turn order across the 3–4 indistinguishable
// guest seats (byRole alone can't tell them apart).
const curSeat = (s) => COLORS.indexOf(curColor(s));

function nextTurn(s) {
  s.turn = (s.turn + 1) % s.order.length;
  s.die = null;
  s.awaiting = false;
  s.sixes = 0;
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "ludo";

  let role = ctx.role;
  const isHost = role === "host";
  const seatCount = Math.max(2, Math.min(4, ctx.seatCount || 2));
  // seatIndex/myColor are MUTABLE: a live re-seat (board.js → setRole) must update
  // them so LAYOUT_BASE[myColor] (home-quadrant orientation) and the per-seat turn
  // gate in onPointer both follow the player to their new colour/seat. Captured at
  // mount, refreshed by setRole(role, idx).
  let seatIndex = ctx.seatIndex;
  let myColor = role === "spectator" || seatIndex == null ? null : COLORS[seatIndex];

  const order = COLORS.slice(0, seatCount);
  let s = {
    tokens: Object.fromEntries(COLORS.map((c) => [c, [0, 0, 0, 0]])),
    order,
    turn: 0,
    die: null,
    awaiting: false,
    sixes: 0,
    phase: "play",
    winner: null,
  };

  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    board: keep(standard(THREE, "#f3ead8", { roughness: 0.85 })),
    frame: keep(standard(THREE, PALETTE.frame, { roughness: 0.7 })),
    die: keep(standard(THREE, "#fafafa", { roughness: 0.5 })),
  };
  const tokMat = {};
  for (const c of COLORS) tokMat[c] = keep(standard(THREE, PALETTE.ludo[c], { roughness: 0.5 }));
  const quadMat = {};
  for (const c of COLORS) quadMat[c] = keep(standard(THREE, PALETTE.ludo[c], { roughness: 0.85, transparent: true, opacity: 0.45 }));

  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plank = meshOf(THREE, keep(new THREE.BoxGeometry(outer, plankH, outer)), M.board);
  plank.position.y = plankH / 2;
  group.add(plank);
  const frame = meshOf(THREE, keep(new THREE.BoxGeometry(outer + 0.03, plankH * 0.6, outer + 0.03)), M.frame);
  frame.position.y = plankH * 0.3;
  group.add(frame);
  const TOP = plankH;

  // Per-seat facing. ludo orients ITSELF (orientPolicy: "self"), so the framework
  // leaves group.rotation.y at 0 and never fights us. Two stacked rotations:
  //   1) the OUTER group spins by orientFor(seatRy) — the same quarter-turn the
  //      framework would apply for a flat board — to carry the canonical near
  //      (-Z) edge to wherever the local player physically sits.
  //   2) an INNER layoutRoot spins by a colour-derived quarter turn that brings
  //      COLORS[seatIndex]'s home quadrant onto the canonical near corner, so the
  //      local player's OWN colour ends up nearest them, not red's.
  // Both are re-applied from ctx.seatRy / seatIndex in setSeatRy(ry) so a live
  // re-seat (without a remount) re-orients correctly. Token hit-testing is by
  // userData.cell={color,token}, independent of rotation, so picking still works.
  // Spectators (no colour) keep the canonical red-near layout.
  const LAYOUT_BASE = { red: 0, green: -Math.PI / 2, yellow: Math.PI, blue: Math.PI / 2 };
  const layoutRoot = new THREE.Group();
  layoutRoot.rotation.y = myColor != null ? (LAYOUT_BASE[myColor] || 0) : 0;
  group.add(layoutRoot);

  let seatRy = ctx.seatRy;
  function applyFacing(ry) {
    seatRy = ry;
    group.rotation.y = orientFor(seatRy);
    layoutRoot.rotation.y = myColor != null ? (LAYOUT_BASE[myColor] || 0) : 0;
  }
  applyFacing(seatRy);

  // grid coordinate (0..14) → local XZ
  const G = 15;
  const cell = BOARD_SIZE / G;
  const gx = (col) => -BOARD_HALF + (col + 0.5) * cell;
  const gz = (row) => -BOARD_HALF + (row + 0.5) * cell;

  // home quadrant plates
  const quadGeo = keep(new THREE.BoxGeometry(cell * 6, 0.003, cell * 6));
  const quads = { red: [3, 3], green: [3, 11], yellow: [11, 11], blue: [11, 3] };
  for (const c of COLORS.slice(0, seatCount)) {
    const [qc, qr] = quads[c];
    const q = meshOf(THREE, quadGeo, quadMat[c], false);
    q.position.set(gx(qc), TOP + 0.002, gz(qr));
    layoutRoot.add(q);
  }

  // tokens: 4 per active color, cone-ish
  const tokenGeo = keep(new THREE.ConeGeometry(cell * 0.32, cell * 0.9, 12));
  const tokenMeshes = {}; // color -> [mesh,...]
  for (const c of COLORS.slice(0, seatCount)) {
    tokenMeshes[c] = [];
    for (let i = 0; i < 4; i++) {
      const m = meshOf(THREE, tokenGeo, tokMat[c]);
      m.userData.cell = { color: c, token: i };
      layoutRoot.add(m);
      tokenMeshes[c].push(m);
    }
  }

  // die display
  const dieGeo = keep(new THREE.BoxGeometry(cell * 1.2, cell * 1.2, cell * 1.2));
  const dieMesh = meshOf(THREE, dieGeo, M.die);
  dieMesh.position.set(0, TOP + cell * 0.7, 0);
  dieMesh.visible = false;
  layoutRoot.add(dieMesh);

  function tokenPos(color, idx) {
    const step = s.tokens[color][idx];
    if (step === 0) {
      const [yc, yr] = YARD[color][idx];
      return { x: gx(yc), z: gz(yr) };
    }
    if (step >= 57) {
      // center
      return { x: gx(7) + (idx - 1.5) * cell * 0.3, z: gz(7) };
    }
    const cl = cellOf(color, step);
    return { x: gx(cl[0]), z: gz(cl[1]) };
  }

  function render() {
    for (const c of COLORS.slice(0, seatCount)) {
      for (let i = 0; i < 4; i++) {
        const p = tokenPos(c, i);
        const m = tokenMeshes[c][i];
        m.position.set(p.x, TOP + cell * 0.45, p.z);
        const legal = s.phase === "play" && s.awaiting && curColor(s) === c && myColor === c && legalMoves(s, c).includes(i);
        m.material.emissive = m.material.emissive || new THREE.Color(0, 0, 0);
        m.scale.setScalar(legal ? 1.18 : 1);
      }
    }
    dieMesh.visible = s.die != null;
    if (s.die != null) {
      const col = PALETTE.ludo[curColor(s)] || "#fafafa";
      M.die.color.set(col);
      dieMesh.position.x = gx(7);
      dieMesh.position.z = gz(7);
    }
  }

  // ---- host authority ----
  function hostRoll() {
    if (s.phase !== "play" || s.die != null) return;
    const color = curColor(s);
    s.die = 1 + Math.floor(Math.random() * 6);
    if (s.die === 6) s.sixes++;
    if (s.sixes >= 3) { nextTurn(s); pushState(); return; }
    const moves = legalMoves(s, color);
    if (moves.length === 0) {
      if (s.die === 6) { s.die = null; s.awaiting = false; pushState(); return; } // roll again on 6 even w/o move? standard: skip
      nextTurn(s);
      pushState();
      return;
    }
    if (moves.length === 1) {
      hostApply(moves[0]);
      return;
    }
    s.awaiting = true;
    pushState();
  }

  function hostApply(idx) {
    const color = curColor(s);
    if (!legalMoves(s, color).includes(idx)) return;
    const was6 = s.die === 6;
    s = applyTokenMove(s, color, idx);
    if (allHome(s, color)) {
      s.phase = "over";
      s.winner = color;
      s.die = null;
      s.awaiting = false;
      try { ctx.onGameOver({ winner: color, reason: "home" }); } catch { /* */ }
      pushState();
      return;
    }
    if (was6) { s.die = null; s.awaiting = false; s.sixes = s.sixes; } // same player rolls again
    else nextTurn(s);
    pushState();
  }

  function pushState() {
    render();
    if (role !== "host") return;
    const snap = JSON.parse(JSON.stringify(s));
    try { ctx.net.sendState(snap, snap); } catch { /* */ }
  }
  function publicState() { return JSON.parse(JSON.stringify(s)); }

  // ---- contract ----
  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed() || myColor == null) return;
    // Local-input gate: only the seat whose turn it is may roll/move. Check the
    // local seat index against the current player's seat so an off-turn seat
    // can't drive the current player from this client either (belt-and-braces
    // with the framework's role/over gate above and the colour check below).
    if (seatIndex !== curSeat(s)) return;
    if (s.phase !== "play" || curColor(s) !== myColor) return;
    // if die not rolled, a click rolls; else pick a legal token
    if (s.die == null) {
      if (isHost) hostRoll();
      else { try { ctx.net.sendMove({ type: "roll", color: myColor }); } catch { /* */ } }
      return;
    }
    const cell = hit && hit.cell;
    if (!s.awaiting || !cell || cell.color !== myColor || !Number.isInteger(cell.token)) return;
    if (!legalMoves(s, myColor).includes(cell.token)) return;
    if (isHost) hostApply(cell.token);
    else { try { ctx.net.sendMove({ type: "move", token: cell.token, color: myColor }); } catch { /* */ } }
  }

  function applyMove(move, byRole, by) {
    if (role !== "host") return true; // guests render via snapshots
    if (!move) return false;
    if (s.phase !== "play") return true;
    // Per-seat turn enforcement. The server stamps the mover's seat index as
    // `by.seatIndex` (host=0, guests 1..N in sit order); board.js passes it as the
    // 3rd arg. byRole alone CANNOT tell the 2nd/3rd/4th seat apart (all "guest"),
    // so seat identity is the ONLY trustworthy gate for 3–4 player turn order.
    // Reject any move from a seat that is not the current player: returning false
    // makes the framework call _requestResync, so the host re-pushes its
    // authoritative snapshot and the off-turn sender re-converges. We ignore the
    // self-declared move.color entirely (it's spoofable and redundant now).
    const moverSeat = by && Number.isInteger(by.seatIndex)
      ? by.seatIndex
      : (byRole === "host" ? 0 : null); // older server fallback (host only)
    if (moverSeat !== curSeat(s)) return false; // off-turn / wrong seat → resync
    if (move.type === "roll") {
      hostRoll();
      return true;
    }
    if (move.type === "move" && Number.isInteger(move.token)) {
      if (s.awaiting) hostApply(move.token);
      return true;
    }
    return false;
  }

  function applyState(state) {
    if (!state) {
      s = {
        tokens: Object.fromEntries(COLORS.map((c) => [c, [0, 0, 0, 0]])),
        order, turn: 0, die: null, awaiting: false, sixes: 0, phase: "play", winner: null,
      };
    } else {
      s = {
        tokens: Object.fromEntries(COLORS.map((c) => [c, (state.tokens && state.tokens[c]) ? state.tokens[c].slice(0, 4).map((n) => n | 0) : [0, 0, 0, 0]])),
        order: Array.isArray(state.order) ? state.order.slice() : order,
        turn: state.turn | 0,
        die: Number.isInteger(state.die) ? state.die : null,
        awaiting: !!state.awaiting,
        sixes: state.sixes | 0,
        phase: state.phase === "over" ? "over" : "play",
        winner: COLORS.includes(state.winner) ? state.winner : null,
      };
    }
    render();
  }

  function update() { /* dice animation handled by render; host drives via intents */ }
  // Live re-seat. board.js passes the new seat index as the 2nd arg so we can
  // refresh BOTH the home-quadrant orientation (LAYOUT_BASE[myColor]) and the
  // per-seat turn gate (seatIndex vs curSeat) — without this, a re-seated player
  // keeps the stale colour: the wrong quadrant faces them AND they can't take
  // their legitimate turn. applyFacing() re-applies LAYOUT_BASE[myColor], and
  // render() refreshes the legal-move highlights for the new colour.
  function setRole(r, idx) {
    role = r || "spectator";
    if (idx !== undefined) seatIndex = idx;
    myColor = role === "spectator" || seatIndex == null ? null : COLORS[seatIndex];
    applyFacing(seatRy);
    render();
  }
  // Live re-orient on a re-seat (board.js calls this after setRole with the new
  // seat ry). Re-derive both rotations from ctx.seatRy/seatIndex via applyFacing.
  function setSeatRy(ry) { applyFacing(ry); }
  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  render();
  if (isHost) pushState();
  // orientPolicy:"self" — ludo rotates its OWN group (applyFacing/setSeatRy); the
  // framework must NOT also rotate it, or the two quarter-turns fight.
  return { group, applyState, applyMove, onPointer, publicState, update, setRole, setSeatRy, dispose, orientPolicy: "self" };
}

export default createGame;
