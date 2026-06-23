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
// table's current match: the first to sit is the `host` (and gets a fresh room
// id), the second is the `guest` (same room id), anyone beyond capacity is told
// the table is `full`. Either player leaving ends the match and frees the table,
// so the next pair starts on a fresh room id. This mirrors how P2P games like
// Battleship pair exactly two players per host session.
//
/** @type {Map<string, {roomId: string|null, gameId: string|null, host: string|null, guest: string|null, capacity: number}>} */
const tables = new Map();

// Unique-per-match room code. Hex (A-F0-9) so it survives any game's code
// normalization, and random so two matches never collide on a shared P2P broker.
function genRoomId() {
  return randomBytes(6).toString("hex").toUpperCase();
}

// A player sits at a table and requests its game. Replies with a `game-assign`.
function assignSeat(id, msg) {
  const tableId = typeof msg.table === "string" ? msg.table.slice(0, 64) : null;
  const gameId = typeof msg.gameId === "string" ? msg.gameId.slice(0, 64) : null;
  if (!tableId || !gameId) return;
  const capacity = Number.isFinite(msg.capacity) ? Math.max(2, Math.min(8, msg.capacity)) : 2;

  // If they were already at a (different) table, leave it first.
  releaseSeat(id);

  let t = tables.get(tableId);
  if (!t) {
    t = { roomId: null, gameId, host: null, guest: null, capacity };
    tables.set(tableId, t);
  }

  let role;
  if (t.host === null) {
    // Start a fresh match on this table.
    t.roomId = genRoomId();
    t.gameId = gameId;
    t.capacity = capacity;
    t.host = id;
    role = "host";
  } else if (t.guest === null && t.host !== id) {
    t.guest = id;
    role = "guest";
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
      gameId: t.gameId,
      roomId: role === "full" ? null : t.roomId,
      role,
    });
  }
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
  const t = tables.get(tableId);
  if (!t) return;
  if (t.host !== id && t.guest !== id) return;

  const otherId = t.host === id ? t.guest : t.host;
  if (otherId) {
    const oc = clients.get(otherId);
    if (oc) {
      oc.player.gameTable = null;
      oc.player.gameRole = null;
      send(oc.ws, { type: "game-end", table: tableId, reason: "opponent-left" });
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
        // Player sat at a game table and wants a room + role for it.
        assignSeat(id, msg);
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
