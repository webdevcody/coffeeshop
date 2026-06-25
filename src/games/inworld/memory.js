// Memory Match — in-world 3D module (createGame contract). HIDDEN-INFO,
// HOST-AUTHORITATIVE. Candidate variation #2.
//
// DESIGN (distinct from the original): the secret shuffled deck lives ONLY in
// the host's private `deck` array. The host is the sole authority on flip/match
// resolution and on the host-owned mismatch "show" timer. The ONLY thing that
// crosses the wire is a masked snapshot in which every face-DOWN card carries
// `value: null` — the deck order is never serialised. Guests send {flip,i};
// host validates turn ownership, resolves, then re-broadcasts the masked state.
//
// IDENTITY / ORIENTATION (the part this candidate reworks): every per-side cue
// (home bar, turn lamp, score chip) is built RELATIVE TO THE LOCAL PLAYER, not
// to a fixed host=+Z layout. The local player's own side is placed on the NEAR
// (-Z) edge and the opponent's on the FAR (+Z) edge, in the CANONICAL frame.
// The framework then rotates the whole group by orientFor(seatRy) so -Z meets
// the seated viewer — so each client literally sees THEIR OWN side nearest them
// and the opponent across the table, with clearly distinct colours. Because the
// cues are positioned from `mySeat` (derived from role) and re-laid-out whenever
// the role changes, a relayed snapshot can NEVER flip the local side/colour.
//
// LEAK SAFETY: snapshot() nulls the value of any "down" card. Only that masked
// snapshot is ever handed to net.sendState(); the framework relays `pub`
// (== the same masked object) to spectators. Face-down values never leave host.

import { BOARD_SIZE, BOARD_HALF, PALETTE, meshOf, standard } from "./pieces.js";

const COLS = 6;
const ROWS = 4;
const PAIRS = (COLS * ROWS) / 2;
const FACES = ["☕", "🫘", "🥐", "🍰", "🍩", "🧁", "🍪", "🥛", "🍫", "🍵", "🧋", "🥧"];
const SHOW_MS = 1100; // how long a mismatched pair stays revealed before flipping back

