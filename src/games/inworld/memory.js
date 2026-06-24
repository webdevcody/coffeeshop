// Memory Match — in-world 3D module (createGame contract). HIDDEN-INFO,
// HOST-AUTHORITATIVE. Host owns the shuffled deck (the secret). The snapshot it
// pushes masks face-DOWN card values to null — the deck order never crosses the
// wire. Guest sends {flip,i}; host validates turn, resolves, and pushes the
// masked state. A mismatch shows both cards then flips back on a host-owned timer.
//
// LEAK SAFETY: face values exist ONLY in the host's private `deck`. snapshot()
// nulls the value of any card whose state is "down". Spectators/guests only ever
// receive that masked snapshot (server PUBLIC_RELAY[memory]=false blocks raw
// flips/full to spectators; only `pub` — the masked state — reaches them).

import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard } from "./pieces.js";

const COLS = 6;
const ROWS = 4;
const PAIRS = (COLS * ROWS) / 2;
const FACES = ["☕", "🫘", "🥐", "🍰", "🍩", "🧁", "🍪", "🥛", "🍫", "🍵", "🧋", "🥧"];
const SHOW_MS = 1100;

// Two clearly DISTINCT side hues. Host = the first-to-move side (warm gold),
// guest = the second side (cool blue). These drive the per-seat identity bars,
// turn lamps and score chips so the two players never read as the same colour.
// myColor is derived from ROLE only (host→A, guest→B), never from the wire.
const SIDE_HEX = { host: "#e0a23a", guest: "#4a85d6" };

function shuffledDeck() {
  const vals = [];
  for (let i = 0; i < PAIRS; i++) vals.push(i, i);
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vals[i], vals[j]] = [vals[j], vals[i]];
  }
  return vals;
}

