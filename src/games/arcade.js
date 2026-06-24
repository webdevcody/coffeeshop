// Arcade — manages the centered modal shown when you sit at a table.
// It has three states:
//   - menu:    the host picks which game to spin up (showMenu)
//   - waiting: the guest waits for the host to pick a game (showWaiting)
//   - game:    the chosen game runs in an <iframe> (show)
// The modal floats over a dimmed-but-see-through backdrop so you keep context
// of the coffeeshop (and who's in it) while you play. Closing the modal — via
// the Leave button, a backdrop click, or Escape — kicks you out of the game.
// It is deliberately game-agnostic: it just loads whatever URL the registry
// hands it. The server decides the room id and your role (host/guest).

import { getGame } from "./registry.js";

export class Arcade {
  constructor(root) {
    this.root = root || document.getElementById("ui");
    this.onLeave = null; // called when the player closes the overlay
    this.open = false;
    this.table = null;
    this._build();
  }

  _build() {
    const el = document.createElement("div");
    el.className = "arcade hidden";
    el.innerHTML = `
      <div class="arcade-modal" role="dialog" aria-modal="true" aria-label="Table game" tabindex="-1">
        <div class="arcade-bar">
          <span class="arcade-title" id="arcade-title">Game</span>
          <span class="arcade-status" id="arcade-status"></span>
          <button class="arcade-leave" id="arcade-leave" type="button"
                  title="Close — leaves the game">✕ Leave game</button>
        </div>
        <div class="arcade-stage" id="arcade-stage"></div>
      </div>`;
    this.root.appendChild(el);
    this.el = el;
    this.modal = el.querySelector(".arcade-modal");
    this.titleEl = el.querySelector("#arcade-title");
    this.statusEl = el.querySelector("#arcade-status");
    this.stage = el.querySelector("#arcade-stage");
    el.querySelector("#arcade-leave").addEventListener("click", () => this.onLeave?.());

    // Closing the modal kicks you out of the game. A click on the dimmed
    // backdrop (outside the modal) counts as closing — but only when the press
    // both starts and ends on the backdrop, so a drag out of the game doesn't
    // accidentally end the match.
    let downOnBackdrop = false;
    el.addEventListener("mousedown", (e) => {
      downOnBackdrop = e.target === el;
    });
    el.addEventListener("click", (e) => {
      if (downOnBackdrop && e.target === el) this.onLeave?.();
    });

    // Escape closes too (best-effort — a focused game iframe may swallow it).
    window.addEventListener("keydown", (e) => {
      if (!this.open || e.key !== "Escape") return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      this.onLeave?.();
    });

    // Focus trap: keep Tab/Shift+Tab cycling within the modal while it's open,
    // so keyboard/screen-reader users can't tab out to the page behind the
    // aria-modal dialog. Best-effort once focus is inside a game iframe, which
    // captures its own key events.
    this.modal.addEventListener("keydown", (e) => {
      if (!this.open || e.key !== "Tab") return;
      const f = this._focusables();
      if (f.length === 0) {
        e.preventDefault();
        this.modal.focus();
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // The tabbable controls inside the modal, in DOM order. Used to seed focus on
  // open and to wrap focus at the ends for the Tab trap.
  _focusables() {
    return Array.from(
      this.modal.querySelectorAll(
        'button, [href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.disabled);
  }

  _reveal() {
    // Remember what had focus so hide() can restore it when the modal closes.
    this._lastFocus = document.activeElement;
    this.el.classList.remove("hidden");
    this.open = true;
    // Move focus into the modal: the first interactive control (e.g. a menu
    // card or the Leave button), falling back to the modal container itself.
    const focusables = this._focusables();
    (focusables[0] || this.modal).focus();
  }

  // Host view: choose a game to spin up. `games` is the registry catalog
  // (id/name/blurb/icon). `onPick(gameId)` fires when a card is clicked.
  showMenu(tableLabel, games, onPick) {
    this.table = tableLabel || null;
    this.titleEl.textContent = `🎮 Pick a game${tableLabel ? ` · ${tableLabel}` : ""}`;
    this.statusEl.textContent = "You're hosting — choose what to play.";

    this.stage.textContent = "";
    this.frame = null;
    const menu = document.createElement("div");
    menu.className = "arcade-menu";
    for (const g of games) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "arcade-card";
      card.innerHTML = `
        <span class="arcade-card-icon">${g.icon || "🎮"}</span>
        <span class="arcade-card-name"></span>
        <span class="arcade-card-blurb"></span>`;
      card.querySelector(".arcade-card-name").textContent = g.name;
      card.querySelector(".arcade-card-blurb").textContent = g.blurb || "";
      card.addEventListener("click", () => onPick?.(g.id));
      menu.appendChild(card);
    }
    this.stage.appendChild(menu);
    this._reveal();
    return true;
  }

  // Guest view: the host hasn't picked a game yet.
  showWaiting(tableLabel, text) {
    this.table = tableLabel || null;
    this.titleEl.textContent = `🎮 ${tableLabel || "Game"}`;
    this.statusEl.textContent = "";
    this.stage.textContent = "";
    this.frame = null;
    const wrap = document.createElement("div");
    wrap.className = "arcade-waiting";
    wrap.innerHTML = `<div class="arcade-spinner"></div><p class="arcade-waiting-text"></p>`;
    wrap.querySelector(".arcade-waiting-text").textContent =
      text || "Waiting for the host to pick a game…";
    this.stage.appendChild(wrap);
    this._reveal();
    return true;
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

    this._reveal();
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
    // Drop the iframe / menu so the game tears down its PeerJS connection / audio.
    this.stage.textContent = "";
    this.frame = null;
    // Restore focus to whatever held it before the modal opened.
    if (this._lastFocus && typeof this._lastFocus.focus === "function") {
      this._lastFocus.focus();
    }
    this._lastFocus = null;
  }
}
