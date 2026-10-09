# Career Intelligence — Architecture

Career Intelligence finds jobs (built-in scanner, manual entry, imports, optional Career-Ops) and
manages the career. This is a modular
monolith: React → FastAPI → PostgreSQL. No Redis or worker is needed at this scale. Large
re-analysis runs use FastAPI background tasks, and Celery can be added later behind the same
service functions.

```
React (Vite, TanStack Query) ──/api/v1──▶ FastAPI ──▶ PostgreSQL
                                             │
                     ┌───────────────────────┼─────────────────────────┐
                     ▼                       ▼                         ▼
           Career data (CVs,       Job pipeline + 0-100        Career-Ops adapter
           profile, companies,     matching engine             (read-only files,
           applications…)                                      optional CLI runner)
                                                                       │
                                                                       ▼
                                                         ~/…/careerops (unmodified)
```

## Backend layout (`backend/app`)

| Package | Responsibility |
|---|---|
| `api/v1/` | Thin routers. One module per area, and no business logic. |
| `services/` | Business logic and transactions (`*_service.py`). |
| `models/` | SQLAlchemy 2 models. `alembic/versions/` holds the migrations. |
| `schemas/` | Pydantic v2 request/response models and validation. |
| `cv/` | File validation, text extraction (PDF/DOCX/TXT/MD) and the deterministic CV parser. |
| `jobs/` | Deterministic JD parser and dedup identity rules. |
| `skills/catalog.py` | One skill/domain taxonomy (aliases, parent, related). Used by the CV parser, the JD parser and the matching engine. |
| `matching/` | **The one matching engine**: `engine.py` (pure) and `config.py` (every number). |
| `companies/` | Field-level verification model, URL checker and importers. |
| `integrations/career_ops/` | Readers for Career-Ops' files, import service and allowlisted runner. |
| `interviews/prep.py` | Deterministic interview-prep pack. |
| `ai/` | Optional provider abstraction (Anthropic, OpenAI-compatible/Ollama, Gemini). |
| `storage/` | Write-once, content-addressed file storage (local; S3-ready interface). |
| `core/` | Config, structured logging, errors, pagination, URL/text helpers, guarded HTTP. |

## One pipeline for every job

Manual entry, Career-Ops import and CSV/JSON import all call `job_service.ingest_job`:

