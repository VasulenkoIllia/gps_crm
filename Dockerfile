FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# The server uses only Node built-ins, so no node_modules are needed at runtime.
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

USER node

CMD ["node", "dist-server/server.js"]
