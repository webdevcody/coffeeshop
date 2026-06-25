// In-world FLIP-BOOK RESTAURANT MENU — the headline table game-picker.
//
// Instead of a DOM modal, a physical low-poly book sits open on the café table.
// It mounts through the SAME engine path as a game board (InWorldBoard.mount),
// so it reuses the seated-board camera framing with zero extra wiring: while it's
// the active mount for a seated host/guest, board.js getSeatedView() reports
// active:true and main.js eases the camera over the table.
//
// HOST view — an OPEN flip-book. Each PAGE is ONE game and shows:
//   * a small rotating 3D DIORAMA of that game (from ./previews.js)
//   * the game name + a short blurb (rendered to a CanvasTexture page)
//   * a clear "Play" plate
// Navigation arrows (and clickable page corners) flip to the next/previous game
// with an ANIMATED page-turn (a page mesh rotates about the spine over ~0.35s).
// Clicking the diorama or the "Play" plate selects that game.
//
// GUEST view (sat before the host picked) — a CLOSED book with a small "waiting
// for host…" placard, no interaction.
//
// ENGINE CONTRACT (createGame.js / board.js):
//   createGame(ctx) -> GameInstance { group, onPointer, setRole, setSeatRy,
//                                     update?, dispose }
//   * Default orientPolicy ("flat"): board.js rotates our group by
//     orientFor(seatRy) so the open book faces the LOCAL seat. We render in the
//     canonical frame (spine along local X, pages opening toward +Z / the reader).
//   * Interaction: board.js raycasts our group, runs its cell resolver (we expose
//     no hitToCell / userData.cell, so it returns a geometric cell we ignore),
//     then calls instance.onPointer({ cell, point, object }). We walk the hit
//     object's ancestors for userData.menuAction ("next"|"prev"|"play") and act.
//   * Selection calls ctx.onPick(gameId) — supplied by main.js, which relays
//     network.chooseGame(table, gameId, capacity).
//
// previews.js may be supplied by a separate fixer (like chess.js). We import it
// lazily and fall back to a generic built-in diorama if it's missing or throws,
// so `npm run build` stays green and the book still renders.

import { listGames } from "../registry.js";
import { orientFor } from "./createGame.js";

// Lazy, build-tolerant preview loader. The static glob lets Vite resolve whatever
// exists at build time; a missing previews.js simply isn't in the map and we use
// the built-in fallback diorama. (Mirrors registry.js's chess.js handling.)
const _previewMods = import.meta.glob("./previews.js");
let _previewFnPromise = null;
function loadBuildPreview() {
  if (_previewFnPromise) return _previewFnPromise;
  const loader = _previewMods["./previews.js"];
  _previewFnPromise = loader
    ? loader()
        .then((m) => m.buildGamePreview || m.default || null)
        .catch(() => null)
    : Promise.resolve(null);
  return _previewFnPromise;
}

// ---------------------------------------------------------------------------
// Geometry constants (metres, in the book group's local frame). Sized to read
// comfortably inside the seated-board camera framing on the round café table.
// The book lies flat: spine along local X at the centre, two pages opening
// toward the reader (+Z, the near edge after orientFor(seatRy)).
// ---------------------------------------------------------------------------
const PAGE_W = 0.30; // one open page width (X half-span ≈ PAGE_W)
const PAGE_D = 0.34; // page depth toward the reader (Z span)
const COVER_OVERHANG = 0.018;
const BOOK_BASE_Y = 0.012; // page-block top sits a touch above the cover
const DIORAMA_LIFT = 0.012; // diorama floats just above the open page

// Café palette (mirrors props.js wood/ceramic tones).
const COL = {
  cover: "#6b3f1f",
  coverEdge: "#4a2a13",
  spine: "#3f2a1a",
  page: "#f4efe6",
  pageEdge: "#e3d8c4",
  ribbon: "#9e3b3b",
  plate: "#3f7d4d",
  plateHi: "#54a368",
  arrow: "#caa24a",
  arrowHi: "#e6c46a",
};

// ---------------------------------------------------------------------------
// CanvasTexture helpers — name / blurb page art and the "Play" / arrow glyphs.
// ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
}

