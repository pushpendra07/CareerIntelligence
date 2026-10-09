#!/usr/bin/env bash
# Start Career Intelligence in the background: dev PostgreSQL, migrations, API and web UI.
#
#   ./start.sh             start and open the app in Google Chrome
#   ./start.sh --no-open   start without opening a browser
#
# Ports: BACKEND_PORT (default 8010), FRONTEND_PORT (default 5173).
# Database: uses the bundled dev PostgreSQL unless DATABASE_URL is exported.
# Logs: .run/logs/{backend,frontend}.log   PIDs: .run/*.pid   Stop with ./stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN="$ROOT/.run"
LOGS="$RUN/logs"
BACKEND_PORT="${BACKEND_PORT:-8010}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
mkdir -p "$LOGS"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

running() { [[ -f "$RUN/$1.pid" ]] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

command -v uv >/dev/null || fail "uv is not installed (https://docs.astral.sh/uv/)"
command -v node >/dev/null || fail "Node.js is not installed"

if running backend || running frontend; then
  fail "Career Intelligence is already running. Use ./stop.sh first."
fi
for p in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  port_busy "$p" && fail "Port $p is already in use by another program. Set BACKEND_PORT/FRONTEND_PORT to free ports."
done

# --- backend ------------------------------------------------------------------------------
cd "$ROOT/backend"
if [[ ! -f .env && -f "$ROOT/.env.example" ]]; then
  cp "$ROOT/.env.example" .env
  say "Created backend/.env from .env.example (edit it to change settings)"
fi
say "Installing backend dependencies (first run only takes a while)"
uv sync --quiet

if [[ -z "${DATABASE_URL:-}" ]]; then
  say "Starting dev PostgreSQL"
  DATABASE_URL="$(uv run python scripts/devdb.py)"
  export DATABASE_URL
  touch "$RUN/devdb.started"
fi

say "Applying database migrations"
uv run alembic upgrade head >>"$LOGS/backend.log" 2>&1 || fail "Migrations failed — see $LOGS/backend.log"

say "Starting API on http://127.0.0.1:${BACKEND_PORT}"
nohup uv run uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" \
  >>"$LOGS/backend.log" 2>&1 &
echo $! >"$RUN/backend.pid"

# --- frontend -----------------------------------------------------------------------------
cd "$ROOT/frontend"
if [[ ! -d node_modules ]]; then
  say "Installing frontend dependencies"
  npm ci --no-audit --no-fund >>"$LOGS/frontend.log" 2>&1
fi
say "Starting web UI on http://127.0.0.1:${FRONTEND_PORT}"
VITE_API_TARGET="http://127.0.0.1:${BACKEND_PORT}" nohup npx vite --host 127.0.0.1 \
  --port "$FRONTEND_PORT" --strictPort >>"$LOGS/frontend.log" 2>&1 &
echo $! >"$RUN/frontend.pid"

# --- wait until healthy -------------------------------------------------------------------
say "Waiting for the app to come up"
for _ in $(seq 1 60); do
  if curl -fs "http://127.0.0.1:${FRONTEND_PORT}/api/v1/health" >/dev/null 2>&1; then
    printf '\n\033[1;32mCareer Intelligence is running\033[0m\n'
    echo "  App:      http://127.0.0.1:${FRONTEND_PORT}"
    echo "  API docs: http://127.0.0.1:${BACKEND_PORT}/docs"
    echo "  Logs:     $LOGS"
    echo "  Stop:     ./stop.sh"
    if [[ "${1:-}" != "--no-open" ]]; then
      URL="http://127.0.0.1:${FRONTEND_PORT}"
      open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL" 2>/dev/null || true
    fi
    exit 0
  fi
  if ! running backend; then fail "API exited — see $LOGS/backend.log"; fi
  if ! running frontend; then fail "Web UI exited — see $LOGS/frontend.log"; fi
  sleep 1
done
fail "Timed out waiting for the app — see logs in $LOGS"
