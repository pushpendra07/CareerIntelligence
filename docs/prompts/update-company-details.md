# Prompt: research and update every company (Jobs · Tier · Verification · India · Careers)

Copy everything below the line into Antigravity (or Gemini CLI, Claude Code, any agent that can
browse the web and run shell commands) opened in the `career-intelligence` folder. To continue
in a later session, say: *"Continue docs/prompts/update-company-details.md"* — the progress
ledger (`scratch/company-progress.tsv`) remembers which companies are done.

---

You are working in the **Career Intelligence** repo (read `AGENTS.md` first). The app runs locally:
API `http://127.0.0.1:8010/api/v1`, UI `http://127.0.0.1:5173`. If the API doesn't answer, run
`./start.sh --no-open` from the repo root. Never use or stop anything on port 8000.

## Goal

The **Companies** page shows these columns for every company:

| Column | What it is | How you change it |
|---|---|---|
| **Jobs** | Open / total jobs for this company in the app | Only by **scanning** (Step 5). Never add jobs by hand. |
| **Tier** | A / B / C — how much the user wants to work there | `PATCH` the company, **only if it has no tier yet** (Step 4) |
| **Verification** | Status + 0–100 score, **computed by the app** from evidence | Add evidence (Step 3); the app recomputes it |
| **India** | India presence (Yes/No) and India office cities | Evidence for `india_presence` and `india_locations` |
| **Careers** | Careers page / job-board URL (the link text is the detected ATS) | Evidence for `careers_url` |

For every company, research the official facts on the web, save them as **evidence with a source
URL**, and let the app recompute Verification. You can't set the Verification status directly — it
follows the evidence:

- **VERIFIED** = website **and** careers URL both verified on official sources.
- **PARTIALLY_VERIFIED** = at least one field verified / partially verified.
- **RESEARCHED / DISCOVERED** = only unconfirmed data. **NEEDS_REVIEW** = conflicting values.
- **STALE** = was verified more than 180 days ago — re-check it.
- Score weights: website 25, careers URL 25, LinkedIn 15, India presence 15, headquarters 10,
  industry 5, employee range 5 (VERIFIED counts 100%, PARTIALLY_VERIFIED 60%, RESEARCHED 30%).

## Step 1 — Get the work list (resumes where the last session stopped)

The helper script reads **every** company from the API (no page limit), works out what each one
is missing and keeps a progress ledger, so each session continues where the last one stopped:

```bash
python3 scripts/company_queue.py status            # totals: done, left, per group
python3 scripts/company_queue.py next --count 20   # the next batch, best first
```

Each line: `ID | name | status score | jobs open/total | tier | missing: … | website`.
The order is: companies with **Job search on** → companies with **jobs** in the app → **tiered**
companies → all others. Inside each group the worst status comes first (NEEDS_REVIEW, STALE,
DISCOVERED, RESEARCHED, PARTIALLY_VERIFIED). VERIFIED companies that only miss small details
come last. Companies set to `REJECTED` / `INVALID` by the user are never in the queue.

When a company is finished, **log it** (this removes it from the queue):
```bash
python3 scripts/company_queue.py log <ID> DONE "website+careers verified, Greenhouse board"
python3 scripts/company_queue.py log <ID> SKIPPED "two companies named X, can't tell which"
python3 scripts/company_queue.py log <ID> NEEDS_USER "acquired by Y in 2024, site redirects to y.com"
```
`SKIPPED` and `NEEDS_USER` need a reason. Log every company you looked at, even if you saved
nothing, so the next session doesn't repeat it.

**Session size:** do **5 batches of 20** (100 companies), then stop and report (Step 6). The user
starts the next session with: *"Continue docs/prompts/update-company-details.md"*.

Before researching one company, read what it already has:
```bash
curl -s http://127.0.0.1:8010/api/v1/companies/<ID> | python3 -m json.tool
```
Look at `sources` (existing evidence). Don't re-add a value that is already VERIFIED. Older
imported evidence often has a search summary instead of a page in `source_url` — that is not
proof; check the value yourself.

