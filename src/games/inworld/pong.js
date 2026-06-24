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

// Map field units -> local board metres (court inscribed in the playable square).
const COURT_W = BOARD_SIZE * 0.9;             // lateral extent (x -> world X)
const COURT_H = BOARD_SIZE * 0.9;             // length extent  (y -> world Z)
const SX = COURT_W / W, SZ = COURT_H / H;

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "pong";

  let role = ctx.role;
  const isHost = role === "host";
  const isGuest = role === "guest";
  const isSpectator = !isHost && !isGuest;

  // ----- IDENTITY (derived ONCE from role, never from the wire) -----
  // host owns side A (canonical y=0 end, COLOR A), guest owns side B (y=H end,
  // COLOR B). Spectator owns nothing. mySign tells us, for THIS client, whether
  // its own end is at canonical y=0 (host: +1) or y=H (guest: -1) — which is also
  // exactly the local-view flip we apply when rendering canonical coords.
  const mySide = isHost ? "A" : isGuest ? "B" : null;
  const myColor = mySide === "A" ? PALETTE.pongLeft : mySide === "B" ? PALETTE.pongRight : null;
  const oppColor = mySide === "A" ? PALETTE.pongRight : mySide === "B" ? PALETTE.pongLeft : null;
  // viewFlip: false => render canonical directly (host / spectator). true =>
  // render canonical rotated 180° about table centre so the guest's own end (y=H)
  // lands near (-Z). Spectators take the host/canonical view.
  const viewFlip = isGuest;

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
  const viewSign = viewFlip ? -1 : 1;
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
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
  }
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
    mine: myColor ? keep(standard(THREE, myColor, {
      emissive: myColor, emissiveIntensity: 0.7, transparent: true, opacity: 0.45, depthWrite: false,
    })) : null,
  };

  const plankH = 0.018;
  const TOP = plankH;
  const floor = meshOf(THREE, keep(new THREE.BoxGeometry(COURT_W + 0.05, plankH, COURT_H + 0.05)), M.floor);
  floor.position.y = plankH / 2;
  group.add(floor);

  // midline across the court (perpendicular to length, at y=H/2)
  const midline = meshOf(THREE, keep(new THREE.BoxGeometry(COURT_W, 0.002, 0.005)), M.line, false);
  midline.position.set(0, TOP + 0.002, 0);
  group.add(midline);

  // side walls (lateral bounds at x=0 and x=W) — thin gold rails for readability
  const wallGeo = keep(new THREE.BoxGeometry(0.006, 0.01, COURT_H));
  const wallL = meshOf(THREE, wallGeo, M.line, false);
  const wallR = meshOf(THREE, wallGeo, M.line, false);
  wallL.position.set(-COURT_W / 2, TOP + 0.005, 0);
  wallR.position.set(COURT_W / 2, TOP + 0.005, 0);
  group.add(wallL, wallR);

  // paddles: A (host/colorA) and B (guest/colorB). They travel along world X.
  const padGeo = keep(new THREE.BoxGeometry(PADDLE_HALF * 2 * SX, 0.025, PADDLE_T * SZ * 1.6));
  const padA = meshOf(THREE, padGeo, M.colorA);
  const padB = meshOf(THREE, padGeo, M.colorB);
  padA.position.y = padB.position.y = TOP + 0.013;
  group.add(padA, padB);

  const ballGeo = keep(new THREE.SphereGeometry(BALL_R * SX * 1.3, 14, 12));
  const ballMesh = meshOf(THREE, ballGeo, M.ball);
  ballMesh.position.y = TOP + 0.02;
  group.add(ballMesh);

  // ----- IDENTITY CUE: glowing home strip + halo under MY paddle -----
  let homeStrip = null, myHalo = null;
  if (M.mine) {
    homeStrip = meshOf(THREE, keep(new THREE.BoxGeometry(COURT_W, 0.002, PADDLE_T * SZ * 0.5)), M.mine, false);
    homeStrip.position.set(0, TOP + 0.003, -COURT_H / 2 + PADDLE_T * SZ * 0.4); // always near (-Z) = my side
    group.add(homeStrip);
    myHalo = meshOf(THREE, keep(new THREE.BoxGeometry(PADDLE_HALF * 2 * SX * 1.25, 0.002, PADDLE_T * SZ * 2.4)), M.mine, false);
    myHalo.position.y = TOP + 0.004;
    group.add(myHalo);
  }

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
    const geo = keep(new THREE.PlaneGeometry(COURT_W * 0.85, COURT_W * 0.85 * (128 / 512)));
    scoreMesh = new THREE.Mesh(geo, mat);
    scoreMesh.rotation.x = -Math.PI / 2; // lay flat
    // Place just beyond MY near (-Z) edge, text upright from my seat. Because we
    // self-orient (own paddle always at -Z), this is the same for host & guest.
    scoreMesh.position.set(0, TOP + 0.004, -COURT_H / 2 - COURT_W * 0.085);
    scoreMesh.renderOrder = 5;
    group.add(scoreMesh);
    keep(scoreTex);
  }
  function paintScore() {
    if (!scoreCanvas || !scoreTex) return;
    const g = scoreCanvas.getContext("2d");
    g.clearRect(0, 0, 512, 128);
    // background pill
    g.fillStyle = "rgba(6,10,24,0.82)";
    roundRect(g, 6, 6, 500, 116, 18); g.fill();

    const myScore = isSpectator ? scoreA : (mySide === "A" ? scoreA : scoreB);
    const oppScore = isSpectator ? scoreB : (mySide === "A" ? scoreB : scoreA);
    const myHex = myColor || PALETTE.pongLeft;
    const opHex = oppColor || PALETTE.pongRight;

    g.textBaseline = "middle";
    g.font = "bold 64px sans-serif";
    // my score (left), my colour
    g.textAlign = "left";
    g.fillStyle = myHex;
    g.fillText(String(myScore), 40, 56);
    g.fillStyle = opHex;
    g.textAlign = "right";
    g.fillText(String(oppScore), 472, 56);
    // dash centre
    g.fillStyle = "#e9e2d0";
    g.textAlign = "center";
    g.font = "bold 40px sans-serif";
    g.fillText("–", 256, 50);

    // labels / status line
    g.font = "bold 26px sans-serif";
    let status;
    if (isSpectator) status = "SPECTATING  (A vs B)";
    else if (phase === "over") {
      const iWon = (winner === "A" && mySide === "A") || (winner === "B" && mySide === "B");
      status = iWon ? "YOU WIN!" : "YOU LOSE";
    } else if (phase === "lobby") status = "Waiting...";
    else status = "YOU ▼   (A/D or ← → to move)";
    g.fillStyle = "#cdd6e8";
    g.textAlign = "center";
    g.fillText(status, 256, 100);

    scoreTex.needsUpdate = true;
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
    return Math.max(PADDLE_HALF, Math.min(W - PADDLE_HALF, x));
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
    scoreA = scoreB = 0;
    serve(Math.random() < 0.5 ? 1 : -1);
    paintScore();
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
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // lateral walls
    if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
    if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); }

    // paddle crossings along the court-length (y) axis.
    // A at y=HOST_Y (ball moving -y crosses it), B at y=GUEST_Y (ball moving +y).
    const tryPaddle = (py, px, dirToward) => {
      // dirToward: +1 if this paddle is the FAR (guest) end the ball heads to with
      // +vy; -1 for host end. crossing when ball passes py from outside-in.
      const crossed = dirToward < 0
        ? (prevY >= py && ball.y <= py)   // host end (low y)
        : (prevY <= py && ball.y >= py);  // guest end (high y)
      if (!crossed) return false;
      if (Math.abs(ball.x - px) <= PADDLE_HALF + BALL_R) {
        const rel = (ball.x - px) / PADDLE_HALF; // -1..1
        const ang = rel * MAX_BOUNCE;
        let speed = Math.hypot(ball.vx, ball.vy) * SPEEDUP;
        speed = Math.min(speed, BALL_MAX);
        // reflect off the end: vy reverses to point back into court
        const outYSign = dirToward < 0 ? 1 : -1; // host paddle sends ball +y, guest -y
        ball.vy = outYSign * speed * Math.cos(ang);
        ball.vx = speed * Math.sin(ang);
        ball.y = py + outYSign * (BALL_R + 0.01);
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
    if (scoreA >= TARGET || scoreB >= TARGET) {
      phase = "over";
      winner = scoreA > scoreB ? "A" : "B";
      paintScore();
      try { ctx.onGameOver({ winner: winner === "A" ? "host" : "guest", reason: "score" }); } catch { /* */ }
    } else {
      // loser serves toward the winner-of-point's opponent: serve toward whoever
      // just conceded so play resumes from centre. Serve away from last scorer.
      serve(ball.y < H / 2 ? 1 : -1);
    }
    paintScore();
  }

  // ----- snapshot / state -----
  function snapshot() {
    return {
      phase, winner,
      bx: ball.x, by: ball.y, bvx: ball.vx, bvy: ball.vy,
      pA, pB, sA: scoreA, sB: scoreB,
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

    // ball
    const bx = isHost ? ball.x : view.x;
    const by = isHost ? ball.y : view.y;
    ballMesh.position.set(fX(bx), ballMesh.position.y, fZ(by));

    // identity halo follows MY paddle (which is always at -Z near edge)
    if (myHalo && M.mine) {
      const myMesh = mySide === "A" ? padA : padB;
      myHalo.position.x = myMesh.position.x;
      myHalo.position.z = myMesh.position.z;
      const t = nowMs() / 1000;
      M.mine.emissiveIntensity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3));
    }
  }

  // ----- per-frame update -----
  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.05); // clamp big stalls

    if (isHost) {
      if (phase === "lobby") startMatch();
      physics(dt);
      sendAcc += dt;
      if (sendAcc >= 1 / SEND_HZ) { sendAcc = 0; pushState(); }
      render();
      return;
    }

    if (isGuest) {
      const dir = localDirCanonical();
      // local prediction
      myPredX = clampPaddle(myPredX + dir * PADDLE_SPEED * dt);
      // reconcile toward authoritative pB
      if (Number.isFinite(pB)) {
        const gap = pB - myPredX;
        if (Math.abs(gap) > RESEED_DIST) myPredX = pB;
        else myPredX = clampPaddle(myPredX + gap * Math.min(1, dt * RECONCILE_RATE));
      }
      // stream intent (canonical dir) on change or throttle tick
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
    render();
  }

  // ----- host receives guest steering intent -----
  function onInput(input, byRole) {
    if (!isHost || byRole !== "guest" || !input) return;
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
      paintScore();
      render();
      return;
    }
    // NEVER recompute local role/side from the wire.
    if (isHost) return;

    phase = state.phase || "play";
    winner = state.winner || null;
    scoreA = state.sA | 0;
    scoreB = state.sB | 0;
    if (Number.isFinite(state.pA)) pA = state.pA;
    if (Number.isFinite(state.pB)) pB = state.pB;

    auth = { x: state.bx, y: state.by, vx: state.bvx, vy: state.bvy };
    const gap = Math.hypot(auth.x - view.x, auth.y - view.y);
    if (gap > RESEED_DIST || (view.vx === 0 && view.vy === 0)) {
      view.x = auth.x; view.y = auth.y;
    }
    view.vx = auth.vx; view.vy = auth.vy;
    lastStateAt = nowMs();

    paintScore();
    render();
  }

  // ----- misc contract methods -----
  function onPointer() { /* real-time: keyboard only */ }
  function applyMove() { return true; }
  function setRole(r) {
    // We do NOT live-flip identity/side mid-match (would contradict the derive-
    // once rule). A role change here only affects whether we keep simulating; the
    // engine re-mounts for a real seat change. Keep it conservative.
    role = r || "spectator";
  }
  function setSeatRy() { /* self-oriented: seat ry is irrelevant to our render */ }

  function dispose() {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    }
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  // initial paint
  paintScore();
  render();

  return {
    group,
    orientPolicy: "self", // we own facing; board.js must NOT rotate our group
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
