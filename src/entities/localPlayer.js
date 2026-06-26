// The player you control. Owns a Character, applies camera-relative movement
// with collision against the room, rotates the body toward travel direction,
// and drives a trailing third-person camera that orbits with the mouse/touch.

import * as THREE from "three";
import { Character } from "./character.js";
import { resolveCollisions } from "../world/collision.js";
import { makeNameLabel, makeChatBubble, makeSpeakingIndicator } from "../ui/labels.js";
import { PLAYER, CAMERA, WORLD, SEAT, SEATED_CAM } from "../config.js";

// Falling off the edge of the world: how fast you accelerate down, and how far
// you fall before respawning back at the coffeeshop.
const FALL = { gravity: 22, respawnY: -12 };
// A standing hop (walk mode only). Space jumps when you're on the ground and not
// next to a seat — apex ≈ v²/(2·gravity) ≈ 1.3 m, airtime ≈ 0.7 s.
const JUMP_V = 7.6;

// SWIM / FLOAT on the ocean. When the app injects an isWater(x,z) predicate (see
// setIsWater), DESCENDING over open water drops you into a float instead of the
// void fall+respawn: pos.y is pinned just above the sea surface (waterY +
// surfaceOffset) with a gentle bob, movement slows by `stroke`, and Space pops a
// small hop. Climb back onto any ground rect to stand up and walk again.
const SWIM = {
  surfaceOffset: 0.4, // pos.y sits this far above waterY while afloat (≈ -0.4) so the head/torso clear the water
  bobAmp: 0.05,       // gentle vertical bob amplitude (m)
  bobFreq: 1.8,       // bob angular speed (rad/s)
  stroke: 0.6,        // walk-step multiplier while swimming (slower than walking)
  hopV: 4.2,          // Space pop-up out of the water (smaller than JUMP_V)
};

// Sprint + stamina, WALK MODE ONLY. Two tiers (Shift = run, Shift+Ctrl = ULTRA)
// scale the walk step and drain a 0..1 stamina meter while you're actually
// moving; let go (or run dry) and it regenerates. `recover` is the hysteresis
// threshold you must regen back past after emptying before you can sprint again,
// so you can't stutter-sprint on fumes.
const STAMINA = {
  runSpeed: 1.7, ultraSpeed: 2.6, // walk-step multipliers
  runDrain: 0.22, ultraDrain: 0.5, // per-second drain
  regen: 0.3, // per-second refill while not sprinting
  recover: 0.15, // must regen past this after emptying to sprint again
};

