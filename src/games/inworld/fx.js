// Faithful vanilla-JS (ESM) port of the original effects pipeline —
// src/scene/fx.ts (CPU particle pools: water splashes, fireball explosions,
// big ship-hit blasts, missile exhaust, ember smoke), src/scene/debris.ts
// (rigid-body wreck debris) and src/scene/damage.ts (the revealed burning,
// soft-body ship section at a hit cell). NOTHING is approximated: the particle
// counts, spawn distributions, velocities, lifetimes, growth, gravity, drag,
// colours, the soft point-sprite shader and the elastic squash physics are the
// SAME numbers as the originals. The only changes from the .ts sources are
// TypeScript-only artefacts (type annotations) which have no runtime effect.
//
// SCALE. The originals authored everything at the console CELL = 10 (layout.ts):
// metres of motion, particle sizes, gravity etc. are all in those units. The
// in-world board uses a much smaller CELL, so the caller passes `cell` and we
// derive S = cell / 10 and multiply every SPATIAL quantity (positions,
// velocities, sizes, growth, gravity) by S at spawn time, integrating directly
// in the board's local space. Per-second RATES that are dimensionless (life,
// maxLife, drag) are left untouched so the TIMING is byte-identical to the
// original. The point-sprite shader keeps the original `320` screen factor; with
// `size` pre-scaled by S and the real in-world view depth, points read correctly.
//
// Everything is CPU-driven, parented to a caller-provided root Group (so it
// inherits the board's transform + per-seat orientation) and fully disposable.

import * as THREE from "three";

const ORIGINAL_CELL = 10;

// ---------------------------------------------------------------------------
// Soft round sprite (radial-gradient alpha) — verbatim from fx.ts softSprite().
// ---------------------------------------------------------------------------
function softSprite() {
  const canCreate = typeof document !== "undefined" && document.createElement;
  if (!canCreate) {
    // Headless (npm run check / node tests never construct FX) — a 1px texture.
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  // True soft falloff so overlapping additive quads read as round glows, not
  // clipped rounded-squares.
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.75)");
  g.addColorStop(0.55, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 pcolor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = alpha;
    vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D map;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor, t.a * vAlpha);
  }
