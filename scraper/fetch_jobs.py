#!/usr/bin/env python3
"""
Hunt Gov Pk job & advertisement fetcher
===================================

Collects REAL government jobs and official advertisement PDFs from official
recruitment websites and writes them to ../data/jobs.js (loaded by the web
pages) and ../data/jobs.json.

Why a script? Browsers block web pages from reading other websites (CORS), so a
plain HTML/JS page cannot download ppsc.gop.pk directly. This script does the
fetching; the website itself stays plain HTML/CSS/JS.

Usage
-----
    python scraper/fetch_jobs.py              # fetch once
    python scraper/fetch_jobs.py --watch 30   # keep refreshing every 30 minutes
    python scraper/fetch_jobs.py --only PPSC  # fetch a single source (others keep last data)

Only the Python standard library is used (Python 3.8+).

Sources
-------
  PPSC   Punjab Public Service Commission   jobs (full details) + advertisement PDFs
  PJP    Punjab Job Portal (jobs.punjab.gov.pk) - all Punjab departments incl. AI Wing / AIDU
  OTS    Open Testing Service               jobs (all running projects/posts) + advert pages
  KPPSC  KP Public Service Commission       advertisement PDFs
  BPSC   Balochistan Public Service Comm.   advertisement / addendum PDFs
  ETEA   KP Educational Testing Agency      advertisement files
  SKMCH  Shaukat Khanum Memorial Hospital   hospital jobs (Healthcare tab)
  PKLI   Pakistan Kidney & Liver Institute  hospital jobs (Healthcare tab) + advertisement PDFs

Each source is a function returning {"jobs": [...], "ads": [...]} and is
registered in SOURCES at the bottom of the file.

Newly created departments (NCCIA, Federal Constabulary, ...) are listed in
NEW_DEPARTMENTS. Every job and advertisement is checked against that list and
tagged, so the website can highlight them.
"""

import argparse
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data")
USER_AGENT = "Mozilla/5.0 (compatible; Hunt Gov Pk job aggregator)"
TIMEOUT = 40
REQUEST_DELAY = 0.3   # seconds between sequential requests - be polite
# Parallel requests per source. Kept moderate so we don't overload government servers,
# but high enough that every source finishes well inside a 60 s serverless limit.
OTS_WORKERS = int(os.environ.get("HN_WORKERS", "10"))
# Max seconds a slow source (OTS) may spend on detail pages; keeps every source under
# Vercel's 60 s function limit. Set HN_TIME_BUDGET higher for local / CLI runs if you like.
TIME_BUDGET = float(os.environ.get("HN_TIME_BUDGET", "40"))
KPPSC_AD_LIMIT = 40   # newest N advertisements from the KPPSC archive


# --------------------------------------------------------------------------- new departments
# Recently created government bodies we specifically watch for. Any job or
# advertisement whose title/department matches one of the patterns is tagged.
NEW_DEPARTMENTS = [
    {"name": "Artificial Intelligence Delivery Unit (AIDU), AI Wing S&GAD Punjab", "est": 2026,
     "patterns": [r"\bAIDU\b", r"Artificial Intelligence (?:Delivery Unit|Wing)", r"\bAI (?:Delivery Unit|Wing)\b"],
     "website": "https://ai.punjab.gov.pk"},
    {"name": "National Cyber Crime Investigation Agency (NCCIA)", "est": 2024,
     "patterns": [r"\bNCCIA\b", r"National Cyber ?Crime Investigation"],
     "website": "https://www.nccia.gov.pk"},
    {"name": "Federal Constabulary", "est": 2025,
     "patterns": [r"Federal Constabulary"], "website": ""},
    {"name": "Pakistan Digital Authority", "est": 2025,
     "patterns": [r"Pakistan Digital Authority"], "website": ""},
    {"name": "Pakistan Virtual Assets Regulatory Authority (PVARA)", "est": 2025,
     "patterns": [r"\bPVARA\b", r"Virtual Assets Regulatory"], "website": ""},
    {"name": "Punjab Enforcement & Regulatory Authority (PERA)", "est": 2024,
     "patterns": [r"\bPERA\b", r"Enforcement (?:and|&) Regulatory Authority"], "website": ""},
    {"name": "Crime Control Department, Punjab (CCD)", "est": 2025,
     "patterns": [r"Crime Control Department"], "website": ""},
    {"name": "Special Investment Facilitation Council (SIFC)", "est": 2023,
     "patterns": [r"\bSIFC\b", r"Special Investment Facilitation"], "website": "https://sifc.gov.pk"},
    {"name": "National CERT (PKCERT)", "est": 2023,
     "patterns": [r"\bPKCERT\b", r"Computer Emergency Response Team"], "website": ""},
]
for _d in NEW_DEPARTMENTS:
    _d["regex"] = re.compile("|".join(_d["patterns"]), re.I)


def match_new_department(*texts):
    blob = " ".join(t for t in texts if t)
    for dept in NEW_DEPARTMENTS:
        if dept["regex"].search(blob):
            return dept["name"]
    return ""


# --------------------------------------------------------------------------- helpers
def log(msg):
    print(time.strftime("[%H:%M:%S] ") + msg, flush=True)


def make_opener():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", USER_AGENT)]
    return opener


def fetch(opener, url, data=None):
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    with opener.open(url, body, timeout=TIMEOUT) as resp:
        return resp.geturl(), resp.read().decode("utf-8", "ignore")


def get(url):
    return fetch(make_opener(), url)[1]


def clean(text):
    # unescape twice: some sites double-encode ("&amp;amp;")
    text = html.unescape(html.unescape(re.sub(r"<[^>]+>", " ", text or "")))
    return re.sub(r"\s+", " ", text).strip()


def html_to_lines(page):
    page = re.sub(r"<(script|style)\b.*?</\1>", "", page, flags=re.S | re.I)
    text = html.unescape(re.sub(r"<[^>]+>", "\n", page))
    return [re.sub(r"\s+", " ", ln).strip() for ln in text.split("\n") if ln.strip()]


def strip_comments(page):
    return re.sub(r"<!--.*?-->", "", page, flags=re.S)


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:60]


def to_iso(value, fmt="%d-%m-%Y"):
    try:
        return datetime.strptime(value.strip(), fmt).strftime("%Y-%m-%d")
    except (ValueError, AttributeError):
        return None


