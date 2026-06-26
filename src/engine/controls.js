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
  let jetpackPressed = false; // edge-triggered F, drained by consumeJetpack() (toggle jetpack fly mode)
  let flashlightPressed = false; // edge-triggered V, drained by consumeFlashlight() (toggle the flashlight)
  // Skate trick edges (drained only while skating by rides.js). Ollie is also
  // queued by Space so the natural "jump" key works on the board; when NOT
  // skating that Space ollie-flag is simply never read (sit drains it via
  // consumeSit, and consumeOllie isn't called), so it can't fire spuriously.
  let olliePressed = false; // edge: Space / J -> ollie (pop into the air)
  let flipPressed = false; // edge: K -> kickflip (deck spins about its length)
  let shuvPressed = false; // edge: L -> pop-shuvit (deck spins flat)
  // Weapon toy (FREE keys): number keys swap the held weapon and B fires it.
  // weaponSlot latches the LAST slot pressed (1=gun, 2=rocket, 3=grenade,
  // 0=holster) drained by consumeWeaponSlot(); firePressed latches B for
  // consumeFire(). Both are cleared in setLocked so a game overlay swallows them.
  let weaponSlot = null;
  let firePressed = false;
  // LEFT-MOUSE fire (mirrors the B key): clickFirePressed latches a single click
  // (drained by consumeClickFire) and fireHeld stays true while the left button is
  // down (read by isFireHeld for the gun's auto-fire). Both are armed only when a
  // left-button mousedown lands on the bare game canvas (see pointerdown), and both
  // are cleared in setLocked so a game overlay swallows them.
  let clickFirePressed = false;
  let fireHeld = false;
  let mapPressed = false; // edge-triggered M, drained by consumeMap() (open the city map)
  let robPressed = false; // edge-triggered R, drained by consumeRob() (rob a nearby pedestrian)
  let parachutePressed = false; // edge-triggered P, drained by consumeParachute() (deploy the chute mid-air)
  let helpPressed = false; // edge-triggered H, drained by consumeHelp() (toggle the controls legend)
  let mixerPressed = false; // edge-triggered J, drained by consumeMixer() (toggle the sound mixer)
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
    // F toggles the wearable JETPACK fly mode on/off (a FREE key). Edge-triggered.
    if (e.code === "KeyF" && !keys.has("KeyF")) jetpackPressed = true;
    // V toggles the FLASHLIGHT (a FREE key). Edge-triggered like F.
    if (e.code === "KeyV" && !keys.has("KeyV")) flashlightPressed = true;
    // Skate trick keys (only consumed in skate mode): K kickflip, L shuvit. The
    // ollie lives on Space (queued in the Space handler above); J is now free for
    // the SOUND MIXER below, so it no longer doubles as an ollie.
    if (e.code === "KeyK" && !keys.has("KeyK")) flipPressed = true;
    if (e.code === "KeyL" && !keys.has("KeyL")) shuvPressed = true;
    // Weapon swap (1=gun, 2=rocket, 3=grenade, 0=holster) + B to fire. All FREE
    // keys, edge-triggered so a held key fires once. Drained by main.js.
    if (e.code === "Digit1" && !keys.has("Digit1")) weaponSlot = 1;
    if (e.code === "Digit2" && !keys.has("Digit2")) weaponSlot = 2;
    if (e.code === "Digit3" && !keys.has("Digit3")) weaponSlot = 3;
    if (e.code === "Digit0" && !keys.has("Digit0")) weaponSlot = 0;
    if (e.code === "KeyB" && !keys.has("KeyB")) firePressed = true;
    // M opens the full-screen CITY MAP (a FREE key). Edge-triggered like the
    // others; drained by consumeMap() in main.js. ui/map.js owns Esc/M-to-CLOSE.
    if (e.code === "KeyM" && !keys.has("KeyM")) mapPressed = true;
    // R robs the nearest pedestrian (a FREE key). Edge-triggered; drained by
    // consumeRob() in main.js on the on-foot path.
    if (e.code === "KeyR" && !keys.has("KeyR")) robPressed = true;
    // P deploys the PARACHUTE while airborne (a FREE key). Edge-triggered; drained
    // by consumeParachute() in main.js on the on-foot path.
    if (e.code === "KeyP" && !keys.has("KeyP")) parachutePressed = true;
    // H toggles the on-screen CONTROLS LEGEND (a FREE key). Edge-triggered; drained
    // by consumeHelp() in main.js and cleared in setLocked like the other edges.
    if (e.code === "KeyH" && !keys.has("KeyH")) helpPressed = true;
    // J toggles the SOUND MIXER panel (a FREE key). Edge-triggered; drained by
    // consumeMixer() in main.js and cleared in setLocked like the other edges.
    if (e.code === "KeyJ" && !keys.has("KeyJ")) mixerPressed = true;
    keys.add(e.code);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  // If focus is lost (alt-tab), clear keys so the player doesn't run forever, and
  // drop the held-fire flag so the gun doesn't keep auto-firing while unfocused.
  window.addEventListener("blur", () => {
    keys.clear();
    fireHeld = false;
  });

  // --- Pointer drag to orbit (mouse + touch on the right side) -----------
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let joyId = null; // pointerId reserved for the movement joystick

  const joystick = { active: false, baseX: 0, baseY: 0, dx: 0, dy: 0, id: null };

  domElement.addEventListener("contextmenu", (e) => e.preventDefault());

  domElement.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    // LEFT mouse on the bare game canvas fires the equipped weapon (in addition to
    // the B key). This sets the fire signals and then falls through to start the
    // camera drag below, so firing and free-look coexist. Guards: only the LEFT
    // button (button 0) of a real MOUSE; only when the pointerdown landed directly
    // on the canvas (e.target === domElement — interactive UI like the chat input,
    // mixer sliders, HUD buttons or the map overlay sit above the canvas, so their
    // clicks never reach here / aren't the canvas), and never while typing in chat
    // or while a game overlay holds the lock. Right/middle clicks never get here.
    if (e.button === 0 && e.pointerType === "mouse" && e.target === domElement && !locked && !typing()) {
      clickFirePressed = true;
      fireHeld = true;
    }
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
    // Releasing the LEFT mouse button (or any pointer cancel) ends held auto-fire.
    // pointercancel carries no meaningful button, so treat it as a release too.
    if (e.button === 0 || e.button === -1 || e.type === "pointercancel") fireHeld = false;
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

  // Returns true once per F press (toggle jetpack fly mode), then resets. Like
  // consumeUse, NOT gated by `locked` so you can always pop the pack off/on.
  function consumeJetpack() {
    const pressed = jetpackPressed;
    jetpackPressed = false;
    return pressed;
  }

  // Returns true once per V press (toggle the flashlight), then resets. Like
  // consumeUse/consumeJetpack, NOT gated by `locked` so it always toggles.
  function consumeFlashlight() {
    const pressed = flashlightPressed;
    flashlightPressed = false;
    return pressed;
  }

  // WALK-MODE sprint tier from the held modifier keys, read each frame by the
  // local player while on foot: 0 = walk (nothing), 1 = sprint (Shift held),
  // 2 = ULTRA (Shift + Ctrl held). This only REPORTS the held keys; it does not
  // disturb flyThrust(), which independently reads Shift/Ctrl as "descend" while
  // flying (the two modes never run at once — flying isn't on foot).
  function sprintLevel() {
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const ctrl = keys.has("ControlLeft") || keys.has("ControlRight");
    if (shift && ctrl) return 2;
    if (shift) return 1;
    return 0;
  }

  // Vertical jetpack thrust while flying: hold Space to ascend (+1), hold X or
  // Shift/Ctrl to descend (-1), nothing held = 0 (gravity wins). Read each frame
  // by rides.js in fly mode. Horizontal flight reuses the normal camera-relative
  // `move` vector, so WASD still flies you around. Not gated by `locked`.
  function flyThrust() {
    let t = 0;
    if (keys.has("Space")) t += 1;
    if (
      keys.has("KeyX") ||
      keys.has("ShiftLeft") || keys.has("ShiftRight") ||
      keys.has("ControlLeft") || keys.has("ControlRight")
    ) {
      t -= 1;
    }
    return clamp(t, -1, 1);
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

  // Weapon slot pressed this tick: 1=gun, 2=rocket, 3=grenade, 0=holster, or
  // null when nothing was pressed. Edge-triggered (drained once), and gated by
  // `locked` so number keys never swap weapons while a game overlay owns input.
  function consumeWeaponSlot() {
    const s = weaponSlot;
    weaponSlot = null;
    return locked ? null : s;
  }

  // True once per B press (fire the equipped weapon), then resets. Gated by
  // `locked` so you can't fire while a game overlay is open.
  function consumeFire() {
    const pressed = firePressed;
    firePressed = false;
    return locked ? false : pressed;
  }

  // True once per LEFT-mouse click (fire the equipped weapon), then resets. Used
  // for single-shot weapons; the gun's auto-fire reads isFireHeld() instead. Gated
  // by `locked` like consumeFire so a game overlay swallows the click.
  function consumeClickFire() {
    const pressed = clickFirePressed;
    clickFirePressed = false;
    return locked ? false : pressed;
  }

  // True while the LEFT mouse button is held down (drives the gun's auto-fire).
  // Gated by `locked` so holding the button can't keep firing under an overlay.
  function isFireHeld() {
    return locked ? false : fireHeld;
  }

  // True once per M press (open the city map), then resets. Gated by `locked`
  // like consumeFire: while a game overlay — or the open map itself — holds the
  // lock the M edge is swallowed, so the same press that CLOSES the map (handled
  // by ui/map.js's own Esc/M listener) can never bounce back and reopen it.
  function consumeMap() {
    const pressed = mapPressed;
    mapPressed = false;
    return locked ? false : pressed;
  }

  // True once per R press (rob the nearest pedestrian), then resets. Gated by
  // `locked` like consumeFire/consumeMap so it never fires while a game overlay owns
  // input; also cleared in setLocked so an edge can't carry across the lock.
  function consumeRob() {
    const pressed = robPressed;
    robPressed = false;
    return locked ? false : pressed;
  }

  // True once per P press (deploy the parachute), then resets. Gated by `locked`
  // like consumeRob and cleared in setLocked so an edge can't carry across the lock.
  function consumeParachute() {
    const pressed = parachutePressed;
    parachutePressed = false;
    return locked ? false : pressed;
  }

  // True once per H press (toggle the controls legend), then resets. Not gated by
  // `locked` (the legend is a harmless info overlay), but it IS cleared in
  // setLocked so an edge can't carry across into a game overlay.
  function consumeHelp() {
    const pressed = helpPressed;
    helpPressed = false;
    return pressed;
  }

  // True once per J press (toggle the sound mixer), then resets. Not gated by
  // `locked` (the mixer is a harmless settings overlay, like the help legend), but
  // it IS cleared in setLocked so an edge can't carry across into a game overlay.
  function consumeMixer() {
    const pressed = mixerPressed;
    mixerPressed = false;
    return pressed;
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
      jetpackPressed = false;
      flashlightPressed = false;
      olliePressed = false;
      flipPressed = false;
      shuvPressed = false;
      weaponSlot = null;
      firePressed = false;
      clickFirePressed = false;
      fireHeld = false;
      mapPressed = false;
      robPressed = false;
      parachutePressed = false;
      helpPressed = false;
      mixerPressed = false;
    }
  }

  return { move, orbit, zoom, update, consumeSit, consumeDrop, consumeUse, consumeJetpack, consumeFlashlight, consumeWeaponSlot, consumeFire, consumeClickFire, isFireHeld, consumeMap, consumeRob, consumeParachute, consumeHelp, consumeMixer, sprintLevel, flyThrust, consumeOllie, consumeFlip, consumeShuv, spinAxis, driveAxis, setLocked, setSeated, get seated() { return seated.on; } };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function clampMag(v, m) {
  return Math.max(-m, Math.min(m, v));
}
