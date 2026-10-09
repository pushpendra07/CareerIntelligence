---
description: Search for jobs for the user and deliver a ranked list of real postings (not just companies)
---

When the user asks to "search jobs", "find jobs" or "get me jobs", the deliverable is a list of
**real job postings** from the app (title, company, score, location, link) — not a list of
companies. Never invent jobs or links; report only what the app returns.

1. Make sure the app is running (`.agent/workflows/run-app.md`).
2. Note the time, then refresh every source:
   a. Built-in scanner (1–3 min): `.agent/workflows/job-scanner.md`.
   b. Google Sheets (if a Google connector is available): `.agent/workflows/import-google-sheets.md`.
   c. Career-Ops (optional, 15–20 min; only if the user wants it or it hasn't run today):
      `.agent/workflows/career-ops-scan.md`.
3. If scores are stale (Dashboard / `GET /api/v1/dashboard` → `summary.stale_scores > 0`):
   `curl -s -X POST http://127.0.0.1:8010/api/v1/matches/reanalyze -H 'Content-Type: application/json' -d '{"only_stale": true}'`
   and wait until `stale_scores` is 0.
4. Get the results:
   - Newest jobs first:
     `curl -s "http://127.0.0.1:8010/api/v1/jobs?closed=false&sort=-created_at&size=50"`
   - Best matches:
     `curl -s "http://127.0.0.1:8010/api/v1/jobs?closed=false&status=NEW&status=DISCOVERED&min_score=70&sort=-match_score&size=50"`
   Useful extra filters: `location`, `work_model=REMOTE`, `technology=magento2`, `tier=TIER_A`,
   `has_application=false`.
5. Report to the user:
   - What ran: scanner (companies scanned, postings checked, new jobs), sheets, Career-Ops.
   - A table of jobs found in this run (created after step 2's time) and the top matches:
     score · recommendation · title · company · location · link (`source_url`) · app link
     `http://127.0.0.1:5173/jobs/<id>`.
   - Jobs with `jd_status` not `OK` have no description: say their score is less reliable.
   - If nothing new turned up, say so plainly and suggest raising coverage
     (`.agent/workflows/add-company-for-scanning.md`).
6. Don't change job statuses, apply, or delete anything unless the user asks.
