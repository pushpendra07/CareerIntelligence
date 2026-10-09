#!/usr/bin/env bash
# Stop Career Intelligence (only the processes started by ./start.sh).
#
#   ./stop.sh             stop the web UI, API and the dev PostgreSQL
#   ./stop.sh --keep-db   stop the web UI and API, leave the dev PostgreSQL running
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN="$ROOT/.run"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# Kill a process and its children (uv/npx spawn the real server as a child).
kill_tree() {
  local pid=$1
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

stop_service() {
  local name=$1 pidfile="$RUN/$1.pid"
  if [[ ! -f "$pidfile" ]]; then
    say "$name: not running"
    return
  fi
  local pid
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    say "Stopping $name (pid $pid)"
    kill_tree "$pid"
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  else
    say "$name: already stopped"
  fi
  rm -f "$pidfile"
}

stop_service frontend
stop_service backend

if [[ "${1:-}" != "--keep-db" && -f "$RUN/devdb.started" ]]; then
  say "Stopping dev PostgreSQL"
  (cd "$ROOT/backend" && uv run python scripts/devdb.py --stop >/dev/null 2>&1) || true
  rm -f "$RUN/devdb.started"
fi

say "Career Intelligence stopped"
