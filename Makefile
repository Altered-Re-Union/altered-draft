# Local dev stack: the Re:Union dev environment (Keycloak + decks-api, from the sibling
# ../altered-dev-environment repo) + Postgres (Docker) + schema migrations + the dev test
# accounts + API (Express) + Vite (HMR). Realtime is not part of the local stack — live
# multiplayer updates won't arrive.
#
#   make dev           everything in one command, ends with a summary of URLs + accounts
#                      (Ctrl+C stops API + Vite; Postgres and the dev env keep running)
#   make dev-env-down  stop the dev env started by make dev    make db-down   stop Postgres
#   make db-reset      wipe + recreate the DB
#
# Without the dev env (repo not cloned, DEV_ENV_DIR to point elsewhere) the app still
# runs, just without login. Test users: alice / bob come with the realm, carol is created
# by make dev (scripts/keycloak-dev-users.mjs); password TestPassword1234 for all.

# Node version pinned in .nvmrc (matches build/Dockerfile's node:22) is the recommended
# one; any Node >= NODE_MIN works (--env-file needs 20.6). When nvm has the pinned one,
# recipes call that node/npm/npx explicitly (macOS's make 3.81 resolves recipe binaries
# against the original PATH) and its bin dir is exported first on PATH for child
# processes, so everything runs on it even from a shell still on another version.
NODE_VERSION := $(shell cat .nvmrc)
NODE_MIN     := 20.6
NVM_NODE     := $(shell [ -s "$$NVM_DIR/nvm.sh" ] && . "$$NVM_DIR/nvm.sh" >/dev/null 2>&1 && nvm which $(NODE_VERSION) 2>/dev/null)
NODE_BIN     := $(if $(NVM_NODE),$(dir $(NVM_NODE)))
ifneq ($(NODE_BIN),)
export PATH := $(NODE_BIN):$(PATH)
endif
NODE := $(NODE_BIN)node
NPM  := $(NODE_BIN)npm
NPX  := $(NODE_BIN)npx

DB_PORT     ?= 5432
API_PORT    ?= 8080
DEV_ENV_DIR ?= ../altered-dev-environment
export DEV_ENV_DIR
export API_PORT
COMPOSE  := DB_PORT=$(DB_PORT) docker compose
PSQL     := $(COMPOSE) exec -T -e PGOPTIONS=--client-min-messages=warning postgres psql -U altered-draft -d altered-draft -v ON_ERROR_STOP=1 -q

LOCAL_DB_URL := postgres://altered-draft:altered-draft@localhost:$(DB_PORT)/altered-draft

# Real env vars win over --env-file, so ports come from the make variables rather than
# .env: `make dev API_PORT=… DB_PORT=…` keeps the API, Vite's proxy and Postgres in sync.
# DATABASE_URL is only forced when DB_PORT is overridden, so a custom one in .env stays.
API_ENV := PORT=$(API_PORT)
ifneq ($(filter command line environment,$(origin DB_PORT)),)
API_ENV += DATABASE_URL=$(LOCAL_DB_URL)
endif

# API server with file watching. NODE_EXTRA_CA_CERTS is only honoured as a real env var
# at process start (not via --env-file), so it's lifted out of .env (quotes stripped,
# spaces kept) — needed to trust a local service's self-signed CA (see .env.example).
API_CMD = ca="$$(sed -n 's/^NODE_EXTRA_CA_CERTS=//p' .env | tail -n 1 | tr -d "\"'")"; \
	env $(API_ENV) $${ca:+"NODE_EXTRA_CA_CERTS=$$ca"} \
	$(NODE) --env-file=.env --watch-path=api --watch-path=src/lib --watch-path=server server/index.js

# Same order as the `migrations` target in build/Dockerfile (minus realtime-schema.sql).
SCHEMAS := sealed-pools-schema.sql draft-rooms-schema.sql

# Local .env defaults, added only when the key is missing (an existing value always wins).
# Re:Union endpoints point at altered-dev-environment; the secret is the one
# scripts/keycloak-dev-client.mjs registers.
ENV_DEFAULTS := \
	DATABASE_URL=$(LOCAL_DB_URL) \
	KEYCLOAK_ISSUER=http://auth.altered.local.gd:18080/realms/players \
	KEYCLOAK_CLIENT_SECRET=dev-altered-draft-secret \
	DECKS_API_URL=http://localhost:8001

.PHONY: dev dev-summary dev-env dev-env-down check-node install env keycloak-client keycloak-users db-up db-migrate db-freeze-pools db-down db-reset db-shell api web test e2e e2e-ui e2e-down

