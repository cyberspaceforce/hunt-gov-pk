# Hunt Gov Pk - refresh the bundled job data from a computer in Pakistan and publish it.
#
# PPSC and PJP only answer requests from inside Pakistan, so Vercel cannot fetch them
# live. This script runs the scraper here, commits data/jobs.json + data/jobs.js and
# pushes them; Vercel redeploys automatically and serves the fresh data.
#
# Run once:          powershell -ExecutionPolicy Bypass -File update-data.ps1
# Every 30 minutes:  see "Keeping PPSC & PJP fresh" in README.md (Task Scheduler)

$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
$log = Join-Path $PSScriptRoot "update-data.log"

function Write-Log($msg) {
    $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $msg
    Add-Content -LiteralPath $log -Value $line -Encoding utf8
    Write-Output $line
}

Write-Log "Fetching jobs from all official sources..."
python scraper/fetch_jobs.py *>> $log
if ($LASTEXITCODE -ne 0) { Write-Log "Scraper failed (exit $LASTEXITCODE) - nothing published."; exit 1 }

git add -- data/jobs.json data/jobs.js
git diff --cached --quiet -- data/jobs.json data/jobs.js
if ($LASTEXITCODE -eq 0) { Write-Log "No changes in data - nothing to publish."; exit 0 }

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
# Commit ONLY the data files, even if other work is staged.
git commit -m "data: refresh jobs $stamp" -- data/jobs.json data/jobs.js *>> $log
if ($LASTEXITCODE -ne 0) { Write-Log "git commit failed - see log."; exit 1 }

git push *>> $log
if ($LASTEXITCODE -ne 0) { Write-Log "git push failed (pull first if the branch moved) - see log."; exit 1 }
Write-Log "Published - Vercel will redeploy with the fresh data in about a minute."
