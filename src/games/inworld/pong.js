// Pong — in-world 3D module (createGame contract). REAL-TIME, host-authoritative.
// Host (seat0/left) simulates ball + both paddles in update(dt) and streams full
// state ~50Hz via net.sendState. The guest sends paddle STEERING INTENT ({dir})
// via net.sendInput, which the host integrates under the same PADDLE_SPEED (so the
// guest can't teleport its paddle), and renders its own paddle locally for
// responsiveness. The ball is reconciled toward the extrapolated authoritative
// sample each frame (re-seeding on a bounce/serve jump) instead of snapping.
// Paddle controls are read in SCREEN space and converted to a CANONICAL dir per
// seat (board.js rotates the court to face each viewer, which mirrors the up/down
// axis for the far chair), so both seats' "up" raises their own paddle while host
// and guest still agree on the canonical paddle position. First to 7 wins.

const W = 100, H = 60;
const PADDLE_HALF = 6, PADDLE_W = 2;
const LEFT_X = 4, RIGHT_X = 96;
const BALL_R = 1.2, TARGET = 7;
const PADDLE_SPEED = 90, BALL_START = 52, BALL_MAX = 130, SPEEDUP = 1.06;
const MAX_BOUNCE = 0.4 * Math.PI;
// Guest-side ball reconciliation: how fast (per second) the rendered ball eases
// toward the extrapolated authoritative position, and the positional gap above
// which we treat the snapshot as a discrete event (bounce/serve) and re-seed
// instantly instead of easing.
const RECONCILE_RATE = 8;
const RESEED_DIST = 10; // field units

