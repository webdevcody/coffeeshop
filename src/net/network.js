// Thin WebSocket client with an on()/emit() event surface. Reconnects with
// backoff so a dropped connection re-joins automatically.

export class Network {
  constructor(url) {
    this.url = url || defaultUrl();
    this.ws = null;
    this.handlers = new Map();
    this.id = null;
    this._join = null; // remembered join payload for reconnects
    this._retry = 0;
    this._closedByUser = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return this;
  }

  _emit(type, payload) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) fn(payload);
  }

  connect() {
    this._closedByUser = false;
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this._scheduleReconnect();
      return;
    }
    this.ws.addEventListener("open", () => {
      this._retry = 0;
      this._emit("open");
      if (this._join) this._send({ type: "join", ...this._join });
    });
    this.ws.addEventListener("message", (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "welcome") this.id = msg.id;
      this._emit(msg.type, msg);
    });
    this.ws.addEventListener("close", () => {
      this._emit("close");
      if (!this._closedByUser) this._scheduleReconnect();
    });
    this.ws.addEventListener("error", () => {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    });
  }

  _scheduleReconnect() {
    this._retry = Math.min(this._retry + 1, 6);
    const delay = 500 * this._retry;
    setTimeout(() => {
      if (!this._closedByUser) this.connect();
    }, delay);
  }

  // `appearance` is { color, skin, hair }. Remembered so a reconnect re-joins
  // with the same look.
  join(name, appearance = {}) {
    this._join = { name, color: appearance.color, skin: appearance.skin, hair: appearance.hair };
    this._send({ type: "join", ...this._join });
  }

  // Push a live appearance change so other clients restyle this player. Also
  // updates the remembered join payload so a reconnect keeps the new look.
  sendAppearance(appearance = {}) {
    if (this._join) Object.assign(this._join, appearance);
    this._send({ type: "appearance", ...appearance });
  }

  sendState(x, z, ry, moving, sitting = false, seatY = 0, ride = null, held = null, y = 0) {
    this._send({ type: "state", x, z, ry, moving, sitting, seatY, ride, held, y });
  }

  sendChat(text) {
    this._send({ type: "chat", text });
  }

  signal(to, data) {
    this._send({ type: "signal", to, data });
  }

  // Tell the server about your current listening state so it can warn the people
  // you can no longer hear. `muted` is the list of player ids you've muted.
  sendVoiceMute(deafened, muted) {
    this._send({
      type: "voice-mute",
      deafened: !!deafened,
      muted: Array.isArray(muted) ? muted : [],
    });
  }

  // Sit at a table and ask the server for a role. The reply arrives as a
  // "game-assign": the first sitter becomes "host" (and then picks a game via
  // chooseGame); later sitters become "guest" for whatever the host picked.
  requestGame(table) {
    this._send({ type: "sit-game", table });
  }

  // Host picks a game from the table menu. The server records it, mints the
  // room id, and replies (to host and any waiting guest) with a "game-assign"
  // that carries the chosen gameId + roomId.
  chooseGame(table, gameId, capacity = 2) {
    this._send({ type: "choose-game", table, gameId, capacity });
  }

  // Tell the server we left the game (stood up / closed the overlay).
  leaveGame() {
    this._send({ type: "leave-game" });
  }

  // --- In-world game relay (additive) --------------------------------------
  // The server derives the sender's table + role from the connection (trusted),
  // so these never carry a roomId — a client can't spoof another table.

  // A player committed a move. Relayed to the other seated member(s); also to
  // spectators for full-info games (server gates hidden-info via PUBLIC_RELAY).
  sendMove(move) {
    this._send({ type: "game-move", move });
  }

  // HOST-ONLY authoritative snapshot. `full` reaches seated members; `pub`
  // reaches spectators (never `full` for hidden-info games).
  sendGameState(full, pub) {
    this._send({ type: "game-state", full, pub });
  }

  // Real-time guest steering (pong paddle / tron turn). Relayed ONLY to the host.
  sendGameInput(input) {
    this._send({ type: "game-input", input });
  }

  // SPECTATOR-ONLY REVEAL. A seated player publishes their OWN private layout
  // (battleship: their fleet; memory: the host's deck) so watchers can render the
  // FULL board. The server routes it to this table's spectators + ambient passersby
  // ONLY — never to the opposing seated player. Any role may call it; the server
  // decides routing (a spectator/ambient instance's net.sendReveal is a no-op).
  sendReveal(reveal) {
    this._send({ type: "reveal", reveal });
  }

  // Either player hit "new game".
  sendGameReset() {
    this._send({ type: "game-reset" });
  }

  // A non-seated client starts/stops watching a table (proximity spectating).
  watchTable(table) {
    this._send({ type: "watch", table });
  }
  unwatchTable(table) {
    this._send({ type: "unwatch", table });
  }

  // Catch-up / desync recovery: ask the server to (re)send the cached
  // authoritative state for the sender's table. The server answers from its
  // cache — `full` to a seated guest, `pub` to a spectator — so a late or
  // desynced joiner can converge without waiting for the host's next move.
  requestState() {
    this._send({ type: "request-state" });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

function defaultUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}
