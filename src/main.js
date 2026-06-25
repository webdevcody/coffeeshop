// Entry point: wires the engine, world, players, networking, voice, and HUD
// together and runs the game loop. Kept deliberately thin — each subsystem lives
// in its own module so individual pieces can be iterated on in isolation.

import "./styles.css";
import * as THREE from "three";
import { createEngine } from "./engine/scene.js";
import { createPostFX } from "./engine/post.js";
import { createControls } from "./engine/controls.js";
import { createAudio } from "./engine/audio.js";
import { buildCoffeeshop } from "./world/coffeeshop.js";
import { buildOcean } from "./world/ocean.js";
import { buildSpace } from "./world/space.js";
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

const canvas = document.getElementById("scene");
const { renderer, scene, camera, labelRenderer, updateDayNight, setTimeOfDay, getTimeOfDay } = createEngine(canvas);
// Procedural sound engine (WebAudio). Lazily unlocks on the join click (a user
// gesture) — until then every call is a safe no-op. Drives ambient birds/wind, a
// vehicle engine hum, and one-shots (splash/whoosh/etc.).
const audio = createAudio();
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
const { colliders, seats, bar, ground, spawn, tables, update: updateWorld } = buildCoffeeshop(scene);

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
// Merged world surfaces: beaches/docks/island tops + the launchpad apron become
// walkable; island props (huts, palms, rail posts) + the gantry/fuel-tanks/flood
// masts become solid. Used everywhere `ground`/`colliders` are consumed by the
// player + rides so you can stroll the shoreline, sail the sea, and board the rocket.
// The walkable orbital STATION interior rides along too: its deck rects join the
// walkable ground (the player is LIFTED to space.stationFloorY on them — see
// local.setStation below) and its hull-wall / console AABBs join the colliders so
// you can't walk through them while strolling the station at altitude.
const groundAll = ground.concat(ocean.ground, space.ground, space.stationGround);
const collidersAll = colliders.concat(ocean.colliders, space.colliders, space.stationColliders);

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
const rides = createRides(scene, {
  colliders: collidersAll,
  isGround: isGroundFn,
  carSpawn: { x: 4, z: 18, heading: 0 },
  interactables, // E priority: car > boat > rocket > interactable > skateboard (handled in rides.js)
  ocean, // drivable boat lives in the sea; boarded from a dock (handled in rides.js)
  space, // launchable rocket parks on space.rocketSpawn; jetpack fly mode (F) lives here too
});
const remotes = new RemotePlayers(scene);
const hud = new HUD();
const network = new Network();
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

let local = null;
let joined = false;
// SWIM: tracks last frame's swim state so we can fire the splash one-shot exactly
// on the walk/fall → swim transition (entering the sea), not every frame afloat.
let _wasSwimming = false;
let lastStateSent = 0;
let lastSent = { x: NaN, z: NaN, y: NaN, ry: NaN, moving: false, sitting: false, ride: null, held: null };

