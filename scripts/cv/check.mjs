#!/usr/bin/env node
/*
 * check.mjs — reconcile the printed CV's publication list against the synced
 * record, and derive the CV's publication COUNTS from it.
 *
 * WHY (not generation): the hand-typed CV in cv/cv_rosen.typ is HIGHER quality
 * than the machine record — correct author initials, diacritics and ADS links
 * the ORCID/Crossref/DataCite data mangles or drops. So the list stays
 * human-curated. What this kills is the dangerous drift the record CAN settle:
 *   1. a refereed paper in the record that is silently MISSING from the CV, and
 *   2. a headline publication count that disagrees with the record.
 *
 * Matching is multi-key — DOI, ADS bibcode, a (year·volume·page) signature, then
 * a normalised title — so a paper the journal RETITLED (ORCID's title ≠ the CV's)
 * still matches on its volume/page and is not falsely reported missing.
 *
 * Intentional omissions (e.g. an IAU proceedings the CV deliberately leaves out)
 * live in cv/cv-omit.json, human-owned with a reason — the same pattern as
 * publications.exclude.json.
 *
 *   node scripts/cv/check.mjs           # write counts, report drift
 *   node scripts/cv/check.mjs --check   # exit 1 on drift or stale counts (CI)
 *
 * Output: cv/generated/counts.json (generated — do not hand-edit)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const SYNCED = resolve(ROOT, "src/data/generated/publications.json");
const ADDITIONS = resolve(ROOT, "src/data/publications.additions.json");
const OMIT = resolve(ROOT, "cv/cv-omit.json");
const TYPST = resolve(ROOT, "cv/cv_rosen.typ");
const OUT = resolve(ROOT, "cv/generated/counts.json");

/* ---- normalisation helpers ---- */

