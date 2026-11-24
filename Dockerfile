# ==========================================
# Stage 1: Build React client
# ==========================================
FROM node:22-alpine AS client-builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ .
RUN npm run build


# ==========================================
# Stage 2: Build Express server
# ==========================================
FROM node:22-alpine AS server-builder

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci

COPY server/ .

RUN npx prisma generate
RUN npm run build


# ==========================================
# Stage 3: Production runtime
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app/server

ENV NODE_ENV=production

COPY server/package*.json ./

# IMPORTANT:
# This must leave Prisma CLI available if
# startup runs `prisma migrate deploy`.
RUN npm ci

COPY --from=server-builder /app/server/prisma ./prisma
RUN npx prisma generate
COPY --from=server-builder /app/server/dist ./dist

COPY --from=client-builder /app/client/dist /app/client/dist

EXPOSE 10000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]