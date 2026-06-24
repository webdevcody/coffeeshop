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
    edgeOpen: keep(standard(THREE, "#5a4633", { roughness: 0.8, transparent: true, opacity: 0.22, depthWrite: false })),
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
      d.position.set(dotX(c), TOP + gap * 0.05, dotZ(r));
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
      bar.position.set(px, TOP + gap * 0.05, pz);
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
      bar.position.set(px, TOP + gap * 0.05, pz);
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
      home[col].lamp.position.set(span * 0.46, railY + gap * 0.06, z);
    };
    place(nearColor, -edgeZ);
    place(farColor, edgeZ);
  }

  // ---- central turn beacon -------------------------------------------------
  // A cone floating above the centre, tinted to the side-to-move and tipped toward
  // that side's home rail (-Z if it's the local player's turn, +Z otherwise).
  const beaconGeo = keep(new THREE.ConeGeometry(gap * 0.28, gap * 0.7, 18));
  const beacon = meshOf(THREE, beaconGeo, M.beacon, false);
  const beaconBaseY = TOP + gap * 1.15;
  beacon.position.set(0, beaconBaseY, 0);
  group.add(beacon);

  // ---- hover ghost ---------------------------------------------------------
  const ghostH = meshOf(THREE, hBarGeo, M.ghost, false);
  const ghostV = meshOf(THREE, vBarGeo, M.ghost, false);
  ghostH.visible = false;
  ghostV.visible = false;
  group.add(ghostH);
  group.add(ghostV);
  let hoverCell = null;

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
      beacon.rotation.set(0, 0, 0);
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
    beacon.rotation.set(towardNear ? Math.PI * 0.62 : -Math.PI * 0.62, 0, 0);
  }

  function refreshCues() {
    refreshLegal();
    refreshIdentityEmissive();
    refreshBeacon();
    updateGhost();
  }

  // ---- hover ghost handling ------------------------------------------------
  const GHOST_EMISSIVE_BASE = 0.6;
  function clearGhost() {
    ghostH.visible = false;
    ghostV.visible = false;
    // Reset the pulsed emissive so a hidden ghost never keeps the last pulse
    // value when it is shown again.
    M.ghost.emissiveIntensity = GHOST_EMISSIVE_BASE;
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
    M.ghost.color.set(tint);
    M.ghost.emissive.set(tint);
    const g = o === "h" ? ghostH : ghostV;
    g.position.set(pos.x, TOP + gap * 0.05, pos.z);
    g.visible = true;
  }

  // ---- per-frame breathing pulse -------------------------------------------
  let pulseT = 0;
  function update(dt) {
    pulseT += dt || 0.016;
    const wave = 0.5 + 0.5 * Math.sin(pulseT * 4.0);
    const myTurn = isMyTurn();
    // legal-edge glow breathes on the local turn
    const glow = myTurn ? 0.22 + 0.4 * wave : 0.0;
    for (const bar of legalBars) bar.material.emissiveIntensity = glow;
    // local lamp breathes a touch brighter on its turn
    if (myColor && myTurn) home[myColor].lamp.material.emissiveIntensity = 0.7 + 0.45 * wave;
    // beacon bob + gentle spin while in play
    if (phase === "play") {
      beacon.position.y = beaconBaseY + Math.sin(pulseT * 2.2) * gap * 0.08;
      beacon.rotation.y = pulseT * 0.8;
    }
    if (ghostH.visible || ghostV.visible) {
      M.ghost.emissiveIntensity = 0.4 + 0.4 * wave;
    }
  }

  // ---- painters ------------------------------------------------------------
  function setEdge(o, r, c, player) {
    const bar = edgeBars[o][`${r},${c}`];
    if (bar) bar.material = player === "red" ? M.red : player === "blue" ? M.blue : M.edgeOpen;
  }
  function setBox(r, c, player) {
    if (boxMeshes[r][c]) { group.remove(boxMeshes[r][c]); boxMeshes[r][c] = null; }
    if (!player) return;
    const m = meshOf(THREE, boxGeo, player === "red" ? M.boxRed : M.boxBlue, false);
    m.position.set(midX(c), TOP + 0.008, midZ(r));
    group.add(m);
    boxMeshes[r][c] = m;
  }

  function paint() {
    for (let r = 0; r < DOTS; r++) for (let c = 0; c < BOXN; c++) setEdge("h", r, c, st.h[r][c]);
    for (let r = 0; r < BOXN; r++) for (let c = 0; c < DOTS; c++) setEdge("v", r, c, st.v[r][c]);
    for (let r = 0; r < BOXN; r++) for (let c = 0; c < BOXN; c++) setBox(r, c, st.boxes[r][c]);
    layoutIdentity();
    refreshCues();
  }

  // ---- move application ----------------------------------------------------
  function performMove(o, r, c, player) {
    const completed = applyEdge(st, o, r, c, player);
    setEdge(o, r, c, player);
    for (const [br, bc] of completed) setBox(br, bc, player);
    hoverCell = null;
    if (isFull(st)) {
      phase = "over";
      const t = tally(st);
      winner = t.red === t.blue ? null : t.red > t.blue ? "red" : "blue";
      try { ctx.onGameOver({ winner, reason: "filled", score: t }); } catch { /* ignore */ }
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
    };
  }
  function publicState() { return snapshot(); }
  function pushSnapshot() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* ignore */ }
  }

  // Idempotent rebuild from an authoritative snapshot. NEVER touches myColor/role.
  function applyState(state) {
    if (!state) {
      st = emptyState();
      turn = "red";
      phase = "play";
      winner = null;
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
      winner = state.winner === "red" || state.winner === "blue" ? state.winner : null;
    }
    hoverCell = null;
    paint();
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
  };
}

export default createGame;
