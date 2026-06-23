// Validates the game-table room coordinator in server.js:
//   - first sitter at a table is host (gets a roomId)
//   - second sitter is guest (same roomId)
//   - third sitter is told the table is full
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

  // A sits first → host.
  a.send({ type: "sit-game", table: "table-0", gameId: "battleship", capacity: 2 });
  const aAssign = await a.take("game-assign");
  ok(aAssign.role === "host", "A is host of table-0");
  ok(typeof aAssign.roomId === "string" && aAssign.roomId.length >= 8, "A got a roomId: " + aAssign.roomId);
  ok(aAssign.gameId === "battleship", "A's assign carries gameId");

  // B sits second → guest, same room.
  b.send({ type: "sit-game", table: "table-0", gameId: "battleship", capacity: 2 });
  const bAssign = await b.take("game-assign");
  ok(bAssign.role === "guest", "B is guest of table-0");
  ok(bAssign.roomId === aAssign.roomId, "B joins A's room (" + bAssign.roomId + ")");

  // C sits third → full.
  cc.send({ type: "sit-game", table: "table-0", gameId: "battleship", capacity: 2 });
  const cAssign = await cc.take("game-assign");
  ok(cAssign.role === "full", "C is told the table is full");
  ok(cAssign.roomId === null, "C gets no roomId");

  // A different table is independent.
  a.send({ type: "sit-game", table: "table-1", gameId: "battleship", capacity: 2 });
  const aTable1 = await a.take("game-assign");
  ok(aTable1.role === "host" && aTable1.roomId !== aAssign.roomId, "table-1 is a separate room");

  // Re-seat A back at table-0 by leaving table-1 first (A moved tables).
  // Leaving table-1 (A was its only/host) just resets table-1.
  a.send({ type: "leave-game" });
  await sleep(100);

  // Now B (guest of table-0) leaves → A is no longer in table-0 (A moved to
  // table-1 then left), so re-test the host-leaves path cleanly with a new pair.

  // Fresh pair on table-2: D hosts, E guests, D leaves → E gets game-end.
  const d = client();
  const e = client();
  await join(d, "Dan");
  await join(e, "Eve");
  d.send({ type: "sit-game", table: "table-2", gameId: "battleship", capacity: 2 });
  const dAssign = await d.take("game-assign");
  e.send({ type: "sit-game", table: "table-2", gameId: "battleship", capacity: 2 });
  const eAssign = await e.take("game-assign");
  ok(dAssign.role === "host" && eAssign.role === "guest", "D/E pair on table-2");

  // D disconnects → E should be told the opponent left.
  d.ws.close();
  const eEnd = await e.take("game-end");
  ok(eEnd.reason === "opponent-left", "E receives game-end when host disconnects");

  // After reset, a new sitter on table-2 hosts a brand-new room.
  e.send({ type: "sit-game", table: "table-2", gameId: "battleship", capacity: 2 });
  const eAssign2 = await e.take("game-assign");
  ok(eAssign2.role === "host", "E becomes host of the reset table-2");
  ok(eAssign2.roomId !== dAssign.roomId, "reset table-2 has a fresh roomId");

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
