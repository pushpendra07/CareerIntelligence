# API reference

Base URL: `/api/v1`. Interactive docs with request/response schemas: `http://127.0.0.1:<backend-port>/docs` (OpenAPI JSON at `/openapi.json`).

Conventions:

- Errors: `{"error": {"code", "message", "details"}}` (422 `validation_error` details list the failing fields).
- Lists: `?page=&size=` (max 200) → `{items, total, page, size}`.
- Every response carries an `X-Request-ID` header (also accepted on requests).

## Endpoints (116, generated from the OpenAPI schema)

### health
- `GET /api/v1/health`
- `GET /api/v1/health/ready`

### dashboard
- `GET /api/v1/dashboard`
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/dashboard/charts`
- `GET /api/v1/dashboard/funnels`
- `GET /api/v1/dashboard/priorities`
- `GET /api/v1/dashboard/analytics`
- `GET /api/v1/search`

### cvs
- `POST /api/v1/cvs`
- `GET /api/v1/cvs`
- `GET /api/v1/cvs/compare`
- `GET /api/v1/cvs/{cv_id}`
- `PATCH /api/v1/cvs/{cv_id}`
- `POST /api/v1/cvs/{cv_id}/activate`
- `POST /api/v1/cvs/{cv_id}/versions`
- `GET /api/v1/cvs/{cv_id}/versions/{version_id}`
- `POST /api/v1/cvs/{cv_id}/versions/{version_id}/reparse`
- `GET /api/v1/cvs/{cv_id}/versions/{version_id}/file`

### profile
- `GET /api/v1/profile`
- `PATCH /api/v1/profile`
- `POST /api/v1/profile/import-cv`
- `GET /api/v1/preferences`
- `PATCH /api/v1/preferences`

### companies
- `GET /api/v1/companies`
- `POST /api/v1/companies`
- `GET /api/v1/companies/stats`
- `GET /api/v1/companies/export`
- `POST /api/v1/companies/import` — CSV/JSON of companies (also a Naukri company-list export).
  Matches existing companies by extra link, website domain, then name (names differing only in
  *different* generic words — "Aspire Software Solutions" / "Aspire Systems" — stay separate).
  Columns `extra_link`, `naukri_url`, `foundit_url`, `monster_url` add job-portal company pages.
- Companies have `extra_links` (`[{portal, url, source, added_at}]`: Naukri, LinkedIn, Monster,
  Foundit…) and `created_at`; `PATCH /companies/{id}` with `{"extra_links": [urls]}` replaces the
  list. `GET /companies?sort=-created_at` lists the newest first.
- `GET /api/v1/companies` also filters by `portal` (`naukri`, … or `any`), `industry` (contains),
  `company_size` (`1-50`, `51-200`, `201-1000`, `1001-5000`, `5001+`) and sorts by `-rating`
  (portal rating weighted by its number of reviews). Rows include `rating` and `rating_reviews`.
- `GET /api/v1/companies/facets` — industries, company sizes and portals in use, with counts.
- `GET /api/v1/companies/duplicates` — groups of companies that may be one (similar name or same
  website); `POST /api/v1/companies/duplicates/dismiss {"company_ids": [...]}` stops suggesting a group.
- `POST /api/v1/companies/bulk {"company_ids", "action": "job_search_on"|"job_search_off"|"tier"|"delete", "tier"?}`
  — delete skips companies that jobs, recruiters or applications point at.
- `GET /api/v1/companies/{company_id}`
- `PATCH /api/v1/companies/{company_id}`
- `POST /api/v1/companies/{company_id}/evidence`
- `POST /api/v1/companies/{company_id}/check`
- `POST /api/v1/companies/{company_id}/merge`
- `GET /api/v1/recruiters`
- `POST /api/v1/recruiters`
- `GET /api/v1/recruiters/{contact_id}`
- `PATCH /api/v1/recruiters/{contact_id}`

### jobs
- `POST /api/v1/jobs/preview`
- `POST /api/v1/jobs`
- `GET /api/v1/jobs` (`q` also matches a job ID: `#123` or `123`)
- `GET /api/v1/jobs/{job_id}`
- `PATCH /api/v1/jobs/{job_id}` — any of the editable fields; `url` sets the posting's link
  (kept as a source too; 422 for a search/listing page or a link that belongs to another job;
  `""` clears it)
