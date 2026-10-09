---
description: Set the app up from scratch for a new user (CV, profile, preferences, first jobs)
---

Guide the user through `docs/USER_GUIDE.md` sections 1–7. The user does the personal parts in
the browser; never invent profile data.

1. Start the app (`.agent/workflows/run-app.md`) and open http://127.0.0.1:5173.
2. Ask the user to upload their CV in **CVs** (PDF/DOCX/TXT/MD with selectable text, ≤10 MB)
   and click **Replace profile from CV** (fresh start). Check it parsed:
// turbo
   `curl -s http://127.0.0.1:8010/api/v1/profile | python3 -m json.tool | head -40`
3. Ask the user to review **Profile** (years, core skills) and fill **Target Profile**: target
   titles, required skills, locations, work model, min/max experience, notice period and
   **salary targets**. Don't fill these from guesses — confirm with the user.
4. Companies: add the companies they want (`.agent/workflows/add-company-for-scanning.md`),
   or import a company sheet (`docs/google-sheets.md`).
5. Job scanner: confirm the filters in Settings → Job scanner → What to keep match the target
   profile; suggest a 24-hour schedule.
6. Get jobs: `.agent/workflows/find-jobs.md` (scan, sheets, optional Career-Ops), re-analyze
   stale scores, and show the top matches.
7. Point the user to the Dashboard and the daily routine (`docs/USER_GUIDE.md` §14).
