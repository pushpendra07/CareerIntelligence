# AGENTS.md — Career Intelligence

Guide for AI coding agents (Antigravity, Claude Code, Codex, Cursor…) working in this repo.
Read this first, then `docs/ARCHITECTURE.md` for depth. Short, always-on rules live in
`.agent/rules/`; step-by-step procedures live in `.agent/workflows/`.

## What this app is

A self-hosted career command center for one person's job search:

```
CV ─▶ Professional Profile ─▶ Target Profile
                                   │
  Job board search · Add Job (URL + JD) · CSV/JSON · Google Sheets · Career-Ops import
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
./install.sh          # buyers / end users: Docker image (UI + API on 8010) + PostgreSQL, or --native
./start.sh            # dev DB + migrations + API (8010) + UI (5173), opens Chrome
./start.sh --no-open  # same, no browser
./stop.sh             # stop API, UI and dev DB
./stop.sh --keep-db   # stop API and UI, keep the DB running (use this to restart)
./stop.sh --force     # also when a scan is running (stop.sh refuses otherwise: the scan would be lost)
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
| `CAREER_OPS_PATH` | `career-ops/` in the project, if present | Career-Ops checkout (read-only for this app); leave empty for the in-project copy |
| `CAREER_OPS_DATA_PATH` | — | Only if Career-Ops keeps its data outside the checkout; leave empty otherwise |
| `CAREER_OPS_SCAN_ENABLED` | `false` | `true` allows **Scan + import** to run Career-Ops' `scan.mjs` |
| `AI_PROVIDER` | `none` | Optional AI: `none`, `anthropic`, `gemini`, `openai`, `omniroute` (OpenAI-compatible gateway, default `http://localhost:20128/v1`), `ollama`. Powers the Assistant chat in free-form mode |
| `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL` | — | Only when an AI provider is set (costs tokens) |
| `STORAGE_PATH` | `storage` | Where uploaded CVs are stored (git-ignored) |
| `BACKUP_PATH` | `backups` | Automatic backup zips (database dump, data.json, CVs; git-ignored). Restore: `scripts/restore-backup.sh` |
| `APP_PASSWORD` | — | Optional: require this password to open the app (login cookie, 30 days) |
| `STATIC_DIR` | — | Built UI (`frontend/dist`) to serve from the API on one port (the Docker image sets it) |
| `POSTGRES_PASSWORD` / `APP_PORT` / `APP_BIND` | — / `8010` / `127.0.0.1` | Docker only (`docker-compose.yml`; `./install.sh` writes a random password) |
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

