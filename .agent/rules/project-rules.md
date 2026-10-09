---
trigger: always_on
description: Core rules for working in the Career Intelligence repo
---

# Career Intelligence — always-on rules

Full guide: `AGENTS.md` at the repo root. Read it before making changes.

- Every job enters through `job_service.ingest_job(db, JobInput)`; never insert `Job` rows directly.
- Commits are authored only by the repository owner (configured git identity). Never add
  `Co-Authored-By`, "Generated with …" or any AI/agent attribution to commits or PRs.
- Never commit personal data: `.env`, CVs/PDFs, `storage/`, `backend/.devdb/`, `.run/`, exports,
  real names, emails or phone numbers. Run `git status` before committing.
- Ask the user before pushing, force-pushing, rewriting history or deleting data.
- Never write to the external Career-Ops folder (`CAREER_OPS_PATH`); it is read-only.
- Never invent jobs, companies, salaries or verification results.
- Port 8000 belongs to another local app: never stop it. Don't kill processes you didn't start.
- New database table → model + export in `models/__init__.py` + Alembic migration.
- Outbound HTTP only through `core.http.safe_get` / `safe_request`.
- No browser `alert/confirm/prompt` in the UI; use inline confirmations.
- Before saying work is done, run the checks in `.agent/workflows/run-checks.md` and report
  real results.
- When asked to find/search jobs, deliver real job postings (title, company, score, link) using
  `.agent/workflows/find-jobs.md` — not just a list of companies. Never invent jobs or links.
- When adding companies, make them scannable (verified job-board URL + job search on) and scan
  them: `.agent/workflows/add-company-for-scanning.md`. Coverage list: `docs/scan-coverage.md`.
- Importing from Google Sheets: `.agent/workflows/import-google-sheets.md` and
  `docs/google-sheets.md`. Never edit the sheets; never commit sheet IDs or sheet contents.