- `GET /api/v1/jobs/status-counts` (jobs per status for the same filters as `GET /jobs`)
- `GET /api/v1/jobs/fetch-descriptions` — open jobs still missing a description, and the latest run
- `POST /api/v1/jobs/fetch-descriptions` `{"limit": 40, "min_score": 0}` — read missing
  descriptions from each job's link in the background, best scores first (one run at a time)
- `DELETE /api/v1/jobs/{job_id}` (`?force=true` also deletes its applications/interviews/offers; otherwise 409 with counts)
- `POST /api/v1/jobs/{job_id}/status` — setting Applied (or a later stage) on a job without an
  application records one automatically (`origin: "auto"`, no follow-up planned)
- `POST /api/v1/jobs/bulk` `{"job_ids": [..], "action": "status", "status": "NOT_RELEVANT"}` or
  `{"job_ids": [..], "action": "delete"}` — up to 500 jobs; delete skips jobs with
  applications/interviews/offers and lists them in `skipped`
- `POST /api/v1/jobs/{job_id}/cv-check` (multipart `file`: DOCX, PDF, TXT, MD) — ATS score of the
  CV for this job: `{format, can_edit, builds_copy, report, suggested[]}` (`builds_copy`: a
  PDF/TXT CV is tailored as a plain Word copy); `report` = `{score, parts{required,
  preferred, title, experience: {earned, max}}, keywords[{skill, importance, status: found |
  implied | related | missing, via}], title_words_missing[], experience_required,
  experience_found, notes[]}`; `suggested` = implied skills (safe to add). 422 if the job has no
  skills. The CV is not saved.
