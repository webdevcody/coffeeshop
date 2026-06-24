// Pong — in-world 3D module (createGame contract). REAL-TIME, host-authoritative.
// Host (seat0/left) simulates ball + both paddles in update(dt) and streams full
// state ~50Hz via net.sendState. The guest sends paddle STEERING INTENT ({dir})
// via net.sendInput, which the host integrates under the same PADDLE_SPEED (so the
// guest can't teleport its paddle), and renders its own paddle locally for
// responsiveness. The ball is reconciled toward the extrapolated authoritative
// sample each frame (re-seeding on a bounce/serve jump) instead of snapping. First
// to 7 wins.

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
  const M = {
    floor: keep(standard(THREE, "#0a1022", { roughness: 0.7 })),
    left: keep(standard(THREE, PALETTE.pongLeft, { emissive: PALETTE.pongLeft, emissiveIntensity: 0.3 })),
    right: keep(standard(THREE, PALETTE.pongRight, { emissive: PALETTE.pongRight, emissiveIntensity: 0.3 })),
    ball: keep(standard(THREE, "#ffffff", { emissive: "#ffffff", emissiveIntensity: 0.4 })),
    line: keep(standard(THREE, PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.2 })),
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

  function clampPaddle(y) {
    return Math.max(PADDLE_HALF, Math.min(H - PADDLE_HALF, y));
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
    // my paddle (left)
    let dir = 0;
    if (keys.has("up")) dir -= 1;
    if (keys.has("down")) dir += 1;
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
        let dir = 0;
        if (keys.has("up")) dir -= 1;
        if (keys.has("down")) dir += 1;
        // Local prediction for responsiveness (rendered immediately).
        myPaddle = clampPaddle(myPaddle + dir * PADDLE_SPEED * dt);
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
  function setSeatRy() {}
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
