#!/usr/bin/env bash
# Run Career Intelligence natively (no Docker): dev PostgreSQL + migrations + API + web UI.
#   ./dev.sh            start everything (Ctrl+C stops the API and UI; the DB keeps running)
#   ./dev.sh stop-db    stop the dev PostgreSQL
# Ports: BACKEND_PORT (default 8010), FRONTEND_PORT (default 5173).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8010}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

cd "$ROOT/backend"
if [[ "${1:-}" == "stop-db" ]]; then uv run python scripts/devdb.py --stop; exit 0; fi

uv sync --quiet
if [[ -z "${DATABASE_URL:-}" ]]; then
  export DATABASE_URL="$(uv run python scripts/devdb.py)"
fi
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" --reload &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

cd "$ROOT/frontend"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
echo "Career Intelligence: http://127.0.0.1:${FRONTEND_PORT}  (API docs: http://127.0.0.1:${BACKEND_PORT}/docs)"
VITE_API_TARGET="http://127.0.0.1:${BACKEND_PORT}" npx vite --port "$FRONTEND_PORT" --strictPort
