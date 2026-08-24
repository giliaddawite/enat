# Build stage: full toolchain, discarded before the runtime image is assembled.
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Reduce node_modules to runtime dependencies in place, so the runtime stage copies a tree
# that is already minimal. Image size is the dominant term in Cloud Run cold start.
RUN npm prune --omit=dev


FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

EXPOSE 8080

# Exec form with the node binary directly: Cloud Run's SIGTERM reaches PID 1 and the
# graceful shutdown handler runs. An npm wrapper would swallow the signal.
CMD ["node", "dist/index.js"]
