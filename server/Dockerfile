FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data && chown -R node:node /app

ENV PORT=8787
ENV DB_PATH=/app/data/tasksync.db
EXPOSE 8787

USER node
CMD ["node", "index.js"]
