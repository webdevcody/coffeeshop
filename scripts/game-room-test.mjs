// Validates the game-table room coordinator in server.js:
//   - first sitter at a table is host; choosing a game mints a roomId
//   - second sitter is guest of the host's chosen game (same roomId)
//   - third sitter is told the table is full
//   - only the host may choose the game
//   - a guest who sits before the host picks is pushed the game once chosen
//   - either player leaving ends the match for the other
//   - a fresh match after a reset gets a brand-new roomId
// Spawns its own server. Exits non-zero on any failed assertion.
import { WebSocket } from "ws";
import { spawn } from "node:child_process";

const PORT = process.env.PORT || 8091;
const URL = `ws://localhost:${PORT}/ws`;

const server = spawn(process.execPath, ["server/server.js"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "pipe",
});
process.on("exit", () => server.kill());
await new Promise((r) => setTimeout(r, 600));

const results = [];
const ok = (cond, msg) => {
  results.push({ cond: !!cond, msg });
  console.log((cond ? "✓ " : "✗ ") + msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A client whose `take(type)` consumes messages in arrival order, so repeated
// game-assigns to the same socket are distinguishable.
function client() {
  const ws = new WebSocket(URL);
  const queue = [];
  const waiters = [];
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.type === m.type);
    if (i >= 0) {
      const [w] = waiters.splice(i, 1);
      clearTimeout(w.timer);
      w.resolve(m);
    } else {
      queue.push(m);
    }
  });
  return {
    ws,
    open: () =>
      new Promise((r) => {
        if (ws.readyState === ws.OPEN) return r();
        ws.on("open", r);
      }),
    send: (o) => ws.send(JSON.stringify(o)),
    take: (type, timeout = 1500) =>
      new Promise((resolve, reject) => {
        const i = queue.findIndex((m) => m.type === type);
        if (i >= 0) return resolve(queue.splice(i, 1)[0]);
        const timer = setTimeout(() => reject(new Error("timeout waiting for " + type)), timeout);
        waiters.push({ type, resolve, timer });
      }),
    expectNone: async (type, ms = 300) => {
      await sleep(ms);
      return !queue.some((m) => m.type === type);
    },
  };
}

async function join(c, name) {
  await c.open();
  c.send({ type: "join", name });
  await c.take("welcome");
}

try {
  const a = client();
  const b = client();
  const cc = client();
  await join(a, "Alice");
  await join(b, "Bob");
  await join(cc, "Cara");

  // A sits first → host, but no game is chosen yet.
  a.send({ type: "sit-game", table: "table-0" });
  const aSit = await a.take("game-assign");
  ok(aSit.role === "host", "A is host of table-0");
  ok(aSit.gameId === null, "A's sit assign carries no game yet");
  ok(aSit.roomId === null, "A's sit assign carries no room yet");

  // A picks a game from the menu → assign now carries gameId + roomId.
  a.send({ type: "choose-game", table: "table-0", gameId: "connect4", capacity: 2 });
  const aGame = await a.take("game-assign");
  ok(aGame.role === "host", "A stays host after choosing");
  ok(aGame.gameId === "connect4", "A's chosen game is recorded");
  ok(typeof aGame.roomId === "string" && aGame.roomId.length >= 8, "A got a roomId: " + aGame.roomId);

  // B sits second → guest of A's chosen game, same room.
  b.send({ type: "sit-game", table: "table-0" });
  const bAssign = await b.take("game-assign");
  ok(bAssign.role === "guest", "B is guest of table-0");
  ok(bAssign.gameId === "connect4", "B joins the host's chosen game");
  ok(bAssign.roomId === aGame.roomId, "B joins A's room (" + bAssign.roomId + ")");

  // C sits third → full.
  cc.send({ type: "sit-game", table: "table-0" });
  const cAssign = await cc.take("game-assign");
  ok(cAssign.role === "full", "C is told the table is full");
  ok(cAssign.roomId === null, "C gets no roomId");

  // A non-host's choose-game is ignored.
  b.send({ type: "choose-game", table: "table-0", gameId: "battleship", capacity: 2 });
  ok(await b.expectNone("game-assign"), "a guest's choose-game is ignored");

  // A different table is independent.
  a.send({ type: "sit-game", table: "table-1" });
  await a.take("game-assign");
  a.send({ type: "choose-game", table: "table-1", gameId: "battleship", capacity: 2 });
  const aTable1 = await a.take("game-assign");
  ok(aTable1.role === "host" && aTable1.roomId !== aGame.roomId, "table-1 is a separate room");
  a.send({ type: "leave-game" });
  await sleep(100);

  // A guest who sits BEFORE the host picks gets the game via a second assign.
  const f = client();
  const g = client();
  await join(f, "Fin");
  await join(g, "Gwen");
  f.send({ type: "sit-game", table: "table-3" });
  const fSit = await f.take("game-assign");
  ok(fSit.role === "host" && fSit.gameId === null, "F hosts table-3 (no game yet)");
  g.send({ type: "sit-game", table: "table-3" });
  const gSit = await g.take("game-assign");
  ok(gSit.role === "guest" && gSit.gameId === null, "G is guest before the host picks (no game yet)");
  f.send({ type: "choose-game", table: "table-3", gameId: "connect4", capacity: 2 });
  const fGame = await f.take("game-assign");
  const gGame = await g.take("game-assign");
  ok(fGame.gameId === "connect4" && typeof fGame.roomId === "string", "F opens the chosen game");
  ok(
    gGame.role === "guest" && gGame.gameId === "connect4" && gGame.roomId === fGame.roomId,
    "G is pushed the host's game once it's picked"
  );
  f.ws.close();
  g.ws.close();
  await sleep(100);

  // Fresh pair on table-2: D hosts + picks, E guests, D leaves → E gets game-end.
  const d = client();
  const e = client();
  await join(d, "Dan");
  await join(e, "Eve");
  d.send({ type: "sit-game", table: "table-2" });
  await d.take("game-assign");
  d.send({ type: "choose-game", table: "table-2", gameId: "battleship", capacity: 2 });
  const dGame = await d.take("game-assign");
  e.send({ type: "sit-game", table: "table-2" });
  const eAssign = await e.take("game-assign");
  ok(dGame.role === "host" && eAssign.role === "guest", "D/E pair on table-2");
  ok(eAssign.roomId === dGame.roomId, "E joins D's room");

  // D disconnects → E should be told the opponent left.
  d.ws.close();
  const eEnd = await e.take("game-end");
  ok(eEnd.reason === "opponent-left", "E receives game-end when host disconnects");

  // After reset, E sits → host of a brand-new room once it picks again.
  e.send({ type: "sit-game", table: "table-2" });
  const eSit2 = await e.take("game-assign");
  ok(eSit2.role === "host", "E becomes host of the reset table-2");
  e.send({ type: "choose-game", table: "table-2", gameId: "battleship", capacity: 2 });
  const eGame2 = await e.take("game-assign");
  ok(eGame2.roomId !== dGame.roomId, "reset table-2 has a fresh roomId");

  a.ws.close();
  b.ws.close();
  cc.ws.close();
  e.ws.close();
  await sleep(100);
} catch (err) {
  ok(false, "exception: " + err.message);
}

const failed = results.filter((r) => !r.cond).length;
console.log(`\n${results.length - failed}/${results.length} assertions passed`);
process.exit(failed ? 1 : 0);