- `POST /api/v1/jobs/{job_id}/cv-tailor` (multipart `file` DOCX, PDF, TXT or MD, `add` repeated = skills to add,
  only the job's own skills are accepted, `use_title` bool) — a copy of the DOCX in the same format
  (only text inside existing runs changes) with the skills added and the job's skills first:
  `{before, after, added[], not_added[], reordered_lines, headline, notes[], filename,
  content_base64}`. A PDF/TXT/MD CV is first rebuilt as a plain Word copy from its text (the
  first note says so). Nothing is saved.
- `GET /api/v1/jobs/{job_id}/email-draft` — an email to HR for this job, built without AI from
  the job, the current match (exact skill matches, shared domains) and your profile (current
  role, the project highlight most relevant to the job's skills, a certification the job asks
  for, leadership for lead roles, notice period, location):
  `{to, to_options[], subjects[], body, short, company, company_domain, facts_used}`; `short` is
  a LinkedIn / InMail version. `to` is the job's
  recruiter or a company contact with an email, else null. Nothing is saved or sent.
- `POST /api/v1/jobs/{job_id}/check-posting` — ask the posting's own site whether the job is
  still open (Greenhouse, Lever, SmartRecruiters, Workday, Ashby APIs; other pages: 404/410,
  redirect to a job list, expired `validThrough`, "no longer accepting" notices). Saves
  `posting_check` `{state: OPEN|CLOSED|LIKELY_CLOSED|UNKNOWN, reason, url, valid_through,
  checked_at}` on the job and returns it; the job's status is not changed. LinkedIn, Indeed,
  Glassdoor and Naukri are never fetched (state UNKNOWN). 422 if the job has no link.
- `POST /api/v1/jobs/{job_id}/sources`
- `POST /api/v1/jobs/{job_id}/merge`
- `GET /api/v1/jobs/status-usage` — how often each job status was set (by hand, in bulk or by Apply), most used first: `{"CLOSED": 86, "NOT_RELEVANT": 76, ...}`; the status pickers show the top 5 as "Most used"
- `GET /api/v1/jobs/duplicates` — jobs saved more than once, by the import rules: `{groups: [[JobOut…]], extra_jobs}`; the first job of a group is the one kept (furthest status)
- `POST /api/v1/jobs/agent-import` (`{"jobs": [{title, company, url, location, workplace, experience, salary, posted, description, portal, notes}…], "dry_run"?: bool}`) — jobs an AI assistant found on job portals (Jobs → AI search); each row goes through the normal duplicate checks. Returns `counts` and per-row `result`: `new` · `duplicate` (with `job_id`, `matched_by`) · `repeat` (same as an earlier row) · `deleted` (you deleted it; not re-added) · `invalid`. Max 200 rows
- `GET /api/v1/extension.zip?app=<UI origin>` — the Job collector Chrome extension (`browser-extension/`) as a zip, with its default API/app addresses set to this app (Settings → Job sources → Chrome extension)
- `POST /api/v1/jobs/duplicates/merge` (`{"keep_ids"?: [id…]}`) — merge every group (or only those led by `keep_ids`): links, cities, notes, applications, interviews move to the kept job
- `POST /api/v1/jobs/{job_id}/comments` (`{"body"}`) — add a dated comment; `GET /jobs/{id}` returns `comments`, newest first
- `DELETE /api/v1/jobs/{job_id}/comments/{comment_id}`
- `POST /api/v1/jobs/{job_id}/reparse`
- `POST /api/v1/matches/jobs/{job_id}`
- `GET /api/v1/matches/jobs/{job_id}/history`
- `POST /api/v1/matches/reanalyze`
- `GET /api/v1/settings/scoring`
- `PUT /api/v1/settings/scoring`
- `GET /api/v1/settings/scoring/history`

### applications
- `POST /api/v1/applications` — `applied_on` is optional (default today; 422 if in the future);
  the first follow-up is due 7 days after it
- `GET /api/v1/applications`
- `GET /api/v1/applications/{application_id}`
- `PATCH /api/v1/applications/{application_id}` — `applied_on` can be changed (not to empty or
  a future date)
- `POST /api/v1/applications/{application_id}/status`
- `POST /api/v1/applications/{application_id}/notes`
- `GET /api/v1/followups` — filters: `completed`, `due_before`, `kind`, `application_id`, `job_id`; each item has `job_title`, `job_status`, `job_url`
- `POST /api/v1/followups`
- `PATCH /api/v1/followups/{followup_id}`
- `POST /api/v1/followups/{followup_id}/complete`

### interviews
- `POST /api/v1/interviews`
- `GET /api/v1/interviews`
- `GET /api/v1/interviews/{interview_id}`
- `PATCH /api/v1/interviews/{interview_id}`
- `POST /api/v1/interviews/{interview_id}/complete`
- `GET /api/v1/interviews/{interview_id}/prep`
- `GET /api/v1/jobs/{job_id}/prep`
- `GET /api/v1/questions`
- `POST /api/v1/questions`
- `GET /api/v1/questions/{question_id}`
- `PATCH /api/v1/questions/{question_id}`
- `POST /api/v1/questions/{question_id}/practice`

### offers
- `POST /api/v1/offers`
- `GET /api/v1/offers`
- `GET /api/v1/offers/compare`
- `GET /api/v1/offers/{offer_id}`
- `PATCH /api/v1/offers/{offer_id}`
- `POST /api/v1/offers/{offer_id}/negotiate`
- `POST /api/v1/offers/{offer_id}/decision`

### recruiters (additions)
- `POST /api/v1/recruiters/find-in-jobs` — save emails / phones / LinkedIn profiles written in
  jobs' notes, comments and descriptions as recruiters linked to the job →
  `{jobs_checked, jobs_with_new_contacts, created, updated, linked}`. Recruiters now have
  `phone` and `jobs` (`[{id, title, status}]`).

### backups & login
- `GET /api/v1/backups` — settings, folder, pg_dump available, last / next, backups (newest
  first). `POST /api/v1/backups` — back up now. `GET /api/v1/backups/{name}` — download a zip.
  Schedule: `PATCH /api/v1/settings/app {"backups": {"enabled", "every_hours", "keep"}}`.
- `GET /api/v1/auth/status` → `{required, authenticated}`; `POST /api/v1/auth/login
  {"password"}` sets the session cookie; `POST /api/v1/auth/logout`. With `APP_PASSWORD` set,
  every other endpoint (except `/health`) answers 401 until logged in.

### setup (first run)
- `GET /api/v1/setup` → `{needs_setup, completed_at, steps: {cv, targets, companies, jobs},
  counts}`. `needs_setup` is true for a fresh install (no CVs, no jobs, setup not finished);
  the UI then opens `/welcome`.
- `POST /api/v1/setup/companies {"companies": [{"url", "name"?}]}` — save each careers page /
  job board as a company with Job search on; per URL: `company_id, name, created, board` (null =
  not scannable yet) or `error`. At most 50.
- `POST /api/v1/setup/complete` — setup finished (or skipped); it doesn't open again.

### scheduled reminders
- `GET /api/v1/reminder-rules` → `{desktop, desktop_available, rules: [{id, kind (check_portals |
  apply | follow_up | custom), enabled, label, cron, portals, message, only_when_needed, schedule,
  next_run}]}`. `PUT /api/v1/reminder-rules` saves `{desktop, rules}` (cron: 5 fields, local time;
  invalid → 422). `POST /api/v1/reminder-rules/{id}/test` fires one now.
- `GET /api/v1/reminder-events?after=&limit=` — reminders that fired (newest first). The API checks
  the schedules every 30 s (`services/reminder_service.py`).

### goals & reminders
- `GET /api/v1/goals/week` — this week's goals (Mon–Sun): per goal `target, done, left,
  per_day, last_week, approximate`; `days_left`, `streak`, `all_met`. Targets:
  `PATCH /api/v1/settings/app {"goals": {"applications", "reviewed", "followups", "outreach"}}`
  (0–500, 0 = off).
- `GET /api/v1/reminders` — follow-ups due today or late, interviews in the next 24 hours, the best
  new jobs (`new_jobs`) and shortlisted jobs not applied to (`apply_pending`); each with job,
  company, location, score and `applied` / `applied_on` / `application_status`.

### reports
- `GET /api/v1/reports` — the available reports (`key`, `title`, `description`)
- `GET /api/v1/reports/{name}?from=&to=&group=day|week|month` — one report (default: last 90
  days, group chosen from the range): `kpis` (with `previous` = the period of equal length
  before), `charts` (`kind`: line, bar, stacked, donut, hbar; `series`; `data`) and `table`
  (`columns`, `rows`, max 2000) and `jobs` (the jobs behind the numbers, or null). Names: overview, jobs, applications, interviews, offers,
  companies, sources, followups, skills, scans.

### career-ops
- `GET /api/v1/career-ops/status` — includes `automation` (`schedule_hours`, `auto_import`, `next_scan_at`); change it with `PATCH /api/v1/settings/app {"career_ops": {"schedule_hours": 24, "auto_import": true}}`
- `POST /api/v1/career-ops/import`
- `POST /api/v1/career-ops/sync`
- `GET /api/v1/career-ops/portals` — what Career-Ops scans (its `portals.yml`, read-only): companies, titles to keep/skip, locations, max age
- `GET /api/v1/career-ops/imports`
- `POST /api/v1/career-ops/jobs/{job_id}/fetch-jd`

### scanner
- `GET /api/v1/scanner/status`
- `POST /api/v1/scanner/run` (`{"company_ids"?: [..], "wait"?: bool}`; runs in the background unless `wait`)
- `POST /api/v1/scanner/detect-boards`
- `POST /api/v1/scanner/companies/{company_id}/scan`
- `GET /api/v1/scanner/companies/{company_id}/board`
- `GET /api/v1/scanner/runs`
- `GET /api/v1/scanner/runs/{run_id}`

### sheets
- `GET /api/v1/sheets`
- `POST /api/v1/sheets` (`{"url", "title"?}`)
- `GET /api/v1/sheets/{sheet_id}/check` — can Import read it now? `{readable: true|false|null,
  via: "link"|"service_account", reason: "private"|"not_found"|"error"|null, message}`. Import of
  a private sheet returns 409 with `details.reason = "private"`.
- `DELETE /api/v1/sheets/{sheet_id}`
- `GET /api/v1/sheets/access` (service-account email to share private sheets with)
- `POST /api/v1/sheets/{sheet_id}/import` (all tabs via service account, or public CSV; 409 with a hint)
- `POST /api/v1/sheets/{sheet_id}/import-rows` (`{"tabs": [{"tab", "rows": [{...}]}]}`)

### cv-advice
- `GET /api/v1/cv-advice` (skills to add to the CV; skills you lack — from open jobs' match results)
- `POST /api/v1/cv-advice/skills/{action}` (`add-to-profile` | `add-to-search` | `hide` | `unhide`, body `{"skill"}`)

### system
- `GET /api/v1/ai/status`
- `GET /api/v1/chat/status` — `{mode: "ai"|"commands", provider, model}`
- `POST /api/v1/chat` (`{"messages": [{"role": "user"|"assistant", "content"}…]}`, last 16 used) — the Assistant: `{reply (Markdown), cards: [{type: jobs|list|counts…}], actions: [{id, kind, label, method, path, body, open_url?}], mode, note?}`. Actions are changes the user confirms; the UI then calls `path` with `body`. Nothing is changed by this endpoint
- `POST /api/v1/ai/jobs/{job_id}/interview-questions`
- `POST /api/v1/ai/jobs/{job_id}/summary`
- `GET /api/v1/settings/app`
- `PATCH /api/v1/settings/app`
- `GET /api/v1/settings/system`
- `GET /api/v1/export/all`
- `GET /api/v1/export/{entity}`
- `POST /api/v1/import/google-sheet`
- `POST /api/v1/import/{entity}`

