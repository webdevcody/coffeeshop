// PASSERSBY — ambient read-only board mirroring.
//
// Beyond the player physically seated at a table and the InWorldBoard's single
// active spectator mount, the café shows a LIVE, READ-ONLY mirror of EVERY other
// active match on its table, so a player walking past sees the games in progress
// across the room — not bare tables. This is the "passersby" view.
//
// The server fans a low-rate PUBLIC ambient snapshot ({ table, gameId, pub }) to
// the whole room on every game-state change and replays the full set to each
// newcomer on join (see server.js). This manager listens for those, and for every
// active table the LOCAL player is NOT seated/spectating at, mounts a read-only
// board (createGame with role "spectator", seatRy null, no pointer routing, no
// outbound net) parented to that table and feeds it applyState from the broadcast.
// It unmounts on game-end / empty / when the local player sits at that table.
//
// HIDDEN-INFO SAFETY: the payload only ever carries `pub`, which the server emits
// for every game (hidden-info modules exclude ship layouts / face-down cards from
// publicState()). A passerby therefore renders the same public-only board a
// proximity spectator would — never a private layout. The gate is structural.
//
// We deliberately do NOT mirror the table the local player is seated/spectating
// at: InWorldBoard already owns that table's mount (with full/guest state and, for
// spectators, the proximity pub). Double-mounting would z-fight two boards on one
// table and waste a module instance. ambient.js skips it via shouldSkip().

import { mountAmbientBoard } from "./board.js";

// How long (ms) a freshly-claimed table stays suppressed after the local player
// sits, bridging the gap until InWorldBoard.mount() (async — it awaits a dynamic
// import) finally sets activeTableId. A safety backstop only: the claim is dropped
// the instant getActiveTableId() reports the table, so this just covers the race +
// the rare aborted mount. Far longer than any import; short enough that a passerby
// mirror reappears promptly after the player walks away.
const AMBIENT_CLAIM_MS = 5000;

export class AmbientBoards {
  // deps: {
  //   network,                       // the Network (we subscribe to "ambient")
  //   tables,                        // Map(tableId -> THREE.Group)
  //   getGameMeta(gameId),           // registry entry { capacity, load, spectatable, ... }
  //   getActiveTableId(): string|null  // the table InWorldBoard currently owns (skip it)
  // }
  constructor(deps) {
    this.network = deps.network;
    this.tables = deps.tables;
    this.getGameMeta = deps.getGameMeta || (() => null);
    this.getActiveTableId = deps.getActiveTableId || (() => null);

    // tableId -> {
    //   gameId, board|null, loading(bool), pendingState (buffered while loading),
    //   pendingClear(bool)
    // }
    this._mounts = new Map();
    // tableId -> expiry timestamp (ms). A table the local player just sat at is
    // "claimed" so a stray ambient snapshot can't re-mount a z-fighting mirror
    // during the async-mount window (see releaseTable / _shouldSkip).
    this._claimed = new Map();

    if (this.network) this.network.on("ambient", (m) => this._onAmbient(m));
  }

  _now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  // The table InWorldBoard owns (seated play / spectating / menu) must NOT also
  // get an ambient mirror — that client already renders it. A null gameId/pub
  // payload (reset/cleared/no game) also has nothing to show.
  _shouldSkip(tableId) {
    // The seated mount has caught up — the claim is now redundant (drop it so a
    // later walk-away lets the passerby mirror return).
    if (tableId === this.getActiveTableId()) {
      this._claimed.delete(tableId);
      return true;
    }
    // Still inside the async-mount window after a sit: suppress until it resolves
    // (or the claim expires, covering a rare aborted mount).
    const exp = this._claimed.get(tableId);
    if (exp != null) {
      if (this._now() < exp) return true;
      this._claimed.delete(tableId);
    }
    return false;
  }

  // ---- inbound ambient snapshot -------------------------------------------
  // m: { table, gameId, pub }. gameId null → no active match (unmount). pub null
  // → match active but board empty (fresh / just reset); keep the mount but feed
  // null so the module clears.
  _onAmbient(m) {
    if (!m || typeof m.table !== "string") return;
    const tableId = m.table;
    const gameId = m.gameId || null;

    // No active match for this table → tear any mirror down.
    if (!gameId) {
      this._remove(tableId);
      return;
    }

    // The local client already renders this table (seated/spectating/menu).
    // Drop any ambient mirror we might have had and ignore until it's released.
    if (this._shouldSkip(tableId)) {
      this._remove(tableId);
      return;
    }

    // Non-spectatable games opt out of being watched at all — including ambient.
    const meta = this.getGameMeta(gameId) || {};
    if (meta.spectatable === false || !meta.load) {
      this._remove(tableId);
      return;
    }

    let entry = this._mounts.get(tableId);

    // A different game took over this table (match ended + new match): rebuild.
    if (entry && entry.gameId !== gameId) {
      this._remove(tableId);
      entry = null;
    }

    if (!entry) {
      entry = { gameId, board: null, loading: true, pendingState: m.pub ?? null, pendingReveal: m.reveals ?? null };
      this._mounts.set(tableId, entry);
      this._load(tableId, gameId, meta);
      return;
    }

    // Mount exists (or is loading). Feed the latest public snapshot + reveal.
    if (entry.loading) {
      // Buffer the freshest snapshot/reveal; _load replays them once it resolves.
      entry.pendingState = m.pub ?? null;
      if (m.reveals != null) entry.pendingReveal = m.reveals;
      return;
    }
    if (entry.board) {
      entry.board.applyState(m.pub ?? null);
      // SPECTATOR-ONLY REVEAL: feed the merged fleet/deck reveal so the passerby
      // mirror renders the FULL board (both battleship fleets / real memory faces).
      // The ambient broadcast carries `reveals` only for hidden-info games; it stays
      // null otherwise. Apply only when present so a public game is untouched.
      if (m.reveals != null) entry.board.applyReveal(m.reveals);
    }
  }

