#!/usr/bin/env bash
# Set up AI Job Search inside this project (career-intelligence/ai-job-search), git-ignored.
# https://github.com/ai-job-search-dev/ai-job-search — a Claude Code job-search workflow.
#
#   ./scripts/setup-ai-job-search.sh              fresh clone (+ its portal search tools if Bun is installed)
#   ./scripts/setup-ai-job-search.sh --from DIR   also copy your data from an existing AI Job Search
#   ./scripts/setup-ai-job-search.sh --update     pull the latest AI Job Search (keeps your data)
#
# Its /setup writes your profile into its own files, so this copy holds personal data: it stays
# on this machine (/ai-job-search/ is ignored here). Never push it to a public fork.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AJS="$ROOT/ai-job-search"
REPO="https://github.com/ai-job-search-dev/ai-job-search.git"
FROM=""
UPDATE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="${2:?--from needs a folder}"; shift 2 ;;
    --update) UPDATE=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }

if [[ ! -d "$AJS/.git" ]]; then
  echo "→ Cloning AI Job Search into $AJS"
  git clone --depth 1 "$REPO" "$AJS"
elif $UPDATE; then
  echo "→ Updating AI Job Search"
  git -C "$AJS" pull --ff-only || {
    echo "Couldn't update automatically: your /setup changed files the update also changes." >&2
    echo "Follow SETUP.md section 8 in ai-job-search/ to merge the update by hand." >&2
    exit 1
  }
fi

if [[ -n "$FROM" ]]; then
  echo "→ Copying your AI Job Search data from $FROM"
  for f in CLAUDE.md job_search_tracker.csv; do
    [[ -f "$FROM/$f" ]] && cp -p "$FROM/$f" "$AJS/$f"
  done
  for d in .claude/skills/job-application-assistant job_scraper documents company_research cv cover_letters templates gmail_sync upskill; do
    [[ -d "$FROM/$d" ]] && mkdir -p "$AJS/$d" && rsync -a "$FROM/$d/" "$AJS/$d/"
  done
fi

if command -v bun >/dev/null; then
  echo "→ Installing its job portal search tools (Bun)"
  (cd "$AJS" && python3 tools/install_portal_clis.py) || echo "  (skipped: see ai-job-search/SETUP.md)"
else
  echo "→ Bun not found: its portal search tools (/scrape) need https://bun.sh — the import works without it"
fi

cat <<MSG

✓ AI Job Search is ready in ai-job-search/
  • Use it in Claude Code:  cd ai-job-search && claude   then  /setup, /scrape, /rank, /apply, /outcome
    (those commands use your Claude subscription / API tokens; this app never runs them)
  • The app finds it automatically (leave AI_JOB_SEARCH_PATH empty in backend/.env). Restart once:
      ./stop.sh --keep-db && ./start.sh --no-open
  • Then Settings → Job sources → AI Job Search → Import now (or tick "Import as soon as…").
MSG
