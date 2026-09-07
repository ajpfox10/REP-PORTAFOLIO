FROM node:20.18.3-alpine3.21

# Install from the root package.json — it contains all dependencies needed
# by both the gateway and the shared/ modules (redis, prom-client, etc.).
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

# Maintain the monorepo structure so relative imports resolve correctly:
#   /app/gateway/src/index.js  →  ../../shared  →  /app/shared  ✓
#   /app/shared/*.js           →  require('redis')  →  /app/node_modules  ✓
COPY gateway/src ./gateway/src
COPY gateway/middleware ./gateway/middleware
COPY gateway/docs ./gateway/docs
COPY shared ./shared

RUN mkdir -p /app/gateway/logs && chown -R node:node /app

USER node

EXPOSE 4050
CMD ["node", "gateway/src/index.js"]
