// InWorldBoard — the single unified in-world game engine host.
//
// Replaces the iframe Arcade stage. It mounts exactly ONE game module at a time
// onto the real café table mesh, curries a per-room `net` to the module, routes
// canvas pointer clicks to the module as resolved board cells, applies relayed
// moves / authoritative snapshots / resets, gates input by role+turn, and pumps a
// per-frame update(dt) into modules that drive a real-time sim (pong/tron/ludo).
//
// The module contract (createGame(ctx) → GameInstance) is documented in
// ./createGame.js. The server relay protocol is host-authoritative trust-the-
// client: the host pushes net.sendState(full,pub) after every committed move; the
// server caches it and replays to late guests/spectators (catch-up). Hidden-info
// games (battleship/memory) never let `full` reach spectators — the server gates
// via PUBLIC_RELAY and the module's publicState() excludes private data.

import * as THREE from "three";
import { TABLE_SURFACE_Y, orientFor, hitToCell, GameDesync } from "./createGame.js";

// Move-vs-orbit disambiguation: a pointerdown→up that moves less than this many
// pixels is a board "click"; more is a camera-orbit drag (controls.js keeps it).
const CLICK_SLOP = 6;

export class InWorldBoard {
  // deps: { scene, camera, getCanvas, controls, network, tables, getLocal, getGameMeta }
  //   tables   : Map(tableId -> THREE.Group) from buildCoffeeshop
  //   getLocal : () => the LocalPlayer (for seated/seat checks)
  //   getGameMeta(gameId) : registry entry { capacity, hiddenInfo, load, ... }
  constructor(deps) {
    this.scene = deps.scene;
    this.camera = deps.camera;
    this.getCanvas = deps.getCanvas;
    this.controls = deps.controls;
    this.network = deps.network;
    this.tables = deps.tables;
    this.getLocal = deps.getLocal || (() => null);
    this.getGameMeta = deps.getGameMeta || (() => null);
    this.onStatus = deps.onStatus || (() => {});

    // The single active mount, or null.
    this.active = null; // { instance, group, table, tableId, gameId, roomId, role, seatRy, over, lastFull, lastPub, hidden }

    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._downX = 0;
    this._downY = 0;
    this._downBtn = -1;
    this._listening = false;

    this._onDown = this._onPointerDown.bind(this);
    this._onUp = this._onPointerUp.bind(this);
    this._onMoveHover = this._onPointerMove.bind(this);
    this._onLeave = this._onPointerLeave.bind(this);
    this._hoverAt = 0; // last hover raycast time (throttle)

    // The most-recent inbound game-state buffered while no mount is active yet.
    // mount() is async (it `await`s a dynamic import); the server's catch-up
    // snapshot is a separate macrotask that can land BEFORE the import resolves,
    // when this.active is still null. We stash it here and replay it at the end
    // of mount() so the late joiner converges instead of painting an empty board.
    this._pending = null;

    this._wireNetwork();
  }

  get open() {
    return this.active != null;
  }

  // Seated board-view camera hook.
  //
  // Returns a small descriptor the frame loop (main.js) uses to ease the camera
  // into a comfortable over-the-table framing whenever the LOCAL player is
  // actively seated at THIS mount (host or guest physically on a chair at the
  // table). Spectators — and any state where the local player isn't on the
  // table's seat — return { active:false } so the normal follow-cam stays.
  //
  // Shape: {
  //   active : boolean,            // local player seated here AND a board/menu mounted
  //   center : { x, y, z },        // board centre in WORLD space (table XZ, surface Y)
  //   seatRy : number|null,        // local seat ry; orients near edge to screen bottom
  //   tableId: string,
  // }
  //
  // The flip-book menu (built next) reuses the exact same hook: while the menu
  // is the active mount for a seated host/guest, getSeatedView() already reports
  // active:true with the table centre, so the camera frames the menu too — no
  // extra wiring needed. A menu-only mount can call this by parenting its group
  // to the table like a board, or main.js can synthesize the same descriptor
  // from the seat + table directly (see notesForFixers).
  getSeatedView() {
    const a = this.active;
    if (!a || !a.table) return { active: false };
    if (!this._isLocalSeatedHere(a)) return { active: false };
    const p = a.table.position; // table group world position (table is parented to world)
    return {
      active: true,
      center: { x: p.x, y: TABLE_SURFACE_Y, z: p.z },
      seatRy: a.seatRy,
      tableId: a.tableId,
    };
  }

