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
import humanAbstracts from "./publications.abstracts.json";
import studentLeadRecord from "../../cv/generated/student-lead.json";

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
  /** Short journal name once a paper is accepted but not yet in ORCID. */
  acceptedIn?: string | null;
  /** Journal volume, from Crossref — ORCID does not carry it. */
  volume?: string | null;
  /** Page or article number, from Crossref. */
  page?: string | null;
  /**
   * The paper's OWN published abstract, fetched verbatim by the sync from a
   * tokenless source (arXiv > Crossref > Semantic Scholar). `null`/absent where
   * none of them carries one — the abstract toggle is simply omitted, never
   * faked. A citable source, so it may be shown verbatim.
   */
  abstract?: string | null;
  /** Where the abstract came from — provenance kept with the record.
   *  "author" = supplied by Anna via publications.abstracts.json. */
  abstractSource?: "arxiv" | "crossref" | "semanticscholar" | "author" | null;
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
 * doi -> identifiers ORCID does not carry. A bibcode fills a null field, or
 * replaces a preprint (arXiv) bibcode once the paper is published, so a journal
 * value that later starts flowing through ORCID wins over this file rather than
 * being shadowed by it. A title here fixes casing only (ORCID can hold a
 * journal's all-caps title). See publications.identifiers.json.
 */
const identifierIndex = new Map(
  (identifiers.identifiers as { doi: string; bibcode?: string; title?: string }[]).map(
    (i) => [i.doi.toLowerCase(), i] as const,
  ),
);

const isPreprintBibcode = (b: string | null) => b != null && b.includes("arXiv");

const withIdentifiers = <
  T extends { doi: string | null; bibcode: string | null; title: string },
>(
  w: T,
): T => {
  const extra = identifierIndex.get((w.doi ?? "").toLowerCase());
  if (!extra) return w;
  const bibcode =
    w.bibcode && !isPreprintBibcode(w.bibcode) ? w.bibcode : (extra.bibcode ?? w.bibcode);
  return { ...w, bibcode, title: extra.title ?? w.title };
};

/*
 * doi -> human-owned abstract. An author-supplied abstract is authoritative, so
 * it OVERRIDES whatever the sync scraped (the tokenless sources often return a
 * flattened, lossy version — see the HARM² note). Remove the override once the
 * sync starts returning a clean one. See publications.abstracts.json.
 */
const abstractOverride = new Map(
  humanAbstracts.abstracts.map((a) => [a.doi.toLowerCase(), a.abstract] as const),
);

const withHumanAbstract = <T extends { doi: string | null; abstract?: string | null }>(w: T): T => {
  const supplied = abstractOverride.get((w.doi ?? "").toLowerCase());
  return supplied ? { ...w, abstract: supplied, abstractSource: "author" } : w;
};

const synced: SyncedWork[] = (generated.works as Omit<SyncedWork, "note">[])
  .map(withIdentifiers)
  .map(withHumanAbstract)
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
      submittedTo: (a as { submittedTo?: string }).submittedTo ?? null,
      acceptedIn: (a as { acceptedIn?: string }).acceptedIn ?? null,
      // A submitted paper ORCID cannot see yet may still carry its own abstract
      // here (verbatim from arXiv). Dropped automatically once it enters ORCID
      // and this addition de-dupes out.
      abstract: (a as { abstract?: string }).abstract ?? null,
      abstractSource: (a as { abstractSource?: SyncedWork["abstractSource"] }).abstractSource ?? null,
    }),
  ) as SyncedWork[];

