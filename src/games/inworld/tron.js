// Light Cycles (Tron) — in-world 3D module (createGame contract). REAL-TIME,
// host-authoritative LOCKSTEP grid. Host ticks the sim every TICK_MS and streams a
// full grid snapshot; guests send only steering intent ({turn}); spectators only
// watch. No interpolation — discrete cells render exactly as the authoritative
// grid says. Best-of-5, first to WIN_SCORE=3 rounds takes the match.
//
// Candidate #1 design notes (distinct approach vs. the original):
//   * ORIENTATION: SELF-ORIENTED (orientPolicy:"self"), like pong.js. The sim runs
//     in one CANONICAL frame (rows along Z); cycles spawn on the NEAR/FAR axis —
//     host's cycle (seat 0) at the NEAR edge (row 4) heading far, guest's (seat 1)
//     at the FAR edge heading near. board.js does NOT rotate our group; instead we
//     map canonical -> a LOCAL-VIEW frame ourselves (gx/gz apply a per-seat 180°
//     view flip for the guest), so THE LOCAL PLAYER'S OWN CYCLE ALWAYS RENDERS NEAR
//     (-Z) and the opponent across at +Z, from BOTH opposite-end chairs. (The
//     earlier FLAT + orientFor(seatRy) approach was wrong: orientFor brings
//     canonical row 0 nearest EVERY viewer, so the guest saw the host's cycle near
//     and steered its own across the table — and a 180° board spin also mirrored
//     the lateral axis, inverting one seat's left/right. Self-orienting fixes both
//     in one frame; see turnIntentFor for the matching steering swap.)
//   * IDENTITY: the local side is derived ONCE from role and never re-read off the
//     wire. The two cycles use clearly distinct colours (cyan vs orange), the
//     LOCAL cycle gets a brighter head + a pulsing halo + a glowing home strip on
//     its own near edge.
//   * STEERING is buffered to the tick boundary (at most one turn per cycle per
//     tick) and a 180° reversal is rejected, so no instant in-place flip.
//   * In-world status: a countdown banner, per-side score pips, and a round/match
//     winner banner — all driven from the synced snapshot, so guests & spectators
//     read the same cues as the host.

import { BOARD_SIZE, PALETTE, meshOf, standard } from "./pieces.js";
import { orientFor } from "./createGame.js";

// Near-square arena so the 90° side-chair rotations still frame cleanly. Rows run
// along the canonical near/far (Z) axis; cols along left/right (X).
const COLS = 30, ROWS = 30;
const TICK_MS = 90;
const WIN_SCORE = 3;
const COUNTDOWN = 3;
const COUNTDOWN_STEP_MS = 750;
const ROUND_GAP_MS = 1900;
// dirs: 0=toward -Z (near), 1=+X (right), 2=+Z (far), 3=-X (left)
const DV = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const turnLeft = (d) => (d + 3) % 4;
const turnRight = (d) => (d + 1) % 4;
const reverse = (d) => (d + 2) % 4;

function makeArena() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
}

