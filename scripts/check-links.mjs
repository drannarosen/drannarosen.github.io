#!/usr/bin/env node
/*
 * check-links.mjs — verify every link in the built site still resolves.
 *
 * Internal links are checked against dist/ (fast, offline, and a broken one is
 * always a real bug). External links are checked over the network and are
 * OPT-IN via --external, because the network is not a build dependency:
 *
 *   A gate that fails the build when a journal has a bad afternoon is a gate
 *   that gets switched off within a month. Internal links block the build;
 *   external links are a thing you run deliberately, or on a schedule, and
 *   read as a report.
 *
 *   node scripts/check-links.mjs              # internal only (runs in prebuild)
 *   node scripts/check-links.mjs --external   # also check the outside world
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");
const CHECK_EXTERNAL = process.argv.includes("--external");

if (!existsSync(DIST)) {
  console.error("[links] dist/ not found — run `pnpm build` first.");
  process.exit(1);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

/** Every href/src in the built HTML, with the page it came from. */
const internal = new Map(); // path -> Set(source pages)
const external = new Map(); // url  -> Set(source pages)

for (const file of walk(DIST)) {
  const page = "/" + relative(DIST, file).replace(/index\.html$/, "");
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("data:")) continue;
    if (/^https?:\/\//.test(raw)) {
      if (!external.has(raw)) external.set(raw, new Set());
      external.get(raw).add(page);
    } else if (raw.startsWith("/")) {
      const clean = raw.split("#")[0].split("?")[0];
      if (!internal.has(clean)) internal.set(clean, new Set());
      internal.get(clean).add(page);
    }
  }
}

/* ---------------- internal ---------------- */
const broken = [];
for (const [path, pages] of internal) {
  if (path === "/") continue;
  const p = path.replace(/\/$/, "");
  const candidates = [
    join(DIST, p),
    join(DIST, p + ".html"),
    join(DIST, p, "index.html"),
  ];
  if (!candidates.some(existsSync)) {
    broken.push(`${path}\n      linked from: ${[...pages].slice(0, 3).join(", ")}`);
  }
}

console.log(`[links] ${internal.size} internal, ${external.size} external`);
if (broken.length > 0) {
  console.error(`\n[links] ${broken.length} broken internal link(s):\n`);
  for (const b of broken) console.error(`  - ${b}\n`);
  process.exit(1);
}
console.log("[links] internal ok");

/* ---------------- external ---------------- */
if (!CHECK_EXTERNAL) {
  console.log("[links] external skipped (pass --external to check)");
  process.exit(0);
}

/** HEAD first; some hosts reject HEAD, so fall back to a ranged GET. */
async function probe(url) {
  const opts = {
    redirect: "follow",
    headers: { "User-Agent": "anna-rosen.com link checker" },
    signal: AbortSignal.timeout(15000),
  };
  try {
    let r = await fetch(url, { ...opts, method: "HEAD" });
    if (r.status === 405 || r.status === 403 || r.status === 501) {
      r = await fetch(url, { ...opts, method: "GET", headers: { ...opts.headers, Range: "bytes=0-0" } });
    }
    return r.status;
  } catch (e) {
    return e.name === "TimeoutError" ? "timeout" : "error";
  }
}

const urls = [...external.keys()];
const results = [];
const CONCURRENCY = 6;
for (let i = 0; i < urls.length; i += CONCURRENCY) {
  const batch = urls.slice(i, i + CONCURRENCY);
  const codes = await Promise.all(batch.map(probe));
  batch.forEach((u, k) => results.push([u, codes[k]]));
  process.stdout.write(`\r[links] checked ${Math.min(i + CONCURRENCY, urls.length)}/${urls.length}`);
}
process.stdout.write("\n");

/*
 * Publishers put their DOI landing pages behind bot protection: Oxford (MNRAS),
 * AIP and others return 403 to any automated request, including one sending a
 * browser User-Agent. Those links work perfectly for readers. Reporting them
 * alongside genuine 404s is how a checker trains you to ignore it, so they are
 * separated out.
 */
const classify = (code) => {
  if (code === "timeout" || code === "error") return "unreachable";
  const n = Number(code);
  if (n === 403 || n === 429) return "blocked";   // bot protection, not broken
  if (n === 404 || n === 410) return "dead";      // genuinely gone
  if (n >= 500) return "server";                  // upstream trouble, often transient
  return "ok";
};

const groups = { dead: [], unreachable: [], server: [], blocked: [] };
for (const [url, code] of results) {
  const kind = classify(code);
  if (kind !== "ok") groups[kind].push([url, code]);
}

const report = (kind, label) => {
  const list = groups[kind];
  if (list.length === 0) return;
  console.error(`\n  ${label} (${list.length}):`);
  for (const [url, code] of list) {
    console.error(`    ${String(code).padEnd(6)} ${url}`);
    if (kind === "dead") console.error(`           on: ${[...external.get(url)].slice(0, 2).join(", ")}`);
  }
};

const actionable = groups.dead.length + groups.unreachable.length;
if (actionable === 0 && groups.server.length === 0 && groups.blocked.length === 0) {
  console.log(`[links] external ok — all ${urls.length} resolved`);
  process.exit(0);
}
console.error(`\n[links] external report — ${actionable} need action:`);
report("dead", "DEAD — fix these");
report("unreachable", "UNREACHABLE — check by hand");
report("server", "SERVER ERROR — probably transient, re-run later");
report("blocked", "BLOCKED by bot protection — these are fine for readers");
// Deliberately NOT a failure: a transient outage upstream is not a defect in
// this repository. Read the report and act on it.
console.error("\n[links] reported, not failed — external outages are not build errors.");
