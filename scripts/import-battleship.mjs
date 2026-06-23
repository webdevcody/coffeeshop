// Imports a Battleship static build into public/games/battleship/ and applies the
// two surgical patches that let the café drive it (host a fixed room code via the
// URL hash). Idempotent: re-running re-copies and re-patches cleanly.
//
// Usage:
//   node scripts/import-battleship.mjs [SOURCE_DIR]
//
// SOURCE_DIR is a Vite `dist`-style build (index.html + assets/). If omitted, the
// script probes the usual sibling locations for a `battleship(s)` build. After a
// new Battleship build, just re-run this.
//
// The patches (the bundle is minified, so we match exact substrings):
//   1. `hf()` (room-code generator) returns globalThis.__bsForceCode when set,
//      so the host can be forced onto a specific code instead of a random one.
//   2. The app constructor reads `#host=<CODE>` from the hash and auto-hosts that
//      code (mirroring the stock `#join=<CODE>` auto-join), setting __bsForceCode.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const destDir = path.join(repoRoot, "public", "games", "battleship");

function resolveSource() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  // Probe the usual sibling spots for a battleship(s) build.
  const candidates = [
    path.join(repoRoot, "..", "battleship"),
    path.join(repoRoot, "..", "battleships"),
    path.join(repoRoot, "..", "..", "battleship"),
    path.join(repoRoot, "..", "..", "battleships"),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, "index.html"))) || candidates[0];
}

const srcDir = resolveSource();

if (!fs.existsSync(path.join(srcDir, "index.html"))) {
  console.error(`No index.html found. Pass the build dir explicitly: node scripts/import-battleship.mjs <SOURCE_DIR>`);
  process.exit(1);
}

// --- Copy index.html + assets/ ---------------------------------------------
fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(path.join(destDir, "assets"), { recursive: true });
fs.copyFileSync(path.join(srcDir, "index.html"), path.join(destDir, "index.html"));
for (const name of fs.readdirSync(path.join(srcDir, "assets"))) {
  if (name === ".DS_Store") continue;
  fs.copyFileSync(path.join(srcDir, "assets", name), path.join(destDir, "assets", name));
}
console.log(`Copied build from ${srcDir} -> ${destDir}`);

// --- Patch the JS bundle ----------------------------------------------------
const bundle = fs
  .readdirSync(path.join(destDir, "assets"))
  .find((n) => n.endsWith(".js"));
if (!bundle) {
  console.error("No JS bundle found in assets/");
  process.exit(1);
}
const bundlePath = path.join(destDir, "assets", bundle);
let src = fs.readFileSync(bundlePath, "utf8");

const edits = [
  {
    name: "hf force-code",
    find: `function hf(i=5){let e="";const t=crypto.getRandomValues(new Uint8Array(i));for(let n=0;n<i;n++)e+=$c[t[n]%$c.length];return e}`,
    replace: `function hf(i=5){if(globalThis.__bsForceCode)return globalThis.__bsForceCode;let e="";const t=crypto.getRandomValues(new Uint8Array(i));for(let n=0;n<i;n++)e+=$c[t[n]%$c.length];return e}`,
  },
  {
    name: "constructor #host= auto-host",
    find: `const n=this.readInvite();this.showMenu(),n&&this.beginJoin(n)`,
    replace: `const n=this.readInvite();this.showMenu();const __bh=location.hash.replace(/^#/,"");if(__bh.startsWith("host=")){globalThis.__bsForceCode=__bh.slice(5).toUpperCase();this.beginHost()}else if(n){this.beginJoin(n)}`,
  },
];

for (const e of edits) {
  if (src.includes(e.replace)) {
    console.log(`SKIP (already applied): ${e.name}`);
    continue;
  }
  const count = src.split(e.find).length - 1;
  if (count !== 1) {
    console.error(`Expected exactly 1 match for "${e.name}", found ${count}. The build may have changed — re-derive the patch.`);
    process.exit(1);
  }
  src = src.replace(e.find, e.replace);
  console.log(`OK: ${e.name}`);
}

fs.writeFileSync(bundlePath, src);
console.log(`Patched ${path.relative(repoRoot, bundlePath)} — done.`);
