// Dots and Boxes — in-world 3D module (createGame contract). Full-info.
// DOTS=6 → 5×5 boxes. Move targets an EDGE {o:'h'|'v', r, c}. Closing a box
// grants another turn. Host = red (first), guest = blue.

import { GameDesync } from "./createGame.js";
import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard } from "./pieces.js";

const DOTS = 6;
const BOXN = DOTS - 1;
const other = (p) => (p === "red" ? "blue" : "red");

function emptyState() {
  return {
    h: Array.from({ length: DOTS }, () => Array(BOXN).fill(null)), // h[r][c] top/bottom edges
    v: Array.from({ length: BOXN }, () => Array(DOTS).fill(null)), // v[r][c] left/right edges
    boxes: Array.from({ length: BOXN }, () => Array(BOXN).fill(null)),
  };
}

function edgeFree(st, o, r, c) {
  if (o === "h") return r >= 0 && r < DOTS && c >= 0 && c < BOXN && !st.h[r][c];
  return r >= 0 && r < BOXN && c >= 0 && c < DOTS && !st.v[r][c];
}

// Apply edge, return list of box [r,c] newly completed.
function applyEdge(st, o, r, c, player) {
  if (o === "h") st.h[r][c] = player;
  else st.v[r][c] = player;
  const completed = [];
  const check = (br, bc) => {
    if (br < 0 || br >= BOXN || bc < 0 || bc >= BOXN) return;
    if (st.boxes[br][bc]) return;
    if (st.h[br][bc] && st.h[br + 1][bc] && st.v[br][bc] && st.v[br][bc + 1]) {
      st.boxes[br][bc] = player;
      completed.push([br, bc]);
    }
  };
  if (o === "h") { check(r - 1, c); check(r, c); }
  else { check(r, c - 1); check(r, c); }
  return completed;
}

