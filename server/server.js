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
// table's current match: the first to sit is the `host`, who then picks a game
// from a menu (the choice is recorded here and mints the room id); the second
// is the `guest`, who joins whatever the host picked (same room id); anyone
// beyond capacity is told the table is `full`. Either player leaving ends the
// match and frees the table, so the next pair starts fresh. This mirrors how
// P2P games like Battleship pair exactly two players per host session.
//
// Once both player seats are taken, anyone else who sits becomes a `spectator`
// of the current match (instead of being turned away as `full`). Spectators
// receive the table's gameId + roomId so the client can open the game in a
// watch-only view; they never affect the match, and they're dropped silently
// when they stand up. Whether a given game can actually be watched is a
// client/registry concern — the server stays game-agnostic and just hands out
// the role.
//
/** @type {Map<string, {roomId: string|null, gameId: string|null, host: string|null, guest: string|null, capacity: number, spectators: Set<string>}>} */
const tables = new Map();

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
    t = { roomId: null, gameId: null, host: null, guest: null, capacity: 2, spectators: new Set() };
    tables.set(tableId, t);
  }

  let role;
  if (t.host === null) {
    // First to sit hosts; the game is chosen next via "choose-game".
    t.host = id;
    t.gameId = null;
    t.roomId = null;
    role = "host";
  } else if (t.guest === null && t.host !== id) {
    t.guest = id;
    role = "guest";
  } else if (t.host !== id && t.guest !== id && t.spectators.size < SPECTATOR_LIMIT) {
    // Both player seats are taken — anyone else who sits watches the match.
    // They get the table's current game (null until the host picks, then a
    // second game-assign once it's chosen) and never affect the match.
    t.spectators.add(id);
    role = "spectator";
  } else {
    role = "full";
  }

  const c = clients.get(id);
  if (c) {
    c.player.gameTable = role === "full" ? null : tableId;
    c.player.gameRole = role === "full" ? null : role;
    send(c.ws, {
      type: "game-assign",
      table: tableId,
      gameId: role === "full" ? null : t.gameId, // null until the host picks
      roomId: role === "full" ? null : t.roomId,
      role,
    });
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
  if (!t || t.host !== id) return; // only the table's host may choose
  if (t.gameId) return; // a game is already locked in for this match

  t.gameId = gameId;
  t.capacity = capacity;
  t.roomId = genRoomId();

  const announce = (pid, role) => {
    const c = clients.get(pid);
    if (c) {
      send(c.ws, { type: "game-assign", table: tableId, gameId: t.gameId, roomId: t.roomId, role });
    }
  };
  announce(t.host, "host");
  if (t.guest) announce(t.guest, "guest"); // a guest who sat before the pick
  for (const sid of t.spectators) announce(sid, "spectator"); // onlookers who sat before the pick
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

  if (t.host !== id && t.guest !== id) return;

  // A player (host or guest) left → end the match for the opponent and every
  // spectator, then free the table so the next pair starts on a clean room.
  const notify = [];
  const otherId = t.host === id ? t.guest : t.host;
  if (otherId) notify.push(otherId);
  for (const sid of t.spectators) notify.push(sid);
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

wss.on("connection", (ws) => {
  const id = String(nextId++);
  const player = {
    id,
    name: `Guest${id}`,
    color: COLORS[(Number(id) - 1) % COLORS.length],
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
        if (typeof msg.color === "string" && /^#[0-9a-fA-F]{6}$/.test(msg.color)) {
          player.color = msg.color;
        }
        // Tell the newcomer who is already here.
        const others = [];
        for (const [oid, c] of clients) {
          if (oid !== id) others.push(c.player);
        }
        send(ws, { type: "welcome", id, you: player, players: others });
        // Tell everyone else about the newcomer.
        broadcast({ type: "player-joined", player }, id);
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
      default:
        break;
    }
  });

  const cleanup = () => {
    releaseSeat(id); // end any in-progress match before dropping the client
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
