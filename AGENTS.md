# AGENTS.md — Career Intelligence

Guide for AI coding agents (Antigravity, Claude Code, Codex, Cursor…) working in this repo.
Read this first, then `docs/ARCHITECTURE.md` for depth. Short, always-on rules live in
`.agent/rules/`; step-by-step procedures live in `.agent/workflows/`.

## What this app is

A self-hosted career command center for one person's job search:

```
CV ─▶ Professional Profile ─▶ Target Profile
                                   │
  Built-in job scanner · Add Job (URL + JD) · CSV/JSON · Google Sheets · Career-Ops import
                                   │
          ingest_job: normalize ─▶ deduplicate ─▶ parse JD ─▶ 0–100 match score
                                   │
   Jobs (open / closed tabs) ─▶ Apply ─▶ Interviews ─▶ Offers ─▶ Dashboard & Analytics
```

Everything runs locally (no Docker needed): FastAPI + PostgreSQL backend, React web UI.

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12 (uv), FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL 16 |
| Dev DB | `pgserver` (embedded PostgreSQL), data in `backend/.devdb/` — started by the scripts |
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS v4, React Router (lazy routes), TanStack Query, React Hook Form + Zod |
| Tests | pytest (real PostgreSQL, rolled-back transactions), Vitest + Testing Library |

## Run it

```bash
./start.sh            # dev DB + migrations + API (8010) + UI (5173), opens Chrome
./start.sh --no-open  # same, no browser
./stop.sh             # stop API, UI and dev DB
./stop.sh --keep-db   # stop API and UI, keep the DB running (use this to restart)
```

- App: http://127.0.0.1:5173 · API docs: http://127.0.0.1:8010/docs
- Logs: `.run/logs/backend.log`, `.run/logs/frontend.log`
- The API does **not** auto-reload. After backend changes or new migrations:
  `./stop.sh --keep-db && ./start.sh --no-open`. The UI hot-reloads.
- **Port 8000 belongs to another app on this machine. Never stop or kill it**, and never kill
  processes you didn't start.

## Checks (run all before saying work is done)

```bash
cd backend  && uv run pytest -q && uv run ruff check . && uv run mypy app
cd frontend && npx tsc -b && npx vitest run && npm run build
```

Backend tests use a separate `career_intelligence_test` database and never read `backend/.env`.
Network is never used in tests: inject fakes (see `tests/test_scanner.py` `FakeHttp`).

## Repository map

```
backend/
  app/
    main.py                 FastAPI app + lifespan (starts the optional scan scheduler)
    api/v1/*.py             HTTP routers (thin: validate, call a service, shape output)
    services/               business logic — job_service.ingest_job is THE entry for jobs
    models/                 SQLAlchemy models (import new ones in models/__init__.py)
    schemas/                Pydantic request/response models
    matching/               deterministic 0–100 engine (ENGINE_VERSION in config.py)
    jobs/                   JD parser, dedup rules (dedup.py)
    cv/                     CV text extraction + parser
    companies/              field-level verification, URL checker, importers
    scanner/                built-in job scanner: providers.py (job boards), filters.py,
                            service.py (run_scan, detect_boards), runner.py (background/schedule)
    integrations/           career_ops/ (read-only adapter + runner), google_sheets.py,
                            saved_sheets.py
    core/                   config, errors, logging, http (SSRF-safe), urls, text utils
  alembic/versions/         migrations (one file per change)
  tests/                    pytest suite
  scripts/devdb.py          starts the embedded dev PostgreSQL, prints DATABASE_URL
frontend/src/
  router/index.tsx          routes (lazy pages)
  layouts/AppLayout.tsx     sidebar navigation
  components/ui.tsx         shared UI: Card, Badge, JobStatusBadge, Stat, BackButton, …
  api/client.ts             fetch wrapper (api.get/post/patch/put/delete, ApiError)
  features/<area>/          one folder per page area (jobs, companies, scanner, sheets, …)
  test/                     Vitest tests + utils.tsx (renderAt, mockApi)
docs/                       ARCHITECTURE.md, API.md, career-ops-assessment.md, company-sources.md
start.sh / stop.sh / dev.sh run scripts
```

## Core flows (how things connect)

**Every job, from any source, goes through `job_service.ingest_job(db, JobInput)`.**
It validates, finds or creates the company, checks deleted-job tombstones, deduplicates
(`find_duplicate`: normalized URL → source external ID → company + title + compatible
location/date → similar JD), attaches a `JobSourceLink`, parses the JD and (optionally) scores.
Never insert `Job` rows directly.