def find_date(text):
    """Find a dd-mm-yyyy / dd.mm.yyyy / dd/mm/yyyy date anywhere in text."""
    m = re.search(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})", text or "")
    if not m:
        return None
    try:
        return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1))).strftime("%Y-%m-%d")
    except ValueError:
        return None


def file_type(url):
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
    if ext == ".pdf":
        return "pdf"
    if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        return "image"
    return "page"


ACRONYMS = {
    "IT", "GIS", "JPO", "PMS", "CTD", "PDMA", "BS", "MS", "HR", "ICT", "AI", "QA", "UI", "UX",
    "SDO", "BPS", "PPSC", "LDA", "WASA", "TEVTA", "PHED", "MIS", "ERP", "DSP", "ASI", "SI",
    "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII", "ECE", "CNC", "CAD", "SQL",
    "GOP", "FBR", "OTS", "NTS", "KP", "AJK", "GB", "ICT", "PEC", "NHA", "WAPDA", "NADRA",
    "PIA", "PTCL", "LESCO", "IESCO", "MEPCO", "FESCO", "GEPCO", "PESCO", "HESCO", "QESCO",
    "SEPCO", "TESCO", "NTDC", "CPPA", "NEPRA", "NCCIA", "FIA", "PERA", "SIFC", "PVARA", "CCD", "UET", "NUST",
}
SMALL_WORDS = {"and", "of", "the", "in", "for", "to", "on", "at", "by", "or", "with"}


def smart_title(text):
    """'ASSISTANT DIRECTOR (M AND T)' -> 'Assistant Director (M and T)'."""
    def fix(match):
        word = match.group(0)
        up = word.upper()
        if up in ACRONYMS or len(word) == 1:
            return up
        if word.lower() in SMALL_WORDS and match.start() > 0:
            return word.lower()
        if not re.search(r"[AEIOUY]", up) and len(word) <= 5:
            return up
        if word != up:                      # already mixed case - keep author's casing
            return word
        return word[0].upper() + word[1:].lower()

    return re.sub(r"[A-Za-z]+", fix, text or "").strip()


# Letter-spaced fragments ("A g e a n d s e x") -> words
VOCAB = set("""
a age and sex of the transgender will be based on contents their cnic head office ppsc regional
offices lahore punjab in to for or with at by is as all any other its candidates candidate male female
years year experience post posts department posting place only shall from university recognized
""".split())


def _segment(word):
    lower = word.lower()
    best = [None] * (len(lower) + 1)
    best[0] = []
    for i in range(1, len(lower) + 1):
        for j in range(max(0, i - 14), i):
            if best[j] is not None and lower[j:i] in VOCAB:
                cand = best[j] + [(j, i)]
                if best[i] is None or len(cand) < len(best[i]):
                    best[i] = cand
    if best[-1] is None:
        return None
    return " ".join(word[a:b] for a, b in best[-1])


def fix_letter_spacing(text):
    tokens = (text or "").split(" ")
    out, i = [], 0
    while i < len(tokens):
        j = i
        while j < len(tokens) and 0 < len(tokens[j]) <= 3 and tokens[j].isalpha():
            j += 1
        span = tokens[i:j]
        singles = sum(1 for t in span if len(t) == 1)
        if len(span) >= 4 and singles >= len(span) * 0.6:
            seg = _segment("".join(span))
            out.append(seg if seg else " ".join(span))
            i = j
        else:
            out.append(tokens[i])
            i += 1
    return " ".join(out)


def to_int(value):
    m = re.search(r"\d+", str(value or ""))
    return int(m.group(0)) if m else 0


def ad_record(source, title, url, date=None, organization="", ad_no="", kind=None, note=""):
    return {
        "id": source.lower() + "-ad-" + slug((ad_no or "") + "-" + title + "-" + (date or "")),
        "source": source,
        "title": title,
        "organization": organization,
        "adNo": ad_no,
        "date": date,
        "url": url,
        "type": kind or file_type(url),
        "note": note,
    }


# =========================================================================== PPSC
PPSC_BASE = "https://www.ppsc.gop.pk/"
PPSC_JOBS = PPSC_BASE + "Jobs.aspx"

PPSC_LABELS = {
    "Department:": "department", "Advertisement Number:": "adNo", "Case Number:": "caseNo",
    "Qualification:": "qualification", "Total Number of Posts:": "posts",
    "Posts for Women:": "postsWomen", "Posts for Special Persons::": "postsSpecial",
    "Posts for Special Persons:": "postsSpecial", "Posts for Minorities:": "postsMinorities",
    "Special Zone Quota:": "postsSpecialZone", "Other Quota:": "postsOther",
    "Experience:": "experience", "Pay Scale:": "payScale", "Age:": "age",
    "Eligibililty:": "eligibility", "Eligibility:": "eligibility",
    "Place Of Posting:": "placeOfPosting", "Additional Requirement:": "additionalRequirement",
    "Research:": "research", "Preferences:": "preferences", "Fee:": "fee",
    "Closing Date:": "closingDate", "Note:": "note", "Disclaimer:": None,
}


def ppsc_hidden_fields(page):
    return {n: html.unescape(v) for n, v in
            re.findall(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', page)}


def ppsc_parse_list(page):
    ads = {}
    for href, ad_no in re.findall(r"href='(Adds/[^']+\.pdf)'>([^<]+)</a>", page, flags=re.I):
        ads[ad_no.strip()] = {"url": PPSC_BASE + urllib.parse.quote(href), "file": href}
    rows = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S):
        cells = [clean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S)]
        target = re.search(r"__doPostBack\(&#39;([^&]+)&#39;", row) or re.search(r"__doPostBack\('([^']+)'", row)
        if len(cells) >= 8 and cells[0].isdigit() and target:
            rows.append({"adNo": cells[1], "caseNo": cells[2], "title": cells[3], "fee": cells[4],
                         "department": cells[5], "adDate": cells[6], "closingDate": cells[7],
                         "target": target.group(1)})
    return rows, ads


def ppsc_parse_detail(page):
    out, key, buf = {}, None, []

    def flush():
        if key:
            value = fix_letter_spacing(" ".join(buf).strip())
            out[key] = "" if value in ("0", "-", "N/A") else value

    for line in html_to_lines(page):
        if line in PPSC_LABELS:
            flush()
            key, buf = PPSC_LABELS[line], []
            if key is None:
                break
        elif key:
            buf.append(line)
    flush()
    return out


