# Phase 1 — Career-Ops Architecture & Integration Assessment

Inspected: `career-ops-hq/career-ops` @ `4164109`, version **1.35.0** (cloned to `./career-ops`, unmodified).
Everything below comes from the source code, not only the docs. Where a doc and the code disagreed, the code won.

---

## 1. Technology stack

| Layer | What it actually is |
|---|---|
| Core | ~200 flat-root **Node.js ESM scripts** (`*.mjs`), Node ≥ 18.17 (≥ 22.5 for `tracker.mjs`, which uses `node:sqlite`) |
| Deps | `js-yaml`, `playwright` 1.63, `undici`, `dotenv`, `@google/generative-ai` |
| "Brain" | **Markdown prompt files** in `modes/` run by an AI coding CLI (Claude Code, Codex, Gemini…) or standalone `gemini-eval.mjs` / `openai-eval.mjs` / `ollama-eval.mjs` |
| Storage | **Plain files are canonical** (Markdown, TSV, YAML). SQLite (`data/applications.db`) is only a derived, deletable index of the tracker. ARCHITECTURE.md: files are the source of truth and the project says it will never move to a database as primary store. |
| Optional UIs | Go TUI (`dashboard/`), Next.js 16 web UI (`web/`, **alpha**) |
| Docker | One container (`tail -f /dev/null`) that you `docker compose exec` into; the project is bind-mounted |

## 2. Data root and boundaries

- **System layer** (code, `modes/`, `templates/`, `providers/`) vs. **User layer** (`cv.md`, `config/profile.yml`, `portals.yml`, `data/*`, `reports/*`, `jds/*`, `interview-prep/*`). The updater never touches user files.
- The data root can live outside the repo: `CAREER_OPS_ROOT` / `CAREER_OPS_DATA_DIR` env, or a `.career-ops-data` marker file. Tracker path can be overridden with `CAREER_OPS_TRACKER`.
- **Integration implication:** Career Intelligence only needs read access to the **data root**, never the code.

## 3. Job discovery

**`scan.mjs`** is a zero-token scanner (no LLM calls). It uses **100+ provider modules** in `providers/` (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, SuccessFactors, iCIMS, Taleo, Workable, Oracle Cloud, Phenom, Eightfold, Personio, Recruitee, RemoteOK, HN, …).

- Config: `portals.yml` → `title_filter`, `search_queries`, `tracked_companies`, `job_boards`, location filters.
- Provider contract (`providers/_types.js`): `fetch(entry, ctx) → Job[]`, where `Job = {title, url, company, location, postedAt?, description?, requisitionId?, language?}`.
- Sibling scanners: `scan-ats-full.mjs` (reverse-ATS bulk sweep), `scan-hn.mjs`, `scan-dayforce.mjs`, `scan-interamt.mjs`.
- **No Naukri, LinkedIn or Indeed scanning in core.** Sources that need a login are left out by design; they can only come in through plugins (`plugins/apify`, `plugins/gmail`). Manual entry is therefore the main way to bring in India-board jobs.
- CLI flags useful to us: `--json` (single JSON receipt on stdout), `--dry-run`, `--company X`, `--since N`, `--verify`.

`scan.mjs --json` receipt (stable, versioned):
```json
{"version":"careerops.scan.receipt@1","date":"…","scanned":0,"skipped":0,"found":0,
 "filtered":0,"duplicates":0,"added":0,"added_urls":["…"],"errors":[{"company":"…","error":"…"}],
 "unverified_zero":[],"dry_run":false}
```
Exit code is 2 when any company errored.

### Discovery outputs (what we import)

**`data/pipeline.md`** is the URL inbox:
```
## Pending
- [ ] https://jobs.ashbyhq.com/acme/790 | Acme Corp | AI Engineer | Remote (US) | 180000-220000 USD
- [ ] https://boards.greenhouse.io/acme/jobs/792 | Acme Corp | Backend Engineer | Remote (US) | posted: 2026-06-18
## Processed
- [x] #NNN | URL | Company | Role | Score/5 | PDF ✅/❌
- [x] #-- | {url} | skipped (pre-screen mismatch: {reason})
```
The section headings can be localized (for example "Pendientes").

**`data/scan-history.tsv`** has one row per posting seen. It is append-only, positional, and has 14 columns declared in `lib/scan-history-columns.mjs`:
`url, first_seen, portal, title, company, status, location, fingerprint, posted_at, trust_score, trust_flags, normalized_company, requisition_id, language`.
Older rows can be shorter than newer ones, and the file header may be stale. Parse by declared column order, and treat missing cells as empty.
Status values: `added`, `skipped_title`, `skipped_location`, `skipped_age`, `skipped_dup`, `skipped_expired`, `cooldown:…`, and others.

**Key gap: the scanner does not store JD text.** It keeps only a 64-bit SimHash fingerprint of the JD. To get the full JD:
- `node fetch-jd.mjs <url>` prints the JD on stdout (exit 0), or exits 1 with empty output. It works for Greenhouse, Lever, Ashby, Workday and SmartRecruiters through their public JSON APIs. It writes nothing.
- `node browser-extract.mjs <url> --mode jd` returns `{url,title,text}` JSON and needs Playwright.
- Evaluated jobs carry the **verbatim JD inside the report** (`## Job Description (archived verbatim)`), which the project requires.

