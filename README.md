# ☕ The Daily Grind — Multiplayer 3D Coffeeshop

A cozy, goal-free multiplayer café. Walk around a warm little coffeeshop with other
people, bump into the furniture, chat with speech bubbles floating over your head,
and talk over proximity voice (WebRTC) — the closer you stand, the louder you are.

Built with **vanilla JS + Three.js** (no UI framework), bundled by **Vite** so every
build ships content-hashed, cache-busted assets. A tiny **Node + `ws`** server serves
the built client and relays player state, chat, and WebRTC signaling.

## Run locally

Two flavors — a Vite dev server with HMR, or a production-style build served by Node.

**Dev (HMR):** the client and the multiplayer relay run as two processes.

```bash
npm install
npm run server   # terminal 1 — Node + ws relay on :8080 (serves /ws, /health)
npm run dev      # terminal 2 — Vite dev server on :5173 (proxies /ws → :8080)
```

Open http://localhost:5173 in two tabs to see multiplayer.

**Production-style (one process):** build, then let Node serve the output.

```bash
npm run build    # → dist/ with hashed assets + a no-cache index.html
npm start        # Node serves dist/ + the /ws relay on :8080
```

Caching is set up so deploys are picked up instantly: `index.html` is sent
`no-cache, no-store` (always re-fetched), while the hashed files under `/assets/`
are `immutable` for a year — a changed file gets a new hash, so the browser only
re-downloads what actually changed.

## Controls

- **WASD / arrows** — walk
- **Drag** — orbit the camera (mouse, or right side on touch)
- **Mouse wheel** — zoom
- **Enter** — focus chat · **Esc** — leave chat
- **🎙️ Enable voice** — proximity voice chat: the closer you stand, the louder you are. **Sitting at a game table scopes your voice to that table** — you only hear, and are heard by, the people seated there (players and spectators), so each table is its own private conversation. Once on: **🎤 Mic** mutes/unmutes your own microphone, **🔊 Audio** silences everyone at once.
- On touch devices, a virtual joystick appears on the left.
- **Step outside** — walk out the front door onto the city block: sidewalks, a
  road with cars driving by, birds overhead, and street props. The block drops
  off at its edges — walk off and you fall, then respawn back in the café.

## Project layout

```
index.html                Vite entry (loads /src/main.js; assets injected on build)
vite.config.js            build (dist/ + hashed assets) and dev-server proxy config
server/server.js          Node http + ws: serves dist/, /ws relay, /health
public/                   Vite publicDir — copied into dist/ verbatim (not processed)
  games/                  self-contained game builds served in <iframe> (e.g. battleship/)
src/
  styles.css              HUD, overlay, CSS2D label/bubble styles (imported by main.js)
  config.js               tuning constants (speeds, camera, palette, voice)
  main.js                 wiring + game loop
  games/registry.js       game catalog: id -> { name, capacity, url(roomId, role) }
  games/arcade.js         centered modal that hosts a game in an iframe
  engine/scene.js         renderer, lights, CSS2D overlay, resize
  engine/controls.js      keyboard, drag-to-orbit, touch joystick
  world/coffeeshop.js     assembles the room + entrance; returns colliders, ground, spawn
  world/outside.js        the street block: road, props, ambient cars + birds
  world/props.js          reusable furniture/decor builders
  world/textures.js       procedural canvas textures (wood, plaster, menu)
  world/collision.js      circle-vs-AABB resolution
  entities/character.js   low-poly character + walk animation
  entities/localPlayer.js movement, collision, follow camera
  entities/remotePlayers.js  interpolated remote players
  net/network.js          WebSocket client (auto-reconnect)
  net/voice.js            WebRTC mesh + distance-based volume
  ui/labels.js            floating name tags + chat bubbles (CSS2D)
  ui/hud.js               join overlay, chat bar, voice toggle, count
```

Three.js (and its `three/addons/*` helpers) are pulled from `node_modules` and
bundled by Vite — there's no vendored copy or runtime CDN dependency.

Each piece lives in its own module so you can iterate on one without touching the
rest (and without re-reading the whole game).

## 🎮 Table games

Sit down at any café table (**Space** next to a chair) and that table's game opens
in a **modal** over the café — the room and the people in it stay visible behind
it. Closing the modal (the **Leave game** button, a click on the dimmed backdrop,
or **Esc**) — or standing up — returns you to the café and ends the match.
Each table is its **own room**, so two people at the same table play each other.

How a match is coordinated:

- The `ws` server is a **generic room coordinator** — it doesn't know what game a
  table runs. The first person to sit is the **host** (and gets a fresh random
  `roomId`); everyone who sits after, up to the game's **`capacity`**, is a
  **guest** (same `roomId`). Most games are two-player, but a game can ask for up
  to four — **Ludo** seats a host + up to three guests at one table, and every
  guest joins the host the same way (`#join`) while the game assigns each a
  colour by connection order. Once all player seats are taken, further sitters
  become **spectators** of the running match (same `roomId`), watching read-only
  instead of being turned away. The **host** leaving ends the match and frees the
  table (everyone is sent back); in a >2-player game a single *guest* leaving just
  frees their seat and the match plays on, and a spectator leaving just stops
  watching.
- Spectating is driven by the game itself: the host owns the room's fixed PeerJS
  peer, so spectators connect to it read-only (`#spectate=<roomId>`) and the host
  streams a board snapshot after every move. Whether a game supports this is a
  `spectatable` flag in `src/games/registry.js` — Checkers and Connect 4 do;
  Battleship (a prebuilt bundle) doesn't, so its full tables fall back to a
  "can't be spectated" notice.
- The game itself runs in a sandboxed `<iframe>`. **Battleship** ships under
  `public/games/battleship/` and pairs the two players over PeerJS — the host
  registers the room's peer (`#host=<roomId>`) and the guest joins it
  (`#join=<roomId>`).

### Adding a new game

1. Drop a self-contained static build under `public/games/<id>/` (Vite copies it
   into `dist/` verbatim, so its own hashed assets are left untouched).
2. Add an entry to `src/games/registry.js` describing how to build its room
   URL from `(roomId, role)`.
3. Point one or more tables at it via `TABLE_GAME(i)` in
   `src/world/coffeeshop.js` (return your new `id` for those table indices).

Nothing else changes — the server and the Arcade overlay are game-agnostic.

## Tests / validation

```bash
npm run check          # node --check every module (syntax)
npm run test:collision # unit-test the collision resolver
npm run test:ws        # spawn server, validate the multiplayer relay
npm run test:game      # spawn server, validate table game room/role coordination
npm run test:e2e       # vite build, then headless two-player browser test (movement, chat, voice)
npm test               # all of the above
```

The e2e test uses Playwright with a fake mic to verify two players see each other,
chat propagates with bubbles, walking + collision works, and a WebRTC voice peer
actually reaches the `connected` state.

## Deploy (Launch Pad)

`launch-pad.toml` targets `coffeeshop.games.webdevcody.com`. The `Dockerfile` is
multi-stage — it runs `vite build` to produce `dist/`, then ships a lean runtime
image where the Node server serves `dist/` and the WebSocket relay on port 80.

```bash
lpd deploy
```

> Multiplayer state is kept in process, so keep `replicas = 1` — players on
> different replicas wouldn't see each other without a shared backplane.
