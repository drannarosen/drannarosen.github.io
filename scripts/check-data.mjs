#!/usr/bin/env node
/*
 * check-data.mjs — the shipped simulation data must match what the code fetches
 * and what the manifest declares.
 *
 * `public/data/gravoturb/` is 19 MB of the 28 MB build — by far the largest thing
 * the site ships, and the only part of it with NO gate. Figures have
 * `scripts/figures/check.mjs`; images cannot be orphaned without failing; pages
 * cannot drop out of search unnoticed. This directory had none of that, and it is
 * the one where a mistake is both expensive and silent:
 *
 *   - a renamed realization 404s at RUNTIME, in a browser, with a passing build
 *   - a file nothing reads keeps shipping forever, on every deploy
 *
 * ── THE FILE LISTS ARE DERIVED, NOT DECLARED ──
 *
 * It is scraped from the loaders' own `fetch(`${base}/...`)` calls rather than
 * written down here. A hand-maintained list is the failure this file exists to
 * prevent, one level up: it would be right on the day it was written and drift
 * silently afterwards, exactly as the hand-written page list in the search
 * endpoint did (eighteen of thirty-one pages missing, nothing failing).
 *
 * So a loader that starts fetching a new file automatically makes that file
 * required, and one that stops fetching a file automatically makes it an orphan.
 *
 * TWO LISTS, NOT ONE, and the distinction was learned the hard way. On this
 * check's first run it reported `velocities.f32` — 1.07 MB across six
 * directories — as dead weight and recommended deleting it. It is not dead:
 * `scripts/reference/gen-dynamics-ref.mjs` reads and hashes it to build the
 * dynamics reference. It is a BUILD-TIME input, invisible to a scrape of
 * `fetch()`, and a check that confidently tells you to delete data a script
 * depends on is worse than no check at all.
 *
 * So `required` (fetched at runtime, must exist in every realization) is kept
 * separate from `referenced` (named anywhere in src/ or scripts/), and orphan
 * hunting is judged against the wider set.
 *
 * It remains true that `velocities.f32` does not need to be under `public/` —
 * only a local script reads it, yet it is published on every deploy. Moving it
 * is a real change to the export script's output path and this check's
 * assumptions, so it is Anna's call, not a silent cleanup.
 *
 *   node scripts/check-data.mjs
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DATA = resolve(ROOT, "public/data/gravoturb");
const MANIFEST = join(DATA, "manifest.json");
const SRC = resolve(ROOT, "src");

const problems = [];
const mb = (b) => (b / 1048576).toFixed(2);

/** Every .ts/.astro file under src/, so the scrape sees all loaders. */
function sources(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(ts|astro)$/.test(e.name)) out.push(p);
  }
  return out;
}

/*
 * Which files the RUNTIME actually asks for, scraped from `fetch(`${base}/x.y`)`.
 *
 * Anchored on the `${base}/` form because that is how every gravoturb loader is
 * written — the base is a variable so the same code serves the root realization
 * and the named ones. If a loader ever hardcodes a path instead, it will not be
 * seen here, so the manifest-side checks below are what would catch it.
 */
const required = new Set();
for (const file of sources(SRC)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\$\{base\}\/([A-Za-z0-9_.-]+)/g)) required.add(m[1]);
}

/*
 * SEPARATELY: files named ANYWHERE in src/ or scripts/, whether fetched or not.
 *
 * "Required at runtime" and "used at all" are different questions, and conflating
 * them is a mistake this check made on its very first run: it reported
 * `velocities.f32` as 1.07 MB of dead weight and recommended deleting it, when
 * `scripts/reference/gen-dynamics-ref.mjs` reads and hashes it to build the
 * dynamics reference. It is a BUILD-TIME input, invisible to a scrape of
 * `fetch()`.
 *
 * A check that confidently tells you to delete data a script depends on is worse
 * than no check, so orphan-hunting is judged against this wider set.
 */
