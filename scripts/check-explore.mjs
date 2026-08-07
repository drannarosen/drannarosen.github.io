/*
 * check-explore — every built /explore page is either carded on the hub or
 * declared as held back. Nothing is allowed to be neither.
 *
 * The hub's card list is hand-written (src/pages/explore/index.astro), so it
 * can silently omit a page that ships. It already did: /explore/feedback-budget
 * built, sitemapped and indexed for weeks with no card and nothing to notice.
 *
 * That is the same defect the search crawler was rebuilt to end — eighteen of
 * thirty-one pages missing from the index, nothing failing — and the fix is the
 * same shape. This does not derive the hub, because which pieces are ready and
 * how they are described is an editorial decision; it derives the CHECK, so an
 * omission has to be declared rather than merely happen.
 *
 * Reads dist/, like the search crawler and check-markup: a page is real because
 * it was built, not because someone listed it.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve(process.cwd(), "dist");
const HUB = resolve(DIST, "explore/index.html");

/*
 * Pages that ship without a hub card, and why. A page here is DELIBERATELY
 * unreachable by navigation; each must also carry `noindex` and sit in the
 * sitemap filter and the search crawler's EXCLUDED map, or it is merely
 * hidden from readers while still being advertised to search engines.
 */
const HELD_BACK = new Map([
  ["/explore/feedback-budget", "deferred: finished, not carded on the hub yet"],
]);

if (!existsSync(HUB)) {
  console.error("[explore] dist/explore/index.html missing — run the build first.");
  process.exit(1);
}

/* Built pages: every directory under dist/explore that contains an index.html. */
const built = readdirSync(resolve(DIST, "explore"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(resolve(DIST, "explore", e.name, "index.html")))
  .map((e) => `/explore/${e.name}`);

/* Carded: the hub's own rendered links, not the source array — what a reader
   can actually click is the thing being checked. */
const hubHtml = readFileSync(HUB, "utf8");
const carded = new Set(
  [...hubHtml.matchAll(/href="(\/explore\/[a-z0-9-]+)\/?"/g)].map((m) => m[1]),
);

const problems = [];

for (const url of built) {
  if (carded.has(url)) continue;
  if (HELD_BACK.has(url)) continue;
  problems.push(
    `${url} ships but has no hub card.\n` +
      `      Add a card in src/pages/explore/index.astro, or — if it is being held\n` +
      `      back — add it to HELD_BACK in this file WITH a reason, and give it\n` +
      `      noindex, a sitemap-filter entry, and an EXCLUDED entry in\n` +
      `      scripts/search/build-index.mjs.`,
  );
}

/* A stale hold is the failure this file would otherwise introduce: an entry
   naming a page that no longer exists reads as a considered decision forever. */
for (const [url, why] of HELD_BACK) {
  if (!built.includes(url)) {
    problems.push(
      `${url} is in HELD_BACK ("${why}") but no longer builds.\n` +
        `      Remove it from HELD_BACK in this file.`,
    );
  }
}

/* And a card pointing at nothing is a 404 the build can catch. */
for (const url of carded) {
  if (!built.includes(url)) {
    problems.push(
      `the hub links ${url}, which does not build.\n` +
        `      Fix the href in src/pages/explore/index.astro, or ship the page.`,
    );
  }
}

if (problems.length > 0) {
  console.error("[explore] FAILED");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `[explore] ok — ${built.length} pages: ${carded.size} carded, ` +
    `${HELD_BACK.size} held back by declaration`,
);
