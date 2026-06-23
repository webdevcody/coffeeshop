// Arcade — manages the full-viewport overlay that hosts a game in an <iframe>
// when you sit down at a table. It is deliberately game-agnostic: it just loads
// whatever URL the registry hands it. The server decides the room id and your
// role (host/guest); this only renders.

import { getGame } from "./registry.js";

export class Arcade {
  constructor(root) {
    this.root = root || document.getElementById("ui");
    this.onLeave = null; // called when the player closes the game
    this.open = false;
    this.table = null;
    this._build();
  }

  _build() {
    const el = document.createElement("div");
    el.className = "arcade hidden";
    el.innerHTML = `
      <div class="arcade-bar">
        <span class="arcade-title" id="arcade-title">Game</span>
        <span class="arcade-status" id="arcade-status"></span>
        <button class="arcade-leave" id="arcade-leave" type="button">✕ Leave game</button>
      </div>
      <div class="arcade-stage" id="arcade-stage"></div>`;
    this.root.appendChild(el);
    this.el = el;
    this.titleEl = el.querySelector("#arcade-title");
    this.statusEl = el.querySelector("#arcade-status");
    this.stage = el.querySelector("#arcade-stage");
    el.querySelector("#arcade-leave").addEventListener("click", () => this.onLeave?.());
  }

  // Open a game. `gameId` is a registry key; `roomId`/`role` come from the
  // server. Returns true if the game was opened, false if it couldn't be.
  show(gameId, roomId, role, tableLabel) {
    const game = getGame(gameId);
    if (!game) return false;
    this.table = tableLabel || null;
    this.titleEl.textContent = `🎮 ${game.name}${tableLabel ? ` · ${tableLabel}` : ""}`;
    this.statusEl.textContent = role === "host" ? "Hosting — waiting for an opponent…" : "Joining the match…";

    // Fresh iframe each time so the game restarts cleanly.
    this.stage.textContent = "";
    const frame = document.createElement("iframe");
    frame.className = "arcade-frame";
    frame.allow = "microphone; autoplay; fullscreen";
    frame.src = game.url(roomId, role);
    this.stage.appendChild(frame);
    this.frame = frame;

    this.el.classList.remove("hidden");
    this.open = true;
    return true;
  }

  // Update the small status line (e.g. when the opponent leaves).
  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text || "";
  }

  hide() {
    this.open = false;
    this.table = null;
    this.el.classList.add("hidden");
    // Drop the iframe so the game tears down its PeerJS connection / audio.
    this.stage.textContent = "";
    this.frame = null;
  }
}
