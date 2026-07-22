#!/usr/bin/env node
/*
 * sync_orcid.mjs — regenerate the full bibliography from Anna's public ORCID record.
 *
 * WHY: the featured papers in src/data/publications.ts carry hand-written
 * plain-language summaries — that's the HUMAN layer and this script never touches
 * it. This script only refreshes the MACHINE layer: the complete list of works.
 * Keeping them separate means an automated sync can never clobber Anna's prose.
 *
 * Uses the ORCID *public* API — no key, no token, no secret required.
 *
 *   node scripts/publications/sync_orcid.mjs                      # write the JSON
 *   node scripts/publications/sync_orcid.mjs --check             # exit 1 if out of date (CI)
 *   node scripts/publications/sync_orcid.mjs --refresh-authors   # re-fetch every author list
 *   node scripts/publications/sync_orcid.mjs --refresh-abstracts # re-fetch every abstract
 *
 * AUTHORSHIP: ORCID's works summary carries no author list, so first-author
 * status is resolved from the DOI via Crossref (and DataCite for arXiv DOIs).
 * Both are free and unauthenticated — no token, no account. Author lists are
 * reused from the previous output unless --refresh-authors is passed, so a
 * routine sync makes no per-paper requests at all.
 *
 * Output: src/data/generated/publications.json (generated — do not hand-edit)
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ORCID = process.env.ORCID_ID ?? "0000-0003-4423-0660";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../src/data/generated/publications.json");
const EXCLUDE = resolve(HERE, "../../src/data/publications.exclude.json");

/** Normalized title used only for de-duplicating preprint vs published versions. */
const key = (t) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Pull an arXiv id out of an ORCID external id (bibcode or the arXiv DOI form). */
function arxivId(ids) {
  const direct = ids.find((i) => i.type === "arxiv")?.value;
  if (direct) return direct.replace(/^arxiv:/i, "");
  const doi = ids.find((i) => i.type === "doi")?.value ?? "";
  const m = doi.match(/10\.48550\/arxiv\.(.+)$/i);
  return m ? m[1] : null;
}

async function fetchWorks() {
  const res = await fetch(`https://pub.orcid.org/v3.0/${ORCID}/works`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ORCID ${res.status} ${res.statusText}`);
  const data = await res.json();

  const records = [];
  for (const group of data.group ?? []) {
    const s = group["work-summary"]?.[0];
    if (!s) continue;
    const ids = (s["external-ids"]?.["external-id"] ?? []).map((x) => ({
      type: (x["external-id-type"] ?? "").toLowerCase(),
      value: x["external-id-value"] ?? "",
    }));
    records.push({
      title: s.title?.title?.value ?? null,
      year: s["publication-date"]?.year?.value ?? null,
      venue: s["journal-title"]?.value ?? null,
      type: s.type ?? null,
      doi: ids.find((i) => i.type === "doi")?.value ?? null,
      bibcode: ids.find((i) => i.type === "bibcode")?.value ?? null,
      arxiv: arxivId(ids),
    });
  }
  return records.filter((r) => r.title);
}

/**
 * Collapse preprint + published versions of the same paper into one record,
 * preferring the journal version but keeping the arXiv id and earliest year info.
 */
function dedupe(records) {
  const byTitle = new Map();
  for (const r of records) {
    const k = key(r.title);
    const prev = byTitle.get(k);
    if (!prev) { byTitle.set(k, r); continue; }
    const isPreprint = (x) => !x.venue || /arxiv/i.test(x.venue);
    // Keep whichever is the published version; merge the other's arXiv id.
    const [keep, drop] = isPreprint(prev) && !isPreprint(r) ? [r, prev] : [prev, r];
    keep.arxiv = keep.arxiv ?? drop.arxiv;
    keep.bibcode = keep.bibcode ?? drop.bibcode;
    byTitle.set(k, keep);
  }
  return [...byTitle.values()].sort(
    (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || a.title.localeCompare(b.title),
  );
}

/**
 * Apply the hand-maintained exclusion list (src/data/publications.exclude.json).
 * That file is HUMAN-owned and never rewritten here, so editorial decisions about
 * what belongs in the public bibliography survive every automated sync.
 */
function applyExclusions(records) {
  if (!existsSync(EXCLUDE)) return { kept: records, dropped: [] };
  const cfg = JSON.parse(readFileSync(EXCLUDE, "utf8"));
  const types = new Set(cfg.excludeTypes ?? []);
  const rules = (cfg.exclude ?? []).filter((r) => !r._example);

  const matches = (r, w) =>
    (r.doi && w.doi && r.doi.toLowerCase() === w.doi.toLowerCase()) ||
    (r.bibcode && w.bibcode && r.bibcode === w.bibcode) ||
    (r.title && key(r.title) === key(w.title));

  const kept = [], dropped = [];
  for (const w of records) {
    const rule = rules.find((r) => matches(r, w));
    if (types.has(w.type) || rule) {
      dropped.push({ title: w.title, why: rule?.reason ?? `type: ${w.type}` });
    } else kept.push(w);
  }
  return { kept, dropped };
}

/* ------------------------------------------------------------------ *
 * Abstracts
 *
 * The paper's OWN published abstract is a citable source, so it can be stored
 * verbatim. Fetched from tokenless public APIs only — arXiv first (covers every
 * preprint), Crossref as a fallback — so the sync keeps its "no key, no secret"
 * property and never needs an ADS token. Cached exactly like author lists: a
 * routine sync re-fetches nothing, only a newly-appeared paper hits the network.
 * ------------------------------------------------------------------ */

const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decode the handful of entities arXiv/Crossref emit; leave everything else. */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => HTML_ENTITIES[n.toLowerCase()] ?? m);
}

/** Normalise fetched abstract text: strip tags, collapse whitespace, trim. */
function cleanAbstract(raw) {
  if (!raw) return null;
  const text = decodeEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  // Crossref sometimes prefixes a literal "Abstract" heading; drop it.
  const stripped = text.replace(/^abstract[:.\s]+/i, "").trim();
  return stripped.length > 0 ? stripped : null;
}

/** arXiv Atom feed → the entry <summary>, which is the abstract. */
async function fetchArxivAbstract(arxiv) {
  const res = await fetch(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxiv)}&max_results=1`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) return null;
  const xml = await res.text();
  const m = xml.match(/<entry>[\s\S]*?<summary>([\s\S]*?)<\/summary>/);
  return cleanAbstract(m?.[1]);
}

