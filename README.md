# Career Intelligence

Personal career command center. It covers CVs, a professional and target profile, a verified
company database, jobs (from Career-Ops or added manually), an explainable 0–100 match score,
applications, recruiters, interviews and prep, offers, follow-ups and analytics.

**Career-Ops discovers jobs. Career Intelligence manages the career.** Career-Ops stays an
independent, unmodified project; this app only reads its files. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/API.md](docs/API.md) and the original
analysis in [`docs/career-ops-assessment.md`](docs/career-ops-assessment.md).

Stack: React 19 + TypeScript + Vite + Tailwind + React Router + TanStack Query + React Hook Form
+ Zod · FastAPI + Pydantic v2 + SQLAlchemy 2 + Alembic · PostgreSQL 16.

## What you can do

- **CVs:** upload PDF, DOCX, TXT or Markdown. The original is kept unchanged, and each upload
  is parsed into name, experience (computed from dates), roles, companies, skills by category,
  domains, leadership, projects, certifications, education and achievements. You can keep
  versions, compare them, activate one, and merge or replace your profile from a CV.
- **Profile & target profile:** both are editable. Target titles, skills, domains, locations,
  remote/hybrid/onsite, salary, notice period and exclusions are all configurable. Architect
  roles are off unless you enable them.
- **Companies:** 539 imported from your research CSV, the `myjob` portal and Career-Ops'
  `portals.yml`, deduplicated with aliases.
  - Every field keeps its source and verification status, and fake LinkedIn URLs are marked
    INVALID.
  - One-click verification checks the website and careers page.
  - Tiers and job-search toggles can be set per company.
- **Jobs:**
  - **Add Job:** paste a URL and a JD, with a live preview of what will be detected.
  - **Detected automatically:** source (LinkedIn, Naukri, Indeed, Glassdoor and the major ATSs).
  - **Parsed from the JD:** skills, experience, salary and potential blockers.
  - **Deduplicated** across every source.
  - **Filters and sorting:** every filter and sort the spec lists.
- **Matching:** one deterministic engine for every job.
  - Nine weighted components, with reasons, strong matches, missing skills, blockers and a
    recommended CV.
  - Weights, thresholds and hard rules are configurable and versioned.
  - Scores go stale when your inputs change, and Re-analyze refreshes them.
- **Career-Ops:** importing, or scanning then importing, preserves Career-Ops' own 1–5
  evaluation and report next to the 0–100 score. Jobs you applied to in Career-Ops become
  applications.
- **Applications:** CV version, method, recruiter, referral, expected CTC and notice period,
  with a full event history. A follow-up is created automatically 7 days after applying.
- **Interviews:**
  - Rounds of any type, with feedback and results.
  - A question bank with practice tracking and confidence.
  - A prep pack per job or round: requirements, matched and missing skills, likely topics,
    projects to discuss, behavioral prep and questions to ask.
  - Optional AI question suggestions.
- **Offers:** compensation breakdown, automatic total CTC, a negotiation log, comparison
  against your target, and decisions (accepted, declined, expired).
- **Dashboard & analytics:** counters, Today's Priorities, application, interview and offer
  funnels, charts, score analytics and skill gaps.
- **Google Sheets:** import a jobs or companies tab with Settings → Import from Google Sheet (the sheet must be shared "Anyone with the link → Viewer"). Search-page links never merge jobs, and a sheet's own match scores are kept as notes, separate from the 0–100 score.
- **Everything else:** global search, CSV/JSON import and export (including a full JSON
  export), an audit log, and optional AI.

## Run natively (recommended here: no Docker needed)

Requirements: [uv](https://docs.astral.sh/uv/) and Node.js ≥ 20. Nothing is installed
system-wide:
- **Python 3.12:** goes into uv's cache.
- **Backend packages:** go into `backend/.venv`.
- **Frontend packages:** go into `frontend/node_modules`.
- **Dev PostgreSQL 16:** comes from the `pgserver` dev package, with its data in
  `backend/.devdb/`.

```bash
./start.sh          # DB + migrations + API (:8010) + UI (:5173) in the background, opens Chrome
./start.sh --no-open
./stop.sh           # stop UI, API and the dev PostgreSQL   (./stop.sh --keep-db keeps the DB)
```

On first run `start.sh` creates `backend/.env` from `.env.example` (edit it for CAREER_OPS_PATH, AI keys…).
Logs are in `.run/logs/`. For a foreground session with live reload of the API, use `./dev.sh`.

The backend uses port 8010 by default because 8000 is often taken by other local tools. Override
with `BACKEND_PORT=… FRONTEND_PORT=… ./dev.sh`. To use your own PostgreSQL instead of the dev
one, export `DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/career_intelligence`.

### First-time data load

```bash
cd backend
export DATABASE_URL=$(uv run python scripts/devdb.py)
# Companies from your research sources (read-only):
uv run python -m app.cli import-companies \
  --research-csv ../../jobsearch/database/php_magento_adobe_laravel_company_master.csv \
  --myjob-db ../../myjob/backend/jobs.db \
  --career-ops ../../careerops
```

Then in the UI:
1. **CVs:** upload your CV, then **Merge into profile**.
2. **Profile / Target Profile:** review both and set your salary targets.
3. **Settings:** click **Import now** under Career-Ops.
4. **Dashboard:** click **Re-analyze**.

## Run with Docker (optional)

```bash
cp .env.example .env      # set POSTGRES_PASSWORD and CAREER_OPS_PATH
docker compose up -d      # postgres + backend + frontend → http://127.0.0.1:8080
```

The Career-Ops folder is mounted read-only. (The Docker files are provided but were not
exercised on the development machine, which has no Docker.)

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (psycopg driver). |
| `CAREER_OPS_PATH` / `CAREER_OPS_DATA_PATH` | Career-Ops checkout and (optional) separate data root. |
| `CAREER_OPS_SCAN_ENABLED` | Allow **Scan + import** to run `node scan.mjs --json` (default `false`). |
| `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL` | Optional AI: `none` (default), `anthropic`, `openai`, `gemini`, `ollama`. |
| `STORAGE_PATH`, `MAX_UPLOAD_BYTES` | Where original CVs are stored, and the upload limit. |
| `CORS_ORIGINS`, `LOG_LEVEL`, `LOG_FORMAT` | Allowed browser origins, and JSON or text logs. |

## Development checks

```bash
cd backend
uv run pytest                      # 121 tests (real PostgreSQL via pgserver, or TEST_DATABASE_URL)
uv run ruff check . && uv run ruff format --check . && uv run mypy app
uv run alembic check               # models and migrations in sync

cd ../frontend
npm test                           # Vitest + Testing Library
npx tsc -b && npm run build
```

## Layout

```
backend/   FastAPI app (see docs/ARCHITECTURE.md), alembic/, tests/, scripts/devdb.py
frontend/  src/{api,components,layouts,pages,features/*,router,types,utils,test}
docs/      ARCHITECTURE.md, API.md
dev.sh     native launcher;  docker-compose.yml  optional containers
```

## Known limits

- **CV parsing** reads text-based files only. Scanned/image PDFs have no OCR; the app says so
  and asks for a DOCX or TXT.
- **Notifications** are shown in Today's Priorities and Follow-ups. Email delivery is not
  implemented; the daily-digest setting is stored for later.
- **Naukri, LinkedIn and Indeed** are not scanned: Career-Ops core doesn't scan them.
  Use **Add Job** (paste URL + JD) for those.
