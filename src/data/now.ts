/*
 * now.ts — the one date the /now page and its feed both read.
 *
 * /now shows "Updated <date>" prominently, and the RSS feed re-surfaces the
 * page to subscribers whenever that date changes. If the page and the feed
 * each held their own copy of the date they could disagree — a subscriber
 * pinged for an update the page does not show, or the reverse. One export
 * makes that impossible.
 *
 * Bump this whenever /now changes in a way worth telling a subscriber about.
 * That is a deliberate act, which is the point: the feed fires on a real
 * update, not on every rebuild.
 */
export const nowUpdated = new Date("2026-07-21");

/*
 * The single feed item's summary. A /now feed is unusual — the page is a
 * snapshot that changes in place, not a stream of dated posts — so the feed
 * carries ONE item that re-surfaces on each update, rather than a history of
 * entries the page does not keep. This line is what a reader sees in their
 * feed reader; keep it a description of the page, not a changelog of it.
 */
export const nowFeedSummary =
  "A dated snapshot of what I'm working on right now — the paper on my desk, " +
  "the packages taking most of my attention, students finishing, and what I'm " +
  "building on the side. Re-surfaces here whenever the page is updated.";
