# Scan coverage — which companies are searched for jobs

Snapshot of **2026-10-09**. Always check the live state before relying on it:

```bash
curl -s http://127.0.0.1:8010/api/v1/scanner/status | python3 -m json.tool      # built-in scanner
curl -s http://127.0.0.1:8010/api/v1/career-ops/status | python3 -m json.tool    # Career-Ops
```

**40 companies are scanned:** 36 by the built-in Job scanner (10 of them also by Career-Ops)
plus 4 only by Career-Ops. About 80 more tracked companies are **not** scanned because their
careers site isn't on a supported job board (see "Not scannable" below).

## Built-in Job scanner — 36 companies

Scanned when the company has **Job search** ticked and its careers URL is a supported board.

| Company | Tier | Board | Board URL (stored as the company's careers URL) |
|---|---|---|---|
| Accenture | A | Workday | https://accenture.wd103.myworkdayjobs.com/AccentureCareers |
| Genpact | | Workday | https://genpact.wd108.myworkdayjobs.com/External_Careers |
| Guidance (OneMagnify) | | Workday | https://onemagnify.wd5.myworkdayjobs.com/OneMagnify_Careers |
| AKQA | | Greenhouse | https://job-boards.greenhouse.io/akqa |
| Astound Commerce | | Greenhouse | https://job-boards.greenhouse.io/astoundcommerce |
| DEPT | C | Greenhouse | https://job-boards.greenhouse.io/dept |
| Knak | | Greenhouse | https://job-boards.greenhouse.io/knak |
| N-iX | | Greenhouse | https://job-boards.greenhouse.io/nix |
| Ogilvy | | Greenhouse | https://job-boards.greenhouse.io/ogilvy |
| R/GA | | Greenhouse | https://job-boards.greenhouse.io/rga |
| Stripe | | Greenhouse | https://job-boards.greenhouse.io/stripe |
| TCS | | Greenhouse | https://job-boards.greenhouse.io/tcs |
| Thoughtworks | | Greenhouse | https://job-boards.greenhouse.io/thoughtworks |
| Valtech | A | Greenhouse | https://job-boards.greenhouse.io/valtech |
| VML Enterprise Solutions | | Greenhouse | https://job-boards.greenhouse.io/vmlenterprisesolutions |
| Bounteous | A | Lever | https://jobs.lever.co/bounteous |
| Eleks | | Lever | https://jobs.lever.co/eleks |
| Trellis | | Lever | https://jobs.lever.co/trellis |
| Wpromote | | Lever | https://jobs.lever.co/wpromote |
| Endava | | SmartRecruiters | https://jobs.smartrecruiters.com/endava |
| Eway Corp | | SmartRecruiters | https://jobs.smartrecruiters.com/ewaycorp |
| Intersog | | SmartRecruiters | https://jobs.smartrecruiters.com/intersog |
| Kellton Tech | | SmartRecruiters | https://jobs.smartrecruiters.com/kelltontech |
| MageComp | B | SmartRecruiters | https://jobs.smartrecruiters.com/magecomp |
| McFadyen Digital | A | SmartRecruiters | https://jobs.smartrecruiters.com/McFadyenDigital |
| Nisum | | SmartRecruiters | https://jobs.smartrecruiters.com/nisum |
| Sigma Software | | SmartRecruiters | https://jobs.smartrecruiters.com/sigmasoftware |
| SmartOSC | | SmartRecruiters | https://jobs.smartrecruiters.com/smartosc |
| Ziffity Solutions LLC | B | SmartRecruiters | https://jobs.smartrecruiters.com/ziffitysolutions |
| Flint Technology | | Ashby | https://jobs.ashbyhq.com/flint |
| Lazer Technologies | | Ashby | https://jobs.ashbyhq.com/lazer |
| Strix | | Ashby | https://jobs.ashbyhq.com/strix |
| Magebit | | Teamtailor | https://careers.magebit.com |
| Vaimo | | Teamtailor | https://careers.vaimo.com |
| WSA (APAC) | | Teamtailor | https://careersapac.wsa.com |
| Scandiweb | | Pinpoint | https://scandiweb.pinpointhq.com |

## Career-Ops — 14 companies (from its `portals.yml`)

Career-Ops lists 84 companies but scans only the 14 with a readable portal.

- **Also covered by the built-in scanner (10):** Accenture, Genpact, Guidance (OneMagnify),
  Valtech, VML Enterprise Solutions, Lazer Technologies, Vaimo, Magebit, Scandiweb,
  McFadyen Digital.
- **Only Career-Ops (4)** — the built-in scanner does not support these systems yet:

| Company | Career site system | URL |
|---|---|---|
| HCLTech | SAP SuccessFactors | https://careers.hcltech.com |
| Wipro | SAP SuccessFactors | https://careers.wipro.com |
| Birlasoft | SAP SuccessFactors | https://jobs.birlasoft.com |
| Zensar Technologies | Oracle Cloud (Fusion) | https://zensar.fa.em2.oraclecloud.com |

## Not scannable (~80 companies)

Companies whose careers page is their own website, an unsupported system (SuccessFactors,
Oracle, iCIMS, Taleo, Zoho, Keka, Darwinbox…), or a Google-search placeholder. Examples from the
job-search list: Infosys, Cognizant, Capgemini, LTIMindtree, Deloitte, Coforge, Mphasis,
Nagarro, Persistent Systems, Webkul, Codilar, Ranosys, Krish TechnoLabs, Mageplaza…
The live list is `not_scannable` in `GET /api/v1/scanner/status`.

For these: run **Find job boards** (may discover a linked board), add jobs from Google Sheets,
or use **Add Job** with the posting URL + description. Don't invent board URLs.

## How Find job boards works (Settings → Job scanner)

For every company the scanner can't read yet, in this order (first match wins, each checked live):

1. **Careers page from the website** — if a company has a website but no careers URL, the careers
   link on its homepage is saved (PARTIALLY_VERIFIED, source "careers_link").
2. **Career-Ops' list** — `career-ops/portals.yml` naming the company's job system.
3. **Links on the careers page** — to Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable,
   Recruitee, Pinpoint, Teamtailor, Oracle Cloud or SuccessFactors.
4. **SuccessFactors on the company's own domain** (e.g. careers.wipro.com) — confirmed by its job
   listing endpoint answering.
5. **Job data on the careers page** — schema.org `JobPosting` on the page or on the job pages it
   links to; the scanner then reads the company's own site (provider `CAREERS_PAGE`).
6. **Name on job-board listings** — the company name on Greenhouse, Workable, SmartRecruiters,
   Recruitee (accepted only if the board's own name matches the company), Lever, Ashby, Pinpoint
   (accepted only if their jobs name the company or its domain).

Found boards are saved on the company (`attributes.scanner_board`: provider, method, evidence URL).
Companies with a known board but **Job search** off are listed in the scanner panel with
**Turn on job search for them**. Companies that only post on LinkedIn/Naukri, or with no website and
no careers URL, still can't be scanned — use Add Job or Google Sheets.

## Supported job boards (built-in scanner)

| Board | Careers URL looks like | Public API used (check it returns jobs before saving) |
|---|---|---|
| Greenhouse | `job-boards.greenhouse.io/<slug>`, `boards.greenhouse.io/<slug>` | `https://boards-api.greenhouse.io/v1/boards/<slug>/jobs` |
| Lever | `jobs.lever.co/<slug>` | `https://api.lever.co/v0/postings/<slug>?mode=json` |
| Ashby | `jobs.ashbyhq.com/<slug>` | `https://api.ashbyhq.com/posting-api/job-board/<slug>` |
| SmartRecruiters | `jobs.smartrecruiters.com/<Slug>` | `https://api.smartrecruiters.com/v1/companies/<Slug>/postings` |
| Workday | `<tenant>.wd<N>.myworkdayjobs.com/<Site>` | `POST https://<tenant>.wd<N>.myworkdayjobs.com/wday/cxs/<tenant>/<Site>/jobs` body `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` |
| Workable | `apply.workable.com/<slug>` | `https://apply.workable.com/api/v1/widget/accounts/<slug>` |
| Recruitee | `<slug>.recruitee.com` | `https://<slug>.recruitee.com/api/offers/` |
| Pinpoint | `<slug>.pinpointhq.com` | `https://<slug>.pinpointhq.com/postings.json` |
| Teamtailor | `<slug>.teamtailor.com` or the company's own careers domain | `https://<careers-domain>/jobs.rss` |
| SAP SuccessFactors | `*.successfactors.com/eu`, `*.jobs2web.com`, or own domain | `GET <base>/tile-search-results/?startrow=0` (older sites) or `POST <base>/services/recruiting/v1/jobs` (newer); descriptions from each job page's JobPosting data |
| Oracle Cloud HCM | `<tenant>.fa.<region>.oraclecloud.com/hcmUI/CandidateExperience/<lang>/sites/<site>` | `GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions?...finder=findReqs;siteNumber=<site>` |
| Own careers page | any page with schema.org `JobPosting` (on it or on its job pages) | the page itself |
