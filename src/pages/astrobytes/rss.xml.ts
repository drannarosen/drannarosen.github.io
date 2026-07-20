/*
 * RSS for astrobytes. Students and curious readers are the audience, and a
 * feed is the one subscription mechanism that needs no account, no algorithm
 * and no third party — which also keeps it inside ADR-0011 (no tracking).
 *
 * Only the astrobytes collection is syndicated. If a machine-generated stream
 * is ever added it gets its OWN feed rather than being mixed in here, so
 * subscribing to Anna's writing never silently starts delivering something
 * she did not write.
 *
 * The provenance fields are NAMESPACED (site:authorship, site:reviewedBy).
 * RSS 2.0 only permits extension elements that live in a declared namespace;
 * emitting bare <authorship> makes the feed invalid, which is what a strict
 * validator objects to even though the XML itself parses.
 *
 * The XSL stylesheet is not decoration either: a browser shown raw XML prints
 * "This XML file does not appear to have any style information", which reads
 * as a broken page to anyone who clicks the feed link expecting content.
 */
import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getCollection } from "astro:content";

/** Namespace for this site's own provenance extensions. */
const SITE_NS = "https://anna-rosen.com/ns/provenance";

/** Minimal XML escaping — a reviewer's name is authored data, not markup. */
const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(context: APIContext) {
  const posts = (await getCollection("astrobytes", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  const self = new URL("/astrobytes/rss.xml", context.site!).href;
  /* Newest post rather than build time: a build timestamp would change the
     bytes on every build even when nothing was published. */
  const lastBuild = posts[0]?.data.date ?? new Date(0);

  return rss({
    title: "Astrobytes — Anna Rosen",
    description:
      "Astronomy papers, explained. What was measured, the mechanism behind the result, and what it does not show.",
    site: context.site!,
    xmlns: { atom: "http://www.w3.org/2005/Atom", site: SITE_NS },
    stylesheet: "/astrobytes/rss.xsl",
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.dek,
      pubDate: p.data.date,
      link: `/astrobytes/${p.id}/`,
      categories: p.data.tags,
      // Disclosed in the feed too, not only on the page: a reader should not
      // have to visit the site to learn a model drafted the prose.
      customData:
        `<site:authorship>${xml(p.data.provenance.authorship)}</site:authorship>` +
        (p.data.provenance.reviewedBy
          ? `<site:reviewedBy>${xml(p.data.provenance.reviewedBy)}</site:reviewedBy>`
          : ""),
    })),
    customData:
      "<language>en-us</language>" +
      `<lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>` +
      `<atom:link href="${self}" rel="self" type="application/rss+xml"/>`,
  });
}
