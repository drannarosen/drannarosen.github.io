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

if (problems.length > 0) {
  console.error(`\n[markup] ${problems.length} unrendered marker(s):\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

console.log("[markup] ok — no unrendered caption markup in the built pages");
