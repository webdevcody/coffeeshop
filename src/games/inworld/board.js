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
// 6px was too tight — ordinary clicks carry a few px of jitter (more on a
// trackpad/touch), so legitimate board taps were being swallowed as "drags",
// making cells feel hard to hit. 12px still comfortably distinguishes a real
// orbit drag (which travels much further) while letting honest clicks register.
const CLICK_SLOP = 12;

// Per-game seated-camera zoom-out factor. Most boards fit the default first-person
// framing (1). Battleship's two ocean grids are much larger, so we pull the camera
// FURTHER BACK (and up) for that game ONLY, so the whole board is visible. Connect4
// is an UPRIGHT cabinet whose playable mass stands VERTICAL and level with the eye
// (a flat board lies on the surface below the eye and frames fine at 1) — so it gets
// its own pull-back so the seated eye dollies back+up enough to fit the whole tall
// rack for BOTH seats (the seated path has no host/guest branch). Other games are
// unaffected. localPlayer._updateSeatedCamera reads this via getSeatedView.
const SEATED_CAM_ZOOM = { battleship: 1.7, connect4: 1.5 };

// Per-game vertical lift of the seated framing CENTRE (world metres), added to the
// tabletop surface Y. A FLAT board's pieces sit on the surface, so the default 0 is
// right. An UPRIGHT cabinet (connect4) centres its playable grid well ABOVE the
// surface, so aiming at the bare surface points the gaze at the cabinet's feet and
// looms the grid into the top of the frame. Lift the centre to the grid's mid-height
// so the eye aims at the grid, not the tabletop. Symmetric across seats.
const SEATED_CENTER_LIFT = { connect4: 0.33 };

