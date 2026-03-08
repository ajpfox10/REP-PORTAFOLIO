FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS base
RUN apk add --no-cache dumb-init curl
RUN addgroup -g 1001 vetpro && adduser -u 1001 -G vetpro -s /bin/sh -D vetpro
WORKDIR /app
COPY --from=deps    --chown=vetpro:vetpro /app/node_modules ./node_modules
COPY --from=builder --chown=vetpro:vetpro /app/dist         ./dist
COPY --from=builder --chown=vetpro:vetpro /app/config       ./config
COPY --chown=vetpro:vetpro sql ./sql
COPY --chown=vetpro:vetpro package.json ./
USER vetpro
ENV NODE_ENV=production

# ── API ───────────────────────────────────────────────────────────────────────
FROM base AS runtime
EXPOSE 3000
ENV PORT=3000
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fs http://localhost:3000/health | grep '"ok":true' || exit 1

# ── Worker ────────────────────────────────────────────────────────────────────
FROM base AS worker
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "--enable-source-maps", "dist/worker/index.js"]

# ── Scheduler (proceso separado, 1 sola instancia en el cluster) ──────────────
FROM base AS scheduler
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "--enable-source-maps", "dist/scheduler/schedulerWorker.js"]
