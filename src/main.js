// Entry point: wires the engine, world, players, networking, voice, and HUD
// together and runs the game loop. Kept deliberately thin — each subsystem lives
// in its own module so individual pieces can be iterated on in isolation.

import "./styles.css";
import * as THREE from "three";
import { createEngine } from "./engine/scene.js";
import { createPostFX } from "./engine/post.js";
import { createControls } from "./engine/controls.js";
import { createAudio } from "./engine/audio.js";
import { createLofiMusic } from "./engine/music.js";
import { buildCoffeeshop } from "./world/coffeeshop.js";
import { buildOcean } from "./world/ocean.js";
import { buildSpace } from "./world/space.js";
import { buildAirport } from "./world/airport.js";
import { buildCannon } from "./world/cannon.js";
import { buildInteractables } from "./world/interactables.js";
import { LocalPlayer } from "./entities/localPlayer.js";
import { createRides } from "./entities/rides.js";
import { createWeapons } from "./entities/weapons.js";
import { RemotePlayers } from "./entities/remotePlayers.js";
import { Network } from "./net/network.js";
import { Voice } from "./net/voice.js";
import { ScreenShare } from "./net/screenShare.js";
import { HUD } from "./ui/hud.js";
import { createMap } from "./ui/map.js";
import { Arcade } from "./games/arcade.js";
import { InWorldBoard } from "./games/inworld/board.js";
import { AmbientBoards } from "./games/inworld/ambient.js";
import { createGame as createFlipbookMenu } from "./games/inworld/menu.js";
import { getGame, listGames } from "./games/registry.js";
import { ITEMS, getItem } from "./world/items.js";
import { NET } from "./config.js";
import { createPersistence } from "./persist.js";

const canvas = document.getElementById("scene");
const { renderer, scene, camera, labelRenderer, updateDayNight, setTimeOfDay, getTimeOfDay } = createEngine(canvas);
// Procedural sound engine (WebAudio). Lazily unlocks on the join click (a user
// gesture) — until then every call is a safe no-op. Drives ambient birds/wind, a
// vehicle engine hum, and one-shots (splash/whoosh/etc.).
const audio = createAudio();
// Procedural LOFI MUSIC manager: builds its own WebAudio graph (warm chords, a
// laid-back kick/snare/hihat beat, a simple bass, + faint vinyl crackle) scheduled
// ahead on the AudioContext clock, played into the mixer's "music" bus so the J
// panel + master volume apply. The ctx + music bus only exist after resume() (the
// join gesture), so we pass them as getters — every transport call is a guarded
// no-op until then. Starts PAUSED; autostarted on join (a real user gesture) and
// controlled by the N music widget below + the J mixer's Music slider.
const music = createLofiMusic({
  ctx: () => audio.getContext(),
  destination: () => audio.getMusicBus(),
});
// Post-processing pipeline: a final screen-space pass (subtle bloom + FXAA) that
// makes the bright bits — neon, lamps, headlights, lit windows, the sun disc —
// glow. Built on the existing renderer/scene/camera; scene.js still owns tone
// mapping + day/night exposure (OutputPass consumes them). frame() renders
// through postFX.render() instead of renderer.render().
const postFX = createPostFX(renderer, scene, camera);
// Keep the composer's buffers in step with the window. scene.js already wires
// its own onResize (camera aspect + renderer/label sizes) to the resize event;
// we add a second listener that resizes the composer with the same dimensions.
window.addEventListener("resize", () => postFX.setSize(window.innerWidth, window.innerHeight));
const { colliders, seats, bar, ground, spawn, tables, armory, getTraffic, getPedestrians, getRain, getTornadoes, update: updateWorld } = buildCoffeeshop(scene);