// Map field units → local board metres (court inscribed in the playable square).
import { BOARD_SIZE, PALETTE, meshOf, standard } from "./pieces.js";
import { orientFor } from "./createGame.js";
const COURT_W = BOARD_SIZE * 0.92, COURT_H = COURT_W * (H / W);
const SX = COURT_W / W, SZ = COURT_H / H;
const fx = (x) => -COURT_W / 2 + x * SX;
const fz = (y) => -COURT_H / 2 + y * SZ;

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "pong";

  let role = ctx.role;
  const isHost = role === "host";

  // Per-viewer seat facing. board.js rotates THIS module's group by
  // orientFor(seatRy) so the court always turns to face whoever is looking. That
  // rotation mirrors the court's Z axis (paddle up/down) for a player seated on
  // the far side, so a raw key→canonical mapping would invert one seat's
  // controls. We resolve the input axis through the same rotation (see
  // upAxisSign) so "up" means each viewer's own screen-up, while host and guest
  // still agree on the resulting CANONICAL paddle position (the guest streams a
  // canonical dir, the host integrates the same canonical dir).
  let seatRy = ctx.seatRy;

  let phase = "lobby"; // lobby|play|over
  let winner = null;
  let ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  let lp = H / 2, rp = H / 2; // paddle centres (field units)
  let sl = 0, sr = 0;
  let myPaddle = H / 2; // local input target
  let guestY = H / 2; // host's INTEGRATED view of the guest paddle (intent-driven)
  let guestDir = 0; // host's view of the guest's current steering (-1/0/1)
  let view = { x: W / 2, y: H / 2, vx: 0, vy: 0 }; // guest/spectator render pos
  let auth = null; // latest authoritative ball sample {x,y,vx,vy} for reconciliation
  let lastStateAt = 0;
  let lastSentDir = 0; // guest's last-sent steering intent (dedupe sends)

  // input
  const keys = new Set();
  const onKey = (e, down) => {
    if (e.code === "KeyW" || e.code === "ArrowUp") { down ? keys.add("up") : keys.delete("up"); }
    if (e.code === "KeyS" || e.code === "ArrowDown") { down ? keys.add("down") : keys.delete("down"); }
  };
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);

  // geometry
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  // Which side is THIS client's own paddle? Derived from ROLE (canonical
  // convention §2): host = left/COLOR_A, guest = right/COLOR_B, spectator = none.
  // This is computed ONCE from ctx.role and never recomputed from relayed state
  // (applyState only touches shared board/turn), so a synced snapshot can never
  // flip the local player to the wrong side — host always sees "my left near me",
  // guest always sees "my right near me", consistent and opposite.
  const mySide = role === "host" ? "left" : role === "guest" ? "right" : null;
  const myColor = mySide === "left" ? PALETTE.pongLeft : mySide === "right" ? PALETTE.pongRight : null;

  const M = {
    floor: keep(standard(THREE, "#0a1022", { roughness: 0.7 })),
    left: keep(standard(THREE, PALETTE.pongLeft, { emissive: PALETTE.pongLeft, emissiveIntensity: 0.3 })),
    right: keep(standard(THREE, PALETTE.pongRight, { emissive: PALETTE.pongRight, emissiveIntensity: 0.3 })),
    ball: keep(standard(THREE, "#ffffff", { emissive: "#ffffff", emissiveIntensity: 0.4 })),
    line: keep(standard(THREE, PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.2 })),
    // Identity cue (§4): a glowing home-strip + paddle halo in the LOCAL player's
    // own colour so they can tell at a glance which paddle is theirs (left vs
    // right by role). Spectators get neither (myColor == null).
    mine: myColor ? keep(standard(THREE, myColor, { emissive: myColor, emissiveIntensity: 0.7, transparent: true, opacity: 0.5, depthWrite: false })) : null,
  };
  const plankH = 0.018;
  const floor = meshOf(THREE, keep(new THREE.BoxGeometry(COURT_W + 0.04, plankH, COURT_H + 0.04)), M.floor);
  floor.position.y = plankH / 2;
  group.add(floor);
  const TOP = plankH;
  const midline = meshOf(THREE, keep(new THREE.BoxGeometry(0.004, 0.002, COURT_H)), M.line, false);
  midline.position.set(0, TOP + 0.002, 0);
  group.add(midline);

  const padGeo = keep(new THREE.BoxGeometry(PADDLE_W * SX, 0.02, PADDLE_HALF * 2 * SZ));
  const ballGeo = keep(new THREE.SphereGeometry(BALL_R * SX * 1.4, 12, 10));
  const leftMesh = meshOf(THREE, padGeo, M.left);
  const rightMesh = meshOf(THREE, padGeo, M.right);
  const ballMesh = meshOf(THREE, ballGeo, M.ball);
  leftMesh.position.y = rightMesh.position.y = TOP + 0.01;
  ballMesh.position.y = TOP + 0.02;
  group.add(leftMesh, rightMesh, ballMesh);

  // ---- IDENTITY CUE (§4) ----
  // A glowing strip down the local player's OWN goal edge plus a soft halo under
  // their OWN paddle, both in their side colour. Authored in the canonical frame
  // (board.js rotates the group so the player's own edge ends up nearest them),
  // so each client sees its own colour on its own near side: host = left edge,
  // guest = right edge — consistent, opposite identities with no per-state flip.
  let homeStrip = null, myHalo = null;
  if (M.mine) {
    const edgeX = mySide === "left" ? -COURT_W / 2 + LEFT_X * SX : -COURT_W / 2 + RIGHT_X * SX;
    homeStrip = meshOf(THREE, keep(new THREE.BoxGeometry(0.01, 0.002, COURT_H)), M.mine, false);
    homeStrip.position.set(edgeX, TOP + 0.003, 0);
    group.add(homeStrip);
    myHalo = meshOf(THREE, keep(new THREE.BoxGeometry(PADDLE_W * SX * 2.2, 0.002, PADDLE_HALF * 2 * SZ * 1.4)), M.mine, false);
    myHalo.position.y = TOP + 0.004;
    group.add(myHalo);
  }

  function clampPaddle(y) {
    return Math.max(PADDLE_HALF, Math.min(H - PADDLE_HALF, y));
  }

  // Sign that maps a "move up" key (toward the viewer's screen-top / the far edge
  // across the table) to a CANONICAL paddle delta. A paddle's canonical y grows
  // along +Z (fz), which board.js renders rotated by orientFor(seatRy); the seated
  // player faces the table centre, so their far edge is the +facing direction
  // (sin ry, cos ry). Dotting the rotated +Z paddle axis with that facing tells us
  // whether "up" should increase or decrease canonical y for THIS seat — so both
  // chairs of an across-the-table match (and the ±90° chairs) read correctly
  // instead of one seat being inverted. Spectators (ry == null) get the canonical
  // host orientation. Returns +1 or -1.
  function upAxisSign() {
    if (seatRy == null || !Number.isFinite(seatRy)) return 1; // canonical (host) view
    const o = orientFor(seatRy);
    // Rotating canonical +Z by the board's Ry gives world (sin o, cos o); the
    // viewer's far direction is their facing (sin ry, cos ry). Snapped quarters
    // make orientFor(ry) ≈ ry, so this dot is ≈ +1, but compute it so the mapping
    // stays correct for whichever of the four chairs the player took.
    const dot = Math.sin(o) * Math.sin(seatRy) + Math.cos(o) * Math.cos(seatRy);
    return dot >= 0 ? 1 : -1;
  }

  function serve(dir) {
    ball.x = W / 2;
    ball.y = H / 2;
    const ang = (Math.random() * 0.6 - 0.3);
    ball.vx = dir * BALL_START * Math.cos(ang);
    ball.vy = BALL_START * Math.sin(ang);
  }

  function startMatch() {
    if (phase !== "lobby") return;
    phase = "play";
    sl = sr = 0;
    serve(Math.random() < 0.5 ? 1 : -1);
  }

  // ---- host physics ----
  function physics(dt) {
    // my paddle (left). Read the keys in SCREEN space (up = toward the far edge)
    // then convert to a CANONICAL delta via this seat's axis sign, so the host's
    // "up" raises the paddle on its own screen regardless of which chair it took.
    const s = upAxisSign();
    let dir = 0;
    if (keys.has("up")) dir += s;
    if (keys.has("down")) dir -= s;
    lp = clampPaddle(lp + dir * PADDLE_SPEED * dt);
    // Guest paddle: integrate the guest's *intent* under the SAME PADDLE_SPEED as
    // our own paddle, so the host is genuinely authoritative and the guest cannot
    // teleport its paddle onto the ball by streaming an absolute Y. guestDir is the
    // last steering the guest sent (-1/0/1).
    guestY = clampPaddle(guestY + guestDir * PADDLE_SPEED * dt);
    rp = guestY;

    if (phase !== "play") return;
    const prevX = ball.x;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); }
    if (ball.y > H - BALL_R) { ball.y = H - BALL_R; ball.vy = -Math.abs(ball.vy); }

    // swept paddle crossing
    const tryPaddle = (px, py, sign) => {
      const crossed = sign > 0 ? prevX >= px && ball.x <= px : prevX <= px && ball.x >= px;
      if (!crossed) return false;
      if (Math.abs(ball.y - py) <= PADDLE_HALF + BALL_R) {
        const rel = (ball.y - py) / PADDLE_HALF;
        const ang = rel * MAX_BOUNCE;
        let speed = Math.hypot(ball.vx, ball.vy) * SPEEDUP;
        speed = Math.min(speed, BALL_MAX);
        ball.vx = sign * speed * Math.cos(ang);
        ball.vy = speed * Math.sin(ang);
        ball.x = px + sign * (BALL_R + 0.01);
        return true;
      }
      return false;
    };
    tryPaddle(LEFT_X, lp, 1);
    tryPaddle(RIGHT_X, rp, -1);

    if (ball.x < -2) { sr++; score(); }
    else if (ball.x > W + 2) { sl++; score(); }
  }

  function score() {
    if (sl >= TARGET || sr >= TARGET) {
      phase = "over";
      winner = sl > sr ? "host" : "guest";
      try { ctx.onGameOver({ winner, reason: "score" }); } catch { /* */ }
    } else {
      serve(ball.x > W / 2 ? -1 : 1);
    }
  }

  function snapshot() {
    return { phase, bx: ball.x, by: ball.y, bvx: ball.vx, bvy: ball.vy, lp, rp, sl, sr, winner };
  }
  let sendAcc = 0;
  function pushState() {
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }
  function publicState() { return snapshot(); }

  // ---- guest input ----
  let inputAcc = 0;

  function render() {
    if (isHost) {
      leftMesh.position.x = 0 - COURT_W / 2 + LEFT_X * SX;
      leftMesh.position.z = fz(lp);
      rightMesh.position.x = -COURT_W / 2 + RIGHT_X * SX;
      rightMesh.position.z = fz(rp);
      ballMesh.position.set(fx(ball.x), TOP + 0.02, fz(ball.y));
    } else {
      // guest renders own paddle (right) from local input, ball/left from view.
      leftMesh.position.set(-COURT_W / 2 + LEFT_X * SX, TOP + 0.01, fz(lp));
      rightMesh.position.set(-COURT_W / 2 + RIGHT_X * SX, TOP + 0.01, fz(role === "guest" ? myPaddle : rp));
      ballMesh.position.set(fx(view.x), TOP + 0.02, fz(view.y));
    }
    // Keep the identity halo glued under the local player's OWN paddle so the cue
    // tracks "your" paddle, and gently pulse its glow so it reads at a glance.
    if (myHalo && M.mine) {
      const myMesh = mySide === "left" ? leftMesh : rightMesh;
      myHalo.position.x = myMesh.position.x;
      myHalo.position.z = myMesh.position.z;
      const t = nowMs() / 1000;
      M.mine.emissiveIntensity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3));
    }
  }

  function update(dt) {
    if (isHost) {
      // auto-start once a guest is around: host begins on first input or after lobby
      if (phase === "lobby") startMatch();
      physics(dt);
      sendAcc += dt;
      if (sendAcc >= 0.02) { sendAcc = 0; pushState(); }
      render();
    } else {
      if (role === "guest") {
        // Read keys in SCREEN space, then convert to a CANONICAL dir for this
        // seat so the guest's "up" raises the paddle on the guest's own screen
        // (the board is rotated to face the guest, which would otherwise invert
        // the court's up/down axis). The canonical dir is what we both predict
        // locally AND stream as intent, so the host's integrated paddle position
        // always matches what the guest renders.
        const s = upAxisSign();
        let dir = 0;
        if (keys.has("up")) dir += s;
        if (keys.has("down")) dir -= s;
        // Local prediction for responsiveness (rendered immediately).
        myPaddle = clampPaddle(myPaddle + dir * PADDLE_SPEED * dt);
        // Reconcile toward the host's AUTHORITATIVE paddle (streamed as state.rp,
        // recorded into rp by applyState). Host and guest both integrate the same
        // canonical dir, but a dropped/delayed {dir} packet (key-up under the
        // 60/s token bucket) or accumulated dt drift would otherwise diverge
        // permanently — the host's paddle (used for ball collision) ends up at a
        // different y than the guest renders, so the ball appears to pass through
        // the paddle. Easing myPaddle toward rp each frame keeps local prediction
        // snappy while pulling it back to authority so it can't drift; snap if the
        // gap is large (a missed key-up).
        if (Number.isFinite(rp)) {
          const gap = rp - myPaddle;
          if (Math.abs(gap) > RESEED_DIST) {
            myPaddle = rp;
          } else {
            myPaddle = clampPaddle(myPaddle + gap * Math.min(1, dt * RECONCILE_RATE));
          }
        }
        // Stream INTENT, not position: the host integrates this dir under the same
        // PADDLE_SPEED, so the simulation stays a fair real-time sim and the paddle
        // can't teleport. Send on change or on the throttle tick so a held key and
        // a key-up both reach the host promptly.
        inputAcc += dt;
        if (dir !== lastSentDir || inputAcc >= 0.05) {
          inputAcc = 0;
          lastSentDir = dir;
          try { ctx.net.sendInput({ dir }); } catch { /* */ }
        }
      }
      // Reconcile the ball toward the authoritative position while dead-reckoning
      // between packets, so a mispredicted bounce eases back instead of flying
      // through walls/paddles until the next snapshot snaps it.
      if (phase === "play") {
        view.x += view.vx * dt;
        view.y += view.vy * dt;
        if (auth) {
          // extrapolate the authoritative sample to "now" and lerp toward it.
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
  }

  // Host receives the guest's paddle STEERING INTENT (not an absolute position).
  // It's integrated under PADDLE_SPEED in physics(), so the host stays the real
  // authority and a flood/teleport packet can't snap the paddle onto the ball.
  function onInput(input, byRole) {
    if (role !== "host" || byRole !== "guest") return;
    if (!input) return;
    if (Number.isFinite(input.dir)) {
      guestDir = input.dir > 0 ? 1 : input.dir < 0 ? -1 : 0;
    }
  }

  function applyState(state) {
    if (!state) {
      phase = "lobby";
      winner = null;
      sl = sr = 0;
      ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
      lp = rp = H / 2;
      view = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
      auth = null;
      render();
      return;
    }
    if (role === "host") return;
    phase = state.phase || "play";
    sl = state.sl | 0;
    sr = state.sr | 0;
    winner = state.winner || null;
    lp = Number.isFinite(state.lp) ? state.lp : lp;
    rp = Number.isFinite(state.rp) ? state.rp : rp;
    // Record the authoritative ball sample for per-frame reconciliation.
    auth = { x: state.bx, y: state.by, vx: state.bvx, vy: state.bvy };
    // If the ball jumped far from where we predicted it (a bounce/serve/score the
    // guest mispredicted), re-seed the rendered ball immediately rather than
    // easing across the gap; small corrections are eased per-frame in update().
    const gap = Math.hypot(auth.x - view.x, auth.y - view.y);
    if (gap > RESEED_DIST || view.vx === 0) {
      view.x = auth.x;
      view.y = auth.y;
    }
    view.vx = auth.vx;
    view.vy = auth.vy;
    lastStateAt = nowMs();
    render();
  }

  function onPointer() { /* real-time: keyboard only */ }
  function setRole(r) { role = r || "spectator"; }
  // Keep the input axis in step with an in-place seat change (board.js re-rotates
  // the group by orientFor(seatRy) on a seat move and calls this); without it a
  // re-seated player's up/down would invert.
  function setSeatRy(ry) { seatRy = ry; }
  function dispose() {
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    if (group.parent) group.parent.remove(group);
    for (const o of owned) o.dispose?.();
  }

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  render();
  return { group, applyState, applyMove: () => true, onPointer, onInput, update, publicState, setRole, setSeatRy, dispose };
}

export default createGame;