dev: check-node install env dev-env db-up db-migrate keycloak-client keycloak-users dev-summary
	@trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT; \
	$(API_CMD) & \
	$(NPX) vite

# What just started and how to get in. Printed before the API + Vite banners.
dev-summary:
	@kc="$$(sed -n 's/^KEYCLOAK_ISSUER=//p' .env | tail -n 1 | sed 's|/realms/.*||')"; \
	decks="$$(sed -n 's/^DECKS_API_URL=//p' .env | tail -n 1)"; \
	mods="$$(sed -n 's/^TOURNAMENT_MODERATORS=//p' .env | tail -n 1)"; \
	printf '\n────────────────────────────── local stack ──────────────────────────────\n'; \
	printf '  app        http://localhost:5173\n'; \
	printf '  API        http://localhost:$(API_PORT)\n'; \
	printf '  Keycloak   %s/admin   (admin / admin, realm players)\n' "$$kc"; \
	printf '  decks-api  %s\n' "$$decks"; \
	if [ -f /tmp/altered-dev-environment.pid ]; then printf '  dev env    started by make dev · log /tmp/altered-dev-environment.log (Aspire dashboard link inside)\n'; \
	else printf '  dev env    started outside make dev (./run.sh in altered-dev-environment)\n'; fi; \
	printf '  accounts   alice · bob · carol@example.test   password TestPassword1234\n'; \
	case ",$$mods," in *,22222222-2222-2222-2222-222222222222,*) printf '             bob is a tournament moderator (TOURNAMENT_MODERATORS in .env)\n';; \
	  *) printf '             no tournament moderator: add TOURNAMENT_MODERATORS=22222222-2222-2222-2222-222222222222 to .env for bob\n';; esac; \
	printf '  stop       Ctrl+C stops API + Vite · make db-down · make dev-env-down\n'; \
	printf '─────────────────────────────────────────────────────────────────────────\n\n'

# Starts ../altered-dev-environment (Keycloak + decks-api) unless it already answers, and
# waits for it; detached, so Ctrl+C on make dev leaves it running (see the script).
dev-env: check-node env
	@$(NODE) --env-file=.env scripts/dev-env-up.mjs

dev-env-down: check-node
	@$(NODE) scripts/dev-env-up.mjs --down

check-node:
	@$(NODE) -e 'const [M, m] = process.versions.node.split(".").map(Number), [minM, minm] = "$(NODE_MIN)".split(".").map(Number); \
		if (M < minM || (M === minM && m < minm)) { console.error("Node >= $(NODE_MIN) required, found " + process.version + " — recommended: nvm install $(NODE_VERSION) (.nvmrc)"); process.exit(1) } \
		if (M !== $(NODE_VERSION)) console.warn("Node " + process.version + " (recommended: $(NODE_VERSION), see .nvmrc)")'

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

# The acceptance page needs a third account, carol: created (or completed) in the local
# realm, which forgets her on every Keycloak restart like the client above. Never fails.
keycloak-users: check-node env
	@$(NODE) --env-file=.env scripts/keycloak-dev-users.mjs

db-up:
	@$(COMPOSE) up -d --wait postgres

# Idempotent (IF NOT EXISTS / guarded seed) — safe on every start. Seeds the active
# tournament format (current_format) on a fresh DB; card data itself is fetched live
# from the community sources, nothing else to import.
db-migrate:
	@for f in $(SCHEMAS); do echo "→ applying $$f"; $(PSQL) -f /schemas/$$f || exit 1; done

# One-shot after the lot-1 migration: store the contents of legacy pools (see the script).
# Same env as `make api`, so `make db-freeze-pools DB_PORT=…` hits the overridden DB.
db-freeze-pools: check-node env
	env $(API_ENV) $(NODE) --env-file=.env scripts/freeze-sealed-pools.mjs

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

# Playwright suite (tests/e2e): fresh build, Chromium, throwaway Postgres on 55433 (Docker),
# fake Keycloak / decks-api / cards on 8091, the app on 8090. E2E_KEEP_STACK=1 keeps the DB.
e2e: check-node install
	$(NPM) run build
	$(NPX) playwright install chromium
	$(NPM) run test:e2e

e2e-ui: check-node install
	$(NPM) run build
	$(NPX) playwright install chromium
	$(NPM) run test:e2e:ui

# Stops a stack kept with E2E_KEEP_STACK=1.
e2e-down:
	docker compose -f docker-compose.e2e.yml down -v
