// Coffeeshop multiplayer server.
// - Serves the static client from /public
// - Hosts a WebSocket relay at /ws for player state + chat + WebRTC voice signaling
//
// The server is a thin relay: it keeps a small registry of connected players
// (id, name, color, last known transform) and rebroadcasts updates. There is no
// game logic / authority here — clients are trusted, since this is a casual
// social space with no win conditions.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// We serve Vite's build output. `npm run build` produces it; in production the
// Docker image bakes it in. (Run `npm run build` once before `npm start` locally,
// or use `npm run dev` for the HMR dev server.)
const DIST_DIR = path.join(__dirname, "..", "dist");
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function safeJoin(base, target) {
  const resolved = path.normalize(path.join(base, target));
  if (!resolved.startsWith(base)) return null; // path traversal guard
  return resolved;
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
  if (urlPath === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  let filePath = safeJoin(DIST_DIR, urlPath);
  if (!filePath) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": cacheControl(ext, urlPath),
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Cache policy that pairs with Vite's content-hashed filenames:
//   - HTML is NEVER cached, so a deploy is picked up on the next request and the
//     fresh document always references the latest hashed bundles.
//   - Anything under an /assets/ directory has a content hash in its name, so the
//     bytes for a given URL never change — cache it immutably for a year. This
//     covers both the app's own dist/assets/* and the prebuilt games' assets.
//   - Everything else gets a short, revalidated cache.
function cacheControl(ext, urlPath) {
  if (ext === ".html") return "no-cache, no-store, must-revalidate";
  if (urlPath.includes("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

const server = http.createServer(serveStatic);

// ---------------------------------------------------------------------------
// WebSocket relay
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws" });

/** @type {Map<string, {ws: import('ws').WebSocket, player: object}>} */
const clients = new Map();
let nextId = 1;

// ---------------------------------------------------------------------------
// Game-table room coordination
// ---------------------------------------------------------------------------
// The server is a generic match coordinator — it doesn't know or care what game
// a table runs. When a player sits at a table it assigns them a role for that
// table's current match. Seats are an ordered list: the first to sit is the
// `host` (seat 0), who then picks a game from a menu (the choice is recorded
// here, mints the room id, and sets how many players the game wants); everyone
// who sits after, up to that capacity, is a `guest` who joins whatever the host
// picked (same room id). Most games want two players, but a game can ask for up
// to four — every guest still connects to the host the same way (`#join`), and
// the game itself (host-authoritative) assigns each guest a colour/seat by
// connection order. The host leaving ends the match and frees the table.
//
// Until the host picks a game the capacity isn't known, so we seat conservatively
// (host + one guest) and send extra early sitters to the spectator pool; when the
// host finally picks a >2-player game, those early spectators are promoted into
// the open player seats. Once all player seats are taken, further sitters become
// `spectator`s of the current match (instead of being turned away as `full`).
// Spectators receive the table's gameId + roomId so the client can open the game
// in a watch-only view; they never affect the match and are dropped silently when
// they stand up. Whether a game can actually be watched is a client/registry
// concern — the server stays game-agnostic and just hands out the role.
//
/** @type {Map<string, {roomId: string|null, gameId: string|null, capacity: number, seats: string[], spectators: Set<string>, full: object|null, pub: object|null}>} */
const tables = new Map();

// Per-gameId flag: may the host's full snapshot / raw moves reach spectators?
// Full-info + real-time games can mirror everything; hidden-info games expose
// ONLY their pub snapshot (no raw moves, no full) — enforced server-side so a
// leak is structural, not by client convention.
const PUBLIC_RELAY = {
  checkers: true, chess: true, connect4: true, reversi: true, gomoku: true,
  dotsandboxes: true, ultimatettt: true, mancala: true,
  pong: true, tron: true, ludo: true,
  battleship: false, memory: false,
};
function publicRelay(gameId) {
  return PUBLIC_RELAY[gameId] !== false; // default permissive for unknown ids
}

// Resolve the sender's table + role from the connection (trusted, unspoofable).
// Never trust a client-sent roomId/table for the relay.
function senderTable(id) {
  const c = clients.get(id);
  if (!c) return null;
  const tid = c.player.gameTable;
  if (!tid) return null;
  const t = tables.get(tid);
  if (!t) return null;
  return { tid, t, role: c.player.gameRole, c };
}

// Lightweight per-connection token bucket for real-time game-input. The host is
// the authority for pong/tron, but the relay should still bound how fast (and how
// large) a single guest can drive the shared sim so one client can't flood/DoS or
// desync it. ~60 inputs/sec sustained with a small burst is ample for paddle/turn
// steering; over-budget packets are dropped silently.
const INPUT_RATE = 60; // tokens refilled per second
const INPUT_BURST = 20; // bucket capacity
function allowInput(c) {
  const now = Date.now();
  if (c._ib == null) { c._ib = INPUT_BURST; c._ibAt = now; }
  const elapsed = (now - c._ibAt) / 1000;
  c._ibAt = now;
  c._ib = Math.min(INPUT_BURST, c._ib + elapsed * INPUT_RATE);
  if (c._ib < 1) return false;
  c._ib -= 1;
  return true;
}
// A real-time input payload must be a small plain object (paddle dir / turn). Reject
// anything else so a large blob can't be relayed verbatim each call.
function saneInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  if (Object.keys(input).length > 6) return false;
  return true;
}

// How many onlookers a single table will accept once both player seats are
// taken. Tables have four chairs, so two spectators covers the physical seating;
// the cap is a safety bound against a misbehaving client, not a UX limit.
const SPECTATOR_LIMIT = 6;

// Unique-per-match room code. Hex (A-F0-9) so it survives any game's code
// normalization, and random so two matches never collide on a shared P2P broker.
function genRoomId() {
  return randomBytes(6).toString("hex").toUpperCase();
}

// Tell everyone which game table a player is now seated at (or null when they
// get up). Clients use this to scope proximity voice: once you're at a table you
// only hear — and are heard by — the people at the same table. Broadcast to all,
// the player included, so their own voice scoping updates too.
function broadcastSeat(id, table) {
  broadcast({ type: "seat-update", id, table: table ?? null });
}

// ---------------------------------------------------------------------------
// PASSERSBY — ambient board mirroring
// ---------------------------------------------------------------------------
// Beyond seated players and explicit spectators, the café broadcasts a low-rate
// PUBLIC view of every active match to the WHOLE room, so anyone walking by sees
// the live board on the table from a distance (read-only). This is strictly
// public: it carries ONLY the table's `pub` snapshot (never `full`, never raw
// moves). For hidden-info games (battleship/memory) `pub` already excludes
// private data by construction, so a passerby can never see ship layouts or face-
// down cards — the gate is structural, exactly like the spectator relay.
//
// We broadcast on every game-state change (host snapshot) and replay the full set
// of active boards to each newcomer on join, so a late arrival paints all live
// tables immediately. A board is cleared (gameId:null, pub:null) on reset, match
// end, or when the table frees, so the client unmounts its ambient mirror.

// Snapshot of one table's public ambient view, or a "cleared" marker.
function ambientPayload(tableId, t) {
  const active = !!(t && t.gameId && t.roomId);
  return {
    type: "ambient",
    table: tableId,
    gameId: active ? t.gameId : null,
    // Always the PUBLIC snapshot — never `full`. null until the host pushes state
    // (or once cleared). Passersby render read-only from this and nothing else.
    pub: active ? (t.pub ?? null) : null,
  };
}

// Fan one table's current public ambient view to the whole room. Cheap: it fires
// only when the host commits a snapshot (or the match's lifecycle changes), not
// per real-time frame.
function broadcastAmbient(tableId, t) {
  broadcast(ambientPayload(tableId, t));
}

// Tell `id` cleared the table (unmount any ambient mirror for it).
function broadcastAmbientClear(tableId) {
  broadcast({ type: "ambient", table: tableId, gameId: null, pub: null });
}

// Replay every active board's public ambient view to a single newcomer, so they
// converge on all live tables the moment they join (not only on the next move).
function sendAllAmbient(ws) {
  for (const [tid, t] of tables) {
    if (t && t.gameId && t.roomId) send(ws, ambientPayload(tid, t));
  }
}

// A player sits at a table. The first to sit becomes the `host` and then picks
// which game to play (see chooseSeatGame); the next becomes the `guest` of
// whatever the host picked; anyone beyond capacity is told the table is `full`.
// Replies with a `game-assign`. The host's reply carries gameId: null until
// they pick — and a guest who sits before the host picks also gets gameId: null
// (they'll receive a second game-assign once the host chooses).
function assignSeat(id, msg) {
  const tableId = typeof msg.table === "string" ? msg.table.slice(0, 64) : null;
  if (!tableId) return;

  // If they were already at a (different) table, leave it first.
  releaseSeat(id);

  let t = tables.get(tableId);
  if (!t) {
    // Capacity defaults to 2 until the host picks a game; this keeps the common
    // (two-player) case seating exactly host + one guest. A game that wants more
    // players raises the capacity at pick time and early spectators get promoted.
    t = { roomId: null, gameId: null, capacity: 2, seats: [], spectators: new Set(), full: null, pub: null };
    tables.set(tableId, t);
  }

  let role;
  if (t.seats.length === 0) {
    // First to sit hosts; the game is chosen next via "choose-game".
    t.seats.push(id);
    t.gameId = null;
    t.roomId = null;
    role = "host";
  } else if (t.seats.length < t.capacity && !t.seats.includes(id)) {
    t.seats.push(id);
    role = "guest";
  } else if (!t.seats.includes(id) && t.spectators.size < SPECTATOR_LIMIT) {
    // All player seats are taken — anyone else who sits watches the match. They
    // get the table's current game (null until the host picks, then a second
    // game-assign once it's chosen) and never affect the match.
    t.spectators.add(id);
    role = "spectator";
  } else {
    role = "full";
  }

  const c = clients.get(id);
  if (c) {
    c.player.gameTable = role === "full" ? null : tableId;
    c.player.gameRole = role === "full" ? null : role;
    const seatIndex = role === "guest" || role === "host" ? t.seats.indexOf(id) : null;
    send(c.ws, {
      type: "game-assign",
      table: tableId,
      gameId: role === "full" ? null : t.gameId, // null until the host picks
      roomId: role === "full" ? null : t.roomId,
      role,
      seatIndex,
      seatCount: t.capacity,
    });
    // Catch-up: a guest sitting mid-game gets the cached full snapshot so it
    // paints the live position; a spectator gets the pub snapshot. Fixes the
    // documented "no snapshot on join" desync.
    if (role === "guest" && t.full != null) {
      send(c.ws, { type: "game-state", table: tableId, role: "guest", full: t.full });
    } else if (role === "spectator" && t.pub != null) {
      // pub is always spectator-safe; PUBLIC_RELAY gates only full + raw moves.
      send(c.ws, { type: "game-state", table: tableId, role: "spectator", pub: t.pub });
    }
    // Announce this player's table so every client can scope voice to it. A
    // "full" sitter has no table (gameTable stays null) — they're not in the
    // table's voice group.
    broadcastSeat(id, c.player.gameTable);
  }
}

// The host picks which game to play. Records it on the table, mints the room id,
// and tells the host (and any guest already seated) to open the game.
function chooseSeatGame(id, msg) {
  const tableId = typeof msg.table === "string" ? msg.table.slice(0, 64) : null;
  const gameId = typeof msg.gameId === "string" ? msg.gameId.slice(0, 64) : null;
  if (!tableId || !gameId) return;
  const capacity = Number.isFinite(msg.capacity) ? Math.max(2, Math.min(8, msg.capacity)) : 2;

  const t = tables.get(tableId);
  if (!t || t.seats[0] !== id) return; // only the table's host (seat 0) may choose
  if (t.gameId) return; // a game is already locked in for this match

  t.gameId = gameId;
  t.capacity = capacity;
  t.roomId = genRoomId();
  t.full = null; // fresh match: no stale snapshot
  t.pub = null;

  // The chosen game may want more than two players. Promote early spectators —
  // who only became spectators because the capacity wasn't known yet — into the
  // now-open player seats, in the order they sat down.
  while (t.seats.length < t.capacity && t.spectators.size > 0) {
    const pid = t.spectators.values().next().value;
    t.spectators.delete(pid);
    t.seats.push(pid);
    const pc = clients.get(pid);
    if (pc) pc.player.gameRole = "guest";
  }

  const announce = (pid, role, seatIndex) => {
    const c = clients.get(pid);
    if (c) {
      send(c.ws, {
        type: "game-assign", table: tableId, gameId: t.gameId, roomId: t.roomId, role,
        seatIndex: role === "spectator" ? null : seatIndex, seatCount: t.capacity,
      });
    }
  };
  t.seats.forEach((pid, i) => announce(pid, i === 0 ? "host" : "guest", i));
  for (const sid of t.spectators) announce(sid, "spectator", null); // onlookers who sat before the pick
}

// A player stands up / disconnects. Ends the match for both players and frees
// the table so the next pair gets a clean room.
function releaseSeat(id) {
  const c = clients.get(id);
  const tableId = c?.player.gameTable;
  if (c) {
    c.player.gameTable = null;
    c.player.gameRole = null;
  }
  if (!tableId) return;
  // This player vacated their table — update everyone's voice scoping.
  broadcastSeat(id, null);
  const t = tables.get(tableId);
  if (!t) return;

  // A spectator leaving just stops watching — the match plays on.
  if (t.spectators.has(id)) {
    t.spectators.delete(id);
    return;
  }

  const seatIdx = t.seats.indexOf(id);
  if (seatIdx < 0) return; // not a player at this table

  // A guest dropping out of a >2-player match just frees their seat — the host
  // (the authority) keeps the game going, and the game's own P2P channel close
  // tells it that player left. Only when the host leaves (or it's a two-player
  // game) does the whole match end.
  if (seatIdx > 0 && t.capacity > 2) {
    t.seats.splice(seatIdx, 1);
    return;
  }

  // The host (or either player in a 1v1) left → end the match for everyone else
  // and free the table so the next group starts on a clean room.
  const notify = [...t.seats.filter((pid) => pid !== id), ...t.spectators];
  for (const pid of notify) {
    const pc = clients.get(pid);
    if (pc) {
      pc.player.gameTable = null;
      pc.player.gameRole = null;
      send(pc.ws, { type: "game-end", table: tableId, reason: "opponent-left" });
      broadcastSeat(pid, null); // they were sent back to the café — update voice scoping
    }
  }
  tables.delete(tableId);
  // PASSERSBY: the match is over and the table is free — tell the whole room to
  // unmount any ambient mirror they were showing for it.
  broadcastAmbientClear(tableId);
}

const COLORS = [
  "#e76f51", "#2a9d8f", "#e9c46a", "#8ecae6", "#f4a261",
  "#a78bfa", "#ef476f", "#06d6a0", "#118ab2", "#ffb4a2",
];

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const [id, c] of clients) {
    if (id === exceptId) continue;
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }
}

function sanitizeName(name) {
  if (typeof name !== "string") return "";
  return name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16);
}

function sanitizeChat(text) {
  if (typeof text !== "string") return "";
  return text.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 200);
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Copy any valid #rrggbb fields from `msg` onto the player. Returns the subset
// that actually changed, so callers can broadcast just the new look.
function applyAppearance(player, msg) {
  const out = {};
  for (const key of ["color", "skin", "hair"]) {
    if (typeof msg[key] === "string" && HEX_COLOR.test(msg[key])) {
      player[key] = msg[key];
      out[key] = msg[key];
    }
  }
  return out;
}

wss.on("connection", (ws) => {
  const id = String(nextId++);
  const player = {
    id,
    name: `Guest${id}`,
    color: COLORS[(Number(id) - 1) % COLORS.length],
    // Customizable look (skin + hair). null until the client sends its choice;
    // a client renders un-set values from a per-id default so nobody is faceless.
    skin: null,
    hair: null,
    x: 0,
    z: 4,
    ry: Math.PI,
    moving: false,
    sitting: false,
    seatY: 0,
    // Voice: whether this player has muted everyone (deafened). Sent to newcomers
    // so they immediately see the "can't hear you" badge over an already-deafened
    // player. Per-person mutes are relayed live and not stored here.
    deafened: false,
    // Game-table coordination (set when seated at a game table).
    gameTable: null,
    gameRole: null,
  };
  clients.set(id, { ws, player });
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "join": {
        player.name = sanitizeName(msg.name) || player.name;
        applyAppearance(player, msg); // color + skin + hair (each validated)
        // Tell the newcomer who is already here.
        const others = [];
        for (const [oid, c] of clients) {
          if (oid !== id) others.push(c.player);
        }
        send(ws, { type: "welcome", id, you: player, players: others });
        // Tell everyone else about the newcomer.
        broadcast({ type: "player-joined", player }, id);
        // PASSERSBY: paint every active match's PUBLIC board for the newcomer so
        // a late arrival sees all live tables at once (not only on the next move).
        sendAllAmbient(ws);
        break;
      }
      case "appearance": {
        // Live look change (skin / hair / clothing). Store and relay just the
        // changed fields so other clients restyle this player.
        const changed = applyAppearance(player, msg);
        if (Object.keys(changed).length) broadcast({ type: "appearance", id, ...changed }, id);
        break;
      }
      case "state": {
        // Position/orientation update. Numbers only, clamped to a sane range.
        if (typeof msg.x === "number") player.x = clamp(msg.x, -100, 100);
        if (typeof msg.z === "number") player.z = clamp(msg.z, -100, 100);
        if (typeof msg.ry === "number") player.ry = msg.ry;
        player.moving = !!msg.moving;
        player.sitting = !!msg.sitting;
        if (typeof msg.seatY === "number") player.seatY = clamp(msg.seatY, 0, 5);
        broadcast(
          {
            type: "state",
            id,
            x: player.x,
            z: player.z,
            ry: player.ry,
            moving: player.moving,
            sitting: player.sitting,
            seatY: player.seatY,
          },
          id
        );
        break;
      }
      case "chat": {
        const text = sanitizeChat(msg.text);
        if (!text) return;
        broadcast({ type: "chat", id, name: player.name, text });
        break;
      }
      case "signal": {
        // WebRTC signaling relay (offer/answer/ice). Forward to target peer.
        const target = clients.get(String(msg.to));
        if (target) {
          send(target.ws, { type: "signal", from: id, data: msg.data });
        }
        break;
      }
      case "voice-mute": {
        // This player updated who they can hear (deafen toggle / per-person
        // mute). Tell each *other* player whether this player can still hear
        // *them*, so a "can't hear you" badge can appear over this player's head
        // on their screen. We compute it per-recipient so nobody learns the full
        // mute list — only whether they personally are muted.
        player.deafened = !!msg.deafened;
        const mutedSet = new Set(
          Array.isArray(msg.muted) ? msg.muted.slice(0, 256).map(String) : []
        );
        for (const [oid, oc] of clients) {
          if (oid === id) continue;
          send(oc.ws, {
            type: "voice-status",
            id,
            cantHear: player.deafened || mutedSet.has(oid),
          });
        }
        break;
      }
      case "sit-game": {
        // Player sat at a game table and wants a role for it.
        assignSeat(id, msg);
        break;
      }
      case "choose-game": {
        // Host picked a game from the table menu.
        chooseSeatGame(id, msg);
        break;
      }
      case "leave-game": {
        // Player stood up / closed the game.
        releaseSeat(id);
        break;
      }

      // --- In-world game relay (additive; server stays a pure relay) --------
      case "game-move": {
        // A player committed a move. Relay verbatim to every OTHER seated member
        // (covers 4-player ludo, not just one opponent); for full-info games also
        // fan to spectators. Hidden-info games never relay raw moves to onlookers.
        const st = senderTable(id);
        if (!st || (st.role !== "host" && st.role !== "guest")) break;
        // bySeat: the MOVER'S seat index (0 = host, 1.. = guests in sit order).
        // host/guest alone can't disambiguate 3–4 player ludo, where any non-host
        // seat may legitimately be the current player — modules gate turns by seat.
        const bySeat = st.t.seats.indexOf(id);
        const out = { type: "game-move", table: st.tid, byRole: st.role, byId: id, bySeat, move: msg.move };
        for (const pid of st.t.seats) {
          if (pid === id) continue;
          const pc = clients.get(pid);
          if (pc) send(pc.ws, out);
        }
        if (publicRelay(st.t.gameId)) {
          for (const sid of st.t.spectators) {
            const sc = clients.get(sid);
            if (sc) send(sc.ws, out);
          }
        }
        break;
      }
      case "game-state": {
        // HOST-ONLY authoritative snapshot. Cache it, fan `full` to seated
        // members and `pub` to spectators (never `full` to spectators).
        const st = senderTable(id);
        if (!st || st.t.seats[0] !== id) break; // only the host (seat 0)
        st.t.full = msg.full ?? null;
        st.t.pub = msg.pub ?? msg.full ?? null;
        for (const pid of st.t.seats) {
          if (pid === id) continue;
          const pc = clients.get(pid);
          if (pc) send(pc.ws, { type: "game-state", table: st.tid, role: "guest", full: st.t.full });
        }
        // Spectators ALWAYS get pub — it is opponent/spectator-safe by
        // construction (hidden-info modules exclude private data from pub). The
        // PUBLIC_RELAY flag only blocks `full` and raw moves, never pub.
        if (st.t.pub != null) {
          for (const sid of st.t.spectators) {
            const sc = clients.get(sid);
            if (sc) send(sc.ws, { type: "game-state", table: st.tid, role: "spectator", pub: st.t.pub });
          }
        }
        // PASSERSBY: mirror the new PUBLIC view to the whole room (read-only).
        // Only `pub` leaves this scope — hidden-info layouts never do.
        broadcastAmbient(st.tid, st.t);
        break;
      }
      case "game-input": {
        // Real-time guest steering → host ONLY. Never cached, never to spectators.
        // Rate-limited + shape-checked so one guest can't flood/teleport/DoS the
        // host-side sim.
        const st = senderTable(id);
        if (!st || st.role !== "guest") break;
        if (!saneInput(msg.input)) break;
        if (!allowInput(st.c)) break; // over budget: drop silently
        const hostId = st.t.seats[0];
        const hc = clients.get(hostId);
        if (hc) send(hc.ws, { type: "game-input", table: st.tid, byRole: "guest", byId: id, input: msg.input });
        break;
      }
      case "game-reset": {
        const st = senderTable(id);
        if (!st || (st.role !== "host" && st.role !== "guest")) break;
        st.t.full = null;
        st.t.pub = null;
        const out = { type: "game-reset", table: st.tid };
        for (const pid of st.t.seats) {
          if (pid === id) continue;
          const pc = clients.get(pid);
          if (pc) send(pc.ws, out);
        }
        for (const sid of st.t.spectators) {
          const sc = clients.get(sid);
          if (sc) send(sc.ws, out);
        }
        // PASSERSBY: the board is now empty for everyone — re-broadcast the
        // (now-null) public view so passersby clear their mirror. The match is
        // still active (gameId/roomId intact), so this is a pub:null update, not
        // an unmount; the next snapshot repaints it.
        broadcastAmbient(st.tid, st.t);
        break;
      }
      case "watch": {
        // A non-seated client starts spectating a table (proximity). Add to the
        // spectator set (deduped) and ALWAYS replay the cached pub so the board
        // paints — this is the mount-time convergence path, so it must answer with
        // the current pub even when the id is already a spectator (e.g. it became
        // one by sitting, then watchTable() runs from board.mount()). Without the
        // replay-on-dedupe, every spectator relies on the racy assignSeat pub and
        // never converges.
        const tableId = typeof msg.table === "string" ? msg.table.slice(0, 64) : null;
        if (!tableId) break;
        const t = tables.get(tableId);
        const c = clients.get(id);
        if (!t || !c) break;
        // A seated player is already on the seat relay; nothing to do.
        if (t.seats.includes(id)) break;
        // Add to the spectator set if there's room; a duplicate add is a no-op but
        // we still fall through to replay the current pub below.
        if (!t.spectators.has(id) && t.spectators.size < SPECTATOR_LIMIT) {
          t.spectators.add(id);
        }
        if (t.spectators.has(id) && t.pub != null) {
          // pub is always safe to mirror; full/raw-moves are what PUBLIC_RELAY gates.
          send(c.ws, { type: "game-state", table: tableId, role: "spectator", pub: t.pub });
        }
        break;
      }
      case "request-state": {
        // Catch-up / desync recovery for the sender's own table. Answer from the
        // cache: a seated guest gets `full`, a spectator gets `pub`. The host is
        // authoritative locally and never needs this. Trusted table/role lookup —
        // a client can't request another table's state.
        const c = clients.get(id);
        if (!c) break;
        const st = senderTable(id);
        if (st) {
          if (st.role === "guest" && st.t.full != null) {
            send(c.ws, { type: "game-state", table: st.tid, role: "guest", full: st.t.full });
          } else if (st.role === "spectator" && st.t.pub != null) {
            send(c.ws, { type: "game-state", table: st.tid, role: "spectator", pub: st.t.pub });
          }
          break;
        }
        // No seated table (a proximity-only spectator never sets gameTable). Find
        // the table this client is actually watching and replay its pub so the
        // board.js mount-time requestState() converges proximity spectators too.
        for (const [tid, t] of tables) {
          if (t.spectators.has(id) && t.pub != null) {
            send(c.ws, { type: "game-state", table: tid, role: "spectator", pub: t.pub });
            break;
          }
        }
        break;
      }
      case "unwatch": {
        const tableId = typeof msg.table === "string" ? msg.table.slice(0, 64) : null;
        if (!tableId) break;
        const t = tables.get(tableId);
        if (t) t.spectators.delete(id);
        break;
      }
      default:
        break;
    }
  });

  const cleanup = () => {
    releaseSeat(id); // end any in-progress match before dropping the client
    // Drop any proximity-watch subscriptions this client held (they don't set
    // gameTable, so releaseSeat doesn't cover them).
    for (const t of tables.values()) t.spectators.delete(id);
    if (clients.delete(id)) {
      broadcast({ type: "player-left", id });
    }
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Heartbeat: drop dead connections so ghost players disappear.
const heartbeat = setInterval(() => {
  for (const [, c] of clients) {
    if (c.ws.isAlive === false) {
      c.ws.terminate();
      continue;
    }
    c.ws.isAlive = false;
    try {
      c.ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 15000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`☕ Coffeeshop server listening on http://localhost:${PORT}`);
});
