// Dots and Boxes — in-world 3D module (createGame contract). Full-info.
//
// DOTS=6 → 5×5 boxes. A move targets an EDGE {o:'h'|'v', r, c}. Drawing the
// fourth side of a box CLAIMS it for the mover and grants them ANOTHER turn;
// otherwise the turn passes. The game ends when every box is claimed; the side
// owning the most boxes wins (equal → draw).
//
// Identity / orientation contract:
//   * host = RED and moves first; guest = BLUE; spectator has no colour.
//   * The two sides render in clearly distinct materials (warm red / cool blue).
//   * The framework rotates the whole group by orientFor(seatRy), so the canonical
//     near edge (-Z, "row 0") always faces the LOCAL seat. We therefore author the
//     LOCAL player's identity furniture (home rail + name plate) at -Z and the
//     opponent's at +Z, re-laying it out whenever the role/seat changes. This is
//     derived ONLY from the local `myColor`, NEVER from a relayed snapshot, so a
//     mirrored wire state can never flip which side is "me".
//   * Whose-turn cue: a floating beacon hovers over the board centre, tinted in the
//     side-to-move's colour and tipped toward that side's home rail; the matching
//     home rail + a turn lamp glow, and (only on the local player's own turn) the
//     open edges they may legally take pulse in their colour with a ghost preview.
//
// Candidate variation #4: distinct approach — a single re-laid-out identity frame
// (local colour always nearest), a central tilting beacon as the turn cue, and a
// hover ghost on the edge under the cursor.

import { GameDesync } from "./createGame.js";
import { BOARD_SIZE, PALETTE, meshOf, standard } from "./pieces.js";

const DOTS = 6;
const BOXN = DOTS - 1; // 5×5 boxes
const COLORS = ["red", "blue"];
const other = (p) => (p === "red" ? "blue" : "red");

// ---- pure rules ------------------------------------------------------------
function emptyState() {
  return {
    h: Array.from({ length: DOTS }, () => Array(BOXN).fill(null)), // horizontal edges: h[r][c], r∈[0,DOTS), c∈[0,BOXN)
    v: Array.from({ length: BOXN }, () => Array(DOTS).fill(null)), // vertical   edges: v[r][c], r∈[0,BOXN), c∈[0,DOTS)
    boxes: Array.from({ length: BOXN }, () => Array(BOXN).fill(null)),
  };
}

function edgeFree(st, o, r, c) {
  if (o === "h") return r >= 0 && r < DOTS && c >= 0 && c < BOXN && !st.h[r][c];
  if (o === "v") return r >= 0 && r < BOXN && c >= 0 && c < DOTS && !st.v[r][c];
  return false;
}

// Apply an edge and return the list of [br,bc] boxes newly completed by it.
function applyEdge(st, o, r, c, player) {
  if (o === "h") st.h[r][c] = player;
  else st.v[r][c] = player;
  const completed = [];
  const tryClose = (br, bc) => {
    if (br < 0 || br >= BOXN || bc < 0 || bc >= BOXN) return;
    if (st.boxes[br][bc]) return;
    if (st.h[br][bc] && st.h[br + 1][bc] && st.v[br][bc] && st.v[br][bc + 1]) {
      st.boxes[br][bc] = player;
      completed.push([br, bc]);
    }
  };
  if (o === "h") { tryClose(r - 1, c); tryClose(r, c); }
  else { tryClose(r, c - 1); tryClose(r, c); }
  return completed;
}

function isFull(st) {
  for (let r = 0; r < BOXN; r++) for (let c = 0; c < BOXN; c++) if (!st.boxes[r][c]) return false;
  return true;
}