export class LocalPlayer {
  // `appearance` is { color, skin, hair } (a bare color string also works).
  constructor(scene, controls, colliders, appearance, name, seats = [], ground = null, spawn = null) {
    this.scene = scene;
    this.controls = controls;
    this.colliders = colliders;
    this.seats = seats;
    // The silly item you bought from the coffee bar (one at a time).
    this.heldItem = null; // { obj, def }
    // Items dropped on the floor. Capped so repeated buy/drop can't leak GPU
    // memory: once we exceed the cap the oldest drop is removed and disposed.
    this.drops = [];
    this.maxDrops = 12;
    // Walkable ground rectangles. Stand outside all of them and you fall.
    this.ground = ground || [{ minX: -WORLD.width / 2, maxX: WORLD.width / 2, minZ: -WORLD.depth / 2, maxZ: WORLD.depth / 2 }];
    this.spawn = spawn || { x: 0, z: 4 };
    this.bounds = unionBounds(this.ground);
    // STATION: walkable deck rects that live at altitude (stationFloorY) instead
    // of y=0. Injected via setStation. While the player stands on one of these
    // rects _updateVertical pins pos.y to stationFloorY (not 0), so they walk the
    // orbital station deck high above the city. null/0 until a station is wired.
    this.stationRects = null;
    this.stationFloorY = 0;
    this.character = new Character(appearance, name || "me");
    this.character.group.position.set(this.spawn.x, 0, this.spawn.z);
    this.character.group.rotation.y = Math.PI;
    scene.add(this.character.group);

    this.pos = new THREE.Vector3(this.spawn.x, 0, this.spawn.z);
    this.facing = Math.PI;
    this.moving = false;
    // Sprint stamina (walk mode only). `stamina`/`staminaPct` are 0..1 (start
    // full); `sprinting` is true on frames you're actively running. `_staminaEmpty`
    // latches when fully drained and clears once stamina regens past STAMINA.recover.
    this.stamina = 1;
    this.staminaPct = 1;
    this.sprinting = false;
    this._staminaEmpty = false;
    // Vertical state for walking off an edge.
    this.vy = 0;
    this.falling = false;
    // True while airborne from a jump OR a walk-off-the-edge fall; one gravity
    // integrator (_updateVertical) drives both.
    this.airborne = false;
    // Trick channels owned by rides.js while skating: a vertical lift (m) applied
    // on top of the walk/fall offset for ollies/air/grinds, and an extra body yaw
    // (rad) for in-air 180/360 spins. Default 0 so walking/driving are untouched —
    // rides.update() (which runs BEFORE this.update each frame) writes them and the
    // group-transform write below applies them.
    this.rideLift = 0;
    this.rideSpin = 0;
    // True while rides.js is flying us with the jetpack: rides owns pos.y
    // (altitude) each frame, so _updateVertical skips the ground-snap + void
    // respawn and the Space=jump/sit handling is suppressed (Space is thrust).
    // Cleared back to false on landing, which resumes normal gravity/ground.
    this.flying = false;
    // SECRET-CANNON LAUNCH. launchSelf() fires us out of the cannon: it sets an
    // upward vy AND a constant horizontal glide (_launchVX/_launchVZ) that
    // _updateVertical adds to pos.x/pos.z every airborne frame, so we arc clear
    // across the map (over rooftops — no mid-air collision) and land wherever the
    // descent meets ground / water / the void. `launched` gates the glide so plain
    // jumps/falls are untouched; it's cleared the instant we leave the arc
    // (landing, splashing in, sitting, jetpack, or void-respawn).
    this.launched = false;
    this._launchVX = 0;
    this._launchVZ = 0;
    // SWIM / FLOAT. `isWater(x,z)` is injected by the app (main.js → setIsWater)
    // so _updateVertical can tell OPEN WATER apart from the void; the default
    // returns false so legacy/single-arg constructor callers keep the old
    // fall+respawn behaviour. `waterY` is the sea surface height (overridable via
    // setIsWater). `swimming` is true while floating; `_swimT` drives the bob.
    this.isWater = () => false;
    this.waterY = -0.8;
    this.swimming = false;
    this._swimT = 0;
    // When seated, the seat object we're on; otherwise null. `sitting`/`seatY`
    // are the network-visible bits so remote players can pose us correctly.
    this.seat = null;
    this.sitting = false;
    this.seatY = 0;
    // Fired when we sit on / stand off a seat, so the app can open/close a game.
    this.onSit = null; // (seat) => void
    this.onStand = null; // (seat) => void

    // Your own name tag floats above your head too, so you can see yourself.
    this.label = makeNameLabel(name || "You");
    this.character.head.add(this.label);
    // Talking indicator over your own head, so you get feedback that your mic is
    // picking you up.
    this.indicator = makeSpeakingIndicator();
    this.character.head.add(this.indicator);
    this.bubble = null;
    this.bubbleTimer = 0;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    // Seated board-view camera scratch + smoothed aim point (eased separately so
    // the lookAt target glides instead of snapping when entering/leaving).
    this._seatCamPos = new THREE.Vector3();
    this._seatLook = new THREE.Vector3();
    this._seatLookTarget = new THREE.Vector3();
    this._seatLookSet = false;
  }

  get group() {
    return this.character.group;
  }

  setColor(hex) {
    this.character.setColor(hex);
  }

  // Inject the ocean's open-water predicate (and, optionally, its surface height).
  // Once set, descending over open water enters a SWIM/FLOAT state instead of the
  // void fall+respawn. `fn` is guarded so a missing/bad predicate never NaNs the
  // player — it just falls back to "no water anywhere" (the legacy behaviour).
  setIsWater(fn, waterY) {
    this.isWater = typeof fn === "function" ? fn : () => false;
    if (Number.isFinite(waterY)) this.waterY = waterY;
  }

  // Inject the orbital STATION deck rects + their world floor Y. While the player
  // stands on one of these rects, _updateVertical lifts them to stationFloorY
  // instead of pinning y=0, so they walk the station interior at altitude (the
  // rects are ALSO in `this.ground`, so _isGround already treats them as solid).
  setStation(rects, floorY) {
    this.stationRects = Array.isArray(rects) && rects.length ? rects : null;
    if (Number.isFinite(floorY)) this.stationFloorY = floorY;
  }

