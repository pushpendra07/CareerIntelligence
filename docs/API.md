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
- `POST /api/v1/companies/import`
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
- `PATCH /api/v1/jobs/{job_id}`
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

### reports
- `GET /api/v1/reports` — the available reports (`key`, `title`, `description`)
- `GET /api/v1/reports/{name}?from=&to=&group=day|week|month` — one report (default: last 90
  days, group chosen from the range): `kpis` (with `previous` = the period of equal length
  before), `charts` (`kind`: line, bar, stacked, donut, hbar; `series`; `data`) and `table`
  (`columns`, `rows`, max 2000) and `jobs` (the jobs behind the numbers, or null). Names: overview, jobs, applications, interviews, offers,
  companies, sources, followups, skills, scans.

### career-ops
- `GET /api/v1/career-ops/status`
- `POST /api/v1/career-ops/import`
- `POST /api/v1/career-ops/sync`
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
- `POST /api/v1/ai/jobs/{job_id}/interview-questions`
- `POST /api/v1/ai/jobs/{job_id}/summary`
- `GET /api/v1/settings/app`
- `PATCH /api/v1/settings/app`
- `GET /api/v1/settings/system`
- `GET /api/v1/export/all`
- `GET /api/v1/export/{entity}`
- `POST /api/v1/import/google-sheet`
- `POST /api/v1/import/{entity}`

