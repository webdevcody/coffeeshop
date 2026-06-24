// Mancala (Kalah) — in-world 3D module (createGame contract). Full-info game.
//
// Pit indexing (canonical, role-independent — this is what travels on the wire):
//   0..5  = HOST pits        6  = HOST store
//   7..12 = GUEST pits       13 = GUEST store
// Sowing is counter-clockwise 0→1→…→5→6→7→…→12→13→0. A player sows from one of
// their own pits, dropping one seed per pit, SKIPPING the opponent's store.
//   • Landing the last seed in your OWN store ⇒ free turn (move again).
//   • Landing the last seed in one of your OWN empty pits (with seeds opposite)
//     ⇒ capture: you take that seed + the opposite pit's seeds into your store.
// When either side empties, the other side sweeps its remaining seeds; higher
// store wins. Host moves first.
//
// ORIENTATION / IDENTITY (the part that makes it actually playable in-world):
// The board is authored in a CANONICAL local frame — HOST home along -Z, GUEST
// home along +Z, HOST store at +X, GUEST store at -X. We declare
// orientPolicy:"self" so board.js does NOT rotate the group; instead we rotate
// it ourselves so the LOCAL player's OWN home row + store always land on the
// near edge (toward their seat) and the opponent sits across the table. The
// local side/colour is derived from ROLE (host=Red, guest=Blue) and is NEVER
// recomputed from inbound wire state — applyState only ever rebuilds the shared
// board/turn, never flips which side is "mine".

import { GameDesync, orientFor } from "./createGame.js";
import { BOARD_SIZE, PALETTE, meshOf, standard } from "./pieces.js";

const HOST_PITS = [0, 1, 2, 3, 4, 5];
const HOST_STORE = 6;
const GUEST_PITS = [7, 8, 9, 10, 11, 12];
const GUEST_STORE = 13;
// Pit directly across the board from pit i (host pit k ↔ guest pit; 12 - i).
const opposite = (i) => 12 - i;

function initBoard() {
  const b = Array(14).fill(0);
  for (const i of [...HOST_PITS, ...GUEST_PITS]) b[i] = 4;
  return b;
}

// Pure sow. Returns { board, freeTurn, captured } or null if the move is illegal
// (not one of `side`'s pits, or an empty pit). Does NOT mutate `board`.
function sow(board, pit, side) {
  const pits = side === "host" ? HOST_PITS : GUEST_PITS;
  const store = side === "host" ? HOST_STORE : GUEST_STORE;
  const oppStore = side === "host" ? GUEST_STORE : HOST_STORE;
  if (!pits.includes(pit) || board[pit] === 0) return null;
  // Snapshot the PRE-sow pit counts so capture can test "was this landing pit
  // empty before this move?" reliably. Using b[i]===1 as a proxy is wrong in the
  // lap-around case (13+ seeds wrap past the origin and drop a seed back into a
  // pit that was empty), so we track emptiness from the original board instead.
  const wasEmpty = board.map((c) => c === 0);
  const b = board.slice();
  let seeds = b[pit];
  b[pit] = 0;
  let i = pit;
  while (seeds > 0) {
    i = (i + 1) % 14;
    if (i === oppStore) continue; // skip the opponent's store
    b[i]++;
    seeds--;
  }
  let captured = 0;
  // Capture: last seed landed in one of MY own pits that was EMPTY before this
  // move (never the origin pit, which a full lap re-fills), and the opposite pit
  // has seeds.
  if (i !== pit && pits.includes(i) && wasEmpty[i] && b[opposite(i)] > 0) {
    captured = b[opposite(i)] + 1;
    b[store] += captured;
    b[i] = 0;
    b[opposite(i)] = 0;
  }
  const freeTurn = i === store;
  return { board: b, freeTurn, captured };
}

function sideEmpty(board, side) {
  const pits = side === "host" ? HOST_PITS : GUEST_PITS;
  return pits.every((i) => board[i] === 0);
}

