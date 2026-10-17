#!/usr/bin/env bash
# Install and start Career Intelligence with one command.
#
#   ./install.sh            Docker if it is installed (recommended), else the native setup
#   ./install.sh --docker   Docker: app + PostgreSQL containers, http://127.0.0.1:8010
#   ./install.sh --native   No Docker: needs uv and Node.js 20+, runs ./start.sh
#
# Safe to run again: it keeps your .env and your data, and updates the app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }
open_app() {
  open "$1" 2>/dev/null || xdg-open "$1" >/dev/null 2>&1 || true
}

mode="${1:-auto}"
if [[ "$mode" == "auto" ]]; then
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then mode="--docker"; else mode="--native"; fi
fi

case "$mode" in
  --docker)
    command -v docker >/dev/null || fail "Docker is not installed (https://docs.docker.com/get-docker/)"
    docker info >/dev/null 2>&1 || fail "Docker is installed but not running — start Docker Desktop and try again"
    docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is needed (docker compose …)"
    if [[ ! -f .env ]]; then
      cp .env.example .env
      # A random database password; the database is only reachable from the app container.
      password="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
      sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${password}/" .env && rm -f .env.bak
      chmod 600 .env
      say "Created .env (edit it for a login password, AI provider, port…)"
    fi
    say "Building and starting (the first time takes a few minutes)"
    docker compose up -d --build
    port="$(grep -E '^APP_PORT=' .env | cut -d= -f2 || true)"
    url="http://127.0.0.1:${port:-8010}"
    say "Waiting for the app"
    for _ in $(seq 1 90); do
      if curl -fs "$url/api/v1/health" >/dev/null 2>&1; then
        printf '\n\033[1;32mCareer Intelligence is running\033[0m at %s\n' "$url"
        echo "  Stop:    docker compose down        (your data is kept)"
        echo "  Update:  git pull && ./install.sh"
        echo "  Logs:    docker compose logs -f app"
        open_app "$url"
        exit 0
      fi
      sleep 2
    done
    fail "The app did not come up — see: docker compose logs app"
    ;;
  --native)
    command -v uv >/dev/null || fail "uv is not installed: curl -LsSf https://astral.sh/uv/install.sh | sh"
    command -v node >/dev/null || fail "Node.js 20+ is not installed (https://nodejs.org)"
    major="$(node -p 'process.versions.node.split(".")[0]')"
    (( major >= 20 )) || fail "Node.js 20 or newer is needed (found $(node -v))"
    say "Installing (first run takes a few minutes)"
    (cd backend && uv sync --quiet)
    (cd frontend && npm ci --no-audit --no-fund --silent)
    exec ./start.sh
    ;;
  *)
    fail "Unknown option '$mode'. Use --docker or --native."
    ;;
esac