// CITY MAP (M): a full-screen top-down overlay built from the fixed city layout.
// ui/map.js draws it + owns its own Esc / ✕ / M-to-close; we own M-to-OPEN
// (controls.consumeMap), freeze movement under it (setLocked), and feed it the live
// player arrow while open. Clicking the map fast-travels the local player there.
let _mapLocked = false; // true while WE locked controls for the open map
const gameMap = createMap({
  onTravel: ({ x, z }) => {
    // Fast travel: drop the local player onto the clicked world point. Vertical
    // settle / off-edge respawn is left to localPlayer._updateVertical.
    if (local) {
      local.pos.x = x;
      local.pos.z = z;
      local.pos.y = 0;
    }
    gameMap.close();
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
const _mapRoads = [];
for (const x of [-60, 0, 60]) _mapRoads.push({ x1: x, z1: 13, x2: x, z2: 277 });        // 3 avenues
for (const z of [35, 95, 155, 215]) _mapRoads.push({ x1: -122, z1: z, x2: 122, z2: z }); // 4 cross streets
const mapPayload = {
  districts: _mapDistricts,
  roads: _mapRoads,
  water: { minX: -220, maxX: 220, minZ: -90, maxZ: 360 }, // big bbox around the city
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
  updateCount();
});
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
  local = new LocalPlayer(scene, controls, collidersAll, { color }, name, seats, groundAll, spawn);
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
  network.connect();
  // Send our full resolved look (clothing + skin + hair) so others render us
  // identically, not a different per-id default.
  const appearance = local.getAppearance();
  network.on("open", () => network.join(name, appearance));
  // If we connected before the handler was attached (fast localhost), join now.
  if (network.connected) network.join(name, appearance);
  updateCount();
};

// The customize panel changed a color — restyle locally and tell everyone.
hud.onCustomize = (partial) => {
  if (!local) return;
  local.setAppearance(partial);
  network.sendAppearance(local.getAppearance());
  refreshPeople();
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
  updateWorld?.(dt); // animate the street: cars driving by, birds overhead
  interactables.update(dt); // advance in-progress "use" animations (piano keys, hoop shot, ATM glow, flash, steam)
  ocean.update(dt); // animate the sea: swell, sparkle, foam shimmer
  space.update(dt); // animate space: station spin, blinking beacons, drifting sats, star twinkle

  if (joined && local) {
    // Ride machine (walk / drive / skate). Driving owns the avatar + camera, so we
    // skip the normal walk update that frame and hide the on-foot avatar.
    const ride = rides.update(dt, camera, controls, local);
    if (ride.mode === "drive" || ride.mode === "boat" || ride.mode === "rocket") {
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
      const speed = ride.mode === "boat" ? (rides.boat?.state?.speed ?? 0)
        : ride.mode === "rocket" ? (rides.rocket?.state?.speed ?? 0)
        : rides.car.state.speed;
      hud.setDriveHud(true, speed); // speedometer + drive/sail/launch hint
      // Vehicle engine hum, pitch/level rising with speed (top speed ~12 m/s).
      audio.setEngine(true, Math.min(1, Math.abs(speed) / 12));
    } else {
      audio.setEngine(false); // on foot — no engine
      const seatedView = syncSeatedCamera();
      local.update(dt, camera, seatedView);
      // SWIM: splash one-shot on the moment we hit the water (not while afloat).
      if (local.swimming && !_wasSwimming) audio.splash();
      _wasSwimming = local.swimming;
      // True first-person while seated at a board: hide your OWN avatar so your body
      // doesn't fill the screen (only affects your local view; others still see you).
      if (local.character?.group) {
        local.character.group.visible = !(seatedView && seatedView.active);
      }
      // A ride prompt (drive/skate) takes precedence over the sit prompt.
      hud.setSitPrompt(ride.prompt || local.sitPromptText());
      // Open the coffee-bar menu when standing in the order zone; reflect whatever
      // you're holding (and the drop hint) the rest of the time.
      hud.setShopVisible(nearBar() && !local.sitting);
      hud.setHeldItem(local.heldName());
      hud.setDriveHud(false); // not driving — hide the speedometer
      // Sprint stamina meter (walk mode): bar fills with the 0..1 value, tints
      // while running and flashes when drained.
      hud.setStamina(local.staminaPct, local.sprinting);
    }
    // City minimap: redraw from this frame's positions (local arrow + facing,
    // remote dots, and the car). Cheap 2D draw into the HUD's reused canvas.
    updateMinimap();
    maybeSendState();
    updateWeapons();
    updateMap();
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

  postFX.render();
  labelRenderer.render(scene, camera);
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
function updateWeapons() {
  const slot = controls.consumeWeaponSlot();
  if (slot != null) {
    const kind = slot === 1 ? "gun" : slot === 2 ? "rocket" : slot === 3 ? "grenade" : null;
    weapons.equip(kind);
    if (kind) {
      if (weapons.group.parent !== local.character.handAnchor) {
        local.character.handAnchor.add(weapons.group);
      }
    } else if (weapons.group.parent) {
      weapons.group.parent.remove(weapons.group); // holster: drop it out of the hand
    }
  }
  // consumeFire() is called first so the B edge always drains, even when holstered.
  if (controls.consumeFire() && weapons.current() && !local.sitting) {
    const kind = weapons.current();
    camera.getWorldDirection(_shotDir); // aim along the camera forward
    local.character.handAnchor.getWorldPosition(_shotOrigin); // muzzle at the hand
    _shotOrigin.addScaledVector(_shotDir, 0.3); // nudge forward past the body
    weapons.fire(_shotOrigin, _shotDir, kind);
    network.sendShot(kind, _shotOrigin, _shotDir); // make it multiplayer-visible
  }
}

// CITY MAP input (called each frame while joined): M toggles the overlay (open
// only when NOT mid-game), we keep movement frozen + the player arrow live while
// it's up, and we unlock the moment it closes by any means. consumeMap is gated by
// `locked`, so the same M press that ui/map.js handles as a close can't bounce back
// through here and reopen it.
function updateMap() {
  if (controls.consumeMap() && !inWorld.open) gameMap.toggle();
  // Sync the movement lock to the map's REAL open state — it can self-close (Esc /
  // ✕ / M / a fast-travel click) without telling us. Never fight a game's own lock.
  if (!inWorld.open && currentRole == null) {
    if (gameMap.isOpen && !_mapLocked) {
      controls.setLocked(true);
      _mapLocked = true;
    } else if (!gameMap.isOpen && _mapLocked) {
      controls.setLocked(false);
      _mapLocked = false;
    }
  }
  // Track the live player arrow — only while open, mutating the cached payload in
  // place so the per-frame redraw allocates nothing.
  if (gameMap.isOpen && local) {
    mapPayload.player.x = local.pos.x;
    mapPayload.player.z = local.pos.z;
    mapPayload.player.heading = local.facing;
    gameMap.render(mapPayload);
  }
}

requestAnimationFrame(frame);

// Expose a little surface for smoke tests / debugging.
window.__coffee = { scene, camera, renderer, network, remotes, get local() { return local; }, voice, screenShare, inWorld, ambient, rides, weapons, ocean, space, audio, gameMap, setTimeOfDay, getTimeOfDay };
window.__coffeeReady = true;
