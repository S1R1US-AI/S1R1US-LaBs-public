# Stage 1: build .output from source on DigitalOcean's build machine.
# App Platform builds run on separate build resources, not on the 1 GB
# runtime instance, so compiling here is safe. .output is never committed.
FROM node:22-bookworm-slim AS build

WORKDIR /app

# No ARG lines on purpose: no DigitalOcean setting reaches the build, so no
# secret can end up in the image. build:do sets its own defaults.

# npm 11.21.0 matches the lockfile (Node 22 ships npm 10).
RUN npm install -g npm@11.21.0
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build:do

# Stage 2: runtime image. Same layout as before: built .output, the start
# script and the front-door static overlay. No node_modules, no source.
FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=build /app/.output /app/.output
COPY scripts/do-start.mjs /app/scripts/do-start.mjs
# Soft-launch front-door static overlay (outside .output; Security path A)
COPY --from=build /app/front-door-static /app/front-door-static
# PGLite WASM is not inside node_modules in this image — pin the files
# Better Auth / admin lock load on first Continue with X / Unlock.
COPY --from=build /app/.output/server/_libs/pglite.wasm /app/pglite/pglite.wasm
COPY --from=build /app/.output/server/_libs/pglite.data /app/pglite/pglite.data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=8080
ENV PGLITE_DATA_DIR=/tmp/s1r1us-pglite
EXPOSE 8080

CMD ["node", "scripts/do-start.mjs"]
