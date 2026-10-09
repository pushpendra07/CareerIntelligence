---
description: Import jobs and companies from the saved Google Sheets (private sheets) through a Google connector
---

Reference: `docs/google-sheets.md` (sheets, tabs, columns, mappings). The app deduplicates;
you only read the sheets and send rows. Never edit the Google Sheets.

1. Make sure the app is running (`.agent/workflows/run-app.md`).
2. List saved sheets and their last import:
// turbo
   `curl -s http://127.0.0.1:8010/api/v1/sheets | python3 -m json.tool`
   Note each `id`, `spreadsheet_id`, `title`, `last_imported_at`, `last_result.tabs`.
3. For each sheet, with the Google Sheets connector (or Google Drive):
   - Get the tab list (`get_spreadsheet` with fields `sheets.properties.title`).
     A Drive CSV export only returns the **first tab** — use the Sheets connector for multi-tab sheets.
   - Read row 1 (header) of every tab.
   - Find how many rows each tab has now (read column A). Compare with the counts in
     `docs/google-sheets.md` / the last import. For large tabs read only the new rows
     (plus the header); for small tabs read everything.
4. Build the request: each row is an object `{header: value}`; pad short rows with "".
   ```json
   {"tabs": [
     {"tab": "Job Tracker", "rows": [{"Job Title": "...", "Company": "...", "Application Link": "..."}]},
     {"tab": "Target Companies", "rows": [{"Company Name": "...", "Careers URL": "..."}]}
   ]}
   ```
   Save it to a temp file and POST it (avoid shell-quoting problems):
   `curl -s -X POST http://127.0.0.1:8010/api/v1/sheets/<id>/import-rows -H 'Content-Type: application/json' --data @/tmp/rows.json | python3 -m json.tool`
   Jobs vs companies is detected per tab automatically.
5. Read `last_result.tabs` in the response and report per tab: read · new (`created`) ·
   already in the app (`merged`) · deleted & skipped (`deleted_skipped`) · errors.
6. New jobs are scored automatically. Show the new jobs (title · company · score · link):
   `curl -s "http://127.0.0.1:8010/api/v1/jobs?closed=false&sort=-created_at&size=30"`
7. Companies imported from `Target Companies` are **not** scannable yet (Google-search links).
   If the user wants them searched, continue with `.agent/workflows/add-company-for-scanning.md`.
8. Update the row counts in `docs/google-sheets.md` if they changed.
