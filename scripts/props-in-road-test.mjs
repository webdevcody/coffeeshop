// Geometry self-test: no SOLID street prop (lamp post, hydrant, mailbox, planter,
// newspaper box …) may stand inside a drivable road lane. This is the automated
// guard for the "poles in the middle of the road" class of bug — the roadside
// props line the kerbs (x = avenue ± ~7.4, just outside their own 6 m half-lane)
// but march down Z/across X, so without a guard they land squarely in a
// PERPENDICULAR lane wherever the step coincides with z≈35/95/155/215 (avenues)
// or x≈-60/0/60 (cross streets).
//
// Runs headless in plain Node — it stubs a no-op <canvas> so cityStreets.js's
// CanvasTexture calls succeed, then calls buildStreets() and inspects the real
// collider AABBs it returns. Parked cars (which intentionally hug the lane edge)
// are excluded by footprint size; everything small that sits in a lane fails.

// --- Minimal DOM/canvas stub so `new THREE.CanvasTexture(canvas)` works in Node. ---
const ctxProxy = new Proxy({}, { get: () => () => {}, set: () => true });
const makeCanvas = () => ({ width: 0, height: 0, getContext: () => ctxProxy });
globalThis.document = { createElement: (tag) => (tag === "canvas" ? makeCanvas() : {}) };

const { buildStreets } = await import("../src/world/cityStreets.js");

// Road grid (mirrors the constants in cityStreets.js).
const NEAR = 13, FAR = 277, LEFT = -122, RIGHT = 122, HALFR = 6;
const VROADS = [-60, 0, 60];
const HROADS = [35, 95, 155, 215];

const { colliders } = buildStreets();

const offenders = [];
for (const c of colliders) {
  const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
  const hx = (c.maxX - c.minX) / 2, hz = (c.maxZ - c.minZ) / 2;
  // Only small footprints are "poles/boxes". Parked cars (hx>=1.0, hl>=2.2)
  // deliberately park at the lane edge, so they're not violations.
  if (hx >= 0.9 || hz >= 0.9) continue;
  let lane = null, depth = 0;
  for (const ax of VROADS) {
    const d = Math.abs(cx - ax);
    if (d < HALFR && cz > NEAR && cz < FAR && HALFR - d > depth) { lane = `avenue x=${ax}`; depth = HALFR - d; }
  }
  for (const hzr of HROADS) {
    const d = Math.abs(cz - hzr);
    if (d < HALFR && cx > LEFT && cx < RIGHT && HALFR - d > depth) { lane = `cross z=${hzr}`; depth = HALFR - d; }
  }
  if (lane) offenders.push({ x: +cx.toFixed(1), z: +cz.toFixed(1), lane, depthIntoLane: +depth.toFixed(1) });
}

const total = colliders.length;
if (offenders.length) {
  console.log(`✗ ${offenders.length} solid prop(s) standing inside a road lane (of ${total} colliders):`);
  for (const o of offenders) console.log(`   pole at (${o.x}, ${o.z}) is ${o.depthIntoLane} m into ${o.lane}`);
  process.exit(1);
}
console.log(`✓ No props in road lanes (checked ${total} street-prop colliders against ${VROADS.length} avenues + ${HROADS.length} cross streets)`);
process.exit(0);
