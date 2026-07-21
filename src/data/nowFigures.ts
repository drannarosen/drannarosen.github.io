/*
 * nowFigures.ts — the rotating figure strip on /now.
 *
 * A new plot when there is one worth showing. This is the fun part of the
 * page, and it is real science rather than decoration: the alternative
 * considered was a canvas-drawn star sampled from the IMF, which would have
 * been ornament, and would have competed with the homepage hero.
 *
 * Entries carry NO alt text, dimensions or caption — only an id, the package
 * page to link to, and the date it went up. Everything describing the image
 * resolves from src/data/figures.json through src/lib/figures.ts.
 *
 * Newest first. Adding a figure means putting it at the top and, if the strip
 * is full, deleting the entry that falls off the end; removing an entry
 * strands its image file, which `pnpm check:figures` then reports.
 */

export interface NowFigure {
  /** Figure id, resolved against the registry in src/data/figures.json. */
  id: string;
  /** Package page this figure belongs to, for the "read more" link. */
  package: string;
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
  { id: "gravax-demo-01", package: "gravax", added: "2026-07-20" },
  { id: "startrax-wind-response", package: "startrax", added: "2026-07-20" },
  { id: "fluxax-pixel-information", package: "fluxax", added: "2026-07-19" },
  { id: "informax-telescope-adds-ten-pounds", package: "informax", added: "2026-07-19" },
];

if (nowFigures.length > NOW_FIGURE_CAP) {
  const oldest = nowFigures[nowFigures.length - 1];
  throw new Error(
    `[nowFigures] ${nowFigures.length} figures, cap is ${NOW_FIGURE_CAP}.\n` +
      `  Remove the oldest entry (${oldest.id}, added ${oldest.added}) or another\n` +
      `  of your choosing, then delete its image file if nothing else uses it —\n` +
      `  check:figures will tell you if it is stranded.`,
  );
}