## 4. Evaluation / scoring

- Run by an LLM following `modes/oferta.md` + `modes/_shared.md`. The report has blocks A–H: role summary, CV match, level, comp, customization, interview plan, legitimacy, and draft answers.
- **Score: 1–5, a "holistic judgment… no arithmetic formula"** across 5 dimensions (CV match, North Star alignment, Comp, Culture, Red flags). It is **not deterministic** and has no weights. Thresholds: ≥4.5 strong, 4.0 apply line, <3.5 recommend against.
- Output: `reports/{NNN}-{company-slug}-{YYYY-MM-DD}.md`. The header has `**Score:** X/5`, `**URL:**`, `**Archetype:**`, `**Legitimacy:**`, `**Work Auth:**`. It is followed by a **`## Machine Summary` YAML fence**; the schema's source of truth is `batch/batch-prompt.md`:
  `company, role, score, legitimacy_tier, archetype, final_decision (Apply|Consider|Research first|Skip), hard_stops[], soft_gaps[], top_strengths[], risk_level, confidence, score_evidence{…}, next_action, work_auth, discard_reasons[], via, company_confidential, advertised_comp, reports_to, requirement_importance[{requirement, jd_signal, evidence, importance, match}], risk_summary{…}`.
- This lines up directly with spec §35. We store it as `career_ops_score`, `career_ops_evaluation` (the parsed YAML) and `career_ops_report` (path plus markdown), and **never** convert it into the 0–100 score.

## 5. Application tracker

- `data/applications.md` is a Markdown table: `# | Date | Company | Role | Score | Status | PDF | Report | Notes` plus optional `Via`, `Location`, `URL` columns. Headers can be localized; the aliases are in `tracker-aliases.json`.
- Canonical states (`templates/states.yml`): `Evaluated, Applied, Responded, Interview, Offer, Hired, Rejected, Discarded, SKIP`.
- Writes go through `merge-tracker.mjs` (TSV files in `batch/tracker-additions/`) and `set-status.mjs`, with locks and atomic writes. Status history is recorded in `data/status-log.tsv`.
- Read API: `node tracker.mjs query [--status …] [--company …] --json`. It re-syncs the SQLite index automatically before answering.

## 6. CV / profile

| File | Content |
|---|---|
| `cv.md` | Canonical CV in Markdown |
| `config/profile.yml` | `candidate{…}`, `target_roles{primary[], archetypes[{name,level,fit}]}`, `narrative`, `compensation{target_range, currency, minimum}`, `location{country, city, authorized_in[], needs_sponsorship}`, `language`, `spend_tier` |
| `modes/_profile.md` | Narrative archetypes and targeting prose |
| `data/career-profile.yml` | Source-backed master profile (`schema_version: 1`, experiences/projects/education/certs/skills), written only after user review |
| `documents/` + `intake.mjs` | Local text extraction from the master CV, LinkedIn export, and similar sources |

Career Intelligence keeps its **own** CV and profile models (§8–10 of the spec). Career-Ops profile files can optionally be imported once as a seed.

## 7. Other relevant modules

| Area | Career-Ops artifact |
|---|---|
| Interviews | `data/active-interviews.md`, `interview-prep/{company}-{role}.md`, `interview-prep/story-bank.md`, `interview-prep/sessions/*.md` (Q/A transcripts with competency tags) |
| Follow-ups | `data/follow-ups.md` (`num, appNum, date, company, role, channel, contact, notes`), `followup-cadence.mjs` |
| Contacts | `data/contacts.tsv` (third-party PII, gitignored) |
| Offers | `data/offers/*` (PII) |
| Salary | `data/salary-observations.tsv` |
| Blacklist | `data/blacklist.md` |
| Dedup logic | `url-key.mjs` (URL normalization, aggregator posting IDs for LinkedIn/Indeed), `fingerprint-core.mjs` (SimHash), `tracker-parse.mjs` (req-id regex) |

## 8. Integration options evaluated

| Option | Verdict | Why |
|---|---|---|
| **Read files from the data root** | ✅ **Primary** | Files are the documented canonical, stable contract. The project changes them in additive, append-only ways and keeps them backward compatible. A read-only mount means we cannot damage Career-Ops. |
| **Run Career-Ops CLIs as subprocesses** (`scan.mjs --json`, `fetch-jd.mjs`, `tracker.mjs query --json`) | ✅ **Secondary** (sync + JD enrichment) | These have documented, machine-readable output. This is the public interface Career-Ops already offers to the AI CLIs. Needs Node, and Playwright for `--verify` or browser-extract. |
| `web/` Next.js API routes | ❌ Reject | Alpha, no versioned contract. Requests are limited to loopback by an origin/host guard and cross-origin calls are refused, so they would not work from a Docker backend without changing Career-Ops settings. Several routes have side effects. |
| Plugin `export` hook | ⏸ Later, optional | Only pushes a read-only **tracker** snapshot (not the pipeline or scan history), and the user has to enable it. |
| Importing Career-Ops JS modules directly | ❌ Reject | Couples us to internal functions in a flat root that changes often. |
| Writing into Career-Ops (TSV additions, `set-status.mjs`) | ❌ Not in v1 | Would make two systems responsible for application state. Career Intelligence owns applications from now on. |
| Re-implementing providers in Python | ❌ Reject | Duplicates discovery, which goes against the spec. |

