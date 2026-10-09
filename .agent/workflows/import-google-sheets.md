---
description: Import the saved Google Sheets (private sheets) through a Google connector
---

The saved sheets are listed at `GET http://127.0.0.1:8010/api/v1/sheets` (Settings → Google Sheets).
Private sheets can't be downloaded by the app, so the agent reads them and sends the rows.

1. Make sure the app is running (`.agent/workflows/run-app.md`).
2. `GET /api/v1/sheets` → note each sheet's `id`, `spreadsheet_id` and `last_result`.
3. For each sheet, use your Google Sheets/Drive connector to list its tabs and read each tab
   (first row = header). Only read rows that are new since `last_result` if the sheet is large
   (compare row counts) — re-sending old rows is safe but slow.
4. POST the rows (header → value objects) to `/api/v1/sheets/{id}/import-rows`:
   `{"tabs": [{"tab": "<tab name>", "rows": [{"Job Title": "...", "Company": "...", ...}]}]}`
   Job tabs and company tabs are detected automatically. Deduplication is done by the app:
   existing jobs are merged, deleted jobs are skipped.
5. Report per tab: read / new / already in the app / errors (from the response's
   `last_result.tabs`). Never edit the Google Sheet itself.
