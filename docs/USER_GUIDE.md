# User guide — starting from scratch

A step-by-step walk through the web app (http://127.0.0.1:5173) for a brand-new setup:
from an empty database to scored jobs, applications and interviews.

> First install and start the app: see the README → *Run locally* (`./start.sh`).
> Everything below happens in the browser; nothing needs an API key.

## Contents

1. [Upload your CV](#1-upload-your-cv)
2. [Review your Professional Profile](#2-review-your-professional-profile)
3. [Set your Target Profile (what you want)](#3-set-your-target-profile-what-you-want)
4. [Check the scoring settings](#4-check-the-scoring-settings-optional)
5. [Add companies](#5-add-companies)
6. [Get jobs into the app](#6-get-jobs-into-the-app)
7. [Work through your jobs](#7-work-through-your-jobs)
8. [Apply and track applications](#8-apply-and-track-applications)
9. [Interviews, prep and the question bank](#9-interviews-prep-and-the-question-bank)
10. [Offers, follow-ups and recruiters](#10-offers-follow-ups-and-recruiters)
11. [Dashboard and analytics](#11-dashboard-and-analytics)
12. [Settings reference](#12-settings-reference)
13. [Backups, exports and starting over](#13-backups-exports-and-starting-over)
14. [Daily routine](#14-daily-routine)

---

## 1. Upload your CV

Sidebar → **CVs** → *Upload a CV*.

| Field | What to enter |
|---|---|
| **File** | PDF, DOCX, TXT or Markdown (max 10 MB). PDFs must contain selectable text — scanned images can't be read (no OCR). |
| **Name** | A label, e.g. `Tech Lead – Magento` |
| **Target role** | The role this CV is for, e.g. `Technical Lead` (optional) |

Click **Upload**. The app stores the file (in `storage/`, never in git), extracts the text and
parses it. Open the CV to see:

- **Parsed profile** — name, contact, experience years, roles, skills (with years), domains,
  certifications, projects, achievements, as read from the CV. Check it — parsing is good but
  not perfect.
- **Versions** — upload an improved file with **Add version**; older versions are kept and
  you can **compare** two versions.
- **Activate** — the *active* CV is the default one recommended for jobs. With several CVs
  (e.g. *Senior Developer* and *Tech Lead*), each job gets the best-fitting CV recommended.
- **Archive** — hide a CV you no longer use (its history stays).
- **Applications using this version** — which applications were sent with it.

Then fill your profile from it:

- **Merge into profile** — adds what the CV contains to your profile, keeping what you already
  edited. Use this normally.
- **Replace profile from CV** — overwrites the profile with this CV's data (use on a fresh start
  or a major rewrite).

**Improve your CV** (bottom of the CVs page; summary on the Dashboard) compares the skills your
open jobs ask for with your profile and your active CV:

- **Add to your CV** — skills you have (on your profile) that jobs ask for but your CV doesn't
  mention. Add them to your CV's skills and projects, then upload the new version.
- **Skills your jobs ask for that you don't have yet** — ranked by how many jobs require them.
- Buttons per skill: **I have it — add to my skills** (adds it to your profile and re-scores jobs),
  **Add to job search** (adds it to Target Profile → preferred skills, so jobs using it score
  higher), **Which jobs?** (examples) and **Hide** (stop suggesting it; *show* brings it back).
- Only jobs with a description list their skills — add descriptions for better advice.

> Uploading or activating a CV marks all job scores **stale** (the best CV may change).
> Re-analyze from the Dashboard afterwards (step 7).

## 2. Review your Professional Profile

Sidebar → **Profile** (what you *are*). This is what jobs are scored against, so correct it.

| Section | Fields |
|---|---|
| **Identity** | Name, Headline, Email, Phone, LinkedIn, Location, Summary |
| **Skills & experience** | Total experience (yrs), Relevant experience (yrs), Leadership experience (yrs), Primary roles, Core skills, Additional skills, Domains, Leadership, Certifications, Achievements |
| **Projects (from CV)** | Projects read from the CV, used for interview prep |

Tips:
- **Core skills** weigh most in matching — keep them to what you really use (e.g. Magento 2,
  Adobe Commerce, PHP, MySQL, GraphQL, AWS).
- Years matter: the experience component compares your years with each job's requirement.
- Save, then check the yellow *stale* hint on the Dashboard.

## 3. Set your Target Profile (what you want)

Sidebar → **Target Profile**. Every score is "how well does this job fit what I want".

| Section | Fields |
|---|---|
| **Roles** | Target job titles (e.g. Technical Lead, Solution Architect, Senior Magento Developer), Required skills, Preferred skills |
| **Preferences** | Preferred domains, Preferred companies, Preferred locations, Employment types |
| **Exclusions** | Excluded roles, Excluded technologies, Excluded industries — jobs matching these are blocked |
| **Work model, experience & salary** | Remote / Hybrid / Onsite OK, Min and Max experience, Notice period (days), Minimum salary (annual), Target salary (annual), Currency |

Set the **salary targets** — until you do, salary is scored as "unknown".
Saving marks scores stale; re-analyze afterwards.

## 4. Check the scoring settings (optional)

Settings → **Scoring**. The 0–100 score is the weighted sum of 9 components:

| Component | Default weight |
|---|---|
| Skills | 25 |
| Role / title | 20 |
| Experience | 15 |
| Domain | 10 |
| Location | 10 |
| Seniority | 5 |
| Salary | 5 |
| Company (tier) | 5 |
| Other | 5 |

You can change weights (must total 100), recommendation thresholds (Highly recommended ≥ 90,
Recommended ≥ 80, Consider ≥ 70, Low priority ≥ 60), company-tier factors, and which
**hard rules** force "Not recommended" (minimum experience, mandatory technology, location,
excluded role/technology/industry…). **Save as new version** keeps the old version for history
and marks scores stale. Every job page shows the breakdown and the reasons.

## 5. Add companies

Sidebar → **Companies**.

- **Add** a company with the name box at the top, or bulk-import from research files
  (see README → *bulk-import companies*) or from a Google Sheet tab with a *Company Name* column.
- On a company page:
  - **Tier** (A/B/C) — how much you want to work there; it feeds the *Company* score component.
  - **Job search** checkbox — include this company in job scans.
  - **Scan jobs** — search its job board now.
  - **Run verification check** — checks the website/careers/LinkedIn links really work.
  - **Verification evidence** — every value with its source and status; add evidence by hand.
  - **Jobs**, **Recruiters** — everything linked to the company.
- A company is **scanned for jobs only if** *Job search* is on **and** its careers URL is a
  supported job board (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee,
  Pinpoint, Teamtailor). The company page shows **Job board: …** or *not detected*.
  Settings → Job scanner → **Find job boards** looks for boards on careers pages automatically.
  Full list of scanned companies: [scan-coverage.md](scan-coverage.md).

## 6. Get jobs into the app

Every way below goes through the same pipeline: duplicates are merged (one job can show
*LinkedIn ✓ Indeed ✓ Sheet ✓*), the description is parsed and the job is scored.

| Way | Where | Best for |
|---|---|---|
| **Built-in job scanner** | Settings → Job scanner → **Scan now** (or company page → Scan jobs) | Companies on supported job boards — full descriptions, 1–3 min |
| **Add Job** | Sidebar → Add Job: paste the URL and the description → live preview → **Save & analyze** | LinkedIn, Naukri, Indeed, referrals, recruiter emails |
| **Google Sheets** | Settings → Google Sheets → **Import** | Your tracking sheets (all tabs) — see [google-sheets.md](google-sheets.md) |
| **CSV / JSON** | Settings → Import & export → import jobs | One-off lists |
| **Career-Ops** (optional) | Settings → Career-Ops → **Scan + import** / **Import now** | If you also use Career-Ops (no AI, no tokens) |

Job scanner setup (once): Settings → Job scanner → *What to keep*:
titles to keep (e.g. magento, adobe commerce, php), generic titles that need your stack in the
description, titles to skip (intern, sales…), locations to keep (india, remote, your cities) and
skip (other countries), maximum posting age, and **Scan automatically every N hours** (e.g. 24).

Google Sheets setup (once, for private sheets): Settings → Google Sheets →
*Connect private sheets* → follow the steps (service account), then share each sheet with the
email shown as **Viewer**. Save each sheet's URL in the same panel.

## 7. Work through your jobs

- **Re-analyze stale scores** first if the Dashboard shows *Re-analyze N stale*.
- Sidebar → **Jobs**. Tabs: **All open · New · Pending · Applied · Interview · Selected ·
  Rejected · Not pursuing · Closed**, each with a count.
- Filters: search, minimum score, status (multi-select inside a tab) and sort are always shown;
  **More filters** opens recommendation, company tier, technology, location, work model, source,
  posted after, your years, applied or not and outdated scores. 20 jobs per page.
- **Sort by clicking a column title** (Score, Job, Company, Location, Exp, Salary, Posted,
  Status); click again to reverse. ▲/▼ shows the current order.
- The **score legend** under the filters explains the colours (90+ excellent … below 60 poor),
  *stale* (re-analyze) and *no JD* (no description, less certain score).
- Open a job to see:
  - **Match** — score, recommendation, the 9-component breakdown with reasons, blockers,
    confidence, recommended CV;
  - **Parsed requirements** and the **Original job description**;
  - **Sources** (every place this job was found), **Recruiter**, **Notes**, **Activity**;
  - **Career-Ops evaluation** if it came from Career-Ops.
- Actions on a job: change **status** (New → Reviewing → Shortlisted → Ready to apply…),
  **Re-analyze**, **Interview prep**, **Apply**, **Delete** (asks first; deleted jobs never come
  back through imports), **Fetch via Career-Ops** when the description is missing.
- A posting taken down → set status **Closed**; it moves to the Closed tab.

## 8. Apply and track applications

On a job → **Apply** (*Record application*): the **CV version** you sent (the recommended one is
pre-selected), **Method** (portal, email, referral…), **Expected CTC**, **Notice period (days)**
and **Notes**.
This creates an **Application** (sidebar → Applications) and moves the job to *Applied*.

On an application: update its status (Applied → Screening → Interview → Offer / Rejected /
Withdrawn), see its **History**, and add **follow-ups** (reminders).

## 9. Interviews, prep and the question bank

- **Interviews** (sidebar): schedule a round — **Job**, **Round**, **Date & time**, **Duration**,
  **Mode** (video / phone / onsite), **Interviewer(s)**, **Meeting link**, **Topics**, **Notes** —
  then **Record outcome** (result, **Feedback / notes**, **Next round**). Upcoming interviews
  appear on the Dashboard.
- **Interview prep** (job page or interview page): job requirements, *your fit*, likely topics,
  technical and behavioral preparation, projects to discuss, CV highlights, questions from your
  bank, and questions to ask them. *AI-suggested questions* appear only if an AI provider is set.
- **Question Bank** (sidebar): save questions — **Question**, **Category**, **Technology**,
  **Round**, **Difficulty**, **Expected answer**, **My answer** — and filter/search them. Matching
  questions are shown again in Interview prep for similar jobs.

## 10. Offers, follow-ups and recruiters

- **Offers**: *Record an offer* for a **Job** (CTC, **Joining date**, **Offer expires**,
  **Work model**, **Benefits**); negotiate (**Counter CTC**, **Negotiation note**); accept or
  decline with **Decision notes**; and *Compare open offers* side by side.
- **Follow-ups**: *New reminder* — **What**, **Kind** (recruiter, application, interview…),
  **Due** date, **Notes**. Overdue ones show on the Dashboard.
- **Recruiters**: contacts with company, role, channel and notes; link them to jobs.

## 11. Dashboard and analytics

- **Dashboard** (top to bottom):
  - **Getting started** checklist — shown until your CV, profile, target roles, salary target,
    scannable companies and first jobs are all in place; each step links to where you do it.
  - **Jobs** and **Your pipeline** numbers — click any number to open those jobs/applications.
  - **Best new matches to review** — your top new jobs scoring 70+ that you haven't applied to;
    **★ Shortlist** or **Not relevant** in one click, without opening each job.
  - **Today's priorities** — interviews, overdue follow-ups, strong jobs to apply to.
  - **Coming up** — next interviews and follow-ups due.
  - **Job sources** — new jobs in the last 7 days, when the scanner / Google Sheets /
    Career-Ops last ran, and **Scan now**.
  - **Insights** — charts: jobs by score, source, location; top skills; your skill gaps.
- **Analytics**: funnels, *where scores are lost* (average component fit), interview rate by
  score band, most-requested skills and your **skill gaps** (required skills you miss most).

## 12. Settings reference

| Panel | What it does |
|---|---|
| **Job scanner** | Scan now, Find job boards, coverage, last run details, filters and schedule |
| **Google Sheets** | Saved sheets, Import, private-sheet connection (service account) |
| **Scoring** | Weights, thresholds, tier factors, hard rules (versioned) |
| **Career-Ops integration** | Import now, Scan + import, status (optional) |
| **Notifications** | Follow-up reminders, interview reminder hours |
| **AI providers** | Optional AI for summaries/questions (`AI_PROVIDER` in `backend/.env`; costs tokens) |
| **Import & export** | CSV/JSON import of jobs or recruiters; export any list or everything |

## 13. Backups, exports and starting over

- **Export**: Settings → Import & export → export jobs, companies, applications… as CSV/JSON,
  or **export everything**.
- Your data lives in `backend/.devdb/` (database) and `storage/` (CV files). Back up both
  folders while the app is stopped (`./stop.sh`).
- **Start completely fresh** (deletes all your data!): `./stop.sh`, then delete
  `backend/.devdb/` and `storage/`, then `./start.sh`. The app creates an empty database.
  Export first if you may want anything back.

## 14. Daily routine

1. Open the **Dashboard** → do **Today's Priorities**.
2. If the scanner isn't scheduled: Settings → Job scanner → **Scan now**; import new sheet rows.
3. **Jobs → New** tab, sorted by score: open the strong ones, shortlist or mark *Not relevant*.
4. Apply to shortlisted jobs with the recommended CV; add a follow-up reminder.
5. Update application and interview statuses as things happen.
6. After changing your CV or profile, **Re-analyze**.

Using an AI agent instead? Say *"Find jobs for me"* — see README → *Using AI coding agents*.
