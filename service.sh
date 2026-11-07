#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
POSTGRES_URL="postgresql://sre_agent:sre_agent@localhost:55433/sre_agent"
PROMETHEUS_URL="http://localhost:19092"
PUSHGATEWAY_URL="http://localhost:19093"
SENTRY_URL="http://localhost:19095"
SENTRY_AUTH_TOKEN="sntryu_local_dev"
SENTRY_ORG="acme"
SENTRY_PROJECT="payments"

usage() {
  cat <<'EOF'
Usage: ./service.sh [command]

Commands:
  up        Start PostgreSQL, Prometheus, and Sentry (default)
  test      Start services and load demo data into PostgreSQL, Prometheus, and Sentry
  seed      Load demo data into already-running services
  status    Show container status
  logs      Follow container logs
  psql      Open a psql shell in the PostgreSQL container
  env       Print the .env values for this local stack
  env --write  Write the .env values for this local stack
  down      Stop containers (data volumes are kept)
  reset     Remove containers and volumes, then start fresh with demo data
  help      Show this help

Ports:
  PostgreSQL     localhost:55433
  Prometheus     localhost:19092
  Pushgateway    localhost:19093
  Sentry         http://localhost:19095
EOF
}

print_env() {
  cat <<EOF
# Add these values to .env to use the local dev stack:
POSTGRES_URL=${POSTGRES_URL}
PROMETHEUS_URL=${PROMETHEUS_URL}
ENABLE_POSTGRES=true
ENABLE_PROMETHEUS=true
SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
SENTRY_ORG=${SENTRY_ORG}
SENTRY_PROJECT=${SENTRY_PROJECT}
SENTRY_HOST=${SENTRY_URL}
ENABLE_SENTRY=true
EOF
}

write_env() {
  local env_file="${ROOT_DIR}/.env"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/sre-agent-env.XXXXXX")"

  if [[ ! -f "$env_file" ]]; then
    cp "${ROOT_DIR}/.env.example" "$env_file"
    echo "Created .env from .env.example."
  fi

  grep -vE '^(POSTGRES_URL|PROMETHEUS_URL|ENABLE_POSTGRES|ENABLE_PROMETHEUS|SENTRY_AUTH_TOKEN|SENTRY_ORG|SENTRY_PROJECT|SENTRY_HOST|ENABLE_SENTRY)=' "$env_file" > "$tmp" || true
  cat >> "$tmp" <<EOF

# Local dev stack (updated by ./service.sh env --write)
POSTGRES_URL=${POSTGRES_URL}
PROMETHEUS_URL=${PROMETHEUS_URL}
ENABLE_POSTGRES=true
ENABLE_PROMETHEUS=true
SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
SENTRY_ORG=${SENTRY_ORG}
SENTRY_PROJECT=${SENTRY_PROJECT}
SENTRY_HOST=${SENTRY_URL}
ENABLE_SENTRY=true
EOF

  cat "$tmp" > "$env_file"
  rm -f "$tmp"
  echo "Updated .env with the local dev stack values."
  echo "Sentry now points at the local mock; replace those values with real credentials when needed."
  echo "Restart 'npm run dev' to apply the new environment."
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Error: docker is not installed or not on PATH." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Error: the Docker daemon is not running." >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "Error: Docker Compose v2 is required (docker compose)." >&2
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required to seed and check Prometheus." >&2
    exit 1
  fi
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

wait_for_postgres() {
  printf "Waiting for PostgreSQL"
  for _ in $(seq 1 60); do
    if compose exec -T postgres pg_isready -U sre_agent -d sre_agent >/dev/null 2>&1; then
      echo " ready"
      return 0
    fi
    printf "."
    sleep 1
  done
  echo
  echo "Error: PostgreSQL did not become ready." >&2
  return 1
}

wait_for_url() {
  local name="$1"
  local url="$2"
  printf "Waiting for %s" "$name"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo " ready"
      return 0
    fi
    printf "."
    sleep 1
  done
  echo
  echo "Error: $name did not become ready at $url." >&2
  return 1
}

seed_postgres() {
  wait_for_postgres
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U sre_agent -d sre_agent \
    < seed/postgres/schema.sql >/dev/null
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U sre_agent -d sre_agent \
    < seed/postgres/seed.sql >/dev/null
  echo "Seeded PostgreSQL (customers, orders, payment_attempts)."
}

seed_prometheus() {
  wait_for_url "Pushgateway" "${PUSHGATEWAY_URL}/-/healthy"
  curl -fsS --data-binary @seed/prometheus/metrics.txt \
    "${PUSHGATEWAY_URL}/metrics/job/sre-agent-demo/instance/local" >/dev/null
  echo "Pushed Prometheus demo metrics."
}

seed_sentry() {
  wait_for_url "Sentry" "${SENTRY_URL}/health"
  curl -fsS -X POST -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
    "${SENTRY_URL}/seed" >/dev/null
  echo "Seeded Sentry (acme/payments, PAY-1, PAY-2, CHK-1)."
}

up() {
  compose up -d
  wait_for_postgres
  wait_for_url "Prometheus" "${PROMETHEUS_URL}/-/ready"
  wait_for_url "Pushgateway" "${PUSHGATEWAY_URL}/-/healthy"
  wait_for_url "Sentry" "${SENTRY_URL}/health"
  echo
  echo "PostgreSQL:  ${POSTGRES_URL}"
  echo "Prometheus:  ${PROMETHEUS_URL}"
  echo "Sentry:      ${SENTRY_URL}"
  echo "Run './service.sh env --write' to update .env, then restart 'npm run dev'."
}

seed_all() {
  seed_postgres
  seed_prometheus
  seed_sentry
}

case "${1:-up}" in
  up)
    require_docker
    up
    ;;
  test)
    require_docker
    up
    seed_all
    echo
    echo "Demo data is ready. Paste the sample incident from docs/usage.md into the UI."
    ;;
  seed)
    require_docker
    seed_all
    ;;
  status)
    require_docker
    compose ps
    ;;
  logs)
    require_docker
    shift || true
    compose logs -f --tail=100 "$@"
    ;;
  psql)
    require_docker
    compose exec postgres psql -U sre_agent -d sre_agent
    ;;
  env)
    if [[ "${2:-}" == "--write" ]]; then
      write_env
    else
      print_env
    fi
    ;;
  down)
    require_docker
    compose down
    ;;
  reset)
    require_docker
    compose down -v
    up
    seed_all
    echo
    echo "Reset complete. Demo data is ready."
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
