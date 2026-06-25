// Standalone full-screen MAP overlay (press M in-game; main.js wires that later).
//
// createMap(opts) builds its OWN absolutely-positioned <div> overlay (hidden by
// default) appended to document.body, injects its own CSS once, and exposes:
//
//   createMap(opts) -> {
//     open(),            // show the overlay + draw the cached payload
//     close(),           // hide it
//     toggle(),          // open/close
//     isOpen,            // live getter (boolean)
//     render(payload),   // store + (re)draw the map; only redraws while open
//     onTravel,          // assignable: (worldPt) => void, fired on a map click
//   }
//
// opts: { onTravel?(worldPt), parent?=document.body }.
//
// render(payload) — the world is described in WORLD coordinates:
//   {
//     districts: [{ name, x, z, w, d, color }],   // block centre + size (XZ)
//     roads:     [{ x1, z1, x2, z2 }],            // straight road segments
//     water:     { minX, maxX, minZ, maxZ },      // ocean extent (background)
//     islands:   [{ x, z, r, name }],             // discs out in the water
//     player:    { x, z, heading },               // heading: world facing (rad)
//     markers:   [{ x, z, label, kind }],         // POIs (cafe/spawn/shop/poi…)
//   }
// Every field is optional; missing arrays are simply skipped.
//
// It paints a realistic top-down look on a <canvas>: an ocean background, the
// city landmass with a sandy shoreline, the road grid, the coloured + labelled
// district blocks, islands, POI markers, and a player arrow. A SUBTLE VERTICAL
// SQUASH (SQUASH<1) fakes a slightly-angled top-down camera.
//
// ── screen <-> world transform (used for click-to-fast-travel) ────────────────
// A single invertible affine map. With world view bounds {minX,maxX,minZ,maxZ},
// canvas inner size usable = css - 2*INSET, a uniform world scale `s`, and the
// vertical axis additionally squashed (sy = s*SQUASH, sx = s):
//
//   s    = min(usableW / (maxX-minX), usableH / ((maxZ-minZ) * SQUASH))
//   px   = offX + (x      - minX) * sx
//   py   = offZ + (maxZ   - z   ) * sy     // flip z so +z (deeper city) is UP
// invert (a canvas click in CSS px -> WORLD):
//   x    = minX + (px - offX) / sx
//   z    = maxZ - (py - offZ) / sy
//
// Clicking the canvas inverts the pixel under the cursor and calls
// onTravel({ x, z }) with those WORLD coords.

const STYLE_ID = "map-overlay-styles";

const CSS = `
.map-overlay {
  position: fixed; inset: 0; z-index: 60;
  display: flex;
  background: radial-gradient(circle at 50% 38%, rgba(10,32,48,0.82), rgba(4,11,18,0.94));
  backdrop-filter: blur(4px);
  pointer-events: auto;
  font-family: system-ui, -apple-system, sans-serif;
}
.map-overlay.hidden { display: none; }
.map-frame {
  margin: auto;
  width: min(94vw, 1120px);
  height: min(90vh, 840px);
  display: flex; flex-direction: column;
  background: rgba(8,18,28,0.72);
  border: 1px solid rgba(120,180,220,0.25);
  border-radius: 16px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.6);
  overflow: hidden;
}
.map-topbar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: linear-gradient(180deg, rgba(20,42,60,0.92), rgba(12,26,40,0.85));
  border-bottom: 1px solid rgba(120,180,220,0.18);
}
.map-title { font-size: 16px; font-weight: 700; color: #d8ecff; letter-spacing: 0.3px; }
.map-hint  { font-size: 12px; color: #88aecb; flex: 1 1 auto; }
.map-close {
  appearance: none; border: none; cursor: pointer;
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(255,255,255,0.08); color: #d8ecff; font-size: 15px; line-height: 1;
  transition: background 0.15s, color 0.15s;
}
.map-close:hover { background: rgba(255,90,80,0.55); color: #fff; }
.map-canvas {
  flex: 1 1 auto; min-height: 0;
  width: 100%; display: block;
  cursor: crosshair;
}
`;

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// Subtle vertical squash → fakes a slightly-angled (not dead-flat) top-down view.
const SQUASH = 0.82;
const INSET = 18; // canvas margin (CSS px) so nothing hugs the frame edge

