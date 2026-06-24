// All 2D interface chrome: the join overlay, the chat bar + message log, the
// voice toggle, the online-count pill, and the controls hint. Builds its own DOM
// inside #ui and surfaces interactions through assignable callbacks.

import { PALETTE } from "../config.js";

export class HUD {
  constructor(root) {
    this.root = root || document.getElementById("ui");
    this.onJoin = null;
    this.onChat = null;
    this.onToggleVoice = null;
    this.onToggleMic = null;
    this.onToggleDeafen = null;
    this.onToggleMute = null;
    this.onToggleShare = null; // toggle screen sharing
    this.joined = false;
    this._buildJoin();
    this._buildGame();
  }

  // --- Join overlay --------------------------------------------------------
  _buildJoin() {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="card">
        <div class="logo">☕</div>
        <h1>The Daily Grind</h1>
        <p class="sub">A cozy multiplayer café. Walk around, chat, hang out.</p>
        <label class="field-label" for="name-input">Your name</label>
        <input id="name-input" class="text-input" maxlength="16" placeholder="Barista_Bob" autocomplete="off" />
        <div class="field-label">Pick a color</div>
        <div class="swatches" id="swatches"></div>
        <button id="enter-btn" class="primary-btn">Enter the café</button>
        <div class="hint-row">WASD / arrows to move · drag to look · Space to sit · Enter to chat</div>
      </div>`;
    this.root.appendChild(overlay);
    this.overlay = overlay;

    this.selectedColor = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const swatches = overlay.querySelector("#swatches");
    for (const c of PALETTE) {
      const s = document.createElement("button");
      s.className = "swatch" + (c === this.selectedColor ? " active" : "");
      s.style.background = c;
      s.addEventListener("click", () => {
        this.selectedColor = c;
        swatches.querySelectorAll(".swatch").forEach((el) => el.classList.remove("active"));
        s.classList.add("active");
      });
      swatches.appendChild(s);
    }

    const nameInput = overlay.querySelector("#name-input");
    const enter = overlay.querySelector("#enter-btn");
    const submit = () => {
      // Guard against a second join (e.g. a stray click on the faded overlay)
      // spawning a duplicate local player.
      if (this.joined) return;
      this.joined = true;
      const name = (nameInput.value || "").trim() || "Guest";
      this.overlay.classList.add("hidden");
      this.gameUi.classList.remove("hidden");
      this.onJoin?.({ name, color: this.selectedColor });
      setTimeout(() => this.chatInput?.blur(), 0);
    };
    enter.addEventListener("click", submit);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    setTimeout(() => nameInput.focus(), 100);
  }

  // --- In-game UI ----------------------------------------------------------
  _buildGame() {
    const ui = document.createElement("div");
    ui.className = "game-ui hidden";
    ui.innerHTML = `
      <div class="topbar">
        <div class="pill" id="count-pill">☕ 1 here</div>
        <button class="pill people-btn" id="people-btn">👥 People</button>
        <button class="pill voice-btn" id="voice-btn">🎙️ Enable voice</button>
        <button class="pill mic-btn hidden" id="mic-btn">🎤 Mic on</button>
        <button class="pill deafen-btn hidden" id="deafen-btn">🔊 Audio on</button>
        <button class="pill share-btn" id="share-btn">🖥️ Share screen</button>
      </div>
      <div class="people-panel hidden" id="people-panel">
        <div class="people-title">People in the café</div>
        <div class="people-list" id="people-list"></div>
        <div class="people-foot">Muting silences a person's voice for you only.</div>
      </div>
      <div class="chat-log" id="chat-log"></div>
      <div class="sit-prompt hidden" id="sit-prompt"></div>
      <form class="chat-bar" id="chat-bar" autocomplete="off">
        <input id="chat-input" class="chat-input" maxlength="200" placeholder="Press Enter to say something…" />
        <button class="send-btn" type="submit">Send</button>
      </form>`;
    this.root.appendChild(ui);
    this.gameUi = ui;

    this.countPill = ui.querySelector("#count-pill");
    this.voiceBtn = ui.querySelector("#voice-btn");
    this.micBtn = ui.querySelector("#mic-btn");
    this.deafenBtn = ui.querySelector("#deafen-btn");
    this.peopleBtn = ui.querySelector("#people-btn");
    this.shareBtn = ui.querySelector("#share-btn");
    this.peoplePanel = ui.querySelector("#people-panel");
    this.peopleList = ui.querySelector("#people-list");
    this.chatLog = ui.querySelector("#chat-log");
    this.sitPrompt = ui.querySelector("#sit-prompt");
    this.chatInput = ui.querySelector("#chat-input");
    const form = ui.querySelector("#chat-bar");

    this.peopleBtn.addEventListener("click", () => {
      const open = this.peoplePanel.classList.toggle("hidden");
      this.peopleBtn.classList.toggle("active", !open);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = (this.chatInput.value || "").trim();
      if (text) this.onChat?.(text);
      this.chatInput.value = "";
      this.chatInput.blur();
    });

    this.voiceBtn.addEventListener("click", () => this.onToggleVoice?.());
    this.micBtn.addEventListener("click", () => this.onToggleMic?.());
    this.deafenBtn.addEventListener("click", () => this.onToggleDeafen?.());
    this.shareBtn.addEventListener("click", () => this.onToggleShare?.());

    // Enter focuses chat when not already typing; Escape blurs.
    window.addEventListener("keydown", (e) => {
      const typing = document.activeElement === this.chatInput;
      if (e.key === "Enter" && !typing && !this.gameUi.classList.contains("hidden")) {
        e.preventDefault();
        this.chatInput.focus();
      } else if (e.key === "Escape" && typing) {
        this.chatInput.blur();
      }
    });
  }

  setCount(n) {
    this.countPill.textContent = `☕ ${n} here`;
  }

  // Brief, self-dismissing message centered near the top (e.g. "table full").
  toast(text) {
    if (!text) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    this.gameUi.appendChild(el);
    setTimeout(() => el.classList.add("show"), 10);
    setTimeout(() => el.classList.remove("show"), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  // Show/hide the contextual "Press Space to sit / stand" prompt. Pass a falsy
  // value to hide it.
  setSitPrompt(text) {
    if (!this.sitPrompt) return;
    if (text) {
      if (this.sitPrompt.textContent !== text) this.sitPrompt.textContent = text;
      this.sitPrompt.classList.remove("hidden");
    } else {
      this.sitPrompt.classList.add("hidden");
    }
  }

  setVoiceStatus(status) {
    const map = {
      on: "🎙️ Voice on",
      off: "🎙️ Enable voice",
      "mic blocked": "🚫 Mic blocked",
      connecting: "… connecting",
    };
    this.voiceBtn.textContent = map[status] || status;
    this.voiceBtn.classList.toggle("active", status === "on");
    // The mic-mute and deafen controls only make sense while voice is connected.
    const live = status === "on";
    this.micBtn.classList.toggle("hidden", !live);
    this.deafenBtn.classList.toggle("hidden", !live);
  }

  // Reflect whether your own mic is muted (you stay connected; others can't hear you).
  setMicMuted(muted) {
    this.micBtn.textContent = muted ? "🔇 Mic muted" : "🎤 Mic on";
    this.micBtn.title = muted ? "Unmute your microphone" : "Mute your microphone";
    this.micBtn.classList.toggle("muted", muted);
  }

  // Reflect whether all incoming voices are silenced for you.
  setDeafened(deafened) {
    this.deafenBtn.textContent = deafened ? "🔕 Audio muted" : "🔊 Audio on";
    this.deafenBtn.title = deafened ? "Unmute everyone" : "Mute everyone in the room";
    this.deafenBtn.classList.toggle("muted", deafened);
  }

  // Reflect whether you're currently sharing your screen.
  setSharing(sharing) {
    if (!this.shareBtn) return;
    this.shareBtn.textContent = sharing ? "🖥️ Stop sharing" : "🖥️ Share screen";
    this.shareBtn.title = sharing ? "Stop sharing your screen" : "Share your screen with people around you";
    this.shareBtn.classList.toggle("active", sharing);
  }

  // Render the roster of other people, each with a per-person mute toggle.
  // `people` is [{ id, name, color, muted }].
  setPeople(people) {
    if (!this.peopleList) return;
    this.peopleBtn.textContent = `👥 ${people.length} ${people.length === 1 ? "person" : "people"}`;
    this.peopleList.textContent = "";

    if (!people.length) {
      const empty = document.createElement("div");
      empty.className = "people-empty";
      empty.textContent = "No one else here yet.";
      this.peopleList.appendChild(empty);
      return;
    }

    for (const p of people) {
      const row = document.createElement("div");
      row.className = "person-row";

      const dot = document.createElement("span");
      dot.className = "person-dot";
      if (p.color) dot.style.background = p.color;

      const name = document.createElement("span");
      name.className = "person-name";
      name.textContent = p.name;

      const btn = document.createElement("button");
      btn.className = "mute-btn" + (p.muted ? " muted" : "");
      btn.textContent = p.muted ? "🔇 Muted" : "🔊 Mute";
      btn.title = (p.muted ? "Unmute " : "Mute ") + p.name;
      btn.addEventListener("click", () => this.onToggleMute?.(p.id));

      row.append(dot, name, btn);
      this.peopleList.appendChild(row);
    }
  }

  addChatLog(name, text, color) {
    const line = document.createElement("div");
    line.className = "chat-line";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = name + ": ";
    if (color) who.style.color = color;
    const body = document.createElement("span");
    body.textContent = text;
    line.append(who, body);
    this.chatLog.appendChild(line);
    // keep the log short
    while (this.chatLog.children.length > 8) this.chatLog.removeChild(this.chatLog.firstChild);
    // auto-fade old lines
    setTimeout(() => line.classList.add("fade"), 9000);
    setTimeout(() => line.remove(), 11000);
  }
}
