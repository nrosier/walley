# syntax=docker/dockerfile:1
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS runtime
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA
ENV NODE_ENV=production
RUN mkdir -p /app /data && chown node:node /app /data
WORKDIR /app
USER node
COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node LICENSE ./
# The runtime only runs `node`. npm, npx and corepack are not used after the
# production dependencies are installed, and the copies of undici, ip-address,
# brace-expansion, minimatch, glob and postcss-selector-parser bundled inside
# npm carry the HarborGate CVE findings, so remove the toolchain.
USER root
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn*
# The pinned base digest ships zlib 1.3.2-r1. Upgrading it fixes CVE-2026-4738
# (issue 197). Drop this step once the base digest ships zlib >= 1.4-r0.
RUN apk add --no-cache 'zlib>=1.4-r0'
USER node
ENV HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/walley.db DATA_DIR=/data
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