// OCEAN: wraps the whole city in a huge animated sea so the landmass reads as an
// island — adds a beach apron, a main dock + drivable boat, and four little
// shop-islands. Built off the union AABB of the walkable `ground` rects so the
// shoreline hugs the actual landmass. Its group is added straight to the scene; its
// extra walkable rects / solid props are MERGED into the player + ride world below.
const landBounds = ground.reduce(
  (b, g) => ({
    minX: Math.min(b.minX, g.minX),
    maxX: Math.max(b.maxX, g.maxX),
    minZ: Math.min(b.minZ, g.minZ),
    maxZ: Math.max(b.maxZ, g.maxZ),
  }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
);
const ocean = buildOcean({ landBounds });
scene.add(ocean.group);
// SPACE: a concrete launchpad on the NE corner of the city + an orbital space
// station far overhead, wired EXACTLY like the OCEAN — its group is added to the
// scene and its world (walkable pad apron + solid gantry/tank/mast colliders) is
// merged below. The launchable rocket (built in rides.js) parks on
// space.rocketSpawn and tops out near the station.
const space = buildSpace({ landBounds });
scene.add(space.group);
// AIRPORT: an offshore AIRFIELD ISLAND east of the city, reachable on foot by a
// walkable causeway off the city's east edge — wired EXACTLY like the OCEAN /
// SPACE modules. Its group is added to the scene and its world (the island top +
// causeway deck as walkable `ground`, plus hangar walls / tower / light + sock
// poles / causeway rails as solid `colliders`) is merged below. The rideable
// PLANE parks at airport.planeSpawn (west runway threshold) and the HELI on
// airport.heliSpawn (south helipad) — both built in rides.js.
const airport = buildAirport({ landBounds });
scene.add(airport.group);
// SECRET CANNON: a hidden STONE ROOM behind the cafe (centred at z=-22) holding a
// giant human-cannonball CANNON, wired EXACTLY like the OCEAN / SPACE / AIRPORT
// add-ons — its group is added to the scene and its world (the room floor +
// doorway threshold as walkable `ground`, the brick walls / carriage / wheels /
// crates + the sliding secret door as solid `colliders`) is merged below. A
// sliding door in the cafe-facing wall (opened from the cafe via cannon.doorTrigger)
// reveals the room; standing under the muzzle now opens the bird-eye map in
// "cannon" select mode (gameMap.open("cannon")) so you pick WHERE to be launched,
// then arcs the player there (local.launchToward). Pumped each frame in frame().
const cannon = buildCannon({ landBounds });
scene.add(cannon.group);
// Merged world surfaces: beaches/docks/island tops + the launchpad apron become
// walkable; island props (huts, palms, rail posts) + the gantry/fuel-tanks/flood
// masts become solid. Used everywhere `ground`/`colliders` are consumed by the
// player + rides so you can stroll the shoreline, sail the sea, and board the rocket.
// The walkable orbital STATION interior rides along too: its deck rects join the
// walkable ground (the player is LIFTED to space.stationFloorY on them — see
// local.setStation below) and its hull-wall / console AABBs join the colliders so
// you can't walk through them while strolling the station at altitude.
const groundAll = ground.concat(ocean.ground, space.ground, space.stationGround, airport.ground, cannon.ground);
const collidersAll = colliders.concat(ocean.colliders, space.colliders, space.stationColliders, airport.colliders, cannon.colliders);

// STAGE 2 — VISIBILITY CULLING setup. Grab the 16 city DISTRICT groups once (city.js
// stashes them on the "city" group's userData, since buildCity's return isn't threaded
// up through coffeeshop.js) and precompute each group's world-XZ centre, so frame()
// can toggle group.visible with cheap scalar squared-distance maths and zero per-frame
// allocation. Culling only flips .visible — the districts' colliders + walkable ground
// were merged into collidersAll/groundAll above, so gameplay is never affected.
const _cityGroup = scene.getObjectByName("city");
const _districtCull = [];
if (_cityGroup && Array.isArray(_cityGroup.userData.districtGroups)) {
  for (const g of _cityGroup.userData.districtGroups) {
    _districtCull.push({ g, x: g.position.x, z: g.position.z });
  }
}
// Keep a district rendered within ~190 m of the player (squared, to skip sqrt).
const DISTRICT_CULL_R2 = 190 * 190;
// Show the orbital STATION (space.group) within ~220 m of its launchpad footprint.
const STATION_GATE_R2 = 220 * 220;

const controls = createControls(canvas);
// Rideables: a stealable car (parked just outside the cafe door) + a summonable
// skateboard. Pushes the parked car's footprint into `colliders`; drives off the
// shared `ground` so it can roam the whole expanded map. main.js calls
// rides.update() each frame and branches on the returned mode.
// THINGS TO DO: a handful of placeable interactive world objects (bench, street
// piano, basketball hoop, ATM, photo spot, hot-dog stand) the player triggers
// with E. Built here (not inside city.js) so main.js can thread it into the
// E-flow + frame loop; its group is added straight to the scene. Decorative —
// registers no colliders, so it can't wedge the player.
const interactables = buildInteractables();
scene.add(interactables.group);

const isGroundFn = (x, z) => groundAll.some((g) => x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ);
const network = new Network();
// SHARED WORLD VEHICLES: the server owns the single drivable car's pose. We mirror
// the latest authoritative pose per vehicle id here (keyed by id, e.g. "car-1");
// rides.js seeds/reads it for the local car and remotePlayers.js positions a remote
// driver's car proxy from it, so a car driven + parked by anyone shows at that exact
// spot for everyone. Populated from the welcome roster + live "vehicle" relays.
const sharedVehicles = new Map();
function upsertVehicle(v) {
  // Welcome-roster entries key on `id`; live relays key on `vehicleId`.
  const key = v.vehicleId || v.id;
  if (!key) return;
  let e = sharedVehicles.get(key);
  if (!e) { e = { id: key }; sharedVehicles.set(key, e); }
  // Vehicle kind: live "vehicle" relays carry it as `kind` (the message's own `type`
  // is the discriminator "vehicle"); the welcome roster entries carry it as `type`.
  e.type = v.kind ?? v.type;
  e.x = v.x;
  e.z = v.z;
  e.heading = v.heading;
  e.driverId = v.driverId ?? null;
}
const getVehicle = (id) => sharedVehicles.get(id);
const rides = createRides(scene, {
  colliders: collidersAll,
  isGround: isGroundFn,
  carSpawn: { x: 4, z: 18, heading: 0 },
  getTraffic, // GTA car-jacking: E beside a moving traffic car yoinks it (handled in rides.js)
  interactables, // E priority: car > boat > rocket > interactable > skateboard (handled in rides.js)
  ocean, // drivable boat lives in the sea; boarded from a dock (handled in rides.js)
  space, // launchable rocket parks on space.rocketSpawn; jetpack fly mode (F) lives here too
  airport, // rideable plane parks at airport.planeSpawn, heli at airport.heliSpawn (handled in rides.js)
  getVehicle, // read/seed the shared "car-1" pose (server-authoritative)
  network, // push the shared car pose while driving + on exit
});
const remotes = new RemotePlayers(scene, { getVehicle });
const hud = new HUD();
const arcade = new Arcade();

// WEAPONS (a cosmetic combat toy): 1/2/3 equip a pistol / rocket launcher /
// grenade launcher, 0 holsters, B fires. createWeapons owns the held hand-meshes
// (`weapons.group`, parented onto the player's handAnchor on equip) AND a private
// world-space FX group it adds to the scene itself, which holds every tracer /
// rocket / grenade + explosion so they keep flying after leaving the hand. We add
// the held group to the scene until it's first equipped. Shots are relayed
// (network.sendShot) and replayed (network.on("shot")) so the fire + blasts are
// MULTIPLAYER-VISIBLE. No damage / gameplay — purely visual.
const weapons = createWeapons(scene);
scene.add(weapons.group);

// The in-world game engine: mounts a game module onto the real café table mesh,
// routes pointer clicks, relays moves/snapshots, and pumps real-time sims. It
// replaces the iframe gameplay stage; arcade keeps only the host picker / guest
// waiting DOM.
const inWorld = new InWorldBoard({
  scene,
  camera,
  getCanvas: () => canvas,
  controls,
  network,
  tables,
  getLocal: () => local,
  getGameMeta: (id) => getGame(id),
  onStatus: (text) => arcade.open && arcade.setStatus(text),
});
// Host receives real-time guest steering through the same bus.
network.on("game-input", (m) => inWorld.onGameInput(m));

// PASSERSBY: mounts a live READ-ONLY mirror of every OTHER active match on its
// table, so a player walking past sees the games in progress across the room. It
// listens for the server's public "ambient" broadcasts and skips the one table
// InWorldBoard already owns (seated play / spectating / menu). Hidden-info games
// only ever expose their public snapshot, so a passerby never sees ship layouts.
const ambient = new AmbientBoards({
  network,
  tables,
  // PASSERSBY: resolve the reserved menu id to a synthetic meta so the ambient
  // manager can load + mount the flip-book MENU module read-only on a table whose
  // host is still choosing a game. registry.js has no "__menu__" entry (and can't
  // get one), so we inject the meta here. menu.js's createGame in a non-host
  // ("spectator") role renders the open book and follows applyState({index}).
  // Keep "__menu__" in sync with the server's MENU_GAME_ID and mountFlipbookMenu.
  getGameMeta: (id) =>
    id === "__menu__"
      ? { capacity: 2, spectatable: true, load: () => import("./games/inworld/menu.js") }
      : getGame(id),
  getActiveTableId: () => inWorld.activeTableId,
});

// FLASHLIGHT (V): exactly ONE warm SpotLight, created once and parked in the
// scene. Each frame it's snapped to the camera and aimed where the camera looks,
// so it lights whatever you face — and since the camera tracks you on foot, while
// flying, AND while driving, the beam follows you in every mode. Toggled on/off by
// controls.consumeFlashlight(). Intensity/range/cone match the car headlight scale
// (warm white, modest range + cone, soft penumbra). Reuses scratch vectors below
// so the per-frame aim allocates nothing.
const FLASHLIGHT_ON = 9; // beam intensity while lit (0 = off)
const flashlight = new THREE.SpotLight(0xfff1d0, 0, 34, Math.PI / 7, 0.6, 1.3);
flashlight.visible = false;
scene.add(flashlight);
scene.add(flashlight.target);
let flashlightOn = false;
const _flashDir = new THREE.Vector3();
const _flashTgt = new THREE.Vector3();
// WEAPONS: reused per-shot scratch so firing never allocates. _shotOrigin is the
// muzzle point (hand world position nudged forward), _shotDir the camera aim.
const _shotOrigin = new THREE.Vector3();
const _shotDir = new THREE.Vector3();
// GUN auto-fire: while the left mouse button is HELD and the pistol is equipped we
// re-fire every GUN_FIRE_INTERVAL seconds. _gunCooldown counts that interval down
// each frame so a held trigger can't fire faster than this rate; rocket/grenade
// ignore it (they are single-shot per click). The first click fires instantly
// because the cooldown has already recovered to <= 0 by then.
const GUN_FIRE_INTERVAL = 0.12;
let _gunCooldown = 0;
// SECRET CANNON reach radii (XZ, metres): press E within LOAD of the muzzle to
// fire, or simply walk into the muzzle mouth (WALKIN) to be launched hands-free.
const CANNON_LOAD_R = 2.5;
const CANNON_WALKIN_R = 1.3;
// WEAPON ARMORY reach (XZ, metres): press E within this of the wall rack to CYCLE
// gun → rocket → grenade → holster, so players discover the guns without the 1/2/3
// keys. The rack sits deep in the cafe where no ride/interactable is ever in
// E-reach, so reading E here (before rides.update) can't steal a ride's E.
const ARMORY_R = 2.5;

// Cross-reload persistence of the local player's state (appearance / money / last
// position / time-of-day) under localStorage key "coffee.player". All access is
// try/catch-guarded inside, so blocked/private storage is a silent no-op. Loaded
// on JOIN; written on money/appearance changes + a throttled positional save.
const persist = createPersistence();

let local = null;
let joined = false;
// GTA cash: grows when you rob a pedestrian (R near one). Shown in the top-left HUD
// money counter each frame while joined.
let money = 0;
// SWIM: tracks last frame's swim state so we can fire the splash one-shot exactly
// on the walk/fall → swim transition (entering the sea), not every frame afloat.
let _wasSwimming = false;
// JUMP whoosh: tracks last frame's airborne state so we play the whoosh one-shot
// exactly on the ground → air transition under our own power (a Space hop / swim
// pop), not every airborne frame. Cannon/tornado glides play their own whoosh.
let _wasAirborne = false;
// JETPACK liftoff whoosh: tracks last frame's fly state so engaging the pack
// (F → local.flying flips true) plays a single whoosh, not one per frame aloft.
let _wasFlying = false;
// FOOTSTEP cadence: a small accumulator that ticks a soft step one-shot roughly
// every STEP_INTERVAL seconds while walking on foot.
let _stepT = 0;
const STEP_INTERVAL = 0.3;
let lastStateSent = 0;
let lastSent = { x: NaN, z: NaN, y: NaN, ry: NaN, moving: false, sitting: false, ride: null, held: null };
// Throttle the periodic positional save: persist {lastPos, timeOfDay} once every
// PERSIST_SAVE_FRAMES frames (~0.5s at 60fps) so we never write localStorage (or
// allocate the small state object) per frame.
const PERSIST_SAVE_FRAMES = 30;
let _saveTick = 0;

// CITY MAP (M): a full-screen top-down overlay built from the fixed city layout.
// ui/map.js draws it + owns its own Esc / ✕ / M-to-close; we own M-to-OPEN
// (controls.consumeMap), freeze movement under it (setLocked), and feed it the live
// player arrow while open. Clicking the map fast-travels the local player there.
let _mapLocked = false; // true while WE locked controls for the open map
// Which mode the map is currently serving: "travel" (plain M-map fast-travel) or
// "cannon" (the secret cannon opened it to pick a launch destination). Kept in
// sync with the overlay and fed to it via the render payload so the hint + click
// behaviour match. Reset to "travel" whenever the map closes.
let mapMode = "travel";
// Latches the cannon's WALK-IN auto-open so cancelling the cannon map doesn't
// instantly reopen it while you're still standing in the muzzle mouth — you step
// clear of the muzzle to re-arm. (An explicit E press at the muzzle ignores it.)
let _cannonLatch = false;

// REAL BIRD-EYE TOP-DOWN CAMERA. One OrthographicCamera looking straight DOWN
// (-Y) from 500 m up, framing the whole world (city + ocean + 4 islands). When
// the M-map is open we render the ACTUAL scene through this camera onto the main
// canvas (fog off, no postFX/labels) — a true rendered bird's-eye view, not a
// drawing. updateTopCam() fits its orthographic frustum to the live canvas aspect
// and publishes the WORLD rectangle it covers in `_topBounds`, which ui/map.js
// uses to map a screen click <-> world (x,z) with the SAME transform and to place
// the player arrow. up = +Z keeps NORTH up on screen (a downward camera can't
// mirror, so east ends up on the left; north-up matches the old map / minimap).
const MAP_FRAME = { minX: -210, maxX: 210, minZ: -80, maxZ: 350 };
const topCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 700);
const _topBounds = { minX: -210, maxX: 210, minZ: -80, maxZ: 350 };
function updateTopCam() {
  const W = Math.max(1, window.innerWidth);
  const H = Math.max(1, window.innerHeight);
  const cx = (MAP_FRAME.minX + MAP_FRAME.maxX) / 2; // 0
  const cz = (MAP_FRAME.minZ + MAP_FRAME.maxZ) / 2; // 135
  const spanX = MAP_FRAME.maxX - MAP_FRAME.minX; // 420
  const spanZ = MAP_FRAME.maxZ - MAP_FRAME.minZ; // 430
  // Uniform world-units-per-pixel that fits BOTH spans (letterbox the smaller),
  // so the render isn't stretched. fW/fH are the world extents the FULL canvas
  // spans (each >= the requested span).
  const s = Math.min(W / spanX, H / spanZ);
  const fW = W / s;
  const fH = H / s;
  topCam.left = -fW / 2;
  topCam.right = fW / 2;
  topCam.top = fH / 2;
  topCam.bottom = -fH / 2;
  topCam.position.set(cx, 500, cz);
  topCam.up.set(0, 0, 1); // +Z (north) up on screen
  topCam.lookAt(cx, 0, cz); // straight down
  topCam.updateProjectionMatrix();
  _topBounds.minX = cx - fW / 2;
  _topBounds.maxX = cx + fW / 2;
  _topBounds.minZ = cz - fH / 2;
  _topBounds.maxZ = cz + fH / 2;
}
updateTopCam();

