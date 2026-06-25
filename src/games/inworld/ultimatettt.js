// Ultimate Tic-Tac-Toe — in-world 3D module (createGame contract). Full-info.
//
// Host = X (color A, moves first), guest = O (color B). 9 sub-boards × 9 cells.
// Move on the wire is { type:"move", B, i } where B is the sub-board (0..8) and
// i the cell within it (0..8). The cell you play (index i) dictates the sub-board
// the opponent is FORCED into next; if that sub-board is already decided/full the
// opponent may play anywhere (activeBoard === null).
//
// Identity/orientation/turn contract (see createGame.js + board.js):
//   * The LOCAL player's mark is derived ONCE from `role` (host=X, guest=O) and
//     is NEVER recomputed from a relayed snapshot — applyState only rebuilds the
//     shared game state, never myMark. This prevents a side-flip on the guest.
//   * X and O render in clearly distinct materials (warm red vs cool blue), and
//     each side gets its own "home" edge bar + turn lamp. The home bar in the
//     local player's OWN colour sits on the near (-Z) edge; the framework rotates
//     the whole group by orientFor(seatRy) so it ends up directly in front of the
//     seated viewer — host reads X-near, guest reads O-near, opposite-but-correct.
//   * The forced sub-board is highlighted for BOTH players at all times so the
//     constraint is unmistakable; the side-to-move's lamp glows (brighter when
//     it's the local player's turn) as the unmistakable whose-turn cue.
//   * Input is gated on ctx.isLocalTurnAllowed() AND turn === myMark AND legality.
//   * A spectator (myMark null, seatRy null) renders read-only from applyState and
//     never has input.
//
// VISUAL CONTRACT (purely local, never networked, never reads/writes the wire):
//   * A self-driven rAF clock (mirrors connect4) animates placement pops, the
//     whose-turn lamp pulse, the forced-board glow and the win flourish, then
//     PARKS when nothing is animating. dispose() cancels it.
//   * Animations are LOCAL render only and gated on a "just placed" flag, so a
//     full repaint (paint()/applyState — catch-up, resync, late join) SNAPS with
//     no animation. A relayed move on a spectator/guest still pops because their
//     applyMove → performMove sets that flag, and board.js's _specSkipSnapUntil
//     window swallows the host's redundant post-move snapshot (uttt does NOT set
//     spectatorAnimates:false, so the window is armed). Host/guest/spectator all
//     converge on identical synced state regardless of animation.

import { GameDesync } from "./createGame.js";
import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard } from "./pieces.js";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const other = (p) => (p === "X" ? "O" : "X");

// Winner of a 9-cell grid: "X" | "O" | "draw" | null. A grid is a draw only when
// every cell is filled with no line.
function winnerOf(cells) {
  for (const [a, b, c] of LINES)
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
  if (cells.every((v) => v)) return "draw";
  return null;
}

