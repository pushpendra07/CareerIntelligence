#!/usr/bin/env bash
# Stop Career Intelligence (only the processes started by ./start.sh).
#
#   ./stop.sh             stop the web UI, API and the dev PostgreSQL
#   ./stop.sh --keep-db   stop the web UI and API, leave the dev PostgreSQL running
#   ./stop.sh --force     stop even while a job scan is running (the scan is lost)
set -uo pipefail

KEEP_DB=0 FORCE=0
for arg in "$@"; do
  case "$arg" in
    --keep-db) KEEP_DB=1 ;;
    --force) FORCE=1 ;;
    *) echo "Unknown option: $arg (use --keep-db, --force)" >&2; exit 2 ;;
  esac
done

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

# Stopping the API kills a running scan (Career-Ops takes 15-40 minutes): say so first.
running_scans() {
  local port="${BACKEND_PORT:-8010}" out=""
  command -v curl >/dev/null || return 0
  curl -sf -m 3 "http://127.0.0.1:$port/api/v1/career-ops/status" | grep -q '"running": *{' \
    && out="Career-Ops scan"
  curl -sf -m 3 "http://127.0.0.1:$port/api/v1/scanner/status" | grep -q '"running": *{' \
    && out="${out:+$out and }job scanner"
  printf '%s' "$out"
}

if [[ $FORCE -eq 0 && -f "$RUN/backend.pid" ]]; then
  busy="$(running_scans)"
  if [[ -n "$busy" ]]; then
    printf '\033[1;33m!!\033[0m A %s is running; stopping now would lose it.\n' "$busy" >&2
    echo "   Wait for it to finish (Settings shows progress), or run ./stop.sh --force $([[ $KEEP_DB -eq 1 ]] && echo --keep-db)" >&2
    exit 1
  fi
fi

stop_service frontend
stop_service backend

if [[ $KEEP_DB -eq 0 && -f "$RUN/devdb.started" ]]; then
  say "Stopping dev PostgreSQL"
  (cd "$ROOT/backend" && uv run python scripts/devdb.py --stop >/dev/null 2>&1) || true
  rm -f "$RUN/devdb.started"
fi

say "Career Intelligence stopped"
