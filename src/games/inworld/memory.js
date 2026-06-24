// Memory Match — in-world 3D module (createGame contract). HIDDEN-INFO,
// HOST-AUTHORITATIVE. Host owns the shuffled deck (the secret). The snapshot it
// pushes masks face-DOWN card values to null — the deck order never crosses the
// wire. Guest sends {flip,i}; host validates turn, resolves, and pushes the
// masked state. A mismatch shows both cards then flips back on a host-owned timer.
//
// LEAK SAFETY: face values exist ONLY in the host's private `deck`. snapshot()
// nulls the value of any card whose state is "down". Spectators/guests only ever
// receive that masked snapshot (server PUBLIC_RELAY[memory]=false blocks raw
// flips/full to spectators; only `pub` — the masked state — reaches them).

import { BOARD_SIZE, PALETTE, meshOf, standard } from "./pieces.js";

const COLS = 6;
const ROWS = 4;
const PAIRS = (COLS * ROWS) / 2;
const FACES = ["☕", "🫘", "🥐", "🍰", "🍩", "🧁", "🍪", "🥛", "🍫", "🍵", "🧋", "🥧"];
const SHOW_MS = 1100;

function shuffledDeck() {
  const vals = [];
  for (let i = 0; i < PAIRS; i++) vals.push(i, i);
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vals[i], vals[j]] = [vals[j], vals[i]];
  }
  return vals;
}