// Smooth ease-in-out for the local animations (no allocation, cheap).
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "ultimatettt";

  // ---- identity (derived ONCE from role; never from the wire) ----------------
  let role = ctx.role;
  let myMark = role === "host" ? "X" : role === "guest" ? "O" : null;

  // ---- shared game state -----------------------------------------------------
  let cells = Array.from({ length: 9 }, () => Array(9).fill(null)); // cells[B][i]
  let bigWinner = Array(9).fill(null); // "X" | "O" | "draw" | null per sub-board
  let turn = "X";                      // host (X) always moves first
  let activeBoard = null;              // forced sub-board index, or null = play anywhere
  let phase = "play";                  // "play" | "over"
  let winner = null;                   // "X" | "O" | null (null at over = draw)
  let lastMove = null;                 // { B, i } — for a subtle "just played" cue

  const owned = [];
  const keep = (x) => (owned.push(x), x);

  const MARK_HEX = { X: "#c4452f", O: "#4a85d6" };
  const M = {
    plank: keep(standard(THREE, "#3a281a", { roughness: 0.8 })),
    frame: keep(standard(THREE, PALETTE.frame, { roughness: 0.7 })),
    sub: keep(standard(THREE, "#e8d2ab", { roughness: 0.85 })),
    // Forced sub-board glows for everyone so the constraint reads at a glance.
    // Two tiers: subActive (soft) is the "play anywhere" free-choice lit state on
    // ALL undecided boards; subForced (stronger warm glow) marks the SINGLE board
    // you're forced into so "go here" is unmistakable vs "anywhere".
    subActive: keep(standard(THREE, "#fff0c8", { emissive: PALETTE.accent, emissiveIntensity: 0.32, roughness: 0.6 })),
    subForced: keep(standard(THREE, "#fff4d2", { emissive: "#ffbf40", emissiveIntensity: 0.85, roughness: 0.5 })),
    // Won sub-boards: keep the plate light/desaturated so the stamped big mark in
    // the winner's saturated colour stays legible from across the room (a blue O on
    // a blue plate or red X on a red plate washed out — I8). A thin emissive tint
    // still tells you which side owns it.
    subWonX: keep(standard(THREE, "#f3cfc6", { emissive: "#c4452f", emissiveIntensity: 0.22, roughness: 0.55 })),
    subWonO: keep(standard(THREE, "#c9dcf3", { emissive: "#4a85d6", emissiveIntensity: 0.22, roughness: 0.55 })),
    // Desaturated end-state variants: at game over, won sub-boards that are NOT on
    // the deciding meta-line drop to these muted, emissive-free plates so the three
    // winning boards (and their highlighted stamps) clearly pop as the result (I12).
    subWonXDim: keep(standard(THREE, "#d8c6c0", { roughness: 0.75 })),
    subWonODim: keep(standard(THREE, "#c2cad6", { roughness: 0.75 })),
    subDraw: keep(standard(THREE, "#9a8f7a", { roughness: 0.7 })),
    gutter: keep(standard(THREE, "#2a1d12", { roughness: 0.85 })),
    x: keep(standard(THREE, "#c4452f", { roughness: 0.45 })),
    o: keep(standard(THREE, "#4a85d6", { roughness: 0.45 })),
    // Win highlight for the marks on the deciding meta-line.
    xWin: keep(standard(THREE, "#ff6a4d", { emissive: "#ff6a4d", emissiveIntensity: 0.6, roughness: 0.4 })),
    oWin: keep(standard(THREE, "#6aa8ff", { emissive: "#6aa8ff", emissiveIntensity: 0.6, roughness: 0.4 })),
    // Golden win-celebration halo that sweeps along the three deciding sub-board
    // centres then parks pulsing on the middle one (mirrors connect4's halo, I9).
    halo: keep(standard(THREE, "#fff1b8", { roughness: 0.3, metalness: 0.2, emissive: "#ffd24a", emissiveIntensity: 1.4 })),
    // Last-move marker: a faint emissive ring under the most-recent mark so both
    // players can track the reply / the cell that forced the current board.
    lastRing: keep(standard(THREE, "#ffd166", { emissive: "#ffd166", emissiveIntensity: 0.7, roughness: 0.5, transparent: true, opacity: 0.85, depthWrite: false })),
    // Faint legal-move hint rim on each empty playable cell of the SINGLE forced
    // board (I7) so "where can I play" is unmistakable. Pure local render, never
    // networked; depthWrite off so it never z-fights the plate beneath it. Shown only
    // when a board is forced (bounded ≤8 cells) — "play anywhere" already reads from
    // the soft subActive plate glow, so peppering every board with dots would clutter.
    legalHint: keep(standard(THREE, "#ffe39a", { emissive: "#ffcf5c", emissiveIntensity: 0.5, roughness: 0.6, transparent: true, opacity: 0.5, depthWrite: false })),
    // Hover ghost in the local player's own colour (low opacity, no depth write so
    // it never z-fights the plate it floats over). Recoloured per side in setHover.
    ghost: keep(standard(THREE, "#c4452f", { roughness: 0.5, transparent: true, opacity: 0.3, emissive: "#c4452f", emissiveIntensity: 0.25, depthWrite: false })),
    // Identity home bars + turn lamps, one per side. Emissive is driven purely
    // from local myMark/turn (never the wire) so a snapshot can't flip the cue.
    homeX: keep(standard(THREE, "#c4452f", { roughness: 0.5, emissive: "#c4452f", emissiveIntensity: 0 })),
    homeO: keep(standard(THREE, "#4a85d6", { roughness: 0.5, emissive: "#4a85d6", emissiveIntensity: 0 })),
    lampX: keep(standard(THREE, "#7a2a1c", { roughness: 0.35, metalness: 0.2, emissive: "#ff7a55", emissiveIntensity: 0 })),
    lampO: keep(standard(THREE, "#1c3a7a", { roughness: 0.35, metalness: 0.2, emissive: "#6aa8ff", emissiveIntensity: 0 })),
  };

  // ---- base board ------------------------------------------------------------
  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plank = meshOf(THREE, keep(new THREE.BoxGeometry(outer, plankH, outer)), M.plank);
  plank.position.y = plankH / 2;
  group.add(plank);
  const frameGeo = keep(new THREE.BoxGeometry(outer + 0.03, plankH * 0.6, outer + 0.03));
  const frame = meshOf(THREE, frameGeo, M.frame);
  frame.position.y = plankH * 0.3;
  group.add(frame);
  const TOP = plankH;

  // 3×3 sub-boards with gutters; each sub holds a 3×3 of cells.
  const spacing = BOARD_SIZE / 3;
  const subSize = spacing * 0.92;
  const cellSize = subSize / 3;
  function subCenter(B) {
    const br = Math.floor(B / 3), bc = B % 3;
    return { x: -BOARD_HALF + (bc + 0.5) * spacing, z: -BOARD_HALF + (br + 0.5) * spacing };
  }
  function cellCenter(B, i) {
    const sc = subCenter(B);
    const cr = Math.floor(i / 3), cc = i % 3;
    return { x: sc.x - subSize / 2 + (cc + 0.5) * cellSize, z: sc.z - subSize / 2 + (cr + 0.5) * cellSize };
  }

  // Gutter lines between the 3×3 of sub-boards so the meta-grid reads as such.
  {
    const gutGeoV = keep(new THREE.BoxGeometry(0.006, 0.003, BOARD_SIZE * 0.98));
    const gutGeoH = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.98, 0.003, 0.006));
    for (let k = 1; k <= 2; k++) {
      const x = -BOARD_HALF + k * spacing;
      const v = meshOf(THREE, gutGeoV, M.gutter, false);
      v.position.set(x, TOP + 0.0015, 0);
      group.add(v);
      const h = meshOf(THREE, gutGeoH, M.gutter, false);
      h.position.set(0, TOP + 0.0015, x);
      group.add(h);
    }
  }

  const subPlates = [];
  const subGeo = keep(new THREE.BoxGeometry(subSize, 0.004, subSize));
  // Thin inner grid lines on each sub-board for cell legibility.
  const cellLineGeoV = keep(new THREE.BoxGeometry(0.0025, 0.002, subSize * 0.95));
  const cellLineGeoH = keep(new THREE.BoxGeometry(subSize * 0.95, 0.002, 0.0025));
  const hitGeo = keep(new THREE.BoxGeometry(cellSize * 0.92, 0.03, cellSize * 0.92));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));
  for (let B = 0; B < 9; B++) {
    const sc = subCenter(B);
    const plate = meshOf(THREE, subGeo, M.sub, false);
    plate.position.set(sc.x, TOP + 0.002, sc.z);
    group.add(plate);
    subPlates.push(plate);
    for (let k = 1; k <= 2; k++) {
      const off = -subSize / 2 + k * (subSize / 3);
      const lv = meshOf(THREE, cellLineGeoV, M.gutter, false);
      lv.position.set(sc.x + off, TOP + 0.0045, sc.z);
      group.add(lv);
      const lh = meshOf(THREE, cellLineGeoH, M.gutter, false);
      lh.position.set(sc.x, TOP + 0.0045, sc.z + off);
      group.add(lh);
    }
    for (let i = 0; i < 9; i++) {
      const cc = cellCenter(B, i);
      const box = new THREE.Mesh(hitGeo, invis);
      box.position.set(cc.x, TOP + 0.015, cc.z);
      box.userData.cell = { B, i };
      group.add(box);
    }
  }

  // ---- mark meshes pool indexed [B][i] ---------------------------------------
  const marks = Array.from({ length: 9 }, () => Array(9).fill(null));
  const xGeo = keep(new THREE.BoxGeometry(cellSize * 0.5, 0.01, cellSize * 0.14));
  const oGeo = keep(new THREE.TorusGeometry(cellSize * 0.26, cellSize * 0.07, 8, 18));

  // A "big" mark stamped on a won sub-board so winners read across the room.
  const bigXGeo = keep(new THREE.BoxGeometry(subSize * 0.6, 0.012, subSize * 0.16));
  const bigOGeo = keep(new THREE.TorusGeometry(subSize * 0.3, subSize * 0.08, 10, 22));
  const bigMarks = Array(9).fill(null);

  // Flat cell marks sit just above the plate and BELOW the 0.03-tall hit collider
  // (which spans TOP..TOP+0.03, so clicks still resolve via the collider regardless
  // of the mark's exact height). The X bars are 0.01 tall (half-height 0.005), so at
  // MARK_Y = TOP+0.0105 their underside lands at TOP+0.0055 — flush ON the cell-line
  // tops (0.002-tall lines centered at TOP+0.0045 → top face TOP+0.0055) instead of
  // floating ~3mm proud as the previous TOP+0.012 did. Lowering further would clip
  // the bar underside below the cell lines / plate face (TOP+0.004), so this is the
  // flush minimum.
  const MARK_Y = TOP + 0.0105;
  const BIG_MARK_Y = TOP + 0.024;

  function makeMark(mark, big = false) {
    const g = new THREE.Group();
    if (mark === "X") {
      const mat = M.x;
      const geo = big ? bigXGeo : xGeo;
      // Flat cell bars are tiny decorative slivers; casting shadows from them onto
      // the near-coplanar plate produced shadow acne / shimmer — disable casting on
      // the small marks (big stamped winners keep casting for presence).
      const a = meshOf(THREE, geo, mat, big);
      a.rotation.y = Math.PI / 4;
      const b = meshOf(THREE, geo, mat, big);
      b.rotation.y = -Math.PI / 4;
      g.add(a, b);
    } else {
      const o = meshOf(THREE, big ? bigOGeo : oGeo, M.o, big);
      o.rotation.x = Math.PI / 2;
      g.add(o);
    }
    return g;
  }

  // ---- identity / turn cues (built once) -------------------------------------
  // Per side: a home-edge tint bar in its own colour just outside the field, and
  // a turn lamp beside it. Each side keeps its OWN colour/material (X red, O blue)
  // so the two sides stay visually distinct, but the bars are positioned per-seat:
  // the LOCAL mark's bar+lamp sit on the near (-Z) edge — which the framework's
  // per-seat group rotation brings directly in front of the seated viewer — and the
  // opponent's on the far (+Z) edge. So the host reads X-near, the guest reads
  // O-near (opposite-but-correct), instead of X always landing on both near edges.
  const cue = { X: { bar: null, lamp: null }, O: { bar: null, lamp: null } };
  const edgeZ = BOARD_HALF + 0.03;
  // Resting emissive levels per lamp state so the pulse modulates around a base
  // rather than recomputing magic numbers each frame.
  const LAMP_BASE = { mine: 0.95, opp: 0.4, spectator: 0.7 };
  {
    const barGeo = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.7, 0.006, 0.014));
    const lampGeo = keep(new THREE.SphereGeometry(0.013, 18, 14));
    const sides = [
      { mark: "X", barMat: M.homeX, lampMat: M.lampX },
      { mark: "O", barMat: M.homeO, lampMat: M.lampO },
    ];
    for (const s of sides) {
      const bar = meshOf(THREE, barGeo, s.barMat, false);
      bar.position.set(0, TOP + 0.004, 0);
      group.add(bar);
      const lamp = meshOf(THREE, lampGeo, s.lampMat, false);
      lamp.position.set(BOARD_SIZE * 0.42, TOP + 0.009, 0);
      group.add(lamp);
      cue[s.mark].bar = bar;
      cue[s.mark].lamp = lamp;
    }
  }

  // Place each side's cue on its edge: my mark on the near (-Z) edge that the
  // framework rotates in front of me, the opponent's on the far (+Z) edge. myMark
  // can change via setRole(), so this is re-run from there; fall back to the
  // canonical X=-Z / O=+Z frame for the spectator (myMark null).
  //
  // NOTE: cue placement (my mark on -Z) and the framework's group rotation (by
  // orientFor(seatRy)) are independent inputs that must agree. They do for the
  // current 2-opposite-seat scheme (host=X seat ry 0 → -Z near; guest=O seat
  // ry≈π → its -Z near after rotation). setSeatRy() also calls this defensively so
  // a re-seat keeps the bars consistent with myMark.
  function placeIdentityCues() {
    const nearMark = myMark || "X";
    const farMark = other(nearMark);
    for (const [mark, z] of [[nearMark, -edgeZ], [farMark, edgeZ]]) {
      const c = cue[mark];
      if (!c.bar || !c.lamp) continue;
      c.bar.position.z = z;
      c.lamp.position.z = z;
    }
  }
  placeIdentityCues();

  // ---- text placard on the LOCAL near edge -----------------------------------
  // Names THEIR OWN mark (derived from role, never the wire) + whose turn.
  const labelCv = document.createElement("canvas");
  labelCv.width = 256;
  labelCv.height = 64;
  const labelTex = keep(new THREE.CanvasTexture(labelCv));
  labelTex.colorSpace = THREE.SRGBColorSpace;
  const labelMat = keep(new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }));
  const labelGeo = keep(new THREE.PlaneGeometry(BOARD_SIZE * 0.5, BOARD_SIZE * 0.5 * 0.25));
  const labelMesh = meshOf(THREE, labelGeo, labelMat, false);
  labelMesh.rotation.x = -Math.PI / 2;
  // Pushed out to -BOARD_HALF-0.11 (was -0.06) and lifted to TOP+0.006 (was +0.004)
  // so it clears the near home bar (z = -(BOARD_HALF+0.03), y = TOP+0.004). At -0.06
  // the placard's ~0.0875-deep footprint spanned the bar's z and overlapped its X,
  // leaving the two near-coplanar → z-fighting / the bar poked through the placard for
  // the local seat. The extra depth + the 2mm lift remove the overlap entirely.
  labelMesh.position.set(0, TOP + 0.006, -BOARD_HALF - 0.11);
  group.add(labelMesh);

  function refreshLabel() {
    const g = labelCv.getContext("2d");
    g.clearRect(0, 0, 256, 64);
    let text;
    let color = "#f0e4cf";
    // Whether it is the LOCAL player's turn — used to make "Your turn" pop.
    const myTurn = !!myMark && phase === "play" && turn === myMark;
    if (!myMark) {
      const t = phase === "over"
        ? (winner ? `${winner} wins` : "Draw")
        : `${turn} to move`;
      text = `Spectating — ${t}`;
    } else {
      const yours = phase === "over"
        ? (winner === myMark ? "You win!" : winner ? "You lose" : "Draw")
        : (turn === myMark ? "Your turn" : "Opponent's turn");
      // Prepend a ► when it's your move so it reads as a clear call-to-act.
      text = `You are ${myMark} — ${myTurn ? "▶ " : ""}${yours}`;
      color = MARK_HEX[myMark];
    }
    g.save();
    // The placard is a flat plane anchored to the LOCAL near (-Z) edge, which the
    // board's per-seat self-orientation always brings to the seated viewer. After
    // that rotation its flat top face reads 180° rotated from the seat, so the text
    // shows upside-down (matching battleship.js drawLabel). Pre-rotate the canvas
    // content 180° once so it reads upright for every seat.
    g.translate(128, 32);
    g.rotate(Math.PI);
    g.translate(-128, -32);
    // A brighter border when it's your turn frames the placard so "Your turn" pops.
    g.fillStyle = "rgba(28,20,12,0.82)";
    g.strokeStyle = myTurn ? color : "rgba(0,0,0,0)";
    g.lineWidth = myTurn ? 4 : 0;
    g.beginPath();
    const rr = 12;
    g.moveTo(rr, 0); g.arcTo(256, 0, 256, 64, rr); g.arcTo(256, 64, 0, 64, rr);
    g.arcTo(0, 64, 0, 0, rr); g.arcTo(0, 0, 256, 0, rr); g.closePath();
    g.fill();
    if (myTurn) g.stroke();
    g.font = "bold 30px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, 128, 34);
    g.restore();
    labelTex.needsUpdate = true;
  }

  // Drive identity bar + turn lamp emissives (never reads the wire). The lit lamp's
  // base level is set here; the per-frame pulse in stepLamps() modulates around it.
  function updateIdentityCues() {
    for (const mark of ["X", "O"]) {
      const c = cue[mark];
      if (!c.bar || !c.lamp) continue;
      const isMine = myMark != null && mark === myMark;
      const isTurn = phase === "play" && turn === mark;
      c.bar.material.emissiveIntensity = isMine ? 0.7 : 0.0;
      // A spectator has no "mine"; give the side-to-move a clear mid value rather
      // than the dim opponent level so the whose-turn cue still reads for watchers.
      const base = !myMark ? LAMP_BASE.spectator : isMine ? LAMP_BASE.mine : LAMP_BASE.opp;
      c.lamp.material.emissiveIntensity = isTurn ? base : 0.0;
    }
  }

  // ---- rendering -------------------------------------------------------------
  // Per-mark placement-pop animations: { B, i, t } scaling 0.6→1 with a tiny
  // overshoot + a small drop over POP_DUR. Driven from the self clock; only ever
  // started for a freshly-placed mark (gated on `animatePlace`), never on a full
  // repaint, so catch-up / resync / late-join SNAP with no animation.
  const POP_DUR = 0.16;
  const pops = []; // active placement pops
  let animatePlace = false; // true only across a single performMove

  function setMark(B, i, mark, animate = false) {
    if (marks[B][i]) {
      group.remove(marks[B][i]);
      marks[B][i] = null;
    }
    if (!mark) return;
    const g = makeMark(mark);
    const cc = cellCenter(B, i);
    g.position.set(cc.x, MARK_Y, cc.z);
    group.add(g);
    marks[B][i] = g;
    if (animate) {
      // Drop the existing pop for this cell if any (a repaint mid-pop), then arm.
      for (let k = pops.length - 1; k >= 0; k--) if (pops[k].B === B && pops[k].i === i) pops.splice(k, 1);
      g.scale.setScalar(0.6);
      g.position.y = MARK_Y + 0.012;
      pops.push({ B, i, t: 0 });
      ensureClock();
    }
  }

  function setBigMark(B, mark) {
    if (bigMarks[B]) {
      group.remove(bigMarks[B]);
      bigMarks[B] = null;
    }
    if (mark !== "X" && mark !== "O") return;
    const g = makeMark(mark, true);
    const sc = subCenter(B);
    g.position.set(sc.x, BIG_MARK_Y, sc.z);
    g.scale.setScalar(1);
    bigMarks[B] = g;
    group.add(g);
  }

  // ---- last-move marker (a faint ring under the most-recent mark) ------------
  // Reads off the synced `lastMove`, so spectators / late joiners see it correctly.
  const lastRingGeo = keep(new THREE.TorusGeometry(cellSize * 0.36, cellSize * 0.04, 8, 22));
  const lastRing = meshOf(THREE, lastRingGeo, M.lastRing, false);
  lastRing.rotation.x = Math.PI / 2;
  lastRing.visible = false;
  group.add(lastRing);
  function refreshLastRing() {
    if (phase === "play" && lastMove && Number.isInteger(lastMove.B) && Number.isInteger(lastMove.i)) {
      const cc = cellCenter(lastMove.B, lastMove.i);
      lastRing.position.set(cc.x, MARK_Y - 0.001, cc.z);
      lastRing.visible = true;
    } else {
      lastRing.visible = false;
    }
  }

  // ---- legal-move hints (faint rims on the forced board's empty cells) --------
  // A reused pool of ≤9 thin rings (one forced sub-board has at most 9 cells). Each
  // refresh repositions/shows the ones over currently-legal cells and hides the rest
  // — no per-frame allocation. Driven purely locally from legal(); spectators see it
  // too (it reads only synced state), which is fine — it's an unmistakable, read-only
  // "playable here" cue. Shown only when activeBoard is a single forced board.
  const hintGeo = keep(new THREE.TorusGeometry(cellSize * 0.3, cellSize * 0.035, 8, 18));
  const legalHints = [];
  for (let k = 0; k < 9; k++) {
    const h = meshOf(THREE, hintGeo, M.legalHint, false);
    h.rotation.x = Math.PI / 2;
    h.visible = false;
    group.add(h);
    legalHints.push(h);
  }
  function refreshLegalHints() {
    let n = 0;
    // Only when forced into a single board (bounded set, ≤9). "Play anywhere" uses
    // the soft subActive plate glow instead so the table doesn't fill with dots.
    if (phase === "play" && activeBoard !== null && !bigWinner[activeBoard]) {
      const B = activeBoard;
      for (let i = 0; i < 9; i++) {
        if (cells[B][i] || !legal(B, i)) continue;
        const cc = cellCenter(B, i);
        const h = legalHints[n++];
        h.position.set(cc.x, MARK_Y - 0.0005, cc.z);
        h.visible = true;
      }
    }
    for (let k = n; k < legalHints.length; k++) legalHints[k].visible = false;
  }

  // On a sub-board WON by X or O, hide the 9 small cell marks so only the big
  // stamped mark reads (a real Ultimate-TTT board clears a won cell to its big
  // mark). Left visible, the small marks poke around/under the big-O torus / big-X
  // bars and clutter the won cell. Drawn / undecided boards keep their small marks.
  // Visibility is restored automatically because paint()/setMark rebuild every mark
  // fresh (visible by default) on reset/applyState, then this re-hides won ones.
  function refreshWonMarkVisibility() {
    for (let B = 0; B < 9; B++) {
      const hide = bigWinner[B] === "X" || bigWinner[B] === "O";
      const row = marks[B];
      for (let i = 0; i < 9; i++) if (row[i]) row[i].visible = !hide;
    }
  }

  function refreshPlates() {
    for (let B = 0; B < 9; B++) {
      const plate = subPlates[B];
      if (bigWinner[B] === "X" || bigWinner[B] === "O") {
        const onWinLine = phase === "over" && winLine && winLine.includes(B);
        // At game over, won boards NOT on the deciding line desaturate (I12) so the
        // three winning boards isolate visually; mid-play and on-line keep full tint.
        if (phase === "over" && !onWinLine)
          plate.material = bigWinner[B] === "X" ? M.subWonXDim : M.subWonODim;
        else plate.material = bigWinner[B] === "X" ? M.subWonX : M.subWonO;
      }
      else if (bigWinner[B] === "draw") plate.material = M.subDraw;
      // Forced board glows for EVERYONE (host, guest, spectator) while play is on.
      // A SINGLE forced board gets the stronger subForced glow ("go here"); when
      // play is anywhere (activeBoard null) all undecided boards get the softer
      // subActive ("anywhere") so the two states read differently at a glance.
      else if (phase === "play" && activeBoard === B) plate.material = M.subForced;
      else if (phase === "play" && activeBoard === null) plate.material = M.subActive;
      else plate.material = M.sub;
    }
    refreshWonMarkVisibility();
    refreshLegalHints();
    updateIdentityCues();
    refreshLastRing();
    refreshLabel();
  }

  // Highlight the marks on the deciding meta-line (the three won sub-boards).
  // Rebuild the winning bigMark meshes fresh and assign the win material rather
  // than mutating the pooled big-mark meshes' shared material in place — that way
  // M.x/M.o are never permanently overwritten and a redundant call is harmless.
  let winLine = null;            // the 3 sub-board indices of the deciding line
  function highlightMetaWin() {
    winLine = null;
    if (phase !== "over" || (winner !== "X" && winner !== "O")) return;
    const big = bigWinner.map((x) => (x === "draw" ? null : x));
    let line = null;
    for (const L of LINES)
      if (big[L[0]] === winner && big[L[1]] === winner && big[L[2]] === winner) { line = L; break; }
    if (!line) return;
    const winMat = winner === "X" ? M.xWin : M.oWin;
    for (const B of line) {
      if (bigWinner[B] !== "X" && bigWinner[B] !== "O") continue;
      setBigMark(B, bigWinner[B]);
      const g = bigMarks[B];
      if (!g) continue;
      g.traverse((o) => { if (o.isMesh) o.material = winMat; });
    }
    winLine = line;
    // Re-run plate selection now that winLine is known so the end-state desaturation
    // (I12) of the off-line won boards applies. refreshPlates only READS winLine, so
    // this does not recurse. winLine is set, so the dim treatment + win-halo isolate
    // the deciding three.
    refreshPlates();
    // On an animated win (a fresh winning move) the flourish + halo play from t=0; on
    // a repaint (catch-up / resync / late join, animatePlace false) they SNAP straight
    // to the settled heartbeat / parked centre pulse — same discipline as the
    // placement pops (a late-joining spectator sees a steady celebration, not a replay
    // of the deciding beat). winFx.t past popDur (0.4) → settled; haloFx.t past
    // sweepDur (0.85) → parked.
    winFx.t = animatePlace ? 0 : 1.0;
    haloFx.t = animatePlace ? 0 : 1.0;
    // Cache the three deciding centres once so the per-frame stepHalo allocates nothing.
    for (let k = 0; k < line.length; k++) {
      const sc = subCenter(line[k]);
      haloFx.cx[k] = sc.x;
      haloFx.cz[k] = sc.z;
    }
    haloFx.active = true;
    ensureClock();
  }

  // ---- game logic ------------------------------------------------------------
  function recomputeBig(B) {
    const w = winnerOf(cells[B]);
    bigWinner[B] = w ? w : null;
  }

  function metaWinner() {
    return winnerOf(bigWinner.map((x) => (x === "draw" ? null : x)));
  }

  // True when no legal move exists anywhere (respecting the forced active board).
  function noPlayableCell() {
    for (let B = 0; B < 9; B++) {
      if (bigWinner[B]) continue;
      if (activeBoard !== null && activeBoard !== B) continue;
      for (let i = 0; i < 9; i++) if (!cells[B][i]) return false;
    }
    return true;
  }

  function legal(B, i) {
    if (phase !== "play") return false;
    if (!Number.isInteger(B) || B < 0 || B > 8 || !Number.isInteger(i) || i < 0 || i > 8) return false;
    if (bigWinner[B] || cells[B][i]) return false;
    if (activeBoard !== null && activeBoard !== B) return false;
    return true;
  }

  function performMove(B, i, mark) {
    cells[B][i] = mark;
    lastMove = { B, i };
    setMark(B, i, mark, animatePlace);
    recomputeBig(B);
    if (bigWinner[B] === "X" || bigWinner[B] === "O") {
      setBigMark(B, bigWinner[B]);
      // Sub-board win flourish (I8): a scale-pop on the new big stamp, but ONLY on an
      // animated move — a repaint / catch-up snapshot snaps with no flourish (same
      // pop discipline as setMark). Drop any stale pop for this board first.
      if (animatePlace) {
        for (let k = subPops.length - 1; k >= 0; k--) if (subPops[k].B === B) subPops.splice(k, 1);
        const g = bigMarks[B];
        if (g) g.scale.setScalar(0.4);
        subPops.push({ B, t: 0 });
        ensureClock();
      }
    }

    // Overall (meta-board) line win ends the game immediately.
    const mw = metaWinner();
    if (mw === "X" || mw === "O") {
      phase = "over";
      winner = mw;
      activeBoard = null;
      refreshPlates();
      highlightMetaWin();
      try { ctx.onGameOver({ winner, reason: "line" }); } catch { /* */ }
      return;
    }

    // No meta win: forced next board is the played cell index, unless that sub is
    // already decided (won or drawn) → free choice (null).
    activeBoard = bigWinner[i] ? null : i;
    turn = other(mark);

    // Drawn / fully-blocked board (incl. meta board full with no line) ends as a draw.
    if (noPlayableCell() || metaWinner() === "draw") {
      phase = "over";
      winner = null;
      activeBoard = null;
      refreshPlates();
      try { ctx.onGameOver({ winner: null, reason: "draw" }); } catch { /* */ }
      return;
    }
    refreshPlates();
  }

  function onPointer(hit) {
    if (!myMark) return;                       // spectator never has input
    if (!ctx.isLocalTurnAllowed() || turn !== myMark) return;
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.B) || !Number.isInteger(cell.i)) return;
    if (!legal(cell.B, cell.i)) return;
    clearHover();
    animatePlace = true;
    try { performMove(cell.B, cell.i, myMark); } finally { animatePlace = false; }
    try { ctx.net.sendMove({ type: "move", B: cell.B, i: cell.i }); } catch { /* */ }
    if (role === "host") pushSnapshot();
  }

  // Relayed move from the OTHER seat. We apply it as the side whose turn it is
  // (NOT myMark — that would corrupt 2-player identity). If the host receives a
  // guest move it must re-broadcast the resulting snapshot so spectators converge.
  function applyMove(move, byRole) {
    if (!move || move.type !== "move") return false;
    // Idempotency guard FIRST (before the phase check): a late/duplicated relay of
    // the winning move arrives after phase has flipped to "over". The exact-repeat
    // check must run before the phase guard so that benign duplicate — including the
    // game-ending one — returns false instead of throwing a needless GameDesync that
    // triggers a resync round-trip. A duplicate that arrives BEFORE the cell is
    // registered, or any exact repeat of the last move, must not be applied twice as
    // the (now flipped) turn either. Reject an exact repeat of lastMove regardless of
    // phase.
    if (lastMove && move.B === lastMove.B && move.i === lastMove.i) return false;
    if (phase !== "play") throw new GameDesync("uttt: not in play");
    // Identity/out-of-turn guard (mirrors connect4): the framework hands us the
    // relaying seat's role (board.js passes m.byRole). When present, the mover's
    // mark MUST equal the side whose turn it is — otherwise a mis-ordered or spoofed
    // relay would be applied as the wrong side. Throw GameDesync to force a resync.
    // We apply as `turn` (NOT myMark) so 2-player identity stays correct.
    const movedMark = byRole ? (byRole === "host" ? "X" : "O") : turn;
    if (movedMark !== turn) throw new GameDesync("uttt: out-of-turn relayed move");
    if (!legal(move.B, move.i)) throw new GameDesync("uttt: illegal move");
    animatePlace = true;
    try { performMove(move.B, move.i, turn); } finally { animatePlace = false; }
    if (role === "host") pushSnapshot();
    return true;
  }

  // ---- snapshots -------------------------------------------------------------
  function snapshot() {
    return {
      cells: cells.map((s) => s.slice()),
      bigWinner: bigWinner.slice(),
      turn, activeBoard, phase, winner, lastMove,
    };
  }
  function publicState() { return snapshot(); }
  // Host-gated: only the authoritative host publishes snapshots. A no-op for
  // guest/spectator instances, so it's safe to call from the constructor and the
  // applyState reset branch (mirrors connect4's pushState self-gating).
  function pushSnapshot() {
    if (role !== "host") return;
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  function paint() {
    // A full repaint SNAPS (animate=false) — never replays a flurry of pops on
    // catch-up / resync / late join. Clear any in-flight pops first.
    pops.length = 0;
    subPops.length = 0;
    for (let B = 0; B < 9; B++) {
      for (let i = 0; i < 9; i++) setMark(B, i, cells[B][i], false);
      setBigMark(B, bigWinner[B] === "X" || bigWinner[B] === "O" ? bigWinner[B] : null);
    }
    // Drop any stale win-halo when the new state isn't a finished game (e.g. a reset
    // or resync back to mid-play); highlightMetaWin re-arms it when over. Also clear
    // the stale deciding-line so a mid-play repaint never carries a previous game's
    // winLine (it's defensively gated everywhere on phase==="over", but clearing it
    // keeps the invariant "winLine != null ⇒ game is over" honest).
    if (phase !== "over") { haloFx.active = false; halo.visible = false; winLine = null; }
    refreshPlates();
    if (phase === "over") highlightMetaWin();
    // Self-heal the clock after a full repaint (catch-up / resync / late join). The
    // lamp pulse + forced-board glow only run while the clock ticks; paint() can land
    // a fresh mid-play position whose pulses must start without waiting for the next
    // framework update() pump (mirrors connect4's refreshLamps→ensureClock). When over,
    // highlightMetaWin already armed it; ensureClock no-ops if the rAF is alive.
    if (needsAnim()) ensureClock();
  }

  // applyState rebuilds shared state ONLY — never myMark/role (no side-flip).
  function applyState(state) {
    if (!state) {
      cells = Array.from({ length: 9 }, () => Array(9).fill(null));
      bigWinner = Array(9).fill(null);
      turn = "X";
      activeBoard = null;
      phase = "play";
      winner = null;
      lastMove = null;
      // A reset re-establishes the authoritative empty board; re-publish it (host
      // only) so a spectator joining post-reset hydrates against the fresh board and
      // its first relayed move isn't dropped — same rationale as the constructor push.
      paint();
      pushSnapshot();
      return;
    } else {
      cells = Array.from({ length: 9 }, (_, B) => {
        const row = state.cells && state.cells[B];
        return Array.from({ length: 9 }, (_, i) => {
          const v = row && row[i];
          return v === "X" || v === "O" ? v : null;
        });
      });
      bigWinner = Array.from({ length: 9 }, (_, B) => {
        const v = state.bigWinner && state.bigWinner[B];
        return v === "X" || v === "O" || v === "draw" ? v : null;
      });
      turn = state.turn === "O" ? "O" : "X";
      // activeBoard must be a real, still-undecided sub-board (0..8) or null.
      activeBoard =
        Number.isInteger(state.activeBoard) &&
        state.activeBoard >= 0 &&
        state.activeBoard < 9 &&
        !bigWinner[state.activeBoard]
          ? state.activeBoard
          : null;
      phase = state.phase === "over" ? "over" : "play";
      winner = state.winner === "X" || state.winner === "O" ? state.winner : null;
      // lastMove is a cosmetic cue; validate both B and i before trusting it.
      lastMove =
        state.lastMove &&
        Number.isInteger(state.lastMove.B) &&
        Number.isInteger(state.lastMove.i)
          ? state.lastMove
          : null;
    }
    paint();
  }

  // ============================================================================
  // SELF-DRIVEN CLOCK — runs only while something animates, then parks. Mirrors
  // connect4. Drives placement pops, the whose-turn lamp pulse and the win
  // flourish. Purely LOCAL render; never touches state/snapshots/the wire.
  // ============================================================================
  const winFx = { t: 0 };
  // Golden win-halo (I9): a torus that sweeps the three deciding sub-board centres
  // then parks pulsing on the middle one. Created once; shown only at game over.
  const haloGeo = keep(new THREE.TorusGeometry(subSize * 0.42, subSize * 0.05, 12, 28));
  const halo = meshOf(THREE, haloGeo, M.halo, false);
  halo.rotation.x = Math.PI / 2;
  halo.visible = false;
  group.add(halo);
  // haloFx caches the three deciding sub-board centre coords (cx/cz, 3 each) when the
  // win is armed so stepHalo allocates nothing per frame.
  const haloFx = { t: 0, active: false, cx: [0, 0, 0], cz: [0, 0, 0] };
  // Sub-board win flourish (I8): a one-shot scale-pop on a freshly-won board's big
  // stamp. Reuses the pop discipline — armed only on an animated move, snapped on a
  // repaint. Entries are { B, t }.
  const subPops = [];
  // Forced-board glow pulse (I10): animate the SINGLE forced board's emissive so
  // "go HERE" pulses while the soft "anywhere" subActive stays static — the two
  // free/forced states never read the same. Modulates M.subForced in place (a single
  // shared material that's only ever applied to the one forced plate at a time).
  const SUBFORCED_BASE_EMISSIVE = M.subForced.emissiveIntensity;
  let rafId = 0;
  let lastT = 0;
  let pulsePhase = 0;     // whose-turn lamp pulse accumulator
  let forcedPhase = 0;    // forced-board glow pulse accumulator (independent)

  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }
  function lampPulsing() {
    return phase === "play" && (turn === "X" || turn === "O");
  }
  // The single forced board pulses (I10) only while play is on and a board is forced.
  function forcedPulsing() {
    return phase === "play" && activeBoard !== null && !bigWinner[activeBoard];
  }
  function needsAnim() {
    return (
      pops.length > 0 ||
      subPops.length > 0 ||
      lampPulsing() ||
      forcedPulsing() ||
      (phase === "over" && winLine != null)
    );
  }
  function ensureClock() {
    if (rafId || typeof requestAnimationFrame !== "function") return;
    lastT = now();
    rafId = requestAnimationFrame(tick);
  }
  function tick() {
    rafId = 0;
    const t = now();
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;

    stepPops(dt);
    stepSubPops(dt);
    stepLamps(dt);
    stepForcedPulse(dt);
    stepWinFx(dt);
    stepHalo(dt);

    if (needsAnim()) rafId = requestAnimationFrame(tick);
  }

  // Placement pop: scale 0.6 → 1 with a small overshoot, drop ~12mm onto the plate.
  function stepPops(dt) {
    for (let k = pops.length - 1; k >= 0; k--) {
      const p = pops[k];
      p.t += dt;
      const g = marks[p.B] && marks[p.B][p.i];
      if (!g) { pops.splice(k, 1); continue; }
      const f = Math.min(1, p.t / POP_DUR);
      const e = easeInOut(f);
      // Overshoot peaks near the middle then settles to 1.
      const s = 0.6 + 0.4 * e + 0.12 * Math.sin(Math.PI * f) * (1 - f);
      g.scale.setScalar(s);
      g.position.y = MARK_Y + 0.012 * (1 - e);
      if (f >= 1) {
        g.scale.setScalar(1);
        g.position.y = MARK_Y;
        pops.splice(k, 1);
      }
    }
  }

  // Whose-turn lamp pulse — modulates the lit lamp around its base emissive set in
  // updateIdentityCues(). A wider, brighter swing when it's the LOCAL player's turn.
  function stepLamps(dt) {
    if (!lampPulsing()) return;
    pulsePhase += dt;
    const c = cue[turn];
    if (!c || !c.lamp) return;
    const isMine = myMark != null && turn === myMark;
    const base = !myMark ? LAMP_BASE.spectator : isMine ? LAMP_BASE.mine : LAMP_BASE.opp;
    const swing = isMine ? 0.4 : 0.14;
    const speed = isMine ? 4.0 : 2.6;
    c.lamp.material.emissiveIntensity = base + swing * (0.5 + 0.5 * Math.sin(pulsePhase * speed));
  }

  // Win flourish — a brief settle/scale-pop on the deciding meta-line big marks
  // then a slow emissive heartbeat while the game is over. Reads off synced state.
  function stepWinFx(dt) {
    if (phase !== "over" || !winLine) return;
    winFx.t += dt;
    const popDur = 0.4;
    const winMat = winner === "X" ? M.xWin : M.oWin;
    for (const B of winLine) {
      const g = bigMarks[B];
      if (!g) continue;
      if (winFx.t < popDur) {
        const f = winFx.t / popDur;
        g.scale.setScalar(1 + 0.15 * Math.sin(Math.PI * f));
      } else {
        g.scale.setScalar(1);
      }
    }
    // slow heartbeat on the win emissive once settled.
    if (winFx.t >= popDur) {
      winMat.emissiveIntensity = 0.6 + 0.35 * (0.5 + 0.5 * Math.sin(winFx.t * 2.4));
    }
  }

  // Sub-board win flourish (I8): a brief one-shot scale-pop on a freshly-won board's
  // big stamp so the frequent sub-wins are rewarded, not just the rare game-ender.
  const SUBPOP_DUR = 0.34;
  function stepSubPops(dt) {
    for (let k = subPops.length - 1; k >= 0; k--) {
      const p = subPops[k];
      p.t += dt;
      const g = bigMarks[p.B];
      // The game-deciding board's big mark is owned by the win flourish — if this
      // board is on the winLine, drop the sub-pop so the two don't fight over scale.
      if (!g || (winLine && winLine.includes(p.B))) { if (g) g.scale.setScalar(1); subPops.splice(k, 1); continue; }
      const f = Math.min(1, p.t / SUBPOP_DUR);
      // Pop in from 0.4 with a soft overshoot, settle to 1.
      const e = easeInOut(f);
      const s = 0.4 + 0.6 * e + 0.18 * Math.sin(Math.PI * f) * (1 - f);
      g.scale.setScalar(s);
      if (f >= 1) { g.scale.setScalar(1); subPops.splice(k, 1); }
    }
  }

  // Forced-board glow pulse (I10): breathe the single forced board's emissive so
  // "go HERE" is unmistakably more active than the static "anywhere" subActive glow.
  // Modulates the shared M.subForced material (only ever applied to the one forced
  // plate), restoring its base level when no board is forced so it never leaks.
  function stepForcedPulse(dt) {
    if (!forcedPulsing()) {
      M.subForced.emissiveIntensity = SUBFORCED_BASE_EMISSIVE;
      return;
    }
    forcedPhase += dt;
    M.subForced.emissiveIntensity = SUBFORCED_BASE_EMISSIVE + 0.4 * (0.5 + 0.5 * Math.sin(forcedPhase * 3.2));
  }

  // Win-halo sweep (I9): interpolate the golden torus along the three deciding
  // sub-board centres over a short sweep, then park it pulsing on the middle board.
  // Purely local; reads off winLine which is derived from synced state.
  function stepHalo(dt) {
    if (!haloFx.active || !winLine || phase !== "over") {
      if (halo.visible) { halo.visible = false; halo.scale.setScalar(1); }
      return;
    }
    haloFx.t += dt;
    halo.visible = true;
    const sweepDur = 0.85;
    const n = winLine.length; // 3
    if (haloFx.t < sweepDur) {
      const f = haloFx.t / sweepDur;
      const fi = f * (n - 1);
      const i0 = Math.floor(fi);
      const i1 = Math.min(n - 1, i0 + 1);
      const lf = fi - i0;
      const x = haloFx.cx[i0] + (haloFx.cx[i1] - haloFx.cx[i0]) * lf;
      const z = haloFx.cz[i0] + (haloFx.cz[i1] - haloFx.cz[i0]) * lf;
      halo.position.set(x, BIG_MARK_Y + 0.006, z);
      halo.scale.setScalar(1);
    } else {
      const mid = Math.floor(n / 2);
      halo.position.set(haloFx.cx[mid], BIG_MARK_Y + 0.006, haloFx.cz[mid]);
      // Gentle steady pulse on the centre board once parked.
      halo.scale.setScalar(1 + 0.1 * Math.sin(haloFx.t * 5));
    }
  }

  // ============================================================================
  // HOVER — a faint ghost mark in the local player's colour over a legal cell.
  // Gated to the local turn by board.js (_turnAllowed) before setHover is called,
  // and re-checked here against legal(). Purely local; hover is never networked.
  // ============================================================================
  let hoverGhost = null;
  let hoverCell = null; // { B, i } currently previewed
  function clearHover() {
    if (hoverGhost) {
      group.remove(hoverGhost);
      hoverGhost = null;
    }
    hoverCell = null;
  }
  function setHover(cell) {
    // board.js forwards the resolved userData.cell {B,i} or -1 on a miss.
    const c = cell && typeof cell === "object" ? cell : null;
    if (!myMark || !c || !Number.isInteger(c.B) || !Number.isInteger(c.i) || !legal(c.B, c.i)) {
      clearHover();
      return;
    }
    if (hoverCell && hoverCell.B === c.B && hoverCell.i === c.i) return;
    clearHover();
    const g = makeMark(myMark);
    // Tint to the translucent ghost material; recolour per side so X/O read.
    M.ghost.color.set(MARK_HEX[myMark]);
    M.ghost.emissive.set(MARK_HEX[myMark]);
    g.traverse((o) => { if (o.isMesh) o.material = M.ghost; });
    const cc = cellCenter(c.B, c.i);
    g.position.set(cc.x, MARK_Y, cc.z);
    group.add(g);
    hoverGhost = g;
    hoverCell = { B: c.B, i: c.i };
  }

  // ---- role / seat / lifecycle ----------------------------------------------
  function setRole(r) {
    role = r || "spectator";
    myMark = role === "host" ? "X" : role === "guest" ? "O" : null;
    placeIdentityCues();
    clearHover();
    refreshPlates();
  }
  function setSeatRy() {
    // Defensive: keep the per-seat cue placement in sync with myMark on a re-seat
    // (idempotent; placement assumes host=-Z / guest=+Z seating). Then refresh the
    // emissive cues.
    placeIdentityCues();
    updateIdentityCues();
  }
  // Optional per-frame pump. Not required (we self-drive via rAF) but harmless;
  // the framework calls update(dt) on modules that expose it (board.js). We use
  // it only to guarantee the clock is alive while something is animating — e.g. a
  // browser that throttled/cancelled our private rAF while backgrounded, which
  // would otherwise leave the lamp pulse / forced-board glow / in-flight pop
  // frozen until the next move calls ensureClock(). Mirrors connect4.
  function update() {
    if (needsAnim()) ensureClock();
  }
  function dispose() {
    if (rafId && typeof cancelAnimationFrame === "function") { cancelAnimationFrame(rafId); rafId = 0; }
    pops.length = 0;
    subPops.length = 0;
    haloFx.active = false;
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  paint();
  ensureClock(); // start the whose-turn lamp pulse for the opening turn
  // Mid-join spectator first-move drop fix (mirrors connect4): the host otherwise
  // only ever broadcasts AFTER a move resolves, so until the host's first move lands
  // the server's cached pub/full are null. A spectator that mounts in that window
  // gets pub:null, board.js _onState bails, _hydrated stays false, and the first
  // relayed move is DROPPED by the spectator gate (board.js:373) — never animated.
  // Publish the authoritative empty board at game start so a joining spectator's
  // requestState() returns a real snapshot, hydrates, and animates the first move.
  // Host-gated inside pushSnapshot(); a no-op for guest/spectator instances.
  pushSnapshot();
  return { group, applyState, applyMove, onPointer, publicState, setRole, setSeatRy, setHover, update, dispose };
}

export default createGame;
