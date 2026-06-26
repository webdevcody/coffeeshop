// Ride manager: ties the drivable car and the rideable skateboard into a small
// walk / drive / skate mode machine driven by the E key. main.js calls update()
// each frame and branches on the returned mode (drive bypasses the normal walk
// update; skate just rides along with a speed boost + a board under the feet).

import * as THREE from "three";
import { makeCar } from "./car.js";
import { makeBoat } from "./boat.js";
import { makeSkateboard } from "./skateboard.js";
import { makeRocket } from "./rocket.js";
import { makeAirplane } from "./airplane.js";
import { makeHelicopter } from "./helicopter.js";
import { makeJetpack, FLY } from "./jetpack.js";

const FAR = 1e9;
const CAR_REACH = 3.2; // how close you must be to enter the car
const STEAL_REACH = 3.5; // how close you must be to a moving traffic car to car-jack it
const BOAT_REACH = 4.0; // how close (at a dock) you must be to board the boat
const ROCKET_REACH = 6.0; // how close (on the launchpad) you must be to board the rocket
const ROCKET_CEIL = 300; // rocket flight ceiling (m) passed to rocket.drive — clears the station
const PLANE_REACH = 6.0; // how close (on the runway/apron) you must be to board the plane
const HELI_REACH = 5.0; // how close (on a helipad) you must be to board the helicopter
const PLANE_CEIL = 200; // plane flight ceiling (m) passed to airplane.drive
const HELI_CEIL = 200; // heli flight ceiling (m) passed to helicopter.drive
// DOCKING: once the rocket climbs within this many metres of the station altitude
// (space.stationY ≈ 260), E docks instead of bailing out — the player is whisked
// inside the station interior and the rocket parks at the airlock. Below the band,
// E still exits to the pad as before.
const STATION_DOCK_BAND = 45;
// Re-boarding the docked rocket from the station deck: the dock spot sits just
// OUTSIDE the airlock bulkhead, so this reach is wider than ROCKET_REACH to let you
// board from inside the airlock (you can only walk up to the hatch, not past it).
const STATION_REBOARD_REACH = 14;
const SKATE_SPEED = 1.9; // ground-speed multiplier while skating
// Where the jetpack mounts on the local player's back (torso height, tucked just
// behind the spine). Mirrored in remotePlayers.js for the networked version.
const JETPACK_BACK_Y = 1.12;
const JETPACK_BACK_Z = -0.14;

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
  // Interactable world objects (bench, piano, hoop, ATM, photo spot, hot-dog).
  // Given E-priority in the walk branch BETWEEN entering the car and mounting the
  // board: car > boat > interactable > skateboard. null when none were threaded in.
  const interactables = opts.interactables || null;
  // The ocean (water plane + docks + boat spawn + isWater predicate). null when no
  // ocean was threaded in — in that case the boat is simply never created/offered.
  const ocean = opts.ocean || null;
  // The SPACE world (launchpad apron + gantry/tanks + station + rocketSpawn). null
  // when no space was threaded in — then the rocket is never created/offered.
  const space = opts.space || null;
  // The AIRPORT (offshore airfield island + causeway). null when no airport was
  // threaded in — then the plane + heli are never created/offered. Provides
  // planeSpawn (west runway threshold) + heliSpawn (south helipad).
  const airport = opts.airport || null;
  // GTA car-jacking: a fn returning the live roaming traffic cars
  // [{ x, z, heading, hide() }]. When supplied, pressing E next to one (and NOT
  // beside the parked drivable car) yoinks it — vanish the traffic car + teleport our
  // drivable car onto its spot/heading + drop straight into drive. null when unwired.
  const getTraffic = opts.getTraffic || null;
  // SHARED CAR (server-authoritative): getVehicle(id) returns the latest shared pose
  // for a world vehicle (we only use "car-1"); network.sendVehicle pushes our pose
  // while WE drive + once on exit. Both are null in a no-network context (the car
  // then behaves exactly as the old local-only car).
  const getVehicle = opts.getVehicle || null;
  const network = opts.network || null;

  const car = makeCar({ x: spawn.x, z: spawn.z, heading: spawn.heading, color: opts.carColor || "#d23b34" });
  scene.add(car.group);

  // The drivable BOAT — built once (like the car), floating at the main dock tip in
  // the water. It lives in the sea, so on foot you can only reach it from a dock;
  // boarding/sailing/disembarking mirror the car's drive branch. null with no ocean.
  let boat = null;
  if (ocean) {
    boat = makeBoat({ spawn: ocean.boatSpawn, waterY: ocean.waterY });
    scene.add(boat.group);
  }

  // The launchable ROCKET — built once (like the car/boat), parked on the spaceport
  // launchpad at space.rocketSpawn. On foot you board it with E while standing on
  // the pad, then throttle up (W) to blast into orbit. Its parked footprint is a
  // world collider (pushed inert while you're piloting it). null with no space.
  let rocket = null;
  let rocketCollider = null;
  if (space) {
    rocket = makeRocket({ spawn: space.rocketSpawn });
    scene.add(rocket.group);
    rocketCollider = { ...rocket.footprint() };
    colliders.push(rocketCollider);
  }

  // The rideable AIRPLANE + HELICOPTER — built once (like the car/boat/rocket),
  // parked on the offshore airfield. The plane sits at the WEST runway threshold
  // (airport.planeSpawn, nose EAST) so its take-off roll runs out over open ocean;
  // the heli rests on the south helipad (airport.heliSpawn). On foot you board
  // either with E while standing beside it on the island. Each parks a footprint
  // collider (pushed inert while piloting it, exactly like the car / rocket). null
  // with no airport threaded in.
  let plane = null;
  let planeCollider = null;
  let heli = null;
  let heliCollider = null;
  if (airport) {
    plane = makeAirplane({ spawn: airport.planeSpawn });
    scene.add(plane.group);
    planeCollider = { ...plane.footprint() };
    colliders.push(planeCollider);
    heli = makeHelicopter({ spawn: airport.heliSpawn });
    scene.add(heli.group);
    heliCollider = { ...heli.footprint() };
    colliders.push(heliCollider);
  }

  // The wearable JETPACK — built once, hidden until you toggle fly mode (F). Unlike
  // the car/boat you don't sit in it: on mount it parents onto the local player's
  // back and you keep your on-foot avatar; update() pulses its flame by thrust.
  const jetpack = makeJetpack();
  jetpack.setVisible(false);

  // Parked-car footprint, registered in the world colliders so you can't walk
  // through it. We mutate this same object in place: a tight box while parked,
  // pushed far away (inert) while you're driving it.
  const carCollider = { ...car.footprint() };
  colliders.push(carCollider);

  let board = null;
  let mode = "walk"; // walk | drive | boat | skate | fly | rocket
  // True while the rocket is parked at the orbital station (at space.dockSpot, up
  // at the station altitude) and the player is walking the interior on foot. While
  // docked, the near-rocket re-board check uses the wider STATION_REBOARD_REACH.
  let docked = false;

  // Per-frame jetpack fly sub-state. null while not flying; { vy, armed } while in
  // fly mode. `armed` flips true once we've genuinely lifted off the ground, so a
  // zero-thrust touchdown only lands you AFTER a real flight (never on take-off).
  let fly = null;

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

  // --- SHARED VEHICLES sync (server-authoritative) --------------------------
  // Generalized from the single car to EVERY drivable shared ride (car / boat /
  // plane / heli). Each is a shared world object with its own id ("car-1" /
  // "boat-1" / "plane-1" / "heli-1"). While WE pilot one we PUSH its pose to the
  // server (throttled to every PUSH_EVERY frames) and keep our LOCAL copy of the
  // shared pose in lock-step so that, the instant we park and exit, the non-piloting
  // mirror agrees with where we left it (we never receive our OWN relay back, so
  // without this the mirror would snap the vehicle to a stale pose). When we're NOT
  // piloting a ride, mirrorSharedPose() drops the local vehicle onto whatever pose
  // the server last sent (someone else piloting it, or parked). Flyers (plane/heli)
  // share only x/z/heading — altitude rides along on the player's y — so a parked
  // plane/heli keeps its local spawn height here.
  const PUSH_EVERY = 6; // frames between outbound pose sends while piloting (~10/s)

  // Per-ride descriptor registry, KEYED BY THE LOCAL PILOT MODE ("drive"/"boat"/
  // "plane"/"heli"). Only rides that actually exist in this world are present (the
  // boat needs an ocean; the plane/heli need an airport). `park` toggles the
  // vehicle's world footprint collider (null for the boat, which floats in water
  // with no collider). `tick` counts pilot frames per ride (reset to 0 on board so
  // the first pose ships at once). Built ONCE — the sync loop only mutates scalars.
  const sharedRides = {
    drive: { id: "car-1", kind: "car", vehicle: car, park: parkCollider, tick: 0 },
  };
  if (boat) sharedRides.boat = { id: "boat-1", kind: "boat", vehicle: boat, park: null, tick: 0 };
  if (plane) sharedRides.plane = { id: "plane-1", kind: "plane", vehicle: plane, park: parkPlaneCollider, tick: 0 };
  if (heli) sharedRides.heli = { id: "heli-1", kind: "heli", vehicle: heli, park: parkHeliCollider, tick: 0 };

  // Latest shared pose object for a ride id (the live entry main.js mutates), or null
  // before any welcome/relay (single-player / pre-connect → the local vehicle is
  // authoritative and every shared helper below no-ops).
  function sharedPose(id) {
    return getVehicle ? getVehicle(id) : null;
  }

  // Copy the local vehicle's pose into our local shared-pose entry so our mirror
  // matches what we just sent. Scalars only — no allocation. No-op until the entry
  // exists. driverId claims (our id) or releases (null) the ride.
  function writeSharedPose(r, driverId) {
    const v = sharedPose(r.id);
    if (!v) return;
    v.x = r.vehicle.state.x;
    v.z = r.vehicle.state.z;
    v.heading = r.vehicle.state.heading;
    v.driverId = driverId;
  }

  // Mirror the shared (server-authoritative) pose onto a local vehicle we are NOT
  // piloting: place the group + (for grounded rides) keep the parked footprint
  // collider following it, so a vehicle someone else moved/parked shows here at the
  // synced spot (and still blocks you where they left it). Only x/z/heading are
  // synced — a flyer keeps its local (spawn) altitude. Scalars only.
  function mirrorSharedPose(r) {
    const v = sharedPose(r.id);
    if (!v) return;
    r.vehicle.state.x = v.x;
    r.vehicle.state.z = v.z;
    r.vehicle.state.heading = v.heading;
    r.vehicle.syncGroup();
    if (r.park) r.park(true); // footprint follows the parked vehicle to its synced spot
  }

  // While we pilot ride `r`: keep our local shared copy in lock-step every frame (so
  // the mirror agrees the instant we exit) and PUSH it to the server on the throttle
  // (driverId = our network id claims the controls).
  function pushSharedPose(r) {
    writeSharedPose(r, network ? network.id : null);
    if (network && (r.tick++ % PUSH_EVERY) === 0) {
      network.sendVehicle(r.id, r.kind, r.vehicle.state.x, r.vehicle.state.z, r.vehicle.state.heading, network.id);
    }
  }

  // On exit: release the ride for everyone — drop our local claim and send one final
  // PARKED pose (driverId=null) so it stays exactly here, claimable by the next pilot.
  function releaseSharedPose(r) {
    writeSharedPose(r, null);
    if (network) network.sendVehicle(r.id, r.kind, r.vehicle.state.x, r.vehicle.state.z, r.vehicle.state.heading, null);
  }

  // Same trick for the rocket: a tight footprint while parked, pushed far away
  // (inert) while you're piloting it so the hidden avatar can't snag its own box.
  function parkRocketCollider(on) {
    if (!rocketCollider) return;
    if (on) Object.assign(rocketCollider, rocket.footprint());
    else Object.assign(rocketCollider, { minX: FAR, maxX: FAR, minZ: FAR, maxZ: FAR });
  }

  // Same trick for the plane + heli: a tight footprint while parked (re-registered
  // at the vehicle's current position), pushed far away (inert) while piloting it.
  function parkPlaneCollider(on) {
    if (!planeCollider) return;
    if (on) Object.assign(planeCollider, plane.footprint());
    else Object.assign(planeCollider, { minX: FAR, maxX: FAR, minZ: FAR, maxZ: FAR });
  }
  function parkHeliCollider(on) {
    if (!heliCollider) return;
    if (on) Object.assign(heliCollider, heli.footprint());
    else Object.assign(heliCollider, { minX: FAR, maxX: FAR, minZ: FAR, maxZ: FAR });
  }

  // DOCK: leave the cockpit and step INTO the station. The rocket is teleported to
  // park just outside the airlock (space.dockSpot) floated up to the station deck
  // level, and the player is stood inside the airlock on the deck — lifted to
  // space.stationFloorY (localPlayer pins them there on the station rects). Called
  // when E is pressed in rocket mode within docking range of the station.
  function dockAtStation(local) {
    const d = space.dockSpot, ex = space.exitSpot, fy = space.stationFloorY;
    // Park the rocket at the airlock, hovering at the station deck altitude.
    rocket.state.x = d.x;
    rocket.state.z = d.z;
    rocket.state.heading = d.heading || 0;
    rocket.state.altitude = fy; // base sits ~level with the deck beside the hatch
    rocket.syncGroup();         // shove the (now parked) rocket group to the dock
    parkRocketCollider(true);   // re-register its footprint at the dock spot
    docked = true;
    // Stand the player just inside the airlock on the deck, facing the interior.
    local.pos.x = ex.x;
    local.pos.z = ex.z;
    local.pos.y = fy;
    local.facing = Math.PI / 2; // +X, toward the corridor / control room
    local.airborne = false;
    local.falling = false;
    local.vy = 0;
    local.character.group.position.set(ex.x, fy, ex.z);
    local.character.group.rotation.y = local.facing;
  }

  // UNDOCK: re-boarding the docked rocket flies you HOME. We relocate the rocket
  // back above the launchpad (space.rocketSpawn) but keep it aloft at the station
  // altitude, so cutting the throttle lets it descend straight down and touch back
  // onto the pad (where the grounded exit drops you beside it). Without the XZ
  // snap it would land in the empty space east of the city.
  function undockToPad(local) {
    const sp = space.rocketSpawn;
    rocket.state.x = sp.x;
    rocket.state.z = sp.z;
    rocket.state.heading = sp.heading || 0;
    rocket.syncGroup(); // keep altitude; just move it over the pad
    docked = false;
  }

  // Strap the jetpack onto the local player's back + enter fly mode. The avatar
  // stays visible (you see yourself wearing it); rides.js will drive local.pos.y.
  function mountJetpack(local) {
    if (jetpack.group.parent) jetpack.group.parent.remove(jetpack.group);
    jetpack.group.position.set(0, JETPACK_BACK_Y, JETPACK_BACK_Z);
    jetpack.group.rotation.set(0, 0, 0);
    local.character.group.add(jetpack.group);
    jetpack.setVisible(true);
    jetpack.update(0, 0); // reset the flame to idle
    local.flying = true;
    fly = { vy: 0, armed: false };
  }

  // Take the pack off + leave fly mode. If still airborne we hand control back to
  // the normal gravity integrator (carry the vertical momentum) so cutting the
  // pack drops you smoothly to the ground / sea instead of teleporting.
  function dismountJetpack(local) {
    jetpack.setVisible(false);
    if (jetpack.group.parent) jetpack.group.parent.remove(jetpack.group);
    local.flying = false;
    if (local.pos.y > 0.02) {
      local.airborne = true;
      local.falling = true;
      local.vy = fly ? Math.min(0, fly.vy) : 0;
    } else {
      local.pos.y = 0;
      local.airborne = false;
      local.vy = 0;
    }
    fly = null;
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
    // SHARED VEHICLES: unless WE are piloting a given ride this frame, keep its local
    // vehicle glued to the server-authoritative pose (someone else piloting it, or it
    // parked where it was left). The ride we pilot owns its pose instead (it PUSHES
    // below), so we skip mirroring that one to avoid fighting our own updates. The
    // registry is keyed by pilot mode, so `m === mode` is exactly "the ride we pilot".
    for (const m in sharedRides) {
      if (m === mode) continue;
      mirrorSharedPose(sharedRides[m]);
    }
    const useE = controls.consumeUse ? controls.consumeUse() : false;
    // Drain the F edge every frame (in any mode) so it can't carry over stale;
    // only the walk + fly branches act on it (toggle the jetpack on / land).
    const useJetpack = controls.consumeJetpack ? controls.consumeJetpack() : false;
    const outdoors = local.pos.z > 11.5; // only offer rides outside the cafe
    const nearCar = car.distanceTo(local.pos.x, local.pos.z) < CAR_REACH;
    // The boat floats in the water at a dock tip, so this is only ever true when
    // you're standing on a dock right next to it (you can't reach it across water).
    const nearBoat = boat ? boat.distanceTo(local.pos.x, local.pos.z) < BOAT_REACH : false;
    // The rocket sits at pad centre (or, while docked, just outside the airlock), so
    // this is only true on the launchpad apron or beside the docked rocket. Docking
    // parks it past the airlock bulkhead, so re-boarding gets the wider reach.
    const rocketReach = docked ? STATION_REBOARD_REACH : ROCKET_REACH;
    const nearRocket = rocket ? rocket.distanceTo(local.pos.x, local.pos.z) < rocketReach : false;
    // The plane sits at the west runway threshold; the heli on a south helipad —
    // both on the offshore airfield, reached on foot via the causeway.
    const nearPlane = plane ? plane.distanceTo(local.pos.x, local.pos.z) < PLANE_REACH : false;
    const nearHeli = heli ? heli.distanceTo(local.pos.x, local.pos.z) < HELI_REACH : false;

    if (mode === "boat") {
      const { throttle, steer } = controls.driveAxis();
      // Shift = NOS boost, Shift+Ctrl = EXTREME. In a vehicle the sprint tier means
      // NOS (not on-foot sprint), so there's no conflict. Threaded as drive()'s 5th arg.
      const boost = controls.sprintLevel();
      boat.drive(dt, throttle, steer, ocean.isWater, boost);
      boat.updateCamera(camera, dt, controls); // pass controls for mouse free-look
      // Glue the (hidden) avatar + networked position to the boat so exiting is
      // seamless and remotes see you sailing, not frozen on the dock.
      local.pos.x = boat.state.x;
      local.pos.z = boat.state.z;
      local.facing = boat.state.heading;
      // SHARED BOAT: we own the helm — keep our local shared pose in lock-step every
      // frame and PUSH it (throttled) so everyone else sees the boat sail where we
      // steer it. driverId = network.id claims us as the pilot.
      pushSharedPose(sharedRides.boat);
      if (useE) {
        const s = boat.exitSpot(ocean.docks);
        local.pos.x = s.x;
        local.pos.z = s.z;
        local.facing = s.facing;
        // Stand the avatar on the dock (which is in `ground`) so it doesn't fall.
        local.character.group.position.set(s.x, 0, s.z);
        local.character.group.rotation.y = s.facing;
        mode = "walk";
        // SHARED BOAT: send one final PARKED pose (driverId=null) so it's released +
        // left exactly here for everyone, claimable by the next pilot.
        releaseSharedPose(sharedRides.boat);
        return { mode, prompt: "🚤 Press E to sail", overrideWalk: false };
      }
      return { mode, prompt: "🚤 WASD to sail · E to dock", overrideWalk: true };
    }

    if (mode === "drive") {
      // Shift = NOS boost, Shift+Ctrl = EXTREME (sprint tier = NOS in a vehicle, no
      // on-foot conflict). Thread it into the car's drive input by reusing the axis
      // object driveAxis() already allocated (no extra per-frame allocation).
      const axis = controls.driveAxis();
      axis.boost = controls.sprintLevel();
      car.drive(dt, axis, colliders, isGround);
      car.updateCamera(camera, dt, controls); // pass controls for mouse free-look
      // Keep the (hidden) avatar + networked position riding along with the car so
      // exiting is seamless and remote players see you move, not freeze.
      local.pos.x = car.state.x;
      local.pos.z = car.state.z;
      local.facing = car.state.heading;
      // SHARED CAR: we own the wheel — keep our local shared pose in lock-step every
      // frame (so the mirror agrees the instant we exit) and PUSH it to the server on
      // a throttle so everyone else sees the car move where we drive it. driverId =
      // network.id claims us as the driver.
      pushSharedPose(sharedRides.drive);
      if (useE) {
        const s = car.exitSpot();
        local.pos.x = s.x;
        local.pos.z = s.z;
        local.facing = s.facing;
        local.character.group.position.set(s.x, 0, s.z);
        local.character.group.rotation.y = s.facing;
        parkCollider(true);
        mode = "walk";
        // SHARED CAR: send one final PARKED pose with driverId=null so the car is
        // released + left exactly here for everyone (and is claimable by the next
        // driver). Keep our local copy released too so the mirror doesn't re-claim it.
        releaseSharedPose(sharedRides.drive);
        return { mode, prompt: "🚗 Press E to drive", overrideWalk: false };
      }
      return { mode, prompt: "🚗 WASD to drive · E to exit", overrideWalk: true };
    }

    if (mode === "rocket") {
      // Mirror the car/boat drive branch: throttle = main engine (W launches +
      // climbs), steer = yaw aloft. The vehicle owns the avatar + camera.
      const { throttle, steer } = controls.driveAxis();
      rocket.drive(dt, throttle, steer, { maxAltitude: ROCKET_CEIL });
      rocket.updateCamera(camera, dt);
      // Glue the (hidden) avatar + networked position to the rocket so exiting is
      // seamless and remotes track where you launched to (XZ + heading; pos.y
      // carries the altitude for the HUD/minimap).
      local.pos.x = rocket.state.x;
      local.pos.z = rocket.state.z;
      local.pos.y = rocket.state.altitude;
      local.facing = rocket.state.heading;
      // High enough to reach the orbital station? Then E DOCKS (board the station)
      // instead of bailing out. Below the band, E exits to the pad as before.
      const canDock = !!space && rocket.state.altitude >= space.stationY - STATION_DOCK_BAND;
      // AUTO-DOCK: the moment you fly the rocket all the way up to the station you're
      // pulled straight in — no key press (players couldn't find the "E to dock"
      // prompt). canDock arms at stationY-45; we wait until you're right at the
      // station (within 6 m) so the climb finishes, then dock automatically. The
      // manual E-dock below still works for an early dock in the 215-254 band.
      if (canDock && rocket.state.altitude >= space.stationY - 6) {
        dockAtStation(local);
        mode = "walk";
        return { mode, prompt: "🛰️ Docked! Explore the station — walk around, E by the rocket to fly home", overrideWalk: false };
      }
      if (useE) {
        if (canDock) {
          dockAtStation(local);
          mode = "walk";
          return { mode, prompt: "🛰️ Docked! Explore the station — E by the rocket to fly home", overrideWalk: false };
        }
        const s = rocket.exitSpot();
        local.pos.x = s.x;
        local.pos.z = s.z;
        local.pos.y = 0;
        local.facing = s.facing;
        // Stand the avatar safely on the ground beside the pad so it doesn't fall.
        local.character.group.position.set(s.x, 0, s.z);
        local.character.group.rotation.y = s.facing;
        parkRocketCollider(true);
        mode = "walk";
        return { mode, prompt: "🚀 Press E to board rocket", overrideWalk: false };
      }
      return {
        mode,
        prompt: canDock
          ? "🛰️ E to DOCK at the station · A/D yaw"
          : "🚀 Throttle: W launch · A/D yaw · E exit",
        overrideWalk: true,
      };
    }

    if (mode === "plane") {
      // Mirror the rocket/boat drive branch: throttle = engine (W builds forward
      // airspeed → lift → climb; the plane climbs by GAINING AIRSPEED, so flyThrust
      // doesn't apply), steer = rudder yaw (with a visual bank). Vehicle owns avatar
      // + camera.
      const { throttle, steer } = controls.driveAxis();
      plane.drive(dt, throttle, steer, { maxAltitude: PLANE_CEIL });
      plane.updateCamera(camera, dt);
      // Glue the (hidden) avatar + networked position to the plane so exiting is
      // seamless and remotes track where you flew (XZ + heading; pos.y carries the
      // altitude for the HUD/minimap + the riding name tag).
      local.pos.x = plane.state.x;
      local.pos.z = plane.state.z;
      local.pos.y = plane.state.altitude;
      local.facing = plane.state.heading;
      // SHARED PLANE: we own the cockpit — push the shared x/z/heading (throttled) so
      // everyone sees the plane fly where we steer it; altitude rides on the player y.
      pushSharedPose(sharedRides.plane);
      if (useE) {
        const s = plane.exitSpot();
        local.pos.x = s.x;
        local.pos.z = s.z;
        local.pos.y = 0;
        local.facing = s.facing;
        // Stand the avatar on the ground beside the plane so it doesn't fall.
        local.character.group.position.set(s.x, 0, s.z);
        local.character.group.rotation.y = s.facing;
        parkPlaneCollider(true);
        mode = "walk";
        // SHARED PLANE: final PARKED pose (driverId=null) releases it for everyone.
        releaseSharedPose(sharedRides.plane);
        return { mode, prompt: "✈️ Press E to fly", overrideWalk: false };
      }
      return { mode, prompt: "✈️ Throttle: W speed up · A/D yaw · E exit", overrideWalk: true };
    }

    if (mode === "heli") {
      // Drain the Space sit/ollie edge each frame so holding Space for collective
      // lift can't leave a stale toggle that fires the instant you step off.
      if (controls.consumeSit) controls.consumeSit();
      // Helicopter controls (fixed so it actually flies around):
      //   SPACE = add gas / climb, X (or Shift/Ctrl) = descend, neutral = HOVER.
      //   W/S = fly FORWARD / back (cyclic tilt), A/D = turn (tail-rotor yaw).
      // Collective lift comes from flyThrust() ONLY (Space/X); W/S now drives the
      // forward drift via ctx.forward so the heli moves where it's pointing.
      const { throttle, steer } = controls.driveAxis(); // throttle = W/S, steer = A/D
      const lift = controls.flyThrust ? controls.flyThrust() : 0; // Space +1 / X -1
      heli.drive(dt, lift, steer, { maxAltitude: HELI_CEIL, forward: throttle });
      heli.updateCamera(camera, dt);
      local.pos.x = heli.state.x;
      local.pos.z = heli.state.z;
      local.pos.y = heli.state.altitude;
      local.facing = heli.state.heading;
      // SHARED HELI: we own the controls — push the shared x/z/heading (throttled) so
      // everyone sees the heli fly where we steer it; altitude rides on the player y.
      pushSharedPose(sharedRides.heli);
      if (useE) {
        const s = heli.exitSpot();
        local.pos.x = s.x;
        local.pos.z = s.z;
        local.pos.y = 0;
        local.facing = s.facing;
        // Stand the avatar on the ground beside the skids so it doesn't fall.
        local.character.group.position.set(s.x, 0, s.z);
        local.character.group.rotation.y = s.facing;
        parkHeliCollider(true);
        mode = "walk";
        // SHARED HELI: final PARKED pose (driverId=null) releases it for everyone.
        releaseSharedPose(sharedRides.heli);
        return { mode, prompt: "🚁 Press E to fly", overrideWalk: false };
      }
      return { mode, prompt: "🚁 Space gas/up · X down · W/S fly · A/D turn · E exit", overrideWalk: true };
    }

    if (mode === "fly") {
      const thrust = controls.flyThrust ? controls.flyThrust() : 0; // +1 up / -1 down / 0
      if (!fly) fly = { vy: 0, armed: false };
      // Vertical: the jetpack must overcome gravity to climb, so a positive thrust
      // contributes (FLY.thrust + gravity) of lift (net +FLY.thrust up); gravity
      // always pulls; X/Shift adds an extra downward shove. Damp + cap for a
      // controllable feel, then integrate altitude clamped to [0, FLY.maxAltitude].
      const up = thrust > 0 ? FLY.thrust + FLY.gravity : 0;
      const down = FLY.gravity + (thrust < 0 ? FLY.thrust : 0);
      fly.vy += (up - down) * dt;
      fly.vy -= fly.vy * FLY.drag * dt;
      fly.vy = Math.max(-FLY.maxUp, Math.min(FLY.maxUp, fly.vy));
      let y = (local.pos.y || 0) + fly.vy * dt;
      if (y <= 0) { y = 0; if (fly.vy < 0) fly.vy = 0; }
      if (y >= FLY.maxAltitude) { y = FLY.maxAltitude; if (fly.vy > 0) fly.vy = 0; }
      local.pos.y = y;             // rides owns altitude; _updateVertical skips it
      if (y > 0.6) fly.armed = true; // we've genuinely left the ground
      // Pulse the exhaust by upward thrust only (idle/descend = no flame).
      jetpack.update(dt, thrust > 0 ? thrust : 0);
      // Land on F, or by settling back onto the ground at zero/▼ thrust after a
      // real flight. Horizontal flight is the NORMAL move integration (we never
      // touch speedMul), so local.update flies us around with WASD.
      const touchedDown = fly.armed && y <= 0.001 && thrust <= 0;
      if (useJetpack || touchedDown) {
        dismountJetpack(local);
        mode = "walk";
        return { mode, prompt: null, overrideWalk: false };
      }
      return { mode, prompt: "🚀 F to land · Space up / X down", overrideWalk: false };
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
    // JETPACK: F toggles fly mode on its own free key — on foot, not seated, not
    // in another ride (we're in the walk branch). Takes priority over E rides.
    if (useJetpack && !local.sitting) {
      mountJetpack(local);
      mode = "fly";
      return { mode, prompt: "🚀 F to land · Space up / X down", overrideWalk: false };
    }
    if (useE && !local.sitting) {
      if (nearCar) {
        parkCollider(false);
        car.resetCamera();
        sharedRides.drive.tick = 0; // claim the wheel on the next drive frame (send immediately)
        mode = "drive";
        return { mode, prompt: "🚗 WASD to drive · E to exit", overrideWalk: true };
      }
      // CAR-JACK: not beside the parked car, but standing next to a moving traffic
      // car? Yoink it GTA-style — vanish that traffic car, snap our drivable car onto
      // its position + heading, and drop straight into drive. Outdoors only (traffic
      // only exists on the streets), and it sits right after the parked-car board so
      // a real parked car always wins.
      if (outdoors && getTraffic) {
        const t = nearestTraffic(local.pos.x, local.pos.z);
        if (t) {
          t.hide();                       // make the stolen traffic car disappear
          car.state.x = t.x;
          car.state.z = t.z;
          car.state.heading = t.heading;
          car.state.speed = 0;
          car.syncGroup();                // shove our drivable car onto its spot
          parkCollider(false);
          car.resetCamera();
          sharedRides.drive.tick = 0; // claim the wheel on the next drive frame (send immediately)
          mode = "drive";
          return { mode, prompt: "🚗 Car jacked! WASD to drive · E to exit", overrideWalk: true };
        }
      }
      // BOAT: reachable only from a dock (it floats in the water). Boards between
      // the car and the interactables in the E-priority order.
      if (nearBoat) {
        boat.resetCamera();
        sharedRides.boat.tick = 0; // claim the helm on the next sail frame (send immediately)
        mode = "boat";
        return { mode, prompt: "🚤 WASD to sail · E to dock", overrideWalk: true };
      }
      // ROCKET: reachable on the launchpad apron, OR — while docked — from inside the
      // airlock. Boards between the boat and the interactables in the E-priority
      // order. Re-boarding the docked rocket undocks it back over the pad so flying
      // down lands you home.
      if (nearRocket) {
        if (docked) undockToPad(local);
        parkRocketCollider(false);
        rocket.resetCamera();
        mode = "rocket";
        return { mode, prompt: "🚀 Throttle: W launch · A/D yaw · E exit", overrideWalk: true };
      }
      // PLANE / HELI: reachable on the offshore airfield. Board between the rocket
      // and the interactables in the E-priority order:
      // car > boat > rocket > plane > heli > interactable > skate.
      if (nearPlane) {
        parkPlaneCollider(false);
        plane.resetCamera();
        sharedRides.plane.tick = 0; // claim the cockpit on the next flight frame (send immediately)
        mode = "plane";
        return { mode, prompt: "✈️ Throttle: W speed up · A/D yaw · E exit", overrideWalk: true };
      }
      if (nearHeli) {
        parkHeliCollider(false);
        heli.resetCamera();
        sharedRides.heli.tick = 0; // claim the controls on the next flight frame (send immediately)
        mode = "heli";
        return { mode, prompt: "🚁 Space gas/up · X down · W/S fly · A/D turn · E exit", overrideWalk: true };
      }
      // INTERACTABLES: a world object in range claims E before the skateboard.
      // tryUse returns its HUD line (truthy) only when something was in range;
      // null falls through so pressing E in the open still mounts the board.
      if (interactables) {
        const used = interactables.tryUse(local.pos.x, local.pos.z, local.facing, local);
        if (used) return { mode, prompt: used, overrideWalk: false };
      }
      if (outdoors) {
        mountBoard(local);
        mode = "skate";
        return { mode, prompt: "🛹 Skating! · E to hop off", overrideWalk: false };
      }
    }
    let prompt = null;
    const ip = interactables && !local.sitting ? interactables.nearestPrompt(local.pos.x, local.pos.z) : null;
    if (nearCar) prompt = "🚗 Press E to drive";
    else if (nearBoat && !local.sitting) prompt = "🚤 Press E to sail"; // boat hover sits between car and interactable
    else if (nearRocket && !local.sitting) prompt = docked ? "🚀 Press E to board & fly home" : "🚀 Press E to board rocket"; // rocket hover (pad, or docked at the station)
    else if (nearPlane && !local.sitting) prompt = "✈️ Press E to fly"; // plane hover (west runway threshold)
    else if (nearHeli && !local.sitting) prompt = "🚁 Press E to fly"; // heli hover (south helipad)
    else if (ip) prompt = ip; // interactable hover prompt sits between car and skate
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

  // Nearest stealable traffic car within STEAL_REACH of (x,z), else null. getTraffic()
  // is only invoked here on an E press (never per frame), so its fresh array is fine.
  function nearestTraffic(x, z) {
    if (!getTraffic) return null;
    const list = getTraffic();
    let best = null, bestD = STEAL_REACH * STEAL_REACH;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const dx = e.x - x, dz = e.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
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
    boat,
    rocket,
    plane,
    heli,
    get trick() { return skate ? skate.lastTrick : null; },
    get score() { return skate ? skate.score : 0; },
    get mode() { return mode; },
    // Network-friendly ride tag: null while walking, "car" while driving, "boat"
    // while sailing, "skate" while on the board, "jetpack" while flying, "rocket"
    // while launched, "plane"/"heli" while flying the aircraft. Threaded through
    // sendState so remotes render the matching mesh.
    get ride() {
      return mode === "drive" ? "car"
        : mode === "boat" ? "boat"
        : mode === "skate" ? "skate"
        : mode === "fly" ? "jetpack"
        : mode === "rocket" ? "rocket"
        : mode === "plane" ? "plane"
        : mode === "heli" ? "heli"
        : null;
    },
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
