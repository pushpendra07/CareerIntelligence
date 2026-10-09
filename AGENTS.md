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

## First-time setup (new machine)

Prerequisites: macOS/Linux, [uv](https://docs.astral.sh/uv/) (installs Python 3.12 itself),
Node.js 20+ and npm, Google Chrome (optional, for `./start.sh` opening the app).
Docker is **not** needed.

```bash
git clone https://github.com/<owner>/CareerIntelligence.git career-intelligence
cd career-intelligence
cp .env.example backend/.env           # then edit backend/.env (see Configuration below)
(cd backend && uv sync)                # Python deps into backend/.venv
(cd frontend && npm install)           # UI deps
./start.sh                             # dev DB + migrations + API + UI, opens Chrome
```

The first start creates the embedded PostgreSQL in `backend/.devdb/` (git-ignored) and applies
all migrations. To use your own PostgreSQL instead, export `DATABASE_URL` before `./start.sh`.

## Configuration (`backend/.env`)

`backend/.env` is git-ignored and holds local settings. Empty values mean "not set".

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | dev DB from `scripts/devdb.py` | PostgreSQL URL (`postgresql+psycopg://…`) |
| `CAREER_OPS_PATH` | — | Absolute path to a local Career-Ops checkout (read-only for this app) |
| `CAREER_OPS_DATA_PATH` | — | Only if Career-Ops keeps its data outside the checkout; leave empty otherwise |
| `CAREER_OPS_SCAN_ENABLED` | `false` | `true` allows **Scan + import** to run Career-Ops' `scan.mjs` |
| `AI_PROVIDER` | `none` | Optional AI: `none`, `openai`, `anthropic`, `gemini`, `ollama` |
| `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL` | — | Only when an AI provider is set (costs tokens) |
| `STORAGE_PATH` | `storage` | Where uploaded CVs are stored (git-ignored) |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | `secrets/google-service-account.json` if present | Google service-account key for importing private Google Sheets |
| `CORS_ORIGINS` | 5173 origins | Allowed UI origins |
| `LOG_LEVEL` / `LOG_FORMAT` | `INFO` / `json` | Logging |
| `BACKEND_PORT` / `FRONTEND_PORT` | `8010` / `5173` | Ports used by `start.sh` (shell env, not `.env`) |

After editing `.env`, restart: `./stop.sh --keep-db && ./start.sh --no-open`.
Check what the app sees: `curl -s http://127.0.0.1:8010/api/v1/settings/system | python3 -m json.tool`.

## Career-Ops — complete guide

[Career-Ops](https://github.com/career-ops-hq/career-ops) is a separate, Node.js job-search
toolkit. This app uses it as an **optional job source** and never changes it.

### What the app does with it

| Action | What runs | Writes to Career-Ops? | Token cost |
|---|---|---|---|
| **Import now** | Reads Career-Ops files | No | None |
| **Scan + import** | `node scan.mjs --json --quiet`, then Import now | Career-Ops' scanner updates its own `data/` files, as it always does | None (no AI) |
| **Fetch via Career-Ops** (job page, when a JD is missing) | `node fetch-jd.mjs <url>` | No | None |

Only those two scripts are ever run (allowlisted, no shell, minimal environment). Career-Ops'
AI features (`/career-ops pipeline`, `*-eval.mjs`, `openai-*.mjs`, `gemini-*.mjs`) are **never**
started by this app; if the user runs them, their reports are imported.

Files read (relative to the Career-Ops data root):

| File | Used for |
|---|---|
| `data/scan-history.tsv` | Jobs found by scans (portal, posted date, requisition ID) |
| `data/pipeline.md` | Pending / processed jobs (expired and pre-screen-skipped are not imported) |
| `data/applications.md` | Tracker status → job status; applied rows become applications |
| `reports/*.md` | Career-Ops' own 1–5 evaluation (kept separately from the 0–100 score) |
| `jds/` | Saved job descriptions |
| `VERSION` (checkout root) | Version shown in Settings |

Tracker status mapping: evaluated → Reviewing, applied → Applied, responded → Recruiter
contacted, interview → Interview, offer → Offer, hired → Accepted, rejected → Rejected,
discarded → Closed, skip → Not relevant.

### Setup (once)

1. Have a Career-Ops checkout with its dependencies installed:
   `cd /path/to/careerops && npm install` (Node.js must be on `PATH`).
2. In `backend/.env`:
   ```
   CAREER_OPS_PATH=/absolute/path/to/careerops
   CAREER_OPS_DATA_PATH=
   CAREER_OPS_SCAN_ENABLED=true
   ```
3. Restart: `./stop.sh --keep-db && ./start.sh --no-open`.
4. Check **Settings → Career-Ops integration**: Path, Version, "Node.js: available",
   "Scanning: enabled", and non-zero pipeline/tracker counts.
   Or: `curl -s http://127.0.0.1:8010/api/v1/career-ops/status | python3 -m json.tool`
   — `data_root` must be the Career-Ops folder (not `.`).

### Run it — three ways

**A. In the app (recommended):** Settings → Career-Ops integration → **Scan + import**.
Runs in the background (typically **15–20 minutes**; it checks ~12,000 postings; limit 45 min).
The panel shows "Career-Ops is scanning…", then the result ("N new, M updated"). Only one
scan runs at a time. Keep the app running until it finishes (`./stop.sh` stops the scan).

**B. From a terminal (app running):**
```bash
curl -X POST http://127.0.0.1:8010/api/v1/career-ops/sync          # start (background)
curl -s http://127.0.0.1:8010/api/v1/career-ops/status | python3 -m json.tool   # progress
curl -s http://127.0.0.1:8010/api/v1/career-ops/imports | python3 -m json.tool  # history
curl -X POST http://127.0.0.1:8010/api/v1/career-ops/import        # import only (seconds)
```
`"running"` in the status is non-null while scanning; `"last_import"` shows the result.

**C. In the Career-Ops folder, then import:**
```bash
cd /path/to/careerops
npm run scan                  # or: node scan.mjs ; preview without writing: npm run scan -- --dry-run
```
Then Settings → Career-Ops → **Import now** (or `POST /api/v1/career-ops/import`).

Which companies, titles and locations Career-Ops scans is configured in Career-Ops itself
(`portals.yml`: `tracked_companies`, `title_filter`, `location_filter`, posting age) — not here.
Imported jobs show **Source → Career Ops** in the Jobs filters; jobs already in the app are
merged, never duplicated; jobs the user deleted are skipped.

### Troubleshooting Career-Ops

| Symptom | Cause / fix |
|---|---|
| Counts are all 0, `data_root` is `.` | Data path misconfigured; leave `CAREER_OPS_DATA_PATH=` empty or set it to the real folder, restart |
| "Scanning is disabled" (422) | Set `CAREER_OPS_SCAN_ENABLED=true`, restart |
| "Node.js is not installed or not on PATH" | Install Node.js; make sure `node` works in the shell that runs `./start.sh` |
| "scan.mjs not found" | `CAREER_OPS_PATH` points to the wrong folder |
| "scan.mjs timed out after 2700s" | A portal hung; run `npm run scan` in the Career-Ops folder to see which, then Import now |
| "already running" (409) | Wait for the current scan; it appears under `running` in the status |
| Run stuck as RUNNING after a restart | Auto-closed as FAILED after 1 hour; start a new one |

## Built-in job scanner (no Career-Ops needed)

Searches the public job boards of companies marked **Job search** in the Companies list
(Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee, Pinpoint,
Teamtailor). Takes 1–3 minutes. No keys, no tokens.

- **Scan now:** Settings → Job scanner → Scan now (or `POST /api/v1/scanner/run`, body `{}`).
- **One company:** company page → **Scan jobs** (`POST /api/v1/scanner/companies/{id}/scan`).
- **Find job boards:** Settings → Job scanner → Find job boards — reads careers pages to find a
  supported board for companies that only have a careers URL.
- **Which companies:** tick **Job search** on a company page. A company is scannable when its
  careers URL is (or links to) a supported board; the panel lists the ones that aren't.
- **Filters:** Settings → Job scanner → *What to keep*: titles to keep, generic titles (kept
  only if the JD mentions a stack keyword), titles to skip, locations to keep/skip, max age,
  max jobs per company.
- **Schedule:** *Scan automatically every N hours* (0 = manual). Runs while the app runs.
- **Results:** "Details" shows per company: postings, relevant, new, errors.
  Status: `GET /api/v1/scanner/status`; history: `GET /api/v1/scanner/runs`.

## Google Sheets

Settings → Google Sheets lists saved sheets with **Import** and the last result.
- Private sheets: connect a Google **service account** once (Settings → Google Sheets →
  *Connect private sheets*; key at `backend/secrets/google-service-account.json`, git-ignored),
  share each sheet with its email as Viewer, then **Import** reads every tab itself.
  Check: `GET /api/v1/sheets/access` (`service_account` = the email, `null` = not connected).
- Sheets shared "Anyone with the link → Viewer": **Import** downloads and imports directly.
- Without a service account, an agent with a Google connector can read private sheets and post
  the rows — follow `.agent/workflows/import-google-sheets.md`.
- Add a sheet: paste its URL in the panel (or `POST /api/v1/sheets {"url", "title"}`).
- Column names are matched flexibly (Job Title/title, Company, Location, Application Link/
  job_url, Status, Match Score, notes…). Company tabs (Company Name, Careers URL) import companies.
- The two saved sheets, their tabs (Seen Jobs · Job Tracker · Tracked Jobs · Target Companies),
  every accepted column and the status mapping: `docs/google-sheets.md`.
- Companies imported from a sheet are **not** searched for jobs until they have a verified job
  board and job search on — `.agent/workflows/add-company-for-scanning.md`.

## Other ways to add data

- **Add Job** (sidebar): paste a job URL and description → live preview → Save & analyze.
  Use this for LinkedIn / Naukri / Indeed (they can't be scanned).
- **CSV / JSON upload:** Settings → Import & export → import jobs or recruiters (`POST /api/v1/import/{jobs|recruiters}`).
- **Company research files (CLI):**
  ```bash
  cd backend && uv run python -m app.cli import-companies \
      --research-csv /path/master.csv --myjob-db /path/portal.sqlite --career-ops /path/to/careerops
  ```
- **Export:** Settings → Import & export → export CSV/JSON (`GET /api/v1/export/{entity}`, `/export/all`).

## Day-to-day flow

1. **CVs** → upload CV → *Merge into profile*. Review **Profile** and **Target Profile**
   (titles, skills, locations, salary).
2. Get jobs: **Scan now** (built-in), **Scan + import** (Career-Ops), Google Sheets, Add Job.
3. **Dashboard** → Today's Priorities; cards open the matching filtered lists.
4. **Jobs** → filter (multi-select status, score, source…), open a job, read the score
   breakdown, set status, **Apply** (creates an application), or **Delete**.
   Closed postings: set status *Closed* → they move to the **Closed positions** tab.
5. **Applications / Interviews / Offers / Follow-ups** track the pipeline.
6. After uploading a new CV or changing profile/preferences/scoring, scores become **stale**:
   Dashboard → **Re-analyze** (or `POST /api/v1/matches/reanalyze` with `{"only_stale": true}`).

## Troubleshooting (general)

| Symptom | Fix |
|---|---|
| UI shows errors / API not reachable | `tail -50 .run/logs/backend.log`; restart with `./stop.sh --keep-db && ./start.sh --no-open` |
| Port 8010 or 5173 busy | Another copy is running: `./stop.sh`, then start again (never touch port 8000) |
| New backend code not visible | The API doesn't auto-reload: restart it |
| "relation … does not exist" | Migrations not applied: restart (start.sh runs `alembic upgrade head`) |
| Scores look outdated (yellow *stale*) | Re-analyze from the Dashboard |
| A job keeps coming back after delete | It shouldn't: deleted jobs are remembered; only Add Job re-adds them |

## Companies and scan coverage

**Which companies are searched for jobs** (exact list, boards, URLs): `docs/scan-coverage.md`.
Summary on 2026-10-09: 40 companies are scanned — 36 by the built-in scanner (Greenhouse 12,
SmartRecruiters 10, Lever 4, Workday 3, Ashby 3, Teamtailor 3, Pinpoint 1) and 4 only by
Career-Ops (HCLTech, Wipro, Birlasoft on SuccessFactors; Zensar on Oracle Cloud). About 80
tracked companies can't be scanned (own careers site or unsupported system).

A company is searched by the built-in scanner only when **both** are true:
1. `job_search_enabled` is on (Companies → company → *Job search* checkbox), and
2. its careers URL is a **supported job board** (see the board table in `docs/scan-coverage.md`).

Check one company: `GET /api/v1/scanner/companies/{id}/board` (`null` = not scannable).

**Adding companies is not the goal — jobs are.** When asked to add companies, follow
`.agent/workflows/add-company-for-scanning.md`: find and verify the real job board, save it
with job search on, confirm it is scannable, scan it, and report the jobs found. When asked to
search for jobs, follow `.agent/workflows/find-jobs.md` and deliver a ranked list of real postings.

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
docs/                       ARCHITECTURE.md, API.md, scan-coverage.md, google-sheets.md,
                            career-ops-assessment.md, company-sources.md
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
  Full guide: *Career-Ops — complete guide* above.
- Google Sheets (`integrations/saved_sheets.py`): saved sheets in Settings. Public sheets import
  directly; private sheets are imported by an agent that reads rows with a Google connector and
  POSTs them to `/api/v1/sheets/{id}/import-rows` (see `.agent/workflows/import-google-sheets.md`).
  Sheets, tabs, columns and row mappings for jobs **and** companies: `docs/google-sheets.md`.
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
