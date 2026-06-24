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

  join(name, color) {
    this._join = { name, color };
    this._send({ type: "join", name, color });
  }

  sendState(x, z, ry, moving, sitting = false, seatY = 0) {
    this._send({ type: "state", x, z, ry, moving, sitting, seatY });
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
