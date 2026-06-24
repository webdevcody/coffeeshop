// Game registry — the single place that knows about playable games inside the
// café. Each table in the world points at one of these by `id`; sitting down at
// a table opens the game in an overlay iframe connected to that table's room.
//
// To add a new game later:
//   1. Drop its static build under  public/games/<id>/
//   2. Add an entry here describing how to build its room URL.
//   3. Point one or more tables at it (see world/coffeeshop.js -> TABLE_GAME).
// Nothing else in the codebase needs to know the game exists — the server is a
// generic room coordinator and the Arcade overlay just loads whatever URL the
// registry produces.

export const GAMES = {
  battleship: {
    id: "battleship",
    name: "Battleship",
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
    // Same room contract as battleship: the host registers the room's PeerJS
    // peer (`#host=<CODE>`) and the guest connects to it (`#join=<CODE>`).
    url(roomId, role) {
      const verb = role === "host" ? "host" : "join";
      return `/games/checkers/index.html#${verb}=${encodeURIComponent(roomId)}`;
    },
  },
};

export function getGame(id) {
  return GAMES[id] || null;
}
