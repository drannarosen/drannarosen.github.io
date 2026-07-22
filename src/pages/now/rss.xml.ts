/*
 * RSS for /now — one item that re-surfaces when the page is updated.
 *
 * A /now page is a snapshot that changes in place, not a stream of dated
 * posts, so this feed is deliberately unusual: it carries a SINGLE item whose
 * guid is tied to the page's `updated` date. When Anna bumps that date the
 * guid changes, and feed readers show the item as new — which is exactly the
 * signal a subscriber wants: "the now page changed." It fires on a real
 * update, not on every rebuild, because only a date bump changes the guid.
 *
 * Separate from the astrobytes feed on purpose. The astrobytes feed is Anna's
 * writing; mixing /now into it would start delivering something else to people
 * who subscribed to the posts. Its own feed keeps the two subscriptions clean,
 * the same reasoning recorded in the astrobytes feed.
 *
 * The date is imported from src/data/now.ts, the same module /now renders, so
 * the feed and the page can never disagree about when it last changed.
 */
import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { nowUpdated, nowFeedSummary } from "../../data/now";

export async function GET(context: APIContext) {
  const self = new URL("/now/rss.xml", context.site!).href;
  const iso = nowUpdated.toISOString().slice(0, 10);

  return rss({
    title: "Now — Anna Rosen",
    description: "What Anna Rosen is working on right now. One entry, updated in place.",
    site: context.site!,
    xmlns: { atom: "http://www.w3.org/2005/Atom" },
    stylesheet: "/astrobytes/rss.xsl",
    items: [
      {
        title: `What I'm working on — updated ${iso}`,
        description: nowFeedSummary,
        pubDate: nowUpdated,
        link: "/now/",
        // The guid carries the date, so a new snapshot is a new item to a
        // reader rather than a silent edit they never see.
        commentsUrl: undefined,
        customData: `<guid isPermaLink="false">now-${iso}</guid>`,
      },
    ],
    customData:
      "<language>en-us</language>" +
      `<lastBuildDate>${nowUpdated.toUTCString()}</lastBuildDate>` +
      `<atom:link href="${self}" rel="self" type="application/rss+xml"/>`,
  });
}
