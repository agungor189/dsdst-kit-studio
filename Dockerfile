FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production PORT=3012 DB_PATH=/data/dsdst-kit-studio.db UPLOAD_DIR=/app/uploads
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
RUN npm prune --omit=dev --ignore-scripts
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/dist-server ./dist-server
COPY --chown=node:node --from=builder /app/server/db/migrations ./server/db/migrations
RUN mkdir -p /data /app/uploads/complementary-products && chown -R node:node /data /app/uploads
USER node
EXPOSE 3012
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://localhost:3012/api/health || exit 1
CMD ["node", "dist-server/server/index.js"]
