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
import { HUD } from "./ui/hud.js";
import { Arcade } from "./games/arcade.js";
import { getGame, listGames } from "./games/registry.js";
import { NET } from "./config.js";

const canvas = document.getElementById("scene");
const { renderer, scene, camera, labelRenderer } = createEngine(canvas);
const { colliders, seats } = buildCoffeeshop(scene);
const controls = createControls(canvas);
const remotes = new RemotePlayers(scene);
const hud = new HUD();
const network = new Network();
const arcade = new Arcade();

let local = null;
let joined = false;
let lastStateSent = 0;
let lastSent = { x: NaN, z: NaN, ry: NaN, moving: false, sitting: false };

// Voice needs to know where everyone is so it can attenuate by distance.
const voice = new Voice(network, {
  local: () => (local ? { x: local.pos.x, z: local.pos.z } : { x: 0, z: 0 }),
  remote: (id) => {
    const e = remotes.players.get(id);
    if (!e) return null;
    const p = e.character.group.position;
    return { x: p.x, z: p.z };
  },
});
voice.onStatus = (s) => hud.setVoiceStatus(s);
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

  // Spectators watch a match already in progress (or wait for it to begin).
  if (m.role === "spectator") {
    if (!m.gameId) {
      arcade.showWaiting(label, "Table's full — you'll spectate once the game begins…");
      return;
    }
    const game = getGame(m.gameId);
    if (!game) return;
    if (!game.spectatable) {
      // Game can't be watched (e.g. battleship) — free the seat and bow out.
      hud.toast(`${game.name} is full and can't be spectated.`);
      local?.standUp();
      return;
    }
    arcade.show(m.gameId, m.roomId, "spectator", label);
    return;
  }

  // No game chosen yet: the host picks from the menu, the guest waits.
  if (!m.gameId) {
    if (m.role === "host") {
      arcade.showMenu(label, listGames(), (gameId) => {
        if (!local?.sitting || local.seat?.table !== m.table) return;
        network.chooseGame(m.table, gameId, getGame(gameId)?.capacity ?? 2);
      });
    } else {
      arcade.showWaiting(label, "Waiting for the host to pick a game…");
    }
    return;
  }

  // A game is locked in — open it.
  if (!getGame(m.gameId)) return;
  arcade.show(m.gameId, m.roomId, m.role, label);
});

network.on("game-end", () => {
  if (!arcade.open) return;
  arcade.setStatus(
    currentRole === "spectator"
      ? "The match ended — leave to head back."
      : "Opponent left — game over. Leave to head back."
  );
});

// The overlay's "Leave game" button: stand up, which closes everything below.
arcade.onLeave = () => local?.standUp();

function tableLabel(table) {
  const n = parseInt(String(table).split("-")[1] || "0", 10) + 1;
  return Number.isFinite(n) ? `Table ${n}` : "Table";
}

// Called whenever the local player stands up (button, keyboard, or walking off).
function onLocalStood() {
  if (arcade.open) arcade.hide();
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
  local = new LocalPlayer(scene, controls, colliders, color, name, seats);
  // Sitting at a game table asks the server for a role; the reply opens the
  // game-picker menu (host) or a waiting screen (guest), then the game itself.
  local.onSit = (seat) => {
    if (seat?.table && seat?.gameTable) network.requestGame(seat.table);
  };
  local.onStand = (seat) => {
    if (seat?.table && seat?.gameTable) onLocalStood();
  };
  joined = true;
  network.connect();
  network.on("open", () => network.join(name, color));
  // If we connected before the handler was attached (fast localhost), join now.
  if (network.connected) network.join(name, color);
  updateCount();
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

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  controls.update();

  if (joined && local) {
    local.update(dt, camera);
    hud.setSitPrompt(local.sitPromptText());
    maybeSendState();
  } else {
    // Gentle interior orbit of the room while the join card is up.
    previewAngle += dt * 0.12;
    camera.position.set(Math.sin(previewAngle) * 7.5, 3.1, Math.cos(previewAngle) * 7.5);
    camera.lookAt(0, 1.3, 0);
  }

  remotes.update(dt);
  voice.updateVolumes();
  voice.updateSpeaking(dt);

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
window.__coffee = { scene, camera, renderer, network, remotes, get local() { return local; }, voice };
window.__coffeeReady = true;
