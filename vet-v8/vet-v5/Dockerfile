# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install only build deps
COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
COPY config ./config

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: deps-only (no devDependencies)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: runtime — minimal attack surface
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache dumb-init curl

# Non-root user
RUN addgroup -g 1001 vetpro && adduser -u 1001 -G vetpro -s /bin/sh -D vetpro

WORKDIR /app

# Copy only what's needed
COPY --from=deps     --chown=vetpro:vetpro /app/node_modules ./node_modules
COPY --from=builder  --chown=vetpro:vetpro /app/dist         ./dist
COPY --from=builder  --chown=vetpro:vetpro /app/config       ./config
COPY --chown=vetpro:vetpro sql ./sql
COPY --chown=vetpro:vetpro package.json ./

USER vetpro

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Graceful shutdown + signal forwarding
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fs http://localhost:3000/health | grep '"ok":true' || exit 1

# ─────────────────────────────────────────────────────────────────────────────
# Worker variant
# ─────────────────────────────────────────────────────────────────────────────
FROM runtime AS worker
CMD ["node", "--enable-source-maps", "dist/worker/index.js"]