const gameMap = createMap({
  onTravel: ({ x, z, mode }) => {
    if (!local) {
      gameMap.close();
      return;
    }
    if (mode === "cannon") {
      // CANNON SELECT: close the map and arc the player to the chosen world point.
      // launchToward reuses the cannon glide integrator; it resolves through the
      // normal land / splash / void-respawn paths, so it can never wedge.
      gameMap.close();
      local.launchToward(x, z);
      audio.whoosh?.();
    } else {
      // Fast travel: drop the local player onto the clicked world point. Vertical
      // settle / off-edge respawn is left to localPlayer._updateVertical.
      local.pos.x = x;
      local.pos.z = z;
      local.pos.y = 0;
      gameMap.close();
    }
  },
});
// STATIC render payload, built ONCE from the city-layout constants (all WORLD
// coords). Only `player` changes per frame (mutated in place below), so opening the
// map and tracking the arrow allocate nothing.
const MAP_DISTRICTS = [
  // EXACT match to city.js LAYOUT, row-major with MAP_ROWS below (row 0 = z=245
  // north, row 3 = z=65 south), cols west→east [-90,-30,30,90]: [name, colour].
  ["Pier", "#5b8fa8"], ["Harbor", "#7aa6b8"], ["Industrial", "#7d7d7d"], ["Nightlife", "#a05a86"], // z=245
  ["Park", "#5f9e5a"], ["Transit", "#9a8f5f"], ["Offices", "#6f8aa8"], ["Stadium", "#5f8a6a"],       // z=185
  ["Downtown", "#7f8a99"], ["Autoplaza", "#9a7f5a"], ["Shopping", "#c9a24a"], ["Arts", "#9a6ba0"],   // z=125
  ["Plaza", "#8a9a6a"], ["Skatepark", "#8a8f9a"], ["Market", "#b08a4f"], ["Arcade", "#7a6aa0"],      // z=65
];
const MAP_COLS = [-90, -30, 30, 90];   // district centre X, west → east
const MAP_ROWS = [245, 185, 125, 65];  // district centre Z, north (top) → south
const _mapDistricts = [];
for (let r = 0; r < MAP_ROWS.length; r++) {
  for (let c = 0; c < MAP_COLS.length; c++) {
    const [name, color] = MAP_DISTRICTS[r * MAP_COLS.length + c];
    _mapDistricts.push({ name, x: MAP_COLS[c], z: MAP_ROWS[r], w: 46, d: 46, color });
  }
}
// Render payload for the TRANSPARENT overlay. The real city/roads/water now come
// from the live 3D bird-eye render behind the overlay, so we only feed the bits
// it draws on top: the live `bounds` (the topCam world-rect — a live reference,
// mutated each frame by updateTopCam), the `mode`, the player arrow, and thin
// district / island / POI labels for orientation + click targets.
const mapPayload = {
  bounds: _topBounds,
  mode: "travel",
  districts: _mapDistricts,
  islands: [
    { x: -184, z: 319, r: 13, name: "NW Shops" },
    { x: 177, z: 312, r: 13, name: "NE Shops" },
    { x: 177, z: -42, r: 13, name: "SE Shops" },
    { x: -177, z: -42, r: 13, name: "SW Shops" },
  ],
  markers: [
    { x: 0, z: 4, label: "Café / Spawn", kind: "cafe" },
    { x: 33, z: 19, label: "Rocket Pad", kind: "poi" },
    ...(ocean.docks || []).map((d) => ({ x: d.x, z: d.z, label: "Dock", kind: "dock" })),
  ],
  player: { x: 0, z: 4, heading: 0 },
};
// Seed the overlay so the very first open() paints the static map immediately
// (render() only stores the payload while closed; it draws once the map is open).
gameMap.render(mapPayload);

// Where everyone is, so voice (and screen share) can scope to the people you're
// actually with — table-mates when seated, nearby players otherwise.
const positions = {
  local: () => (local ? { x: local.pos.x, z: local.pos.z } : { x: 0, z: 0 }),
  remote: (id) => {
    const e = remotes.players.get(id);
    if (!e) return null;
    const p = e.character.group.position;
    return { x: p.x, z: p.z };
  },
};
const voice = new Voice(network, positions);
voice.onStatus = (s) => hud.setVoiceStatus(s);

// Screen sharing rides the same table/proximity scoping: people who can hear you
// can also see your screen.
const screenShare = new ScreenShare(network, positions, {
  getName: (id) => remotes.players.get(id)?.name || "Someone",
});
screenShare.onStateChange = (sharing) => hud.setSharing(sharing);
screenShare.onError = (msg) => hud.toast(msg);
hud.onToggleShare = () => screenShare.toggle();
// Light up the talking indicator over whoever's voice is currently active.
voice.onSpeaking = (id, speaking) => {
  if (network.id && id === network.id) local?.setSpeaking(speaking);
  else remotes.setSpeaking(id, speaking);
};
// When you deafen or mute someone, tell the server so it can flag — over your
// head, on their screen — that you can no longer hear them.
voice.onMuteChange = ({ deafened, muted }) => network.sendVoiceMute(deafened, muted);

function updateCount() {
  hud.setCount(remotes.players.size + (joined ? 1 : 0));
  refreshPeople();
}

// Feed the HUD roster the other people in the room plus their mute state, so the
// People panel can offer a per-person mute toggle.
function refreshPeople() {
  const people = remotes.list().map((e) => ({
    id: e.id,
    name: e.name,
    color: e.character.bodyMat.color.getStyle(),
    muted: voice.isMuted(e.id),
  }));
  hud.setPeople(people);
}