  // True only when the local player is physically seated on a chair belonging to
  // this mount's table AND holds a playing role (host/guest). Spectators never
  // qualify — they orbit from wherever they stand.
  _isLocalSeatedHere(a) {
    if (!a || a.role === "spectator") return false;
    const local = this.getLocal();
    return !!(local && local.sitting && local.seat && local.seat.table === a.tableId);
  }

  // Orientation policy. A FLAT board (default) is rotated by orientFor(seatRy) so
  // its canonical near edge meets the local viewer. An UPRIGHT cabinet (connect4)
  // is ALSO rotated by orientFor(seatRy) — that turns the whole standing cabinet
  // so its readable faceplate faces the LOCAL seat from whichever chair (each
  // client renders with its own seatRy, so the opposite-seated player sees the
  // faceplate, not the back). A module that orients ITSELF (does its own per-seat
  // facing internally via setSeatRy) declares `orientPolicy: "self"` so the host
  // does NOT also rotate the group and the two don't fight (which is exactly the
  // bug that showed the cabinet's back to the opposite seat). hitToCell still
  // resolves through group.worldToLocal, so the column mapping follows whatever
  // rotation is applied here.
  _orient(a) {
    if (!a || !a.group) return;
    const policy = a.instance && a.instance.orientPolicy;
    if (policy === "self") return; // module owns its own facing; don't double-rotate
    a.group.rotation.y = orientFor(a.seatRy);
  }

  // Tabletop local-Y for parenting a board to the table group. The board is added
  // as a CHILD of `table`, so the right anchor is the tabletop's height *within
  // the table's own local frame* — which makeTable() authors at TABLE_SURFACE_Y
  // (the top cylinder sits at local y=0.77). The board's local frame IS the
  // table's frame, so the parent's world position/scale is irrelevant.
  //
  // The previous `TABLE_SURFACE_Y - table.position.y` formula leaked the parent's
  // world position into a CHILD offset; it only happened to work because every
  // café table is placed at y=0. The instant a table sits under any ancestor
  // transform (a tilted/raised room group) that subtraction is wrong. Deriving
  // the surface directly from the tabletop mesh's local Y is transform-robust.
  _tabletopLocalY(table) {
    // Prefer the actual tabletop mesh's local Y (top face = mesh.position.y +
    // half its height), so the anchor tracks the geometry even if it's re-authored.
    let best = null;
    try {
      for (const child of table.children || []) {
        const g = child.geometry;
        const p = g && g.parameters;
        // The round tabletop is the wide, thin cylinder near the top of the post.
        if (p && p.radiusTop != null && p.height != null && p.radiusTop >= 0.4) {
          const topY = child.position.y + p.height / 2;
          if (best == null || topY > best) best = topY;
        }
      }
    } catch {
      /* fall through */
    }
    if (Number.isFinite(best)) return best;
    // Fallback: the authored constant (board is a child of the table group, so the
    // surface's local Y is just TABLE_SURFACE_Y — no parent term).
    return TABLE_SURFACE_Y;
  }

  // ---- network inbound -----------------------------------------------------
  _wireNetwork() {
    const n = this.network;
    if (!n) return;
    n.on("game-move", (m) => this._onMove(m));
    n.on("game-state", (m) => this._onState(m));
    n.on("game-reset", (m) => this._onReset(m));
  }

  _sameTable(m) {
    return this.active && m && m.table === this.active.tableId;
  }