function wrapLines(g, text, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (g.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// A single page face: title, icon, and wrapped blurb on aged paper.
function pageTexture(THREE, entry, side, total) {
  // 2x supersample: the page is viewed at a grazing angle in first-person, so a
  // 512px canvas reads blurry. Draw in the original 512×580 coordinate space but
  // into a 1024×1160 backing store (g.scale), and crank anisotropy.
  const SS = 2;
  const W = 512;
  const H = 580;
  const cv = makeCanvas(W * SS, H * SS);
  const g = cv.getContext("2d");
  g.scale(SS, SS);
  // Paper with a faint warm gradient + edge vignette.
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#fbf7ee");
  grad.addColorStop(1, "#efe7d4");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(120,90,50,0.18)";
  g.lineWidth = 6;
  g.strokeRect(18, 18, W - 36, H - 36);

  g.fillStyle = "#7a4a25";
  g.font = "bold 120px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(entry.icon || "🎮", W / 2, 150);

  g.fillStyle = "#3f2a1a";
  g.font = "bold 56px Georgia, serif";
  g.fillText(entry.name || "Game", W / 2, 280);

  g.fillStyle = "#5a4632";
  g.font = "30px Georgia, serif";
  const lines = wrapLines(g, entry.blurb || "", W - 120);
  let y = 360;
  for (const ln of lines.slice(0, 4)) {
    g.fillText(ln, W / 2, y);
    y += 42;
  }

  // Footer: page x of N.
  g.fillStyle = "#8a795f";
  g.font = "italic 26px Georgia, serif";
  g.fillText(`${side} / ${total}`, W / 2, H - 50);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  // High anisotropy: the page is viewed at a steep grazing angle in first-person,
  // where anisotropic filtering matters far more than plain mip sampling.
  tex.anisotropy = 16;
  return tex;
}

function labelTexture(THREE, text, bg, fg) {
  const SS = 2; // supersample for crisp glyphs up close
  const W = 256;
  const H = 128;
  const cv = makeCanvas(W * SS, H * SS);
  const g = cv.getContext("2d");
  g.scale(SS, SS);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = fg;
  g.font = "bold 64px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, W / 2, H / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

// ---------------------------------------------------------------------------
// Built-in fallback diorama — a tiny café-board pedestal so an unknown / missing
// previews.js still shows *something* representative on the page.
// ---------------------------------------------------------------------------
function fallbackPreview(THREE, entry) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, 0.02, 20),
    new THREE.MeshStandardMaterial({ color: "#6b4326", roughness: 0.7 })
  );
  base.position.y = 0.01;
  g.add(base);
  // A couple of stacked low-poly tokens to suggest "a game".
  const tokMat = new THREE.MeshStandardMaterial({ color: "#c4452f", roughness: 0.45, metalness: 0.1 });
  const tokMat2 = new THREE.MeshStandardMaterial({ color: "#2a2320", roughness: 0.45, metalness: 0.1 });
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.014, 18), i % 2 ? tokMat2 : tokMat);
    t.position.set((i - 1) * 0.045, 0.027 + (i === 1 ? 0.016 : 0), 0);
    g.add(t);
  }
  const die = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.5 })
  );
  die.position.set(0, 0.045, 0.06);
  die.rotation.set(0.4, 0.7, 0.2);
  g.add(die);
  g.userData.isFallbackPreview = true;
  return g;
}

