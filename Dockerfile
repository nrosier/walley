# syntax=docker/dockerfile:1
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runtime
ENV NODE_ENV=production
RUN mkdir -p /app /data && chown node:node /app /data
WORKDIR /app
USER node
COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node LICENSE ./
ENV HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/walley.db DATA_DIR=/data
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