// --- Network wiring --------------------------------------------------------
network.on("welcome", (m) => {
  for (const p of m.players) remotes.add(p);
  // Seed the shared world vehicles (the drivable car) so rides.js can place the
  // local car at the authoritative pose and remotes render it at the synced spot.
  if (Array.isArray(m.vehicles)) for (const v of m.vehicles) upsertVehicle(v);
  // SHARED SKY: the server owns an authoritative day/night clock, so snap our
  // local cycle to its time-of-day on join — every player thus shares one sky.
  // scene.js keeps advancing it at the same rate between the periodic "time"
  // re-syncs. GUARD: an older server sends no timeOfDay; fall back to the prior
  // behavior (restore the persisted value) so the cycle still starts somewhere.
  if (typeof m.timeOfDay === "number" && Number.isFinite(m.timeOfDay)) {
    setTimeOfDay(m.timeOfDay);
  } else {
    const saved = persist.load();
    if (saved && saved.timeOfDay != null) setTimeOfDay(saved.timeOfDay);
  }
  updateCount();
});
// SHARED SKY re-sync: the server re-broadcasts the authoritative time-of-day every
// ~15s. Snap to it (a once-per-15s jump is imperceptible — scene.js advances the
// cycle smoothly in between, so this only trims accumulated drift). Guarded so a
// malformed payload is ignored.
network.on("time", (m) => {
  if (typeof m.timeOfDay === "number" && Number.isFinite(m.timeOfDay)) setTimeOfDay(m.timeOfDay);
});
// A shared vehicle moved/parked (someone else driving, or a driver released it).
// Upsert the authoritative pose; rides.js + remotePlayers.js read it each frame.
network.on("vehicle", (m) => upsertVehicle(m));
network.on("player-joined", (m) => {
  remotes.add(m.player);
  updateCount();
});
network.on("player-left", (m) => {
  remotes.remove(m.id);
  updateCount();
});
network.on("state", (m) => {
  remotes.setState(m.id, m.x, m.z, m.ry, m.moving, m.sitting, m.seatY, m.ride, m.held, m.y);
});
// A remote player restyled themselves (skin / hair / clothing).
network.on("appearance", (m) => {
  remotes.setAppearance(m.id, m);
  refreshPeople(); // people-panel dots track clothing color
});
// Another player deafened or muted us: flag that they can't hear us.
network.on("voice-status", (m) => {
  remotes.setCantHear(m.id, m.cantHear);
});
network.on("chat", (m) => {
  hud.addChatLog(m.name, m.text, colorFor(m.id, m.name));
  if (network.id && m.id === network.id) {
    local?.showChat(m.text);
  } else {
    remotes.showChat(m.id, m.text);
  }
});
// A remote player fired: replay the IDENTICAL cosmetic shot (tracer / rocket /
// grenade + explosion) at their world-space origin/aim, so everyone in the room
// sees everyone's fire and blasts. spawnShot routes local + remote through the
// same path, so the visuals are byte-identical.
network.on("shot", (m) => {
  weapons.spawnRemoteShot(m.weapon, { x: m.ox, y: m.oy, z: m.oz }, { x: m.dx, y: m.dy, z: m.dz });
});

// --- Game-table wiring -----------------------------------------------------
// Sitting at a game table asks the server for a room + role; the reply opens the
// game in the Arcade overlay. Standing up (or the overlay's Leave button) ends
// the match.
let currentRole = null;

network.on("game-assign", (m) => {
  if (m.role === "full") {
    hud.toast("This table is full — no seats left to play or spectate.");
    return;
  }
  // Make sure we're still sitting at the table we asked about.
  if (!local?.sitting || local.seat?.table !== m.table) {
    network.leaveGame();
    return;
  }
  currentRole = m.role;
  controls.setLocked(true);

  // No game chosen yet: EVERYONE at the table sees the in-world FLIP-BOOK MENU,
  // each oriented to face their own seat (per-viewer rotation is client-local).
  // Only the host — the first person to sit — can flip pages and pick; guests and
  // spectators watch the host browse (the open page is synced over the relay).
  // Mounting through InWorldBoard means the seated camera frames the book and
  // clicks route to it the same way they route to a game board.
  if (!m.gameId) {
    if (arcade.open) arcade.hide();
    mountFlipbookMenu(m);
    hud.toast(
      m.role === "host"
        ? "Flip the menu and tap Play to start a game."
        : "The host is choosing a game…"
    );
    return;
  }

  // A game is locked in.
  const game = getGame(m.gameId);
  if (!game) return;
  if (m.role === "spectator" && !game.spectatable) {
    // Game opted out of spectating — free the seat and bow out.
    hud.toast(`${game.name} is full and can't be spectated.`);
    local?.standUp();
    return;
  }
  if (arcade.open) arcade.hide();
  mountInWorld(m, m.role === "spectator" ? null : (local.seat?.ry ?? null));
});

// Mount the in-world FLIP-BOOK MENU (the game picker) on the table. It rides the
// same InWorldBoard engine path as a real board, so the seated camera frames it
// and pointer clicks resolve to it. The host's pick relays via network.chooseGame
// (which triggers a fresh game-assign with a gameId → the menu unmounts and the
// chosen game mounts in mountInWorld). `gameId:"__menu__"` is not a registry id;
// passing `createGame` makes mount() skip the registry load.
function mountFlipbookMenu(m) {
  const seatRy = local?.seat?.ry ?? null;
  inWorld.mount({
    gameId: "__menu__",
    tableId: m.table,
    roomId: m.roomId,
    role: m.role, // "host" → open book, "guest" → closed waiting placard
    seatRy,
    seatIndex: m.seatIndex,
    seatCount: m.seatCount,
    createGame: createFlipbookMenu,
    ctxExtra: {
      games: () => listGames(),
      onPick: (gameId) => {
        // Re-check we're still seated at this table before locking a game in.
        if (!local?.sitting || local.seat?.table !== m.table) return;
        network.chooseGame(m.table, gameId, getGame(gameId)?.capacity ?? 2);
      },
    },
  });
  // We now own this table's mount — shed any ambient passersby mirror on it.
  // Release by id synchronously: inWorld.mount() is async (awaits a module import
  // before setting activeTableId), so syncActiveTable() alone could miss the table
  // we just sat at and let its ambient mirror z-fight the incoming board.
  ambient.releaseTable(m.table);
}

// Mount the in-world board for this game-assign. `seatRy` is null for spectators.
function mountInWorld(m, seatRy) {
  inWorld.mount({
    gameId: m.gameId,
    tableId: m.table,
    roomId: m.roomId,
    role: m.role,
    seatRy,
    seatIndex: m.seatIndex,
    seatCount: m.seatCount,
    // Screen-space status banner for games that emit HUD text (e.g. battleship) —
    // always readable for both players, never clipped by 3D furniture.
    ctxExtra: {
      onHud: (text) => hud.setGameBanner(text),
      onControls: (defs, onClick) => hud.setGameControls(defs, onClick),
      onFleet: (panels) => hud.setFleetPanels(panels),
    },
  });
  // We now own this table's mount — shed any ambient passersby mirror on it.
  // Release by id synchronously: inWorld.mount() is async (awaits a module import
  // before setting activeTableId), so syncActiveTable() alone could miss the table
  // we just sat at and let its ambient mirror z-fight the incoming board.
  ambient.releaseTable(m.table);
}

// --- Reconnect handling ----------------------------------------------------
// A dropped socket reconnects with a brand-new server id, so the old seat is
// torn down server-side (releaseSeat → game-end to others / table freed). To
// avoid leaving a now-dead board interactive, we unmount on close; and once the
// socket re-opens and re-joins, if we believed we were seated at a table we
// re-issue requestGame so the server re-seats us into a (fresh) match. A brief
// blip no longer silently kills the local board.
let _wasConnected = false;
network.on("open", () => {
  if (_wasConnected && local?.sitting && local.seat?.table && local.seat?.gameTable) {
    // Re-sit at the same table; the server replies with a new game-assign that
    // re-mounts the board (host picks again / guest waits / mid-join catch-up).
    network.requestGame(local.seat.table);
  }
  _wasConnected = true;
});
network.on("close", () => {
  // The board's role/seat is now stale (the server dropped our old id). Tear it
  // down so we don't leave a dead, interactive board mounted; a successful
  // reconnect + re-sit will re-mount it fresh.
  if (inWorld.open) inWorld.unmount();
  // Ambient passersby mirrors are stale too — drop them all. The server replays
  // every active board on rejoin, so they re-mount fresh on reconnect.
  ambient.clear();
});

network.on("game-end", () => {
  // Opponent left / match ended. Surface a status; the board (if mounted) stays
  // until the local player stands up.
  hud.toast(
    currentRole === "spectator"
      ? "The match ended."
      : "Opponent left — game over. Stand up to head back."
  );
  if (arcade.open) {
    arcade.setStatus(
      currentRole === "spectator" ? "The match ended — leave to head back." : "Opponent left — leave to head back."
    );
  }
});

// The picker overlay's "Leave game" button: stand up, which closes everything.
arcade.onLeave = () => local?.standUp();

// True when the local player is standing in the order zone in front of the bar.
function nearBar() {
  if (!local || !bar) return false;
  const dz = local.pos.z - bar.z; // positive = in front of the counter
  return dz > 0 && dz < bar.range && Math.abs(local.pos.x - bar.x) < bar.halfW;
}

// Called whenever the local player stands up (button, keyboard, or walking off).
function onLocalStood() {
  if (arcade.open) arcade.hide();
  if (inWorld.open) inWorld.unmount();
  hud.clearGameBanner();
  hud.clearGameControls();
  hud.clearFleetPanels();
  controls.setLocked(false);
  currentRole = null;
  network.leaveGame();
}

function colorFor(id, fallbackName) {
  if (network.id && id === network.id && local) return local.character.bodyMat.color.getStyle();
  const e = remotes.players.get(id);
  return e ? e.character.bodyMat.color.getStyle() : "#fff";
}

