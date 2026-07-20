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
import additions from "./publications.additions.json";
import identifiers from "./publications.identifiers.json";

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
  /**
   * Short journal name for a paper under review, e.g. "ApJ". ORCID has no good
   * way to express "submitted", so these come from the human-owned
   * publications.additions.json.
   */
  submittedTo?: string | null;
}

/** doi/bibcode -> note, from the human-owned annotations file. */
const noteIndex = new Map<string, string>(
  annotations.notes.flatMap((n) =>
    [n.doi, (n as { bibcode?: string }).bibcode]
      .filter((k): k is string => Boolean(k))
      .map((k) => [k.toLowerCase(), n.note] as [string, string]),
  ),
);

const withNote = <T extends { doi: string | null; bibcode: string | null }>(w: T) => ({
  ...w,
  note:
    noteIndex.get((w.doi ?? "").toLowerCase()) ??
    noteIndex.get((w.bibcode ?? "").toLowerCase()) ??
    null,
});

/*
 * doi -> identifiers ORCID does not carry. Only fills a null field, so a value
 * that later starts flowing through ORCID wins over this file rather than being
 * shadowed by it. See publications.identifiers.json.
 */
const identifierIndex = new Map(
  identifiers.identifiers.map((i) => [i.doi.toLowerCase(), i] as const),
);

const withIdentifiers = <T extends { doi: string | null; bibcode: string | null }>(w: T): T => {
  const extra = identifierIndex.get((w.doi ?? "").toLowerCase());
  return extra ? { ...w, bibcode: w.bibcode ?? extra.bibcode ?? null } : w;
};

const synced: SyncedWork[] = (generated.works as Omit<SyncedWork, "note">[])
  .map(withIdentifiers)
  .map(withNote);

/** Mirrors the sync's rule so an addition lands in the right group. */
function isFirstAuthor(authors: string[] | null | undefined): boolean | null {
  if (!authors || authors.length === 0) return null;
  return /^rosen,\s*a/i.test(authors[0] ?? "");
}

/** Normalised title, for matching an addition against a synced work. */
const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/*
 * Merge the human-owned additions. An addition is DROPPED once the same work
 * appears in ORCID — matched on DOI, arXiv id or title — so the overlap between
 * "submitted" and "published" de-duplicates itself rather than double-listing.
 */
const seen = new Set(
  synced.flatMap((w) =>
    [w.doi?.toLowerCase(), w.arxiv?.toLowerCase(), titleKey(w.title)].filter(Boolean) as string[],
  ),
);

const extra: SyncedWork[] = additions.additions
  .filter(
    (a) =>
      !seen.has((a.doi ?? "").toLowerCase()) &&
      !seen.has((a.arxiv ?? "").toLowerCase()) &&
      !seen.has(titleKey(a.title)),
  )
  .map((a) =>
    withNote({
      title: a.title,
      year: a.year,
      venue: a.venue,
      type: a.type,
      doi: a.doi,
      bibcode: a.bibcode,
      arxiv: a.arxiv,
      authors: a.authors,
      firstAuthor: isFirstAuthor(a.authors),
      submittedTo: a.submittedTo,
    }),
  ) as SyncedWork[];

export const allPublications: SyncedWork[] = [...extra, ...synced].sort(
  (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || a.title.localeCompare(b.title),
);
export const publicationsSource: string = generated.source;
/** Counts the merged list, so additions are included rather than only synced. */
export const publicationCount: number = allPublications.length;

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


/**
 * BibTeX for a work, built from the synced record.
 *
 * Deliberately conservative: it emits only fields we actually hold. A citation
 * with an invented volume or page number is worse than one without — it will
 * be pasted straight into someone's .bib and never checked.
 */
export function bibtex(w: SyncedWork): string {
  const first = (w.authors?.[0] ?? "Rosen, Anna L.").split(",")[0].replace(/\W/g, "");
  const key = `${first.toLowerCase()}${w.year ?? ""}${(w.title.split(/\s+/)[0] ?? "").toLowerCase().replace(/\W/g, "")}`;
  const authors = (w.authors ?? ["Rosen, Anna L."]).join(" and ");

  const fields: [string, string | null][] = [
    ["author", authors],
    ["title", `{${w.title}}`],
    ["journal", w.venue],
    ["year", w.year],
    ["doi", w.doi],
    ["eprint", w.arxiv],
    ["archivePrefix", w.arxiv ? "arXiv" : null],
    ["adsurl", w.bibcode ? `https://ui.adsabs.harvard.edu/abs/${w.bibcode}/abstract` : null],
    ["note", w.submittedTo ? `Submitted to ${w.submittedTo}` : null],
  ];

  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k.padEnd(13)} = {${v}}`)
    .join(",\n");

  return `@article{${key},\n${body}\n}`;
}
