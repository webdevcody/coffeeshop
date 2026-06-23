// The player you control. Owns a Character, applies camera-relative movement
// with collision against the room, rotates the body toward travel direction,
// and drives a trailing third-person camera that orbits with the mouse/touch.

import * as THREE from "three";
import { Character } from "./character.js";
import { resolveCollisions } from "../world/collision.js";
import { makeNameLabel, makeChatBubble, makeSpeakingIndicator } from "../ui/labels.js";
import { PLAYER, CAMERA, WORLD, SEAT } from "../config.js";

export class LocalPlayer {
  constructor(scene, controls, colliders, color, name, seats = []) {
    this.controls = controls;
    this.colliders = colliders;
    this.seats = seats;
    this.character = new Character(color, name || "me");
    this.character.group.position.set(0, 0, 4);
    this.character.group.rotation.y = Math.PI;
    scene.add(this.character.group);

    this.pos = new THREE.Vector3(0, 0, 4);
    this.facing = Math.PI;
    this.moving = false;
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
  }

  get group() {
    return this.character.group;
  }

  setColor(hex) {
    this.character.setColor(hex);
  }

  setSpeaking(on) {
    if (this.indicator) this.indicator.visible = on;
  }

  showChat(text) {
    if (this.bubble) this.character.head.remove(this.bubble);
    this.bubble = makeChatBubble(text);
    this.character.head.add(this.bubble);
    this.bubbleTimer = Math.min(7, 2.5 + text.length * 0.05);
  }

  update(dt, camera) {
    const { move, orbit, zoom } = this.controls;

    // Space toggles sitting: sit on the nearest seat, or stand back up.
    if (this.controls.consumeSit?.()) {
      if (this.sitting) this._stand();
      else this._trySit();
    }

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

    if (this.moving) {
      const inv = 1 / intent;
      const step = PLAYER.speed * dt;
      let nx = this.pos.x + vx * inv * step;
      let nz = this.pos.z + vz * inv * step;

      // Resolve collisions against furniture/walls, then clamp to room bounds.
      const r = resolveCollisions(nx, nz, PLAYER.radius, this.colliders);
      nx = r.x;
      nz = r.z;
      const lim = WORLD.width / 2 - PLAYER.radius - 0.1;
      const limZ = WORLD.depth / 2 - PLAYER.radius - 0.1;
      nx = Math.max(-lim, Math.min(lim, nx));
      nz = Math.max(-limZ, Math.min(limZ, nz));

      this.pos.x = nx;
      this.pos.z = nz;

      // Face travel direction (shortest-arc lerp).
      const targetFacing = Math.atan2(vx, vz);
      this.facing = lerpAngle(this.facing, targetFacing, Math.min(1, dt * PLAYER.turnSpeed));
    }

    this.character.group.position.x = this.pos.x;
    this.character.group.position.z = this.pos.z;
    this.character.group.rotation.y = this.facing;
    this.character.update(dt, this.moving);

    if (this.bubble) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.character.head.remove(this.bubble);
        this.bubble.element?.remove();
        this.bubble = null;
      }
    }

    this._updateCamera(dt, camera, orbit, zoom);
  }

  // Nearest unoccupied-by-us seat within reach, or null.
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

  // Hint text for the HUD: prompt to sit when near a seat, to stand when seated.
  sitPromptText() {
    if (this.sitting) return "Press Space to stand";
    return this._nearestSeat() ? "Press Space to sit" : null;
  }

  _updateCamera(dt, camera, orbit, zoom) {
    const dist = CAMERA.distance * zoom.factor;
    const horiz = Math.cos(orbit.pitch) * dist;
    const vert = Math.sin(orbit.pitch) * dist;

    // Keep the camera inside the room: below the ceiling and off the walls, so it
    // never pops above the ceiling plane or clips through a wall.
    const halfW = WORLD.width / 2 - 0.4;
    const halfD = WORLD.depth / 2 - 0.4;
    const maxY = WORLD.wallHeight - 0.45;

    const cx = this.pos.x + Math.sin(orbit.yaw) * horiz;
    const cz = this.pos.z + Math.cos(orbit.yaw) * horiz;
    const cy = this.pos.y + vert + CAMERA.baseHeight;

    this._camPos.set(
      Math.max(-halfW, Math.min(halfW, cx)),
      Math.max(1.3, Math.min(maxY, cy)),
      Math.max(-halfD, Math.min(halfD, cz))
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
