<div align="center">

# 🎯 Career Intelligence

**A self-hosted career command center: CVs, companies, jobs, an explainable 0–100 match score, applications, interviews and offers in one place.**

*Finds jobs on company job boards, scores them against your profile, and runs your whole job search.*

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.14x-009688?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Tests](https://img.shields.io/badge/tests-160_backend_·_25_frontend-brightgreen)

[Features](#-features) ·
[Quick start](#-run-locally) ·
[How matching works](#-how-the-0100-match-score-works) ·
[Job scanner](#-built-in-job-scanner) ·
[Career-Ops](#-career-ops-integration-optional) ·
[Configuration](#%EF%B8%8F-configuration) ·
[Development](#-development) ·
[Docs](#-documentation)

</div>

---

## 📖 What is this?

Job hunting usually ends up spread across job boards, spreadsheets, CV folders, email
threads and notes. Career Intelligence brings it into one local web app:

```
CV ─▶ Professional Profile ─▶ Target Profile
                                   │
  Built-in job scanner · Manual "paste URL + JD" · CSV / JSON / Google Sheets · Career-Ops
                                   │
           Normalize ─▶ Deduplicate ─▶ Parse JD ─▶ 0–100 Match Score
                                   │
     Shortlist ─▶ Apply ─▶ Recruiter ─▶ Interviews ─▶ Offer ─▶ Analytics
```

- **Runs entirely on your machine.** No cloud service or account is needed, and your data stays local.
- **Explainable.** Every score breaks down into nine components, each with plain-language reasons.
- **Deterministic.** The same job, profile and scoring version always produce the same score.
- **AI is optional.** Parsing, scoring and interview prep work without any API key.
- **Finds jobs itself.** A built-in scanner searches the Greenhouse, Lever, Ashby, Workday… boards of companies you track.
- **Optionally works with [Career-Ops](https://github.com/career-ops-hq/career-ops)** without changing it.

---

## ✨ Features

<table>
<tr><td width="50%" valign="top">

### 📄 CVs & profile
- Upload **PDF, DOCX, TXT or Markdown**. The original file is never altered or deleted.
- Deterministic parsing extracts name, contact details, experience computed from dates,
  roles, companies, skills by category, domains, leadership, projects, certifications,
  education and achievements.
- **Versions**: compare two versions (skills added or removed, text diff), activate one,
  archive old ones.
- Build your **Professional Profile** from a CV (merge or replace), then edit it freely.
- **Target Profile**: titles, skills, domains, companies, locations,
  remote/hybrid/onsite, salary, notice period and exclusions. Architect roles are opt-in.

</td><td width="50%" valign="top">

### 🏢 Company intelligence
- Company master database with aliases, tiers (A/B/C) and job-search toggles.
- **Field-level provenance**: every value records its source, source URL, verification status
  and date.
- The verification status is **derived from evidence**: Verified, Partially verified,
  Researched, Discovered, Needs review, Stale, Invalid or Rejected.
- One-click **verification check** of the official website and careers page, through an
  SSRF-safe fetcher.
- Fake values are rejected. A "LinkedIn" URL that points to Facebook, or a Google-search
  "careers page", is stored as INVALID and never shown.

</td></tr>
<tr><td valign="top">

### 💼 Jobs
- **Built-in job scanner**: one click (or every N hours) searches the job boards of companies
  marked *Job search* and adds relevant jobs, with full descriptions, already scored.
- **Add Job**: paste a URL and a JD and save. A **live preview** shows the detected source, skills,
  experience, salary and possible blockers.
- Source detection for **LinkedIn, Naukri, Indeed, Glassdoor, Greenhouse, Lever, Workday,
  SmartRecruiters, SuccessFactors, Ashby**, other ATSs and company career pages.
- JD parsing: required vs preferred skills, years per skill, experience range, salary
  (LPA, lakhs, k, monthly), work model, locations, certifications, qualifications.
- **Deduplication** across every source. One job can show
  *Career-Ops ✓ LinkedIn ✓ Naukri ✓ Manual*. Search-results pages are never used as a job's identity.
- Filters (score, recommendation, tier, technology, location, work model, source, date,
  experience, salary, applied, and **any combination of statuses**) and sorting.
- Color-coded status labels and **status tabs** with counts: All open · New · Pending · Applied ·
  Interview · Selected · Rejected · Not pursuing · Closed.
- **Delete** a job (with confirmation). Deleted jobs are remembered, so imports and scans don't
  add them back; adding one again by hand still works.

</td><td valign="top">

### 🎯 Matching
- **One engine** for every job source, producing a 0–100 score with nine weighted components.
- Skill matches classified as **Exact / Partial / Related / Missing / Nice-to-have**, using a
  skills taxonomy (Magento 2 ⇒ Magento, MySQL ~ MariaDB).
- Experience fit (**under / good / over-qualified**), domain, location, seniority, salary
  (an unknown salary is not heavily penalized), company tier and other requirements.
- **Blocker detection**: mandatory certification, language, work authorization, minimum
  experience, notice period. Blockers are shown, and only auto-reject when you turn on hard rules.
- **Recommended CV** for each job. Scores go **stale** when your inputs change, and one click re-analyzes them.

</td></tr>
<tr><td valign="top">

### 📬 Pipeline
- **Applications**: CV version, method, recruiter, referral, expected CTC, notice period,
  and a full event history. A **follow-up is created automatically** 7 days after applying.
- **Recruiter CRM**: contact status (Contacted, Replied, Interested…) and follow-up dates.
- **Interviews**: rounds of any type (screen, technical, system design, managerial…),
  meeting links, feedback and results.
- **Question bank**: expected answer, your answer, confidence and practice tracking.
- **Interview prep pack** for each job or round: requirements, matched and missing skills, likely
  topics, projects to discuss, behavioral prep, questions to ask.
- **Offers**: compensation breakdown, automatic total CTC, a negotiation log, comparison
  against your target, and the decision.

</td><td valign="top">

### 📊 Insights & data
- **Dashboard**: key counters, **Today's Priorities** (interviews soon, overdue
  follow-ups, expiring offers, best jobs to apply to) and application, interview and offer funnels.
- **Charts**: jobs by score, source, location and work model; top companies;
  most-requested skills; **skill gaps**.
- **Analytics**: where scores are lost, and interview rate by score band.
- **Global search** across jobs, companies, recruiters, applications, interviews, CVs and skills.
- **Import & export** (CSV/JSON, including a full JSON export of everything) and **Google Sheets** import.
- **Audit log** of every important action.

</td></tr>
</table>

---

## 🚀 Run locally

The fastest way to run Career Intelligence is natively. **Docker is not required.**

### 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | recent | Python package and project manager. It installs Python 3.12 into its own cache. |
| [Node.js](https://nodejs.org/) | 20.19+ or 22.12+ | For the React frontend. |
| PostgreSQL | 16 *(optional)* | Not required. A dev PostgreSQL 16 is bundled through the `pgserver` Python package. |

Nothing is installed system-wide: Python packages go into `backend/.venv`, Node packages go
into `frontend/node_modules`, and dev database data goes into `backend/.devdb/`.

```bash
# macOS / Linux: install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Clone

```bash
git clone https://github.com/pushpendra07/CareerIntelligence.git
cd CareerIntelligence
```

### 3. Start

```bash
./start.sh
```

On the first run this:

1. creates `backend/.env` from `.env.example`
2. installs backend and frontend dependencies
3. starts a local PostgreSQL 16 and applies all database migrations
4. starts the **API** on `http://127.0.0.1:8010` and the **web app** on `http://127.0.0.1:5173`
5. waits until everything is healthy, then **opens the app in Google Chrome** (or your default browser)

```text
Career Intelligence is running
  App:      http://127.0.0.1:5173
  API docs: http://127.0.0.1:8010/docs
  Logs:     .run/logs
  Stop:     ./stop.sh
```

### 4. Stop

```bash
./stop.sh             # stop web app, API and the dev database
./stop.sh --keep-db   # stop web app and API, keep the database running
```

`stop.sh` only stops processes that `start.sh` started; other apps on your machine are left alone.

### Script options

| Command | What it does |
|---|---|
| `./start.sh` | Start everything in the background and open the app in Chrome |
| `./start.sh --no-open` | Start without opening a browser |
| `BACKEND_PORT=9000 FRONTEND_PORT=3000 ./start.sh` | Use different ports |
| `DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/ci ./start.sh` | Use your own PostgreSQL instead of the bundled one |
| `./dev.sh` | Foreground development mode: API auto-reload and Vite hot reload, Ctrl+C to stop |
| `./dev.sh stop-db` | Stop the dev database used by `dev.sh` |

### 5. First steps in the app

1. **CVs** → upload your CV → **Merge into profile**.
2. **Profile** and **Target Profile** → review them and set your **salary targets** (salary is
   scored as "unknown" until you do).
3. **Settings → Job scanner → Scan now** to search the job boards of companies marked
   *Job search* (and **Find job boards** to discover boards for companies that only have a careers page).
4. **Add Job** → paste a job URL and description → **Save & analyze** (for LinkedIn, Naukri, etc.).
5. *(Optional)* **Settings → Career-Ops → Import now** to pull in jobs that
   [Career-Ops](https://github.com/career-ops-hq/career-ops) has found.
6. **Dashboard** → work through **Today's Priorities**.

<details>
<summary><b>Optional: bulk-import companies from your own research files</b></summary>

```bash
cd backend
export DATABASE_URL=$(uv run python scripts/devdb.py)   # bundled dev database
uv run python -m app.cli import-companies \
  --research-csv /path/to/company_master.csv \
  --myjob-db     /path/to/jobs.db \
  --career-ops   /path/to/careerops
```

Every source is read-only. Placeholders such as "Not verified" or "Unknown" become empty
values, never data. Companies are matched by domain and by normalized name, so
*"Codilar Technologies Pvt Ltd"* and *"Codilar"* merge into one company.

Companies can also be imported from the UI (Companies API / Settings) as CSV, JSON or a
Google Sheet.
</details>

<details>
<summary><b>Manual setup (without the scripts)</b></summary>

```bash
# Backend
cd backend
uv sync
cp ../.env.example .env                          # then edit .env
export DATABASE_URL=$(uv run python scripts/devdb.py)
uv run alembic upgrade head
uv run uvicorn app.main:app --port 8010 --reload

# Frontend (second terminal)
cd frontend
npm ci
VITE_API_TARGET=http://127.0.0.1:8010 npm run dev   # http://127.0.0.1:5173
```
</details>

<details>
<summary><b>Troubleshooting</b></summary>

| Problem | Fix |
|---|---|
| `Port 8010 is already in use` | Another program uses the port. Run `BACKEND_PORT=8020 ./start.sh`. |
| `Career Intelligence is already running` | Run `./stop.sh` first. If it was stopped uncleanly, delete `.run/*.pid`. |
| API exited during start | Check `.run/logs/backend.log`, which usually shows a migration or `.env` error. |
| Web UI exited during start | Check `.run/logs/frontend.log`. Make sure your Node.js version is 20.19+ or 22.12+. |
| "This sheet is not public" | Share the Google Sheet as *Anyone with the link → Viewer*, or download it as CSV and import the file. |
| CV parsed with little text | It is probably a scanned/image PDF. OCR is not supported, so upload a DOCX or text-based PDF. |
| Scores show **stale** | Your profile, preferences, CVs or scoring changed. Click **Re-analyze** on the dashboard. |
</details>

---

## 🐳 Run with Docker (optional)

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and CAREER_OPS_PATH
docker compose up -d          # postgres + backend + frontend
open http://127.0.0.1:8080
```

| Service | Description |
|---|---|
| `postgres` | PostgreSQL 16, with data in a named volume |
| `backend` | FastAPI. It applies migrations on start, and the Career-Ops folder is mounted **read-only** |
| `frontend` | nginx serving the built app and proxying `/api` to the backend |

---

## 🧮 How the 0–100 match score works

Every job, whether it came from Career-Ops, manual entry, CSV or Google Sheets, goes through
**one deterministic engine**:

| Component | Weight | What it measures |
|---|---:|---|
| Role match | 20 | Title vs your target titles, role family (developer / lead / architect…), technology named in the title, other disciplines |
| Core skills | 25 | Required (80%) and preferred (20%) skills, each classified Exact / Partial / Related / Missing |
| Experience | 15 | Your relevant years vs the JD's range: under, good, or over-qualified; leadership |
| Domain | 10 | E-commerce, B2B, payments, ERP and so on, vs your profile and preferred domains |
| Location | 10 | Remote / hybrid / onsite allowed? Preferred cities (aliases such as Bangalore → Bengaluru, Delhi NCR) |
| Seniority | 5 | Title level vs your target levels |
| Salary | 5 | Above target / meets minimum / below minimum. **Unknown is not heavily penalized** |
| Company | 5 | Tier A / B / C, or one of your preferred companies |
| Other | 5 | Mandatory certification, language, work authorization, notice period, travel/shift |

**90–100** Highly recommended · **80–89** Recommended · **70–79** Consider · **60–69** Low priority · **< 60** Not recommended

<details>
<summary><b>Example breakdown</b></summary>

```text
Technical Lead – Adobe Commerce                         93 / 100  HIGHLY RECOMMENDED → APPLY
  Role Match            20.0 / 20   Title matches target 'Technical Lead'
  Core Skills Match     19.6 / 25   15/18 required skills matched exactly · 2/3 preferred covered
  Experience Match      15.0 / 15   12.6 years meets the 10+ years asked
  Domain Match          10.0 / 10   E-commerce, Adobe Commerce, ERP & Integrations
  Location Match        10.0 / 10   Hybrid in a preferred city
  Seniority Match        5.0 / 5    Lead level is targeted
  Salary Match           3.0 / 5    Salary not disclosed
  Company Preference     5.0 / 5    Tier A
  Other Requirements     5.0 / 5    No special requirements detected
  Strong: PHP · Magento 2 · Adobe Commerce · GraphQL · MySQL · RabbitMQ · SAP
  Missing: AWS · Docker · Kubernetes        Blockers: none
  Recommended CV: Tech Lead – Magento
```
</details>

**Design guarantees**

- **Configurable**: every weight, factor, threshold and tier value is editable in *Settings*. Each
  change is saved as a **new scoring version**.
- **Deterministic and auditable**: each result stores a SHA-256 hash of its inputs, the scoring
  version and the profile/target versions. Re-scoring identical inputs creates no new history entry.
- **Never silently stale**: changing your profile, preferences, CVs or weights flags existing scores as
  stale until they are re-analyzed.
- **Honest about missing data**: a job without a description gets **low confidence**, and its skills
  credit is capped, so a title alone can't produce a top score.

---

## 🔎 Built-in job scanner

**Settings → Job scanner → Scan now** searches the public job boards of every company with
**Job search** switched on. No API keys, no Node.js and no other project are needed.

| Board | What it returns |
|---|---|
| Greenhouse · Lever · Ashby · Pinpoint · Recruitee · Workable · Teamtailor | All open jobs **with full descriptions** in one call |
| SmartRecruiters · Workday | Job list, then one call per relevant job for its description |

How a scan works:

1. **Which board?** Each company's careers URL is matched to a supported board. Companies with only
   a careers page can use **Find job boards**, which reads the page and looks for a linked board.
2. **What to keep** (editable in Settings):
   - titles with a *keep* word (Magento, Adobe Commerce, PHP…) are kept;
   - generic titles (Software Engineer, Tech Lead, Architect…) are kept only when the **job description**
     mentions your stack;
   - excluded titles, other-country locations ("United States - Remote") and old postings are skipped.
3. **Import.** Kept jobs go through the same pipeline as every other source: deduplication, JD parsing
   and the 0–100 score. Re-scanning updates jobs instead of duplicating them.
4. **Report.** Each run records, per company, how many postings were found, kept and new, and any board error.

A company page also has **Scan jobs** for that one company. Scans can run automatically every N hours
while the app is running (**Settings → Job scanner → What to keep → Scan automatically every**).

---

## 🔌 Career-Ops integration (optional)

[Career-Ops](https://github.com/career-ops-hq/career-ops) can also be used as a job source,
unmodified. Career Intelligence connects through a **read-only file adapter**:

| Career-Ops file | Used for |
|---|---|
| `data/scan-history.tsv` | Jobs found by scans: portal, posted date, requisition ID, trust signals |
| `data/pipeline.md` | Pending and processed jobs (expired and pre-screen-skipped ones are not imported) |
| `data/applications.md` | Tracker status → initial job status; applied rows become applications |
| `reports/*.md` | The 1–5 evaluation, Machine Summary YAML and archived JD |
| `jds/` | Saved job descriptions |

- Career-Ops' **own 1–5 evaluation is kept separately** and shown next to the 0–100 score. It is never converted into it.
- Imports are idempotent: re-importing updates existing jobs instead of duplicating them.
- **No token cost.** The app only ever runs Career-Ops' `scan.mjs` and `fetch-jd.mjs`, which call public
  job-board APIs and no AI model. Career-Ops' AI evaluations (`/career-ops pipeline`, `*-eval.mjs`) are
  never started by this app; if you run them yourself, their reports are imported.
- **Settings → Career-Ops → Scan + import** (opt-in: `CAREER_OPS_SCAN_ENABLED=true`) runs `node scan.mjs --json`
  in the background (allowed up to 45 minutes; it checks 10,000+ postings), then imports. **Import now**
  only reads the files and takes seconds.
- The full analysis of why this design was chosen is in [docs/career-ops-assessment.md](docs/career-ops-assessment.md).

---

## ⚙️ Configuration

Settings live in `backend/.env`, which `start.sh` creates from [`.env.example`](.env.example).
Never commit it.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | bundled dev DB | PostgreSQL connection (`postgresql+psycopg://…`) |
| `CAREER_OPS_PATH` | — | Path to your Career-Ops checkout (read-only) |
| `CAREER_OPS_DATA_PATH` | — | Separate Career-Ops data root, if you use one |
| `CAREER_OPS_SCAN_ENABLED` | `false` | Allow **Scan + import** to run Career-Ops' scanner |
| `AI_PROVIDER` | `none` | `none`, `anthropic`, `openai`, `gemini` or `ollama` |
| `AI_MODEL` / `AI_API_KEY` / `AI_BASE_URL` | — | Optional AI settings (e.g. a local Ollama at `http://localhost:11434/v1`) |
| `STORAGE_PATH` | `storage` | Where original CV files are stored |
| `MAX_UPLOAD_BYTES` | `10485760` | Upload size limit |
| `CORS_ORIGINS` | `localhost:5173` | Allowed browser origins |
| `LOG_LEVEL` / `LOG_FORMAT` | `INFO` / `json` | Structured logging |

AI is used only for optional extras (suggested interview questions and JD summaries). Results are
returned as suggestions and never affect scoring.

---

## 🏗 Architecture

```
┌──────────────────────────┐   /api/v1    ┌───────────────────────────────┐      ┌────────────┐
│  React 19 + TypeScript   │ ───────────▶ │  FastAPI (modular monolith)   │ ───▶ │ PostgreSQL │
│  Vite · Tailwind ·       │              │  services · matching engine · │      │     16     │
│  TanStack Query · RHF+Zod│              │  JD/CV parsers · importers    │      └────────────┘
└──────────────────────────┘              └───────────────┬───────────────┘
                                                          │ read-only
                                                          ▼
                                              Career-Ops checkout (unmodified)
```

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 7, Vite 8, Tailwind CSS 4, React Router 7, TanStack Query 5, React Hook Form + Zod |
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic |
| Database | PostgreSQL 16 (JSONB, GIN indexes) |
| Testing | pytest against real PostgreSQL · Vitest + Testing Library |
| Quality | Ruff (lint + format), mypy `--strict`, `tsc` |

<details>
<summary><b>Project structure</b></summary>

```
.
├── backend/
│   ├── app/
│   │   ├── api/v1/            # REST routers (thin)
│   │   ├── services/          # business logic and transactions
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic request/response models
│   │   ├── matching/          # 0–100 engine (pure) + versioned config
│   │   ├── jobs/              # JD parser, dedup rules
│   │   ├── cv/                # file validation, text extraction, CV parser
│   │   ├── skills/            # skills & domains taxonomy
│   │   ├── companies/         # verification model, URL checker, importers
│   │   ├── scanner/           # built-in job scanner: board connectors, filters, runs
│   │   ├── integrations/      # Career-Ops adapter, Google Sheets
│   │   ├── interviews/        # interview-prep builder
│   │   ├── ai/                # optional AI providers
│   │   ├── storage/           # write-once file storage (S3-ready interface)
│   │   └── core/              # config, logging, errors, pagination, URL utils
│   ├── alembic/               # database migrations
│   ├── tests/                 # pytest suite
│   └── scripts/devdb.py       # bundled dev PostgreSQL
├── frontend/
│   └── src/
│       ├── features/          # dashboard, jobs, companies, cvs, profile, applications,
│       │                      # interviews, questions, offers, followups, analytics, settings
│       ├── components/        # shared UI (cards, badges, charts, list input…)
│       ├── api/  types/  utils/  router/  layouts/  test/
├── docs/                      # architecture, API reference, analyses
├── start.sh  stop.sh  dev.sh  # local run scripts
└── docker-compose.yml         # optional containers
```
</details>

---

## 🧪 Development

```bash
# Backend: tests run against a real PostgreSQL (bundled, or TEST_DATABASE_URL)
cd backend
uv run pytest                                   # 127 tests
uv run ruff check . && uv run ruff format --check .
uv run mypy app                                 # strict type checking
uv run alembic check                            # models and migrations in sync
uv run alembic revision --autogenerate -m "describe change"

# Frontend
cd frontend
npm test                                        # Vitest + Testing Library
npx tsc -b                                      # type check
npm run build                                   # production build
```

The test suite covers:
- the matching engine: determinism, every component, blockers and configurable weights
- the parsers: real-world JD and CV formats
- deduplication
- company verification and invalid-URL handling
- the job scanner: board detection, every connector, filters and the scan pipeline (no network)
- the Career-Ops import (and that its files stay byte-identical)
- every API workflow
- the main UI flows

---

## 🔒 Security & privacy

- **Local-first.** Your data lives in your own PostgreSQL and `backend/storage/`. Nothing is sent
  anywhere unless you enable an AI provider or run a verification check.
- **Uploads.** File types are allowlisted and checked by content signature, with a size limit and
  sanitized names. Files are stored write-once and served only as downloads (`nosniff`).
- **Inputs.** All input is validated with Pydantic and all SQL goes through bound parameters.
  Only `http(s)` URLs are accepted, and the React UI escapes everything it renders.
- **Outbound requests.** Verification fetches go through an SSRF guard (public IPs only, re-checked
  on every redirect).
- **Secrets.** They come only from the environment. Logs redact secret-like keys, and API responses
  never return keys.
- **Untrusted text.** Job text sent to AI is fenced as untrusted data, and AI output is validated
  and only offered as suggestions.
- **Exports.** CSV exports neutralize spreadsheet formula injection.
- **Git.** `.gitignore` keeps `.env` files, uploaded CVs, databases, exports and logs out of the repository.

---

## 📚 Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, data model, matching engine, verification, security, performance |
| [docs/API.md](docs/API.md) | All 96 REST endpoints (interactive docs at `/docs` when running) |
| [AGENTS.md](AGENTS.md) | Guide for AI coding agents (Antigravity, Claude Code, …): flow, rules, workflows in `.agent/` |
| [docs/career-ops-assessment.md](docs/career-ops-assessment.md) | Analysis of Career-Ops and the integration decision |
| [docs/company-sources.md](docs/company-sources.md) | Company data sources, quality and mapping |

---

## 🗺 Known limitations & roadmap

- **Scanned PDFs.** CVs need extractable text; there is no OCR.
- **Email notifications.** Not implemented yet. Reminders appear in Today's Priorities and Follow-ups.
- **LinkedIn / Naukri / Indeed.** They are not scanned automatically: they have no public jobs API
  and forbid scraping. Use **Add Job** (paste URL + JD) for those.
- **Custom career sites.** Companies whose careers page is their own system (no Greenhouse, Lever,
  Workday… board) cannot be scanned; some sites also block automated requests.
- **Private Google Sheets.** In-app sheet import needs a sheet shared as *Anyone with the link → Viewer*.
  Private sheets can be downloaded as CSV and imported.
- **Ideas:** a Celery worker for very large re-analysis runs, S3 storage, calendar sync for interviews.

---

<div align="center">

Built to take the chaos out of a job search.

</div>
