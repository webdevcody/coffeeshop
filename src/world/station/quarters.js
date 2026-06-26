// STATION QUARTERS — a cozy CREW QUARTERS module that bolts onto the orbital space
// station's interior deck (the one space.js floats at world y=260). It is a SEPARATE,
// self-contained set piece: call buildStationQuarters({ ox, oz, floorY }) and add the
// returned `group` straight to the scene; register `ground` as a walkable deck rect and
// `colliders` as solid AABBs, exactly like the station interior contract in space.js.
//
// What's inside (all LOCAL to the group, which is parked at world (ox, floorY, oz) so
// the deck surface is local y=0):
//   • Two TIERS of capsule SLEEPING PODS along the back wall — recessed bunks with a
//     glowing interior strip light that BREATHES, a little round window on the back, a
//     pillow + rumpled blanket, a warm reading light, and a name plate. Cozy clutter.
//   • A bank of personal LOCKERS with name labels, vents, handles + stuck-on stickers.
//   • A LOUNGE NOOK in the corner: a warm-fabric couch with cushions, a coffee table
//     with a mug + books, a wall-mounted SCREEN that FLICKERS, a floor lamp, a potted
//     plant, a warm rug, and a wall of hanging personal PHOTOS.
//   • A round PORTHOLE on the far wall looking onto a field of stars that slowly DRIFTS,
//     with a cushioned window bench beneath it.
//   • Warm ceiling glow strips for soft ambient light, metal-vs-fabric contrast all over.
//
// ── ALLOCATION DISCIPLINE ─────────────────────────────────────────────────────
// All work is done at build time (free to allocate). update(dt) only mutates cached
// material scalars + one group rotation on small handle lists — no `new` per frame.

import * as THREE from "three";

