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
// Token step model: 0 = yard, 1..52 = shared track squares (step 52 is the
// owner's home-entry square, the track tile directly feeding the home column),
// 53..58 = home column (58 = finished/centre). The shared track is the canonical
// 52-square clockwise ludo loop; each colour enters at its START offset.

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
// steps 53..58; step 58 is rendered at the centre as "finished".
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
  if (step <= 52) return TRACK[absSquare(color, step)];
  if (step <= 58) return HOME[color][Math.min(step - 53, 5)];
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
    } else if (step < 58 && step + s.die <= 58) {
      out.push(i); // exact-count finish; can't overshoot 58
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
  if (step > 58) return { ns, captured }; // illegal overshoot guard (shouldn't happen)
  ns.tokens[color][idx] = step;
  // Capture: landing on a non-safe shared-track square sends opponents home.
  if (step >= 1 && step <= 52) {
    const sq = absSquare(color, step);
    if (!SAFE.has(sq)) {
      for (const oc of ns.order) {
        if (oc === color) continue;
        for (let j = 0; j < 4; j++) {
          const os = ns.tokens[oc][j];
          if (os >= 1 && os <= 52 && absSquare(oc, os) === sq) { ns.tokens[oc][j] = 0; captured = true; }
        }
      }
    }
  }
  return { ns, captured };
}

