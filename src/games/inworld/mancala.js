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
    // Seeds read poorly (near-white "#e8e0cf") against the light "#8a5a2b" wood
    // when matte, so the COUNT is hard to read across the table (I6). Bump
    // roughness and give a faint warm emissive so each seed reads as a distinct
    // bead under café lighting; the dark seed-edge ring (below) sharpens the
    // silhouette so seeds are countable at a glance from either seat.
    seed: keep(standard(THREE, PALETTE.seed, { roughness: 0.85, metalness: 0.0, emissive: PALETTE.seed, emissiveIntensity: 0.1 })),
    seedEdge: keep(standard(THREE, PALETTE.mancalaEdge, { roughness: 0.9 })),
    // Per-side pit/store tints. Each side gets its OWN material instance so the
    // local player's home can be lit (emissive lift) independently. The local
    // player's own wells read brighter so "this is mine" is unmistakable.
    pitHost: keep(standard(THREE, HOST_HEX, { roughness: 0.85, emissive: HOST_HEX, emissiveIntensity: 0.0 })),
    pitGuest: keep(standard(THREE, GUEST_HEX, { roughness: 0.85, emissive: GUEST_HEX, emissiveIntensity: 0.0 })),
    // Per-side STORE materials (separate instances) so a capture can pulse the
    // capturing side's store independently of its pit row (I2).
    storeHost: keep(standard(THREE, HOST_HEX, { roughness: 0.8, emissive: HOST_HEX, emissiveIntensity: 0.0 })),
    storeGuest: keep(standard(THREE, GUEST_HEX, { roughness: 0.8, emissive: GUEST_HEX, emissiveIntensity: 0.0 })),
    // Turn lamps — one per side, lit only when that side is to move.
    lampHost: keep(standard(THREE, HOST_HEX, { roughness: 0.4, metalness: 0.2, emissive: HOST_HEX, emissiveIntensity: 0.0 })),
    lampGuest: keep(standard(THREE, GUEST_HEX, { roughness: 0.4, metalness: 0.2, emissive: GUEST_HEX, emissiveIntensity: 0.0 })),
    glow: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.5, transparent: true, opacity: 0.5, depthWrite: false })),
    // Brighter hover ring for the pit the local player is pointing at (I4).
    hover: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 1.1, transparent: true, opacity: 0.85, depthWrite: false })),
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
  // A slightly larger flat icosahedron drawn just under each seed as a dark edge
  // ring so the bead's silhouette reads against the light wood (I6). Cheap: one
  // extra tiny mesh per seed, pooled exactly like the seeds.
  const seedEdgeGeo = keep(new THREE.IcosahedronGeometry(pitR * 0.24, 0));
  const hitGeo = keep(new THREE.CylinderGeometry(pitR * 1.15, pitR * 1.15, 0.05, 12));
  const glowGeo = keep(new THREE.TorusGeometry(pitR * 1.12, pitR * 0.1, 8, 22));
  const hoverGeo = keep(new THREE.TorusGeometry(pitR * 1.25, pitR * 0.13, 10, 26));
  const lampGeo = keep(new THREE.SphereGeometry(pitR * 0.5, 16, 12));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));

  const seedGroups = {}; // pit -> THREE.Group of seed meshes
  const wells = {};      // pit -> well mesh (so we can brighten the local side)
  const glows = [];

  // ---- visual FX state (purely cosmetic; never gates rules/sync) -----------
  // Every field here is reconstructable from `board`/`turn`/`phase`, so a
  // snapshot landing mid-animation simply re-derives the final layout (no desync).
  const anim = {
    active: false,   // any seed spawn-pop in flight
    clock: 0,        // accumulating time for lamp / store pulses
    capture: 0,      // capture flourish timer (s remaining), 0 = idle
    captureSide: null,
  };
  function ensureRunning() { anim.active = true; }

  for (let i = 0; i < 14; i++) {
    const isStore = i === HOST_STORE || i === GUEST_STORE;
    const p = pitPos[i];
    const side = sideOf(i);
    const sideMat = isStore
      ? (side === "host" ? M.storeHost : M.storeGuest)
      : (side === "host" ? M.pitHost : M.pitGuest);
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
  const LAMP_Y = TOP + pitR * 0.6; // rest height; the local lamp bobs above this
  const lampHost = meshOf(THREE, lampGeo, M.lampHost, false);
  lampHost.position.set(W * 0.40, LAMP_Y, -D * 0.34);
  group.add(lampHost);
  const lampGuest = meshOf(THREE, lampGeo, M.lampGuest, false);
  lampGuest.position.set(-W * 0.40, LAMP_Y, D * 0.34);
  group.add(lampGuest);

  // ---- hover ring ----------------------------------------------------------
  // A single brighter ring that sits on the pit the local player is pointing at
  // during their turn (I4), giving immediate "this is clickable" feedback before
  // the click. Hidden by default; positioned/shown by setHover().
  const hoverRing = meshOf(THREE, hoverGeo, M.hover, false);
  hoverRing.rotation.x = Math.PI / 2;
  hoverRing.renderOrder = 6; // above the legal-move glows
  hoverRing.visible = false;
  group.add(hoverRing);
  let hoverPit = -1;

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
    // depthWrite:false + a polygon offset so the flat placard never z-fights the
    // board body / rim top face from a low seated camera (B5).
    const labelMat = keep(new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
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
    // Lift the placard clearly above the rim's top face (rim top ≈ TOP*1.25) so a
    // tilted seated camera never z-fights it against the board body (B5).
    labelMesh.position.set(0, TOP + 0.012, z);
    // Flip the text so it reads upright from the local seat on either edge. The
    // plane is laid flat (rotation.x = -PI/2), which maps canvas text-up (plane
    // local +Y) to local -Z. Readable text must point toward board centre, away
    // from the seat: the -Z home edge (host/spectator) needs text-up = +Z, so it
    // takes the PI in-plane flip; the +Z home edge (guest) needs text-up = -Z, so
    // it takes 0. (Same flat-label inversion battleship's drawLabel fixes for its
    // -Z-edge pillar labels by pre-rotating the canvas PI to land text-up at +Z.)
    labelMesh.rotation.z = onZneg ? Math.PI : 0;
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
    // Auto-fit so the longest states (e.g. "You are Blue — Opponent's turn")
    // never clip the 256px canvas — shrink the font until the text fits, mirroring
    // battleship's fitFont(). Keep a ~12px margin on each side.
    let px = 26;
    g.font = `bold ${px}px sans-serif`;
    while (px > 12 && g.measureText(text).width > 256 - 24) {
      px -= 2;
      g.font = `bold ${px}px sans-serif`;
    }
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
    // The local player's own STORE reads as theirs too (matching their pit row);
    // the opponent store stays matte. Capture flourishes pulse on top of this base.
    M.storeHost.emissiveIntensity = mySide === "host" ? 0.28 : 0.0;
    M.storeGuest.emissiveIntensity = mySide === "guest" ? 0.28 : 0.0;
    M.pitHost.needsUpdate = true;
    M.pitGuest.needsUpdate = true;
    placeLabel();
    refreshLabel();
    refreshLamps();
    applyFacing();
  }

  // Base (rest) emissive for each lamp. The local lamp also gets a live pulse in
  // update() when it is the local player's turn — the steady value is the floor.
  const lampBase = { host: 0.05, guest: 0.05 };
  function refreshLamps() {
    const live = phase === "play";
    lampBase.host = live && turn === "host" ? 0.95 : 0.05;
    lampBase.guest = live && turn === "guest" ? 0.95 : 0.05;
    M.lampHost.emissiveIntensity = lampBase.host;
    M.lampGuest.emissiveIntensity = lampBase.guest;
    M.lampHost.needsUpdate = true;
    M.lampGuest.needsUpdate = true;
    // Keep the lamps at rest height until update() lifts the local one.
    lampHost.position.y = LAMP_Y;
    lampGuest.position.y = LAMP_Y;
  }

  // Deterministic seed position as a pure function of (pit i, SLOT k) — crucially
  // NOT of the pit's current count. This is what removes the per-move "twitch"
  // (B6): when a pit's count grows from n→n+1, slots 0..n-1 keep their exact
  // positions and only the new slot k=n appears, so existing seeds never teleport.
  // A small per-pit phase offset keeps neighbouring pits from looking identical.
  function seedSlot(i, k, isStore) {
    const spread = isStore ? pitR * 1.0 : pitR * 0.62;
    const ang = k * 2.39996 + i * 1.3; // golden-angle scatter, stable per slot
    const ring = isStore ? (0.18 + 0.82 * ((k % 7) / 7)) : (0.3 + 0.7 * ((k % 5) / 5));
    const rad = spread * ring;
    return {
      x: Math.cos(ang) * rad,
      y: pitR * 0.18 + (k % 3) * pitR * 0.12,
      z: Math.sin(ang) * rad,
    };
  }

  function makeSeed() {
    const s = meshOf(THREE, seedGeo, M.seed, false); // tiny seeds don't cast shadows
    // A dark edge bead nested just under the seed so its silhouette reads against
    // the light wood (I6). Slightly larger, sunk a hair so only the rim shows.
    const e = meshOf(THREE, seedEdgeGeo, M.seedEdge, false);
    e.position.y = -pitR * 0.06;
    e.scale.setScalar(0.82);
    s.add(e);
    return s;
  }

  // Pool/diff seeds instead of tearing down + reallocating ~48 meshes every paint
  // (B6/I8). We add/remove only the DELTA per pit and reposition kept seeds to
  // their stable slot. With animate=true (a local/relayed move) new seeds spawn-pop
  // in update(dt); an authoritative snapshot calls renderSeeds() with no animate,
  // so it silently converges the layout without popping. Either way the result is
  // a pure function of `board`, so a snapshot landing mid-pop is fully sync-safe.
  function renderSeeds(animate) {
    for (let i = 0; i < 14; i++) {
      const sg = seedGroups[i];
      const n = board[i];
      const isStore = i === HOST_STORE || i === GUEST_STORE;
      // Trim surplus seeds (e.g. a pit emptied by a sow / capture).
      while (sg.children.length > n) sg.remove(sg.children[sg.children.length - 1]);
      // Reposition kept seeds to their stable slot (idempotent; no teleport).
      for (let k = 0; k < sg.children.length; k++) {
        const s = sg.children[k];
        const p = seedSlot(i, k, isStore);
        s.position.set(p.x, p.y, p.z);
      }
      // Add the new seeds at their slots; flag for a spawn pop if animating.
      for (let k = sg.children.length; k < n; k++) {
        const s = makeSeed();
        const p = seedSlot(i, k, isStore);
        s.position.set(p.x, p.y, p.z);
        if (animate) { s.userData.spawn = 0; s.scale.setScalar(0.01); anim.active = true; }
        sg.add(s);
      }
    }
    if (animate) ensureRunning();
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
      // Draw the legal-move ring AFTER the opaque seeds so the affordance always
      // reads (depthWrite:false alone lets later opaque seeds occlude it) (B8).
      g.renderOrder = 5;
      group.add(g);
      glows.push(g);
    }
  }

  // ---- hover affordance (I4) -----------------------------------------------
  // board.js forwards the resolved cell (here a userData {pit} from the per-pit
  // collider) or -1 on a miss, already gated to the local player's turn. We only
  // light pits the local player could legally sow.
  function clearHover() {
    hoverPit = -1;
    hoverRing.visible = false;
  }
  function setHover(cell) {
    const pit = cell && typeof cell === "object" && Number.isInteger(cell.pit) ? cell.pit : -1;
    if (phase !== "play" || !mySide || turn !== mySide || !ctx.isLocalTurnAllowed()) {
      clearHover();
      return;
    }
    const pits = mySide === "host" ? HOST_PITS : GUEST_PITS;
    if (pit < 0 || !pits.includes(pit) || board[pit] === 0) {
      clearHover();
      return;
    }
    if (pit === hoverPit) return;
    hoverPit = pit;
    const p = pitPos[pit];
    hoverRing.position.set(p.x, TOP + 0.04, p.z);
    hoverRing.visible = true;
    ensureRunning(); // animate the seed lift / ring pulse
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

  // Trigger a brief golden pulse on the capturing side's store (I2). Purely
  // cosmetic — the logical seeds have already moved into the store.
  function startCapture(side) {
    anim.capture = 0.5;
    anim.captureSide = side;
    ensureRunning();
  }

  // Apply a fully-validated sow result for `side`, advance turn, repaint, and
  // fire onGameOver once at the end. Returns true.
  function commit(res, side) {
    board = res.board;
    if (res.captured > 0) startCapture(side);
    if (maybeEnd()) {
      renderSeeds(true);
      clearGlows();
      clearHover();
      refreshLamps();
      refreshLabel();
      ensureRunning(); // drive the win lamp heartbeat
      try { ctx.onGameOver({ winner, reason: "empty" }); } catch { /* */ }
      return true;
    }
    if (!res.freeTurn) turn = side === "host" ? "guest" : "host";
    renderSeeds(true);
    refreshLamps();
    refreshGlows();
    clearHover();
    refreshLabel();
    return true;
  }

  function performMove(pit, side) {
    const res = sow(board, pit, side);
    if (!res) return false;
    return commit(res, side);
  }

  // ---- per-frame visual pump (driven by board.js update(dt)) ----------------
  // Allocation-free. Returns early when nothing is animating so an idle board
  // costs almost nothing. EVERYTHING here is cosmetic and re-derivable, so it
  // never touches board/turn/phase and can be interrupted by a snapshot safely.
  function update(dt) {
    const myTurnLive = phase === "play" && mySide && turn === mySide;
    const winLive = phase === "over" && winner;
    // Cheap idle early-out: nothing to animate ⇒ skip the whole pump.
    if (!anim.active && anim.capture <= 0 && !myTurnLive && !winLive && !hoverRing.visible) return;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;
    let busy = anim.capture > 0 || myTurnLive || winLive || hoverRing.visible;

    anim.clock += dt;

    // 1) Seed spawn pops (scale 0.01 → 1 with a gentle overshoot, plus a tiny
    //    drop-settle on y). Driven off userData.spawn set in renderSeeds.
    let anySpawn = false;
    for (let i = 0; i < 14; i++) {
      const sg = seedGroups[i];
      const ch = sg.children;
      for (let k = 0; k < ch.length; k++) {
        const s = ch[k];
        if (s.userData.spawn == null) continue;
        anySpawn = true;
        s.userData.spawn = Math.min(1, s.userData.spawn + dt * 5.5);
        const t = s.userData.spawn;
        // easeOutBack-ish overshoot, settling to 1.
        const e = 1 + 2.0 * Math.pow(t - 1, 3) + 1.0 * Math.pow(t - 1, 2);
        s.scale.setScalar(Math.max(0.01, e));
        if (t >= 1) { s.scale.setScalar(1); s.userData.spawn = null; }
      }
    }
    if (anySpawn) busy = true;

    // 2) Local lamp: gentle bob + heartbeat when it is the local player's turn,
    //    so "it's on YOU" is unmistakable in first person. Opponent lamp steady.
    if (myTurnLive) {
      const lamp = mySide === "host" ? lampHost : lampGuest;
      const mat = mySide === "host" ? M.lampHost : M.lampGuest;
      const s = 0.5 + 0.5 * Math.sin(anim.clock * 4.0);
      lamp.position.y = LAMP_Y + 0.012 * s;
      mat.emissiveIntensity = 0.85 + 0.35 * s;
    } else if (phase === "play") {
      // Make sure a just-ended turn returns its lamp to the steady floor.
      lampHost.position.y = LAMP_Y;
      lampGuest.position.y = LAMP_Y;
      M.lampHost.emissiveIntensity = lampBase.host;
      M.lampGuest.emissiveIntensity = lampBase.guest;
    }

    // 3) Win heartbeat: pulse the winning side's lamp + store glow.
    if (winLive) {
      const s = 0.5 + 0.5 * Math.sin(anim.clock * 3.0);
      const lampMat = winner === "host" ? M.lampHost : M.lampGuest;
      const storeMat = winner === "host" ? M.storeHost : M.storeGuest;
      lampMat.emissiveIntensity = 0.6 + 0.6 * s;
      storeMat.emissiveIntensity = 0.35 + 0.4 * s;
    }

    // 4) Capture flourish: a golden pulse on the capturing store, decaying out.
    if (anim.capture > 0) {
      anim.capture = Math.max(0, anim.capture - dt);
      const f = anim.capture / 0.5;           // 1 → 0
      const pulse = Math.sin(f * Math.PI);    // up then down
      const storeMat = anim.captureSide === "host" ? M.storeHost : M.storeGuest;
      const base = (mySide === anim.captureSide) ? 0.28 : 0.0;
      storeMat.emissiveIntensity = base + 0.9 * pulse;
      if (anim.capture === 0) {
        // restore the resting store emissive (unless a win pulse owns it now).
        if (!(winLive && winner === anim.captureSide)) {
          storeMat.emissiveIntensity = (mySide === anim.captureSide) ? 0.28 : 0.0;
        }
        anim.captureSide = null;
      }
    }

    // 5) Hover ring gentle breathe (opacity + scale) so the clickable pit reads.
    if (hoverRing.visible && hoverPit >= 0) {
      const s = 0.5 + 0.5 * Math.sin(anim.clock * 6.0);
      M.hover.opacity = 0.7 + 0.25 * s;
      hoverRing.scale.setScalar(1 + 0.06 * s);
    }

    anim.active = anySpawn;
    return busy;
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
  function applyMove(move, byRole) {
    if (phase !== "play") throw new GameDesync("mancala: not in play");
    if (!move || move.type !== "move" || !Number.isInteger(move.pit)) return false;
    // Validate the relayed mover against whose turn it actually is (B2). Without
    // this, a guest could relay a move while it is host's turn and — if that
    // guest pit happened to be non-empty — the host would sow it out of turn.
    if ((byRole === "host" || byRole === "guest") && byRole !== turn)
      throw new GameDesync("mancala: out-of-turn move");
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
    // Cancel any in-flight cosmetic FX: this is an authoritative re-base, so the
    // capture/hover state from a now-superseded local view must not linger.
    anim.capture = 0;
    anim.captureSide = null;
    clearHover();
    M.storeHost.emissiveIntensity = mySide === "host" ? 0.28 : 0.0;
    M.storeGuest.emissiveIntensity = mySide === "guest" ? 0.28 : 0.0;
    renderSeeds(); // diff-rebuild, no spawn pop on an authoritative snapshot
    refreshLamps();
    refreshGlows();
    refreshLabel();
    // A win lamp/store heartbeat must keep ticking after a snapshot that lands the
    // game in "over"; an active board similarly drives the my-turn lamp pulse.
    if (phase === "over" || (phase === "play" && mySide && turn === mySide)) ensureRunning();
  }

  // ---- role / seat changes (in-place promotion) ----------------------------
  function setRole(r) {
    role = r || "spectator";
    mySide = role === "host" ? "host" : role === "guest" ? "guest" : null;
    clearHover();
    updateIdentity();
    refreshGlows();
  }
  function setSeatRy(ry) {
    seatRy = ry == null ? null : ry;
    clearHover();
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
  // Publish the authoritative starting position at construction (B1). Until the
  // host's first move resolves the server's cached pub/full are null, so a
  // spectator that mounts in that window gets pub:null, board.js._onState bails,
  // _hydrated stays false, and the first relayed move is DROPPED by the spectator
  // gate (the same class of bug connect4 fixes at connect4.js:994). Host-gated
  // inside pushSnapshot(); a no-op for guest/spectator instances.
  pushSnapshot();

  return {
    group,
    orientPolicy: "self",
    // mancala renders the relayed move INSTANTLY (no in-flight sow animation to
    // protect — the seed pops are re-derivable from board state and survive a
    // snapshot). Opting OUT of the spectator/guest redundant-echo suppression
    // means the host's post-move snapshot is NOT swallowed, so a guest/spectator
    // that ever mis-applied a relayed move gets its corrective echo immediately
    // instead of after a ~1.5s window (B3).
    spectatorAnimates: false,
    applyState,
    applyMove,
    onPointer,
    setHover,
    update,
    publicState,
    setRole,
    setSeatRy,
    dispose,
  };
}

export default createGame;
