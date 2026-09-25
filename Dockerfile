FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
COPY admin/package*.json ./admin/
RUN npm ci

COPY server ./server
COPY scripts ./scripts
COPY themes ./themes
COPY admin ./admin
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY admin/package*.json ./admin/
RUN npm ci --omit=dev

COPY --from=build /app/admin/dist ./admin/dist
COPY server ./server
COPY scripts ./scripts
COPY themes ./themes

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/var/lib/blogs \
    UPLOADS_DIR=/var/lib/blogs/uploads \
    SITE_PATH=/blog

VOLUME ["/var/lib/blogs"]
EXPOSE 4000

CMD ["node", "server/index.js"]
