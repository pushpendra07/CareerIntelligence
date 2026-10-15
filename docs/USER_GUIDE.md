# User guide — starting from scratch

A step-by-step walk through the web app (http://127.0.0.1:5173) for a brand-new setup:
from an empty database to scored jobs, applications and interviews.

> First install and start the app: see the README → *Run locally* (`./start.sh`).
> Everything below happens in the browser; nothing needs an API key.

**Look and layout:** the ☰ button at the top left hides the menu so lists use the full screen
width (remembered; on a phone it opens the menu as a panel). The ☀ / ☾ / 🖥 switch at the top
right picks a **light**, **dark** or **same as my computer** theme (remembered in this browser).

**The menu** has six entries; related pages are tabs at the top of each one:

| Menu | Tabs |
|---|---|
| **Today** | Today (your dashboard) · Insights (analytics) |
| **Jobs** (number = new jobs to review) | Review new · All jobs · Companies |
| **Pipeline** | Applications · Interviews · Offers · Recruiters |
| **Follow-ups** (number = due today or late) | — |
| **My profile** | Profile · Target roles · CVs · Question bank |
| **Settings** | — |

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

**My profile → CVs** → *Upload a CV*.

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

> Uploading or activating a CV changes job scores (the best CV may change). Scores update by
> themselves in the background within a minute; jobs show *updating* until then.

## 2. Review your Professional Profile

**My profile → Profile** (what you *are*). This is what jobs are scored against, so correct it.

| Section | Fields |
|---|---|
| **Identity** | Name, Headline, Email, Phone, LinkedIn, Location, Summary |
| **Skills & experience** | Total experience (yrs), Relevant experience (yrs), Leadership experience (yrs), Primary roles, Core skills, Additional skills, Domains, Leadership, Certifications, Achievements |
| **Projects (from CV)** | Projects read from the CV, used for interview prep |

Tips:
- **Core skills** weigh most in matching — keep them to what you really use (e.g. Magento 2,
  Adobe Commerce, PHP, MySQL, GraphQL, AWS).
- Years matter: the experience component compares your years with each job's requirement.
- Save; scores update by themselves within a minute.

## 3. Set your Target Profile (what you want)

**My profile → Target roles**. Every score is "how well does this job fit what I want".

| Section | Fields |
|---|---|
| **Roles** | Target job titles (e.g. Technical Lead, Solution Architect, Senior Magento Developer), Required skills, Preferred skills |
| **Preferences** | Preferred domains, Preferred companies, Preferred locations, Employment types |
| **Exclusions** | Excluded roles, Excluded technologies, Excluded industries — jobs matching these are blocked |
| **Work model, experience & salary** | Remote / Hybrid / Onsite OK, Min and Max experience, Notice period (days), Minimum salary (annual), Target salary (annual), Currency |

Set the **salary targets** — until you do, salary is scored as "unknown".
Saving updates every score by itself within a minute.

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

**Jobs → Companies**.

- The list's **Jobs** column shows *open / total* jobs in the app per company; filter **Has jobs
  in the app** and sort by **Most jobs**.
- **Add** a company with the name box at the top, or bulk-import from research files
  (see README → *bulk-import companies*) or from a Google Sheet tab with a *Company Name* column.
- On a company page:
  - **Tier** (A/B/C) — how much you want to work there; it feeds the *Company* score component.
  - **Job search** checkbox — include this company in job scans.
  - **Scan jobs** — search its job board now.
  - **Run verification check** — checks the website/careers/LinkedIn links really work.
  - **Verification evidence** — every value with its source and status; add evidence by hand.
  - **Jobs in Career Intelligence** (top of the page) — this company's jobs from every source: score,
    status, location, Added via, posted date; *Open only* by default, 10 per page.
  - **Recruiters** — people linked to the company.
- A company is **scanned for jobs only if** *Job search* is on **and** its careers URL is a
  supported job board (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee,
  Pinpoint, Teamtailor). The company page shows **Job board: …** or *not detected*.
  Settings → Job scanner → **Find job boards** finds boards automatically (careers links on the
  website, SuccessFactors/Oracle sites, job data on own careers pages, the name on job boards),
  then **Turn on job search for them** includes those companies in scans.
  Full list of scanned companies: [scan-coverage.md](scan-coverage.md).
- **Find jobs for me with Google · ChatGPT · Gemini · Claude** (under the company name) searches
  the web for open jobs at that company that fit your Target Profile (titles, key skills,
  locations, experience). Gemini can't be opened with the question filled in: the button copies
  it, paste it in Gemini.

## 6. Get jobs into the app

Every way below goes through the same pipeline: duplicates are merged (one job can show
*LinkedIn ✓ Indeed ✓ Sheet ✓*), the description is parsed and the job is scored.

| Way | Where | Best for |
|---|---|---|
| **Built-in job scanner** | Settings → Job scanner → **Scan now** (or company page → Scan jobs) | Companies on supported job boards — full descriptions, 1–3 min |
| **Add Job** | Jobs → **Add Job**: paste the URL and the description → live preview → **Save & analyze** | LinkedIn, Naukri, Indeed, referrals, recruiter emails |
| **Google Sheets** | Settings → Google Sheets → **Import** | Your tracking sheets (all tabs) — see [google-sheets.md](google-sheets.md) |
| **CSV / JSON** | Settings → Import & export → import jobs | One-off lists |
| **Career-Ops** (optional) | Settings → Career-Ops → **Scan + import** / **Import now** (set up once with `./scripts/setup-career-ops.sh`) | Career-Ops' own company list in `career-ops/portals.yml` (no AI, no tokens) |

Job scanner setup (once): Settings → Job scanner → *What to keep*:
titles to keep (e.g. magento, adobe commerce, php), generic titles that need your stack in the
description, titles to skip (intern, sales…), locations to keep (india, remote, your cities) and
skip (other countries), maximum posting age, and **Scan automatically every N hours** (e.g. 24).

Google Sheets setup (once, for private sheets): Settings → Google Sheets →
*Connect private sheets* → follow the steps (service account), then share each sheet with the
email shown as **Viewer**. Save each sheet's URL in the same panel.

## 7. Work through your jobs

- **Fastest way to triage: Jobs → Review new** (or the button on Today). It shows
  new jobs one at a time, best match first, with *Why it fits*, *Watch out for* and the job
  description. **Shortlist** (`S`), **Not relevant** (`N`), **Skip for now** (`K`),
  **Open posting** (`O`), **Undo** (`U`). Pick *Score 70+* to see only strong matches.
- **Jobs → All jobs**. Tabs: **All open · New · Pending · Applied · Interview · Selected** and,
  on the right for finished jobs, **Rejected · Not pursuing · Closed**, each with a count.
- Filters: search, status (multi-select inside a tab) and sort, then one-click buttons for
  **Score** (60+ / 70+ / 80+), **Work** (remote / hybrid / on-site), **Posted** (last 7 / 14 /
  30 days) and **Added via**. **More filters** opens exact minimum score, recommendation,
  company tier, technology, location, source, your years and applied or not. 10 jobs per page.
- **Email to HR** (job page) → **Draft email** writes a short email from the job and your
  profile: the required skills you match, your experience, one achievement, the job link and
  your signature. Pick one of the suggested subjects or type your own, edit the message, then
  **Copy subject**, **Copy message**, **Copy subject + message** or **Open in email app**.
  **Find HR email with Google · ChatGPT · Gemini · Claude** searches for publicly listed HR /
  recruiter addresses at the company (the AI tools are told not to guess addresses);
  **Polish with ChatGPT · Gemini · Claude** asks them to tighten your edited draft. Nothing is
  sent from the app. Known recruiters for the company appear as suggestions in *To*.
- **Is the job still open?** On a job, **Check if still open** asks the posting's own site
  (job-board API or the page itself) and shows *Still open*, *Closed*, *Probably closed* or
  *Couldn't tell*, with the reason. If it's closed, **Mark as closed** moves it to the Closed
  tab. Postings older than two months show *Posted N months/years ago*. LinkedIn, Indeed,
  Glassdoor and Naukri can't be checked automatically — open the posting instead.
- On a job (and on **Add Job** once title and company are filled), **Find on other portals with
  Google · ChatGPT · Gemini · Claude** looks for the same posting on LinkedIn, Naukri, Indeed,
  Glassdoor, Instahyre, Foundit and the company's careers site.
- Lists, counts and badges update by themselves after any change — no page reload needed.
- **Your sort and filters are remembered** in this browser until you change them or press
  **Reset**. A link that brings its own filters (e.g. a Dashboard card) uses those instead; your
  sort still applies.
- **Next step** on every row: **★ Shortlist** / **✕** for new jobs, **Apply** for shortlisted
  ones, **Follow up** for jobs you applied to.
- **Added via** tag on every job — how it came into the app: **Manual** (Add Job),
  **Google Sheet**, **Job scanner**, **Career-Ops** or **File import**. A job found more than
  one way shows several tags. Filter with **Added via** in the filter row.
- Columns: **ID**, Score, Job · Company, Location, Exp, Salary, **Posted** (date on the job
  site), **Added** (date it came into this app), Status, Next step. **Sort by clicking a column
  title**; click again to reverse. Search finds a job by its ID too: type `#123` or `123`.
- The line above the table explains the score colours and *no JD* (no description, so the score
  is a rough guess).
- Open a job. From top to bottom:
  - the job's key facts (including *Posted on job site* and *Added to this app*), score, status;
  - **Next step** — what to do now: *Shortlist / Not relevant* for new jobs; *Apply on the
    site* then *Record that I applied* for shortlisted ones; *Plan a follow-up* or *Got an
    interview* once applied; *Interview prep* when interviewing;
  - **Does it fit you?** — why it fits, what to watch out for, missing skills, the best CV, and
    *How the score was calculated* (full breakdown) when you want it;
  - **Job description** — with **Fetch description** when it's missing;
  - **Follow-ups** for this job (add one with *tomorrow / in 3 days / in a week*), your
    applications and interviews, comments, the recruiter;
  - **More details** (folded): seniority, skills, where it was found, notes, history,
    **Interview prep** and **Delete** (asks first; deleted jobs never come back through imports).
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
- **Follow-ups**: grouped into **Late · Today · This week · Later**. Each one links to its job
  and shows the job's status; **✓ Done**, or push it **+1 day / +3 days / +1 week**. If the job
  is already rejected or closed, it says so and offers **Dismiss**. Applying plans a follow-up
  for you; add more from the job page or **+ New reminder**.
- **Recruiters**: contacts with company, role, channel and notes; link them to jobs.

## 11. Today and Insights

- **Today** (top to bottom):
  - **Getting started** checklist — shown until your CV, profile, target roles, salary target,
    scannable companies and first jobs are all in place; each step links to where you do it.
  - **To do** — what's waiting on you, each card opens the list: **New jobs to review** (and how
    many score 70+), **Ready to apply** (shortlisted, not applied), **Follow-ups due**,
    **Interviews coming up**, and **Good jobs without a description** with
    **Fetch for 40 best jobs** (see below).
  - **Progress** — applied this week, applications, **response rate** (applications that got any
    answer), interviews, offers, open jobs.
  - **Today's priorities**, **Best new matches** (★ Shortlist / Not relevant in one click),
    **Coming up**, **Job sources** (when each source last ran, **Scan now**), CV advice.
