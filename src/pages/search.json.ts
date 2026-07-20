/*
 * search.json — the search index, built at deploy time and served as a static
 * file. No backend, no API key, no third-party search service (which would
 * also breach ADR-0007's no-third-party-embeds rule).
 *
 * HONEST SCOPE: this is a LEXICAL index — words, stems and a small domain
 * synonym map — not embeddings. Real semantic search needs a model at build
 * time; over 37 papers with dense, technical titles, good keyword matching
 * with field weighting gets most of the benefit at none of the cost.
 */
import type { APIContext } from "astro";
import { getCollection } from "astro:content";
import { allPublications, workUrl, authorLine } from "../data/allPublications";

export async function GET(_context: APIContext) {
  const posts = await getCollection("astrobytes", ({ data }) => !data.draft);
  const packages = await getCollection("packages", ({ data }) => !data.draft);

  const docs = [
    ...allPublications.map((w) => ({
      kind: "paper" as const,
      title: w.title,
      meta: [w.year, w.venue].filter(Boolean).join(" · "),
      extra: authorLine(w, 12) ?? "",
      url: workUrl(w) ?? "/publications",
      internal: false,
    })),
    ...posts.map((p) => ({
      kind: "astrobyte" as const,
      title: p.data.title,
      meta: p.data.paper.title,
      extra: `${p.data.dek} ${p.data.tags.join(" ")}`,
      url: `/astrobytes/${p.id}`,
      internal: true,
    })),
    ...packages.map((p) => ({
      kind: "software" as const,
      title: p.data.name,
      meta: p.data.stage,
      extra: `${p.data.tagline} ${p.data.description}`,
      url: `/software/${p.id}`,
      internal: true,
    })),
    ...[
      { title: "Research", meta: "Questions I work on", extra: "massive stars feedback clusters IMF inference", url: "/research" },
      { title: "Publications", meta: "Full bibliography", extra: "papers first-author co-authored", url: "/publications" },
      { title: "Teaching", meta: "Courses", extra: "ASTR 596 COMP 536 ASTR 201 Cosmic Playground", url: "/teaching" },
      { title: "Outreach", meta: "Public engagement", extra: "talks panels science centre community college", url: "/outreach" },
      { title: "CV", meta: "Curriculum vitae", extra: "awards grants service advising", url: "/cv" },
      { title: "Explore", meta: "Interactive demos", extra: "cluster mass segregation gas expulsion", url: "/explore" },
    ].map((p) => ({ ...p, kind: "page" as const, internal: true })),
  ];

  return new Response(JSON.stringify({ docs }), {
    headers: { "Content-Type": "application/json" },
  });
}
