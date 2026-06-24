// Game registry — the single place that knows about playable games inside the
// café. When you sit at a table you pick one of these from a menu; the choice
// opens the game in an overlay iframe connected to that table's room.
//
// To add a new game:
//   1. Drop its static build under  public/games/<id>/
//   2. Add an entry here describing how to build its room URL.
// Nothing else in the codebase needs to know the game exists — the server is a
// generic room coordinator, the table menu lists whatever is registered here,
// and the Arcade overlay just loads whatever URL the registry produces.

export const GAMES = {
  battleship: {
    id: "battleship",
    name: "Battleship",
    blurb: "Sink your opponent's fleet.",
    icon: "🚢",
    // Two players per match (one host + one guest). The server uses this to
    // decide when a table is full.
    capacity: 2,
    // Build the iframe URL for a given room + role.
    //   role === "host"  -> registers the PeerJS peer for this room and waits
    //   role === "guest" -> connects to the host's peer
    // The patched battleship bundle understands `#host=<CODE>` (host a fixed
    // code) and the stock `#join=<CODE>` (join an existing code).
    url(roomId, role) {
      const verb = role === "host" ? "host" : "join";
      return `/games/battleship/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },

  checkers: {
    id: "checkers",
    name: "Checkers",
    // Two players per match (host = red and moves first, guest = black).
    capacity: 2,
    // Extra people who sit at a full table can watch the match (#spectate=<CODE>):
    // the host streams a read-only board snapshot to each onlooker.
    spectatable: true,
    // Same room contract as battleship: the host registers the room's PeerJS
    // peer (`#host=<CODE>`), the guest connects to it (`#join=<CODE>`), and
    // spectators connect read-only (`#spectate=<CODE>`).
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/checkers/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },

  connect4: {
    id: "connect4",
    name: "Connect 4",
    blurb: "Line up four in a row.",
    icon: "🔴",
    // Host plays red and drops first; guest plays yellow.
    capacity: 2,
    // Extra people who sit at a full table can watch the match (#spectate=<CODE>):
    // the host streams a read-only board snapshot to each onlooker.
    spectatable: true,
    // Same room contract as battleship (#host=<CODE> / #join=<CODE>), plus a
    // read-only spectator connection (#spectate=<CODE>).
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/connect4/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },

  gomoku: {
    id: "gomoku",
    name: "Gomoku",
    blurb: "Get five stones in a row.",
    icon: "⚫",
    // Host plays black and moves first; guest plays white.
    capacity: 2,
    // Extra people who sit at a full table can watch the match (#spectate=<CODE>):
    // the host streams a read-only board snapshot to each onlooker.
    spectatable: true,
    // Same room contract as the other café games (#host=<CODE> / #join=<CODE> /
    // #spectate=<CODE>).
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/gomoku/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },
};

export function getGame(id) {
  return GAMES[id] || null;
}

// The catalog the table menu renders. Order is stable for a build.
export function listGames() {
  return Object.values(GAMES).map((g) => ({
    id: g.id,
    name: g.name,
    blurb: g.blurb || "",
    icon: g.icon || "🎮",
    capacity: g.capacity ?? 2,
  }));
}
