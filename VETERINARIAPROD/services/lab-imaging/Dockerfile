FROM node:20.18.3-alpine3.21

# Install from the root package.json — it contains all dependencies needed
# by both the service and the shared/ modules.
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY services/lab-imaging/src ./services/lab-imaging/src
COPY shared ./shared

EXPOSE 3004
USER node
CMD ["node", "services/lab-imaging/src/index.js"]
