// Game registry — the single place that knows about playable games inside the
// café. When you sit at a table you pick one of these from a menu; the choice
// mounts the game IN-WORLD on the 3D table (no iframe), synced over the WS relay.
//
// Each entry has:
//   id, name, blurb, icon              — menu presentation
//   capacity                           — how many players the match seats
//   spectatable                        — can onlookers watch?
//   hiddenInfo                         — true → server keeps full snapshots/raw
//                                        moves away from spectators (battleship,
//                                        memory). Drives the server PUBLIC_RELAY.
//   load()                             — dynamic import of the in-world module
//                                        (each exports createGame(ctx)).
//
// To add a game: drop src/games/inworld/<id>.js exporting createGame(ctx), add an
// entry here. The server stays a generic relay; the table menu lists whatever is
// registered. (The old iframe `url()` builders and public/games/* bundles are
// retained but unused.)

export const GAMES = {
  checkers: {
    id: "checkers", name: "Checkers", blurb: "Jump and king your way to victory.", icon: "⛀",
    capacity: 2, spectatable: true,
    load: () => import("./inworld/checkers.js"),
  },
  connect4: {
    id: "connect4", name: "Connect 4", blurb: "Line up four in a row.", icon: "🔴",
    capacity: 2, spectatable: true,
    load: () => import("./inworld/connect4.js"),
  },
  reversi: {
    id: "reversi", name: "Reversi", blurb: "Flip discs to own the board.", icon: "⚫",
    capacity: 2, spectatable: true,
    load: () => import("./inworld/reversi.js"),
  },
  gomoku: {
    id: "gomoku", name: "Gomoku", blurb: "Get five stones in a row.", icon: "⚫",
    capacity: 2, spectatable: true,
    load: () => import("./inworld/gomoku.js"),
  },
  dotsandboxes: {
    id: "dotsandboxes", name: "Dots and Boxes", blurb: "Close boxes to claim them.", icon: "▦",
    capacity: 2, spectatable: true,
    load: () => import("./inworld/dotsandboxes.js"),
  },
  ultimatettt: {
    id: "ultimatettt", name: "Ultimate Tic-Tac-Toe", blurb: "Tic-tac-toe inside tic-tac-toe.", icon: "#",
    capacity: 2, spectatable: true,
    load: () => import("./inworld/ultimatettt.js"),
  },
  mancala: {
    id: "mancala", name: "Mancala", blurb: "Sow seeds, fill your store.", icon: "🫘",
    capacity: 2, spectatable: true,
    load: () => import("./inworld/mancala.js"),
  },
  memory: {
    id: "memory", name: "Memory Match", blurb: "Flip café cards, find the pairs.", icon: "🃏",
    capacity: 2, spectatable: true, hiddenInfo: true,
    load: () => import("./inworld/memory.js"),
  },
  battleship: {
    id: "battleship", name: "Battleship", blurb: "Sink your opponent's fleet.", icon: "🚢",
    capacity: 2, spectatable: true, hiddenInfo: true,
    load: () => import("./inworld/battleship.js"),
  },
  pong: {
    id: "pong", name: "Pong", blurb: "Real-time paddle duel.", icon: "🏓",
    capacity: 2, spectatable: true,
    load: () => import("./inworld/pong.js"),
  },
  tron: {
    id: "tron", name: "Light Cycles", blurb: "Race, leave a trail, don't crash.", icon: "🏍️",
    capacity: 2, spectatable: true,
    load: () => import("./inworld/tron.js"),
  },
  ludo: {
    id: "ludo", name: "Ludo", blurb: "Race 4 tokens home (2–4 players).", icon: "🎲",
    capacity: 4, spectatable: true,
    load: () => import("./inworld/ludo.js"),
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

// gameId → whether full snapshots / raw moves may reach spectators. Mirrors the
// server's PUBLIC_RELAY; hidden-info games expose ONLY their pub snapshot.
export function isHiddenInfo(id) {
  return !!(GAMES[id] && GAMES[id].hiddenInfo);
}