def fetch_ppsc():
    opener = make_opener()
    list_url, page = fetch(opener, PPSC_JOBS)
    rows, ads = ppsc_parse_list(page)
    form = ppsc_hidden_fields(page)
    log("PPSC: %d posts listed, %d advertisements" % (len(rows), len(ads)))

    jobs = []
    for i, row in enumerate(rows, 1):
        detail = {}
        for _ in range(2):
            try:
                _, dpage = fetch(opener, list_url, dict(form, __EVENTTARGET=row["target"], __EVENTARGUMENT=""))
                detail = ppsc_parse_detail(dpage)
                if detail.get("caseNo", "").upper() == row["caseNo"].upper():
                    break
                list_url, page = fetch(opener, PPSC_JOBS)  # stale session - reload & retry
                form = ppsc_hidden_fields(page)
                detail = {}
            except Exception as exc:
                log("  ! PPSC detail failed for %s: %s" % (row["caseNo"], exc))
                detail = {}
        time.sleep(REQUEST_DELAY)

        experience = detail.get("experience", "")
        if experience and experience == detail.get("qualification"):
            experience = ""
        ad = ads.get(row["adNo"], {})
        jobs.append({
            "id": "ppsc-" + slug(row["caseNo"]),
            "source": "PPSC", "sourceName": "Punjab Public Service Commission",
            "sourceUrl": PPSC_JOBS, "applyUrl": PPSC_JOBS, "detailsUrl": PPSC_JOBS,
            "howToApplyUrl": PPSC_BASE + "Misc_Uploading/PPSC%20Online%20Application%20Procedure.pdf",
            "advertisementUrl": ad.get("url", ""),
            "region": "Punjab", "sector": "Provincial",
            "title": smart_title(row["title"]), "titleRaw": row["title"],
            "department": smart_title(detail.get("department") or row["department"]),
            "adNo": row["adNo"], "caseNo": row["caseNo"],
            "adDate": to_iso(row["adDate"]),
            "closingDate": to_iso(detail.get("closingDate") or row["closingDate"]),
            "fee": to_int(detail.get("fee") or row["fee"]),
            "payScale": detail.get("payScale", ""),
            "posts": to_int(detail.get("posts")),
            "postsWomen": to_int(detail.get("postsWomen")),
            "postsSpecial": to_int(detail.get("postsSpecial")),
            "postsMinorities": to_int(detail.get("postsMinorities")),
            "qualification": detail.get("qualification", ""),
            "experience": experience,
            "age": detail.get("age", ""),
            "eligibility": detail.get("eligibility", ""),
            "placeOfPosting": detail.get("placeOfPosting", ""),
            "additionalRequirement": detail.get("additionalRequirement", ""),
            "preferences": detail.get("preferences", ""),
            "note": detail.get("note", ""),
            "hasDetails": bool(detail),
        })
        log("  PPSC %2d/%d %s" % (i, len(rows), jobs[-1]["title"]))

    ad_list = []
    for ad_no, ad in ads.items():
        departments = sorted({j["department"] for j in jobs if j["adNo"] == ad_no})
        ad_list.append(ad_record(
            "PPSC", "Advertisement No. " + ad_no, ad["url"], date=find_date(ad["file"]),
            organization="Punjab Public Service Commission", ad_no=ad_no,
            note=("Posts in: " + ", ".join(departments)) if departments else ""))
    return {"jobs": jobs, "ads": ad_list}


# =========================================================================== OTS
OTS_BASE = "https://ots.org.pk/"
# OTS also runs admissions, scholarships, training and its own staff hiring - not government jobs.
OTS_EXCLUDE_ORG = re.compile(r"\bOTS\b|Open Testing Service|Private Sector|Dalda|Scholarship", re.I)
OTS_EXCLUDE_TYPES = {"admission test", "training program"}