// Title → letters+digits only, with typst markup and inline math stripped, so
// `HARM#super("2")` and `HARM2`, or a `$gamma$` and a Unicode γ, key the same.
const titleKey = (t) =>
  (t ?? "")
    .replace(/\$[^$]*\$/g, "")
    .replace(/#[a-z]+\("([^"]*)"\)/gi, "$1")
    .replace(/#me\([^)]*\)/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 44);

// Page can be a range ("924-942") or an article id ("A219"); collapse to the
// first token so the record and the CV agree on it.
const firstPage = (p) => String(p ?? "").trim().split(/[-–\s]/)[0];

const sig = (year, volume, page) =>
  year && volume && page ? `${year}|${String(volume).trim()}|${firstPage(page)}` : null;

const norm = (s) => (s ?? "").toLowerCase().trim();

/* ---- the synced record (what SHOULD be represented) ---- */

const synced = JSON.parse(readFileSync(SYNCED, "utf8")).works;
const additions = JSON.parse(readFileSync(ADDITIONS, "utf8")).additions;
const omit = existsSync(OMIT) ? JSON.parse(readFileSync(OMIT, "utf8")).omit ?? [] : [];
const omitDois = new Set(omit.map((o) => norm(o.doi)).filter(Boolean));

const isSoftware = (w) => /journal of open source software/i.test(w.venue ?? "");
const isFirstAuthor = (w) => /^rosen,\s*a/i.test(w.authors?.[0] ?? "");

// The set the CV is expected to list: refereed journal articles + submitted
// preprints (which the CV shows with a "submitted" pill), minus omissions.
const expected = [
  ...additions.map((a) => ({ ...a, submitted: true })),
  ...synced.filter((w) => w.type === "journal-article"),
].filter((w) => !omitDois.has(norm(w.doi)));

/* ---- the CV (what IS listed) ---- */

const typ = readFileSync(TYPST, "utf8");
const pubSection = typ.slice(typ.indexOf("Refereed Publications"));

// Each #pub(...) block: title (1st arg), venue line (2nd bracket), url.
const cvDois = new Set();
const cvBibcodes = new Set();
const cvSigs = new Set();
const cvTitles = new Set();

for (const m of pubSection.matchAll(/#pub\(\s*\d+,\s*([\s\S]*?)\n\)/g)) {
  const block = m[1];
  const brackets = [...block.matchAll(/\[([\s\S]*?)\]/g)].map((b) => b[1]);
  // The title is the first argument. It is EITHER a quoted string (then the
  // brackets are [authors, venue]) OR itself bracketed (then [title, authors,
  // venue]) — some titles are bracketed because they carry markup like #super.
  const titleIsBracketed = block.trimStart().startsWith("[");
  const title = titleIsBracketed ? brackets[0] : block.slice(0, block.indexOf("["));
  cvTitles.add(titleKey(title));

  const url = block.match(/url:\s*"([^"]+)"/)?.[1] ?? "";
  const bib = url.match(/\/abs\/([^/]+)\/abstract/i)?.[1];
  if (bib) cvBibcodes.add(norm(bib));
  const doi = url.match(/(?:doi\.org\/|10\.21105\/)(\S+)/i)?.[0]?.replace(/^https?:\/\/doi\.org\//i, "");
  if (doi) cvDois.add(norm(doi));

  // Venue line is the LAST bracket. It may be [YEAR, _Journal_, VOL, PAGE] or
  // carry an extra issue number [YEAR, _Journal_, VOL, ISSUE, PAGE], so take the
  // volume as the first token after the journal and the page as the last.
  const venueLine = brackets[brackets.length - 1] ?? "";
  const year = venueLine.match(/\b(\d{4})\b/)?.[1];
  const afterJournal = venueLine.replace(/^[\s\S]*_[^_]*_\s*,?\s*/, "");
  const nums = afterJournal.split(",").map((s) => s.trim()).filter(Boolean);
  if (year && nums.length >= 1) {
    const s = sig(year, nums[0], nums[nums.length - 1]);
    if (s) cvSigs.add(s);
  }
}

/* ---- reconcile ---- */

const inCv = (w) =>
  (w.doi && cvDois.has(norm(w.doi))) ||
  (w.bibcode && cvBibcodes.has(norm(w.bibcode))) ||
  (sig(w.year, w.volume, w.page) && cvSigs.has(sig(w.year, w.volume, w.page))) ||
  cvTitles.has(titleKey(w.title));

const missing = expected.filter((w) => !inCv(w));

/* ---- counts (derived, for the typst headline) ---- */

const counts = {
  _comment:
    "GENERATED by scripts/cv/check.mjs from the synced record. Do not hand-edit. Read by cv/cv_rosen.typ.",
  refereed: synced.filter((w) => w.type === "journal-article").length,
  firstAuthor: synced.filter((w) => isFirstAuthor(w) && !isSoftware(w)).length,
  software: synced.filter(isSoftware).length,
  submitted: additions.length,
};
const countsJson = JSON.stringify(counts, null, 2) + "\n";

/* ---- report / gate ---- */

const isCheck = process.argv.includes("--check");
let failed = false;

if (missing.length > 0) {
  failed = true;
  console.error(`[cv] ${missing.length} refereed paper(s) in the record are NOT on the CV:`);
  for (const w of missing) {
    console.error(`   • ${w.year}  ${w.title}`);
    console.error(`       ${w.venue ?? ""}  doi:${w.doi ?? "—"}`);
  }
  console.error("   Resolve each: add it to cv/cv_rosen.typ, or add its DOI to cv/cv-omit.json with a reason.");
} else {
  console.log(`[cv] ok — every refereed paper in the record is on the CV (${expected.length} checked, ${omit.length} omitted).`);
}

if (isCheck) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== countsJson) {
    failed = true;
    console.error(`[cv] ${OUT} is stale — run: node scripts/cv/check.mjs`);
  }
  process.exit(failed ? 1 : 0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, countsJson);
console.log(`[cv] counts: ${counts.refereed} refereed, ${counts.firstAuthor} first-author, ${counts.software} software, ${counts.submitted} submitted -> ${OUT}`);
