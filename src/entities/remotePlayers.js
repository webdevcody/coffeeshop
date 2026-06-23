// Manages every other person in the room. Each remote player is a Character plus
// a name label and a transient chat bubble. Network updates set a *target*
// transform; we smoothly interpolate toward it each frame so movement looks
// fluid despite the ~16 updates/sec coming over the wire.

import { Character } from "./character.js";
import {
  makeNameLabel,
  makeChatBubble,
  makeSpeakingIndicator,
  makeCantHearIndicator,
} from "../ui/labels.js";
import { NET } from "../config.js";

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<string, object>} */
    this.players = new Map();
  }

  add(p) {
    if (this.players.has(p.id)) return this.players.get(p.id);
    const character = new Character(p.color, p.id);
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
    };
    this.players.set(p.id, entry);
    return entry;
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
    this.scene.remove(e.character.group);
    e.character.dispose();
    this.players.delete(id);
  }

  setState(id, x, z, ry, moving, sitting = false, seatY = 0) {
    const e = this.players.get(id);
    if (!e) return;
    e.target.x = x;
    e.target.z = z;
    e.target.ry = ry;
    e.moving = moving;
    e.character.setSeated(!!sitting, seatY);
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
