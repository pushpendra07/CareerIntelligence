# Google Sheets — adding jobs and companies from sheets

The app keeps a list of **saved sheets** (Settings → Google Sheets, `GET /api/v1/sheets`).
Each can be imported again at any time; rows already in the app are merged, never duplicated,
and jobs the user deleted are skipped.

Sheet IDs/URLs are stored in the app's database, not in git — get them from
`GET http://127.0.0.1:8010/api/v1/sheets` (`id` = app id, `spreadsheet_id` = Google ID, `url`).

## The saved sheets (snapshot 2026-10-09)

| App id | Sheet | Tab | Holds | Data rows | Imports as |
|---|---|---|---|---|---|
| 1 | Claude Sheet – Job Hunt – Seen Jobs | `Seen Jobs (Claude Sheet)` | Jobs found by an AI job hunt | 10 (rows 2–11) | jobs |
| 2 | Magento & Adobe Commerce Jobs Tracker | `Job Tracker` | Main job list | 388 (rows 2–389) | jobs |
| 2 | 〃 | `Tracked Jobs` | One tracked job (row 58) | 1 | jobs |
| 2 | 〃 | `Target Companies` | Companies to target | 189 + 1 placeholder (rows 2–191) | companies |

Row counts grow over time: compare with the sheet before importing and send only new rows
for big tabs (re-sending old rows is safe, just slower).

### Columns per tab

**Seen Jobs (Claude Sheet):** `job_url, title, company, location, source, date_posted,
date_found, match_score, base_resume, tailored_resume_link, status, find_job_link (stable),
apply_contact / notes`

**Job Tracker:** `Category, Match Score, Job Title, Company, Location, Workplace Type,
Experience Req, Salary / CTC, Key Match Factors, Posted Age, Application Link, Status`

**Tracked Jobs:** same idea as Job Tracker (ID column like `JOB-057`, company…).

**Target Companies:** `Company Name, Careers URL, ATS / Platform, Location / Coverage,
Notes / Verification Status`. Most careers URLs here are **Google-search links**
(`https://www.google.com/search?q=…+careers`); the app marks those INVALID — they never make
a company scannable. The last row is a `[Additional 150+ companies …]` placeholder and is skipped.

## How rows are mapped

Column names are matched case-insensitively with punctuation removed
(`"Application Link"` → `application_link`, `"apply_contact / notes"` → `apply_contact_notes`).

### Job rows (a tab is "jobs" when it has a title column)

| Job field | Accepted columns (first non-empty wins) |
|---|---|
| Title (required) | `title`, `job_title`, `role`, `position` |
| Company (required) | `company`, `company_name`, `employer` |
| URL | `url`, `source_url`, `application_link`, `job_url`, `link`, `apply_link` |
| Location | `location`, `city` |
| Work model | `work_model`, `workplace_type`, `workplace`, `work_mode` |
| Experience | `experience_req`, `experience`, `experience_required` (+ `experience_min/max`) |
| Salary | `salary_ctc`, `salary`, `ctc`, `compensation` (+ `salary_min/max/currency`) |
| Posted date | `posting_date`, `date_posted`, `posted_on`, or a date inside `posted_age` |
| Description | `original_jd`, `jd`, `description`, `job_description` |
| Skills | `required_skills`, `preferred_skills` (separated by `,` `;` `|`) |
| Notes | `notes`, `apply_contact_notes`, `apply_contact`, `contact`; plus `Tailored resume:`, `Base resume:`, `Find job:` links, `category`/`match_score`, `key_match_factors`, `posted_age` |
| Status | `status` (mapping below) |

Status mapping: `resume-ready` / `ready…` → Ready to apply · `skipped…` → Not relevant ·
`expired` / `closed` → Closed · `to apply` → New · `discovered` · `new` · `shortlisted` ·
`applied` · `interview` · `rejected` · `not relevant` → same status · anything else → New.

The sheet's own `match_score` is kept in the notes; the app computes its own 0–100 score.
A URL shared by rows of different jobs (a search/listing page) is kept but not used to identify
the job.

### Company rows (a tab is "companies" when it has a company-name column and no title column)

| Company field | Accepted columns |
|---|---|
| Name (required) | `name`, `company_name`, `company` |
| Careers URL | `careers_url`, `careers_page` |
| Website / LinkedIn / HQ / industry / type / size / legal name | `website`, `linkedin_url`, `headquarters`, `industry`, `company_type`, `employee_range`, `legal_name` |
| India locations | `india_locations`, or parsed from `location_coverage` / `location` (e.g. `Global, India (Jaipur)`) |
| Tier / priority | `tier`, `priority` |
| Notes | `notes`, `notes_verification_status` |
| ATS name | `ats_platform` (kept as research info) |
| Job search on | `job_search_enabled` (`yes/true/1`) — if the column is missing, job search is left as is |
| Evidence URL | `source_url` (makes the values RESEARCHED instead of DISCOVERED) |

Imported company values are evidence ("claims") — they never overwrite verified data.

## Adding companies from a sheet **so they get searched for jobs**

Importing a company row does **not** make it scannable by itself (Target Companies has Google
search links and no job-search column). For each company the user wants searched:

1. Import the row (so the company exists).
2. Follow `.agent/workflows/add-company-for-scanning.md`: find the company's real job board,
   verify it returns jobs, set it as the careers URL with `job_search_enabled: true`, confirm
   `GET /api/v1/scanner/companies/{id}/board` is not null, scan, and report jobs.
3. Companies on unsupported systems stay unscannable — report them; their jobs come from the
   job tabs or Add Job.

## Ways to import

| Situation | How |
|---|---|
| Sheet shared "Anyone with the link → Viewer" | Settings → Google Sheets → **Import** (`POST /api/v1/sheets/{id}/import`; first tab or the tab in the URL's `gid`) |
| Private sheet (both saved sheets are private) | An agent reads the rows with a Google Sheets/Drive connector and POSTs them: `.agent/workflows/import-google-sheets.md` |
| A one-off tab | Download as CSV → Settings → Import & export |
| New sheet | Settings → Google Sheets → paste URL → Save sheet (`POST /api/v1/sheets {"url","title"}`) |

Never edit the Google Sheets themselves.
