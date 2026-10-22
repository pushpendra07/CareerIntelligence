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
![Tests](https://img.shields.io/badge/tests-264_backend_·_150_frontend-brightgreen)

[Features](#-features) ·
[Quick start](#-run-locally) ·
[How matching works](#-how-the-0100-match-score-works) ·
[Assistant](#-assistant-chat) ·
[Job board search](#-job-board-search-built-in-scanner) ·
[LinkedIn & Naukri](#-linkedin-naukri--other-portals-ai-search--job-collector) ·
[Career-Ops](#-career-ops-integration-optional) ·
[Configuration](#%EF%B8%8F-configuration) ·
[Development](#-development) ·
[AI agents](#-using-ai-coding-agents) ·
[Docs](#-documentation)

</div>

---

## 📖 What is this?

Job hunting usually ends up spread across job boards, spreadsheets, CV folders, email
threads and notes. Career Intelligence brings it into one local web app:

```
CV ─▶ Professional Profile ─▶ Target Profile
                                   │
  Job board search · Career-Ops · Google Sheets · CSV / JSON · Add Job (URL + JD)
  Job collector Chrome extension · AI search (Claude / Gemini on LinkedIn, Naukri…)
                                   │
           Normalize ─▶ Deduplicate ─▶ Parse JD ─▶ 0–100 Match Score
                                   │
     Shortlist ─▶ Apply ─▶ Recruiter ─▶ Interviews ─▶ Offer ─▶ Analytics
                                   │
            Assistant chat: ask anything, apply, check status (you confirm changes)
```

- **Runs entirely on your machine.** No cloud service or account is needed, and your data stays local.
- **Explainable.** Every score breaks down into nine components, each with plain-language reasons.
- **Deterministic.** The same job, profile and scoring version always produce the same score.
- **AI is optional.** Parsing, scoring and interview prep work without any API key.
- **Finds jobs itself.** A built-in scanner searches the Greenhouse, Lever, Ashby, Workday… boards of companies you track, on a schedule.
- **One click from any job page.** The Job collector Chrome extension adds the job you are looking at (LinkedIn, Naukri, Indeed, careers pages).
- **Never the same job twice.** Same link, same posting ID, same company + title in another city, or a repost are recognised and merged.
- **Ask it anything.** The Assistant chat finds jobs, checks statuses and applies for you; every change waits for your Confirm.
- **Optionally works with [Career-Ops](https://github.com/career-ops-hq/career-ops)** without changing it, automatically every N hours.

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
- **Review new jobs**: new jobs one at a time, best match first, with why it fits, what's
  missing and the description; Open posting / Shortlist / Not relevant / Skip with one key
  (O / S / N / K). Jobs lists, the job page and Today show **Open posting ↗** and **Copy link**
  (to share the job's portal link) before Shortlist.
- **Job board search** (built-in): one click (or every N hours) searches the job boards of companies
  marked *Job search* and adds relevant jobs, with full descriptions, already scored.
- **Add Job**: paste a URL and a JD and save. A **live preview** shows the detected source, skills,
  experience, salary and possible blockers.
- Source detection for **LinkedIn, Naukri, Indeed, Glassdoor, Greenhouse, Lever, Workday,
  SmartRecruiters, SuccessFactors, Ashby**, other ATSs and company career pages.
- JD parsing: required vs preferred skills, years per skill, experience range, salary
  (LPA, lakhs, k, monthly), work model, locations, certifications, qualifications.
- **Deduplication** across every source. One job can show
  *Career-Ops ✓ LinkedIn ✓ Naukri ✓ Manual*. A job is the same when it has the same link, the same
  posting ID in its link, the same company + title in **any city**, or is a repost (same level, JD
  60%+ alike). Concurrent scans can't save it twice. **Jobs → N duplicates** merges older copies,
  keeping the one you got furthest with. Search-results pages are never used as a job's identity.
- **Admin-grid list** (like Magento's product grid): the search, filters, paging and bulk actions
  stay on top while you scroll, and so does the table header.
- **Status picker** lists your **most used statuses** first.
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
- **Off-stack cap**: if none of a job's main technologies (language, framework, platform, ERP
  module such as SAP FICO or ServiceNow) is in your profile or your wanted skills, the score is
  capped at 60, so a "Lead" title at a good company can't look like a strong match on its own.
  Soft skills (mentoring, agile) count half as much as technologies.
- **Recommended CV** for each job. When your inputs change, scores refresh by themselves in the background.

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
- **Reliability**: automatic daily backups (database + data + CVs, with a restore script),
  optional login password, GitHub Actions CI and a Playwright smoke test.
- **Reports**: ten reports (overview, jobs, applications, interviews, offers, companies,
  sources, follow-ups, skills, scans) for any date range — trend, stacked and donut charts,
  change vs the previous period, sortable detail tables, CSV download and print to PDF.
- **Global search** across jobs, companies, recruiters, applications, interviews, CVs and skills
  (⌘K command palette).
- **Notifications & reminders**: a bell with what needs you, scheduled reminders, macOS notifications.
- **Backup & import** (CSV/JSON, including a full JSON backup of everything) and **Google Sheets** import.
- **Audit log** of every important action.

</td></tr>
<tr><td valign="top">

### 💬 Assistant chat
- Round button at the bottom right of every page, or **⌘J**.
- Ask about anything in the app: *best new jobs this week*, *remote magento jobs in pune 80+*,
  *status of Accenture*, *#512*, *upcoming interviews*, *follow-ups due*, *how am I doing*.
- Tell it what to do: *apply 512*, *mark 77 not relevant*, *note 512 called HR*. Each change is
  shown as a card with **Confirm**; nothing changes until you click it.
- Works **without AI** (built-in commands, free). With **Claude, Gemini, OpenAI or OmniRoute**
  it understands any question in your own words, using read-only tools on your data.
- On/off and AI on/off in **Settings → About & AI**.

</td><td valign="top">

### 🧩 LinkedIn, Naukri & other portals
- **Job collector Chrome extension** (download from Settings): click it on any job page and the
  job is added — or you're told it's *Already in your list: #512*.
- **Jobs → AI search**: one button per portal (LinkedIn, Naukri, Indeed, Foundit, Glassdoor,
  Instahyre, Wellfound, Cutshort, Hirist, iimjobs). Pick the title and **Location** (Remote /
  Hybrid / Onsite and your cities), then **Job collector** (fully automatic) or **Claude / Gemini**
  (the portal opens with your search and the prompt is copied).
- Jobs found are **checked for duplicates first**; you click **Add** for the new ones. They are
  tagged *AI search*.

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
./stop.sh --force     # stop even while a scan is running (without it, stop.sh refuses so the scan isn't lost)
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

> Full walkthrough of every page from an empty start (CV upload, profile, target profile,
> scoring, companies, getting jobs, applying, interviews, offers, settings, backups):
> **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.

1. **CVs** → upload your CV → **Merge into profile**.
2. **Profile** and **Target Profile** → review them and set your **salary targets** (salary is
   scored as "unknown" until you do).
3. **Settings → Job board search → Search now** to search the job boards of companies marked
   *Job search* (and **Find job boards** to discover boards for companies that only have a careers page).
4. **Settings → Job sources → Chrome extension → Download**, install it (Load unpacked), then click
   it on any LinkedIn / Naukri / careers-page job to add it. Or use **Add Job** (paste URL + description).
5. *(Optional)* **Jobs → AI search** to search portals with the Job collector, Claude or Gemini.
6. *(Optional)* **Settings → Career-Ops → Import now** (or *Run automatically*) to pull in jobs that
   [Career-Ops](https://github.com/career-ops-hq/career-ops) has found.
7. **Today** → work through **Today's Priorities**, or ask the **Assistant** (⌘J) *“what should I apply to today?”*

<details>
<summary><b>Optional: bulk-import companies from your own research files</b></summary>

```bash
cd backend
export DATABASE_URL=$(uv run python scripts/devdb.py)   # bundled dev database
uv run python -m app.cli import-companies \
  --research-csv /path/to/company_master.csv \
  --myjob-db     /path/to/jobs.db \
  --career-ops   ../career-ops
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
| Scores show **updating** | Your profile, preferences, CVs or scoring changed; they refresh within a minute. |
</details>

---

## 🐳 Install with one command (Docker)

For people who just want to use the app: no Python or Node.js needed, only
[Docker](https://docs.docker.com/get-docker/).

```bash
git clone https://github.com/<owner>/CareerIntelligence.git career-intelligence
cd career-intelligence
./install.sh                  # Docker if installed, else the native setup (--docker / --native)
```

It creates `.env` (random database password, readable by you only), builds one image with the
API **and** the web UI, starts it with PostgreSQL 16 and opens **http://127.0.0.1:8010**. A new
install opens the **Welcome** setup: upload your CV → what you want → companies to watch → first
jobs (about five minutes, every step can be skipped).

| | |
|---|---|
| Stop / start | `docker compose down` / `docker compose up -d` (data is kept in volumes) |
| Update | `git pull && ./install.sh` (migrations run on start) |
| Logs | `docker compose logs -f app` |
| Settings | `.env`: `APP_PASSWORD`, `AI_PROVIDER`, `APP_PORT`, `APP_BIND` (`0.0.0.0` = reachable from your network; set `APP_PASSWORD` then) |
| Backups | Settings → Backup & import (full `pg_dump` + CVs, in the `appdata` volume) |

Career-Ops scanning needs the native setup (it runs Node.js scripts); everything else works in
Docker. Without Docker, `./install.sh --native` installs the dependencies and runs `./start.sh`.
To serve the built UI from the API natively too, build it (`cd frontend && npm run build`) and
set `STATIC_DIR=../frontend/dist` in `backend/.env`.

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
  stale, and the background refresher re-scores them within a minute.
- **Honest about missing data**: a job without a description gets **low confidence**, and its skills
  credit is capped, so a title alone can't produce a top score.

---

## 🔎 Job board search (built-in scanner)

**Settings → Job board search → Search now** searches the public job boards of every company with
**Job search** switched on. No API keys, no Node.js and no other project are needed.

| Board | What it returns |
|---|---|
| Greenhouse · Lever · Ashby · Pinpoint · Recruitee · Workable · Teamtailor | All open jobs **with full descriptions** in one call |
| SmartRecruiters · Workday · SAP SuccessFactors · Oracle Cloud | Job list, then one call per relevant job for its description |
| Company careers pages with schema.org `JobPosting` data | The postings on the page |

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
while the app is running (**Settings → Job board search → What to keep → Scan automatically every**).

---

## 💬 Assistant chat

The chat at the bottom right of every page (**⌘J**) answers from your own data and can act for you.

| Ask | You get |
|---|---|
| *best new jobs this week* · *remote magento jobs in pune 80+* · *laravel jobs last 3 days* | Matching jobs as cards (score, status, link) |
| *#512* · *tell me about job 512* | Status, score and why, missing skills, salary, latest activity, link |
| *status of Accenture* · *where did I apply in the last 30 days?* | Its jobs and your applications |
| *upcoming interviews* · *follow-ups due* · *offers* · *how am I doing* | The lists and your pipeline in numbers |
| *apply 512* · *mark 77 not relevant* · *note 512 called HR* · *done follow-up 9* | A card with **Confirm**: records the application (+ follow-up, + apply link), changes the status, adds the note |

- **Two modes.** Without AI it understands the commands above (free, instant, private). With an AI
  provider it understands any question and can combine lookups (*“which Pune jobs did I apply to last
  week and has anyone replied?”*). If the AI call fails it falls back to commands and says why.
- **Safe by design.** The AI only gets **read-only tools** (search jobs, job details, pipeline,
  applications, interviews, follow-ups, offers, companies, recruiters, profile). Changes are only
  *proposed*; the app makes them when you click **Confirm**. “Apply” records it in the app and opens
  the posting — it never submits forms on other websites.
- **Providers:** Claude (Anthropic), Gemini, OpenAI, **OmniRoute** (OpenAI-compatible gateway,
  `http://localhost:20128/v1`) and Ollama — see [Configuration](#%EF%B8%8F-configuration).
- **Settings → About & AI → Assistant:** *Show the Assistant* (on/off) and *Use AI in the Assistant*
  (off = commands only, no tokens). The conversation is kept in your browser; **Clear** empties it.

API: `POST /api/v1/chat`, `GET /api/v1/chat/status`. Code: `backend/app/chat/` (tools, commands, provider loop).

---

## 🧩 LinkedIn, Naukri & other portals: AI search & Job collector

These portals have no public jobs API and can't be scanned, so the app works with them **in your own
browser, with your own login**.

### Job collector Chrome extension (no AI, no tokens)

1. **Settings → Job sources → Chrome extension → Download extension (.zip)** — it is pre-set to your
   app's address. Unzip it.
2. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → choose the unzipped
   `career-intelligence-extension` folder → pin it.
3. On any job posting (LinkedIn, Naukri, Indeed, Glassdoor, Foundit, Instahyre, Wellfound, Cutshort,
   Hirist, iimjobs or a company careers page) **click the extension**:
   **Added #123 · score 78**, **Already in your list: #512** (the new link is added to it), or
   **You deleted this job before → Add it anyway**.

It reads the page (schema.org `JobPosting` data, then each portal's layout, then the page itself),
never clicks Apply or messages anyone, and sends data only to your own app. Source:
[`browser-extension/`](browser-extension/README.md). After an update, click ↻ on the extension in
`chrome://extensions` and reload the app tab.

### Jobs → AI search

- **Portal buttons** open a popup: **Job title**, **Location** (one multi-select: Remote — anywhere in
  India — Hybrid, Onsite and your cities; each choice becomes a search) and who searches:
  - **Job collector** — *automatic*: opens each search, reads every job and brings them back.
  - **Claude** / **Gemini** — the portal opens with your search filled in (LinkedIn, Naukri, Indeed,
    Foundit, Glassdoor) and a prompt built from your Target Profile is copied; open the assistant's
    side panel, paste, Enter. (Chrome doesn't let a page start another extension, so this needs one paste.)
- **One prompt for several portals** to copy into any AI assistant.
- **Jobs from the assistant**: the JSON list it returns → **Check** (new / already in the app /
  deleted / invalid, nothing saved) → **Add N new jobs**. API: `POST /api/v1/jobs/agent-import`.

> LinkedIn and some other portals don't allow automated collection in their terms. Adding the job you
> are looking at is the safest use; the collector goes at a reading pace and stops at 50 jobs.

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
- **Lives inside this project.** `./scripts/setup-career-ops.sh` clones Career-Ops into `career-ops/`
  (git-ignored: it holds your CV, tracker and reports) and installs it; the app finds it automatically.
  `--from /old/careerops` copies your data from an existing install; `--update` pulls the latest version.
- **No token cost.** The app only ever runs Career-Ops' `scan.mjs` and `fetch-jd.mjs`, which call public
  job-board APIs and no AI model. Career-Ops' AI evaluations (`/career-ops pipeline`, `*-eval.mjs`) are
  never started by this app; if you run them yourself, their reports are imported.
- **Settings → Career-Ops → Scan + import** (opt-in: `CAREER_OPS_SCAN_ENABLED=true`) runs `node scan.mjs --json`
  in the background (allowed up to 45 minutes; it checks 10,000+ postings), then imports. **Import now**
  only reads the files and takes seconds.
- **Run automatically:** *Scan + import every N hours* and *Import as soon as Career-Ops finds something
  new* (e.g. after `npm run scan` in a terminal), checked every 5 minutes while the app runs.
- **What Career-Ops searches:** its `portals.yml` companies, titles, locations and posting age, shown
  read-only (edit the file in Career-Ops to change them).
- The full analysis of why this design was chosen is in [docs/career-ops-assessment.md](docs/career-ops-assessment.md).

---

## ⚙️ Configuration

Settings live in `backend/.env`, which `start.sh` creates from [`.env.example`](.env.example).
Never commit it.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | bundled dev DB | PostgreSQL connection (`postgresql+psycopg://…`) |
| `CAREER_OPS_PATH` | `career-ops/` in the project | Career-Ops checkout (read-only); leave empty to use the in-project copy |
| `CAREER_OPS_DATA_PATH` | — | Separate Career-Ops data root, if you use one |
| `CAREER_OPS_SCAN_ENABLED` | `false` | Allow **Scan + import** to run Career-Ops' scanner |
| `AI_PROVIDER` | `none` | `none`, `anthropic`, `gemini`, `openai`, `omniroute` or `ollama` |
| `AI_MODEL` / `AI_API_KEY` / `AI_BASE_URL` | — | Optional AI settings. OmniRoute defaults to `http://localhost:20128/v1` (key only if it requires one); Ollama to `http://localhost:11434/v1` |
| `STORAGE_PATH` | `storage` | Where original CV files are stored |
| `BACKUP_PATH` | `backups` | Automatic backups (Settings → Backup & import); restore with `scripts/restore-backup.sh` |
| `APP_PASSWORD` | — | Optional login password (empty = no login) |
| `MAX_UPLOAD_BYTES` | `10485760` | Upload size limit |
| `CORS_ORIGINS` | `localhost:5173` | Allowed browser origins |
| `LOG_LEVEL` / `LOG_FORMAT` | `INFO` / `json` | Structured logging |

AI is used only for optional extras: the **Assistant** in free-form mode, suggested interview
questions and JD summaries. It never affects scoring, and it never changes data without your Confirm.

```bash
# backend/.env — pick one, then: ./stop.sh --keep-db && ./start.sh
AI_PROVIDER=anthropic   AI_API_KEY=sk-ant-…                      # Claude (AI_MODEL optional)
AI_PROVIDER=gemini      AI_API_KEY=…        AI_MODEL=<gemini model>
AI_PROVIDER=openai      AI_API_KEY=sk-…     AI_MODEL=<openai model>
AI_PROVIDER=omniroute   AI_MODEL=<model or combo>                 # local OmniRoute gateway
```

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
│   │   ├── chat/              # Assistant: read-only tools, built-in commands, AI tool loop
│   │   ├── integrations/      # Career-Ops adapter (+ schedule), Google Sheets
│   │   ├── interviews/        # interview-prep builder
│   │   ├── ai/                # optional AI providers
│   │   ├── storage/           # write-once file storage (S3-ready interface)
│   │   └── core/              # config, logging, errors, pagination, URL utils
│   ├── alembic/               # database migrations
│   ├── tests/                 # pytest suite
│   └── scripts/devdb.py       # bundled dev PostgreSQL
├── frontend/
│   └── src/
│       ├── features/          # dashboard, jobs (incl. AI search, duplicates), chat, companies,
│       │                      # cvs, profile, applications, interviews, offers, followups, settings
│       ├── components/        # shared UI (cards, badges, charts, list input…)
│       ├── api/  types/  utils/  router/  layouts/  test/
├── browser-extension/         # Job collector Chrome extension (Manifest V3, no build step)
├── docs/                      # architecture, API reference, user guide, prompts
├── start.sh  stop.sh  dev.sh  # local run scripts
└── docker-compose.yml         # optional containers
```
</details>

---

## 🧪 Development

```bash
# Backend: tests run against a real PostgreSQL (bundled, or TEST_DATABASE_URL)
cd backend
uv run pytest                                   # 264 tests
uv run ruff check . && uv run ruff format --check .
uv run mypy app                                 # strict type checking
uv run alembic check                            # models and migrations in sync
uv run alembic revision --autogenerate -m "describe change"

# Frontend
cd frontend
npm test                                        # Vitest + Testing Library (150 tests)
npx tsc -b                                      # type check
npm run build                                   # production build
```

The test suite covers:
- the matching engine: determinism, every component, blockers and configurable weights
- the parsers: real-world JD and CV formats
- deduplication (links, posting IDs, same job in other cities, reposts) and merging duplicates
- the Assistant: commands, every AI provider's tool loop (with a fake provider), never writing on its own
- AI search imports, the Job collector's page reader and the extension download
- company verification and invalid-URL handling
- the job scanner: board detection, every connector, filters and the scan pipeline (no network)
- the Career-Ops import (and that its files stay byte-identical)
- every API workflow
- the main UI flows

---

## 🤖 Using AI coding agents

This repo is set up so an AI coding agent (Antigravity, Claude Code, Codex, Cursor, Gemini CLI,
GitHub Copilot…) can understand it, run it, and **search jobs for you**, not just edit code.

### What the agent reads

| File | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | The main guide: stack, setup, configuration, how every flow works (job ingest → dedup → score), Career-Ops, the job scanner, Google Sheets, troubleshooting and rules |
| [`.agent/rules/project-rules.md`](.agent/rules/project-rules.md) | Always-on rules (no personal data in git, no AI attribution in commits, ask before pushing, never edit Career-Ops…) |
| [`.agent/workflows/`](.agent/workflows) | Step-by-step procedures the agent can run (table below) |
| [`docs/scan-coverage.md`](docs/scan-coverage.md) | Which companies are searched for jobs, on which job board |
| [`docs/google-sheets.md`](docs/google-sheets.md) | Your sheets, tabs, columns and how rows become jobs and companies |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | How a person uses every page, from an empty start (CV → profile → jobs → offers) |
| `CLAUDE.md` · `GEMINI.md` · `.github/copilot-instructions.md` | Pointers to `AGENTS.md` for tools that look for their own file name |

Which file each tool picks up automatically:

| Agent | Reads |
|---|---|
| **Google Antigravity** | `AGENTS.md`, rules in `.agent/rules/`, workflows in `.agent/workflows/` (run with `/<name>`, e.g. `/find-jobs`) |
| **Claude Code** | `CLAUDE.md` (which imports `AGENTS.md`) |
| **OpenAI Codex**, **Cursor** | `AGENTS.md` |
| **Gemini CLI** | `GEMINI.md` → `AGENTS.md` |
| **GitHub Copilot** | `.github/copilot-instructions.md` → `AGENTS.md` |

Any other agent: tell it *"Read AGENTS.md first."*

### Workflows

| Workflow | Ask the agent… | What it does |
|---|---|---|
| `fresh-start` | "Set this up for me from scratch" | Walks you through CV upload, profile, target profile, companies and the first job search ([USER_GUIDE](docs/USER_GUIDE.md)) |
| `find-jobs` | "Find jobs for me" | Runs the scanner, imports your sheets, optionally Career-Ops, re-scores, then lists new jobs and top matches (score · title · company · location · link) |
| `job-scanner` | "Run the job scanner" | Built-in scan of all job-search companies and a report |
| `career-ops-scan` | "Run a Career-Ops scan" | Starts Career-Ops' scanner (no AI, no tokens), waits, reports new/updated jobs |
| `import-google-sheets` | "Import my Google Sheets" | Uses the app's own import (service account) or a Google connector; reports new vs existing per tab |
| `add-company-for-scanning` | "Add Acme and search its jobs" | Finds and verifies the company's real job board, enables job search, scans it, reports jobs |
| `run-app` | "Start the app" | `./start.sh`, restart after backend changes, logs |
| `run-checks` | "Run all checks" | pytest, ruff, mypy, tsc, vitest, build |
| `add-migration` | "Add a column for …" | Model + Alembic migration + tests |
| `commit` | "Commit this" | Checks, no personal files, owner-only authorship, asks before pushing |

### Getting started

1. Clone the repo, copy `.env.example` to `backend/.env` and fill it in (see [Configuration](#%EF%B8%8F-configuration)).
2. Open the folder in your agent and say: **"Read AGENTS.md, then start the app."**
3. Then ask for what you need, for example:
   - "Find jobs for me — Magento / Adobe Commerce lead roles, India or remote, score 70+."
   - "Add these companies and search their jobs: Ranosys, Webkul, Krish TechnoLabs."
   - "Import my Google Sheets and show me what's new."
   - "Run a Career-Ops scan and tell me the new jobs."
   - "Add a 'Hiring manager' field to jobs, with tests."

### Before you start

- **The app must be running** (`./start.sh`) — the agent searches through the app's API.
- **Private Google Sheets:** connect the service account once (Settings → Google Sheets), or give
  the agent a Google Sheets/Drive connector.
- **Career-Ops** is optional: `./scripts/setup-career-ops.sh`, then `CAREER_OPS_SCAN_ENABLED=true`.
- **Safety built in:** the rules tell agents never to commit personal data or credentials, never to
  add AI co-author lines to commits, to ask before pushing or deleting, never to edit your
  Career-Ops folder or Google Sheets, and never to invent jobs, companies or links.
- Review what the agent changed (`git diff`) before you push.

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
- **Assistant.** The AI gets read-only tools only; every change is a proposal you confirm.
- **Chrome extension.** Reads only the page you click it on (or the portal search you start from the
  app), only accepts requests from the app's own pages, and sends data only to your app.
- **Exports.** CSV exports neutralize spreadsheet formula injection.
- **Git.** `.gitignore` keeps `.env` files, uploaded CVs, databases, exports and logs out of the repository.

---

## 📚 Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, data model, matching engine, verification, security, performance |
| [docs/API.md](docs/API.md) | All REST endpoints (interactive docs at `/docs` when running) |
| [browser-extension/README.md](browser-extension/README.md) | Job collector Chrome extension: install, use, how it reads pages |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Start from scratch: every page of the app step by step |
| [AGENTS.md](AGENTS.md) | Guide for AI coding agents (Antigravity, Claude Code, …): flow, rules, workflows in `.agent/` |
| [docs/scan-coverage.md](docs/scan-coverage.md) | Companies searched for jobs and their job boards |
| [docs/google-sheets.md](docs/google-sheets.md) | Google Sheets: tabs, columns, mapping, private-sheet setup |
| [docs/career-ops-assessment.md](docs/career-ops-assessment.md) | Analysis of Career-Ops and the integration decision |
| [docs/company-sources.md](docs/company-sources.md) | Company data sources, quality and mapping |

---

## 🗺 Known limitations & roadmap

- **Scanned PDFs.** CVs need extractable text; there is no OCR.
- **Email notifications.** Not implemented yet. Reminders appear in Today's Priorities and Follow-ups.
- **LinkedIn / Naukri / Indeed.** They are not scanned on a schedule: they have no public jobs API
  and forbid scraping. Use the **Job collector** extension (one click on a job page), **AI search**,
  or **Add Job** (paste URL + JD).
- **Claude / Gemini in Chrome** can't be started by the app (Chrome blocks it), so AI search with
  them needs one paste; the Job collector runs fully on its own.
- **Custom career sites.** Companies whose careers page is their own system (no Greenhouse, Lever,
  Workday… board) cannot be scanned; some sites also block automated requests.
- **Private Google Sheets.** In-app sheet import needs a sheet shared as *Anyone with the link → Viewer*.
  Private sheets can be downloaded as CSV and imported.
- **Ideas:** a Celery worker for very large re-analysis runs, S3 storage, calendar sync for interviews.

---

<div align="center">

Built to take the chaos out of a job search.

</div>
