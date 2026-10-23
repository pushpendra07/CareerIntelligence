# User guide — starting from scratch

A step-by-step walk through the web app (http://127.0.0.1:5173) for a brand-new setup:
from an empty database to scored jobs, applications and interviews.

> First install and start the app: `./install.sh` (Docker, http://127.0.0.1:8010) or
> `./start.sh` (native, http://127.0.0.1:5173) — see the README.
> Everything below happens in the browser; nothing needs an API key.

**Welcome setup:** a new, empty install opens a short setup first — upload your CV, say which
roles, skills, locations and salary you want (roles and skills from the CV are suggested), paste
the careers pages or job boards of companies to watch, then scan for your first jobs. Every step
can be skipped; *Skip setup* goes straight to Today. Open it again any time with ⌘K → *Setup
guide* (or `/welcome`). The sections below explain each part in depth.

**Look and layout:** the ☰ button at the top left hides the menu so lists use the full screen
width (remembered; on a phone it opens the menu as a panel). The ☀ / ☾ / 🖥 switch at the bottom
of the menu picks a **light**, **dark** or **same as my computer** theme (remembered in this
browser). **+ Add job** is always at the top right.

**The menu** has six entries; related pages are tabs at the top of each one:

| Menu | Tabs |
|---|---|
| **Today** | Today (your dashboard) · Insights (analytics) |
| **Jobs** (number = new jobs to review) | All jobs · Companies · AI search · Review new |
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
11. [Today, Insights and Reports](#11-today-insights-and-reports)
12. [Settings reference](#12-settings-reference)
13. [Backups, exports and starting over](#13-backups-exports-and-starting-over)
14. [Daily routine](#14-daily-routine)
15. [Keyboard, phone and install](#15-keyboard-phone-and-install)

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

**Companies** (in the menu, below Jobs).

- The list's **Jobs** column shows *open / total* jobs in the app per company; filter **Has jobs
  in the app** and sort by **Most jobs**.
- **+ Add company** opens its own page (`/companies/new`): name, legal name, other names, website,
  LinkedIn page, careers page / job board, job portal pages, industry, type, employees,
  headquarters, India office and cities, the page where you found these details, and your tier,
  priority, hiring status, Job search and notes. Only the name is required. While you type the
  name it lists similar companies already in the app, so you don't add one twice.
  Or bulk-import from research files
  (see README → *bulk-import companies*) or from a Google Sheet tab with a *Company Name* column.
- **Company lists from job portals** (a Naukri company-list export; later LinkedIn, Monster,
  Foundit): Settings → Backup & import → Import a file → *Companies*. Companies already in the app
  are not duplicated — they get the portal link under **Extra links**. Naukri's rating, reviews,
  founded year and jobs page show under the company's Overview.
- **Extra links** (company page → Overview → Edit): the company's pages on job portals, one per
  line. The list's **Added** column shows when each company was added; sort by **Recently added**.
- The list filters by **industry**, **size**, **portal link** (e.g. *On Naukri*) and **Hiring**, shows
  each company's portal **rating** and **size**, and sorts by **Best rated**. Tick companies to turn
  job search on/off, set a tier or delete them (companies with jobs or recruiters are kept).
- **Possible duplicates** (button next to the title): companies whose names match once words like
  *Technologies* are left out, or that share a website. Pick the one to keep and **Merge**, or
  **Not duplicates** so they aren't suggested again.
- A company page shows its key facts and links at the top, **Find its page on** Naukri / LinkedIn /
  Foundit / Monster for links it doesn't have yet, the imported research as labelled fields, and the
  verification evidence folded away until you open it.
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
  Settings → Job board search → **Find job boards** finds boards automatically (careers links on the
  website, SuccessFactors/Oracle sites, job data on own careers pages, the name on job boards),
  then **Turn on job search for them** includes those companies in scans.
  Full list of scanned companies: [scan-coverage.md](scan-coverage.md).
- **Find jobs for me with Google · ChatGPT · Gemini · Claude** (under the company name) searches
  the web for open jobs at that company that fit your Target Profile (titles, key skills,
  locations, experience). Gemini can't be opened with the question filled in: the button copies
  it, paste it in Gemini.

## 6. Get jobs into the app

Every way below goes through the same pipeline: duplicates are merged (one job can show
*LinkedIn ✓ Indeed ✓ Sheet ✓*), the description is parsed and the job is scored. The same
company and title in another city, a repost with a new link, or a link with the same posting
ID is the same job — it is added to the job you already have (and applied to), not added again.
Jobs saved twice earlier show as **N duplicates** on the Jobs page; open it to merge them.

| Way | Where | Best for |
|---|---|---|
| **Job board search** (built-in) | Settings → Job board search → **Search now** (or company page → Search its board) | Companies on supported job boards — full descriptions, 1–3 min |
| **Job collector** (Chrome extension) | Install once: Settings → Job sources → **Chrome extension** → **Download extension (.zip)** → unzip → `chrome://extensions` → Developer mode → **Load unpacked**. On any job page click its icon → the job is added (or "Already in your list: #id") | LinkedIn, Naukri, Indeed, Foundit, Glassdoor, Instahyre, Wellfound, Cutshort, Hirist, iimjobs, company careers pages |
| **AI search** | Jobs → **AI search** → click a portal → pick the title and **Location** (one multi-select: Remote / Hybrid / Onsite and your cities; remote = anywhere in India, hybrid/onsite = each city) → **Job collector** (automatic, default) or **Claude** / **Gemini** (the portal opens with your search filled in and the prompt copied: open the assistant, paste, Enter) or **Job collector** (the extension reads up to N jobs and brings them back to be checked). Or pick portals → **Copy prompt** → give it to Claude (Chrome extension / Desktop) or Gemini; it searches in your browser and pastes the jobs into *Jobs from the assistant* → **Check** (shows new vs already saved) → **Add N new jobs**. Tagged *AI search* | LinkedIn, Naukri, Indeed, Foundit, Instahyre, Wellfound, Cutshort, Hirist, iimjobs, Glassdoor |
| **Add Job** | Jobs → **Add Job**: paste the URL and the description → live preview → **Save & analyze**. The Company box suggests your companies as you type: pick one to link the job to it; a typed name is linked to the same company ("Acme Pvt Ltd" = Acme), and a new company is added only when none matches — the line under the box says which | LinkedIn, Naukri, Indeed, referrals, recruiter emails |
| **Google Sheets** | Settings → Google Sheets → **Import** | Your tracking sheets (all tabs) — see [google-sheets.md](google-sheets.md) |
| **CSV / JSON** | Settings → Backup & import → Import a file | One-off lists |
| **Career-Ops** (optional) | Settings → Career-Ops → **Scan + import** / **Import now**, or automatically (*Run automatically*: every N hours, and import as soon as Career-Ops finds something new) — set up once with `./scripts/setup-career-ops.sh` | Career-Ops' own company list in `career-ops/portals.yml` (no AI, no tokens) |

**Import rules** (Settings → Import rules) decide which new jobs any source may save — tick
*Use import rules*, then add or remove (× on a chip) **skills a job must have** (e.g. PHP,
Magento, Magento 2, Adobe Commerce: the title or description must mention at least one),
**skills to ignore** (e.g. Java: a job mentioning one is not saved), **roles to keep** (the title
must contain one; empty = any) and **roles to ignore** (e.g. Intern). Whole words, any case
("Java" ≠ "JavaScript", "Magento 2" = "Magento2"); ignore rules win. Choose which sources the
rules apply to (all but Add Job by default) and whether jobs with no description yet are kept.
*Test a job against these rules* shows the decision before you save. Skipped jobs are counted
in each import's result ("N skipped by import rules"); jobs already in the app are never
removed or blocked.

Job board search setup (once): Settings → Job board search → *What to keep*:
titles to keep (e.g. magento, adobe commerce, php), generic titles that need your stack in the
description, titles to skip (intern, sales…), locations to keep (india, remote, your cities) and
skip (other countries), maximum posting age, and **Scan automatically every N hours** (e.g. 24).

Google Sheets setup (once, for private sheets): Settings → Google Sheets →
*Connect private sheets* → follow the steps (service account), then share each sheet with the
email shown as **Viewer**. Save each sheet's URL in the same panel.

## 7. Work through your jobs

- **Contact person:** every job page has a *Contact person* card (right column, also under
  *Contact* in the section links): **+ Add contact person** — name, role, email, phone / WhatsApp,
  LinkedIn, all optional — then **Edit** or **Remove** (removing keeps the person in Recruiters).
  Email and phone are links (mail, call, WhatsApp). Add Job has the same fields in its *Contact
  person* box. Someone you already have (same email, LinkedIn or phone) is reused, not added twice.
- **Edit a job:** on the job page click **Edit** — title, **job link** (the posting's page that
  *Open posting* uses; the old link stays under Sources), **location** (type or pick from
  your preferred locations and common cities), **work model** (**Onsite · Hybrid · Remote ·
  Not stated**), **job type** (Full-time, Contract, Contract-to-hire, Part-time, Internship,
  Freelance), experience, salary, dates, **Applied on**, description and notes. *Applied on*
  corrects the date of the job's application (automatic ones are marked "date approximate"
  until you do); on a job you haven't applied to, picking a date records the application. Only changed fields are saved,
  the job is re-scored, and your values are kept when the description is read again.
- **Apply assistant** (job page → **Apply assistant**, also in *Next step* for shortlisted jobs and
  from the preview): everything the application asks for in one place — the CV to send (download,
  or **Tailor it for this job**), a cover note (editable, **Copy**), your details and saved answers
  with **Copy** buttons (missing ones are named), **Open application page ↗**, **Email <HR>** when
  the job has a contact person (attach the downloaded CV), and **✓ I applied on the site / by
  email**, which marks the job Applied, records the application with that CV and plans a
  follow-up. **Edit saved answers** keeps what forms ask every time (current and expected CTC,
  notice period, relocation, work authorisation, current company/title, GitHub, portfolio) and
  your own questions and answers. With the **Chrome extension**, on the application page click
  its icon → **Fill this application**: empty fields are filled and the CV attached; you check
  the form and press Submit, then **I submitted it — record application**. Nothing is ever
  submitted for you.
- **Tailor your CV for a job:** on the job page → **Tailor CV** (next to Edit job), upload
  a CV (DOCX, PDF or TXT). You get an **ATS score** (0–100: required skills 50, nice-to-have 20,
  job title 15, experience 15; parts the job doesn't state are left out) and every job skill as
  *in your CV*, *you have a more specific form* (e.g. Magento 2 for Magento, ticked for you),
  *related* or *missing*. Tick only the skills you really have, then **Create tailored CV (DOCX)**:
  you get a copy of **your own file, same format**, with the ticked skills added to your Skills
  section (next to skills of the same kind), the job's skills listed first in each skill line, and
  optionally the job title in front of your headline. The score before → after and anything still
  missing is shown. Skills you don't tick are never added, so the score reaches only what your real
  experience supports. From a PDF (or TXT) you get a **Word copy**: the same text, with headings
  and bullets, in a plain layout (the PDF's design isn't copied), so check it before sending. For
  a copy that looks exactly like your CV, upload its Word version. **The CV is not saved** anywhere (no file, no database row, no backup);
  the download is the only copy. Uses the job's saved skills.
  *Not stated* hands the work model back to the description. **Add Job** has the same
  location, work model and job type choices right under the job URL.
- **Fastest way to triage: Jobs → Review new** (or the button on Today). It shows
  new jobs one at a time, best match first, with *Why it fits*, *Watch out for* and the job
  description. **Closed** (`C`), **Not relevant** (`N`), **Shortlist** (`S`), **Skip for now** (`K`),
  **Open posting** (`O`), **Undo** (`U`). Pick *Score 70+* to see only strong matches.
- **Jobs → All jobs**. One bar of tabs, grouped by stage, each with a count: **All open** ·
  *To review* **New · Pending** · *In progress* **Applied · Interview · Selected** · *Finished*
  **Rejected · Not pursuing · Closed**. **All open** is every job still in play, so its count is
  New + Pending + Applied + Interview + Selected (the same number as *Jobs* on Today).
  The page opens on **New** — jobs that just arrived, newest first (*Recently added*). Setting a
  status moves the job to its tab (Shortlist → Pending, Applied → Applied, Not relevant, Ignore or
  Duplicate → Not pursuing, Closed → Closed). **Ignore** puts a job aside for now without judging
  the fit; **Duplicate** hides a second copy of a posting you already have. Both are quick buttons
  next to *Not relevant* in the list, the preview and the job page, and always under *Most used*
  in the status menu. Search and filters apply **inside the tab you're on** (searching on
  New searches new jobs only); switch tabs to search elsewhere. Links from Today and Insights that
  carry filters open **All open**.
  Each job shows its skills; click one to add it to the **Skills** filter (click again to take
  it out). Under *More filters* → **Skills**, add several skills (Enter after each) and choose
  **Any of these** or **All of these**; tick **Exact skill only** to leave out more specific forms
  (Magento without Magento 2). Without it, a skill also finds its specific forms and any spelling
  ("php" finds PHP).
  A tab with several statuses shows a chip per status with its count (Pending: *Reviewing ·
  Shortlisted · Ready to apply · On hold*; Applied: *Applied · Recruiter contacted · Screening*);
  click one to see only that status, **All** for the whole tab.
- Filters: search, status (All open: a multi-select) and sort, then one-click buttons for
  **Score** (60+ / 70+ / 80+), **Work** (remote / hybrid / on-site), **Posted** (last 7 / 14 /
  30 days) and **Added via**. **More filters** opens exact minimum score, recommendation,
  company tier, technology, location, source, your years and applied or not. 10 jobs per page.
  **Quick views** (Top matches, Fresh this week, Not applied 70+, Remote 70+) set several filters
  at once; every active filter shows as a chip you can remove with ×.
- **In the list:** each row has **Closed** and **Not relevant** first, then the next step
  (**★ Shortlist** / **Apply**, **✓ Applied**); open posting, copy link and delete are under **⋯**. **Click a row**
  to preview the job on the right — score, why it fits, description and the same buttons — and
  move through the rows with ↑ / ↓. Esc, a click outside it, or changing the job's status from
  it closes it (a click on another row shows that job instead).
- **On a job page:** the bar under the top stays while you scroll, with **Back to jobs**, the
  job, its score, the main buttons and **← n/N →** to move through the list you came from (keys
  **J** / **K**). Links under *Next step* jump to Fit, Description, Email, Follow-ups and Comments.
  Marking a job **Closed** or **Not relevant** takes you back to the list you came from.
  **Edit job** (next to the status) edits the title, description and other details.
  The **Company** card shows the company's facts, links (website, careers, Naukri…) and its other
  open jobs. In the description, skills are marked: green = you have it, amber = related, red = missing.
- **Email to HR** (job page) → **Draft email** writes an email from the job and your profile:
  who you are (current role, employer, years), the required skills you match exactly, your most
  relevant project highlight, a certification the job asks for, leadership for lead roles,
  location / notice period, the job link and your signature. **Short message (LinkedIn)** gives
  a brief version for LinkedIn or InMail. Better profile data (projects with highlights,
  certifications, notice period in Target Profile) makes better drafts. Pick one of the suggested subjects or type your own, edit the message, then
  **Copy subject**, **Copy message**, **Copy subject + message** or **Open in email app**.
  **Find HR email with Google · ChatGPT · Gemini · Claude** searches for publicly listed HR /
  recruiter addresses at the company (the AI tools are told not to guess addresses);
  **Polish with ChatGPT · Gemini · Claude** asks them to tighten your edited draft. Nothing is
  sent from the app. Known recruiters for the company appear as suggestions in *To*.
- **Status in one place:** changing a job's status (job page, bulk action) also moves its
  application (Interview, Offer, Rejected…), and a rejected / closed / not-relevant / withdrawn
  job's open follow-ups are closed — the same as changing the application.
- **Interview done, HR not replying:** on a job in *Interview*, click **Interview done – no
  reply** (or pick it in the Status menu or on the application). The job stays in the
  **Interview** tab, a reminder *Ask for interview feedback* is added for 3 days later, and the
  job page offers **Follow up**, **Next round**, **Got an offer** and **Rejected**. Scheduling
  another round moves it back to *Interview*.
- **Job dates** (top of the job page): *Posted on job site* → *Added to sheet* (jobs from a
  Google Sheet; from a `date_found` / `date_added` column) → *Added to this app*. If the sheet has
  no real posted date its own text is shown, e.g. "Active Opening" (sheet).
- **Is the job still open?** On a job, **Check if still open** asks the posting's own site
  (job-board API or the page itself) and shows *Still open*, *Closed*, *Probably closed* or
  *Couldn't tell*, with the reason. If it's closed, **Mark as closed** moves it to the Closed
  tab. Postings older than two months show *Posted N months/years ago*. LinkedIn, Indeed,
  Glassdoor and Naukri can't be checked automatically — open the posting instead.
- On a job (and on **Add Job** once title and company are filled), **Find on other portals with
  Google · ChatGPT · Gemini · Claude** looks for the same posting on LinkedIn, Naukri, Indeed,
  Glassdoor, Instahyre, Foundit and the company's careers site.
- Lists, counts and badges update by themselves after any change — no page reload needed.
- **Pages:** "Showing 51–75 of 447" above and below the list, numbered pages with first/last,
  *Go to* a page, and **Rows per page** (10/25/50/100, remembered). Same on Companies.
- **Act on many jobs at once:** tick jobs (or the box in the header for the whole page), then
  **★ Shortlist**, **Not relevant**, **Closed**, **Set status…** or **Delete…**. Bulk delete keeps
  jobs that have an application — delete those from the job page.
- **Applied means tracked:** a job marked Applied (or later) anywhere — status menu, a sheet,
  a file, Career-Ops — always gets an application, so Pipeline, follow-ups and Insights count it.
  Ones recorded automatically say so in their notes, with an approximate applied date.
- **Your sort and filters are remembered** in this browser until you change them or press
  **Reset**. A link that brings its own filters (e.g. a Dashboard card) uses those instead; your
  sort still applies.
- **Next step** on every row: **★ Shortlist** / **✕** for new jobs, **Apply** for shortlisted
  ones, **Follow up** for jobs you applied to.
- **Added via** tag on every job — how it came into the app: **Manual** (Add Job),
  **Google Sheet**, **Job board search**, **Career-Ops** or **File import**. A job found more than
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
pre-selected), **Method** (portal, email, referral…), **Expected CTC**, **Notice period (days)**,
**Applied on** and **Notes**.
**Applied on** is optional: leave it empty for today, or pick the day you actually applied from
the date picker (future dates aren't allowed). That date is the application's applied date, and
the first follow-up is due a week after it.
This creates an **Application** (sidebar → Applications) and moves the job to *Applied*.
**✓ Applied** (or the status menu) does the same in one click, with today's date and a first
follow-up a week later; changing many jobs at once (bulk) records the applications without
follow-ups, since that's usually catching up on old ones.

On an application: update its status (Applied → Screening → Interview → Offer / Rejected /
Withdrawn), see its **History**, and add **follow-ups** (reminders). The Applications list's
**Follow-up** column shows the next open follow-up from the Follow-ups list (red with "· due" when
it's today or late; click it to open Follow-ups); the Pipeline page uses the same date.

**Pipeline** (the Pipeline menu opens it): every application in one list, with **stage tabs
grouped like the Jobs page** — *Everything* (All open · All), *Waiting* (Applied · Recruiter
contacted · Screening · On hold), *Interviews* (Interview · Interview done – no reply), *Offers*
(Offer · Accepted) and *Finished* (Rejected · Withdrawn · Closed), each with its count. Each row
has the job and company, a **Status** menu (change it there when something happens: the job's
status and follow-ups update with it), **Next stage →** (one click on), days since applying
("date approximate" for applications recorded automatically), the next follow-up (red when
late), the last update ("No update in 14+ days") and the score; a red (follow-up late) or amber
(quiet) bar on the left marks rows that need you. Tick rows (or **Select all on this page**) and
use **Set status to… → Update** to change several at once. Long lists are split into pages
(rows per page at the bottom, remembered in this browser).

Above the list, the **funnel** shows how many applications got a reply, an interview and an
offer (with %; a rejected application still counts for the stage it reached), and **Needs
attention** (click it to show only those rows). The toolbar searches a job or company, sorts
(newest, best match, waiting longest), and shows **Needs attention only**; these choices and the stage tab are remembered in this
browser.

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

- **Offers**: **+ Record an offer** (or **Record the offer** on a job in the Offer stage, which
  opens the form with that job picked) for a **Job** (CTC, **Joining date**, **Offer expires**,
  **Work model**, **Benefits**); negotiate (**Counter CTC**, **Negotiation note**); accept or
  decline with **Decision notes**; and *Compare open offers* side by side.
- **Follow-ups**: grouped into **Late · Today · This week · Later**. Each one links to its job
  and shows the job's status; **✓ Done**, or push it **+1 day / +3 days / +1 week**. If the job
  is already rejected or closed, it says so and offers **Dismiss**. When several are late,
  **Move all N to today / tomorrow / +3 days / +1 week** reschedules them in one click. Applying
  plans a follow-up for you; add more from the job page or **+ New reminder**.
- **Email updates** (Follow-ups → Email updates): connect your inbox once in **Settings → Email**
  — pick **Gmail**, **Yahoo Mail** or **Other (IMAP)** (typing a @gmail / @yahoo address picks it
  for you). Gmail: turn on 2-Step Verification, create an **app password** at
  myaccount.google.com/apppasswords. Yahoo: Account security (login.yahoo.com/account/security)
  → **Generate app password**. Paste that password, not your normal one. The app checks every 30 minutes (change it there)
  and finds **rejections, interview invites, assessments, offers, "thanks for applying"** and
  recruiters writing to you. Each one shows the sentence that gave it away, the job it matched
  (by the sender's domain, a recruiter you saved, the company or job title in the email) and the
  status it suggests. **Confirm** sets that status (or pick another, or *Don't change*) and adds
  the email to the job's comments; **Dismiss** ignores it. When it can't tell which job, pick one.
  Nothing changes until you confirm, statuses never move backwards, and a suggestion you already
  made by hand disappears by itself. Read-only: nothing is marked read, moved or sent; only the
  headers of new mail are read, the text only of job-search emails, and only one sentence is
  kept. The password stays in `backend/secrets/`, never in the database or backups.
- **Recruiters** (Pipeline → Recruiters; **+ Add contact** opens the form): contacts with company, role, email, **phone /
  WhatsApp** (click to call or open WhatsApp), LinkedIn, status and next follow-up, plus the
  jobs they're the recruiter for.
  - Emails, phone numbers and LinkedIn profiles written in a job are saved as recruiters
    automatically when the job is added, edited or commented on — e.g. a sheet note *"Email:
    hr@company.co | Phone: 98…"*. **Find contacts in jobs** does it for every job at once (safe
    to run again). Your notes and comments always count; in a job description only addresses
    after "send your resume to / contact / HR…" count, and accommodation, toll-free, privacy and
    no-reply addresses are skipped. A person-like address gives a name ("ram.kumar@" → Ram
    Kumar); otherwise the address is the name — nothing is made up. Each contact shows which
    job it came from.
  - Sheet / CSV columns *Recruiter, HR name, Contact person, Recruiter email, HR email,
    Contact email, Phone, Mobile, Contact number, WhatsApp* are read too; **Add Job** has a
    *Recruiter phone / WhatsApp* field.

## 11. Today, Insights and Reports

- **Today** (top to bottom):
  - **Getting started** checklist — shown until your CV, profile, target roles, salary target,
    scannable companies and first jobs are all in place; each step links to where you do it.
  - **To do** — what's waiting on you, each card opens the list: **New jobs to review** (and how
    many score 70+), **Ready to apply** (shortlisted, not applied), **Follow-ups due**,
    **Interviews coming up**, and **Good jobs without a description** with
    **Fetch for 40 best jobs** (see below).
  - **Progress** — applied this week and new jobs this week (each with the change from last
    week), **good jobs not applied** (70+), **response rate** (applications that got any
    answer), interviews, offers.
  - **This week's goals** (right column) — Monday to Sunday: **applications sent**, **new jobs
    reviewed** (moved out of New), **follow-ups done**, **recruiters contacted** (set to
    Contacted). Each shows done / target, how many a day you still need, last week, and the
    weeks in a row you met every goal. Counted from what you actually did — nothing to tick
    off. **Change goals** sets the targets (0 turns one off; defaults 10 / 30 / 5 / 3).
    Applications recorded automatically (a job set to Applied, e.g. by a sheet import) are
    flagged "dates approximate".
  - **Browser reminders** (under the goals): **Turn on reminders** asks the browser for
    permission, then — while the app is open in a tab — it notifies you about follow-ups due
    or late (once a day each; one summary when there are more than 3) and interviews in the
    next 24 hours and again within the hour. Clicking a reminder opens the job / interview.
    The choice is per browser; **Turn off** stops them.
  - **Today's priorities** — interviews in the next 3 days, the 3 oldest follow-ups due (plus one
    "N more follow-ups due" line), offers about to expire, the best jobs scoring 70+ you haven't
    applied to, then housekeeping. **Best new matches** (★ Shortlist / Not relevant in one click),
    **Coming up**, **Job sources** (when each source last ran, **Search job boards**), CV advice.
- **Fetch missing descriptions** — reads the description from each job's own link, best scores
  first: job-board APIs (Greenhouse, Lever, SmartRecruiters, Workday), the structured job data
  many career sites publish, and Career-Ops' fetcher when it's set up. LinkedIn, Indeed,
  Glassdoor and Naukri are never read automatically (their terms forbid it) — open those and
  paste the description. When a job has several links (e.g. LinkedIn and the company's careers
  page), the readable one is used. Jobs whose page has no description, and jobs only on
  LinkedIn / Indeed / Naukri, are marked and skipped next time; their job page says to paste it.
  Scores are recalculated as soon as a description arrives.
- **Insights** (tab next to Today): every chart comes with a one-line takeaway.
  - *Executive summary* — pick the last **7, 30 or 90 days**: the key numbers (jobs found,
    applications, answer rate, interviews, offers, days to first answer, applications gone
    quiet, jobs waiting for review, jobs reviewed, median pay shown), each against the period
    before and linked to its report, and **What the numbers say**: findings worked out from
    your own data (problems first, each with a link to act). A change is only called out when
    it's large and rests on enough cases (5+), and activity is only compared from when it
    started being recorded. No outside benchmarks are used.
  - *Pipeline health* — how far the period's applications got, and active applications by age.
  - *Market & pay* — pay shown (INR, per year), median pay by seniority, experience asked for,
    companies posting the most jobs.
  - *How your search is going* — applications, applied this week (vs last week), response and
    interview rate, good jobs not applied; a **last 12 weeks** chart of jobs found and
    applications sent; the application funnel (with a link to follow-ups due when few answer);
    and **whether higher scores get more answers** (applications, answers and interviews per
    score band, 80+ compared with below 80).
  - *Where good jobs come from* — every source with its job count, average score, jobs scoring
    80+ and how many you applied to (click a source to see its jobs); **companies with the most
    good jobs** (70+, not applied; click to open the company); locations by city (Bangalore and
    "Bengaluru, Karnataka, India" count as one); work model (jobs that don't say are noted
    separately).
  - *Your matches* — score spread vs the jobs you applied to, and where scores are lost (with
    what to change).
  - *Skills* — the required skills you miss most, CV advice, most requested skills.

- **Reports** (menu): one report per area, grouped — *Summary*: **Overview**; *Pipeline*:
  **Pipeline health, Applications, Interviews, Offers, Follow-ups**; *Market*: **Jobs found,
  Market & pay, Skills, Companies**; *Operations*: **Job sources, Your activity, Scans & imports**.
  - **Pipeline health**: answer rate, answers → interview, interview → offer, median days to the
    first answer, applications with no update for 14+ days; cohorts by when you applied (answer
    and interview rate per week, still waiting) and every active application, oldest first.
  - **Market & pay**: pay shown (middle of the range, INR per year; other currencies left out
    and counted), median pay by seniority, experience asked for, seniority, onsite / hybrid /
    remote over time, companies posting the most jobs.
  - **Your activity**: jobs reviewed, shortlisted, applied and dismissed per period; jobs found
    vs jobs reviewed; the new jobs waiting for you, by age; median days from found to decided.
  - Every report starts with **Key findings** in plain words (problems first).
  - Pick a **Period** (today, last 7 / 30 / 90 days, this or last month, this year, last 12 months, or
    custom dates) and **Group by** (automatic, day, week, month). The choice stays in the
    address, so a report link can be bookmarked.
  - The top cards compare each number with the period of the same length just before: the
    change (in points for a rate, in % for a count), green when it's better (fewer rejections is
    green; neutral counts such as *Dismissed* have no colour), and the previous value.
  - Charts: trends over time, stacked bars (e.g. jobs by source, applications by how you
    applied), donuts with counts and percentages (status, onsite / hybrid / remote, job type),
    and ranked bars (locations, companies, skills, sources).
  - Jobs are dated by **when they were found**: the date your Google Sheet says the row was
    added (so a sheet imported later still counts on the right days), otherwise the day the job
    entered the app. The Jobs table shows both *Found* and *Added to app*.
  - *Where the jobs are* groups locations: each Indian city (Bangalore = Bengaluru), several
    Indian cities, Remote (India), Remote (outside India / global), India (city not stated),
    outside India, not stated. Job types are spelled one way (FULL_TIME = Full-time).
  - Tables show 25 rows a page (change it at the bottom: 10 / 25 / 50 / 100).
  - **Click a bar or slice** (a status, *Remote*, a location, a source, a skill, a company…)
    to list just those rows below; *Show all* clears it.
  - At the bottom: the report's own table and a **Jobs** table with the jobs behind the
    numbers (location, work model, type, score, job status, application status, applied date,
    source, date added). Click a column to sort,
    type to filter, click a job / company / source / skill to open it, **Download CSV** for a
    spreadsheet. **Print / save as PDF** prints the report without the menu.
  - Applications marked *date approx.* were recorded automatically when a job was set to
    Applied; open them to set the real date.

## 12. Settings reference

Settings has these tabs (plus **Reminders** and **Email** — connect your inbox, how often to check):

| Tab | What's there |
|---|---|
| **Job sources** | An overview of every job source (set up? last run?), then: **Job board search** — *Search every company* switch, Search now, Find job boards, coverage, last run details, filters and schedule; **Google Sheets** — saved sheets, Import, a *Private — can't import* badge and fixes, private-sheet connection (service account); **Career-Ops** (optional) — Import now, Scan + import, *Run automatically* (Scan + import every N hours; import when its files change), *What Career-Ops searches* (its companies and filters, read-only) |
| **Import rules** | Which new jobs any source may save: skills a job must have, skills to ignore, roles to keep, roles to ignore, which sources they apply to, jobs without a description, and a tester |
| **Scoring** | What each part of the 0–100 score looks at, their weights (must total 100), the score each recommendation label needs, and (Advanced) company-tier points and deal-breakers. Save re-scores every job; Undo changes discards edits |
| **Backup & import** | Download a full JSON backup or any list as CSV; import jobs or recruiters from a CSV/JSON file |
| **About & AI** | Whether optional AI is on and how to turn it on; versions, Google account, Career-Ops path, storage |

**Search every company** (Job sources → Job board search): on = every company is scanned, including
ones added later, whatever its own *Job search* tick says; off = only ticked companies. The
per-company ticks are kept, so turning it off restores them. Companies can only be scanned
when their job board is known (**Find job boards**).

## 13. Backups, exports and starting over

- **Automatic backups** (Settings → Backup & import): every day by default, while the app runs,
  a zip lands in `backend/backups/` with the **whole database** (`database.dump`), a readable
  copy of your data (`data.json`) and your **uploaded CVs**. The newest 14 are kept; change how
  often (6 hours … a week) and how many to keep, or click **Back up now**. Each backup can be
  downloaded from the list. The zips hold personal data: they're git-ignored and readable only
  by you — copy them somewhere safe (another disk, cloud drive) now and then.
- **Restore a backup** (replaces all current data): `./stop.sh --keep-db`, then
  `./scripts/restore-backup.sh backend/backups/career-backup-….zip` and type `restore`; then
  `./start.sh`.
- **Export**: Settings → Backup & import → Download your data → jobs, companies,
  applications… as CSV/JSON, or everything as one JSON file.
- Your data lives in `backend/.devdb/` (database) and `storage/` (CV files).
- **Login (optional)**: Settings → **Login** → *Turn on login* (username + password, at least 8
  characters). The app then asks for them (stays logged in 30 days per browser; **Log out** at
  the top). Change the username or password there (needs the current password; a new password
  logs out every other browser and phone), or *Log out other devices*. Five wrong passwords lock
  that visitor out for 15 minutes. Alternatively set `APP_PASSWORD=…` in `backend/.env` before
  the first start: it becomes the login with username **admin**.
  **Forgot the password?** Delete `backend/secrets/login.json` and restart: with `APP_PASSWORD`
  set the login is admin / that password again, otherwise the app is open until you create one.
- **Use it from your phone or another network**: turn on the login first, then run
  `cloudflared tunnel --url http://localhost:5173` (`brew install cloudflared`) and open the
  `https://….trycloudflare.com` link it prints. The link changes every time the tunnel starts.
- **Start completely fresh** (deletes all your data!): `./stop.sh`, then delete
  `backend/.devdb/` and `storage/`, then `./start.sh`. The app creates an empty database.
  Export first if you may want anything back.

## 14. Daily routine

1. Open the **Dashboard** → do **Today's Priorities**.
2. If the scanner isn't scheduled: Settings → Job board search → **Search now**; import new sheet rows.
3. **Review new jobs**: shortlist the strong ones, mark the rest *Not relevant* (keys `S` / `N`).
4. Apply to shortlisted jobs with the recommended CV; add a follow-up reminder.
5. Confirm **Email updates** (Follow-ups → Email updates) — replies from companies update the statuses for you.
6. After changing your CV or profile, scores update by themselves.

Using an AI agent instead? Say *"Find jobs for me"* — see README → *Using AI coding agents*.

## 15. Keyboard, phone and install

- **Assistant:** the round chat button at the bottom right of every page, or `⌘ J` / `Ctrl J`. Ask
  about anything in the app — “best new jobs this week”, “remote magento jobs in pune 80+”,
  “status of Accenture”, “#512”, “upcoming interviews”, “follow-ups due”, “how am I doing” — or
  tell it what to do: “apply 512”, “mark 77 not relevant”, “note 512 called the recruiter”.
  Changes appear as a card with **Confirm**; nothing changes until you click it. Without AI it
  understands these commands; with an AI key (Settings → About & AI: Claude, Gemini, OpenAI or
  OmniRoute) you can ask anything in your own words. The conversation stays in this browser
  (**Clear** empties it).

- **Command palette:** `⌘ K` (Mac) or `Ctrl K` (or **Commands** in the top bar). Type to go to any
  page, run an action (add a job, scan job boards, back up now, import a file) or open a job or
  company by name. `↑`/`↓` to choose, `Enter` to open, `Esc` to close.
- **Shortcuts** (not while typing in a field): `/` search everything · `C` add a job ·
  `G` then `T` Today, `J` jobs, `R` review new, `C` companies, `P` pipeline, `F` follow-ups,
  `I` reports, `M` my profile, `,` settings · `?` shows them all.
- **Notifications:** the 🔔 bell at the top right lists what needs you now, grouped (and
  filterable): interviews coming up, follow-ups due or late, jobs shortlisted but not applied to
  (*Apply pending*), the best new jobs, and reminders that fired. Each shows the job, the
  company, location, work model, score and **Applied <date>** or **Not applied**; click one to
  open it. The red count is what you haven't read: **Mark as read** (the dot on an item, ✓ on
  hover) or **Mark all as read**; opening an item marks it read too. Read ones leave the list
  (**Show N read** brings them back). The tab title shows the same count, e.g.
  *(26) Career Intelligence*, and the installed app's icon gets a badge.
  **Turn on notifications** (bottom of the bell) lets the browser show pop-ups with the app icon
  for follow-ups due, interviews 24 hours and 1 hour before, new jobs found by a scan, and your
  scheduled reminders — while the app is open in a tab.
- **Reminders** (Settings → Reminders, or *Reminder schedule →* in the bell): nudges on a
  schedule, like a cron job — **Check job portals** (the portals you list; says how many new jobs
  wait), **Apply to shortlisted jobs**, **Follow up**, and your own (**+ Add a reminder**). Each
  can be turned on or off, with **How often**: every 5/15/30 minutes, every hour, every 2 or 4
  hours, working hours, daily or weekdays at a time — or **Custom (cron)**, e.g.
  `*/10 9-18 * * 1-5` (minute hour day month weekday, your local time). *Only when there's
  something to do* keeps Apply / Follow up quiet when nothing waits. **Test now** sends one at
  once; the next time each one runs is shown. The app checks the schedule every minute while it
  runs. Reminders reach you in the bell, as a message in the app, as browser notifications, and
  — on a Mac running the app directly — as **macOS notifications** even with the browser closed.
- **Messages:** saving a job, changing a status, applying or backing up shows a short message at
  the bottom of the screen; failed one-click actions show the error there too.
- **Phone:** the menu opens from ☰ (the theme switch is at its bottom); job lists show one card
  per job instead of a table; wide tables (the Pipeline list too) scroll sideways.
- **Install as an app:** in Chrome or Edge, use *Install Career Intelligence* in the address bar
  (or ⋮ → *Cast, save and share → Install page as app*) to open it in its own window.
