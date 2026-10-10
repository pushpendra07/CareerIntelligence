---
description: Run a Career-Ops scan and import its jobs (no AI, no token cost)
---

1. Make sure the app is running (`.agent/workflows/run-app.md`).
2. Check the integration:
// turbo
   `curl -s http://127.0.0.1:8010/api/v1/career-ops/status | python3 -m json.tool`
   Expect `configured: true`, `scan_enabled: true`, `node_available: true`, `data_root` = the
   Career-Ops folder (`career-intelligence/career-ops`), and `running: null`. If
   `configured` is false, run `./scripts/setup-career-ops.sh` and restart (AGENTS.md → Career-Ops → Setup).
3. Start the scan (runs in the background, ~15–20 min, max 45 min):
   `curl -s -X POST http://127.0.0.1:8010/api/v1/career-ops/sync`
4. Poll every minute until `running` is null:
// turbo
   `curl -s http://127.0.0.1:8010/api/v1/career-ops/status | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['running'], d['last_import'])"`
   Do not restart or stop the app while it runs.
5. Report from `last_import`: status, new (`created`), updated (`merged`), records read,
   and any `errors` (e.g. a timed-out portal). New jobs are in Jobs → Source → Career Ops.
6. Quick import only (no scan, seconds): `curl -s -X POST http://127.0.0.1:8010/api/v1/career-ops/import`.
   Never edit files in the Career-Ops folder.
