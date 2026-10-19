# Prompt: find companies that hire people in India for my stack and add them (no duplicates)

Copy everything below the line into Antigravity (or Gemini CLI / Claude Code) opened in the
`career-intelligence` folder. The agent needs web access and a terminal.

---

You are working in the **Career Intelligence** repo (read `AGENTS.md` first, then
`.agent/workflows/add-company-for-scanning.md`). The app runs locally: API
`http://127.0.0.1:8010/api/v1`, UI `http://127.0.0.1:5173`. If the API doesn't answer, run
`./start.sh --no-open` from the repo root. Never use or stop anything on port 8000.

## Goal

Find companies — Indian **or foreign** — that **hire people based in India** for **my stack
only**, and add each one to the app **once** — never a duplicate of a company that is already there. Where possible, make
each new company **scannable** (verified job board + job search on) so its jobs reach the app.
The real goal is jobs: a company with a verified job board is worth more than five without one.

**My stack (the only technologies that count):** PHP, Magento 1, Magento 2, Magento, Adobe
Commerce, Laravel, WordPress, and PHP frameworks (Symfony, CodeIgniter, CakePHP, Yii,
Zend / Laminas, Slim, Phalcon).

## Rules

- **Never invent anything**: no guessed URLs, slugs, offices, sizes or facts. Unknown stays empty.
- **Hires people in India.** The company can be from any country. Add it only if at least one
  is true, with a source you opened (a job posting from the last 6 months, or an official
  careers / contact page):
  - **India office**: it has an engineering / delivery office in India that hires (Indian
    companies, and foreign companies with Indian development centres);
  - **Remote from India**: it posts remote roles open to candidates in India ("Remote — India",
    "Remote — APAC incl. India", "worldwide / anywhere" with no country restriction, or hiring
    in India through an employer-of-record / contractor model);
  - **Relocation**: it hires India-based engineers for roles abroad with visa sponsorship or
    relocation stated in the posting.
  Out: companies whose remote roles are limited to other countries ("US only", "EU only",
  "LATAM only"), roles abroad without sponsorship, and sales-only Indian offices.
- **Stack evidence required.** At least one source you opened shows the company works in my
  stack: a current or recent job posting for it, an official Adobe / Magento partner listing,
  or the company's own services / technology page. Generic "we do web development" is not
  enough.
- **No duplicates** — do the check in Step 3 for every company, every time.
- Don't change verified data of existing companies. Don't delete or merge companies; report
  suspected duplicates instead.
- Don't stop processes you didn't start. Don't commit anything.

## Step 1 — Download the companies already in the app

```bash
for p in $(seq 1 20); do
  curl -s "http://127.0.0.1:8010/api/v1/companies?size=100&page=$p&sort=id"; echo
done | python3 -c "
import json, sys
rows = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    items = json.loads(line).get('items', [])
    for c in items:
        rows.append('\t'.join(str(x or '') for x in (
            c['id'], c['name'], ', '.join(c.get('aliases') or []), c.get('website'),
            c.get('careers_url'), c.get('job_search_enabled'))))
open('/tmp/ci_companies.tsv', 'w').write('\n'.join(rows))
print(len(rows), 'companies saved to /tmp/ci_companies.tsv')"
```

Keep this list open; you will check every candidate against it.

## Step 2 — Find candidate companies (work in batches of 20)

Look for these kinds of companies, from any country, that hire people in India as defined above:

1. Adobe Commerce / Magento solution partners and agencies — Indian ones, and foreign ones with
   Indian delivery centres or remote hiring from India.
2. E-commerce, retail, D2C and B2B brands (in India or abroad) that run their own Magento /
   Adobe Commerce or PHP platforms and hire engineers in India or remotely from India.
3. PHP / Laravel / WordPress / PHP-framework product and service companies worldwide that hire
   in India or remote from India.
4. IT-services and consulting firms with a Magento / Adobe Commerce / PHP practice in India.
5. Remote-first companies and global hiring platforms' clients that state they hire in India
   for my stack (the employer, not the platform or recruitment agency).

Where to look:
- The official Adobe Solution Partner directory (filter: Adobe Commerce, India).
- Job boards: LinkedIn Jobs, Naukri, Indeed India, Foundit, Instahyre — search my stack terms
  ("Magento", "Magento 2", "Adobe Commerce", "PHP", "Laravel", "WordPress", "Symfony",
  "CodeIgniter", "CakePHP", "Yii", "Laminas", "Phalcon") with "India" or an Indian city, and
  note the employers that post them (not the recruitment agencies).
- Remote job boards: LinkedIn (location "India", remote filter), Wellfound, We Work Remotely,
  Remote OK, Working Nomads, Himalayas, Remotive — same stack terms; keep only postings that
  accept candidates in India.
- "Visa sponsorship" / "relocation" + stack terms on LinkedIn and company careers pages, for
  the relocation type.
- Clutch / GoodFirms lists for Magento, Adobe Commerce, Laravel, WordPress and PHP in India —
  only as leads; confirm each company on its own website.
- Company websites: services / technology pages, careers pages, contact / office pages.

For each candidate collect, from pages you actually opened:
`name, legal name (if shown), website, careers URL, LinkedIn URL, headquarters (any country),
how it hires in India (India office / remote from India / relocation), India cities (if it has
offices), company type (product / services / agency / brand), employee range, stack evidence
(URL + which technology), India-hiring evidence (URL)`.

## Step 3 — Duplicate check (for every candidate)

A candidate is a **duplicate** if any of these matches a company in `/tmp/ci_companies.tsv` or
the app:

1. **Same website domain** (ignore `www.`, `http/https`, paths): this is the strongest test.
   ```bash
   curl -s "http://127.0.0.1:8010/api/v1/companies?q=<domain without www>" | python3 -m json.tool | head -30
   ```
2. **Same name** after removing legal endings and spacing: "Pvt Ltd", "Private Limited",
   "Limited", "Ltd", "LLP", "Inc", "LLC", "Corp", "Technologies", "Solutions", "Infotech",
   "Software", "Services", "India", punctuation and "&" vs "and". Search two or three variants:
   ```bash
   curl -s "http://127.0.0.1:8010/api/v1/companies?q=<short name>" | python3 -m json.tool | head -30
   ```
3. **Brand vs legal name or old name**: the candidate's legal name, former name, or brand name
   matches an existing company's name or aliases (the search above also searches aliases).
4. **Parent / subsidiary written as one company** (e.g. "<Brand> (<Group>)" vs "<Brand>"): treat
   as the same company unless the Indian entity hires separately with its own careers page.
5. Also check the candidates found in **this run** against each other.

If it is a duplicate:
- Do **not** create it.
- If the existing company lacks a careers URL / job board and you found a **verified** one,
  you may fill it (Step 4b) — only empty fields, never overwrite existing values.
- List it in the report as "already in app: #<id> <name> (matched by domain / name / alias)".

## Step 4 — Save

**a. New company** (only after Step 3 says it's new):
```bash
curl -s -X POST http://127.0.0.1:8010/api/v1/companies -H 'Content-Type: application/json' -d '{
  "name": "<Name as the company writes it>",
  "legal_name": "<legal name if shown, else omit>",
  "website": "<https://official site>",
  "careers_url": "<job board URL if verified (Step 5), else the official careers page>",
  "linkedin_url": "<company LinkedIn URL if found>",
  "headquarters": "<City, Country>",
  "india_presence": <true only if it has an office in India, else false>,
  "india_locations": ["<Indian office cities, only if it has offices; else omit>"],
  "company_type": "<Product | Services | Agency | Brand>",
  "employee_range": "<as shown, e.g. 201-500>",
  "industry": "<e.g. IT Services, E-commerce, Retail>",
  "notes": "Hires in India via: <India office | remote from India | relocation>. Stack: <technologies> — <stack evidence URL>. India hiring: <evidence URL>.",
  "source_url": "<the page that proves the main facts>",
  "job_search_enabled": <true only if Step 5 verified a supported job board, else false>
}'
```
- A `409` reply ("already exists") means it is a duplicate: don't retry with a changed name;
  record it as a duplicate.
- Omit any field you couldn't confirm. Don't set a tier unless I asked.

**b. Fill a missing job board on an existing company:**
```bash
curl -s -X PATCH http://127.0.0.1:8010/api/v1/companies/<id> -H 'Content-Type: application/json' \
  -d '{"careers_url":"<verified board URL>","job_search_enabled":true,"source_url":"<page where you found it>"}'
```

## Step 5 — Make it scannable (follow `.agent/workflows/add-company-for-scanning.md`)

1. From the official careers page, follow "View jobs / Openings / Apply" to the job board.
   Supported boards and URL patterns: `docs/scan-coverage.md` (Greenhouse, Lever, Ashby,
   SmartRecruiters, Workday, Workable, Recruitee, Pinpoint, Teamtailor, SuccessFactors, Oracle).
2. Verify the board returns jobs **before saving** (public API; 404 or HTML = wrong slug), e.g.
   `curl -s https://boards-api.greenhouse.io/v1/boards/<slug>/jobs | python3 -c "import json,sys; print(len(json.load(sys.stdin)['jobs']))"`
3. After saving, confirm the scanner sees it — must not be `null`:
   `curl -s http://127.0.0.1:8010/api/v1/scanner/companies/<id>/board`
   If `null`, try the app's board finder:
   `curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/detect-boards -H 'Content-Type: application/json' -d '{"company_ids":[<id>],"wait":true}'`
4. Companies on an unsupported system (own site, Zoho, Keka, Darwinbox, iCIMS, Taleo…): keep
   `job_search_enabled: false`, save the real careers page, and list them in the report as
   "add jobs via Google Sheet / Add Job".

## Step 6 — Scan the new scannable companies once

After the batch, run one scan instead of one per company:
```bash
curl -s -X POST http://127.0.0.1:8010/api/v1/scanner/run -H 'Content-Type: application/json' -d '{}'
curl -s http://127.0.0.1:8010/api/v1/scanner/status | python3 -m json.tool | head -40   # repeat until finished
```
Then list new jobs for each added company:
`curl -s "http://127.0.0.1:8010/api/v1/jobs?company_id=<id>&closed=false&sort=-match_score" | python3 -m json.tool`

## Step 7 — Report (short)

1. **Added** — table: id · name · country · hires in India via (office / remote / relocation) ·
   stack · scannable (board) yes/no · jobs found.
2. **Already in the app (skipped)** — candidate → existing #id, matched by domain / name / alias.
   Mark any existing company you filled a job board for.
3. **Rejected** — name · reason (doesn't hire in India / remote limited to other countries /
   no stack evidence / couldn't verify).
4. **Not scannable** — added companies whose jobs must come from the sheet or Add Job.
5. **Suspected duplicates already in the app** (two existing companies that look like one) —
   list them for me; don't merge.
6. If `docs/scan-coverage.md` coverage changed, add the new scannable companies there.