const referenced = new Set(required);
for (const dir of [SRC, resolve(ROOT, "scripts")]) {
  const files = (function walk(d, out = []) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|astro|mjs|js|py)$/.test(e.name)) out.push(p);
    }
    return out;
  })(dir);
  for (const f of files) {
    if (f.endsWith("check-data.mjs")) continue; // this file names them all
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/([A-Za-z0-9_-]+\.(?:f32|u8|json))/g)) referenced.add(m[1]);
  }
}
if (required.size === 0) {
  problems.push(
    "scraped ZERO required files from src/ — the `${base}/...` pattern the loaders " +
      "use must have changed, and this check is now blind. Fix the scrape before trusting it.",
  );
}

if (!existsSync(MANIFEST)) {
  problems.push(`missing ${MANIFEST}`);
} else {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const realizations = manifest.realizations ?? [];
  if (realizations.length === 0) problems.push("manifest declares no realizations");

  /* A realization's `path` is a URL under /data/gravoturb; "" means the root. */
  const declared = new Map();
  for (const r of realizations) {
    const rel = String(r.path ?? "").replace(/^\/data\/gravoturb\/?/, "");
    declared.set(rel, r.name ?? (rel || "(root)"));
  }

  // 1. Everything declared must exist, with every file the loaders fetch.
  for (const [rel, name] of declared) {
    const dir = rel ? join(DATA, rel) : DATA;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      problems.push(`manifest declares '${name}' at /${rel} — no such directory`);
      continue;
    }
    for (const f of required) {
      if (!existsSync(join(dir, f))) {
        problems.push(`'${name}' is missing ${f}, which the loaders fetch (would 404 at runtime)`);
      }
    }
  }

  // 2. Nothing may ship undeclared: a realization the manifest forgot is dead weight.
  for (const e of readdirSync(DATA, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (!declared.has(e.name)) {
      const bytes = readdirSync(join(DATA, e.name)).reduce(
        (a, f) => a + statSync(join(DATA, e.name, f)).size,
        0,
      );
      problems.push(
        `/${e.name} ships (${mb(bytes)} MB) but the manifest does not declare it — ` +
          `nothing can reach it, and it is uploaded on every deploy`,
      );
    }
  }

  /*
   * 3. No file may ship that NOTHING anywhere uses. This is the expensive one —
   *    every byte here is republished on every deploy — but it is judged against
   *    `referenced`, not `required`, so a build-time input is not called dead.
   */
  const allowed = new Set([...referenced, "manifest.json"]);
  const orphans = new Map();
  const scan = (dir, label) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) continue;
      if (allowed.has(e.name)) continue;
      const bytes = statSync(join(dir, e.name)).size;
      orphans.set(e.name, (orphans.get(e.name) ?? 0) + bytes);
    }
  };
  scan(DATA, "(root)");
  for (const rel of declared.keys()) if (rel) scan(join(DATA, rel), rel);
  for (const [f, bytes] of orphans) {
    problems.push(
      `${f} ships (${mb(bytes)} MB across all realizations) and NOTHING in src/ or ` +
        `scripts/ names it — it is republished on every deploy for nothing`,
    );
  }
}

if (problems.length) {
  console.error("[data] FAILED\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\n  Fetched at runtime : ${[...required].sort().join(", ")}`);
  console.error(
    `  Also referenced    : ${[...referenced].filter((f) => !required.has(f)).sort().join(", ") || "(none)"}`,
  );
  console.error(
    "\n  If a file is deliberately shipped without being fetched, it needs a reason:\n" +
      "  add it to `allowed` with a comment, or remove it. Silence is not an option here —\n" +
      "  this data is the largest thing the site publishes and every deploy pays for it.",
  );
  process.exit(1);
}

const totalBytes = (function walk(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    n += e.isDirectory() ? walk(p) : statSync(p).size;
  }
  return n;
})(DATA);

console.log(
  `[data] ok — every realization complete, nothing undeclared, nothing unfetched ` +
    `(${mb(totalBytes)} MB)`,
);
