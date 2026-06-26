// Manages every other person in the room. Each remote player is a Character plus
// a name label and a transient chat bubble. Network updates set a *target*
// transform; we smoothly interpolate toward it each frame so movement looks
// fluid despite the ~16 updates/sec coming over the wire.
//
// WEAPONS: a remote player's FIRE is fully visible — main.js replays every "shot"
// relay through weapons.spawnRemoteShot, so their tracers / rockets / grenades +
// explosions spawn in shared world space for everyone. We intentionally do NOT
// also attach an idle held-weapon mesh to a remote hand here: weapons.js exposes
// only the LOCAL player's three singleton hand-meshes (no per-remote builder to
// clone), so mirroring the equipped weapon would need a mesh factory in weapons.js
// (off-limits) plus an equipped-kind field in the state protocol. The shot relay
// already satisfies the multiplayer-visible requirement without that.

import { Character } from "./character.js";
import {
  buildCarProxy,
  buildBoatProxy,
  buildRocketProxy,
  buildPlaneProxy,
  buildHeliProxy,
  buildSkateProxy,
  buildJetpackProxy,
} from "./rideProxies.js";
import { getItem } from "../world/items.js";
import {
  makeNameLabel,
  makeChatBubble,
  makeSpeakingIndicator,
  makeCantHearIndicator,
  setLabelText,
} from "../ui/labels.js";
import { NET } from "../config.js";

// Sea surface height — mirrors ocean.js's waterY so a remote player's boat floats
// at the same level as the local sea (this module can't see the live ocean instance).
const WATER_Y = -0.8;
// Rocket base sits on the pad platform top (mirrors rocket.js ROCKET.padTop), so a
// remote rocket on the ground rests level with the pad.
const ROCKET_BASE_Y = 0.5;
// Where a remote's jetpack mounts on their back / the board under their feet
// (mirrors rides.js mountJetpack / mountBoard).
const JETPACK_BACK_Y = 1.12;
const JETPACK_BACK_Z = -0.14;
const BOARD_Z = 0.12;

// --- Ride pose tables -------------------------------------------------------
// "rig" rides build a scene-space proxy the seated avatar sits ON; "worn" rides
// parent a proxy onto the still-standing avatar. For each rig ride: SEAT_Y is the
// local height in the proxy where the seated avatar's hips rest (the proxy is
// built with its seat at local XZ origin, so the avatar drops straight onto it),
// and RIG_BASE_Y is the vertical offset of the whole rig's base above world 0
// (boat floats at the sea surface; the rocket rests on the pad top). The synced
// altitude (curY) stacks on top of RIG_BASE_Y so flyers rise/fall as one rig.
const SEAT_Y = { car: 0.6, boat: 0.34, rocket: 1.25, plane: 0.58, heli: 0.6 };
const RIG_BASE_Y = { car: 0, boat: WATER_Y, rocket: ROCKET_BASE_Y, plane: 0, heli: 0 };
// SHARED WORLD VEHICLES: each of these rig rides is a server-authoritative shared
// object, so a remote piloting one gets its proxy posed from the canonical pose
// (getVehicle(id)) instead of just chasing that avatar's lerped position — landing
// it on the exact spot everyone agrees on. The rocket is NOT shared (no seed), so
// it's absent here and its proxy keeps tracking the avatar.
const SHARED_VEHICLE_ID = { car: "car-1", boat: "boat-1", plane: "plane-1", heli: "heli-1" };