/** Crossref abstract (JATS-tagged) for a DOI, or null if not deposited. */
async function fetchCrossrefAbstract(doi) {
  const c = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  return cleanAbstract(c?.message?.abstract);
}

/**
 * Semantic Scholar abstract for a DOI — a tokenless fallback that often has the
 * older journal papers Crossref never received an abstract for. Also carries an
 * arXiv id when it knows one, which recovers preprint abstracts whose id ORCID
 * did not record.
 */
/** GET JSON with backoff on 429 — Semantic Scholar rate-limits unauthenticated
 *  callers hard, and a bare failure would silently drop an abstract only it has. */
async function getJsonRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status === 429 && i < tries - 1) {
      await new Promise((r) => setTimeout(r, 1800 * (i + 1)));
      continue;
    }
    return null;
  }
  return null;
}

async function fetchSemanticScholarAbstract(doi) {
  const s = await getJsonRetry(
    `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=abstract,externalIds`,
  );
  const direct = cleanAbstract(s?.abstract);
  if (direct) return { abstract: direct, arxiv: s?.externalIds?.ArXiv ?? null };
  // No abstract, but a recovered arXiv id lets the caller try arXiv itself.
  return { abstract: null, arxiv: s?.externalIds?.ArXiv ?? null };
}

/**
 * Resolve one paper's abstract, strongly preferring arXiv.
 *
 * arXiv abstracts keep the author's real LaTeX ($M_\odot$, 10^{35}); Crossref's
 * are JATS flattened to lossy text (superscripts and subscripts gone, Unicode
 * glyphs, stray spaces). So arXiv wins whenever it can be reached — including by
 * recovering an arXiv id from Semantic Scholar when ORCID never recorded one —
 * and Crossref / Semantic Scholar text is only a last resort.
 */
async function fetchAbstract(w) {
  // arXiv first (cleanest LaTeX), then Crossref, then Semantic Scholar only as a
  // last resort. The Unicode in the Crossref/S2 text is normalised to real math
  // at render time (see src/lib/abstract.ts), so maximising COVERAGE matters more
  // than the source — a lossy abstract beats none. Semantic Scholar is queried
  // sparingly because unauthenticated calls rate-limit (429) under load.
  if (w.arxiv) {
    try {
      const a = await fetchArxivAbstract(w.arxiv);
      if (a) return { abstract: a, abstractSource: "arxiv" };
    } catch { /* fall through */ }
  }
  if (!w.doi || /^10\.48550\//i.test(w.doi)) return { abstract: null, abstractSource: null };
  try {
    const a = await fetchCrossrefAbstract(w.doi);
    if (a) return { abstract: a, abstractSource: "crossref" };
  } catch { /* fall through */ }
  try {
    const s = await fetchSemanticScholarAbstract(w.doi);
    if (s.abstract) return { abstract: s.abstract, abstractSource: "semanticscholar" };
    if (s.arxiv) {
      const a = await fetchArxivAbstract(s.arxiv);
      if (a) return { abstract: a, abstractSource: "arxiv" };
    }
  } catch { /* give up quietly — a missing abstract just omits the toggle */ }
  return { abstract: null, abstractSource: null };
}

/** Stable cache key so a paper keeps its abstract across syncs. */
const abstractKey = (w) =>
  (w.doi && `doi:${w.doi.toLowerCase()}`) ||
  (w.arxiv && `arxiv:${w.arxiv.toLowerCase()}`) ||
  `title:${key(w.title)}`;

/** Attach abstracts, reusing cached text so routine syncs make no requests. */
async function withAbstracts(records, refresh) {
  const cache = new Map();
  if (!refresh && existsSync(OUT)) {
    for (const w of JSON.parse(readFileSync(OUT, "utf8")).works ?? []) {
      if (w.abstract) cache.set(abstractKey(w), { abstract: w.abstract, abstractSource: w.abstractSource ?? null });
    }
  }
  let fetched = 0;
  const out = [];
  for (const w of records) {
    let hit = cache.get(abstractKey(w));
    if (!hit) {
      hit = await fetchAbstract(w);
      fetched++;
      await new Promise((r) => setTimeout(r, 120)); // polite to two free APIs
    }
    out.push({ ...w, abstract: hit.abstract, abstractSource: hit.abstractSource });
  }
  if (fetched > 0) console.log(`[abstracts] resolved ${fetched} paper(s) over the network`);
  return out;
}

/* ------------------------------------------------------------------ *
 * Authorship
 * ------------------------------------------------------------------ */

/** Crossref asks that automated clients identify themselves ("polite pool"). */
const UA = `drannarosen.github.io/1.0 (https://drannarosen.github.io; mailto:${
  process.env.CONTACT_EMAIL ?? "alrosen@sdsu.edu"
})`;

const fmt = (given, family) =>
  family ? `${family}${given ? `, ${given}` : ""}` : (given ?? null);

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!res.ok) return null;
  return res.json();
}

