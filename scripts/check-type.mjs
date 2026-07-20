#!/usr/bin/env node
/*
 * check-type.mjs — every font-size must come from the type scale.
 *
 * WHY THIS EXISTS: the scale in tokens.css was never the problem. Components
 * were hardcoding `font-size: 0.66rem` and friends — 28 of them, all 10-11.5px
 * — which is why "this text is too small" kept resurfacing no matter how the
 * tokens were tuned. A scale that can be bypassed is a suggestion.
 *
 * Allowed:
 *   - var(--step-*)          the scale
 *   - em units               deliberately relative to context (drop caps, code)
 *   - anything marked `type-scale-exempt: <reason>` on that line or the one
 *     above it (the line above is for values inside template literals, where a
 *     trailing comment would land inside the string)
 *
 *   node scripts/check-type.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(astro|css)$/.test(name)) acc.push(full);
  }
  return acc;
}

const problems = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
      const m = line.match(/font-size:\s*([^;]+);/);
      if (!m) return;
      const value = m[1].trim();
      const exempt =
        line.includes("type-scale-exempt") ||
        (lines[i - 1] ?? "").includes("type-scale-exempt");
      if (
        value.includes("var(--step") ||
        // `em` is context-relative by design and allowed — but note that
        // "0.66rem".endsWith("em") is TRUE, so `rem` must be excluded
        // explicitly. Without this the exemption swallows everything the
        // check exists to catch, and the gate reports ok while doing nothing.
        (/(^|[^r])em$/.test(value)) ||
        exempt
      ) return;
      problems.push(`${relative(ROOT, file)}:${i + 1}  font-size: ${value}`);
    });
}

if (problems.length > 0) {
  console.error(`\n[type] ${problems.length} font-size(s) bypass the type scale:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\n  Use a --step-* token from src/styles/tokens.css, or add a trailing\n` +
      `  comment "type-scale-exempt: <reason>" if the size is genuinely special.\n`,
  );
  process.exit(1);
}
console.log("[type] ok — every font-size uses the type scale");
