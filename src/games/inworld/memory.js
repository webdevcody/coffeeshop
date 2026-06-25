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
// Pop scales the card on its Y (thickness) axis ONLY so a popped card never grows
// into a horizontally-adjacent neighbour (card pitch ~0.107 vs cardW ~0.092 leaves
// little XZ clearance). A thicker "swell" reads as a pop without any inter-card
// overlap. Modestly larger than the old planar 0.12 since Y growth is collision-free. (audit #7)
const POP_SCALE = 0.55; // extra Y scale at the peak of the pop (1 → 1.55 → 1)
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

  // JUST-FLIPPED ACCENT HALO (audit #9). A flat accent ring under a card pulses
  // once when that card NEWLY becomes "up", so a spectator/guest can follow a fast
  // opponent's last move. One reused ring mesh per cell (built once), driven by a
  // per-card haloT in animateExtras. Derived from a card's down→up transition in
  // renderCards, so it's consistent for every role with no wire change.
  // Outer radius kept under the cell half-pitch so two cards flipping up in the
  // same turn don't overlap (and z-fight) their halo rings. (audit P2)
  const haloGeo = keep(new THREE.RingGeometry(cardW * 0.42, cardW * 0.52, 24));
  const haloMeshes = [];
  const haloMats = []; // one material per cell so opacities pulse independently

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
    // local-only hover lift; haloT the just-flipped ring pulse; wobbleT the
    // mismatch flip-back wobble. prevState tracks the last logical state so we can
    // detect NEW match / NEW up transitions and fire the one-shot flourishes.
    // `lastFace` remembers the printed face material so a card flipping back DOWN
    // keeps showing its glyph through the first (still-face-up) half of the hinge
    // turn instead of snapping to the back the instant the flip-back begins.
    anim.push({ faceUp: false, target: 0, mat: M.back, lastFace: M.back, flipT: 1, flipFrom: 0, popT: 0, hoverT: 0, haloT: 0, wobbleT: 0, prevState: "down" });

    const hmat = new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0, depthWrite: false });
    haloMats.push(hmat);
    const halo = new THREE.Mesh(haloGeo, hmat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(cardX(i), TOP + 0.0025, cardZ(i));
    halo.renderOrder = 1;
    halo.visible = false;
    group.add(halo);
    haloMeshes.push(halo);

    const box = new THREE.Mesh(hitGeo, invis);
    box.position.set(cardX(i), TOP + CARD_T + 0.03, cardZ(i));
    box.userData.cell = { i };
    group.add(box);
  }
  let hoverIdx = -1; // local-only: index of the card currently hovered (or -1)

  // ---------------------------------------------------------------------------
  // CAPTURED-PAIRS TRAYS (audit #8). Two shelves on the plank's left/right
  // margins (outside the grid). When a side captures a pair, a miniature face-up
  // copy of that pair's glyph slides up into that side's tray. Driven PURELY from
  // snapshot state (matched cards + which side's score rose) — derivable on every
  // client, zero new wire data, fair-play intact. Host tray = -X margin, guest
  // tray = +X margin in the canonical frame; the framework's group rotation
  // orients them per seat just like every other cue.
  // ---------------------------------------------------------------------------
  const TRAY_TILE = 0.04; // mini-tile edge (fits the ~0.05 plank margin)
  const trayGeo = keep(new THREE.PlaneGeometry(TRAY_TILE, TRAY_TILE));
  const TRAY_GAP = (BOARD_SIZE * 0.86) / PAIRS; // Z pitch so PAIRS tiles span the board depth
  const trayX = gw / 2 + (outer / 2 - gw / 2) * 0.5; // midpoint of the side margin
  const trayZ0 = -BOARD_SIZE * 0.40; // first slot near the far edge, filling toward near
  const TRAY_REST_Y = TOP + 0.003; // flush-ish on the felt; rises on capture
  // A faint felt-toned recess plate per tray so empty slots read as "captured area".
  // Each tray owns its plate material so the WINNER's tray can be tinted at game
  // end (audit #10) — a clear per-side scoreboard read.
  // Plate width narrowed (1.5 -> 1.3) so its outer edge stays inside the plank
  // rim (trayX + plateW/2 <= outer/2) instead of floating past the plank. (audit P3)
  const trayPlateGeo = keep(new THREE.PlaneGeometry(TRAY_TILE * 1.3, TRAY_GAP * PAIRS + TRAY_TILE * 0.5));
  const TRAY_PLATE_BASE = 0x3a2614;

  // Per-side tray bookkeeping: meshes + the spring-in animation phase per slot.
  function makeTray(sign) {
    const plateMat = keep(new THREE.MeshBasicMaterial({ color: TRAY_PLATE_BASE, transparent: true, opacity: 0.5, depthWrite: false }));
    const plate = meshOf(THREE, trayPlateGeo, plateMat, false);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(sign * trayX, TOP + 0.0015, trayZ0 + (TRAY_GAP * PAIRS) / 2 - TRAY_GAP / 2);
    plate.renderOrder = 1;
    group.add(plate);
    const tiles = [];
    for (let s = 0; s < PAIRS; s++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      mat.opacity = 0;
      const mesh = meshOf(THREE, trayGeo, mat, false);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(sign * trayX, TRAY_REST_Y, trayZ0 + s * TRAY_GAP);
      mesh.renderOrder = 2;
      mesh.visible = false;
      group.add(mesh);
      tiles.push({ mesh, mat, value: -1, riseT: 0 }); // riseT 1→0 spring on capture
    }
    return { tiles, count: 0, plateMat };
  }
  const trayHost = makeTray(-1);
  const trayGuest = makeTray(1);
  const trayFor = (seat) => (seat === "guest" ? trayGuest : trayHost);

  // Tint the winner's tray plate at game end (or reset both to neutral), a clear
  // per-side scoreboard read. Driven from phase/winner (in every snapshot). (audit #10)
  function updateTrayWinTint() {
    const hostWin = phase === "over" && winner === "host";
    const guestWin = phase === "over" && winner === "guest";
    trayHost.plateMat.color.set(hostWin ? SIDE_HEX.host : TRAY_PLATE_BASE);
    trayHost.plateMat.opacity = hostWin ? 0.72 : 0.5;
    trayGuest.plateMat.color.set(guestWin ? SIDE_HEX.guest : TRAY_PLATE_BASE);
    trayGuest.plateMat.opacity = guestWin ? 0.72 : 0.5;
  }

  // Captured-pair attribution (deterministic on every client). We track which
  // matched-card indices we've already filed into a tray, plus the last seen
  // per-side scores, so when new matched cards appear we attribute the pair to the
  // side whose score rose. No wire change: scores + matched state are in every
  // snapshot. Reset alongside game reset.
  let filedMatched = new Set();
  let prevScores = { host: 0, guest: 0 };

  // Glyph texture for a tray tile reuses the very same canvas texture the card
  // faces already own (no extra GPU texture). Just swaps the map + shows the tile.
  function fillTraySlot(tray, value) {
    if (tray.count >= PAIRS) return;
    const slot = tray.tiles[tray.count++];
    getFaceMat(value); // ensure the glyph texture exists
    slot.mat.map = faceMats[value].map;
    slot.value = value;
    slot.mat.opacity = 1;
    slot.mesh.visible = true;
    slot.riseT = 1; // arm the spring-in
    slot.mat.needsUpdate = true;
  }

  // Re-derive the trays from current logical state. Adds any newly-matched pair to
  // the correct side's tray; on a cold snap (snapCards) it can also be asked to
  // place everything instantly (no spring) for a late joiner / recovery resync.
  function syncTrays(instant) {
    // Find matched cards we haven't filed yet, grouped by value (a pair shares a value).
    const fresh = {}; // value -> [indices]
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].state === "matched" && cards[i].value != null && !filedMatched.has(i)) {
        (fresh[cards[i].value] || (fresh[cards[i].value] = [])).push(i);
      }
    }
    // Which side just scored? Compare to the last seen scores; default to the
    // current `turn` if scores are ambiguous (e.g. a multi-pair recovery snap).
    const hostGained = scores.host - prevScores.host;
    const guestGained = scores.guest - prevScores.guest;
    let remainingHost = Math.max(0, hostGained);
    let remainingGuest = Math.max(0, guestGained);
    for (const v in fresh) {
      const idxs = fresh[v];
      if (idxs.length < 2) continue; // a full pair only
      let seat;
      if (remainingHost > 0) { seat = "host"; remainingHost--; }
      else if (remainingGuest > 0) { seat = "guest"; remainingGuest--; }
      else seat = turn; // fallback (cold resync where scores already settled)
      fillTraySlot(trayFor(seat), cards[idxs[0]].value);
      filedMatched.add(idxs[0]);
      filedMatched.add(idxs[1]);
      if (instant) {
        const t = trayFor(seat).tiles[trayFor(seat).count - 1];
        t.riseT = 0;
        t.mesh.position.y = TRAY_REST_Y;
      }
    }
    prevScores = { host: scores.host | 0, guest: scores.guest | 0 };
  }

  function resetTrays() {
    for (const tray of [trayHost, trayGuest]) {
      for (let s = 0; s < tray.count; s++) {
        const t = tray.tiles[s];
        t.mat.opacity = 0;
        t.mesh.visible = false;
        t.value = -1;
        t.riseT = 0;
        t.mesh.position.y = TRAY_REST_Y;
      }
      tray.count = 0;
    }
    filedMatched = new Set();
    prevScores = { host: scores.host | 0, guest: scores.guest | 0 };
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
  // Chips shifted out along -X to clear the centred placard's footprint and given
  // a LOWER renderOrder than the placard, so the two transparent flat planes have
  // a deterministic composite order (placard always on top) instead of z-fighting
  // from the seated grazing camera. (audit #5)
  // Lifted TOP+0.006 → TOP+0.01 so the chip plane clears the OPAQUE home bar's TOP
  // face (bar centre TOP+0.004 + half its 0.006 height = TOP+0.007): the chip sits
  // on the bar's z-line, so at the old height the bar sliced through the middle of
  // the score text. The chip stays under the placard via renderOrder (both
  // depthWrite:false), so this doesn't disturb the placard-on-top layering. (audit P-chip)
  mineSide.chip.mesh.position.set(-BOARD_SIZE * 0.32, TOP + 0.01, -homeEdge);
  mineSide.chip.mesh.renderOrder = 2;
  group.add(mineSide.bar, mineSide.lamp, mineSide.chip.mesh);

  oppSide.bar.position.set(0, TOP + 0.004, homeEdge);
  oppSide.lamp.position.set(BOARD_SIZE * 0.4, TOP + 0.012, homeEdge);
  oppSide.chip.mesh.position.set(-BOARD_SIZE * 0.32, TOP + 0.01, homeEdge);
  oppSide.chip.mesh.renderOrder = 2;
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
  // Higher renderOrder than the score chips (2) so this transparent plane always
  // composites on top with a deterministic draw order — no same-renderOrder
  // sort flicker where their flat footprints can overlap. (audit #5)
  placard.renderOrder = 3;
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
  let deniedFlashT = 0; // one-shot blocked-click "denied" flash on the near bar (audit #11)
  const deniedColor = new THREE.Color("#c0392b"); // red flash hue for a denied click
  const tmpColor = new THREE.Color(); // reused scratch colour (no per-frame alloc)

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
    updateTrayWinTint();
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
      // Flip-UP (faceUp): back on both halves until the edge-on midpoint, then the
      // printed face on the -Y (index 3) slot. Flip-DOWN (!faceUp): the -Y slot is
      // still tilted toward the viewer while past the midpoint, so keep showing the
      // remembered glyph (a.lastFace) there until the card crosses to back-up — only
      // then does the back take both slots. (audit: flip-back no longer snaps the
      // glyph to the card back the instant the turn-back begins.)
      const desired = a.faceUp
        ? (past ? cardMaterials(M.back, a.mat) : cardMaterials(M.back, M.back))
        : (past ? cardMaterials(M.back, a.lastFace) : cardMaterials(a.mat, M.back));
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
      // Remember the printed glyph while it's showing so a later flip-DOWN can keep
      // displaying it through the first half of the hinge turn (see stepFlips).
      if (faceUp) a.lastFace = mat;
      // Fire the match "pop" once, when a card NEWLY becomes matched. Everyone
      // receives the `matched` state, so the flourish is consistent across roles.
      // (audit I1)
      if (c.state === "matched" && a.prevState !== "matched") a.popT = POP_DUR;
      // Fire the just-flipped accent halo once, when a card NEWLY becomes "up"
      // (down → up). Helps a watcher follow a fast opponent's last move. (audit #9)
      if (c.state === "up" && a.prevState !== "up") a.haloT = 1;
      // Arm/keep a gentle flip-back wobble on the two mismatched cards during the
      // reveal window, so "no match" reads kinesthetically before they turn back.
      // Cleared once the card leaves the mismatch (flips back / matches). (audit #13)
      a.wobbleT = mismatchPair && (i === upA || i === upB) ? 1 : 0;
      a.prevState = c.state;
    }
    // Update the captured-pairs trays from the new logical state. (audit #8)
    syncTrays(false);
  }

  // Snap cards to their resting pose (no animation) — used on a fresh sync so a
  // late joiner doesn't replay flips it never saw.
  function snapCards() {
    for (let i = 0; i < cardMeshes.length; i++) {
      const a = anim[i];
      a.flipT = 1; // already at rest; nothing to ease
      a.popT = 0; // no flourish replay on a cold sync
      a.haloT = 0; // no just-flipped halo replay on a cold sync
      a.wobbleT = 0; // no wobble replay on a cold sync
      cardMeshes[i].rotation.set(a.target, 0, 0); // x = flip target; clear leftover wobble (z)
      cardMeshes[i].position.y = baseY[i]; // clear any leftover hover lift
      cardMeshes[i].scale.set(1, 1, 1);
      if (haloMats[i]) { haloMats[i].opacity = 0; haloMats[i].color.set(PALETTE.accent); haloMeshes[i].visible = false; }
      cardMeshes[i].material = a.faceUp
        ? cardMaterials(M.back, a.mat)
        : cardMaterials(a.mat, M.back);
    }
    // Place captured tiles in their trays instantly (no spring) for a cold sync,
    // and settle any spring armed by a preceding renderCards() so a late joiner /
    // recovery resync doesn't animate captures it never saw.
    syncTrays(true);
    for (const tray of [trayHost, trayGuest]) {
      for (let s = 0; s < tray.count; s++) {
        const t = tray.tiles[s];
        t.riseT = 0;
        t.mesh.position.y = TRAY_REST_Y;
      }
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
  // Local mismatch-window detection a GUEST can observe (showIdx is host-only):
  // two revealed "up" cards with unequal values means the reveal is in progress.
  function mismatchShowing() {
    let a = -1;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].state === "up" && cards[i].value != null) {
        if (a === -1) a = i;
        else return cards[a].value !== cards[i].value;
      }
    }
    return false;
  }

  function onPointer(hit) {
    if (!mySeat) return; // spectator: read-only
    const cell = hit && hit.cell;
    const onGrid = cell && Number.isInteger(cell.i);
    // BLOCKED-CLICK CUE (audit #11). A click on the grid that can't proceed (not
    // your turn, the reveal window is up, or the cell is already played) gets a
    // local "denied" flash on the near home bar so the seated player gets feedback
    // instead of dead input. Purely cosmetic — no move is sent.
    const blocked = onGrid && (
      !ctx.isLocalTurnAllowed() ||
      phase !== "play" ||
      turn !== mySeat ||
      showIdx ||
      mismatchShowing() ||
      cards[cell.i].state !== "down"
    );

    if (!ctx.isLocalTurnAllowed()) { if (blocked) deniedFlashT = 0.5; return; }
    if (phase !== "play" || turn !== mySeat) { if (blocked) deniedFlashT = 0.5; return; }
    if (showIdx || mismatchShowing()) { if (blocked) deniedFlashT = 0.5; return; }
    if (!onGrid) return;
    if (cards[cell.i].state !== "down") { deniedFlashT = 0.5; return; }

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
      resetTrays(); // empty both captured-pairs trays on a fresh game (audit #8)
      renderCards();
      snapCards();
      updateIdentityCues();
      if (amHost()) { pushState(); pushReveal(); }
      return;
    }
    if (amHost()) return; // host is authoritative; ignore its own echo

    const src = Array.isArray(state.cards) ? state.cards : [];
    const next = Array.from({ length: COLS * ROWS }, (_, i) => {
      const s = src[i] || {};
      const st = s.state === "up" || s.state === "matched" ? s.state : "down";
      return { state: st, value: st !== "down" && Number.isInteger(s.value) ? s.value : null };
    });
    // RECOVERY-RESYNC SNAP (audit #2). A normal move changes at most two cards'
    // logical state. A re-sync push after a desync (board.js _requestResync) can
    // change many cards at once — animating that as a "move" teleports the board
    // with a flurry of flips it never saw. Detect a big delta and snap instead.
    let changed = 0;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].state !== next[i].state) changed++;
    }
    const bigDelta = synced && changed > 2;
    cards = next;
    turn = state.turn === "guest" ? "guest" : "host";
    scores = { host: state.scores?.host | 0, guest: state.scores?.guest | 0 };
    phase = state.phase === "over" ? "over" : "play";
    winner = state.winner === "host" || state.winner === "guest" ? state.winner : null;

    renderCards();
    updateIdentityCues();
    // First snapshot after (re)join = full sync → snap (don't replay unseen
    // flips). A recovery resync (bigDelta) likewise snaps. Single-move snapshots
    // animate.
    if (!synced) {
      synced = true;
      snapCards();
    } else if (bigDelta) {
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

      // Match pop: a brief ease-out 1 → 1+POP_SCALE → 1 swell on the matched card,
      // applied to the Y (thickness) axis only so it never collides with a
      // horizontally-adjacent neighbour. (audit #7)
      let scaleY = 1;
      if (a.popT > 0) {
        a.popT = Math.max(0, a.popT - step);
        const p = 1 - a.popT / POP_DUR; // 0 → 1
        scaleY = 1 + POP_SCALE * Math.sin(p * Math.PI); // smooth up-and-back
      }

      // Mid-flip arc lift. A card hinges about its CENTRE, so at the on-edge pose
      // its lower rim reaches ~cardH/2 below centre — without a lift that dips well
      // under the felt (the box stabs ~3cm through the plank). Raise the centre by
      // exactly the card's CURRENT vertical half-extent so the lowest rim rides just
      // above TOP through the entire hinge — like reversi's disc-flip lift, but
      // derived from the real angle so a thick card never dips at the ~50–80° pose a
      // fixed sin() arc (tuned only for the edge-on disc case) would under-lift.
      // Naturally 0 at both rest poses (rotation 0 / PI), so it's continuous and
      // costs no trig once a flip settles (flipT === 1).
      let flipLift = 0;
      if (a.flipT < 1) {
        const ang = m.rotation.x;
        const half = (CARD_T / 2) * Math.abs(Math.cos(ang)) + (cardH / 2) * Math.abs(Math.sin(ang));
        flipLift = Math.max(0, TOP + 0.001 + half - CARD_Y);
      }
      const lift = easeInOut(a.hoverT) * HOVER_LIFT + flipLift;
      if (m.position.y !== baseY[i] + lift) m.position.y = baseY[i] + lift;
      if (m.scale.y !== scaleY) m.scale.set(1, scaleY, 1);

      // Just-flipped accent halo: fade a ground ring in then out once. (audit #9)
      if (a.haloT > 0) {
        a.haloT = Math.max(0, a.haloT - step / 0.5); // ~0.5s pulse
        const o = Math.sin(a.haloT * Math.PI) * 0.6; // 0 → peak → 0
        haloMeshes[i].visible = o > 0.01;
        haloMats[i].opacity = o;
      } else if (haloMeshes[i].visible) {
        haloMeshes[i].visible = false;
        haloMats[i].opacity = 0;
      }

      // Mismatch flip-back wobble: a few degrees of rotation.z oscillation while
      // the two unequal cards are revealed, so "no match" reads kinesthetically.
      // rotation.x (the flip) is owned by stepFlips; we only touch z here. (audit #13)
      // Ease rotation.z toward the target rather than assigning it: the sine is
      // driven by the free-running clock, so a hard assign would snap z from 0 to
      // wherever sin() happens to be on arm (up to ~4 deg) and snap straight back
      // on clear. A short critically-damped-ish lerp makes both ends continuous.
      const targetWobble = a.wobbleT > 0 ? Math.sin(clock * 22) * 0.07 : 0;
      const next = m.rotation.z + (targetWobble - m.rotation.z) * Math.min(1, step / 0.08);
      if (m.rotation.z !== next) m.rotation.z = next;
    }

    // Captured-pairs tray spring-in: each newly filed tile rises from the felt and
    // eases into its resting slot. (audit #8)
    for (const tray of [trayHost, trayGuest]) {
      for (let s = 0; s < tray.count; s++) {
        const t = tray.tiles[s];
        if (t.riseT > 0) {
          t.riseT = Math.max(0, t.riseT - step / 0.35);
          t.mesh.position.y = TRAY_REST_Y + 0.03 * t.riseT; // drop from +0.03 to rest
        } else if (t.mesh.position.y !== TRAY_REST_Y) {
          t.mesh.position.y = TRAY_REST_Y;
        }
      }
    }

    // Blocked-click "denied" flash: briefly tint the near home bar red, then ease
    // back to the local side hue. Overrides the turn pulse while active. (audit #11)
    if (deniedFlashT > 0) {
      deniedFlashT = Math.max(0, deniedFlashT - step);
      const f = Math.sin((deniedFlashT / 0.5) * Math.PI); // 0 → 1 → 0 over the flash
      const nearHex = mySeat === "guest" ? SIDE_HEX.guest : SIDE_HEX.host;
      tmpColor.set(nearHex).lerp(deniedColor, f);
      mineSide.bar.material.color.copy(tmpColor);
      mineSide.bar.material.emissive.copy(tmpColor);
      mineSide.bar.material.emissiveIntensity = 0.5 + 0.8 * f;
      if (deniedFlashT === 0) {
        // Restore the resting side hue once the flash ends.
        mineSide.bar.material.color.set(nearHex);
        mineSide.bar.material.emissive.set(nearHex);
      }
    } else if (pulseMine) {
      // "Your turn" bar pulse for the seated player. (audit I5)
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
      // WIN WAVE (audit #10): a celebration ripple of accent halos sweeps across
      // the grid, offset by each card's index so the finish reads as a wave rather
      // than a single flat flash. Halos are per-card and already pooled, so this is
      // allocation-free and consistent for every role (phase/winner are in the
      // snapshot). Tinted with the WINNER's side hue (neutral accent on a draw).
      const waveColor = winner ? SIDE_HEX[winner] : PALETTE.accent;
      const progress = 1 - winFlourishT; // 0 → 1 over the flourish
      for (let i = 0; i < cardMeshes.length; i++) {
        if (cards[i].state !== "matched") continue;
        const phaseOff = (i / cardMeshes.length) * 1.6; // stagger the ripple
        const w = Math.sin((progress * 3.2 - phaseOff) * Math.PI);
        const o = w > 0 ? w * 0.7 * winFlourishT : 0;
        if (o > 0.01) {
          haloMeshes[i].visible = true;
          haloMats[i].color.set(waveColor);
          haloMats[i].opacity = Math.max(haloMats[i].opacity, o);
        }
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
    const promotedToHost = role === "host" && !wasHost;
    if (promotedToHost) {
      // HOST-MIGRATION RE-ARM (audit #1/#4). The old host owned the mismatch
      // "show" timer and the per-turn `pending` privately — neither crosses the
      // wire. A freshly promoted host must reconstruct them from the relayed
      // snapshot or the match stalls (two mismatched cards stay up forever) /
      // the in-progress turn is lost.
      const up = [];
      for (let i = 0; i < cards.length; i++) if (cards[i].state === "up") up.push(i);
      if (up.length === 2) {
        const [a, b] = up;
        if (cards[a].value != null && cards[b].value != null && cards[a].value === cards[b].value) {
          // A matched pair that the old host never finished promoting: settle it.
          cards[a].state = "matched";
          cards[b].state = "matched";
          scores[turn] += 1;
          pending = [];
          showIdx = null;
          showUntil = 0;
          checkWin();
        } else {
          // Two unequal cards revealed: re-arm the flip-back timer so WE complete
          // the reveal the dropped host began (no permanent stall).
          pending = [a, b];
          showIdx = [a, b];
          showUntil = nowMs() + SHOW_MS;
        }
      } else if (up.length === 1) {
        // A lone in-progress flip (old host had flipped ONE card this turn). If our
        // deck agrees with the visible value, re-adopt it as this turn's pending
        // card so the next flip resolves the pair. If it DOESN'T agree (e.g. we
        // were promoted with a freshly minted/reshuffled deck), flip it back down
        // to a clean pre-flip state rather than leave a phantom orphaned "up" card
        // the resolver would never pair — preventing a desync. (audit #4)
        const i = up[0];
        if (Number.isInteger(deck?.[i]) && deck[i] === cards[i].value) {
          pending = [i];
        } else {
          cards[i].state = "down";
          cards[i].value = null;
          pending = [];
        }
        showIdx = null;
        showUntil = 0;
      } else {
        pending = [];
        showIdx = null;
        showUntil = 0;
      }
    }
    // A fresh host must publish its deck on the spectator-only reveal channel so
    // watchers can render true faces.
    if (promotedToHost) { renderCards(); pushReveal(); pushState(); }
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
    // Per-cell halo materials and per-slot tray-tile materials live outside `owned`.
    for (const m of haloMats) m?.dispose?.();
    for (const tray of [trayHost, trayGuest]) for (const t of tray.tiles) t.mat?.dispose?.();
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
