# syntax=docker/dockerfile:1
# Two stages: build the Vite client (needs dev deps: vite, three), then ship a
# lean runtime image that only carries `ws` plus the built dist/ and the server.

# --- Build stage -----------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Full install (incl. dev deps) so `vite build` is available.
COPY package.json package-lock.json ./
RUN npm ci

# Sources Vite needs: the HTML entry, the modules, the config, and the static
# publicDir (the prebuilt game bundles get copied into dist/ verbatim).
COPY index.html vite.config.js ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

# --- Runtime stage ---------------------------------------------------------
FROM node:20-alpine
WORKDIR /app

# Only production deps (ws) — no vite/three/playwright in the runtime image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY --from=build /app/dist ./dist

ENV PORT=80
EXPOSE 80
CMD ["node", "server/server.js"]
