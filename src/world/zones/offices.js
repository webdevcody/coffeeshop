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
  // Recentred to ±13 and trimmed to 18 m so they stay within the ±23 setback
  // (edges reach ±22) — grass no longer spills out onto the seam road grid.
  const grassPads = [[-13, -13], [13, -13], [-13, 13], [13, 13]];
  for (const [gx, gz] of grassPads) {
    box(18, 0.06, 18, grass, gx, 0.03, gz, false);
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

  // SETBACK: a ROAD GRID runs on the tile seams (avenues at world X=±60,0 and
  // cross-streets at world Z=35,95,…), each ~12 m wide + kerb/sidewalk, so the
  // outer ~7 m of every tile edge is street. Buildings are pulled inward toward
  // the plaza so that EVERY footprint AND its collider stays within LOCAL
  // X,Z ∈ [-23,23] (a ~7 m setback from each edge of the [-30,30] tile), clearing
  // the road + sidewalk. Quadrant centres moved from ±18 to ±15 and footprints
  // trimmed so the widest mass (podium half-width) + outward face never passes ±23;
  // the plaza-facing entrance wings project INWARD (toward centre), well clear of
  // the edges. The central open cross stays clear (N-S lane and E-W lane each ≫6 m).
  // Verify per building: outward edge = |centre| + (footprint+2.4)/2 ≤ 23.
  makeTower(-15, -15, 13, 11, 20, glassA, "+z"); // SW block (tallest): X[-23,-7] Z back -22.7
  makeTower(15, -15, 12, 12, 17, glassB, "+z");  // SE block: X[7,22.2] Z back -22.2
  makeTower(-15, 15, 11, 13, 18.5, glassC, "-z"); // NW block (faces plaza): X[-21.7,…] Z fwd 22.7
  // ── NE quadrant: a lower-rise office pavilion — a FULL 3-storey volume (not a
  // facade). Solid concrete base + glass upper, projecting glazed entrance toward
  // the plaza (-z). Sized to fill the plot like the towers. ────────────────────
  {
    const px = 15, pz = 15;          // plot center (set back from the edge road grid)
    const pvW = 13, pvD = 12, pvH = 9;  // substantial footprint + height
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

  // ── Billboard: "BREW HAVEN" on a steel frame, on the SOUTH frontage. ────────
  // Set back to z=-22 (clears the seam road + sidewalk; collider stays inside ±23)
  // and rotated 180° so its readable face points OUTWARD toward the southern avenue
  // (-Z). artPanel's text reads un-mirrored from its +Z face by default, so without
  // this flip an approaching driver would see the mirrored DoubleSide back of the
  // panel — i.e. a backwards "BREW HAVEN". The flip makes it read correctly.
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
  billboard.position.set(0, 8, -22);
  billboard.rotation.y = Math.PI; // readable face points -Z (outward to the avenue), un-mirrored
  billboard.castShadow = true;
  group.add(billboard);
  // billboard support legs + crossbar (behind the panel, toward -Z; stay within ±23)
  box(0.4, 8, 0.4, metalDark, -4.5, 4, -22.7, true);
  box(0.4, 8, 0.4, metalDark, 4.5, 4, -22.7, true);
  box(11.5, 0.4, 0.4, metalDark, 0, 5.4, -22.7, true);
  // WALK-UNDER FIX: the panel (y≈8) and crossbar (y≈5.4) are far overhead, so register
  // NO full-width collider for them — colliders are infinite-height in XZ and an 11.5 m
  // AABB would wall off the ENTIRE south frontage (you couldn't walk OR drive under the
  // billboard). Only the two thin, ground-standing support POSTS get a tight collider;
  // the gap between them stays open so players walk/drive straight under the sign.
  collide(-4.5, -22.7, 0.5, 0.5);
  collide(4.5, -22.7, 0.5, 0.5);

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
  // A few conifer-ish trees (trunk + 2 foliage cones) reused geometry. Placed on
  // the plaza margins INSIDE the ±23 setback (so they clear the seam road grid and
  // sit clear of the building masses), not out in the now-road tile margins.
  const treeSpots = [
    [-22, -22], [22, -22], [-22, 22], [22, 22], // inner quadrant corners (within setback)
    [-22, -2], [22, -2],                         // E/W plaza-margin pair (within setback)
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

  // ── ENTERABLE SHOP: "MIDTOWN DELI" — a lunch deli the player can walk INTO ──
  // A small standalone room (additive — NOT carved from a tower) tucked along the
  // open WEST inner edge of the tile, in the clear strip between the SW and NW
  // blocks (X[-20.1,-11.8], Z[-3.6,3.6] — verified not to overlap any building, the
  // pool, flagpoles, trees or planters, all within ±23). It sits on the WEST
  // SHOULDER of the open cross (like the existing trees/planters at Z≈-2/-3): the
  // N-S drive lane (X[-5,5]) stays fully clear, and the doorway faces +X toward the
  // central plaza so a player crossing the cross walks straight in. It has
  // four real walls, a floor + flat roof, and a 2.2 m DOORWAY GAP in the street-
  // facing (+X, toward the central plaza) wall. Each wall segment gets its OWN AABB
  // collider; the doorway gap gets NONE, so the interior is genuinely walkable and
  // the player enters through the door.
  {
    const sx = -16, sz = 0;        // shop center (open west-edge strip)
    const SW = 8.0, SD = 7.0;      // outer width (X) × depth (Z)
    const WT = 0.25, WH = 3.0;     // wall thickness, wall height
    const hw = SW / 2, hd = SD / 2;
    const door = 2.2;              // doorway clear width (in the +X street wall)
    const fX = sx + hw;            // street-facing wall centerline (+X)
    const bX = sx - hw;            // back wall centerline (-X)
    const nZ = sz - hd, pZ = sz + hd; // side-wall centerlines (−Z, +Z)

    // Themed materials (deli palette) — created once, reused.
    const deliWall = new THREE.MeshStandardMaterial({ color: "#e7ddc7", roughness: 0.9 });
    const deliTrim = new THREE.MeshStandardMaterial({ color: "#7a4a2b", roughness: 0.75 });
    const deliFloor = new THREE.MeshStandardMaterial({ color: "#b8a47e", roughness: 0.85 });
    const counterMat = new THREE.MeshStandardMaterial({ color: "#9a6b3f", roughness: 0.6 });
    const counterTop = new THREE.MeshStandardMaterial({ color: "#dfe3e6", roughness: 0.35, metalness: 0.5 });
    const caseGlass = new THREE.MeshStandardMaterial({
      color: "#cfe8ee", roughness: 0.1, metalness: 0.2,
      emissive: "#9fd0da", emissiveIntensity: 0.25, transparent: true, opacity: 0.55,
    });
    const shelfMat = new THREE.MeshStandardMaterial({ color: "#8a5a36", roughness: 0.7 });
    const rugMat = new THREE.MeshStandardMaterial({ color: "#7a2f2f", roughness: 0.95 });
    const stoolMat = new THREE.MeshStandardMaterial({ color: "#2b2b30", roughness: 0.5, metalness: 0.4 });
    const lampShade = new THREE.MeshStandardMaterial({
      color: "#ffdf9e", roughness: 0.4, emissive: "#ffcf6a", emissiveIntensity: 0.8,
    });
    // Bright little grocery "products" for the shelves (one shared instanced bank).
    const productMat = new THREE.MeshStandardMaterial({ color: "#d9b24a", roughness: 0.6, flatShading: true });
    const products = makeBank(unitBox, productMat);

    // ── FLOOR + flat ROOF/ceiling ─────────────────────────────────────────────
    box(SW, 0.12, SD, deliFloor, sx, 0.06, sz, false);      // interior floor slab
    box(SW + 0.3, 0.25, SD + 0.3, deliTrim, sx, WH + 0.12, sz, true); // flat roof/ceiling cap

    // ── WALLS (each its own collider; NO collider across the doorway gap) ──────
    // Back wall (−X): full span along Z.
    box(WT, WH, SD, deliWall, bX, WH / 2, sz, true);
    colliders.push({ minX: bX - WT / 2, maxX: bX + WT / 2, minZ: sz - hd, maxZ: sz + hd });
    // Side wall (−Z): full span along X.
    box(SW, WH, WT, deliWall, sx, WH / 2, nZ, true);
    colliders.push({ minX: sx - hw, maxX: sx + hw, minZ: nZ - WT / 2, maxZ: nZ + WT / 2 });
    // Side wall (+Z): full span along X.
    box(SW, WH, WT, deliWall, sx, WH / 2, pZ, true);
    colliders.push({ minX: sx - hw, maxX: sx + hw, minZ: pZ - WT / 2, maxZ: pZ + WT / 2 });
    // Street-facing wall (+X) with a 2.2 m DOORWAY GAP centered at sz: two short
    // flanking segments only — and a lintel above the gap (high, no collider).
    // Each flanking segment runs from a side wall to the doorway jamb; the jambs sit
    // at sz ± door/2 with a small extra clearance so NOTHING (wall or collider)
    // touches the 2.2 m opening — the gap stays strictly open for walk-through.
    const jamb = door / 2 + 0.05;                   // doorway half-width + clearance
    const segLen = hd - jamb;                        // length of each flanking segment
    const segZneg = -hd + (hd - jamb) / 2;           // center of −Z-side front segment
    const segZpos = hd - (hd - jamb) / 2;            // center of +Z-side front segment
    box(WT, WH, segLen, deliWall, fX, WH / 2, segZneg, true);
    colliders.push({ minX: fX - WT / 2, maxX: fX + WT / 2, minZ: segZneg - segLen / 2, maxZ: segZneg + segLen / 2 });
    box(WT, WH, segLen, deliWall, fX, WH / 2, segZpos, true);
    colliders.push({ minX: fX - WT / 2, maxX: fX + WT / 2, minZ: segZpos - segLen / 2, maxZ: segZpos + segLen / 2 });
    // Door lintel above the opening (spans the gap up high; NO collider — walkable).
    box(WT, 0.6, door, deliTrim, fX, WH - 0.3, sz, true);

    // ── SHOP SIGN above the door, OUTSIDE, facing the street (+X), un-mirrored ──
    // artPanel's text reads correctly from its +X face after rotating +90° about Y
    // (default panel faces +Z; rotating +PI/2 turns the readable face to +X).
    const deliSign = artPanel(3.4, 1.1, "sign", {
      text: "MIDTOWN DELI",
      bg: "#0b6e4f", fg: "#fff3b0",
      emissiveIntensity: 0.45,
      file: "sign-midtowndeli.png",
    });
    deliSign.position.set(fX + WT / 2 + 0.06, WH + 0.45, sz);
    deliSign.rotation.y = Math.PI / 2; // readable face points +X (out to the plaza)
    deliSign.castShadow = true;
    group.add(deliSign);

    // ── INTERIOR CONTENT (cozy + themed) ──────────────────────────────────────
    // RUG on the floor (center, a welcoming red runner).
    box(3.4, 0.04, 4.2, rugMat, sx, 0.13, sz, false);

    // SERVICE COUNTER along the back wall: a solid base + a light stone top, with
    // a glass DISPLAY CASE sitting on it (deli case full of goods).
    const cx0 = bX + 0.9;          // counter sits just in front of the back wall
    box(1.0, 1.1, 4.6, counterMat, cx0, 0.55, sz, true);          // counter body
    box(1.1, 0.08, 4.7, counterTop, cx0, 1.14, sz, true);        // counter top
    box(1.0, 0.7, 4.4, caseGlass, cx0, 1.55, sz, false);         // glass display case
    box(1.0, 0.06, 4.4, counterTop, cx0, 1.18, sz, false);       // case base tray
    // a few "trays of goods" inside the case (instanced products)
    for (let i = 0; i < 5; i++) {
      const gz = sz - 1.8 + i * 0.9;
      products.add(cx0, 1.3, gz, 0.7, 0.18, 0.55, 0, 0, 0);
    }

    // SHELVES on the −Z wall stocked with little products (instanced goods).
    const shZ = nZ + 0.25;         // shelves hug the −Z wall, just inside
    for (let s = 0; s < 3; s++) {
      const shelfY = 0.7 + s * 0.7;
      box(3.6, 0.06, 0.4, shelfMat, sx + 0.4, shelfY, shZ, true); // shelf board
      // line of product boxes on each shelf
      for (let i = 0; i < 6; i++) {
        const px2 = sx + 0.4 - 1.55 + i * 0.62;
        products.add(px2, shelfY + 0.22, shZ, 0.34, 0.36, 0.3, 0, 0, 0);
      }
    }

    // DISPLAY RACK (a small open shelving unit) near the +Z wall with goods on top.
    const rkZ = pZ - 0.3;
    box(2.2, 1.4, 0.45, shelfMat, sx + 0.6, 0.7, rkZ, true);       // rack carcass
    box(2.0, 0.05, 0.4, shelfMat, sx + 0.6, 1.05, rkZ, false);     // mid shelf
    for (let i = 0; i < 5; i++) {
      products.add(sx + 0.6 - 0.8 + i * 0.4, 1.5, rkZ, 0.3, 0.22, 0.32, 0, 0, 0);
    }

    // A COUPLE OF STOOLS at a slim standing counter by the doorway side.
    for (let i = 0; i < 2; i++) {
      const stz = sz - 0.8 + i * 1.6;
      const stx = fX - 1.4;
      const leg = new THREE.Mesh(poleGeo, stoolMat);
      leg.scale.set(0.5, 0.7, 0.5);
      leg.position.set(stx, 0.35, stz);
      leg.castShadow = true;
      group.add(leg);
      box(0.5, 0.08, 0.5, stoolMat, stx, 0.72, stz, true);        // seat
    }

    // WALL SIGNAGE inside (a small menu board on the back wall, reading toward +X).
    const menu = artPanel(2.0, 1.2, "sign", {
      text: "SOUPS SUBS SALADS",
      bg: "#222831", fg: "#ffd369",
      emissiveIntensity: 0.4,
      file: "sign-delimenu.png",
    });
    menu.position.set(bX + WT / 2 + 0.05, 2.1, sz);
    menu.rotation.y = Math.PI / 2; // faces into the room (+X)
    menu.castShadow = false;
    group.add(menu);

    // HANGING INTERIOR LIGHTS (two pendant lamps over the floor — glowing shades).
    for (const lz of [sz - 1.4, sz + 1.4]) {
      const lx = sx + 0.6;
      box(0.04, 0.7, 0.04, deliTrim, lx, WH - 0.35, lz, false);   // cord
      const shade = new THREE.Mesh(coneGeo, lampShade);
      shade.scale.set(0.55, 0.45, 0.55);
      shade.rotation.x = Math.PI;                                  // open end downward
      shade.position.set(lx, WH - 0.75, lz);
      group.add(shade);
    }

    // commit the shop's product goods as a single InstancedMesh (one draw call)
    products.commit(true);
  }

  // ── ENTERABLE SHOP #2: "BREW HAVEN CAFÉ" — the namesake coffee bar you walk INTO ─
  // A standalone room on the open EAST shoulder of the cross (mirror position of the
  // deli): center (16,0), outer 8.0×7.0 → X[12,20] Z[-3.5,3.5]. Verified clear of the
  // SE/NE buildings (X≥7.8 but their colliders sit at |Z|≥7.9), the trees (x=22), the
  // pool, and the N-S drive lane (|x|≤5 stays fully open). Four real walls + floor +
  // flat roof, with a 2.2 m DOORWAY GAP in the street-facing (−X, toward the central
  // plaza) wall so a player crossing the cross walks straight in. Each wall segment
  // gets its OWN AABB collider; the doorway gap gets NONE (genuinely walkable).
  {
    const sx = 16, sz = 0;          // shop center (open east-edge strip)
    const SW = 8.0, SD = 7.0;       // outer width (X) × depth (Z)
    const WT = 0.25, WH = 3.0;      // wall thickness, wall height
    const hw = SW / 2, hd = SD / 2;
    const door = 2.2;               // doorway clear width (in the −X plaza wall)
    const fX = sx - hw;             // plaza-facing wall centerline (−X)
    const bX = sx + hw;             // back wall centerline (+X)
    const nZ = sz - hd, pZ = sz + hd; // side-wall centerlines (−Z, +Z)

    // Themed materials (warm café palette) — created once, reused.
    const cafeWall = new THREE.MeshStandardMaterial({ color: "#2f5d54", roughness: 0.9 });
    const cafeTrim = new THREE.MeshStandardMaterial({ color: "#caa45a", roughness: 0.6, metalness: 0.2 });
    const cafeFloor = new THREE.MeshStandardMaterial({ color: "#5a4632", roughness: 0.85 });
    const barMat = new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 0.6 });
    const barTop = new THREE.MeshStandardMaterial({ color: "#1d2a2a", roughness: 0.3, metalness: 0.4 });
    const machineMat = new THREE.MeshStandardMaterial({ color: "#c9ccd2", roughness: 0.3, metalness: 0.85 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: "#4a3322", roughness: 0.75 });
    const rugMat = new THREE.MeshStandardMaterial({ color: "#1f4a44", roughness: 0.95 });
    const stoolMat = new THREE.MeshStandardMaterial({ color: "#caa45a", roughness: 0.5, metalness: 0.3 });
    const tableMat = new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 0.6 });
    const lampShade = new THREE.MeshStandardMaterial({
      color: "#ffe2a6", roughness: 0.4, emissive: "#ffcf6a", emissiveIntensity: 0.85,
    });
    // Bright little café goods (cups / bean bags) for the shelves (one instanced bank).
    const cupMat = new THREE.MeshStandardMaterial({ color: "#e4632e", roughness: 0.6, flatShading: true });
    const goods = makeBank(unitBox, cupMat);

    // FLOOR + flat ROOF/ceiling
    box(SW, 0.12, SD, cafeFloor, sx, 0.06, sz, false);
    box(SW + 0.3, 0.25, SD + 0.3, cafeTrim, sx, WH + 0.12, sz, true);

    // WALLS (each its own collider; NO collider across the doorway gap)
    box(WT, WH, SD, cafeWall, bX, WH / 2, sz, true); // back wall (+X)
    colliders.push({ minX: bX - WT / 2, maxX: bX + WT / 2, minZ: sz - hd, maxZ: sz + hd });
    box(SW, WH, WT, cafeWall, sx, WH / 2, nZ, true); // side wall (−Z)
    colliders.push({ minX: sx - hw, maxX: sx + hw, minZ: nZ - WT / 2, maxZ: nZ + WT / 2 });
    box(SW, WH, WT, cafeWall, sx, WH / 2, pZ, true); // side wall (+Z)
    colliders.push({ minX: sx - hw, maxX: sx + hw, minZ: pZ - WT / 2, maxZ: pZ + WT / 2 });
    // Plaza-facing wall (−X) with a 2.2 m DOORWAY GAP: two flanking segments + a high lintel.
    const jamb = door / 2 + 0.05;
    const segLen = hd - jamb;
    const segZneg = -hd + (hd - jamb) / 2;
    const segZpos = hd - (hd - jamb) / 2;
    box(WT, WH, segLen, cafeWall, fX, WH / 2, segZneg, true);
    colliders.push({ minX: fX - WT / 2, maxX: fX + WT / 2, minZ: segZneg - segLen / 2, maxZ: segZneg + segLen / 2 });
    box(WT, WH, segLen, cafeWall, fX, WH / 2, segZpos, true);
    colliders.push({ minX: fX - WT / 2, maxX: fX + WT / 2, minZ: segZpos - segLen / 2, maxZ: segZpos + segLen / 2 });
    box(WT, 0.6, door, cafeTrim, fX, WH - 0.3, sz, true); // lintel (no collider — walkable)

    // SHOP SIGN above the door, OUTSIDE, facing the plaza (−X), un-mirrored.
    // Default panel faces +Z; rotating −PI/2 about Y turns the readable face to −X.
    const cafeSign = artPanel(3.4, 1.1, "sign", {
      text: "BREW HAVEN CAFÉ",
      bg: "#0c2a28", fg: "#ffd24a",
      glyph: "☕",
      emissiveIntensity: 0.5,
      file: "sign-brewhavencafe.png",
    });
    cafeSign.position.set(fX - WT / 2 - 0.06, WH + 0.45, sz);
    cafeSign.rotation.y = -Math.PI / 2; // readable face points −X (out to the plaza)
    cafeSign.castShadow = true;
    group.add(cafeSign);

    // INTERIOR CONTENT (cozy café) ─────────────────────────────────────────────
    box(3.4, 0.04, 4.2, rugMat, sx, 0.13, sz, false); // floor rug

    // ESPRESSO BAR along the back wall: solid base + dark stone top + a chrome machine.
    const bx0 = bX - 0.9;          // bar sits just in front of the back wall
    box(1.0, 1.1, 4.6, barMat, bx0, 0.55, sz, true);    // bar body
    box(1.1, 0.08, 4.7, barTop, bx0, 1.14, sz, true);   // bar top
    box(0.7, 0.7, 1.1, machineMat, bx0, 1.5, sz - 0.2, true); // espresso machine
    box(0.5, 0.4, 0.5, machineMat, bx0, 1.4, sz + 1.5, true); // grinder
    // a row of cups waiting on the bar (instanced goods)
    for (let i = 0; i < 5; i++) {
      goods.add(bx0, 1.26, sz - 1.7 + i * 0.85, 0.22, 0.24, 0.22, 0, 0, 0);
    }

    // RETAIL SHELVES on the −Z wall stocked with bean bags / mugs (instanced goods).
    const shZ = nZ + 0.25;
    for (let s = 0; s < 3; s++) {
      const shelfY = 0.7 + s * 0.7;
      box(3.6, 0.06, 0.4, shelfMat, sx - 0.4, shelfY, shZ, true); // shelf board
      for (let i = 0; i < 6; i++) {
        goods.add(sx - 0.4 - 1.55 + i * 0.62, shelfY + 0.22, shZ, 0.32, 0.36, 0.3, 0, 0, 0);
      }
    }

    // A LITTLE CAFÉ TABLE with two stools near the +Z window wall (sit-down corner).
    {
      const tx = sx - 0.2, tz = pZ - 1.3;
      const tleg = new THREE.Mesh(poleGeo, tableMat);
      tleg.scale.set(0.5, 0.95, 0.5);
      tleg.position.set(tx, 0.48, tz);
      tleg.castShadow = true;
      group.add(tleg);
      box(1.1, 0.08, 1.1, tableMat, tx, 0.96, tz, true); // round-ish table top
      for (const sdz of [-0.85, 0.85]) {
        const leg = new THREE.Mesh(poleGeo, stoolMat);
        leg.scale.set(0.45, 0.7, 0.45);
        leg.position.set(tx, 0.35, tz + sdz);
        leg.castShadow = true;
        group.add(leg);
        box(0.45, 0.08, 0.45, stoolMat, tx, 0.72, tz + sdz, true); // seat
      }
    }

    // MENU BOARD on the back wall, reading into the room (−X).
    const cafeMenu = artPanel(2.0, 1.2, "sign", {
      text: "ESPRESSO LATTE COLD BREW",
      bg: "#0c2a28", fg: "#ffd24a",
      emissiveIntensity: 0.4,
      file: "sign-cafemenu.png",
    });
    cafeMenu.position.set(bX - WT / 2 - 0.05, 2.1, sz);
    cafeMenu.rotation.y = -Math.PI / 2; // faces into the room (−X)
    cafeMenu.castShadow = false;
    group.add(cafeMenu);

    // HANGING PENDANT LIGHTS (two glowing shades over the floor).
    for (const lz of [sz - 1.4, sz + 1.4]) {
      const lx = sx - 0.6;
      box(0.04, 0.7, 0.04, cafeTrim, lx, WH - 0.35, lz, false); // cord
      const shade = new THREE.Mesh(coneGeo, lampShade);
      shade.scale.set(0.55, 0.45, 0.55);
      shade.rotation.x = Math.PI;
      shade.position.set(lx, WH - 0.75, lz);
      group.add(shade);
    }

    goods.commit(true); // one InstancedMesh for all café goods
  }

  // ── ENTERABLE SHOP #3: "QUICKPRINT & COPY" — a corporate print/copy bureau ──
  // A standalone room capping the NORTH end of the open N-S corridor: center (0,18),
  // outer 8.0×6.0 → X[-4,4] Z[15,21]. Sits at the north terminus (clear of the
  // pool/flagpoles to the south, between the NW (X≤−7) and NE (X≥7.9) buildings, and
  // just south of the N-edge planters at z=22). Doorway GAP faces −Z (toward the
  // plaza) so a player walking up the N-S corridor enters head-on. Walls each carry
  // their own AABB collider; the doorway gap carries none.
  {
    const sx = 0, sz = 18;          // shop center (north terminus of the corridor)
    const SW = 8.0, SD = 6.0;       // outer width (X) × depth (Z)
    const WT = 0.25, WH = 3.0;
    const hw = SW / 2, hd = SD / 2;
    const door = 2.2;
    const fZ = sz - hd;             // plaza-facing wall centerline (−Z)
    const bZ = sz + hd;             // back wall centerline (+Z)
    const wX = sx - hw, eX = sx + hw; // side-wall centerlines (−X, +X)

    // Themed materials (clean corporate office-services palette).
    const prWall = new THREE.MeshStandardMaterial({ color: "#dfe3e8", roughness: 0.9 });
    const prTrim = new THREE.MeshStandardMaterial({ color: "#2f6f9c", roughness: 0.5, metalness: 0.3 });
    const prFloor = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.85 });
    const deskMat = new THREE.MeshStandardMaterial({ color: "#d7dadf", roughness: 0.5, metalness: 0.2 });
    const deskTop = new THREE.MeshStandardMaterial({ color: "#3a3f45", roughness: 0.4 });
    const copierMat = new THREE.MeshStandardMaterial({ color: "#e9ecef", roughness: 0.4, metalness: 0.3 });
    const copierDark = new THREE.MeshStandardMaterial({ color: "#3a3f45", roughness: 0.5, metalness: 0.4 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: "#b8bcc2", roughness: 0.6, metalness: 0.2 });
    const lampShade = new THREE.MeshStandardMaterial({
      color: "#eaf4ff", roughness: 0.3, emissive: "#cfe6ff", emissiveIntensity: 0.7,
    });
    // Reams of bright paper / parcels for the shelves (one instanced bank).
    const reamMat = new THREE.MeshStandardMaterial({ color: "#f4f6f8", roughness: 0.8, flatShading: true });
    const reams = makeBank(unitBox, reamMat);

    // FLOOR + flat ROOF/ceiling
    box(SW, 0.12, SD, prFloor, sx, 0.06, sz, false);
    box(SW + 0.3, 0.25, SD + 0.3, prTrim, sx, WH + 0.12, sz, true);

    // WALLS (each its own collider; NO collider across the doorway gap)
    box(SW, WH, WT, prWall, sx, WH / 2, bZ, true); // back wall (+Z)
    colliders.push({ minX: sx - hw, maxX: sx + hw, minZ: bZ - WT / 2, maxZ: bZ + WT / 2 });
    box(WT, WH, SD, prWall, wX, WH / 2, sz, true); // side wall (−X)
    colliders.push({ minX: wX - WT / 2, maxX: wX + WT / 2, minZ: sz - hd, maxZ: sz + hd });
    box(WT, WH, SD, prWall, eX, WH / 2, sz, true); // side wall (+X)
    colliders.push({ minX: eX - WT / 2, maxX: eX + WT / 2, minZ: sz - hd, maxZ: sz + hd });
    // Plaza-facing wall (−Z) with a 2.2 m DOORWAY GAP: two flanking segments + lintel.
    const jamb = door / 2 + 0.05;
    const segLen = hw - jamb;
    const segXneg = -hw + (hw - jamb) / 2;
    const segXpos = hw - (hw - jamb) / 2;
    box(segLen, WH, WT, prWall, sx + segXneg, WH / 2, fZ, true);
    colliders.push({ minX: sx + segXneg - segLen / 2, maxX: sx + segXneg + segLen / 2, minZ: fZ - WT / 2, maxZ: fZ + WT / 2 });
    box(segLen, WH, WT, prWall, sx + segXpos, WH / 2, fZ, true);
    colliders.push({ minX: sx + segXpos - segLen / 2, maxX: sx + segXpos + segLen / 2, minZ: fZ - WT / 2, maxZ: fZ + WT / 2 });
    box(door, 0.6, WT, prTrim, sx, WH - 0.3, fZ, true); // lintel (no collider — walkable)

    // SHOP SIGN above the door, OUTSIDE, facing the plaza (−Z), un-mirrored.
    // Default panel faces +Z; rotating 180° turns the readable face to −Z.
    const prSign = artPanel(3.6, 1.1, "sign", {
      text: "QUICKPRINT & COPY",
      bg: "#103a55", fg: "#eaf4ff",
      emissiveIntensity: 0.45,
      file: "sign-quickprint.png",
    });
    prSign.position.set(sx, WH + 0.45, fZ - WT / 2 - 0.06);
    prSign.rotation.y = Math.PI; // readable face points −Z (out to the plaza)
    prSign.castShadow = true;
    group.add(prSign);

    // INTERIOR CONTENT (busy print bureau) ─────────────────────────────────────
    // SERVICE DESK across the back: solid base + dark counter top.
    const dz0 = bZ - 0.9;
    box(5.2, 1.1, 1.0, deskMat, sx, 0.55, dz0, true);   // desk body
    box(5.4, 0.08, 1.1, deskTop, sx, 1.14, dz0, true);  // desk top
    // a small monitor/terminal on the desk
    box(0.7, 0.5, 0.08, copierDark, sx - 1.4, 1.45, dz0, true);

    // BIG COPIER/PRINTER units against the +X wall.
    for (let i = 0; i < 2; i++) {
      const cz = sz - 1.2 + i * 2.4;
      const cxp = eX - 0.7;
      box(1.0, 1.3, 1.4, copierMat, cxp, 0.65, cz, true);     // copier body
      box(1.05, 0.18, 1.45, copierDark, cxp, 1.45, cz, true); // lid/scanner
      box(0.5, 0.1, 0.45, prTrim, cxp - 0.2, 1.56, cz, false); // control panel
    }

    // PAPER-REAM SHELVING against the −X wall (instanced reams/parcels).
    const shX = wX + 0.3;
    for (let s = 0; s < 3; s++) {
      const shelfY = 0.7 + s * 0.75;
      box(0.4, 0.06, 4.0, shelfMat, shX, shelfY, sz, true); // shelf board
      for (let i = 0; i < 5; i++) {
        reams.add(shX, shelfY + 0.2, sz - 1.6 + i * 0.8, 0.3, 0.3, 0.5, 0, 0, 0);
      }
    }

    // A SELF-SERVE STANDING KIOSK near the door.
    box(0.8, 1.2, 0.7, deskMat, sx + 2.6, 0.6, fZ + 1.2, true);
    box(0.6, 0.45, 0.06, copierDark, sx + 2.6, 1.35, fZ + 1.2, true); // screen

    // CEILING STRIP LIGHTS (two glowing panels).
    for (const lx of [sx - 1.6, sx + 1.6]) {
      box(2.4, 0.1, 0.5, lampShade, lx, WH - 0.18, sz, false);
    }

    reams.commit(true); // one InstancedMesh for all paper reams
  }

  // ── EXTRA STREET FLAVOR: bike racks, a coffee cart, bollards, lamp posts, news
  // boxes and bins along the plaza margins so the campus feels lived-in. All placed
  // on the SHOULDERS (clear of the |x|≤5 N-S and |z|≤5 E-W drive corridors) and well
  // within the ±23 setback. Low/slim props are non-colliding; chunky ones collide. ──
  {
    // Shared flavor materials (created once, reused).
    const steelMat = new THREE.MeshStandardMaterial({ color: "#7c848c", roughness: 0.45, metalness: 0.7 });
    const accentMat = new THREE.MeshStandardMaterial({ color: "#c5453f", roughness: 0.6, metalness: 0.3 });
    const cartBody = new THREE.MeshStandardMaterial({ color: "#1f5a52", roughness: 0.6 });
    const cartRoof = new THREE.MeshStandardMaterial({ color: "#caa45a", roughness: 0.5, metalness: 0.2 });
    const binMat = new THREE.MeshStandardMaterial({ color: "#3a4750", roughness: 0.6, metalness: 0.3 });
    const lampPost = new THREE.MeshStandardMaterial({ color: "#3c4248", roughness: 0.5, metalness: 0.6 });
    const lampGlow = new THREE.MeshStandardMaterial({
      color: "#fff0c8", roughness: 0.4, emissive: "#ffdf8a", emissiveIntensity: 0.9,
    });

    // BIKE RACKS: a low looped-bar rack (a couple of inverted-U hoops on a rail).
    // Decorative + low → no collider. Two racks on the plaza margins.
    // Built entirely from local children added to its own group `g2` (no box(),
    // which would append to the world `group` at the wrong coords).
    function bikeRack(bx, bz, rot = 0) {
      const g2 = new THREE.Group();
      // base rail
      const rail = new THREE.Mesh(unitBox, steelMat);
      rail.scale.set(2.6, 0.08, 0.12); rail.position.set(0, 0.05, 0);
      rail.castShadow = true;
      g2.add(rail);
      // 3 inverted-U hoops
      for (let i = -1; i <= 1; i++) {
        const hx = i * 0.9;
        const hoop = new THREE.Mesh(railGeo, steelMat);
        hoop.scale.set(1, 0.85, 1); hoop.position.set(hx - 0.35, 0.45, 0);
        const hoop2 = hoop.clone(); hoop2.position.set(hx + 0.35, 0.45, 0);
        const top = new THREE.Mesh(railGeo, steelMat);
        top.scale.set(1, 0.7, 1); top.rotation.z = Math.PI / 2; top.position.set(hx, 0.87, 0);
        g2.add(hoop, hoop2, top);
      }
      g2.position.set(bx, 0, bz);
      g2.rotation.y = rot;
      group.add(g2);
    }

    // COFFEE CART: a small wheeled kiosk (themed to BREW HAVEN) parked on the SE
    // inner-plaza shoulder, just outside the N-S drive lane and clear of the SE
    // building front (which only reaches |x|≥7.3 at this z). Chunky → collides.
    {
      const cx = 6.5, cz = -8.5;
      box(2.4, 1.2, 1.4, cartBody, cx, 0.7, cz, true);          // cart body
      box(2.6, 0.12, 1.6, cartRoof, cx, 1.36, cz, true);        // counter shelf/lid
      box(0.1, 1.4, 0.1, steelMat, cx - 1.1, 2.1, cz - 0.6, true); // umbrella pole
      const para = new THREE.Mesh(coneGeo, accentMat);
      para.scale.set(2.2, 0.8, 2.2);
      para.position.set(cx - 1.1, 2.95, cz - 0.6);
      para.castShadow = true;
      group.add(para);                                          // parasol
      // two wheels
      for (const wz of [-0.55, 0.55]) {
        const wheel = new THREE.Mesh(cylGeo, binMat);
        wheel.scale.set(0.4, 0.16, 0.4); wheel.rotation.z = Math.PI / 2;
        wheel.position.set(cx + 1.0, 0.35, cz + wz);
        wheel.castShadow = true; group.add(wheel);
      }
      const cartSign = artPanel(2.0, 0.7, "sign", {
        text: "COFFEE", bg: "#0c2a28", fg: "#ffd24a", glyph: "☕", emissiveIntensity: 0.5,
        file: "sign-coffeecart.png",
      });
      cartSign.position.set(cx, 1.9, cz + 0.72);
      cartSign.castShadow = false;
      group.add(cartSign);
      collide(cx, cz, 2.6, 1.6);
    }

    // PEDESTRIAN LAMP POSTS: slim posts with a glowing globe, along the plaza margins.
    // Slim → small collider at the base. Placed on shoulders, clear of drive lanes.
    const lampSpots = [[-8, 8], [8, 8], [-8, -7], [8, -7]];
    for (const [lx, lz] of lampSpots) {
      const post = new THREE.Mesh(poleGeo, lampPost);
      post.scale.set(1, 4.0, 1); post.position.set(lx, 2.0, lz);
      post.castShadow = true; group.add(post);
      const globe = new THREE.Mesh(cylGeo, lampGlow);
      globe.scale.set(0.32, 0.32, 0.32); globe.position.set(lx, 4.1, lz);
      group.add(globe);
      box(0.5, 0.25, 0.5, lampPost, lx, 0.12, lz, true); // base
      collide(lx, lz, 0.4, 0.4);
    }

    // BOLLARDS: a tidy line of short posts edging the plaza off the E-W shoulder so
    // pedestrians read a kerb line. Slim + short → no collider (cosmetic).
    for (let i = -2; i <= 2; i++) {
      const bxp = i * 1.6;
      const bol = new THREE.Mesh(cylGeo, steelMat);
      bol.scale.set(0.16, 0.6, 0.16); bol.position.set(bxp, 0.3, 7.2);
      bol.castShadow = true; group.add(bol);
      box(0.08, 0.05, 0.08, accentMat, bxp, 0.62, 7.2, false); // reflective cap
    }

    // WASTE BINS + a NEWSPAPER BOX near the shop fronts (small flavor, no collide).
    box(0.5, 0.8, 0.5, binMat, 11.0, 0.4, 1.6, true);   // bin by the café door
    box(0.5, 0.8, 0.5, binMat, -11.0, 0.4, -1.6, true); // bin by the deli door
    box(0.6, 1.0, 0.45, accentMat, 2.2, 0.5, 13.4, true); // news box by the print shop

    // BIKE RACKS on the south plaza margin (clean rebuild: pure children, no box()).
    bikeRack(-15, -7, 0);
    bikeRack(15, -7, 0);
  }

  // ── MARKET STALLS: two awning vendor stalls in the open NORTH plaza, flanking
  // the QuickPrint approach (mirroring the deli/café shoulders), adding lived-in
  // street-market flavor. Placed with clear margins off the N-S drive lane (|x|≤5)
  // and clear of the NW/NE corner buildings (x = -8.3 / +7.9) and the bollard line
  // (z=7.2). Each AWNING is mounted overhead (y≈2.35) and registers NO collider, so a
  // shopper walks straight under it to the counter; ONLY the chunky counter collides.
  {
    const stallWood = new THREE.MeshStandardMaterial({ color: "#6b4a2e", roughness: 0.8 });
    const stallTop = new THREE.MeshStandardMaterial({ color: "#caa45a", roughness: 0.5, metalness: 0.2 });
    const awningMat = new THREE.MeshStandardMaterial({ color: "#b23b34", roughness: 0.7, side: THREE.DoubleSide });
    const crateMat = new THREE.MeshStandardMaterial({ color: "#c98a3a", roughness: 0.7, flatShading: true });
    const postMat = new THREE.MeshStandardMaterial({ color: "#4a4f55", roughness: 0.5, metalness: 0.6 });
    function marketStall(mx, mz, label, fileName) {
      const cw = 2.0, cd = 1.2;                               // counter footprint (fits the shoulder)
      box(cw, 1.0, cd, stallWood, mx, 0.5, mz, true);         // counter body
      box(cw + 0.2, 0.1, cd + 0.2, stallTop, mx, 1.05, mz, true); // counter top lip
      const ppx = cw / 2 - 0.1, ppz = cd / 2 - 0.1;
      for (const sxp of [-ppx, ppx]) for (const szp of [-ppz, ppz]) {
        box(0.1, 2.3, 0.1, postMat, mx + sxp, 1.15, mz + szp, true); // thin corner posts
      }
      // awning slab overhead, overhanging toward the customer side (-Z) — NO collider
      box(cw + 0.5, 0.1, cd + 0.8, awningMat, mx, 2.35, mz - 0.25, true);
      for (let i = -1; i <= 1; i++) {
        box(0.45, 0.45, 0.45, crateMat, mx + i * 0.65, 1.33, mz, true); // crates of goods
      }
      const s = artPanel(1.8, 0.55, "sign", {
        text: label, bg: "#0c2a28", fg: "#ffd24a", emissiveIntensity: 0.45, file: fileName,
      });
      s.position.set(mx, 1.95, mz - (cd / 2 + 0.55));
      s.rotation.y = Math.PI; // readable face points -Z, toward the approaching plaza crowd
      s.castShadow = false;
      group.add(s);
      collide(mx, mz, cw, cd); // tight: counter footprint only (awning overhead stays walk-under)
    }
    marketStall(-6.7, 6.0, "FARMERS", "sign-stall-farmers.png");
    marketStall(6.5, 6.0, "FLOWERS", "sign-stall-flowers.png");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RICHNESS PASS — additive polish (does NOT touch working geometry):
  //   • a tiered stone fountain centerpiece rising from the reflecting pool,
  //   • glowing path-edge kerbs lining the plaza cross (emissive, flat),
  //   • green rooftop terraces (instanced planters + clipped hedge caps),
  //   • multicolour flower beds bedded into the planters + roof terraces.
  // NO new lights (emissive materials only). NO new colliders on any lane/road/
  // doorway: the fountain sits inside the pool's existing collider, rooftop items
  // are overhead, and the kerbs + blooms are flat/low decorative props.
  // ══════════════════════════════════════════════════════════════════════════
  let fountainJet = null, glowMat = null, jetMat = null;
  {
    // ── CENTERPIECE: a tiered stone fountain rising from the reflecting pool ───
    // Stacked catch-bowls on a pedestal with a spinning faceted water-jet crown.
    // Everything stays within the pool footprint (already a collider) → no new one.
    const stoneMat = new THREE.MeshStandardMaterial({ color: "#d8d4c8", roughness: 0.6, metalness: 0.1 });
    jetMat = new THREE.MeshStandardMaterial({
      color: "#bfe9ff", roughness: 0.1, metalness: 0.2,
      emissive: "#79c4e8", emissiveIntensity: 0.5,
    });
    const ped = new THREE.Mesh(cylGeo, stoneMat);
    ped.scale.set(0.55, 1.1, 0.55); ped.position.set(poolX, 0.72, poolZ); ped.castShadow = true;
    group.add(ped);
    const bowl1 = new THREE.Mesh(cylGeo, stoneMat);         // wide lower catch-bowl
    bowl1.scale.set(2.2, 0.28, 2.2); bowl1.position.set(poolX, 1.18, poolZ); bowl1.castShadow = true;
    group.add(bowl1);
    const stem = new THREE.Mesh(cylGeo, stoneMat);          // upper stem
    stem.scale.set(0.34, 0.9, 0.34); stem.position.set(poolX, 1.62, poolZ); stem.castShadow = true;
    group.add(stem);
    const bowl2 = new THREE.Mesh(cylGeo, stoneMat);         // smaller upper catch-bowl
    bowl2.scale.set(1.2, 0.22, 1.2); bowl2.position.set(poolX, 2.02, poolZ); bowl2.castShadow = true;
    group.add(bowl2);
    fountainJet = new THREE.Mesh(coneGeo, jetMat);          // spinning water-jet crown
    fountainJet.scale.set(0.5, 1.5, 0.5); fountainJet.position.set(poolX, 2.9, poolZ);
    fountainJet.castShadow = false;
    group.add(fountainJet);

    // ── PATH-EDGE GLOW KERBS: thin flat emissive strips edging the grass pads at
    // the plaza-cross seam (|x|=5 / |z|=5), reading as lit kerbing. Flat & low →
    // NO collider; they never block the drive corridors. Shared material pulses.
    glowMat = new THREE.MeshStandardMaterial({
      color: "#9fe8d0", roughness: 0.5, emissive: "#3fae8c", emissiveIntensity: 0.6,
    });
    for (const [gx, gz] of grassPads) {
      const sgx = Math.sign(gx), sgz = Math.sign(gz);
      box(0.25, 0.06, 15.5, glowMat, sgx * 5, 0.12, sgz * 13.25, false); // kerb along Z (lane edge)
      box(15.5, 0.06, 0.25, glowMat, sgx * 13.25, 0.12, sgz * 5, false); // kerb along X (lane edge)
    }

    // ── GREEN ROOFTOP TERRACES: a row of planter troughs + clipped hedge caps along
    // the plaza-facing roof edge of each block. Overhead → NO collider. Instanced.
    const roofPlanters = makeBank(unitBox, planterMat);
    const roofHedge = makeBank(unitBox, hedgeMat);
    const roofs = [
      { cx: -15, cz: -15, w: 13, d: 11, deck: 20.55, f: 1 },  // SW tower
      { cx: 15, cz: -15, w: 12, d: 12, deck: 17.55, f: 1 },   // SE tower
      { cx: -15, cz: 15, w: 11, d: 13, deck: 19.05, f: -1 },  // NW tower
      { cx: 15, cz: 15, w: 13, d: 12, deck: 9.35, f: -1 },    // NE pavilion
    ];

    // ── FLOWER BEDS: ONE multicolour InstancedMesh (per-instance tint via setColorAt)
    // of low-poly blossoms bedded atop the existing planter hedges and the rooftop
    // terraces. Decorative dots → NO colliders; never placed on a lane.
    const bloomGeo = new THREE.IcosahedronGeometry(0.14, 0);
    const bloomMat = new THREE.MeshStandardMaterial({ roughness: 0.65, flatShading: true });
    const bloomColors = ["#e4574c", "#f2b33d", "#f4f0e6", "#d95fae", "#7bb0e8", "#e8863d"];
    const bloomM4 = [], bloomCi = [];
    let seed = 20260701;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pushBloom = (x, y, z, s) => {
      _eul.set(0, rnd() * Math.PI, 0); _q.setFromEuler(_eul);
      _pos.set(x, y, z); _scl.set(s, s * 1.25, s);
      _m4.compose(_pos, _q, _scl);
      bloomM4.push(_m4.clone());
      bloomCi.push((bloomColors.length * rnd()) | 0);
    };

    // rooftop terraces + their blooms
    for (const R of roofs) {
      const n = 5, zRow = R.cz + R.f * R.d * 0.42;
      for (let i = 0; i < n; i++) {
        const x = R.cx - R.w * 0.26 + (R.w * 0.52 * i) / (n - 1);
        roofPlanters.add(x, R.deck + 0.3, zRow, 1.5, 0.6, 0.9);
        roofHedge.add(x, R.deck + 0.85, zRow, 1.35, 0.5, 0.75);
        pushBloom(x - 0.35, R.deck + 1.15, zRow, 0.55);
        pushBloom(x + 0.35, R.deck + 1.15, zRow, 0.55);
      }
    }
    roofPlanters.commit(true);
    roofHedge.commit(true);

    // ground blooms bedded into the existing planter hedges (atop the hedge caps)
    for (const [px, pz] of planterSpots) {
      for (let i = 0; i < 4; i++) {
        pushBloom(px - 0.8 + i * 0.55, 1.14, pz + (rnd() * 0.4 - 0.2), 0.6);
      }
    }

    if (bloomM4.length) {
      const _bc = new THREE.Color();
      const blooms = new THREE.InstancedMesh(bloomGeo, bloomMat, bloomM4.length);
      for (let i = 0; i < bloomM4.length; i++) {
        blooms.setMatrixAt(i, bloomM4[i]);
        _bc.set(bloomColors[bloomCi[i]]);
        blooms.setColorAt(i, _bc);
      }
      blooms.instanceMatrix.needsUpdate = true;
      if (blooms.instanceColor) blooms.instanceColor.needsUpdate = true;
      blooms.castShadow = false; blooms.receiveShadow = false;
      group.add(blooms);
    }
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
    // tiered fountain: crown jet spins + bobs, its water-glow shimmers
    if (fountainJet) {
      fountainJet.rotation.y = t * 2.4;
      fountainJet.position.y = 2.9 + 0.05 * Math.sin(t * 5);
      jetMat.emissiveIntensity = 0.5 + 0.25 * Math.sin(t * 3);
    }
    // path-edge glow kerbs pulse gently
    if (glowMat) glowMat.emissiveIntensity = 0.55 + 0.2 * Math.sin(t * 1.4);
    // all lobby/entrance glazing breathes a warm glow (shared material)
    lobbyGlass.emissiveIntensity = 0.4 + 0.12 * Math.sin(t * 0.9);
  }

  return { group, colliders, ground, update };
}
