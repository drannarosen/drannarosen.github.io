/*
 * figures.ts — the one place a figure is described.
 *
 * Before this, a figure's identity was split. `figures.json` owned the hash,
 * the dimensions and the provenance; every PAGE that showed the figure
 * re-declared its alt text, title, width and height, and wrote its own
 * caption. Five of ten figures appear in more than one place, so that was not
 * an edge case — it was the normal case, and it is what made the stale-caption
 * bug possible: a new gravax figure landed, one caption was updated, and the
 * other went on asserting the previous run's number.
 *
 * The `usedIn` check DETECTS that divergence. A single record makes it
 * impossible, which is strictly better.
 *
 * What stays per-use is only what is genuinely contextual:
 *   - which caption variant to show (a package page wants the full journal
 *     caption; /research wants the two-sentence version)
 *   - layout choices (caption placement, whether to contain rather than fill)
 *   - Astrobytes captions, which are MDX children with markup and math and
 *     cannot live in JSON without ceasing to be MDX
 *
 * Everything else — path, alt, dimensions, credit, title — resolves here.
 */

import data from "../data/figures.json";

export interface FigureRecord {
  /** Stable id, the filename without its extension. */
  id: string;
  /** Path relative to public/, as recorded for the provenance check. */
  path: string;
  /** Short display title, e.g. "What the Endpoint Remembers". */
  title?: string;
  /** The accessible description. One per figure, never per page. */
  alt?: string;
  credit?: string;
  /** Mirrors production_validated=false in the run's own provenance record. */
  preliminary?: boolean;
  captions?: {
    /** Journal-style caption, for the figure's home page. */
    full?: string;
    /** Two-sentence version, for pages that show it in passing. */
    short?: string;
  };
  width: number;
  height: number;
  sha256: string;
  usedIn?: string[];
}

const figures = (data as { figures: FigureRecord[] }).figures;
const byId = new Map(figures.map((f) => [f.id, f]));

/**
 * Look up a figure, failing the build on an unknown id.
 *
 * Throwing rather than returning undefined is deliberate: a figure silently
 * missing from a page is indistinguishable from one that was never added, and
 * a typo in an id would otherwise ship as a hole in the layout.
 */
export function getFigure(id: string): FigureRecord {
  const found = byId.get(id);
  if (!found) {
    throw new Error(
      `[figures] no figure with id "${id}". Known ids: ${[...byId.keys()].join(", ")}`,
    );
  }
  return found;
}

/** Public URL for a figure, derived from its recorded path. */
export const figureSrc = (f: FigureRecord) => `/${f.path}`;

/**
 * The caption to show, by variant, falling back to the fuller text.
 *
 * A page asking for "short" where only a full caption exists gets the full
 * one rather than nothing: a missing caption is a worse failure than a long
 * one, and the fallback is visible in review.
 */
export function figureCaption(f: FigureRecord, variant: "full" | "short" = "full"): string {
  const captions = f.captions ?? {};
  const chosen = variant === "short" ? (captions.short ?? captions.full) : captions.full;
  if (!chosen) {
    throw new Error(`[figures] figure "${f.id}" has no ${variant} caption recorded.`);
  }
  return chosen;
}

/** Everything a template needs to render an <img>, resolved from one record. */
export function figureImage(id: string) {
  const f = getFigure(id);
  return { src: figureSrc(f), alt: f.alt ?? "", width: f.width, height: f.height };
}

export { figures };
