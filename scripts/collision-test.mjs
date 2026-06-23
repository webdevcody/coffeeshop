// Unit tests for the pure collision resolver (no DOM/WebGL needed).
import { resolveCollisions } from "../src/world/collision.js";

const results = [];
const ok = (cond, msg) => {
  results.push(!!cond);
  console.log((cond ? "✓ " : "✗ ") + msg);
};
const approx = (a, b, e = 1e-6) => Math.abs(a - b) < e;

const box = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }];
const R = 0.5;

// 1. Far away → unchanged.
let r = resolveCollisions(5, 5, R, box);
ok(approx(r.x, 5) && approx(r.z, 5), "circle far from box is untouched");

// 2. Approaching from +z, overlapping the top edge → pushed out to maxZ + R.
r = resolveCollisions(0, 1.2, R, box); // center 1.2, box top 1.0, gap 0.2 < R
ok(approx(r.z, 1.5) && approx(r.x, 0), `pushed out along +z to ${r.z.toFixed(2)} (expected 1.50)`);

// 3. Center inside the box → ejected to nearest face (here +x, since 0.9 is closest to maxX).
r = resolveCollisions(0.9, 0, R, box);
ok(approx(r.x, 1.5), `inside box ejected to +x face at ${r.x.toFixed(2)} (expected 1.50)`);

// 4. Corner approach → pushed out diagonally, ending at radius distance from corner.
r = resolveCollisions(1.2, 1.2, R, box); // near corner (1,1)
const dCorner = Math.hypot(r.x - 1, r.z - 1);
ok(approx(dCorner, R, 1e-6), `corner push keeps radius distance (${dCorner.toFixed(3)} vs ${R})`);

// 5. Just outside radius → unchanged.
r = resolveCollisions(0, 1.6, R, box); // gap 0.6 > R
ok(approx(r.z, 1.6), "circle just outside radius is untouched");

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} collision assertions passed`);
process.exit(failed ? 1 : 0);