`;

// ---------------------------------------------------------------------------
// A fixed-capacity CPU particle pool rendered as GL points — port of fx.ts
// ParticlePool. The integration loop is identical.
// ---------------------------------------------------------------------------
class ParticlePool {
  constructor(capacity, blending, sprite) {
    this.capacity = capacity;
    this.particles = [];
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.geo = new THREE.BufferGeometry();
    const pa = new THREE.Float32BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    const sa = new THREE.Float32BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    const aa = new THREE.Float32BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.Float32BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", pa);
    this.geo.setAttribute("size", sa);
    this.geo.setAttribute("alpha", aa);
    this.geo.setAttribute("pcolor", ca);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: sprite } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  spawn(p) {
    if (this.particles.length >= this.capacity) return;
    this.particles.push(p);
  }

  update(dt) {
    const arr = this.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) {
        arr.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.vz *= 1 - p.drag * dt;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.size += p.growth * dt;
    }
    const n = Math.min(arr.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const p = arr[i];
      this.pos[i * 3] = p.px;
      this.pos[i * 3 + 1] = p.py;
      this.pos[i * 3 + 2] = p.pz;
      this.size[i] = Math.max(p.size, 0.1);
      // Fade out over the last portion of life; brief fade-in at birth.
      const lifeFrac = p.life / p.maxLife;
      const age = 1 - lifeFrac;
      this.alpha[i] = Math.min(1, lifeFrac * 1.4) * Math.min(1, age * 8 + 0.05);
      this.color[i * 3] = p.r;
      this.color[i * 3 + 1] = p.g;
      this.color[i * 3 + 2] = p.b;
    }
    this.geo.setDrawRange(0, n);
    this.geo.getAttribute("position").needsUpdate = true;
    this.geo.getAttribute("size").needsUpdate = true;
    this.geo.getAttribute("alpha").needsUpdate = true;
    this.geo.getAttribute("pcolor").needsUpdate = true;
  }

  get count() {
    return this.particles.length;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const rand = (a, b) => a + Math.random() * (b - a);

// ===========================================================================
// FX — water splashes + fiery explosions + trails (port of fx.ts FX), now also
// owning the rigid-body debris field (debris.ts) and the burning-section damage
// system (damage.ts) so battleship has a single cosmetic effects handle.
//
// All spatial spawn quantities are multiplied by S = cell/10 so the original
// CELL=10 numbers land at in-world scale. Parented to `root` (the board group).
// ===========================================================================
export class FX {
  constructor(root, cell) {
    this.root = root;
    this.S = (cell || ORIGINAL_CELL) / ORIGINAL_CELL;
    this._sprite = softSprite();
    this.additive = new ParticlePool(4000, THREE.AdditiveBlending, this._sprite);
    this.smoke = new ParticlePool(2000, THREE.NormalBlending, this._sprite);
    this.additive.points.renderOrder = 20;
    this.smoke.points.renderOrder = 19;
    root.add(this.additive.points);
    root.add(this.smoke.points);

    // Rigid-body debris + burning ship sections.
    this.debris = new DebrisField(root, this.S);
    this.damage = new DamageSystem(root, this.S, this);
  }

  update(dt) {
    this.additive.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    this.damage.update(dt);
  }

  // True while any particle/debris/damage element is still alive — lets the
  // host idle its rAF when nothing is animating.
  get active() {
    return (
      this.additive.count > 0 ||
      this.smoke.count > 0 ||
      this.debris.active ||
      this.damage.active
    );
  }

  // ── helpers: spawn in ORIGINAL units, scaled by S into board-local space ──
  _add(pool, p) {
    const S = this.S;
    pool.spawn({
      px: p.px * S, py: p.py * S, pz: p.pz * S,
      vx: p.vx * S, vy: p.vy * S, vz: p.vz * S,
      life: p.life, maxLife: p.maxLife,
      size: p.size * S, growth: p.growth * S,
      r: p.r, g: p.g, b: p.b,
      gravity: p.gravity * S, drag: p.drag,
    });
  }

  /** Short exhaust puff behind a flying missile. `at` is in BOARD-LOCAL space. */
  missileTrail(at) {
    const S = this.S;
    // Convert the board-local anchor back into original units so the per-particle
    // offsets (authored in original units) compose correctly after the *S scale.
    const x = at.x / S, y = at.y / S, z = at.z / S;
    this._add(this.smoke, {
      px: x, py: y, pz: z,
      vx: rand(-2, 2), vy: rand(2, 7), vz: rand(-2, 2),
      life: rand(0.5, 1.0), maxLife: 1.0, size: rand(2, 4.5), growth: 6,
      r: 0.55, g: 0.55, b: 0.56, gravity: -3, drag: 1.0,
    });
    this._add(this.additive, {
      px: x, py: y, pz: z,
      vx: rand(-3, 3), vy: rand(-3, 3), vz: rand(-3, 3),
      life: rand(0.15, 0.35), maxLife: 0.35, size: rand(1.5, 3), growth: -3,
      r: 1.0, g: rand(0.6, 0.85), b: 0.2, gravity: 0, drag: 2,
    });
  }

  /** Slow rising smoke + embers from a burning wreck. `at` in BOARD-LOCAL space. */
  emberSmoke(at) {
    const S = this.S;
    const x = at.x / S, y = at.y / S, z = at.z / S;
    this._add(this.smoke, {
      px: x + rand(-2, 2), py: y + 2, pz: z + rand(-2, 2),
      vx: rand(-1, 1), vy: rand(5, 10), vz: rand(-1, 1),
      life: rand(1.5, 2.8), maxLife: 2.8, size: rand(5, 9), growth: 9,
      r: 0.26, g: 0.25, b: 0.24, gravity: -2, drag: 0.7,
    });
    this._add(this.additive, {
      px: x, py: y + 1, pz: z,
      vx: rand(-2, 2), vy: rand(6, 14), vz: rand(-2, 2),
      life: rand(0.4, 1.0), maxLife: 1.0, size: rand(1, 2.5), growth: -1,
      r: 1.0, g: rand(0.5, 0.7), b: 0.15, gravity: 8, drag: 0.5,
    });
  }

  /** Tall near-white water geyser + foam ring for a miss. `at` BOARD-LOCAL. */
  splash(at) {
    const S = this.S;
    const x = at.x / S, y = at.y / S, z = at.z / S;
    const cnt = 160;
    for (let i = 0; i < cnt; i++) {
      const ang = rand(0, Math.PI * 2);
      const spd = rand(6, 24);
      const up = rand(28, 60);
      const tint = rand(0.85, 1.0);
      this._add(this.additive, {
        px: x + rand(-1, 1), py: y + 1, pz: z + rand(-1, 1),
        vx: Math.cos(ang) * spd, vy: up, vz: Math.sin(ang) * spd,
        life: rand(0.7, 1.3), maxLife: 1.3, size: rand(4, 9), growth: -2.5,
        r: 0.95 * tint, g: 0.92 * tint, b: 0.86 * tint, gravity: 75, drag: 0.6,
      });
    }
    // Lingering foam ring at the surface — anchors the impact point.
    for (let i = 0; i < 48; i++) {
      const ang = (i / 48) * Math.PI * 2;
      const spd = rand(10, 18);
      this._add(this.additive, {
        px: x, py: y + 0.5, pz: z,
        vx: Math.cos(ang) * spd, vy: rand(2, 8), vz: Math.sin(ang) * spd,
        life: rand(0.5, 0.8), maxLife: 0.8, size: rand(5, 10), growth: 4,
        r: 0.9, g: 0.97, b: 1.0, gravity: 18, drag: 0.9,
      });
    }
  }

  /** Volumetric fireball (white-hot core → deep-red edge) + sparks + smoke. */
  explosion(at) {
    const S = this.S;
    const x = at.x / S, y = at.y / S, z = at.z / S;
    // Hot core — HDR-overdriven so it blooms past the high bloom threshold.
    for (let i = 0; i < 22; i++) {
      const ang = rand(0, Math.PI * 2);
      const pol = rand(0, Math.PI);
      const spd = rand(8, 24);
      this._add(this.additive, {
        px: x + rand(-2, 2), py: y + 2, pz: z + rand(-2, 2),
        vx: Math.sin(pol) * Math.cos(ang) * spd,
        vy: Math.cos(pol) * spd * 0.6 + 8,
        vz: Math.sin(pol) * Math.sin(ang) * spd,
        life: rand(0.25, 0.5), maxLife: 0.5, size: rand(4, 8), growth: 5,
        r: 4.0, g: rand(2.4, 3.2), b: rand(0.9, 1.5), gravity: 6, drag: 0.9,
      });
    }
    // Outer fireball body — deep orange/red.
    for (let i = 0; i < 44; i++) {
      const ang = rand(0, Math.PI * 2);
      const pol = rand(0, Math.PI);
      const spd = rand(10, 32);
      this._add(this.additive, {
        px: x + rand(-2, 2), py: y + 2, pz: z + rand(-2, 2),
        vx: Math.sin(pol) * Math.cos(ang) * spd,
        vy: Math.cos(pol) * spd * 0.6 + 6,
        vz: Math.sin(pol) * Math.sin(ang) * spd,
        life: rand(0.4, 0.9), maxLife: 0.9, size: rand(7, 13), growth: 6,
        r: 2.2, g: rand(0.7, 1.1), b: rand(0.08, 0.2), gravity: 6, drag: 0.9,
      });
    }
    // Hot sparks.
    for (let i = 0; i < 110; i++) {
      const ang = rand(0, Math.PI * 2);
      const spd = rand(20, 62);
      this._add(this.additive, {
        px: x, py: y + 2, pz: z,
        vx: Math.cos(ang) * spd, vy: rand(15, 58), vz: Math.sin(ang) * spd,
        life: rand(0.5, 1.5), maxLife: 1.5, size: rand(2.5, 5), growth: -0.5,
        r: 2.0, g: rand(0.8, 1.0), b: rand(0.35, 0.6), gravity: 70, drag: 0.3,
      });
    }
    // Warm grey smoke (NormalBlending) — lifted in value so it reads.
    for (let i = 0; i < 70; i++) {
      const ang = rand(0, Math.PI * 2);
      const spd = rand(2, 9);
      const g = rand(0.3, 0.5);
      this._add(this.smoke, {
        px: x + rand(-3, 3), py: y + 3, pz: z + rand(-3, 3),
        vx: Math.cos(ang) * spd, vy: rand(6, 16), vz: Math.sin(ang) * spd,
        life: rand(1.6, 3.0), maxLife: 3.0, size: rand(8, 16), growth: 11,
        r: g * 1.15, g, b: g * 0.85, gravity: -2, drag: 0.8,
      });
    }
  }

  /** A larger ship-hit blast: explosion + white flash + a shockwave ring. */
  bigExplosion(at) {
    this.explosion(at);
    const S = this.S;
    const x = at.x / S, y = at.y / S, z = at.z / S;
    // White-hot flash core.
    for (let i = 0; i < 18; i++) {
      this._add(this.additive, {
        px: x + rand(-1, 1), py: y + 3, pz: z + rand(-1, 1),
        vx: rand(-6, 6), vy: rand(0, 10), vz: rand(-6, 6),
        life: rand(0.12, 0.28), maxLife: 0.28, size: rand(10, 20), growth: 18,
        r: 5, g: 4.4, b: 3.4, gravity: 0, drag: 2,
      });
    }
    // Flat radial shockwave skimming the surface.
    for (let i = 0; i < 48; i++) {
      const ang = (i / 48) * Math.PI * 2 + rand(-0.1, 0.1);
      const spd = rand(40, 70);
      this._add(this.additive, {
        px: x, py: y + 1.2, pz: z,
        vx: Math.cos(ang) * spd, vy: rand(0, 3), vz: Math.sin(ang) * spd,
        life: rand(0.3, 0.55), maxLife: 0.55, size: rand(4, 8), growth: 12,
        r: 2.4, g: rand(1.4, 1.9), b: rand(0.6, 1.0), gravity: 8, drag: 2.4,
      });
    }
    // A tall smoke column.
    for (let i = 0; i < 30; i++) {
      const g = rand(0.22, 0.4);
      this._add(this.smoke, {
        px: x + rand(-2, 2), py: y + 4, pz: z + rand(-2, 2),
        vx: rand(-2, 2), vy: rand(12, 24), vz: rand(-2, 2),
        life: rand(2.4, 4.0), maxLife: 4.0, size: rand(10, 18), growth: 9,
        r: g, g, b: g * 0.92, gravity: -3, drag: 0.6,
      });
    }
  }

  clear() {
    this.additive.particles.length = 0;
    this.smoke.particles.length = 0;
    this.debris.clear();
    this.damage.clear();
  }

  dispose() {
    this.clear();
    this.root.remove(this.additive.points);
    this.root.remove(this.smoke.points);
    this.additive.dispose();
    this.smoke.dispose();
    this.debris.dispose();
    this.damage.dispose();
    this._sprite.dispose?.();
  }
}

// ===========================================================================
// DebrisField — port of debris.ts. Lightweight rigid-body chunks launched from a
// blast that tumble, bounce on the sea surface, settle and sink. All spatial
// numbers scaled by S; SEA level is the board surface (local y≈0).
// ===========================================================================
const DEBRIS_METALS = [0x3a4046, 0x555e64, 0x23282d, 0x6b757c];
const DEBRIS_SEA = -0.5; // original units (≈ board surface after *S)
const DEBRIS_GRAVITY = 44;

class DebrisField {
  constructor(root, S) {
    this.root = root;
    this.S = S;
    this.pieces = [];
    this._mats = DEBRIS_METALS.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.55, roughness: 0.55 })
    );
    this._tintMats = [];
    this._geos = [];
  }

  get active() {
    return this.pieces.length > 0;
  }

  // `at` is in BOARD-LOCAL space; count + optional tint colour match debris.ts.
  burst(at, count, tintColor) {
    const S = this.S;
    let tintMat = null;
    if (tintColor !== undefined && tintColor !== null) {
      tintMat = new THREE.MeshStandardMaterial({ color: tintColor, metalness: 0.3, roughness: 0.7 });
      this._tintMats.push(tintMat);
    }
    for (let i = 0; i < count; i++) {
      const s = 0.5 + Math.random() * 1.9;
      const mat = tintMat && Math.random() < 0.45 ? tintMat : this._mats[(Math.random() * this._mats.length) | 0];
      const geo = new THREE.BoxGeometry(s * S, s * (0.3 + Math.random() * 0.7) * S, s * (0.5 + Math.random()) * S);
      this._geos.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(at);
      mesh.position.y += Math.random() * 2 * S;
      mesh.castShadow = true;
      const ang = Math.random() * Math.PI * 2;
      const out = 8 + Math.random() * 28;
      const vel = new THREE.Vector3(Math.cos(ang) * out * S, (16 + Math.random() * 44) * S, Math.sin(ang) * out * S);
      const angv = new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      this.pieces.push({ mesh, vel, ang: angv, life: 2.6 + Math.random() * 2.2, rest: false });
      this.root.add(mesh);
    }
  }

  update(dt) {
    const S = this.S;
    const sea = DEBRIS_SEA * S;
    const gravity = DEBRIS_GRAVITY * S;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.life -= dt;
      if (!p.rest) {
        p.vel.y -= gravity * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += p.ang.x * dt;
        p.mesh.rotation.y += p.ang.y * dt;
        p.mesh.rotation.z += p.ang.z * dt;
        if (p.mesh.position.y < sea) {
          p.mesh.position.y = sea;
          p.vel.y = -p.vel.y * 0.32; // bounce off the water
          p.vel.x *= 0.55;
          p.vel.z *= 0.55;
          p.ang.multiplyScalar(0.5);
          if (Math.abs(p.vel.y) < 3 * S) p.rest = true;
        }
      } else {
        p.mesh.position.y -= dt * 1.4 * S; // settle / sink
      }
      if (p.life <= 0) {
        this.root.remove(p.mesh);
        this.pieces.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.pieces) this.root.remove(p.mesh);
    this.pieces.length = 0;
  }

  dispose() {
    this.clear();
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) m.dispose();
    for (const m of this._tintMats) m.dispose();
    this._geos.length = 0;
    this._tintMats.length = 0;
  }
}

// ===========================================================================
// DamageSystem / ShipTile — port of damage.ts. A revealed, battle-damaged SECTION
// of the actual ship at a hit cell: a class-coloured warship slice that pops in
// with an elastic soft-body squash, then burns (flickering HDR flames + ember
// smoke). All geometry authored in ORIGINAL units then the group is scaled by S.
// ===========================================================================
const DAMAGE_CELL = 10; // original layout CELL used by the ShipTile geometry

function shade(c, f) {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

class ShipTile {
  constructor(at, hullColor, orientation, structure, S) {
    this.group = new THREE.Group();
    this.fires = [];
    this.smokeTimer = 0;
    this.squash = 0.3;
    this.squashVel = -1.5;
    this.S0 = S; // base in-world scale, composed with the elastic squash each frame
    this._disposables = [];

    // Authored in ORIGINAL units; scaled to the board cell via group.scale.
    this.group.position.copy(at);
    this.group.position.y = 0; // sit on the sea/board surface
    this.group.rotation.y = orientation === "vertical" ? Math.PI / 2 : 0;
    this.group.scale.setScalar(S);

    const CELL = DAMAGE_CELL;
    const len = CELL * 0.92;
    const wide = CELL * 0.52;
    const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, metalness: 0.15, roughness: 0.72 });
    const deckMat = new THREE.MeshStandardMaterial({ color: shade(hullColor, 0.55), metalness: 0.2, roughness: 0.8 });
    this._disposables.push(hullMat, deckMat);

    // Hull slab with a ragged, torn top.
    const hullGeo = new THREE.BoxGeometry(len, 3.4, wide, 3, 1, 2);
    const hp = hullGeo.attributes.position;
    let s = 1337;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
    for (let i = 0; i < hp.count; i++) {
      if (hp.getY(i) > 0) {
        hp.setY(i, hp.getY(i) - rnd() * 1.8);
        hp.setX(i, hp.getX(i) + (rnd() - 0.5) * 1.2);
      }
    }
    hullGeo.computeVertexNormals();
    this._disposables.push(hullGeo);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 1.0;
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.group.add(hull);

    // Deck strip (intact half).
    const deckGeo = new THREE.BoxGeometry(len * 0.5, 0.4, wide * 0.9);
    this._disposables.push(deckGeo);
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(-len * 0.22, 2.7, 0);
    deck.castShadow = true;
    this.group.add(deck);

    // A blown-up plate tilted out of the wound.
    const plateMat = new THREE.MeshStandardMaterial({ color: shade(hullColor, 0.8), metalness: 0.2, roughness: 0.7 });
    const plateGeo = new THREE.BoxGeometry(len * 0.4, 0.35, wide * 0.7);
    this._disposables.push(plateMat, plateGeo);
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(len * 0.22, 3.2, rnd() * 2 - 1);
    plate.rotation.set(rnd() * 0.7, rnd() * 3, 0.6 + rnd() * 0.5);
    plate.castShadow = true;
    this.group.add(plate);

    // Optional surviving structure stub (superstructure / gun) for bigger ships.
    if (structure) {
      const supMat = new THREE.MeshStandardMaterial({ color: shade(hullColor, 1.25), metalness: 0.2, roughness: 0.6 });
      const supGeo = new THREE.BoxGeometry(len * 0.34, 2.2, wide * 0.6);
      this._disposables.push(supMat, supGeo);
      const sup = new THREE.Mesh(supGeo, supMat);
      sup.position.set(-len * 0.18, 4.0, 0);
      sup.rotation.z = 0.12;
      sup.castShadow = true;
      this.group.add(sup);
      const scorchMatB = new THREE.MeshStandardMaterial({ color: 0x0e0f11, metalness: 0.2, roughness: 0.95 });
      const barrelGeo = new THREE.CylinderGeometry(0.18, 0.18, len * 0.5, 8);
      this._disposables.push(scorchMatB, barrelGeo);
      const barrel = new THREE.Mesh(barrelGeo, scorchMatB);
      barrel.rotation.z = Math.PI / 2 + 0.3;
      barrel.position.set(len * 0.05, 4.4, 0);
      this.group.add(barrel);
    }

    // Scorched waterline ring.
    const scorchMat = new THREE.MeshStandardMaterial({ color: 0x0e0f11, metalness: 0.2, roughness: 0.95 });
    const scorchGeo = new THREE.ConeGeometry(CELL * 0.46, 0.1, 18);
    this._disposables.push(scorchMat, scorchGeo);
    const scorch = new THREE.Mesh(scorchGeo, scorchMat);
    scorch.position.y = 0.05;
    this.group.add(scorch);

    // Flames (HDR-bright → bloom) clustered in the wound.
    for (let i = 0; i < 4; i++) {
      const fireMat = new THREE.MeshStandardMaterial({ color: 0xffb24a, emissive: 0xff5a16, emissiveIntensity: 4, roughness: 1 });
      const fireGeo = new THREE.ConeGeometry(0.7 + rnd() * 0.6, 2.4 + rnd() * 2.0, 7);
      this._disposables.push(fireMat, fireGeo);
      const f = new THREE.Mesh(fireGeo, fireMat);
      f.position.set((rnd() - 0.5) * len * 0.7, 2.0 + rnd(), (rnd() - 0.5) * wide * 0.7);
      this.fires.push(f);
      this.group.add(f);
    }
  }

  update(dt, t, fx) {
    // Elastic soft-body squash → settle (damped spring, overshoots past 1).
    const a = -200 * (this.squash - 1) - 12 * this.squashVel;
    this.squashVel += a * dt;
    this.squash += this.squashVel * dt;
    const sy = Math.max(0.15, this.squash);
    const sxz = 1 + (1 - sy) * 0.35;
    // Compose the elastic squash with the base S scale.
    this.group.scale.set(sxz * this.S0, sy * this.S0, sxz * this.S0);

    for (let i = 0; i < this.fires.length; i++) {
      const flick = 0.7 + 0.3 * Math.sin(t * (9 + i * 2) + i);
      this.fires[i].material.emissiveIntensity = 3 + flick * 3;
      this.fires[i].scale.y = (0.85 + flick * 0.4) * sy;
    }
    this.smokeTimer += dt;
    if (this.smokeTimer > 0.22) {
      this.smokeTimer = 0;
      fx.emberSmoke(this.group.position);
    }
  }

  dispose() {
    for (const d of this._disposables) d.dispose?.();
    this._disposables.length = 0;
  }
}

class DamageSystem {
  constructor(root, S, fx) {
    this.root = root;
    this.S = S;
    this.fx = fx;
    this.tiles = [];
    this.t = 0;
  }

  get active() {
    return this.tiles.length > 0;
  }

  // `at` in BOARD-LOCAL space. hullColor is a 0xRRGGBB int. orientation
  // "horizontal"|"vertical". structure = bigger ship gets a surviving stub.
  add(at, hullColor, orientation, structure) {
    const tile = new ShipTile(at, hullColor, orientation, structure, this.S);
    this.tiles.push(tile);
    this.root.add(tile.group);
  }

  update(dt) {
    this.t += dt;
    for (const tile of this.tiles) tile.update(dt, this.t, this.fx);
  }

  clear() {
    for (const tile of this.tiles) {
      this.root.remove(tile.group);
      tile.dispose();
    }
    this.tiles.length = 0;
  }

  dispose() {
    this.clear();
  }
}

export default FX;
