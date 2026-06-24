// Entry point: wires the engine, world, players, networking, voice, and HUD
// together and runs the game loop. Kept deliberately thin — each subsystem lives
// in its own module so individual pieces can be iterated on in isolation.

import "./styles.css";
import * as THREE from "three";
import { createEngine } from "./engine/scene.js";
import { createControls } from "./engine/controls.js";
import { buildCoffeeshop } from "./world/coffeeshop.js";
import { LocalPlayer } from "./entities/localPlayer.js";
import { RemotePlayers } from "./entities/remotePlayers.js";
import { Network } from "./net/network.js";
import { Voice } from "./net/voice.js";
import { ScreenShare } from "./net/screenShare.js";
import { HUD } from "./ui/hud.js";
import { Arcade } from "./games/arcade.js";
import { InWorldBoard } from "./games/inworld/board.js";
import { createGame as createFlipbookMenu } from "./games/inworld/menu.js";
import { getGame, listGames } from "./games/registry.js";
import { ITEMS, getItem } from "./world/items.js";
import { NET } from "./config.js";

const canvas = document.getElementById("scene");
const { renderer, scene, camera, labelRenderer } = createEngine(canvas);
const { colliders, seats, bar, ground, spawn, tables, update: updateWorld } = buildCoffeeshop(scene);
const controls = createControls(canvas);
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

let local = null;
let joined = false;
let lastStateSent = 0;
let lastSent = { x: NaN, z: NaN, ry: NaN, moving: false, sitting: false };

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
  remotes.setState(m.id, m.x, m.z, m.ry, m.moving, m.sitting, m.seatY);
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
  const label = tableLabel(m.table);
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
  });
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

function tableLabel(table) {
  const n = parseInt(String(table).split("-")[1] || "0", 10) + 1;
  return Number.isFinite(n) ? `Table ${n}` : "Table";
}

// Called whenever the local player stands up (button, keyboard, or walking off).
function onLocalStood() {
  if (arcade.open) arcade.hide();
  if (inWorld.open) inWorld.unmount();
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
  local = new LocalPlayer(scene, controls, colliders, { color }, name, seats, ground, spawn);
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
function syncSeatedCamera() {
  const view = inWorld.getSeatedView ? inWorld.getSeatedView() : { active: false };
  const active = !!(view && view.active);
  if (active !== _seatedCamOn) {
    _seatedCamOn = active;
    // The camera orbits BEHIND the player: the offset baseline is seatRy+PI, so
    // facing the board centre puts the player's near edge at the screen bottom.
    // A null seatRy (shouldn't happen for a seated player) falls back to facing.
    const baseYaw = (Number.isFinite(view.seatRy) ? view.seatRy : (local?.facing ?? 0)) + Math.PI;
    controls.setSeated?.(active, baseYaw);
  }
  return active ? view : null;
}

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  controls.update();
  updateWorld?.(dt); // animate the street: cars driving by, birds overhead

  if (joined && local) {
    const seatedView = syncSeatedCamera();
    local.update(dt, camera, seatedView);
    // True first-person while seated at a board: hide your OWN avatar so your body
    // doesn't fill the screen (only affects your local view; others still see you).
    if (local.character?.group) {
      local.character.group.visible = !(seatedView && seatedView.active);
    }
    hud.setSitPrompt(local.sitPromptText());
    // Open the coffee-bar menu when standing in the order zone; reflect whatever
    // you're holding (and the drop hint) the rest of the time.
    hud.setShopVisible(nearBar() && !local.sitting);
    hud.setHeldItem(local.heldName());
    maybeSendState();
  } else {
    // Gentle interior orbit of the room while the join card is up.
    previewAngle += dt * 0.12;
    camera.position.set(Math.sin(previewAngle) * 7.5, 3.1, Math.cos(previewAngle) * 7.5);
    camera.lookAt(0, 1.3, 0);
  }

  // Pump real-time game sims (pong/tron host tick, ludo, etc.) on the shared loop.
  inWorld.update(dt);

  remotes.update(dt);
  voice.updateVolumes();
  voice.updateSpeaking(dt);
  screenShare.update(dt);

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function maybeSendState() {
  const now = performance.now();
  if (now - lastStateSent < NET.stateInterval) return;
  const x = +local.pos.x.toFixed(3);
  const z = +local.pos.z.toFixed(3);
  const ry = +local.facing.toFixed(3);
  const moving = local.moving;
  const sitting = local.sitting;
  // Only send if something changed (or we're moving) to save bandwidth.
  if (
    x === lastSent.x &&
    z === lastSent.z &&
    ry === lastSent.ry &&
    moving === lastSent.moving &&
    sitting === lastSent.sitting
  ) {
    return;
  }
  network.sendState(x, z, ry, moving, sitting, local.seatY);
  lastSent = { x, z, ry, moving, sitting };
  lastStateSent = now;
}

requestAnimationFrame(frame);

// Expose a little surface for smoke tests / debugging.
window.__coffee = { scene, camera, renderer, network, remotes, get local() { return local; }, voice, screenShare, inWorld };
window.__coffeeReady = true;