export class RemotePlayers {
  constructor(scene, opts = {}) {
    this.scene = scene;
    /** @type {Map<string, object>} */
    this.players = new Map();
    // SHARED CAR: getVehicle(id) returns the server-authoritative pose for a shared
    // world vehicle ("car-1"). When a remote player is driving the car we pose their
    // car PROXY from this so it lands on the exact authoritative spot for everyone,
    // rather than just chasing that avatar's (lerped) position. null when unwired.
    this.getVehicle = opts.getVehicle || null;
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
      // Table-sit state is stored and re-applied every frame in update() (so a
      // vehicle pose can override it without the wire flag fighting back).
      e.sitting = !!p.sitting;
      e.seatY = p.seatY || 0;
      e.character.setSeated(e.sitting, e.seatY);
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
      target: { x: p.x, z: p.z, ry: p.ry, y: p.y || 0 },
      curY: p.y || 0, // smoothed render height (drives flyers' altitude)
      moving: false,
      // Table-sit state from the wire (applied each frame in update(); a ride pose
      // overrides it).
      sitting: !!p.sitting,
      seatY: p.seatY || 0,
      // Body color (kept so a remote car/heli is painted to match this player).
      color: p.color,
      // Ride state: tag + the proxy meshes we attach for it (built lazily in
      // _setRide, one per entity, reused across frames).
      ride: null,
      rideGroup: null, // rig proxy (car/boat/rocket/plane/heli) in scene space, follows the lerp
      worn: null, // worn proxy (skateboard under the feet / jetpack on the back), parented to the avatar
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

  // Attach/detach the CHEAP proxy vehicle for a remote player when their ride tag
  // changes. The proxy is built once (lazily, from rideProxies.js) and reused
  // every frame; it's torn down + GPU-disposed on change/remove so there is no
  // per-frame allocation and nothing leaks. A "rig" ride (car/boat/rocket/plane/
  // heli) gets a scene-space proxy the seated avatar sits ON (posed in update());
  // a "worn" ride (skate/jetpack) parents its proxy onto the still-standing avatar.
  _setRide(e, ride) {
    if (e.ride === ride) return; // no-op if unchanged
    e.ride = ride;
    // Tear down whatever was attached previously (scene rig proxy or worn proxy).
    if (e.rideGroup) {
      this.scene.remove(e.rideGroup);
      disposeGroup(e.rideGroup);
      e.rideGroup = null;
    }
    if (e.worn) {
      if (e.worn.parent) e.worn.parent.remove(e.worn);
      disposeGroup(e.worn);
      e.worn = null;
    }

    const body = e.character.group;
    body.visible = true; // the avatar is always visible — we pose it on the vehicle

    if (ride === "car") {
      e.rideGroup = buildCarProxy(e.color); // painted to this player's color
      this.scene.add(e.rideGroup);
    } else if (ride === "boat") {
      e.rideGroup = buildBoatProxy();
      this.scene.add(e.rideGroup);
    } else if (ride === "rocket") {
      e.rideGroup = buildRocketProxy();
      this.scene.add(e.rideGroup);
    } else if (ride === "plane") {
      e.rideGroup = buildPlaneProxy();
      this.scene.add(e.rideGroup);
    } else if (ride === "heli") {
      e.rideGroup = buildHeliProxy(e.color);
      this.scene.add(e.rideGroup);
    } else if (ride === "jetpack") {
      // Pack rides on the avatar's back, the same mount rides.js uses locally,
      // parented so it tracks the character (and rises with it) automatically.
      e.worn = buildJetpackProxy();
      e.worn.position.set(0, JETPACK_BACK_Y, JETPACK_BACK_Z);
      body.add(e.worn);
    } else if (ride === "skate") {
      // Board rides under the avatar's feet, same offset rides.js uses locally.
      e.worn = buildSkateProxy();
      e.worn.position.set(0, 0, BOARD_Z);
      body.add(e.worn);
    }
    // ride === null → walking: avatar visible, no proxy attached.
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
    // Detach + dispose a remote rig proxy (scene-space mesh) so a disconnect
    // mid-ride doesn't leak it. The worn proxy is a child of the avatar group and
    // goes with it, but dispose its GPU resources here too.
    if (e.rideGroup) { this.scene.remove(e.rideGroup); disposeGroup(e.rideGroup); }
    if (e.worn) disposeGroup(e.worn);
    // The held mesh is parented under character.handAnchor (inside the group), so
    // removing the group detaches it; dispose its geometry/material here for
    // symmetry with _setRide's teardown and to guarantee no GPU leak.
    if (e.heldObj) e.heldObj.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.scene.remove(e.character.group);
    e.character.dispose();
    this.players.delete(id);
  }

  setState(id, x, z, ry, moving, sitting = false, seatY = 0, ride = null, held = null, y = 0) {
    const e = this.players.get(id);
    if (!e) return;
    e.target.x = x;
    e.target.z = z;
    e.target.ry = ry;
    e.target.y = y || 0; // height above ground (flying/rocket/jumping)
    e.moving = moving;
    // Store table-sit state; update() resolves the actual seated pose each frame
    // (a vehicle pose takes priority over the wire's table-sit flag).
    e.sitting = !!sitting;
    e.seatY = seatY;
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
      e.curY += (e.target.y - e.curY) * k; // smooth the synced altitude
      g.rotation.y = lerpAngle(g.rotation.y, e.target.ry, k);

      // Resolve the seated pose BEFORE character.update animates it: a rig vehicle
      // seats the avatar at its proxy's seat height; otherwise honor the wire's
      // table-sit flag. Driven every frame so the (per-snapshot) table-sit flag
      // can't un-seat a driver between ride-tag changes.
      const seatY = SEAT_Y[e.ride];
      if (seatY !== undefined) e.character.setSeated(true, seatY);
      else e.character.setSeated(e.sitting, e.seatY);

      e.character.update(dt, e.moving);
      // character.update sets group.position.y for the walk bob / seat drop; stack
      // the rig base (e.g. the boat's sea surface) + the synced altitude on top so
      // a remote flyer (jetpack/rocket/plane/heli) rises off the ground — avatar and
      // vehicle together — for everyone, instead of skating along at y=0.
      g.position.y += e.curY + (RIG_BASE_Y[e.ride] || 0);

      // The rig proxy (car/boat/rocket/plane/heli) lives in scene space (not
      // parented to the avatar), so it tracks the lerped XZ + heading + altitude
      // here, sharing the avatar's seat origin so the posed avatar sits in it. The
      // worn proxy (board/jetpack) is parented under the avatar and moves with it.
      if (e.rideGroup) {
        // SHARED VEHICLES: a remote piloting the shared car / boat / plane / heli gets
        // its proxy posed from the server-authoritative pose (so it matches the spot
        // everyone sees), falling back to this avatar's lerped position if the pose
        // isn't known yet. The shared pose carries only x/z/heading, so altitude still
        // comes from the synced curY (flyers rise on top of their rig base; a car/boat
        // sits at curY≈0). The rocket isn't shared, so it tracks the avatar (sv null).
        const vid = SHARED_VEHICLE_ID[e.ride];
        const sv = vid && this.getVehicle ? this.getVehicle(vid) : null;
        if (sv) {
          e.rideGroup.position.set(sv.x, (RIG_BASE_Y[e.ride] || 0) + e.curY, sv.z);
          e.rideGroup.rotation.y = sv.heading;
        } else {
          e.rideGroup.position.set(g.position.x, (RIG_BASE_Y[e.ride] || 0) + e.curY, g.position.z);
          e.rideGroup.rotation.y = g.rotation.y;
        }
        e.rideGroup.userData.spin?.(dt); // cheap moving bits: wheels / prop / rotor / flame
      }
      if (e.worn) e.worn.userData.spin?.(dt); // jetpack flame pulse

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

// Free a proxy's GPU resources (geometry + material(s)) when it's swapped out or
// the owning player leaves. Geometry/materials may be shared between a proxy's
// meshes; THREE's dispose() is safe to call more than once, so a plain traversal
// is fine. Only called on ride change / removal — never per frame.
function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((mm) => mm?.dispose?.());
    else m?.dispose?.();
  });
}
