FROM node:20.18.3-alpine3.21

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY services/documents/src ./services/documents/src
COPY shared ./shared

EXPOSE 3012
USER node
CMD ["node", "services/documents/src/index.js"]