const allHome = (s, color) => s.tokens[color].every((t) => t === 58);
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
  const ringMat = {};      // colour -> legal-move ring tinted to that identity (I6)
  for (const c of COLORS) {
    tokMat[c] = keep(standard(THREE, PALETTE.ludo[c], { roughness: 0.45, emissive: PALETTE.ludo[c], emissiveIntensity: 0.0 }));
    tokDarkMat[c] = keep(standard(THREE, PALETTE.ludoDark[c], { roughness: 0.55 }));
    quadMat[c] = keep(standard(THREE, PALETTE.ludo[c], { roughness: 0.85, transparent: true, opacity: 0.4, emissive: PALETTE.ludo[c], emissiveIntensity: 0.0 }));
    pathMat[c] = keep(standard(THREE, PALETTE.ludo[c], { roughness: 0.85, transparent: true, opacity: 0.55 }));
    ringMat[c] = keep(standard(THREE, PALETTE.ludo[c], { emissive: PALETTE.ludo[c], emissiveIntensity: 0.7, transparent: true, opacity: 0.7, depthWrite: false }));
  }
  const safeMat = keep(standard(THREE, "#e8d9b6", { roughness: 0.85, emissive: "#caa84a", emissiveIntensity: 0.25 }));
  const glowMat = keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, depthWrite: false }));
  // Thin dark collar under every token so all four colours (esp. yellow on the
  // cream board) read crisply from both seats (I4). Shared across all tokens.
  const collarMat = keep(standard(THREE, "#241a10", { roughness: 0.7, transparent: true, opacity: 0.55, depthWrite: false }));
  // Reusable flourish glow ring (capture/finish/win) — derived from snapshot
  // diffs so host/guest/spectator all see it (I3).
  const fxMat = keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.9, transparent: true, opacity: 0.0, depthWrite: false }));

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

  // Unit vector from the board centre toward a colour's home quadrant (canonical
  // layoutRoot frame). Shared by the jail rails (#9) and the die turn-pointer (#1).
  function dieDirOf(c) {
    const [qc, qr] = QUAD[c];
    const dx = gx(qc) - gx(7);
    const dz = gz(qr) - gz(7);
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

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
  // Flat dark collar ring that hugs the base — a crisp dark outline against the
  // light board for every colour (I4).
  const collarGeo = keep(new THREE.TorusGeometry(cell * 0.36, cell * 0.045, 6, 20));
  const tokenMeshes = {}; // colour -> [groupMesh,...]
  // Animated display position per token (parallel to logical tokenPos); render()
  // sets the target, update() eases the cone toward it so steps/captures glide
  // and hop instead of teleporting (B2). Keyed [color][idx] — NOT a string key,
  // so update()'s hot loop allocates nothing.
  const tokAnim = {};
  for (const c of COLORS) tokAnim[c] = [];
  for (const c of COLORS) {
    tokenMeshes[c] = [];
    for (let i = 0; i < 4; i++) {
      const tg = new THREE.Group();
      const cone = meshOf(THREE, tokenGeo, tokMat[c]);
      cone.position.y = cell * 0.5;
      const base = meshOf(THREE, baseGeo, tokDarkMat[c]);
      base.position.y = cell * 0.06;
      const collar = meshOf(THREE, collarGeo, collarMat, false);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = cell * 0.02;
      tg.add(collar);
      tg.add(base);
      tg.add(cone);
      // hit-test target: tag the whole token group so a click on cone OR base resolves.
      tg.userData.cell = { color: c, token: i };
      cone.userData.cell = { color: c, token: i };
      base.userData.cell = { color: c, token: i };
      layoutRoot.add(tg);
      tokenMeshes[c].push(tg);
      tokAnim[c][i] = { x: 0, z: 0, cx: 0, cz: 0, t: 1, moving: false, lift: 0, pop: 0, jailT: 0, jx: 0, jz: 0 };
    }
  }

  // ---- legal-move glow rings ----------------------------------------------
  const ringGeo = keep(new THREE.TorusGeometry(cell * 0.42, cell * 0.07, 8, 22));
  const ringMeshes = {}; // colour -> [ring,...]
  for (const c of COLORS) {
    ringMeshes[c] = [];
    for (let i = 0; i < 4; i++) {
      // tint the "you can move this" ring to the player's own identity colour (I6).
      const ring = meshOf(THREE, ringGeo, ringMat[c], false);
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      layoutRoot.add(ring);
      ringMeshes[c].push(ring);
    }
  }

  // ---- flourish FX rings (capture / finish / win) -------------------------
  // Small pool of expanding glow rings, reused across events; no per-frame alloc.
  const fxRingGeo = keep(new THREE.TorusGeometry(cell * 0.5, cell * 0.08, 8, 24));
  const fxPool = [];
  for (let i = 0; i < 4; i++) {
    // own material clone per ring so overlapping flourishes fade independently.
    const m = keep(fxMat.clone());
    const fx = meshOf(THREE, fxRingGeo, m, false);
    fx.rotation.x = Math.PI / 2;
    fx.visible = false;
    layoutRoot.add(fx);
    fxPool.push({ mesh: fx, mat: m, t: 0, life: 0, x: 0, z: 0 });
  }
  function spawnFx(x, z, color) {
    let slot = fxPool.find((f) => f.life <= 0);
    if (!slot) slot = fxPool[0];
    slot.x = x; slot.z = z; slot.t = 0; slot.life = 0.7;
    const hex = (color && PALETTE.ludo[color]) || PALETTE.accent;
    slot.mat.color.set(hex);
    slot.mat.emissive.set(hex);
    slot.mesh.position.set(x, TOP + 0.025, z);
    slot.mesh.visible = true;
  }

  // ---- captured-token jail rails (steal the checkers tray pattern, #9) -----
  // A thin per-colour rail seated on the frame just outside each colour's home
  // corner. On a capture (detected via the prevTokens diff) the struck token arcs
  // to a jail slot, rests there ~0.6 s, then settles back into its yard — so a
  // capture reads as a deliberate "sent to jail" beat for host/guest/spectator
  // alike (pure diff-driven). Rails live in layoutRoot so jail slot coords share
  // the token meshes' frame; the per-colour quarter-turn carries each rail to its
  // own corner regardless of which seat is local.
  const jailMat = {};
  const jailSlots = {};   // colour -> [{x,z}, x4]  (layoutRoot-local rest spots)
  const railLen = cell * 1.7;
  const jailRailGeo = keep(new THREE.BoxGeometry(railLen, 0.004, cell * 0.5));
  const jailEdge = BOARD_HALF + cell * 0.42;       // on the frame shoulder
  // Outward radial direction for each colour's home corner (canonical frame).
  for (const c of COLORS) {
    jailMat[c] = keep(standard(THREE, PALETTE.ludoDark[c], { roughness: 0.7, emissive: PALETTE.ludo[c], emissiveIntensity: 0.18 }));
    const dir = dieDirOf(c);                        // unit vector centre -> quad
    // place the rail on the frame, offset outward along the corner's radial dir.
    const rx = gx(7) + dir.x * jailEdge;
    const rz = gz(7) + dir.z * jailEdge;
    const rail = meshOf(THREE, jailRailGeo, jailMat[c], false);
    rail.position.set(rx, TOP + 0.004, rz);
    // orient the long axis perpendicular to the radial so it hugs the corner.
    rail.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    layoutRoot.add(rail);
    // 4 evenly spaced slots along the rail's long axis (perpendicular to radial).
    const px = -dir.z, pz = dir.x;                  // perpendicular unit vector
    jailSlots[c] = [];
    for (let i = 0; i < 4; i++) {
      const t = (i - 1.5) * (railLen / 4);
      jailSlots[c].push({ x: rx + px * t, z: rz + pz * t });
    }
  }

  // ---- last-move landing ring (#10) ---------------------------------------
  // One shared flat ring that briefly haloes the tile a token just landed on, so
  // the eye is drawn to what changed. Driven from the prevTokens diff (lastMoveTok),
  // so host/guest/spectator all see it. Tinted to the moved token's colour.
  const lastMoveRingGeo = keep(new THREE.TorusGeometry(cell * 0.5, cell * 0.06, 8, 24));
  const lastMoveRingMat = keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.85, transparent: true, opacity: 0.0, depthWrite: false }));
  const lastMoveRing = meshOf(THREE, lastMoveRingGeo, lastMoveRingMat, false);
  lastMoveRing.rotation.x = Math.PI / 2;
  lastMoveRing.visible = false;
  layoutRoot.add(lastMoveRing);
  let lastMoveT = 0;          // countdown while the landing ring shows
  let lastMoveColor = "red";  // colour of the token that just moved (tints ring)

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
  // Float the die above the board, and slide it OFF the dead-centre toward the
  // active player's home quadrant (#1/#12). This (a) lifts the die clear of the
  // finished-token fan around the centre plate, and (b) doubles as an unambiguous
  // "it's this seat's turn" pointer that reads from every chair. The XZ target is
  // recomputed each render in dieTarget(); rest Y stays fixed.
  const dieRestY = TOP + dieSize * 1.05;
  // Distance from centre toward the active quadrant — large enough to clear the
  // finish fan (radius cell*0.78 + cone base) but inside the home columns.
  const DIE_PUSH = cell * 2.1;
  function dieTarget() {
    const dir = dieDirOf(curColor(s));
    return { x: gx(7) + dir.x * DIE_PUSH, z: gz(7) + dir.z * DIE_PUSH };
  }
  dieGroup.position.set(gx(7), dieRestY, gz(7));
  dieGroup.visible = false;
  layoutRoot.add(dieGroup);

  // ---- whose-turn / identity placard --------------------------------------
  let labelCv = null, labelTex = null, labelMat = null, labelMesh = null;
  try {
    labelCv = document.createElement("canvas");
    labelCv.width = 320; labelCv.height = 96;
    labelTex = keep(new THREE.CanvasTexture(labelCv));
    labelTex.colorSpace = THREE.SRGBColorSpace;
    labelMat = keep(new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }));
    const lw = BOARD_SIZE * 0.62;
    const labelGeo = keep(new THREE.PlaneGeometry(lw, lw * (96 / 320)));
    labelMesh = meshOf(THREE, labelGeo, labelMat, false);
    labelMesh.rotation.x = -Math.PI / 2;
    // Placard sits on the canonical near (-Z) edge of the OUTER group, so after
    // orientFor(seatRy) it lands at the local player's near edge. It is NOT a
    // child of layoutRoot, so it never inherits the colour quarter-turn.
    // Pushed out to -BOARD_HALF-0.067 so the taller (96px) placard's inner edge
    // still clears the board edge (-0.35) — inner edge ≈ -0.352, ~2 mm of margin.
    labelMesh.position.set(0, TOP + 0.004, -BOARD_HALF - 0.067);
    group.add(labelMesh);
  } catch { /* no DOM (test/headless) — skip placard */ }

  function refreshLabel() {
    if (!labelCv) return;
    const g = labelCv.getContext("2d");
    g.clearRect(0, 0, 320, 96);
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
    const showBanner = bannerT > 0 && bannerText;
    g.save();
    // The placard is a flat plane on the canonical near (-Z) edge of the OUTER
    // group, which per-seat self-orientation always brings to the seated viewer.
    // After rotation.x = -PI/2 its top face reads 180° rotated from the seat, so
    // text shows upside-down. Pre-rotate the canvas content 180° once so it reads
    // upright for every chair (matches ultimatettt.js / battleship.js).
    g.translate(160, 48);
    g.rotate(Math.PI);
    g.translate(-160, -48);
    g.fillStyle = "rgba(26,18,10,0.84)";
    const rr = 14;
    g.beginPath();
    g.moveTo(rr, 0); g.arcTo(320, 0, 320, 96, rr); g.arcTo(320, 96, 0, 96, rr);
    g.arcTo(0, 96, 0, 0, rr); g.arcTo(0, 0, 320, 0, rr); g.closePath(); g.fill();
    g.font = "bold 30px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = accent;
    // Lift the identity line up a touch when a banner shows so both read clearly.
    g.fillText(text, 160, showBanner ? 30 : 48);
    if (showBanner) {
      // fade the banner over its tail so it dissolves rather than blinks out.
      const a = Math.min(1, bannerT / 0.35);
      g.globalAlpha = a;
      g.font = "bold 22px sans-serif";
      g.fillStyle = bannerColor;
      g.fillText(bannerText, 160, 70);
      g.globalAlpha = 1;
    }
    g.restore();
    labelTex.needsUpdate = true;
  }

  // ---- token placement ----------------------------------------------------
  const idxKey = (color, idx) => COLORS.indexOf(color) * 4 + idx;
  // All in-play tokens sharing the SAME visual grid cell as (color,step), as a
  // stable-ordered list of idxKeys (sorted, so every viewer fans them identically).
  // Used only to offset z-fighting co-located cones (#5/#6) — never affects rules.
  function coLocated(color, step) {
    const cl = cellOf(color, step);
    if (!cl) return [];
    const peers = [];
    for (const c of COLORS) {
      if (!inPlay(c)) continue;
      const toks = s.tokens[c];
      if (!toks) continue;
      for (let i = 0; i < 4; i++) {
        const st = toks[i];
        if (st < 1 || st > 57) continue;
        const ocl = cellOf(c, st);
        if (ocl && ocl[0] === cl[0] && ocl[1] === cl[1]) peers.push(idxKey(c, i));
      }
    }
    peers.sort((a, b) => a - b);
    return peers;
  }

  function tokenPos(color, idx) {
    const step = s.tokens[color] ? s.tokens[color][idx] : 0;
    if (step === 0) {
      const [yc, yr] = YARD[color][idx];
      return { x: gx(yc), z: gz(yr) };
    }
    if (step >= 58) {
      // fan finished tokens around the centre; add a per-colour phase so finished
      // cones of different colours don't land on the same point and z-fight in
      // 3-4 player endgames. Radius widened to cell*0.78 (from 0.5) so 4 cones of
      // one colour no longer overlap bases (#2) and so the floating die's footprint
      // at the centre clears the fan (#1).
      const ang = (idx / 4) * Math.PI * 2 + COLORS.indexOf(color) * (Math.PI / 8);
      return { x: gx(7) + Math.cos(ang) * cell * 0.78, z: gz(7) + Math.sin(ang) * cell * 0.78 };
    }
    const cl = cellOf(color, step);
    let x = gx(cl[0]);
    let z = gz(cl[1]);
    // Same-square stacking fan (#5/#6): when >1 token shares this exact board cell
    // (own doubled square OR opponents co-located on a safe square) the cones land
    // on the same point and z-fight, reading as one piece. Spread co-located tokens
    // along a short perpendicular line so each piece stays visible. Purely a render
    // offset — capture logic keys on the square, not the mesh, so rules are unchanged.
    if (step >= 1 && step <= 57) {
      const peers = coLocated(color, step);
      if (peers.length > 1) {
        const myRank = peers.indexOf(idxKey(color, idx));
        const spread = cell * 0.2;
        const o = (myRank - (peers.length - 1) / 2) * spread;
        // Spread along an axis derived from the SHARED cell (perpendicular to the
        // cell's radial from the board centre) so every co-located token — even of
        // different colours — fans along the SAME line into a tidy row, never a
        // scatter. Falls back to the X axis at the dead centre.
        const rdx = x - gx(7), rdz = z - gz(7);
        const rl = Math.hypot(rdx, rdz);
        const px = rl > 1e-4 ? -rdz / rl : 1;
        const pz = rl > 1e-4 ? rdx / rl : 0;
        x += px * o;
        z += pz * o;
      }
    }
    return { x, z };
  }

  // ---- render -------------------------------------------------------------
  let pulse = 0;
  // Drive visible colours from the WIRE's s.order, not the local build-time
  // `order`. Ambient/spectator mounts are always created at seatCount=4 (so
  // local `order` is length 4), but the real match may be 2- or 3-player — its
  // s.order tells us which colours are actually in play. Hiding the rest stops
  // phantom idle tokens/rings/quads of unused colours on a watcher's board.
  const inPlay = (c) => (Array.isArray(s.order) ? s.order.includes(c) : order.includes(c));

  // ---- diff-driven flourish + animation state -----------------------------
  // Remembered snapshot fields so render() can detect deltas (capture/finish/win,
  // a fresh die roll) and drive purely-visual flourishes the same way for host,
  // guest, and spectator (all of whom reach render() via applyState/pushState).
  let prevTokens = null;     // { color: [steps] } from the last render
  let prevDie = null;        // last shown die value (null when hidden)
  let prevPhase = "play";
  let prevTurn = 0;          // last rendered turn index (banner diff, #11)
  let prevSixes = 0;         // last rendered six-streak (three-6s forfeit banner, #8)
  let winFx = 0;             // countdown that drives the win celebration
  let dieAnimT = 0;          // die tumble timer (>0 while tumbling)
  let myMovable = [];        // cached indices of the LOCAL colour's movable tokens
  let hoverTok = -1;         // index of the locally-hovered own token (I2)
  // Transient micro-banner shown under the placard for ~1.4 s (#11). Diff-driven
  // off the snapshot stream so every viewer (host/guest/spectator) sees the same
  // "Bonus roll!" / "No move" beat. { text, color } while active; time in bannerT.
  let bannerT = 0;
  let bannerText = "";
  let bannerColor = "#f0e4cf";
  let lastMoveTok = null;    // { color, idx } of the most recently advanced token (#10)

  function render() {
    const active = curColor(s);
    const activeSeat = curSeat(s);

    // --- detect snapshot deltas for flourishes (host/guest/spectator-safe) ---
    let captureHappened = false;
    let someTokenAdvanced = false;
    if (prevTokens) {
      for (const c of COLORS) {
        if (!inPlay(c)) continue;
        const now = s.tokens[c], was = prevTokens[c];
        if (!now || !was) continue;
        for (let i = 0; i < 4; i++) {
          // capture: an opponent token was reset to the yard (>0 -> 0). Burst the
          // glow at the square where it was hit (its prior board cell), then send
          // the struck token on a jail detour before it settles in the yard (#9).
          if (was[i] > 0 && was[i] <= 52 && now[i] === 0) {
            const cl = cellOf(c, was[i]);
            if (cl) spawnFx(gx(cl[0]), gz(cl[1]), c);
            const a = tokAnim[c][i];
            if (a) {
              a.pop = 1;                 // scale-pop as it arcs home
              const slot = jailSlots[c] && jailSlots[c][i];
              if (slot) { a.jailT = 0.6; a.jx = slot.x; a.jz = slot.z; }
            }
            captureHappened = true;
          } else if (was[i] < 58 && now[i] === 58) {
            // finish: a token reached the centre.
            const fp = tokenPos(c, i);
            spawnFx(fp.x, fp.z, c);
            const a = tokAnim[c][i];
            if (a) a.pop = 1;
            lastMoveTok = { color: c, idx: i }; lastMoveColor = c; lastMoveT = 1.1;
          } else if (now[i] > was[i] && now[i] > 0) {
            // a token advanced: mark it the just-moved piece so its landing tile
            // gets a brief halo ring (#10). Diff-driven -> all viewers see it.
            someTokenAdvanced = true;
            lastMoveTok = { color: c, idx: i }; lastMoveColor = c; lastMoveT = 1.1;
          }
        }
      }
    }
    if (prevPhase !== "over" && s.phase === "over") winFx = 2.4; // win celebration
    prevPhase = s.phase;

    // fresh die roll: trigger a short tumble (I1).
    if (s.die != null && prevDie !== s.die) dieAnimT = 0.42;

    // --- transient micro-banner (#11), purely diff-driven ---
    // A snapshot that CLEARS the die (prevDie set -> now null) in the play phase
    // tells the story of the prior roll's outcome:
    //   * turn unchanged  -> the same player keeps rolling: a bonus (6 or capture).
    //   * turn advanced + nobody moved -> the roll had no legal move: passing.
    if (prevTokens != null && s.phase === "play" && prevDie != null && s.die == null) {
      if (s.turn === prevTurn) {
        bannerText = captureHappened ? "Capture! Bonus roll" : "Bonus roll!";
        bannerColor = PALETTE.ludo[curColor(s)] || "#f0e4cf";
        bannerT = 1.4;
      } else if (prevDie === 6 && prevSixes >= 3) {
        // the prior snapshot was the third six in a row -> turn forfeited (#8).
        bannerText = "Three 6s — turn passes";
        bannerColor = "#e8dcc4";
        bannerT = 1.4;
      } else if (!someTokenAdvanced && !captureHappened) {
        bannerText = "No move — passing";
        bannerColor = "#e8dcc4";
        bannerT = 1.4;
      }
    }
    prevDie = s.die;
    prevTurn = s.turn;
    prevSixes = s.sixes | 0;

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

      const myCache = mine ? [] : null;
      for (let i = 0; i < 4; i++) {
        const p = tokenPos(c, i);
        const a = tokAnim[c][i];
        const tg = tokenMeshes[c][i];
        // Set the ANIMATION TARGET (eased in update); seed display pos on first
        // render so tokens don't slide in from origin at mount.
        if (a) {
          if (prevTokens == null) {
            a.cx = p.x; a.cz = p.z; a.x = p.x; a.z = p.z; a.t = 1; a.moving = false;
            tg.position.set(p.x, TOP, p.z); // seed so render-only mounts are placed
          } else if (a.x !== p.x || a.z !== p.z) {
            a.x = p.x; a.z = p.z; a.t = 0; a.moving = true;
          }
        }

        const movable = s.phase === "play" && s.awaiting && c === active && legalMoves(s, c).includes(i);
        if (myCache && movable) myCache.push(i);
        // legal-move ring only on the LOCAL player's own movable tokens.
        const ring = ringMeshes[c][i];
        ring.visible = movable && c === myColor;
        // position is finalised per-frame in update() from the eased display pos.
      }
      if (myCache) myMovable = myCache;
    }

    // die
    const showDie = s.die != null;
    // Seed the die's XZ to the active quadrant target the frame it (re)appears so
    // it pops in at the turn pointer instead of sliding from the previous seat.
    if (showDie && !dieGroup.visible) {
      const tgt = dieTarget();
      dieGroup.position.x = tgt.x;
      dieGroup.position.z = tgt.z;
    }
    dieGroup.visible = showDie;
    if (showDie) {
      const col = PALETTE.ludo[active] || "#fafafa";
      M.die.color.set(col);
      showDieValue(s.die);
    }
    void activeSeat;

    // snapshot for the next diff (deep-copy step arrays only).
    prevTokens = {};
    for (const c of COLORS) prevTokens[c] = s.tokens[c] ? s.tokens[c].slice() : [0, 0, 0, 0];

    refreshLabel();
  }

  function update(dt) {
    const d = dt || 0.016;
    pulse += d;
    const active = curColor(s);
    const wave = 0.5 + 0.5 * Math.sin(pulse * 4);
    const ringWave = 0.5 + 0.5 * Math.sin(pulse * 6);

    // colour cues: active quad + active TOKENS breathe together (B4); local
    // colour stays brightened; win celebration overrides with a slow pulse.
    const celebrate = winFx > 0 ? 0.5 + 0.5 * Math.sin(pulse * 5) : 0;
    for (const c of COLORS) {
      const isActive = c === active && s.phase === "play";
      const mine = c === myColor;
      const isWinner = s.phase === "over" && c === s.winner;
      quadMat[c].emissiveIntensity = isWinner
        ? 0.25 + 0.35 * celebrate
        : (isActive ? 0.22 + 0.18 * wave : (mine ? 0.12 : 0.0));
      tokMat[c].emissiveIntensity = isWinner
        ? 0.3 + 0.3 * celebrate
        : (isActive ? 0.12 + 0.16 * wave : (mine ? 0.3 : 0.0));
    }
    if (winFx > 0) winFx = Math.max(0, winFx - d);

    // ease each token toward its target XZ with a small hop arc + capture pop.
    for (const c of COLORS) {
      if (!inPlay(c)) continue;
      for (let i = 0; i < 4; i++) {
        const a = tokAnim[c][i];
        const tg = tokenMeshes[c][i];
        if (!a || !tg) continue;
        let y = TOP;
        // jail detour (#9): a captured token first arcs to its jail slot and rests
        // there while jailT counts down, THEN releases toward its yard target. The
        // ease target is the jail slot during the detour, the real (x,z) after.
        let tx = a.x, tz = a.z;
        if (a.jailT > 0) {
          a.jailT = Math.max(0, a.jailT - d);
          tx = a.jx; tz = a.jz;
          a.moving = false;          // the jail arc owns the lift while parked
          y = TOP + cell * 0.06;     // sit slightly proud on the rail
        } else if (a.moving) {
          a.t = Math.min(1, a.t + d * 3.2);
          y = TOP + Math.sin(a.t * Math.PI) * cell * 0.45; // hop arc over the move
          if (a.t >= 1) { a.moving = false; a.cx = a.x; a.cz = a.z; }
        }
        // critically-damped glide of the display position toward the target so a
        // step reads as a smooth hop and a capture as an arc back to the yard.
        const k = Math.min(1, d * 11);
        a.cx += (tx - a.cx) * k;
        a.cz += (tz - a.cz) * k;
        // hover lift for the locally-hovered own movable token (I2).
        const hovered = c === myColor && hoverTok === i;
        const liftTarget = hovered ? cell * 0.35 : 0;
        a.lift += (liftTarget - a.lift) * Math.min(1, d * 12);
        tg.position.set(a.cx, y + a.lift, a.cz);

        // capture/finish scale pop (decays).
        if (a.pop > 0) a.pop = Math.max(0, a.pop - d * 2.2);
        const movable = myMovable.includes(i) && c === myColor;
        const popScale = a.pop > 0 ? 1 + 0.35 * Math.sin(a.pop * Math.PI) : 1;
        const hoverScale = hovered ? 1.12 : (movable ? 1.1 + 0.04 * ringWave : 1);
        tg.scale.setScalar(popScale * hoverScale);
      }
    }

    // pulse + reposition ONLY the cached local movable rings (B3); follow the
    // eased token so the ring rides with a gliding piece.
    if (s.phase === "play" && s.awaiting && myColor) {
      for (let i = 0; i < 4; i++) {
        const ring = ringMeshes[myColor][i];
        if (!ring || !ring.visible) continue;
        const a = tokAnim[myColor][i];
        ring.position.set(a.cx, TOP + 0.02, a.cz);
        ring.scale.setScalar(1 + 0.12 * ringWave);
      }
    }

    // die: brief tumble on a fresh roll, then settle to 0 so the lit +Y face
    // reads cleanly (I1). Its XZ eases toward the active player's quadrant so the
    // floating die also reads as a turn pointer (#1/#12).
    if (s.die != null) {
      const tgt = dieTarget();
      const ek = Math.min(1, d * 7);
      dieGroup.position.x += (tgt.x - dieGroup.position.x) * ek;
      dieGroup.position.z += (tgt.z - dieGroup.position.z) * ek;
      if (dieAnimT > 0) {
        dieAnimT = Math.max(0, dieAnimT - d);
        const f = dieAnimT / 0.42;            // 1 -> 0
        dieGroup.rotation.y = f * Math.PI * 4;
        dieGroup.rotation.x = f * Math.PI * 3;
        dieGroup.position.y = dieRestY + Math.sin((1 - f) * Math.PI) * cell * 0.5;
        if (dieAnimT === 0) { dieGroup.rotation.x = 0; dieGroup.rotation.y = 0; dieGroup.position.y = dieRestY; }
      } else {
        dieGroup.rotation.y = 0;
        dieGroup.rotation.x = 0;
        dieGroup.position.y = dieRestY;
      }
    }

    // advance flourish FX rings (expand + fade).
    for (const f of fxPool) {
      if (f.life <= 0) continue;
      f.t += d;
      const k = f.t / 0.7;                     // 0 -> 1
      f.mat.opacity = Math.max(0, 0.8 * (1 - k));
      const sc = 0.4 + 1.4 * k;
      f.mesh.scale.setScalar(sc);
      f.life -= d;
      if (f.life <= 0) { f.mesh.visible = false; f.mat.opacity = 0; }
    }

    // last-move landing ring (#10): ride the just-moved token's eased position and
    // fade over its life. Hidden once expired or if its token left the board.
    if (lastMoveT > 0 && lastMoveTok) {
      lastMoveT = Math.max(0, lastMoveT - d);
      const a = tokAnim[lastMoveTok.color] && tokAnim[lastMoveTok.color][lastMoveTok.idx];
      const stillThere = inPlay(lastMoveTok.color) && (s.tokens[lastMoveTok.color]?.[lastMoveTok.idx] || 0) > 0;
      if (a && stillThere) {
        const k = lastMoveT / 1.1;             // 1 -> 0
        lastMoveRing.visible = true;
        lastMoveRing.position.set(a.cx, TOP + 0.018, a.cz);
        lastMoveRing.scale.setScalar(0.85 + 0.5 * (1 - k));
        const hex = PALETTE.ludo[lastMoveColor] || PALETTE.accent;
        lastMoveRingMat.color.set(hex);
        lastMoveRingMat.emissive.set(hex);
        lastMoveRingMat.opacity = 0.7 * k;
      } else {
        lastMoveT = 0;
      }
    } else if (lastMoveRing.visible) {
      lastMoveRing.visible = false;
      lastMoveRingMat.opacity = 0;
    }

    // safe-square shimmer (#15): a slow shared sine on the single safe material's
    // emissive so star/start tiles read as "shelter". One material, no alloc.
    safeMat.emissiveIntensity = 0.18 + 0.14 * (0.5 + 0.5 * Math.sin(pulse * 2.2));

    // win podium (#13): once a colour wins, lift its 4 finished cones into a slow
    // rotating trophy cluster above the centre. Reuses the finished tokens already
    // parked at the centre fan; purely cosmetic, driven by the phase=over state so
    // host/guest/spectator all see it.
    if (s.phase === "over" && s.winner && inPlay(s.winner)) {
      const rise = TOP + cell * 0.7 + cell * 0.1 * (0.5 + 0.5 * Math.sin(pulse * 2));
      const spin = pulse * 0.7;
      for (let i = 0; i < 4; i++) {
        const tg = tokenMeshes[s.winner][i];
        if (!tg) continue;
        const ang = (i / 4) * Math.PI * 2 + spin;
        const r = cell * 0.55;
        tg.position.set(gx(7) + Math.cos(ang) * r, rise, gz(7) + Math.sin(ang) * r);
        tg.rotation.y = -spin;
      }
    }

    // transient micro-banner decay (#11): refresh the placard each frame while a
    // banner is active so its fade/dissolve animates; the redraw at the frame that
    // crosses zero clears it.
    if (bannerT > 0) {
      bannerT = Math.max(0, bannerT - d);
      refreshLabel();
    }
  }

  // ---- host authority -----------------------------------------------------
  function hostRoll() {
    if (s.phase !== "play" || s.die != null) return;
    const color = curColor(s);
    s.die = 1 + Math.floor(Math.random() * 6);
    if (s.die === 6) {
      s.sixes++;
      if (s.sixes >= 3) {
        // Three 6s -> forfeit turn. Broadcast the third six FIRST so watchers
        // actually see the rolled 6 (and the tumble) before the turn advances
        // and clears the die (#8). render()'s banner diff reads the prior
        // snapshot's sixes>=3 to label this a forfeit, not a generic "no move".
        pushState();
        nextTurn(s);
        pushState();
        return;
      }
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
    if (was6 || res.captured) {
      s.die = null;
      s.awaiting = false;
      // Standard Ludo resets the six-streak on any non-6; a capture bonus rolled
      // on a non-6 must not carry a stale streak into the 3-sixes forfeit (B5).
      if (!was6) s.sixes = 0;
    } else nextTurn(s);
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
            ? state.tokens[c].slice(0, 4).map((n) => Math.max(0, Math.min(58, n | 0)))
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

  // ---- hover affordance (I2) ----------------------------------------------
  // board.js routes a resolved cell (or -1) here, gated to the local turn. Lift +
  // highlight the locally-hovered own token only when it's a legal move so the
  // player previews exactly what a click will move. Purely visual; no rules/sync.
  function setHover(cell) {
    let next = -1;
    if (cell && cell !== -1 && cell.color === myColor && Number.isInteger(cell.token)
        && s.phase === "play" && s.awaiting && curColor(s) === myColor
        && myMovable.includes(cell.token)) {
      next = cell.token;
    }
    hoverTok = next;
  }

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
    setHover,
    dispose,
    orientPolicy: "self",
  };
}

export default createGame;