function isFull(st) {
  for (let r = 0; r < BOXN; r++) for (let c = 0; c < BOXN; c++) if (!st.boxes[r][c]) return false;
  return true;
}
function tally(st) {
  let red = 0, blue = 0;
  for (const row of st.boxes) for (const v of row) { if (v === "red") red++; else if (v === "blue") blue++; }
  return { red, blue };
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "dotsandboxes";

  let role = ctx.role;
  let myColor = role === "host" ? "red" : role === "guest" ? "blue" : null;
  let st = emptyState();
  let turn = "red";
  let phase = "play";
  let winner = null;

  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    plank: keep(standard(THREE, "#3a281a", { roughness: 0.8 })),
    dot: keep(standard(THREE, "#d8c39a", { roughness: 0.6 })),
    edgeOpen: keep(standard(THREE, "#5a4633", { roughness: 0.8, transparent: true, opacity: 0.25, depthWrite: false })),
    red: keep(standard(THREE, PALETTE.pongLeft, { roughness: 0.5 })),
    blue: keep(standard(THREE, PALETTE.pongRight, { roughness: 0.5 })),
    boxRed: keep(standard(THREE, "#e08a7e", { roughness: 0.6, transparent: true, opacity: 0.7 })),
    boxBlue: keep(standard(THREE, "#8ab0e0", { roughness: 0.6, transparent: true, opacity: 0.7 })),
  };

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

  // dots
  const dotGeo = keep(new THREE.SphereGeometry(gap * 0.09, 10, 8));
  for (let r = 0; r < DOTS; r++)
    for (let c = 0; c < DOTS; c++) {
      const d = meshOf(THREE, dotGeo, M.dot);
      d.position.set(dotX(c), TOP + gap * 0.05, dotZ(r));
      group.add(d);
    }

  // edges: a thin bar mesh + a collider per possible edge.
  const hBarGeo = keep(new THREE.BoxGeometry(gap * 0.8, gap * 0.06, gap * 0.06));
  const vBarGeo = keep(new THREE.BoxGeometry(gap * 0.06, gap * 0.06, gap * 0.8));
  const hHitGeo = keep(new THREE.BoxGeometry(gap * 0.8, 0.03, gap * 0.5));
  const vHitGeo = keep(new THREE.BoxGeometry(gap * 0.5, 0.03, gap * 0.8));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));
  const edgeBars = { h: {}, v: {} };

  for (let r = 0; r < DOTS; r++)
    for (let c = 0; c < BOXN; c++) {
      const px = (dotX(c) + dotX(c + 1)) / 2, pz = dotZ(r);
      const bar = meshOf(THREE, hBarGeo, M.edgeOpen);
      bar.position.set(px, TOP + gap * 0.05, pz);
      group.add(bar);
      edgeBars.h[`${r},${c}`] = bar;
      const box = new THREE.Mesh(hHitGeo, invis);
      box.position.set(px, TOP + 0.015, pz);
      box.userData.cell = { o: "h", r, c };
      group.add(box);
    }
  for (let r = 0; r < BOXN; r++)
    for (let c = 0; c < DOTS; c++) {
      const px = dotX(c), pz = (dotZ(r) + dotZ(r + 1)) / 2;
      const bar = meshOf(THREE, vBarGeo, M.edgeOpen);
      bar.position.set(px, TOP + gap * 0.05, pz);
      group.add(bar);
      edgeBars.v[`${r},${c}`] = bar;
      const box = new THREE.Mesh(vHitGeo, invis);
      box.position.set(px, TOP + 0.015, pz);
      box.userData.cell = { o: "v", r, c };
      group.add(box);
    }

  // box fills
  const boxGeo = keep(new THREE.BoxGeometry(gap * 0.8, 0.004, gap * 0.8));
  const boxMeshes = Array.from({ length: BOXN }, () => Array(BOXN).fill(null));

  function setEdge(o, r, c, player) {
    const bar = edgeBars[o][`${r},${c}`];
    if (bar) bar.material = player === "red" ? M.red : player === "blue" ? M.blue : M.edgeOpen;
  }
  function setBox(r, c, player) {
    if (boxMeshes[r][c]) { group.remove(boxMeshes[r][c]); boxMeshes[r][c] = null; }
    if (!player) return;
    const m = meshOf(THREE, boxGeo, player === "red" ? M.boxRed : M.boxBlue, false);
    m.position.set((dotX(c) + dotX(c + 1)) / 2, TOP + 0.006, (dotZ(r) + dotZ(r + 1)) / 2);
    group.add(m);
    boxMeshes[r][c] = m;
  }

  function performMove(o, r, c, player) {
    const completed = applyEdge(st, o, r, c, player);
    setEdge(o, r, c, player);
    for (const [br, bc] of completed) setBox(br, bc, player);
    if (isFull(st)) {
      phase = "over";
      const t = tally(st);
      winner = t.red === t.blue ? null : t.red > t.blue ? "red" : "blue";
      try { ctx.onGameOver({ winner, reason: "filled" }); } catch { /* */ }
      return;
    }
    if (completed.length === 0) turn = other(player); // box claim → same player again
  }

  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed() || turn !== myColor) return;
    const cell = hit && hit.cell;
    if (!cell || (cell.o !== "h" && cell.o !== "v")) return;
    if (!edgeFree(st, cell.o, cell.r, cell.c)) return;
    performMove(cell.o, cell.r, cell.c, myColor);
    try { ctx.net.sendMove({ type: "move", o: cell.o, r: cell.r, c: cell.c }); } catch { /* */ }
    if (role === "host") pushSnapshot();
  }

  function applyMove(move) {
    if (phase !== "play") throw new GameDesync("dots: not in play");
    if (!move || move.type !== "move") return false;
    if (!edgeFree(st, move.o, move.r, move.c)) throw new GameDesync("dots: edge taken");
    performMove(move.o, move.r, move.c, turn);
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
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  function paint() {
    for (let r = 0; r < DOTS; r++) for (let c = 0; c < BOXN; c++) setEdge("h", r, c, st.h[r][c]);
    for (let r = 0; r < BOXN; r++) for (let c = 0; c < DOTS; c++) setEdge("v", r, c, st.v[r][c]);
    for (let r = 0; r < BOXN; r++) for (let c = 0; c < BOXN; c++) setBox(r, c, st.boxes[r][c]);
  }

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
    paint();
  }

  function setRole(r) {
    role = r || "spectator";
    myColor = role === "host" ? "red" : role === "guest" ? "blue" : null;
  }
  function setSeatRy() {}
  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  paint();
  return { group, applyState, applyMove, onPointer, publicState, setRole, setSeatRy, dispose };
}

export default createGame;
