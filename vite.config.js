import { defineConfig } from "vite";

// The client is a vanilla three.js app (no framework). Vite gives us:
//   - content-hashed bundles in dist/assets/ (cache busting on every change)
//   - automatic <link>/<script> rewriting in index.html to those hashed names
//   - three (+ its addons) bundled from node_modules instead of a vendored copy
//
// `publicDir` (./public) is copied verbatim into dist/ — that's where the
// prebuilt, self-contained game bundles live (e.g. public/games/battleship/),
// which are already hashed by their own build and must not be re-processed.
export default defineConfig({
  // Project root holds index.html; source lives in ./src.
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Default assetsDir is "assets" → all hashed JS/CSS land in dist/assets/.
    // The server caches that directory immutably; index.html is never cached.
  },
  // Dev server with HMR. The multiplayer/voice WebSocket relay runs separately
  // (`npm run server`); proxy /ws and /health to it so same-origin code works
  // unchanged in dev.
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/health": "http://localhost:8080",
    },
  },
});