// ── Shared materials (created ONCE at module scope) ───────────────────────────
const deckMat       = new THREE.MeshStandardMaterial({ color: "#34383f", roughness: 0.72, metalness: 0.45 });
const wallMat       = new THREE.MeshStandardMaterial({ color: "#bdb2a2", roughness: 0.6, metalness: 0.18, side: THREE.DoubleSide });
const wallTrimMat   = new THREE.MeshStandardMaterial({ color: "#5a626b", roughness: 0.45, metalness: 0.65 });
const ceilMat       = new THREE.MeshStandardMaterial({ color: "#9a958c", roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
const ceilGlowMat   = new THREE.MeshStandardMaterial({ color: "#fff0d6", roughness: 0.3, emissive: "#ffd49a", emissiveIntensity: 0.85 });
const podShellMat   = new THREE.MeshStandardMaterial({ color: "#9aa1a9", roughness: 0.45, metalness: 0.55 });
const podShellDark  = new THREE.MeshStandardMaterial({ color: "#6c747d", roughness: 0.55, metalness: 0.5 });
const podLinerMat   = new THREE.MeshStandardMaterial({ color: "#d8c4a2", roughness: 0.85, metalness: 0.05 });
const winFrameMat   = new THREE.MeshStandardMaterial({ color: "#6a7178", roughness: 0.4, metalness: 0.6 });
const winGlassMat   = new THREE.MeshStandardMaterial({ color: "#0b1626", roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.5, emissive: "#13314f", emissiveIntensity: 0.3, side: THREE.DoubleSide });
const lockerMat     = new THREE.MeshStandardMaterial({ color: "#7d8893", roughness: 0.5, metalness: 0.55 });
const lockerDoorMat = new THREE.MeshStandardMaterial({ color: "#6f7a86", roughness: 0.5, metalness: 0.5 });
const ventMat       = new THREE.MeshStandardMaterial({ color: "#454c54", roughness: 0.6, metalness: 0.4 });
const handleMat     = new THREE.MeshStandardMaterial({ color: "#c9cdd2", roughness: 0.35, metalness: 0.75 });
const labelMat      = new THREE.MeshStandardMaterial({ color: "#0a1c2c", roughness: 0.4, emissive: "#39c4ff", emissiveIntensity: 0.7 });
const couchMat      = new THREE.MeshStandardMaterial({ color: "#8a4b3a", roughness: 0.95, metalness: 0.0 });
const couchCushMat  = new THREE.MeshStandardMaterial({ color: "#caa066", roughness: 0.95, metalness: 0.0 });
const couchAccMat   = new THREE.MeshStandardMaterial({ color: "#3a6b6b", roughness: 0.95, metalness: 0.0 });
const screenFrameMat= new THREE.MeshStandardMaterial({ color: "#1b1f24", roughness: 0.4, metalness: 0.5 });
const tableMat      = new THREE.MeshStandardMaterial({ color: "#7a5a3c", roughness: 0.7, metalness: 0.1 });
const tableTopMat   = new THREE.MeshStandardMaterial({ color: "#9a7c5a", roughness: 0.5, metalness: 0.3 });
const rugMat        = new THREE.MeshStandardMaterial({ color: "#7a3b2e", roughness: 0.98, metalness: 0.0 });
const rugStripeMat  = new THREE.MeshStandardMaterial({ color: "#a8623f", roughness: 0.98, metalness: 0.0 });
const runnerMat     = new THREE.MeshStandardMaterial({ color: "#4a5a52", roughness: 0.98, metalness: 0.0 });
const pillowMat     = new THREE.MeshStandardMaterial({ color: "#efe2c8", roughness: 0.95, metalness: 0.0 });
const pillowAccMat  = new THREE.MeshStandardMaterial({ color: "#c47a86", roughness: 0.95, metalness: 0.0 });
const blanketMat    = new THREE.MeshStandardMaterial({ color: "#c0764a", roughness: 0.97, metalness: 0.0 });
const blanketAltMat = new THREE.MeshStandardMaterial({ color: "#4f6f64", roughness: 0.97, metalness: 0.0 });
const frameWoodMat  = new THREE.MeshStandardMaterial({ color: "#caa46a", roughness: 0.75, metalness: 0.05 });
const photoA        = new THREE.MeshStandardMaterial({ color: "#6fae9c", roughness: 0.6, metalness: 0.0, emissive: "#2a4a44", emissiveIntensity: 0.15 });
const photoB        = new THREE.MeshStandardMaterial({ color: "#c79a6a", roughness: 0.6, metalness: 0.0, emissive: "#4a3420", emissiveIntensity: 0.15 });
const photoC        = new THREE.MeshStandardMaterial({ color: "#8a7fb0", roughness: 0.6, metalness: 0.0, emissive: "#322a4a", emissiveIntensity: 0.15 });
const plantPotMat   = new THREE.MeshStandardMaterial({ color: "#9c5a3c", roughness: 0.8, metalness: 0.05 });
const plantMat      = new THREE.MeshStandardMaterial({ color: "#3f7a44", roughness: 0.85, metalness: 0.0 });
const mugMat        = new THREE.MeshStandardMaterial({ color: "#d8d2c4", roughness: 0.6, metalness: 0.1 });
const bookA         = new THREE.MeshStandardMaterial({ color: "#9c4030", roughness: 0.8, metalness: 0.0 });
const bookB         = new THREE.MeshStandardMaterial({ color: "#36617a", roughness: 0.8, metalness: 0.0 });
const bookC         = new THREE.MeshStandardMaterial({ color: "#caa83a", roughness: 0.8, metalness: 0.0 });
const slipperMat    = new THREE.MeshStandardMaterial({ color: "#3a6b6b", roughness: 0.95, metalness: 0.0 });
const lampPoleMat   = new THREE.MeshStandardMaterial({ color: "#52585f", roughness: 0.4, metalness: 0.7 });
const portholeOut   = new THREE.MeshStandardMaterial({ color: "#7a828b", roughness: 0.4, metalness: 0.6 });
const spaceBackMat  = new THREE.MeshBasicMaterial({ color: "#04060f" });

// Strip-light accent palette (cozy warm + a couple of cool accents). Each pod gets its
// OWN cloned material instance so it can breathe on its own phase.
const STRIP_COLORS = ["#ffe6c0", "#ffc870", "#bfe8ff", "#cfeecf", "#ffd0b0", "#d8c8ff"];

// Shared small geometries reused across many props (build-time tidy; not per-frame).
const G = {
  winTorus:  new THREE.TorusGeometry(0.3, 0.06, 8, 16),
  winGlass:  new THREE.CircleGeometry(0.27, 16),
  readBulb:  new THREE.SphereGeometry(0.07, 8, 6),
  handle:    new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8),
  mugBody:   new THREE.CylinderGeometry(0.1, 0.08, 0.18, 10),
  plantBush: new THREE.SphereGeometry(0.32, 10, 8),
};

function mesh(geo, mat, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function box(w, h, d, mat, cast = true, receive = true) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, cast, receive);
}

