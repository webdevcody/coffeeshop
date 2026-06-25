// Ride manager: ties the drivable car and the rideable skateboard into a small
// walk / drive / skate mode machine driven by the E key. main.js calls update()
// each frame and branches on the returned mode (drive bypasses the normal walk
// update; skate just rides along with a speed boost + a board under the feet).

import * as THREE from "three";
import { makeCar } from "./car.js";
import { makeSkateboard } from "./skateboard.js";

const FAR = 1e9;
const CAR_REACH = 3.2; // how close you must be to enter the car
const SKATE_SPEED = 1.9; // ground-speed multiplier while skating

// --- Skate trick tuning (arcade + forgiving) --------------------------------
const SK_ORIGIN = { x: -30, z: 65 }; // skatepark world tile offset (city.js LAYOUT)
const GRAVITY = 16; // m/s^2 pulling the air-lift channel back down
const OLLIE_VY = 5.0; // pop launch velocity for a flat-ground ollie
const SPIN_RATE = 7.0; // rad/s body spin while airborne (held A/D)
const GRIND_SPEED = 5.0; // m/s slid along a rail while grinding
const GRIND_REACH = 0.7; // m perpendicular snap distance to catch a rail
const BAIL_TIME = 0.45; // s of speed penalty after a sloppy (non-flat) landing
const TRICK_PTS = { kickflip: 120, shuvit: 90, spin: 60, grind: 8, air: 25, ollie: 15 };

// Grindable lines in WORLD coords: a segment (x1,z1)->(x2,z2) at top height y.
// Derived from skatepark.js prop positions, translated by SK_ORIGIN.
const GRIND_LINES = [
  // flat grind rail: local centre (-4,4), 8 m along X, bar top ~0.55
  { x1: -8 + SK_ORIGIN.x, z1: 4 + SK_ORIGIN.z, x2: 0 + SK_ORIGIN.x, z2: 4 + SK_ORIGIN.z, y: 0.55 },
  // funbox grind edge (funEdge): local (6,8), 6 m along X, top ~0.72
  { x1: 3 + SK_ORIGIN.x, z1: 8 + SK_ORIGIN.z, x2: 9 + SK_ORIGIN.x, z2: 8 + SK_ORIGIN.z, y: 0.72 },
  // long ledge: local centre (-16,16), 10 m along X, cap top ~0.63
  { x1: -21 + SK_ORIGIN.x, z1: 16 + SK_ORIGIN.z, x2: -11 + SK_ORIGIN.x, z2: 16 + SK_ORIGIN.z, y: 0.63 },
  // benches (grindable seats): local (-2,13) & (2,-13), 2 m along X, top ~0.5
  { x1: -3 + SK_ORIGIN.x, z1: 13 + SK_ORIGIN.z, x2: -1 + SK_ORIGIN.x, z2: 13 + SK_ORIGIN.z, y: 0.5 },
  { x1: 1 + SK_ORIGIN.x, z1: -13 + SK_ORIGIN.z, x2: 3 + SK_ORIGIN.x, z2: -13 + SK_ORIGIN.z, y: 0.5 },
];

