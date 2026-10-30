#!/bin/sh
# What `make dev` started and how to get in. Printed by `make dev` once the API and Vite
# answer (after their banners), and by `make dev-summary` on demand. Reads .env for the
# service URLs and the moderator list, API_PORT from the environment (make passes it).
API_PORT="${API_PORT:-8080}"
kc="$(sed -n 's/^KEYCLOAK_ISSUER=//p' .env | tail -n 1 | sed 's|/realms/.*||')"
decks="$(sed -n 's/^DECKS_API_URL=//p' .env | tail -n 1)"
mods="$(sed -n 's/^TOURNAMENT_MODERATORS=//p' .env | tail -n 1)"
dash="$(grep -oE 'https?://localhost:[0-9]+/login\?t=[0-9a-f]+' /tmp/altered-dev-environment.log 2>/dev/null | tail -n 1)"

printf '\n────────────────────────────── local stack ──────────────────────────────\n'
printf '  app        http://localhost:5173\n'
printf '  API        http://localhost:%s\n' "$API_PORT"
printf '  Keycloak   %s/admin   (admin / admin, realm players)\n' "$kc"
printf '  decks-api  %s\n' "$decks"
if [ -f /tmp/altered-dev-environment.pid ]; then
  printf '  dev env    started by make dev · log /tmp/altered-dev-environment.log\n'
  [ -n "$dash" ] && printf '  Aspire     %s   (dashboard, optional; the token is in the link)\n' "$dash"
else
  printf '  dev env    started outside make dev (./run.sh in altered-dev-environment)\n'
fi
printf '  accounts   alice · bob · carol@example.test   password TestPassword1234\n'
case ",$mods," in
  *,22222222-2222-2222-2222-222222222222,*) printf '             bob is a tournament moderator (TOURNAMENT_MODERATORS in .env)\n' ;;
  *) printf '             no tournament moderator: add TOURNAMENT_MODERATORS=22222222-2222-2222-2222-222222222222 to .env for bob\n' ;;
esac
printf '  stop       Ctrl+C stops API + Vite · make down stops everything (API, Vite, Postgres, dev env)\n'
printf '─────────────────────────────────────────────────────────────────────────\n\n'
