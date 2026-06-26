// Full-screen MAP overlay (press M in-game; main.js wires that).
//
// This overlay is now a TRANSPARENT marker/click layer drawn ON TOP of a REAL
// rendered bird's-eye view of the world. main.js renders the actual 3D scene
// straight down (an OrthographicCamera high above, looking -Y) onto the main
// canvas whenever the map is open; this overlay paints only the player ARROW,
// thin district / POI / island labels, and a hint banner over that render — and
// it turns a CLICK into a world (x, z) target for fast-travel or a cannon launch.
//
// createMap(opts) -> {
//   open(mode?),       // show the overlay (mode: "travel" | "cannon", default "travel")
//   close(),           // hide it
//   toggle(mode?),     // open/close
//   isOpen,            // live getter (boolean)
//   mode,              // live getter ("travel" | "cannon")
//   render(payload),   // store + (re)draw; only redraws while open
//   onTravel,          // assignable: ({ x, z, mode }) => void, fired on a map click
// }
//
// opts: { onTravel?({ x, z, mode }), parent?=document.body }.
//
// render(payload) — described in WORLD coordinates:
//   {
//     bounds:  { minX, maxX, minZ, maxZ },  // the WORLD rect the topCam frames; it
//                                           // fills the canvas. All screen<->world
//                                           // maths uses this (set by main.js).
//     player:  { x, z, heading },           // heading: world facing (rad)
//     mode:    "travel" | "cannon",         // drives the hint + the onTravel tag
//     districts: [{ name, x, z }],          // optional thin name labels
//     markers:   [{ x, z, label, kind }],   // optional POI pins (cafe/poi/dock…)
//     islands:   [{ x, z, r, name }],       // optional labels out in the water
//   }
// Every field is optional except `bounds` (needed for the transform).
//
// ── screen <-> world transform (MUST mirror main.js's topCam framing) ─────────
// The topCam looks straight DOWN with up = +Z, so on screen +Z (north) is UP and
// +X (east) runs to the LEFT — a camera looking down can't horizontally mirror, so
// keeping north-up (to match the old map / minimap) flips east to the left. With
// the framed world rect `bounds` filling the canvas (css size W x H):
//   px = W * (maxX - x) / (maxX - minX)      // +x → left
//   py = H * (maxZ - z) / (maxZ - minZ)      // +z → up
// invert (a click at px,py -> WORLD):
//   x  = maxX - (px / W) * (maxX - minX)
//   z  = maxZ - (py / H) * (maxZ - minZ)
// Clicking inverts the pixel under the cursor and calls onTravel({ x, z, mode }).

const STYLE_ID = "map-overlay-styles";

const CSS = `
.map-overlay {
  position: fixed; inset: 0; z-index: 60;
  pointer-events: auto;
  cursor: crosshair;
  font-family: system-ui, -apple-system, sans-serif;
}
.map-overlay.hidden { display: none; }
.map-canvas {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  display: block;
  background: transparent;
  cursor: crosshair;
}
.map-bar {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
  background: linear-gradient(180deg, rgba(6,14,22,0.80), rgba(6,14,22,0.0));
  pointer-events: none; /* let clicks near the top still fall through to travel */
}
.map-bar > * { pointer-events: auto; }
.map-title {
  font-size: 16px; font-weight: 700; color: #eaf4ff; letter-spacing: 0.3px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85);
}
.map-hint {
  font-size: 13px; color: #c4dcf0; flex: 1 1 auto;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85);
}
.map-close {
  appearance: none; border: none; cursor: pointer;
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(0,0,0,0.45); color: #eaf4ff; font-size: 15px; line-height: 1;
  transition: background 0.15s, color 0.15s;
}
.map-close:hover { background: rgba(255,90,80,0.7); color: #fff; }
`;

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// Per-marker styling; unknown kinds fall back to `poi`.
const MARKER_STYLE = {
  cafe: { color: "#e0a23a" },
  spawn: { color: "#7CFC9B" },
  shop: { color: "#ffd166" },
  dock: { color: "#9c6b3f" },
  poi: { color: "#7fd1ff" },
};