export const allPublications: SyncedWork[] = [...extra, ...synced].sort(
  (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || a.title.localeCompare(b.title),
);
export const publicationsSource: string = generated.source;
/** Counts the merged list, so additions are included rather than only synced. */
export const publicationCount: number = allPublications.length;
/**
 * Refereed count = journal articles only (JOSS included), excluding preprints
 * and submitted work. This is the CV's headline figure, and scripts/cv/check.mjs
 * derives the same number for the printed CV — so the site and the PDF agree.
 */
export const refereedCount: number = allPublications.filter(
  (w) => w.type === "journal-article",
).length;

/*
 * Abstract lookup, so the featured cards (the HUMAN layer) DERIVE their abstract
 * from this one machine home instead of storing a second copy that could drift.
 *
 * Keyed by every identifier a work carries AND by its normalised title. The
 * title key matters because ORCID recorded only DOIs for Anna's older
 * first-author papers, so the featured cards (which link by arXiv/ADS, not DOI)
 * share no machine identifier with the synced record — the title is the only
 * bridge. It is the same normalisation the additions de-dup already trusts.
 */
const abstractIndex = new Map<string, string>();
const indexAbstract = (k: string | null | undefined, a: string) => {
  if (k) abstractIndex.set(k.toLowerCase(), a);
};
for (const w of allPublications) {
  if (!w.abstract) continue;
  indexAbstract(w.arxiv, w.abstract);
  indexAbstract(w.bibcode, w.abstract);
  indexAbstract(w.doi, w.abstract);
  abstractIndex.set(`title:${titleKey(w.title)}`, w.abstract);
}

/** A reference to a work by any key that might resolve its abstract. */
export interface AbstractRef {
  arxiv?: string | null;
  bibcode?: string | null;
  doi?: string | null;
  title?: string | null;
}

/** The stored abstract for a work, matched by identifier first, then title. */
export function abstractFor(ref: AbstractRef): string | null {
  for (const id of [ref.arxiv, ref.bibcode, ref.doi]) {
    const hit = id ? abstractIndex.get(id.toLowerCase()) : undefined;
    if (hit) return hit;
  }
  return ref.title ? (abstractIndex.get(`title:${titleKey(ref.title)}`) ?? null) : null;
}

/** Role split. Anything unresolved rides along with co-authored in the list but
 *  is counted separately so it can never silently inflate either number. */
/*
 * A software paper documents a code, not a science result, so it belongs in its
 * own group rather than mixed with research papers. Detected by venue —
 * DERIVED, not a hand list — so a future one joins automatically. Still a
 * refereed publication, so it stays in the record and in the count; it is only
 * presented separately.
 *
 * The venue is named in the TEST below because a detector has to match
 * something, and it matches papers that already exist. It is not named in prose
 * anywhere, and no unwritten paper is assigned one: which venue a planned
 * package paper lands in is unsettled, and this repository is public.
 */
export const isSoftwarePaper = (w: SyncedWork): boolean =>
  /journal of open source software/i.test(w.venue ?? "");

export const softwarePapers: SyncedWork[] = allPublications.filter(isSoftwarePaper);

/* The author-based groups exclude software papers, so a JOSS code paper appears
 * once, under Software, instead of doubling into Co-authored. */
export const firstAuthored: SyncedWork[] = allPublications.filter(
  (w) => w.firstAuthor === true && !isSoftwarePaper(w),
);
export const coAuthored: SyncedWork[] = allPublications.filter(
  (w) => w.firstAuthor === false && !isSoftwarePaper(w),
);
export const unresolvedAuthorship: SyncedWork[] = allPublications.filter(
  (w) => w.firstAuthor === null && !isSoftwarePaper(w),
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

/*
 * One work by DOI, for pages that reference a specific paper.
 *
 * The DOI is the reference; everything shown about the paper — title, authors,
 * journal, volume, page, year, link — is read from the synced record. A page
 * that retyped a citation would be a second copy of it, and a citation that
 * disagrees with the bibliography on the same site is worse than none.
 *
 * Returns undefined rather than throwing: callers decide whether a missing
 * paper is fatal, and the advising list still renders without its link.
 */
export function publicationByDoi(doi: string): SyncedWork | undefined {
  return allPublications.find((w) => w.doi === doi);
}

/**
 * Short citation line — "Journal 1004, 14 (2026)" — from what we actually hold.
 *
 * Emits only the parts present, for the reason `bibtex` is conservative: an
 * invented volume or page is worse than an absent one, because it looks
 * checked.
 */
export function shortCitation(w: SyncedWork): string | null {
  const bits = [w.venue, [w.volume, w.page].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" ");
  if (!bits) return w.year ?? null;
  return w.year ? `${bits} (${w.year})` : bits;
}

/** Canonical external link for a work: DOI first, then ADS, then arXiv. */
/*
 * Papers a student I advised led (first author). Derived once, by
 * scripts/cv/check.mjs from the advisee records, and read here and by the CV —
 * so the two cannot disagree about which papers carry the star.
 */
const studentLedDois = new Set(
  studentLeadRecord.papers.map((p) => (p.doi ?? "").toLowerCase()).filter(Boolean),
);
export const isStudentLed = (w: SyncedWork): boolean =>
  w.doi != null && studentLedDois.has(w.doi.toLowerCase());

/** The SciX record for a bibcode. SciX replaced NASA ADS; bibcodes carry over. */
export const scixUrl = (bibcode: string) =>
  `https://scixplorer.org/abs/${bibcode}/abstract`;

/** The bibcode inside a SciX (or legacy ADS) abstract URL, if it is one. */
export const bibcodeOf = (url: string | null | undefined): string | null =>
  url?.match(/\/abs\/([^/?#]+)/)?.[1] ?? null;

/** arXiv's own DOIs (10.48550/arXiv.*) are preprints, not a journal. */
const isArxivDoi = (doi: string | null) => doi != null && doi.toLowerCase().startsWith("10.48550/");

/** The published version, through its DOI. Null for a preprint-only work. */
export const journalUrl = (w: SyncedWork): string | null =>
  w.doi && !isArxivDoi(w.doi) ? `https://doi.org/${w.doi}` : null;

/** Where a work's title links: the journal, else SciX, else arXiv. */
export function workUrl(w: SyncedWork): string | null {
  if (w.doi) return `https://doi.org/${w.doi}`;
  if (w.bibcode) return scixUrl(w.bibcode);
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
    ["adsurl", w.bibcode ? scixUrl(w.bibcode) : null],
    [
      "note",
      w.acceptedIn
        ? `Accepted for publication in ${w.acceptedIn}`
        : w.submittedTo
          ? `Submitted to ${w.submittedTo}`
          : null,
    ],
  ];

  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k.padEnd(13)} = {${v}}`)
    .join(",\n");

  return `@article{${key},\n${body}\n}`;
}
