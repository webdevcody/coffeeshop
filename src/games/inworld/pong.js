// Pong — in-world 3D module (createGame contract). REAL-TIME, host-authoritative.
//
// CANDIDATE #3 — distinct approach: SELF-ORIENTED rendering.
//
// The shared engine (board.js) rotates a flat board by orientFor(seatRy) to face
// whoever is looking. For a paddle game that rotation is a trap: a 180° turn for
// the across-the-table seat flips BOTH the lateral (paddle-travel) axis AND the
// court-length axis, so "guest = right edge, near me" silently becomes "guest's
// own paddle is across the table" and the up/down controls invert. The previous
// build tried to patch only the up/down axis with an upAxisSign dot product and
// left the side-of-table flip unfixed.
//
// We sidestep all of that by declaring orientPolicy:"self" (board.js then does
// NOT rotate our group — see InWorldBoard._orient) and rendering everything
// ourselves in a LOCAL-VIEW frame whose invariant is simple and robust:
//
//   * THE LOCAL PLAYER'S OWN PADDLE IS ALWAYS ON THE NEAR (-Z) EDGE, the opponent
//     across at +Z. The paddle travels along local X.
//   * Identity (which side is mine, my colour) is derived ONCE from ctx.role and
//     NEVER from the wire, so a relayed snapshot can never flip our side.
//
// The simulation runs in a single CANONICAL field frame (host-authoritative):
//   y in [0,H]  : court length. y=0 = HOST end (side A), y=H = GUEST end (side B)
//   x in [0,W]  : lateral paddle-travel axis
// Each client maps canonical -> its own local-view for rendering. The host sees
// canonical directly (host end near). The guest applies a 180° view flip in code
// (canonical y=H -> near -Z, x mirrored) so its OWN end is near. Spectators use
// the canonical/host view (read-only).
//
// Networking (host-authoritative, trust-the-client-but-verify):
//   * Host simulates ball + BOTH paddles every frame and streams full canonical
//     state ~50Hz via net.sendState. Guests apply it idempotently; their own
//     paddle is reconciled toward authority so it can never teleport.
//   * The guest never sends an absolute paddle position. It sends STEERING INTENT
//     ({dir} in CANONICAL space, -1/0/1) via net.sendInput; the host integrates
//     that under the SAME PADDLE_SPEED, so the guest cannot snap its paddle onto
//     the ball. Local prediction keeps the guest's own paddle responsive.
//   * The ball is dead-reckoned between snapshots and eased toward the
//     extrapolated authoritative sample, snapping only on a large discontinuity
//     (bounce / serve / score) so motion stays smooth.
// First to 7 wins. An in-world canvas placard shows the live score and which
// paddle is YOURS.

import { orientFor } from "./createGame.js";
import { BOARD_SIZE, PALETTE, meshOf, standard } from "./pieces.js";

// ---- field constants (canonical) ----
const W = 100, H = 60;            // x = lateral (paddle travel), y = court length
const PADDLE_HALF = 9, PADDLE_T = 2; // paddle half-width along x, thickness along y
const HOST_Y = 4, GUEST_Y = H - 4; // paddle centre-lines along court length
const BALL_R = 1.4, TARGET = 7;
const PADDLE_SPEED = 95, BALL_START = 46, BALL_MAX = 120, SPEEDUP = 1.05;
const MAX_BOUNCE = 0.42 * Math.PI;
const RECONCILE_RATE = 9;   // per-second ease toward authority
const RESEED_DIST = 12;     // canonical units: gap above which we snap not ease
const SEND_HZ = 50;
// Guest-presence gate: the guest streams steering intent on a ~50ms throttle tick
// even when idle, so a connected-but-stationary guest refreshes this constantly.
// If no intent has arrived for this long mid-match the host pauses (freezes ball,
// no scoring) so it can't run up the score against a departed opponent.
const GUEST_TIMEOUT_MS = 1500;
const REMATCH_MS = 4000;    // host auto-returns to lobby this long after a win
const PADDLE_DEADZONE = 0.5; // canonical units: guest stops easing inside this gap
const HIT_POP_MS = 130;     // ball squash-pop duration on a paddle reflect
const SCORE_POP_MS = 450;   // canvas score-digit flash duration on a point
const WALL_POP_MS = 160;    // gold side-rail flash duration on a wall bounce
const LASTTOUCH_MS = 170;   // ball tint-toward-last-paddle duration after a hit
const WIN_RING_MS = 1100;   // expanding gold floor ring on a match win
const TRAIL_N = 4;          // ball motion-trail ghost count

