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

  // C sits third → spectator of the in-progress match (same game + room).
  cc.send({ type: "sit-game", table: "table-0" });
  const cAssign = await cc.take("game-assign");
  ok(cAssign.role === "spectator", "C spectates the full table");
  ok(cAssign.gameId === "connect4", "C spectates the host's chosen game");
  ok(cAssign.roomId === aGame.roomId, "C watches A's room (" + cAssign.roomId + ")");

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

  // --- Spectators (table-4) -------------------------------------------------
  // Once both player seats are taken, extra sitters become spectators of the
  // running match: they receive the same game + room, sitting before or after
  // the host picks, and leaving never disturbs the players.
  const sh = client(); // host
  const sg = client(); // guest
  const s1 = client(); // spectator who sits before the host picks
  const s2 = client(); // spectator who sits after the match is running
  await join(sh, "Sam");
  await join(sg, "Gus");
  await join(s1, "Spec1");
  await join(s2, "Spec2");

  sh.send({ type: "sit-game", table: "table-4" });
  await sh.take("game-assign"); // host (no game yet)
  sg.send({ type: "sit-game", table: "table-4" });
  await sg.take("game-assign"); // guest (no game yet)

  // A third sitter before the host picks is a spectator with no game yet.
  s1.send({ type: "sit-game", table: "table-4" });
  const s1Sit = await s1.take("game-assign");
  ok(s1Sit.role === "spectator" && s1Sit.gameId === null, "early spectator waits (no game yet)");

  // Host picks → the spectator is pushed the game, just like a waiting guest.
  sh.send({ type: "choose-game", table: "table-4", gameId: "checkers", capacity: 2 });
  await sh.take("game-assign"); // host's locked-in assign
  await sg.take("game-assign"); // guest's locked-in assign
  const s1Game = await s1.take("game-assign");
  ok(
    s1Game.role === "spectator" && s1Game.gameId === "checkers" && typeof s1Game.roomId === "string",
    "early spectator is pushed the host's game once chosen"
  );

  // A late sitter joins straight into spectating the running match.
  s2.send({ type: "sit-game", table: "table-4" });
  const s2Game = await s2.take("game-assign");
  ok(
    s2Game.role === "spectator" && s2Game.gameId === "checkers" && s2Game.roomId === s1Game.roomId,
    "late spectator watches the same running match"
  );

  // A spectator leaving does NOT end the match for anyone else.
  s1.send({ type: "leave-game" });
  ok(await sh.expectNone("game-end"), "host keeps playing after a spectator leaves");
  ok(await s2.expectNone("game-end"), "other spectator keeps watching after one leaves");

  // The host leaving ends the match for the guest AND the remaining spectator.
  sh.send({ type: "leave-game" });
  const sgEnd = await sg.take("game-end");
  const s2End = await s2.take("game-end");
  ok(sgEnd.reason === "opponent-left", "guest is told the match ended when the host leaves");
  ok(s2End.reason === "opponent-left", "remaining spectator is told the match ended when the host leaves");

  sh.ws.close();
  sg.ws.close();
  s1.ws.close();
  s2.ws.close();
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

  // --- Multi-seat rooms (table-9) -------------------------------------------
  // A game can ask for more than two players. The host plus up to capacity-1
  // guests share one room; early sitters who became spectators (because the
  // capacity wasn't known before the host picked) are promoted into open seats.
  const m1 = client();
  const m2 = client();
  const m3 = client();
  const m4 = client();
  await join(m1, "M1");
  await join(m2, "M2");
  await join(m3, "M3");
  await join(m4, "M4");

  m1.send({ type: "sit-game", table: "table-9" });
  ok((await m1.take("game-assign")).role === "host", "M1 hosts table-9");
  // M2 + M3 sit BEFORE the host picks: capacity is still unknown (2), so M2 is a
  // guest and M3 (third seat) waits as a spectator.
  m2.send({ type: "sit-game", table: "table-9" });
  ok((await m2.take("game-assign")).role === "guest", "M2 is guest before the pick");
  m3.send({ type: "sit-game", table: "table-9" });
  ok((await m3.take("game-assign")).role === "spectator", "M3 waits as spectator before the pick (capacity unknown)");

  // Host picks a 4-player game → M3 is promoted into a player seat.
  m1.send({ type: "choose-game", table: "table-9", gameId: "ludo", capacity: 4 });
  const m1Game = await m1.take("game-assign");
  ok(m1Game.role === "host" && m1Game.gameId === "ludo", "M1 opens ludo as host");
  await m2.take("game-assign"); // guest's locked-in assign
  const m3Game = await m3.take("game-assign");
  ok(
    m3Game.role === "guest" && m3Game.roomId === m1Game.roomId,
    "M3 is promoted from spectator to guest in the same room for a 4-player game"
  );

  // M4 joins as the fourth player; a fifth sitter overflows to spectator.
  m4.send({ type: "sit-game", table: "table-9" });
  const m4Game = await m4.take("game-assign");
  ok(
    m4Game.role === "guest" && m4Game.gameId === "ludo" && m4Game.roomId === m1Game.roomId,
    "M4 is the 4th player (guest) in the same room"
  );
  const m5 = client();
  await join(m5, "M5");
  m5.send({ type: "sit-game", table: "table-9" });
  ok((await m5.take("game-assign")).role === "spectator", "a 5th sitter at a full 4-player table spectates");

  // A guest leaving a 4-player match frees their seat but does NOT end the game.
  m4.send({ type: "leave-game" });
  ok(await m1.expectNone("game-end"), "host keeps playing when a guest leaves a 4-player game");
  // The host leaving ends it for the remaining guests.
  m1.send({ type: "leave-game" });
  ok((await m2.take("game-end")).reason === "opponent-left", "host leaving a 4-player game ends it for the guests");

  m1.ws.close();
  m2.ws.close();
  m3.ws.close();
  m4.ws.close();
  m5.ws.close();
  await sleep(100);

  // --- Voice scoping: table membership is broadcast (seat-update) -----------
  // Sitting / standing at a game table tells every client who is at which table
  // so the client can scope proximity voice to table-mates.
  const va = client();
  const vb = client();
  await va.open();
  va.send({ type: "join", name: "Va" });
  const vaWelcome = await va.take("welcome");
  const vaId = vaWelcome.id;
  await vb.open();
  vb.send({ type: "join", name: "Vb" });
  await vb.take("welcome");

  va.send({ type: "sit-game", table: "table-7" });
  await va.take("game-assign");
  const vbSeat = await vb.take("seat-update");
  ok(vbSeat.id === vaId && vbSeat.table === "table-7", "sitting broadcasts table membership to others");

  va.send({ type: "leave-game" });
  const vbSeat2 = await vb.take("seat-update");
  ok(vbSeat2.id === vaId && vbSeat2.table === null, "standing broadcasts table:null to others");

  va.ws.close();
  vb.ws.close();
  await sleep(100);

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