/** Full author list for a DOI, or null if neither registry can resolve it. */
async function fetchAuthors(doi) {
  // arXiv DOIs are registered with DataCite; everything else with Crossref.
  if (/^10\.48550\//i.test(doi)) {
    const d = await getJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
    const creators = d?.data?.attributes?.creators;
    if (!Array.isArray(creators) || creators.length === 0) return null;
    return creators.map((c) => fmt(c.givenName, c.familyName) ?? c.name ?? null);
  }
  const c = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  const authors = c?.message?.author;
  if (!Array.isArray(authors) || authors.length === 0) return null;
  return authors.map((a) => fmt(a.given, a.family) ?? a.name ?? null);
}

/**
 * Is Anna the FIRST author (position 1 only — per Anna, co-first does not count)?
 * Returns null when authorship could not be resolved, so unresolved papers can
 * surface for review instead of being silently filed as co-authored.
 */
function isFirstAuthor(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return null;
  const first = (authors[0] ?? "").toLowerCase();
  if (!first) return null;
  // Formatted "Family, Given" — require the Rosen surname AND an A. given name
  // so a different Rosen can never be counted as Anna.
  return /^rosen,\s*a/.test(first);
}

/** Attach authors + firstAuthor, reusing prior results so syncs stay cheap. */
async function withAuthors(records, refresh) {
  const cache = new Map();
  if (!refresh && existsSync(OUT)) {
    for (const w of JSON.parse(readFileSync(OUT, "utf8")).works ?? []) {
      if (w.doi && Array.isArray(w.authors)) cache.set(w.doi.toLowerCase(), w.authors);
    }
  }
  let fetched = 0;
  const out = [];
  for (const w of records) {
    let authors = w.doi ? cache.get(w.doi.toLowerCase()) : null;
    if (!authors && w.doi) {
      try {
        authors = await fetchAuthors(w.doi);
      } catch {
        authors = null;
      }
      fetched++;
      // Serial with a short pause: 36 papers is small, and being a good
      // citizen of two free APIs costs a few seconds once a month.
      await new Promise((r) => setTimeout(r, 120));
    }
    out.push({ ...w, authors: authors ?? null, firstAuthor: isFirstAuthor(authors) });
  }
  if (fetched > 0) console.log(`[authors] fetched ${fetched} author list(s)`);
  return out;
}

const { kept, dropped } = applyExclusions(dedupe(await fetchWorks()));
const withAuth = await withAuthors(kept, process.argv.includes("--refresh-authors"));
const works = await withAbstracts(
  withAuth,
  process.argv.includes("--refresh-abstracts"),
);
const unresolved = works.filter((w) => w.firstAuthor === null);
const payload = {
  _comment:
    "GENERATED by scripts/publications/sync_orcid.mjs from the public ORCID record. Do not hand-edit; curated summaries live in src/data/publications.ts and exclusions in src/data/publications.exclude.json.",
  source: `https://orcid.org/${ORCID}`,
  count: works.length,
  excluded: dropped.length,
  firstAuthored: works.filter((w) => w.firstAuthor === true).length,
  coAuthored: works.filter((w) => w.firstAuthor === false).length,
  unresolved: unresolved.length,
  works,
};
const json = JSON.stringify(payload, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== json) {
    console.error(`[stale] ${OUT} differs from ORCID (${works.length} works).`);
    process.exit(1);
  }
  console.log(`[ok] up to date (${works.length} works)`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[ok] wrote ${works.length} works -> ${OUT}`);
  console.log(
    `     ${payload.firstAuthored} first-author, ${payload.coAuthored} co-authored`,
  );
  for (const d of dropped) console.log(`     excluded: ${d.title?.slice(0, 60)} (${d.why})`);
  // Loud, not silent: an unresolved paper is shown for review rather than
  // being quietly filed as co-authored, where it would look entirely normal.
  for (const u of unresolved) console.log(`     [!] authorship unresolved: ${u.title}`);
}
