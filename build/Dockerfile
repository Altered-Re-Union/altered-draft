# syntax=docker/dockerfile:1
#
# Build context is the repo root. Two targets, mirroring altered-bga-api's build:
#   docker build -f build/Dockerfile -t altered-draft .
#   docker build -f build/Dockerfile --target migrations -t altered-draft-migrations .
#
# `app`: the Vite frontend (built to static files) served by a small Express server
# (server/index.js) that also routes /api/* to the same Vercel-style handler modules
# used on the Vercel deployment — see server/index.js's header comment. Expects
# DATABASE_URL (Postgres, for the tournament sealed pool state — see ROADMAP.md
# "Set 6 preview"), plus the same env vars the Vercel deploy uses
# (KEYCLOAK_CLIENT_SECRET, SEALED_ATTESTATION_SECRET).
#
# `migrations` is a one-shot container that applies every *.sql file in this dir, in
# order (01-sealed-pools, 02-draft-rooms, 03-realtime — all idempotent, every statement
# is IF NOT EXISTS/guarded) and exits. Connection string comes from DATABASE_URL at
# runtime:
#   docker run --rm -e DATABASE_URL=postgres://... altered-draft-migrations
#
# 03-realtime.sql bootstraps the self-hosted supabase/realtime sidecar (postgres_changes
# CDC support against a vanilla postgres image — see realtime-schema.sql's own header
# and ROADMAP.md "Realtime"). Requires wal_level=logical + the wal2json plugin, both set
# on the postgres service itself (AlteredOps' postgres/Dockerfile + docker-compose.yml
# command — not something this migrations image controls).

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY api ./api
COPY src ./src
COPY server ./server
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server/index.js"]

FROM postgres:17-alpine AS migrations
WORKDIR /migrations
COPY sealed-pools-schema.sql ./01-sealed-pools.sql
COPY draft-rooms-schema.sql ./02-draft-rooms.sql
COPY realtime-schema.sql ./03-realtime.sql
CMD ["sh", "-c", "set -e; for f in *.sql; do psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f \"$f\"; done"]
