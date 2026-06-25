// Reusable screenshot harness for the cafe/city. Joins the world headlessly, then
// for each waypoint teleports the player there (optionally driving the car a beat so
// the chase cam looks forward down the street) and saves a PNG. Used to visually
// review city/render changes.
//
// Usage:
//   node scripts/shoot.mjs                         # default city review set
//   node scripts/shoot.mjs '[{"name":"x","x":-30,"z":65}]'   # custom waypoints -> OUT/x.png
//   OUT=... BASE=http://localhost:8080 to override output dir / server.
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:8080";
const OUT = process.env.OUT || ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT = [
  { name: "shot_approach", x: 2, z: 30, drive: true },     // main avenue from the cafe
  { name: "shot_skatepark", x: -30, z: 65 },
  { name: "shot_downtown", x: -90, z: 125 },
  { name: "shot_nightlife", x: 90, z: 245 },
  { name: "shot_market", x: 30, z: 65 },
];
let waypoints = DEFAULT;
if (process.argv[2]) { try { waypoints = JSON.parse(process.argv[2]); } catch { console.log("bad waypoints json"); } }

const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__coffeeReady === true, { timeout: 15000 });
  await page.fill("#name-input", "Cam");
  await page.click("#enter-btn");
  await page.waitForFunction(() => !!window.__coffee.local, { timeout: 8000 });
  await sleep(600);
  for (const w of waypoints) {
    await page.evaluate((p) => {
      const L = window.__coffee.local;
      // exit any ride first
      if (window.__coffee.rides.mode !== "walk") { /* leave it; teleport overrides */ }
      L.pos.x = p.x; L.pos.z = p.z; L.character.group.position.set(p.x, 0, p.z);
    }, w);
    await sleep(300);
    if (w.drive) {
      await page.keyboard.press("e"); await sleep(250);
      await page.keyboard.down("w"); await sleep(1600); await page.keyboard.up("w");
      await sleep(200);
    }
    await page.screenshot({ path: `${OUT}/${w.name}.png` });
    if (w.drive) { await page.keyboard.press("e"); await sleep(250); }
    console.log("shot", w.name);
  }
  if (errs.length) console.log("PAGE ERRORS:", errs.slice(0, 5));
} catch (e) { console.log("SHOOT ERR:", e.message); } finally { await browser.close(); }
