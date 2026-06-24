// Ludo — in-world 3D module (createGame contract). 2-4 PLAYER, MULTI-SEAT,
// host-authoritative. Candidate variation #3.
//
// Identity model (the part the contract cares about most):
//   - The LOCAL player's colour is derived from ctx.seatIndex (seat 0 = red,
//     1 = green, 2 = yellow, 3 = blue), NEVER from the wire. applyState only
//     copies token/turn data; it never recomputes which colour is "mine".
//   - The board orients ITSELF (orientPolicy: "self"): an OUTER group spin by
//     orientFor(seatRy) carries the canonical near edge to the local chair, and
//     an INNER layoutRoot spin brings the local colour's home quadrant onto that
//     near corner — so YOUR quadrant + tokens sit nearest you and read in YOUR
//     colour, opponents across.
//   - Whose-turn is unmistakable: a canvas placard on the local near edge reads
//     "You are <Colour> — Your turn / Opponent's turn", the active player's
//     home quadrant + tokens pulse, the die is tinted to the active colour, and
//     a glowing ring marks the seat-to-move.
//   - Input is gated to the local seat: onPointer only acts when it is the local
//     seat's turn AND the click targets the local colour. Spectators (no colour)
//     render read-only from applyState and never have input.
//
// Token step model: 0 = yard, 1..51 = shared track squares, 52..57 = home
// column (57 = finished/centre). The shared track is the canonical 52-square
// clockwise ludo loop; each colour enters at its START offset.

import { orientFor } from "./createGame.js";
import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard } from "./pieces.js";

const COLORS = ["red", "green", "yellow", "blue"];
const COLOR_NAME = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" };
// Entry square (absolute track index) for each colour's first step.
const START = { red: 0, green: 13, yellow: 26, blue: 39 };
// Globally safe absolute squares (start squares + star squares).
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// 52-square clockwise track as [col,row] on a 15x15 conceptual grid.
const TRACK = [
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0],
];
// Home columns (6 cells each, leading toward the centre). Index 0..5 maps to
// steps 52..57; step 57 is rendered at the centre as "finished".
const HOME = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
};
// Yard parking spots (4 per colour) on the 15x15 grid.
const YARD = {
  red: [[2.5, 2.5], [4.5, 2.5], [2.5, 4.5], [4.5, 4.5]],
  green: [[2.5, 10.5], [4.5, 10.5], [2.5, 12.5], [4.5, 12.5]],
  yellow: [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]],
  blue: [[10.5, 2.5], [12.5, 2.5], [10.5, 4.5], [12.5, 4.5]],
};
// Home-quadrant plate centre per colour (6x6 area).
const QUAD = { red: [3, 3], green: [3, 11], yellow: [11, 11], blue: [11, 3] };

const absSquare = (color, step) => (START[color] + step - 1) % 52;

function cellOf(color, step) {
  if (step <= 0) return null;
  if (step <= 51) return TRACK[absSquare(color, step)];
  if (step <= 57) return HOME[color][Math.min(step - 52, 5)];
  return HOME[color][5];
}

function legalMoves(s, color) {
  const out = [];
  const toks = s.tokens[color];
  if (!Number.isInteger(s.die)) return out;
  for (let i = 0; i < 4; i++) {
    const step = toks[i];
    if (step === 0) {
      if (s.die === 6) out.push(i); // leave yard only on a 6
    } else if (step < 57 && step + s.die <= 57) {
      out.push(i); // exact-count finish; can't overshoot 57
    }
  }
  return out;
}

function clone(s) { return JSON.parse(JSON.stringify(s)); }