// Spawns on the NEAR/FAR axis: seat 0 (host) hugs the near edge driving toward the
// far edge (+Z, dir 2); seat 1 (guest) hugs the far edge driving toward near (-Z,
// dir 0). Centred on X so both have symmetric room.
const SPAWN = [
  { x: Math.floor(COLS / 2), y: 4, dir: 2, colorIdx: 0 },
  { x: Math.floor(COLS / 2), y: ROWS - 5, dir: 0, colorIdx: 1 },
];
function spawnCycles() {
  return SPAWN.map((s) => ({ x: s.x, y: s.y, dir: s.dir, alive: true, colorIdx: s.colorIdx }));
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "tron";

  let role = ctx.role;
  // Live host check — must read the CURRENT role, never a construction-time const,
  // so an in-place promotion (setRole guest -> host when the host leaves) actually
  // starts the sim. update()/pushState() gate on isHost() below.
  const isHost = () => role === "host";

  // Per-viewer seat facing. We declare orientPolicy:"self" (see the return), so
  // board.js does NOT rotate this group — WE own facing. Facing is COMPOSED from
  // two parts (exactly like pong.js): (1) a real group rotation to the physical
  // chair via applyFacing() => group.rotation.y = orientFor(seatRy), which handles
  // ALL FOUR chairs (ry ∈ {0, π, ±π/2}); and (2) the per-seat view flip below
  // (viewSign), which selects which END (host/guest) lands near within that rotated
  // frame. The earlier build drove facing from viewSign ALONE (a ±180° flip), which
  // can never produce the ±90° a side chair needs — so side-chair seats saw the
  // arena rotated 90° from their gaze. seatRy now genuinely drives the render.
  let seatRy = ctx.seatRy;

  // COLOR/SIDE DERIVATION (canonical convention §2). Derived ONCE from ROLE and
  // NEVER recomputed inside applyState() — host = cycle 0 (cyan, near edge, moves
  // first/COLOR_A), guest = cycle 1 (orange, far edge, COLOR_B), spectator = null
  // (read-only). A relayed snapshot can never flip the local player's colour/side.
  // NOTE: these are derived from role but MUST be re-derivable on an in-place role
  // change (setRole), so they are `let`, not `const`. A spectator demoted-from /
  // promoted-to a seat re-binds its identity cues via applyIdentity() in setRole().
  let mySeat = role === "host" ? 0 : role === "guest" ? 1 : null;
  let myColorIdx = mySeat;

  // ---- SELF-ORIENTED view frame (orientPolicy:"self") ----
  // We declare orientPolicy:"self" so board.js does NOT rotate this group (see
  // InWorldBoard._orient). Facing is COMPOSED of two rotations, exactly as pong.js:
  //   (1) applyFacing() rotates the WHOLE group by orientFor(seatRy) to the physical
  //       chair — this is what makes all four chairs (ry ∈ {0, π, ±π/2}) correct.
  //   (2) the view flip below renders canonical coords so THE LOCAL PLAYER'S OWN
  //       CYCLE IS ALWAYS ON THE NEAR (-Z) EDGE of that rotated frame, the opponent
  //       across at +Z. Seat 0 (host) spawns near (-Z) so it renders canonical
  //       directly (viewSign +1); seat 1 (guest) spawns far (+Z) so we apply a 180°
  //       view flip about table centre (both X and Z negate, viewSign -1) to bring
  //       its OWN cycle near. Spectators take the canonical/host view.
  // Both the group rotation AND the 180° view flip are proper rotations (chirality-
  // preserving), so left/right steering stays self-consistent for both seats from
  // every chair (see turnIntentFor below).
  let viewFlip = mySeat === 1;
  let viewSign = viewFlip ? -1 : 1;
  // Rotate the whole group to THIS seat's chair (orientPolicy:"self" => board.js
  // won't). Composes with the viewSign flip above; called at construction and on
  // any in-place seat/role change.
  function applyFacing() { group.rotation.y = orientFor(seatRy); }
  // STEERING handedness. In the self-oriented frame the viewer always looks from
  // the near (-Z) edge toward +Z(local), so the camera's screen-LEFT world axis is
  // local +X and screen-RIGHT is local -X. The canonical turn helpers
  // (turnLeft=(d+3)%4 / turnRight=(d+1)%4) compose with the gx/gz view mapping —
  // which already bakes in the per-seat handedness via viewSign — so a physical
  // "left" press maps DIRECTLY to canonical turnLeft and "right" to turnRight for
  // BOTH seats and ALL FOUR chairs. (Verified: with viewSign+1 host dir2->turnLeft
  // gives local +X = screen-left; with viewSign-1 guest dir0->turnLeft gives local
  // +X = screen-left too. The prior swap double-counted the flip already in viewSign
  // and inverted steering for everyone — this matches pong.js, which converts intent
  // with viewSign alone and NO name swap.) Identity here; the host trusts the
  // guest's intent verbatim in onInput.
  const turnIntentFor = (physical) => physical;

  // ---- authoritative / mirrored game state ----
  let grid = makeArena();
  let cycles = spawnCycles();
  let scores = [0, 0];
  let round = 1;
  let phase = "countdown"; // countdown|playing|roundover|matchover
  let countdown = COUNTDOWN;
  let roundWinner = null;   // 0|1|null(draw)
  let matchWinner = null;   // 0|1|null

  // host timers
  let tickAcc = 0;
  let countdownAcc = 0;
  let gapAcc = 0;
  const pendingTurn = [null, null];

  // ---- input — gated to a SEATED, non-spectator local player only (§4) ----
  // Real-time, so there is no turn alternation, but a spectator / unseated /
  // finished viewer must never steer. isLocalTurnAllowed() (board.js) confirms
  // we're seated at this table and the match isn't over.
  const onKeyDown = (e) => {
    if (role === "spectator" || mySeat == null) return;
    try { if (ctx.isLocalTurnAllowed && !ctx.isLocalTurnAllowed()) return; } catch { /* */ }
    let t = null;
    if (e.code === "ArrowLeft" || e.code === "KeyA") t = "left";
    else if (e.code === "ArrowRight" || e.code === "KeyD") t = "right";
    if (!t) return;
    // Convert the physical key to a per-seat turn-intent in our self-oriented view
    // (see turnIntentFor): a physical "left" must veer the LOCAL cycle toward the
    // local screen-left from BOTH chairs. We buffer (host) or stream (guest) the
    // already-swapped intent; onInput trusts the guest's swapped value.
    const eff = turnIntentFor(t);
    e.preventDefault?.();
    if (isHost()) hostTurn(0, eff);
    else { try { ctx.net.sendInput({ turn: eff }); } catch { /* */ } }
  };
  window.addEventListener("keydown", onKeyDown);

  // ---- geometry / materials ----
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const COLORS = [PALETTE.tron0, PALETTE.tron1];
  let myColor = myColorIdx != null ? COLORS[myColorIdx] : null;

  // IDENTITY CUE materials (myHead/mine) depend on which seat is local, so they are
  // (re)built lazily in buildIdentityMaterials() and swapped on an in-place role
  // change. The two per-seat colours (t0/t1/head0/head1) are seat-fixed and built
  // once. Identity materials are tracked in `ownedIdentity` so a rebuild can dispose
  // the prior pair without leaking.
  const ownedIdentity = [];
  // Base trail glow (I4): nudged up from 0.55 so the OPPONENT's far-edge trail
  // doesn't wash out under the pendant lamp from a low seated eye. Both sides share
  // it so neither seat sees its opponent as dim. The win flourish (I2) pulses
  // ABOVE this base and resets back to it each frame.
  const TRAIL_GLOW = 0.7;
  const M = {
    floor: keep(standard(THREE, "#081c2e", { roughness: 0.7 })),
    // Two CLEARLY DISTINCT trail materials: cyan (tron0) vs orange (tron1).
    t0: keep(standard(THREE, COLORS[0], { emissive: COLORS[0], emissiveIntensity: TRAIL_GLOW })),
    t1: keep(standard(THREE, COLORS[1], { emissive: COLORS[1], emissiveIntensity: TRAIL_GLOW })),
    head0: keep(standard(THREE, "#bff7ff", { emissive: COLORS[0], emissiveIntensity: 0.9 })),
    head1: keep(standard(THREE, "#ffe0c0", { emissive: COLORS[1], emissiveIntensity: 0.9 })),
    // IDENTITY CUE: the LOCAL cycle's head out-glows the opponent's; halo + home
    // strip in the local colour. Spectators get none (myColor == null).
    myHead: null,
    mine: null,
    warn: null, // imminent-crash halo (built in buildIdentityMaterials)
    grid: keep(standard(THREE, "#0f2a40", { roughness: 0.85 })),
  };
  function buildIdentityMaterials() {
    // Dispose any prior identity pair (from a previous role) before rebuilding.
    for (const o of ownedIdentity) o.dispose?.();
    ownedIdentity.length = 0;
    if (myColor) {
      M.myHead = standard(THREE, "#ffffff", { emissive: myColor, emissiveIntensity: 1.8 });
      M.mine = standard(THREE, myColor, { emissive: myColor, emissiveIntensity: 0.9, transparent: true, opacity: 0.5, depthWrite: false });
      // IMMINENT-CRASH WARNING halo material (I7): a red variant of the local halo.
      // update() swaps myHalo.material to this and pulses its emissive when the local
      // cycle's NEXT canonical cell is a wall/trail — a purely render-side "you're
      // about to die" cue computed from the synced grid (no authority change). Built
      // here (not in the seat-fixed block) because it's only meaningful for a seated
      // player and must be disposed/rebuilt with the rest of the identity pair.
      M.warn = standard(THREE, "#ff3b30", { emissive: "#ff3b30", emissiveIntensity: 1.2, transparent: true, opacity: 0.6, depthWrite: false });
      ownedIdentity.push(M.myHead, M.mine, M.warn);
    } else {
      M.myHead = null;
      M.mine = null;
      M.warn = null;
    }
  }
  buildIdentityMaterials();

  const AW = BOARD_SIZE * 0.94, AH = AW * (ROWS / COLS);
  const cw = AW / COLS, chh = AH / ROWS;
  const plankH = 0.016;
  const floor = meshOf(THREE, keep(new THREE.BoxGeometry(AW + 0.03, plankH, AH + 0.03)), M.floor);
  floor.position.y = plankH / 2;
  group.add(floor);
  const TOP = plankH;

  // BOUNDARY RAILS (I5): four thin glowing rails framing the lethal grid edge so the
  // kill-walls are READABLE before a crash (matches pong's gold side rails). The
  // perimeter is symmetric, so it's view-flip independent — no gx/gz needed. Dim
  // emissive, castShadow:false, sits just above the floor below the trails.
  const railMat = keep(standard(THREE, "#1a4a66", { emissive: PALETTE.tron0, emissiveIntensity: 0.45, roughness: 0.6 }));
  const halfW = AW / 2, halfH = AH / 2, railT = 0.012, railY = TOP + 0.004;
  const railLong = keep(new THREE.BoxGeometry(AW + railT * 2, 0.01, railT));
  const railSide = keep(new THREE.BoxGeometry(railT, 0.01, AH + railT * 2));
  for (const [geo, x, z] of [
    [railLong, 0, -halfH - railT / 2],
    [railLong, 0, halfH + railT / 2],
    [railSide, -halfW - railT / 2, 0],
    [railSide, halfW + railT / 2, 0],
  ]) {
    const rail = meshOf(THREE, geo, railMat, false);
    rail.position.set(x, railY, z);
    rail.renderOrder = 1;
    group.add(rail);
  }
  // Canonical grid -> local-view world. viewSign applies the per-seat 180° view
  // flip (both axes negate) so the LOCAL player's own cycle/home edge land near
  // (-Z). All cycle/trail/halo/home-strip placement routes through these.
  const gx = (x) => viewSign * (-AW / 2 + (x + 0.5) * cw);
  const gz = (y) => viewSign * (-AH / 2 + (y + 0.5) * chh);

  const cellGeo = keep(new THREE.BoxGeometry(cw * 0.92, 0.012, chh * 0.92));
  // Head fills a full cell (vs 0.98) so the live "cap" reads a touch brighter and
  // wider than the trail it lays — a clearer leading edge for both seats (I4).
  const headGeo = keep(new THREE.BoxGeometry(cw * 1.0, 0.024, chh * 1.0));

  // pool of trail meshes keyed by "x,y"
  const trailMeshes = new Map();
  const HEAD_Y = TOP + 0.014;

  // IDENTITY CUE: the LOCAL cycle's head uses the brighter myHead material.
  // applyHeadMaterials() reassigns these on an in-place role change so the bright
  // local-head cue tracks the current seat (and clears for a demoted spectator).
  // castShadow:false to match the flat-glow aesthetic of the trails/halo/strip —
  // two tiny moving head boxes otherwise throw jittery specks onto the floor.
  const headMeshes = [
    meshOf(THREE, headGeo, M.head0, false),
    meshOf(THREE, headGeo, M.head1, false),
  ];
  for (const h of headMeshes) { h.position.y = HEAD_Y; group.add(h); }
  // RENDER-SIDE head interpolation (I1). The authoritative grid is discrete (snaps
  // each TICK_MS), but the moving head is eased toward its snapshot target every
  // frame so it GLIDES cell-to-cell instead of teleporting. Trails stay discrete
  // (they're authoritative). headTarget holds the latest snapshot world XZ; a fresh
  // spawn / big jump snaps (no long glide across the arena). Reused objects — no
  // per-frame allocation. Same "render eases toward authority" pattern as pong.
  const headTarget = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
  const headPlaced = [false, false];

  // CRASH FLOURISH (I2). On a head transitioning alive->dead (detected from the
  // synced snapshot via wasAlive) we pop a brief expanding emissive ring at its last
  // cell, fading over CRASH_MS. One reusable ring + material per cycle (no per-frame
  // alloc); driven from snapshot state so host/guest/spectator all see it.
  const CRASH_MS = 420;
  const wasAlive = [true, true];
  const crashAt = [-1e9, -1e9]; // local-ms start of each cycle's crash ring
  // Cell-relative ring (one cell-ish base; update() scales it out to ~3 cells).
  const ringR = Math.min(cw, chh);
  const ringGeo = keep(new THREE.RingGeometry(ringR * 0.55, ringR * 0.85, 28));
  const crashMats = [
    keep(standard(THREE, COLORS[0], { emissive: COLORS[0], emissiveIntensity: 1.4, transparent: true, opacity: 0.9, depthWrite: false })),
    keep(standard(THREE, COLORS[1], { emissive: COLORS[1], emissiveIntensity: 1.4, transparent: true, opacity: 0.9, depthWrite: false })),
  ];
  const crashRings = [
    meshOf(THREE, ringGeo, crashMats[0], false),
    meshOf(THREE, ringGeo, crashMats[1], false),
  ];
  for (const r of crashRings) { r.rotation.x = -Math.PI / 2; r.position.y = TOP + 0.009; r.renderOrder = 3; r.visible = false; group.add(r); }
  function applyHeadMaterials() {
    headMeshes[0].material = myColorIdx === 0 && M.myHead ? M.myHead : M.head0;
    headMeshes[1].material = myColorIdx === 1 && M.myHead ? M.myHead : M.head1;
  }
  applyHeadMaterials();

  // IDENTITY CUE: a soft halo that tracks the local cycle, plus a glowing home
  // strip across the local player's own SPAWN edge (near edge after rotation).
  // Geometry is built once and kept; the meshes are (re)created/removed by
  // buildIdentityMeshes() so an in-place role change rebinds them to the new seat.
  const haloGeo = keep(new THREE.BoxGeometry(cw * 2.6, 0.002, chh * 2.6));
  const stripGeo = keep(new THREE.BoxGeometry(AW * 0.96, 0.002, chh * 1.8));
  let myHalo = null, myHomeStrip = null;
  function buildIdentityMeshes() {
    if (myHalo) { group.remove(myHalo); myHalo = null; }
    if (myHomeStrip) { group.remove(myHomeStrip); myHomeStrip = null; }
    if (M.mine && myColorIdx != null) {
      myHalo = meshOf(THREE, haloGeo, M.mine, false);
      // Sit ABOVE the trail cells (TOP+0.007) but below the heads (TOP+0.014) so
      // the "this is me" glow never gets occluded by the local cycle's own freshly
      // laid trail; renderOrder pins it over the floor/trails with depthWrite:false.
      myHalo.position.y = TOP + 0.0085;
      myHalo.renderOrder = 2;
      group.add(myHalo);
      const spawn = SPAWN[myColorIdx];
      myHomeStrip = meshOf(THREE, stripGeo, M.mine, false);
      myHomeStrip.position.set(0, TOP + 0.004, gz(spawn.y));
      group.add(myHomeStrip);
    }
  }
  buildIdentityMeshes();

  // ---- in-world status banner (countdown / round / winner) ----
  // A canvas-textured sprite rendered above the arena centre. Driven entirely by
  // the synced snapshot so host, guests, and spectators all read the same cue.
  let bannerTex = null, bannerMat = null, bannerSprite = null, bannerCanvas = null, bannerCtx = null;
  let lastBannerText = "";
  let lastBannerSub = "";
  // Banner "pop": when the displayed text changes (each countdown tick / GO / a
  // round or match result) we kick a quick overshoot-then-settle scale animation
  // instead of re-uploading the canvas texture every frame. baseScale is captured
  // once; bannerPopAt is the local-ms timestamp of the last text change.
  let bannerBaseX = 0, bannerBaseY = 0, bannerPopAt = -1e9;
  const BANNER_POP_MS = 320;
  (function buildBanner() {
    if (typeof document === "undefined") return; // headless guard
    try {
      bannerCanvas = document.createElement("canvas");
      bannerCanvas.width = 512; bannerCanvas.height = 128;
      bannerCtx = bannerCanvas.getContext("2d");
      bannerTex = new THREE.CanvasTexture(bannerCanvas);
      if ("colorSpace" in bannerTex && THREE.SRGBColorSpace) bannerTex.colorSpace = THREE.SRGBColorSpace;
      owned.push(bannerTex);
      bannerMat = new THREE.SpriteMaterial({ map: bannerTex, transparent: true, depthTest: false, depthWrite: false });
      owned.push(bannerMat);
      bannerSprite = new THREE.Sprite(bannerMat);
      bannerSprite.position.set(0, TOP + 0.16, 0);
      bannerBaseX = AW * 0.7; bannerBaseY = AW * 0.7 * (128 / 512);
      bannerSprite.scale.set(bannerBaseX, bannerBaseY, 1);
      bannerSprite.renderOrder = 999;
      group.add(bannerSprite);
    } catch { bannerSprite = null; }
  })();

  function drawBanner(text, color, sub) {
    if (!bannerCtx || !bannerTex) return;
    const c = bannerCtx;
    c.clearRect(0, 0, bannerCanvas.width, bannerCanvas.height);
    if (text) {
      // With a subtitle the headline shifts up so both lines fit the 128px canvas;
      // without one it stays vertically centred as before.
      const headY = sub ? 46 : 64;
      c.font = "bold 84px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = 10;
      c.strokeStyle = "rgba(0,0,0,0.85)";
      c.strokeText(text, 256, headY);
      c.fillStyle = color || "#ffffff";
      c.fillText(text, 256, headY);
      if (sub) {
        // Persistent score line (I9): a late-arriving spectator reads the running
        // best-of even though the edge pips are easy to miss from a seat.
        c.font = "bold 34px system-ui, sans-serif";
        c.lineWidth = 6;
        c.strokeStyle = "rgba(0,0,0,0.85)";
        c.strokeText(sub, 256, 104);
        c.fillStyle = "#e8eef2";
        c.fillText(sub, 256, 104);
      }
    }
    bannerTex.needsUpdate = true;
  }

  // Running best-of as a short score line, from the LOCAL viewer's perspective
  // (your score first), or canonical CYAN:ORANGE for a spectator. Shown under the
  // round/match banner so the final tally is readable without finding the edge pips.
  function scoreLine() {
    if (myColorIdx == null) return `BEST OF ${WIN_SCORE * 2 - 1}   CYAN ${scores[0] | 0} : ${scores[1] | 0} ORANGE`;
    const mine = scores[myColorIdx] | 0, opp = scores[myColorIdx === 0 ? 1 : 0] | 0;
    return `BEST OF ${WIN_SCORE * 2 - 1}   YOU ${mine} : ${opp} OPP`;
  }

  function bannerFor() {
    // Returns { text, color, sub? }. From the LOCAL player's perspective where
    // relevant. `sub` is an optional persistent second line (the running score).
    if (phase === "countdown") {
      return { text: countdown > 0 ? String(countdown) : "GO", color: "#ffffff" };
    }
    if (phase === "roundover") {
      const sub = scoreLine();
      if (roundWinner == null) return { text: "DRAW", color: "#ffd166", sub };
      const won = myColorIdx != null && roundWinner === myColorIdx;
      return {
        text: myColorIdx == null
          ? `${roundWinner === 0 ? "CYAN" : "ORANGE"} WINS ROUND`
          : (won ? "ROUND: YOU WIN" : "ROUND: YOU LOSE"),
        color: roundWinner === 0 ? COLORS[0] : COLORS[1],
        sub,
      };
    }
    if (phase === "matchover") {
      const w = matchWinner;
      const sub = scoreLine();
      if (w == null) return { text: "MATCH OVER", color: "#ffd166", sub };
      const won = myColorIdx != null && w === myColorIdx;
      return {
        text: myColorIdx == null
          ? `${w === 0 ? "CYAN" : "ORANGE"} WINS!`
          : (won ? "YOU WIN!" : "YOU LOSE"),
        color: w === 0 ? COLORS[0] : COLORS[1],
        sub,
      };
    }
    return { text: "", color: "#ffffff" };
  }

  // ---- score pips ----
  // Small glowing pips on each side edge: cyan near the near edge, orange near the
  // far edge, lit up to the round count so the running best-of is readable in-world.
  // Pip is shallow along the near/far (Z) axis so it tucks into the THIN band of
  // bare floor between the play area edge (AH/2) and the floor plank edge
  // ((AH+0.03)/2) — see PIP_MARGIN below. Width (X) stays generous so the row of
  // pips reads at a glance.
  const pipGeo = keep(new THREE.BoxGeometry(cw * 0.9, 0.01, chh * 0.5));
  const pipOnMat = [
    keep(standard(THREE, COLORS[0], { emissive: COLORS[0], emissiveIntensity: 1.1 })),
    keep(standard(THREE, COLORS[1], { emissive: COLORS[1], emissiveIntensity: 1.1 })),
  ];
  const pipOffMat = keep(standard(THREE, "#22384a", { emissive: "#0a1a26", emissiveIntensity: 0.2 }));
  const pips = [[], []];
  // Place pips just OUTSIDE the play area on each near/far edge so they never
  // share a cell (XZ + height) with cycle trails, heads, or the home strip — those
  // can run across rows 0 / ROWS-1 and z-fight a pip parked on the spawn row. The
  // margin centres the pip in the narrow band of bare floor between the play-area
  // edge (AH/2) and the floor-plank edge ((AH+0.03)/2): with a chh*0.5-deep pip the
  // inner edge stays just past AH/2 (no trail overlap) and the outer edge lands on
  // the plank (no overhang onto bare tabletop). The previous chh*1.2 margin floated
  // the pips ~0.02m past the plank onto the wood, reading as detached from the arena.
  const PIP_MARGIN = chh * 0.34;
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k < WIN_SCORE; k++) {
      const p = meshOf(THREE, pipGeo, pipOffMat, false);
      p.position.y = TOP + 0.01;
      group.add(p);
      pips[side].push(p);
    }
  }
  // SCORE-PIP FILL POP (I8): per-pip local-ms timestamp of when it most recently lit
  // up, plus a cache of the last-seen scores so renderGrid can detect a fresh
  // increment (works on host AND on snapshot-fed guests/spectators). When a pip
  // newly lights, update() kicks a brief scale/emissive overshoot. Render-side only.
  const PIP_POP_MS = 360;
  const pipPopAt = [new Array(WIN_SCORE).fill(-1e9), new Array(WIN_SCORE).fill(-1e9)];
  const prevScores = [0, 0];
  // Pip XZ is view-dependent: side 0 (cyan / host) sits beyond the canonical near
  // edge, side 1 (orange / guest) beyond the far edge. viewSign flips both so the
  // LOCAL player's own-colour pips read on THEIR near side from either chair.
  // Re-run on an in-place role change (setRole) so the flip tracks the new seat.
  function positionPips() {
    for (let side = 0; side < 2; side++) {
      const z = (side === 0 ? -AH / 2 - PIP_MARGIN : AH / 2 + PIP_MARGIN) * viewSign;
      for (let k = 0; k < pips[side].length; k++) {
        const x = (k - (WIN_SCORE - 1) / 2) * cw * 1.4 * viewSign;
        pips[side][k].position.set(x, TOP + 0.01, z);
      }
    }
  }
  positionPips();

  function clearTrails() {
    for (const m of trailMeshes.values()) group.remove(m);
    trailMeshes.clear();
  }

  function renderGrid() {
    // reconcile: ensure a mesh exists for every occupied cell, remove stale.
    const wanted = new Set();
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const v = grid[y][x];
        if (v < 0) continue;
        const key = `${x},${y}`;
        wanted.add(key);
        let m = trailMeshes.get(key);
        if (!m) {
          m = meshOf(THREE, cellGeo, v === 0 ? M.t0 : M.t1, false);
          m.position.set(gx(x), TOP + 0.007, gz(y));
          group.add(m);
          trailMeshes.set(key, m);
        } else {
          m.material = v === 0 ? M.t0 : M.t1;
        }
      }
    for (const [key, m] of trailMeshes) {
      if (!wanted.has(key)) { group.remove(m); trailMeshes.delete(key); }
    }

    const showHeads = phase === "playing" || phase === "countdown" || phase === "roundover";
    for (let i = 0; i < 2; i++) {
      const c = cycles[i];
      headMeshes[i].visible = !!c && c.alive && showHeads;
      if (c) {
        const tx = gx(c.x), tz = gz(c.y);
        // CRASH FLOURISH: fire a ring when this cycle just died (alive->dead). At
        // round reset both come back alive, which re-arms wasAlive without firing.
        if (wasAlive[i] && !c.alive) {
          crashAt[i] = nowMs();
          crashRings[i].position.set(tx, crashRings[i].position.y, tz);
        }
        wasAlive[i] = c.alive;
        // Set the interpolation TARGET; snap on a fresh placement / big jump (round
        // reset, first paint) so the head never glides across the whole arena. The
        // normal cell-to-cell step (<= one cell) is left to update()'s ease.
        const dx = tx - headTarget[i].x, dz = tz - headTarget[i].z;
        const big = !headPlaced[i] || (dx * dx + dz * dz) > (cw * cw + chh * chh) * 4;
        headTarget[i].x = tx; headTarget[i].z = tz;
        if (big) { headMeshes[i].position.set(tx, HEAD_Y, tz); headPlaced[i] = true; }
      } else {
        headPlaced[i] = false;
      }
    }

    if (myColorIdx != null) {
      const me = cycles[myColorIdx];
      // Halo XZ tracks the LOCAL head mesh in update() (eased), so it glides with
      // the head; here we only toggle visibility.
      if (myHalo) myHalo.visible = !!me && me.alive && showHeads;
      // Home strip marks the spawn edge during countdown so the player confirms
      // their starting side, then fades so it doesn't clutter the live arena.
      if (myHomeStrip) myHomeStrip.visible = phase === "countdown";
    }

    // score pips. Detect a fresh increment per side (vs prevScores) and stamp the
    // newly-lit pip(s) so update() can pop them. A reset (applyState(null)) lowers
    // the score; we just resync prevScores without popping.
    for (let side = 0; side < 2; side++) {
      const s = scores[side] | 0;
      const was = prevScores[side] | 0;
      if (s > was) for (let k = was; k < s && k < pips[side].length; k++) pipPopAt[side][k] = nowMs();
      prevScores[side] = s;
      for (let k = 0; k < pips[side].length; k++) {
        pips[side][k].material = k < s ? pipOnMat[side] : pipOffMat;
      }
    }

    // banner. Redraw the canvas ONLY when the text actually changes (the countdown
    // digit changes once per second, the result text once) — no per-frame GPU
    // texture upload. The visual "tick" comes from a sprite-scale pop (see update).
    const b = bannerFor();
    const sub = b.sub || "";
    if (b.text !== lastBannerText || sub !== lastBannerSub) {
      const headlineChanged = b.text !== lastBannerText;
      lastBannerText = b.text;
      lastBannerSub = sub;
      drawBanner(b.text, b.color, sub);
      // Pop only on a headline change (countdown tick / result), not when just the
      // score subtitle updates, so the banner doesn't re-punch on every pip fill.
      if (b.text && headlineChanged) bannerPopAt = nowMs();
    }
    if (bannerSprite) bannerSprite.visible = !!b.text;
  }

  // ---- host sim ----
  // LOCKSTEP steering: an input does NOT mutate dir the instant the packet lands;
  // it is buffered into pendingTurn[seat] (overwriting any earlier turn this tick,
  // so at most one turn per cycle per tick) and applied atomically at the top of
  // the next stepCycles(). This removes sub-tick arrival-time dependence and the
  // two-turns-in-one-tick 180° stack.
  function hostTurn(seat, t) {
    const c = cycles[seat];
    if (!c || !c.alive || phase !== "playing") return;
    if (t !== "left" && t !== "right") return;
    pendingTurn[seat] = t;
  }

  function applyPendingTurns() {
    for (let i = 0; i < cycles.length; i++) {
      const t = pendingTurn[i];
      pendingTurn[i] = null; // consume regardless of outcome — never replays
      const c = cycles[i];
      if (!t || !c || !c.alive) continue;
      const nd = t === "left" ? turnLeft(c.dir) : turnRight(c.dir);
      // A single buffered left/right can't yield a 180° from the committed dir,
      // but verify against the reverse so no path drives the head into its neck.
      if (nd === reverse(c.dir)) continue;
      c.dir = nd;
    }
  }

  function stepCycles() {
    applyPendingTurns();
    const targets = cycles.map((c) => (c.alive ? { x: c.x + DV[c.dir][0], y: c.y + DV[c.dir][1] } : null));

    // wall + existing-trail collisions (evaluated against the pre-move grid)
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i], tg = targets[i];
      if (!c.alive || !tg) continue;
      if (tg.x < 0 || tg.x >= COLS || tg.y < 0 || tg.y >= ROWS) { c.alive = false; continue; }
      if (grid[tg.y][tg.x] >= 0) { c.alive = false; continue; }
    }

    // Head-on collisions, evaluated against PRE-move positions so the outcome is
    // symmetric and order-independent:
    //   (a) shared target — both aim at the same empty cell, and
    //   (b) cell swap     — each aims at the other's current cell (they pass
    //       through one another within a single tick; neither target is filled
    //       yet so the wall check above misses it).
    for (let i = 0; i < cycles.length; i++)
      for (let j = i + 1; j < cycles.length; j++) {
        const a = cycles[i], b = cycles[j], ta = targets[i], tb = targets[j];
        if (!a.alive || !b.alive || !ta || !tb) continue;
        const sharedTarget = ta.x === tb.x && ta.y === tb.y;
        const cellSwap = ta.x === b.x && ta.y === b.y && tb.x === a.x && tb.y === a.y;
        if (sharedTarget || cellSwap) { a.alive = false; b.alive = false; }
      }

    // commit moves for survivors, lay trail at the OLD position
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i];
      if (!c.alive) continue;
      grid[c.y][c.x] = c.colorIdx;
      c.x = targets[i].x;
      c.y = targets[i].y;
      grid[c.y][c.x] = c.colorIdx;
    }
  }

  // RENDER-SIDE danger probe (I7): is the cell DIRECTLY ahead of a cycle a wall or
  // an existing trail? Used only to drive the imminent-crash warning halo — it reads
  // the same synced grid every client already has, mirrors stepCycles' wall/trail
  // test, and never mutates authority. (It can't see a head-on shared-target crash,
  // which is fine — the cue is a "you're driving into a wall" hint, not a predictor.)
  function nextCellBlocked(c) {
    if (!c || !c.alive) return false;
    const nx = c.x + DV[c.dir][0], ny = c.y + DV[c.dir][1];
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return true;
    return grid[ny][nx] >= 0;
  }

  function aliveCount() {
    return cycles.reduce((n, c) => n + (c.alive ? 1 : 0), 0);
  }

  function hostTick(dt) {
    const ms = dt * 1000;
    if (phase === "countdown") {
      countdownAcc += ms;
      while (countdownAcc >= COUNTDOWN_STEP_MS) {
        countdownAcc -= COUNTDOWN_STEP_MS;
        countdown--;
        if (countdown < 0) { phase = "playing"; countdown = 0; tickAcc = 0; }
        pushState();
        if (phase === "playing") break;
      }
      return;
    }
    if (phase === "playing") {
      tickAcc += ms;
      let stepped = false;
      while (tickAcc >= TICK_MS) {
        tickAcc -= TICK_MS;
        stepCycles();
        stepped = true;
        if (aliveCount() <= 1) { endRound(); return; }
      }
      if (stepped) pushState();
      return;
    }
    if (phase === "roundover") {
      gapAcc += ms;
      if (gapAcc >= ROUND_GAP_MS) { gapAcc = 0; beginRound(); pushState(); }
    }
    // matchover: idle (final banner already pushed)
  }

  function endRound() {
    const survivors = cycles.map((c, i) => (c.alive ? i : -1)).filter((i) => i >= 0);
    roundWinner = survivors.length === 1 ? survivors[0] : null;
    if (roundWinner != null) scores[roundWinner]++;
    if (scores[0] >= WIN_SCORE || scores[1] >= WIN_SCORE) {
      phase = "matchover";
      matchWinner = scores[0] >= WIN_SCORE ? 0 : 1;
      try { ctx.onGameOver({ winner: matchWinner === 0 ? "host" : "guest", reason: "match" }); } catch { /* */ }
    } else {
      phase = "roundover";
      gapAcc = 0;
    }
    pushState();
  }

  function beginRound() {
    round++;
    grid = makeArena();
    cycles = spawnCycles();
    roundWinner = null;
    phase = "countdown";
    countdown = COUNTDOWN;
    countdownAcc = 0;
    tickAcc = 0;
    pendingTurn[0] = pendingTurn[1] = null;
  }

  // ---- state wire format ----
  function buildState() {
    let g = "";
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) g += grid[y][x] < 0 ? "." : String(grid[y][x]);
    return {
      phase, cols: COLS, rows: ROWS, grid: g,
      cycles: cycles.map((c) => ({ x: c.x, y: c.y, dir: c.dir, alive: c.alive, colorIdx: c.colorIdx })),
      scores: scores.slice(), round, countdown, roundWinner, matchWinner,
    };
  }
  function publicState() { return buildState(); }

  function pushState() {
    const s = buildState();
    try { ctx.net.sendState(s, s); } catch { /* */ }
    if (isHost()) renderGrid(); // host renders the exact snapshot it sends
  }

  // ---- guest steering inbound (host integrates) ----
  function onInput(input, byRole) {
    if (role !== "host" || byRole !== "guest") return;
    if (input && (input.turn === "left" || input.turn === "right")) hostTurn(1, input.turn);
  }

  function update(dt) {
    if (isHost()) hostTick(dt);

    // ---- render-side cosmetic interpolation (authority untouched) ----
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    const now = nowMs();
    // Smooth cell-to-cell head glide (I1). Tuned to CONVERGE within one TICK_MS:
    // at 60fps a 90ms tick is ~5.4 frames, and 1-(1-dt*22)^5.4 ≈ 0.92, so the eased
    // head reaches ~92% of its target before the next snapshot retargets — it no
    // longer sits a chronic ~1/3 cell behind authority (which made the full-cell head
    // overlap its own freshly-laid 0.92 trail and the crash ring read slightly ahead
    // of where the head stopped). Still pure render-side; authority untouched.
    const ease = Math.min(1, dt * 22);

    // Ease each visible head toward its snapshot target; the local head's halo
    // follows so the "this is me" glow glides with it.
    for (let i = 0; i < 2; i++) {
      const h = headMeshes[i];
      if (!h.visible) continue;
      h.position.x += (headTarget[i].x - h.position.x) * ease;
      h.position.z += (headTarget[i].z - h.position.z) * ease;
    }
    if (myHalo && myHalo.visible && myColorIdx != null) {
      myHalo.position.x = headMeshes[myColorIdx].position.x;
      myHalo.position.z = headMeshes[myColorIdx].position.z;
      // IMMINENT-CRASH WARNING (I7): during live play, if the local cycle's NEXT
      // cell is a wall/trail, swap the halo to the red warn material and pulse it
      // fast; otherwise keep the normal "this is me" halo. Render-side only — read
      // from the synced grid, no authority touched. Spectators (myColorIdx null) and
      // non-playing phases skip this and keep the steady identity glow.
      const danger = phase === "playing" && M.warn && nextCellBlocked(cycles[myColorIdx]);
      myHalo.material = danger ? M.warn : M.mine;
      if (danger) M.warn.emissiveIntensity = 1.0 + 0.8 * (0.5 + 0.5 * Math.sin(now / 1000 * 22));
    }

    // CRASH FLOURISH (I2a): expanding, fading emissive ring at the death cell.
    for (let i = 0; i < 2; i++) {
      const age = now - crashAt[i];
      const ring = crashRings[i];
      if (age >= 0 && age < CRASH_MS) {
        const t = age / CRASH_MS;            // 0..1
        const s = 0.6 + t * 2.6;             // grow out from the cell
        ring.scale.set(s, s, s);
        crashMats[i].opacity = 0.9 * (1 - t); // fade out
        crashMats[i].emissiveIntensity = 1.4 * (1 - t * 0.5);
        ring.visible = true;
      } else if (ring.visible) {
        ring.visible = false;
      }
    }

    // BANNER POP (I3): quick overshoot-then-settle scale each time the text changes
    // (no per-frame texture upload). Cosmetic only; visibility is set in renderGrid.
    if (bannerSprite && bannerSprite.visible) {
      const age = now - bannerPopAt;
      let k = 1;
      if (age >= 0 && age < BANNER_POP_MS) {
        const t = age / BANNER_POP_MS;       // 0..1
        // Damped overshoot: punches ~25% above base then settles smoothly to 1.
        k = 1 + 0.25 * Math.sin(Math.PI * t * 1.5) * (1 - t);
      }
      bannerSprite.scale.set(bannerBaseX * k, bannerBaseY * k, 1);
    }

    // SCORE-PIP FILL POP (I8): per-pip scale overshoot when it newly lights. Scale is
    // per-mesh (the on/off MATERIAL is shared, so we don't pulse emissive — that would
    // brighten every lit pip of that side). Only touches pips with a live pop window,
    // and resets the rest to unit scale cheaply.
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < pips[side].length; k++) {
        const age = now - pipPopAt[side][k];
        let s = 1;
        if (age >= 0 && age < PIP_POP_MS) {
          const t = age / PIP_POP_MS;
          s = 1 + 0.6 * Math.sin(Math.PI * t * 1.4) * (1 - t); // damped overshoot
        }
        const p = pips[side][k];
        if (p.scale.x !== s) p.scale.set(s, 1, s);
      }
    }

    // WIN FLOURISH (I2b): pulse the survivor's trail glow on round/match end so the
    // winner's wall reads as "alive". Always reset BOTH trails to the base glow
    // first, so a finished pulse never leaves a material brightened.
    M.t0.emissiveIntensity = TRAIL_GLOW;
    M.t1.emissiveIntensity = TRAIL_GLOW;
    if ((phase === "roundover" || phase === "matchover")) {
      const w = phase === "matchover" ? matchWinner : roundWinner;
      if (w === 0 || w === 1) {
        const pulse = TRAIL_GLOW + 0.6 * (0.5 + 0.5 * Math.sin(now / 1000 * 6));
        (w === 0 ? M.t0 : M.t1).emissiveIntensity = pulse;
      }
    }

    // IDENTITY HALO pulse (I6): strong, attention-grabbing during the countdown so
    // "which one am I" reads at a glance; damped to a steady glow during live play
    // so it doesn't compete with the fast-moving trail.
    if (M.mine) {
      const t = now / 1000;
      if (phase === "countdown") {
        M.mine.emissiveIntensity = 0.65 + 0.45 * (0.5 + 0.5 * Math.sin(t * 5));
      } else {
        M.mine.emissiveIntensity = 0.78 + 0.12 * (0.5 + 0.5 * Math.sin(t * 2.2));
      }
    }
    // guests/spectators paint on snapshot arrival (renderGrid in applyState).
  }

  function applyState(state) {
    if (!state) {
      grid = makeArena();
      cycles = spawnCycles();
      scores = [0, 0];
      round = 1;
      phase = "countdown";
      countdown = COUNTDOWN;
      roundWinner = matchWinner = null;
      tickAcc = countdownAcc = gapAcc = 0;
      pendingTurn[0] = pendingTurn[1] = null;
      renderGrid();
      return;
    }
    if (role === "host") { renderGrid(); return; } // host is authoritative locally

    // decode grid string
    const g = makeArena();
    if (typeof state.grid === "string" && state.grid.length === COLS * ROWS) {
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++) {
          const ch = state.grid[y * COLS + x];
          g[y][x] = ch === "." ? -1 : Number(ch);
        }
    }
    grid = g;
    // IMPORTANT: cycles/colorIdx come straight from the wire (shared game state).
    // The LOCAL identity (myColorIdx/myColor/which head glows) was fixed at
    // construction from role and is NOT touched here — no side-flip.
    cycles = Array.isArray(state.cycles)
      ? state.cycles.map((c, i) => ({
          x: c.x | 0, y: c.y | 0, dir: c.dir | 0,
          alive: !!c.alive, colorIdx: c.colorIdx ?? i,
        }))
      : spawnCycles();
    scores = Array.isArray(state.scores) ? [state.scores[0] | 0, state.scores[1] | 0] : [0, 0];
    phase = state.phase || "playing";
    round = Number.isInteger(state.round) ? state.round : round;
    countdown = Number.isInteger(state.countdown) ? state.countdown : 0;
    roundWinner = Number.isInteger(state.roundWinner) ? state.roundWinner : null;
    matchWinner = Number.isInteger(state.matchWinner) ? state.matchWinner : null;
    renderGrid();
  }

  function onPointer() { /* real-time: keyboard only */ }
  function setRole(r) {
    role = r || "spectator";
    // IDENTITY is role-derived and must follow an in-place role change so a watcher
    // never keeps a stale "this is YOU" cue (demoted host) and a promoted seat gains
    // its own-cycle cue. Recompute seat/colour, rebuild the identity materials +
    // halo/home-strip meshes, and reassign the head materials. Wire-derived game
    // state (cycles/grid/scores) is untouched; the next applyState repaints it.
    mySeat = role === "host" ? 0 : role === "guest" ? 1 : null;
    myColorIdx = mySeat;
    myColor = myColorIdx != null ? COLORS[myColorIdx] : null;
    // Recompute the self-oriented view frame for the new seat: seat 1 (guest) flips
    // 180° so its own cycle stays near; host/spectator render canonical. Re-layout
    // the view-dependent meshes (pips; home strip is rebuilt below) so nothing
    // keeps a stale orientation. The steering swap (turnIntentFor) is seat-agnostic.
    viewFlip = mySeat === 1;
    viewSign = viewFlip ? -1 : 1;
    applyFacing(); // re-rotate to this seat's chair (composes with viewSign)
    buildIdentityMaterials();
    applyHeadMaterials();
    buildIdentityMeshes();
    positionPips();
    renderGrid();
  }
  // orientPolicy:"self" — board.js does NOT rotate this group, so an in-place
  // re-seat must re-rotate the group ourselves to keep THIS player's near edge at
  // local -Z. applyFacing() composes orientFor(seatRy) with the viewSign flip.
  function setSeatRy(ry) { seatRy = ry; applyFacing(); renderGrid(); }
  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
    clearTrails();
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
    for (const o of ownedIdentity) o.dispose?.();
  }

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  applyFacing(); // rotate to this seat's physical chair before the first paint
  renderGrid();
  // orientPolicy:"self" — we own per-seat facing by COMPOSING a real group rotation
  // (applyFacing => orientFor(seatRy), handles all four chairs) with the view flip
  // (gx/gz/pips, selects which end is near), so board.js must NOT also rotate our
  // group (see InWorldBoard._orient). This is what makes each player's OWN cycle
  // render near and the left/right steering self-consistent from EVERY chair.
  // spectatorAnimates:false — real-time, snapshot-driven: applyMove is a no-op and
  // spectators render only from streamed state, so board.js must NOT swallow
  // post-move snapshots (see InWorldBoard._onMove, BUG 1).
  return { group, orientPolicy: "self", spectatorAnimates: false, applyState, applyMove: () => true, onPointer, onInput, update, publicState, setRole, setSeatRy, dispose };
}

export default createGame;