// End-of-game sweep: each side rakes its own remaining pit seeds into its store.
function sweep(board) {
  const b = board.slice();
  for (const i of HOST_PITS) { b[HOST_STORE] += b[i]; b[i] = 0; }
  for (const i of GUEST_PITS) { b[GUEST_STORE] += b[i]; b[i] = 0; }
  return b;
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "mancala";

  let role = ctx.role;
  let mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
  let seatRy = ctx.seatRy ?? null;

  let board = initBoard();
  let turn = "host";
  let phase = "play";
  let winner = null;
  let disposed = false;

  // Side identity colours. Host = warm red, guest = cool blue (clearly distinct
  // hues). Local identity is ROLE-derived and never read from the wire, so host
  // and guest always render consistent OPPOSITE identities.
  const HOST_HEX = PALETTE.pongLeft;   // "#d65a4a" warm red — host side
  const GUEST_HEX = PALETTE.pongRight; // "#4a85d6" cool blue — guest side
  const SIDE_HEX = { host: HOST_HEX, guest: GUEST_HEX };
  const sideOf = (i) => (i === HOST_STORE || HOST_PITS.includes(i) ? "host" : "guest");

  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    wood: keep(standard(THREE, PALETTE.mancalaWood, { roughness: 0.8 })),
    edge: keep(standard(THREE, PALETTE.mancalaEdge, { roughness: 0.75 })),
    seed: keep(standard(THREE, PALETTE.seed, { roughness: 0.6 })),
    // Per-side pit/store tints. Each side gets its OWN material instance so the
    // local player's home can be lit (emissive lift) independently. The local
    // player's own wells read brighter so "this is mine" is unmistakable.
    pitHost: keep(standard(THREE, HOST_HEX, { roughness: 0.85, emissive: HOST_HEX, emissiveIntensity: 0.0 })),
    pitGuest: keep(standard(THREE, GUEST_HEX, { roughness: 0.85, emissive: GUEST_HEX, emissiveIntensity: 0.0 })),
    // Turn lamps — one per side, lit only when that side is to move.
    lampHost: keep(standard(THREE, HOST_HEX, { roughness: 0.4, metalness: 0.2, emissive: HOST_HEX, emissiveIntensity: 0.0 })),
    lampGuest: keep(standard(THREE, GUEST_HEX, { roughness: 0.4, metalness: 0.2, emissive: GUEST_HEX, emissiveIntensity: 0.0 })),
    glow: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.5, transparent: true, opacity: 0.5, depthWrite: false })),
  };

  // ---- board body ----------------------------------------------------------
  const plankH = 0.03;
  const W = BOARD_SIZE, D = BOARD_SIZE * 0.5;
  const bodyGeo = keep(new THREE.BoxGeometry(W + 0.06, plankH, D + 0.06));
  const body = meshOf(THREE, bodyGeo, M.wood);
  body.position.y = plankH / 2;
  group.add(body);
  // A thin proud rim so the tray reads as a carved board, not a flat plank.
  const rimGeo = keep(new THREE.BoxGeometry(W + 0.06, plankH * 0.5, D + 0.06));
  const rim = meshOf(THREE, rimGeo, M.edge, false);
  rim.position.y = plankH;
  rim.scale.set(1.0, 1.0, 1.0);
  group.add(rim);
  const TOP = plankH;

  // ---- pit layout (CANONICAL frame) ----------------------------------------
  // HOST home along -Z (the canonical near edge), GUEST home along +Z. HOST
  // store at +X, GUEST store at -X. Sowing runs CCW: host pits left→right at -Z,
  // host store at +X, guest pits right→left at +Z, guest store at -X. We then
  // rotate the WHOLE group (orientPolicy:"self") so the local player's home edge
  // faces them.
  const pitR = (W / 7) * 0.36;
  const colX = (k) => -W * 0.30 + k * (W * 0.60 / 5); // 6 columns across the middle
  const pitPos = {};
  for (let k = 0; k < 6; k++) {
    // host pit k at -Z, ascending in +X (k=0 nearest guest store at -X)
    pitPos[HOST_PITS[k]] = { x: colX(k), z: -D * 0.22 };
    // guest pit (CCW continues from host store side): guest pit at +Z, mirrored
    pitPos[GUEST_PITS[5 - k]] = { x: colX(k), z: D * 0.22 };
  }
  pitPos[HOST_STORE] = { x: W * 0.40, z: 0 };   // host store at +X
  pitPos[GUEST_STORE] = { x: -W * 0.40, z: 0 };  // guest store at -X

  const pitGeo = keep(new THREE.CylinderGeometry(pitR, pitR * 0.85, plankH * 0.7, 18));
  const storeGeo = keep(new THREE.CylinderGeometry(pitR * 1.3, pitR * 1.1, plankH * 0.8, 18));
  const seedGeo = keep(new THREE.IcosahedronGeometry(pitR * 0.18, 0));
  const hitGeo = keep(new THREE.CylinderGeometry(pitR * 1.15, pitR * 1.15, 0.05, 12));
  const glowGeo = keep(new THREE.TorusGeometry(pitR * 1.12, pitR * 0.1, 8, 22));
  const lampGeo = keep(new THREE.SphereGeometry(pitR * 0.5, 16, 12));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));

  const seedGroups = {}; // pit -> THREE.Group of seed meshes
  const wells = {};      // pit -> well mesh (so we can brighten the local side)
  const glows = [];

  for (let i = 0; i < 14; i++) {
    const isStore = i === HOST_STORE || i === GUEST_STORE;
    const p = pitPos[i];
    const sideMat = sideOf(i) === "host" ? M.pitHost : M.pitGuest;
    const well = meshOf(THREE, isStore ? storeGeo : pitGeo, sideMat, false);
    well.position.set(p.x, TOP - plankH * 0.3, p.z);
    group.add(well);
    wells[i] = well;
    // Collider for selectable pits (stores are never clicked).
    if (!isStore) {
      const box = new THREE.Mesh(hitGeo, invis);
      box.position.set(p.x, TOP + 0.03, p.z);
      box.userData.cell = { pit: i };
      group.add(box);
    }
    const sg = new THREE.Group();
    sg.position.set(p.x, TOP, p.z);
    group.add(sg);
    seedGroups[i] = sg;
  }

  // ---- turn lamps (one beside each store) ----------------------------------
  // A glowing bead next to each side's store, lit for the side to move. The
  // local player's lamp sits on their near edge after facing, so "my turn" is an
  // in-world cue right in front of them.
  const lampHost = meshOf(THREE, lampGeo, M.lampHost, false);
  lampHost.position.set(W * 0.40, TOP + pitR * 0.6, -D * 0.34);
  group.add(lampHost);
  const lampGuest = meshOf(THREE, lampGeo, M.lampGuest, false);
  lampGuest.position.set(-W * 0.40, TOP + pitR * 0.6, D * 0.34);
  group.add(lampGuest);

  // ---- at-a-glance identity + turn placard ---------------------------------
  // A small placard laid flat just outside the LOCAL player's near home edge.
  // HOST home is authored along -Z, GUEST along +Z; after facing both land near
  // the local seat. We anchor the placard on the local side's edge (ROLE-derived,
  // never the wire) so each client reads a placard naming THEIR side.
  let labelCv = null, labelTex = null, labelMesh = null;
  if (typeof document !== "undefined" && document.createElement) {
    labelCv = document.createElement("canvas");
    labelCv.width = 256;
    labelCv.height = 64;
    labelTex = keep(new THREE.CanvasTexture(labelCv));
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const labelMat = keep(new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }));
    const labelGeo = keep(new THREE.PlaneGeometry(W * 0.55, W * 0.55 * 0.25));
    labelMesh = meshOf(THREE, labelGeo, labelMat, false);
    labelMesh.rotation.x = -Math.PI / 2;
    group.add(labelMesh);
  }

  function placeLabel() {
    if (!labelMesh) return;
    // HOST home sits on the -Z edge, GUEST home on +Z. Spectators (no side) keep
    // the placard on the canonical -Z edge facing the fixed orientation.
    const onZneg = mySide !== "guest"; // host & spectator → -Z edge
    const z = onZneg ? -D * 0.5 - 0.05 : D * 0.5 + 0.05;
    labelMesh.position.set(0, TOP + 0.004, z);
    // Flip the text so it reads upright from the local seat on either edge. After
    // facing, the local home edge is rotated toward the seat; the placard text
    // must run along the seat's view direction.
    labelMesh.rotation.z = onZneg ? 0 : Math.PI;
  }

  function refreshLabel() {
    if (!labelMesh || !labelCv) return;
    const g = labelCv.getContext("2d");
    g.clearRect(0, 0, 256, 64);
    let text;
    let color = "#f0e4cf";
    if (!mySide) {
      const lead = board[HOST_STORE] === board[GUEST_STORE] ? "Even"
        : board[HOST_STORE] > board[GUEST_STORE] ? "Red leads" : "Blue leads";
      text = phase === "over"
        ? (winner ? `${winner === "host" ? "Red" : "Blue"} wins` : "Draw")
        : `Spectating — ${lead}`;
    } else {
      const sideName = mySide === "host" ? "Red" : "Blue";
      const yours = phase === "over"
        ? (winner === mySide ? "You win" : winner ? "You lose" : "Draw")
        : (turn === mySide ? "Your turn" : "Opponent's turn");
      text = `You are ${sideName} — ${yours}`;
      color = SIDE_HEX[mySide];
    }
    g.fillStyle = "rgba(28,20,12,0.82)";
    g.beginPath();
    const rr = 12;
    g.moveTo(rr, 0); g.arcTo(256, 0, 256, 64, rr); g.arcTo(256, 64, 0, 64, rr);
    g.arcTo(0, 64, 0, 0, rr); g.arcTo(0, 0, 256, 0, rr); g.closePath(); g.fill();
    g.font = "bold 26px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, 128, 34);
    labelTex.needsUpdate = true;
  }

  // ---- facing (orientPolicy:"self") ----------------------------------------
  // Rotate the whole group so the LOCAL player's home edge faces their seat.
  // HOST home is authored at -Z, so orientFor(seatRy) brings it to the seat.
  // GUEST home is at +Z, so add PI to flip it near. Spectators / no seat use the
  // canonical orientation (host home toward the fixed -Z). Per-pit colliders carry
  // canonical pit ids and rotate WITH the group, so click→pit mapping is
  // self-correcting and the wire indexing is unchanged across clients.
  function applyFacing() {
    const base = orientFor(seatRy);
    const extra = mySide === "guest" ? Math.PI : 0;
    group.rotation.y = base + extra;
  }

  // Brighten the LOCAL player's own six pits + store (emissive lift) so their
  // home reads as clearly theirs; the opponent's side stays matte.
  function updateIdentity() {
    M.pitHost.emissiveIntensity = mySide === "host" ? 0.34 : 0.0;
    M.pitGuest.emissiveIntensity = mySide === "guest" ? 0.34 : 0.0;
    M.pitHost.needsUpdate = true;
    M.pitGuest.needsUpdate = true;
    placeLabel();
    refreshLabel();
    refreshLamps();
    applyFacing();
  }

  function refreshLamps() {
    const live = phase === "play";
    M.lampHost.emissiveIntensity = live && turn === "host" ? 0.95 : 0.05;
    M.lampGuest.emissiveIntensity = live && turn === "guest" ? 0.95 : 0.05;
    M.lampHost.needsUpdate = true;
    M.lampGuest.needsUpdate = true;
  }

  function renderSeeds() {
    for (let i = 0; i < 14; i++) {
      const sg = seedGroups[i];
      while (sg.children.length) sg.remove(sg.children[0]);
      const n = board[i];
      const isStore = i === HOST_STORE || i === GUEST_STORE;
      const spread = isStore ? pitR * 1.0 : pitR * 0.6;
      for (let k = 0; k < n; k++) {
        const s = meshOf(THREE, seedGeo, M.seed, false); // tiny seeds don't cast shadows
        const ang = (k / Math.max(1, n)) * Math.PI * 2 + k * 0.7;
        const rad = spread * (0.3 + 0.7 * ((k % 5) / 5));
        s.position.set(
          Math.cos(ang) * rad,
          pitR * 0.18 + (k % 3) * pitR * 0.12,
          Math.sin(ang) * rad,
        );
        sg.add(s);
      }
    }
  }

  function clearGlows() {
    for (const g of glows) group.remove(g);
    glows.length = 0;
  }
  function refreshGlows() {
    clearGlows();
    if (phase !== "play" || role === "spectator" || !mySide) return;
    if (turn !== mySide || !ctx.isLocalTurnAllowed()) return;
    const pits = mySide === "host" ? HOST_PITS : GUEST_PITS;
    for (const i of pits) {
      if (board[i] === 0) continue;
      const g = meshOf(THREE, glowGeo, M.glow, false);
      g.rotation.x = Math.PI / 2;
      const p = pitPos[i];
      g.position.set(p.x, TOP + 0.035, p.z);
      group.add(g);
      glows.push(g);
    }
  }

  // ---- end-of-game check + commit ------------------------------------------
  function maybeEnd() {
    if (sideEmpty(board, "host") || sideEmpty(board, "guest")) {
      board = sweep(board);
      phase = "over";
      winner = board[HOST_STORE] === board[GUEST_STORE] ? null
        : board[HOST_STORE] > board[GUEST_STORE] ? "host" : "guest";
      return true;
    }
    return false;
  }

  // Apply a fully-validated sow result for `side`, advance turn, repaint, and
  // fire onGameOver once at the end. Returns true.
  function commit(res, side) {
    board = res.board;
    if (maybeEnd()) {
      renderSeeds();
      clearGlows();
      refreshLamps();
      refreshLabel();
      try { ctx.onGameOver({ winner, reason: "empty" }); } catch { /* */ }
      return true;
    }
    if (!res.freeTurn) turn = side === "host" ? "guest" : "host";
    renderSeeds();
    refreshLamps();
    refreshGlows();
    refreshLabel();
    return true;
  }

  function performMove(pit, side) {
    const res = sow(board, pit, side);
    if (!res) return false;
    return commit(res, side);
  }

  // ---- local input ---------------------------------------------------------
  function onPointer(hit) {
    if (phase !== "play" || !mySide || turn !== mySide) return;
    if (!ctx.isLocalTurnAllowed()) return;
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.pit)) return;
    const pit = cell.pit;
    const pits = mySide === "host" ? HOST_PITS : GUEST_PITS;
    if (!pits.includes(pit) || board[pit] === 0) return;
    clearGlows();
    const ok = performMove(pit, mySide);
    if (!ok) { refreshGlows(); return; }
    try { ctx.net.sendMove({ type: "move", pit }); } catch { /* */ }
    if (role === "host") pushSnapshot();
  }

  // ---- relayed move (guest move arrives at host; host echo to guests) ------
  function applyMove(move) {
    if (phase !== "play") throw new GameDesync("mancala: not in play");
    if (!move || move.type !== "move" || !Number.isInteger(move.pit)) return false;
    const pits = turn === "host" ? HOST_PITS : GUEST_PITS;
    if (!pits.includes(move.pit) || board[move.pit] === 0)
      throw new GameDesync("mancala: illegal pit");
    const ok = performMove(move.pit, turn);
    if (!ok) throw new GameDesync("mancala: move rejected");
    if (role === "host") pushSnapshot();
    return true;
  }

  // ---- snapshots -----------------------------------------------------------
  // The wire carries ONLY shared game state (canonical board + whose turn).
  // It never carries local role/colour — applyState must not flip "my side".
  function snapshot() {
    return { board: board.slice(), turn, phase, winner };
  }
  function publicState() { return snapshot(); }
  function pushSnapshot() {
    if (role !== "host") return;
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  function applyState(state) {
    if (!state) {
      board = initBoard();
      turn = "host";
      phase = "play";
      winner = null;
    } else {
      const b = Array(14).fill(0);
      if (Array.isArray(state.board)) for (let i = 0; i < 14; i++) b[i] = state.board[i] | 0;
      board = b;
      turn = state.turn === "guest" ? "guest" : "host";
      phase = state.phase === "over" ? "over" : "play";
      winner = state.winner === "host" || state.winner === "guest" ? state.winner : null;
    }
    // NOTE: mySide / role are NOT touched here — identity stays ROLE-derived.
    renderSeeds();
    refreshLamps();
    refreshGlows();
    refreshLabel();
  }

  // ---- role / seat changes (in-place promotion) ----------------------------
  function setRole(r) {
    role = r || "spectator";
    mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
    updateIdentity();
    refreshGlows();
  }
  function setSeatRy(ry) {
    seatRy = ry == null ? null : ry;
    applyFacing();
    placeLabel();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearGlows();
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  // ---- initial paint -------------------------------------------------------
  updateIdentity();
  renderSeeds();
  refreshGlows();

  return {
    group,
    orientPolicy: "self",
    applyState,
    applyMove,
    onPointer,
    publicState,
    setRole,
    setSeatRy,
    dispose,
  };
}

export default createGame;