def ots_project_ids():
    """Read page 1, learn the page count, then fetch the remaining list pages in parallel."""
    url = OTS_BASE + "projects.php?status=running&q=&page=%d"
    first = get(url % 1)
    found_re = r'data-card-link="project-view\.php\?pview=(\d+)"'
    total = re.search(r"(\d+)\s+found", first)
    per_page = max(1, len(re.findall(found_re, first)))
    pages = max([1] + [int(n) for n in re.findall(r"[?&]page=(\d+)", first)])
    if total:
        pages = max(pages, -(-int(total.group(1)) // per_page))

    def page_ids(n):
        try:
            return re.findall(found_re, get(url % n))
        except Exception as exc:
            log("  ! OTS list page %d failed: %s" % (n, exc))
            return []

    with ThreadPoolExecutor(max_workers=OTS_WORKERS) as pool:
        rest = list(pool.map(page_ids, range(2, pages + 1)))
    ids = []
    for chunk in [re.findall(found_re, first)] + rest:
        ids.extend(i for i in chunk if i not in ids)
    return ids


def ots_project(pview):
    url = OTS_BASE + "project-view.php?pview=" + pview
    page = get(url)
    title = clean((re.search(r"<h1>(.*?)</h1>", page, re.S) or [None, ""])[1])
    meta = [clean(m) for m in re.findall(r'<div class="ots-v2-inner-meta">(.*?)</div>', page, re.S)[:1]]
    meta_text = meta[0] if meta else ""
    published = re.search(r"Published (\d{1,2} \w{3} \d{4})", meta_text)
    code = re.search(r"Code (\S+)", meta_text)
    published_iso = to_iso(published.group(1), "%d %b %Y") if published else None

    posts = []
    for card in re.findall(r'<article class="ots-v2-category-card.*?</article>', page, re.S):
        pid = re.search(r"pid=(\d+)", card)
        name = re.search(r"<h2>(.*?)</h2>", card, re.S)
        status = re.search(r'ots-v2-card-label">(.*?)<', card)
        fields = {clean(k): clean(v) for k, v in re.findall(r"<dt>(.*?)</dt>\s*<dd>(.*?)</dd>", card, re.S)}
        if pid and name:
            posts.append({"pid": pid.group(1), "title": clean(name.group(1)),
                          "status": clean(status.group(1)) if status else "",
                          "type": fields.get("Type", ""),
                          "closingDate": to_iso(fields.get("Last date", ""), "%d %b %Y")})

    announcement = ""
    m = re.search(r'id="projectAnnouncement".*?<a[^>]*>(.*?)</a>', page, re.S)
    if m:
        announcement = clean(m.group(1))
    return {"pview": pview, "url": url, "title": title, "code": code.group(1) if code else "",
            "published": published_iso, "posts": posts, "announcement": announcement}


def fetch_ots():
    ids = ots_project_ids()
    log("OTS: %d running projects" % len(ids))

    def safe(pview):
        try:
            return ots_project(pview)
        except Exception as exc:
            log("  ! OTS project %s failed: %s" % (pview, exc))
            return None

    # OTS lists newest projects first. Fetch them in parallel within a time budget so the
    # source always finishes inside a serverless time limit; anything not reached in time
    # is an older project (almost always expired already).
    deadline = time.time() + TIME_BUDGET
    pool = ThreadPoolExecutor(max_workers=OTS_WORKERS * 2)
    futures = {pool.submit(safe, pview): pview for pview in ids}
    results = {}
    try:
        for fut in as_completed(futures, timeout=max(1, deadline - time.time())):
            results[futures[fut]] = fut.result()
    except FuturesTimeout:
        log("  ! OTS time budget reached: %d of %d projects checked" % (len(results), len(ids)))
    for fut in futures:
        fut.cancel()
    pool.shutdown(wait=False)
    projects = [results[p] for p in ids if results.get(p)]

    # OTS keeps many projects "running" long after their last date, so we only keep
    # posts whose stated last date is today or later. Undated posts are skipped
    # (they are typically old, e.g. 2018 admission tests).
    today = datetime.now().strftime("%Y-%m-%d")
    jobs, ads, skipped = [], [], 0
    for p in projects:
        org = smart_title(p["title"])
        if OTS_EXCLUDE_ORG.search(p["title"]):
            skipped += len(p["posts"])
            continue
        open_posts = [post for post in p["posts"]
                      if post["status"].lower() != "closed"
                      and post["type"].lower() not in OTS_EXCLUDE_TYPES
                      and post["closingDate"] and post["closingDate"] >= today]
        skipped += len(p["posts"]) - len(open_posts)
        if not open_posts:
            continue
        for post in open_posts:
            jobs.append({
                "id": "ots-" + post["pid"],
                "source": "OTS", "sourceName": "Open Testing Service",
                "sourceUrl": p["url"],
                "detailsUrl": OTS_BASE + "project-details.php?pid=" + post["pid"],
                "applyUrl": OTS_BASE + "online3/project-details.php?pid=" + post["pid"],
                "advertisementUrl": p["url"],
                "region": "", "sector": "",
                "title": smart_title(post["title"]), "titleRaw": post["title"],
                "department": org,
                "adNo": "", "caseNo": "", "projectCode": p["code"], "testType": post["type"],
                "adDate": p["published"], "closingDate": post["closingDate"],
                "fee": None, "payScale": "", "posts": 0,
                "postsWomen": 0, "postsSpecial": 0, "postsMinorities": 0,
                "qualification": "", "experience": "", "age": "", "eligibility": "",
                "placeOfPosting": "", "additionalRequirement": "", "preferences": "", "note": "",
                "hasDetails": False,
            })
        ads.append(ad_record(
            "OTS", p["announcement"] or ("Advertisement — " + org), p["url"], date=p["published"],
            organization=org, ad_no=p["code"], kind="page",
            note="%d open post(s). OTS issues time-limited PDF links, so this opens the official project page with the latest advertisement." % len(open_posts)))
    log("OTS: %d open government posts kept, %d expired/undated/non-government skipped (%d projects scanned)"
        % (len(jobs), skipped, len(projects)))
    return {"jobs": jobs, "ads": ads}


# =========================================================================== Punjab Job Portal
# jobs.punjab.gov.pk - the Government of Punjab's official portal. Hundreds of
# Punjab departments (incl. the S&GAD Artificial Intelligence Wing / AIDU) post here.
PJP_BASE = "https://jobs.punjab.gov.pk/"
PJP_LIST = PJP_BASE + "new_recruit/jobs"
PJP_SECTIONS = ["Job Description", "Job Responsibilities", "Degree Level", "Degree Area", "Required Skills", "Important Note"]
PJP_END = {"Google Play Store", "Apply for this Job", "View Advertisement", "Sitemap"}


def pjp_detail(slug):
    url = PJP_BASE + "new_recruit/job_detail/" + slug
    try:
        page = get(url)
    except Exception as exc:
        log("  ! PJP detail %s failed: %s" % (slug, exc))
        return {"url": url}
    table = {clean(k).rstrip(":"): clean(v) for k, v in re.findall(r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>", page, re.S)}
    lines = html_to_lines(page)

    def after(label):
        if label in lines:
            i = lines.index(label)
            return lines[i + 1] if i + 1 < len(lines) else ""
        return ""

    sections, current = {}, None
    start = lines.index("Back to Listings") if "Back to Listings" in lines else 0
    for ln in lines[start:]:
        if ln in PJP_END:
            break
        if ln in PJP_SECTIONS:
            current = ln
            sections[current] = []
        elif current and re.search(r"[A-Za-z0-9]", ln) and ln not in ("Degree Name", "Degree Title"):
            sections[current].append(ln)

    experience = ""
    if "Years of Experience:" in lines:
        i = lines.index("Years of Experience:")
        experience = " ".join(lines[i + 1:i + 3]).replace(" :", ":")
    ad = re.search(r'href="([^"]*PJP-Uploads/[^"]+)"[^>]*>\s*View Advertisement', page)
    return {"url": url, "table": table, "sections": sections, "experience": experience,
            "gender": table.get("Gender") or after("Gender"), "age": table.get("Age") or after("Age"),
            "advertisement": ad.group(1).replace(" ", "%20") if ad else ""}


def tidy_salary(value):
    """'0 - 400,000' -> 'Up to 400,000'; empty / N/A -> ''."""
    value = (value or "").strip()
    if not value or value.upper() in ("N/A", "NA", "-", "0"):
        return ""
    m = re.match(r"^0\s*-\s*(.+)$", value)
    return "Up to " + m.group(1) if m else value


def split_job_description(lines):
    """'QUALIFICATION ... EXPERIENCE ...' -> (qualification, experience)."""
    qual, exp, bucket = [], [], None
    for ln in lines:
        up = ln.upper().rstrip(":")
        if up in ("QUALIFICATION", "QUALIFICATIONS", "EDUCATION"):
            bucket = qual
        elif up in ("EXPERIENCE", "WORK EXPERIENCE"):
            bucket = exp
        else:
            (bucket if bucket is not None else qual).append(ln)
    return " ".join(qual), " ".join(exp)


def fetch_pjp():
    page = get(PJP_LIST)
    rows = []
    for row in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        slug = re.search(r"job_detail/([a-z0-9\-]+)", row)
        cells = {k: clean(v) for k, v in re.findall(r'<td data-label="([^"]+)"[^>]*>(.*?)</td>', row, re.S)}
        last = re.findall(r"<td>(\d{2}-\w{3}-\d{4})</td>", row)
        if slug and cells.get("Job Title"):
            rows.append({"slug": slug.group(1), "title": cells["Job Title"], "department": cells.get("Department", ""),
                         "project": cells.get("Project", ""), "closing": to_iso(last[0], "%d-%b-%Y") if last else None})
    log("PJP: %d jobs listed" % len(rows))

    with ThreadPoolExecutor(max_workers=OTS_WORKERS) as pool:
        details = list(pool.map(pjp_detail, [r["slug"] for r in rows]))

    jobs, ads = [], {}
    for row, d in zip(rows, details):
        t, sec = d.get("table", {}), d.get("sections", {})
        qualification, exp_text = split_job_description(sec.get("Job Description", []))
        degree_area = sec.get("Degree Area", [])
        title = t.get("Role") or smart_title(row["title"])
        gender = {"Both": "Male & Female"}.get(d.get("gender", ""), d.get("gender", ""))
        district, division = t.get("District", "").title().strip(), t.get("Division", "").strip()
        place = district if district.lower() == division.lower() else ", ".join(x for x in (district, division) if x)
        details_list = []
        for name in ("Job Responsibilities", "Degree Level", "Degree Area", "Required Skills"):
            if sec.get(name):
                details_list.append("## " + name)
                details_list.extend(sec[name])
        it_areas = [a for a in degree_area
                    if re.search(r"computer|software|information technology|data science|artificial intelligence", a, re.I)]
        it = bool(IT_PATTERN.search(title)) or (bool(degree_area) and len(it_areas) * 2 > len(degree_area))
        ad_url = d.get("advertisement", "")
        jobs.append({
            "id": "pjp-" + row["slug"],
            "source": "PJP", "sourceName": "Punjab Job Portal (Government of Punjab)",
            "sourceUrl": PJP_LIST, "applyUrl": d["url"], "detailsUrl": d["url"],
            "advertisementUrl": ad_url,
            "region": "Punjab", "sector": "Provincial",
            "title": title, "titleRaw": row["title"],
            "department": row["department"], "project": row["project"],
            "adNo": "", "caseNo": "",
            "adDate": to_iso(t.get("Job Posted", "")), "closingDate": to_iso(t.get("Last Date to Apply", "")) or row["closing"],
            "fee": None, "payScale": "" if t.get("Level", "").upper() in ("N/A", "NA", "-") else t.get("Level", ""),
            "salary": tidy_salary(t.get("Monthly Salary", "")),
            "employmentType": t.get("Employment Status", ""),
            "posts": to_int(t.get("Total Positions")),
            "postsWomen": 0, "postsSpecial": 0, "postsMinorities": 0,
            "qualification": qualification, "experience": exp_text or d.get("experience", ""),
            "age": (d.get("age", "") + " years") if d.get("age") else "",
            "eligibility": gender, "placeOfPosting": place,
            "additionalRequirement": "", "preferences": "",
            "note": " ".join(sec.get("Important Note", [])).split("For Getting Domicile")[0].strip(),
            "details": details_list, "itJob": it,
            "hasDetails": bool(t),
        })
        if ad_url and ad_url not in ads:
            ads[ad_url] = ad_record("PJP", "Advertisement — " + row["department"], ad_url,
                                    date=jobs[-1]["adDate"], organization=row["department"],
                                    note=row["project"] if row["project"] != row["department"] else "")
    log("PJP: %d jobs (%d Computer Science & IT), %d advertisements"
        % (len(jobs), sum(1 for j in jobs if j["itJob"]), len(ads)))
    return {"jobs": jobs, "ads": list(ads.values())}


# =========================================================================== KPPSC
KPPSC_ARCHIVE = "https://www.kppsc.gov.pk/advertisement_archive"


def fetch_kppsc():
    page = get(KPPSC_ARCHIVE)
    ads = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        link = re.search(r'href="([^"]+\.(?:pdf|jpe?g|png))"', row, re.I)
        title = clean(row)
        if not link or not title:
            continue
        ad_no = re.search(r"NO\.?\s*(\d+\s*/\s*\d{4})", title, re.I)
        ads.append(ad_record("KPPSC", smart_title(re.sub(r"\(Dated:.*?\)", "", title).strip()), link.group(1),
                             date=find_date(title), organization="Khyber Pakhtunkhwa Public Service Commission",
                             ad_no=ad_no.group(1).replace(" ", "") if ad_no else ""))
        if len(ads) >= KPPSC_AD_LIMIT:
            break
    log("KPPSC: %d advertisements" % len(ads))
    return {"jobs": [], "ads": ads}


# =========================================================================== BPSC
BPSC_JOBS = "https://www.bpsc.gob.pk/BPSC/pages?jobs"


def fetch_bpsc():
    page = get(BPSC_JOBS)
    ads = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        link = re.search(r'href="([^"]+/uploads/Jobs/[^"]+)"', row)
        title = clean(row)
        if not link or not title:
            continue
        date = find_date(title)
        stamp = re.search(r"/(\d{9,10})\.\w+$", link.group(1))   # file names are upload timestamps
        if not date and stamp:
            date = datetime.fromtimestamp(int(stamp.group(1))).strftime("%Y-%m-%d")
        ad_no = re.search(r"No\.?\s*(\d+\s*[-/]\s*\d{4})", title, re.I)
        ads.append(ad_record("BPSC", title, link.group(1), date=date,
                             organization="Balochistan Public Service Commission",
                             ad_no=ad_no.group(1).replace(" ", "").replace("-", "/") if ad_no else ""))
    log("BPSC: %d advertisements / notices" % len(ads))
    return {"jobs": [], "ads": ads}


# =========================================================================== ETEA
ETEA_HOME = "https://etea.edu.pk/"


def fetch_etea():
    page = strip_comments(get(ETEA_HOME))   # expired adverts are commented out on the page
    ads = []
    for card in re.findall(r'<div class="material-card-content">(.*?)</p>\s*</div>', page, re.S):
        title = clean((re.search(r"<h3[^>]*>(.*?)</h3>", card, re.S) or [None, ""])[1])
        links = re.findall(r'href="(https?://[^"]*/advertisement/(?!course_content)[^"]+)"', card)
        for n, url in enumerate(links, 1):
            label = title + (" (page %d)" % n if len(links) > 1 else "")
            ads.append(ad_record("ETEA", label, url, organization="ETEA Khyber Pakhtunkhwa"))
    log("ETEA: %d advertisements" % len(ads))
    return {"jobs": [], "ads": ads}


# =========================================================================== hospitals
# Hospital jobs are shown on a separate "Healthcare" tab (group = "healthcare").
# Each job gets a "field" so candidates can jump straight to e.g. Computer Science & IT.
FIELDS = {
    "it": "Computer Science & IT",
    "medical": "Medical & Clinical",
    "nursing": "Nursing & Paramedical",
    "pharmacy": "Pharmacy",
    "research": "Research",
    "admin": "Management & Technical",
}
IT_PATTERN = re.compile(
    r"\b(IT|ICT|MIS|ERP|HIS|DBA|software|developer|programmer|programming|network|database|computer|"
    r"information technology|information security|cyber|web|data (?:analyst|scientist|engineer|base)|"
    r"system(?:s)? (?:administrator|analyst|engineer|support)|help ?desk|devops|cloud|"
    r"business intelligence|informatics|application support|SAP|oracle|\.net|java|python)\b", re.I)


def classify_field(text, default="admin"):
    if IT_PATTERN.search(text or ""):
        return "it"
    t = (text or "").lower()
    if re.search(r"nurs|paramedic|midwi|technologist|technician \(lab|lhv", t):
        return "nursing"
    if re.search(r"pharma", t):
        return "pharmacy"
    if re.search(r"research|clinical trial|biostat", t):
        return "research"
    if re.search(r"medical services|clinical services|consultant|registrar|physician|surgeon|medical officer|"
                 r"radiolog|patholog|histopath|anesth|anaesth|cardio|nephro|urolog|oncolog|fellow|trainee|"
                 r"dental|physiotherap|dietitian|nutrition", t):
        return "medical"
    return default


def hospital_job(**kw):
    base = {
        "group": "healthcare", "sector": "Healthcare", "adNo": "", "caseNo": "", "fee": None,
        "payScale": "", "posts": 0, "postsWomen": 0, "postsSpecial": 0, "postsMinorities": 0,
        "qualification": "", "experience": "", "age": "", "eligibility": "", "placeOfPosting": "",
        "additionalRequirement": "", "preferences": "", "note": "", "hasDetails": True,
        "description": "", "details": [], "advertisementUrl": "",
    }
    base.update(kw)
    base["fieldLabel"] = FIELDS[base["field"]]
    return base


def html_block_to_lines(fragment):
    text = re.sub(r"<br\s*/?>", "\n", fragment or "", flags=re.I)
    text = re.sub(r"</(p|li|div|h\d)>", "\n", text, flags=re.I)
    text = html.unescape(html.unescape(re.sub(r"<[^>]+>", " ", text)))
    out = []
    for line in text.split("\n"):
        line = re.sub(r"\s+", " ", line).strip(" •-–\t")
        if line:
            out.append(line)
    return out


# --------------------------------------------------------------- Shaukat Khanum
SKM_BASE = "https://shaukatkhanum.org.pk/"
SKM_CATEGORIES = {1: ("Medical", "medical"), 2: ("Nursing & Paramedical", "nursing"),
                  7: ("Management, Administration & Technical", "admin"), 8: ("Research", "research"),
                  20: ("Pharmacy", "pharmacy")}
SKM_JOB = re.compile(
    r"<small>\s*\d+\s*-\s*(?P<title>.*?)<span class='pull-right'>(?P<loc>.*?)<span"
    r".*?<div class='panel'[^>]*>(?P<body>.*?)</div>"
    r".*?Closing Date:\s*<strong>(?P<close>.*?)</strong>"
    r".*?href=\"(?P<apply>[^\"]*job_id=(?P<id>\d+)[^\"]*)\"", re.S)


def fetch_skmch():
    jobs, seen = [], set()
    for cat_id, (cat_name, cat_field) in SKM_CATEGORIES.items():
        url = SKM_BASE + "job-openings/?cat_id=%d" % cat_id
        page = get(url)
        for m in SKM_JOB.finditer(page):
            if m.group("id") in seen:
                continue
            seen.add(m.group("id"))
            title = clean(m.group("title"))
            body = m.group("body")
            parts = re.split(r"Eligibility Criteria:?", body, maxsplit=1, flags=re.I)
            description = " ".join(html_block_to_lines(parts[0]))
            eligibility = []
            if len(parts) > 1:
                raw = " ".join(html_block_to_lines(parts[1]))
                eligibility = [p.strip() for p in re.split(r"\s+-\s*|^-\s*", raw) if p.strip()]
            location = clean(m.group("loc")).title().replace("Skmch & Rc", "SKMCH&RC").replace("Skmch&Rc", "SKMCH&RC")
            city = location.split(",")[-1].strip() if "," in location else location
            field = classify_field(title, cat_field)   # title only - descriptions mention "computer" etc. too often
            jobs.append(hospital_job(
                id="skm-" + m.group("id"),
                source="SKMCH", sourceName="Shaukat Khanum Memorial Cancer Hospital & Research Centre",
                sourceUrl=url, applyUrl=html.unescape(m.group("apply")), detailsUrl=url,
                department="Shaukat Khanum Memorial Cancer Hospital & Research Centre",
                hospitalDept=cat_name, region=city, placeOfPosting=location,
                title=smart_title(title), titleRaw=title,
                adDate=None, closingDate=to_iso(clean(m.group("close")), "%A %B %d, %Y"),
                field=field, description=description, details=eligibility,
                qualification=" ".join(eligibility[:1]),
            ))
        time.sleep(REQUEST_DELAY)
    log("SKMCH: %d jobs (%d in Computer Science & IT)" % (len(jobs), sum(1 for j in jobs if j["field"] == "it")))
    return {"jobs": jobs, "ads": []}


# --------------------------------------------------------------- PKLI
PKLI_PORTAL = "https://jobs.pkli.org.pk:440/"
PKLI_CAREERS = "https://pkli.org.pk/careers/"
PKLI_CARD = re.compile(
    r"JobDetail/(?P<id>\d+)'[^>]*>(?P<title>[^<]+)</a>.*?job--location\">(?P<loc>.*?)</div>"
    r".*?job--desc\">(?P<desc>.*?)</div>.*?Posted On.*?</i>&nbsp;(?P<posted>[^<]+)</div>"
    r".*?Expiry Date.*?</i>&nbsp;(?P<expiry>[^<]+)</div>", re.S)
PKLI_DETAIL_END = re.compile(r"^(Apply Now|Close|Copyright|©)", re.I)


def pkli_detail(job_id):
    try:
        page = get(PKLI_PORTAL + "Job/JobDetail/" + job_id)
    except Exception:
        return []
    lines = html_to_lines(page)
    if "Job Details" in lines:
        lines = lines[lines.index("Job Details") + 1:]
    # The portal wraps text at fixed widths and uses lone "·" lines as bullets.
    # Rebuild items: bullets / sentence ends start a new item, short "Heading:" lines
    # become headings (prefixed with "## " for the website).
    items, current = [], ""
    for ln in lines:
        if PKLI_DETAIL_END.match(ln):
            break
        if ln in ("·", "•", "-", "o", "§"):
            if current:
                items.append(current)
            current = ""
            continue
        ln = ln.lstrip("·•§ ").strip()
        if not ln:
            continue
        if ln.endswith(":") and len(ln) <= 40:
            if current:
                items.append(current)
            items.append("## " + ln.rstrip(":"))
            current = ""
            continue
        if re.match(r"^(Job (Functions|Description|Responsibilities)|Qualification|Experience|Skills|Requirements)$", ln, re.I):
            if current:
                items.append(current)
            items.append("## " + ln)
            current = ""
            continue
        if current and not re.search(r"[.;!?]$", current):
            current += ("" if current.endswith("/") or ln.startswith("/") else " ") + ln
        else:
            if current:
                items.append(current)
            current = ln
    if current:
        items.append(current)
    return items[:60]


def fetch_pkli():
    cards, offset = {}, 0
    while offset <= 300:
        page = get(PKLI_PORTAL + "Job/Search/?searchText=&departmentId=&departmentType=&offset=%d" % offset)
        found = 0
        for m in PKLI_CARD.finditer(page):
            if m.group("id") not in cards:
                cards[m.group("id")] = m
                found += 1
        if not found:
            break
        offset += 10
        time.sleep(REQUEST_DELAY)

    with ThreadPoolExecutor(max_workers=OTS_WORKERS) as pool:
        details = dict(zip(cards, pool.map(pkli_detail, list(cards))))

    jobs = []
    for job_id, m in cards.items():
        desc = clean(m.group("desc"))
        seats = re.search(r"No of Seats are (\d+)", desc)
        exp = re.search(r"minimum expierence of (\d+) Year", desc, re.I)
        dept = re.search(r"for the Department (.+?) and last date", desc)
        dept = dept.group(1).strip() if dept else ""
        title = clean(m.group("title"))
        location = clean(m.group("loc"))
        field = classify_field(title + " " + dept, classify_field(dept, "admin"))
        if dept.upper() == "ICT":
            field = "it"
        jobs.append(hospital_job(
            id="pkli-" + job_id,
            source="PKLI", sourceName="Pakistan Kidney & Liver Institute and Research Centre",
            sourceUrl=PKLI_PORTAL, applyUrl=PKLI_PORTAL, detailsUrl=PKLI_PORTAL,
            advertisementUrl=PKLI_CAREERS,
            department="Pakistan Kidney & Liver Institute (PKLI)", hospitalDept=dept,
            region=location, placeOfPosting=location,
            title=smart_title(title) if title.isupper() else title, titleRaw=title,
            adDate=to_iso(clean(m.group("posted")), "%b %d, %Y"),
            closingDate=to_iso(clean(m.group("expiry")), "%b %d, %Y"),
            posts=int(seats.group(1)) if seats else 0,
            experience=("%s year(s) minimum" % exp.group(1)) if exp and exp.group(1) != "0" else "",
            field=field, details=details.get(job_id) or [],
        ))

    # Recent advertisement PDFs from the PKLI careers page
    ads = []
    try:
        page = get(PKLI_CAREERS)
        for url in re.findall(r'href="(https://pkli\.org\.pk/wp-content/uploads/\d{4}/\d{2}/[^"]+\.(?:pdf|jpe?g|png))"', page, re.I):
            if not re.search(r"job|advert", url, re.I) or re.search(r"instruction", url, re.I)                     or any(a["url"] == url for a in ads):
                continue
            name = os.path.splitext(os.path.basename(url))[0]
            date = find_date(name)
            compact = re.search(r"(\d{2})(\d{2})(20\d{2})", name)
            if not date and compact:
                date = find_date("%s-%s-%s" % compact.groups())
            if not date:
                words = re.search(r"(\d{1,2})[\s_\-]+([A-Za-z]{3})[A-Za-z]*[\s_\-]+(20\d{2})", name)
                if words:
                    date = to_iso("%s %s %s" % (words.group(1), words.group(2).title(), words.group(3)), "%d %b %Y")
            where = [label for key, label in (("lhr", "Lahore"), ("lahore", "Lahore"), ("rwp", "Rawalpindi"),
                                              ("fc", "Filter Clinics"), ("ipc", "Infection Prevention & Control"),
                                              ("nurs", "Nursing"), ("quality", "Quality"), ("dean", "Dean"))
                     if re.search(r"(^|[_\-\s])" + key, name, re.I)]
            title = "PKLI Job Advertisement" + (" — " + ", ".join(dict.fromkeys(where)) if where else "")
            ads.append(ad_record("PKLI", title, url, date=date,
                                 organization="Pakistan Kidney & Liver Institute (PKLI)"))
            if len(ads) >= 10:
                break
    except Exception as exc:
        log("  ! PKLI careers page failed: %s" % exc)

    log("PKLI: %d jobs (%d in Computer Science & IT), %d advertisements"
        % (len(jobs), sum(1 for j in jobs if j["field"] == "it"), len(ads)))
    return {"jobs": jobs, "ads": ads}


# =========================================================================== runner
SOURCES = [
    {"id": "PPSC", "name": "Punjab Public Service Commission", "url": PPSC_JOBS, "fetch": fetch_ppsc},
    {"id": "PJP", "name": "Punjab Job Portal (Government of Punjab)", "url": PJP_LIST, "fetch": fetch_pjp},
    {"id": "OTS", "name": "Open Testing Service", "url": OTS_BASE + "projects.php", "fetch": fetch_ots},
    {"id": "KPPSC", "name": "Khyber Pakhtunkhwa Public Service Commission", "url": KPPSC_ARCHIVE, "fetch": fetch_kppsc},
    {"id": "BPSC", "name": "Balochistan Public Service Commission", "url": BPSC_JOBS, "fetch": fetch_bpsc},
    {"id": "ETEA", "name": "Educational Testing & Evaluation Agency", "url": ETEA_HOME, "fetch": fetch_etea},
    {"id": "SKMCH", "name": "Shaukat Khanum Memorial Cancer Hospital", "url": SKM_BASE + "join-us/current-vacancies/",
     "fetch": fetch_skmch, "group": "healthcare"},
    {"id": "PKLI", "name": "Pakistan Kidney & Liver Institute", "url": PKLI_PORTAL, "fetch": fetch_pkli, "group": "healthcare"},
]


def load_previous():
    try:
        with open(os.path.join(OUT_DIR, "jobs.json"), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {"jobs": [], "advertisements": [], "sources": []}


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def source_by_id(source_id):
    return next((s for s in SOURCES if s["id"] == (source_id or "").upper()), None)


def fetch_source(source_id, previous=None):
    """
    Fetch ONE source and return a self-contained block:
        {"id", "name", "url", "group", "ok", "checkedAt", "error"?, "jobs": [...], "ads": [...]}
    On failure the last saved data for that source is returned (ok = False), so callers
    never lose listings because a government site is temporarily down.
    Used by the CLI (run_once) and by the Vercel function (api/source.py).
    """
    src = source_by_id(source_id)
    if not src:
        raise KeyError("Unknown source: %s" % source_id)
    started = time.time()
    try:
        result = src["fetch"]()
        status = {"ok": True, "checkedAt": now_iso()}   # time the data was actually fetched
    except Exception as exc:
        log("%s FAILED: %s (keeping previous data)" % (src["id"], exc))
        previous = previous if previous is not None else load_previous()
        result = {"jobs": [j for j in previous.get("jobs", []) if j.get("source") == src["id"]],
                  "ads": [a for a in previous.get("advertisements", []) if a.get("source") == src["id"]]}
        status = {"ok": False, "checkedAt": now_iso(), "error": str(exc)}

    for job in result["jobs"]:
        job.setdefault("group", "government")
        if "itJob" not in job:
            job["itJob"] = job["group"] == "government" and bool(IT_PATTERN.search(job["title"]))
        job["newDepartment"] = match_new_department(job["title"], job["department"], job.get("project"))
    for ad in result["ads"]:
        ad["newDepartment"] = match_new_department(ad["title"], ad["organization"], ad.get("note"))

    return dict(status, id=src["id"], name=src["name"], url=src["url"], group=src.get("group", "government"),
                seconds=round(time.time() - started, 1),
                jobs=result["jobs"], ads=result["ads"])


def new_department_summary(jobs, ads):
    return [{"name": d["name"], "est": d["est"], "website": d["website"],
             "jobs": sum(1 for j in jobs if j.get("newDepartment") == d["name"]),
             "ads": sum(1 for a in ads if a.get("newDepartment") == d["name"])} for d in NEW_DEPARTMENTS]


def run_once(only=None):
    previous = load_previous()
    prev_status = {s["id"]: s for s in previous.get("sources", [])}
    targets = [s for s in SOURCES if not only or s["id"] in only]

    # All sources run in parallel - total time is roughly that of the slowest source.
    with ThreadPoolExecutor(max_workers=len(targets) or 1) as pool:
        fetched = {b["id"]: b for b in pool.map(lambda s: fetch_source(s["id"], previous), targets)}

    jobs, ads, statuses = [], [], []
    for src in SOURCES:
        block = fetched.get(src["id"])
        if block is None:  # not requested with --only: keep last saved data
            block = dict(prev_status.get(src["id"], {"ok": True, "checkedAt": None}),
                         id=src["id"], name=src["name"], url=src["url"], group=src.get("group", "government"),
                         jobs=[j for j in previous.get("jobs", []) if j.get("source") == src["id"]],
                         ads=[a for a in previous.get("advertisements", []) if a.get("source") == src["id"]])
        else:
            log("%-6s %3d jobs, %3d ads in %5.1fs%s" % (src["id"], len(block["jobs"]), len(block["ads"]),
                                                        block.get("seconds", 0), "" if block["ok"] else "  (FAILED)"))
        jobs.extend(block["jobs"])
        ads.extend(block["ads"])
        status = {k: v for k, v in block.items() if k not in ("jobs", "ads")}
        status.update(jobs=len(block["jobs"]), ads=len(block["ads"]))
        statuses.append(status)

    now = now_iso()
    watch = new_department_summary(jobs, ads)

    payload = {"generatedAt": now, "sources": statuses, "newDepartments": watch,
               "jobs": jobs, "advertisements": ads}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "jobs.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT_DIR, "jobs.js"), "w", encoding="utf-8") as fh:
        fh.write("/* Generated by scraper/fetch_jobs.py - do not edit by hand. */\nwindow.HN_DATA = ")
        json.dump(payload, fh, ensure_ascii=False)
        fh.write(";\n")
    flagged = sum(1 for j in jobs if j["newDepartment"]) + sum(1 for a in ads if a["newDepartment"])
    log("Saved %d jobs and %d advertisements (%d from new departments)" % (len(jobs), len(ads), flagged))


def main():
    parser = argparse.ArgumentParser(description="Fetch real government jobs and advertisements from official websites.")
    parser.add_argument("--watch", type=float, metavar="MINUTES", help="keep running and refresh every MINUTES minutes")
    parser.add_argument("--only", nargs="+", metavar="SOURCE", help="fetch only these sources, e.g. --only PPSC BPSC")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    only = {s.upper() for s in args.only} if args.only else None

    while True:
        run_once(only)
        if not args.watch:
            break
        log("Next refresh in %g minutes (Ctrl+C to stop)" % args.watch)
        time.sleep(args.watch * 60)


if __name__ == "__main__":
    main()
