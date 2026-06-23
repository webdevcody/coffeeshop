// End-to-end browser validation with two headless players:
//  - page loads with no console/runtime errors
//  - 3D scene + local player initialize
//  - two players see each other (multiplayer state sync)
//  - chat propagates and renders a speech bubble on both ends
//  - WebRTC voice peers connect (fake mic)
// Spawns the server itself; exits non-zero on any failure.

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const PORT = 8099;
const BASE = `http://localhost:${PORT}`;
const SHOT = process.env.SHOT_DIR || tmpdir();

const results = [];
const ok = (cond, msg) => {
  results.push(!!cond);
  console.log((cond ? "✓ " : "✗ ") + msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ["server/server.js"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "pipe",
});
server.stderr.on("data", (d) => console.error("[server]", d.toString().trim()));

let browser;
try {
  await sleep(700);
  browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const errors = [];
  async function newPlayer(name) {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${name}] ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(`[${name}] PAGEERROR ${e.message}`));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__coffeeReady === true, { timeout: 8000 });
    return { ctx, page };
  }

  // --- Player 1 ---
  const p1 = await newPlayer("P1");
  ok(true, "Player 1 page loaded & __coffeeReady");
  const sceneChildren = await p1.page.evaluate(() => window.__coffee.scene.children.length);
  ok(sceneChildren > 3, `scene populated (${sceneChildren} top-level objects)`);

  await p1.page.click("#enter-btn");
  await p1.page.waitForFunction(() => !!window.__coffee.local, { timeout: 5000 });
  ok(true, "Player 1 joined and local character created");

  // --- Player 2 ---
  const p2 = await newPlayer("P2");
  await p2.page.click("#enter-btn");
  await p2.page.waitForFunction(() => !!window.__coffee.local, { timeout: 5000 });
  ok(true, "Player 2 joined");

  // --- Mutual visibility ---
  await p1.page.waitForFunction(() => window.__coffee.remotes.players.size >= 1, { timeout: 5000 });
  await p2.page.waitForFunction(() => window.__coffee.remotes.players.size >= 1, { timeout: 5000 });
  ok(true, "Both players see each other (remote characters spawned)");

  // --- Movement sync: move P2, confirm P1's remote of P2 moves ---
  await p2.page.evaluate(() => {
    // nudge P2 by injecting key state through the controls move vector
    window.__coffee.local.pos.x = 5;
    window.__coffee.local.pos.z = 2;
    window.__coffee.network.sendState(5, 2, 0.5, true);
  });
  const moved = await p1.page
    .waitForFunction(
      () => {
        const e = [...window.__coffee.remotes.players.values()][0];
        return e && Math.abs(e.target.x - 5) < 0.1;
      },
      { timeout: 4000 }
    )
    .then(() => true)
    .catch(() => false);
  ok(moved, "Movement from P2 syncs to P1");

  // --- Chat propagation + bubble ---
  await p1.page.fill("#chat-input", "morning everyone");
  await p1.page.press("#chat-input", "Enter");
  const chatSeen = await p2.page
    .waitForFunction(() => document.querySelector("#chat-log")?.textContent.includes("morning everyone"), {
      timeout: 4000,
    })
    .then(() => true)
    .catch(() => false);
  ok(chatSeen, "Chat from P1 appears in P2's chat log");
  await sleep(200);
  const bubbleP2 = await p2.page.evaluate(() => document.querySelectorAll(".chat-bubble").length);
  ok(bubbleP2 >= 1, `Speech bubble rendered above P1 in P2's view (${bubbleP2})`);

  // --- Voice (WebRTC) ---
  await p1.page.click("#voice-btn");
  await p2.page.click("#voice-btn");
  const voiced = await p1.page
    .waitForFunction(() => window.__coffee.voice.peers.size >= 1, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  ok(voiced, "Voice peer connection established between players");
  if (voiced) {
    await sleep(1500);
    const state = await p1.page.evaluate(() => {
      const peer = [...window.__coffee.voice.peers.values()][0];
      return peer ? peer.pc.connectionState || peer.pc.iceConnectionState : "none";
    });
    ok(["connected", "completed", "connecting", "checking"].includes(state), `RTCPeerConnection state: ${state}`);
  }

  // --- People panel: mute an individual person ---
  // Open P1's People panel and toggle mute on the first listed person (P2).
  await p1.page.click("#people-btn");
  const muteShown = await p1.page
    .waitForFunction(() => document.querySelectorAll("#people-list .mute-btn").length >= 1, { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  ok(muteShown, "People panel lists other people with a mute toggle");

  const remoteId = await p1.page.evaluate(() => [...window.__coffee.remotes.players.keys()][0]);
  await p1.page.click("#people-list .mute-btn");
  const muted = await p1.page
    .waitForFunction(
      (id) => {
        const v = window.__coffee.voice;
        const peer = v.peers.get(id);
        return v.isMuted(id) && (!peer || peer.audio.muted === true);
      },
      remoteId,
      { timeout: 3000 }
    )
    .then(() => true)
    .catch(() => false);
  ok(muted, "Clicking mute silences that person's audio (isMuted + audio.muted)");

  // Toggling again unmutes.
  await p1.page.click("#people-list .mute-btn");
  const unmuted = await p1.page
    .waitForFunction((id) => !window.__coffee.voice.isMuted(id), remoteId, { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  ok(unmuted, "Clicking again unmutes that person");

  // --- Walking + collision (keyboard input → movement → collision) ---
  // Drop P1 at room center facing the back counter, then hold W. The player
  // should travel forward (-z) and be stopped by the counter, not tunnel through.
  await p1.page.evaluate(() => {
    window.__coffee.local.pos.x = 0;
    window.__coffee.local.pos.z = 0;
  });
  await p1.page.bringToFront();
  await p1.page.keyboard.down("w");
  await sleep(2500);
  await p1.page.keyboard.up("w");
  await sleep(150);
  const after = await p1.page.evaluate(() => ({
    x: window.__coffee.local.pos.x,
    z: window.__coffee.local.pos.z,
  }));
  ok(after.z < -3, `Holding W walks the player forward (z ${after.z.toFixed(2)} from 0)`);
  ok(after.z > -9.1, `Counter collision stops the player (z ${after.z.toFixed(2)}, didn't tunnel through)`);
  ok(Math.abs(after.x) < 13, `Player stayed inside the room (x ${after.x.toFixed(2)})`);

  // --- Screenshot for a visual sanity check ---
  await p1.page.screenshot({ path: `${SHOT}/coffeeshop-p1.png` });
  await p2.page.screenshot({ path: `${SHOT}/coffeeshop-p2.png` });
  ok(true, "Screenshots captured");

  // --- Leaving cleans up the departed player's label DOM ---
  const labelsBefore = await p1.page.evaluate(() => document.querySelectorAll(".name-label").length);
  await p2.ctx.close();
  const left = await p1.page
    .waitForFunction(() => window.__coffee.remotes.players.size === 0, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  ok(left, "P1 sees P2 leave (remote character removed)");
  await sleep(200);
  const labelsAfter = await p1.page.evaluate(() => document.querySelectorAll(".name-label").length);
  ok(labelsAfter === 1, `Departed player's label DOM cleaned up (${labelsBefore} → ${labelsAfter}, only local remains)`);

  // --- No runtime errors ---
  ok(errors.length === 0, `No console/runtime errors (${errors.length})`);
  if (errors.length) errors.slice(0, 12).forEach((e) => console.log("   " + e));
} catch (err) {
  ok(false, "exception: " + err.message);
  console.error(err);
} finally {
  if (browser) await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
