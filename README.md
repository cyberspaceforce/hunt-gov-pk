# Hunt Gov Pk — Government Jobs (Pakistan)

Real, current government jobs and official advertisement PDFs collected from official recruitment websites.

## Pages
- `index.html` — open government jobs with search, source / department / pay-scale filters, a **Computer Science & IT** toggle and sorting
- `job-details.html?id=…` — full details of one post, with links to the official advertisement and apply page
- `healthcare.html` — jobs at major hospitals, grouped by field (Computer Science & IT first, then Medical, Nursing, Pharmacy, Research, Management)
- `advertisements.html` — official advertisement PDFs, addendums and notices, plus the "new departments" watch list

## Run it locally
Needs only **Python 3.8+** — nothing to install (standard library only).

```bash
npm run dev               # http://localhost:3000/index.html  (opens your browser)
npm run dev -- 4000       # another port
npm run dev:nobrowser     # don't open a browser tab
npm run fetch             # refresh the bundled snapshot data/jobs.js
```
`npm run dev` starts the one server the site needs: `serve.py`, which serves the pages **and** the Python API
(`/api/source`) that fetches jobs. The console lists every link. No `npm install` needed.
Without Node: double-click `start.bat`, or run `python serve.py` (port 8000).
If the port is busy, the next free one is used. Don't use VS Code Live Server: it can't run Python, so refresh won't work.
Locally **all 8 sources are fetched live**, including PPSC and PJP, because your connection is in Pakistan.

## How data stays fresh
Browsers can't read other websites directly (CORS), so the scraping runs in Python
(`scraper/fetch_jobs.py`, standard library only, Python 3.8+).

| Where | How jobs are refreshed |
| --- | --- |
| **Local (`start.bat` / `python serve.py`)** | Fresh fetch of all 8 sources automatically on the first visit (once per browser tab), and whenever you click the refresh icon next to "Updated … ago". About 30–50 s. |
| **Vercel (production)** | Same behaviour. 6 sources are fetched live; PPSC and PJP come from the bundled snapshot (see "Keeping PPSC & PJP fresh"). Clicks within the same minute share one fetch per source on Vercel's CDN, so government sites aren't overloaded. |
| **Opening `index.html` directly** | Works offline from the bundled snapshot. The refresh icon explains how to start the local server. |

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

## Keeping PPSC & PJP fresh
PPSC and PJP are hosted at the Punjab IT Board data centre, which only answers requests from inside
Pakistan. Vercel (closest region: Mumbai) can't reach them, so on Vercel these two are served from the
bundled `data/jobs.json` and the page shows "updated N min ago" next to them (no error).
The other six sources are fetched live from Vercel.

To keep that data fresh, run `update-data.ps1` on a computer in Pakistan. It runs the scraper, commits
**only** `data/jobs.json` + `data/jobs.js`, and pushes; Vercel redeploys within about a minute.

```powershell
# once
powershell -ExecutionPolicy Bypass -File update-data.ps1

# every 30 minutes (Windows Task Scheduler, runs while you're logged in)
schtasks /Create /SC MINUTE /MO 30 /TN "HuntGovPk data refresh" /TR "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"<full path>\update-data.ps1\""

# stop it
schtasks /Delete /TN "HuntGovPk data refresh" /F
```
Output goes to `update-data.log`. Every push is a Vercel deploy; 30 minutes = 48 deploys/day, inside the
Hobby plan's 100/day. Set the `HN_SNAPSHOT_SOURCES` environment variable on Vercel to change which sources
are served from the snapshot (empty = try all live).

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
serve.py   local server that mimics Vercel · start.bat (Windows launcher) · update-data.ps1 (not deployed)
vercel.json · .vercelignore · requirements.txt
```