function tally(st) {
  let red = 0, blue = 0;
  for (const row of st.boxes) for (const v of row) {
    if (v === "red") red++;
    else if (v === "blue") blue++;
  }
  return { red, blue };
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "dotsandboxes";

  // Local identity is derived ONLY from role (never from the wire).
  let role = ctx.role;
  let myColor = role === "host" ? "red" : role === "guest" ? "blue" : null;

  let st = emptyState();
  let turn = "red";        // side to move
  let phase = "play";      // "play" | "over"
  let winner = null;       // "red" | "blue" | null(draw / in-progress)

  // ---- materials (owned for disposal) --------------------------------------
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const RED = PALETTE.pongLeft;   // warm red
  const BLUE = PALETTE.pongRight; // cool blue
  const M = {
    plank: keep(standard(THREE, "#3a281a", { roughness: 0.85 })),
    dot: keep(standard(THREE, "#d8c39a", { roughness: 0.55, metalness: 0.1 })),
    // I5: open-edge slots were near-invisible (#5a4633 @0.22) against the dark
    // plank from the far seat. Lighten + raise opacity and add a faint emissive so
    // the legal lattice reads from both seats. depthWrite stays off (no z-fight).
    edgeOpen: keep(standard(THREE, "#6b5640", { roughness: 0.8, transparent: true, opacity: 0.32, emissive: "#6b5640", emissiveIntensity: 0.08, depthWrite: false })),
    red: keep(standard(THREE, RED, { roughness: 0.45, metalness: 0.1 })),
    blue: keep(standard(THREE, BLUE, { roughness: 0.45, metalness: 0.1 })),
    boxRed: keep(standard(THREE, "#e08a7e", { roughness: 0.6, transparent: true, opacity: 0.72, emissive: RED, emissiveIntensity: 0.12 })),
    boxBlue: keep(standard(THREE, "#8ab0e0", { roughness: 0.6, transparent: true, opacity: 0.72, emissive: BLUE, emissiveIntensity: 0.12 })),
    // legal-move hints: own colour, glow pulsed only on the local turn
    legalRed: keep(standard(THREE, RED, { roughness: 0.5, emissive: RED, emissiveIntensity: 0, transparent: true, opacity: 0.5, depthWrite: false })),
    legalBlue: keep(standard(THREE, BLUE, { roughness: 0.5, emissive: BLUE, emissiveIntensity: 0, transparent: true, opacity: 0.5, depthWrite: false })),
    // home rails (persistent identity), driven by local myColor/turn
    homeRed: keep(standard(THREE, RED, { roughness: 0.5, metalness: 0.15, emissive: RED, emissiveIntensity: 0 })),
    homeBlue: keep(standard(THREE, BLUE, { roughness: 0.5, metalness: 0.15, emissive: BLUE, emissiveIntensity: 0 })),
    // turn lamps beside each home rail
    lampRed: keep(standard(THREE, RED, { roughness: 0.3, metalness: 0.2, emissive: "#ff9a86", emissiveIntensity: 0 })),
    lampBlue: keep(standard(THREE, BLUE, { roughness: 0.3, metalness: 0.2, emissive: "#9ec2ff", emissiveIntensity: 0 })),
    // central turn beacon (tinted to side-to-move)
    beacon: keep(standard(THREE, "#888888", { roughness: 0.3, metalness: 0.3, emissive: "#000000", emissiveIntensity: 0.0, transparent: true, opacity: 0.92 })),
    // hover ghost on the edge under the cursor (own colour)
    ghost: keep(standard(THREE, RED, { roughness: 0.4, emissive: RED, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, depthWrite: false })),
    // F6: hover-ghost "chain danger" tint — drawing this edge hands the opponent a
    // 3-sided box (the give-away). Warm amber so it reads as a warning over RED/BLUE.
    ghostWarn: keep(standard(THREE, "#ffb020", { roughness: 0.4, emissive: "#ff8400", emissiveIntensity: 0.7, transparent: true, opacity: 0.6, depthWrite: false })),
    // F1: capture-tray pips — one lit disc per box a side owns. Bright, emissive so
    // the running tally reads from both seats; shared per colour (toggle .visible).
    pipRed: keep(standard(THREE, "#f0a094", { roughness: 0.45, metalness: 0.1, emissive: RED, emissiveIntensity: 0.5 })),
    pipBlue: keep(standard(THREE, "#9cc0f0", { roughness: 0.45, metalness: 0.1, emissive: BLUE, emissiveIntensity: 0.5 })),
    // tray base plate beneath the pips (sits beside each home rail)
    tray: keep(standard(THREE, "#2a1d12", { roughness: 0.85, metalness: 0.05 })),
    // F2: last-move halo — a thin over-bar ring tinted to the mover, hovering on
    // the most-recently claimed edge. Shared (re-tinted + repositioned in paint()).
    lastMove: keep(standard(THREE, RED, { roughness: 0.4, emissive: RED, emissiveIntensity: 0.8, transparent: true, opacity: 0.85, depthWrite: false })),
  };

  // ---- board base ----------------------------------------------------------
  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plank = meshOf(THREE, keep(new THREE.BoxGeometry(outer, plankH, outer)), M.plank);
  plank.position.y = plankH / 2;
  group.add(plank);
  const TOP = plankH;

  const span = BOARD_SIZE * 0.86;
  const gap = span / (DOTS - 1);

  // I6: stack the playfield layers so coplanar geometry never z-fights. Box fills
  // sit lowest (on the plank), then dots, then the open/claimed bars a hair above
  // them, then the hover ghost above the bar it previews so it reads as floating
  // over the slot rather than shimmering against the open bar underneath.
  const Y_BOX = TOP + 0.008;       // box fill (just above plank)
  const Y_DOT = TOP + gap * 0.05;  // dots
  const Y_BAR = TOP + gap * 0.055; // edge bars (dots + bars no longer coplanar)
  const Y_GHOST = TOP + gap * 0.075; // hover ghost rides above the open bar
  const x0 = -span / 2, z0 = -span / 2;
  const dotX = (c) => x0 + c * gap;
  const dotZ = (r) => z0 + r * gap;
  const midX = (c) => (dotX(c) + dotX(c + 1)) / 2;
  const midZ = (r) => (dotZ(r) + dotZ(r + 1)) / 2;

  // dots
  const dotGeo = keep(new THREE.SphereGeometry(gap * 0.09, 12, 8));
  for (let r = 0; r < DOTS; r++)
    for (let c = 0; c < DOTS; c++) {
      const d = meshOf(THREE, dotGeo, M.dot);
      d.position.set(dotX(c), Y_DOT, dotZ(r));
      group.add(d);
    }

  // ---- edge bars + invisible colliders -------------------------------------
  const hBarGeo = keep(new THREE.BoxGeometry(gap * 0.8, gap * 0.07, gap * 0.07));
  const vBarGeo = keep(new THREE.BoxGeometry(gap * 0.07, gap * 0.07, gap * 0.8));
  const hHitGeo = keep(new THREE.BoxGeometry(gap * 0.82, 0.04, gap * 0.5));
  const vHitGeo = keep(new THREE.BoxGeometry(gap * 0.5, 0.04, gap * 0.82));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));
  const edgeBars = { h: {}, v: {} };
  const edgePos = { h: {}, v: {} }; // {x,z} centre per edge (for the ghost)

  for (let r = 0; r < DOTS; r++)
    for (let c = 0; c < BOXN; c++) {
      const px = midX(c), pz = dotZ(r);
      const bar = meshOf(THREE, hBarGeo, M.edgeOpen);
      bar.position.set(px, Y_BAR, pz);
      group.add(bar);
      edgeBars.h[`${r},${c}`] = bar;
      edgePos.h[`${r},${c}`] = { x: px, z: pz };
      const hit = new THREE.Mesh(hHitGeo, invis);
      hit.position.set(px, TOP + 0.02, pz);
      hit.userData.cell = { o: "h", r, c };
      group.add(hit);
    }
  for (let r = 0; r < BOXN; r++)
    for (let c = 0; c < DOTS; c++) {
      const px = dotX(c), pz = midZ(r);
      const bar = meshOf(THREE, vBarGeo, M.edgeOpen);
      bar.position.set(px, Y_BAR, pz);
      group.add(bar);
      edgeBars.v[`${r},${c}`] = bar;
      edgePos.v[`${r},${c}`] = { x: px, z: pz };
      const hit = new THREE.Mesh(vHitGeo, invis);
      hit.position.set(px, TOP + 0.02, pz);
      hit.userData.cell = { o: "v", r, c };
      group.add(hit);
    }

  // ---- box fills -----------------------------------------------------------
  const boxGeo = keep(new THREE.BoxGeometry(gap * 0.78, 0.006, gap * 0.78));
  const boxMeshes = Array.from({ length: BOXN }, () => Array(BOXN).fill(null));

  // ---- identity furniture: home rails + lamps (re-laid-out per role) --------
  // Built once; positions are assigned in layoutIdentity() so the LOCAL colour is
  // always at the -Z near edge (which orientFor turns toward the local seat).
  const railGeo = keep(new THREE.BoxGeometry(span * 0.82, plankH * 0.55, gap * 0.13));
  const lampGeo = keep(new THREE.SphereGeometry(gap * 0.11, 16, 12));
  const home = {
    red: { rail: meshOf(THREE, railGeo, M.homeRed, false), lamp: meshOf(THREE, lampGeo, M.lampRed, false) },
    blue: { rail: meshOf(THREE, railGeo, M.homeBlue, false), lamp: meshOf(THREE, lampGeo, M.lampBlue, false) },
  };
  for (const col of COLORS) {
    group.add(home[col].rail);
    group.add(home[col].lamp);
  }
  const edgeZ = span / 2 + gap * 0.34;
  const railY = TOP + plankH * 0.35;

  // Place colour `near` at -Z (local near edge) and the other at +Z. When there's
  // no local colour (spectator), keep red=+Z / blue=-Z as a stable canonical view.
  function layoutIdentity() {
    const nearColor = myColor || "blue"; // spectator: blue nearest by convention
    const farColor = other(nearColor);
    const place = (col, z) => {
      home[col].rail.position.set(0, railY, z);
      // I9: the lamp at x=span*0.46 poked past the rail's own end (half-length
      // span*0.41) and floated proud at railY+gap*0.06, reading as detached near
      // the plank corner. Pull it inboard onto the rail and sit it on the rail top.
      home[col].lamp.position.set(span * 0.40, railY + gap * 0.05, z);
    };
    place(nearColor, -edgeZ);
    place(farColor, edgeZ);
    layoutTrays(nearColor, farColor);
  }

  // ---- F1: capture trays (live box-count readout) --------------------------
  // A flat BOXN×BOXN (=25) pip grid sits on the plank in the OUTBOARD CORNER of
  // each home rail — the only spot with room in both axes (the thin strip between
  // the playfield edge and the plank edge is too shallow beside the rail, but the
  // corner square clears both). One pip lights per box that side currently owns.
  // Pure render: refreshTrays() reads tally(st) and toggles pip .visible — no wire
  // change. Pre-allocated once; re-laid-out per role so the LOCAL side's tray sits
  // at the near (-Z) corner, the opponent's mirrored to +Z.
  const TRAY_N = BOXN;             // 5×5 = 25-box capacity
  const pipR = gap * 0.04;         // ~5mm — small but emissive so it reads
  const pipGap = gap * 0.112;      // pip-to-pip spacing (fits the corner square)
  const gridSpan = (TRAY_N - 1) * pipGap; // pip-centre to pip-centre extent
  const plateSide = gridSpan + pipR * 2 + 0.004;
  const pipGeo = keep(new THREE.SphereGeometry(pipR, 10, 8));
  const trayGeo = keep(new THREE.BoxGeometry(plateSide, plankH * 0.35, plateSide));
  // Corner centre: midway between the playfield edge (span/2) and the plank edge.
  const cornerMag = (span / 2 + outer / 2) / 2;
  const trayY = TOP + plankH * 0.18;
  const pipY = trayY + plankH * 0.18 + pipR * 0.5;
  const tray = {
    red: { plate: meshOf(THREE, trayGeo, M.tray, false), pips: [] },
    blue: { plate: meshOf(THREE, trayGeo, M.tray, false), pips: [] },
  };
  for (const col of COLORS) {
    group.add(tray[col].plate);
    const pipMat = col === "red" ? M.pipRed : M.pipBlue;
    for (let i = 0; i < TRAY_N * TRAY_N; i++) {
      const p = meshOf(THREE, pipGeo, pipMat, false);
      p.visible = false;
      tray[col].pips.push(p);
      group.add(p);
    }
  }
  // Lay one tray's grid centred at (+cornerMag x, sign*cornerMag z). Pips fill
  // row-major, counting outward in z (row 0 nearest the board centre on each side).
  function placeTray(col, sign) {
    const t = tray[col];
    const cx = cornerMag, cz = sign * cornerMag;
    t.plate.position.set(cx, trayY, cz);
    const x00 = cx - gridSpan * 0.5;
    const z00 = cz - sign * gridSpan * 0.5;
    for (let i = 0; i < t.pips.length; i++) {
      const rr = Math.floor(i / TRAY_N);
      const cc = i % TRAY_N;
      t.pips[i].position.set(x00 + cc * pipGap, pipY, z00 + sign * rr * pipGap);
    }
  }
  function layoutTrays(nearColor, farColor) {
    placeTray(nearColor, -1);
    placeTray(farColor, 1);
  }
  function refreshTrays() {
    const tl = tally(st);
    for (const col of COLORS) {
      const n = col === "red" ? tl.red : tl.blue;
      const pips = tray[col].pips;
      for (let i = 0; i < pips.length; i++) pips[i].visible = i < n;
    }
  }

  // ---- central turn beacon -------------------------------------------------
  // A cone floating above the centre, tinted to the side-to-move and tipped toward
  // that side's home rail (-Z if it's the local player's turn, +Z otherwise).
  const beaconGeo = keep(new THREE.ConeGeometry(gap * 0.28, gap * 0.7, 18));
  const beacon = meshOf(THREE, beaconGeo, M.beacon, false);
  // I10: lift the beacon a touch (was gap*1.15) so the tilted cone's lower rim
  // can't dip toward the far/near home-rail area from a low seated eye.
  const beaconBaseY = TOP + gap * 1.3;
  beacon.position.set(0, beaconBaseY, 0);
  group.add(beacon);
  // I3: target X-tilt the cone eases toward (set by refreshBeacon, applied in
  // update). Seed it at the canonical first-mover tilt so the cone starts settled
  // rather than snapping on the first frame.
  // I10: clamp the tilt magnitude (was 0.62π) so the apex doesn't swing so far
  // toward ±Z that the cone visually overlaps the home rail / name area.
  const BEACON_TILT = Math.PI * 0.5;
  let beaconTargetTiltX = -BEACON_TILT;
  beacon.rotation.x = beaconTargetTiltX;

  // ---- hover ghost ---------------------------------------------------------
  const ghostH = meshOf(THREE, hBarGeo, M.ghost, false);
  const ghostV = meshOf(THREE, vBarGeo, M.ghost, false);
  // I11: scale the ghost a hair larger than the open bar it previews so the two
  // near-coplanar identical bars (Y_BAR vs Y_GHOST are only ~gap*0.02 apart) read
  // as the ghost floating clear, not shimmering against the pulsing legal underlay.
  ghostH.scale.set(1.04, 1.6, 1.6);
  ghostV.scale.set(1.6, 1.6, 1.04);
  ghostH.visible = false;
  ghostV.visible = false;
  group.add(ghostH);
  group.add(ghostV);
  let hoverCell = null;

  // ---- F2: last-move halo --------------------------------------------------
  // A single reusable over-bar (one per orientation) that hovers on the most-
  // recently claimed edge, tinted to the mover, so a fast box-chain stays
  // followable for opponent + spectator. Rebuilt in paint() from snapshot.lastMove
  // and set in performMove. Slightly fatter + higher than the claimed bar so it
  // reads as a marker rather than re-skinning the edge.
  const haloH = meshOf(THREE, hBarGeo, M.lastMove, false);
  const haloV = meshOf(THREE, vBarGeo, M.lastMove, false);
  haloH.scale.set(1.0, 2.1, 2.1);
  haloV.scale.set(2.1, 2.1, 1.0);
  haloH.visible = false;
  haloV.visible = false;
  group.add(haloH);
  group.add(haloV);
  const Y_HALO = Y_BAR + gap * 0.06;
  let lastMove = null; // { o, r, c, player } most-recently claimed edge (or null)
  function refreshLastMove() {
    haloH.visible = false;
    haloV.visible = false;
    if (!lastMove) return;
    const { o, r, c, player } = lastMove;
    const pos = edgePos[o] && edgePos[o][`${r},${c}`];
    if (!pos) return;
    const tint = player === "red" ? RED : BLUE;
    M.lastMove.color.set(tint);
    M.lastMove.emissive.set(tint);
    const g = o === "h" ? haloH : haloV;
    g.position.set(pos.x, Y_HALO, pos.z);
    g.visible = true;
  }

  // ---- I4: "this move scores" box-completion preview -----------------------
  // A hovered edge can close at most two boxes (one each side). Two reusable
  // glow tiles, tinted to myColor, light up the box footprints the hovered edge
  // would claim. Read-only (a dry-run of applyEdge's close test, no mutation),
  // local-only, and gated by isMyTurn() so opponents/spectators never see it.
  const previewGeo = keep(new THREE.BoxGeometry(gap * 0.7, 0.004, gap * 0.7));
  M.preview = keep(standard(THREE, RED, { roughness: 0.5, emissive: RED, emissiveIntensity: 0.7, transparent: true, opacity: 0.4, depthWrite: false }));
  const previewTiles = [
    meshOf(THREE, previewGeo, M.preview, false),
    meshOf(THREE, previewGeo, M.preview, false),
  ];
  for (const t of previewTiles) { t.visible = false; group.add(t); }

  // ---- animation state (eased visual transitions; never touches logic) -----
  // Each entry drives one mesh's transform/material over a short duration. The
  // logical board is committed before animations start, so sync is untouched —
  // a hard resync (applyState) simply snaps everything to its settled pose.
  const edgeAnims = []; // { bar, t, dur, axis } draw-in stroke for a claimed edge
  const boxAnims = [];  // { mesh, t, dur } out-back pop for a filled box
  let extraTurnFlash = 0; // I2: "you go again" pulse timer (seconds remaining)
  let overFlash = 0;      // I8: winner bloom timer (seconds remaining)
  // F3: per-capture "combo" flourish — flashes the capturing side's home rail on
  // ANY capture (not just the local mover's), so spectators feel a box-chain. One
  // timer per colour, decayed in update(). The freshly-popped boxes already pop
  // via boxAnims; this adds the rail beat. Cleared on resync (paint/applyState).
  const captureFlash = { red: 0, blue: 0 };
  const CAPTURE_FLASH_DUR = 0.55;
  // F4: staggered win-celebration wave over the winner's captured boxes (each box
  // pulses, offset by its distance from board centre) + a steady winning-rail glow.
  // Time-bounded one-shot; cleared by paint()/applyState like overFlash.
  let winWave = 0;             // seconds remaining (0 = inactive)
  const WIN_WAVE_DUR = 2.2;
  let winWaveSide = null;      // "red" | "blue" | null(draw → alternate both rails)
  const easeOutBack = (x) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

  // ---- per-turn cue derivation (LOCAL state only) --------------------------
  const legalBars = [];
  function isMyTurn() {
    if (phase !== "play" || myColor == null || turn !== myColor) return false;
    return typeof ctx.isLocalTurnAllowed === "function" ? !!ctx.isLocalTurnAllowed() : true;
  }

  function refreshLegal() {
    legalBars.length = 0;
    M.legalRed.emissiveIntensity = 0;
    M.legalBlue.emissiveIntensity = 0;
    const myTurn = isMyTurn();
    const legalMat = myColor === "red" ? M.legalRed : myColor === "blue" ? M.legalBlue : null;
    for (const o of ["h", "v"]) {
      for (const key of Object.keys(edgeBars[o])) {
        const [r, c] = key.split(",").map(Number);
        const taken = o === "h" ? st.h[r][c] : st.v[r][c];
        if (taken) continue; // claimed edges keep their owner colour
        const bar = edgeBars[o][key];
        if (myTurn && legalMat) {
          bar.material = legalMat;
          legalBars.push(bar);
        } else {
          bar.material = M.edgeOpen;
        }
      }
    }
  }

  function refreshIdentityEmissive() {
    for (const col of COLORS) {
      const isMine = myColor != null && col === myColor;
      const isTurn = phase === "play" && turn === col;
      home[col].rail.material.emissiveIntensity = isMine ? 0.6 : 0.08;
      home[col].lamp.material.emissiveIntensity = isTurn ? (isMine ? 1.0 : 0.45) : 0.0;
    }
  }

  function refreshBeacon() {
    if (phase === "over") {
      // settle the beacon: tint to winner (or neutral on a draw), stop tilting
      const tint = winner === "red" ? RED : winner === "blue" ? BLUE : "#cccccc";
      M.beacon.color.set(tint);
      M.beacon.emissive.set(tint);
      M.beacon.emissiveIntensity = winner ? 0.5 : 0.15;
      beaconTargetTiltX = 0; // I3: ease back upright in update()
      return;
    }
    const tint = turn === "red" ? RED : BLUE;
    M.beacon.color.set(tint);
    M.beacon.emissive.set(tint);
    M.beacon.emissiveIntensity = 0.55;
    // Point the cone toward the side-to-move's home rail. Cone apex is +Y by
    // default; tilting about X tips the apex toward ±Z. Local turn → tip toward
    // -Z (the local near edge); opponent → tip toward +Z. Spectator (no myColor):
    // tip toward whichever rail that colour sits at (blue=-Z near by layout).
    const towardNear =
      myColor != null ? turn === myColor : turn === (myColor || "blue");
    // I3: set a target tilt and let update() lean the cone toward the new side,
    // instead of teleporting the apex on every turn change.
    beaconTargetTiltX = towardNear ? -BEACON_TILT : BEACON_TILT;
  }

  function refreshCues() {
    refreshLegal();
    refreshIdentityEmissive();
    refreshBeacon();
    refreshTrays();
    refreshLastMove();
    updateGhost();
  }

  // ---- hover ghost handling ------------------------------------------------
  const GHOST_EMISSIVE_BASE = 0.6;
  // Dry-run: which boxes (if any) would drawing edge {o,r,c} close RIGHT NOW?
  // Mirrors applyEdge's tryClose check without mutating `st`. Treats the edge as
  // present, then tests the two adjacent boxes for all four sides. Read-only.
  function boxesClosedBy(o, r, c) {
    const has = (eo, er, ec) =>
      (eo === o && er === r && ec === c) ||
      (eo === "h" ? !!st.h[er]?.[ec] : !!st.v[er]?.[ec]);
    const closes = (br, bc) => {
      if (br < 0 || br >= BOXN || bc < 0 || bc >= BOXN) return false;
      if (st.boxes[br][bc]) return false;
      return has("h", br, bc) && has("h", br + 1, bc) && has("v", br, bc) && has("v", br, bc + 1);
    };
    const out = [];
    if (o === "h") { if (closes(r - 1, c)) out.push([r - 1, c]); if (closes(r, c)) out.push([r, c]); }
    else { if (closes(r, c - 1)) out.push([r, c - 1]); if (closes(r, c)) out.push([r, c]); }
    return out;
  }
  // F6: would drawing edge {o,r,c} leave an adjacent box with exactly 3 sides —
  // i.e. hand the opponent a free capture next turn? Same read-only dry-run shape
  // as boxesClosedBy: treat the edge as present and count each adjacent box's sides.
  function givesAwayBox(o, r, c) {
    const has = (eo, er, ec) =>
      (eo === o && er === r && ec === c) ||
      (eo === "h" ? !!st.h[er]?.[ec] : !!st.v[er]?.[ec]);
    const sides = (br, bc) => {
      if (br < 0 || br >= BOXN || bc < 0 || bc >= BOXN) return -1; // off-grid
      if (st.boxes[br][bc]) return -1; // already claimed
      let n = 0;
      if (has("h", br, bc)) n++;
      if (has("h", br + 1, bc)) n++;
      if (has("v", br, bc)) n++;
      if (has("v", br, bc + 1)) n++;
      return n;
    };
    const boxes = o === "h" ? [[r - 1, c], [r, c]] : [[r, c - 1], [r, c]];
    for (const [br, bc] of boxes) if (sides(br, bc) === 3) return true;
    return false;
  }
  function clearPreview() {
    for (const t of previewTiles) t.visible = false;
  }
  // The ghost can wear either the own-colour material or the F6 "danger" material;
  // track which is currently on the visible ghost so update() pulses the right one.
  let ghostWarnActive = false;
  function clearGhost() {
    ghostH.visible = false;
    ghostV.visible = false;
    clearPreview();
    // Reset the pulsed emissive so a hidden ghost never keeps the last pulse
    // value when it is shown again.
    M.ghost.emissiveIntensity = GHOST_EMISSIVE_BASE;
    M.ghostWarn.emissiveIntensity = 0.7;
    ghostWarnActive = false;
  }
  function updateGhost() {
    clearGhost();
    // Spectators (no local colour) must never get a ghost preview. isMyTurn()
    // already returns false for myColor == null; this is belt-and-suspenders.
    if (!hoverCell || myColor == null || !isMyTurn()) return;
    const { o, r, c } = hoverCell;
    if (!edgeFree(st, o, r, c)) return;
    const pos = edgePos[o][`${r},${c}`];
    if (!pos) return;
    const tint = myColor === "red" ? RED : BLUE;
    // I4: which box footprint(s) this edge would score right now.
    const scoring = boxesClosedBy(o, r, c);
    // F6: warn-tint the ghost when the move scores nothing yet hands the opponent
    // a 3-sided box. A scoring move is always good (you'd capture + go again), so
    // it never gets the danger hue even if a *second* adjacent box is left at 3.
    ghostWarnActive = scoring.length === 0 && givesAwayBox(o, r, c);
    const g = o === "h" ? ghostH : ghostV;
    if (ghostWarnActive) {
      g.material = M.ghostWarn;
    } else {
      g.material = M.ghost;
      M.ghost.color.set(tint);
      M.ghost.emissive.set(tint);
    }
    g.position.set(pos.x, Y_GHOST, pos.z);
    g.visible = true;
    // I4: light the box footprint(s) this edge would score, in myColor.
    if (scoring.length) {
      M.preview.color.set(tint);
      M.preview.emissive.set(tint);
      for (let i = 0; i < scoring.length && i < previewTiles.length; i++) {
        const [br, bc] = scoring[i];
        previewTiles[i].position.set(midX(bc), Y_BOX + 0.001, midZ(br));
        previewTiles[i].visible = true;
      }
    }
  }

  // ---- per-frame breathing pulse -------------------------------------------
  let pulseT = 0;
  function update(dt) {
    const d = Math.min(0.05, dt || 0.016); // clamp so a long frame can't overshoot
    pulseT += d;
    const wave = 0.5 + 0.5 * Math.sin(pulseT * 4.0);
    const myTurn = isMyTurn();
    // legal-edge glow breathes on the local turn
    const glow = myTurn ? 0.22 + 0.4 * wave : 0.0;
    for (const bar of legalBars) bar.material.emissiveIntensity = glow;
    // local lamp breathes a touch brighter on its turn
    if (myColor && myTurn) {
      // I2: extra-turn flash brightens the local lamp on top of the breathe.
      const boost = extraTurnFlash > 0 ? 0.6 * (extraTurnFlash / 0.6) : 0;
      home[myColor].lamp.material.emissiveIntensity = 0.7 + 0.45 * wave + boost;
    }
    // beacon bob + gentle spin + eased lean toward the side-to-move
    if (phase === "play") {
      beacon.position.y = beaconBaseY + Math.sin(pulseT * 2.2) * gap * 0.08;
      beacon.rotation.y = pulseT * 0.8;
    }
    // I3: ease the X-tilt toward its target instead of snapping on turn change.
    beacon.rotation.x += (beaconTargetTiltX - beacon.rotation.x) * Math.min(1, d * 8);

    // I2: extra-turn beacon pulse (decays); brightens the side-to-move tint.
    if (extraTurnFlash > 0) {
      extraTurnFlash = Math.max(0, extraTurnFlash - d);
      M.beacon.emissiveIntensity = 0.55 + 0.6 * (extraTurnFlash / 0.6);
    }
    // I8: one-shot winner bloom on game over (rise then settle).
    if (overFlash > 0) {
      overFlash = Math.max(0, overFlash - d);
      const k = overFlash / 0.4;            // 1→0
      const bloom = Math.sin((1 - k) * Math.PI); // 0→1→0
      const base = winner ? 0.5 : 0.15;
      M.beacon.emissiveIntensity = base + 0.5 * bloom;
      if (winner) home[winner].rail.material.emissiveIntensity = 0.6 + 0.6 * bloom;
    }

    // F3: per-capture home-rail flash (in-play). Adds a decaying boost ON TOP of
    // the rail's identity base so any capture beats visibly, then snaps back to
    // base (the value refreshIdentityEmissive last set) when the flash ends.
    if (phase === "play") {
      for (const col of COLORS) {
        if (captureFlash[col] <= 0) continue;
        captureFlash[col] = Math.max(0, captureFlash[col] - d);
        const isMine = myColor != null && col === myColor;
        const railBase = isMine ? 0.6 : 0.08;
        const f = captureFlash[col] / CAPTURE_FLASH_DUR; // 1→0
        // gentle two-beat throb during the flash window
        const pop = f * (0.5 + 0.5 * Math.sin((1 - f) * Math.PI * 3));
        home[col].rail.material.emissiveIntensity = railBase + 1.0 * pop;
        // settle exactly to base on the final frame
        if (captureFlash[col] === 0) home[col].rail.material.emissiveIntensity = railBase;
      }
    }

    // F4: staggered winner-celebration wave + steady winning-rail glow. The box
    // fill materials are SHARED per colour, so a per-box emissive ripple is
    // impossible (one material → one value). Instead ripple each owned box's
    // SCALE (a per-mesh transform), phase-offset by its distance from board centre,
    // for a rippling lift-and-settle. Draw → both rails alternate; a clear winner →
    // that rail holds a breathing glow. One-shot, restores scale + base on finish.
    if (winWave > 0) {
      winWave = Math.max(0, winWave - d);
      const elapsed = WIN_WAVE_DUR - winWave;
      const cBox = (BOXN - 1) / 2;
      for (let r = 0; r < BOXN; r++) {
        for (let c = 0; c < BOXN; c++) {
          const m = boxMeshes[r][c];
          if (!m) continue;
          // Don't fight an in-flight capture pop (boxAnims own that mesh's scale).
          // Plain loop (no closure) keeps this per-frame block allocation-free.
          let popping = false;
          for (let k = 0; k < boxAnims.length; k++) { if (boxAnims[k].mesh === m) { popping = true; break; } }
          if (popping) continue;
          const owner = st.boxes[r][c];
          if (winWaveSide && owner !== winWaveSide) { m.scale.set(1, 1, 1); continue; }
          const dist = Math.hypot(r - cBox, c - cBox);
          const env = Math.max(0, Math.sin(elapsed * 4.0 - dist * 0.6));
          const s = 1 + 0.18 * env;            // lift in XZ
          m.scale.set(s, 1 + 0.6 * env, s);
        }
      }
      if (winWaveSide) {
        // steady, gently breathing glow on the winning rail
        home[winWaveSide].rail.material.emissiveIntensity = 0.7 + 0.3 * wave;
      } else {
        // draw → alternate both rails
        const a = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(elapsed * 3.0));
        home.red.rail.material.emissiveIntensity = a;
        home.blue.rail.material.emissiveIntensity = 0.8 - a;
      }
      if (winWave === 0) {
        // settle: restore identity rail base + every box's scale.
        refreshIdentityEmissive();
        for (let r = 0; r < BOXN; r++)
          for (let c = 0; c < BOXN; c++)
            if (boxMeshes[r][c]) boxMeshes[r][c].scale.set(1, 1, 1);
        winWaveSide = null;
      }
    }

    if (ghostH.visible || ghostV.visible) {
      // F6: pulse whichever material the ghost currently wears (own colour or warn).
      if (ghostWarnActive) M.ghostWarn.emissiveIntensity = 0.55 + 0.5 * wave;
      else M.ghost.emissiveIntensity = 0.4 + 0.4 * wave;
      M.preview.emissiveIntensity = 0.45 + 0.35 * wave;
    }

    // I1: eased edge "ink stroke" — grow the claimed bar along its long axis from
    // the centre out. (No per-bar emissive: the claimed-bar materials are shared
    // and use a black emissive, so a glow here would be invisible or leak.)
    for (let i = edgeAnims.length - 1; i >= 0; i--) {
      const a = edgeAnims[i];
      a.t += d;
      const k = Math.min(1, a.t / a.dur);
      const s = 0.2 + 0.8 * easeOutCubic(k);
      if (a.o === "h") a.bar.scale.x = s; else a.bar.scale.z = s;
      if (k >= 1) { a.bar.scale.set(1, 1, 1); edgeAnims.splice(i, 1); }
    }
    // I1: eased box "pop + settle" — out-back scale up from a small low fill.
    for (let i = boxAnims.length - 1; i >= 0; i--) {
      const a = boxAnims[i];
      a.t += d;
      const k = Math.min(1, a.t / a.dur);
      const e = easeOutBack(k);
      const sxz = 0.55 + 0.45 * e;
      a.mesh.scale.set(sxz, 0.01 + 0.99 * Math.min(1, e), sxz);
      if (k >= 1) { a.mesh.scale.set(1, 1, 1); boxAnims.splice(i, 1); }
    }
  }

  // ---- painters ------------------------------------------------------------
  // `animate` is true only for a live local/relayed move; paint() (resync) passes
  // false so a hard snapshot settles instantly with no half-played transition.
  function setEdge(o, r, c, player, animate = false) {
    const bar = edgeBars[o][`${r},${c}`];
    if (!bar) return;
    bar.material = player === "red" ? M.red : player === "blue" ? M.blue : M.edgeOpen;
    if (player && animate) {
      // I1: "ink stroke" — grow the bar along its long axis from a stub to full.
      bar.scale.set(1, 1, 1);
      if (o === "h") bar.scale.x = 0.2; else bar.scale.z = 0.2;
      edgeAnims.push({ bar, o, t: 0, dur: 0.2 });
    } else if (bar.scale.x !== 1 || bar.scale.z !== 1) {
      bar.scale.set(1, 1, 1);
    }
  }
  function setBox(r, c, player, animate = false) {
    if (boxMeshes[r][c]) { group.remove(boxMeshes[r][c]); boxMeshes[r][c] = null; }
    if (!player) return;
    const m = meshOf(THREE, boxGeo, player === "red" ? M.boxRed : M.boxBlue, false);
    m.position.set(midX(c), Y_BOX, midZ(r));
    group.add(m);
    boxMeshes[r][c] = m;
    if (animate) {
      // I1: out-back "pop + settle" from a small, low fill to its full footprint.
      m.scale.set(0.55, 0.01, 0.55);
      boxAnims.push({ mesh: m, t: 0, dur: 0.22 });
    }
  }

  function paint() {
    // A hard resync supersedes any in-flight transitions; drop them so update()
    // never tugs a mesh that paint() just rebuilt or settled.
    edgeAnims.length = 0;
    boxAnims.length = 0;
    extraTurnFlash = 0;
    captureFlash.red = 0;
    captureFlash.blue = 0;
    for (let r = 0; r < DOTS; r++) for (let c = 0; c < BOXN; c++) setEdge("h", r, c, st.h[r][c]);
    for (let r = 0; r < BOXN; r++) for (let c = 0; c < DOTS; c++) setEdge("v", r, c, st.v[r][c]);
    for (let r = 0; r < BOXN; r++) for (let c = 0; c < BOXN; c++) setBox(r, c, st.boxes[r][c]);
    layoutIdentity();
    refreshCues();
  }

  // ---- game-over reporting (single-fire) -----------------------------------
  // bug 1: fire ctx.onGameOver exactly once per over-state from EITHER path —
  // performMove (live/relayed move) OR applyState (spectator hydrate / resync that
  // carries the final move). Mirrors connect4/reversi's announceOver guard so the
  // status banner updates for spectators and snapshot-only clients. Reset to false
  // whenever applyState rebuilds (a new game or a not-yet-over board).
  let overAnnounced = false;
  function announceOver(t) {
    if (overAnnounced) return;
    overAnnounced = true;
    const score = t || tally(st);
    try { ctx.onGameOver({ winner, reason: "filled", score }); } catch { /* ignore */ }
  }

  // F4: kick off the staggered winner-celebration wave. Captures the winning side
  // (or null for a draw, which alternates both rails). One-shot, decayed in update.
  function startWinWave() {
    winWaveSide = winner;
    winWave = WIN_WAVE_DUR;
  }

  // ---- move application ----------------------------------------------------
  function performMove(o, r, c, player) {
    const completed = applyEdge(st, o, r, c, player);
    setEdge(o, r, c, player, true);
    for (const [br, bc] of completed) setBox(br, bc, player, true);
    lastMove = { o, r, c, player }; // F2: remember the freshly-claimed edge
    hoverCell = null;
    // I2: "you go again" — when the LOCAL player closes a box (and the game isn't
    // over), pulse the beacon/lamp so the keep-your-turn rule is legible.
    if (completed.length > 0 && player === myColor && !isFull(st)) extraTurnFlash = 0.6;
    // F3: flash the capturing side's home rail on ANY capture (local OR relayed)
    // so spectators/opponents feel a box-chain, not just the local mover.
    if (completed.length > 0) captureFlash[player] = CAPTURE_FLASH_DUR;
    if (isFull(st)) {
      phase = "over";
      const t = tally(st);
      winner = t.red === t.blue ? null : t.red > t.blue ? "red" : "blue";
      overFlash = 0.4; // I8: one-shot winner bloom
      startWinWave();  // F4: staggered celebration over the winner's boxes
      announceOver(t); // bug 1: single-fire end-state report
      refreshCues();
      return;
    }
    // Completing ≥1 box → SAME player moves again; otherwise pass the turn.
    if (completed.length === 0) turn = other(player);
    refreshCues();
  }

  // ---- contract surface ----------------------------------------------------
  function onPointer(hit) {
    if (phase !== "play") return;
    if (typeof ctx.isLocalTurnAllowed === "function" && !ctx.isLocalTurnAllowed()) return;
    if (myColor == null || turn !== myColor) return;
    const cell = hit && hit.cell;
    if (!cell || (cell.o !== "h" && cell.o !== "v")) return;
    if (!edgeFree(st, cell.o, cell.r, cell.c)) return;
    performMove(cell.o, cell.r, cell.c, myColor);
    try { ctx.net.sendMove({ type: "move", o: cell.o, r: cell.r, c: cell.c }); } catch { /* ignore */ }
    if (role === "host") pushSnapshot();
  }

  // Relayed move from the other side. The host applies the move locally too (for a
  // guest move it relays) and re-pushes its authoritative snapshot.
  function applyMove(move, byRole) {
    if (phase !== "play") throw new GameDesync("dots: not in play");
    if (!move || move.type !== "move") return false;
    if (move.o !== "h" && move.o !== "v") return false;
    // The relayed move must come from the side whose turn it is. The framework
    // forwards the mover's role; if it disagrees with `turn` the relay was
    // reordered/duplicated, so trigger a resync rather than silently applying it
    // against the wrong mover and corrupting the box-chain turn.
    if (byRole === "host" || byRole === "guest") {
      const moverColor = byRole === "host" ? "red" : "blue";
      if (moverColor !== turn) throw new GameDesync("dots: mover does not match turn");
    }
    if (!edgeFree(st, move.o, move.r, move.c)) throw new GameDesync("dots: edge already taken");
    performMove(move.o, move.r, move.c, turn);
    if (role === "host") pushSnapshot();
    return true;
  }

  function snapshot() {
    return {
      h: st.h.map((row) => row.slice()),
      v: st.v.map((row) => row.slice()),
      boxes: st.boxes.map((row) => row.slice()),
      turn, phase, winner,
      // F2: additive last-move field so opponents/spectators can place the halo on
      // resync. Back-compatible — applyState tolerates its absence (older snapshots
      // simply hydrate with no halo). Does NOT change move/turn protocol.
      lastMove: lastMove ? { o: lastMove.o, r: lastMove.r, c: lastMove.c, player: lastMove.player } : null,
    };
  }
  function publicState() { return snapshot(); }
  // Host-gated internally so the initial/reset publish (B1) is a no-op for
  // guest/spectator instances, mirroring connect4's pushState().
  function pushSnapshot() {
    if (role !== "host") return;
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* ignore */ }
  }

  // Idempotent rebuild from an authoritative snapshot. NEVER touches myColor/role.
  function applyState(state) {
    // A hard resync supersedes any in-flight flourish; clear the transient timers
    // so update() doesn't tug emissive/transform after the board was rebuilt.
    extraTurnFlash = 0;
    overFlash = 0;
    captureFlash.red = 0;
    captureFlash.blue = 0;
    winWave = 0;
    winWaveSide = null;
    // bug 1: an idempotent resync into the SAME over-state must not re-fire
    // onGameOver. We re-arm (overAnnounced=false) only when the rebuilt board is
    // NOT over (a reset or an in-play snapshot), so a later over-transition still
    // announces exactly once; an over→over resync keeps the prior flag.
    if (!state) {
      st = emptyState();
      turn = "red";
      phase = "play";
      winner = null;
      lastMove = null;
      overAnnounced = false;
    } else {
      const ns = emptyState();
      const cp = (dst, src) => {
        if (!Array.isArray(src)) return;
        for (let r = 0; r < dst.length; r++)
          for (let c = 0; c < dst[r].length; c++) {
            const v = src[r] && src[r][c];
            if (v === "red" || v === "blue") dst[r][c] = v;
          }
      };
      cp(ns.h, state.h);
      cp(ns.v, state.v);
      cp(ns.boxes, state.boxes);
      st = ns;
      turn = state.turn === "blue" ? "blue" : "red";
      phase = state.phase === "over" ? "over" : "play";
      // bug 2: when over, DERIVE the winner from the painted box tally rather than
      // trusting the wire's `winner` (a stale/garbled snapshot whose winner
      // disagrees with the boxes would mistint the celebration). In play, the wire
      // field is just a hint and unused for tinting, so keep validating it.
      if (phase === "over") {
        const t = tally(st);
        winner = t.red === t.blue ? null : t.red > t.blue ? "red" : "blue";
      } else {
        winner = state.winner === "red" || state.winner === "blue" ? state.winner : null;
      }
      // re-arm the over-report when this snapshot is NOT over; keep the prior flag
      // when it stays over so an identical resync won't re-announce.
      if (phase !== "over") overAnnounced = false;
      // F2: hydrate the last-move halo from the (optional) wire field, validating
      // it against the reconstructed board: the named edge must actually be owned
      // by the named player. A missing/garbled field simply yields no halo.
      lastMove = null;
      const lm = state.lastMove;
      if (lm && (lm.o === "h" || lm.o === "v") && (lm.player === "red" || lm.player === "blue")) {
        const owner = lm.o === "h" ? st.h[lm.r]?.[lm.c] : st.v[lm.r]?.[lm.c];
        if (owner === lm.player) lastMove = { o: lm.o, r: lm.r, c: lm.c, player: lm.player };
      }
    }
    hoverCell = null;
    paint();
    // Snap the beacon tilt to the (now-refreshed) target so a resync doesn't
    // visibly swing the cone across the board.
    beacon.rotation.x = beaconTargetTiltX;
    // bug 1: a snapshot that arrives already-over (spectator hydrate, or the final
    // move delivered via snapshot rather than performMove) must still report the
    // end-state so the status banner updates — but only the FIRST time we land on
    // this over-state (overAnnounced guards re-fires on an identical resync). Only
    // play the celebration wave on that first transition, never on every resync.
    if (phase === "over" && !overAnnounced) {
      startWinWave(); // F4: celebrate on a hydrate-into-over (one-shot)
      announceOver();
    }
    // Re-seed the server's cached snapshot on a host reset so a spectator that
    // joins after the reset (but before the next move) hydrates against the fresh
    // board. Host-gated inside pushSnapshot(); no-op for guest/spectator. (B1)
    if (!state) pushSnapshot();
  }

  function setRole(r) {
    role = r || "spectator";
    myColor = role === "host" ? "red" : role === "guest" ? "blue" : null;
    layoutIdentity();
    refreshCues();
  }

  // Flat board: the framework rotates the group by orientFor(seatRy); we only need
  // to re-derive the cues (identity furniture is already laid out per myColor).
  function setSeatRy() { refreshCues(); }

  // Hover preview (framework routes a resolved board cell here). cell may be a
  // grid {r,c} from the geometric fallback (ignore) or our edge {o,r,c}.
  function setHover(cell) {
    if (cell && (cell.o === "h" || cell.o === "v")) hoverCell = cell;
    else hoverCell = null;
    updateGhost();
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  // initial layout + paint
  paint();
  // Snap the beacon to its initial target tilt so a guest (whose first-mover side
  // is the opponent) starts settled rather than leaning across on the first frame.
  beacon.rotation.x = beaconTargetTiltX;

  // B1: publish the authoritative empty board once on mount so a spectator/late
  // guest that requestState()s before the first edge hydrates a real snapshot,
  // marks itself _hydrated, and never drops the first relayed move. Host-gated
  // inside pushSnapshot(); a no-op for guest/spectator instances.
  pushSnapshot();

  return {
    group,
    applyState,
    applyMove,
    onPointer,
    publicState,
    update,
    setRole,
    setSeatRy,
    setHover,
    dispose,
    // NOTE on B3: the audit suggested spectatorAnimates:false on the premise that
    // this module "has no animation." That is no longer true — applyMove now runs
    // performMove, which eases the edge ink-stroke + box pop (I1) on the RECEIVING
    // side too. So we keep the framework DEFAULT (animate). This opts INTO the
    // one-shot, time-bounded post-move snapshot suppression (board.js _onMove),
    // exactly like the sister full-info game connect4: the redundant echo is
    // swallowed for ~one window so a guest/spectator animation completes, and the
    // very next snapshot/move always re-converges — so a dropped relay self-heals
    // within a frame budget. Flipping this to false would tear down every relayed
    // move's animation instantly. (Left undefined === default true.)
  };
}

export default createGame;
