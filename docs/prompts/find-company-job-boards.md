# Prompt: find careers pages and job boards for pending companies

Copy everything below the line into Gemini (Antigravity, Gemini CLI, or any agent that can browse
the web and run shell commands) opened in the `career-intelligence` folder.

---

You are working in the **Career Intelligence** repo (read `AGENTS.md` first). The app runs locally:
API `http://127.0.0.1:8010/api/v1`, UI `http://127.0.0.1:5173`. If the API doesn't answer, run
`./start.sh --no-open` from the repo root. Never use or stop anything on port 8000.

## Goal

Many companies in the app can't be scanned for jobs because the app doesn't know their careers page
or job board (ATS). For each **pending** company, find its **official** careers page or job-board
URL on the web, check it, and save it in the app. Then let the app's own board finder and scanner
take over.

## Step 1 — Get the pending companies (two groups, do group A first)

**A. Job search ON but not scannable** (most important):
```bash
curl -s http://127.0.0.1:8010/api/v1/scanner/status \
  | python3 -c "import json,sys; [print(c['id'], '|', c['name'], '|', c['careers_url']) for c in json.load(sys.stdin)['not_scannable']]"
```
These have a careers URL, but it's the company's own site and no supported board was found on it.
Look for the job board behind it (the "Apply" / "View openings" links usually go to one).

**B. No careers URL at all:**
```bash
for p in $(seq 1 8); do curl -s "http://127.0.0.1:8010/api/v1/companies?size=100&page=$p"; echo; done \
  | python3 -c "
import json,sys
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    for c in json.loads(line)['items']:
        if not c['careers_url']: print(c['id'], '|', c['name'], '|', c['website'] or '-', '|', ', '.join(c['india_locations'] or []))"
```
Work in batches of 25. Skip companies marked `REJECTED` / `INVALID`.

## Step 2 — Find the official URL (for each company)

1. Start from the company's own website (`website` above, or search "<company name> careers").
   Make sure it's the **right company**: name, country/India offices, and industry must fit
   (several companies share names — e.g. "Unified Infotech" is not "Unified Life Insurance").
2. Open the careers page and follow **View jobs / Openings / Apply** to where jobs are listed.
3. Prefer, in this order:
   - a **supported job board** URL (the scanner reads these directly):

     | Board | URL looks like |
     |---|---|
     | Greenhouse | `https://job-boards.greenhouse.io/<slug>` or `boards.greenhouse.io/<slug>` |
     | Lever | `https://jobs.lever.co/<slug>` |
     | Ashby | `https://jobs.ashbyhq.com/<slug>` |
     | SmartRecruiters | `https://jobs.smartrecruiters.com/<slug>` or `careers.smartrecruiters.com/<slug>` |
     | Workday | `https://<tenant>.wd<N>.myworkdayjobs.com/<site>` |
     | Workable | `https://apply.workable.com/<slug>` |
     | Recruitee | `https://<slug>.recruitee.com` |
     | Pinpoint | `https://<slug>.pinpointhq.com` |
     | Teamtailor | `https://<slug>.teamtailor.com` |
     | SAP SuccessFactors | `*.successfactors.com/...career...`, `*.jobs2web.com`, or the company's own SuccessFactors careers domain |
     | Oracle Cloud | `https://<tenant>.fa.<region>.oraclecloud.com/hcmUI/CandidateExperience/en/sites/<site>` |

   - otherwise the company's **own careers page** that lists the jobs.
4. **Check it**: open the URL — it must load, belong to this company, and (for a board) show the
   company's own jobs. A board with zero jobs is fine only if it clearly is this company's board.
5. If you can't find an official page, or you're not sure it's the same company: **skip it** and
   note why. Never guess a slug or build a URL that you didn't see working.

Not usable (don't save these as careers URLs): LinkedIn, Naukri, Indeed, Glassdoor, Instahyre,
AngelList/Wellfound, Cutshort, or any other job aggregator; Google search links; PDFs.

## Step 3 — Save it in the app

For each company found, add the URL as evidence (this keeps where it came from):
```bash
curl -s -X POST http://127.0.0.1:8010/api/v1/companies/<ID>/evidence \
  -H 'Content-Type: application/json' \
  -d '{"field": "careers_url",
       "value": "<THE URL>",
       "source_kind": "OFFICIAL_ATS",
       "verification_status": "VERIFIED",
       "source_url": "<page where you found the link, e.g. the company careers page>",
       "note": "Found by Gemini: linked from the official careers page"}'
```
- `source_kind`: `OFFICIAL_ATS` for a job-board URL, `OFFICIAL_CAREERS` for the company's own
  careers page.
- `verification_status`: `VERIFIED` only when you opened the link from the company's own website;
  `PARTIALLY_VERIFIED` when you found it another way (search) but it clearly is this company.
- If the company has no website saved and you found its official one, also save it the same way
  with `"field": "website"`, `"source_kind": "OFFICIAL_WEBSITE"`.
- To check what a company has now: `curl -s http://127.0.0.1:8010/api/v1/companies/<ID>`.

## Step 4 — Let the app check and use them

After each batch:
```bash
# Find the boards for the companies you just updated (runs live checks; IDs comma-separated)
curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/detect-boards \
  -H 'Content-Type: application/json' -d '{"company_ids": [ID1, ID2, ...], "wait": true}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']); [print(r['company'], '|', r.get('provider'), '|', r.get('board') or r.get('error') or 'no board found') for r in d['companies']]"
```
Then read the status again (`/scanner/status`): `boards_not_searched` lists companies with a found
board but **Job search** off. **Do not turn job search on yourself** — list them for the user, who
decides (Settings → Job scanner → *Turn on job search for them*). To scan only companies that
already have Job search on: `curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/run -H 'Content-Type: application/json' -d '{}'`.

## Step 5 — Report

Write a short report to `scratch/job-board-search-<date>.md` (git-ignored; create the folder if
needed) and show it to the user:

| ID | Company | URL saved | Kind (board / careers page) | Board found by app? | Notes |
|---|---|---|---|---|---|

plus: companies skipped and why, and totals (checked, saved, now scannable).

## Rules (must follow)

- **Never invent** a company, URL, slug or job. Only save links you opened and saw working.
- Only change data through the API calls above. **Don't edit code**, the database directly,
  `career-ops/` (the user's Career-Ops data), or the Google Sheets.
- Don't delete companies or evidence, and don't change Job search on/off, tiers or statuses.
- Don't commit anything to git, and never put personal data (CVs, `.env`, keys, sheet IDs) in
  any file or message.
- Go slowly on websites (one company at a time, no bulk crawling); stop and tell the user if a
  site asks for a login or a CAPTCHA.