function faceTexture(THREE, glyph) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  g.fillStyle = PALETTE.lightSq;
  g.fillRect(0, 0, 128, 128);
  g.font = "84px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(glyph || "?", 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "memory";

  let role = ctx.role;
  const isHost = role === "host";

  // Host-private deck (null for guest/spectator). cards[i].state: down|up|matched.
  let deck = isHost ? shuffledDeck() : null;
  let cards = Array.from({ length: COLS * ROWS }, () => ({ state: "down", value: null, by: null }));
  let turn = "host"; // host seat0 first
  let scores = { host: 0, guest: 0 };
  let phase = "play";
  let winner = null;
  let pending = []; // host: indices currently up this turn awaiting resolve
  let flipBackAt = 0; // host timer
  let flipBackIdx = null;
  let disposed = false;
  let synced = false; // first full-state snapshot snaps; later ones animate

  // Local side identity, derived from ROLE only (the canonical 2-player rule).
  // host = side A (gold, moves first), guest = side B (blue), spectator = null.
  // mySeat is the local player's turn key; myColor its display hue.
  let mySeat = role === "host" ? "host" : role === "guest" ? "guest" : null;
  let myColor = mySeat ? SIDE_HEX[mySeat] : null;

  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    felt: keep(standard(THREE, "#6b4327", { roughness: 0.85 })),
    // Per-side identity / turn materials (own instance each so emissive can be
    // driven independently). Distinct hues so the two sides never look alike.
    homeHost: keep(standard(THREE, SIDE_HEX.host, { roughness: 0.5, emissive: SIDE_HEX.host, emissiveIntensity: 0 })),
    homeGuest: keep(standard(THREE, SIDE_HEX.guest, { roughness: 0.5, emissive: SIDE_HEX.guest, emissiveIntensity: 0 })),
    lampHost: keep(standard(THREE, SIDE_HEX.host, { roughness: 0.4, emissive: SIDE_HEX.host, emissiveIntensity: 0 })),
    lampGuest: keep(standard(THREE, SIDE_HEX.guest, { roughness: 0.4, emissive: SIDE_HEX.guest, emissiveIntensity: 0 })),
    // Card rim/edge material — also carries a tiny polygonOffset so the proud
    // collider above can never z-fight against the card's coplanar top.
    edge: keep(standard(THREE, "#4a2e1a", { roughness: 0.8, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })),
    back: keep(standard(THREE, "#8a5526", { roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })),
    matched: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.2, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })),
  };
  const faceTextures = [];
  const faceMats = [];

  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plank = meshOf(THREE, keep(new THREE.BoxGeometry(outer, plankH, outer)), M.felt);
  plank.position.y = plankH / 2;
  group.add(plank);
  const TOP = plankH;

  const gw = BOARD_SIZE * 0.92;
  const cw = gw / COLS;
  const ch = (BOARD_SIZE * 0.62) / ROWS;
  const cardW = cw * 0.86, cardH = ch * 0.86;
  function cardX(i) { return -gw / 2 + ((i % COLS) + 0.5) * cw; }
  function cardZ(i) { return -BOARD_SIZE * 0.31 + (Math.floor(i / COLS) + 0.5) * ch; }

  // Cards have REAL thickness (a thin box, not a paper plane) so the two large
  // faces never coincide — that, plus a hinge pivot, makes the flip a true 3D
  // rotation rather than an in-place material swap.
  const CARD_T = 0.02;
  // Box face material order is [+X, -X, +Y, -Y, +Z, -Z]. The +Y face (index 2)
  // shows the card BACK when at rest; after a half turn the -Y face (index 3)
  // — the printed FACE — points up. Per-card material arrays are swapped in.
  const cardGeo = keep(new THREE.BoxGeometry(cardW, CARD_T, cardH));
  // Collider sits clearly ABOVE the (thin) card with an air gap — no overlap,
  // so the invisible hit box can't z-fight the card mesh.
  const hitGeo = keep(new THREE.BoxGeometry(cardW, 0.03, cardH));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));
  const cardMeshes = [];
  // Per-card live flip animation: { faceUp, target, mat } where rotation lerps
  // toward `target` (0 = back up, PI = face up) and the printed material is
  // swapped at the halfway point so it never shows through the back.
  const anim = [];

  // Card pivot sits so its underside rests just above the plank; the mesh
  // hangs CARD_T/2 below the pivot so rotating about X keeps it grounded.
  const CARD_Y = TOP + 0.004 + CARD_T / 2;

  function getFaceMat(value) {
    if (faceMats[value]) return faceMats[value];
    const tex = faceTexture(THREE, FACES[value % FACES.length]);
    faceTextures.push(tex);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    faceMats[value] = mat;
    return mat;
  }

  // Build the 6-slot material array for a card given the printed-face material
  // (the -Y slot) and the resting top material (the +Y slot).
  function cardMaterials(topMat, faceMat) {
    return [M.edge, M.edge, topMat, faceMat, M.edge, M.edge];
  }

  for (let i = 0; i < COLS * ROWS; i++) {
    const m = meshOf(THREE, cardGeo, cardMaterials(M.back, M.back));
    m.position.set(cardX(i), CARD_Y, cardZ(i));
    group.add(m);
    cardMeshes.push(m);
    anim.push({ faceUp: false, target: 0, mat: M.back });
    // Collider: thin slab floating above the card with a clean air gap.
    const box = new THREE.Mesh(hitGeo, invis);
    box.position.set(cardX(i), TOP + CARD_T + 0.03, cardZ(i));
    box.userData.cell = { i };
    group.add(box);
  }

  // -------------------------------------------------------------------------
  // PLAYER-IDENTITY / TURN / SCORE cues. Built ONCE in the canonical frame:
  // host home on the near +Z edge, guest home on the far -Z edge. The framework
  // rotates the whole group by orientFor(seatRy), so each seated player sees
  // their OWN home edge nearest them and the opponent's across the table. Every
  // cue's lit state is driven purely from local mySeat/turn/scores (never the
  // wire), so host and guest read consistent OPPOSITE identities.
  //   * Home bar  : a coloured tint bar on each home edge. The LOCAL player's
  //                 own bar glows steadily — an at-a-glance "this side is me".
  //   * Turn lamp : only the side-to-move's lamp glows (brighter when it's the
  //                 local player's turn) — unmistakable whose flip it is.
  //   * Score chip: a canvas placard per side showing that side's running score,
  //                 surfaced in 3D so you can read your score vs the opponent's.
  //   * Placard   : a near-edge label ("You are Host — Your turn — You 3 Opp 1")
  //                 the framework rotates to face the local viewer.
  const cue = {
    host: { bar: null, lamp: null, chipTex: null, chipCv: null },
    guest: { bar: null, lamp: null, chipTex: null, chipCv: null },
  };
  const barGeo = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.7, 0.006, 0.018));
  const lampGeo = keep(new THREE.SphereGeometry(0.012, 16, 12));
  const chipGeo = keep(new THREE.PlaneGeometry(BOARD_SIZE * 0.32, BOARD_SIZE * 0.32 * 0.34));
  const homeEdge = BOARD_HALF + 0.03;

  function makeScoreChip(seat) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 88;
    const tex = keep(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    const mesh = meshOf(THREE, chipGeo, mat, false);
    mesh.rotation.x = -Math.PI / 2;
    cue[seat].chipTex = tex;
    cue[seat].chipCv = cv;
    return mesh;
  }

  // host home = +Z (near in canonical frame), guest home = -Z (far).
  for (const s of [
    { seat: "host", z: homeEdge, barMat: M.homeHost, lampMat: M.lampHost },
    { seat: "guest", z: -homeEdge, barMat: M.homeGuest, lampMat: M.lampGuest },
  ]) {
    const bar = meshOf(THREE, barGeo, s.barMat, false);
    bar.position.set(0, TOP + 0.004, s.z);
    group.add(bar);
    cue[s.seat].bar = bar;

    const lamp = meshOf(THREE, lampGeo, s.lampMat, false);
    lamp.position.set(BOARD_SIZE * 0.4, TOP + 0.012, s.z);
    group.add(lamp);
    cue[s.seat].lamp = lamp;

    const chip = makeScoreChip(s.seat);
    // Chip sits just inside its home edge, facing up. Text drawn so it reads
    // upright from that side's seat (guest side flipped a half turn).
    chip.position.set(-BOARD_SIZE * 0.18, TOP + 0.004, s.z);
    if (s.seat === "guest") chip.rotation.z = Math.PI;
    group.add(chip);
  }

  // Draw one side's score chip. Tinted in that side's hue; "(you)" suffix marks
  // the local player's own chip. Driven from local scores/mySeat only.
  function drawScoreChip(seat) {
    const c = cue[seat];
    if (!c.chipCv) return;
    const g = c.chipCv.getContext("2d");
    g.clearRect(0, 0, 256, 88);
    g.fillStyle = "rgba(28,20,12,0.82)";
    const rr = 14;
    g.beginPath();
    g.moveTo(rr, 0); g.arcTo(256, 0, 256, 88, rr); g.arcTo(256, 88, 0, 88, rr);
    g.arcTo(0, 88, 0, 0, rr); g.arcTo(0, 0, 256, 0, rr); g.closePath(); g.fill();
    g.font = "bold 30px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = SIDE_HEX[seat];
    const label = seat === "host" ? "HOST" : "GUEST";
    const mine = mySeat === seat ? " (you)" : "";
    g.fillText(`${label}${mine}: ${scores[seat] | 0}`, 128, 44);
    c.chipTex.needsUpdate = true;
  }

  // Local-player placard on the near (-Z) edge. The framework rotates the group
  // by orientFor(seatRy) so -Z faces the seated viewer; host and guest each read
  // a placard naming THEIR OWN side, whose turn it is, and the live score — all
  // derived from local role/turn/scores, never recomputed from the wire.
  const placardCv = document.createElement("canvas");
  placardCv.width = 320; placardCv.height = 72;
  const placardTex = keep(new THREE.CanvasTexture(placardCv));
  placardTex.colorSpace = THREE.SRGBColorSpace;
  const placardMat = keep(new THREE.MeshBasicMaterial({ map: placardTex, transparent: true }));
  const placardGeo = keep(new THREE.PlaneGeometry(BOARD_SIZE * 0.62, BOARD_SIZE * 0.62 * 72 / 320));
  const placard = meshOf(THREE, placardGeo, placardMat, false);
  placard.rotation.x = -Math.PI / 2;
  placard.position.set(0, TOP + 0.004, -BOARD_HALF - 0.05);
  group.add(placard);

  function refreshPlacard() {
    const g = placardCv.getContext("2d");
    g.clearRect(0, 0, 320, 72);
    let text, color = "#f0e4cf";
    if (!mySeat) {
      text = "Spectating";
    } else {
      const opp = mySeat === "host" ? "guest" : "host";
      const sideName = mySeat === "host" ? "Host" : "Guest";
      const status = phase === "over"
        ? (winner === mySeat ? "You win!" : winner ? "You lose" : "Draw")
        : (turn === mySeat ? "Your turn" : "Opponent's turn");
      text = `You are ${sideName} — ${status} — You ${scores[mySeat] | 0} : ${scores[opp] | 0} Opp`;
      color = myColor || color;
    }
    g.fillStyle = "rgba(28,20,12,0.85)";
    const rr = 14;
    g.beginPath();
    g.moveTo(rr, 0); g.arcTo(320, 0, 320, 72, rr); g.arcTo(320, 72, 0, 72, rr);
    g.arcTo(0, 72, 0, 0, rr); g.arcTo(0, 0, 320, 0, rr); g.closePath(); g.fill();
    g.font = "bold 24px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, 160, 38);
    placardTex.needsUpdate = true;
  }

  // Drive every identity/turn/score cue from LOCAL state only. Called after any
  // state / role / seat change. Never reads colour or identity from the wire.
  function updateIdentityCues() {
    for (const seat of ["host", "guest"]) {
      const c = cue[seat];
      if (!c.bar || !c.lamp) continue;
      const isMine = mySeat === seat;
      const isTurn = phase === "play" && turn === seat;
      // Identity: the local player's own home bar glows steadily.
      c.bar.material.emissiveIntensity = isMine ? 0.55 : 0.0;
      // Whose-turn: side-to-move lamp glows, brighter when it's the local turn.
      c.lamp.material.emissiveIntensity = isTurn ? (isMine ? 1.0 : 0.4) : 0.0;
      drawScoreChip(seat);
    }
    refreshPlacard();
  }

  // --- flip animation loop (runs on every client; guests animate from snapshots) ---
  let rafId = 0;
  let lastT = 0;
  const FLIP_DUR = 0.32; // seconds for a full ~180° flip
  function animActive() {
    for (let i = 0; i < cardMeshes.length; i++) {
      if (Math.abs(cardMeshes[i].rotation.x - anim[i].target) > 1e-3) return true;
    }
    return false;
  }
  function startLoop() {
    if (rafId || disposed) return;
    lastT = nowMs();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
      lastT = t;
      stepFlips(dt);
      rafId = animActive() && !disposed ? requestAnimationFrame(tick) : 0;
    };
    rafId = requestAnimationFrame(tick);
  }
  function stepFlips(dt) {
    const speed = (Math.PI / FLIP_DUR) * dt; // radians this frame
    for (let i = 0; i < cardMeshes.length; i++) {
      const m = cardMeshes[i];
      const a = anim[i];
      const diff = a.target - m.rotation.x;
      m.rotation.x = Math.abs(diff) <= speed ? a.target : m.rotation.x + Math.sign(diff) * speed;
      // Swap the printed material at the edge-on midpoint (past 90°) so the
      // card value never bleeds through the back before it has turned over.
      const past = m.rotation.x >= Math.PI / 2;
      const desired = a.faceUp
        ? (past ? cardMaterials(M.back, a.mat) : cardMaterials(M.back, M.back))
        : (past ? cardMaterials(a.mat, a.mat) : cardMaterials(a.mat, M.back));
      if (m.material[2] !== desired[2] || m.material[3] !== desired[3]) m.material = desired;
    }
  }

  function renderCards() {
    let changed = false;
    for (let i = 0; i < cardMeshes.length; i++) {
      const c = cards[i];
      const a = anim[i];
      let faceUp, mat;
      if (c.state === "matched") {
        faceUp = true;
        mat = c.value != null ? getFaceMat(c.value) : M.matched;
      } else if (c.state === "up" && c.value != null) {
        faceUp = true;
        mat = getFaceMat(c.value);
      } else {
        faceUp = false;
        mat = M.back;
      }
      if (a.faceUp !== faceUp || a.mat !== mat) changed = true;
      a.faceUp = faceUp;
      a.mat = mat;
      a.target = faceUp ? Math.PI : 0;
    }
    if (changed) startLoop();
  }

  // Snap every card to its resting pose without animation (e.g. on applyState
  // sync) so a freshly-joined client doesn't replay flips it never saw.
  function snapCards() {
    for (let i = 0; i < cardMeshes.length; i++) {
      const a = anim[i];
      cardMeshes[i].rotation.x = a.target;
      cardMeshes[i].material = a.faceUp
        ? cardMaterials(M.back, a.mat)
        : cardMaterials(a.mat, M.back);
    }
  }

  // ---- host logic ----
  function hostFlip(i) {
    if (phase !== "play" || turn !== "guest" && turn !== "host") return;
    if (pending.length >= 2) return;
    const c = cards[i];
    if (c.state !== "down") return;
    c.state = "up";
    c.value = deck[i];
    pending.push(i);
    if (pending.length === 2) {
      const [a, b] = pending;
      if (cards[a].value === cards[b].value) {
        cards[a].state = cards[b].state = "matched";
        scores[turn]++;
        pending = [];
        checkWin();
        // matched → same player goes again (turn unchanged)
      } else {
        // schedule flip-back
        flipBackAt = nowMs() + SHOW_MS;
        flipBackIdx = [a, b];
      }
    }
    renderCards();
    updateIdentityCues();
    pushState();
  }

  function resolveFlipBack() {
    if (!flipBackIdx) return;
    for (const i of flipBackIdx) {
      cards[i].state = "down";
      cards[i].value = null;
    }
    flipBackIdx = null;
    flipBackAt = 0;
    pending = [];
    turn = turn === "host" ? "guest" : "host";
    renderCards();
    updateIdentityCues();
    pushState();
  }

  function checkWin() {
    if (cards.every((c) => c.state === "matched")) {
      phase = "over";
      winner = scores.host === scores.guest ? null : scores.host > scores.guest ? "host" : "guest";
      try { ctx.onGameOver({ winner, reason: "all-matched" }); } catch { /* */ }
    }
  }

  // ---- masked snapshot (the ONLY thing that crosses the wire) ----
  function snapshot() {
    return {
      cards: cards.map((c) => ({
        state: c.state,
        // mask: face-down cards carry NO value.
        value: c.state === "down" ? null : c.value,
      })),
      turn, scores: { ...scores }, phase, winner,
    };
  }
  function publicState() { return snapshot(); }
  function pushState() {
    if (role !== "host") return;
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  // ---- contract ----
  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed()) return;
    if (phase !== "play" || turn !== mySeat) return;
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.i)) return;
    if (cards[cell.i].state !== "down") return;
    if (role === "host") {
      hostFlip(cell.i);
    } else {
      try { ctx.net.sendMove({ type: "flip", i: cell.i }); } catch { /* */ }
    }
  }

  // applyMove: host receives a guest {flip,i}; guest/spectator never get raw moves.
  function applyMove(move, byRole) {
    if (role !== "host") return true; // guests render from snapshots only
    if (!move || move.type !== "flip" || !Number.isInteger(move.i)) return false;
    if (byRole !== "guest" || turn !== "guest") return true; // ignore out-of-turn
    hostFlip(move.i);
    return true;
  }

  function applyState(state) {
    if (!state) {
      if (isHost) deck = shuffledDeck();
      cards = Array.from({ length: COLS * ROWS }, () => ({ state: "down", value: null }));
      turn = "host";
      scores = { host: 0, guest: 0 };
      phase = "play";
      winner = null;
      pending = [];
      flipBackIdx = null;
      synced = isHost; // host stays live; a guest reset re-snaps on next sync
      renderCards();
      updateIdentityCues();
      snapCards(); // fresh board: all cards rest face-down, nothing to animate
      if (isHost) pushState();
      return;
    }
    if (role === "host") return; // host is authoritative; ignore echo
    const src = Array.isArray(state.cards) ? state.cards : [];
    cards = Array.from({ length: COLS * ROWS }, (_, i) => {
      const s = src[i] || {};
      return {
        state: s.state === "up" || s.state === "matched" ? s.state : "down",
        value: Number.isInteger(s.value) ? s.value : null,
      };
    });
    turn = state.turn === "guest" ? "guest" : "host";
    scores = { host: state.scores?.host | 0, guest: state.scores?.guest | 0 };
    phase = state.phase === "over" ? "over" : "play";
    winner = state.winner === "host" || state.winner === "guest" ? state.winner : null;
    renderCards();
    // Refresh turn/score cues from the synced shared state. NOTE: this updates
    // only turn/scores/phase — mySeat/myColor are NOT recomputed here, so a
    // relayed snapshot can never flip the local player to the wrong side.
    updateIdentityCues();
    // First snapshot after (re)join = full sync: snap to resting pose so we don't
    // replay flips we never saw. Subsequent snapshots are real moves → animate.
    if (!synced) { synced = true; snapCards(); }
  }

  // host-owned flip-back timer
  function update() {
    if (role !== "host" || !flipBackIdx) return;
    if (nowMs() >= flipBackAt) resolveFlipBack();
  }

  function setRole(r) {
    role = r || "spectator";
    // Re-derive local side identity from the NEW role (the one authoritative
    // place this changes — never from a relayed snapshot). Spectator → null.
    mySeat = role === "host" ? "host" : role === "guest" ? "guest" : null;
    myColor = mySeat ? SIDE_HEX[mySeat] : null;
    updateIdentityCues();
  }
  // Flat board: the framework rotates the whole group by orientFor(seatRy) so
  // the local player's own home edge faces them. Nothing to orient internally,
  // but refresh the placard so it re-renders for the (possibly) new seat.
  function setSeatRy() { refreshPlacard(); }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (group.parent) group.parent.remove(group);
    for (const t of faceTextures) t.dispose?.();
    for (const m of faceMats) m?.dispose?.();
    for (const o of owned) o.dispose?.();
  }

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  renderCards();
  updateIdentityCues();
  if (isHost) pushState();
  return { group, applyState, applyMove, onPointer, publicState, setRole, setSeatRy, update, dispose };
}

export default createGame;
