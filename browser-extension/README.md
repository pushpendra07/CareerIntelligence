# Career Intelligence – Job collector (Chrome extension)

Adds jobs to your Career Intelligence app straight from the browser. No AI, no tokens.

- **Add this job:** open any job posting (LinkedIn, Naukri, Indeed, Foundit, Glassdoor, Instahyre,
  Wellfound, Cutshort, Hirist, iimjobs, or a company careers page) and click the extension's icon.
  The job is saved right away and the popup shows **Added #123 · score 78**, **Already in your
  list: #512** (the link is added to that job), or **You deleted this job before → Add it anyway**.
  If the page doesn't show a title or company, the popup asks for them.
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
| `extract.js` | Reads a job page: schema.org `JobPosting` data first, then each portal's page layout, then the page itself (careers sites). Also lists job links on a portal's search page. Read-only |
| `popup.html` / `popup.js` | The toolbar button: read the current tab → `POST /api/v1/jobs/agent-import` → show the result |
| `background.js` | The collector: opens the portal search, reads the links, opens each job, sends the jobs back to the app tab. Only accepts requests from the app's own pages and only opens the supported portals' https pages; one collection at a time |
| `bridge.js` | Runs on the app's pages only: marks the page (`data-ci-collector`) and relays messages between the app and `background.js` |
| `settings.js` | The app/API addresses and the import call |

It never logs in, clicks Apply, messages anyone, or sends data anywhere except your own app.
Portals change their pages from time to time; if a field stops being read, update the selectors
in `extract.js` (`PAGE` for job pages, `LINKS` for search pages). The reader is tested in
`frontend/src/test/extension-extract.test.ts`.

Some portals (LinkedIn in particular) don't allow automated collection in their terms. The
collector goes at a reading pace and is limited to 50 jobs per run; use it sparingly with your
own account. Adding one job you are looking at is the safest use.
