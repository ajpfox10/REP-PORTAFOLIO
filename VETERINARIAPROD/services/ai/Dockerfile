FROM node:20.18.3-alpine3.21

# Install from the root package.json — it contains all dependencies needed
# by both the service and the shared/ modules.
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY services/ai/src ./services/ai/src
COPY shared ./shared

EXPOSE 4061
USER node
CMD ["node", "services/ai/src/index.js"]