## 9. Recommended integration design

```
backend/app/integrations/career_ops/
  config.py           # CAREER_OPS_PATH (code root), CAREER_OPS_DATA_PATH (data root), node binary, timeouts
  readers/
    pipeline.py       # pipeline.md → PendingItem / ProcessedItem (tolerant line parser)
    scan_history.py   # scan-history.tsv → ScanHistoryRow (14-column declared order, short rows OK)
    reports.py        # reports/*.md → header fields + Machine Summary YAML + archived JD
    tracker.py        # applications.md → TrackerRow (header aliases), read-only
  runner.py           # subprocess wrapper: scan --json, fetch-jd <url>; allowlisted args, timeout, no shell
  mapper.py           # Career-Ops records → NormalizedJobInput (+ CareerOpsEvaluation)
  service.py          # import/sync orchestration, idempotent, records ImportRun
```

**Import flow (idempotent):**
1. Read `scan-history.tsv` rows with `status=added`, the `pipeline.md` Pending and Processed sections, `reports/*.md`, and `applications.md`.
2. Join them on the **normalized URL**, using the same rules as `url-key.mjs`: drop tracking params, lowercase the host, drop the trailing slash, keep `#/job/{id}` fragments, extract LinkedIn and Indeed posting IDs. Use `requisition_id` as a secondary key.
3. Send each record through the **same** pipeline as manual jobs: normalize → dedup → JD parse → 0–100 match. Career-Ops becomes a `job_sources` row with `source=CAREER_OPS` and keeps its portal, `first_seen`, `posted_at`, trust score/flags and fingerprint.
4. Find the JD in this order: the report's archived JD, then `fetch-jd.mjs` (optional and rate-limited), then status `JD_MISSING` so the user can paste it.
5. If there is a report, attach `career_ops_score` (float 1–5), `career_ops_evaluation` (YAML as JSONB), `career_ops_report_path`, `career_ops_legitimacy` and `career_ops_archetype`.
6. Store the tracker status as `career_ops_status` for reference only. It is **not** mapped onto our job status automatically.
7. Record an `ImportRun` with counts, errors and file hashes, so re-runs touch only what changed.

**Sync trigger:** `POST /api/v1/career-ops/sync` runs `node scan.mjs --json` (when enabled) and then the import. The command is configurable so it can run:
- on the host, with Career-Ops checked out locally (default in dev), or
- inside Career-Ops' own container (`docker compose exec career-ops node scan.mjs --json`).
This is the **only** write that happens in Career-Ops, and it is Career-Ops' own normal behavior (appending to its pipeline and scan history). It is off unless `CAREER_OPS_SCAN_ENABLED=true`.

**Docker:** mount the Career-Ops data root into the backend **read-only** (`:ro`). Running scans needs Node, so the scan runner stays outside the Python image in v1.

## 10. Status mapping (reference only, used for an initial import)

| Career-Ops | Career Intelligence |
|---|---|
| Evaluated | REVIEWING |
| Applied | APPLIED |
| Responded | RECRUITER_CONTACTED |
| Interview | INTERVIEW |
| Offer | OFFER |
| Hired | ACCEPTED |
| Rejected | REJECTED |
| Discarded | CLOSED |
| SKIP | NOT_RELEVANT |

## 11. Risks and gaps

1. **No JD in scan output.** Enrichment is needed. `fetch-jd.mjs` covers the big ATSs; everything else needs Playwright or a paste.
2. **No India job boards in core** (Naukri, LinkedIn, Indeed). Manual entry (spec §16) is essential, not optional.
3. **The 1–5 score is non-deterministic.** Keep it separate, as the spec already requires.
4. **Format drift.** Mitigations: parse columns by name or declared order, tolerate unknown or missing columns, pin a tested Career-Ops version (1.35.0), and contract-test against Career-Ops' own `test-fixtures/` plus synthetic fixtures.
5. **Concurrent writes.** Career-Ops writes atomically (temp file + rename) under locks, so reading a snapshot is safe. We never write.
6. **PII.** `contacts.tsv` and `data/offers/*` hold third-party or personal data. Import them only on explicit opt-in.
7. **Node version.** `tracker.mjs` needs Node ≥ 22.5. Our tracker reader parses the Markdown directly, so it does not depend on this.

## 12. Decision

**File-based, read-only adapter as the primary integration, plus an opt-in subprocess runner for `scan.mjs --json` and `fetch-jd.mjs`.** No changes to Career-Ops, no use of its web API, no write-back in v1.
