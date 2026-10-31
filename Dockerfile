# BALL ARENA LEGENDS - production image
#
# Alpine (musl) base keeps the runtime OS surface minimal and avoids the
# Debian 12 glibc/gnutls advisories that have no published fix.
# Stage 1 compiles the better-sqlite3 native addon; build tooling stays out of
# the final image.

FROM node:22-alpine AS deps

WORKDIR /app

# better-sqlite3 ships a C++ addon; build it from source against musl.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
# Build the addon from source (musl has no prebuilt binary) and prove it loads.
RUN npm ci --omit=dev --build-from-source \
 && (node -e "const D=require('better-sqlite3'); new D(':memory:').prepare('select 1').get()" \
     || npm rebuild better-sqlite3 --build-from-source) \
 && npm cache clean --force \
 && rm -rf /root/.npm /root/.node-gyp /tmp/*


FROM node:22-alpine AS runtime

# libstdc++ is required at runtime by the compiled better-sqlite3 addon.
RUN apk add --no-cache libstdc++

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

RUN mkdir -p /app/data/uploads && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
