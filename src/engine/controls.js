// Input handling: keyboard movement, drag-to-orbit camera, and a touch joystick
// for mobile. Exposes a small read-only-ish API the local player polls each frame.
//
//   controls.move    -> { x, z } camera-relative intent, each in [-1, 1]
//   controls.orbit   -> { yaw, pitch } accumulated camera angles (radians)
//   controls.consumeJump() etc. are intentionally omitted — this is a chill space.

import { CAMERA } from "../config.js";

export function createControls(domElement) {
  const keys = new Set();
  const move = { x: 0, z: 0 };
  const orbit = { yaw: 0, pitch: 0.42 };
  let sitPressed = false; // edge-triggered Space, drained by consumeSit()
  let locked = false; // suppress movement/sit while a game overlay is open

  // --- Keyboard ----------------------------------------------------------
  function typing() {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
  }

  window.addEventListener("keydown", (e) => {
    if (typing()) return;
    if (e.code === "Space") {
      e.preventDefault(); // don't scroll the page
      if (!keys.has("Space")) sitPressed = true; // first press only, ignore auto-repeat
    }
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
    orbit.pitch = clamp(orbit.pitch + dy * CAMERA.orbitSpeed, CAMERA.minPitch, CAMERA.maxPitch);
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
    return locked ? false : pressed;
  }

  // Lock/unlock café input (used while a game overlay is open).
  function setLocked(v) {
    locked = !!v;
    if (locked) {
      keys.clear();
      move.x = 0;
      move.z = 0;
      sitPressed = false;
    }
  }

  return { move, orbit, zoom, update, consumeSit, setLocked };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function clampMag(v, m) {
  return Math.max(-m, Math.min(m, v));
}
