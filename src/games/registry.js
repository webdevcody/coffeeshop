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

  chess: {
    id: "chess",
    name: "Chess",
    blurb: "Checkmate the king.",
    icon: "♟",
    // Host plays white and moves first; guest plays black.
    capacity: 2,
    // Extra people who sit at a full table can watch the match (#spectate=<CODE>):
    // the host streams a read-only board snapshot to each onlooker.
    spectatable: true,
    // Same room contract as the other board games (#host=<CODE> / #join=<CODE>),
    // plus a read-only spectator connection (#spectate=<CODE>).
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/chess/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },

  reversi: {
    id: "reversi",
    name: "Reversi",
    blurb: "Flip discs to own the board.",
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
      return `/games/reversi/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },

  ultimatettt: {
    id: "ultimatettt",
    name: "Ultimate Tic-Tac-Toe",
    blurb: "Tic-tac-toe inside tic-tac-toe.",
    icon: "#",
    // Host plays X and moves first; guest plays O.
    capacity: 2,
    // Extra people who sit at a full table can watch the match (#spectate=<CODE>):
    // the host streams a read-only board snapshot to each onlooker.
    spectatable: true,
    // Same room contract as the other board games (#host=<CODE> / #join=<CODE>),
    // plus a read-only spectator connection (#spectate=<CODE>).
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/ultimatettt/index.html#${verb}=${encodeURIComponent(roomId)}`;
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

  dotsandboxes: {
    id: "dotsandboxes",
    name: "Dots and Boxes",
    blurb: "Close boxes to claim them.",
    icon: "▦",
    // Host plays red and moves first; guest plays blue.
    capacity: 2,
    // Extra people who sit at a full table can watch the match (#spectate=<CODE>):
    // the host streams a read-only board snapshot to each onlooker.
    spectatable: true,
    // Same room contract as the other board games (#host=<CODE> / #join=<CODE>),
    // plus a read-only spectator connection (#spectate=<CODE>).
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/dotsandboxes/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },
  mancala: {
    id: "mancala",
    name: "Mancala",
    blurb: "Sow seeds, fill your store.",
    icon: "🫘",
    // Host owns the bottom row + right store and moves first; guest owns the top
    // row + left store.
    capacity: 2,
    // Extra people who sit at a full table can watch the match (#spectate=<CODE>):
    // the host streams a read-only board snapshot to each onlooker.
    spectatable: true,
    // Same room contract as the other café games (#host=<CODE> / #join=<CODE> /
    // #spectate=<CODE>).
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/mancala/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },

  pong: {
    id: "pong",
    name: "Pong",
    blurb: "Real-time paddle duel.",
    icon: "🏓",
    // Host is the left paddle and runs the authoritative physics; guest is the
    // right paddle and sends input. First to 7 wins.
    capacity: 2,
    // The host already broadcasts authoritative state, so onlookers can
    // subscribe to the same read-only stream (#spectate=<CODE>).
    spectatable: true,
    // Same room contract as the other games for pairing (#host / #join), plus a
    // read-only spectator connection (#spectate=<CODE>).
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/pong/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },

  tron: {
    id: "tron",
    name: "Light Cycles",
    blurb: "Race, leave a trail, don't crash.",
    icon: "🏍️",
    // Real-time, host-authoritative: the host simulates both cycles and streams
    // the arena every tick; the guest sends only steering. Two players for now.
    capacity: 2,
    // Spectators subscribe read-only to the host's per-tick broadcast.
    spectatable: true,
    // Same room contract as the other café games (#host=<CODE> / #join=<CODE> /
    // #spectate=<CODE>).
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/tron/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },

  ludo: {
    id: "ludo",
    name: "Ludo",
    blurb: "Race 4 tokens home (2–4 players).",
    icon: "🎲",
    // The café's first 4-player game: host + up to three guests share one room.
    // The server seats them (see multi-seat room coordination) and every guest
    // joins the host the same way (#join); the host assigns each a colour by
    // connection order.
    capacity: 4,
    // The host already broadcasts authoritative state, so onlookers can watch
    // read-only (#spectate=<CODE>).
    spectatable: true,
    url(roomId, role) {
      const verb = role === "host" ? "host" : role === "spectator" ? "spectate" : "join";
      return `/games/ludo/index.html#${verb}=${encodeURIComponent(roomId)}`;
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
