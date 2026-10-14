# Production images for Tavolina (plan §15, Phase 10). Build from the repository root:
#   docker compose -f docker-compose.prod.yml build
# Targets: `api` (Node: REST + Socket.IO) and `web` (nginx: staff app, guest app, proxy to the API).

# ---- Build everything once -------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Install with the lockfile first so dependency layers are cached between source changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/staff/package.json apps/staff/
COPY apps/guest/package.json apps/guest/
COPY apps/print-bridge/package.json apps/print-bridge/
# No install scripts: the root `prepare` only sets up git hooks; sharp and esbuild ship their
# native binaries as platform packages.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build -w @tavolina/api -w @tavolina/staff -w @tavolina/guest

# ---- API runtime -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/staff/package.json apps/staff/
COPY apps/guest/package.json apps/guest/
COPY apps/print-bridge/package.json apps/print-bridge/
# Only the API's runtime dependencies (workspace packages are bundled into its build).
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w @tavolina/api \
  && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh \
  && mkdir -p /data/uploads && chown -R node:node /data /app
USER node
WORKDIR /app/apps/api
ENV UPLOADS_DIR=/data/uploads
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4100)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["api-entrypoint.sh"]
CMD ["node", "dist/server.js"]

# ---- Web (static apps + reverse proxy) -------------------------------------------------------
FROM nginx:1.28-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/staff/dist /usr/share/nginx/staff
COPY --from=build /app/apps/guest/dist /usr/share/nginx/guest
EXPOSE 8080 8081
