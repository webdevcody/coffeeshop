// Validates the server relay: two clients join, see each other, exchange state,
// chat, and relay a WebRTC signal. Spawns its own server. Exits non-zero on any
// failed assertion.
import { WebSocket } from "ws";
import { spawn } from "node:child_process";

const PORT = process.env.PORT || 8090;
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

function client(name) {
  const ws = new WebSocket(URL);
  const got = [];
  ws.on("message", (d) => got.push(JSON.parse(d.toString())));
  return {
    ws,
    got,
    open: () => new Promise((r) => ws.on("open", r)),
    send: (o) => ws.send(JSON.stringify(o)),
    waitFor: (type, timeout = 1500) =>
      new Promise((resolve, reject) => {
        const existing = got.find((m) => m.type === type);
        if (existing) return resolve(existing);
        const t = setTimeout(() => reject(new Error("timeout waiting for " + type)), timeout);
        ws.on("message", (d) => {
          const m = JSON.parse(d.toString());
          if (m.type === type) {
            clearTimeout(t);
            resolve(m);
          }
        });
      }),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const a = client("A");
  await a.open();
  a.send({ type: "join", name: "Alice", color: "#2a9d8f" });
  const welcomeA = await a.waitFor("welcome");
  ok(welcomeA.id, "A receives welcome with id " + welcomeA.id);
  ok(Array.isArray(welcomeA.players) && welcomeA.players.length === 0, "A sees empty room");

  const b = client("B");
  await b.open();
  b.send({ type: "join", name: "Bob", color: "#e76f51" });
  const welcomeB = await b.waitFor("welcome");
  ok(welcomeB.players.length === 1 && welcomeB.players[0].name === "Alice", "B sees Alice already present");

  const joinedOnA = await a.waitFor("player-joined");
  ok(joinedOnA.player.name === "Bob", "A is notified Bob joined");

  // State relay
  b.send({ type: "state", x: 3.5, z: -2, ry: 1.1, moving: true });
  const stateOnA = await a.waitFor("state");
  ok(Math.abs(stateOnA.x - 3.5) < 0.01 && stateOnA.id === welcomeB.id, "A receives Bob's movement");

  // Chat relay (sender also receives, per server broadcast)
  a.send({ type: "chat", text: "hello bob!" });
  const chatOnB = await b.waitFor("chat");
  ok(chatOnB.text === "hello bob!" && chatOnB.name === "Alice", "B receives Alice's chat");

  // Signal relay (WebRTC)
  a.send({ type: "signal", to: welcomeB.id, data: { kind: "hello" } });
  const sigOnB = await b.waitFor("signal");
  ok(sigOnB.from === welcomeA.id && sigOnB.data.kind === "hello", "B receives relayed signal from A");

  // Disconnect → player-left
  a.ws.close();
  const leftOnB = await b.waitFor("player-left");
  ok(leftOnB.id === welcomeA.id, "B is notified Alice left");

  b.ws.close();
  await sleep(100);
} catch (err) {
  ok(false, "exception: " + err.message);
}

const failed = results.filter((r) => !r.cond).length;
console.log(`\n${results.length - failed}/${results.length} assertions passed`);
process.exit(failed ? 1 : 0);