// Ramp launch footprints in WORLD coords: an AABB + the pop velocity it gives.
const RAMPS = [
  // quarter-pipe: local centre (18,-8), top 2.4 -> strongest pop
  { minX: 15 + SK_ORIGIN.x, maxX: 21 + SK_ORIGIN.x, minZ: -13 + SK_ORIGIN.z, maxZ: -3 + SK_ORIGIN.z, vy: 6.4 },
  // bowl walls: local (-14, -20) and (-14, -4) -> two launch strips
  { minX: -21 + SK_ORIGIN.x, maxX: -7 + SK_ORIGIN.x, minZ: -22 + SK_ORIGIN.z, maxZ: -18 + SK_ORIGIN.z, vy: 5.2 },
  { minX: -21 + SK_ORIGIN.x, maxX: -7 + SK_ORIGIN.x, minZ: -6 + SK_ORIGIN.z, maxZ: -2 + SK_ORIGIN.z, vy: 5.2 },
  // funbox angled ends: local (6,7) and (6,13) -> gentle pop
  { minX: 3 + SK_ORIGIN.x, maxX: 9 + SK_ORIGIN.x, minZ: 5.5 + SK_ORIGIN.z, maxZ: 8.5 + SK_ORIGIN.z, vy: 4.4 },
  { minX: 3 + SK_ORIGIN.x, maxX: 9 + SK_ORIGIN.x, minZ: 11.5 + SK_ORIGIN.z, maxZ: 14.5 + SK_ORIGIN.z, vy: 4.4 },
];

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

  // Per-frame skate physics sub-state. null while not skating; otherwise a small
  // record threaded across frames so air/grind survive between update() calls.
  //   st: "roll" | "air" | "grind"
  let skate = null;
  function resetSkate() {
    skate = { st: "roll", vy: 0, lift: 0, spin: 0, grindLine: null, grindT: 0, grindDir: 1, score: 0, lastTrick: null, bail: 0 };
  }

  // A tiny reusable grind-spark burst: a handful of emissive points parented under
  // the board, shown only while grinding. Built once, lazily, and reused (no
  // per-frame allocation). Lives at the board's contact point (slightly behind).
  let sparks = null;
  function ensureSparks() {
    if (sparks) return sparks;
    const N = 14;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 0.18;
      pos[i * 3 + 1] = Math.random() * 0.1;
      pos[i * 3 + 2] = -0.18 - Math.random() * 0.12;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: "#ffd27a", size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false });
    sparks = new THREE.Points(geo, mat);
    sparks.visible = false;
    return sparks;
  }

  function parkCollider(on) {
    if (on) Object.assign(carCollider, car.footprint());
    else Object.assign(carCollider, { minX: FAR, maxX: FAR, minZ: FAR, maxZ: FAR });
  }

  function mountBoard(local) {
    if (!board) {
      board = makeSkateboard();
      board.add(ensureSparks()); // sparks ride under the board, toggled while grinding
    }
    board.position.set(0, 0, 0.12); // under the feet, nose forward (+Z = facing)
    board.rotation.set(0, 0, 0);
    board.clearTrick?.();
    if (board.parent) board.parent.remove(board);
    local.character.group.add(board);
    local.speedMul = SKATE_SPEED;
    resetSkate();
    local.rideLift = 0;
    local.rideSpin = 0;
    if (sparks) sparks.visible = false;
  }

  function dismountBoard(local) {
    if (board) {
      board.setGrind?.(false);
      board.clearTrick?.();
      if (board.parent) board.parent.remove(board);
    }
    if (sparks) sparks.visible = false;
    local.speedMul = 1;
    local.rideLift = 0;
    local.rideSpin = 0;
    skate = null;
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
      skateUpdate(dt, controls, local);
      return { mode, prompt: skateHud(), overrideWalk: false };
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

  // ---- Skate trick state machine -------------------------------------------
  // Runs BEFORE local.update each frame. It reads/writes local.pos.x/z + facing
  // (the networked, ground-truth fields) and writes local.rideLift / local.rideSpin
  // (local-only visual offsets) which local.update applies to the group transform
  // afterwards. Air is owned here (NOT local.pos.y, which the ground-pin stomps).
  function skateUpdate(dt, controls, local) {
    if (!skate) resetSkate();
    const ollie = controls.consumeOllie ? controls.consumeOllie() : false;
    const doFlip = controls.consumeFlip ? controls.consumeFlip() : false;
    const doShuv = controls.consumeShuv ? controls.consumeShuv() : false;
    const steer = controls.spinAxis ? controls.spinAxis() : 0;
    const wx = local.pos.x, wz = local.pos.z;

    // Fade out any post-bail speed penalty.
    if (skate.bail > 0) {
      skate.bail = Math.max(0, skate.bail - dt);
      local.speedMul = skate.bail > 0 ? SKATE_SPEED * 0.45 : SKATE_SPEED;
    }

    // 1) ROLL: catch a ramp launch or pop an ollie; allow grind entry on contact.
    if (skate.st === "roll") {
      local.speedMul = skate.bail > 0 ? SKATE_SPEED * 0.45 : SKATE_SPEED;
      const ramp = rampAt(wx, wz);
      if (ramp && local.moving) {
        skate.st = "air"; skate.vy = ramp.vy; creditTrick("air");
      } else if (ollie) {
        skate.st = "air"; skate.vy = OLLIE_VY; creditTrick("ollie");
      } else {
        // roll straight onto a low rail/ledge if we're gliding along one
        const gl = grindAt(wx, wz);
        if (gl) enterGrind(gl, local);
      }
    }

    // 2) AIR: integrate the lift, spin the rider, run deck tricks, detect touchdown.
    if (skate.st === "air") {
      if (doFlip) { board.setTrick("kickflip"); creditTrick("kickflip"); }
      if (doShuv) { board.setTrick("shuvit"); creditTrick("shuvit"); }
      skate.spin += steer * SPIN_RATE * dt; // body yaw for 180/360s
      skate.vy -= GRAVITY * dt;
      skate.lift += skate.vy * dt;
      const deckFlat = board.updateTrick(dt, true);
      if (skate.lift <= 0) {
        skate.lift = 0; skate.vy = 0;
        const gl = grindAt(wx, wz);
        if (gl && deckFlat) {
          enterGrind(gl, local);
        } else {
          skate.st = "roll";
          // Commit the spin into the networked facing; snap to the nearest 90°
          // so landings line up cleanly with the roll direction.
          const spun = Math.abs(skate.spin);
          local.facing = snapAngle(local.facing + skate.spin);
          skate.spin = 0;
          if (deckFlat) {
            if (spun >= Math.PI * 0.75) creditTrick("spin"); // landed a 180+/360
          } else {
            // Deck still mid-rotation -> bail: cancel the flip, brief speed dip.
            board.clearTrick();
            skate.bail = BAIL_TIME;
            skate.lastTrick = "Bail!";
          }
        }
      }
    } else {
      // Grounded (roll/grind): keep the deck snapped flat.
      board.updateTrick(dt, false);
    }

    // 3) GRIND: lock onto the rail line, slide along it, hop off on Space/end.
    if (skate.st === "grind") {
      const gl = skate.grindLine;
      const len = Math.hypot(gl.x2 - gl.x1, gl.z2 - gl.z1) || 1;
      skate.grindT += (GRIND_SPEED * dt / len) * skate.grindDir;
      // Clamp to the segment; reaching either end pops you back into roll.
      let reachedEnd = false;
      if (skate.grindT <= 0) { skate.grindT = 0; reachedEnd = true; }
      if (skate.grindT >= 1) { skate.grindT = 1; reachedEnd = true; }
      const px = gl.x1 + (gl.x2 - gl.x1) * skate.grindT;
      const pz = gl.z1 + (gl.z2 - gl.z1) * skate.grindT;
      local.pos.x = px; local.pos.z = pz;
      local.facing = Math.atan2((gl.x2 - gl.x1) * skate.grindDir, (gl.z2 - gl.z1) * skate.grindDir);
      skate.lift = gl.y;
      creditTrick("grind", dt); // accrue points over time
      if (sparks) sparks.visible = true;
      if (ollie || reachedEnd) {
        skate.st = "air"; skate.vy = OLLIE_VY * 0.85;
        skate.grindLine = null;
        board.setGrind(false);
        local.speedMul = SKATE_SPEED; // re-enable XZ control for the air + landing
        if (sparks) sparks.visible = false;
      }
    } else if (sparks && sparks.visible) {
      sparks.visible = false;
    }

    // 4) Publish the visual channels so local.update applies them this frame.
    local.rideLift = skate.lift;
    local.rideSpin = skate.spin;
  }

  // First ramp footprint containing (x,z), else null.
  function rampAt(x, z) {
    for (const r of RAMPS) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r;
    }
    return null;
  }

  // Nearest grindable line within GRIND_REACH of (x,z) whose projection falls on
  // the segment, else null. Also scans world colliders for thin kerb-like boxes so
  // road kerbs anywhere become grindable, synthesising a line along their long axis.
  function grindAt(x, z) {
    let best = null, bestD = GRIND_REACH * GRIND_REACH;
    for (const gl of GRIND_LINES) {
      const d = segDistSq(x, z, gl);
      if (d < bestD) { bestD = d; best = gl; }
    }
    if (best) return best;
    // Kerb fallback: any thin collider near the player becomes a temporary rail.
    for (const c of colliders) {
      if (c.minX >= FAR) continue; // inert (parked-car-while-driving) box
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      const thin = Math.min(w, d);
      if (thin >= 0.6 || Math.max(w, d) < 0.8) continue; // not a long thin kerb
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      // Build a line along the long axis, at a low grind height.
      const line = w >= d
        ? { x1: c.minX, z1: cz, x2: c.maxX, z2: cz, y: 0.45 }
        : { x1: cx, z1: c.minZ, x2: cx, z2: c.maxZ, y: 0.45 };
      const dd = segDistSq(x, z, line);
      if (dd < bestD) { bestD = dd; best = line; }
    }
    return best;
  }

  // Lock onto a grind line: snap to it, set the slide direction from current
  // travel, lift to the rail height, show the grind pose + sparks, zero XZ walk so
  // local.update doesn't fight the rail (rides drives pos directly while grinding).
  function enterGrind(gl, local) {
    skate.st = "grind";
    skate.grindLine = gl;
    skate.lift = gl.y;
    skate.vy = 0;
    skate.spin = 0;
    // Entry parameter = projection of the player onto the segment.
    const dx = gl.x2 - gl.x1, dz = gl.z2 - gl.z1;
    const len2 = dx * dx + dz * dz || 1;
    skate.grindT = Math.max(0, Math.min(1, ((local.pos.x - gl.x1) * dx + (local.pos.z - gl.z1) * dz) / len2));
    // Slide toward whichever end the body is currently facing.
    const fdot = Math.sin(local.facing) * dx + Math.cos(local.facing) * dz;
    skate.grindDir = fdot >= 0 ? 1 : -1;
    local.speedMul = 0; // freeze local.update's XZ; rides moves us along the rail
    board.setGrind(true);
    if (sparks) sparks.visible = true;
  }

  // Award points + remember the last trick name for the HUD. `dt` (grind only)
  // accrues continuously; trick pops are one-shot.
  function creditTrick(name, dt) {
    if (name === "grind") {
      skate.score += Math.round(TRICK_PTS.grind * (dt || 0) * 10);
      skate.lastTrick = "Grind";
      return;
    }
    skate.score += TRICK_PTS[name] || 0;
    skate.lastTrick = ({ kickflip: "Kickflip", shuvit: "Pop-shuvit", spin: "Spin", air: "Air!", ollie: "Ollie" })[name] || name;
  }

  function skateHud() {
    const label = skate ? (skate.lastTrick || "Skating!") : "Skating!";
    const pts = skate ? skate.score : 0;
    return `🛹 ${label} · ${pts} pts · Space/J ollie · K flip · L shuvit · A/D spin · E off`;
  }

  return {
    update,
    car,
    get trick() { return skate ? skate.lastTrick : null; },
    get score() { return skate ? skate.score : 0; },
    get mode() { return mode; },
    // Network-friendly ride tag: null while walking, "car" while driving, "skate"
    // while on the board. Threaded through sendState so remotes render the mesh.
    get ride() { return mode === "drive" ? "car" : mode === "skate" ? "skate" : null; },
  };
}

// Squared perpendicular distance from (px,pz) to grind line `gl`, but only within
// the segment (returns a huge value if the projection falls past either end, so a
// rail is only "caught" when you're actually over it, not off its extension).
function segDistSq(px, pz, gl) {
  const dx = gl.x2 - gl.x1, dz = gl.z2 - gl.z1;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return (px - gl.x1) ** 2 + (pz - gl.z1) ** 2;
  let t = ((px - gl.x1) * dx + (pz - gl.z1) * dz) / len2;
  if (t < 0 || t > 1) return FAR; // off the ends — not over the rail
  const cx = gl.x1 + dx * t, cz = gl.z1 + dz * t;
  return (px - cx) ** 2 + (pz - cz) ** 2;
}

// Snap an angle to the nearest 90° quadrant, for clean spin landings.
function snapAngle(a) {
  const q = Math.PI / 2;
  return Math.round(a / q) * q;
}