- `JobInput.origin`: `manual` | `import` | `career_ops` | `scan`. Only `manual` may re-add a
  job the user deleted (`DeletedJob` tombstones); other origins raise `DeletedJobError`, which
  importers count as skipped.
- Listing/search URLs (`core.urls.is_listing_url`) never identify a job.

**Matching** (`matching/engine.py`) is pure and deterministic: 9 weighted components
(role 20, skills 25, experience 15, domain 10, location 10, seniority 5, salary 5, company 5,
other 5), blockers, confidence, `inputs_hash`. Scoring config is versioned (Settings → Scoring).
Changing profile, preferences, CVs or scoring config marks scores **stale**;
`match_service.reanalyze` re-scores. If you change engine logic, bump `ENGINE_VERSION`.

**Job sources**
- Built-in scanner (`scanner/`): scans job boards (Greenhouse, Lever, Ashby, SmartRecruiters,
  Workday, Workable, Recruitee, Pinpoint, Teamtailor) of companies with `job_search_enabled`.
  Filters in Settings → Job scanner. Runs in a background thread, one at a time (advisory lock).
- Career-Ops (`integrations/career_ops/`): **read-only** file adapter for an external
  Career-Ops checkout (`CAREER_OPS_PATH`). Optional "Scan + import" runs its `scan.mjs`
  (no AI, no tokens) in the background. Never write to the Career-Ops folder.
- Google Sheets (`integrations/saved_sheets.py`): saved sheets in Settings. Public sheets import
  directly; private sheets are imported by an agent that reads rows with a Google connector and
  POSTs them to `/api/v1/sheets/{id}/import-rows` (see `.agent/workflows/import-google-sheets.md`).
- CSV/JSON uploads and Add Job (manual).

**Jobs UI**: Open jobs and Closed positions are separate tabs (`/jobs`, `/jobs/closed`;
API filter `closed=true|false`). Status filter is multi-select (`status=A&status=B`).
Delete asks for confirmation; jobs with applications need `?force=true`.

**Companies**: values come from field-level claims with sources and verification status;
search-engine or fake URLs are INVALID. Don't overwrite verified data with unverified data.

## Conventions

- Backend: routers stay thin; logic in `services/` or the feature package. Raise
  `NotFoundError`, `ConflictError`, `DomainValidationError` (`core/errors.py`), never bare
  HTTPException. Errors are returned as `{"error": {"code", "message", "details"}}`.
- Outbound HTTP only via `core.http.safe_get` / `safe_request` (SSRF guard on every redirect).
- New table → model in `app/models/`, export in `models/__init__.py`, hand-written Alembic
  migration in `backend/alembic/versions/` (`down_revision` = current head). See
  `.agent/workflows/add-migration.md`.
- Line length 100 (ruff), mypy strict-ish: keep it clean.
- Frontend: TanStack Query for data (`queryKey` arrays), `api` client from `api/client.ts`,
  shared components from `components/ui.tsx`, Tailwind utility classes. No browser
  `alert/confirm/prompt` — use inline confirmations (see `features/jobs/DeleteJobButton.tsx`).
- Every feature gets tests: pytest for API/services, Vitest for UI behavior.
- Update `README.md` / `docs/API.md` when user-visible behavior or endpoints change.

## Rules that must not be broken

1. **No personal data in git.** Never commit `.env`, CVs/PDFs, `storage/`, `backend/.devdb/`,
   `.run/`, exports, or real names/emails/phone numbers. Check `git status` before committing.
2. **Commits are authored only by the repository owner** using the configured git identity.
   **Never add `Co-Authored-By`, "Generated with …", or any AI/agent attribution** to commit
   messages or PR descriptions.
3. **Ask before pushing**, force-pushing, rewriting history or deleting data.
4. **Never modify the external Career-Ops folder** (`CAREER_OPS_PATH`); only read it.
5. **Never fabricate data** (companies, jobs, salaries, verification). Unknown stays unknown.
6. Don't kill processes or free ports you didn't start (port 8000 is another app).
7. Keep scores deterministic: no randomness or wall-clock dependence in `matching/`.

## Useful API endpoints

`GET /api/v1/jobs` (filters: q, min_score, status[], closed, source, …) ·
`POST /api/v1/jobs` · `DELETE /api/v1/jobs/{id}` · `POST /api/v1/matches/reanalyze` ·
`GET /api/v1/dashboard` · `POST /api/v1/scanner/run` · `GET /api/v1/scanner/status` ·
`POST /api/v1/career-ops/import` · `POST /api/v1/career-ops/sync` · `GET /api/v1/sheets` ·
`POST /api/v1/sheets/{id}/import-rows`. Full list: `docs/API.md` or `/docs`.
