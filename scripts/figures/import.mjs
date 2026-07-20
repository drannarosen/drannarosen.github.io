#!/usr/bin/env node
/*
 * import.mjs — bring a paper figure onto the site and record its provenance.
 *
 *   node scripts/figures/import.mjs <source.png> <images/astrobytes/name.webp> \
 *        --origin rosen-binary-imf-2026 \
 *        --script scripts/figure_4_scaling.py \
 *        --figure "Figure 4" [--note "..."]
 *
 * Encoding is CHOSEN BY MEASUREMENT, not by rule, because the right answer
 * flips with the figure:
 *   - line art over flat white (most matplotlib plots): lossless wins outright,
 *     often by 2x (the forest plot: 55KB lossless vs 121KB at q90). DCT-based
 *     lossy spends its bits failing to represent step edges.
 *   - noise-dominated raster (simulated images, Fisher-information maps):
 *     lossless cannot compress the noise, and q95 is ~3x smaller (919KB vs
 *     304KB) with artifacts far below the noise already in the data.
 * So we encode both and keep the smaller, then record which was used in
 * figures.json — a lossy scientific figure should be a disclosed fact.
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

// Encode both ways and keep the smaller; see the note at the top of this file.
const lossless = await sharp(source).webp({ lossless: true, effort: 6 }).toBuffer();
const lossy = await sharp(source).webp({ quality: 95, effort: 6 }).toBuffer();
const useLossless = lossless.length <= lossy.length;
const encoding = useLossless ? "webp-lossless" : "webp-q95";
writeFileSync(out, useLossless ? lossless : lossy);

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
  encoding,
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
    `(${(100 - (buf.length / before) * 100).toFixed(0)}% smaller, ${encoding}), ` +
    `recorded in figures.json`,
);
