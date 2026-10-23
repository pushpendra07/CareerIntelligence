#!/usr/bin/env bash
# Start Career Intelligence (./start.sh) and a Cloudflare Quick Tunnel to it, so the app can be
# opened from a phone or another network at a https://….trycloudflare.com address.
#
#   ./start-tunnel.sh             start the app (if not running) + tunnel, open the app in Chrome
#   ./start-tunnel.sh --no-open   same, without opening a browser
#
# Needs cloudflared (brew install cloudflared). The tunnel address changes on every start.
# Log: .run/logs/tunnel.log   PID: .run/tunnel.pid   Stop everything with ./stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN="$ROOT/.run"
LOGS="$RUN/logs"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
mkdir -p "$LOGS"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

running() { [[ -f "$RUN/$1.pid" ]] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

command -v cloudflared >/dev/null || fail "cloudflared is not installed (brew install cloudflared)"
running tunnel && fail "The tunnel is already running. Use ./stop.sh first."

# --- app ----------------------------------------------------------------------------------
if running backend && running frontend; then
  say "Career Intelligence is already running"
else
  "$ROOT/start.sh" "$@"
fi

# The tunnel makes the app reachable from the internet: it should have a login.
if [[ ! -f "$ROOT/backend/secrets/login.json" ]] \
  && ! grep -Eq '^APP_PASSWORD=.+' "$ROOT/backend/.env" 2>/dev/null; then
  warn "No login is set up: anyone with the tunnel address can open your data."
  warn "Set one in Settings -> Login (or APP_PASSWORD in backend/.env) before sharing the link."
fi

# --- tunnel -------------------------------------------------------------------------------
say "Starting Cloudflare tunnel to http://localhost:${FRONTEND_PORT}"
: >"$LOGS/tunnel.log"
nohup cloudflared tunnel --no-autoupdate --url "http://localhost:${FRONTEND_PORT}" \
  >>"$LOGS/tunnel.log" 2>&1 &
echo $! >"$RUN/tunnel.pid"

for _ in $(seq 1 30); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGS/tunnel.log" | head -1 || true)"
  if [[ -n "$URL" ]]; then
    printf '\n\033[1;32mTunnel is up\033[0m\n'
    echo "  Public:   $URL"
    echo "  Local:    http://127.0.0.1:${FRONTEND_PORT}"
    echo "  Log:      $LOGS/tunnel.log"
    echo "  Stop:     ./stop.sh   (stops the tunnel too)"
    exit 0
  fi
  running tunnel || fail "cloudflared exited — see $LOGS/tunnel.log"
  sleep 1
done
fail "Timed out waiting for the tunnel address — see $LOGS/tunnel.log"