// Apply a token move; returns { ns, captured }. Handles yard exit, advance,
// capture. `captured` is true if this move sent >=1 opponent token home (used
// to grant the standard Ludo bonus roll).
function applyTokenMove(s, color, idx) {
  const ns = clone(s);
  let captured = false;
  let step = ns.tokens[color][idx];
  step = step === 0 ? 1 : step + ns.die;
  if (step > 57) return { ns, captured }; // illegal overshoot guard (shouldn't happen)
  ns.tokens[color][idx] = step;
  // Capture: landing on a non-safe shared-track square sends opponents home.
  if (step >= 1 && step <= 51) {
    const sq = absSquare(color, step);
    if (!SAFE.has(sq)) {
      for (const oc of ns.order) {
        if (oc === color) continue;
        for (let j = 0; j < 4; j++) {
          const os = ns.tokens[oc][j];
          if (os >= 1 && os <= 51 && absSquare(oc, os) === sq) { ns.tokens[oc][j] = 0; captured = true; }
        }
      }
    }
  }
  return { ns, captured };
}

const allHome = (s, color) => s.tokens[color].every((t) => t === 57);
const curColor = (s) => s.order[s.turn % s.order.length];
// Seat index of the player whose turn it is (seat N <-> COLORS[N]).
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
  const isHost = () => role === "host";
  const seatCount = Math.max(2, Math.min(4, ctx.seatCount || 2));

  // seatIndex / myColor are MUTABLE so a live re-seat (board.js -> setRole)
  // re-derives the local colour, home-quadrant orientation, and turn gate.
  let seatIndex = Number.isInteger(ctx.seatIndex) ? ctx.seatIndex : null;
  let myColor = role === "spectator" || seatIndex == null ? null : COLORS[seatIndex] || null;

  const order = COLORS.slice(0, seatCount);

  function freshState() {
    return {
      tokens: Object.fromEntries(COLORS.map((c) => [c, [0, 0, 0, 0]])),
      order: order.slice(),
      turn: 0,
      die: null,
      awaiting: false,
      sixes: 0,
      phase: "play",
      winner: null,
    };
  }
  let s = freshState();

  // ---- materials ----------------------------------------------------------
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    board: keep(standard(THREE, "#f3ead8", { roughness: 0.88 })),
    frame: keep(standard(THREE, PALETTE.frame, { roughness: 0.7 })),
    die: keep(standard(THREE, "#fafafa", { roughness: 0.45 })),
    pip: keep(standard(THREE, "#1a1a1a", { roughness: 0.5 })),
    pathLight: keep(standard(THREE, "#ffffff", { roughness: 0.9 })),
    centre: keep(standard(THREE, "#cdbfa3", { roughness: 0.85 })),
  };
  const tokMat = {};       // colour -> token material (own colour brightened)
  const tokDarkMat = {};   // colour -> outline-ish base
  const quadMat = {};      // colour -> translucent home plate
  const pathMat = {};      // colour -> tinted entry/home-column path tiles
  for (const c of COLORS) {
    tokMat[c] = keep(standard(THREE, PALETTE.ludo[c], { roughness: 0.45, emissive: PALETTE.ludo[c], emissiveIntensity: 0.0 }));
    tokDarkMat[c] = keep(standard(THREE, PALETTE.ludoDark[c], { roughness: 0.55 }));
    quadMat[c] = keep(standard(THREE, PALETTE.ludo[c], { roughness: 0.85, transparent: true, opacity: 0.4, emissive: PALETTE.ludo[c], emissiveIntensity: 0.0 }));
    pathMat[c] = keep(standard(THREE, PALETTE.ludo[c], { roughness: 0.85, transparent: true, opacity: 0.55 }));
  }
  const safeMat = keep(standard(THREE, "#e8d9b6", { roughness: 0.85, emissive: "#caa84a", emissiveIntensity: 0.25 }));
  const glowMat = keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, depthWrite: false }));

  // ---- base board ---------------------------------------------------------
  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plank = meshOf(THREE, keep(new THREE.BoxGeometry(outer, plankH, outer)), M.board);
  plank.position.y = plankH / 2;
  group.add(plank);
  const frame = meshOf(THREE, keep(new THREE.BoxGeometry(outer + 0.03, plankH * 0.6, outer + 0.03)), M.frame);
  frame.position.y = plankH * 0.3;
  group.add(frame);
  const TOP = plankH;

  // ---- per-seat facing (orientPolicy "self") ------------------------------
  // OUTER group  : orientFor(seatRy) — canonical near edge -> local chair.
  // INNER layout : colour quarter-turn — local colour's quadrant -> near corner.
  const LAYOUT_BASE = { red: 0, green: -Math.PI / 2, yellow: Math.PI, blue: Math.PI / 2 };
  const layoutRoot = new THREE.Group();
  group.add(layoutRoot);

  let seatRy = ctx.seatRy;
  function applyFacing(ry) {
    seatRy = ry;
    group.rotation.y = orientFor(seatRy);
    layoutRoot.rotation.y = myColor != null ? (LAYOUT_BASE[myColor] || 0) : 0;
  }

  // grid coordinate (0..14) -> local XZ
  const G = 15;
  const cell = BOARD_SIZE / G;
  const gx = (col) => -BOARD_HALF + (col + 0.5) * cell;
  const gz = (row) => -BOARD_HALF + (row + 0.5) * cell;

  // ---- track tiles (visual path) ------------------------------------------
  const tileGeo = keep(new THREE.BoxGeometry(cell * 0.9, 0.004, cell * 0.9));
  function addTile(col, row, mat, y = TOP + 0.002) {
    const t = meshOf(THREE, tileGeo, mat, false);
    t.position.set(gx(col), y, gz(row));
    layoutRoot.add(t);
    return t;
  }
  // Shared loop tiles (safe squares highlighted, entry squares tinted).
  for (let k = 0; k < TRACK.length; k++) {
    const [c, r] = TRACK[k];
    let mat = M.pathLight;
    if (SAFE.has(k)) mat = safeMat;
    // colour each colour's entry square in its own colour
    for (const col of COLORS) if (absSquare(col, 1) === k) mat = pathMat[col];
    addTile(c, r, mat);
  }
  // Home-column tiles (tinted per colour). Built for EVERY colour (not just the
  // local build-time `order`) so a snapshot whose s.order contains a colour this
  // client did not size for still has meshes; render() hides the ones not in the
  // wire's live s.order via inPlay().
  const homeTiles = {};
  for (const col of COLORS) {
    homeTiles[col] = HOME[col].map(([c, r]) => addTile(c, r, pathMat[col]));
  }
  // Centre triangle plate.
  const centreGeo = keep(new THREE.CylinderGeometry(cell * 1.1, cell * 1.1, 0.005, 4));
  const centre = meshOf(THREE, centreGeo, M.centre, false);
  centre.rotation.y = Math.PI / 4;
  centre.position.set(gx(7), TOP + 0.003, gz(7));
  layoutRoot.add(centre);

  // ---- home-quadrant plates -----------------------------------------------
  const quadGeo = keep(new THREE.BoxGeometry(cell * 6, 0.003, cell * 6));
  const quadMeshes = {};
  for (const c of COLORS) {
    const [qc, qr] = QUAD[c];
    const q = meshOf(THREE, quadGeo, quadMat[c], false);
    q.position.set(gx(qc), TOP + 0.001, gz(qr));
    layoutRoot.add(q);
    quadMeshes[c] = q;
  }

  // ---- tokens (4 per active colour) ---------------------------------------
  const tokenGeo = keep(new THREE.ConeGeometry(cell * 0.3, cell * 0.95, 14));
  const baseGeo = keep(new THREE.CylinderGeometry(cell * 0.34, cell * 0.34, cell * 0.12, 14));
  const tokenMeshes = {}; // colour -> [groupMesh,...]
  for (const c of COLORS) {
    tokenMeshes[c] = [];
    for (let i = 0; i < 4; i++) {
      const tg = new THREE.Group();
      const cone = meshOf(THREE, tokenGeo, tokMat[c]);
      cone.position.y = cell * 0.5;
      const base = meshOf(THREE, baseGeo, tokDarkMat[c]);
      base.position.y = cell * 0.06;
      tg.add(base);
      tg.add(cone);
      // hit-test target: tag the whole token group so a click on cone OR base resolves.
      tg.userData.cell = { color: c, token: i };
      cone.userData.cell = { color: c, token: i };
      base.userData.cell = { color: c, token: i };
      layoutRoot.add(tg);
      tokenMeshes[c].push(tg);
    }
  }

  // ---- legal-move glow rings ----------------------------------------------
  const ringGeo = keep(new THREE.TorusGeometry(cell * 0.42, cell * 0.07, 8, 22));
  const ringMeshes = {}; // colour -> [ring,...]
  for (const c of COLORS) {
    ringMeshes[c] = [];
    for (let i = 0; i < 4; i++) {
      const ring = meshOf(THREE, ringGeo, glowMat, false);
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      layoutRoot.add(ring);
      ringMeshes[c].push(ring);
    }
  }

  // ---- die (cube with pip faces) ------------------------------------------
  const dieSize = cell * 1.3;
  const dieGeo = keep(new THREE.BoxGeometry(dieSize, dieSize, dieSize));
  const dieMesh = meshOf(THREE, dieGeo, M.die);
  const dieGroup = new THREE.Group();
  dieGroup.add(dieMesh);
  // pip dots — built once, toggled per face value.
  const pipGeo = keep(new THREE.SphereGeometry(dieSize * 0.085, 10, 10));
  const half = dieSize / 2 + 0.0005;
  const off = dieSize * 0.26;
  // Face layouts: arrays of [u,v] offsets for value 1..6 on the +Y top face.
  const FACE = {
    1: [[0, 0]],
    2: [[-off, -off], [off, off]],
    3: [[-off, -off], [0, 0], [off, off]],
    4: [[-off, -off], [off, -off], [-off, off], [off, off]],
    5: [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]],
    6: [[-off, -off], [off, -off], [-off, 0], [off, 0], [-off, off], [off, off]],
  };
  const pipPool = [];
  for (let i = 0; i < 6; i++) {
    const p = meshOf(THREE, pipGeo, M.pip, false);
    p.visible = false;
    dieGroup.add(p);
    pipPool.push(p);
  }
  function showDieValue(v) {
    for (const p of pipPool) p.visible = false;
    if (!Number.isInteger(v) || v < 1 || v > 6) return;
    const pts = FACE[v];
    for (let i = 0; i < pts.length; i++) {
      const [u, w] = pts[i];
      pipPool[i].position.set(u, half, w); // pips on the top (+Y) face
      pipPool[i].visible = true;
    }
  }
  dieGroup.position.set(gx(7), TOP + dieSize * 0.7, gz(7));
  dieGroup.visible = false;
  layoutRoot.add(dieGroup);

  // ---- whose-turn / identity placard --------------------------------------
  let labelCv = null, labelTex = null, labelMat = null, labelMesh = null;
  try {
    labelCv = document.createElement("canvas");
    labelCv.width = 320; labelCv.height = 72;
    labelTex = keep(new THREE.CanvasTexture(labelCv));
    labelTex.colorSpace = THREE.SRGBColorSpace;
    labelMat = keep(new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }));
    const lw = BOARD_SIZE * 0.62;
    const labelGeo = keep(new THREE.PlaneGeometry(lw, lw * (72 / 320)));
    labelMesh = meshOf(THREE, labelGeo, labelMat, false);
    labelMesh.rotation.x = -Math.PI / 2;
    // Placard sits on the canonical near (-Z) edge of the OUTER group, so after
    // orientFor(seatRy) it lands at the local player's near edge. It is NOT a
    // child of layoutRoot, so it never inherits the colour quarter-turn.
    labelMesh.position.set(0, TOP + 0.004, -BOARD_HALF - 0.05);
    group.add(labelMesh);
  } catch { /* no DOM (test/headless) — skip placard */ }

  function refreshLabel() {
    if (!labelCv) return;
    const g = labelCv.getContext("2d");
    g.clearRect(0, 0, 320, 72);
    let text, accent = "#f0e4cf";
    if (myColor == null) {
      text = "Spectating";
    } else {
      const name = COLOR_NAME[myColor];
      accent = PALETTE.ludo[myColor];
      if (s.phase === "over") {
        text = s.winner === myColor ? `${name} — You win!` : `${name} — ${COLOR_NAME[s.winner] || "?"} wins`;
      } else if (curColor(s) === myColor) {
        text = s.awaiting ? `${name} — Move a token` : (s.die == null ? `${name} — Your turn: roll` : `${name} — Your turn`);
      } else {
        text = `${name} — ${COLOR_NAME[curColor(s)]}'s turn`;
      }
    }
    g.fillStyle = "rgba(26,18,10,0.84)";
    const rr = 14;
    g.beginPath();
    g.moveTo(rr, 0); g.arcTo(320, 0, 320, 72, rr); g.arcTo(320, 72, 0, 72, rr);
    g.arcTo(0, 72, 0, 0, rr); g.arcTo(0, 0, 320, 0, rr); g.closePath(); g.fill();
    g.font = "bold 30px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = accent;
    g.fillText(text, 160, 38);
    labelTex.needsUpdate = true;
  }

  // ---- token placement ----------------------------------------------------
  function tokenPos(color, idx) {
    const step = s.tokens[color] ? s.tokens[color][idx] : 0;
    if (step === 0) {
      const [yc, yr] = YARD[color][idx];
      return { x: gx(yc), z: gz(yr) };
    }
    if (step >= 57) {
      // fan finished tokens around the centre
      const ang = (idx / 4) * Math.PI * 2;
      return { x: gx(7) + Math.cos(ang) * cell * 0.5, z: gz(7) + Math.sin(ang) * cell * 0.5 };
    }
    const cl = cellOf(color, step);
    return { x: gx(cl[0]), z: gz(cl[1]) };
  }

  // ---- render -------------------------------------------------------------
  let pulse = 0;
  // Drive visible colours from the WIRE's s.order, not the local build-time
  // `order`. Ambient/spectator mounts are always created at seatCount=4 (so
  // local `order` is length 4), but the real match may be 2- or 3-player — its
  // s.order tells us which colours are actually in play. Hiding the rest stops
  // phantom idle tokens/rings/quads of unused colours on a watcher's board.
  const inPlay = (c) => (Array.isArray(s.order) ? s.order.includes(c) : order.includes(c));
  function render() {
    const active = curColor(s);
    const activeSeat = curSeat(s);

    // Iterate ALL colours (meshes exist for every colour); inPlay() hides those
    // not present in the live wire s.order, so a snapshot with more colours than
    // this client's local seatCount still renders every active colour.
    for (const c of COLORS) {
      const shown = inPlay(c);
      // Hide all geometry of a colour that is not part of the live match.
      if (quadMeshes[c]) quadMeshes[c].visible = shown;
      if (homeTiles[c]) for (const t of homeTiles[c]) t.visible = shown;
      for (let i = 0; i < 4; i++) {
        if (tokenMeshes[c] && tokenMeshes[c][i]) tokenMeshes[c][i].visible = shown;
        if (ringMeshes[c] && ringMeshes[c][i] && !shown) ringMeshes[c][i].visible = false;
      }
      if (!shown) continue;

      const isActive = c === active && s.phase === "play";
      // identity: brighten the LOCAL player's own colour always; pulse the
      // active player's colour so whose-turn reads even for spectators.
      const mine = c === myColor;
      tokMat[c].emissiveIntensity = mine ? 0.3 : 0.0;
      quadMat[c].emissiveIntensity = isActive ? 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(pulse * 4)) : (mine ? 0.12 : 0.0);

      for (let i = 0; i < 4; i++) {
        const p = tokenPos(c, i);
        const tg = tokenMeshes[c][i];
        tg.position.set(p.x, TOP, p.z);

        const movable = s.phase === "play" && s.awaiting && c === active && legalMoves(s, c).includes(i);
        // legal-move ring only on the LOCAL player's own movable tokens.
        const ring = ringMeshes[c][i];
        ring.visible = movable && c === myColor;
        if (ring.visible) {
          ring.position.set(p.x, TOP + 0.02, p.z);
          ring.scale.setScalar(1 + 0.12 * (0.5 + 0.5 * Math.sin(pulse * 6)));
        }
        tg.scale.setScalar(movable ? 1.12 : 1);
      }
    }

    // die
    const showDie = s.die != null;
    dieGroup.visible = showDie;
    if (showDie) {
      const col = PALETTE.ludo[active] || "#fafafa";
      M.die.color.set(col);
      showDieValue(s.die);
      // Hold the die still while a value is shown so the single lit (+Y) face
      // reads cleanly; a continuous Y-spin makes 2/3/6 pip patterns ambiguous.
      dieGroup.rotation.y = 0;
    }
    void activeSeat;
    refreshLabel();
  }

  function update(dt) {
    pulse += (dt || 0.016);
    // cheap continuous refresh of the pulsing cues without rebuilding geometry
    const active = curColor(s);
    for (const c of COLORS) {
      const isActive = c === active && s.phase === "play";
      const mine = c === myColor;
      quadMat[c].emissiveIntensity = isActive ? 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(pulse * 4)) : (mine ? 0.12 : 0.0);
    }
    if (s.die != null) dieGroup.rotation.y = 0;
    if (s.phase === "play" && s.awaiting) {
      for (const c of COLORS) {
        if (c !== myColor) continue;
        const moves = legalMoves(s, c);
        for (let i = 0; i < 4; i++) {
          const ring = ringMeshes[c][i];
          if (ring.visible && moves.includes(i)) {
            ring.scale.setScalar(1 + 0.12 * (0.5 + 0.5 * Math.sin(pulse * 6)));
          }
        }
      }
    }
  }

  // ---- host authority -----------------------------------------------------
  function hostRoll() {
    if (s.phase !== "play" || s.die != null) return;
    const color = curColor(s);
    s.die = 1 + Math.floor(Math.random() * 6);
    if (s.die === 6) {
      s.sixes++;
      if (s.sixes >= 3) { nextTurn(s); pushState(); return; } // three 6s -> forfeit turn
    }
    const moves = legalMoves(s, color);
    // Broadcast the rolled die NOW so watchers (spectators/passersby/seated
    // opponent) actually see the die face — before any forced auto-resolve
    // calls nextTurn(), which would clear s.die before it ever crosses the wire.
    pushState();
    if (moves.length === 0) {
      // no legal move: a 6 still ends the turn here (nothing to advance);
      // simpler + avoids an infinite re-roll loop.
      nextTurn(s);
      pushState();
      return;
    }
    if (moves.length === 1) { hostApply(moves[0]); return; }
    s.awaiting = true;
    pushState();
  }

  function hostApply(idx) {
    const color = curColor(s);
    if (!Number.isInteger(s.die) || !legalMoves(s, color).includes(idx)) return;
    const was6 = s.die === 6;
    const res = applyTokenMove(s, color, idx);
    s = res.ns;
    if (allHome(s, color)) {
      s.phase = "over";
      s.winner = color;
      s.die = null;
      s.awaiting = false;
      pushState();
      try { ctx.onGameOver({ winner: color, reason: "home" }); } catch { /* */ }
      return;
    }
    // Bonus roll for the same player on a 6 OR on a capture (standard Ludo).
    if (was6 || res.captured) { s.die = null; s.awaiting = false; }
    else nextTurn(s);
    pushState();
  }

  function pushState() {
    render();
    if (!isHost()) return;
    const snap = clone(s);
    try { ctx.net.sendState(snap, snap); } catch { /* */ }
  }
  function publicState() { return clone(s); }

  // ---- contract -----------------------------------------------------------
  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed() || myColor == null) return;
    if (seatIndex !== curSeat(s)) return;              // off-turn seat gate
    if (s.phase !== "play" || curColor(s) !== myColor) return;
    if (s.die == null) {
      // a click rolls the die
      if (isHost()) hostRoll();
      else { try { ctx.net.sendMove({ type: "roll", color: myColor }); } catch { /* */ } }
      return;
    }
    // die rolled: must pick a legal token of our own colour
    const c = hit && hit.cell;
    if (!s.awaiting || !c || c.color !== myColor || !Number.isInteger(c.token)) return;
    if (!legalMoves(s, myColor).includes(c.token)) return;
    if (isHost()) hostApply(c.token);
    else { try { ctx.net.sendMove({ type: "move", token: c.token, color: myColor }); } catch { /* */ } }
  }

  function applyMove(move, byRole, by) {
    if (!isHost()) return true; // guests/spectators render via snapshots
    if (!move) return false;
    if (s.phase !== "play") return true;
    // Per-seat turn enforcement: the server stamps by.seatIndex; byRole alone
    // can't tell 3-4 guest seats apart. Reject off-turn seats -> resync.
    const moverSeat = by && Number.isInteger(by.seatIndex)
      ? by.seatIndex
      : (byRole === "host" ? 0 : null);
    if (moverSeat !== curSeat(s)) return false;
    if (move.type === "roll") { hostRoll(); return true; }
    if (move.type === "move" && Number.isInteger(move.token)) {
      if (s.awaiting) hostApply(move.token);
      return true;
    }
    return false;
  }

  function applyState(state) {
    // NEVER recompute local role/colour from the wire — only token/turn data.
    if (!state) {
      s = freshState();
    } else {
      s = {
        tokens: Object.fromEntries(COLORS.map((c) => [
          c,
          (state.tokens && Array.isArray(state.tokens[c]))
            ? state.tokens[c].slice(0, 4).map((n) => Math.max(0, Math.min(57, n | 0)))
            : [0, 0, 0, 0],
        ])),
        order: Array.isArray(state.order) && state.order.length ? state.order.slice() : order.slice(),
        turn: (state.turn | 0),
        die: Number.isInteger(state.die) && state.die >= 1 && state.die <= 6 ? state.die : null,
        awaiting: !!state.awaiting,
        sixes: state.sixes | 0,
        phase: state.phase === "over" ? "over" : "play",
        winner: COLORS.includes(state.winner) ? state.winner : null,
      };
      if (s.turn >= s.order.length || s.turn < 0) s.turn = 0;
    }
    render();
  }

  // ---- live re-seat / re-orient -------------------------------------------
  function setRole(r, idx) {
    role = r || "spectator";
    if (idx !== undefined) seatIndex = Number.isInteger(idx) ? idx : null;
    myColor = role === "spectator" || seatIndex == null ? null : COLORS[seatIndex] || null;
    applyFacing(seatRy);
    render();
  }
  function setSeatRy(ry) { applyFacing(ry); }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  // ---- mount --------------------------------------------------------------
  applyFacing(seatRy);
  render();
  if (isHost()) pushState();

  // orientPolicy "self": the framework must not also rotate our group.
  return {
    group,
    // Snapshot-driven: a spectator's applyMove is a no-op (renders only from
    // authoritative snapshots), so board.js must NOT swallow the host's post-move
    // snapshot — that snapshot is the only state a spectator ever sees for a
    // guest-initiated roll/move. See InWorldBoard._onMove (BUG 1).
    spectatorAnimates: false,
    applyState,
    applyMove,
    onPointer,
    publicState,
    update,
    setRole,
    setSeatRy,
    dispose,
    orientPolicy: "self",
  };
}

export default createGame;
