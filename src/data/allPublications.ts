/*
 * allPublications.ts — the FULL bibliography, auto-synced from Anna's public
 * ORCID record by scripts/publications/sync_orcid.mjs.
 *
 * Two layers, deliberately separate:
 *   - MACHINE (here): the complete list of works, regenerated on a schedule.
 *   - HUMAN (src/data/publications.ts): featured papers with hand-written
 *     plain-language summaries. The sync never touches those.
 *
 * Regenerate: `pnpm sync:pubs` (or the scheduled GitHub Action).
 */
import generated from "./generated/publications.json";
import annotations from "./publications.notes.json";

export interface SyncedWork {
  title: string;
  year: string | null;
  venue: string | null;
  type: string | null;
  doi: string | null;
  bibcode: string | null;
  arxiv: string | null;
  /** Full author list, resolved from the DOI via Crossref/DataCite. */
  authors: string[] | null;
  /**
   * Anna at author position 1. `null` means authorship could not be resolved —
   * deliberately NOT folded into `false`, so an unresolvable paper shows up for
   * review instead of quietly appearing as co-authored.
   */
  firstAuthor: boolean | null;
  /**
   * Short human-authored annotation, merged from the HUMAN-owned
   * publications.notes.json. Kept out of the generated file on purpose: the
   * sync rewrites that wholesale and would erase anything written into it.
   */
  note: string | null;
}

/** doi/bibcode -> note, from the human-owned annotations file. */
const noteIndex = new Map<string, string>(
  annotations.notes.flatMap((n) =>
    [n.doi, (n as { bibcode?: string }).bibcode]
      .filter((k): k is string => Boolean(k))
      .map((k) => [k.toLowerCase(), n.note] as [string, string]),
  ),
);

export const allPublications: SyncedWork[] = (
  generated.works as Omit<SyncedWork, "note">[]
).map((w) => ({
  ...w,
  note:
    noteIndex.get((w.doi ?? "").toLowerCase()) ??
    noteIndex.get((w.bibcode ?? "").toLowerCase()) ??
    null,
}));
export const publicationsSource: string = generated.source;
export const publicationCount: number = generated.count;

/** Role split. Anything unresolved rides along with co-authored in the list but
 *  is counted separately so it can never silently inflate either number. */
export const firstAuthored: SyncedWork[] = allPublications.filter(
  (w) => w.firstAuthor === true,
);
export const coAuthored: SyncedWork[] = allPublications.filter(
  (w) => w.firstAuthor === false,
);
export const unresolvedAuthorship: SyncedWork[] = allPublications.filter(
  (w) => w.firstAuthor === null,
);

/** Format an author list for display, truncating long collaborations. */
export function authorLine(w: SyncedWork, max = 4): string | null {
  if (!w.authors || w.authors.length === 0) return null;
  return w.authors.length > max
    ? `${w.authors.slice(0, max).join("; ")}; et al.`
    : w.authors.join("; ");
}

/** Works grouped by year, newest first — the usual bibliography layout. */
export function byYear(
  works: SyncedWork[] = allPublications,
): Array<{ year: string; works: SyncedWork[] }> {
  const groups = new Map<string, SyncedWork[]>();
  for (const w of works) {
    const y = w.year ?? "—";
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y)!.push(w);
  }

  return [...groups.entries()]
    .sort((a, b) => (Number(b[0]) || 0) - (Number(a[0]) || 0))
    .map(([year, works]) => ({ year, works }));
}

/** Canonical external link for a work: DOI first, then ADS, then arXiv. */
export function workUrl(w: SyncedWork): string | null {
  if (w.doi) return `https://doi.org/${w.doi}`;
  if (w.bibcode) return `https://ui.adsabs.harvard.edu/abs/${w.bibcode}/abstract`;
  if (w.arxiv) return `https://arxiv.org/abs/${w.arxiv}`;
  return null;
}
