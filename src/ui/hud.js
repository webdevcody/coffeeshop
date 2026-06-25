// All 2D interface chrome: the join overlay, the chat bar + message log, the
// voice toggle, the online-count pill, and the controls hint. Builds its own DOM
// inside #ui and surfaces interactions through assignable callbacks.

import { PALETTE, SKIN_TONES, HAIR_TONES } from "../config.js";

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
    this.onBuy = null; // (itemId) => void — buy an item at the coffee bar
    this.onCustomize = null; // ({ color?, skin?, hair? }) — a swatch was picked
    this.appearance = { color: null, skin: null, hair: null };
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
      <div class="look-corner">
        <button class="pill look-btn" id="look-btn">🎨 Customize</button>
        <div class="customize-panel hidden" id="customize-panel">
          <div class="people-title">Customize your look</div>
          <div class="custom-row"><span class="custom-label">Skin</span><div class="swatch-row" id="skin-swatches"></div></div>
          <div class="custom-row"><span class="custom-label">Hair</span><div class="swatch-row" id="hair-swatches"></div></div>
          <div class="custom-row"><span class="custom-label">Clothing</span><div class="swatch-row" id="cloth-swatches"></div></div>
        </div>
      </div>
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
      <div class="shop-panel hidden" id="shop-panel">
        <div class="shop-title">☕ Coffee bar · pay with fake money</div>
        <div class="shop-list" id="shop-list"></div>
      </div>
      <div class="held-item hidden" id="held-item"></div>
      <div class="sit-prompt hidden" id="sit-prompt"></div>
      <div class="minimap" id="minimap">
        <canvas class="minimap-canvas" id="minimap-canvas" width="180" height="180"></canvas>
        <div class="minimap-legend">
          <span class="mm-leg mm-leg-you">▲ You</span>
          <span class="mm-leg mm-leg-them">● Others</span>
          <span class="mm-leg mm-leg-car">● Car</span>
        </div>
      </div>
      <div class="drive-hud hidden" id="drive-hud">
        <div class="speedo"><span class="speedo-num" id="speedo-num">0</span><span class="speedo-unit">km/h</span></div>
        <div class="drive-hint" id="drive-hint">WASD to drive · E to exit</div>
      </div>
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
    this.lookBtn = ui.querySelector("#look-btn");
    this.customizePanel = ui.querySelector("#customize-panel");
    this.chatLog = ui.querySelector("#chat-log");
    this.sitPrompt = ui.querySelector("#sit-prompt");
    this.shopPanel = ui.querySelector("#shop-panel");
    this.shopList = ui.querySelector("#shop-list");
    this.heldEl = ui.querySelector("#held-item");
    this.chatInput = ui.querySelector("#chat-input");
    const form = ui.querySelector("#chat-bar");

    // City minimap + driving HUD. The canvas + 2D context are grabbed once and
    // reused every frame (no per-frame allocation). _initMinimap precomputes the
    // static road/district geometry into world->canvas mapping constants.
    this.driveHud = ui.querySelector("#drive-hud");
    this.speedoNum = ui.querySelector("#speedo-num");
    this.driveHint = ui.querySelector("#drive-hint");
    this.minimapCanvas = ui.querySelector("#minimap-canvas");
    this._initMinimap();

    this.peopleBtn.addEventListener("click", () => {
      const visible = !this.peoplePanel.classList.toggle("hidden");
      this.peopleBtn.classList.toggle("active", visible);
    });

    // Customize panel: one swatch row per editable part. Picking a swatch fires
    // onCustomize with just that field and re-highlights the active choice.
    this._swatchRows = {
      skin: this._buildSwatchRow(ui.querySelector("#skin-swatches"), SKIN_TONES, "skin", "Skin"),
      hair: this._buildSwatchRow(ui.querySelector("#hair-swatches"), HAIR_TONES, "hair", "Hair"),
      color: this._buildSwatchRow(ui.querySelector("#cloth-swatches"), PALETTE, "color", "Clothing"),
    };
    this.lookBtn.addEventListener("click", () => {
      const visible = !this.customizePanel.classList.toggle("hidden");
      this.lookBtn.classList.toggle("active", visible);
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

  // Build a row of color swatches for one appearance field; clicking one fires
  // onCustomize({ [field]: hex }). Returns the row's <button> elements so
  // setAppearance can highlight the active one. `label` is the human field name
  // (e.g. "Clothing") used for each swatch's accessible name, since the swatch
  // itself is only a background colour with nothing for a screen reader to read.
  _buildSwatchRow(container, colors, field, label) {
    const btns = [];
    for (const c of colors) {
      const s = document.createElement("button");
      s.type = "button";
      s.className = "swatch sm";
      s.style.background = c;
      s.dataset.color = c.toLowerCase();
      s.setAttribute("aria-label", `${label} ${c}`);
      s.setAttribute("aria-pressed", "false");
      s.addEventListener("click", () => {
        this.appearance[field] = c;
        this._highlightRow(field);
        this.onCustomize?.({ [field]: c });
      });
      container.appendChild(s);
      btns.push(s);
    }
    return btns;
  }

  _highlightRow(field) {
    const active = (this.appearance[field] || "").toLowerCase();
    for (const b of this._swatchRows[field]) {
      const on = b.dataset.color === active;
      b.classList.toggle("active", on);
      // Expose the selected swatch to assistive tech, not just the visual outline.
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  // Sync the customize panel to the player's current look (called after join and
  // whenever appearance changes), so the active swatches reflect reality.
  setAppearance(app = {}) {
    Object.assign(this.appearance, app);
    for (const field of ["skin", "hair", "color"]) this._highlightRow(field);
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

  // Persistent, screen-space game status banner (top-centre). Used by in-world
  // games (e.g. battleship) so the status is ALWAYS readable for EVERY player and
  // never clipped/occluded by 3D furniture across the table.
  setGameBanner(text) {
    if (!text) return this.clearGameBanner();
    if (!this._gameBanner) {
      const el = document.createElement("div");
      el.className = "game-banner";
      this.gameUi.appendChild(el);
      this._gameBanner = el;
    }
    this._gameBanner.textContent = text;
    this._gameBanner.classList.add("show");
  }

  clearGameBanner() {
    if (this._gameBanner) this._gameBanner.classList.remove("show");
  }

  // Screen-space placement control bar (battleship Rotate/Randomize/Clear/Ready)
  // so the controls float as a HUD and never overlap the 3D board/ships. `defs` is
  // [{ id, label, enabled?, primary? }]; clicking a button calls onClick(id). An
  // empty/falsy defs hides the bar.
  setGameControls(defs, onClick) {
    if (!this._gameControls) {
      const el = document.createElement("div");
      el.className = "game-controls";
      this.gameUi.appendChild(el);
      this._gameControls = el;
    }
    const bar = this._gameControls;
    bar.textContent = "";
    if (!defs || !defs.length) {
      bar.classList.remove("show");
      return;
    }
    for (const d of defs) {
      const b = document.createElement("button");
      b.className = "game-ctl-btn" + (d.primary ? " primary" : "") + (d.enabled === false ? " disabled" : "");
      b.textContent = d.label;
      b.addEventListener("click", (e) => { e.preventDefault(); onClick?.(d.id); });
      bar.appendChild(b);
    }
    bar.classList.add("show");
  }

  clearGameControls() {
    if (this._gameControls) {
      this._gameControls.textContent = "";
      this._gameControls.classList.remove("show");
    }
  }

  // Screen-space fleet-status cards (battleship). `panels` is
  // [{ title, accent, sunk, total, ships:[{name,length,dead}] }] — rendered as DOM
  // cards pinned to the screen corners so the table pedestal / 3D bodies across the
  // table can never clip them. Empty/falsy panels hides the cards.
  setFleetPanels(panels) {
    if (!this._fleetPanels) {
      const el = document.createElement("div");
      el.className = "fleet-panels";
      this.gameUi.appendChild(el);
      this._fleetPanels = el;
    }
    const wrap = this._fleetPanels;
    wrap.textContent = "";
    if (!panels || !panels.length) {
      wrap.classList.remove("show");
      return;
    }
    for (const p of panels) {
      const card = document.createElement("div");
      card.className = "fleet-card" + (p.mine ? " mine" : "");
      card.style.setProperty("--accent", p.accent || "#7fd1ff");

      const head = document.createElement("div");
      head.className = "fleet-head";
      const title = document.createElement("span");
      title.className = "fleet-title";
      title.textContent = p.title;
      const count = document.createElement("span");
      count.className = "fleet-count";
      count.textContent = `${p.sunk}/${p.total} sunk`;
      head.appendChild(title);
      head.appendChild(count);
      card.appendChild(head);

      for (const s of p.ships || []) {
        const row = document.createElement("div");
        row.className = "fleet-row" + (s.dead ? " dead" : "");
        const name = document.createElement("span");
        name.className = "fleet-ship";
        name.textContent = s.name;
        const pips = document.createElement("span");
        pips.className = "fleet-pips";
        for (let i = 0; i < s.length; i++) {
          const pip = document.createElement("i");
          pip.className = "fleet-pip";
          pips.appendChild(pip);
        }
        row.appendChild(name);
        row.appendChild(pips);
        card.appendChild(row);
      }
      wrap.appendChild(card);
    }
    wrap.classList.add("show");
  }

  clearFleetPanels() {
    if (this._fleetPanels) {
      this._fleetPanels.textContent = "";
      this._fleetPanels.classList.remove("show");
    }
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

  // Populate the coffee-bar menu once with the item catalog. Each item buys via
  // the onBuy callback.
  setShopItems(items) {
    if (!this.shopList) return;
    this.shopList.innerHTML = "";
    for (const it of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shop-item";
      btn.innerHTML = `<span class="shop-item-icon">${it.icon || "🛍️"}</span><span class="shop-item-name"></span><span class="shop-item-price">§${it.price}</span>`;
      btn.querySelector(".shop-item-name").textContent = it.name;
      btn.addEventListener("click", () => this.onBuy?.(it.id));
      this.shopList.appendChild(btn);
    }
  }

  // Show/hide the coffee-bar menu (shown when you stand at the counter).
  setShopVisible(on) {
    if (!this.shopPanel) return;
    this.shopPanel.classList.toggle("hidden", !on);
  }

  // Reflect the item currently in your hand (or null) with a drop hint.
  setHeldItem(name) {
    if (!this.heldEl) return;
    if (name) {
      const text = `Holding ${name} · press G to drop`;
      if (this.heldEl.textContent !== text) this.heldEl.textContent = text;
      this.heldEl.classList.remove("hidden");
    } else {
      this.heldEl.classList.add("hidden");
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

  // --- City minimap --------------------------------------------------------
  // The world spans x[-122,122], z[13,277] with the cafe near z~0..11. We frame a
  // slightly padded square so the cafe and the city both fit, and cache the 2D
  // context + world->canvas scale once. Everything in updateMinimap() draws into
  // this same canvas/context — no per-frame allocation.
  _initMinimap() {
    const cv = this.minimapCanvas;
    if (!cv) return;
    this._mmCtx = cv.getContext("2d");
    this._mmW = cv.width;
    this._mmH = cv.height;
    // World extent we map onto the canvas (a touch of padding around the city).
    const PAD = 8;
    this._mmWorld = { minX: -122 - PAD, maxX: 122 + PAD, minZ: -14, maxZ: 277 + PAD };
    const w = this._mmWorld;
    this._mmInset = 6; // canvas margin so the border ring isn't clipped
    const usableW = this._mmW - this._mmInset * 2;
    const usableH = this._mmH - this._mmInset * 2;
    // Uniform scale (keep aspect) — the z span is larger than x, so z drives it.
    this._mmScale = Math.min(usableW / (w.maxX - w.minX), usableH / (w.maxZ - w.minZ));
    // Center the mapped world inside the canvas.
    this._mmOffX = this._mmInset + (usableW - (w.maxX - w.minX) * this._mmScale) / 2;
    this._mmOffZ = this._mmInset + (usableH - (w.maxZ - w.minZ) * this._mmScale) / 2;
    // Static city geometry (drawn fresh each frame but the arrays are built once).
    this._mmAvenues = [-60, 0, 60]; // vertical roads (constant x)
    this._mmStreets = [35, 95, 155, 215]; // horizontal roads (constant z)
    // 16 district blocks: 4 columns (between/outside avenues) x 4 rows (between
    // streets). Each is a cell label + tint; computed once and reused.
    this._mmDistricts = this._buildDistricts();
    // Reusable point object so the per-frame world->canvas mapping allocates nothing.
    this._mmPt = { x: 0, y: 0 };
  }

  // Build the 16 district cells from the avenue/street grid. Columns are the x
  // bands split by the avenues; rows are the z bands split by the cross-streets.
  _buildDistricts() {
    const w = this._mmWorld;
    const xs = [w.minX, -60, 0, 60, w.maxX];
    const zs = [13, 35, 95, 155, 215, w.maxZ];
    // Use the 4 z-bands between the 4 cross-streets plus city edges → pick 4 rows.
    const rows = [[13, 35], [35, 95], [95, 155], [155, 215]];
    const cols = [[w.minX, -60], [-60, 0], [0, 60], [60, w.maxX]];
    const tints = [
      "rgba(224,150,107,0.10)", "rgba(120,180,140,0.10)",
      "rgba(120,160,210,0.10)", "rgba(210,170,110,0.10)",
    ];
    const names = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"];
    const out = [];
    let i = 0;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols.length; c++) {
        out.push({
          minX: cols[c][0], maxX: cols[c][1],
          minZ: rows[r][0], maxZ: rows[r][1],
          tint: tints[(r + c) % tints.length],
          label: names[i % names.length] + (Math.floor(i / names.length) + 1),
        });
        i++;
      }
    }
    return out;
  }

  // World (x,z) -> canvas (px,py). Reuses one point object; +z (north into the
  // city) is "up" so the map matches the player's intuition of the street ahead.
  _mmProject(x, z) {
    const w = this._mmWorld;
    const p = this._mmPt;
    p.x = this._mmOffX + (x - w.minX) * this._mmScale;
    // Flip z so larger z (deeper into the city) is toward the TOP of the minimap.
    p.y = this._mmOffZ + (w.maxZ - z) * this._mmScale;
    return p;
  }

  // Redraw the whole minimap from this frame's positions. Called once per frame
  // from main.js. `local` = { x, z, facing } | null. `remotes` = [{x,z}].
  // `car` = { x, z, active } | null (active true while someone is driving it).
  updateMinimap(local, remotes, car) {
    const ctx = this._mmCtx;
    if (!ctx) return;
    const W = this._mmW, H = this._mmH;
    ctx.clearRect(0, 0, W, H);

    // Backdrop.
    ctx.fillStyle = "rgba(24,16,10,0.82)";
    ctx.fillRect(0, 0, W, H);

    // District cells (tinted blocks + tiny labels).
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const d of this._mmDistricts) {
      const a = this._mmProject(d.minX, d.maxZ); // top-left
      const x0 = a.x, y0 = a.y;
      const b = this._mmProject(d.maxX, d.minZ); // bottom-right
      const w = b.x - x0, h = b.y - y0;
      ctx.fillStyle = d.tint;
      ctx.fillRect(x0, y0, w, h);
      if (w > 22 && h > 14) {
        ctx.fillStyle = "rgba(246,239,224,0.35)";
        ctx.font = "9px system-ui, sans-serif";
        ctx.fillText(d.label, x0 + w / 2, y0 + h / 2);
      }
    }

    // Roads: avenues (vertical) + cross-streets (horizontal).
    ctx.strokeStyle = "rgba(255,234,200,0.34)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const w = this._mmWorld;
    for (const ax of this._mmAvenues) {
      const t = this._mmProject(ax, w.maxZ);
      const bt = this._mmProject(ax, 13);
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(bt.x, bt.y);
    }
    for (const sz of this._mmStreets) {
      const l = this._mmProject(w.minX, sz);
      const r = this._mmProject(w.maxX, sz);
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(r.x, r.y);
    }
    ctx.stroke();

    // Cafe marker near z~0..11 (south edge of the city, by the spawn).
    const cafe = this._mmProject(0, 5);
    ctx.fillStyle = "rgba(224,162,58,0.9)";
    ctx.beginPath();
    ctx.arc(cafe.x, cafe.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(246,239,224,0.7)";
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillText("☕", cafe.x, cafe.y - 8);

    // The car (if it exists) as a dot — brighter while being driven.
    if (car) {
      const c = this._mmProject(car.x, car.z);
      ctx.fillStyle = car.active ? "#ff5a45" : "rgba(210,59,52,0.65)";
      ctx.beginPath();
      ctx.arc(c.x, c.y, car.active ? 3.6 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Remote players as small dots.
    if (remotes && remotes.length) {
      ctx.fillStyle = "#7fd1ff";
      for (const r of remotes) {
        const p = this._mmProject(r.x, r.z);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The local player as an arrow (position + facing). facing convention is the
    // same as the world's: forward = (sin f, cos f). +z is up on the map, so the
    // canvas heading is measured from "up" and clamped to the projected frame.
    if (local) {
      const p = this._mmProject(local.x, local.z);
      const px = Math.max(this._mmInset, Math.min(W - this._mmInset, p.x));
      const py = Math.max(this._mmInset, Math.min(H - this._mmInset, p.y));
      // World forward (sin f, cos f) → canvas (dx = sin f, dy = -cos f because +z is up).
      const f = local.facing || 0;
      const dx = Math.sin(f);
      const dy = -Math.cos(f);
      const ang = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang + Math.PI / 2); // arrow tip drawn pointing up at angle 0
      ctx.fillStyle = "#ffe08a";
      ctx.strokeStyle = "rgba(40,26,16,0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- Driving HUD ---------------------------------------------------------
  // Show the speedometer + drive hint while driving (mode "drive"); hide it
  // otherwise. `speed` is the car's signed m/s; we show absolute km/h.
  setDriveHud(active, speed = 0) {
    if (!this.driveHud) return;
    this.driveHud.classList.toggle("hidden", !active);
    if (!active) return;
    const kmh = Math.round(Math.abs(speed) * 3.6);
    const txt = String(kmh);
    if (this.speedoNum.textContent !== txt) this.speedoNum.textContent = txt;
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