- **Fetch missing descriptions** — reads the description from each job's own link, best scores
  first: job-board APIs (Greenhouse, Lever, SmartRecruiters, Workday), the structured job data
  many career sites publish, and Career-Ops' fetcher when it's set up. LinkedIn, Indeed,
  Glassdoor and Naukri are never read automatically (their terms forbid it) — open those and
  paste the description. Jobs whose page has no description are marked and skipped next time.
  Scores are recalculated as soon as a description arrives.
- **Insights** (tab next to Today): every chart comes with a one-line takeaway.
  - *How your search is going* — response and interview rate, the application funnel, and
    whether higher scores get more interviews.
  - *Where good jobs come from* — every source with its job count, average score, jobs scoring
    80+ and how many you applied to (click a source to see its jobs); best companies,
    locations, work model.
  - *Your matches* — score spread vs the jobs you applied to, and where scores are lost (with
    what to change).
  - *Skills* — the required skills you miss most, CV advice, most requested skills.

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
3. **Review new jobs**: shortlist the strong ones, mark the rest *Not relevant* (keys `S` / `N`).
4. Apply to shortlisted jobs with the recommended CV; add a follow-up reminder.
5. Update application and interview statuses as things happen.
6. After changing your CV or profile, scores update by themselves.

Using an AI agent instead? Say *"Find jobs for me"* — see README → *Using AI coding agents*.