export function createMap(opts = {}) {
  injectStyles();

  const parent = opts.parent || (typeof document !== "undefined" ? document.body : null);

  // --- DOM (its own hidden, transparent overlay) ---------------------------
  const root = document.createElement("div");
  root.className = "map-overlay hidden";
  root.innerHTML = `
    <canvas class="map-canvas"></canvas>
    <div class="map-bar">
      <span class="map-title">\u{1F5FA}️ City Map</span>
      <span class="map-hint"></span>
      <button class="map-close" type="button" aria-label="Close map">✕</button>
    </div>`;
  if (parent) parent.appendChild(root);

  const canvas = root.querySelector(".map-canvas");
  const hintEl = root.querySelector(".map-hint");
  const closeBtn = root.querySelector(".map-close");
  const ctx = canvas.getContext("2d");

  // Mutable state. `bounds` is the world rect that fills the canvas (from main.js).
  const state = { open: false, mode: "travel", payload: null, bounds: null, cssW: 1, cssH: 1 };
  const _pt = { x: 0, y: 0 };

  // --- transform helpers (invert main.js's topCam framing) -----------------
  function worldToScreen(b, x, z, out) {
    out.x = (state.cssW * (b.maxX - x)) / (b.maxX - b.minX); // +x → left
    out.y = (state.cssH * (b.maxZ - z)) / (b.maxZ - b.minZ); // +z → up
    return out;
  }
  function screenToWorld(b, px, py, w, h) {
    return {
      x: b.maxX - (px / w) * (b.maxX - b.minX),
      z: b.maxZ - (py / h) * (b.maxZ - b.minZ),
    };
  }

  // --- canvas sizing (backing store @ dpr; draw in CSS px) -----------------
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
  // The real 3D bird-eye render is behind us on the main canvas — we clear to
  // transparent and paint ONLY labels + the player arrow on top.
  function draw() {
    if (!state.open || !state.payload) return;
    const p = state.payload;
    const b = p.bounds || state.bounds;
    ctx.clearRect(0, 0, state.cssW, state.cssH);
    if (!b || !(b.maxX > b.minX) || !(b.maxZ > b.minZ)) return;
    state.bounds = b;

    const W = state.cssW, H = state.cssH;
    const onScreen = () => _pt.x > -60 && _pt.x < W + 60 && _pt.y > -40 && _pt.y < H + 40;

    // 1) Thin district name labels for orientation over the real render.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (p.districts) {
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      for (const d of p.districts) {
        if (!d.name) continue;
        worldToScreen(b, d.x, d.z, _pt);
        if (!onScreen()) continue;
        ctx.shadowBlur = 4;
        ctx.fillText(d.name, _pt.x, _pt.y);
        ctx.shadowBlur = 0;
      }
    }

    // 2) Island labels out in the water.
    if (p.islands) {
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = "rgba(222,240,255,0.85)";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      for (const i of p.islands) {
        if (!i.name) continue;
        worldToScreen(b, i.x, i.z, _pt);
        if (!onScreen()) continue;
        ctx.shadowBlur = 4;
        ctx.fillText(i.name, _pt.x, _pt.y);
        ctx.shadowBlur = 0;
      }
    }

    // 3) POI markers — a coloured pin + a label below.
    if (p.markers) {
      for (const m of p.markers) {
        const st = MARKER_STYLE[m.kind] || MARKER_STYLE.poi;
        worldToScreen(b, m.x, m.z, _pt);
        if (!onScreen()) continue;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        ctx.arc(_pt.x, _pt.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = st.color;
        ctx.beginPath();
        ctx.arc(_pt.x, _pt.y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (m.label) {
          ctx.font = "11px system-ui, sans-serif";
          ctx.fillStyle = "rgba(235,245,255,0.95)";
          ctx.shadowColor = "rgba(0,0,0,0.8)";
          ctx.shadowBlur = 4;
          ctx.fillText(m.label, _pt.x, _pt.y + 14);
          ctx.shadowBlur = 0;
        }
      }
    }

    // 4) Player arrow at the live world position + heading. The arrow's base
    //    points up; rotating by -heading aims it in screen space for the topCam's
    //    north-up / east-left framing (world +Z up, +X left — see the header).
    if (p.player) {
      worldToScreen(b, p.player.x, p.player.z, _pt);
      const h = p.player.heading || 0;
      ctx.save();
      ctx.translate(_pt.x, _pt.y);
      ctx.rotate(-h);
      ctx.fillStyle = "#ffe08a";
      ctx.strokeStyle = "rgba(30,20,10,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(9, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(-9, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- hint banner ----------------------------------------------------------
  function updateHint() {
    if (!hintEl) return;
    hintEl.textContent =
      state.mode === "cannon"
        ? "Click where to launch the cannon · Esc / M to cancel"
        : "Click anywhere to fast-travel · Esc / M to close";
  }

  // --- open/close lifecycle -------------------------------------------------
  function onResize() {
    if (!state.open) return;
    resize();
    draw();
  }

  function open(mode = "travel") {
    state.mode = mode === "cannon" ? "cannon" : "travel";
    updateHint();
    if (!state.open) {
      state.open = true;
      root.classList.remove("hidden"); // display:block → layout is measurable now
      window.addEventListener("resize", onResize);
    }
    resize();
    draw();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    root.classList.add("hidden");
    window.removeEventListener("resize", onResize);
  }

  function toggle(mode) {
    if (state.open) close();
    else open(mode);
  }

  // Store the latest world snapshot; only repaint while the overlay is open. A
  // `mode` in the payload (kept in sync by main.js) re-tags the hint + clicks.
  function render(payload) {
    if (payload) {
      state.payload = payload;
      if (payload.bounds) state.bounds = payload.bounds;
      if ((payload.mode === "cannon" || payload.mode === "travel") && payload.mode !== state.mode) {
        state.mode = payload.mode;
        updateHint();
      }
    }
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

  // Click anywhere on the map → invert to WORLD coords → travel / cannon launch.
  canvas.addEventListener("click", (e) => {
    if (!state.open || !state.bounds) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const world = screenToWorld(state.bounds, px, py, rect.width, rect.height);
    const cb = api.onTravel;
    if (typeof cb === "function") cb({ x: world.x, z: world.z, mode: state.mode });
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
    get mode() {
      return state.mode;
    },
  };

  return api;
}