1. **Normalize**: canonical URL (same rules as Career-Ops' `url-key.mjs`), source detection
   (LinkedIn, Naukri, Indeed, Glassdoor, Greenhouse, Lever, Workday, SmartRecruiters,
   SuccessFactors, Ashby, other ATS, company careers), posting ID, company matching.
2. **Deduplicate**, first match wins:
   - same normalized URL
   - same source and posting ID
   - same company, title and compatible location, posted within 60 days
   - similar title and near-identical JD

   It never merges two different requisition IDs, or two different IDs from the same
   aggregator. A duplicate adds a `job_sources` row, so one job lists every place it was seen.
3. **Parse the JD** (`jobs/jd_parser.py`). This is deterministic and works per section and
   per sentence:
   - required vs preferred skills
   - per-skill years
   - experience range
   - salary (LPA, lakhs, k, monthly)
   - work model and locations
   - certifications and qualifications
   - blocker constraints

   The original JD is stored verbatim, and fields the user typed (`manual_fields`) always win
   over parsed values.
4. **Score** with the matching engine and store the result in `job_matches` (history). The
   latest score is copied onto `jobs` for filtering and sorting.

## Matching engine

`score_match(JobFacts, ProfileFacts, TargetFacts, ScoringConfig) -> MatchResult` is pure: no
database, clock, randomness or AI.

| Component | Default weight | Basis |
|---|---|---|
| Role | 20 | Title vs target titles and profile roles. Role families (developer, lead, architect, manager). Technology named in the title. Penalty for a foreign discipline (QA, data, security…). Architect only when enabled. |
| Skills | 25 | Each JD skill classified EXACT / PARTIAL / RELATED / MISSING / NICE_TO_HAVE using the catalog hierarchy (Magento 2 ⇒ Magento). 80% required, 20% preferred. Partial credit if the JD asks for more years of a skill than you have. |
| Experience | 15 | Relevant years vs the JD range: UNDER_QUALIFIED / GOOD_MATCH / OVER_QUALIFIED, with a leadership check. |
| Domain | 10 | JD and company domains vs profile domains, related domains, and preferred domains. |
| Location | 10 | Work model (remote/hybrid/onsite allowed?) and preferred cities (aliases, Delhi NCR). Remote roles restricted to other countries are flagged. |
| Seniority | 5 | Title level vs target levels. |
| Salary | 5 | ABOVE_TARGET / MEETS_MINIMUM / BELOW_MINIMUM. **UNKNOWN gets 0.6**, so a missing salary is not heavily penalized. |
| Company | 5 | Tier factor (A 1.0, B 0.6, C 0.2, unknown 0), or preferred company = 1.0. |
| Other | 5 | Mandatory certification, language, work authorization, notice period, travel or shift, excluded technologies. |

Points = factor × weight, rounded half-up, giving a score from 0 to 100. Recommendation
thresholds are 90 / 80 / 70 / 60.

- **Configurable:** every weight, factor, threshold and tier value lives in `ScoringConfig`,
  stored versioned in `scoring_configs` and editable in Settings. Weights must total 100.
- **Explainable:** every component returns reasons. Results also include strong matches,
  missing skills, blockers, experience/salary/location fit and a **confidence** (LOW when there
  is no JD).
- **Blockers:** detected and shown. They only force NOT_RECOMMENDED when their type is listed
  in `hard_blockers` (empty by default).
- **Deterministic:** results store `inputs_hash` (sha256 of the canonical inputs + config +
  engine + catalog versions), `score_version`, `profile_version` and `target_version`.
  Re-scoring identical inputs creates no new history row.
- **Staleness:** any change to the profile, target profile, CVs or scoring config sets
  `jobs.score_stale = true` (one UPDATE). The UI flags stale scores, and Re-analyze refreshes
  them. An old score is never presented as current.
- **Recommended CV:** the non-archived CV whose parsed skills best cover the job's skills.
  Ties go to the CV whose target role matches, then the active CV.

## Career-Ops integration (`integrations/career_ops`)

The full analysis is in [career-ops-assessment.md](career-ops-assessment.md).

- **Read-only.** It reads `data/pipeline.md`, `data/scan-history.tsv` (by the declared column
  order, so older 12-column files work), `data/applications.md` (localized header aliases),
  `reports/*.md` (header, Machine Summary YAML and the archived JD) and `jds/` captures. Docker
  mounts the folder `:ro`. A test asserts the files are byte-identical after an import.
- Records are joined by normalized URL and sent through `ingest_job` with source `CAREER_OPS`.
  Career-Ops' 1–5 score, evaluation and report are kept in `career_ops_*` columns and **never
  converted** into the 0–100 score.
- The tracker status sets the initial job status only. Applied/Interview/Offer rows become
  `applications` with origin `career_ops`.
- **Optional runner:** `node scan.mjs --json` (opt-in, `CAREER_OPS_SCAN_ENABLED`) and
  `node fetch-jd.mjs <url>`. Both are run as an allowlist with list arguments (no shell), a
  timeout and a minimal environment.
- Career-Ops' web UI API is not used: it is alpha, has no stable contract and only accepts
  requests from localhost.

## Company verification

- Every company field value is a `company_field_sources` row recording field, value, source
  kind (official website > careers > LinkedIn > ATS > secondary > aggregator > import >
  manual), source URL, status and verified-at.
- The displayed value is the best-supported usable claim. Values that fail validation
  (a "LinkedIn" URL that isn't `linkedin.com/company/`) are stored as INVALID and never shown.
  An official 404 disproves that value everywhere, unless a later check verifies it again.
- Company status and the 0–100 verification score are derived, never typed in:
  - VERIFIED needs a verified website **and** careers page
  - STALE after 180 days
  - PARTIALLY_VERIFIED, NEEDS_REVIEW (conflicting unverified URLs), RESEARCHED, DISCOVERED
  - the user can override with REJECTED / INVALID / NEEDS_REVIEW
- The automated check fetches the website and careers URL through an SSRF-guarded fetcher
  (public IPs only, re-checked on every redirect). It never fetches LinkedIn.

## Data model (main tables)

| Area | Tables |
|---|---|
| CVs & profile | `cvs`, `cv_versions` (immutable; original file plus parsed JSON), `professional_profiles` and `target_profiles` (single row, versioned) |
| Companies | `companies`, `company_field_sources`, `contacts` |
| Jobs | `jobs`, `job_sources`, `job_matches`, `scoring_configs` |
| Pipeline | `applications`, `application_events`, `followups`, `interviews`, `interview_questions`, `offers` |
| System | `career_ops_imports`, `activity_logs` (audit trail), `app_settings` |

## Security

- Uploads: extension allowlist, signature check (`%PDF-`, DOCX zip with `word/document.xml`,
  UTF-8 text), size limit, sanitized filenames. Files are stored content-addressed with mode
  0600 and never served inline (`attachment`, `nosniff`).
- All SQL goes through SQLAlchemy (bound parameters). Pydantic validates all input. URL fields
  only accept http(s), so `javascript:` is rejected.
- React escapes all rendered text, and there is no `dangerouslySetInnerHTML`. External links
  use `rel="noopener noreferrer"`.
- CORS is limited to the configured origins. In development the UI proxies `/api`, so the
  browser never needs CORS.
- Secrets come only from env / `.env` (gitignored). `SecretStr` keeps them out of reprs, the
  logger redacts secret-like keys, and settings endpoints never return keys.
- CSV exports neutralize formula injection (`=`, `+`, `-`, `@`).
- Job text sent to AI is fenced as untrusted data. AI output is validated and only ever
  returned as suggestions.

## Performance

- Indexes on status, score, posting date, company, normalized title, work model, a GIN index
  on `required_skills`, job source URL and ID uniqueness, and follow-up due dates.
- Server-side pagination everywhere (max 200 per page). Dashboard aggregation runs in SQL
  (`GROUP BY`, `jsonb_array_elements`).
- Re-analysis runs in batches of 200 with a commit per batch. Large runs go to a background
  task.
- The frontend is code-split per route (largest chunk about 112 kB gzipped).


## Built-in job scanner (`app/scanner/`)

- `providers.py`: one connector per public job-board API (Greenhouse, Lever, Ashby,
  SmartRecruiters, Workday, Pinpoint, Recruitee, Workable, Teamtailor RSS) and
  `resolve_board()`, which maps a careers URL to a board. Connectors never touch the database.
- `filters.py`: title/JD/location/age rules, stored in `app_settings.data.scanner`.
- `service.py`: `run_scan()` fetches boards in a small thread pool, then ingests kept jobs one
  company at a time through `ingest_job` (same dedup, parsing and scoring as every source) and
  re-scores them. A PostgreSQL advisory lock allows one scan at a time. `detect_boards()` reads
  careers pages for linked boards and records them as `OFFICIAL_ATS` claims.
- `runner.py`: background runs (a thread per run, its own DB session) and the optional
  every-N-hours schedule started from the FastAPI lifespan (not in tests).
- `scan_runs` table: one row per run with totals and a per-company report.
- All requests go through `safe_request`, the SSRF guard re-applied on every redirect.