// Map field units -> local board metres (court inscribed in the playable square).
const COURT_W = BOARD_SIZE * 0.9;             // lateral extent (x -> world X)
const COURT_H = BOARD_SIZE * 0.9;             // length extent  (y -> world Z)
const SX = COURT_W / W, SZ = COURT_H / H;
// Side-rail geometry: the gold rails are 0.01 m wide boxes centred on ±COURT_W/2.
// We push them OUTWARD by their own half-width so their inner face sits exactly on
// the court edge ±COURT_W/2 (rather than straddling it), and we clamp the paddle a
// matching margin in so its outer face meets — but never pokes through — that inner
// rail face. Both fixes are purely positional (no gameplay/extent change).
const RAIL_W = 0.01;
const RAIL_HALF = RAIL_W / 2;
// Canonical-x margin the paddle must keep from each wall so its rendered outer face
// (PADDLE_HALF*SX beyond its centre) lands at most on the rail's inner face.
const PADDLE_WALL_MARGIN = RAIL_HALF / SX;

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "pong";

  let role = ctx.role;
  // Our physical chair ry. We declare orientPolicy:"self", so board.js does NOT
  // rotate our group (board.js._orient returns early) — we must rotate it
  // ourselves per seat, exactly like battleship. orientFor(seatRy) brings this
  // seat's near edge to local -Z; the viewFlip below then selects host-vs-guest
  // end within that frame, so the two compose correctly.
  let seatRy = ctx.seatRy;
  // IDENTITY is now MUTABLE so a live role transition (board.js InWorldBoard
  // .setRole performs an IN-PLACE role change without remounting) can recompute
  // every view-critical value. It is still derived ONLY from role, NEVER from the
  // wire, so a relayed snapshot can never flip our side.
  let isHost = role === "host";
  let isGuest = role === "guest";
  let isSpectator = !isHost && !isGuest;

  // ----- IDENTITY (derived from role, never from the wire) -----
  // host owns side A (canonical y=0 end, COLOR A), guest owns side B (y=H end,
  // COLOR B). Spectator owns nothing. mySign tells us, for THIS client, whether
  // its own end is at canonical y=0 (host: +1) or y=H (guest: -1) — which is also
  // exactly the local-view flip we apply when rendering canonical coords.
  let mySide = isHost ? "A" : isGuest ? "B" : null;
  let myColor = mySide === "A" ? PALETTE.pongLeft : mySide === "B" ? PALETTE.pongRight : null;
  let oppColor = mySide === "A" ? PALETTE.pongRight : mySide === "B" ? PALETTE.pongLeft : null;
  // viewFlip: false => render canonical directly (host / spectator). true =>
  // render canonical rotated 180° about table centre so the guest's own end (y=H)
  // lands near (-Z). Spectators take the host/canonical view.
  let viewFlip = isGuest;

  // Canonical field x/y -> local metres in THIS client's view frame. The guest's
  // view is a 180° rotation about table centre, so both axes negate.
  const fX = (x) => (viewFlip ? -(-COURT_W / 2 + x * SX) : (-COURT_W / 2 + x * SX));
  const fZ = (y) => (viewFlip ? -(-COURT_H / 2 + y * SZ) : (-COURT_H / 2 + y * SZ));

  // ----- simulation state (CANONICAL) -----
  let phase = "lobby"; // lobby | play | over
  let winner = null;
  let ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  let pA = W / 2, pB = W / 2;      // paddle lateral positions (canonical x), A=host B=guest
  let scoreA = 0, scoreB = 0;
  let serveDir = 1;

  // host's integrated view of the guest paddle intent
  let guestDir = 0;               // -1/0/1 canonical lateral steering from guest
  // Host presence gate: stays false until the guest's first steering intent
  // arrives, so the host can't start serving/scoring against an empty seat. The
  // guest streams intent on a throttle tick even when idle (see update()), so a
  // connected-but-stationary guest still flips this within ~50ms.
  let guestSeen = false;
  // Mid-match departure gate (host only): last time a guest steering intent
  // arrived. While 'play', if this goes stale the host pauses physics so it can't
  // score against an empty seat. Seeded to nowMs() at construction; meaningful
  // only once guestSeen flips. paused mirrors that state for placard text.
  let lastGuestInputAt = 0;
  let paused = false;
  // Rematch timer (host only): set when a match ends so the court auto-returns to
  // lobby (then re-serves once the guest is still present) instead of dying.
  let rematchAt = 0;
  // One-shot flourish counters streamed to guests/spectators so all three views
  // animate the same pops. hitSeq bumps on every paddle reflect; scoreSeq bumps on
  // every point. Each client compares against a locally-remembered value.
  let hitSeq = 0, scoreSeq = 0, wallSeq = 0;
  let seenHitSeq = 0, seenScoreSeq = 0, seenWallSeq = 0;
  let hitAt = 0;                  // local ms timestamp of the last hit pop
  let tintAt = 0;                 // local ms timestamp driving the last-touch ball tint
  let hitSide = null;             // canonical side ("A"/"B") of the paddle that last hit
  let wallAt = 0;                 // local ms timestamp of the last wall-bounce flash
  let wallSide = null;            // which rail flashed: "L" (x=0) or "R" (x=W)
  let winFlashAt = 0;             // local ms timestamp the match-over celebration began
  let scoreFlashAt = 0;           // local ms timestamp of the last score flash
  let scoreFlashSide = null;      // which canonical side ("A"/"B") just scored
  // guest local prediction + reconciliation
  let myPredX = W / 2;            // guest's predicted own paddle (canonical x)
  let lastSentDir = 0;
  // guest/spectator ball render + reconciliation
  let view = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  let auth = null;
  let lastStateAt = 0;
  let sendAcc = 0, inputAcc = 0;

  const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  // ----- input (keyboard) -----
  // We capture left/right in LOCAL-VIEW screen space, then convert to a CANONICAL
  // lateral dir. In the guest's flipped view, local +X is canonical -X, so a guest
  // pressing "right" must move canonical -X. viewSign encodes that flip.
  let viewSign = viewFlip ? -1 : 1;
  const keys = new Set();
  const onKey = (e, down) => {
    let k = null;
    if (e.code === "KeyA" || e.code === "ArrowLeft") k = "left";
    else if (e.code === "KeyD" || e.code === "ArrowRight") k = "right";
    else if (e.code === "KeyW" || e.code === "ArrowUp") k = "left";   // allow up/down too
    else if (e.code === "KeyS" || e.code === "ArrowDown") k = "right";
    if (!k) return;
    if (down) keys.add(k); else keys.delete(k);
  };
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  // Only a guest ever sends steering, so only a guest needs the global key
  // listeners. Spectators / ambient mirrors (mounted as role "spectator") would
  // otherwise each install a useless pair of window listeners that accumulate.
  let keysAttached = false;
  function attachKeys() {
    if (keysAttached || !isGuest || typeof window === "undefined") return;
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    keysAttached = true;
  }
  function detachKeys() {
    if (!keysAttached || typeof window === "undefined") return;
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    keys.clear();
    keysAttached = false;
  }
  attachKeys();
  // Read local-view dir (-1 left .. +1 right in the player's own screen), convert
  // to canonical lateral dir.
  function localDirCanonical() {
    let d = 0;
    if (keys.has("right")) d += 1;
    if (keys.has("left")) d -= 1;
    return d * viewSign;
  }

  // ----- geometry -----
  const owned = [];
  const keep = (x) => (owned.push(x), x);

  const M = {
    floor: keep(standard(THREE, "#0a1226", { roughness: 0.75, metalness: 0.05 })),
    colorA: keep(standard(THREE, PALETTE.pongLeft, { emissive: PALETTE.pongLeft, emissiveIntensity: 0.35 })),
    colorB: keep(standard(THREE, PALETTE.pongRight, { emissive: PALETTE.pongRight, emissiveIntensity: 0.35 })),
    ball: keep(standard(THREE, "#ffffff", { emissive: "#ffffff", emissiveIntensity: 0.55 })),
    line: keep(standard(THREE, PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.25 })),
    // Always create the "mine" material so a live role change (spectator ->
    // seat) can light up the halo/home-strip without rebuilding geometry. Its
    // colour is updated in setRole(); visibility is toggled by myColor.
    mine: keep(standard(THREE, myColor || PALETTE.pongLeft, {
      emissive: myColor || PALETTE.pongLeft, emissiveIntensity: 0.7, transparent: true, opacity: 0.45, depthWrite: false,
    })),
    // Steady, dim grounding ring under the OPPONENT paddle so both paddles read as
    // grounded discs from either seat — fainter than `mine` and never pulses, so it
    // never reads as "yours". Colour refreshed alongside `mine` on role change.
    oppRing: keep(standard(THREE, oppColor || PALETTE.pongRight, {
      emissive: oppColor || PALETTE.pongRight, emissiveIntensity: 0.45, transparent: true, opacity: 0.28, depthWrite: false,
    })),
    // Soft round contact shadow disc that follows the ball for grounding (cheaper
    // and cleaner than a real shadow caster on a tiny fast sphere).
    shadow: keep(standard(THREE, "#000000", {
      roughness: 1, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false,
    })),
    // Fading ghost spheres trailing the ball on fast volleys. One shared material;
    // each ghost fades via its own per-mesh scale (opacity stays constant, cheap).
    trail: keep(standard(THREE, "#ffffff", {
      emissive: "#ffffff", emissiveIntensity: 0.5, transparent: true, opacity: 0.22, depthWrite: false,
    })),
    // Expanding gold ring on the floor when a match is won (winner-coloured glow).
    winRing: keep(standard(THREE, PALETTE.gold, {
      emissive: PALETTE.gold, emissiveIntensity: 0.9, transparent: true, opacity: 0.0, depthWrite: false,
    })),
  };
  // Reused colour scratch (no per-frame allocation) for the last-touch ball tint.
  const WHITE_C = new THREE.Color("#ffffff");

  const plankH = 0.018;
  const TOP = plankH;
  const floor = meshOf(THREE, keep(new THREE.BoxGeometry(COURT_W + 0.05, plankH, COURT_H + 0.05)), M.floor);
  floor.position.y = plankH / 2;
  group.add(floor);

  // midline across the court (perpendicular to length, at y=H/2). A hair taller and
  // lifted off the floor top with a winning renderOrder so it never z-fights into a
  // flickery hairline when viewed from a low seated angle.
  const midline = meshOf(THREE, keep(new THREE.BoxGeometry(COURT_W, 0.004, 0.008)), M.line, false);
  midline.position.set(0, TOP + 0.004, 0);
  midline.renderOrder = 2;
  group.add(midline);

  // side walls (lateral bounds at x=0 and x=W) — gold rails for readability. Widened
  // and lifted a touch so they're legible from both seats without z-fighting.
  const wallGeo = keep(new THREE.BoxGeometry(RAIL_W, 0.014, COURT_H));
  // Each rail uses its OWN material instance (cloned from M.line) so a wall-bounce
  // spark can flash one rail's emissive without lighting the midline/other rail.
  M.lineL = keep(M.line.clone());
  M.lineR = keep(M.line.clone());
  const wallL = meshOf(THREE, wallGeo, M.lineL, false);
  const wallR = meshOf(THREE, wallGeo, M.lineR, false);
  // Push each rail OUTWARD by its half-width so its INNER face sits on ±COURT_W/2
  // (the court edge) instead of straddling it — the rail no longer pokes inward.
  wallL.position.set(-COURT_W / 2 - RAIL_HALF, TOP + 0.007, 0);
  wallR.position.set(COURT_W / 2 + RAIL_HALF, TOP + 0.007, 0);
  wallL.renderOrder = 2; wallR.renderOrder = 2;
  group.add(wallL, wallR);

  // paddles: A (host/colorA) and B (guest/colorB). They travel along world X.
  // No shadow cast: thin fast slivers shimmer the shadow map; the grounding rings
  // (myHalo / oppRing) provide the contact cue instead — cheaper and cleaner.
  const padGeo = keep(new THREE.BoxGeometry(PADDLE_HALF * 2 * SX, 0.025, PADDLE_T * SZ * 1.6));
  const padA = meshOf(THREE, padGeo, M.colorA, false);
  const padB = meshOf(THREE, padGeo, M.colorB, false);
  const PAD_Y = TOP + 0.013;
  padA.position.y = padB.position.y = PAD_Y;
  group.add(padA, padB);

  // Ball rests ON the floor top (bottom tangent to plank) rather than floating a
  // few mm above relative to its own radius. A hair of clearance avoids z-fighting.
  const BALL_RADIUS = BALL_R * SX * 1.3;
  const ballGeo = keep(new THREE.SphereGeometry(BALL_RADIUS, 14, 12));
  const ballMesh = meshOf(THREE, ballGeo, M.ball, false);
  const BALL_Y = TOP + BALL_RADIUS + 0.001;
  ballMesh.position.y = BALL_Y;
  group.add(ballMesh);

  // Soft contact shadow disc under the ball (grounding cue, follows in render()).
  const ballShadow = meshOf(THREE, keep(new THREE.CircleGeometry(BALL_RADIUS * 1.15, 18)), M.shadow, false);
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.y = TOP + 0.0015;
  ballShadow.renderOrder = 1;
  group.add(ballShadow);

  // Ball motion trail: a small ring of ghost spheres positioned behind the ball
  // along its travel axis in render(). Purely local (keyed off speed), never wired.
  const trailGeo = keep(new THREE.SphereGeometry(BALL_RADIUS, 10, 8));
  const trail = [];
  for (let i = 0; i < TRAIL_N; i++) {
    const g = meshOf(THREE, trailGeo, M.trail, false);
    g.position.y = BALL_Y;
    g.renderOrder = 0; // behind the ball
    g.visible = false;
    group.add(g);
    trail.push(g);
  }

  // Expanding gold ring on the floor, shown only during the match-over celebration.
  // A flat thin annulus; scaled/faded in render() while phase==="over" & winFlashAt.
  const winRing = meshOf(THREE, keep(new THREE.RingGeometry(0.9, 1.0, 40)), M.winRing, false);
  winRing.rotation.x = -Math.PI / 2;
  winRing.position.y = TOP + 0.0025;
  winRing.renderOrder = 4;
  winRing.visible = false;
  group.add(winRing);

  // ----- IDENTITY CUE: glowing home strip + halo under MY paddle -----
  // Always built; visibility is toggled by whether this client owns a paddle, so
  // a live spectator<->seat role change can show/hide the cue without rebuilding.
  let homeStrip = null, myHalo = null;
  // Inset the home strip inside the gold rails (COURT_W - 2*RAIL_W) so its ends tuck
  // under the rails instead of butting their inner faces at a shared pixel seam.
  homeStrip = meshOf(THREE, keep(new THREE.BoxGeometry(COURT_W - 2 * RAIL_W, 0.002, PADDLE_T * SZ * 0.5)), M.mine, false);
  homeStrip.position.set(0, TOP + 0.003, -COURT_H / 2 + PADDLE_T * SZ * 0.4); // always near (-Z) = my side
  homeStrip.visible = !!myColor;
  group.add(homeStrip);
  myHalo = meshOf(THREE, keep(new THREE.BoxGeometry(PADDLE_HALF * 2 * SX * 1.25, 0.002, PADDLE_T * SZ * 2.4)), M.mine, false);
  myHalo.position.y = TOP + 0.004;
  myHalo.renderOrder = 3;
  myHalo.visible = !!myColor;
  group.add(myHalo);

  // Steady faint grounding ring under the OPPONENT paddle (always the far +Z paddle
  // for a seated player; both paddles for a spectator). Tracks in render().
  const oppRing = meshOf(THREE, keep(new THREE.BoxGeometry(PADDLE_HALF * 2 * SX * 1.18, 0.002, PADDLE_T * SZ * 2.1)), M.oppRing, false);
  oppRing.position.y = TOP + 0.0035;
  oppRing.renderOrder = 3;
  oppRing.visible = !!oppColor; // a seated player has an opponent; spectator handled in render()
  group.add(oppRing);

  // ----- SCOREBOARD placard (canvas texture) -----
  // A flat placard laid just beyond MY near edge (so it reads upright at the
  // bottom of my view) showing "YOU n  —  m OPP" plus turn/result. Text derives
  // from role/myColour, never from the wire.
  let scoreCanvas = null, scoreTex = null, scoreMesh = null;
  function buildScoreboard() {
    if (typeof document === "undefined" || !document.createElement) return;
    scoreCanvas = document.createElement("canvas");
    scoreCanvas.width = 512; scoreCanvas.height = 128;
    scoreTex = new THREE.CanvasTexture(scoreCanvas);
    if (THREE.SRGBColorSpace) scoreTex.colorSpace = THREE.SRGBColorSpace;
    const mat = keep(new THREE.MeshBasicMaterial({ map: scoreTex, transparent: true, depthWrite: false }));
    // Narrowed a touch (0.78 vs 0.85) so that, with the placard pushed fully clear of
    // the plank, its outer CORNERS still stay inside the ~0.55 m table radius.
    const placardW = COURT_W * 0.78;
    const placardD = placardW * (128 / 512);
    const geo = keep(new THREE.PlaneGeometry(placardW, placardD));
    scoreMesh = new THREE.Mesh(geo, mat);
    scoreMesh.rotation.x = -Math.PI / 2; // lay flat
    // Place fully BEYOND MY near (-Z) edge so the whole pill clears the floor plank
    // (the plank extends to -COURT_H/2 - 0.025), text upright from my seat. Its inner
    // edge sits a hair past the plank's near edge: centre = plankNearEdge - halfDepth.
    // Because we self-orient (own paddle always at -Z), this is the same host & guest.
    const plankNearEdge = -COURT_H / 2 - 0.025;
    scoreMesh.position.set(0, TOP + 0.004, plankNearEdge - placardD / 2 - 0.006);
    scoreMesh.renderOrder = 5;
    group.add(scoreMesh);
    keep(scoreTex);
  }
  function paintScore() {
    if (!scoreCanvas || !scoreTex) return;
    const g = scoreCanvas.getContext("2d");
    g.clearRect(0, 0, 512, 128);
    // The placard is a flat plane laid via rotation.x=-PI/2 at the local -Z near
    // edge; after that the canvas top (+V, where we draw) points toward the seated
    // viewer, so unrotated text reads UPSIDE-DOWN. Pre-rotate the 2D canvas 180°
    // (same fix as battleship's drawLabel) so the score/status read upright. The
    // left/right my-vs-opp placement and textAlign mirror correctly under this.
    g.save();
    g.translate(256, 64);
    g.rotate(Math.PI);
    g.translate(-256, -64);
    // background pill
    g.fillStyle = "rgba(6,10,24,0.82)";
    roundRect(g, 6, 6, 500, 116, 18); g.fill();

    const myScore = isSpectator ? scoreA : (mySide === "A" ? scoreA : scoreB);
    const oppScore = isSpectator ? scoreB : (mySide === "A" ? scoreB : scoreA);
    const myHex = myColor || PALETTE.pongLeft;
    const opHex = oppColor || PALETTE.pongRight;
    // The left digit is canonical side A for a spectator, else MY side.
    const leftSide = isSpectator ? "A" : mySide;
    const rightSide = isSpectator ? "B" : (mySide === "A" ? "B" : "A");

    // Score-pop: the just-scored digit briefly swells (eased) so a point reads as a
    // satisfying "+1". Driven by scoreFlashAt/scoreFlashSide; the digit pulse decays
    // to 1.0 over SCORE_POP_MS. Kept purely cosmetic, identical for all viewers
    // because it keys off the synced scores.
    const flashT = scoreFlashAt ? Math.min(1, (nowMs() - scoreFlashAt) / SCORE_POP_MS) : 1;
    const popAmt = flashT < 1 ? (1 - flashT) : 0; // 1 -> 0
    const digit = (txt, hex, align, x, side) => {
      const isFlashing = popAmt > 0 && side != null && side === scoreFlashSide;
      const sc = isFlashing ? 1 + 0.45 * popAmt : 1;
      g.save();
      // scale about the digit's anchor (its baseline x, vertical centre y=56)
      g.translate(x, 56);
      g.scale(sc, sc);
      g.translate(-x, -56);
      g.textAlign = align;
      g.fillStyle = isFlashing ? mixToWhite(hex, 0.5 * popAmt) : hex;
      g.font = "bold 64px sans-serif";
      g.fillText(txt, x, 56);
      g.restore();
    };

    g.textBaseline = "middle";
    digit(String(myScore), myHex, "left", 40, leftSide);
    digit(String(oppScore), opHex, "right", 472, rightSide);
    // dash centre
    g.fillStyle = "#e9e2d0";
    g.textAlign = "center";
    g.font = "bold 40px sans-serif";
    g.fillText("–", 256, 50);

    // Score pips: a TARGET-slot row per side under each digit (filled = points won)
    // for an at-a-glance match-progress read. Purely derived from the synced scores.
    const drawPips = (cx, n, hex, dir) => {
      const slot = 13, r = 3.5;
      for (let i = 0; i < TARGET; i++) {
        const px = cx + dir * i * slot;
        g.beginPath();
        g.arc(px, 22, r, 0, Math.PI * 2);
        g.fillStyle = i < n ? hex : "rgba(220,226,240,0.20)";
        g.fill();
      }
    };
    drawPips(40, myScore, myHex, 1);    // left side fills rightward from the left digit
    drawPips(472, oppScore, opHex, -1); // right side fills leftward from the right digit

    // labels / status line
    g.font = "bold 26px sans-serif";
    let status;
    const showChip = (cx) => { // small colour chip marking the local player
      g.save();
      g.fillStyle = myHex;
      roundRect(g, cx, 90, 18, 18, 4); g.fill();
      g.restore();
    };
    if (isSpectator) {
      // Spectators get a meaningful status so a paused (opponent-away) court doesn't
      // read as a silently-frozen game; over/lobby/play each get their own line.
      if (phase === "over") {
        status = winner === "A" ? "A WINS" : winner === "B" ? "B WINS" : "MATCH OVER";
        g.fillStyle = PALETTE.gold;
      } else if (paused) {
        status = "Opponent away…";
        g.fillStyle = "#e3b34a";
      } else if (phase === "lobby") {
        status = "Waiting for players…";
        g.fillStyle = "#9fb0c8";
      } else {
        status = "SPECTATING  (A vs B)";
        g.fillStyle = "#cdd6e8";
      }
      g.textAlign = "center";
      g.fillText(status, 256, 100);
    } else if (phase === "over") {
      const iWon = (winner === "A" && mySide === "A") || (winner === "B" && mySide === "B");
      status = iWon ? "YOU WIN!" : "YOU LOSE";
      // gold underline beneath the WINNING side's digit for a clear result framing
      const winIsLeft = winner === leftSide;
      g.save();
      g.strokeStyle = PALETTE.gold; g.lineWidth = 5;
      g.beginPath();
      const ux = winIsLeft ? 40 : 446;
      g.moveTo(ux, 96); g.lineTo(ux + 46, 96); g.stroke();
      g.restore();
      g.font = "bold 30px sans-serif";
      g.fillStyle = iWon ? PALETTE.gold : "#cdd6e8";
      g.textAlign = "center";
      g.fillText(status, 256, 100);
    } else if (phase === "lobby") {
      status = paused ? "Opponent away…" : "Waiting…";
      // mark which paddle is the local player's even before play starts
      g.fillStyle = "#cdd6e8";
      g.textAlign = "left";
      g.fillText("YOU", 64, 100);
      showChip(40);
      g.textAlign = "right";
      g.fillStyle = "#9fb0c8";
      g.fillText(status, 472, 100);
    } else {
      // play: clear whose paddle is yours
      g.fillStyle = myHex;
      g.textAlign = "left";
      g.fillText("YOU", 64, 100);
      showChip(40);
      g.textAlign = "right";
      if (paused) { // host only: opponent went quiet mid-match
        g.fillStyle = "#e3b34a";
        g.fillText("Opponent away…", 472, 100);
      } else {
        g.fillStyle = "#cdd6e8";
        g.fillText("A/D · ← →", 472, 100);
      }
    }

    g.restore();
    scoreTex.needsUpdate = true;
  }
  // Blend a hex colour toward white by t in [0,1] (cheap, allocation-light).
  function mixToWhite(hex, t) {
    const c = hex.replace("#", "");
    const r = parseInt(c.slice(0, 2), 16), gg = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const m = (v) => Math.round(v + (255 - v) * t);
    return "rgb(" + m(r) + "," + m(gg) + "," + m(b) + ")";
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  buildScoreboard();

  function clampPaddle(x) {
    // Keep the paddle's rendered outer face inside the rail's inner face: clamp by
    // PADDLE_HALF (ball-collision extent) plus the rail half-width margin so the gold
    // rail can never poke through the paddle at full travel. The tiny margin doesn't
    // change ball/paddle collision since the ball still reflects off the wall first.
    const m = PADDLE_HALF + PADDLE_WALL_MARGIN;
    return Math.max(m, Math.min(W - m, x));
  }

  // ----- serve / match flow -----
  function serve(dir) {
    ball.x = W / 2;
    ball.y = H / 2;
    const ang = Math.random() * 0.7 - 0.35; // lateral spread
    // dir = +1 toward GUEST (y increasing), -1 toward HOST.
    ball.vy = dir * BALL_START * Math.cos(ang);
    ball.vx = BALL_START * Math.sin(ang);
    serveDir = dir;
  }

  function startMatch() {
    if (phase !== "lobby") return;
    phase = "play";
    paused = false;
    rematchAt = 0;
    winner = null;
    scoreA = scoreB = 0;
    serve(Math.random() < 0.5 ? 1 : -1);
    paintScore();
    // Stream the serve immediately so the guest's lobby->play transition is crisp
    // instead of waiting up to one SEND_HZ tick (otherwise the guest briefly shows a
    // centred lobby ball after the host has already served).
    pushState();
  }

  // ----- host physics -----
  function physics(dt) {
    // host's own paddle (A) from local input
    const myDir = localDirCanonical();
    pA = clampPaddle(pA + myDir * PADDLE_SPEED * dt);
    // guest paddle (B): integrate guest intent under the SAME speed (authoritative)
    pB = clampPaddle(pB + guestDir * PADDLE_SPEED * dt);

    if (phase !== "play") return;

    const prevY = ball.y;
    const prevX = ball.x;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // lateral walls — bump a synced wallSeq so every viewer flashes the same rail.
    if (ball.x < BALL_R) {
      ball.x = BALL_R; ball.vx = Math.abs(ball.vx);
      wallSeq = (wallSeq + 1) & 0xffff; triggerWall("L");
    }
    if (ball.x > W - BALL_R) {
      ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx);
      wallSeq = (wallSeq + 1) & 0xffff; triggerWall("R");
    }

    // paddle crossings along the court-length (y) axis.
    // A at y=HOST_Y (ball moving -y crosses it), B at y=GUEST_Y (ball moving +y).
    const tryPaddle = (py, px, dirToward) => {
      // dirToward: +1 if this paddle is the FAR (guest) end the ball heads to with
      // +vy; -1 for host end. crossing when ball passes py from outside-in.
      const crossed = dirToward < 0
        ? (prevY >= py && ball.y <= py)   // host end (low y)
        : (prevY <= py && ball.y >= py);  // guest end (high y)
      if (!crossed) return false;
      // Test lateral overlap at the EXACT crossing point (interpolate ball.x to
      // y=py) rather than at the post-step position. At high speed the ball can move
      // several units laterally per frame; sampling the swept crossing x prevents a
      // one-frame mis-hit / tunnel near a paddle edge.
      const denom = ball.y - prevY;
      const tCross = Math.abs(denom) > 1e-6 ? (py - prevY) / denom : 1;
      const xAt = prevX + (ball.x - prevX) * Math.max(0, Math.min(1, tCross));
      if (Math.abs(xAt - px) <= PADDLE_HALF + BALL_R) {
        const rel = Math.max(-1, Math.min(1, (xAt - px) / PADDLE_HALF)); // -1..1
        const ang = rel * MAX_BOUNCE;
        let speed = Math.hypot(ball.vx, ball.vy) * SPEEDUP;
        speed = Math.min(speed, BALL_MAX);
        // reflect off the end: vy reverses to point back into court
        const outYSign = dirToward < 0 ? 1 : -1; // host paddle sends ball +y, guest -y
        ball.vy = outYSign * speed * Math.cos(ang);
        ball.vx = speed * Math.sin(ang);
        ball.x = xAt; // resolve to the crossing point so the bounce reads true
        ball.y = py + outYSign * (BALL_R + 0.01);
        // Re-clamp lateral bounds after the paddle reflect rewrites ball.x/ball.vx
        // so a near-wall hit can never leave the ball penetrating the side rail.
        if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
        else if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); }
        // One-shot hit flourish: bump the synced counter so every viewer pops the
        // ball + paddle on the same reflect; locally trigger it now for the host.
        // dirToward<0 = host paddle (side A) struck, else guest paddle (side B).
        hitSeq = (hitSeq + 1) & 0xffff;
        triggerHit(dirToward < 0 ? "A" : "B");
        return true;
      }
      return false;
    };
    tryPaddle(HOST_Y, pA, -1);
    tryPaddle(GUEST_Y, pB, 1);

    // scoring: ball past an end without a hit
    if (ball.y < -2) { scoreB++; afterPoint(); }       // passed host end -> B scores
    else if (ball.y > H + 2) { scoreA++; afterPoint(); } // passed guest end -> A scores
  }

  function afterPoint() {
    // Who scored this point (ball.y<-2 => host end passed => B scored).
    const scorer = ball.y < H / 2 ? "B" : "A";
    scoreSeq = (scoreSeq + 1) & 0xffff;
    triggerScore(scorer);
    if (scoreA >= TARGET || scoreB >= TARGET) {
      phase = "over";
      winner = scoreA > scoreB ? "A" : "B";
      // Park the ball at centre so host/guest/spectator all rest in the same place
      // (instead of frozen at the scoring overshoot off the end of the court).
      ball.x = W / 2; ball.y = H / 2; ball.vx = 0; ball.vy = 0;
      // Schedule an automatic return to the lobby so a finished court isn't dead
      // forever — the guest-presence gate then re-serves a fresh match.
      rematchAt = nowMs() + REMATCH_MS;
      triggerWin();
      paintScore();
      try { ctx.onGameOver({ winner: winner === "A" ? "host" : "guest", reason: "score" }); } catch { /* */ }
    } else {
      // loser serves toward the winner-of-point's opponent: serve toward whoever
      // just conceded so play resumes from centre. ball.y<-2 means the HOST end was
      // passed (host conceded) -> serve toward the host end (dir -1); ball.y>H+2
      // means the guest conceded -> serve +1.
      serve(ball.y < H / 2 ? -1 : 1);
    }
    paintScore();
    // Stream the new ball/score immediately so the guest sees a crisp point/serve
    // transition rather than the stale pre-point ball for up to one SEND_HZ tick.
    pushState();
  }

  // ----- flourish triggers (local; counters in the snapshot keep all viewers synced) -----
  function triggerHit(side) { hitAt = nowMs(); tintAt = hitAt; hitSide = side || null; }
  function triggerWall(side) { wallAt = nowMs(); wallSide = side || null; }
  function triggerWin() { winFlashAt = nowMs(); }
  function triggerScore(side) {
    scoreFlashAt = nowMs();
    scoreFlashSide = side;
  }
  // Repaint the score canvas only while a digit pop is animating, then once more to
  // settle (so the canvas isn't redrawn every frame the rest of the time).
  function repaintFlash() {
    if (!scoreFlashAt) return;
    if (nowMs() - scoreFlashAt >= SCORE_POP_MS) { scoreFlashAt = 0; paintScore(); return; }
    paintScore();
  }

  // ----- snapshot / state -----
  function snapshot() {
    return {
      phase, winner,
      bx: ball.x, by: ball.y, bvx: ball.vx, bvy: ball.vy,
      pA, pB, sA: scoreA, sB: scoreB,
      // Mid-match pause flag so a non-host viewer can (a) freeze its predicted paddle
      // instead of drifting against a frozen authority and (b) show "Opponent away…"
      // instead of a silently-frozen ball. Backward-compatible: older/absent => false.
      paused,
      // One-shot flourish counters: a guest/spectator pops the ball/score/wall when
      // these change vs the last applied value. Pure cosmetics; never affect sim.
      hit: hitSeq, scr: scoreSeq, scrSide: scoreFlashSide,
      wall: wallSeq, wallSide,
    };
  }
  function pushState() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }
  function publicState() { return snapshot(); }

  // ----- render (each client -> its own local-view frame) -----
  function render() {
    // paddle Z positions: A always at canonical y=HOST_Y, B at GUEST_Y. fZ flips
    // for the guest so ITS OWN paddle (B) lands near (-Z).
    padA.position.set(fX(pA), padA.position.y, fZ(HOST_Y));
    if (isHost) {
      padB.position.set(fX(pB), padB.position.y, fZ(GUEST_Y));
    } else if (isGuest) {
      // render own paddle (B) from local prediction for responsiveness
      padB.position.set(fX(myPredX), padB.position.y, fZ(GUEST_Y));
    } else {
      padB.position.set(fX(pB), padB.position.y, fZ(GUEST_Y));
    }

    // ball — position + canonical velocity (host reads sim, others read view)
    const bx = isHost ? ball.x : view.x;
    const by = isHost ? ball.y : view.y;
    const bvx = isHost ? ball.vx : view.vx;
    const bvy = isHost ? ball.vy : view.vy;
    const bX = fX(bx), bZ = fZ(by);
    const now = nowMs();
    const speed = Math.hypot(bvx, bvy);
    // Hit pop: an eased squash-and-rebound on a paddle reflect (1 -> 1.32 -> 1).
    let pop = 1;
    if (hitAt) {
      const h = (now - hitAt) / HIT_POP_MS;
      if (h >= 1) { hitAt = 0; }
      else {
        // ease-out hump: rises fast, settles back to 1 (sin gives a smooth 0->1->0)
        pop = 1 + 0.32 * Math.sin(Math.min(1, h) * Math.PI);
      }
    }
    // Idle/lobby attract: when the ball is parked (lobby/over, ~zero speed) give it a
    // gentle local bob + slow spin so a waiting court feels alive. Purely cosmetic —
    // never touches sim/view, identical-ish for all viewers (keyed off shared speed).
    let bobY = 0;
    if (phase !== "play" && speed < 1) {
      // Upward-biased bob (0 -> +) so the down-swing never sinks the ball into the
      // plank — the ball only has ~1 mm of floor clearance at rest.
      bobY = (0.5 + 0.5 * Math.sin(now / 620)) * BALL_RADIUS * 0.5;
      ballMesh.rotation.y = now / 1400;
    } else {
      ballMesh.rotation.y = 0;
    }
    // Keep the ball's BOTTOM tangent to the plank during the hit pop: a uniform up-scale
    // by `pop` would drop the lower hemisphere through the floor, so lift the center by
    // BALL_RADIUS*(pop-1) to anchor the bottom (no-op when pop === 1).
    ballMesh.position.set(bX, BALL_Y + bobY + BALL_RADIUS * (pop - 1), bZ);
    // Speed-line stretch: scale the ball along its travel axis as it speeds up so fast
    // volleys read with motion. Stretch factor eases from 1 (slow) up to ~1.5 at BALL_MAX,
    // squashed on the cross axis to conserve volume. Applied via a per-axis world scale
    // by rotating the stretch into the local-view X/Z plane.
    if (phase === "play" && speed > BALL_START * 1.2) {
      const st = Math.min(1, (speed - BALL_START) / (BALL_MAX - BALL_START));
      const along = 1 + 0.5 * st, across = 1 - 0.18 * st;
      // travel direction in LOCAL view space (apply the same axis flips as fX/fZ)
      const dirX = (viewFlip ? -bvx : bvx);
      const dirZ = (viewFlip ? -bvy : bvy);
      const len = Math.hypot(dirX, dirZ) || 1;
      const ux = dirX / len, uz = dirZ / len;
      // scale = across*I + (along-across)*(u u^T) on the XZ plane; Y stays at pop
      ballMesh.scale.set(
        pop * (across + (along - across) * ux * ux),
        pop,
        pop * (across + (along - across) * uz * uz),
      );
    } else {
      ballMesh.scale.setScalar(pop);
    }
    // Last-touch tint: for ~LASTTOUCH_MS after a hit, blend the ball's emissive toward
    // the color of the paddle that struck it so players can read whose shot is incoming.
    // Keyed off its own window (tintAt) so it outlives the shorter squash pop.
    const tintT = (tintAt && hitSide) ? Math.max(0, 1 - (now - tintAt) / LASTTOUCH_MS) : 0;
    if (tintT > 0) {
      M.ball.emissive.set(hitSide === "A" ? PALETTE.pongLeft : PALETTE.pongRight);
      M.ball.emissive.lerp(WHITE_C, 1 - tintT); // tinted at t=1, white as it decays
      M.ball.emissiveIntensity = 0.55 + 0.5 * tintT;
    } else {
      if (tintAt) tintAt = 0;
      M.ball.emissive.set("#ffffff");
      M.ball.emissiveIntensity = 0.55;
    }
    // soft contact shadow tracks the ball; grows a touch with the pop
    ballShadow.position.x = bX;
    ballShadow.position.z = bZ;
    ballShadow.scale.setScalar(pop);

    // Ball motion trail: lay ghost spheres behind the ball along its travel axis,
    // fading with distance, only on fast play. Hidden when slow/parked.
    if (phase === "play" && speed > BALL_START * 1.1) {
      const len = speed || 1;
      const ux = (viewFlip ? -bvx : bvx) / len;
      const uz = (viewFlip ? -bvy : bvy) / len;
      const fade = Math.min(1, (speed - BALL_START) / (BALL_MAX - BALL_START) + 0.35);
      for (let i = 0; i < TRAIL_N; i++) {
        const g = trail[i];
        const back = (i + 1) * BALL_RADIUS * 1.5;
        g.position.set(bX - ux * back, BALL_Y, bZ - uz * back);
        g.scale.setScalar((1 - (i + 1) / (TRAIL_N + 1)) * fade);
        g.visible = true;
      }
    } else {
      for (let i = 0; i < TRAIL_N; i++) trail[i].visible = false;
    }

    // Win celebration progress (0..1 over WIN_RING_MS); 0 when not celebrating.
    let winT = 0;
    const celebrating = phase === "over" && winFlashAt && (now - winFlashAt) < WIN_RING_MS;
    if (celebrating) winT = (now - winFlashAt) / WIN_RING_MS;
    else if (winFlashAt && phase !== "over") winFlashAt = 0; // clear on phase exit

    // identity halo follows MY paddle (which is always at -Z near edge)
    if (myHalo && myColor) {
      const myMesh = mySide === "A" ? padA : padB;
      myHalo.position.x = myMesh.position.x;
      myHalo.position.z = myMesh.position.z;
      const t = now / 1000;
      let mineI = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3));
      // If I'm the winner, flash my home cue gold-bright in time with the celebration.
      if (celebrating && ((winner === "A" && mySide === "A") || (winner === "B" && mySide === "B"))) {
        mineI = 0.8 + 0.8 * (0.5 + 0.5 * Math.sin(now / 90));
      }
      M.mine.emissiveIntensity = mineI;
    }
    // steady opponent grounding ring: for a seated player it follows the OPP paddle
    // (the +Z far one); for a spectator we hide it (both paddles already coloured).
    if (oppRing) {
      if (isSpectator) {
        oppRing.visible = false;
      } else {
        oppRing.visible = !!oppColor;
        const oppMesh = mySide === "A" ? padB : padA;
        oppRing.position.x = oppMesh.position.x;
        oppRing.position.z = oppMesh.position.z;
      }
    }

    // brief paddle emissive spike on a hit, on whichever paddle the ball is nearest
    if (hitAt) {
      const spike = 0.35 + 0.5 * pop;
      // ball near host end -> padA hit; near guest end -> padB hit (view-frame safe
      // because we compare canonical by, not the rendered z).
      if (by < H / 2) { M.colorA.emissiveIntensity = spike; M.colorB.emissiveIntensity = 0.35; }
      else { M.colorB.emissiveIntensity = spike; M.colorA.emissiveIntensity = 0.35; }
    } else {
      M.colorA.emissiveIntensity = 0.35;
      M.colorB.emissiveIntensity = 0.35;
    }

    // Win celebration: a rising emissive pulse on the WINNER's paddle (everyone sees
    // the same paddle glow since winner is in the snapshot) + an expanding gold ring
    // on the floor at the winner's end. All local, gated on phase==="over".
    if (celebrating && winner) {
      const pulse = 0.6 + 1.0 * (0.5 + 0.5 * Math.sin(now / 90)) * (1 - winT * 0.4);
      if (winner === "A") M.colorA.emissiveIntensity = pulse;
      else M.colorB.emissiveIntensity = pulse;
      // Expanding fading ring centred on the court (stays within the table radius as
      // it grows). The winner READ comes from the paddle pulse above; the ring is a
      // shared "match won" burst all three viewers see identically.
      const ease = 1 - Math.pow(1 - winT, 2); // ease-out
      winRing.position.set(0, winRing.position.y, 0);
      winRing.scale.setScalar(0.05 + ease * 0.28); // outer radius 0.05 -> 0.33 m
      M.winRing.opacity = 0.7 * (1 - winT);
      winRing.visible = true;
    } else {
      winRing.visible = false;
      if (M.winRing.opacity !== 0) M.winRing.opacity = 0;
    }

    // Wall-bounce spark: a one-shot gold flash on the rail the ball just struck.
    // Each rail owns its own material clone so only the hit rail brightens. The
    // canonical side ("L"=x0, "R"=xW) maps to a LOCAL rail mesh: in the guest's
    // 180°-flipped view, canonical x0 renders on the +X (wallR) mesh, so swap.
    if (wallAt) {
      const wt = (now - wallAt) / WALL_POP_MS;
      if (wt >= 1) { wallAt = 0; M.lineL.emissiveIntensity = 0.25; M.lineR.emissiveIntensity = 0.25; }
      else {
        const flash = 0.25 + 1.1 * Math.sin(Math.min(1, wt) * Math.PI);
        // local mesh that should light: "L" canonical -> wallL unless flipped
        const litIsLocalL = viewFlip ? (wallSide === "R") : (wallSide === "L");
        M.lineL.emissiveIntensity = litIsLocalL ? flash : 0.25;
        M.lineR.emissiveIntensity = !litIsLocalL && wallSide ? flash : 0.25;
      }
    }
  }

  // ----- per-frame update -----
  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.05); // clamp big stalls

    if (isHost) {
      const now = nowMs();
      // Guest-departure gate: once a guest has been seen, if no steering intent has
      // arrived for GUEST_TIMEOUT_MS the opponent has gone quiet/left. Freeze the
      // ball at centre and don't advance the score; resume on the next intent. This
      // mirrors the empty-seat lobby gate but for a mid-match departure.
      const guestStale = guestSeen && (now - lastGuestInputAt > GUEST_TIMEOUT_MS);
      if (phase === "play" && guestStale && !paused) {
        paused = true;
        ball.x = W / 2; ball.y = H / 2; ball.vx = 0; ball.vy = 0;
        paintScore();
      } else if (paused && !guestStale) {
        // opponent returned: re-serve toward them and resume
        paused = false;
        serve(serveDir || 1);
        paintScore();
      }
      // Rematch: a finished match auto-returns to the lobby after a beat so the
      // court isn't dead forever; the guest-presence gate then serves a new game.
      if (phase === "over" && rematchAt && now >= rematchAt) {
        rematchAt = 0;
        phase = "lobby"; winner = null;
        scoreA = scoreB = 0;
        ball.x = W / 2; ball.y = H / 2; ball.vx = 0; ball.vy = 0;
        paintScore();
        pushState();
      }
      // Stay in 'lobby' (ball centred, no scoring, 'Waiting...' shown) until a
      // guest is actually present, so the host can't rack up points against an
      // empty seat before an opponent connects.
      if (phase === "lobby" && guestSeen && !guestStale) startMatch();
      if (!paused) physics(dt);
      else { // keep paddles tracking input even while paused, but don't move the ball
        const myDir = localDirCanonical();
        pA = clampPaddle(pA + myDir * PADDLE_SPEED * dt);
      }
      sendAcc += dt;
      if (sendAcc >= 1 / SEND_HZ) { sendAcc = 0; pushState(); }
      repaintFlash();
      render();
      return;
    }

    if (isGuest) {
      const dir = localDirCanonical();
      if (paused) {
        // Host has frozen physics (opponent-away mid-match): its authoritative pB is
        // not advancing, so STOP predicting and pin to authority. Otherwise local
        // input would creep myPredX away from a frozen pB and visibly rubber-band.
        if (Number.isFinite(pB)) myPredX = pB;
      } else {
        // local prediction
        myPredX = clampPaddle(myPredX + dir * PADDLE_SPEED * dt);
        // reconcile toward authoritative pB
        if (Number.isFinite(pB)) {
          const gap = pB - myPredX;
          if (Math.abs(gap) > RESEED_DIST) myPredX = pB;
          // Dead-zone: skip the ease when settled & idle so a stationary paddle stops
          // dead instead of asymptotically creeping toward a slightly-lagged authority.
          else if (dir !== 0 || Math.abs(gap) > PADDLE_DEADZONE) {
            myPredX = clampPaddle(myPredX + gap * Math.min(1, dt * RECONCILE_RATE));
          }
        }
      }
      // stream intent (canonical dir) on change or throttle tick. Keep streaming even
      // while paused so the host's presence gate sees us and un-pauses on our return.
      inputAcc += dt;
      if (dir !== lastSentDir || inputAcc >= 0.05) {
        inputAcc = 0;
        lastSentDir = dir;
        try { ctx.net.sendInput({ dir }); } catch { /* */ }
      }
    }

    // guest + spectator: dead-reckon ball + ease toward authority
    if (phase === "play") {
      view.x += view.vx * dt;
      view.y += view.vy * dt;
      if (auth) {
        const age = Math.min(0.25, (nowMs() - lastStateAt) / 1000);
        const ax = auth.x + auth.vx * age;
        const ay = auth.y + auth.vy * age;
        const k = Math.min(1, dt * RECONCILE_RATE);
        view.x += (ax - view.x) * k;
        view.y += (ay - view.y) * k;
      }
    }
    repaintFlash();
    render();
  }

  // ----- host receives guest steering intent -----
  function onInput(input, byRole) {
    if (!isHost || byRole !== "guest" || !input) return;
    // Every guest intent (sent on a ~50ms throttle even when idle) refreshes the
    // presence timestamp, which drives both the empty-seat lobby gate and the
    // mid-match departure gate.
    lastGuestInputAt = nowMs();
    // First guest signal of any kind means an opponent is seated: release the
    // lobby gate so the host may serve. If we were still showing 'Waiting...',
    // refresh the placard once the gate clears (startMatch repaints on serve).
    if (!guestSeen) { guestSeen = true; if (phase === "lobby") paintScore(); }
    if (Number.isFinite(input.dir)) {
      guestDir = input.dir > 0 ? 1 : input.dir < 0 ? -1 : 0;
    }
  }

  // ----- apply authoritative state (guest / spectator) -----
  function applyState(state) {
    if (!state) {
      phase = "lobby"; winner = null;
      scoreA = scoreB = 0;
      ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
      pA = pB = W / 2; myPredX = W / 2;
      view = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
      auth = null;
      paused = false; rematchAt = 0;
      hitAt = 0; tintAt = 0; hitSide = null; wallAt = 0; wallSide = null; winFlashAt = 0;
      scoreFlashAt = 0; scoreFlashSide = null;
      seenHitSeq = 0; seenScoreSeq = 0; seenWallSeq = 0;
      paintScore();
      render();
      return;
    }
    // NEVER recompute local role/side from the wire.
    if (isHost) return;

    const prevPhase = phase;
    phase = state.phase || "play";
    winner = state.winner || null;
    scoreA = state.sA | 0;
    scoreB = state.sB | 0;
    // Mirror the host's pause flag so the placard/prediction match (absent => false).
    paused = !!state.paused;
    if (Number.isFinite(state.pA)) pA = state.pA;
    if (Number.isFinite(state.pB)) pB = state.pB;

    // One-shot flourishes: replay the host's hit/score/wall pops when their counters
    // advance, so guest + spectator animate identically. Pure cosmetics.
    if (Number.isFinite(state.hit) && state.hit !== seenHitSeq) {
      seenHitSeq = state.hit;
      // Derive which paddle hit from the freshly-reflected ball y (the host parks it
      // right at the struck paddle): low y = host (A), high y = guest (B). No new wire.
      triggerHit(Number.isFinite(state.by) && state.by < H / 2 ? "A" : "B");
    }
    if (Number.isFinite(state.scr) && state.scr !== seenScoreSeq) {
      seenScoreSeq = state.scr;
      triggerScore(state.scrSide || null);
    }
    if (Number.isFinite(state.wall) && state.wall !== seenWallSeq) {
      seenWallSeq = state.wall;
      triggerWall(state.wallSide || null);
    }
    // Match-over celebration: fire once when the phase transitions into "over" so
    // guest + spectator run the same win flourish the host already started.
    if (prevPhase !== "over" && phase === "over") triggerWin();

    auth = { x: state.bx, y: state.by, vx: state.bvx, vy: state.bvy };
    // On a non-play phase (lobby / over) the ball isn't being integrated, so snap
    // the view straight to authority and stop dead — otherwise a stale dead-reckoned
    // ball hangs in a corner while the placard reads WIN/LOSE.
    if (phase !== "play") {
      view.x = auth.x; view.y = auth.y; view.vx = 0; view.vy = 0;
    } else {
      const gap = Math.hypot(auth.x - view.x, auth.y - view.y);
      // Snap (not ease) on a large discontinuity, when starting from rest, or right
      // after a serve/lobby->play transition so the new serve reads crisply.
      if (gap > RESEED_DIST || (view.vx === 0 && view.vy === 0) || prevPhase !== "play") {
        view.x = auth.x; view.y = auth.y;
      }
      view.vx = auth.vx; view.vy = auth.vy;
    }
    lastStateAt = nowMs();

    paintScore();
    render();
  }

  // ----- misc contract methods -----
  function onPointer() { /* real-time: keyboard only */ }
  function applyMove() { return true; }
  function setRole(r) {
    // board.js InWorldBoard.setRole() performs an IN-PLACE role change (it calls
    // instance.setRole without remounting). We therefore RECOMPUTE all
    // view-critical identity from the new role — still derived ONLY from role,
    // never from the wire — so a watcher transitioned spectator<->seat (or
    // host<->guest) cannot keep a stale orientation/colour and render the court
    // mirror-flipped or its halo on the wrong paddle.
    const next = r || "spectator";
    if (next === role) return;
    role = next;
    isHost = role === "host";
    isGuest = role === "guest";
    isSpectator = !isHost && !isGuest;

    mySide = isHost ? "A" : isGuest ? "B" : null;
    myColor = mySide === "A" ? PALETTE.pongLeft : mySide === "B" ? PALETTE.pongRight : null;
    oppColor = mySide === "A" ? PALETTE.pongRight : mySide === "B" ? PALETTE.pongLeft : null;
    viewFlip = isGuest;
    viewSign = viewFlip ? -1 : 1;

    // refresh the identity cue (colour + visibility) for the new seat
    if (M.mine) {
      const hex = myColor || PALETTE.pongLeft;
      M.mine.color?.set?.(hex);
      M.mine.emissive?.set?.(hex);
      M.mine.needsUpdate = true;
    }
    // refresh the opponent grounding ring colour for the new seat
    if (M.oppRing) {
      const oh = oppColor || PALETTE.pongRight;
      M.oppRing.color?.set?.(oh);
      M.oppRing.emissive?.set?.(oh);
      M.oppRing.needsUpdate = true;
    }
    if (homeStrip) homeStrip.visible = !!myColor;
    if (myHalo) myHalo.visible = !!myColor;
    if (oppRing) oppRing.visible = !!oppColor && !isSpectator;
    // a host taking the seat (e.g. spectator->host promotion) should start the
    // presence gate fresh so it doesn't immediately think the guest is stale.
    if (isHost) lastGuestInputAt = nowMs();

    // attach/detach key listeners to match the new role (only guests steer)
    if (isGuest) attachKeys(); else detachKeys();

    // a freshly-seated client should drive its own paddle from a sane base
    if (isGuest && Number.isFinite(pB)) myPredX = pB;

    paintScore();
    render();
  }
  function setSeatRy(r) {
    // self-oriented: we own facing, so a seat change must re-rotate the group to
    // keep THIS player's own end at the near (-Z) edge.
    seatRy = r;
    applyFacing();
    render();
  }

  function dispose() {
    detachKeys();
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  // Rotate the group for THIS seat (orientPolicy:"self" => board.js won't).
  function applyFacing() {
    group.rotation.y = orientFor(seatRy);
  }

  // initial paint
  lastGuestInputAt = nowMs(); // seed the presence gate so it doesn't read stale pre-join
  applyFacing();
  paintScore();
  render();

  return {
    group,
    orientPolicy: "self", // we own facing; board.js must NOT rotate our group
    // Real-time, snapshot-driven: applyMove is a no-op and spectators render only
    // from streamed state, so board.js must NOT swallow post-move snapshots.
    spectatorAnimates: false,
    applyState,
    applyMove,
    onPointer,
    onInput,
    update,
    publicState,
    setRole,
    setSeatRy,
    dispose,
  };
}

export default createGame;
