# Local dev stack: Postgres (Docker) + schema migrations + API (Express) + Vite (HMR).
# Realtime is not part of the local stack — live multiplayer updates won't arrive.
#
#   make dev        everything in one command (Ctrl+C stops API + Vite, DB keeps running)
#   make db-down    stop Postgres (data kept)    make db-reset   wipe + recreate the DB
#
# Re:Union login + decks target the LOCAL Keycloak and decks-api from
# ../altered-dev-environment (start it first: ./run.sh there). Without it the app still
# runs, just without login. Test users: alice / bob, password TestPassword1234.

# Node version pinned in .nvmrc (matches build/Dockerfile's node:22). When nvm has it,
# recipes call that node/npm/npx explicitly (macOS's make 3.81 resolves recipe binaries
# against the original PATH) and its bin dir is exported first on PATH for child
# processes, so everything runs on it even from a shell still on another version.
NODE_VERSION := $(shell cat .nvmrc)
NVM_NODE     := $(shell [ -s "$$NVM_DIR/nvm.sh" ] && . "$$NVM_DIR/nvm.sh" >/dev/null 2>&1 && nvm which $(NODE_VERSION) 2>/dev/null)
NODE_BIN     := $(if $(NVM_NODE),$(dir $(NVM_NODE)))
ifneq ($(NODE_BIN),)
export PATH := $(NODE_BIN):$(PATH)
endif
NODE := $(NODE_BIN)node
NPM  := $(NODE_BIN)npm
NPX  := $(NODE_BIN)npx

DB_PORT  ?= 5432
API_PORT ?= 8080
export API_PORT
COMPOSE  := DB_PORT=$(DB_PORT) docker compose
PSQL     := $(COMPOSE) exec -T -e PGOPTIONS=--client-min-messages=warning postgres psql -U altered-draft -d altered-draft -v ON_ERROR_STOP=1 -q

# API server with file watching. NODE_EXTRA_CA_CERTS is only honoured as a real env var
# at process start (not via --env-file), so it's lifted out of .env — needed to trust a
# local service's self-signed CA (e.g. altered-core-cards-api's Caddy, see .env.example).
API_CMD = env $$(grep -E '^NODE_EXTRA_CA_CERTS=.' .env) $(NODE) --env-file=.env --watch-path=api --watch-path=src/lib --watch-path=server server/index.js

# Same order as the `migrations` target in build/Dockerfile (minus realtime-schema.sql).
SCHEMAS := sealed-pools-schema.sql draft-rooms-schema.sql

# Local .env defaults, added only when the key is missing (an existing value always wins).
# Re:Union endpoints point at altered-dev-environment; the secret is the one
# scripts/keycloak-dev-client.mjs registers.
ENV_DEFAULTS := \
	DATABASE_URL=postgres://altered-draft:altered-draft@localhost:$(DB_PORT)/altered-draft \
	PORT=$(API_PORT) \
	KEYCLOAK_ISSUER=http://auth.altered.local.gd:18080/realms/players \
	KEYCLOAK_CLIENT_SECRET=dev-altered-draft-secret \
	DECKS_API_URL=http://localhost:8001

.PHONY: dev check-node install env keycloak-client db-up db-migrate db-down db-reset db-shell api web test

dev: check-node install env db-up db-migrate keycloak-client
	@echo "→ API on http://localhost:$(API_PORT) · app on http://localhost:5173"
	@trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT; \
	$(API_CMD) & \
	$(NPX) vite

check-node:
	@$(NODE) -e 'if (process.versions.node.split(".")[0] !== "$(NODE_VERSION)") { console.error("Node $(NODE_VERSION) required (.nvmrc), found " + process.version + " — run: nvm install $(NODE_VERSION)"); process.exit(1) }'

# npm ci never rewrites package-lock.json; reinstall only when the lockfile changed.
install: node_modules/.install-stamp
node_modules/.install-stamp: package-lock.json
	$(NPM) ci
	@touch $@

# .env is gitignored; fill in any missing or empty key from ENV_DEFAULTS (e.g. after
# copying .env.example), never overwrite a value.
env:
	@[ -f .env ] || : > .env
	@for kv in $(ENV_DEFAULTS); do \
		key=$${kv%%=*}; \
		if grep -q "^$$key=$$" .env; then \
			sed -i.bak "s|^$$key=$$|$$kv|" .env && rm -f .env.bak; echo "→ .env: set $$key"; \
		elif ! grep -q "^$$key=" .env; then \
			echo "$$kv" >> .env; echo "→ .env: added $$key"; \
		fi; \
	done

# Local Keycloak has no altered-draft client and forgets it on every restart — (re)register
# it. Never fails (login is optional); warns if altered-auth isn't running.
keycloak-client: check-node env
	@$(NODE) --env-file=.env scripts/keycloak-dev-client.mjs

db-up:
	@$(COMPOSE) up -d --wait postgres

# Idempotent (IF NOT EXISTS / guarded seed) — safe on every start. Seeds the active
# tournament format (current_format) on a fresh DB; card data itself is fetched live
# from the community sources, nothing else to import.
db-migrate:
	@for f in $(SCHEMAS); do echo "→ applying $$f"; $(PSQL) -f /schemas/$$f || exit 1; done

db-down:
	@$(COMPOSE) down

db-reset:
	@$(COMPOSE) down -v
	@$(MAKE) db-up db-migrate

db-shell:
	@$(COMPOSE) exec postgres psql -U altered-draft -d altered-draft

api: check-node env
	$(API_CMD)

web:
	$(NPX) vite

test: check-node install
	$(NPM) test
