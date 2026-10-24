# Career Intelligence – Job collector (Chrome extension)

Adds jobs to your Career Intelligence app straight from the browser. No AI, no tokens.

- **Add this job:** open any job posting (LinkedIn, Naukri, Indeed, Foundit/Monster, Shine,
  TimesJobs, Glassdoor, Instahyre, Wellfound, Cutshort, Hirist, iimjobs, Apna, Internshala, or a
  company careers page) and click the extension's icon. Title, company, location, experience,
  salary and description are read from the page — nothing to type. The job is saved right away
  and the popup shows **Added #123 · score 78**, **Already in your list: #512** with why it
  matched (same link, same posting ID, same company and title on another portal, a repost) —
  it is not added again, the link is added to that job — or **You deleted this job before →
  Add it anyway**. On a search results page it asks you to open one job first. Only if a page
  shows neither title nor company does the popup ask for them.
- **Fill an application:** on a job application form (Greenhouse, Lever, Ashby, Workday,
  SmartRecruiters, Workable, a company's own form…) click the icon → **Fill this application**.
  Empty fields it recognises are filled from your app (first, middle and last name, date of birth — in the field's own format —, email, phone,
  LinkedIn, address, city, state, PIN/postal code, country, experience, current/expected CTC,
  salary negotiable, notice period, relocation, work authorisation, GitHub, portfolio, your own
  saved questions and answers, your message to the recruiter) and your CV is attached when the
  form has a file field. Yes/No radio buttons are chosen from your answers. Filled fields are
  outlined green. It never overwrites a field (nor one you emptied after it was filled), never
  fills questions about someone else (referrer, reference…), and **never submits**: check the
  form, press Submit, then click **I submitted it — record application** (the job becomes
  Applied with a follow-up date). The details are fetched from the app each time: edit them in
  **My profile → Application details**.
- **Multi-page forms** (Workday, SuccessFactors…): with **Keep filling the next pages of this
  form** ticked, each new step is filled as it appears, and a box on the page says how many
  fields were filled, with **Stop filling**. For steps that load a new page, Chrome asks once to
  allow the extension on that site (`optional_host_permissions`); the next pages in that tab on
  that site are then filled for up to 2 hours or until Stop (`background.js`, state in
  `chrome.storage.session`).
- **Collect from a portal:** in the app, **Jobs → AI search → (portal) → Job collector**. The
  extension opens the portal's search, reads up to N jobs one by one (a few seconds each), and
  brings them back to the page, which checks them for duplicates before you click **Add**.

Jobs it adds are tagged **AI search** and go through the same duplicate checks as every other
source.

## Install (once)

Easiest: in the app, **Settings → Job sources → Chrome extension → Download extension (.zip)**
and unzip it — that copy is already set up for your app's address. Or use this folder directly.

1. Chrome → `chrome://extensions`
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → choose the unzipped `career-intelligence-extension` folder (or this `browser-extension` folder).
4. Pin it: puzzle-piece icon in the toolbar → pin **Career Intelligence – Job collector**.
5. Reload the app tab (so Jobs → AI search sees the extension).

After pulling changes to this folder, click the reload icon on the extension's card in
`chrome://extensions`.

## Settings

The popup's footer shows the app's API address (default `http://127.0.0.1:8010`) and the app's
address (default `http://127.0.0.1:5173`); click **change** if yours differ (e.g. the Docker
install serves both on `http://127.0.0.1:8010`). If the app has a password, log in to the app in
the same browser first.

## How it works

| File | Role |
|---|---|
| `manifest.json` | Manifest V3. Permissions: `activeTab` + `scripting` (read the page you click it on), `tabs` (collector tab), `storage` (addresses); hosts: the app on 127.0.0.1/localhost and the supported portals |
| `extract.js` | Reads a job page: schema.org `JobPosting` data first, then each portal's page layout, then fallbacks that survive layout changes (tab title "Title \| Company \| Portal", company links, the "About the job" section), then the page itself (careers sites). Cleans tracking from links and flags search pages. Also lists job links on a portal's search page. Read-only |
| `popup.html` / `popup.js` | The toolbar button: an application form → fill it (`GET /api/v1/apply/lookup`, `/jobs/{id}/apply-kit`, the CV file) and record it (`POST /jobs/{id}/applied`); any other page → `POST /api/v1/jobs/agent-import` |
| `autofill.js` | Fills an application form from the apply kit: matches fields by label/name/placeholder, sets values like typing, picks Yes/No radio options, attaches the CV; `follow()` fills each next step as it appears (on-page box with Stop). Never submits or clicks a button. Tested in `frontend/src/test/extension-autofill.test.ts` |
| `background.js` | The collector: opens the portal search, reads the links, opens each job, sends the jobs back to the app tab. Only accepts requests from the app's own pages and only opens the supported portals' https pages; one collection at a time |
| `bridge.js` | Runs on the app's pages only: marks the page (`data-ci-collector`) and relays messages between the app and `background.js` |
| `settings.js` | The app/API addresses and the import call |

It never logs in, clicks Apply or Submit, messages anyone, or sends data anywhere except your own
app (and, when you fill a form, into that form on your screen).
Portals change their pages from time to time; if a field stops being read, update the selectors
in `extract.js` (`PAGE` for job pages, `LINKS` for search pages). The reader is tested in
`frontend/src/test/extension-extract.test.ts`.

Some portals (LinkedIn in particular) don't allow automated collection in their terms. The
collector goes at a reading pace and is limited to 50 jobs per run; use it sparingly with your
own account. Adding one job you are looking at is the safest use.