// Two clearly DISTINCT side hues. Host (the first-to-move side) = warm gold;
// guest (second side) = cool blue. Derived from ROLE only — never from the wire.
const SIDE_HEX = { host: "#e0a23a", guest: "#4a85d6" };

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

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
  g.fillStyle = "#2a1c10";
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
  const amHost = () => role === "host";
  const amSpectator = () => role === "spectator";

  // --- canonical shared game state (lives identically on every client) -------
  // Host-private deck (null for guest/spectator). cards[i].state: down|up|matched.
  let deck = role === "host" ? shuffledDeck() : null;

  // SPECTATOR-ONLY REVEAL: the true card faces, published by the HOST over the
  // spectator-only reveal channel (server forwards it to WATCHERS, never to the
  // seated guest). null until received; only a spectator instance ever stores it,
  // so the seated guest can NEVER learn a face-down value (the game stays fair).
  let revealDeck = null;
  let cards = freshCards();
  let turn = "host"; // host (seat 0) always moves first
  let scores = { host: 0, guest: 0 };
  let phase = "play"; // play | over
  let winner = null;

  // --- host-only resolution bookkeeping --------------------------------------
  let pending = []; // indices flipped up this turn awaiting a pair
  let showUntil = 0; // host timer: mismatched pair stays up until this time
  let showIdx = null; // [a,b] of the mismatched pair to flip back

  let disposed = false;
  let synced = false; // first snapshot snaps to pose; later snapshots animate

  // Local side identity, from ROLE only. host = side A (gold, first), guest =
  // side B (blue), spectator = null (read-only, no input).
  let mySeat = role === "host" ? "host" : role === "guest" ? "guest" : null;

  function freshCards() {
    return Array.from({ length: COLS * ROWS }, () => ({ state: "down", value: null }));
  }

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    felt: keep(standard(THREE, "#6b4327", { roughness: 0.85 })),
    back: keep(standard(THREE, "#8a5526", { roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })),
    edge: keep(standard(THREE, "#4a2e1a", { roughness: 0.8, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })),
    matched: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.22, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })),
    // Per-side identity / turn materials. Own instances so emissive drives
    // independently. mineBar/oppBar are RE-ASSIGNED a hue on layout so the near
    // edge always carries the local player's own colour.
    mineBar: keep(standard(THREE, SIDE_HEX.host, { roughness: 0.5, emissive: SIDE_HEX.host, emissiveIntensity: 0 })),
    oppBar: keep(standard(THREE, SIDE_HEX.guest, { roughness: 0.5, emissive: SIDE_HEX.guest, emissiveIntensity: 0 })),
    mineLamp: keep(standard(THREE, SIDE_HEX.host, { roughness: 0.4, emissive: SIDE_HEX.host, emissiveIntensity: 0 })),
    oppLamp: keep(standard(THREE, SIDE_HEX.guest, { roughness: 0.4, emissive: SIDE_HEX.guest, emissiveIntensity: 0 })),
  };
  const faceTextures = [];
  const faceMats = [];

  function getFaceMat(value) {
    if (faceMats[value]) return faceMats[value];
    const tex = faceTexture(THREE, FACES[value % FACES.length]);
    faceTextures.push(tex);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    faceMats[value] = mat;
    return mat;
  }

  // ---------------------------------------------------------------------------
  // Board plank + card grid (canonical frame; framework rotates the group)
  // ---------------------------------------------------------------------------
  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plank = meshOf(THREE, keep(new THREE.BoxGeometry(outer, plankH, outer)), M.felt);
  plank.position.y = plankH / 2;
  group.add(plank);
  const TOP = plankH;

  const gw = BOARD_SIZE * 0.92;
  const cw = gw / COLS;
  const ch = (BOARD_SIZE * 0.62) / ROWS;
  const cardW = cw * 0.86;
  const cardH = ch * 0.86;
  const cardX = (i) => -gw / 2 + ((i % COLS) + 0.5) * cw;
  const cardZ = (i) => -BOARD_SIZE * 0.31 + (Math.floor(i / COLS) + 0.5) * ch;

  // Real card thickness so the two big faces never coincide; a hinge-style flip
  // about X is a true 3D rotation, not an in-place material swap.
  const CARD_T = 0.02;
  // BoxGeometry face order is [+X,-X,+Y,-Y,+Z,-Z]. At rest the +Y (index 2) face
  // points up and shows the BACK; after a half turn the -Y (index 3) printed
  // FACE points up. cardMaterials() builds the 6-slot array for either pose.
  const cardGeo = keep(new THREE.BoxGeometry(cardW, CARD_T, cardH));
  const hitGeo = keep(new THREE.BoxGeometry(cardW, 0.03, cardH));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));
  const CARD_Y = TOP + 0.004 + CARD_T / 2;

  const cardMeshes = [];
  // Per-card flip animation: rotation.x lerps toward target (0 back-up, PI
  // face-up); printed material swapped in at the edge-on midpoint.
  const anim = [];

  function cardMaterials(topMat, faceMat) {
    return [M.edge, M.edge, topMat, faceMat, M.edge, M.edge];
  }

  for (let i = 0; i < COLS * ROWS; i++) {
    const m = meshOf(THREE, cardGeo, cardMaterials(M.back, M.back));
    m.position.set(cardX(i), CARD_Y, cardZ(i));
    group.add(m);
    cardMeshes.push(m);
    anim.push({ faceUp: false, target: 0, mat: M.back });

    const box = new THREE.Mesh(hitGeo, invis);
    box.position.set(cardX(i), TOP + CARD_T + 0.03, cardZ(i));
    box.userData.cell = { i };
    group.add(box);
  }

  // ---------------------------------------------------------------------------
  // Player-identity / turn / score cues — built RELATIVE TO THE LOCAL PLAYER.
  //   mine* → NEAR (-Z) edge (the local player's own side after orientFor)
  //   opp*  → FAR  (+Z) edge (the opponent across the table)
  // Distinct hues, lit purely from local mySeat/turn/scores. The framework
  // rotates the group by orientFor(seatRy) so -Z faces the seated viewer.
  // ---------------------------------------------------------------------------
  const barGeo = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.7, 0.006, 0.018));
  const lampGeo = keep(new THREE.SphereGeometry(0.012, 16, 12));
  const chipGeo = keep(new THREE.PlaneGeometry(BOARD_SIZE * 0.34, BOARD_SIZE * 0.34 * 0.34));
  const homeEdge = BOARD_HALF + 0.03;

  function makeChip() {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 88;
    const tex = keep(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    const mesh = meshOf(THREE, chipGeo, mat, false);
    mesh.rotation.x = -Math.PI / 2;
    return { mesh, tex, cv };
  }

  // "mine" = near (-Z), "opp" = far (+Z). Chips drawn upright for their viewer:
  // the near chip reads normally; the far chip is rotated a half turn so it reads
  // upright from the opponent's seat.
  const mineSide = {
    bar: meshOf(THREE, barGeo, M.mineBar, false),
    lamp: meshOf(THREE, lampGeo, M.mineLamp, false),
    chip: makeChip(),
  };
  const oppSide = {
    bar: meshOf(THREE, barGeo, M.oppBar, false),
    lamp: meshOf(THREE, lampGeo, M.oppLamp, false),
    chip: makeChip(),
  };

  mineSide.bar.position.set(0, TOP + 0.004, -homeEdge);
  mineSide.lamp.position.set(BOARD_SIZE * 0.4, TOP + 0.012, -homeEdge);
  // Chips sit higher than the placard so the two transparent planes never share
  // a depth plane where their flat XZ footprints overlap (avoids z-fighting).
  mineSide.chip.mesh.position.set(-BOARD_SIZE * 0.18, TOP + 0.006, -homeEdge);
  group.add(mineSide.bar, mineSide.lamp, mineSide.chip.mesh);

  oppSide.bar.position.set(0, TOP + 0.004, homeEdge);
  oppSide.lamp.position.set(BOARD_SIZE * 0.4, TOP + 0.012, homeEdge);
  oppSide.chip.mesh.position.set(-BOARD_SIZE * 0.18, TOP + 0.006, homeEdge);
  oppSide.chip.mesh.rotation.z = Math.PI; // reads upright from the far seat
  group.add(oppSide.bar, oppSide.lamp, oppSide.chip.mesh);

  // Near-edge placard naming the local side, whose turn it is, and the score.
  const placardCv = document.createElement("canvas");
  placardCv.width = 320;
  placardCv.height = 72;
  const placardTex = keep(new THREE.CanvasTexture(placardCv));
  placardTex.colorSpace = THREE.SRGBColorSpace;
  const placardMat = keep(new THREE.MeshBasicMaterial({ map: placardTex, transparent: true }));
  const placardGeo = keep(new THREE.PlaneGeometry(BOARD_SIZE * 0.62, (BOARD_SIZE * 0.62 * 72) / 320));
  const placard = meshOf(THREE, placardGeo, placardMat, false);
  placard.rotation.x = -Math.PI / 2;
  placard.position.set(0, TOP + 0.002, -BOARD_HALF - 0.05);
  group.add(placard);

  // Assign the two side hues onto the mine/opp materials from the LOCAL role, so
  // the near edge is always the local player's own colour and the far edge the
  // opponent's. Re-run on setRole. Spectator: mine = host (the side nearest the
  // canonical near edge), opp = guest — a neutral read-only view.
  function layoutColours() {
    const near = mySeat === "guest" ? "guest" : "host"; // local side's hue at -Z
    const far = near === "host" ? "guest" : "host";
    M.mineBar.color.set(SIDE_HEX[near]);
    M.mineBar.emissive.set(SIDE_HEX[near]);
    M.mineLamp.color.set(SIDE_HEX[near]);
    M.mineLamp.emissive.set(SIDE_HEX[near]);
    M.oppBar.color.set(SIDE_HEX[far]);
    M.oppBar.emissive.set(SIDE_HEX[far]);
    M.oppLamp.color.set(SIDE_HEX[far]);
    M.oppLamp.emissive.set(SIDE_HEX[far]);
  }

  function drawChip(chip, seat, isMine) {
    const g = chip.cv.getContext("2d");
    g.clearRect(0, 0, 256, 88);
    g.fillStyle = "rgba(28,20,12,0.82)";
    const rr = 14;
    g.beginPath();
    g.moveTo(rr, 0);
    g.arcTo(256, 0, 256, 88, rr);
    g.arcTo(256, 88, 0, 88, rr);
    g.arcTo(0, 88, 0, 0, rr);
    g.arcTo(0, 0, 256, 0, rr);
    g.closePath();
    g.fill();
    g.font = "bold 30px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = SIDE_HEX[seat];
    const label = seat === "host" ? "HOST" : "GUEST";
    const suffix = isMine ? " (you)" : "";
    g.fillText(`${label}${suffix}: ${scores[seat] | 0}`, 128, 44);
    chip.tex.needsUpdate = true;
  }

  function refreshPlacard() {
    const g = placardCv.getContext("2d");
    g.clearRect(0, 0, 320, 72);
    let text;
    let color = "#f0e4cf";
    if (!mySeat) {
      const lead = scores.host === scores.guest ? "Tied" : scores.host > scores.guest ? "Host leads" : "Guest leads";
      text = phase === "over"
        ? (winner ? `${winner === "host" ? "Host" : "Guest"} wins` : "Draw")
        : `Spectating — ${turn === "host" ? "Host" : "Guest"} to move — ${lead}`;
    } else {
      const opp = mySeat === "host" ? "guest" : "host";
      const sideName = mySeat === "host" ? "Host" : "Guest";
      const status = phase === "over"
        ? (winner === mySeat ? "You win!" : winner ? "You lose" : "Draw")
        : (turn === mySeat ? "Your turn" : "Opponent's turn");
      text = `You are ${sideName} — ${status} — You ${scores[mySeat] | 0} : ${scores[opp] | 0} Opp`;
      color = SIDE_HEX[mySeat];
    }
    g.fillStyle = "rgba(28,20,12,0.85)";
    const rr = 14;
    g.beginPath();
    g.moveTo(rr, 0);
    g.arcTo(320, 0, 320, 72, rr);
    g.arcTo(320, 72, 0, 72, rr);
    g.arcTo(0, 72, 0, 0, rr);
    g.arcTo(0, 0, 320, 0, rr);
    g.closePath();
    g.fill();
    g.font = "bold 24px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, 160, 38);
    placardTex.needsUpdate = true;
  }

  // Drive every cue from LOCAL state only. mineSide is the local player's own
  // side (or, for a spectator, the host side at the near edge).
  function updateIdentityCues() {
    const nearSeat = mySeat === "guest" ? "guest" : "host";
    const farSeat = nearSeat === "host" ? "guest" : "host";

    const mineIsTurn = phase === "play" && turn === nearSeat;
    const oppIsTurn = phase === "play" && turn === farSeat;
    const iAmPlayer = !!mySeat;

    // Identity: the local player's own home bar glows steadily (spectator: dim).
    mineSide.bar.material.emissiveIntensity = iAmPlayer ? 0.55 : 0.2;
    oppSide.bar.material.emissiveIntensity = 0.0;
    // Whose-turn lamp: side-to-move glows; brighter when it's the local turn.
    mineSide.lamp.material.emissiveIntensity = mineIsTurn ? (iAmPlayer ? 1.0 : 0.5) : 0.0;
    oppSide.lamp.material.emissiveIntensity = oppIsTurn ? 0.5 : 0.0;

    drawChip(mineSide.chip, nearSeat, mySeat === nearSeat);
    drawChip(oppSide.chip, farSeat, mySeat === farSeat);
    refreshPlacard();
  }

  // ---------------------------------------------------------------------------
  // Flip animation — driven by the framework's update(dt) pump (no private RAF).
  // ---------------------------------------------------------------------------
  const FLIP_DUR = 0.32; // seconds for a ~180° flip

  function stepFlips(dt) {
    const speed = (Math.PI / FLIP_DUR) * dt;
    for (let i = 0; i < cardMeshes.length; i++) {
      const m = cardMeshes[i];
      const a = anim[i];
      const diff = a.target - m.rotation.x;
      if (Math.abs(diff) > 1e-4) {
        m.rotation.x = Math.abs(diff) <= speed ? a.target : m.rotation.x + Math.sign(diff) * speed;
      }
      // Swap the printed material once past the edge-on midpoint so the value
      // never bleeds through the back before the card has turned over.
      const past = m.rotation.x >= Math.PI / 2;
      const desired = a.faceUp
        ? (past ? cardMaterials(M.back, a.mat) : cardMaterials(M.back, M.back))
        : (past ? cardMaterials(a.mat, a.mat) : cardMaterials(a.mat, M.back));
      if (m.material[2] !== desired[2] || m.material[3] !== desired[3]) m.material = desired;
    }
  }

  // Translate logical card state into per-card animation targets.
  function renderCards() {
    for (let i = 0; i < cardMeshes.length; i++) {
      const c = cards[i];
      const a = anim[i];
      let faceUp;
      let mat;
      // SPECTATOR-ONLY REVEAL: with the true deck in hand, a spectator shows EVERY
      // card's real face (even face-down ones) so a watcher sees the full board.
      // A face-down card's value comes from revealDeck (the masked snapshot nulls
      // it). Matched/up cards keep their snapshot value. The seated guest never has
      // revealDeck, so this branch never fires for a player — only a watcher.
      const revealValue = amSpectator() && Array.isArray(revealDeck) ? revealDeck[i] : null;
      if (c.state === "matched") {
        faceUp = true;
        const v = c.value != null ? c.value : revealValue;
        mat = v != null ? getFaceMat(v) : M.matched;
      } else if (c.state === "up" && c.value != null) {
        faceUp = true;
        mat = getFaceMat(c.value);
      } else if (revealValue != null) {
        // Spectator viewing a face-down card whose true face we know.
        faceUp = true;
        mat = getFaceMat(revealValue);
      } else {
        faceUp = false;
        mat = M.back;
      }
      a.faceUp = faceUp;
      a.mat = mat;
      a.target = faceUp ? Math.PI : 0;
    }
  }

  // Snap cards to their resting pose (no animation) — used on a fresh sync so a
  // late joiner doesn't replay flips it never saw.
  function snapCards() {
    for (let i = 0; i < cardMeshes.length; i++) {
      const a = anim[i];
      cardMeshes[i].rotation.x = a.target;
      cardMeshes[i].material = a.faceUp
        ? cardMaterials(M.back, a.mat)
        : cardMaterials(a.mat, M.back);
    }
  }

  // ---------------------------------------------------------------------------
  // Host authority — flip, match resolution, mismatch timer, win check
  // ---------------------------------------------------------------------------
  function hostFlip(i) {
    if (!amHost()) return;
    if (phase !== "play") return;
    if (showIdx) return; // a mismatched pair is still being shown; ignore input
    if (pending.length >= 2) return;
    if (!Number.isInteger(i) || i < 0 || i >= cards.length) return;
    const c = cards[i];
    if (c.state !== "down") return;

    c.state = "up";
    c.value = deck[i];
    pending.push(i);

    if (pending.length === 2) {
      const [a, b] = pending;
      if (cards[a].value === cards[b].value) {
        cards[a].state = "matched";
        cards[b].state = "matched";
        scores[turn] += 1;
        pending = [];
        checkWin(); // matched → SAME player goes again (turn unchanged)
      } else {
        // Reveal both, then flip back + pass turn on the host-owned timer.
        showUntil = nowMs() + SHOW_MS;
        showIdx = [a, b];
      }
    }

    renderCards();
    updateIdentityCues();
    pushState();
  }

  function resolveMismatch() {
    if (!showIdx) return;
    for (const i of showIdx) {
      cards[i].state = "down";
      cards[i].value = null;
    }
    showIdx = null;
    showUntil = 0;
    pending = [];
    turn = turn === "host" ? "guest" : "host"; // mismatch → pass turn
    renderCards();
    updateIdentityCues();
    pushState();
  }

  function checkWin() {
    if (cards.every((c) => c.state === "matched")) {
      phase = "over";
      winner = scores.host === scores.guest ? null : scores.host > scores.guest ? "host" : "guest";
      try {
        ctx.onGameOver({ winner, reason: "all-matched" });
      } catch {
        /* ignore */
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Masked snapshot — the ONLY thing that crosses the wire
  // ---------------------------------------------------------------------------
  function snapshot() {
    return {
      cards: cards.map((c) => ({
        state: c.state,
        // mask: a face-DOWN card carries NO value (deck order never leaks).
        value: c.state === "down" ? null : c.value,
      })),
      turn,
      scores: { ...scores },
      phase,
      winner,
    };
  }
  function publicState() {
    return snapshot();
  }
  function pushState() {
    if (!amHost()) return;
    const s = snapshot();
    try {
      ctx.net.sendState(s, s); // full === pub (already masked) → safe for spectators
    } catch {
      /* ignore */
    }
  }

  // SPECTATOR-ONLY REVEAL: the host publishes the TRUE deck so watchers render the
  // real faces of every card. The server forwards it to spectators + ambient
  // passersby ONLY — NEVER to the seated guest — so the game stays fair. Only the
  // host knows the deck, so only the host ever calls this.
  function pushReveal() {
    if (!amHost() || !Array.isArray(deck)) return;
    try {
      ctx.net.sendReveal({ deck: deck.slice() });
    } catch {
      /* ignore */
    }
  }

  // SPECTATOR-ONLY REVEAL apply. A spectator instance stores the true deck and
  // re-renders so every card shows its real face. NO-OP for host (authoritative,
  // already knows the deck) and for the seated guest (must never learn faces).
  function applyReveal(reveals) {
    if (!amSpectator()) return; // only a watcher renders the true deck
    if (!reveals || typeof reveals !== "object") return;
    const d = reveals.deck;
    if (!Array.isArray(d)) return;
    revealDeck = d.map((v) => (Number.isInteger(v) ? v : null));
    renderCards();
    // Snap straight to the revealed pose so a late watcher doesn't replay flips it
    // never saw; subsequent moves still animate via renderCards on snapshots.
    snapCards();
    updateIdentityCues();
  }

  // ---------------------------------------------------------------------------
  // Contract surface
  // ---------------------------------------------------------------------------
  function onPointer(hit) {
    if (!mySeat) return; // spectator: read-only
    if (!ctx.isLocalTurnAllowed()) return;
    if (phase !== "play" || turn !== mySeat) return;
    if (showIdx) return; // a mismatched pair is being shown; block input
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.i)) return;
    if (cards[cell.i].state !== "down") return;

    if (amHost()) {
      hostFlip(cell.i);
    } else {
      try {
        ctx.net.sendMove({ type: "flip", i: cell.i });
      } catch {
        /* ignore */
      }
    }
  }

  // Host receives a guest {flip,i}. Guests/spectators never get raw moves
  // (they render from masked snapshots only). Returns true (handled) so the
  // framework never triggers a needless resync for an out-of-turn click.
  function applyMove(move, byRole) {
    if (!amHost()) return true;
    if (!move || move.type !== "flip" || !Number.isInteger(move.i)) return false;
    if (byRole !== "guest" || turn !== "guest") return true; // ignore out-of-turn
    if (showIdx || phase !== "play") return true;
    hostFlip(move.i);
    return true;
  }

  // Idempotent snapshot apply for guests/spectators. NEVER recomputes mySeat or
  // the local colour from the wire — only the shared game fields are read.
  function applyState(state) {
    if (!state) {
      // Authoritative reset.
      if (amHost()) deck = shuffledDeck();
      // SPECTATOR-ONLY: the deck reshuffled, so the previously revealed faces are
      // stale — drop them until the host re-sends the new deck below.
      revealDeck = null;
      cards = freshCards();
      turn = "host";
      scores = { host: 0, guest: 0 };
      phase = "play";
      winner = null;
      pending = [];
      showIdx = null;
      showUntil = 0;
      synced = amHost(); // host stays live; a guest reset re-snaps on next sync
      renderCards();
      snapCards();
      updateIdentityCues();
      if (amHost()) { pushState(); pushReveal(); }
      return;
    }
    if (amHost()) return; // host is authoritative; ignore its own echo

    const src = Array.isArray(state.cards) ? state.cards : [];
    cards = Array.from({ length: COLS * ROWS }, (_, i) => {
      const s = src[i] || {};
      const st = s.state === "up" || s.state === "matched" ? s.state : "down";
      return { state: st, value: st !== "down" && Number.isInteger(s.value) ? s.value : null };
    });
    turn = state.turn === "guest" ? "guest" : "host";
    scores = { host: state.scores?.host | 0, guest: state.scores?.guest | 0 };
    phase = state.phase === "over" ? "over" : "play";
    winner = state.winner === "host" || state.winner === "guest" ? state.winner : null;

    renderCards();
    updateIdentityCues();
    // First snapshot after (re)join = full sync → snap (don't replay unseen
    // flips). Later snapshots are real moves → animate.
    if (!synced) {
      synced = true;
      snapCards();
    }
  }

  // Per-frame pump: animate flips on every client; host also runs the mismatch
  // flip-back timer here (no private RAF, no setTimeout).
  function update(dt) {
    if (disposed) return;
    const step = typeof dt === "number" && dt > 0 ? Math.min(0.05, dt) : 0.016;
    stepFlips(step);
    if (amHost() && showIdx && nowMs() >= showUntil) resolveMismatch();
  }

  function setRole(r) {
    const wasHost = role === "host";
    role = r || "spectator";
    mySeat = role === "host" ? "host" : role === "guest" ? "guest" : null;
    // If we just became host without a deck (promotion), mint one so flips work.
    if (role === "host" && !deck) deck = shuffledDeck();
    // A fresh host must publish its deck on the spectator-only reveal channel so
    // watchers can render true faces.
    if (role === "host" && !wasHost) pushReveal();
    // No longer a spectator → discard any revealed deck (a player must not retain it).
    if (role !== "spectator") revealDeck = null;
    layoutColours();
    updateIdentityCues();
  }

  // Flat board: the framework rotates the whole group by orientFor(seatRy). The
  // local player's own cues already sit on the near (-Z) edge, so nothing to
  // orient internally — just re-render the placard for the (possibly new) seat.
  function setSeatRy() {
    refreshPlacard();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (group.parent) group.parent.remove(group);
    for (const t of faceTextures) t.dispose?.();
    for (const m of faceMats) m?.dispose?.();
    for (const o of owned) o.dispose?.();
  }

  // ---- initial paint --------------------------------------------------------
  layoutColours();
  renderCards();
  snapCards();
  updateIdentityCues();
  if (amHost()) { pushState(); pushReveal(); }

  return {
    group,
    applyState,
    applyMove,
    applyReveal, // SPECTATOR-ONLY: render the true card faces (no-op for host/guest)
    onPointer,
    publicState,
    update,
    setRole,
    setSeatRy,
    dispose,
  };
}

export default createGame;
