# Imagen única: compila el frontend y lo sirve desde la API.

FROM node:20-alpine AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
USER node
EXPOSE 4000
CMD ["sh", "-c", "node scripts/migrate.js && node scripts/seed.js && node src/server.js"]
