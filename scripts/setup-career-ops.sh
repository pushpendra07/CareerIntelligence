#!/usr/bin/env bash
# Set up Career-Ops inside this project (career-intelligence/career-ops), git-ignored.
#
#   ./scripts/setup-career-ops.sh                 fresh clone + npm install + starter files
#   ./scripts/setup-career-ops.sh --from DIR      also copy your data from an existing Career-Ops
#   ./scripts/setup-career-ops.sh --update        pull the latest Career-Ops (keeps your data)
#
# Your data (portals.yml, cv.md, config/profile.yml, data/, reports/, jds/, output/) stays only
# on this machine: Career-Ops ignores those files itself and /career-ops/ is ignored here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CO="$ROOT/career-ops"
REPO="https://github.com/career-ops-hq/career-ops.git"
FROM=""
UPDATE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="${2:?--from needs a folder}"; shift 2 ;;
    --update) UPDATE=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
command -v node >/dev/null || { echo "Node.js is required (https://nodejs.org)" >&2; exit 1; }

if [[ ! -d "$CO/.git" ]]; then
  echo "→ Cloning Career-Ops into $CO"
  git clone --depth 1 "$REPO" "$CO"
elif $UPDATE; then
  echo "→ Updating Career-Ops"
  git -C "$CO" pull --ff-only
fi

if [[ -n "$FROM" ]]; then
  echo "→ Copying your Career-Ops data from $FROM"
  for f in portals.yml cv.md voice-dna.md config/profile.yml modes/_profile.md modes/_brief.md modes/_custom.md; do
    [[ -f "$FROM/$f" ]] && mkdir -p "$CO/$(dirname "$f")" && cp -p "$FROM/$f" "$CO/$f"
  done
  for d in data jds reports output batch/tracker-additions/merged; do
    [[ -d "$FROM/$d" ]] && mkdir -p "$CO/$d" && rsync -a --exclude 'cache/' "$FROM/$d/" "$CO/$d/"
  done
fi

# Starter files for a brand-new setup (never overwrites yours).
[[ -f "$CO/portals.yml" ]] || cp "$CO/templates/portals.example.yml" "$CO/portals.yml"
[[ -f "$CO/config/profile.yml" ]] || cp "$CO/config/profile.example.yml" "$CO/config/profile.yml"

echo "→ Installing Career-Ops dependencies"
(cd "$CO" && npm install --no-audit --no-fund)

cat <<MSG

✓ Career-Ops is ready in career-ops/ (version $(cut -d' ' -f1 "$CO/VERSION"))
  • Companies to scan: career-ops/portals.yml   • Your profile: career-ops/config/profile.yml
  • The app finds it automatically (leave CAREER_OPS_PATH empty in backend/.env).
  • To let the app run scans, set CAREER_OPS_SCAN_ENABLED=true in backend/.env, then restart:
      ./stop.sh --keep-db && ./start.sh
MSG