// Mount "settle-in" animation. A freshly-mounted board group eases up from a
// slightly-shrunk scale to its authored size, so a board (or the flip-book menu)
// appears with a gentle pop instead of snapping into existence. This is a purely
// cosmetic, framework-OWNED transform that multiplies the module's OWN authored
// group scale (battleship sets 0.78; most games leave 1) — it never touches
// materials, opacity, geometry, or any per-mesh transform a module animates, so
// no game is affected beyond the brief grow-in. The base scale is captured once
// at mount and restored exactly when the animation completes, so a module that
// later rescales its group is never fought. MOUNT_IN_FROM is the starting factor
// (90% → a small, unmistakable-but-not-jarring grow), MOUNT_IN_MS the duration.
const MOUNT_IN_FROM = 0.9;
const MOUNT_IN_MS = 260;
// Smoothstep on [0,1] — zero velocity at both ends so the grow-in eases out into
// the settled size with no visible "stop". Pure, allocation-free.
function _smoothstep01(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// Derive the tabletop's local Y for parenting a board to a table group, the same
// way InWorldBoard._tabletopLocalY does — prefer the actual tabletop mesh's top
// face, fall back to the authored constant. Standalone so the ambient passersby
// manager can mount read-only mirrors without an InWorldBoard instance.
export function tabletopLocalY(table) {
  let best = null;
  try {
    for (const child of table.children || []) {
      const g = child.geometry;
      const p = g && g.parameters;
      if (p && p.radiusTop != null && p.height != null && p.radiusTop >= 0.4) {
        const topY = child.position.y + p.height / 2;
        if (best == null || topY > best) best = topY;
      }
    }
  } catch {
    /* fall through */
  }
  if (Number.isFinite(best)) return best;
  return TABLE_SURFACE_Y;
}

// Reusable READ-ONLY board mount for passersby / ambient mirroring.
//
// Creates a game instance in the canonical "spectator" role (seatRy null → fixed
// canonical orientation), parents its group onto `table` at the tabletop surface,
// and returns a tiny handle the caller drives with the PUBLIC snapshots it gets
// from the relay. There is NO pointer routing, NO turn gating, NO outbound net —
// a passerby only ever watches. The module's own publicState()/applyState already
// strips private data, and the server only ever sends `pub` to non-members, so a
// hidden-info layout can never reach this mount.
//
// opts: { createGame, table, gameId, seatCount }
// returns: { group, applyState(state), update(dt), dispose() } or null on failure.
export function mountAmbientBoard(opts) {
  const { createGame, table } = opts || {};
  if (typeof createGame !== "function" || !table) return null;
  const anchorY = tabletopLocalY(table);

  // A no-op relay surface: passersby are pure observers, so nothing they could
  // emit is ever wired through. Keeping the shape lets unmodified game modules
  // build their ctx without special-casing the ambient path.
  const noopNet = {
    sendMove() {},
    sendState() {},
    sendPublic() {},
    sendInput() {},
    // A passerby never owns private layout to publish; the reveal flows the OTHER
    // way (server → applyReveal below). No-op so unmodified modules build their ctx.
    sendReveal() {},
  };

  const ctx = {
    THREE,
    table,
    anchorY,
    role: "spectator",
    seatRy: null,
    seatIndex: null,
    seatCount: opts.seatCount ?? 2,
    net: noopNet,
    isLocalTurnAllowed: () => false,
    onGameOver: () => {},
  };

  let instance;
  try {
    instance = createGame(ctx);
  } catch {
    return null;
  }
  if (!instance || !instance.group) return null;

  instance.group.position.y = anchorY;
  // Spectator orientation is the fixed canonical frame (orientFor(null) === 0).
  // A module that orients itself per-seat (orientPolicy "self") is left alone.
  if (instance.orientPolicy !== "self") instance.group.rotation.y = orientFor(null);
  table.add(instance.group);

  // Gentle grow-in so an ambient mirror pops into view as a passerby walks up,
  // instead of snapping in. Captures the module's OWN authored base scale (one
  // alloc here, never per frame) and eases a multiplier up to it; settles exactly
  // on the authored vector when done. Cosmetic only — same scheme as the seated
  // mount path. mountT is null once the grow-in has completed.
  const baseScale = instance.group.scale.clone();
  let mountT = 0;
  instance.group.scale.set(
    baseScale.x * MOUNT_IN_FROM,
    baseScale.y * MOUNT_IN_FROM,
    baseScale.z * MOUNT_IN_FROM
  );

  return {
    group: instance.group,
    applyState(state) {
      try {
        instance.applyState?.(state);
      } catch {
        /* a bad snapshot must not crash the render loop */
      }
    },
    // SPECTATOR-ONLY REVEAL forwarded to the ambient passerby instance so a passerby
    // renders the FULL board (both battleship fleets / the real memory faces). The
    // ambient mount is always a "spectator" role instance, so applyReveal is safe.
    applyReveal(reveals) {
      try {
        instance.applyReveal?.(reveals);
      } catch {
        /* a bad reveal must not crash the render loop */
      }
    },
    update(dt) {
      // Drive the cosmetic grow-in first so it settles even if the module's own
      // update throws. Guard dt so a bad/huge frame can't overshoot the ease.
      if (mountT != null) {
        const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
        mountT += (step * 1000) / MOUNT_IN_MS;
        if (mountT >= 1) {
          instance.group.scale.copy(baseScale);
          mountT = null; // done — stop touching the group's scale
        } else {
          const f = MOUNT_IN_FROM + (1 - MOUNT_IN_FROM) * _smoothstep01(mountT);
          instance.group.scale.set(baseScale.x * f, baseScale.y * f, baseScale.z * f);
        }
      }
      if (typeof instance.update === "function") {
        try {
          instance.update(dt);
        } catch {
          /* a module sim error must not kill the loop */
        }
      }
    },
    dispose() {
      try {
        instance.dispose?.();
      } catch {
        /* ignore */
      }
      if (instance.group && instance.group.parent) {
        instance.group.parent.remove(instance.group);
      }
    },
  };
}

export class InWorldBoard {
  // How long after a spectator applies a relayed move the framework will swallow a
  // single redundant authoritative snapshot (the host's post-move `pub` echo) so an
  // in-flight move animation isn't snapped away. Comfortably covers the relay round
  // of sendMove→sendState landing back-to-back, while staying short enough that a
  // genuine later snapshot (recovery / next move) is never suppressed.
  static _SPEC_SNAP_WINDOW_MS = 1500;

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

    // SPECTATOR-ONLY REVEAL buffered while no mount is active yet (same async-mount
    // race as _pending): a hidden-info reveal can land before the module import
    // resolves. We stash the newest one and replay it at the end of mount().
    this._pendingReveal = null;

    this._wireNetwork();
  }

  get open() {
    return this.active != null;
  }

  // The table this client currently owns a mount on (seated play / spectating /
  // flip-book menu), or null. The ambient passersby manager reads this to AVOID
  // double-mounting a read-only mirror on the table this client already renders.
  get activeTableId() {
    return this.active ? this.active.tableId : null;
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
    // Derive the framing centre from the table's WORLD transform, not its local
    // position + a hardcoded surface Y. Using a.table.position assumes the table
    // sits directly in world space at a fixed height — the same leak _tabletopLocalY
    // was rewritten to avoid. table.getWorldPosition() resolves XZ (and base Y)
    // through any ancestor transform; add the tabletop's local surface offset so the
    // centre tracks the real surface even under a tilted/raised room group.
    const world = a.table.getWorldPosition(new THREE.Vector3());
    // Lift the framing centre for an UPRIGHT cabinet so the eye aims at the grid's
    // mid-height, not the tabletop surface. A module may also override per-instance
    // via instance.seatedCenterLift; default to the per-game table for flat boards
    // (0 = the bare surface). Symmetric across host/guest (no seat branch).
    const lift = (a.instance && Number.isFinite(a.instance.seatedCenterLift))
      ? a.instance.seatedCenterLift
      : (SEATED_CENTER_LIFT[a.gameId] || 0);
    const cx = world.x;
    const cy = world.y + this._tabletopLocalY(a.table) + lift;
    const cz = world.z;
    // Robustness: if the table's world transform hasn't resolved to finite numbers
    // (mid-teardown, a detached group, an un-updated matrix), report inactive rather
    // than handing main.js a NaN centre — feeding NaN into the camera-position lerp
    // would poison it permanently and the seated view would never recover. Holding
    // the normal follow-cam for a frame is invisible; a NaN jolt is not.
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) {
      return { active: false };
    }
    return {
      active: true,
      center: { x: cx, y: cy, z: cz },
      seatRy: a.seatRy,
      tableId: a.tableId,
      // Per-game pull-back (battleship + connect4); 1 = default first-person framing.
      zoom: SEATED_CAM_ZOOM[a.gameId] || 1,
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
    n.on("reveal", (m) => this._onReveal(m));
  }

  _sameTable(m) {
    return this.active && m && m.table === this.active.tableId;
  }

  _onMove(m) {
    const a = this.active;
    if (!this._sameTable(m) || !a) return;
    // BUG 2 (mid-join spectator stale base): a freshly-mounted spectator is on the
    // live game-move relay (PUBLIC_RELAY) the instant it watches, but its catch-up
    // pub snapshot is async and may land AFTER the next relayed move. Applying that
    // move against the module's constructor-initial board (not the true mid-game
    // position) paints a transient wrong render — and modules that derive the mover
    // from local `turn` (reversi/checkers/gomoku) can do so without throwing, so the
    // self-healing resync path never fires. Gate: a spectator only starts consuming
    // relayed deltas once it has applied its first authoritative snapshot (_hydrated,
    // set in _onState). Until then, drop the move — the pending snapshot already
    // carries the full position, and the host pushes a fresh snapshot after every
    // move, so nothing is lost. Seated host/guest are unaffected (their catch-up
    // `full` arrives on the seat assign before relayed moves and they start hydrated).
    if (a.role === "spectator" && !a._hydrated) return;
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
      else if ((a.role === "spectator" || a.role === "guest") && a.instance.spectatorAnimates !== false) {
        // BUG 1 (spectator/guest animations snapped away): the host commits a move
        // with net.sendMove THEN net.sendState, so for a full-info game a spectator
        // — OR a seated GUEST animating the host's relayed move — reliably receives
        // the host's post-move `pub` snapshot a few ms after the relayed move.
        // applyState tears down in-flight animation (clears hops/flips/falling discs)
        // and hard-snaps to the authoritative layout, so the glide/flip/fall the move
        // just started is aborted and the watcher sees a teleport. Since applyMove
        // already converged the viewer to the same logical position the snapshot
        // describes (connect4 defers turn-flip/win into resolveAfter on BOTH sides,
        // so the echo is a redundant restatement of the position the guest already
        // holds), suppress exactly ONE following snapshot (the redundant post-move
        // push) so the animation can complete.
        // We only swallow the immediate echo: a stale/recovery snapshot arriving
        // later than _SPEC_SNAP_WINDOW_MS, or a second snapshot, still applies and
        // re-converges. Tracked with a deadline so a dropped echo can't suppress an
        // unrelated later snapshot indefinitely.
        //
        // The skip is OPT-OUT: it is correct ONLY for full-info turn-based modules
        // whose spectator applyMove actually applies + animates the relayed move
        // (uttt, mancala, connect4, …). Snapshot-driven modules (ludo, pong, tron)
        // render spectators PURELY from authoritative snapshots — their spectator
        // applyMove is a no-op — so for them the post-move snapshot is NOT a
        // redundant echo of an animation in flight; it carries the only state the
        // spectator will ever see. Swallowing it strands the spectator one move
        // behind (e.g. a guest's ludo roll/token advance vanishes for ~1.5s).
        // Those modules export `spectatorAnimates: false` to skip arming the window.
        a._specSkipSnapUntil = this._now() + InWorldBoard._SPEC_SNAP_WINDOW_MS;
      }
    } catch (err) {
      // ANY applyMove failure is recoverable: a malformed/garbage relayed move
      // (TypeError, out-of-range index, etc.) must NOT escape this handler — it is
      // dispatched synchronously from the raw WebSocket 'message' pump (Network._emit)
      // with no surrounding try/catch, so rethrowing would abort the whole message
      // dispatch. Log non-desync errors and request an authoritative re-push instead.
      if (!(err instanceof GameDesync)) {
        try {
          console.warn("[InWorldBoard] applyMove threw; requesting resync", err);
        } catch {
          /* ignore */
        }
      }
      this._requestResync();
    }
  }

  _now() {
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
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
    // BUG 1: a spectator OR seated guest that just consumed the relayed move for
    // this snapshot suppresses exactly the redundant post-move echo so its in-flight
    // animation is not snapped away (see _onMove). The window is one-shot and
    // time-bounded: clear it whether or not it was still in force, so only the
    // immediate echo is ever swallowed and the very next snapshot always applies.
    if ((a.role === "spectator" || a.role === "guest") && a._specSkipSnapUntil != null) {
      const skip = this._now() <= a._specSkipSnapUntil;
      a._specSkipSnapUntil = null;
      if (skip) return;
    }
    try {
      a.instance.applyState?.(state);
      // BUG 2: the spectator now has a true authoritative base — relayed deltas may
      // be applied from here on (gated in _onMove until this first hydration).
      a._hydrated = true;
    } catch {
      /* a bad snapshot must not crash the loop */
    }
  }

  _onReset(m) {
    const a = this.active;
    if (!this._sameTable(m) || !a) return;
    a.over = false;
    a.lastFull = a.lastPub = null;
    this._pendingReveal = null; // a stale reveal must not survive a reset
    try {
      a.instance.applyState?.(null);
    } catch {
      /* ignore */
    }
  }

  // SPECTATOR-ONLY REVEAL inbound. The server forwards a hidden-info reveal (both
  // battleship fleets / the real memory deck) to SPECTATORS + ambient passersby
  // ONLY — never to a seated player's opponent. Route the merged reveals to the
  // module so a spectator instance renders the FULL board. Buffer if the async
  // mount hasn't resolved yet (same race the snapshot path handles via _pending).
  _onReveal(m) {
    const a = this.active;
    if (!a) {
      if (m && m.reveals != null) this._pendingReveal = m;
      return;
    }
    if (!this._sameTable(m)) return;
    // Only a spectator instance ever renders a reveal. A seated host/guest is never
    // sent one by the server, but guard here too so a stray payload can't reveal an
    // opponent's layout in a player's own view.
    if (a.role !== "spectator") return;
    try {
      a.instance.applyReveal?.(m.reveals);
    } catch {
      /* a bad reveal must not crash the loop */
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
      // Spectator sync bookkeeping (board.js only — see _onMove/_onState).
      //   _hydrated          : true once the first authoritative applyState has run,
      //                         so relayed deltas have a true base to apply against.
      //                         A host/guest start hydrated (host is authoritative;
      //                         a guest's catch-up `full` precedes relayed moves).
      //   _specSkipSnapUntil  : deadline (ms) during which one redundant post-move
      //                         pub snapshot is swallowed so a spectator animation
      //                         isn't snapped away. null = none pending.
      _hydrated: role !== "spectator",
      _specSkipSnapUntil: null,
      // Cosmetic mount grow-in (see update()): _baseScale captures the module's
      // OWN authored group scale once at mount; _mountT eases a multiplier up to
      // it, then resets to null so the framework stops touching the scale.
      _baseScale: null,
      _mountT: 0,
      // Last hover cell forwarded to the module (cell object or -1), so the hover
      // router only re-notifies the module on a CHANGE — fewer redundant setHover
      // calls and a steadier affordance through the throttle (see _onPointerMove).
      _lastHover: -1,
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

    // Arm the cosmetic grow-in: capture the module's authored scale (one alloc per
    // mount, never per frame) and start slightly shrunk so the board eases up to
    // size on the first few update() frames. Settles exactly on _baseScale.
    a._baseScale = instance.group.scale.clone();
    a._mountT = 0;
    instance.group.scale.set(
      a._baseScale.x * MOUNT_IN_FROM,
      a._baseScale.y * MOUNT_IN_FROM,
      a._baseScale.z * MOUNT_IN_FROM
    );

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
      // SPECTATOR-ONLY REVEAL: replay any reveal that landed during the async load
      // so a late spectator paints the full board immediately. requestState() also
      // re-asks the server, which re-sends the cached reveal to a spectator.
      if (role === "spectator" && this._pendingReveal && this._pendingReveal.table === opts.tableId) {
        const bufferedReveal = this._pendingReveal;
        this._pendingReveal = null;
        this._onReveal(bufferedReveal);
      } else {
        this._pendingReveal = null;
      }
      try {
        this.network?.requestState?.();
      } catch {
        /* ignore */
      }
    } else {
      this._pending = null;
      this._pendingReveal = null;
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
      // SPECTATOR-ONLY REVEAL: a seated player publishes its OWN private layout so
      // WATCHERS render the full board. The server forwards it to spectators +
      // ambient passersby ONLY, never to the opposing seat — so a hidden-info game
      // stays fair while every onlooker sees everything. Any seated role may call
      // it (host reveals the deck for memory; each player reveals their own fleet
      // for battleship); a spectator never has private layout to send.
      sendReveal(reveal) {
        try {
          self.network?.sendReveal?.(reveal);
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
    // Cosmetic mount grow-in. Runs BEFORE the module update so the board is the
    // right size for any geometry the module animates this frame, and settles even
    // if the module's update throws. _mountT is null once complete, so the steady
    // state costs one cheap null check and never touches the group's scale again —
    // leaving a module free to rescale its own group afterward. Allocation-free
    // (mutates the existing scale Vector3 from the cached _baseScale).
    if (a._mountT != null && a._baseScale) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      a._mountT += (step * 1000) / MOUNT_IN_MS;
      if (a._mountT >= 1) {
        a.group?.scale.copy(a._baseScale);
        a._mountT = null;
      } else if (a.group) {
        const f = MOUNT_IN_FROM + (1 - MOUNT_IN_FROM) * _smoothstep01(a._mountT);
        a.group.scale.set(a._baseScale.x * f, a._baseScale.y * f, a._baseScale.z * f);
      }
    }
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
      if (a) a._lastHover = -1;
      try { a?.instance?.setHover?.(-1); } catch { /* ignore */ }
    }
  }

  // Equality for two resolved hover cells (or the -1 "no hover" sentinel). The
  // resolver mints a FRESH cell object per raycast, so identity comparison would
  // always differ and re-notify the module every throttled frame; compare by value
  // (r,c and the optional `which` grid id battleship uses) so we only push a real
  // change. Both -1 (miss/cleared) compare equal.
  _sameHover(x, y) {
    if (x === y) return true;
    const ax = x && typeof x === "object";
    const ay = y && typeof y === "object";
    if (!ax || !ay) return false; // one is the -1 sentinel, the other a cell
    // The modules use varied cell shapes — chess/checkers/gomoku {r,c},
    // battleship {r,c,which}, mancala {pit}, memory {i}, ludo {color,token},
    // ultimatettt {B,i}, dotsandboxes {o,r,c}. The old r/c/which-only compare made
    // every {pit}/{i}/{color,token}/{B,i} pair compare EQUAL (so the hover ring
    // never moved between pits/cells after the first one), and collapsed
    // dotsandboxes' h/v edges that share one {r,c} (only `o` differs). Compare
    // structurally by key/value so ANY cell shape is distinguished; for {r,c} and
    // {r,c,which} this is identical to the old behaviour.
    const kx = Object.keys(x), ky = Object.keys(y);
    if (kx.length !== ky.length) return false;
    for (const k of kx) if (x[k] !== y[k]) return false;
    return true;
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
    // ~40Hz throttle (was ~30Hz): a touch more responsive so the affordance tracks
    // the cursor smoothly, while still cheap (one raycast per gate). Still
    // non-consuming — hover never eats the orbit-drag.
    const now = performance.now ? performance.now() : Date.now();
    if (now - this._hoverAt < 24) return;
    this._hoverAt = now;
    if (!this._turnAllowed(a)) {
      // Off-turn / spectator: clear once, then stay quiet until a turn returns.
      if (!this._sameHover(a._lastHover, -1)) {
        a._lastHover = -1;
        try { a.instance.setHover(-1); } catch { /* ignore */ }
      }
      return;
    }
    const cell = this._raycastCell(a, ev.clientX, ev.clientY);
    const next = cell ?? -1;
    // Only re-notify the module when the resolved cell actually CHANGES. The
    // resolver returns a fresh object each raycast, so without this the module
    // would re-run its hover work every throttled frame even while the cursor sits
    // on one cell — wasteful and, for modules that restart an animation on each
    // setHover, visibly jittery. Steadier and more forgiving.
    if (this._sameHover(a._lastHover, next)) return;
    a._lastHover = next;
    try {
      // Forward the FULL resolved {r,c,which} cell (or -1 on a miss). Modules that
      // only care about a column (connect4) read cell.c; modules that need the exact
      // row+col under the cursor (battleship's placement ghost / firing reticle)
      // read both. Passing only the column previously pinned battleship's reticle to
      // a column's top cell — it could never track the exact hovered row.
      a.instance.setHover(next);
    } catch {
      /* ignore */
    }
  }

  _onPointerLeave() {
    const a = this.active;
    if (!a) return;
    if (this._sameHover(a._lastHover, -1)) return;
    a._lastHover = -1;
    try { a.instance?.setHover?.(-1); } catch { /* ignore */ }
  }

  // Set the shared NDC vector from a client-space coordinate. Returns false if the
  // canvas has zero size (detached / not yet laid out) so callers bail cleanly
  // instead of feeding NaN into the raycaster.
  _setNdc(rect, cx, cy) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    this._ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    return true;
  }

  // Choose the best hit from a frontmost-first intersection list and return
  // { hit, cell }. We walk the list and return the FIRST hit the active module
  // AUTHORITATIVELY resolves to a cell (Tier 1 hitToCell / Tier 2 userData.cell) —
  // so a transparent/decorative mesh sitting in front of the grid (a glass cover, a
  // hover ghost, furniture) no longer swallows the click by being hits[0]. Selection
  // uses _resolveCellStrict (NOT the geometric Tier-3 fallback), so a module's "this
  // hit isn't a cell" verdict is always honoured and the geometric guess never steers
  // which hit we route. Hits with no usable object are skipped. If NOTHING resolves
  // authoritatively we fall back to the frontmost usable hit and hand the module the
  // FULL resolver's value for it — preserving today's exact behaviour for
  // object-routed mounts (the flip-book menu walks userData.menuAction off the
  // frontmost object and ignores the geometric cell) and for honest misses.
  _pickHit(a, hits) {
    let front = null;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (!h || !h.object) continue;
      if (front == null) front = h; // remember the frontmost usable hit
      const cell = this._resolveCellStrict(a, h);
      if (cell != null) return { hit: h, cell };
    }
    return front ? { hit: front, cell: this._resolveCell(a, front) } : null;
  }

  // Raycast a screen coordinate onto the active board and resolve a cell, or null.
  _raycastCell(a, cx, cy) {
    const canvas = this.getCanvas?.();
    if (!canvas || cx == null || cy == null) return null;
    const rect = canvas.getBoundingClientRect();
    if (!this._setNdc(rect, cx, cy)) return null;
    this._ray.setFromCamera(this._ndc, this.camera);
    const hits = this._ray.intersectObject(a.group, true);
    if (!hits.length) return null;
    const picked = this._pickHit(a, hits);
    return picked ? picked.cell : null;
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
    if (!this._setNdc(rect, cx, cy)) return false;
    this._ray.setFromCamera(this._ndc, this.camera);
    const hits = this._ray.intersectObject(a.group, true);
    if (!hits.length) return false;
    // Pick the frontmost hit the module actually resolves to a cell (so a clear
    // cover / ghost mesh in front of the grid doesn't eat the click); fall back to
    // the frontmost usable hit (cell:null) for object-routed mounts (the menu).
    const picked = this._pickHit(a, hits);
    if (!picked) return false;
    const { hit, cell } = picked;
    try {
      a.instance.onPointer?.({ cell, point: hit.point, object: hit.object });
    } catch {
      /* ignore */
    }
    return true;
  }

  // AUTHORITATIVE tiers only (Tier 1 hitToCell + Tier 2 userData.cell). Returns a
  // cell ONLY when the module itself owns/tags this hit as a cell; null otherwise.
  // _pickHit uses THIS (not the full resolver) to decide whether a hit "counts" as
  // a board cell, because the geometric Tier-3 fallback below is a best-effort guess
  // that some mounts (the flip-book menu) deliberately ignore — letting it steer hit
  // SELECTION would make _pickHit choose a deeper hit over the frontmost one the menu
  // routes by object. Keeping selection authoritative-only means the multi-hit scan
  // only ever skips furniture for a module that truly resolves cells, and the menu
  // still falls back to the frontmost hit exactly as before.
  _resolveCellStrict(a, hit) {
    // Tier 1 — the module's OWN hit-test. A module that exposes hitToCell owns the
    // authoritative mapping for its geometry; if it returns a cell, use it. If it
    // returns null it has DELIBERATELY rejected this hit (e.g. connect4's base slab /
    // rail / lamps, battleship's non-grid furniture). We must NOT then fall through
    // to the flat geometric fallback below: that helper assumes a flat 8×8 XZ board
    // in UN-rotated group space, but an upright cabinet (connect4) carries its facing
    // rotation on a child mesh, so it would map a non-grid click to an arbitrary
    // {r,c} and drop a disc the player never intended. A module's null is final.
    if (typeof a.instance.hitToCell === "function") {
      return a.instance.hitToCell(hit) || null;
    }
    // Tier 2 — per-cell colliders tagged userData.cell (the precise, orientation-safe
    // path battleship/pieces use). Walk ancestors so a child mesh of a tagged collider
    // still resolves.
    let o = hit.object;
    while (o) {
      if (o.userData && o.userData.cell) return o.userData.cell;
      o = o.parent;
    }
    return null;
  }

  // 3-tier resolver: module hitToCell > userData.cell ancestor walk > geometric.
  // This produces the FINAL cell value handed to the module; _pickHit selects the
  // hit using the authoritative-only variant above.
  _resolveCell(a, hit) {
    // Tiers 1 & 2 (authoritative). A non-null result is final.
    const tagged = this._resolveCellStrict(a, hit);
    if (tagged != null) return tagged;
    // A module that exposes hitToCell and returned null DELIBERATELY rejected this
    // hit — its null is final and must NOT reach the flat geometric fallback (an
    // upright cabinet would map a non-grid click to an arbitrary {r,c}).
    if (typeof a.instance.hitToCell === "function") return null;
    // Tier 3 — geometric fallback (flat N×N XZ board in the group's local frame).
    // This is only correct for a FLAT board the host rotated via orientFor(seatRy):
    // group.worldToLocal then undoes that rotation and the layout really is a flat
    // XZ grid. A module that orients ITSELF (orientPolicy "self") puts its facing on
    // a child (or self-orients per seat), so the unrotated-group XZ assumption is
    // wrong — never run the flat fallback for it. Such a module is expected to expose
    // hitToCell or userData.cell colliders (handled above); if it does neither, this
    // click simply doesn't resolve to a cell (correct — better than an arbitrary one).
    if (a.instance.orientPolicy === "self") return null;
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
