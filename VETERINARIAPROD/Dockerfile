# ── Stage 1: build frontend ───────────────────────────────────────────────────
FROM node:20.18.3-alpine3.21 AS frontend-build
WORKDIR /app/frontend
ARG VITE_CAPTCHA_ENABLED
ARG VITE_HCAPTCHA_SITE_KEY
ARG CAPTCHA_ENABLED
ARG HCAPTCHA_SITE_KEY
COPY andromeda-front/package.json andromeda-front/package-lock.json ./
RUN npm ci
COPY andromeda-front/ .
# Sin VITE_API_URL → baseURL queda relativo (/api/v1) — funciona con el mismo origen
RUN VITE_CAPTCHA_ENABLED="${VITE_CAPTCHA_ENABLED:-$CAPTCHA_ENABLED}" \
    VITE_HCAPTCHA_SITE_KEY="${VITE_HCAPTCHA_SITE_KEY:-$HCAPTCHA_SITE_KEY}" \
    npm run build

# ── Stage 2: backend + frontend dist ─────────────────────────────────────────
FROM node:20.18.3-alpine3.21
WORKDIR /app

RUN npm install -g pm2 && \
    mkdir -p /app/logs/pm2 && \
    chown -R node:node /app

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm install --omit=dev

COPY --chown=node:node shared ./shared
COPY --chown=node:node gateway ./gateway
COPY --chown=node:node services ./services
COPY --chown=node:node plugins ./plugins
COPY --chown=node:node ecosystem.railway.config.js ./

# Copia el dist del frontend para que el gateway lo sirva
COPY --from=frontend-build --chown=node:node /app/frontend/dist ./andromeda-front/dist

EXPOSE 4050
CMD ["pm2-runtime", "start", "ecosystem.railway.config.js"]
