// Entry point: wires the engine, world, players, networking, voice, and HUD
// together and runs the game loop. Kept deliberately thin — each subsystem lives
// in its own module so individual pieces can be iterated on in isolation.

import "./styles.css";
import * as THREE from "three";
import { createEngine } from "./engine/scene.js";
import { createPostFX } from "./engine/post.js";
import { createControls } from "./engine/controls.js";
import { buildCoffeeshop } from "./world/coffeeshop.js";
import { buildOcean } from "./world/ocean.js";
import { buildInteractables } from "./world/interactables.js";
import { LocalPlayer } from "./entities/localPlayer.js";
import { createRides } from "./entities/rides.js";
import { RemotePlayers } from "./entities/remotePlayers.js";
import { Network } from "./net/network.js";
import { Voice } from "./net/voice.js";
import { ScreenShare } from "./net/screenShare.js";
import { HUD } from "./ui/hud.js";
import { Arcade } from "./games/arcade.js";
import { InWorldBoard } from "./games/inworld/board.js";
import { AmbientBoards } from "./games/inworld/ambient.js";
import { createGame as createFlipbookMenu } from "./games/inworld/menu.js";
import { getGame, listGames } from "./games/registry.js";
import { ITEMS, getItem } from "./world/items.js";
import { NET } from "./config.js";

const canvas = document.getElementById("scene");
const { renderer, scene, camera, labelRenderer, updateDayNight, setTimeOfDay, getTimeOfDay } = createEngine(canvas);
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
// Merged world surfaces: beaches/docks/island tops become walkable, island props
// (huts, palms, rail posts) become solid. Used everywhere `ground`/`colliders` are
// consumed by the player + rides so you can stroll the shoreline and sail the sea.
const groundAll = ground.concat(ocean.ground);
const collidersAll = colliders.concat(ocean.colliders);

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
  interactables, // E priority: car > boat > interactable > skateboard (handled in rides.js)
  ocean, // drivable boat lives in the sea; boarded from a dock (handled in rides.js)
});
const remotes = new RemotePlayers(scene);
const hud = new HUD();
const network = new Network();
const arcade = new Arcade();

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

let local = null;
let joined = false;
let lastStateSent = 0;
let lastSent = { x: NaN, z: NaN, ry: NaN, moving: false, sitting: false, ride: null, held: null };

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
  remotes.setState(m.id, m.x, m.z, m.ry, m.moving, m.sitting, m.seatY, m.ride, m.held);
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
  local = new LocalPlayer(scene, controls, collidersAll, { color }, name, seats, groundAll, spawn);
  // Coffee-bar shop: buying an item puts it in your hand (one at a time).
  hud.setShopItems(ITEMS);
  hud.onBuy = (id) => {
    const item = getItem(id);
    if (item) local.holdItem(item);
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

  if (joined && local) {
    // Ride machine (walk / drive / skate). Driving owns the avatar + camera, so we
    // skip the normal walk update that frame and hide the on-foot avatar.
    const ride = rides.update(dt, camera, controls, local);
    if (ride.mode === "drive" || ride.mode === "boat") {
      // Driving a car OR sailing the boat: the vehicle owns the avatar + camera, so
      // hide the on-foot avatar, suppress the bottom-center sit prompt, and show the
      // bottom-right speedometer (fed by whichever vehicle is active).
      if (local.character?.group) local.character.group.visible = false;
      hud.setSitPrompt(null);
      hud.setShopVisible(false);
      hud.setHeldItem(null);
      const speed = ride.mode === "boat" ? (rides.boat?.state?.speed ?? 0) : rides.car.state.speed;
      hud.setDriveHud(true, speed); // speedometer + drive/sail hint
    } else {
      const seatedView = syncSeatedCamera();
      local.update(dt, camera, seatedView);
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
    }
    // City minimap: redraw from this frame's positions (local arrow + facing,
    // remote dots, and the car). Cheap 2D draw into the HUD's reused canvas.
    updateMinimap();
    maybeSendState();
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
  voice.updateVolumes();
  voice.updateSpeaking(dt);
  screenShare.update(dt);

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
    ry === lastSent.ry &&
    moving === lastSent.moving &&
    sitting === lastSent.sitting &&
    ride === lastSent.ride &&
    held === lastSent.held
  ) {
    return;
  }
  network.sendState(x, z, ry, moving, sitting, local.seatY, ride, held);
  lastSent = { x, z, ry, moving, sitting, ride, held };
  lastStateSent = now;
}

requestAnimationFrame(frame);

// Expose a little surface for smoke tests / debugging.
window.__coffee = { scene, camera, renderer, network, remotes, get local() { return local; }, voice, screenShare, inWorld, ambient, rides, ocean, setTimeOfDay, getTimeOfDay };
window.__coffeeReady = true;
