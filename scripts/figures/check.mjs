#!/usr/bin/env node
/*
 * check.mjs — verify published figures still match what was recorded.
 *
 * Motivation: /astrobytes serves a CORRECTED Figure 4 while arXiv still serves
 * the version with the '95\%' bug. That divergence is fine — it is recorded —
 * but an UNRECORDED divergence is how a site quietly ends up showing different
 * science from the paper it cites.
 *
 * Failure modes caught:
 *   - a figure file changed and nobody updated its record
 *   - a figure is served but has no provenance record at all
 *   - a record points at a file that no longer exists
 *   - a figure's recorded dimensions no longer match the file
 *   - a figure is referenced from a different set of places than recorded
 *   - an image file is shipped that nothing references (a rename's dead half)
 *
 * That last one exists because it actually bit: the gravax figure was used on
 * BOTH /software/gravax and /research, a new version replaced it, and only the
 * package page's caption was updated. The research page went on asserting the
 * previous run's number — off by four orders of magnitude — because nothing
 * forced anyone to notice the second use. `usedIn` records where each figure
 * appears; changing that set now fails the build until the record is updated,
 * which means every caption gets looked at.
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
import sharp from "sharp";

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

/* ── recorded dimensions must match the file ──────────────────────────────
   A replacement figure is rarely the same size as the one it replaces, and a
   stale width/height reserves the wrong space and shifts the layout. */
for (const f of figures) {
  const full = resolve(PUBLIC, f.path);
  if (!existsSync(full)) continue;
  const { width, height } = await sharp(full).metadata();
  if (f.width !== width || f.height !== height) {
    problems.push(
      `dimensions: ${f.path}\n` +
        `    recorded ${f.width}x${f.height}, actual ${width}x${height}\n` +
        `    Update src/data/figures.json AND every place that declares this\n` +
        `    figure's width/height, or the page reserves the wrong space.`,
    );
  }
}

/* ── every place a figure is referenced must be recorded ───────────────── */
function sourceFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(astro|ts|tsx|mdx|md|mjs)$/i.test(full)) acc.push(full);
  }
  return acc;
}

const searchable = [
  ...sourceFiles(resolve(ROOT, "src")),
  ...sourceFiles(resolve(ROOT, "scripts")),
].filter((f) => resolve(f) !== MANIFEST);

for (const f of figures) {
  const basename = f.path.split("/").pop();
  const actual = searchable
    .filter((file) => readFileSync(file, "utf8").includes(basename))
    .map((file) => relative(ROOT, file))
    .sort();
  const declared = [...(f.usedIn ?? [])].sort();
  const same =
    declared.length === actual.length && declared.every((v, i) => v === actual[i]);
  if (!same) {
    problems.push(
      `usedIn: ${f.path} is referenced from a different set of files than recorded.\n` +
        `    recorded: ${declared.length ? declared.join(", ") : "(nothing recorded)"}\n` +
        `    actual:   ${actual.length ? actual.join(", ") : "(referenced nowhere)"}\n` +
        `    Set "usedIn": ${JSON.stringify(actual)} in src/data/figures.json —\n` +
        `    and while doing so, check that EVERY caption above still matches\n` +
        `    the figure. That is the whole point of this check.`,
    );
  }
}

/* ── no image file should be stranded ─────────────────────────────────────
   Figure filenames are stable identifiers, so a rename is a delete plus an
   add. The deleted half is invisible: the site keeps working, the old file
   keeps shipping, and a year later nobody can tell which of two similar
   images is the live one. Fail while the rename is still in working memory. */
for (const full of servedFigures(resolve(PUBLIC, "images"))) {
  const rel = relative(PUBLIC, full);
  const basename = rel.split("/").pop();
  const referenced = searchable.some((file) => readFileSync(file, "utf8").includes(basename));
  if (!referenced) {
    problems.push(
      `orphan: ${rel} is shipped but nothing references it.\n` +
        `    Delete it, or reference it. A renamed figure leaves its old file\n` +
        `    behind and nothing else notices.`,
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
