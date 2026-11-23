# Hunt Gov Pk — Government Jobs (Pakistan)

Real, current government jobs and official advertisement PDFs collected from official recruitment websites.

## Pages
- `index.html` — open government jobs with search, source / department / pay-scale filters, a **Computer Science & IT** toggle and sorting
- `job-details.html?id=…` — full details of one post, with links to the official advertisement and apply page
- `healthcare.html` — jobs at major hospitals, grouped by field (Computer Science & IT first, then Medical, Nursing, Pharmacy, Research, Management)
- `advertisements.html` — official advertisement PDFs, addendums and notices, plus the "new departments" watch list

## How data stays fresh
Browsers can't read other websites directly (CORS), so the scraping runs in Python
(`scraper/fetch_jobs.py`, standard library only, Python 3.8+).

| Where | How jobs are refreshed |
| --- | --- |
| **Vercel (production)** | **Refresh** button in the header + **automatic refresh every 5 minutes** while the page is open. The browser calls the serverless function `/api/source?id=<SOURCE>` for all sources in parallel (≈ 20–30 s). Responses are cached on Vercel's CDN for 5 minutes, so visitors share one fetch per source and government sites aren't overloaded. The manual button bypasses the cache (max. one fresh fetch per source per minute). The newest data is remembered in the browser (localStorage) for the next visit. |
| **Local preview** | `python serve.py` → http://localhost:8000 — works exactly like Vercel (button, auto-refresh, API, 5-min cache). |
| **Opening `index.html` directly** | No server, so the button just reloads the page. Update the data with the CLI below. |

The pages always open instantly from the bundled snapshot `data/jobs.js`, then update live.
If a source is down, its last good data is kept and the toast says which source failed.

```bash
python scraper/fetch_jobs.py                 # refresh the bundled snapshot (~30 s, all sources in parallel)
python scraper/fetch_jobs.py --watch 30      # keep refreshing every 30 minutes
python scraper/fetch_jobs.py --only PPSC     # refresh one source; others keep their last data
```

## Deploying to Vercel
1. Push this folder to a Git repository and import it in Vercel (framework preset: **Other**, no build command,
   output directory = project root). Or run `vercel` / `vercel --prod` from this folder with the Vercel CLI.
2. That's it — `vercel.json` already configures everything:
   - `api/source.py` → Python serverless function, `maxDuration: 60`, bundles `scraper/` and `data/` via `includeFiles`
   - `regions: ["bom1"]` (Mumbai) — the closest Vercel region to Pakistan's government servers
   - cache headers for `data/` (always revalidate) and static assets
3. Before each deploy, optionally run `python scraper/fetch_jobs.py` so the bundled snapshot (first paint) is current.

Things to check after the first deploy:
- Open `https://<your-app>.vercel.app/api/source?id=BPSC` — it should return JSON with `"ok": true`.
- Some government sites may block or slow down requests from data centres outside Pakistan. If a source keeps
  failing on Vercel (`"ok": false`), the site still shows its last saved data; you can then refresh that source
  from a Pakistani connection with the CLI and redeploy.
- Every source finishes well inside 60 s (slowest ≈ 30 s). OTS has a 40 s time budget (`HN_TIME_BUDGET`) and checks
  its newest projects first. Concurrency can be tuned with the `HN_WORKERS` environment variable (default 10).

## Sources
| Source | Jobs | Advertisements |
| --- | --- | --- |
| PPSC — Punjab Public Service Commission | ✅ full per-post details | ✅ PDF |
| PJP — Punjab Job Portal (jobs.punjab.gov.pk), all Punjab departments incl. S&GAD AI Wing / AIDU | ✅ full details: salary, PPS level, degree area, skills | ✅ image / PDF |
| OTS — Open Testing Service | ✅ open posts only (expired, admission, training and OTS's own hiring are skipped) | ✅ project page (OTS PDF links expire within minutes) |
| KPPSC — KP Public Service Commission | — | ✅ PDF (newest 40) |
| BPSC — Balochistan Public Service Commission | — | ✅ PDF / image |
| ETEA — KP testing agency | — | ✅ when active adverts are published |
| SKMCH — Shaukat Khanum Memorial Cancer Hospital (Healthcare tab) | ✅ all 5 job categories, with eligibility | — |
| PKLI — Pakistan Kidney & Liver Institute (Healthcare tab) | ✅ all posts incl. ICT, with full requirements | ✅ PDF |

Hospital jobs get a `field` (it, medical, nursing, pharmacy, research, admin) from the job title and department,
see `classify_field()` in the scraper.

Not reachable automatically: **NCCIA** (Cloudflare bot protection), **FPSC**, **SPSC**, **NJP** (timed out), **PTS** (503).
Hospitals checked but not usable yet: AKU (Taleo portal), Shifa and Hameed Latif (careers page 404), Indus (redirects to home page),
PIMS (careers link points to NJP), KEMU (portal only lists a test vacancy).

## New departments watch list
`NEW_DEPARTMENTS` in `scraper/fetch_jobs.py` lists recently created bodies (AIDU / AI Wing S&GAD Punjab, NCCIA, Federal Constabulary,
Pakistan Digital Authority, PVARA, PERA, CCD Punjab, SIFC, PKCERT). Every job and advertisement is matched
against it; matches get a **New department** badge and can be filtered on both pages. Add a department by
adding its name and keyword patterns to that list.

## Adding a source
Write a `fetch_<source>()` function in `scraper/fetch_jobs.py` returning `{"jobs": [...], "ads": [...]}`
and register it in `SOURCES`. It is automatically available to the CLI, `/api/source?id=<ID>` and the
Refresh button. Keep it under ~45 s.

## Project structure
```
index.html, healthcare.html, advertisements.html, job-details.html
css/       style.css · components.css · responsive.css
js/        utils.js (data + helpers) · components.js (UI) · live.js (refresh + auto-refresh)
           jobs.js · healthcare.js · ads.js · job-details.js (pages) · app.js (bootstrap)
api/       source.py            Vercel serverless function (live data per source)
scraper/   fetch_jobs.py        all scraping logic (CLI + API)
data/      jobs.js · jobs.json  bundled snapshot (generated)
serve.py   local preview server that mimics Vercel (not deployed)
vercel.json · .vercelignore · requirements.txt
```