  _onMove(m) {
    const a = this.active;
    if (!this._sameTable(m) || !a) return;
    // Per-seat identity of the mover. 2-player modules can keep reading the 2nd
    // arg as `byRole`; multi-seat modules (ludo) read the 3rd arg `by` to learn
    // WHICH seat moved (by.seatIndex) and enforce whose turn it is. by.seatIndex
    // is the server-stamped m.bySeat. The host is the ONLY role whose seat is
    // unambiguous without a stamp (host is always seat 0), so we may infer that.
    //
    // We must NOT guess a seat for a guest: guests sit at order 1,2,3 and stamping
    // every guest as seat 1 collapses 3-4 player turn identity (e.g. ludo's yellow
    // at seat 2 / blue at seat 3 would report seat 1, fail the turn gate, and spin
    // a resync loop with no way to advance). When m.bySeat is absent for a guest,
    // leave seatIndex null — multi-seat modules treat null as "cannot verify" and
    // the server is expected to stamp m.bySeat for relayed guest moves.
    if (!Number.isInteger(m.bySeat) && m.byRole === "guest") {
      // A relayed guest move without a server seat stamp cannot be verified by
      // seat. Log so a non-stamping server is caught rather than silently guessed.
      try {
        console.warn("[InWorldBoard] relayed guest move missing m.bySeat; seat identity unverifiable");
      } catch {
        /* ignore */
      }
    }
    const by = {
      role: m.byRole ?? null,
      seatIndex: Number.isInteger(m.bySeat)
        ? m.bySeat
        : (m.byRole === "host" ? 0 : null),
      id: m.byId ?? null,
    };
    try {
      const ok = a.instance.applyMove?.(m.move, m.byRole, by);
      if (ok === false) this._requestResync();
    } catch (err) {
      if (err instanceof GameDesync) this._requestResync();
      else throw err;
    }
  }

  _onState(m) {
    const a = this.active;
    // Mount is async; a catch-up snapshot can arrive before the module finishes
    // loading (this.active still null). Buffer the newest one so mount() can
    // replay it; otherwise the snapshot is silently dropped and the joiner never
    // converges (the classic async-mount race).
    if (!a) {
      if (m && (m.full != null || m.pub != null)) this._pending = m;
      return;
    }
    if (!this._sameTable(m)) return;
    // Guests get `full`; spectators get `pub`. A host echo is ignored (host is
    // already authoritative locally).
    if (a.role === "host") return;
    const state = m.full != null ? m.full : m.pub;
    if (state == null) return;
    try {
      a.instance.applyState?.(state);
    } catch {
      /* a bad snapshot must not crash the loop */
    }
  }

  _onReset(m) {
    const a = this.active;
    if (!this._sameTable(m) || !a) return;
    a.over = false;
    a.lastFull = a.lastPub = null;
    try {
      a.instance.applyState?.(null);
    } catch {
      /* ignore */
    }
  }

