// Input handling: keyboard movement, drag-to-orbit camera, and a touch joystick
// for mobile. Exposes a small read-only-ish API the local player polls each frame.
//
//   controls.move    -> { x, z } camera-relative intent, each in [-1, 1]
//   controls.orbit   -> { yaw, pitch } accumulated camera angles (radians)
//   controls.consumeJump() etc. are intentionally omitted — this is a chill space.

import { CAMERA, SEATED_CAM } from "../config.js";

export function createControls(domElement) {
  const keys = new Set();
  const move = { x: 0, z: 0 };
  const orbit = { yaw: 0, pitch: 0.42 };
  let sitPressed = false; // edge-triggered Space, drained by consumeSit()
  let dropPressed = false; // edge-triggered G, drained by consumeDrop()
  let usePressed = false; // edge-triggered E, drained by consumeUse() (enter/exit a ride)
  // Skate trick edges (drained only while skating by rides.js). Ollie is also
  // queued by Space so the natural "jump" key works on the board; when NOT
  // skating that Space ollie-flag is simply never read (sit drains it via
  // consumeSit, and consumeOllie isn't called), so it can't fire spuriously.
  let olliePressed = false; // edge: Space / J -> ollie (pop into the air)
  let flipPressed = false; // edge: K -> kickflip (deck spins about its length)
  let shuvPressed = false; // edge: L -> pop-shuvit (deck spins flat)
  let locked = false; // suppress movement/sit while a game overlay is open
  // Seated board-view mode: while on, orbit yaw is clamped to a gentle arc
  // around the seat-facing baseline and pitch to a comfy top-down-ish range so
  // the player can nudge the view but never fly away from the board.
  const seated = { on: false, baseYaw: 0 };

  // --- Keyboard ----------------------------------------------------------
  function typing() {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
  }

  window.addEventListener("keydown", (e) => {
    if (typing()) return;
    if (e.code === "Space") {
      e.preventDefault(); // don't scroll the page
      if (!keys.has("Space")) {
        sitPressed = true; // first press only, ignore auto-repeat
        olliePressed = true; // Space doubles as the ollie/jump while skating
      }
    }
    // G drops the item you're holding. `typing()` above already ignores keys
    // while the chat box is focused, so this never fires mid-message.
    if (e.code === "KeyG" && !keys.has("KeyG")) dropPressed = true;
    // E enters/exits a ride (car / skateboard). Edge-triggered like sit/drop.
    if (e.code === "KeyE" && !keys.has("KeyE")) usePressed = true;
    // Skate trick keys (only consumed in skate mode): J ollie, K kickflip, L shuvit.
    if (e.code === "KeyJ" && !keys.has("KeyJ")) olliePressed = true;
    if (e.code === "KeyK" && !keys.has("KeyK")) flipPressed = true;
    if (e.code === "KeyL" && !keys.has("KeyL")) shuvPressed = true;
    keys.add(e.code);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  // If focus is lost (alt-tab), clear keys so the player doesn't run forever.
  window.addEventListener("blur", () => keys.clear());

  // --- Pointer drag to orbit (mouse + touch on the right side) -----------
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let joyId = null; // pointerId reserved for the movement joystick

  const joystick = { active: false, baseX: 0, baseY: 0, dx: 0, dy: 0, id: null };

  domElement.addEventListener("contextmenu", (e) => e.preventDefault());

  domElement.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    // Left portion of the screen on touch = movement joystick.
    const isTouch = e.pointerType === "touch";
    if (isTouch && e.clientX < window.innerWidth * 0.45 && joystick.id === null) {
      joystick.id = e.pointerId;
      joystick.active = true;
      joystick.baseX = e.clientX;
      joystick.baseY = e.clientY;
      joystick.dx = 0;
      joystick.dy = 0;
      window.dispatchEvent(new CustomEvent("joystick", { detail: { ...joystick } }));
      return;
    }
    dragging = true;
    joyId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener("pointermove", (e) => {
    if (joystick.id === e.pointerId) {
      const max = 60;
      joystick.dx = clampMag(e.clientX - joystick.baseX, max) / max;
      joystick.dy = clampMag(e.clientY - joystick.baseY, max) / max;
      window.dispatchEvent(new CustomEvent("joystick", { detail: { ...joystick } }));
      return;
    }
    if (!dragging || e.pointerId !== joyId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    orbit.yaw -= dx * CAMERA.orbitSpeed;
    if (seated.on) {
      // Clamp the orbit to a gentle arc around the board so you can't spin away.
      orbit.yaw = clamp(orbit.yaw, seated.baseYaw - SEATED_CAM.yawRange, seated.baseYaw + SEATED_CAM.yawRange);
      orbit.pitch = clamp(orbit.pitch + dy * CAMERA.orbitSpeed, SEATED_CAM.minPitch, SEATED_CAM.maxPitch);
    } else {
      orbit.pitch = clamp(orbit.pitch + dy * CAMERA.orbitSpeed, CAMERA.minPitch, CAMERA.maxPitch);
    }
  });

  function endPointer(e) {
    if (joystick.id === e.pointerId) {
      joystick.id = null;
      joystick.active = false;
      joystick.dx = 0;
      joystick.dy = 0;
      window.dispatchEvent(new CustomEvent("joystick", { detail: { ...joystick } }));
    }
    if (e.pointerId === joyId) dragging = false;
  }
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);

  // Mouse wheel zoom (adjusts camera distance via a shared multiplier).
  const zoom = { factor: 1 };
  domElement.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom.factor = clamp(zoom.factor + Math.sign(e.deltaY) * 0.08, 0.55, 1.8);
    },
    { passive: false }
  );

  function update() {
    // While a game overlay owns the screen, the café avatar holds still.
    if (locked) {
      move.x = 0;
      move.z = 0;
      return;
    }
    // Keyboard intent (camera-relative: z forward, x strafe).
    let kz = 0;
    let kx = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) kz -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) kz += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) kx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) kx += 1;

    if (joystick.active) {
      kx += joystick.dx;
      kz += joystick.dy;
    }

    // Normalize so diagonal isn't faster.
    const len = Math.hypot(kx, kz);
    if (len > 1) {
      kx /= len;
      kz /= len;
    }
    move.x = kx;
    move.z = kz;
  }

  // Returns true once per Space press (sit/stand toggle), then resets.
  function consumeSit() {
    const pressed = sitPressed;
    sitPressed = false;
    // Space also queues an ollie; clear it here so a Space that toggles sit on
    // foot can't leave a stale ollie that fires the instant you mount the board.
    olliePressed = false;
    // NOTE: not gated by `locked`. Movement stays locked during a game, but Space
    // must ALWAYS toggle sit/stand so you can STAND UP to quit mid-game (standing
    // fires onStand → the app unlocks). Gating this left you trapped in the game.
    return pressed;
  }

  // Returns true once per G press (drop the held item), then resets.
  function consumeDrop() {
    const pressed = dropPressed;
    dropPressed = false;
    return locked ? false : pressed;
  }

  // Returns true once per E press (enter/exit a ride), then resets. Intentionally
  // NOT gated by `locked` — driving uses its own lock but E must still let you exit.
  function consumeUse() {
    const pressed = usePressed;
    usePressed = false;
    return pressed;
  }

  // Skate trick edges — drained once per press by rides.js while skating.
  function consumeOllie() {
    const p = olliePressed;
    olliePressed = false;
    return p;
  }
  function consumeFlip() {
    const p = flipPressed;
    flipPressed = false;
    return p;
  }
  function consumeShuv() {
    const p = shuvPressed;
    shuvPressed = false;
    return p;
  }

  // Continuous in-air spin steer for skate tricks: A/D (or arrows / joystick) held
  // while airborne rotates the rider for 180/360s. +1 = clockwise, -1 = counter.
  function spinAxis() {
    let s = 0;
    if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) s -= 1;
    if (joystick.active) s += joystick.dx;
    return clamp(s, -1, 1);
  }

  // Raw car-relative drive axis straight from the keys (NOT camera-relative like
  // `move`, and not zeroed by `locked`): throttle +1 forward / -1 reverse,
  // steer +1 right / -1 left. Used while driving a vehicle. The touch joystick
  // (dy up = forward, dx) also feeds it so mobile can drive.
  function driveAxis() {
    let throttle = 0;
    let steer = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) throttle += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) throttle -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) steer += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) steer -= 1;
    if (joystick.active) {
      throttle += -joystick.dy;
      steer += joystick.dx;
    }
    return { throttle: clamp(throttle, -1, 1), steer: clamp(steer, -1, 1) };
  }

  // Enter/leave seated board-view orbit mode. `baseYaw` is the seat-facing yaw
  // the gentle orbit arc centres on (the camera sits behind the player looking
  // at the board). Entering snaps yaw/pitch into the seated clamp so the ease-in
  // starts from a sane framing; leaving restores a comfortable walk-cam pitch.
  function setSeated(on, baseYaw = 0) {
    if (on && !seated.on) {
      seated.on = true;
      seated.baseYaw = baseYaw;
      // Start centred on the board with a comfortable downward gaze and the
      // neutral zoom, so sitting down doesn't snap in too close OR pull fully
      // back. The player can then scroll in (lean over the board) or out
      // (dolly back + up to fit a large board).
      orbit.yaw = baseYaw;
      orbit.pitch = SEATED_CAM.basePitch;
      zoom.factor = SEATED_CAM.zoomNeutral;
    } else if (on) {
      // Already seated (e.g. seat/role refresh): just re-centre the yaw baseline.
      seated.baseYaw = baseYaw;
    } else if (seated.on) {
      seated.on = false;
      // Restore a normal walk-cam pitch + default zoom.
      orbit.pitch = clamp(orbit.pitch, CAMERA.minPitch, CAMERA.maxPitch);
      zoom.factor = 1;
    }
  }

  // Lock/unlock café input (used while a game overlay is open).
  function setLocked(v) {
    locked = !!v;
    if (locked) {
      keys.clear();
      move.x = 0;
      move.z = 0;
      sitPressed = false;
      dropPressed = false;
      olliePressed = false;
      flipPressed = false;
      shuvPressed = false;
    }
  }

  return { move, orbit, zoom, update, consumeSit, consumeDrop, consumeUse, consumeOllie, consumeFlip, consumeShuv, spinAxis, driveAxis, setLocked, setSeated, get seated() { return seated.on; } };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function clampMag(v, m) {
  return Math.max(-m, Math.min(m, v));
}
