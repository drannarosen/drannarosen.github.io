#!/usr/bin/env node
/*
 * check.mjs — verify published figures still match what was recorded.
 *
 * Motivation: /astrobytes serves a CORRECTED Figure 4 while arXiv still serves
 * the version with the '95\%' bug. That divergence is fine — it is recorded —
 * but an UNRECORDED divergence is how a site quietly ends up showing different
 * science from the paper it cites.
 *
 * Three failure modes, all caught:
 *   - a figure file changed and nobody updated its record
 *   - a figure is served but has no provenance record at all
 *   - a record points at a file that no longer exists
 *
 * Deliberately does NOT re-run the paper's figure scripts: those live in a
 * private repo with untracked data. It answers "has this file changed since we
 * recorded where it came from?", which is the question CI can honestly ask.
 *
 *   node scripts/figures/check.mjs
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const PUBLIC = resolve(ROOT, "public");
const MANIFEST = resolve(ROOT, "src/data/figures.json");

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** Every raster figure actually served, so a new one can't slip in unrecorded. */
function servedFigures(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) servedFigures(full, acc);
    else if (/\.(png|jpg|jpeg|webp|svg)$/i.test(name)) acc.push(full);
  }
  return acc;
}

const { figures } = JSON.parse(readFileSync(MANIFEST, "utf8"));
const recorded = new Map(figures.map((f) => [f.path, f]));
const problems = [];

for (const f of figures) {
  const full = resolve(PUBLIC, f.path);
  if (!existsSync(full)) {
    problems.push(`missing file: ${f.path} is recorded but not present`);
    continue;
  }
  const actual = sha256(full);
  if (actual !== f.sha256) {
    problems.push(
      `changed: ${f.path}\n` +
        `    recorded ${f.sha256}\n` +
        `    actual   ${actual}\n` +
        `    If this was a deliberate regeneration, update sha256 (and note) in\n` +
        `    src/data/figures.json in the same commit that replaced the image.`,
    );
  }
}

// Only figure directories are policed; decorative site imagery is not a claim.
for (const dir of ["images/astrobytes", "images/publications"]) {
  for (const full of servedFigures(resolve(PUBLIC, dir))) {
    const rel = relative(PUBLIC, full);
    if (!recorded.has(rel)) {
      problems.push(
        `unrecorded: ${rel} is served with no provenance.\n` +
          `    Add it to src/data/figures.json, or move it out of a figure directory.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`\n[figures] ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

console.log(`[figures] ok — ${figures.length} figures match their recorded provenance`);