// --- HUD wiring ------------------------------------------------------------
hud.onJoin = ({ name, color }) => {
  // The join click is the user gesture that unlocks WebAudio — start the ambient
  // bed (soft wind + birdsong) the moment we enter the world. Guarded so audio can
  // NEVER block joining / building the player (a thrown audio call here once aborted
  // join before the avatar was created — "no character loads").
  try { audio.resume(); audio.setAmbient(true); } catch (e) { console.warn("[audio] init failed", e); }
  // Kick off the chill LOFI MUSIC bed. The join click is a real user gesture, so
  // the ctx is now resumed and play() can start; it rides the "music" mixer bus,
  // so a previously-muted/lowered Music slider is respected. Guarded so audio can
  // NEVER block joining. Toggle/skip/volume live in the N music widget.
  try { music.play(); } catch (e) { console.warn("[music] init failed", e); }
  // Restore saved state from a previous visit (null on a first visit or blocked
  // storage — every restore below then falls back to the live defaults). Build the
  // avatar with the SAVED appearance so it comes back identical; on a first visit
  // use the join-card colour.
  const saved = persist.load();
  const initialAppearance = saved?.appearance || { color };
  local = new LocalPlayer(scene, controls, collidersAll, initialAppearance, name, seats, groundAll, spawn);
  // SWIM: give the player the ocean's open-water predicate + surface height so
  // jumping/falling into the sea floats instead of respawning (handled inside
  // localPlayer._updateVertical). The void respawn still runs anywhere there's no
  // water below.
  local.setIsWater(ocean.isWater, ocean.waterY);
  // Tell the player which walkable rects are the orbital STATION deck + the world
  // Y it sits at, so standing on them lifts you to space.stationFloorY (≈260)
  // instead of pinning y=0 — you walk the station interior after docking.
  local.setStation(space.stationGround, space.stationFloorY);
  _wasSwimming = false;
  _wasAirborne = false;
  _wasFlying = false;
  _stepT = 0;
  // --- Restore the rest of the saved state -----------------------------------
  // MONEY: reload the saved cash total (default 0) and reflect it in the HUD now
  // so the counter isn't blank for a frame before the loop refreshes it.
  money = saved?.money ?? 0;
  hud.setMoney(money);
  // TIME OF DAY: the day/night clock is now SERVER-AUTHORITATIVE — we snap to the
  // server's shared timeOfDay on "welcome" (and re-sync on the periodic "time"
  // broadcast), so we intentionally do NOT restore the persisted value here; letting
  // it win would split the sky between players again. It's still saved harmlessly
  // below and only consulted as a fallback in the welcome handler if the server
  // (an older build) sends no timeOfDay.
  // POSITION: drop back roughly where we left off — but only the on-foot XZ +
  // facing. We never persist (and so never restore) an in-vehicle / flying /
  // airborne state: y is forced to 0 and _updateVertical re-settles us onto the
  // floor (incl. the lifted station deck). Guard against a wall/void by only
  // restoring when the saved spot is on a walkable ground rect; else keep spawn.
  const savedPos = saved?.lastPos;
  if (savedPos && Number.isFinite(+savedPos.x) && Number.isFinite(+savedPos.z) && isGroundFn(+savedPos.x, +savedPos.z)) {
    local.pos.x = +savedPos.x;
    local.pos.z = +savedPos.z;
    local.pos.y = 0;
    if (Number.isFinite(+savedPos.facing)) local.facing = +savedPos.facing;
    local.character.group.position.set(local.pos.x, 0, local.pos.z);
    local.character.group.rotation.y = local.facing;
  }
  // Coffee-bar shop: buying an item puts it in your hand (one at a time).
  hud.setShopItems(ITEMS);
  hud.onBuy = (id) => {
    const item = getItem(id);
    if (item) { local.holdItem(item); audio.blip(); }
  };
  // Sitting at a game table asks the server for a role; the reply opens the
  // game-picker menu (host) or a waiting screen (guest), then the game itself.
  local.onSit = (seat) => {
    if (seat?.table && seat?.gameTable) network.requestGame(seat.table);
  };
  local.onStand = (seat) => {
    if (seat?.table && seat?.gameTable) onLocalStood();
  };
  // Sync the customize panel to our resolved look (skin/hair default from name).
  hud.setAppearance(local.getAppearance());
  joined = true;
  // Flash the controls legend on first join so newcomers see the keys (incl. H to
  // bring it back), then tuck it away after a few seconds.
  hud.setHelpVisible(true);
  setTimeout(() => hud.setHelpVisible(false), 7000);
  network.connect();
  // Send our full resolved look (clothing + skin + hair) so others render us
  // identically, not a different per-id default. join() carries the appearance,
  // and we sendAppearance() right after so a RESTORED look is broadcast to anyone
  // already in the room (both deferred to socket-open so neither send is dropped).
  const appearance = local.getAppearance();
  network.on("open", () => { network.join(name, appearance); network.sendAppearance(appearance); });
  // If we connected before the handler was attached (fast localhost), join now.
  if (network.connected) { network.join(name, appearance); network.sendAppearance(appearance); }
  updateCount();
};

// The customize panel changed a color — restyle locally and tell everyone.
hud.onCustomize = (partial) => {
  if (!local) return;
  local.setAppearance(partial);
  network.sendAppearance(local.getAppearance());
  refreshPeople();
  // Persist the new look so the avatar comes back the same after a reload.
  persist.update({ appearance: local.getAppearance() });
};

hud.onChat = (text) => network.sendChat(text);
hud.onToggleMute = (id) => {
  voice.toggleMute(id);
  refreshPeople();
};
hud.onToggleVoice = () => {
  hud.setVoiceStatus("connecting");
  Promise.resolve(voice.toggle()).then((on) => {
    hud.setVoiceStatus(on ? "on" : "off");
    // The mic/deafen pills just (re)appeared — sync them to the live state.
    if (on) {
      hud.setMicMuted(voice.micMuted);
      hud.setDeafened(voice.deafened);
    }
  });
};
hud.onToggleMic = () => hud.setMicMuted(voice.toggleMicMute());
hud.onToggleDeafen = () => hud.setDeafened(voice.toggleDeafen());

// --- Sound mixer (J) -------------------------------------------------------
// Map a mixer-panel row name to the audio API: the reserved "master" row drives
// the master gain, every other name is one of audio.getBuses(). Defined once and
// handed to hud.buildMixer the first time the panel opens, so the sliders + mute
// toggles ride the live WebAudio levels (smoothed + persisted inside audio.js).
function mixerGetVol(name) {
  return name === "master" ? audio.getMasterVolume() : audio.getBusVolume(name);
}
function mixerOnChange(name, v) {
  if (name === "master") audio.setMasterVolume(v);
  else audio.setBusVolume(name, v);
}
function mixerGetMuted(name) {
  return name === "master" ? audio.getMuted() : audio.getBusMuted(name);
}
function mixerOnMute(name, m) {
  if (name === "master") audio.setMuted(m);
  else audio.setBusMuted(name, m);
}

// --- Lofi music player (N) -------------------------------------------------
// Wire the HUD music widget to the procedural lofi manager: play/pause + skip
// route to the transport, the slider rides the "music" mixer bus, and after each
// action we reflect the live state (button + track name) back into the widget.
function syncMusicWidget() {
  hud.setMusicPlaying(music.isPlaying());
  hud.setMusicTrack(music.trackName());
  hud.setMusicVolume(audio.getBusVolume("music"));
}
hud.onMusicToggle = () => { music.toggle(); syncMusicWidget(); };
hud.onMusicNext = () => { music.next(); syncMusicWidget(); };
hud.onMusicVolume = (v) => audio.setBusVolume("music", v);

// --- Game loop -------------------------------------------------------------
const clock = new THREE.Clock();
let previewAngle = 0;

