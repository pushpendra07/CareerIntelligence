# Company & Career Data Sources (inventory, 2026-10-08)

All sources were inspected **read-only**. Nothing in them was modified.

## 1. Sources found

| # | Path | What it is | Companies |
|---|---|---|---|
| A | `../jobsearch/database/php_magento_adobe_laravel_company_master.csv` | Earlier research project (30 batches, `build_master.py`). 45 columns, with evidence and source URLs per company. | **251** |
| B | `../myjob/backend/jobs.db` → `companies` table | Earlier FastAPI + SQLite job portal. Synced from a Google Sheet. Has ATS/slug for 26 companies. 0 jobs stored. | **315** |
| C | `../careerops/portals.yml` → `tracked_companies` | **Your real Career-Ops install** (v1.32.0, origin `career-ops-hq/career-ops`). Entries have `careers_url` + ATS `api`. | **84** (all enabled; corrected from an earlier 91, which wrongly counted 7 `search_queries` entries) |

The other 8 CSVs in `jobsearch/database/` (`top_500_…`, `india_target_…`, `companies_currently_hiring`, …) are **strict subsets** of the master CSV. They are filtered views, not extra companies.

**Overlap** (company names lowercased, punctuation removed, suffixes like Pvt/Ltd/Technologies dropped): A∩B = 50, A∩C = 30, B∩C = 51. **Union ≈ 548 candidates** (the actual import produced 539 companies after merging name variants). That is enough to reach the "500+ verified" target only after verification. Today most of these companies are not verified to the spec's standard.

## 2. Data quality (source A, master CSV)

| Field | State |
|---|---|
| LinkedIn Company URL | **251 / 251 = "Not verified"**. No usable LinkedIn URLs. |
| Official Website | 119 URLs, 132 "Not verified" |
| Official Careers Page | 32 URLs, 219 "Not verified" |
| Verification Status | Free-text tiers: "Tier 1 (own site)", "Tier 2 (direct open job listing)", "Tier 4 (single search summary / listicle / own marketing site)" … |
| Priority | A+ 16, A 45, B 88, C 79, D 23 |
| India remote | Yes 8, No 1, Unknown 242 |
| Evidence | Magento/PHP/e-commerce evidence text + up to 3 verification source URLs per company |

Placeholder strings such as "Not verified", "Unknown" and "Not publicly available" must be imported as **NULL + status**, never as values.

Source B has qualitative columns (`mnc`, `location`, `size`, `magento_work`, `rating`, `match_score`, `review`) plus `ats`/`slug`. It has no source URLs, so it counts as **DISCOVERED** evidence only.

Source C has careers/ATS URLs that Career-Ops actually scans. That is strong evidence for `careers_url` and the ATS fields.

## 3. Mapping into Career Intelligence

| Our field | A (master CSV) | B (myjob) | C (portals.yml) |
|---|---|---|---|
| name / aliases | Company Name | name | name |
| website / domain | Official Website / Domain | — | — |
| careers_url | Official Careers Page | — | careers_url |
| ats_provider / ats_slug | — | ats / slug | derived from `api` / careers_url |
| linkedin_url | (all "Not verified" → NULL) | — | — |
| hq / india_locations | Headquarters / India Locations | location (free text) | notes (free text, not parsed) |
| company_type / industry | Company Type / Industry | mnc (Yes/No) | — |
| employee_range | Employee Size | size | — |
| tier | Priority A+/A → TIER_A, B → TIER_B, C/D → TIER_C (configurable) | match_score ≥ 90 → hint only | — |
| job_search_enabled | — | active | enabled |
| verification | Verification Status + Sources 1–3 + Last Verified Date | none → DISCOVERED | careers_url → RESEARCHED |
| notes / evidence | Evidence columns + Notes | magento_work, review | notes |

Every imported field value also records `source` (`jobsearch_csv` / `myjob_db` / `career_ops_portals`), `source_url` when one exists, `verification_status` and `verified_at`, as spec §12 requires.

**Merge rule:** match on normalized official domain first, then on normalized name plus aliases. Keep one company record with several field-level sources. When sources conflict, the stronger evidence wins: official site > ATS URL > secondary source > unsourced sheet value.

**Initial verification status:**
- A, Tier 1 or 2 with a source URL → `PARTIALLY_VERIFIED`. It becomes `VERIFIED` only after the official website **and** careers page are confirmed.
- A, Tier 4 → `RESEARCHED`.
- B only → `DISCOVERED`.
- C → `RESEARCHED`, with careers_url marked as verified by ATS.

No URL is invented, and no LinkedIn URL is guessed.

## 4. Career-Ops user data available for import (`../careerops`)

- `cv.md` (16 KB), `config/profile.yml`
- `data/applications.md`: 5+ tracked rows, e.g. VML "Magento Architect" 4.0/5 **Applied**
- `reports/001–007` with Machine Summary YAML
- `jds/` (4 archived JDs)
- `data/pipeline.md` (13 pending), `data/scan-history.tsv` (~120 rows)
- `data/follow-ups.md`, `data/status-log.tsv`

The install has local, uncommitted changes (`CLAUDE.md`, `package.json`, `search.mjs`, `unresolved.*`). We never touch them, and we mount the folder read-only.

## 5. Conflict to resolve

`../jobsearch/profile-foundation.md` lists **Adobe Commerce Architect** as the primary target. The build spec (§10) says Architect roles are **off by default** and enabled only when explicitly selected.
Plan: follow the spec's default (Architect off), and add Architect as a one-click optional target in Target Profile settings.
