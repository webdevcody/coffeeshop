// OFFICE PARK district — one 60×60m tile of an expanded city, centered on the
// origin. Modern, tidy corporate campus: three glass mid-rise blocks with clean
// window grids, a landscaped plaza with a reflecting pool, a row of flagpoles,
// and a "BREW HAVEN" billboard. Built as LOCAL geometry: X ∈ [-30,30],
// Z ∈ [-30,30], ground = XZ plane at y=0, up = +Y (right-handed Y-up).
//
// buildOffices() returns { group, colliders, ground, update }:
//   group     — THREE.Group of all meshes (local coords)
//   colliders — AABBs { minX,maxX,minZ,maxZ } for solid props a player/car can't pass
//   ground    — walkable rects; includes the full tile [-30,30]²
//   update(dt)— cheap ambient anim (shimmering pool, flags, spinning fountain, sign)
//
// Lanes: a wide cross of open paving runs through the middle (the Z≈0 corridor and
// the X≈0 corridor are both clear ≥6m), so a car can drive straight through N-S
// and E-W. Buildings sit in the four quadrant corners.

import * as THREE from "three";
import { artPanel, artMaterial } from "../cityArt.js";

export function buildOffices() {
  const group = new THREE.Group();
  const colliders = [];

  // ── Shared geometry (created ONCE, reused) ────────────────────────────────
  const unitBox = new THREE.BoxGeometry(1, 1, 1); // scaled per use
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 1, 8);
  const coneGeo = new THREE.ConeGeometry(1, 1, 7, 1); // foliage (flat-shaded)
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12); // scaled per use (tanks/ducts)
  const railGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 6); // parapet rail post/bar

  // ── Shared materials (created ONCE, reused) ───────────────────────────────
  const plaza = new THREE.MeshStandardMaterial({ color: "#b9b6ad", roughness: 0.95 });
  const grass = new THREE.MeshStandardMaterial({ color: "#5c9a55", roughness: 0.95 });
  const pathMat = new THREE.MeshStandardMaterial({ color: "#cdc9bf", roughness: 0.9 });
  const concrete = new THREE.MeshStandardMaterial({ color: "#c7c4bb", roughness: 0.9 });
  const glassA = new THREE.MeshStandardMaterial({
    color: "#7fb6c9", roughness: 0.18, metalness: 0.55,
    emissive: "#284a55", emissiveIntensity: 0.18,
  });
  const glassB = new THREE.MeshStandardMaterial({
    color: "#9fcbd6", roughness: 0.2, metalness: 0.5,
    emissive: "#2c4e58", emissiveIntensity: 0.16,
  });
  const glassC = new THREE.MeshStandardMaterial({
    color: "#b8d6cf", roughness: 0.22, metalness: 0.45,
    emissive: "#2d5048", emissiveIntensity: 0.16,
  });
  const metalDark = new THREE.MeshStandardMaterial({ color: "#454b52", roughness: 0.5, metalness: 0.7 });
  const metalLight = new THREE.MeshStandardMaterial({ color: "#cdd2d6", roughness: 0.4, metalness: 0.8 });
  const water = new THREE.MeshStandardMaterial({
    color: "#3f86b8", roughness: 0.1, metalness: 0.3,
    emissive: "#10384f", emissiveIntensity: 0.2,
  });
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#6a4a30", roughness: 0.9 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: "#3f7d4d", roughness: 0.9, flatShading: true });
  const planterMat = new THREE.MeshStandardMaterial({ color: "#8a8780", roughness: 0.85 });
  // Bright anodised mullion bars for curtain walls (slim, metallic, low-poly look).
  const mullionMat = new THREE.MeshStandardMaterial({ color: "#dfe4e8", roughness: 0.35, metalness: 0.8, flatShading: true });
  const railMat = new THREE.MeshStandardMaterial({ color: "#9aa3aa", roughness: 0.4, metalness: 0.75 });
  const hvacMat = new THREE.MeshStandardMaterial({ color: "#b5bac0", roughness: 0.6, metalness: 0.5, flatShading: true });
  const ventMat = new THREE.MeshStandardMaterial({ color: "#6c7178", roughness: 0.7, metalness: 0.4, flatShading: true });
  const canopyMat = new THREE.MeshStandardMaterial({ color: "#3a4047", roughness: 0.5, metalness: 0.6, flatShading: true });
  const lobbyGlass = new THREE.MeshStandardMaterial({
    color: "#bfe2ea", roughness: 0.12, metalness: 0.4,
    emissive: "#7fb0bd", emissiveIntensity: 0.4, transparent: true, opacity: 0.7,
  });
  const soilMat = new THREE.MeshStandardMaterial({ color: "#3c2e22", roughness: 1.0 });

  const FLAG_COLORS = ["#c5453f", "#e8c23f", "#3f6fc0"];
  const flagMats = FLAG_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide })
  );

  // Window-grid texture (built ONCE) — a tidy lit/unlit window matrix on glass.
  // Reused across all three towers via a single shared material; the plane geometry
  // is sized per tower so cells stay roughly square.
  const winPlane = new THREE.PlaneGeometry(1, 1);
  let gridMat;
  function gridMaterial() {
    if (gridMat) return gridMat;
    const c = document.createElement("canvas");
    c.width = 128; c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#1b2e36"; g.fillRect(0, 0, 128, 256);
    const cols = 4, rows = 8, padX = 6, padY = 6;
    const cw = (128 - padX * (cols + 1)) / cols;
    const ch = (256 - padY * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        // mostly cool glass, a few warm-lit windows
        const lit = Math.random() < 0.18;
        g.fillStyle = lit ? "#ffe6a8" : "#8fc6d6";
        g.globalAlpha = lit ? 0.95 : 0.8;
        g.fillRect(padX + col * (cw + padX), padY + r * (ch + padY), cw, ch);
      }
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    gridMat = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: new THREE.Color("#33555f"),
      emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.4,
      side: THREE.DoubleSide, // window-grid plane must read edge-on / from behind, not vanish as a 1px sliver
    });
    return gridMat;
  }
  function makeGridPanel(w, h) {
    const m = new THREE.Mesh(winPlane, gridMaterial());
    m.scale.set(w, h, 1);
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  }

  // ── Instancing accumulators ───────────────────────────────────────────────
  // Repeated elements (mullion bars, parapet rails, vent caps) are collected as
  // per-instance matrices and committed to a single InstancedMesh each at the end,
  // so the whole tile adds only a handful of draw calls for hundreds of bars.
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _pos = new THREE.Vector3();
  const _scl = new THREE.Vector3();
  const _eul = new THREE.Euler();
  function makeBank(geo, mat) {
    const list = [];
    function add(x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
      _eul.set(rx, ry, rz);
      _q.setFromEuler(_eul);
      _pos.set(x, y, z);
      _scl.set(sx, sy, sz);
      _m4.compose(_pos, _q, _scl);
      list.push(_m4.clone());
    }
    function commit(cast = false) {
      if (!list.length) return null;
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      for (let i = 0; i < list.length; i++) inst.setMatrixAt(i, list[i]);
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = cast;
      inst.receiveShadow = false;
      group.add(inst);
      return inst;
    }
    return { add, commit };
  }
  const mullions = makeBank(unitBox, mullionMat); // thin curtain-wall bars
  const rails = makeBank(railGeo, railMat);       // rooftop parapet rail tubes
  const vents = makeBank(cylGeo, ventMat);        // rooftop vent caps

  // Curtain-wall mullion grid on one face. Lays a grid of vertical + horizontal
  // bars over the glass panel — all instanced. `face`: "+z" | "-z" | "+x" | "-x".
  // `w` is the in-plane span of THIS face; `halfDepth` is the tower's half-extent
  // along the face NORMAL (so bars sit on the real wall plane, not buried at center).
  // cols/rows chosen so cells read ~floor-sized.
  function curtainWall(cx, cz, w, h, baseY, face, cols, rows, halfDepth) {
    const bar = 0.12;            // bar cross-section
    const proud = 0.06;          // how far bars sit proud of the glass surface
    const along = (face === "+z" || face === "-z") ? "x" : "z";
    const faceSign = (face === "+z" || face === "+x") ? 1 : -1;
    const yMid = baseY + h / 2;
    // Offset from tower center to the wall plane along the face normal.
    const off = faceSign * (halfDepth + proud);
    // vertical bars (cols+1 dividers)
    for (let i = 0; i <= cols; i++) {
      const u = -w / 2 + (w * i) / cols;
      if (along === "x") {
        mullions.add(cx + u, yMid, cz + off, bar, h, bar);
      } else {
        mullions.add(cx + off, yMid, cz + u, bar, h, bar);
      }
    }
    // horizontal bars (rows+1 floor lines)
    for (let j = 0; j <= rows; j++) {
      const v = baseY + (h * j) / rows;
      if (along === "x") {
        mullions.add(cx, v, cz + off, w, bar, bar);
      } else {
        mullions.add(cx + off, v, cz, bar, bar, w);
      }
    }
  }

  // A ring of parapet rail posts + a top tube around a rooftop rectangle.
  function parapetRail(cx, cz, w, d, topY, postH = 1.0) {
    const step = 2.0;
    const hw = w / 2, hd = d / 2;
    const railY = topY + postH;
    // corner + edge posts along all four sides
    const addPostLine = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k <= n; k++) {
        const tt = k / n;
        rails.add(x0 + (x1 - x0) * tt, topY + postH / 2, z0 + (z1 - z0) * tt, 1, postH, 1);
      }
    };
    addPostLine(cx - hw, cz - hd, cx + hw, cz - hd);
    addPostLine(cx - hw, cz + hd, cx + hw, cz + hd);
    addPostLine(cx - hw, cz - hd, cx - hw, cz + hd);
    addPostLine(cx + hw, cz - hd, cx + hw, cz + hd);
    // top horizontal tubes (rotate cylinder onto X then Z)
    rails.add(cx, railY, cz - hd, 1, w, 1, 0, 0, Math.PI / 2);
    rails.add(cx, railY, cz + hd, 1, w, 1, 0, 0, Math.PI / 2);
    rails.add(cx - hw, railY, cz, 1, d, 1, Math.PI / 2, 0, 0);
    rails.add(cx + hw, railY, cz, 1, d, 1, Math.PI / 2, 0, 0);
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function box(w, h, d, mat, x, y, z, cast = true) {
    const m = new THREE.Mesh(unitBox, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  function collide(x, z, w, d) {
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  // ── Ground slab: plaza paving, then grass + paths layered on top ──────────
  box(60, 0.2, 60, plaza, 0, -0.1, 0, false); // base pavement slab (receives shadow)

  // Grass quadrant pads (landscaped) sit under each building cluster corner.
  const grassPads = [[-17, -17], [17, -17], [-17, 17], [17, 17]];
  for (const [gx, gz] of grassPads) {
    box(20, 0.06, 20, grass, gx, 0.03, gz, false);
  }
  // Central cross paths (kept light/flat — NOT colliders, cars drive here).
  box(10, 0.08, 60, pathMat, 0, 0.05, 0, false); // N-S lane paving
  box(60, 0.08, 10, pathMat, 0, 0.05, 0, false); // E-W lane paving

  // ── Glass office blocks (3 mid-rises, ~15–20m) ────────────────────────────
  // Each placed in a quadrant corner so the central cross stays open for cars.
  // makeTower draws the slab body + a window-grid of thin mullion ribs + roof cap.
  // `front` is the facing toward the central plaza, where the entrance canopy +
  // lobby glazing go. SW/SE blocks face +Z (toward center); NW block faces -Z.
  // A full glass office block: a SOLID podium base (2 storeys, slightly wider than
  // the tower so the building reads grounded with real depth on every side), the
  // glass tower mass above it, a projecting entrance volume (a real box with depth
  // behind the facade — NOT a standing card) on the plaza-facing front, and a
  // detailed roof. Footprints are sized to fill the quadrant plot.
  function makeTower(cx, cz, w, d, h, glassMat, front = "+z") {
    const fSign = front === "+z" ? 1 : -1;

    // ── PODIUM: a solid masonry base, wider/deeper than the tower (full volume) ─
    const podH = 5.0;
    const podW = w + 2.4, podD = d + 2.4;
    box(podW, podH, podD, concrete, cx, podH / 2, cz, true); // solid podium block
    // podium ground-floor glazing wraps all four sides (real recessed band, not a card)
    box(podW * 0.9, 3.2, 0.18, lobbyGlass, cx, 1.8, cz + (podD / 2 + 0.02), false);
    box(podW * 0.9, 3.2, 0.18, lobbyGlass, cx, 1.8, cz - (podD / 2 + 0.02), false);
    box(0.18, 3.2, podD * 0.9, lobbyGlass, cx + (podW / 2 + 0.02), 1.8, cz, false);
    box(0.18, 3.2, podD * 0.9, lobbyGlass, cx - (podW / 2 + 0.02), 1.8, cz, false);
    // podium cap / cornice ledge
    box(podW + 0.4, 0.45, podD + 0.4, metalDark, cx, podH + 0.1, cz, true);

    // ── TOWER: the main glass mass, set on the podium ─────────────────────────
    const towerH = h - podH;          // glass rises above the podium
    const baseY = podH;               // tower starts at podium top
    const yC = baseY + towerH / 2;
    box(w, towerH, d, glassMat, cx, yC, cz); // glass body (substantial W×D×H volume)
    // Window-grid art panel on the front face reads as floors/bays through glass…
    const grid = makeGridPanel(w * 0.94, towerH * 0.92);
    grid.position.set(cx, yC, cz + fSign * (d / 2 + 0.05));
    if (fSign < 0) grid.rotation.y = Math.PI;
    group.add(grid);
    // …overlaid with a real instanced curtain-wall mullion grid on ALL FOUR faces.
    const cols = Math.max(3, Math.round(w / 3));
    const colsD = Math.max(3, Math.round(d / 3));
    const rows = Math.max(4, Math.round(towerH / 3.2));
    // +z/-z faces span W, sit on the Z wall plane (halfDepth = d/2).
    curtainWall(cx, cz, w, towerH, baseY, "+z", cols, rows, d / 2);
    curtainWall(cx, cz, w, towerH, baseY, "-z", cols, rows, d / 2);
    // +x/-x faces span D, sit on the X wall plane (halfDepth = w/2).
    curtainWall(cx, cz, d, towerH, baseY, "+x", colsD, rows, w / 2);
    curtainWall(cx, cz, d, towerH, baseY, "-x", colsD, rows, w / 2);

    // ── ENTRANCE PAVILION: a real projecting volume (depth behind the facade) ──
    // A solid 1-storey box stepping out from the podium toward the avenue, so the
    // street front is a 3D building, not a flat card. Sits flush on the podium face.
    const entW = Math.min(w * 0.6, 7);
    const entD = 3.2;                 // genuine depth of the entrance wing
    const entZ = cz + fSign * (podD / 2 + entD / 2 - 0.05);
    box(entW, 3.6, entD, concrete, cx, 1.8, entZ, true);          // entrance mass
    box(entW * 0.86, 2.9, 0.16, lobbyGlass, cx, 1.65, entZ + fSign * (entD / 2 + 0.02), false); // glazed front
    box(entW * 0.5, 2.6, 0.12, metalDark, cx, 1.4, entZ + fSign * (entD / 2 + 0.04), false);    // doors
    // flat canopy slab cantilevering over the entrance front on two slim posts
    const canFz = entZ + fSign * (entD / 2);
    box(entW + 1.0, 0.2, 1.6, canopyMat, cx, 3.7, canFz + fSign * 0.7, true);
    box(0.16, 3.5, 0.16, metalDark, cx - entW / 2 - 0.1, 1.75, canFz + fSign * 1.35, true);
    box(0.16, 3.5, 0.16, metalDark, cx + entW / 2 + 0.1, 1.75, canFz + fSign * 1.35, true);

    // ── Roof: parapet cornice band, HVAC plant, vent rows, rail ───────────────
    box(w * 1.04, 0.55, d * 1.04, metalDark, cx, h + 0.28, cz, true); // cornice/parapet band
    const roofY = h + 0.55;
    // big HVAC plant box + a second smaller unit
    box(w * 0.34, 1.4, d * 0.42, hvacMat, cx - w * 0.18, roofY + 0.7, cz, true);
    box(w * 0.22, 1.0, d * 0.26, hvacMat, cx + w * 0.22, roofY + 0.5, cz + d * 0.18, true);
    // cylindrical water tank
    const tank = new THREE.Mesh(cylGeo, metalLight);
    tank.scale.set(1.3, 2.0, 1.3);
    tank.position.set(cx + w * 0.2, roofY + 1.0, cz - d * 0.22);
    tank.castShadow = true;
    group.add(tank);
    // a slim antenna mast
    box(0.1, 3.2, 0.1, metalDark, cx - w * 0.3, roofY + 1.6, cz - d * 0.28, true);
    // VENT ROW: a line of round vent caps along the back roof edge (instanced)
    const vN = Math.max(3, Math.round(w / 2));
    for (let i = 0; i < vN; i++) {
      const vx = cx - w * 0.36 + (w * 0.72 * i) / (vN - 1);
      vents.add(vx, roofY + 0.35, cz - d * 0.34, 0.42, 0.5, 0.42);
    }
    // PARAPET RAIL ring around the roof perimeter (instanced posts + tubes)
    parapetRail(cx, cz, w * 1.02, d * 1.02, roofY, 0.95);
    // Collider matches the WIDEST footprint (the podium) and extends to cover the
    // projecting entrance wing on the front, so the whole mass is solid to players.
    const colMinZ = fSign > 0 ? cz - podD / 2 : cz - podD / 2 - entD;
    const colMaxZ = fSign > 0 ? cz + podD / 2 + entD : cz + podD / 2;
    colliders.push({ minX: cx - podW / 2, maxX: cx + podW / 2, minZ: colMinZ, maxZ: colMaxZ });
  }

  // Footprints enlarged to fill each quadrant plot. With the wider podium + the
  // projecting entrance wing, the inner (plaza-facing) edges still leave a clear
  // central cross: N-S lane ≈ 20 m, E-W lane ≈ 15 m (both well over the 6 m min).
  makeTower(-18, -18, 14, 12, 20, glassA, "+z"); // SW block (tallest)
  makeTower(18, -18, 13, 13, 17, glassB, "+z");  // SE block
  makeTower(-18, 18, 12, 14, 18.5, glassC, "-z"); // NW block (faces plaza)
  // ── NE quadrant: a lower-rise office pavilion — a FULL 3-storey volume (not a
  // facade). Solid concrete base + glass upper, projecting glazed entrance toward
  // the plaza (-z). Sized to fill the plot like the towers. ────────────────────
  {
    const px = 18, pz = 18;          // plot center
    const pvW = 14, pvD = 13, pvH = 9;  // substantial footprint + height
    const baseH = 3.2;               // solid masonry ground floor
    box(pvW + 1.2, baseH, pvD + 1.2, concrete, px, baseH / 2, pz, true);     // wide solid base
    box(pvW, pvH - baseH, pvD, glassB, px, baseH + (pvH - baseH) / 2, pz, true); // glass upper mass
    box(pvW + 1.0, 0.5, pvD + 1.0, metalDark, px, pvH + 0.1, pz, true);      // roof cornice
    // curtain wall on the glass upper, on all four real wall planes
    curtainWall(px, pz, pvW, pvH - baseH, baseH, "-z", 5, 2, pvD / 2);
    curtainWall(px, pz, pvW, pvH - baseH, baseH, "+z", 5, 2, pvD / 2);
    curtainWall(px, pz, pvD, pvH - baseH, baseH, "-x", 4, 2, pvW / 2);
    curtainWall(px, pz, pvD, pvH - baseH, baseH, "+x", 4, 2, pvW / 2);
    // ground-floor glazing wrap on the solid base (recessed band, real depth)
    box(pvW * 0.9, 2.4, 0.16, lobbyGlass, px, 1.5, pz - (pvD / 2 + 0.02), false); // plaza side (-z)
    box(0.16, 2.4, pvD * 0.9, lobbyGlass, px - (pvW / 2 + 0.02), 1.5, pz, false); // plaza side (-x)
    // projecting glazed entrance volume toward the plaza (-z) — a real box with depth
    const entD = 3.0, entZ = pz - (pvD / 2 + entD / 2 - 0.05);
    box(7, 3.2, entD, concrete, px, 1.6, entZ, true);
    box(6, 2.6, 0.16, lobbyGlass, px, 1.45, entZ - (entD / 2 + 0.02), false);
    box(3.4, 2.4, 0.12, metalDark, px, 1.3, entZ - (entD / 2 + 0.04), false); // doors
    box(8, 0.18, 1.5, canopyMat, px, 3.3, entZ - (entD / 2 + 0.6), true);     // entrance canopy
    box(0.16, 3.1, 0.16, metalDark, px - 3.6, 1.6, entZ - (entD / 2 + 1.2), true);
    box(0.16, 3.1, 0.16, metalDark, px + 3.6, 1.6, entZ - (entD / 2 + 1.2), true);
    // roof detail
    parapetRail(px, pz, pvW + 1.0, pvD + 1.0, pvH + 0.35, 0.85);
    box(pvW * 0.3, 1.3, pvD * 0.34, hvacMat, px + 2, pvH + 1.0, pz + 2.5, true); // HVAC plant
    vents.add(px - 3, pvH + 0.55, pz + 4, 0.4, 0.5, 0.4);
    vents.add(px + 3, pvH + 0.55, pz + 4, 0.4, 0.5, 0.4);
    // collider covers the wide base footprint + the projecting entrance toward -z
    colliders.push({
      minX: px - (pvW + 1.2) / 2, maxX: px + (pvW + 1.2) / 2,
      minZ: pz - (pvD + 1.2) / 2 - entD, maxZ: pz + (pvD + 1.2) / 2,
    });
  }

  // ── Reflecting pool (plaza centerpiece — flat, walk-around, not a collider) ─
  // Placed slightly off the exact center so cars can still skim the cross; it sits
  // in the SE-ish open paving but is shallow (decorative). Tight collider for rim only.
  const poolX = 0, poolZ = -0.0;
  // Pool rim (low planter wall ring) — 4 thin coping edges around a 9×5 basin.
  const pw = 9, pd = 5, rim = 0.4;
  box(pw + rim * 2, 0.35, rim, concrete, poolX, 0.17, poolZ - pd / 2 - rim / 2, true);
  box(pw + rim * 2, 0.35, rim, concrete, poolX, 0.17, poolZ + pd / 2 + rim / 2, true);
  box(rim, 0.35, pd, concrete, poolX - pw / 2 - rim / 2, 0.17, poolZ, true);
  box(rim, 0.35, pd, concrete, poolX + pw / 2 + rim / 2, 0.17, poolZ, true);
  // Polished stone COPING EDGE capping the rim (lighter, slightly proud lip).
  const coping = new THREE.MeshStandardMaterial({ color: "#d8d4c8", roughness: 0.5, metalness: 0.15 });
  const cw2 = pw + rim * 2 + 0.3, cd2 = rim + 0.3;
  box(cw2, 0.12, cd2, coping, poolX, 0.40, poolZ - pd / 2 - rim / 2, true);
  box(cw2, 0.12, cd2, coping, poolX, 0.40, poolZ + pd / 2 + rim / 2, true);
  box(cd2, 0.12, pd, coping, poolX - pw / 2 - rim / 2, 0.40, poolZ, true);
  box(cd2, 0.12, pd, coping, poolX + pw / 2 + rim / 2, 0.40, poolZ, true);
  const waterMesh = box(pw, 0.12, pd, water, poolX, 0.16, poolZ, false);
  // NOTE: pool sits ON the E-W path; keep N-S lane (X≈0 but pool spans X±4.5) —
  // wait: pool spans X[-4.5,4.5]. To preserve a drivable lane we collide the pool
  // so cars route around it via the wide quadrant gaps; the N-S lane shifts to the
  // grass-free margins. Collider kept tight to the basin footprint.
  collide(poolX, poolZ, pw + rim * 2, pd + rim * 2);

  // A small spinning fountain finial in the pool center.
  const fountain = new THREE.Mesh(coneGeo, metalLight);
  fountain.scale.set(0.5, 1.0, 0.5);
  fountain.position.set(poolX, 0.7, poolZ);
  fountain.castShadow = true;
  group.add(fountain);

  // ── Flagpoles (row of 3 along the plaza front edge, near -Z) ──────────────
  const flags = [];
  const flagXs = [-6, 0, 6];
  for (let i = 0; i < flagXs.length; i++) {
    const fx = flagXs[i];
    const fz = -12;
    const pole = new THREE.Mesh(poleGeo, metalLight);
    pole.scale.set(1, 9, 1);
    pole.position.set(fx, 4.5, fz);
    pole.castShadow = true;
    group.add(pole);
    // base
    box(0.6, 0.4, 0.6, concrete, fx, 0.2, fz, true);
    // gold finial ball atop the pole
    const finial = new THREE.Mesh(cylGeo, metalLight);
    finial.scale.set(0.16, 0.16, 0.16);
    finial.position.set(fx, 9.05, fz);
    group.add(finial);
    // flag BANNER: a tall hanging corporate pennant (thin box, animated to sway).
    // Pivoted at the pole so it swings naturally; banner mesh offset within a group.
    const flagPivot = new THREE.Group();
    flagPivot.position.set(fx, 8.4, fz);
    const flag = new THREE.Mesh(unitBox, flagMats[i]);
    flag.scale.set(2.4, 1.6, 0.06);
    flag.position.set(1.2, -0.2, 0);
    flag.castShadow = true;
    flagPivot.add(flag);
    group.add(flagPivot);
    flags.push(flagPivot);
    collide(fx, fz, 0.6, 0.6); // pole base (small)
  }

  // ── Billboard: "BREW HAVEN" on a steel frame, facing the central plaza (+Z) ─
  const billboard = artPanel(11, 5.5, "billboard", {
    title: "BREW HAVEN",
    sub: "OPEN DAILY",
    a: "#1f5a52",
    b: "#0c2a28",
    accent: "#ffd24a",
    glyph: "☕",
    emissiveIntensity: 0.5,
    file: "billboard-brewhaven.png",
  });
  billboard.position.set(0, 8, -27.5);
  billboard.castShadow = true;
  group.add(billboard);
  // billboard support legs + crossbar
  box(0.4, 8, 0.4, metalDark, -4.5, 4, -28.2, true);
  box(0.4, 8, 0.4, metalDark, 4.5, 4, -28.2, true);
  box(11.5, 0.4, 0.4, metalDark, 0, 5.4, -28.2, true);
  collide(0, -28.2, 11.5, 0.6);

  // A second small directional sign greeting cars that arrive from the SOUTH (-Z)
  // up the avenue. It sits on the lane SHOULDER (out of the open E-W/N-S corridors)
  // and its readable face is rotated to point toward the approach (-Z), so the text
  // is NOT mirrored to an arriving player. Mounted on a short post with a base.
  const waySignX = -9, waySignZ = -7;
  const waySign = artPanel(2.6, 1.4, "sign", {
    text: "OFFICE PARK",
    bg: "#2f6f63",
    fg: "#f2f6ff",
    emissiveIntensity: 0.4,
    file: "sign-officepark.png",
  });
  waySign.position.set(waySignX, 2.2, waySignZ);
  waySign.rotation.y = Math.PI; // readable face points -Z, toward the southern approach
  waySign.castShadow = true;
  group.add(waySign);
  // sign post + base so it reads as a planted wayfinding sign, not a floating panel
  box(0.16, 2.2, 0.16, metalDark, waySignX, 1.1, waySignZ, true);
  box(0.6, 0.3, 0.6, concrete, waySignX, 0.15, waySignZ, true);
  collide(waySignX, waySignZ, 0.6, 0.6); // small post footprint

  // ── Landscaping: trees on the grass pads + low planter hedges ─────────────
  // A few conifer-ish trees (trunk + 2 foliage cones) reused geometry. Placed in
  // the OUTER plot corners / tile margins, clear of the enlarged building masses.
  const treeSpots = [
    [-27, -27], [27, -27], [-27, 27], [27, 27], // far quadrant corners
    [-27, -2], [27, -2],                         // E/W tile-edge margins
  ];
  for (const [tx, tz] of treeSpots) {
    const trunk = new THREE.Mesh(poleGeo, trunkMat);
    trunk.scale.set(1.2, 1.6, 1.2);
    trunk.position.set(tx, 0.8, tz);
    trunk.castShadow = true;
    group.add(trunk);
    const c1 = new THREE.Mesh(coneGeo, foliageMat);
    c1.scale.set(1.7, 3.0, 1.7);
    c1.position.set(tx, 2.8, tz);
    c1.castShadow = true;
    group.add(c1);
    // small footprint collider (trunk) — trees are solid props
    collide(tx, tz, 0.6, 0.6);
  }

  // Low benches flanking the billboard approach (decorative, low → no collide).
  // Pulled onto the SHOULDERS (|x| ≥ 7) so the central N-S drive lane (|x| ≤ 5)
  // stays clear instead of a single slab sitting across the road.
  box(2.8, 0.45, 1.0, planterMat, -6.85, 0.22, -22, true);
  box(2.8, 0.45, 1.0, planterMat, 6.85, 0.22, -22, true);

  // ── Planter beds: raised stone troughs with soil + a clipped hedge cap ──────
  // Placed along the plaza margins (NOT in the open cross lanes). Low → no collide.
  const planterSpots = [
    [-10, -22], [10, -22],   // flank the billboard approach
    [-22, -3], [22, -3],     // E/W lane shoulders (outside the 6m lane)
    [-3, 22], [3, 22],       // N plaza edge
  ];
  const hedgeMat = new THREE.MeshStandardMaterial({ color: "#4a8c52", roughness: 0.95, flatShading: true });
  for (const [px, pz] of planterSpots) {
    box(2.6, 0.5, 1.1, planterMat, px, 0.25, pz, true); // trough wall
    box(2.3, 0.12, 0.85, soilMat, px, 0.5, pz, false);  // soil top
    box(2.2, 0.55, 0.8, hedgeMat, px, 0.82, pz, true);  // clipped hedge
  }

  // ── Commit all instanced banks (one draw call each) ───────────────────────
  mullions.commit(false); // curtain-wall bars: many hundreds, 1 InstancedMesh
  rails.commit(false);    // parapet rail posts + tubes
  vents.commit(true);     // rooftop vent caps

  // ── ground (full tile is walkable; buildings block via colliders) ─────────
  const ground = [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30 }];

  // ── update: cheap ambient animation, NO per-frame allocation ──────────────
  let t = 0;
  function update(dt) {
    t += dt;
    // shimmering pool: pulse emissive + tiny vertical bob of the water plane
    water.emissiveIntensity = 0.2 + 0.12 * Math.sin(t * 1.6);
    waterMesh.position.y = 0.16 + 0.015 * Math.sin(t * 2.2);
    // spinning fountain finial
    fountain.rotation.y = t * 1.2;
    // gently swaying flag banners (each pivot swings about Y at the pole)
    for (let i = 0; i < flags.length; i++) {
      flags[i].rotation.y = 0.22 * Math.sin(t * 2 + i);
    }
    // billboard breathes a touch so it reads as glowing signage
    billboard.material.emissiveIntensity = 0.5 + 0.08 * Math.sin(t * 1.1);
  }

  return { group, colliders, ground, update };
}