  setAppearance(app) {
    this.character.setAppearance(app);
  }

  getAppearance() {
    return this.character.getAppearance();
  }

  setSpeaking(on) {
    if (this.indicator) this.indicator.visible = on;
  }

  showChat(text) {
    if (this.bubble) {
      this.character.head.remove(this.bubble);
      this.bubble.element?.remove();
      this.bubble = null;
      this.bubbleTimer = 0;
    }
    this.bubble = makeChatBubble(text);
    this.character.head.add(this.bubble);
    this.bubbleTimer = Math.min(7, 2.5 + text.length * 0.05);
  }

  // Buy/hold an item from the coffee bar. Only one at a time — buying a new one
  // replaces (and discards) whatever you were already holding.
  holdItem(def) {
    if (!def) return;
    if (this.heldItem) this._removeHeld();
    const obj = def.build();
    this.character.handAnchor.add(obj);
    this.heldItem = { obj, def };
  }

  // Drop the held item onto the floor at your feet, freeing your hand.
  dropItem() {
    if (!this.heldItem) return;
    const def = this.heldItem.def;
    this._removeHeld();
    const drop = def.build();
    const fx = this.pos.x + Math.sin(this.facing) * 0.5;
    const fz = this.pos.z + Math.cos(this.facing) * 0.5;
    drop.position.set(fx, 0.1, fz);
    drop.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(drop);
    this.drops.push(drop);
    // Cap accumulated drops: remove + dispose the oldest ones beyond the limit
    // so the scene doesn't leak geometry/material for the whole session.
    while (this.drops.length > this.maxDrops) {
      const old = this.drops.shift();
      this.scene.remove(old);
      old.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
  }

  _removeHeld() {
    if (!this.heldItem) return;
    this.character.handAnchor.remove(this.heldItem.obj);
    this.heldItem.obj.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.heldItem = null;
  }

  // Display name of the item you're holding, or null.
  heldName() {
    return this.heldItem ? this.heldItem.def.name : null;
  }

  // Wire id of the item you're holding, or null. Used to sync held items so
  // remotes can rebuild the same mesh via items.js getItem(id).build().
  heldId() {
    return this.heldItem ? this.heldItem.def.id : null;
  }

  // `seatedView` (optional) is the board-view descriptor from
  // InWorldBoard.getSeatedView(): { active, center:{x,y,z}, seatRy }. When it is
  // active the camera eases to an over-the-table framing instead of the normal
  // trailing follow-cam; otherwise the follow-cam runs (and smoothly restores).
  update(dt, camera, seatedView = null) {
    const { move, orbit, zoom } = this.controls;

    // Space is contextual: stand up if seated, sit if a seat is in reach, else
    // hop. Keeping sit/stand on Space preserves stand-up-to-quit-a-game; the jump
    // only happens when there's nothing to sit on, so it never blocks sitting.
    // Always drain the Space edge so it can't leak between modes. While flying
    // (jetpack), Space is the ASCEND thrust (rides.js reads it via flyThrust), so
    // swallow the edge here without sitting/standing/jumping.
    const sitEdge = this.controls.consumeSit?.();
    if (sitEdge && !this.flying) {
      if (this.sitting) this._stand();
      else if (this._nearestSeat()) this._trySit();
      else this._jump();
    }

    // G drops whatever you're holding (the controls layer already ignores keys
    // while you're typing in chat, so this won't fire mid-message).
    if (this.controls.consumeDrop?.()) this.dropItem();

    // Camera-relative basis on the ground plane from the orbit yaw.
    this._fwd.set(Math.sin(orbit.yaw), 0, Math.cos(orbit.yaw)); // toward camera->player
    this._right.set(this._fwd.z, 0, -this._fwd.x);

    // move.z: +1 = backward (S), -1 = forward (W). Forward should head away from camera.
    const vx = -this._fwd.x * -move.z + this._right.x * move.x;
    const vz = -this._fwd.z * -move.z + this._right.z * move.x;

    const intent = Math.hypot(vx, vz);
    // Trying to move while seated stands you up so you can walk away.
    if (this.sitting && intent > 0.001) this._stand();
    this.moving = !this.sitting && intent > 0.001;

    // --- Sprint + stamina (WALK MODE ONLY) -----------------------------------
    // On foot (speedMul 1 — skating/driving set it to the ride multiplier, never
    // 1 — and not seated / not flying) Shift runs and Shift+Ctrl goes ULTRA,
    // draining stamina only while you're actually moving. Anything else regens it.
    // `sprintFactor` stacks onto the walk step below; it stays 1 whenever
    // speedMul !== 1, so a ride is NEVER sped up or slowed by this.
    let sprintFactor = 1;
    this.sprinting = false;
    const onFoot = (this.speedMul == null || this.speedMul === 1) && !this.sitting && !this.flying && !this.swimming;
    const sprintTier = onFoot ? (this.controls.sprintLevel?.() || 0) : 0;
    // Clear the empty-latch once we've regen'd back past the recover threshold.
    if (this._staminaEmpty && this.stamina >= STAMINA.recover) this._staminaEmpty = false;
    if (sprintTier > 0 && this.moving && this.stamina > 0 && !this._staminaEmpty) {
      this.sprinting = true;
      if (sprintTier >= 2) { sprintFactor = STAMINA.ultraSpeed; this.stamina -= STAMINA.ultraDrain * dt; }
      else { sprintFactor = STAMINA.runSpeed; this.stamina -= STAMINA.runDrain * dt; }
      if (this.stamina <= 0) { this.stamina = 0; this._staminaEmpty = true; } // force walk until it regens
    } else {
      this.stamina = Math.min(1, this.stamina + STAMINA.regen * dt);
    }
    this.staminaPct = this.stamina;

    if (this.moving && !this.launched) {
      const inv = 1 / intent;
      // speedMul lets a ride (skateboard) boost ground speed without touching the
      // base walk speed. Default 1 (plain walking). sprintFactor is the on-foot
      // run/ultra multiplier (1 when not sprinting, and always 1 on a ride).
      // While swimming, strokes are slower (SWIM.stroke); on land it stays 1.
      const step = PLAYER.speed * dt * (this.speedMul || 1) * sprintFactor * (this.swimming ? SWIM.stroke : 1);
      let nx = this.pos.x + vx * inv * step;
      let nz = this.pos.z + vz * inv * step;

      // Resolve collisions against furniture/walls. There's no longer a room
      // clamp — the building walls bound you indoors, and outdoors you can walk
      // right off the edge of the block (handled in _updateVertical).
      const r = resolveCollisions(nx, nz, PLAYER.radius, this.colliders);
      nx = r.x;
      nz = r.z;
      // Generous outer backstop so a fall can't fling the position to infinity.
      nx = Math.max(this.bounds.minX - 3, Math.min(this.bounds.maxX + 3, nx));
      nz = Math.max(this.bounds.minZ - 3, Math.min(this.bounds.maxZ + 3, nz));

      this.pos.x = nx;
      this.pos.z = nz;

      // Face travel direction (shortest-arc lerp).
      const targetFacing = Math.atan2(vx, vz);
      this.facing = lerpAngle(this.facing, targetFacing, Math.min(1, dt * PLAYER.turnSpeed));
    }

    // Stand on the ground, or fall off the edge of the block and respawn.
    this._updateVertical(dt);

    this.character.group.position.x = this.pos.x;
    this.character.group.position.z = this.pos.z;
    // Body yaw = travel facing + any in-air trick spin (0 while not skating).
    this.character.group.rotation.y = this.facing + (this.rideSpin || 0);
    this.character.update(dt, this.moving);
    // character.update() drives group.position.y (walk bob / seat drop); stack
    // the fall offset AND the skate trick lift (ollie/air/grind) on top of it
    // (both 0 while grounded / not skating).
    this.character.group.position.y += this.pos.y + (this.rideLift || 0);

    if (this.bubble) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.character.head.remove(this.bubble);
        this.bubble.element?.remove();
        this.bubble = null;
      }
    }