Career-Ops lives **inside this project** at `career-intelligence/career-ops/` (a fresh clone of
https://github.com/career-ops-hq/career-ops, git-ignored because it holds personal data).

1. Set it up (Node.js must be on `PATH`):
   ```bash
   ./scripts/setup-career-ops.sh                    # fresh clone + npm install + starter files
   ./scripts/setup-career-ops.sh --from /old/careerops   # also copy your data from an old install
   ./scripts/setup-career-ops.sh --update           # later: pull the latest Career-Ops
   ```
   Your data stays in `career-ops/`: `portals.yml` (companies to scan), `cv.md`,
   `config/profile.yml`, `data/` (tracker, pipeline, scan history), `reports/`, `jds/`, `output/`.
2. In `backend/.env` (empty path = use `career-ops/` inside the project; relative paths are
   relative to `backend/`):
   ```
   CAREER_OPS_PATH=
   CAREER_OPS_DATA_PATH=
   CAREER_OPS_SCAN_ENABLED=true
   ```
3. Restart: `./stop.sh --keep-db && ./start.sh --no-open`.
4. Check **Settings → Job sources → Career-Ops**: Path, Version, "Node.js: available",
   "Scanning: enabled", and non-zero pipeline/tracker counts.
   Or: `curl -s http://127.0.0.1:8010/api/v1/career-ops/status | python3 -m json.tool`
   — `data_root` must be the Career-Ops folder (not `.`).

### Run it — four ways

**A. In the app (recommended):** Settings → Job sources → Career-Ops → **Scan + import**.
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

**D. Automatically:** Settings → Career-Ops → *Run automatically*: **Scan + import every N hours**
(0 = off; needs `CAREER_OPS_SCAN_ENABLED=true` and Node.js) and **Import as soon as Career-Ops finds
something new** (imports when `pipeline.md`, `scan-history.tsv`, the tracker, `reports/` or `jds/`
change — e.g. after `npm run scan` in a terminal). Checked every 5 minutes while the app runs
(`scheduled_tick` in `integrations/career_ops/service.py`, started in `main.py`); stored in app
settings `career_ops`. *What Career-Ops searches* shows its `portals.yml` (companies, filters)
read-only (`GET /api/v1/career-ops/portals`) — edit that file in Career-Ops to change it.

**C. In the Career-Ops folder, then import:**
```bash
cd career-ops                  # inside this project
npm run scan                  # or: node scan.mjs ; preview without writing: npm run scan -- --dry-run
```
Then Settings → Career-Ops → **Import now** (or `POST /api/v1/career-ops/import`).

Which companies, titles and locations Career-Ops scans is configured in Career-Ops itself
(`portals.yml`: `tracked_companies`, `title_filter`, `location_filter`, posting age) — not here.
Imported jobs are found in Jobs with **Added via → Career-Ops** (or More filters → Source → Career Ops); jobs already in the app are
merged, never duplicated; jobs the user deleted are skipped.

### Troubleshooting Career-Ops

| Symptom | Cause / fix |
|---|---|
| Counts are all 0, `data_root` is `.` | Data path misconfigured; leave `CAREER_OPS_DATA_PATH=` empty or set it to the real folder, restart |
| "Scanning is disabled" (422) | Set `CAREER_OPS_SCAN_ENABLED=true`, restart |
| "Node.js is not installed or not on PATH" | Install Node.js; make sure `node` works in the shell that runs `./start.sh` |
| "scan.mjs not found" / not configured | Run `./scripts/setup-career-ops.sh`, or fix `CAREER_OPS_PATH` |
| "scan.mjs timed out after 2700s" | A portal hung; run `npm run scan` in the Career-Ops folder to see which, then Import now |
| "already running" (409) | Wait for the current scan; it appears under `running` in the status |
| Run stuck as RUNNING after a restart | Closed as FAILED when the app starts again (scans and imports run in the app's own threads); start a new one |

## Job board search — built-in scanner (no Career-Ops needed)

Naming: in the UI this app's own scanner is **Job board search** (buttons "Search now", "Search its
board"); **Career-Ops scan** / **Scan + import** always means the separate Career-Ops tool. Code and
API keep the `scanner` name (`/api/v1/scanner/…`, `added_via=scanner`).

Searches the public job boards of companies marked **Job search** in the Companies list
(Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee, Pinpoint,
Teamtailor, SAP SuccessFactors, Oracle Cloud) and company careers pages that publish
schema.org `JobPosting` data. Takes 1–3 minutes. No keys, no tokens.

- **Search now:** Settings → Job board search → Search now (or `POST /api/v1/scanner/run`, body `{}`).
- **One company:** company page → **Search its board** (`POST /api/v1/scanner/companies/{id}/scan`).
- **Find job boards:** Settings → Job board search → Find job boards — for every company not yet
  scannable: careers link from the website, Career-Ops' list, board links on the careers page,
  SuccessFactors on own domains, JobPosting data, and the name on job-board listings (verified).
  Methods and rules: `docs/scan-coverage.md`. Then **Turn on job search for them** for found boards.
- **Which companies:** tick **Job search** on a company page. A company is scannable when its
  careers URL is (or links to) a supported board; the panel lists the ones that aren't.
- **Filters:** Settings → Job board search → *What to keep*: titles to keep, generic titles (kept
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

- **AI search** (Jobs → AI search, `features/jobs/AiSearchPage.tsx`): a prompt built from the Target
  Profile for Claude (Chrome extension / Desktop) or Gemini to search LinkedIn, Naukri, Indeed, Foundit,
  Instahyre, Wellfound, Cutshort… in the user's own browser; the assistant pastes a JSON list back in
  "Jobs from the assistant" → **Check** (dry run: new / already in the app / deleted / invalid) → **Add**.
  API: `POST /api/v1/jobs/agent-import {"jobs": [...], "dry_run"?}` (`services/agent_import.py`,
  origin `agent`, Added via **AI search** = `ai_search`). Flexible keys (title/job_title, company,
  url/link, location, workplace, experience, salary, posted, description/jd, portal, notes);
  `allow_deleted: true` re-adds a job the user deleted (they asked). Portal buttons
  (`features/jobs/portals.ts`: search URLs; `PortalLauncher.tsx`: popup) → **Claude** / **Gemini**
  (opens the portal search, copies a portal prompt) or **Job collector**.
- **Assistant chat** (corner button / ⌘J on every page, `features/chat/Chat.tsx`; `POST /api/v1/chat`,
  `GET /api/v1/chat/status`; backend `app/chat/`): answers from the user's data through read-only
  tools (`chat/tools.py`: search_jobs, get_job, pipeline_summary, applications, interviews,
  follow-ups, offers, companies, recruiters, profile, search everything). With an AI provider it
  is a tool-calling loop (`chat/llm.py`: Anthropic, Gemini, OpenAI-compatible incl. OmniRoute);
  without one (or if the AI call fails) it uses rule-based commands (`chat/commands.py`).
  Changes are only **proposed** (`propose_*` tools → `actions` with an API path + body); the UI
  calls that API when the user clicks Confirm. History is kept in the browser (`chat.v1`).
- **Job collector Chrome extension** (`browser-extension/`, Manifest V3, no AI; install: Load unpacked —
  see `browser-extension/README.md`): click its icon on any job page → the job is added via
  `agent-import` (popup shows Added #id · score / Already in your list / deleted → Add anyway).
  From AI search it also collects a portal's search results (`background.js`) and hands them to
  the page (`bridge.js` ↔ `features/jobs/collector.ts`, `window.postMessage`), which checks them
  before the user adds them. Page reader `extract.js` (JobPosting JSON-LD → portal selectors →
  page); tested in `frontend/src/test/extension-extract.test.ts`. Download for users:
  Settings → Job sources → Chrome extension (`GET /api/v1/extension.zip?app=`, `services/extension_package.py`
  writes this app's addresses into `settings.js`; the Docker image copies `browser-extension/`).
- **Add Job** (button on Jobs / Dashboard): paste a job URL and description → live preview → Save & analyze.
  Use this for LinkedIn / Naukri / Indeed (they can't be scanned).
- **CSV / JSON upload:** Settings → Backup & import → Import a file (`POST /api/v1/import/{jobs|recruiters}`;
  companies: `POST /api/v1/companies/import`, which also reads a Naukri company-list export).
  Job-portal company pages (Naukri, LinkedIn, Monster, Foundit) go in `Company.extra_links`
  (`add_extra_links` in `services/company_service.py`), never in `website`/`careers_url`.
  Name matching for imports uses `same_company_name` (`core/text.py`): equal `company_key` **and**
  one name's generic words a subset of the other's, so "Aspire Software Solutions" ≠ "Aspire Systems".
- **Company research files (CLI):**
  ```bash
  cd backend && uv run python -m app.cli import-companies \
      --research-csv /path/master.csv --myjob-db /path/portal.sqlite --career-ops ../career-ops
  ```
- **List & detail pages:** jobs list preview panel `features/jobs/JobPreview.tsx` (`?preview=<id>`),
  row actions + `⋯` menu (`RowMenu` in `JobsPage.tsx`), job-page ←/→ through the last list
  (`features/jobs/JobNav.tsx`, sessionStorage `jobs.list.v1`), company side card
  (`features/jobs/CompanyCard.tsx`), skill marks in the JD (`Highlighted` in `JobParts.tsx`),
  shared sticky back bar (`components/StickyBar.tsx`). Companies: `/companies/duplicates`
  (`CompanyDuplicatesPage.tsx`, `GET /companies/duplicates`), bulk actions (`POST /companies/bulk`),
  facets (`GET /companies/facets`).
- **Export:** Settings → Backup & import → Back up your data (`GET /api/v1/export/{entity}`, `/export/all`).

## Packaging and first run

- **Docker** (`Dockerfile`, `docker-compose.yml`, `./install.sh`): one image — the UI is built in
  a Node stage and served by FastAPI (`STATIC_DIR`, `_serve_ui` in `main.py`: real files, else
  `index.html`; never for `/api`), plus `pg_dump` 16 for backups. Services `db` + `app`; volumes
  `pgdata` and `appdata` (`/data/storage`, `/data/backups`). CI job `docker` runs
  `./install.sh --docker` and checks it. Career-Ops scanning is native-only.
- **Notifications & reminders:** the bell (`components/Reminders.tsx`, data from `GET /reminders`
  + `GET /reminder-events`; read state per browser) also sets the tab-title count. Scheduled
  reminders: `services/reminder_service.py` (cron parser, scheduler thread started in `main.py`,
  rules in app settings `reminders`, fired ones in `reminder_events`; macOS notifications via
  `osascript` with arguments, never a built script), UI at Settings → Reminders.
- **Welcome wizard** (`/welcome`, `features/setup/WelcomePage.tsx`, `services/setup_service.py`):
  `AppLayout` redirects there while `GET /setup` says `needs_setup` (no CVs, no jobs, not
  finished). A new install has **no** default target titles/locations — never seed one user's
  preferences for everyone.

## Day-to-day flow

Full page-by-page guide for a fresh start (CV upload, profile fields, target profile, scoring,
companies, applying, interviews, offers, settings, backups): `docs/USER_GUIDE.md`. When the user
asks how to do something in the app, answer from it.

1. **CVs** → upload CV → *Merge into profile*. Review **Profile** and **Target Profile**
   (titles, skills, locations, salary).
2. Get jobs: **Search now** (Job board search), **Scan + import** (Career-Ops), Google Sheets, Add Job.
3. **Dashboard** → Today's Priorities; cards open the matching filtered lists.
4. **Jobs** → filter (multi-select status, score, source…), open a job, read the score
   breakdown, set status, **Apply** (creates an application), or **Delete**.
   Closed postings: set status *Closed* → they move to the **Closed positions** tab.
5. **Applications / Interviews / Offers / Follow-ups** track the pipeline.
6. After uploading a new CV or changing profile/preferences/scoring, scores become **stale** and
   are re-scored automatically in the background within a minute (`services/freshness.py`).
   To force it now: `POST /api/v1/matches/reanalyze` with `{"only_stale": true}`.
7. **Review new jobs** (`/jobs/review`): new jobs one at a time, best first; keys C/N/S/K/O/U (Closed, Not relevant, Shortlist, Skip, Open, Undo).
8. Missing descriptions: Today → **Fetch for 40 best jobs** (`POST /api/v1/jobs/fetch-descriptions`,
   `services/description_service.py`, readers in `jobs/jd_fetch.py`). Never fetches LinkedIn,
   Indeed, Glassdoor or Naukri. Search `q=#123` finds a job by ID.
9. Menu: Today · Jobs · Companies · Pipeline · Follow-ups · Reports · My profile · Settings; related pages are tabs
   (`SECTIONS` in `layouts/AppLayout.tsx`). The Jobs list remembers sort/filters in
   localStorage (`jobs.sort.v1`, `jobs.filters.v1`) until Reset.

## Troubleshooting (general)

| Symptom | Fix |
|---|---|
| UI shows errors / API not reachable | `tail -50 .run/logs/backend.log`; restart with `./stop.sh --keep-db && ./start.sh --no-open` |
| Port 8010 or 5173 busy | Another copy is running: `./stop.sh`, then start again (never touch port 8000) |
| New backend code not visible | The API doesn't auto-reload: restart it |
| "relation … does not exist" | Migrations not applied: restart (start.sh runs `alembic upgrade head`) |
| Scores look outdated (*updating*) | They refresh within a minute; if not, check the API is running and `backend.log` |
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

To find careers pages / job boards for companies that can't be scanned yet (web research, then
save via the API), use the ready prompt `docs/prompts/find-company-job-boards.md`. To research
and update every company's details (verification evidence, India presence, careers URL, tier for
untiered companies, then scan for jobs), use `docs/prompts/update-company-details.md`; its work
queue and progress ledger (resumes across sessions) is `scripts/company_queue.py`
(`next`, `log <ID> DONE|SKIPPED|NEEDS_USER "note"`, `status`; files in `scratch/`). To find
companies (any country) that hire people in India — India office, remote from India or
relocation — for the PHP / Magento / Adobe Commerce / Laravel / WordPress stack and add them
without duplicates, use `docs/prompts/add-companies-hiring-in-india.md`.

**Adding companies is not the goal — jobs are.** When asked to add companies, follow
`.agent/workflows/add-company-for-scanning.md`: find and verify the real job board, save it
with job search on, confirm it is scannable, scan it, and report the jobs found. When asked to
search for jobs, follow `.agent/workflows/find-jobs.md` and deliver a ranked list of real postings.

## Checks (run all before saying work is done)

```bash
cd backend  && uv run pytest -q && uv run ruff check . && uv run mypy app
cd frontend && npx tsc -b && npx vitest run && npm run build
```

End-to-end smoke test (read-only, against the running app, uses installed Chrome):
`cd frontend && npm run e2e`. GitHub Actions (`.github/workflows/ci.yml`) runs all of the
above on every push and pull request, the smoke test against a fresh database.

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
docs/                       USER_GUIDE.md, ARCHITECTURE.md, API.md, scan-coverage.md, google-sheets.md,
                            career-ops-assessment.md, company-sources.md
browser-extension/          Job collector Chrome extension (add the job you're viewing; collect a portal search)
start.sh / stop.sh / dev.sh run scripts
scripts/setup-career-ops.sh  set up Career-Ops inside the project (career-ops/, git-ignored)
```

## Core flows (how things connect)

**Every job, from any source, goes through `job_service.ingest_job(db, JobInput)`.**
It validates, finds or creates the company, checks deleted-job tombstones, deduplicates
(`find_duplicate` / `_same_posting`: normalized URL → source external ID → same posting ID in
the link → company + title in **any city** (not into a Not relevant/Closed job elsewhere) →
repost (title words contained, JD ≥ 60%, same level) → similar JD), attaches a `JobSourceLink`,
parses the JD and (optionally) scores. Ingest holds a transaction advisory lock
(`INGEST_LOCK_ID`) so concurrent scans/imports can't save the same job twice.
Never insert `Job` rows directly. Jobs saved twice before the rules caught them:
`GET /jobs/duplicates`, `POST /jobs/duplicates/merge` (UI: Jobs → "N duplicates",
`/jobs/duplicates`); the copy kept is the one with the furthest status.

- `JobInput.origin`: `manual` | `import` | `career_ops` | `scan`. Only `manual` may re-add a
  job the user deleted (`DeletedJob` tombstones); other origins raise `DeletedJobError`, which
  importers count as skipped.
- Listing/search URLs (`core.urls.is_listing_url`) never identify a job.

**Matching** (`matching/engine.py`) is pure and deterministic: 9 weighted components
(role 20, skills 25, experience 15, domain 10, location 10, seniority 5, salary 5, company 5,
other 5), blockers, confidence, `inputs_hash`. Scoring config is versioned (Settings → Scoring).
Changing profile, preferences, CVs or scoring config marks scores **stale**;
`match_service.reanalyze` re-scores. The background refresher (`services/freshness.py`, started
in `main.py`) re-scores stale jobs every minute and re-parses JDs parsed by an older
`JD_PARSER_VERSION` / `CATALOG_VERSION` — so bump `CATALOG_VERSION` when you add skills.
If you change engine logic, bump `ENGINE_VERSION`.

**Job sources**
- Job board search, the built-in scanner (`scanner/`): scans job boards (Greenhouse, Lever, Ashby, SmartRecruiters,
  Workday, Workable, Recruitee, Pinpoint, Teamtailor) of companies with `job_search_enabled`.
  Filters in Settings → Job board search. Runs in a background thread, one at a time (advisory lock).
- Career-Ops (`integrations/career_ops/`): **read-only** file adapter for an external
  Career-Ops checkout (`CAREER_OPS_PATH`). Optional "Scan + import" runs its `scan.mjs`
  (no AI, no tokens) in the background. Never write to the Career-Ops folder.
  Full guide: *Career-Ops — complete guide* above.
- Google Sheets (`integrations/saved_sheets.py`): saved sheets in Settings. Public sheets import
  directly; private sheets are imported by an agent that reads rows with a Google connector and
  POSTs them to `/api/v1/sheets/{id}/import-rows` (see `.agent/workflows/import-google-sheets.md`).
  Sheets, tabs, columns and row mappings for jobs **and** companies: `docs/google-sheets.md`.
- CSV/JSON uploads and Add Job (manual).

**Jobs UI**: status tabs with counts — All open, New, Pending, Applied, Interview,
Selected, Rejected, Not pursuing (`/jobs?tab=<key>`), Closed (`/jobs/closed`). Plain `/jobs` opens
New (sorted `-created_at`); with filters in the link it opens All open. Closed / Not relevant on
a job page returns to the last list (`lastJobListUrl` in `JobNav.tsx`). Tab → statuses:
new = New+Discovered · pending = Reviewing+Shortlisted+Ready to apply+On hold · applied =
Applied+Recruiter contacted+Screening · interview = Interview+Awaiting feedback · selected = Offer+Accepted · rejected ·
not-pursuing = Withdrawn+Not relevant · closed (defined in `JOB_TABS`, `JobsPage.tsx`).
Counts: `GET /api/v1/jobs/status-counts` (same filters as the list).
Every job has `added_via` (list, in arrival order): `manual` | `sheet` | `scanner` | `career_ops` |
`file` | `ai_search`, set by `ingest_job` from `JobInput.origin` (`manual`, `sheet`, `scan`, `career_ops`,
`import`, `agent`); filter with `GET /api/v1/jobs?added_via=<tag>`. New import paths must pass the right origin. Inside a tab the Status
filter is multi-select (`status=A&status=B`). API: `closed=true|false` separates closed jobs.
Delete asks for confirmation; jobs with applications need `?force=true`.

**Companies**: values come from field-level claims with sources and verification status;
search-engine or fake URLs are INVALID. Don't overwrite verified data with unverified data.

## Conventions

- Backend: routers stay thin; logic in `services/` or the feature package. Raise
  `NotFoundError`, `ConflictError`, `DomainValidationError` (`core/errors.py`), never bare
  HTTPException. Errors are returned as `{"error": {"code", "message", "details"}}`.
- Outbound HTTP only via `core.http.safe_get` / `safe_request` (SSRF guard on every redirect; the
  connection goes to the checked addresses, never a second DNS lookup).
- New table → model in `app/models/`, export in `models/__init__.py`, hand-written Alembic
  migration in `backend/alembic/versions/` (`down_revision` = current head). See
  `.agent/workflows/add-migration.md`.
- Line length 100 (ruff), mypy strict-ish: keep it clean.
- Frontend: TanStack Query for data (`queryKey` arrays), `api` client from `api/client.ts`,
  shared components from `components/ui.tsx`, Tailwind utility classes. Feedback after an action:
  `meta: { success: "…" }` / `meta: { toastError: true }` on a mutation (toast, `components/Toaster.tsx`).
  Phone layouts: `usePhone()` (`utils/media.ts`). Global shortcuts and ⌘K: `components/CommandPalette.tsx`. No browser
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
4. **Never modify Career-Ops' code** (`career-ops/`); the app only reads its files. Its personal data
   (`portals.yml`, `cv.md`, `data/`, `reports/`…) is the user's — never commit or delete it.
5. **Never fabricate data** (companies, jobs, salaries, verification). Unknown stays unknown.
6. Don't kill processes or free ports you didn't start (port 8000 is another app).
7. Keep scores deterministic: no randomness or wall-clock dependence in `matching/`.

## Useful API endpoints

`GET /api/v1/jobs` (filters: q, min_score, status[], closed, source, …) ·
`POST /api/v1/jobs` · `DELETE /api/v1/jobs/{id}` · `POST /api/v1/matches/reanalyze` ·
`GET /api/v1/dashboard` · `GET /api/v1/reports/{name}?from=&to=&group=` (`services/report_service.py`) · `GET /api/v1/cv-advice` (skills to add to the CV / skills missing) · `POST /api/v1/scanner/run` · `GET /api/v1/scanner/status` ·
`POST /api/v1/career-ops/import` · `POST /api/v1/career-ops/sync` · `GET /api/v1/sheets` ·
`POST /api/v1/sheets/{id}/import-rows`. Full list: `docs/API.md` or `/docs`.