## Step 2 — Research one company

1. **Identify the right company.** Use the name, `website`, `industry` and any India locations
   already saved. Several companies share names — industry, country and offices must match. If you
   aren't sure it's the same company, skip it and say why.
2. Find, on **official sources first**:
   - **website** — the company's own homepage.
   - **careers_url** — start from the website's Careers link and follow *View jobs / Openings /
     Apply* to where jobs are listed. Prefer a supported job-board URL (Greenhouse, Lever, Ashby,
     SmartRecruiters, Workday, Workable, Recruitee, Pinpoint, Teamtailor, SAP SuccessFactors,
     Oracle Cloud — URL formats in `docs/prompts/find-company-job-boards.md`), otherwise the
     company's own careers page that lists jobs.
   - **linkedin_url** — the company page `https://www.linkedin.com/company/<slug>` (link it from
     the official website when possible).
   - **india_presence / india_locations** — from the official *Contact / Offices / Locations*
     page, or India job postings on the official careers page. Cities as plain names
     (`Bengaluru, Pune, Hyderabad`).
   - **headquarters** (`City, Country`), **industry** (short, e.g. `IT Services & Consulting`,
     `E-commerce Platform`), **employee_range** (`1-50`, `51-200`, `201-500`, `501-1000`,
     `1001-5000`, `5001-10000`, `10001+`).
3. **Open every URL you save** — it must load and belong to this company. Look at the page
   itself (browser or fetch); never save a URL you only guessed from the name or the domain.
4. **Same company, not a relative.** A parent's, subsidiary's or sister brand's job board is
   not this company's board (e.g. `nttglobaldatacenters.wd5…` is NTT's data-centre business, not
   NTT DATA). The board's company name and its jobs must match. If the company was acquired or
   renamed, log `NEEDS_USER` with what you found instead of saving the new owner's data.

Not usable as sources or URLs: LinkedIn job pages, Naukri, Indeed, Glassdoor, Instahyre,
AmbitionBox, Wellfound, Cutshort, other job aggregators, Google search links, PDFs, and
AI-generated summaries. Wikipedia / Crunchbase / news may be used only as `SECONDARY` (Step 3).

## Step 3 — Save the facts as evidence

One call per field:
```bash
curl -s -X POST http://127.0.0.1:8010/api/v1/companies/<ID>/evidence \
  -H 'Content-Type: application/json' \
  -d '{"field": "<FIELD>",
       "value": "<VALUE>",
       "source_kind": "<KIND>",
       "verification_status": "<STATUS>",
       "source_url": "<page where you saw this value>",
       "note": "<agent> <YYYY-MM-DD>: <how you found it>"}' \
  | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('error') or (c['verification_status'], c['verification_score']))"
```

| Field | Value format |
|---|---|
| `website` | `https://www.example.com` |
| `careers_url` | the jobs page / job-board URL |
| `linkedin_url` | `https://www.linkedin.com/company/<slug>` |
| `india_presence` | `"true"` or `"false"` (as a string) |
| `india_locations` | comma-separated cities: `"Bengaluru, Pune"` |
| `headquarters` | `"Amsterdam, Netherlands"` |
| `industry` / `company_type` / `employee_range` / `legal_name` | short text |

