#!/usr/bin/env node
/*
 * generate.mjs — build Open Graph cards for link previews.
 *
 * WHY this shape: Anna's distribution is Slack (LSST DA, collaboration
 * channels), not search crawlers. Slack renders `og:title` and
 * `og:description` as TEXT beside the image, so the title does not need to be
 * drawn into the picture. That removes the only hard part — rendering webfonts
 * into a raster — and lets the card be what actually earns a click in a busy
 * channel: the figure itself, on the site's own background.
 *
 * Output is PNG, not WebP: several unfurlers (and some mail clients) still do
 * not fetch or render WebP previews reliably, and an OG card that silently
 * fails to display is worse than a slightly larger file.
 *
 *   node scripts/og/generate.mjs
 */

import sharp from "sharp";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const PUBLIC = resolve(ROOT, "public");
const OUT_DIR = resolve(PUBLIC, "og");

// 1200x630 is the size every major unfurler crops to.
const W = 1200;
const H = 630;
const PAD = 56;
const BG = { r: 15, g: 17, b: 21, alpha: 1 }; // --bg-void
const TEAL = "#4fd6c4";

/** Which figure represents which route. */
const CARDS = [
  { out: "default.png", figure: "images/research/gravoturb-cluster.webp" },
  {
    out: "astrobytes-confidently-wrong.png",
    figure: "images/astrobytes/confidently-wrong-scaling.webp",
  },
  { out: "publications.png", figure: "images/publications/binary-imf-recovery.webp" },
  { out: "research.png", figure: "images/research/imf-forest.webp" },
  { out: "software.png", figure: "images/research/gravoturb-cluster.webp" },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const card of CARDS) {
  const srcPath = resolve(PUBLIC, card.figure);
  if (!existsSync(srcPath)) {
    console.error(`[og] SKIP ${card.out} — missing ${card.figure}`);
    process.exitCode = 1;
    continue;
  }

  // Fit the figure inside the padded area without cropping: these are plots,
  // and cropping a plot can remove the axis that makes it readable.
  const inner = await sharp(srcPath)
    .resize({
      width: W - PAD * 2,
      height: H - PAD * 2,
      fit: "inside",
      withoutEnlargement: true,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: "#ffffff" })
    .extend({
      top: 14,
      bottom: 14,
      left: 14,
      right: 14,
      background: "#ffffff",
    })
    .png()
    .toBuffer();

  const meta = await sharp(inner).metadata();

  // A teal rule along the top edge: the one piece of site identity that needs
  // no typeface.
  const rule = Buffer.from(
    `<svg width="${W}" height="6" xmlns="http://www.w3.org/2000/svg">
       <rect width="${W}" height="6" fill="${TEAL}" opacity="0.9"/>
     </svg>`,
  );

  await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
    .composite([
      { input: rule, top: 0, left: 0 },
      {
        input: inner,
        top: Math.round((H - meta.height) / 2),
        left: Math.round((W - meta.width) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(resolve(OUT_DIR, card.out));

  console.log(`[og] ${card.out}  from ${card.figure}`);
}
