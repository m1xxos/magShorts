FROM node:22-slim AS deps
WORKDIR /app
# better-sqlite3 compiles from source when no prebuilt binary matches
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/data
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN groupadd --system app && useradd --system --gid app --home /app app \
  && mkdir -p /data && chown app:app /data

COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
# Next's file tracing misses onnxruntime's dlopen'd shared library
# (libonnxruntime.so.1), so ship the whole package.
COPY --from=builder --chown=app:app /app/node_modules/onnxruntime-node ./node_modules/onnxruntime-node

USER app
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