`source_kind`: `OFFICIAL_WEBSITE` (company's site), `OFFICIAL_CAREERS` (its careers page),
`OFFICIAL_ATS` (its job board), `OFFICIAL_LINKEDIN` (its LinkedIn company page), `SECONDARY`
(Wikipedia, Crunchbase, reputable news).

`verification_status`:
- `VERIFIED` — you saw the value on the company's **own** website / careers page / job board.
- `PARTIALLY_VERIFIED` — clearly this company, but from LinkedIn or a secondary source.
- `RESEARCHED` — found, but you couldn't confirm it.

Rules for evidence:
- `source_url` is **required** for VERIFIED and PARTIALLY_VERIFIED.
- Set `india_presence` to `"false"` **only** when the official offices/locations page lists its
  offices and India isn't among them. If you can't tell, leave it unknown — don't save anything.
- If the official value differs from what's saved, save the official one as VERIFIED and mention
  the old value in the report. Never save a weaker value over a VERIFIED one.
- After saving, run the app's own live check, which re-fetches the website and careers page:
  `curl -s -X POST http://127.0.0.1:8010/api/v1/companies/<ID>/check | python3 -m json.tool`

## Step 4 — Tier (only companies without one)

Tier means how much the user wants to work there, so **never change an existing tier**. For
companies with **no tier**, first learn the user's standard from companies already tiered:
```bash
for t in TIER_A TIER_B TIER_C; do echo "== $t"; curl -s "http://127.0.0.1:8010/api/v1/companies?tier=$t&size=100" \
  | python3 -c "import json,sys; [print(' ',c['name'],'|',c['industry'],'|',c['company_type']) for c in json.load(sys.stdin)['items']]"; done
curl -s http://127.0.0.1:8010/api/v1/preferences | python3 -m json.tool
```
Then give an untiered company the tier of the most similar tiered companies (same kind of
business, tech stack, size, India presence). Leave it untiered if nothing is clearly similar.
```bash
curl -s -X PATCH http://127.0.0.1:8010/api/v1/companies/<ID> \
  -H 'Content-Type: application/json' -d '{"tier": "TIER_B"}'
```
Write the reason for every tier you set in the report (e.g. "Adobe Commerce agency, like 18th
DigiTech (Tier A)"). Tiers feed job scores, so be conservative.

## Step 5 — Jobs (let the app find them)

The Jobs column fills only from real postings found by the app. After each batch:
```bash
# Detect job boards for the companies you updated
curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/detect-boards \
  -H 'Content-Type: application/json' -d '{"company_ids": [ID1, ID2, ...], "wait": true}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']); [print(r['company'],'|',r.get('provider'),'|',r.get('board') or r.get('error') or 'no board') for r in d['companies']]"

# Scan each company that already has Job search ON and a board
curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/companies/<ID>/scan
```
**Don't turn Job search on yourself.** List companies with a found board but Job search off
(`boards_not_searched` in `GET /api/v1/scanner/status`) for the user to decide.

## Step 6 — Report (after every batch)

Append to `scratch/company-update-<YYYY-MM-DD>.md` (git-ignored) and show it to the user. Facts
only — one row per company, no summaries like "systematically elevated":

| ID | Company | Verification before → after | Fields saved | India | Careers (ATS) | Tier set (reason) | Jobs open/total | Outcome / notes |
|---|---|---|---|---|---|---|---|---|

Plus: companies skipped and why, `NEEDS_USER` companies, conflicts found (old vs official value),
companies with a board but Job search off, and the output of
`python3 scripts/company_queue.py status` (done, left).

## Rules (must follow)

- **Never invent** a URL, city, headcount, tier reason or job. Unknown stays unknown — leave the
  field empty rather than guess. Only save what you opened and saw.
- Only change data through the API calls above. **Don't edit code**, the database directly,
  `career-ops/` (the user's Career-Ops data), or the Google Sheets.
- Don't delete or merge companies or evidence; don't change existing tiers, Job search on/off,
  hiring status, or `verification_override`.
- Don't commit anything to git, and never put personal data (CVs, `.env`, keys, sheet IDs) in
  any file or message.
- Go slowly on websites (one company at a time, no bulk crawling); stop and tell the user if a
  site asks for a login or a CAPTCHA.
- Research first, then save. Don't write a batch script full of values before you have opened
  the pages; a small helper that takes the values as arguments is fine. Keep TLS checks on.
- If you're unsure about a value, save it as `RESEARCHED` (or not at all), never as `VERIFIED`.
