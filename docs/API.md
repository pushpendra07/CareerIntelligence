# API reference

Base URL: `/api/v1`. Interactive docs with request/response schemas: `http://127.0.0.1:<backend-port>/docs` (OpenAPI JSON at `/openapi.json`).

Conventions:

- Errors: `{"error": {"code", "message", "details"}}` (422 `validation_error` details list the failing fields).
- Lists: `?page=&size=` (max 200) → `{items, total, page, size}`.
- Every response carries an `X-Request-ID` header (also accepted on requests).

## Endpoints (104, generated from the OpenAPI schema)

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
- `GET /api/v1/jobs`
- `GET /api/v1/jobs/{job_id}`
- `PATCH /api/v1/jobs/{job_id}`
- `POST /api/v1/jobs/{job_id}/status`
- `POST /api/v1/jobs/{job_id}/sources`
- `POST /api/v1/jobs/{job_id}/merge`
- `POST /api/v1/jobs/{job_id}/reparse`
- `POST /api/v1/matches/jobs/{job_id}`
- `GET /api/v1/matches/jobs/{job_id}/history`
- `POST /api/v1/matches/reanalyze`
- `GET /api/v1/settings/scoring`
- `PUT /api/v1/settings/scoring`
- `GET /api/v1/settings/scoring/history`

### applications
- `POST /api/v1/applications`
- `GET /api/v1/applications`
- `GET /api/v1/applications/{application_id}`
- `PATCH /api/v1/applications/{application_id}`
- `POST /api/v1/applications/{application_id}/status`
- `POST /api/v1/applications/{application_id}/notes`
- `GET /api/v1/followups`
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