export function buildStationQuarters(opts = {}) {
  const ox = opts.ox ?? 472;
  const oz = opts.oz ?? 130;
  const floorY = opts.floorY ?? 260;

  const group = new THREE.Group();
  group.name = "stationQuarters";
  group.position.set(ox, floorY, oz);

  // Footprint: local X in [-19,19] (w 38), local Z in [-16,16] (d 32). Deck top = y 0.
  const HX = 19, HZ = 16, ROOM_H = 4.4;

  // ── Returned contract ──────────────────────────────────────────────────────
  const ground = [{ minX: ox - HX, maxX: ox + HX, minZ: oz - HZ, maxZ: oz + HZ }];
  const colliders = [];
  // Add a TIGHT world-space AABB for a solid prop centred at LOCAL (cx, cz).
  const solid = (cx, cz, w, d) =>
    colliders.push({ minX: ox + cx - w / 2, maxX: ox + cx + w / 2, minZ: oz + cz - d / 2, maxZ: oz + cz + d / 2 });

  // Animated handles (mutated allocation-free in update()).
  const podStrips = [];  // { mat, base, amp, rate, phase }  breathing interior strips
  const readLights = []; // { mat, base, amp, rate, phase }  soft warm reading lights
  const screens = [];    // { mat, base, rate, phase }       flickering screens
  let starField = null;  // THREE.Points group child for the slow porthole drift

  // ── DECK + CEILING ─────────────────────────────────────────────────────────
  const deck = box(2 * HX, 0.3, 2 * HZ, deckMat, false, true);
  deck.position.set(0, -0.15, 0);
  group.add(deck);
  const ceil = box(2 * HX, 0.3, 2 * HZ, ceilMat, false, false);
  ceil.position.set(0, ROOM_H + 0.15, 0);
  group.add(ceil);
  // Warm ceiling glow strips for soft ambient reading light.
  for (const gx of [-12, 0, 12]) {
    const strip = box(9, 0.06, 0.6, ceilGlowMat, false, false);
    strip.position.set(gx, ROOM_H - 0.06, 0);
    group.add(strip);
  }
  for (const gz of [-9, 9]) {
    const strip = box(0.6, 0.06, 9, ceilGlowMat, false, false);
    strip.position.set(0, ROOM_H - 0.06, gz);
    group.add(strip);
  }

  // Floor accents: a warm runner down the aisle.
  const runner = box(4, 0.04, 22, runnerMat, false, true);
  runner.position.set(0, 0.02, 0);
  group.add(runner);

  // ── PERIMETER WALLS (cosmetic) + their colliders ───────────────────────────
  // +Z wall (behind the pods).
  const wallPZ = box(2 * HX, ROOM_H, 0.3, wallMat, false, true);
  wallPZ.position.set(0, ROOM_H / 2, HZ - 0.15);
  group.add(wallPZ);
  solid(0, HZ - 0.15, 2 * HX, 0.3);
  // -Z wall (lockers + lounge live in front of it).
  const wallNZ = box(2 * HX, ROOM_H, 0.3, wallMat, false, true);
  wallNZ.position.set(0, ROOM_H / 2, -HZ + 0.15);
  group.add(wallNZ);
  solid(0, -HZ + 0.15, 2 * HX, 0.3);
  // -X wall — OPENED into one continuous hall. Only short corner stubs at the ±Z ends
  // remain, leaving a ~19 m full-height central gap so you see straight into the next
  // zone (was a narrow 4.4 m doorway; old header + jambs removed for a clean open span).
  for (const [cz, d] of [[-12.75, 6.5], [12.75, 6.5]]) {
    const w = box(0.3, ROOM_H, d, wallMat, false, true);
    w.position.set(-HX + 0.15, ROOM_H / 2, cz);
    group.add(w);
    solid(-HX + 0.15, cz, 0.3, d);
  }

  // +X wall — OPENED to match. A plain corner stub at -Z and, at +Z, a PORTHOLE PILLAR
  // that still carries the round porthole (re-anchored off the central walkway). Between
  // them is a ~19 m full-height gap so you see straight into the next zone.
  const wxX = HX - 0.15;
  const PORT_Z = 12.75;                          // porthole re-anchored onto the +Z pillar
  const stubNZ = box(0.3, ROOM_H, 6.5, wallMat, false, true);
  stubNZ.position.set(wxX, ROOM_H / 2, -12.75);  // -Z corner stub
  group.add(stubNZ);
  solid(wxX, -12.75, 0.3, 6.5);
  // +Z PORTHOLE PILLAR in 4 pieces around the porthole hole (z±1 of PORT_Z, y[1.4,3.4]).
  const pillarSegs = [
    { cy: 0.7, h: 1.4, cz: PORT_Z,         d: 6.5 },  // sill strip below porthole
    { cy: 3.9, h: 1.0, cz: PORT_Z,         d: 6.5 },  // header strip above porthole
    { cy: 2.4, h: 2.0, cz: PORT_Z - 2.125, d: 2.25 }, // -Z jamb of porthole hole
    { cy: 2.4, h: 2.0, cz: PORT_Z + 2.125, d: 2.25 }, // +Z jamb of porthole hole
  ];
  for (const s of pillarSegs) {
    const w = box(0.3, s.h, s.d, wallMat, false, true);
    w.position.set(wxX, s.cy, s.cz);
    group.add(w);
  }
  solid(wxX, PORT_Z, 0.3, 6.5); // collider for the porthole pillar only

  // ── SLEEPING PODS — 4 columns x 2 tiers along the +Z wall, facing the aisle ──
  // Each bunk is recessed against the back wall with its open face toward -Z.
  const POD_X = [-13.5, -4.5, 4.5, 13.5];
  const POD_W = 4.2;
  const POD_D = 3.1;
  const POD_H = 1.78;
  const backZ = HZ - 0.45;        // back panel z (just inside the +Z wall)
  const frontZ = backZ - POD_D;   // open face toward the aisle
  let podIdx = 0;
  for (const cx of POD_X) {
    for (const tier of [0, 1]) {
      const baseY = 0.25 + tier * (POD_H + 0.22);
      const midZ = backZ - POD_D / 2;
      const accent = STRIP_COLORS[podIdx % STRIP_COLORS.length];

      // Shell: back, top + side dividers + a warm liner floor.
      const back = box(POD_W, POD_H, 0.1, podShellDark, true, false);
      back.position.set(cx, baseY + POD_H / 2, backZ);
      group.add(back);
      const top = box(POD_W, 0.12, POD_D, podShellMat, true, false);
      top.position.set(cx, baseY + POD_H, midZ);
      group.add(top);
      const liner = box(POD_W - 0.2, 0.1, POD_D - 0.2, podLinerMat, false, true);
      liner.position.set(cx, baseY + 0.05, midZ);
      group.add(liner);
      for (const sx of [-1, 1]) {
        const div = box(0.12, POD_H, POD_D, podShellMat, true, false);
        div.position.set(cx + sx * POD_W / 2, baseY + POD_H / 2, midZ);
        group.add(div);
      }
      // A small front lip so the opening reads as a capsule mouth.
      const lip = box(POD_W, 0.16, 0.12, podShellMat, true, false);
      lip.position.set(cx, baseY + 0.08, frontZ);
      group.add(lip);

      // Breathing interior STRIP LIGHT along the inside top edge.
      const sMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.3, emissive: accent, emissiveIntensity: 0.9 });
      const strip = box(POD_W - 0.7, 0.05, 0.5, sMat, false, false);
      strip.position.set(cx, baseY + POD_H - 0.12, frontZ + 0.35);
      group.add(strip);
      podStrips.push({ mat: sMat, base: 0.85, amp: 0.55, rate: 0.7 + (podIdx % 5) * 0.13, phase: podIdx * 1.1 });

      // Little round WINDOW on the back panel (frame + faintly glowing glass).
      const wf = mesh(G.winTorus, winFrameMat, false, false);
      wf.position.set(cx, baseY + POD_H * 0.6, backZ - 0.06);
      group.add(wf);
      const wg = mesh(G.winGlass, winGlassMat, false, false);
      wg.position.set(cx, baseY + POD_H * 0.6, backZ - 0.05);
      group.add(wg);

      // Warm READING LIGHT in a front corner (own material, gently breathes).
      const rMat = new THREE.MeshStandardMaterial({ color: "#ffd9b0", roughness: 0.4, emissive: "#ffb877", emissiveIntensity: 1.0 });
      const bulb = mesh(G.readBulb, rMat, false, false);
      bulb.position.set(cx + POD_W * 0.33, baseY + POD_H - 0.18, frontZ + 0.4);
      group.add(bulb);
      readLights.push({ mat: rMat, base: 0.95, amp: 0.35, rate: 1.1 + (podIdx % 4) * 0.2, phase: podIdx * 2.3 });

      // Bedding: pillow at the back + a rumpled blanket toward the foot.
      const pil = box(POD_W * 0.46, 0.2, 0.5, podIdx % 2 ? pillowAccMat : pillowMat, false, true);
      pil.position.set(cx - POD_W * 0.18, baseY + 0.22, backZ - 0.55);
      pil.rotation.y = 0.18;
      group.add(pil);
      const blkt = box(POD_W - 0.5, 0.12, POD_D * 0.55, podIdx % 2 ? blanketAltMat : blanketMat, false, true);
      blkt.position.set(cx, baseY + 0.18, midZ - POD_D * 0.12);
      blkt.rotation.y = (podIdx % 3 - 1) * 0.06;
      group.add(blkt);

      // Name plate beside the opening.
      const plate = box(0.7, 0.22, 0.05, labelMat, false, false);
      plate.position.set(cx + POD_W / 2 - 0.5, baseY + POD_H - 0.2, frontZ - 0.02);
      group.add(plate);

      podIdx++;
    }
  }
  // One tight collider band hugging the whole pod bay (solid bunks).
  solid(0, backZ - POD_D / 2 + 0.05, POD_W * 4 + 0.4, POD_D + 0.2);

  // A pair of slippers + a stray book on the deck by the lower-left pod (personality).
  for (const dx of [-0.2, 0.2]) {
    const slip = box(0.28, 0.1, 0.6, slipperMat, true, true);
    slip.position.set(POD_X[0] + dx, 0.05, frontZ - 0.8);
    group.add(slip);
  }
  const floorBook = box(0.5, 0.12, 0.7, bookB, true, true);
  floorBook.position.set(POD_X[1] - 0.4, 0.08, frontZ - 0.9);
  floorBook.rotation.y = 0.4;
  group.add(floorBook);

  // ── LOCKERS — a bank along the -Z wall (left side) ─────────────────────────
  const LOCK_X = [-15.5, -13.2, -10.9, -8.6, -6.3, -4.0];
  const LOCK_H = 2.7;
  const lockBackZ = -HZ + 0.45;
  for (let i = 0; i < LOCK_X.length; i++) {
    const cx = LOCK_X[i];
    const body = box(2.0, LOCK_H, 0.85, lockerMat, true, true);
    body.position.set(cx, LOCK_H / 2, lockBackZ + 0.1);
    group.add(body);
    const door = box(1.8, LOCK_H - 0.2, 0.06, lockerDoorMat, true, false);
    door.position.set(cx, LOCK_H / 2, lockBackZ + 0.55);
    group.add(door);
    // Vent slits near the top.
    for (const vy of [LOCK_H - 0.35, LOCK_H - 0.55, LOCK_H - 0.75]) {
      const vent = box(1.2, 0.05, 0.02, ventMat, false, false);
      vent.position.set(cx, vy, lockBackZ + 0.585);
      group.add(vent);
    }
    // Handle.
    const handle = mesh(G.handle, handleMat, true, false);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(cx + 0.7, LOCK_H * 0.5, lockBackZ + 0.59);
    group.add(handle);
    // Name label + a stuck-on coloured sticker for personality.
    const lbl = box(1.0, 0.26, 0.04, labelMat, false, false);
    lbl.position.set(cx, LOCK_H - 0.25, lockBackZ + 0.59);
    group.add(lbl);
    const sticker = box(0.34, 0.34, 0.03, [photoA, photoB, photoC][i % 3], false, false);
    sticker.position.set(cx - 0.5, LOCK_H * 0.42, lockBackZ + 0.59);
    sticker.rotation.z = (i % 2 ? 1 : -1) * 0.25;
    group.add(sticker);
  }
  solid(-9.75, lockBackZ + 0.2, 13.4, 1.05); // tight band over the locker bank

  // A hung jacket on the locker end (drape of warm fabric).
  const jacket = box(0.9, 1.3, 0.18, blanketAltMat, true, true);
  jacket.position.set(LOCK_X[LOCK_X.length - 1] + 1.4, LOCK_H - 0.7, lockBackZ + 0.6);
  group.add(jacket);

  // Hanging PHOTOS above the lockers.
  const photoMats = [photoA, photoB, photoC];
  for (let i = 0; i < 5; i++) {
    const cx = -15 + i * 2.6;
    const fr = box(0.7, 0.55, 0.05, frameWoodMat, false, false);
    fr.position.set(cx, LOCK_H + 0.9, -HZ + 0.32);
    fr.rotation.z = (i % 2 ? 1 : -1) * 0.05;
    group.add(fr);
    const ph = box(0.56, 0.42, 0.02, photoMats[i % 3], false, false);
    ph.position.set(cx, LOCK_H + 0.9, -HZ + 0.36);
    ph.rotation.z = fr.rotation.z;
    group.add(ph);
  }

  // ── LOUNGE NOOK — corner couch + table + flickering screen + lamp + plant ──
  const lounge = new THREE.Group();
  lounge.position.set(8, 0, -9);
  group.add(lounge);

  // Warm rug under the nook (with a couple of stripes).
  const rug = box(8, 0.04, 6.5, rugMat, false, true);
  rug.position.set(0, 0.025, -1.4);
  lounge.add(rug);
  for (const rz of [-2.6, -0.2]) {
    const st = box(7.2, 0.045, 0.5, rugStripeMat, false, false);
    st.position.set(0, 0.03, rz);
    lounge.add(st);
  }

  // Couch against the -Z wall (local couch z near -4.4 -> world z near -13.4).
  const seat = box(6.4, 0.5, 1.7, couchMat, true, true);
  seat.position.set(0, 0.45, -4.3);
  lounge.add(seat);
  const cBack = box(6.4, 0.95, 0.4, couchMat, true, true);
  cBack.position.set(0, 0.92, -5.1);
  lounge.add(cBack);
  for (const ax of [-3.2, 3.2]) {
    const arm = box(0.5, 0.8, 1.7, couchMat, true, true);
    arm.position.set(ax, 0.6, -4.3);
    lounge.add(arm);
  }
  for (let i = 0; i < 3; i++) {
    const cush = box(1.8, 0.28, 1.3, i === 1 ? couchAccMat : couchCushMat, false, true);
    cush.position.set(-2 + i * 2, 0.76, -4.2);
    lounge.add(cush);
  }
  const tossPillow = box(0.7, 0.5, 0.2, pillowAccMat, false, true);
  tossPillow.position.set(2.4, 1.0, -4.7);
  tossPillow.rotation.z = 0.5;
  lounge.add(tossPillow);
  solid(8 + 0, -9 + -4.3, 6.4, 1.9); // couch collider (world)

  // Coffee table with a mug + a small stack of books.
  const tLeg = box(1.8, 0.4, 1.0, tableMat, true, true);
  tLeg.position.set(0, 0.2, -1.3);
  lounge.add(tLeg);
  const tTop = box(2.0, 0.08, 1.2, tableTopMat, true, true);
  tTop.position.set(0, 0.44, -1.3);
  lounge.add(tTop);
  solid(8, -9 + -1.3, 2.0, 1.2); // small table collider
  const mug = mesh(G.mugBody, mugMat, true, false);
  mug.position.set(0.5, 0.57, -1.0);
  lounge.add(mug);
  for (let i = 0; i < 3; i++) {
    const bk = box(0.7, 0.09, 0.5, [bookA, bookB, bookC][i], true, false);
    bk.position.set(-0.5, 0.52 + i * 0.09, -1.4);
    bk.rotation.y = 0.1 * i;
    lounge.add(bk);
  }

  // Wall-mounted SCREEN above the couch (flickers) + frame.
  const scrFrame = box(3.6, 2.1, 0.12, screenFrameMat, false, false);
  scrFrame.position.set(0, 2.9, -5.7);
  lounge.add(scrFrame);
  const scrMat = new THREE.MeshStandardMaterial({ color: "#0a2436", roughness: 0.25, emissive: "#2aa6ff", emissiveIntensity: 0.7 });
  const scr = box(3.3, 1.8, 0.05, scrMat, false, false);
  scr.position.set(0, 2.9, -5.62);
  lounge.add(scr);
  screens.push({ mat: scrMat, base: 0.65, rate: 2.3, phase: 0.7 });

  // Hanging photos flanking the screen.
  for (const [px, pm, pr] of [[-2.6, photoA, 0.06], [2.6, photoC, -0.06]]) {
    const fr = box(0.6, 0.75, 0.05, frameWoodMat, false, false);
    fr.position.set(px, 2.7, -5.66);
    fr.rotation.z = pr;
    lounge.add(fr);
    const ph = box(0.46, 0.6, 0.02, pm, false, false);
    ph.position.set(px, 2.7, -5.62);
    ph.rotation.z = pr;
    lounge.add(ph);
  }

  // Floor lamp beside the couch — warm glowing head that breathes.
  const lampPole = mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.0, 8), lampPoleMat, true, false);
  lampPole.position.set(3.4, 1.0, -4.6);
  lounge.add(lampPole);
  const lampShadeMat = new THREE.MeshStandardMaterial({ color: "#ffe1b0", roughness: 0.5, emissive: "#ffbf7a", emissiveIntensity: 1.2 });
  const lampHead = mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.5, 12), lampShadeMat, false, false);
  lampHead.position.set(3.4, 2.15, -4.6);
  lounge.add(lampHead);
  readLights.push({ mat: lampShadeMat, base: 1.1, amp: 0.3, rate: 0.6, phase: 1.7 });

  // Potted plant in the corner.
  const pot = mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 12), plantPotMat, true, true);
  pot.position.set(3.6, 0.25, -2.0);
  lounge.add(pot);
  for (const [bx, by, bz] of [[0, 0.75, 0], [0.18, 0.6, 0.1], [-0.16, 0.62, -0.08]]) {
    const bush = mesh(G.plantBush, plantMat, true, false);
    bush.position.set(3.6 + bx, by, -2.0 + bz);
    lounge.add(bush);
  }

  // ── PORTHOLE on the +X porthole pillar (z = PORT_Z) + cushioned window bench ──
  // Outer trim ring + frame ring (room side) + tinted glass over the opening.
  const portRing = mesh(new THREE.TorusGeometry(1.05, 0.14, 12, 28), portholeOut, false, false);
  portRing.rotation.y = Math.PI / 2;
  portRing.position.set(wxX - 0.18, 2.4, PORT_Z);
  group.add(portRing);
  const portGlass = mesh(new THREE.CircleGeometry(1.0, 28), winGlassMat, false, false);
  portGlass.rotation.y = -Math.PI / 2;
  portGlass.position.set(wxX - 0.22, 2.4, PORT_Z);
  group.add(portGlass);
  // Dark space backdrop just outside the opening.
  const backDisc = mesh(new THREE.CircleGeometry(1.05, 24), spaceBackMat, false, false);
  backDisc.rotation.y = -Math.PI / 2;
  backDisc.position.set(wxX + 0.32, 2.4, PORT_Z);
  group.add(backDisc);

  // Drifting STARS behind the porthole — a Points disc rotated slowly in update().
  {
    const N = 150;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt(Math.random()) * 0.92;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = 0;                 // local X (group is rotated about X to drift)
      pos[i * 3 + 1] = Math.cos(a) * r;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sMat = new THREE.PointsMaterial({ color: "#eaf2ff", size: 0.05, sizeAttenuation: true, transparent: true, opacity: 0.95 });
    starField = new THREE.Points(geo, sMat);
    starField.position.set(wxX + 0.26, 2.4, PORT_Z);
    group.add(starField);
  }

  // Cushioned window bench beneath the porthole (solid).
  const bench = box(1.1, 0.5, 2.8, tableMat, true, true);
  bench.position.set(wxX - 0.9, 0.25, PORT_Z);
  group.add(bench);
  const benchCush = box(1.0, 0.18, 2.6, couchCushMat, false, true);
  benchCush.position.set(wxX - 0.9, 0.59, PORT_Z);
  group.add(benchCush);
  for (const bz of [-0.8, 0.8]) {
    const bp = box(0.5, 0.5, 0.6, bz < 0 ? pillowMat : pillowAccMat, false, true);
    bp.position.set(wxX - 0.9, 0.85, PORT_Z + bz);
    bp.rotation.x = 0.2;
    group.add(bp);
  }
  solid(wxX - 0.9, PORT_Z, 1.1, 2.8); // bench collider

  // ── ANIMATION — allocation-free: breathe strips/reading lights, flicker the
  // screen, and slowly drift the porthole stars. Mutates cached scalars only. ──
  let t = 0;
  function update(dt) {
    t += dt;
    for (let i = 0; i < podStrips.length; i++) {
      const s = podStrips[i];
      s.mat.emissiveIntensity = s.base + Math.sin(t * s.rate + s.phase) * s.amp;
    }
    for (let i = 0; i < readLights.length; i++) {
      const r = readLights[i];
      r.mat.emissiveIntensity = r.base + Math.sin(t * r.rate + r.phase) * r.amp;
    }
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      // Two-rate flicker + a faster jitter for a believable screen shimmer.
      s.mat.emissiveIntensity =
        s.base + Math.sin(t * s.rate + s.phase) * 0.22 + Math.sin(t * s.rate * 5.7 + s.phase) * 0.12;
    }
    if (starField) starField.rotation.x += dt * 0.03; // slow porthole star drift
  }

  return { group, update, ground, colliders };
}
