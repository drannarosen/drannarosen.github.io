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
 * Newest first, by the date the figure went up rather than the date it was
 * added to this list — the strip reads as a chronology. Removing an entry
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
 * Five is a SOFT cap: going over warns at build time but ships everything.
 *
 * It began as a hard failure, on the reasoning that a silent drop would leave
 * an invisible figure and a puzzled author. That reasoning still holds against
 * silently DROPPING one — nothing is ever hidden here. But retiring a plot is
 * an editorial call, not a build concern, and a gate that blocks the build to
 * make it is a gate that gets edited out of the way. The warning notes the
 * strip is getting long; deciding what leaves stays with the author.
 */
export const NOW_FIGURE_CAP = 5;

export const nowFigures: NowFigure[] = [
  { id: "gravax-demo-01", package: "gravax", added: "2026-07-20" },
  { id: "startrax-wind-response", package: "startrax", added: "2026-07-20" },
  { id: "fluxax-pixel-information", package: "fluxax", added: "2026-07-19" },
  { id: "informax-telescope-adds-ten-pounds", package: "informax", added: "2026-07-19" },
  { id: "gravoturb-cluster", package: "progenax", added: "2026-07-18" },
];

if (nowFigures.length > NOW_FIGURE_CAP) {
  const oldest = nowFigures[nowFigures.length - 1];
  console.warn(
    `[nowFigures] ${nowFigures.length} figures on /now, soft cap is ${NOW_FIGURE_CAP}. ` +
      `Oldest is ${oldest.id} (added ${oldest.added}). Retire one when you want to — ` +
      `removing an entry strands its image, which check:figures then reports.`,
  );
}
