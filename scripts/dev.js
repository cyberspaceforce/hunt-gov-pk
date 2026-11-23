#!/usr/bin/env node
/*
 * npm run dev            -> start the local server on http://localhost:3000 (opens the browser)
 * npm run dev -- 4000    -> custom port
 * npm run dev:nobrowser  -> don't open a browser tab
 * npm run fetch          -> refresh the bundled snapshot data/jobs.js (scraper CLI)
 *
 * Only ONE process is needed: serve.py serves the pages AND runs the Python API
 * (/api/source) that fetches jobs from the official websites. This script finds
 * Python (python / python3 / py) and starts it. No npm packages required.
 */
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function findPython() {
  const candidates = process.platform === "win32"
    ? [["python"], ["py", "-3"], ["python3"]]
    : [["python3"], ["python"]];
  for (const [cmd, ...pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; print(sys.version_info >= (3, 8))"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === "True") return [cmd, pre];
  }
  return null;
}

const py = findPython();
if (!py) {
  console.error("\n  Python 3.8+ was not found. Install it from https://www.python.org/downloads/");
  console.error('  (on Windows tick "Add python.exe to PATH"), then run npm run dev again.\n');
  process.exit(1);
}
const [cmd, pre] = py;

let pyArgs;
if (args.includes("--fetch")) {
  pyArgs = [...pre, "-u", "scraper/fetch_jobs.py", ...args.filter((a) => a !== "--fetch")];
} else {
  const port = args.find((a) => /^\d+$/.test(a)) || process.env.PORT || "3000";
  pyArgs = [...pre, "-u", "serve.py", port, ...args.filter((a) => a.startsWith("--"))];
}

const child = spawn(cmd, pyArgs, { cwd: ROOT, stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
const stop = () => { if (!child.killed) child.kill("SIGINT"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
