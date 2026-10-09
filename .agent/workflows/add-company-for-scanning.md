---
description: Add (or fix) a company so the job scanner actually searches its jobs, then scan it
---

Goal: the company ends up **scannable** and its jobs are in the app. Adding a company that the
scanner can't read is not success — say so and offer alternatives.

1. Make sure the app is running (`.agent/workflows/run-app.md`).
2. Check whether it already exists:
   `curl -s "http://127.0.0.1:8010/api/v1/companies?q=<name>" | python3 -m json.tool | head -40`
3. Find the company's **job board**: open its careers page and look for links to Greenhouse,
   Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee, Pinpoint or Teamtailor
   (URL patterns: `docs/scan-coverage.md` → Supported job boards). Use the official careers page
   or the board itself — never a Google search URL, never a guessed slug.
4. Verify the board returns jobs **before saving** (public API, no key), e.g.
   `curl -s https://boards-api.greenhouse.io/v1/boards/<slug>/jobs | python3 -c "import json,sys; print(len(json.load(sys.stdin)['jobs']))"`
   (other boards: see the API column in `docs/scan-coverage.md`). 404 or HTML = wrong slug.
5. Save it with job search on (the careers URL is the **board URL**):
   - New company:
     `curl -s -X POST http://127.0.0.1:8010/api/v1/companies -H 'Content-Type: application/json' -d '{"name":"<Name>","careers_url":"<board URL>","job_search_enabled":true,"source_url":"<page where you found the board>"}'`
   - Existing company (id from step 2):
     `curl -s -X PATCH http://127.0.0.1:8010/api/v1/companies/<id> -H 'Content-Type: application/json' -d '{"careers_url":"<board URL>","job_search_enabled":true,"source_url":"<page where you found the board>"}'`
   Optional: `"tier": "TIER_A" | "TIER_B" | "TIER_C"` if the user said how much they want it.
6. Confirm the scanner sees the board:
// turbo
   `curl -s http://127.0.0.1:8010/api/v1/scanner/companies/<id>/board`  → must not be `null`.
   If `null`, the URL isn't a supported board; try **Find job boards** for that company:
   `curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/detect-boards -H 'Content-Type: application/json' -d '{"company_ids":[<id>],"wait":true}'`
7. Scan it now and report the jobs:
   `curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/companies/<id>/scan | python3 -m json.tool`
   Then list its jobs: `curl -s "http://127.0.0.1:8010/api/v1/jobs?company_id=<id>&closed=false&sort=-match_score" | python3 -m json.tool`
8. Report: company, board, postings found, relevant kept, new jobs (title · score · link).
   0 relevant jobs is a valid result — say so; don't loosen filters without asking.
9. If the company uses an unsupported system (SuccessFactors, Oracle, iCIMS, Taleo, Zoho, custom
   site): still save it with `job_search_enabled: true` and its real careers URL, tell the user it
   can't be scanned automatically, and suggest Google Sheets or Add Job for its postings.
10. Update `docs/scan-coverage.md` (add the row) when the coverage changes.

Many companies at once: repeat steps 3–6 per company, then run one full scan
(`.agent/workflows/job-scanner.md`) instead of scanning each.