  // A guest/spectator whose applyMove failed asks the server for an authoritative
  // re-push; the host (which is authoritative locally) re-broadcasts its cached
  // full. Without the explicit request a desynced guest had no recovery channel —
  // it would fail to apply every subsequent relayed move and the match would stall
  // when play reached its turn.
  _requestResync() {
    const a = this.active;
    if (!a) return;
    if (a.role === "host") {
      if (a.lastFull) {
        try {
          this.network?.sendGameState?.(a.lastFull, a.lastPub ?? a.lastFull);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    // Guest/spectator: ask the server to re-send the cached authoritative state.
    try {
      this.network?.requestState?.();
    } catch {
      /* ignore */
    }
  }

  // ---- mount / unmount -----------------------------------------------------
  // opts: { gameId, tableId, roomId, role, seatRy, seatIndex, seatCount,
  //         createGame, ctxExtra }
  //   createGame : optional factory override (skips registry load) — used by the
  //                in-world flip-book menu, which has no registry entry.
  //   ctxExtra   : optional plain object merged into the module's ctx. The menu
  //                receives its picker callbacks here (onPick, games) without
  //                widening the standard game ctx for every module.
  async mount(opts) {
    this.unmount();
    const table = this.tables?.get(opts.tableId);
    if (!table) return false;

    let createGame = opts.createGame;
    if (!createGame) {
      const meta = this.getGameMeta(opts.gameId);
      if (!meta || !meta.load) return false;
      try {
        const mod = await meta.load();
        createGame = mod.createGame || mod.default;
      } catch {
        return false;
      }
    }
    if (typeof createGame !== "function") return false;

    const meta = this.getGameMeta(opts.gameId) || {};
    const hidden = !!meta.hiddenInfo;
    const anchorY = this._tabletopLocalY(table);
    const role = opts.role || "spectator";
    const seatRy = role === "spectator" ? null : opts.seatRy ?? null;

    const a = {
      instance: null,
      group: null,
      table,
      tableId: opts.tableId,
      gameId: opts.gameId,
      roomId: opts.roomId,
      role,
      seatRy,
      seatIndex: opts.seatIndex ?? (role === "host" ? 0 : null),
      seatCount: opts.seatCount ?? (meta.capacity ?? 2),
      over: false,
      lastFull: null,
      lastPub: null,
      hidden,
      anchorY,
      ctxExtra: opts.ctxExtra || null,
    };

    const ctx = this._makeCtx(a);
    let instance;
    try {
      instance = createGame(ctx);
    } catch {
      return false;
    }
    if (!instance || !instance.group) return false;

    a.instance = instance;
    a.group = instance.group;
    instance.group.position.y = anchorY;
    table.add(instance.group);
    this._orient(a);

    this.active = a;
    this._enablePointer(role !== "spectator");

    // Spectators subscribe to the proximity/seat watch stream; the server replays
    // the cached pub (and re-replays on this mount-time watch even if we're already
    // in its spectator set). Seated guests get their catch-up `full` from the
    // assignSeat replay.
    if (role === "spectator") {
      try {
        this.network?.watchTable?.(opts.tableId);
      } catch {
        /* ignore */
      }
    }

    // Converge a late/mid-join: first replay any snapshot that arrived during the
    // async load (buffered in _onState), then request a fresh authoritative state
    // in case the catch-up snapshot was already consumed or never sent. Both are
    // idempotent — applyState rebuilds from scratch.
    if (role !== "host") {
      if (this._pending && this._pending.table === opts.tableId) {
        const buffered = this._pending;
        this._pending = null;
        this._onState(buffered);
      } else {
        this._pending = null;
      }
      try {
        this.network?.requestState?.();
      } catch {
        /* ignore */
      }
    } else {
      this._pending = null;
    }
    return true;
  }

  unmount() {
    const a = this.active;
    if (!a) return;
    this._enablePointer(false);
    if (a.role === "spectator") {
      try {
        this.network?.unwatchTable?.(a.tableId);
      } catch {
        /* ignore */
      }
    }
    try {
      a.instance?.dispose?.();
    } catch {
      /* ignore */
    }
    if (a.group && a.group.parent) a.group.parent.remove(a.group);
    this.active = null;
  }

  // Build the curried ctx the module receives. `net` never exposes roomId/socket.
  _makeCtx(a) {
    const self = this;
    const net = {
      sendMove(move) {
        try {
          self.network?.sendMove?.(move);
        } catch {
          /* ignore */
        }
      },
      // Host-only authoritative snapshot. Cache for resync replay; the framework
      // no-ops it for guests/spectators (they never send authoritative state).
      sendState(full, pub) {
        if (a.role !== "host") return;
        a.lastFull = full;
        a.lastPub = pub == null ? full : pub;
        try {
          self.network?.sendGameState?.(full, a.lastPub);
        } catch {
          /* ignore */
        }
      },
      // Hidden-info delta: only the public payload changes. Cache pub, re-send the
      // last full to seated members (unchanged) and the new pub to spectators.
      sendPublic(pub) {
        if (a.role !== "host") return;
        a.lastPub = pub;
        try {
          self.network?.sendGameState?.(a.lastFull ?? pub, pub);
        } catch {
          /* ignore */
        }
      },
      // Real-time guest steering (pong paddle, tron turn). Goes ONLY to the host;
      // never cached, never relayed to spectators.
      sendInput(input) {
        try {
          self.network?.sendGameInput?.(input);
        } catch {
          /* ignore */
        }
      },
    };

    return {
      THREE,
      table: a.table,
      anchorY: a.anchorY,
      role: a.role,
      seatRy: a.seatRy,
      seatIndex: a.seatIndex,
      seatCount: a.seatCount,
      net,
      isLocalTurnAllowed: () => this._turnAllowed(a),
      onGameOver: (result) => {
        a.over = true;
        try {
          this.onStatus(this._overText(a, result));
        } catch {
          /* ignore */
        }
      },
      // Extra non-game context (e.g. the flip-book menu's onPick / games). Merged
      // last so a mount can inject picker callbacks without changing the shared
      // game ctx shape. Never set for a normal registry game.
      ...(a.ctxExtra || {}),
    };
  }

  _turnAllowed(a) {
    if (!a || a.role === "spectator" || a.over) return false;
    return this._isSeatedHere(a);
  }

  _isSeatedHere(a) {
    const local = this.getLocal();
    if (a.role === "host" || a.role === "guest") {
      return !!(local && local.sitting && local.seat && local.seat.table === a.tableId);
    }
    return true; // spectator path (input already gated off elsewhere)
  }

  // ---- per-frame pump (real-time sims) -------------------------------------
  update(dt) {
    const a = this.active;
    if (!a || !a.instance) return;
    if (typeof a.instance.update === "function") {
      try {
        a.instance.update(dt);
      } catch {
        /* a module sim error must not kill the render loop */
      }
    }
  }

  // ---- inbound game-input (host receives guest steering) -------------------
  onGameInput(m) {
    const a = this.active;
    if (!this._sameTable(m) || !a || a.role !== "host") return;
    try {
      a.instance.onInput?.(m.input, m.byRole);
    } catch {
      /* ignore */
    }
  }

  // ---- role / seat changes (in-place promotion) ----------------------------
  setRole(role, seatRy, seatIndex) {
    const a = this.active;
    if (!a) return;
    a.role = role;
    if (seatRy !== undefined) a.seatRy = role === "spectator" ? null : seatRy;
    if (seatIndex !== undefined) a.seatIndex = seatIndex;
    try {
      a.instance.setRole?.(role, a.seatIndex);
      a.instance.setSeatRy?.(a.seatRy);
    } catch {
      /* ignore */
    }
    this._orient(a);
    this._enablePointer(role !== "spectator");
  }

  // ---- pointer routing -----------------------------------------------------
  _enablePointer(on) {
    const canvas = this.getCanvas?.();
    if (!canvas) return;
    if (on && !this._listening) {
      canvas.addEventListener("pointerdown", this._onDown, true);
      canvas.addEventListener("pointerup", this._onUp, true);
      // Non-capturing hover routing (for modules that expose setHover, e.g.
      // connect4's launcher preview). Capture-phase down/up keep orbit-vs-click
      // disambiguation; hover is best-effort and never consumes the event.
      canvas.addEventListener("pointermove", this._onMoveHover);
      canvas.addEventListener("pointerleave", this._onLeave);
      this._listening = true;
    } else if (!on && this._listening) {
      canvas.removeEventListener("pointerdown", this._onDown, true);
      canvas.removeEventListener("pointerup", this._onUp, true);
      canvas.removeEventListener("pointermove", this._onMoveHover);
      canvas.removeEventListener("pointerleave", this._onLeave);
      this._listening = false;
      const a = this.active;
      try { a?.instance?.setHover?.(-1); } catch { /* ignore */ }
    }
  }

  _onPointerDown(ev) {
    if (ev.button === 2) return;
    this._downX = ev.clientX;
    this._downY = ev.clientY;
    this._downBtn = ev.button;
  }

  _onPointerUp(ev) {
    const a = this.active;
    if (!a || this._downBtn !== 0 || ev.button !== 0) return;
    const moved = Math.hypot(ev.clientX - this._downX, ev.clientY - this._downY);
    if (moved > CLICK_SLOP) return; // a drag → leave it to orbit
    if (!this._turnAllowed(a)) return;
    // NOTE: do NOT stopPropagation here. controls.js clears its orbit-drag state
    // on a window-level pointerup (bubble phase); swallowing the event in this
    // capture-phase handler left `dragging` stuck true, so after clicking a piece
    // or menu button the camera spun with every mouse move. Let the up bubble.
    this.handlePointer(ev);
  }

  // Hover routing for modules that expose setHover (e.g. connect4's launcher
  // preview). Throttled (~30Hz), non-consuming, and gated by _turnAllowed so a
  // spectator / off-turn player never sees the affordance. We raycast the board
  // and hand the resolved cell to the module; on a miss (or no turn) we clear.
  _onPointerMove(ev) {
    const a = this.active;
    if (!a || !a.group) return;
    if (typeof a.instance?.setHover !== "function") return;
    const now = performance.now ? performance.now() : Date.now();
    if (now - this._hoverAt < 33) return;
    this._hoverAt = now;
    if (!this._turnAllowed(a)) {
      try { a.instance.setHover(-1); } catch { /* ignore */ }
      return;
    }
    const cell = this._raycastCell(a, ev.clientX, ev.clientY);
    try {
      // connect4 wants a column; cells expose {c}. Fall back to -1 on a miss.
      a.instance.setHover(cell ? (cell.c ?? cell) : -1);
    } catch {
      /* ignore */
    }
  }

  _onPointerLeave() {
    const a = this.active;
    try { a?.instance?.setHover?.(-1); } catch { /* ignore */ }
  }

  // Raycast a screen coordinate onto the active board and resolve a cell, or null.
  _raycastCell(a, cx, cy) {
    const canvas = this.getCanvas?.();
    if (!canvas || cx == null || cy == null) return null;
    const rect = canvas.getBoundingClientRect();
    this._ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    this._ray.setFromCamera(this._ndc, this.camera);
    const hits = this._ray.intersectObject(a.group, true);
    if (!hits.length) return null;
    return this._resolveCell(a, hits[0]);
  }

  // Resolve a pointer event to a board cell and dispatch to the module. Returns
  // true if a hit on the board was consumed.
  handlePointer(ev) {
    const a = this.active;
    if (!a || !a.group) return false;
    const canvas = this.getCanvas?.();
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const cx = ev.clientX ?? (ev.touches && ev.touches[0]?.clientX);
    const cy = ev.clientY ?? (ev.touches && ev.touches[0]?.clientY);
    if (cx == null || cy == null) return false;
    this._ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    this._ray.setFromCamera(this._ndc, this.camera);
    const hits = this._ray.intersectObject(a.group, true);
    if (!hits.length) return false;
    const hit = hits[0];
    const cell = this._resolveCell(a, hit);
    try {
      a.instance.onPointer?.({ cell, point: hit.point, object: hit.object });
    } catch {
      /* ignore */
    }
    return true;
  }

  // 3-tier resolver: module hitToCell > userData.cell ancestor walk > geometric.
  _resolveCell(a, hit) {
    if (typeof a.instance.hitToCell === "function") {
      const c = a.instance.hitToCell(hit);
      if (c) return c;
    }
    let o = hit.object;
    while (o) {
      if (o.userData && o.userData.cell) return o.userData.cell;
      o = o.parent;
    }
    // Grid size for the geometric fallback: prefer the instance, then the group's
    // userData (reversi/gomoku publish gridN there), default 8. Using 8 for a 15×15
    // gomoku board would map a click on bare wood to a wrong intersection.
    const n = a.instance.gridN || a.group?.userData?.gridN || 8;
    return hitToCell(a.group, hit.point, n);
  }

  _overText(a, result) {
    if (!result) return "Game over.";
    if (result.winner == null) return "It's a draw.";
    return `Winner: ${result.winner}.`;
  }
}
