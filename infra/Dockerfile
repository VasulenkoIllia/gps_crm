# Built from the repository root: docker build -f infra/Dockerfile .
# Node is pinned by the digest of the multi-arch image list; the owner updates it (docs in README).
# .npmrc comes with the manifests: install scripts of dependencies never run, here or in the runtime stage.
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build

# Runtime stage: production dependencies of the API and compiled code only, as the unprivileged node user.
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace=@gps_crm/api
# Node runs this package from its TypeScript source and strips the types
COPY packages/shared/src ./packages/shared/src
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/
WORKDIR /app/apps/api
# The migration engine comes from an install script, which never runs: fetch it now, at build time, not on start
RUN ../../node_modules/.bin/prisma version
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/web/dist /app/apps/web/dist
# The server has no git: deploy-entry.sh takes compose.yml and deploy.sh out of the image it is about to run
COPY infra/compose.yml /app/infra/compose.yml
COPY infra/scripts /app/infra/scripts
# The mount point of the volume `files-data`: a new named volume takes its owner from here
RUN mkdir /files && chown node:node /files
USER node
CMD ["node", "dist/main.js"]
