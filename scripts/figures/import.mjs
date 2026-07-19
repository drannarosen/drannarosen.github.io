#!/usr/bin/env node
/*
 * import.mjs — bring a paper figure onto the site and record its provenance.
 *
 *   node scripts/figures/import.mjs <source.png> <images/astrobytes/name.webp> \
 *        --origin rosen-binary-imf-2026 \
 *        --script scripts/figure_4_scaling.py \
 *        --figure "Figure 4" [--note "..."]
 *
 * Converts to LOSSLESS WebP. Measured on this paper's figures, lossless beats
 * quality-90 lossy on both size and fidelity — matplotlib output is line art
 * over flat white, which lossless compression handles well and DCT-based lossy
 * handles badly (the forest plot: 55KB lossless vs 121KB at q90).
 *
 * It also does NOT resize. Downscaling a plot turns crisp 1px lines into grey
 * ramps, which destroys compressibility: resampling one figure 2955->2304
 * inflated it from 89KB to 158KB.
 *
 * Writes the file, then records path, origin, script, paper figure and sha256
 * in src/data/figures.json so `pnpm check:figures` can detect later drift.
 */

import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const MANIFEST = resolve(ROOT, "src/data/figures.json");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [source, target] = positional;

if (!source || !target) {
  console.error(
    "usage: import.mjs <source-image> <images/dir/name.webp> --origin <repo> --script <path> --figure <label> [--note <text>]",
  );
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`source not found: ${source}`);
  process.exit(1);
}
if (!target.endsWith(".webp")) {
  console.error("target must end in .webp");
  process.exit(1);
}

const out = resolve(ROOT, "public", target);
mkdirSync(dirname(out), { recursive: true });

const meta = await sharp(source).metadata();
await sharp(source).webp({ lossless: true, effort: 6 }).toFile(out);

const buf = readFileSync(out);
const sha256 = createHash("sha256").update(buf).digest("hex");

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const record = {
  path: target,
  origin: flag("origin") ?? null,
  script: flag("script") ?? null,
  paperFigure: flag("figure") ?? null,
  width: meta.width,
  height: meta.height,
  sha256,
  ...(flag("note") ? { note: flag("note") } : {}),
};
const i = manifest.figures.findIndex((f) => f.path === target);
if (i === -1) manifest.figures.push(record);
else manifest.figures[i] = { ...manifest.figures[i], ...record };

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

const before = readFileSync(source).length;
console.log(
  `[figures] ${target}  ${meta.width}x${meta.height}  ` +
    `${(before / 1024).toFixed(0)}KB -> ${(buf.length / 1024).toFixed(0)}KB ` +
    `(${(100 - (buf.length / before) * 100).toFixed(0)}% smaller), recorded in figures.json`,
);