// ===========================================================================
// THE MODULE
// ===========================================================================
export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "flipbook-menu";

  let role = ctx.role;
  // Our seat ry. board.js uses the default "flat" orientPolicy, so it rotates our
  // GROUP by orientFor(seatRy): ~0 for the host seat, ~PI for the opponent chair.
  // Every flat text plane (page title/blurb, page footer, "Play" plate, arrows) is
  // a child of the group, so without per-seat correction the opponent reads the
  // whole menu upside-down/backwards. We track seatRy and counter-rotate the text
  // holders by -orientFor(seatRy) (see _applyTextFacing) — exactly the trick
  // battleship uses for its HUD (hudMesh.rotation.y = -group.rotation.y) — so the
  // text always reads upright from the LOCAL seat while the book BODY stays oriented
  // toward the reader.
  let seatRy = ctx.seatRy;
  // onPick(gameId) is injected by main.js via ctx.onPick; chooseGame relay lives
  // there. Guests/spectators never pick.
  const onPick = typeof ctx.onPick === "function" ? ctx.onPick : () => {};
  // The relay net (board.js curries it). The host pushes the open-page index so
  // every other seated player / spectator follows along on their own facing copy.
  const net = ctx.net || {};
  // Nav arrows + Play plate: only the controlling host sees/uses them.
  const hostOnly = [];

  const games = (typeof ctx.games === "function" ? ctx.games() : ctx.games) || listGames();
  const total = Math.max(1, games.length);

  let index = 0; // current open spread (page) = current game
  let disposed = false;
  let turning = null; // active page-turn animation state
  let spinT = 0; // diorama idle-spin accumulator

  // Resource registries for dispose().
  const _geos = [];
  const _mats = [];
  const _texs = [];
  const track = (arr, x) => {
    if (x) arr.push(x);
    return x;
  };

  // Shared materials.
  const M = {
    cover: track(_mats, new THREE.MeshStandardMaterial({ color: COL.cover, roughness: 0.72, metalness: 0.04 })),
    coverEdge: track(_mats, new THREE.MeshStandardMaterial({ color: COL.coverEdge, roughness: 0.74 })),
    spine: track(_mats, new THREE.MeshStandardMaterial({ color: COL.spine, roughness: 0.7 })),
    pageBlock: track(_mats, new THREE.MeshStandardMaterial({ color: COL.pageEdge, roughness: 0.85 })),
    ribbon: track(_mats, new THREE.MeshStandardMaterial({ color: COL.ribbon, roughness: 0.6, metalness: 0.05 })),
    plate: track(_mats, new THREE.MeshStandardMaterial({ color: COL.plate, roughness: 0.5, metalness: 0.1, emissive: "#10300f", emissiveIntensity: 0.25 })),
    arrow: track(_mats, new THREE.MeshStandardMaterial({ color: COL.arrow, roughness: 0.4, metalness: 0.5, emissive: "#3a2a00", emissiveIntensity: 0.2 })),
    pageBlank: track(_mats, new THREE.MeshStandardMaterial({ color: COL.page, roughness: 0.86, side: THREE.DoubleSide })),
  };

  // ---- Roots --------------------------------------------------------------
  // bookRoot holds the open (host) book; placardRoot holds the closed (guest)
  // waiting sign. Only one is visible per role.
  const bookRoot = new THREE.Group();
  const placardRoot = new THREE.Group();
  group.add(bookRoot, placardRoot);
  // The book authors its reader-facing edge toward +Z, but the engine's default
  // orientPolicy ("flat") rotates our group by orientFor(seatRy), which puts the
  // canonical NEAR edge at -Z (meeting the seated reader). Without this flip the
  // open book faces the OPPONENT across the table. Rotating the content PI brings
  // the pages, "Play" plate and ribbon around to face the local reader — the same
  // correction connect4's faceplate needed.
  bookRoot.rotation.y = Math.PI;
  placardRoot.rotation.y = Math.PI;

  // Live page art holders (the open spread). Rebuilt as the index changes.
  let leftPageMesh = null;
  let rightPageMesh = null;
  let dioramaHolder = null; // spins on update()
  let nextHolder = null; // hidden preload holder for the destination diorama
  let nextPreview = null; // the preloaded model living in nextHolder
  let currentPreview = null;
  let dioramaBaseY = 0; // resting Y of the diorama holder (for the hover bob)
  let glowRingMesh = null; // pulsing under-glow ring on the display podium
  let playPlate = null;

  // The animated turning page (a thin sheet pivoting about the spine).
  let turnPivot = null;
  let turnFront = null;
  let turnBack = null;

  // Per-seat TEXT-FACING holders. Every readable flat text plane (page title/blurb,
  // page footer, "Play" plate, nav arrows) lives at the ORIGIN of one of these
  // holders; the holder carries the plane's position and a Y rotation that cancels
  // the group's per-seat orientFor(seatRy). _applyTextFacing() keeps holder.rotation.y
  // = -orientFor(seatRy) so each plane spins about its own normal and reads upright
  // from whichever seat the local viewer occupies — the opponent no longer sees the
  // menu upside-down. The book BODY (cover/spine/pages/diorama) is NOT a text holder,
  // so it stays oriented toward the reader by the group + bookRoot.PI.
  const textHolders = [];
  // A text plane laid flat (rotation.x = -PI/2) at the local −Z near edge reads 180°
  // rotated from the seat without a correction. bookRoot.rotation.y = PI already
  // supplies that +PI for the host seat; the per-seat counter-rotation below makes it
  // hold for EVERY seat. Net readable world-Y of the text = group.rotation.y (PI for
  // the opponent, 0 for host) + bookRoot.PI + holder(-orientFor(seatRy)) ≡ PI for all.
  function makeTextHolder(parent, x, y, z) {
    const h = new THREE.Group();
    h.position.set(x, y, z);
    parent.add(h);
    textHolders.push(h);
    return h;
  }
  // Counter-rotate every text holder so flat text stays seat-upright. Called once at
  // build and whenever the seat changes (setSeatRy). A spectator (seatRy null) gets
  // orientFor(null) === 0 → holder.rotation.y 0, i.e. the canonical host-facing text.
  function _applyTextFacing() {
    const ry = -orientFor(seatRy);
    for (const h of textHolders) h.rotation.y = ry;
  }

  buildBook();
  buildPlacard();
  applyRoleVisibility();
  _applyTextFacing(); // orient the flat text holders for this seat (built after buildBook)
  renderSpread();
  sendMenuState(); // host: publish the initial page so late joiners catch up

  // -------------------------------------------------------------------------
  // Static book body: a hard cover, a thick page block, a spine, and a ribbon.
  // The spine runs along local X at the centre; the two open pages span +Z.
  // -------------------------------------------------------------------------
  function buildBook() {
    const halfW = PAGE_W; // each page is PAGE_W wide → open book spans 2*PAGE_W in X
    const fullW = halfW * 2 + COVER_OVERHANG * 2;
    const depth = PAGE_D + COVER_OVERHANG * 2;

    // Hard cover under everything.
    const cover = new THREE.Mesh(track(_geos, new THREE.BoxGeometry(fullW, 0.02, depth)), M.cover);
    cover.position.y = 0.01;
    cover.castShadow = true;
    cover.receiveShadow = true;
    bookRoot.add(cover);

    // Page block (the stacked paper) — slightly inset, sitting on the cover.
    const blockH = 0.018;
    const block = new THREE.Mesh(
      track(_geos, new THREE.BoxGeometry(halfW * 2, blockH, PAGE_D)),
      M.pageBlock
    );
    block.position.y = 0.02 + blockH / 2;
    block.castShadow = true;
    block.receiveShadow = true;
    bookRoot.add(block);

    // Raised spine ridge down the centre.
    const spine = new THREE.Mesh(
      track(_geos, new THREE.BoxGeometry(0.022, 0.026, depth)),
      M.spine
    );
    spine.position.y = 0.02 + blockH / 2 + 0.004;
    bookRoot.add(spine);

    // Two flat open page faces (left + right of the spine). Their textures are
    // (re)assigned in renderSpread(). The RIGHT page carries the title/blurb/footer
    // text, so it sits in a per-seat text holder that keeps the text upright from the
    // local seat (the LEFT page is a blank parchment backdrop for the diorama, but it
    // also rides a holder so a future left-page texture stays upright too). Each plane
    // is laid flat at its holder's ORIGIN; the holder carries the page's local
    // position + the -orientFor(seatRy) counter-rotation.
    const pageY = 0.02 + blockH + 0.004; // clear 4 mm gap above the block (no z-fight)
    const pageGeo = track(_geos, new THREE.PlaneGeometry(halfW - 0.012, PAGE_D - 0.02));
    const leftHolder = makeTextHolder(bookRoot, -halfW / 2, pageY, 0);
    leftPageMesh = new THREE.Mesh(pageGeo, M.pageBlank);
    leftPageMesh.rotation.x = -Math.PI / 2;
    leftHolder.add(leftPageMesh);

    const rightHolder = makeTextHolder(bookRoot, halfW / 2, pageY, 0);
    rightPageMesh = new THREE.Mesh(pageGeo, M.pageBlank);
    rightPageMesh.rotation.x = -Math.PI / 2;
    rightHolder.add(rightPageMesh);

    // Ribbon bookmark trailing off the bottom edge toward the reader.
    const ribbon = new THREE.Mesh(
      track(_geos, new THREE.BoxGeometry(0.018, 0.001, 0.12)),
      M.ribbon
    );
    ribbon.position.set(0.03, pageY + 0.002, PAGE_D / 2 - 0.02);
    bookRoot.add(ribbon);

    // Diorama holder floats above the LEFT page (right page carries the text).
    dioramaHolder = new THREE.Group();
    dioramaHolder.position.set(-halfW / 2, pageY + DIORAMA_LIFT, -0.01);
    dioramaHolder.userData.menuAction = "play"; // clicking the model also selects
    bookRoot.add(dioramaHolder);

    // Hidden holder used to PRELOAD the destination page's diorama during a flip,
    // so it can be revealed (no fallback->real pop, no lag) exactly as the new page
    // is uncovered mid-sweep. Co-located with dioramaHolder; kept invisible.
    nextHolder = new THREE.Group();
    nextHolder.position.copy(dioramaHolder.position);
    nextHolder.visible = false;
    bookRoot.add(nextHolder);

    // --- Make the diorama POP: a display podium with under-glow + key lighting ---
    dioramaBaseY = pageY + DIORAMA_LIFT; // resting height (hover-bobbed in update)
    const podX = -halfW / 2, podZ = -0.01;
    // Tilt the showcase slightly toward the reader so the board reads as 3D, not flat.
    dioramaHolder.rotation.x = -0.16;
    // Dark podium puck the model floats over.
    const podium = new THREE.Mesh(
      track(_geos, new THREE.CylinderGeometry(0.085, 0.097, 0.012, 30)),
      track(_mats, new THREE.MeshStandardMaterial({ color: "#241812", roughness: 0.45, metalness: 0.35 }))
    );
    podium.position.set(podX, pageY + 0.006, podZ);
    podium.receiveShadow = true;
    bookRoot.add(podium);
    // Glowing under-ring. EMISSIVE ONLY (self-lit) — it glows on its own without
    // adding scene light, so it pops the podium WITHOUT washing out the book. (The
    // earlier PointLights blew the whole book out and were removed.)
    glowRingMesh = new THREE.Mesh(
      track(_geos, new THREE.TorusGeometry(0.083, 0.0065, 12, 40)),
      track(_mats, new THREE.MeshStandardMaterial({ color: "#ffcf6b", emissive: "#ffab2e", emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.2 }))
    );
    glowRingMesh.rotation.x = Math.PI / 2;
    glowRingMesh.position.set(podX, pageY + 0.0135, podZ);
    bookRoot.add(glowRingMesh);

    // Navigation arrows: clickable plates at the bottom-left (prev) and
    // bottom-right (next) corners. Tagged for the pointer resolver.
    // Float the nav arrows + Play just OFF the front edge of the book (z past the
    // page) so the turning sheet (which sweeps the page area through the spine)
    // never clips them, and they don't sit on top of the page art.
    buildArrow("prev", -halfW + 0.04, pageY + 0.012, PAGE_D / 2 + 0.012, false);
    buildArrow("next", halfW - 0.04, pageY + 0.012, PAGE_D / 2 + 0.012, true);

    // "Play" plate floating off the front edge, centred. It carries the "Play" label
    // text, so it rides a per-seat text holder (placed at the plate's local position)
    // and is added at the holder ORIGIN — keeping the label upright from any seat.
    // userData.menuAction stays on the plate (and propagates through its label/base),
    // so the pointer ancestor-walk still resolves a click anywhere on it.
    playPlate = makeLabelPlate("Play", COL.plate, "#ffffff", 0.16, 0.058);
    playPlate.userData.menuAction = "play";
    const playHolder = makeTextHolder(bookRoot, 0, pageY + 0.016, PAGE_D / 2 + 0.028);
    playHolder.add(playPlate);
    hostOnly.push(playPlate);

    // The turning sheet (hidden until a flip is in progress). It pivots about the
    // spine (local X axis at x=0) so it sweeps left↔right like a real page.
    turnPivot = new THREE.Group();
    turnPivot.position.set(0, pageY + 0.0015, 0);
    turnPivot.visible = false;
    bookRoot.add(turnPivot);
    const sheetGeo = track(_geos, new THREE.PlaneGeometry(halfW - 0.012, PAGE_D - 0.02));
    // Sheet hangs from the spine: its plane lies in XZ, offset so its inner edge
    // is at the spine (x=0) and it extends one page-width outward.
    //
    // The sheet carries the TEXT page art on BOTH faces so the title/blurb is
    // visible *on the moving sheet* throughout the sweep — never popping mid-air on
    // an exposed page. turnFront (FrontSide) shows the LEAVING spread's art as the
    // sheet lifts off the page it's leaving; turnBack (BackSide, the underside)
    // shows the DESTINATION spread's art so the new title/blurb is already painted
    // on the sheet as it lays down on the destination page. The real text page
    // underneath is repainted only while it is COVERED by the sheet (direction-aware
    // timing in startTurn/stepTurn), so when the sheet hides at commit the static
    // page already matches — no flicker, no pop. Both faces are single-sided so each
    // shows its own texture; we start them blank (assigned per-turn in startTurn).
    turnFront = new THREE.Mesh(
      sheetGeo,
      track(_mats, new THREE.MeshStandardMaterial({ color: COL.page, roughness: 0.86, side: THREE.FrontSide }))
    );
    turnFront.rotation.x = -Math.PI / 2;
    turnFront.position.set((halfW - 0.012) / 2 + 0.006, 0, 0);
    turnPivot.add(turnFront);

    turnBack = new THREE.Mesh(
      sheetGeo,
      track(_mats, new THREE.MeshStandardMaterial({ color: COL.page, roughness: 0.86, side: THREE.BackSide }))
    );
    turnBack.rotation.x = -Math.PI / 2;
    turnBack.position.copy(turnFront.position);
    turnPivot.add(turnBack);
  }

  // Paint a spread's text-page art onto one of the turning-sheet faces (used to
  // carry the leaving/destination title+blurb on the moving sheet). Frees the
  // previous per-turn texture/material on that face (never the shared blank).
  function setSheetFaceArt(faceMesh, faceSide, atIndex) {
    if (!faceMesh) return;
    const entry = games[atIndex] || games[0];
    if (!entry) return;
    const tex = track(_texs, pageTexture(THREE, entry, atIndex + 1, total));
    const old = faceMesh.material;
    faceMesh.material = track(
      _mats,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86, side: faceSide })
    );
    if (old && old !== M.pageBlank) {
      old.map?.dispose?.();
      old.dispose?.();
    }
  }

  function buildArrow(action, x, y, z, pointRight) {
    // A small triangular prism plate. ShapeGeometry triangle laid flat.
    const s = 0.03;
    const shape = new THREE.Shape();
    if (pointRight) {
      shape.moveTo(-s, -s);
      shape.lineTo(-s, s);
      shape.lineTo(s, 0);
    } else {
      shape.moveTo(s, -s);
      shape.lineTo(s, s);
      shape.lineTo(-s, 0);
    }
    shape.closePath();
    const geo = track(_geos, new THREE.ShapeGeometry(shape));
    const mat = M.arrow;
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.userData.menuAction = action;
    // A slightly larger invisible hit pad behind it for easier clicking.
    const pad = new THREE.Mesh(
      track(_geos, new THREE.PlaneGeometry(0.085, 0.085)),
      track(_mats, new THREE.MeshBasicMaterial({ visible: false }))
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = -0.001;
    pad.userData.menuAction = action;
    // Arrow glyphs are directional (prev points left, next points right): they ride a
    // per-seat text holder at the arrow's local position so the glyph reads in the
    // LOCAL viewer's left/right (the opponent otherwise saw them mirrored). The glyph
    // + hit pad sit at the holder ORIGIN; menuAction stays on both so the pointer
    // ancestor-walk still routes the click regardless of the holder rotation.
    const arrowHolder = makeTextHolder(bookRoot, x, y, z);
    arrowHolder.add(m, pad);
    hostOnly.push(m, pad);
  }

  function makeLabelPlate(text, bg, fg, w, d) {
    const g = new THREE.Group();
    const tex = track(_texs, labelTexture(THREE, text, bg, fg));
    const mat = track(_mats, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.08, emissive: "#0a1a0a", emissiveIntensity: 0.2 }));
    const top = new THREE.Mesh(track(_geos, new THREE.PlaneGeometry(w, d)), mat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.006;
    // A low base so the plate reads as a raised button.
    const base = new THREE.Mesh(
      track(_geos, new THREE.BoxGeometry(w + 0.01, 0.008, d + 0.01)),
      M.plate
    );
    base.position.y = 0.002;
    g.add(base, top);
    g.castShadow = true;
    return g;
  }

  // -------------------------------------------------------------------------
  // Guest placard — formerly a closed "waiting…" book. The current design has
  // EVERYONE (host, guests, spectators) see the open flip-book oriented to their
  // own seat (only the host gets the flip arrows + Play plate), so the closed
  // placard is never displayed. We deliberately build NOTHING here: previously
  // this allocated a cover/page-block/sign/post plus a CanvasTexture that
  // applyRoleVisibility() always hid (placardRoot.visible = false), wasting GPU
  // resources for a mesh no one ever sees. placardRoot is kept as an empty,
  // hidden group so the surrounding wiring (group.add / rotation / visibility)
  // stays intact without leaking the unused geometry/material/texture.
  function buildPlacard() {
    /* Intentionally empty: everyone sees the open book (see applyRoleVisibility). */
  }

  function applyRoleVisibility() {
    const host = role === "host";
    // Everyone at the table sees the open book (each oriented to their own seat);
    // only the host sees + uses the flip arrows and Play plate. Guests/spectators
    // watch the host browse, with the open page synced over the relay.
    bookRoot.visible = true;
    placardRoot.visible = false;
    for (const p of hostOnly) p.visible = host;
  }

  // -------------------------------------------------------------------------
  // Render the current spread: page-art textures + the diorama for games[index].
  // -------------------------------------------------------------------------
  // Repaint only the open spread's PAGE ART (the parchment + title/blurb). The
  // diorama is handled separately by buildPreviewInto()/the flip preload so we can
  // swap the model at the right moment without flicker.
  function renderPageArt(at) {
    const idx = typeof at === "number" ? at : index;
    const entry = games[idx] || games[0];
    if (!entry) return;

    // Left page = clean parchment backdrop for the floating diorama; right page =
    // the title + blurb. (Texturing the left page too made the blurb bleed through
    // under the model and read as flicker.)
    if (leftPageMesh && leftPageMesh.material !== M.pageBlank) {
      const old = leftPageMesh.material;
      leftPageMesh.material = M.pageBlank;
      if (old && old !== M.pageBlank) {
        old.map?.dispose?.();
        old.dispose?.();
      }
    }
    setPageTexture(rightPageMesh, entry, idx + 1, total);
  }

  // Build the destination diorama into a holder WITHOUT a visible double-swap:
  // resolve the real previews.js builder up front and add it once; only fall back
  // to the generic diorama when the real builder is unavailable or throws. The
  // stale-guard (games[wantIndex].id !== myId) discards a late async result after
  // a rapid index change so we never reveal the wrong model.
  // onReady(model) fires once the (real or fallback) model is built + fitted.
  function buildPreviewInto(holder, entry, wantIndex, onReady) {
    if (!entry || !holder) return;
    const myId = entry.id;
    const stale = () => disposed || (games[wantIndex] && games[wantIndex].id !== myId);
    loadBuildPreview().then((fn) => {
      if (stale()) return;
      let real = null;
      if (fn) {
        try {
          real = fn(THREE, myId);
        } catch {
          real = null;
        }
      }
      if (stale()) {
        if (real) disposeTree(real);
        return;
      }
      const model = real || fallbackPreview(THREE, entry);
      fitPreview(model);
      // Clear anything previously parked in this holder, then add the single model.
      while (holder.children.length) disposeTree(holder.children.pop());
      holder.add(model);
      if (onReady) onReady(model);
    });
  }

  // Non-animated swap (initial render, guest applyState, setRole): repaint the
  // page art and rebuild the LIVE diorama in place, once, without a fallback->real
  // pop. Used wherever there is no flip animation to hang the swap on.
  function renderSpread() {
    renderPageArt();
    const entry = games[index] || games[0];
    if (!entry) return;
    nextPreview = null;
    if (nextHolder) {
      while (nextHolder.children.length) disposeTree(nextHolder.children.pop());
      nextHolder.visible = false;
    }
    buildPreviewInto(dioramaHolder, entry, index, (model) => {
      currentPreview = model;
      spinT = 0;
    });
  }

  function setPageTexture(meshTarget, entry, side, totalN) {
    if (!meshTarget) return;
    const tex = pageTexture(THREE, entry, side, totalN);
    track(_texs, tex);
    const old = meshTarget.material;
    meshTarget.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86, side: THREE.DoubleSide });
    track(_mats, meshTarget.material);
    // Free the previous per-spread material/texture (not the shared blank).
    if (old && old !== M.pageBlank) {
      old.map?.dispose?.();
      old.dispose?.();
    }
  }

  function clearDiorama() {
    if (!dioramaHolder) return;
    while (dioramaHolder.children.length) {
      const c = dioramaHolder.children.pop();
      disposeTree(c);
    }
    currentPreview = null;
  }

  // Scale + recenter a preview Object3D so it fits the ~0.18 m page footprint and
  // sits on the page surface, regardless of the model's authored size/origin.
  //
  // IMPORTANT: previews.js dioramas arrive ALREADY normalized to ~0.18 m via a
  // wrapper scale (e.g. wrap.scale.setScalar(0.18/maxDim) ≈ 0.257). We must COMPOSE
  // the fit factor onto that existing scale, never OVERWRITE it — setScalar(s) would
  // wipe the wrapper's normalization and render the inner unit-box geometry (~0.7 m)
  // at full size (~4x too big). Multiplying by the current scale keeps both the
  // wrapper normalization (real dioramas, fit factor ≈ 1.0) and full scaling for the
  // un-prescaled fallback diorama working correctly.
  function fitPreview(obj) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxXZ = Math.max(size.x, size.z, 1e-4);
    const target = 0.22; // bigger on the page so the showcase model reads boldly
    const s = Math.min(2.0, target / maxXZ);
    const cur = obj.scale.x || 1; // compose onto any existing normalization scale
    obj.scale.setScalar(cur * s);
    // Recenter on XZ and rest the model's base on the page.
    obj.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(obj);
    const c = new THREE.Vector3();
    box2.getCenter(c);
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    obj.position.y -= box2.min.y;
    // Lift the base a hair (~2 mm) above the page plane so the lowest geometry
    // clears it and doesn't shimmer/z-fight at grazing first-person angles.
    obj.position.y += 0.002;
  }

  // -------------------------------------------------------------------------
  // Page-turn animation. Sweep the turning sheet about the spine. dir +1 = next
  // (sheet sweeps from the right page over to the left), -1 = prev.
  // -------------------------------------------------------------------------
  function startTurn(dir, toIndex) {
    if (turning) return;
    // Sheet starts on the side we're leaving and rotates UP and OVER the spine to
    // the other side. The sheet's plane lies flat in XZ; its outer edge sits at
    // local (+X for the right sheet, -X for the left sheet). Rotating about +Z:
    //   right sheet (+X edge): 0 -> +PI  → midpoint a=+PI/2 lifts the edge STRAIGHT
    //                          UP, then lays it flat on the LEFT page at a=+PI.
    //   left  sheet (-X edge): 0 -> -PI  → midpoint a=-PI/2 lifts the -X edge UP and
    //                          lays it on the RIGHT page at a=-PI.
    // Both sheets START at z=0 (flat on the leaving page) and pass through +Y at
    // their midpoint, so the turning sheet stays ABOVE the page plane the whole
    // sweep — it never dips below the cover/tabletop.
    turnPivot.visible = true;
    const sheetX = Math.abs(turnFront.position.x) * (dir > 0 ? 1 : -1);
    turnFront.position.x = sheetX;
    if (turnBack) turnBack.position.x = sheetX;
    // Dress the moving sheet: its top face carries the LEAVING spread's title/blurb
    // (so it looks like the very page we're lifting), its underside carries the
    // DESTINATION spread's title/blurb (so the new text is already shown as the
    // sheet lays down). With the sheet displaying the text throughout, the static
    // text page underneath can be repainted while COVERED and the change is hidden.
    setSheetFaceArt(turnFront, THREE.FrontSide, index);
    setSheetFaceArt(turnBack, THREE.BackSide, toIndex);
    turning = {
      dir,
      toIndex,
      t: 0,
      dur: 0.45,
      from: 0,
      to: dir > 0 ? Math.PI : -Math.PI,
      dioramaRevealed: false,
      textRepainted: false,
    };
    turnPivot.rotation.x = 0; // we rotate about Z (spine is along X)
    turnPivot.rotation.z = turning.from;
    // Begin preloading the destination diorama into the hidden holder so it is
    // ready to reveal under cover (no lag, no fallback->real pop).
    nextPreview = null;
    if (nextHolder) {
      while (nextHolder.children.length) disposeTree(nextHolder.children.pop());
      nextHolder.visible = false;
    }
    buildPreviewInto(nextHolder, games[toIndex], toIndex, (model) => {
      nextPreview = model;
      // If the diorama's covered-reveal crossing already passed before the model
      // finished loading, reveal it now (its page is the one currently masked).
      if (turning && turning.toIndex === toIndex && turning.dioramaRevealed) revealNext();
    });
    // DIRECTION-AWARE, COVERED-ONLY updates. The single sheet covers exactly one
    // page at a time, and which page it covers when flips with direction:
    //   next (sweep right→left): RIGHT page covered FIRST (e<0.5), LEFT page LAST.
    //   prev (sweep left→right): LEFT page covered FIRST (e<0.5), RIGHT page LAST.
    // The title/blurb lives on the RIGHT page; the diorama floats over the LEFT.
    // To hide every swap we update each item only while ITS page is masked:
    //   • next: repaint RIGHT text NOW (start, right page still covered); reveal the
    //           LEFT diorama later at e≥0.5 (left page then covered).
    //   • prev: reveal the LEFT diorama NOW (start, left page still covered); repaint
    //           the RIGHT text later at e≥0.5 (right page then covered).
    // This replaces the old unconditional e≥0.5 swap, which left the RIGHT text page
    // exposed during a 'next' flip and popped the title/blurb in mid-air.
    if (dir > 0) {
      renderPageArt(toIndex); // RIGHT text repainted while still under the sheet
      turning.textRepainted = true;
    } else {
      revealNext(); // LEFT diorama swapped while still under the sheet
      turning.dioramaRevealed = true;
    }
  }

  // Move the preloaded destination model from nextHolder into the live
  // dioramaHolder, hiding the old model. Exactly ONE swap → no flicker/pop. Resets
  // the idle-spin so the new diorama starts from a clean angle.
  function revealNext() {
    if (!nextPreview || !nextHolder || !dioramaHolder) return;
    while (dioramaHolder.children.length) disposeTree(dioramaHolder.children.pop());
    nextHolder.remove(nextPreview);
    dioramaHolder.add(nextPreview);
    currentPreview = nextPreview;
    nextPreview = null;
    nextHolder.visible = false;
    spinT = 0;
  }

  // Constant hinge height: the pivot stays pinned to the spine at the page height
  // for the whole turn. (Translating the pivot up mid-flip would shift the hinge
  // OFF the spine, detaching the inner edge and making the page levitate/snap.)
  const TURN_PIVOT_Y = 0.02 + 0.018 + 0.0015;

  function stepTurn(dt) {
    if (!turning) return;
    turning.t += dt;
    const k = Math.min(1, turning.t / turning.dur);
    // Ease-in-out: drives the up-and-over arc smoothly. The arc itself comes from
    // rotating about the spine (from A); the hinge never leaves the spine.
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    turnPivot.rotation.z = turning.from + (turning.to - turning.from) * e;
    turnPivot.position.y = TURN_PIVOT_Y;
    // Purely cosmetic paper "curl" about the sheet's own long axis — does NOT move
    // the hinge, so the inner edge stays pinned to the spine.
    const curl = Math.sin(k * Math.PI) * 0.06;
    if (turnFront) turnFront.rotation.z = curl;
    if (turnBack) turnBack.rotation.z = curl;

    // LATE covered-update at e≥0.5, when the sheet has crossed the spine and is
    // descending onto the page it LANDS on (LEFT for next, RIGHT for prev). We swap
    // the item whose page is masked only now (the other item was already updated at
    // turn start, while ITS page was masked):
    //   • next: reveal the LEFT diorama (now covered by the descending sheet).
    //   • prev: repaint the RIGHT text (now covered by the descending sheet).
    // Either way the change happens entirely under the sheet — no flicker, no pop.
    if (e >= 0.5) {
      if (turning.dir > 0 && !turning.dioramaRevealed) {
        turning.dioramaRevealed = true;
        revealNext();
      } else if (turning.dir < 0 && !turning.textRepainted) {
        turning.textRepainted = true;
        renderPageArt(turning.toIndex); // RIGHT text repainted under the landing sheet
      }
    }

    if (k >= 1) {
      const landed = turning.toIndex;
      // SAFETY: if a huge dt skipped the e≥0.5 window, the late covered-update may
      // not have fired. Run any still-pending swap now (one frame may snap, but only
      // in the degenerate large-frame case). Normally both are already done.
      const pendingDiorama = !turning.dioramaRevealed;
      const pendingText = !turning.textRepainted;
      index = landed;
      turning = null;
      turnPivot.visible = false;
      turnPivot.rotation.z = 0;
      turnPivot.position.y = TURN_PIVOT_Y;
      if (turnFront) turnFront.rotation.z = 0;
      if (turnBack) turnBack.rotation.z = 0;
      if (pendingDiorama) revealNext();
      if (pendingText) renderPageArt(); // index now == landed
      sendMenuState(); // host: tell everyone which page we landed on
    }
  }

  function go(dir) {
    if (role !== "host" || turning) return;
    const next = (index + dir + total) % total;
    if (next === index) return;
    startTurn(dir > 0 ? 1 : -1, next);
  }

  // ===========================================================================
  // onPointer — board.js routes a resolved click here. We ignore the geometric
  // `cell` and walk the hit object's ancestors for a userData.menuAction tag.
  // Only the host drives the menu; guests/spectators are inert.
  // ===========================================================================
  function onPointer(hit) {
    if (role !== "host" || disposed || turning) return;
    let o = hit && hit.object;
    let action = null;
    let gameId = null;
    while (o) {
      if (o.userData && o.userData.menuAction) {
        action = o.userData.menuAction;
        gameId = o.userData.gameId ?? null;
        break;
      }
      o = o.parent;
    }
    if (!action) return;
    if (action === "next") go(1);
    else if (action === "prev") go(-1);
    else if (action === "play") {
      const entry = games[index];
      const id = gameId || (entry && entry.id);
      if (id) {
        try {
          onPick(id);
        } catch {
          /* main.js owns the relay; never crash the loop */
        }
      }
    }
  }

  // ===========================================================================
  // update(dt) — idle spin of the diorama + drive the page-turn animation. The
  // framework pumps this on the shared render loop (board.js update()).
  // ===========================================================================
  function update(dt) {
    if (disposed) return;
    spinT += dt;
    if (currentPreview) {
      currentPreview.rotation.y = spinT * 1.0; // showcase spin
    }
    if (dioramaHolder) {
      // Gentle hover bob so the model floats above its glowing podium.
      dioramaHolder.position.y = dioramaBaseY + Math.sin(spinT * 2.2) * 0.006;
    }
    if (glowRingMesh) {
      // Pulse the under-glow for life.
      glowRingMesh.material.emissiveIntensity = 0.7 + Math.sin(spinT * 3.0) * 0.28;
    }
    if (turning) stepTurn(dt);
  }

  // ===========================================================================
  // Role / seat changes. A guest who becomes host (rare) or a spectator promoted
  // flips which root shows; the book always renders in the canonical frame so the
  // engine's orientFor(seatRy) handles facing.
  // ===========================================================================
  function setRole(newRole) {
    role = newRole || "spectator";
    applyRoleVisibility();
    renderSpread();
    sendMenuState(); // self-gates to host; a newly-promoted host re-publishes
  }
  function setSeatRy(ry) {
    // The engine rotates our GROUP by orientFor(ry) (default "flat" orientPolicy), so
    // the book BODY already faces the new seat. But the flat TEXT planes would then
    // read upside-down/backwards from the opposite chair — so track the seat and
    // counter-rotate the text holders to keep every label upright from the local seat.
    seatRy = ry;
    _applyTextFacing();
  }

  // Host → others page sync. The host publishes its open-page index (cached by
  // the server for late joiners); guests + spectators follow on their own
  // per-seat-facing copy of the book. Host is authoritative, so it never applies.
  function sendMenuState() {
    if (role !== "host") return;
    try {
      net.sendState?.({ index }, { index });
    } catch {
      /* main.js / board.js own the relay; never crash the loop */
    }
  }

  function applyState(state) {
    if (role === "host" || !state || typeof state.index !== "number") return;
    const n = ((Math.round(state.index) % total) + total) % total;
    // Equal-index, no-flip snapshots are normally no-ops — BUT a late/duplicate
    // catch-up snapshot must still be able to RECOVER a guest whose first async
    // preview build was discarded (currentPreview never set, or the diorama
    // holder ended up empty). Only short-circuit when there is already a live
    // diorama on the page; otherwise fall through and re-render the spread so the
    // re-pushed {index} repaints the page art and rebuilds the model.
    if (
      n === index &&
      !turning &&
      currentPreview &&
      dioramaHolder &&
      dioramaHolder.children.length
    )
      return;
    index = n;
    if (turning) {
      turning = null;
      if (turnPivot) {
        turnPivot.visible = false;
        turnPivot.rotation.z = 0;
      }
    }
    renderSpread();
  }
  // No per-move deltas — the full index snapshot above is the whole shared state.
  function applyMove() {
    return true;
  }

  function disposeTree(obj) {
    obj.traverse?.((n) => {
      if (n.geometry && !_geos.includes(n.geometry)) n.geometry.dispose?.();
      const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      for (const m of mats) {
        if (_mats.includes(m)) continue;
        m.map?.dispose?.();
        m.dispose?.();
      }
    });
    if (obj.parent) obj.parent.remove(obj);
  }

  function dispose() {
    disposed = true;
    clearDiorama();
    // Also free any model parked in the hidden preload holder.
    if (nextHolder) {
      while (nextHolder.children.length) disposeTree(nextHolder.children.pop());
    }
    nextPreview = null;
    for (const g of _geos) g.dispose?.();
    for (const m of _mats) {
      m.map?.dispose?.();
      m.dispose?.();
    }
    for (const t of _texs) t.dispose?.();
    if (group.parent) group.parent.remove(group);
  }

  return {
    group,
    onPointer,
    update,
    setRole,
    setSeatRy,
    applyState,
    applyMove,
    dispose,
    // Default orientPolicy ("flat"): the engine rotates our group toward the
    // local seat so the open book faces the reader from any chair.
  };
}

export default createGame;
