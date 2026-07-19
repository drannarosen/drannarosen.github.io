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

export interface SyncedWork {
  title: string;
  year: string | null;
  venue: string | null;
  type: string | null;
  doi: string | null;
  bibcode: string | null;
  arxiv: string | null;
}

export const allPublications: SyncedWork[] = generated.works as SyncedWork[];
export const publicationsSource: string = generated.source;
export const publicationCount: number = generated.count;

/** Works grouped by year, newest first — the usual bibliography layout. */
export function byYear(): Array<{ year: string; works: SyncedWork[] }> {
  const groups = new Map<string, SyncedWork[]>();
  for (const w of allPublications) {
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