    if (seatedView && seatedView.active) {
      // Drop the camera near plane while seated. The global near (1.0) is tuned to
      // fight z-fighting at city distances, but at the over-the-table framing the
      // eye sits only ~0.65 m above the board, so a 1.0 m near plane CLIPS the near
      // half of the table ("half the table gone until I zoom out"). The seated view
      // looks down at the table with no distant geometry to z-fight, so a 0.2 m near
      // is safe here. Restored to the captured base near the moment we stand.
      if (this._baseNear == null) this._baseNear = camera.near;
      if (camera.near !== 0.2) { camera.near = 0.2; camera.updateProjectionMatrix(); }
      this._updateSeatedCamera(dt, camera, orbit, zoom, seatedView);
    } else {
      this._seatLookSet = false; // forget the seated aim so re-entry re-seeds it
      if (this._baseNear != null && camera.near !== this._baseNear) {
        camera.near = this._baseNear; camera.updateProjectionMatrix();
      }
      this._updateCamera(dt, camera, orbit, zoom);
    }
  }

  // Vertical physics: one gravity integrator serves both a jump (pos.y arcs up
  // then back) and walking off an edge (pos.y falls until respawn). While resting
  // on solid ground, pin to y=0.
  _updateVertical(dt) {
    if (this.sitting) {
      this.pos.y = 0; this.vy = 0; this.airborne = false; this.falling = false; this.swimming = false;
      if (this.launched) this._clearLaunch();
      return;
    }
    // FLY (jetpack): rides.js owns pos.y (altitude) this frame, so skip the
    // ground snap AND the void respawn — you can hover over land, sea, or the
    // void. Keep the gravity integrator disengaged so landing (flying=false)
    // resumes the normal walk/fall logic cleanly next frame.
    if (this.flying) {
      this.vy = 0; this.airborne = false; this.falling = false; this.swimming = false;
      if (this.launched) this._clearLaunch(); // jetpack took over — drop the cannon glide
      return;
    }
    const onGround = this._isGround(this.pos.x, this.pos.z);
    // OPEN WATER under us (only meaningful when NOT on a walkable rect). The
    // predicate is injected by the app; the default () => false keeps this false
    // everywhere so the classic fall+respawn runs when no ocean is wired.
    const overWater = !onGround && this.isWater(this.pos.x, this.pos.z) === true;
    // Float line: the body rides a touch above the sea surface so the head/torso
    // stay clear of the water (waterY = -0.8 + surfaceOffset 0.4 → pos.y ≈ -0.4).
    const swimY = this.waterY + SWIM.surfaceOffset;
    // Resting height when standing on ground at this XZ: the station deck altitude
    // inside a station rect, else 0 (the city/ocean). Only meaningful on ground.
    const floorY = onGround ? this._floorY(this.pos.x, this.pos.z) : 0;

    // --- SWIM / FLOAT --------------------------------------------------------
    // Already in the water: stay afloat (NEVER respawn) until we reach solid
    // ground or drift off the navigable sea.
    if (this.swimming) {
      if (onGround) { this._exitWater(); return; } // climbed out → walk again
      if (overWater) {
        if (this.airborne) {
          // A Space pop-up gave upward vy: arc it under gravity and re-settle onto
          // the surface when it falls back to the float line.
          this.vy -= FALL.gravity * dt;
          this.pos.y += this.vy * dt;
          this.falling = this.vy < 0;
          if (this.vy <= 0 && this.pos.y <= swimY) {
            this.pos.y = swimY; this.vy = 0; this.airborne = false; this.falling = false; this._swimT = 0;
          }
        } else {
          // Float: a gentle vertical bob around the surface line.
          this._swimT += dt;
          this.pos.y = swimY + Math.sin(this._swimT * SWIM.bobFreq) * SWIM.bobAmp;
          this.vy = 0; this.falling = false;
        }
        return;
      }
      // Drifted past the edge of the sea (rare): drop swim and fall through to the
      // normal walk/fall integrator below so the void respawn still protects us.
      this.swimming = false;
    }

    if (!this.airborne) {
      if (onGround) { this.pos.y = floorY; this.vy = 0; this.falling = false; return; }
      // Stepped off the edge with no jump: begin a fall from rest.
      this.airborne = true; this.falling = true; this.vy = 0;
    }
    // Airborne (rising from a jump or falling): integrate gravity.
    this.vy -= FALL.gravity * dt;
    this.pos.y += this.vy * dt;
    this.falling = this.vy < 0;
    // CANNON GLIDE: while launched, carry the horizontal velocity each airborne
    // frame so the shot arcs across the map. No collision is resolved here — we're
    // sailing OVER the rooftops, and the colliders are flat XZ footprints with no
    // height, so resolving them would wrongly snag us mid-air. Clamp to the same
    // generous outer backstop the walk integrator uses so position stays finite,
    // and aim the body along the glide so we face where we fly.
    if (this.launched) {
      this.pos.x += this._launchVX * dt;
      this.pos.z += this._launchVZ * dt;
      this.pos.x = Math.max(this.bounds.minX - 3, Math.min(this.bounds.maxX + 3, this.pos.x));
      this.pos.z = Math.max(this.bounds.minZ - 3, Math.min(this.bounds.maxZ + 3, this.pos.z));
      if (this._launchVX || this._launchVZ) this.facing = Math.atan2(this._launchVX, this._launchVZ);
    }
    // Land when descending back to the floor over solid ground. The floor is 0 on
    // the city/ocean and stationFloorY on the orbital station deck, so a hop on the
    // station settles back onto the deck (≈260) instead of plunging through it.
    if (this.vy <= 0 && this.pos.y <= floorY && onGround) {
      this.pos.y = floorY; this.vy = 0; this.airborne = false; this.falling = false;
      if (this.launched) this._clearLaunch(); // landed → resume normal walking
      return;
    }
    // Descending into OPEN WATER — splash in and start swimming instead of
    // falling into the void / respawning. Clamp to the float line so a fast fall
    // can't dunk us deep.
    if (this.vy <= 0 && overWater && this.pos.y <= swimY) {
      this._enterWater(swimY);
      return;
    }
    // Fell into the void (no water below) — respawn at the café.
    if (this.pos.y < FALL.respawnY) this._respawn();
  }

  // Enter the float: pin to the surface line, clear the fall, start the bob clock.
  _enterWater(swimY) {
    this.swimming = true;
    this.pos.y = swimY;
    this.vy = 0;
    this.airborne = false;
    this.falling = false;
    this._swimT = 0;
    if (this.launched) this._clearLaunch(); // splashed down mid-arc → end the glide
  }

  // Climb out onto solid ground: back to a normal standing pose.
  _exitWater() {
    this.swimming = false;
    this.pos.y = 0;
    this.vy = 0;
    this.airborne = false;
    this.falling = false;
    if (this.launched) this._clearLaunch();
  }

  // A standing hop. Only from the ground, on foot (not seated, not skating — a
  // mounted board sets speedMul to the skate multiplier, never 1), and not
  // already airborne. So Space-to-hop can't double-fire with the skate ollie.
  _jump() {
    if (this.sitting) return;
    if (this.speedMul != null && this.speedMul !== 1) return; // on a board → no hop
    // Swimming: Space pops you partly out of the water (a smaller push than a
    // ground jump). _updateVertical arcs it and re-settles onto the surface.
    if (this.swimming) {
      if (this.airborne) return; // already mid pop-up
      this.vy = SWIM.hopV;
      this.airborne = true;
      this.falling = false;
      return;
    }
    if (this.airborne) return;
    if (!this._isGround(this.pos.x, this.pos.z)) return; // over a void → already falling
    this.vy = JUMP_V;
    this.airborne = true;
    this.falling = false;
  }

  _isGround(x, z) {
    for (const g of this.ground) {
      if (x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) return true;
    }
    return false;
  }

  // World Y the player should rest at when standing on ground at (x,z): the
  // station deck altitude inside a station rect, else 0 (the city/ocean ground).
  _floorY(x, z) {
    if (this.stationRects) {
      for (const r of this.stationRects) {
        if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return this.stationFloorY;
      }
    }
    return 0;
  }

  _respawn() {
    if (this.sitting) this._stand();
    this.pos.set(this.spawn.x, 0, this.spawn.z);
    this.vy = 0;
    this.falling = false;
    this.airborne = false;
    this.swimming = false;
    this.facing = Math.PI;
    if (this.launched) this._clearLaunch(); // overshot into the void → land back at the cafe
  }

  // Nearest seat within reach, or null. Note: occupancy isn't tracked on the
  // client, so this may return a seat a remote player is already using.
  _nearestSeat() {
    let best = null;
    let bestD = SEAT.range * SEAT.range;
    for (const s of this.seats) {
      const dx = s.x - this.pos.x;
      const dz = s.z - this.pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  _trySit() {
    const seat = this._nearestSeat();
    if (!seat) return;
    this.seat = seat;
    this.sitting = true;
    this.seatY = seat.seatY;
    this.moving = false;
    // Snap onto the seat and face the way the seat points.
    this.pos.x = seat.x;
    this.pos.z = seat.z;
    this.facing = seat.ry;
    this.character.setSeated(true, seat.seatY);
    this.onSit?.(seat);
  }

  _stand() {
    const seat = this.seat;
    const was = this.sitting;
    this.seat = null;
    this.sitting = false;
    this.character.setSeated(false);
    if (was) this.onStand?.(seat);
  }

  // Public stand-up, used by the game overlay's "Leave game" button.
  standUp() {
    if (this.sitting) this._stand();
  }

  // Fire the player out of the SECRET CANNON. `v` = { vx, vy, vz } from
  // cannon.launch(): vy is the initial upward speed and (vx, vz) the horizontal
  // glide added to pos each airborne frame until landing, so we arc across the
  // city. Robust by construction: bad/NaN input is ignored, any current state is
  // cleared (stand up if seated, cancel swim/jetpack), and the arc resolves
  // through the existing land / splash / void-respawn paths so it can never wedge.
  launchSelf(v) {
    if (!v) return;
    const vx = +v.vx, vy = +v.vy, vz = +v.vz;
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) return;
    if (this.sitting) this._stand();
    this.swimming = false;
    this.flying = false;
    this.vy = vy;
    this.airborne = true;
    this.falling = vy < 0;
    this.launched = true;
    this._launchVX = vx;
    this._launchVZ = vz;
  }

  // Stop the cannon glide (called the instant we leave the launch arc).
  _clearLaunch() {
    this.launched = false;
    this._launchVX = 0;
    this._launchVZ = 0;
  }

  // Hint text for the HUD: prompt to sit when near a seat, to stand when seated.
  sitPromptText() {
    if (this.sitting) return "Press Space to stand";
    return this._nearestSeat() ? "Press Space to sit" : null;
  }

  // Seated board-view: ease the camera to a comfortable over-the-table framing
  // centred on the board, oriented so the local player's near edge is at the
  // bottom of the screen. The camera orbits BEHIND the player (offset along
  // -facing from the board centre), so orbit.yaw's baseline is seatRy+PI (set by
  // main.js via controls.setSeated). Gentle orbit + zoom apply but stay clamped
  // (the clamps live in controls.js). Position and aim are lerped so entering /
  // leaving the seated view glides instead of snapping.
  _updateSeatedCamera(dt, camera, orbit, zoom, view) {
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    const c = view.center; // board / table centre
    const seatY = (this.seat && this.seat.seatY) || this.seatY || 0;

    // Horizontal forward = from the seat toward the board centre. Falls back to
    // the body facing if the seat sits exactly on centre (shouldn't happen).
    this._fwd.set(c.x - this.pos.x, 0, c.z - this.pos.z);
    if (this._fwd.lengthSq() < 1e-6) this._fwd.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this._fwd.normalize();

    // Eye at the seated player's head, leaned a touch toward the table so their
    // own head/body stays behind the camera. Zoom dollies the eye forward + down.
    const zf = cl(zoom.factor, SEATED_CAM.zoomMin, SEATED_CAM.zoomMax);
    // Two signed phases hinged on the neutral anchor: zoomIn (>0 only below
    // neutral) leans the eye over the board exactly as before; zoomOut (>0 only
    // above neutral) dollies the eye back along -fwd and lifts it so the whole
    // board fits when scrolled out.
    const zoomIn = cl((SEATED_CAM.zoomNeutral - zf) / (SEATED_CAM.zoomNeutral - SEATED_CAM.zoomMin), 0, 1);
    const zoomOut = cl((zf - SEATED_CAM.zoomNeutral) / (SEATED_CAM.zoomMax - SEATED_CAM.zoomNeutral), 0, 1);
    // Per-game pull-back (battleship ONLY): view.zoom > 1 dollies the eye further
    // back along -fwd and lifts it so the larger board fits. zoom = 1 (every other
    // game) leaves the framing exactly as before. The player can still scroll.
    const camZoom = (view.zoom && view.zoom > 0) ? view.zoom : 1;
    const lean = SEATED_CAM.eyeForward + zoomIn * SEATED_CAM.zoomLean - zoomOut * SEATED_CAM.zoomBack - (camZoom - 1) * 0.55;
    const eyeY = seatY + SEATED_CAM.eyeHeight - zoomIn * SEATED_CAM.zoomDrop + zoomOut * SEATED_CAM.zoomRise + (camZoom - 1) * 0.5;
    this._seatCamPos.set(
      this.pos.x + this._fwd.x * lean,
      eyeY,
      this.pos.z + this._fwd.z * lean
    );

    // Look-around: yaw glances left/right from the seat-facing baseline; pitch
    // tilts the aim between the board (down) and the opponent's face (up).
    const baseYaw = (view.seatRy != null ? view.seatRy : this.facing) + Math.PI;
    // Negated so dragging matches the walk-cam feel (was inverted at the table).
    const yawDelta = -cl(orbit.yaw - baseYaw, -SEATED_CAM.yawRange, SEATED_CAM.yawRange);
    const cy = Math.cos(yawDelta), sy = Math.sin(yawDelta);
    const fx = this._fwd.x * cy - this._fwd.z * sy;
    const fz = this._fwd.x * sy + this._fwd.z * cy;
    const aimDist = Math.max(0.25, Math.hypot(c.x - this._seatCamPos.x, c.z - this._seatCamPos.z));
    const pitch = cl(orbit.pitch, SEATED_CAM.minPitch, SEATED_CAM.maxPitch);
    const aimY = c.y + (SEATED_CAM.basePitch - pitch) * SEATED_CAM.lookPitchGain;
    const lookTarget = this._seatLookTarget.set(
      this._seatCamPos.x + fx * aimDist,
      aimY,
      this._seatCamPos.z + fz * aimDist
    );
    if (!this._seatLookSet) {
      this._seatLook.copy(lookTarget);
      this._seatLookSet = true;
    }
    const k = Math.min(1, dt * SEATED_CAM.ease);
    camera.position.lerp(this._seatCamPos, k);
    this._seatLook.lerp(lookTarget, k);
    camera.lookAt(this._seatLook);
  }

  _updateCamera(dt, camera, orbit, zoom) {
    const dist = CAMERA.distance * zoom.factor;
    const horiz = Math.cos(orbit.pitch) * dist;
    const vert = Math.sin(orbit.pitch) * dist;

    const cx = this.pos.x + Math.sin(orbit.yaw) * horiz;
    const cz = this.pos.z + Math.cos(orbit.yaw) * horiz;
    const cy = this.pos.y + vert + CAMERA.baseHeight;

    // Camera bounds. INDOORS (only when actually inside the original café room
    // footprint near the origin) keep the camera below the ceiling and off the
    // walls. Everywhere else is the OPEN WORLD — the expanded city, the ocean, and
    // the islands, which sprawl to roughly x∈[-190,190], z∈[-60,330] including
    // islands at NEGATIVE z. The old check (`pos.z > WORLD.depth/2`) wrongly
    // treated anything south of the tiny room as "indoors" and yanked the camera
    // back toward the café — that was the "camera 10000 miles away from the island"
    // bug. Use the full walkable bounds (this.bounds already unions every ground
    // rect, islands included) with margin so the cam roams freely outdoors.
    const halfW = WORLD.width / 2, halfD = WORLD.depth / 2;
    const inCafe =
      this.pos.x > -halfW - 0.5 && this.pos.x < halfW + 0.5 &&
      this.pos.z > -halfD - 0.5 && this.pos.z < halfD + 0.5;
    let limXmin, limXmax, limZmin, limZmax, minY, maxY;
    if (inCafe) {
      limXmin = -(halfW - 0.4); limXmax = halfW - 0.4;
      limZmin = -(halfD - 0.4); limZmax = halfD - 0.4;
      minY = 1.3;
      maxY = WORLD.wallHeight - 0.45;
    } else {
      limXmin = this.bounds.minX - 8; limXmax = this.bounds.maxX + 8;
      limZmin = this.bounds.minZ - 8; limZmax = this.bounds.maxZ + 8;
      minY = -10;
      maxY = 320; // high ceiling so the cam can rise with jumps / flight / altitude
    }

    this._camPos.set(
      Math.max(limXmin, Math.min(limXmax, cx)),
      Math.max(minY, Math.min(maxY, cy)),
      Math.max(limZmin, Math.min(limZmax, cz))
    );

    const k = Math.min(1, dt * CAMERA.follow);
    camera.position.lerp(this._camPos, k);
    camera.lookAt(this.pos.x, this.pos.y + CAMERA.lookHeight, this.pos.z);
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Axis-aligned bounding box of a set of ground rectangles, used to clamp the
// outdoor camera and keep the player's position finite while falling.
function unionBounds(rects) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.minX);
    maxX = Math.max(maxX, r.maxX);
    minZ = Math.min(minZ, r.minZ);
    maxZ = Math.max(maxZ, r.maxZ);
  }
  if (!isFinite(minX)) return { minX: -13, maxX: 13, minZ: -11, maxZ: 11 };
  return { minX, maxX, minZ, maxZ };
}