// Tracks the last seated-board-view state so we can flip the controls into (and
// out of) the clamped orbit mode exactly on the transition. `getSeatedView()`
// reports active:true whenever the local player is seated at a mounted board OR
// flip-book menu (the menu reuses the same hook — see api/notesForFixers), so
// the camera frames the menu too with zero extra wiring here.
let _seatedCamOn = false;
let _seatedBaseYaw = NaN;
function syncSeatedCamera() {
  const view = inWorld.getSeatedView ? inWorld.getSeatedView() : { active: false };
  const active = !!(view && view.active);
  // The camera orbits BEHIND the player: the offset baseline is seatRy+PI, so
  // facing the board centre puts the player's near edge at the screen bottom.
  // A null seatRy (shouldn't happen for a seated player) falls back to facing.
  const baseYaw = active
    ? (Number.isFinite(view.seatRy) ? view.seatRy : (local?.facing ?? 0)) + Math.PI
    : NaN;
  // Re-issue setSeated not only on the enter/leave transition but also whenever
  // the seated baseline yaw changes mid-seat (a seat/role refresh can change
  // seatRy without leaving the seat), so the orbit clamp baseline stays current.
  if (active !== _seatedCamOn || (active && baseYaw !== _seatedBaseYaw)) {
    _seatedCamOn = active;
    _seatedBaseYaw = baseYaw;
    controls.setSeated?.(active, baseYaw);
  }
  return active ? view : null;
}

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  controls.update();
  updateDayNight?.(dt); // advance the day/night cycle: sun arc, sky, fog, ambient
  // Pass the local player's XZ so the city can distance-cull far traffic/peds and
  // centre the rain on the camera. null before join → systems keep whole-map behaviour.
  updateWorld?.(dt, (joined && local) ? local.pos : null); // animate the street: cars driving by, birds overhead
  interactables.update(dt); // advance in-progress "use" animations (piano keys, hoop shot, ATM glow, flash, steam)
  ocean.update(dt); // animate the sea: swell, sparkle, foam shimmer
  space.update(dt); // animate space: station spin, blinking beacons, drifting sats, star twinkle
  airport.update(dt); // animate the airfield: rotating radar dish, blinking strobes, swaying windsock
  cannon.update(dt); // animate the secret cannon: slide the door, flicker torches/fuse, curl muzzle smoke
  // RAIN audio bed: track the live storm density (0..1) every frame. The rain
  // gain is smoothed inside audio.setRain, and the call is a guarded no-op before
  // the context unlocks, so this is cheap + safe to pump unconditionally.
  audio.setRain(getRain ? getRain() : 0);

  if (joined && local) {
    // --- SECRET CANNON (on-foot) ---------------------------------------------
    // Proximity to the door press-spot (just inside the cafe, ~z=-10.8) and the
    // muzzle loading-spot (deep in the hidden room, ~z=-22.5). BOTH sit behind /
    // inside the cafe where NO vehicle, skateboard, or interactable is ever in
    // reach, so we may read (and drain) the E edge HERE — before rides.update,
    // which otherwise swallows it — without ever stealing a ride's E. Anywhere
    // else E is left untouched for rides.update to consume as usual.
    const _dDx = local.pos.x - cannon.doorTrigger.x;
    const _dDz = local.pos.z - cannon.doorTrigger.z;
    const nearDoor = !local.sitting && (_dDx * _dDx + _dDz * _dDz) <= cannon.doorTrigger.r * cannon.doorTrigger.r;
    const _mDx = local.pos.x - cannon.mouth.x;
    const _mDz = local.pos.z - cannon.mouth.z;
    const muzzleD2 = _mDx * _mDx + _mDz * _mDz;
    const nearMuzzle = !local.sitting && muzzleD2 <= CANNON_LOAD_R * CANNON_LOAD_R;
    const cannonE = (nearDoor || nearMuzzle) && controls.consumeUse ? controls.consumeUse() : false;
    // CANNON → MAP-SELECT LAUNCH. Pressing E under the muzzle, OR just walking
    // into the muzzle mouth, no longer fires a fixed arc — it OPENS the bird-eye
    // map in "cannon" select mode so you pick WHERE to be launched; the map's
    // onTravel cannon branch then arcs you there (local.launchToward). The walk-in
    // auto-open is latched so cancelling the map doesn't instantly reopen it while
    // you're still standing in the mouth — step clear to re-arm. Guarded so we
    // only open on foot, never mid-arc, and never over an in-world game.
    const inMuzzleMouth = !local.sitting && muzzleD2 <= CANNON_WALKIN_R * CANNON_WALKIN_R;
    const canCannon = !local.airborne && !local.flying && !local.sitting && !inWorld.open;
    if (canCannon && !gameMap.isOpen &&
        ((nearMuzzle && cannonE) || (inMuzzleMouth && !_cannonLatch))) {
      mapMode = "cannon";
      gameMap.open("cannon");
      _cannonLatch = true;
    } else if (nearDoor && cannonE) {
      // Reveal / hide the secret room by sliding the brick door.
      cannon.setDoorOpen(!cannon.doorOpen);
    }
    // Re-arm the walk-in auto-open once you've stepped clear of the muzzle zone.
    if (muzzleD2 > CANNON_LOAD_R * CANNON_LOAD_R) _cannonLatch = false;

    // --- WEAPON ARMORY (on-foot) ---------------------------------------------
    // Within reach of the wall rack (and clear of the cannon spots), drain the E
    // edge HERE — before rides.update swallows it — to CYCLE the held weapon:
    // holster → gun → rocket → grenade → holster. This is safe to read because no
    // ride/interactable sits in E-reach this deep inside the cafe, so it never
    // steals a ride's E. The 1/2/3 number keys still work alongside this.
    const _aDx = local.pos.x - armory.x;
    const _aDz = local.pos.z - armory.z;
    const nearArmory = !local.sitting && (_aDx * _aDx + _aDz * _aDz) <= ARMORY_R * ARMORY_R;
    if (nearArmory && !nearDoor && !nearMuzzle && controls.consumeUse()) {
      const cur = weapons.current();
      const next = cur === null ? "gun" : cur === "gun" ? "rocket" : cur === "rocket" ? "grenade" : null;
      equipWeapon(next);
      audio.blip?.();
      hud.toast(
        next
          ? `Grabbed the ${next === "gun" ? "pistol" : next === "rocket" ? "rocket launcher" : "grenade launcher"} — press B to fire`
          : "Holstered your weapon"
      );
    }

    // Ride machine (walk / drive / skate). Driving owns the avatar + camera, so we
    // skip the normal walk update that frame and hide the on-foot avatar.
    const ride = rides.update(dt, camera, controls, local);
    if (ride.mode === "drive" || ride.mode === "boat" || ride.mode === "rocket" || ride.mode === "plane" || ride.mode === "heli") {
      // Driving a car, sailing the boat, OR flying the rocket: the vehicle owns the
      // avatar + camera, so hide the on-foot avatar, suppress the bottom-center sit
      // prompt, and show the bottom-right speedometer (fed by whichever vehicle is
      // active). NOTE: the jetpack "fly" mode is NOT here — you keep your visible
      // avatar and fly through the normal local.update path (the else branch).
      if (local.character?.group) {
        local.character.group.visible = false;
        // Keep the hidden avatar — and the name label parented to its head — glued
        // to the vehicle (rides keeps local.pos on the vehicle). Without this the
        // group stays where you boarded, so your name TAG froze at the entry point
        // while the car drove off. Now the tag rides along (and sits at altitude in
        // the rocket).
        local.character.group.position.set(local.pos.x, local.pos.y || 0, local.pos.z);
        local.character.group.rotation.y = local.facing;
      }
      hud.setSitPrompt(null);
      hud.setShopVisible(false);
      hud.setHeldItem(null);
      const vstate = ride.mode === "boat" ? rides.boat?.state
        : ride.mode === "rocket" ? rides.rocket?.state
        : ride.mode === "plane" ? rides.plane?.state
        : ride.mode === "heli" ? rides.heli?.state
        : rides.car?.state;
      const speed = vstate?.speed ?? 0;
      // NOS gauge: car/boat expose state.nos + state.boosting; the rocket / plane /
      // heli have no tank (pass null → the gauge hides itself).
      const nos = (ride.mode === "rocket" || ride.mode === "plane" || ride.mode === "heli") ? null : (vstate?.nos ?? null);
      const boosting = vstate?.boosting ?? false;
      hud.setDriveHud(true, speed, nos, boosting); // speedometer + NOS gauge + hint
      // Vehicle engine hum, pitch/level rising with speed (top speed ~12 m/s).
      audio.setEngine(true, Math.min(1, Math.abs(speed) / 12));
    } else {
      audio.setEngine(false); // on foot — no engine
      const seatedView = syncSeatedCamera();
      local.update(dt, camera, seatedView);
      // SWIM: splash one-shot on the moment we hit the water (not while afloat).
      if (local.swimming && !_wasSwimming) audio.splash();
      _wasSwimming = local.swimming;
      // JUMP whoosh: fire the moment we leave the ground under our own power (a
      // Space hop / swim pop-up rises with vy > 0). Cannon + tornado glides set
      // `launched`, and the jetpack sets `flying`, so those play their own whoosh
      // and are excluded here — no double-whoosh.
      if (local.airborne && !_wasAirborne && local.vy > 0 && !local.launched && !local.flying) {
        audio.whoosh();
      }
      _wasAirborne = local.airborne;
      // JETPACK liftoff whoosh: one shot the moment the pack engages (F).
      if (local.flying && !_wasFlying) audio.whoosh();
      _wasFlying = local.flying;
      // FOOTSTEPS: while actually walking on the ground (not airborne / swimming),
      // tick a soft step one-shot on a fixed cadence. Cheap accumulator; the step
      // sound is a guarded no-op before the audio context unlocks.
      if (local.moving && !local.airborne && !local.swimming && !local.sitting) {
        _stepT += dt;
        if (_stepT >= STEP_INTERVAL) { audio.footstep(); _stepT -= STEP_INTERVAL; }
      } else {
        _stepT = STEP_INTERVAL; // primed so the next step fires promptly on resume
      }
      // TORNADO FLING: a live, full-strength funnel sweeping over a grounded walker
      // yanks them off their feet — a big upward pop + an outward tumble (local.fling)
      // so they sail across the map. Guarded so it only catches us on the ground (not
      // mid-air / flying / swimming / seated / already parachuting); the storm + the
      // landing paths re-arm it. Deploy the parachute (P) to float down.
      if (!local.airborne && !local.flying && !local.swimming && !local.sitting && !local.parachuting) {
        const funnels = getTornadoes ? getTornadoes() : null;
        if (funnels) {
          for (let i = 0; i < funnels.length; i++) {
            const f = funnels[i];
            if (!f.active) continue;
            const dx = f.x - local.pos.x, dz = f.z - local.pos.z;
            if (dx * dx + dz * dz <= f.radius * f.radius) {
              local.fling(18);
              audio.whoosh();
              hud.toast("🌪️ Caught in a tornado! Press P for a parachute");
              break;
            }
          }
        }
      }
      // PARACHUTE (P): while airborne (from a fling / cannon launch / fall) and not
      // already under canopy, deploy the chute — clamps the descent to a gentle
      // float. deployParachute() returns true only if it actually opened.
      if (controls.consumeParachute() && local.deployParachute()) audio.whoosh();
      // ROB (R): mug the nearest pedestrian within ~2.5 m. rob() pays out a one-off
      // $5..$50 (0 if that ped was robbed too recently — no farming) and triggers the
      // ped's hands-up/flee reaction. Cash lands in `money`, with a blip + toast.
      if (controls.consumeRob() && !local.sitting && getPedestrians) {
        const peds = getPedestrians();
        let best = null, bestD = 2.5 * 2.5;
        for (let i = 0; i < peds.length; i++) {
          const dx = peds[i].x - local.pos.x, dz = peds[i].z - local.pos.z;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = peds[i]; }
        }
        if (best) {
          const cash = best.rob();
          if (cash > 0) {
            money += cash;
            audio.blip();
            hud.toast(`Robbed $${cash}!`);
            persist.update({ money }); // persist the new cash total on every change
          }
        }
      }
      // True first-person while seated at a board: hide your OWN avatar so your body
      // doesn't fill the screen (only affects your local view; others still see you).
      if (local.character?.group) {
        local.character.group.visible = !(seatedView && seatedView.active);
      }
      // A ride prompt (drive/skate) takes precedence over the sit prompt; the
      // SECRET CANNON hints (door / muzzle) take precedence over both when you're
      // standing in their spots behind/inside the cafe.
      // While airborne high up (a fling / cannon launch / fall) and not yet under a
      // canopy, the chute hint takes precedence over everything else.
      const airHint = (local.airborne && !local.parachuting && local.pos.y > 3) ? "🪂 Press P for a parachute" : null;
      hud.setSitPrompt(
        airHint ? airHint
        : nearMuzzle ? "💥 Press E to FIRE the cannon"
        : nearDoor ? (cannon.doorOpen ? "🚪 Press E to close the secret door" : "🚪 Press E to open the secret door")
        : nearArmory ? "🔫 Press E to grab a weapon"
        : (ride.prompt || local.sitPromptText())
      );
      // Open the coffee-bar menu when standing in the order zone; reflect whatever
      // you're holding (and the drop hint) the rest of the time.
      hud.setShopVisible(nearBar() && !local.sitting);
      hud.setHeldItem(local.heldName());
      hud.setDriveHud(false); // not driving — hide the speedometer
      // Sprint stamina meter (walk mode): bar fills with the 0..1 value, tints
      // while running and flashes when drained.
      hud.setStamina(local.staminaPct, local.sprinting);
    }
    // GTA money counter: reflect the running cash total (top-left) every frame
    // while joined — covers both the on-foot and in-vehicle branches above.
    hud.setMoney(money);
    // City minimap: redraw from this frame's positions (local arrow + facing,
    // remote dots, and the car). Cheap 2D draw into the HUD's reused canvas.
    updateMinimap();
    maybeSendState();
    // PERSIST: a throttled save of the lightweight, reload-safe slice of state
    // (on-foot XZ + facing + time-of-day) ~every 30 frames (~0.5s). The small
    // state object is built ONLY on the save tick, so the loop stays
    // allocation-free between saves; money + appearance persist on their own
    // change events. y / vehicle / flying state are deliberately NOT saved — we
    // always reload on foot at ground level.
    if (++_saveTick >= PERSIST_SAVE_FRAMES) {
      _saveTick = 0;
      persist.update({
        lastPos: { x: local.pos.x, z: local.pos.z, facing: local.facing },
        timeOfDay: getTimeOfDay ? getTimeOfDay() : null,
      });
    }
    updateWeapons(dt);
    updateMap();

    // --- STAGE 2: VISIBILITY CULLING -----------------------------------------
    // Stop off-screen / far geometry from rendering (a GPU win; gameplay is
    // untouched because the relevant colliders + walkable ground were merged into
    // collidersAll/groundAll, which are independent of these groups' .visible
    // flags). Run AFTER updateMap() so gameMap.isOpen is final for THIS frame: the
    // bird-eye MAP renders the whole scene straight down from 500 m, so while it's
    // open we force every district + the station visible; otherwise we cull by a
    // cheap squared-distance test to the player. (space.update(dt) already ran this
    // frame — it's cheap — so only the heavy render cost vanishes when hidden.)
    const _mapOpen = gameMap.isOpen;
    // STATION INTERIOR GATE: only the HEAVY interior sub-group (control room + 10
    // detailed modules + hull + fill lights + Earth, ~400 m east at y≈260) is gated.
    // The launchpad / rocket / orbital shell (space.group) stay visible so you can
    // always find the rocket near spawn. Show the interior when up high (flying / in
    // the rocket / on the deck, y>100) or within range of the module-run centre.
    if (space.stationInterior) {
      const sdx = local.pos.x - space.stationRenderCenter.x;
      const sdz = local.pos.z - space.stationRenderCenter.z;
      space.stationInterior.visible = _mapOpen || local.pos.y > 100 || (sdx * sdx + sdz * sdz) <= STATION_GATE_R2;
    }
    // DISTRICT DISTANCE CULL: toggle each of the 16 district groups by proximity.
    for (let i = 0; i < _districtCull.length; i++) {
      const d = _districtCull[i];
      const ddx = d.x - local.pos.x, ddz = d.z - local.pos.z;
      d.g.visible = _mapOpen || (ddx * ddx + ddz * ddz) <= DISTRICT_CULL_R2;
    }
  } else {
    // Gentle interior orbit of the room while the join card is up.
    previewAngle += dt * 0.12;
    camera.position.set(Math.sin(previewAngle) * 7.5, 3.1, Math.cos(previewAngle) * 7.5);
    camera.lookAt(0, 1.3, 0);
  }

  // Pump real-time game sims (pong/tron host tick, ludo, etc.) on the shared loop.
  inWorld.update(dt);
  // Pump the passersby mirrors too (their real-time games animate off the public
  // snapshot the same way the live board does).
  ambient.update(dt);

  remotes.update(dt);
  // Advance every in-flight projectile / muzzle flash / explosion (local AND
  // relayed). Runs every frame — even on the join-card preview — so nothing
  // freezes mid-air. Allocation-free per weapons.js.
  weapons.update(dt);
  voice.updateVolumes();
  voice.updateSpeaking(dt);
  screenShare.update(dt);

  // CONTROLS LEGEND (H): toggle the on-screen help panel on the key edge. Cheap +
  // safe to pump every frame; the panel lives in the game-ui (hidden before join).
  if (controls.consumeHelp()) hud.toggleHelp();

  // SOUND MIXER (J): toggle the live audio mixer on the key edge. The panel is
  // built ONCE from audio.getBuses() (buildMixer is idempotent, so calling it on
  // every open is a no-op after the first) and wired to the live bus/master gains.
  // Like the help legend it's a non-locking HUD overlay — it stays open while you
  // move; controls.js already ignores keydown while a slider <input> is focused,
  // so dragging a slider can't leak WASD into the game.
  if (controls.consumeMixer()) {
    hud.buildMixer(audio.getBuses(), mixerGetVol, mixerOnChange, mixerGetMuted, mixerOnMute);
    hud.toggleMixer();
  }

  // LOFI MUSIC (N): toggle the music player widget on the key edge. Like the help
  // legend + mixer it's a non-locking HUD overlay. Sync its button/track/volume to
  // the live music state on every toggle so it always reflects reality (the join
  // autostart, a J-panel Music slider change, etc.). controls.js ignores keydown
  // while a slider <input> is focused, so dragging the volume can't leak into the game.
  if (controls.consumeMusic()) {
    syncMusicWidget();
    hud.toggleMusic();
  }

  // FLASHLIGHT (V): toggle on the key edge, then (while lit) snap the single
  // SpotLight to the camera and aim it along the camera's forward so it lights
  // exactly what you face. Done AFTER all camera moves this frame (walk / drive /
  // fly / preview) so the beam never lags a frame behind. Allocation-free.
  if (controls.consumeFlashlight()) {
    flashlightOn = !flashlightOn;
    flashlight.visible = flashlightOn;
    flashlight.intensity = flashlightOn ? FLASHLIGHT_ON : 0;
  }
  if (flashlightOn) {
    camera.getWorldDirection(_flashDir);
    flashlight.position.copy(camera.position);
    _flashTgt.copy(camera.position).addScaledVector(_flashDir, 30);
    flashlight.target.position.copy(_flashTgt);
  }

  // RENDER. While the bird-eye MAP is open, render the REAL scene straight down
  // through topCam onto the main canvas — fog OFF (restored right after) so the
  // whole map is crisp from 500 m, and NO postFX/labels so the map view stays
  // clean (the transparent ui/map.js overlay draws the arrow + labels on top, and
  // its click→world maths inverts this exact topCam framing). Otherwise render
  // normally: postFX (bloom + grade) then the CSS2D name labels.
  if (gameMap.isOpen) {
    if (labelRenderer.domElement.style.display !== "none") labelRenderer.domElement.style.display = "none";
    updateTopCam();
    const savedFog = scene.fog;
    scene.fog = null;
    renderer.render(scene, topCam);
    scene.fog = savedFog;
  } else {
    if (labelRenderer.domElement.style.display === "none") labelRenderer.domElement.style.display = "";
    postFX.render();
    labelRenderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

// Feed the HUD minimap this frame's positions. Reuses scratch objects/array so
// the per-frame redraw allocates nothing: _mmLocal/_mmCar are mutated in place
// and _mmRemotes is refilled (length reset, not reallocated) each call.
const _mmLocal = { x: 0, z: 0, facing: 0 };
const _mmCar = { x: 0, z: 0, active: false };
const _mmRemotes = [];
function updateMinimap() {
  if (!local) return;
  _mmLocal.x = local.pos.x;
  _mmLocal.z = local.pos.z;
  _mmLocal.facing = local.facing;
  // Refill the remote-dot list in place (grow lazily; never shrink the backing array).
  const list = remotes.list();
  let n = 0;
  for (const e of list) {
    const p = e.character.group.position;
    let slot = _mmRemotes[n];
    if (!slot) { slot = { x: 0, z: 0 }; _mmRemotes[n] = slot; }
    slot.x = p.x;
    slot.z = p.z;
    n++;
  }
  _mmRemotes.length = n;
  // The car: bright while someone is driving it (rides.mode === "drive").
  const cs = rides.car.state;
  _mmCar.x = cs.x;
  _mmCar.z = cs.z;
  _mmCar.active = rides.mode === "drive";
  hud.updateMinimap(_mmLocal, _mmRemotes, _mmCar);
}

function maybeSendState() {
  const now = performance.now();
  if (now - lastStateSent < NET.stateInterval) return;
  const x = +local.pos.x.toFixed(3);
  const z = +local.pos.z.toFixed(3);
  // Height above ground: nonzero while jumping/flying (jetpack)/rocketing, so
  // others render you AT altitude instead of stuck on the ground. Includes the
  // skate-trick lift so airborne tricks read remotely too.
  const y = +((local.pos.y || 0) + (local.rideLift || 0)).toFixed(3);
  const ry = +local.facing.toFixed(3);
  const moving = local.moving;
  const sitting = local.sitting;
  // Ride tag (null | "car" | "skate") so remotes render the car/board mesh.
  const ride = rides.ride;
  // Held item id (null | item id) so remotes render the item in this player's hand.
  const held = local.heldId();
  // Only send if something changed (or we're moving) to save bandwidth. The ride
  // tag and held id are in the comparison so entering/exiting a vehicle or
  // buying/dropping an item forces an immediate send.
  if (
    x === lastSent.x &&
    z === lastSent.z &&
    y === lastSent.y &&
    ry === lastSent.ry &&
    moving === lastSent.moving &&
    sitting === lastSent.sitting &&
    ride === lastSent.ride &&
    held === lastSent.held
  ) {
    return;
  }
  network.sendState(x, z, ry, moving, sitting, local.seatY, ride, held, y);
  lastSent = { x, z, y, ry, moving, sitting, ride, held };
  lastStateSent = now;
}

// WEAPONS input (called each frame while joined): swap on 1/2/3, holster on 0,
// fire on B. Equipping shows the chosen hand-mesh and parents the held group onto
// the player's handAnchor (THREE.add re-parents from the scene); holstering hides
// all and detaches the group. A shot originates at the hand (world position,
// nudged forward so it clears the body) and flies along the camera's aim; it is
// drawn locally AND relayed (network.sendShot) so every other client replays the
// same projectile + explosion. Firing is suppressed while seated; controls.js
// already gates both edges to null/false while a game overlay holds the lock.
// Allocation-free: origin/aim reuse the _shot* scratch vectors.
// Equip (or holster, kind=null) a weapon and keep the held group parented to the
// player's hand. Shared by the number-key path (updateWeapons) and the ARMORY
// E-cycle (frame), so both swap weapons identically.
function equipWeapon(kind) {
  weapons.equip(kind);
  if (kind) {
    if (weapons.group.parent !== local.character.handAnchor) {
      local.character.handAnchor.add(weapons.group);
    }
  } else if (weapons.group.parent) {
    weapons.group.parent.remove(weapons.group); // holster: drop it out of the hand
  }
}

// Fire `kind` from the hand along the camera aim, drawn locally AND relayed so
// every other client replays the same projectile + blast. Reuses the _shot*
// scratch vectors, so this allocates nothing and is safe to call every frame on
// the held auto-fire path. Callers gate on weapons.current()/sitting/lock first.
function fireCurrentWeapon(kind) {
  camera.getWorldDirection(_shotDir); // aim along the camera forward
  local.character.handAnchor.getWorldPosition(_shotOrigin); // muzzle at the hand
  _shotOrigin.addScaledVector(_shotDir, 0.3); // nudge forward past the body
  weapons.fire(_shotOrigin, _shotDir, kind);
  network.sendShot(kind, _shotOrigin, _shotDir); // make it multiplayer-visible
}

function updateWeapons(dt) {
  const slot = controls.consumeWeaponSlot();
  if (slot != null) {
    const kind = slot === 1 ? "gun" : slot === 2 ? "rocket" : slot === 3 ? "grenade" : null;
    equipWeapon(kind);
  }
  const cur = weapons.current();
  // B KEY: single shot per press. consumeFire() is called first so the B edge
  // always drains, even when holstered; it's gated by `locked` in controls.js.
  if (controls.consumeFire() && cur && !local.sitting) {
    fireCurrentWeapon(cur);
  }
  // LEFT MOUSE: a click fires once; HOLDING the button auto-fires the GUN at its
  // fire-rate, while rocket/grenade stay single-shot per click. Always drain the
  // click edge so it can't accumulate. The gun is driven by the held flag (not the
  // click edge), so a held trigger and the drained click never double-fire.
  const clicked = controls.consumeClickFire();
  const held = controls.isFireHeld();
  if (cur && !local.sitting) {
    if (cur === "gun") {
      if (_gunCooldown > 0) _gunCooldown -= dt; // recover toward a ready trigger
      if (held && _gunCooldown <= 0) {
        fireCurrentWeapon("gun");
        _gunCooldown = GUN_FIRE_INTERVAL; // rate-limit sustained auto-fire
      }
    } else if (clicked) {
      fireCurrentWeapon(cur); // rocket / grenade: one blast per click
    }
  }
}

// CITY MAP input (called each frame while joined): M toggles the overlay (open
// only when NOT mid-game), we keep movement frozen + the player arrow live while
// it's up, and we unlock the moment it closes by any means. consumeMap is gated by
// `locked`, so the same M press that ui/map.js handles as a close can't bounce back
// through here and reopen it.
function updateMap() {
  // M opens the PLAIN travel map (only when NOT mid-game). Tag the mode first so
  // the overlay + onTravel treat the click as a fast-travel, not a cannon launch.
  if (controls.consumeMap() && !inWorld.open) {
    mapMode = "travel";
    gameMap.toggle("travel");
  }
  // Sync the movement lock to the map's REAL open state — it can self-close (Esc /
  // ✕ / M / a click) without telling us. Never fight a game's own lock.
  if (!inWorld.open && currentRole == null) {
    if (gameMap.isOpen && !_mapLocked) {
      controls.setLocked(true);
      _mapLocked = true;
    } else if (!gameMap.isOpen && _mapLocked) {
      controls.setLocked(false);
      _mapLocked = false;
      mapMode = "travel"; // map closed → next M opens a plain travel map
    }
  }
  // Track the live player arrow + the topCam world-rect — only while open, mutating
  // the cached payload in place so the per-frame redraw allocates nothing.
  if (gameMap.isOpen && local) {
    updateTopCam(); // keep _topBounds (which mapPayload.bounds references) current
    mapPayload.player.x = local.pos.x;
    mapPayload.player.z = local.pos.z;
    mapPayload.player.heading = local.facing;
    mapPayload.mode = mapMode;
    gameMap.render(mapPayload);
  }
}

requestAnimationFrame(frame);

// Expose a little surface for smoke tests / debugging.
window.__coffee = { scene, camera, renderer, network, remotes, get local() { return local; }, voice, screenShare, inWorld, ambient, rides, weapons, ocean, space, airport, cannon, audio, music, gameMap, topCam, setTimeOfDay, getTimeOfDay };
window.__coffeeReady = true;