  async _load(tableId, gameId, meta) {
    let createGame = null;
    try {
      const mod = await meta.load();
      createGame = mod.createGame || mod.default;
    } catch {
      this._mounts.delete(tableId);
      return;
    }
    const entry = this._mounts.get(tableId);
    // The match (or our interest in it) may have ended while the module loaded,
    // or the local player may have just sat at this table. Bail without mounting.
    if (!entry || entry.gameId !== gameId) return;
    if (this._shouldSkip(tableId)) {
      this._mounts.delete(tableId);
      return;
    }
    const table = this.tables?.get(tableId);
    if (typeof createGame !== "function" || !table) {
      this._mounts.delete(tableId);
      return;
    }

    const board = mountAmbientBoard({
      createGame,
      table,
      gameId,
      seatCount: meta.capacity ?? 2,
    });
    if (!board) {
      this._mounts.delete(tableId);
      return;
    }
    entry.board = board;
    entry.loading = false;
    // Replay the latest snapshot buffered while loading so we converge on the
    // live position immediately (the classic async-mount race, same as board.js).
    if (entry.pendingState !== undefined) {
      board.applyState(entry.pendingState ?? null);
      entry.pendingState = undefined;
    }
    // SPECTATOR-ONLY REVEAL: replay any reveal buffered during load so the passerby
    // paints the full hidden-info board immediately (both battleship fleets / the
    // real memory faces). Null for public games — nothing applied.
    if (entry.pendingReveal != null) {
      board.applyReveal(entry.pendingReveal);
      entry.pendingReveal = null;
    }
  }

  // Tear down a single table's ambient mirror.
  _remove(tableId) {
    const entry = this._mounts.get(tableId);
    if (!entry) return;
    this._mounts.delete(tableId);
    if (entry.board) {
      try {
        entry.board.dispose();
      } catch {
        /* ignore */
      }
    }
  }

  // Called by main.js whenever the LOCAL player's active table changes (sat at /
  // stood up from a table). The table the player now owns must shed its ambient
  // mirror; a table the player just LEFT will re-mount on the next ambient
  // snapshot (host keeps pushing state), so nothing to do for that case here.
  syncActiveTable() {
    const owned = this.getActiveTableId();
    if (owned && this._mounts.has(owned)) this._remove(owned);
  }

  // Synchronously shed the ambient mirror for a SPECIFIC table by id, regardless
  // of what getActiveTableId() reports right now. InWorldBoard.mount() is async
  // (it awaits a dynamic module import before setting its active table), so at the
  // moment main.js asks us to release a table the player just sat at,
  // getActiveTableId() may still report the PREVIOUS table — syncActiveTable()
  // would then miss the just-sat-at table and leave its ambient mirror parented,
  // z-fighting the incoming InWorldBoard mount until the next host broadcast. The
  // target tableId is already known at call time, so release it directly here and
  // do not wait for mount() to resolve. A late ambient snapshot for this table is
  // re-skipped via _shouldSkip() once mount() finishes setting activeTableId.
  releaseTable(tableId) {
    if (typeof tableId !== "string") return;
    // Claim the table through the async-mount gap so a stray ambient snapshot that
    // arrives before activeTableId catches up can't re-mount a mirror that z-fights
    // the incoming seated board (double fleet placards + a flickering hover ghost).
    this._claimed.set(tableId, this._now() + AMBIENT_CLAIM_MS);
    this._remove(tableId);
  }

  // Drop everything (e.g. on socket close — the boards are stale and main.js
  // unmounts the owned one too). New ambient snapshots re-mount on reconnect.
  clear() {
    for (const tableId of [...this._mounts.keys()]) this._remove(tableId);
    this._claimed.clear();
  }

  // Pump real-time ambient sims (pong/tron/ludo run their own animation off the
  // shared snapshot). Driven from the main frame loop.
  update(dt) {
    for (const entry of this._mounts.values()) {
      if (entry.board) entry.board.update(dt);
    }
  }
}
