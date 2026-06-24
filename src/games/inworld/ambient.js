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

    if (this.network) this.network.on("ambient", (m) => this._onAmbient(m));
  }

  // The table InWorldBoard owns (seated play / spectating / menu) must NOT also
  // get an ambient mirror — that client already renders it. A null gameId/pub
  // payload (reset/cleared/no game) also has nothing to show.
  _shouldSkip(tableId) {
    return tableId === this.getActiveTableId();
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
      entry = { gameId, board: null, loading: true, pendingState: m.pub ?? null };
      this._mounts.set(tableId, entry);
      this._load(tableId, gameId, meta);
      return;
    }

    // Mount exists (or is loading). Feed the latest public snapshot.
    if (entry.loading) {
      // Buffer the freshest snapshot; _load replays it once the module resolves.
      entry.pendingState = m.pub ?? null;
      return;
    }
    if (entry.board) entry.board.applyState(m.pub ?? null);
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
    if (typeof tableId === "string") this._remove(tableId);
  }

  // Drop everything (e.g. on socket close — the boards are stale and main.js
  // unmounts the owned one too). New ambient snapshots re-mount on reconnect.
  clear() {
    for (const tableId of [...this._mounts.keys()]) this._remove(tableId);
  }

  // Pump real-time ambient sims (pong/tron/ludo run their own animation off the
  // shared snapshot). Driven from the main frame loop.
  update(dt) {
    for (const entry of this._mounts.values()) {
      if (entry.board) entry.board.update(dt);
    }
  }
}
