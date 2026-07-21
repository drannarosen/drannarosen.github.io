#!/usr/bin/env node
/*
 * check-markup.mjs — catch authoring markup that reached the reader unrendered.
 *
 * Figure captions are written in YAML frontmatter as journal captions: `**(a)**`
 * for panel labels, `\( ... \)` for inline LaTeX. src/lib/figureCaption.ts turns
 * those into <strong> and KaTeX at build time — but ONLY where a template
 * remembered to pipe the caption through it. Render the same string with plain
 * `{f.caption}` and the page ships literal asterisks and backslash-parens.
 *
 * That is invisible in review (the text is all there, just ugly) and invisible
 * to every other gate: it is valid HTML, valid YAML, and a passing type check.
 * The only place it shows up is the built page, so that is where this looks.
 *
 * Also verifies every figure uses the shared presentation (.figure-box plus a
 * --figure-ar), which is the same kind of check for the same reason: it is
 * only visible in the built page.
 *
 * Runs on dist/ in postbuild, alongside check-links.mjs.
 *
 *   node scripts/check-markup.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");

if (!existsSync(DIST)) {
  console.error("[markup] dist/ not found — run `pnpm build` first.");
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

/*
 * Reduce a page to the text a reader actually sees.
 *
 * <annotation> must go first and specifically: KaTeX embeds the ORIGINAL LaTeX
 * there for accessibility tools, so every correctly-rendered equation on the
 * site contains backslashes in its markup. Scanning raw HTML would flag the
 * successes and not the failures — exactly backwards.
 */
function visibleText(html) {
  return html
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<(script|style|pre|code)[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, " ");
}

/** Markup that should never survive to the page, with what it means. */
const LEAKS = [
  { re: /\*\*[^*\n]{1,120}\*\*/g, what: "literal **bold** markers" },
  { re: /\\\([^\n]{1,120}?\\\)/g, what: "literal \\( ... \\) math delimiters" },
];

const problems = [];

for (const file of walk(DIST)) {
  const page = "/" + relative(DIST, file).replace(/index\.html$/, "");
  const text = visibleText(readFileSync(file, "utf8"));
  for (const { re, what } of LEAKS) {
    for (const m of text.matchAll(re)) {
      problems.push(
        `${page} shows ${what}: ${JSON.stringify(m[0].slice(0, 90))}\n` +
          `    The source is authored for renderCaption() but the template\n` +
          `    printed it as text. Use <span set:html={renderCaption(...)} />.`,
      );
    }
  }
}

/*
 * Every scientific figure must use the shared presentation.
 *
 * `.figure-box` plus a `--figure-ar` is what bounds a figure's height without
 * breaking space reservation (see src/styles/figures.css). A figure rendered
 * without it is not broken — it just quietly opts out of the one rule, which
 * is how four different sizing opinions accumulated in the first place.
 *
 * Only figure directories are policed. Photographs are single-use, carry no
 * provenance claim and are bounded by their own columns; the provenance check
 * draws the same line.
 */
const FIGURE_DIRS = /^\/images\/(research|software|publications|astrobytes)\//;

for (const file of walk(DIST)) {
  const page = "/" + relative(DIST, file).replace(/index\.html$/, "");
  for (const m of readFileSync(file, "utf8").matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    const src = tag.match(/src="([^"]+)"/)?.[1] ?? "";
    if (!FIGURE_DIRS.test(src)) continue;
    const missing = [];
    if (!/class="[^"]*\bfigure-box\b/.test(tag)) missing.push("the figure-box class");
    if (!tag.includes("--figure-ar")) missing.push("a --figure-ar (from figureBox())");
    if (missing.length > 0) {
      problems.push(
        `${page} renders ${src.split("/").pop()} without ${missing.join(" and ")}.\n` +
          `    Every figure uses the shared presentation: resolve it through\n` +
          `    src/lib/figures.ts and pass class="figure-box" style={figureBox(f)}.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`\n[markup] ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

console.log("[markup] ok — captions rendered, and every figure uses the shared presentation");
