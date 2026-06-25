// Manages every other person in the room. Each remote player is a Character plus
// a name label and a transient chat bubble. Network updates set a *target*
// transform; we smoothly interpolate toward it each frame so movement looks
// fluid despite the ~16 updates/sec coming over the wire.

import { Character } from "./character.js";
import { makeCar } from "./car.js";
import { makeSkateboard } from "./skateboard.js";
import { getItem } from "../world/items.js";
import {
  makeNameLabel,
  makeChatBubble,
  makeSpeakingIndicator,
  makeCantHearIndicator,
  setLabelText,
} from "../ui/labels.js";
import { NET } from "../config.js";

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<string, object>} */
    this.players = new Map();
  }

  add(p) {
    // Reconnect / re-join: the client re-sends `join` on every reconnect and the
    // server answers with a `welcome` carrying the FULL roster. If this id is
    // already known, update the existing entry in place with the fresh snapshot
    // instead of bailing out (which would leave a stale avatar with outdated
    // appearance / position / state).
    const existing = this.players.get(p.id);
    if (existing) {
      const e = existing;
      e.name = p.name;
      e.target.x = p.x;
      e.target.z = p.z;
      e.target.ry = p.ry;
      e.character.group.position.set(p.x, 0, p.z);
      e.character.group.rotation.y = p.ry;
      e.character.setAppearance({ color: p.color, skin: p.skin, hair: p.hair });
      e.character.setSeated(!!p.sitting, p.seatY || 0);
      if (e.label) setLabelText(e.label, p.name);
      e.cantHear.visible = !!p.deafened;
      e.color = p.color;
      this._setRide(e, p.ride || null);
      this._setHeld(e, p.held || null);
      return e;
    }
    const character = new Character({ color: p.color, skin: p.skin, hair: p.hair }, p.id);
    character.group.position.set(p.x, 0, p.z);
    character.group.rotation.y = p.ry;
    if (p.sitting) character.setSeated(true, p.seatY || 0);
    this.scene.add(character.group);

    const label = makeNameLabel(p.name);
    character.head.add(label);

    const indicator = makeSpeakingIndicator();
    character.head.add(indicator);

    // "Can't hear you" badge — shown when this player has deafened or muted you.
    // A player who joins already deafened arrives with `deafened` set.
    const cantHear = makeCantHearIndicator();
    cantHear.visible = !!p.deafened;
    character.head.add(cantHear);

    const entry = {
      id: p.id,
      name: p.name,
      character,
      label,
      indicator,
      cantHear,
      bubble: null,
      bubbleTimer: 0,
      target: { x: p.x, z: p.z, ry: p.ry },
      moving: false,
      // Body color (kept so a remote car can be painted to match this player).
      color: p.color,
      // Ride state: tag + the meshes we attach for it (built lazily in _setRide).
      ride: null,
      rideGroup: null, // car group, lives in scene space, follows the lerp
      board: null, // skateboard group, parented under the avatar's feet
      // Held item: the wire id + the mesh we attach under the hand (built in _setHeld).
      held: null,
      heldObj: null,
    };
    this.players.set(p.id, entry);
    // Player may have joined while already driving/skating — show the mesh now.
    this._setRide(entry, p.ride || null);
    // Player may have joined while already holding an item — show it now.
    this._setHeld(entry, p.held || null);
    return entry;
  }

  // Attach/detach the car or skateboard mesh for a remote player when their ride
  // tag changes. Built once and reused; meshes are torn down on change/remove so
  // there is no per-frame allocation and nothing leaks.
  _setRide(e, ride) {
    if (e.ride === ride) return; // no-op if unchanged
    e.ride = ride;
    // Tear down whatever was attached previously.
    if (e.rideGroup) {
      this.scene.remove(e.rideGroup);
      e.rideGroup = null;
    }
    if (e.board && e.board.parent) e.board.parent.remove(e.board);
    e.board = null;

    const body = e.character.group;
    if (ride === "car") {
      // Fresh car mesh painted to this player's color. We only use .group (never
      // edit car.js). The avatar is hidden so the car represents the player.
      e.rideGroup = makeCar({ color: e.color }).group;
      this.scene.add(e.rideGroup);
      body.visible = false;
    } else if (ride === "skate") {
      // Board rides under the (still-visible) avatar's feet, same offset the local
      // rides.js uses, parented so it moves with the character automatically.
      e.board = makeSkateboard();
      e.board.position.set(0, 0, 0.12);
      body.add(e.board);
      body.visible = true;
    } else {
      // Walking: avatar visible, nothing attached.
      body.visible = true;
    }
  }

  // Attach/detach the held coffee-bar item mesh on this remote's hand when their
  // held id changes. Built once via items.js getItem(id).build() and reused;
  // disposed on change/remove so there's no per-frame allocation and no leak.
  _setHeld(e, held) {
    if (e.held === held) return; // no-op if unchanged
    e.held = held;
    if (e.heldObj) {
      e.character.handAnchor.remove(e.heldObj);
      e.heldObj.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      e.heldObj = null;
    }
    const def = held ? getItem(held) : null; // unknown/null id → empty hand
    if (def) {
      e.heldObj = def.build();
      e.character.handAnchor.add(e.heldObj);
    }
  }

  remove(id) {
    const e = this.players.get(id);
    if (!e) return;
    // Detach CSS2D labels/bubbles from the head first. Removing the group from
    // the scene only fires 'removed' on the group itself, not deep children, so
    // their DOM nodes would otherwise leak. Detaching here fires their handler.
    if (e.label) e.character.head.remove(e.label);
    if (e.indicator) e.character.head.remove(e.indicator);
    if (e.cantHear) e.character.head.remove(e.cantHear);
    if (e.bubble) e.character.head.remove(e.bubble);
    // Detach a remote car (scene-space mesh) so a disconnect mid-drive doesn't
    // leak it. The board is a child of the avatar group and goes with it.
    if (e.rideGroup) this.scene.remove(e.rideGroup);
    // The held mesh is parented under character.handAnchor (inside the group), so
    // removing the group detaches it; dispose its geometry/material here for
    // symmetry with _setRide's teardown and to guarantee no GPU leak.
    if (e.heldObj) e.heldObj.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.scene.remove(e.character.group);
    e.character.dispose();
    this.players.delete(id);
  }

  setState(id, x, z, ry, moving, sitting = false, seatY = 0, ride = null, held = null) {
    const e = this.players.get(id);
    if (!e) return;
    e.target.x = x;
    e.target.z = z;
    e.target.ry = ry;
    e.moving = moving;
    e.character.setSeated(!!sitting, seatY);
    this._setRide(e, ride || null);
    this._setHeld(e, held || null);
  }

  // Apply a live appearance change (skin / hair / clothing) from a remote player.
  setAppearance(id, app) {
    const e = this.players.get(id);
    if (e) e.character.setAppearance(app);
  }

  // Toggle the floating "talking" indicator above a remote player's head.
  setSpeaking(id, on) {
    const e = this.players.get(id);
    if (e && e.indicator) e.indicator.visible = on;
  }

  // Toggle the "can't hear you" badge above a remote player's head — set when
  // that player has deafened (muted everyone) or muted you specifically.
  setCantHear(id, on) {
    const e = this.players.get(id);
    if (e && e.cantHear) e.cantHear.visible = !!on;
  }

  showChat(id, text) {
    const e = this.players.get(id);
    if (!e) return;
    if (e.bubble) e.character.head.remove(e.bubble);
    e.bubble = makeChatBubble(text);
    e.character.head.add(e.bubble);
    e.bubbleTimer = Math.min(7, 2.5 + text.length * 0.05);
  }

  // Returns array of {id, position, character} for voice proximity / etc.
  list() {
    return [...this.players.values()];
  }

  update(dt) {
    const k = Math.min(1, dt * NET.lerp);
    for (const e of this.players.values()) {
      const g = e.character.group;
      g.position.x += (e.target.x - g.position.x) * k;
      g.position.z += (e.target.z - g.position.z) * k;
      g.rotation.y = lerpAngle(g.rotation.y, e.target.ry, k);
      e.character.update(dt, e.moving);

      // The car group lives in scene space (not parented to the avatar), so it
      // follows the lerped transform here. Both sit at world y=0. The board needs
      // no handling — it's parented under the avatar and moves with it.
      if (e.rideGroup) {
        e.rideGroup.position.set(g.position.x, 0, g.position.z);
        e.rideGroup.rotation.y = g.rotation.y;
      }

      if (e.bubble) {
        e.bubbleTimer -= dt;
        if (e.bubbleTimer <= 0) {
          e.character.head.remove(e.bubble);
          e.bubble.element?.remove();
          e.bubble = null;
        }
      }
    }
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