// Per-marker styling; unknown kinds fall back to `poi`.
const MARKER_STYLE = {
  cafe: { color: "#e0a23a", glyph: "☕" }, // coffee
  spawn: { color: "#7CFC9B", glyph: "⚑" }, // flag
  shop: { color: "#ffd166", glyph: "\u{1F6CD}" }, // shopping bag
  dock: { color: "#9c6b3f", glyph: "⚓" }, // anchor
  poi: { color: "#7fd1ff", glyph: "★" }, // star
};

export function createMap(opts = {}) {
  injectStyles();

  const parent = opts.parent || (typeof document !== "undefined" ? document.body : null);

  // --- DOM (its own hidden overlay) ----------------------------------------
  const root = document.createElement("div");
  root.className = "map-overlay hidden";
  root.innerHTML = `
    <div class="map-frame">
      <div class="map-topbar">
        <span class="map-title">\u{1F5FA}️ City Map</span>
        <span class="map-hint">Click anywhere to fast-travel · Esc / M to close</span>
        <button class="map-close" type="button" aria-label="Close map">✕</button>
      </div>
      <canvas class="map-canvas"></canvas>
    </div>`;
  if (parent) parent.appendChild(root);

  const canvas = root.querySelector(".map-canvas");
  const closeBtn = root.querySelector(".map-close");
  const ctx = canvas.getContext("2d");

  // Mutable state + cached transform/view. Scratch points avoid per-draw alloc.
  const state = { open: false, payload: null, view: null, cssW: 1, cssH: 1 };
  const _pt = { x: 0, y: 0 };
  const _pt2 = { x: 0, y: 0 };

  // --- transform helpers ----------------------------------------------------
  // World bounds we FRAME (districts + islands + player + markers, padded). The
  // ocean itself is huge, so we don't frame to it — it just fills the backdrop.
  function computeWorldBounds(p) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const grow = (x, z) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    };
    for (const d of p.districts || []) {
      grow(d.x - d.w / 2, d.z - d.d / 2);
      grow(d.x + d.w / 2, d.z + d.d / 2);
    }
    for (const i of p.islands || []) {
      grow(i.x - i.r, i.z - i.r);
      grow(i.x + i.r, i.z + i.r);
    }
    if (p.player) grow(p.player.x, p.player.z);
    for (const m of p.markers || []) grow(m.x, m.z);
    if (!isFinite(minX)) {
      const w = p.water || { minX: -140, maxX: 140, minZ: -20, maxZ: 300 };
      minX = w.minX; maxX = w.maxX; minZ = w.minZ; maxZ = w.maxZ;
    }
    const padX = (maxX - minX) * 0.12 + 22;
    const padZ = (maxZ - minZ) * 0.12 + 22;
    return { minX: minX - padX, maxX: maxX + padX, minZ: minZ - padZ, maxZ: maxZ + padZ };
  }

  // bbox of the district grid only → the landmass we draw the shoreline around.
  function computeLandBounds(p) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const d of p.districts || []) {
      if (d.x - d.w / 2 < minX) minX = d.x - d.w / 2;
      if (d.x + d.w / 2 > maxX) maxX = d.x + d.w / 2;
      if (d.z - d.d / 2 < minZ) minZ = d.z - d.d / 2;
      if (d.z + d.d / 2 > maxZ) maxZ = d.z + d.d / 2;
    }
    if (!isFinite(minX)) return null;
    return { minX, maxX, minZ, maxZ };
  }

  function computeView(p) {
    const b = computeWorldBounds(p);
    const usableW = Math.max(1, state.cssW - INSET * 2);
    const usableH = Math.max(1, state.cssH - INSET * 2);
    const spanX = Math.max(1e-3, b.maxX - b.minX);
    const spanZ = Math.max(1e-3, b.maxZ - b.minZ);
    const s = Math.min(usableW / spanX, usableH / (spanZ * SQUASH));
    const sx = s;
    const sy = s * SQUASH;
    const drawnW = spanX * sx;
    const drawnH = spanZ * sy;
    const offX = INSET + (usableW - drawnW) / 2;
    const offZ = INSET + (usableH - drawnH) / 2;
    return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, sx, sy, offX, offZ };
  }

  function worldToScreen(v, x, z, out) {
    out.x = v.offX + (x - v.minX) * v.sx;
    out.y = v.offZ + (v.maxZ - z) * v.sy; // flip z so +z is UP on screen
    return out;
  }

  function screenToWorld(v, px, py) {
    return { x: v.minX + (px - v.offX) / v.sx, z: v.maxZ - (py - v.offZ) / v.sy };
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  // --- canvas sizing (backing store @ dpr; draw in CSS px) ------------------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // everything below is in CSS px
    state.cssW = cssW;
    state.cssH = cssH;
  }

  // --- the draw (cheap; only runs while open) ------------------------------
  function draw() {
    if (!state.open || !state.payload) return;
    const p = state.payload;
    const v = computeView(p);
    state.view = v;
    const W = state.cssW, H = state.cssH;

    // 1) Ocean backdrop + faint horizontal swell bands.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#155f8a");
    g.addColorStop(1, "#0b3a5c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 6; y < H; y += 13) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // 2) Landmass: sandy shoreline under a green-grey ground slab.
    const land = computeLandBounds(p);
    if (land) {
      const shorePad = 16, grassPad = 7;
      worldToScreen(v, land.minX - shorePad, land.maxZ + shorePad, _pt); // top-left
      worldToScreen(v, land.maxX + shorePad, land.minZ - shorePad, _pt2); // bottom-right
      let x = _pt.x, y = _pt.y, w = _pt2.x - _pt.x, h = _pt2.y - _pt.y;
      ctx.fillStyle = "#d8c193"; // sand
      roundRect(ctx, x, y, w, h, 26);
      ctx.fill();

      worldToScreen(v, land.minX - grassPad, land.maxZ + grassPad, _pt);
      worldToScreen(v, land.maxX + grassPad, land.minZ - grassPad, _pt2);
      x = _pt.x; y = _pt.y; w = _pt2.x - _pt.x; h = _pt2.y - _pt.y;
      const lg = ctx.createLinearGradient(0, y, 0, y + h);
      lg.addColorStop(0, "#5f7355");
      lg.addColorStop(1, "#4d5f46");
      ctx.fillStyle = lg;
      roundRect(ctx, x, y, w, h, 18);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 3) Roads — dark asphalt casing under a lighter centre line.
    if (p.roads && p.roads.length) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(28,30,34,0.85)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (const r of p.roads) {
        worldToScreen(v, r.x1, r.z1, _pt);
        worldToScreen(v, r.x2, r.z2, _pt2);
        ctx.moveTo(_pt.x, _pt.y);
        ctx.lineTo(_pt2.x, _pt2.y);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(120,124,130,0.6)";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      for (const r of p.roads) {
        worldToScreen(v, r.x1, r.z1, _pt);
        worldToScreen(v, r.x2, r.z2, _pt2);
        ctx.moveTo(_pt.x, _pt.y);
        ctx.lineTo(_pt2.x, _pt2.y);
      }
      ctx.stroke();
    }

    // 4) District blocks (coloured + labelled).
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const d of p.districts || []) {
      worldToScreen(v, d.x - d.w / 2, d.z + d.d / 2, _pt); // top-left
      worldToScreen(v, d.x + d.w / 2, d.z - d.d / 2, _pt2); // bottom-right
      const x = _pt.x, y = _pt.y, w = _pt2.x - _pt.x, h = _pt2.y - _pt.y;
      ctx.fillStyle = d.color || "#7a8a6a";
      ctx.globalAlpha = 0.92;
      roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (d.name && w > 30 && h > 18) {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "600 11px system-ui, sans-serif";
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 3;
        ctx.fillText(d.name, x + w / 2, y + h / 2);
        ctx.shadowBlur = 0;
      }
    }

    // 5) Islands — sand disc + greenery + label.
    for (const i of p.islands || []) {
      worldToScreen(v, i.x, i.z, _pt);
      const rx = Math.max(3, i.r * v.sx);
      const ry = Math.max(2.5, i.r * v.sy);
      ctx.fillStyle = "#d8c193";
      ctx.beginPath();
      ctx.ellipse(_pt.x, _pt.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6fae54";
      ctx.beginPath();
      ctx.ellipse(_pt.x, _pt.y, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      if (i.name) {
        ctx.fillStyle = "rgba(230,244,255,0.9)";
        ctx.font = "10px system-ui, sans-serif";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 3;
        ctx.fillText(i.name, _pt.x, _pt.y - ry - 7);
        ctx.shadowBlur = 0;
      }
    }

    // 6) POI markers — coloured dot (+ optional glyph) and a label below.
    for (const m of p.markers || []) {
      const st = MARKER_STYLE[m.kind] || MARKER_STYLE.poi;
      worldToScreen(v, m.x, m.z, _pt);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.arc(_pt.x, _pt.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.arc(_pt.x, _pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
      if (st.glyph) {
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText(st.glyph, _pt.x, _pt.y - 12);
      }
      if (m.label) {
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillStyle = "rgba(235,245,255,0.92)";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 3;
        ctx.fillText(m.label, _pt.x, _pt.y + 14);
        ctx.shadowBlur = 0;
      }
    }

    // 7) Player arrow (position + heading). Direction is taken in SCREEN space
    // by projecting a tiny forward step, so the squash never skews the heading.
    if (p.player) {
      worldToScreen(v, p.player.x, p.player.z, _pt);
      const h = p.player.heading || 0;
      // world forward = (sin h, cos h); screen dir folds in the z-flip + squash.
      const dirX = Math.sin(h) * v.sx;
      const dirY = -Math.cos(h) * v.sy;
      const ang = Math.atan2(dirX, -dirY); // maps the up-pointing base arrow -> dir
      ctx.save();
      ctx.translate(_pt.x, _pt.y);
      ctx.rotate(ang);
      ctx.fillStyle = "#ffe08a";
      ctx.strokeStyle = "rgba(30,20,10,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(6, 7);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- open/close lifecycle -------------------------------------------------
  function onResize() {
    if (!state.open) return;
    resize();
    draw();
  }

  function open() {
    if (state.open) return;
    state.open = true;
    root.classList.remove("hidden"); // display:flex → layout is measurable now
    resize();
    draw();
    window.addEventListener("resize", onResize);
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    root.classList.add("hidden");
    window.removeEventListener("resize", onResize);
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  // Store the latest world snapshot; only repaint while the overlay is open.
  function render(payload) {
    if (payload) state.payload = payload;
    if (state.open) draw();
  }

  // --- input ----------------------------------------------------------------
  function isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  // Esc / M close the map while it's open (main.js owns M-to-OPEN). Guarded so
  // typing "m" in a chat box doesn't slam it shut.
  function onKey(e) {
    if (!state.open) return;
    const k = e.key;
    if (k === "Escape" || ((k === "m" || k === "M") && !isTyping())) {
      e.preventDefault();
      close();
    }
  }
  window.addEventListener("keydown", onKey);

  closeBtn.addEventListener("click", close);

  // Click anywhere on the map → invert to WORLD coords → fast-travel.
  canvas.addEventListener("click", (e) => {
    if (!state.open || !state.view) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const world = screenToWorld(state.view, px, py);
    const cb = api.onTravel;
    if (typeof cb === "function") cb({ x: world.x, z: world.z });
  });

  const api = {
    onTravel: typeof opts.onTravel === "function" ? opts.onTravel : null,
    open,
    close,
    toggle,
    render,
    get isOpen() {
      return state.open;
    },
  };

  return api;
}
