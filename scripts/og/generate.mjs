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
 * Photo cards are written as JPEG, figures as PNG. Both are universally
 * supported by unfurlers, but a photograph as lossless PNG runs to well over a
 * megabyte and some unfurlers give up fetching one that large; a plot as JPEG
 * would get ringing artifacts on its axes. Format follows content.
 *
 * FIGURES are fitted, never cropped — cropping a plot can remove the axis that
 * makes it readable, and a plot letterboxed on the site background looks
 * deliberate. PHOTOS are the opposite: they crop safely, and a portrait fitted
 * inside a 1200x630 card leaves two large dead bands. So each card declares
 * `photo: true` when it should fill the frame instead.
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
  // Per-package pages; each leads with its own demo figure.
  { out: "software-progenax.png", figure: "images/research/gravoturb-cluster.webp" },
  { out: "software-gravax.png", figure: "images/software/gravax-eff-imf-n512.webp" },
  { out: "software-fluxax.png", figure: "images/software/fluxax-pixel-information.webp" },
  {
    out: "software-informax.png",
    figure: "images/software/informax-telescope-adds-ten-pounds.webp",
  },
  { out: "software-startrax.png", figure: "images/software/startrax-wind-response.webp" },
  // Photos: fill the card, biased to the top so faces and captions survive.
  { out: "outreach.jpg", figure: "images/photos/anna-outreach-talk.webp", photo: true },
  {
    out: "about.jpg",
    figure: "images/photos/anna-discover-the-cosmos.webp",
    photo: true,
    // A top-gravity crop cut Anna out of her own card, leaving only the
    // banner. This band keeps the "Discover the Cosmos" text AND her.
    crop: { left: 0, top: 95, width: 620, height: 330 },
  },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const card of CARDS) {
  const srcPath = resolve(PUBLIC, card.figure);
  if (!existsSync(srcPath)) {
    console.error(`[og] SKIP ${card.out} — missing ${card.figure}`);
    process.exitCode = 1;
    continue;
  }

  if (card.photo) {
    // Photographs fill the whole card. `position: top` keeps heads and any
    // text in the upper third of the frame rather than cropping through them.
    const base = card.crop ? sharp(srcPath).extract(card.crop) : sharp(srcPath);
    const filled = await base
      .resize({ width: W, height: H, fit: "cover", position: "top" })
      .png()
      .toBuffer();

    const rule = Buffer.from(
      `<svg width="${W}" height="6" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="${W}" height="6" fill="${TEAL}" opacity="0.9"/></svg>`,
    );

    await sharp(filled)
      .composite([{ input: rule, top: 0, left: 0 }])
      .jpeg({ quality: 86, progressive: true, mozjpeg: true })
      .toFile(resolve(OUT_DIR, card.out));

    console.log(`[og] ${card.out}  from ${card.figure} (photo, filled)`);
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
