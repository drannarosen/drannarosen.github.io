/*
 * nowFigures.ts — the rotating figure strip on /now.
 *
 * A new plot when there is one worth showing. This is the fun part of the
 * page, and it is real science rather than decoration: the alternative
 * considered was a canvas-drawn star sampled from the IMF, which would have
 * been ornament, and would have competed with the homepage hero.
 *
 * Entries carry NO alt text, dimensions or caption. Each one names a package
 * and a figure path, and the page resolves the actual figure record from the
 * package's frontmatter — the single place that figure is described. Copying
 * the alt text here would create two descriptions of one image, and the one
 * nobody looks at would be the one that went stale.
 *
 * Newest first. Adding a figure means putting it at the top and, if the strip
 * is full, deleting the entry that falls off the end; removing an entry
 * strands its image file, which `pnpm check:figures` then reports.
 */

export interface NowFigure {
  /** Package id whose frontmatter describes this figure. */
  package: string;
  /** Path of the figure, matching a `src` in that package's `figures`. */
  src: string;
  /** ISO date this went up, so the strip self-dates even if the page stamp is stale. */
  added: string;
}

/*
 * Five, and the build FAILS at six rather than silently dropping the oldest.
 * A silent drop ships an invisible figure and leaves the author wondering why
 * the new plot never appeared; failing forces the choice of which one leaves,
 * which is the same discipline the rest of the figure system already applies.
 */
export const NOW_FIGURE_CAP = 5;

export const nowFigures: NowFigure[] = [
  { package: "gravax", src: "/images/software/gravax-demo-01.webp", added: "2026-07-20" },
  { package: "startrax", src: "/images/software/startrax-wind-response.webp", added: "2026-07-20" },
  { package: "fluxax", src: "/images/software/fluxax-pixel-information.webp", added: "2026-07-19" },
  {
    package: "informax",
    src: "/images/software/informax-telescope-adds-ten-pounds.webp",
    added: "2026-07-19",
  },
];

if (nowFigures.length > NOW_FIGURE_CAP) {
  const oldest = nowFigures[nowFigures.length - 1];
  throw new Error(
    `[nowFigures] ${nowFigures.length} figures, cap is ${NOW_FIGURE_CAP}.\n` +
      `  Remove the oldest entry (${oldest.src}, added ${oldest.added}) or another\n` +
      `  of your choosing, then delete its image file if nothing else uses it —\n` +
      `  check:figures will tell you if it is stranded.`,
  );
}
