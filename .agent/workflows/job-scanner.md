---
description: Run the built-in job-board scanner and report what it found
---

1. Make sure the app is running (`.agent/workflows/run-app.md`).
2. See coverage and the last run:
// turbo
   `curl -s http://127.0.0.1:8010/api/v1/scanner/status | python3 -m json.tool | head -40`
3. Optional — find boards for companies that only have a careers page (background):
   `curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/detect-boards -H 'Content-Type: application/json' -d '{}'`
4. Start a scan (background, 1–3 minutes):
   `curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/run -H 'Content-Type: application/json' -d '{}'`
5. Wait until `running` is null in the status, then read the run:
// turbo
   `curl -s "http://127.0.0.1:8010/api/v1/scanner/runs?limit=1" | python3 -m json.tool`
6. Report new / updated jobs, postings checked, companies scanned, and board errors.
   Filters live in Settings → Job scanner → What to keep (app setting `scanner`).