function faceTexture(THREE, glyph) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  g.fillStyle = PALETTE.lightSq;
  g.fillRect(0, 0, 128, 128);
  g.font = "84px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(glyph || "?", 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGame(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = "memory";

  let role = ctx.role;
  const isHost = role === "host";

  // Host-private deck (null for guest/spectator). cards[i].state: down|up|matched.
  let deck = isHost ? shuffledDeck() : null;
  let cards = Array.from({ length: COLS * ROWS }, () => ({ state: "down", value: null, by: null }));
  let turn = "host"; // host seat0 first
  let scores = { host: 0, guest: 0 };
  let phase = "play";
  let winner = null;
  let pending = []; // host: indices currently up this turn awaiting resolve
  let flipBackAt = 0; // host timer
  let flipBackIdx = null;

  const mySeat = role === "host" ? "host" : role === "guest" ? "guest" : null;

  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const M = {
    felt: keep(standard(THREE, "#6b4327", { roughness: 0.85 })),
    edge: keep(standard(THREE, "#4a2e1a", { roughness: 0.8 })),
    back: keep(standard(THREE, "#8a5526", { roughness: 0.6 })),
    matched: keep(standard(THREE, PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.2, roughness: 0.5 })),
  };
  const faceTextures = [];
  const faceMats = [];

  const plankH = 0.022;
  const outer = BOARD_SIZE + 0.05;
  const plank = meshOf(THREE, keep(new THREE.BoxGeometry(outer, plankH, outer)), M.felt);
  plank.position.y = plankH / 2;
  group.add(plank);
  const TOP = plankH;

  const gw = BOARD_SIZE * 0.92;
  const cw = gw / COLS;
  const ch = (BOARD_SIZE * 0.62) / ROWS;
  const cardW = cw * 0.86, cardH = ch * 0.86;
  function cardX(i) { return -gw / 2 + ((i % COLS) + 0.5) * cw; }
  function cardZ(i) { return -BOARD_SIZE * 0.31 + (Math.floor(i / COLS) + 0.5) * ch; }

  const cardGeo = keep(new THREE.BoxGeometry(cardW, 0.01, cardH));
  const hitGeo = keep(new THREE.BoxGeometry(cardW, 0.04, cardH));
  const invis = keep(new THREE.MeshBasicMaterial({ visible: false }));
  const cardMeshes = [];

  function getFaceMat(value) {
    if (faceMats[value]) return faceMats[value];
    const tex = faceTexture(THREE, FACES[value % FACES.length]);
    faceTextures.push(tex);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    faceMats[value] = mat;
    return mat;
  }

  for (let i = 0; i < COLS * ROWS; i++) {
    const m = meshOf(THREE, cardGeo, M.back);
    m.position.set(cardX(i), TOP + 0.006, cardZ(i));
    group.add(m);
    cardMeshes.push(m);
    const box = new THREE.Mesh(hitGeo, invis);
    box.position.set(cardX(i), TOP + 0.02, cardZ(i));
    box.userData.cell = { i };
    group.add(box);
  }

  function renderCards() {
    for (let i = 0; i < cardMeshes.length; i++) {
      const c = cards[i];
      const m = cardMeshes[i];
      if (c.state === "matched") {
        m.material = c.value != null ? getFaceMat(c.value) : M.matched;
        m.rotation.x = Math.PI;
      } else if (c.state === "up" && c.value != null) {
        m.material = getFaceMat(c.value);
        m.rotation.x = Math.PI;
      } else {
        m.material = M.back;
        m.rotation.x = 0;
      }
    }
  }

  // ---- host logic ----
  function hostFlip(i) {
    if (phase !== "play" || turn !== "guest" && turn !== "host") return;
    if (pending.length >= 2) return;
    const c = cards[i];
    if (c.state !== "down") return;
    c.state = "up";
    c.value = deck[i];
    pending.push(i);
    if (pending.length === 2) {
      const [a, b] = pending;
      if (cards[a].value === cards[b].value) {
        cards[a].state = cards[b].state = "matched";
        scores[turn]++;
        pending = [];
        checkWin();
        // matched → same player goes again (turn unchanged)
      } else {
        // schedule flip-back
        flipBackAt = nowMs() + SHOW_MS;
        flipBackIdx = [a, b];
      }
    }
    renderCards();
    pushState();
  }

  function resolveFlipBack() {
    if (!flipBackIdx) return;
    for (const i of flipBackIdx) {
      cards[i].state = "down";
      cards[i].value = null;
    }
    flipBackIdx = null;
    flipBackAt = 0;
    pending = [];
    turn = turn === "host" ? "guest" : "host";
    renderCards();
    pushState();
  }

  function checkWin() {
    if (cards.every((c) => c.state === "matched")) {
      phase = "over";
      winner = scores.host === scores.guest ? null : scores.host > scores.guest ? "host" : "guest";
      try { ctx.onGameOver({ winner, reason: "all-matched" }); } catch { /* */ }
    }
  }

  // ---- masked snapshot (the ONLY thing that crosses the wire) ----
  function snapshot() {
    return {
      cards: cards.map((c) => ({
        state: c.state,
        // mask: face-down cards carry NO value.
        value: c.state === "down" ? null : c.value,
      })),
      turn, scores: { ...scores }, phase, winner,
    };
  }
  function publicState() { return snapshot(); }
  function pushState() {
    if (role !== "host") return;
    const s = snapshot();
    try { ctx.net.sendState(s, s); } catch { /* */ }
  }

  // ---- contract ----
  function onPointer(hit) {
    if (!ctx.isLocalTurnAllowed()) return;
    if (phase !== "play" || turn !== mySeat) return;
    const cell = hit && hit.cell;
    if (!cell || !Number.isInteger(cell.i)) return;
    if (cards[cell.i].state !== "down") return;
    if (role === "host") {
      hostFlip(cell.i);
    } else {
      try { ctx.net.sendMove({ type: "flip", i: cell.i }); } catch { /* */ }
    }
  }

  // applyMove: host receives a guest {flip,i}; guest/spectator never get raw moves.
  function applyMove(move, byRole) {
    if (role !== "host") return true; // guests render from snapshots only
    if (!move || move.type !== "flip" || !Number.isInteger(move.i)) return false;
    if (byRole !== "guest" || turn !== "guest") return true; // ignore out-of-turn
    hostFlip(move.i);
    return true;
  }

  function applyState(state) {
    if (!state) {
      if (isHost) deck = shuffledDeck();
      cards = Array.from({ length: COLS * ROWS }, () => ({ state: "down", value: null }));
      turn = "host";
      scores = { host: 0, guest: 0 };
      phase = "play";
      winner = null;
      pending = [];
      flipBackIdx = null;
      renderCards();
      if (isHost) pushState();
      return;
    }
    if (role === "host") return; // host is authoritative; ignore echo
    const src = Array.isArray(state.cards) ? state.cards : [];
    cards = Array.from({ length: COLS * ROWS }, (_, i) => {
      const s = src[i] || {};
      return {
        state: s.state === "up" || s.state === "matched" ? s.state : "down",
        value: Number.isInteger(s.value) ? s.value : null,
      };
    });
    turn = state.turn === "guest" ? "guest" : "host";
    scores = { host: state.scores?.host | 0, guest: state.scores?.guest | 0 };
    phase = state.phase === "over" ? "over" : "play";
    winner = state.winner === "host" || state.winner === "guest" ? state.winner : null;
    renderCards();
  }

  // host-owned flip-back timer
  function update() {
    if (role !== "host" || !flipBackIdx) return;
    if (nowMs() >= flipBackAt) resolveFlipBack();
  }

  function setRole(r) {
    role = r || "spectator";
  }
  function setSeatRy() {}
  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const t of faceTextures) t.dispose?.();
    for (const m of faceMats) m?.dispose?.();
    for (const o of owned) o.dispose?.();
  }

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  renderCards();
  if (isHost) pushState();
  return { group, applyState, applyMove, onPointer, publicState, setRole, setSeatRy, update, dispose };
}

export default createGame;
