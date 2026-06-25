// Ride manager: ties the drivable car and the rideable skateboard into a small
// walk / drive / skate mode machine driven by the E key. main.js calls update()
// each frame and branches on the returned mode (drive bypasses the normal walk
// update; skate just rides along with a speed boost + a board under the feet).

import { makeCar } from "./car.js";
import { makeSkateboard } from "./skateboard.js";

const FAR = 1e9;
const CAR_REACH = 3.2; // how close you must be to enter the car
const SKATE_SPEED = 1.9; // ground-speed multiplier while skating

export function createRides(scene, opts) {
  const colliders = opts.colliders;
  const isGround = opts.isGround || (() => true);
  const spawn = opts.carSpawn || { x: 4, z: 18, heading: 0 };

  const car = makeCar({ x: spawn.x, z: spawn.z, heading: spawn.heading, color: opts.carColor || "#d23b34" });
  scene.add(car.group);

  // Parked-car footprint, registered in the world colliders so you can't walk
  // through it. We mutate this same object in place: a tight box while parked,
  // pushed far away (inert) while you're driving it.
  const carCollider = { ...car.footprint() };
  colliders.push(carCollider);

  let board = null;
  let mode = "walk"; // walk | drive | skate

  function parkCollider(on) {
    if (on) Object.assign(carCollider, car.footprint());
    else Object.assign(carCollider, { minX: FAR, maxX: FAR, minZ: FAR, maxZ: FAR });
  }

  function mountBoard(local) {
    if (!board) board = makeSkateboard();
    board.position.set(0, 0, 0.12); // under the feet, nose forward (+Z = facing)
    if (board.parent) board.parent.remove(board);
    local.character.group.add(board);
    local.speedMul = SKATE_SPEED;
  }

  function dismountBoard(local) {
    if (board && board.parent) board.parent.remove(board);
    local.speedMul = 1;
  }

  // dt, camera, controls, local -> { mode, prompt, overrideWalk }
  // overrideWalk true means main.js should NOT run the normal walk update (driving
  // owns the avatar + camera this frame).
  function update(dt, camera, controls, local) {
    const useE = controls.consumeUse ? controls.consumeUse() : false;
    const outdoors = local.pos.z > 11.5; // only offer rides outside the cafe
    const nearCar = car.distanceTo(local.pos.x, local.pos.z) < CAR_REACH;

    if (mode === "drive") {
      car.drive(dt, controls.driveAxis(), colliders, isGround);
      car.updateCamera(camera, dt);
      // Keep the (hidden) avatar + networked position riding along with the car so
      // exiting is seamless and remote players see you move, not freeze.
      local.pos.x = car.state.x;
      local.pos.z = car.state.z;
      local.facing = car.state.heading;
      if (useE) {
        const s = car.exitSpot();
        local.pos.x = s.x;
        local.pos.z = s.z;
        local.facing = s.facing;
        local.character.group.position.set(s.x, 0, s.z);
        local.character.group.rotation.y = s.facing;
        parkCollider(true);
        mode = "walk";
        return { mode, prompt: "🚗 Press E to drive", overrideWalk: false };
      }
      return { mode, prompt: "🚗 WASD to drive · E to exit", overrideWalk: true };
    }

    if (mode === "skate") {
      if (useE) {
        dismountBoard(local);
        mode = "walk";
        return { mode, prompt: null, overrideWalk: false };
      }
      return { mode, prompt: "🛹 Skating! · E to hop off", overrideWalk: false };
    }

    // mode === "walk"
    if (useE && !local.sitting) {
      if (nearCar) {
        parkCollider(false);
        car.resetCamera();
        mode = "drive";
        return { mode, prompt: "🚗 WASD to drive · E to exit", overrideWalk: true };
      }
      if (outdoors) {
        mountBoard(local);
        mode = "skate";
        return { mode, prompt: "🛹 Skating! · E to hop off", overrideWalk: false };
      }
    }
    let prompt = null;
    if (nearCar) prompt = "🚗 Press E to drive";
    else if (outdoors && !local.sitting) prompt = "🛹 Press E to skateboard";
    return { mode, prompt, overrideWalk: false };
  }

  return {
    update,
    car,
    get mode() { return mode; },
    // Network-friendly ride tag: null while walking, "car" while driving, "skate"
    // while on the board. Threaded through sendState so remotes render the mesh.
    get ride() { return mode === "drive" ? "car" : mode === "skate" ? "skate" : null; },
  };
}
