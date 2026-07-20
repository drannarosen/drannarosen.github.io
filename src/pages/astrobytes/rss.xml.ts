/*
 * RSS for astrobytes. Students and curious readers are the audience, and a
 * feed is the one subscription mechanism that needs no account, no algorithm
 * and no third party — which also keeps it inside ADR-0007 (no tracking).
 *
 * Only the astrobytes collection is syndicated. If a machine-generated stream
 * is ever added it gets its OWN feed rather than being mixed in here, so
 * subscribing to Anna's writing never silently starts delivering something
 * she did not write.
 */
import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getCollection } from "astro:content";

export async function GET(context: APIContext) {
  const posts = (await getCollection("astrobytes", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  return rss({
    title: "Astrobytes — Anna Rosen",
    description:
      "Astronomy papers, explained. What was measured, the mechanism behind the result, and what it does not show.",
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.dek,
      pubDate: p.data.date,
      link: `/astrobytes/${p.id}/`,
      categories: p.data.tags,
      // Disclosed in the feed too, not only on the page: a reader should not
      // have to visit the site to learn a model drafted the prose.
      customData:
        `<authorship>${p.data.provenance.authorship}</authorship>` +
        (p.data.provenance.reviewedBy
          ? `<reviewedBy>${p.data.provenance.reviewedBy}</reviewedBy>`
          : ""),
    })),
    customData: "<language>en-us</language>",
  });
}
