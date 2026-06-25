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
// Mismatched pair stays revealed before flipping back. Lengthened modestly from
// 1100 → 1350 so the GUEST's reveal window survives relay latency: the host arms
// the timer only AFTER pushing the "both up" snapshot, so on a slow link the guest
// still gets a comfortable look before the host pushes the flip-back. Purely a
// timing tweak — no protocol change, no rule change. (audit B3)
const SHOW_MS = 1350;

// --- visual-polish constants (all local/cosmetic; no rule or sync impact) -----
const MATCH_GLOW = 0.26; // steady accent emissive on a matched-pair face
const POP_DUR = 0.28; // seconds for the match "pop" scale flourish
const POP_SCALE = 0.12; // extra scale at the peak of the pop (1 → 1.12 → 1)
const HOVER_LIFT = 0.006; // metres a hovered face-down card rises for the local player
const HOVER_DUR = 0.12; // seconds for the hover lift to ease in/out

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
    // Card back lightened #8a5526 → #a8703a and given a faint warm emissive so the
    // grid of face-down cards reads clearly against the close-brown felt from both
    // seats (audit I7). The darker edge mat frames each card for extra separation.
    back: keep(standard(THREE, "#a8703a", { roughness: 0.55, emissive: "#3a2410", emissiveIntensity: 0.18, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })),
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
  // Parallel cache of "matched" face materials: the same printed glyph, but with
  // a steady accent emissive so a matched pair visibly GLOWS for every viewer
  // (host / guest / spectator). Built lazily alongside faceMats and reusing the
  // very same canvas texture, so no extra per-frame allocation. The popup/win
  // flourishes (I1/I8) ramp these materials' emissiveIntensity transiently.
  const matchedFaceMats = [];
  // Mismatch face materials: the same glyph with a faint red emissive, shown on
  // the two revealed-but-unequal cards just before they flip back, as a gentle
  // "no" cue. Both host and guest see two "up" cards with values in the snapshot,
  // so this reads identically for every role with no protocol change. (audit I2)
  const missFaceMats = [];
  // Demoted face materials for the SPECTATOR's reveal of still-face-down cards:
  // same glyph, but darkened/desaturated (low color multiplier) so a watcher can
  // tell "known but not yet played" from cards actually up/matched. (audit B1)
  const demotedFaceMats = [];

  function getFaceMat(value) {
    if (faceMats[value]) return faceMats[value];
    const tex = faceTexture(THREE, FACES[value % FACES.length]);
    faceTextures.push(tex);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    faceMats[value] = mat;
    return mat;
  }

  function getMatchedFaceMat(value) {
    if (matchedFaceMats[value]) return matchedFaceMats[value];
    // Reuse the same glyph texture the plain face mat already built/owns.
    getFaceMat(value);
    const base = faceMats[value];
    const mat = new THREE.MeshStandardMaterial({
      map: base.map,
      roughness: 0.5,
      emissive: new THREE.Color(PALETTE.accent),
      emissiveIntensity: MATCH_GLOW,
    });
    matchedFaceMats[value] = mat;
    return mat;
  }

  function getMissFaceMat(value) {
    if (missFaceMats[value]) return missFaceMats[value];
    getFaceMat(value);
    const base = faceMats[value];
    const mat = new THREE.MeshStandardMaterial({
      map: base.map,
      roughness: 0.6,
      emissive: new THREE.Color("#a83a2a"),
      emissiveIntensity: 0.28,
    });
    missFaceMats[value] = mat;
    return mat;
  }

  function getDemotedFaceMat(value) {
    if (demotedFaceMats[value]) return demotedFaceMats[value];
    getFaceMat(value);
    const base = faceMats[value];
    const mat = new THREE.MeshStandardMaterial({
      map: base.map,
      roughness: 0.75,
      color: new THREE.Color(0.55, 0.55, 0.55), // darken so it reads as "not in play"
    });
    demotedFaceMats[value] = mat;
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

  // Per-card resting base position (cached so update() lifts/settles without any
  // per-frame allocation — we just add hoverT*HOVER_LIFT to baseY).
  const baseY = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const m = meshOf(THREE, cardGeo, cardMaterials(M.back, M.back));
    m.position.set(cardX(i), CARD_Y, cardZ(i));
    group.add(m);
    cardMeshes.push(m);
    baseY.push(CARD_Y);
    // flipT/flipFrom drive an ease-in-out flip; popT a match pop; hoverT a
    // local-only hover lift. prevState tracks the last logical state so we can
    // detect a NEW match transition and fire the pop once.
    anim.push({ faceUp: false, target: 0, mat: M.back, flipT: 1, flipFrom: 0, popT: 0, hoverT: 0, prevState: "down" });

    const box = new THREE.Mesh(hitGeo, invis);
    box.position.set(cardX(i), TOP + CARD_T + 0.03, cardZ(i));
    box.userData.cell = { i };
    group.add(box);
  }
  let hoverIdx = -1; // local-only: index of the card currently hovered (or -1)

  // ---------------------------------------------------------------------------
  // Player-identity / turn / score cues — built RELATIVE TO THE LOCAL PLAYER.
  //   mine* → NEAR (-Z) edge (the local player's own side after orientFor)
  //   opp*  → FAR  (+Z) edge (the opponent across the table)
  // Distinct hues, lit purely from local mySeat/turn/scores. The framework
  // rotates the group by orientFor(seatRy) so -Z faces the seated viewer.
  // ---------------------------------------------------------------------------
  const barGeo = keep(new THREE.BoxGeometry(BOARD_SIZE * 0.7, 0.006, 0.018));
  const lampGeo = keep(new THREE.SphereGeometry(0.012, 16, 12));
  // Aspect matches the 288×88 chip canvas (88/288 ≈ 0.3056) so the text isn't
  // squashed horizontally. (audit B6)
  const chipGeo = keep(new THREE.PlaneGeometry(BOARD_SIZE * 0.34, BOARD_SIZE * 0.34 * (88 / 288)));
  const homeEdge = BOARD_HALF + 0.03;

  function makeChip() {
    const cv = document.createElement("canvas");
    // Widened 256 → 288 so the longest label ("GUEST (you): 12") no longer
    // clips at the rounded corners; geometry aspect updated to match. (audit B6)
    cv.width = 288;
    cv.height = 88;
    const tex = keep(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    // depthWrite:false + renderOrder so the chip composites cleanly over the felt
    // (no grazing-angle z-fighting from the seated camera). (audit I6)
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    const mesh = meshOf(THREE, chipGeo, mat, false);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
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
  // depthWrite:false + a positive renderOrder so this transparent plane always
  // composites cleanly OVER the felt instead of z-fighting it from the seated
  // low camera; also lifted from TOP+0.002 → TOP+0.008 so it isn't the lowest
  // near-coplanar plane on the table. (audit I6)
  const placardMat = keep(new THREE.MeshBasicMaterial({ map: placardTex, transparent: true, depthWrite: false }));
  const placardGeo = keep(new THREE.PlaneGeometry(BOARD_SIZE * 0.62, (BOARD_SIZE * 0.62 * 72) / 320));
  const placard = meshOf(THREE, placardGeo, placardMat, false);
  placard.rotation.x = -Math.PI / 2;
  placard.position.set(0, TOP + 0.008, -BOARD_HALF - 0.05);
  placard.renderOrder = 2;
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

  function drawChip(chip, seat, isMine, isTurn) {
    const W = 288;
    const H = 88;
    const g = chip.cv.getContext("2d");
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(28,20,12,0.82)";
    const rr = 14;
    g.beginPath();
    g.moveTo(rr, 0);
    g.arcTo(W, 0, W, H, rr);
    g.arcTo(W, H, 0, H, rr);
    g.arcTo(0, H, 0, 0, rr);
    g.arcTo(0, 0, W, 0, rr);
    g.closePath();
    g.fill();
    // A faint accent ring round the side that is to move, so whose-turn reads
    // from the chip too (reinforces the lamp/bar). Local/cosmetic. (audit I5)
    if (isTurn) {
      g.lineWidth = 4;
      g.strokeStyle = PALETTE.accent;
      g.stroke();
    }
    g.font = "bold 28px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = SIDE_HEX[seat];
    const label = seat === "host" ? "HOST" : "GUEST";
    const suffix = isMine ? " (you)" : "";
    g.fillText(`${label}${suffix}: ${scores[seat] | 0}`, W / 2, 44);
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

  // Whose-turn pulse state, read by update(dt). When it's the LOCAL player's
  // turn, the near home bar gently pulses so "your turn" is unmistakable from the
  // seated camera without hunting for the tiny lamp. (audit I5)
  let mineBarBase = 0.2; // resting emissive for the near bar
  let pulseMine = false; // pulse the near bar (it's my turn)
  let winFlourishT = 0; // one-shot game-over flourish progress (0 → 1)

  // Drive every cue from LOCAL state only. mineSide is the local player's own
  // side (or, for a spectator, the host side at the near edge).
  function updateIdentityCues() {
    const nearSeat = mySeat === "guest" ? "guest" : "host";
    const farSeat = nearSeat === "host" ? "guest" : "host";

    const mineIsTurn = phase === "play" && turn === nearSeat;
    const oppIsTurn = phase === "play" && turn === farSeat;
    const iAmPlayer = !!mySeat;

    // Identity: the local player's own home bar glows steadily (spectator: dim).
    mineBarBase = iAmPlayer ? 0.55 : 0.2;
    mineSide.bar.material.emissiveIntensity = mineBarBase;
    oppSide.bar.material.emissiveIntensity = 0.0;
    // Whose-turn lamp: side-to-move glows; brighter when it's the local turn.
    mineSide.lamp.material.emissiveIntensity = mineIsTurn ? (iAmPlayer ? 1.0 : 0.5) : 0.0;
    oppSide.lamp.material.emissiveIntensity = oppIsTurn ? 0.5 : 0.0;
    // Pulse the near bar only when it's the seated player's own turn.
    pulseMine = iAmPlayer && mineIsTurn;

    drawChip(mineSide.chip, nearSeat, mySeat === nearSeat, mineIsTurn);
    drawChip(oppSide.chip, farSeat, mySeat === farSeat, oppIsTurn);
    refreshPlacard();
  }

  // ---------------------------------------------------------------------------
  // Flip animation — driven by the framework's update(dt) pump (no private RAF).
  // ---------------------------------------------------------------------------
  const FLIP_DUR = 0.32; // seconds for a ~180° flip

  // Smooth ease-in-out (smoothstep) so the hinge flip accelerates and settles
  // instead of turning at a constant, mechanical angular speed. (audit I3)
  const easeInOut = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));

  function stepFlips(dt) {
    const inc = dt / FLIP_DUR;
    for (let i = 0; i < cardMeshes.length; i++) {
      const m = cardMeshes[i];
      const a = anim[i];
      if (a.flipT < 1) {
        a.flipT = Math.min(1, a.flipT + inc);
        // Interpolate the rotation along an ease-in-out curve from where the flip
        // began toward its current target (handles a target change mid-flip).
        m.rotation.x = a.flipFrom + (a.target - a.flipFrom) * easeInOut(a.flipT);
      } else if (m.rotation.x !== a.target) {
        m.rotation.x = a.target;
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

  let prevPhase = "play"; // detect the play→over transition for the win flourish

  // Translate logical card state into per-card animation targets.
  function renderCards() {
    // One-shot game-over flourish: when the board first transitions to "over",
    // arm a staggered glow pulse across the matched cards. Every client receives
    // phase/winner in the snapshot, so this is consistent for all roles. (audit I8)
    if (phase === "over" && prevPhase !== "over") winFlourishT = 1;
    prevPhase = phase;

    // Detect a revealed-but-unequal pair (two "up" cards with differing values)
    // so we can tint them red just before they flip back. Derived purely from the
    // snapshot, so host/guest/spectator agree without any extra wire data. (audit I2)
    let upA = -1;
    let upB = -1;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].state === "up" && cards[i].value != null) {
        if (upA === -1) upA = i;
        else if (upB === -1) upB = i;
      }
    }
    const mismatchPair = upB !== -1 && cards[upA].value !== cards[upB].value;

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
        // Matched cards GLOW (accent emissive) for EVERY viewer — host, guest, and
        // spectator — so a captured pair is visibly distinct from a momentarily
        // flipped pair. (audit B1/B2)
        mat = v != null ? getMatchedFaceMat(v) : M.matched;
      } else if (c.state === "up" && c.value != null) {
        faceUp = true;
        // The two revealed-but-unequal cards get a faint red "no" tint just before
        // they flip back; a matching/lone up card stays neutral. (audit I2)
        mat = mismatchPair && (i === upA || i === upB) ? getMissFaceMat(c.value) : getFaceMat(c.value);
      } else if (revealValue != null) {
        // Spectator viewing a still-face-down card whose true face we know: show
        // the glyph on a DARKENED/demoted material so a watcher can tell it apart
        // from cards actually up or matched (no false "already solved" read). The
        // seated guest never has revealDeck, so this only ever affects watchers.
        // (audit B1)
        faceUp = true;
        mat = getDemotedFaceMat(revealValue);
      } else {
        faceUp = false;
        mat = M.back;
      }
      const target = faceUp ? Math.PI : 0;
      // If the logical target changed, begin a fresh eased flip from the current
      // rotation. (audit I3)
      if (Math.abs(target - a.target) > 1e-4) {
        a.flipFrom = cardMeshes[i].rotation.x;
        a.flipT = 0;
      }
      a.faceUp = faceUp;
      a.mat = mat;
      a.target = target;
      // Fire the match "pop" once, when a card NEWLY becomes matched. Everyone
      // receives the `matched` state, so the flourish is consistent across roles.
      // (audit I1)
      if (c.state === "matched" && a.prevState !== "matched") a.popT = POP_DUR;
      a.prevState = c.state;
    }
  }

  // Snap cards to their resting pose (no animation) — used on a fresh sync so a
  // late joiner doesn't replay flips it never saw.
  function snapCards() {
    for (let i = 0; i < cardMeshes.length; i++) {
      const a = anim[i];
      a.flipT = 1; // already at rest; nothing to ease
      a.popT = 0; // no flourish replay on a cold sync
      cardMeshes[i].rotation.x = a.target;
      cardMeshes[i].position.y = baseY[i]; // clear any leftover hover lift
      cardMeshes[i].scale.setScalar(1);
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

  // Local-only hover affordance (audit I4). board.js routes a resolved {i} cell
  // (or -1) here, throttled and ALREADY gated by _turnAllowed, so this only ever
  // fires for the side whose turn it is. We simply remember which face-down,
  // clickable card to lift; update() eases it. Zero sync impact (cosmetic).
  function setHover(cell) {
    let next = -1;
    if (phase === "play" && mySeat && turn === mySeat && !showIdx && cell && cell !== -1 && Number.isInteger(cell.i)) {
      const i = cell.i;
      if (i >= 0 && i < cards.length && cards[i].state === "down") next = i;
    }
    hoverIdx = next;
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
      hoverIdx = -1; // clear stale hover on a fresh game
      winFlourishT = 0; // clear any in-flight game-over flourish
      prevPhase = "play"; // so a later play→over transition re-arms cleanly
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
  // Wall-clock accumulator for the gentle, frame-rate-independent sin pulses
  // (bar "your turn" pulse, win flourish). No per-frame allocation.
  let clock = 0;

  // Drive the local-only cosmetic flourishes: match pop, hover lift, bar pulse,
  // game-over glow. All read/write reused materials & transforms — no allocation.
  function animateExtras(step) {
    clock += step;
    for (let i = 0; i < cardMeshes.length; i++) {
      const a = anim[i];
      const m = cardMeshes[i];

      // Hover lift (local player only): ease the target card up, settle others.
      const wantLift = i === hoverIdx ? 1 : 0;
      if (a.hoverT !== wantLift) {
        const dh = step / HOVER_DUR;
        a.hoverT = wantLift > a.hoverT ? Math.min(1, a.hoverT + dh) : Math.max(0, a.hoverT - dh);
      }

      // Match pop: a brief ease-out 1 → 1+POP_SCALE → 1 scale on the matched card.
      let scale = 1;
      if (a.popT > 0) {
        a.popT = Math.max(0, a.popT - step);
        const p = 1 - a.popT / POP_DUR; // 0 → 1
        scale = 1 + POP_SCALE * Math.sin(p * Math.PI); // smooth up-and-back
      }

      const lift = easeInOut(a.hoverT) * HOVER_LIFT;
      if (m.position.y !== baseY[i] + lift) m.position.y = baseY[i] + lift;
      if (m.scale.x !== scale) m.scale.setScalar(scale);
    }

    // "Your turn" bar pulse for the seated player. (audit I5)
    if (pulseMine) {
      const pulse = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(clock * 4.0));
      mineSide.bar.material.emissiveIntensity = pulse;
    } else {
      mineSide.bar.material.emissiveIntensity = mineBarBase;
    }

    // One-shot game-over glow ramp on the matched (accent) face materials. We ramp
    // a shared multiplier across all matchedFaceMats so winning cards shimmer once
    // then settle back to the steady MATCH_GLOW. (audit I8)
    if (winFlourishT > 0) {
      winFlourishT = Math.max(0, winFlourishT - step * 0.6);
      const boost = MATCH_GLOW + 0.45 * Math.sin((1 - winFlourishT) * Math.PI) * winFlourishT;
      for (let v = 0; v < matchedFaceMats.length; v++) {
        const mm = matchedFaceMats[v];
        if (mm) mm.emissiveIntensity = boost;
      }
    }
  }

  function update(dt) {
    if (disposed) return;
    const step = typeof dt === "number" && dt > 0 ? Math.min(0.05, dt) : 0.016;
    stepFlips(step);
    animateExtras(step);
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
    hoverIdx = -1; // role changed → drop any stale hover affordance
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
    // The matched/miss face mats reuse faceMats' textures (already disposed above),
    // so only the extra material instances need releasing here.
    for (const m of matchedFaceMats) m?.dispose?.();
    for (const m of missFaceMats) m?.dispose?.();
    for (const m of demotedFaceMats) m?.dispose?.();
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
    // Snapshot-driven for onlookers: applyMove is a no-op for spectators/ambient
    // (they render PURELY from masked snapshots). The host commits via sendMove
    // THEN re-broadcasts state, so board.js must NOT arm its post-move skip window
    // and swallow the following authoritative snapshot. See InWorldBoard._onMove
    // (BUG 1), mirroring ludo.js / pong.js / tron.js.
    spectatorAnimates: false,
    applyState,
    applyMove,
    applyReveal, // SPECTATOR-ONLY: render the true card faces (no-op for host/guest)
    onPointer,
    setHover, // local-only hover lift for the side whose turn it is (audit I4)
    publicState,
    update,
    setRole,
    setSeatRy,
    dispose,
  };
}

export default createGame;
