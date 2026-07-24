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
# `migrations` is a one-shot container that applies sealed-pools-schema.sql (idempotent
# — every statement is IF NOT EXISTS) and exits. Connection string comes from
# DATABASE_URL at runtime:
#   docker run --rm -e DATABASE_URL=postgres://... altered-draft-migrations

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
COPY sealed-pools-schema.sql ./schema.sql
CMD ["sh", "-c", "psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f schema.sql"]
